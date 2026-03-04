
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
const CF_PROTECTED_SITES = new Set(['studocu', 'gauthmath']);

// Sites with heavy behavior analysis (mouse tracking, scroll detection) — use HumanMouseSimulator
const HUMAN_SIM_SITES = new Set(['brainly', 'scribd']);

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
    const site = BackgroundTabExtractorService._detectSite(url);
    if (!site) return null;
    const extractor = BackgroundTabExtractorService._getExtractor(site);
    if (!extractor) return null;

    // Route CF-protected sites through full bypass pipeline
    if (CF_PROTECTED_SITES.has(site)) {
      return BackgroundTabExtractorService._extractWithCFBypass(url, site, extractor, options);
    }

    // Standard extraction for non-CF sites
    return BackgroundTabExtractorService._extractStandard(url, site, extractor, options);
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

      // Open as a tiny off-screen popup — invisible to user, doesn't pollute tab bar.
      // state:'minimized' is not valid in chrome.windows.create (causes "Invalid value for state").
      // We position it off-screen at (-9999,-9999) and immediately minimize via windows.update.
      const win = await new Promise((resolve, reject) => {
        chrome.windows.create({ url, type: 'popup', focused: false, left: -9999, top: -9999, width: 1, height: 1 }, (w) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(w);
        });
      });
      winId = win?.id ?? null;
      tabId = win?.tabs?.[0]?.id ?? null;
      // Force minimized state — chrome.windows.create ignores the state param reliably
      if (winId !== null) { try { chrome.windows.update(winId, { state: 'minimized' }); } catch (_) {} }

      if (!tabId) throw new Error('Failed to create hidden window/tab');

      await BackgroundTabExtractorService._waitForTabLoad(tabId, options.timeoutMs || 15000);

      // Inject stealth evasions immediately after load — patches webdriver flag, plugins,
      // visibility API, WebGL, etc. before React/Vue SPA scripts run their checks.
      try { await StealthEvasions.injectAll(tabId); } catch (_) {}

      // For sites with mouse/behavior tracking: simulate human interaction during renderWait.
      // Runs in parallel with the renderWait so it doesn't add extra time.
      if (HUMAN_SIM_SITES.has(site)) {
        HumanMouseSimulator.interact(tabId, { doClick: false, doScroll: true }).catch(() => {});
      }

      await new Promise(r => setTimeout(r, waitMs));
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractor,
        world: 'MAIN'
      });
      const extracted = results?.[0]?.result || '';
      const text = typeof extracted === 'string' ? extracted.trim() : '';
      console.log(`[AH-TAB] [OK] Extracted ${text.length} chars from ${site}`);
      return text || null;
    } catch (err) {
      console.warn(`[AH-TAB] [FAIL] Error extracting from ${site}:`, err?.message || err);
      return null;
    } finally {
      // Close the window (removes the tab too)
      if (winId !== null) { try { chrome.windows.remove(winId); } catch (_) {} }
      else if (tabId !== null) { try { chrome.tabs.remove(tabId); } catch (_) {} }
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
    if (u.includes('scribd.com')) return 'scribd';
    if (u.includes('slideshare.net')) return 'slideshare';
    return null;
  }

  static _getRenderWaitMs(site) {
    const waits = {
      // PasseiDireto uses Next.js SSR — content is in the initial HTML, no JS wait needed
      brainly: 3500, studocu: 4500, passeidireto: 400,
      gauthmath: 4500, scribd: 3000, slideshare: 2500
    };
    return waits[site] || 3000;
  }

  static _getExtractor(site) {
    const map = {
      brainly:      BackgroundTabExtractorService._brainlyExtractor,
      studocu:      BackgroundTabExtractorService._studocuExtractor,
      passeidireto: BackgroundTabExtractorService._passeiDiretoExtractor,
      gauthmath:    BackgroundTabExtractorService._gauthmathExtractor,
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
      const modalSelectors = [
        '[data-testid="modal-overlay"]' , '[data-testid="login-modal"]'  ,
        '[class*="LoginModal"]' , '[class*="AuthModal"]' ,
        '[class*="SignupModal"]' , '[class*="PaywallModal"]',
        '.sg-modal__overlay' , '#modal-root'
      ];
      modalSelectors.forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      const parts = [];
      const qSelectors = [
        '[data-testid="question-text"]' , '[class*="QuestionContent"]',
        '[class*="question-content"]' , '.brn-question-title',
        '[class*="questionText"]'
      ];
      let questionText = '';
      for (const sel of qSelectors) {
        const el = document.querySelector(sel);
        if (el?.innerText?.length > 20) { questionText = el.innerText.trim(); break; }
      }
      if (!questionText) { const h = document.querySelector('h1,h2'); if (h) questionText = h.innerText.trim(); }
      if (questionText) parts.push('PERGUNTA: ' + questionText);
      const ansSelectors = [
        '[data-testid="answer-content"]' , '[class*="BestAnswer"]',
        '[data-testid="best-answer"]' , '[class*="AnswerContent"]',
        '.brn-answer'
      ];
      const answers = [];
      for (const sel of ansSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          const t = el.innerText?.trim();
          if (t && t.length > 30 && !answers.includes(t)) answers.push(t);
        });
        if (answers.length > 0) break;
      }
      if (answers.length > 0) {
        parts.push('\nMELHOR RESPOSTA: ' + answers[0]);
        if (answers.length > 1) parts.push('\nOUTRAS RESPOSTAS:\n' + answers.slice(1, 3).join('\n\n'));
      }
      return parts.join('\n');
    } catch(e) { return ''; }
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
      // Remove blur CSS (PD blurs paid content via CSS)
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none'; el.style.webkitFilter = 'none';
      });
      // Remove overlays, modals, nav noise
      ['[class*="modal"]', '[class*="Modal"]', '[class*="overlay"]', '[class*="Overlay"]',
       '[class*="paywall"]', '[class*="login"]', '[class*="cookie"]',
       'nav', 'header', 'footer'
      ].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );
      const parts = [];
      // Include __NEXT_DATA__ JSON: PasseiDiretoAnswersApiService uses it to find question IDs
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl?.textContent?.length > 100) parts.push(nextDataEl.textContent);
      // Prioritize answer/gabarito sections
      ['[class*="answer"]', '[class*="Answer"]', '[class*="resposta"]', '[class*="gabarito"]',
       '[class*="correct"]', '[class*="alternativa"]', '[class*="solution"]'
      ].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => {
          const t = (el.innerText || '').trim();
          if (t.length > 20) parts.push(t);
        })
      );
      // Main content
      for (const sel of ['main', 'article', '[class*="content"]', '[class*="question"]']) {
        const el = document.querySelector(sel);
        if (el) {
          const t = (el.innerText || '').trim();
          if (t.length > 200) { parts.push(t); break; }
        }
      }
      if (parts.length === 0) parts.push((document.body?.innerText || '').trim());
      return [...new Set(parts)].join('\n\n').slice(0, 100000);
    } catch(e) { return ''; }
  }
}
