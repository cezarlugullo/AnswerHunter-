import { SettingsModel } from '../models/SettingsModel.js';

/**
 * ApiService.js
 * Manages all external calls (Groq, Serper) with robust recovered logic.
 */
export const ApiService = {
    lastGroqCallAt: 0,
    _groqQueue: Promise.resolve(),
    // When Groq returns retry-after > 90s, the quota is depleted at hourly/daily level.
    // All subsequent Groq calls should fail fast instead of hanging for minutes.
    _groqQuotaExhaustedUntil: 0,

    /**
     * Call Gemini via its OpenAI-compatible endpoint.
     * Used as fallback when Groq quota is exhausted, or as primary when user selects Gemini.
     * @param {Array<{role:string,content:string}>} messages
     * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
     * @returns {Promise<string|null>} The assistant message content, or null on failure
     */
    async _callGemini(messages, opts = {}) {
        const settings = await this._getSettings();
        const { geminiApiKey, geminiApiUrl, geminiModel } = settings;
        if (!geminiApiKey) return null;

        const model = opts.model || geminiModel || 'gemini-2.5-flash';
        const baseUrl = (geminiApiUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
        const url = `${baseUrl}/openai/chat/completions`;

        const doCall = async (callModel) => {
            try {
                // Thinking models (gemini-2.5-pro, gemini-2.5-ultra) use "thinking tokens"
                // that count against max_tokens. With 600-700 the model exhausts the
                // budget on reasoning and returns empty content (finish=length).
                const isThinkingModel = /pro|ultra/i.test(callModel) && /2\.5/i.test(callModel);
                const effectiveMaxTokens = isThinkingModel
                    ? Math.max(opts.max_tokens ?? 700, 4096)
                    : (opts.max_tokens ?? 700);

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${geminiApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: callModel,
                        messages,
                        temperature: opts.temperature ?? 0.1,
                        max_tokens: effectiveMaxTokens
                    })
                });

                if (!response.ok) {
                    const errText = await response.text().catch(() => '');
                    console.warn(`AnswerHunter: Gemini HTTP ${response.status} (model=${callModel}): ${errText.slice(0, 200)}`);
                    return null;
                }

                const data = await response.json();
                const msg = data?.choices?.[0]?.message;
                // Thinking models (gemini-2.5-pro) may put content in reasoning_content
                let content = msg?.content?.trim() || '';
                if (!content && msg?.reasoning_content) {
                    content = String(msg.reasoning_content).trim();
                    console.log(`AnswerHunter: Gemini used reasoning_content (model=${callModel}, ${content.length} chars)`);
                }
                if (!content) {
                    // Log response structure for diagnostics
                    const msgKeys = msg ? Object.keys(msg).join(',') : 'no-message';
                    const finishReason = data?.choices?.[0]?.finish_reason || 'unknown';
                    console.warn(`AnswerHunter: Gemini empty content (model=${callModel}, finish=${finishReason}, msgKeys=[${msgKeys}])`);
                    return null;
                }
                console.log(`AnswerHunter: Gemini success (model=${callModel}, ${content.length} chars)`);
                return content;
            } catch (err) {
                console.warn(`AnswerHunter: Gemini error (model=${callModel}):`, err?.message || String(err));
                return null;
            }
        };

        // Primary attempt
        let result = await doCall(model);
        if (result) return result;

        // Auto-downgrade: if smart/pro model returned empty, retry with flash
        const flashModel = geminiModel || 'gemini-2.5-flash';
        if (model !== flashModel && /pro|ultra/i.test(model) && !opts._noDowngrade) {
            console.log(`AnswerHunter: Gemini auto-downgrade ${model} → ${flashModel}`);
            result = await doCall(flashModel);
            if (result) return result;
        }

        return null;
    },

    async _getSettings() {
        return await SettingsModel.getSettings();
    },

    /**
     * Returns true if user selected Gemini as the primary AI provider.
     */
    async _isGeminiPrimary() {
        const s = await this._getSettings();
        return s.primaryProvider === 'gemini' && !!s.geminiApiKey;
    },

    /**
     * Run multi-attempt Gemini consensus for MC inference.
     * @param {string} systemMsg - System prompt
     * @param {string} userPrompt - User prompt
     * @param {RegExp} letterPattern - Regex to extract letter
     * @param {{smart?:boolean}} opts
     * @returns {{votes:Object, responses:Object, winner:string|null, response:string|null}}
     */
    async _geminiConsensus(systemMsg, userPrompt, letterPattern, opts = {}) {
        const settings = await this._getSettings();
        const smartModel = opts.smart !== false
            ? (settings.geminiModelSmart || 'gemini-2.5-pro')
            : (settings.geminiModel || 'gemini-2.5-flash');
        const flashModel = settings.geminiModel || 'gemini-2.5-flash';
        const temps = [0.1, 0.4, 0.7];

        const runConsensusLoop = async (model, tempList) => {
            const votes = {};
            const responses = {};
            let nullCount = 0;

            for (const temp of tempList) {
                try {
                    const content = await this._callGemini([
                        { role: 'system', content: systemMsg },
                        { role: 'user', content: userPrompt }
                    ], { model, temperature: temp, max_tokens: 700, _noDowngrade: true });

                    if (!content) {
                        nullCount++;
                        continue;
                    }

                    if (content.length >= 3
                        && !/^(NAO_ENCONTRADO|SEM_RESPOSTA|INCONCLUSIVO)/i.test(content)) {
                        const m = content.match(letterPattern);
                        if (m) {
                            const letter = m[1].toUpperCase();
                            votes[letter] = (votes[letter] || 0) + 1;
                            if (!responses[letter] || content.length > responses[letter].length) {
                                responses[letter] = content;
                            }
                            if (votes[letter] >= 2) break; // early consensus
                        } else {
                            if (!responses['_noletter'] || content.length > responses['_noletter'].length) {
                                responses['_noletter'] = content;
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`AnswerHunter: Gemini consensus temp=${temp} model=${model} error:`, err?.message || err);
                    nullCount++;
                }
            }
            return { votes, responses, nullCount };
        };

        // Try with primary (smart) model
        let { votes, responses, nullCount } = await runConsensusLoop(smartModel, temps);

        // If smart model returned ALL nulls and it's different from flash, auto-downgrade
        if (nullCount >= temps.length && smartModel !== flashModel && /pro|ultra/i.test(smartModel)) {
            console.log(`AnswerHunter: Gemini consensus auto-downgrade ${smartModel} → ${flashModel}`);
            const fallback = await runConsensusLoop(flashModel, [0.1, 0.3]);
            votes = { ...votes, ...fallback.votes };
            // Merge responses keeping longest
            for (const [k, v] of Object.entries(fallback.responses)) {
                if (!responses[k] || v.length > responses[k].length) responses[k] = v;
            }
        }

        const entries = Object.entries(votes);
        if (entries.length > 0) {
            entries.sort((a, b) => b[1] - a[1]);
            const [winner] = entries[0];
            return { votes, responses, winner, response: responses[winner] };
        }
        if (responses['_noletter']) {
            return { votes, responses, winner: null, response: responses['_noletter'] };
        }
        return { votes, responses, winner: null, response: null };
    },

    /**
     * Run multi-attempt Groq consensus for MC inference.
     * @param {string} systemMsg - System prompt
     * @param {string} userPrompt - User prompt
     * @param {RegExp} letterPattern - Regex to extract letter
     * @param {{model?:string, temps?:number[]}} opts
     * @returns {{votes:Object, responses:Object, attempts:string[], winner:string|null, response:string|null}}
     */
    async _groqConsensus(systemMsg, userPrompt, letterPattern, opts = {}) {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey } = settings;
        const model = opts.model || settings.groqModelSmart || 'llama-3.3-70b-versatile';
        const temps = opts.temps || [0.07, 0.15, 0.24];
        const votes = {};
        const responses = {};
        const attempts = [];
        let noValidCount = 0;

        for (const temp of temps) {
            // Fast-fail check BEFORE each attempt — don't waste calls after exhaustion
            if (this._groqQuotaExhaustedUntil > Date.now()) {
                const waitMin = Math.ceil((this._groqQuotaExhaustedUntil - Date.now()) / 60000);
                console.warn(`AnswerHunter: Groq consensus skipping temp=${temp} — quota exhausted (~${waitMin}min left)`);
                break;
            }
            try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: 'system', content: systemMsg },
                            { role: 'user', content: userPrompt }
                        ],
                        temperature: temp,
                        max_tokens: 700
                    })
                }));

                const content = data?.choices?.[0]?.message?.content?.trim() || '';
                if (!content || content.length < 3 || /^(NAO_ENCONTRADO|SEM_RESPOSTA|INCONCLUSIVO)/i.test(content)) {
                    noValidCount += 1;
                    continue;
                }

                attempts.push(content);
                const m = content.match(letterPattern);
                if (m) {
                    const letter = m[1].toUpperCase();
                    votes[letter] = (votes[letter] || 0) + 1;
                    if (!responses[letter] || content.length > responses[letter].length) {
                        responses[letter] = content;
                    }
                    if (votes[letter] >= 2) break; // early consensus
                }
            } catch (err) {
                const errMsg = err?.message || String(err);
                console.warn(`AnswerHunter: Groq consensus error:`, errMsg);
                if (errMsg.includes('GROQ_QUOTA_EXHAUSTED')) break;
            }
        }

        const entries = Object.entries(votes);
        if (entries.length > 0) {
            entries.sort((a, b) => b[1] - a[1]);
            const [winner] = entries[0];
            return { votes, responses, attempts, winner, response: responses[winner] };
        }
        if (attempts.length > 0) {
            const longest = attempts.reduce((a, b) => a.length > b.length ? a : b);
            return { votes, responses, attempts, winner: null, response: longest };
        }
        return { votes, responses, attempts, winner: null, response: null };
    },

    /**
     * Respects Groq rate limit
     */
    async _waitForRateLimit() {
        const { minGroqIntervalMs } = await this._getSettings();
        const now = Date.now();
        const elapsed = now - this.lastGroqCallAt;
        const remaining = minGroqIntervalMs - elapsed;
        if (remaining > 0) {
            await new Promise(resolve => setTimeout(resolve, remaining));
        }
        this.lastGroqCallAt = Date.now();
    },
    /**
     * Queues Groq calls to avoid concurrency and respect rate limit
     */
    async _withGroqRateLimit(taskFn) {
        const run = async () => {
            // Fast-fail if we already know the quota is depleted
            if (this._groqQuotaExhaustedUntil > Date.now()) {
                const waitMin = Math.ceil((this._groqQuotaExhaustedUntil - Date.now()) / 60000);
                throw new Error(`GROQ_QUOTA_EXHAUSTED: quota resets in ~${waitMin}min`);
            }
            await this._waitForRateLimit();
            return taskFn();
        };
        const task = this._groqQueue.then(run, run);
        this._groqQueue = task.catch(() => { });
        return task;
    },

    /**
     * Wrapper for fetch with common headers and robust retry
     */
    async _fetch(url, options) {
        const maxRetries = 3;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) {
                    return await response.json();
                }

                if (response.status === 429) {
                    const retryAfter = parseFloat(response.headers.get('retry-after') || '0');

                    // If Groq says wait > 30s, the quota is approaching exhaustion.
                    // Flag it and fail immediately — do NOT waste retries.
                    if (retryAfter > 30) {
                        this._groqQuotaExhaustedUntil = Date.now() + retryAfter * 1000;
                        const waitMin = Math.ceil(retryAfter / 60);
                        console.warn(`AnswerHunter: Groq quota EXHAUSTED — retry-after=${retryAfter}s (~${waitMin}min). Skipping all Groq calls.`);
                        throw new Error(`GROQ_QUOTA_EXHAUSTED: retry-after=${retryAfter}s (~${waitMin}min)`);
                    }

                    // Short retry-after (< 30s): per-minute rate limit, wait once and retry
                    if (attempt < maxRetries && retryAfter > 0 && retryAfter <= 30) {
                        const backoffMs = Math.ceil(retryAfter * 1000) + 500;
                        console.log(`AnswerHunter: Rate limit 429, aguardando ${backoffMs}ms (retry-after=${retryAfter}s, tentativa ${attempt + 1}/${maxRetries})...`);
                        await new Promise(resolve => setTimeout(resolve, backoffMs));
                        continue;
                    }

                    // No retry-after or zero: flag as quota problem anyway
                    this._groqQuotaExhaustedUntil = Date.now() + 120000; // assume 2min
                    console.warn('AnswerHunter: Groq 429 without retry-after — assuming quota exhausted for 2min');
                    throw new Error('GROQ_QUOTA_EXHAUSTED: 429 without retry-after');
                }

                throw new Error(`HTTP Error ${response.status}`);
            } catch (error) {
                // Never retry quota-exhaustion — the flag is already set, retrying just wastes 429s
                const isQuotaError = error.message?.includes('GROQ_QUOTA_EXHAUSTED');
                if (attempt < maxRetries && !isQuotaError && !error.message?.includes('HTTP Error')) {
                    const jitter = 500 + Math.random() * 500;
                    await new Promise(resolve => setTimeout(resolve, jitter));
                    continue;
                }
                console.error(`ApiService Fetch Error (${url}):`, error);
                throw error;
            }
        }
    },

    _makeWebcacheUrl(url) {
        try {
            if (/webcache\.googleusercontent\.com\/search\?q=cache:/i.test(url)) return url;
            return `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
        } catch {
            return null;
        }
    },

    _makeJinaMirrorUrl(url) {
        try {
            if (!url) return null;
            // Reader/mirror fallback for pages that block extension fetch (403/429/CORS-like failures).
            const u = new URL(url);
            const hostAndPath = `${u.host}${u.pathname || '/'}${u.search || ''}${u.hash || ''}`;
            return `https://r.jina.ai/${u.protocol}//${hostAndPath}`;
        } catch {
            return null;
        }
    },

    _looksBlockedLikeContent(raw = '', targetUrl = '') {
        const text = String(raw || '').toLowerCase();
        if (!text) return false;
        const host = (() => {
            try { return new URL(targetUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
        })();

        const commonMarkers = [
            /verifying you are human/i,
            /ray id/i,
            /captcha/i,
            /cloudflare/i,
            /access denied/i,
            /forbidden/i,
            /datadome/i,
            /challenge/i,
            /httpservice\/retry\/enablejs/i
        ];
        const paywallMarkers = [
            /voce\s+esta\s+vendo\s+uma\s+previa/i,
            /documento\s+premium/i,
            /desbloqueie/i,
            /seja\s+premium/i,
            /limitation-blocked/i,
            /paywall-structure/i,
            /short-preview-version/i,
            /new-monetization-test-paywall/i,
            /filter\s*:\s*blur\(/i
        ];

        const hasCommon = commonMarkers.some((re) => re.test(text));
        const hasPaywall = paywallMarkers.some((re) => re.test(text));

        const hasReadablePreviewSignals = (() => {
            if (!hasPaywall) return false;
            // If preview still carries substantial educational content (question + alternatives),
            // treat as readable instead of blocked.
            const optionMatches = text.match(/(?:^|\s)[a-e]\s*[\)\.\-:]\s+/gim) || [];
            const hasQuestionLanguage = /\b(?:assinale|quest(?:ao|ão)|alternativa|afirmativa|aula\s+\d+)\b/i.test(text);
            return text.length > 3500 && optionMatches.length >= 3 && hasQuestionLanguage;
        })();

        if (hasCommon) return true;
        if (host === 'passeidireto.com' || host === 'studocu.com' || host.endsWith('.scribd.com')) {
            if (hasReadablePreviewSignals) return false;
            return hasPaywall;
        }
        return false;
    },

    async _fetchTextWithTimeout(url, options = {}, timeoutMs = 6500) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            const text = await res.text().catch(() => '');
            return { ok: res.ok, status: res.status, url: res.url || url, text };
        } catch (error) {
            return { ok: false, status: 0, url, text: '', error };
        } finally {
            clearTimeout(timeout);
        }
    },

    // Shared webcache 429 tracking — skip cache after too many consecutive 429s.
    _webcache429Count: 0,
    _webcache429Threshold: 2,
    resetWebcache429() {
        this._webcache429Count = 0;
    },

    /**
     * AI-powered per-page deep answer extraction.
     * Sends page text + question to AI for a "pente fino" — deep analysis.
     * Uses SMART model for best accuracy. Prefers Gemini (free, higher limits).
     * @param {string} pageText - Page text (will be truncated to ~8000 chars)
     * @param {string} questionText - The question with options
     * @param {string} hostHint - Source domain for logging
     * @returns {Promise<{letter:string, evidence:string, confidence:number, method:string, knowledge:string}|null>}
     */
    async aiExtractFromPage(pageText, questionText, hostHint = '') {
        if (!pageText || pageText.length < 100 || !questionText) {
            console.log(`  🔬 [aiExtract] SKIP: text too short (${(pageText || '').length} chars)`);
            return null;
        }

        const settings = await this._getSettings();
        const truncatedPage = pageText.substring(0, 8000);
        const truncatedQuestion = questionText.substring(0, 1800);

        console.log(`  🔬 [aiExtract] START host=${hostHint} pageLen=${truncatedPage.length} questionLen=${truncatedQuestion.length}`);

        const systemMsg = `Você é um especialista em encontrar respostas de questões de múltipla escolha dentro de textos acadêmicos. Analise o texto fornecido com rigor. Responda APENAS com base no texto — nunca invente informações.`;

        const prompt = `# Tarefa
Analise o TEXTO abaixo e encontre a resposta para a QUESTÃO do aluno.

# ATENÇÃO CRÍTICA: Páginas com múltiplas questões
O texto pode conter VÁRIAS questões sobre o mesmo tema. Você DEVE:
- Comparar o ENUNCIADO EXATO e as ALTERNATIVAS EXATAS da questão do aluno
- Se encontrar um gabarito, confirmar que ele pertence à questão CERTA (mesmo enunciado, mesmas alternativas)
- NUNCA usar gabarito/resposta de uma questão DIFERENTE, mesmo que trate do mesmo assunto

# O que procurar (em ordem de prioridade)
1. Gabarito explícito: "Gabarito: X", "Resposta: X", "Alternativa correta: X", marcação ✓/★
2. Resolução da questão: explicação que conclua em uma alternativa
3. Questão idêntica/similar com resposta em outro local do texto
4. Definições ou conceitos que confirmem/refutem alternativas
5. Informações acadêmicas relevantes ao tema

# Formato de resposta (siga EXATAMENTE um dos três)

## Se encontrou a resposta:
RESULTADO: ENCONTRADO
EVIDÊNCIA: [trecho exato copiado do texto]
RACIOCÍNIO: [como o trecho leva à resposta, passo a passo]
Letra X: [texto da alternativa]

## Se há conhecimento útil mas sem resposta definitiva:
RESULTADO: CONHECIMENTO_PARCIAL
CONHECIMENTOS: [fatos/conceitos encontrados, relevantes à questão]

## Se não encontrou nada útil:
RESULTADO: NAO_ENCONTRADO

# Exemplos

<exemplo_1>
TEXTO: "...Questão 5. O modelo relacional utiliza chaves primárias para identificar registros. Gabarito: C..."
QUESTÃO: "No modelo relacional, o que identifica unicamente um registro? A) Índice B) View C) Chave primária D) Trigger"

RESULTADO: ENCONTRADO
EVIDÊNCIA: "Gabarito: C"
RACIOCÍNIO: O texto contém o gabarito explícito da questão 5 indicando letra C.
Letra C: Chave primária
</exemplo_1>

<exemplo_2>
TEXTO: "...NoSQL prioriza escalabilidade horizontal e flexibilidade de esquema, sacrificando consistência forte em favor de disponibilidade (teorema CAP)..."
QUESTÃO: "Qual fator é mais importante para o desempenho de bancos NoSQL? A) Normalização B) Joins complexos C) Escalabilidade horizontal D) ACID completo"

RESULTADO: ENCONTRADO
EVIDÊNCIA: "NoSQL prioriza escalabilidade horizontal e flexibilidade de esquema"
RACIOCÍNIO: Passo 1: O texto afirma que NoSQL prioriza escalabilidade horizontal. Passo 2: A alternativa C menciona exatamente "escalabilidade horizontal". Passo 3: As alternativas A, B e D são características de bancos relacionais, não NoSQL.
Letra C: Escalabilidade horizontal
</exemplo_2>

<exemplo_3>
TEXTO: "...O sistema imunológico possui células T e células B que atuam na defesa adaptativa..."
QUESTÃO: "Qual a capital da França? A) Londres B) Paris C) Berlim"

RESULTADO: NAO_ENCONTRADO
</exemplo_3>

<exemplo_4>
TEXTO: "...Questão 3. Marque a opção falsa sobre diferenças NoSQL vs relacional: a) Grafos ... e) Escalabilidade horizontal. Gabarito: E. Questão 4. Assinale o fator importante para o desempenho de bancos NoSQL: a) Ser schemaless b) SQL..."
QUESTÃO: "Assinale o fator importante para o desempenho de bancos NoSQL: A) Ser schemaless B) SQL C) Escalabilidade vertical D) Transações E) Chave-valor"

RESULTADO: NAO_ENCONTRADO
(O "Gabarito: E" no texto pertence à Questão 3 — uma questão DIFERENTE com alternativas DIFERENTES. A Questão 4 não tem gabarito no texto.)
</exemplo_4>

───────────────────────────────
TEXTO (${hostHint}):
${truncatedPage}
───────────────────────────────
QUESTÃO:
${truncatedQuestion}
───────────────────────────────

Analise o texto passo a passo e responda no formato acima:`;

        /* ---------- Try Gemini (preferred — free, higher limits) ---------- */
        const tryGemini = async () => {
            if (!settings.geminiApiKey) {
                console.log(`  🔬 [aiExtract] Gemini: no API key`);
                return null;
            }
            try {
                console.log(`  🔬 [aiExtract] Trying Gemini (${settings.geminiModelSmart || 'gemini-2.5-pro'})...`);
                const result = await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], {
                    temperature: 0.05,
                    max_tokens: 600,
                    model: settings.geminiModelSmart || 'gemini-2.5-pro'
                });
                console.log(`  🔬 [aiExtract] Gemini response: ${result ? result.length + ' chars' : 'null'}`);
                if (result) console.log(`  🔬 [aiExtract] Gemini preview: "${result.substring(0, 200)}"`);
                return result;
            } catch (e) {
                console.warn(`  🔬 [aiExtract] Gemini error:`, e?.message || e);
                return null;
            }
        };

        /* ---------- Try Groq (backup) ---------- */
        const tryGroq = async () => {
            const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
            if (!groqApiKey) {
                console.log(`  🔬 [aiExtract] Groq: no API key`);
                return null;
            }
            if (this._groqQuotaExhaustedUntil > Date.now()) {
                console.log(`  🔬 [aiExtract] Groq: quota exhausted, skipping`);
                return null;
            }
            try {
                console.log(`  🔬 [aiExtract] Trying Groq (${groqModelSmart})...`);
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: groqModelSmart,
                        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
                        temperature: 0.05,
                        max_tokens: 600
                    })
                }));
                const result = data?.choices?.[0]?.message?.content?.trim() || null;
                console.log(`  🔬 [aiExtract] Groq response: ${result ? result.length + ' chars' : 'null'}`);
                if (result) console.log(`  🔬 [aiExtract] Groq preview: "${result.substring(0, 200)}"`);
                return result;
            } catch (e) {
                console.warn(`  🔬 [aiExtract] Groq error:`, e?.message || e);
                return null;
            }
        };

        /* ---------- Execute with provider routing ---------- */
        const geminiPrimary = await this._isGeminiPrimary();
        let content = null;
        if (geminiPrimary) {
            content = await tryGemini();
            if (!content || /^RESULTADO:\s*NAO_ENCONTRADO/im.test(content)) {
                const groqContent = await tryGroq();
                if (groqContent && !/^RESULTADO:\s*NAO_ENCONTRADO/im.test(groqContent)) content = groqContent;
            }
        } else {
            content = await tryGroq();
            if (!content || /^RESULTADO:\s*NAO_ENCONTRADO/im.test(content)) {
                const geminiContent = await tryGemini();
                if (geminiContent && !/^RESULTADO:\s*NAO_ENCONTRADO/im.test(geminiContent)) content = geminiContent;
            }
        }

        if (!content || content.length < 10) {
            console.log(`  🔬 [aiExtract] RESULT: no response from any provider`);
            return null;
        }

        /* ---------- Parse response ---------- */
        // Check for CONHECIMENTO_PARCIAL — useful info but no definitive answer
        if (/RESULTADO:\s*CONHECIMENTO_PARCIAL/i.test(content)) {
            const knowledgeMatch = content.match(/CONHECIMENTOS?:\s*([\s\S]+)/i);
            const knowledge = knowledgeMatch ? knowledgeMatch[1].trim().substring(0, 1200) : content.substring(0, 1200);
            console.log(`  🔬 [aiExtract] RESULT: PARTIAL KNOWLEDGE (${knowledge.length} chars)`);
            console.log(`  🔬 [aiExtract] Knowledge preview: "${knowledge.substring(0, 200)}"`);
            return {
                letter: null,
                evidence: null,
                confidence: 0,
                method: 'ai-knowledge-partial',
                knowledge
            };
        }

        // Check for NAO_ENCONTRADO
        if (/RESULTADO:\s*NAO_ENCONTRADO/i.test(content)) {
            console.log(`  🔬 [aiExtract] RESULT: NAO_ENCONTRADO`);
            return null;
        }

        // Try to extract letter from ENCONTRADO response
        const letterMatch = content.match(/\bLetra\s+([A-E])\b/i)
            || content.match(/\b([A-E])\s*[\):\.\-]\s*\S/);
        if (!letterMatch) {
            // No letter but might have useful knowledge
            console.log(`  🔬 [aiExtract] RESULT: response but no letter found. Treating as knowledge.`);
            return {
                letter: null,
                evidence: null,
                confidence: 0,
                method: 'ai-knowledge-noletter',
                knowledge: content.substring(0, 1200)
            };
        }

        const letter = letterMatch[1].toUpperCase();
        const evidenceMatch = content.match(/EVID[EÊ]NCIA:\s*([\s\S]*?)(?=RACIOC[IÍ]NIO:|Letra\s+[A-E]|$)/i);
        const evidence = evidenceMatch ? evidenceMatch[1].trim() : content;
        console.log(`  🔬 [aiExtract] RESULT: FOUND letter=${letter} evidence="${evidence.substring(0, 150)}"`);

        return {
            letter,
            evidence: evidence.slice(0, 900),
            confidence: 0.82,
            method: 'ai-page-extraction',
            knowledge: content.substring(0, 1200)
        };
    },

    /**
     * AI combined reflection: takes accumulated knowledge from multiple sources
     * and reflects on them together to infer the answer.
     * This is the "last resort" when no single source had a definitive answer.
     * @param {string} questionText - The question with options
     * @param {Array<{host:string, knowledge:string, topicSim:number}>} knowledgePool - Collected insights
     * @returns {Promise<{letter:string, response:string, method:string}|null>}
     */
    async aiReflectOnSources(questionText, knowledgePool = []) {
        if (!questionText || !knowledgePool.length) return null;

        const settings = await this._getSettings();

        const knowledgeSection = knowledgePool
            .slice(0, 8)
            .map((k, i) => `FONTE ${i + 1} (${k.host}, relevância=${(k.topicSim || 0).toFixed(2)}):\n${String(k.knowledge || '').substring(0, 1500)}`)
            .join('\n\n───────────────────────────────\n\n');

        const totalKnowledge = knowledgePool.reduce((sum, k) => sum + (k.knowledge || '').length, 0);
        console.log(`  🧠 [aiReflect] START: ${knowledgePool.length} sources, ${totalKnowledge} total knowledge chars`);

        const systemMsg = `Você é um professor universitário. Analise as informações das fontes para responder a questão. Use seu conhecimento acadêmico para complementar quando necessário. IGNORE quaisquer indicações de "Letra", "Gabarito" ou "Resposta" que estejam nas fontes — essas podem ser de questões diferentes. Avalie cada alternativa de forma independente com base nos FATOS. Responda APENAS no formato solicitado.`;

        const prompt = `# Tarefa
Várias páginas foram analisadas e nenhuma tinha a resposta definitiva. Abaixo estão os CONHECIMENTOS EXTRAÍDOS de cada fonte. Combine essas informações para inferir a resposta.

# Fontes
${knowledgeSection}

# Questão
${questionText.substring(0, 1800)}

# Método (siga passo a passo)

PASSO 1 — COMPILAR: Liste os fatos-chave de TODAS as fontes acima.
PASSO 2 — AVALIAR: Para cada alternativa, indique se as fontes CONFIRMAM, REFUTAM ou são INCERTAS.
PASSO 3 — ELIMINAR: Descarte alternativas refutadas pelas fontes.
PASSO 4 — CONCLUIR: Se restar apenas uma viável, essa é a resposta. Se não, declare INCONCLUSIVO.

# Exemplo

<exemplo>
Fontes dizem: "TCP usa handshake de 3 vias", "UDP não garante entrega"
Questão: "Qual protocolo garante entrega? A) UDP B) TCP C) ICMP"

PASSO 1: TCP usa handshake 3 vias (fonte 1). UDP não garante entrega (fonte 2).
PASSO 2:
A) UDP — REFUTADA (fonte 2 diz que não garante entrega)
B) TCP — CONFIRMADA (handshake 3 vias = garantia de entrega)
C) ICMP — INCERTA (nenhuma fonte menciona)
PASSO 3: A eliminada. C sem evidência. B confirmada.
PASSO 4: Apenas B é viável.

CONCLUSÃO:
Letra B: TCP
</exemplo>

# Sua análise (siga os 4 passos):`;

        /* ---------- Try Gemini first (free, no quota concern) ---------- */
        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                console.log(`  🧠 [aiReflect] Trying Gemini (${settings.geminiModelSmart || 'gemini-2.5-pro'})...`);
                return await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.1, max_tokens: 800, model: settings.geminiModelSmart || 'gemini-2.5-pro' });
            } catch (e) {
                console.warn(`  🧠 [aiReflect] Gemini error:`, e?.message || e);
                return null;
            }
        };

        const tryGroq = async () => {
            if (!settings.groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
                console.log(`  🧠 [aiReflect] Trying Groq (${settings.groqModelSmart})...`);
                const data = await this._withGroqRateLimit(() => this._fetch(settings.groqApiUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${settings.groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: settings.groqModelSmart,
                        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
                        temperature: 0.1, max_tokens: 800
                    })
                }));
                return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
                console.warn(`  🧠 [aiReflect] Groq error:`, e?.message || e);
                return null;
            }
        };

        /* ---------- Execute with provider routing ---------- */
        const geminiPrimary = await this._isGeminiPrimary();
        let content = null;
        if (geminiPrimary) {
            content = await tryGemini();
            if (!content || /INCONCLUSIVO/i.test(content)) {
                const groqContent = await tryGroq();
                if (groqContent && !/INCONCLUSIVO/i.test(groqContent)) content = groqContent;
            }
        } else {
            content = await tryGroq();
            if (!content || /INCONCLUSIVO/i.test(content)) {
                const geminiContent = await tryGemini();
                if (geminiContent && !/INCONCLUSIVO/i.test(geminiContent)) content = geminiContent;
            }
        }

        if (!content || content.length < 20) {
            console.log(`  🧠 [aiReflect] RESULT: no response`);
            return null;
        }

        console.log(`  🧠 [aiReflect] Response (${content.length} chars): "${content.substring(0, 300)}"`);

        // Parse letter
        const letterMatch = content.match(/\bLetra\s+([A-E])\b/i)
            || content.match(/CONCLUS[AÃ]O:[\s\S]*?\b([A-E])\s*[\):\.\-]/i);
        if (!letterMatch) {
            console.log(`  🧠 [aiReflect] RESULT: response but no letter (INCONCLUSIVO?)`);
            return null;
        }

        const letter = letterMatch[1].toUpperCase();
        console.log(`  🧠 [aiReflect] RESULT: letter=${letter}`);
        return { letter, response: content, method: 'ai-combined-reflection' };
    },

    /**
     * Fetches a snapshot preserving BOTH HTML and derived text, with fallback for blocked sources.
     * Needed for PDF-like HTML sources (PasseiDireto/Studocu) where answers may be encoded by CSS classes.
     */
    async fetchPageSnapshot(url, opts = {}) {
        if (!url) return null;

        const {
            timeoutMs = 6500,
            maxHtmlChars = 1500000,
            maxTextChars = 12000
        } = opts;

        const commonHeaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache'
        };

        const primary = await this._fetchTextWithTimeout(url, {
            method: 'GET',
            headers: commonHeaders,
            mode: 'cors',
            credentials: 'omit'
        }, timeoutMs);

        let viaWebcache = false;
        let viaMirror = false;
        let final = primary;
        const primaryBlockedLike = primary.ok && this._looksBlockedLikeContent(primary.text, url);
        const primaryTooSmall = primary.ok && (primary.text || '').length < 500;
        const shouldTryFallbacks =
            (!primary.ok && (primary.status === 403 || primary.status === 429 || primary.status === 0))
            || primaryTooSmall
            || primaryBlockedLike;

        if (shouldTryFallbacks) {
            // Skip webcache if we've hit too many consecutive 429s from Google.
            const skipWebcache = this._webcache429Count >= this._webcache429Threshold;
            const webcacheUrl = skipWebcache ? null : this._makeWebcacheUrl(url);
            if (webcacheUrl) {
                const cached = await this._fetchTextWithTimeout(webcacheUrl, {
                    method: 'GET',
                    headers: commonHeaders,
                    mode: 'cors',
                    credentials: 'omit'
                }, timeoutMs);
                const cachedBlockedLike = cached.ok && this._looksBlockedLikeContent(cached.text, url);
                // Track 429 rate from Google webcache.
                const is429 = cached.status === 429
                    || (!cached.ok && /google\.com\/sorry/i.test(cached.url || ''))
                    || (cached.ok && /google\.com\/sorry/i.test(cached.url || ''));
                if (is429) {
                    this._webcache429Count += 1;
                    if (this._webcache429Count >= this._webcache429Threshold) {
                        console.log(`ApiService: Webcache rate-limited (${this._webcache429Count} consecutive 429s) — will skip cache for remaining URLs`);
                    }
                } else if (cached.ok) {
                    this._webcache429Count = 0; // Reset on success.
                }
                if (cached.ok && (cached.text || '').length > 800 && !cachedBlockedLike) {
                    final = cached;
                    viaWebcache = true;
                }
            } else if (skipWebcache) {
                console.log(`ApiService: Skipping webcache for ${url} (${this._webcache429Count} consecutive 429s)`);
            }

            // Secondary fallback: text mirror that often bypasses bot blocks and returns readable content.
            const finalBlockedLike = final.ok && this._looksBlockedLikeContent(final.text, url);
            if (!final.ok || (final.text || '').length < 1200 || finalBlockedLike) {
                const mirrorUrl = this._makeJinaMirrorUrl(url);
                if (mirrorUrl) {
                    const mirrored = await this._fetchTextWithTimeout(mirrorUrl, {
                        method: 'GET',
                        headers: {
                            'Accept': 'text/plain,text/html;q=0.9,*/*;q=0.8',
                            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                            'Cache-Control': 'no-cache'
                        },
                        mode: 'cors',
                        credentials: 'omit'
                    }, timeoutMs + 1800);
                    const mirroredBlockedLike = mirrored.ok && this._looksBlockedLikeContent(mirrored.text, url);
                    if (mirrored.ok && (mirrored.text || '').length > 700 && !mirroredBlockedLike) {
                        final = mirrored;
                        viaMirror = true;
                    }
                }
            }
        }

        const finalHtmlRaw = String(final.text || '');
        const isGoogleChallengePage =
            /<title>\s*Google Search\s*<\/title>/i.test(finalHtmlRaw) &&
            /httpservice\/retry\/enablejs/i.test(finalHtmlRaw);
        if (isGoogleChallengePage) {
            return {
                ok: false,
                status: 0,
                url: final.url || url,
                viaWebcache,
                viaMirror,
                html: '',
                text: ''
            };
        }

        if (!final.ok || !final.text) {
            return {
                ok: false,
                status: final.status || 0,
                url: final.url || url,
                viaWebcache,
                viaMirror,
                html: '',
                text: ''
            };
        }

        const rawHtml = String(final.text || '').slice(0, maxHtmlChars);
        // Keep raw HTML so structured parsers can recover embedded escaped content (e.g. \u003cdiv...).
        const html = rawHtml;

        let derivedText = '';
        try {
            // Strip script/iframe/object/noscript/link tags before DOMParser to avoid CSP violation noise.
            // Multi-pass for scripts: paired, self-closing, and dangling/unclosed blocks
            // (e.g. from HTML truncation or anti-bot injectors like DataDome / captcha-display).
            const sanitized = html
                // Remove ALL script blocks: paired, self-closing, unclosed, and JSON-embedded
                .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
                .replace(/<script\b[^>]*\/?>/gi, ' ')
                .replace(/<script\b[\s\S]*?(?=<(?:\/head|\/body|!--|meta|link))/gi, ' ')
                .replace(/<\s*script\b[\s\S]*$/gi, ' ')
                .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
                .replace(/<noscript\b[^>]*\/?>/gi, ' ')
                .replace(/<\s*noscript\b[\s\S]*$/gi, ' ')
                .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
                .replace(/<iframe\b[^>]*\/?>/gi, ' ')
                .replace(/<\s*iframe\b[\s\S]*$/gi, ' ')
                .replace(/<object\b[\s\S]*?<\/object>/gi, ' ')
                .replace(/<\s*object\b[\s\S]*$/gi, ' ')
                .replace(/<embed\b[^>]*>/gi, ' ')
                .replace(/<link\b[^>]*>/gi, ' ')
                // Remove anti-bot / captcha domains in ALL encoding forms
                .replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, ' ')
                .replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.captcha-display\.com(?:\/|\\?\/)[^\s"'<>]*/gi, ' ')
                .replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)(?:api-js\.)?datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, ' ')
                .replace(/datadome\.co/gi, ' ')
                .replace(/captcha-display\.com/gi, ' ');
            const parser = new DOMParser();
            const doc = parser.parseFromString(sanitized, 'text/html');
            const elementsToRemove = doc.querySelectorAll('style, nav, header, footer, aside, noscript, [role="navigation"], [role="banner"], .ads, .advertisement, .sidebar');
            elementsToRemove.forEach(el => el.remove());
            // Remove empty .blank spans from PDF-like HTML (PasseiDireto/Studocu)
            // to avoid word fragmentation in extracted text.
            doc.querySelectorAll('.blank').forEach(el => el.remove());
            doc.querySelectorAll('div, p, br, li, h1, h2, h3, h4, h5, h6, tr, td, article, section, footer, header').forEach(el => {
                el.appendChild(doc.createTextNode(' '));
            });
            derivedText = (doc.body?.textContent || '').trim();
        } catch {
            derivedText = '';
        }

        const cleanedText = (derivedText || '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, maxTextChars);

        return {
            ok: true,
            status: final.status || 200,
            url: final.url || url,
            viaWebcache,
            viaMirror,
            html,
            text: cleanedText
        };
    },

    /**
     * Validates if the text is a valid question using Groq
     */
    async validateQuestion(questionText) {
        if (!questionText) return false;
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelFast } = settings;

        const prompt = `Voce deve validar se o texto abaixo e UMA questao limpa e coerente.\n\nRegras:\n- Deve ser uma pergunta/questao de prova ou exercicio.\n- Pode ter alternativas (A, B, C, D, E).\n- NAO pode conter menus, botoes, avisos, instrucoes de site, ou texto sem relacao.\n- Se estiver poluida, misturando outra questao, ou sem sentido, responda INVALIDO.\n\nTexto:\n${questionText}\n\nResponda apenas: OK ou INVALIDO.`;
        const systemMsg = 'Responda apenas OK ou INVALIDO.';

        const parseValidation = (content) => {
            const upper = (content || '').trim().toUpperCase();
            if (upper.includes('INVALIDO')) return false;
            if (upper.includes('OK')) return true;
            return true; // default to valid on ambiguous response
        };

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                const content = await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.1, max_tokens: 10, model: settings.geminiModel || 'gemini-2.5-flash' });
                return content;
            } catch (e) {
                console.warn('AnswerHunter: Gemini validateQuestion error:', e?.message || e);
                return null;
            }
        };

        const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: groqModelFast,
                        messages: [
                            { role: 'system', content: systemMsg },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 10
                    })
                }));
                return data?.choices?.[0]?.message?.content || null;
            } catch (e) {
                console.warn('AnswerHunter: Groq validateQuestion error:', e?.message || e);
                return null;
            }
        };

        try {
            const geminiPrimary = await this._isGeminiPrimary();
            let content = null;
            if (geminiPrimary) {
                content = await tryGemini();
                if (content == null) content = await tryGroq();
            } else {
                content = await tryGroq();
                if (content == null) content = await tryGemini();
            }
            return parseValidation(content);
        } catch (error) {
            console.error('Erro validacao:', error);
            return true;
        }
    },

    /**
     * Vision OCR: extracts question text from a screenshot using Groq vision model.
     * @param {string} base64Image - base64-encoded JPEG/PNG screenshot (without data URI prefix)
     * @returns {Promise<string>} extracted question text, or '' on failure
     */
    async extractTextFromScreenshot(base64Image) {
        if (!base64Image) return '';
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelVision } = settings;

        const promptText = [
            'Você é um OCR especializado em provas educacionais.',
            'Extraia APENAS a questão (enunciado + alternativas A-E) que está mais centralizada/visível na imagem.',
            'Se houver múltiplas questões, escolha a que está mais ao centro da tela.',
            'Retorne o texto puro da questão com as alternativas, sem nenhum comentário adicional.',
            'Formato esperado:',
            '<enunciado da questão>',
            'A) <texto>',
            'B) <texto>',
            'C) <texto>',
            'D) <texto>',
            'E) <texto>'
        ].join('\n');

        const visionMessages = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: promptText },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${base64Image}`
                        }
                    }
                ]
            }
        ];

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                const model = settings.geminiModel || 'gemini-2.5-flash';
                console.log(`AnswerHunter: Vision OCR — sending screenshot to Gemini (${model})...`);
                const content = await this._callGemini(visionMessages, {
                    temperature: 0.1,
                    max_tokens: 700,
                    model
                });
                if (!content || content.length < 20) {
                    console.warn('AnswerHunter: Gemini Vision OCR returned too little text:', (content || '').length);
                    return null;
                }
                console.log(`AnswerHunter: Gemini Vision OCR success — ${content.length} chars extracted`);
                return content;
            } catch (e) {
                console.warn('AnswerHunter: Gemini Vision OCR failed:', e?.message || e);
                return null;
            }
        };

        const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            const model = groqModelVision || 'meta-llama/llama-4-scout-17b-16e-instruct';
            try {
                console.log(`AnswerHunter: Vision OCR — sending screenshot to Groq (${model})...`);
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model,
                        messages: visionMessages,
                        temperature: 0.1,
                        max_tokens: 700
                    })
                }));

                const content = (data.choices?.[0]?.message?.content || '').trim();
                if (content.length < 20) {
                    console.warn('AnswerHunter: Groq Vision OCR returned too little text:', content.length);
                    return null;
                }
                console.log(`AnswerHunter: Groq Vision OCR success — ${content.length} chars extracted`);
                return content;
            } catch (e) {
                console.warn('AnswerHunter: Groq Vision OCR failed:', e?.message || e);
                return null;
            }
        };

        try {
            const geminiPrimary = await this._isGeminiPrimary();
            let result = null;
            if (geminiPrimary) {
                result = await tryGemini();
                if (!result) result = await tryGroq();
            } else {
                result = await tryGroq();
                if (!result) result = await tryGemini();
            }
            return result || '';
        } catch (error) {
            console.error('AnswerHunter: Vision OCR failed:', error);
            return '';
        }
    },

    /**
     * Search on Serper (Google) with fallback to educational sites
     * Exact logic from legacy searchWithSerper
     */
    async searchWithSerper(query) {
        const { serperApiUrl, serperApiKey } = await this._getSettings();
        const hasSerperKey = Boolean(String(serperApiKey || '').trim());
        const providerMode = /serpapi\.com\//i.test(String(serperApiUrl || '')) ? 'serpapi' : 'serper';

        const normalizeSpace = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        const normalizeForMatch = (s) => String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const STOPWORDS = new Set([
            'que', 'para', 'com', 'sem', 'dos', 'das', 'nos', 'nas', 'uma', 'uns', 'umas', 'de', 'da', 'do',
            'e', 'o', 'a', 'os', 'as', 'no', 'na', 'em', 'por', 'ou', 'ao', 'aos', 'se', 'um', 'mais', 'menos',
            'sobre', 'apenas', 'indica', 'afirmativa', 'fator', 'importante', 'desempenho'
        ]);
        const toTokens = (text) => normalizeForMatch(text)
            .split(' ')
            .filter(t => t.length >= 3 && !STOPWORDS.has(t));
        const unique = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
        const decodeHtml = (raw) => String(raw || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, '\'')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>');
        const looksLikeCodeOption = (text) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|->|jsonb?/i.test(String(text || ''));
        const normalizeCodeAwareHint = (text) => String(text || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/^[a-e]\s*[\)\.\-:]\s*/i, '')
            .replace(/->>/g, ' op_json_text ')
            .replace(/->/g, ' op_json_obj ')
            .replace(/=>/g, ' op_arrow ')
            .replace(/::/g, ' op_dcolon ')
            .replace(/:=/g, ' op_assign ')
            .replace(/!=/g, ' op_neq ')
            .replace(/<>/g, ' op_neq ')
            .replace(/<=/g, ' op_lte ')
            .replace(/>=/g, ' op_gte ')
            .replace(/</g, ' op_lt ')
            .replace(/>/g, ' op_gt ')
            .replace(/:/g, ' op_colon ')
            .replace(/=/g, ' op_eq ')
            .replace(/[^a-z0-9_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const extractOptionHints = (raw) => {
            const text = String(raw || '').replace(/\r\n/g, '\n');
            const re = /(?:^|[\n\r\t ;])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;][A-E]\s*[\)\.\-:]\s)|$)/gi;
            const out = [];
            const seen = new Set();
            let m;
            while ((m = re.exec(text)) !== null) {
                const body = normalizeSpace(m[2] || '')
                    .replace(/\b(?:gabarito|resposta\s+correta|parab(?:ens|\u00e9ns))\b.*$/i, '')
                    .trim();
                const bodyNorm = looksLikeCodeOption(body)
                    ? normalizeCodeAwareHint(body)
                    : normalizeForMatch(body);
                const malformed = !body || body.length < 12
                    || /^[A-E]\s*[\)\.\-:]?\s*$/i.test(body)
                    || /^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(body)
                    || seen.has(bodyNorm);
                if (!malformed) {
                    out.push(body);
                    seen.add(bodyNorm);
                }
                if (out.length >= 5) break;
            }
            return out;
        };

        const compactOptionHint = (optRaw) => {
            let opt = normalizeSpace(optRaw || '').replace(/["'`]+/g, ' ').trim();
            if (!opt) return '';

            if (looksLikeCodeOption(opt)) {
                // SQL alternatives usually share a long identical prefix (INSERT INTO ... VALUES).
                // Keep only the discriminative JSON/operator segment.
                opt = opt
                    .replace(/\binsert\s+into[\s\S]*?\bvalues\s*\(/i, ' ')
                    .replace(/^\s*\(+/, '')
                    .replace(/\)+\s*;?$/, '')
                    .trim();

                const braceMatch = opt.match(/\{[\s\S]*\}/);
                if (braceMatch) opt = braceMatch[0];
            }

            return normalizeSpace(opt).split(' ').slice(0, looksLikeCodeOption(optRaw) ? 12 : 7).join(' ');
        };

        const buildHintQuery = (stem, options) => {
            if (!options || options.length < 2) return '';
            const pickDistributedOptions = (arr) => {
                if (!arr || arr.length === 0) return [];
                const picked = [];
                const pushUnique = (v) => {
                    if (!v) return;
                    if (!picked.includes(v)) picked.push(v);
                };
                pushUnique(arr[0]);
                pushUnique(arr[1]);
                pushUnique(arr[Math.floor(arr.length / 2)]);
                pushUnique(arr[arr.length - 1]); // keep tail option (often D/E) in the query
                pushUnique(arr[2]);
                pushUnique(arr[3]);
                return picked.slice(0, 5);
            };
            const hints = pickDistributedOptions(options)
                .map((opt) => compactOptionHint(opt))
                .filter(Boolean)
                .map((h) => `"${h}"`);
            if (hints.length === 0) return '';
            const maxLen = 340;
            const hintPart = hints.join(' ');
            const suffix = ' gabarito';
            const reserved = hintPart.length + suffix.length + 1;
            const maxStemLen = Math.max(70, maxLen - reserved);
            const stemPart = normalizeSpace(stem).slice(0, maxStemLen);
            return normalizeSpace(`${stemPart} ${hintPart}${suffix}`).slice(0, maxLen);
        };

        const normalizeSerpApiOrganic = (items = []) => {
            return (items || []).map((entry) => {
                const title = normalizeSpace(entry?.title || '');
                const link = normalizeSpace(entry?.link || entry?.url || '');
                const snippet = normalizeSpace(entry?.snippet || entry?.snippet_highlighted_words?.join(' ') || '');
                return { title, link, snippet };
            }).filter((entry) => entry.title && entry.link);
        };
        const normalizeSearchPayload = (raw) => {
            if (!raw || typeof raw !== 'object') {
                return {
                    organic: [],
                    answerBox: null,
                    aiOverview: null,
                    peopleAlsoAsk: null,
                    provider: providerMode
                };
            }

            if (providerMode === 'serpapi') {
                return {
                    organic: normalizeSerpApiOrganic(raw.organic_results || []),
                    answerBox: raw.answer_box || raw.answerBox || null,
                    aiOverview: raw.ai_overview || raw.aiOverview || null,
                    peopleAlsoAsk: raw.related_questions || raw.peopleAlsoAsk || raw.people_also_ask || null,
                    provider: 'serpapi'
                };
            }

            return {
                organic: raw.organic || [],
                answerBox: raw.answerBox || null,
                aiOverview: raw.aiOverview || raw.ai_overview || null,
                peopleAlsoAsk: raw.peopleAlsoAsk || null,
                provider: 'serper'
            };
        };
        const runSerper = async (q, num = 8) => {
            if (providerMode === 'serpapi') {
                const url = new URL(String(serperApiUrl || 'https://serpapi.com/search.json'));
                url.searchParams.set('engine', url.searchParams.get('engine') || 'google');
                url.searchParams.set('q', q);
                url.searchParams.set('gl', 'br');
                url.searchParams.set('hl', 'pt-br');
                url.searchParams.set('num', String(num));
                url.searchParams.set('api_key', serperApiKey);
                if (!url.searchParams.has('output')) {
                    url.searchParams.set('output', 'json');
                }
                const payload = await this._fetch(url.toString(), {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                return normalizeSearchPayload(payload);
            }

            const payload = await this._fetch(serperApiUrl, {
                method: 'POST',
                headers: {
                    'X-API-KEY': serperApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q,
                    gl: 'br',
                    hl: 'pt-br',
                    num
                })
            });
            return normalizeSearchPayload(payload);
        };
        const runDuckDuckGo = async (q, num = 8) => {
            const endpoint = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
            const response = await this._fetchTextWithTimeout(endpoint, {
                method: 'GET',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Cache-Control': 'no-cache'
                },
                mode: 'cors',
                credentials: 'omit'
            }, 6500);

            if (!response?.ok || !response?.text) return [];
            const html = String(response.text || '');
            const blocks = html.split(/<div[^>]+class="result[^"]*"[^>]*>/gi).slice(1);
            const organic = [];

            for (const block of blocks) {
                const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
                if (!linkMatch) continue;

                let link = decodeHtml(linkMatch[1] || '').trim();
                const title = normalizeSpace(decodeHtml((linkMatch[2] || '').replace(/<[^>]+>/g, ' ')));
                const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
                const snippetRaw = snippetMatch ? (snippetMatch[1] || snippetMatch[2] || '') : '';
                const snippet = normalizeSpace(decodeHtml(String(snippetRaw).replace(/<[^>]+>/g, ' ')));

                if (link.startsWith('/l/?')) {
                    try {
                        const tmp = new URL(`https://duckduckgo.com${link}`);
                        const redirected = tmp.searchParams.get('uddg');
                        if (redirected) link = decodeURIComponent(redirected);
                    } catch (_) {
                        // noop
                    }
                }

                if (!/^https?:\/\//i.test(link)) continue;
                if (!title) continue;

                organic.push({ title, link, snippet });
                if (organic.length >= num) break;
            }

            return organic;
        };

        // 1. Query cleaning (internal cleanQueryForSearch)
        const rawQuery = String(query || '')
            // Fix collapsed words from OCR/extraction: "dadosNoSQL" -> "dados NoSQL"
            .replace(/([a-z\u00e0-\u00ff])([A-Z])/g, '$1 $2');

        const headSample = rawQuery.slice(0, 180);
        const leadingNumberedMatch = headSample.match(/^\s*(\d+)\s*([\.\-])\s+/i)
            || headSample.match(/(?:^|[\n\r])\s*(\d+)\s*([\.\-])\s+/i);
        const leadingLabelNumberMatch = headSample.match(/^\s*(?:Quest(?:ao|\u00e3o)|Pergunta|Atividade|Exerc(?:icio|\u00edcio))\s*(\d+)\s*([\.\-:)]?)\s*/i)
            || headSample.match(/(?:^|[\n\r])\s*(?:Quest(?:ao|\u00e3o)|Pergunta|Atividade|Exerc(?:icio|\u00edcio))\s*(\d+)\s*([\.\-:)]?)\s*/i);
        let preservedPrefix = '';
        if (leadingNumberedMatch) {
            const num = leadingNumberedMatch[1];
            const sep = leadingNumberedMatch[2] === '-' ? '-' : '.';
            preservedPrefix = `${num}${sep} `;
        } else if (leadingLabelNumberMatch) {
            const num = leadingLabelNumberMatch[1];
            const sep = leadingLabelNumberMatch[2] === '-' ? '-' : '.';
            preservedPrefix = `${num}${sep} `;
        }

        let cleanQuery = rawQuery
            .replace(/^(?:Quest(?:ao|\u00e3o)|Pergunta|Atividade|Exerc(?:icio|\u00edcio))\s*\d+[\s.:-]*/gi, '')
            .replace(/Marcar para revis(?:ao|\u00e3o)/gi, '')
            .replace(/\s*(Responda|O que voc(?:e|\u00ea) achou|Relatar problema|Voltar|Avan(?:car|\u00e7ar)|Menu|Finalizar)[\s\S]*/gi, '')
            .replace(/\bNo\s+SQL\b/gi, 'NoSQL')
            .replace(/\s+/g, ' ')
            .trim();

        if (cleanQuery.includes('?')) {
            const questionEnd = cleanQuery.indexOf('?');
            const questionText = cleanQuery.substring(0, questionEnd + 1).trim();
            if (questionText.length >= 50) cleanQuery = questionText;
        }

        const optionMarkers = [...cleanQuery.matchAll(/(^|[\s:;])[A-E]\s*[\)\.\-:]\s/gi)];
        if (optionMarkers.length >= 2) {
            const firstMarkerIndex = optionMarkers[0].index ?? -1;
            if (firstMarkerIndex > 30) {
                cleanQuery = cleanQuery.substring(0, firstMarkerIndex).trim();
            }
        }

        const hasMultipleChoiceShape = (rawQuery.match(/(?:^|[\s:;])[A-E]\s*[\)\.\-:]\s/gi) || []).length >= 2;
        const startsWithQuestionVerb = /^(?:assinale|marque|indique|selecione|avalie|sobre)\b/i.test(cleanQuery);
        if (!preservedPrefix && hasMultipleChoiceShape && startsWithQuestionVerb) {
            preservedPrefix = '1. ';
        }

        if (preservedPrefix && !new RegExp(`^${preservedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(cleanQuery)) {
            cleanQuery = `${preservedPrefix}${cleanQuery}`.replace(/\s+/g, ' ').trim();
        }

        const maxQueryLen = hasMultipleChoiceShape ? 380 : 250;
        cleanQuery = cleanQuery.substring(0, maxQueryLen);
        console.log(`AnswerHunter: Query limpa: "${cleanQuery}"`);

        const optionHints = extractOptionHints(rawQuery);
        const hintQuery = buildHintQuery(cleanQuery, optionHints);
        if (hintQuery) {
            console.log(`AnswerHunter: Query com alternativas: "${hintQuery}"`);
        }

        const BOOST_SITES = [
            'qconcursos.com',
            'qconcursos.com.br',
            'tecconcursos.com.br',
            'gran.com.br',
            'passeidireto.com',
            'studocu.com',
            'brainly.com.br'
        ];
        const siteFilter = BOOST_SITES.map(s2 => `site:${s2}`).join(' OR ');
        const domainFromLink = (link) => {
            try {
                return new URL(link).hostname.replace(/^www\./, '');
            } catch (_) {
                return '';
            }
        };
        const hostBoost = {
            'qconcursos.com': 1.95,
            'qconcursos.com.br': 1.95,
            'tecconcursos.com.br': 1.85,
            'gran.com.br': 1.55,
            'passeidireto.com': 1.35,
            'studocu.com': 1.05,
            'brainly.com.br': 0.72,
            'brainly.com': 0.7,
            'scribd.com': 0.55,
            'pt.scribd.com': 0.5
        };
        const hostPenalty = {
            'brainly.com.br': 0.5,
            'brainly.com': 0.5,
            'scribd.com': 0.75,
            'pt.scribd.com': 0.75
        };
        const stemTokens = toTokens(cleanQuery).slice(0, 12);
        const optionTokens = toTokens(optionHints.join(' ')).slice(0, 10);
        const rareTokens = unique([...toTokens(cleanQuery), ...toTokens(optionHints.join(' '))])
            .filter(t => t.length >= 7)
            .slice(0, 5);
        const scoreOrganic = (item, position = 0, queryBoost = 0, provider = 'serper') => {
            const link = String(item?.link || '');
            const host = domainFromLink(link);
            const normHay = normalizeForMatch(`${item?.title || ''} ${item?.snippet || ''} ${link}`);
            let stemHits = 0;
            let optionHits = 0;
            let rareHits = 0;
            for (const t of stemTokens) if (normHay.includes(t)) stemHits += 1;
            for (const t of optionTokens) if (normHay.includes(t)) optionHits += 1;
            for (const t of rareTokens) if (normHay.includes(t)) rareHits += 1;
            const hostScore = hostBoost[host] || (host.endsWith('.gov.br') || host.endsWith('.edu.br') ? 1.5 : 0.65);
            const positionScore = Math.max(0, 1.25 - (position * 0.11));
            const penalty = hostPenalty[host] || 0;
            const providerBoost = provider === 'duckduckgo' ? -0.05 : 0.08;
            return (stemHits * 0.42) + (optionHits * 0.33) + (rareHits * 0.2) + hostScore + positionScore + queryBoost + providerBoost - penalty;
        };
        const dedupeAndRank = (entries) => {
            const byLink = new Map();
            for (const e of entries) {
                const link = String(e?.item?.link || '').trim();
                if (!link) continue;
                const prev = byLink.get(link);
                if (!prev || e.score > prev.score) byLink.set(link, e);
            }
            return Array.from(byLink.values())
                .sort((a, b) => b.score - a.score)
                .map(e => e.item);
        };
        const hasTrustedCoverage = (items) => {
            const hosts = new Set((items || []).map(it => domainFromLink(it?.link || '')));
            return hosts.has('passeidireto.com')
                || hosts.has('qconcursos.com')
                || hosts.has('qconcursos.com.br')
                || hosts.has('tecconcursos.com.br')
                || Array.from(hosts).some(h => h.endsWith('.gov.br') || h.endsWith('.edu.br'));
        };
        const buildQueryPlan = () => {
            const safe = cleanQuery.replace(/[:"']/g, '').slice(0, 200);
            const compactTokens = toTokens(cleanQuery).slice(0, 10).join(' ');
            const rareTokenQuery = rareTokens.slice(0, 3).join(' ');
            const exactQuery = safe ? `"${safe}"` : '';
            const plan = [
                { q: normalizeSpace(`${cleanQuery} resposta correta`), num: 10, boost: 0.55, label: 'base' },
                { q: normalizeSpace(`${cleanQuery} gabarito`), num: 10, boost: 0.6, label: 'gabarito' }
            ];
            if (hintQuery) {
                plan.push({ q: hintQuery, num: 10, boost: 0.78, label: 'hint' });
            }
            // site-filter-hint promoted to initial batch so educational sites
            // (studocu.com, passeidireto.com, etc.) are always searched even when
            // a single trusted domain already satisfies hasTrustedCoverage.
            if (hintQuery) {
                plan.push({ q: normalizeSpace(`${hintQuery} ${siteFilter}`).slice(0, 340), num: 8, boost: 0.62, label: 'site-filter-hint' });
            }
            if (exactQuery.length > 20) {
                plan.push({ q: exactQuery, num: 10, boost: 0.9, label: 'exact' });
            }
            if (compactTokens && compactTokens.length > 16) {
                plan.push({ q: normalizeSpace(`${compactTokens} gabarito`), num: 8, boost: 0.44, label: 'compact' });
            }
            if (rareTokenQuery && rareTokenQuery.length > 8) {
                plan.push({ q: normalizeSpace(`${rareTokenQuery} ${cleanQuery.slice(0, 120)} gabarito`), num: 8, boost: 0.52, label: 'rare' });
            }
            plan.push({ q: normalizeSpace(`${cleanQuery} ${siteFilter}`).slice(0, 340), num: 8, boost: 0.5, label: 'site-filter' });
            return plan.filter((entry) => entry.q && entry.q.length >= 8);
        };

        try {
            console.log('AnswerHunter: Buscando resposta...');
            const pooled = [];
            const pushScored = (items, queryBoost, provider = 'serper') => {
                (items || []).forEach((it, idx) => {
                    pooled.push({
                        item: it,
                        score: scoreOrganic(it, idx, queryBoost, provider)
                    });
                });
            };
            const plan = buildQueryPlan();
            const seenQueries = new Set();
            let serperCalls = 0;

            // ═══ Google AI Overview / AnswerBox / PeopleAlsoAsk capture ═══
            // Serper may return these rich fields alongside organic results.
            // We capture the FIRST occurrence across all Serper calls and attach
            // it to the returned array as `_serperMeta` for downstream processing.
            let serperMeta = { answerBox: null, aiOverview: null, peopleAlsoAsk: null };
            const captureSerperMeta = (data) => {
                if (!data) return;
                if (!serperMeta.answerBox && data.answerBox) {
                    serperMeta.answerBox = data.answerBox;
                    console.log(`AnswerHunter: Captured answerBox from ${data.provider || providerMode}:`, JSON.stringify(data.answerBox).slice(0, 300));
                }
                if (!serperMeta.aiOverview && (data.aiOverview || data.ai_overview)) {
                    serperMeta.aiOverview = data.aiOverview || data.ai_overview;
                    console.log(`AnswerHunter: Captured aiOverview from ${data.provider || providerMode}:`, JSON.stringify(serperMeta.aiOverview).slice(0, 300));
                }
                if (!serperMeta.peopleAlsoAsk && data.peopleAlsoAsk && data.peopleAlsoAsk.length > 0) {
                    serperMeta.peopleAlsoAsk = data.peopleAlsoAsk;
                    console.log(`AnswerHunter: Captured ${data.peopleAlsoAsk.length} peopleAlsoAsk entries`);
                }
            };

            // Initial pass: strongest query templates first.
            if (hasSerperKey) {
                for (const task of plan.slice(0, 4)) {
                    if (seenQueries.has(task.q)) continue;
                    seenQueries.add(task.q);
                    const data = await runSerper(task.q, task.num);
                    captureSerperMeta(data);
                    pushScored(data?.organic || [], task.boost, providerMode === 'serpapi' ? 'serpapi' : 'serper');
                    serperCalls += 1;
                }
            }

            let ranked = dedupeAndRank(pooled);

            // Expansion pass when recall is weak.
            if (hasSerperKey && (ranked.length < 10 || !hasTrustedCoverage(ranked.slice(0, 7)))) {
                for (const task of plan.slice(4)) {
                    if (seenQueries.has(task.q)) continue;
                    seenQueries.add(task.q);
                    const data = await runSerper(task.q, task.num);
                    captureSerperMeta(data);
                    pushScored(data?.organic || [], task.boost, providerMode === 'serpapi' ? 'serpapi' : 'serper');
                    serperCalls += 1;
                }
                ranked = dedupeAndRank(pooled);
            }

            // Second-provider fallback (no API key): DuckDuckGo HTML.
            let fallbackProviderUsed = false;
            if (!hasSerperKey || ranked.length < 9 || !hasTrustedCoverage(ranked.slice(0, 8))) {
                const fallbackTasks = [
                    { q: normalizeSpace(`${cleanQuery} gabarito`), boost: 0.36 },
                    hintQuery ? { q: hintQuery, boost: 0.4 } : null,
                    { q: normalizeSpace(`${cleanQuery} resposta correta`), boost: 0.34 }
                ].filter(Boolean);

                for (const task of fallbackTasks) {
                    try {
                        const organic = await runDuckDuckGo(task.q, 8);
                        if (organic.length > 0) {
                            pushScored(organic, task.boost, 'duckduckgo');
                            fallbackProviderUsed = true;
                        }
                    } catch (fallbackErr) {
                        console.warn('AnswerHunter: Fallback provider failed:', fallbackErr);
                    }
                }
                ranked = dedupeAndRank(pooled);
            }

            if (ranked.length > 0) {
                console.log(`AnswerHunter: Search diagnostics => provider=${providerMode}, providerCalls=${serperCalls}, fallbackProvider=${fallbackProviderUsed ? 'duckduckgo' : 'none'}, uniqueResults=${ranked.length}`);
                console.log(`AnswerHunter: ${ranked.length} resultados combinados e ranqueados (${hasSerperKey ? 'Serper + fallback' : 'fallback only'})`);
                const finalResults = ranked.slice(0, 12);
                // Attach Google meta signals (answerBox, aiOverview, peopleAlsoAsk) to the
                // results array so SearchService can process them as high-priority evidence.
                finalResults._serperMeta = serperMeta;
                finalResults._searchProvider = providerMode;
                return finalResults;
            }

            return [];
        } catch (e) {
            console.error('AnswerHunter: Erro na busca:', e);
            return [];
        }
    },





    /**
     * Extract Options Locally (Regex) - Internal helper used in refinement
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
            const plainAltPattern = /(?:^|[.!?]\\s+)([A-E])\\s+([A-Za-z][^]*?)(?=(?:[.!?]\\s+)[A-E]\\s+[A-Za-z]|$)/g;
            let m;
            while ((m = plainAltPattern.exec(normalized)) !== null) {
                const letter = m[1].toUpperCase();
                const body = clean(m[2].replace(/\s+[.!?]\s*$/, ''));
                if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
        };

        // IMPROVED method for alternatives without letter (Estácio/Brainly format)
        // Detects consecutive sentences that appear to be options after markers
        const bySentencesAfterMarker = () => {
            // Search for option start markers
            const markers = [
                /(?:assinale|marque)\s+(?:a\s+)?(?:alternativa\s+)?(?:correta|verdadeira|incorreta|falsa)[.:]/gi, ,
                /(?:opção|alternativa)\s+(?:correta|verdadeira)[.:]/gi,
                /\(Ref\.?:\s*\d+\)/gi,
                /assinale\s+(?:a\s+)?(?:afirmativa|assertiva)\s+correta[.:]/gi
            ];

            let startIdx = -1;
            for (const marker of markers) {
                marker.lastIndex = 0;
                const match = marker.exec(sourceContent);
                if (match) {
                    startIdx = match.index + match[0].length;
                    break;
                }
            }

            if (startIdx === -1) {
                // Fallback: search after "?" or at the beginning
                const questionMark = sourceContent.indexOf('?');
                if (questionMark > 30) {
                    startIdx = questionMark + 1;
                } else {
                    return null;
                }
            }

            // Get text after the marker
            let afterMarker = sourceContent.substring(startIdx).trim();

            // Remove references like (Ref.: 123456)
            afterMarker = afterMarker.replace(/\(Ref\.?:\s*\d+\)\s*/gi, '');

            // Try to split by sentences that look like alternatives
            // Pattern: sentences starting with uppercase after dot/newline and having medium length
            const sentences = afterMarker
                .split(/(?<=[.!])\s+(?=[A-ZÀ-ÚÉ])/)
                .map(s => s.trim())
                .filter(s => {
                    // Filters sentences that look like valid alternatives
                    if (s.length < 20 || s.length > 500) return false;
                    // Remove sentences that look like answers/keys
                    if (/^(Resposta|Gabarito|Correta|A resposta|portanto|letra\s+[A-E]|De acordo|Segundo)/i.test(s)) return false;
                    // Remove sentences with site metadata
                    if (/verificad[ao]|especialista|winnyfernandes|Excelente|curtidas|usuário|respondeu/i.test(s)) return false;
                    return true;
                });

            // If we have between 3-6 valid sentences, assign letters
            if (sentences.length >= 3 && sentences.length <= 6) {
                const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
                return sentences.slice(0, 5).map((body, idx) => ({
                    letter: letters[idx],
                    body: clean(body.replace(/\.+$/, ''))
                }));
            }
            return null;
        };

        // Method for alternatives in paragraphs (common format in educational sites)
        const byParagraphs = () => {
            const lines = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean);
            const candidateOptions = [];
            let foundStartMarker = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Marks start of options section
                if (/assinale|alternativa|opção|opções|correta[.:]|incorreta[.:]/i.test(line)) {
                    foundStartMarker = true;
                    continue;
                }

                // Stops when finding answer markers
                if (/^(Resposta|Gabarito|Correta|Alternativa correta|A resposta|está correta|portanto|letra\s+[A-E])/i.test(line)) {
                    break;
                }

                // If marker already found, add lines as options
                if (foundStartMarker) {
                    // Ignore lines too short or too long
                    if (line.length < 15 || line.length > 500) continue;
                    // Ignore lines that look like statements
                    if (line.endsWith('?') || line.endsWith(':')) continue;
                    // Ignore metadata
                    if (/verificad[ao]|especialista|curtidas|respondeu/i.test(line)) continue;

                    candidateOptions.push(line);
                }
            }

            // If we have 3+ candidate paragraphs, assign letters
            if (candidateOptions.length >= 3 && candidateOptions.length <= 6) {
                const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
                return candidateOptions.slice(0, 5).map((body, idx) => ({
                    letter: letters[idx],
                    body: clean(body)
                }));
            }
            return null;
        };

        const found = byLines() || byInline() || byPlain() || bySentencesAfterMarker() || byParagraphs();
        if (!found) return null;

        return found.map(o => `${o.letter}) ${o.body}`).join('\n');
    },

    /**
     * Extracts options (A, B, C...) from any text
     */
    extractOptionsFromText(sourceContent) {
        const raw = this._extractOptionsLocally(sourceContent);
        if (!raw) return [];
        return raw
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
    },

    /**
     * Prompt 1: Extract options (AI)
     * Uses FAST model (1000 t/s) - simple extraction task
     */
    async extractOptionsFromSource(sourceContent) {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelFast } = settings;

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

        const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqApiKey}`,
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
            const geminiPrimary = await this._isGeminiPrimary();
            let content = null;
            if (geminiPrimary) {
                content = await tryGemini();
                if (!content) content = await tryGroq();
            } else {
                content = await tryGroq();
                if (!content) content = await tryGemini();
            }

            if (!content || content.includes('SEM_OPCOES')) return null;
            return content;
        } catch (error) {
            console.error('Erro ao extrair opcoes:', error);
            return null;
        }
    },

    /**
     * Multiple-attempt consensus voting with provider routing
     * Uses SMART model - complex reasoning task requiring precision
     */
    async _extractAnswerWithConsensus(originalQuestion, sourceContent, attempts = 3) {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelSmart, consensusVotingEnabled, consensusMinAttempts, consensusThreshold } = settings;
        // If consensus voting is disabled, return null to trigger single attempt
        if (!consensusVotingEnabled) return null;

        const maxAttempts = Math.max(2, Math.min(attempts, consensusMinAttempts || 2));

        const prompts = [
            // Prompt 1: Direct extraction
            `Analise a fonte e identifique a resposta correta para a questão.

QUESTÃO:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

INSTRUÇÕES:
- Identifique a letra da resposta correta (A, B, C, D ou E)
- Extraia o texto completo da alternativa correta
- Responda APENAS no formato: "Letra X: [texto completo da alternativa]"
- Se não encontrar resposta clara, diga apenas: NAO_ENCONTRADO`,

            // Prompt 2: Step-by-step reasoning
            `ANÁLISE PASSO A PASSO:

QUESTÃO:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

PASSO 1: A fonte contém um gabarito explícito ("gabarito:", "resposta:", etc.)? Qual letra?
PASSO 2: Se não houver gabarito explícito, qual alternativa é confirmada como correta pela fonte?
PASSO 3: Resposta final no formato: "Letra X: [texto]"

Se não houver evidência: NAO_ENCONTRADO`,

            // Prompt 3: Evidence-based
            `IDENTIFICAÇÃO POR EVIDÊNCIAS:

QUESTÃO:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

Busque na fonte:
1. Marcações explícitas: "gabarito", "correta", "resposta"
2. Explicações que confirmam uma alternativa específica
3. Comentários de professores/especialistas

Formato de resposta: "Letra X: [texto]"
Se incerto: NAO_ENCONTRADO`
        ];

        const systemMsg = 'Você extrai respostas de questões de múltipla escolha. Sempre responda no formato "Letra X: [texto da alternativa]".';

        const runGroqConsensus = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return [];
            const responses = [];
            for (let i = 0; i < Math.min(maxAttempts, prompts.length); i++) {
                try {
                    const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${groqApiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: groqModelSmart,
                            messages: [
                                { role: 'system', content: systemMsg },
                                { role: 'user', content: prompts[i] }
                            ],
                            temperature: 0.05 + (i * 0.05),
                            max_tokens: 250
                        })
                    }));
                    const content = data.choices?.[0]?.message?.content?.trim() || '';
                    if (content && content.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA)/i.test(content)) {
                        responses.push(content);
                    }
                } catch (error) {
                    console.warn(`AnswerHunter: Groq consensus attempt ${i + 1} failed:`, error);
                }
            }
            return responses;
        };

        const runGeminiConsensus = async () => {
            if (!settings.geminiApiKey) return [];
            const geminiModel = settings.geminiModelSmart || 'gemini-2.5-pro';
            const responses = [];
            for (let i = 0; i < Math.min(maxAttempts, prompts.length); i++) {
                try {
                    const content = await this._callGemini([
                        { role: 'system', content: systemMsg },
                        { role: 'user', content: prompts[i] }
                    ], { temperature: 0.05 + (i * 0.05), max_tokens: 250, model: geminiModel, _noDowngrade: true });
                    if (content && content.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA)/i.test(content)) {
                        responses.push(content);
                    }
                } catch (error) {
                    console.warn(`AnswerHunter: Gemini consensus attempt ${i + 1} failed:`, error);
                }
            }
            return responses;
        };

        const geminiPrimary = await this._isGeminiPrimary();
        let responses = geminiPrimary ? await runGeminiConsensus() : await runGroqConsensus();
        // If primary provider returned nothing, try fallback
        if (responses.length === 0) {
            responses = geminiPrimary ? await runGroqConsensus() : await runGeminiConsensus();
        }

        if (responses.length === 0) return null;

        // Extract letters from all responses
        const letterPattern = /(?:Letra|Letter)\s*([A-E])[:\s\)]/i;
        const votes = {};
        const fullResponses = {};

        for (const response of responses) {
            const match = response.match(letterPattern);
            if (match) {
                const letter = match[1].toUpperCase();
                votes[letter] = (votes[letter] || 0) + 1;
                if (!fullResponses[letter] || response.length > fullResponses[letter].length) {
                    fullResponses[letter] = response;
                }
            }
        }

        if (Object.keys(votes).length === 0) return null;

        // Find consensus (majority vote)
        const sortedVotes = Object.entries(votes).sort((a, b) => b[1] - a[1]);
        const [winnerLetter, winnerCount] = sortedVotes[0];
        const confidence = winnerCount / responses.length;
        const threshold = consensusThreshold || 0.5;

        // If consensus is weak (below threshold), return null to trigger fallback
        if (confidence < threshold && responses.length >= 2) {
            console.log(`AnswerHunter: Weak consensus (${confidence.toFixed(2)} < ${threshold}), votes:`, votes);
            return null;
        }

        console.log(`AnswerHunter: Consensus achieved - Letter ${winnerLetter} (${winnerCount}/${responses.length} votes, confidence: ${confidence.toFixed(2)})`);
        return fullResponses[winnerLetter];
    },

    /**
     * Prompt 2: Identify the correct answer (AI)
     * Uses hybrid approach: SMART for single attempt, consensus handles multi-attempt
     */
    async extractAnswerFromSource(originalQuestion, sourceContent) {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelSmart } = settings;

        // Try consensus-based approach first
        const consensusAnswer = await this._extractAnswerWithConsensus(originalQuestion, sourceContent, 3);
        if (consensusAnswer) {
            console.log('AnswerHunter: Using consensus answer');
            return consensusAnswer;
        }

        // Fallback to single attempt with more explicit prompt
        const prompt = `Analise a fonte e identifique a resposta correta para a questão.

QUESTÃO:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

INSTRUÇÕES:
- Identifique a letra da resposta correta (A, B, C, D ou E)
- Extraia o texto completo da alternativa correta
- Responda APENAS no formato: "Letra X: [texto completo da alternativa]"
- Se não encontrar resposta clara, diga apenas: NAO_ENCONTRADO`;

        const systemMsg = 'Você extrai respostas de questões de múltipla escolha. Sempre responda no formato "Letra X: [texto da alternativa]".';

        const parseResponse = (content) => {
            if (!content || content.length < 3) return null;
            if (/^(NAO_ENCONTRADO|SEM_RESPOSTA|INVALIDO|N[ãa]o\s+(encontr|consigo|h[áa]))/i.test(content)) return null;
            if (/NAO_ENCONTRADO|SEM_RESPOSTA/i.test(content)) return null;
            return content;
        };

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                const content = await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.1, max_tokens: 200, model: settings.geminiModelSmart || 'gemini-2.5-pro' });
                console.log('AnswerHunter: Resposta Gemini bruta:', content);
                return parseResponse((content || '').trim());
            } catch (e) {
                console.warn('AnswerHunter: Gemini extractAnswerFromSource error:', e?.message || e);
                return null;
            }
        };

        const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: groqModelSmart,
                        messages: [
                            { role: 'system', content: systemMsg },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 200
                    })
                }));
                const content = data?.choices?.[0]?.message?.content?.trim() || '';
                console.log('AnswerHunter: Resposta Groq bruta:', content);
                return parseResponse(content);
            } catch (e) {
                console.warn('AnswerHunter: Groq extractAnswerFromSource error:', e?.message || e);
                return null;
            }
        };

        try {
            const geminiPrimary = await this._isGeminiPrimary();
            let result = null;
            if (geminiPrimary) {
                result = await tryGemini();
                if (!result) result = await tryGroq();
            } else {
                result = await tryGroq();
                if (!result) result = await tryGemini();
            }
            return result;
        } catch (error) {
            console.error('Erro ao extrair resposta:', error);
            return null;
        }
    },

    /**
     * Infer answer based on evidence (answer key/comments)
     * Enhanced with per-alternative evaluation & polarity awareness + Consensus voting
     * Uses SMART model (280 t/s) - most complex reasoning task
     */
    async inferAnswerFromEvidence(originalQuestion, sourceContent, options = {}) {
        const { isDesperate = false } = options;
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelSmart } = settings;

        // Detect question polarity
        const normQ = originalQuestion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const wantsIncorrect = /\b(falsa|incorreta|errada|exceto|nao\s+correta)\b/i.test(normQ);
        const polarityNote = wantsIncorrect
            ? '\n⚠️ ATENÇÃO: A questão pede a alternativa INCORRETA/FALSA/EXCETO. Você deve encontrar a alternativa ERRADA, não a correta.'
            : '';

        const basePrompt = `INFERÊNCIA DE RESPOSTA COM BASE EM EVIDÊNCIAS

QUESTÃO DO CLIENTE:
${originalQuestion.substring(0, 2000)}

EVIDÊNCIAS DAS FONTES:
${sourceContent.substring(0, 3500)}
${polarityNote}

INSTRUÇÕES - siga EXATAMENTE esta ordem:

PASSO 1: Leitura atenta do enunciado
- Identifique o ASPECTO ESPECÍFICO que a questão pede (ex: desempenho, segurança, flexibilidade, etc.).
- A questão pede a alternativa CORRETA ou INCORRETA/FALSA/EXCETO?
- Não basta uma alternativa ser "verdadeira" — ela precisa responder ao que o ENUNCIADO pergunta.

PASSO 2: Análise das evidências/explicações das fontes
- Procure textos explicativos, justificativas ou definições nas fontes.
- Identifique trechos que mencionem conceitos presentes nas alternativas.
- Conecte cada trecho explicativo à alternativa que ele descreve.
- IMPORTANTE: Preste atenção em frases como "isso se deve a...", "o motivo é...", "por conta de...", que revelam a relação causal.

PASSO 3: Classificação de cada alternativa
Para cada alternativa (A-E):
- Essa alternativa trata do ASPECTO ESPECÍFICO pedido no enunciado? (sim/não)
- As evidências CONFIRMAM ou REFUTAM essa alternativa para o aspecto pedido?
- Classifique como V (verdadeira E responde ao enunciado) ou F (falsa OU não responde ao aspecto pedido).

PASSO 4: Resposta FINAL
- Se apenas UMA alternativa é V e responde ao aspecto pedido, essa é a resposta.
- Se múltiplas são V, releia o enunciado e escolha a mais PRECISA para o aspecto pedido.
- Se as fontes têm texto explicativo que aponta para uma alternativa, PRIORIZE essa evidência.

FORMATO FINAL OBRIGATÓRIO (última linha):
Letra X: [texto completo da alternativa]

Se não houver evidência suficiente: NAO_ENCONTRADO

REGRAS:
- Nunca invente alternativas que não estejam na questão do cliente.
- O ENUNCIADO define o critério: responda ao que ele PERGUNTA, não ao que parece "mais correto" em geral.
- Textos explicativos/justificativos nas fontes são a evidência mais valiosa — use-os.
${isDesperate ? `
ATENÇÃO - EVIDÊNCIA LIMITADA:
As fontes acima contêm informação limitada e podem não ter a resposta explícita.
Nesse caso, use seu CONHECIMENTO ACADÊMICO para avaliar cada alternativa:
- Foque EXCLUSIVAMENTE no ASPECTO ESPECÍFICO pedido no enunciado (ex: "desempenho", "segurança", etc.).
- Uma alternativa pode ser VERDADEIRA sobre o tema geral mas NÃO responder ao aspecto específico pedido.
- Exemplo: se a questão pede sobre "desempenho", características de "flexibilidade" ou "linguagem" NÃO são sobre desempenho.
- Elimine primeiro alternativas factualmente INCORRETAS.
- Depois, entre as corretas, escolha a que tem relação CAUSAL DIRETA com o aspecto pedido.
- O modelo de transações (ACID vs BASE) afeta diretamente throughput/latência = desempenho.
- Schemaless afeta flexibilidade, não desempenho. Escalabilidade horizontal ≠ vertical.` : ''}`;

        // Consensus with controlled temperature diversity.
        // Routes to primary provider first, then fallback.
        const sinceLastGroq = Date.now() - this.lastGroqCallAt;
        const preInferenceCooldown = 4000;
        if (sinceLastGroq < preInferenceCooldown) {
            const waitMs = preInferenceCooldown - sinceLastGroq;
            console.log(`AnswerHunter: Pre-inference cooldown ${waitMs}ms (last Groq call ${sinceLastGroq}ms ago)`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }

        const systemMsg = 'Você infere respostas de questões educacionais com base em evidências de fontes. Analise textos explicativos, justificativas e definições nas fontes para encontrar qual alternativa responde ao ASPECTO ESPECÍFICO do enunciado. Não se limite a verificar se uma alternativa é "verdadeira" — ela precisa responder ao que o enunciado PERGUNTA. Formato final: "Letra X: [texto]" ou NAO_ENCONTRADO.';
        const letterPattern = /(?:Letra|Letter)\s*([A-E])[:\s\)]/i;
        const geminiPrimary = await this._isGeminiPrimary();

        if (geminiPrimary) {
            // ── Gemini PRIMARY → Groq fallback ──
            console.log('AnswerHunter: Inference via Gemini (primary)...');
            const gResult = await this._geminiConsensus(systemMsg, basePrompt, letterPattern, { smart: true });
            if (gResult.response) {
                console.log('AnswerHunter: Gemini primary inference votes:', gResult.votes);
                return gResult.response;
            }
            // Gemini failed → try Groq fallback
            console.log('AnswerHunter: Gemini primary failed — trying Groq fallback...');
            const groqResult = await this._groqConsensus(systemMsg, basePrompt, letterPattern, { model: groqModelSmart });
            if (groqResult.response) {
                console.log('AnswerHunter: Groq fallback inference votes:', groqResult.votes);
                return groqResult.response;
            }
            return null;
        }

        // ── Groq PRIMARY → Gemini fallback ──
        console.log('AnswerHunter: Inference via Groq (primary)...');
        const groqResult = await this._groqConsensus(systemMsg, basePrompt, letterPattern, { model: groqModelSmart });
        if (groqResult.response) {
            console.log('AnswerHunter: Groq primary inference votes:', groqResult.votes);
            return groqResult.response;
        }
        // Groq failed → try Gemini fallback
        console.log('AnswerHunter: Groq primary failed — trying Gemini fallback...');
        const geminiResult = await this._geminiConsensus(systemMsg, basePrompt, letterPattern, { smart: true });
        if (geminiResult.response) {
            console.log('AnswerHunter: Gemini fallback inference votes:', geminiResult.votes);
            return geminiResult.response;
        }
        return null;
    },

    async generateOverviewFromEvidence(questionText, evidenceItems = []) {
        if (!questionText || !Array.isArray(evidenceItems) || evidenceItems.length === 0) return null;

        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelOverview, groqModelSmart } = settings;
        const modelCandidates = [
            groqModelOverview,
            'openai/gpt-oss-120b',
            groqModelSmart,
            'llama-3.3-70b-versatile'
        ].filter((m, idx, arr) => typeof m === 'string' && m.trim() && arr.indexOf(m) === idx);

        const compactEvidence = evidenceItems
            .slice(0, 6)
            .map((item, index) => {
                const title = String(item?.title || `Fonte ${index + 1}`).slice(0, 180);
                const link = String(item?.link || '').slice(0, 500);
                const text = String(item?.text || '').replace(/\s+/g, ' ').slice(0, 850);
                return `FONTE ${index + 1}\nTITULO: ${title}\nLINK: ${link || 'n/a'}\nTRECHO: ${text}`;
            })
            .join('\n\n');

        const prompt = `Você vai gerar um overview curto e útil (estilo Google AI Overview), SEM inventar fatos.

QUESTÃO:
${String(questionText).slice(0, 1800)}

EVIDÊNCIAS:
${compactEvidence}

RETORNE APENAS JSON válido no formato:
{
  "summary": "resumo em 2-4 frases, objetivo",
  "keyPoints": ["ponto 1", "ponto 2", "ponto 3"],
  "references": [
    {"title": "nome curto da fonte", "link": "https://..."}
  ]
}

REGRAS:
- Use apenas o que está nas evidências.
- Se houver conflito ou baixa clareza, mencione isso no summary.
- keyPoints: no máximo 4 itens.
- references: no máximo 5 itens.
- Não inclua markdown, comentário ou texto fora do JSON.`;

        const sysMsg = 'Você transforma evidências em resumo estruturado e confiável. Nunca invente links, citações ou fatos fora da entrada.';

        /** Parse overview JSON from raw response */
        const parseOverview = (raw, modelLabel) => {
            if (!raw) return null;
            const start = raw.indexOf('{');
            const end = raw.lastIndexOf('}');
            if (start < 0 || end <= start) return null;
            try {
                const parsed = JSON.parse(raw.slice(start, end + 1));
                const summary = String(parsed?.summary || '').trim();
                if (!summary) return null;
                const keyPoints = Array.isArray(parsed?.keyPoints)
                    ? parsed.keyPoints.map(p => String(p || '').trim()).filter(Boolean).slice(0, 4) : [];
                const references = Array.isArray(parsed?.references)
                    ? parsed.references.map(ref => ({
                        title: String(ref?.title || '').trim(),
                        link: String(ref?.link || '').trim()
                    })).filter(ref => ref.title || ref.link).slice(0, 5) : [];
                console.log(`AnswerHunter: Overview generated with model=${modelLabel}`);
                return { summary, keyPoints, references, model: modelLabel };
            } catch { return null; }
        };

        const geminiPrimary = await this._isGeminiPrimary();

        if (geminiPrimary) {
            // ── Gemini PRIMARY for overview ──
            try {
                console.log('AnswerHunter: Overview via Gemini (primary)...');
                const geminiRaw = await this._callGemini([
                    { role: 'system', content: sysMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.1, max_tokens: 700 });
                const result = parseOverview(geminiRaw, 'gemini-primary');
                if (result) return result;
            } catch (gErr) {
                console.warn('AnswerHunter: Gemini primary overview failed:', gErr?.message || String(gErr));
            }
            // Fallback to Groq
            console.log('AnswerHunter: Gemini overview failed — trying Groq fallback...');
        }

        // ── Groq overview (primary or fallback) ──
        for (const model of modelCandidates) {
            const sinceLast = Date.now() - this.lastGroqCallAt;
            if (sinceLast < 3000) {
                await new Promise(resolve => setTimeout(resolve, 3000 - sinceLast));
            }
            try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: 'system', content: sysMsg },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 700
                    })
                }));

                const raw = data?.choices?.[0]?.message?.content?.trim() || '';
                const result = parseOverview(raw, model);
                if (result) return result;
            } catch (error) {
                const errMsg = error?.message || String(error);
                console.warn(`AnswerHunter: overview model failed (${model}):`, errMsg);
                if (errMsg.includes('GROQ_QUOTA_EXHAUSTED')) break;
            }
        }

        // ── Gemini fallback for overview (when Groq was primary) ──
        if (!geminiPrimary) {
            try {
                console.log('AnswerHunter: Groq overview failed — trying Gemini fallback...');
                const geminiRaw = await this._callGemini([
                    { role: 'system', content: sysMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.1, max_tokens: 700 });
                const result = parseOverview(geminiRaw, 'gemini-fallback');
                if (result) return result;
            } catch (gErr) {
                console.warn('AnswerHunter: Gemini overview fallback failed:', gErr?.message || String(gErr));
            }
        }

        return null;
    },

    /**
     * Knowledge-based answer: uses LLM domain expertise when evidence is thin.
     * Runs in parallel with inferAnswerFromEvidence during desperate mode.
     * Single call, no consensus needed — acts as a tiebreaker vote.
     */
    async generateKnowledgeAnswer(questionText) {
        if (!questionText) return null;
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelSmart } = settings;

        const normQ = questionText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const wantsIncorrect = /\b(falsa|incorreta|errada|exceto|nao\s+correta)\b/i.test(normQ);
        const polarityNote = wantsIncorrect
            ? '\n⚠️ A questão pede a alternativa INCORRETA/FALSA/EXCETO.'
            : '';

        const prompt = `ANÁLISE ACADÊMICA POR ELIMINAÇÃO

Você é um professor universitário especialista. Use EXCLUSIVAMENTE seu conhecimento acadêmico.

QUESTÃO:
${questionText.substring(0, 2000)}
${polarityNote}

INSTRUÇÕES — siga esta ordem RIGOROSA:

1. ASPECTO PEDIDO: Identifique qual aspecto específico o enunciado pergunta (ex: desempenho, segurança, modelo, etc.).

2. ELIMINAÇÃO: Para cada alternativa, análise em 1 linha:
   - É factualmente CORRETA? Se NÃO → eliminada.
   - Trata DIRETAMENTE do aspecto pedido? Se NÃO → eliminada (mesmo sendo verdadeira).
   Formato: "X) ELIMINADA — [motivo]" ou "X) MANTIDA — [relação com o aspecto]"

3. SELEÇÃO FINAL: Entre as mantidas, escolha a que tem relação CAUSAL mais direta com o aspecto.
   - Não escolha a "mais famosa" — escolha a mais ESPECÍFICA para o aspecto pedido.

FORMATO FINAL (última linha):
Letra X: [texto completo da alternativa]
Ou: NAO_ENCONTRADO`;

        const systemMsg = 'Você é um professor universitário especialista em análise de questões. Responda com rigor acadêmico, focando no ASPECTO ESPECÍFICO que o enunciado pede. Não escolha a alternativa mais popular — escolha a mais precisa para o aspecto pedido.';
        const isValid = (c) => c && c.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA|INCONCLUSIVO)/i.test(c);

        const geminiPrimary = await this._isGeminiPrimary();

        /* ---------- helper: try Groq ---------- */
        const tryGroq = async () => {
            try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: groqModelSmart,
                        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
                        temperature: 0.10, max_tokens: 600
                    })
                }));
                const c = data?.choices?.[0]?.message?.content?.trim() || '';
                if (isValid(c)) { console.log('AnswerHunter: Knowledge answer (Groq):', c.substring(0, 120)); return c; }
            } catch (e) { console.warn('AnswerHunter: Knowledge Groq failed:', e); }
            return null;
        };

        /* ---------- helper: try Gemini ---------- */
        const tryGemini = async () => {
            try {
                const r = await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], {
                    temperature: 0.10,
                    max_tokens: 600,
                    model: settings.geminiModelSmart || 'gemini-2.5-pro'
                });
                const c = r?.trim() || '';
                if (isValid(c)) { console.log('AnswerHunter: Knowledge answer (Gemini):', c.substring(0, 120)); return c; }
            } catch (e) { console.warn('AnswerHunter: Knowledge Gemini failed:', e); }
            return null;
        };

        /* ---------- primary → fallback ---------- */
        if (geminiPrimary) {
            const res = await tryGemini();
            if (res) return res;
            return await tryGroq();
        }
        const res = await tryGroq();
        if (res) return res;
        return await tryGemini();
    },

    /**
     * Main refinement function (3-Steps)
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

        const answerPromise = this.inferAnswerFromEvidence(originalQuestion, item.answer);
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
    },

    /**
     * Fallback: generate answer directly by AI when there are no sources
     * Uses anti-hallucination prompt: evaluates each alternative individually,
     * checks for contradictions, then selects.
     * NOW WITH CONSENSUS VOTING for unreliable models
     * Uses SMART model (280 t/s) - requires deep reasoning without external evidence
     */
    async generateAnswerFromQuestion(questionText) {
        if (!questionText) return null;
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelSmart } = settings;


        // Detect if multiple choice
        const hasOptions = /\b[A-E]\s*[).\-]\s/m.test(questionText);

        const prompt = hasOptions
            ? `ANÁLISE SISTEMÁTICA DE QUESTÃO DE MÚLTIPLA ESCOLHA

QUESTÃO:
${questionText}

INSTRUÇÕES - siga EXATAMENTE esta ordem:

PASSO 1: Classifique CADA alternativa como V (verdadeira) ou F (falsa), com uma justificativa OBJETIVA de 1 linha baseada em fatos/definições.
Formato: "X) V/F - [justificativa]"

PASSO 2: Verifique contradições:
- Há duas alternativas dizendo a mesma coisa? 
- A questão pede a CORRETA ou a INCORRETA/FALSA/EXCETO?

PASSO 3: Com base nos passos anteriores, indique a resposta FINAL.
Se a questão pede a CORRETA: escolha a alternativa V.
Se a questão pede a INCORRETA/FALSA/EXCETO: escolha a alternativa F.

FORMATO FINAL (última linha):
- Se houver segurança razoável: "Letra X: [texto completo da alternativa escolhida]"
- Se não houver segurança suficiente: "INCONCLUSIVO: sem evidência suficiente para marcar alternativa"

REGRAS:
- Nunca invente alternativas que não estejam na questão.
- Se houver dúvida real entre duas alternativas, use INCONCLUSIVO.
- Preste atenção especial se a questão pede "incorreta", "falsa", "exceto" ou "não é".`
            : `Responda a questão abaixo de forma direta e objetiva.\n\nQUESTÃO:\n${questionText}\n\nREGRAS:\n- Responda em 1 a 3 frases.\n- Não invente citações.`;

        // For multiple choice, try primary provider first then fallback
        if (hasOptions) {
            const mcSystemMsg = 'Você é um especialista em análise de questões de múltipla escolha. Seja conservador: quando faltar evidência clara, responda INCONCLUSIVO em vez de chutar.';
            const mcLetterPattern = /(?:Letra|Letter)\s*([A-E])[:\s\)]/i;
            const geminiPrimary = await this._isGeminiPrimary();

            /** Parse MC attempts into votes using the existing parseAttemptDecision logic */
            const tabulateGroqAttempts = (attempts) => {
                const asksIncorrect = /\b(incorreta|falsa|exceto|nao\s+e|não\s+é|errada)\b/i.test(questionText);
                const votes = {};
                const fullResponses = {};
                let validVoteCount = 0;

                for (const response of attempts) {
                    if (!response || /^INCONCLUSIVO/i.test(response)) continue;
                    const normalized = String(response);
                    const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    const lastLine = lines.length > 0 ? lines[lines.length - 1] : normalized.trim();

                    let match = lastLine.match(/(?:^|\b)(?:resposta\s+final\s*[:\-]\s*)?(?:letra|letter)\s*([A-E])\b/i);
                    if (!match) match = normalized.match(/(?:^|\b)(?:letra|letter)\s*([A-E])\b/i);
                    if (!match) continue;

                    // Ambiguity guard
                    const vfMatches = [...normalized.matchAll(/\b([A-E])\)\s*([VF])\b/gi)];
                    if (vfMatches.length >= 2) {
                        const vCount = vfMatches.filter(m => String(m[2]).toUpperCase() === 'V').length;
                        const fCount = vfMatches.filter(m => String(m[2]).toUpperCase() === 'F').length;
                        if ((!asksIncorrect && vCount > 1) || (asksIncorrect && fCount > 1)) continue;
                    }

                    const letter = String(match[1]).toUpperCase();
                    validVoteCount += 1;
                    votes[letter] = (votes[letter] || 0) + 1;
                    if (!fullResponses[letter] || response.length > fullResponses[letter].length) {
                        fullResponses[letter] = response;
                    }
                }

                if (validVoteCount === 0) return null;
                const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
                const [winnerLetter, winnerCount] = sorted[0];
                const secondCount = sorted[1]?.[1] || 0;
                const hasRobustConsensus = winnerCount >= 2 && winnerCount > secondCount && (winnerCount / validVoteCount) >= 0.6;
                if (hasRobustConsensus) {
                    console.log(`AnswerHunter: MC consensus → Letter ${winnerLetter} (${winnerCount}/${validVoteCount})`);
                    return fullResponses[winnerLetter];
                }
                return null; // no robust consensus
            };

            if (geminiPrimary) {
                // ── Gemini PRIMARY for MC ──
                console.log('AnswerHunter: MC via Gemini (primary)...');
                const gResult = await this._geminiConsensus(mcSystemMsg, prompt, mcLetterPattern, { smart: true });
                if (gResult.response) {
                    console.log('AnswerHunter: Gemini primary MC votes:', gResult.votes);
                    return gResult.response;
                }
                // Fallback to Groq
                console.log('AnswerHunter: Gemini MC failed — trying Groq fallback...');
                const groqResult = await this._groqConsensus(mcSystemMsg, prompt, mcLetterPattern, {
                    model: groqModelSmart, temps: [0.12, 0.20, 0.28]
                });
                if (groqResult.attempts.length > 0) {
                    const tabulated = tabulateGroqAttempts(groqResult.attempts);
                    if (tabulated) return tabulated;
                }
                return 'INCONCLUSIVO: sem consenso confiável entre tentativas da IA.';
            }

            // ── Groq PRIMARY for MC ──
            const groqResult = await this._groqConsensus(mcSystemMsg, prompt, mcLetterPattern, {
                model: groqModelSmart, temps: [0.12, 0.20, 0.28]
            });
            if (groqResult.attempts.length > 0) {
                const tabulated = tabulateGroqAttempts(groqResult.attempts);
                if (tabulated) return tabulated;
            }
            // Groq failed → Gemini fallback
            console.log('AnswerHunter: Groq MC failed — trying Gemini fallback...');
            const gResult = await this._geminiConsensus(mcSystemMsg, prompt, mcLetterPattern, { smart: true });
            if (gResult.response) {
                console.log('AnswerHunter: Gemini MC fallback votes:', gResult.votes);
                return gResult.response;
            }
            return 'INCONCLUSIVO: sem evidência suficiente para marcar alternativa.';
        }

        // For open-ended questions, single attempt with provider routing
        const geminiPrimaryOpen = await this._isGeminiPrimary();
        const openSysMsg = 'Você é um assistente que responde questões com objetividade.';

        if (geminiPrimaryOpen) {
            // Gemini first for open-ended
            const geminiOpen = await this._callGemini([
                { role: 'system', content: openSysMsg },
                { role: 'user', content: prompt }
            ], { temperature: 0.15, max_tokens: 300 });
            if (geminiOpen) return geminiOpen;
        }

        // Groq for open-ended (primary or fallback)
        try {
            const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelSmart,
                    messages: [
                        { role: 'system', content: openSysMsg },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.15,
                    max_tokens: 300
                })
            }));
            const content = data.choices?.[0]?.message?.content?.trim() || '';
            if (content) return content;
        } catch (error) {
            console.warn('AnswerHunter: Groq open-ended failed:', error?.message || String(error));
        }

        // Final fallback for open-ended
        if (!geminiPrimaryOpen) {
            const geminiOpen = await this._callGemini([
                { role: 'system', content: openSysMsg },
                { role: 'user', content: prompt }
            ], { temperature: 0.15, max_tokens: 300 });
            if (geminiOpen) return geminiOpen;
        }
        return null;
    },

};
