import { StorageModel } from '../models/StorageModel.js';
import { I18nService } from '../i18n/I18nService.js';

export const BinderController = {
    view: null,
    eventsBound: false,
    draggedItemId: null,
    lastExportTimestamp: null,
    isStudyMode: false,

    t(key, variables) {
        return I18nService.t(key, variables);
    },

    init(view) {
        this.view = view;
        StorageModel.init();
        this._loadLastExportTimestamp();
        this.bindEvents();
    },

    async renderBinder() {
        if (!this.view) return;

        if (!StorageModel.data || StorageModel.data.length === 0) {
            await StorageModel.init();
        }

        const currentFolder = StorageModel.findNode(StorageModel.currentFolderId) || StorageModel.data[0];

        // Determine if backup reminder should show
        const showBackupReminder = await this._shouldShowBackupReminder();

        this.view.renderBinderList(currentFolder, { showBackupReminder, isStudyMode: this.isStudyMode });
    },

    async _shouldShowBackupReminder() {
        const itemCount = this._countBinderItems();
        if (itemCount < 5) return false;

        // Check if reminder was dismissed recently
        try {
            const data = await chrome.storage.local.get(['_backupReminderDismissedUntil']);
            const dismissedUntil = data?._backupReminderDismissedUntil;
            if (dismissedUntil && Date.now() < dismissedUntil) return false;
        } catch { }

        const daysSince = this._daysSinceLastExport();
        return daysSince === null || daysSince >= 7;
    },

    _countBinderItems() {
        const root = StorageModel.data?.[0];
        if (!root) return 0;
        let count = 0;
        const walk = (node) => {
            if (node.type === 'question') count++;
            if (node.children) node.children.forEach(walk);
        };
        walk(root);
        return count;
    },

    _daysSinceLastExport() {
        if (!this.lastExportTimestamp) return null;
        return Math.floor((Date.now() - this.lastExportTimestamp) / (1000 * 60 * 60 * 24));
    },

    async _loadLastExportTimestamp() {
        try {
            const data = await chrome.storage.local.get(['lastExportTimestamp']);
            this.lastExportTimestamp = data?.lastExportTimestamp || null;
        } catch { }
    },

    async _saveLastExportTimestamp() {
        this.lastExportTimestamp = Date.now();
        try {
            await chrome.storage.local.set({ lastExportTimestamp: this.lastExportTimestamp });
        } catch { }
    },

    async _dismissBackupReminder() {
        try {
            const dismissUntil = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
            await chrome.storage.local.set({ _backupReminderDismissedUntil: dismissUntil });
            this.renderBinder();
        } catch { }
    },

    bindEvents() {
        if (this.eventsBound || !this.view || !this.view.elements.binderList) return;
        const container = this.view.elements.binderList;

        container.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('.sources-toggle');
            if (toggleBtn) {
                e.stopPropagation();
                const box = toggleBtn.closest('.sources-box');
                const list = box?.querySelector('.sources-list');
                if (box && list) {
                    const isExpanded = box.classList.toggle('expanded');
                    list.hidden = !isExpanded;
                    toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
                }
                return;
            }

            const newFolderBtn = e.target.closest('#newFolderBtnBinder');
            if (newFolderBtn) {
                e.preventDefault();
                this.handleCreateFolder();
                return;
            }

            const studyModeBtn = e.target.closest('#btnStudyMode');
            if (studyModeBtn) {
                e.preventDefault();
                this.isStudyMode = !this.isStudyMode;
                this.renderBinder();
                return;
            }

            const studyRevealBtn = e.target.closest('.study-reveal-btn');
            if (studyRevealBtn) {
                e.preventDefault();
                e.stopPropagation();
                // Hide button, show answer
                studyRevealBtn.style.display = 'none';
                const answerBlock = studyRevealBtn.nextElementSibling;
                if (answerBlock && answerBlock.classList.contains('qa-card-answer')) {
                    answerBlock.classList.remove('study-hidden');
                }
                return;
            }

            const backBtn = e.target.closest('#btnBackRoot');
            if (backBtn) {
                e.preventDefault();
                this.handleNavigateRoot();
                return;
            }

            const openStudyPageBtn = e.target.closest('#openStudyPageBtn');
            if (openStudyPageBtn) {
                e.preventDefault();
                this.handleOpenStudyPage();
                return;
            }

            const exportBtn = e.target.closest('#exportBinderBtn');
            if (exportBtn) {
                e.preventDefault();
                this.handleExport();
                return;
            }

            const importBtn = e.target.closest('#importBinderBtn');
            if (importBtn) {
                e.preventDefault();
                this.handleImport();
                return;
            }

            const dismissBtn = e.target.closest('.dismiss-reminder');
            if (dismissBtn) {
                e.preventDefault();
                this._dismissBackupReminder();
                return;
            }

            const renameBtn = e.target.closest('.rename-btn');
            if (renameBtn) {
                e.stopPropagation();
                this.handleRename(renameBtn.dataset.id);
                return;
            }

            const delBtn = e.target.closest('.delete-btn');
            if (delBtn) {
                e.stopPropagation();
                this.handleDelete(delBtn.dataset.id);
                return;
            }

            const copyBtn = e.target.closest('.copy-single-btn');
            if (copyBtn) {
                e.stopPropagation();
                const item = StorageModel.findNode(copyBtn.dataset.id);
                if (item && item.content) {
                    const text = `${this.t('binder.copy.question')}: ${item.content.question}\n\n${this.t('binder.copy.answer')}: ${item.content.answer}`;
                    navigator.clipboard.writeText(text).catch(err => {
                        console.warn('BinderController: clipboard write failed:', err?.message);
                    });
                }
                return;
            }

            const folderItem = e.target.closest('.folder-item');
            if (folderItem) {
                this.handleNavigate(folderItem.dataset.id);
                return;
            }

            const expandItem = e.target.closest('.qa-item.expandable');
            if (expandItem) {
                expandItem.classList.toggle('expanded');
                const fullView = expandItem.querySelector('.full-view');
                if (fullView) {
                    fullView.style.display = fullView.style.display === 'none' ? 'block' : 'none';
                }
            }
        });

        container.addEventListener('dragstart', (e) => {
            const draggable = e.target.closest('[draggable="true"]');
            if (!draggable) return;
            e.dataTransfer.setData('text/plain', draggable.dataset.id);
            e.dataTransfer.effectAllowed = 'move';
            draggable.classList.add('dragging');
            this.draggedItemId = draggable.dataset.id;
        });

        container.addEventListener('dragend', () => {
            this.draggedItemId = null;
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            container.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        });

        container.addEventListener('dragover', (e) => {
            const folder = e.target.closest('.folder-item');
            if (!folder) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            folder.classList.add('drag-over');
        });

        container.addEventListener('dragleave', (e) => {
            const folder = e.target.closest('.folder-item');
            if (folder) folder.classList.remove('drag-over');
        });

        container.addEventListener('drop', (e) => {
            const folder = e.target.closest('.folder-item');
            if (!folder) return;
            e.preventDefault();
            folder.classList.remove('drag-over');
            const itemId = e.dataTransfer.getData('text/plain') || this.draggedItemId;
            const targetId = folder.dataset.id;
            if (itemId && targetId && itemId !== targetId) {
                this.handleMoveItem(itemId, targetId);
            }
        });

        this.eventsBound = true;
    },

    async handleCreateFolder() {
        const name = prompt(this.t('binder.prompt.newFolder'));
        if (name) {
            await StorageModel.createFolder(name);
            this.renderBinder();
        }
    },

    handleNavigate(folderId) {
        StorageModel.currentFolderId = folderId;
        this.renderBinder();
    },

    handleNavigateRoot() {
        StorageModel.currentFolderId = 'root';
        this.renderBinder();
    },

    async handleRename(id) {
        const node = StorageModel.findNode(id);
        if (!node || node.type !== 'folder') return;
        const newName = prompt(this.t('binder.prompt.renameFolder'), node.title);
        if (newName && newName.trim() && newName.trim() !== node.title) {
            await StorageModel.renameFolder(id, newName.trim());
            this.renderBinder();
        }
    },

    async handleDelete(id) {
        const node = StorageModel.findNode(id);
        if (!node) return;

        // If it is a folder with children, give options
        if (node.type === 'folder' && node.children && node.children.length > 0) {
            const choice = prompt(this.t('binder.prompt.deleteFolderOptions', {
                title: node.title,
                count: node.children.length
            }));
            if (choice === '1') {
                await StorageModel.deleteNode(id);
                this.renderBinder();
                this.refreshSearchSaveStates();
            } else if (choice === '2') {
                await StorageModel.deleteFolderKeepChildren(id);
                this.renderBinder();
                this.refreshSearchSaveStates();
            }
            return;
        }

        if (confirm(this.t('binder.confirm.deleteItem'))) {
            const success = await StorageModel.deleteNode(id);
            if (success) {
                this.renderBinder();
                this.refreshSearchSaveStates();
            }
        }
    },

    async handleClearAll() {
        if (confirm(this.t('binder.confirm.clearAll'))) {
            await StorageModel.clearAll();
            this.renderBinder();
            this.view.resetAllSaveButtons();
            this.refreshSearchSaveStates();
        }
    },

    async handleMoveItem(itemId, targetFolderId) {
        await StorageModel.moveItem(itemId, targetFolderId);
        this.renderBinder(); // Re-renders to show the change
    },

    refreshSearchSaveStates() {
        const resultsDiv = this.view?.elements?.resultsDiv;
        if (!resultsDiv) return;

        const cards = resultsDiv.querySelectorAll('.qa-card');
        cards.forEach((card) => {
            const saveBtn = card.querySelector('.save-btn');
            const reviewBtn = card.querySelector('.btn-review-later');
            const dataContent = saveBtn?.dataset.content || reviewBtn?.dataset.content;
            if (!dataContent) return;
            try {
                const data = JSON.parse(decodeURIComponent(dataContent));
                const meta = StorageModel.getQuestionMeta(data.question);
                if (saveBtn) this.view.setSaveButtonState(saveBtn, meta.saved);
                if (reviewBtn) this.view.setReviewLaterButtonState(reviewBtn, meta.reviewLater);
            } catch (error) {
                console.warn('BinderController: erro ao atualizar status de salvo', error);
            }
        });
    },

    // Called when clicking Save/Remove button in search results
    async toggleSaveItem(question, answer, source, btnElement, sources = []) {
        const isSaved = btnElement.classList.contains('saved');

        if (isSaved) {
            const removed = await StorageModel.removeByContent(question);
            if (removed) {
                this.view.setSaveButtonState(btnElement, false);
            }
        } else {
            const added = await StorageModel.addItem(question, answer, source, { sources });
            this.view.setSaveButtonState(btnElement, true);
            if (!added) {
                console.warn('BinderController: duplicate item, not added.');
            }
        }
    },

    // === DISCIPLINAS ===

    async openDisciplinaManager() {
        const overlay = document.getElementById('disciplinas-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        if (!overlay.dataset.bound) {
            overlay.dataset.bound = '1';
            document.getElementById('discModalCloseBtn')?.addEventListener('click', () => overlay.classList.add('hidden'));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });

            document.getElementById('discAddBtn')?.addEventListener('click', () => this._createDisciplineFromInput());
            document.getElementById('disc-new-name')?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this._createDisciplineFromInput();
            });
        }
        await this._renderDisciplineList();
    },

    async _createDisciplineFromInput() {
        const input = document.getElementById('disc-new-name');
        const name = input?.value.trim();
        if (!name) return;
        const PALETTE = ['#FF6B6B','#4DABF7','#40C057','#DA77F2','#FFA94D','#F783AC','#20C997','#74C0FC'];
        const disciplines = await StorageModel.getDisciplines();
        const color = PALETTE[disciplines.length % PALETTE.length];
        await StorageModel.addDiscipline(name, color);
        if (input) input.value = '';
        await this._renderDisciplineList();
        await this._populateDisciplineSelect();
    },

    async _renderDisciplineList() {
        const list = document.getElementById('disc-list');
        const empty = document.getElementById('disc-empty-msg');
        if (!list) return;
        const disciplines = await StorageModel.getDisciplines();
        if (!disciplines.length) {
            list.innerHTML = '';
            empty?.classList.remove('hidden');
            return;
        }
        empty?.classList.add('hidden');
        const allQ = StorageModel.getAllQuestions();
        list.innerHTML = disciplines.map(d => {
            const count = allQ.filter(q => {
                const s = q?.content?.subject || q?.content?.topic || '';
                return s.toLowerCase() === d.name.toLowerCase();
            }).length;
            return`
            <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,0.08);background:#fff">
              <span style="width:10px;height:10px;border-radius:50%;background:${d.color};flex-shrink:0"></span>
              <span id="disc-name-${d.id}" style="flex:1;font-size:.84rem;font-weight:600">${d.name}</span>
              <span style="font-size:.72rem;color:#888;background:#f5f5f5;border-radius:20px;padding:1px 8px">${count}q</span>
              <button data-disc-rename="${d.id}" title="Renomear"
                style="border:none;background:none;cursor:pointer;color:#aaa;padding:2px;display:flex;align-items:center">
                <span class="material-symbols-rounded" style="font-size:16px">edit</span>
              </button>
              <button data-disc-delete="${d.id}" title="Excluir"
                style="border:none;background:none;cursor:pointer;color:#ff8787;padding:2px;display:flex;align-items:center">
                <span class="material-symbols-rounded" style="font-size:16px">delete</span>
              </button>
            </div>`;
        }).join('');

        list.querySelectorAll('[data-disc-delete]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm(`Excluir disciplina "${btn.closest('div').querySelector('span[id]')?.textContent}"?`)) {
                    await StorageModel.deleteDiscipline(btn.dataset.discDelete);
                    await this._renderDisciplineList();
                    await this._populateDisciplineSelect();
                }
            });
        });
        list.querySelectorAll('[data-disc-rename]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const nameEl = list.querySelector(`#disc-name-${btn.dataset.discRename}`);
                const newName = prompt('Novo nome:', nameEl?.textContent);
                if (newName?.trim()) {
                    await StorageModel.renameDiscipline(btn.dataset.discRename, newName.trim());
                    await this._renderDisciplineList();
                    await this._populateDisciplineSelect();
                }
            });
        });
    },

    async _populateDisciplineSelect() {
        const select = document.getElementById('manual-discipline');
        const hiddenSubject = document.getElementById('manual-subject');
        if (!select) return;
        const disciplines = await StorageModel.getDisciplines();
        const prev = select.value;
        select.innerHTML = `<option value="">— Sem disciplina —</option>` +
            disciplines.map(d => `<option value="${d.name}">${d.name}</option>`).join('') +
            `<option value="__new__"> Nova disciplina...</option>`;
        if (prev) select.value = prev;

        select.onchange = () => {
            const newInput = document.getElementById('manual-new-discipline-input');
            if (select.value === '__new__') {
                newInput?.classList.remove('hidden');
                newInput?.focus();
            } else {
                newInput?.classList.add('hidden');
                if (hiddenSubject) hiddenSubject.value = select.value;
            }
        };

        // sync new-input on blur: create discipline then select it
        const newInput = document.getElementById('manual-new-discipline-input');
        if (newInput && !newInput.dataset.bound) {
            newInput.dataset.bound = '1';
            newInput.addEventListener('keydown', async (e) => {
                if (e.key !== 'Enter') return;
                const name = newInput.value.trim();
                if (!name) return;
                const PALETTE = ['#FF6B6B','#4DABF7','#40C057','#DA77F2','#FFA94D'];
                const list = await StorageModel.getDisciplines();
                const color = PALETTE[list.length % PALETTE.length];
                const disc = await StorageModel.addDiscipline(name, color);
                await this._populateDisciplineSelect();
                select.value = disc.name;
                if (hiddenSubject) hiddenSubject.value = disc.name;
                newInput.value = '';
                newInput.classList.add('hidden');
            });
        }
    },

    // === MANUAL ADD QUESTION ===

    handleAddManual() {
        this._openManualAddModal();
    },

    _openManualAddModal() {
        const overlay = document.getElementById('manual-add-overlay');
        if (!overlay) return;

        // Reset form fields
        const qTA     = document.getElementById('manual-question');
        const aTA     = document.getElementById('manual-answer');
        const subjIn  = document.getElementById('manual-subject');
        const srcIn   = document.getElementById('manual-source');
        const errDiv  = document.getElementById('manual-add-error');
        const saveBtn = document.getElementById('manualAddSaveBtn');

        if (qTA)   { qTA.value = ''; const c = document.getElementById('manual-question-count'); if (c) c.textContent = '0'; }
        if (aTA)   { aTA.value = ''; const c = document.getElementById('manual-answer-count'); if (c) c.textContent = '0'; }
        if (subjIn) subjIn.value = '';
        if (srcIn)  srcIn.value  = '';
        if (errDiv) errDiv.classList.add('hidden');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<span class="material-symbols-rounded">save</span><span data-i18n="manual.add.save">' + this.t('manual.add.save') + '</span>';
        }

        // Populate folder and discipline dropdowns
        this._populateManualFolderSelect();
        this._populateDisciplineSelect();

        // Bind events only once
        if (!overlay.dataset.bound) {
            overlay.dataset.bound = '1';

            document.getElementById('btnManageDisciplines')?.addEventListener('click', () => this.openDisciplinaManager());
            document.getElementById('manualAddCloseBtn')?.addEventListener('click',  () => this._closeManualAddModal());
            document.getElementById('manualAddCancelBtn')?.addEventListener('click', () => this._closeManualAddModal());
            overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeManualAddModal(); });

            // Character counters
            qTA?.addEventListener('input', () => {
                const c = document.getElementById('manual-question-count');
                if (c) c.textContent = qTA.value.length;
            });
            aTA?.addEventListener('input', () => {
                const c = document.getElementById('manual-answer-count');
                if (c) c.textContent = aTA.value.length;
            });

            document.getElementById('manualAddSaveBtn')?.addEventListener('click', () => this._submitManualAdd());

            // Keyboard shortcuts
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this._closeManualAddModal();
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') this._submitManualAdd();
            });
        }

        overlay.classList.remove('hidden');
        setTimeout(() => qTA?.focus(), 60);
    },

    _closeManualAddModal() {
        document.getElementById('manual-add-overlay')?.classList.add('hidden');
    },

    _populateManualFolderSelect() {
        const select = document.getElementById('manual-folder');
        if (!select) return;
        select.innerHTML = '';

        const addOptions = (nodes, prefix = '') => {
            for (const node of nodes) {
                if (node.type === 'folder') {
                    const opt  = document.createElement('option');
                    opt.value  = node.id;
                    opt.textContent = prefix + (node.title || node.id);
                    if (node.id === StorageModel.currentFolderId) opt.selected = true;
                    select.appendChild(opt);
                    if (node.children?.length) addOptions(node.children, prefix + '\u00a0\u00a0\u203a');
                }
            }
        };
        addOptions(StorageModel.data);
    },

    async _submitManualAdd() {
        const question = document.getElementById('manual-question')?.value.trim();
        const answer   = document.getElementById('manual-answer')?.value.trim();
        const discSelect = document.getElementById('manual-discipline');
        const subject = discSelect?.value === '__new__'
            ? (document.getElementById('manual-new-discipline-input')?.value.trim() || '')
            : (discSelect?.value || document.getElementById('manual-subject')?.value.trim() || '');
        const source   = document.getElementById('manual-source')?.value.trim() || '';
        const folderId = document.getElementById('manual-folder')?.value;
        const errDiv   = document.getElementById('manual-add-error');
        const saveBtn  = document.getElementById('manualAddSaveBtn');

        // Validation
        if (!question || !answer) {
            if (errDiv) {
                errDiv.textContent = this.t('manual.add.errorRequired');
                errDiv.classList.remove('hidden');
            }
            return;
        }
        if (errDiv) errDiv.classList.add('hidden');

        // Loading state
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="material-symbols-rounded spin-loading">sync</span>';
        }

        // Temporarily switch to target folder and save
        const prevFolder = StorageModel.currentFolderId;
        if (folderId) StorageModel.currentFolderId = folderId;

        let added;
        try {
            added = await StorageModel.addItem(question, answer, source, { subject });
        } catch (err) {
            console.error('BinderController: manual add failed:', err);
            if (errDiv) {
                errDiv.textContent = 'Erro ao salvar: ' + (err?.message || 'desconhecido');
                errDiv.classList.remove('hidden');
            }
            return;
        } finally {
            StorageModel.currentFolderId = prevFolder;
            // Always restore button state
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span class="material-symbols-rounded">save</span><span>' + this.t('manual.add.save') + '</span>';
            }
        }

        if (added === false) {
            if (errDiv) {
                errDiv.textContent = this.t('manual.add.errorDuplicate');
                errDiv.classList.remove('hidden');
            }
            return;
        }

        this._closeManualAddModal();
        await this.renderBinder();
        if (this.view?.showToast) this.view.showToast(this.t('manual.add.success'), 'success');
    },

    // === EXPORT / IMPORT / STUDY PAGE ===

    _collectAllQuestions(nodes = StorageModel.data, folderPath = '') {
        const items = [];
        for (const node of nodes) {
            if (node.type === 'question' && node.content) {
                items.push({ ...node.content, folderPath, createdAt: node.createdAt });
            } else if (node.type === 'folder') {
                const path = folderPath ? `${folderPath} / ${node.title}` : node.title;
                items.push(...this._collectAllQuestions(node.children || [], path));
            }
        }
        return items;
    },

    async handleOpenStudyPage() {
        const questions = this._collectAllQuestions();
        if (!questions.length) {
            if (this.view.showToast) this.view.showToast(this.t('binder.toast.nothingToExport'), 'error');
            return;
        }
        const url = chrome.runtime.getURL('src/study/study.html');
        chrome.tabs.create({ url });
    },

    async handleExport() {
        try {
            const data = StorageModel.data;
            if (!data || data.length === 0) {
                if (this.view.showToast) {
                    this.view.showToast(this.t('binder.toast.nothingToExport'), 'error');
                }
                return;
            }

            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `answerhunter-backup-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            await this._saveLastExportTimestamp();

            if (this.view.showToast) {
                this.view.showToast(this.t('binder.toast.exportSuccess'), 'success');
            }
        } catch (err) {
            console.error('Export error:', err);
            if (this.view.showToast) {
                this.view.showToast(this.t('binder.toast.exportError', { message: err.message }), 'error');
            }
        }
    },

    async handleImport() {
        try {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.style.display = 'none';
            document.body.appendChild(input);

            // Cleanup if user dismisses the file picker without selecting a file
            const cleanupInput = () => {
                if (document.body.contains(input)) document.body.removeChild(input);
            };
            window.addEventListener('focus', function onWindowFocus() {
                window.removeEventListener('focus', onWindowFocus);
                setTimeout(cleanupInput, 500);
            }, { once: true });

            input.addEventListener('change', async (e) => {
                try {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    const text = await file.text();
                    let data;
                    try {
                        data = JSON.parse(text);
                    } catch (e) {
                        throw new Error('Invalid JSON format');
                    }

                    // Handle potential wrapping (e.g. if user exported raw storage object)
                    if (data && !Array.isArray(data) && Array.isArray(data.binderStructure)) {
                        data = data.binderStructure;
                    }

                    if (!Array.isArray(data) || data.length === 0) {
                        if (this.view.showToast) {
                            this.view.showToast(this.t('binder.toast.invalidFile'), 'error');
                        }
                        return;
                    }

                    // Confirm before overwriting
                    if (!confirm(this.t('binder.confirm.importReplace'))) return;

                    await StorageModel.importData(data);
                    this.renderBinder();

                    if (this.view.showToast) {
                        this.view.showToast(this.t('binder.toast.importSuccess'), 'success');
                    }
                } catch (innerErr) {
                    console.error('Import processing error:', innerErr);
                    if (this.view.showToast) {
                        this.view.showToast(this.t('binder.toast.importError', { message: innerErr.message }), 'error');
                    }
                } finally {
                    document.body.removeChild(input);
                }
            });

            input.click();
        } catch (err) {
            console.error('Import setup error:', err);
            if (this.view.showToast) {
                this.view.showToast(this.t('binder.toast.importError', { message: err.message }), 'error');
            }
        }
    }
};


