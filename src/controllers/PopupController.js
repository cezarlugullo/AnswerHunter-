import { ExtractionService } from '../services/ExtractionService.js';
import { SearchService } from '../services/SearchService.js';
import { ApiService } from '../services/ApiService.js';
import { BinderController } from './BinderController.js';
import { StorageModel } from '../models/StorageModel.js';
import { SettingsModel } from '../models/SettingsModel.js';
import { I18nService } from '../i18n/I18nService.js';
import { isLikelyQuestion } from '../utils/helpers.js';

export const PopupController = {
  view: null,
  currentSetupStep: 1,
  onboardingFlags: { welcomed: false, setupDone: false },
  _isReopenMode: false,

  async init(view) {
    this.view = view;
    this.view.setTranslator((key, variables) => I18nService.t(key, variables));

    await I18nService.init();
    I18nService.apply(document);
    // Used by helpers.js to localize section headers when rendering HTML strings.
    window.__answerHunterTranslate = (key, variables) => I18nService.t(key, variables);

    BinderController.init(view);
    this.setupEventListeners();

    await StorageModel.init();
    await this.loadOnboardingFlags();
    await this.fillInputsFromSettings();
    await this.restoreDraftKeys();
    await this.syncLanguageSelector();
    await this.ensureSetupReady();
    await this.restoreLastResults({ clear: false });
  },

  setupEventListeners() {
    this.view.elements.settingsBtn?.addEventListener('click', () => this.toggleSetupPanel());
    // remove closeSetupBtn as we don't have a close button in full screen onboarding

    // New Onboarding Bindings
    this.view.elements.welcomeStartBtn?.addEventListener('click', () => this.handleWelcomeStart());

    // Slide Navigation
    this.view.elements.btnNextGroq?.addEventListener('click', () => this.goToSetupStep(2));
    this.view.elements.prevGroq?.addEventListener('click', () => this.goToSetupStep(0)); // Back to welcome?

    this.view.elements.btnNextSerper?.addEventListener('click', () => this.goToSetupStep(3));
    this.view.elements.prevSerper?.addEventListener('click', () => this.goToSetupStep(1));

    this.view.elements.prevGemini?.addEventListener('click', () => this.goToSetupStep(2));

    this.view.elements.btnNextGemini?.addEventListener('click', () => this.goToSetupStep(4));
    this.view.elements.prevPrefs?.addEventListener('click', () => this.goToSetupStep(3));

    this.view.elements.saveSetupBtn?.addEventListener('click', () => this.handleSaveSetup());
    this.view.elements.setupSkipBtn?.addEventListener('click', () => this.handleSaveSetup());

    // Bind main search provider setting
    this.view.elements.selectSearchProvider?.addEventListener('change', () => {
      this.applySearchProviderSelection(this.getSelectedSearchProvider(), {
        persistDraft: true,
        resetValidation: true
      });
    });


    // AI Provider & Model Config (Settings tab)
    this.view.elements.pillGroq?.addEventListener('click', () => { this.setProviderPill('groq'); this.syncObPills('groq'); });
    this.view.elements.pillGemini?.addEventListener('click', () => { this.setProviderPill('gemini'); this.syncObPills('gemini'); });

    // AI Provider Config (Onboarding Tab)
    this.view.elements.pillGroqOb?.addEventListener('click', () => { this.setProviderPill('groq'); this.syncObPills('groq'); });
    this.view.elements.pillGeminiOb?.addEventListener('click', () => { this.setProviderPill('gemini'); this.syncObPills('gemini'); });

    this.view.elements.selectGroqModel?.addEventListener('change', () => this.persistAiConfig());
    this.view.elements.selectGeminiModel?.addEventListener('change', () => this.persistAiConfig());

    this.view.elements.extractBtn?.addEventListener('click', () => this.handleExtract());
    this.view.elements.searchBtn?.addEventListener('click', () => this.handleSearch());
    this.view.elements.copyBtn?.addEventListener('click', () => this.handleCopyAll());
    this.view.elements.clearBinderBtn?.addEventListener('click', () => BinderController.handleClearAll());

    this.view.elements.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.view.switchTab(target);
        if (target === 'binder') {
          BinderController.renderBinder();
        }
      });
    });

    this.view.elements.resultsDiv?.addEventListener('click', (event) => this.handleResultClick(event));

    this.view.elements.languageToggle?.addEventListener('click', async (event) => {
      const btn = event.target.closest('.lang-btn');
      if (btn && btn.dataset.lang) {
        await this.handleLanguageChange(btn.dataset.lang);
      }
    });

    const bindProviderTestButton = (button, fallbackProvider = '') => {
      if (!button || button.dataset.testBound === '1') return;

      const providerCandidate = (button.dataset.provider || fallbackProvider || button.id?.replace(/^test-/, '') || '')
        .toLowerCase()
        .trim();

      if (!['groq', 'serper', 'gemini'].includes(providerCandidate)) return;

      button.dataset.testBound = '1';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        this.handleTestProvider(providerCandidate);
      });
    };

    bindProviderTestButton(this.view.elements.testGroq, 'groq');
    bindProviderTestButton(this.view.elements.testSerper, 'serper');
    bindProviderTestButton(this.view.elements.testGemini, 'gemini');

    // Backwards compatibility with old onboarding markup.
    document.querySelectorAll('.ob-btn-test, .test-btn').forEach((button) => {
      bindProviderTestButton(button);
    });

    document.querySelectorAll('.visibility-toggle').forEach((button) => {
      this.view.setupVisibilityToggle(button);
    });

    // Auto-paste detection
    [
      { input: this.view.elements.inputGroq, provider: 'groq', prefix: 'gsk_' },
      { input: this.view.elements.inputSerper, provider: 'serper', prefix: '' },
      { input: this.view.elements.inputGemini, provider: 'gemini', prefix: 'AIza' }
    ].forEach(({ input, provider, prefix }) => {
      if (!input) return;

      input.addEventListener('paste', () => {
        setTimeout(() => {
          this.saveDraftKeys();
          this.resetProviderValidation(provider);
          this.view.showPasteNotification(input);
          this.view.updateKeyFormatHint(provider, input.value, prefix);
        }, 50);
      });

      input.addEventListener('input', () => {
        this.saveDraftKeys();
        this.resetProviderValidation(provider);
        this.view.updateKeyFormatHint(provider, input.value,
          provider === 'groq' ? 'gsk_' : provider === 'gemini' ? 'AIza' : '');
      });
    });

    // Onboarding Language Toggle
    this.view.elements.obLanguageToggle?.addEventListener('click', async (event) => {
      const btn = event.target.closest('.ob-lang-btn');
      if (btn && btn.dataset.lang) {
        await this.handleLanguageChange(btn.dataset.lang);
      }
    });

    // Change Key Buttons (settings reopen mode)
    ['groq', 'serper', 'gemini'].forEach(provider => {
      const cap = provider.charAt(0).toUpperCase() + provider.slice(1);
      const changeBtn = this.view.elements[`changeKey${cap}`];
      if (changeBtn) {
        changeBtn.addEventListener('click', () => this.handleChangeKey(provider));
      }
      const closeBtn = this.view.elements[`closeSettings${cap}`];
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.handleCloseSettings());
      }
    });

    // Binder CTA: Go to Search
    this.view.elements.binderGoToSearch?.addEventListener('click', () => {
      this.view.switchTab('search');
    });
  },

  t(key, variables) {
    return I18nService.t(key, variables);
  },

  async syncLanguageSelector() {
    const settings = await SettingsModel.getSettings();
    this.view.setLanguageSelectValue(settings.language || 'en');
  },

  async handleLanguageChange(language) {
    await I18nService.setLanguage(language);
    I18nService.apply(document);
    await this.syncLanguageSelector();

    const currentTabIsBinder = document.querySelector('.tab-btn.active')?.dataset.tab === 'binder';
    if (currentTabIsBinder) {
      await BinderController.renderBinder();
      return;
    }

    await this.restoreLastResults({ clear: true });
  },

  async getProviderReadiness() {
    const settings = await SettingsModel.getSettings();
    return SettingsModel.getProviderReadiness(settings);
  },

  async ensureSetupReady() {
    const readiness = await this.getProviderReadiness();

    if (!readiness.ready) {
      this.view.setSettingsAttention(true);
      if (!this.onboardingFlags.welcomed) {
        this.view.showWelcomeOverlay(); // Will show step 0
      } else if (!this.onboardingFlags.setupDone) {
        this.toggleSetupPanel(true); // Will determine current step (1+)
      }
      return;
    }

    this.view.setSettingsAttention(false);
    this.onboardingFlags.setupDone = true;
    await this.saveOnboardingFlags();
  },

  async ensureReadyOrShowSetup() {
    const readiness = await this.getProviderReadiness();
    if (readiness.ready) return true;

    this.view.setSettingsAttention(true);
    this.view.showToast(this.t('setup.toast.required'), 'error');
    this.view.showStatus('error', this.t('setup.toast.required'));

    if (!this.onboardingFlags.welcomed) {
      this.view.showWelcomeOverlay();
    } else {
      this.toggleSetupPanel(true);
    }

    return false;
  },

  async fillInputsFromSettings() {
    const settings = await SettingsModel.getSettings();
    const keys = await SettingsModel.getApiKeys();

    if (this.view.elements.inputGroq) {
      this.view.elements.inputGroq.value = keys.groqKey || this.view.elements.inputGroq.value || '';
    }
    if (this.view.elements.inputSerper) {
      this.view.elements.inputSerper.value = keys.serperKey || this.view.elements.inputSerper.value || '';
    }
    if (this.view.elements.inputGemini) {
      this.view.elements.inputGemini.value = keys.geminiKey || this.view.elements.inputGemini.value || '';
    }

    this.applySearchProviderSelection(this.getSearchProviderFromUrl(settings.serperApiUrl), {
      persistDraft: false,
      resetValidation: false
    });

    // Restore AI provider & model config
    this.restoreAiConfig(settings);
  },

  /** Restore AI provider toggle and model selects from saved settings */
  restoreAiConfig(settings) {
    const provider = settings.primaryProvider || 'groq';
    // Set pill active state without saving
    const pills = [this.view.elements.pillGroq, this.view.elements.pillGemini];
    pills.forEach(p => p?.classList.remove('active'));
    if (provider === 'gemini') {
      this.view.elements.pillGemini?.classList.add('active');
    } else {
      this.view.elements.pillGroq?.classList.add('active');
    }
    this.updateProviderHint(provider);

    // Set model selects (settings panel only)
    const groqModel = settings.groqModelSmart || 'llama-3.3-70b-versatile';
    const geminiModel = settings.geminiModelSmart || 'gemini-2.5-pro';
    if (this.view.elements.selectGroqModel) {
      this.view.elements.selectGroqModel.value = groqModel;
    }
    if (this.view.elements.selectGeminiModel) {
      this.view.elements.selectGeminiModel.value = geminiModel;
    }
    this.syncObPills(provider);
  },

  syncObPills(provider) {
    const obPills = [this.view.elements.pillGroqOb, this.view.elements.pillGeminiOb];
    obPills.forEach(p => p?.classList.remove('active'));
    if (provider === 'gemini') {
      this.view.elements.pillGeminiOb?.classList.add('active');
    } else {
      this.view.elements.pillGroqOb?.classList.add('active');
    }
  },

  /** Handle provider pill click */
  setProviderPill(provider) {
    const pills = [this.view.elements.pillGroq, this.view.elements.pillGemini];
    pills.forEach(p => p?.classList.remove('active'));
    if (provider === 'gemini') {
      this.view.elements.pillGemini?.classList.add('active');
    } else {
      this.view.elements.pillGroq?.classList.add('active');
    }
    this.updateProviderHint(provider);
    this.persistAiConfig();
  },

  /** Update the hint text below the toggle */
  updateProviderHint(provider) {
    const hint = this.view.elements.providerHint;
    if (hint) {
      const key = provider === 'gemini'
        ? 'setup.aiConfig.hintGeminiPrimary'
        : 'setup.aiConfig.hintGroqPrimary';
      const text = this.view.t(key);
      if (text) {
        const textSpan = hint.querySelector('span:last-child') || hint;
        textSpan.textContent = text;
      }
    }
    // Also update the onboarding hint
    const obHint = document.getElementById('provider-hint-ob');
    if (obHint) {
      const key = provider === 'gemini'
        ? 'setup.prefs.hintGemini'
        : 'setup.prefs.hintGroq';
      obHint.textContent = this.view.t(key) || obHint.textContent;
    }
  },

  /** Persist the current AI config selections to storage */
  async persistAiConfig() {
    const isGemini = this.view.elements.pillGemini?.classList.contains('active')
      || this.view.elements.pillGeminiOb?.classList.contains('active');
    const primaryProvider = isGemini ? 'gemini' : 'groq';
    const groqModel = this.view.elements.selectGroqModel?.value || 'llama-3.3-70b-versatile';
    const geminiModel = this.view.elements.selectGeminiModel?.value || 'gemini-2.5-pro';

    await SettingsModel.saveSettings({ primaryProvider, groqModelSmart: groqModel, geminiModelSmart: geminiModel, geminiModel });
    console.log(`AnswerHunter: AI config saved — primary=${primaryProvider}, groq=${groqModel}, gemini=${geminiModel}`);
  },

  handleWelcomeStart() {
    this.view.hideWelcomeOverlay();
    this.onboardingFlags.welcomed = true;
    this.saveOnboardingFlags();
    this.goToSetupStep(1); // Move to Groq step
  },

  async toggleSetupPanel(forceState) {
    const isHidden = this.view.elements.onboardingView?.classList.contains('hidden');
    const shouldShow = forceState !== undefined ? forceState : isHidden;

    if (shouldShow) {
      // Determine if this is a "reopen" (user already completed setup)
      const isReopen = this.onboardingFlags.setupDone;
      this._isReopenMode = isReopen;

      this.view.setSetupVisible(true);
      const startStep = isReopen ? 4 : await this.determineCurrentStep();

      if (isReopen) {
        // Show reopen UX: key status chips, change-key buttons, close-settings buttons
        this.view.setSettingsReopenMode(true);
        const settings = await SettingsModel.getSettings();
        this.view.showKeyStatus('groq', SettingsModel.isPresent(settings.groqApiKey));
        this.view.showKeyStatus('serper', SettingsModel.isPresent(settings.serperApiKey));
        this.view.showKeyStatus('gemini', SettingsModel.isPresent(settings.geminiApiKey));
      } else {
        this.view.setSettingsReopenMode(false);
      }

      this.goToSetupStep(startStep);
      return;
    }

    this._isReopenMode = false;
    this.view.setSettingsReopenMode(false);
    this.view.setSetupVisible(false);
  },

  async determineCurrentStep() {
    const settings = await SettingsModel.getSettings();
    if (!SettingsModel.isPresent(settings.groqApiKey)) return 1;
    if (!SettingsModel.isPresent(settings.serperApiKey)) return 2;
    return 3;
  },

  goToSetupStep(step) {
    let normalizedStep = Number(step);
    if (normalizedStep < 0) normalizedStep = 0;
    if (normalizedStep > 4) normalizedStep = 4;

    this.currentSetupStep = normalizedStep;
    this.view.showSetupStep(normalizedStep);
    if (normalizedStep === 3) {
      // Gemini is optional; allow continuing to preferences without validation.
      this.view.enableNextButton('gemini');
    }
    // this.updateStepperState(); // Not needed in new design or handled by view logic
  },

  async updateStepperState() {
    // No-op for new design
  },

  resetProviderValidation(provider) {
    this.view.setTestButtonLoading(provider, '');
    this.view.setSetupStatus(provider, '');
    const inputName = `input${provider.charAt(0).toUpperCase() + provider.slice(1)}`;
    const input = this.view.elements[inputName];
    if (input) input.classList.remove('input-valid');
    if (provider === 'groq') {
      this.view.disableNextButton(provider);
    }
  },

  async handleTestProvider(provider) {
    const inputName = `input${provider.charAt(0).toUpperCase() + provider.slice(1)}`;
    const input = this.view.elements[inputName];
    const key = input?.value?.trim();

    if (!key) {
      this.view.setSetupStatus(provider, this.t('setup.status.empty'), 'fail');
      this.view.showToast(this.t('setup.toast.pasteKey'), 'warning');
      return;
    }

    this.view.setTestButtonLoading(provider, 'loading');
    this.view.setSetupStatus(provider, this.t('setup.status.testing'), 'loading');

    try {
      let ok = false;
      if (provider === 'groq') ok = await this.testGroqKey(key);
      if (provider === 'serper') ok = await this.testSerperKey(key);
      if (provider === 'gemini') ok = await this.testGeminiKey(key);

      if (ok) {
        this.view.setTestButtonLoading(provider, 'ok');
        this.view.setSetupStatus(provider, this.t('setup.status.ok'), 'ok');
        const providerLabel = provider === 'serper'
          ? this.t(this.getSelectedSearchProvider() === 'serpapi' ? 'provider.serpapi' : 'provider.serper')
          : provider.charAt(0).toUpperCase() + provider.slice(1);
        this.view.showToast(this.t('setup.toast.connectionOk', { provider: providerLabel }), 'success');
        input.classList.add('input-valid');
        await this.updateStepperState();

        // Auto-advance to next step after successful test
        // Auto-advance
        if (this.currentSetupStep < 4) {
          this.view.showAutoAdvance(() => {
            // In new design, user clicks Next, but we can auto-enable
            // view.enableNextButton(provider) is called by view.setTestButtonLoading
          });
        }
      } else {
        this.view.setTestButtonLoading(provider, 'fail');
        this.view.setSetupStatus(provider, this.t('setup.status.error'), 'fail');
        this.view.showToast(this.t('setup.toast.invalidKey'), 'error');
        input.classList.remove('input-valid');
      }
    } catch (error) {
      console.error(`Provider test error (${provider}):`, error);
      this.view.setTestButtonLoading(provider, 'fail');
      this.view.setSetupStatus(provider, `${this.t('setup.status.error')} ${error.message || ''}`.trim(), 'fail');
      this.view.showToast(this.t('setup.toast.testError'), 'error');
      input.classList.remove('input-valid');
    }
  },

  // handleSkipStep removed/merged into handleSaveSetup

  async testGroqKey(key) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` }
      });
      return response.ok;
    } catch (_) {
      return false;
    }
  },

  async testSerperKey(key) {
    try {
      const provider = this.getSelectedSearchProvider();
      const providerConfig = this.getSearchProviderConfig(provider);
      let response;

      if (provider === 'serpapi') {
        const url = new URL(providerConfig.apiUrl);
        url.searchParams.set('engine', 'google');
        url.searchParams.set('q', 'api health check');
        url.searchParams.set('num', '1');
        url.searchParams.set('hl', 'pt-br');
        url.searchParams.set('gl', 'br');
        url.searchParams.set('output', 'json');
        url.searchParams.set('api_key', key);
        response = await fetch(url.toString(), { method: 'GET' });
      } else {
        response = await fetch(providerConfig.apiUrl, {
          method: 'POST',
          headers: {
            'X-API-KEY': key,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ q: 'api health check', num: 1 })
        });
      }
      return response.ok;
    } catch (_) {
      return false;
    }
  },

  async testGeminiKey(key) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      return response.ok;
    } catch (_) {
      return false;
    }
  },

  /**
   * Handle "Change this key" button click in settings reopen mode.
   * Reveals the input card, hides the key status chip, focuses the input.
   */
  handleChangeKey(provider) {
    const cap = provider.charAt(0).toUpperCase() + provider.slice(1);
    // Hide the key status chip
    this.view.hideKeyStatus(provider);
    // Show the key card (ensure it's visible)
    const keyCard = this.view.elements[`input${cap}`]?.closest('.ob-key-card');
    if (keyCard) keyCard.style.display = '';
    // Focus the input
    const input = this.view.elements[`input${cap}`];
    if (input) {
      input.type = 'text'; // Show the key
      input.focus();
      input.select();
    }
    // Hide the change-key button itself
    const changeBtn = this.view.elements[`changeKey${cap}`];
    if (changeBtn) changeBtn.classList.add('hidden');
  },

  /**
   * Handle "Close settings" button click. Closes the onboarding panel.
   */
  handleCloseSettings() {
    this._isReopenMode = false;
    this.view.setSettingsReopenMode(false);
    this.view.setSetupVisible(false);
  },

  async handleSaveSetup() {
    const groqApiKey = this.sanitizeKey(this.view.elements.inputGroq?.value);
    const serperApiKey = this.sanitizeKey(this.view.elements.inputSerper?.value);
    const geminiApiKey = this.sanitizeKey(this.view.elements.inputGemini?.value);
    const providerConfig = this.getSearchProviderConfig(this.getSelectedSearchProvider());

    if (!groqApiKey) {
      this.view.showToast(this.t('setup.toast.required'), 'error');
      return;
    }

    try {
      await SettingsModel.saveSettings({
        groqApiKey,
        serperApiKey,
        serperApiUrl: providerConfig.apiUrl,
        geminiApiKey,
        requiredProviders: {
          groq: true,
          serper: false,
          gemini: false
        }
      });

      this.onboardingFlags.setupDone = true;
      this.onboardingFlags.welcomed = true;

      await this.saveOnboardingFlags();
      await this.clearDraftKeys();

      this.view.setSettingsAttention(false);
      this.view.setSetupVisible(false);
      this.view.showToast(this.t('setup.toast.saved'), 'success');
      this.view.showConfetti();
      await this.updateStepperState();
    } catch (error) {
      console.error('Save setup error:', error);
      this.view.showToast(`Save error: ${error.message}`, 'error');
    }
  },

  sanitizeKey(value) {
    return (value || '').trim();
  },

  async saveDraftKeys() {
    try {
      const payload = {
        groq: this.view.elements.inputGroq?.value || '',
        serper: this.view.elements.inputSerper?.value || '',
        gemini: this.view.elements.inputGemini?.value || '',
        searchProvider: this.getSelectedSearchProvider()
      };
      await chrome.storage.local.set({ _draftApiKeys: payload });
    } catch (error) {
      console.warn('Could not persist draft keys:', error);
    }
  },

  async restoreDraftKeys() {
    try {
      const data = await chrome.storage.local.get(['_draftApiKeys']);
      const drafts = data?._draftApiKeys;
      if (!drafts) return;

      if (this.view.elements.inputGroq && !this.view.elements.inputGroq.value && drafts.groq) {
        this.view.elements.inputGroq.value = drafts.groq;
      }

      if (this.view.elements.inputSerper && !this.view.elements.inputSerper.value && drafts.serper) {
        this.view.elements.inputSerper.value = drafts.serper;
      }

      if (this.view.elements.inputGemini && !this.view.elements.inputGemini.value && drafts.gemini) {
        this.view.elements.inputGemini.value = drafts.gemini;
      }
      if (drafts.searchProvider) {
        this.applySearchProviderSelection(drafts.searchProvider, {
          persistDraft: false,
          resetValidation: false
        });
      }
    } catch (error) {
      console.warn('Could not restore draft keys:', error);
    }
  },

  async clearDraftKeys() {
    try {
      await chrome.storage.local.remove(['_draftApiKeys']);
    } catch (error) {
      console.warn('Could not clear draft keys:', error);
    }
  },

  getSearchProviderFromUrl(url) {
    return /serpapi\.com\//i.test(String(url || '')) ? 'serpapi' : 'serper';
  },

  getSearchProviderConfig(provider) {
    if (provider === 'serpapi') {
      return {
        provider: 'serpapi',
        apiUrl: 'https://serpapi.com/search.json',
        siteUrl: 'https://serpapi.com/'
      };
    }

    return {
      provider: 'serper',
      apiUrl: 'https://google.serper.dev/search',
      siteUrl: 'https://serper.dev/'
    };
  },

  getSelectedSearchProvider() {
    const selected = this.view.elements.selectSearchProvider?.value;
    return selected === 'serpapi' ? 'serpapi' : 'serper';
  },

  applySearchProviderSelection(provider, options = {}) {
    const { persistDraft = false, resetValidation = false } = options;
    const normalizedProvider = provider === 'serpapi' ? 'serpapi' : 'serper';
    const config = this.getSearchProviderConfig(normalizedProvider);

    if (this.view.elements.selectSearchProvider) {
      this.view.elements.selectSearchProvider.value = normalizedProvider;
    }

    if (this.view.elements.linkSearchProvider) {
      this.view.elements.linkSearchProvider.href = config.siteUrl;
    }

    if (resetValidation) {
      this.resetProviderValidation('serper');
    }

    if (persistDraft) {
      this.saveDraftKeys();
    }
  },

  async loadOnboardingFlags() {
    try {
      const data = await chrome.storage.local.get(['_onboardingFlags']);
      if (data?._onboardingFlags) {
        this.onboardingFlags = { ...this.onboardingFlags, ...data._onboardingFlags };
      }
    } catch (error) {
      console.warn('Could not load onboarding flags:', error);
    }
  },

  async saveOnboardingFlags() {
    try {
      await chrome.storage.local.set({ _onboardingFlags: this.onboardingFlags });
    } catch (error) {
      console.warn('Could not save onboarding flags:', error);
    }
  },

  async handleExtract() {
    if (!(await this.ensureReadyOrShowSetup())) return;

    this.view.showStatus('loading', this.t('status.extractingContent'));
    this.view.setButtonDisabled('extractBtn', true);
    this.view.setButtonDisabled('copyBtn', true);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
        this.view.showStatus('error', this.t('status.restrictedPage'));
        return;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: ExtractionService.extractQAContentScript
      });

      const extractedItems = results?.[0]?.result || [];
      if (extractedItems.length === 0) {
        this.view.showStatus('error', this.t('status.noQuestionFound'));
        return;
      }

      this.view.showStatus('loading', this.t('status.refiningWithAi'));
      this.view.clearResults();

      const refined = await SearchService.processExtractedItems(extractedItems);
      if (refined.length === 0) {
        this.view.showStatus('error', this.t('status.noValidQuestion'));
        return;
      }

      const withSaved = refined.map((item) => ({
        ...item,
        saved: StorageModel.isSaved(item.question)
      }));

      this.view.appendResults(withSaved);
      await this.saveLastResults(withSaved);
      this.view.showStatus('success', this.t('status.questionsFound', { count: refined.length }));
      this.view.toggleViewSection('view-search');
      this.view.setButtonDisabled('copyBtn', false);
    } catch (error) {
      console.error('Extract flow error:', error);
      const message = error?.message === 'SETUP_REQUIRED'
        ? this.t('setup.toast.required')
        : this.t('status.extractError', { message: error.message || 'unknown' });
      this.view.showStatus('error', message);
      if (error?.message === 'SETUP_REQUIRED') {
        this.toggleSetupPanel(true);
      }
    } finally {
      this.view.setButtonDisabled('extractBtn', false);
    }
  },

  async handleSearch() {
    if (!(await this.ensureReadyOrShowSetup())) return;

    this.view.showStatus('loading', this.t('status.gettingQuestion'));
    this.view.setButtonDisabled('searchBtn', true);
    this.view.setButtonDisabled('copyBtn', true);
    this.view.clearResults();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
        this.view.showStatus('error', this.t('status.restrictedPage'));
        return;
      }

      const extractionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        function: ExtractionService.extractQuestionOnlyScript
      });

      const countDistinctOptions = (text) => {
        if (!text) return 0;
        const matches = text.match(/(?:^|\n)\s*["'â€œâ€â€˜â€™]?\s*([A-E])\s*[\)\.\-:]\s*\S/gi) || [];
        const letters = new Set(matches.map(m => m.trim().charAt(0).toUpperCase()));
        return letters.size;
      };

      const isValidOptionLine = (line) => {
        const m = String(line || '').trim().match(/^([A-E])\s*[\)\.\-:]\s*(.+)$/i);
        if (!m) return false;
        const body = String(m[2] || '').replace(/\s+/g, ' ').trim();
        if (!body || body.length < 8) return false;
        if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(body)) return false;
        if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(body)) return false;
        if (/^(?:resposta|gabarito|alternativa\s+correta)\b/i.test(body)) return false;
        return true;
      };

      const looksLikeCodeOptionBody = (body) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?/i.test(String(body || ''));
      const normalizeOptionBody = (body) => String(body || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/^[a-e]\s*[\)\.\-:]\s*/i, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      const optionTokens = (body) => normalizeOptionBody(body)
        .split(/\s+/)
        .filter((t) => t.length >= 4);
      const buildOptionsProfile = (text) => {
        const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const entries = [];
        const letters = new Set();
        const tokenSet = new Set();
        const re = /^["']?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
        for (const line of lines) {
          const m = line.match(re);
          if (!m) continue;
          const letter = (m[1] || '').toUpperCase();
          const body = String(m[2] || '').replace(/\s+/g, ' ').trim();
          if (!isValidOptionLine(`${letter}) ${body}`)) continue;
          entries.push({ letter, body, codeLike: looksLikeCodeOptionBody(body) });
          letters.add(letter);
          optionTokens(body).forEach((t) => tokenSet.add(t));
        }
        const codeCount = entries.filter((e) => e.codeLike).length;
        const codeRatio = entries.length > 0 ? (codeCount / entries.length) : 0;
        return { entries, letters, tokenSet, codeCount, codeRatio };
      };

      let bestQuestion = '';
      let bestScore = -1;
      let bestFrameIndex = -1;
      const frameDiagnostics = [];
      (extractionResults || []).forEach((frameResult) => {
        const text = String(frameResult?.result || '');
        if (text.length < 5) return;

        const optCount = countDistinctOptions(text);
        const isLikely = isLikelyQuestion(text);
        const likelyQuestionBonus = isLikely ? 250 : 0;
        const lengthScore = Math.min(text.length, 3500) / 10;
        const score = (optCount * 1000) + likelyQuestionBonus + lengthScore;

        frameDiagnostics.push({
          frameIndex: Number(frameResult?.frameId ?? frameDiagnostics.length),
          textLength: text.length,
          optCount,
          isLikely,
          score,
          preview: text.replace(/\s+/g, ' ').trim().slice(0, 120)
        });

        if (score > bestScore) {
          bestScore = score;
          bestQuestion = text;
          bestFrameIndex = Number(frameResult?.frameId ?? bestFrameIndex);
        }
      });

      if (frameDiagnostics.length > 0) {
        console.group('AnswerHunter: Frame extraction diagnostics');
        frameDiagnostics
          .sort((a, b) => b.score - a.score)
          .forEach((d, idx) => {
            const tag = idx === 0 ? 'WINNER' : 'CANDIDATE';
            console.log(
              `[${tag}] frame=${d.frameIndex} score=${d.score.toFixed(1)} optCount=${d.optCount} likely=${d.isLikely} len=${d.textLength} preview="${d.preview}"`
            );
          });
        console.log(`AnswerHunter: selected frame=${bestFrameIndex} bestScore=${bestScore.toFixed(1)}`);
        console.groupEnd();
      }

      // ── Vision OCR priority ──
      // OCR runs only when DOM extraction is insufficient (< 4 options or short text).
      // When DOM already captured a complete question, skip OCR entirely to save time.
      const domQuestion = bestQuestion;
      const domOptionCount = countDistinctOptions(domQuestion);
      let usedVisionOcr = false;
      let ocrVisionText = null; // Store OCR text for option fallback

      const domIsSufficient = domOptionCount >= 4 && (domQuestion || '').length >= 100 && isLikelyQuestion(domQuestion);
      console.log(`AnswerHunter: OCR_PRIORITY mode=conditional frame=${bestFrameIndex} dom_len=${(domQuestion || '').length} opts_dom=${domOptionCount} dom_sufficient=${domIsSufficient}`);

      if (domIsSufficient) {
        console.log('AnswerHunter: OCR_PRIORITY decision=skipped (DOM already sufficient)');
      } else {
        this.view.showStatus('loading', this.t('status.visionOcr') || 'Capturando tela para OCR visual...');

        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });
          if (dataUrl) {
            const base64 = dataUrl.split(',')[1];
            if (base64) {
              const visionText = await ApiService.extractTextFromScreenshot(base64);
              if (visionText && visionText.length >= 30) {
                const visionOpts = countDistinctOptions(visionText);
                const domOptCount = domOptionCount;
                console.log(`AnswerHunter: OCR_COMPARE opts_ocr=${visionOpts} opts_dom=${domOptCount} len_ocr=${visionText.length} len_dom=${(domQuestion || '').length}`);
                console.log(`AnswerHunter: Vision OCR returned ${visionText.length} chars, ${visionOpts} options`);

                bestQuestion = visionText;
                usedVisionOcr = true;
                ocrVisionText = visionText; // Preserve OCR text even if DOM wins

                // If DOM is clearly better in structural completeness, keep DOM.
                // HOWEVER: if OCR found significantly more options (2+ advantage), OCR always wins
                // because longer DOM text without options leads to cross-frame option contamination.
                const domIsLikely = isLikelyQuestion(domQuestion);
                const ocrHasOptionAdvantage = visionOpts >= domOptCount + 2;
                const domClearlyBetter = domQuestion
                  && !ocrHasOptionAdvantage
                  && (domOptCount >= Math.max(4, visionOpts + 2) || (domQuestion.length > visionText.length * 1.8 && domIsLikely));

                if (domClearlyBetter) {
                  bestQuestion = domQuestion;
                  usedVisionOcr = false;
                  console.log('AnswerHunter: DOM extraction retained (clearly more complete than OCR)');
                  console.log('AnswerHunter: OCR_PRIORITY decision=dom');
                } else {
                  console.log('AnswerHunter: Using Vision OCR result as primary statement');
                  console.log('AnswerHunter: OCR_PRIORITY decision=ocr');
                }
              } else {
                console.log('AnswerHunter: Vision OCR returned insufficient text, keeping DOM result');
                console.log('AnswerHunter: OCR_PRIORITY decision=dom_insufficient_ocr');
              }
            }
          }
        } catch (visionErr) {
          console.warn('AnswerHunter: Vision OCR capture failed:', visionErr.message || visionErr);
          console.log('AnswerHunter: OCR_PRIORITY decision=dom_capture_failed');
        }
      } // end else (domIsSufficient)

      if (!bestQuestion || bestQuestion.length < 5) {
        this.view.showStatus('error', this.t('status.selectQuestionText'));
        return;
      }

      // â”€â”€ Multi-question isolation â”€â”€
      // When the page shows multiple numbered questions (e.g. EstÃ¡cio "ConteÃºdo" pages),
      // the extractor may return all of them. Detect this and keep only the one
      // whose number is most centered in the viewport.
      const multiQRe = /(?:^|\n)\s*(\d+)[\.\)]\s+\S/g;
      const qNumbers = [];
      let qm;
      while ((qm = multiQRe.exec(bestQuestion)) !== null) {
        qNumbers.push({ num: parseInt(qm[1], 10), index: qm.index });
      }

      if (qNumbers.length >= 2) {
        console.log(`AnswerHunter: Multi-question text detected (questions ${qNumbers.map(q => q.num).join(', ')}). Isolating viewport question...`);
        try {
          const [viewportResult] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: () => {
              const viewportCenter = window.innerHeight / 2;
              let bestNum = -1;
              let bestDist = Infinity;
              document.querySelectorAll('p, div, li, span, h1, h2, h3, h4, h5, h6, td').forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width < 100 || rect.height < 10) return;
                if (rect.bottom < 0 || rect.top > window.innerHeight) return;
                const text = (el.innerText || '').trim();
                const m = text.match(/^\s*(\d+)[\.\)]\s+/);
                if (!m || text.length < 30) return;
                const centerY = rect.top + rect.height / 2;
                const dist = Math.abs(centerY - viewportCenter);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestNum = parseInt(m[1], 10);
                }
              });
              return bestNum;
            }
          });

          const targetQNum = viewportResult?.result;
          if (targetQNum && targetQNum > 0) {
            const targetIdx = qNumbers.findIndex(q => q.num === targetQNum);
            if (targetIdx >= 0) {
              const startIdx = qNumbers[targetIdx].index;
              const endIdx = targetIdx + 1 < qNumbers.length
                ? qNumbers[targetIdx + 1].index
                : bestQuestion.length;
              const isolated = bestQuestion.substring(startIdx, endIdx).trim();
              if (isolated.length >= 30) {
                console.log(`AnswerHunter: Isolated question ${targetQNum} (was extracting from question ${qNumbers[0].num})`);
                bestQuestion = isolated;
              }
            }
          }
        } catch (isoErr) {
          console.warn('AnswerHunter: Multi-question isolation failed, using full text:', isoErr);
        }
      }

      if (!isLikelyQuestion(bestQuestion)) {
        console.log('AnswerHunter: bestQuestion (raw, pre-options) â†’', bestQuestion.substring(0, 200));
        this.view.showStatus('loading', this.t('status.validatingQuestion'));
        const valid = await ApiService.validateQuestion(bestQuestion);
        if (!valid) {
          this.view.showStatus('error', this.t('status.invalidQuestion'));
          return;
        }
      }

      // â”€â”€ Normalize inline options to separate lines â”€â”€
      // The DOM sometimes delivers all options on a single line (no newlines between a), b), etc.).
      // countDistinctOptions only detects options preceded by ^ or \n, so inline options go undetected.
      // When this happens, extractOptionsOnlyScript runs and contaminates with options from OTHER
      // questions on the same page, causing stale A-D options from a previous question to persist.
      {
        const _inlineOptsRe = /\b([a-eA-E])\s*[\)\.\-:]\s*\S/g;
        const _inlineLetters = new Set();
        let _im;
        while ((_im = _inlineOptsRe.exec(bestQuestion)) !== null) {
          _inlineLetters.add(_im[1].toUpperCase());
        }
        const inlineDetected = _inlineLetters.size;
        const lineDetected = countDistinctOptions(bestQuestion);
        if (inlineDetected >= 3 && lineDetected < inlineDetected) {
          bestQuestion = bestQuestion.replace(/(\S)\s+([a-eA-E]\s*[\)\.\-:]\s)/g, '$1\n$2');
          console.log(`AnswerHunter: INLINE_OPTIONS_SPLIT inline=${inlineDetected} wasOnLines=${lineDetected} nowOnLines=${countDistinctOptions(bestQuestion)}`);
        }
      }

      let displayQuestion = bestQuestion;
      const existingOptionCount = countDistinctOptions(bestQuestion);

      // Always try to extract options separately when we have fewer than 5,
      // so we don't miss any alternatives (e.g. option E on a different DOM element).
      if (usedVisionOcr || existingOptionCount < 5) {
        if (usedVisionOcr) {
          console.log(`AnswerHunter: OCR_PRIORITY post-step=dom_options_scan force=true opts_current=${existingOptionCount}`);
        }
        let optionsResults = [];

        // First, try extracting options from the SAME frame selected for the question text.
        // This avoids mixing alternatives from another frame/question.
        if (Number.isFinite(bestFrameIndex) && bestFrameIndex >= 0) {
          try {
            optionsResults = await chrome.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [bestFrameIndex] },
              function: ExtractionService.extractOptionsOnlyScript
            });
          } catch (_) {
            optionsResults = [];
          }
        }

        const pickBestOptionsText = (resultsArray) => {
          let bestText = '';
          let bestLocalScore = -1;
          (resultsArray || []).forEach((frameResult) => {
            const text = String(frameResult?.result || '');
            if (text.length < 10) return;
            const optCount = countDistinctOptions(text);
            if (optCount < 2) return;
            const localScore = (optCount * 1000) + Math.min(text.length, 2500) / 10;
            if (localScore > bestLocalScore) {
              bestLocalScore = localScore;
              bestText = text;
            }
          });
          return bestText;
        };

        let optionsText = pickBestOptionsText(optionsResults);

        // HTML-anchored extraction:
        // Use OCR/DOM text as anchor tokens to locate the active question block in DOM,
        // then extract options from FULL HTML text (not only current viewport).
        const anchorSeedText = ocrVisionText || domQuestion || bestQuestion;
        const existingOptionsProfile = buildOptionsProfile(bestQuestion);
        const preferCodeLikeOptions =
          existingOptionsProfile.entries.length >= 3 &&
          existingOptionsProfile.codeRatio >= 0.66;

        if (Number.isFinite(bestFrameIndex) && bestFrameIndex >= 0 && anchorSeedText) {
          try {
            const [anchoredResult] = await chrome.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [bestFrameIndex] },
              function: (anchorText, preferCode) => {
                const normalize = (s) => String(s || '')
                  .toLowerCase()
                  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                  .replace(/[^a-z0-9]+/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();

                const isCodeLike = (body) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?/i.test(String(body || ''));

                const extractOptionLines = (rawText) => {
                  if (!rawText) return [];
                  const normalized = String(rawText)
                    .replace(/\r/g, '\n')
                    .replace(/(\S)\s+([A-Ea-e]\s*[\)\.\-:]\s+)/g, '$1\n$2');
                  const lines = normalized.split(/\n+/).map((l) => l.trim()).filter(Boolean);
                  const out = [];
                  const seen = new Set();
                  const startRe = /^["']?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
                  let current = null;

                  const flush = () => {
                    if (!current) return;
                    const letter = (current.letter || '').toUpperCase();
                    const body = String(current.body || '').replace(/\s+/g, ' ').trim();
                    if (!/^[A-E]$/.test(letter)) {
                      current = null;
                      return;
                    }
                    if (!body || body.length < 8 || seen.has(letter)) {
                      current = null;
                      return;
                    }
                    seen.add(letter);
                    out.push(`${letter}) ${body}`);
                    current = null;
                  };

                  for (const line of lines) {
                    const m = line.match(startRe);
                    if (m) {
                      flush();
                      current = { letter: m[1], body: m[2] };
                      continue;
                    }
                    if (current && !/^\d+\s*[\)\.\-:]/.test(line) && !/^(?:quest[aã]o|aula)\b/i.test(line)) {
                      current.body = `${current.body} ${line}`.replace(/\s+/g, ' ').trim();
                    }
                  }
                  flush();
                  return out.slice(0, 5);
                };

                const stop = new Set([
                  'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'questao',
                  'considere', 'tabela', 'dados', 'produto', 'produtos', 'registro', 'registros',
                  'para', 'com', 'sem', 'dos', 'das', 'uma', 'de', 'da', 'do', 'e', 'o', 'a',
                  'os', 'as', 'no', 'na', 'em', 'por', 'ou', 'ao', 'aos'
                ]);

                const anchorTokens = normalize(anchorText)
                  .split(' ')
                  .filter((t) => t.length >= 4 && !stop.has(t))
                  .slice(0, 16);
                if (anchorTokens.length < 4) return '';

                const containers = Array.from(document.querySelectorAll('section, article, main, form, div, [data-section], [data-testid]'));
                let best = { score: -1, options: [] };

                for (const el of containers) {
                  const raw = String(el?.innerText || '').replace(/\r/g, '\n').trim();
                  if (!raw || raw.length < 140 || raw.length > 140000) continue;
                  const norm = normalize(raw);
                  if (!norm) continue;

                  let hits = 0;
                  for (const tk of anchorTokens) if (norm.includes(tk)) hits += 1;
                  if (hits < 4) continue;

                  const extracted = extractOptionLines(raw);
                  if (extracted.length < 2) continue;

                  const codeCount = extracted.filter((line) => {
                    const m = String(line || '').match(/^([A-E])\s*[\)\.\-:]\s*(.+)$/i);
                    return m ? isCodeLike(m[2]) : false;
                  }).length;
                  const codeBonus = preferCode ? (codeCount >= Math.max(2, extracted.length - 1) ? 60 : -50) : 0;

                  const score = (hits * 16) + (extracted.length * 38) + codeBonus - Math.min(30, Math.abs(raw.length - 7000) / 300);
                  if (score > best.score) best = { score, options: extracted };
                }

                return best.options.length >= 2 ? best.options.join('\n') : '';
              },
              args: [anchorSeedText, preferCodeLikeOptions]
            });

            const anchoredText = String(anchoredResult?.result || '');
            const anchoredCount = countDistinctOptions(anchoredText);
            const currentCount = countDistinctOptions(optionsText || '');
            if (anchoredCount >= 2 && anchoredCount > currentCount) {
              optionsText = anchoredText;
              console.log(`AnswerHunter: HTML_ANCHORED_OPTIONS used=${anchoredCount} (replaced previous=${currentCount})`);
            } else if (anchoredCount >= 2) {
              console.log(`AnswerHunter: HTML_ANCHORED_OPTIONS found=${anchoredCount} (kept current=${currentCount})`);
            }
          } catch (anchErr) {
            console.warn('AnswerHunter: HTML anchored options extraction failed:', anchErr?.message || anchErr);
          }
        }

        // Auto-scroll fallback (same frame):
        // Some platforms lazy-render alternatives D/E only after scrolling.
        // This pass scrolls programmatically, captures options, and restores scroll position.
        if (Number.isFinite(bestFrameIndex) && bestFrameIndex >= 0 && countDistinctOptions(optionsText || '') < 5) {
          try {
            const [scannedResult] = await chrome.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [bestFrameIndex] },
              function: async (anchorText, preferCode) => {
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                const normalize = (s) => String(s || '')
                  .toLowerCase()
                  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                  .replace(/[^a-z0-9]+/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                const isCodeLike = (body) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?/i.test(String(body || ''));

                const stop = new Set([
                  'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'questao',
                  'considere', 'tabela', 'dados', 'produto', 'produtos', 'registro', 'registros',
                  'para', 'com', 'sem', 'dos', 'das', 'uma', 'de', 'da', 'do', 'e', 'o', 'a',
                  'os', 'as', 'no', 'na', 'em', 'por', 'ou', 'ao', 'aos'
                ]);

                const anchorTokens = normalize(anchorText)
                  .split(' ')
                  .filter((t) => t.length >= 4 && !stop.has(t))
                  .slice(0, 18);
                if (anchorTokens.length < 4) return '';

                const extractOptionLines = (rawText) => {
                  if (!rawText) return [];
                  const normalized = String(rawText)
                    .replace(/\r/g, '\n')
                    .replace(/(\S)\s+([A-Ea-e]\s*[\)\.\-:]\s+)/g, '$1\n$2');
                  const lines = normalized.split(/\n+/).map((l) => l.trim()).filter(Boolean);
                  const out = [];
                  const seen = new Set();
                  const startRe = /^["']?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
                  let current = null;

                  const flush = () => {
                    if (!current) return;
                    const letter = (current.letter || '').toUpperCase();
                    const body = String(current.body || '').replace(/\s+/g, ' ').trim();
                    if (!/^[A-E]$/.test(letter)) {
                      current = null;
                      return;
                    }
                    if (!body || body.length < 8 || seen.has(letter)) {
                      current = null;
                      return;
                    }
                    seen.add(letter);
                    out.push(`${letter}) ${body}`);
                    current = null;
                  };

                  for (const line of lines) {
                    const m = line.match(startRe);
                    if (m) {
                      flush();
                      current = { letter: m[1], body: m[2] };
                      continue;
                    }
                    if (current && !/^\d+\s*[\)\.\-:]/.test(line) && !/^(?:quest[aã]o|aula)\b/i.test(line)) {
                      current.body = `${current.body} ${line}`.replace(/\s+/g, ' ').trim();
                    }
                  }
                  flush();
                  return out.slice(0, 5);
                };

                const pickBestOptions = () => {
                  const containers = Array.from(document.querySelectorAll('section, article, main, form, div, [data-section], [data-testid]'));
                  let best = { score: -1, options: [] };
                  for (const el of containers) {
                    const raw = String(el?.innerText || '').replace(/\r/g, '\n').trim();
                    if (!raw || raw.length < 140 || raw.length > 160000) continue;
                    const norm = normalize(raw);
                    if (!norm) continue;

                    let hits = 0;
                    for (const tk of anchorTokens) if (norm.includes(tk)) hits += 1;
                    if (hits < 4) continue;

                    const extracted = extractOptionLines(raw);
                    if (extracted.length < 2) continue;

                    const codeCount = extracted.filter((line) => {
                      const m = String(line || '').match(/^([A-E])\s*[\)\.\-:]\s*(.+)$/i);
                      return m ? isCodeLike(m[2]) : false;
                    }).length;
                    const codeBonus = preferCode ? (codeCount >= Math.max(2, extracted.length - 1) ? 60 : -50) : 0;

                    const score = (hits * 16) + (extracted.length * 38) + codeBonus - Math.min(40, Math.abs(raw.length - 7000) / 300);
                    if (score > best.score) best = { score, options: extracted };
                  }
                  return best.options;
                };

                const mergeByLetter = (targetMap, lines) => {
                  for (const line of lines || []) {
                    const m = String(line || '').match(/^([A-E])\s*[\)\.\-:]\s*(.+)$/i);
                    if (!m) continue;
                    const letter = m[1].toUpperCase();
                    const body = String(m[2] || '').replace(/\s+/g, ' ').trim();
                    if (!body || targetMap.has(letter)) continue;
                    targetMap.set(letter, body);
                    if (targetMap.size >= 5) break;
                  }
                };

                const centerEl = document.elementFromPoint(Math.floor(window.innerWidth * 0.5), Math.floor(window.innerHeight * 0.5));
                const findScrollableParent = (startEl) => {
                  let el = startEl;
                  while (el && el !== document.body && el !== document.documentElement) {
                    const style = window.getComputedStyle(el);
                    const canScroll = /(auto|scroll)/i.test(`${style.overflowY} ${style.overflow}`);
                    if (canScroll && el.scrollHeight - el.clientHeight > 140) return el;
                    el = el.parentElement;
                  }
                  return document.scrollingElement || document.documentElement || document.body;
                };

                const scrollEl = findScrollableParent(centerEl);
                const startTop = Number(scrollEl.scrollTop || 0);
                const maxTop = Math.max(0, (scrollEl.scrollHeight || 0) - (scrollEl.clientHeight || window.innerHeight));
                const merged = new Map();

                try {
                  for (let step = 0; step < 8; step += 1) {
                    mergeByLetter(merged, pickBestOptions());
                    if (merged.size >= 5) break;
                    const currentTop = Number(scrollEl.scrollTop || 0);
                    if (currentTop >= maxTop - 2) break;
                    const delta = Math.max(180, Math.floor((scrollEl.clientHeight || window.innerHeight) * 0.78));
                    const nextTop = Math.min(maxTop, currentTop + delta);
                    if (nextTop <= currentTop + 1) break;
                    scrollEl.scrollTop = nextTop;
                    await sleep(180);
                  }
                } finally {
                  scrollEl.scrollTop = startTop;
                }

                if (merged.size < 2) return '';
                const order = ['A', 'B', 'C', 'D', 'E'];
                const out = [];
                for (const letter of order) {
                  if (!merged.has(letter)) continue;
                  out.push(`${letter}) ${merged.get(letter)}`);
                }
                return out.join('\n');
              },
              args: [anchorSeedText, preferCodeLikeOptions]
            });

            const scannedText = String(scannedResult?.result || '');
            const scannedCount = countDistinctOptions(scannedText);
            const currentCount = countDistinctOptions(optionsText || '');
            if (scannedCount >= 2 && scannedCount > currentCount) {
              optionsText = scannedText;
              console.log(`AnswerHunter: AUTO_SCROLL_OPTIONS used=${scannedCount} (replaced previous=${currentCount})`);
            } else if (scannedCount >= 2) {
              console.log(`AnswerHunter: AUTO_SCROLL_OPTIONS found=${scannedCount} (kept current=${currentCount})`);
            }
          } catch (scrollErr) {
            console.warn('AnswerHunter: Auto-scroll options scan failed:', scrollErr?.message || scrollErr);
          }
        }

        // Fallback priority: OCR stored options â†’ allFrames (last resort).
        // allFrames can pick up options from OTHER questions (cross-frame contamination),
        // so we prefer OCR options when available.
        if (!optionsText && ocrVisionText) {
          // Extract option lines from OCR text
          const ocrOptLines = ocrVisionText.split('\n').filter(line =>
            isValidOptionLine(line)
          );
          if (ocrOptLines.length >= 2) {
            optionsText = ocrOptLines.join('\n');
            console.log(`AnswerHunter: OCR_OPTIONS_FALLBACK used=${ocrOptLines.length} options from stored OCR text`);
          }
        }
        if (!optionsText) {
          optionsResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            function: ExtractionService.extractOptionsOnlyScript
          });
          optionsText = pickBestOptionsText(optionsResults);
          if (optionsText) {
            console.log('AnswerHunter: OCR_OPTIONS_FALLBACK used=allFrames (last resort)');
          }
        }

        if (optionsText && optionsText.length > 10) {
          if (existingOptionCount < 2) {
            // No real options in question text â€” just append all
            displayQuestion = `${bestQuestion}\n${optionsText}`;
          } else {
            let processedQuestion = bestQuestion;
            const domOptsCount = countDistinctOptions(optionsText);

            if (usedVisionOcr && domOptsCount >= 2) {
              const domLines = optionsText.split('\n').filter(line => isValidOptionLine(line));
              const domLetters = new Map();

              domLines.forEach(line => {
                const match = line.trim().match(/^([A-E])\s*[\)\.\-:]/i);
                if (match) {
                  domLetters.set(match[1].toUpperCase(), line.trim());
                }
              });

              if (domLetters.size > 0) {
                const lines = processedQuestion.split('\n');
                let replacedCount = 0;

                for (let i = 0; i < lines.length; i++) {
                  const match = lines[i].trim().match(/^([A-E])\s*[\)\.\-:]/i);
                  // Ensure we are operating on a line treated as an option
                  if (match && isValidOptionLine(lines[i])) {
                    const letter = match[1].toUpperCase();
                    if (domLetters.has(letter)) {
                      lines[i] = domLetters.get(letter);
                      domLetters.delete(letter);
                      replacedCount++;
                    }
                  }
                }

                processedQuestion = lines.join('\n');

                if (domLetters.size > 0) {
                  processedQuestion = `${processedQuestion}\n${Array.from(domLetters.values()).join('\n')}`;
                }

                displayQuestion = processedQuestion;
                console.log(`AnswerHunter: OVERWROTE ${replacedCount} OCR option(s) with precise DOM options; Added ${domLetters.size} missing DOM option(s)`);
                console.log(`AnswerHunter: OCR_DOM_REPLACE opts_before=${existingOptionCount} opts_after=${countDistinctOptions(displayQuestion)}`);
              }
            } else {
              // Merge only MISSING options to avoid duplicates
              const existingProfile = buildOptionsProfile(bestQuestion);
              const existingLetters = existingProfile.letters;
              const codeDominant = existingProfile.entries.length >= 3 && existingProfile.codeRatio >= 0.66;
              const newLines = optionsText.split('\n').filter(line => {
                const lineMatch = line.trim().match(/^([A-E])\s*[\)\.\-:]/i);
                if (!lineMatch || !isValidOptionLine(line)) return false;
                const letter = lineMatch[1].toUpperCase();
                if (existingLetters.has(letter)) return false;

                const body = String(line.replace(/^([A-E])\s*[\)\.\-:]\s*/i, '') || '').replace(/\s+/g, ' ').trim();
                if (!body) return false;

                // Guard against cross-question contamination when OCR already has mostly code-like options.
                if (codeDominant) {
                  if (!looksLikeCodeOptionBody(body)) return false;
                  const candTokens = optionTokens(body);
                  if (candTokens.length >= 3 && existingProfile.tokenSet.size > 0) {
                    let overlap = 0;
                    for (const tk of candTokens) {
                      if (existingProfile.tokenSet.has(tk)) overlap += 1;
                    }
                    const overlapRatio = overlap / candTokens.length;
                    if (overlap < 2 && overlapRatio < 0.28) return false;
                  }
                }

                return true;
              });
              if (newLines.length > 0) {
                displayQuestion = `${bestQuestion}\n${newLines.join('\n')}`;
                console.log(`AnswerHunter: Merged ${newLines.length} missing option(s) from extractOptionsOnlyScript`);
                console.log(`AnswerHunter: OCR_DOM_MERGE opts_before=${existingOptionCount} opts_added=${newLines.length} opts_after=${countDistinctOptions(displayQuestion)}`);
              } else if (usedVisionOcr) {
                console.log('AnswerHunter: OCR was used; CSS/HTML options scan executed with no new alternatives found');
                console.log(`AnswerHunter: OCR_DOM_MERGE opts_before=${existingOptionCount} opts_added=0 opts_after=${countDistinctOptions(displayQuestion)}`);
              }
            }
          }
        }
      }

      // 0) Cache: if we already captured the official gabarito for this exact question, return immediately.
      const cached = await this._getOfficialAnswerFromCache(displayQuestion);
      if (cached?.letter) {
        const optionsMap = this._extractOptionsMap(displayQuestion);
        const answerText = optionsMap[cached.letter] || '';

        const direct = [{
          question: displayQuestion,
          answer: `Letra ${cached.letter}: ${answerText}`.trim(),
          answerLetter: cached.letter,
          answerText,
          sources: [{
            title: 'Cache (gabarito oficial)',
            link: cached.sourceUrl || '',
            type: 'cache'
          }],
          bestLetter: cached.letter,
          votes: { [cached.letter]: 10 },
          confidence: 0.95,
          resultState: 'confirmed',
          reason: 'confirmed_by_sources',
          title: this.t('result.title'),
          aiFallback: false
        }];

        const withSaved = direct.map((item) => ({
          ...item,
          saved: StorageModel.isSaved(displayQuestion)
        }));

        this.view.appendResults(withSaved);
        await this.saveLastResults(withSaved);
        this.view.showStatus('success', this.t('status.answersFound', { count: 1 }));
        this.view.toggleViewSection('view-search');
        this.view.setButtonDisabled('copyBtn', false);
        return;
      }

      // 1) If the platform already shows the gabarito (post-answer), capture it as official truth and cache it.
      const pageGab = await this._tryExtractPageGabarito(tab.id, displayQuestion);
      if (pageGab?.letter && pageGab.confidence >= 0.85) {
        const optionsMap = this._extractOptionsMap(displayQuestion);
        const answerText = optionsMap[pageGab.letter] || '';

        await this._setOfficialAnswerCache(displayQuestion, {
          letter: pageGab.letter,
          sourceUrl: tab.url || '',
          evidence: pageGab.evidence || '',
          updatedAt: Date.now()
        });

        const direct = [{
          question: displayQuestion,
          answer: `Letra ${pageGab.letter}: ${answerText}`.trim(),
          answerLetter: pageGab.letter,
          answerText,
          sources: [{
            title: 'Gabarito da pagina',
            link: tab.url || '',
            type: 'page'
          }],
          bestLetter: pageGab.letter,
          votes: { [pageGab.letter]: 15 },
          confidence: Math.max(0.85, Math.min(0.99, pageGab.confidence)),
          resultState: 'confirmed',
          reason: 'confirmed_by_sources',
          title: this.t('result.title'),
          aiFallback: false
        }];

        const withSaved = direct.map((item) => ({
          ...item,
          saved: StorageModel.isSaved(displayQuestion)
        }));

        this.view.appendResults(withSaved);
        await this.saveLastResults(withSaved);
        this.view.showStatus('success', this.t('status.answersFound', { count: 1 }));
        this.view.toggleViewSection('view-search');
        this.view.setButtonDisabled('copyBtn', false);
        return;
      }

      console.log('AnswerHunter: displayQuestion sent to search â†’', displayQuestion.substring(0, 200));

      this.view.showStatus('loading', this.t('status.searchingGoogle'));

      const searchResults = await SearchService.searchOnly(displayQuestion);
      if (!searchResults || searchResults.length === 0) {
        this.view.showStatus('loading', this.t('status.noSourcesAskAi'));
        await this.renderAiFallback(displayQuestion, displayQuestion);
        return;
      }

      this.view.showStatus('loading', this.t('status.foundAndAnalyzing', { count: searchResults.length }));

      const finalResults = await SearchService.refineFromResults(
        bestQuestion,
        searchResults,
        displayQuestion,
        (message) => this.view.showStatus('loading', message)
      );

      if (!finalResults || finalResults.length === 0) {
        this.view.showStatus('loading', this.t('status.noSourceAnswerAskAi'));
        await this.renderAiFallback(displayQuestion, displayQuestion);
        return;
      }

      // If search returned results but they're inconclusive (no answer letter),
      // fall back to AI knowledge to attempt a direct answer
      const firstResult = finalResults[0];
      if (!firstResult?.answerLetter && firstResult?.resultState === 'inconclusive') {
        this.view.showStatus('loading', this.t('status.noSourceAnswerAskAi'));
        await this.renderAiFallback(displayQuestion, displayQuestion);
        return;
      }

      const withSaved = finalResults.map((item) => ({
        ...item,
        question: displayQuestion,
        saved: StorageModel.isSaved(displayQuestion)
      }));

      this.view.appendResults(withSaved);
      await this.saveLastResults(withSaved);
      this.view.showStatus('success', this.t('status.answersFound', { count: finalResults.length }));
      this.view.toggleViewSection('view-search');
      this.view.setButtonDisabled('copyBtn', false);
    } catch (error) {
      console.error('Search flow error:', error);
      const message = error?.message === 'SETUP_REQUIRED'
        ? this.t('setup.toast.required')
        : this.t('status.searchError', { message: error.message || 'unknown' });
      this.view.showStatus('error', message);

      if (error?.message === 'SETUP_REQUIRED') {
        this.toggleSetupPanel(true);
      }
    } finally {
      this.view.setButtonDisabled('searchBtn', false);
    }
  },

  _extractOptionsMap(text) {
    const map = {};
    const cleanOptionBody = (raw) => {
      let body = String(raw || '').replace(/\s+/g, ' ').trim();
      const noiseMarker = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eÃ©]ns|voc[eÃª]\s+acertou|confira\s+o\s+gabarito|explica[cÃ§][aÃ£]o)\b/i;
      const idx = body.search(noiseMarker);
      if (idx > 20) body = body.slice(0, idx).trim();
      return body.replace(/[;:,\-.\s]+$/g, '').trim();
    };
    const isUsableBody = (body) => {
      if (!body || body.length < 8) return false;
      if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(body)) return false;
      if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(body)) return false;
      return true;
    };
    const lines = String(text || '').split('\n');
    const re = /^\s*["'â€œâ€â€˜â€™]?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
    for (const line of lines) {
      const m = line.match(re);
      if (m) {
        const cleaned = cleanOptionBody(m[2]);
        if (!isUsableBody(cleaned)) continue;
        map[m[1].toUpperCase()] = cleaned;
      }
    }
    return map;
  },

  _normalizeForFingerprint(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 2200);
  },

  _fnv1a32(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
      hash >>>= 0;
    }
    return ('0000000' + hash.toString(16)).slice(-8);
  },

  _makeQuestionFingerprint(displayQuestion) {
    const norm = this._normalizeForFingerprint(displayQuestion);
    return `qa_${this._fnv1a32(norm)}`;
  },

  async _getOfficialAnswerFromCache(displayQuestion) {
    try {
      const key = this._makeQuestionFingerprint(displayQuestion);
      const data = await chrome.storage.local.get(['officialAnswerCache']);
      const cache = data?.officialAnswerCache || {};
      return cache[key] || null;
    } catch (_) {
      return null;
    }
  },

  async _setOfficialAnswerCache(displayQuestion, value) {
    try {
      const key = this._makeQuestionFingerprint(displayQuestion);
      const data = await chrome.storage.local.get(['officialAnswerCache']);
      const cache = data?.officialAnswerCache || {};
      cache[key] = value;

      // Keep the cache bounded
      const keys = Object.keys(cache);
      if (keys.length > 500) {
        keys
          .map((k) => ({ k, t: Number(cache[k]?.updatedAt || 0) }))
          .sort((a, b) => a.t - b.t)
          .slice(0, Math.max(0, keys.length - 450))
          .forEach((entry) => { delete cache[entry.k]; });
      }

      await chrome.storage.local.set({ officialAnswerCache: cache });
    } catch (_) {
      // ignore
    }
  },

  async _tryExtractPageGabarito(tabId, displayQuestion) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        function: ExtractionService.extractGabaritoFromPageScript,
        args: [displayQuestion || '']
      });

      let best = null;
      (results || []).forEach((r) => {
        const gab = r?.result;
        if (gab?.letter && (!best || (gab.confidence || 0) > (best.confidence || 0))) {
          best = gab;
        }
      });

      return best;
    } catch (_) {
      return null;
    }
  },

  async renderAiFallback(questionText, displayQuestion) {
    const aiInput = displayQuestion || questionText;
    const aiResults = await SearchService.answerFromAi(aiInput);
    if (!aiResults || aiResults.length === 0) {
      this.view.showStatus('error', this.t('status.couldNotGetAnswer'));
      return;
    }

    const withSaved = aiResults.map((item) => ({
      ...item,
      question: displayQuestion,
      saved: StorageModel.isSaved(displayQuestion)
    }));

    this.view.appendResults(withSaved);
    await this.saveLastResults(withSaved);
    this.view.showStatus('success', this.t('status.answersFound', { count: aiResults.length }));
    this.view.toggleViewSection('view-search');
    this.view.setButtonDisabled('copyBtn', false);
  },

  async handleCopyAll() {
    const text = this.view.getAllResultsText();
    if (!text) return;

    await navigator.clipboard.writeText(text);
    this.view.showStatus('success', this.t('status.copied'));
  },

  async saveLastResults(results) {
    try {
      await chrome.storage.local.set({ lastSearchResults: results });
    } catch (error) {
      console.warn('Could not store last results:', error);
    }
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  async _persistAnswerOverride(card, newLetter, newBody) {
    try {
      const data = await chrome.storage.local.get(['lastSearchResults']);
      const cached = data?.lastSearchResults;
      if (!Array.isArray(cached) || cached.length === 0) return;
      // Find the result by card index
      const allCards = [...(this.view.elements.resultsDiv?.querySelectorAll('.qa-card') || [])];
      const cardIndex = allCards.indexOf(card);
      if (cardIndex < 0 || cardIndex >= cached.length) return;
      cached[cardIndex].answerLetter = newLetter;
      cached[cardIndex].bestLetter = newLetter;
      cached[cardIndex].answerText = newBody;
      cached[cardIndex].answer = `Letra ${newLetter}: ${newBody}`;
      cached[cardIndex].userOverride = true;
      cached[cardIndex].resultState = 'confirmed';
      await chrome.storage.local.set({ lastSearchResults: cached });
      console.log(`AnswerHunter: User override applied â€” Letra ${newLetter}`);
    } catch (error) {
      console.warn('Could not persist answer override:', error);
    }
  },

  async restoreLastResults({ clear = true } = {}) {
    try {
      const data = await chrome.storage.local.get(['lastSearchResults']);
      const cached = data?.lastSearchResults;

      if (clear) this.view.clearResults();
      if (!Array.isArray(cached) || cached.length === 0) return;

      const withSaved = cached.map((item) => ({
        ...item,
        saved: StorageModel.isSaved(item.question)
      }));

      this.view.appendResults(withSaved);
      this.view.toggleViewSection('view-search');
      this.view.setButtonDisabled('copyBtn', false);
    } catch (error) {
      console.warn('Could not restore last results:', error);
    }
  },

  async handleResultClick(event) {
    // --- Answer Override: trigger button ---
    const overrideTrigger = event.target.closest('.answer-override-trigger');
    if (overrideTrigger) {
      const section = overrideTrigger.closest('.answer-override-section');
      const pills = section?.querySelector('.answer-override-pills');
      if (pills) {
        const isHidden = pills.hidden;
        pills.hidden = !isHidden;
        overrideTrigger.classList.toggle('active', isHidden);
      }
      return;
    }

    // --- Answer Override: cancel button ---
    const overrideCancel = event.target.closest('.override-cancel');
    if (overrideCancel) {
      const section = overrideCancel.closest('.answer-override-section');
      const pills = section?.querySelector('.answer-override-pills');
      const trigger = section?.querySelector('.answer-override-trigger');
      if (pills) pills.hidden = true;
      if (trigger) trigger.classList.remove('active');
      return;
    }

    // --- Answer Override: pill selection ---
    const overridePill = event.target.closest('.override-pill');
    if (overridePill) {
      const newLetter = overridePill.dataset.letter;
      const newBody = decodeURIComponent(overridePill.dataset.body || '');
      if (!newLetter) return;
      const card = overridePill.closest('.qa-card');
      if (!card) return;

      // Update the answer display
      const answerOption = card.querySelector('.answer-option');
      const answerText = card.querySelector('.qa-card-answer-text');
      const letterEl = answerOption?.querySelector('.alt-letter');
      const textEl = answerOption?.querySelector('.alt-text');
      if (letterEl && textEl) {
        letterEl.textContent = newLetter;
        textEl.textContent = newBody;
      } else if (answerText) {
        // Replace text-only display with letter display
        const newHtml = `<div class="answer-option"><div class="alternative answer-alternative"><span class="alt-letter">${this._escapeHtml(newLetter)}</span><span class="alt-text">${this._escapeHtml(newBody)}</span></div></div>`;
        answerText.outerHTML = newHtml;
      }

      // Update the answer header to show it's user-overridden
      const header = card.querySelector('.qa-card-answer-header');
      if (header) {
        header.className = 'qa-card-answer-header override-answer';
        const iconEl = header.querySelector('.answer-state-icon');
        if (iconEl) iconEl.textContent = 'person';
        const titleEl = header.querySelector('.answer-header-title');
        if (titleEl) titleEl.textContent = this.t('result.override.applied');
      }

      // Mark selected pill and close the panel
      const section = overridePill.closest('.answer-override-section');
      section?.querySelectorAll('.override-pill').forEach(p => {
        p.classList.remove('override-selected', 'override-current');
      });
      overridePill.classList.add('override-selected');
      const pills = section?.querySelector('.answer-override-pills');
      const trigger = section?.querySelector('.answer-override-trigger');
      if (pills) pills.hidden = true;
      if (trigger) trigger.classList.remove('active');

      // Persist override in lastSearchResults
      await this._persistAnswerOverride(card, newLetter, newBody);
      return;
    }

    const toggleButton = event.target.closest('.sources-toggle');
    if (toggleButton) {
      const box = toggleButton.closest('.sources-box');
      const list = box?.querySelector('.sources-list');
      if (box && list) {
        const expanded = box.classList.toggle('expanded');
        list.hidden = !expanded;
        toggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
      return;
    }

    const saveButton = event.target.closest('.save-btn');
    if (!saveButton) return;

    const dataContent = saveButton.dataset.content;
    if (!dataContent) return;

    const data = JSON.parse(decodeURIComponent(dataContent));
    await BinderController.toggleSaveItem(data.question, data.answer, data.source, saveButton);
  }
};
