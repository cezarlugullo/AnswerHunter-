/**
 * GeminiCLIApiAdapter.js
 *
 * Adapts OpenAI-style chat completion calls to the Code Assist API
 * (cloudcode-pa.googleapis.com), which is the same backend used by the
 * Gemini CLI. This allows using the user's Gemini subscription quota.
 *
 * The API uses a Vertex AI-like request format wrapped in a Code Assist envelope.
 */
export const GeminiCLIApiAdapter = {

    BASE_URL: 'https://cloudcode-pa.googleapis.com/v1internal',

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
        const model = opts.model || 'gemini-2.5-flash';
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
            body.request.generationConfig.thinkingConfig = {
                thinkingBudget: Math.max(opts.max_tokens ?? 2048, 4096)
            };
            body.request.generationConfig.maxOutputTokens = Math.max(opts.max_tokens ?? 2048, 4096);
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
                const errText = await response.text().catch(() => '');
                console.warn(`GeminiCLIApi: generateContent HTTP ${response.status}: ${errText.slice(0, 300)}`);
                return { error: true, status: response.status, text: errText };
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
        const model = opts.model || 'gemini-2.5-flash';
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
            body.request.generationConfig.thinkingConfig = {
                thinkingBudget: Math.max(opts.max_tokens ?? 2048, 4096)
            };
            body.request.generationConfig.maxOutputTokens = Math.max(opts.max_tokens ?? 2048, 4096);
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
                const errText = await response.text().catch(() => '');
                console.warn(`GeminiCLIApi: streamGenerateContent HTTP ${response.status}: ${errText.slice(0, 300)}`);
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
                    if (!line.startsWith('data: ')) continue;
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
