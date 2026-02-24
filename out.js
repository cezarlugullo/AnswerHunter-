(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/services/ChatGPTAuthService.js
  var ChatGPTAuthService;
  var init_ChatGPTAuthService = __esm({
    "src/services/ChatGPTAuthService.js"() {
      ChatGPTAuthService = {
        // ─── Public OAuth constants (from openai/codex open-source repo) ───
        CLIENT_ID: "app_EMoamEEZ73f0CkXaXp7hrann",
        AUTH_URL: "https://auth.openai.com/oauth/authorize",
        TOKEN_URL: "https://auth.openai.com/oauth/token",
        REDIRECT_URI: "http://localhost:1455/auth/callback",
        SCOPES: "openid profile email offline_access",
        // ─── Storage keys (chrome.storage.local only — never sync) ───
        STORAGE_KEY: "chatgpt_auth",
        PKCE_KEY: "chatgpt_pkce_pending",
        /**
         * Generate PKCE code_verifier and code_challenge using Web Crypto API.
         * Matches the Codex CLI implementation (64 random bytes → base64url).
         */
        async generatePKCE() {
          const randomBytes = new Uint8Array(64);
          crypto.getRandomValues(randomBytes);
          const codeVerifier = this._base64UrlEncode(randomBytes);
          const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
          const codeChallenge = this._base64UrlEncode(new Uint8Array(hashBuffer));
          return { codeVerifier, codeChallenge };
        },
        /**
         * Base64url encode (RFC 4648 §5) without padding — required for PKCE.
         */
        _base64UrlEncode(bytes) {
          const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
          return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        },
        /**
         * Start the OAuth login flow.
         * Generates PKCE params, saves them, and opens the auth URL in a new tab.
         * The background service worker will monitor for the callback.
         */
        async startLogin() {
          const { codeVerifier, codeChallenge } = await this.generatePKCE();
          const stateBytes = new Uint8Array(32);
          crypto.getRandomValues(stateBytes);
          const state = this._base64UrlEncode(stateBytes);
          await new Promise((resolve) => {
            chrome.storage.local.set({
              [this.PKCE_KEY]: {
                codeVerifier,
                state,
                timestamp: Date.now()
              }
            }, resolve);
          });
          const params = new URLSearchParams({
            client_id: this.CLIENT_ID,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            codex_cli_simplified_flow: "true",
            id_token_add_organizations: "true",
            originator: "codex_cli_rs",
            redirect_uri: this.REDIRECT_URI,
            response_type: "code",
            scope: this.SCOPES,
            state
          });
          const authUrl = `${this.AUTH_URL}?${params.toString()}`;
          chrome.tabs.create({ url: authUrl });
          return { started: true };
        },
        /**
         * Handle the OAuth callback URL (called from the background service worker).
         * Extracts the authorization code and exchanges it for tokens.
         */
        async handleCallback(callbackUrl) {
          try {
            const url = new URL(callbackUrl);
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            const error = url.searchParams.get("error");
            if (error) {
              console.error("ChatGPTAuth: OAuth error:", error, url.searchParams.get("error_description"));
              return { success: false, error: `OAuth error: ${error}` };
            }
            if (!code) {
              return { success: false, error: "No authorization code in callback" };
            }
            const stored = await new Promise((resolve) => {
              chrome.storage.local.get([this.PKCE_KEY], (result) => resolve(result[this.PKCE_KEY]));
            });
            if (!stored || !stored.codeVerifier) {
              return { success: false, error: "No pending PKCE session found" };
            }
            if (stored.state !== state) {
              return { success: false, error: "State mismatch \u2014 possible CSRF attack" };
            }
            if (Date.now() - stored.timestamp > 10 * 60 * 1e3) {
              return { success: false, error: "PKCE session expired (>10min)" };
            }
            const tokens = await this._exchangeCode(code, stored.codeVerifier);
            if (!tokens) {
              return { success: false, error: "Token exchange failed" };
            }
            const claims = this._parseJwt(tokens.id_token);
            const accountId = this._extractAccountId(claims);
            const authData = {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              idToken: tokens.id_token,
              accountId,
              email: claims?.email || claims?.["https://api.openai.com/profile"]?.email || null,
              lastRefresh: Date.now(),
              expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1e3 : null
            };
            await new Promise((resolve) => {
              chrome.storage.local.set({ [this.STORAGE_KEY]: authData }, resolve);
            });
            await new Promise((resolve) => {
              chrome.storage.local.remove([this.PKCE_KEY], resolve);
            });
            console.log("ChatGPTAuth: Login successful! account:", accountId, "email:", authData.email);
            return { success: true, email: authData.email };
          } catch (err) {
            console.error("ChatGPTAuth: Callback handling error:", err);
            return { success: false, error: err.message || String(err) };
          }
        },
        /**
         * Exchange authorization code for tokens via POST to OpenAI token endpoint.
         */
        async _exchangeCode(code, codeVerifier) {
          try {
            const response = await fetch(this.TOKEN_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                grant_type: "authorization_code",
                client_id: this.CLIENT_ID,
                code,
                code_verifier: codeVerifier,
                redirect_uri: this.REDIRECT_URI
              })
            });
            if (!response.ok) {
              const errText = await response.text().catch(() => "");
              console.error(`ChatGPTAuth: Token exchange HTTP ${response.status}: ${errText.slice(0, 300)}`);
              return null;
            }
            return await response.json();
          } catch (err) {
            console.error("ChatGPTAuth: Token exchange error:", err);
            return null;
          }
        },
        /**
         * Refresh the access token using the stored refresh_token.
         * Returns true if successful, false otherwise.
         */
        async refreshToken() {
          const auth = await this.getAuth();
          if (!auth || !auth.refreshToken) {
            console.warn("ChatGPTAuth: No refresh token available");
            return false;
          }
          try {
            const response = await fetch(this.TOKEN_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                grant_type: "refresh_token",
                client_id: this.CLIENT_ID,
                refresh_token: auth.refreshToken
              })
            });
            if (!response.ok) {
              const errText = await response.text().catch(() => "");
              console.error(`ChatGPTAuth: Token refresh HTTP ${response.status}: ${errText.slice(0, 300)}`);
              if (response.status === 400 || response.status === 401 || response.status === 403) {
                await this.logout();
              }
              return false;
            }
            const tokens = await response.json();
            const updated = {
              ...auth,
              accessToken: tokens.access_token || auth.accessToken,
              refreshToken: tokens.refresh_token || auth.refreshToken,
              idToken: tokens.id_token || auth.idToken,
              lastRefresh: Date.now(),
              expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1e3 : auth.expiresAt
            };
            if (tokens.id_token) {
              const claims = this._parseJwt(tokens.id_token);
              const newAccountId = this._extractAccountId(claims);
              if (newAccountId) updated.accountId = newAccountId;
              if (claims?.email) updated.email = claims.email;
            }
            await new Promise((resolve) => {
              chrome.storage.local.set({ [this.STORAGE_KEY]: updated }, resolve);
            });
            console.log("ChatGPTAuth: Token refreshed successfully");
            return true;
          } catch (err) {
            console.error("ChatGPTAuth: Token refresh error:", err);
            return false;
          }
        },
        /**
         * Get the current auth data from local storage.
         * Returns null if not authenticated.
         */
        async getAuth() {
          return new Promise((resolve) => {
            chrome.storage.local.get([this.STORAGE_KEY], (result) => {
              resolve(result[this.STORAGE_KEY] || null);
            });
          });
        },
        /**
         * Check if user is logged in to ChatGPT.
         */
        async isLoggedIn() {
          const auth = await this.getAuth();
          return !!(auth && auth.accessToken);
        },
        /**
         * Get a valid access token, refreshing if needed.
         * Returns null if not authenticated.
         */
        async getValidToken() {
          const auth = await this.getAuth();
          if (!auth || !auth.accessToken) return null;
          const TOKEN_REFRESH_INTERVAL_MS = 8 * 60 * 1e3;
          const needsRefresh = auth.lastRefresh && Date.now() - auth.lastRefresh > TOKEN_REFRESH_INTERVAL_MS;
          if (needsRefresh && auth.refreshToken) {
            console.log("ChatGPTAuth: Token may be stale, refreshing...");
            const refreshed = await this.refreshToken();
            if (refreshed) {
              const updated = await this.getAuth();
              return updated?.accessToken || auth.accessToken;
            }
          }
          return auth.accessToken;
        },
        /**
         * Logout — clear all stored auth data.
         */
        async logout() {
          await new Promise((resolve) => {
            chrome.storage.local.remove([this.STORAGE_KEY, this.PKCE_KEY], resolve);
          });
          console.log("ChatGPTAuth: Logged out");
        },
        /**
         * Parse a JWT token and return the payload claims.
         * Does NOT verify the signature — we trust OpenAI's token endpoint.
         */
        _parseJwt(token) {
          try {
            if (!token) return null;
            const parts = token.split(".");
            if (parts.length < 2) return null;
            const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
            const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
            const decoded = atob(padded);
            return JSON.parse(decoded);
          } catch (err) {
            console.warn("ChatGPTAuth: JWT parse error:", err);
            return null;
          }
        },
        /**
         * Extract the ChatGPT account ID from JWT claims.
         * The account_id is required for API calls to the Codex backend.
         */
        _extractAccountId(claims) {
          if (!claims) return null;
          const authClaims = claims["https://api.openai.com/auth"];
          if (authClaims) {
            if (Array.isArray(authClaims.organizations) && authClaims.organizations.length > 0) {
              const personalOrg = authClaims.organizations.find(
                (o) => o.is_personal || o.role === "owner"
              );
              const org = personalOrg || authClaims.organizations[0];
              if (org?.id) return org.id;
            }
            if (authClaims.user_id) return authClaims.user_id;
          }
          if (claims.sub) return claims.sub;
          return null;
        }
      };
    }
  });

  // src/models/SettingsModel.js
  var SettingsModel;
  var init_SettingsModel = __esm({
    "src/models/SettingsModel.js"() {
      SettingsModel = {
        defaults: {
          language: "",
          groqApiKey: "",
          groqApiUrl: "https://api.groq.com/openai/v1/chat/completions",
          // Fast model for simple tasks (1000 t/s): validation, extraction, parsing
          groqModelFast: "openai/gpt-oss-20b",
          // Smart model for complex reasoning (280 t/s): inference, consensus, analysis
          groqModelSmart: "llama-3.3-70b-versatile",
          // Most capable model for Google-like overview synthesis (tries this first)
          groqModelOverview: "openai/gpt-oss-120b",
          groqModelVision: "meta-llama/llama-4-scout-17b-16e-instruct",
          serperApiKey: "",
          serperApiUrl: "https://google.serper.dev/search",
          geminiApiKey: "",
          geminiApiUrl: "https://generativelanguage.googleapis.com/v1beta",
          geminiModel: "gemini-2.5-flash",
          geminiModelSmart: "gemini-2.5-flash",
          openrouterApiKey: "",
          openrouterModelSmart: "deepseek/deepseek-r1:free",
          chatgptModel: "gpt-5.2",
          primaryProvider: "groq",
          setupCompleted: false,
          requiredProviders: {
            groq: true,
            serper: false,
            gemini: false
          },
          minGroqIntervalMs: 2500,
          minGeminiIntervalMs: 4200,
          consensusVotingEnabled: true,
          // Enable multi-attempt consensus
          consensusMinAttempts: 2,
          // Minimum attempts for consensus (2-3)
          consensusThreshold: 0.5
          // Minimum vote ratio to accept (0.5 = 50%)
        },
        normalizeLanguage(language) {
          if (typeof language !== "string") return "en";
          return /^pt/i.test(language) ? "pt-BR" : "en";
        },
        getBrowserDefaultLanguage() {
          try {
            return this.normalizeLanguage(navigator?.language || "en");
          } catch (_) {
            return "en";
          }
        },
        isPresent(value) {
          return typeof value === "string" && value.trim().length > 0;
        },
        normalizeRequiredProviders(requiredProviders = {}) {
          return {
            groq: requiredProviders.groq !== false,
            serper: requiredProviders.serper !== false,
            gemini: requiredProviders.gemini === true
          };
        },
        getProviderReadiness(settings = {}) {
          const requiredProviders = this.normalizeRequiredProviders(
            settings.requiredProviders || this.defaults.requiredProviders
          );
          const missingRequired = [];
          const optionalMissing = [];
          if (requiredProviders.groq && !this.isPresent(settings.groqApiKey)) {
            missingRequired.push("groq");
          }
          if (requiredProviders.serper && !this.isPresent(settings.serperApiKey)) {
            missingRequired.push("serper");
          }
          if (requiredProviders.gemini && !this.isPresent(settings.geminiApiKey)) {
            missingRequired.push("gemini");
          } else if (!this.isPresent(settings.geminiApiKey)) {
            optionalMissing.push("gemini");
          }
          return {
            ready: missingRequired.length === 0,
            missingRequired,
            optionalMissing,
            requiredProviders
          };
        },
        computeSetupCompleted(settings = {}) {
          return this.getProviderReadiness(settings).ready;
        },
        async getCurrentProviderReadiness() {
          const settings = await this.getSettings();
          return this.getProviderReadiness(settings);
        },
        /**
         * Returns settings merged with defaults.
         */
        async getSettings() {
          return new Promise((resolve) => {
            chrome.storage.sync.get(["settings"], (result) => {
              const stored = result.settings || {};
              const merged = { ...this.defaults, ...stored };
              if (merged.geminiModelSmart === "gemini-2.5-pro") {
                merged.geminiModelSmart = "gemini-2.5-flash";
              }
              merged.language = this.normalizeLanguage(merged.language || this.getBrowserDefaultLanguage());
              merged.requiredProviders = this.normalizeRequiredProviders(merged.requiredProviders);
              merged.setupCompleted = this.computeSetupCompleted(merged);
              resolve(merged);
            });
          });
        },
        /**
         * Persists settings into chrome.storage.sync.
         */
        async saveSettings(newSettings) {
          const current = await this.getSettings();
          const updated = { ...current, ...newSettings };
          updated.language = this.normalizeLanguage(updated.language || this.getBrowserDefaultLanguage());
          updated.requiredProviders = this.normalizeRequiredProviders(updated.requiredProviders);
          updated.setupCompleted = this.computeSetupCompleted(updated);
          return new Promise((resolve) => {
            chrome.storage.sync.set({ settings: updated }, () => resolve());
          });
        },
        /**
         * Returns only API keys.
         */
        async getApiKeys() {
          const settings = await this.getSettings();
          return {
            groqKey: settings.groqApiKey,
            serperKey: settings.serperApiKey,
            geminiKey: settings.geminiApiKey,
            openrouterKey: settings.openrouterApiKey
          };
        }
      };
    }
  });

  // src/services/ApiService.js
  var ApiService_exports = {};
  __export(ApiService_exports, {
    ApiService: () => ApiService
  });
  var ApiService;
  var init_ApiService = __esm({
    "src/services/ApiService.js"() {
      init_SettingsModel();
      init_ChatGPTAuthService();
      ApiService = {
        lastGroqCallAt: 0,
        _groqQueue: Promise.resolve(),
        // When Groq returns retry-after > 90s, the quota is depleted at hourly/daily level.
        // All subsequent Groq calls should fail fast instead of hanging for minutes.
        _groqQuotaExhaustedUntil: 0,
        _openRouterQuotaExhaustedUntil: 0,
        _chatgptQuotaExhaustedUntil: 0,
        /**
         * Call Gemini via its OpenAI-compatible endpoint.
         * Used as fallback when Groq quota is exhausted, or as primary when user selects Gemini.
         * @param {Array<{role:string,content:string}>} messages
         * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
         * @returns {Promise<string|null>} The assistant message content, or null on failure
         */
        async _callGemini(messages, opts = {}) {
          const settings = await this._getSettings();
          const { geminiApiKey, geminiApiUrl, geminiModel } = settings;
          if (!geminiApiKey) return null;
          const model = opts.model || geminiModel || "gemini-2.5-flash";
          const baseUrl = (geminiApiUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
          const url = `${baseUrl}/openai/chat/completions`;
          const doCall = async (callModel) => {
            try {
              const isThinkingModel = /pro|ultra/i.test(callModel) && /2\.5/i.test(callModel);
              const effectiveMaxTokens = isThinkingModel ? Math.max(opts.max_tokens ?? 700, 4096) : opts.max_tokens ?? 700;
              const response = await fetch(url, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${geminiApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: callModel,
                  messages,
                  temperature: opts.temperature ?? 0.1,
                  max_tokens: effectiveMaxTokens
                })
              });
              if (!response.ok) {
                const errText = await response.text().catch(() => "");
                console.warn(`AnswerHunter: Gemini HTTP ${response.status} (model=${callModel}): ${errText.slice(0, 200)}`);
                return null;
              }
              const data = await response.json();
              const msg = data?.choices?.[0]?.message;
              let content = msg?.content?.trim() || "";
              if (!content && msg?.reasoning_content) {
                content = String(msg.reasoning_content).trim();
                console.log(`AnswerHunter: Gemini used reasoning_content (model=${callModel}, ${content.length} chars)`);
              }
              if (!content) {
                const msgKeys = msg ? Object.keys(msg).join(",") : "no-message";
                const finishReason = data?.choices?.[0]?.finish_reason || "unknown";
                console.warn(`AnswerHunter: Gemini empty content (model=${callModel}, finish=${finishReason}, msgKeys=[${msgKeys}])`);
                return null;
              }
              console.log(`AnswerHunter: Gemini success (model=${callModel}, ${content.length} chars)`);
              return content;
            } catch (err) {
              console.warn(`AnswerHunter: Gemini error (model=${callModel}):`, err?.message || String(err));
              return null;
            }
          };
          let result = await doCall(model);
          if (result) return result;
          const flashModel = geminiModel || "gemini-2.5-flash";
          if (model !== flashModel && /pro|ultra/i.test(model) && !opts._noDowngrade) {
            console.log(`AnswerHunter: Gemini auto-downgrade ${model} \u2192 ${flashModel}`);
            result = await doCall(flashModel);
            if (result) return result;
          }
          return null;
        },
        /**
         * Call OpenRouter via OpenAI-compatible chat completions endpoint.
         * @param {Array<{role:string,content:any}>} messages
         * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
         * @returns {Promise<string|null>}
         */
        async _callOpenRouter(messages, opts = {}) {
          const settings = await this._getSettings();
          const { openrouterModelSmart } = settings;
          const openrouterApiKey = (settings.openrouterApiKey || "").trim().replace(/^bearer\s+/i, "");
          if (!openrouterApiKey) return null;
          if (this._openRouterQuotaExhaustedUntil > Date.now()) {
            const waitMin = Math.ceil((this._openRouterQuotaExhaustedUntil - Date.now()) / 6e4);
            console.warn(`AnswerHunter: OpenRouter temporarily unavailable (~${waitMin}min left)`);
            return null;
          }
          const model = opts.model || openrouterModelSmart || "deepseek/deepseek-r1:free";
          const url = "https://openrouter.ai/api/v1/chat/completions";
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${openrouterApiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://answerhunter.local",
                "X-Title": "AnswerHunter"
              },
              body: JSON.stringify({
                model,
                messages,
                temperature: opts.temperature ?? 0.1,
                max_tokens: opts.max_tokens ?? 700
              })
            });
            if (!response.ok) {
              const errText = await response.text().catch(() => "");
              if (response.status === 429) {
                const retryAfter = parseFloat(response.headers.get("retry-after") || "0");
                const cooldownMs = retryAfter > 0 ? Math.ceil(retryAfter * 1e3) : 12e4;
                this._openRouterQuotaExhaustedUntil = Date.now() + cooldownMs;
                console.warn(`AnswerHunter: OpenRouter rate-limited (429), cooldown=${cooldownMs}ms`);
                return null;
              }
              if (response.status === 402 || /insufficient|credit|quota/i.test(errText)) {
                this._openRouterQuotaExhaustedUntil = Date.now() + 10 * 60 * 1e3;
                console.warn("AnswerHunter: OpenRouter insufficient credits/quota (402-like)");
                return null;
              }
              console.warn(`AnswerHunter: OpenRouter HTTP ${response.status}: ${errText.slice(0, 220)}`);
              return null;
            }
            const data = await response.json().catch(() => null);
            const msg = data?.choices?.[0]?.message;
            let content = typeof msg?.content === "string" ? msg.content.trim() : "";
            if (!content && Array.isArray(msg?.content)) {
              content = msg.content.map((part) => {
                if (typeof part === "string") return part;
                if (part && typeof part.text === "string") return part.text;
                return "";
              }).join("\n").trim();
            }
            if (!content) return null;
            return content;
          } catch (err) {
            console.warn("AnswerHunter: OpenRouter request error:", err?.message || String(err));
            return null;
          }
        },
        /**
         * Call ChatGPT via the Codex backend (uses ChatGPT subscription credits).
         * Requires OAuth authentication via ChatGPTAuthService.
         * Uses the OpenAI Responses API format.
         * @param {Array<{role:string,content:string}>} messages
         * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
         * @returns {Promise<string|null>} The assistant message content, or null on failure
         */
        async _callChatGPT(messages, opts = {}) {
          if (this._chatgptQuotaExhaustedUntil > Date.now()) {
            const waitMin = Math.ceil((this._chatgptQuotaExhaustedUntil - Date.now()) / 6e4);
            console.warn(`AnswerHunter: ChatGPT temporarily unavailable (~${waitMin}min left)`);
            return null;
          }
          const auth = await ChatGPTAuthService.getAuth();
          if (!auth || !auth.accessToken || !auth.accountId) {
            return null;
          }
          const settings = await this._getSettings();
          const model = opts.model || settings.chatgptModel || "gpt-5.2";
          const accessToken = await ChatGPTAuthService.getValidToken();
          if (!accessToken) return null;
          const currentAuth = await ChatGPTAuthService.getAuth();
          const accountId = currentAuth?.accountId || auth.accountId;
          const systemMsgs = messages.filter((m) => m.role === "system");
          const inputMsgs = messages.filter((m) => m.role !== "system");
          const body = {
            model,
            input: inputMsgs.map((m) => ({ role: m.role, content: m.content })),
            stream: true,
            store: false
          };
          if (systemMsgs.length > 0) {
            body.instructions = systemMsgs.map((m) => m.content).join("\n");
          }
          try {
            const response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "chatgpt-account-id": accountId
              },
              body: JSON.stringify(body)
            });
            if (response.status === 401) {
              if (!opts._retried) {
                console.log("AnswerHunter: ChatGPT 401 \u2014 refreshing token...");
                const refreshed = await ChatGPTAuthService.refreshToken();
                if (refreshed) {
                  return this._callChatGPT(messages, { ...opts, _retried: true });
                }
              }
              console.warn("AnswerHunter: ChatGPT auth failed after retry");
              return null;
            }
            if (response.status === 429) {
              const retryAfter = parseFloat(response.headers.get("retry-after") || "60");
              this._chatgptQuotaExhaustedUntil = Date.now() + retryAfter * 1e3;
              console.warn(`AnswerHunter: ChatGPT rate-limited (429), cooldown=${retryAfter}s`);
              return null;
            }
            if (!response.ok) {
              const errText = await response.text().catch(() => "");
              console.warn(`AnswerHunter: ChatGPT HTTP ${response.status}: ${errText.slice(0, 300)}`);
              return null;
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let collectedText = "";
            let completedData = null;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === "[DONE]") continue;
                try {
                  const event = JSON.parse(jsonStr);
                  if (event.type === "response.output_text.delta" && event.delta) {
                    collectedText += event.delta;
                  }
                  if (event.type === "response.completed" && event.response) {
                    completedData = event.response;
                  }
                } catch (_) {
                }
              }
            }
            if (completedData) {
              const output = completedData.output || [];
              const msgOutput = output.find((o) => o.type === "message");
              if (msgOutput) {
                const contentParts = msgOutput.content || [];
                const finalText = contentParts.filter((c) => c.type === "output_text").map((c) => c.text).join("\n").trim();
                if (finalText) {
                  console.log(`AnswerHunter: ChatGPT success (model=${model}, ${finalText.length} chars)`);
                  return finalText;
                }
              }
            }
            const trimmed = collectedText.trim();
            if (trimmed) {
              console.log(`AnswerHunter: ChatGPT success via deltas (model=${model}, ${trimmed.length} chars)`);
              return trimmed;
            }
            console.warn("AnswerHunter: ChatGPT \u2014 empty text in streaming response");
            return null;
          } catch (err) {
            console.warn("AnswerHunter: ChatGPT request error:", err?.message || String(err));
            return null;
          }
        },
        async _getSettings() {
          return await SettingsModel.getSettings();
        },
        /**
         * Returns true if user selected Gemini as the primary AI provider.
         */
        async _isGeminiPrimary() {
          const s = await this._getSettings();
          return s.primaryProvider === "gemini" && !!s.geminiApiKey;
        },
        /**
         * Run multi-attempt Gemini consensus for MC inference.
         * @param {string} systemMsg - System prompt
         * @param {string} userPrompt - User prompt
         * @param {RegExp} letterPattern - Regex to extract letter
         * @param {{smart?:boolean}} opts
         * @returns {{votes:Object, responses:Object, winner:string|null, response:string|null}}
         */
        async _geminiConsensus(systemMsg, userPrompt, letterPattern, opts = {}) {
          const settings = await this._getSettings();
          const smartModel = opts.smart !== false ? settings.geminiModelSmart || "gemini-2.5-flash" : settings.geminiModel || "gemini-2.5-flash";
          const flashModel = settings.geminiModel || "gemini-2.5-flash";
          const temps = [0.1, 0.5];
          const runConsensusLoop = async (model, tempList) => {
            const votes2 = {};
            const responses2 = {};
            let nullCount2 = 0;
            for (const temp of tempList) {
              try {
                const content = await this._callGemini([
                  { role: "system", content: systemMsg },
                  { role: "user", content: userPrompt }
                ], { model, temperature: temp, max_tokens: 700, _noDowngrade: true });
                if (!content) {
                  nullCount2++;
                  continue;
                }
                if (content.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA|INCONCLUSIVO)/i.test(content)) {
                  const contentClean = content.replace(/[*_~`]+/g, "");
                  const m = contentClean.match(letterPattern) || content.match(letterPattern);
                  if (m) {
                    const letter = (m[1] || m[2] || "").toUpperCase();
                    if (letter) {
                      votes2[letter] = (votes2[letter] || 0) + 1;
                      if (!responses2[letter] || content.length > responses2[letter].length) {
                        responses2[letter] = content;
                      }
                      if (votes2[letter] >= 2) break;
                    } else {
                      if (!responses2["_noletter"] || content.length > responses2["_noletter"].length) {
                        responses2["_noletter"] = content;
                      }
                    }
                  } else {
                    if (!responses2["_noletter"] || content.length > responses2["_noletter"].length) {
                      responses2["_noletter"] = content;
                    }
                  }
                }
              } catch (err) {
                console.warn(`AnswerHunter: Gemini consensus temp=${temp} model=${model} error:`, err?.message || err);
                nullCount2++;
              }
            }
            return { votes: votes2, responses: responses2, nullCount: nullCount2 };
          };
          let { votes, responses, nullCount } = await runConsensusLoop(smartModel, temps);
          if (nullCount >= temps.length && smartModel !== flashModel && /pro|ultra/i.test(smartModel)) {
            console.log(`AnswerHunter: Gemini consensus auto-downgrade ${smartModel} \u2192 ${flashModel}`);
            const fallback = await runConsensusLoop(flashModel, [0.1, 0.3]);
            votes = { ...votes, ...fallback.votes };
            for (const [k, v] of Object.entries(fallback.responses)) {
              if (!responses[k] || v.length > responses[k].length) responses[k] = v;
            }
          }
          const entries = Object.entries(votes);
          if (entries.length > 0) {
            entries.sort((a, b) => b[1] - a[1]);
            const [winner] = entries[0];
            return { votes, responses, winner, response: responses[winner] };
          }
          if (responses["_noletter"]) {
            return { votes, responses, winner: null, response: responses["_noletter"] };
          }
          return { votes, responses, winner: null, response: null };
        },
        /**
         * Run multi-attempt Groq consensus for MC inference.
         * @param {string} systemMsg - System prompt
         * @param {string} userPrompt - User prompt
         * @param {RegExp} letterPattern - Regex to extract letter
         * @param {{model?:string, temps?:number[]}} opts
         * @returns {{votes:Object, responses:Object, attempts:string[], winner:string|null, response:string|null}}
         */
        async _groqConsensus(systemMsg, userPrompt, letterPattern, opts = {}) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey } = settings;
          const model = opts.model || settings.groqModelSmart || "llama-3.3-70b-versatile";
          const temps = opts.temps || [0.07, 0.15, 0.24];
          const votes = {};
          const responses = {};
          const attempts = [];
          let noValidCount = 0;
          for (const temp of temps) {
            if (this._groqQuotaExhaustedUntil > Date.now()) {
              const waitMin = Math.ceil((this._groqQuotaExhaustedUntil - Date.now()) / 6e4);
              console.warn(`AnswerHunter: Groq consensus skipping temp=${temp} \u2014 quota exhausted (~${waitMin}min left)`);
              break;
            }
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model,
                  messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: userPrompt }
                  ],
                  temperature: temp,
                  max_tokens: 700
                })
              }));
              const content = data?.choices?.[0]?.message?.content?.trim() || "";
              if (!content || content.length < 3 || /^(NAO_ENCONTRADO|SEM_RESPOSTA|INCONCLUSIVO)/i.test(content)) {
                noValidCount += 1;
                continue;
              }
              attempts.push(content);
              const m = content.match(letterPattern);
              if (m) {
                const letter = (m[1] || m[2] || "").toUpperCase();
                if (letter) {
                  votes[letter] = (votes[letter] || 0) + 1;
                  if (!responses[letter] || content.length > responses[letter].length) {
                    responses[letter] = content;
                  }
                  if (votes[letter] >= 2) break;
                }
              }
            } catch (err) {
              const errMsg = err?.message || String(err);
              console.warn(`AnswerHunter: Groq consensus error:`, errMsg);
              if (errMsg.includes("GROQ_QUOTA_EXHAUSTED")) break;
            }
          }
          const entries = Object.entries(votes);
          if (entries.length > 0) {
            entries.sort((a, b) => b[1] - a[1]);
            const [winner] = entries[0];
            return { votes, responses, attempts, winner, response: responses[winner] };
          }
          if (attempts.length > 0) {
            const longest = attempts.reduce((a, b) => a.length > b.length ? a : b);
            return { votes, responses, attempts, winner: null, response: longest };
          }
          return { votes, responses, attempts, winner: null, response: null };
        },
        /**
         * Respects Groq rate limit
         */
        async _waitForRateLimit() {
          const { minGroqIntervalMs } = await this._getSettings();
          const now = Date.now();
          const elapsed = now - this.lastGroqCallAt;
          const remaining = minGroqIntervalMs - elapsed;
          if (remaining > 0) {
            await new Promise((resolve) => setTimeout(resolve, remaining));
          }
          this.lastGroqCallAt = Date.now();
        },
        /**
         * Queues Groq calls to avoid concurrency and respect rate limit
         */
        async _withGroqRateLimit(taskFn) {
          const run = async () => {
            if (this._groqQuotaExhaustedUntil > Date.now()) {
              const waitMin = Math.ceil((this._groqQuotaExhaustedUntil - Date.now()) / 6e4);
              throw new Error(`GROQ_QUOTA_EXHAUSTED: quota resets in ~${waitMin}min`);
            }
            await this._waitForRateLimit();
            return taskFn();
          };
          const task = this._groqQueue.then(run, run);
          this._groqQueue = task.catch(() => {
          });
          return task;
        },
        /**
         * Wrapper for fetch with common headers and robust retry
         */
        async _fetch(url, options) {
          const maxRetries = 3;
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
              const response = await fetch(url, options);
              if (response.ok) {
                return await response.json();
              }
              if (response.status === 429) {
                const retryAfter = parseFloat(response.headers.get("retry-after") || "0");
                if (retryAfter > 30) {
                  this._groqQuotaExhaustedUntil = Date.now() + retryAfter * 1e3;
                  const waitMin = Math.ceil(retryAfter / 60);
                  console.warn(`AnswerHunter: Groq quota EXHAUSTED \u2014 retry-after=${retryAfter}s (~${waitMin}min). Skipping all Groq calls.`);
                  throw new Error(`GROQ_QUOTA_EXHAUSTED: retry-after=${retryAfter}s (~${waitMin}min)`);
                }
                if (attempt < maxRetries - 1 && retryAfter > 0 && retryAfter <= 30) {
                  const backoffMs = Math.ceil(retryAfter * 1e3) + 500;
                  console.log(`AnswerHunter: Rate limit 429, aguardando ${backoffMs}ms (retry-after=${retryAfter}s, tentativa ${attempt + 1}/${maxRetries})...`);
                  await new Promise((resolve) => setTimeout(resolve, backoffMs));
                  continue;
                }
                this._groqQuotaExhaustedUntil = Date.now() + 12e4;
                console.warn("AnswerHunter: Groq 429 without retry-after \u2014 assuming quota exhausted for 2min");
                throw new Error("GROQ_QUOTA_EXHAUSTED: 429 without retry-after");
              }
              throw new Error(`HTTP Error ${response.status}`);
            } catch (error) {
              const isQuotaError = error.message?.includes("GROQ_QUOTA_EXHAUSTED");
              if (attempt < maxRetries - 1 && !isQuotaError && !error.message?.includes("HTTP Error")) {
                const jitter = 500 + Math.random() * 500;
                await new Promise((resolve) => setTimeout(resolve, jitter));
                continue;
              }
              console.error(`ApiService Fetch Error (${url}):`, error);
              throw error;
            }
          }
        },
        _makeWebcacheUrl(url) {
          try {
            if (/webcache\.googleusercontent\.com\/search\?q=cache:/i.test(url)) return url;
            return `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
          } catch {
            return null;
          }
        },
        _makeJinaMirrorUrl(url) {
          try {
            if (!url) return null;
            const u = new URL(url);
            const hostAndPath = `${u.host}${u.pathname || "/"}${u.search || ""}${u.hash || ""}`;
            return `https://r.jina.ai/${u.protocol}//${hostAndPath}`;
          } catch {
            return null;
          }
        },
        _looksBlockedLikeContent(raw = "", targetUrl = "") {
          const text = String(raw || "").toLowerCase();
          if (!text) return false;
          const host = (() => {
            try {
              return new URL(targetUrl).hostname.replace(/^www\./, "").toLowerCase();
            } catch {
              return "";
            }
          })();
          const commonMarkers = [
            /verifying you are human/i,
            /ray id/i,
            /captcha/i,
            /cloudflare/i,
            /access denied/i,
            /forbidden/i,
            /datadome/i,
            /challenge/i,
            /httpservice\/retry\/enablejs/i
          ];
          const paywallMarkers = [
            /voce\s+esta\s+vendo\s+uma\s+previa/i,
            /documento\s+premium/i,
            /desbloqueie/i,
            /seja\s+premium/i,
            /limitation-blocked/i,
            /paywall-structure/i,
            /short-preview-version/i,
            /new-monetization-test-paywall/i,
            /filter\s*:\s*blur\(/i
          ];
          const hasCommon = commonMarkers.some((re) => re.test(text));
          const hasPaywall = paywallMarkers.some((re) => re.test(text));
          const hasReadablePreviewSignals = (() => {
            if (!hasPaywall) return false;
            const optionMatches = text.match(/(?:^|\s)[a-e]\s*[\)\.\-:]\s+/gim) || [];
            const hasQuestionLanguage = /\b(?:assinale|quest(?:ao|ão)|alternativa|afirmativa|aula\s+\d+)\b/i.test(text);
            return text.length > 3500 && optionMatches.length >= 3 && hasQuestionLanguage;
          })();
          if (hasCommon) return true;
          if (host === "passeidireto.com" || host === "studocu.com" || host.endsWith(".scribd.com")) {
            if (hasReadablePreviewSignals) return false;
            return hasPaywall;
          }
          return false;
        },
        async _fetchTextWithTimeout(url, options = {}, timeoutMs = 6500) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            const text = await res.text().catch(() => "");
            return { ok: res.ok, status: res.status, url: res.url || url, text };
          } catch (error) {
            return { ok: false, status: 0, url, text: "", error };
          } finally {
            clearTimeout(timeout);
          }
        },
        // Shared webcache 429 tracking — skip cache after too many consecutive 429s.
        _webcache429Count: 0,
        _webcache429Threshold: 2,
        resetWebcache429() {
          this._webcache429Count = 0;
        },
        /**
         * AI-powered per-page deep answer extraction.
         * Sends page text + question to AI for a "pente fino" — deep analysis.
         * Uses SMART model for best accuracy. Prefers Gemini (free, higher limits).
         * @param {string} pageText - Page text (will be truncated to ~8000 chars)
         * @param {string} questionText - The question with options
         * @param {string} hostHint - Source domain for logging
         * @returns {Promise<{letter:string, evidence:string, confidence:number, method:string, knowledge:string}|null>}
         */
        async aiExtractFromPage(pageText, questionText, hostHint = "") {
          if (!pageText || pageText.length < 100 || !questionText) {
            console.log(`  \u{1F52C} [aiExtract] SKIP: text too short (${(pageText || "").length} chars)`);
            return null;
          }
          const settings = await this._getSettings();
          const truncatedPage = pageText.substring(0, 8e3);
          const truncatedQuestion = questionText.substring(0, 1800);
          console.log(`  \u{1F52C} [aiExtract] START host=${hostHint} pageLen=${truncatedPage.length} questionLen=${truncatedQuestion.length}`);
          const systemMsg = `Voc\xEA \xE9 um especialista em encontrar respostas de quest\xF5es de m\xFAltipla escolha dentro de textos acad\xEAmicos. Analise o texto fornecido com rigor. Responda APENAS com base no texto \u2014 nunca invente informa\xE7\xF5es.`;
          const prompt = `# Tarefa
Analise o TEXTO abaixo e encontre a resposta para a QUEST\xC3O do aluno.

# ATEN\xC7\xC3O CR\xCDTICA: P\xE1ginas com m\xFAltiplas quest\xF5es
O texto pode conter V\xC1RIAS quest\xF5es sobre o mesmo tema. Voc\xEA DEVE:
- Comparar o ENUNCIADO EXATO e as ALTERNATIVAS EXATAS da quest\xE3o do aluno
- Se encontrar um gabarito, confirmar que ele pertence \xE0 quest\xE3o CERTA (mesmo enunciado, mesmas alternativas)
- NUNCA usar gabarito/resposta de uma quest\xE3o DIFERENTE, mesmo que trate do mesmo assunto

# O que procurar (em ordem de prioridade)
1. Gabarito expl\xEDcito: "Gabarito: X", "Resposta: X", "Alternativa correta: X", marca\xE7\xE3o \u2713/\u2605
2. Resolu\xE7\xE3o da quest\xE3o: explica\xE7\xE3o que conclua em uma alternativa
3. Quest\xE3o id\xEAntica/similar com resposta em outro local do texto
4. Defini\xE7\xF5es ou conceitos que confirmem/refutem alternativas
5. Informa\xE7\xF5es acad\xEAmicas relevantes ao tema

# Formato de resposta (siga EXATAMENTE um dos tr\xEAs)

## Se encontrou a resposta:
RESULTADO: ENCONTRADO
EVID\xCANCIA: [trecho exato copiado do texto]
RACIOC\xCDNIO: [como o trecho leva \xE0 resposta, passo a passo]
Letra X: [texto da alternativa]

## Se h\xE1 conhecimento \xFAtil mas sem resposta definitiva:
RESULTADO: CONHECIMENTO_PARCIAL
CONHECIMENTOS: [fatos/conceitos encontrados, relevantes \xE0 quest\xE3o]

## Se n\xE3o encontrou nada \xFAtil:
RESULTADO: NAO_ENCONTRADO

# Exemplos

<exemplo_1>
TEXTO: "...Quest\xE3o 5. O modelo relacional utiliza chaves prim\xE1rias para identificar registros. Gabarito: C..."
QUEST\xC3O: "No modelo relacional, o que identifica unicamente um registro? A) \xCDndice B) View C) Chave prim\xE1ria D) Trigger"

RESULTADO: ENCONTRADO
EVID\xCANCIA: "Gabarito: C"
RACIOC\xCDNIO: O texto cont\xE9m o gabarito expl\xEDcito da quest\xE3o 5 indicando letra C.
Letra C: Chave prim\xE1ria
</exemplo_1>

<exemplo_2>
TEXTO: "...NoSQL prioriza escalabilidade horizontal e flexibilidade de esquema, sacrificando consist\xEAncia forte em favor de disponibilidade (teorema CAP)..."
QUEST\xC3O: "Qual fator \xE9 mais importante para o desempenho de bancos NoSQL? A) Normaliza\xE7\xE3o B) Joins complexos C) Escalabilidade horizontal D) ACID completo"

RESULTADO: ENCONTRADO
EVID\xCANCIA: "NoSQL prioriza escalabilidade horizontal e flexibilidade de esquema"
RACIOC\xCDNIO: Passo 1: O texto afirma que NoSQL prioriza escalabilidade horizontal. Passo 2: A alternativa C menciona exatamente "escalabilidade horizontal". Passo 3: As alternativas A, B e D s\xE3o caracter\xEDsticas de bancos relacionais, n\xE3o NoSQL.
Letra C: Escalabilidade horizontal
</exemplo_2>

<exemplo_3>
TEXTO: "...O sistema imunol\xF3gico possui c\xE9lulas T e c\xE9lulas B que atuam na defesa adaptativa..."
QUEST\xC3O: "Qual a capital da Fran\xE7a? A) Londres B) Paris C) Berlim"

RESULTADO: NAO_ENCONTRADO
</exemplo_3>

<exemplo_4>
TEXTO: "...Quest\xE3o 3. Marque a op\xE7\xE3o falsa sobre diferen\xE7as NoSQL vs relacional: a) Grafos ... e) Escalabilidade horizontal. Gabarito: E. Quest\xE3o 4. Assinale o fator importante para o desempenho de bancos NoSQL: a) Ser schemaless b) SQL..."
QUEST\xC3O: "Assinale o fator importante para o desempenho de bancos NoSQL: A) Ser schemaless B) SQL C) Escalabilidade vertical D) Transa\xE7\xF5es E) Chave-valor"

RESULTADO: NAO_ENCONTRADO
(O "Gabarito: E" no texto pertence \xE0 Quest\xE3o 3 \u2014 uma quest\xE3o DIFERENTE com alternativas DIFERENTES. A Quest\xE3o 4 n\xE3o tem gabarito no texto.)
</exemplo_4>

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
TEXTO (${hostHint}):
${truncatedPage}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
QUEST\xC3O:
${truncatedQuestion}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

Analise o texto passo a passo e responda no formato acima:`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) {
              console.log(`  \u{1F52C} [aiExtract] Gemini: no API key`);
              return null;
            }
            try {
              console.log(`  \u{1F52C} [aiExtract] Trying Gemini (${settings.geminiModelSmart || "gemini-2.5-flash"})...`);
              const result = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], {
                temperature: 0.05,
                max_tokens: 300,
                model: "gemini-2.5-flash"
                // Force fast model for heavy extraction loop
              });
              console.log(`  \u{1F52C} [aiExtract] Gemini response: ${result ? result.length + " chars" : "null"}`);
              if (result) console.log(`  \u{1F52C} [aiExtract] Gemini preview: "${result.substring(0, 200)}"`);
              return result;
            } catch (e) {
              console.warn(`  \u{1F52C} [aiExtract] Gemini error:`, e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, {
                temperature: 0.05,
                max_tokens: 300,
                model: "gemini-2.5-flash"
                // Force fast model for heavy extraction loop
              });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
            if (!groqApiKey) {
              console.log(`  \u{1F52C} [aiExtract] Groq: no API key`);
              return null;
            }
            if (this._groqQuotaExhaustedUntil > Date.now()) {
              console.log(`  \u{1F52C} [aiExtract] Groq: quota exhausted, skipping`);
              return null;
            }
            try {
              console.log(`  \u{1F52C} [aiExtract] Trying Groq (${groqModelSmart})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
                  temperature: 0.05,
                  max_tokens: 300
                })
              }));
              const result = data?.choices?.[0]?.message?.content?.trim() || null;
              console.log(`  \u{1F52C} [aiExtract] Groq response: ${result ? result.length + " chars" : "null"}`);
              if (result) console.log(`  \u{1F52C} [aiExtract] Groq preview: "${result.substring(0, 200)}"`);
              return result;
            } catch (e) {
              console.warn(`  \u{1F52C} [aiExtract] Groq error:`, e?.message || e);
              return null;
            }
          };
          const tryChatGPT = async () => {
            if (this._chatgptQuotaExhaustedUntil > Date.now()) return null;
            try {
              console.log(`  \u{1F52C} [aiExtract] Trying ChatGPT (${settings.chatgptModel || "gpt-5.2"})...`);
              const result = await this._callChatGPT([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], {
                temperature: 0.05,
                max_tokens: 300,
                model: settings.chatgptModel || "gpt-5.2"
              });
              console.log(`  \u{1F52C} [aiExtract] ChatGPT response: ${result ? result.length + " chars" : "null"}`);
              return result;
            } catch (e) {
              console.warn("  \u{1F52C} [aiExtract] ChatGPT error:", e?.message || e);
              return null;
            }
          };
          let content = null;
          const fallbackChain = [];
          if (settings.geminiApiKey) fallbackChain.push({ name: "gemini", fn: tryGemini });
          if (settings.openrouterApiKey && this._openRouterQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: "openrouter", fn: tryOpenRouter2 });
          }
          if (settings.groqApiKey && this._groqQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: "groq", fn: tryGroq });
          }
          if (this._chatgptQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: "chatgpt", fn: tryChatGPT });
          }
          const primary = settings.primaryProvider || "groq";
          if (primary === "chatgpt") {
            const idx = fallbackChain.findIndex((p) => p.name === "chatgpt");
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
          } else if (primary === "gemini") {
            const idx = fallbackChain.findIndex((p) => p.name === "gemini");
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
          } else if (primary === "openrouter") {
            const idx = fallbackChain.findIndex((p) => p.name === "openrouter");
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
          } else {
            const idx = fallbackChain.findIndex((p) => p.name === "groq");
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
          }
          for (const provider of fallbackChain) {
            content = await provider.fn();
            if (content && content.length >= 10 && !/^RESULTADO:\s*NAO_ENCONTRADO/im.test(content)) {
              break;
            }
            console.log(`  \u{1F52C} [aiExtract] ${provider.name} failed or NAO_ENCONTRADO, trying next fallback...`);
          }
          if (!content || content.length < 10) {
            console.log(`  \u{1F52C} [aiExtract] RESULT: no response from any provider`);
            return null;
          }
          if (/RESULTADO:\s*CONHECIMENTO_PARCIAL/i.test(content)) {
            const knowledgeMatch = content.match(/CONHECIMENTOS?:\s*([\s\S]+)/i);
            const knowledge = knowledgeMatch ? knowledgeMatch[1].trim().substring(0, 1200) : content.substring(0, 1200);
            console.log(`  \u{1F52C} [aiExtract] RESULT: PARTIAL KNOWLEDGE (${knowledge.length} chars)`);
            console.log(`  \u{1F52C} [aiExtract] Knowledge preview: "${knowledge.substring(0, 200)}"`);
            return {
              letter: null,
              evidence: null,
              confidence: 0,
              method: "ai-knowledge-partial",
              knowledge
            };
          }
          if (/RESULTADO:\s*NAO_ENCONTRADO/i.test(content)) {
            console.log(`  \u{1F52C} [aiExtract] RESULT: NAO_ENCONTRADO`);
            return null;
          }
          const letterMatch = content.match(/\bLetra\s+([A-E])\b/i) || content.match(/\b([A-E])\s*[\):\.\-]\s*\S/);
          if (!letterMatch) {
            console.log(`  \u{1F52C} [aiExtract] RESULT: response but no letter found. Treating as knowledge.`);
            return {
              letter: null,
              evidence: null,
              confidence: 0,
              method: "ai-knowledge-noletter",
              knowledge: content.substring(0, 1200)
            };
          }
          const letter = letterMatch[1].toUpperCase();
          const evidenceMatch = content.match(/EVID[EÊ]NCIA:\s*([\s\S]*?)(?=RACIOC[IÍ]NIO:|Letra\s+[A-E]|$)/i);
          const evidence = evidenceMatch ? evidenceMatch[1].trim() : content;
          console.log(`  \u{1F52C} [aiExtract] RESULT: FOUND letter=${letter} evidence="${evidence.substring(0, 150)}"`);
          return {
            letter,
            evidence: evidence.slice(0, 900),
            confidence: 0.82,
            method: "ai-page-extraction",
            knowledge: content.substring(0, 1200)
          };
        },
        /**
         * AI extraction from raw HTML — lets the LLM detect visual highlights
         * (CSS classes, bold, colors) without hardcoded selectors.
         * @param {string} htmlSnippet - Raw HTML chunk centered on the question
         * @param {string} questionText - Full question with options
         * @param {string} hostHint - Domain for logging
         * @returns {Promise<{letter:string|null, evidence:string, confidence:number, method:string, knowledge:string}|null>}
         */
        async aiExtractFromHtml(htmlSnippet, questionText, hostHint = "") {
          if (!htmlSnippet || htmlSnippet.length < 300 || !questionText) {
            console.log(`  \u{1F52C} [aiHtml] SKIP: snippet too short (${(htmlSnippet || "").length} chars)`);
            return null;
          }
          const settings = await this._getSettings();
          const truncatedHtml = htmlSnippet.substring(0, 12e3);
          const truncatedQuestion = questionText.substring(0, 1800);
          console.log(`  \u{1F52C} [aiHtml] START host=${hostHint} htmlLen=${truncatedHtml.length} questionLen=${truncatedQuestion.length}`);
          const systemMsg = `Voc\xEA \xE9 um especialista em an\xE1lise de HTML/CSS de p\xE1ginas educacionais. Sua tarefa \xE9 encontrar respostas de quest\xF5es identificando DESTAQUES VISUAIS no HTML.`;
          const prompt = `# Tarefa
Analise o HTML abaixo de uma p\xE1gina de exerc\xEDcios acad\xEAmicos. Encontre a quest\xE3o do aluno e identifique qual alternativa est\xE1 VISUALMENTE DESTACADA como correta.

# Como identificar a resposta no HTML

## Destaques CSS (mais comum em PDFs renderizados como HTML):
- Uma alternativa tem classe CSS DIFERENTE das outras (ex: alternativas normais t\xEAm "ff2" mas a correta tem "ff1" ou "ff4")
- Font-family ou font-weight diferente em uma alternativa
- Uma alternativa est\xE1 em <b>, <strong>, ou tem font-weight: bold
- Cor de fundo diferente (background-color, highlight)

## Marca\xE7\xF5es expl\xEDcitas:
- \xCDcone de check (\u2713, \u2714, \u2605) pr\xF3ximo de uma alternativa
- Texto "Gabarito: X", "Resposta: X", "Correta: X"
- Classe CSS com nome sugestivo (correct, right, answer, selected, checked)

## IMPORTANTE:
- A p\xE1gina pode ter V\xC1RIAS quest\xF5es. Compare o ENUNCIADO e as ALTERNATIVAS EXATAS
- Procure diferen\xE7as ENTRE as alternativas da mesma quest\xE3o (uma destacada vs as demais)
- Se todas alternativas t\xEAm o mesmo estilo, N\xC3O h\xE1 destaque visual

# Formato de resposta

## Se encontrou destaque visual:
RESULTADO: ENCONTRADO
LETRA_DESTACADA: [A-E]
EVIDENCIA_CSS: [descreva a diferen\xE7a CSS/HTML que indica o destaque]
TEXTO_ALTERNATIVA: [texto da alternativa destacada]

## Se encontrou gabarito textual:
RESULTADO: ENCONTRADO
EVID\xCANCIA: [trecho exato]
Letra [A-E]: [texto da alternativa]

## Se n\xE3o encontrou:
RESULTADO: NAO_ENCONTRADO

# HTML da p\xE1gina (${hostHint}):
${truncatedHtml}

# Quest\xE3o do aluno:
${truncatedQuestion}

Analise o HTML e responda:`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              console.log(`  \u{1F52C} [aiHtml] Trying Gemini...`);
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.05, max_tokens: 400, model: "gemini-2.5-flash" });
            } catch (e) {
              console.warn(`  \u{1F52C} [aiHtml] Gemini error:`, e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.05, max_tokens: 400, model: "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!settings.groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              console.log(`  \u{1F52C} [aiHtml] Trying Groq (${settings.groqModelSmart})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(settings.groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${settings.groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: settings.groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
                  temperature: 0.05,
                  max_tokens: 400
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn(`  \u{1F52C} [aiHtml] Groq error:`, e?.message || e);
              return null;
            }
          };
          let content = null;
          const primary = settings.primaryProvider || "groq";
          if (primary === "openrouter") {
            content = await tryOpenRouter2();
            if (!content) content = await tryGroq();
            if (!content) content = await tryGemini();
          } else if (primary === "gemini") {
            content = await tryGemini();
            if (!content) content = await tryGroq();
            if (!content) content = await tryOpenRouter2();
          } else {
            content = await tryGroq();
            if (!content) content = await tryOpenRouter2();
            if (!content) content = await tryGemini();
          }
          if (!content || content.length < 10) {
            console.log(`  \u{1F52C} [aiHtml] RESULT: no response`);
            return null;
          }
          console.log(`  \u{1F52C} [aiHtml] Response (${content.length} chars): "${content.substring(0, 250)}"`);
          if (/RESULTADO:\s*NAO_ENCONTRADO/i.test(content)) {
            console.log(`  \u{1F52C} [aiHtml] RESULT: NAO_ENCONTRADO`);
            return null;
          }
          const highlightMatch = content.match(/LETRA_DESTACADA:\s*([A-E])\b/i);
          const letterMatch = highlightMatch || content.match(/\bLetra\s+([A-E])\b/i) || content.match(/\b([A-E])\s*[\):\.\-]\s*\S/);
          if (!letterMatch) {
            console.log(`  \u{1F52C} [aiHtml] RESULT: response but no letter found`);
            return {
              letter: null,
              evidence: null,
              confidence: 0,
              method: "ai-html-noletter",
              knowledge: content.substring(0, 1200)
            };
          }
          const letter = letterMatch[1].toUpperCase();
          const evidenceCss = content.match(/EVIDENCIA_CSS:\s*([\s\S]*?)(?=TEXTO_ALTERNATIVA:|Letra\s+[A-E]|$)/i);
          const evidenceText = content.match(/EVID[EÊ]NCIA:\s*([\s\S]*?)(?=RACIOC[IÍ]NIO:|Letra\s+[A-E]|$)/i);
          const evidence = (evidenceCss ? evidenceCss[1].trim() : evidenceText ? evidenceText[1].trim() : content).slice(0, 900);
          console.log(`  \u{1F52C} [aiHtml] RESULT: FOUND letter=${letter} evidence="${evidence.substring(0, 150)}"`);
          return {
            letter,
            evidence,
            confidence: 0.85,
            method: "ai-html-extraction",
            knowledge: content.substring(0, 1200)
          };
        },
        /**
         * AI combined reflection: takes accumulated knowledge from multiple sources
         * and reflects on them together to infer the answer.
         * This is the "last resort" when no single source had a definitive answer.
         * @param {string} questionText - The question with options
         * @param {Array<{host:string, knowledge:string, topicSim:number}>} knowledgePool - Collected insights
         * @returns {Promise<{letter:string, response:string, method:string}|null>}
         */
        async aiReflectOnSources(questionText, knowledgePool = []) {
          if (!questionText || !knowledgePool.length) return null;
          const settings = await this._getSettings();
          const knowledgeSection = knowledgePool.slice(0, 8).map((k, i) => `FONTE ${i + 1} (${k.host}, relev\xE2ncia=${(k.topicSim || 0).toFixed(2)}):
${String(k.knowledge || "").substring(0, 1500)}`).join("\n\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n");
          const totalKnowledge = knowledgePool.reduce((sum, k) => sum + (k.knowledge || "").length, 0);
          console.log(`  \u{1F9E0} [aiReflect] START: ${knowledgePool.length} sources, ${totalKnowledge} total knowledge chars`);
          const systemMsg = `Voc\xEA \xE9 um professor universit\xE1rio. Analise as informa\xE7\xF5es das fontes para responder a quest\xE3o. Use seu conhecimento acad\xEAmico para complementar quando necess\xE1rio. IGNORE quaisquer indica\xE7\xF5es de "Letra", "Gabarito" ou "Resposta" que estejam nas fontes \u2014 essas podem ser de quest\xF5es diferentes. Avalie cada alternativa de forma independente com base nos FATOS. Responda APENAS no formato solicitado.`;
          const prompt = `# Tarefa
V\xE1rias p\xE1ginas foram analisadas e nenhuma tinha a resposta definitiva. Abaixo est\xE3o os CONHECIMENTOS EXTRA\xCDDOS de cada fonte. Combine essas informa\xE7\xF5es para inferir a resposta.

# Fontes
${knowledgeSection}

# Quest\xE3o
${questionText.substring(0, 1800)}

# M\xE9todo (siga passo a passo)

PASSO 1 \u2014 COMPILAR: Liste os fatos-chave de TODAS as fontes acima.
PASSO 2 \u2014 AVALIAR: Para cada alternativa, indique se as fontes CONFIRMAM, REFUTAM ou s\xE3o INCERTAS.
PASSO 3 \u2014 ELIMINAR: Descarte alternativas refutadas pelas fontes.
PASSO 4 \u2014 CONCLUIR: Se restar apenas uma vi\xE1vel, essa \xE9 a resposta. Se n\xE3o, declare INCONCLUSIVO.

# Exemplo

<exemplo>
Fontes dizem: "TCP usa handshake de 3 vias", "UDP n\xE3o garante entrega"
Quest\xE3o: "Qual protocolo garante entrega? A) UDP B) TCP C) ICMP"

PASSO 1: TCP usa handshake 3 vias (fonte 1). UDP n\xE3o garante entrega (fonte 2).
PASSO 2:
A) UDP \u2014 REFUTADA (fonte 2 diz que n\xE3o garante entrega)
B) TCP \u2014 CONFIRMADA (handshake 3 vias = garantia de entrega)
C) ICMP \u2014 INCERTA (nenhuma fonte menciona)
PASSO 3: A eliminada. C sem evid\xEAncia. B confirmada.
PASSO 4: Apenas B \xE9 vi\xE1vel.

CONCLUS\xC3O:
Letra B: TCP
</exemplo>

# Sua an\xE1lise (siga os 4 passos):`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              console.log(`  \u{1F9E0} [aiReflect] Trying Gemini (${settings.geminiModelSmart || "gemini-2.5-flash"})...`);
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.1, max_tokens: 800, model: settings.geminiModelSmart || "gemini-2.5-flash" });
            } catch (e) {
              console.warn(`  \u{1F9E0} [aiReflect] Gemini error:`, e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.1, max_tokens: 800, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!settings.groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              console.log(`  \u{1F9E0} [aiReflect] Trying Groq (${settings.groqModelSmart})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(settings.groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${settings.groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: settings.groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
                  temperature: 0.1,
                  max_tokens: 800
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn(`  \u{1F9E0} [aiReflect] Groq error:`, e?.message || e);
              return null;
            }
          };
          const geminiPrimary = await this._isGeminiPrimary();
          let content = null;
          if (geminiPrimary) {
            content = await tryGemini();
            if (!content || /INCONCLUSIVO/i.test(content)) {
              const groqContent = await tryGroq();
              if (groqContent && !/INCONCLUSIVO/i.test(groqContent)) content = groqContent;
            }
          } else {
            content = await tryGroq();
            if (!content || /INCONCLUSIVO/i.test(content)) {
              const geminiContent = await tryGemini();
              if (geminiContent && !/INCONCLUSIVO/i.test(geminiContent)) content = geminiContent;
            }
          }
          if (!content || content.length < 20) {
            console.log(`  \u{1F9E0} [aiReflect] RESULT: no response`);
            return null;
          }
          console.log(`  \u{1F9E0} [aiReflect] Response (${content.length} chars): "${content.substring(0, 300)}"`);
          const letterMatch = content.match(/\bLetra\s+([A-E])\b/i) || content.match(/CONCLUS[AÃ]O:[\s\S]*?\b([A-E])\s*[\):\.\-]/i);
          if (!letterMatch) {
            console.log(`  \u{1F9E0} [aiReflect] RESULT: response but no letter (INCONCLUSIVO?)`);
            return null;
          }
          const letter = letterMatch[1].toUpperCase();
          console.log(`  \u{1F9E0} [aiReflect] RESULT: letter=${letter}`);
          return { letter, response: content, method: "ai-combined-reflection" };
        },
        /**
         * Fetches a snapshot preserving BOTH HTML and derived text, with fallback for blocked sources.
         * Needed for PDF-like HTML sources (PasseiDireto/Studocu) where answers may be encoded by CSS classes.
         */
        async fetchPageSnapshot(url, opts = {}) {
          if (!url) return null;
          const {
            timeoutMs = 6500,
            maxHtmlChars = 15e5,
            maxTextChars = 12e3
          } = opts;
          const commonHeaders = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cache-Control": "no-cache"
          };
          const primary = await this._fetchTextWithTimeout(url, {
            method: "GET",
            headers: commonHeaders,
            mode: "cors",
            credentials: "omit"
          }, timeoutMs);
          let viaWebcache = false;
          let viaMirror = false;
          let final = primary;
          const primaryBlockedLike = primary.ok && this._looksBlockedLikeContent(primary.text, url);
          const primaryTooSmall = primary.ok && (primary.text || "").length < 500;
          const shouldTryFallbacks = !primary.ok && (primary.status === 403 || primary.status === 429 || primary.status === 0) || primaryTooSmall || primaryBlockedLike;
          if (shouldTryFallbacks) {
            const skipWebcache = this._webcache429Count >= this._webcache429Threshold;
            const webcacheUrl = skipWebcache ? null : this._makeWebcacheUrl(url);
            if (webcacheUrl) {
              const cached = await this._fetchTextWithTimeout(webcacheUrl, {
                method: "GET",
                headers: commonHeaders,
                mode: "cors",
                credentials: "omit"
              }, timeoutMs);
              const cachedBlockedLike = cached.ok && this._looksBlockedLikeContent(cached.text, url);
              const is429 = cached.status === 429 || !cached.ok && /google\.com\/sorry/i.test(cached.url || "") || cached.ok && /google\.com\/sorry/i.test(cached.url || "");
              if (is429) {
                this._webcache429Count += 1;
                if (this._webcache429Count >= this._webcache429Threshold) {
                  console.log(`ApiService: Webcache rate-limited (${this._webcache429Count} consecutive 429s) \u2014 will skip cache for remaining URLs`);
                }
              } else if (cached.ok) {
                this._webcache429Count = 0;
              }
              if (cached.ok && (cached.text || "").length > 800 && !cachedBlockedLike) {
                final = cached;
                viaWebcache = true;
              }
            } else if (skipWebcache) {
              console.log(`ApiService: Skipping webcache for ${url} (${this._webcache429Count} consecutive 429s)`);
            }
            const finalBlockedLike = final.ok && this._looksBlockedLikeContent(final.text, url);
            if (!final.ok || (final.text || "").length < 1200 || finalBlockedLike) {
              const mirrorUrl = this._makeJinaMirrorUrl(url);
              if (mirrorUrl) {
                const mirrored = await this._fetchTextWithTimeout(mirrorUrl, {
                  method: "GET",
                  headers: {
                    "Accept": "text/plain,text/html;q=0.9,*/*;q=0.8",
                    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Cache-Control": "no-cache"
                  },
                  mode: "cors",
                  credentials: "omit"
                }, timeoutMs + 1800);
                const mirroredBlockedLike = mirrored.ok && this._looksBlockedLikeContent(mirrored.text, url);
                if (mirrored.ok && (mirrored.text || "").length > 700 && !mirroredBlockedLike) {
                  final = mirrored;
                  viaMirror = true;
                }
              }
            }
          }
          const finalHtmlRaw = String(final.text || "");
          const isGoogleChallengePage = /<title>\s*Google Search\s*<\/title>/i.test(finalHtmlRaw) && /httpservice\/retry\/enablejs/i.test(finalHtmlRaw);
          if (isGoogleChallengePage) {
            return {
              ok: false,
              status: 0,
              url: final.url || url,
              viaWebcache,
              viaMirror,
              html: "",
              text: ""
            };
          }
          if (!final.ok || !final.text) {
            return {
              ok: false,
              status: final.status || 0,
              url: final.url || url,
              viaWebcache,
              viaMirror,
              html: "",
              text: ""
            };
          }
          const rawHtml = String(final.text || "").slice(0, maxHtmlChars);
          const html = rawHtml;
          let derivedText = "";
          try {
            const sanitized = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<script\b[^>]*\/?>/gi, " ").replace(/<script\b[\s\S]*?(?=<(?:\/head|\/body|!--|meta|link))/gi, " ").replace(/<\s*script\b[\s\S]*$/gi, " ").replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ").replace(/<noscript\b[^>]*\/?>/gi, " ").replace(/<\s*noscript\b[\s\S]*$/gi, " ").replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ").replace(/<iframe\b[^>]*\/?>/gi, " ").replace(/<\s*iframe\b[\s\S]*$/gi, " ").replace(/<object\b[\s\S]*?<\/object>/gi, " ").replace(/<\s*object\b[\s\S]*$/gi, " ").replace(/<embed\b[^>]*>/gi, " ").replace(/<link\b[^>]*>/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.captcha-display\.com(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)(?:api-js\.)?datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/datadome\.co/gi, " ").replace(/captcha-display\.com/gi, " ");
            const parser = new DOMParser();
            const doc = parser.parseFromString(sanitized, "text/html");
            const elementsToRemove = doc.querySelectorAll('style, nav, header, footer, aside, noscript, [role="navigation"], [role="banner"], .ads, .advertisement, .sidebar');
            elementsToRemove.forEach((el) => el.remove());
            doc.querySelectorAll(".blank").forEach((el) => el.remove());
            doc.querySelectorAll("div, p, br, li, h1, h2, h3, h4, h5, h6, tr, td, article, section, footer, header").forEach((el) => {
              el.appendChild(doc.createTextNode(" "));
            });
            derivedText = (doc.body?.textContent || "").trim();
          } catch {
            derivedText = "";
          }
          const cleanedText = (derivedText || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxTextChars);
          return {
            ok: true,
            status: final.status || 200,
            url: final.url || url,
            viaWebcache,
            viaMirror,
            html,
            text: cleanedText
          };
        },
        /**
         * Validates if the text is a valid question using Groq
         */
        async validateQuestion(questionText) {
          if (!questionText) return false;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelFast } = settings;
          const prompt = `Voce deve validar se o texto abaixo e UMA quest\xE3o limpa e coerente.

Regras:
- Deve ser uma pergunta/quest\xE3o de prova ou exercicio.
- Pode ter alternativas (A, B, C, D, E).
- NAO pode conter menus, botoes, avisos, instrucoes de site, ou texto sem rela\xE7\xE3o.
- Se estiver poluida, misturando outra quest\xE3o, ou sem sentido, responda INVALIDO.

Texto:
${questionText}

Responda apenas: OK ou INVALIDO.`;
          const systemMsg = "Responda apenas OK ou INVALIDO.";
          const parseValidation = (content) => {
            const upper = (content || "").trim().toUpperCase();
            if (upper.includes("INVALIDO")) return false;
            if (upper.includes("OK")) return true;
            return true;
          };
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const content = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.1, max_tokens: 10, model: settings.geminiModel || "gemini-2.5-flash" });
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Gemini validateQuestion error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.1, max_tokens: 10, model: settings.geminiModel || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: groqModelFast,
                  messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: prompt }
                  ],
                  temperature: 0.1,
                  max_tokens: 10
                })
              }));
              return data?.choices?.[0]?.message?.content || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq validateQuestion error:", e?.message || e);
              return null;
            }
          };
          try {
            const geminiPrimary = await this._isGeminiPrimary();
            let content = null;
            if (geminiPrimary) {
              content = await tryGemini();
              if (content == null) content = await tryGroq();
            } else {
              content = await tryGroq();
              if (content == null) content = await tryGemini();
            }
            return parseValidation(content);
          } catch (error) {
            console.error("Erro validacao:", error);
            return true;
          }
        },
        /**
         * Vision OCR: extracts question text from a screenshot using Groq vision model.
         * @param {string} base64Image - base64-encoded JPEG/PNG screenshot (without data URI prefix)
         * @returns {Promise<string>} extracted question text, or '' on failure
         */
        async extractTextFromScreenshot(base64Image) {
          if (!base64Image) return "";
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelVision } = settings;
          const promptText = [
            "Voc\xEA \xE9 um OCR especializado em provas educacionais.",
            "Extraia APENAS a quest\xE3o (enunciado + alternativas A-E) que est\xE1 mais centralizada/vis\xEDvel na imagem.",
            "Se houver m\xFAltiplas quest\xF5es, escolha a que est\xE1 mais ao centro da tela.",
            "Retorne o texto puro da quest\xE3o com as alternativas, sem nenhum coment\xE1rio adicional.",
            "Formato esperado:",
            "<enunciado da quest\xE3o>",
            "A) <texto>",
            "B) <texto>",
            "C) <texto>",
            "D) <texto>",
            "E) <texto>"
          ].join("\n");
          const visionMessages = [
            {
              role: "user",
              content: [
                { type: "text", text: promptText },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ];
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const model = settings.geminiModel || "gemini-2.5-flash";
              console.log(`AnswerHunter: Vision OCR \u2014 sending screenshot to Gemini (${model})...`);
              const content = await this._callGemini(visionMessages, {
                temperature: 0.1,
                max_tokens: 700,
                model
              });
              if (!content || content.length < 20) {
                console.warn("AnswerHunter: Gemini Vision OCR returned too little text:", (content || "").length);
                return null;
              }
              console.log(`AnswerHunter: Gemini Vision OCR success \u2014 ${content.length} chars extracted`);
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Gemini Vision OCR failed:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            const model = groqModelVision || "meta-llama/llama-4-scout-17b-16e-instruct";
            try {
              console.log(`AnswerHunter: Vision OCR \u2014 sending screenshot to Groq (${model})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model,
                  messages: visionMessages,
                  temperature: 0.1,
                  max_tokens: 700
                })
              }));
              const content = (data.choices?.[0]?.message?.content || "").trim();
              if (content.length < 20) {
                console.warn("AnswerHunter: Groq Vision OCR returned too little text:", content.length);
                return null;
              }
              console.log(`AnswerHunter: Groq Vision OCR success \u2014 ${content.length} chars extracted`);
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Groq Vision OCR failed:", e?.message || e);
              return null;
            }
          };
          try {
            const geminiPrimary = await this._isGeminiPrimary();
            let result = null;
            if (geminiPrimary) {
              result = await tryGemini();
              if (!result) result = await tryGroq();
            } else {
              result = await tryGroq();
              if (!result) result = await tryGemini();
            }
            return result || "";
          } catch (error) {
            console.error("AnswerHunter: Vision OCR failed:", error);
            return "";
          }
        },
        /**
         * Search on Serper (Google) with fallback to educational sites
         * Exact logic from legacy searchWithSerper
         */
        async searchWithSerper(query) {
          const { serperApiUrl, serperApiKey } = await this._getSettings();
          const hasSerperKey = Boolean(String(serperApiKey || "").trim());
          const providerMode = /serpapi\.com\//i.test(String(serperApiUrl || "")) ? "serpapi" : "serper";
          const normalizeSpace = (s) => String(s || "").replace(/\s+/g, " ").trim();
          const normalizeForMatch = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
          const STOPWORDS = /* @__PURE__ */ new Set([
            "que",
            "para",
            "com",
            "sem",
            "dos",
            "das",
            "nos",
            "nas",
            "uma",
            "uns",
            "umas",
            "de",
            "da",
            "do",
            "e",
            "o",
            "a",
            "os",
            "as",
            "no",
            "na",
            "em",
            "por",
            "ou",
            "ao",
            "aos",
            "se",
            "um",
            "mais",
            "menos",
            "sobre",
            "apenas",
            "indica",
            "afirmativa",
            "fator",
            "importante",
            "desempenho"
          ]);
          const toTokens = (text) => normalizeForMatch(text).split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
          const unique = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
          const decodeHtml = (raw) => String(raw || "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
          const looksLikeCodeOption = (text) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|->|jsonb?|\bdb\.\w|\.(?:find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(text || ""));
          const normalizeCodeAwareHint = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^[a-e]\s*[\)\.\-:]\s*/i, "").replace(/->>/g, " op_json_text ").replace(/->/g, " op_json_obj ").replace(/=>/g, " op_arrow ").replace(/::/g, " op_dcolon ").replace(/:=/g, " op_assign ").replace(/!=/g, " op_neq ").replace(/<>/g, " op_neq ").replace(/<=/g, " op_lte ").replace(/>=/g, " op_gte ").replace(/</g, " op_lt ").replace(/>/g, " op_gt ").replace(/:/g, " op_colon ").replace(/=/g, " op_eq ").replace(/[^a-z0-9_]+/g, " ").replace(/\s+/g, " ").trim();
          const extractOptionHints = (raw) => {
            const text = String(raw || "").replace(/\r\n/g, "\n");
            const re = /(?:^|[\n\r\t ;])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;][A-E]\s*[\)\.\-:]\s)|$)/gi;
            const out = [];
            const seen = /* @__PURE__ */ new Set();
            let m;
            while ((m = re.exec(text)) !== null) {
              const body = normalizeSpace(m[2] || "").replace(/\b(?:gabarito|resposta\s+correta|parab(?:ens|\u00e9ns))\b.*$/i, "").trim();
              const bodyNorm = looksLikeCodeOption(body) ? normalizeCodeAwareHint(body) : normalizeForMatch(body);
              const malformed = !body || body.length < 12 || /^[A-E]\s*[\)\.\-:]?\s*$/i.test(body) || /^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(body) || seen.has(bodyNorm);
              if (!malformed) {
                out.push(body);
                seen.add(bodyNorm);
              }
              if (out.length >= 5) break;
            }
            return out;
          };
          const compactOptionHint = (optRaw) => {
            let opt = normalizeSpace(optRaw || "").replace(/["'`]+/g, " ").trim();
            if (!opt) return "";
            if (looksLikeCodeOption(opt)) {
              opt = opt.replace(/\binsert\s+into[\s\S]*?\bvalues\s*\(/i, " ").replace(/^\s*\(+/, "").replace(/\)+\s*;?$/, "").trim();
              const braceMatch = opt.match(/\{[\s\S]*\}/);
              if (braceMatch && braceMatch[0].length > 6) opt = braceMatch[0];
            }
            return normalizeSpace(opt).split(" ").slice(0, looksLikeCodeOption(optRaw) ? 12 : 7).join(" ");
          };
          const buildHintQuery = (stem, options) => {
            if (!options || options.length < 2) return "";
            const pickDistributedOptions = (arr) => {
              if (!arr || arr.length === 0) return [];
              const picked = [];
              const pushUnique = (v) => {
                if (!v) return;
                if (!picked.includes(v)) picked.push(v);
              };
              pushUnique(arr[0]);
              pushUnique(arr[1]);
              pushUnique(arr[Math.floor(arr.length / 2)]);
              pushUnique(arr[arr.length - 1]);
              pushUnique(arr[2]);
              pushUnique(arr[3]);
              return picked.slice(0, 5);
            };
            const hints = pickDistributedOptions(options).map((opt) => compactOptionHint(opt)).filter(Boolean).map((h) => `"${h}"`);
            if (hints.length === 0) return "";
            const maxLen = 340;
            const hintPart = hints.join(" ");
            const suffix = " gabarito";
            const reserved = hintPart.length + suffix.length + 1;
            const maxStemLen = Math.max(70, maxLen - reserved);
            const stemPart = normalizeSpace(stem).slice(0, maxStemLen);
            return normalizeSpace(`${stemPart} ${hintPart}${suffix}`).slice(0, maxLen);
          };
          const normalizeSerpApiOrganic = (items = []) => {
            return (items || []).map((entry) => {
              const title = normalizeSpace(entry?.title || "");
              const link = normalizeSpace(entry?.link || entry?.url || "");
              const snippet = normalizeSpace(entry?.snippet || entry?.snippet_highlighted_words?.join(" ") || "");
              return { title, link, snippet };
            }).filter((entry) => entry.title && entry.link);
          };
          const normalizeSearchPayload = (raw) => {
            if (!raw || typeof raw !== "object") {
              return {
                organic: [],
                answerBox: null,
                aiOverview: null,
                peopleAlsoAsk: null,
                provider: providerMode
              };
            }
            if (providerMode === "serpapi") {
              return {
                organic: normalizeSerpApiOrganic(raw.organic_results || []),
                answerBox: raw.answer_box || raw.answerBox || null,
                aiOverview: raw.ai_overview || raw.aiOverview || null,
                peopleAlsoAsk: raw.related_questions || raw.peopleAlsoAsk || raw.people_also_ask || null,
                provider: "serpapi"
              };
            }
            return {
              organic: raw.organic || [],
              answerBox: raw.answerBox || null,
              aiOverview: raw.aiOverview || raw.ai_overview || null,
              peopleAlsoAsk: raw.peopleAlsoAsk || null,
              provider: "serper"
            };
          };
          const runSerper = async (q, num = 8) => {
            if (providerMode === "serpapi") {
              const url = new URL(String(serperApiUrl || "https://serpapi.com/search.json"));
              url.searchParams.set("engine", url.searchParams.get("engine") || "google");
              url.searchParams.set("q", q);
              url.searchParams.set("gl", "br");
              url.searchParams.set("hl", "pt-br");
              url.searchParams.set("num", String(num));
              url.searchParams.set("api_key", serperApiKey);
              if (!url.searchParams.has("output")) {
                url.searchParams.set("output", "json");
              }
              const payload2 = await this._fetch(url.toString(), {
                method: "GET",
                headers: {
                  "Accept": "application/json"
                }
              });
              return normalizeSearchPayload(payload2);
            }
            const payload = await this._fetch(serperApiUrl, {
              method: "POST",
              headers: {
                "X-API-KEY": serperApiKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                q,
                gl: "br",
                hl: "pt-br",
                num
              })
            });
            return normalizeSearchPayload(payload);
          };
          const runDuckDuckGo = async (q, num = 8) => {
            const endpoint = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
            const response = await this._fetchTextWithTimeout(endpoint, {
              method: "GET",
              headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                "Cache-Control": "no-cache"
              },
              mode: "cors",
              credentials: "omit"
            }, 6500);
            if (!response?.ok || !response?.text) return [];
            const html = String(response.text || "");
            const blocks = html.split(/<div[^>]+class="result[^"]*"[^>]*>/gi).slice(1);
            const organic = [];
            for (const block of blocks) {
              const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
              if (!linkMatch) continue;
              let link = decodeHtml(linkMatch[1] || "").trim();
              const title = normalizeSpace(decodeHtml((linkMatch[2] || "").replace(/<[^>]+>/g, " ")));
              const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
              const snippetRaw = snippetMatch ? snippetMatch[1] || snippetMatch[2] || "" : "";
              const snippet = normalizeSpace(decodeHtml(String(snippetRaw).replace(/<[^>]+>/g, " ")));
              if (link.startsWith("/l/?")) {
                try {
                  const tmp = new URL(`https://duckduckgo.com${link}`);
                  const redirected = tmp.searchParams.get("uddg");
                  if (redirected) link = decodeURIComponent(redirected);
                } catch (_) {
                }
              }
              if (!/^https?:\/\//i.test(link)) continue;
              if (!title) continue;
              organic.push({ title, link, snippet });
              if (organic.length >= num) break;
            }
            return organic;
          };
          const rawQuery = String(query || "").replace(/([a-z\u00e0-\u00ff])([A-Z])/g, "$1 $2");
          const headSample = rawQuery.slice(0, 180);
          const leadingNumberedMatch = headSample.match(/^\s*(\d+)\s*([\.\-])\s+/i) || headSample.match(/(?:^|[\n\r])\s*(\d+)\s*([\.\-])\s+/i);
          const leadingLabelNumberMatch = headSample.match(/^\s*(?:Quest(?:ao|\u00e3o)|Pergunta|Atividade|Exerc(?:icio|\u00edcio))\s*(\d+)\s*([\.\-:)]?)\s*/i) || headSample.match(/(?:^|[\n\r])\s*(?:Quest(?:ao|\u00e3o)|Pergunta|Atividade|Exerc(?:icio|\u00edcio))\s*(\d+)\s*([\.\-:)]?)\s*/i);
          let preservedPrefix = "";
          if (leadingNumberedMatch) {
            const num = leadingNumberedMatch[1];
            const sep = leadingNumberedMatch[2] === "-" ? "-" : ".";
            preservedPrefix = `${num}${sep} `;
          } else if (leadingLabelNumberMatch) {
            const num = leadingLabelNumberMatch[1];
            const sep = leadingLabelNumberMatch[2] === "-" ? "-" : ".";
            preservedPrefix = `${num}${sep} `;
          }
          let cleanQuery = rawQuery.replace(/^(?:Quest(?:ao|\u00e3o)|Pergunta|Atividade|Exerc(?:icio|\u00edcio))\s*\d+[\s.:-]*/gi, "").replace(/Marcar para revis(?:ao|\u00e3o)/gi, "").replace(/\s*(Responda|O que voc(?:e|\u00ea) achou|Relatar problema|Voltar|Avan(?:car|\u00e7ar)|Menu|Finalizar)[\s\S]*/gi, "").replace(/\bNo\s+SQL\b/gi, "NoSQL").replace(/\s+/g, " ").trim();
          if (cleanQuery.includes("?")) {
            const questionEnd = cleanQuery.indexOf("?");
            const questionText = cleanQuery.substring(0, questionEnd + 1).trim();
            if (questionText.length >= 50) cleanQuery = questionText;
          }
          const optionMarkers = [...cleanQuery.matchAll(/(^|[\s:;])[A-E]\s*[\)\.\-:]\s/gi)];
          if (optionMarkers.length >= 2) {
            const firstMarkerIndex = optionMarkers[0].index ?? -1;
            if (firstMarkerIndex > 30) {
              cleanQuery = cleanQuery.substring(0, firstMarkerIndex).trim();
            }
          }
          const hasMultipleChoiceShape = (rawQuery.match(/(?:^|[\s:;])[A-E]\s*[\)\.\-:]\s/gi) || []).length >= 2;
          const startsWithQuestionVerb = /^(?:assinale|marque|indique|selecione|avalie|sobre)\b/i.test(cleanQuery);
          if (!preservedPrefix && hasMultipleChoiceShape && startsWithQuestionVerb) {
            preservedPrefix = "1. ";
          }
          if (preservedPrefix && !new RegExp(`^${preservedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(cleanQuery)) {
            cleanQuery = `${preservedPrefix}${cleanQuery}`.replace(/\s+/g, " ").trim();
          }
          const maxQueryLen = hasMultipleChoiceShape ? 380 : 250;
          cleanQuery = cleanQuery.substring(0, maxQueryLen);
          console.log(`AnswerHunter: Query limpa: "${cleanQuery}"`);
          const optionHints = extractOptionHints(rawQuery);
          const hintQuery = buildHintQuery(cleanQuery, optionHints);
          if (hintQuery) {
            console.log(`AnswerHunter: Query com alternativas: "${hintQuery}"`);
          }
          const BOOST_SITES = [
            "qconcursos.com",
            "qconcursos.com.br",
            "tecconcursos.com.br",
            "gran.com.br",
            "passeidireto.com",
            "studocu.com",
            "brainly.com.br"
          ];
          const siteFilter = BOOST_SITES.map((s2) => `site:${s2}`).join(" OR ");
          const domainFromLink = (link) => {
            try {
              return new URL(link).hostname.replace(/^www\./, "");
            } catch (_) {
              return "";
            }
          };
          const hostBoost = {
            "qconcursos.com": 1.95,
            "qconcursos.com.br": 1.95,
            "tecconcursos.com.br": 1.85,
            "gran.com.br": 1.55,
            "passeidireto.com": 1.35,
            "studocu.com": 1.05,
            "brainly.com.br": 0.72,
            "brainly.com": 0.7,
            "scribd.com": 0.55,
            "pt.scribd.com": 0.5
          };
          const hostPenalty = {
            "brainly.com.br": 0.5,
            "brainly.com": 0.5,
            "scribd.com": 0.75,
            "pt.scribd.com": 0.75
          };
          const stemTokens = toTokens(cleanQuery).slice(0, 12);
          const optionTokens = toTokens(optionHints.join(" ")).slice(0, 10);
          const rareTokens = unique([...toTokens(cleanQuery), ...toTokens(optionHints.join(" "))]).filter((t) => t.length >= 7).slice(0, 5);
          const scoreOrganic = (item, position = 0, queryBoost = 0, provider = "serper") => {
            const link = String(item?.link || "");
            const host = domainFromLink(link);
            const normHay = normalizeForMatch(`${item?.title || ""} ${item?.snippet || ""} ${link}`);
            let stemHits = 0;
            let optionHits = 0;
            let rareHits = 0;
            for (const t of stemTokens) if (normHay.includes(t)) stemHits += 1;
            for (const t of optionTokens) if (normHay.includes(t)) optionHits += 1;
            for (const t of rareTokens) if (normHay.includes(t)) rareHits += 1;
            const hostScore = hostBoost[host] || (host.endsWith(".gov.br") || host.endsWith(".edu.br") ? 1.5 : 0.65);
            const positionScore = Math.max(0, 1.25 - position * 0.11);
            const penalty = hostPenalty[host] || 0;
            const providerBoost = provider === "duckduckgo" ? -0.05 : 0.08;
            return stemHits * 0.42 + optionHits * 0.33 + rareHits * 0.2 + hostScore + positionScore + queryBoost + providerBoost - penalty;
          };
          const dedupeAndRank = (entries) => {
            const byLink = /* @__PURE__ */ new Map();
            for (const e of entries) {
              const link = String(e?.item?.link || "").trim();
              if (!link) continue;
              const prev = byLink.get(link);
              if (!prev || e.score > prev.score) byLink.set(link, e);
            }
            return Array.from(byLink.values()).sort((a, b) => b.score - a.score).map((e) => e.item);
          };
          const hasTrustedCoverage = (items) => {
            const hosts = new Set((items || []).map((it) => domainFromLink(it?.link || "")));
            return hosts.has("passeidireto.com") || hosts.has("qconcursos.com") || hosts.has("qconcursos.com.br") || hosts.has("tecconcursos.com.br") || Array.from(hosts).some((h) => h.endsWith(".gov.br") || h.endsWith(".edu.br"));
          };
          const buildQueryPlan = () => {
            const safe = cleanQuery.replace(/[:"']/g, "").slice(0, 200);
            const compactTokens = toTokens(cleanQuery).slice(0, 10).join(" ");
            const rareTokenQuery = rareTokens.slice(0, 3).join(" ");
            const exactQuery = safe ? `"${safe}"` : "";
            const plan = [
              { q: normalizeSpace(`${cleanQuery} resposta correta`), num: 10, boost: 0.55, label: "base" },
              { q: normalizeSpace(`${cleanQuery} gabarito`), num: 10, boost: 0.6, label: "gabarito" }
            ];
            if (hintQuery) {
              plan.push({ q: hintQuery, num: 10, boost: 0.78, label: "hint" });
            }
            if (hintQuery) {
              plan.push({ q: normalizeSpace(`${hintQuery} ${siteFilter}`).slice(0, 340), num: 8, boost: 0.62, label: "site-filter-hint" });
            }
            if (exactQuery.length > 20) {
              plan.push({ q: exactQuery, num: 10, boost: 0.9, label: "exact" });
            }
            if (compactTokens && compactTokens.length > 16) {
              plan.push({ q: normalizeSpace(`${compactTokens} gabarito`), num: 8, boost: 0.44, label: "compact" });
            }
            if (rareTokenQuery && rareTokenQuery.length > 8) {
              plan.push({ q: normalizeSpace(`${rareTokenQuery} ${cleanQuery.slice(0, 120)} gabarito`), num: 8, boost: 0.52, label: "rare" });
            }
            plan.push({ q: normalizeSpace(`${cleanQuery} ${siteFilter}`).slice(0, 340), num: 8, boost: 0.5, label: "site-filter" });
            return plan.filter((entry) => entry.q && entry.q.length >= 8);
          };
          try {
            console.log("AnswerHunter: Buscando resposta...");
            const pooled = [];
            const pushScored = (items, queryBoost, provider = "serper") => {
              (items || []).forEach((it, idx) => {
                pooled.push({
                  item: it,
                  score: scoreOrganic(it, idx, queryBoost, provider)
                });
              });
            };
            const plan = buildQueryPlan();
            const seenQueries = /* @__PURE__ */ new Set();
            let serperCalls = 0;
            let serperMeta = { answerBox: null, aiOverview: null, peopleAlsoAsk: null };
            const captureSerperMeta = (data) => {
              if (!data) return;
              if (!serperMeta.answerBox && data.answerBox) {
                serperMeta.answerBox = data.answerBox;
                console.log(`AnswerHunter: Captured answerBox from ${data.provider || providerMode}:`, JSON.stringify(data.answerBox).slice(0, 300));
              }
              if (!serperMeta.aiOverview && (data.aiOverview || data.ai_overview)) {
                serperMeta.aiOverview = data.aiOverview || data.ai_overview;
                console.log(`AnswerHunter: Captured aiOverview from ${data.provider || providerMode}:`, JSON.stringify(serperMeta.aiOverview).slice(0, 300));
              }
              if (!serperMeta.peopleAlsoAsk && data.peopleAlsoAsk && data.peopleAlsoAsk.length > 0) {
                serperMeta.peopleAlsoAsk = data.peopleAlsoAsk;
                console.log(`AnswerHunter: Captured ${data.peopleAlsoAsk.length} peopleAlsoAsk entries`);
              }
            };
            if (hasSerperKey) {
              const initialTasks = plan.slice(0, 4).filter((task) => {
                if (seenQueries.has(task.q)) return false;
                seenQueries.add(task.q);
                return true;
              });
              const initialResults = await Promise.all(initialTasks.map((task) => runSerper(task.q, task.num)));
              for (let _i = 0; _i < initialTasks.length; _i++) {
                const data = initialResults[_i];
                captureSerperMeta(data);
                pushScored(data?.organic || [], initialTasks[_i].boost, providerMode === "serpapi" ? "serpapi" : "serper");
                serperCalls += 1;
              }
            }
            let ranked = dedupeAndRank(pooled);
            if (hasSerperKey && (ranked.length < 10 || !hasTrustedCoverage(ranked.slice(0, 7)))) {
              for (const task of plan.slice(4)) {
                if (seenQueries.has(task.q)) continue;
                seenQueries.add(task.q);
                const data = await runSerper(task.q, task.num);
                captureSerperMeta(data);
                pushScored(data?.organic || [], task.boost, providerMode === "serpapi" ? "serpapi" : "serper");
                serperCalls += 1;
              }
              ranked = dedupeAndRank(pooled);
            }
            let fallbackProviderUsed = false;
            if (!hasSerperKey || ranked.length < 9 || !hasTrustedCoverage(ranked.slice(0, 8))) {
              const fallbackTasks = [
                { q: normalizeSpace(`${cleanQuery} gabarito`), boost: 0.36 },
                hintQuery ? { q: hintQuery, boost: 0.4 } : null,
                { q: normalizeSpace(`${cleanQuery} resposta correta`), boost: 0.34 }
              ].filter(Boolean);
              for (const task of fallbackTasks) {
                try {
                  const organic = await runDuckDuckGo(task.q, 8);
                  if (organic.length > 0) {
                    pushScored(organic, task.boost, "duckduckgo");
                    fallbackProviderUsed = true;
                  }
                } catch (fallbackErr) {
                  console.warn("AnswerHunter: Fallback provider failed:", fallbackErr);
                }
              }
              ranked = dedupeAndRank(pooled);
            }
            if (ranked.length > 0) {
              console.log(`AnswerHunter: Search diagnostics => provider=${providerMode}, providerCalls=${serperCalls}, fallbackProvider=${fallbackProviderUsed ? "duckduckgo" : "none"}, uniqueResults=${ranked.length}`);
              console.log(`AnswerHunter: ${ranked.length} resultados combinados e ranqueados (${hasSerperKey ? "Serper + fallback" : "fallback only"})`);
              const finalResults = ranked.slice(0, 12);
              finalResults._serperMeta = serperMeta;
              finalResults._searchProvider = providerMode;
              return finalResults;
            }
            return [];
          } catch (e) {
            console.error("AnswerHunter: Erro na busca:", e);
            return [];
          }
        },
        /**
         * Extract Options Locally (Regex) - Internal helper used in refinement
         */
        _extractOptionsLocally(sourceContent) {
          if (!sourceContent) return null;
          const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
          const normalized = sourceContent.replace(/\r\n/g, "\n");
          const byLines = () => {
            const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
            const options = [];
            const altStartRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
            let current = null;
            for (const line of lines) {
              const m = line.match(altStartRe);
              if (m) {
                if (current) options.push(current);
                current = { letter: m[1].toUpperCase(), body: clean(m[2]) };
              } else if (current) {
                current.body = clean(`${current.body} ${line}`);
              }
            }
            if (current) options.push(current);
            return options.length >= 2 ? options : null;
          };
          const byInline = () => {
            const options = [];
            const inlinePattern = /(^|[\s])([A-E])\s*[\)\.\-:]\s*([^\n]*?)(?=(?:\s)[A-E]\s*[\)\.\-:]|$)/gi;
            let m;
            while ((m = inlinePattern.exec(normalized)) !== null) {
              const letter = m[2].toUpperCase();
              const body = clean(m[3]);
              if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
          };
          const byPlain = () => {
            const options = [];
            const plainAltPattern = /(?:^|[.!?]\\s+)([A-E])\\s+([A-Za-z][^]*?)(?=(?:[.!?]\\s+)[A-E]\\s+[A-Za-z]|$)/g;
            let m;
            while ((m = plainAltPattern.exec(normalized)) !== null) {
              const letter = m[1].toUpperCase();
              const body = clean(m[2].replace(/\s+[.!?]\s*$/, ""));
              if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
          };
          const bySentencesAfterMarker = () => {
            const markers = [
              /(?:assinale|marque)\s+(?:a\s+)?(?:alternativa\s+)?(?:correta|verdadeira|incorreta|falsa)[.:]/gi,
              ,
              /(?:opção|alternativa)\s+(?:correta|verdadeira)[.:]/gi,
              /\(Ref\.?:\s*\d+\)/gi,
              /assinale\s+(?:a\s+)?(?:afirmativa|assertiva)\s+correta[.:]/gi
            ];
            let startIdx = -1;
            for (const marker of markers) {
              marker.lastIndex = 0;
              const match = marker.exec(sourceContent);
              if (match) {
                startIdx = match.index + match[0].length;
                break;
              }
            }
            if (startIdx === -1) {
              const questionMark = sourceContent.indexOf("?");
              if (questionMark > 30) {
                startIdx = questionMark + 1;
              } else {
                return null;
              }
            }
            let afterMarker = sourceContent.substring(startIdx).trim();
            afterMarker = afterMarker.replace(/\(Ref\.?:\s*\d+\)\s*/gi, "");
            const sentences = afterMarker.split(/(?<=[.!])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => {
              if (s.length < 20 || s.length > 500) return false;
              if (/^(Resposta|Gabarito|Correta|A resposta|portanto|letra\s+[A-E]|De acordo|Segundo)/i.test(s)) return false;
              if (/verificad[ao]|especialista|winnyfernandes|Excelente|curtidas|usuário|respondeu/i.test(s)) return false;
              return true;
            });
            if (sentences.length >= 3 && sentences.length <= 6) {
              const letters = ["A", "B", "C", "D", "E", "F"];
              return sentences.slice(0, 5).map((body, idx) => ({
                letter: letters[idx],
                body: clean(body.replace(/\.+$/, ""))
              }));
            }
            return null;
          };
          const byParagraphs = () => {
            const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
            const candidateOptions = [];
            let foundStartMarker = false;
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (/assinale|alternativa|opção|opções|correta[.:]|incorreta[.:]/i.test(line)) {
                foundStartMarker = true;
                continue;
              }
              if (/^(Resposta|Gabarito|Correta|Alternativa correta|A resposta|está correta|portanto|letra\s+[A-E])/i.test(line)) {
                break;
              }
              if (foundStartMarker) {
                if (line.length < 15 || line.length > 500) continue;
                if (line.endsWith("?") || line.endsWith(":")) continue;
                if (/verificad[ao]|especialista|curtidas|respondeu/i.test(line)) continue;
                candidateOptions.push(line);
              }
            }
            if (candidateOptions.length >= 3 && candidateOptions.length <= 6) {
              const letters = ["A", "B", "C", "D", "E", "F"];
              return candidateOptions.slice(0, 5).map((body, idx) => ({
                letter: letters[idx],
                body: clean(body)
              }));
            }
            return null;
          };
          const found = byLines() || byInline() || byPlain() || bySentencesAfterMarker() || byParagraphs();
          if (!found) return null;
          return found.map((o) => `${o.letter}) ${o.body}`).join("\n");
        },
        /**
         * Extracts options (A, B, C...) from any text
         */
        extractOptionsFromText(sourceContent) {
          const raw = this._extractOptionsLocally(sourceContent);
          if (!raw) return [];
          return raw.split("\n").map((line) => line.trim()).filter(Boolean);
        },
        /**
         * Extracts text from an image base64 dataUri using AI Vision
         */
        async aiExtractTextFromImage(dataUri) {
          if (!dataUri || !dataUri.startsWith("data:image/")) return "";
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelVision } = settings;
          const systemMsg = "Extraia rigorosamente o texto completo da imagem enviada. Responda APENAS com o texto, ignorando sauda\xE7\xF5es.";
          const visionMessages = [
            { role: "system", content: systemMsg },
            {
              role: "user",
              content: [
                { type: "text", text: "Transcri\xE7\xE3o fiel do conte\xFAdo (preservando formato, alternativas, c\xF3digo, tabelas):" },
                { type: "image_url", image_url: { url: dataUri } }
              ]
            }
          ];
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const base64Data = dataUri.split(",")[1];
              const mimeType = dataUri.split(";")[0].split(":")[1];
              const content = await this._callGemini([
                { role: "system", content: systemMsg },
                {
                  role: "user",
                  content: [
                    { inline_data: { mime_type: mimeType, data: base64Data } },
                    { text: "Transcri\xE7\xE3o fiel do conte\xFAdo:" }
                  ]
                }
              ], { temperature: 0.1, max_tokens: 1500, model: settings.geminiModel || "gemini-2.5-flash" });
              if (!content || content.length < 20) {
                console.warn("AnswerHunter: Gemini Vision OCR returned too little text:", (content || "").length);
                return null;
              }
              console.log(`AnswerHunter: Gemini Vision OCR success \u2014 ${content.length} chars extracted`);
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Gemini Vision OCR failed:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              const content = await this._callOpenRouter(visionMessages, {
                temperature: 0.1,
                max_tokens: 1500,
                model
              });
              if (!content || content.length < 20) {
                return null;
              }
              return content;
            } catch (e) {
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            const model = groqModelVision || "meta-llama/llama-4-scout-17b-16e-instruct";
            try {
              console.log(`AnswerHunter: Vision OCR \u2014 sending screenshot to Groq (${model})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model,
                  messages: visionMessages,
                  temperature: 0.1,
                  max_tokens: 1500
                })
              }));
              const content = (data.choices?.[0]?.message?.content || "").trim();
              if (content.length < 20) {
                console.warn("AnswerHunter: Groq Vision OCR returned too little text:", content.length);
                return null;
              }
              console.log(`AnswerHunter: Groq Vision OCR success \u2014 ${content.length} chars extracted`);
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Groq Vision OCR failed:", e?.message || e);
              return null;
            }
          };
          try {
            const primary = settings.primaryProvider || "groq";
            let result = null;
            if (primary === "openrouter") {
              result = await tryOpenRouter2();
              if (!result) result = await tryGroq();
              if (!result) result = await tryGemini();
            } else if (primary === "gemini") {
              result = await tryGemini();
              if (!result) result = await tryOpenRouter2();
              if (!result) result = await tryGroq();
            } else {
              result = await tryGroq();
              if (!result) result = await tryOpenRouter2();
              if (!result) result = await tryGemini();
            }
            return result || "";
          } catch (error) {
            console.error("AnswerHunter: Vision OCR failed:", error);
            return "";
          }
        },
        /**
         * Prompt 1: Extract options (AI)
         * Uses FAST model (1000 t/s) - simple extraction task
         */
        async extractOptionsFromSource(sourceContent) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelFast } = settings;
          const prompt = `Voce deve extrair APENAS as alternativas (opcoes A, B, C, D, E) do texto abaixo.

TEXTO DA FONTE:
${sourceContent}

REGRAS:
- Extraia APENAS as alternativas no formato: A) texto, B) texto, etc.
- Se nao houver alternativas claras, responda: SEM_OPCOES
- NAO invente alternativas
- NAO inclua o enunciado da pergunta

FORMATO DE SAIDA (apenas as alternativas):
A) [texto da alternativa A]
B) [texto da alternativa B]
C) [texto da alternativa C]
D) [texto da alternativa D]
E) [texto da alternativa E se houver]`;
          const systemMsg = "Voce extrai apenas alternativas de questoes. Responda APENAS com as alternativas no formato A) B) C) D) E) ou SEM_OPCOES.";
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.1, max_tokens: 500, model: settings.geminiModel || "gemini-2.5-flash" });
            } catch (e) {
              console.warn("AnswerHunter: Gemini extractOptionsFromSource error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.1, max_tokens: 500, model: "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter extractOptions error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: groqModelFast,
                  messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: prompt }
                  ],
                  temperature: 0.1,
                  max_tokens: 500
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq extractOptionsFromSource error:", e?.message || e);
              return null;
            }
          };
          try {
            const primary = settings.primaryProvider || "groq";
            let content = null;
            if (primary === "openrouter") {
              content = await tryOpenRouter2();
              if (!content) content = await tryGroq();
              if (!content) content = await tryGemini();
            } else if (primary === "gemini") {
              content = await tryGemini();
              if (!content) content = await tryGroq();
              if (!content) content = await tryOpenRouter2();
            } else {
              content = await tryGroq();
              if (!content) content = await tryOpenRouter2();
              if (!content) content = await tryGemini();
            }
            if (!content || content.includes("SEM_OPCOES")) return null;
            return content;
          } catch (error) {
            console.error("Erro ao extrair opcoes:", error);
            return null;
          }
        },
        /**
         * Multiple-attempt consensus voting with provider routing
         * Uses SMART model - complex reasoning task requiring precision
         */
        async _extractAnswerWithConsensus(originalQuestion, sourceContent, attempts = 3) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart, consensusVotingEnabled, consensusMinAttempts, consensusThreshold } = settings;
          if (!consensusVotingEnabled) return null;
          const maxAttempts = Math.max(2, Math.min(attempts, consensusMinAttempts || 2));
          const prompts = [
            // Prompt 1: Direct extraction
            `Analise a fonte e identifique a resposta correta para a quest\xE3o.

QUEST\xC3O:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

INSTRU\xC7\xD5ES:
- Identifique a letra da resposta correta (A, B, C, D ou E)
- Extraia o texto completo da alternativa correta
- Responda APENAS no formato: "Letra X: [texto completo da alternativa]"
- Se n\xE3o encontrar resposta clara, diga apenas: NAO_ENCONTRADO`,
            // Prompt 2: Step-by-step reasoning
            `AN\xC1LISE PASSO A PASSO:

QUEST\xC3O:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

PASSO 1: A fonte cont\xE9m um gabarito expl\xEDcito ("gabarito:", "resposta:", etc.)? Qual letra?
PASSO 2: Se n\xE3o houver gabarito expl\xEDcito, qual alternativa \xE9 confirmada como correta pela fonte?
PASSO 3: Resposta final no formato: "Letra X: [texto]"

Se n\xE3o houver evid\xEAncia: NAO_ENCONTRADO`,
            // Prompt 3: Evidence-based
            `IDENTIFICA\xC7\xC3O POR EVID\xCANCIAS:

QUEST\xC3O:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

Busque na fonte:
1. Marca\xE7\xF5es expl\xEDcitas: "gabarito", "correta", "resposta"
2. Explica\xE7\xF5es que confirmam uma alternativa espec\xEDfica
3. Coment\xE1rios de professores/especialistas

Formato de resposta: "Letra X: [texto]"
Se incerto: NAO_ENCONTRADO`
          ];
          const systemMsg = 'Voc\xEA extrai respostas de quest\xF5es de m\xFAltipla escolha. Sempre responda no formato "Letra X: [texto da alternativa]".';
          const runGroqConsensus = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return [];
            const responses2 = [];
            for (let i = 0; i < Math.min(maxAttempts, prompts.length); i++) {
              try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${groqApiKey}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    model: groqModelSmart,
                    messages: [
                      { role: "system", content: systemMsg },
                      { role: "user", content: prompts[i] }
                    ],
                    temperature: 0.05 + i * 0.05,
                    max_tokens: 250
                  })
                }));
                const content = data.choices?.[0]?.message?.content?.trim() || "";
                if (content && content.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA)/i.test(content)) {
                  responses2.push(content);
                }
              } catch (error) {
                console.warn(`AnswerHunter: Groq consensus attempt ${i + 1} failed:`, error);
              }
            }
            return responses2;
          };
          const runGeminiConsensus = async () => {
            if (!settings.geminiApiKey) return [];
            const geminiModel = settings.geminiModelSmart || "gemini-2.5-flash";
            const responses2 = [];
            for (let i = 0; i < Math.min(maxAttempts, prompts.length); i++) {
              try {
                const content = await this._callGemini([
                  { role: "system", content: systemMsg },
                  { role: "user", content: prompts[i] }
                ], { temperature: 0.05 + i * 0.05, max_tokens: 250, model: geminiModel, _noDowngrade: true });
                if (content && content.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA)/i.test(content)) {
                  responses2.push(content);
                }
              } catch (error) {
                console.warn(`AnswerHunter: Gemini consensus attempt ${i + 1} failed:`, error);
              }
            }
            return responses2;
          };
          const geminiPrimary = await this._isGeminiPrimary();
          let responses = geminiPrimary ? await runGeminiConsensus() : await runGroqConsensus();
          if (responses.length === 0) {
            responses = geminiPrimary ? await runGroqConsensus() : await runGeminiConsensus();
          }
          if (responses.length === 0) return null;
          const letterPattern = /(?:Letra|Letter)\s*([A-E])[:\s\)]/i;
          const votes = {};
          const fullResponses = {};
          for (const response of responses) {
            const match = response.match(letterPattern);
            if (match) {
              const letter = match[1].toUpperCase();
              votes[letter] = (votes[letter] || 0) + 1;
              if (!fullResponses[letter] || response.length > fullResponses[letter].length) {
                fullResponses[letter] = response;
              }
            }
          }
          if (Object.keys(votes).length === 0) return null;
          const sortedVotes = Object.entries(votes).sort((a, b) => b[1] - a[1]);
          const [winnerLetter, winnerCount] = sortedVotes[0];
          const confidence = winnerCount / responses.length;
          const threshold = consensusThreshold || 0.5;
          if (confidence < threshold && responses.length >= 2) {
            console.log(`AnswerHunter: Weak consensus (${confidence.toFixed(2)} < ${threshold}), votes:`, votes);
            return null;
          }
          console.log(`AnswerHunter: Consensus achieved - Letter ${winnerLetter} (${winnerCount}/${responses.length} votes, confidence: ${confidence.toFixed(2)})`);
          return fullResponses[winnerLetter];
        },
        /**
         * Prompt 2: Identify the correct answer (AI)
         * Uses hybrid approach: SMART for single attempt, consensus handles multi-attempt
         */
        async extractAnswerFromSource(originalQuestion, sourceContent) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const consensusAnswer = await this._extractAnswerWithConsensus(originalQuestion, sourceContent, 3);
          if (consensusAnswer) {
            console.log("AnswerHunter: Using consensus answer");
            return consensusAnswer;
          }
          const prompt = `Analise a fonte e identifique a resposta correta para a quest\xE3o.

QUEST\xC3O:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

INSTRU\xC7\xD5ES:
- Identifique a letra da resposta correta (A, B, C, D ou E)
- Extraia o texto completo da alternativa correta
- Responda APENAS no formato: "Letra X: [texto completo da alternativa]"
- Se n\xE3o encontrar resposta clara, diga apenas: NAO_ENCONTRADO`;
          const systemMsg = 'Voc\xEA extrai respostas de quest\xF5es de m\xFAltipla escolha. Sempre responda no formato "Letra X: [texto da alternativa]".';
          const parseResponse = (content) => {
            if (!content || content.length < 3) return null;
            if (/^(NAO_ENCONTRADO|SEM_RESPOSTA|INVALIDO|N[ãa]o\s+(encontr|consigo|h[áa]))/i.test(content)) return null;
            if (/NAO_ENCONTRADO|SEM_RESPOSTA/i.test(content)) return null;
            return content;
          };
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const content = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.1, max_tokens: 200, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              console.log("AnswerHunter: Resposta Gemini bruta:", content);
              return parseResponse((content || "").trim());
            } catch (e) {
              console.warn("AnswerHunter: Gemini extractAnswerFromSource error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.1, max_tokens: 200, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: prompt }
                  ],
                  temperature: 0.1,
                  max_tokens: 200
                })
              }));
              const content = data?.choices?.[0]?.message?.content?.trim() || "";
              console.log("AnswerHunter: Resposta Groq bruta:", content);
              return parseResponse(content);
            } catch (e) {
              console.warn("AnswerHunter: Groq extractAnswerFromSource error:", e?.message || e);
              return null;
            }
          };
          try {
            const geminiPrimary = await this._isGeminiPrimary();
            let result = null;
            if (geminiPrimary) {
              result = await tryGemini();
              if (!result) result = await tryGroq();
            } else {
              result = await tryGroq();
              if (!result) result = await tryGemini();
            }
            return result;
          } catch (error) {
            console.error("Erro ao extrair resposta:", error);
            return null;
          }
        },
        /**
         * Infer answer based on evidence (answer key/comments)
         * Enhanced with per-alternative evaluation & polarity awareness + Consensus voting
         * Uses SMART model (280 t/s) - most complex reasoning task
         */
        async inferAnswerFromEvidence(originalQuestion, sourceContent, options = {}) {
          const { isDesperate = false } = options;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const normQ = originalQuestion.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const wantsIncorrect = /\b(falsa|incorreta|errada|exceto|nao\s+correta)\b/i.test(normQ);
          const polarityNote = wantsIncorrect ? "\n\u26A0\uFE0F ATEN\xC7\xC3O: A quest\xE3o pede a alternativa INCORRETA/FALSA/EXCETO. Voc\xEA deve encontrar a alternativa ERRADA, n\xE3o a correta." : "";
          const basePrompt = `INFER\xCANCIA DE RESPOSTA COM BASE EM EVID\xCANCIAS

QUEST\xC3O DO CLIENTE:
${originalQuestion.substring(0, 2e3)}

EVID\xCANCIAS DAS FONTES:
${sourceContent.substring(0, 3500)}
${polarityNote}

INSTRU\xC7\xD5ES - siga EXATAMENTE esta ordem:

PASSO 1: Leitura atenta do enunciado
- Identifique o ASPECTO ESPEC\xCDFICO que a quest\xE3o pede (ex: desempenho, seguran\xE7a, flexibilidade, etc.).
- A quest\xE3o pede a alternativa CORRETA ou INCORRETA/FALSA/EXCETO?
- N\xE3o basta uma alternativa ser "verdadeira" \u2014 ela precisa responder ao que o ENUNCIADO pergunta.

PASSO 2: An\xE1lise das evid\xEAncias/explica\xE7\xF5es das fontes
- Procure textos explicativos, justificativas ou defini\xE7\xF5es nas fontes.
- Identifique trechos que mencionem conceitos presentes nas alternativas.
- Conecte cada trecho explicativo \xE0 alternativa que ele descreve.
- IMPORTANTE: Preste aten\xE7\xE3o em frases como "isso se deve a...", "o motivo \xE9...", "por conta de...", que revelam a rela\xE7\xE3o causal.

PASSO 3: Classifica\xE7\xE3o de cada alternativa
Para cada alternativa (A-E):
- Essa alternativa trata do ASPECTO ESPEC\xCDFICO pedido no enunciado? (sim/n\xE3o)
- As evid\xEAncias CONFIRMAM ou REFUTAM essa alternativa para o aspecto pedido?
- Classifique como V (verdadeira E responde ao enunciado) ou F (falsa OU n\xE3o responde ao aspecto pedido).

PASSO 4: Resposta FINAL
- Se apenas UMA alternativa \xE9 V e responde ao aspecto pedido, essa \xE9 a resposta.
- Se m\xFAltiplas s\xE3o V, releia o enunciado e escolha a mais PRECISA para o aspecto pedido.
- Se as fontes t\xEAm texto explicativo que aponta para uma alternativa, PRIORIZE essa evid\xEAncia.

FORMATO FINAL OBRIGAT\xD3RIO (\xFAltima linha):
Letra X: [texto completo da alternativa]

Se n\xE3o houver evid\xEAncia suficiente: NAO_ENCONTRADO

REGRAS:
- Nunca invente alternativas que n\xE3o estejam na quest\xE3o do cliente.
- O ENUNCIADO define o crit\xE9rio: responda ao que ele PERGUNTA, n\xE3o ao que parece "mais correto" em geral.
- Textos explicativos/justificativos nas fontes s\xE3o a evid\xEAncia mais valiosa \u2014 use-os.
${isDesperate ? `
ATEN\xC7\xC3O - EVID\xCANCIA LIMITADA:
As fontes acima cont\xEAm informa\xE7\xE3o limitada e podem n\xE3o ter a resposta expl\xEDcita.
Nesse caso, use seu CONHECIMENTO ACAD\xCAMICO para avaliar cada alternativa:
- Foque EXCLUSIVAMENTE no ASPECTO ESPEC\xCDFICO pedido no enunciado (ex: "desempenho", "seguran\xE7a", etc.).
- Uma alternativa pode ser VERDADEIRA sobre o tema geral mas N\xC3O responder ao aspecto espec\xEDfico pedido.
- Exemplo: se a quest\xE3o pede sobre "desempenho", caracter\xEDsticas de "flexibilidade" ou "linguagem" N\xC3O s\xE3o sobre desempenho.
- Elimine primeiro alternativas factualmente INCORRETAS.
- Depois, entre as corretas, escolha a que tem rela\xE7\xE3o CAUSAL DIRETA com o aspecto pedido.
- O modelo de transa\xE7\xF5es (ACID vs BASE) afeta diretamente throughput/lat\xEAncia = desempenho.
- Schemaless afeta flexibilidade, n\xE3o desempenho. Escalabilidade horizontal \u2260 vertical.` : ""}`;
          const sinceLastGroq = Date.now() - this.lastGroqCallAt;
          const preInferenceCooldown = 4e3;
          if (sinceLastGroq < preInferenceCooldown) {
            const waitMs = preInferenceCooldown - sinceLastGroq;
            console.log(`AnswerHunter: Pre-inference cooldown ${waitMs}ms (last Groq call ${sinceLastGroq}ms ago)`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
          const systemMsg = 'Voc\xEA infere respostas de quest\xF5es educacionais com base em evid\xEAncias de fontes. Analise textos explicativos, justificativas e defini\xE7\xF5es nas fontes para encontrar qual alternativa responde ao ASPECTO ESPEC\xCDFICO do enunciado. N\xE3o se limite a verificar se uma alternativa \xE9 "verdadeira" \u2014 ela precisa responder ao que o enunciado PERGUNTA. Formato final: "Letra X: [texto]" ou NAO_ENCONTRADO.';
          const letterPattern = /(?:Letra|Letter)\s*([A-E])[:\s\)]/i;
          const geminiPrimary = await this._isGeminiPrimary();
          const chatgptPrimaryInfer = settings.primaryProvider === "chatgpt" && this._chatgptQuotaExhaustedUntil <= Date.now();
          if (chatgptPrimaryInfer) {
            console.log(`AnswerHunter: Inference via ChatGPT (primary, model=${settings.chatgptModel || "gpt-5.2"})...`);
            const chatgptResult = await this._callChatGPT([
              { role: "system", content: systemMsg },
              { role: "user", content: basePrompt }
            ], { model: settings.chatgptModel || "gpt-5.2" });
            if (chatgptResult) {
              console.log(`AnswerHunter: ChatGPT inference success (${chatgptResult.length} chars)`);
              return chatgptResult;
            }
            console.log("AnswerHunter: ChatGPT inference failed \u2014 trying Groq fallback...");
          }
          if (geminiPrimary) {
            console.log("AnswerHunter: Inference via Gemini (primary)...");
            const gResult = await this._geminiConsensus(systemMsg, basePrompt, letterPattern, { smart: true });
            if (gResult.response) {
              console.log("AnswerHunter: Gemini primary inference votes:", gResult.votes);
              return gResult.response;
            }
            console.log("AnswerHunter: Gemini primary failed \u2014 trying Groq fallback...");
            const groqResult2 = await this._groqConsensus(systemMsg, basePrompt, letterPattern, { model: groqModelSmart });
            if (groqResult2.response) {
              console.log("AnswerHunter: Groq fallback inference votes:", groqResult2.votes);
              return groqResult2.response;
            }
            return null;
          }
          console.log("AnswerHunter: Inference via Groq (primary)...");
          const groqResult = await this._groqConsensus(systemMsg, basePrompt, letterPattern, { model: groqModelSmart });
          if (groqResult.response && groqResult.attempts.length > 0) {
            console.log("AnswerHunter: Groq primary inference votes:", groqResult.votes);
            return groqResult.response;
          }
          console.log("AnswerHunter: Groq primary failed \u2014 trying Gemini fallback...");
          const geminiResult = await this._geminiConsensus(systemMsg, basePrompt, letterPattern, { smart: true });
          if (geminiResult.response) {
            console.log("AnswerHunter: Gemini fallback inference votes:", geminiResult.votes);
            return geminiResult.response;
          }
          return null;
        },
        async generateOverviewFromEvidence(questionText, evidenceItems = []) {
          if (!questionText || !Array.isArray(evidenceItems) || evidenceItems.length === 0) return null;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelOverview, groqModelSmart } = settings;
          const modelCandidates = [
            groqModelOverview,
            "openai/gpt-oss-120b",
            groqModelSmart,
            "llama-3.3-70b-versatile"
          ].filter((m, idx, arr) => typeof m === "string" && m.trim() && arr.indexOf(m) === idx);
          const compactEvidence = evidenceItems.slice(0, 6).map((item, index) => {
            const title = String(item?.title || `Fonte ${index + 1}`).slice(0, 180);
            const link = String(item?.link || "").slice(0, 500);
            const text = String(item?.text || "").replace(/\s+/g, " ").slice(0, 850);
            return `FONTE ${index + 1}
TITULO: ${title}
LINK: ${link || "n/a"}
TRECHO: ${text}`;
          }).join("\n\n");
          const prompt = `Voc\xEA vai gerar um overview curto e \xFAtil (estilo Google AI Overview), SEM inventar fatos.

QUEST\xC3O:
${String(questionText).slice(0, 1800)}

EVID\xCANCIAS:
${compactEvidence}

RETORNE APENAS JSON v\xE1lido no formato:
{
  "summary": "resumo em 2-4 frases, objetivo",
  "keyPoints": ["ponto 1", "ponto 2", "ponto 3"],
  "references": [
    {"title": "nome curto da fonte", "link": "https://..."}
  ]
}

REGRAS:
- Use apenas o que est\xE1 nas evid\xEAncias.
- Se houver conflito ou baixa clareza, mencione isso no summary.
- keyPoints: no m\xE1ximo 4 itens.
- references: no m\xE1ximo 5 itens.
- N\xE3o inclua markdown, coment\xE1rio ou texto fora do JSON.`;
          const sysMsg = "Voc\xEA transforma evid\xEAncias em resumo estruturado e confi\xE1vel. Nunca invente links, cita\xE7\xF5es ou fatos fora da entrada.";
          const parseOverview = (raw, modelLabel) => {
            if (!raw) return null;
            const start = raw.indexOf("{");
            const end = raw.lastIndexOf("}");
            if (start < 0 || end <= start) return null;
            try {
              const parsed = JSON.parse(raw.slice(start, end + 1));
              const summary = String(parsed?.summary || "").trim();
              if (!summary) return null;
              const keyPoints = Array.isArray(parsed?.keyPoints) ? parsed.keyPoints.map((p) => String(p || "").trim()).filter(Boolean).slice(0, 4) : [];
              const references = Array.isArray(parsed?.references) ? parsed.references.map((ref) => ({
                title: String(ref?.title || "").trim(),
                link: String(ref?.link || "").trim()
              })).filter((ref) => ref.title || ref.link).slice(0, 5) : [];
              console.log(`AnswerHunter: Overview generated with model=${modelLabel}`);
              return { summary, keyPoints, references, model: modelLabel };
            } catch {
              return null;
            }
          };
          const geminiPrimary = await this._isGeminiPrimary();
          if (geminiPrimary) {
            try {
              console.log("AnswerHunter: Overview via Gemini (primary)...");
              const geminiRaw = await this._callGemini([
                { role: "system", content: sysMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.1, max_tokens: 700 });
              const result = parseOverview(geminiRaw, "gemini-primary");
              if (result) return result;
            } catch (gErr) {
              console.warn("AnswerHunter: Gemini primary overview failed:", gErr?.message || String(gErr));
            }
            console.log("AnswerHunter: Gemini overview failed \u2014 trying Groq fallback...");
          }
          for (const model of modelCandidates) {
            const sinceLast = Date.now() - this.lastGroqCallAt;
            if (sinceLast < 3e3) {
              await new Promise((resolve) => setTimeout(resolve, 3e3 - sinceLast));
            }
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model,
                  messages: [
                    { role: "system", content: sysMsg },
                    { role: "user", content: prompt }
                  ],
                  temperature: 0.1,
                  max_tokens: 700
                })
              }));
              const raw = data?.choices?.[0]?.message?.content?.trim() || "";
              const result = parseOverview(raw, model);
              if (result) return result;
            } catch (error) {
              const errMsg = error?.message || String(error);
              console.warn(`AnswerHunter: overview model failed (${model}):`, errMsg);
              if (errMsg.includes("GROQ_QUOTA_EXHAUSTED")) break;
            }
          }
          if (!geminiPrimary) {
            try {
              console.log("AnswerHunter: Groq overview failed \u2014 trying Gemini fallback...");
              const geminiRaw = await this._callGemini([
                { role: "system", content: sysMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.1, max_tokens: 700 });
              const result = parseOverview(geminiRaw, "gemini-fallback");
              if (result) return result;
            } catch (gErr) {
              console.warn("AnswerHunter: Gemini overview fallback failed:", gErr?.message || String(gErr));
            }
          }
          return null;
        },
        /**
         * Knowledge-based answer: uses LLM domain expertise when evidence is thin.
         * Runs in parallel with inferAnswerFromEvidence during desperate mode.
         * Single call, no consensus needed — acts as a tiebreaker vote.
         */
        async generateKnowledgeAnswer(questionText) {
          if (!questionText) return null;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const normQ = questionText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const wantsIncorrect = /\b(falsa|incorreta|errada|exceto|nao\s+correta)\b/i.test(normQ);
          const polarityNote = wantsIncorrect ? "\n\u26A0\uFE0F A quest\xE3o pede a alternativa INCORRETA/FALSA/EXCETO." : "";
          const prompt = `AN\xC1LISE ACAD\xCAMICA POR ELIMINA\xC7\xC3O

Voc\xEA \xE9 um professor universit\xE1rio especialista. Use EXCLUSIVAMENTE seu conhecimento acad\xEAmico.

QUEST\xC3O:
${questionText.substring(0, 2e3)}
${polarityNote}

INSTRU\xC7\xD5ES \u2014 siga esta ordem RIGOROSA:

1. ASPECTO PEDIDO: Identifique qual aspecto espec\xEDfico o enunciado pergunta (ex: desempenho, seguran\xE7a, modelo, etc.).

2. ELIMINA\xC7\xC3O: Para cada alternativa, an\xE1lise em 1 linha:
   - \xC9 factualmente CORRETA? Se N\xC3O \u2192 eliminada.
   - Trata DIRETAMENTE do aspecto pedido? Se N\xC3O \u2192 eliminada (mesmo sendo verdadeira).
   Formato: "X) ELIMINADA \u2014 [motivo]" ou "X) MANTIDA \u2014 [rela\xE7\xE3o com o aspecto]"

3. SELE\xC7\xC3O FINAL: Entre as mantidas, escolha a que tem rela\xE7\xE3o CAUSAL mais direta com o aspecto.
   - N\xE3o escolha a "mais famosa" \u2014 escolha a mais ESPEC\xCDFICA para o aspecto pedido.

FORMATO FINAL (\xFAltima linha):
Letra X: [texto completo da alternativa]
Ou: NAO_ENCONTRADO`;
          const systemMsg = "Voc\xEA \xE9 um professor universit\xE1rio especialista em an\xE1lise de quest\xF5es. Responda com rigor acad\xEAmico, focando no ASPECTO ESPEC\xCDFICO que o enunciado pede. N\xE3o escolha a alternativa mais popular \u2014 escolha a mais precisa para o aspecto pedido.";
          const isValid = (c) => c && c.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA|INCONCLUSIVO)/i.test(c);
          const geminiPrimary = await this._isGeminiPrimary();
          const tryGroq = async () => {
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
                  temperature: 0.1,
                  max_tokens: 600
                })
              }));
              const c = data?.choices?.[0]?.message?.content?.trim() || "";
              if (isValid(c)) {
                console.log("AnswerHunter: Knowledge answer (Groq):", c.substring(0, 120));
                return c;
              }
            } catch (e) {
              console.warn("AnswerHunter: Knowledge Groq failed:", e);
            }
            return null;
          };
          const tryGemini = async () => {
            try {
              const r = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], {
                temperature: 0.1,
                max_tokens: 600,
                model: settings.geminiModelSmart || "gemini-2.5-flash"
              });
              const c = r?.trim() || "";
              if (isValid(c)) {
                console.log("AnswerHunter: Knowledge answer (Gemini):", c.substring(0, 120));
                return c;
              }
            } catch (e) {
              console.warn("AnswerHunter: Knowledge Gemini failed:", e);
            }
            return null;
          };
          if (geminiPrimary) {
            const res2 = await tryGemini();
            if (res2) return res2;
            return await tryGroq();
          }
          const res = await tryGroq();
          if (res) return res;
          return await tryGemini();
        },
        /**
         * Main refinement function (3-Steps)
         */
        async refineWithGroq(item) {
          console.log("AnswerHunter: Iniciando refinamento com 3 prompts...");
          const originalQuestion = item.question;
          const hasOptionsInOriginal = /[A-E]\s*[\)\.]\s*\S+/i.test(originalQuestion);
          let options = null;
          let optionsPromise = null;
          if (!hasOptionsInOriginal && item.answer && item.answer.length > 30) {
            options = this._extractOptionsLocally(item.answer);
            if (!options) {
              optionsPromise = this.extractOptionsFromSource(item.answer);
            }
          }
          const answerPromise = this.inferAnswerFromEvidence(originalQuestion, item.answer);
          const [answer, optionsFromGroq] = await Promise.all([
            answerPromise,
            optionsPromise ? optionsPromise : Promise.resolve(null)
          ]);
          if (!options && optionsFromGroq) options = optionsFromGroq;
          console.log("AnswerHunter: Resposta identificada:", answer ? "Sim" : "Nao");
          if (!answer) {
            return null;
          }
          let finalQuestion = originalQuestion;
          if (!hasOptionsInOriginal && options) {
            finalQuestion = originalQuestion + "\n" + options;
          }
          return {
            question: finalQuestion.trim(),
            answer: answer.trim()
          };
        },
        /**
         * Fallback: generate answer directly by AI when there are no sources
         * Uses anti-hallucination prompt: evaluates each alternative individually,
         * checks for contradictions, then selects.
         * NOW WITH CONSENSUS VOTING for unreliable models
         * Uses SMART model (280 t/s) - requires deep reasoning without external evidence
         */
        async generateAnswerFromQuestion(questionText) {
          if (!questionText) return null;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const hasOptions = /\b[A-E]\s*[).\-]\s/m.test(questionText);
          const prompt = hasOptions ? `AN\xC1LISE SISTEM\xC1TICA DE QUEST\xC3O DE M\xDALTIPLA ESCOLHA

QUEST\xC3O:
${questionText}

INSTRU\xC7\xD5ES - siga EXATAMENTE esta ordem:

PASSO 1: Classifique CADA alternativa como V (verdadeira) ou F (falsa), com uma justificativa OBJETIVA de 1 linha baseada em fatos/defini\xE7\xF5es.
Formato: "X) V/F - [justificativa]"

PASSO 2: Verifique contradi\xE7\xF5es:
- H\xE1 duas alternativas dizendo a mesma coisa? 
- A quest\xE3o pede a CORRETA ou a INCORRETA/FALSA/EXCETO?

PASSO 3: Com base nos passos anteriores, indique a resposta FINAL.
Se a quest\xE3o pede a CORRETA: escolha a alternativa V.
Se a quest\xE3o pede a INCORRETA/FALSA/EXCETO: escolha a alternativa F.

FORMATO FINAL (\xFAltima linha):
- Se houver seguran\xE7a razo\xE1vel: "Letra X: [texto completo da alternativa escolhida]"
- Se n\xE3o houver seguran\xE7a suficiente: "INCONCLUSIVO: sem evid\xEAncia suficiente para marcar alternativa"

REGRAS:
- Nunca invente alternativas que n\xE3o estejam na quest\xE3o.
- Se houver d\xFAvida real entre duas alternativas, use INCONCLUSIVO.
- Preste aten\xE7\xE3o especial se a quest\xE3o pede "incorreta", "falsa", "exceto" ou "n\xE3o \xE9".` : `Responda a quest\xE3o abaixo de forma direta e objetiva.

QUEST\xC3O:
${questionText}

REGRAS:
- Responda em 1 a 3 frases.
- N\xE3o invente cita\xE7\xF5es.`;
          if (hasOptions) {
            const mcSystemMsg = "Voc\xEA \xE9 um especialista em an\xE1lise de quest\xF5es de m\xFAltipla escolha. Seja conservador: quando faltar evid\xEAncia clara, responda INCONCLUSIVO em vez de chutar.";
            const mcLetterPattern = /[*_]{0,2}(?:Letra|Letter|Alternativa|Resposta\s+(?:correta|final))[:\s*_]{0,4}[*_]{0,2}\s*([A-E])\b|\b([A-E])\s*[).]\s*(?:V\b|verdadeira|correta)/i;
            const CANT_ANSWER_RE = /\b(não\s+(pode(mos)?|é\s+possível)\s+(ser\s+)?respondida?|sem\s+o\s+código|preciso\s+(do\s+)?código|código.{0,50}(não\s+está|ausente|faltando|não\s+foi\s+fornecido)|contexto\s+(adicional|visual)\s+necessário|imagem\s+(não|sem)|necessário\s+ver\s+o\s+código|não\s+tenho\s+acesso\s+ao\s+código|código\s+sql.{0,30}não|without\s+the\s+(code|image)|cannot\s+answer\s+without)\b/i;
            const geminiPrimary = await this._isGeminiPrimary();
            const openrouterPrimary = settings.primaryProvider === "openrouter" && !!settings.openrouterApiKey && this._openRouterQuotaExhaustedUntil <= Date.now();
            const chatgptPrimary = settings.primaryProvider === "chatgpt" && this._chatgptQuotaExhaustedUntil <= Date.now();
            const tabulateGroqAttempts = (attempts) => {
              const asksIncorrect = /\b(incorreta|falsa|exceto|nao\s+e|não\s+é|errada)\b/i.test(questionText);
              const votes = {};
              const fullResponses = {};
              let validVoteCount = 0;
              for (const response of attempts) {
                if (!response || /^INCONCLUSIVO/i.test(response)) continue;
                const normalized = String(response);
                const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                const lastLine = lines.length > 0 ? lines[lines.length - 1] : normalized.trim();
                let match = lastLine.match(/(?:^|\b)(?:resposta\s+final|resposta\s+correta|resposta)\s*[:\-–]\s*(?:letra\s*)?[*_]*([A-E])[*_]*/i);
                if (!match) match = lastLine.match(/(?:^|\b)(?:letra|letter|alternativa)\s*[*_]*([A-E])\b/i);
                if (!match) match = normalized.match(/(?:resposta\s+final|resposta\s+correta|resposta)\s*[:\-–]\s*(?:letra\s*)?[*_]*([A-E])[*_]*/i);
                if (!match) match = normalized.match(/(?:letra|letter|alternativa)\s*[*_]*([A-E])\b/i);
                if (!match) match = normalized.match(/\*\*([A-E])\*\*/);
                if (!match) match = normalized.match(/\b([A-E])\s*\)\s*(?:é\s+)?(?:a\s+)?(?:incorreta|correta|errada|falsa|verdadeira)/i);
                if (!match) {
                  const vfMatches2 = [...normalized.matchAll(/\b([A-E])\s*\)\s*[*_]*\s*([VF])\b/gi)];
                  if (vfMatches2.length >= 2) {
                    const targetMark = asksIncorrect ? "F" : "V";
                    const targetEntries = vfMatches2.filter((m) => String(m[2]).toUpperCase() === targetMark);
                    if (targetEntries.length === 1) {
                      const inferredLetter = String(targetEntries[0][1]).toUpperCase();
                      match = [null, inferredLetter];
                      console.log(`AnswerHunter: MC V/F inference \u2192 Letter ${inferredLetter} (single ${targetMark} found)`);
                    }
                  }
                }
                if (!match) continue;
                const vfMatches = [...normalized.matchAll(/\b([A-E])\)\s*([VF])\b/gi)];
                if (vfMatches.length >= 2) {
                  const vCount = vfMatches.filter((m) => String(m[2]).toUpperCase() === "V").length;
                  const fCount = vfMatches.filter((m) => String(m[2]).toUpperCase() === "F").length;
                  if (!asksIncorrect && vCount > 1 || asksIncorrect && fCount > 1) continue;
                }
                const letter = String(match[1]).toUpperCase();
                validVoteCount += 1;
                votes[letter] = (votes[letter] || 0) + 1;
                if (!fullResponses[letter] || response.length > fullResponses[letter].length) {
                  fullResponses[letter] = response;
                }
              }
              if (validVoteCount === 0) {
                for (let i = 0; i < attempts.length; i++) {
                  if (attempts[i]) console.log(`AnswerHunter: MC attempt[${i}] preview (${attempts[i].length} chars): "${attempts[i].slice(0, 200)}"`);
                }
                return null;
              }
              const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
              const [winnerLetter, winnerCount] = sorted[0];
              const secondCount = sorted[1]?.[1] || 0;
              const hasRobustConsensus = winnerCount >= 2 && winnerCount > secondCount && winnerCount / validVoteCount >= 0.6;
              if (hasRobustConsensus) {
                console.log(`AnswerHunter: MC consensus \u2192 Letter ${winnerLetter} (${winnerCount}/${validVoteCount})`);
                return fullResponses[winnerLetter];
              }
              console.log(`AnswerHunter: MC soft-winner \u2192 Letter ${winnerLetter} (${winnerCount}/${validVoteCount}, low confidence)`);
              return fullResponses[winnerLetter];
            };
            if (chatgptPrimary) {
              console.log(`AnswerHunter: MC via ChatGPT (primary, model=${settings.chatgptModel || "gpt-5.2"})...`);
              const chatgptAttempts = [];
              for (let i = 0; i < 2; i++) {
                const content = await this._callChatGPT([
                  { role: "system", content: mcSystemMsg },
                  { role: "user", content: prompt }
                ], { model: settings.chatgptModel || "gpt-5.2" });
                if (content) chatgptAttempts.push(content);
              }
              if (chatgptAttempts.length > 0) {
                const tabulated = tabulateGroqAttempts(chatgptAttempts);
                if (tabulated) return tabulated;
              }
              console.log("AnswerHunter: ChatGPT MC failed \u2014 trying Groq fallback...");
            }
            if (geminiPrimary) {
              console.log("AnswerHunter: MC via Gemini (primary)...");
              const gResult2 = await this._geminiConsensus(mcSystemMsg, prompt, mcLetterPattern, { smart: true });
              if (gResult2.response) {
                console.log("AnswerHunter: Gemini primary MC votes:", gResult2.votes);
                if (!gResult2.winner && CANT_ANSWER_RE.test(gResult2.response)) {
                  console.log("AnswerHunter: Gemini primary MC \u2014 missing context detected, returning INCONCLUSIVO");
                  return "INCONCLUSIVO: c\xF3digo ou contexto visual n\xE3o dispon\xEDvel para resolver a quest\xE3o.";
                }
                return gResult2.response;
              }
              console.log("AnswerHunter: Gemini MC failed \u2014 trying Groq fallback...");
              const groqResult2 = await this._groqConsensus(mcSystemMsg, prompt, mcLetterPattern, {
                model: groqModelSmart,
                temps: [0.12, 0.28]
                // 2 attempts to preserve quota
              });
              if (groqResult2.attempts.length > 0) {
                const tabulated = tabulateGroqAttempts(groqResult2.attempts);
                if (tabulated) return tabulated;
                if (groqResult2.winner && groqResult2.response) {
                  console.log(`AnswerHunter: Groq MC soft-winner (Gemini-primary fallback) \u2192 Letter ${groqResult2.winner} (single vote)`);
                  return groqResult2.response;
                }
              }
              return "INCONCLUSIVO: sem consenso confi\xE1vel entre tentativas da IA.";
            }
            if (openrouterPrimary) {
              console.log("AnswerHunter: MC via OpenRouter (primary)...");
              const openrouterAttempts = [];
              for (const temp of [0.12, 0.28]) {
                const content = await this._callOpenRouter([
                  { role: "system", content: mcSystemMsg },
                  { role: "user", content: prompt }
                ], {
                  model: settings.openrouterModelSmart || "deepseek/deepseek-r1:free",
                  temperature: temp,
                  max_tokens: 700
                });
                if (content) openrouterAttempts.push(content);
              }
              if (openrouterAttempts.length > 0) {
                const tabulated = tabulateGroqAttempts(openrouterAttempts);
                if (tabulated) return tabulated;
              }
              console.log("AnswerHunter: OpenRouter MC failed \u2014 trying Groq fallback...");
            }
            const groqResult = await this._groqConsensus(mcSystemMsg, prompt, mcLetterPattern, {
              model: groqModelSmart,
              temps: [0.12, 0.28]
              // 2 attempts to preserve quota
            });
            if (groqResult.attempts.length > 0) {
              const tabulated = tabulateGroqAttempts(groqResult.attempts);
              if (tabulated) return tabulated;
              if (groqResult.winner && groqResult.response) {
                console.log(`AnswerHunter: Groq MC soft-winner \u2192 Letter ${groqResult.winner} (single vote, low confidence)`);
                return groqResult.response;
              }
            }
            console.log("AnswerHunter: Groq MC failed \u2014 trying Gemini fallback...");
            const gResult = await this._geminiConsensus(mcSystemMsg, prompt, mcLetterPattern, { smart: true });
            if (gResult.response) {
              console.log("AnswerHunter: Gemini MC fallback votes:", gResult.votes);
              if (!gResult.winner && CANT_ANSWER_RE.test(gResult.response)) {
                console.log("AnswerHunter: Gemini MC fallback \u2014 missing context detected, returning INCONCLUSIVO");
                return "INCONCLUSIVO: c\xF3digo ou contexto visual n\xE3o dispon\xEDvel para resolver a quest\xE3o.";
              }
              return gResult.response;
            }
            return "INCONCLUSIVO: sem evid\xEAncia suficiente para marcar alternativa.";
          }
          const geminiPrimaryOpen = await this._isGeminiPrimary();
          const openrouterPrimaryOpen = settings.primaryProvider === "openrouter" && !!settings.openrouterApiKey && this._openRouterQuotaExhaustedUntil <= Date.now();
          const chatgptPrimaryOpen = settings.primaryProvider === "chatgpt" && this._chatgptQuotaExhaustedUntil <= Date.now();
          const openSysMsg = "Voc\xEA \xE9 um assistente que responde quest\xF5es com objetividade.";
          if (chatgptPrimaryOpen) {
            console.log(`AnswerHunter: Open-ended via ChatGPT (primary, model=${settings.chatgptModel || "gpt-5.2"})...`);
            const chatgptOpen = await this._callChatGPT([
              { role: "system", content: openSysMsg },
              { role: "user", content: prompt }
            ], { model: settings.chatgptModel || "gpt-5.2" });
            if (chatgptOpen) return chatgptOpen;
            console.log("AnswerHunter: ChatGPT open-ended failed \u2014 trying Groq fallback...");
          }
          if (openrouterPrimaryOpen) {
            const openrouterOpen = await this._callOpenRouter([
              { role: "system", content: openSysMsg },
              { role: "user", content: prompt }
            ], {
              model: settings.openrouterModelSmart || "deepseek/deepseek-r1:free",
              temperature: 0.15,
              max_tokens: 300
            });
            if (openrouterOpen) return openrouterOpen;
          }
          if (geminiPrimaryOpen) {
            const geminiOpen = await this._callGemini([
              { role: "system", content: openSysMsg },
              { role: "user", content: prompt }
            ], { temperature: 0.15, max_tokens: 300 });
            if (geminiOpen) return geminiOpen;
          }
          if (settings.groqApiKey && this._groqQuotaExhaustedUntil <= Date.now()) {
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [
                    { role: "system", content: openSysMsg },
                    { role: "user", content: prompt }
                  ],
                  temperature: 0.15,
                  max_tokens: 300
                })
              }));
              const content = data.choices?.[0]?.message?.content?.trim() || "";
              if (content && content.length > 5 && !/^(NAO_ENCONTRADO|INCONCLUSIVO)/i.test(content)) return content;
            } catch (error) {
              console.warn("AnswerHunter: Groq open-ended failed:", error?.message || String(error));
            }
          }
          console.log("AnswerHunter: Trying Gemini fallback for open-ended...");
          const geminiOpenFallback = await this._callGemini([
            { role: "system", content: openSysMsg },
            { role: "user", content: prompt }
          ], { temperature: 0.15, max_tokens: 300 });
          if (geminiOpenFallback) return geminiOpenFallback;
          return null;
        },
        /**
         * Define a term in context (contextual dictionary tooltip)
         */
        async defineTerm(term, contextText = "") {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelFast } = settings;
          const systemMsg = "Voc\xEA \xE9 um dicion\xE1rio educacional conciso. Defina termos de forma clara e breve (2-3 linhas).";
          const prompt = contextText ? `Defina o termo "${term}" considerando o seguinte contexto educacional:

${contextText.slice(0, 500)}

Defini\xE7\xE3o breve:` : `Defina o termo "${term}" de forma breve e educacional. Defini\xE7\xE3o:`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.2, max_tokens: 150, model: settings.geminiModel || "gemini-2.5-flash" });
            } catch (e) {
              console.warn("AnswerHunter: Gemini defineTerm error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, {
                temperature: 0.1,
                max_tokens: 600,
                model: settings.geminiModelSmart || "gemini-2.5-flash"
              });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelFast,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
                  temperature: 0.2,
                  max_tokens: 150
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq defineTerm error:", e?.message || e);
              return null;
            }
          };
          const geminiPrimary = false;
          const settingsForFallback = await this._getSettings();
          const primary = settingsForFallback.primaryProvider || "groq";
          let chain = [];
          if (typeof tryOpenRouter2 !== "undefined") {
            chain = [tryGroq, tryOpenRouter2, tryGemini];
            if (primary === "openrouter") chain = [tryOpenRouter2, tryGemini, tryGroq];
            else if (primary === "gemini") chain = [tryGemini, tryOpenRouter2, tryGroq];
          } else {
            chain = [tryGroq, tryGemini];
            if (primary === "gemini") chain = [tryGemini, tryGroq];
          }
          let result = null;
          for (const fn of chain) {
            result = await fn();
            if (result) break;
          }
          return result || `Termo n\xE3o encontrado: ${term}`;
        },
        /**
         * Generate a step-by-step tutor explanation for a question and answer
         */
        async generateTutorExplanation(question, answer, context = "") {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const systemMsg = `Voc\xEA \xE9 um professor paciente, did\xE1tico e experiente. Sua \xDANICA tarefa \xE9 explicar POR QUE a resposta do GABARITO est\xE1 correta, de forma que qualquer estudante entenda completamente o racioc\xEDnio.

\u26A0\uFE0F REGRA ABSOLUTA: A resposta correta \xE9 EXATAMENTE a que est\xE1 indicada no GABARITO abaixo. Voc\xEA N\xC3O pode discordar do gabarito. Sua explica\xE7\xE3o DEVE obrigatoriamente justificar essa resposta espec\xEDfica do gabarito, mesmo que voc\xEA pessoalmente pensasse diferente.`;
          const prompt = `QUEST\xC3O:
${question.slice(0, 1500)}

GABARITO (resposta correta definitiva \u2014 N\xC3O discorde):
${answer.slice(0, 800)}

${context ? `CONTEXTO ADICIONAL:
${context.slice(0, 300)}
` : ""}FORMATO OBRIGAT\xD3RIO DA EXPLICA\xC7\xC3O:

1. Comece com: "\u2705 Resposta correta: [copie exatamente a letra e/ou texto da resposta do gabarito]"

2. **Contexto do tema** \u2014 Em 2-3 frases, explique o assunto/tema da quest\xE3o de forma simples, como se o aluno nunca tivesse visto o tema antes.

3. **Racioc\xEDnio passo a passo** \u2014 Numere cada etapa do racioc\xEDnio (1., 2., 3., ...) que leva \xE0 resposta do gabarito:
   - Use linguagem simples e direta
   - D\xEA exemplos pr\xE1ticos quando poss\xEDvel
   - Conecte cada passo ao anterior

4. **Por que as outras alternativas est\xE3o erradas** \u2014 Para cada alternativa incorreta, explique brevemente (1 frase) por que est\xE1 errada. Use o formato: "\u274C Alternativa X: [motivo]"

5. Finalize com: "\u{1F4A1} Resumo: [1 frase que sintetize o conceito-chave]"

REGRAS:
- Linguagem CLARA e ACESS\xCDVEL \u2014 imagine que est\xE1 ensinando a um aluno do ensino m\xE9dio
- M\xE1ximo 450 palavras
- NUNCA contradiga o gabarito \u2014 se o gabarito diz que a resposta \xE9 X, justifique X
- Use **negrito** para termos importantes
- Se a quest\xE3o n\xE3o tiver alternativas, foque nos passos 1, 2, 3 e 5`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.3, max_tokens: 1e3, model: settings.geminiModelSmart || "gemini-2.5-flash" });
            } catch (e) {
              console.warn("AnswerHunter: Gemini generateTutorExplanation error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.3, max_tokens: 1e3, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
                  temperature: 0.3,
                  max_tokens: 1e3
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq generateTutorExplanation error:", e?.message || e);
              return null;
            }
          };
          const geminiPrimary = false;
          const settingsForFallback = await this._getSettings();
          const primary = settingsForFallback.primaryProvider || "groq";
          let chain = [];
          if (typeof tryOpenRouter2 !== "undefined") {
            if (primary === "openrouter") chain = [tryOpenRouter2, tryGemini, tryGroq];
            else if (primary === "gemini") chain = [tryGemini, tryOpenRouter2, tryGroq];
            else chain = [tryGroq, tryOpenRouter2, tryGemini];
          } else {
            if (primary === "gemini") chain = [tryGemini, tryGroq];
            else chain = [tryGroq, tryGemini];
          }
          let result = null;
          for (const fn of chain) {
            result = await fn();
            if (result) break;
          }
          return result || "N\xE3o foi poss\xEDvel gerar a explica\xE7\xE3o. Tente novamente.";
        },
        /**
         * Generate a concise review/study card for a question — flashcard style
         * Returns a structured text for spaced-repetition review
         */
        async generateReviewCard(question, answer, context = "") {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const systemMsg = `Voc\xEA \xE9 um especialista em t\xE9cnicas de estudo e memoriza\xE7\xE3o (Anki, flashcards, revis\xE3o espa\xE7ada). Crie fichas de revis\xE3o objetivas e memor\xE1veis.`;
          const prompt = `Crie uma FICHA DE REVIS\xC3O concisa para o estudante memorizar o conte\xFAdo desta quest\xE3o.

QUEST\xC3O:
${question.slice(0, 1500)}

GABARITO:
${answer.slice(0, 800)}

${context ? `CONTEXTO:
${context.slice(0, 300)}
` : ""}FORMATO OBRIGAT\xD3RIO:

\u{1F4CC} CONCEITO-CHAVE
[Nome do conceito/tema principal testado \u2014 1 linha]

\u{1F4D6} DEFINI\xC7\xC3O R\xC1PIDA
[Defini\xE7\xE3o objetiva do conceito em 2-3 frases curtas. Sem enrola\xE7\xE3o.]

\u{1F511} O QUE MEMORIZAR
- [Ponto essencial 1]
- [Ponto essencial 2]
- [Ponto essencial 3]
- [F\xF3rmula ou regra se aplic\xE1vel]

\u26A0\uFE0F PEGADINHAS COMUNS
- [Erro comum 1 que bancas exploram]
- [Erro comum 2]

\u{1F9E0} DICA DE MEMORIZA\xC7\xC3O
[Uma t\xE9cnica mnem\xF4nica, analogia ou macete para lembrar \u2014 seja criativo e marcante]

\u{1F517} TEMAS RELACIONADOS
[Liste 2-3 temas que o aluno deve estudar junto]

REGRAS:
- M\xE1ximo 250 palavras
- Linguagem direta, sem floreios
- Foque no que CAI EM PROVA
- Use **negrito** para termos-chave
- A ficha deve funcionar como material de revis\xE3o r\xE1pida antes da prova`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.4, max_tokens: 800, model: settings.geminiModelSmart || "gemini-2.5-flash" });
            } catch (e) {
              console.warn("AnswerHunter: Gemini generateReviewCard error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = { temperature: 0.4, max_tokens: 800, model: settings.openrouterModelSmart || "deepseek/deepseek-r1:free" };
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter generateReviewCard error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
                  temperature: 0.4,
                  max_tokens: 800
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq generateReviewCard error:", e?.message || e);
              return null;
            }
          };
          const settingsForFallback = await this._getSettings();
          const primary = settingsForFallback.primaryProvider || "groq";
          let chain = [];
          if (primary === "openrouter") chain = [tryOpenRouter2, tryGemini, tryGroq];
          else if (primary === "gemini") chain = [tryGemini, tryOpenRouter2, tryGroq];
          else chain = [tryGroq, tryOpenRouter2, tryGemini];
          let result = null;
          for (const fn of chain) {
            result = await fn();
            if (result) break;
          }
          return result || "N\xE3o foi poss\xEDvel gerar a ficha de revis\xE3o. Tente novamente.";
        },
        /**
         * Generate a similar multiple-choice question to test the user's knowledge
         * Returns { questionText, optionsMap, answerLetter } or throws on failure
         */
        async generateSimilarQuestion(originalQuestion) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const systemMsg = "Voc\xEA cria quest\xF5es de m\xFAltipla escolha educacionais. Responda APENAS em JSON v\xE1lido, sem texto adicional.";
          const prompt = `Com base na quest\xE3o abaixo, crie UMA quest\xE3o similar de m\xFAltipla escolha com 4 alternativas (A, B, C, D).

QUEST\xC3O ORIGINAL:
${originalQuestion.slice(0, 1e3)}

FORMATO DE RESPOSTA (JSON exato, sem markdown):
{
  "questionText": "enunciado da nova quest\xE3o",
  "optionsMap": {
    "A": "texto da alternativa A",
    "B": "texto da alternativa B",
    "C": "texto da alternativa C",
    "D": "texto da alternativa D"
  },
  "answerLetter": "A"
}

REGRAS:
- A quest\xE3o deve testar o mesmo conceito, mas com abordagem diferente
- Apenas UMA alternativa deve ser correta
- As alternativas incorretas devem ser plaus\xEDveis
- Responda APENAS com o JSON, sem explica\xE7\xF5es adicionais`;
          const parseResponse = (content) => {
            if (!content) return null;
            try {
              const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
              const parsed = JSON.parse(cleaned);
              if (!parsed.questionText || !parsed.optionsMap || !parsed.answerLetter) return null;
              return parsed;
            } catch (_) {
              return null;
            }
          };
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const content = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], { temperature: 0.5, max_tokens: 500, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              return parseResponse(content);
            } catch (e) {
              console.warn("AnswerHunter: Gemini generateSimilarQuestion error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.5, max_tokens: 500, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
                  temperature: 0.5,
                  max_tokens: 500
                })
              }));
              return parseResponse(data?.choices?.[0]?.message?.content?.trim() || "");
            } catch (e) {
              console.warn("AnswerHunter: Groq generateSimilarQuestion error:", e?.message || e);
              return null;
            }
          };
          const geminiPrimary = false;
          const settingsForFallback = await this._getSettings();
          const primary = settingsForFallback.primaryProvider || "groq";
          let chain = [];
          if (typeof tryOpenRouter2 !== "undefined") {
            if (primary === "openrouter") chain = [tryOpenRouter2, tryGemini, tryGroq];
            else if (primary === "gemini") chain = [tryGemini, tryOpenRouter2, tryGroq];
            else chain = [tryGroq, tryOpenRouter2, tryGemini];
          } else {
            if (primary === "gemini") chain = [tryGemini, tryGroq];
            else chain = [tryGroq, tryGemini];
          }
          let result = null;
          for (const fn of chain) {
            result = await fn();
            if (result) break;
          }
          if (!result) throw new Error("N\xE3o foi poss\xEDvel gerar uma quest\xE3o similar.");
          return result;
        },
        /**
         * Answer a follow-up question from the user in the context of a previous question/answer
         */
        async answerFollowUp(originalQuestion, originalAnswer, context, userMessage, messageHistory = []) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const systemMsg = `Voc\xEA \xE9 um tutor educacional. O estudante acabou de resolver uma quest\xE3o e tem d\xFAvidas.
Quest\xE3o original: ${originalQuestion.slice(0, 800)}
Resposta correta: ${originalAnswer.slice(0, 300)}
${context ? `Contexto: ${context.slice(0, 200)}` : ""}

Responda de forma clara, did\xE1tica e concisa (m\xE1ximo 200 palavras). N\xE3o repita a quest\xE3o inteira.`;
          const recentHistory = messageHistory.slice(-6);
          const messages = [
            { role: "system", content: systemMsg },
            ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: userMessage }
          ];
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              return await this._callGemini(messages, {
                temperature: 0.3,
                max_tokens: 400,
                model: settings.geminiModel || "gemini-2.5-flash"
              });
            } catch (e) {
              console.warn("AnswerHunter: Gemini answerFollowUp error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages,
                  temperature: 0.3,
                  max_tokens: 400
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq answerFollowUp error:", e?.message || e);
              return null;
            }
          };
          const geminiPrimary = false;
          const settingsForFallback = await this._getSettings();
          const primary = settingsForFallback.primaryProvider || "groq";
          let chain = [];
          if (typeof tryOpenRouter !== "undefined") {
            if (primary === "openrouter") chain = [tryOpenRouter, tryGemini, tryGroq];
            else if (primary === "gemini") chain = [tryGemini, tryOpenRouter, tryGroq];
            else chain = [tryGroq, tryOpenRouter, tryGemini];
          } else {
            if (primary === "gemini") chain = [tryGemini, tryGroq];
            else chain = [tryGroq, tryGemini];
          }
          let result = null;
          for (const fn of chain) {
            result = await fn();
            if (result) break;
          }
          return result || "N\xE3o foi poss\xEDvel processar sua pergunta. Tente novamente.";
        },
        async generateTags(questionText) {
          const settings = await this._getSettings();
          const prompt = `Analise a quest\xE3o abaixo e gere de 3 a 5 tags/categorias que descrevam o tema acad\xEAmico.

QUEST\xC3O:
${questionText.slice(0, 600)}

Responda APENAS com um JSON array de strings, sem explica\xE7\xF5es. Exemplo:
["Biologia", "Gen\xE9tica", "DNA Replica\xE7\xE3o"]

REGRAS:
- Tags curtas (1-3 palavras)
- Do mais geral para o mais espec\xEDfico
- Em portugu\xEAs
- Sem tags gen\xE9ricas como "Quest\xE3o" ou "M\xFAltipla Escolha"`;
          const parseResponse = (content) => {
            if (!content) return null;
            try {
              const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
              const parsed = JSON.parse(cleaned);
              if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 5);
              return null;
            } catch (_) {
              const match = content.match(/\[.*?\]/s);
              if (match) {
                try {
                  return JSON.parse(match[0]).slice(0, 5);
                } catch (_2) {
                  return null;
                }
              }
              return null;
            }
          };
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const content = await this._callGemini([
                { role: "system", content: "Voc\xEA classifica quest\xF5es academicamente. Responda apenas em JSON." },
                { role: "user", content: prompt }
              ], { temperature: 0.3, max_tokens: 100, model: settings.geminiModel || "gemini-2.5-flash" });
              return parseResponse(content);
            } catch (e) {
              console.warn("AnswerHunter: Gemini generateTags error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!settings.groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const content = await this._callGroq([
                { role: "system", content: "Classifique a quest\xE3o em JSON array de tags acad\xE9micas. Responda s\xF3 JSON." },
                { role: "user", content: prompt }
              ], { temperature: 0.3, max_tokens: 100, model: settings.groqModelSmart });
              return parseResponse(content);
            } catch (e) {
              console.warn("AnswerHunter: Groq generateTags error:", e?.message || e);
              return null;
            }
          };
          const result = await tryGemini() || await tryGroq();
          return result || [];
        }
      };
    }
  });

  // src/services/search/QuestionParser.js
  var QuestionParser;
  var init_QuestionParser = __esm({
    "src/services/search/QuestionParser.js"() {
      QuestionParser = {
        // ── Text normalization ─────────────────────────────────────────────────────
        stripOptionTailNoise(text) {
          if (!text) return "";
          let cleaned = String(text).replace(/\s+/g, " ").trim();
          const noiseMarker = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parabéns|você\s+acertou|confira\s+o\s+gabarito|explicação)\b/i;
          const idx = cleaned.search(noiseMarker);
          if (idx > 20) cleaned = cleaned.slice(0, idx).trim();
          return cleaned.replace(/[;:,\-.\s]+$/g, "").trim();
        },
        normalizeOption(text) {
          return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^[a-e]\s*[\)\.\-:]\s*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
        },
        looksLikeCodeOption(text) {
          const body = String(text || "");
          return /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|->|jsonb?|\bdb\.\w|\.(?:find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(body);
        },
        normalizeCodeAwareOption(text) {
          return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^[a-e]\s*[\)\.\-:]\s*/i, "").replace(/->>|/g, " op_json_text ").replace(/->/g, " op_json_obj ").replace(/=>/g, " op_arrow ").replace(/::/g, " op_dcolon ").replace(/:=/g, " op_assign ").replace(/!=/g, " op_neq ").replace(/<>/g, " op_neq ").replace(/<=/g, " op_lte ").replace(/>=/g, " op_gte ").replace(/</g, " op_lt ").replace(/>/g, " op_gt ").replace(/:/g, " op_colon ").replace(/=/g, " op_eq ").replace(/[^a-z0-9_]+/g, " ").replace(/\s+/g, " ").trim();
        },
        isUsableOptionBody(body) {
          const cleaned = String(body || "").replace(/\s+/g, " ").trim();
          if (!cleaned || cleaned.length < 1) return false;
          if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(cleaned)) return false;
          if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(cleaned)) return false;
          if (/^(?:resposta|gabarito|alternativa\s+correta)\b/i.test(cleaned)) return false;
          return true;
        },
        // ── Question structure ─────────────────────────────────────────────────────
        extractQuestionStem(questionWithOptions) {
          const text = (questionWithOptions || "").replace(/\r\n/g, "\n");
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const optionRe = /^([A-E])\s*[\)\.\-:]/i;
          const stemLines = [];
          for (const line of lines) {
            if (optionRe.test(line)) break;
            stemLines.push(line);
          }
          let stem = stemLines.join(" ").trim() || text.trim();
          const inlineOpt = stem.match(/[\s:;]([A-E])\s*[\)\.\-:]\s+/i);
          if (inlineOpt && Number.isFinite(inlineOpt.index) && inlineOpt.index > 30) {
            stem = stem.slice(0, inlineOpt.index).trim();
          }
          return stem.slice(0, 600);
        },
        extractOptionsFromQuestion(questionText) {
          if (!questionText) return [];
          const text = String(questionText || "").replace(/\r\n/g, "\n");
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const options = [];
          const seen = /* @__PURE__ */ new Set();
          const seenBodies = /* @__PURE__ */ new Set();
          const _codeDedupKey = (body) => this.normalizeCodeAwareOption(body).replace(/\s+/g, "");
          const optionRe = /^["'""\u2018\u2019\(\[]?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
          for (const line of lines) {
            const m2 = line.match(optionRe);
            if (!m2) continue;
            const letter = (m2[1] || "").toUpperCase();
            const cleanedBody = this.stripOptionTailNoise(m2[2]);
            const normalizedBody = this.normalizeOption(cleanedBody);
            const isCodeLike = this.looksLikeCodeOption(cleanedBody);
            const dedupKey = isCodeLike ? _codeDedupKey(cleanedBody) : normalizedBody;
            const duplicateBody = seenBodies.has(dedupKey);
            if (!this.isUsableOptionBody(cleanedBody) || !normalizedBody || seen.has(letter) || !isCodeLike && duplicateBody) continue;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
            if (!isCodeLike) seenBodies.add(dedupKey);
          }
          const inlineRe = /(?:^|[\n\r\t ;"'""''])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;"'""''][A-E]\s*[\)\.\-:]\s)|$)/gi;
          let m;
          while ((m = inlineRe.exec(text)) !== null) {
            const letter = (m[1] || "").toUpperCase();
            if (!letter || seen.has(letter)) continue;
            const cleanedBody = this.stripOptionTailNoise(m[2]);
            const normalizedBody = this.normalizeOption(cleanedBody);
            const isCodeLike = this.looksLikeCodeOption(cleanedBody);
            const inlineDedupKey = isCodeLike ? _codeDedupKey(cleanedBody) : normalizedBody;
            const duplicateBody = seenBodies.has(inlineDedupKey);
            if (!this.isUsableOptionBody(cleanedBody) || !normalizedBody || !isCodeLike && duplicateBody) continue;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
            if (!isCodeLike) seenBodies.add(inlineDedupKey);
            if (seen.size >= 5) break;
          }
          const stemNorm = this.normalizeOption(this.extractQuestionStem(text));
          const expectsCodeOptions = /\b(?:sql|jsonb?|insert|update|delete|select|comando|sintaxe|codigo)\b/i.test(stemNorm);
          if (expectsCodeOptions && options.length >= 4) {
            const parsed = options.map((line) => {
              const mm = String(line || "").match(/^([A-E])\)\s*(.+)$/i);
              const letter = (mm?.[1] || "").toUpperCase();
              const body = this.stripOptionTailNoise(mm?.[2] || "");
              const codeLike = this.looksLikeCodeOption(body);
              return { letter, body, codeLike };
            }).filter((o) => /^[A-E]$/.test(o.letter) && !!o.body);
            const codeEntries = parsed.filter((o) => o.codeLike);
            const nonCodeEntries = parsed.filter((o) => !o.codeLike);
            const allLetters = parsed.map((o) => o.letter).sort();
            const expectedLettersForCount = ["A", "B", "C", "D", "E"].slice(0, allLetters.length);
            const isCompleteSequence = allLetters.join("") === expectedLettersForCount.join("");
            if (codeEntries.length >= 3 && nonCodeEntries.length >= 1 && !isCompleteSequence) {
              return codeEntries.map((o) => `${o.letter}) ${o.body}`);
            }
          }
          return options;
        },
        buildOptionsMap(questionText) {
          const options = this.extractOptionsFromQuestion(questionText);
          const map = {};
          for (const opt of options) {
            const m = opt.match(/^([A-E])\)\s*(.+)$/i);
            if (m) map[m[1].toUpperCase()] = this.stripOptionTailNoise(m[2]);
          }
          return map;
        },
        // ── Answer letter parsing ──────────────────────────────────────────────────
        parseAnswerLetter(answerText) {
          if (!answerText) return null;
          const text = String(answerText).replace(/\r/g, "\n").trim();
          if (!text) return null;
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const finalLineRe = /^(?:(?:resposta\s+final|conclus[aã]o|gabarito)\s*[:\-]\s*)?(?:letra|gabarito|resposta\s+final|alternativa\s+correta|letter|option)\s*[:\-]?\s*([A-E])\b(?:\s*[:.·\-]|$)/i;
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
            const m = lines[i].match(finalLineRe);
            if (m) return (m[1] || "").toUpperCase();
          }
          const taggedMatches = [...text.matchAll(/(?:^|\b)(?:resposta\s+final|gabarito|alternativa\s+correta|letra|letter|option)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
          const uniqueTagged = [...new Set(taggedMatches)];
          if (uniqueTagged.length === 1) return uniqueTagged[0];
          if (uniqueTagged.length > 1) return null;
          const prosePatterns = [
            /(?:resposta|answer)\s+(?:correta\s+)?(?:[eéÉ]|seria)\s+(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi,
            /(?:alternativa|opção|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?([A-E])\b/gi,
            /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi
          ];
          for (const re of prosePatterns) {
            const proseHits = [...text.matchAll(re)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
            const uniqueProse = [...new Set(proseHits)];
            if (uniqueProse.length === 1) return uniqueProse[0];
          }
          const optionLineMatches = [...text.matchAll(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s+/gim)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
          const uniqueOptionLines = [...new Set(optionLineMatches)];
          if (uniqueOptionLines.length === 1) return uniqueOptionLines[0];
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            if (lastLine.length < 40) {
              const bareMatch = lastLine.match(/\b([A-E])\b/i);
              if (bareMatch) return bareMatch[1].toUpperCase();
            }
          }
          return null;
        },
        parseAnswerText(answerText) {
          if (!answerText) return "";
          const text = String(answerText).replace(/\r/g, "\n").trim();
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const finalBodyRe = /(?:letra|alternativa|letter|option)\s*[A-E]\s*[:.·\-]\s*(.{5,})/i;
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
            const m = lines[i].match(finalBodyRe);
            if (m && m[1]) return m[1].trim();
          }
          return text.replace(/^(?:Letra|Alternativa|Letter|Option)\s*[A-E]\s*[:.·\-]?\s*/i, "").replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, "").trim();
        },
        findLetterByAnswerText(answerBody, optionsMap) {
          if (!answerBody || !optionsMap) return null;
          const normalizedAnswer = this.normalizeOption(answerBody);
          if (!normalizedAnswer || normalizedAnswer.length < 20) return null;
          const normalizedEntries = Object.entries(optionsMap).map(([letter, body]) => [letter, this.normalizeOption(body)]).filter(([, body]) => !!body && body.length >= 8);
          if (normalizedEntries.length < 2) return null;
          const containsHits = normalizedEntries.filter(([, body]) => normalizedAnswer.includes(body));
          if (containsHits.length >= 2) return null;
          const finalChunkNorm = this.normalizeOption(String(answerBody).slice(-420));
          let bestLetter = null;
          let bestScore = 0;
          normalizedEntries.forEach(([letter, normalizedBody]) => {
            if (!normalizedBody) return;
            const inFinalChunk = finalChunkNorm.includes(normalizedBody);
            const inFullAnswer = normalizedAnswer.includes(normalizedBody);
            if (inFinalChunk || inFullAnswer) {
              const score = normalizedBody.length + (inFinalChunk ? 120 : 0);
              if (score > bestScore) {
                bestScore = score;
                bestLetter = letter;
              }
            }
          });
          return bestLetter;
        },
        // ── Tokenization & similarity ──────────────────────────────────────────────
        extractKeyTokens(stem) {
          const stop = /* @__PURE__ */ new Set([
            "assinale",
            "afirmativa",
            "alternativa",
            "correta",
            "incorreta",
            "resposta",
            "gabarito",
            "que",
            "qual",
            "quais",
            "como",
            "para",
            "por",
            "com",
            "sem",
            "uma",
            "um",
            "de",
            "da",
            "do",
            "das",
            "dos",
            "na",
            "no",
            "nas",
            "nos",
            "ao",
            "aos",
            "as",
            "os",
            "e",
            "ou",
            "em"
          ]);
          const tokens = this.normalizeOption(stem).split(" ").filter(Boolean);
          return tokens.filter((t) => t.length >= 5 && !stop.has(t)).slice(0, 10);
        },
        countTokenHits(text, tokens) {
          if (!text || !tokens || tokens.length === 0) return 0;
          const normalized = this.normalizeOption(text);
          let hits = 0;
          for (const t of tokens) {
            if (normalized.includes(t)) hits++;
          }
          return hits;
        },
        /**
         * Extracts discriminative tokens from option bodies (NOT present in the stem).
         * These help distinguish one question from another on the same topic/page.
         */
        extractOptionTokens(questionText) {
          const options = this.extractOptionsFromQuestion(questionText);
          if (options.length < 2) return [];
          const stem = this.extractQuestionStem(questionText);
          const stemTokenSet = new Set(this.extractKeyTokens(stem));
          const stemNorm = this.normalizeOption(stem);
          for (const w of stemNorm.split(/\s+/)) {
            if (w.length >= 3) stemTokenSet.add(w);
          }
          const tokenFreq = /* @__PURE__ */ new Map();
          const optionCount = options.length;
          for (const rawOpt of options) {
            const m = String(rawOpt || "").match(/^([A-E])\)\s*(.+)$/i);
            const body = m ? this.stripOptionTailNoise(m[2]) : "";
            if (!body) continue;
            const isCode = this.looksLikeCodeOption(body);
            const normalized = isCode ? this.normalizeCodeAwareOption(body) : this.normalizeOption(body);
            if (!normalized) continue;
            const seenInThisOption = /* @__PURE__ */ new Set();
            for (const w of normalized.split(/\s+/).filter(Boolean)) {
              if (w.length >= 3 && !stemTokenSet.has(w) && !seenInThisOption.has(w)) {
                seenInThisOption.add(w);
                tokenFreq.set(w, (tokenFreq.get(w) || 0) + 1);
              }
            }
          }
          const maxFreq = Math.ceil(optionCount / 2);
          return [...tokenFreq.entries()].filter(([, count]) => count <= maxFreq).sort((a, b) => a[1] - b[1]).map(([token]) => token).slice(0, 8);
        },
        diceSimilarity(a, b) {
          if (!a || !b) return 0;
          if (a === b) return 1;
          const bigrams = (s) => {
            const set = /* @__PURE__ */ new Map();
            for (let i = 0; i < s.length - 1; i++) {
              const bg = s.substring(i, i + 2);
              set.set(bg, (set.get(bg) || 0) + 1);
            }
            return set;
          };
          const bga = bigrams(a);
          const bgb = bigrams(b);
          let intersection = 0;
          for (const [bg, count] of bga) {
            intersection += Math.min(count, bgb.get(bg) || 0);
          }
          return 2 * intersection / (a.length - 1 + b.length - 1) || 0;
        },
        questionSimilarityScore(sourceText, questionStem) {
          if (!sourceText || !questionStem) return 0;
          const srcNorm = this.normalizeOption(sourceText);
          const stemNorm = this.normalizeOption(questionStem);
          const stemTokens = stemNorm.split(/\s+/).filter((t) => t.length >= 4);
          const srcTokens = new Set(srcNorm.split(/\s+/).filter((t) => t.length >= 4));
          if (stemTokens.length === 0) return 0;
          let hits = 0;
          for (const t of stemTokens) {
            if (srcTokens.has(t)) hits++;
          }
          const tokenScore = hits / stemTokens.length;
          const prefix = stemNorm.slice(0, 50);
          const prefixMatch = prefix.length >= 20 && srcNorm.includes(prefix) ? 0.3 : 0;
          const diceScore = this.diceSimilarity(stemNorm.slice(0, 120), srcNorm.slice(0, Math.min(srcNorm.length, 500)));
          return Math.min(1, tokenScore * 0.5 + prefixMatch + diceScore * 0.3);
        },
        detectQuestionPolarity(questionText) {
          const text = String(questionText || "").toLowerCase();
          const incorrectMarkers = /\b(?:incorreta|errada|falsa|inv[áa]lida|n[aã]o\s+(?:[eé]|est[aá])|incorreto|errado|falso|inv[áa]lido)\b/;
          const correctMarkers = /\b(?:correta|verdadeira|v[áa]lida|certa|correto|verdadeiro|v[áa]lido|certo)\b/;
          const incorrectScore = (text.match(incorrectMarkers) || []).length;
          const correctScore = (text.match(correctMarkers) || []).length;
          return incorrectScore > correctScore ? "INCORRECT" : "CORRECT";
        },
        /**
         * Creates a canonical string from question + options for hashing/dedup.
         */
        canonicalizeQuestion(questionText) {
          const stem = this.extractQuestionStem(questionText);
          const options = this.extractOptionsFromQuestion(questionText);
          const normStem = this.normalizeOption(stem).replace(/\s+/g, " ").trim();
          const normOpts = (options || []).map((o) => this.normalizeOption(o).replace(/\s+/g, " ").trim()).sort();
          return `${normStem}||${normOpts.join("|")}`;
        }
      };
    }
  });

  // src/services/search/OptionsMatchService.js
  var OptionsMatchService;
  var init_OptionsMatchService = __esm({
    "src/services/search/OptionsMatchService.js"() {
      init_QuestionParser();
      OptionsMatchService = {
        // ── Coverage ──────────────────────────────────────────────────────────────
        /**
         * Counts how many of the user's options appear in the free-form source text.
         * Returns { hits, total, ratio, hasEnoughOptions }
         */
        optionsCoverageInFreeText(originalOptions, sourceText) {
          if (!originalOptions || originalOptions.length < 2) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
          }
          if (!sourceText || sourceText.length < 80) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
          }
          const normalizedSource = QuestionParser.normalizeOption(sourceText);
          if (!normalizedSource) return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
          const optionEntries = [];
          const seen = /* @__PURE__ */ new Set();
          for (const rawOpt of originalOptions) {
            const cleaned = QuestionParser.stripOptionTailNoise(rawOpt);
            if (!cleaned) continue;
            const isCodeLike = QuestionParser.looksLikeCodeOption(cleaned);
            const normalized = isCodeLike ? QuestionParser.normalizeCodeAwareOption(cleaned) : QuestionParser.normalizeOption(cleaned);
            if (!normalized) continue;
            const dedupKey = isCodeLike ? `code:${normalized.replace(/\s+/g, "")}` : `text:${normalized}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            optionEntries.push({ normalized, isCodeLike });
          }
          const total = optionEntries.length;
          if (total === 0) return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
          const normalizedSourceCode = QuestionParser.normalizeCodeAwareOption(sourceText);
          const sourceCompact = normalizedSource.replace(/\s+/g, "");
          const sourceCompactCode = normalizedSourceCode.replace(/\s+/g, "");
          const sourceTokenSet = new Set(normalizedSource.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 3));
          const sourceCodeTokenSet = new Set(normalizedSourceCode.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 3));
          const weakStop = /* @__PURE__ */ new Set([
            "assinale",
            "afirmativa",
            "alternativa",
            "correta",
            "incorreta",
            "resposta",
            "dados",
            "bancos",
            "banco",
            "modelo",
            "modelos",
            "nosql",
            "sql"
          ]);
          let hits = 0;
          for (const entry of optionEntries) {
            const opt = entry.normalized;
            if (!opt) continue;
            if (entry.isCodeLike) {
              if (normalizedSourceCode.includes(opt)) {
                hits++;
                continue;
              }
              const optCompactCode = opt.replace(/\s+/g, "");
              if (optCompactCode.length >= 14 && sourceCompactCode.includes(optCompactCode)) {
                hits++;
                continue;
              }
              const optTokens2 = opt.split(/\s+/).map((t) => t.trim()).filter(Boolean);
              const opTokens = optTokens2.filter((t) => t.startsWith("op_"));
              const lexTokens = optTokens2.filter((t) => !t.startsWith("op_") && t.length >= 4 && !weakStop.has(t));
              if (lexTokens.length === 0) continue;
              let lexHits = 0;
              for (const tk of lexTokens) {
                if (sourceCodeTokenSet.has(tk)) lexHits++;
              }
              const lexRatio = lexHits / lexTokens.length;
              let opHits = 0;
              for (const op of opTokens) {
                if (sourceCodeTokenSet.has(op)) opHits++;
              }
              const opRatio = opTokens.length > 0 ? opHits / opTokens.length : 1;
              if (lexHits >= 2 && lexRatio >= 0.5 && opRatio >= 0.5 || lexRatio >= 0.7 && opRatio >= 0.34) hits++;
              continue;
            }
            if (normalizedSource.includes(opt)) {
              hits++;
              continue;
            }
            const optCompact = opt.replace(/\s+/g, "");
            if (optCompact.length >= 12 && sourceCompact.includes(optCompact)) {
              hits++;
              continue;
            }
            const optTokens = opt.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 4 && !weakStop.has(t));
            if (optTokens.length === 0) continue;
            let tokenHits = 0;
            for (const tk of optTokens) {
              if (sourceTokenSet.has(tk)) tokenHits++;
            }
            const tokenRatio = tokenHits / optTokens.length;
            if (tokenHits >= 2 && tokenRatio >= 0.55 || tokenRatio >= 0.72) hits++;
          }
          return { hits, total, ratio: hits / total, hasEnoughOptions: true };
        },
        optionsMatchInFreeText(originalOptions, sourceText) {
          const coverage = this.optionsCoverageInFreeText(originalOptions, sourceText);
          if (!coverage.hasEnoughOptions || coverage.total === 0) return true;
          return coverage.ratio >= 0.6 || coverage.hits >= Math.min(3, coverage.total);
        },
        optionsMatch(originalOptions, sourceOptions) {
          if (!originalOptions || originalOptions.length < 2) return true;
          if (!sourceOptions || sourceOptions.length < 2) return true;
          const origNorms = originalOptions.map((o) => QuestionParser.normalizeOption(QuestionParser.stripOptionTailNoise(o))).filter(Boolean);
          const srcNorms = sourceOptions.map((o) => QuestionParser.normalizeOption(QuestionParser.stripOptionTailNoise(o))).filter(Boolean);
          if (origNorms.length === 0 || srcNorms.length === 0) return true;
          const srcSet = new Set(srcNorms);
          let exactHits = 0;
          for (const opt of origNorms) {
            if (srcSet.has(opt)) exactHits++;
          }
          if (exactHits >= 3 || exactHits / origNorms.length >= 0.6) return true;
          let fuzzyHits = 0;
          for (const orig of origNorms) {
            let bestSim = 0;
            for (const src of srcNorms) {
              const sim = QuestionParser.diceSimilarity(orig, src);
              if (sim > bestSim) bestSim = sim;
            }
            if (bestSim >= 0.75) fuzzyHits++;
          }
          return fuzzyHits >= 3 || fuzzyHits / origNorms.length >= 0.6;
        },
        computeMatchQuality(sourceText, questionText, originalOptions, originalOptionsMap) {
          if (!sourceText || !questionText) return 0;
          const stem = QuestionParser.extractQuestionStem(questionText);
          const topicScore = QuestionParser.questionSimilarityScore(sourceText, stem);
          const coverage = this.optionsCoverageInFreeText(originalOptions, sourceText);
          const coverageScore = coverage.hasEnoughOptions ? coverage.ratio : 0.5;
          return Math.min(1, topicScore * 0.6 + coverageScore * 0.4) * 3;
        },
        /**
         * Maps a free-form answer body to the closest user option body.
         * Returns null when confidence is weak or the match is ambiguous.
         */
        matchAnswerTextToOptions(answerText, optionsMap) {
          if (!answerText || !optionsMap || Object.keys(optionsMap).length < 2) return null;
          const normalizedAnswer = QuestionParser.normalizeOption(String(answerText || ""));
          if (!normalizedAnswer || normalizedAnswer.length < 12) return null;
          const stop = /* @__PURE__ */ new Set([
            "assinale",
            "afirmativa",
            "alternativa",
            "correta",
            "incorreta",
            "resposta",
            "dados",
            "banco",
            "bancos",
            "modelo",
            "modelos",
            "sobre",
            "qual",
            "quais",
            "como",
            "para",
            "com",
            "sem",
            "uma",
            "um",
            "de",
            "da",
            "do",
            "das",
            "dos",
            "na",
            "no",
            "nas",
            "nos",
            "ao",
            "aos",
            "as",
            "os",
            "e",
            "ou",
            "em"
          ]);
          const answerTokens = normalizedAnswer.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 4 && !stop.has(t));
          const normalizedAnswerCompact = normalizedAnswer.replace(/\s+/g, "");
          const scored = [];
          for (const [letterRaw, bodyRaw] of Object.entries(optionsMap || {})) {
            const letter = String(letterRaw || "").toUpperCase();
            if (!/^[A-E]$/.test(letter)) continue;
            const body = QuestionParser.stripOptionTailNoise(bodyRaw);
            const normalizedBody = QuestionParser.normalizeOption(body);
            if (!normalizedBody || normalizedBody.length < 8) continue;
            const bodyTokens = normalizedBody.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 4 && !stop.has(t));
            const normalizedBodyCompact = normalizedBody.replace(/\s+/g, "");
            const contains = normalizedAnswer.includes(normalizedBody) || normalizedBodyCompact.length >= 16 && normalizedAnswerCompact.includes(normalizedBodyCompact);
            const reverseContains = normalizedAnswer.length >= 20 && normalizedBody.includes(normalizedAnswer) || normalizedAnswerCompact.length >= 16 && normalizedBodyCompact.includes(normalizedAnswerCompact);
            let tokenRatio = 0;
            let tokenHits = 0;
            if (answerTokens.length > 0 && bodyTokens.length > 0) {
              const bodyTokenSet = new Set(bodyTokens);
              for (const tk of answerTokens) {
                if (bodyTokenSet.has(tk)) tokenHits += 1;
              }
              tokenRatio = tokenHits / Math.max(1, Math.min(answerTokens.length, bodyTokens.length));
            }
            const dice = QuestionParser.diceSimilarity(normalizedAnswer, normalizedBody);
            const semanticScore = tokenRatio * 0.72 + dice * 0.28;
            const score = contains ? 1 : reverseContains ? 0.95 : semanticScore;
            scored.push({
              letter,
              body,
              score,
              tokenRatio,
              tokenHits,
              dice,
              contains,
              reverseContains,
              method: contains || reverseContains ? "text-containment" : "text-semantic"
            });
          }
          if (scored.length === 0) return null;
          scored.sort((a, b) => b.score - a.score);
          const top = scored[0];
          const second = scored[1] || null;
          const margin = top.score - (second?.score || 0);
          const topStrong = top.contains || top.reverseContains;
          const topGoodSemantic = !topStrong && top.score >= 0.68 && top.tokenRatio >= 0.42 && top.tokenHits >= 2;
          const secondStrong = !!second && (second.contains || second.reverseContains || second.score >= 0.62);
          const ambiguous = !!second && secondStrong && margin < (topStrong ? 0.12 : 0.1);
          if (!topStrong && !topGoodSemantic) return null;
          if (ambiguous) return null;
          return {
            letter: top.letter,
            confidence: topStrong ? 0.92 : Math.max(0.7, Math.min(0.9, top.score)),
            score: top.score,
            margin,
            method: top.method,
            matchedBody: top.body
          };
        },
        findLetterByAnswerText(answerText, optionsMap) {
          const match = this.matchAnswerTextToOptions(answerText, optionsMap);
          return match?.letter || null;
        },
        // ── Source option map ─────────────────────────────────────────────────────
        /**
         * Parses A) / B) / C) options from source text and returns { letter: body } map.
         */
        buildSourceOptionsMapFromText(sourceText) {
          if (!sourceText || sourceText.length < 30) return {};
          const map = {};
          const lines = sourceText.split("\n");
          let currentLetter = null;
          let currentParts = [];
          const flush = () => {
            if (currentLetter && currentParts.length > 0) {
              const body = currentParts.join(" ").replace(/\s+/g, " ").trim();
              if (body.length >= 5) map[currentLetter] = body;
            }
          };
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const m = trimmed.match(/^([A-E])\s*[\)\.\-:]\s*(.*)$/i);
            if (m) {
              flush();
              currentLetter = m[1].toUpperCase();
              currentParts = m[2].trim() ? [m[2].trim()] : [];
            } else if (currentLetter) {
              if (/^(?:\d{1,3}\s*[\)\.\-:]|Aula\s+\d|Quest[aã]o\s+\d|Pergunta\s+\d)/i.test(trimmed)) {
                flush();
                currentLetter = null;
                currentParts = [];
              } else {
                currentParts.push(trimmed);
              }
            }
          }
          flush();
          return map;
        },
        // ── Letter remapping ──────────────────────────────────────────────────────
        remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap) {
          if (!sourceLetter || !sourceOptionsMap || !userOptionsMap) {
            console.log(`    [remap] SKIP: missing data`);
            return sourceLetter;
          }
          const userEntries = Object.entries(userOptionsMap);
          if (userEntries.length < 2 || Object.keys(sourceOptionsMap).length < 2) {
            console.log(`    [remap] SKIP: too few options`);
            return sourceLetter;
          }
          const sourceBody = sourceOptionsMap[sourceLetter];
          if (!sourceBody || sourceBody.length < 5) {
            console.log(`    [remap] SKIP: source letter ${sourceLetter} has no body`);
            return sourceLetter;
          }
          console.log(`    [remap] Source letter=${sourceLetter} body="${sourceBody.slice(0, 80)}"`);
          const normSource = QuestionParser.normalizeOption(sourceBody);
          if (!normSource) return sourceLetter;
          const skeletonSource = normSource.replace(/\s+/g, "");
          let bestLetter = null;
          let bestScore = 0;
          for (const [userLetter, userBody] of userEntries) {
            const normUser = QuestionParser.normalizeOption(userBody);
            if (!normUser) continue;
            const containsFwd = normSource.includes(normUser);
            const containsRev = normUser.includes(normSource);
            if (containsFwd || containsRev) {
              const score = Math.min(normSource.length, normUser.length) + 1e3;
              if (score > bestScore) {
                bestScore = score;
                bestLetter = userLetter;
              }
              continue;
            }
            const sim = QuestionParser.diceSimilarity(normSource, normUser);
            if (sim >= 0.7) {
              const score = sim * normUser.length;
              if (score > bestScore) {
                bestScore = score;
                bestLetter = userLetter;
              }
              continue;
            }
            const skeletonUser = normUser.replace(/\s+/g, "");
            const skelContainsFwd = skeletonSource.includes(skeletonUser);
            const skelContainsRev = skeletonUser.includes(skeletonSource);
            if (skelContainsFwd || skelContainsRev) {
              const score = Math.min(skeletonSource.length, skeletonUser.length) + 900;
              if (score > bestScore) {
                bestScore = score;
                bestLetter = userLetter;
              }
              continue;
            }
            const skelSim = QuestionParser.diceSimilarity(skeletonSource, skeletonUser);
            if (skelSim >= 0.7) {
              const score = skelSim * skeletonUser.length * 0.95;
              if (score > bestScore) {
                bestScore = score;
                bestLetter = userLetter;
              }
            }
          }
          if (bestLetter && bestLetter !== sourceLetter) {
            console.log(`    [remap] REMAPPED: ${sourceLetter} \u2192 ${bestLetter}`);
            return bestLetter;
          }
          console.log(`    [remap] NO CHANGE: best=${bestLetter || "none"} === source=${sourceLetter}`);
          return bestLetter || sourceLetter;
        },
        remapLetterIfShuffled(sourceLetter, sourceText, userOptionsMap) {
          if (!sourceLetter || !sourceText || !userOptionsMap) return sourceLetter;
          if (Object.keys(userOptionsMap).length < 2) return sourceLetter;
          const sourceOptionsMap = this.buildSourceOptionsMapFromText(sourceText);
          console.log(`    [remapIfShuffled] letter=${sourceLetter} sourceOpts=${Object.keys(sourceOptionsMap).length}`);
          if (Object.keys(sourceOptionsMap).length < 2) {
            console.log(`    [remapIfShuffled] SKIP: not enough source options parsed`);
            return sourceLetter;
          }
          return this.remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap);
        },
        verifyHighlightMatch(rawLetter, remappedLetter, sourceOptionsMap, userOptionsMap, baseConfidence) {
          const highlightedText = (sourceOptionsMap || {})[rawLetter] || "";
          if (!highlightedText || highlightedText.length < 5) {
            console.log(`    [verify] SKIP: no highlighted text for raw letter ${rawLetter}`);
            return { confidence: baseConfidence, letter: remappedLetter };
          }
          if (!userOptionsMap || Object.keys(userOptionsMap).length < 2) {
            return { confidence: baseConfidence, letter: remappedLetter };
          }
          const normH = QuestionParser.normalizeOption(highlightedText).replace(/\s+/g, "");
          console.log(`    [verify] highlighted text for ${rawLetter}: "${highlightedText.slice(0, 100)}"`);
          let bestMatchLetter = null;
          let bestMatchScore = 0;
          for (const [userLetter, userBody] of Object.entries(userOptionsMap)) {
            const normU = QuestionParser.normalizeOption(userBody).replace(/\s+/g, "");
            if (!normU || normU.length < 5) continue;
            const skelContains = normH.includes(normU) || normU.includes(normH);
            const skelDice = QuestionParser.diceSimilarity(normH, normU);
            const score = skelContains ? 1e3 + Math.min(normH.length, normU.length) : skelDice;
            if (score > bestMatchScore) {
              bestMatchScore = score;
              bestMatchLetter = userLetter;
            }
          }
          if (bestMatchLetter && bestMatchScore >= 0.55) {
            if (bestMatchLetter !== remappedLetter) {
              console.log(`    [verify] \u2705 CONTENT OVERRIDE: ${remappedLetter} \u2192 ${bestMatchLetter}`);
            } else {
              console.log(`    [verify] \u2705 CONFIRMED: ${bestMatchLetter}`);
            }
            return { confidence: baseConfidence, letter: bestMatchLetter };
          }
          console.log(`    [verify] \u274C REJECTED: highlighted text matches NO user option. Anchor likely on wrong question.`);
          return null;
        }
      };
    }
  });

  // src/services/search/HtmlExtractorService.js
  var HtmlExtractorService;
  var init_HtmlExtractorService = __esm({
    "src/services/search/HtmlExtractorService.js"() {
      init_QuestionParser();
      init_OptionsMatchService();
      HtmlExtractorService = {
        // ── HTML DOM parsing ───────────────────────────────────────────────────────
        parseHtmlDom(html) {
          if (!html || html.length < 200) return { doc: null, nodes: [] };
          const rawHtml = String(html || "");
          const sanitize = (input) => String(input || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<script\b[^>]*\/?>/gi, " ").replace(/<script\b[\s\S]*?(?=<(?:\/head|\/body|!--|meta|link))/gi, " ").replace(/<\s*script\b[\s\S]*$/gi, " ").replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ").replace(/<noscript\b[^>]*\/?>/gi, " ").replace(/<\s*noscript\b[\s\S]*$/gi, " ").replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ").replace(/<iframe\b[^>]*\/?>/gi, " ").replace(/<\s*iframe\b[\s\S]*$/gi, " ").replace(/<object\b[\s\S]*?<\/object>/gi, " ").replace(/<\s*object\b[\s\S]*$/gi, " ").replace(/<embed\b[^>]*>/gi, " ").replace(/<link\b[^>]*>/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.captcha-display\.com(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)(?:api-js\.)?datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/datadome\.co/gi, " ").replace(/captcha-display\.com/gi, " ");
          let doc = null;
          let nodes = [];
          const safeHtml = sanitize(rawHtml);
          try {
            doc = new DOMParser().parseFromString(safeHtml, "text/html");
            nodes = Array.from(doc.querySelectorAll("div.t"));
          } catch {
            return { doc: null, nodes: [] };
          }
          const embeddedSource = rawHtml.includes("\\u003cdiv") ? rawHtml : safeHtml;
          if (nodes.length < 50 && embeddedSource.includes("\\u003cdiv")) {
            const idx = embeddedSource.indexOf("\\u003cdiv");
            const slice = embeddedSource.slice(idx, Math.min(embeddedSource.length, idx + 65e4));
            const decoded = slice.replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">").replace(/\\u0026/gi, "&").replace(/\\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "	");
            try {
              const parsed = new DOMParser().parseFromString(sanitize(decoded), "text/html");
              const parsedNodes = Array.from(parsed.querySelectorAll("div.t"));
              if (parsedNodes.length > nodes.length) {
                doc = parsed;
                nodes = parsedNodes;
              }
            } catch (_) {
            }
          }
          return { doc, nodes };
        },
        extractDocText(doc) {
          if (!doc || !doc.body) return "";
          try {
            const clone = doc.body.cloneNode(true);
            clone.querySelectorAll("script, style, noscript, .blank").forEach((n) => n.remove());
            clone.querySelectorAll("div, p, br, li, h1, h2, h3, h4, h5, h6, tr, td, article, section, footer, header").forEach((el) => el.appendChild(doc.createTextNode(" ")));
            return (clone.textContent || "").replace(/\s+/g, " ").trim();
          } catch {
            return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
          }
        },
        detectHtmlType(html, doc = null) {
          const h = String(html || "").toLowerCase();
          if (!h) return "TYPE_UNKNOWN";
          if ((h.includes('id="pf1"') || h.includes('class="pf') || h.includes('class="pc')) && h.includes('class="t')) {
            return "TYPE_PD_PDF_HTML";
          }
          if (h.includes("answercard_") || h.includes("ql-editor") || h.includes("answer-content-container")) {
            return "TYPE_PD_ANSWERCARD";
          }
          if (/resposta\s+correta|gabarito|alternativa\s+correta/i.test(h)) return "TYPE_GENERIC_QA";
          if (doc && doc.querySelector(".ql-editor")) return "TYPE_PD_ANSWERCARD";
          return "TYPE_UNKNOWN";
        },
        // ── Obfuscation & paywall ──────────────────────────────────────────────────
        obfuscationSignals(text) {
          const normalized = QuestionParser.normalizeOption(String(text || ""));
          if (normalized.length < 120 || normalized.split(/\s+/).filter(Boolean).length < 20) {
            return { isObfuscated: false, vowelRatio: 0, junkRatio: 0, longConsonantRuns: 0, consonantRunRatio: 0, relevantWordCount: 0 };
          }
          const words = normalized.split(/\s+/).filter(Boolean);
          const letters = (normalized.match(/[a-z]/g) || []).length || 1;
          const vowels = (normalized.match(/[aeiou]/g) || []).length;
          const vowelRatio = vowels / letters;
          const relevantWords = words.filter((w) => w.length >= 4);
          let noVowelWords = 0;
          let longConsonantRuns = 0;
          for (const w of relevantWords) {
            if (!/[aeiou]/.test(w)) noVowelWords++;
            if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(w)) longConsonantRuns++;
          }
          const junkRatio = noVowelWords / Math.max(1, relevantWords.length);
          const consonantRunRatio = relevantWords.length > 0 ? longConsonantRuns / relevantWords.length : 0;
          const consonantRunRescue = relevantWords.length >= 150 && junkRatio < 0.25;
          const isObfuscated = vowelRatio < 0.24 && junkRatio >= 0.28 || longConsonantRuns >= 8 && vowelRatio < 0.34 && consonantRunRatio >= 0.1 && !consonantRunRescue;
          return { isObfuscated, vowelRatio, junkRatio, longConsonantRuns, consonantRunRatio, relevantWordCount: relevantWords.length };
        },
        isLikelyObfuscated(text) {
          return this.obfuscationSignals(text).isObfuscated;
        },
        paywallSignals(html, text = "", hostHint = "") {
          const h = String(html || "").toLowerCase();
          const t = QuestionParser.normalizeOption(text || "");
          if (!h && !t) return { isPaywalled: false, markerHits: 0, riskyHost: false };
          const markers = [
            /voce\s+esta\s+vendo\s+uma\s+previa/i,
            /desbloqueie/i,
            /seja\s+premium/i,
            /torne[\s-]*se\s+premium/i,
            /documento\s+premium/i,
            /conteudos?\s+liberados/i,
            /teste\s+gratis/i,
            /upload\s+para\s+desbloquear/i,
            /short-preview-version/i,
            /limitation-blocked/i,
            /paywall-structure/i,
            /mv-content-limitation-fake-page/i,
            /new-monetization-test-paywall/i
          ];
          let markerHits = 0;
          for (const re of markers) {
            if (re.test(h) || re.test(t)) markerHits++;
          }
          const host = String(hostHint || "").toLowerCase();
          const riskyHost = ["passeidireto.com", "studocu.com", "scribd.com", "pt.scribd.com", "brainly.com", "brainly.com.br"].includes(host);
          const isPaywalled = riskyHost ? markerHits >= 2 : markerHits >= 3;
          return { isPaywalled, markerHits, riskyHost };
        },
        // ── PDF-like anchor extraction ─────────────────────────────────────────────
        extractPdfLikeAnswerByAnchors(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs) {
          const { doc, nodes } = this.parseHtmlDom(html);
          if (!doc || nodes.length < 20) return null;
          const frags = nodes.map((n) => {
            const text = (n.textContent || "").replace(/\s+/g, " ").trim();
            if (!text) return null;
            return { text, cls: (n.getAttribute("class") || "").toLowerCase() };
          }).filter(Boolean);
          if (frags.length < 20) return null;
          const startQuestionRe = /^(?:\)?\s*)?\d{1,3}\s*[\)\.\-:]\s*/;
          const starts = [];
          for (let i = 0; i < frags.length; i++) {
            if (startQuestionRe.test(frags[i].text)) starts.push(i);
          }
          const blocks = starts.length === 0 ? [{ start: 0, end: frags.length - 1 }] : starts.map((start, i) => {
            const end = i < starts.length - 1 ? starts[i + 1] - 1 : frags.length - 1;
            return end - start >= 4 ? { start, end } : null;
          }).filter(Boolean);
          if (blocks.length === 0) return null;
          let bestBlock = null;
          let bestBlockScore = 0;
          for (const b of blocks) {
            const text = frags.slice(b.start, b.end + 1).map((x) => x.text).join(" ");
            const sim = QuestionParser.questionSimilarityScore(text, questionStem);
            if (sim > bestBlockScore) {
              bestBlockScore = sim;
              bestBlock = { ...b, text };
            }
          }
          if (!bestBlock || bestBlockScore < 0.12) return null;
          const blockFrags = frags.slice(bestBlock.start, bestBlock.end + 1);
          const blockText = blockFrags.map((f) => f.text).join("\n");
          const explicitInBlock = extractorRefs.extractExplicitGabarito(blockText, questionForInference);
          if (explicitInBlock?.letter) {
            return { letter: explicitInBlock.letter, confidence: 0.94, method: "pdf-anchor-gabarito", evidence: blockText.slice(0, 900), matchQuality: bestBlockScore };
          }
          const anchorRe = /(resposta\s+correta|gabarito|alternativa\s+correta|resposta\s*:\s*letra)/i;
          const stopRe = /(coment[aá]rio|resolu[cç][aã]o|explica[cç][aã]o|pergunta\s+\d+|quest[aã]o\s+\d+)/i;
          let anchorIdx = -1;
          for (let i = 0; i < blockFrags.length; i++) {
            if (anchorRe.test(blockFrags[i].text)) {
              anchorIdx = i;
              break;
            }
          }
          if (anchorIdx < 0) return null;
          const evidenceParts = [];
          for (let i = anchorIdx; i < Math.min(blockFrags.length, anchorIdx + 30); i++) {
            const line = blockFrags[i].text;
            if (i > anchorIdx + 1 && startQuestionRe.test(line)) break;
            if (i > anchorIdx + 1 && stopRe.test(line)) break;
            evidenceParts.push(line);
          }
          const evidenceText = evidenceParts.join(" ").trim();
          if (!evidenceText || evidenceText.length < 20) return null;
          const explicit = extractorRefs.extractExplicitGabarito(evidenceText, questionForInference) || extractorRefs.extractExplicitLetterFromText(evidenceText, questionStem, originalOptions);
          if (explicit?.letter) {
            return { letter: explicit.letter, confidence: 0.93, method: "pdf-anchor-gabarito", evidence: evidenceText.slice(0, 900), matchQuality: bestBlockScore };
          }
          const candidateByText = QuestionParser.findLetterByAnswerText(evidenceText, originalOptionsMap);
          if (!candidateByText) return null;
          return { letter: candidateByText, confidence: 0.86, method: "pdf-anchor-text-match", evidence: evidenceText.slice(0, 900), matchQuality: bestBlockScore };
        },
        // ── AnswerCard extraction ──────────────────────────────────────────────────
        extractAnswerCardEvidence(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs) {
          const { doc } = this.parseHtmlDom(html);
          if (!doc) return null;
          const containers = Array.from(doc.querySelectorAll(
            '.ql-editor, [class*="AnswerCard_answer-content"], [class*="answer-content-container"], [data-testid*="answer"]'
          ));
          if (containers.length === 0) return null;
          const candidates = [];
          for (const c of containers.slice(0, 18)) {
            let text = (c.textContent || "").replace(/\s+/g, " ").trim();
            if (!text || text.length < 40 || this.isLikelyObfuscated(text)) continue;
            const block = extractorRefs.findQuestionBlock(text, questionStem);
            if (block?.text?.length >= 80) text = block.text;
            const sim = QuestionParser.questionSimilarityScore(text, questionStem);
            const explicit = extractorRefs.extractExplicitGabarito(text, questionForInference) || extractorRefs.extractExplicitLetterFromText(text, questionStem, originalOptions);
            let letter = explicit?.letter || QuestionParser.findLetterByAnswerText(text, originalOptionsMap);
            if (!letter) continue;
            const confidence = explicit?.letter ? 0.9 : 0.82;
            candidates.push({ letter, confidence, method: "answercard-ql", evidence: text.slice(0, 900), matchQuality: sim, _score: confidence + sim * 0.6 });
          }
          if (candidates.length === 0) return null;
          candidates.sort((a, b) => b._score - a._score);
          return candidates[0];
        },
        // ── Generic anchor extraction ──────────────────────────────────────────────
        extractGenericAnchoredEvidence(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs) {
          const { doc } = this.parseHtmlDom(html);
          if (!doc) return null;
          const fullText = this.extractDocText(doc);
          if (!fullText || fullText.length < 120 || this.isLikelyObfuscated(fullText)) return null;
          const noisyContextRe = /(resposta\s+gerada\s+por\s+ia|desbloqueie|premium|ajude\s+estudantes|conte[íu]dos\s+liberados|respostas?\s+dispon[íi]veis\s+nesse\s+material)/i;
          const strongAnchorRe = /(gabarito|resposta\s+correta|resposta\s*:\s*(?:letra\s*)?[A-E]|a\s+resposta\s+[eé]|alternativa\s+correta\s*(?:[eé]|[:\-]))/i;
          const anchorRe = /(gabarito|resposta\s+correta|alternativa\s+correta|resposta\s*:\s*letra|a\s+resposta\s+[eé])/ig;
          const directiveRe = /(assinale|marque|selecione|indique)\s+(?:a\s+)?(?:alternativa|afirmativa|op[cç][aã]o)\s+(?:correta|incorreta|falsa|errada)/i;
          const riskyHost = ["passeidireto.com", "brainly.com.br", "brainly.com"].includes(hostHint);
          const candidates = [];
          let m;
          let guard = 0;
          while ((m = anchorRe.exec(fullText)) !== null && guard < 8) {
            guard++;
            const idx = m.index || 0;
            const anchorLabel = (m[1] || "").toLowerCase();
            const nearPrefix = fullText.slice(Math.max(0, idx - 140), Math.min(fullText.length, idx + 60));
            if (/alternativa\s+correta/.test(anchorLabel) && directiveRe.test(nearPrefix)) continue;
            const start = Math.max(0, idx - 230);
            const end = Math.min(fullText.length, idx + 760);
            const ctx = fullText.slice(start, end);
            if (!ctx || ctx.length < 40 || noisyContextRe.test(ctx)) continue;
            if (!strongAnchorRe.test(ctx)) continue;
            if (directiveRe.test(ctx) && !/(gabarito|resposta\s+correta|a\s+resposta\s+[eé]|resposta\s*:)/i.test(ctx)) continue;
            const sim = QuestionParser.questionSimilarityScore(ctx, questionStem);
            if (sim < (riskyHost ? 0.22 : 0.16)) continue;
            const coverage = originalOptions?.length >= 2 ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, ctx) : { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
            const optionsMatch = !coverage.hasEnoughOptions || coverage.ratio >= 0.6 || coverage.hits >= Math.min(3, coverage.total || 3);
            const optionsStrong = !coverage.hasEnoughOptions || coverage.ratio >= 0.8 || coverage.hits >= Math.min(4, coverage.total || 4);
            const explicit = extractorRefs.extractExplicitGabarito(ctx, questionForInference) || extractorRefs.extractExplicitLetterFromText(ctx, questionStem, originalOptions);
            let letter = explicit?.letter || QuestionParser.findLetterByAnswerText(ctx, originalOptionsMap);
            if (!letter) continue;
            if (!optionsMatch) {
              if (!explicit?.letter) continue;
              if (sim < (riskyHost ? 0.52 : 0.42)) continue;
            }
            if (riskyHost && !optionsStrong) {
              if (!explicit?.letter) continue;
              if (sim < 0.6) continue;
            }
            const confidence = explicit?.letter ? 0.9 : 0.8;
            candidates.push({
              letter,
              confidence,
              method: "generic-anchor",
              evidence: ctx.slice(0, 900),
              matchQuality: sim,
              optionsMatch,
              optionsStrong,
              explicitLetter: !!explicit?.letter,
              hasStrongAnchorSignal: true,
              _score: confidence + sim * 0.55
            });
          }
          if (candidates.length === 0) return null;
          candidates.sort((a, b) => b._score - a._score);
          const best = candidates[0];
          if (!best.hasStrongAnchorSignal) return null;
          if ((best.matchQuality || 0) < (riskyHost ? 0.46 : 0.34) && !best.optionsMatch) return null;
          if (riskyHost && !best.optionsStrong) {
            if (!best.explicitLetter || (best.matchQuality || 0) < 0.6) return null;
          }
          if ((best.matchQuality || 0) < 0.08 && best.confidence < 0.88) return null;
          return best;
        },
        // ── Structured dispatcher ──────────────────────────────────────────────────
        extractStructuredEvidence(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs, diagnosticsCtx = null) {
          if (!html || html.length < 500) return null;
          const parsed = diagnosticsCtx?.parsed || this.parseHtmlDom(html);
          const type = diagnosticsCtx?.type || this.detectHtmlType(html, parsed.doc);
          const docText = this.extractDocText(parsed.doc);
          const obfuscation = diagnosticsCtx?.obfuscation || this.obfuscationSignals(docText);
          const paywall = diagnosticsCtx?.paywall || this.paywallSignals(html, docText, hostHint);
          console.log(`    [Structured] host=${hostHint} type=${type} paywall=${paywall?.isPaywalled} obfuscated=${obfuscation?.isObfuscated}`);
          if (paywall?.isPaywalled) {
            console.log(`    [Structured] \u26D4 Blocked by paywall`);
            return { skip: true, reason: "paywall-overlay", diagnostics: { type, obfuscation, paywall } };
          }
          if (type === "TYPE_PD_PDF_HTML" || hostHint === "passeidireto.com" || hostHint === "studocu.com") {
            const byAnchor = this.extractPdfLikeAnswerByAnchors(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs);
            if (byAnchor?.letter) {
              return { ...byAnchor, evidenceType: `${hostHint || "pdf"}-${byAnchor.method}-scoped`, diagnostics: { type, obfuscation, paywall } };
            }
          }
          if (type === "TYPE_PD_ANSWERCARD") {
            const byAnswerCard = this.extractAnswerCardEvidence(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs);
            if (byAnswerCard?.letter) {
              return { ...byAnswerCard, evidenceType: `${hostHint || "page"}-${byAnswerCard.method}-scoped`, diagnostics: { type, obfuscation, paywall } };
            }
          }
          const byGeneric = this.extractGenericAnchoredEvidence(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs);
          if (byGeneric?.letter) {
            return { ...byGeneric, evidenceType: `${hostHint || "page"}-${byGeneric.method}-scoped`, diagnostics: { type, obfuscation, paywall } };
          }
          if (obfuscation?.isObfuscated) {
            return { skip: true, reason: "obfuscated_html", diagnostics: { type, obfuscation, paywall } };
          }
          return { diagnostics: { type, obfuscation, paywall } };
        },
        // ── PDF-like highlight letter extraction (ff1/CSS) ─────────────────────────
        extractPdfHighlightLetter(html, questionStem, originalOptionsMap, originalOptions) {
          if (!html || html.length < 2e3) return null;
          const tokens = QuestionParser.extractKeyTokens(questionStem);
          const reconstructedQ = questionStem + "\n" + (originalOptions || []).join("\n");
          const optTokens = QuestionParser.extractOptionTokens(reconstructedQ);
          const hasOptTokens = optTokens.length >= 2;
          const { doc, nodes } = this.parseHtmlDom(html);
          console.log(`    [ff1-highlight] check: html_len=${html.length} div.t nodes=${nodes.length}`);
          if (nodes.length < 15) return null;
          const frags = nodes.map((n) => ({
            text: (n.textContent || "").replace(/\s+/g, " ").trim(),
            cls: (n.getAttribute("class") || "").toLowerCase(),
            style: (n.getAttribute("style") || "").toLowerCase(),
            inner: (n.innerHTML || "").toLowerCase()
          })).filter((f) => f.text && f.text.length >= 1);
          if (frags.length < 15) return null;
          let bestIdx = -1;
          let bestAnchorScore = 0;
          const anchorWindowSize = hasOptTokens ? 10 : 5;
          for (let i = 0; i < frags.length; i++) {
            const windowText2 = frags.slice(i, Math.min(frags.length, i + anchorWindowSize)).map((f) => f.text).join(" ");
            const stemHits = QuestionParser.countTokenHits(windowText2, tokens);
            const optHits = hasOptTokens ? QuestionParser.countTokenHits(windowText2, optTokens) : 0;
            const score = stemHits + optHits * 2;
            if (score > bestAnchorScore) {
              bestAnchorScore = score;
              bestIdx = i;
            }
          }
          const bestWindowText = bestIdx >= 0 ? frags.slice(bestIdx, Math.min(frags.length, bestIdx + anchorWindowSize)).map((f) => f.text).join(" ") : "";
          const bestStemHits = bestIdx >= 0 ? QuestionParser.countTokenHits(bestWindowText, tokens) : 0;
          const bestOptHits = hasOptTokens && bestIdx >= 0 ? QuestionParser.countTokenHits(bestWindowText, optTokens) : 0;
          const minAnchorHits = Math.max(2, Math.floor(tokens.length * 0.35));
          console.log(`    [ff1-highlight] tokens=${JSON.stringify(tokens)} bestIdx=${bestIdx} stemHits=${bestStemHits}/${tokens.length} optHits=${bestOptHits}/${optTokens.length} score=${bestAnchorScore} minRequired=${minAnchorHits}`);
          if (bestIdx < 0 || bestStemHits < minAnchorHits) {
            console.log(`    [ff1-highlight] REJECTED: anchor not found`);
            return null;
          }
          if (hasOptTokens && bestOptHits < 1) {
            console.log(`    [ff1-highlight] REJECTED: stem matched but 0/${optTokens.length} option tokens near anchor. Wrong question block.`);
            return null;
          }
          const windowStart = Math.max(0, bestIdx - 30);
          const windowFrags = frags.slice(windowStart, Math.min(frags.length, bestIdx + 120));
          const windowText = windowFrags.map((f) => f.text).join("\n");
          const optBodies = Object.values(originalOptionsMap || {}).map((v) => QuestionParser.normalizeOption(v)).filter((v) => v.length >= 2);
          let optionHits = 0;
          const normWindow = QuestionParser.normalizeOption(windowText);
          for (const body of optBodies) {
            if (body && normWindow.includes(body)) optionHits++;
          }
          console.log(`    [ff1-highlight] optionHits=${optionHits}/${optBodies.length} windowLen=${windowText.length}`);
          const parseAlternativeStart = (rawText) => {
            const t = (rawText || "").trim();
            if (!t) return null;
            let m = t.match(/^([A-E])\s*[\)\.\-:]\s*/i);
            if (m) return m[1].toUpperCase();
            m = t.match(/^\)\s*([A-E])\b/i);
            if (m) return m[1].toUpperCase();
            m = t.match(/^\(\s*([A-E])\s*\)/i);
            if (m) return m[1].toUpperCase();
            return null;
          };
          const isNextQuestionMarker = (t) => {
            const s = (t || "").trim();
            return /^(?:\)?\s*)?\d{1,3}\s*[\)\.\-:]\s*/.test(s) || /^aula\s+\d+/i.test(s);
          };
          const anchorOffset = bestIdx - windowStart;
          const maxGroupLookback = Math.min(anchorOffset, 15);
          let groupStartOffset = anchorOffset;
          for (let g = anchorOffset - 1; g >= anchorOffset - maxGroupLookback; g--) {
            if (g < 0) break;
            if (isNextQuestionMarker(windowFrags[g].text)) {
              groupStartOffset = g + 1;
              break;
            }
            groupStartOffset = g;
          }
          const groupingFrags = windowFrags.slice(groupStartOffset);
          const groups = {};
          let current = null;
          for (const f of groupingFrags) {
            const letter = parseAlternativeStart(f.text);
            if (letter) {
              current = letter;
              if (!groups[current]) groups[current] = [];
              groups[current].push(f);
              continue;
            }
            if (current) {
              if (Object.keys(groups).length >= 2 && isNextQuestionMarker(f.text)) break;
              groups[current].push(f);
            }
          }
          const letters = Object.keys(groups);
          if (letters.length < 2) return null;
          if (originalOptions?.length >= 2 && optionHits < 1) {
            console.log(`    [ff1-highlight] REJECTED: 0 option-body matches in window`);
            return null;
          }
          const featuresByLetter = {};
          const tokenOwners = /* @__PURE__ */ new Map();
          for (const letter of letters) {
            const parts = groups[letter];
            let ff1Hits = 0, blurHits = 0, clearHits = 0;
            const classTokenCounts = /* @__PURE__ */ new Map();
            for (const p of parts) {
              if (/\bff1\b/.test(p.cls) || /\bff1\b/.test(p.inner)) ff1Hits++;
              const isBlurred = /\bfb\b/.test(p.cls) || /blur\(/.test(p.style);
              if (isBlurred) blurHits++;
              else clearHits++;
              const clsTokens = String(p.cls || "").split(/\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
              const classAttrRe = /class\s*=\s*["']([^"']+)["']/gi;
              const nestedClassTokens = [];
              let cm;
              while ((cm = classAttrRe.exec(String(p.inner || ""))) !== null) {
                nestedClassTokens.push(...(cm[1] || "").split(/\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean));
              }
              for (const token of [...clsTokens, ...nestedClassTokens]) {
                if (!/^(ff|fs|fc|sc|ls)\d+$/i.test(token)) continue;
                classTokenCounts.set(token, (classTokenCounts.get(token) || 0) + 1);
              }
            }
            featuresByLetter[letter] = { ff1Hits, blurHits, clearHits, fragCount: parts.length, classTokenCounts };
            for (const token of classTokenCounts.keys()) {
              if (!tokenOwners.has(token)) tokenOwners.set(token, /* @__PURE__ */ new Set());
              tokenOwners.get(token).add(letter);
            }
          }
          const sourceOptionsFromGroups = {};
          for (const [gl, gParts] of Object.entries(groups)) {
            const gBody = this._joinPdfFragments(gParts).replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, "").trim();
            if (gBody.length >= 5) sourceOptionsFromGroups[gl] = gBody;
          }
          let bestLetter = null;
          let bestScore = -1;
          let secondScore = -1;
          for (const [letter, feat] of Object.entries(featuresByLetter)) {
            const score = feat.ff1Hits;
            if (score > bestScore) {
              secondScore = bestScore;
              bestScore = score;
              bestLetter = letter;
            } else if (score > secondScore) {
              secondScore = score;
            }
          }
          console.log(`    [ff1-highlight] Strategy1: bestLetter=${bestLetter} bestScore=${bestScore} secondScore=${secondScore}`);
          if (bestLetter && bestScore >= 1 && bestScore > secondScore) {
            const remappedFf1 = OptionsMatchService.remapLetterToUserOptions(bestLetter, sourceOptionsFromGroups, originalOptionsMap);
            const verified = OptionsMatchService.verifyHighlightMatch(bestLetter, remappedFf1, sourceOptionsFromGroups, originalOptionsMap, 0.95);
            if (verified) {
              return { letter: verified.letter, confidence: verified.confidence, method: "ff1-highlight", evidence: `ff1_hits=${bestScore} window_tokens=${bestStemHits} option_hits=${optionHits}` };
            }
          }
          const ffCountsByLetter = {};
          const ffGlobalCounts = /* @__PURE__ */ new Map();
          for (const [letter, feat] of Object.entries(featuresByLetter)) {
            const localFf = /* @__PURE__ */ new Map();
            for (const [token, count] of feat.classTokenCounts.entries()) {
              if (!/^ff\d+$/i.test(token)) continue;
              localFf.set(token, count);
              ffGlobalCounts.set(token, (ffGlobalCounts.get(token) || 0) + count);
            }
            ffCountsByLetter[letter] = localFf;
          }
          let globalDominantFf = null;
          let globalDominantFfCount = 0;
          for (const [token, count] of ffGlobalCounts.entries()) {
            if (count > globalDominantFfCount) {
              globalDominantFfCount = count;
              globalDominantFf = token;
            }
          }
          if (globalDominantFf && letters.length >= 3) {
            const outliers = [];
            for (const letter of letters) {
              for (const [token, count] of ffCountsByLetter[letter].entries()) {
                if (token === globalDominantFf) continue;
                const owners = tokenOwners.get(token);
                if (owners?.size === 1 && count >= 1) outliers.push({ letter, token, count });
              }
            }
            const outlierLetters = [...new Set(outliers.map((o) => o.letter))];
            if (outlierLetters.length === 1) {
              const outlier = outliers[0];
              const remappedOutlier = OptionsMatchService.remapLetterToUserOptions(outlier.letter, sourceOptionsFromGroups, originalOptionsMap);
              const outlierConf = OptionsMatchService.verifyHighlightMatch(outlier.letter, remappedOutlier, sourceOptionsFromGroups, originalOptionsMap, 0.93);
              if (outlierConf) {
                return { letter: outlierConf.letter, confidence: outlierConf.confidence, method: "ff-outlier", evidence: `outlier_ff=${outlier.token} dominant_ff=${globalDominantFf} option_hits=${optionHits}` };
              }
            }
          }
          const signatureScores = {};
          for (const letter of letters) {
            const feat = featuresByLetter[letter];
            let uniqueTokenScore = 0;
            for (const [token, count] of feat.classTokenCounts.entries()) {
              const owners = tokenOwners.get(token);
              if (!owners || owners.size !== 1) continue;
              const base = token.startsWith("ff") ? 1.3 : token.startsWith("ls") ? 0.6 : 0.8;
              uniqueTokenScore += base * Math.min(2, count);
            }
            let score = uniqueTokenScore;
            if (feat.clearHits >= 2 && feat.blurHits === 0) score += 0.8;
            if (feat.blurHits >= Math.max(3, Math.floor(feat.fragCount * 0.8))) score -= 0.5;
            signatureScores[letter] = score;
          }
          let sigBestLetter = null;
          let sigBestScore = -999;
          let sigSecondScore = -999;
          for (const [letter, score] of Object.entries(signatureScores)) {
            if (score > sigBestScore) {
              sigSecondScore = sigBestScore;
              sigBestScore = score;
              sigBestLetter = letter;
            } else if (score > sigSecondScore) {
              sigSecondScore = score;
            }
          }
          if (!sigBestLetter) return null;
          const sigMargin = sigBestScore - sigSecondScore;
          const sigFeat = featuresByLetter[sigBestLetter];
          const strongOutlier = sigBestScore >= 1.8 && sigMargin >= 0.8;
          const permissiveOutlier = sigBestScore >= 2.4 && sigMargin >= 0.5 && optionHits >= 1;
          if (!sigFeat || sigFeat.fragCount < 1 || !strongOutlier && !permissiveOutlier) return null;
          const remappedSig = OptionsMatchService.remapLetterToUserOptions(sigBestLetter, sourceOptionsFromGroups, originalOptionsMap);
          const sigConf = OptionsMatchService.verifyHighlightMatch(sigBestLetter, remappedSig, sourceOptionsFromGroups, originalOptionsMap, Math.max(0.82, Math.min(0.9, 0.82 + sigMargin * 0.06)));
          if (!sigConf) {
            console.log(`    [css-signature] REJECTED by content verification`);
            return null;
          }
          return { letter: sigConf.letter, confidence: sigConf.confidence, method: "css-signature", evidence: `sig_score=${sigBestScore.toFixed(2)} margin=${sigMargin.toFixed(2)} option_hits=${optionHits}` };
        },
        // ── PDF fragment joining ───────────────────────────────────────────────────
        _joinPdfFragments(frags) {
          if (!frags || frags.length === 0) return "";
          let result = frags[0].text || "";
          for (let i = 1; i < frags.length; i++) {
            const t = frags[i].text || "";
            if (!t) continue;
            const prevChar = result.slice(-1);
            const nextChar = t.charAt(0);
            const isMidWord = /[a-z\u00e0-\u00fc]/i.test(prevChar) && /[a-z\u00e0-\u00fc]/.test(nextChar);
            result += isMidWord ? t : " " + t;
          }
          return result.replace(/\s+/g, " ").trim();
        }
      };
    }
  });

  // src/services/search/EvidenceService.js
  var EvidenceService;
  var init_EvidenceService = __esm({
    "src/services/search/EvidenceService.js"() {
      init_QuestionParser();
      init_OptionsMatchService();
      EvidenceService = {
        // ── Question block finding ─────────────────────────────────────────────────
        findQuestionBlockByFingerprint(sourceText, questionText) {
          if (!sourceText || !questionText) return null;
          const stem = QuestionParser.extractQuestionStem(questionText);
          const stemTokens = QuestionParser.extractKeyTokens(stem);
          if (stemTokens.length < 3) return null;
          const optionTokens = QuestionParser.extractOptionTokens(questionText);
          const hasOptionTokens = optionTokens.length >= 2;
          let chunks = sourceText.split("\n");
          if (chunks.length < 5 || chunks.some((c) => c.length > 500)) {
            chunks = sourceText.replace(/([.?!])\s+(?=[A-Z0-9])/g, "$1\n").split("\n");
          }
          let bestStart = -1;
          let bestScore = 0;
          const windowSize = hasOptionTokens ? 10 : 5;
          for (let i = 0; i <= chunks.length - 1; i++) {
            const windowText = chunks.slice(i, i + windowSize).join(" ");
            const stemHits = QuestionParser.countTokenHits(windowText, stemTokens);
            const optHits = hasOptionTokens ? QuestionParser.countTokenHits(windowText, optionTokens) : 0;
            const score = stemHits + optHits * 2;
            if (score > bestScore) {
              bestScore = score;
              bestStart = i;
            }
          }
          const stemThreshold = Math.max(3, Math.floor(stemTokens.length * 0.45));
          const bestWindowText = bestStart >= 0 ? chunks.slice(bestStart, bestStart + windowSize).join(" ") : "";
          const bestStemHits = bestStart >= 0 ? QuestionParser.countTokenHits(bestWindowText, stemTokens) : 0;
          const bestOptHits = hasOptionTokens && bestStart >= 0 ? QuestionParser.countTokenHits(bestWindowText, optionTokens) : 0;
          console.log(`    [find-block] bestStart=${bestStart}, stemHits=${bestStemHits}/${stemTokens.length}, optHits=${bestOptHits}/${optionTokens.length}, score=${bestScore}`);
          if (bestStart < 0 || bestStemHits < stemThreshold) return null;
          if (hasOptionTokens) {
            const minOptionHits = Math.max(1, Math.floor(optionTokens.length * 0.25));
            if (bestOptHits < minOptionHits) {
              console.log(`    [find-block] REJECTED: only ${bestOptHits}/${optionTokens.length} option tokens found. Wrong question block.`);
              return null;
            }
          }
          const blockStart = Math.max(0, bestStart - 2);
          const blockEnd = Math.min(chunks.length, bestStart + 20);
          return chunks.slice(blockStart, blockEnd).join("\n");
        },
        findQuestionBlock(sourceText, questionText) {
          if (!sourceText || !questionText) return null;
          const qNumMatch = (questionText || "").match(/^\s*(\d{1,3})\s*[\)\.\:\-]/);
          if (qNumMatch) {
            const qNum = qNumMatch[1];
            const patterns = [
              new RegExp(`(?:^|\\n)\\s*${qNum}\\s*[\\)\\.\\.\\:\\-]`, "m"),
              new RegExp(`(?:^|\\n)\\s*(?:Quest[a\xE3]o|Quest\xE3o)\\s+${qNum}\\b`, "im")
            ];
            for (const re of patterns) {
              const match = re.exec(sourceText);
              if (match) {
                const start = Math.max(0, match.index - 50);
                const end = Math.min(sourceText.length, match.index + 3e3);
                return { text: sourceText.slice(start, end), method: "number" };
              }
            }
          }
          const fpBlock = this.findQuestionBlockByFingerprint(sourceText, questionText);
          if (fpBlock) return { text: fpBlock, method: "fingerprint" };
          return null;
        },
        buildQuestionScopedText(sourceText, questionText, maxChars = 3200) {
          const raw = String(sourceText || "").trim();
          if (!raw) return "";
          const block = this.findQuestionBlock(raw, questionText);
          if (block?.text && block.text.length >= 120) return block.text.slice(0, maxChars);
          return raw.slice(0, maxChars);
        },
        // ── HTML snippet for AI ────────────────────────────────────────────────────
        extractHtmlAroundQuestion(html, questionStem, optionTokens, maxChars = 6e3) {
          if (!html || !questionStem || html.length < 500) return null;
          const stemNorm = (questionStem || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
          const stemWords = stemNorm.split(/\s+/).filter((w) => w.length >= 5).slice(0, 6);
          if (stemWords.length < 2) return null;
          const htmlLower = html.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          let bestPos = -1;
          let bestHits = 0;
          for (let i = 0; i < htmlLower.length - 200; i += 200) {
            const window = htmlLower.substring(i, i + 600);
            let hits = 0;
            for (const w of stemWords) {
              if (window.includes(w)) hits++;
            }
            if (optionTokens?.length >= 2) {
              for (const t of optionTokens) {
                if (window.includes(t)) hits += 2;
              }
            }
            if (hits > bestHits) {
              bestHits = hits;
              bestPos = i;
            }
          }
          if (bestPos < 0 || bestHits < 2) return null;
          const halfWindow = Math.floor(maxChars / 2);
          let start = Math.max(0, bestPos - halfWindow);
          let end = Math.min(html.length, bestPos + halfWindow);
          const tagOpen = html.lastIndexOf("<", start + 50);
          if (tagOpen > start - 200 && tagOpen >= 0) start = tagOpen;
          const tagClose = html.indexOf(">", end - 50);
          if (tagClose > 0 && tagClose < end + 200) end = tagClose + 1;
          return html.substring(start, end);
        },
        // ── Candidate selection ────────────────────────────────────────────────────
        chooseBestCandidate(candidates) {
          if (!candidates || candidates.length === 0) return null;
          if (candidates.length === 1) return candidates[0];
          const patternPriority = {
            "gab-explicito": 1,
            "gab-letra": 0.9,
            "resposta-correta": 0.85,
            "gab-abrev": 0.8,
            "gab-inline": 0.7,
            "ai": 0.5
          };
          const scored = candidates.map((c) => ({ ...c, score: (c.confidence || 0.5) * (patternPriority[c.matchLabel] || 0.6) }));
          scored.sort((a, b) => b.score - a.score);
          const best = scored[0];
          const second = scored[1];
          if (second && second.letter !== best.letter && best.score - second.score < 0.15) {
            console.log(`EvidenceService: Conflict between candidates: ${best.letter}(${best.score.toFixed(2)}) vs ${second.letter}(${second.score.toFixed(2)})`);
            return null;
          }
          return best;
        },
        // ── Explicit gabarito extraction (polarity-aware) ──────────────────────────
        extractExplicitGabarito(text, questionText = "") {
          if (!text) return null;
          const questionPolarity = QuestionParser.detectQuestionPolarity(questionText);
          const patterns = [
            { re: /(?:^|\b)(?:gabarito|resposta\s+correta|alternativa\s+correta|item\s+correto)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi, label: "gab-explicito", confidence: 0.95 },
            { re: /(?:^|\b)(?:a\s+resposta\s+correta\s+[eé]|a\s+alternativa\s+correta\s+[eé])\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/gi, label: "resposta-correta", confidence: 0.92 },
            { re: /(?:^|\b)(?:letra|alternativa)\s+([A-E])\s*(?:[eé]\s+(?:a\s+)?(?:correta|certa|resposta))/gi, label: "gab-letra", confidence: 0.9 },
            { re: /(?:^|\b)gab(?:arito)?\.?\s*[:\-]?\s*([A-E])\b/gi, label: "gab-abrev", confidence: 0.88 }
          ];
          const matches = [];
          for (const { re, label, confidence } of patterns) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
              const letter = (m[1] || "").toUpperCase();
              if (!letter) continue;
              matches.push({ letter, confidence, matchLabel: label, index: m.index, questionPolarity });
            }
          }
          if (matches.length === 0) return null;
          return this.chooseBestCandidate(matches);
        },
        // ── Explicit letter from text ──────────────────────────────────────────────
        extractExplicitLetterFromText(text, questionStem, originalOptions) {
          if (!text) return null;
          const polarity = QuestionParser.detectQuestionPolarity(questionStem);
          const tokens = QuestionParser.extractKeyTokens(questionStem);
          const patterns = [
            /(?:^|\b)(?:gabarito|resposta\s+correta|alternativa\s+correta|item\s+correto)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/i,
            /(?:^|\b)(?:a\s+resposta\s+correta\s+e|a\s+alternativa\s+correta\s+e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i
          ];
          if (polarity === "INCORRECT" || polarity === "UNKNOWN") {
            patterns.push(
              /(?:^|\b)(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*(?:é|e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i,
              /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+([A-E])\s*(?:é|e)\s*(?:a\s+)?(?:falsa|incorreta|errada)\b/i,
              /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*[:\-]?\s*([A-E])\b/i,
              /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*(?:é|e)\s*(?:a\s+)?([A-E])\s*[\)\.\-:]/i
            );
          }
          for (const re of patterns) {
            const m = text.match(re);
            if (!m) continue;
            const letter = (m[1] || "").toUpperCase();
            if (!letter) continue;
            const idx = m.index || 0;
            const start = Math.max(0, idx - 600);
            const end = Math.min(text.length, idx + 900);
            const window = text.slice(start, end);
            if (tokens.length > 0 && QuestionParser.countTokenHits(window, tokens) < Math.min(2, tokens.length)) continue;
            if (originalOptions?.length >= 2 && !OptionsMatchService.optionsMatchInFreeText(originalOptions, window)) continue;
            return { letter, confidence: 0.9, evidence: window };
          }
          return null;
        },
        // ── Hallucination guard ────────────────────────────────────────────────────
        isExplicitLetterSafe(text, letter, expectedBody) {
          if (!expectedBody) return true;
          const isShortAcronym = expectedBody.length <= 6 && QuestionParser.looksLikeCodeOption(expectedBody);
          if (isShortAcronym && text.length > 80) {
            if (!QuestionParser.normalizeCodeAwareOption(text).includes(QuestionParser.normalizeCodeAwareOption(expectedBody))) {
              console.log(`    [guard] REJECT: Explicit said ${letter} but short option "${expectedBody}" is absent.`);
              return false;
            }
          }
          const rx = new RegExp(`(?:letra|alternativa|op[c\xE7][a\xE3]o|resposta)\\s*(?:correta\\s*(?:[e\xE9]\\s*(?:a\\s+)?)?)?${letter}\\s*[)\\.\\-:]?\\s*([^\\.\\.,;\\n]+)`, "i");
          const m = text.match(rx);
          if (m && m[1]) {
            const nextWords = QuestionParser.normalizeOption(m[1].trim());
            if (nextWords && !/^(?:pois|porque|já\s*que|dado|como|sendo|visto|uma\s*vez)/.test(nextWords)) {
              const dice = QuestionParser.diceSimilarity(nextWords, expectedBody);
              if (dice < 0.2) {
                const nextTokens = nextWords.split(/\s+/).filter((t) => t.length >= 3);
                let shared = 0;
                for (const tk of nextTokens) {
                  if (expectedBody.includes(tk)) shared++;
                }
                if (shared === 0 && nextTokens.length >= 1 && nextTokens.length <= 4) {
                  console.log(`    [guard] REJECT: Explicit text "${nextWords}" contradicts expected "${expectedBody}".`);
                  return false;
                }
              }
            }
          }
          return true;
        },
        // ── Local answer extraction ────────────────────────────────────────────────
        extractAnswerLocally(sourceText, questionText, originalOptions) {
          if (!sourceText || sourceText.length < 50) return null;
          const block = this.findQuestionBlock(sourceText, questionText);
          const searchText = block ? block.text : sourceText;
          const optionsMap = {};
          if (originalOptions) {
            for (const opt of originalOptions) {
              const m = opt.match(/^([A-E])\)\s*(.*)/i);
              if (m) optionsMap[m[1].toUpperCase()] = m[2].trim();
            }
          }
          const gabarito = this.extractExplicitGabarito(searchText, questionText);
          if (gabarito) {
            const expectedBody = optionsMap[gabarito.letter];
            if (!expectedBody || this.isExplicitLetterSafe(searchText, gabarito.letter, expectedBody)) {
              return { ...gabarito, evidenceType: "explicit-gabarito", blockMethod: block?.method || "full-text" };
            }
          }
          const explanationMatch = this.matchExplanationToOption(searchText, questionText, originalOptions);
          if (explanationMatch) return { ...explanationMatch, evidenceType: "explanation-content-match", blockMethod: block?.method || "full-text" };
          return null;
        },
        // ── Explanation-to-option matching ─────────────────────────────────────────
        matchExplanationToOption(sourceText, questionText, originalOptions) {
          if (!sourceText || !originalOptions || originalOptions.length < 2) return null;
          const questionStem = QuestionParser.extractQuestionStem(questionText);
          const stemTokens = QuestionParser.extractKeyTokens(questionStem);
          if (stemTokens.length < 2) return null;
          const polarity = QuestionParser.detectQuestionPolarity(questionStem);
          const hasNegation = polarity === "INCORRECT";
          const optionsMap = {};
          for (const opt of originalOptions) {
            const m = opt.match(/^([A-E])\)\s*(.*)/i);
            if (m) optionsMap[m[1].toUpperCase()] = m[2].trim();
          }
          if (Object.keys(optionsMap).length < 2) return null;
          const block = this.findQuestionBlock(sourceText, questionText);
          const searchText = block ? block.text : sourceText;
          const lastOptPattern = /(?:^|\n)\s*[eE]\s*[\)\.\-:]\s*.{5,}/m;
          const lastOptMatch = lastOptPattern.exec(searchText);
          if (!lastOptMatch) return null;
          const explanationStart = lastOptMatch.index + lastOptMatch[0].length;
          const explanationText = searchText.slice(explanationStart, explanationStart + 2e3).trim();
          if (explanationText.length < 80) return null;
          const explNorm = QuestionParser.normalizeOption(explanationText);
          const topicHits = QuestionParser.countTokenHits(explNorm, stemTokens);
          const requiredTopicHits = Math.max(2, Math.floor(stemTokens.length * 0.4));
          if (topicHits < requiredTopicHits) {
            console.log(`    [expl-match] REJECTED: topicHits=${topicHits} < required=${requiredTopicHits}`);
            return null;
          }
          const scores = {};
          for (const [letter, body] of Object.entries(optionsMap)) {
            const optNorm = QuestionParser.normalizeOption(body);
            const optTokens = optNorm.split(/\s+/).filter((t) => t.length >= 3);
            if (optTokens.length === 0) {
              scores[letter] = 0;
              continue;
            }
            let tokenHits = 0;
            for (const tok of optTokens) {
              if (explNorm.includes(tok)) tokenHits++;
            }
            const tokenRatio = tokenHits / optTokens.length;
            const dice = QuestionParser.diceSimilarity(explNorm, optNorm);
            scores[letter] = tokenRatio * 0.6 + dice * 0.4;
          }
          if (hasNegation) {
            const maxScore = Math.max(...Object.values(scores));
            if (maxScore > 0) {
              for (const letter of Object.keys(scores)) {
                scores[letter] = maxScore - scores[letter];
              }
            }
          }
          const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
          if (sorted.length < 2) return null;
          const [bestLetter, bestScore] = sorted[0];
          const [, secondScore] = sorted[1];
          const margin = bestScore - secondScore;
          if (bestScore < 0.25 || margin < 0.08) return null;
          let confidence = Math.min(0.88, 0.6 + bestScore * 0.2 + margin * 0.3);
          if (hasNegation) confidence = Math.min(confidence, 0.72);
          return { letter: bestLetter, confidence, matchLabel: "explanation-content-match", evidence: explanationText.slice(0, 500) };
        },
        // ── Stance classification ──────────────────────────────────────────────────
        extractOptionAnchor(optionBody = "") {
          const stop = /* @__PURE__ */ new Set([
            "assinale",
            "afirmativa",
            "alternativa",
            "correta",
            "incorreta",
            "resposta",
            "gabarito",
            "dados",
            "banco",
            "bancos",
            "modelo",
            "modelos",
            "nosql",
            "sql",
            "apenas",
            "nao",
            "com",
            "sem"
          ]);
          return QuestionParser.normalizeOption(optionBody).split(/\s+/).filter((t) => t.length >= 4 && !stop.has(t)).slice(0, 7).join(" ");
        },
        classifyOptionStance(evidenceText, optionBody, optionLetter) {
          const evidenceNorm = QuestionParser.normalizeOption(evidenceText || "");
          const optionNorm = QuestionParser.normalizeOption(optionBody || "");
          if (!evidenceNorm || !optionNorm) return { stance: "neutral", score: 0 };
          const letter = String(optionLetter || "").toUpperCase();
          const letPosRe = letter ? new RegExp(`(?:letra|alternativa|op\xE7\xE3o)\\s*${letter}\\s*(?:e|eh)?\\s*(?:a\\s+)?(?:correta|certa|resposta)`, "i") : null;
          const letNegRe = letter ? new RegExp(`(?:letra|alternativa|op\xE7\xE3o)\\s*${letter}\\s*(?:e|eh)?\\s*(?:a\\s+)?(?:incorreta|falsa|errada)`, "i") : null;
          if (letPosRe && letPosRe.test(evidenceText || "")) return { stance: "entails", score: 0.84 };
          if (letNegRe && letNegRe.test(evidenceText || "")) return { stance: "contradicts", score: 0.84 };
          const anchor = this.extractOptionAnchor(optionBody);
          if (!anchor || anchor.length < 10) return { stance: "neutral", score: 0 };
          const idx = evidenceNorm.indexOf(anchor);
          if (idx < 0) return { stance: "neutral", score: 0 };
          const start = Math.max(0, idx - 160);
          const end = Math.min(evidenceNorm.length, idx + anchor.length + 200);
          const ctx = evidenceNorm.slice(start, end);
          const hasPositive = /(gabarito|resposta correta|alternativa correta|esta correta|item correto|resposta final)/i.test(ctx);
          const hasNegative = /(incorreta|falsa|errada|nao correta|item incorreto)/i.test(ctx);
          if (hasPositive && !hasNegative) return { stance: "entails", score: 0.74 };
          if (hasNegative && !hasPositive) return { stance: "contradicts", score: 0.74 };
          return { stance: "neutral", score: 0.2 };
        },
        // ── Evidence block building ────────────────────────────────────────────────
        buildDefaultOptionEvals(originalOptionsMap = {}) {
          const evals = {};
          const letters = Object.keys(originalOptionsMap).length > 0 ? Object.keys(originalOptionsMap) : ["A", "B", "C", "D", "E"];
          for (const letter of letters) {
            evals[letter] = { stance: "neutral", score: 0 };
          }
          return evals;
        },
        buildEvidenceBlock({ questionFingerprint = "", sourceId = "", sourceLink = "", hostHint = "", evidenceText = "", originalOptionsMap = {}, explicitLetter = "", confidenceLocal = 0.65, evidenceType = "" } = {}) {
          const optionEvals = this.buildDefaultOptionEvals(originalOptionsMap);
          for (const [letter, body] of Object.entries(originalOptionsMap || {})) {
            optionEvals[letter] = this.classifyOptionStance(evidenceText, body, letter);
          }
          const chosen = String(explicitLetter || "").toUpperCase().trim();
          if (/^[A-E]$/.test(chosen)) {
            const prev = optionEvals[chosen] || { stance: "neutral", score: 0 };
            const nextScore = Math.max(prev.score || 0, Math.max(0.72, Math.min(0.96, Number(confidenceLocal) || 0.72)));
            optionEvals[chosen] = { stance: "entails", score: nextScore };
          }
          const citationText = String(evidenceText || "").replace(/\s+/g, " ").trim().slice(0, 320);
          return {
            questionFingerprint,
            sourceId,
            sourceLink: sourceLink || "",
            hostHint: hostHint || "",
            explicitLetter: /^[A-E]$/.test(chosen) ? chosen : null,
            optionEvals,
            citations: citationText ? [{ text: citationText, sourceLink: sourceLink || "", host: hostHint || "" }] : [],
            confidenceLocal: Math.max(0.25, Math.min(0.98, Number(confidenceLocal) || 0.65)),
            evidenceType: String(evidenceType || "")
          };
        },
        // ── Vote computation ───────────────────────────────────────────────────────
        computeVotesAndState(sources) {
          const votes = {};
          for (const s of sources) {
            if (!s.letter) continue;
            votes[s.letter] = (votes[s.letter] || 0) + (s.weight || 1);
          }
          const evidenceVotes = {};
          const evidenceEntailsCount = {};
          const evidenceDomainsByLetter = {};
          const getHostFromSource = (src) => {
            if (src?.hostHint) return String(src.hostHint).toLowerCase();
            try {
              return new URL(src?.link || "").hostname.replace(/^www\./, "").toLowerCase();
            } catch {
              return "";
            }
          };
          for (const src of sources) {
            if (!src?.evidenceBlock || !src?.letter) continue;
            const host = getHostFromSource(src);
            const block = src.evidenceBlock;
            const localWeight = Math.max(0.2, Math.min(1.1, block.confidenceLocal || 0.65));
            const optionEval = block.optionEvals?.[src.letter];
            if (optionEval?.stance !== "entails") continue;
            const evalScore = Math.max(0.2, Math.min(1, optionEval?.score || localWeight));
            const bonus = (src.weight || 1) * evalScore * 0.45;
            evidenceVotes[src.letter] = (evidenceVotes[src.letter] || 0) + bonus;
            evidenceEntailsCount[src.letter] = (evidenceEntailsCount[src.letter] || 0) + 1;
            if (!evidenceDomainsByLetter[src.letter]) evidenceDomainsByLetter[src.letter] = /* @__PURE__ */ new Set();
            if (host) evidenceDomainsByLetter[src.letter].add(host);
          }
          const mergedVotes = {};
          const allLetters = /* @__PURE__ */ new Set([...Object.keys(votes), ...Object.keys(evidenceVotes)]);
          for (const letter of allLetters) {
            mergedVotes[letter] = (votes[letter] || 0) + (evidenceVotes[letter] || 0);
          }
          const sorted = Object.entries(mergedVotes).sort((a, b) => b[1] - a[1]);
          const best = sorted[0] || null;
          const second = sorted[1] || null;
          const bestLetter = best ? best[0] : null;
          const bestScore = best ? best[1] : 0;
          const secondScore = second ? second[1] : 0;
          const total = sorted.reduce((acc, [, v]) => acc + v, 0) || 1;
          const margin = bestScore - secondScore;
          const getHost = (link) => {
            try {
              return new URL(link).hostname.replace(/^www\./, "").toLowerCase();
            } catch {
              return "";
            }
          };
          const isWeakHost = (host) => ["brainly.com.br", "brainly.com", "studocu.com", "passeidireto.com"].includes(String(host || "").toLowerCase());
          const isStrongSource = (src) => {
            const host = src.hostHint || getHost(src.link);
            const et = String(src.evidenceType || "").toLowerCase();
            if (isWeakHost(host)) return false;
            if (/\.(pdf)(\?|$)/i.test(String(src.link || ""))) return true;
            if (host.endsWith(".gov.br") || host.endsWith(".edu.br")) return true;
            if (host === "qconcursos.com" || host === "qconcursos.com.br") return true;
            if (et.includes("pdf-anchor") || et.includes("answercard")) return true;
            return false;
          };
          const nonAiSources = sources.filter((s) => s.evidenceType && s.evidenceType !== "ai" && s.evidenceType !== "ai-combined");
          const bestNonAi = nonAiSources.filter((s) => s.letter === bestLetter);
          const bestDomains = new Set(bestNonAi.map((s) => s.hostHint || getHost(s.link)).filter(Boolean));
          const bestStrongDomains = new Set(bestNonAi.filter(isStrongSource).map((s) => s.hostHint || getHost(s.link)).filter(Boolean));
          const bestEvidenceCount = bestLetter ? evidenceEntailsCount[bestLetter] || 0 : 0;
          const bestEvidenceDomains = bestLetter ? evidenceDomainsByLetter[bestLetter]?.size || 0 : 0;
          let resultState = "inconclusive";
          let reason = "inconclusive";
          if (bestLetter) {
            const hasAnyNonAi = bestNonAi.length > 0;
            const hasStrongConsensus = bestStrongDomains.size >= 2;
            const hasDomainConsensus = bestDomains.size >= 2;
            const hasMinimumVotes = bestScore >= 5;
            const hasMargin = margin >= 1;
            const hasEvidenceConsensus = bestEvidenceCount >= 2 && bestEvidenceDomains >= 2;
            const hasHighQualityMethod = bestNonAi.some((s) => {
              const et = String(s.evidenceType || "").toLowerCase();
              return et.includes("pdf") || et.includes("highlight") || et.includes("answercard") || et.includes("gabarito");
            });
            if (hasAnyNonAi && hasStrongConsensus && hasDomainConsensus && hasMinimumVotes && hasMargin && hasEvidenceConsensus) {
              resultState = "confirmed";
              reason = "confirmed_by_sources";
            } else if (hasAnyNonAi && hasHighQualityMethod && hasDomainConsensus && bestScore >= 3) {
              resultState = "confirmed";
              reason = "confirmed_high_quality";
            } else if (hasAnyNonAi && bestNonAi.length >= 2 && hasDomainConsensus && hasMargin) {
              resultState = "suggested";
              reason = "multiple_sources_agree";
            } else if (hasAnyNonAi && hasHighQualityMethod && bestScore >= 2) {
              resultState = "suggested";
              reason = "strong_method_found";
            } else if (hasAnyNonAi && bestNonAi.length >= 1 && bestScore >= 3) {
              if (hasDomainConsensus) {
                resultState = "suggested";
                reason = "multiple_sources_agree";
              } else {
                resultState = "suggested";
                reason = "single_source_match";
              }
            } else if (bestScore > 0 && !hasAnyNonAi && sources.length >= 2) {
              resultState = "suggested";
              reason = "ai_multiple_agree";
            } else if (bestScore > 0 && !hasAnyNonAi && sources.length === 1) {
              resultState = "suggested";
              reason = "ai_single_suggestion";
            } else if (second && margin < 1 && hasAnyNonAi) {
              resultState = "conflict";
              reason = "source_conflict";
            } else if (second && margin < 0.5) {
              resultState = "conflict";
              reason = "narrow_margin";
            }
          }
          const totalSources = sources.length;
          const nonAiCount = nonAiSources.filter((s) => s.letter === bestLetter).length;
          const uniqueDomainCount = bestDomains.size;
          const hasStrongMethod = bestNonAi.some((s) => {
            const et = String(s.evidenceType || "").toLowerCase();
            return et.includes("pdf") || et.includes("highlight") || et.includes("answercard") || et.includes("gabarito");
          });
          let confidence = 0.3;
          if (resultState === "confirmed") {
            confidence = 0.85;
            if (bestStrongDomains.size >= 3) confidence += 0.04;
            if (bestEvidenceCount >= 3) confidence += 0.03;
            if (margin >= 3) confidence += 0.02;
            if (hasStrongMethod) confidence += 0.02;
            confidence = Math.min(0.96, confidence);
          } else if (resultState === "suggested") {
            confidence = 0.4;
            confidence += Math.min(0.15, nonAiCount * 0.05);
            confidence += Math.min(0.1, uniqueDomainCount * 0.05);
            if (hasStrongMethod) confidence += 0.08;
            if (margin >= 2) confidence += 0.08;
            else if (margin >= 1) confidence += 0.04;
            if (bestEvidenceCount >= 2) confidence += 0.06;
            else if (bestEvidenceCount >= 1) confidence += 0.03;
            confidence += Math.min(0.05, totalSources * 0.01);
            if (reason === "ai_single_suggestion") confidence = Math.min(confidence, 0.52);
            else if (reason === "ai_multiple_agree") confidence = Math.min(confidence, 0.62);
            else if (reason === "single_source_match") confidence = Math.min(confidence, 0.68);
            else confidence = Math.min(confidence, 0.82);
          } else if (resultState === "conflict") {
            const ratio = secondScore > 0 ? bestScore / secondScore : 2;
            confidence = Math.max(0.25, Math.min(0.45, 0.3 + (ratio - 1) * 0.15));
          } else {
            if (totalSources > 0 && bestScore > 0) {
              confidence = Math.max(0.25, Math.min(0.4, 0.25 + totalSources * 0.02));
            } else {
              confidence = 0.2;
            }
          }
          confidence = Math.round(confidence * 100) / 100;
          confidence = Math.max(0.1, Math.min(0.98, confidence));
          return {
            votes: mergedVotes,
            baseVotes: votes,
            evidenceVotes,
            bestLetter,
            resultState,
            reason,
            confidence,
            margin,
            evidenceConsensus: { bestEvidenceCount, bestEvidenceDomains }
          };
        }
      };
    }
  });

  // src/services/search/SearchCacheService.js
  var SearchCacheService;
  var init_SearchCacheService = __esm({
    "src/services/search/SearchCacheService.js"() {
      SearchCacheService = {
        // ── Decision cache config ──────────────────────────────────────────────────
        SEARCH_CACHE_KEY: "ahSearchDecisionCacheV2",
        SEARCH_METRICS_KEY: "ahSearchMetricsV1",
        CACHE_MAX_ENTRIES: 220,
        CACHE_MAX_AGE_MS: 1e3 * 60 * 60 * 24 * 7,
        // 7 days
        // ── Snapshot cache (in-memory, per-session) ────────────────────────────────
        snapshotCache: /* @__PURE__ */ new Map(),
        // url → { snap, fetchedAt }
        SNAPSHOT_CACHE_TTL: 5 * 60 * 1e3,
        // 5 minutes
        SNAPSHOT_CACHE_MAX: 30,
        // ── AI extraction result cache ─────────────────────────────────────────────
        _aiResultCache: null,
        // null = not yet loaded from storage
        AI_RESULT_CACHE_KEY: "ahAiResultCacheV1",
        AI_RESULT_CACHE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1e3,
        // 7 days
        AI_RESULT_CACHE_MAX_ENTRIES: 500,
        // ── Low-level storage helpers ──────────────────────────────────────────────
        async storageGet(keys) {
          try {
            if (typeof chrome === "undefined" || !chrome?.storage?.local) return {};
            return await chrome.storage.local.get(keys);
          } catch {
            return {};
          }
        },
        async storageSet(payload) {
          try {
            if (typeof chrome === "undefined" || !chrome?.storage?.local) return;
            await chrome.storage.local.set(payload);
          } catch {
          }
        },
        // ── Snapshot cache ─────────────────────────────────────────────────────────
        evictStaleSnapshots() {
          const now = Date.now();
          for (const [url, entry] of this.snapshotCache) {
            if (now - entry.fetchedAt > this.SNAPSHOT_CACHE_TTL) {
              this.snapshotCache.delete(url);
            }
          }
        },
        setSnapshot(url, snap) {
          if (this.snapshotCache.size >= this.SNAPSHOT_CACHE_MAX) {
            const oldest = [...this.snapshotCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
            if (oldest) this.snapshotCache.delete(oldest[0]);
          }
          this.snapshotCache.set(url, { snap, fetchedAt: Date.now() });
        },
        getSnapshot(url) {
          return this.snapshotCache.get(url) || null;
        },
        // ── AI extraction result cache ─────────────────────────────────────────────
        /**
         * Returns a stable cache key: hostname + first 80 chars of question stem.
         */
        getAiResultCacheKey(url, questionStem) {
          let host = url;
          try {
            host = new URL(url).hostname;
          } catch (_) {
          }
          const stem = String(questionStem || "").replace(/\s+/g, " ").trim().slice(0, 80);
          return `${host}|${stem}`;
        },
        /**
         * Load AI result cache from storage (no-op if already loaded).
         */
        async loadAiResultCache() {
          if (this._aiResultCache !== null) return;
          this._aiResultCache = /* @__PURE__ */ new Map();
          try {
            await new Promise((resolve) => {
              chrome.storage.local.get([this.AI_RESULT_CACHE_KEY], (result) => {
                const raw = result[this.AI_RESULT_CACHE_KEY];
                if (raw && typeof raw === "object") {
                  const now = Date.now();
                  for (const [k, v] of Object.entries(raw)) {
                    if (v && now - (v.cachedAt || 0) < this.AI_RESULT_CACHE_MAX_AGE_MS) {
                      this._aiResultCache.set(k, v);
                    }
                  }
                }
                resolve();
              });
            });
          } catch (_) {
          }
        },
        /**
         * Persist AI result cache to storage (fire-and-forget).
         */
        async saveAiResultCache() {
          if (!this._aiResultCache) return;
          try {
            if (this._aiResultCache.size > this.AI_RESULT_CACHE_MAX_ENTRIES) {
              const sorted = [...this._aiResultCache.entries()].sort((a, b) => (a[1].cachedAt || 0) - (b[1].cachedAt || 0));
              const toDelete = sorted.slice(0, this._aiResultCache.size - this.AI_RESULT_CACHE_MAX_ENTRIES);
              for (const [k] of toDelete) this._aiResultCache.delete(k);
            }
            const obj = Object.fromEntries(this._aiResultCache);
            chrome.storage.local.set({ [this.AI_RESULT_CACHE_KEY]: obj });
          } catch (_) {
          }
        },
        /**
         * Returns cached AI extraction result or null if missing/expired.
         */
        getCachedAiResult(url, questionStem) {
          if (!this._aiResultCache) return null;
          const key = this.getAiResultCacheKey(url, questionStem);
          const entry = this._aiResultCache.get(key);
          if (!entry) return null;
          if (Date.now() - (entry.cachedAt || 0) > this.AI_RESULT_CACHE_MAX_AGE_MS) {
            this._aiResultCache.delete(key);
            return null;
          }
          return entry;
        },
        /**
         * Stores an AI extraction result and persists asynchronously.
         */
        setCachedAiResult(url, questionStem, result) {
          if (!this._aiResultCache) return;
          const key = this.getAiResultCacheKey(url, questionStem);
          this._aiResultCache.set(key, { ...result, cachedAt: Date.now() });
          this.saveAiResultCache();
        },
        // ── Decision cache ─────────────────────────────────────────────────────────
        async _getDecisionCacheBucket() {
          const data = await this.storageGet([this.SEARCH_CACHE_KEY]);
          const bucket = data?.[this.SEARCH_CACHE_KEY];
          return bucket && typeof bucket === "object" ? bucket : {};
        },
        async _setDecisionCacheBucket(bucket) {
          const safeBucket = bucket && typeof bucket === "object" ? bucket : {};
          await this.storageSet({ [this.SEARCH_CACHE_KEY]: safeBucket });
        },
        async clearSearchCache(options = {}) {
          const { keepMetrics = true } = options || {};
          const payload = { [this.SEARCH_CACHE_KEY]: {} };
          if (!keepMetrics) payload[this.SEARCH_METRICS_KEY] = {};
          await this.storageSet(payload);
        },
        async getCachedDecision(questionFingerprint) {
          if (!questionFingerprint) return null;
          const bucket = await this._getDecisionCacheBucket();
          const entry = bucket?.[questionFingerprint];
          if (!entry || typeof entry !== "object") return null;
          const age = Date.now() - Number(entry.updatedAt || 0);
          if (!Number.isFinite(age) || age < 0 || age > this.CACHE_MAX_AGE_MS) return null;
          const decision = entry.decision;
          if (!decision || decision.resultState !== "confirmed") return null;
          if (decision.evidenceTier !== "EVIDENCE_STRONG") return null;
          return decision;
        },
        sanitizeSourcesForCache(sources = []) {
          return (sources || []).slice(0, 8).map((s) => ({
            title: String(s?.title || ""),
            link: String(s?.link || ""),
            hostHint: String(s?.hostHint || ""),
            evidenceType: String(s?.evidenceType || ""),
            letter: String(s?.letter || ""),
            weight: Number(s?.weight || 0)
          })).filter((s) => s.link || s.hostHint || s.letter);
        },
        async setCachedDecision(questionFingerprint, resultItem, sources = []) {
          if (!questionFingerprint || !resultItem) return;
          const bucket = await this._getDecisionCacheBucket();
          const now = Date.now();
          const sourceLinks = (sources || []).map((s) => String(s?.link || "").trim()).filter(Boolean).slice(0, 12);
          bucket[questionFingerprint] = {
            updatedAt: now,
            decision: {
              answer: String(resultItem.answer || ""),
              answerLetter: String(resultItem.answerLetter || ""),
              answerText: String(resultItem.answerText || ""),
              bestLetter: String(resultItem.bestLetter || ""),
              votes: resultItem.votes || {},
              baseVotes: resultItem.baseVotes || {},
              evidenceVotes: resultItem.evidenceVotes || {},
              confidence: Number(resultItem.confidence || 0),
              resultState: String(resultItem.resultState || "inconclusive"),
              reason: String(resultItem.reason || "inconclusive"),
              evidenceTier: String(resultItem.evidenceTier || "EVIDENCE_WEAK"),
              evidenceConsensus: resultItem.evidenceConsensus || {},
              questionPolarity: String(resultItem.questionPolarity || "CORRECT"),
              sources: this.sanitizeSourcesForCache(sources)
            },
            sourceLinks
          };
          const keys = Object.keys(bucket);
          if (keys.length > this.CACHE_MAX_ENTRIES) {
            keys.map((k) => ({ k, t: Number(bucket[k]?.updatedAt || 0) })).sort((a, b) => a.t - b.t).slice(0, keys.length - this.CACHE_MAX_ENTRIES).forEach((entry) => {
              delete bucket[entry.k];
            });
          }
          await this._setDecisionCacheBucket(bucket);
        },
        async getCachedSourceLinks(questionFingerprint) {
          if (!questionFingerprint) return [];
          const bucket = await this._getDecisionCacheBucket();
          const entry = bucket?.[questionFingerprint];
          if (!entry) return [];
          const sourceLinks = Array.isArray(entry.sourceLinks) ? entry.sourceLinks : [];
          return sourceLinks.map((l) => String(l || "").trim()).filter(Boolean).slice(0, 12);
        },
        async mergeCachedSourcesIntoResults(questionFingerprint, results = []) {
          const cachedLinks = await this.getCachedSourceLinks(questionFingerprint);
          if (!cachedLinks || cachedLinks.length === 0) return results || [];
          const merged = /* @__PURE__ */ new Map();
          for (const item of results || []) {
            const link = String(item?.link || "").trim();
            if (!link) continue;
            if (!merged.has(link)) merged.set(link, item);
          }
          for (const link of cachedLinks) {
            if (merged.has(link)) continue;
            merged.set(link, { title: "Cached source", snippet: "", link, fromCache: true });
          }
          return Array.from(merged.values());
        },
        // ── Canonical hash ─────────────────────────────────────────────────────────
        /**
         * Creates a stable SHA-256 hash from a canonical question string.
         * Requires QuestionParser.canonicalizeQuestion(questionText) to be passed in.
         */
        async canonicalHash(canonicalText) {
          if (typeof crypto !== "undefined" && crypto.subtle) {
            try {
              const encoder = new TextEncoder();
              const data = encoder.encode(canonicalText);
              const hashBuffer = await crypto.subtle.digest("SHA-256", data);
              const hashArray = Array.from(new Uint8Array(hashBuffer));
              return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
            } catch {
            }
          }
          let hash = 2166136261;
          for (let i = 0; i < canonicalText.length; i++) {
            hash ^= canonicalText.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          return (hash >>> 0).toString(16);
        },
        // ── Metrics ────────────────────────────────────────────────────────────────
        async recordMetrics(payload = {}) {
          const {
            cacheHit = false,
            outcome = "finished",
            resultState = "inconclusive",
            evidenceTier = "EVIDENCE_WEAK",
            runStats = null,
            bestLetter = "",
            confidence = 0
          } = payload;
          try {
            const data = await this.storageGet([this.SEARCH_METRICS_KEY]);
            const metrics = data?.[this.SEARCH_METRICS_KEY] || {
              totalRuns: 0,
              cacheHits: 0,
              outcomes: {},
              resultStates: {},
              evidenceTiers: {},
              blocked: { paywall: 0, obfuscation: 0, optionsMismatch: 0, snapshotMismatch: 0, errors: 0 },
              lastRuns: []
            };
            metrics.totalRuns += 1;
            if (cacheHit) metrics.cacheHits += 1;
            metrics.outcomes[outcome] = (metrics.outcomes[outcome] || 0) + 1;
            metrics.resultStates[resultState] = (metrics.resultStates[resultState] || 0) + 1;
            metrics.evidenceTiers[evidenceTier] = (metrics.evidenceTiers[evidenceTier] || 0) + 1;
            if (runStats) {
              metrics.blocked.paywall += Number(runStats.blockedPaywall || 0);
              metrics.blocked.obfuscation += Number(runStats.blockedObfuscation || 0);
              metrics.blocked.optionsMismatch += Number(runStats.blockedOptionsMismatch || 0);
              metrics.blocked.snapshotMismatch += Number(runStats.blockedSnapshotMismatch || 0);
              metrics.blocked.errors += Number(runStats.blockedByError || 0);
            }
            metrics.lastRuns.push({
              at: Date.now(),
              outcome,
              cacheHit: !!cacheHit,
              resultState,
              evidenceTier,
              bestLetter: String(bestLetter || ""),
              confidence: Number(confidence || 0),
              analyzed: Number(runStats?.analyzed || 0),
              acceptedVotes: Number(runStats?.acceptedForVotes || 0),
              acceptedAi: Number(runStats?.acceptedForAiEvidence || 0)
            });
            if (metrics.lastRuns.length > 120) {
              metrics.lastRuns = metrics.lastRuns.slice(metrics.lastRuns.length - 120);
            }
            metrics.updatedAt = Date.now();
            await this.storageSet({ [this.SEARCH_METRICS_KEY]: metrics });
          } catch {
          }
        }
      };
    }
  });

  // src/services/search/FreeTextAnswerService.js
  var _ApiService, getApiService, FreeTextAnswerService;
  var init_FreeTextAnswerService = __esm({
    "src/services/search/FreeTextAnswerService.js"() {
      init_QuestionParser();
      init_OptionsMatchService();
      _ApiService = null;
      getApiService = async () => {
        if (!_ApiService) {
          const mod = await Promise.resolve().then(() => (init_ApiService(), ApiService_exports));
          _ApiService = mod.ApiService;
        }
        return _ApiService;
      };
      FreeTextAnswerService = {
        // ── Public entry point ────────────────────────────────────────────────────
        /**
         * Attempts to map the natural-language answer found in `pageText` to one
         * of the user's options.
         *
         * @param {string} pageText  - full plain text of the source page
         * @param {Object} optionsMap - { A: "body", B: "body", ... }
         * @param {string} questionStem - stem of the user's question (for relevance check)
         * @returns {{ letter, confidence, method, snippet } | null}
         */
        async extractAnswerFromFreeText(pageText, optionsMap, questionStem) {
          if (!pageText || !optionsMap || Object.keys(optionsMap).length < 2) return null;
          const answerBlock = this._extractAnswerBlock(pageText);
          if (!answerBlock) return null;
          const s1 = this._strategyAnchor(answerBlock, optionsMap);
          if (s1) return s1;
          const s2 = this._strategyInverseScan(answerBlock, optionsMap);
          if (s2) return s2;
          return await this._strategyLLM(answerBlock, optionsMap, questionStem);
        },
        // ── Answer block extraction ───────────────────────────────────────────────
        /**
         * Finds the "Resposta:" section in the page text and returns the answer body.
         * Returns null if no recognizable answer block is found.
         */
        _extractAnswerBlock(pageText) {
          const text = String(pageText || "");
          const lines = text.replace(/\r/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
          const ANSWER_MARKER = /^(?:resposta|resposta\s+correta|alternativa\s+correta)\s*[:\-]?\s*$/i;
          const INLINE_MARKER = /^(?:resposta|resposta\s+correta|alternativa\s+correta)\s*[:\-]\s*(.+)$/i;
          const NOISE_STOP = /^(?:explica[cç][aã]o|coment[aá]rio|pergunta|quest[aã]o|ver\s+mais|resposta[s]?\s+relacionadas|novas?\s+perguntas|ainda\s+tem|experimente|confira)\b/i;
          const UI_NOISE = /^(?:\d+\s+pesso|aluno|entrar|anuncio|bloqueador|avaliacao|para\s+estudantes|para\s+pais|codigo\s+de\s+conduta|brainly\b)/i;
          for (const line of lines) {
            const m = line.match(INLINE_MARKER);
            if (m?.[1] && m[1].length >= 12) return m[1].trim();
          }
          for (let i = 0; i < lines.length; i++) {
            if (!ANSWER_MARKER.test(lines[i])) continue;
            const collected = [];
            for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
              const next = lines[j];
              if (!next) continue;
              if (NOISE_STOP.test(next) || UI_NOISE.test(next)) break;
              if (collected.length > 0 && next.length < 5) break;
              collected.push(next);
              if (collected.length === 1 && next.length > 30) break;
            }
            if (collected.length > 0) return collected.join(" ").trim();
          }
          return null;
        },
        // ── Strategy 1: anchor via OptionsMatchService ────────────────────────────
        _strategyAnchor(answerBlock, optionsMap) {
          if (!answerBlock || answerBlock.length < 10) return null;
          const mapped = OptionsMatchService.matchAnswerTextToOptions(answerBlock, optionsMap);
          if (!mapped?.letter) return null;
          if ((mapped.confidence || 0) < 0.65) return null;
          if ((mapped.margin || 0) < 0.06) return null;
          return {
            letter: mapped.letter,
            confidence: Math.min(0.88, mapped.confidence),
            method: "freetext-anchor",
            snippet: answerBlock.slice(0, 200)
          };
        },
        // ── Strategy 2: inverse scan ──────────────────────────────────────────────
        /**
         * For each option in optionsMap, computes how well the answer block matches
         * that option using Dice similarity. Picks the winner if the margin is clear.
         */
        _strategyInverseScan(answerBlock, optionsMap) {
          if (!answerBlock || answerBlock.length < 8) return null;
          const normAnswer = QuestionParser.normalizeOption(answerBlock);
          if (!normAnswer || normAnswer.length < 6) return null;
          const scores = [];
          for (const [letter, body] of Object.entries(optionsMap)) {
            if (!body) continue;
            const normBody = QuestionParser.normalizeOption(body);
            if (!normBody || normBody.length < 4) continue;
            const dice = QuestionParser.diceSimilarity(
              normAnswer.slice(0, 200),
              normBody.slice(0, 200)
            );
            const answerContainsOption = normAnswer.includes(normBody.slice(0, Math.min(normBody.length, 40)));
            const optionContainsAnswer = normBody.includes(normAnswer.slice(0, Math.min(normAnswer.length, 40)));
            const containmentBonus = answerContainsOption || optionContainsAnswer ? 0.25 : 0;
            scores.push({ letter, score: Math.min(1, dice + containmentBonus), body });
          }
          if (scores.length < 2) return null;
          scores.sort((a, b) => b.score - a.score);
          const top = scores[0];
          const second = scores[1];
          const margin = top.score - second.score;
          if (top.score < 0.18 || margin < 0.12) return null;
          const confidence = Math.min(0.82, 0.55 + top.score * 0.3 + margin * 0.2);
          return {
            letter: top.letter,
            confidence,
            method: "freetext-semantic",
            snippet: answerBlock.slice(0, 200)
          };
        },
        // ── Strategy 3: LLM fallback ──────────────────────────────────────────────
        async _strategyLLM(answerBlock, optionsMap, questionStem) {
          if (!answerBlock || answerBlock.length < 8) return null;
          const optionsList = Object.entries(optionsMap).map(([letter, body]) => `${letter}) ${body}`).join("\n");
          if (!optionsList) return null;
          const syntheticPageText = `Resposta:
${answerBlock}

Alternativas:
${optionsList}`;
          const questionText = questionStem ? `${questionStem}
${optionsList}` : optionsList;
          try {
            const ApiService2 = await getApiService();
            const result = await ApiService2.aiExtractFromPage(syntheticPageText, questionText, "brainly.com.br");
            if (!result?.letter) return null;
            return {
              letter: result.letter,
              confidence: Math.min(0.74, result.confidence || 0.7),
              method: "freetext-ai",
              snippet: answerBlock.slice(0, 200)
            };
          } catch {
            return null;
          }
        }
      };
    }
  });

  // src/services/SearchService.js
  var SearchService;
  var init_SearchService = __esm({
    "src/services/SearchService.js"() {
      init_ApiService();
      init_QuestionParser();
      init_OptionsMatchService();
      init_HtmlExtractorService();
      init_EvidenceService();
      init_SearchCacheService();
      init_FreeTextAnswerService();
      SearchService = {
        // 7 days
        // Snapshot cache: reuse fetched pages across searches (same session)
        // url → { snap, fetchedAt }
        // 5 minutes
        // max 30 URLs in memory
        // AI extraction result cache: persisted to chrome.storage.local so LLM calls
        // are not repeated for the same URL + question on subsequent searches.
        // null = not loaded yet; Map<cacheKey, {letter,knowledge,cachedAt}>
        // 7 days
        _buildOptionsMap(questionText) {
          const options = QuestionParser.extractOptionsFromQuestion(questionText);
          const map = {};
          for (const opt of options) {
            const m = opt.match(/^([A-E])\)\s*(.+)$/i);
            if (m) map[m[1].toUpperCase()] = QuestionParser.stripOptionTailNoise(m[2]);
          }
          return map;
        },
        _parseAnswerLetter(answerText) {
          if (!answerText) return null;
          const text = String(answerText).replace(/\r/g, "\n").trim();
          if (!text) return null;
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const finalLineRe = /^(?:(?:resposta\s+final|conclus[aã]o|gabarito)\s*[:\-]\s*)?(?:letra|gabarito|resposta\s+final|alternativa\s+correta|letter|option)\s*[:\-]?\s*([A-E])\b(?:\s*[:.\-]|$)/i;
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
            const m = lines[i].match(finalLineRe);
            if (m) return (m[1] || "").toUpperCase();
          }
          const taggedMatches = [...text.matchAll(/(?:^|\b)(?:resposta\s+final|gabarito|alternativa\s+correta|letra|letter|option)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
          const uniqueTagged = [...new Set(taggedMatches)];
          if (uniqueTagged.length === 1) return uniqueTagged[0];
          if (uniqueTagged.length > 1) return null;
          const prosePatterns = [/(?:resposta|answer)\s+(?:correta\s+)?(?:[eéÉ]|seria)\s+(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /(?:alternativa|opção|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?([A-E])\b/gi, /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi];
          for (const re of prosePatterns) {
            const proseHits = [...text.matchAll(re)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
            const uniqueProse = [...new Set(proseHits)];
            if (uniqueProse.length === 1) return uniqueProse[0];
          }
          const optionLineMatches = [...text.matchAll(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s+/gim)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
          const uniqueOptionLines = [...new Set(optionLineMatches)];
          if (uniqueOptionLines.length === 1) return uniqueOptionLines[0];
          const asksIncorrect = /\b(incorreta|falsa|exceto|n[aã]o\s+[eé]|errada)\b/i.test(text);
          const vfAll = [...text.matchAll(/\b([A-E])\s*\)\s*[*_]*\s*([VF])\b/gi)];
          if (vfAll.length >= 2) {
            const targetMark = asksIncorrect ? "F" : "V";
            const targets = vfAll.filter((m) => String(m[2]).toUpperCase() === targetMark);
            if (targets.length === 1) return String(targets[0][1]).toUpperCase();
          }
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            if (lastLine.length < 40) {
              const bareMatch = lastLine.match(/\b([A-E])\b/i);
              if (bareMatch) return bareMatch[1].toUpperCase();
            }
          }
          return null;
        },
        _parseAnswerText(answerText) {
          if (!answerText) return "";
          const text = String(answerText).replace(/\r/g, "\n").trim();
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const finalBodyRe = /(?:letra|alternativa|letter|option)\s*[A-E]\s*[:.\-]\s*(.{5,})/i;
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
            const m = lines[i].match(finalBodyRe);
            if (m && m[1]) return m[1].trim();
          }
          return text.replace(/^(?:Letra|Alternativa|Letter|Option)\s*[A-E]\s*[:.\-]?\s*/i, "").replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, "").trim();
        },
        // ▸▸▸ GOOGLE AI OVERVIEW / ANSWER BOX EXTRACTION ▸▸▸
        // Extracts an answer letter from Serper meta signals (answerBox, aiOverview,
        // peopleAlsoAsk) that come "for free" with the search results.
        _extractLetterFromGoogleMeta(serperMeta, questionStem, originalOptionsMap, originalOptions) {
          if (!serperMeta) return null;
          const results = [];
          const ab = serperMeta.answerBox;
          if (ab) {
            const abText = [ab.title, ab.snippet, ab.answer, ab.highlighted_words?.join(" ")].filter(Boolean).join(" ").trim();
            if (abText.length >= 20) {
              const parsed = this._parseGoogleMetaText(abText, originalOptionsMap, originalOptions);
              if (parsed) {
                results.push({
                  ...parsed,
                  method: "google-answerbox",
                  evidence: abText.slice(0, 600)
                });
              }
            }
          }
          const aio = serperMeta.aiOverview;
          if (aio) {
            let aioText = "";
            if (typeof aio === "string") {
              aioText = aio;
            } else if (aio.text_blocks && Array.isArray(aio.text_blocks)) {
              aioText = this._flattenAiOverviewBlocks(aio.text_blocks);
            } else if (aio.snippet) {
              aioText = String(aio.snippet || "");
            } else if (aio.text) {
              aioText = String(aio.text || "");
            }
            if (aioText.length >= 30) {
              const parsed = this._parseGoogleMetaText(aioText, originalOptionsMap, originalOptions);
              if (parsed) {
                results.push({
                  ...parsed,
                  method: "google-ai-overview",
                  evidence: aioText.slice(0, 800)
                });
              }
            }
          }
          const paa = serperMeta.peopleAlsoAsk;
          if (Array.isArray(paa) && paa.length > 0) {
            const normStem = QuestionParser.normalizeOption(questionStem);
            for (const entry of paa.slice(0, 4)) {
              const paaQ = String(entry.question || entry.title || "");
              const paaSnippet = String(entry.snippet || entry.answer || "");
              if (!paaSnippet || paaSnippet.length < 20) continue;
              const paaQNorm = QuestionParser.normalizeOption(paaQ);
              const qSim = QuestionParser.diceSimilarity(normStem, paaQNorm);
              if (qSim < 0.4) continue;
              const parsed = this._parseGoogleMetaText(paaSnippet, originalOptionsMap, originalOptions);
              if (parsed) {
                results.push({
                  ...parsed,
                  confidence: Math.min(parsed.confidence, 0.72),
                  method: "google-paa",
                  evidence: `Q: ${paaQ}
A: ${paaSnippet}`.slice(0, 500)
                });
                break;
              }
            }
          }
          if (results.length === 0) return null;
          results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
          const best = results[0];
          console.log(`SearchService: [google-meta] Found letter=${best.letter} confidence=${best.confidence.toFixed(2)} method=${best.method} from ${results.length} candidate(s)`);
          return best;
        },
        // Flatten AI Overview text_blocks (nested structure from Serper/SerpAPI)
        _flattenAiOverviewBlocks(blocks) {
          if (!Array.isArray(blocks)) return "";
          const parts = [];
          for (const block of blocks) {
            if (block.snippet) parts.push(block.snippet);
            if (block.text) parts.push(block.text);
            if (block.list && Array.isArray(block.list)) {
              for (const item of block.list) {
                if (item.snippet) parts.push(item.snippet);
                if (item.title) parts.push(item.title);
                if (item.text_blocks) parts.push(this._flattenAiOverviewBlocks(item.text_blocks));
              }
            }
            if (block.text_blocks) parts.push(this._flattenAiOverviewBlocks(block.text_blocks));
          }
          return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        },
        // Core parser: extracts answer letter from Google meta text by:
        // 1. Explicit "alternativa correta é a C" / "Letra C" patterns
        // 2. Content match against user's option bodies
        _parseGoogleMetaText(text, originalOptionsMap, originalOptions) {
          if (!text || text.length < 15) return null;
          const explicitPatterns = [/(?:alternativa|resposta|gabarito|letra|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /\b([A-E])\s*[\)\.\-:]\s*(?:[Nn][aã]o\s+exige|[Ee]xige|[Pp]ermite|[Rr]equere?|[Dd]efine|[Rr]epresenta)/gi, /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /(?:alternativa\s+correta\s+(?:[eéÉ]|seria)\s+(?:a\s+)?)([A-E])\b/gi];
          const explicitHits = [];
          for (const re of explicitPatterns) {
            for (const m of text.matchAll(re)) {
              const letter = (m[1] || "").toUpperCase();
              if (/^[A-E]$/.test(letter)) explicitHits.push(letter);
            }
          }
          const uniqueExplicit = [...new Set(explicitHits)];
          if (uniqueExplicit.length === 1) {
            const letter = uniqueExplicit[0];
            if (originalOptionsMap && originalOptionsMap[letter]) {
              return {
                letter,
                confidence: 0.88
              };
            }
          }
          const checkMarkPatterns = [/[✅✓☑]\s*(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /(?:correta|certa|right|correct)\s*[:\-–]?\s*(?:alternativa\s+|letra\s+)?([A-E])\b/gi];
          for (const re of checkMarkPatterns) {
            const matches = [...text.matchAll(re)].map((m) => (m[1] || "").toUpperCase()).filter((l) => /^[A-E]$/.test(l));
            const unique = [...new Set(matches)];
            if (unique.length === 1 && originalOptionsMap?.[unique[0]]) {
              return {
                letter: unique[0],
                confidence: 0.85
              };
            }
          }
          if (originalOptionsMap && Object.keys(originalOptionsMap).length >= 2) {
            const normText = QuestionParser.normalizeOption(text);
            let bestLetter = null;
            let bestScore = 0;
            let bestMethod = "";
            for (const [letter, body] of Object.entries(originalOptionsMap)) {
              const normBody = QuestionParser.normalizeOption(body);
              if (!normBody || normBody.length < 8) continue;
              if (normText.includes(normBody)) {
                const score = normBody.length;
                if (score > bestScore) {
                  bestScore = score;
                  bestLetter = letter;
                  bestMethod = "containment";
                }
                continue;
              }
              const dice = QuestionParser.diceSimilarity(normText, normBody);
              if (dice >= 0.65 && dice * 100 > bestScore) {
                bestScore = dice * 100;
                bestLetter = letter;
                bestMethod = "dice";
              }
            }
            if (bestLetter) {
              const conf = bestMethod === "containment" ? 0.82 : 0.68;
              console.log(`SearchService: [google-meta] Content-match: letter=${bestLetter} method=${bestMethod} score=${bestScore}`);
              return {
                letter: bestLetter,
                confidence: conf
              };
            }
          }
          const parsedLetter = this._parseAnswerLetter(text);
          if (parsedLetter && originalOptionsMap?.[parsedLetter]) {
            return {
              letter: parsedLetter,
              confidence: 0.7
            };
          }
          return null;
        },
        // Parses A) / B) / C) options from source text and returns {letter: body} map.
        // Handles line-by-line format AND inline "A) text B) text" format.
        _buildSourceOptionsMapFromText(sourceText) {
          if (!sourceText || sourceText.length < 30) return {};
          const map = {};
          const lines = sourceText.split("\n");
          let currentLetter = null;
          let currentParts = [];
          const flush = () => {
            if (currentLetter && currentParts.length > 0) {
              const body = currentParts.join(" ").replace(/\s+/g, " ").trim();
              if (body.length >= 5) map[currentLetter] = body;
            }
          };
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const m = trimmed.match(/^([A-E])\s*[\)\.\-:]\s*(.*)$/i);
            if (m) {
              flush();
              currentLetter = m[1].toUpperCase();
              currentParts = m[2].trim() ? [m[2].trim()] : [];
            } else if (currentLetter) {
              if (/^(?:\d{1,3}\s*[\)\.\-:]|Aula\s+\d|Quest[a\u00e3]o\s+\d|Pergunta\s+\d)/i.test(trimmed)) {
                flush();
                currentLetter = null;
                currentParts = [];
              } else {
                currentParts.push(trimmed);
              }
            }
          }
          flush();
          if (Object.keys(map).length < 2) {
            const flat = sourceText.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ");
            const parts = flat.split(/\s(?=[A-E]\s*[\)\.\-:])/i);
            for (const part of parts) {
              const m2 = part.match(/^([A-E])\s*[\)\.\-:]\s*(.{4,})/i);
              if (m2) {
                const letter = m2[1].toUpperCase();
                if (!map[letter]) map[letter] = m2[2].trim().slice(0, 300).replace(/\s+/g, " ");
              }
            }
          }
          return map;
        },
        // Fallback remap: for each user option, finds its text in the source, looks back for a
        // letter label. Works regardless of source formatting — no structured option lines needed.
        _remapByReverseTextLookup(sourceLetter, sourceText, userOptionsMap) {
          if (!sourceLetter || !sourceText || !userOptionsMap) return sourceLetter;
          const userEntries = Object.entries(userOptionsMap);
          if (userEntries.length < 2) return sourceLetter;
          const normSource = QuestionParser.normalizeOption(sourceText);
          const sourceLetterForUser = {};
          for (const [userLetter, userBody] of userEntries) {
            if (!userBody || userBody.length < 8) continue;
            const normUser = QuestionParser.normalizeOption(userBody);
            if (!normUser || normUser.length < 8) continue;
            for (const probeLen of [40, 25, 15]) {
              const probe = normUser.slice(0, Math.min(probeLen, normUser.length));
              if (probe.length < 8) break;
              const idx = normSource.indexOf(probe);
              if (idx < 0) continue;
              const ctxBefore = normSource.slice(Math.max(0, idx - 30), idx + 2);
              const lm = ctxBefore.match(/\b([A-E])\s*[\)\.\- ]?\s*$/i);
              if (lm) {
                sourceLetterForUser[userLetter] = lm[1].toUpperCase();
                break;
              }
            }
          }
          console.log(`    [reverseTextLookup] source=${sourceLetter} userToSourceMap=${JSON.stringify(sourceLetterForUser)}`);
          for (const [uLet, sLet] of Object.entries(sourceLetterForUser)) {
            if (sLet === sourceLetter) {
              if (uLet !== sourceLetter) console.log(`    [reverseTextLookup] REMAPPED: ${sourceLetter} \u2192 ${uLet}`);
              else console.log(`    [reverseTextLookup] CONFIRMED: ${sourceLetter}`);
              return uLet;
            }
          }
          console.log(`    [reverseTextLookup] NO REMAP for ${sourceLetter}`);
          return sourceLetter;
        },
        _remapLetterIfShuffled(sourceLetter, sourceText, userOptionsMap) {
          if (!sourceLetter || !userOptionsMap) return sourceLetter;
          if (Object.keys(userOptionsMap).length < 2) return sourceLetter;
          const sourceOptionsMap = sourceText ? this._buildSourceOptionsMapFromText(sourceText) : {};
          console.log(`    [remapIfShuffled] letter=${sourceLetter} sourceTextLen=${(sourceText || "").length} sourceOpts=${Object.keys(sourceOptionsMap).length} keys=[${Object.keys(sourceOptionsMap).join(",")}]`);
          if (Object.keys(sourceOptionsMap).length >= 2) {
            for (const [k, v] of Object.entries(sourceOptionsMap)) {
              console.log(`      src ${k}) "${v.slice(0, 70)}"`);
            }
            return OptionsMatchService.remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap);
          }
          if (sourceText && sourceText.length >= 30) {
            console.log(`    [remapIfShuffled] FALLBACK to reverseTextLookup (sourceTextLen=${sourceText.length})`);
            return this._remapByReverseTextLookup(sourceLetter, sourceText, userOptionsMap);
          }
          console.log(`    [remapIfShuffled] SKIP: no usable source text for remap`);
          return sourceLetter;
        },
        // ═══ CANONICAL QUESTION HASH ═══
        // Creates a stable hash from question + options for cache/dedup
        _canonicalizeQuestion(questionText) {
          const stem = QuestionParser.extractQuestionStem(questionText);
          const options = QuestionParser.extractOptionsFromQuestion(questionText);
          const normStem = QuestionParser.normalizeOption(stem).replace(/\s+/g, " ").trim();
          const normOpts = (options || []).map((o) => QuestionParser.normalizeOption(o).replace(/\s+/g, " ").trim()).sort();
          return `${normStem}||${normOpts.join("|")}`;
        },
        async _canonicalHash(questionText) {
          const canonical = this._canonicalizeQuestion(questionText);
          if (typeof crypto !== "undefined" && crypto.subtle) {
            try {
              const encoder = new TextEncoder();
              const data = encoder.encode(canonical);
              const hashBuffer = await crypto.subtle.digest("SHA-256", data);
              const hashArray = Array.from(new Uint8Array(hashBuffer));
              return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
            } catch {
            }
          }
          let hash = 2166136261;
          for (let i = 0; i < canonical.length; i++) {
            hash ^= canonical.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          return (hash >>> 0).toString(16);
        },
        async clearSearchCache(options = {}) {
          const {
            keepMetrics = true
          } = options || {};
          const payload = {
            [SearchCacheService.SEARCH_CACHE_KEY]: {}
          };
          if (!keepMetrics) payload[SearchCacheService.SEARCH_METRICS_KEY] = {};
          await SearchCacheService.storageSet(payload);
        },
        async _getCachedDecisionForFingerprint(questionFingerprint) {
          if (!questionFingerprint) return null;
          const bucket = await SearchCacheService._getDecisionCacheBucket();
          const entry = bucket?.[questionFingerprint];
          if (!entry || typeof entry !== "object") return null;
          const age = Date.now() - Number(entry.updatedAt || 0);
          if (!Number.isFinite(age) || age < 0 || age > SearchCacheService.CACHE_MAX_AGE_MS) return null;
          const decision = entry.decision;
          if (!decision || decision.resultState !== "confirmed") return null;
          if (decision.evidenceTier !== "EVIDENCE_STRONG") return null;
          return decision;
        },
        async _setCachedDecisionForFingerprint(questionFingerprint, resultItem, sources = []) {
          if (!questionFingerprint || !resultItem) return;
          const bucket = await SearchCacheService._getDecisionCacheBucket();
          const now = Date.now();
          const sourceLinks = (sources || []).map((s) => String(s?.link || "").trim()).filter(Boolean).slice(0, 12);
          bucket[questionFingerprint] = {
            updatedAt: now,
            decision: {
              answer: String(resultItem.answer || ""),
              answerLetter: String(resultItem.answerLetter || ""),
              answerText: String(resultItem.answerText || ""),
              bestLetter: String(resultItem.bestLetter || ""),
              votes: resultItem.votes || {},
              baseVotes: resultItem.baseVotes || {},
              evidenceVotes: resultItem.evidenceVotes || {},
              confidence: Number(resultItem.confidence || 0),
              resultState: String(resultItem.resultState || "inconclusive"),
              reason: String(resultItem.reason || "inconclusive"),
              evidenceTier: String(resultItem.evidenceTier || "EVIDENCE_WEAK"),
              evidenceConsensus: resultItem.evidenceConsensus || {},
              questionPolarity: String(resultItem.questionPolarity || "CORRECT"),
              sources: SearchCacheService.sanitizeSourcesForCache(sources)
            },
            sourceLinks
          };
          const keys = Object.keys(bucket);
          if (keys.length > SearchCacheService.CACHE_MAX_ENTRIES) {
            keys.map((k) => ({
              k,
              t: Number(bucket[k]?.updatedAt || 0)
            })).sort((a, b) => a.t - b.t).slice(0, keys.length - SearchCacheService.CACHE_MAX_ENTRIES).forEach((entry) => {
              delete bucket[entry.k];
            });
          }
          await SearchCacheService._setDecisionCacheBucket(bucket);
        },
        async _mergeCachedSourcesIntoResults(questionFingerprint, results = []) {
          const cachedLinks = await SearchCacheService.getCachedSourceLinks(questionFingerprint);
          if (!cachedLinks || cachedLinks.length === 0) return results || [];
          const merged = /* @__PURE__ */ new Map();
          for (const item of results || []) {
            const link = String(item?.link || "").trim();
            if (!link) continue;
            if (!merged.has(link)) merged.set(link, item);
          }
          for (const link of cachedLinks) {
            if (merged.has(link)) continue;
            merged.set(link, {
              title: "Cached source",
              snippet: "",
              link,
              fromCache: true
            });
          }
          return Array.from(merged.values());
        },
        _buildResultFromCachedDecision(questionText, questionForInference, cachedDecision) {
          const answerLetter = String(cachedDecision?.answerLetter || cachedDecision?.bestLetter || "").toUpperCase();
          const answerText = String(cachedDecision?.answerText || "").trim();
          const answer = String(cachedDecision?.answer || "").trim() || (answerLetter ? `Letra ${answerLetter}: ${answerText}`.trim() : "");
          return [{
            question: questionText,
            answer,
            answerLetter,
            answerText,
            sources: Array.isArray(cachedDecision?.sources) ? cachedDecision.sources : [],
            bestLetter: String(cachedDecision?.bestLetter || answerLetter || ""),
            votes: cachedDecision?.votes || {},
            baseVotes: cachedDecision?.baseVotes || {},
            evidenceVotes: cachedDecision?.evidenceVotes || {},
            evidenceConsensus: cachedDecision?.evidenceConsensus || {},
            confidence: Number(cachedDecision?.confidence || 0.9),
            resultState: String(cachedDecision?.resultState || "confirmed"),
            reason: String(cachedDecision?.reason || "confirmed_by_sources"),
            evidenceTier: String(cachedDecision?.evidenceTier || "EVIDENCE_STRONG"),
            questionPolarity: String(cachedDecision?.questionPolarity || QuestionParser.detectQuestionPolarity(QuestionParser.extractQuestionStem(questionForInference || questionText))),
            title: "Cached verified result",
            aiFallback: false,
            cacheHit: true,
            runStats: {
              analyzed: 0,
              acceptedForVotes: 0,
              acceptedForAiEvidence: 0,
              blockedPaywall: 0,
              blockedObfuscation: 0,
              blockedOptionsMismatch: 0,
              blockedSnapshotMismatch: 0,
              blockedByError: 0
            }
          }];
        },
        async _recordSearchMetrics(payload = {}) {
          const {
            cacheHit = false,
            outcome = "finished",
            resultState = "inconclusive",
            evidenceTier = "EVIDENCE_WEAK",
            runStats = null,
            bestLetter = "",
            confidence = 0
          } = payload;
          try {
            const data = await SearchCacheService.storageGet([SearchCacheService.SEARCH_METRICS_KEY]);
            const metrics = data?.[SearchCacheService.SEARCH_METRICS_KEY] || {
              totalRuns: 0,
              cacheHits: 0,
              outcomes: {},
              resultStates: {},
              evidenceTiers: {},
              blocked: {
                paywall: 0,
                obfuscation: 0,
                optionsMismatch: 0,
                snapshotMismatch: 0,
                errors: 0
              },
              lastRuns: []
            };
            metrics.totalRuns += 1;
            if (cacheHit) metrics.cacheHits += 1;
            metrics.outcomes[outcome] = (metrics.outcomes[outcome] || 0) + 1;
            metrics.resultStates[resultState] = (metrics.resultStates[resultState] || 0) + 1;
            metrics.evidenceTiers[evidenceTier] = (metrics.evidenceTiers[evidenceTier] || 0) + 1;
            if (runStats) {
              metrics.blocked.paywall += Number(runStats.blockedPaywall || 0);
              metrics.blocked.obfuscation += Number(runStats.blockedObfuscation || 0);
              metrics.blocked.optionsMismatch += Number(runStats.blockedOptionsMismatch || 0);
              metrics.blocked.snapshotMismatch += Number(runStats.blockedSnapshotMismatch || 0);
              metrics.blocked.errors += Number(runStats.blockedByError || 0);
            }
            metrics.lastRuns.push({
              at: Date.now(),
              outcome,
              cacheHit: !!cacheHit,
              resultState,
              evidenceTier,
              bestLetter: String(bestLetter || ""),
              confidence: Number(confidence || 0),
              analyzed: Number(runStats?.analyzed || 0),
              acceptedVotes: Number(runStats?.acceptedForVotes || 0),
              acceptedAi: Number(runStats?.acceptedForAiEvidence || 0)
            });
            if (metrics.lastRuns.length > 120) {
              metrics.lastRuns = metrics.lastRuns.slice(metrics.lastRuns.length - 120);
            }
            metrics.updatedAt = Date.now();
            await SearchCacheService.storageSet({
              [SearchCacheService.SEARCH_METRICS_KEY]: metrics
            });
          } catch {
          }
        },
        _getHostHintFromLink(link) {
          try {
            const u = new URL(link);
            const host = u.hostname.replace(/^www\./, "").toLowerCase();
            if (host === "webcache.googleusercontent.com") {
              const q = u.searchParams.get("q") || "";
              const m = q.match(/cache:(.+)$/i);
              if (m) {
                const decoded = decodeURIComponent(m[1]);
                const inner = new URL(decoded);
                return inner.hostname.replace(/^www\./, "").toLowerCase();
              }
            }
            return host;
          } catch {
            return "";
          }
        },
        // ═══ MATCH QUALITY COMPUTATION ═══
        computeMatchQuality(sourceText, questionText, originalOptions, originalOptionsMap) {
          let quality = 0;
          const block = EvidenceService.findQuestionBlock(sourceText, questionText);
          if (block) quality += block.method === "fingerprint" ? 3 : 2;
          if (originalOptions && originalOptions.length >= 2) {
            const sourceOptions = [];
            const optRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/gim;
            let om;
            while ((om = optRe.exec(sourceText)) !== null) {
              sourceOptions.push(`${om[1].toUpperCase()}) ${om[2].trim()}`);
            }
            if (OptionsMatchService.optionsMatch(originalOptions, sourceOptions)) quality += 2;
          }
          const gabarito = EvidenceService.extractExplicitGabarito(sourceText, questionText);
          if (gabarito) quality += 3;
          return Math.min(quality, 10);
        },
        _selectDiverseTopResults(results, options = {}) {
          const limit = Math.max(1, Number(options.limit) || 10);
          const initialWindow = Math.max(limit, Number(options.initialWindow) || 18);
          const maxPerHost = Math.max(1, Number(options.maxPerHost) || 1);
          const pool = (Array.isArray(results) ? results : []).filter((item) => item && String(item.link || "").trim()).slice(0, initialWindow);
          if (pool.length <= 1) {
            return {
              selected: pool.slice(0, limit),
              stats: {
                totalPool: pool.length,
                uniqueHosts: pool.length,
                cappedHosts: 0,
                duplicatesDropped: 0
              }
            };
          }
          const selected = [];
          const seenLinks = /* @__PURE__ */ new Set();
          const hostCounts = /* @__PURE__ */ new Map();
          const pushResult = (item, ignoreHostCap = false) => {
            if (!item) return false;
            const link = String(item.link || "").trim();
            if (!link || seenLinks.has(link)) return false;
            const host = this._getHostHintFromLink(link);
            const hostCount = host ? hostCounts.get(host) || 0 : 0;
            if (!ignoreHostCap && host && hostCount >= maxPerHost) return false;
            selected.push(item);
            seenLinks.add(link);
            if (host) hostCounts.set(host, hostCount + 1);
            return true;
          };
          const seenHosts = /* @__PURE__ */ new Set();
          for (const item of pool) {
            if (selected.length >= limit) break;
            const host = this._getHostHintFromLink(item.link);
            if (!host || seenHosts.has(host)) continue;
            if (pushResult(item, true)) seenHosts.add(host);
          }
          for (const item of pool) {
            if (selected.length >= limit) break;
            pushResult(item, false);
          }
          for (const item of pool) {
            if (selected.length >= limit) break;
            pushResult(item, true);
          }
          const uniqueHosts = new Set(selected.map((item) => this._getHostHintFromLink(item.link)).filter(Boolean)).size;
          const cappedHosts = [...hostCounts.values()].filter((v) => v > 1).length;
          const duplicatesDropped = Math.max(0, Math.min(limit, pool.length) - selected.length);
          return {
            selected: selected.slice(0, limit),
            stats: {
              totalPool: pool.length,
              uniqueHosts,
              cappedHosts,
              duplicatesDropped
            }
          };
        },
        _logSourceDiagnostic(diag) {
          if (!diag) return;
          const host = diag.hostHint || "unknown";
          const type = diag.type || "TYPE_UNKNOWN";
          const phase = diag.phase || "info";
          const sim = Number.isFinite(diag.topicSim) ? diag.topicSim.toFixed(2) : "n/a";
          const opts = diag.optionsMatch === void 0 ? "n/a" : diag.optionsMatch ? "ok" : "mismatch";
          const obf = diag.obfuscation?.isObfuscated ? `yes(vr=${(diag.obfuscation.vowelRatio || 0).toFixed(2)},jr=${(diag.obfuscation.junkRatio || 0).toFixed(2)},cr=${(diag.obfuscation.consonantRunRatio || 0).toFixed(3)},lcr=${diag.obfuscation.longConsonantRuns || 0})` : "no";
          const paywall = diag.paywall?.isPaywalled ? `yes(m=${diag.paywall.markerHits || 0})` : "no";
          const reason = diag.reason ? ` reason=${diag.reason}` : "";
          const decision = diag.decision ? ` decision=${diag.decision}` : "";
          const method = diag.method ? ` method=${diag.method}` : "";
          const letter = diag.letter ? ` letter=${diag.letter}` : "";
          const textLen = Number.isFinite(diag.textLength) ? ` text=${diag.textLength}` : "";
          console.log(`SearchService: SourceDiag[${phase}] host=${host} type=${type} sim=${sim} opts=${opts} obf=${obf} pw=${paywall}${textLen}${decision}${method}${letter}${reason}`);
        },
        async searchOnly(questionText) {
          const results = await ApiService.searchWithSerper(questionText);
          const fingerprint = await this._canonicalHash(questionText || "");
          return this._mergeCachedSourcesIntoResults(fingerprint, results || []);
        },
        async answerFromAi(questionText) {
          const extractedOptions = QuestionParser.extractOptionsFromQuestion(questionText);
          const optionLetters = extractedOptions.map((line) => {
            const m = String(line || "").match(/^([A-E])\)/i);
            return (m?.[1] || "").toUpperCase();
          }).filter(Boolean);
          const hasOptions = extractedOptions.length >= 2;
          const hasReliableOptions = extractedOptions.length >= 3 && optionLetters[0] === "A" && optionLetters[1] === "B" && optionLetters.every((letter, index) => letter.charCodeAt(0) === "A".charCodeAt(0) + index);
          if (hasOptions && !hasReliableOptions) {
            return [{
              question: questionText,
              answer: "INCONCLUSIVO: alternativas malformadas na captura (OCR/DOM).",
              answerLetter: null,
              answerText: "Alternativas malformadas na captura (OCR/DOM).",
              aiFallback: true,
              evidenceTier: "AI_ONLY",
              resultState: "inconclusive",
              reason: "malformed_options",
              confidence: 0.12,
              votes: void 0,
              sources: []
            }];
          }
          const aiAnswer = await ApiService.generateAnswerFromQuestion(questionText);
          if (!aiAnswer) {
            if (hasOptions) {
              return [{
                question: questionText,
                answer: "INCONCLUSIVO: sem evid\xEAncia externa confi\xE1vel para marcar alternativa.",
                answerLetter: null,
                answerText: "Sem evid\xEAncia externa confi\xE1vel para marcar alternativa.",
                aiFallback: true,
                evidenceTier: "AI_ONLY",
                resultState: "inconclusive",
                reason: "inconclusive",
                confidence: 0.15,
                votes: void 0,
                sources: []
              }];
            }
            return [];
          }
          const answerLetter = this._parseAnswerLetter(aiAnswer);
          const answerText = this._parseAnswerText(aiAnswer);
          if (!answerLetter && /INCONCLUSIVO/i.test(aiAnswer)) {
            return [{
              question: questionText,
              answer: aiAnswer,
              answerLetter: null,
              answerText: "Sem evid\xEAncia suficiente para marcar alternativa.",
              aiFallback: true,
              evidenceTier: "AI_ONLY",
              resultState: "inconclusive",
              reason: "inconclusive",
              confidence: 0.15,
              votes: void 0,
              sources: []
            }];
          }
          const optionsMap = this._buildOptionsMap(questionText);
          return [{
            question: questionText,
            answer: aiAnswer,
            answerLetter,
            answerText,
            aiReasoning: aiAnswer,
            optionsMap: Object.keys(optionsMap).length >= 2 ? optionsMap : null,
            aiFallback: true,
            evidenceTier: "AI_ONLY",
            resultState: answerLetter ? "suggested" : "inconclusive",
            reason: answerLetter ? "ai_knowledge" : "inconclusive",
            confidence: answerLetter ? 0.55 : 0.15,
            votes: answerLetter ? {
              [answerLetter]: 1
            } : void 0,
            sources: []
          }];
        },
        // Flow 1: process extracted items (Extract button)
        async processExtractedItems(items) {
          const refinedData = [];
          for (const item of items) {
            const refined = await ApiService.refineWithGroq(item);
            if (refined) refinedData.push(refined);
          }
          return refinedData;
        },
        // Flow 2: Google search + evidence-based refine (Search button)
        async refineFromResults(questionText, results, originalQuestionWithOptions = "", onStatus = null, pageGabarito = null) {
          if (!results || results.length === 0) return [];
          ApiService.resetWebcache429();
          await SearchCacheService.loadAiResultCache();
          const sources = [];
          const {
            selected: topResults,
            stats: topResultsDiversity
          } = this._selectDiverseTopResults(results, {
            limit: 10,
            initialWindow: 18,
            maxPerHost: 1
          });
          console.log(`SearchService: Top results diversified => selected=${topResults.length}, uniqueHosts=${topResultsDiversity.uniqueHosts}/${topResultsDiversity.totalPool}, hostsWithDuplicates=${topResultsDiversity.cappedHosts}`);
          const questionForInference = originalQuestionWithOptions || questionText;
          const questionStem = QuestionParser.extractQuestionStem(questionForInference);
          const questionFingerprint = await this._canonicalHash(questionForInference);
          const originalOptions = QuestionParser.extractOptionsFromQuestion(questionForInference);
          const originalOptionsMap = this._buildOptionsMap(questionForInference);
          const hasOptions = originalOptions && originalOptions.length >= 2;
          const questionPolarity = QuestionParser.detectQuestionPolarity(questionStem);
          console.log(`SearchService: Polarity detected: ${questionPolarity}`);
          console.group("\u{1F50D} SearchService DEBUG \u2014 Pipeline Start");
          console.log("Question stem:", questionStem.slice(0, 120));
          console.log("Options extracted:", originalOptions);
          console.log("Has options:", hasOptions, "| Options count:", originalOptions.length);
          console.log("Options map:", originalOptionsMap);
          console.log("Total results to analyze:", topResults.length);
          console.groupEnd();
          const domainWeights = {
            "qconcursos.com": 2.5,
            "qconcursos.com.br": 2.5,
            "passeidireto.com": 1.4,
            "studocu.com": 1.3,
            "brainly.com.br": 0.9,
            "brainly.com": 0.9,
            "brainly.lat": 0.9
          };
          const riskyCombinedHosts = /* @__PURE__ */ new Set(["passeidireto.com", "brainly.com.br", "brainly.com", "scribd.com", "pt.scribd.com"]);
          const trustedCombinedHosts = /* @__PURE__ */ new Set(["qconcursos.com", "qconcursos.com.br", "google", "studocu.com", "meuguru.com"]);
          const isTrustedCombinedHost = (host) => {
            const h = String(host || "").toLowerCase();
            if (!h) return false;
            return trustedCombinedHosts.has(h) || h.endsWith(".gov.br") || h.endsWith(".edu.br");
          };
          const hasStrongOptionCoverage = (coverage) => {
            if (!hasOptions) return true;
            if (!coverage || !coverage.hasEnoughOptions || !coverage.total) return false;
            return coverage.ratio >= 0.55 || coverage.hits >= Math.min(3, coverage.total || 3);
          };
          const hasMediumOptionCoverage = (coverage) => {
            if (!hasOptions) return true;
            if (!coverage || !coverage.hasEnoughOptions || !coverage.total) return false;
            return coverage.ratio >= 0.34 || coverage.hits >= Math.min(2, coverage.total || 2);
          };
          const hasVeryStrongOptionCoverage = (coverage) => {
            if (!hasOptions) return true;
            if (!coverage || !coverage.hasEnoughOptions || !coverage.total) return false;
            return coverage.ratio >= 0.74 || coverage.hits >= Math.min(4, coverage.total || 4);
          };
          const getDomainWeight = (link) => {
            try {
              const host = this._getHostHintFromLink(link);
              return domainWeights[host] || 1;
            } catch {
              return 1;
            }
          };
          const extractExplicitAnswerTextCandidates = (rawText) => {
            if (!rawText) return [];
            const lines = String(rawText || "").replace(/\r/g, "\n").split("\n").map((l) => String(l || "").replace(/\s+/g, " ").trim()).filter(Boolean);
            const candidates = [];
            const seen = /* @__PURE__ */ new Set();
            const addCandidate = (value) => {
              let cleaned = String(value || "").replace(/\s+/g, " ").trim();
              cleaned = cleaned.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
              cleaned = cleaned.replace(/^([A-E])\s*[\)\.\-:]\s*/i, "").trim();
              if (cleaned.length < 18) return;
              const key = QuestionParser.normalizeOption(cleaned);
              if (!key || key.length < 12 || seen.has(key)) return;
              seen.add(key);
              candidates.push(cleaned);
            };
            const isNoiseLine = (line) => /^(?:\d+\s+pessoas?\b|aluno\b|entrar\b|anuncio\b|bloqueador\b|avaliacao\b|coment[aá]rio\b|novas?\s+perguntas\b|ainda\s+tem\s+perguntas\b|para\s+estudantes\b|para\s+pais\b|codigo\s+de\s+conduta\b|resposta\s*:?\s*$|explica[cç][aã]o\s*:?\s*$)$/i.test(String(line || "").trim());
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (!line) continue;
              const inlineMatch = line.match(/^(?:resposta|resposta\s+correta|alternativa\s+correta)\s*[:\-]\s*(.+)$/i);
              if (inlineMatch?.[1]) addCandidate(inlineMatch[1]);
              const markerOnly = /^(?:resposta|resposta\s+correta|alternativa\s+correta)\s*[:\-]?\s*$/i.test(line);
              if (markerOnly) {
                for (let j = i + 1; j < Math.min(lines.length, i + 9); j++) {
                  const nextLine = lines[j];
                  if (!nextLine || isNoiseLine(nextLine)) continue;
                  if (/^(?:pergunta|quest[aã]o)\b/i.test(nextLine)) break;
                  addCandidate(nextLine);
                  break;
                }
              }
            }
            return candidates.slice(0, 5);
          };
          const tryMapTextAnswerCandidate = (candidateText, hostHint, topicSim) => {
            if (!hasOptions || !candidateText || !originalOptionsMap || Object.keys(originalOptionsMap).length < 2) return null;
            const host = String(hostHint || "").toLowerCase();
            const risky = riskyCombinedHosts.has(host);
            const minTopicSim = risky ? 0.72 : 0.58;
            if ((topicSim || 0) < minTopicSim) return null;
            const mapped = OptionsMatchService.matchAnswerTextToOptions(candidateText, originalOptionsMap);
            if (!mapped?.letter) return null;
            const minConfidence = risky ? 0.86 : 0.72;
            const minMargin = risky ? 0.14 : 0.1;
            if ((mapped.confidence || 0) < minConfidence) return null;
            if ((mapped.margin || 0) < minMargin) return null;
            return mapped;
          };
          const addTextMappedSource = ({
            title,
            link,
            hostHint,
            sourceType,
            topicSim,
            obfuscation,
            mapped,
            evidenceText,
            methodTag
          }) => {
            const baseWeight = getDomainWeight(link);
            const risky = riskyCombinedHosts.has(String(hostHint || "").toLowerCase());
            const weight = baseWeight + (risky ? 0.95 : 1.25) + (mapped.confidence || 0.7) * 0.35;
            const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
            const evidenceBlock = EvidenceService.buildEvidenceBlock({
              questionFingerprint,
              sourceId,
              sourceLink: link,
              hostHint,
              evidenceText: evidenceText || mapped.matchedBody || "",
              originalOptionsMap,
              explicitLetter: mapped.letter,
              confidenceLocal: mapped.confidence || 0.75,
              evidenceType: "textual-answer-map"
            });
            sources.push({
              title,
              link,
              letter: mapped.letter,
              weight,
              evidenceType: "textual-answer-map",
              questionPolarity,
              matchQuality: Math.min(10, Math.round((mapped.score || 0) * 10)),
              hostHint,
              sourceId,
              evidenceBlock
            });
            runStats.acceptedForVotes += 1;
            this._logSourceDiagnostic({
              phase: "decision",
              hostHint,
              type: sourceType,
              topicSim,
              optionsMatch: false,
              obfuscation,
              decision: "use-textual-answer-map",
              method: methodTag || mapped.method || "textual-answer-map",
              letter: mapped.letter
            });
            console.log(`  \u2705 [TEXT-MAP] accepted letter=${mapped.letter} via ${methodTag || mapped.method} conf=${(mapped.confidence || 0).toFixed(2)} margin=${(mapped.margin || 0).toFixed(2)} weight=${weight.toFixed(2)}`);
          };
          const aiEvidence = [];
          const collectedForCombined = [];
          let aiExtractionCount = 0;
          let aiHtmlExtractionCount = 0;
          const aiKnowledgePool = [];
          const _pendingMismatchAI = [];
          const runStats = {
            analyzed: 0,
            acceptedForVotes: 0,
            acceptedForAiEvidence: 0,
            blockedPaywall: 0,
            blockedObfuscation: 0,
            blockedOptionsMismatch: 0,
            blockedSnapshotMismatch: 0,
            blockedByError: 0,
            acceptedViaAiExtraction: 0
          };
          const logRunSummary = (outcome = "finished") => {
            console.log(`SearchService: RunSummary outcome=${outcome} analyzed=${runStats.analyzed} acceptedVotes=${runStats.acceptedForVotes} acceptedAi=${runStats.acceptedForAiEvidence} aiExtraction=${runStats.acceptedViaAiExtraction} knowledgePool=${aiKnowledgePool.length} blockedPaywall=${runStats.blockedPaywall} blockedObf=${runStats.blockedObfuscation} blockedMismatch=${runStats.blockedOptionsMismatch} blockedSnapshotMismatch=${runStats.blockedSnapshotMismatch} blockedErrors=${runStats.blockedByError}`);
          };
          const serperMeta = results._serperMeta || null;
          const searchProvider = results._searchProvider || "serper";
          const googleMetaSignals = {
            provider: searchProvider,
            answerBox: !!serperMeta?.answerBox,
            aiOverview: !!serperMeta?.aiOverview,
            peopleAlsoAsk: Array.isArray(serperMeta?.peopleAlsoAsk) ? serperMeta.peopleAlsoAsk.length > 0 : !!serperMeta?.peopleAlsoAsk
          };
          if (serperMeta && hasOptions) {
            console.group("\u{1F310} Google Meta Signals (answerBox / AI Overview / PAA)");
            console.log("answerBox:", serperMeta.answerBox ? "present" : "absent");
            console.log("aiOverview:", serperMeta.aiOverview ? "present" : "absent");
            console.log("peopleAlsoAsk:", serperMeta.peopleAlsoAsk ? `${serperMeta.peopleAlsoAsk.length} entries` : "absent");
            const googleMeta = this._extractLetterFromGoogleMeta(serperMeta, questionStem, originalOptionsMap, originalOptions);
            if (googleMeta?.letter) {
              const googleWeight = googleMeta.method === "google-ai-overview" ? 3.8 : googleMeta.method === "google-answerbox" ? 3.2 : 1.8;
              const confFactor = Math.max(0.5, Math.min(1, googleMeta.confidence || 0.75));
              const adjustedWeight = googleWeight * confFactor;
              const sourceId = `google-meta:${sources.length + 1}`;
              const evidenceBlock = EvidenceService.buildEvidenceBlock({
                questionFingerprint,
                sourceId,
                sourceLink: "",
                hostHint: "google",
                evidenceText: googleMeta.evidence || "",
                originalOptionsMap,
                explicitLetter: googleMeta.letter,
                confidenceLocal: googleMeta.confidence || 0.75,
                evidenceType: googleMeta.method
              });
              sources.push({
                title: `Google ${googleMeta.method === "google-ai-overview" ? "AI Overview" : googleMeta.method === "google-answerbox" ? "Answer Box" : "PAA"}`,
                link: "",
                letter: googleMeta.letter,
                weight: adjustedWeight,
                evidenceType: googleMeta.method,
                questionPolarity,
                matchQuality: 8,
                hostHint: "google",
                sourceId,
                evidenceBlock
              });
              runStats.acceptedForVotes += 1;
              console.log(`  \u2705 Google meta ACCEPTED: letter=${googleMeta.letter} method=${googleMeta.method} weight=${adjustedWeight.toFixed(2)} confidence=${(googleMeta.confidence || 0).toFixed(2)}`);
            } else {
              console.log("  \u2139\uFE0F No answer letter extracted from Google meta signals");
              const metaTexts = [];
              if (serperMeta.answerBox) {
                const abText = [serperMeta.answerBox.title, serperMeta.answerBox.snippet, serperMeta.answerBox.answer].filter(Boolean).join(" ").trim();
                if (abText.length >= 40) metaTexts.push(abText);
              }
              if (serperMeta.aiOverview) {
                let aioText = "";
                if (typeof serperMeta.aiOverview === "string") aioText = serperMeta.aiOverview;
                else if (serperMeta.aiOverview.text_blocks) aioText = this._flattenAiOverviewBlocks(serperMeta.aiOverview.text_blocks);
                else if (serperMeta.aiOverview.snippet) aioText = serperMeta.aiOverview.snippet;
                if (aioText.length >= 40) metaTexts.push(aioText);
              }
              if (metaTexts.length > 0) {
                const combinedMeta = metaTexts.join("\n\n").slice(0, 3e3);
                const topicSim = QuestionParser.questionSimilarityScore(combinedMeta, questionStem);
                if (topicSim >= 0.25) {
                  collectedForCombined.push({
                    title: "Google AI Overview / Answer Box",
                    link: "",
                    text: combinedMeta,
                    topicSim,
                    optionsMatch: true,
                    optionsCoverage: {
                      hits: 0,
                      total: 0,
                      ratio: 0,
                      hasEnoughOptions: false
                    },
                    hostHint: "google",
                    obfuscated: false,
                    paywalled: false
                  });
                  console.log(`  \u{1F4DD} Google meta text collected for AI combined (topicSim=${topicSim.toFixed(2)}, len=${combinedMeta.length})`);
                }
              }
            }
            console.groupEnd();
          }
          const _cacheNow = Date.now();
          for (const [_cUrl, _cEntry] of SearchCacheService.snapshotCache) {
            if (_cacheNow - _cEntry.fetchedAt > SearchCacheService.SNAPSHOT_CACHE_TTL) {
              SearchCacheService.snapshotCache.delete(_cUrl);
            }
          }
          const _prefetchedSnaps = /* @__PURE__ */ new Map();
          let _cacheHits = 0;
          for (const r of topResults) {
            const cached = SearchCacheService.snapshotCache.get(r.link);
            if (cached) {
              _prefetchedSnaps.set(r.link, cached.snap);
              _cacheHits++;
              try {
                console.log(`  \u{1F4E6} [cache-hit] ${new URL(r.link).hostname} (age=${Math.round((_cacheNow - cached.fetchedAt) / 1e3)}s)`);
              } catch (_) {
              }
            }
          }
          const _BATCH_SIZE = 5;
          const _storeFetchInCache = () => {
            for (const [_sUrl, _sSnap] of _prefetchedSnaps) {
              if (_sSnap?.ok && !SearchCacheService.snapshotCache.has(_sUrl)) {
                if (SearchCacheService.snapshotCache.size >= SearchCacheService.SNAPSHOT_CACHE_MAX) {
                  const oldest = [...SearchCacheService.snapshotCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
                  if (oldest) SearchCacheService.snapshotCache.delete(oldest[0]);
                }
                SearchCacheService.snapshotCache.set(_sUrl, {
                  snap: _sSnap,
                  fetchedAt: _cacheNow
                });
              }
            }
          };
          const _fetchBatch = async (batch) => {
            const toFetch = batch.filter((r) => !_prefetchedSnaps.has(r.link));
            if (toFetch.length === 0) return;
            let idx = 0;
            const workers = Array.from({
              length: Math.min(5, toFetch.length)
            }, async () => {
              while (idx < toFetch.length) {
                const r = toFetch[idx++];
                try {
                  const snap = await ApiService.fetchPageSnapshot(r.link, {
                    timeoutMs: 4500,
                    maxHtmlChars: 15e5,
                    maxTextChars: 12e3
                  });
                  _prefetchedSnaps.set(r.link, snap);
                } catch (e) {
                  _prefetchedSnaps.set(r.link, null);
                }
              }
            });
            await Promise.all(workers);
          };
          const batch1 = topResults.slice(0, _BATCH_SIZE);
          const batch2 = topResults.slice(_BATCH_SIZE);
          if (typeof onStatus === "function") {
            const cached = batch1.filter((r) => _prefetchedSnaps.has(r.link)).length;
            const fetching = batch1.length - cached;
            onStatus(fetching > 0 ? `Fetching batch 1/${batch2.length > 0 ? "2" : "1"} (${fetching} sources${cached > 0 ? `, ${cached} cached` : ""})...` : `Analyzing ${batch1.length} cached sources...`);
          }
          await _fetchBatch(batch1);
          _storeFetchInCache();
          console.log(`SearchService: Batch 1 fetch complete \u2014 ${_prefetchedSnaps.size} pages ready (${_cacheHits} from cache)`);
          let _batch2Fetched = batch2.length === 0;
          for (const result of topResults) {
            if (!_batch2Fetched && runStats.analyzed >= _BATCH_SIZE) {
              const {
                bestLetter: bestLetter2,
                votes: votes2
              } = EvidenceService.computeVotesAndState(sources);
              const topVote = bestLetter2 ? votes2[bestLetter2] || 0 : 0;
              if (bestLetter2 && topVote >= 5.5) {
                console.log(`SearchService: \u26A1 Batch 1 sufficient \u2014 skipping batch 2 (votes[${bestLetter2}]=${topVote.toFixed(1)})`);
                _batch2Fetched = true;
                break;
              }
              console.log(`SearchService: Batch 1 insufficient (topVote=${topVote.toFixed(1)}) \u2014 fetching batch 2 (${batch2.length} sources)...`);
              if (typeof onStatus === "function") {
                onStatus(`Fetching batch 2 (${batch2.length} more sources)...`);
              }
              await _fetchBatch(batch2);
              _storeFetchInCache();
              console.log(`SearchService: Batch 2 fetch complete \u2014 ${_prefetchedSnaps.size} total pages ready`);
              _batch2Fetched = true;
            }
            try {
              const snippet = result.snippet || "";
              const title = result.title || "";
              const link = result.link;
              runStats.analyzed += 1;
              if (typeof onStatus === "function") {
                onStatus(`Analyzing source ${runStats.analyzed}/${topResults.length}...`);
              }
              const snap = _prefetchedSnaps.get(link) || null;
              const pageText = (snap?.text || "").trim();
              const combinedText = `${title}. ${snippet}

${pageText}`.trim();
              const scopedCombinedText = EvidenceService.buildQuestionScopedText(combinedText, questionForInference, 3600);
              console.log(`  \u{1F4D0} scopedCombinedText length=${scopedCombinedText.length} (full combined=${combinedText.length}) preview="${scopedCombinedText.slice(0, 200)}"`);
              const seedText = `${title}. ${snippet}`.trim();
              const snapshotWeak = !snap?.ok || pageText.length < 120;
              if (snapshotWeak && hasOptions) {
                const seedCoverage = OptionsMatchService.optionsCoverageInFreeText(originalOptions, seedText);
                const seedTopicSim = QuestionParser.questionSimilarityScore(seedText, questionStem);
                const highTopicSim = seedTopicSim >= 0.85;
                const minHitsForStrong = highTopicSim ? Math.min(2, seedCoverage.total || 2) : Math.min(4, seedCoverage.total || 4);
                const minRatioForStrong = highTopicSim ? 0.35 : 0.8;
                const seedStrongMatch = (seedCoverage.ratio >= minRatioForStrong || seedCoverage.hits >= minHitsForStrong) && seedTopicSim >= 0.55;
                if (!seedStrongMatch) {
                  console.log(`\u26D4 Source #${runStats.analyzed} (${this._getHostHintFromLink(link)}): snapshot-empty-options-mismatch (seedCoverage: ${seedCoverage.hits}/${seedCoverage.total})`);
                  runStats.blockedSnapshotMismatch += 1;
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint: this._getHostHintFromLink(link),
                    type: "TYPE_SNAPSHOT_WEAK",
                    topicSim: seedTopicSim,
                    optionsMatch: false,
                    obfuscation: null,
                    decision: "skip",
                    reason: "snapshot-empty-options-mismatch"
                  });
                  continue;
                }
              }
              const hostHint = this._getHostHintFromLink(link);
              const htmlText = snap?.html || "";
              const parsedForDiag = HtmlExtractorService.parseHtmlDom(htmlText);
              const sourceType = HtmlExtractorService.detectHtmlType(htmlText, parsedForDiag.doc);
              const docText = HtmlExtractorService.extractDocText(parsedForDiag.doc);
              const obfuscation = HtmlExtractorService.obfuscationSignals(docText);
              let paywall = HtmlExtractorService.paywallSignals(htmlText, docText, hostHint);
              const topicSimBase = QuestionParser.questionSimilarityScore(combinedText, questionStem);
              console.group(`\u{1F4C4} Source #${runStats.analyzed}: ${hostHint}`);
              console.log("Link:", link);
              console.log("Fetch OK:", snap?.ok, "| HTML length:", htmlText.length, "| Text length:", pageText.length);
              console.log("Source type:", sourceType);
              console.log("Topic similarity:", topicSimBase.toFixed(3));
              console.log("Paywall:", JSON.stringify(paywall));
              console.log("Obfuscation:", JSON.stringify(obfuscation));
              let optionsCoverageBase = hasOptions ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, scopedCombinedText) : {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: false
              };
              let optionsMatchBase = hasOptions ? OptionsMatchService.optionsMatchInFreeText(originalOptions, scopedCombinedText) : true;
              if (hasOptions && !optionsMatchBase && combinedText.length > scopedCombinedText.length + 200) {
                const fullCoverage = OptionsMatchService.optionsCoverageInFreeText(originalOptions, combinedText);
                const fullMatch = fullCoverage.ratio >= 0.6 || fullCoverage.hits >= Math.min(3, fullCoverage.total || 3);
                if (fullMatch) {
                  optionsCoverageBase = fullCoverage;
                  optionsMatchBase = true;
                  console.log(`SearchService: Options matched via full-text fallback for ${hostHint} (hits=${fullCoverage.hits}/${fullCoverage.total})`);
                } else {
                  console.log(`  \u274C Full-text options fallback also failed: hits=${fullCoverage.hits}/${fullCoverage.total} ratio=${fullCoverage.ratio.toFixed(2)}`);
                }
              }
              console.log("Options match:", optionsMatchBase, "| Coverage:", JSON.stringify(optionsCoverageBase));
              this._logSourceDiagnostic({
                phase: "start",
                hostHint,
                type: sourceType,
                topicSim: topicSimBase,
                optionsMatch: optionsMatchBase,
                obfuscation,
                paywall,
                textLength: combinedText.length
              });
              if (paywall?.isPaywalled) {
                const readableTextLen = (docText || "").length;
                console.log(`  \u{1F512} Paywall detected: readableTextLen=${readableTextLen}`);
                if (readableTextLen < 400) {
                  console.log(`  \u26D4 BLOCKED: paywall-overlay (text too short: ${readableTextLen} < 400)`);
                  console.groupEnd();
                  runStats.blockedPaywall += 1;
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    paywall,
                    decision: "skip",
                    reason: "paywall-overlay"
                  });
                  continue;
                }
                paywall = {
                  ...paywall,
                  isPaywalled: false,
                  softPassed: true
                };
                console.log(`  \u2705 Paywall SOFT-PASSED: text readable (${readableTextLen} chars) \u2014 flag cleared`);
              }
              if (obfuscation?.isObfuscated) {
                console.log(`  \u26D4 BLOCKED: obfuscated HTML`);
                if (topicSimBase >= 0.3 && !paywall?.isPaywalled) {
                  const clipped2 = scopedCombinedText.slice(0, 3e3);
                  if (clipped2.length >= 200) {
                    collectedForCombined.push({
                      title,
                      link,
                      text: clipped2,
                      topicSim: topicSimBase,
                      optionsMatch: optionsMatchBase,
                      optionsCoverage: optionsCoverageBase,
                      hostHint,
                      obfuscated: true,
                      paywalled: false
                    });
                  }
                }
                runStats.blockedObfuscation += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  paywall,
                  decision: "skip",
                  reason: "obfuscated_html"
                });
                console.groupEnd();
                continue;
              }
              const allowStructuredMismatchBypass = hasOptions && !optionsMatchBase && !obfuscation?.isObfuscated && topicSimBase >= 0.26 && (hostHint === "passeidireto.com" || hostHint === "studocu.com");
              if (allowStructuredMismatchBypass) {
                console.log(`  [BYPASS] options mismatch softened for structured extractors (host=${hostHint}, topicSim=${topicSimBase.toFixed(3)})`);
              }
              if (hasOptions && !optionsMatchBase && !allowStructuredMismatchBypass) {
                console.log(`  \u26D4 BLOCKED: options-mismatch-hard-block (topicSim=${topicSimBase.toFixed(3)})`);
                if (topicSimBase >= 0.25 && !obfuscation?.isObfuscated) {
                  const clipped2 = scopedCombinedText.slice(0, 3e3);
                  if (clipped2.length >= 200) {
                    collectedForCombined.push({
                      title,
                      link,
                      text: clipped2,
                      topicSim: topicSimBase,
                      optionsMatch: false,
                      optionsCoverage: optionsCoverageBase,
                      hostHint,
                      obfuscated: false,
                      paywalled: !!paywall?.isPaywalled
                    });
                  }
                }
                const plainAnswerCandidates = extractExplicitAnswerTextCandidates(scopedCombinedText);
                if (plainAnswerCandidates.length > 0) {
                  console.log(`  \u{1F9E9} [TEXT-MAP] explicit answer candidates found=${plainAnswerCandidates.length} host=${hostHint}`);
                  let mappedFromPlain = null;
                  let mappedCandidateText = "";
                  for (const candidate of plainAnswerCandidates) {
                    const mapped = tryMapTextAnswerCandidate(candidate, hostHint, topicSimBase);
                    if (!mapped) continue;
                    mappedFromPlain = mapped;
                    mappedCandidateText = candidate;
                    break;
                  }
                  if (mappedFromPlain) {
                    addTextMappedSource.call(this, {
                      title,
                      link,
                      hostHint,
                      sourceType,
                      topicSim: topicSimBase,
                      obfuscation,
                      mapped: mappedFromPlain,
                      evidenceText: mappedCandidateText,
                      methodTag: "textual-answer-plain"
                    });
                    console.groupEnd();
                    continue;
                  }
                }
                const isFreeTextHost = hostHint === "brainly.com.br" || hostHint === "brainly.com" || hostHint === "brainly.lat";
                if (isFreeTextHost && hasOptions && topicSimBase >= 0.28 && !obfuscation?.isObfuscated) {
                  console.log(`  \u{1F5D2}\uFE0F [FREETEXT] Attempting FreeTextAnswerService for ${hostHint} (topicSim=${topicSimBase.toFixed(3)})`);
                  try {
                    const ftResult = await FreeTextAnswerService.extractAnswerFromFreeText(pageText, originalOptionsMap, questionStem);
                    if (ftResult?.letter) {
                      console.log(`  \u{1F5D2}\uFE0F [FREETEXT] Found letter=${ftResult.letter} method=${ftResult.method} confidence=${ftResult.confidence.toFixed(3)}`);
                      const domainWeight = getDomainWeight(link);
                      const ftWeight = Math.min(1, (ftResult.confidence || 0.7) * domainWeight * 0.95);
                      sources.push({
                        title,
                        link,
                        letter: ftResult.letter,
                        weight: ftWeight,
                        evidenceType: ftResult.method,
                        hostHint,
                        sourceId: `${hostHint}:freetext`,
                        evidenceBlock: ftResult.snippet || "",
                        matchQuality: topicSimBase,
                        questionPolarity
                      });
                      runStats.acceptedViaFreeText = (runStats.acceptedViaFreeText || 0) + 1;
                      this._logSourceDiagnostic({
                        phase: "decision",
                        hostHint,
                        type: sourceType,
                        topicSim: topicSimBase,
                        optionsMatch: false,
                        obfuscation,
                        decision: "accept",
                        reason: ftResult.method
                      });
                      console.groupEnd();
                      continue;
                    }
                  } catch (ftErr) {
                    console.warn(`  \u{1F5D2}\uFE0F [FREETEXT] FreeTextAnswerService failed:`, ftErr?.message || ftErr);
                  }
                }
                if (aiExtractionCount < 5 && topicSimBase >= 0.5 && !obfuscation?.isObfuscated && scopedCombinedText.length >= 300) {
                  _pendingMismatchAI.push({
                    aiScopedText: EvidenceService.buildQuestionScopedText(combinedText, questionForInference, 8e3),
                    hostHint,
                    sourceType,
                    title,
                    link,
                    topicSim: topicSimBase,
                    obfuscation
                  });
                  console.log(`  \u{1F916} [AI-MISMATCH] Deferred to post-loop (topicSim=${topicSimBase.toFixed(3)}, host=${hostHint}) \u2014 queue size=${_pendingMismatchAI.length}`);
                }
                runStats.blockedOptionsMismatch += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: false,
                  obfuscation,
                  paywall,
                  decision: "skip",
                  reason: "options-mismatch-hard-block"
                });
                console.groupEnd();
                continue;
              }
              console.log("  \u2705 Passed all filters \u2014 entering extraction chain");
              const structured = HtmlExtractorService.extractStructuredEvidence(htmlText, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, {
                findQuestionBlock: (text, stem) => EvidenceService.findQuestionBlock(text, stem),
                extractExplicitGabarito: (text, q) => EvidenceService.extractExplicitGabarito(text, q),
                extractExplicitLetterFromText: (text, stem, opts) => EvidenceService.extractExplicitLetterFromText(text, stem, opts)
              }, {
                parsed: parsedForDiag,
                type: sourceType,
                obfuscation,
                paywall
              });
              console.log(`  \u{1F3D7}\uFE0F Structured extractor: skip=${!!structured?.skip} reason=${structured?.reason || "none"} letter=${structured?.letter || "none"} method=${structured?.method || "none"}`);
              if (structured?.skip) {
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "structured-skip-fallback",
                  reason: structured.reason || "structured-skip"
                });
                if (structured.reason === "obfuscated_html" || structured.reason === "paywall-overlay") {
                  console.log(`  \u26D4 Structured hard-skip: ${structured.reason}`);
                  console.groupEnd();
                  continue;
                }
                console.log(`  \u26A0\uFE0F Structured skip (soft): ${structured.reason} \u2014 continuing to fallbacks`);
              }
              if (structured?.letter) {
                console.log(`  \u{1F3AF} Structured found letter: ${structured.letter} method=${structured.method} confidence=${structured.confidence} matchQuality=${structured.matchQuality}`);
                const riskyHost = hostHint === "passeidireto.com" || hostHint === "brainly.com.br" || hostHint === "brainly.com";
                const structuredMethod = structured.method || "structured-html";
                const structuredSim = structured.matchQuality || 0;
                const evidenceScope = `${structured.evidence || ""}
${scopedCombinedText.slice(0, 1800)}`;
                const structuredCoverage = hasOptions ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, evidenceScope) : {
                  hits: 0,
                  total: 0,
                  ratio: 0,
                  hasEnoughOptions: false
                };
                const structuredOptionsMatch = !structuredCoverage.hasEnoughOptions || structuredCoverage.ratio >= 0.6 || structuredCoverage.hits >= Math.min(3, structuredCoverage.total || 3);
                const structuredOptionsStrong = !structuredCoverage.hasEnoughOptions || structuredCoverage.ratio >= 0.8 || structuredCoverage.hits >= Math.min(4, structuredCoverage.total || 4);
                const isGenericAnchor = structuredMethod === "generic-anchor";
                console.log(`  \u{1F4CA} Structured coverage: match=${structuredOptionsMatch} strong=${structuredOptionsStrong} hits=${structuredCoverage.hits}/${structuredCoverage.total} ratio=${structuredCoverage.ratio?.toFixed(2)} isGenericAnchor=${isGenericAnchor} riskyHost=${riskyHost} sim=${structuredSim.toFixed(2)}`);
                const isZeroCoverageOnRiskyHost = riskyHost && structuredCoverage.hasEnoughOptions && structuredCoverage.hits === 0 && structuredSim < 0.45;
                if (isZeroCoverageOnRiskyHost && !isGenericAnchor) {
                  console.log(`  \u26A0\uFE0F Structured ${structuredMethod} demoted: risky host with 0 option hits and low sim=${structuredSim.toFixed(2)}`);
                  if (topicSimBase >= 0.2) {
                    collectedForCombined.push({
                      title,
                      link,
                      text: scopedCombinedText.slice(0, 3e3),
                      topicSim: topicSimBase,
                      optionsMatch: structuredOptionsMatch,
                      optionsCoverage: structuredCoverage,
                      hostHint,
                      obfuscated: !!obfuscation?.isObfuscated,
                      paywalled: !!paywall?.isPaywalled
                    });
                  }
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: structuredOptionsMatch,
                    obfuscation,
                    decision: "combined-only",
                    method: structuredMethod,
                    reason: "structured-zero-coverage-risky-host"
                  });
                  console.groupEnd();
                  continue;
                }
                if (isGenericAnchor && riskyHost && !structuredOptionsStrong && structuredSim < 0.62) {
                  if (topicSimBase >= 0.2) {
                    collectedForCombined.push({
                      title,
                      link,
                      text: scopedCombinedText.slice(0, 3e3),
                      topicSim: topicSimBase,
                      optionsMatch: structuredOptionsMatch,
                      optionsCoverage: structuredCoverage,
                      hostHint,
                      obfuscated: !!obfuscation?.isObfuscated,
                      paywalled: !!paywall?.isPaywalled
                    });
                  }
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: structuredOptionsMatch,
                    obfuscation,
                    decision: "combined-only",
                    method: structuredMethod,
                    reason: "generic-anchor-options-mismatch"
                  });
                  console.log(`  \u26A0\uFE0F Generic anchor demoted to combined-only (risky=${riskyHost} strongOpts=${structuredOptionsStrong} sim=${structuredSim.toFixed(2)})`);
                  console.groupEnd();
                  continue;
                }
                console.log(`  \u{1F500} Structured pre-remap letter: ${structured.letter} \u2014 attempting remap via combinedText (len=${combinedText.length})...`);
                structured.letter = this._remapLetterIfShuffled(structured.letter, combinedText, originalOptionsMap);
                console.log(`  \u{1F500} Structured post-remap letter: ${structured.letter}`);
                const baseWeight = getDomainWeight(link);
                const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                const structuredBoost = (structured.confidence || 0.82) >= 0.9 ? 4.4 : 3.7;
                const weight = baseWeight + structuredBoost + quality * 0.35;
                const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                const evidenceBlock = EvidenceService.buildEvidenceBlock({
                  questionFingerprint,
                  sourceId,
                  sourceLink: link,
                  hostHint,
                  evidenceText: structured.evidence || scopedCombinedText,
                  originalOptionsMap,
                  explicitLetter: structured.letter,
                  confidenceLocal: structured.confidence || 0.82,
                  evidenceType: structured.evidenceType || "structured-html"
                });
                sources.push({
                  title,
                  link,
                  letter: structured.letter,
                  weight,
                  evidenceType: structured.evidenceType || "structured-html",
                  questionPolarity,
                  matchQuality: Math.max(quality, Math.round((structured.matchQuality || 0) * 10)),
                  extractionMethod: structuredMethod,
                  evidence: structured.evidence || "",
                  hostHint,
                  sourceId,
                  evidenceBlock
                });
                runStats.acceptedForVotes += 1;
                console.log(`  \u2705 ACCEPTED via structured: letter=${structured.letter} weight=${weight.toFixed(2)} method=${structuredMethod}`);
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "use-structured",
                  method: structuredMethod,
                  letter: structured.letter
                });
                const {
                  bestLetter: bestLetter2,
                  votes: votes2
                } = EvidenceService.computeVotesAndState(sources);
                if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                  console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                  console.groupEnd();
                  break;
                }
                console.groupEnd();
                continue;
              }
              let extracted = null;
              if (hostHint === "passeidireto.com" || hostHint === "studocu.com") {
                const blockedByIntegrity = !!obfuscation?.isObfuscated || !!paywall?.isPaywalled || hasOptions && !optionsMatchBase && !allowStructuredMismatchBypass;
                console.log(`  \u{1F4C4} PDF-highlight check: blockedByIntegrity=${blockedByIntegrity} (obf=${!!obfuscation?.isObfuscated} pw=${!!paywall?.isPaywalled} optMismatch=${hasOptions && !optionsMatchBase})`);
                if (blockedByIntegrity) {
                  console.log(`  \u26D4 PDF-highlight blocked: integrity check failed`);
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    paywall,
                    decision: "skip",
                    reason: "pdf-signal-blocked-low-integrity"
                  });
                  console.groupEnd();
                  continue;
                }
                extracted = HtmlExtractorService.extractPdfHighlightLetter(snap?.html || "", questionStem, originalOptionsMap, originalOptions);
                console.log(`  \u{1F4C4} PDF-highlight result: letter=${extracted?.letter || "none"} method=${extracted?.method || "none"} confidence=${extracted?.confidence || 0} evidence="${extracted?.evidence || "none"}"`);
                if (!extracted?.letter && snap?.html && snap.html.length > 5e3 && aiHtmlExtractionCount < 2) {
                  const reconstructedQ = questionStem + "\n" + (originalOptions || []).join("\n");
                  const optTokensForHtml = QuestionParser.extractOptionTokens(reconstructedQ);
                  const htmlSnippet = EvidenceService.extractHtmlAroundQuestion(snap.html, questionStem, optTokensForHtml, 12e3);
                  if (htmlSnippet && htmlSnippet.length > 500) {
                    console.log(`  \u{1F916} [AI-HTML] Attempting AI HTML extraction (host=${hostHint}, snippetLen=${htmlSnippet.length})`);
                    if (typeof onStatus === "function") {
                      onStatus(`AI analyzing HTML from ${hostHint}...`);
                    }
                    const _aiHtmlCacheKey = link + "|html";
                    const _aiHtmlCached = SearchCacheService.getCachedAiResult(_aiHtmlCacheKey, questionForInference);
                    let aiHtmlResult;
                    if (_aiHtmlCached) {
                      console.log(`  \u{1F916} [AI-HTML] \u{1F4E6} Cache hit for ${hostHint} \u2014 skipping LLM call`);
                      aiHtmlResult = _aiHtmlCached;
                    } else {
                      aiHtmlResult = await ApiService.aiExtractFromHtml(htmlSnippet, questionForInference, hostHint);
                      if (aiHtmlResult) SearchCacheService.setCachedAiResult(_aiHtmlCacheKey, questionForInference, aiHtmlResult);
                    }
                    aiHtmlExtractionCount++;
                    if (aiHtmlResult?.letter) {
                      console.log(`  \u{1F916} [AI-HTML] Found letter=${aiHtmlResult.letter} via ${aiHtmlResult.method}`);
                      extracted = {
                        letter: aiHtmlResult.letter,
                        confidence: aiHtmlResult.confidence || 0.85,
                        method: aiHtmlResult.method || "ai-html-extraction",
                        evidence: aiHtmlResult.evidence || ""
                      };
                    } else {
                      console.log(`  \u{1F916} [AI-HTML] No letter found`);
                      if (aiHtmlResult?.knowledge) {
                        aiKnowledgePool.push({
                          host: hostHint,
                          knowledge: aiHtmlResult.knowledge,
                          topicSim: topicSimBase,
                          link,
                          title
                        });
                      }
                    }
                  }
                }
                if (extracted?.letter) {
                  console.log(`  \u{1F4C4} PDF-highlight raw letter: ${extracted.letter} \u2014 attempting remap via combinedText (len=${combinedText.length})...`);
                  extracted.letter = this._remapLetterIfShuffled(extracted.letter, combinedText, originalOptionsMap);
                  console.log(`SearchService: PDF signal detected. host=${hostHint} letter=${extracted.letter} method=${extracted.method || "ff1-highlight"}`);
                  const baseWeight = getDomainWeight(link);
                  const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                  const method = extracted.method || "ff1-highlight";
                  const heuristicSignal = method === "ff1-highlight" || method === "css-signature";
                  const signalBoost = heuristicSignal ? 1.8 : 3.2;
                  const confFactor = Math.max(0.35, Math.min(1, Number(extracted.confidence) || 0.82));
                  const adjustedSignalBoost = signalBoost * confFactor;
                  console.log(`  \u{1F4C4} PDF weight factors: base=${baseWeight.toFixed(2)} signal=${signalBoost.toFixed(2)} conf=${confFactor.toFixed(2)} adjustedSignal=${adjustedSignalBoost.toFixed(2)} quality=${quality}`);
                  const weight = baseWeight + adjustedSignalBoost + quality * 0.25;
                  const hostPrefix = hostHint === "passeidireto.com" ? "passeidireto" : "studocu";
                  const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                  const evidenceBlock = EvidenceService.buildEvidenceBlock({
                    questionFingerprint,
                    sourceId,
                    sourceLink: link,
                    hostHint,
                    evidenceText: extracted.evidence || scopedCombinedText,
                    originalOptionsMap,
                    explicitLetter: extracted.letter,
                    confidenceLocal: extracted.confidence || 0.82,
                    evidenceType: `${hostPrefix}-${method}-scoped`
                  });
                  sources.push({
                    title,
                    link,
                    letter: extracted.letter,
                    weight,
                    evidenceType: `${hostPrefix}-${method}-scoped`,
                    questionPolarity,
                    matchQuality: quality,
                    hostHint,
                    sourceId,
                    evidenceBlock
                  });
                  runStats.acceptedForVotes += 1;
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    decision: "use-pdf-signal",
                    method,
                    letter: extracted.letter
                  });
                  const {
                    bestLetter: bestLetter2,
                    votes: votes2
                  } = EvidenceService.computeVotesAndState(sources);
                  if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                    console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                    console.groupEnd();
                    break;
                  }
                  console.groupEnd();
                  continue;
                }
              }
              if (hasOptions && !optionsMatchBase) {
                console.log(`  [BLOCKED] options-mismatch-post-structured (topicSim=${topicSimBase.toFixed(3)})`);
                runStats.blockedOptionsMismatch += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: false,
                  obfuscation,
                  paywall,
                  decision: "skip",
                  reason: "options-mismatch-post-structured"
                });
                console.groupEnd();
                continue;
              }
              const localResult = EvidenceService.extractAnswerLocally(combinedText, questionForInference, originalOptions);
              console.log(`  \u{1F4DD} Local extraction: letter=${localResult?.letter || "none"} type=${localResult?.evidenceType || "none"} confidence=${localResult?.confidence || 0}`);
              if (localResult?.letter && topicSimBase < 0.5) {
                console.log(`  \u26D4 Gabarito REJECTED: topicSim=${topicSimBase.toFixed(3)} < 0.50 \u2014 likely wrong question in compilado`);
                localResult.letter = null;
              }
              if (localResult?.letter) {
                console.log(`  \u{1F500} Local pre-remap letter: ${localResult.letter}`);
                localResult.letter = this._remapLetterIfShuffled(localResult.letter, combinedText, originalOptionsMap);
                console.log(`  \u{1F500} Local post-remap letter: ${localResult.letter}`);
                const baseWeight = getDomainWeight(link);
                const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                let weight = baseWeight + 2.6 + quality * 0.4;
                if (topicSimBase < 0.7) {
                  weight *= topicSimBase;
                  console.log(`  \u26A0\uFE0F Gabarito weight reduced: topicSim=${topicSimBase.toFixed(3)} \u2192 weight=${weight.toFixed(2)}`);
                }
                const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                const evidenceBlock = EvidenceService.buildEvidenceBlock({
                  questionFingerprint,
                  sourceId,
                  sourceLink: link,
                  hostHint,
                  evidenceText: localResult.evidence || scopedCombinedText,
                  originalOptionsMap,
                  explicitLetter: localResult.letter,
                  confidenceLocal: localResult.confidence || 0.84,
                  evidenceType: localResult.evidenceType || "explicit-gabarito"
                });
                sources.push({
                  title,
                  link,
                  letter: localResult.letter,
                  weight,
                  evidenceType: localResult.evidenceType || "explicit-gabarito",
                  questionPolarity,
                  matchQuality: quality,
                  blockMethod: localResult.blockMethod,
                  hostHint,
                  sourceId,
                  evidenceBlock
                });
                runStats.acceptedForVotes += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "use-local",
                  method: localResult.evidenceType || "explicit-gabarito",
                  letter: localResult.letter
                });
                const {
                  bestLetter: bestLetter2,
                  votes: votes2
                } = EvidenceService.computeVotesAndState(sources);
                if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                  console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                  console.groupEnd();
                  break;
                }
                console.groupEnd();
                continue;
              }
              extracted = EvidenceService.extractExplicitLetterFromText(combinedText, questionStem, originalOptions);
              console.log(`  \u{1F524} Explicit letter: letter=${extracted?.letter || "none"} confidence=${extracted?.confidence || 0}`);
              if (extracted?.letter) {
                console.log(`  \u{1F500} Explicit pre-remap letter: ${extracted.letter}`);
                extracted.letter = this._remapLetterIfShuffled(extracted.letter, combinedText, originalOptionsMap);
                console.log(`  \u{1F500} Explicit post-remap letter: ${extracted.letter}`);
                const baseWeight = getDomainWeight(link);
                const weight = baseWeight + 2;
                const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                const evidenceBlock = EvidenceService.buildEvidenceBlock({
                  questionFingerprint,
                  sourceId,
                  sourceLink: link,
                  hostHint,
                  evidenceText: extracted.evidence || scopedCombinedText,
                  originalOptionsMap,
                  explicitLetter: extracted.letter,
                  confidenceLocal: extracted.confidence || 0.8,
                  evidenceType: "explicit-gabarito-simple"
                });
                sources.push({
                  title,
                  link,
                  letter: extracted.letter,
                  weight,
                  evidenceType: "explicit-gabarito-simple",
                  questionPolarity,
                  hostHint,
                  sourceId,
                  evidenceBlock
                });
                runStats.acceptedForVotes += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "use-explicit-simple",
                  method: "explicit-gabarito-simple",
                  letter: extracted.letter
                });
                const {
                  bestLetter: bestLetter2,
                  votes: votes2
                } = EvidenceService.computeVotesAndState(sources);
                if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                  console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                  console.groupEnd();
                  break;
                }
                console.groupEnd();
                continue;
              }
              if (aiExtractionCount < 3 && topicSimBase >= 0.35 && !obfuscation?.isObfuscated && scopedCombinedText.length >= 250) {
                const aiScopedText = EvidenceService.buildQuestionScopedText(combinedText, questionForInference, 6e3);
                console.log(`  \u{1F916} [AI-EXTRACT] Attempting AI page extraction (call ${aiExtractionCount + 1}/3, topicSim=${topicSimBase.toFixed(3)}, textLen=${aiScopedText.length}, host=${hostHint})`);
                if (typeof onStatus === "function") {
                  onStatus(`AI analyzing ${hostHint || "source"} (${runStats.analyzed}/${topResults.length})...`);
                }
                const _aiPageCached = SearchCacheService.getCachedAiResult(link, questionForInference);
                let aiExtracted;
                if (_aiPageCached) {
                  console.log(`  \u{1F916} [AI-EXTRACT] \u{1F4E6} Cache hit for ${hostHint} \u2014 skipping LLM call`);
                  aiExtracted = _aiPageCached;
                } else {
                  aiExtracted = await ApiService.aiExtractFromPage(aiScopedText, questionForInference, hostHint);
                  if (aiExtracted) SearchCacheService.setCachedAiResult(link, questionForInference, aiExtracted);
                }
                aiExtractionCount++;
                if (aiExtracted?.knowledge) {
                  aiKnowledgePool.push({
                    host: hostHint,
                    knowledge: aiExtracted.knowledge,
                    topicSim: topicSimBase,
                    link,
                    title
                  });
                  console.log(`  \u{1F916} [AI-EXTRACT] Knowledge collected from ${hostHint} (${aiExtracted.knowledge.length} chars, pool size=${aiKnowledgePool.length})`);
                }
                if (aiExtracted?.letter && aiExtracted?.evidence && originalOptionsMap) {
                  const evNorm = QuestionParser.normalizeOption(aiExtracted.evidence);
                  const claimedBody = QuestionParser.normalizeOption(originalOptionsMap[aiExtracted.letter] || "");
                  const claimedTokens = claimedBody.split(/\s+/).filter((t) => t.length >= 4);
                  const claimedHits = claimedTokens.filter((t) => evNorm.includes(t)).length;
                  const claimedRatio = claimedTokens.length > 0 ? claimedHits / claimedTokens.length : 1;
                  const stemTokens = QuestionParser.extractKeyTokens(questionStem);
                  const stemHits = stemTokens.filter((t) => evNorm.includes(t)).length;
                  const stemRatio = stemTokens.length > 0 ? stemHits / stemTokens.length : 1;
                  console.log(`  \u{1F916} [AI-EXTRACT] Cross-Q check: claimedHits=${claimedHits}/${claimedTokens.length} (${claimedRatio.toFixed(2)}) stemHits=${stemHits}/${stemTokens.length} (${stemRatio.toFixed(2)})`);
                  if (claimedRatio < 0.38 && stemRatio < 0.25 || claimedRatio < 0.15) {
                    console.log(`  \u{1F916} [AI-EXTRACT] \u274C Cross-question REJECTED: evidence relates to a different question on the page (claimRatio < 0.38 & stemRatio < 0.25, or claimRatio < 0.15)`);
                    console.log(`  \u{1F916} [AI-EXTRACT] Keeping knowledge but discarding letter ${aiExtracted.letter}`);
                    aiExtracted.letter = null;
                    if (aiExtracted.knowledge) {
                      aiExtracted.knowledge = aiExtracted.knowledge.replace(/^RESULTADO:\s*ENCONTRADO\s*$/gim, "").replace(/^Letra\s+[A-E]\b.*$/gim, "").trim();
                    }
                  }
                }
                if (aiExtracted?.letter) {
                  console.log(`  \u{1F916} [AI-EXTRACT] Letter found: ${aiExtracted.letter} (pre-remap)`);
                  aiExtracted.letter = this._remapLetterIfShuffled(aiExtracted.letter, combinedText, originalOptionsMap);
                  console.log(`  \u{1F916} [AI-EXTRACT] Post-remap letter: ${aiExtracted.letter}`);
                  if (originalOptionsMap && aiExtracted.letter && !originalOptionsMap[aiExtracted.letter]) {
                    console.log(`  \u{1F916} [AI-EXTRACT] \u274C Letter ${aiExtracted.letter} not in options map [${Object.keys(originalOptionsMap).join(",")}] \u2014 discarding`);
                    aiExtracted.letter = null;
                  }
                  const baseWeight = getDomainWeight(link);
                  const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                  const riskyMismatchPenalty = riskyCombinedHosts.has(hostHint) && !optionsMatchBase ? 0.4 : 0;
                  const weight = baseWeight + 0.85 + quality * 0.35 - riskyMismatchPenalty;
                  const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                  const evidenceBlock = EvidenceService.buildEvidenceBlock({
                    questionFingerprint,
                    sourceId,
                    sourceLink: link,
                    hostHint,
                    evidenceText: aiExtracted.evidence || scopedCombinedText,
                    originalOptionsMap,
                    explicitLetter: aiExtracted.letter,
                    confidenceLocal: aiExtracted.confidence || 0.82,
                    evidenceType: "ai-page-extraction"
                  });
                  sources.push({
                    title,
                    link,
                    letter: aiExtracted.letter,
                    weight,
                    evidenceType: "ai-page-extraction",
                    questionPolarity,
                    matchQuality: quality,
                    hostHint,
                    sourceId,
                    evidenceBlock
                  });
                  runStats.acceptedViaAiExtraction += 1;
                  runStats.acceptedForVotes += 1;
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    decision: "use-ai-extraction",
                    method: "ai-page-extraction",
                    letter: aiExtracted.letter
                  });
                  console.log(`  \u2705 ACCEPTED via AI page extraction: letter=${aiExtracted.letter} weight=${weight.toFixed(2)}`);
                  const {
                    bestLetter: bestLetter2,
                    votes: votes2
                  } = EvidenceService.computeVotesAndState(sources);
                  if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                    console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                    console.groupEnd();
                    break;
                  }
                  console.groupEnd();
                  continue;
                } else {
                  console.log(`  \u{1F916} [AI-EXTRACT] No letter found for ${hostHint} \u2014 knowledge ${aiExtracted?.knowledge ? "saved" : "empty"}`);
                }
              }
              console.log(`  \u2139\uFE0F No direct evidence found \u2014 collecting for AI combined`);
              const clipped = scopedCombinedText.slice(0, 4e3);
              if (clipped.length >= 200) {
                const topicSim = topicSimBase;
                aiEvidence.push({
                  title,
                  link,
                  text: clipped,
                  topicSim,
                  optionsMatch: optionsMatchBase,
                  optionsCoverage: optionsCoverageBase,
                  hostHint,
                  obfuscated: !!obfuscation?.isObfuscated,
                  paywalled: !!paywall?.isPaywalled
                });
                runStats.acceptedForAiEvidence += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "ai-evidence"
                });
              }
              console.groupEnd();
            } catch (error) {
              console.error("SearchService Error:", error);
              console.groupEnd();
              runStats.blockedByError += 1;
            }
          }
          if (_pendingMismatchAI.length > 0) {
            const { bestLetter: _midLetter, votes: _midVotes } = EvidenceService.computeVotesAndState(sources);
            const _midTopVote = _midLetter ? _midVotes[_midLetter] || 0 : 0;
            if (_midTopVote < 5.5) {
              console.log(`SearchService: \u{1F916} Processing ${_pendingMismatchAI.length} deferred mismatch AI sources (midTopVote=${_midTopVote.toFixed(1)})...`);
              const toProcess = _pendingMismatchAI.slice(0, 3);
              for (const pending of toProcess) {
                if (aiExtractionCount >= 5) break;
                const { aiScopedText, hostHint: ph, sourceType: pst, title: pt, link: pl, topicSim: ptopicSim, obfuscation: pobf } = pending;
                if (typeof onStatus === "function") onStatus(`AI extracting knowledge from ${ph || "source"}...`);
                try {
                  const aiExtracted = await ApiService.aiExtractFromPage(aiScopedText, questionForInference, ph);
                  aiExtractionCount++;
                  if (aiExtracted?.knowledge) {
                    const cleanKnowledge = aiExtracted.knowledge.replace(/^RESULTADO:\s*ENCONTRADO\s*$/gim, "").replace(/^Letra\s+[A-E]\b.*$/gim, "").trim();
                    aiKnowledgePool.push({ host: ph, knowledge: cleanKnowledge, topicSim: ptopicSim, link: pl, title: pt, origin: "mismatch" });
                    console.log(`  \u{1F916} [AI-MISMATCH-DEFERRED] Knowledge collected: ${cleanKnowledge.length} chars (pool=${aiKnowledgePool.length})`);
                  }
                  const aiTextCandidates = [];
                  if (aiExtracted?.evidence) aiTextCandidates.push({ text: aiExtracted.evidence, tag: "ai-evidence" });
                  if (aiExtracted?.knowledge) {
                    const parsedFromKnowledge = this._parseAnswerText(aiExtracted.knowledge);
                    if (parsedFromKnowledge && parsedFromKnowledge.length >= 18) aiTextCandidates.push({ text: parsedFromKnowledge, tag: "ai-knowledge-answer" });
                  }
                  let mappedFromAiText = null;
                  let mappedAiEvidenceText = "";
                  for (const candidate of aiTextCandidates) {
                    const mapped = tryMapTextAnswerCandidate(candidate.text, ph, ptopicSim);
                    if (!mapped) continue;
                    mappedFromAiText = { mapped, methodTag: candidate.tag };
                    mappedAiEvidenceText = candidate.text;
                    break;
                  }
                  if (mappedFromAiText) {
                    runStats.acceptedViaAiExtraction += 1;
                    addTextMappedSource.call(this, { title: pt, link: pl, hostHint: ph, sourceType: pst, topicSim: ptopicSim, obfuscation: pobf, mapped: mappedFromAiText.mapped, evidenceText: mappedAiEvidenceText, methodTag: mappedFromAiText.methodTag });
                  }
                  if (aiExtracted?.letter && !mappedFromAiText) {
                    console.log(`  [AI-MISMATCH-DEFERRED] Letter ${aiExtracted.letter} found but IGNORED (options mismatch without validated textual mapping)`);
                  }
                } catch (e) {
                  console.warn(`  \u{1F916} [AI-MISMATCH-DEFERRED] Extraction failed:`, e?.message || e);
                }
              }
            } else {
              console.log(`SearchService: \u26A1 Skipping deferred AI-mismatch (midTopVote=${_midTopVote.toFixed(1)} \u2265 5.5 \u2014 sufficient evidence)`);
            }
          }
          if (sources.length === 0 && hasOptions) {
            console.group("\u{1F4CB} Snippet-level gabarito extraction");
            for (const result of topResults) {
              const snipText = `${result.title || ""}. ${result.snippet || ""}`.trim();
              if (snipText.length < 60) continue;
              const snipSim = QuestionParser.questionSimilarityScore(snipText, questionStem);
              if (snipSim < 0.4) continue;
              const snipCoverage = OptionsMatchService.optionsCoverageInFreeText(originalOptions, snipText);
              if (!snipCoverage.hasEnoughOptions || snipCoverage.ratio < 0.5) continue;
              const gabarito = EvidenceService.extractExplicitGabarito(snipText, questionStem);
              if (gabarito?.letter) {
                const hostHint = this._getHostHintFromLink(result.link);
                const letter = gabarito.letter.toUpperCase();
                const baseWeight = getDomainWeight(result.link);
                const weight = baseWeight + 1.6;
                const sourceId = `snippet-gabarito:${sources.length + 1}`;
                const evidenceBlock = EvidenceService.buildEvidenceBlock({
                  questionFingerprint,
                  sourceId,
                  sourceLink: result.link,
                  hostHint,
                  evidenceText: snipText,
                  originalOptionsMap,
                  explicitLetter: letter,
                  confidenceLocal: gabarito.confidence || 0.85,
                  evidenceType: "snippet-gabarito"
                });
                sources.push({
                  title: result.title || "",
                  link: result.link,
                  letter,
                  weight,
                  evidenceType: "snippet-gabarito",
                  questionPolarity,
                  matchQuality: 7,
                  hostHint,
                  sourceId,
                  evidenceBlock
                });
                runStats.acceptedForVotes += 1;
                console.log(`  \u2705 Snippet gabarito: letter=${letter} host=${hostHint} sim=${snipSim.toFixed(2)} coverage=${snipCoverage.hits}/${snipCoverage.total} weight=${weight.toFixed(2)}`);
              }
            }
            console.log(`  Snippet gabarito sources added: ${sources.filter((s) => s.evidenceType === "snippet-gabarito").length}`);
            console.groupEnd();
          }
          const totalBlocked = runStats.blockedSnapshotMismatch + runStats.blockedByError + runStats.blockedOptionsMismatch + runStats.blockedObfuscation;
          const failRate = runStats.analyzed > 0 ? totalBlocked / runStats.analyzed : 0;
          const snippetEvidence = [];
          if (sources.length === 0 && failRate >= 0.7 && topResults.length > 0) {
            for (const result of topResults) {
              const snipText = `${result.title || ""}. ${result.snippet || ""}`.trim();
              if (snipText.length < 80) continue;
              const snipSim = QuestionParser.questionSimilarityScore(snipText, questionStem);
              if (snipSim < 0.2) continue;
              const snipCoverage = hasOptions ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, snipText) : {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: false
              };
              const snipStrongCoverage = !hasOptions || snipCoverage.ratio >= 0.6 || snipCoverage.hits >= Math.min(3, snipCoverage.total || 3);
              if (hasOptions && (!snipStrongCoverage || snipSim < 0.32)) continue;
              snippetEvidence.push({
                title: result.title || "",
                link: result.link || "",
                text: snipText.slice(0, 1500),
                topicSim: snipSim,
                optionsMatch: snipStrongCoverage,
                optionsCoverage: snipCoverage,
                hostHint: this._getHostHintFromLink(result.link),
                obfuscated: false,
                paywalled: false
              });
            }
            if (snippetEvidence.length > 0) {
              console.log(`SearchService: Snippet fallback collected ${snippetEvidence.length} snippet sources (failRate=${failRate.toFixed(2)})`);
            }
          }
          const allForCombined = [...aiEvidence.map((e) => ({
            ...e,
            origin: "aiEvidence"
          })), ...collectedForCombined.map((e) => ({
            ...e,
            origin: "mismatch"
          })), ...snippetEvidence.map((e) => ({
            ...e,
            origin: "snippet"
          }))].sort((a, b) => (b.topicSim || 0) - (a.topicSim || 0));
          console.group("\u{1F9E0} AI Combined Evidence Pool");
          console.log(`Direct sources found: ${sources.length}`);
          console.log(`AI evidence pool: ${aiEvidence.length} | Mismatch pool: ${collectedForCombined.length} | Snippet pool: ${snippetEvidence.length}`);
          console.log(`AI knowledge pool: ${aiKnowledgePool.length} entries`);
          if (aiKnowledgePool.length > 0) {
            aiKnowledgePool.forEach((k, i) => {
              console.log(`  \u{1F4DA} [${i}] host=${k.host} topicSim=${(k.topicSim || 0).toFixed(3)} knowledge=${(k.knowledge || "").length} chars origin=${k.origin || "direct"}`);
            });
          }
          console.log(`Total for combined: ${allForCombined.length}`);
          allForCombined.forEach((e, i) => {
            console.log(`  [${i}] origin=${e.origin} host=${e.hostHint} topicSim=${(e.topicSim || 0).toFixed(3)} optMatch=${e.optionsMatch} coverage=${JSON.stringify(e.optionsCoverage)} textLen=${(e.text || "").length}`);
          });
          console.groupEnd();
          const hasStrongExplicit = sources.some((s) => (s.weight || 0) >= 5);
          if (allForCombined.length > 0 && (!hasStrongExplicit || sources.length < 2)) {
            if (typeof onStatus === "function") {
              onStatus(sources.length === 0 ? "No explicit answer found. Using AI best-effort..." : "Cross-checking with additional sources...");
            }
            const minTopicSim = hasOptions ? 0.22 : 0.15;
            let relevant = allForCombined.filter((e) => {
              const topicSim = e.topicSim || 0;
              if (topicSim < minTopicSim) {
                console.log(`    \u274C Filtered (low topicSim ${topicSim.toFixed(3)} < ${minTopicSim}): ${e.hostHint}`);
                return false;
              }
              if (!hasOptions) return true;
              const origin = String(e.origin || "").toLowerCase();
              const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              const strongCoverage = e.optionsMatch === true || hasStrongOptionCoverage(coverage);
              if (origin === "aievidence" && riskyCombinedHosts.has(host)) {
                if (!strongCoverage) {
                  console.log(`    \u274C Risky aiEvidence rejected (weak coverage): host=${host} topicSim=${topicSim.toFixed(2)} coverage=${coverage.hits}/${coverage.total}`);
                  return false;
                }
              }
              if (origin === "snippet") {
                if (!strongCoverage) return false;
                if (topicSim < 0.3) return false;
              }
              if (strongCoverage) return true;
              const veryHighSimLowCoverageOk = topicSim >= 0.85 && (coverage.hits || 0) >= 1 && isTrustedCombinedHost(host) && !e.obfuscated && !e.paywalled;
              if (origin === "mismatch" && topicSim >= 0.62 && (e.text || "").length >= 500 && (hasMediumOptionCoverage(coverage) || veryHighSimLowCoverageOk) && !riskyCombinedHosts.has(host) && !e.obfuscated && !e.paywalled && isTrustedCombinedHost(host)) {
                console.log(`    \u2705 Cross-question evidence ADMITTED: host=${host} topicSim=${topicSim.toFixed(2)} textLen=${(e.text || "").length}`);
                console.log(`SearchService: Cross-question evidence admitted for AI combined: host=${host} topicSim=${topicSim.toFixed(2)} textLen=${(e.text || "").length}`);
                return true;
              } else if (origin === "mismatch") {
                console.log(`    \u274C Cross-question REJECTED: host=${host} topicSim=${topicSim.toFixed(2)} len=${(e.text || "").length}`);
              }
              if (riskyCombinedHosts.has(host) || e.obfuscated || e.paywalled) return false;
              const mediumCoverage = hasMediumOptionCoverage(coverage);
              return mediumCoverage && topicSim >= 0.45;
            }).slice(0, 5);
            const hasReliableOptionAlignedSource = !hasOptions || relevant.some((e) => {
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              return e.optionsMatch === true || hasStrongOptionCoverage(coverage);
            });
            const hasAnyOptionAlignedSource = !hasOptions || relevant.some((e) => {
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              return e.optionsMatch === true || hasMediumOptionCoverage(coverage);
            });
            const hasTrustedRelevantSource = relevant.some((e) => {
              const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
              return isTrustedCombinedHost(host);
            });
            const hasVeryStrongAlignedSource = !hasOptions || relevant.some((e) => {
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              return hasVeryStrongOptionCoverage(coverage);
            });
            const minRelevantSources = hasOptions && !hasStrongExplicit ? 2 : 1;
            console.group("\u{1F916} AI Combined Decision");
            console.log(`Relevant sources after filtering: ${relevant.length}`);
            relevant.forEach((e, i) => {
              console.log(`  [${i}] origin=${e.origin} host=${e.hostHint} topicSim=${(e.topicSim || 0).toFixed(3)} optMatch=${e.optionsMatch} textLen=${(e.text || "").length}`);
            });
            console.log(`desperateMode=false | hasStrongExplicit=${hasStrongExplicit} | hasReliableOptionAligned=${hasReliableOptionAlignedSource} | minRelevantSources=${minRelevantSources}`);
            if (hasOptions && !hasReliableOptionAlignedSource && relevant.length < minRelevantSources) {
              console.log(`\u26D4 AI combined SKIPPED: weak option alignment (relevant=${relevant.length}, reliable=${hasReliableOptionAlignedSource})`);
              console.log(`SearchService: AI combined skipped - weak option alignment (relevant=${relevant.length}, reliable=${hasReliableOptionAlignedSource})`);
              return [];
            }
            const strongRelevant = relevant.filter((e) => {
              const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              const strongCoverage = !hasOptions || e.optionsMatch === true || hasStrongOptionCoverage(coverage);
              return strongCoverage && (e.topicSim || 0) >= (hasOptions ? 0.45 : 0.3) && !riskyCombinedHosts.has(host) && isTrustedCombinedHost(host) && !e.obfuscated && !e.paywalled;
            });
            const strongRelevantDomainCount = new Set(strongRelevant.map((e) => String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase()).filter(Boolean)).size;
            const hasEliteAnchoredEvidence = relevant.some((e) => {
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              const strongCoverage = !hasOptions || e.optionsMatch === true || hasStrongOptionCoverage(coverage);
              return String(e.origin || "") === "aiEvidence" && strongCoverage && (e.topicSim || 0) >= 0.78 && (e.text || "").length >= 1800 && !e.obfuscated && !e.paywalled;
            });
            const corroboratingSnippetCount = relevant.filter((e) => {
              if (String(e.origin || "") !== "snippet") return false;
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              return hasStrongOptionCoverage(coverage) && (e.topicSim || 0) >= 0.3;
            }).length;
            const canProceedAISynthesisOnly = sources.length === 0 && hasOptions && (strongRelevant.length >= 3 && strongRelevantDomainCount >= 2 && hasVeryStrongAlignedSource || hasEliteAnchoredEvidence && hasReliableOptionAlignedSource && relevant.length >= 2 && corroboratingSnippetCount >= 1 || // Path 3: high topic-similarity source provides strong anchor
            // even without corroborating snippets.
            hasReliableOptionAlignedSource && relevant.length >= 2 && relevant.some((e) => (e.topicSim || 0) >= 0.55) && relevant.filter((e) => (e.topicSim || 0) >= 0.4 && e.optionsMatch).length >= 2);
            const canProceedAI = relevant.length > 0 && sources.length > 0 && (!hasOptions || hasReliableOptionAlignedSource && relevant.length >= minRelevantSources) || canProceedAISynthesisOnly;
            console.log(`canProceedAI=${canProceedAI}`);
            if (canProceedAISynthesisOnly) {
              console.log(`\u2705 AI synthesis-only mode enabled: strongRelevant=${strongRelevant.length}, domainDiversity=${strongRelevantDomainCount}`);
              console.log(`   anchorMode=${hasEliteAnchoredEvidence} corroboratingSnippets=${corroboratingSnippetCount}`);
            }
            if (!canProceedAI) {
              console.log("\u274C AI combined will NOT run");
              console.groupEnd();
            }
            if (canProceedAI) {
              const merged = relevant.map((e, i) => `SOURCE ${i + 1}: ${e.title}
${e.text}
LINK: ${e.link}`).join("\n\n");
              const knowledgePromise = Promise.resolve(null);
              try {
                const [aiAnswer, knowledgeAnswer] = await Promise.all([ApiService.inferAnswerFromEvidence(questionForInference, merged), knowledgePromise]);
                let aiLetter = this._parseAnswerLetter(aiAnswer);
                let aiWeightUsed = null;
                if (!aiLetter && aiAnswer && originalOptionsMap) {
                  aiLetter = OptionsMatchService.findLetterByAnswerText(aiAnswer, originalOptionsMap);
                  if (aiLetter) console.log(`SearchService: AI combined letter recovered via text match => ${aiLetter}`);
                }
                if (aiLetter) {
                  if (canProceedAISynthesisOnly && hasOptions && originalOptionsMap) {
                    const evidenceCorpus = QuestionParser.normalizeOption(relevant.map((e) => String(e.text || "").slice(0, 2200)).join(" "));
                    const optionEntries = Object.entries(originalOptionsMap).filter(([letter]) => /^[A-E]$/.test(String(letter || "").toUpperCase())).map(([letter, text]) => {
                      const norm = QuestionParser.normalizeOption(String(text || ""));
                      const tokens = norm.split(/\s+/).filter((token) => token.length >= 4);
                      const hits = tokens.reduce((count, token) => count + (evidenceCorpus.includes(token) ? 1 : 0), 0);
                      const tokenRatio = tokens.length > 0 ? hits / tokens.length : 0;
                      const dice = norm ? QuestionParser.diceSimilarity(evidenceCorpus, norm) : 0;
                      const score = tokenRatio * 0.7 + dice * 0.3;
                      return {
                        letter: String(letter).toUpperCase(),
                        score,
                        tokenRatio,
                        dice,
                        hits,
                        tokenCount: tokens.length
                      };
                    }).sort((a, b) => b.score - a.score);
                    const topOption = optionEntries[0] || null;
                    const secondOption = optionEntries[1] || null;
                    const selected = optionEntries.find((entry) => entry.letter === String(aiLetter).toUpperCase()) || null;
                    const supportMinScore = 0.22;
                    const supportMinTokenRatio = 0.38;
                    const supportMargin = topOption && secondOption ? topOption.score - secondOption.score : 1;
                    const effectiveMarginThreshold = selected && selected.score >= 0.4 ? 0.25 : selected && selected.score >= 0.3 ? 0.12 : 0.03;
                    const selectedSupported = !!selected && selected.score >= supportMinScore && selected.tokenRatio >= supportMinTokenRatio && (!topOption || topOption.letter === selected.letter || supportMargin < effectiveMarginThreshold);
                    console.log(`SearchService: AI synthesis support check => selected=${selected?.letter || "none"} score=${(selected?.score || 0).toFixed(3)} tokenRatio=${(selected?.tokenRatio || 0).toFixed(3)} top=${topOption?.letter || "none"} topScore=${(topOption?.score || 0).toFixed(3)} margin=${supportMargin.toFixed(3)}`);
                    if (!selectedSupported) {
                      console.log(`\u26D4 AI combined letter rejected by evidence-support guard (selected=${aiLetter}, top=${topOption?.letter || "none"})`);
                      aiLetter = null;
                    }
                  }
                }
                if (aiLetter) {
                  const allCrossQuestion = relevant.every((e) => String(e.origin || "") === "mismatch" || e.optionsMatch === false);
                  const aiWeight = hasStrongExplicit ? 0.3 : canProceedAISynthesisOnly ? 0.35 : allCrossQuestion ? 0.2 : 0.45;
                  aiWeightUsed = aiWeight;
                  console.log(`  AI combined result: letter=${aiLetter} allCrossQuestion=${allCrossQuestion} weight=${aiWeight}`);
                  const sourceId = `ai-combined:${sources.length + 1}`;
                  const evidenceBlock = EvidenceService.buildEvidenceBlock({
                    questionFingerprint,
                    sourceId,
                    sourceLink: "",
                    hostHint: "ai",
                    evidenceText: aiAnswer || merged,
                    originalOptionsMap,
                    explicitLetter: aiLetter,
                    confidenceLocal: hasStrongExplicit ? 0.42 : 0.5,
                    evidenceType: "ai-combined"
                  });
                  sources.push({
                    title: "AI (combined evidence)",
                    link: "",
                    letter: aiLetter,
                    weight: aiWeight,
                    evidenceType: "ai-combined",
                    questionPolarity,
                    hostHint: "ai",
                    sourceId,
                    evidenceBlock
                  });
                  runStats.acceptedForVotes += 1;
                  console.log(`SearchService: AI combined => Letra ${aiLetter}, weight=${aiWeight}`);
                }
                if (knowledgeAnswer) {
                  let knLetter = this._parseAnswerLetter(knowledgeAnswer);
                  if (!knLetter && originalOptionsMap) {
                    knLetter = OptionsMatchService.findLetterByAnswerText(knowledgeAnswer, originalOptionsMap);
                    if (knLetter) console.log(`SearchService: AI knowledge letter recovered via text match => ${knLetter}`);
                  }
                  if (knLetter) {
                    const knWeight = 0.55;
                    const knSourceId = `ai-knowledge:${sources.length + 1}`;
                    const knEvidenceBlock = EvidenceService.buildEvidenceBlock({
                      questionFingerprint,
                      sourceId: knSourceId,
                      sourceLink: "",
                      hostHint: "ai",
                      evidenceText: knowledgeAnswer || "",
                      originalOptionsMap,
                      explicitLetter: knLetter,
                      confidenceLocal: 0.6,
                      evidenceType: "ai-knowledge"
                    });
                    sources.push({
                      title: "AI (knowledge-based)",
                      link: "",
                      letter: knLetter,
                      weight: knWeight,
                      evidenceType: "ai-knowledge",
                      questionPolarity,
                      hostHint: "ai",
                      sourceId: knSourceId,
                      evidenceBlock: knEvidenceBlock
                    });
                    runStats.acceptedForVotes += 1;
                    console.log(`SearchService: AI knowledge => Letra ${knLetter}, weight=${knWeight}`);
                    if (aiLetter && knLetter !== aiLetter) {
                      console.warn(`SearchService: CONFLICT evidence=${aiLetter} vs knowledge=${knLetter} \u2014 knowledge (${knWeight}) overrides evidence (${aiWeightUsed ?? "n/a"})`);
                    }
                  }
                }
                console.groupEnd();
              } catch (error) {
                console.warn("AI evidence inference failed:", error);
                console.groupEnd();
              }
            }
          }
          if (pageGabarito) {
            const pgLetter = (pageGabarito || "").toUpperCase().trim();
            if (/^[A-E]$/.test(pgLetter)) {
              const sourceId = `page-gabarito:${sources.length + 1}`;
              const evidenceBlock = EvidenceService.buildEvidenceBlock({
                questionFingerprint,
                sourceId,
                sourceLink: "",
                hostHint: "page",
                evidenceText: String(pageGabarito || ""),
                originalOptionsMap,
                explicitLetter: pgLetter,
                confidenceLocal: 0.9,
                evidenceType: "page-gabarito"
              });
              sources.push({
                title: "Page Gabarito",
                link: "",
                letter: pgLetter,
                weight: 5,
                evidenceType: "page-gabarito",
                questionPolarity,
                hostHint: "page",
                sourceId,
                evidenceBlock
              });
              runStats.acceptedForVotes += 1;
            }
          }
          if (sources.length === 0 && aiKnowledgePool.length > 0 && hasOptions) {
            console.group("\u{1F9E0} AI Combined Reflection Fallback");
            console.log(`No voting sources. Knowledge pool has ${aiKnowledgePool.length} entries from AI extraction.`);
            aiKnowledgePool.forEach((k, i) => {
              console.log(`  [${i}] host=${k.host} topicSim=${(k.topicSim || 0).toFixed(3)} knowledge=${(k.knowledge || "").length} chars origin=${k.origin || "direct"}`);
            });
            if (typeof onStatus === "function") {
              onStatus("Reflecting on accumulated knowledge...");
            }
            try {
              const reflectionResult = await ApiService.aiReflectOnSources(questionForInference, aiKnowledgePool);
              if (reflectionResult?.letter) {
                let reflectLetter = reflectionResult.letter.toUpperCase();
                if (/^[A-E]$/.test(reflectLetter)) {
                  reflectLetter = this._remapLetterIfShuffled(reflectLetter, "", originalOptionsMap);
                  console.log(`  \u{1F9E0} [REFLECTION] Letter found: ${reflectLetter}`);
                  const reflectWeight = 1.2;
                  const sourceId = `ai-reflection:${sources.length + 1}`;
                  const evidenceBlock = EvidenceService.buildEvidenceBlock({
                    questionFingerprint,
                    sourceId,
                    sourceLink: "",
                    hostHint: "ai-reflection",
                    evidenceText: reflectionResult.response || "",
                    originalOptionsMap,
                    explicitLetter: reflectLetter,
                    confidenceLocal: 0.55,
                    evidenceType: "ai-combined-reflection"
                  });
                  sources.push({
                    title: "AI (combined reflection)",
                    link: "",
                    letter: reflectLetter,
                    weight: reflectWeight,
                    evidenceType: "ai-combined-reflection",
                    questionPolarity,
                    hostHint: "ai-reflection",
                    sourceId,
                    evidenceBlock
                  });
                  runStats.acceptedForVotes += 1;
                  console.log(`  \u2705 AI reflection accepted: letter=${reflectLetter} weight=${reflectWeight}`);
                } else {
                  console.log(`  \u274C AI reflection returned invalid letter: "${reflectionResult.letter}"`);
                }
              } else {
                console.log(`  \u274C AI reflection returned no letter (INCONCLUSIVO)`);
              }
            } catch (e) {
              console.warn(`  \u{1F9E0} AI reflection error:`, e?.message || e);
            }
            console.groupEnd();
          } else if (sources.length === 0 && aiKnowledgePool.length === 0) {
            console.log("\u{1F9E0} No knowledge pool accumulated \u2014 reflection fallback skipped");
          }
          if (sources.length === 0) {
            logRunSummary("no-sources");
            return [];
          }
          const {
            votes,
            baseVotes,
            evidenceVotes,
            bestLetter,
            resultState,
            reason,
            confidence,
            evidenceConsensus
          } = EvidenceService.computeVotesAndState(sources);
          console.group("\u{1F3F3}\uFE0F Final Voting Breakdown");
          console.log("All sources:");
          sources.forEach((s, i) => {
            console.log(`  [${i}] host=${s.hostHint} letter=${s.letter} weight=${s.weight?.toFixed?.(2) || s.weight} type=${s.evidenceType} method=${s.extractionMethod || "n/a"}`);
          });
          console.log("Votes:", JSON.stringify(votes));
          console.log("Base votes:", JSON.stringify(baseVotes));
          console.log("Evidence votes:", JSON.stringify(evidenceVotes));
          console.log(`Best letter: ${bestLetter} | State: ${resultState} | Confidence: ${confidence} | Reason: ${reason}`);
          console.log("Evidence consensus:", JSON.stringify(evidenceConsensus));
          console.groupEnd();
          let answerText = "";
          if (bestLetter && originalOptionsMap[bestLetter]) {
            answerText = originalOptionsMap[bestLetter];
          }
          const answer = bestLetter ? `Letra ${bestLetter}: ${answerText}`.trim() : (sources[0]?.answer || "").trim();
          const isAiOnly = sources.every((s) => s.evidenceType === "ai" || s.evidenceType === "ai-combined");
          const hasExplicitEvidence = sources.some((s) => s.evidenceType && s.evidenceType !== "ai" && s.evidenceType !== "ai-combined");
          let evidenceTier = "EVIDENCE_WEAK";
          if (isAiOnly) {
            evidenceTier = "AI_ONLY";
          } else if (resultState === "confirmed") {
            evidenceTier = "EVIDENCE_STRONG";
          } else if (hasExplicitEvidence && (evidenceConsensus?.bestEvidenceCount || 0) >= 1) {
            evidenceTier = "EVIDENCE_MEDIUM";
          }
          let overview = null;
          try {
            const overviewCandidates = [];
            const seenOverviewKeys = /* @__PURE__ */ new Set();
            const pushOverviewCandidate = (candidate) => {
              const title = String(candidate?.title || "").trim();
              const link = String(candidate?.link || "").trim();
              const text = String(candidate?.text || "").trim();
              if (text.length < 120) return;
              const key = `${title}|${link}`.slice(0, 500);
              if (seenOverviewKeys.has(key)) return;
              seenOverviewKeys.add(key);
              overviewCandidates.push({
                title,
                link,
                text
              });
            };
            for (const source of sources) {
              if (!source || source.evidenceType === "ai" || source.evidenceType === "ai-combined") continue;
              const text = source?.evidence || source?.evidenceBlock?.evidenceText || "";
              pushOverviewCandidate({
                title: source.title,
                link: source.link,
                text
              });
            }
            for (const evidence of allForCombined) {
              if (!evidence) continue;
              const coverage = evidence.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: false
              };
              const alignedEnough = !hasOptions || evidence.optionsMatch === true || hasMediumOptionCoverage(coverage);
              if (!alignedEnough) continue;
              if ((evidence.topicSim || 0) < 0.28) continue;
              pushOverviewCandidate({
                title: evidence.title,
                link: evidence.link,
                text: evidence.text
              });
            }
            if (overviewCandidates.length >= 2) {
              overview = await ApiService.generateOverviewFromEvidence(questionForInference, overviewCandidates.slice(0, 6));
            }
          } catch (error) {
            console.warn("SearchService: failed to build overview payload:", error?.message || String(error));
          }
          const finalPayload = [{
            question: questionText,
            answer,
            answerLetter: bestLetter,
            answerText,
            optionsMap: originalOptionsMap && Object.keys(originalOptionsMap).length >= 2 ? {
              ...originalOptionsMap
            } : null,
            sources,
            bestLetter,
            votes,
            baseVotes,
            evidenceVotes,
            evidenceConsensus,
            confidence,
            resultState,
            reason,
            evidenceTier,
            questionPolarity,
            title: sources[0]?.title || "Result",
            aiFallback: isAiOnly,
            questionFingerprint,
            runStats,
            googleMetaSignals,
            overview
          }];
          logRunSummary(resultState);
          return finalPayload;
        },
        async searchAndRefine(questionText, originalQuestionWithOptions = "", onStatus = null) {
          const questionForInference = originalQuestionWithOptions || questionText;
          const questionFingerprint = await this._canonicalHash(questionForInference);
          const buildInconclusiveNoEvidence = (reason) => [{
            question: questionText,
            answer: "INCONCLUSIVO: sem evid\xEAncia externa confi\xE1vel para marcar alternativa.",
            answerLetter: null,
            answerText: "Sem evid\xEAncia externa confi\xE1vel para marcar alternativa.",
            aiFallback: false,
            evidenceTier: "EVIDENCE_WEAK",
            resultState: "inconclusive",
            reason,
            confidence: 0.12,
            votes: void 0,
            sources: []
          }];
          const cachedDecision = await this._getCachedDecisionForFingerprint(questionFingerprint);
          const cachedResult = cachedDecision ? this._buildResultFromCachedDecision(questionText, questionForInference, cachedDecision) : null;
          const cachedItem = cachedResult?.[0] || null;
          const hasCached = !!cachedItem;
          const results = await ApiService.searchWithSerper(questionText);
          const serperMeta = results?._serperMeta || null;
          const searchProvider = results?._searchProvider || null;
          const mergedResults = await this._mergeCachedSourcesIntoResults(questionFingerprint, results || []);
          if (serperMeta) mergedResults._serperMeta = serperMeta;
          if (searchProvider) mergedResults._searchProvider = searchProvider;
          if (!mergedResults || mergedResults.length === 0) {
            if (hasCached) {
              await this._recordSearchMetrics({
                cacheHit: true,
                outcome: "cache-fallback-no-search-results",
                resultState: cachedItem.resultState || "confirmed",
                evidenceTier: cachedItem.evidenceTier || "EVIDENCE_STRONG",
                runStats: null,
                bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || "",
                confidence: Number(cachedItem.confidence || 0.9)
              });
              return cachedResult;
            }
            const inconclusive = buildInconclusiveNoEvidence("no_search_results");
            const inconclusiveItem = inconclusive[0] || {};
            await this._recordSearchMetrics({
              cacheHit: false,
              outcome: "no-search-results",
              resultState: inconclusiveItem.resultState || "inconclusive",
              evidenceTier: inconclusiveItem.evidenceTier || "EVIDENCE_WEAK",
              runStats: null,
              bestLetter: "",
              confidence: Number(inconclusiveItem.confidence || 0.12)
            });
            return inconclusive;
          }
          const refined = await this.refineFromResults(questionText, mergedResults, originalQuestionWithOptions);
          if (!refined || refined.length === 0) {
            if (hasCached) {
              await this._recordSearchMetrics({
                cacheHit: true,
                outcome: "cache-fallback-no-evidence",
                resultState: cachedItem.resultState || "confirmed",
                evidenceTier: cachedItem.evidenceTier || "EVIDENCE_STRONG",
                runStats: null,
                bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || "",
                confidence: Number(cachedItem.confidence || 0.9)
              });
              return cachedResult;
            }
            const inconclusive = buildInconclusiveNoEvidence("no_evidence");
            const inconclusiveItem = inconclusive[0] || {};
            await this._recordSearchMetrics({
              cacheHit: false,
              outcome: "no-evidence",
              resultState: inconclusiveItem.resultState || "inconclusive",
              evidenceTier: inconclusiveItem.evidenceTier || "EVIDENCE_WEAK",
              runStats: null,
              bestLetter: "",
              confidence: Number(inconclusiveItem.confidence || 0.12)
            });
            return inconclusive;
          }
          const resultItem = refined[0] || {};
          const freshIsStrongConfirmed = resultItem.resultState === "confirmed" && resultItem.evidenceTier === "EVIDENCE_STRONG";
          const freshLetter = String(resultItem.answerLetter || resultItem.bestLetter || "").toUpperCase();
          const cachedLetter = String(cachedItem?.answerLetter || cachedItem?.bestLetter || "").toUpperCase();
          const freshHasNonAiEvidence = Array.isArray(resultItem.sources) && resultItem.sources.some((s) => s?.evidenceType && s.evidenceType !== "ai" && s.evidenceType !== "ai-combined");
          const freshDiffersFromCache = !!(freshLetter && cachedLetter && freshLetter !== cachedLetter);
          const freshUpgradeCandidate = freshDiffersFromCache && freshHasNonAiEvidence && resultItem.evidenceTier !== "AI_ONLY" && Number(resultItem.confidence || 0) >= 0.72;
          if (hasCached && !freshIsStrongConfirmed && !freshUpgradeCandidate) {
            await this._recordSearchMetrics({
              cacheHit: true,
              outcome: "cache-fallback-fresh-weak",
              resultState: cachedItem.resultState || "confirmed",
              evidenceTier: cachedItem.evidenceTier || "EVIDENCE_STRONG",
              runStats: resultItem.runStats || null,
              bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || "",
              confidence: Number(cachedItem.confidence || 0.9)
            });
            return cachedResult;
          }
          const cacheSources = Array.isArray(resultItem.sources) ? resultItem.sources : [];
          const hasLinkSource = cacheSources.some((s) => String(s?.link || "").trim().length > 0);
          if (hasLinkSource || resultItem.resultState === "confirmed") {
            await this._setCachedDecisionForFingerprint(questionFingerprint, resultItem, cacheSources);
          }
          if (hasCached && freshIsStrongConfirmed && freshLetter && cachedLetter && freshLetter !== cachedLetter) {
            console.warn(`SearchService: cache corrected from ${cachedLetter} to ${freshLetter} by fresh strong evidence`);
          }
          if (hasCached && freshUpgradeCandidate) {
            console.warn(`SearchService: cache updated by fresh non-AI evidence (${cachedLetter} -> ${freshLetter})`);
          }
          await this._recordSearchMetrics({
            cacheHit: hasCached,
            outcome: hasCached ? freshUpgradeCandidate ? "cache-revalidated-upgrade" : "cache-revalidated" : "refined",
            resultState: resultItem.resultState || "inconclusive",
            evidenceTier: resultItem.evidenceTier || "EVIDENCE_WEAK",
            runStats: resultItem.runStats || null,
            bestLetter: resultItem.bestLetter || resultItem.answerLetter || "",
            confidence: Number(resultItem.confidence || 0)
          });
          return refined;
        }
      };
    }
  });

  // src/background.js
  var require_background = __commonJS({
    "src/background.js"() {
      init_ChatGPTAuthService();
      init_SearchService();
      var CALLBACK_PATTERN = "http://localhost:1455/auth/callback";
      chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (!changeInfo.url) return;
        if (!changeInfo.url.startsWith(CALLBACK_PATTERN)) return;
        console.log("ChatGPTAuth BG: Captured OAuth callback!");
        try {
          const result = await ChatGPTAuthService.handleCallback(changeInfo.url);
          if (result.success) {
            console.log("ChatGPTAuth BG: Login successful!");
            try {
              await chrome.tabs.remove(tabId);
            } catch (_) {
            }
            try {
              await chrome.runtime.sendMessage({
                type: "CHATGPT_AUTH_SUCCESS",
                email: result.email
              });
            } catch (_) {
            }
          } else {
            console.error("ChatGPTAuth BG: Login failed:", result.error);
            try {
              await chrome.tabs.remove(tabId);
            } catch (_) {
            }
            try {
              await chrome.runtime.sendMessage({
                type: "CHATGPT_AUTH_FAILED",
                error: result.error
              });
            } catch (_) {
            }
          }
        } catch (err) {
          console.error("ChatGPTAuth BG: Callback handling error:", err);
        }
      });
      chrome.storage.local.get(["chatgpt_pkce_pending"], (result) => {
        if (result.chatgpt_pkce_pending) {
          console.log("ChatGPTAuth BG: PKCE session pending \u2014 monitoring tabs for callback");
        }
      });
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg.type !== "SEARCH_PHASE2") return false;
        _runPhase2Search(msg.requestId, msg.question, msg.displayQuestion).catch(console.error);
        sendResponse({ ack: true });
        return false;
      });
      async function _runPhase2Search(requestId, question, displayQuestion) {
        const key = `ah_bg_search_${requestId}`;
        const keepAlive = setInterval(() => {
          chrome.runtime.getPlatformInfo(() => {
          });
        }, 2e4);
        try {
          await chrome.storage.local.set({ [key]: { state: "running", startedAt: Date.now() } });
          const searchResults = await SearchService.searchOnly(displayQuestion);
          if (!searchResults || searchResults.length === 0) {
            await chrome.storage.local.set({ [key]: { state: "no_results", completedAt: Date.now() } });
            return;
          }
          await chrome.storage.local.set({
            [`${key}_status`]: `Analisando ${searchResults.length} fontes...`
          });
          const finalResults = await SearchService.refineFromResults(
            question,
            searchResults,
            displayQuestion,
            async (message) => {
              try {
                await chrome.storage.local.set({ [`${key}_status`]: message });
              } catch (_) {
              }
            }
          );
          if (!finalResults || finalResults.length === 0) {
            await chrome.storage.local.set({ [key]: { state: "no_results", completedAt: Date.now() } });
            return;
          }
          await chrome.storage.local.set({
            [key]: { state: "done", results: finalResults, completedAt: Date.now() }
          });
        } catch (err) {
          console.error("AnswerHunter BG: Phase 2 search error:", err);
          try {
            await chrome.storage.local.set({
              [key]: { state: "error", error: String(err?.message || err), completedAt: Date.now() }
            });
          } catch (_) {
          }
        } finally {
          clearInterval(keepAlive);
        }
      }
    }
  });
  require_background();
})();
