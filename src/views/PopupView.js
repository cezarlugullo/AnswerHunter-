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
            tabs: document.querySelectorAll('.tab-btn'),
            sections: document.querySelectorAll('.view-section'),
            saveBtns: document.querySelectorAll('.save-btn') // Dinâmico
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

    /**
     * Renderiza os resultados da busca
     */
    appendResults(results) {
        if (!this.elements.resultsDiv) return;

        const html = results.map((item, index) => {
            const dataContent = encodeURIComponent(JSON.stringify(item));

            return `
        <div class="qa-card" style="animation-delay: ${index * 0.1}s">
          <div class="qa-card-header">
            <span class="material-symbols-rounded question-icon">help</span>
            <span class="qa-card-title">${escapeHtml(item.title || 'Questão Encontrada')}</span>
            <button class="action-btn save-btn" data-content="${dataContent}" title="Salvar no Fichário">
              <span class="material-symbols-rounded">bookmark_border</span>
            </button>
          </div>
          
          <div class="qa-card-question">
            ${formatQuestionText(item.question)}
          </div>
          
          <div class="qa-card-answer">
            <div class="qa-card-answer-header">
               <span class="material-symbols-rounded">check_circle</span>
               Resposta Correta
            </div>
            <div class="qa-card-answer-text">
               ${escapeHtml(item.answer)}
            </div>
          </div>
          
          <div class="qa-card-actions">
            <div class="source">
               ${item.source ? `<a href="${item.source}" target="_blank">Fonte: ${new URL(item.source).hostname}</a>` : ''}
            </div>
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
            const q = card.querySelector('.qa-card-question').textContent.trim();
            const a = card.querySelector('.qa-card-answer-text').textContent.trim();
            text += `Q${i + 1}: ${q}\nR: ${a}\n\n`;
        });
        return text;
    },

    setSaveButtonState(btn, saved) {
        const icon = btn.querySelector('.material-symbols-rounded');
        if (saved) {
            btn.classList.add('saved');
            if (icon) icon.textContent = 'bookmark';
        } else {
            btn.classList.remove('saved');
            if (icon) icon.textContent = 'bookmark_border';
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
    renderBinderList(folder) {
        if (!this.elements.binderList) return;

        // Toolbar
        let html = `
        <div class="binder-toolbar">
            <span class="crumb-current"><span class="material-symbols-rounded" style="font-size:18px">folder_open</span> ${escapeHtml(folder.title)}</span>
            <div class="toolbar-actions">
               ${folder.id !== 'root' ? `<button id="btnBackRoot" class="btn-text"><span class="material-symbols-rounded" style="font-size:16px">arrow_back</span> Voltar</button>` : ''}
               <button id="newFolderBtnBinder" class="btn-text">+ Pasta</button>
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
                    <button class="action-btn delete-btn" data-id="${item.id}" title="Excluir">
                       <span class="material-symbols-rounded" style="font-size:18px">delete</span>
                    </button>
                </div>`;
                } else {
                    const qText = item.content.question || '';
                    const preview = qText.length > 60 ? qText.substring(0, 60) + '...' : qText;

                    html += `
                <div class="qa-item expandable" draggable="true" data-id="${item.id}" data-type="question">
                    <div class="summary-view" onclick="this.parentElement.classList.toggle('expanded'); this.parentElement.querySelector('.full-view').style.display = this.parentElement.classList.contains('expanded') ? 'block' : 'none'">
                        <div class="summary-icon"><span class="material-symbols-rounded">quiz</span></div>
                        <div class="summary-content">
                            <div class="summary-title">${escapeHtml(preview)}</div>
                        </div>
                        <span class="material-symbols-rounded expand-indicator">expand_more</span>
                    </div>
                    
                    <div class="full-view" style="display:none">
                        <div class="question-content" style="border:none; padding:10px 0;">
                           ${formatQuestionText(item.content.question)}
                        </div>
                        <div class="answer" style="border:1px solid #eee;">
                           ${escapeHtml(item.content.answer)}
                        </div>
                        <div class="qa-card-actions" style="justify-content:flex-end; margin-top:10px;">
                            <button class="action-btn copy-single-btn" data-id="${item.id}">
                               <span class="material-symbols-rounded">content_copy</span>
                            </button>
                            <button class="action-btn delete-btn" data-id="${item.id}">
                               <span class="material-symbols-rounded">delete</span>
                            </button>
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
