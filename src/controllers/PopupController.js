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

    this.view.elements.saveSetupBtn?.addEventListener('click', () => this.handleSaveSetup());
    this.view.elements.setupSkipBtn?.addEventListener('click', () => this.handleSaveSetup());

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

    document.querySelectorAll('.btn-test-modern').forEach((button) => {
      button.addEventListener('click', () => {
        const provider = button.dataset.provider;
        if (provider) this.handleTestProvider(provider);
      });
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
          this.view.showPasteNotification(input);
          this.view.updateKeyFormatHint(provider, input.value, prefix);
        }, 50);
      });

      input.addEventListener('input', () => {
        this.saveDraftKeys();
        this.view.updateKeyFormatHint(provider, input.value,
          provider === 'groq' ? 'gsk_' : provider === 'gemini' ? 'AIza' : '');
      });
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
  },

  handleWelcomeStart() {
    this.view.hideWelcomeOverlay();
    this.onboardingFlags.welcomed = true;
    this.saveOnboardingFlags();
    this.goToSetupStep(1); // Move to Groq step
  },

  async toggleSetupPanel(forceState) {
    const panel = this.view.elements.setupPanel;
    if (!panel) return;

    const isHidden = panel.classList.contains('hidden');
    const shouldShow = forceState !== undefined ? forceState : isHidden;

    if (shouldShow) {
      this.view.setSetupVisible(true);
      const startStep = await this.determineCurrentStep();
      this.goToSetupStep(startStep);
      return;
    }

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
    if (normalizedStep > 3) normalizedStep = 3;

    this.currentSetupStep = normalizedStep;
    this.view.showSetupStep(normalizedStep);
    // this.updateStepperState(); // Not needed in new design or handled by view logic
  },

  async updateStepperState() {
    // No-op for new design
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
        this.view.showToast(this.t('setup.toast.connectionOk', { provider: provider.charAt(0).toUpperCase() + provider.slice(1) }), 'success');
        input.classList.add('input-valid');
        await this.updateStepperState();

        // Auto-advance to next step after successful test
        // Auto-advance
        if (this.currentSetupStep < 3) {
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
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: 'api health check', num: 1 })
      });
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

  async handleSaveSetup() {
    const groqApiKey = this.sanitizeKey(this.view.elements.inputGroq?.value);
    const serperApiKey = this.sanitizeKey(this.view.elements.inputSerper?.value);
    const geminiApiKey = this.sanitizeKey(this.view.elements.inputGemini?.value);

    if (!groqApiKey || !serperApiKey) {
      this.view.showToast(this.t('setup.toast.required'), 'error');
      return;
    }

    try {
      await SettingsModel.saveSettings({
        groqApiKey,
        serperApiKey,
        geminiApiKey
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
        gemini: this.view.elements.inputGemini?.value || ''
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

      const extractionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        function: ExtractionService.extractQuestionOnlyScript
      });

      let bestQuestion = '';
      let bestLength = 0;
      (extractionResults || []).forEach((frameResult) => {
        const text = frameResult?.result || '';
        if (text.length > bestLength) {
          bestLength = text.length;
          bestQuestion = text;
        }
      });

      if (!bestQuestion || bestQuestion.length < 5) {
        this.view.showStatus('error', this.t('status.selectQuestionText'));
        return;
      }

      if (!isLikelyQuestion(bestQuestion)) {
        this.view.showStatus('loading', this.t('status.validatingQuestion'));
        const valid = await ApiService.validateQuestion(bestQuestion);
        if (!valid) {
          this.view.showStatus('error', this.t('status.invalidQuestion'));
          return;
        }
      }

      const hasRealOptions = (text) => {
        if (!text) return false;
        return (text.match(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s*\S/gi) || []).length >= 2;
      };

      let displayQuestion = bestQuestion;
      if (!hasRealOptions(bestQuestion)) {
        const optionsResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          function: ExtractionService.extractOptionsOnlyScript
        });

        let optionsText = '';
        let maxLength = 0;
        (optionsResults || []).forEach((frameResult) => {
          const text = frameResult?.result || '';
          if (text.length > maxLength) {
            maxLength = text.length;
            optionsText = text;
          }
        });

        if (optionsText && optionsText.length > 10) {
          displayQuestion = `${bestQuestion}\n${optionsText}`;
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

      this.view.showStatus('loading', this.t('status.searchingGoogle'));

      const searchResults = await SearchService.searchOnly(displayQuestion);
      if (!searchResults || searchResults.length === 0) {
        this.view.showStatus('loading', this.t('status.noSourcesAskAi'));
        await this.renderAiFallback(bestQuestion, displayQuestion);
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
        await this.renderAiFallback(bestQuestion, displayQuestion);
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
    const lines = String(text || '').split('\n');
    const re = /^\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
    for (const line of lines) {
      const m = line.match(re);
      if (m) map[m[1].toUpperCase()] = (m[2] || '').trim();
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
    const aiResults = await SearchService.answerFromAi(questionText);
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
