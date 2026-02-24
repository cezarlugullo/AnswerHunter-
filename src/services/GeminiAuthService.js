/**
 * GeminiAuthService.js
 *
 * Implements OAuth 2.0 PKCE authentication with Google, enabling users to
 * sign in with their Google account and use Gemini API without an API key.
 *
 * SECURITY MODEL (open-source safe):
 * - Uses PKCE (no client_secret needed in the code)
 * - All tokens (access_token, refresh_token) stored EXCLUSIVELY in chrome.storage.local
 * - Tokens sent only to Google's endpoints (accounts.google.com, oauth2.googleapis.com)
 * - client_id is stored locally (not hardcoded) — user sets it once in settings
 *
 * SETUP (one-time, for the user):
 * 1. Go to https://console.cloud.google.com/apis/credentials
 * 2. Create an OAuth 2.0 Client ID → type: "Web application"
 * 3. Enable the "Generative Language API" in the project
 * 4. Add Authorized Redirect URI: the value shown in the extension's settings
 *    (chrome.identity.getRedirectURL('gemini') — typically https://<extensionId>.chromiumapp.org/gemini)
 * 5. Copy the Client ID (NOT the secret) and paste it in the extension's settings
 */
export const GeminiAuthService = {

    // ─── Storage keys ───
    STORAGE_KEY: 'gemini_google_auth',
    PKCE_KEY: 'gemini_pkce_pending',
    CLIENT_ID_KEY: 'gemini_oauth_client_id',

    // ─── Google OAuth endpoints ───
    AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
    TOKEN_URL: 'https://oauth2.googleapis.com/token',
    REVOKE_URL: 'https://oauth2.googleapis.com/revoke',
    USERINFO_URL: 'https://www.googleapis.com/oauth2/v2/userinfo',
    SCOPES: 'openid email profile https://www.googleapis.com/auth/generativelanguage',

    // ─── Client ID management ───────────────────────────────────────────────

    async getClientId() {
        const result = await new Promise(resolve =>
            chrome.storage.local.get([this.CLIENT_ID_KEY], resolve)
        );
        return result[this.CLIENT_ID_KEY] || null;
    },

    async setClientId(id) {
        await new Promise(resolve =>
            chrome.storage.local.set({ [this.CLIENT_ID_KEY]: id.trim() }, resolve)
        );
    },

    /**
     * Returns the OAuth redirect URI for this extension.
     * This is the URI the user must add to their Google Cloud OAuth client.
     */
    getRedirectURL() {
        return chrome.identity.getRedirectURL('gemini');
    },

    // ─── PKCE helpers ───────────────────────────────────────────────────────

    async _generatePKCE() {
        const randomBytes = new Uint8Array(64);
        crypto.getRandomValues(randomBytes);
        const codeVerifier = this._base64UrlEncode(randomBytes);

        const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(codeVerifier)
        );
        const codeChallenge = this._base64UrlEncode(new Uint8Array(hashBuffer));

        return { codeVerifier, codeChallenge };
    },

    _base64UrlEncode(bytes) {
        return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    },

    // ─── Login flow ─────────────────────────────────────────────────────────

    /**
     * Start the Google OAuth2 PKCE login flow.
     * Opens a Google sign-in popup via chrome.identity.launchWebAuthFlow.
     * Returns { success, email } or { success: false, error }.
     */
    async startLogin() {
        const clientId = await this.getClientId();
        if (!clientId) {
            return {
                success: false,
                error: 'Google OAuth client_id não configurado. Veja as instruções de configuração.'
            };
        }

        const { codeVerifier, codeChallenge } = await this._generatePKCE();
        const stateBytes = new Uint8Array(32);
        crypto.getRandomValues(stateBytes);
        const state = this._base64UrlEncode(stateBytes);

        // Persist PKCE session for the callback
        await new Promise(resolve =>
            chrome.storage.local.set({
                [this.PKCE_KEY]: { codeVerifier, state, clientId, timestamp: Date.now() }
            }, resolve)
        );

        const redirectUri = this.getRedirectURL();
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: this.SCOPES,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            access_type: 'offline',
            prompt: 'consent'   // ensures refresh_token is returned every time
        });

        const authUrl = `${this.AUTH_URL}?${params.toString()}`;

        return new Promise(resolve => {
            chrome.identity.launchWebAuthFlow(
                { url: authUrl, interactive: true },
                async (responseUrl) => {
                    if (chrome.runtime.lastError || !responseUrl) {
                        await new Promise(r =>
                            chrome.storage.local.remove([this.PKCE_KEY], r)
                        );
                        const msg = chrome.runtime.lastError?.message || 'Login cancelado';
                        resolve({ success: false, error: msg });
                        return;
                    }
                    const result = await this._handleCallback(responseUrl);
                    resolve(result);
                }
            );
        });
    },

    /**
     * Handle the OAuth callback URL returned by launchWebAuthFlow.
     * Extracts the code, verifies state, and exchanges for tokens.
     */
    async _handleCallback(callbackUrl) {
        try {
            const url = new URL(callbackUrl);
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            if (error) {
                return { success: false, error: `Google OAuth error: ${error}` };
            }
            if (!code) {
                return { success: false, error: 'Sem código de autorização na resposta do Google' };
            }

            // Retrieve PKCE session
            const stored = await new Promise(resolve =>
                chrome.storage.local.get([this.PKCE_KEY], r => resolve(r[this.PKCE_KEY]))
            );

            if (!stored?.codeVerifier) {
                return { success: false, error: 'Sessão PKCE não encontrada' };
            }
            if (stored.state !== state) {
                return { success: false, error: 'State não corresponde — possível CSRF' };
            }
            if (Date.now() - stored.timestamp > 10 * 60 * 1000) {
                return { success: false, error: 'Sessão PKCE expirou (>10min)' };
            }

            // Exchange code for tokens
            const tokens = await this._exchangeCode(code, stored.codeVerifier, stored.clientId);
            if (!tokens?.access_token) {
                return { success: false, error: 'Falha na troca de código por tokens' };
            }

            // Fetch user info
            let email = null, name = null;
            try {
                const userResp = await fetch(this.USERINFO_URL, {
                    headers: { Authorization: `Bearer ${tokens.access_token}` }
                });
                if (userResp.ok) {
                    const info = await userResp.json();
                    email = info.email || null;
                    name = info.name || null;
                }
            } catch (_) { /* non-critical */ }

            const authData = {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || null,
                email,
                name,
                lastRefresh: Date.now(),
                expiresAt: tokens.expires_in
                    ? Date.now() + tokens.expires_in * 1000
                    : null
            };

            await new Promise(resolve =>
                chrome.storage.local.set({ [this.STORAGE_KEY]: authData }, resolve)
            );
            await new Promise(resolve =>
                chrome.storage.local.remove([this.PKCE_KEY], resolve)
            );

            console.log('GeminiAuth: Login successful! email:', email);
            return { success: true, email };

        } catch (err) {
            console.error('GeminiAuth: Callback error:', err);
            return { success: false, error: err.message || String(err) };
        }
    },

    /**
     * Exchange authorization code for tokens via Google's token endpoint.
     * PKCE allows this without a client_secret.
     */
    async _exchangeCode(code, codeVerifier, clientId) {
        try {
            const redirectUri = this.getRedirectURL();
            const response = await fetch(this.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: clientId,
                    code,
                    code_verifier: codeVerifier,
                    redirect_uri: redirectUri
                })
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.error(`GeminiAuth: Token exchange HTTP ${response.status}: ${errText.slice(0, 300)}`);
                return null;
            }

            return await response.json();
        } catch (err) {
            console.error('GeminiAuth: Token exchange error:', err);
            return null;
        }
    },

    // ─── Token management ───────────────────────────────────────────────────

    async getAuth() {
        return new Promise(resolve =>
            chrome.storage.local.get([this.STORAGE_KEY], r =>
                resolve(r[this.STORAGE_KEY] || null)
            )
        );
    },

    async isLoggedIn() {
        const auth = await this.getAuth();
        return !!(auth?.accessToken);
    },

    /**
     * Returns a valid access token, refreshing if necessary.
     */
    async getValidToken() {
        const auth = await this.getAuth();
        if (!auth?.accessToken) return null;

        // Refresh 5 minutes before expiry
        const nearExpiry = auth.expiresAt && (auth.expiresAt - Date.now() < 5 * 60 * 1000);
        if (nearExpiry && auth.refreshToken) {
            console.log('GeminiAuth: Token near expiry, refreshing...');
            const refreshed = await this.refreshToken();
            if (refreshed) {
                const updated = await this.getAuth();
                return updated?.accessToken || auth.accessToken;
            }
        }

        return auth.accessToken;
    },

    /**
     * Refresh the access token using the stored refresh_token.
     */
    async refreshToken() {
        const auth = await this.getAuth();
        const clientId = await this.getClientId();
        if (!auth?.refreshToken || !clientId) {
            console.warn('GeminiAuth: No refresh token or client_id available');
            return false;
        }

        try {
            const response = await fetch(this.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: clientId,
                    refresh_token: auth.refreshToken
                })
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.error(`GeminiAuth: Token refresh HTTP ${response.status}: ${errText.slice(0, 200)}`);
                if ([400, 401, 403].includes(response.status)) {
                    await this.logout();
                }
                return false;
            }

            const tokens = await response.json();
            const updated = {
                ...auth,
                accessToken: tokens.access_token || auth.accessToken,
                refreshToken: tokens.refresh_token || auth.refreshToken,
                expiresAt: tokens.expires_in
                    ? Date.now() + tokens.expires_in * 1000
                    : auth.expiresAt,
                lastRefresh: Date.now()
            };

            await new Promise(resolve =>
                chrome.storage.local.set({ [this.STORAGE_KEY]: updated }, resolve)
            );

            console.log('GeminiAuth: Token refreshed successfully');
            return true;
        } catch (err) {
            console.error('GeminiAuth: Token refresh error:', err);
            return false;
        }
    },

    /**
     * Revoke tokens and clear all stored auth data.
     */
    async logout() {
        const auth = await this.getAuth();
        if (auth?.accessToken) {
            // Fire-and-forget: revoke access token at Google
            fetch(`${this.REVOKE_URL}?token=${auth.accessToken}`, { method: 'POST' })
                .catch(() => { });
        }
        await new Promise(resolve =>
            chrome.storage.local.remove([this.STORAGE_KEY, this.PKCE_KEY], resolve)
        );
        console.log('GeminiAuth: Logged out');
    }
};
