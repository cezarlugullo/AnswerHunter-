/**
 * CloudflareBypassService.js
 *
 * Native Cloudflare bypass for Chrome MV3 extensions.
 * No backend required. Pure JavaScript.
 *
 * KEY INSIGHT vs previous version:
 *   The old version injected patches at 493ms — TOO LATE.
 *   Cloudflare challenge JS runs at document_start (< 50ms).
 *   This version hooks chrome.tabs.onUpdated 'loading' event
 *   to inject patches as soon as the document begins loading.
 *
 * STRATEGY (4 layers):
 *   Layer 1 — Cookie Reuse     : reuses cf_clearance from existing user sessions
 *   Layer 2 — Early Injection  : patches injected at document_start via onUpdated('loading')
 *   Layer 3 — Challenge Await  : waits for Chrome to auto-resolve CF challenges
 *   Layer 4 — Human Simulation : Bezier mouse curves + scroll + focus events
 *
 * @license MIT
 * @version 2.0.0
 */

export class CloudflareBypassService {

  static CONFIG = {
    minHumanDelayMs:      700,
    maxHumanDelayMs:      2200,
    challengeTimeoutMs:   32000,   // 32s — CF managed challenge can take up to 20s
    earlyInjectIntervalMs: 50,     // poll every 50ms during loading phase
    earlyInjectWindowMs:  3000,    // inject window: first 3s of load
    loadTimeoutMs:        35000,
    maxExtractedChars:    15000,
  };

  // ─── Public API ───────────────────────────────────────────────────────────

  static async extract(url, extractorFn, options = {}) {
    const cfg  = { ...CloudflareBypassService.CONFIG, ...options };
    const site = CloudflareBypassService._parseSite(url);
    let   tabId = null;
    let   _winId = null;

    try {
      // LAYER 1: reuse existing cf_clearance if available
      const cookieHit = await CloudflareBypassService._tryExistingCookies(url, site, extractorFn, cfg);
      if (cookieHit) {
        console.log(`[CF-BYPASS] [OK] Cookie reuse success for ${site}`);
        return { text: cookieHit, method: 'cookie-reuse', cookieReused: true };
      }

      // LAYER 2 + 3 + 4: open stealth tab with early injection
      console.log(`[CF-BYPASS] Opening stealth tab for ${site}`);
      const opened = await CloudflareBypassService._openAndInjectEarly(url, site, cfg);
      tabId  = opened?.tabId  ?? null;
      _winId = opened?.winId  ?? null;

      if (!tabId) {
        return { text: '', method: 'failed', cookieReused: false };
      }

      // Wait for challenge resolution
      const resolved = await CloudflareBypassService._waitForResolution(tabId, cfg);
      if (!resolved) {
        console.warn(`[CF-BYPASS] [WARN] Challenge not resolved in time for ${site}`);
      }

      // LAYER 4: human behavior + extra wait for React/SPA rendering
      await CloudflareBypassService._simulateHuman(tabId, cfg);
      // Extra wait: SPAs like Studocu continue rendering after status=complete
      await new Promise(r => setTimeout(r, 1200));

      // Extract content
      const text = await CloudflareBypassService._runExtractor(tabId, extractorFn);

      // Harvest cookies for next time
      await CloudflareBypassService._harvestCookies(tabId, site);

      if (text && text.length > 80) {
        console.log(`[CF-BYPASS] [OK] Tab extraction success: ${text.length} chars (method=tab-stealth-early)`);
        return { text, method: 'tab-stealth-early', cookieReused: false };
      }

      return { text: '', method: 'failed', cookieReused: false };

    } catch (err) {
      console.error(`[CF-BYPASS] [FAIL] Error:`, err?.message || err);
      return { text: '', method: 'error', cookieReused: false };
    } finally {
      // Close the minimized popup window (not just the tab) if we have a winId.
      if (_winId !== null) {
        try { chrome.windows.remove(_winId); } catch (_) {}
      } else if (tabId !== null) {
        try { chrome.tabs.remove(tabId); } catch (_) {}
      }
    }
  }

  // ─── Layer 1: Cookie Reuse ────────────────────────────────────────────────

  static async _tryExistingCookies(url, site, extractorFn, cfg) {
    try {
      // Check chrome.cookies API for cf_clearance
      const cfCookie = await chrome.cookies.get({ url, name: 'cf_clearance' }).catch(() => null);
      const bfCookie = await chrome.cookies.get({ url, name: '__cf_bm' }).catch(() => null);

      if (!cfCookie && !bfCookie) return null;

      console.log(`[CF-BYPASS] Found existing cf_clearance for ${site} — trying direct tab`);

      // Already have clearance — open minimized popup window and extract directly.
      // NOTE: chrome.windows.create ignores state:'minimized' — must call windows.update after.
      const win = await chrome.windows.create({ url, type: 'popup', state: 'minimized', focused: false, left: -9999, top: -9999, width: 1, height: 1 });
      const tid = win?.tabs?.[0]?.id;
      if (!tid) return null;
      try { chrome.windows.update(win.id, { state: 'minimized' }); } catch (_) {}

      // Still inject stealth patches even with clearance (for good measure)
      await CloudflareBypassService._earlyPatchLoop(tid, cfg.earlyInjectWindowMs);
      await CloudflareBypassService._waitForTabComplete(tid, cfg.loadTimeoutMs);
      await new Promise(r => setTimeout(r, CloudflareBypassService._humanDelay(cfg)));

      const text = await CloudflareBypassService._runExtractor(tid, extractorFn);
      try { chrome.windows.remove(win.id); } catch (_) {}
      return text && text.length > 80 ? text : null;
    } catch (_) {
      return null;
    }
  }

  // ─── Layer 2: Early Injection via onUpdated ───────────────────────────────

  /**
   * Opens the tab AND immediately starts a rapid-fire injection loop
   * triggered by onUpdated 'loading' events.
   *
   * This is the key improvement: we hook 'loading' state (document_start equivalent)
   * instead of waiting for 'complete'.
   */
  static async _openAndInjectEarly(url, site, cfg) {
    return new Promise(async (resolve) => {
      let tabId = null;
      let winId  = null;
      let patchCount = 0;
      const maxPatches = 8;  // inject up to 8 times during loading
      let resolved = false;

      // Listener for early injection on 'loading' events
      const earlyListener = async (tid, changeInfo) => {
        if (tid !== tabId) return;

        if (changeInfo.status === 'loading' && patchCount < maxPatches) {
          patchCount++;
          const t0 = Date.now();
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tid },
              world: 'MAIN',
              func: CloudflareBypassService._stealthPatchFn,
            });
            console.log(`[CF-BYPASS] [SHIELD] Early patch #${patchCount} at loading (${Date.now() - t0}ms)`);
          } catch (_) {
            // Normal — document may not be ready yet
          }
        }

        if (changeInfo.status === 'complete' && !resolved) {
          resolved = true;
          // Final patch after load completes
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tid },
              world: 'MAIN',
              func: CloudflareBypassService._stealthPatchFn,
            });
          } catch (_) {}
        }
      };

      chrome.tabs.onUpdated.addListener(earlyListener);

      try {
        // Open as a minimized popup so it never appears in the user's tab bar.
        // NOTE: chrome.windows.create ignores state:'minimized' — must call windows.update after.
        const win = await chrome.windows.create({ url, type: 'popup', state: 'minimized', focused: false, left: -9999, top: -9999, width: 1, height: 1 });
        winId  = win?.id ?? null;
        tabId  = win?.tabs?.[0]?.id ?? null;
        // Force minimize immediately after creation
        if (winId !== null) { try { chrome.windows.update(winId, { state: 'minimized' }); } catch (_) {} }
        if (!tabId) {
          resolve(null);
          return;
        }

        // Also run rapid-fire injection loop (belt + suspenders)
        CloudflareBypassService._earlyPatchLoop(tabId, cfg.earlyInjectWindowMs);

        // Give listener time to work, then resolve with {tabId, winId}
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(earlyListener);
          resolve({ tabId, winId });
        }, cfg.earlyInjectWindowMs + 500);

      } catch (err) {
        chrome.tabs.onUpdated.removeListener(earlyListener);
        resolve(null);
      }
    });
  }

  /**
   * Rapid-fire injection loop: tries to inject every 50ms for `windowMs`.
   * Catches all errors (tab not ready yet) and keeps retrying.
   * Goal: hit the EARLIEST possible moment the page context exists.
   */
  static async _earlyPatchLoop(tabId, windowMs) {
    const deadline = Date.now() + windowMs;
    let count = 0;
    let firstSuccess = -1;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: CloudflareBypassService._stealthPatchFn,
        });
        if (firstSuccess < 0) {
          firstSuccess = Date.now();
          console.log(`[CF-BYPASS] [FAST] First successful patch at +${count * 50}ms`);
        }
        count++;
      } catch (_) {
        // Not ready yet — keep looping
      }
    }
  }

  // ─── Stealth Patch Function (injected into MAIN world) ────────────────────

  /**
   * Injected into the page's MAIN JavaScript context.
   * Patches all APIs that Cloudflare Bot Management checks.
   *
   * CRITICAL: Must be self-contained (no closure references).
   * Runs at document_start equivalent — before CF challenge JS.
   */
  static _stealthPatchFn() {
    if (window.__cfBP2) return;  // already patched (v2)
    window.__cfBP2 = true;

    const _try = (fn, label) => { try { fn(); } catch(e) { /* silent */ } };

    // ── 1. Page Visibility API ─────────────────────────────────────────────
    // CF checks: document.hidden, visibilityState, onvisibilitychange
    _try(() => {
      Object.defineProperty(document, 'hidden',          { get: () => false,     configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });

      // Swallow visibilitychange listeners (CF listens for tab focus)
      const _ael = document.addEventListener.bind(document);
      document.addEventListener = (type, h, ...a) => {
        if (type === 'visibilitychange') return;
        return _ael(type, h, ...a);
      };
    }, 'visibility');

    // ── 2. Window Dimensions ──────────────────────────────────────────────
    // inactive tabs often have outerWidth=0, outerHeight=0
    _try(() => {
      const dim = (obj, prop, val) =>
        Object.defineProperty(obj, prop, { get: () => val, configurable: true });
      if (!window.outerWidth)  { dim(window, 'outerWidth', 1366); dim(window, 'outerHeight', 768); }
      if (!window.innerWidth)  { dim(window, 'innerWidth', 1366); dim(window, 'innerHeight', 768); }
      if (!screen.width)       { dim(screen,  'width', 1920); dim(screen,  'height',      1080); }
      dim(window, 'devicePixelRatio', 1);
    }, 'dimensions');

    // ── 3. requestAnimationFrame ──────────────────────────────────────────
    // rAF is throttled to ~1fps in hidden tabs — CF uses timing to detect this
    _try(() => {
      const _orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => _orig(cb) || setTimeout(() => cb(performance.now()), 16);
      window.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    }, 'raf');

    // ── 4. IntersectionObserver ───────────────────────────────────────────
    // Returns 0 intersection for all elements in hidden tabs
    _try(() => {
      const _IO = window.IntersectionObserver;
      window.IntersectionObserver = function(cb, opts) {
        return new _IO((entries, obs) => {
          entries.forEach(e => {
            _try(() => Object.defineProperty(e, 'isIntersecting', { get: () => true, configurable: true }), '');
            _try(() => Object.defineProperty(e, 'intersectionRatio', { get: () => 1.0, configurable: true }), '');
          });
          cb(entries, obs);
        }, opts);
      };
      window.IntersectionObserver.prototype = _IO.prototype;
    }, 'io');

    // ── 5. performance.now() timing normalization ─────────────────────────
    _try(() => {
      const _now = performance.now.bind(performance);
      const _off = (Math.random() * 20) - 10;
      performance.now = () => _now() + _off;
    }, 'perf');

    // ── 6. Navigator Permissions ──────────────────────────────────────────
    _try(() => {
      if (navigator.permissions?.query) {
        const _q = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = d => _q(d).catch(() => ({ state: 'prompt', onchange: null }));
      }
    }, 'perms');

    // ── 7. Battery API ────────────────────────────────────────────────────
    _try(() => {
      if (navigator.getBattery) {
        navigator.getBattery = () => Promise.resolve({
          charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1.0,
          addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {},
        });
      }
    }, 'battery');

    // ── 8. Canvas Fingerprint Noise ───────────────────────────────────────
    // CF reads canvas to fingerprint — inject tiny noise
    _try(() => {
      const _orig = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          // Inject 1 invisible pixel of noise
          const img = ctx.getImageData(0, 0, 1, 1);
          img.data[0] = (img.data[0] + 1) % 256;
          ctx.putImageData(img, 0, 0);
        }
        return _orig.apply(this, args);
      };
    }, 'canvas');

    // ── 9. WebGL Vendor/Renderer ──────────────────────────────────────────
    _try(() => {
      const _gpe = WebGLRenderingContext.prototype.getParameter;
      const _gpe2 = WebGL2RenderingContext?.prototype?.getParameter;
      const _patch = function(param) {
        if (param === 37446) return 'Intel Open Source Technology Center';
        if (param === 37445) return 'Mesa DRI Intel(R) HD Graphics (SKL GT2)';
        return _gpe.call(this, param);
      };
      WebGLRenderingContext.prototype.getParameter = _patch;
      if (_gpe2) WebGL2RenderingContext.prototype.getParameter = _patch;
    }, 'webgl');

    // ── 10. AudioContext fingerprint ──────────────────────────────────────
    _try(() => {
      const _origAC = window.AudioContext || window.webkitAudioContext;
      if (_origAC) {
        const _origCreate = _origAC.prototype.createOscillator;
        _origAC.prototype.createOscillator = function() {
          const osc = _origCreate.call(this);
          const _origStart = osc.start.bind(osc);
          osc.start = (...args) => _origStart(...args);
          return osc;
        };
      }
    }, 'audio');

    // ── 11. Plugins/MimeTypes (non-empty) ─────────────────────────────────
    _try(() => {
      if (navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const arr = [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 }];
            arr.item = i => arr[i];
            arr.namedItem = n => arr.find(p => p.name === n);
            arr.refresh = () => {};
            return arr;
          },
          configurable: true,
        });
      }
    }, 'plugins');

    // ── 12. Timezone consistency ──────────────────────────────────────────
    _try(() => {
      // Ensure Intl returns consistent timezone (not 'UTC' which flags bots)
      const _origDTF = Intl.DateTimeFormat;
      Intl.DateTimeFormat = function(locale, opts = {}) {
        if (!opts.timeZone) opts.timeZone = 'America/Sao_Paulo';
        return new _origDTF(locale, opts);
      };
      Intl.DateTimeFormat.prototype = _origDTF.prototype;
    }, 'timezone');

    console.log('[CF-BYPASS-v2] [OK] 12 stealth patches applied');
  }

  // ─── Layer 3: Challenge Resolution ───────────────────────────────────────

  static async _waitForResolution(tabId, cfg) {
    const deadline = Date.now() + cfg.challengeTimeoutMs;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));

      try {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) return false;

        if (tab.status !== 'complete') continue;

        // Check if still on challenge page
        const onChallenge = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            const t = document.title?.toLowerCase() || '';
            const b = document.body?.innerText?.toLowerCase() || '';
            return (
              t.includes('just a moment') ||
              t.includes('checking your browser') ||
              b.includes('checking if the site connection is secure') ||
              !!document.querySelector('#challenge-running, #cf-challenge-running, .cf-browser-verification')
            );
          },
        }).then(r => r?.[0]?.result).catch(() => true); // assume challenge if error

        if (!onChallenge) {
          console.log('[CF-BYPASS] [OK] Page loaded — challenge passed or absent');
          return true;
        }

        // Still on challenge — re-inject patches and keep waiting
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: CloudflareBypassService._stealthPatchFn,
        }).catch(() => {});

      } catch (_) {
        // Tab navigating — continue
      }
    }
    return false;
  }

  // ─── Layer 4: Human Behavior ──────────────────────────────────────────────

  static async _simulateHuman(tabId, cfg) {
    const delay = CloudflareBypassService._humanDelay(cfg);
    await new Promise(r => setTimeout(r, Math.round(delay * 0.4)));

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          // Bezier-like mouse path
          const pts = [
            [Math.random()*300+100, Math.random()*200+100],
            [Math.random()*300+200, Math.random()*200+150],
            [Math.random()*200+300, Math.random()*150+200],
          ];
          pts.forEach(([x, y], i) => setTimeout(() => {
            document.dispatchEvent(new MouseEvent('mousemove', {
              clientX: x, clientY: y, movementX: (Math.random()-0.5)*12,
              movementY: (Math.random()-0.5)*8, bubbles: true,
            }));
          }, i * (90 + Math.random() * 110)));

          // Scroll
          setTimeout(() => {
            window.dispatchEvent(new WheelEvent('wheel', { deltaY: 80 + Math.random()*60, bubbles: true }));
            window.scrollBy({ top: 100, behavior: 'smooth' });
          }, 200 + Math.random()*150);

          // Focus + click somewhere safe
          window.dispatchEvent(new FocusEvent('focus'));
          document.dispatchEvent(new MouseEvent('click', { clientX: 300, clientY: 200, bubbles: true }));
        },
      });
    } catch (_) {}

    await new Promise(r => setTimeout(r, Math.round(delay * 0.6)));
  }

  // ─── Cookie Harvesting ─────────────────────────────────────────────────────

  static async _harvestCookies(tabId, site) {
    try {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab?.url) return;
      const cfCookie = await chrome.cookies.get({ url: tab.url, name: 'cf_clearance' }).catch(() => null);
      if (cfCookie) {
        console.log(`[CF-BYPASS] [COOKIE] cf_clearance harvested for ${site} (expires: ${new Date(cfCookie.expirationDate * 1000).toISOString()})`);
      }
    } catch (_) {}
  }

  // ─── Extractor ────────────────────────────────────────────────────────────

  static async _runExtractor(tabId, extractorFn) {
    // Retry loop: Studocu/SPAs render content AFTER status='complete'
    // Wait progressively and retry until we get meaningful text
    const maxAttempts = 8;
    const waitMs = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, waitMs[attempt] || 2000));
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: extractorFn,
        });
        const text = res?.[0]?.result || '';
        const cleaned = typeof text === 'string' ? text.trim() : '';
        if (cleaned.length > 120) {
          console.log(`[CF-BYPASS] [OK] Extractor success on attempt ${attempt + 1}: ${cleaned.length} chars`);
          return cleaned.slice(0, CloudflareBypassService.CONFIG.maxExtractedChars);
        }
        console.log(`[CF-BYPASS] ⏳ Extractor attempt ${attempt + 1}: ${cleaned.length} chars — retrying...`);
      } catch (e) {
        console.warn(`[CF-BYPASS] Extractor attempt ${attempt + 1} error:`, e?.message);
      }
    }
    console.warn('[CF-BYPASS] [FAIL] Extractor exhausted all attempts — returning empty');
    return '';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  static _humanDelay(cfg) {
    return cfg.minHumanDelayMs + Math.random() * (cfg.maxHumanDelayMs - cfg.minHumanDelayMs);
  }

  static _parseSite(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (_) { return url; }
  }

  static async _waitForTabComplete(tabId, timeoutMs) {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, timeoutMs);
      const listener = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
}
