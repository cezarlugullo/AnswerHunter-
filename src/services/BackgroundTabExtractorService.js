
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

// Sites protected by Cloudflare Bot Management / Akamai — use full bypass pipeline
const CF_PROTECTED_SITES = new Set(['studocu', 'gauthmath']);

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
    console.log(`[AH-TAB] 🛡️ CF-bypass pipeline for [${site}] → ${url}`);
    try {
      const result = await CloudflareBypassService.extract(url, extractor, {
        challengeTimeoutMs: options.timeoutMs || 35000,
        loadTimeoutMs:      options.timeoutMs || 38000,
      });
      const text = result?.text || '';
      if (text.length > 100) {
        console.log(`[AH-TAB] ✅ CF-bypass extracted ${text.length} chars from ${site} (method=${result.method})`);
        return text;
      }
      console.warn(`[AH-TAB] ⚠️ CF-bypass returned empty for ${site} — falling through`);
      return null;
    } catch (err) {
      console.warn(`[AH-TAB] ❌ CF-bypass error for ${site}:`, err?.message || err);
      return null;
    }
  }

  /**
   * Standard background tab extraction (no CF bypass).
   * Used for Brainly, PasseiDireto, Scribd, Slideshare.
   */
  static async _extractStandard(url, site, extractor, options = {}) {
    const waitMs = options.renderWaitMs != null
      ? options.renderWaitMs
      : BackgroundTabExtractorService._getRenderWaitMs(site);
    let tabId = null;
    try {
      console.log(`[AH-TAB] Opening hidden tab [${site}] → ${url}`);
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;
      await BackgroundTabExtractorService._waitForTabLoad(tabId, options.timeoutMs || 15000);
      await new Promise(r => setTimeout(r, waitMs));
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractor,
        world: 'MAIN'
      });
      const extracted = results?.[0]?.result || '';
      const text = typeof extracted === 'string' ? extracted.trim() : '';
      console.log(`[AH-TAB] ✅ Extracted ${text.length} chars from ${site}`);
      return text || null;
    } catch (err) {
      console.warn(`[AH-TAB] ❌ Error extracting from ${site}:`, err?.message || err);
      return null;
    } finally {
      if (tabId !== null) { try { chrome.tabs.remove(tabId); } catch (_) {} }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  static _detectSite(url) {
    if (!url) return null;
    const u = url.toLowerCase();
    if (u.includes('brainly.com') || u.includes('brainly.com.br') ||
        u.includes('brainly.lat') || u.includes('brainly.co')) return 'brainly';
    if (u.includes('studocu.com'))      return 'studocu';
    if (u.includes('passeidireto.com')) return 'passeidireto';
    if (u.includes('gauthmath.com'))    return 'gauthmath';
    if (u.includes('scribd.com'))       return 'scribd';
    if (u.includes('slideshare.net'))   return 'slideshare';
    return null;
  }

  static _getRenderWaitMs(site) {
    const waits = {
      brainly: 3500, studocu: 4500, passeidireto: 3000,
      gauthmath: 4500, scribd: 3000, slideshare: 2500
    };
    return waits[site] || 3000;
  }

  static _getExtractor(site) {
    const map = {
      brainly:      BackgroundTabExtractorService._brainlyExtractor,
      studocu:      BackgroundTabExtractorService._studocuExtractor,
      passeidireto: BackgroundTabExtractorService._genericExtractor,
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
        '[data-testid="modal-overlay"]'  , '[data-testid="login-modal"]'  ,
        '[class*="LoginModal"]'          , '[class*="AuthModal"]' ,
        '[class*="SignupModal"]'         , '[class*="PaywallModal"]',
        '.sg-modal__overlay'            , '#modal-root'
      ];
      modalSelectors.forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      const parts = [];
      const qSelectors = [
        '[data-testid="question-text"]'     , '[class*="QuestionContent"]',
        '[class*="question-content"]'       , '.brn-question-title',
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
        '[data-testid="answer-content"]'   , '[class*="BestAnswer"]',
        '[data-testid="best-answer"]'       , '[class*="AnswerContent"]',
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
        '[class*="Modal"]'        , '[class*="modal"]',
        '[class*="Overlay"]'      , '[class*="overlay"]',
        '[class*="signup"]'       , '[class*="Signup"]',
        '[class*="login"]'        , '[class*="Login"]',
        '[class*="paywall"]'      , '[class*="Paywall"]',
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
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (txt.length > 120) return txt.slice(0, 15000);
      }

      // Layer 2: Document containers
      const mainSels = [
        '[class*="document-content"]'  , '[class*="documentContent"]',
        '[class*="qa-content"]'         , '[class*="StudyResource"]',
        'article'                       , 'main', '.content'
      ];
      for (const sel of mainSels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const t = (el.innerText || el.textContent || '').trim();
        if (t.length > 120) return t.slice(0, 15000);
      }

      // Layer 3: Body fallback
      const body = (document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ').trim();
      return body.length > 120 ? body.slice(0, 15000) : '';
    } catch(e) { return ''; }
  }

  static _scribdExtractor() {
    try {
      // Remove blur/paywall styles
      const blurSels = ['[class*="blur"]'  , '[class*="Blur"]', '[class*="paywall"]', '[class*="Paywall"]'];
      blurSels.forEach(sel =>
        document.querySelectorAll(sel).forEach(el => {
          el.style.filter = 'none'; el.style.opacity = '1'; el.style.visibility = 'visible';
        })
      );
      const pageTexts = document.querySelectorAll('.text_layer, [class*="text-layer"], .page_text');
      if (pageTexts.length > 0) {
        return Array.from(pageTexts)
          .map(el => el.innerText || el.textContent || '')
          .join(' ')
          .replace(/\s+/g, ' ')
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
      ['[class*="modal"]'  , '[class*="Modal"]',
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
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length > 120) return t.slice(0, 12000);
      }
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      return body.length > 120 ? body.slice(0, 12000) : '';
    } catch(e) { return ''; }
  }

  static _genericExtractor() {
    try {
      ['[class*="modal"]'  , '[class*="Modal"]',
       '[class*="overlay"]', '[class*="Overlay"]',
       '[class*="paywall"]', '[class*="Paywall"]',
       'nav'               , 'header', 'footer',
       '[class*="cookie"]' , '[class*="Cookie"]',
       '[class*="banner"]' , '[class*="Banner"]'
      ].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(_) {} })
      );
      const sels = [
        'article'              , 'main',
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
}
