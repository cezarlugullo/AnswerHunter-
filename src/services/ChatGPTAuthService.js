/**
 * ChatGPTAuthService.js
 * 
 * Implements OAuth 2.0 PKCE authentication with OpenAI, replicating the
 * Codex CLI's "Sign in with ChatGPT" flow for Chrome extensions.
 * 
 * SECURITY MODEL (open-source safe):
 * - CLIENT_ID is public (same as the open-source Codex CLI repo: openai/codex)
 * - PKCE OAuth does NOT use a client_secret — it's designed for public clients
 * - All tokens (access_token, refresh_token, account_id) are stored EXCLUSIVELY
 *   in chrome.storage.local on the user's device — never synced or sent to third parties
 * - Tokens are only sent to OpenAI's own endpoints (auth.openai.com, chatgpt.com)
 */
export const ChatGPTAuthService = {

    // ─── Public OAuth constants (from openai/codex open-source repo) ───
    CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann',
    AUTH_URL: 'https://auth.openai.com/oauth/authorize',
    TOKEN_URL: 'https://auth.openai.com/oauth/token',
    REDIRECT_URI: 'http://localhost:1455/auth/callback',
    SCOPES: 'openid profile email offline_access',

    // ─── Storage keys (chrome.storage.local only — never sync) ───
    STORAGE_KEY: 'chatgpt_auth',
    PKCE_KEY: 'chatgpt_pkce_pending',

    /**
     * Generate PKCE code_verifier and code_challenge using Web Crypto API.
     * Matches the Codex CLI implementation (64 random bytes → base64url).
     */
    async generatePKCE() {
        // 64 random bytes → base64url-encode (no padding)
        const randomBytes = new Uint8Array(64);
        crypto.getRandomValues(randomBytes);
        const codeVerifier = this._base64UrlEncode(randomBytes);

        // SHA-256 hash of verifier → base64url-encode (no padding)
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
        const codeChallenge = this._base64UrlEncode(new Uint8Array(hashBuffer));

        return { codeVerifier, codeChallenge };
    },

    /**
     * Base64url encode (RFC 4648 §5) without padding — required for PKCE.
     */
    _base64UrlEncode(bytes) {
        const bin = Array.from(bytes, b => String.fromCharCode(b)).join('');
        return btoa(bin)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    },

    /**
     * Start the OAuth login flow.
     * Generates PKCE params, saves them, and opens the auth URL in a new tab.
     * The background service worker will monitor for the callback.
     */
    async startLogin() {
        const { codeVerifier, codeChallenge } = await this.generatePKCE();

        // Generate random state for CSRF protection
        const stateBytes = new Uint8Array(32);
        crypto.getRandomValues(stateBytes);
        const state = this._base64UrlEncode(stateBytes);

        // Store PKCE params for the callback handler
        await new Promise(resolve => {
            chrome.storage.local.set({
                [this.PKCE_KEY]: {
                    codeVerifier,
                    state,
                    timestamp: Date.now()
                }
            }, resolve);
        });

        // Build the authorization URL (same params as Codex CLI)
        const params = new URLSearchParams({
            client_id: this.CLIENT_ID,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            codex_cli_simplified_flow: 'true',
            id_token_add_organizations: 'true',
            originator: 'codex_cli_rs',
            redirect_uri: this.REDIRECT_URI,
            response_type: 'code',
            scope: this.SCOPES,
            state
        });

        const authUrl = `${this.AUTH_URL}?${params.toString()}`;

        // Open in a new tab — the service worker will catch the callback
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
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            if (error) {
                console.error('ChatGPTAuth: OAuth error:', error, url.searchParams.get('error_description'));
                return { success: false, error: `OAuth error: ${error}` };
            }

            if (!code) {
                return { success: false, error: 'No authorization code in callback' };
            }

            // Retrieve stored PKCE params
            const stored = await new Promise(resolve => {
                chrome.storage.local.get([this.PKCE_KEY], result => resolve(result[this.PKCE_KEY]));
            });

            if (!stored || !stored.codeVerifier) {
                return { success: false, error: 'No pending PKCE session found' };
            }

            // Verify state matches (CSRF protection)
            if (stored.state !== state) {
                return { success: false, error: 'State mismatch — possible CSRF attack' };
            }

            // Check if PKCE session is fresh (10 min max)
            if (Date.now() - stored.timestamp > 10 * 60 * 1000) {
                return { success: false, error: 'PKCE session expired (>10min)' };
            }

            // Exchange the code for tokens
            const tokens = await this._exchangeCode(code, stored.codeVerifier);
            if (!tokens) {
                return { success: false, error: 'Token exchange failed' };
            }

            // Parse the id_token JWT to extract account info
            const claims = this._parseJwt(tokens.id_token);
            const accountId = this._extractAccountId(claims);

            // Store auth data locally (NEVER synced)
            const authData = {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                idToken: tokens.id_token,
                accountId,
                email: claims?.email || claims?.['https://api.openai.com/profile']?.email || null,
                lastRefresh: Date.now(),
                expiresAt: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : null
            };

            await new Promise(resolve => {
                chrome.storage.local.set({ [this.STORAGE_KEY]: authData }, resolve);
            });

            // Clean up PKCE session
            await new Promise(resolve => {
                chrome.storage.local.remove([this.PKCE_KEY], resolve);
            });

            console.log('ChatGPTAuth: Login successful! account:', accountId, 'email:', authData.email);
            return { success: true, email: authData.email };

        } catch (err) {
            console.error('ChatGPTAuth: Callback handling error:', err);
            return { success: false, error: err.message || String(err) };
        }
    },

    /**
     * Exchange authorization code for tokens via POST to OpenAI token endpoint.
     */
    async _exchangeCode(code, codeVerifier) {
        try {
            const response = await fetch(this.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'authorization_code',
                    client_id: this.CLIENT_ID,
                    code,
                    code_verifier: codeVerifier,
                    redirect_uri: this.REDIRECT_URI
                })
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.error(`ChatGPTAuth: Token exchange HTTP ${response.status}: ${errText.slice(0, 300)}`);
                return null;
            }

            return await response.json();
        } catch (err) {
            console.error('ChatGPTAuth: Token exchange error:', err);
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
            console.warn('ChatGPTAuth: No refresh token available');
            return false;
        }

        try {
            const response = await fetch(this.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    client_id: this.CLIENT_ID,
                    refresh_token: auth.refreshToken
                })
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.error(`ChatGPTAuth: Token refresh HTTP ${response.status}: ${errText.slice(0, 300)}`);
                // If refresh failed permanently, clear auth
                if (response.status === 400 || response.status === 401 || response.status === 403) {
                    await this.logout();
                }
                return false;
            }

            const tokens = await response.json();

            // Update stored auth data
            const updated = {
                ...auth,
                accessToken: tokens.access_token || auth.accessToken,
                refreshToken: tokens.refresh_token || auth.refreshToken,
                idToken: tokens.id_token || auth.idToken,
                lastRefresh: Date.now(),
                expiresAt: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : auth.expiresAt
            };

            // Re-extract account_id from new id_token if available
            if (tokens.id_token) {
                const claims = this._parseJwt(tokens.id_token);
                const newAccountId = this._extractAccountId(claims);
                if (newAccountId) updated.accountId = newAccountId;
                if (claims?.email) updated.email = claims.email;
            }

            await new Promise(resolve => {
                chrome.storage.local.set({ [this.STORAGE_KEY]: updated }, resolve);
            });

            console.log('ChatGPTAuth: Token refreshed successfully');
            return true;
        } catch (err) {
            console.error('ChatGPTAuth: Token refresh error:', err);
            return false;
        }
    },

    /**
     * Get the current auth data from local storage.
     * Returns null if not authenticated.
     */
    async getAuth() {
        return new Promise(resolve => {
            chrome.storage.local.get([this.STORAGE_KEY], result => {
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

        // Token refresh interval: 8 minutes (same as Codex CLI)
        const TOKEN_REFRESH_INTERVAL_MS = 8 * 60 * 1000;
        const needsRefresh = auth.lastRefresh &&
            (Date.now() - auth.lastRefresh > TOKEN_REFRESH_INTERVAL_MS);

        if (needsRefresh && auth.refreshToken) {
            console.log('ChatGPTAuth: Token may be stale, refreshing...');
            const refreshed = await this.refreshToken();
            if (refreshed) {
                const updated = await this.getAuth();
                return updated?.accessToken || auth.accessToken;
            }
            // If refresh failed, still try with current token
        }

        return auth.accessToken;
    },

    /**
     * Logout — clear all stored auth data.
     */
    async logout() {
        await new Promise(resolve => {
            chrome.storage.local.remove([this.STORAGE_KEY, this.PKCE_KEY], resolve);
        });
        console.log('ChatGPTAuth: Logged out');
    },

    /**
     * Parse a JWT token and return the payload claims.
     * Does NOT verify the signature — we trust OpenAI's token endpoint.
     */
    _parseJwt(token) {
        try {
            if (!token) return null;
            const parts = token.split('.');
            if (parts.length < 2) return null;

            // Base64url decode the payload (2nd part)
            const payload = parts[1]
                .replace(/-/g, '+')
                .replace(/_/g, '/');
            const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
            const decoded = atob(padded);
            return JSON.parse(decoded);
        } catch (err) {
            console.warn('ChatGPTAuth: JWT parse error:', err);
            return null;
        }
    },

    /**
     * Extract the ChatGPT account ID from JWT claims.
     * The account_id is required for API calls to the Codex backend.
     */
    _extractAccountId(claims) {
        if (!claims) return null;

        // Try standard OpenAI auth claims
        const authClaims = claims['https://api.openai.com/auth'];
        if (authClaims) {
            // organizations array may contain the account ID
            if (Array.isArray(authClaims.organizations) && authClaims.organizations.length > 0) {
                // Use personal org or first org
                const personalOrg = authClaims.organizations.find(o =>
                    o.is_personal || o.role === 'owner'
                );
                const org = personalOrg || authClaims.organizations[0];
                if (org?.id) return org.id;
            }
            if (authClaims.user_id) return authClaims.user_id;
        }

        // Fallback to subject claim
        if (claims.sub) return claims.sub;

        return null;
    }
};
