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
        await this.restoreLastResults();
    },

    setupEventListeners() {
        this.view.elements.extractBtn?.addEventListener('click', () => this.handleExtract());
        this.view.elements.searchBtn?.addEventListener('click', () => this.handleSearch());
        this.view.elements.copyBtn?.addEventListener('click', () => this.handleCopyAll());
        this.view.elements.clearBinderBtn?.addEventListener('click', () => BinderController.handleClearAll());

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
        this.view.setButtonDisabled('copyBtn', true);

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
                const withSaved = refinedData.map(item => ({
                    ...item,
                    saved: StorageModel.isSaved(item.question)
                }));
                this.view.appendResults(withSaved);
                await this.saveLastResults(refinedData);
                this.view.showStatus('success', `${refinedData.length} questão(ões) encontrada(s)!`);
                this.view.toggleViewSection('view-search');
                this.view.setButtonDisabled('copyBtn', false);
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
        this.view.setButtonDisabled('copyBtn', true);
        this.view.clearResults();

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // 1. Tentar extrair pergunta (todos os frames)
            // No legado usava allFrames: true, vamos manter
            const extractionResults = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                function: ExtractionService.extractQuestionOnlyScript
            });

            // Pegar o melhor resultado dos frames
            let bestQuestion = '';
            let bestLength = 0;

            for (const frameResult of extractionResults || []) {
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

            // Verificar se a questão REALMENTE tem alternativas formatadas (não falsos positivos como "A UX")
            // Precisa ter pelo menos 2 letras consecutivas com formato de alternativa
            const hasRealOptions = (text) => {
                if (!text) return false;
                const matches = text.match(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s*\S/gi) || [];
                // Precisa ter pelo menos 2 alternativas reais
                return matches.length >= 2;
            };

            const questionAlreadyHasOptions = hasRealOptions(bestQuestion);
            console.log('AnswerHunter: Questão já tem alternativas reais?', questionAlreadyHasOptions);

            let displayQuestion = bestQuestion;

            // Só buscar alternativas separadamente se a questão NÃO tiver alternativas
            // Isso evita pegar alternativas de outra questão da página
            if (!questionAlreadyHasOptions) {
                // Capturar alternativas separadamente (se houver)
                const optionsResults = await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    function: ExtractionService.extractOptionsOnlyScript
                });
                let optionsText = '';
                let optionsLength = 0;
                for (const frameResult of optionsResults || []) {
                    const text = frameResult?.result || '';
                    if (text.length > optionsLength) {
                        optionsLength = text.length;
                        optionsText = text;
                    }
                }
                console.log('AnswerHunter: Alternativas extraídas separadamente:', optionsText?.substring(0, 200));

                // Adicionar alternativas se foram encontradas
                if (optionsText && optionsText.length > 10) {
                    displayQuestion = `${bestQuestion}\n${optionsText}`;
                }
            } else {
                console.log('AnswerHunter: Usando alternativas já incluídas na questão');
            }

            console.log('AnswerHunter: displayQuestion final:', displayQuestion?.substring(0, 300));

            this.view.showStatus('loading', 'Buscando no Google...');

            const searchResults = await SearchService.searchOnly(bestQuestion);
            if (!searchResults || searchResults.length === 0) {
                this.view.showStatus('loading', 'Nenhuma fonte encontrada. Consultando IA...');
                const aiResults = await SearchService.answerFromAi(bestQuestion);
                if (aiResults && aiResults.length > 0) {
                    const withSaved = aiResults.map(item => ({
                        ...item,
                        question: displayQuestion,
                        saved: StorageModel.isSaved(displayQuestion)
                    }));
                    this.view.appendResults(withSaved);
                    await this.saveLastResults(withSaved);
                    this.view.showStatus('success', `${aiResults.length} resposta(s) encontrada(s)!`);
                    this.view.toggleViewSection('view-search');
                    this.view.setButtonDisabled('copyBtn', false);
                } else {
                    this.view.showStatus('error', 'Não foi possível obter uma resposta.');
                }
                return;
            }

            this.view.showStatus('loading', `Encontrado ${searchResults.length} resultados. Analisando com IA...`);
            const finalResults = await SearchService.refineFromResults(
                bestQuestion,
                searchResults,
                displayQuestion,
                (message) => this.view.showStatus('loading', message)
            );

            if (finalResults && finalResults.length > 0) {
                const withSaved = finalResults.map(item => ({
                    ...item,
                    question: displayQuestion,
                    saved: StorageModel.isSaved(displayQuestion)
                }));
                this.view.appendResults(withSaved);
                await this.saveLastResults(withSaved);
                this.view.showStatus('success', `${finalResults.length} resposta(s) encontrada(s)!`);
                this.view.toggleViewSection('view-search');
                this.view.setButtonDisabled('copyBtn', false);
            } else {
                this.view.showStatus('loading', 'Sem resposta nas fontes. Consultando IA...');
                const aiResults = await SearchService.answerFromAi(bestQuestion);
                if (aiResults && aiResults.length > 0) {
                    const withSaved = aiResults.map(item => ({
                        ...item,
                        question: displayQuestion,
                        saved: StorageModel.isSaved(displayQuestion)
                    }));
                    this.view.appendResults(withSaved);
                    await this.saveLastResults(withSaved);
                    this.view.showStatus('success', `${aiResults.length} resposta(s) encontrada(s)!`);
                    this.view.toggleViewSection('view-search');
                    this.view.setButtonDisabled('copyBtn', false);
                } else {
                    this.view.showStatus('error', 'Não foi possível obter uma resposta.');
                }
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

    async saveLastResults(results) {
        try {
            await chrome.storage.local.set({ lastSearchResults: results });
        } catch (error) {
            console.warn('PopupController: falha ao salvar últimos resultados', error);
        }
    },

    async restoreLastResults() {
        try {
            const data = await chrome.storage.local.get(['lastSearchResults']);
            const cached = data?.lastSearchResults;
            if (!Array.isArray(cached) || cached.length === 0) return;

            const withSaved = cached.map(item => ({
                ...item,
                saved: StorageModel.isSaved(item.question)
            }));
            this.view.appendResults(withSaved);
            this.view.toggleViewSection('view-search');
            this.view.setButtonDisabled('copyBtn', false);
        } catch (error) {
            console.warn('PopupController: falha ao restaurar últimos resultados', error);
        }
    },

    async handleResultClick(e) {
        const toggleBtn = e.target.closest('.sources-toggle');
        if (toggleBtn) {
            const box = toggleBtn.closest('.sources-box');
            const list = box?.querySelector('.sources-list');
            if (box && list) {
                const isExpanded = box.classList.toggle('expanded');
                list.hidden = !isExpanded;
                toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            }
            return;
        }

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
