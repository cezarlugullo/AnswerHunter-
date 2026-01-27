import { ExtractionService } from '../services/ExtractionService.js';
import { SearchService } from '../services/SearchService.js';
import { BinderController } from './BinderController.js';
import { StorageModel } from '../models/StorageModel.js';

export const PopupController = {
    view: null,

    async init(view) {
        this.view = view;

        // Inicializar sub-controllers
        BinderController.init(view);

        // Setup Listeners
        this.setupEventListeners();

        // Carregar estado inicial
        await StorageModel.init();
    },

    setupEventListeners() {
        // Botões Principais
        this.view.elements.extractBtn?.addEventListener('click', () => this.handleExtract());
        this.view.elements.searchBtn?.addEventListener('click', () => this.handleSearch());
        this.view.elements.copyBtn?.addEventListener('click', () => this.handleCopyAll());

        // Tabs
        this.view.elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                this.view.switchTab(target);
                if (target === 'binder') {
                    BinderController.renderBinder();
                }
            });
        });

        // Event Delegation para resultados (Salvar, Copiar único)
        this.view.elements.resultsDiv?.addEventListener('click', (e) => this.handleResultClick(e));
    },

    async handleExtract() {
        this.view.showStatus('loading', 'Extraindo conteúdo...');
        this.view.setButtonDisabled('extractBtn', true);

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // Injeta script de extração
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: ExtractionService.extractQAContentScript
            });

            const extractedItems = results?.[0]?.result || [];

            if (extractedItems.length === 0) {
                this.view.showStatus('error', 'Nenhuma questão encontrada nesta área.');
                this.view.setButtonDisabled('extractBtn', false);
                return;
            }

            this.view.showStatus('loading', 'Refinando com IA...');
            this.view.clearResults();

            // Processar cada item extraído
            let foundAny = false;
            for (const item of extractedItems) {
                // Fluxo de busca e refinamento
                const finalResults = await SearchService.searchAndRefine(item.result || item.question);

                if (finalResults && finalResults.length > 0) {
                    this.view.appendResults(finalResults);
                    foundAny = true;
                }
            }

            if (foundAny) {
                this.view.showStatus('success', 'Respostas encontradas!');
                this.view.toggleViewSection('results-view');
            } else {
                this.view.showStatus('error', 'Não foi possível encontrar respostas conclusivas.');
            }

        } catch (error) {
            console.error('Extraction error:', error);
            this.view.showStatus('error', 'Erro ao extrair/processar: ' + error.message);
        } finally {
            this.view.setButtonDisabled('extractBtn', false);
        }
    },

    async handleSearch() {
        this.view.showStatus('loading', 'Identificando questão...');
        this.view.setButtonDisabled('searchBtn', true);
        this.view.clearResults();

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // 1. Tentar Seleção
            let results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: ExtractionService.getSelectionScript
            });
            let query = results?.[0]?.result;

            // 2. Fallback: Extração Automática
            if (!query) {
                this.view.showStatus('loading', 'Sem seleção, buscando na página...');
                results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: ExtractionService.extractQAContentScript
                });
                const extracted = results?.[0]?.result || [];
                if (extracted.length > 0) {
                    query = extracted[0].result || extracted[0].question;
                }
            }

            if (!query || query.length < 5) {
                this.view.showStatus('error', 'Selecione o texto da questão ou garanta que ela esteja visível.');
                return;
            }

            this.view.showStatus('loading', 'Buscando respostas...');

            // Buscar
            const finalResults = await SearchService.searchAndRefine(query);

            if (finalResults && finalResults.length > 0) {
                this.view.appendResults(finalResults);
                this.view.showStatus('success', 'Busca concluída!');
                this.view.toggleViewSection('results-view');
            } else {
                this.view.showStatus('error', 'Nenhuma resposta encontrada para: ' + query.substring(0, 30) + '...');
            }

        } catch (error) {
            console.error('Search error:', error);
            this.view.showStatus('error', 'Erro na busca: ' + error.message);
        } finally {
            this.view.setButtonDisabled('searchBtn', false);
        }
    },



    handleCopyAll() {
        const text = this.view.getAllResultsText();
        if (text) {
            navigator.clipboard.writeText(text);
            this.view.showStatus('success', 'Copiado para área de transferência!');
        }
    },

    async handleResultClick(e) {
        // Lógica para clicar em Salvar (Bookmark)
        const saveBtn = e.target.closest('.save-btn');
        if (saveBtn) {
            const card = saveBtn.closest('.qa-card');
            const question = card.querySelector('.qa-card-question')?.textContent; // Simplificado, ideal seria pegar do dataset
            // Na implementação real da View, os dados estarão atrelados ao elemento
            // Vamos passar para BinderController lidar

            // Recuperar dados do dataset do elemento pai ou similar
            const dataJson = decodeURIComponent(saveBtn.dataset.content || '');
            if (dataJson) {
                const data = JSON.parse(dataJson);
                await BinderController.toggleSaveItem(data.question, data.answer, data.source, saveBtn);
            }
        }
    }
};
