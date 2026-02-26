
/**
 * StealthEvasions.js
 *
 * All puppeteer-extra-plugin-stealth evasions ported to Chrome MV3 extensions.
 * Original: github.com/berstend/puppeteer-extra (MIT)
 * Port: cf-bypass-mv3 (MIT)
 *
 * 16 EVASIONS:
 *   1.  navigator.webdriver      — removes automation flag
 *   2.  navigator.plugins        — fake Chrome plugins (PDF Viewer x5)
 *   3.  navigator.permissions    — fix Notification.permission = default
 *   4.  navigator.languages      — realistic language array
 *   5.  navigator.vendor         — Google Inc.
 *   6.  navigator.hardwareConcurrency — 8 cores
 *   7.  navigator.deviceMemory   — 8 GB
 *   8.  window.outerdimensions   — fix outerWidth/Height background tabs
 *   9.  chrome.runtime/app/csi   — mock chrome.* objects
 *   10. webgl.vendor             — Intel Inc. + Intel Iris OpenGL Engine
 *   11. media.codecs             — fix canPlayType()
 *   12. Page Visibility API      — force visible (MOST IMPORTANT)
 *   13. requestAnimationFrame    — normalize 60fps in background
 *   14. IntersectionObserver     — force elements visible
 *   15. performance.now          — normalize timing
 *   16. Battery API              — charging, full
 */
export class StealthEvasions {

  static async injectAll(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: StealthEvasions._allEvasionsFn,
      });
      console.log('[CF-STEALTH] 16 evasions injected');
    } catch(e) {
      console.warn('[CF-STEALTH] inject failed:', e?.message);
    }
  }

  static _allEvasionsFn() {
    if (window.__cfStealthActive) return;
    window.__cfStealthActive = true;

    // 1. navigator.webdriver
    try {
      if (Object.getOwnPropertyDescriptor(navigator, 'webdriver')) {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
      }
      try { delete Object.getPrototypeOf(navigator).webdriver; } catch(_) {}
    } catch(_) {}

    // 2. navigator.plugins — 5 fake PDF plugins like real Chrome
    try {
      if (navigator.plugins.length === 0) {
        const names = [
          'PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer',
          'Microsoft Edge PDF Viewer', 'WebKit built-in PDF',
        ];
        const fakeMime = { type: 'application/pdf', suffixes: 'pdf', description: ''  };
        const fakePlugins = names.map(name => {
          const p = Object.create(Plugin.prototype);
          Object.defineProperties(p, {
            name:        { value: name,                    enumerable: true },
            filename:    { value: 'internal-pdf-viewer', enumerable: true },
            description: { value: 'Portable Document Format', enumerable: true },
            length:      { value: 1,                      enumerable: true },
            0:           { value: fakeMime,               enumerable: true },
          });
          return p;
        });
        const arr = Object.create(PluginArray.prototype);
        fakePlugins.forEach((p, i) => {
          Object.defineProperty(arr, i, { value: p, enumerable: true });
          Object.defineProperty(arr, p.name, { value: p });
        });
        Object.defineProperty(arr, 'length', { value: fakePlugins.length });
        arr.item = i => fakePlugins[i] || null;
        arr.namedItem = n => fakePlugins.find(p => p.name === n) || null;
        arr.refresh = () => {};
        Object.defineProperty(arr, Symbol.iterator, { value: function*() { for (const p of fakePlugins) yield p; } });
        Object.defineProperty(navigator, 'plugins', { get: () => arr, configurable: true });
      }
    } catch(_) {}

    // 3. navigator.permissions
    try {
      if (window.Notification && window.location.protocol === 'https:') {
        Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
      }
      if (navigator.permissions?.query) {
        const _orig = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = d => d?.name === 'notifications'
          ? Promise.resolve({ state: 'default', onchange: null })
          : _orig(d);
      }
    } catch(_) {}

    // 4. navigator.languages
    try {
      if (!navigator.languages?.length) {
        Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'], configurable: true });
        Object.defineProperty(navigator, 'language',  { get: () => 'pt-BR', configurable: true });
      }
    } catch(_) {}

    // 5. navigator.vendor
    try {
      if (!navigator.vendor)
        Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true });
    } catch(_) {}

    // 6. navigator.hardwareConcurrency
    try {
      if ((navigator.hardwareConcurrency || 0) <= 2)
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    } catch(_) {}

    // 7. navigator.deviceMemory
    try {
      if ((navigator.deviceMemory || 0) < 4)
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
    } catch(_) {}

    // 8. window.outerdimensions
    try {
      if (!window.outerWidth || !window.outerHeight) {
        const iw = window.innerWidth || 1280;
        const ih = window.innerHeight || 720;
        Object.defineProperty(window, 'outerWidth',   { get: () => iw,      configurable: true });
        Object.defineProperty(window, 'outerHeight',  { get: () => ih + 85, configurable: true });
        Object.defineProperty(screen, 'availWidth',   { get: () => 1920,    configurable: true });
        Object.defineProperty(screen, 'availHeight',  { get: () => 1040,    configurable: true });
      }
    } catch(_) {}

    // 9. chrome.runtime / app / csi / loadTimes
    try {
      if (!window.chrome) Object.defineProperty(window, 'chrome', { writable: true, enumerable: true, configurable: false, value: {} });
      if (!window.chrome.app) {
        window.chrome.app = {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: () => null,
          getIsInstalled: () => false,
          runningState: () => 'cannot_run',
        };
      }
      if (!window.chrome.csi) {
        const st = Date.now() - Math.random() * 4000;
        window.chrome.csi = () => ({ onloadT: st + 200, startE: st, pageT: Date.now() - st, tran: 15 });
      }
      if (!window.chrome.loadTimes) {
        window.chrome.loadTimes = () => ({
          requestTime: Date.now()/1000 - 2, startLoadTime: Date.now()/1000 - 1.5,
          commitLoadTime: Date.now()/1000 - 1, finishDocumentLoadTime: Date.now()/1000 - 0.3,
          finishLoadTime: Date.now()/1000, firstPaintTime: Date.now()/1000 - 0.2,
          firstPaintAfterLoadTime: 0, navigationType: 'Other',
          wasFetchedViaSpdy: true, wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h3', wasAlternateProtocolAvailable: false, connectionInfo: 'h3',
        });
      }
    } catch(_) {}

    // 10. WebGL vendor/renderer
    try {
      const _origGetCtx = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        const ctx = _origGetCtx.call(this, type, ...args);
        if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
          const _gp = ctx.getParameter.bind(ctx);
          ctx.getParameter = p => {
            if (p === 37445) return 'Intel Inc.';
            if (p === 37446) return 'Intel Iris OpenGL Engine';
            return _gp(p);
          };
        }
        return ctx;
      };
    } catch(_) {}

    // 11. media.codecs
    try {
      const _origCPT = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function(t) {
        if (!t) return _origCPT.call(this, t);
        const tl = t.toLowerCase();
        if (tl.includes('video/mp4') && tl.includes('avc1.42e01e')) return 'probably';
        if (tl.startsWith('audio/aac') && !tl.includes('codecs'))    return 'probably';
        if (tl.startsWith('audio/x-m4a') && !tl.includes('codecs'))  return 'maybe';
        return _origCPT.call(this, t);
      };
    } catch(_) {}

    // 12. Page Visibility API — MOST IMPORTANT for background tabs
    try {
      Object.defineProperty(document, 'hidden',          { get: () => false,     configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      const _ael = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, fn, ...rest) {
        if (type === 'visibilitychange') return; // drop CF listener
        return _ael.call(this, type, fn, ...rest);
      };
    } catch(_) {}

    // 13. requestAnimationFrame — throttled in background, normalize to 60fps
    try {
      const _raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => {
        const id = _raf(cb);
        setTimeout(() => { try { cb(performance.now()); } catch(_) {} }, 16);
        return id;
      };
    } catch(_) {}

    // 14. IntersectionObserver — returns 0 in hidden tabs
    try {
      const _IO = window.IntersectionObserver;
      window.IntersectionObserver = function(cb, opts) {
        return new _IO((entries, obs) => {
          entries.forEach(e => {
            try {
              Object.defineProperty(e, 'isIntersecting',    { get: () => true, configurable: true });
              Object.defineProperty(e, 'intersectionRatio', { get: () => 1,    configurable: true });
            } catch(_) {}
          });
          cb(entries, obs);
        }, opts);
      };
      window.IntersectionObserver.prototype = _IO.prototype;
    } catch(_) {}

    // 15. performance.now — coarser in background tabs
    try {
      const _now = performance.now.bind(performance);
      const _j   = 1 + Math.random() * 3;
      performance.now = () => _now() + _j;
    } catch(_) {}

    // 16. Battery API
    try {
      if (navigator.getBattery)
        navigator.getBattery = () => Promise.resolve({
          charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1.0,
          addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
        });
    } catch(_) {}

    console.debug('[CF-STEALTH] 16 evasions active');
  }
}
