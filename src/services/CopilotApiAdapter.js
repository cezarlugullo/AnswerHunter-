/**
 * CopilotApiAdapter.js
 *
 * Adapts OpenAI-style chat completion calls to the GitHub Copilot API
 * (api.githubcopilot.com/chat/completions), which uses the same format
 * as OpenAI's Chat Completions API.
 *
 * This allows using the user's GitHub Copilot subscription quota
 * (Individual, Business, Enterprise).
 *
 * The API is OpenAI-compatible, supporting models like:
 * - gpt-4o, gpt-4o-mini (all tiers)
 * - claude-3.5-sonnet (Pro+)
 * - o3-mini (Pro+)
 * - gemini-2.0-flash (Pro+)
 */
export const CopilotApiAdapter = {

    DEFAULT_API_URL: 'https://api.githubcopilot.com',

    /**
     * Call GitHub Copilot chat completions endpoint.
     * Format is identical to OpenAI's Chat Completions API.
     *
     * @param {string} copilotToken - Copilot API token (from CopilotAuthService)
     * @param {string} apiUrl - Base API URL (from token endpoints)
     * @param {Array<{role:string, content:string}>} messages - OpenAI-style messages
     * @param {{model?: string, temperature?: number, max_tokens?: number}} opts
     * @returns {Promise<string|null>} The response text, or null on failure
     */
    async chatCompletion(copilotToken, apiUrl, messages, opts = {}) {
        const model = opts.model || 'gpt-4o';
        const url = `${apiUrl || this.DEFAULT_API_URL}/chat/completions`;

        const body = {
            model,
            messages,
            temperature: opts.temperature ?? 0.1,
            max_tokens: opts.max_tokens ?? 2048,
            stream: false
        };

        const timeoutMs = opts.timeoutMs ?? 60000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${copilotToken}`,
                    'Content-Type': 'application/json',
                    'Editor-Version': 'vscode/1.100.0',
                    'Editor-Plugin-Version': 'copilot/1.300.0',
                    'Copilot-Integration-Id': 'vscode-chat',
                    'Openai-Intent': 'conversation-panel',
                    'User-Agent': 'GithubCopilot/1.300.0'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timer);

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.warn(`CopilotApi: chatCompletion HTTP ${response.status}: ${errText.slice(0, 300)}`);
                return { error: true, status: response.status, text: errText };
            }

            const data = await response.json();
            return this._extractResponseText(data);
        } catch (err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                console.warn(`CopilotApi: chatCompletion timeout (${timeoutMs}ms) — model=${model}`);
                return { error: true, status: 408, text: 'timeout' };
            }
            console.error('CopilotApi: chatCompletion error:', err);
            return null;
        }
    },

    /**
     * Streaming version of chat completions.
     *
     * @param {string} copilotToken
     * @param {string} apiUrl
     * @param {Array<{role:string, content:string}>} messages
     * @param {{model?: string, temperature?: number, max_tokens?: number}} opts
     * @returns {Promise<string|null>} Full concatenated response text
     */
    async streamChatCompletion(copilotToken, apiUrl, messages, opts = {}) {
        const model = opts.model || 'gpt-4o';
        const url = `${apiUrl || this.DEFAULT_API_URL}/chat/completions`;

        const body = {
            model,
            messages,
            temperature: opts.temperature ?? 0.1,
            max_tokens: opts.max_tokens ?? 2048,
            stream: true
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${copilotToken}`,
                    'Content-Type': 'application/json',
                    'Editor-Version': 'vscode/1.100.0',
                    'Editor-Plugin-Version': 'copilot/1.300.0',
                    'Copilot-Integration-Id': 'vscode-chat',
                    'Openai-Intent': 'conversation-panel',
                    'User-Agent': 'GithubCopilot/1.300.0'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.warn(`CopilotApi: streamChatCompletion HTTP ${response.status}: ${errText.slice(0, 300)}`);
                return { error: true, status: response.status, text: errText };
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
                        const delta = chunk.choices?.[0]?.delta?.content;
                        if (delta) fullText += delta;
                    } catch (_) { /* skip malformed chunks */ }
                }
            }

            return fullText || null;
        } catch (err) {
            console.error('CopilotApi: streamChatCompletion error:', err);
            return null;
        }
    },

    // ─── Internal helpers ────────────────────────────────────────────────

    /**
     * Extract text from an OpenAI-compatible chat completion response.
     */
    _extractResponseText(data) {
        const choice = data?.choices?.[0];
        if (!choice) return null;

        const content = choice.message?.content?.trim();
        return content || null;
    }
};
