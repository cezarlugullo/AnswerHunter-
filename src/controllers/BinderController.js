import { StorageModel } from '../models/StorageModel.js';

export const BinderController = {
    view: null, // Referência para a View (PopupView)

    init(view) {
        this.view = view;
        // Carregar dados iniciais (assíncrono, mas init é síncrono no fluxo de eventos)
        StorageModel.init();
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

    async handleCreateFolder() {
        const name = prompt("Nome da nova pasta:");
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

    async handleDelete(id) {
        if (confirm('Deseja realmente excluir este item?')) {
            const success = await StorageModel.deleteNode(id);
            if (success) {
                this.renderBinder();
                // Atualizar status de salvo na busca (se visível)
                this.view.updateSaveStatusInSearch();
            }
        }
    },

    async handleClearAll() {
        if (confirm('Tem certeza que deseja apagar TODO o fichário? Esta ação é irreversível.')) {
            await StorageModel.clearAll();
            this.renderBinder();
            this.view.resetAllSaveButtons();
        }
    },

    async handleMoveItem(itemId, targetFolderId) {
        await StorageModel.moveItem(itemId, targetFolderId);
        this.renderBinder(); // Re-renderiza para mostrar a mudança
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
            await StorageModel.addItem(question, answer, source);
            this.view.setSaveButtonState(btnElement, true);
        }
    }
};
