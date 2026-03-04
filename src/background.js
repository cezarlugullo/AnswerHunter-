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
import { GeminiCLIAuthService } from './services/GeminiCLIAuthService.js';
import { CopilotAuthService } from './services/CopilotAuthService.js';
import { SearchService } from './services/SearchService.js';
import { PerformanceTimer } from './utils/PerformanceTimer.js';
import { SearchCacheService } from './services/search/SearchCacheService.js';
import { BadgeService } from './services/BadgeService.js';
import { AnalyticsService } from './services/AnalyticsService.js';
import { ContentHierarchyService } from './services/ContentHierarchyService.js';

const CHATGPT_CALLBACK_PATTERN = 'http://localhost:1455/auth/callback';
const GEMINI_CLI_CALLBACK_PATTERN = 'http://localhost:11235/auth/callback';
const COPILOT_OAUTH_ALARM = 'copilot_oauth_poll_alarm';
const STUDY_REMINDER_ALARM = 'ah_study_reminder';
const DAILY_CLEANUP_ALARM = 'ah_daily_cleanup';

async function _isCopilotPendingOAuth() {
    return await new Promise(resolve => {
        chrome.storage.local.get([CopilotAuthService.PENDING_OAUTH_KEY], data => {
            const pending = data?.[CopilotAuthService.PENDING_OAUTH_KEY];
            resolve(!!(pending?.deviceCode && pending?.expiresAt && pending.expiresAt > Date.now()));
        });
    });
}

async function _syncCopilotPollingAlarm() {
    const hasPending = await _isCopilotPendingOAuth();
    if (hasPending) {
        chrome.alarms.create(COPILOT_OAUTH_ALARM, { periodInMinutes: 1 });
    } else {
        chrome.alarms.clear(COPILOT_OAUTH_ALARM);
    }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm?.name) return;

    // ─── Copilot OAuth polling ───────────────────────────────────────
    if (alarm.name === COPILOT_OAUTH_ALARM) {
        try {
            const result = await CopilotAuthService.checkPendingAuthorizationOnce();
            if (result.status === 'success' || result.status === 'expired' || result.status === 'denied' || result.status === 'none') {
                chrome.alarms.clear(COPILOT_OAUTH_ALARM);
            }
        } catch (err) {
            console.warn('CopilotAuth BG: alarm poll failed:', err?.message || err);
        }
        return;
    }

    // ─── Study Reminder ─────────────────────────────────────────────
    if (alarm.name === STUDY_REMINDER_ALARM) {
        try {
            const hierarchy = await ContentHierarchyService.getDisciplines();
            if (!hierarchy.length) return;
            const stats = await ContentHierarchyService.getGlobalStats();
            if (stats.due > 0) {
                chrome.notifications?.create('ah_study_reminder', {
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
 title:'AnswerHunter — Hora de estudar!',
                    message: `Você tem ${stats.due} card${stats.due > 1 ? 's' : ''} para revisar hoje.`,
                    priority: 1
                });
            }
            // Evaluate badges on reminder tick
            const xpData = await new Promise(r => chrome.storage.local.get(['ah_xpData'], d => r(d.ah_xpData || {})));
            const badgeStats = BadgeService.buildStats(hierarchy, xpData);
            const newBadges = await BadgeService.evaluate(badgeStats);
            for (const badge of newBadges) {
                chrome.notifications?.create(`ah_badge_${badge.id}`, {
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: `Badge Desbloqueado!`,
                    message: `${badge.name} — ${badge.desc}`,
                    priority: 2
                });
            }
        } catch (err) {
            console.warn('AnswerHunter BG: study reminder error:', err?.message || err);
        }
        return;
    }

    // ─── Daily Cleanup ──────────────────────────────────────────────
    if (alarm.name === DAILY_CLEANUP_ALARM) {
        try {
            await AnalyticsService.cleanup();
        } catch (_) {}
        return;
    }
});

chrome.runtime.onInstalled.addListener(() => {
    _syncCopilotPollingAlarm().catch(() => {});
    _clearStaleSearches().catch(() => {});
    SearchCacheService.loadAiResultCache().catch(() => {});
    // Study reminder every 6 hours
    chrome.alarms.create(STUDY_REMINDER_ALARM, { delayInMinutes: 360, periodInMinutes: 360 });
    // Daily cleanup at midnight-ish
    chrome.alarms.create(DAILY_CLEANUP_ALARM, { delayInMinutes: 1440, periodInMinutes: 1440 });
});

chrome.runtime.onStartup.addListener(() => {
    _syncCopilotPollingAlarm().catch(() => {});
    _clearStaleSearches().catch(() => {});
    SearchCacheService.loadAiResultCache().catch(() => {});
});

/**
 * Clears any background search entries stuck in 'running' state (service worker
 * was killed mid-search). Without this the popup poller loops forever on reload.
 */
async function _clearStaleSearches() {
    try {
        const all = await chrome.storage.local.get(null);
        const staleKeys = [];
        for (const [k, v] of Object.entries(all || {})) {
            if (k.startsWith('ah_bg_search_') && v?.state === 'running') {
                staleKeys.push(k);
                staleKeys.push(`${k}_status`);
            }
        }
        if (staleKeys.length) {
            await chrome.storage.local.remove(['ah_pending_search', ...staleKeys]);
            console.log(`AnswerHunter BG: cleared ${staleKeys.length} stale search entries`);
        }
    } catch (_) {}
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!Object.prototype.hasOwnProperty.call(changes, CopilotAuthService.PENDING_OAUTH_KEY)) return;
    _syncCopilotPollingAlarm().catch(() => {});
});

/**
 * Listen for tab URL changes to capture the OAuth callback.
 * This runs in the background even when the popup is closed.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!changeInfo.url) return;

    // ─── ChatGPT OAuth callback ──────────────────────────────────────
    if (changeInfo.url.startsWith(CHATGPT_CALLBACK_PATTERN)) {
        console.log('ChatGPTAuth BG: Captured OAuth callback!');
        try {
            const result = await ChatGPTAuthService.handleCallback(changeInfo.url);
            try { await chrome.tabs.remove(tabId); } catch (_) {}
            if (result.success) {
                console.log('ChatGPTAuth BG: Login successful!');
                try { await chrome.runtime.sendMessage({ type: 'CHATGPT_AUTH_SUCCESS', email: result.email }); } catch (_) {}
            } else {
                console.error('ChatGPTAuth BG: Login failed:', result.error);
                try { await chrome.runtime.sendMessage({ type: 'CHATGPT_AUTH_FAILED', error: result.error }); } catch (_) {}
            }
        } catch (err) {
            console.error('ChatGPTAuth BG: Callback handling error:', err);
        }
        return;
    }

    // ─── Gemini CLI OAuth callback ───────────────────────────────────
    if (changeInfo.url.startsWith(GEMINI_CLI_CALLBACK_PATTERN)) {
        console.log('GeminiCLIAuth BG: Captured OAuth callback!');
        try {
            const result = await GeminiCLIAuthService.handleCallback(changeInfo.url);
            try { await chrome.tabs.remove(tabId); } catch (_) {}
            if (result.success) {
                console.log('GeminiCLIAuth BG: Login successful!');
                try { await chrome.runtime.sendMessage({ type: 'GEMINI_CLI_AUTH_SUCCESS', email: result.email }); } catch (_) {}
            } else {
                console.error('GeminiCLIAuth BG: Login failed:', result.error);
                try { await chrome.runtime.sendMessage({ type: 'GEMINI_CLI_AUTH_FAILED', error: result.error }); } catch (_) {}
            }
        } catch (err) {
            console.error('GeminiCLIAuth BG: Callback handling error:', err);
        }
        return;
    }
});

// Keep the service worker alive briefly when auth is pending
chrome.storage.local.get(['chatgpt_pkce_pending', 'gemini_cli_pkce_pending'], (result) => {
    if (chrome.runtime.lastError) {
        console.warn('AnswerHunter BG: storage get failed:', chrome.runtime.lastError);
        return;
    }
    if (result?.chatgpt_pkce_pending) {
        console.log('ChatGPTAuth BG: PKCE session pending — monitoring tabs for callback');
    }
    if (result?.gemini_cli_pkce_pending) {
        console.log('GeminiCLIAuth BG: PKCE session pending — monitoring tabs for callback');
    }
});

_syncCopilotPollingAlarm().catch(() => {});
_clearStaleSearches().catch(() => {});
SearchCacheService.loadAiResultCache().catch(() => {});

// ─── Background Search Phase 2 ───────────────────────────────────────────────
// Receives { type: 'SEARCH_PHASE2', requestId, question, displayQuestion }
// Runs the slow network work (SearchService.searchOnly + refineFromResults)
// in the service worker so the search survives popup closure.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SEARCH_PHASE2') {
        _runPhase2Search(msg.requestId, msg.question, msg.displayQuestion).catch(console.error);
        sendResponse({ ack: true });
        return false;
    }

    return false;
});

async function _runPhase2Search(requestId, question, displayQuestion) {
    const key = `ah_bg_search_${requestId}`;
    // AH-PERF: Background search pipeline timer
    const _bgTimer = PerformanceTimer.create(' BG Phase2 Search Pipeline');

    // Ping a Chrome API every 20 s to prevent the MV3 service worker from being
    // terminated mid-search (Chrome's idle timer is ~30 s).
    // Safety: auto-clear after 4.5 min to prevent indefinite keep-alive if search hangs.
    const MAX_KEEPALIVE_MS = 4.5 * 60 * 1000;
    const keepAliveStart = Date.now();
    const keepAlive = setInterval(() => {
        if (Date.now() - keepAliveStart > MAX_KEEPALIVE_MS) {
            clearInterval(keepAlive);
            console.warn('AnswerHunter BG: keepAlive max duration reached, releasing service worker.');
            return;
        }
        chrome.runtime.getPlatformInfo(() => {});
    }, 20000);

    try {
        await chrome.storage.local.set({ [key]: { state: 'running', startedAt: Date.now() } });

        const searchResults = await SearchService.searchOnly(displayQuestion);
        _bgTimer.mark(`Serper searchOnly (${(searchResults||[]).length} results)`);

        if (!searchResults || searchResults.length === 0) {
            await chrome.storage.local.set({ [key]: { state: 'no_results', completedAt: Date.now() } });
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
                try { await chrome.storage.local.set({ [`${key}_status`]: message }); } catch (_) {}
            }
        );
        _bgTimer.mark(`refineFromResults (${(finalResults||[]).length} items)`);

        if (!finalResults || finalResults.length === 0) {
            await chrome.storage.local.set({ [key]: { state: 'no_results', completedAt: Date.now() } });
            return;
        }

        _bgTimer.summary();
        await chrome.storage.local.set({
            [key]: { state: 'done', results: finalResults, completedAt: Date.now() }
        });
    } catch (err) {
        console.error('AnswerHunter BG: Phase 2 search error:', err);
        try {
            await chrome.storage.local.set({
                [key]: { state: 'error', error: String(err?.message || err), completedAt: Date.now() }
            });
        } catch (_) {}
    } finally {
        clearInterval(keepAlive);
    }
}
