import { ApiService } from './ApiService.js';

/**
 * SearchService.js
 * Coordena os fluxos de Extração (direta) e Busca (Google).
 */
export const SearchService = {
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
     * Equivalente ao extractAnswersFromSearch do legado
     */
    async refineFromResults(questionText, results) {
        if (!results || results.length === 0) return [];
        const answers = [];
        const sources = [];
        const topResults = results.slice(0, 5); // Aumentar para 5 resultados

        for (const result of topResults) {
            try {
                const snippet = result.snippet || '';
                const title = result.title || '';
                const fullContent = `${title}. ${snippet}`;

                if (snippet.length < 30) continue;

                // NOVA VERIFICACAO: Checar se a fonte corresponde a mesma questao
                const isMatch = await ApiService.verifyQuestionMatch(questionText, fullContent);

                if (!isMatch) {
                    console.log('SearchService: Fonte NAO corresponde a questao. Tentando proximo...');
                    continue;
                }

                // Usar Groq para analisar o snippet
                // O refineWithGroq espera um objeto {question, answer} onde answer é o texto da fonte
                const refined = await ApiService.refineWithGroq({
                    question: questionText,
                    answer: fullContent
                });

                if (refined) {
                    const answerText = refined.answer || '';
                    const letterMatch = answerText.match(/\b(?:alternativa\s*)?([A-E])\b/i);
                    const letter = letterMatch ? letterMatch[1].toUpperCase() : null;

                    sources.push({
                        title,
                        link: result.link,
                        answer: answerText,
                        letter
                    });
                    answers.push(refined);
                }
            } catch (e) {
                console.error('SearchService Error:', e);
            }
        }

        if (answers.length === 0) {
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

        let finalAnswer = answers[0]?.answer || '';
        if (bestLetter) {
            const match = sources.find(s => s.letter === bestLetter && s.answer);
            if (match) finalAnswer = match.answer;
        }

        return [{
            question: answers[0].question,
            answer: finalAnswer,
            sources,
            bestLetter,
            title: answers[0].title,
            aiFallback: false
        }];
    },

    async searchAndRefine(questionText) {
        // 1. Busca no Google
        const results = await ApiService.searchWithSerper(questionText);
        if (!results || results.length === 0) {
            return this.answerFromAi(questionText);
        }

        const refined = await this.refineFromResults(questionText, results);
        if (!refined || refined.length === 0) {
            return this.answerFromAi(questionText);
        }
        return refined;
    }
};
