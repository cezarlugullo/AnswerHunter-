/**
 * SettingsModel.js
 * Gerencia configurações globais, chaves de API e preferências do usuário.
 */
export const SettingsModel = {
    // Configurações Padrão
    defaults: {
        groqApiKey: '',
        groqApiUrl: 'https://api.groq.com/openai/v1/chat/completions',
        groqModelFast: 'llama-3.1-8b-instant',
        groqModelAnswer: 'llama-3.3-70b-versatile',
        groqModelFallback: 'llama-3.3-70b-versatile',
        serperApiKey: '',
        serperApiUrl: 'https://google.serper.dev/search',
        minGroqIntervalMs: 2500 // Cooldown alto para evitar 429
    },

    /**
     * Obtém todas as configurações, mesclando padrões com chrome.storage
     * @returns {Promise<Object>} Objeto com configurações
     */
    async getSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['settings'], (result) => {
                const stored = result.settings || {};
                resolve({ ...this.defaults, ...stored });
            });
        });
    },

    /**
     * Salva configurações no chrome.storage.sync
     * @param {Object} newSettings - Objeto parcial com novas configurações
     * @returns {Promise<void>}
     */
    async saveSettings(newSettings) {
        const current = await this.getSettings();
        const updated = { ...current, ...newSettings };
        return new Promise((resolve) => {
            chrome.storage.sync.set({ settings: updated }, () => {
                resolve();
            });
        });
    },

    /**
     * Obtém apenas as chaves de API
     * @returns {Promise<Object>} { groqKey, serperKey }
     */
    async getApiKeys() {
        const settings = await this.getSettings();
        return {
            groqKey: settings.groqApiKey,
            serperKey: settings.serperApiKey
        };
    }
};
