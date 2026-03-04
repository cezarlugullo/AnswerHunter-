/**
 * httpHelpers.js
 *
 * Shared helpers for HTTP response error handling.
 */

/**
 * Read error text from a failed HTTP response, log it with a
 * consistent format, and return the status + body for callers.
 *
 * What it resolves:
 *   Eliminates the repeated 3-line pattern of reading errText,
 *   slicing, logging, and constructing error details that appeared
 *   identically in auth services and API adapters.
 *
 * Assumptions:
 *   - Called only when `response.ok === false`.
 *   - `response.text()` has not been consumed yet.
 *
 * Where it is used:
 *   - ChatGPTAuthService.js (token exchange error)
 *   - CopilotAuthService.js (copilot token error)
 *   - GeminiAuthService.js  (token exchange error)
 *   - GeminiCLIAuthService.js (token exchange error)
 *   - CopilotApiAdapter.js  (chatCompletion / stream errors)
 *   - GeminiCLIApiAdapter.js (generateContent / stream errors)
 *
 * @param {Response} response - The failed fetch Response object
 * @param {string} tag - Log prefix, e.g. 'ChatGPTAuth: Token exchange'
 * @param {{ logLevel?: 'warn'|'error', maxLen?: number }} [opts]
 * @returns {Promise<{ status: number, text: string }>}
 */
export async function logHttpError(response, tag, { logLevel = 'warn', maxLen = 300 } = {}) {
    const text = await response.text().catch(() => '');
    console[logLevel](`${tag} HTTP ${response.status}: ${text.slice(0, maxLen)}`);
    return { status: response.status, text };
}
