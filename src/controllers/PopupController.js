import { ExtractionService } from '../services/ExtractionService.js';
import { SearchService } from '../services/SearchService.js';
import { ApiService } from '../services/ApiService.js';
import { BinderController } from './BinderController.js';
import { DisciplinasController } from './DisciplinasController.js';
import { StorageModel } from '../models/StorageModel.js';
import { SettingsModel } from '../models/SettingsModel.js';
import { I18nService } from '../i18n/I18nService.js';
import { isLikelyQuestion } from '../utils/helpers.js';
import { ChatGPTAuthService } from '../services/ChatGPTAuthService.js';
import { GeminiCLIAuthService } from '../services/GeminiCLIAuthService.js';
import { CopilotAuthService } from '../services/CopilotAuthService.js';
import { PerformanceTimer } from '../utils/PerformanceTimer.js';
import { NativeFetchBridgeService } from '../services/NativeFetchBridgeService.js';
import { PageGabaritoCache } from '../services/PageGabaritoCache.js';
import { QuestionParser } from '../services/search/QuestionParser.js';
import { PlatformExtractors } from '../services/PlatformExtractors.js';
import { QuestionFingerprint } from '../utils/QuestionFingerprint.js';

export const PopupController = {
  view: null,
  currentSetupStep: 1,
  onboardingFlags: { welcomed: false, setupDone: false },
  _isReopenMode: false,
  _settingsCache: null,
  _chatgptModelValidationRunning: false,

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
    await this._resumePendingBackgroundSearch();

    // Clear draft keys when popup closes without completing setup,
    // so stale plaintext keys don't persist in storage indefinitely.
    window.addEventListener('pagehide', () => { this.clearDraftKeys(); }, { once: true });

    // Check ChatGPT auth state and update UI
    await this.refreshChatGPTAuthUI();
    // Check Google/Gemini auth state and update UI
    await this.refreshGeminiAuthUI();
    // Check NativeFetchBridge binary status
    this._checkNativeBridgeStatus().catch(() => { });
    // Check GitHub Copilot auth state and update UI
    await this.refreshCopilotAuthUI();

    // Listen for auth success from background service worker
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'CHATGPT_AUTH_SUCCESS') {
        this.refreshChatGPTAuthUI();
        this.view.showToast('ChatGPT connected!', 'success');
      } else if (msg.type === 'CHATGPT_AUTH_FAILED') {
        const statusEl = document.getElementById('chatgpt-login-status');
        if (statusEl) statusEl.textContent = msg.error || 'Login failed';
        this.view.showToast('ChatGPT login failed', 'error');
      } else if (msg.type === 'GEMINI_CLI_AUTH_SUCCESS') {
        this.refreshGeminiAuthUI();
        const loginBtn = document.getElementById('gemini-login-btn');
        const statusEl2 = document.getElementById('gemini-login-status');
        if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = '<span class="material-symbols-rounded">login</span> <span>Entrar com Google</span>'; }
        if (statusEl2) statusEl2.textContent = '';
        this.view.showToast('Google conectado!', 'success');
      } else if (msg.type === 'GEMINI_CLI_AUTH_FAILED') {
        const loginBtn2 = document.getElementById('gemini-login-btn');
        const statusEl3 = document.getElementById('gemini-login-status');
        if (loginBtn2) { loginBtn2.disabled = false; loginBtn2.innerHTML = '<span class="material-symbols-rounded">login</span> <span>Entrar com Google</span>'; }
        if (statusEl3) statusEl3.textContent = msg.error || 'Falha no login Google';
        this.view.showToast('Falha no login Google', 'error');
      } else if (msg.type === 'COPILOT_AUTH_SUCCESS') {
        chrome.storage.local.remove(['copilot_pending_code']);
        this.refreshCopilotAuthUI();
        this.view.showToast('GitHub Copilot conectado!', 'success');
      } else if (msg.type === 'COPILOT_AUTH_FAILED') {
        chrome.storage.local.remove(['copilot_pending_code']);
        const copilotLoginBtn = document.getElementById('copilot-login-btn');
        const copilotStatusEl = document.getElementById('copilot-login-status');
        if (copilotLoginBtn) { copilotLoginBtn.disabled = false; copilotLoginBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="#ffffff" style="flex-shrink:0;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg><span>Login com GitHub</span>'; }
        if (copilotStatusEl) copilotStatusEl.textContent = msg.error || 'Login falhou';
        this.view.showToast('GitHub Copilot: login falhou', 'error');
      }
    });
  },

  setupEventListeners() {
    this.view.elements.settingsBtn?.addEventListener('click', () => this.toggleSetupPanel());
    // ChatGPT header button
    document.getElementById('chatgptBtn')?.addEventListener('click', () => {
      document.getElementById('chatgpt-auth-section')?.classList.remove('hidden');
    });
    // remove closeSetupBtn as we don't have a close button in full screen onboarding

    // New Onboarding Bindings
    this.view.elements.welcomeStartBtn?.addEventListener('click', () => this.handleWelcomeStart());

    // NativeFetchBridge Install Button — opens Turbo Wizard
    const nativeBridgeInstallBtn = document.getElementById('nativeBridgeInstallBtn');
    if (nativeBridgeInstallBtn) {
      nativeBridgeInstallBtn.addEventListener('click', () => {
        this._openTurboWizard();
      });
    }

    // Slide Navigation
    this.view.elements.btnNextGroq?.addEventListener('click', () => this.goToSetupStep(2));
    this.view.elements.prevGroq?.addEventListener('click', () => this.goToSetupStep(0)); // Back to welcome?

    this.view.elements.btnNextSerper?.addEventListener('click', () => this.goToSetupStep(3));
    this.view.elements.prevSerper?.addEventListener('click', () => this.goToSetupStep(1));

    this.view.elements.prevGemini?.addEventListener('click', () => this.goToSetupStep(2));
    this.view.elements.btnNextGemini?.addEventListener('click', () => this.goToSetupStep(4));

    this.view.elements.btnNextOpenrouter?.addEventListener('click', () => this.goToSetupStep(5));
    this.view.elements.prevOpenrouter?.addEventListener('click', () => this.goToSetupStep(3));
    this.view.elements.prevPrefs?.addEventListener('click', () => this.goToSetupStep(4));

    this.view.elements.saveSetupBtn?.addEventListener('click', () => this.handleSaveSetup());
    this.view.elements.setupSkipBtn?.addEventListener('click', () => this.handleSaveSetup());

    // Bind main search provider setting
    this.view.elements.selectSearchProvider?.addEventListener('change', () => {
      this.applySearchProviderSelection(this.getSelectedSearchProvider(), {
        persistDraft: true,
        resetValidation: true
      });
    });

    const bindProviderPillButton = (button, fallbackProvider = '') => {
      if (!button || button.dataset.providerBound === '1') return;
      const providerCandidate = (button.dataset.provider || fallbackProvider || button.id?.replace(/^pill-/, '').replace(/-ob$/, '') || '')
        .toLowerCase()
        .trim();
      if (!['groq', 'gemini', 'openrouter', 'chatgpt', 'copilot'].includes(providerCandidate)) return;

      button.dataset.providerBound = '1';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        console.log(`[AnswerHunter] provider pill click: ${providerCandidate}`);
        this.setProviderPill(providerCandidate);
      });
    };

    // Provider pills (robust binding + fallback over all onboarding buttons)
    bindProviderPillButton(this.view.elements.pillGroq, 'groq');
    bindProviderPillButton(this.view.elements.pillGemini, 'gemini');
    bindProviderPillButton(this.view.elements.pillOpenrouter, 'openrouter');
    bindProviderPillButton(this.view.elements.pillGroqOb, 'groq');
    bindProviderPillButton(this.view.elements.pillGeminiOb, 'gemini');
    bindProviderPillButton(this.view.elements.pillOpenrouterOb, 'openrouter');
    bindProviderPillButton(document.getElementById('pill-chatgpt-ob'), 'chatgpt');
    document.querySelectorAll('.ob-provider-pill[data-provider]').forEach((button) => {
      bindProviderPillButton(button);
    });

    this.view.elements.selectGroqModel?.addEventListener('change', () => this.persistAiConfig());
    this.view.elements.selectGeminiModel?.addEventListener('change', () => this.persistAiConfig());
    this.view.elements.selectOpenrouterModel?.addEventListener('change', () => this.persistAiConfig());

    // ChatGPT Auth buttons
    document.getElementById('chatgpt-login-btn')?.addEventListener('click', () => this.handleChatGPTLogin());
    document.getElementById('chatgpt-logout-btn')?.addEventListener('click', () => this.handleChatGPTLogout());
    document.getElementById('chatgpt-auth-close')?.addEventListener('click', () => {
      document.getElementById('chatgpt-auth-section')?.classList.add('hidden');
    });
    document.getElementById('select-chatgpt-model')?.addEventListener('change', () => this.persistAiConfig());

    // Gemini (Google) Auth buttons
    document.getElementById('geminiAuthBtn')?.addEventListener('click', () => this.openGeminiAuthPanel());
    document.getElementById('gemini-auth-close')?.addEventListener('click', () => {
      document.getElementById('gemini-auth-section')?.classList.add('hidden');
    });
    document.getElementById('gemini-login-btn')?.addEventListener('click', () => this.handleGeminiLogin());
    document.getElementById('gemini-logout-btn')?.addEventListener('click', () => this.handleGeminiLogout());
    document.getElementById('select-gemini-oauth-model')?.addEventListener('change', () => this.persistAiConfig());

    // Copilot (GitHub) Auth buttons
    document.getElementById('copilotBtn')?.addEventListener('click', () => {
      document.getElementById('copilot-auth-section')?.classList.remove('hidden');
    });
    document.getElementById('copilot-auth-close')?.addEventListener('click', () => {
      document.getElementById('copilot-auth-section')?.classList.add('hidden');
    });
    document.getElementById('copilot-login-btn')?.addEventListener('click', () => this.handleCopilotLogin());
    document.getElementById('copilot-logout-btn')?.addEventListener('click', () => this.handleCopilotLogout());
    document.getElementById('copilot-test-btn')?.addEventListener('click', () => this.handleCopilotTestConnection());
    document.getElementById('copilot-copy-code-btn')?.addEventListener('click', () => this.handleCopilotCopyCode());
    document.getElementById('select-copilot-model')?.addEventListener('change', () => this.persistAiConfig());

    this.view.elements.extractBtn?.addEventListener('click', () => this.handleExtract());
    this.view.elements.searchBtn?.addEventListener('click', () => this.handleSearch());
    this.view.elements.copyBtn?.addEventListener('click', () => this.handleCopyAll());
    this.view.elements.clearBinderBtn?.addEventListener('click', () => BinderController.handleClearAll());
    document.getElementById('addQuestionBtn')?.addEventListener('click', () => BinderController.handleAddManual());
    document.getElementById('btnDisciplinas')?.addEventListener('click', () => BinderController.openDisciplinaManager());

    DisciplinasController.init();

    this.view.elements.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.view.switchTab(target);
        if (target === 'binder') {
          BinderController.renderBinder();
        } else if (target === 'disciplinas') {
          DisciplinasController.renderDisciplinas();
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

      if (!['groq', 'serper', 'gemini', 'openrouter'].includes(providerCandidate)) return;

      button.dataset.testBound = '1';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        this.handleTestProvider(providerCandidate);
      });
    };

    bindProviderTestButton(this.view.elements.testGroq, 'groq');
    bindProviderTestButton(this.view.elements.testSerper, 'serper');
    bindProviderTestButton(this.view.elements.testGemini, 'gemini');
    bindProviderTestButton(this.view.elements.testOpenrouter, 'openrouter');


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
      { input: this.view.elements.inputGemini, provider: 'gemini', prefix: 'AIza' },
      { input: this.view.elements.inputOpenrouter, provider: 'openrouter', prefix: 'sk-or' },

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
          provider === 'groq' ? 'gsk_' : provider === 'gemini' ? 'AIza' : provider === 'openrouter' ? 'sk-or' : '');
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
    ['groq', 'serper', 'gemini', 'openrouter'].forEach(provider => {
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
    this.view.elements.removeKeySerper?.addEventListener('click', () => this.handleRemoveSerperKey());
    this.view.elements.removeKeyGemini?.addEventListener('click', () => this.handleRemoveGeminiKey());
    this.view.elements.removeKeyOpenrouter?.addEventListener('click', () => this.handleRemoveOpenrouterKey());

    // Binder CTA: Go to Search
    this.view.elements.binderGoToSearch?.addEventListener('click', () => {
      this.view.switchTab('search');
    });

    // --- Study Feature: Contextual Dictionary ---
    document.addEventListener('mouseup', async (e) => {
      if (e.target.closest('.dict-tooltip')) return;

      const selection = window.getSelection();
      const text = selection.toString().trim();

      const existing = document.querySelector('.dict-tooltip');
      if (existing) existing.remove();

      if (text && text.length > 0 && text.length < 50 && text.split(/\s+/).length <= 5) {
        const cardContext = e.target.closest('.qa-card-question, .qa-card-answer, .full-question-text, .full-answer-text, .qa-card-answer-text, .alt-text');
        if (cardContext) {
          try {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            const tooltip = document.createElement('div');
            tooltip.className = 'dict-tooltip';
            tooltip.innerHTML = `<span class="material-symbols-rounded spin-loading" style="font-size:14px; vertical-align: middle;">sync</span> <span style="font-size:12px; margin-left:4px; vertical-align: middle;">Definindo...</span>`;

            tooltip.style.position = 'absolute';
            tooltip.style.left = `${Math.max(10, rect.left + window.scrollX)}px`;
            tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
            tooltip.style.zIndex = '99999';
            tooltip.style.backgroundColor = 'var(--bg-card, #fff)';
            tooltip.style.border = '1px solid var(--border-color, #eee)';
            tooltip.style.padding = '8px 12px';
            tooltip.style.borderRadius = '8px';
            tooltip.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';
            tooltip.style.maxWidth = '250px';
            tooltip.style.color = 'var(--text-color, #333)';
            tooltip.style.fontFamily = 'var(--font-family, sans-serif)';

            document.body.appendChild(tooltip);

            const contextText = cardContext.textContent || '';
            const ApiModule = await import('../services/ApiService.js');
            const definition = await ApiModule.ApiService.defineTerm(text, contextText);

            const escapeHtml = (str) => {
              const div = document.createElement('div');
              div.textContent = str;
              return div.innerHTML;
            };

            tooltip.innerHTML = `<div style="font-size:12.5px; line-height: 1.45;"><strong>${escapeHtml(text)}:</strong> ${escapeHtml(definition)}</div>`;
          } catch (err) {
            console.warn('AnswerHunter Dict Error', err);
            document.querySelector('.dict-tooltip')?.remove();
          }
        }
      }
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
    this._settingsCache = settings;
    const keys = await SettingsModel.getApiKeys();

    if (this.view.elements.inputGroq) {
      this.view.elements.inputGroq.value = keys.groqKey || this.view.elements.inputGroq.value || '';
    }
    if (this.view.elements.inputSerper) {
      this.view.elements.inputSerper.value = keys.serperKey || this.view.elements.inputSerper.value || '';
    }
    if (this.view.elements.inputOpenrouter) {
      this.view.elements.inputOpenrouter.value = keys.openrouterKey || this.view.elements.inputOpenrouter.value || '';
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
    const pills = [
      this.view.elements.pillGroq,
      this.view.elements.pillGemini,
      this.view.elements.pillOpenrouter,
      document.getElementById('pill-chatgpt'),
      document.getElementById('pill-copilot')
    ];
    pills.forEach(p => p?.classList.remove('active'));
    if (provider === 'copilot') {
      document.getElementById('pill-copilot')?.classList.add('active');
    } else if (provider === 'chatgpt') {
      document.getElementById('pill-chatgpt')?.classList.add('active');
    } else if (provider === 'openrouter') {
      this.view.elements.pillOpenrouter?.classList.add('active');
    } else if (provider === 'gemini') {
      this.view.elements.pillGemini?.classList.add('active');
    } else {
      this.view.elements.pillGroq?.classList.add('active');
    }
    this.updateProviderHint(provider);

    // Set model selects (settings panel only)
    const groqModel = settings.groqModelSmart || 'llama-3.3-70b-versatile';
    const geminiModel = settings.geminiModelSmart || 'gemini-2.5-flash';
    const chatgptModel = settings.chatgptModel || 'gpt-5.2-codex';
    const copilotModel = settings.copilotModel || 'claude-sonnet-4.6';
    const copilotModelSelect = document.getElementById('select-copilot-model');
    if (copilotModelSelect) copilotModelSelect.value = copilotModel;
    if (this.view.elements.selectGroqModel) {
      this.view.elements.selectGroqModel.value = groqModel;
    }
    if (this.view.elements.selectGeminiModel) {
      this.view.elements.selectGeminiModel.value = geminiModel;
    }
    const chatgptModelSelect = document.getElementById('select-chatgpt-model');
    if (chatgptModelSelect) {
      chatgptModelSelect.value = chatgptModel;
    }
    this.syncObPills(provider);
  },

  syncObPills(provider) {
    const obPills = [
      this.view.elements.pillGroqOb,
      this.view.elements.pillGeminiOb,
      this.view.elements.pillOpenrouterOb,
      document.getElementById('pill-chatgpt-ob'),
      document.getElementById('pill-copilot-ob')
    ];
    obPills.forEach(p => p?.classList.remove('active'));
    if (provider === 'copilot') {
      document.getElementById('pill-copilot-ob')?.classList.add('active');
    } else if (provider === 'chatgpt') {
      document.getElementById('pill-chatgpt-ob')?.classList.add('active');
    } else if (provider === 'gemini') {
      this.view.elements.pillGeminiOb?.classList.add('active');
    } else if (provider === 'openrouter') {
      this.view.elements.pillOpenrouterOb?.classList.add('active');
    } else {
      this.view.elements.pillGroqOb?.classList.add('active');
    }
  },


  hasOpenrouterKey() {
    const inputKey = this.sanitizeKey(this.view.elements.inputOpenrouter?.value);
    if (SettingsModel.isPresent(inputKey)) return true;
    const savedKey = this.sanitizeKey(this._settingsCache?.openrouterApiKey);
    return SettingsModel.isPresent(savedKey);
  },

  hasGeminiKey() {
    const inputKey = this.sanitizeKey(this.view.elements.inputGemini?.value);
    if (SettingsModel.isPresent(inputKey)) return true;
    const savedKey = this.sanitizeKey(this._settingsCache?.geminiApiKey);
    return SettingsModel.isPresent(savedKey);
  },

  /** Check if Gemini is usable (API key OR CLI auth logged in) */
  _geminiCliLoggedIn: false,
  async hasGeminiAccess() {
    if (this.hasGeminiKey()) return true;
    try {
      const { GeminiCLIAuthService } = await import('../services/GeminiCLIAuthService.js');
      const loggedIn = await GeminiCLIAuthService.isLoggedIn();
      this._geminiCliLoggedIn = loggedIn;
      return loggedIn;
    } catch (_) { return false; }
  },

  /** Handle provider pill click */
  async setProviderPill(provider) {
    let effectiveProvider = provider;
    const hasOpenrouterInputKey = SettingsModel.isPresent(this.sanitizeKey(this.view.elements.inputOpenrouter?.value));
    const hasOpenrouterSavedKey = SettingsModel.isPresent(this.sanitizeKey(this._settingsCache?.openrouterApiKey));
    const hasGeminiInputKey = SettingsModel.isPresent(this.sanitizeKey(this.view.elements.inputGemini?.value));
    const hasGeminiSavedKey = SettingsModel.isPresent(this.sanitizeKey(this._settingsCache?.geminiApiKey));
    console.log(
      `[AnswerHunter] setProviderPill request=${provider} ` +
      `orInput=${hasOpenrouterInputKey} orSaved=${hasOpenrouterSavedKey} ` +
      `gmInput=${hasGeminiInputKey} gmSaved=${hasGeminiSavedKey}`
    );

    if (provider === 'openrouter' && !this.hasOpenrouterKey()) {
      effectiveProvider = 'groq';
      console.log('[AnswerHunter] OpenRouter selection blocked: key not present in input or saved settings');
      const noOpenrouterKeyMsg = this.t('setup.toast.noOpenrouterKeySaved');
      this.view.showToast(
        noOpenrouterKeyMsg === 'setup.toast.noOpenrouterKeySaved'
          ? 'OpenRouter key not configured yet.'
          : noOpenrouterKeyMsg,
        'warning'
      );
      this.view.setSetupStatus('openrouter', this.t('setup.status.openrouterMissing'), 'error');
    }
    if (provider === 'gemini' && !(await this.hasGeminiAccess())) {
      // No API key and not logged in via Google — open login panel
      document.getElementById('gemini-auth-section')?.classList.remove('hidden');
      effectiveProvider = 'groq';
      this.view.showToast(this.t('setup.toast.geminiAccessRequired'), 'warning');
    }
    if (provider === 'chatgpt') {
      // ChatGPT uses OAuth, not API keys — check login status synchronously
      const loggedIn = await ChatGPTAuthService.isLoggedIn();
      if (!loggedIn) {
        effectiveProvider = 'groq';
        this.view.showToast(this.t('setup.toast.chatgptLoginRequired'), 'warning');
        document.getElementById('chatgpt-auth-section')?.classList.remove('hidden');
      }
    }
    if (provider === 'copilot') {
      // Copilot uses GitHub Device Flow OAuth
      const loggedIn = await CopilotAuthService.isLoggedIn();
      if (!loggedIn) {
        effectiveProvider = 'groq';
        this.view.showToast(this.t('setup.toast.copilotLoginRequired'), 'warning');
        document.getElementById('copilot-auth-section')?.classList.remove('hidden');
      }
    }

    const pills = [this.view.elements.pillGroq, this.view.elements.pillGemini, this.view.elements.pillOpenrouter, document.getElementById('pill-chatgpt'), document.getElementById('pill-copilot')];
    pills.forEach(p => p?.classList.remove('active'));
    if (effectiveProvider === 'copilot') {
      document.getElementById('pill-copilot')?.classList.add('active');
    } else if (effectiveProvider === 'chatgpt') {
      document.getElementById('pill-chatgpt')?.classList.add('active');
    } else if (effectiveProvider === 'openrouter') {
      this.view.elements.pillOpenrouter?.classList.add('active');
    } else if (effectiveProvider === 'gemini') {
      this.view.elements.pillGemini?.classList.add('active');
    } else {
      this.view.elements.pillGroq?.classList.add('active');
    }
    this.syncObPills(effectiveProvider);
    this.updateProviderHint(effectiveProvider);
    console.log(`[AnswerHunter] setProviderPill effective=${effectiveProvider}`);
    this.persistAiConfig();
    return effectiveProvider;
  },

  /** Update the hint text below the toggle */
  updateProviderHint(provider) {
    const hint = this.view.elements.providerHint;
    if (hint) {
      const key = provider === 'copilot'
        ? 'setup.aiConfig.hintCopilotPrimary'
        : provider === 'chatgpt'
          ? 'setup.aiConfig.hintChatgptPrimary'
          : provider === 'openrouter'
            ? 'setup.aiConfig.hintOpenrouterPrimary'
            : provider === 'gemini'
              ? 'setup.aiConfig.hintGeminiPrimary'
              : 'setup.aiConfig.hintGroqPrimary';
      let text = this.view.t(key);
      if (!text || text === key) text = provider === 'copilot' ? 'Using your GitHub Copilot subscription credits' : provider === 'chatgpt' ? 'Using your ChatGPT subscription credits' : null;
      if (text && text !== key) {
        const textSpan = hint.querySelector('span:last-child') || hint;
        textSpan.textContent = text;
      }
    }
    // Also update the onboarding hint
    const obHint = document.getElementById('provider-hint-ob');
    if (obHint) {
      const key = provider === 'copilot'
        ? 'setup.prefs.hintCopilot'
        : provider === 'chatgpt'
          ? 'setup.prefs.hintChatgpt'
          : provider === 'openrouter'
            ? 'setup.prefs.hintOpenrouter'
            : provider === 'gemini'
              ? 'setup.prefs.hintGemini'
              : 'setup.prefs.hintGroq';
      let text = this.view.t(key);
      if (!text || text === key) text = provider === 'copilot' ? 'Uses your GitHub Copilot subscription credits' : provider === 'chatgpt' ? 'Uses your ChatGPT Plus/Pro subscription credits' : null;
      obHint.textContent = text || (this.view.t('setup.prefs.hintGroq') || obHint.textContent);
    }
  },

  /** Persist the current AI config selections to storage */
  async persistAiConfig() {
    const isChatgpt = document.getElementById('pill-chatgpt')?.classList.contains('active') || document.getElementById('pill-chatgpt-ob')?.classList.contains('active');
    const isCopilot = document.getElementById('pill-copilot')?.classList.contains('active') || document.getElementById('pill-copilot-ob')?.classList.contains('active');
    const isOpenrouter = this.view.elements.pillOpenrouter?.classList.contains('active') || this.view.elements.pillOpenrouterOb?.classList.contains('active');
    const isGemini = this.view.elements.pillGemini?.classList.contains('active')
      || this.view.elements.pillGeminiOb?.classList.contains('active');
    let primaryProvider = (isCopilot ? 'copilot' : (isChatgpt ? 'chatgpt' : (isOpenrouter ? 'openrouter' : (isGemini ? 'gemini' : 'groq'))));
    console.log(
      `[AnswerHunter] persistAiConfig pre-check primary=${primaryProvider} ` +
      `isCopilot=${isCopilot} isChatgpt=${isChatgpt} isOpenrouter=${isOpenrouter} hasOpenrouter=${this.hasOpenrouterKey()} ` +
      `isGemini=${isGemini} hasGemini=${this.hasGeminiKey()}`
    );

    if (primaryProvider === 'openrouter' && !this.hasOpenrouterKey()) {
      primaryProvider = 'groq';
      this.view.elements.pillOpenrouter?.classList.remove('active');
      this.view.elements.pillOpenrouterOb?.classList.remove('active');
      this.view.elements.pillGroq?.classList.add('active');
      this.view.elements.pillGroqOb?.classList.add('active');
      this.updateProviderHint('groq');
    }
    if (primaryProvider === 'gemini' && !(await this.hasGeminiAccess())) {
      primaryProvider = 'groq';
      this.view.elements.pillGemini?.classList.remove('active');
      this.view.elements.pillGeminiOb?.classList.remove('active');
      this.view.elements.pillGroq?.classList.add('active');
      this.view.elements.pillGroqOb?.classList.add('active');
      this.updateProviderHint('groq');
    }
    const groqModel = this.view.elements.selectGroqModel?.value || 'llama-3.3-70b-versatile';
    const geminiModel = this.view.elements.selectGeminiModel?.value || 'gemini-2.5-flash';
    const openrouterModelSmart = this.view.elements.selectOpenrouterModel?.value || 'deepseek/deepseek-r1:free';
    const chatgptModel = document.getElementById('select-chatgpt-model')?.value || 'gpt-5.2-codex';
    const copilotModel = document.getElementById('select-copilot-model')?.value || 'gpt-4o';

    await SettingsModel.saveSettings({ primaryProvider, groqModelSmart: groqModel, geminiModelSmart: geminiModel, geminiModel, openrouterModelSmart, chatgptModel, copilotModel });

    const providerModelMap = {
      groq: groqModel,
      gemini: geminiModel,
      openrouter: openrouterModelSmart,
      chatgpt: chatgptModel,
      copilot: copilotModel,
    };

    const PROVIDER_LABEL = {
      groq: '🔶 Groq',
      gemini: '💎 Gemini',
 openrouter:' OpenRouter',
      chatgpt: '💬 ChatGPT',
      copilot: '🐙 Copilot',
    };
    const activeModel = providerModelMap[primaryProvider] ?? '—';
    const activeLabel = PROVIDER_LABEL[primaryProvider] ?? primaryProvider;

    console.group(
'%c AnswerHunter %c Provedor de IA atualizado',
      'background:#7c3aed;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px;',
      'color:#7c3aed;font-weight:bold;font-size:13px;'
    );
 console.log(`%c[FAST] Ativo agora: ${activeLabel} › ${activeModel}`,'color:#16a34a;font-weight:bold;font-size:12px;');
    console.table(
      Object.entries(providerModelMap).map(([provider, model]) => ({
        'Provider': (PROVIDER_LABEL[provider] ?? provider),
        'Modelo': model,
'Status': provider === primaryProvider ?' ATIVO' :'○',
      }))
    );
    console.groupEnd();
  },

  // --- ChatGPT Auth Handlers ---

  async handleChatGPTLogin() {
    const statusEl = document.getElementById('chatgpt-login-status');
    const loginBtn = document.getElementById('chatgpt-login-btn');

    if (statusEl) {
      statusEl.innerHTML = '<span class="material-symbols-rounded spin-loading" style="font-size:14px;">sync</span> Opening login page...';
    }
    if (loginBtn) loginBtn.disabled = true;

    try {
      await ChatGPTAuthService.startLogin();
      if (statusEl) {
        statusEl.innerHTML = '<span class="material-symbols-rounded spin-loading" style="font-size:14px;">sync</span> Waiting for authentication...';
      }
      // The background service worker will handle the callback
      // and send CHATGPT_AUTH_SUCCESS message
    } catch (err) {
      console.error('ChatGPT login error:', err);
      if (statusEl) statusEl.textContent = 'Login failed: ' + (err.message || String(err));
      if (loginBtn) loginBtn.disabled = false;
    }
  },

  async handleChatGPTLogout() {
    await ChatGPTAuthService.logout();
    await this.refreshChatGPTAuthUI();

    // If ChatGPT was the primary provider, switch back to groq
    const settings = await SettingsModel.getSettings();
    if (settings.primaryProvider === 'chatgpt') {
      this.setProviderPill('groq');
    }

    this.view.showToast('ChatGPT disconnected', 'info');
  },

  async refreshChatGPTAuthUI() {
    const loggedIn = await ChatGPTAuthService.isLoggedIn();
    const loggedOutEl = document.getElementById('chatgpt-logged-out');
    const loggedInEl = document.getElementById('chatgpt-logged-in');
    const loginBtn = document.getElementById('chatgpt-login-btn');
    const statusEl = document.getElementById('chatgpt-login-status');
    const emailEl = document.getElementById('chatgpt-user-email');

    if (loggedIn) {
      const auth = await ChatGPTAuthService.getAuth();
      loggedOutEl?.classList.add('hidden');
      loggedInEl?.classList.remove('hidden');
      if (emailEl) emailEl.textContent = auth?.email || 'ChatGPT account';
      if (loginBtn) loginBtn.disabled = false;
      if (statusEl) statusEl.textContent = '';

      // Validate/prune unsupported Codex models and restore a valid selection
      await this.validateAndPruneChatGPTModels();
    } else {
      loggedOutEl?.classList.remove('hidden');
      loggedInEl?.classList.add('hidden');
      if (loginBtn) loginBtn.disabled = false;
      if (statusEl) statusEl.textContent = '';
    }

    // Update header dot indicator
    const dot = document.getElementById('chatgpt-status-dot');
    if (dot) {
      if (loggedIn) {
        dot.classList.remove('hidden');
      } else {
        dot.classList.add('hidden');
      }
    }
    const chatgptUserLabel = document.getElementById('chatgpt-btn-user');
    if (chatgptUserLabel) {
      const userText = loggedIn ? (await ChatGPTAuthService.getAuth())?.email || '' : '';
      chatgptUserLabel.textContent = userText;
      chatgptUserLabel.classList.toggle('hidden', !userText);
    }
  },

  // --- Google / Gemini Auth Handlers ---

  openGeminiAuthPanel() {
    document.getElementById('gemini-auth-section')?.classList.remove('hidden');
  },

  async handleGeminiLogin() {
    const btn = document.getElementById('gemini-login-btn');
    const statusEl = document.getElementById('gemini-login-status');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-rounded spin-loading">sync</span> Entrando...';
    }
    if (statusEl) statusEl.innerHTML = '<span class="material-symbols-rounded spin-loading" style="font-size:14px;">sync</span> Abrindo página de login...';

    try {
      await GeminiCLIAuthService.startLogin();
      if (statusEl) {
        statusEl.innerHTML = '<span class="material-symbols-rounded spin-loading" style="font-size:14px;">sync</span> Aguardando autenticação...';
      }
      // The background service worker will handle the callback
      // and send GEMINI_CLI_AUTH_SUCCESS message
    } catch (err) {
      const message = err?.message || String(err);
      if (statusEl) statusEl.textContent = message;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-rounded">login</span> <span>Entrar com Google</span>';
      }
      this.view.showToast(`Erro no login Google: ${message}`, 'error');
    }
  },

  async handleGeminiLogout() {
    await GeminiCLIAuthService.logout();
    await this.refreshGeminiAuthUI();
    this.view.showToast('Desconectado do Google', 'info');
  },

  async refreshGeminiAuthUI() {
    const isLoggedIn = await GeminiCLIAuthService.isLoggedIn();
    const auth = isLoggedIn ? await GeminiCLIAuthService.getAuth() : null;
    document.getElementById('gemini-logged-out')?.classList.toggle('hidden', isLoggedIn);
    document.getElementById('gemini-logged-in')?.classList.toggle('hidden', !isLoggedIn);
    const dot = document.getElementById('gemini-status-dot');
    if (dot) dot.classList.toggle('hidden', !isLoggedIn);
    if (isLoggedIn && auth?.email) {
      const emailEl = document.getElementById('gemini-user-email');
      if (emailEl) emailEl.textContent = auth.email;
    }
    const geminiUserLabel = document.getElementById('gemini-btn-user');
    if (geminiUserLabel) {
      const userText = isLoggedIn && auth?.email ? auth.email : '';
      geminiUserLabel.textContent = userText;
      geminiUserLabel.classList.toggle('hidden', !userText);
    }
  },

  // --- GitHub Copilot Auth Handlers ---

  async handleCopilotLogin() {
    const statusEl = document.getElementById('copilot-login-status');
    const loginBtn = document.getElementById('copilot-login-btn');
    const codeDisplay = document.getElementById('copilot-user-code');

    if (loginBtn) loginBtn.disabled = true;
    if (statusEl) {
      statusEl.innerHTML = '<span class="material-symbols-rounded spin-loading" style="font-size:14px;">sync</span> Obtendo código...';
    }

    try {
      const { user_code, verification_uri } = await CopilotAuthService.startLogin();

      // Persist code + URL in storage so it survives popup close/reopen
      await new Promise(r => chrome.storage.local.set({
        copilot_pending_code: { user_code, verification_uri, expiresAt: Date.now() + 15 * 60 * 1000 }
      }, r));

      this._showCopilotCode(user_code, verification_uri);
    } catch (err) {
      const message = err?.message || String(err);
      if (statusEl) statusEl.textContent = 'Erro: ' + message;
      if (loginBtn) loginBtn.disabled = false;
      this.view.showToast(`Copilot login error: ${message}`, 'error');
    }
  },

  _showCopilotCode(user_code, verification_uri) {
    const codeDisplay = document.getElementById('copilot-user-code');
    const codeSection = document.getElementById('copilot-code-section');
    const statusEl = document.getElementById('copilot-login-status');
    const loginBtn = document.getElementById('copilot-login-btn');
    const linkEl = document.getElementById('copilot-open-github-link');

    if (codeDisplay) codeDisplay.textContent = user_code;

    // Update the link href with the actual verification URL from GitHub
    if (linkEl && verification_uri) {
      linkEl.href = verification_uri;
      const host = (() => { try { return new URL(verification_uri).host; } catch { return 'github.com/login/device'; } })();
      linkEl.childNodes[linkEl.childNodes.length - 1].textContent = ` ${host}/login/device`;
    }

    codeSection?.classList.remove('hidden');

    // Auto-copy to clipboard so user can paste immediately after opening the link
    navigator.clipboard.writeText(user_code).then(() => {
      const feedbackEl = document.getElementById('copilot-copy-feedback');
      if (feedbackEl) { feedbackEl.textContent = 'Código copiado automaticamente!'; setTimeout(() => { if (feedbackEl) feedbackEl.textContent = ''; }, 3000); }
    }).catch(() => { });

    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">refresh</span><span>Gerar novo código</span>';
    }
    if (statusEl) {
      statusEl.innerHTML = 'Abra o link, cole o código e autorize.';
    }
  },

  async handleCopilotLogout() {
    await CopilotAuthService.logout();
    await new Promise(r => chrome.storage.local.remove(['copilot_pending_code'], r));
    await this.refreshCopilotAuthUI();

    // If Copilot was the primary provider, switch back to groq
    const settings = await SettingsModel.getSettings();
    if (settings.primaryProvider === 'copilot') {
      this.setProviderPill('groq');
    }

    this.view.showToast('GitHub Copilot desconectado', 'info');
  },

  async refreshCopilotAuthUI() {
    const isLoggedIn = await CopilotAuthService.isLoggedIn();
    const auth = isLoggedIn ? await CopilotAuthService.getAuth() : null;

    const loggedOutEl = document.getElementById('copilot-logged-out');
    const loggedInEl = document.getElementById('copilot-logged-in');
    const loginBtn = document.getElementById('copilot-login-btn');
    const statusEl = document.getElementById('copilot-login-status');
    const usernameEl = document.getElementById('copilot-user-name');
    const codeSection = document.getElementById('copilot-code-section');
    const planBadgeEl = document.getElementById('copilot-plan-badge');
    const tokenExpiryEl = document.getElementById('copilot-token-expiry');

    if (isLoggedIn) {
      loggedOutEl?.classList.add('hidden');
      loggedInEl?.classList.remove('hidden');
      if (usernameEl) {
        const name = auth?.username || auth?.email || 'GitHub account';
        usernameEl.textContent = `@${name}`;
      }
      if (loginBtn) loginBtn.disabled = false;
      if (statusEl) statusEl.textContent = '';
      codeSection?.classList.add('hidden');

      // Populate token info (plan + expiry)
      try {
        const storedToken = await new Promise(r =>
          chrome.storage.local.get([CopilotAuthService.COPILOT_TOKEN_KEY], d => r(d[CopilotAuthService.COPILOT_TOKEN_KEY]))
        );
        if (planBadgeEl) {
          const sku = storedToken?.sku;
          let planLabel = 'Copilot';
          if (sku) {
            if (sku.includes('enterprise')) planLabel = 'Enterprise';
            else if (sku.includes('business')) planLabel = 'Business';
            else if (sku.includes('individual') || sku.includes('pro')) planLabel = 'Individual';
          }
          planBadgeEl.textContent = `✦ ${planLabel}`;
        }
        if (tokenExpiryEl && storedToken?.expiresAt) {
          const expiresIn = Math.max(0, Math.round((storedToken.expiresAt - Date.now()) / 60000));
          tokenExpiryEl.textContent = expiresIn > 0 ? `Token válido por ~${expiresIn}min` : 'Token expirado (será renovado)';
        } else if (tokenExpiryEl) {
          tokenExpiryEl.textContent = '';
        }
      } catch (_) { /* non-critical */ }

    } else {
      loggedOutEl?.classList.remove('hidden');
      loggedInEl?.classList.add('hidden');

      // Restore pending device code if popup was closed mid-auth
      try {
        const stored = await new Promise(r =>
          chrome.storage.local.get(['copilot_pending_code'], d => r(d.copilot_pending_code))
        );
        if (stored?.user_code && stored.expiresAt > Date.now()) {
          this._showCopilotCode(stored.user_code, stored.verification_uri);

          const resume = await CopilotAuthService.checkPendingAuthorizationOnce();
          if (resume.status === 'success') {
            await new Promise(r => chrome.storage.local.remove(['copilot_pending_code'], r));
            await this.refreshCopilotAuthUI();
            return;
          }

          if (resume.status === 'expired' || resume.status === 'denied') {
            await new Promise(r => chrome.storage.local.remove(['copilot_pending_code'], r));
            if (loginBtn) {
              loginBtn.disabled = false;
              loginBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="#ffffff" style="flex-shrink:0;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg><span>Login com GitHub</span>';
            }
            if (statusEl) {
              statusEl.textContent = resume.status === 'expired'
                ? 'Código expirado. Clique em Login com GitHub novamente.'
                : 'Autorização negada. Tente novamente.';
            }
            codeSection?.classList.add('hidden');
          }
        } else {
          // No pending code — reset to clean state
          if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="#ffffff" style="flex-shrink:0;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg><span>Login com GitHub</span>'; }
          if (statusEl) statusEl.textContent = '';
          codeSection?.classList.add('hidden');
        }
      } catch (_) {
        if (loginBtn) loginBtn.disabled = false;
        codeSection?.classList.add('hidden');
      }
    }

    // Update header dot indicator
    const dot = document.getElementById('copilot-status-dot');
    if (dot) dot.classList.toggle('hidden', !isLoggedIn);
    const copilotUserLabel = document.getElementById('copilot-btn-user');
    if (copilotUserLabel) {
      const rawName = isLoggedIn ? (auth?.username || auth?.email || '') : '';
      const userText = rawName && auth?.username ? `@${rawName}` : rawName;
      copilotUserLabel.textContent = userText;
      copilotUserLabel.classList.toggle('hidden', !userText);
    }
  },

  /** Copy the device code to clipboard with visual feedback */
  handleCopilotCopyCode() {
    const codeEl = document.getElementById('copilot-user-code');
    const feedbackEl = document.getElementById('copilot-copy-feedback');
    const code = codeEl?.textContent?.trim();
    if (!code || code === '--------') return;

    navigator.clipboard.writeText(code).then(() => {
      if (feedbackEl) {
        feedbackEl.textContent = 'Copiado!';
        setTimeout(() => { if (feedbackEl) feedbackEl.textContent = ''; }, 2000);
      }
      const btn = document.getElementById('copilot-copy-code-btn');
      if (btn) {
        btn.style.background = 'rgba(63,185,80,0.35)';
        setTimeout(() => { if (btn) btn.style.background = 'rgba(63,185,80,0.15)'; }, 1200);
      }
    }).catch(() => {
      if (feedbackEl) feedbackEl.textContent = 'Erro ao copiar';
    });
  },

  /** Send a test message to the Copilot API and show the result */
  async handleCopilotTestConnection() {
    const resultEl = document.getElementById('copilot-test-result');
    const btn = document.getElementById('copilot-test-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-rounded spin-loading" style="font-size:14px;">sync</span> Testando...';
    }
    if (resultEl) resultEl.textContent = '';

    try {
      const token = await CopilotAuthService.getValidToken();
      if (!token) {
 if (resultEl) resultEl.innerHTML ='<span style="color:#ff7b72;"> Sem token válido. Faça login novamente.</span>';
        return;
      }

      const apiUrl = await CopilotAuthService.getApiUrl();
      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Editor-Version': 'vscode/1.100.0',
          'Editor-Plugin-Version': 'copilot/1.300.0',
          'Copilot-Integration-Id': 'vscode-chat'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Reply with OK' }]
        })
      });

      if (response.ok) {
        const data = await response.json();
 const reply = data.choices?.[0]?.message?.content?.trim() ||'';
 if (resultEl) resultEl.innerHTML =`<span style="color:#3fb950;"> Conectado! Modelo respondeu:"${reply.slice(0, 40)}"</span>`;
        // Refresh token info since it may have been refreshed
        await this.refreshCopilotAuthUI();
      } else {
        const errText = await response.text().catch(() => '');
        const snippet = errText.slice(0, 120);
 if (resultEl) resultEl.innerHTML =`<span style="color:#ff7b72;"> HTTP ${response.status}: ${snippet}</span>`;
      }
    } catch (err) {
 if (resultEl) resultEl.innerHTML =`<span style="color:#ff7b72;"> ${err.message || String(err)}</span>`;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px;">bolt</span> Testar';
      }
    }
  },

  async _loadChatGPTModelValidationCache() {
    try {
      const data = await chrome.storage.local.get(['_chatgptCodexModelValidation']);
      const cached = data?._chatgptCodexModelValidation;
      if (!cached || typeof cached !== 'object') return null;
      return cached;
    } catch (_) {
      return null;
    }
  },

  async _saveChatGPTModelValidationCache(cache) {
    try {
      await chrome.storage.local.set({ _chatgptCodexModelValidation: cache });
    } catch (_) {
      // ignore cache failures
    }
  },

  async probeChatGPTCodexModel(model, retried = false) {
    const auth = await ChatGPTAuthService.getAuth();
    if (!auth?.accountId) {
      return { ok: false, reason: 'no-auth', unsupported: false, rateLimited: false };
    }

    const token = await ChatGPTAuthService.getValidToken();
    if (!token) {
      return { ok: false, reason: 'no-token', unsupported: false, rateLimited: false };
    }

    const body = {
      model,
      input: [{ role: 'user', content: 'Responda apenas OK.' }],
      stream: false,
      store: false
    };

    try {
      const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'chatgpt-account-id': auth.accountId
        },
        body: JSON.stringify(body)
      });

      if (response.status === 401 && !retried) {
        const refreshed = await ChatGPTAuthService.refreshToken();
        if (refreshed) return this.probeChatGPTCodexModel(model, true);
      }

      if (response.ok) {
        return { ok: true, reason: '', unsupported: false, rateLimited: false };
      }

      const errText = await response.text().catch(() => '');
      const unsupported = response.status === 400
        && /not\s+supported\s+when\s+using\s+Codex/i.test(errText || '');
      const rateLimited = response.status === 429;

      return {
        ok: false,
        reason: `${response.status}`,
        unsupported,
        rateLimited
      };
    } catch (_) {
      return { ok: false, reason: 'network', unsupported: false, rateLimited: false };
    }
  },

  async validateAndPruneChatGPTModels() {
    if (this._chatgptModelValidationRunning) return;
    const modelSelect = document.getElementById('select-chatgpt-model');
    const statusEl = document.getElementById('chatgpt-login-status');
    if (!modelSelect) return;

    const optionValues = [...modelSelect.querySelectorAll('option')]
      .map(opt => String(opt.value || '').trim())
      .filter(Boolean);
    if (!optionValues.length) return;

    this._chatgptModelValidationRunning = true;
    try {
      const ttlMs = 24 * 60 * 60 * 1000;
      const cached = await this._loadChatGPTModelValidationCache();
      const isFresh = cached?.ts && (Date.now() - cached.ts < ttlMs);
      const results = isFresh && cached?.results ? { ...cached.results } : {};

      if (!isFresh && statusEl) statusEl.textContent = 'Validando modelos compatíveis com Codex...';

      let hitRateLimit = false;
      for (const model of optionValues) {
        if (isFresh && (results[model] === 'ok' || results[model] === 'unsupported')) continue;

        const probe = await this.probeChatGPTCodexModel(model);
        if (probe.ok) {
          results[model] = 'ok';
        } else if (probe.unsupported) {
          results[model] = 'unsupported';
        } else if (probe.rateLimited) {
          hitRateLimit = true;
          break;
        } else if (!results[model]) {
          results[model] = 'unknown';
        }

        await new Promise(resolve => setTimeout(resolve, 250));
      }

      await this._saveChatGPTModelValidationCache({ ts: Date.now(), results });

      const unsupportedValues = new Set(optionValues.filter(v => results[v] === 'unsupported'));
      if (unsupportedValues.size > 0) {
        [...modelSelect.querySelectorAll('option')].forEach(opt => {
          const value = String(opt.value || '').trim();
          if (unsupportedValues.has(value)) opt.remove();
        });
      }

      const availableValues = [...modelSelect.querySelectorAll('option')]
        .map(opt => String(opt.value || '').trim())
        .filter(Boolean);

      if (!availableValues.length) {
        modelSelect.innerHTML = '<option value="gpt-5.2-codex">GPT-5.2-Codex</option>';
      }

      const settings = await SettingsModel.getSettings();
      const currentValue = String(settings.chatgptModel || '').trim();
      const finalValues = [...modelSelect.querySelectorAll('option')]
        .map(opt => String(opt.value || '').trim())
        .filter(Boolean);
      const finalModel = finalValues.includes(currentValue)
        ? currentValue
        : (finalValues[0] || 'gpt-5.2-codex');

      modelSelect.value = finalModel;
      if (finalModel !== currentValue) {
        await SettingsModel.saveSettings({ chatgptModel: finalModel });
      }

      if (statusEl) {
        if (unsupportedValues.size > 0) {
          statusEl.textContent = `${unsupportedValues.size} modelo(s) incompatível(is) removido(s).`;
        } else if (hitRateLimit) {
          statusEl.textContent = 'Validação parcial (limite temporário).';
        } else {
          statusEl.textContent = '';
        }
      }
    } finally {
      this._chatgptModelValidationRunning = false;
    }
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
      const suggestedStep = await this.determineCurrentStep();
      // When not a reopen (first-time setup still incomplete), always start at slide 0 (welcome)
      const startStep = isReopen ? suggestedStep : 0;

      if (isReopen) {
        // Show reopen UX: key status chips, change-key buttons, close-settings buttons
        this.view.setSettingsReopenMode(true);
        const settings = await SettingsModel.getSettings();
        // Refresh cache so hasOpenrouterKey() / hasGeminiKey() reflect stored values
        this._settingsCache = settings;
        this.view.showKeyStatus('groq', SettingsModel.isPresent(settings.groqApiKey));
        this.view.showKeyStatus('serper', SettingsModel.isPresent(settings.serperApiKey));
        this.view.showKeyStatus('gemini', SettingsModel.isPresent(settings.geminiApiKey));
        this.view.showKeyStatus('openrouter', SettingsModel.isPresent(settings.openrouterApiKey));
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
    return 5; // Gemini and OpenRouter are optional — go straight to last step
  },

  goToSetupStep(step) {
    let normalizedStep = Number(step);
    if (normalizedStep < 0) normalizedStep = 0;
    if (normalizedStep > 5) normalizedStep = 5;

    this.currentSetupStep = normalizedStep;
    this.view.showSetupStep(normalizedStep);
    if (normalizedStep === 2) {
      // Serper is optional; allow continuing without validation.
      this.view.enableNextButton('serper');
    }
    if (normalizedStep === 3) {
      // Gemini is optional; allow continuing to preferences without validation.
      this.view.enableNextButton('gemini');
    }
    if (normalizedStep === 4) {
      this.view.enableNextButton('openrouter');
    }
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
      let failReason = '';
      if (provider === 'groq') ok = await this.testGroqKey(key);
      if (provider === 'serper') ok = await this.testSerperKey(key);

      if (provider === 'openrouter') {
        const orCheck = await this.testOpenrouterKey(key);
        ok = !!orCheck?.ok;
        failReason = orCheck?.reason || '';
      }
      if (provider === 'gemini') {
        const geminiCheck = await this.testGeminiKey(key);
        ok = !!geminiCheck?.ok;
        failReason = geminiCheck?.reason || '';
      }

      if (ok) {
        this.view.setTestButtonLoading(provider, 'ok');
        this.view.setSetupStatus(provider, this.t('setup.status.ok'), 'ok');
        const providerLabel = provider === 'serper'
          ? this.t(this.getSelectedSearchProvider() === 'serpapi' ? 'provider.serpapi' : 'provider.serper')
          : provider.charAt(0).toUpperCase() + provider.slice(1);
        this.view.showToast(this.t('setup.toast.connectionOk', { provider: providerLabel }), 'success');
        input.classList.add('input-valid');
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
        if (provider === 'gemini' && failReason === 'quota') {
          const quotaMsg = 'Chave válida, mas o projeto Gemini está sem cota (HTTP 429). Trocar a chave no mesmo projeto não resolve.';
          this.view.setSetupStatus(provider, quotaMsg, 'fail');
          this.view.showToast(quotaMsg, 'warning');
        } else if (provider === 'gemini' && failReason === 'rate_limit') {
          const rateMsg = 'Gemini respondeu 429 por limite de taxa. Tente novamente em alguns segundos.';
          this.view.setSetupStatus(provider, rateMsg, 'fail');
          this.view.showToast(rateMsg, 'warning');
        } else if (provider === 'openrouter' && failReason === 'quota') {
          const quotaMsg = 'OpenRouter key valid, but account has no credit/quota.';
          this.view.setSetupStatus(provider, quotaMsg, 'fail');
          this.view.showToast(quotaMsg, 'warning');
        } else if (provider === 'openrouter' && failReason === 'rate_limit') {
          const rateMsg = 'OpenRouter returned 429 rate limit. Try again in a few seconds.';
          this.view.setSetupStatus(provider, rateMsg, 'fail');
          this.view.showToast(rateMsg, 'warning');
        } else {
          this.view.setSetupStatus(provider, this.t('setup.status.error'), 'fail');
          this.view.showToast(this.t('setup.toast.invalidKey'), 'error');
        }
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
      const url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: 'healthcheck' }],
          max_tokens: 1,
          temperature: 0
        })
      });

      if (response.ok) return { ok: true };

      const errText = await response.text().catch(() => '');
      if (response.status === 429) {
        if (/exceeded your current quota|plan and billing|quota/i.test(errText)) {
          return { ok: false, reason: 'quota' };
        }
        return { ok: false, reason: 'rate_limit' };
      }
      return { ok: false, reason: `http_${response.status}` };
    } catch (_) {
      return { ok: false, reason: 'network' };
    }
  },

  async testOpenrouterKey(key) {
    try {
      const url = 'https://openrouter.ai/api/v1/models';
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) return { ok: true };
      const errText = await response.text().catch(() => '');
      if (response.status === 429) return { ok: false, reason: 'rate_limit' };
      if (response.status === 402 || /insufficient|credit|quota/i.test(errText)) {
        return { ok: false, reason: 'quota' };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: 'invalid' };
      }
      return { ok: false, reason: `http_${response.status}` };
    } catch (_) {
      return { ok: false, reason: 'network' };
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
    // Reveal the key and sync the visibility toggle icon
    const input = this.view.elements[`input${cap}`];
    if (input) {
      input.type = 'text'; // Show the key
      // Sync the eye-icon so it shows "visibility_off" (key is now visible)
      const wrapper = input.closest('.ob-input-wrapper');
      const toggle = wrapper?.querySelector('.visibility-toggle .material-symbols-rounded');
      if (toggle) toggle.textContent = 'visibility_off';
      input.focus();
      input.select();
    }
    // Hide the change-key button itself
    const changeBtn = this.view.elements[`changeKey${cap}`];
    if (changeBtn) changeBtn.classList.add('hidden');
    // If the key-mgmt wrapper has no more visible buttons, hide the wrapper too
    const keyMgmtEl = this.view.elements[`keyMgmt${cap}`];
    if (keyMgmtEl) {
      const visibleBtns = keyMgmtEl.querySelectorAll('button:not(.hidden)');
      if (visibleBtns.length === 0) keyMgmtEl.classList.add('hidden');
    }
  },

  /**
   * Handle "Close settings" button click. Closes the onboarding panel.
   */
  handleCloseSettings() {
    this._isReopenMode = false;
    this.view.setSettingsReopenMode(false);
    this.view.setSetupVisible(false);
  },

  async handleRemoveSerperKey() {
    if (this.view.elements.inputSerper) {
      this.view.elements.inputSerper.value = '';
      this.view.elements.inputSerper.type = 'password';
    }

    const settings = await SettingsModel.getSettings();
    await SettingsModel.saveSettings({
      serperApiKey: '',
      requiredProviders: {
        ...(settings.requiredProviders || {}),
        serper: false
      }
    });

    this.resetProviderValidation('serper');
    this.view.showKeyStatus('serper', false);
    this.saveDraftKeys();

    this.view.setSetupStatus('serper', this.t('setup.status.serperMissing'), 'error');
    this.view.showToast(this.t('setup.toast.serperKeyRemoved'), 'success');
  },





  async handleRemoveOpenrouterKey() {
    if (this.view.elements.inputOpenrouter) {
      this.view.elements.inputOpenrouter.value = '';
      this.view.elements.inputOpenrouter.type = 'password';
    }

    const settings = await SettingsModel.getSettings();
    const forceGroq = settings.primaryProvider === 'openrouter';
    const payload = { openrouterApiKey: '' };
    if (forceGroq) payload.primaryProvider = 'groq';
    await SettingsModel.saveSettings(payload);
    this._settingsCache = { ...(this._settingsCache || {}), ...payload };

    this.resetProviderValidation('openrouter');
    this.view.showKeyStatus('openrouter', false);
    this.saveDraftKeys();

    if (forceGroq) {
      this.view.elements.pillOpenrouter?.classList.remove('active');
      this.view.elements.pillOpenrouterOb?.classList.remove('active');
      this.view.elements.pillGroq?.classList.add('active');
      this.view.elements.pillGroqOb?.classList.add('active');
      this.updateProviderHint('groq');
    }

    this.view.setSetupStatus('openrouter', this.t('setup.status.openrouterMissing'), 'error');
    this.view.showToast(this.t('setup.toast.openrouterKeyRemoved'), 'success');
  },

  async handleRemoveGeminiKey() {
    if (this.view.elements.inputGemini) {
      this.view.elements.inputGemini.value = '';
      this.view.elements.inputGemini.type = 'password';
    }

    const settings = await SettingsModel.getSettings();
    const forceGroq = settings.primaryProvider === 'gemini';
    const payload = { geminiApiKey: '' };
    if (forceGroq) payload.primaryProvider = 'groq';
    await SettingsModel.saveSettings(payload);
    this._settingsCache = { ...(this._settingsCache || {}), ...payload };

    this.resetProviderValidation('gemini');
    this.view.showKeyStatus('gemini', false);
    this.saveDraftKeys();

    if (forceGroq) {
      this.view.elements.pillGemini?.classList.remove('active');
      this.view.elements.pillGeminiOb?.classList.remove('active');
      this.view.elements.pillGroq?.classList.add('active');
      this.view.elements.pillGroqOb?.classList.add('active');
      this.updateProviderHint('groq');
    }

    this.view.setSetupStatus('gemini', this.t('setup.status.geminiMissing'), 'error');
    this.view.showToast(this.t('setup.toast.geminiKeyRemoved'), 'success');
  },

  async handleSaveSetup() {
    const groqApiKey = this.sanitizeKey(this.view.elements.inputGroq?.value);
    const serperApiKey = this.sanitizeKey(this.view.elements.inputSerper?.value);
    const openrouterApiKey = this.sanitizeKey(this.view.elements.inputOpenrouter?.value);
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
        openrouterApiKey,
        requiredProviders: {
          groq: true,
          serper: false,
          gemini: false
        }
      });
      this._settingsCache = {
        ...(this._settingsCache || {}),
        groqApiKey,
        serperApiKey,
        geminiApiKey,
        openrouterApiKey
      };

      this.onboardingFlags.setupDone = true;
      this.onboardingFlags.welcomed = true;

      await this.saveOnboardingFlags();
      await this.clearDraftKeys();

      this.view.setSettingsAttention(false);
      this.view.setSetupVisible(false);
      this.view.showToast(this.t('setup.toast.saved'), 'success');
      this.view.showConfetti();
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
        openrouter: this.view.elements.inputOpenrouter?.value || '',
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
      if (this.view.elements.inputOpenrouter && !this.view.elements.inputOpenrouter.value && drafts.openrouter) {
        this.view.elements.inputOpenrouter.value = drafts.openrouter;
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

      const withSaved = this._decorateWithSavedMeta(refined);

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

    // AH-PERF: End-to-end handleSearch timer
 const _pcTimer = PerformanceTimer.create(' handleSearch() — End-to-End');

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
      _pcTimer.mark('DOM Extraction (executeScript)');

      // ── Phase 2.1: Platform-specific extraction ──
      // Try a dedicated platform extractor first — much more accurate than generic heuristics.
      let platformResult = null;
      let detectedPlatform = null;
      try {
        const [platformDetect] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: PlatformExtractors.detectPlatformScript
        });
        detectedPlatform = platformDetect?.result || null;
        if (detectedPlatform) {
          const extractorFn = PlatformExtractors.getExtractorForPlatform(detectedPlatform);
          if (extractorFn) {
            const [pResult] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              function: extractorFn
            });
            if (pResult?.result && pResult.result.text && pResult.result.text.length >= 30) {
              platformResult = pResult.result;
              console.log(`AnswerHunter: PLATFORM_EXTRACTOR ${detectedPlatform} → ${platformResult.text.length} chars, confidence=${platformResult.confidence}, opts=${platformResult.optionCount}`);
            }
          }
        }
      } catch (platErr) {
        console.warn('AnswerHunter: Platform detection failed:', platErr?.message);
      }
      _pcTimer.mark('Platform Detection');

      // ── Phase 1.1: Viewport-centric extraction ──
      // Parallel extraction using elementFromPoint grid — finds the question by visual presence.
      let viewportResult = null;
      try {
        const [vpResult] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: ExtractionService.extractViewportCentricScript
        });
        if (vpResult?.result && vpResult.result.text && vpResult.result.text.length >= 30) {
          viewportResult = vpResult.result;
          console.log(`AnswerHunter: VIEWPORT_CENTRIC → ${viewportResult.text.length} chars, confidence=${viewportResult.confidence}, probes=${viewportResult.probeHits}, opts=${viewportResult.optionCount}`);
        }
      } catch (vpErr) {
        console.warn('AnswerHunter: Viewport-centric extraction failed:', vpErr?.message);
      }
      _pcTimer.mark('Viewport-centric Extraction');

      const countDistinctOptions = (text) => {
        if (!text) return 0;
        const matches = text.match(/(?:^|\n)\s*["'“”‘’]?\s*([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*\S/gi) || [];
        const letters = new Set(matches.map(m => m.trim().charAt(0).toUpperCase()));
        return letters.size;
      };

      const isValidOptionLine = (line) => {
        const m = String(line || '').trim().match(/^([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*(.+)$/i);
        if (!m) return false;
        let body = String(m[2] || '').replace(/\s+/g, ' ').trim();
        const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
        const idx = body.search(noise);
        if (idx > 1) body = body.slice(0, idx).trim();
        body = body.replace(/[;:,\-.\s]+$/, '');

        if (!body || body.length < 1) return false;
        if (/^[A-E]\s*(?:[\)\-:]|(?:\.\s))?\s*$/i.test(body)) return false;
        if (/^(?:[A-E]\s*(?:[\)\-:]|(?:\.\s))\s*){1,2}$/i.test(body)) return false;
        if (/^(?:resposta|gabarito|alternativa\s+correta)\b/i.test(body) && body.length < 60) return false;
        return true;
      };

      const looksLikeCodeOptionBody = (body) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?|\bdb\.\w|\.(find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(body || ''))
        // Also detect comma-separated DDL/DML keyword lists like "CREATE, ALTER, DROP"
        || /\b(?:ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(String(body || ''))
        || /^\s*(?:(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|SELECT|VALUES)(?:,\s*|\s+|$))+/i.test(String(body || '').trim());
      const isCompactOptionBody = (body) => {
        const value = String(body || '').trim();
        if (!value) return false;
        const words = value.split(/\s+/).filter(Boolean);
        if (words.length > 2) return false;
        if (value.length > 14) return false;
        return words.every((w) => /^[a-z0-9._+\-/#]+$/i.test(w));
      };
      const normalizeOptionBody = (body) => String(body || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/^[a-e]\s*(?:[\)\-:]|(?:\.\s))\s*/i, '')
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
        const re = /^["']?\s*([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*(.+)$/i;
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

      const buildOptionBodyMap = (text) => {
        const map = new Map();
        const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const re = /^["']?\s*([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*(.+)$/i;
        for (const line of lines) {
          const m = line.match(re);
          if (!m) continue;
          const letter = (m[1] || '').toUpperCase();
          const body = String(m[2] || '').replace(/\s+/g, ' ').trim();
          if (!isValidOptionLine(`${letter}) ${body}`)) continue;
          if (!map.has(letter) || body.length > String(map.get(letter) || '').length) {
            map.set(letter, body);
          }
        }
        return map;
      };

      const compareOptionsByLetter = (baseText, candidateText) => {
        const baseMap = buildOptionBodyMap(baseText);
        const candidateMap = buildOptionBodyMap(candidateText);
        let shared = 0;
        let matched = 0;

        for (const [letter, baseBody] of baseMap.entries()) {
          if (!candidateMap.has(letter)) continue;

          const baseTokenSet = new Set(optionTokens(baseBody));
          const candidateTokens = optionTokens(candidateMap.get(letter));
          if (baseTokenSet.size === 0 || candidateTokens.length === 0) continue;
          shared += 1;

          let overlap = 0;
          candidateTokens.forEach((tk) => {
            if (baseTokenSet.has(tk)) overlap += 1;
          });
          const minLen = Math.max(1, Math.min(baseTokenSet.size, candidateTokens.length));
          const overlapRatio = overlap / minLen;
          if (overlap >= 2 || overlapRatio >= 0.45) {
            matched += 1;
          }
        }

        const ratio = shared > 0 ? (matched / shared) : 0;
        const denseProfiles = baseMap.size >= 3 && candidateMap.size >= 3;
        const consistent = denseProfiles
          ? (shared >= 2 && ratio >= 0.5)
          : (shared < 3 || ratio >= 0.6);
        return {
          baseSize: baseMap.size,
          candidateSize: candidateMap.size,
          shared,
          matched,
          ratio,
          consistent
        };
      };

      // Cross-question contamination guard:
      // Returns false when extracted options look like they belong to a DIFFERENT question
      // from the captured stem. This prevents options from a visible question below/above
      // the target from being merged into the wrong stem.
      const optionsAreContextuallyRelated = (stemText, optionsTextToCheck) => {
        if (!stemText || !optionsTextToCheck) return true; // Can't determine—allow
        const normalizeTokens = (s) => String(s || '')
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim()
          .split(/\s+/)
          .filter(t => t.length >= 4);

        // Ignored stop words that appear in both stems and option lists (not discriminating)
        const stopWords = new Set([
          'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'questão',
          'considere', 'para', 'como', 'quando', 'cada', 'qual', 'onde', 'quais',
          'entre', 'sobre', 'essa', 'esse', 'este', 'esta'
        ]);

        const stemLines = stemText.split('\n').filter(l => !l.trim().match(/^([A-E])\s*[\)\.\-:]/i));
        const stemNorm = normalizeTokens(stemLines.join(' ')).filter(t => !stopWords.has(t));

        // Even when stem is short, check if options are pure code (SQL) for a non-code stem.
        // This catches cross-question contamination after multi-question isolation.
        if (stemNorm.length < 5) {
          const optionLinesShort = optionsTextToCheck.split('\n').filter(l => l.trim().match(/^([A-E])\s*[\)\.\-:]/i));
          if (optionLinesShort.length >= 3) {
            const optBodiesShort = optionLinesShort.map(l => l.replace(/^([A-E])\s*[\)\.\-:]\s*/i, '').trim());
            const isCodeLikeShort = (body) => /\b(?:INSERT\s+INTO|SELECT|UPDATE|DELETE|CREATE|ALTER|DROP|VALUES)\b/i.test(String(body || '')) || /\{.*:.*\}|=>|jsonb?|\bdb\.\w|\.(find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(body || ''));
            const codeLikeShort = optBodiesShort.filter(isCodeLikeShort).length;
            const stemExpectsCode = /\b(?:sql|jsonb?|insert|update|delete|select|comando|sintaxe|codigo|query|consulta)\b/i.test(stemLines.join(' '));
            if (codeLikeShort >= 3 && !stemExpectsCode) {
              console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected ${codeLikeShort} code-like options on short non-code stem. Options: "${optionLinesShort.slice(0, 2).join(' | ')}"`);
              return false;
            }
          }
          return true; // Stem too short for full analysis—allow (non-code cases)
        }

        const stemSet = new Set(stemNorm);

        const optionLines = optionsTextToCheck.split('\n').filter(l => l.trim().match(/^([A-E])\s*[\)\.\-:]/i));
        if (optionLines.length < 2) return true;

        const optBodies = optionLines.map(l => l.replace(/^([A-E])\s*[\)\.\-:]\s*/i, '').trim());
        const allOptTokens = normalizeTokens(optBodies.join(' ')).filter(t => !stopWords.has(t));
        const stemContextTokens = normalizeTokens(stemLines.join(' '));
        const acronymContextHints = new Set(['formato', 'arquivo', 'arquivos', 'extensao', 'documento', 'documentos', 'json', 'xml', 'bson', 'yaml', 'csv']);
        const hasAcronymContext = stemContextTokens.some((t) => acronymContextHints.has(t));
        const compactAtomicCount = optBodies.filter((body) => isCompactOptionBody(body)).length;
        const compactAtomicSet = optionLines.length >= 3 && compactAtomicCount / optionLines.length >= 0.8;

        // If options are ALL very short (=6 chars each, e.g. BSON, XLS, XML),
        // they're likely acronyms from a completely different question domain.
        const avgOptLength = optBodies.reduce((sum, b) => sum + b.length, 0) / optBodies.length;
        const allAcronym = avgOptLength <= 6 && optBodies.every(b => b.length <= 8);

        // Detect if options are pure code (SQL commands, etc)
        const isCodeLike = (body) => /\b(?:INSERT\s+INTO|SELECT|UPDATE|DELETE|CREATE|ALTER|DROP|VALUES)\b/i.test(String(body || '')) || /\{.*:.*\}|=>|jsonb?|\bdb\.\w|\.(find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(body || ''));
        const codeLikeCount = optBodies.filter(isCodeLike).length;
        const mostlyCodeLike = optionLines.length >= 3 && (codeLikeCount / optionLines.length) >= 0.6;

        if (allOptTokens.length === 0) {
          // All options are too short to produce tokens — might be all-acronym
          if (allAcronym || mostlyCodeLike) {
            if (optionLines.length >= 3 && hasAcronymContext && compactAtomicSet) {
              console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD allowed options (compact acronym/code set with contextual match). Options: "${optionLines.slice(0, 3).join(' | ')}"`);
              return true;
            }
            console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected options (all-acronym/code, no contextual stem match). Options: "${optionLines.slice(0, 3).join(' | ')}"`);
            return false;
          }
          return true;
        }

        let sharedTokens = 0;
        for (const tk of allOptTokens) {
          if (stemSet.has(tk)) sharedTokens++;
        }
        const overlapRatio = sharedTokens / allOptTokens.length;

        // Reject if there is ZERO overlap, UNLESS it's an acronym set with matching context
        if (overlapRatio === 0) {
          if (allAcronym) {
            if (optionLines.length >= 3 && hasAcronymContext && compactAtomicSet) {
              console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD allowed options (all-acronym with contextual stem match despite 0 token overlap). Options: "${optionLines.slice(0, 3).join(' | ')}"`);
              return true;
            }
            console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected options (all-acronym with 0 stem overlap and no contextual match). Options: "${optionLines.slice(0, 3).join(' | ')}"`);
            return false;
          }

          if (mostlyCodeLike) {
            // Allow if the stem itself is about SQL/code (e.g. "Qual conjunto de comandos SQL...").
            // The short-stem path already has this check; mirror it for the full-stem path.
            const stemExpectsCode = /\b(?:sql|ddl|dml|insert|update|delete|select|create|alter|drop|comando(?:s)?|sintaxe|c[oó]digo|query|consulta|linguagem\s+sql)\b/i.test(stemLines.join(' '));
            if (stemExpectsCode) {
              // SQL question with SQL options — contextually valid; skip all remaining checks.
              console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD allowed code-like options (stem expects SQL/code). Options: "${optionLines.slice(0, 3).join(' | ')}"`);
              return true;
            }
            console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected options (code-like with 0 stem overlap). Options: "${optionLines.slice(0, 3).join(' | ')}"`);
            return false;
          }

          // If options have enough tokens (not an acronym set), but ZERO match the stem,
          // they almost certainly belong to a different question.
          if (allOptTokens.length >= 3) {
            console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected options (0 stem token overlap out of ${allOptTokens.length} option tokens). Options: "${optionLines.slice(0, 3).join(' | ')}"`);
            return false;
          }
        }

        return true;
      };

      let bestQuestion = '';
      let bestScore = -1;
      let bestFrameIndex = -1;
      let isolationStrippedOcrOptions = false;
      let detectedMultiQuestionText = false;
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

      // ── Phase 2.1 + 1.1: Winner selection across extraction strategies ──
      // Platform extractor → Viewport-centric → Generic DOM (in priority order)
      let usedPlatformExtractor = false;
      let usedViewportCentric = false;
      if (platformResult && platformResult.confidence >= 0.85 && platformResult.text.length >= 50) {
        const platformOpts = countDistinctOptions(platformResult.text);
        const genericOpts = countDistinctOptions(bestQuestion);
        // Platform extractor wins if it has comparable or better structure
        if (platformOpts >= genericOpts || platformResult.confidence >= 0.9) {
          console.log(`AnswerHunter: EXTRACTION_WINNER=platform (${detectedPlatform}) opts=${platformOpts} confidence=${platformResult.confidence}`);
          bestQuestion = platformResult.text;
          usedPlatformExtractor = true;
        }
      }
      if (!usedPlatformExtractor && viewportResult && viewportResult.confidence >= 0.7) {
        const vpOpts = countDistinctOptions(viewportResult.text);
        const genericOpts = countDistinctOptions(bestQuestion);
        // Viewport wins if it has more options or the generic result looks weak
        if (vpOpts > genericOpts || (vpOpts === genericOpts && viewportResult.text.length > (bestQuestion || '').length * 0.8) || genericOpts < 2) {
          console.log(`AnswerHunter: EXTRACTION_WINNER=viewport probes=${viewportResult.probeHits} opts=${vpOpts} confidence=${viewportResult.confidence}`);
          bestQuestion = viewportResult.text;
          usedViewportCentric = true;
        }
      }

      // ── Phase 1.2: Create question fingerprint from first extraction ──
      // All subsequent steps validate against this fingerprint.
      const questionFingerprint = QuestionFingerprint.create(bestQuestion);
      console.log(`AnswerHunter: FINGERPRINT created tokens=[${questionFingerprint.tokens.join(', ')}]`);

      // -- Vision OCR priority --
      // OCR runs only when DOM extraction is insufficient (< 4 options or short text).
      // When DOM already captured a complete question, skip OCR entirely to save time.
      const domQuestion = bestQuestion;
      const domOptionCount = countDistinctOptions(domQuestion);
      let usedVisionOcr = false;
      let ocrVisionText = null; // Store OCR text for option fallback
      let ocrVisionOptionCount = 0;

      // Also count inline options (A) ... B) ... on same line, no preceding \n)
      const _domInlineRe = /\b([A-Ea-e])\s*[\)\.\-:]\s*\S/g;
      const _domInlineLetters = new Set();
      let _dim;
      while ((_dim = _domInlineRe.exec(domQuestion || '')) !== null) _domInlineLetters.add(_dim[1].toUpperCase());
      const domOptionCountInline = _domInlineLetters.size;
      const domEffectiveOptCount = Math.max(domOptionCount, domOptionCountInline);

      const domIsSufficient = domEffectiveOptCount >= 4 && (domQuestion || '').length >= 100 && isLikelyQuestion(domQuestion);
      console.log(`AnswerHunter: OCR_PRIORITY mode=conditional frame=${bestFrameIndex} dom_len=${(domQuestion || '').length} opts_dom=${domOptionCount} opts_dom_inline=${domOptionCountInline} dom_sufficient=${domIsSufficient}`);

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
                const inlineOptRe = /\b([A-Ea-e])\s*[\)\.\-:]\s*\S/g;
                const inlineLetters = new Set();
                let iom;
                while ((iom = inlineOptRe.exec(visionText)) !== null) inlineLetters.add(iom[1].toUpperCase());
                ocrVisionOptionCount = Math.max(visionOpts, inlineLetters.size);
                const domOptCount = domEffectiveOptCount;
                console.log(`AnswerHunter: OCR_COMPARE opts_ocr=${visionOpts} opts_dom=${domOptCount} len_ocr=${visionText.length} len_dom=${(domQuestion || '').length}`);
                console.log(`AnswerHunter: Vision OCR returned ${visionText.length} chars, ${visionOpts} options`);

                bestQuestion = visionText;
                usedVisionOcr = true;
                ocrVisionText = visionText; // Preserve OCR text even if DOM wins

                // ── Phase 1.3: OCR Multi-question isolation ──
                // Detect if OCR returned multiple questions (multiple option blocks A-E)
                // and isolate only the first/main one.
                {
                  const ocrLines = visionText.split('\n');
                  let optionBlockStarts = [];
                  let currentBlockStart = -1;
                  for (let li = 0; li < ocrLines.length; li++) {
                    const line = ocrLines[li].trim();
                    if (/^\s*["']?\s*A\s*[\)\.\-:]\s*\S/i.test(line)) {
                      // Found an 'A)' option — potential start of a new option block
                      if (currentBlockStart >= 0 && li - currentBlockStart > 1) {
                        // Previous block was real (had multiple lines)
                        optionBlockStarts.push(currentBlockStart);
                      }
                      currentBlockStart = li;
                    }
                  }
                  if (currentBlockStart >= 0) optionBlockStarts.push(currentBlockStart);

                  if (optionBlockStarts.length >= 2) {
                    // Multiple option blocks found — keep only the first question
                    const secondBlockStart = optionBlockStarts[1];
                    // Walk backwards from the second block to find stem separator
                    let cutLine = secondBlockStart;
                    for (let si = secondBlockStart - 1; si > 0; si--) {
                      const prevLine = ocrLines[si].trim();
                      if (/^\s*["']?\s*[D-E]\s*[\)\.\-:]\s*\S/i.test(prevLine) || /^\s*["']?\s*[C]\s*[\)\.\-:]\s*\S/i.test(prevLine)) {
                        cutLine = si + 1;
                        break;
                      }
                      // If we hit another numbered question header, cut there
                      if (/^\d{1,2}\s*[\.\)]\s+[A-ZÀ-Ö]/.test(prevLine)) {
                        cutLine = si;
                        break;
                      }
                    }
                    const isolatedOcr = ocrLines.slice(0, cutLine).join('\n').trim();
                    if (isolatedOcr.length >= 30 && countDistinctOptions(isolatedOcr) >= 2) {
                      console.log(`AnswerHunter: OCR_MULTI_Q_ISOLATION cut at line ${cutLine}/${ocrLines.length} (${optionBlockStarts.length} option blocks detected). Kept ${isolatedOcr.length}/${visionText.length} chars`);
                      bestQuestion = isolatedOcr;
                      ocrVisionText = isolatedOcr;
                    }
                  }
                }

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

                  // ── Stem enrichment: if DOM has a longer stem, merge DOM stem with OCR options ──
                  // OCR often captures options accurately but truncates the enunciado (context, code, headers).
                  // The DOM extraction may have the full stem even when it has fewer options.
                  // CRITICAL: only merge if DOM stem is about the SAME question (token overlap check).
                  if (domQuestion && domQuestion.length > 0) {
                    const ocrStemLines = visionText.split('\n').filter(l => !l.trim().match(/^([A-E])\s*[\)\.\-:]\s*/i));
                    const ocrStemText = ocrStemLines.join(' ').replace(/\s+/g, ' ').trim();
                    const ocrStemLen = ocrStemText.length;
                    const domStemLines = domQuestion.split('\n').filter(l => !l.trim().match(/^([A-E])\s*[\)\.\-:]\s*/i));
                    const domStemText = domStemLines.join(' ').replace(/\s+/g, ' ').trim();
                    const domStemLen = domStemText.length;

                    // Validate DOM stem is about the same question as OCR stem
                    const _normStem = (s) => String(s || '')
                      .toLowerCase()
                      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                      .replace(/[^a-z0-9]+/g, ' ').trim();
                    const ocrTokens = _normStem(ocrStemText).split(' ').filter(t => t.length >= 4);
                    const domTokenSet = new Set(_normStem(domStemText).split(' ').filter(t => t.length >= 4));
                    let stemOverlap = 0;
                    for (const t of ocrTokens) { if (domTokenSet.has(t)) stemOverlap++; }
                    const stemOverlapRatio = ocrTokens.length > 0 ? (stemOverlap / ocrTokens.length) : 0;
                    // DOM stem must contain at least 50% of OCR stem tokens to be the same question
                    const isSameQuestion = stemOverlapRatio >= 0.5 || (ocrStemLen < 40 && stemOverlap >= 2);

                    if (domStemLen > ocrStemLen * 1.5 && domStemLen >= 80 && isSameQuestion) {
                      // Phase 1.2: Also validate against initial fingerprint
                      const fpCheck = QuestionFingerprint.validateStemEnrichment(questionFingerprint, domStemText);
                      if (!fpCheck.valid) {
                        console.log(`AnswerHunter: STEM_ENRICHMENT rejected by FINGERPRINT — ${fpCheck.details}`);
                      } else {
                        // DOM stem is significantly longer AND about the same question — use it as the stem.
                        // CRITICAL: extract options from the already-isolated OCR text (bestQuestion),
                        // NOT from the full visionText which may contain options from other visible questions.
                        const _isolatedOcr = bestQuestion; // may have been trimmed by OCR_MULTI_Q_ISOLATION
                        const _isolatedStemLines = _isolatedOcr.split('\n').filter(l => !l.trim().match(/^([A-E])\s*[\)\.\-:]\s*/i));
                        const _isolatedStemText = _isolatedStemLines.join(' ').replace(/\s+/g, ' ').trim();
                        const ocrOptLines = _isolatedOcr.split('\n').filter(l => l.trim().match(/^([A-E])\s*[\)\.\-:]\s*/i));

                        // ── General cross-question contamination guard ──
                        // Validate that the OCR options are internally consistent with the OCR stem
                        // (both extracted from the same isolated OCR block). If they don't match,
                        // the visible viewport showed a different question than the one the user intends
                        // to answer. In that case, revert to the full-page DOM so multi-question
                        // isolation can find the correct question independently of the OCR.
                        const _ocrInternallyConsistent = ocrOptLines.length < 2
                          || optionsAreContextuallyRelated(_isolatedStemText || ocrStemText, ocrOptLines.join('\n'));

                        if (!_ocrInternallyConsistent) {
                          // OCR options don't match the OCR stem → the options came from a different
                          // question visible in the viewport. Revert to full-page DOM so the correct
                          // question can be isolated via the multi-question isolation step.
                          bestQuestion = domQuestion;
                          usedVisionOcr = false;
                          console.log(`AnswerHunter: STEM_ENRICHMENT rejected — OCR options (${ocrOptLines.length}) not consistent with OCR stem (cross-question contamination). Reverted to DOM.`);
                        } else {
                          bestQuestion = `${domStemText}\n${ocrOptLines.join('\n')}`.trim();
                          console.log(`AnswerHunter: STEM_ENRICHMENT merged DOM stem (${domStemLen} chars) with OCR options (${ocrOptLines.length}). OCR stem was ${ocrStemLen} chars. Overlap=${stemOverlapRatio.toFixed(2)} FP=${fpCheck.details}`);
                        }
                      }
                    } else if (domStemLen > ocrStemLen * 1.5 && domStemLen >= 80) {
                      console.log(`AnswerHunter: STEM_ENRICHMENT rejected — DOM stem appears to be a DIFFERENT question (overlap=${stemOverlapRatio.toFixed(2)}, shared=${stemOverlap}/${ocrTokens.length})`);
                    }
                  }
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

      // ── Context recovery: OCR gave short text (question preamble above scroll) ──
      // Find the element containing the OCR fragment, walk up the DOM tree to get the full context.
      // Uses textContent (no layout reflow = no scroll) instead of innerText.
      const preCtxOptionCount = countDistinctOptions(bestQuestion || '');

      // Compute stem length (non-option text) to detect truncated enunciados
      const _stemOnlyLines = String(bestQuestion || '').split('\n')
        .filter(line => !line.trim().match(/^([A-E])\s*[\)\.\-:]\s*/i));
      const _stemLength = _stemOnlyLines.join(' ').replace(/\s+/g, ' ').trim().length;
      // If the stem is suspiciously short (< 150 chars) but we have options,
      // the OCR/extraction likely missed the full question context (headers, code, etc.)
      const stemLooksIncomplete = _stemLength > 0 && _stemLength < 150 && preCtxOptionCount >= 2;

      const shouldTryContextRecovery =
        !!bestQuestion &&
        (bestQuestion.length < 400 || stemLooksIncomplete) &&
        (bestFrameIndex === -1 || stemLooksIncomplete) &&
        (preCtxOptionCount < 4 || stemLooksIncomplete);

      if (shouldTryContextRecovery) {
        try {
          const ctxResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: (shortText) => {
              const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
              const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
              const shortNorm = norm(shortText).substring(0, 80);
              if (!shortNorm || shortNorm.length < 15) return '';

              // 1) Find the leaf element that contains the OCR fragment
              const all = Array.from(document.querySelectorAll('p,span,div,li,td,h1,h2,h3,h4,section,article'));
              let target = null;
              for (const el of all) {
                const tc = clean(el.textContent);
                if (tc.length < 30 || tc.length > 12000) continue;
                if (norm(tc).includes(shortNorm)) { target = el; break; }
              }
              if (!target) {
                // fallback: search body text for fragment and return window around it
                // Use toLowerCase (doesn't change length) so indices stay valid
                const bodyText = clean(document.body.textContent);
                const searchFrag = shortText.substring(0, 40).toLowerCase();
                const idx = bodyText.toLowerCase().indexOf(searchFrag);
                if (idx >= 0) {
                  const start = Math.max(0, idx - 600);
                  return bodyText.substring(start, idx + shortText.length + 300);
                }
                return '__NOTFOUND__';
              }

              // 2) Walk up to find a parent with more context (preamble above question)
              // Keep the largest ancestor still under 3500 chars (avoids including other questions)
              let ctx = target;
              let bestCtx = target;
              for (let i = 0; i < 10; i++) {
                const parent = ctx.parentElement;
                if (!parent || parent === document.body || parent === document.documentElement) break;
                ctx = parent;
                const ptc = clean(ctx.textContent);
                if (ptc.length >= 3500) break; // would include too much
                if (ptc.length > clean(bestCtx.textContent).length + 30) bestCtx = ctx;
              }
              return clean(bestCtx.textContent).substring(0, 3000);
            },
            // When stem looks incomplete, use the stem text as search anchor (not options)
            args: [stemLooksIncomplete ? _stemOnlyLines.join(' ').trim().substring(0, 120) : bestQuestion.substring(0, 120)]
          });
          const normalizeCtx = (s) => String(s || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9 ]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const overlapScore = (a, b) => {
            const ta = new Set(normalizeCtx(a).split(' ').filter((t) => t.length >= 4).slice(0, 24));
            const tb = new Set(normalizeCtx(b).split(' ').filter((t) => t.length >= 4).slice(0, 64));
            if (ta.size === 0 || tb.size === 0) return 0;
            let hit = 0;
            ta.forEach((t) => { if (tb.has(t)) hit += 1; });
            return hit / ta.size;
          };

          const currentOptCount = countDistinctOptions(bestQuestion || '');
          const candidates = (ctxResults || [])
            .map((r) => String(r?.result || ''))
            .filter((t) => t && t !== '__NOTFOUND__' && t.length > (stemLooksIncomplete ? _stemLength + 20 : bestQuestion.length + 40));

          let ctxText = '';
          let bestCtxScore = 0;
          // Similarity threshold: use 0.45 when stem is incomplete (expanded text
          // has more content), but not too low to avoid cross-question contamination
          const similarityThreshold = stemLooksIncomplete ? 0.45 : 0.55;
          for (const candidate of candidates) {
            const similarity = overlapScore(bestQuestion, candidate);
            const candidateOptCount = countDistinctOptions(candidate);
            const keepsOptions = candidateOptCount >= Math.max(2, currentOptCount - 1);
            const likelySameQuestion = similarity >= similarityThreshold;
            const score = similarity + (keepsOptions ? 0.08 : -0.2);
            if (likelySameQuestion && score > bestCtxScore) {
              bestCtxScore = score;
              ctxText = candidate;
            }
          }

          if (ctxText) {
            // Final guard: verify the recovered context contains the original stem tokens
            // to avoid replacing with an entirely different question from the DOM
            const _ctxNorm = normalizeCtx(ctxText);
            const _origStemNorm = normalizeCtx(
              stemLooksIncomplete ? _stemOnlyLines.join(' ').trim() : bestQuestion
            );
            const _origTokens = _origStemNorm.split(' ').filter(t => t.length >= 4).slice(0, 12);
            let _ctxHits = 0;
            for (const t of _origTokens) { if (_ctxNorm.includes(t)) _ctxHits++; }
            const _ctxContainsStem = _origTokens.length === 0 || (_ctxHits / _origTokens.length) >= 0.5;

            if (_ctxContainsStem) {
              // Phase 1.2: Validate against fingerprint
              const fpCtxCheck = QuestionFingerprint.validateContextRecovery(questionFingerprint, ctxText);
              if (!fpCtxCheck.valid) {
                console.log(`AnswerHunter: CONTEXT_RECOVERY rejected by FINGERPRINT — ${fpCtxCheck.details}`);
              } else {
                console.log(`AnswerHunter: CONTEXT_RECOVERY expanded ${bestQuestion.length} → ${ctxText.length} chars (score=${bestCtxScore.toFixed(2)}, stemHits=${_ctxHits}/${_origTokens.length}, FP=${fpCtxCheck.details})`);
                bestQuestion = ctxText;
              }
            } else {
              console.log(`AnswerHunter: CONTEXT_RECOVERY rejected — expanded text is a DIFFERENT question (stemHits=${_ctxHits}/${_origTokens.length}, score=${bestCtxScore.toFixed(2)})`);
            }
          } else {
            console.log(`AnswerHunter: CONTEXT_RECOVERY rejected expansion (bestScore=${bestCtxScore.toFixed(2)}; results=${(ctxResults || []).map(r => String(r?.result || '').length).join(',')})`);
          }
        } catch (e) {
          console.warn('AnswerHunter: CONTEXT_RECOVERY failed:', e?.message);
        }
      } else if (bestQuestion && stemLooksIncomplete) {
        console.log(`AnswerHunter: CONTEXT_RECOVERY skipped (conditions not met) stemLen=${_stemLength} opts=${preCtxOptionCount}`);
      } else if (bestQuestion && bestQuestion.length < 400 && usedVisionOcr && ocrVisionOptionCount >= 4) {
        console.log(`AnswerHunter: CONTEXT_RECOVERY skipped (trusted OCR options=${ocrVisionOptionCount})`);
      }

      if (!bestQuestion || bestQuestion.length < 5) {
        this.view.showStatus('error', this.t('status.selectQuestionText'));
        return;
      }

      // ── Multi-question isolation ──
      // When the page shows multiple numbered questions (e.g. Estácio "Conteúdo" pages),
      // the extractor may return all of them. Detect this and keep only the one
      // whose number is most centered in the viewport.
      // NOTE: delimiter [.)] is optional — some pages (e.g. Estácio provas) use
      // bare numbers like "1 É um formato..." without dot or paren.
      // Uses \b (word boundary) to also detect numbers mid-line (single-line DOM text).
      const multiQRe = /(?:^|\n|\b)(\d{1,2})\s*[\.\)]?\s+(?=[A-ZÀ-ÖÙ-ÝÉ])/g;
      const qNumbersRaw = [];
      let qm;
      while ((qm = multiQRe.exec(bestQuestion)) !== null) {
        qNumbersRaw.push({ num: parseInt(qm[1], 10), index: qm.index });
      }
      // Filter: keep only plausible sequential question numbers (e.g. 1,2,3 or 1,2,3,4,5).
      // Reject isolated large numbers or non-sequential gaps that are likely noise.
      const qNumbers = [];
      for (const q of qNumbersRaw) {
        if (q.num >= 1 && q.num <= 50) qNumbers.push(q);
      }
      // Validate sequentiality: each successive question number should be ≤ previous + 3
      if (qNumbers.length >= 2) {
        const sorted = [...qNumbers].sort((a, b) => a.num - b.num);
        const isSequential = sorted.every((q, i) => i === 0 || (q.num - sorted[i - 1].num) <= 3);
        if (!isSequential) qNumbers.length = 0; // reject non-sequential
      }

      if (qNumbers.length >= 2) {
        detectedMultiQuestionText = true;
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
                const m = text.match(/^\s*(\d{1,2})\s*[.)]?\s+/);
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
              let isolated = bestQuestion.substring(startIdx, endIdx).trim();
              // Strip leading question number prefix (e.g. "1 ", "2. ", "3) ")
              isolated = isolated.replace(/^\s*\d{1,2}\s*[\.\)]?\s+/, '');
              if (isolated.length >= 30) {
                const preIsoOptCount = countDistinctOptions(bestQuestion);
                console.log(`AnswerHunter: Isolated question ${targetQNum} (was extracting from question ${qNumbers[0].num})`);
                bestQuestion = isolated;
                const postIsoOptCount = countDistinctOptions(bestQuestion);
                // If isolation stripped options, they belonged to a different question's
                // section in the multi-question text. Invalidate ocrVisionText to prevent
                // OCR_OPTIONS_FALLBACK from re-injecting those stale options.
                if (preIsoOptCount >= 2 && postIsoOptCount === 0) {
                  isolationStrippedOcrOptions = true;
                  const ocrVisionTextBackup = ocrVisionText;
                  if (ocrVisionText) ocrVisionText = null;
                  console.log(`AnswerHunter: OCR_OPTIONS_INVALIDATED — isolation removed ${preIsoOptCount} options that belonged to a different question section. Unanchored DOM scan skipped; anchored/structural recovery will proceed.`);
                  console.log(`AnswerHunter: OCR_OPTIONS_INVALIDATED_DIAG — isolatedQ=${targetQNum}, isolatedLen=${isolated.length}, preOpts=${preIsoOptCount}, postOpts=${postIsoOptCount}, stemPreview="${isolated.substring(0, 120)}"`);
                }
              }
            }
          }
        } catch (isoErr) {
          console.warn('AnswerHunter: Multi-question isolation failed, using full text:', isoErr);
        }
      }

      if (!isLikelyQuestion(bestQuestion)) {
        console.log('AnswerHunter: bestQuestion (raw, pre-options) →', bestQuestion.substring(0, 200));
        this.view.showStatus('loading', this.t('status.validatingQuestion'));
        const valid = await ApiService.validateQuestion(bestQuestion);
        if (!valid) {
          this.view.showStatus('error', this.t('status.invalidQuestion'));
          return;
        }
      }

      // ── Normalize inline options to separate lines ──
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
          // Split inline options onto separate lines.
          // Handle both "A) text" (delimiter + space) and "A .csv" (space + delimiter + text) formats.
          bestQuestion = bestQuestion.replace(/(\S)\s+([a-eA-E]\s*(?:[\)\-:]|(?:\.\s))\S?)/g, '$1\n$2');
          console.log(`AnswerHunter: INLINE_OPTIONS_SPLIT inline=${inlineDetected} wasOnLines=${lineDetected} nowOnLines=${countDistinctOptions(bestQuestion)}`);
        }
      }

      // If OCR/DOM injected options from another visible question, drop them early.
      {
        const optionLinesFromBest = String(bestQuestion || '')
          .split('\n')
          .filter((line) => line.trim().match(/^([A-E])\s*[\)\.\-:]\s+/i));
        if (optionLinesFromBest.length >= 2) {
          const stemOnly = String(bestQuestion || '')
            .split('\n')
            .filter((line) => !line.trim().match(/^([A-E])\s*[\)\.\-:]\s+/i))
            .join('\n')
            .trim();
          const optionsOnly = optionLinesFromBest.join('\n');
          if (!optionsAreContextuallyRelated(stemOnly, optionsOnly)) {
            bestQuestion = stemOnly || bestQuestion;
            console.log('AnswerHunter: OPTIONS_CONTAMINATION_GUARD removed unrelated options from primary question text');
          }
        }
      }

      let displayQuestion = bestQuestion;
      const existingOptionCount = countDistinctOptions(bestQuestion);

      // Always try to extract options separately when we have fewer than 5,
      // so we don't miss any alternatives (e.g. option E on a different DOM element).
      const shouldScanDomOptions = existingOptionCount < 5;
      if (shouldScanDomOptions) {
        if (usedVisionOcr) {
          console.log(`AnswerHunter: OCR_PRIORITY post-step=dom_options_scan force=true opts_current=${existingOptionCount}`);
        }
        let optionsResults = [];

        // First, try extracting options from the SAME frame selected for the question text.
        // This avoids mixing alternatives from another frame/question.
        // SKIP when isolation stripped OCR options — extractOptionsOnlyScript returns ALL
        // page options without anchoring, so it picks up options from other questions.
        // DOM_STRUCTURAL_OPTIONS (anchor-based) will handle this case instead.
        if (Number.isFinite(bestFrameIndex) && bestFrameIndex >= 0 && !isolationStrippedOcrOptions) {
          try {
            optionsResults = await chrome.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [bestFrameIndex] },
              function: ExtractionService.extractOptionsOnlyScript
            });
          } catch (_) {
            optionsResults = [];
          }
        }

        // Use the isolated/selected question stem, NOT the full-page DOM text.
        // Using domQuestion (full page) causes false token overlap from other questions' SQL keywords,
        // making the contamination guard useless on multi-question pages.
        const stemForOptions = String(bestQuestion || domQuestion || '')
          .split('\n')
          .filter((line) => !line.trim().match(/^([A-E])\s*[\)\.\-:]/i))
          .join('\n')
          .trim();
        const stemTokenCount = normalizeOptionBody(stemForOptions)
          .split(/\s+/)
          .filter((t) => t.length >= 4)
          .length;

        const pickBestOptionsText = (resultsArray) => {
          let bestAnyText = '';
          let bestAnyScore = -1;
          let bestContextText = '';
          let bestContextScore = -1;

          (resultsArray || []).forEach((frameResult) => {
            const text = String(frameResult?.result || '');
            if (text.length < 10) return;
            const optCount = countDistinctOptions(text);
            if (optCount < 2) return;

            const lines = text
              .split('\n')
              .map((line) => String(line || '').trim())
              .filter((line) => /^([A-E])\s*[\)\.\-:]\s+.+$/i.test(line));
            const bodies = lines.map((line) => line.replace(/^([A-E])\s*[\)\.\-:]\s*/i, '').trim());
            const avgBodyLen = bodies.length > 0
              ? (bodies.reduce((sum, b) => sum + b.length, 0) / bodies.length)
              : 0;
            const acronymCluster = bodies.length >= 3 && avgBodyLen <= 6 && bodies.every((b) => b.length <= 8);

            let localScore = (optCount * 1000) + Math.min(text.length, 2500) / 10;
            if (acronymCluster && stemTokenCount >= 8) localScore -= 1200;

            const contextOk = optionsAreContextuallyRelated(stemForOptions || bestQuestion, text);
            if (localScore > bestAnyScore) {
              bestAnyScore = localScore;
              bestAnyText = text;
            }
            if (contextOk && localScore > bestContextScore) {
              bestContextScore = localScore;
              bestContextText = text;
            }
          });

          if (bestContextText) return bestContextText;
          // In multi-question pages, never trust non-contextual options from generic scans.
          if (detectedMultiQuestionText) return '';
          if (bestAnyText && stemTokenCount >= 8 && !optionsAreContextuallyRelated(stemForOptions || bestQuestion, bestAnyText)) {
            return '';
          }
          return bestAnyText;
        };

        let optionsText = pickBestOptionsText(optionsResults);

        // Use the isolated question as anchor to find the correct question container in the DOM.
        // ocrVisionText might contain text from OTHER questions, so prefer bestQuestion.
        const anchorSeedText = bestQuestion || ocrVisionText || domQuestion;
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

                const isCodeLike = (body) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?|\bdb\.\w|\.(find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(body || ''));

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
                    let body = String(current.body || '').replace(/\s+/g, ' ').trim();
                    const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
                    const idx = body.search(noise);
                    if (idx > 1) body = body.slice(0, idx).trim();
                    body = body.replace(/[;:,\-.\s]+$/, '');

                    if (!/^[A-E]$/.test(letter)) {
                      current = null;
                      return;
                    }
                    if (!body || body.length < 1 || seen.has(letter)) {
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
                  'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'questão',
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

                  // Find the line where the question stem starts to avoid extracting options from previous questions
                  const rawLines = raw.split(/\n/);
                  let bestLineIdx = 0;
                  let maxLineHits = 0;

                  for (let i = 0; i < rawLines.length; i++) {
                    const lineNorm = normalize(rawLines[i]);
                    if (!lineNorm) continue;
                    let lineHits = 0;
                    for (const tk of anchorTokens) if (lineNorm.includes(tk)) lineHits++;

                    if (lineHits > maxLineHits) {
                      maxLineHits = lineHits;
                      bestLineIdx = i;
                      // Strong match found in this line, stop to avoid matching a repeated stem later
                      if (lineHits >= 4) break;
                    }
                  }

                  // Crop text from just before the matched line downwards
                  const croppedRaw = rawLines.slice(Math.max(0, bestLineIdx - 1)).join('\n');

                  const extracted = extractOptionLines(croppedRaw);
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
            const anchoredRelated = optionsAreContextuallyRelated(stemForOptions || bestQuestion, anchoredText);
            const currentRelated = optionsText
              ? optionsAreContextuallyRelated(stemForOptions || bestQuestion, optionsText)
              : false;
            if (anchoredCount >= 2 && !anchoredRelated) {
              console.log(`AnswerHunter: HTML_ANCHORED_OPTIONS rejected=${anchoredCount} (context mismatch)`);
            } else if (anchoredCount >= 2 && (anchoredCount > currentCount || usedVisionOcr || (anchoredCount === currentCount && !currentRelated))) {
              optionsText = anchoredText;
              console.log(`AnswerHunter: HTML_ANCHORED_OPTIONS used=${anchoredCount} (replaced previous=${currentCount})`);
            } else if (anchoredCount >= 2) {
              console.log(`AnswerHunter: HTML_ANCHORED_OPTIONS found=${anchoredCount} (kept current=${currentCount})`);
            }
          } catch (anchErr) {
            console.warn('AnswerHunter: HTML anchored options extraction failed:', anchErr?.message || anchErr);
          }
        }

        // DOM-structural fallback: find the question container via text matching, then extract
        // options using textContent (reads full DOM tree, no layout/visibility restriction)
        // and structural selectors (li, label, radio groups). No scroll needed.
        if (Number.isFinite(bestFrameIndex) && bestFrameIndex >= 0 && countDistinctOptions(optionsText || '') < 5) {
          try {
            const [scannedResult] = await chrome.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [bestFrameIndex] },
              function: (anchorText, preferCode) => {
                const normalize = (s) => String(s || '')
                  .toLowerCase()
                  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                  .replace(/[^a-z0-9]+/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                const isCodeLike = (body) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?|\bdb\.\w|\.(find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(body || ''));
                const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;

                const stop = new Set([
                  'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'questão',
                  'considere', 'tabela', 'dados', 'produto', 'produtos', 'registro', 'registros',
                  'para', 'com', 'sem', 'dos', 'das', 'uma', 'de', 'da', 'do', 'e', 'o', 'a',
                  'os', 'as', 'no', 'na', 'em', 'por', 'ou', 'ao', 'aos'
                ]);

                const anchorTokens = normalize(anchorText)
                  .split(' ')
                  .filter((t) => t.length >= 4 && !stop.has(t))
                  .slice(0, 18);
                if (anchorTokens.length < 4) return '';

                const cleanBody = (s) => {
                  let b = String(s || '').replace(/\s+/g, ' ').trim();
                  const idx = b.search(noise);
                  if (idx > 1) b = b.slice(0, idx).trim();
                  return b.replace(/[;:,\-.\s]+$/, '');
                };

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
                    const body = cleanBody(current.body);
                    if (!/^[A-E]$/.test(letter) || !body || seen.has(letter)) { current = null; return; }
                    seen.add(letter);
                    out.push(`${letter}) ${body}`);
                    current = null;
                  };
                  for (const line of lines) {
                    const m = line.match(startRe);
                    if (m) { flush(); current = { letter: m[1], body: m[2] }; continue; }
                    if (current && !/^\d+\s*[\)\.\-:]/.test(line) && !/^(?:quest[aã]o|aula)\b/i.test(line)) {
                      current.body = `${current.body} ${line}`.replace(/\s+/g, ' ').trim();
                    }
                  }
                  flush();
                  return out.slice(0, 5);
                };

                // ── Strategy 1: structural selectors (li, label, radio groups) ─────────────
                // Finds the question container first via text matching, then queries option
                // elements within it. Uses textContent so off-screen elements are included.
                const tryStructural = () => {
                  const OPTION_SELECTORS = [
                    'button[data-testid^="alternative-"]', '[data-testid^="alternative-"]',
                    'button[data-element="link_resposta"]',
                    'li[data-letra]', 'li[data-letter]', 'li[data-option]', 'li[data-alternativa]',
                    '[class*="alternativ"] li', '[class*="option"] li', '[class*="opcao"] li',
                    '[class*="choice"] li', '[class*="alternativ"]', '[class*="resposta"]',
                    'label[for^="option"]', '.radio-option',
                    'label:has(input[type="radio"])', 'label:has(input[type="checkbox"])',
                    '[role="radio"]', '[role="option"]',
                  ];

                  const containers = Array.from(document.querySelectorAll(
                    'section, article, main, form, [data-question], [data-questao], [data-testid], div'
                  ));

                  // Find best-matching container via textContent token hits
                  let bestContainer = null;
                  let bestHits = 3; // require at least 4 hits
                  for (const el of containers) {
                    const tc = String(el?.textContent || '');
                    if (tc.length < 100 || tc.length > 200000) continue;
                    const norm = normalize(tc);
                    let hits = 0;
                    for (const tk of anchorTokens) if (norm.includes(tk)) hits++;
                    // Prefer smaller containers (more specific) when hits are equal
                    if (hits > bestHits || (hits === bestHits && bestContainer && tc.length < String(bestContainer.textContent || '').length)) {
                      bestHits = hits;
                      bestContainer = el;
                    }
                  }
                  if (!bestContainer) return [];

                  // Try each selector group within the identified container
                  for (const sel of OPTION_SELECTORS) {
                    try {
                      const items = Array.from(bestContainer.querySelectorAll(sel));
                      if (items.length < 2) continue;
                      const merged = new Map();
                      const startRe = /^["']?\s*([A-E])\s*[\)\.\-:\s]/i;
                      for (const item of items.slice(0, 10)) {
                        const text = String(item?.textContent || '').replace(/\s+/g, ' ').trim();
                        if (!text || text.length < 2) continue;

                        // --- Smart letter/body extraction (handles platform-specific elements) ---
                        let letter = null;
                        let bodyText = text;

                        // Strategy 1: dedicated child element for letter (e.g. Estácio circle-letter)
                        if (item.querySelector) {
                          const letterEl = item.querySelector('[data-testid="circle-letter"]')
                            || item.querySelector('[class*="letter"], [class*="letra"]')
                            || null;
                          if (letterEl) {
                            const lt = (letterEl.textContent || '').trim();
                            if (/^[A-E]$/i.test(lt)) {
                              letter = lt.toUpperCase();
                              // Get body from a dedicated text child, avoiding the concatenated textContent
                              const textEl = item.querySelector('[data-testid="question-typography"]')
                                || item.querySelector('p, div:not([class*="letter"]):not([class*="letra"])');
                              if (textEl) {
                                bodyText = String(textEl.textContent || '').replace(/\s+/g, ' ').trim();
                              } else {
                                // Fallback: remove the letter from the full textContent
                                bodyText = text.replace(new RegExp('^' + letter + '\\s*'), '').trim();
                              }
                            }
                          }
                        }

                        // Strategy 2: regex with delimiter (e.g. "A) Nenhum SQL")
                        if (!letter) {
                          const m = text.match(startRe);
                          if (m) {
                            letter = m[1].toUpperCase();
                            bodyText = text.replace(startRe, '').trim();
                          }
                        }

                        // Strategy 3: concatenated letter without delimiter (e.g. "ANenhum SQL")
                        if (!letter && /^[A-E][A-ZÁÉÍÓÚÂÊÔÃÕÇÜ]/i.test(text)) {
                          letter = text[0].toUpperCase();
                          bodyText = text.substring(1).trim();
                        }

                        // Strip any residual leading letter+delimiter from body
                        if (letter) {
                          bodyText = bodyText.replace(/^[A-E]\s*[\)\.\-:]\s*/i, '').trim();
                          // Also strip bare letter prefix if it matches the detected letter
                          if (new RegExp('^' + letter + '\\s+', 'i').test(bodyText)) {
                            bodyText = bodyText.replace(new RegExp('^' + letter + '\\s+', 'i'), '').trim();
                          }
                        }

                        if (letter && !merged.has(letter)) {
                          const body = cleanBody(bodyText);
                          if (body) merged.set(letter, body);
                        } else if (!letter && merged.size < 5) {
                          // Unlabeled items: assign letters in order
                          const next = ['A', 'B', 'C', 'D', 'E'].find(l => !merged.has(l));
                          if (next) merged.set(next, cleanBody(text));
                        }
                      }
                      if (merged.size >= 2) {
                        const order = ['A', 'B', 'C', 'D', 'E'];
                        return order.filter(l => merged.has(l)).map(l => `${l}) ${merged.get(l)}`);
                      }
                    } catch (_) { /* selector may not be supported */ }
                  }

                  // Fallback within container: use textContent of the best container
                  const raw = String(bestContainer.textContent || '').replace(/\r/g, '\n').trim();
                  return extractOptionLines(raw);
                };

                // ── Strategy 2: full-DOM textContent scan (like anchored, but textContent) ─
                const tryTextContent = () => {
                  const containers = Array.from(document.querySelectorAll(
                    'section, article, main, form, div, [data-section], [data-testid]'
                  ));
                  let best = { score: -1, options: [] };
                  for (const el of containers) {
                    // Use textContent (no layout, reads hidden/off-screen elements)
                    const raw = String(el?.textContent || '').replace(/\r/g, '\n').trim();
                    if (!raw || raw.length < 140 || raw.length > 160000) continue;
                    const norm = normalize(raw);
                    let hits = 0;
                    for (const tk of anchorTokens) if (norm.includes(tk)) hits++;
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

                const structural = tryStructural();
                if (structural.length >= 2) return structural.join('\n');
                const tc = tryTextContent();
                return tc.length >= 2 ? tc.join('\n') : '';
              },
              args: [anchorSeedText, preferCodeLikeOptions]
            });

            const scannedText = String(scannedResult?.result || '');
            const scannedCount = countDistinctOptions(scannedText);
            const currentCount = countDistinctOptions(optionsText || '');
            const scannedRelated = optionsAreContextuallyRelated(stemForOptions || bestQuestion, scannedText);
            const currentRelated = optionsText
              ? optionsAreContextuallyRelated(stemForOptions || bestQuestion, optionsText)
              : false;
            const scannedLetters = new Set(
              scannedText
                .split('\n')
                .map((line) => String(line || '').trim().match(/^([A-E])\s*[\)\.\-:]/i)?.[1]?.toUpperCase())
                .filter(Boolean)
            );
            const scannedHasFullAE = ['A', 'B', 'C', 'D', 'E'].every((l) => scannedLetters.has(l));
            if (scannedCount >= 2 && !scannedRelated) {
              console.log(`AnswerHunter: DOM_STRUCTURAL_OPTIONS rejected=${scannedCount} (context mismatch)`);
            } else if (scannedCount >= 2 && (scannedHasFullAE || scannedCount > currentCount || (scannedCount === currentCount && !currentRelated))) {
              optionsText = scannedText;
              console.log(`AnswerHunter: DOM_STRUCTURAL_OPTIONS used=${scannedCount} (replaced previous=${currentCount}${scannedHasFullAE ? ', full A-E found' : ''})`);
            } else if (scannedCount >= 2) {
              console.log(`AnswerHunter: DOM_STRUCTURAL_OPTIONS found=${scannedCount} (kept current=${currentCount})`);
            }
          } catch (scrollErr) {
            console.warn('AnswerHunter: DOM structural options scan failed:', scrollErr?.message || scrollErr);
          }
        }

        // Fallback priority: OCR stored options → allFrames (last resort).
        // allFrames can pick up options from OTHER questions (cross-frame contamination),
        // so we prefer OCR options when available.
        if (!optionsText && ocrVisionText) {
          // Extract option lines from OCR text
          const ocrOptLines = ocrVisionText.split('\n').filter(line =>
            isValidOptionLine(line)
          );
          if (ocrOptLines.length >= 2) {
            const ocrFallbackCandidate = ocrOptLines.join('\n');
            // Guard: validate OCR fallback options are contextually related to current stem.
            // OCR may have captured a different question's options from the visible viewport.
            if (optionsAreContextuallyRelated(stemForOptions || bestQuestion, ocrFallbackCandidate)) {
              optionsText = ocrFallbackCandidate;
              console.log(`AnswerHunter: OCR_OPTIONS_FALLBACK used=${ocrOptLines.length} options from stored OCR text (DOM scope did not return full set)`);
            } else {
              console.log(`AnswerHunter: OCR_OPTIONS_FALLBACK rejected=${ocrOptLines.length} OCR options — not contextually related to current stem (cross-question contamination)`);
            }
          }
        }
        if (!optionsText && !isolationStrippedOcrOptions) {
          optionsResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            function: ExtractionService.extractOptionsOnlyScript
          });
          optionsText = pickBestOptionsText(optionsResults);
          if (optionsText) {
            console.log('AnswerHunter: OCR_OPTIONS_FALLBACK used=allFrames (last resort)');
          }
        }

        // Recovery: isolation stripped OCR options, anchored/structural found nothing.
        // Use TARGETED container search — find the DOM container holding the isolated
        // question text and extract options from WITHIN it (not viewport-based).
        if (!optionsText && isolationStrippedOcrOptions) {
          console.log('AnswerHunter: OPTIONS_RECOVERY — trying targeted container search for isolated question.');
          try {
            const frameTarget = Number.isFinite(bestFrameIndex) && bestFrameIndex >= 0 ? bestFrameIndex : 0;
            const [recoveryResult] = await chrome.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [frameTarget] },
              function: (isolatedStem) => {
                const normalize = (s) => String(s || '').toLowerCase()
                  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

                const stemNorm = normalize(isolatedStem);
                const stemTokens = stemNorm.split(' ').filter(t => t.length >= 4).slice(0, 15);
                if (stemTokens.length < 3) return '';

                const OPTION_SEL =
                  'button[data-testid^="alternative-"], [data-testid^="alternative-"], ' +
                  'button[data-element="link_resposta"], ' +
                  '[class*="alternativa"], [class*="alternative"], ' +
                  'label[for^="option"], .radio-option, ' +
                  'label:has(input[type="radio"]), label:has(input[type="checkbox"]), ' +
                  '[role="radio"], [role="option"], ' +
                  'li[data-letra], li[data-letter], li[data-option], li[data-alternativa]';

                const cleanBody = (raw) => {
                  let body = String(raw || '').replace(/\s+/g, ' ').trim();
                  body = body.replace(/^[A-E]\s*[\)\.\-:]\s*/i, '').trim();
                  const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
                  const idx = body.search(noise);
                  if (idx > 1) body = body.slice(0, idx).trim();
                  return body.replace(/[;:,\-.\s]+$/, '');
                };

                const extractOptionsFromEl = (container) => {
                  let buttons;
                  try { buttons = container.querySelectorAll(OPTION_SEL); } catch (_) { return []; }
                  const options = [];
                  const seen = new Set();
                  for (const btn of buttons) {
                    const letterEl = btn.querySelector('[data-testid="circle-letter"]') ||
                      btn.querySelector('[class*="letter"]') || btn.querySelector('small, strong, span');
                    let lt = ((letterEl ? (letterEl.innerText || letterEl.textContent) : '') || '').trim();
                    if (!/^[A-E]$/i.test(lt)) {
                      const ft = (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
                      const m = ft.match(/^([A-E])\s*[\)\.\s]/i);
                      if (m) lt = m[1];
                    }
                    const letter = /^[A-E]$/i.test(lt) ? lt.toUpperCase() : '';
                    if (!letter || seen.has(letter)) continue;
                    const textEl = btn.querySelector('[data-testid="question-typography"]') || btn.querySelector('p, div');
                    let raw = ((textEl ? (textEl.textContent || textEl.innerText) : null) || btn.textContent || btn.innerText || '').replace(/\s+/g, ' ').trim();
                    if (new RegExp('^' + letter + '\\s*[\\)\\.\\-:]?\\s*', 'i').test(raw)) {
                      raw = raw.replace(new RegExp('^' + letter + '\\s*[\\)\\.\\-:]?\\s*', 'i'), '');
                    }
                    const body = cleanBody(raw);
                    if (body && body.length >= 1) { seen.add(letter); options.push(letter + ') ' + body); }
                  }
                  return options;
                };

                const scoreContainer = (el) => {
                  const tc = normalize(el.textContent || '');
                  if (tc.length < 30) return -1;
                  let hits = 0;
                  for (const tk of stemTokens) if (tc.includes(tk)) hits++;
                  const len = tc.length;
                  const sizePenalty = len > 10000 ? 3 : len > 5000 ? 2 : len > 2000 ? 1 : 0;
                  return hits - sizePenalty;
                };

                // Strategy 1: platform-specific question containers
                const qContainers = Array.from(document.querySelectorAll(
                  '[data-testid^="question-"], [data-question], [class*="questao"], [class*="question-block"], [data-section="section_cms-atividade"]'
                ));
                let bestC = null;
                let bestS = 2;
                for (const c of qContainers) {
                  const s = scoreContainer(c);
                  if (s > bestS) { bestS = s; bestC = c; }
                }
                if (bestC) {
                  const opts = extractOptionsFromEl(bestC);
                  if (opts.length >= 2) return opts.slice(0, 5).join('\n');
                }

                // Strategy 2: generic containers (section, article, div) with stem match + options
                const generic = Array.from(document.querySelectorAll('section, article, form, div, main'))
                  .filter(el => { const l = (el.textContent || '').length; return l > 80 && l < 15000; });
                bestC = null; bestS = 2;
                for (const c of generic) {
                  const s = scoreContainer(c);
                  if (s > bestS) {
                    const opts = extractOptionsFromEl(c);
                    if (opts.length >= 2) { bestS = s; bestC = c; }
                  }
                }
                if (bestC) {
                  const opts = extractOptionsFromEl(bestC);
                  if (opts.length >= 2) return opts.slice(0, 5).join('\n');
                }

                // Strategy 3: text-based — find stem in full page text, extract A-E after it
                const fullText = (document.body?.innerText || document.body?.textContent || '').replace(/\r/g, '\n');
                const fullNorm = normalize(fullText);
                let stemStart = -1;
                const winSize = stemNorm.length + 100;
                for (let i = 0; i < fullNorm.length - 50; i += 15) {
                  const w = fullNorm.substring(i, i + winSize);
                  let hits = 0;
                  for (const tk of stemTokens) if (w.includes(tk)) hits++;
                  if (hits >= stemTokens.length * 0.7) { stemStart = i; break; }
                }
                if (stemStart >= 0) {
                  const afterStem = fullText.substring(stemStart);
                  const lines = afterStem.split(/\n+/).map(l => l.trim()).filter(Boolean);
                  const out = [];
                  const seen = new Set();
                  let pastStem = false;
                  for (const line of lines) {
                    if (!pastStem) {
                      const ln = normalize(line);
                      let h = 0;
                      for (const tk of stemTokens) if (ln.includes(tk)) h++;
                      if (h >= 2) continue;
                      pastStem = true;
                    }
                    const m = line.match(/^["']?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i);
                    if (m) {
                      const letter = m[1].toUpperCase();
                      const body = cleanBody(m[2]);
                      if (!seen.has(letter) && body) { seen.add(letter); out.push(letter + ') ' + body); }
                    }
                    if (out.length > 0 && /^\d+\s*[\)\.\-:]?\s+[A-Z]/.test(line) && !/^[A-E]\s*[\)\.\-:]/i.test(line)) break;
                  }
                  if (out.length >= 2) return out.slice(0, 5).join('\n');
                }

                return '';
              },
              args: [bestQuestion]
            });

            const recoveredText = String(recoveryResult?.result || '');
            if (recoveredText) {
              const recoveredCount = countDistinctOptions(recoveredText);
              optionsText = recoveredText;
              console.log(`AnswerHunter: OPTIONS_RECOVERY_SUCCESS — recovered ${recoveredCount} options via targeted container`);
            } else {
              console.log('AnswerHunter: OPTIONS_RECOVERY_EMPTY — no options found near isolated question');
            }
          } catch (recoveryErr) {
            console.warn('AnswerHunter: OPTIONS_RECOVERY failed:', recoveryErr?.message || recoveryErr);
          }
        }

        if (optionsText && optionsText.length > 10) {
          if (existingOptionCount < 2) {
            // No real options in question text — just append all (after contamination guard check)
            if (optionsAreContextuallyRelated(bestQuestion, optionsText)) {
              displayQuestion = `${bestQuestion}\n${optionsText}`;
            } else {
              console.log('AnswerHunter: OPTIONS_CONTAMINATION_GUARD blocked options append (existingOptionCount<2). Options likely from another question.');
            }
          } else {
            let processedQuestion = bestQuestion;
            const domOptsCount = countDistinctOptions(optionsText);

            if (usedVisionOcr && domOptsCount >= 2) {
              const domLines = optionsText.split('\n').filter(line => isValidOptionLine(line));
              const domLetters = new Map();

              domLines.forEach(line => {
                const match = line.trim().match(/^([A-E])\s*[\)\.\-:]/i);
                if (match) {
                  const letter = match[1].toUpperCase();
                  const body = String(line || '')
                    .replace(/^([A-E])\s*[\)\.\-:]\s*/i, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                  if (!body || !isValidOptionLine(`${letter}) ${body}`)) return;
                  if (!domLetters.has(letter) || body.length > String(domLetters.get(letter) || '').length) {
                    domLetters.set(letter, body);
                  }
                }
              });

              if (domLetters.size > 0) {
                // Strip ALL option-looking lines from the OCR text first,
                // then append the complete precise DOM options.
                // This avoids duplicate entries when OCR captured wrong/extra alternatives.
                const stemLines = processedQuestion.split('\n').filter(line => {
                  const m = line.trim().match(/^([A-E])\s*[\)\.\-:]\s*/i);
                  return !m; // keep only lines that are NOT option-like
                });
                let stemText = stemLines.join('\n').trim();
                if (!stemText) {
                  const domStem = String(domQuestion || '')
                    .split('\n')
                    .filter(line => !line.trim().match(/^([A-E])\s*[\)\.\-:]\s*/i))
                    .join('\n')
                    .trim();
                  if (domStem.length >= 30) {
                    stemText = domStem;
                    console.log('AnswerHunter: OCR stem empty; recovered stem from DOM extraction');
                  }
                }
                const orderedLetters = ['A', 'B', 'C', 'D', 'E'];
                const domOptionsText = orderedLetters
                  .filter((letter) => domLetters.has(letter))
                  .map((letter) => `${letter}) ${domLetters.get(letter)}`)
                  .join('\n');
                const alignment = compareOptionsByLetter(bestQuestion, domOptionsText);
                const shouldEnforceAlignment = existingOptionCount >= 3 && domLetters.size >= 3 && alignment.baseSize >= 3;
                const ocrProfile = buildOptionsProfile(bestQuestion);
                const domProfile = buildOptionsProfile(domOptionsText);
                const ocrCompactSet = ocrProfile.entries.length >= 3 && ocrProfile.entries.every((entry) => isCompactOptionBody(entry.body));
                const domVerboseSet = domProfile.entries.length >= 3 && domProfile.entries.some((entry) => entry.body.length >= 22 || entry.body.split(/\s+/).length >= 4);
                if (ocrCompactSet && domVerboseSet) {
                  console.log('AnswerHunter: OCR_DOM_SHAPE_GUARD rejected DOM replacement (compact OCR options vs verbose DOM options)');
                } else if (shouldEnforceAlignment && !alignment.consistent) {
                  console.log(`AnswerHunter: OCR_DOM_CONSISTENCY rejected replacement shared=${alignment.shared} matched=${alignment.matched} ratio=${alignment.ratio.toFixed(2)}`);
                } else if (!optionsAreContextuallyRelated(stemText || bestQuestion || domQuestion || '', domOptionsText)) {
                  console.log('AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected DOM replacement on OCR path');
                } else {
                  processedQuestion = stemText ? `${stemText}\n${domOptionsText}` : domOptionsText;
                  displayQuestion = processedQuestion;
                  console.log(`AnswerHunter: REBUILT question from stem + ${domLetters.size} precise DOM options (stripped OCR option lines)`);
                  console.log(`AnswerHunter: OCR_DOM_REPLACE opts_before=${existingOptionCount} opts_after=${countDistinctOptions(displayQuestion)}`);
                }
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
                // Apply contamination guard before merging missing options
                if (optionsAreContextuallyRelated(bestQuestion, newLines.join('\n'))) {
                  displayQuestion = `${bestQuestion}\n${newLines.join('\n')}`;
                  console.log(`AnswerHunter: Merged ${newLines.length} missing option(s) from extractOptionsOnlyScript`);
                  console.log(`AnswerHunter: OCR_DOM_MERGE opts_before=${existingOptionCount} opts_added=${newLines.length} opts_after=${countDistinctOptions(displayQuestion)}`);
                } else {
                  console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected ${newLines.length} missing option(s) as cross-question contamination`);
                }
              } else if (usedVisionOcr) {
                console.log('AnswerHunter: OCR was used; CSS/HTML options scan executed with no new alternatives found');
                console.log(`AnswerHunter: OCR_DOM_MERGE opts_before=${existingOptionCount} opts_added=0 opts_after=${countDistinctOptions(displayQuestion)}`);
              }
            }
          }
        }
      } else if (usedVisionOcr) {
        console.log(`AnswerHunter: OCR_PRIORITY post-step=dom_options_scan skipped opts_current=${existingOptionCount} (OCR already has full option set)`);
      }

      // ── Phase 2.3: DOM ↔ OCR cross-validation ──
      // Compare the final displayQuestion stem with the DOM question stem.
      // If they diverge significantly, trust OCR (it sees what the user sees).
      if (usedVisionOcr && domQuestion && ocrVisionText) {
        const _normCross = (s) => String(s || '')
          .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ').trim();
        const displayStemLines = displayQuestion.split('\n')
          .filter(l => !l.trim().match(/^\s*["']?\s*[A-E]\s*[\)\.\-:]\s/i));
        const displayStemNorm = _normCross(displayStemLines.join(' '));
        const ocrStemLines = ocrVisionText.split('\n')
          .filter(l => !l.trim().match(/^\s*["']?\s*[A-E]\s*[\)\.\-:]\s/i));
        const ocrStemNorm = _normCross(ocrStemLines.join(' '));
        const domStemLines = domQuestion.split('\n')
          .filter(l => !l.trim().match(/^\s*["']?\s*[A-E]\s*[\)\.\-:]\s/i));
        const domStemNorm = _normCross(domStemLines.join(' '));

        // Check if display has drifted from OCR (contaminated by DOM)
        const displayTokens = displayStemNorm.split(' ').filter(t => t.length >= 4);
        const ocrTokenSet = new Set(ocrStemNorm.split(' ').filter(t => t.length >= 4));
        let ocrOverlap = 0;
        for (const t of displayTokens) { if (ocrTokenSet.has(t)) ocrOverlap++; }
        const ocrOverlapRatio = displayTokens.length > 0 ? ocrOverlap / displayTokens.length : 1;

        // If display diverged significantly from OCR, revert to OCR-based text
        if (ocrOverlapRatio < 0.35 && ocrStemNorm.length >= 30) {
          const fpCrossCheck = QuestionFingerprint.validate(questionFingerprint, ocrVisionText, 0.3);
          if (fpCrossCheck.valid) {
            console.log(`AnswerHunter: CROSS_VALIDATION display diverged from OCR (overlap=${ocrOverlapRatio.toFixed(2)}). Reverting to OCR text. FP=${fpCrossCheck.details}`);
            displayQuestion = ocrVisionText;
          } else {
            console.log(`AnswerHunter: CROSS_VALIDATION display diverged but OCR also diverged from fingerprint. Keeping display.`);
          }
        } else {
          console.log(`AnswerHunter: CROSS_VALIDATION ok (ocr_overlap=${ocrOverlapRatio.toFixed(2)})`);
        }
      }

      // ── Phase 2.2: Two-pass OCR trigger ──
      // If the current result has issues (few options, short stem), run a focused second OCR pass.
      const _preTwoPassOpts = countDistinctOptions(displayQuestion);
      const _preTwoPassStemLen = displayQuestion.split('\n')
        .filter(l => !l.trim().match(/^\s*["']?\s*[A-E]\s*[\)\.\-:]\s/i))
        .join(' ').trim().length;
      const needsSecondPass = usedVisionOcr && (_preTwoPassOpts < 3 || _preTwoPassStemLen < 60);
      let capturedBase64 = null;

      if (needsSecondPass) {
        try {
          const dataUrl2 = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 70 });
          capturedBase64 = dataUrl2 ? dataUrl2.split(',')[1] : null;
          if (capturedBase64) {
            const hint = (bestQuestion || displayQuestion).split('\n')[0] || '';
            const focusedText = await ApiService.extractTextFromScreenshotFocused(capturedBase64, hint);
            if (focusedText && focusedText.length >= 50) {
              const focusedOpts = countDistinctOptions(focusedText);
              const focusedStemLen = focusedText.split('\n')
                .filter(l => !l.trim().match(/^\s*["']?\s*[A-E]\s*[\)\.\-:]\s/i))
                .join(' ').trim().length;
              const fpFocused = QuestionFingerprint.validate(questionFingerprint, focusedText, 0.35);
              if (fpFocused.valid && (focusedOpts > _preTwoPassOpts || focusedStemLen > _preTwoPassStemLen * 1.3)) {
                console.log(`AnswerHunter: TWO_PASS_OCR replaced result. opts: ${_preTwoPassOpts}→${focusedOpts}, stemLen: ${_preTwoPassStemLen}→${focusedStemLen}. FP=${fpFocused.details}`);
                displayQuestion = focusedText;
              } else {
                console.log(`AnswerHunter: TWO_PASS_OCR not better (opts=${focusedOpts} stemLen=${focusedStemLen} fp=${fpFocused.details})`);
              }
            }
          }
        } catch (e2) {
          console.warn('AnswerHunter: Two-pass OCR failed:', e2?.message);
        }
      }
      _pcTimer.mark('Cross-validation + Two-pass OCR');

      // ── Phase 3.2: LLM post-validation ──
      // Quick LLM check: "Is this exactly 1 complete question?"
      // Only runs when we have structural concerns (few options, very short text).
      const _finalOptCount = countDistinctOptions(displayQuestion);
      const _finalStemLen = displayQuestion.split('\n')
        .filter(l => !l.trim().match(/^\s*["']?\s*[A-E]\s*[\)\.\-:]\s/i))
        .join(' ').trim().length;
      const shouldLlmValidate = _finalOptCount < 3 || _finalStemLen < 50 || displayQuestion.length > 3000;
      if (_finalOptCount === 0 && isolationStrippedOcrOptions) {
        console.log('AnswerHunter: OPTS_ZERO_WARNING — 0 options after isolation. Recovery exhausted.');
      }

      if (shouldLlmValidate) {
        try {
          const llmResult = await ApiService.llmPostValidateQuestion(displayQuestion);
          console.log(`AnswerHunter: LLM_POST_VALIDATION valid=${llmResult.valid} reason="${llmResult.reason}" qCount=${llmResult.questionCount}`);
          if (!llmResult.valid && llmResult.fixedText && llmResult.fixedText.length >= 30) {
            const fpLlm = QuestionFingerprint.validate(questionFingerprint, llmResult.fixedText, 0.35);
            if (fpLlm.valid) {
              console.log(`AnswerHunter: LLM_POST_VALIDATION applied fixedText (${llmResult.fixedText.length} chars). FP=${fpLlm.details}`);
              displayQuestion = llmResult.fixedText;
            } else {
              console.log(`AnswerHunter: LLM_POST_VALIDATION fixedText rejected by fingerprint — ${fpLlm.details}`);
            }
          }
        } catch (llmErr) {
          console.warn('AnswerHunter: LLM post-validation error:', llmErr?.message);
        }
        _pcTimer.mark('LLM Post-validation');
      }

      // ── Phase 3.3: Confidence scoring ──
      const extractionConfidence = QuestionFingerprint.computeConfidence(displayQuestion, {
        usedVision: usedVisionOcr,
        platformMatch: usedPlatformExtractor,
        viewportMatch: usedViewportCentric,
        fingerprint: questionFingerprint
      });
      console.log(`AnswerHunter: CONFIDENCE score=${extractionConfidence.score} level=${extractionConfidence.level} signals=[${extractionConfidence.signals.join(', ')}]`);
      // Store on instance for _decorateWithSavedMeta to inject into results
      this._lastExtractionConfidence = extractionConfidence;

      // Final canonicalization: rebuild stable "stem + options" before cache/search.
      displayQuestion = this._canonicalizeDisplayQuestion(displayQuestion, bestQuestion);

      // Semantic repair: assertion-based stems (I/II/III) must not keep SQL/code alternatives.
      // If contamination is detected, try to rescue assertion-style options from captured raw texts.
      {
        const stemText = QuestionParser.extractQuestionStem(displayQuestion || bestQuestion || '');
        const rawOptionLines = String(displayQuestion || '')
          .split('\n')
          .map((line) => String(line || '').trim())
          .filter((line) => /^([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*\S/i.test(line));
        const stemSignals = `${stemText}\n${displayQuestion || ''}`;
        const hasAssertionStem = /\b(?:afirma[cç][aã]o(?:es)?|assertiva(?:s)?|itens?)\b/i.test(stemSignals)
          || /(?:^|\s)(?:I|II|III|IV)\s*[\-\.)]\s*[A-ZÀ-ÖÙ-Ý]/i.test(stemSignals);

        if (hasAssertionStem && rawOptionLines.length >= 3) {
          const optionBodies = rawOptionLines
            .map((line) => String(line || '').replace(/^([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*/i, '').trim())
            .filter(Boolean);
          const codeLikeCount = optionBodies.filter((body) => looksLikeCodeOptionBody(body)).length;
          const assertionLikeCount = optionBodies.filter((body) => /\b(?:somente|apenas|afirma[cç][aã]o(?:es)?|assertiva(?:s)?|itens?|est[aã]o\s+corretas?|i\s*e\s*ii|ii\s*e\s*iii|i\s*,\s*ii|iii\s+est[aá])\b/i.test(body)).length;

          // Contamination signature: mostly code options + no assertion-language options.
          const looksContaminated = codeLikeCount >= 3 && assertionLikeCount === 0;

          if (looksContaminated) {
            const rescueFromText = (rawText, stemHint) => {
              if (!rawText) return [];

              const normalize = (s) => String(s || '')
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, ' ')
                .trim();

              const stemNorm = normalize(stemHint || '');
              const stemTokens = stemNorm.split(/\s+/).filter((t) => t.length >= 4).slice(0, 14);

              const lines = String(rawText)
                .replace(/\r/g, '\n')
                .split('\n')
                .map((line) => String(line || '').trim())
                .filter(Boolean);

              // Focus around the stem region when possible
              let startIdx = 0;
              let bestHits = 0;
              if (stemTokens.length >= 4) {
                for (let i = 0; i < lines.length; i++) {
                  const ln = normalize(lines[i]);
                  if (!ln) continue;
                  let hits = 0;
                  stemTokens.forEach((tk) => { if (ln.includes(tk)) hits += 1; });
                  if (hits > bestHits) {
                    bestHits = hits;
                    startIdx = Math.max(0, i - 2);
                  }
                }
              }

              const scoped = lines.slice(startIdx, Math.min(lines.length, startIdx + 220));
              const out = [];
              const seen = new Set();
              const startRe = /^([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*(.+)$/i;
              const soloRe = /^([A-E])$/i;
              const isAssertionBody = (b) => /\b(?:somente|apenas|afirma[cç][aã]o(?:es)?|assertiva(?:s)?|itens?|est[aã]o\s+corretas?|i\s*e\s*ii|ii\s*e\s*iii|i\s*,\s*ii|iii\s+est[aá])\b/i.test(String(b || ''));

              for (let i = 0; i < scoped.length; i++) {
                const line = scoped[i];
                const m = line.match(startRe);
                if (m) {
                  const letter = m[1].toUpperCase();
                  const body = m[2].replace(/\s+/g, ' ').trim();
                  if (!seen.has(letter) && body && !looksLikeCodeOptionBody(body) && isAssertionBody(body)) {
                    seen.add(letter);
                    out.push(`${letter}) ${body}`);
                  }
                  continue;
                }

                const solo = line.match(soloRe);
                if (solo && i + 1 < scoped.length) {
                  const letter = solo[1].toUpperCase();
                  const body = scoped[i + 1].replace(/\s+/g, ' ').trim();
                  if (!seen.has(letter) && body && !looksLikeCodeOptionBody(body) && isAssertionBody(body)) {
                    seen.add(letter);
                    out.push(`${letter}) ${body}`);
                  }
                }
              }

              return out;
            };

            const rescueCandidates = [displayQuestion, bestQuestion, domQuestion, ocrVisionText]
              .map((t) => String(t || '').trim())
              .filter(Boolean);

            let rescued = [];
            for (const candidateText of rescueCandidates) {
              rescued = rescueFromText(candidateText, stemText);
              if (rescued.length >= 3) break;
            }

            if (rescued.length >= 3) {
              const ordered = ['A', 'B', 'C', 'D', 'E']
                .map((letter) => rescued.find((opt) => opt.startsWith(`${letter})`)))
                .filter(Boolean);
              displayQuestion = `${stemText}\n${ordered.join('\n')}`.trim();
              console.log(`AnswerHunter: ASSERTION_OPTIONS_REPAIR restored ${ordered.length} assertion-style options after SQL/code contamination.`);
            } else {
              displayQuestion = stemText || displayQuestion;
              console.log('AnswerHunter: ASSERTION_OPTIONS_REPAIR removed contaminated SQL/code options (no reliable assertion options recovered).');
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

        const withSaved = this._decorateWithSavedMeta(direct, displayQuestion);
        this._logExtractionTable(withSaved);
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

        const withSaved = this._decorateWithSavedMeta(direct, displayQuestion);
        this._logExtractionTable(withSaved);
        this.view.appendResults(withSaved);
        await this.saveLastResults(withSaved);
        this.view.showStatus('success', this.t('status.answersFound', { count: 1 }));
        this.view.toggleViewSection('view-search');
        this.view.setButtonDisabled('copyBtn', false);
        return;
      }

      // Bulk page gabarito cache — instant hit if this page was previously extracted
      const pgCacheHit = await PageGabaritoCache.lookup(tab.url, displayQuestion);
      if (pgCacheHit?.letter) {
        const optionsMap = this._extractOptionsMap(displayQuestion);
        const answerText = optionsMap[pgCacheHit.letter] || pgCacheHit.answerText || '';
        const direct = [{
          question: displayQuestion,
          answer: `Letra ${pgCacheHit.letter}: ${answerText}`.trim(),
          answerLetter: pgCacheHit.letter,
          answerText,
          optionsMap,
          sources: [{ title: 'Gabarito da página (cache)', link: tab.url || '', type: 'page-cache' }],
          bestLetter: pgCacheHit.letter,
          votes: { [pgCacheHit.letter]: 12 },
          confidence: 0.96,
          resultState: 'confirmed',
          reason: 'confirmed_by_sources',
          title: this.t('result.title'),
          aiFallback: false
        }];
        const withSaved = this._decorateWithSavedMeta(direct, displayQuestion);
        this._logExtractionTable(withSaved);
        this.view.appendResults(withSaved);
        await this.saveLastResults(withSaved);
        this.view.showStatus('success', this.t('status.answersFound', { count: 1 }));
        this.view.toggleViewSection('view-search');
        this.view.setButtonDisabled('copyBtn', false);
        return;
      }

      // Fire bulk extraction in background — caches this page's gabarito for future searches
      this._triggerPageGabaritoExtraction(tab.url).catch(() => { });

      _pcTimer.mark('Question Selection + Validation');
      {
        const optMapDbg = this._extractOptionsMap(displayQuestion || '');
        const stemDbg = QuestionParser.extractQuestionStem(displayQuestion || '');
        console.log(
          `AnswerHunter: displayQuestion sent to search (stemLen=${stemDbg.length}, opts=${Object.keys(optMapDbg).length}, isoStripped=${isolationStrippedOcrOptions}, multiQ=${detectedMultiQuestionText})`,
          {
            stemPreview: stemDbg.slice(0, 220),
            optionsMap: optMapDbg,
            fullPreview: String(displayQuestion || '').slice(0, 1200)
          }
        );
      }

      // -- Phase 2: dispatch the slow network work to the background service worker --
      // The SW runs searchOnly + refineFromResults and stores the result in
      // chrome.storage.local, so the search survives popup closure.
      const requestId = `srch_${Date.now()}`;

      // Persist context so the popup can resume polling when it reopens.
      await chrome.storage.local.set({
        ah_pending_search: { requestId, displayQuestion, bestQuestion, extractionConfidence }
      });

      let bgDispatched = false;
      try {
        await chrome.runtime.sendMessage({
          type: 'SEARCH_PHASE2',
          requestId,
          question: bestQuestion,
          displayQuestion
        });
        bgDispatched = true;
        _pcTimer.mark('Background SW Dispatch (SEARCH_PHASE2)');
      } catch (_bgErr) {
        console.warn('AnswerHunter: BG dispatch failed — running search inline:', _bgErr?.message);
      }

      if (!bgDispatched) {
        // Inline fallback (background SW unavailable)
        await chrome.storage.local.remove('ah_pending_search');
        const _sr = await SearchService.searchOnly(displayQuestion);
        _pcTimer.mark(`Inline Fallback: searchOnly (${(_sr || []).length} results)`);
        if (!_sr?.length) {
          this.view.showStatus('loading', this.t('status.noSourcesAskAi'));
          await this.renderAiFallback(displayQuestion, displayQuestion);
          return;
        }
        this.view.showStatus('loading', this.t('status.foundAndAnalyzing', { count: _sr.length }));
        const _fr = await SearchService.refineFromResults(bestQuestion, _sr, displayQuestion, (m) => this.view.showStatus('loading', m));
        _pcTimer.mark('Inline Fallback: refineFromResults');
        _pcTimer.summary();
        await this._finishBackgroundSearch(_fr, displayQuestion, bestQuestion);
        return;
      }

      _pcTimer.mark('BG Polling Started');
      _pcTimer.summary();
      this.view.showStatus('loading', this.t('status.searchingBackground'));
      this._startPollBackgroundSearch(requestId, displayQuestion, bestQuestion);
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

  // -- Background search helpers ------------------------------------------------

  /**
   * Processes the array of finalResults from a background search and
   * updates the UI exactly as the old inline handleSearch() code did.
   */
  async _finishBackgroundSearch(finalResults, displayQuestion, bestQuestion) {
    if (!finalResults || finalResults.length === 0) {
      this.view.showStatus('loading', this.t('status.noSourceAnswerAskAi'));
      await this.renderAiFallback(displayQuestion, displayQuestion);
      return;
    }

    const firstResult = finalResults[0] || {};
    const resolvedLetter = String(firstResult.answerLetter || firstResult.bestLetter || '').trim().toUpperCase();
    const hasResolvedLetter = /^[A-E]$/.test(resolvedLetter);
    const hasSources = Array.isArray(firstResult.sources) && firstResult.sources.length > 0;
    const hasVotes = !!(firstResult.votes && typeof firstResult.votes === 'object' && Object.keys(firstResult.votes).length > 0);
    const shouldFallbackToAi = firstResult.resultState === 'inconclusive' && !hasResolvedLetter && !hasSources && !hasVotes;

    if (shouldFallbackToAi) {
      this.view.showStatus('loading', this.t('status.noSourceAnswerAskAi'));
      await this.renderAiFallback(displayQuestion, displayQuestion);
      return;
    }

    console.log('AnswerHunter: Final results to display:', finalResults);
    const withSaved = this._decorateWithSavedMeta(finalResults, displayQuestion);
    this._logExtractionTable(withSaved);
    this.view.appendResults(withSaved);
    await this.saveLastResults(withSaved);
    this.view.showStatus('success', this.t('status.answersFound', { count: finalResults.length }));
    this.view.toggleViewSection('view-search');
    this.view.setButtonDisabled('copyBtn', false);
    this.view.setButtonDisabled('searchBtn', false);
  },

  /**
   * Polls chrome.storage.local for the background search result every 600 ms.
   * Updates the status bar with progress messages and calls _finishBackgroundSearch
   * (or renderAiFallback) when the background SW signals completion.
   */
  _startPollBackgroundSearch(requestId, displayQuestion, bestQuestion) {
    if (this._bgSearchPoller) clearInterval(this._bgSearchPoller);

    const key = `ah_bg_search_${requestId}`;
    const statusKey = `${key}_status`;
    let lastStatus = '';
    const pollerStartedAt = Date.now();

    this._bgSearchPoller = setInterval(async () => {
      try {
        const data = await chrome.storage.local.get([key, statusKey]);
        const entry = data[key];
        const statusMsg = data[statusKey];

        // Mirror progress messages in popup status bar
        if (statusMsg && statusMsg !== lastStatus) {
          lastStatus = statusMsg;
          this.view.showStatus('loading', statusMsg);
        }

        // Stale-search guard: protect against service worker crashes that leave
        // the entry stuck in 'running' (or missing after a cleanup).
        if (!entry) {
          // Give the SW 10s to create the entry before assuming it's lost.
          if (Date.now() - pollerStartedAt < 10000) return;
          clearInterval(this._bgSearchPoller);
          this._bgSearchPoller = null;
          await chrome.storage.local.remove(['ah_pending_search', key, statusKey]).catch(() => { });
          this.view.showStatus('error', this.t('status.searchError', { message: 'Search lost. Please try again.' }));
          this.view.setButtonDisabled('searchBtn', false);
          return;
        }
        if (entry.state === 'running') {
          const elapsed = Date.now() - (entry.startedAt || 0);
          if (elapsed < 240000) return; // still within 4-min window, keep waiting
          console.warn('AnswerHunter: BG search timed out (stale running entry) — treating as error');
          clearInterval(this._bgSearchPoller);
          this._bgSearchPoller = null;
          await chrome.storage.local.remove(['ah_pending_search', key, statusKey]).catch(() => { });
          this.view.showStatus('error', this.t('status.searchError', { message: 'Search timed out. Please try again.' }));
          this.view.setButtonDisabled('searchBtn', false);
          return;
        }

        // Reached a terminal state — clear the poller and storage entries
        clearInterval(this._bgSearchPoller);
        this._bgSearchPoller = null;
        await chrome.storage.local.remove(['ah_pending_search', key, statusKey]).catch(() => { });

        if (entry.state === 'done') {
          await this._finishBackgroundSearch(entry.results, displayQuestion, bestQuestion);
        } else if (entry.state === 'no_results') {
          this.view.showStatus('loading', this.t('status.noSourcesAskAi'));
          await this.renderAiFallback(displayQuestion, displayQuestion);
        } else if (entry.state === 'error') {
          this.view.showStatus('error', this.t('status.searchError', { message: entry.error || 'unknown' }));
          this.view.setButtonDisabled('searchBtn', false);
        }
      } catch (pollErr) {
        console.warn('AnswerHunter: BG search poll error:', pollErr);
      }
    }, 600);
  },

  /**
   * Called from init() — if the popup is reopened while a background search is
   * already running (or just finished), resume showing progress / display results.
   */
  async _resumePendingBackgroundSearch() {
    try {
      const { ah_pending_search: pending } = await chrome.storage.local.get('ah_pending_search');
      if (!pending?.requestId) return;

      const key = `ah_bg_search_${pending.requestId}`;
      const { [key]: entry } = await chrome.storage.local.get(key);

      if (!entry) {
        // Job not started or storage already cleared — discard stale pending marker
        await chrome.storage.local.remove('ah_pending_search').catch(() => { });
        return;
      }

      // Regardless of whether the job is still running or already done,
      // (re-)attach the poller — it will handle all terminal states immediately.
      this.view.showStatus('loading', this.t('status.searchingBackground'));
      this.view.setButtonDisabled('searchBtn', true);
      this._startPollBackgroundSearch(pending.requestId, pending.displayQuestion, pending.bestQuestion);
    } catch (err) {
      console.warn('AnswerHunter: Error resuming pending background search:', err);
    }
  },
  _extractOptionsMap(text) {
    const map = {};
    const cleanOptionBody = (raw) => {
      let body = String(raw || '').replace(/\s+/g, ' ').trim();
      const noiseMarker = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o\s+gabarito|explica[cç][aã]o)\b/i;
      const idx = body.search(noiseMarker);
      if (idx > 20) body = body.slice(0, idx).trim();
      return body.replace(/[;:,\-.\s]+$/g, '').trim();
    };
    const isUsableBody = (body) => {
      if (!body || body.length < 1) return false;
      if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(body)) return false;
      if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(body)) return false;
      return true;
    };
    const lines = String(text || '').split('\n');
    const re = /^\s*["'“”‘’]?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
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

  _canonicalizeDisplayQuestion(rawText, fallbackStemText = '') {
    const raw = String(rawText || '').replace(/\r/g, '\n').trim();
    const fallback = String(fallbackStemText || '').replace(/\r/g, '\n').trim();
    if (!raw && !fallback) return '';

    const baseText = raw || fallback;
    let stem = QuestionParser.extractQuestionStem(baseText) || '';
    if (!stem && fallback) stem = QuestionParser.extractQuestionStem(fallback) || fallback;

    let options = QuestionParser.extractOptionsFromQuestion(baseText) || [];
    if (options.length < 2 && fallback && fallback !== baseText) {
      const fallbackOptions = QuestionParser.extractOptionsFromQuestion(fallback) || [];
      if (fallbackOptions.length > options.length) options = fallbackOptions;
    }

    const optionMap = {};
    for (const line of options) {
      const m = String(line || '').match(/^\s*([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*(.+)$/i);
      if (!m) continue;
      const letter = m[1].toUpperCase();
      const body = QuestionParser.stripOptionTailNoise(m[2]);
      if (!body) continue;
      if (!optionMap[letter] || body.length > optionMap[letter].length) optionMap[letter] = body;
    }

    const orderedLetters = ['A', 'B', 'C', 'D', 'E'].filter((letter) => !!optionMap[letter]);

    // Deterministic stem cleanup to prevent "enunciado + alternatives inline" duplication.
    const sanitizeStem = (stemText) => {
      let s = String(stemText || '').replace(/\s+/g, ' ').trim();
      if (!s) return s;

      // 1) Cut on explicit section labels.
      const labelIdx = s.search(/\bALTERNATIVAS?\b/i);
      if (labelIdx > 30) s = s.slice(0, labelIdx).trim();

      // 2) Cut compact inline alternatives (A texto B texto C texto...).
      const compactStart = s.search(/\sA\s+(?=[A-ZÀ-ÖÙ-Ý])/);
      if (compactStart > 40) {
        const tail = s.slice(compactStart);
        const hasOrderedAB = /\sA\s+(?=[A-ZÀ-ÖÙ-Ý])[\s\S]{0,500}\sB\s+(?=[A-ZÀ-ÖÙ-Ý])/.test(tail);
        const markers = tail.match(/\s[ABCDE]\s+(?=[A-ZÀ-ÖÙ-Ý])/g) || [];
        if (hasOrderedAB && markers.length >= 3) {
          s = s.slice(0, compactStart).trim();
        }
      }

      // 3) Extra guard: if option delimiters appear in stem, cut at first one.
      const optDelim = s.search(/\sA\s*(?:[\)\-:]|(?:\.\s))/i);
      if (optDelim > 30) s = s.slice(0, optDelim).trim();

      return s;
    };

    stem = sanitizeStem(stem);
    const rebuiltOptions = orderedLetters.map((letter) => `${letter}) ${optionMap[letter]}`);

    if (stem && rebuiltOptions.length >= 2) return `${stem}\n${rebuiltOptions.join('\n')}`.trim().slice(0, 3500);
    if (stem) return stem.slice(0, 3500);
    if (rebuiltOptions.length >= 2) return rebuiltOptions.join('\n').slice(0, 3500);
    return baseText.slice(0, 3500);
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

  /** Busca o HTML da página via Jina/NativeFetch (sem tocar no DOM da aba ativa) e cacheia gabarito. */
  async _triggerPageGabaritoExtraction(pageUrl) {
    if (!pageUrl) return;
    if (await PageGabaritoCache.isPageCached(pageUrl)) return;
    try {
      let html = await ApiService.fetchViaJina(pageUrl);
      if (!html || html.length < 300) html = await NativeFetchBridgeService.fetchText(pageUrl);
      if (!html || html.length < 300) return;
      await PageGabaritoCache.extractAndStore(html, pageUrl);
    } catch (_) { }
  },

  async renderAiFallback(questionText, displayQuestion) {
    const aiInput = displayQuestion || questionText;
    const aiResults = await SearchService.answerFromAi(aiInput);
    if (!aiResults || aiResults.length === 0) {
      this.view.showStatus('error', this.t('status.couldNotGetAnswer'));
      return;
    }

    const withSaved = this._decorateWithSavedMeta(aiResults, displayQuestion);

    this.view.appendResults(withSaved);
    await this.saveLastResults(withSaved);
    this.view.showStatus('success', this.t('status.answersFound', { count: aiResults.length }));
    this.view.toggleViewSection('view-search');
    this.view.setButtonDisabled('copyBtn', false);
  },

  async handleCopyAll() {
    const text = this.view.getAllResultsText();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      this.view.showStatus('success', this.t('status.copied'));
    } catch (err) {
      console.warn('handleCopyAll: clipboard write failed:', err?.message);
      this.view.showStatus('error', 'Failed to copy to clipboard');
    }
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

  _parseMarkdown(text) {
    if (!text) return '';
    let html = this._escapeHtml(text);
    
    // Horizontal rules (---)
    html = html.replace(/^---$/gm, '<hr style="border:0; border-top:1px solid rgba(0,0,0,0.1); margin: 16px 0;">');

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3 style="margin-top:16px; margin-bottom:8px; font-size:1.1em; color:var(--text-1);"><strong>$1</strong></h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 style="margin-top:20px; margin-bottom:10px; font-size:1.3em; color:var(--text-1);"><strong>$1</strong></h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 style="margin-top:24px; margin-bottom:12px; font-size:1.5em; color:var(--text-1);"><strong>$1</strong></h1>');
    
    // Bold & Italic
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
    
    // Code blocks and inline code
    html = html.replace(/```(?:[a-z]+)?\n([\s\S]*?)```/gi, '<div style="background:#f4f4f5; padding:10px; border-radius:6px; font-family:monospace; margin:8px 0; overflow-x:auto;">$1</div>');
    html = html.replace(/`(.*?)`/g, '<code style="background:#f4f4f5; padding:2px 4px; border-radius:4px; font-family:monospace; color:#ef4444;">$1</code>');

    // Blockquotes
    html = html.replace(/^&gt; (.*$)/gim, '<blockquote style="border-left: 4px solid var(--primary); margin: 12px 0; color:var(--text-2); background:var(--surface-hover); padding:8px 12px; border-radius: 0 4px 4px 0;">$1</blockquote>');

    // AI Emojis markers
 html = html.replace(/^\u2705(.*)$/gim,'<div style="background:linear-gradient(90deg,#F0FDF4,#DCFCE7);border:1px solid #BBF7D0;border-radius:10px;padding:10px 14px;font-weight:700;color:#15803D;margin-bottom:12px;">$1</div>');
 html = html.replace(/^\u{1F4A1}(.*)$/gimu,'<div style="background:linear-gradient(90deg,#EEF2FF,#E0E7FF);border:1px solid #C7D2FE;border-radius:10px;padding:10px 14px;font-weight:600;color:#4338CA;margin-top:10px;">$1</div>');
 html = html.replace(/^\u274C(.*)$/gim,'<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:6px 12px;margin-bottom:4px;font-size:0.88em;color:#991B1B;">$1</div>');
    
    // Numbered lists
    html = html.replace(/^(\d+)\.\s+(.*)/gim, '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;padding:8px 12px;background:rgba(255,255,255,0.7);border-radius:8px;border-left:3px solid var(--primary);"><span style="background:var(--primary);color:#fff;font-weight:700;font-size:0.78rem;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">$1</span><span>$2</span></div>');
    
    // Unordered lists (handling - and +)
    html = html.replace(/^[-+]\s+(.*)$/gim, '<div style="display:flex; gap:8px; margin-bottom:4px;"><span style="color:var(--primary); font-weight:bold;">•</span> <span>$1</span></div>');
    
    // Tables
    // Find lines starting and ending with |
    const tableRegex = /(^\|.+?\|$(?:\r?\n)?)+/gim;
    html = html.replace(tableRegex, (match) => {
        let rowsHtml = '';
        const rows = match.trim().split('\n');
        let isHeader = true;
        
        for (const row of rows) {
            if (/^\|[-:| ]+\|$/.test(row)) {
                isHeader = false;
                continue;
            }
            
            const cells = row.split('|').slice(1, -1);
            let rowHtml = '<tr>';
            for (const cell of cells) {
                const tag = isHeader ? 'th' : 'td';
                const style = isHeader 
                    ? 'background:var(--surface-hover); font-weight:bold; padding:8px; border:1px solid var(--border); text-align:left;' 
                    : 'padding:8px; border:1px solid var(--border);';
                rowHtml += `<${tag} style="${style}">${cell.trim()}</${tag}>`;
            }
            rowHtml += '</tr>';
            rowsHtml += rowHtml;
        }
        
        return `<table style="width:100%; border-collapse:collapse; margin:12px 0; font-size: 0.9em;">\n${rowsHtml}\n</table>\n`;
    });

    // Handle newlines
    let blocks = html.split('\n');
    for (let i = 0; i < blocks.length; i++) {
        const line = blocks[i].trim();
        if (line === '') continue; // skip empty lines after blocks
        if (!line.match(/^<h|^<div|^<hr|^<blockquote|^<table|^<tr|<td/)) {
            blocks[i] = line + '<br>';
        }
    }
    
    // Clean up excessive breaks
    html = blocks.join('\n').replace(/(<br>\n?){2,}/g, '<br><br>');
    
    return html;
  },

  _decorateWithSavedMeta(items, questionFallback = '') {
    const ec = this._lastExtractionConfidence || null;
    return (items || []).map((item) => {
      const question = item.question || questionFallback;
      const meta = StorageModel.getQuestionMeta(question);
      return {
        ...item,
        question,
        saved: meta.saved,
        reviewLater: meta.reviewLater,
        extractionConfidence: item.extractionConfidence || ec
      };
    });
  },

  /** Logs a user-friendly DevTools table showing extraction source, success, and answer. */
  _logExtractionTable(results) {
    const SOURCE_ICON = {
 cache:'',
 page:'',
'page-cache':'',
 ai:'',
    };
    const getDomain = (url) => {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
    };
    const rows = [];
    (results || []).forEach((r, i) => {
      const srcList = Array.isArray(r.sources) && r.sources.length ? r.sources : [];
      const letter = String(r.answerLetter || r.bestLetter || '').toUpperCase();
      const ok = /^[A-E]$/.test(letter);
      const confidence = r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—';
      const gabarito = ok
        ? `${letter}${r.answerText ? '  →  ' + String(r.answerText).slice(0, 55) : ''}`
        : '—';
      if (srcList.length > 0) {
        srcList.forEach((s, j) => {
 const icon = SOURCE_ICON[s.type] ??'';
          const label = s.link || getDomain(s.link) || String(s.title || '?').slice(0, 80);
          rows.push({
            '#': j === 0 ? i + 1 : '  └',
            'Fonte': `${icon} ${label}`,
'Extraiu?': ok ?'' :'',
            'Gabarito': gabarito,
            'Confiança': j === 0 ? confidence : '',
          });
        });
      } else {
        rows.push({
          '#': i + 1,
'Fonte': r.aiFallback ?' IA (fallback)' :'—',
'Extraiu?': ok ?'' :'',
          'Gabarito': gabarito,
          'Confiança': confidence,
        });
      }
    });

    const found = (results || []).filter(r => /^[A-E]$/.test(String(r.answerLetter || r.bestLetter || '').toUpperCase())).length;
 const badge = found > 0 ?`%c [OK] ${found} gabarito(s) encontrado(s)` :`%c [FAIL] Sem gabarito`;
    const badgeStyle = found > 0
      ? 'background:#16a34a;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px;'
      : 'background:#dc2626;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px;';

    console.group(
'%c AnswerHunter %c Resultado da Extração' + badge,
      'background:#0ea5e9;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px;',
      'color:#0ea5e9;font-weight:bold;font-size:13px;',
      badgeStyle
    );
    if (rows.length === 0) {
      console.warn('Nenhum resultado para exibir.');
    } else {
      console.table(rows);
    }
    console.groupEnd();
  },

  _buildLiveCardData(card, fallback = {}) {
    const fallbackQuestion = String(fallback?.question || '').trim();
    const fallbackAnswer = String(fallback?.answer || '').trim();
    const fallbackSources = Array.isArray(fallback?.sources) ? fallback.sources : [];
    const fallbackSource = String(fallback?.source || (fallbackSources[0]?.link || fallbackSources[0]?.title || '')).trim();

    if (!card) {
      return {
        question: fallbackQuestion,
        answer: fallbackAnswer,
        sources: fallbackSources,
        source: fallbackSource
      };
    }

    const normalizeSavedQuestion = (value) => String(value || '')
      .replace(/\r\n/g, '\n')
      .replace(/^\s*(?:ENUNCIADO|STATEMENT)\s*[:\-]?\s*/i, '')
      .replace(/\n\s*(?:ALTERNATIVAS?|OPTIONS)\s*[:\-]?\s*\n/gi, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const questionLive = normalizeSavedQuestion(card.querySelector('.qa-card-question')?.innerText || '');
    const answerLetter = String(card.querySelector('.answer-alternative .alt-letter')?.innerText || '').trim();
    const answerBody = String(card.querySelector('.answer-alternative .alt-text')?.innerText || '').trim();
    const answerTextOnly = String(card.querySelector('.qa-card-answer-text')?.innerText || '').trim();
    const answerLive = answerLetter && answerBody
      ? `Letra ${answerLetter}: ${answerBody}`
      : (answerTextOnly || fallbackAnswer);

    return {
      // Prefer the original question payload when available (cleaner than rendered innerText).
      question: normalizeSavedQuestion(fallbackQuestion || questionLive),
      answer: answerLive || fallbackAnswer,
      sources: fallbackSources,
      source: fallbackSource
    };
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
      console.log(`AnswerHunter: User override applied — Letra ${newLetter}`);
    } catch (error) {
      console.warn('Could not persist answer override:', error);
    }
  },

  async _persistResultFlags(card, flags = {}) {
    try {
      const data = await chrome.storage.local.get(['lastSearchResults']);
      const cached = data?.lastSearchResults;
      if (!Array.isArray(cached) || cached.length === 0) return;

      const allCards = [...(this.view.elements.resultsDiv?.querySelectorAll('.qa-card') || [])];
      const cardIndex = allCards.indexOf(card);
      if (cardIndex < 0 || cardIndex >= cached.length) return;

      if (typeof flags.saved === 'boolean') cached[cardIndex].saved = flags.saved;
      if (typeof flags.reviewLater === 'boolean') cached[cardIndex].reviewLater = flags.reviewLater;

      await chrome.storage.local.set({ lastSearchResults: cached });
    } catch (error) {
      console.warn('Could not persist result flags:', error);
    }
  },

  async restoreLastResults({ clear = true } = {}) {
    try {
      const data = await chrome.storage.local.get(['lastSearchResults']);
      const cached = data?.lastSearchResults;

      if (clear) this.view.clearResults();
      if (!Array.isArray(cached) || cached.length === 0) return;

      const withSaved = this._decorateWithSavedMeta(cached);

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

    const reviewLaterButton = event.target.closest('.btn-review-later');
    if (reviewLaterButton) {
      const dataContent = reviewLaterButton.dataset.content;
      if (!dataContent) return;

      try {
        const data = JSON.parse(decodeURIComponent(dataContent));
        const card = reviewLaterButton.closest('.qa-card');
        const liveData = this._buildLiveCardData(card, data);
        const question = liveData.question || '';
        if (!question) return;
        const answer = liveData.answer || '';
        const sources = Array.isArray(liveData.sources) ? liveData.sources : [];
        const source = liveData.source
          || (sources.length ? (sources[0]?.link || sources[0]?.title || '') : '')
          || '';
        const saveButton = card?.querySelector('.save-btn');

        const meta = StorageModel.getQuestionMeta(question);
        let saved = meta.saved;
        let reviewLater = !meta.reviewLater;

        if (!saved) {
          const added = await StorageModel.addItem(question, answer, source, { reviewLater: true, sources });
          if (!added) {
            await StorageModel.setReviewLater(question, true);
          }
          saved = true;
          reviewLater = true;
          this.view.showToast(this.t('result.reviewLater.savedToast'), 'success');
        } else {
          const updated = await StorageModel.setReviewLater(question, reviewLater);
          if (!updated) return;
          this.view.showToast(this.t(reviewLater ? 'result.reviewLater.enabledToast' : 'result.reviewLater.disabledToast'), reviewLater ? 'success' : 'info');
        }

        if (saveButton) this.view.setSaveButtonState(saveButton, saved);
        this.view.setReviewLaterButtonState(reviewLaterButton, reviewLater);
        await this._persistResultFlags(card, { saved, reviewLater });
        BinderController.refreshSearchSaveStates();
      } catch (error) {
        console.warn('Review-later toggle failed:', error);
      }
      return;
    }

    const saveButton = event.target.closest('.save-btn');
    if (saveButton) {
      const dataContent = saveButton.dataset.content;
      if (!dataContent) return;

      const data = JSON.parse(decodeURIComponent(dataContent));
      const card = saveButton.closest('.qa-card');
      const liveData = this._buildLiveCardData(card, data);
      const reviewLaterButtonInCard = card?.querySelector('.btn-review-later');
      await BinderController.toggleSaveItem(liveData.question, liveData.answer, liveData.source, saveButton, Array.isArray(liveData.sources) ? liveData.sources : []);
      const saved = saveButton.classList.contains('saved');
      let reviewLater = false;
      if (saved) {
        reviewLater = StorageModel.isReviewLater(liveData.question);
      }
      if (reviewLaterButtonInCard) this.view.setReviewLaterButtonState(reviewLaterButtonInCard, reviewLater);
      await this._persistResultFlags(card, { saved, reviewLater });
      return;
    }

    // --- Phase 3.1: Feedback button (report extraction error) ---
    const feedbackBtn = event.target.closest('.feedback-btn');
    if (feedbackBtn) {
      try {
        const { CorrectionFeedback } = await import('../services/CorrectionFeedback.js');
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const dataContent = feedbackBtn.dataset.content;
        const data = dataContent ? JSON.parse(decodeURIComponent(dataContent)) : {};
        await CorrectionFeedback.recordCorrection({
          url: tab?.url || '',
          type: 'wrong_question',
          extractedText: data.question || '',
          extractionMethod: data.extractionConfidence ? 'scored' : 'unknown'
        });
        feedbackBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:14px;color:#27ae60;">check</span><span style="font-size:10.5px;">Registrado!</span>`;
        feedbackBtn.disabled = true;
        console.log('AnswerHunter: User reported extraction error via feedback button');
      } catch (fbErr) {
        console.warn('AnswerHunter: Feedback recording failed:', fbErr?.message);
      }
      return;
    }

    // --- Study Feature: Tutor Mode ---
    const tutorBtn = event.target.closest('.btn-tutor');
    if (tutorBtn) {
      const container = tutorBtn.closest('.study-actions-container')?.nextElementSibling; // the .study-feature-output div
      if (!container) return;

      const question = decodeURIComponent(tutorBtn.dataset.question || '');
      const answer = decodeURIComponent(tutorBtn.dataset.answer || '');
      const context = decodeURIComponent(tutorBtn.dataset.context || '');

      tutorBtn.disabled = true;
      tutorBtn.innerHTML = `<span class="material-symbols-rounded spin-loading">sync</span> <span>${this.t('status.refiningWithAi') || 'Pensando...'}</span>`;
      container.classList.remove('hidden');
      container.innerHTML = `<div class="study-loading-placeholder">Gerando explicação passo a passo...</div>`;

      try {
        const ApiServiceModule = (await import('../services/ApiService.js')).ApiService;
        const explanation = await ApiServiceModule.generateTutorExplanation(question, answer, context);

        // Escape raw AI content first, then apply safe markdown substitutions
        const htmlExplanation = this._parseMarkdown(explanation);

        container.innerHTML = `<div class="study-tutor-explanation">${htmlExplanation}</div>`;
      } catch (err) {
        console.error('AnswerHunter Tutor Mode err:', err);
        container.innerHTML = `<div class="study-error">Erro ao gerar explicação. Tente novamente mais tarde.</div>`;
      } finally {
        tutorBtn.disabled = false;
        tutorBtn.innerHTML = `<span class="material-symbols-rounded">school</span> <span>${this.t('result.tutor.btn')}</span>`;
      }
      return;
    }

    // --- Study Feature: Similar Question ---
    const similarBtn = event.target.closest('.btn-similar');
    if (similarBtn) {
      // Note: Currently stubbing Similar Question logic, will fill out in next phase.
      // Marking as in-progress.
      const container = similarBtn.closest('.study-actions-container')?.nextElementSibling; // the .study-feature-output div
      if (!container) return;

      const question = decodeURIComponent(similarBtn.dataset.question || '');

      similarBtn.disabled = true;
      similarBtn.innerHTML = `<span class="material-symbols-rounded spin-loading">sync</span> <span>${this.t('status.refiningWithAi') || 'Criando questão...'}</span>`;
      container.classList.remove('hidden');
      container.innerHTML = `<div class="study-loading-placeholder">Gerando uma questão similar para testar seus conhecimentos...</div>`;

      try {
        const ApiServiceModule = (await import('../services/ApiService.js')).ApiService;
        const newQuestion = await ApiServiceModule.generateSimilarQuestion(question);

        if (newQuestion && newQuestion.questionText) {
          const optionsHtml = Object.entries(newQuestion.optionsMap || {})
            .map(([letter, text]) => `<div class="similar-option"><strong>${this._escapeHtml(letter)})</strong> ${this._escapeHtml(text)}</div>`)
            .join('');

          container.innerHTML = `
            <div class="similar-question-block">
              <div class="similar-q-text"><strong>Q:</strong> ${this._escapeHtml(newQuestion.questionText)}</div>
              <div class="similar-options-list">${optionsHtml}</div>
              <details class="similar-answer-reveal">
                <summary>Ver Resposta</summary>
                <div class="similar-answer-text">Alternativa correta: <strong>${this._escapeHtml(newQuestion.answerLetter)}</strong></div>
              </details>
            </div>
          `;
        } else {
          throw new Error('Invalid question format received.');
        }
      } catch (err) {
        console.error('AnswerHunter Similar Question err:', err);
        container.innerHTML = `<div class="study-error">Erro ao gerar questão. Tente novamente mais tarde.</div>`;
      } finally {
        similarBtn.disabled = false;
        similarBtn.innerHTML = `<span class="material-symbols-rounded">quiz</span> <span>${this.t('result.similar.btn')}</span>`;
      }
      return;
    }

    // --- Study Feature: Follow-up Chat ---
    const chatBtn = event.target.closest('.btn-chat');
    if (chatBtn) {
      const container = chatBtn.closest('.study-actions-container')?.nextElementSibling;
      if (!container) return;

      const question = decodeURIComponent(chatBtn.dataset.question || '');
      const answer = decodeURIComponent(chatBtn.dataset.answer || '');
      const context = decodeURIComponent(chatBtn.dataset.context || '');

      if (!container.dataset.chatInitialized) {
        container.dataset.chatInitialized = 'true';
        container.classList.remove('hidden');
        container.innerHTML = `
          <div class="study-chat-container">
            <div class="study-chat-history">
              <div class="chat-message ai-message">
                <span class="material-symbols-rounded">robot_2</span>
                <div class="msg-content">${this.t ? this.t('result.chat.hello') || 'Olá! Como posso ajudar você a entender melhor esta questão?' : 'Olá! Como posso ajudar você a entender melhor esta questão?'}</div>
              </div>
            </div>
            <div class="study-chat-input-area">
              <input type="text" class="study-chat-input" placeholder="${this.t ? this.t('result.chat.placeholder') || 'Digite sua dúvida aqui...' : 'Digite sua dúvida aqui...'}">
              <button class="study-chat-send" type="button">
                <span class="material-symbols-rounded">send</span>
              </button>
            </div>
          </div>
        `;

        const input = container.querySelector('.study-chat-input');
        const sendBtn = container.querySelector('.study-chat-send');
        const history = container.querySelector('.study-chat-history');

        let messageHistory = [];

        const handleSend = async () => {
          const userMsg = input.value.trim();
          if (!userMsg) return;

          input.value = '';
          input.disabled = true;
          sendBtn.disabled = true;

          history.insertAdjacentHTML('beforeend', `
            <div class="chat-message user-message">
              <div class="msg-content">${this._escapeHtml ? this._escapeHtml(userMsg) : userMsg}</div>
              <span class="material-symbols-rounded">person</span>
            </div>
            <div class="chat-message ai-message pending-msg">
              <span class="material-symbols-rounded spin-loading">sync</span>
              <div class="msg-content">...</div>
            </div>
          `);
          history.scrollTop = history.scrollHeight;

          try {
            const ApiServiceModule = (await import('../services/ApiService.js')).ApiService;
            const response = await ApiServiceModule.answerFollowUp(question, answer, context, userMsg, messageHistory);

            messageHistory.push({ role: 'user', content: userMsg });
            messageHistory.push({ role: 'assistant', content: response });

            const pending = history.querySelector('.pending-msg');
            if (pending) pending.remove();

            // Transform markdown safely
            const htmlResponse = this._parseMarkdown(response);

            history.insertAdjacentHTML('beforeend', `
              <div class="chat-message ai-message">
                <span class="material-symbols-rounded">robot_2</span>
                <div class="msg-content">${htmlResponse}</div>
              </div>
            `);
          } catch (err) {
            console.error('AnswerHunter Chat Error:', err);
            const pending = history.querySelector('.pending-msg');
            if (pending) pending.remove();
            history.insertAdjacentHTML('beforeend', `
              <div class="chat-message ai-message error-msg">
                <span class="material-symbols-rounded">error</span>
                <div class="msg-content">Erro de conexão. Tente novamente.</div>
              </div>
            `);
          } finally {
            input.disabled = false;
            sendBtn.disabled = false;
            input.focus();
            history.scrollTop = history.scrollHeight;
          }
        };

        sendBtn.addEventListener('click', handleSend);
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') handleSend();
        });

        input.focus();
      } else {
        container.classList.toggle('hidden');
      }
      return;
    }
  },

  // ─── NativeFetchBridge Status ──────────────────────────────────────────────

  async _checkNativeBridgeStatus() {
    const banner = document.getElementById('native-bridge-banner');
    const dot = document.getElementById('native-bridge-dot');
    const label = document.getElementById('native-bridge-label');
    const installBtn = document.getElementById('native-bridge-install-btn');
    if (!banner || !dot || !label) return;

    // Show banner
    banner.classList.remove('hidden');
    dot.className = 'native-bridge-dot';
    label.textContent = 'NativeFetch Bridge: checking...';

    try {
      const available = await Promise.race([
        NativeFetchBridgeService.isAvailable(),
        new Promise(r => setTimeout(() => r(false), 3000)),
      ]);

      if (available) {
        banner.classList.remove('warn', 'err');
        dot.className = 'native-bridge-dot ok';
        label.textContent = 'NativeFetch Bridge: ativo ✓';
        if (installBtn) installBtn.classList.add('hidden');
        // Mark the entry button in settings as active
        const entryBtn = document.getElementById('nativeBridgeInstallBtn');
        if (entryBtn) {
          entryBtn.classList.add('turbo-entry-btn--active');
          const sub = entryBtn.querySelector('.turbo-entry-sub');
 if (sub) sub.textContent ='Ativo · buscando em Turbo Mode';
        }
      } else {
        // Bridge not installed — hide the banner entirely.
        // The extension works without it via BackgroundTabExtractorService (silent fallback).
        // The install button remains available in the settings panel for users who want Turbo Mode.
        banner.classList.add('hidden');
        return;
      }
    } catch (e) {
      // On error, hide banner — extension continues via tab fallback
      banner.classList.add('hidden');
    }

    // Install button handler
    if (installBtn && !installBtn._bridgeHandlerAdded) {
      installBtn._bridgeHandlerAdded = true;
      installBtn.addEventListener('click', () => this._openTurboWizard());
    }
  },

  // ─── TURBO WIZARD ─────────────────────────────────────────────────────────

  _openTurboWizard() {
    const overlay = document.getElementById('turbo-wizard-overlay');
    if (!overlay) return;

    this._turboWizardStep = 0;
    this._turboWizardDownloaded = false;

    // Reset all steps
    overlay.querySelectorAll('.tw-step').forEach(s => s.classList.add('hidden'));
    const step0 = document.getElementById('tw-step-0');
    if (step0) step0.classList.remove('hidden');
    this._turboUpdateDots(0);

    overlay.classList.remove('hidden');

    // Bind buttons (once)
    if (!overlay._wizardBound) {
      overlay._wizardBound = true;

      document.getElementById('tw-close-btn')?.addEventListener('click', () => this._closeTurboWizard());
      document.getElementById('tw-skip-btn')?.addEventListener('click', () => this._closeTurboWizard());
      document.getElementById('tw-start-btn')?.addEventListener('click', () => this._turboWizardBeginDownload());
      document.getElementById('tw-back-btn')?.addEventListener('click', () => this._turboWizardGoTo('tw-step-1'));
      document.getElementById('tw-done-install-btn')?.addEventListener('click', () => this._turboWizardVerify());
      document.getElementById('tw-success-close-btn')?.addEventListener('click', () => {
        this._closeTurboWizard();
        this._checkNativeBridgeStatus();
      });
      document.getElementById('tw-notfound-skip-btn')?.addEventListener('click', () => this._closeTurboWizard());
      document.getElementById('tw-retry-btn')?.addEventListener('click', () => this._turboWizardGoTo('tw-step-2'));

      // Close on backdrop click
      overlay.querySelector('.tw-backdrop')?.addEventListener('click', () => this._closeTurboWizard());
    }
  },

  _closeTurboWizard() {
    document.getElementById('turbo-wizard-overlay')?.classList.add('hidden');
  },

  _turboWizardGoTo(stepId) {
    const overlay = document.getElementById('turbo-wizard-overlay');
    if (!overlay) return;
    overlay.querySelectorAll('.tw-step').forEach(s => s.classList.add('hidden'));
    document.getElementById(stepId)?.classList.remove('hidden');
    const stepNum = { 'tw-step-0': 0, 'tw-step-1': 1, 'tw-step-2': 2, 'tw-step-3': 3 };
    this._turboUpdateDots(stepNum[stepId] ?? 3);
  },

  _turboUpdateDots(activeStep) {
    document.querySelectorAll('#tw-dots .tw-dot').forEach((dot, i) => {
      dot.classList.toggle('tw-dot--active', i === activeStep);
    });
  },

  async _turboWizardBeginDownload() {
    this._turboWizardGoTo('tw-step-1');
    this._turboUpdateDots(1);

    const progressBar = document.getElementById('tw-progress-bar');
    const progressLabel = document.getElementById('tw-progress-label');

    const setProgress = (pct, label) => {
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressLabel) progressLabel.textContent = label;
    };

    try {
      setProgress(10, 'Buscando os arquivos…');
      await this._downloadBridgeInstaller();
 setProgress(100,'Tudo pronto!');
      await new Promise(r => setTimeout(r, 600));
      this._turboWizardGoTo('tw-step-2');
      this._turboUpdateDots(2);
    } catch (e) {
      if (progressLabel) progressLabel.textContent = 'Erro no download — tente novamente';
    }
  },

  async _turboWizardVerify() {
    this._turboWizardGoTo('tw-step-3');
    this._turboUpdateDots(3);

    // Wait 1.5 s then probe bridge
    await new Promise(r => setTimeout(r, 1500));

    let available = false;
    try {
      available = await Promise.race([
        NativeFetchBridgeService.isAvailable(),
        new Promise(r => setTimeout(() => r(false), 4000)),
      ]);
    } catch (_) { }

    const overlay = document.getElementById('turbo-wizard-overlay');
    if (!overlay) return;
    overlay.querySelectorAll('.tw-step').forEach(s => s.classList.add('hidden'));

    if (available) {
      document.getElementById('tw-step-success')?.classList.remove('hidden');
      this._spawnConfetti();
    } else {
      document.getElementById('tw-step-notfound')?.classList.remove('hidden');
    }
  },

  _spawnConfetti() {
    const container = document.getElementById('tw-confetti');
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#FF6B6B', '#FFA94D', '#FFD43B', '#69DB7C', '#4DABF7', '#DA77F2', '#F783AC'];
    for (let i = 0; i < 36; i++) {
      const el = document.createElement('div');
      el.className = 'tw-confetti-piece';
      el.style.left = `${Math.random() * 100}%`;
      el.style.background = colors[i % colors.length];
      el.style.width = `${5 + Math.random() * 6}px`;
      el.style.height = el.style.width;
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      el.style.animationDuration = `${1.2 + Math.random() * 1.2}s`;
      el.style.animationDelay = `${Math.random() * 0.6}s`;
      container.appendChild(el);
    }
  },

  async _downloadBridgeInstaller() {
    const isWin = /Win/i.test(navigator.platform || navigator.userAgent);
    const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);

    const binaryName = isWin ? 'native-fetch-bridge.exe' : 'native-fetch-linux';
    const saveName = isWin ? 'native-fetch-bridge.exe' : 'native-fetch-bridge';

    const progressBar = document.getElementById('tw-progress-bar');
    const progressLabel = document.getElementById('tw-progress-label');
    const setProgress = (pct, label) => {
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressLabel) progressLabel.textContent = label;
    };

    setProgress(15, 'Preparando os arquivos…');

    const binaryUrl = chrome.runtime.getURL(`src/native/${binaryName}`);
    const response = await fetch(binaryUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    setProgress(45, 'Baixando executável…');

    const extensionId = chrome.runtime.id;

    await new Promise((resolve) => {
      chrome.downloads.download({ url: objectUrl, filename: saveName, saveAs: false }, resolve);
    });
    URL.revokeObjectURL(objectUrl);

    setProgress(70, 'Preparando instalador…');

    if (isWin) {
      const batContent = `@echo off\necho Instalando AnswerHunter Turbo Mode...\ncd /d "%~dp0"\n"%~dp0native-fetch-bridge.exe" --install ${extensionId}\n`;
      const batBlob = new Blob([batContent], { type: 'application/octet-stream' });
      const batUrl = URL.createObjectURL(batBlob);
      await new Promise((resolve) => {
        chrome.downloads.download({ url: batUrl, filename: 'instalar-bridge.bat', saveAs: false }, resolve);
      });
      URL.revokeObjectURL(batUrl);
    }

    setProgress(90, 'Quase pronto…');
  },

};


// AH_PHASE3_UI_CONFLICT_FILTER
function __ahFilterWeakConflictsForDisplay(results) {
  try {
    if (!Array.isArray(results)) return results;
    return results.map(r => {
      if (!r || String(r.state || '') !== 'confirmed') return r;
      const best = String(r.answerLetter || '').toUpperCase();
      const baseVotes = r.baseVotes || {};
      const entries = Object.entries(baseVotes);
      if (!best || !entries.length) return r;
      const bestVal = Number(baseVotes[best] || 0);
      const filtered = {};
      for (const [k, v] of entries) {
        const vv = Number(v || 0);
        if (k === best) filtered[k] = vv;
        else if (vv >= Math.max(1.2, bestVal * 0.45)) filtered[k] = vv;
      }
      return { ...r, baseVotes: filtered };
    });
  } catch (_) { return results; }
}
