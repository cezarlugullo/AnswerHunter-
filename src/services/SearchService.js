import { ApiService } from './ApiService.js';

/**
 * SearchService.js
 * Coordena os fluxos de Extração (direta) e Busca (Google).
 */
export const SearchService = {

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
    async searchAndRefine(questionText) {
        // 1. Busca no Google
        const results = await ApiService.searchWithSerper(questionText);
        if (!results || results.length === 0) return [];

        const answers = [];
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
                    refined.source = result.link;
                    refined.title = title; // Mantemos o titulo para display se quiser
                    answers.push(refined);
                    break; // Pegar so a primeira resposta valida (comportamento legado)
                }
            } catch (e) {
                console.error('SearchService Error:', e);
            }
        }

        return answers;
    }
};
