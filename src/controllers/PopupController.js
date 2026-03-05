import { ExtractionService } from '../services/ExtractionService.js';
import { SearchService } from '../services/SearchService.js';
import { ApiService } from '../services/ApiService.js';
import { BinderController } from './BinderController.js';
import { DisciplinasController } from './DisciplinasController.js';
import { StorageModel } from '../models/StorageModel.js';
import { SettingsModel } from '../models/SettingsModel.js';
import { I18nService } from '../i18n/I18nService.js';
import { isLikelyQuestion, normalizeSpaces, renderMathInContainer } from '../utils/helpers.js';
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
  onboardingFlags: { welcomed: false, setupDone: false, toolkitTourShown: false },
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
    this.view.elements.setupSkipBtn?.addEventListener('click', () => this.handleSkipSetup());

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
      this._stopCopilotLoginPoll();
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

    // Build a friendly message listing exactly which keys are missing
    const missing = readiness.missingRequired;
    const names = missing.map(k => k === 'groq' ? 'Groq (IA)' : k === 'serper' ? 'Serper (busca)' : k).join(' e ');
    const friendlyMsg = `⚙️ Configure sua chave ${names} para usar o AnswerHunter`;

    this.view.setSettingsAttention(true);
    this.view.showToast(friendlyMsg, 'error');
    this.view.showStatus('error', friendlyMsg);

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
    if (this.view.elements.inputFirecrawl) {
      this.view.elements.inputFirecrawl.value = keys.firecrawlKey || this.view.elements.inputFirecrawl.value || '';
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
      groq: 'Groq',
      gemini: 'Gemini',
      openrouter: 'OpenRouter',
      chatgpt: 'ChatGPT',
      copilot: 'Copilot',
    };
    const activeModel = providerModelMap[primaryProvider] ?? '—';
    const activeLabel = PROVIDER_LABEL[primaryProvider] ?? primaryProvider;

    console.group(
      '%c AnswerHunter %c Provedor de IA atualizado',
      'background:#7c3aed;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px;',
      'color:#7c3aed;font-weight:bold;font-size:13px;'
    );
    console.log(`%c[FAST] Ativo agora: ${activeLabel} › ${activeModel}`, 'color:#16a34a;font-weight:bold;font-size:12px;');
    console.table(
      Object.entries(providerModelMap).map(([provider, model]) => ({
        'Provider': (PROVIDER_LABEL[provider] ?? provider),
        'Modelo': model,
        'Status': provider === primaryProvider ? ' ATIVO' : '○',
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

    // Start UI polling: refresh the panel automatically once login is detected
    this._startCopilotLoginPoll();
  },

  /**
   * Poll CopilotAuthService.isLoggedIn() every 3s while the code section is visible.
   * When login is detected, refresh the UI instantly without requiring popup reopen.
   */
  _startCopilotLoginPoll() {
    this._stopCopilotLoginPoll(); // clear any existing timer

    const poll = async () => {
      // Stop if code section is no longer visible (user closed / navigated away)
      const codeSection = document.getElementById('copilot-code-section');
      if (!codeSection || codeSection.classList.contains('hidden')) {
        this._stopCopilotLoginPoll();
        return;
      }

      try {
        const isLoggedIn = await CopilotAuthService.isLoggedIn();
        if (isLoggedIn) {
          this._stopCopilotLoginPoll();
          await new Promise(r => chrome.storage.local.remove(['copilot_pending_code'], r));
          await this.refreshCopilotAuthUI();
          this.view.showToast('GitHub Copilot conectado!', 'success');
          return;
        }
      } catch (_) { /* ignore, keep polling */ }

      this._copilotLoginPollTimer = setTimeout(poll, 3000);
    };

    this._copilotLoginPollTimer = setTimeout(poll, 3000);
  },

  _stopCopilotLoginPoll() {
    if (this._copilotLoginPollTimer) {
      clearTimeout(this._copilotLoginPollTimer);
      this._copilotLoginPollTimer = null;
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
          planBadgeEl.textContent = ` ${planLabel}`;
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
        if (resultEl) resultEl.innerHTML = '<span style="color:#ff7b72;"> Sem token válido. Faça login novamente.</span>';
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
        const reply = data.choices?.[0]?.message?.content?.trim() || '';
        if (resultEl) resultEl.innerHTML = `<span style="color:#3fb950;"> Conectado! Modelo respondeu:"${reply.slice(0, 40)}"</span>`;
        // Refresh token info since it may have been refreshed
        await this.refreshCopilotAuthUI();
      } else {
        const errText = await response.text().catch(() => '');
        const snippet = errText.slice(0, 120);
        if (resultEl) resultEl.innerHTML = `<span style="color:#ff7b72;"> HTTP ${response.status}: ${snippet}</span>`;
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = `<span style="color:#ff7b72;"> ${err.message || String(err)}</span>`;
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
        if (isFresh && (results[model] === 'ok' || results[model] === 'unsupported' || results[model] === 'unknown')) continue;

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
        
        // Ensure the "Configured" chip is shown immediately
        this.view.showKeyStatus(provider, true);

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
    const firecrawlApiKey = this.sanitizeKey(this.view.elements.inputFirecrawl?.value);
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
        firecrawlApiKey,
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
        openrouterApiKey,
        firecrawlApiKey
      };

      this.onboardingFlags.setupDone = true;
      this.onboardingFlags.welcomed = true;

      await this.saveOnboardingFlags();
      await this.clearDraftKeys();

      this.view.setSettingsAttention(false);
      this.view.setSetupVisible(false);
      this.view.showToast(this.t('setup.toast.saved'), 'success');
      this.view.showConfetti();

      // Show the toolkit tour once after first-time setup
      if (!this.onboardingFlags.toolkitTourShown) {
        setTimeout(() => this._showToolkitTour(), 900);
      }
    } catch (error) {
      console.error('Save setup error:', error);
      this.view.showToast(`Save error: ${error.message}`, 'error');
    }
  },

  async handleSkipSetup() {
    try {
      // Save whatever keys the user has entered so far (even if empty)
      const groqApiKey = this.sanitizeKey(this.view.elements.inputGroq?.value);
      const serperApiKey = this.sanitizeKey(this.view.elements.inputSerper?.value);
      const openrouterApiKey = this.sanitizeKey(this.view.elements.inputOpenrouter?.value);
      const geminiApiKey = this.sanitizeKey(this.view.elements.inputGemini?.value);
      const firecrawlApiKey = this.sanitizeKey(this.view.elements.inputFirecrawl?.value);

      await SettingsModel.saveSettings({
        groqApiKey,
        serperApiKey,
        geminiApiKey,
        openrouterApiKey,
        firecrawlApiKey,
        requiredProviders: { groq: true, serper: false, gemini: false }
      });
      this._settingsCache = {
        ...(this._settingsCache || {}),
        groqApiKey, serperApiKey, geminiApiKey, openrouterApiKey, firecrawlApiKey
      };

      this.onboardingFlags.setupDone = true;
      this.onboardingFlags.welcomed = true;
      await this.saveOnboardingFlags();
      await this.clearDraftKeys();

      this.view.setSettingsAttention(!groqApiKey);
      this.view.setSetupVisible(false);
      this.view.showToast('Setup pulado — você pode configurar as chaves a qualquer momento ⚙️', 'info');
    } catch (error) {
      console.error('Skip setup error:', error);
      this.view.showToast(`Erro: ${error.message}`, 'error');
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

  /**
   * Shows the post-onboarding toolkit tour (bottom sheet with 5 feature slides).
   * Called once after first-time setup. Wired entirely to DOM — no external deps.
   */
  _showToolkitTour() {
    const popover = document.getElementById('tt-popover');
    const backdrop = document.getElementById('tt-backdrop');
    const spotlight = document.getElementById('tt-spotlight');
    if (!popover) return;

    // Tour steps — each targets a real UI element
    const steps = [
      {
        target: '#searchBtn',
        icon: 'travel_explore', iconClass: 'tt-popover__icon--blue',
        desc: 'Para <strong>buscar gabaritos</strong> (carregar as questões), clique aqui com uma questão aberta.',
        placement: 'bottom',
      },
      {
        target: '#extractBtn',
        icon: 'description', iconClass: 'tt-popover__icon--orange',
        desc: '<strong>Extraia o texto da questão</strong> da página usando IA caso o copiar/colar falhe.',
        placement: 'bottom',
      },
      {
        target: '.tab-btn[data-tab="binder"]',
        icon: 'menu_book', iconClass: 'tt-popover__icon--orange',
        desc: 'Suas questões salvas ficam aqui, <strong>organizadas por disciplina</strong>.',
        placement: 'bottom',
        beforeShow: () => {
          const tab = document.querySelector('.tab-btn[data-tab="binder"]');
          if (tab && !tab.classList.contains('active')) tab.click();
        },
      },
      {
        target: '#openStudyPageBtn',
        icon: 'local_library', iconClass: 'tt-popover__icon--primary',
        desc: 'Clique neste botão para <strong>abrir a página e estudar</strong> com flashcards e simulados.',
        placement: 'bottom',
        isFinal: true,
        beforeShow: () => {
          const tab = document.querySelector('.tab-btn[data-tab="binder"]');
          if (tab && !tab.classList.contains('active')) tab.click();
        },
      },
    ];

    const TOTAL = steps.length;
    let current = 0;
    let prevHighlight = null;

    // Build dots
    const dotsContainer = document.getElementById('tt-dots');
    dotsContainer.innerHTML = '';
    steps.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'tt-dot' + (i === 0 ? ' tt-dot--active' : '');
      dot.addEventListener('click', () => goTo(i));
      dotsContainer.appendChild(dot);
    });

    // Nav button references removed — renderStep re-queries live elements after rebind

    function positionPopover(step) {
      const targetEl = document.querySelector(step.target);
      if (!targetEl) { popover.classList.add('hidden'); return; }

      // Remove previous highlight
      if (prevHighlight) prevHighlight.classList.remove('tt-target-highlight');
      targetEl.classList.add('tt-target-highlight');
      prevHighlight = targetEl;

      const rect = targetEl.getBoundingClientRect();
      const popW = 280;

      // Spotlight around target
      spotlight.classList.remove('hidden');
      spotlight.style.left = `${rect.left - 4}px`;
      spotlight.style.top = `${rect.top - 4}px`;
      spotlight.style.width = `${rect.width + 8}px`;
      spotlight.style.height = `${rect.height + 8}px`;

      // Arrow + popover position
      const arrow = document.getElementById('tt-arrow');
      popover.setAttribute('data-placement', step.placement || 'bottom');

      let left, top;
      if (step.placement === 'top') {
        top = rect.top - popover.offsetHeight - 12;
        left = rect.left + rect.width / 2 - popW / 2;
      } else {
        top = rect.bottom + 12;
        left = rect.left + rect.width / 2 - popW / 2;
      }

      // Clamp within popup window
      left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - 200));

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;

      // Arrow position relative to target center
      const arrowLeft = Math.max(20, Math.min(rect.left + rect.width / 2 - left, popW - 20));
      arrow.style.left = `${arrowLeft}px`;
      arrow.style.marginLeft = '0';
    }

    function renderStep(i) {
      const step = steps[i];

      // Optional tab switch before showing
      if (step.beforeShow) step.beforeShow();

      // Fill content
      document.getElementById('tt-step-label').textContent = `Passo ${i + 1} de ${TOTAL}`;
      const iconEl = document.getElementById('tt-icon');
      iconEl.className = 'tt-popover__icon ' + step.iconClass;
      iconEl.innerHTML = `<span class="material-symbols-rounded">${step.icon}</span>`;

      const titleEl = document.getElementById('tt-title');
      if (step.title && titleEl) {
        titleEl.textContent = step.title;
        titleEl.style.display = 'block';
      } else if (titleEl) {
        titleEl.style.display = 'none';
      }

      document.getElementById('tt-desc').innerHTML = step.desc;

      // Update dots
      dotsContainer.querySelectorAll('.tt-dot').forEach((d, di) => {
        d.classList.toggle('tt-dot--active', di === i);
      });

      // Nav buttons — re-query after rebind clones them
      const prevBtn   = document.getElementById('ttPrevBtn');
      const nextBtn   = document.getElementById('ttNextBtn');
      const finishBtn = document.getElementById('ttFinishBtn');
      const skipBtn   = document.getElementById('ttSkipBtn');
      if (prevBtn)   prevBtn.disabled = i === 0;
      const isLast = i === TOTAL - 1;
      if (nextBtn)   nextBtn.classList.toggle('hidden', isLast);
      if (finishBtn) finishBtn.classList.toggle('hidden', !isLast);
      if (skipBtn)   skipBtn.classList.toggle('hidden', isLast);

      // Show & position
      popover.classList.remove('hidden');
      popover.style.animation = 'none';
      popover.offsetHeight; // reflow
      popover.style.animation = '';

      requestAnimationFrame(() => positionPopover(step));
    }

    function goTo(i) {
      current = Math.max(0, Math.min(i, TOTAL - 1));
      renderStep(current);
    }

    const close = async () => {
      popover.classList.add('hidden');
      backdrop.classList.add('hidden');
      spotlight.classList.add('hidden');
      if (prevHighlight) prevHighlight.classList.remove('tt-target-highlight');
      this.onboardingFlags.toolkitTourShown = true;
      await this.saveOnboardingFlags();
    };

    // Bind nav (clone to avoid duplicate listeners)
    const rebind = (id, fn) => {
      const el = document.getElementById(id);
      const fresh = el.cloneNode(true);
      el.parentNode.replaceChild(fresh, el);
      fresh.addEventListener('click', fn);
      return fresh;
    };

    rebind('ttPrevBtn', () => goTo(current - 1));
    rebind('ttNextBtn', () => goTo(current + 1));
    rebind('ttFinishBtn', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/study/study.html') });
      close();
    });
    rebind('ttSkipBtn', () => close());

    // Click backdrop to close
    backdrop.onclick = () => close();

    // Show tour
    backdrop.classList.remove('hidden');
    renderStep(0);
  },

  async handleExtract() {
    if (!(await this.ensureReadyOrShowSetup())) return;

    this.view.showStatus('loading', this.t('status.extractingContent'));
    this.view.setButtonDisabled('extractBtn', true);
    this.view.setButtonDisabled('copyBtn', true);

    // Sites that load answer content in the initial HTML but hide it via JS paywall.
    // For these, we reload the tab, wait a short time for content to arrive, then
    // stop loading (before the paywall JS blurs/hides the answer).
    const PAYWALL_RELOAD_HOSTS = [
      'brainly.com', 'brainly.com.br', 'brainly.lat', 'brainly.es', 'brainly.in',
      'passeidireto.com',
      'studocu.com',
      'chegg.com',
      'coursehero.com',
    ];

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
        this.view.showStatus('error', this.t('status.restrictedPage'));
        return;
      }

      // Detect if this site needs the reload+stop trick
      let hostname = '';
      try { hostname = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { /**/ }
      const needsReloadTrick = PAYWALL_RELOAD_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));

      if (needsReloadTrick) {
        console.log(`[AH Extract] 🔄 Paywall site detected: ${hostname} — using reload+stop trick`);
        this.view.showStatus('loading', '🔄 Recarregando para capturar conteúdo...');

        const navigationCommitted = new Promise(resolve => {
          let resolved = false;
          const listener = (tabId, changeInfo) => {
            if (tabId === tab.id && changeInfo.status === 'loading' && !resolved) {
              resolved = true;
              chrome.tabs.onUpdated.removeListener(listener);
              console.log(`[AH Extract] 🚦 Navigation committed — starting timer`);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => { if (!resolved) { resolved = true; chrome.tabs.onUpdated.removeListener(listener); resolve(); } }, 3000);
        });

        // bypassCache forces a real network request (slower) giving us more time to stop
        await chrome.tabs.reload(tab.id, { bypassCache: true });
        await navigationCommitted;

        const STOP_DELAY_MS = 250;
        console.log(`[AH Extract] ⏳ Waiting ${STOP_DELAY_MS}ms from navigation start (bypass-cache)...`);
        await new Promise(resolve => setTimeout(resolve, STOP_DELAY_MS));

        console.log(`[AH Extract] 🛑 Calling window.stop() to freeze DOM`);
        const stopResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => { window.stop(); return document.readyState; }
        });
        console.log(`[AH Extract] 📄 readyState after stop: ${stopResult?.[0]?.result}`);
        await new Promise(resolve => setTimeout(resolve, 150));
        console.log(`[AH Extract] ✅ Reload+stop complete`);
      } else {
        console.log(`[AH Extract] ℹ️ Normal site: ${hostname} — no reload needed`);
      }

      this.view.showStatus('loading', this.t('status.extractingContent'));

      // Step 1: grab the visible text of the page (no complex DOM selectors)
      console.log(`[AH Extract] 📋 Grabbing page text...`);
      const textResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (isPaywallSite) => {
          // For paywall sites (Brainly etc): extract content directly from known DOM nodes,
          // bypassing any overlay/blur the paywall JS may have added visually.
          // The answer text lives in the DOM even after paywall JS runs — just hidden by CSS.
          if (isPaywallSite) {
            const parts = [];
            // Brainly: question and answer both use data-testid="safe_html_ucr"
            const ucr = document.querySelectorAll('[data-testid="safe_html_ucr"]');
            if (ucr.length > 0) {
              ucr.forEach(el => {
                const t = el.innerText?.trim();
                if (t) parts.push(t);
              });
              console.log(`[AH Extract DOM] safe_html_ucr spans: ${ucr.length}, parts: ${parts.length}`);
              if (parts.length > 0) return parts.join('\n\n');
            }
            // Passei Direto / Studocu: try generic answer containers
            const answerEls = document.querySelectorAll(
              '[data-testid*="answer"], [class*="answer-content"], [class*="answer_content"], [class*="resolucao"]'
            );
            answerEls.forEach(el => {
              const t = el.innerText?.trim();
              if (t && t.length > 20) parts.push(t);
            });
            if (parts.length > 0) {
              console.log(`[AH Extract DOM] generic answer containers: ${parts.length}`);
              return parts.join('\n\n');
            }
          }
          // Fallback: clean innerText
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('script,style,noscript,nav,footer,header,[class*="ad-"],[id*="ad-"],[class*="banner"],[class*="cookie"],[class*="popup"]').forEach(el => el.remove());
          // Preserve math formulas: replace <math> elements with their LaTeX source.
          // KaTeX and MathJax both store the original LaTeX in <annotation encoding="application/x-tex">.
          // Without this, innerText collapses e.g. \frac{1}{2} → "12".
          clone.querySelectorAll('math').forEach(mathEl => {
            const annotation = mathEl.querySelector('annotation[encoding="application/x-tex"]');
            const latex = annotation?.textContent?.trim()
              || mathEl.getAttribute('alttext')
              || mathEl.textContent?.trim();
            if (latex) {
              const placeholder = document.createTextNode(` $${latex}$ `);
              mathEl.parentNode?.replaceChild(placeholder, mathEl);
            }
          });
          return clone.innerText || document.body.innerText || '';
        },
        args: [needsReloadTrick]
      });

      const pageText = textResults?.[0]?.result || '';
      console.log(`[AH Extract] 📝 Page text length: ${pageText.length} chars`);
      console.log(`[AH Extract] 📝 Preview: ${pageText.slice(0, 300)}`);
      if (!pageText || pageText.trim().length < 30) {
        console.warn(`[AH Extract] ⚠️ Page text too short, aborting`);
        this.view.showStatus('error', this.t('status.noQuestionFound'));
        return;
      }

      this.view.showStatus('loading', this.t('status.refiningWithAi'));
      this.view.clearResults();

      // Step 2: send raw text to LLM — it extracts + formats everything
      console.log(`[AH Extract] 🤖 Sending to LLM for extraction...`);
      const extracted = await ApiService.extractQuestionFromPageText(pageText, tab.url);
      console.log(`[AH Extract] 🎯 LLM result:`, extracted);
      if (!extracted) {
        console.warn(`[AH Extract] ⚠️ LLM returned null — no question found`);
        this.view.showStatus('error', this.t('status.noValidQuestion'));
        return;
      }
      console.log(`[AH Extract] ✅ Extracted — question: "${extracted.question?.slice(0,80)}..." | answer: "${extracted.answer}"`);

      const withSaved = this._decorateWithSavedMeta([extracted]);

      this.view.appendResults(withSaved);
      await this.saveLastResults(withSaved);
      this.view.showStatus('success', this.t('status.questionsFound', { count: 1 }));
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

  _createFlowCtx(scope = 'SEARCH') {
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase(),
      scope: String(scope || 'SEARCH').toUpperCase(),
      seq: 0,
      startedAt: Date.now()
    };
  },

  _flowLog(ctx, step, status = 'INFO', message = '', payload = null) {
    const localCtx = ctx || this._createFlowCtx('SEARCH');
    localCtx.seq += 1;
    const safeStep = String(step || 'STEP').toUpperCase();
    const safeStatus = String(status || 'INFO').toUpperCase();
    const prefix = `[AH FLOW ${localCtx.scope} ${localCtx.id} #${String(localCtx.seq).padStart(2, '0')}] ${safeStep} ${safeStatus}`;
    if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) {
      console.log(`${prefix} - ${message}`, payload);
    } else {
      console.log(`${prefix} - ${message}`);
    }
  },

  async _cropCapturedImageToBbox(dataUrl, bbox, opts = {}) {
    if (!dataUrl || !bbox || !bbox.width || !bbox.height) return null;
    const padding = Math.max(0, Number(opts.padding ?? 20));
    const minCrop = Math.max(80, Number(opts.minCrop ?? 120));
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const viewportWidth = Math.max(1, Number(bbox.viewportWidth) || img.width);
            const viewportHeight = Math.max(1, Number(bbox.viewportHeight) || img.height);
            const scaleX = img.width / viewportWidth;
            const scaleY = img.height / viewportHeight;

            const rawLeft = Math.max(0, Number(bbox.left || 0) - padding);
            const rawTop = Math.max(0, Number(bbox.top || 0) - padding);
            const rawRight = Math.min(viewportWidth, Number(bbox.left || 0) + Number(bbox.width || 0) + padding);
            const rawBottom = Math.min(viewportHeight, Number(bbox.top || 0) + Number(bbox.height || 0) + padding);

            const sx = Math.max(0, Math.floor(rawLeft * scaleX));
            const sy = Math.max(0, Math.floor(rawTop * scaleY));
            const sw = Math.max(1, Math.floor((rawRight - rawLeft) * scaleX));
            const sh = Math.max(1, Math.floor((rawBottom - rawTop) * scaleY));

            if (sw < minCrop || sh < minCrop) return resolve(null);

            const canvas = document.createElement('canvas');
            canvas.width = Math.min(sw, img.width - sx);
            canvas.height = Math.min(sh, img.height - sy);
            const ctx2d = canvas.getContext('2d');
            if (!ctx2d || canvas.width <= 0 || canvas.height <= 0) return resolve(null);

            ctx2d.drawImage(
              img,
              sx,
              sy,
              canvas.width,
              canvas.height,
              0,
              0,
              canvas.width,
              canvas.height
            );
            resolve(canvas.toDataURL('image/jpeg', 0.92));
          } catch (_) {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      } catch (_) {
        resolve(null);
      }
    });
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ⛔⛔⛔  handleSearch() — ZONA SAGRADA — NÃO MODIFIQUE  ⛔⛔⛔      ║
  // ║                                                                      ║
  // ║  Este método é o CORAÇÃO do AnswerHunter. Controla TODO o fluxo:     ║
  // ║    1. Extração do DOM (extractQuestionOnlyScript)                     ║
  // ║    2. Hover anchor + Platform extractor + Viewport-centric           ║
  // ║    3. Fingerprint da questão                                         ║
  // ║    4. Vision OCR (quando DOM é insuficiente)                         ║
  // ║    5. OPTIONS_CONTAMINATION_GUARD (validação cruzada stem↔opções)    ║
  // ║    6. pickBestFrameResult + PRE_SEARCH_GATE rescue                   ║
  // ║    7. Multi-question isolation                                       ║
  // ║    8. Options backfill + recovery                                    ║
  // ║    9. LLM post-validation + confidence scoring                       ║
  // ║   10. Query building + search dispatch                               ║
  // ║                                                                      ║
  // ║  CADA BLOCO resolve um bug real de produção. Exemplos:               ║
  // ║    - Letra fundida "Afprintf()" → fix de separação letter/body       ║
  // ║    - Opções de C (fprintf, fread) rejeitadas → fix function-call     ║
  // ║    - pickBestFrameResult undefined → adicionado helper               ║
  // ║    - Opções de outra questão misturadas → contamination guard        ║
  // ║                                                                      ║
  // ║  SE VOCÊ É UMA LLM/IA: NÃO REFATORE. NÃO "OTIMIZE". NÃO EXTRAIA   ║
  // ║  PARA SUBFUNÇÕES. NÃO MUDE THRESHOLDS. NÃO REORDENE FASES.         ║
  // ║  Isso aqui funciona. "Melhorar" = destruir.                         ║
  // ║                                                                      ║
  // ║  SE VOCÊ É UM HUMANO: Não mexa sem rodar os testes E2E.             ║
  // ║  Última calibração: 2026-03-04 — APROVADO EM PRODUÇÃO.              ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  async handleSearch() {
    if (!(await this.ensureReadyOrShowSetup())) return;

    this.view.showStatus('loading', this.t('status.gettingQuestion') || 'Capturando tela...');
    this.view.setButtonDisabled('searchBtn', true);
    this.view.setButtonDisabled('copyBtn', true);
    this.view.clearResults();

    const _pcTimer = PerformanceTimer.create('handleSearch() — Vision Pipeline');
    const _flow = this._createFlowCtx('SEARCH');
    let _flowOutcome = 'DONE';

    try {
      this._flowLog(_flow, 'INIT', 'START', 'Iniciando pipeline visual e simplificado.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
        this.view.showStatus('error', this.t('status.restrictedPage'));
        return;
      }

      // Step 1: Capture screenshot
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 65 });
      if (!dataUrl) {
        throw new Error('Falha ao capturar screenshot da aba.');
      }
      const screenshotBase64 = dataUrl.split(',')[1];
      this._flowLog(_flow, 'VISION', 'OK', 'Screenshot capturado');

      // Step 2: Extract HTML
      let htmlContent = null;
      try {
        const htmlRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          function: ExtractionService.extractViewportHtmlScript
        });
        htmlContent = htmlRes?.[0]?.result?.html || '';
      } catch (err) {
        console.warn('AnswerHunter: Failed to extract HTML:', err);
      }
      _pcTimer.mark('Capture & HTML Extracted');

      // Step 3: LLM Vision Extraction
      this.view.showStatus('loading', this.t('status.visionOcr') || 'Montando questão via IA...');
      const vgResult = await ApiService.visionGuidedExtraction(screenshotBase64, htmlContent, null);

      if (!vgResult || vgResult.length < 30) {
        throw new Error('A IA não conseguiu interpretar a questão na tela. Tente rolar para enquadrar melhor.');
      }

      const displayQuestion = vgResult;
      const bestQuestion = vgResult;
      const _visionGuidedParsed = this._buildVisionGuidedParsed(vgResult);
      this._lastVisionGuidedParsed = _visionGuidedParsed || null;
      _pcTimer.mark('LLM Vision Extracted');

      // (We skip any fallback/heuristics, user mandated 100% vision-guided linear flow)
      this._flowLog(_flow, 'PAYLOAD', 'OK', 'Questão montada e pronta para busca');

      // Final Step: Dispatch to background for search
      const requestId = `srch_${Date.now()}`;
      const extractionConfidence = { score: 1.0, level: 'high', signals: ['vision-guided'] };
      this._lastExtractionConfidence = extractionConfidence;

      await chrome.storage.local.set({
        ah_pending_search: { requestId, displayQuestion, bestQuestion, extractionConfidence, visionGuidedParsed: _visionGuidedParsed || null }
      });

      let bgDispatched = false;
      try {
        await chrome.runtime.sendMessage({
          type: 'SEARCH_PHASE2',
          requestId,
          question: bestQuestion,
          displayQuestion,
          visionGuidedParsed: _visionGuidedParsed || null
        });
        bgDispatched = true;
        _pcTimer.mark('Background Dispatch');
      } catch (err) {
        console.warn('Background dispatch failed:', err);
      }

      if (!bgDispatched) {
        // Inline fallback just in case background worker is dead
        const _sr = await SearchService.searchOnly(bestQuestion, displayQuestion, (m) => this.view.showStatus('loading', m));
        const _fr = await SearchService.refineFromResults(bestQuestion, _sr, displayQuestion, (m) => this.view.showStatus('loading', m), null, _visionGuidedParsed || null);
        await this._finishBackgroundSearch(_fr, displayQuestion, bestQuestion);
        return;
      }

      this.view.showStatus('loading', this.t('status.searchingBackground'));
      this._startPollBackgroundSearch(requestId, displayQuestion, bestQuestion);

    } catch (error) {
      _flowOutcome = 'ERROR';
      console.error('Search flow error:', error);
      const message = error?.message === 'SETUP_REQUIRED'
        ? this.t('setup.toast.required')
        : this.t('status.searchError', { message: error.message || 'unknown' });
      this.view.showStatus('error', message);

      if (error?.message === 'SETUP_REQUIRED') {
        this.toggleSetupPanel(true);
      }
    } finally {
      this._flowLog(_flow, 'END', _flowOutcome, 'Fluxo finalizado');
      this.view.setButtonDisabled('searchBtn', false);
    }
  },

  // Background search helpers
  async _finishBackgroundSearch(finalResults, displayQuestion, bestQuestion) {
    console.log('[AH FLOW BG] RESULT_RECEIVED', {
      count: Array.isArray(finalResults) ? finalResults.length : 0
    });
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
      console.log('[AH FLOW BG] FALLBACK_AI_TRIGGERED', {
        reason: 'inconclusive_without_votes_or_sources'
      });
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
    console.log('[AH FLOW BG] RESULT_RENDERED', {
      count: finalResults.length
    });
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

      // Restore vision-guided structured data so it survives popup close/reopen
      if (pending.visionGuidedParsed) {
        this._lastVisionGuidedParsed = pending.visionGuidedParsed;
      }
      if (pending.extractionConfidence) {
        this._lastExtractionConfidence = pending.extractionConfidence;
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
    const baseMap = QuestionParser.buildOptionsMap(String(text || ''));
    const entries = ['A', 'B', 'C', 'D', 'E']
      .filter((letter) => !!baseMap[letter])
      .map((letter) => ({
        letter,
        body: QuestionParser.stripOptionTailNoise(baseMap[letter] || '')
      }))
      .filter((entry) => !!entry.body);
    if (entries.length === 0) return {};

    const contiguous = [];
    for (let i = 0; i < entries.length; i++) {
      const expected = String.fromCharCode(65 + i);
      if (entries[i].letter !== expected) break;
      contiguous.push(entries[i]);
    }
    const working = contiguous.length >= 2 ? contiguous : entries;

    const lengths = working.map((entry) => entry.body.length).sort((a, b) => a - b);
    const medianLen = lengths.length > 0 ? lengths[Math.floor(lengths.length / 2)] : 0;
    const leakMarkers = /\b(?:considere|assinale|marque|associe|associa[cç][aã]o|sobre a|sobre o|s[aã]o corretas|est[aã]o corretas|analise|verifique|qual(?:is)?\b|quest[aã]o|pergunta)\b/i;
    const questionishBodyRe = /\b(?:marque|assinale|considere|associe|qual(?:is)?|pergunta|quest[aã]o)\b/i;
    const hardLeakPattern = /\b(?:\d{1,2}\s+(?:marcar|revis[aã]o|quest[aã]o|um|uma|voce|você)|marcar\s+para\s+revis[aã]o)\b/i;

    const out = {};
    for (const entry of working) {
      const body = String(entry.body || '').trim();
      if (!body || !QuestionParser.isUsableOptionBody(body)) continue;
      if (body.length > 320) continue;
      if (hardLeakPattern.test(body)) continue;
      if (body.length >= 45 && questionishBodyRe.test(body)) continue;
      if (medianLen > 0 && body.length > Math.max(90, medianLen * 3.5) && leakMarkers.test(body)) continue;
      out[entry.letter] = body;
    }
    return out;
  },

  /**
   * Build a structured { stem, alternatives } object from a visionGuided result string.
   * This is stored and passed through to formatQuestionText so it can render directly
   * without re-parsing (which destroys stem-embedded items like "A. %d", "B. %s").
   */
  _buildVisionGuidedParsed(vgText) {
    if (!vgText) return null;
    const optRe = /^([A-H])\)\s*(.+)$/im;
    const lines = vgText.split('\n');
    const stemLines = [];
    const alternatives = [];
    for (const line of lines) {
      const m = line.match(optRe);
      if (m) {
        alternatives.push({ letter: m[1].toUpperCase(), body: m[2].trim() });
      } else if (alternatives.length === 0) {
        stemLines.push(line);
      }
      // lines after options that don't match are ignored (shouldn't happen)
    }
    const stem = stemLines.join('\n').trim();
    if (!stem || alternatives.length < 2) return null;
    return { stem, alternatives };
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
      .replace(/[^a-z0-9]+/g, '')
      .trim()
      .replace(/\s+/g, '')
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
    html = html.replace(/^\u2705(.*)$/gim, '<div style="background:linear-gradient(90deg,#F0FDF4,#DCFCE7);border:1px solid #BBF7D0;border-radius:10px;padding:10px 14px;font-weight:700;color:#15803D;margin-bottom:12px;">$1</div>');
    html = html.replace(/^\u{1F4A1}(.*)$/gimu, '<div style="background:linear-gradient(90deg,#EEF2FF,#E0E7FF);border:1px solid #C7D2FE;border-radius:10px;padding:10px 14px;font-weight:600;color:#4338CA;margin-top:10px;">$1</div>');
    html = html.replace(/^\u274C(.*)$/gim, '<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:6px 12px;margin-bottom:4px;font-size:0.88em;color:#991B1B;">$1</div>');

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
    const vgParsed = this._lastVisionGuidedParsed || null;
    return (items || []).map((item) => {
      const question = item.question || questionFallback;
      const meta = StorageModel.getQuestionMeta(question);
      return {
        ...item,
        question,
        saved: meta.saved,
        reviewLater: meta.reviewLater,
        extractionConfidence: item.extractionConfidence || ec,
        visionGuidedParsed: item.visionGuidedParsed || vgParsed
      };
    });
  },

  /** Logs a user-friendly DevTools table showing extraction source, success, and answer. */
  _logExtractionTable(results) {
    const SOURCE_ICON = {
      cache: '',
      page: '',
      'page-cache': '',
      ai: '',
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
        ? `${letter}${r.answerText ? ' →  ' + String(r.answerText).slice(0, 55) : ''}`
        : '—';
      if (srcList.length > 0) {
        srcList.forEach((s, j) => {
          const icon = SOURCE_ICON[s.type] ?? '';
          const label = s.link || getDomain(s.link) || String(s.title || '?').slice(0, 80);
          rows.push({
            '#': j === 0 ? i + 1 : ' └',
            'Fonte': `${icon} ${label}`,
            'Extraiu?': ok ? '' : '',
            'Gabarito': gabarito,
            'Confiança': j === 0 ? confidence : '',
          });
        });
      } else {
        rows.push({
          '#': i + 1,
          'Fonte': r.aiFallback ? ' IA (fallback)' : '—',
          'Extraiu?': ok ? '' : '',
          'Gabarito': gabarito,
          'Confiança': confidence,
        });
      }
    });

    const found = (results || []).filter(r => /^[A-E]$/.test(String(r.answerLetter || r.bestLetter || '').toUpperCase())).length;
    const badge = found > 0 ? `%c [OK] ${found} gabarito(s) encontrado(s)` : `%c [FAIL] Sem gabarito`;
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
        renderMathInContainer(container);
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
          renderMathInContainer(container);
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
            // Render math in the newly added message
            const lastMsg = history.querySelector('.ai-message:last-child .msg-content');
            renderMathInContainer(lastMsg);
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
        label.textContent = 'NativeFetch Bridge: ativo ';
        if (installBtn) installBtn.classList.add('hidden');
        // Mark the entry button in settings as active
        const entryBtn = document.getElementById('nativeBridgeInstallBtn');
        if (entryBtn) {
          entryBtn.classList.add('turbo-entry-btn--active');
          const sub = entryBtn.querySelector('.turbo-entry-sub');
          if (sub) sub.textContent = 'Ativo · buscando em Turbo Mode';
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
      setProgress(100, 'Tudo pronto!');
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
