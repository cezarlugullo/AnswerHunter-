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
    async searchOnly(questionText) {
        return ApiService.searchWithSerper(questionText);
    },

    async answerFromAi(questionText) {
        const aiAnswer = await ApiService.generateAnswerFromQuestion(questionText);
        if (!aiAnswer) return [];
        return [{
            question: questionText,
            answer: aiAnswer,
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

        for (const result of topResults) {
            try {
                const snippet = result.snippet || '';
                const title = result.title || '';
                const fullContent = `${title}. ${snippet}`;

                console.log(`SearchService: Analisando fonte: ${title.substring(0, 50)}...`);
                console.log(`SearchService: Snippet (${snippet.length} chars): ${snippet.substring(0, 150)}...`);

                if (snippet.length < 20) {
                    console.log('SearchService: Snippet muito curto, pulando...');
                    continue;
                }

                // SIMPLIFICADO: Usar apenas 1 chamada para extrair resposta diretamente
                if (typeof onStatus === 'function') {
                    onStatus(`Analisando fonte ${sources.length + 1}...`);
                }
                
                const answerText = await ApiService.extractAnswerFromSource(questionText, fullContent);
                
                console.log(`SearchService: Resposta da IA: ${answerText?.substring(0, 100) || 'null'}`);
                
                if (answerText && answerText.length > 5) {
                    // Extrair letra da resposta de várias formas
                    let letter = null;
                    
                    // Padrão 1: "Letra A", "Alternativa B", etc
                    let letterMatch = answerText.match(/(?:letra|alternativa)\s*([A-E])\b/i);
                    if (letterMatch) {
                        letter = letterMatch[1].toUpperCase();
                    }
                    
                    // Padrão 2: Letra isolada no início
                    if (!letter) {
                        letterMatch = answerText.match(/^([A-E])\s*[\)\.\-:]/i);
                        if (letterMatch) letter = letterMatch[1].toUpperCase();
                    }
                    
                    // Padrão 3: "correta é a A", "resposta: B"
                    if (!letter) {
                        letterMatch = answerText.match(/(?:correta|resposta)[^A-E]*([A-E])\b/i);
                        if (letterMatch) letter = letterMatch[1].toUpperCase();
                    }

                    // Para respostas combinadas como "I-D; II-B", não atribui letra única
                    if (/[IVX]+\s*[-–]\s*[A-E]/i.test(answerText)) {
                        letter = null;
                    }

                    sources.push({
                        title,
                        link: result.link,
                        answer: answerText,
                        letter
                    });

                    console.log(`SearchService: ✓ Fonte válida! Letra: ${letter || 'N/A'}, Resposta: ${answerText.substring(0, 80)}...`);

                    // Se já temos 2 fontes com a mesma letra, podemos parar
                    if (sources.length >= 2) {
                        const letters = sources.filter(s => s.letter).map(s => s.letter);
                        const letterCounts = {};
                        letters.forEach(l => letterCounts[l] = (letterCounts[l] || 0) + 1);
                        if (Object.values(letterCounts).some(c => c >= 2)) {
                            console.log('SearchService: 2 fontes concordam, parando busca.');
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
        const voteCount = {};
        for (const src of sources) {
            if (!src.letter) continue;
            voteCount[src.letter] = (voteCount[src.letter] || 0) + 1;
        }

        let bestLetter = null;
        let bestCount = 0;
        Object.entries(voteCount).forEach(([letter, count]) => {
            if (count > bestCount) {
                bestCount = count;
                bestLetter = letter;
            }
        });

        console.log('SearchService: Votação por letra:', voteCount, '| Melhor:', bestLetter);

        let finalAnswer = sources[0]?.answer || '';
        if (bestLetter) {
            const match = sources.find(s => s.letter === bestLetter && s.answer);
            if (match) finalAnswer = match.answer;
        }

        return [{
            question: questionText,
            answer: finalAnswer,
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
