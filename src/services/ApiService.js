import { SettingsModel } from '../models/SettingsModel.js';
import { ChatGPTAuthService } from './ChatGPTAuthService.js';
import { GeminiAuthService } from './GeminiAuthService.js';
import { GeminiCLIAuthService } from './GeminiCLIAuthService.js';
import { GeminiCLIApiAdapter } from './GeminiCLIApiAdapter.js';
import { CopilotAuthService } from './CopilotAuthService.js';
import { CopilotApiAdapter } from './CopilotApiAdapter.js';

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
    _openRouterQuotaExhaustedUntil: 0,
    _chatgptQuotaExhaustedUntil: 0,
    _geminiQuotaExhaustedUntil: 0,
    _copilotQuotaExhaustedUntil: 0,
    // Models confirmed to NOT work with the ChatGPT Codex backend (backend-api/codex/responses).
    // Non-codex models (gpt-4.1, gpt-4o, etc.) consistently return 400 "not supported when using Codex".
    _chatgptUnsupportedCodexModels: {},
    _openRouterUnavailableModels: {},

    /**
     * Call Gemini via its OpenAI-compatible endpoint.
     * Used as fallback when Groq quota is exhausted, or as primary when user selects Gemini.
     * @param {Array<{role:string,content:string}>} messages
     * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
     * @returns {Promise<string|null>} The assistant message content, or null on failure
     */
    async _callGemini(messages, opts = {}) {
        if (this._geminiQuotaExhaustedUntil > Date.now()) {
            const waitMin = Math.ceil((this._geminiQuotaExhaustedUntil - Date.now()) / 60000);
            console.warn(`AnswerHunter: Gemini temporarily unavailable (~${waitMin}min left)`);
            return null;
        }

        const settings = await this._getSettings();
        const { geminiApiKey, geminiApiUrl, geminiModel } = settings;
        const model = opts.model || geminiModel || 'gemini-2.5-flash';

        // ─── Priority 1: Gemini CLI OAuth → cloudcode-pa.googleapis.com ───
        // Uses the user's Gemini subscription (free / AI Pro / AI Ultra)
        if (!opts._skipCLI) {
            try {
                const cliToken = await GeminiCLIAuthService.getValidToken();
                if (cliToken) {
                    const projectId = await GeminiCLIAuthService.getProjectId();
                    if (projectId) {
                        const cliResult = await GeminiCLIApiAdapter.generateContent(
                            cliToken, projectId, messages,
                            { model, temperature: opts.temperature, max_tokens: opts.max_tokens }
                        );
                        if (cliResult && typeof cliResult === 'string') {
                            console.log(`%c[AH] ✅ Gemini CLI success (model=${model}, ${cliResult.length} chars, project=${projectId})`, 'color:#0f0;font-weight:bold');
                            return cliResult;
                        }
                        if (cliResult?.error && cliResult.status === 429) {
                            const cooldownMs = 120000;
                            this._geminiQuotaExhaustedUntil = Date.now() + cooldownMs;
                            console.warn('AnswerHunter: Gemini CLI rate-limited, falling back to API key');
                        } else if (cliResult?.error) {
                            console.warn(`AnswerHunter: Gemini CLI failed (${cliResult.status}), falling back`);
                        }
                    }
                }
            } catch (e) {
                console.warn('AnswerHunter: Gemini CLI auth error, falling back:', e.message);
            }
        }

        // ─── Priority 2: GeminiAuthService OAuth (user's own client_id) ───
        // ─── Priority 3: API key ───
        let geminiToken = null;
        try {
            geminiToken = await GeminiAuthService.getValidToken();
        } catch (_) { /* GeminiAuthService may not be available in all contexts */ }

        if (!geminiToken && !geminiApiKey) return null;
        const authHeader = geminiToken ? `Bearer ${geminiToken}` : `Bearer ${geminiApiKey}`;
        const authSource = geminiToken ? 'oauth' : 'apikey';
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
                        'Authorization': authHeader,
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
                    if (response.status === 429 || /quota|exceeded|rate\s*limit/i.test(errText)) {
                        const retryAfter = parseFloat(response.headers.get('retry-after') || '0');
                        const cooldownMs = retryAfter > 0 ? Math.ceil(retryAfter * 1000) : 120000;
                        this._geminiQuotaExhaustedUntil = Date.now() + cooldownMs;
                        console.warn(`AnswerHunter: Gemini rate-limited/quota, cooldown=${cooldownMs}ms`);
                    }
                    console.warn(`AnswerHunter: Gemini HTTP ${response.status} (model=${callModel}, auth=${authSource}): ${errText.slice(0, 200)}`);
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
                console.log(`%c[AH] ✅ Gemini API success (model=${callModel}, auth=${authSource}, ${content.length} chars)`, 'color:#34a853');
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

    _isOpenRouterModelUnavailableError(status, errorText = '') {
        if (status !== 404) return false;
        const text = String(errorText || '');
        return /no endpoints found for/i.test(text) || /model[^\n]*not found/i.test(text);
    },

    _getOpenRouterFallbackModel(settings = {}, currentModel = '') {
        const normalizedCurrent = String(currentModel || '').trim();
        const configured = String(settings.openrouterModelSmart || '').trim();

        const candidates = [
            configured,
            'google/gemini-2.5-flash-free',
            'qwen/qwen-2.5-coder-32b-instruct:free',
            'google/gemini-exp-1121:free',
            'zhipuai/glm-4-plus'
        ].map(m => String(m || '').trim()).filter(Boolean);

        for (const candidate of candidates) {
            if (candidate === normalizedCurrent) continue;
            if (this._openRouterUnavailableModels[candidate]) continue;
            return candidate;
        }
        return null;
    },

    /**
     * Call OpenRouter via OpenAI-compatible chat completions endpoint.
     * @param {Array<{role:string,content:any}>} messages
     * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
     * @returns {Promise<string|null>}
     */
    async _callOpenRouter(messages, opts = {}) {
        const settings = await this._getSettings();
        const { openrouterModelSmart } = settings;
        // Trim + strip accidental "Bearer " prefix that a user might have pasted
        const openrouterApiKey = (settings.openrouterApiKey || '').trim().replace(/^bearer\s+/i, '');
        if (!openrouterApiKey) return null;

        if (this._openRouterQuotaExhaustedUntil > Date.now()) {
            const waitMin = Math.ceil((this._openRouterQuotaExhaustedUntil - Date.now()) / 60000);
            console.warn(`AnswerHunter: OpenRouter temporarily unavailable (~${waitMin}min left)`);
            return null;
        }

        const requestedModel = String(opts.model || openrouterModelSmart || 'deepseek/deepseek-r1:free').trim();
        const model = this._openRouterUnavailableModels[requestedModel]
            ? (this._getOpenRouterFallbackModel(settings, requestedModel) || requestedModel)
            : requestedModel;
        const url = 'https://openrouter.ai/api/v1/chat/completions';

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openrouterApiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://answerhunter.local',
                    'X-Title': 'AnswerHunter'
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: opts.temperature ?? 0.1,
                    max_tokens: opts.max_tokens ?? 700
                })
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                if (response.status === 429) {
                    const retryAfter = parseFloat(response.headers.get('retry-after') || '0');
                    const cooldownMs = retryAfter > 0 ? Math.ceil(retryAfter * 1000) : 120000;
                    this._openRouterQuotaExhaustedUntil = Date.now() + cooldownMs;
                    console.warn(`AnswerHunter: OpenRouter rate-limited (429), cooldown=${cooldownMs}ms`);
                    return null;
                }
                if (response.status === 402 || /insufficient|credit|quota/i.test(errText)) {
                    this._openRouterQuotaExhaustedUntil = Date.now() + 10 * 60 * 1000;
                    console.warn('AnswerHunter: OpenRouter insufficient credits/quota (402-like)');
                    return null;
                }

                if (this._isOpenRouterModelUnavailableError(response.status, errText)) {
                    this._openRouterUnavailableModels[model] = true;
                    if (!opts._modelRetried) {
                        const fallbackModel = this._getOpenRouterFallbackModel(settings, model);
                        if (fallbackModel && fallbackModel !== model) {
                            console.warn(`AnswerHunter: OpenRouter model '${model}' unavailable; retrying with '${fallbackModel}'`);
                            return this._callOpenRouter(messages, { ...opts, model: fallbackModel, _modelRetried: true });
                        }
                    }
                    this._openRouterQuotaExhaustedUntil = Date.now() + 5 * 60 * 1000;
                }

                console.warn(`AnswerHunter: OpenRouter HTTP ${response.status}: ${errText.slice(0, 220)}`);
                return null;
            }

            const data = await response.json().catch(() => null);
            const msg = data?.choices?.[0]?.message;

            // OpenRouter may return plain string or structured parts.
            let content = typeof msg?.content === 'string'
                ? msg.content.trim()
                : '';

            if (!content && Array.isArray(msg?.content)) {
                content = msg.content
                    .map((part) => {
                        if (typeof part === 'string') return part;
                        if (part && typeof part.text === 'string') return part.text;
                        return '';
                    })
                    .join('\n')
                    .trim();
            }

            if (!content) return null;
            console.log(`%c[AH] ✅ OpenRouter success (model=${model}, ${content.length} chars)`, 'color:#f59e0b');
            return content;
        } catch (err) {
            console.warn('AnswerHunter: OpenRouter request error:', err?.message || String(err));
            return null;
        }
    },

    _isCodexModelUnsupportedError(status, errorText = '') {
        if (status !== 400) return false;
        const text = String(errorText || '');
        return /not\s+supported\s+when\s+using\s+Codex/i.test(text)
            || /model[^\n]*not\s+supported[^\n]*Codex/i.test(text)
            || /Codex[^\n]*model[^\n]*not\s+supported/i.test(text);
    },

    _getChatGPTCodexFallbackModel(settings = {}, currentModel = '') {
        const normalizedCurrent = String(currentModel || '').trim();

        // Ordered fallback chain — only confirmed Codex backend models
        const chain = [
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.1-codex',
            'gpt-5.1-codex-mini'
        ];

        for (const candidate of chain) {
            if (candidate === normalizedCurrent) continue;
            if (this._chatgptUnsupportedCodexModels[candidate]) continue;
            return candidate;
        }

        return 'gpt-5.2-codex';
    },

    async _callGroq(messages, opts = {}) {
        const settings = await this._getSettings();
        const { groqApiKey, groqApiUrl } = settings;
        if (!groqApiKey) return null;

        if (this._groqQuotaExhaustedUntil > Date.now()) {
            const waitMin = Math.ceil((this._groqQuotaExhaustedUntil - Date.now()) / 60000);
            console.warn(`AnswerHunter: Groq temporarily unavailable (~${waitMin}min left)`);
            return null;
        }

        const model = opts.model || settings.groqModelSmart || 'llama-3.3-70b-versatile';

        try {
            const data = await this._withGroqRateLimit(() => this._fetch(
                groqApiUrl || 'https://api.groq.com/openai/v1/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model,
                        messages,
                        temperature: opts.temperature ?? 0.1,
                        max_tokens: opts.max_tokens ?? 700
                    })
                }
            ));

            const content = data?.choices?.[0]?.message?.content;
            if (typeof content === 'string' && content.trim()) {
                console.log(`%c[AH] ✅ Groq success (model=${model}, ${content.trim().length} chars)`, 'color:#22c55e');
                return content.trim();
            }
            return null;
        } catch (err) {
            console.warn(`AnswerHunter: Groq request error (model=${model}):`, err?.message || String(err));
            return null;
        }
    },

    /**
     * Call ChatGPT via the Codex backend (uses ChatGPT subscription credits).
     * Requires OAuth authentication via ChatGPTAuthService.
     * Uses the OpenAI Responses API format.
     * @param {Array<{role:string,content:string}>} messages
     * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
     * @returns {Promise<string|null>} The assistant message content, or null on failure
     */
    async _callChatGPT(messages, opts = {}) {
        // Fast-fail if quota exhausted
        if (this._chatgptQuotaExhaustedUntil > Date.now()) {
            const waitMin = Math.ceil((this._chatgptQuotaExhaustedUntil - Date.now()) / 60000);
            console.warn(`AnswerHunter: ChatGPT temporarily unavailable (~${waitMin}min left)`);
            return null;
        }

        // Check if user is authenticated
        const auth = await ChatGPTAuthService.getAuth();
        if (!auth || !auth.accessToken || !auth.accountId) {
            return null; // Not logged in — silently skip
        }

        const settings = await this._getSettings();
        const requestedModel = String(opts.model || settings.chatgptModel || 'gpt-5.2-codex').trim();
        const model = this._chatgptUnsupportedCodexModels[requestedModel]
            ? (this._getChatGPTCodexFallbackModel(settings, requestedModel) || requestedModel)
            : requestedModel;

        // Get a valid (possibly refreshed) access token
        const accessToken = await ChatGPTAuthService.getValidToken();
        if (!accessToken) return null;

        // Re-read auth to get possibly-updated accountId after refresh
        const currentAuth = await ChatGPTAuthService.getAuth();
        const accountId = currentAuth?.accountId || auth.accountId;

        // Convert Chat Completions format → Responses API format
        const systemMsgs = messages.filter(m => m.role === 'system');
        const inputMsgs = messages.filter(m => m.role !== 'system');

        const body = {
            model,
            input: inputMsgs.map(m => ({ role: m.role, content: m.content })),
            stream: true,
            store: false
        };

        if (systemMsgs.length > 0) {
            body.instructions = systemMsgs.map(m => m.content).join('\n');
        }
        // Note: Codex Responses API does not support temperature or max_output_tokens

        try {
            const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'chatgpt-account-id': accountId
                },
                body: JSON.stringify(body)
            });

            if (response.status === 401) {
                // Token expired — try refresh and retry once
                if (!opts._retried) {
                    console.log('AnswerHunter: ChatGPT 401 — refreshing token...');
                    const refreshed = await ChatGPTAuthService.refreshToken();
                    if (refreshed) {
                        return this._callChatGPT(messages, { ...opts, _retried: true });
                    }
                }
                console.warn('AnswerHunter: ChatGPT auth failed after retry');
                return null;
            }

            if (response.status === 429) {
                const retryAfter = parseFloat(response.headers.get('retry-after') || '60');
                this._chatgptQuotaExhaustedUntil = Date.now() + (retryAfter * 1000);
                console.warn(`AnswerHunter: ChatGPT rate-limited (429), cooldown=${retryAfter}s`);
                return null;
            }

            if (!response.ok) {
                const errText = await response.text().catch(() => '');

                if (!opts._modelRetried && this._isCodexModelUnsupportedError(response.status, errText)) {
                    this._chatgptUnsupportedCodexModels[model] = true;
                    const fallbackModel = this._getChatGPTCodexFallbackModel(settings, model);
                    if (fallbackModel && fallbackModel !== model) {
                        console.warn(`AnswerHunter: ChatGPT model '${model}' unsupported on Codex; retrying with '${fallbackModel}'`);
                        return this._callChatGPT(messages, { ...opts, model: fallbackModel, _modelRetried: true });
                    }
                }

                console.warn(`AnswerHunter: ChatGPT HTTP ${response.status}: ${errText.slice(0, 300)}`);
                return null;
            }

            // Parse SSE streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let collectedText = '';
            let completedData = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // Process complete lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // keep incomplete last line

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr || jsonStr === '[DONE]') continue;

                    try {
                        const event = JSON.parse(jsonStr);

                        // Collect text deltas
                        if (event.type === 'response.output_text.delta' && event.delta) {
                            collectedText += event.delta;
                        }

                        // response.completed has the full final response
                        if (event.type === 'response.completed' && event.response) {
                            completedData = event.response;
                        }
                    } catch (_) {
                        // skip malformed JSON lines
                    }
                }
            }

            // Try to extract from completed response first
            if (completedData) {
                const output = completedData.output || [];
                const msgOutput = output.find(o => o.type === 'message');
                if (msgOutput) {
                    const contentParts = msgOutput.content || [];
                    const finalText = contentParts
                        .filter(c => c.type === 'output_text')
                        .map(c => c.text)
                        .join('\n')
                        .trim();
                    if (finalText) {
                        console.log(`%c[AH] ✅ ChatGPT success (model=${model}, ${finalText.length} chars)`, 'color:#a78bfa');
                        return finalText;
                    }
                }
            }

            // Fallback: use collected deltas
            const trimmed = collectedText.trim();
            if (trimmed) {
                console.log(`%c[AH] ✅ ChatGPT success via deltas (model=${model}, ${trimmed.length} chars)`, 'color:#a78bfa');
                return trimmed;
            }

            console.warn('AnswerHunter: ChatGPT — empty text in streaming response');
            return null;

        } catch (err) {
            console.warn('AnswerHunter: ChatGPT request error:', err?.message || String(err));
            return null;
        }
    },

    /**
     * Call GitHub Copilot via the Copilot API (uses Copilot subscription credits).
     * Requires Device Flow authentication via CopilotAuthService.
     * Uses the OpenAI-compatible Chat Completions format.
     * @param {Array<{role:string,content:string}>} messages
     * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
     * @returns {Promise<string|null>} The assistant message content, or null on failure
     */
    async _callCopilot(messages, opts = {}) {
        // Fast-fail if quota exhausted
        if (this._copilotQuotaExhaustedUntil > Date.now()) {
            const waitMin = Math.ceil((this._copilotQuotaExhaustedUntil - Date.now()) / 60000);
            console.warn(`AnswerHunter: Copilot temporarily unavailable (~${waitMin}min left)`);
            return null;
        }

        // Check if user is authenticated
        const loggedIn = await CopilotAuthService.isLoggedIn();
        if (!loggedIn) return null; // Not logged in — silently skip

        const settings = await this._getSettings();
        const model = opts.model || settings.copilotModel || 'gpt-4o';

        // Get a valid Copilot token (auto-refreshes the 30-min token)
        const copilotToken = await CopilotAuthService.getValidToken();
        if (!copilotToken) return null;

        const apiUrl = await CopilotAuthService.getApiUrl();

        try {
            const result = await CopilotApiAdapter.chatCompletion(
                copilotToken, apiUrl, messages,
                { model, temperature: opts.temperature, max_tokens: opts.max_tokens }
            );

            if (result && typeof result === 'string') {
                console.log(`%c[AH] ✅ Copilot success (model=${model}, ${result.length} chars)`, 'color:#79c0ff;font-weight:bold');
                return result;
            }

            if (result?.error) {
                if (result.status === 401) {
                    // Token expired — will refresh on next call
                    console.warn('AnswerHunter: Copilot 401 — token will refresh on next call');
                    return null;
                }
                if (result.status === 429) {
                    const cooldownMs = 120000;
                    this._copilotQuotaExhaustedUntil = Date.now() + cooldownMs;
                    console.warn(`AnswerHunter: Copilot rate-limited (429), cooldown=${cooldownMs}ms`);
                    return null;
                }
                console.warn(`AnswerHunter: Copilot failed (${result.status})`);
            }

            return null;
        } catch (err) {
            console.warn('AnswerHunter: Copilot request error:', err?.message || String(err));
            return null;
        }
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
            ? (settings.geminiModelSmart || 'gemini-2.5-flash')
            : (settings.geminiModel || 'gemini-2.5-flash');
        const flashModel = settings.geminiModel || 'gemini-2.5-flash';
        const temps = [0.1, 0.5]; // 2 attempts instead of 3 to preserve API quota

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
                        // Strip markdown formatting before applying the letter pattern
                        // (Gemini often wraps answers like **Letra E:** which breaks plain regex)
                        const contentClean = content.replace(/[*_~`]+/g, '');
                        const m = contentClean.match(letterPattern) || content.match(letterPattern);
                        if (m) {
                            const letter = (m[1] || m[2] || '').toUpperCase();
                            if (letter) {
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
                    const letter = (m[1] || m[2] || '').toUpperCase();
                    if (letter) {
                        votes[letter] = (votes[letter] || 0) + 1;
                        if (!responses[letter] || content.length > responses[letter].length) {
                            responses[letter] = content;
                        }
                        if (votes[letter] >= 2) break; // early consensus
                    }
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
        for (let attempt = 0; attempt < maxRetries; attempt++) {
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
                    if (attempt < maxRetries - 1 && retryAfter > 0 && retryAfter <= 30) {
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
                if (attempt < maxRetries - 1 && !isQuotaError && !error.message?.includes('HTTP Error')) {
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
                console.log(`  🔬 [aiExtract] Trying Gemini (${settings.geminiModelSmart || 'gemini-2.5-flash'})...`);
                const result = await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], {
                    temperature: 0.05,
                    max_tokens: 300,
                    model: 'gemini-2.5-flash' // Force fast model for heavy extraction loop
                });
                console.log(`  🔬 [aiExtract] Gemini response: ${result ? result.length + ' chars' : 'null'}`);
                if (result) console.log(`  🔬 [aiExtract] Gemini preview: "${result.substring(0, 200)}"`);
                return result;
            } catch (e) {
                console.warn(`  🔬 [aiExtract] Gemini error:`, e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                // intercept options to overwrite model
                const opts = Object.assign({}, {
                    temperature: 0.05,
                    max_tokens: 300,
                    model: 'gemini-2.5-flash' // Force fast model for heavy extraction loop
                });
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
                        max_tokens: 300
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

        const tryChatGPT = async () => {
            if (this._chatgptQuotaExhaustedUntil > Date.now()) return null;
            try {
                console.log(`  🔬 [aiExtract] Trying ChatGPT (${settings.chatgptModel || 'gpt-5.2-codex'})...`);
                const result = await this._callChatGPT([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], {
                    temperature: 0.05,
                    max_tokens: 300,
                    model: settings.chatgptModel || 'gpt-5.2-codex'
                });
                console.log(`  🔬 [aiExtract] ChatGPT response: ${result ? result.length + ' chars' : 'null'}`);
                return result;
            } catch (e) {
                console.warn('  🔬 [aiExtract] ChatGPT error:', e?.message || e);
                return null;
            }
        };

        const tryCopilot = async () => {
            if (this._copilotQuotaExhaustedUntil > Date.now()) return null;
            try {
                console.log(`  🔬 [aiExtract] Trying Copilot (${settings.copilotModel || 'gpt-4o'})...`);
                const result = await this._callCopilot([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], {
                    temperature: 0.05,
                    max_tokens: 300,
                    model: settings.copilotModel || 'gpt-4o'
                });
                console.log(`  🔬 [aiExtract] Copilot response: ${result ? result.length + ' chars' : 'null'}`);
                return result;
            } catch (e) {
                console.warn('  🔬 [aiExtract] Copilot error:', e?.message || e);
                return null;
            }
        };

        /* ---------- Rotate Execution with Rate Limit Awareness ---------- */
        let content = null;
        const fallbackChain = [];
        if (settings.geminiApiKey) fallbackChain.push({ name: 'gemini', fn: tryGemini });
        if (settings.openrouterApiKey && this._openRouterQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: 'openrouter', fn: tryOpenRouter });
        }
        if (settings.groqApiKey && this._groqQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: 'groq', fn: tryGroq });
        }
        // ChatGPT: only added if user is authenticated (checked inside _callChatGPT)
        if (this._chatgptQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: 'chatgpt', fn: tryChatGPT });
        }
        // Copilot: only added if user is authenticated (checked inside _callCopilot)
        if (this._copilotQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: 'copilot', fn: tryCopilot });
        }

        const primary = settings.primaryProvider || 'groq';
        if (primary === 'copilot') {
            const idx = fallbackChain.findIndex(p => p.name === 'copilot');
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
        } else if (primary === 'chatgpt') {
            const idx = fallbackChain.findIndex(p => p.name === 'chatgpt');
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
        } else if (primary === 'gemini') {
            const idx = fallbackChain.findIndex(p => p.name === 'gemini');
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
        } else if (primary === 'openrouter') {
            const idx = fallbackChain.findIndex(p => p.name === 'openrouter');
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
        } else {
            const idx = fallbackChain.findIndex(p => p.name === 'groq');
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
        }


        for (const provider of fallbackChain) {
            content = await provider.fn();

            // If the provider returned a valid text and it wasn't a hard NAO_ENCONTRADO, keep it.
            if (content && content.length >= 10 && !/^RESULTADO:\s*NAO_ENCONTRADO/im.test(content)) {
                break;
            }
            // If provider returned null (likely quota error or crash) or explicitly NAO_ENCONTRADO,
            // we loop to the next provider in the chain.
            console.log(`  🔬 [aiExtract] ${provider.name} failed or NAO_ENCONTRADO, trying next fallback...`);
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
     * AI extraction from raw HTML — lets the LLM detect visual highlights
     * (CSS classes, bold, colors) without hardcoded selectors.
     * @param {string} htmlSnippet - Raw HTML chunk centered on the question
     * @param {string} questionText - Full question with options
     * @param {string} hostHint - Domain for logging
     * @returns {Promise<{letter:string|null, evidence:string, confidence:number, method:string, knowledge:string}|null>}
     */
    async aiExtractFromHtml(htmlSnippet, questionText, hostHint = '') {
        if (!htmlSnippet || htmlSnippet.length < 300 || !questionText) {
            console.log(`  🔬 [aiHtml] SKIP: snippet too short (${(htmlSnippet || '').length} chars)`);
            return null;
        }

        const settings = await this._getSettings();
        const truncatedHtml = htmlSnippet.substring(0, 12000);
        const truncatedQuestion = questionText.substring(0, 1800);

        console.log(`  🔬 [aiHtml] START host=${hostHint} htmlLen=${truncatedHtml.length} questionLen=${truncatedQuestion.length}`);

        const systemMsg = `Você é um especialista em análise de HTML/CSS de páginas educacionais. Sua tarefa é encontrar respostas de questões identificando DESTAQUES VISUAIS no HTML.`;

        const prompt = `# Tarefa
Analise o HTML abaixo de uma página de exercícios acadêmicos. Encontre a questão do aluno e identifique qual alternativa está VISUALMENTE DESTACADA como correta.

# Como identificar a resposta no HTML

## Destaques CSS (mais comum em PDFs renderizados como HTML):
- Uma alternativa tem classe CSS DIFERENTE das outras (ex: alternativas normais têm "ff2" mas a correta tem "ff1" ou "ff4")
- Font-family ou font-weight diferente em uma alternativa
- Uma alternativa está em <b>, <strong>, ou tem font-weight: bold
- Cor de fundo diferente (background-color, highlight)

## Marcações explícitas:
- Ícone de check (✓, ✔, ★) próximo de uma alternativa
- Texto "Gabarito: X", "Resposta: X", "Correta: X"
- Classe CSS com nome sugestivo (correct, right, answer, selected, checked)

## IMPORTANTE:
- A página pode ter VÁRIAS questões. Compare o ENUNCIADO e as ALTERNATIVAS EXATAS
- Procure diferenças ENTRE as alternativas da mesma questão (uma destacada vs as demais)
- Se todas alternativas têm o mesmo estilo, NÃO há destaque visual

# Formato de resposta

## Se encontrou destaque visual:
RESULTADO: ENCONTRADO
LETRA_DESTACADA: [A-E]
EVIDENCIA_CSS: [descreva a diferença CSS/HTML que indica o destaque]
TEXTO_ALTERNATIVA: [texto da alternativa destacada]

## Se encontrou gabarito textual:
RESULTADO: ENCONTRADO
EVIDÊNCIA: [trecho exato]
Letra [A-E]: [texto da alternativa]

## Se não encontrou:
RESULTADO: NAO_ENCONTRADO

# HTML da página (${hostHint}):
${truncatedHtml}

# Questão do aluno:
${truncatedQuestion}

Analise o HTML e responda:`;

        /* Try Gemini first (larger context window, free) */
        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                console.log(`  🔬 [aiHtml] Trying Gemini...`);
                return await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.05, max_tokens: 400, model: 'gemini-2.5-flash' });
            } catch (e) {
                console.warn(`  🔬 [aiHtml] Gemini error:`, e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                // intercept options to overwrite model
                const opts = Object.assign({}, { temperature: 0.05, max_tokens: 400, model: 'gemini-2.5-flash' });
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
            if (!settings.groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
                console.log(`  🔬 [aiHtml] Trying Groq (${settings.groqModelSmart})...`);
                const data = await this._withGroqRateLimit(() => this._fetch(settings.groqApiUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${settings.groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: settings.groqModelSmart,
                        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
                        temperature: 0.05,
                        max_tokens: 400
                    })
                }));
                return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
                console.warn(`  🔬 [aiHtml] Groq error:`, e?.message || e);
                return null;
            }
        };

        let content = null;
        const primary = settings.primaryProvider || 'groq';
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

        if (!content || content.length < 10) {
            console.log(`  🔬 [aiHtml] RESULT: no response`);
            return null;
        }

        console.log(`  🔬 [aiHtml] Response (${content.length} chars): "${content.substring(0, 250)}"`);

        if (/RESULTADO:\s*NAO_ENCONTRADO/i.test(content)) {
            console.log(`  🔬 [aiHtml] RESULT: NAO_ENCONTRADO`);
            return null;
        }

        // Parse LETRA_DESTACADA format
        const highlightMatch = content.match(/LETRA_DESTACADA:\s*([A-E])\b/i);
        // Parse standard Letra X format
        const letterMatch = highlightMatch
            || content.match(/\bLetra\s+([A-E])\b/i)
            || content.match(/\b([A-E])\s*[\):\.\-]\s*\S/);

        if (!letterMatch) {
            console.log(`  🔬 [aiHtml] RESULT: response but no letter found`);
            return {
                letter: null, evidence: null, confidence: 0,
                method: 'ai-html-noletter',
                knowledge: content.substring(0, 1200)
            };
        }

        const letter = letterMatch[1].toUpperCase();
        const evidenceCss = content.match(/EVIDENCIA_CSS:\s*([\s\S]*?)(?=TEXTO_ALTERNATIVA:|Letra\s+[A-E]|$)/i);
        const evidenceText = content.match(/EVID[EÊ]NCIA:\s*([\s\S]*?)(?=RACIOC[IÍ]NIO:|Letra\s+[A-E]|$)/i);
        const evidence = (evidenceCss ? evidenceCss[1].trim() : evidenceText ? evidenceText[1].trim() : content).slice(0, 900);

        console.log(`  🔬 [aiHtml] RESULT: FOUND letter=${letter} evidence="${evidence.substring(0, 150)}"`);
        return {
            letter,
            evidence,
            confidence: 0.85,
            method: 'ai-html-extraction',
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
                console.log(`  🧠 [aiReflect] Trying Gemini (${settings.geminiModelSmart || 'gemini-2.5-flash'})...`);
                return await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.1, max_tokens: 800, model: settings.geminiModelSmart || 'gemini-2.5-flash' });
            } catch (e) {
                console.warn(`  🧠 [aiReflect] Gemini error:`, e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                // intercept options to overwrite model
                const opts = Object.assign({}, { temperature: 0.1, max_tokens: 800, model: settings.geminiModelSmart || 'gemini-2.5-flash' });
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

        let rawHtml = String(final.text || '').slice(0, maxHtmlChars);
        // Keep raw HTML so structured parsers can recover embedded escaped content (e.g. \u003cdiv...).
        let html = rawHtml;

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

        let cleanedText = (derivedText || '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, maxTextChars);

        // Text rescue: some sources return very large HTML shells but almost no readable DOM text
        // (content embedded in scripts / anti-bot placeholders). In that case, try Jina mirror
        // even when the initial raw HTML fetch was "successful".
        if (cleanedText.length < 180 && !viaMirror) {
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
                if (mirrored.ok && (mirrored.text || '').length > 220 && !mirroredBlockedLike) {
                    viaMirror = true;
                    rawHtml = String(mirrored.text || '').slice(0, maxHtmlChars);
                    html = rawHtml;
                    cleanedText = String(mirrored.text || '')
                        .replace(/\r\n/g, '\n')
                        .replace(/[ \t]+\n/g, '\n')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim()
                        .slice(0, maxTextChars);
                }
            }
        }

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

        const prompt = `Voce deve validar se o texto abaixo e UMA questão limpa e coerente.\n\nRegras:\n- Deve ser uma pergunta/questão de prova ou exercicio.\n- Pode ter alternativas (A, B, C, D, E).\n- NAO pode conter menus, botoes, avisos, instrucoes de site, ou texto sem relação.\n- Se estiver poluida, misturando outra questão, ou sem sentido, responda INVALIDO.\n\nTexto:\n${questionText}\n\nResponda apenas: OK ou INVALIDO.`;
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

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                // intercept options to overwrite model
                const opts = Object.assign({}, { temperature: 0.1, max_tokens: 10, model: settings.geminiModel || 'gemini-2.5-flash' });
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
        const looksLikeCodeOption = (text) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|->|jsonb?|\bdb\.\w|\.(?:find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(text || ''));

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
                const codeLikeHint = looksLikeCodeOption(body) || /^[a-z0-9_]+(?:\s*\(\s*\))?$/i.test(body);
                const bodyNorm = looksLikeCodeOption(body)
                    ? normalizeCodeAwareHint(body)
                    : normalizeForMatch(body);
                const malformed = !body || body.length < (codeLikeHint ? 2 : 12)
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
                // Only replace with brace-content when it is substantial (> 6 chars),
                // otherwise commands like db.find({}).pretty() would collapse to just '{}'.
                if (braceMatch && braceMatch[0].length > 6) opt = braceMatch[0];
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

            // Initial pass: strongest query templates first — fired IN PARALLEL.
            if (hasSerperKey) {
                const initialTasks = plan.slice(0, 4).filter(task => {
                    if (seenQueries.has(task.q)) return false;
                    seenQueries.add(task.q);
                    return true;
                });
                const initialResults = await Promise.all(initialTasks.map(task => runSerper(task.q, task.num)));
                for (let _i = 0; _i < initialTasks.length; _i++) {
                    const data = initialResults[_i];
                    captureSerperMeta(data);
                    pushScored(data?.organic || [], initialTasks[_i].boost, providerMode === 'serpapi' ? 'serpapi' : 'serper');
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
            const inlinePattern = /(^|[\s])([A-E])\s*[\)\.\-:]\s*([^\n]*?)(?=(?:\s)[A-E]\s*[\)\.\-:]|$)/gi;
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
                .split(/(?<=[.!])\s+(?=[A-Z])/)
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
     * Extracts text from an image base64 dataUri using AI Vision
     */
    async aiExtractTextFromImage(dataUri) {
        if (!dataUri || !dataUri.startsWith('data:image/')) return '';
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelVision } = settings;

        const systemMsg = "Extraia rigorosamente o texto completo da imagem enviada. Responda APENAS com o texto, ignorando saudações.";

        const visionMessages = [
            { role: 'system', content: systemMsg },
            {
                role: 'user',
                content: [
                    { type: "text", text: "Transcrição fiel do conteúdo (preservando formato, alternativas, código, tabelas):" },
                    { type: "image_url", image_url: { url: dataUri } }
                ]
            }
        ];

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                const base64Data = dataUri.split(',')[1];
                const mimeType = dataUri.split(';')[0].split(':')[1];
                const content = await this._callGemini([
                    { role: 'system', content: systemMsg },
                    {
                        role: 'user', content: [
                            { inline_data: { mime_type: mimeType, data: base64Data } },
                            { text: "Transcrição fiel do conteúdo:" }
                        ]
                    }
                ], { temperature: 0.1, max_tokens: 1500, model: settings.geminiModel || 'gemini-2.5-flash' });
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

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                const model = settings.openrouterModelSmart || 'deepseek/deepseek-r1:free';
                const content = await this._callOpenRouter(visionMessages, {
                    temperature: 0.1,
                    max_tokens: 1500,
                    model
                });
                if (!content || content.length < 20) {
                    return null;
                }
                return content;
            } catch (e) {
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
                        max_tokens: 1500
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
            const primary = settings.primaryProvider || 'groq';
            let result = null;
            if (primary === 'openrouter') {
                result = await tryOpenRouter();
                if (!result) result = await tryGroq();
                if (!result) result = await tryGemini();
            } else if (primary === 'gemini') {
                result = await tryGemini();
                if (!result) result = await tryOpenRouter();
                if (!result) result = await tryGroq();
            } else {
                result = await tryGroq();
                if (!result) result = await tryOpenRouter();
                if (!result) result = await tryGemini();
            }
            return result || '';
        } catch (error) {
            console.error('AnswerHunter: Vision OCR failed:', error);
            return '';
        }
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
                console.warn('AnswerHunter: OpenRouter extractOptions error:', e?.message || e);
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
            const geminiModel = settings.geminiModelSmart || 'gemini-2.5-flash';
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
                ], { temperature: 0.1, max_tokens: 200, model: settings.geminiModelSmart || 'gemini-2.5-flash' });
                console.log('AnswerHunter: Resposta Gemini bruta:', content);
                return parseResponse((content || '').trim());
            } catch (e) {
                console.warn('AnswerHunter: Gemini extractAnswerFromSource error:', e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                // intercept options to overwrite model
                const opts = Object.assign({}, { temperature: 0.1, max_tokens: 200, model: settings.geminiModelSmart || 'gemini-2.5-flash' });
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
        const chatgptPrimaryInfer = settings.primaryProvider === 'chatgpt'
            && this._chatgptQuotaExhaustedUntil <= Date.now();
        const copilotPrimaryInfer = settings.primaryProvider === 'copilot'
            && this._copilotQuotaExhaustedUntil <= Date.now();

        if (copilotPrimaryInfer) {
            // ── Copilot PRIMARY for inference ──
            console.log(`AnswerHunter: Inference via Copilot (primary, model=${settings.copilotModel || 'gpt-4o'})...`);
            const copilotResult = await this._callCopilot([
                { role: 'system', content: systemMsg },
                { role: 'user', content: basePrompt }
            ], { model: settings.copilotModel || 'gpt-4o' });
            if (copilotResult) {
                console.log(`%c[AH] \ud83c\udfaf inferAnswerFromEvidence \u2192 Copilot (${copilotResult.length} chars)`, 'color:#79c0ff;font-weight:bold');
                return copilotResult;
            }
            console.log('AnswerHunter: Copilot inference failed — trying fallbacks...');
        }

        if (chatgptPrimaryInfer) {
            // ── ChatGPT PRIMARY for inference ──
            console.log(`AnswerHunter: Inference via ChatGPT (primary, model=${settings.chatgptModel || 'gpt-5.2-codex'})...`);
            const chatgptResult = await this._callChatGPT([
                { role: 'system', content: systemMsg },
                { role: 'user', content: basePrompt }
            ], { model: settings.chatgptModel || 'gpt-5.2-codex' });
            if (chatgptResult) {
                console.log(`%c[AH] \ud83c\udfaf inferAnswerFromEvidence \u2192 ChatGPT (${chatgptResult.length} chars)`, 'color:#0ff;font-weight:bold');
                return chatgptResult;
            }
            console.log('AnswerHunter: ChatGPT inference failed — trying Groq fallback...');
        }

        if (geminiPrimary) {
            // ── Gemini PRIMARY → Groq fallback ──
            console.log('AnswerHunter: Inference via Gemini (primary)...');
            const gResult = await this._geminiConsensus(systemMsg, basePrompt, letterPattern, { smart: true });
            if (gResult.response) {
                console.log(`%c[AH] \ud83c\udfaf inferAnswerFromEvidence \u2192 Gemini (primary, votes: ${JSON.stringify(gResult.votes)})`, 'color:#0ff;font-weight:bold');
                return gResult.response;
            }
            // Gemini failed → try Groq fallback
            console.log('AnswerHunter: Gemini primary failed — trying Groq fallback...');
            const groqResult = await this._groqConsensus(systemMsg, basePrompt, letterPattern, { model: groqModelSmart });
            if (groqResult.response) {
                console.log(`%c[AH] \ud83c\udfaf inferAnswerFromEvidence \u2192 Groq (fallback, votes: ${JSON.stringify(groqResult.votes)})`, 'color:#0ff;font-weight:bold');
                return groqResult.response;
            }
            return null;
        }

        // ── Groq PRIMARY → Gemini fallback ──
        console.log('AnswerHunter: Inference via Groq (primary)...');
        const groqResult = await this._groqConsensus(systemMsg, basePrompt, letterPattern, { model: groqModelSmart });
        if (groqResult.response && groqResult.attempts.length > 0) {
            console.log(`%c[AH] \ud83c\udfaf inferAnswerFromEvidence \u2192 Groq (primary, votes: ${JSON.stringify(groqResult.votes)})`, 'color:#0ff;font-weight:bold');
            return groqResult.response;
        }
        // Groq failed → try Gemini fallback
        console.log('AnswerHunter: Groq primary failed — trying Gemini fallback...');
        const geminiResult = await this._geminiConsensus(systemMsg, basePrompt, letterPattern, { smart: true });
        if (geminiResult.response) {
            console.log(`%c[AH] \ud83c\udfaf inferAnswerFromEvidence \u2192 Gemini (fallback, votes: ${JSON.stringify(geminiResult.votes)})`, 'color:#0ff;font-weight:bold');
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
                if (isValid(c)) { console.log(`%c[AH] \ud83c\udfaf generateKnowledgeAnswer \u2192 Groq`, 'color:#0ff;font-weight:bold'); return c; }
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
                    model: settings.geminiModelSmart || 'gemini-2.5-flash'
                });
                const c = r?.trim() || '';
                if (isValid(c)) { console.log(`%c[AH] \ud83c\udfaf generateKnowledgeAnswer \u2192 Gemini`, 'color:#0ff;font-weight:bold'); return c; }
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
     * Uses whichever AI provider is available (Groq, Gemini, OpenRouter, ChatGPT).
     */
    async refineWithAI(item) {
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
        const [answer, optionsFromAI] = await Promise.all([
            answerPromise,
            optionsPromise ? optionsPromise : Promise.resolve(null)
        ]);

        if (!options && optionsFromAI) options = optionsFromAI;
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
            const mcLetterPattern = /[*_]{0,2}(?:Letra|Letter|Alternativa|Resposta\s+(?:correta|final))[:\s*_]{0,4}[*_]{0,2}\s*([A-E])\b|\b([A-E])\s*[).]\s*(?:V\b|verdadeira|correta)/i;
            // Detects AI responses that refuse to answer due to missing code/image context
            const CANT_ANSWER_RE = /\b(não\s+(pode(mos)?|é\s+possível)\s+(ser\s+)?respondida?|sem\s+o\s+código|preciso\s+(do\s+)?código|código.{0,50}(não\s+está|ausente|faltando|não\s+foi\s+fornecido)|contexto\s+(adicional|visual)\s+necessário|imagem\s+(não|sem)|necessário\s+ver\s+o\s+código|não\s+tenho\s+acesso\s+ao\s+código|código\s+sql.{0,30}não|without\s+the\s+(code|image)|cannot\s+answer\s+without)\b/i;
            const geminiPrimary = await this._isGeminiPrimary();
            const openrouterPrimary = settings.primaryProvider === 'openrouter'
                && !!settings.openrouterApiKey
                && this._openRouterQuotaExhaustedUntil <= Date.now();
            const chatgptPrimary = settings.primaryProvider === 'chatgpt'
                && this._chatgptQuotaExhaustedUntil <= Date.now();
            const copilotPrimary = settings.primaryProvider === 'copilot'
                && this._copilotQuotaExhaustedUntil <= Date.now();

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

                    // Broad letter extraction — works for all AI providers
                    let match = lastLine.match(/(?:^|\b)(?:resposta\s+final|resposta\s+correta|resposta)\s*[:\-–]\s*(?:letra\s*)?[*_]*([A-E])[*_]*/i);
                    if (!match) match = lastLine.match(/(?:^|\b)(?:letra|letter|alternativa)\s*[*_]*([A-E])\b/i);
                    if (!match) match = normalized.match(/(?:resposta\s+final|resposta\s+correta|resposta)\s*[:\-–]\s*(?:letra\s*)?[*_]*([A-E])[*_]*/i);
                    if (!match) match = normalized.match(/(?:letra|letter|alternativa)\s*[*_]*([A-E])\b/i);
                    if (!match) match = normalized.match(/\*\*([A-E])\*\*/);
                    if (!match) match = normalized.match(/\b([A-E])\s*\)\s*(?:é\s+)?(?:a\s+)?(?:incorreta|correta|errada|falsa|verdadeira)/i);

                    // V/F inference fallback: when the AI classifies each option as V or F
                    // but forgets to write the final "Letra X:" line.
                    // Pattern: "X) V" or "X) F" — pick the single V (correct) or single F (incorrect).
                    if (!match) {
                        const vfMatches2 = [...normalized.matchAll(/\b([A-E])\s*\)\s*[*_]*\s*([VF])\b/gi)];
                        if (vfMatches2.length >= 2) {
                            const targetMark = asksIncorrect ? 'F' : 'V';
                            const targetEntries = vfMatches2.filter(m => String(m[2]).toUpperCase() === targetMark);
                            if (targetEntries.length === 1) {
                                const inferredLetter = String(targetEntries[0][1]).toUpperCase();
                                match = [null, inferredLetter]; // synthetic match for letter extraction below
                                console.log(`AnswerHunter: MC V/F inference → Letter ${inferredLetter} (single ${targetMark} found)`);
                            }
                        }
                    }

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

                if (validVoteCount === 0) {
                    // Debug: show first 200 chars of each attempt for troubleshooting
                    for (let i = 0; i < attempts.length; i++) {
                        if (attempts[i]) console.log(`AnswerHunter: MC attempt[${i}] preview (${attempts[i].length} chars): "${attempts[i].slice(0, 200)}"`);
                    }
                    return null;
                }
                const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
                const [winnerLetter, winnerCount] = sorted[0];
                const secondCount = sorted[1]?.[1] || 0;
                const hasRobustConsensus = winnerCount >= 2 && winnerCount > secondCount && (winnerCount / validVoteCount) >= 0.6;
                if (hasRobustConsensus) {
                    console.log(`AnswerHunter: MC consensus → Letter ${winnerLetter} (${winnerCount}/${validVoteCount})`);
                    return fullResponses[winnerLetter];
                }
                // Soft-winner: at least one valid vote but no robust consensus
                console.log(`AnswerHunter: MC soft-winner → Letter ${winnerLetter} (${winnerCount}/${validVoteCount}, low confidence)`);
                return fullResponses[winnerLetter];
            };

            if (copilotPrimary) {
                // ── Copilot PRIMARY for MC ──
                console.log(`AnswerHunter: MC via Copilot (primary, model=${settings.copilotModel || 'gpt-4o'})...`);
                const copilotAttempts = [];
                for (let i = 0; i < 2; i++) {
                    const content = await this._callCopilot([
                        { role: 'system', content: mcSystemMsg },
                        { role: 'user', content: prompt }
                    ], { model: settings.copilotModel || 'gpt-4o' });
                    if (content) copilotAttempts.push(content);
                }
                if (copilotAttempts.length > 0) {
                    const tabulated = tabulateGroqAttempts(copilotAttempts);
                    if (tabulated) return tabulated;
                }
                console.log('AnswerHunter: Copilot MC failed — trying fallbacks...');
            }

            if (chatgptPrimary) {
                // ── ChatGPT PRIMARY for MC ──
                console.log(`AnswerHunter: MC via ChatGPT (primary, model=${settings.chatgptModel || 'gpt-5.2-codex'})...`);
                const chatgptAttempts = [];
                for (let i = 0; i < 2; i++) {
                    const content = await this._callChatGPT([
                        { role: 'system', content: mcSystemMsg },
                        { role: 'user', content: prompt }
                    ], { model: settings.chatgptModel || 'gpt-5.2-codex' });
                    if (content) chatgptAttempts.push(content);
                }
                if (chatgptAttempts.length > 0) {
                    const tabulated = tabulateGroqAttempts(chatgptAttempts);
                    if (tabulated) return tabulated;
                }
                console.log('AnswerHunter: ChatGPT MC failed — trying Groq fallback...');
            }

            if (geminiPrimary) {
                // ── Gemini PRIMARY for MC ──
                console.log('AnswerHunter: MC via Gemini (primary)...');
                const gResult = await this._geminiConsensus(mcSystemMsg, prompt, mcLetterPattern, { smart: true });
                if (gResult.response) {
                    console.log('AnswerHunter: Gemini primary MC votes:', gResult.votes);
                    // If no letter extracted AND response signals missing code/context, return clean INCONCLUSIVO
                    if (!gResult.winner && CANT_ANSWER_RE.test(gResult.response)) {
                        console.log('AnswerHunter: Gemini primary MC — missing context detected, returning INCONCLUSIVO');
                        return 'INCONCLUSIVO: código ou contexto visual não disponível para resolver a questão.';
                    }
                    return gResult.response;
                }
                // Fallback to Groq
                console.log('AnswerHunter: Gemini MC failed — trying Groq fallback...');
                const groqResult = await this._groqConsensus(mcSystemMsg, prompt, mcLetterPattern, {
                    model: groqModelSmart, temps: [0.12, 0.28] // 2 attempts to preserve quota
                });
                if (groqResult.attempts.length > 0) {
                    const tabulated = tabulateGroqAttempts(groqResult.attempts);
                    if (tabulated) return tabulated;
                    // Soft fallback: use Groq's consensus winner even without robust 2-vote agreement
                    if (groqResult.winner && groqResult.response) {
                        console.log(`AnswerHunter: Groq MC soft-winner (Gemini-primary fallback) → Letter ${groqResult.winner} (single vote)`);
                        return groqResult.response;
                    }
                }
                return 'INCONCLUSIVO: sem consenso confiável entre tentativas da IA.';
            }

            if (openrouterPrimary) {
                console.log('AnswerHunter: MC via OpenRouter (primary)...');
                const openrouterAttempts = [];
                for (const temp of [0.12, 0.28]) {
                    const content = await this._callOpenRouter([
                        { role: 'system', content: mcSystemMsg },
                        { role: 'user', content: prompt }
                    ], {
                        model: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                        temperature: temp,
                        max_tokens: 700
                    });
                    if (content) openrouterAttempts.push(content);
                }
                if (openrouterAttempts.length > 0) {
                    const tabulated = tabulateGroqAttempts(openrouterAttempts);
                    if (tabulated) return tabulated;
                }
                console.log('AnswerHunter: OpenRouter MC failed — trying Groq fallback...');
            }

            // ── Groq PRIMARY for MC ──
            const groqResult = await this._groqConsensus(mcSystemMsg, prompt, mcLetterPattern, {
                model: groqModelSmart, temps: [0.12, 0.28] // 2 attempts to preserve quota
            });
            if (groqResult.attempts.length > 0) {
                const tabulated = tabulateGroqAttempts(groqResult.attempts);
                if (tabulated) return tabulated;
                // Soft fallback: use Groq's consensus winner even without robust 2-vote agreement
                if (groqResult.winner && groqResult.response) {
                    console.log(`AnswerHunter: Groq MC soft-winner → Letter ${groqResult.winner} (single vote, low confidence)`);
                    return groqResult.response;
                }
            }
            // Groq failed → Gemini fallback
            console.log('AnswerHunter: Groq MC failed — trying Gemini fallback...');
            const gResult = await this._geminiConsensus(mcSystemMsg, prompt, mcLetterPattern, { smart: true });
            if (gResult.response) {
                console.log('AnswerHunter: Gemini MC fallback votes:', gResult.votes);
                // If no letter extracted AND response signals missing code/context, return clean INCONCLUSIVO
                if (!gResult.winner && CANT_ANSWER_RE.test(gResult.response)) {
                    console.log('AnswerHunter: Gemini MC fallback — missing context detected, returning INCONCLUSIVO');
                    return 'INCONCLUSIVO: código ou contexto visual não disponível para resolver a questão.';
                }
                return gResult.response;
            }
            return 'INCONCLUSIVO: sem evidência suficiente para marcar alternativa.';
        }

        // For open-ended questions, single attempt with provider routing
        const geminiPrimaryOpen = await this._isGeminiPrimary();
        const openrouterPrimaryOpen = settings.primaryProvider === 'openrouter'
            && !!settings.openrouterApiKey
            && this._openRouterQuotaExhaustedUntil <= Date.now();
        const chatgptPrimaryOpen = settings.primaryProvider === 'chatgpt'
            && this._chatgptQuotaExhaustedUntil <= Date.now();
        const copilotPrimaryOpen = settings.primaryProvider === 'copilot'
            && this._copilotQuotaExhaustedUntil <= Date.now();
        const openSysMsg = 'Você é um assistente que responde questões com objetividade.';

        if (copilotPrimaryOpen) {
            console.log(`AnswerHunter: Open-ended via Copilot (primary, model=${settings.copilotModel || 'gpt-4o'})...`);
            const copilotOpen = await this._callCopilot([
                { role: 'system', content: openSysMsg },
                { role: 'user', content: prompt }
            ], { model: settings.copilotModel || 'gpt-4o' });
            if (copilotOpen) return copilotOpen;
            console.log('AnswerHunter: Copilot open-ended failed — trying fallbacks...');
        }

        if (chatgptPrimaryOpen) {
            console.log(`AnswerHunter: Open-ended via ChatGPT (primary, model=${settings.chatgptModel || 'gpt-5.2-codex'})...`);
            const chatgptOpen = await this._callChatGPT([
                { role: 'system', content: openSysMsg },
                { role: 'user', content: prompt }
            ], { model: settings.chatgptModel || 'gpt-5.2-codex' });
            if (chatgptOpen) return chatgptOpen;
            console.log('AnswerHunter: ChatGPT open-ended failed — trying Groq fallback...');
        }

        if (openrouterPrimaryOpen) {
            const openrouterOpen = await this._callOpenRouter([
                { role: 'system', content: openSysMsg },
                { role: 'user', content: prompt }
            ], {
                model: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                temperature: 0.15,
                max_tokens: 300
            });
            if (openrouterOpen) return openrouterOpen;
        }

        if (geminiPrimaryOpen) {
            // Gemini first for open-ended
            const geminiOpen = await this._callGemini([
                { role: 'system', content: openSysMsg },
                { role: 'user', content: prompt }
            ], { temperature: 0.15, max_tokens: 300 });
            if (geminiOpen) return geminiOpen;
        }

        // Groq for open-ended (primary or fallback)
        if (settings.groqApiKey && this._groqQuotaExhaustedUntil <= Date.now()) {
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
                if (content && content.length > 5 && !/^(NAO_ENCONTRADO|INCONCLUSIVO)/i.test(content)) return content;
            } catch (error) {
                console.warn('AnswerHunter: Groq open-ended failed:', error?.message || String(error));
            }
        }

        // Final fallback for open-ended
        console.log('AnswerHunter: Trying Gemini fallback for open-ended...');
        const geminiOpenFallback = await this._callGemini([
            { role: 'system', content: openSysMsg },
            { role: 'user', content: prompt }
        ], { temperature: 0.15, max_tokens: 300 });
        if (geminiOpenFallback) return geminiOpenFallback;

        return null;
    },

    /**
     * Define a term in context (contextual dictionary tooltip)
     */
    async defineTerm(term, contextText = '') {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelFast } = settings;

        const systemMsg = 'Você é um dicionário educacional conciso. Defina termos de forma clara e breve (2-3 linhas).';
        const prompt = contextText
            ? `Defina o termo "${term}" considerando o seguinte contexto educacional:\n\n${contextText.slice(0, 500)}\n\nDefinição breve:`
            : `Defina o termo "${term}" de forma breve e educacional. Definição:`;

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                return await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.2, max_tokens: 150, model: settings.geminiModel || 'gemini-2.5-flash' });
            } catch (e) {
                console.warn('AnswerHunter: Gemini defineTerm error:', e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                // intercept options to overwrite model
                const opts = Object.assign({}, {
                    temperature: 0.10,
                    max_tokens: 600,
                    model: settings.geminiModelSmart || 'gemini-2.5-flash'
                });
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
                    headers: { 'Authorization': `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: groqModelFast,
                        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
                        temperature: 0.2,
                        max_tokens: 150
                    })
                }));
                return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
                console.warn('AnswerHunter: Groq defineTerm error:', e?.message || e);
                return null;
            }
        };


        const geminiPrimary = false; // dummy for older vars
        const settingsForFallback = await this._getSettings();
        const primary = settingsForFallback.primaryProvider || 'groq';
        let chain = [];
        if (typeof tryOpenRouter !== 'undefined') {
            chain = [tryGroq, tryOpenRouter, tryGemini];
            if (primary === 'openrouter') chain = [tryOpenRouter, tryGemini, tryGroq];
            else if (primary === 'gemini') chain = [tryGemini, tryOpenRouter, tryGroq];
        } else {
            chain = [tryGroq, tryGemini];
            if (primary === 'gemini') chain = [tryGemini, tryGroq];
        }
        let result = null;
        for (const fn of chain) {
            result = await fn();
            if (result) {
                console.log(`%c[AH] 🎯 defineTerm → ${fn.name.replace('try', '')}`, 'color:#0ff;font-weight:bold');
                break;
            }
        }

        return result || `Termo não encontrado: ${term}`;
    },

    /**
     * Generate a step-by-step tutor explanation for a question and answer
     */
    async generateTutorExplanation(question, answer, context = '') {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelSmart } = settings;

        const systemMsg = `Você é um professor paciente, didático e experiente. Sua ÚNICA tarefa é explicar POR QUE a resposta do GABARITO está correta, de forma que qualquer estudante entenda completamente o raciocínio.

⚠️ REGRA ABSOLUTA: A resposta correta é EXATAMENTE a que está indicada no GABARITO abaixo. Você NÃO pode discordar do gabarito. Sua explicação DEVE obrigatoriamente justificar essa resposta específica do gabarito, mesmo que você pessoalmente pensasse diferente.`;

        const prompt = `QUESTÃO:
${question.slice(0, 1500)}

GABARITO (resposta correta definitiva — NÃO discorde):
${answer.slice(0, 800)}

${context ? `CONTEXTO ADICIONAL:\n${context.slice(0, 300)}\n` : ''}FORMATO OBRIGATÓRIO DA EXPLICAÇÃO:

1. Comece com: "✅ Resposta correta: [copie exatamente a letra e/ou texto da resposta do gabarito]"

2. **Contexto do tema** — Em 2-3 frases, explique o assunto/tema da questão de forma simples, como se o aluno nunca tivesse visto o tema antes.

3. **Raciocínio passo a passo** — Numere cada etapa do raciocínio (1., 2., 3., ...) que leva à resposta do gabarito:
   - Use linguagem simples e direta
   - Dê exemplos práticos quando possível
   - Conecte cada passo ao anterior

4. **Por que as outras alternativas estão erradas** — Para cada alternativa incorreta, explique brevemente (1 frase) por que está errada. Use o formato: "❌ Alternativa X: [motivo]"

5. Finalize com: "💡 Resumo: [1 frase que sintetize o conceito-chave]"

REGRAS:
- Linguagem CLARA e ACESSÍVEL — imagine que está ensinando a um aluno do ensino médio
- Máximo 450 palavras
- NUNCA contradiga o gabarito — se o gabarito diz que a resposta é X, justifique X
- Use **negrito** para termos importantes
- Se a questão não tiver alternativas, foque nos passos 1, 2, 3 e 5`;

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                return await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.3, max_tokens: 1000, model: settings.geminiModelSmart || 'gemini-2.5-flash' });
            } catch (e) {
                console.warn('AnswerHunter: Gemini generateTutorExplanation error:', e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                // intercept options to overwrite model
                const opts = Object.assign({}, { temperature: 0.3, max_tokens: 1000, model: settings.geminiModelSmart || 'gemini-2.5-flash' });
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
                    headers: { 'Authorization': `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: groqModelSmart,
                        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
                        temperature: 0.3,
                        max_tokens: 1000
                    })
                }));
                return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
                console.warn('AnswerHunter: Groq generateTutorExplanation error:', e?.message || e);
                return null;
            }
        };


        const geminiPrimary = false; // dummy for older vars
        const settingsForFallback = await this._getSettings();
        const primary = settingsForFallback.primaryProvider || 'groq';
        let chain = [];
        if (typeof tryOpenRouter !== 'undefined') {
            if (primary === 'openrouter') chain = [tryOpenRouter, tryGemini, tryGroq];
            else if (primary === 'gemini') chain = [tryGemini, tryOpenRouter, tryGroq];
            else chain = [tryGroq, tryOpenRouter, tryGemini];
        } else {
            if (primary === 'gemini') chain = [tryGemini, tryGroq];
            else chain = [tryGroq, tryGemini];
        }
        let result = null;
        for (const fn of chain) {
            result = await fn();
            if (result) {
                console.log(`%c[AH] 🎯 generateTutorExplanation → ${fn.name.replace('try', '')}`, 'color:#0ff;font-weight:bold');
                break;
            }
        }

        return result || 'Não foi possível gerar a explicação. Tente novamente.';
    },

    /**
     * Generate a concise review/study card for a question — flashcard style
     * Returns a structured text for spaced-repetition review
     */
    async generateReviewCard(question, answer, context = '') {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelSmart } = settings;

        const systemMsg = `Você é um especialista em técnicas de estudo e memorização (Anki, flashcards, revisão espaçada). Crie fichas de revisão objetivas e memoráveis.`;

        const prompt = `Crie uma FICHA DE REVISÃO concisa para o estudante memorizar o conteúdo desta questão.

QUESTÃO:
${question.slice(0, 1500)}

GABARITO:
${answer.slice(0, 800)}

${context ? `CONTEXTO:\n${context.slice(0, 300)}\n` : ''}FORMATO OBRIGATÓRIO:

📌 CONCEITO-CHAVE
[Nome do conceito/tema principal testado — 1 linha]

📖 DEFINIÇÃO RÁPIDA
[Definição objetiva do conceito em 2-3 frases curtas. Sem enrolação.]

🔑 O QUE MEMORIZAR
- [Ponto essencial 1]
- [Ponto essencial 2]
- [Ponto essencial 3]
- [Fórmula ou regra se aplicável]

⚠️ PEGADINHAS COMUNS
- [Erro comum 1 que bancas exploram]
- [Erro comum 2]

🧠 DICA DE MEMORIZAÇÃO
[Uma técnica mnemônica, analogia ou macete para lembrar — seja criativo e marcante]

🔗 TEMAS RELACIONADOS
[Liste 2-3 temas que o aluno deve estudar junto]

REGRAS:
- Máximo 250 palavras
- Linguagem direta, sem floreios
- Foque no que CAI EM PROVA
- Use **negrito** para termos-chave
- A ficha deve funcionar como material de revisão rápida antes da prova`;

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                return await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.4, max_tokens: 800, model: settings.geminiModelSmart || 'gemini-2.5-flash' });
            } catch (e) {
                console.warn('AnswerHunter: Gemini generateReviewCard error:', e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                const opts = { temperature: 0.4, max_tokens: 800, model: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free' };
                return await this._callOpenRouter([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], opts);
            } catch (e) {
                console.warn('AnswerHunter: OpenRouter generateReviewCard error:', e?.message || e);
                return null;
            }
        };

        const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: groqModelSmart,
                        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
                        temperature: 0.4,
                        max_tokens: 800
                    })
                }));
                return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
                console.warn('AnswerHunter: Groq generateReviewCard error:', e?.message || e);
                return null;
            }
        };

        const settingsForFallback = await this._getSettings();
        const primary = settingsForFallback.primaryProvider || 'groq';
        let chain = [];
        if (primary === 'openrouter') chain = [tryOpenRouter, tryGemini, tryGroq];
        else if (primary === 'gemini') chain = [tryGemini, tryOpenRouter, tryGroq];
        else chain = [tryGroq, tryOpenRouter, tryGemini];

        let result = null;
        for (const fn of chain) {
            result = await fn();
            if (result) {
                console.log(`%c[AH] 🎯 generateReviewCard → ${fn.name.replace('try', '')}`, 'color:#0ff;font-weight:bold');
                break;
            }
        }

        return result || 'Não foi possível gerar a ficha de revisão. Tente novamente.';
    },

    /**
     * Generate a similar multiple-choice question to test the user's knowledge
     * Returns { questionText, optionsMap, answerLetter } or throws on failure
     */
    async generateSimilarQuestion(originalQuestion) {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelSmart } = settings;

        const systemMsg = 'Você cria questões de múltipla escolha educacionais. Responda APENAS em JSON válido, sem texto adicional.';
        const prompt = `Com base na questão abaixo, crie UMA questão similar de múltipla escolha com 4 alternativas (A, B, C, D).

QUESTÃO ORIGINAL:
${originalQuestion.slice(0, 1000)}

FORMATO DE RESPOSTA (JSON exato, sem markdown):
{
  "questionText": "enunciado da nova questão",
  "optionsMap": {
    "A": "texto da alternativa A",
    "B": "texto da alternativa B",
    "C": "texto da alternativa C",
    "D": "texto da alternativa D"
  },
  "answerLetter": "A"
}

REGRAS:
- A questão deve testar o mesmo conceito, mas com abordagem diferente
- Apenas UMA alternativa deve ser correta
- As alternativas incorretas devem ser plausíveis
- Responda APENAS com o JSON, sem explicações adicionais`;

        const parseResponse = (content) => {
            if (!content) return null;
            try {
                const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                const parsed = JSON.parse(cleaned);
                if (!parsed.questionText || !parsed.optionsMap || !parsed.answerLetter) return null;
                return parsed;
            } catch (_) {
                return null;
            }
        };

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                const content = await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ], { temperature: 0.5, max_tokens: 500, model: settings.geminiModelSmart || 'gemini-2.5-flash' });
                return parseResponse(content);
            } catch (e) {
                console.warn('AnswerHunter: Gemini generateSimilarQuestion error:', e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                // intercept options to overwrite model
                const opts = Object.assign({}, { temperature: 0.5, max_tokens: 500, model: settings.geminiModelSmart || 'gemini-2.5-flash' });
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
                    headers: { 'Authorization': `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: groqModelSmart,
                        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
                        temperature: 0.5,
                        max_tokens: 500
                    })
                }));
                return parseResponse(data?.choices?.[0]?.message?.content?.trim() || '');
            } catch (e) {
                console.warn('AnswerHunter: Groq generateSimilarQuestion error:', e?.message || e);
                return null;
            }
        };


        const geminiPrimary = false; // dummy for older vars
        const settingsForFallback = await this._getSettings();
        const primary = settingsForFallback.primaryProvider || 'groq';
        let chain = [];
        if (typeof tryOpenRouter !== 'undefined') {
            if (primary === 'openrouter') chain = [tryOpenRouter, tryGemini, tryGroq];
            else if (primary === 'gemini') chain = [tryGemini, tryOpenRouter, tryGroq];
            else chain = [tryGroq, tryOpenRouter, tryGemini];
        } else {
            if (primary === 'gemini') chain = [tryGemini, tryGroq];
            else chain = [tryGroq, tryGemini];
        }
        let result = null;
        for (const fn of chain) {
            result = await fn();
            if (result) {
                console.log(`%c[AH] 🎯 generateSimilarQuestion → ${fn.name.replace('try', '')}`, 'color:#0ff;font-weight:bold');
                break;
            }
        }

        if (!result) throw new Error('Não foi possível gerar uma questão similar.');
        return result;
    },

    /**
     * Answer a follow-up question from the user in the context of a previous question/answer
     */
    async answerFollowUp(originalQuestion, originalAnswer, context, userMessage, messageHistory = []) {
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelSmart } = settings;

        const systemMsg = `Você é um tutor educacional. O estudante acabou de resolver uma questão e tem dúvidas.
Questão original: ${originalQuestion.slice(0, 800)}
Resposta correta: ${originalAnswer.slice(0, 300)}
${context ? `Contexto: ${context.slice(0, 200)}` : ''}

Responda de forma clara, didática e concisa (máximo 200 palavras). Não repita a questão inteira.`;

        // Build message history for multi-turn context (cap at last 6 messages)
        const recentHistory = messageHistory.slice(-6);
        const messages = [
            { role: 'system', content: systemMsg },
            ...recentHistory.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
        ];

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                return await this._callGemini(messages, {
                    temperature: 0.3,
                    max_tokens: 400,
                    model: settings.geminiModel || 'gemini-2.5-flash'
                });
            } catch (e) {
                console.warn('AnswerHunter: Gemini answerFollowUp error:', e?.message || e);
                return null;
            }
        };

        const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: groqModelSmart,
                        messages,
                        temperature: 0.3,
                        max_tokens: 400
                    })
                }));
                return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
                console.warn('AnswerHunter: Groq answerFollowUp error:', e?.message || e);
                return null;
            }
        };


        const geminiPrimary = false; // dummy for older vars
        const settingsForFallback = await this._getSettings();
        const primary = settingsForFallback.primaryProvider || 'groq';
        let chain = [];
        if (typeof tryOpenRouter !== 'undefined') {
            if (primary === 'openrouter') chain = [tryOpenRouter, tryGemini, tryGroq];
            else if (primary === 'gemini') chain = [tryGemini, tryOpenRouter, tryGroq];
            else chain = [tryGroq, tryOpenRouter, tryGemini];
        } else {
            if (primary === 'gemini') chain = [tryGemini, tryGroq];
            else chain = [tryGroq, tryGemini];
        }
        let result = null;
        for (const fn of chain) {
            result = await fn();
            if (result) {
                console.log(`%c[AH] 🎯 answerFollowUp → ${fn.name.replace('try', '')}`, 'color:#0ff;font-weight:bold');
                break;
            }
        }

        return result || 'Não foi possível processar sua pergunta. Tente novamente.';
    },

    async generateTags(questionText) {
        const settings = await this._getSettings();
        const prompt = `Analise a questão abaixo e gere de 3 a 5 tags/categorias que descrevam o tema acadêmico.

QUESTÃO:
${questionText.slice(0, 600)}

Responda APENAS com um JSON array de strings, sem explicações. Exemplo:
["Biologia", "Genética", "DNA Replicação"]

REGRAS:
- Tags curtas (1-3 palavras)
- Do mais geral para o mais específico
- Em português
- Sem tags genéricas como "Questão" ou "Múltipla Escolha"`;

        const parseResponse = (content) => {
            if (!content) return null;
            try {
                const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                const parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 5);
                return null;
            } catch (_) {
                // Try to extract tags from text
                const match = content.match(/\[.*?\]/s);
                if (match) {
                    try { return JSON.parse(match[0]).slice(0, 5); } catch (_2) { return null; }
                }
                return null;
            }
        };

        const tryChatGPT = async () => {
            if (this._chatgptQuotaExhaustedUntil > Date.now()) return null;
            try {
                const content = await this._callChatGPT([
                    { role: 'system', content: 'Você classifica questões academicamente. Responda apenas em JSON.' },
                    { role: 'user', content: prompt }
                ], {
                    temperature: 0.3,
                    max_tokens: 100,
                    model: settings.chatgptModel || 'gpt-5.2-codex'
                });
                return parseResponse(content);
            } catch (e) {
                console.warn('AnswerHunter: ChatGPT generateTags error:', e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                const content = await this._callOpenRouter([
                    { role: 'system', content: 'Você classifica questões academicamente. Responda apenas em JSON.' },
                    { role: 'user', content: prompt }
                ], {
                    temperature: 0.3,
                    max_tokens: 100,
                    model: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free'
                });
                return parseResponse(content);
            } catch (e) {
                console.warn('AnswerHunter: OpenRouter generateTags error:', e?.message || e);
                return null;
            }
        };

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            if (this._geminiQuotaExhaustedUntil > Date.now()) return null;
            try {
                const content = await this._callGemini([
                    { role: 'system', content: 'Você classifica questões academicamente. Responda apenas em JSON.' },
                    { role: 'user', content: prompt }
                ], { temperature: 0.3, max_tokens: 100, model: settings.geminiModel || 'gemini-2.5-flash' });
                return parseResponse(content);
            } catch (e) {
                console.warn('AnswerHunter: Gemini generateTags error:', e?.message || e);
                return null;
            }
        };

        const tryGroq = async () => {
            if (!settings.groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
                const content = await this._callGroq([
                    { role: 'system', content: 'Classifique a questão em JSON array de tags académicas. Responda só JSON.' },
                    { role: 'user', content: prompt }
                ], { temperature: 0.3, max_tokens: 100, model: settings.groqModelSmart || 'llama-3.3-70b-versatile' });
                return parseResponse(content);
            } catch (e) {
                console.warn('AnswerHunter: Groq generateTags error:', e?.message || e);
                return null;
            }
        };

        const tryCopilot = async () => {
            if (this._copilotQuotaExhaustedUntil > Date.now()) return null;
            try {
                const content = await this._callCopilot([
                    { role: 'system', content: 'Você classifica questões academicamente. Responda apenas em JSON.' },
                    { role: 'user', content: prompt }
                ], {
                    temperature: 0.3,
                    max_tokens: 100,
                    model: settings.copilotModel || 'gpt-4o'
                });
                return parseResponse(content);
            } catch (e) {
                console.warn('AnswerHunter: Copilot generateTags error:', e?.message || e);
                return null;
            }
        };

        const providerFns = {
            copilot: tryCopilot,
            chatgpt: tryChatGPT,
            openrouter: tryOpenRouter,
            gemini: tryGemini,
            groq: tryGroq
        };

        const primary = settings.primaryProvider || 'groq';
        const preferredOrder = primary === 'copilot'
            ? ['copilot', 'chatgpt', 'openrouter', 'gemini', 'groq']
            : primary === 'chatgpt'
                ? ['chatgpt', 'copilot', 'openrouter', 'gemini', 'groq']
                : primary === 'openrouter'
                    ? ['openrouter', 'copilot', 'chatgpt', 'gemini', 'groq']
                    : primary === 'gemini'
                        ? ['gemini', 'openrouter', 'copilot', 'chatgpt', 'groq']
                        : ['groq', 'openrouter', 'copilot', 'chatgpt', 'gemini'];

        for (const provider of preferredOrder) {
            const fn = providerFns[provider];
            if (!fn) continue;
            const tags = await fn();
            if (Array.isArray(tags) && tags.length > 0) {
                console.log(`%c[AH] 🎯 generateTags → ${provider}`, 'color:#0ff;font-weight:bold');
                return tags;
            }
        }

        return [];
    },

};
