/**
 * GeminiCLIApiAdapter.js
 *
 * Adapts OpenAI-style chat completion calls to the Code Assist API
 * (cloudcode-pa.googleapis.com), which is the same backend used by the
 * Gemini CLI. This allows using the user's Gemini subscription quota.
 *
 * The API uses a Vertex AI-like request format wrapped in a Code Assist envelope.
 */
import { logHttpError } from '../utils/httpHelpers.js';

export const GeminiCLIApiAdapter = {

    BASE_URL: 'https://cloudcode-pa.googleapis.com/v1internal',

    // Models confirmed to work on the Code Assist endpoint.
    // If the user selects a model not in this map, we fall back to a safe default.
    CODE_ASSIST_MODELS: {
        'gemini-2.5-flash':    'gemini-2.5-flash',
        'gemini-2.5-pro':      'gemini-2.5-pro',
        'gemini-2.0-flash':    'gemini-2.0-flash',
        'gemini-1.5-pro':      'gemini-1.5-pro',
        'gemini-1.5-flash':    'gemini-1.5-flash',
    },

    /**
     * Map any model string to a model that Code Assist actually supports.
     * Preview / experimental IDs (e.g. gemini-3.1-flash-lite-preview) don't
     * exist on cloudcode-pa and return 404, so we map them to the closest
     * stable equivalent.
     */
    _resolveModel(requested) {
        if (this.CODE_ASSIST_MODELS[requested]) return requested;
        // Map known prefixes to safe alternatives
        if (/flash-lite|3\.1.*lite/i.test(requested))  return 'gemini-2.0-flash';
        if (/3.*flash/i.test(requested))                return 'gemini-2.5-flash';
        if (/3.*pro|ultra/i.test(requested))            return 'gemini-2.5-pro';
        if (/pro/i.test(requested))                     return 'gemini-2.5-pro';
        if (/flash/i.test(requested))                   return 'gemini-2.5-flash';
        return 'gemini-2.5-flash'; // ultimate fallback
    },

    /**
     * Call Gemini via the Code Assist generateContent endpoint.
     * Converts OpenAI-style messages to Code Assist format.
     *
     * @param {string} accessToken - OAuth access token
     * @param {string} projectId - GCP project ID from loadCodeAssist
     * @param {Array<{role:string, content:string}>} messages - OpenAI-style messages
     * @param {{model?: string, temperature?: number, max_tokens?: number}} opts
     * @returns {Promise<string|null>} The response text, or null on failure
     */
    async generateContent(accessToken, projectId, messages, opts = {}) {
        const model = this._resolveModel(opts.model || 'gemini-2.5-flash');
        const url = `${this.BASE_URL}:generateContent`;

        const { systemInstruction, contents } = this._convertMessages(messages);

        const body = {
            model,
            project: projectId,
            request: {
                contents,
                generationConfig: {
                    temperature: opts.temperature ?? 0.1,
                    maxOutputTokens: opts.max_tokens ?? 2048,
                },
            }
        };

        if (systemInstruction) {
            body.request.systemInstruction = systemInstruction;
        }

        // Thinking models need a thinking budget
        if (/pro|ultra/i.test(model) && /2\.5|3/i.test(model)) {
            let maxTokens = opts.max_tokens ?? 2048;
            if (maxTokens < 1024) maxTokens = 1024;
            body.request.generationConfig.thinkingConfig = {
                thinkingBudget: Math.max(Math.floor(maxTokens * 0.25), 256)
            };
            body.request.generationConfig.maxOutputTokens = maxTokens;
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                return { error: true, ...(await logHttpError(response, 'GeminiCLIApi: generateContent')) };
            }

            const data = await response.json();
            return this._extractResponseText(data);
        } catch (err) {
            console.error('GeminiCLIApi: generateContent error:', err);
            return null;
        }
    },

    /**
     * Streaming version using SSE.
     *
     * @param {string} accessToken
     * @param {string} projectId
     * @param {Array<{role:string, content:string}>} messages
     * @param {{model?: string, temperature?: number, max_tokens?: number}} opts
     * @returns {Promise<string|null>} Full concatenated response text
     */
    async streamGenerateContent(accessToken, projectId, messages, opts = {}) {
        const model = this._resolveModel(opts.model || 'gemini-2.5-flash');
        const url = `${this.BASE_URL}:streamGenerateContent?alt=sse`;

        const { systemInstruction, contents } = this._convertMessages(messages);

        const body = {
            model,
            project: projectId,
            request: {
                contents,
                generationConfig: {
                    temperature: opts.temperature ?? 0.1,
                    maxOutputTokens: opts.max_tokens ?? 2048,
                },
            }
        };

        if (systemInstruction) {
            body.request.systemInstruction = systemInstruction;
        }

        if (/pro|ultra/i.test(model) && /2\.5|3/i.test(model)) {
            let maxTokens = opts.max_tokens ?? 2048;
            if (maxTokens < 1024) maxTokens = 1024;
            body.request.generationConfig.thinkingConfig = {
                thinkingBudget: Math.max(Math.floor(maxTokens * 0.25), 256)
            };
            body.request.generationConfig.maxOutputTokens = maxTokens;
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                await logHttpError(response, 'GeminiCLIApi: streamGenerateContent');
                return null;
            }

            // Parse SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr || jsonStr === '[DONE]') continue;

                    try {
                        const chunk = JSON.parse(jsonStr);
                        const text = this._extractResponseText(chunk);
                        if (text) fullText += text;
                    } catch (_) { /* skip malformed chunks */ }
                }
            }

            return fullText || null;
        } catch (err) {
            console.error('GeminiCLIApi: streamGenerateContent error:', err);
            return null;
        }
    },

    // ─── Internal helpers ────────────────────────────────────────────────

    /**
     * Convert OpenAI-style messages to Vertex/Code Assist format.
     * System messages → systemInstruction, user/assistant → contents.
     */
    _convertMessages(messages) {
        let systemInstruction = null;
        const contents = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                if (!systemInstruction) {
                    systemInstruction = { role: 'system', parts: [{ text: msg.content }] };
                } else {
                    systemInstruction.parts.push({ text: msg.content });
                }
            } else {
                const role = msg.role === 'assistant' ? 'model' : 'user';
                contents.push({
                    role,
                    parts: [{ text: msg.content }]
                });
            }
        }

        // Code Assist requires at least one content entry
        if (contents.length === 0 && systemInstruction) {
            contents.push({ role: 'user', parts: [{ text: '.' }] });
        }

        return { systemInstruction, contents };
    },

    /**
     * Extract text from a Code Assist generateContent response.
     */
    _extractResponseText(data) {
        // Code Assist wraps the response: { response: { candidates: [...] } }
        const resp = data.response || data;
        const candidates = resp.candidates || [];
        if (candidates.length === 0) return null;

        const parts = candidates[0].content?.parts || [];
        let text = '';
        for (const part of parts) {
            if (part.text) text += part.text;
        }
        return text || null;
    }
};
