import { ExtractionService } from '../services/ExtractionService.js';
import { SearchService } from '../services/SearchService.js';
import { ApiService } from '../services/ApiService.js';
import { BinderController } from './BinderController.js';
import { StorageModel } from '../models/StorageModel.js';
import { SettingsModel } from '../models/SettingsModel.js';
import { isLikelyQuestion } from '../utils/helpers.js';

export const PopupController = {
    view: null,
    _currentSetupStep: 1,
    _onboardingFlags: { welcomed: false, setupDone: false },

    async init(view) {
        this.view = view;
        BinderController.init(view);
        this.setupEventListeners();
        await StorageModel.init();
        await this._loadOnboardingFlags();
        await this._restoreDraftKeys();
        await this.ensureSetupReady();
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

        // Settings button
        this.view.elements.settingsBtn?.addEventListener('click', () => this.toggleSetupPanel());
        this.view.elements.closeSetupBtn?.addEventListener('click', () => this.toggleSetupPanel(false));

        // Welcome overlay
        this.view.elements.welcomeStartBtn?.addEventListener('click', () => this.handleWelcomeStart());

        // Setup save
        this.view.elements.saveSetupBtn?.addEventListener('click', () => this.handleSaveSetup());

        // Step navigation
        this.view.elements.setupBackBtn?.addEventListener('click', () => this.goToSetupStep(this._currentSetupStep - 1));
        this.view.elements.setupNextBtn?.addEventListener('click', () => this.goToSetupStep(this._currentSetupStep + 1));

        // Test buttons
        document.querySelectorAll('.btn-test').forEach(btn => {
            btn.addEventListener('click', () => {
                const provider = btn.dataset.provider;
                if (provider) this.handleTestProvider(provider);
            });
        });

        // Visibility toggles
        document.querySelectorAll('.visibility-toggle').forEach(btn => {
            this.view.setupVisibilityToggle(btn);
        });

        // Auto-save draft keys on input change
        const inputs = [this.view.elements.inputGroq, this.view.elements.inputSerper, this.view.elements.inputGemini];
        inputs.forEach(input => {
            if (input) {
                input.addEventListener('input', () => this._saveDraftKeys());
            }
        });
    },

    // === ONBOARDING & SETUP ===

    async ensureSetupReady() {
        const readiness = await SettingsModel.getProviderReadiness();

        if (!readiness.ready) {
            // Not configured — show attention and possibly welcome
            this.view.setSettingsAttention(true);

            if (!this._onboardingFlags.welcomed) {
                this.view.showWelcomeOverlay();
            } else if (!this._onboardingFlags.setupDone) {
                // Already welcomed but setup not done — open setup panel
                this.toggleSetupPanel(true);
            }
        } else {
            this.view.setSettingsAttention(false);
            this._onboardingFlags.setupDone = true;
            await this._saveOnboardingFlags();
        }

        // Pre-fill inputs with current keys
        await this._fillInputsFromSettings();
    },

    async _fillInputsFromSettings() {
        const keys = await SettingsModel.getApiKeys();
        if (this.view.elements.inputGroq && keys.groqKey) {
            this.view.elements.inputGroq.value = keys.groqKey;
        }
        if (this.view.elements.inputSerper && keys.serperKey) {
            this.view.elements.inputSerper.value = keys.serperKey;
        }
        if (this.view.elements.inputGemini && keys.geminiKey) {
            this.view.elements.inputGemini.value = keys.geminiKey;
        }
    },

    handleWelcomeStart() {
        this.view.hideWelcomeOverlay();
        this._onboardingFlags.welcomed = true;
        this._saveOnboardingFlags();
        this.toggleSetupPanel(true);
    },

    toggleSetupPanel(forceState) {
        const panel = this.view.elements.setupPanel;
        if (!panel) return;

        const isHidden = panel.classList.contains('hidden');
        const shouldShow = forceState !== undefined ? forceState : isHidden;

        if (shouldShow) {
            this.view.setSetupVisible(true);
            this.goToSetupStep(this._determineCurrentStep());
        } else {
            this.view.setSetupVisible(false);
        }
    },

    _determineCurrentStep() {
        // Start from step 1 always when opening
        return 1;
    },

    goToSetupStep(step) {
        if (step < 1) step = 1;
        if (step > 3) step = 3;

        this._currentSetupStep = step;
        this.view.showSetupStep(step);
        this._updateStepperState();
    },

    async _updateStepperState() {
        const readiness = await SettingsModel.getProviderReadiness();
        const doneSteps = [];
        if (readiness.groq) doneSteps.push(1);
        if (readiness.serper) doneSteps.push(2);
        if (readiness.gemini) doneSteps.push(3);

        this.view.updateStepper(this._currentSetupStep, doneSteps);
    },

    async handleTestProvider(provider) {
        const inputEl = this.view.elements[`input${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
        const key = inputEl?.value?.trim();

        if (!key) {
            this.view.setSetupStatus(provider, 'Cole uma chave primeiro.', 'fail');
            return;
        }

        this.view.setTestButtonLoading(provider, 'loading');
        this.view.setSetupStatus(provider, 'Testando...', 'loading');

        try {
            let ok = false;

            if (provider === 'groq') {
                ok = await this._testGroqKey(key);
            } else if (provider === 'serper') {
                ok = await this._testSerperKey(key);
            } else if (provider === 'gemini') {
                ok = await this._testGeminiKey(key);
            }

            if (ok) {
                this.view.setTestButtonLoading(provider, 'ok');
                this.view.setSetupStatus(provider, 'Conexão OK!', 'ok');
            } else {
                this.view.setTestButtonLoading(provider, 'fail');
                this.view.setSetupStatus(provider, 'Chave inválida ou erro na conexão.', 'fail');
            }
        } catch (err) {
            console.error(`Test ${provider} error:`, err);
            this.view.setTestButtonLoading(provider, 'fail');
            this.view.setSetupStatus(provider, `Erro: ${err.message}`, 'fail');
        }
    },

    async _testGroqKey(key) {
        try {
            const res = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${key}` }
            });
            return res.ok;
        } catch { return false; }
    },

    async _testSerperKey(key) {
        try {
            const res = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: 'test', num: 1 })
            });
            return res.ok;
        } catch { return false; }
    },

    async _testGeminiKey(key) {
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            return res.ok;
        } catch { return false; }
    },

    async handleSaveSetup() {
        const groqKey = this._sanitizeKey(this.view.elements.inputGroq?.value);
        const serperKey = this._sanitizeKey(this.view.elements.inputSerper?.value);
        const geminiKey = this._sanitizeKey(this.view.elements.inputGemini?.value);

        if (!groqKey || !serperKey) {
            this.view.showToast('Preencha pelo menos as chaves Groq e Serper.', 'error');
            return;
        }

        try {
            await SettingsModel.saveSettings({
                groqApiKey: groqKey,
                serperApiKey: serperKey,
                geminiApiKey: geminiKey
            });

            this._onboardingFlags.setupDone = true;
            await this._saveOnboardingFlags();
            await this._clearDraftKeys();

            this.view.setSettingsAttention(false);
            this.view.setSetupVisible(false);
            this.view.showToast('Configurações salvas com sucesso!', 'success');
            this.view.showConfetti();
        } catch (err) {
            console.error('Save setup error:', err);
            this.view.showToast('Erro ao salvar: ' + err.message, 'error');
        }
    },

    _sanitizeKey(value) {
        return (value || '').trim();
    },

    // === DRAFT KEYS PERSISTENCE ===

    async _saveDraftKeys() {
        try {
            const drafts = {
                groq: this.view.elements.inputGroq?.value || '',
                serper: this.view.elements.inputSerper?.value || '',
                gemini: this.view.elements.inputGemini?.value || ''
            };
            await chrome.storage.local.set({ _draftApiKeys: drafts });
        } catch (err) {
            console.warn('Failed to save draft keys:', err);
        }
    },

    async _restoreDraftKeys() {
        try {
            const data = await chrome.storage.local.get(['_draftApiKeys']);
            const drafts = data?._draftApiKeys;
            if (!drafts) return;

            // Only restore if the inputs are empty (don't overwrite saved keys)
            if (this.view.elements.inputGroq && !this.view.elements.inputGroq.value && drafts.groq) {
                this.view.elements.inputGroq.value = drafts.groq;
            }
            if (this.view.elements.inputSerper && !this.view.elements.inputSerper.value && drafts.serper) {
                this.view.elements.inputSerper.value = drafts.serper;
            }
            if (this.view.elements.inputGemini && !this.view.elements.inputGemini.value && drafts.gemini) {
                this.view.elements.inputGemini.value = drafts.gemini;
            }
        } catch (err) {
            console.warn('Failed to restore draft keys:', err);
        }
    },

    async _clearDraftKeys() {
        try {
            await chrome.storage.local.remove(['_draftApiKeys']);
        } catch (err) {
            console.warn('Failed to clear draft keys:', err);
        }
    },

    // === ONBOARDING FLAGS ===

    async _loadOnboardingFlags() {
        try {
            const data = await chrome.storage.local.get(['_onboardingFlags']);
            if (data?._onboardingFlags) {
                this._onboardingFlags = { ...this._onboardingFlags, ...data._onboardingFlags };
            }
        } catch (err) {
            console.warn('Failed to load onboarding flags:', err);
        }
    },

    async _saveOnboardingFlags() {
        try {
            await chrome.storage.local.set({ _onboardingFlags: this._onboardingFlags });
        } catch (err) {
            console.warn('Failed to save onboarding flags:', err);
        }
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
