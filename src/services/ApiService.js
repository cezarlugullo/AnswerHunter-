import { SettingsModel } from '../models/SettingsModel.js';

/**
 * ApiService.js
 * Gerencia todas as chamadas externas (Groq, Serper) com lógica robusta recuperada.
 */
export const ApiService = {
    lastGroqCallAt: 0,

    async _getSettings() {
        return await SettingsModel.getSettings();
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
     * Wrapper para fetch com headers comuns
     */
    async _fetch(url, options) {
        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) {
                    return await response.json();
                }

                if (response.status === 429 && attempt < maxRetries) {
                    const retryAfter = parseFloat(response.headers.get('retry-after') || '0');
                    const backoffMs = Math.max(800 * (attempt + 1), retryAfter * 1000);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    continue;
                }

                throw new Error(`HTTP Error ${response.status}`);
            } catch (error) {
                if (attempt < maxRetries) {
                    const jitter = 200 + Math.random() * 300;
                    await new Promise(resolve => setTimeout(resolve, jitter));
                    continue;
                }
                console.error(`ApiService Fetch Error (${url}):`, error);
                throw error;
            }
        }
    },

    /**
     * Valida se o texto é uma questão válida usando Groq
     */
    async validateQuestion(questionText) {
        if (!questionText) return false;
        await this._waitForRateLimit();
        const { groqApiUrl, groqApiKey, groqModelFast } = await this._getSettings();

        const prompt = `Voce deve validar se o texto abaixo e UMA questao limpa e coerente.\n\nRegras:\n- Deve ser uma pergunta/questao de prova ou exercicio.\n- Pode ter alternativas (A, B, C, D, E).\n- NAO pode conter menus, botoes, avisos, instrucoes de site, ou texto sem relacao.\n- Se estiver poluida, misturando outra questao, ou sem sentido, responda INVALIDO.\n\nTexto:\n${questionText}\n\nResponda apenas: OK ou INVALIDO.`;

        try {
            const data = await this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelFast,
                    messages: [
                        { role: 'system', content: 'Responda apenas OK ou INVALIDO.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 10
                })
            });

            const content = data.choices?.[0]?.message?.content?.trim().toUpperCase() || '';
            if (content.includes('INVALIDO')) return false;
            if (content.includes('OK')) return true;
            return true;
        } catch (error) {
            console.error('Erro validacao Groq:', error);
            return true;
        }
    },

    /**
     * Busca no Serper (Google) com fallback para sites educacionais
     * Lógica exata do searchWithSerper legado
     */
    async searchWithSerper(query) {
        const { serperApiUrl, serperApiKey } = await this._getSettings();

        // 1. Limpeza da Query (cleanQueryForSearch interna)
        let cleanQuery = query
            .replace(/^(?:Questão|Pergunta|Atividade|Exercício)\s*\d+[\s.:-]*/gi, '')
            .replace(/Marcar para revisão/gi, '')
            .replace(/\s*(Responda|O que você achou|Relatar problema|Voltar|Avançar|Menu|Finalizar)[\s\S]*/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (cleanQuery.includes('?')) {
            const questionEnd = cleanQuery.indexOf('?');
            const questionText = cleanQuery.substring(0, questionEnd + 1).trim();
            if (questionText.length >= 30) cleanQuery = questionText;
        }

        cleanQuery = cleanQuery
            .replace(/\s+[A-E]\s+[A-Za-zÀ-ú][^?]*$/g, '')
            .replace(/\s+[A-E]\s*$/g, '')
            .trim();

        cleanQuery = cleanQuery.substring(0, 250); // Limite

        console.log(`AnswerHunter: Query limpa: "${cleanQuery}"`);

        const TOP_SITES = ['brainly.com.br', 'passeidireto.com', 'studocu.com'];
        const siteFilter = TOP_SITES.map(s => `site:${s}`).join(' OR ');

        try {
            // Primeiro: buscar SEM filtro
            console.log(`AnswerHunter: Buscando resposta...`);
            let data = await this._fetch(serperApiUrl, {
                method: 'POST',
                headers: {
                    'X-API-KEY': serperApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q: cleanQuery + ' resposta correta',
                    gl: 'br',
                    hl: 'pt-br',
                    num: 8
                })
            });

            if (data.organic && data.organic.length > 0) {
                return data.organic;
            }

            // Fallback: com filtro
            console.log('AnswerHunter: Tentando com sites educacionais...');
            data = await this._fetch(serperApiUrl, {
                method: 'POST',
                headers: {
                    'X-API-KEY': serperApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q: cleanQuery + ' ' + siteFilter,
                    gl: 'br',
                    hl: 'pt-br',
                    num: 5
                })
            });

            return data.organic || [];
        } catch (e) {
            console.error('AnswerHunter: Erro na busca:', e);
            return [];
        }
    },

    /**
     * Verifica correspondência entre questão e fonte
     */
    async verifyQuestionMatch(originalQuestion, sourceContent) {
        await this._waitForRateLimit();
        const { groqApiUrl, groqApiKey, groqModelFast } = await this._getSettings();

        const prompt = `Voce deve verificar se o conteudo da FONTE corresponde a mesma questao do CLIENTE.

=== QUESTAO DO CLIENTE ===
${originalQuestion.substring(0, 500)}

=== CONTEUDO DA FONTE ===
${sourceContent.substring(0, 500)}

REGRAS:
- Compare o TEMA/ASSUNTO das duas questoes
- Se forem sobre o MESMO assunto, responda: CORRESPONDE
- Se forem sobre assuntos DIFERENTES, responda: NAO_CORRESPONDE
- Exemplos de NAO correspondencia:
  * Cliente pergunta sobre ergonomia, fonte fala sobre regioes geograficas
  * Cliente pergunta sobre biologia, fonte fala sobre matematica

Responda APENAS: CORRESPONDE ou NAO_CORRESPONDE`;

        try {
            const data = await this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelFast,
                    messages: [
                        { role: 'system', content: 'Voce verifica se duas questoes sao sobre o mesmo assunto. Responda apenas CORRESPONDE ou NAO_CORRESPONDE.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 20
                })
            });

            const content = data.choices?.[0]?.message?.content?.trim().toUpperCase() || '';
            console.log('AnswerHunter: Verificacao de correspondencia:', content);
            return content.includes('CORRESPONDE') && !content.includes('NAO_CORRESPONDE');
        } catch (error) {
            console.error('Erro ao verificar correspondencia:', error);
            return true;
        }
    },

    /**
     * Extrai Opções Localmente (Regex) - Helper interno usado no refinamento
     */
    _extractOptionsLocally(sourceContent) {
        if (!sourceContent) return null;
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const normalized = sourceContent.replace(/\r\n/g, '\n');

        const byLines = () => {
            const lines = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean);
            const options = [];
            const altStartRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
            let current = null;

            for (const line of lines) {
                const m = line.match(altStartRe);
                if (m) {
                    if (current) options.push(current);
                    current = { letter: m[1].toUpperCase(), body: clean(m[2]) };
                } else if (current) {
                    current.body = clean(`${current.body} ${line}`);
                }
            }
            if (current) options.push(current);
            return options.length >= 2 ? options : null;
        };

        const byInline = () => {
            const options = [];
            const inlinePattern = /(^|[\s])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:\s)[A-E]\s*[\)\.\-:]|$)/gi;
            let m;
            while ((m = inlinePattern.exec(normalized)) !== null) {
                const letter = m[2].toUpperCase();
                const body = clean(m[3]);
                if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
        };

        const byPlain = () => {
            const options = [];
            const plainAltPattern = /(?:^|[.!?]\s+)([A-E])\s+([A-ZÀ-Ú][^]*?)(?=(?:[.!?]\s+)[A-E]\s+[A-ZÀ-Ú]|$)/g;
            let m;
            while ((m = plainAltPattern.exec(normalized)) !== null) {
                const letter = m[1].toUpperCase();
                const body = clean(m[2].replace(/\s+[.!?]\s*$/, ''));
                if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
        };

        const found = byLines() || byInline() || byPlain();
        if (!found) return null;

        return found.map(o => `${o.letter}) ${o.body}`).join('\n');
    },

    /**
     * Prompt 1: Extrair opções (IA)
     */
    async extractOptionsFromSource(sourceContent) {
        await this._waitForRateLimit();
        const { groqApiUrl, groqApiKey, groqModelFast } = await this._getSettings();

        const prompt = `Voce deve extrair APENAS as alternativas (opcoes A, B, C, D, E) do texto abaixo.

TEXTO DA FONTE:
${sourceContent}

REGRAS:
- Extraia APENAS as alternativas no formato: A) texto, B) texto, etc.
- Se nao houver alternativas claras, responda: SEM_OPCOES
- NAO invente alternativas
- NAO inclua o enunciado da pergunta

FORMATO DE SAIDA (apenas as alternativas):
A) [texto da alternativa A]
B) [texto da alternativa B]
C) [texto da alternativa C]
D) [texto da alternativa D]
E) [texto da alternativa E se houver]`;

        try {
            const data = await this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelFast,
                    messages: [
                        { role: 'system', content: 'Voce extrai apenas alternativas de questoes. Responda APENAS com as alternativas no formato A) B) C) D) E) ou SEM_OPCOES.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 500
                })
            });

            const content = data.choices?.[0]?.message?.content?.trim() || '';
            if (content.includes('SEM_OPCOES')) return null;
            return content;
        } catch (error) {
            console.error('Erro ao extrair opcoes:', error);
            return null;
        }
    },

    /**
     * Prompt 2: Identificar a resposta correta (IA)
     */
    async extractAnswerFromSource(originalQuestion, sourceContent) {
        await this._waitForRateLimit();
        const { groqApiUrl, groqApiKey, groqModelAnswer } = await this._getSettings();

        const prompt = `Voce deve identificar APENAS a RESPOSTA CORRETA para a questao abaixo, baseado no conteudo da fonte.

=== QUESTAO DO CLIENTE ===
${originalQuestion}

=== CONTEUDO DA FONTE ===
${sourceContent}

REGRAS CRITICAS:
1. Procure por indicacoes como: "Gab", "Gabarito", "Resposta correta", "alternativa correta e", "A resposta e"
2. Para questoes de multipla escolha: responda APENAS a LETRA (A, B, C, D ou E) seguida do texto
3. Para assercoes (I, II, III): identifique quais estao corretas
4. Para questoes abertas: responda o conteudo da resposta
5. NUNCA invente uma resposta - extraia apenas o que esta indicado na fonte
6. Se nao encontrar resposta clara, responda: SEM_RESPOSTA

FORMATO DE SAIDA:
[Apenas a resposta, ex: "Alternativa B: texto" ou "I e III estao corretas" ou resposta direta]`;

        try {
            const data = await this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelAnswer,
                    messages: [
                        { role: 'system', content: 'Voce identifica a resposta correta de questoes. Procure por indicacoes de gabarito. Responda APENAS a resposta encontrada, nunca invente.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 300
                })
            });

            const content = data.choices?.[0]?.message?.content?.trim() || '';
            if (content.includes('SEM_RESPOSTA') || content.includes('INVALIDO')) return null;
            return content;
        } catch (error) {
            console.error('Erro ao extrair resposta:', error);
            return null;
        }
    },

    /**
     * Função principal de refinamento (3-Passos)
     */
    async refineWithGroq(item) {
        console.log('AnswerHunter: Iniciando refinamento com 3 prompts...');
        const originalQuestion = item.question;
        const hasOptionsInOriginal = /[A-E]\s*[\)\.]\s*\S+/i.test(originalQuestion);

        let options = null;
        let optionsPromise = null;
        if (!hasOptionsInOriginal && item.answer && item.answer.length > 30) {
            options = this._extractOptionsLocally(item.answer);
            if (!options) {
                optionsPromise = this.extractOptionsFromSource(item.answer);
            }
        }

        const answerPromise = this.extractAnswerFromSource(originalQuestion, item.answer);
        const [answer, optionsFromGroq] = await Promise.all([
            answerPromise,
            optionsPromise ? optionsPromise : Promise.resolve(null)
        ]);

        if (!options && optionsFromGroq) options = optionsFromGroq;
        console.log('AnswerHunter: Resposta identificada:', answer ? 'Sim' : 'Nao');

        if (!answer) {
            return null;
        }

        let finalQuestion = originalQuestion;
        if (!hasOptionsInOriginal && options) {
            finalQuestion = originalQuestion + '\n' + options;
        }

        return {
            question: finalQuestion.trim(),
            answer: answer.trim()
        };
    }

    ,
    /**
     * Fallback: gerar resposta diretamente pela IA quando não houver fontes
     */
    async generateAnswerFromQuestion(questionText) {
        if (!questionText) return null;
        await this._waitForRateLimit();
        const { groqApiUrl, groqApiKey, groqModelFallback } = await this._getSettings();

        const prompt = `Responda a questão abaixo de forma direta e objetiva.\n\nQUESTÃO:\n${questionText}\n\nREGRAS:\n- Se for múltipla escolha, responda com a alternativa correta (letra e texto, se possível).\n- Se for aberta, responda em 1 a 3 frases.\n- Não invente citações.`;

        try {
            const data = await this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelFallback,
                    messages: [
                        { role: 'system', content: 'Você é um assistente que responde questões com objetividade.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.2,
                    max_tokens: 300
                })
            });

            const content = data.choices?.[0]?.message?.content?.trim() || '';
            return content || null;
        } catch (error) {
            console.error('Erro ao gerar resposta direta:', error);
            return null;
        }
    }
};
