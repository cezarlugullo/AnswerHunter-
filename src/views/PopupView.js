import { formatQuestionText, escapeHtml } from '../utils/helpers.js';

export const PopupView = {
  elements: {},
  _translator: (key) => key,
  _currentSlide: 0,

  init() {
    this.cacheElements();
    this._setupTutorialToggles();
    this._setupGlowBackground();
  },

  /** Interactive glow background that follows mouse cursor */
  _setupGlowBackground() {
    document.addEventListener('mousemove', (e) => {
      document.documentElement.style.setProperty('--ah-mouse-x', e.clientX + 'px');
      document.documentElement.style.setProperty('--ah-mouse-y', e.clientY + 'px');
    });
  },

  setTranslator(translator) {
    if (typeof translator === 'function') {
      this._translator = translator;
    }
  },

  t(key, variables) {
    try {
      return this._translator(key, variables);
    } catch (_) {
      return key;
    }
  },

  cacheElements() {
    this.elements = {
      // Main App
      extractBtn: document.getElementById('extractBtn'),
      searchBtn: document.getElementById('searchBtn'),
      copyBtn: document.getElementById('copyBtn'),
      statusDiv: document.getElementById('status'),
      resultsDiv: document.getElementById('results'),
      binderList: document.getElementById('binder-list'),
      clearBinderBtn: document.getElementById('clearBinderBtn'),
      tabs: document.querySelectorAll('.tab-btn'),
      sections: document.querySelectorAll('.view-section'),
      settingsBtn: document.getElementById('settingsBtn'),
      languageToggle: document.getElementById('languageToggle'),
      toastContainer: document.getElementById('toast-container'),

      // Onboarding Elements
      onboardingView: document.getElementById('onboarding-view'),
      onboardingSlides: document.getElementById('onboarding-slides'),
      progressBar: document.getElementById('onboarding-progress-bar'),
      progressGlow: document.getElementById('ob-progress-glow'),
      stepDots: document.getElementById('ob-step-dots'),

      // Buttons
      welcomeStartBtn: document.getElementById('welcomeStartBtn'),
      btnNextGroq: document.getElementById('btn-next-groq'),
      btnNextSerper: document.getElementById('btn-next-serper'),
      btnNextGemini: document.getElementById('btn-next-gemini'),
      saveSetupBtn: document.getElementById('saveSetupBtn'),
      setupSkipBtn: document.getElementById('setupSkipBtn'),

      prevGroq: document.getElementById('prev-groq'),
      prevSerper: document.getElementById('prev-serper'),
      prevGemini: document.getElementById('prev-gemini'),
      prevPrefs: document.getElementById('prev-prefs'),

      // Inputs
      inputGroq: document.getElementById('input-groq'),
      inputSerper: document.getElementById('input-serper'),
      inputGemini: document.getElementById('input-gemini'),
      selectSearchProvider: document.getElementById('select-search-provider'),
      linkSearchProvider: document.getElementById('link-search-provider'),
      selectSearchProviderOb: document.getElementById('selectSearchProviderOb'),

      // Tests
      testGroq: document.getElementById('test-groq'),
      testSerper: document.getElementById('test-serper'),
      testGemini: document.getElementById('test-gemini'),

      // OpenRouter elements
      btnNextOpenrouter: document.getElementById('btn-next-openrouter'),
      prevOpenrouter: document.getElementById('prev-openrouter'),
      inputOpenrouter: document.getElementById('input-openrouter'),
      testOpenrouter: document.getElementById('test-openrouter'),
      statusOpenrouter: document.getElementById('status-openrouter'),
      pillOpenrouterOb: document.getElementById('pill-openrouter-ob'),
      selectOpenrouterModel: document.getElementById('select-openrouter-model'),
      keyStatusOpenrouter: document.getElementById('key-status-openrouter'),
      changeKeyOpenrouter: document.getElementById('change-key-openrouter'),
      removeKeyOpenrouter: document.getElementById('remove-key-openrouter'),
      closeSettingsOpenrouter: document.getElementById('close-settings-openrouter'),// Status
      statusGroq: document.getElementById('status-groq'),
      statusSerper: document.getElementById('status-serper'),
      statusGemini: document.getElementById('status-gemini'),

      // AI Provider & Model Config
      providerToggle: document.getElementById('provider-toggle'),
      pillGroq: document.getElementById('pill-groq'),
      pillGemini: document.getElementById('pill-gemini'),
      pillGroqOb: document.getElementById('pill-groq-ob'),
      pillGeminiOb: document.getElementById('pill-gemini-ob'),
      providerHint: document.getElementById('provider-hint'),
      selectGroqModel: document.getElementById('select-groq-model'),
      selectGeminiModel: document.getElementById('select-gemini-model'),

      // Key Status Chips (settings reopen)
      keyStatusGroq: document.getElementById('key-status-groq'),
      keyStatusSerper: document.getElementById('key-status-serper'),
      keyStatusGemini: document.getElementById('key-status-gemini'),

      // Change Key Buttons
      changeKeyGroq: document.getElementById('change-key-groq'),
      changeKeySerper: document.getElementById('change-key-serper'),
      changeKeyGemini: document.getElementById('change-key-gemini'),
      removeKeySerper: document.getElementById('remove-key-serper'),
      removeKeyGemini: document.getElementById('remove-key-gemini'),

      // Close Settings Buttons
      closeSettingsGroq: document.getElementById('close-settings-groq'),
      closeSettingsSerper: document.getElementById('close-settings-serper'),
      closeSettingsGemini: document.getElementById('close-settings-gemini'),

      // Onboarding Language Toggle
      obLanguageToggle: document.getElementById('obLanguageToggle'),

      // Binder Go to Search CTA
      binderGoToSearch: document.getElementById('binderGoToSearch')
    };
  },

  /** Tutorial is always visible now — no accordion toggle needed */
  _setupTutorialToggles() {
    // No-op: tutorials are always-visible lists, not collapsible accordions
  },

  setLanguageSelectValue(language) {
    // Sync main app language toggle (flags only)
    if (this.elements.languageToggle) {
      this.elements.languageToggle.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === language);
      });
    }
    // Sync onboarding language toggle
    this.setObLanguageSelectValue(language);
  },

  setObLanguageSelectValue(language) {
    if (this.elements.obLanguageToggle) {
      this.elements.obLanguageToggle.querySelectorAll('.ob-lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === language);
      });
    }
  },

  showStatus(type, message) {
    const status = this.elements.statusDiv;
    if (!status) return;

    status.className = `status ${type}`;
    status.innerHTML = type === 'loading'
      ? `<span class="material-symbols-rounded spin-loading">sync</span> ${escapeHtml(message)}`
      : escapeHtml(message);
    status.style.display = 'flex';

    if (type !== 'loading') {
      setTimeout(() => {
        status.style.opacity = '0';
        setTimeout(() => {
          status.style.display = 'none';
          status.style.opacity = '1';
        }, 250);
      }, 3500);
    }
  },

  setButtonDisabled(buttonId, disabled) {
    const button = document.getElementById(buttonId);
    if (button) button.disabled = !!disabled;
  },

  clearResults() {
    if (this.elements.resultsDiv) {
      this.elements.resultsDiv.innerHTML = '';
    }
  },

  switchTab(tabName) {
    this.elements.tabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    this.elements.sections.forEach((section) => {
      section.classList.toggle('active', section.id === `view-${tabName}`);
    });

    // Animate tab indicator
    const indicator = document.getElementById('tab-indicator');
    if (indicator) {
      indicator.classList.toggle('tab-binder', tabName === 'binder');
    }
  },

  toggleViewSection(sectionId) {
    this.elements.sections.forEach((section) => {
      section.classList.toggle('active', section.id === sectionId);
    });
  },

  // ===== ONBOARDING LOGIC (REVAMPED) =====

  setSetupVisible(visible) {
    if (this.elements.onboardingView) {
      this.elements.onboardingView.classList.toggle('hidden', !visible);
    }
  },

  /**
   * Show a specific onboarding slide (0=welcome, 1=groq, 2=serper, 3=gemini)
   * Uses CSS translateX on the slides container.
   */
  showSetupStep(stepNumber) {
    this._currentSlide = stepNumber;

    if (this.elements.onboardingSlides) {
      const translate = stepNumber * -100;
      this.elements.onboardingSlides.style.transform = `translateX(${translate}%)`;
    }

    // Glow effect only on welcome slide
    if (this.elements.onboardingView) {
      this.elements.onboardingView.classList.toggle('ob-glow-active', stepNumber === 0);
    }

    this.updateProgressBar(stepNumber);
    this.updateStepDots(stepNumber);
    this.syncTutorialCard(stepNumber);
  },

  updateProgressBar(stepNumber) {
    // 0 -> 10%, 1 -> 30%, 2 -> 50%, 3 -> 75%, 4 -> 100%
    const percents = [10, 25, 40, 55, 70, 85, 100];
    const percent = percents[stepNumber] ?? 10;

    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = `${percent}%`;
    }
    if (this.elements.progressGlow) {
      this.elements.progressGlow.style.left = `${Math.max(0, percent - 5)}%`;
    }
  },

  updateStepDots(currentStep) {
    if (!this.elements.stepDots) return;
    const dots = this.elements.stepDots.querySelectorAll('.ob-dot');
    dots.forEach((dot, index) => {
      dot.classList.remove('active', 'done');
      if (index === currentStep) {
        dot.classList.add('active');
      } else if (index < currentStep) {
        dot.classList.add('done');
      }
    });
  },

  syncTutorialCard(currentStep) {
    const cards = document.querySelectorAll('.ob-tutorial-card');
    cards.forEach((card) => {
      const body = card.querySelector('.ob-tutorial-body');
      if (!body) return;
      body.hidden = true;
      card.classList.remove('expanded');
    });

    const activeSlide = document.querySelector(`.ob-slide[data-slide="${currentStep}"]`);
    const activeCard = activeSlide?.querySelector('.ob-tutorial-card');
    if (!activeCard) return;

    const activeBody = activeCard.querySelector('.ob-tutorial-body');
    if (!activeBody) return;
    activeBody.hidden = false;
    activeCard.classList.add('expanded');
  },

  // Backwards compatibility shim for Controller
  updateStepper(currentStep, completedSteps) {
    // No-op or map to progress bar
  },

  showWelcomeOverlay() {
    this.setSetupVisible(true);
    this.showSetupStep(0);
  },

  hideWelcomeOverlay() {
    // handled by switching step
  },

  showToast(message, type = '', duration = 3200) {
    const container = this.elements.toastContainer;
    if (!container) return;

    const iconByType = {
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      info: 'info'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="material-symbols-rounded" style="font-size:18px;">${iconByType[type] || 'info'}</span>
      <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.28s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  setTestButtonLoading(provider, state) {
    const button = document.getElementById(`test-${provider}`);
    if (!button) return;

    button.classList.remove('testing', 'test-ok', 'test-fail');
    button.disabled = false;

    if (state === 'loading') {
      button.classList.add('testing');
      button.disabled = true;
      button.innerHTML = `<span class="material-symbols-rounded spin-loading">sync</span> ${escapeHtml(this.t('setup.test.short'))}`;
      return;
    }

    if (state === 'ok') {
      button.classList.add('test-ok');
      button.innerHTML = `<span class="material-symbols-rounded">check_circle</span> ${escapeHtml(this.t('setup.test.success'))}`;
      this.enableNextButton(provider);
      return;
    }

    if (state === 'fail') {
      button.classList.add('test-fail');
      button.innerHTML = `<span class="material-symbols-rounded">error</span> ${escapeHtml(this.t('setup.test.failed'))}`;
      return;
    }

    // Reset
    button.innerHTML = `<span class="material-symbols-rounded">wifi_tethering</span> ${escapeHtml(this.t('setup.validateAction'))}`;
  },

  enableNextButton(provider) {
    const btnId = `btn-next-${provider}`;
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = false;
      btn.classList.add('pulse-next');
    }
  },

  disableNextButton(provider) {
    const btnId = `btn-next-${provider}`;
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = true;
      btn.classList.remove('pulse-next');
    }
  },

  setSetupStatus(provider, text, type = '') {
    const status = this.elements[`status${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
    if (!status) return;

    status.className = `ob-test-status ${type}`;
    status.textContent = text;
  },

  setupVisibilityToggle(button) {
    if (!button || button.dataset.visibilityBound === '1') return;
    button.dataset.visibilityBound = '1';

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const targetId = button.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';

      const icon = button.querySelector('.material-symbols-rounded');
      if (icon) {
        icon.textContent = isPassword ? 'visibility_off' : 'visibility';
      }
    });
  },

  showPasteNotification(input) {
    if (!input) return;
    input.classList.add('just-pasted');
    setTimeout(() => input.classList.remove('just-pasted'), 700);
  },

  updateKeyFormatHint(provider, value, expectedPrefix) {
    const hintEl = document.getElementById(`hint-${provider}`);
    if (!hintEl) return;

    const trimmed = (value || '').trim();
    hintEl.classList.remove('valid', 'error');

    const icon = hintEl.querySelector('.material-symbols-rounded');
    if (!trimmed) {
      if (icon) icon.textContent = 'info';
      hintEl.style.color = '';
      return;
    }

    if (expectedPrefix && trimmed.length > 5) {
      if (trimmed.startsWith(expectedPrefix)) {
        hintEl.classList.add('valid');
        if (icon) icon.textContent = 'check_circle';
      } else {
        hintEl.classList.add('error');
        if (icon) icon.textContent = 'error';
      }
    } else if (trimmed.length > 10) {
      // No strict prefix (serper)
      hintEl.classList.add('valid');
      if (icon) icon.textContent = 'check_circle';
    }
  },

  setSettingsAttention(active) {
    if (this.elements.settingsBtn) {
      this.elements.settingsBtn.classList.toggle('attention', !!active);
    }
  },

  /**
   * Show key status chip (configured / missing) for a provider.
   * Used when reopening settings.
   */
  showKeyStatus(provider, isConfigured) {
    const statusEl = this.elements[`keyStatus${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
    if (!statusEl) return;
    statusEl.classList.remove('hidden', 'configured', 'missing');
    const iconEl = statusEl.querySelector('.ob-key-status-icon');
    const textEl = statusEl.querySelector('.ob-key-status-text');
    if (isConfigured) {
      statusEl.classList.add('configured');
      if (iconEl) iconEl.textContent = 'check_circle';
      if (textEl) textEl.textContent = this.t('setup.keyStatus.configured');
    } else {
      statusEl.classList.add('missing');
      if (iconEl) iconEl.textContent = 'warning';
      if (textEl) {
        const missingKey = provider === 'gemini'
          ? 'setup.keyStatus.geminiMissing'
          : 'setup.keyStatus.missing';
        textEl.textContent = this.t(missingKey);
      }
    }
  },

  /** Hide key status chip */
  hideKeyStatus(provider) {
    const statusEl = this.elements[`keyStatus${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
    if (statusEl) statusEl.classList.add('hidden');
  },

  /**
   * Show/hide change-key buttons and close-settings buttons.
   * Used when reopening settings (not first-time setup).
   */
  setSettingsReopenMode(isReopen) {
    if (this.elements.onboardingView) {
      this.elements.onboardingView.classList.toggle('ob-reopen-mode', !!isReopen);
    }

    const providers = ['groq', 'serper', 'gemini', 'openrouter'];
    providers.forEach(p => {
      const cap = p.charAt(0).toUpperCase() + p.slice(1);
      const changeBtn = this.elements[`changeKey${cap}`];
      const closeBtn = this.elements[`closeSettings${cap}`];
      if (changeBtn) changeBtn.classList.toggle('hidden', !isReopen);
      if (closeBtn) closeBtn.classList.toggle('hidden', !isReopen);
    });
    if (this.elements.removeKeyGemini) {
      this.elements.removeKeyGemini.classList.toggle('hidden', !isReopen);
    }
    
    if (this.elements.removeKeyOpenrouter) {
      this.elements.removeKeyOpenrouter.classList.toggle('hidden', !isReopen);
    }
    if (this.elements.removeKeySerper) {
      this.elements.removeKeySerper.classList.toggle('hidden', !isReopen);
    }
  },

  showAutoAdvance(callback) {
    if (typeof callback === 'function') {
      setTimeout(callback, 500);
    }
  },

  clearAutoAdvance() { },

  showConfetti() {
    const colors = ['#FF6B00', '#FFD700', '#27AE60', '#3498DB', '#E74C3C', '#8B5CF6'];
    for (let i = 0; i < 60; i += 1) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.top = `${-12 + Math.random() * 18}px`;
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animation = `confettiFall ${1.5 + Math.random()}s linear forwards`;
      piece.style.position = 'fixed';
      piece.style.width = `${6 + Math.random() * 6}px`;
      piece.style.height = `${6 + Math.random() * 6}px`;
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      piece.style.zIndex = '3000';
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 2800);
    }

    if (!document.getElementById('confetti-style')) {
      const style = document.createElement('style');
      style.id = 'confetti-style';
      style.textContent = `
        @keyframes confettiFall {
          0% { transform: translateY(0) rotate(0); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  },

  appendResults(results) {
    if (!this.elements.resultsDiv) return;

    const discardedUrlDiagnostics = [];

    const sanitizeUrl = (rawUrl, context = 'unknown') => {
      const value = String(rawUrl || '').trim();
      if (!value) return '';
      try {
        const parsed = new URL(value);
        if (!/^https?:$/i.test(parsed.protocol)) {
          discardedUrlDiagnostics.push({ context, reason: 'invalid-protocol', raw: value.slice(0, 240) });
          return '';
        }
        return parsed.href;
      } catch (_) {
        discardedUrlDiagnostics.push({ context, reason: 'invalid-url', raw: value.slice(0, 240) });
        return '';
      }
    };

    const sanitizeInjectedMarkup = (markup) => String(markup || '')
      // Defensive cleanup: prevent accidental active content if any dynamic field bypasses escaping.
      .replace(/<\s*script\b[\s\S]*?(?:<\/\s*script\s*>|$)/gi, ' ')
      .replace(/<\s*iframe\b[\s\S]*?(?:<\/\s*iframe\s*>|$)/gi, ' ')
      .replace(/<\s*object\b[\s\S]*?(?:<\/\s*object\s*>|$)/gi, ' ')
      .replace(/<\s*embed\b[^>]*>?/gi, ' ')
      .replace(/<\s*link\b[^>]*>?/gi, ' ');

    const html = results.map((item, index) => {
      const isSaved = Boolean(item.saved);
      const saveIcon = isSaved ? 'bookmark' : 'bookmark_border';
      const saveClass = isSaved ? 'saved' : '';
      const iconClass = isSaved ? 'filled' : '';
      const dataContent = encodeURIComponent(JSON.stringify(item));

      const answerLetter = item.answerLetter || item.bestLetter ||
        (item.answer?.match(/\b(?:letter|letra|alternativa)\s*([A-E])\b/i)?.[1]?.toUpperCase()) || null;

      const answerBody = (item.answerText || item.answer || '')
        .replace(/^(?:Letter|Letra|Alternativa)\s*[A-E]\s*[:.\-]?\s*/i, '')
        .replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '')
        .trim();

      const confidence = Number.isFinite(item.confidence) ? Math.round(item.confidence * 100) : null;

      const resultState = item.resultState || 'inconclusive';
      const reasonKey = item.reason === 'confirmed_by_sources'
        ? 'result.reason.confirmed'
        : item.reason === 'source_conflict'
          ? 'result.reason.conflict'
          : (item.reason === 'ai_combined_suggestion' || item.reason === 'ai_knowledge')
            ? 'result.reason.suggested'
            : 'result.reason.inconclusive';

      // Only show vote pills when 2+ alternatives were scored (AI-only fallback has just one)
      const votesEntries = item.votes ? Object.entries(item.votes) : [];
      const showVotes = votesEntries.length >= 2;
      const aiOverviewStatusText = item.googleMetaSignals
        ? this.t('result.meta.aiOverview', {
          status: this.t(item.googleMetaSignals.aiOverview ? 'result.meta.captured' : 'result.meta.absent')
        })
        : '';
      const providerText = item.googleMetaSignals?.provider
        ? ` (${escapeHtml(this.t(item.googleMetaSignals.provider === 'serpapi' ? 'provider.serpapi' : 'provider.serper'))})`
        : '';
      const overviewSummary = typeof item.overview?.summary === 'string' ? item.overview.summary.trim() : '';
      const overviewPoints = Array.isArray(item.overview?.keyPoints)
        ? item.overview.keyPoints.map((point) => String(point || '').trim()).filter(Boolean)
        : [];
      const overviewReferences = Array.isArray(item.overview?.references)
        ? item.overview.references
          .map((ref) => ({
            title: String(ref?.title || '').trim(),
            link: String(ref?.link || '').trim()
          }))
          .filter((ref) => ref.title || ref.link)
        : [];

      return `
        <div class="qa-card" style="animation-delay:${index * 0.07}s;">
          <div class="qa-card-header">
            <span class="material-symbols-rounded question-icon">help</span>
            <span class="qa-card-title">${escapeHtml(item.title || this.t('result.title'))}</span>
            <button class="action-btn save-btn ${saveClass}" data-content="${dataContent}" title="${escapeHtml(this.t('result.save'))}">
              <span class="material-symbols-rounded ${iconClass}">${saveIcon}</span>
            </button>
          </div>

          <div class="qa-card-question">${formatQuestionText(item.question)}</div>

          <div class="qa-card-ai-warning">
            <span class="material-symbols-rounded">info</span>
            <span>${escapeHtml(this.t('result.aiWarning'))}</span>
          </div>

          <div class="qa-card-answer">
            <div class="qa-card-answer-header ${item.userOverride ? 'override-answer' : resultState === 'conflict' ? 'conflict-answer' : resultState === 'suggested' || item.aiFallback ? (item.aiFallback ? 'ai-suggestion' : 'suggested-answer') : ''}">
              <span class="material-symbols-rounded answer-state-icon">${(() => {
          if (item.userOverride) return 'person';
          if (resultState === 'confirmed') return 'check_circle';
          if (resultState === 'conflict') return 'warning';
          if (resultState === 'suggested') return 'lightbulb';
          if (item.aiFallback) return 'smart_toy';
          return 'info';
        })()}</span>
              <span class="answer-header-title">${escapeHtml((() => {
          if (item.userOverride) return this.t('result.override.applied');
          if (resultState === 'confirmed') return this.t('result.verifiedAnswer');
          if (resultState === 'conflict') return this.t('result.inconclusiveAnswer');
          if (resultState === 'suggested') return this.t('result.suggestedAnswer');
          if (item.aiFallback) return this.t('result.aiSuggestion');
          return this.t('result.correctAnswer');
        })())}</span>
              ${confidence !== null ? `
              <div class="confidence-pill" style="--conf-color: ${confidence >= 80 ? '#27AE60' : confidence >= 60 ? '#F39C12' : confidence >= 40 ? '#E67E22' : '#E74C3C'}">
                <svg class="confidence-ring" viewBox="0 0 36 36">
                  <circle class="confidence-ring-bg" cx="18" cy="18" r="15.9" />
                  <circle class="confidence-ring-fill" cx="18" cy="18" r="15.9" style="stroke: var(--conf-color); stroke-dasharray: ${confidence}, 100;" />
                </svg>
                <span class="confidence-value">${confidence}</span>
                <span class="confidence-tooltip">${escapeHtml(this.t('result.confidenceTooltip', { value: confidence }))}</span>
              </div>` : ''}
            </div>

            <div class="result-detail-strip">
              <span class="result-detail-reason">${escapeHtml(this.t(reasonKey))}</span>
              ${aiOverviewStatusText ? `<span class="result-detail-reason">${escapeHtml(aiOverviewStatusText)}${providerText}</span>` : ''}
              ${showVotes ? `<div class="result-votes-inline">
                <span class="votes-label-tooltip">
                  <span class="material-symbols-rounded votes-label-icon">help_outline</span>
                  <span class="votes-tooltip-text">${escapeHtml(this.t('result.votesTooltip'))}</span>
                </span>
                ${votesEntries.map(([letter, score]) => {
          const isTop = votesEntries.every(([, s]) => score >= s);
          return `<span class="vote-pill ${isTop ? 'vote-top' : ''}" title="${escapeHtml(this.t('result.voteScoreTooltip', { letter, score: typeof score === 'number' ? score.toFixed(1) : score }))}"><span class="vote-letter">${escapeHtml(letter)}</span><span class="vote-score">${typeof score === 'number' ? score.toFixed(1) : score}</span></span>`;
        }).join('')}
              </div>` : ''}
            </div>

            ${answerLetter
          ? `<div class="answer-option"><div class="alternative answer-alternative"><span class="alt-letter">${escapeHtml(answerLetter)}</span><span class="alt-text">${escapeHtml(answerBody)}</span></div></div>`
          : `<div class="qa-card-answer-text">${escapeHtml(answerBody)}</div>`}

            ${item.aiReasoning ? `
            <details class="answer-reasoning">
              <summary class="answer-reasoning-toggle">
                <span class="material-symbols-rounded">psychology</span>
                <span>${escapeHtml(this.t('result.aiReasoning'))}</span>
                <span class="material-symbols-rounded answer-reasoning-caret">expand_more</span>
              </summary>
              <div class="answer-reasoning-body">${escapeHtml(item.aiReasoning)}</div>
            </details>` : ''}

            ${item.optionsMap && Object.keys(item.optionsMap).length >= 2 ? `
            <div class="answer-override-section">
              <button class="answer-override-trigger" type="button" title="${escapeHtml(this.t('result.override.tooltip'))}">
                <span class="material-symbols-rounded">edit</span>
                <span>${escapeHtml(this.t('result.override.btn'))}</span>
              </button>
              <div class="answer-override-pills" hidden>
                <span class="override-label">${escapeHtml(this.t('result.override.pick'))}</span>
                <div class="override-options">
                  ${Object.entries(item.optionsMap).sort(([a], [b]) => a.localeCompare(b)).map(([letter, body]) =>
            `<button class="override-pill ${letter === answerLetter ? 'override-current' : ''}" data-letter="${escapeHtml(letter)}" data-body="${encodeURIComponent(body)}" title="${escapeHtml(body.slice(0, 100))}" type="button"><span class="override-pill-letter">${escapeHtml(letter)}</span><span class="override-pill-body">${escapeHtml(body.length > 50 ? body.slice(0, 47) + '...' : body)}</span></button>`
          ).join('')}
                </div>
                <button class="override-cancel" type="button">${escapeHtml(this.t('result.override.cancel'))}</button>
              </div>
            </div>` : ''}

            <div class="study-actions-container">
              <button class="study-action-btn btn-tutor" type="button" data-question="${encodeURIComponent(item.question)}" data-answer="${encodeURIComponent(item.answer || '')}" data-context="${encodeURIComponent(overviewSummary || Object.values(item.optionsMap || {}).join(' '))}" title="${escapeHtml(this.t('result.tutor.title'))}">
                <span class="material-symbols-rounded">school</span>
                <span>${escapeHtml(this.t('result.tutor.btn'))}</span>
              </button>
              <button class="study-action-btn btn-similar" type="button" data-question="${encodeURIComponent(item.question)}" title="${escapeHtml(this.t('result.similar.title'))}">
                <span class="material-symbols-rounded">quiz</span>
                <span>${escapeHtml(this.t('result.similar.btn'))}</span>
              </button>
              <button class="study-action-btn btn-chat" type="button" data-question="${encodeURIComponent(item.question)}" data-answer="${encodeURIComponent(item.answer || '')}" data-context="${encodeURIComponent(overviewSummary || Object.values(item.optionsMap || {}).join(' '))}" title="${escapeHtml(this.t('result.chat.title') || 'Follow-up Chat')}">
                <span class="material-symbols-rounded">forum</span>
                <span>${escapeHtml(this.t('result.chat.btn') || 'Dúvidas')}</span>
              </button>
            </div>
            <div class="study-feature-output hidden"></div>

            ${overviewSummary
          ? `<div class="qa-card-answer-text"><strong>${escapeHtml(this.t('result.overview.title'))}</strong><br>${escapeHtml(overviewSummary)}</div>`
          : ''}
            ${overviewPoints.length > 0
          ? `<div class="qa-card-answer-text"><strong>${escapeHtml(this.t('result.overview.points'))}</strong><br>${overviewPoints.map((point) => `• ${escapeHtml(point)}`).join('<br>')}</div>`
          : ''}
            ${overviewReferences.length > 0
          ? `<div class="qa-card-answer-text"><strong>${escapeHtml(this.t('result.overview.references'))}</strong><br>${overviewReferences.map((ref) => {
            const label = escapeHtml(ref.title || ref.link);
            const safeRefLink = sanitizeUrl(ref.link, 'overview-reference');
            return safeRefLink
              ? `<a href="${escapeHtml(safeRefLink)}" target="_blank" rel="noopener noreferrer">${label}</a>`
              : `<span>${label}</span>`;
          }).join('<br>')}</div>`
          : ''}
          </div>

          <div class="qa-card-actions">
            ${Array.isArray(item.sources) && item.sources.length > 0
          ? `<div class="sources-box">
                  <button class="sources-toggle" type="button" aria-expanded="false">
                    <span class="material-symbols-rounded">link</span>
                    <span>${escapeHtml(this.t('result.sources', { count: item.sources.length }))}</span>
                    <span class="material-symbols-rounded sources-caret">expand_more</span>
                  </button>
                  <div class="sources-list" hidden>
                    ${item.sources.map((source) => {
            let host = source.title || source.link || '';
            const safeSourceLink = sanitizeUrl(source.link, 'source-link');
            try {
              if (safeSourceLink) host = new URL(safeSourceLink).hostname;
            } catch (_) {
              // no-op
            }
            return `<div class="source-item">${safeSourceLink
              ? `<a href="${escapeHtml(safeSourceLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)}</a>`
              : `<span>${escapeHtml(host)}</span>`
              }</div>`;
          }).join('')}
                  </div>
                </div>`
          : `<div class="source muted">${escapeHtml(this.t('result.source'))}: AI</div>`}
          </div>
        </div>
      `;
    }).join('');

    this.elements.resultsDiv.innerHTML = sanitizeInjectedMarkup(html);
    this.elements.resultsDiv
      .querySelectorAll('script, iframe, object, embed, link[rel="preload"][as="script"], link[rel="modulepreload"]')
      .forEach((el) => el.remove());

    if (discardedUrlDiagnostics.length > 0) {
      const compact = discardedUrlDiagnostics
        .slice(0, 6)
        .map((d) => `[${d.context}] ${d.reason}: ${d.raw}`)
        .join(' | ');
      console.warn(`AnswerHunter: Sanitizer discarded ${discardedUrlDiagnostics.length} URL(s): ${compact}`);
    }
  },

  getAllResultsText() {
    let text = '';
    const cards = this.elements.resultsDiv?.querySelectorAll('.qa-card') || [];

    cards.forEach((card, index) => {
      const question = card.querySelector('.qa-card-question')?.innerText?.trim() || '';

      let answer = '';
      const answerText = card.querySelector('.qa-card-answer-text')?.innerText?.trim();
      if (answerText) {
        answer = answerText;
      } else {
        const letter = card.querySelector('.answer-alternative .alt-letter')?.innerText?.trim() || '';
        const body = card.querySelector('.answer-alternative .alt-text')?.innerText?.trim() || '';
        answer = [letter, body].filter(Boolean).join(' - ');
      }

      text += `Q${index + 1}: ${question}\nA: ${answer}\n\n`;
    });

    return text;
  },

  setSaveButtonState(button, saved) {
    const icon = button.querySelector('.material-symbols-rounded');
    button.classList.toggle('saved', !!saved);
    if (icon) {
      icon.textContent = saved ? 'bookmark' : 'bookmark_border';
      icon.classList.toggle('filled', !!saved);
    }
  },

  resetAllSaveButtons() {
    document.querySelectorAll('.save-btn').forEach((button) => this.setSaveButtonState(button, false));
  },

  renderBinderList(folder, options = {}) {
    if (!this.elements.binderList) return;
    const { showBackupReminder = false, isStudyMode = false } = options;

    const sanitizeUrl = (rawUrl) => {
      const value = String(rawUrl || '').trim();
      if (!value) return '';
      try {
        const parsed = new URL(value);
        return /^https?:$/i.test(parsed.protocol) ? parsed.href : '';
      } catch (_) {
        return '';
      }
    };

    const sanitizeInjectedMarkup = (markup) => String(markup || '')
      .replace(/<\s*script\b[\s\S]*?(?:<\/\s*script\s*>|$)/gi, ' ')
      .replace(/<\s*iframe\b[\s\S]*?(?:<\/\s*iframe\s*>|$)/gi, ' ')
      .replace(/<\s*object\b[\s\S]*?(?:<\/\s*object\s*>|$)/gi, ' ')
      .replace(/<\s*embed\b[^>]*>?/gi, ' ')
      .replace(/<\s*link\b[^>]*>?/gi, ' ');

    const reminderHtml = showBackupReminder
      ? `<div class="backup-reminder"><span class="material-symbols-rounded">backup</span><span>${escapeHtml(this.t('binder.backupReminder'))}</span><button class="dismiss-reminder" title="${escapeHtml(this.t('binder.backupDismiss'))}"><span class="material-symbols-rounded" style="font-size:16px;">close</span></button></div>`
      : '';

    let html = `
      ${reminderHtml}
      <div class="binder-toolbar">
        <span class="crumb-current"><span class="material-symbols-rounded" style="font-size:18px;">folder_open</span> ${folder.id === 'root' ? escapeHtml(this.t('binder.title')) : escapeHtml(folder.title)}</span>
        <div class="toolbar-actions">
          ${folder.id !== 'root' ? `<button id="btnBackRoot" class="toolbar-icon-btn" title="${escapeHtml(this.t('binder.back'))}"><span class="material-symbols-rounded" style="font-size:18px;">arrow_back</span></button>` : ''}
          <button id="btnStudyMode" class="toolbar-icon-btn ${isStudyMode ? 'active-study-mode' : ''}" title="${escapeHtml(this.t('binder.studyMode.toggle') || 'Study Mode')}"><span class="material-symbols-rounded" style="font-size:18px;">${isStudyMode ? 'school' : 'menu_book'}</span></button>
          <button id="newFolderBtnBinder" class="toolbar-icon-btn" title="${escapeHtml(this.t('binder.newFolder'))}"><span class="material-symbols-rounded" style="font-size:18px;">create_new_folder</span></button>
          <button id="exportBinderBtn" class="toolbar-icon-btn" title="Export"><span class="material-symbols-rounded" style="font-size:18px;">download</span></button>
          <button id="importBinderBtn" class="toolbar-icon-btn" title="Import"><span class="material-symbols-rounded" style="font-size:18px;">upload</span></button>
        </div>
      </div>
      <div class="binder-content">
    `;

    if (!Array.isArray(folder.children) || folder.children.length === 0) {
      html += `<div class="placeholder"><p>${escapeHtml(this.t('binder.emptyFolder'))}</p></div>`;
    } else {
      folder.children.forEach((item) => {
        if (item.type === 'folder') {
          html += `
            <div class="folder-item drop-zone" draggable="true" data-id="${item.id}" data-type="folder">
              <div class="folder-info">
                <span class="material-symbols-rounded folder-icon">folder</span>
                <span class="folder-name">${escapeHtml(item.title)}</span>
              </div>
              <div class="folder-actions">
                <button class="action-btn rename-btn" data-id="${item.id}" title="${escapeHtml(this.t('binder.rename'))}"><span class="material-symbols-rounded" style="font-size:18px;">edit</span></button>
                <button class="action-btn delete-btn" data-id="${item.id}" title="${escapeHtml(this.t('binder.delete'))}"><span class="material-symbols-rounded" style="font-size:18px;">delete</span></button>
              </div>
            </div>
          `;
          return;
        }

        const questionText = item.content?.question || '';
        const preview = questionText.length > 60 ? `${questionText.slice(0, 60)}...` : questionText;
        const answerRaw = item.content?.answer || '';
        const answerLetter = answerRaw.match(/\b(?:letter|letra|alternativa)\s*([A-E])\b/i)?.[1]?.toUpperCase() || null;
        const answerBody = answerRaw
          .replace(/^(?:Letter|Letra|Alternativa)\s*[A-E]\s*[:.\-]?\s*/i, '')
          .replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '')
          .trim();

        const safeSourceLink = sanitizeUrl(item.content?.source);
        let host = '';
        if (safeSourceLink) {
          host = safeSourceLink;
          try {
            host = new URL(safeSourceLink).hostname;
          } catch (_) {
            // no-op
          }
        }

        html += `
          <div class="qa-item expandable" draggable="true" data-id="${item.id}" data-type="question">
            <div class="summary-view">
              <div class="summary-icon"><span class="material-symbols-rounded">quiz</span></div>
              <div class="summary-content"><div class="summary-title">${escapeHtml(preview)}</div></div>
              <span class="material-symbols-rounded expand-indicator">expand_more</span>
            </div>

            <div class="full-view" style="display:none;">
              <div class="qa-card">
                <div class="qa-card-header">
                  <span class="material-symbols-rounded question-icon">help</span>
                  <span class="qa-card-title">${escapeHtml(this.t('binder.savedQuestion'))}</span>
                </div>

                <div class="qa-card-question">${formatQuestionText(questionText)}</div>

                ${isStudyMode ? `
                <button class="study-reveal-btn" type="button">
                  <span class="material-symbols-rounded">visibility</span>
                  <span>${escapeHtml(this.t('binder.studyMode.reveal') || 'Ver Resposta')}</span>
                </button>
                ` : ''}
                <div class="qa-card-answer ${isStudyMode ? 'study-hidden' : ''}">
                  <div class="qa-card-answer-header ${item.aiFallback ? 'ai-suggestion' : (item.resultState === 'conflict' ? 'conflict-answer' : (item.resultState === 'confirmed' ? '' : 'suggested-answer'))}">
                    <span class="material-symbols-rounded">${item.aiFallback ? 'auto_awesome'
            : item.resultState === 'conflict' ? 'help_outline'
              : item.resultState === 'confirmed' ? 'check_circle'
                : 'lightbulb'
          }</span>
                    ${escapeHtml(
            item.aiFallback ? (this.t('result.aiSuggestion') || 'AI Suggestion')
              : item.resultState === 'conflict' ? (this.t('result.inconclusive') || 'Inconclusive')
                : item.resultState === 'confirmed' ? this.t('result.correctAnswer')
                  : (this.t('result.suggestedAnswer') || 'Suggested Answer')
          )}
                  </div>
                  ${answerLetter
            ? `<div class="answer-option"><div class="alternative answer-alternative"><span class="alt-letter">${escapeHtml(answerLetter)}</span><span class="alt-text">${escapeHtml(answerBody)}</span></div></div>`
            : `<div class="qa-card-answer-text">${escapeHtml(answerBody)}</div>`}
                </div>

                <div class="study-actions-container">
                  <button class="study-action-btn btn-tutor" type="button" data-question="${encodeURIComponent(questionText)}" data-answer="${encodeURIComponent(answerRaw || '')}" data-context="${encodeURIComponent(item.content?.overview?.summary || '')}" title="${escapeHtml(this.t('result.tutor.title') || 'Tutor')}">
                    <span class="material-symbols-rounded">school</span>
                    <span>${escapeHtml(this.t('result.tutor.btn') || 'Tutor')}</span>
                  </button>
                  <button class="study-action-btn btn-similar" type="button" data-question="${encodeURIComponent(questionText)}" title="${escapeHtml(this.t('result.similar.title') || 'Similar Question')}">
                    <span class="material-symbols-rounded">quiz</span>
                    <span>${escapeHtml(this.t('result.similar.btn') || 'Similar')}</span>
                  </button>
                  <button class="study-action-btn btn-chat" type="button" data-question="${encodeURIComponent(questionText)}" data-answer="${encodeURIComponent(answerRaw || '')}" data-context="${encodeURIComponent(item.content?.overview?.summary || '')}" title="${escapeHtml(this.t('result.chat.title') || 'Follow-up Chat')}">
                    <span class="material-symbols-rounded">forum</span>
                    <span>${escapeHtml(this.t('result.chat.btn') || 'Dúvidas')}</span>
                  </button>
                </div>
                <div class="study-feature-output hidden"></div>

                <div class="qa-card-actions">
                  ${safeSourceLink ? `<div class="sources-box"><button class="sources-toggle" type="button" aria-expanded="false"><span class="material-symbols-rounded">link</span><span>${escapeHtml(this.t('result.source'))}</span><span class="material-symbols-rounded sources-caret">expand_more</span></button><div class="sources-list" hidden><div class="source-item"><a href="${escapeHtml(safeSourceLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)}</a></div></div></div>` : ''}
                  <div class="binder-actions">
                    <button class="action-btn copy-single-btn" data-id="${item.id}" title="${escapeHtml(this.t('binder.copy'))}"><span class="material-symbols-rounded">content_copy</span></button>
                    <button class="action-btn delete-btn" data-id="${item.id}" title="${escapeHtml(this.t('binder.delete'))}"><span class="material-symbols-rounded">delete</span></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      });
    }

    html += '</div>';
    this.elements.binderList.innerHTML = sanitizeInjectedMarkup(html);
    this.elements.binderList
      .querySelectorAll('script, iframe, object, embed, link[rel="preload"][as="script"], link[rel="modulepreload"]')
      .forEach((el) => el.remove());
  }
};
