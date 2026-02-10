import { formatQuestionText, escapeHtml } from '../utils/helpers.js';

export const PopupView = {
  elements: {},

  init() {
    this.cacheElements();
  },

  cacheElements() {
    this.elements = {
      extractBtn: document.getElementById('extractBtn'),
      searchBtn: document.getElementById('searchBtn'),
      copyBtn: document.getElementById('copyBtn'),
      statusDiv: document.getElementById('status'),
      resultsDiv: document.getElementById('results'),
      binderList: document.getElementById('binder-list'),
      clearBinderBtn: document.getElementById('clearBinderBtn'),
      tabs: document.querySelectorAll('.tab-btn'),
      sections: document.querySelectorAll('.view-section'),
      saveBtns: document.querySelectorAll('.save-btn'),
      // Setup wizard elements
      settingsBtn: document.getElementById('settingsBtn'),
      setupPanel: document.getElementById('setup-panel'),
      closeSetupBtn: document.getElementById('closeSetupBtn'),
      saveSetupBtn: document.getElementById('saveSetupBtn'),
      welcomeOverlay: document.getElementById('welcome-overlay'),
      welcomeStartBtn: document.getElementById('welcomeStartBtn'),
      toastContainer: document.getElementById('toast-container'),
      setupBackBtn: document.getElementById('setupBackBtn'),
      setupNextBtn: document.getElementById('setupNextBtn'),
      stepperSteps: document.querySelectorAll('.stepper-step'),
      stepperLines: document.querySelectorAll('.stepper-line'),
      stepPanels: document.querySelectorAll('.setup-step-panel'),
      // Inputs
      inputGroq: document.getElementById('input-groq'),
      inputSerper: document.getElementById('input-serper'),
      inputGemini: document.getElementById('input-gemini'),
      // Test buttons
      testGroq: document.getElementById('test-groq'),
      testSerper: document.getElementById('test-serper'),
      testGemini: document.getElementById('test-gemini'),
      // Status labels
      statusGroq: document.getElementById('status-groq'),
      statusSerper: document.getElementById('status-serper'),
      statusGemini: document.getElementById('status-gemini')
    };
  },

  showStatus(type, message) {
    const el = this.elements.statusDiv;
    if (!el) return;

    el.className = `status ${type}`;
    el.innerHTML = type === 'loading'
      ? `<span class="material-symbols-rounded spin-loading">sync</span> ${message}`
      : message;
    el.style.display = 'flex';

    if (type !== 'loading') {
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => {
          el.style.display = 'none';
          el.style.opacity = '1';
        }, 300);
      }, 4000);
    }
  },

  setButtonDisabled(btnId, disabled) {
    const btn = document.getElementById(btnId);
    if (btn) btn.disabled = disabled;
  },

  clearResults() {
    if (this.elements.resultsDiv) this.elements.resultsDiv.innerHTML = '';
  },

  switchTab(tabName) {
    this.elements.tabs.forEach(t => {
      if (t.dataset.tab === tabName) t.classList.add('active');
      else t.classList.remove('active');
    });

    this.elements.sections.forEach(s => {
      if (s.id === `view-${tabName}`) s.classList.add('active');
      else s.classList.remove('active');
    });
  },

  toggleViewSection(sectionId) {
    this.elements.sections.forEach(s => {
      if (s.id === sectionId) s.classList.add('active');
      else s.classList.remove('active');
    });
  },

  // === SETUP WIZARD VIEW METHODS ===

  /**
   * Show/hide the setup panel
   */
  setSetupVisible(visible) {
    if (this.elements.setupPanel) {
      this.elements.setupPanel.classList.toggle('hidden', !visible);
    }
  },

  /**
   * Show a specific setup step (1-based), hiding others
   */
  showSetupStep(stepNum) {
    this.elements.stepPanels?.forEach(panel => {
      const thisStep = parseInt(panel.dataset.step);
      panel.style.display = thisStep === stepNum ? '' : 'none';
    });

    // Update back/next visibility
    if (this.elements.setupBackBtn) {
      this.elements.setupBackBtn.style.visibility = stepNum > 1 ? 'visible' : 'hidden';
    }
    if (this.elements.setupNextBtn) {
      this.elements.setupNextBtn.style.display = stepNum < 3 ? '' : 'none';
    }
    if (this.elements.saveSetupBtn) {
      this.elements.saveSetupBtn.style.display = stepNum === 3 ? '' : 'none';
    }

    // Update nav visibility
    const nav = document.querySelector('.setup-nav');
    if (nav) {
      nav.style.display = stepNum < 3 ? '' : 'none';
    }
  },

  /**
   * Update stepper state (active/done for each step)
   */
  updateStepper(currentStep, doneSteps = []) {
    this.elements.stepperSteps?.forEach(el => {
      const step = parseInt(el.dataset.step);
      el.classList.remove('active', 'done');
      if (step === currentStep) el.classList.add('active');
      else if (doneSteps.includes(step)) el.classList.add('done');
    });

    // Update lines between steps
    this.elements.stepperLines?.forEach((line, index) => {
      line.classList.toggle('done', doneSteps.includes(index + 1));
    });
  },

  /**
   * Show welcome overlay
   */
  showWelcomeOverlay() {
    if (this.elements.welcomeOverlay) {
      this.elements.welcomeOverlay.classList.remove('hidden');
    }
  },

  /**
   * Hide welcome overlay
   */
  hideWelcomeOverlay() {
    if (this.elements.welcomeOverlay) {
      this.elements.welcomeOverlay.classList.add('hidden');
    }
  },

  /**
   * Show a toast notification
   */
  showToast(message, type = '', duration = 3000) {
    const container = this.elements.toastContainer;
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="material-symbols-rounded" style="font-size:18px">${
      type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'
    }</span> ${escapeHtml(message)}`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * Set test button loading/success/fail state
   */
  setTestButtonLoading(provider, state) {
    const btn = this.elements[`test${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
    if (!btn) return;
    const icon = btn.querySelector('.material-symbols-rounded');

    btn.classList.remove('testing', 'test-ok', 'test-fail');
    btn.disabled = false;

    if (state === 'loading') {
      btn.classList.add('testing');
      btn.disabled = true;
      if (icon) { icon.textContent = 'sync'; icon.classList.add('spin-loading'); }
    } else if (state === 'ok') {
      btn.classList.add('test-ok');
      if (icon) { icon.textContent = 'check_circle'; icon.classList.remove('spin-loading'); }
    } else if (state === 'fail') {
      btn.classList.add('test-fail');
      if (icon) { icon.textContent = 'error'; icon.classList.remove('spin-loading'); }
    } else {
      if (icon) { icon.textContent = 'science'; icon.classList.remove('spin-loading'); }
    }
  },

  /**
   * Set status text for a step
   */
  setSetupStatus(provider, text, type = '') {
    const el = this.elements[`status${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
    if (!el) return;
    el.className = `step-status ${type}`;
    el.textContent = text;
  },

  /**
   * Setup visibility toggle for password inputs
   */
  setupVisibilityToggle(btn) {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      const icon = btn.querySelector('.material-symbols-rounded');
      if (icon) icon.textContent = isPassword ? 'visibility_off' : 'visibility';
    });
  },

  /**
   * Set attention animation on settings button
   */
  setSettingsAttention(active) {
    if (this.elements.settingsBtn) {
      this.elements.settingsBtn.classList.toggle('attention', active);
    }
  },

  /**
   * Show confetti animation
   */
  showConfetti() {
    const colors = ['#FF6B00', '#FFD700', '#27AE60', '#3498DB', '#E74C3C', '#9B59B6'];
    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.top = `${-10 + Math.random() * 20}px`;
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = `${Math.random() * 0.5}s`;
      piece.style.animationDuration = `${1.5 + Math.random() * 1}s`;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 3000);
    }
  },

  /**
   * Renders search results with confidence circles
   */
  appendResults(results) {
    if (!this.elements.resultsDiv) return;

    const html = results.map((item, index) => {
      const isSaved = !!item.saved;
      const savedClass = isSaved ? 'saved' : '';
      const iconClass = isSaved ? 'filled' : '';
      const iconText = isSaved ? 'bookmark' : 'bookmark_border';
      const dataContent = encodeURIComponent(JSON.stringify(item));

      const answerLetter = item.answerLetter || item.bestLetter || (item.answer?.match(/\b(?:letra\s+|alternativa\s*)?([A-E])\b/i)?.[1]?.toUpperCase()) || null;
      const answerBody = item.answerText || (item.answer || '')
        .replace(/^(?:Letra|Alternativa)\s*[A-E]\s*[:.\-]?\s*/i, '')
        .replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '')
        .trim();

      // Confidence score
      const confidence = item.confidence || item.score || null;
      let confidenceHtml = '';
      if (confidence !== null && confidence !== undefined) {
        const pct = Math.round(confidence * 100);
        let bg, label;
        if (pct >= 80) { bg = '#27AE60'; label = 'Excelente'; }
        else if (pct >= 60) { bg = '#F39C12'; label = 'Bom'; }
        else if (pct >= 40) { bg = '#E67E22'; label = 'Moderado'; }
        else { bg = '#E74C3C'; label = 'Baixo'; }
        confidenceHtml = `
          <div class="confidence-circle" style="background:${bg}" title="${label}: ${pct}%">
            ${pct}
            <div class="confidence-tooltip">${label} · Confiança ${pct}%</div>
          </div>`;
      }

      return `
        <div class="qa-card" style="animation-delay: ${index * 0.1}s">
          <div class="qa-card-header">
            <span class="material-symbols-rounded question-icon">help</span>
            <span class="qa-card-title">${escapeHtml(item.title || 'Questão Encontrada')}</span>
            ${confidenceHtml}
            <button class="action-btn save-btn ${savedClass}" data-content="${dataContent}" title="Salvar no Fichário">
              <span class="material-symbols-rounded ${iconClass}">${iconText}</span>
            </button>
          </div>
          
          <div class="qa-card-question">
            ${formatQuestionText(item.question)}
          </div>
          
          <div class="qa-card-answer">
            <div class="qa-card-answer-header">
               <span class="material-symbols-rounded">check_circle</span>
               Resposta correta
            </div>
            ${answerLetter ? `
              <div class="answer-option">
                <div class="alternative answer-alternative">
                  <span class="alt-letter">${answerLetter}</span>
                  <span class="alt-text">${escapeHtml(answerBody)}</span>
                </div>
              </div>
            ` : `
              <div class="qa-card-answer-text">
                 ${escapeHtml(answerBody)}
              </div>
            `}
          </div>
          
          <div class="qa-card-actions">
            ${Array.isArray(item.sources) && item.sources.length > 0 ? `
              <div class="sources-box">
                <button class="sources-toggle" type="button" aria-expanded="false">
                  <span class="material-symbols-rounded">link</span>
                  <span>Fontes (${item.sources.length})</span>
                  <span class="material-symbols-rounded sources-caret">expand_more</span>
                </button>
                <div class="sources-list" hidden>
                  ${item.sources.map(src => `
                    <div class="source-item">
                      <a href="${src.link}" target="_blank" rel="noopener noreferrer">
                        ${escapeHtml(src.title || new URL(src.link).hostname)}
                      </a>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : `
              <div class="source">
                 ${item.source ? `<a href="${item.source}" target="_blank">Fonte: ${new URL(item.source).hostname}</a>` : ''}
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');

    this.elements.resultsDiv.innerHTML = html;
  },

  getAllResultsText() {
    // Simplificado. Idealmente pegaria dos dados brutos.
    // Aqui pegamos do DOM para simplicidade
    let text = '';
    const cards = this.elements.resultsDiv.querySelectorAll('.qa-card');
    cards.forEach((card, i) => {
      const qEl = card.querySelector('.qa-card-question');
      const q = qEl ? qEl.innerText.trim() : '';

      let a = '';
      const answerTextEl = card.querySelector('.qa-card-answer-text');
      if (answerTextEl) {
        a = answerTextEl.innerText.trim();
      } else {
        const altEl = card.querySelector('.answer-alternative');
        if (altEl) {
          const letter = altEl.querySelector('.alt-letter')?.innerText.trim() || '';
          const body = altEl.querySelector('.alt-text')?.innerText.trim() || '';
          if (letter && body) a = `${letter} - ${body}`;
          else a = letter || body;
        }
      }

      text += `Q${i + 1}: ${q}\nR: ${a}\n\n`;
    });
    return text;
  },

  setSaveButtonState(btn, saved) {
    const icon = btn.querySelector('.material-symbols-rounded');
    btn.classList.toggle('saved', saved);
    if (icon) {
      icon.textContent = saved ? 'bookmark' : 'bookmark_border';
      icon.classList.toggle('filled', saved);
    }
  },

  resetAllSaveButtons() {
    const btns = document.querySelectorAll('.save-btn');
    btns.forEach(btn => this.setSaveButtonState(btn, false));
  },

  updateSaveStatusInSearch() {
    // TBD: Lógica para verificar quais itens da busca já estão salvos e atualizar ícones
  },

  // === BINDER RENDER ===
  renderBinderList(folder, options = {}) {
    if (!this.elements.binderList) return;

    const { showBackupReminder = false } = options;

    // Backup reminder
    let reminderHtml = '';
    if (showBackupReminder) {
      reminderHtml = `
        <div class="backup-reminder">
          <span class="material-symbols-rounded">backup</span>
          <span>Faça backup do seu fichário regularmente!</span>
          <button class="dismiss-reminder" title="Dispensar">
            <span class="material-symbols-rounded" style="font-size:16px">close</span>
          </button>
        </div>`;
    }

    // Toolbar with icon-only buttons
    let html = `
        ${reminderHtml}
        <div class="binder-toolbar">
            <span class="crumb-current"><span class="material-symbols-rounded" style="font-size:18px">folder_open</span> ${folder.id === 'root' ? 'Todas as questões' : escapeHtml(folder.title)}</span>
            <div class="toolbar-actions">
               ${folder.id !== 'root' ? `<button id="btnBackRoot" class="toolbar-icon-btn" title="Voltar"><span class="material-symbols-rounded" style="font-size:18px">arrow_back</span><span class="toolbar-tooltip">Voltar</span></button>` : ''}
               <button id="newFolderBtnBinder" class="toolbar-icon-btn" title="Nova pasta">
                 <span class="material-symbols-rounded" style="font-size:18px">create_new_folder</span>
                 <span class="toolbar-tooltip">Nova pasta</span>
               </button>
               <button id="exportBinderBtn" class="toolbar-icon-btn" title="Exportar">
                 <span class="material-symbols-rounded" style="font-size:18px">download</span>
                 <span class="toolbar-tooltip">Exportar</span>
               </button>
               <button id="importBinderBtn" class="toolbar-icon-btn" title="Importar">
                 <span class="material-symbols-rounded" style="font-size:18px">upload</span>
                 <span class="toolbar-tooltip">Importar</span>
               </button>
            </div>
        </div>
        <div class="binder-content">`;

    if (folder.children.length === 0) {
      html += `<div class="placeholder"><p>Pasta vazia</p></div>`;
    } else {
      folder.children.forEach(item => {
        if (item.type === 'folder') {
          html += `
                <div class="folder-item drop-zone" draggable="true" data-id="${item.id}" data-type="folder">
                    <div class="folder-info">
                       <span class="material-symbols-rounded folder-icon">folder</span>
                       <span class="folder-name">${escapeHtml(item.title)}</span>
                    </div>
                    <div class="folder-actions">
                      <button class="action-btn rename-btn" data-id="${item.id}" title="Renomear">
                         <span class="material-symbols-rounded" style="font-size:18px">edit</span>
                      </button>
                      <button class="action-btn delete-btn" data-id="${item.id}" title="Excluir">
                         <span class="material-symbols-rounded" style="font-size:18px">delete</span>
                      </button>
                    </div>
                </div>`;
        } else {
          const qText = item.content.question || '';
          const preview = qText.length > 60 ? qText.substring(0, 60) + '...' : qText;
          const answerRaw = item.content.answer || '';
          const answerLetter = (answerRaw.match(/\b(?:letra\s+|alternativa\s*)?([A-E])\b/i)?.[1]?.toUpperCase()) || null;
          const answerBody = answerRaw
            .replace(/^(?:Letra|Alternativa)\s*[A-E]\s*[:.\-]?\s*/i, '')
            .replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '')
            .trim();

          html += `
                <div class="qa-item expandable" draggable="true" data-id="${item.id}" data-type="question">
                    <div class="summary-view">
                        <div class="summary-icon"><span class="material-symbols-rounded">quiz</span></div>
                        <div class="summary-content">
                            <div class="summary-title">${escapeHtml(preview)}</div>
                        </div>
                        <span class="material-symbols-rounded expand-indicator">expand_more</span>
                    </div>
                    
                    <div class="full-view" style="display:none">
                        <div class="qa-card">
                          <div class="qa-card-header">
                            <span class="material-symbols-rounded question-icon">help</span>
                            <span class="qa-card-title">${escapeHtml('Questão Salva')}</span>
                          </div>
                          
                          <div class="qa-card-question">
                            ${formatQuestionText(item.content.question)}
                          </div>
                          
                          <div class="qa-card-answer">
                            <div class="qa-card-answer-header">
                               <span class="material-symbols-rounded">check_circle</span>
                               Resposta correta
                            </div>
                            ${answerLetter ? `
                              <div class="answer-option">
                                <div class="alternative answer-alternative">
                                  <span class="alt-letter">${answerLetter}</span>
                                  <span class="alt-text">${escapeHtml(answerBody)}</span>
                                </div>
                              </div>
                            ` : `
                              <div class="qa-card-answer-text">
                                 ${escapeHtml(answerBody)}
                              </div>
                            `}
                          </div>
                          
                          <div class="qa-card-actions">
                            ${item.content.source ? `
                              <div class="sources-box">
                                <button class="sources-toggle" type="button" aria-expanded="false">
                                  <span class="material-symbols-rounded">link</span>
                                  <span>Fonte</span>
                                  <span class="material-symbols-rounded sources-caret">expand_more</span>
                                </button>
                                <div class="sources-list" hidden>
                                  <div class="source-item">
                                    <a href="${item.content.source}" target="_blank" rel="noopener noreferrer">
                                      ${escapeHtml(new URL(item.content.source).hostname)}
                                    </a>
                                  </div>
                                </div>
                              </div>
                            ` : ''}
                            <div class="binder-actions">
                              <button class="action-btn copy-single-btn" data-id="${item.id}" title="Copiar">
                                 <span class="material-symbols-rounded">content_copy</span>
                              </button>
                              <button class="action-btn delete-btn" data-id="${item.id}" title="Excluir">
                                 <span class="material-symbols-rounded">delete</span>
                              </button>
                            </div>
                          </div>
                        </div>
                    </div>
                </div>`;
        }
      });
    }

    html += `</div>`; // Close binder-content
    this.elements.binderList.innerHTML = html;

    // Precisamos reatribuir listeners dinâmicos aqui ou delegar no Controller?
    // O Controller delega cliques no container, então botões funcionam.
    // Navegação (Voltar, Nova Pasta) precisa de IDs
    // O ideal seria o Controller tratar isso, mas como estamos simplificando:
    // Disparar CustomEvents? Ou deixar o Controller pegar pelo ID no delegate.
    // Vamos deixar o BinderController pegar pelo ID no click delegate.
  }
};
