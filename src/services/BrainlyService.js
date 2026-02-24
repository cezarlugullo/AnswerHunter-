/**
 * BrainlyService.js
 *
 * Extrai respostas diretamente do Brainly Brasil via GraphQL API.
 * TOTALMENTE AUTOMATICO — sem autenticacao necessaria.
 *
 * Fluxo:
 *   1. Serper retorna URLs brainly.com.br/tarefa/{id}
 *   2. Extrai ID numerico da URL
 *   3. Encode Relay: btoa('question:' + id)
 *   4. POST /graphql/pt → dados completos sem auth
 *   5. Retorna texto da melhor resposta
 */

export const BrainlyService = {

    GRAPHQL_URL: 'https://brainly.com.br/graphql/pt',

    extractId(url) {
        const m = String(url || '').match(/brainly\.com(?:\.br)?(?:\/pt-br)?\/tarefa\/(\d+)/);
        return m ? m[1] : null;
    },

    isBrainlyUrl(url) {
        return /brainly\.com(\.br)?/.test(String(url || '')) && /\/tarefa\//.test(String(url || ''));
    },

    _stripHtml(html) {
        return String(html || '')
            .replace(/<br\s*\/?>/ .source + 'gi', '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
    },

    async getQuestionById(numericId, timeoutMs = 8000) {
        try {
            const relayId = btoa('question:' + numericId);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            const response = await fetch(this.GRAPHQL_URL, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'content-type': 'application/json; charset=utf-8',
                    'origin': 'https://brainly.com.br',
                    'referer': 'https://brainly.com.br/tarefa/' + numericId,
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
                },
                body: JSON.stringify({
                    operationName: 'GetQuestion',
                    variables: { id: relayId },
                    query: 'query GetQuestion($id: ID!) { question(id: $id) { id content subject { name } grade { name } answers { nodes { id content rating thanksCount author { nick } } } } }'
                })
            });

            clearTimeout(timer);

            if (!response.ok) {
                console.log('[BrainlyService] HTTP ' + response.status + ' for ID ' + numericId);
                return null;
            }

            const json = await response.json();
            return json?.data?.question ?? null;

        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('[BrainlyService] Timeout for ID ' + numericId);
            } else {
                console.error('[BrainlyService] Error:', e.message);
            }
            return null;
        }
    },

    _stripHtmlClean(html) {
        return String(html || '')
            .replace(/<br[^>]*>/gi, ' ')
            .replace(/<p[^>]*>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    },

    async getAnswersFromUrls(urls, maxUrls = 3) {
        const brainlyUrls = (urls || []).filter(u => this.isBrainlyUrl(u)).slice(0, maxUrls);
        if (!brainlyUrls.length) return [];

        const results = [];
        for (const url of brainlyUrls) {
            const id = this.extractId(url);
            if (!id) continue;

            console.log('[BrainlyService] Fetching question ' + id);
            const question = await this.getQuestionById(id);
            if (!question?.answers?.nodes?.length) {
                console.log('[BrainlyService] No answers for ID ' + id);
                continue;
            }

            const sorted = [...question.answers.nodes]
                .sort((a, b) => (b.rating + b.thanksCount) - (a.rating + a.thanksCount));

            const best = sorted[0];
            const answerText = this._stripHtmlClean(best.content);
            if (!answerText || answerText.length < 10) continue;

            results.push({
                url,
                questionContent: this._stripHtmlClean(question.content),
                answerText,
                allAnswers: sorted.map(a => this._stripHtmlClean(a.content)),
                rating: best.rating,
                thanksCount: best.thanksCount,
                author: best.author?.nick || 'anon',
                subject: question.subject?.name || '',
                grade: question.grade?.name || ''
            });

            console.log('[BrainlyService] Got answer for ID ' + id + ': ' + answerText.substring(0, 80));
        }

        return results;
    }
};