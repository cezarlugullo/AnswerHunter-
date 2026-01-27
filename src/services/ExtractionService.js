/**
 * ExtractionService.js
 * Funções injetadas para ler o DOM da página ativa
 */
export const ExtractionService = {

    /**
     * Função executada no contexto da página (via chrome.scripting)
     * Deve ser serializável (sem dependências externas)
     */
    extractQAContentScript: function () {
        // Helpers internos (precisam estar dentro da função injetada)
        const cleanText = (text) => {
            return (text || '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        };

        // 1. Tentar Schema.org (JSON-LD)
        try {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try {
                    const json = JSON.parse(script.innerText);
                    const items = Array.isArray(json) ? json : [json];

                    const qa = items.find(i =>
                        i['@type'] === 'QAPage' ||
                        i['@type'] === 'Quiz' ||
                        (i.mainEntity && (i.mainEntity['@type'] === 'Question'))
                    );

                    if (qa) {
                        const mainEntity = qa.mainEntity || qa; // As vezes é direto
                        if (mainEntity['@type'] === 'Question') {
                            return [{
                                type: 'schema',
                                question: cleanText(mainEntity.name || mainEntity.text),
                                answer: mainEntity.acceptedAnswer ? cleanText(mainEntity.acceptedAnswer.text) : null
                            }];
                        }
                    }
                } catch (e) { }
            }
        } catch (e) { }

        // 2. Heurística Visual (Melhor visível)
        // Mesma lógica do extractQuestionOnly do legado
        const scoreContainer = (el) => {
            let score = 0;
            const text = (el.innerText || '').substring(0, 1000); // Otimização

            // Sinais Fortes
            if (text.includes('?')) score += 6;
            if (/assinale|marque|indique|escolha|identifique|aponte/i.test(text)) score += 5;
            if (/Atividade|Quest|Exercicio|Pergunta|Enunciado/i.test(text)) score += 4;
            if (/[A-E]\)\s+|[A-E]\.\s+/i.test(text)) score += 4;

            // Sinais de UI (Classes)
            if (el.className && typeof el.className === 'string') {
                if (el.className.includes('question') || el.className.includes('pergunta')) score += 3;
            }

            // Penalidades
            if (text.length < 20) score -= 10;
            if (text.length > 5000) score -= 5; // Muito longo talvez seja a página toda

            return score;
        };

        // Buscar candidatos
        const candidates = [];
        const elements = document.querySelectorAll('div, section, article, p'); // Limitado para performance

        for (const el of elements) {
            if (!isVisible(el)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 200 || rect.height < 50) continue;

            const score = scoreContainer(el);
            if (score > 5) {
                candidates.push({ el, score, rect });
            }
        }

        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0) {
            // Retorna o texto do melhor candidato
            // Sanitização básica aqui dentro para evitar envio de lixo
            let raw = candidates[0].el.innerText || '';
            raw = raw.replace(/\bMarcar para revis(?:a|ã)o\b/gi, '');
            raw = raw.replace(/^\s*\d+\s*[-.)]?\s*/i, ''); // 1. ou 1)

            return [{
                type: 'heuristic',
                result: cleanText(raw)
            }];
        }

        return [];
    },

    /**
     * Obtém texto selecionado
     */
    getSelectionScript: function () {
        return window.getSelection().toString().trim();
    }
};
