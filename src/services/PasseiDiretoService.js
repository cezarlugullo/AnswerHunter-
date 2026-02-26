import { NativeFetchBridgeService } from './NativeFetchBridgeService.js';
/**
 * PasseiDiretoService.js
 *
 * Extrai texto de documentos do PasseiDireto via __NEXT_DATA__ SSR.
 *
 * DISCOVERY (2026-02-24):
 *   - GET https://www.passeidireto.com/arquivo/{id}/{slug}
 *   - Retorna HTML 200 com __NEXT_DATA__ contendo pageProps.pageTextPreview
 *   - pageTextPreview = texto completo do documento (ate 25k chars)
 *   - Funciona sem autenticacao, sem cookies, sem tab!
 *   - blockToLLM = null = sem bloqueio para LLM
 *   - contentRestriction.Type = 'CR_ELEMENTS_BLUR' = apenas blur de UI
 *
 * Protecao: CloudFront CDN apenas — sem DataDome, sem Cloudflare Challenge, sem Akamai
 * Bypass: fetch() com User-Agent de browser real + Accept-Language pt-BR
 */

export const PasseiDiretoService = {

    isPasseiDiretoUrl(url) {
        return /passeidireto\.com\/(arquivo|file)\/\d+/i.test(String(url || ''));
    },

    extractFileId(url) {
        const m = String(url || '').match(/passeidireto\.com\/(?:arquivo|file)\/(\d+)/i);
        return m ? m[1] : null;
    },

    async _fetchHtml(url, timeoutMs = 12000) {
        // ── Priority 1: NativeFetchBridge (Go binary, real Chrome TLS fingerprint) ──────────
        // Routes through os-level process: no Origin header, no Sec-Fetch-Mode: cors.
        // Falls back silently if binary not installed.
        try {
            const bridgeAvailable = await Promise.race([
                NativeFetchBridgeService.isAvailable(),
                new Promise(r => setTimeout(() => r(false), 1500)),
            ]);
            if (bridgeAvailable) {
                console.log('[PasseiDiretoService] _fetchHtml via NativeFetchBridge:', url);
                const html = await NativeFetchBridgeService.fetchText(url, { timeoutMs });
                if (html && html.length > 1000) return html;
                console.warn('[PasseiDiretoService] NativeFetchBridge returned short/empty response, falling back');
            }
        } catch (e) {
            console.warn('[PasseiDiretoService] NativeFetchBridge error, falling back:', e.message);
        }

        // ── Priority 2: Direct SW fetch (may be blocked by Sec-Fetch headers) ──────────────
        // NOTE: Jina (r.jina.ai) was tested and also returns the 50KB partial SSR shell for
        // PasseiDireto — PasseiDireto CDN blocks known bot/proxy IPs the same way it blocks
        // Chrome SW context. The real solution is fetchPageSnapshot() with BackgroundTabExtractorService
        // which opens an actual Chrome tab and gets the fully JS-rendered DOM.
        //
        // This function is used only as a fast opportunistic pre-fetch:
        //  - If PasseiDireto returns full HTML (some network contexts allow it) → great, use it
        //  - If it returns the 50KB partial shell → _extractFromHtml() returns null → callers
        //    fall back to snap?.text from fetchPageSnapshot (which uses BackgroundTabExtractorService)
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache',
                }
            });
            clearTimeout(timer);
            if (!resp.ok) return '';
            return await resp.text();
        } catch (e) {
            clearTimeout(timer);
            return '';
        }
    },

    async getTextFromUrl(url, timeoutMs = 12000) {
        try {
            const html = await PasseiDiretoService._fetchHtml(url, timeoutMs);
            if (!html) return null;
            return PasseiDiretoService._extractFromHtml(html, url);
        } catch (e) {
            if (e.name === 'AbortError') console.warn('[PasseiDiretoService] Timeout:', url);
            else console.error('[PasseiDiretoService] Error:', e.message);
            return null;
        }
    },

    _extractFromHtml(html, url = '') {
        try {
            const m = html.match(/id="__NEXT_DATA__"[^>]*>(\{[\s\S]*?\})<\/script>/);
            if (!m) {
                console.warn('[PasseiDiretoService] __NEXT_DATA__ not found');
                return null;
            }
            const nd = JSON.parse(m[1]);
            const pp = nd && nd.props && nd.props.pageProps;
            if (!pp) return null;

            // pageTextPreview: string or array of strings
            const rawPreview = pp.pageTextPreview;
            let textPages = [];
            if (Array.isArray(rawPreview)) {
                textPages = rawPreview.map(p => typeof p === 'string' ? p : JSON.stringify(p));
            } else if (typeof rawPreview === 'string') {
                textPages = [rawPreview];
            }

            let combinedText = textPages.join('\n\n').trim();

            // Fallback to pageHtmlPreviews
            if (!combinedText) {
                const htmlPreviews = Array.isArray(pp.pageHtmlPreviews) ? pp.pageHtmlPreviews : [];
                combinedText = htmlPreviews
                    .map(h => PasseiDiretoService._stripHtml(String(h || '')))
                    .join('\n\n').trim();
            }

            if (!combinedText || combinedText.length < 50) {
                console.warn('[PasseiDiretoService] No usable text in NEXT_DATA');
                return null;
            }

            const file = pp.file || {};
            const isPremium = !!file.IsPremium;
            const isBlocked = pp.blockToLLM === true;
            const contentRestriction = (pp.contentRestriction && pp.contentRestriction.Type) || null;

            console.log('[PasseiDiretoService] Extracted ' + combinedText.length + ' chars | isPremium=' + isPremium + ' | blocked=' + isBlocked + ' | restriction=' + contentRestriction);

            if (isBlocked) {
                console.warn('[PasseiDiretoService] blockToLLM=true, skipping');
                return null;
            }

            return {
                text: combinedText,
                pageCount: textPages.length,
                isPremium,
                contentRestriction,
                fileName: file.Name || '',
                fileId: file.Id || PasseiDiretoService.extractFileId(url),
            };
        } catch (e) {
            console.error('[PasseiDiretoService] Parse error:', e.message);
            return null;
        }
    },

    _stripHtml(html) {
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<p[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    },

    async getTextFromUrls(urls, maxUrls = 3) {
        const pdUrls = (urls || [])
            .filter(u => PasseiDiretoService.isPasseiDiretoUrl(u))
            .slice(0, maxUrls);
        if (!pdUrls.length) return [];
        const results = await Promise.allSettled(
            pdUrls.map(async url => {
                const result = await PasseiDiretoService.getTextFromUrl(url);
                if (!result) return null;
                return { url, ...result };
            })
        );
        return results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);
    }
};
