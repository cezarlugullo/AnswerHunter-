import { StorageModel } from '../models/StorageModel.js';
import { I18nService } from '../i18n/I18nService.js';

export const BinderController = {
    view: null,
    eventsBound: false,
    draggedItemId: null,
    lastExportTimestamp: null,

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

        this.view.renderBinderList(currentFolder, { showBackupReminder });
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

            const backBtn = e.target.closest('#btnBackRoot');
            if (backBtn) {
                e.preventDefault();
                this.handleNavigateRoot();
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
                    navigator.clipboard.writeText(text);
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

        const buttons = resultsDiv.querySelectorAll('.save-btn');
        buttons.forEach((btn) => {
            const dataContent = btn.dataset.content;
            if (!dataContent) return;
            try {
                const data = JSON.parse(decodeURIComponent(dataContent));
                const saved = StorageModel.isSaved(data.question);
                this.view.setSaveButtonState(btn, saved);
            } catch (error) {
                console.warn('BinderController: erro ao atualizar status de salvo', error);
            }
        });
    },

    // Called when clicking Save/Remove button in search results
    async toggleSaveItem(question, answer, source, btnElement) {
        const isSaved = btnElement.classList.contains('saved');

        if (isSaved) {
            const removed = await StorageModel.removeByContent(question);
            if (removed) {
                this.view.setSaveButtonState(btnElement, false);
            }
        } else {
            const added = await StorageModel.addItem(question, answer, source);
            this.view.setSaveButtonState(btnElement, true);
            if (!added) {
                console.warn('BinderController: duplicate item, not added.');
            }
        }
    },

    // === EXPORT / IMPORT ===

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


