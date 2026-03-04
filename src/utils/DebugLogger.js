/**
 * DebugLogger
 * Centralized structured logs for popup/runtime flows.
 * Safe by default: redacts keys/tokens and truncates large payloads.
 */
export const DebugLogger = {
  _enabled: true,
  _seq: 0,
  _installedGlobalHooks: false,
  _wrappedMethods: new WeakMap(),

  async bootstrap() {
    // Runtime override for quick debugging in DevTools:
    // window.AH_DEBUG = true/false
    if (typeof window !== 'undefined' && typeof window.AH_DEBUG === 'boolean') {
      this._enabled = window.AH_DEBUG;
    }

    // Load settings — first visible message in DevTools will be the model banner
    let storedSettings = {};
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.sync?.get) {
        const result = await new Promise((resolve) => {
          chrome.storage.sync.get(['settings'], resolve);
        });
        storedSettings = result?.settings || {};
        const fromSettings = storedSettings.debugLoggingEnabled;
        if (typeof fromSettings === 'boolean') this._enabled = fromSettings;
      }
    } catch (_) {
      // Ignore storage bootstrap errors.
    }

    this.printModelTable(storedSettings);
    this._installGlobalHooks();
    this.info('debug.bootstrap', {
      enabled: this._enabled,
      location: typeof location !== 'undefined' ? location.href : 'n/a',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'
    });
  },

  /**
   * Prints a styled model banner to the DevTools console.
   * Green = active/in-use. Gray = configured but not primary.
   * Groq fast + OCR are always green (used regardless of primary provider).
   */
  printModelTable(s = {}) {
    const primary = (s.primaryProvider || 'groq').toLowerCase();
    const fast    = s.groqModelFast        || 'llama-3.1-8b-instant';
    const smart   = s.groqModelSmart       || 'llama-3.3-70b-versatile';
    const vision  = s.groqModelVision      || 'llama-4-scout-17b-16e-instruct';
    const gemini  = s.geminiModel          || 'gemini-2.5-flash';
    const orModel = s.openrouterModelSmart || 'deepseek/deepseek-r1:free';
    const chatgpt = s.chatgptModel         || 'gpt-5.2-codex';
    const copilot = s.copilotModel         || 'claude-sonnet-4.6';

    const H   = 'background:#0f172a;color:#f59e0b;font-weight:700;padding:3px 12px;border-radius:4px;font-size:12px;letter-spacing:.5px';
    const SEP = 'color:#1e293b;font-family:monospace;font-size:11px';
    const CAP = 'color:#475569;font-size:10px;font-weight:700;letter-spacing:1.5px;font-family:monospace';
    const ON  = 'color:#4ade80;font-weight:700;font-family:monospace;font-size:12px';
    const LBL = 'color:#64748b;font-family:monospace;font-size:12px';
    const VAL_ON  = 'color:#86efac;font-family:monospace;font-size:12px';
    const VAL_OFF = 'color:#334155;font-family:monospace;font-size:12px';

    const row = (active, icon, label, model) =>
      console.log(
        `%c ${active ? '[OK]' : '○ '} ${icon} ${label.padEnd(24)}%c${model}`,
        active ? ON : LBL,
        active ? VAL_ON : VAL_OFF
      );

    const SEP_LINE = ' ────────────────────────────────────────────────────';

    console.log('%c [BOT] AnswerHunter · Modelos ', H);
    console.log('%c' + SEP_LINE, SEP);
    console.log('%c SEMPRE ATIVOS', CAP);
    row(true, '', 'Groq · extração fast', fast);
    row(true, '', 'Groq · OCR vision', vision);
    console.log('%c' + SEP_LINE, SEP);
    console.log('%c PROVIDER PRINCIPAL', CAP);
    row(primary === 'groq', '', 'Groq · raciocínio', smart);
    row(primary === 'gemini', '', 'Gemini', gemini);
    row(primary === 'openrouter', '', 'OpenRouter', orModel);
    row(primary === 'chatgpt', '', 'ChatGPT', chatgpt);
    row(primary === 'copilot', '', 'Copilot', copilot);
    console.log('%c' + SEP_LINE, SEP);
  },

  setEnabled(enabled) {
    this._enabled = !!enabled;
    this.info('debug.setEnabled', { enabled: this._enabled });
  },

  isEnabled() {
    return !!this._enabled;
  },

  log(event, payload = {}) {
    this._print('log', event, payload);
  },

  info(event, payload = {}) {
    this._print('info', event, payload);
  },

  warn(event, payload = {}) {
    this._print('warn', event, payload);
  },

  error(event, payload = {}) {
    this._print('error', event, payload);
  },

  group(event, payload = {}) {
    if (!this._enabled) return;
    const prefix = this._prefix(event);
    console.group(prefix);
    if (payload && Object.keys(payload).length) {
      console.log(this._sanitize(payload));
    }
  },

  groupEnd() {
    if (!this._enabled) return;
    console.groupEnd();
  },

  markStart(event, payload = {}) {
    const token = `${event}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    if (this._enabled) {
      this.info(`${event}.start`, payload);
    }
    const start = Date.now();
    return {
      end: (extra = {}) => {
        if (!this._enabled) return;
        const elapsedMs = Date.now() - start;
        this.info(`${event}.end`, { elapsedMs, token, ...extra });
      },
      fail: (error, extra = {}) => {
        if (!this._enabled) return;
        const elapsedMs = Date.now() - start;
        this.error(`${event}.error`, {
          elapsedMs,
          token,
          error: this._formatError(error),
          ...extra
        });
      }
    };
  },

  instrumentService(serviceName, serviceObject, methodNames = []) {
    if (!serviceObject || typeof serviceObject !== 'object') return;
    const wrappedSet = this._wrappedMethods.get(serviceObject) || new Set();

    for (const methodName of methodNames) {
      if (wrappedSet.has(methodName)) continue;
      const original = serviceObject[methodName];
      if (typeof original !== 'function') continue;

      const logger = this;
      serviceObject[methodName] = function wrappedMethod(...args) {
        const event = `${serviceName}.${methodName}`;
        const started = Date.now();

        if (logger._enabled) {
          logger.info(`${event}.start`, {
            args: logger._summarizeArgs(args)
          });
          // Fire-and-forget context snapshot for API provider/model state.
          if (
            serviceName === 'ApiService' &&
            typeof this?._getSettings === 'function' &&
            /generate|infer|extract|validate|search|refine|consensus/i.test(methodName)
          ) {
            Promise.resolve(this._getSettings())
              .then((s) => {
                logger.info(`${event}.provider`, {
                  primaryProvider: s?.primaryProvider || 'groq',
                  models: {
                    groqFast: s?.groqModelFast,
                    groqSmart: s?.groqModelSmart,
                    gemini: s?.geminiModelSmart || s?.geminiModel,
                    openrouter: s?.openrouterModelSmart,
                    chatgpt: s?.chatgptModel
                  },
                  keysPresent: {
                    groq: !!s?.groqApiKey,
                    gemini: !!s?.geminiApiKey,
                    openrouter: !!s?.openrouterApiKey,
                    serper: !!s?.serperApiKey
                  },
                  quotaFlags: {
                    groqExhaustedUntil: this?._groqQuotaExhaustedUntil || 0,
                    openrouterExhaustedUntil: this?._openRouterQuotaExhaustedUntil || 0
                  }
                });
              })
              .catch(() => {
                // Ignore provider snapshot failures.
              });
          }
        }

        try {
          const result = original.apply(this, args);
          if (result && typeof result.then === 'function') {
            return result.then((value) => {
              if (logger._enabled) {
                logger.info(`${event}.end`, {
                  elapsedMs: Date.now() - started,
                  result: logger._summarizeValue(value)
                });
              }
              return value;
            }).catch((error) => {
              if (logger._enabled) {
                logger.error(`${event}.error`, {
                  elapsedMs: Date.now() - started,
                  error: logger._formatError(error)
                });
              }
              throw error;
            });
          }

          if (logger._enabled) {
            logger.info(`${event}.end`, {
              elapsedMs: Date.now() - started,
              result: logger._summarizeValue(result)
            });
          }
          return result;
        } catch (error) {
          if (logger._enabled) {
            logger.error(`${event}.error`, {
              elapsedMs: Date.now() - started,
              error: logger._formatError(error)
            });
          }
          throw error;
        }
      };

      wrappedSet.add(methodName);
    }

    this._wrappedMethods.set(serviceObject, wrappedSet);
  },

  _installGlobalHooks() {
    if (this._installedGlobalHooks) return;
    this._installedGlobalHooks = true;
    if (typeof window === 'undefined') return;

    window.addEventListener('error', (event) => {
      this.error('global.error', {
        message: event?.message || 'unknown',
        source: event?.filename || 'n/a',
        line: event?.lineno || 0,
        column: event?.colno || 0
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.error('global.unhandledrejection', {
        reason: this._formatError(event?.reason)
      });
    });
  },

  _print(level, event, payload) {
    if (!this._enabled) return;
    const prefix = this._prefix(event);
    const sanitized = this._sanitize(payload);
    if (level === 'error') console.error(prefix, sanitized);
    else if (level === 'warn') console.warn(prefix, sanitized);
    else if (level === 'info') console.info(prefix, sanitized);
    else console.log(prefix, sanitized);
  },

  _prefix(event) {
    this._seq += 1;
    return `[AnswerHunterDBG #${this._seq} ${new Date().toISOString()}] ${event}`;
  },

  _summarizeArgs(args) {
    if (!Array.isArray(args)) return [];
    return args.map((arg) => this._summarizeValue(arg));
  },

  _summarizeValue(value, depth = 0) {
    if (value == null) return value;
    if (depth > 2) return '[depth-limit]';

    const t = typeof value;
    if (t === 'string') {
      return {
        type: 'string',
        length: value.length,
        preview: value.slice(0, 160)
      };
    }
    if (t === 'number' || t === 'boolean') return value;
    if (value instanceof Error) return this._formatError(value);

    if (Array.isArray(value)) {
      return {
        type: 'array',
        length: value.length,
        sample: value.slice(0, 3).map((item) => this._summarizeValue(item, depth + 1))
      };
    }

    if (t === 'object') {
      const keys = Object.keys(value);
      const out = {};
      for (const key of keys.slice(0, 12)) {
        out[key] = this._summarizeValue(value[key], depth + 1);
      }
      if (keys.length > 12) out.__truncatedKeys = keys.length - 12;
      return out;
    }

    return String(value);
  },

  _sanitize(value, depth = 0) {
    if (value == null) return value;
    if (depth > 4) return '[depth-limit]';
    if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...` : value;
    if (typeof value !== 'object') return value;

    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => this._sanitize(item, depth + 1));
    }

    const out = {};
    for (const [key, raw] of Object.entries(value)) {
      const lower = key.toLowerCase();
      const sensitiveKeyNames = new Set([
        'key',
        'api_key',
        'apikey',
        'x-api-key',
        'token',
        'access_token',
        'refreshtoken',
        'refresh_token',
        'secret',
        'password',
        'authorization',
        'cookie',
        'set-cookie'
      ]);
      const shouldRedact = (
        sensitiveKeyNames.has(lower) ||
        lower.endsWith('_key') ||
        lower.endsWith('apikey') ||
        lower.endsWith('_token') ||
        lower.startsWith('bearer_')
      );
      if (shouldRedact) {
        if (raw && typeof raw === 'object') {
          out[key] = '[redacted-object]';
        } else {
          out[key] = this._mask(raw);
        }
      } else {
        out[key] = this._sanitize(raw, depth + 1);
      }
    }
    return out;
  },

  _mask(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 8) return '***';
    return `${text.slice(0, 4)}***${text.slice(-4)}`;
  },

  _formatError(error) {
    if (!error) return { message: 'unknown error' };
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: (error.stack || '').split('\n').slice(0, 4).join('\n')
      };
    }
    return {
      type: typeof error,
      value: this._summarizeValue(error)
    };
  }
};
