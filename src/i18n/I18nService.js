import { SUPPORTED_LANGUAGES, TRANSLATIONS } from './translations.js';
import { SettingsModel } from '../models/SettingsModel.js';

const DEFAULT_LANGUAGE = 'en';

export const I18nService = {
  language: DEFAULT_LANGUAGE,

  normalizeLanguage(language) {
    if (typeof language !== 'string') return DEFAULT_LANGUAGE;
    if (/^pt/i.test(language)) return 'pt-BR';
    return 'en';
  },

  resolveLanguage(candidate) {
    const normalized = this.normalizeLanguage(candidate);
    return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : DEFAULT_LANGUAGE;
  },

  async init() {
    const settings = await SettingsModel.getSettings();
    this.language = this.resolveLanguage(settings.language || navigator?.language || DEFAULT_LANGUAGE);
    this._exposeTranslator();
    return this.language;
  },

  async setLanguage(language) {
    const nextLanguage = this.resolveLanguage(language);
    this.language = nextLanguage;
    await SettingsModel.saveSettings({ language: nextLanguage });
    this._exposeTranslator();
    return nextLanguage;
  },

  getDictionary(language = this.language) {
    return TRANSLATIONS[this.resolveLanguage(language)] || TRANSLATIONS[DEFAULT_LANGUAGE];
  },

  t(key, variables = {}) {
    const dict = this.getDictionary(this.language);
    const fallback = TRANSLATIONS[DEFAULT_LANGUAGE][key] || key;
    const raw = dict[key] || fallback;

    if (typeof raw !== 'string') return String(raw ?? key);

    return raw.replace(/\{(\w+)\}/g, (_match, token) => {
      const value = variables[token];
      return value === undefined || value === null ? '' : String(value);
    });
  },

  apply(root = document) {
    if (!root) return;

    root.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      element.textContent = this.t(key);
    });

    root.querySelectorAll('[data-i18n-html]').forEach((element) => {
      const key = element.getAttribute('data-i18n-html');
      element.innerHTML = this.t(key);
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      const key = element.getAttribute('data-i18n-placeholder');
      element.setAttribute('placeholder', this.t(key));
    });

    root.querySelectorAll('[data-i18n-title]').forEach((element) => {
      const key = element.getAttribute('data-i18n-title');
      element.setAttribute('title', this.t(key));
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      const key = element.getAttribute('data-i18n-aria-label');
      element.setAttribute('aria-label', this.t(key));
    });

    const htmlElement = root.ownerDocument?.documentElement || document.documentElement;
    if (htmlElement) {
      htmlElement.lang = this.language === 'pt-BR' ? 'pt-BR' : 'en';
    }

    this._exposeTranslator();
  },

  _exposeTranslator() {
    try {
      window.__answerHunterTranslate = (key, variables) => this.t(key, variables);
    } catch (_) {
      // no-op
    }
  }
};
