/**
 * SettingsModel
 * Centralizes extension settings, API keys, and language preferences.
 */
export const SettingsModel = {
    defaults: {
        language: '',
        groqApiKey: '',
        groqApiUrl: 'https://api.groq.com/openai/v1/chat/completions',
        // Fast model for simple tasks (1000 t/s): validation, extraction, parsing
        groqModelFast: 'openai/gpt-oss-20b',
        // Smart model for complex reasoning (280 t/s): inference, consensus, analysis
        groqModelSmart: 'llama-3.3-70b-versatile',
        // Most capable model for Google-like overview synthesis (tries this first)
        groqModelOverview: 'openai/gpt-oss-120b',
        groqModelVision: 'meta-llama/llama-4-scout-17b-16e-instruct',
        serperApiKey: '',
        serperApiUrl: 'https://google.serper.dev/search',
        geminiApiKey: '',
        geminiApiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        geminiModel: 'gemini-2.5-flash',
        geminiModelSmart: 'gemini-2.5-pro',
        primaryProvider: 'groq',
        setupCompleted: false,
        requiredProviders: {
            groq: true,
            serper: false,
            gemini: false
        },
        minGroqIntervalMs: 2500,
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

    /**
     * Returns settings merged with defaults.
     */
    async getSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['settings'], (result) => {
                const stored = result.settings || {};
                const merged = { ...this.defaults, ...stored };
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
            geminiKey: settings.geminiApiKey
        };
    }
};
