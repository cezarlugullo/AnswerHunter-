import { ApiService } from './ApiService.js';

/**
 * SearchService.js
 * Coordena os fluxos de Extração (direta) e Busca (Google).
 */
export const SearchService = {
    _normalizeOption(text) {
        return (text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^[a-e]\s*[\)\.\-:]\s*/i, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    },

    _extractOptionsFromQuestion(questionText) {
        if (!questionText) return [];
        const lines = questionText.split('\n').map(l => l.trim()).filter(Boolean);
        const options = [];
        const optionRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
        for (const line of lines) {
            const m = line.match(optionRe);
            if (m) options.push(`${m[1].toUpperCase()}) ${m[2].trim()}`);
        }
        return options;
    },

    _optionsMatch(originalOptions, sourceOptions) {
        if (!originalOptions || originalOptions.length < 2) return true;
        if (!sourceOptions || sourceOptions.length < 2) return true;

        const originalSet = new Set(originalOptions.map(o => this._normalizeOption(o)).filter(Boolean));
        const sourceSet = new Set(sourceOptions.map(o => this._normalizeOption(o)).filter(Boolean));
        if (originalSet.size === 0 || sourceSet.size === 0) return true;

        let hits = 0;
        for (const opt of originalSet) {
            if (sourceSet.has(opt)) hits += 1;
        }

        const ratio = hits / originalSet.size;
        return ratio >= 0.6 || hits >= Math.min(3, originalSet.size);
    },

    _optionsMatchInFreeText(originalOptions, sourceText) {
        if (!originalOptions || originalOptions.length < 2) return true;
        if (!sourceText || sourceText.length < 50) return true;

        const normalizedSource = this._normalizeOption(sourceText);
        if (!normalizedSource) return true;

        const originalSet = new Set(originalOptions.map(o => this._normalizeOption(o)).filter(Boolean));
        if (originalSet.size === 0) return true;

        let hits = 0;
        for (const opt of originalSet) {
            if (opt && normalizedSource.includes(opt)) hits += 1;
        }

        const ratio = hits / originalSet.size;
        return ratio >= 0.6 || hits >= Math.min(3, originalSet.size);
    },

    _buildOptionsMap(questionText) {
        const options = this._extractOptionsFromQuestion(questionText);
        const map = {};
        for (const opt of options) {
            const m = opt.match(/^([A-E])\)\s*(.+)$/i);
            if (m) map[m[1].toUpperCase()] = m[2].trim();
        }
        return map;
    },

    _parseAnswerLetter(answerText) {
        if (!answerText) return null;
        let letter = null;
        let m = answerText.match(/\b(?:letra|alternativa)\s*([A-E])\b/i);
        if (m) letter = m[1].toUpperCase();
        if (!letter) {
            m = answerText.match(/^\s*([A-E])\s*[\)\.\-:]/i);
            if (m) letter = m[1].toUpperCase();
        }
        return letter;
    },

    _parseAnswerText(answerText) {
        if (!answerText) return '';
        return answerText
            .replace(/^(?:Letra|Alternativa)\s*[A-E]\s*[:.\-]?\s*/i, '')
            .replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '')
            .trim();
    },

    _findLetterByAnswerText(answerBody, optionsMap) {
        if (!answerBody || !optionsMap) return null;
        const normalizedAnswer = this._normalizeOption(answerBody);
        let bestLetter = null;
        let bestScore = 0;
        Object.entries(optionsMap).forEach(([letter, body]) => {
            const normalizedBody = this._normalizeOption(body);
            if (!normalizedBody) return;
            if (normalizedAnswer.includes(normalizedBody)) {
                const score = normalizedBody.length;
                if (score > bestScore) {
                    bestScore = score;
                    bestLetter = letter;
                }
            }
        });
        return bestLetter;
    },
    async searchOnly(questionText) {
        return ApiService.searchWithSerper(questionText);
    },

    async answerFromAi(questionText) {
        const aiAnswer = await ApiService.generateAnswerFromQuestion(questionText);
        if (!aiAnswer) return [];
        const answerLetter = this._parseAnswerLetter(aiAnswer);
        const answerText = this._parseAnswerText(aiAnswer);
        return [{
            question: questionText,
            answer: aiAnswer,
            answerLetter,
            answerText,
            aiFallback: true,
            sources: []
        }];
    },

    /**
     * Fluxo 1: Processar itens extraídos da página (Botão Extrair)
     */
    async processExtractedItems(items) {
        const refinedData = [];
        for (const item of items) {
            // item tem { question, answer }
            const refined = await ApiService.refineWithGroq(item);
            if (refined) {
                refinedData.push(refined);
            }
        }
        return refinedData;
    },

    /**
     * Fluxo 2: Buscar no Google e refinar (Botão Buscar)
     * OTIMIZADO: Reduz chamadas à API para evitar rate limit
     */
    async refineFromResults(questionText, results, originalQuestionWithOptions = '', onStatus = null) {
        if (!results || results.length === 0) return [];
        const answers = [];
        const sources = [];
        const topResults = results.slice(0, 5); // Aumentado para 5 resultados
        const originalOptions = this._extractOptionsFromQuestion(originalQuestionWithOptions);
        const originalOptionsMap = this._buildOptionsMap(originalQuestionWithOptions);
        const hasOptions = originalOptions && originalOptions.length >= 2;

        const domainWeights = {
            'qconcursos.com': 2.5,
            'qconcursos.com.br': 2.5,
            'passeidireto.com': 1.4,
            'studocu.com': 1.3,
            'brainly.com.br': 0.9,
            'brainly.com': 0.9
        };

        const getDomainWeight = (link) => {
            try {
                const host = new URL(link).hostname.replace(/^www\./, '').toLowerCase();
                return domainWeights[host] || 1.0;
            } catch {
                return 1.0;
            }
        };

        const hasGabaritoSignal = (text) => {
            if (!text) return false;
            return /gabarito|alternativa\s+correta|resposta\s+correta|letra\s*[A-E]\b|correta\s*[:\-]/i.test(text);
        };

        for (const result of topResults) {
            try {
                const snippet = result.snippet || '';
                const title = result.title || '';
                const fullContent = `${title}. ${snippet}`;
                const pageText = await ApiService.fetchPageText(result.link);
                const combinedContent = pageText ? `${fullContent}\n\n${pageText}` : fullContent;

                console.log(`SearchService: Analisando fonte: ${title.substring(0, 50)}...`);
                console.log(`SearchService: Snippet (${snippet.length} chars): ${snippet.substring(0, 150)}...`);

                if (snippet.length < 20) {
                    console.log('SearchService: Snippet muito curto, pulando...');
                    continue;
                }

                if (hasOptions) {
                    const sourceOptions = this._extractOptionsFromQuestion(pageText || '') || [];
                    const matchByOptions = this._optionsMatch(originalOptions, sourceOptions);
                    const matchByFreeText = this._optionsMatchInFreeText(originalOptions, combinedContent);
                    if (!matchByOptions && !matchByFreeText) {
                        console.log('SearchService: Fonte não corresponde às alternativas, pulando...');
                        continue;
                    }
                }

                // SIMPLIFICADO: Usar apenas 1 chamada para extrair resposta diretamente
                if (typeof onStatus === 'function') {
                    onStatus(`Analisando fonte ${sources.length + 1}...`);
                }

                const questionForInference = originalQuestionWithOptions || questionText;
                const answerText = await ApiService.inferAnswerFromEvidence(questionForInference, combinedContent);
                
                console.log(`SearchService: Resposta da IA: ${answerText?.substring(0, 100) || 'null'}`);
                
                if (answerText && answerText.length > 5) {
                    let letter = this._parseAnswerLetter(answerText);
                    const answerBody = this._parseAnswerText(answerText);

                    if (!letter && answerBody && hasOptions) {
                        letter = this._findLetterByAnswerText(answerBody, originalOptionsMap);
                    }

                    if (/[IVX]+\s*[-–]\s*[A-E]/i.test(answerText)) {
                        letter = null;
                    }

                    if (!letter) {
                        console.log('SearchService: Sem letra confiável, pulando fonte.');
                        continue;
                    }

                    const baseWeight = getDomainWeight(result.link);
                    const gabaritoBoost = hasGabaritoSignal(combinedContent) ? 0.6 : 0;
                    const weight = baseWeight + gabaritoBoost;

                    sources.push({
                        title,
                        link: result.link,
                        answer: answerText,
                        letter,
                        weight
                    });

                    console.log(`SearchService: ✓ Fonte válida! Letra: ${letter || 'N/A'}, Resposta: ${answerText.substring(0, 80)}...`);

                    if (sources.length >= 2) {
                        const letterScores = {};
                        sources.forEach(s => {
                            if (!s.letter) return;
                            letterScores[s.letter] = (letterScores[s.letter] || 0) + (s.weight || 1);
                        });
                        if (Object.values(letterScores).some(score => score >= 3.0)) {
                            console.log('SearchService: Peso suficiente, parando busca.');
                            break;
                        }
                    }
                }
            } catch (error) {
                console.error('SearchService Error:', error);
            }
        }

        if (sources.length === 0) {
            console.log('SearchService: Nenhuma resposta encontrada nas fontes.');
            return [];
        }

        // Votação simples por letra (quando possível)
        const voteScore = {};
        for (const src of sources) {
            if (!src.letter) continue;
            voteScore[src.letter] = (voteScore[src.letter] || 0) + (src.weight || 1);
        }

        let bestLetter = null;
        let bestScore = 0;
        Object.entries(voteScore).forEach(([letter, score]) => {
            if (score > bestScore) {
                bestScore = score;
                bestLetter = letter;
            }
        });

        console.log('SearchService: Votação ponderada:', voteScore, '| Melhor:', bestLetter);

        let finalAnswer = sources[0]?.answer || '';
        if (bestLetter) {
            const match = sources.find(s => s.letter === bestLetter && s.answer);
            if (match) finalAnswer = match.answer;
        }

        const finalAnswerLetter = this._parseAnswerLetter(finalAnswer) || bestLetter || null;
        const finalAnswerText = this._parseAnswerText(finalAnswer) || (finalAnswerLetter ? originalOptionsMap[finalAnswerLetter] || '' : '');

        return [{
            question: questionText,
            answer: finalAnswer,
            answerLetter: finalAnswerLetter,
            answerText: finalAnswerText,
            sources,
            bestLetter,
            title: sources[0]?.title || 'Questão Encontrada',
            aiFallback: false
        }];
    },

    async searchAndRefine(questionText, originalQuestionWithOptions = '') {
        // 1. Busca no Google
        const results = await ApiService.searchWithSerper(questionText);
        if (!results || results.length === 0) {
            return this.answerFromAi(questionText);
        }

        const refined = await this.refineFromResults(questionText, results, originalQuestionWithOptions);
        if (!refined || refined.length === 0) {
            return this.answerFromAi(questionText);
        }
        return refined;
    }
};
