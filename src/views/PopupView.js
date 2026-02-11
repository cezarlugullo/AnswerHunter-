import { formatQuestionText, escapeHtml } from '../utils/helpers.js';

export const PopupView = {
  elements: {},
  _translator: (key) => key,
  _currentSlide: 0,

  init() {
    this.cacheElements();
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

      // New Onboarding Elements
      onboardingView: document.getElementById('onboarding-view'),
      onboardingSlides: document.getElementById('onboarding-slides'),
      progressBar: document.getElementById('onboarding-progress-bar'),

      // Buttons
      welcomeStartBtn: document.getElementById('welcomeStartBtn'),

      btnNextGroq: document.getElementById('btn-next-groq'),
      btnNextSerper: document.getElementById('btn-next-serper'),
      saveSetupBtn: document.getElementById('saveSetupBtn'),
      setupSkipBtn: document.getElementById('setupSkipBtn'),

      prevGroq: document.getElementById('prev-groq'),
      prevSerper: document.getElementById('prev-serper'),
      prevGemini: document.getElementById('prev-gemini'),

      // Inputs
      inputGroq: document.getElementById('input-groq'),
      inputSerper: document.getElementById('input-serper'),
      inputGemini: document.getElementById('input-gemini'),

      // Tests
      testGroq: document.getElementById('test-groq'),
      testSerper: document.getElementById('test-serper'),
      testGemini: document.getElementById('test-gemini'),

      // Status
      statusGroq: document.getElementById('status-groq'),
      statusSerper: document.getElementById('status-serper'),
      statusGemini: document.getElementById('status-gemini')
    };
  },

  setLanguageSelectValue(language) {
    if (this.elements.languageToggle) {
      this.elements.languageToggle.querySelectorAll('.lang-btn').forEach(btn => {
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
  },

  toggleViewSection(sectionId) {
    this.elements.sections.forEach((section) => {
      section.classList.toggle('active', section.id === sectionId);
    });
  },

  // ===== NEW ONBOARDING LOGIC =====

  setSetupVisible(visible) {
    if (this.elements.onboardingView) {
      this.elements.onboardingView.classList.toggle('hidden', !visible);
    }
  },

  // Step 0: Welcome, 1: Groq, 2: Serper, 3: Gemini
  showSetupStep(stepNumber) {
    this._currentSlide = stepNumber;

    if (this.elements.onboardingSlides) {
      // 4 slides total (0, 1, 2, 3). Each is 25% of the 400% width container.
      // Translate -25% moves one slide.
      const translate = stepNumber * -25;
      this.elements.onboardingSlides.style.transform = `translateX(${translate}%)`;
    }

    this.updateProgressBar(stepNumber);
  },

  updateProgressBar(stepNumber) {
    if (!this.elements.progressBar) return;
    // 0 -> 10%, 1 -> 40%, 2 -> 70%, 3 -> 100%
    let percent = 10;
    if (stepNumber === 1) percent = 40;
    if (stepNumber === 2) percent = 70;
    if (stepNumber === 3) percent = 100;

    this.elements.progressBar.style.width = `${percent}%`;
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
    const button = document.getElementById(`test-${provider}`); // updated ID
    if (!button) return;

    const icon = button.querySelector('.material-symbols-rounded'); // might not have one in "Testing" state for modern btn

    button.classList.remove('testing', 'test-ok', 'test-fail');
    button.disabled = false;
    button.innerHTML = icon ? '' : button.innerHTML; // Clear content if needed

    if (state === 'loading') {
      button.classList.add('testing');
      button.disabled = true;
      button.innerHTML = `<span class="material-symbols-rounded spin-loading">sync</span> Testing...`;
      return;
    }

    if (state === 'ok') {
      button.classList.add('test-ok');
      button.innerHTML = `<span class="material-symbols-rounded">check</span> Success`;
      // Enable Next button for this provider
      this.enableNextButton(provider);
      return;
    }

    if (state === 'fail') {
      button.classList.add('test-fail');
      button.innerHTML = `<span class="material-symbols-rounded">error</span> Failed`;
      return;
    }

    // Reset
    button.innerHTML = `<span data-i18n="setup.test">Test Key</span>`;
  },

  enableNextButton(provider) {
    const btnId = `btn-next-${provider}`;
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = false;
      btn.classList.add('pulse-next'); // add animation
    }
  },

  setSetupStatus(provider, text, type = '') {
    const status = this.elements[`status${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
    if (!status) return;

    status.className = `step-status ${type}`;
    status.textContent = text;
  },

  setupVisibilityToggle(button) {
    button.addEventListener('click', () => {
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
    const wrapper = input.closest('.input-group');
    if (!wrapper) return;

    // Add glow animation to input
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
      hintEl.style.color = '#999';
      return;
    }

    if (expectedPrefix && trimmed.length > 5) {
      if (trimmed.startsWith(expectedPrefix)) {
        hintEl.classList.add('valid');
        if (icon) icon.textContent = 'check_circle';
        hintEl.style.color = '#4CAF50';
      } else {
        hintEl.classList.add('error');
        if (icon) icon.textContent = 'error';
        hintEl.style.color = '#F44336';
      }
    } else if (trimmed.length > 10) {
      // No strict prefix (serper)
      hintEl.classList.add('valid');
      if (icon) icon.textContent = 'check_circle';
      hintEl.style.color = '#4CAF50';
    }
  },

  setSettingsAttention(active) {
    if (this.elements.settingsBtn) {
      this.elements.settingsBtn.classList.toggle('attention', !!active);
    }
  },

  showAutoAdvance(callback) {
    if (typeof callback === 'function') {
      setTimeout(callback, 500);
    }
  },

  clearAutoAdvance() { },

  showConfetti() {
    const colors = ['#FF6B00', '#FFD700', '#27AE60', '#3498DB', '#E74C3C'];
    for (let i = 0; i < 50; i += 1) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.top = `${-12 + Math.random() * 18}px`;
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animation = `confettiFall ${1.5 + Math.random()}s linear forwards`;
      piece.style.position = 'fixed';
      piece.style.width = '8px';
      piece.style.height = '8px';
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
      let confidenceHtml = '';
      if (confidence !== null) {
        let bg = '#E74C3C';
        if (confidence >= 80) bg = '#27AE60';
        else if (confidence >= 60) bg = '#F39C12';
        else if (confidence >= 40) bg = '#E67E22';
        confidenceHtml = `<div class="confidence-circle" style="background:${bg}">${confidence}</div>`;
      }

      const resultState = item.resultState || 'inconclusive';
      const reasonKey = item.reason === 'confirmed_by_sources'
        ? 'result.reason.confirmed'
        : item.reason === 'source_conflict'
          ? 'result.reason.conflict'
          : 'result.reason.inconclusive';

      const votesText = item.votes
        ? Object.entries(item.votes).map(([letter, score]) => `${letter}: ${score}`).join(' | ')
        : '';

      return `
        <div class="qa-card" style="animation-delay:${index * 0.07}s;">
          <div class="qa-card-header">
            <span class="material-symbols-rounded question-icon">help</span>
            <span class="qa-card-title">${escapeHtml(item.title || this.t('result.title'))}</span>
            ${confidenceHtml}
            <button class="action-btn save-btn ${saveClass}" data-content="${dataContent}" title="${escapeHtml(this.t('result.save'))}">
              <span class="material-symbols-rounded ${iconClass}">${saveIcon}</span>
            </button>
          </div>

          <div class="result-meta">
            <span class="result-badge ${escapeHtml(resultState)}">${escapeHtml(this.t(`result.state.${resultState}`))}</span>
            <span class="result-reason">${escapeHtml(this.t(reasonKey))}</span>
            ${votesText ? `<span class="result-votes"><strong>${escapeHtml(this.t('result.votes'))}:</strong> ${escapeHtml(votesText)}</span>` : ''}
          </div>

          <div class="qa-card-question">${formatQuestionText(item.question)}</div>

          <div class="qa-card-answer">
            <div class="qa-card-answer-header">
              <span class="material-symbols-rounded">${(() => {
          if (resultState === 'confirmed') return 'check_circle';
          if (resultState === 'conflict') return 'warning';
          if (item.aiFallback) return 'smart_toy';
          return 'info';
        })()}</span>
              ${escapeHtml((() => {
          if (resultState === 'confirmed') return this.t('result.verifiedAnswer');
          if (resultState === 'conflict') return this.t('result.inconclusiveAnswer');
          if (item.aiFallback) return this.t('result.aiSuggestion');
          return this.t('result.correctAnswer');
        })())}
            </div>
            ${answerLetter
          ? `<div class="answer-option"><div class="alternative answer-alternative"><span class="alt-letter">${escapeHtml(answerLetter)}</span><span class="alt-text">${escapeHtml(answerBody)}</span></div></div>`
          : `<div class="qa-card-answer-text">${escapeHtml(answerBody)}</div>`}
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
            try {
              if (source.link) host = new URL(source.link).hostname;
            } catch (_) {
              // no-op
            }
            return `<div class="source-item">${source.link
              ? `<a href="${source.link}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)}</a>`
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

    this.elements.resultsDiv.innerHTML = html;
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
    const { showBackupReminder = false } = options;

    const reminderHtml = showBackupReminder
      ? `<div class="backup-reminder"><span class="material-symbols-rounded">backup</span><span>${escapeHtml(this.t('binder.backupReminder'))}</span><button class="dismiss-reminder" title="${escapeHtml(this.t('binder.backupDismiss'))}"><span class="material-symbols-rounded" style="font-size:16px;">close</span></button></div>`
      : '';

    let html = `
      ${reminderHtml}
      <div class="binder-toolbar">
        <span class="crumb-current"><span class="material-symbols-rounded" style="font-size:18px;">folder_open</span> ${folder.id === 'root' ? escapeHtml(this.t('binder.title')) : escapeHtml(folder.title)}</span>
        <div class="toolbar-actions">
          ${folder.id !== 'root' ? `<button id="btnBackRoot" class="toolbar-icon-btn" title="${escapeHtml(this.t('binder.back'))}"><span class="material-symbols-rounded" style="font-size:18px;">arrow_back</span></button>` : ''}
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

        let host = '';
        if (item.content?.source) {
          host = item.content.source;
          try {
            host = new URL(item.content.source).hostname;
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

                <div class="qa-card-answer">
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

                <div class="qa-card-actions">
                  ${item.content?.source ? `<div class="sources-box"><button class="sources-toggle" type="button" aria-expanded="false"><span class="material-symbols-rounded">link</span><span>${escapeHtml(this.t('result.source'))}</span><span class="material-symbols-rounded sources-caret">expand_more</span></button><div class="sources-list" hidden><div class="source-item"><a href="${item.content.source}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)}</a></div></div></div>` : ''}
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
    this.elements.binderList.innerHTML = html;
  }
};
