/**
 * Background Service Worker
 * 
 * Monitors browser tabs for the OAuth callback from OpenAI's auth server.
 * When the user completes ChatGPT login, the browser redirects to
 * localhost:1455/auth/callback — this service worker captures that URL,
 * extracts the authorization code, exchanges it for tokens, and stores
 * them locally.
 * 
 * SECURITY: All tokens are stored in chrome.storage.local only.
 */

import { ChatGPTAuthService } from './services/ChatGPTAuthService.js';

const CALLBACK_PATTERN = 'http://localhost:1455/auth/callback';

/**
 * Listen for tab URL changes to capture the OAuth callback.
 * This runs in the background even when the popup is closed.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only check when the URL changes
    if (!changeInfo.url) return;

    // Check if this is the OAuth callback URL
    if (!changeInfo.url.startsWith(CALLBACK_PATTERN)) return;

    console.log('ChatGPTAuth BG: Captured OAuth callback!');

    try {
        // Handle the callback (exchange code for tokens)
        const result = await ChatGPTAuthService.handleCallback(changeInfo.url);

        if (result.success) {
            console.log('ChatGPTAuth BG: Login successful!');
            // Close the callback tab (it shows a "connection refused" error)
            try {
                await chrome.tabs.remove(tabId);
            } catch (_) {
                // Tab may already be closed
            }

            // Notify any open popup about the successful login
            try {
                await chrome.runtime.sendMessage({
                    type: 'CHATGPT_AUTH_SUCCESS',
                    email: result.email
                });
            } catch (_) {
                // Popup may not be open — that's fine, it'll check on next open
            }
        } else {
            console.error('ChatGPTAuth BG: Login failed:', result.error);
            // Still close the error tab
            try {
                await chrome.tabs.remove(tabId);
            } catch (_) { }

            try {
                await chrome.runtime.sendMessage({
                    type: 'CHATGPT_AUTH_FAILED',
                    error: result.error
                });
            } catch (_) { }
        }
    } catch (err) {
        console.error('ChatGPTAuth BG: Callback handling error:', err);
    }
});

// Keep the service worker alive briefly when auth is pending
chrome.storage.local.get(['chatgpt_pkce_pending'], (result) => {
    if (result.chatgpt_pkce_pending) {
        console.log('ChatGPTAuth BG: PKCE session pending — monitoring tabs for callback');
    }
});
