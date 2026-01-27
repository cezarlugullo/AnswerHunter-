import { ApiService } from './ApiService.js';

/**
 * SearchService.js
 * Coordena o processo de busca e extração de respostas.
 */
export const SearchService = {

    /**
     * Limpa a pergunta para busca eficiente no Google
     */
    cleanQuery(query) {
        if (!query) return '';
        let clean = query
            .replace(/[^\w\sÀ-ú.,?!:;()-]/g, ' ') // Remove chars especiais estranhos
            .replace(/\s+/g, ' ')
            .trim();

        // Tentar extrair apenas a pergunta (até a interrogação de preferência)
        if (clean.includes('?')) {
            const questionEnd = clean.indexOf('?');
            const questionText = clean.substring(0, questionEnd + 1);
            if (questionText.length > 20) { // Evita cortar se for muito curto
                clean = questionText;
            }
        }

        // Remover alternativas A, B, C, D, E do final
        clean = clean
            .replace(/\s+[A-E]\s+[A-Za-zÀ-ú][^?]*$/g, '')
            .replace(/\s+[a-e]\)\s+[A-Za-zÀ-ú][^?]*$/g, '')
            .trim();

        return clean.substring(0, 300); // Limite para URL do Google
    },

    /**
     * Tenta extrair opções localmente sem IA (regex)
     */
    extractOptionsLocally(sourceContent) {
        if (!sourceContent) return null;
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const normalized = sourceContent.replace(/\r\n/g, '\n');
        const options = [];

        // Pattern multi-linhas: A) Texto
        const altStartRe = /(?:^|\n)([A-E])\s*[\)\.\-:]\s*([^\n]+)/gi;
        let m;
        while ((m = altStartRe.exec(normalized)) !== null) {
            options.push({ letter: m[1].toUpperCase(), body: clean(m[2]) });
        }

        if (options.length < 2) {
            // Pattern inline: A) Texto B) Texto
            const inlinePattern = /(^|[\s])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:\s)[A-E]\s*[\)\.\-:]|$)/gi;
            let m2;
            while ((m2 = inlinePattern.exec(normalized)) !== null) {
                options.push({ letter: m2[2].toUpperCase(), body: clean(m2[3]) });
            }
        }

        if (options.length >= 2) {
            return options.map(o => `${o.letter}) ${o.body}`).join('\n');
        }
        return null;
    },

    /**
     * Fluxo principal de busca e refinamento
     */
    async searchAndRefine(questionText) {
        const cleanQ = this.cleanQuery(questionText);
        const answers = [];

        // 1. Busca no Google (Serper)
        console.log('SearchService: Buscando:', cleanQ);
        let results = await ApiService.searchGoogle(cleanQ);

        if (!results || results.length === 0) {
            // Tentativa com filtro educacional se falhar
            console.log('SearchService: Tentando com site:brainly.com.br OR site:passeidireto.com');
            results = await ApiService.searchGoogle(`${cleanQ} site:brainly.com.br OR site:passeidireto.com`);
        }

        if (!results || results.length === 0) return [];

        // 2. Processar Resultados (Top 5)
        const topResults = results.slice(0, 5);

        for (const result of topResults) {
            try {
                const snippet = result.snippet || '';
                const title = result.title || '';
                const fullContent = `${title}. ${snippet}`;

                if (snippet.length < 30) continue;

                // A. Verificar Correspondência
                const isMatch = await ApiService.verifyMatch(questionText, fullContent);
                if (!isMatch) {
                    console.log(`SearchService: Skip "${title}" - não corresponde.`);
                    continue;
                }

                // B. Extrair Opções (Local ou IA)
                const hasOptionsInOriginal = /[A-E]\s*[\)\.]\s*\S+/i.test(questionText);
                let options = null;

                if (!hasOptionsInOriginal) {
                    options = this.extractOptionsLocally(fullContent);
                    if (!options) {
                        options = await ApiService.extractOptions(fullContent);
                    }
                }

                // C. Extrair Resposta Correta
                const answer = await ApiService.extractAnswer(questionText, fullContent);

                if (answer) {
                    let finalQuestion = questionText;
                    if (!hasOptionsInOriginal && options) {
                        finalQuestion += '\n\n' + options;
                    }

                    answers.push({
                        question: finalQuestion,
                        answer: answer,
                        source: result.link,
                        title: title
                    });

                    break; // Para no primeiro sucesso
                }

            } catch (err) {
                console.error('SearchService: Erro no loop de resultados:', err);
            }
        }

        return answers;
    }
};
