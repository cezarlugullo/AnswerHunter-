import { StorageModel } from '../models/StorageModel.js';

const PALETTE = ['#FF6B6B','#4DABF7','#40C057','#DA77F2','#FFA94D','#F783AC','#20C997','#74C0FC'];
const ROOT_NAMES = new Set(['raiz', 'root', 'my study', 'binder', 'meu estudo']);

export const DisciplinasController = {

    init() {
        this._bindStaticEvents();
    },

    _bindStaticEvents() {
        document.getElementById('btnAddDiscNew')?.addEventListener('click', () => this._toggleCreateForm(true));
        document.getElementById('disc-create-cancel')?.addEventListener('click', () => this._toggleCreateForm(false));
        document.getElementById('disc-create-submit')?.addEventListener('click', () => this._handleCreate());
        document.getElementById('disc-create-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._handleCreate();
            if (e.key === 'Escape') this._toggleCreateForm(false);
        });
    },

    _toggleCreateForm(show) {
        const form = document.getElementById('disc-create-form');
        const input = document.getElementById('disc-create-input');
        if (show) {
            form?.classList.remove('hidden');
            input?.focus();
        } else {
            form?.classList.add('hidden');
            if (input) input.value = '';
        }
    },

    async _handleCreate() {
        const input = document.getElementById('disc-create-input');
        const name = input?.value.trim();
        if (!name) return;
        const list = await StorageModel.getDisciplines();
        const color = PALETTE[list.length % PALETTE.length];
        await StorageModel.addDiscipline(name, color);
        this._toggleCreateForm(false);
        await this.renderDisciplinas();
    },

    // Count all questions recursively inside a folder node
    _countInFolder(node) {
        let count = 0;
        for (const child of (node.children || [])) {
            if (child.type === 'question') count++;
            else if (child.type === 'folder') count += this._countInFolder(child);
        }
        return count;
    },

    // Get top-level non-root folders
    _getTopFolders() {
        const root = StorageModel.data?.[0];
        if (!root) return [];
        const children = root.children || [];
        return children.filter(n => n.type === 'folder' && !ROOT_NAMES.has((n.title || '').toLowerCase()));
    },

    async renderDisciplinas() {
        const container = document.getElementById('disc-cards-list');
        if (!container) return;

        if (!StorageModel.data || StorageModel.data.length === 0) {
            await StorageModel.init();
        }

        // Folder-based disciplines (from binder tree)
        const folders = this._getTopFolders();

        // Explicit disciplines (user-created via ah_disciplines)
        const explicitDiscs = await StorageModel.getDisciplines();

        // Merge: folders first, then explicit discs not already represented by a folder
        const folderNames = new Set(folders.map(f => f.title.toLowerCase()));
        const extraDiscs = explicitDiscs.filter(d => !folderNames.has(d.name.toLowerCase()));

        const hasAnything = folders.length > 0 || extraDiscs.length > 0;

        if (!hasAnything) {
            container.innerHTML = `
                <div class="disc-empty">
                    <span class="material-symbols-rounded disc-empty-icon">school</span>
                    <p class="disc-empty-title">Nenhuma disciplina ainda</p>
                    <p class="disc-empty-hint">Crie pastas no Binder para organizar por assunto, ou crie disciplinas manualmente com o botão +.</p>
                    <button class="placeholder-cta" id="discEmptyAddBtn" type="button">
                        <span class="material-symbols-rounded">add_circle</span>
                        Nova disciplina
                    </button>
                </div>`;
            document.getElementById('discEmptyAddBtn')?.addEventListener('click', () => this._toggleCreateForm(true));
            return;
        }

        // Pick a color for folders based on their index
        const folderCards = folders.map((folder, i) => {
            const count = this._countInFolder(folder);
            const hasQ = count > 0;
            const countLabel = count === 0 ? 'Sem questões' : count === 1 ? '1 questão' : `${count} questões`;
            const color = PALETTE[i % PALETTE.length];
            return { type: 'folder', id: folder.id, name: folder.title, color, count, hasQ, countLabel };
        });

        // Explicit disciplines (not covered by folders)
        const allQ = StorageModel.getAllQuestions();
        const extraCards = extraDiscs.map(d => {
            const count = allQ.filter(q => {
                const s = q?.content?.subject || q?.content?.topic || '';
                return s.toLowerCase() === d.name.toLowerCase();
            }).length;
            const hasQ = count > 0;
            const countLabel = count === 0 ? 'Sem questões' : count === 1 ? '1 questão' : `${count} questões`;
            return { type: 'explicit', id: d.id, name: d.name, color: d.color, count, hasQ, countLabel };
        });

        const allCards = [...folderCards, ...extraCards];

        container.innerHTML = allCards.map(card => `
            <div class="disc-card" data-disc-id="${card.id}" data-disc-type="${card.type}">
                <div class="disc-card-accent" style="background:${card.color}"></div>
                <div class="disc-card-body">
                    <div class="disc-card-top">
                        <div class="disc-card-name-row">
                            <span class="material-symbols-rounded disc-card-type-icon">${card.type === 'folder' ? 'folder' : 'label'}</span>
                            <span class="disc-card-name">${card.name}</span>
                        </div>
                        ${card.type === 'explicit' ? `
                        <div class="disc-card-menu-wrap">
                            <button class="disc-menu-btn" data-disc-opts="${card.id}" title="Opções" aria-label="Opções">
                                <span class="material-symbols-rounded">more_vert</span>
                            </button>
                            <div class="disc-menu-dropdown hidden" id="disc-menu-${card.id}">
                                <button data-disc-rename="${card.id}" class="disc-menu-item" type="button">
                                    <span class="material-symbols-rounded">edit</span> Renomear
                                </button>
                                <button data-disc-delete="${card.id}" class="disc-menu-item disc-menu-item--danger" type="button">
                                    <span class="material-symbols-rounded">delete</span> Excluir
                                </button>
                            </div>
                        </div>` : ''}
                    </div>
                    <div class="disc-card-count">${card.countLabel}</div>
                    <div class="disc-card-actions">
                        <button class="disc-action-btn disc-action-btn--primary" data-disc-study="${card.name}" ${!card.hasQ ? 'disabled' : ''} type="button">
                            <span class="material-symbols-rounded">menu_book</span> Estudar
                        </button>
                        <button class="disc-action-btn disc-action-btn--secondary" data-disc-sim="${card.name}" ${!card.hasQ ? 'disabled' : ''} type="button">
                            <span class="material-symbols-rounded">quiz</span> Simulado
                        </button>
                    </div>
                </div>
            </div>`).join('');

        // Bind study/simulado
        container.querySelectorAll('[data-disc-study]').forEach(btn => {
            btn.addEventListener('click', () => this._openStudy(btn.dataset.discStudy));
        });
        container.querySelectorAll('[data-disc-sim]').forEach(btn => {
            btn.addEventListener('click', () => this._openSimulado(btn.dataset.discSim));
        });

        // Bind explicit discipline menus
        container.querySelectorAll('[data-disc-opts]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleMenu(btn.dataset.discOpts, container);
            });
        });
        container.querySelectorAll('[data-disc-rename]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const list = await StorageModel.getDisciplines();
                const disc = list.find(d => d.id === btn.dataset.discRename);
                const newName = prompt('Novo nome:', disc?.name);
                if (newName?.trim() && newName.trim() !== disc?.name) {
                    await StorageModel.renameDiscipline(btn.dataset.discRename, newName.trim());
                    await this.renderDisciplinas();
                }
            });
        });
        container.querySelectorAll('[data-disc-delete]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const list = await StorageModel.getDisciplines();
                const disc = list.find(d => d.id === btn.dataset.discDelete);
                if (confirm(`Excluir a disciplina "${disc?.name}"? As questões não serão apagadas.`)) {
                    await StorageModel.deleteDiscipline(btn.dataset.discDelete);
                    await this.renderDisciplinas();
                }
            });
        });

        setTimeout(() => {
            // Remove previous listener if any, then add a persistent one
            if (this._closeMenuHandler) {
                document.removeEventListener('click', this._closeMenuHandler);
            }
            this._closeMenuHandler = () => {
                container.querySelectorAll('.disc-menu-dropdown').forEach(m => m.classList.add('hidden'));
            };
            document.addEventListener('click', this._closeMenuHandler);
        }, 0);
    },

    _toggleMenu(discId, container) {
        const menu = document.getElementById(`disc-menu-${discId}`);
        container?.querySelectorAll('.disc-menu-dropdown').forEach(m => {
            if (m.id !== `disc-menu-${discId}`) m.classList.add('hidden');
        });
        menu?.classList.toggle('hidden');
    },

    _openStudy(disciplineName) {
        const url = chrome.runtime.getURL('src/study/study.html') + `?discipline=${encodeURIComponent(disciplineName)}`;
        chrome.tabs.create({ url });
    },

    _openSimulado(disciplineName) {
        const url = chrome.runtime.getURL('src/study/study.html') + `?discipline=${encodeURIComponent(disciplineName)}&mode=simulado`;
        chrome.tabs.create({ url });
    },
};
