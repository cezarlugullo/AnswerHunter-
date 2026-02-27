/**
 * NativeFetchBridgeService.js
 *
 * Singleton bridge to the NativeFetchBridge Go binary via Chrome Native Messaging.
 * The binary uses bogdanfinn/tls-client (Chrome_131 profile + random TLS extension order)
 * and bogdanfinn/fhttp for correct H/2 header ordering, making requests appear as real
 * browser traffic — no Origin, no Sec-Fetch-Mode: cors.
 *
 * Native Messaging protocol: 4-byte LE uint32 length prefix + UTF-8 JSON on stdin/stdout.
 *
 * Usage:
 *   const html = await NativeFetchBridgeService.fetch('https://...');
 *   const avail = await NativeFetchBridgeService.isAvailable();
 */

const NATIVE_HOST = 'com.answerhunter.bridge';
const DEFAULT_TIMEOUT_MS = 20000;
const PROBE_TIMEOUT_MS   = 5000;

const isHostNotFoundError = (message = '') => {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('specified native messaging host not found') ||
    text.includes('native messaging host not found') ||
    text.includes('host not found') ||
    text.includes('cannot find')
  );
};

// UUID v4 — crypto.randomUUID() available in MV3 SW
const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const NativeFetchBridgeService = (() => {
  let _port = null;          // chrome.runtime.Port
  let _available = null;     // null=untested, true, false
  let _pendingProbe = null;  // Promise<boolean>
  let _hostMissingLogged = false;
  const _pending = new Map(); // id -> { resolve, reject, timer }

  // ─── Connection ────────────────────────────────────────────────────────────

  function _connect() {
    if (_port) return;
    try {
      _port = chrome.runtime.connectNative(NATIVE_HOST);
      _port.onMessage.addListener(_onMessage);
      _port.onDisconnect.addListener(_onDisconnect);
    } catch (e) {
      if (isHostNotFoundError(e && e.message)) {
        _available = false;
        if (!_hostMissingLogged) {
          _hostMissingLogged = true;
          console.info('[NativeFetchBridge] native host not installed; using web fallback');
        }
      } else {
        console.warn('[NativeFetchBridge] connectNative failed:', e.message);
      }
      _port = null;
      _available = false;
    }
  }

  function _onMessage(msg) {
    if (!msg || !msg.id) return;
    const pending = _pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    _pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg);
    }
  }

  function _onDisconnect() {
    const err = chrome.runtime.lastError;
    const reason = err ? err.message : 'unknown';
    if (isHostNotFoundError(reason)) {
      if (!_hostMissingLogged) {
        _hostMissingLogged = true;
        console.info('[NativeFetchBridge] native host not installed; using web fallback');
      }
    } else {
      console.warn('[NativeFetchBridge] disconnected:', reason);
    }
    _port = null;
    // If disconnected because binary not found, mark unavailable
    if (isHostNotFoundError(reason)) {
      _available = false;
    }
    // Reject all pending requests
    for (const [id, pending] of _pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('NativeFetchBridge disconnected: ' + reason));
    }
    _pending.clear();
  }

  // ─── Send request ──────────────────────────────────────────────────────────

  function _sendRequest(payload) {
    return new Promise((resolve, reject) => {
      _connect();
      if (!_port) {
        return reject(new Error('NativeFetchBridge not connected'));
      }
      const id = payload.id || uuid();
      const msg = { ...payload, id };
      const timeoutMs = payload.timeoutMs || DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        _pending.delete(id);
        reject(new Error('NativeFetchBridge request timed out after ' + timeoutMs + 'ms'));
      }, timeoutMs + 1000); // +1s grace over Go-side timeout
      _pending.set(id, { resolve, reject, timer });
      try {
        _port.postMessage(msg);
      } catch (e) {
        clearTimeout(timer);
        _pending.delete(id);
        _port = null;
        reject(e);
      }
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Check if the native binary is installed and reachable.
   * Result is cached after first successful probe.
   * @returns {Promise<boolean>}
   */
  async function isAvailable() {
    if (_available === true)  return true;
    if (_available === false) return false;
    if (_pendingProbe)        return _pendingProbe;

    _pendingProbe = (async () => {
      try {
        const resp = await _sendRequest({
          id: 'probe-' + uuid(),
          url: 'https://www.google.com/generate_204',
          method: 'GET',
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        _available = (resp && resp.status >= 200 && resp.status < 500);
      } catch (e) {
        if (!isHostNotFoundError(e && e.message)) {
          console.warn('[NativeFetchBridge] probe failed:', e.message);
        }
        _available = false;
      }
      _pendingProbe = null;
      return _available;
    })();

    return _pendingProbe;
  }

  /**
   * Fetch a URL via the native binary.
   * Response body is base64-encoded by the Go binary.
   *
   * @param {string} url
   * @param {object} options
   * @param {string}  [options.method='GET']
   * @param {object}  [options.headers={}]   - extra headers (merged with defaults in Go)
   * @param {object}  [options.cookies={}]   - name->value cookie map
   * @param {string}  [options.body]         - request body, base64-encoded
   * @param {number}  [options.timeoutMs]    - per-request timeout in ms
   * @returns {Promise<{status:number, body:string, headers:object, bodyText:string}>}
   */
  async function fetchRaw(url, options = {}) {
    const resp = await _sendRequest({
      id: uuid(),
      url,
      method:    options.method    || 'GET',
      headers:   options.headers   || {},
      cookies:   options.cookies   || {},
      body:      options.body      || '',
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    });
    // Decode base64 body as UTF-8 (atob alone gives Latin-1 bytes)
    let bodyText = '';
    if (resp.body) {
      try {
        const bytes = Uint8Array.from(atob(resp.body), c => c.charCodeAt(0));
        bodyText = new TextDecoder('utf-8').decode(bytes);
      } catch (_) {
        bodyText = resp.body; // fallback if not b64
      }
    }
    return { status: resp.status, headers: resp.headers || {}, body: resp.body, bodyText };
  }

  /**
   * Drop-in fetch() replacement — returns a Response-like object.
   * @param {string} url
   * @param {object} options
   * @returns {Promise<{ok:boolean, status:number, text:()=>Promise<string>, json:()=>Promise<any>}>}
   */
  async function fetch(url, options = {}) {
    const raw = await fetchRaw(url, options);
    const { status, bodyText } = raw;
    return {
      ok:     status >= 200 && status < 300,
      status,
      headers: raw.headers,
      text:   () => Promise.resolve(bodyText),
      json:   () => Promise.resolve(JSON.parse(bodyText)),
    };
  }

  /**
   * Convenience: fetch URL and return response text.
   * Returns null on error.
   * @param {string} url
   * @param {object} options
   * @returns {Promise<string|null>}
   */
  async function fetchText(url, options = {}) {
    try {
      const r = await fetchRaw(url, options);
      if (r.status >= 200 && r.status < 400) return r.bodyText;
      console.warn('[NativeFetchBridge] HTTP', r.status, 'for', url);
      return null;
    } catch (e) {
      console.warn('[NativeFetchBridge] fetchText error:', e.message);
      return null;
    }
  }

  return { isAvailable, fetch, fetchRaw, fetchText, _connect, _sendRequest };
})();
