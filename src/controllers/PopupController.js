import { ExtractionService } from '../services/ExtractionService.js';
import { SearchService } from '../services/SearchService.js';
import { ApiService } from '../services/ApiService.js';
import { BinderController } from './BinderController.js';
import { StorageModel } from '../models/StorageModel.js';
import { isLikelyQuestion } from '../utils/helpers.js';

export const PopupController = {
    view: null,

    async init(view) {
        this.view = view;
        BinderController.init(view);
        this.setupEventListeners();
        await StorageModel.init();
    },

    setupEventListeners() {
        this.view.elements.extractBtn?.addEventListener('click', () => this.handleExtract());
        this.view.elements.searchBtn?.addEventListener('click', () => this.handleSearch());
        this.view.elements.copyBtn?.addEventListener('click', () => this.handleCopyAll());

        this.view.elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                this.view.switchTab(target);
                if (target === 'binder') {
                    BinderController.renderBinder();
                }
            });
        });

        this.view.elements.resultsDiv?.addEventListener('click', (e) => this.handleResultClick(e));
    },

    async handleExtract() {
        this.view.showStatus('loading', 'Extraindo conteúdo...');
        this.view.setButtonDisabled('extractBtn', true);

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: ExtractionService.extractQAContentScript
            });

            const extractedItems = results?.[0]?.result || [];

            if (extractedItems.length === 0) {
                this.view.showStatus('error', 'Nenhuma questão encontrada (tente selecionar o texto).');
                this.view.setButtonDisabled('extractBtn', false);
                return;
            }

            this.view.showStatus('loading', 'Refinando com IA...');
            this.view.clearResults();

            // Processar processExtractedItems
            const refinedData = await SearchService.processExtractedItems(extractedItems);

            if (refinedData.length > 0) {
                this.view.appendResults(refinedData);
                this.view.showStatus('success', `${refinedData.length} questão(ões) encontrada(s)!`);
                this.view.toggleViewSection('view-search');
            } else {
                this.view.showStatus('error', 'Nenhuma questão válida encontrada após refinamento.');
            }

        } catch (error) {
            console.error('Extraction error:', error);
            this.view.showStatus('error', 'Erro ao extrair: ' + error.message);
        } finally {
            this.view.setButtonDisabled('extractBtn', false);
        }
    },

    async handleSearch() {
        this.view.showStatus('loading', 'Obtendo pergunta...');
        this.view.setButtonDisabled('searchBtn', true);
        this.view.clearResults();

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // 1. Tentar extrair pergunta (todos os frames)
            // No legado usava allFrames: true, vamos manter
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                function: ExtractionService.extractQuestionOnlyScript
            });

            // Pegar o melhor resultado dos frames
            let bestQuestion = '';
            let bestLength = 0;

            for (const frameResult of results || []) {
                const text = frameResult?.result || '';
                if (text.length > bestLength) {
                    bestLength = text.length;
                    bestQuestion = text;
                }
            }

            console.log('AnswerHunter: Melhor questão encontrada:', bestQuestion?.substring(0, 100));

            if (!bestQuestion || bestQuestion.length < 5) {
                this.view.showStatus('error', 'Selecione o texto da pergunta e tente novamente.');
                return;
            }

            // Validação
            if (isLikelyQuestion(bestQuestion)) {
                console.log('AnswerHunter: Validacao heuristica OK (sem IA).');
            } else {
                this.view.showStatus('loading', 'Validando pergunta com IA...');
                const isValid = await ApiService.validateQuestion(bestQuestion);
                if (!isValid) {
                    this.view.showStatus('error', 'Pergunta inválida ou poluída. Tente selecionar o texto correto.');
                    return;
                }
            }

            this.view.showStatus('loading', 'Buscando no Google...');

            // Buscar e Refinar
            const finalResults = await SearchService.searchAndRefine(bestQuestion);

            if (finalResults && finalResults.length > 0) {
                this.view.appendResults(finalResults);
                this.view.showStatus('success', `${finalResults.length} resposta(s) encontrada(s)!`);
                this.view.toggleViewSection('view-search');
            } else {
                this.view.showStatus('error', 'IA não encontrou a resposta nos resultados.');
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
        const saveBtn = e.target.closest('.save-btn');
        if (saveBtn) {
            const dataContent = saveBtn.dataset.content;
            if (dataContent) {
                const data = JSON.parse(decodeURIComponent(dataContent));
                await BinderController.toggleSaveItem(data.question, data.answer, data.source, saveBtn);
            }
        }
    }
};
