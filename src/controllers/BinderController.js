import { StorageModel } from '../models/StorageModel.js';

export const BinderController = {
    view: null, // Referência para a View (PopupView)
    eventsBound: false,
    draggedItemId: null,

    init(view) {
        this.view = view;
        // Carregar dados iniciais (assíncrono, mas init é síncrono no fluxo de eventos)
        StorageModel.init();
        this.bindEvents();
    },

    async renderBinder() {
        if (!this.view) return;

        // Garante que dados estão carregados
        if (!StorageModel.data || StorageModel.data.length === 0) {
            await StorageModel.init();
        }

        const currentFolder = StorageModel.findNode(StorageModel.currentFolderId) || StorageModel.data[0];
        this.view.renderBinderList(currentFolder);
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
                    const text = `Questão: ${item.content.question}\n\nResposta: ${item.content.answer}`;
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
        const name = prompt('Nome da nova pasta:');
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
        const newName = prompt('Novo nome da pasta:', node.title);
        if (newName && newName.trim() && newName.trim() !== node.title) {
            await StorageModel.renameFolder(id, newName.trim());
            this.renderBinder();
        }
    },

    async handleDelete(id) {
        const node = StorageModel.findNode(id);
        if (!node) return;

        // Se for pasta com filhos, dar opções
        if (node.type === 'folder' && node.children && node.children.length > 0) {
            const choice = prompt(
                `A pasta "${node.title}" contém ${node.children.length} item(ns).\n\n` +
                'Digite uma opção:\n' +
                '1 - Excluir pasta E todo o conteúdo\n' +
                '2 - Excluir só a pasta (mover conteúdo para pasta pai)\n' +
                '0 - Cancelar'
            );
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

        if (confirm('Deseja realmente excluir este item?')) {
            const success = await StorageModel.deleteNode(id);
            if (success) {
                this.renderBinder();
                this.refreshSearchSaveStates();
            }
        }
    },

    async handleClearAll() {
        if (confirm('Tem certeza que deseja apagar TODO o fichário? Esta ação é irreversível.')) {
            await StorageModel.clearAll();
            this.renderBinder();
            this.view.resetAllSaveButtons();
            this.refreshSearchSaveStates();
        }
    },

    async handleMoveItem(itemId, targetFolderId) {
        await StorageModel.moveItem(itemId, targetFolderId);
        this.renderBinder(); // Re-renderiza para mostrar a mudança
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

    // Chamado quando clica no botão Salvar/Remover nos resultados da busca
    async toggleSaveItem(question, answer, source, btnElement) {
        const isSaved = btnElement.classList.contains('saved');

        if (isSaved) {
            // Remover
            const removed = await StorageModel.removeByContent(question);
            if (removed) {
                this.view.setSaveButtonState(btnElement, false);
            }
        } else {
            // Salvar
            const added = await StorageModel.addItem(question, answer, source);
            this.view.setSaveButtonState(btnElement, true);
            if (!added) {
                console.warn('BinderController: item duplicado, não adicionado.');
            }
        }
    }
};
