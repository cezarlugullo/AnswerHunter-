/**
 * SettingsModel
 * Centralizes extension settings, API keys, and language preferences.
 */
export const SettingsModel = {
    defaults: {
        language: '',
        groqApiKey: '',
        groqApiUrl: 'https://api.groq.com/openai/v1/chat/completions',
        // Fast model for simple tasks: validation, extraction, parsing
        // llama-3.1-8b-instant: 14.4K RPD (vs 1K for 70b) — ideal for parallel page extraction
        groqModelFast: 'llama-3.1-8b-instant',
        // Smart model for complex reasoning (280 t/s): inference, consensus, analysis
        groqModelSmart: 'llama-3.3-70b-versatile',
        // Most capable model for Google-like overview synthesis (tries this first)
        groqModelOverview: 'openai/gpt-oss-120b',
        groqModelVision: 'meta-llama/llama-4-scout-17b-16e-instruct',
        serperApiKey: '',
        serperApiUrl: 'https://google.serper.dev/search',
        geminiApiKey: '',
        geminiApiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        geminiModel: 'gemini-3.5-flash',
        geminiModelSmart: 'gemini-3.5-flash',
        openrouterApiKey: '',
        openrouterModelSmart: 'openai/gpt-oss-120b:free',
        chatgptModel: 'gpt-5.5',
        copilotModel: 'claude-sonnet-4.6',
        firecrawlApiKey: '',
        primaryProvider: 'groq',
        setupCompleted: false,
        requiredProviders: {
            groq: true,
            serper: false,
            gemini: false
        },
        minGroqIntervalMs: 2500,
        minGeminiIntervalMs: 4200,
        consensusVotingEnabled: true, // Enable multi-attempt consensus
        consensusMinAttempts: 2, // Minimum attempts for consensus (2-3)
        consensusThreshold: 0.5 // Minimum vote ratio to accept (0.5 = 50%)
    },

    normalizeLanguage(language) {
        if (typeof language !== 'string') return 'en';
        return /^pt/i.test(language) ? 'pt-BR' : 'en';
    },

    getBrowserDefaultLanguage() {
        try {
            return this.normalizeLanguage(navigator?.language || 'en');
        } catch (_) {
            return 'en';
        }
    },

    isPresent(value) {
        return typeof value === 'string' && value.trim().length > 0;
    },

    normalizeRequiredProviders(requiredProviders = {}) {
        return {
            groq: requiredProviders.groq !== false,
            serper: requiredProviders.serper !== false,
            gemini: requiredProviders.gemini === true
        };
    },

    normalizeModelSettings(settings = {}) {
        const normalized = { ...settings };

        const geminiAliases = {
            'gemini-1.5-pro': 'gemini-3.5-flash',
            'gemini-2.0-flash': 'gemini-3.5-flash',
            'gemini-2.5-flash': 'gemini-3.5-flash',
            'gemini-2.5-pro': 'gemini-3.5-flash',
            'gemini-3-pro': 'gemini-3.5-flash',
            'gemini-3-flash-preview': 'gemini-3.5-flash',
            'gemini-3.1-pro-preview': 'gemini-3.5-flash',
            'gemini-3.1-flash-lite-preview': 'gemini-3.5-flash'
        };
        normalized.geminiModel = geminiAliases[normalized.geminiModel] || normalized.geminiModel || this.defaults.geminiModel;
        normalized.geminiModelSmart = geminiAliases[normalized.geminiModelSmart] || normalized.geminiModelSmart || this.defaults.geminiModelSmart;

        const openrouterAliases = {
            'deepseek/deepseek-r1:free': 'openai/gpt-oss-120b:free',
            'deepseek/deepseek-chat-v3-0324:free': 'openai/gpt-oss-120b:free',
            'deepseek/deepseek-chat-v3.1:free': 'openai/gpt-oss-120b:free',
            'google/gemini-2.5-flash:free': 'openai/gpt-oss-120b:free',
            'google/gemini-2.5-flash-free': 'openai/gpt-oss-120b:free',
            'qwen/qwen-2.5-coder-32b-instruct:free': 'qwen/qwen3-coder:free'
        };
        normalized.openrouterModelSmart = openrouterAliases[normalized.openrouterModelSmart]
            || normalized.openrouterModelSmart
            || this.defaults.openrouterModelSmart;

        const chatgptAliases = {
            'gpt-5.2': 'gpt-5.5',
            'gpt-5-mini': 'gpt-5.5'
        };
        normalized.chatgptModel = chatgptAliases[normalized.chatgptModel]
            || normalized.chatgptModel
            || this.defaults.chatgptModel;

        const copilotAliases = {
            'gpt-5-mini': 'gpt-5.4-mini',
            'gpt-4o': 'claude-sonnet-4.6',
            'gpt-4o-mini': 'gpt-5.4-mini',
            'claude-sonnet-5': 'claude-sonnet-4.6',
            'claude-opus-4.8': 'claude-opus-4.5',
            'claude-opus-4.7': 'claude-opus-4.5',
            'claude-opus-4.6': 'claude-opus-4.5'
        };
        normalized.copilotModel = copilotAliases[normalized.copilotModel]
            || normalized.copilotModel
            || this.defaults.copilotModel;

        return normalized;
    },

    getProviderReadiness(settings = {}) {
        const requiredProviders = this.normalizeRequiredProviders(
            settings.requiredProviders || this.defaults.requiredProviders
        );
        const missingRequired = [];
        const optionalMissing = [];

        if (requiredProviders.groq && !this.isPresent(settings.groqApiKey)) {
            missingRequired.push('groq');
        }
        if (requiredProviders.serper && !this.isPresent(settings.serperApiKey)) {
            missingRequired.push('serper');
        }
        if (requiredProviders.gemini && !this.isPresent(settings.geminiApiKey)) {
            missingRequired.push('gemini');
        } else if (!this.isPresent(settings.geminiApiKey)) {
            optionalMissing.push('gemini');
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

    // API key fields that must stay in local-only storage (never synced)
    _sensitiveKeys: [
        'groqApiKey', 'serperApiKey', 'geminiApiKey', 'openrouterApiKey',
        'groqApiUrl', 'serperApiUrl', 'geminiApiUrl'
    ],

    /**
     * One-time migration: move API keys from chrome.storage.sync to chrome.storage.local.
     * Safe to call repeatedly (no-op if already migrated).
     */
    async _migrateKeysToLocal() {
        try {
            const syncData = await new Promise(r => chrome.storage.sync.get(['settings'], r));
            const syncSettings = syncData?.settings;
            if (!syncSettings) return;

            const keysToMove = {};
            let hasKeys = false;
            for (const k of this._sensitiveKeys) {
                if (syncSettings[k] && typeof syncSettings[k] === 'string' && syncSettings[k].trim()) {
                    keysToMove[k] = syncSettings[k];
                    hasKeys = true;
                }
            }
            if (!hasKeys) return;

            // Write sensitive keys to local storage
            const localData = await new Promise(r => chrome.storage.local.get(['ah_settings_local'], r));
            const localSettings = localData?.ah_settings_local || {};
            const merged = { ...localSettings, ...keysToMove };
            await new Promise(r => chrome.storage.local.set({ ah_settings_local: merged }, r));

            // Remove sensitive keys from sync
            const cleanSync = { ...syncSettings };
            for (const k of this._sensitiveKeys) {
                delete cleanSync[k];
            }
            await new Promise(r => chrome.storage.sync.set({ settings: cleanSync }, r));
            console.log('[SettingsModel] Migrated API keys from sync to local storage.');
        } catch (e) {
            console.warn('[SettingsModel] Key migration error:', e?.message);
        }
    },

    /**
     * Returns settings merged with defaults.
     * Sensitive keys (API keys/URLs) are read from chrome.storage.local.
     * Non-sensitive settings are read from chrome.storage.sync.
     */
    async getSettings() {
        // Ensure one-time migration has run (set flag first to prevent races)
        if (!this._migrationDone) {
            this._migrationDone = true;
            try {
                await this._migrateKeysToLocal();
            } catch (e) {
                this._migrationDone = false;
                console.error('SettingsModel: migration failed, will retry:', e);
            }
        }

        const [syncResult, localResult] = await Promise.all([
            new Promise((resolve, reject) => chrome.storage.sync.get(['settings'], res => {
                if (chrome.runtime.lastError) {
                    console.error('SettingsModel: sync get failed:', chrome.runtime.lastError);
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(res);
            })),
            new Promise((resolve, reject) => chrome.storage.local.get(['ah_settings_local'], res => {
                if (chrome.runtime.lastError) {
                    console.error('SettingsModel: local get failed:', chrome.runtime.lastError);
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(res);
            }))
        ]);

        const syncSettings = syncResult?.settings || {};
        const localSettings = localResult?.ah_settings_local || {};
        const merged = this.normalizeModelSettings({ ...this.defaults, ...syncSettings, ...localSettings });

        // Hot-migrate old groqModelFast default
        if (merged.groqModelFast === 'openai/gpt-oss-20b') {
            merged.groqModelFast = 'llama-3.1-8b-instant';
        }

        merged.language = this.normalizeLanguage(merged.language || this.getBrowserDefaultLanguage());
        merged.requiredProviders = this.normalizeRequiredProviders(merged.requiredProviders);
        merged.setupCompleted = this.computeSetupCompleted(merged);
        return merged;
    },

    /**
     * Persists settings. Sensitive keys go to local, rest to sync.
     */
    async saveSettings(newSettings) {
        const current = await this.getSettings();
        const updated = this.normalizeModelSettings({ ...current, ...newSettings });
        updated.language = this.normalizeLanguage(updated.language || this.getBrowserDefaultLanguage());
        updated.requiredProviders = this.normalizeRequiredProviders(updated.requiredProviders);
        updated.setupCompleted = this.computeSetupCompleted(updated);

        // Split: sensitive keys → local, everything else → sync
        const localPart = {};
        const syncPart = { ...updated };
        for (const k of this._sensitiveKeys) {
            if (updated[k] !== undefined) {
                localPart[k] = updated[k];
            }
            delete syncPart[k];
        }

        const results = await Promise.all([
            new Promise((resolve, reject) => chrome.storage.sync.set({ settings: syncPart }, () => {
                if (chrome.runtime.lastError) {
                    console.error('SettingsModel: sync save failed:', chrome.runtime.lastError);
                    reject(new Error('sync save failed: ' + chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            })),
            new Promise((resolve, reject) => chrome.storage.local.set({ ah_settings_local: localPart }, () => {
                if (chrome.runtime.lastError) {
                    console.error('SettingsModel: local save failed:', chrome.runtime.lastError);
                    reject(new Error('local save failed: ' + chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            }))
        ]);
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
            openrouterKey: settings.openrouterApiKey,
            firecrawlKey: settings.firecrawlApiKey
        };
    }
};
