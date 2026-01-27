import { SettingsModel } from '../models/SettingsModel.js';

/**
 * ApiService.js
 * Gerencia todas as chamadas externas (Groq, Serper, etc).
 */
export const ApiService = {
    lastGroqCallAt: 0,

    async _getSettings() {
        return await SettingsModel.getSettings();
    },

    /**
     * Wrapper genérico para fetch com tratamento de erro
     */
    async _fetch(url, options) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`ApiService Error (${url}):`, error);
            throw error; // Propagar para quem chamou tratar ou exibir na UI
        }
    },

    /**
     * Respeita o rate limit do Groq
     */
    async _waitForRateLimit() {
        const { minGroqIntervalMs } = await this._getSettings();
        const now = Date.now();
        if (now - this.lastGroqCallAt < minGroqIntervalMs) {
            await new Promise(resolve => setTimeout(resolve, minGroqIntervalMs));
        }
        this.lastGroqCallAt = Date.now();
    },

    /**
     * Valida se o texto é uma questão válida usando Groq
     */
    async validateQuestion(questionText) {
        if (!questionText) return false;
        await this._waitForRateLimit();
        const { groqApiUrl, groqApiKey, groqModel } = await this._getSettings();

        const prompt = `Voce deve validar se o texto abaixo e UMA questao limpa e coerente.\n\nRegras:\n- Deve ser uma pergunta/questao de prova ou exercicio.\n- Pode ter alternativas (A, B, C, D, E).\n- NAO pode conter menus, botoes, avisos, instrucoes de site, ou texto sem relacao.\n- Se estiver poluida, misturando outra questao, ou sem sentido, responda INVALIDO.\n\nTexto:\n${questionText}\n\nResponda apenas: OK ou INVALIDO.`;

        try {
            const data = await this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModel, // Usa groq/compound
                    messages: [
                        { role: 'system', content: 'Responda apenas OK ou INVALIDO.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 10
                })
            });

            const content = data.choices?.[0]?.message?.content?.trim().toUpperCase() || '';
            return content.includes('OK') && !content.includes('INVALIDO');
        } catch (error) {
            console.error('validateQuestion failed:', error);
            return true; // Fail open (assumir válido se API falhar para não bloquear user)
        }
    },

    /**
     * Busca no Serper (Google)
     */
    async searchGoogle(query) {
        const { serperApiUrl, serperApiKey } = await this._getSettings();

        try {
            const data = await this._fetch(serperApiUrl, {
                method: 'POST',
                headers: {
                    'X-API-KEY': serperApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q: query,
                    num: 10,
                    gl: 'br',
                    hl: 'pt-br'
                })
            });
            return data.organic || [];
        } catch (error) {
            console.error('searchGoogle failed:', error);
            return [];
        }
    },

    // === REFINAMENTO AVANÇADO (3 PROMPTS) ===

    /**
     * Verifica se a fonte corresponde à questão original
     */
    async verifyMatch(originalQuestion, sourceContent) {
        await this._waitForRateLimit();
        const { groqApiUrl, groqApiKey, groqModel } = await this._getSettings();

        const prompt = `Voce deve verificar se o conteudo da FONTE corresponde a mesma questao do CLIENTE.
=== QUESTAO DO CLIENTE ===
${originalQuestion.substring(0, 500)}
=== CONTEUDO DA FONTE ===
${sourceContent.substring(0, 500)}
REGRAS:
- Compare o TEMA/ASSUNTO das duas questoes
- Se forem sobre o MESMO assunto, responda: CORRESPONDE
- Se forem sobre assuntos DIFERENTES, responda: NAO_CORRESPONDE
Responda APENAS: CORRESPONDE ou NAO_CORRESPONDE`;

        try {
            const data = await this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModel,
                    messages: [
                        { role: 'system', content: 'Responda apenas CORRESPONDE ou NAO_CORRESPONDE.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 20
                })
            });
            const content = data.choices?.[0]?.message?.content?.trim().toUpperCase() || '';
            return content.includes('CORRESPONDE') && !content.includes('NAO_CORRESPONDE');
        } catch (error) {
            return true; // Fail open
        }
    },

    /**
     * Extrai alternativas da fonte
     */
    async extractOptions(sourceContent) {
        await this._waitForRateLimit();
        const { groqApiUrl, groqApiKey, groqModel } = await this._getSettings();

        const prompt = `Voce deve extrair APENAS as alternativas (opcoes A, B, C, D, E) do texto abaixo.
TEXTO DA FONTE:
${sourceContent}
REGRAS:
- Extraia APENAS as alternativas no formato: A) texto, B) texto, etc.
- Se nao houver alternativas claras, responda: SEM_OPCOES
- NAO inclua o enunciado da pergunta
FORMATO DE SAIDA: A) [texto]\nB) [texto]`;

        try {
            const data = await this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModel,
                    messages: [
                        { role: 'system', content: 'Responda APENAS com as alternativas ou SEM_OPCOES.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 500
                })
            });
            const content = data.choices?.[0]?.message?.content?.trim() || '';
            return content.includes('SEM_OPCOES') ? null : content;
        } catch {
            return null;
        }
    },

    /**
     * Identifica a resposta correta
     */
    async extractAnswer(originalQuestion, sourceContent) {
        await this._waitForRateLimit();
        const { groqApiUrl, groqApiKey, groqModel } = await this._getSettings();

        const prompt = `Voce deve identificar APENAS a RESPOSTA CORRETA.
=== QUESTAO DO CLIENTE ===
${originalQuestion}
=== CONTEUDO DA FONTE ===
${sourceContent}
REGRAS:
1. Procure por indicacoes como: "Gab", "Gabarito", "Resposta correta"
2. Para multipla escolha: responda APENAS a LETRA e texto
3. Se nao encontrar, responda: SEM_RESPOSTA`;

        try {
            const data = await this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModel,
                    messages: [
                        { role: 'system', content: 'Responda APENAS a resposta encontrada ou SEM_RESPOSTA.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 300
                })
            });
            const content = data.choices?.[0]?.message?.content?.trim() || '';
            return (content.includes('SEM_RESPOSTA') || content.includes('INVALIDO')) ? null : content;
        } catch {
            return null;
        }
    }
};
