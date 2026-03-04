/**
 * CopilotAuthService.js
 *
 * Implements GitHub OAuth 2.0 Device Flow authentication, replicating the
 * authentication used by the GitHub Copilot CLI / VS Code extension.
 * This allows users to use their GitHub Copilot subscription credits
 * (Individual, Business, Enterprise) for AI-powered answers.
 *
 * AUTHENTICATION FLOW (Device Flow — RFC 8628):
 * 1. POST https://github.com/login/device/code → { device_code, user_code, verification_uri }
 * 2. User opens verification_uri and enters user_code
 * 3. Poll https://github.com/login/oauth/access_token until authorized
 * 4. Exchange GitHub token for Copilot token via /copilot_internal/v2/token
 * 5. Use Copilot token at https://api.githubcopilot.com/chat/completions
 *
 * SECURITY MODEL (open-source safe):
 * - CLIENT_ID is public (same as the VS Code GitHub Copilot extension)
 * - Device Flow does NOT use a client_secret — designed for public clients
 * - All tokens stored EXCLUSIVELY in chrome.storage.local on the user's device
 * - GitHub token only sent to GitHub's own endpoints
 * - Copilot token only sent to api.githubcopilot.com
 */
import { logHttpError } from '../utils/httpHelpers.js';

export const CopilotAuthService = {

    // ─── Public OAuth constants (GitHub Copilot VS Code extension) ───
    // This is the same client_id used by the official VS Code Copilot extension.
    // Device Flow OAuth does NOT require a client_secret.
    CLIENT_ID: 'Iv1.b507a08c87ecfe98',
    DEVICE_CODE_URL: 'https://github.com/login/device/code',
    TOKEN_URL: 'https://github.com/login/oauth/access_token',
    COPILOT_TOKEN_URL: 'https://api.github.com/copilot_internal/v2/token',
    USER_URL: 'https://api.github.com/user',

    // ─── Storage keys (chrome.storage.local only — never sync) ───
    STORAGE_KEY: 'copilot_auth',
    COPILOT_TOKEN_KEY: 'copilot_token',
    PENDING_OAUTH_KEY: 'copilot_oauth_pending',

    // ─── Polling state ───
    _polling: false,
    _pollAbort: null,

    /**
     * Start the Device Flow login.
     * Returns { user_code, verification_uri } so the UI can display them.
     * Starts polling in the background for authorization.
     *
     * @returns {Promise<{user_code: string, verification_uri: string}>}
     */
    async startLogin() {
        // Request device & user codes from GitHub
        const response = await fetch(this.DEVICE_CODE_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: this.CLIENT_ID,
                scope: 'read:user'
            })
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Device code request failed (HTTP ${response.status}): ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        const { device_code, user_code, verification_uri, expires_in, interval } = data;

        if (!device_code || !user_code) {
            throw new Error('Invalid device code response from GitHub');
        }

        await new Promise(resolve => {
            chrome.storage.local.set({
                [this.PENDING_OAUTH_KEY]: {
                    deviceCode: device_code,
                    intervalSec: interval || 5,
                    expiresAt: Date.now() + (expires_in || 900) * 1000
                }
            }, resolve);
        });

        // Start polling for authorization in the background
        this._startPolling(device_code, interval || 5, expires_in || 900);

        return { user_code, verification_uri: verification_uri || 'https://github.com/login/device' };
    },

    /**
     * Poll GitHub's token endpoint until the user authorizes or times out.
     */
    async _startPolling(deviceCode, intervalSec, expiresIn) {
        this._polling = true;
        const pollInterval = Math.max(intervalSec, 5) * 1000; // GitHub minimum is 5s
        const deadline = Date.now() + expiresIn * 1000;

        while (this._polling && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, pollInterval));

            if (!this._polling) break;

            try {
                const response = await fetch(this.TOKEN_URL, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        client_id: this.CLIENT_ID,
                        device_code: deviceCode,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                    })
                });

                const data = await response.json();

                if (data.access_token) {
                    // Success! User authorized
                    this._polling = false;
                    await this._clearPendingOAuth();
                    await this._completeLogin(data.access_token);
                    return;
                }

                if (data.error === 'authorization_pending') {
                    // User hasn't entered the code yet — keep polling
                    continue;
                }

                if (data.error === 'slow_down') {
                    // GitHub wants us to slow down — add 5s to interval
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }

                if (data.error === 'expired_token') {
                    this._polling = false;
                    await this._clearPendingOAuth();
                    console.warn('CopilotAuth: Device code expired');
                    this._notifyAuthResult(false, 'Device code expired. Please try again.');
                    return;
                }

                if (data.error === 'access_denied') {
                    this._polling = false;
                    await this._clearPendingOAuth();
                    console.warn('CopilotAuth: User denied access');
                    this._notifyAuthResult(false, 'Access denied by user.');
                    return;
                }

                // Unknown error
                console.warn('CopilotAuth: Polling error:', data.error, data.error_description);
            } catch (err) {
                console.warn('CopilotAuth: Polling fetch error:', err.message);
                // Network error — keep trying
            }
        }

        if (this._polling) {
            this._polling = false;
            await this._clearPendingOAuth();
            console.warn('CopilotAuth: Polling timed out');
            this._notifyAuthResult(false, 'Authentication timed out. Please try again.');
        }
    },

    async _clearPendingOAuth() {
        await new Promise(resolve => {
            chrome.storage.local.remove([this.PENDING_OAUTH_KEY], resolve);
        });
    },

    async checkPendingAuthorizationOnce() {
        const pending = await new Promise(resolve => {
            chrome.storage.local.get([this.PENDING_OAUTH_KEY], r => resolve(r[this.PENDING_OAUTH_KEY] || null));
        });

        if (!pending?.deviceCode) return { status: 'none' };

        if (!pending.expiresAt || pending.expiresAt <= Date.now()) {
            await this._clearPendingOAuth();
            return { status: 'expired' };
        }

        try {
            const response = await fetch(this.TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    client_id: this.CLIENT_ID,
                    device_code: pending.deviceCode,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                })
            });

            const data = await response.json();

            if (data.access_token) {
                await this._clearPendingOAuth();
                await this._completeLogin(data.access_token);
                return { status: 'success' };
            }

            if (data.error === 'authorization_pending' || data.error === 'slow_down') {
                return { status: 'pending' };
            }

            if (data.error === 'expired_token') {
                await this._clearPendingOAuth();
                return { status: 'expired' };
            }

            if (data.error === 'access_denied') {
                await this._clearPendingOAuth();
                return { status: 'denied' };
            }

            return { status: 'pending' };
        } catch (_) {
            return { status: 'pending' };
        }
    },

    /**
     * Complete login after receiving GitHub access token.
     * Fetches user info and Copilot token, then stores everything.
     */
    async _completeLogin(githubToken) {
        try {
            // Fetch GitHub user info
            let username = null, email = null;
            try {
                const resp = await fetch(this.USER_URL, {
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'Accept': 'application/json'
                    }
                });
                if (resp.ok) {
                    const user = await resp.json();
                    username = user.login || null;
                    email = user.email || null;
                }
            } catch (_) { /* non-critical */ }

            // Get initial Copilot token
            const copilotToken = await this._fetchCopilotToken(githubToken);
            if (!copilotToken) {
                this._notifyAuthResult(false, 'Failed to get Copilot token. Is Copilot enabled on your account?');
                return;
            }

            // Store auth data
            const authData = {
                githubToken,
                username,
                email,
                loginAt: Date.now()
            };

            await new Promise(resolve => {
                chrome.storage.local.set({
                    [this.STORAGE_KEY]: authData,
                    [this.COPILOT_TOKEN_KEY]: copilotToken
                }, resolve);
            });

            console.log(`CopilotAuth: Login successful! user=${username}, sku=${copilotToken.sku || 'unknown'}`);
            this._notifyAuthResult(true, null, username || email);
        } catch (err) {
            console.error('CopilotAuth: Complete login error:', err);
            this._notifyAuthResult(false, err.message || String(err));
        }
    },

    /**
     * Fetch a Copilot-specific token from GitHub.
     * This token is short-lived (~30 min) and must be refreshed.
     */
    async _fetchCopilotToken(githubToken) {
        try {
            const response = await fetch(this.COPILOT_TOKEN_URL, {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/json',
                    'Editor-Version': 'vscode/1.100.0',
                    'Editor-Plugin-Version': 'copilot/1.300.0',
                    'User-Agent': 'GithubCopilot/1.300.0'
                }
            });

            if (!response.ok) {
                await logHttpError(response, 'CopilotAuth: Copilot token', { logLevel: 'error' });
                return null;
            }

            const data = await response.json();
            if (!data.token) {
                console.error('CopilotAuth: No token in Copilot response');
                return null;
            }

            return {
                token: data.token,
                expiresAt: data.expires_at ? data.expires_at * 1000 : Date.now() + 30 * 60 * 1000,
                endpoints: data.endpoints || {},
                sku: data.sku || null,
                chatEnabled: data.chat_enabled !== false,
                fetchedAt: Date.now()
            };
        } catch (err) {
            console.error('CopilotAuth: Fetch Copilot token error:', err);
            return null;
        }
    },

    /**
     * Notify the popup about auth result via runtime message.
     */
    _notifyAuthResult(success, error = null, username = null) {
        try {
            chrome.runtime.sendMessage({
                type: success ? 'COPILOT_AUTH_SUCCESS' : 'COPILOT_AUTH_FAILED',
                username,
                error
            }).catch(() => {});
        } catch (_) { /* popup may be closed */ }
    },

    // ─── Token management ────────────────────────────────────────────────

    async getAuth() {
        return new Promise(resolve => {
            chrome.storage.local.get([this.STORAGE_KEY], result => {
                resolve(result[this.STORAGE_KEY] || null);
            });
        });
    },

    async isLoggedIn() {
        const auth = await this.getAuth();
        return !!(auth?.githubToken);
    },

    /**
     * Get a valid Copilot API token, refreshing if needed.
     * The Copilot token expires every ~30 minutes.
     *
     * @returns {Promise<string|null>} The Copilot API token, or null
     */
    async getValidToken() {
        const auth = await this.getAuth();
        if (!auth?.githubToken) return null;

        const stored = await new Promise(resolve => {
            chrome.storage.local.get([this.COPILOT_TOKEN_KEY], r => resolve(r[this.COPILOT_TOKEN_KEY]));
        });

        // Refresh 5 minutes before expiry
        const needsRefresh = !stored?.token ||
            !stored.expiresAt ||
            (stored.expiresAt - Date.now() < 5 * 60 * 1000);

        if (needsRefresh) {
            console.log('CopilotAuth: Copilot token expired/missing, refreshing...');
            const newToken = await this._fetchCopilotToken(auth.githubToken);
            if (!newToken) {
                console.warn('CopilotAuth: Failed to refresh Copilot token');
                return null;
            }
            await new Promise(resolve => {
                chrome.storage.local.set({ [this.COPILOT_TOKEN_KEY]: newToken }, resolve);
            });
            return newToken.token;
        }

        return stored.token;
    },

    /**
     * Get the API base URL from the Copilot token.
     */
    async getApiUrl() {
        const stored = await new Promise(resolve => {
            chrome.storage.local.get([this.COPILOT_TOKEN_KEY], r => resolve(r[this.COPILOT_TOKEN_KEY]));
        });
        return stored?.endpoints?.api || 'https://api.githubcopilot.com';
    },

    async logout() {
        this._polling = false;
        await this._clearPendingOAuth();
        // Revoke the GitHub token
        const auth = await this.getAuth();
        if (auth?.githubToken) {
            try {
                await fetch(`https://api.github.com/applications/${this.CLIENT_ID}/token`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `token ${auth.githubToken}`,
                        'Accept': 'application/json'
                    }
                });
            } catch (_) { /* best-effort revocation */ }
        }

        await new Promise(resolve => {
            chrome.storage.local.remove([this.STORAGE_KEY, this.COPILOT_TOKEN_KEY], resolve);
        });
        console.log('CopilotAuth: Logged out');
    },

    /**
     * Cancel active polling (e.g., user closed the auth panel).
     */

    /**
     * Inject a pre-existing GitHub OAuth token directly (bypasses Device Flow).
     * Useful for pre-configuring the extension with a known valid token.
     * After injection, getValidToken() handles auto-refresh automatically.
     *
     * @param {string} githubToken - GitHub OAuth token (ghu_ or gho_ prefix)
     * @param {string} username - GitHub username for display purposes
     * @returns {Promise<boolean>} true if injection succeeded
     */
    async injectPreAuthToken(githubToken, username = 'user') {
        if (!githubToken || (!githubToken.startsWith('ghu_') && !githubToken.startsWith('gho_'))) {
            console.warn('CopilotAuth: Invalid GitHub token format');
            return false;
        }

        try {
            // Save GitHub OAuth token (same format as _completeLogin)
            await new Promise(resolve => {
                chrome.storage.local.set({
                    [this.STORAGE_KEY]: { githubToken, username }
                }, resolve);
            });

            // Immediately fetch a Copilot token
            const copilotToken = await this._fetchCopilotToken(githubToken);
            if (!copilotToken) {
                console.warn('CopilotAuth: Token injection failed — Copilot not activated on this account');
                // Clean up
                await new Promise(resolve => chrome.storage.local.remove([this.STORAGE_KEY], resolve));
                return false;
            }

            // Save Copilot token
            await new Promise(resolve => {
                chrome.storage.local.set({ [this.COPILOT_TOKEN_KEY]: copilotToken }, resolve);
            });

            console.log(`CopilotAuth: Pre-auth token injected for ${username} (SKU: ${copilotToken.sku || 'unknown'})`);
            return true;
        } catch (err) {
            console.error('CopilotAuth: injectPreAuthToken error:', err);
            return false;
        }
    },

    cancelPolling() {
        this._polling = false;
    }
};
