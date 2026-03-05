
/**
 * BackgroundTabExtractorService.js
 *
 * Opens a hidden Chrome tab, waits for full JS rendering, injects
 * site-specific bypass scripts to remove paywall CSS and extract
 * readable text. Works for Studocu, PasseiDireto, Brainly and other JS-heavy SPAs.
 *
 * For Cloudflare-protected sites (Studocu, Gauthmath), uses CloudflareBypassService
 * which implements 16 stealth evasions + human mouse simulation (Bezier + Fitts).
 *
 * Requires manifest permissions:
 *   "tabs", "scripting", "activeTab", "<all_urls>"
 */

import { CloudflareBypassService } from './bypass/CloudflareBypassService.js';
import { StealthEvasions } from './bypass/StealthEvasions.js';
import { HumanMouseSimulator } from './bypass/HumanMouseSimulator.js';

// Sites protected by Cloudflare Bot Management / Akamai — use full bypass pipeline
const CF_PROTECTED_SITES = new Set(['studocu']);

// Sites with heavy behavior analysis (mouse tracking, scroll detection) — use HumanMouseSimulator
const HUMAN_SIM_SITES = new Set(['brainly', 'scribd']);

// Concurrency semaphore — limit simultaneous background tabs to avoid Chrome choking
const MAX_CONCURRENT_TABS = 3;
let _activeTabCount = 0;
const _tabQueue = [];

function _acquireTabSlot() {
  if (_activeTabCount < MAX_CONCURRENT_TABS) {
    _activeTabCount++;
    return Promise.resolve();
  }
  return new Promise(resolve => _tabQueue.push(resolve));
}

function _releaseTabSlot() {
  _activeTabCount--;
  if (_tabQueue.length > 0) {
    _activeTabCount++;
    _tabQueue.shift()();
  }
}

export class BackgroundTabExtractorService {

  // Public API

  /** Returns true if this URL belongs to a JS-heavy SPA. */
  static isJsHeavySpa(url) {
    if (!url || typeof url !== 'string') return false;
    return BackgroundTabExtractorService._detectSite(url) !== null;
  }

  /**
   * Opens a hidden Chrome tab, waits for rendering, injects a site-specific
   * extractor, and returns the extracted text (or null on failure).
   * For CF-protected sites, uses CloudflareBypassService with full stealth pipeline.
   * @param {string} url
   * @param {{ timeoutMs?: number, renderWaitMs?: number }} options
   * @returns {Promise<string|null>}
   */
  static async extractFromUrl(url, options = {}) {
    await _acquireTabSlot();
    try {
      const site = BackgroundTabExtractorService._detectSite(url);
      const extractor = site ? BackgroundTabExtractorService._getExtractor(site) : null;

      // Route CF-protected sites through full bypass pipeline, fallback to standard on failure
      if (site && CF_PROTECTED_SITES.has(site) && extractor) {
        const cfResult = await BackgroundTabExtractorService._extractWithCFBypass(url, site, extractor, options);
        if (cfResult && cfResult.length > 100) return cfResult;
        // CF bypass failed — fall through to standard extraction with user's cookies
        console.log(`[AH-TAB] [FALLBACK] CF-bypass empty for ${site}, trying standard extraction...`);
      }

      // Standard extraction — works for known sites (with specific extractor) AND
      // unknown sites (generic textContent fallback kicks in automatically)
      return await BackgroundTabExtractorService._extractStandard(url, site || 'generic', extractor, options);
    } finally {
      _releaseTabSlot();
    }
  }

  /**
   * Alias for extractFromUrl — accepts options: { timeoutMs, renderWaitMs }.
   * Called by ApiService when shouldTryFallbacks is true for JS-heavy SPAs.
   */
  static async extractViaTab(url, options = {}) {
    return BackgroundTabExtractorService.extractFromUrl(url, options);
  }

  // ─── Extraction Strategies ────────────────────────────────────────────────

  /**
   * Full Cloudflare bypass pipeline:
   *   1. Cookie reuse (cf_clearance already in browser)
   *   2. Stealth injection (16 evasions: visibility, plugins, WebGL, etc.)
   *   3. Human mouse simulation (Bezier curves + Fitts's Law)
   *   4. Challenge resolution wait
   */
  static async _extractWithCFBypass(url, site, extractor, options = {}) {
    console.log(`[AH-TAB] [SHIELD] CF-bypass pipeline for [${site}] → ${url}`);
    try {
      const result = await CloudflareBypassService.extract(url, extractor, {
        challengeTimeoutMs: options.timeoutMs || 35000,
        loadTimeoutMs:      options.timeoutMs || 38000,
      });
      const text = result?.text || '';
      if (text.length > 100) {
        console.log(`[AH-TAB] [OK] CF-bypass extracted ${text.length} chars from ${site} (method=${result.method})`);
        return text;
      }
      console.warn(`[AH-TAB] [WARN] CF-bypass returned empty for ${site} — falling through`);
      return null;
    } catch (err) {
      console.warn(`[AH-TAB] [FAIL] CF-bypass error for ${site}:`, err?.message || err);
      return null;
    }
  }

  /**
   * Standard background tab extraction (no CF bypass).
   * Used for Brainly, PasseiDireto, Scribd, Slideshare.
   * Opens a minimized popup window so the tab never appears in the user's tab bar.
   */
  static async _extractStandard(url, site, extractor, options = {}) {
    const waitMs = options.renderWaitMs != null
      ? options.renderWaitMs
      : BackgroundTabExtractorService._getRenderWaitMs(site);
    let tabId = null;
    let winId  = null;
    try {
      console.log(`[AH-TAB] Opening hidden tab [${site}] → ${url}`);

      // Open as a background tab in the current window.
      // This prevents stealing OS focus or flashing windows on screen.
      const tab = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url, active: false }, (t) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(t);
        });
      });
      tabId = tab.id;

      if (!tabId) throw new Error('Failed to create hidden tab');

      await BackgroundTabExtractorService._waitForTabLoad(tabId, options.timeoutMs || 15000);

      // Inject stealth evasions immediately after load — patches webdriver flag, plugins,
      // visibility API, WebGL, etc. before React/Vue SPA scripts run their checks.
      try { await StealthEvasions.injectAll(tabId); } catch (_) {}

      // For sites with mouse/behavior tracking: simulate human interaction during renderWait.
      // Runs in parallel with the renderWait so it doesn't add extra time.
      if (HUMAN_SIM_SITES.has(site)) {
        HumanMouseSimulator.interact(tabId, { doClick: false, doScroll: true }).catch(() => {});
      }

      // Fast-Fail Polling: Instead of blind waiting, check extraction every 150ms.
      // Drops 2000-4000ms waits to ~150-300ms if the DOM is ready early (e.g. Brainly's safe_html_ucr).
      let text = '';
      if (extractor) {
        const pollIntervalMs = 150;
        const maxAttempts = Math.max(1, Math.floor(waitMs / pollIntervalMs));
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: extractor,
              world: 'MAIN'
            });
            const extracted = results?.[0]?.result || '';
            const attemptText = typeof extracted === 'string' ? extracted.trim() : '';
            
            if (attemptText.length > 50) {
              text = attemptText;
              console.log(`[AH-TAB] [FAST-FAIL] Extracted early on attempt ${attempt+1} (saved ~${waitMs - (attempt * pollIntervalMs)}ms)`);
              break;
            }
          } catch (err) {
             // ignore execution errors during polling
          }
          if (text) break;
          await new Promise(r => setTimeout(r, pollIntervalMs));
        }
      } else {
         // Generic sites with no specific extractor: just wait the flat render wait
         await new Promise(r => setTimeout(r, waitMs));
      }

      // Universal safety-net: if site-specific extractor returned nothing, grab raw body
      // textContent (not innerText) so we always get something even on bot-detection pages.
      if (!text) {
        try {
          const fallback = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              // Preserve math formulas: replace <math> with LaTeX source before extracting text
              const clone = document.body.cloneNode(true);
              clone.querySelectorAll('math').forEach(mathEl => {
                const ann = mathEl.querySelector('annotation[encoding="application/x-tex"]');
                const latex = ann?.textContent?.trim()
                  || mathEl.getAttribute('alttext')
                  || mathEl.textContent?.trim();
                if (latex) {
                  const ph = document.createTextNode(` $${latex}$ `);
                  mathEl.parentNode?.replaceChild(ph, mathEl);
                }
              });
              const tc = (clone.textContent || '').replace(/\s+/g, ' ').trim();
              return tc.length > 30 ? tc.slice(0, 15000) : '';
            },
            world: 'MAIN'
          });
          const fb = fallback?.[0]?.result || '';
          if (typeof fb === 'string' && fb.length > 30) {
            console.log(`[AH-TAB] [FALLBACK] textContent fallback: ${fb.length} chars from ${site}`);
            text = fb;
          }
        } catch (_) {}
      }

      console.log(`[AH-TAB] [OK] Extracted ${text.length} chars from ${site}`);
      return text || null;
    } catch (err) {
      console.warn(`[AH-TAB] [FAIL] Error extracting from ${site}:`, err?.message || err);
      return null;
    } finally {
      // Close the tab
      if (tabId !== null) { try { chrome.tabs.remove(tabId); } catch (_) {} }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  static _detectSite(url) {
    if (!url) return null;
    const u = url.toLowerCase();
    if (u.includes('brainly.com') || u.includes('brainly.com.br') ||
        u.includes('brainly.lat') || u.includes('brainly.co')) return 'brainly';
    if (u.includes('studocu.com')) return 'studocu';
    if (u.includes('passeidireto.com')) return 'passeidireto';
    if (u.includes('gauthmath.com')) return 'gauthmath';
    if (u.includes('meuguru.com')) return 'meuguru';
    if (u.includes('scribd.com')) return 'scribd';
    if (u.includes('slideshare.net')) return 'slideshare';
    return null;
  }

  static _getRenderWaitMs(site) {
    const waits = {
      brainly: 2000,  // safe_html_ucr is available early; paywall JS can't hide innerText
      studocu: 4000,
      passeidireto: 3000,
      gauthmath: 4000,
      meuguru: 2500,
      scribd: 3000,
      slideshare: 2500
    };
    // Generic/unknown sites get a short wait — just enough for basic JS to render
    return waits[site] || 2000;
  }

  static _getExtractor(site) {
    const map = {
      brainly:      BackgroundTabExtractorService._brainlyExtractor,
      studocu:      BackgroundTabExtractorService._studocuExtractor,
      passeidireto: BackgroundTabExtractorService._passeiDiretoExtractor,
      gauthmath:    BackgroundTabExtractorService._gauthmathExtractor,
      meuguru:      BackgroundTabExtractorService._meuguruExtractor,
      scribd:       BackgroundTabExtractorService._scribdExtractor,
      slideshare:   BackgroundTabExtractorService._genericExtractor
    };
    return map[site] || null;
  }

  static _waitForTabLoad(tabId, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeoutMs);
      function listener(id, changeInfo) {
        if (id === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  // ─── Site-specific extractors ─────────────────────────────────────────────
  // These run inside the page via executeScript (MAIN world).
  // No imports, no closures — fully self-contained.

  static _brainlyExtractor() {
    try {
      // Helper: get text preserving math formulas from <math> elements
      const getText = el => {
        if (!el) return '';
        const clone = el.cloneNode(true);
        clone.querySelectorAll('math').forEach(mathEl => {
          const ann = mathEl.querySelector('annotation[encoding="application/x-tex"]');
          const latex = ann?.textContent?.trim()
            || mathEl.getAttribute('alttext')
            || mathEl.textContent?.trim();
          if (latex) {
            const ph = document.createTextNode(` $${latex}$ `);
            mathEl.parentNode?.replaceChild(ph, mathEl);
          }
        });
        return (clone.innerText || clone.textContent || '').trim();
      };

      // Priority: safe_html_ucr contains question + answer text even when paywall
      // overlay is present — it's in the DOM but hidden by CSS blur/overlay.
      const ucr = document.querySelectorAll('[data-testid="safe_html_ucr"]');
      if (ucr.length > 0) {
        const parts = [];
        ucr.forEach(el => { const t = getText(el); if (t) parts.push(t); });
        if (parts.length > 0) return parts.join('\n\n');
      }

      const modalSelectors = [
        '[data-testid="modal-overlay"]', '[data-testid="login-modal"]',
        '[class*="LoginModal"]', '[class*="AuthModal"]',
        '[class*="SignupModal"]', '[class*="PaywallModal"]',
        '[class*="ModalOverlay"]', '[class*="modal-overlay"]',
        '[class*="AuthGate"]', '[class*="authGate"]',
        '.sg-modal__overlay', '#modal-root', '#login-modal'
      ];
      modalSelectors.forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );
      // Unlock scroll lock that login modals set
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      // Remove blur filters applied to content as paywall indicator
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none'; el.style.webkitFilter = 'none';
      });

      const parts = [];

      // Question selectors — updated for 2025/2026 Brainly DOM
      const qSelectors = [
        '[data-testid="question-text"]', '[data-testid="question-body"]',
        '[class*="QuestionContent"]', '[class*="QuestionText"]',
        '[class*="question-content"]', '[class*="questionText"]',
        '[class*="questionBody"]', '[class*="QuestionBody"]',
        '.brn-question-title', '.sg-text'
      ];
      let questionText = '';
      for (const sel of qSelectors) {
        const el = document.querySelector(sel);
        const t = getText(el);
        if (t.length > 20) { questionText = t; break; }
      }
      if (!questionText) {
        for (const h of document.querySelectorAll('h1,h2,h3')) {
          const t = getText(h);
          if (t.length > 20) { questionText = t; break; }
        }
      }
      if (questionText) parts.push('PERGUNTA: ' + questionText);

      // Answer selectors — updated for 2025/2026
      const ansSelectors = [
        '[data-testid="answer-content"]', '[data-testid="best-answer"]',
        '[data-testid="answer"]', '[data-testid="verified-answer"]',
        '[class*="BestAnswer"]', '[class*="AnswerContent"]',
        '[class*="AnswerText"]', '[class*="answerText"]',
        '[class*="answerContent"]', '[class*="answer-content"]',
        '.brn-answer', '[class*="ExpertAnswer"]'
      ];
      const answers = [];
      for (const sel of ansSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          const t = getText(el);
          if (t.length > 30 && !answers.includes(t)) answers.push(t);
        });
        if (answers.length > 0) break;
      }
      if (answers.length > 0) {
        parts.push('\nMELHOR RESPOSTA: ' + answers[0]);
        if (answers.length > 1) parts.push('\nOUTRAS RESPOSTAS:\n' + answers.slice(1, 3).join('\n\n'));
      }

      // JSON-LD structured data — Brainly embeds Q&A schema; reliable even behind paywalls
      const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map(s => s.textContent || '')
        .find(t => /Question|Answer|acceptedAnswer/i.test(t));
      if (ld && ld.length > 40) parts.push('\nJSON-LD: ' + ld.slice(0, 8000));

      // If structured selectors found nothing, grab full body as fallback
      if (parts.length === 0) {
        // Try textContent first (layout-independent) then innerText
        const body = (document.body?.textContent || document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        if (body.length > 30) return body.slice(0, 12000);
      }
      return parts.join('\n');
    } catch(e) { return (document.body?.textContent || '').trim().slice(0, 12000); }
  }

  static _studocuExtractor() {
    try {
      // Remove signup walls and modals first
      const noise = [
        '[class*="Modal"]' , '[class*="modal"]',
        '[class*="Overlay"]' , '[class*="overlay"]',
        '[class*="signup"]' , '[class*="Signup"]',
        '[class*="login"]' , '[class*="Login"]',
        '[class*="paywall"]' , '[class*="Paywall"]',
        '[class*="cookie-banner"]', '[id*="cookie"]'
      ];
      noise.forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );
      // Remove blur CSS from document content
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none';
        el.style.webkitFilter = 'none';
      });

      // Layer 1: PDF text layer nodes (.pc, .t are Studocu PDF viewer classes)
      const layerSels = [
        '.pc', '.t',
        '[class*="text-layer"]', '[class*="textLayer"]',
        '[class*="document-page"]', '[class*="viewer-page"]',
        '[data-testid*="page"]'
      ];
      const nodes = [];
      for (const sel of layerSels) document.querySelectorAll(sel).forEach(n => nodes.push(n));
      if (nodes.length > 0) {
        const txt = Array.from(new Set(nodes))
          .map(el => (el.innerText || el.textContent || '').trim())
          .filter(t => t.length > 0)
          .join('')
          .replace(/\s+/g, '')
          .trim();
        if (txt.length > 120) return txt.slice(0, 15000);
      }

      // Layer 2: Document containers
      const mainSels = [
        '[class*="document-content"]' , '[class*="documentContent"]',
        '[class*="qa-content"]' , '[class*="StudyResource"]',
        'article' , 'main', '.content'
      ];
      for (const sel of mainSels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const t = (el.innerText || el.textContent || '').trim();
        if (t.length > 120) return t.slice(0, 15000);
      }

      // Layer 3: Body fallback
      const body = (document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, '').trim();
      return body.length > 120 ? body.slice(0, 15000) : '';
    } catch(e) { return ''; }
  }

  static _scribdExtractor() {
    try {
      // Remove blur/paywall styles
      const blurSels = ['[class*="blur"]' , '[class*="Blur"]', '[class*="paywall"]', '[class*="Paywall"]'];
      blurSels.forEach(sel =>
        document.querySelectorAll(sel).forEach(el => {
          el.style.filter = 'none'; el.style.opacity = '1'; el.style.visibility = 'visible';
        })
      );
      const pageTexts = document.querySelectorAll('.text_layer, [class*="text-layer"], .page_text');
      if (pageTexts.length > 0) {
        return Array.from(pageTexts)
          .map(el => el.innerText || el.textContent || '')
          .join('')
          .replace(/\s+/g, '')
          .trim()
          .slice(0, 8000);
      }
      const main = document.querySelector('main, article, [class*="document"]')
      return main ? (main.innerText || '').trim().slice(0, 8000) : '';
    } catch(e) { return ''; }
  }

  static _gauthmathExtractor() {
    try {
      // Remove overlays/modals
      ['[class*="modal"]' , '[class*="Modal"]',
       '[class*="overlay"]', '[class*="Overlay"]',
       '[class*="paywall"]', '[class*="Paywall"]',
       '[class*="cookie"]' , '[class*="Cookie"]'
      ].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );

      // JSON-LD structured data (most reliable)
      const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map(s => s.textContent || '')
        .find(t => /Question|Answer|acceptedAnswer|suggestedAnswer/i.test(t));
      if (ld?.length > 30) return ld.slice(0, 12000);

      // Content containers
      const sels = ['[class*="question"]', '[class*="solution"]', '[class*="answer"]', '[class*="content"]', 'article', 'main'];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, '').trim();
        if (t.length > 120) return t.slice(0, 12000);
      }
      const body = (document.body?.innerText || '').replace(/\s+/g, '').trim();
      return body.length > 120 ? body.slice(0, 12000) : '';
    } catch(e) { return ''; }
  }

  static _meuguruExtractor() {
    try {
      // Remove overlays/modals/paywall
      ['[class*="modal"]', '[class*="Modal"]', '[class*="overlay"]', '[class*="Overlay"]',
       '[class*="paywall"]', '[class*="Paywall"]', '[class*="cookie"]', '[class*="login"]'
      ].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );
      // Remove blur CSS
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none'; el.style.webkitFilter = 'none';
      });

      // Priority 1: JSON-LD structured data
      const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map(s => s.textContent || '')
        .find(t => /Question|Answer|acceptedAnswer|suggestedAnswer/i.test(t));
      if (ld?.length > 30) return ld.slice(0, 12000);

      // Priority 2: answer/gabarito containers
      const sels = [
        '[class*="answer"]', '[class*="Answer"]', '[class*="resposta"]', '[class*="gabarito"]',
        '[class*="question"]', '[class*="Question"]', '[class*="solution"]',
        '[class*="content"]', '[class*="Content"]', 'article', 'main'
      ];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length > 120) return t.slice(0, 12000);
      }
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      return body.length > 120 ? body.slice(0, 12000) : '';
    } catch(e) { return ''; }
  }

  static _genericExtractor() {
    try {
      ['[class*="modal"]' , '[class*="Modal"]',
       '[class*="overlay"]', '[class*="Overlay"]',
       '[class*="paywall"]', '[class*="Paywall"]',
       'nav' , 'header', 'footer',
       '[class*="cookie"]' , '[class*="Cookie"]',
       '[class*="banner"]' , '[class*="Banner"]'
      ].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );
      const sels = [
        'article' , 'main',
        '[class*="content"]' , '[class*="Content"]',
        '[class*="question"]' , '[class*="Question"]',
        '[class*="exercise"]' , '[class*="Exercise"]'
      ];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el) {
          const t = (el.innerText || el.textContent || '').trim();
          if (t.length > 200) return t.slice(0, 8000);
        }
      }
      return (document.body?.innerText || document.body?.textContent || '').trim().slice(0, 8000);
    } catch(e) { return ''; }
  }

  static _passeiDiretoExtractor() {
    try {
      // Helper: get text preserving math formulas
      const getText = el => {
        if (!el) return '';
        const clone = el.cloneNode(true);
        clone.querySelectorAll('math').forEach(mathEl => {
          const ann = mathEl.querySelector('annotation[encoding="application/x-tex"]');
          const latex = ann?.textContent?.trim()
            || mathEl.getAttribute('alttext')
            || mathEl.textContent?.trim();
          if (latex) {
            const ph = document.createTextNode(` $${latex}$ `);
            mathEl.parentNode?.replaceChild(ph, mathEl);
          }
        });
        return (clone.innerText || clone.textContent || '').trim();
      };

      // Remove blur CSS (PD blurs paid content via CSS filter)
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none'; el.style.webkitFilter = 'none';
      });
      // Remove ONLY overlays/modals — NOT nav/header/footer (breadcrumbs are useful)
      ['[class*="modal"]', '[class*="Modal"]', '[class*="overlay"]', '[class*="Overlay"]',
       '[class*="paywall"]', '[class*="login"]', '[class*="cookie"]'
      ].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );

      const parts = [];

      // Priority 1: __NEXT_DATA__ — SSR JSON with full question + answer data (most reliable)
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      const nextRaw = nextDataEl?.textContent || '';
      if (nextRaw.length > 100) {
        // Try to extract just the readable text from the JSON instead of the whole blob
        try {
          const parsed = JSON.parse(nextRaw);
          // Walk the object looking for long text strings (question/answer bodies)
          const texts = [];
          const walk = (obj, depth = 0) => {
            if (depth > 10 || !obj) return;
            if (typeof obj === 'string' && obj.length > 30) texts.push(obj);
            else if (typeof obj === 'object') Object.values(obj).forEach(v => walk(v, depth + 1));
          };
          walk(parsed);
          const joined = [...new Set(texts)].join('\n');
          if (joined.length > 100) parts.push(joined.slice(0, 50000));
          else parts.push(nextRaw.slice(0, 20000)); // JSON too nested — push raw
        } catch (_) {
          parts.push(nextRaw.slice(0, 20000));
        }
      }

      // Priority 2: answer/gabarito semantic sections
      ['[class*="answer"]', '[class*="Answer"]', '[class*="resposta"]', '[class*="gabarito"]',
       '[class*="correct"]', '[class*="alternativa"]', '[class*="solution"]',
       '[data-testid*="answer"]', '[data-testid*="question"]'
      ].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => {
          const t = getText(el);
          if (t.length > 20) parts.push(t);
        })
      );

      // Priority 3: main content containers
      for (const sel of ['main', 'article', '[class*="content"]', '[class*="question"]', '#__next']) {
        const el = document.querySelector(sel);
        const t = getText(el);
        if (t.length > 100) { parts.push(t); break; }
      }

      // Ultimate fallback: textContent (layout-independent — works even in narrow viewports)
      if (parts.length === 0) {
        const body = (document.body?.textContent || document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        if (body.length > 30) parts.push(body);
      }

      return [...new Set(parts)].join('\n\n').slice(0, 100000) || '';
    } catch(e) { return (document.body?.textContent || '').trim().slice(0, 15000); }
  }
}

