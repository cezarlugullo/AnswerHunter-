const fs = require('fs');

let s = fs.readFileSync('src/services/ApiService.js', 'utf8');
const sNormalized = s.replace(/\r\n/g, '\n');

// We know the second occurrence is near "Prompt 1: Extract options (AI)"
const token = '    /**\n     * Prompt 1: Extract options (AI)';
const endToken = '    /**\n     * Search on Serper (Google) with fallback to educational sites';

const lastStartIndex = sNormalized.lastIndexOf(token);
const lastEndIndex = sNormalized.lastIndexOf(endToken);

if (lastStartIndex > -1 && lastEndIndex > -1 && lastEndIndex > lastStartIndex) {
    const newCode = `    /**
     * Prompt 1: Extract options (AI)
     * Uses FAST model (1000 t/s) - simple extraction task
     */
    async extractOptionsFromSource(sourceContent) {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelFast } = settings;

        const prompt = \`Voce deve extrair APENAS as alternativas (opcoes A, B, C, D, E) do texto abaixo.

TEXTO DA FONTE:
\${sourceContent}

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
E) [texto da alternativa E se houver]\`;

        const systemMsg = 'Voce extrai apenas alternativas de questoes. Responda APENAS com as alternativas no formato A) B) C) D) E) ou SEM_OPCOES.';

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                return await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.1, max_tokens: 500, model: settings.geminiModel || 'gemini-2.5-flash' });
            } catch (e) {
                console.warn('AnswerHunter: Gemini extractOptionsFromSource error:', e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                const opts = Object.assign({}, { temperature: 0.1, max_tokens: 500, model: 'gemini-2.5-flash' });
                opts.model = settings.openrouterModelSmart || 'deepseek/deepseek-r1:free';
                return await this._callOpenRouter([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], opts);
            } catch (e) {
                console.warn('AnswerHunter: OpenRouter logic error:', e?.message || e);
                return null;
            }
        };

        const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': \`Bearer \${groqApiKey}\`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: groqModelFast,
                        messages: [
                            { role: 'system', content: systemMsg },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 500
                    })
                }));
                return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
                console.warn('AnswerHunter: Groq extractOptionsFromSource error:', e?.message || e);
                return null;
            }
        };

        try {
            const primary = settings.primaryProvider || 'groq';
            let content = null;
            if (primary === 'openrouter') {
                content = await tryOpenRouter();
                if (!content) content = await tryGroq();
                if (!content) content = await tryGemini();
            } else if (primary === 'gemini') {
                content = await tryGemini();
                if (!content) content = await tryGroq();
                if (!content) content = await tryOpenRouter();
            } else {
                content = await tryGroq();
                if (!content) content = await tryOpenRouter();
                if (!content) content = await tryGemini();
            }

            if (!content || content.includes('SEM_OPCOES')) return null;
            return content;
        } catch (error) {
            console.error('Erro ao extrair opcoes:', error);
            return null;
        }
    },

`;
    const updated = sNormalized.substring(0, lastStartIndex) + newCode + sNormalized.substring(lastEndIndex);
    fs.writeFileSync('src/services/ApiService.js', updated);
    console.log('Fixed second corrupted block successfully.');
} else {
    console.log('Failed finding boundaries');
}
