/**
 * BackgroundTabExtractorService.js
 *
 * Opens a hidden Chrome tab, waits for full JS rendering, injects
 * site-specific bypass scripts to remove paywall CSS and extract
 * readable text. Works for Studocu, PasseiDireto and other JS-heavy SPAs.
 *
 * Requires manifest permissions: "tabs", "scripting", "<all_urls>"
 */

// ---------------------------------------------------------------------------
// Site-specific extractor functions (injected into real tab via executeScript)
// These run in the PAGE context, NOT in the extension context.
// ---------------------------------------------------------------------------

function _studocuExtractor() {
    try {
        // 1. Override ALL blur/filter CSS globally
        const style = document.createElement('style');
        style.id = '__ah_bypass__';
        style.textContent = [
            '* { filter: none !important; -webkit-filter: none !important; }',
            '.blurred-container { display: block !important; opacity: 1 !important; }',
            'div[data-page-index], .pc, .bi, img.bi { opacity: 1 !important; visibility: visible !important; }']
            .join('  ');
        document.head.appendChild(style);

        // 2. Remove paywall/upgrade overlays
        ['#upgrade-overlay', '.banner-wrapper',
         '[class*="paywall"]', '[class*="blur-overlay"]',
         '[class*="premium"]', '[data-testid*="paywall"]',
         '[class*="Paywall"]', '[class*="Premium"]',
         '[class*="blurred"]', '.content-lock', '.content-blur']
        .forEach(sel => {
            try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch(e) {}
        });

        // 3. Unblur images — remove /blurred/ from src (isanchop/stuhack technique)
        document.querySelectorAll('img[src*="/blurred/"], .blurred-container img').forEach(img => {
            try {
                img.src = img.src.replace('/blurred/', '/');
                img.parentElement?.classList.remove('blurred-container');
            } catch(e) {}
        });

        // 4. Remove inline filter styles
        document.querySelectorAll('[style*="filter"]').forEach(el => {
            try {
                el.style.removeProperty('filter');
                el.style.removeProperty('-webkit-filter');
            } catch(e) {}
        });

        // 5. Extract text from PDF-like page layers (.pc = text layer over images)
        const pages = document.querySelectorAll('div[data-page-index]');
        if (pages.length > 0) {
            const text = Array.from(pages)
                .map(p => (p.querySelector('.pc') || p).innerText || '')
                .filter(Boolean)
                .join('\n\n');
            if (text.length > 200) return text.substring(0, 15000);
        }

        // 6. Fallback — whole body text
        return (document.body?.innerText || '').substring(0, 15000);
    } catch(e) { return ''; }
}

function _passeiDiretoExtractor() {
    try {
        // 1. Remove inline filter/blur styles (non-destructive — preserves React)
        document.querySelectorAll('[style*="filter"]').forEach(el => {
            try { el.removeAttribute('style'); } catch(e) {}
        });

        // 2. Remove paywall overlays
        ['  .mv-content-limitation-fake-page',
         '.mv-content-limitation-fake-page.short-preview-version',
         '[class*="RegisterBanner"]',
         '[class*="paywall"]', '[class*="Paywall"]',
         '[class*="blur-overlay"]',
         '.limitation-blocked']
        .forEach(sel => {
            try { document.querySelectorAll(sel.trim()).forEach(el => el.remove()); } catch(e) {}
        });

        // Hashed class banner (Alphka/Blur-Bypasser technique)
        const bannerRe = /BannerSelector_banner-container/;
        document.querySelectorAll('*').forEach(el => {
            try {
                if (Array.from(el.classList || []).some(c => bannerRe.test(c))) el.remove();
            } catch(e) {}
        });

        // 3. Main text container (rafaelsorgato technique — reveals #text-inner-content)
        const main = document.getElementById('text-inner-content');
        if (main) {
            main.removeAttribute('style');
            const txt = main.innerText.trim();
            if (txt.length > 200) return txt.substring(0, 15000);
        }

        // 4. Document viewer
        const viewer = document.querySelector(
            '.document-viewer, .mv-file-container, .document-fragment, #file-viewer');
        if (viewer) {
            const txt = viewer.innerText.trim();
            if (txt.length > 200) return txt.substring(0, 15000);
        }

        // 5. Answers frame (for /pergunta/ pages)
        const answers = document.querySelector('.mv-answers-frame, .answers-text');
        if (answers) {
            const txt = answers.innerText.trim();
            if (txt.length > 50) return txt.substring(0, 15000);
        }

        // 6. Fallback
        return (document.body?.innerText || '').substring(0, 15000);
    } catch(e) { return ''; }
}


function _brainlyExtractor() {
    try {
        // 1. Remove login/signup modals and overlays (content is in DOM even when modal shows)
        [
            '[data-testid="modal-overlay"]',
            '[data-testid="login-modal"]',
            '[class*="LoginModal"]',
            '[class*="SignupModal"]',
            '[class*="AuthModal"]',
            '[class*="login-modal"]',
            '[class*="registration-modal"]',
            '.js-react-on-rails-component',
            '[class*="modal-backdrop"]',
            '[class*="Modal__overlay"]',
            '[class*="overlay--"]',
            '[data-testid="overlay"]'
        ].forEach(sel => {
            try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch(e) {}
        });

        // 2. Remove blur/opacity on content
        document.querySelectorAll('[style*="filter"], [style*="blur"], [style*="opacity: 0"]').forEach(el => {
            try { el.removeAttribute('style'); } catch(e) {}
        });

        // 3. Try structured extraction of question + best answer
        const parts = [];

        // Question heading
        const qSelectors = [
            '[aria-label="Pergunta"]',
            '[data-testid="question-title"]',
            '[class*="QuestionHeader"] h1',
            '[class*="question-header"] h1',
            '.brn-question__heading',
            'h1[class*="Text"]'
        ];
        for (const sel of qSelectors) {
            try {
                const el = document.querySelector(sel);
                if (el && el.innerText.trim().length > 10) {
                    parts.push('PERGUNTA: ' + el.innerText.trim());
                    break;
                }
            } catch(e) {}
        }

        // Answers
        const aSelectors = [
            '[data-testid="answer-card"]',
            '[aria-label*="Resposta"]',
            '[aria-label*="resposta"]',
            '[class*="AnswerCard"]',
            '[class*="answer-card"]',
            '.brn-answer__content',
            '[class*="BestAnswer"]',
            '[class*="best-answer"]'
        ];
        let foundAnswers = false;
        for (const sel of aSelectors) {
            try {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) {
                    els.forEach((el, i) => {
                        const txt = el.innerText.trim();
                        if (txt.length > 20) {
                            parts.push((i === 0 ? 'MELHOR RESPOSTA: ' : 'RESPOSTA ' + (i+1) + ': ') + txt.substring(0, 3000));
                            foundAnswers = true;
                        }
                    });
                    break;
                }
            } catch(e) {}
        }

        if (parts.length > 0) {
            const result = parts.join('\n\n');
            if (result.length > 100) return result.substring(0, 15000);
        }

        // 4. Fallback — whole page text (covers edge cases)
        const bodyText = (document.body?.innerText || '').substring(0, 15000);
        return bodyText.length > 100 ? bodyText : null;
    } catch(e) { return null; }
}

function _genericExtractor() {
    try {
        document.querySelectorAll('[class*="paywall"], [class*="overlay"]').forEach(el => {
            try { el.remove(); } catch(e) {}
        });
        return (document.body?.innerText || '').substring(0, 15000);
    } catch(e) { return ''; }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const BackgroundTabExtractorService = {

    _detectSite(url) {
        try {
            const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
            if (host.includes('studocu.com')) return 'studocu';
            if (host.includes('passeidireto.com')) return 'passeidireto';
            if (host.includes('brainly.com') || host.includes('brainly.lat')) return 'brainly';
            return 'generic';
        } catch { return 'generic'; }
    },

    _getExtractor(site) {
        if (site === 'studocu')      return _studocuExtractor;
        if (site === 'passeidireto') return _passeiDiretoExtractor;
        if (site === 'brainly')      return _brainlyExtractor;
        return _genericExtractor;
    },

    /**
     * Opens a hidden tab, waits for JS render, injects extractor, returns text.
     * @param {string} url
     * @param {object} opts
     * @param {number} opts.timeoutMs      Total timeout (default 15000ms)
     * @param {number} opts.renderWaitMs   Extra JS-render wait after load (default 2000ms)
     * @param {string} opts.siteHint       Override site detection
     * @returns {Promise<string|null>}
     */
    extractViaTab(url, opts = {}) {
        const { timeoutMs = 15000, renderWaitMs = 2000, siteHint = null } = opts;

        return new Promise((resolve) => {
            let tabId       = null;
            let resolved    = false;
            let updateListener = null;

            const finish = (result) => {
                if (resolved) return;
                resolved = true;
                if (updateListener) {
                    try { chrome.tabs.onUpdated.removeListener(updateListener); } catch(e) {}
                }
                if (tabId !== null) {
                    try { chrome.tabs.remove(tabId); } catch(e) {}
                }
                resolve(result);
            };

            const timer = setTimeout(() => {
                console.warn(`[AH-TAB] Timeout (${timeoutMs}ms): ${url}`);
                finish(null);
            }, timeoutMs);

            const timedFinish = (r) => { clearTimeout(timer); finish(r); };

            (async () => {
                try {
                    if (typeof chrome === 'undefined' || !chrome?.tabs?.create) {
                        console.warn('[AH-TAB] chrome.tabs not available');
                        timedFinish(null);
                        return;
                    }

                    const site        = siteHint || this._detectSite(url);
                    const extractorFn = this._getExtractor(site);

                    console.log(`[AH-TAB] Opening hidden tab [${site}] → ${url}`);

                    const tab = await chrome.tabs.create({ url, active: false, pinned: false });
                    tabId = tab.id;

                    updateListener = async (id, changeInfo) => {
                        if (id !== tabId || changeInfo.status !== 'complete') return;
                        chrome.tabs.onUpdated.removeListener(updateListener);
                        updateListener = null;

                        // Wait for JS frameworks to finish rendering
                        await new Promise(r => setTimeout(r, renderWaitMs));

                        try {
                            const results = await chrome.scripting.executeScript({
                                target: { tabId, allFrames: false },
                                func: extractorFn
                            });
                            const extracted = results?.[0]?.result;
                            if (extracted && typeof extracted === 'string' && extracted.length > 100) {
                                console.log(`[AH-TAB] ✅ Extracted ${extracted.length} chars from ${site}`);
                                timedFinish(extracted);
                            } else {
                                console.log(`[AH-TAB] ⚠️ Content too short (${(extracted||''  ).length} chars)`);
                                timedFinish(null);
                            }
                        } catch (e) {
                            console.error('[AH-TAB] executeScript failed:', e);
                            timedFinish(null);
                        }
                    };

                    chrome.tabs.onUpdated.addListener(updateListener);

                } catch (e) {
                    console.error('[AH-TAB] Tab creation failed:', e);
                    timedFinish(null);
                }
            })();
        });
    },

    /**
     * Is this URL a known JS-heavy SPA that benefits from tab extraction?
     */
    isJsHeavySpa(url) {
        try {
            const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
            return host.includes('studocu.com') ||
                   host.includes('passeidireto.com') ||
                   host.includes('scribd.com') ||
                   host.includes('brainly.com') ||
                   host.includes('brainly.lat');
        } catch { return false; }
    }
};
