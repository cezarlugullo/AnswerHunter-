/**
 * ============================================================
 * SimpleSearchService.js  —  Pipeline simplificado de gabarito
 * ============================================================
 *
 * CONTEXTO / POR QUE ESTE ARQUIVO EXISTE
 * ─────────────────────────────────────────────────────────────
 * O pipeline antigo (BrainlyGQL + PasseiDireto API + EvidenceService, ~3600 linhas
 * em SearchService.js) tinha um bug crítico de remapeamento de letra:
 *
 *   Exemplo do bug:
 *     Fonte:    A) tabela  B) coluna  C) schema  D) linha  E) banco → gabarito C
 *     Usuário:  a) schema  b) coluna  c) tabela  d) linha  e) banco
 *     Bug: sistema retornava letra "C" da fonte = "tabela" para o usuário,
 *          mas o correto seria "A" = "schema" na questão do usuário.
 *
 *   Causa raiz: aiExtractFromPage retornava a LETRA da fonte, e o sistema
 *   a usava diretamente sem conferir qual texto correspondia na questão do usuário.
 *
 * SOLUÇÃO ADOTADA
 * ─────────────────────────────────────────────────────────────
 * 1. A IA retorna o TEXTO da alternativa (ex: "schema"), nunca a letra.
 * 2. OptionsMatchService.matchAnswerTextToOptions() localiza esse texto nas
 *    opções do usuário → retorna a letra correta (ex: "A").
 * 3. O texto é o elo de remapeamento — funciona independente da ordem das
 *    alternativas na fonte ou na questão do usuário.
 *
 * FLUXO COMPLETO (chamado pelo botão "Buscar")
 * ─────────────────────────────────────────────────────────────
 *  background.js
 *    → SearchService.searchOnly()          → SimpleSearchService.searchOnly()
 *    → SearchService.refineFromResults()   → SimpleSearchService.refineFromResults()
 *
 *  refineFromResults():
 *    Para cada URL (até MAX_CANDIDATES = 12, para em MAX_SOURCES = 6 válidas):
 *      A. ApiService.fetchViaJina(url)
 *            → GET https://r.jina.ai/{url}  (free proxy, retorna texto/markdown limpo)
 *            → funciona na maioria dos sites (PasseiDireto, Brainly, blogs, Medium, etc.)
 *            → NÃO funciona em: sites sem conteúdo indexável, páginas 100% JS sem SSR
 *
 *      B. Se Jina falhar E o site for SPA conhecida:
 *            → BackgroundTabExtractorService.extractFromUrl()
 *            → abre aba oculta, injeta extrator, retorna texto
 *            → SPAs suportadas: brainly, studocu, passeidireto, gauthmath, scribd, slideshare
 *            → CF-protected (studocu, gauthmath): usa CloudflareBypassService (16 evasões)
 *
 *      C. ApiService.aiExtractTextFromPage(pageText, questionText, hostHint)
 *            → envia texto da página + questão do usuário à IA
 *            → IA retorna: TEXTO_CORRETO (texto exato de uma das alternativas do usuário)
 *            → usa _callAnyProvider (Gemini → OpenRouter → Groq → ChatGPT → Copilot)
 *            → temperature=0.05 (resposta determinística)
 *
 *      D. OptionsMatchService.matchAnswerTextToOptions(answerText, originalOptionsMap)
 *            → compara o texto retornado pela IA com as opções do usuário
 *            → usa containment + token ratio + Dice coefficient
 *            → retorna { letter, confidence, method } ou null se ambíguo/baixo score
 *
 *    Votação ponderada: soma de confidence por letra → letra mais votada vence
 *    resultState: 'confirmed' se ≥2 fontes concordam e dominância ≥60%
 *                 'suggested' caso contrário
 *
 * O QUE NÃO FUNCIONA / LIMITAÇÕES CONHECIDAS
 * ─────────────────────────────────────────────────────────────
 * - Questões sem alternativas bem-formadas (OCR ruim, alternativas embutidas no enunciado)
 *   → hasOptions vai ser false → retorna [] → PopupController mostra fallback
 *
 * - Sites com CAPTCHA ativo no momento da busca
 *   → Jina retorna página de CAPTCHA (texto curto < 150 chars) → descartado
 *   → BackgroundTab pode resolver se o site estiver na lista CF_PROTECTED_SITES
 *
 * - Páginas com muitas questões diferentes (ex: provas completas no PasseiDireto)
 *   → IA pode confundir a questão correta com outra similar no mesmo texto
 *   → Mitigado pelo prompt que exige comparar enunciado E alternativas EXATAS
 *   → Se ainda assim errar, fontes concorrentes vão votar diferente → confidence baixa
 *
 * - OptionsMatchService falha em textos muito curtos ou muito genéricos
 *   (ex: alternativa "Sim" ou "Não" → matchAnswerTextToOptions retorna null)
 *
 * - Se nenhuma das 10 URLs retornar texto útil → refineFromResults retorna []
 *   → background.js cai para SearchService.answerFromAi() como último recurso
 *
 * RELACIONAMENTO COM OUTROS ARQUIVOS
 * ─────────────────────────────────────────────────────────────
 * - SearchService.js (linhas 876-878 e 970-971): redireciona TUDO para cá.
 *   O pipeline legado está preservado como dead code após o return na linha 971.
 *
 * - ApiService.js:
 *     fetchViaJina()          — linha ~1247  (wrapper Jina Reader)
 *     aiExtractTextFromPage() — linha ~1293  (novo método, retorna TEXTO não letra)
 *     aiExtractFromPage()     — linha ~1374  (método ANTIGO, retorna letra — NÃO usado aqui)
 *     _callAnyProvider()      — linha ~1106  (tenta todos os providers em ordem)
 *
 * - OptionsMatchService.js:
 *     matchAnswerTextToOptions() — linha ~169 (text→letter mapping)
 *
 * - BackgroundTabExtractorService.js:
 *     isJsHeavySpa()    — linha 26  (detecta SPAs conhecidas)
 *     extractFromUrl()  — linha 39  (abre aba oculta, extrai texto)
 *
 * - PopupController.js (_finishBackgroundSearch):
 *     Consome o retorno de refineFromResults. Espera um array com:
 *     [{ question, answer, answerLetter, answerText, resultState,
 *        confidence, evidenceTier, votes, sources[] }]
 *     sources[]: { title, link, letter, hostHint, evidenceType, weight, evidenceBlock }
 */

import { ApiService } from './ApiService.js';
import { BackgroundTabExtractorService } from './BackgroundTabExtractorService.js';
import { NativeFetchBridgeService } from './NativeFetchBridgeService.js';
import { OptionsMatchService } from './search/OptionsMatchService.js';
import { QuestionParser } from './search/QuestionParser.js';

// Quantas URLs do Serper considerar no máximo (as primeiras são as mais relevantes)
const MAX_CANDIDATES = 12;

// Parar ao atingir este número de fontes que geraram resposta válida.
const MAX_SOURCES = 6;

// Tamanho mínimo de texto para enviar à IA.
// Textos abaixo disso são páginas de erro, CAPTCHA ou redirecionamentos.
const MIN_TEXT_LENGTH = 200;

// ── URL text cache — evita re-fetch de URLs já processadas ─────────────────
const _urlTextCache = new Map();
const URL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

function _getCachedUrlText(url) {
    const entry = _urlTextCache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.ts > URL_CACHE_TTL) {
        _urlTextCache.delete(url);
        return null;
    }
    return entry.text;
}

function _setCachedUrlText(url, text) {
    if (text && text.length >= MIN_TEXT_LENGTH) {
        _urlTextCache.set(url, { text, ts: Date.now() });
    }
}

// ── Pre-warm cache — fires BackgroundTab for paywall domains during Fase 0 ──
// Promises stored here so _processSingleSource can await already-started extractions.
const _preWarmCache = new Map();

/**
 * Kicks off BackgroundTab extraction for all 'render' domain URLs in parallel.
 * Called right before Fase 0 so tabs load while snippet AI runs (~2-5s head start).
 */
function _preWarmRenderTabs(topResults) {
    _preWarmCache.clear();
    for (const r of topResults) {
        if (!r.link) continue;
        let host = '';
        try { host = new URL(r.link).hostname.replace(/^www\./, ''); } catch { continue; }
        const strategy = _getDomainStrategy(host);
        if (strategy !== 'render') continue;
        if (_preWarmCache.has(r.link)) continue;
        // Check URL text cache first — no need to open a tab
        if (_getCachedUrlText(r.link)) continue;
        console.log(`[SimpleSearch] [PREWARM] Abrindo tab para ${host} durante Fase 0…`);
        _preWarmCache.set(r.link, BackgroundTabExtractorService.extractFromUrl(r.link, { timeoutMs: 15000 }));
    }
    if (_preWarmCache.size > 0) {
        console.log(`[SimpleSearch] [PREWARM] ${_preWarmCache.size} tab(s) pré-aquecendo em paralelo`);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// A) DOMAIN STRATEGY MAP — roteamento inteligente por domínio
// ══════════════════════════════════════════════════════════════════════════════
// Classifica domínios em 3 categorias:
//   'server'  → Jina/NativeFetch funciona bem (blogs, gov, wikis)
//   'render'  → JS-heavy SPA aberto, BackgroundTab obrigatório
//   'skip'    → Login/paywall obrigatório, não perca tempo
const DOMAIN_STRATEGY = {
    // ── render: SPAs abertos que PRECISAM de JS rendering ──
    'brainly.com':       'render',
    'brainly.com.br':    'render',
    'brainly.lat':       'render',
    'brainly.co':        'render',
    'passeidireto.com':  'render',
    'studocu.com':       'render',   // CF + JS, mas extrator bypass funciona
    'gauthmath.com':     'render',   // uses standard hidden tab (not CF bypass)
    'meuguru.com':       'render',   // paywall overlay, JSON-LD available
    'slideshare.net':    'render',
    // ── skip: login/paywall obrigatório, quase sempre vazio ──
    'scribd.com':        'skip',     // paywall forte, raramente extrai algo útil
    'chegg.com':         'skip',
    'coursehero.com':    'skip',
    'quizlet.com':       'skip',     // login obrigatório
    // ── server: Jina/NativeFetch funciona bem ──
    'conhecimentolivre.org': 'server',
    'gov.br':                'server',
    'edu.br':                'server',
    'wikipedia.org':         'server',
    'medium.com':            'server',
};

/**
 * Determina a estratégia para um hostname.
 * Checa sufixos (ex: "download.inep.gov.br" → match "gov.br" → 'server').
 * Default: 'server' (Jina primeiro, BackgroundTab como fallback se SPA).
 */
function _getDomainStrategy(hostHint) {
    if (!hostHint) return 'server';
    const host = hostHint.toLowerCase();
    // Exact match first
    if (DOMAIN_STRATEGY[host]) return DOMAIN_STRATEGY[host];
    // Suffix match (ex: "download.inep.gov.br" → "gov.br")
    for (const [domain, strategy] of Object.entries(DOMAIN_STRATEGY)) {
        if (host.endsWith('.' + domain) || host === domain) return strategy;
    }
    return 'server';
}

// ══════════════════════════════════════════════════════════════════════════════
// B) MULTI-STRATEGY EXTRACTION — fallbacks quando texto principal está vazio
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tenta extrair conteúdo útil de texto cru/parcial usando múltiplas heurísticas.
 * Usa: meta tags, schema.org, padrões de gabarito, e seleção por densidade de texto.
 * @param {string} rawText - texto retornado pelo Jina/NativeFetch (pode ser parcial/shell)
 * @returns {string|null} - texto enriquecido se conseguiu extrair algo, ou null
 */
function _extractWithFallbackStrategies(rawText) {
    if (!rawText) return null;

    // Strategy 1: Procurar bloco com padrão de gabarito direto
    // Cobre: "Gabarito: B", "Resposta: I e III", "Alternativa correta: D", "Letra C"
    const gabaritoPatterns = [
        /(?:gabarito|resposta\s+correta|alternativa\s+correta|resposta)\s*[:=→\-–]\s*(?:letra\s+)?([A-E](?:\s*[-–—:)]\s*.{3,80})?)/gi,
        /\b(?:letra|alternativa)\s+([A-E])\s+(?:é\s+)?(?:a\s+)?(?:correta|certa|resposta)/gi,
        /\bcorreta\s*[:=→\-–]\s*([A-E])\b/gi,
        /\b([A-E])\s*\)\s*(?:✓|✔|★|correta|certa)/gi,
        /(?:apenas|somente)\s+(?:[IVX]+(?:\s*[,e]\s*[IVX]+)*)\s+(?:está|estão|são)\s+(?:correta|corretas)/gi,
    ];

    const gabaritoHits = [];
    for (const pattern of gabaritoPatterns) {
        let match;
        while ((match = pattern.exec(rawText)) !== null) {
            // Capture surrounding context (±150 chars)
            const start = Math.max(0, match.index - 150);
            const end = Math.min(rawText.length, match.index + match[0].length + 150);
            gabaritoHits.push(rawText.slice(start, end).trim());
        }
    }

    if (gabaritoHits.length > 0) {
        const enriched = gabaritoHits.join('\n---\n');
        console.log(`[SimpleSearch] [FALLBACK] Padrão de gabarito encontrado no texto parcial (${gabaritoHits.length} hits)`);
        return enriched.length >= MIN_TEXT_LENGTH ? enriched : null;
    }

    // Strategy 2: Procurar meta description / og:description / schema.org
    const metaPatterns = [
        /(?:description|og:description|twitter:description)["']\s*content\s*=\s*["']([^"']{50,500})["']/gi,
        /"description"\s*:\s*"([^"]{50,500})"/gi,
        /"text"\s*:\s*"([^"]{50,500})"/gi,
        /"acceptedAnswer"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{20,500})"/gi,
    ];

    const metaHits = [];
    for (const pattern of metaPatterns) {
        let match;
        while ((match = pattern.exec(rawText)) !== null) {
            metaHits.push(match[1].trim());
        }
    }

    if (metaHits.length > 0) {
        const enriched = metaHits.join('\n');
        console.log(`[SimpleSearch] [FALLBACK] Meta/Schema.org encontrado (${metaHits.length} blocos)`);
        return enriched.length >= 80 ? enriched : null;
    }

    // Strategy 3: Selecionar blocos densos de texto (boilerpipe-like)
    // Divide em parágrafos, filtra os que têm alta densidade de palavras (não são menus/nav)
    const paragraphs = rawText.split(/\n{2,}|\r\n\r\n/);
    const denseBlocks = paragraphs.filter(p => {
        const trimmed = p.trim();
        if (trimmed.length < 60) return false;
        const words = trimmed.split(/\s+/).length;
        // "Dense" = at least 15 words per block
        if (words < 15) return false;
        // Not a menu/nav: shouldn't have too many links/items per line
        const lines = trimmed.split(/\n/).length;
        if (words / lines < 5) return false;
        return true;
    });

    if (denseBlocks.length > 0) {
        const enriched = denseBlocks.join('\n\n');
        if (enriched.length >= MIN_TEXT_LENGTH) {
            console.log(`[SimpleSearch] [FALLBACK] Blocos densos extraídos (${denseBlocks.length} parágrafos, ${enriched.length} chars)`);
            return enriched;
        }
    }

    return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// C) DOMAIN EXTRACTION CACHE — lembra qual método funcionou por domínio
// ══════════════════════════════════════════════════════════════════════════════
const _domainMethodCache = new Map(); // hostHint → { method: 'jina'|'firecrawl'|'native'|'wayback'|'bgtab', selector?: string, hits: number, lastUsed: number }

/**
 * Registra que um método de extração funcionou para um domínio.
 */
function _cacheSuccessfulMethod(hostHint, method) {
    if (!hostHint) return;
    const existing = _domainMethodCache.get(hostHint);
    if (existing) {
        existing.hits++;
        existing.lastUsed = Date.now();
        existing.method = method;
    } else {
        _domainMethodCache.set(hostHint, { method, hits: 1, lastUsed: Date.now() });
    }
    // Evict old entries (keep max 50)
    if (_domainMethodCache.size > 50) {
        let oldest = null;
        for (const [key, val] of _domainMethodCache) {
            if (!oldest || val.lastUsed < oldest.lastUsed) oldest = { key, ...val };
        }
        if (oldest) _domainMethodCache.delete(oldest.key);
    }
}

/**
 * Retorna o método que já funcionou para um domínio, ou null.
 */
function _getCachedMethod(hostHint) {
    if (!hostHint) return null;
    const entry = _domainMethodCache.get(hostHint);
    if (!entry) return null;
    // Cache entry expira após 30 minutos
    if (Date.now() - entry.lastUsed > 30 * 60 * 1000) {
        _domainMethodCache.delete(hostHint);
        return null;
    }
    return entry.method;
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Processa uma única URL candidata: busca texto (Jina ou NativeFetch),
 * extrai o gabarito via IA, e remapeia o texto para a letra do usuário.
 * Retorna sempre um objeto attempt: { success, hostHint, link, title, letter, answerText, confidence }.
 * Em falha: success=false, letter=null. Em sucesso: success=true com todos os campos.
 * @param {{ cancelled: boolean }} cancel - token compartilhado; aborta se true
 * @param {boolean} [allowBgTab=false] - se true, tenta BackgroundTab como último recurso
 */
async function _processSingleSource(result, idx, total, questionForInference, originalOptionsMap, onStatus, cancel = {}, allowBgTab = false) {
    const { link, title, snippet } = result;
    let hostHint = '';
    if (link) {
        try { hostHint = new URL(link).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    }
    const _fail = (reason) => {
        console.log(`[SimpleSearch] [BLOCKED] ${reason}`);
        console.groupEnd();
        return { success: false, hostHint, link: link || '', title: title || hostHint, letter: null, answerText: null, confidence: null };
    };

    if (!link) return _fail('URL vazia');

    if (typeof onStatus === 'function') {
        onStatus(` Lendo fonte ${idx} de ${total}: ${hostHint}`);
    }

    console.group(`[SimpleSearch] [SEARCH] Fonte ${idx}: ${hostHint}`);

    // ── A) Domain Strategy routing ──────────────────────────────────────────
    const strategy = _getDomainStrategy(hostHint);
    const isSpa = BackgroundTabExtractorService.isJsHeavySpa(link);
    const cachedMethod = _getCachedMethod(hostHint);

    // Skip domains que quase sempre exigem login (paywall/account required)
    if (strategy === 'skip') {
        return _fail(`Domínio ${hostHint} marcado como 'skip' (login/paywall obrigatório)`);
    }

    let pageText = null;
    let usedMethod = null;

    // ── URL text cache hit: evita re-fetch de URLs já processadas ───────────
    const cachedUrlText = _getCachedUrlText(link);
    if (cachedUrlText) {
        pageText = cachedUrlText;
        usedMethod = 'url-cache';
        console.log(`[SimpleSearch] [CACHE] URL text cache hit: ${pageText.length} chars`);
    }

    // ── Pre-warm hit: tab já foi aberta durante Fase 0, só aguardar resultado ──
    if (!pageText && _preWarmCache.has(link)) {
        try {
            const preWarmed = _preWarmCache.get(link);
            _preWarmCache.delete(link);
            pageText = await preWarmed;
            if (pageText) { usedMethod = 'bgtab-prewarm'; console.log(`[SimpleSearch] [OK] BackgroundTab (pre-warm): ${pageText.length} chars`); }
        } catch (e) { console.warn(`[SimpleSearch] BackgroundTab (pre-warm) erro:`, e?.message); }
    }

    // ── C) Cache hit: usar o método que já funcionou antes ──────────────────
    if (cachedMethod) {
        console.log(`[SimpleSearch] [CACHE] ${hostHint}: usando método cacheado "${cachedMethod}"`);
        if (cachedMethod === 'bgtab' && allowBgTab) {
            try {
                pageText = await BackgroundTabExtractorService.extractFromUrl(link, { timeoutMs: 15000 });
                if (pageText) { usedMethod = 'bgtab'; console.log(`[SimpleSearch] [OK] BackgroundTab (cached): ${pageText.length} chars`); }
            } catch (e) { console.warn(`[SimpleSearch] BackgroundTab (cached) erro:`, e?.message); }
        } else if (cachedMethod === 'native') {
            try {
                const nativeAvail = await NativeFetchBridgeService.isAvailable();
                if (nativeAvail) {
                    pageText = await NativeFetchBridgeService.fetchText(link);
                    if (pageText) { usedMethod = 'native'; console.log(`[SimpleSearch] [OK] NativeFetch (cached): ${pageText.length} chars`); }
                }
            } catch (_) { /* silencioso */ }
        } else if (cachedMethod === 'firecrawl') {
            pageText = await ApiService.fetchViaFirecrawl(link);
            if (pageText) { usedMethod = 'firecrawl'; }
        } else if (cachedMethod === 'wayback') {
            pageText = await ApiService.fetchViaWayback(link);
            if (pageText) { usedMethod = 'wayback'; }
        } else {
            pageText = await ApiService.fetchViaJina(link);
            if (pageText) { usedMethod = 'jina'; }
        }
    }

    // ── Sem cache hit: escolher por strategy ────────────────────────────────
    if (!pageText) {
        // BackgroundTab-first SÓ quando allowBgTab=true (Fase 2) E é SPA/render
        // Na Fase 1, Jina vai primeiro — texto parcial > zero texto.
        const useRenderFirst = allowBgTab && (strategy === 'render' || isSpa);

        if (useRenderFirst) {
            console.log(`[SimpleSearch] [BGFIRST] ${hostHint}: Fase 2 + SPA/render → BackgroundTab primeiro`);
            try {
                pageText = await BackgroundTabExtractorService.extractFromUrl(link, { timeoutMs: 15000 });
                if (pageText) { usedMethod = 'bgtab'; console.log(`[SimpleSearch] [OK] BackgroundTab: ${pageText.length} chars`); }
            } catch (e) { console.warn(`[SimpleSearch] BackgroundTab erro:`, e?.message); }
        }

        // Jina → Firecrawl → NativeFetch → Wayback (cadeia de fallbacks server-side)
        if (!pageText && !cancel.cancelled) {
            pageText = await ApiService.fetchViaJina(link);
            if (pageText) usedMethod = 'jina';

            // Firecrawl: retorna markdown limpo, renderiza JS (free 500/mês)
            if (!pageText && !cancel.cancelled) {
                pageText = await ApiService.fetchViaFirecrawl(link);
                if (pageText) { usedMethod = 'firecrawl'; console.log(`[SimpleSearch] [OK] Firecrawl: ${pageText.length} chars`); }
            }

            if (!pageText && !cancel.cancelled) {
                try {
                    const nativeAvail = await NativeFetchBridgeService.isAvailable();
                    if (nativeAvail) {
                        console.log(`[SimpleSearch] [RETRY] Jina/Firecrawl falhou → tentando NativeFetch (TLS bypass)...`);
                        pageText = await NativeFetchBridgeService.fetchText(link);
                        if (pageText) { usedMethod = 'native'; console.log(`[SimpleSearch] [OK] NativeFetch: ${pageText.length} chars`); }
                    }
                } catch (_) { /* binário não instalado ou erro — silencioso */ }
            }

            // Wayback Machine: versão arquivada (grátis, sem limite)
            if (!pageText && !cancel.cancelled) {
                console.log(`[SimpleSearch] [RETRY] Server fetch falhou → tentando Wayback Machine...`);
                pageText = await ApiService.fetchViaWayback(link);
                if (pageText) { usedMethod = 'wayback'; console.log(`[SimpleSearch] [OK] Wayback: ${pageText.length} chars`); }
            }
        }

        // BackgroundTab fallback final (quando server fetch falhou, BgTab está disponível, e não tentamos antes)
        // Tenta para QUALQUER domínio — extração genérica (textContent) funciona em qualquer site.
        if (!pageText && !cancel.cancelled && allowBgTab && !useRenderFirst) {
            console.log(`[SimpleSearch] [RETRY] Todos métodos server falharam → tentando BackgroundTab...`);
            try {
                pageText = await BackgroundTabExtractorService.extractFromUrl(link, { timeoutMs: 15000 });
                if (pageText) { usedMethod = 'bgtab'; }
            } catch (e) { console.warn(`[SimpleSearch] BackgroundTab erro:`, e?.message); }
        }
    }

    // ── B) Multi-strategy extraction fallbacks ──────────────────────────────
    // Se o texto retornado é curto demais, tentar extrair gabarito de texto parcial
    if (pageText && pageText.length < MIN_TEXT_LENGTH) {
        console.log(`[SimpleSearch] [FALLBACK] Texto muito curto (${pageText.length} chars), tentando estratégias alternativas...`);
        const enriched = _extractWithFallbackStrategies(pageText);
        if (enriched) pageText = enriched;
    }

    // Se mesmo com fallback não temos texto suficiente, falhar
    if (!pageText || pageText.length < MIN_TEXT_LENGTH) {
        return _fail(`Sem texto útil (len=${pageText?.length || 0})`);
    }

    // ── C) Registrar método que funcionou ───────────────────────────────────
    if (usedMethod) _cacheSuccessfulMethod(hostHint, usedMethod === 'bgtab-prewarm' ? 'bgtab' : usedMethod);
    // Save to URL text cache for future re-use
    if (pageText && usedMethod !== 'url-cache') _setCachedUrlText(link, pageText);

    // Aborta antes de chamar a IA se já temos fontes suficientes — evita rate limit 429
    if (cancel.cancelled) {
        return _fail('Cancelado — fontes suficientes coletadas');
    }

    console.log(`[SimpleSearch] [OK] ${pageText.length} chars obtidos`);

    const aiResult = await ApiService.aiExtractTextFromPage(pageText, questionForInference, hostHint);

    if (!aiResult?.answerText) {
        // Check for ENCONTRADO_FORA: source has the answer but alternatives are mismatched
        if (aiResult?.rawSourceAnswer) {
            // First: try to match the raw answer text against current alternatives
            // This handles the "position shift" case: same question, different year, letter moved from B to D
            const rawMatch = OptionsMatchService.matchAnswerTextToOptions(aiResult.rawSourceAnswer, originalOptionsMap);
            if (rawMatch?.letter) {
                const letter = rawMatch.letter;
                const confidence = Math.min(aiResult.confidence || 0.70, rawMatch.confidence || 0.70);
                const shifted = !!(aiResult.sourceLetter && aiResult.sourceLetter !== letter);
                if (shifted) {
                    console.log(`[SimpleSearch] [SHUFFLE] ${hostHint}: POSIÇÃO DIFERENTE — fonte diz "${aiResult.sourceLetter}" mas texto está em "${letter}" na questão atual`);
                } else {
                    console.log(`[SimpleSearch] [SHUFFLE] ${hostHint}: rawAnswer matched → ${letter}) conf=${confidence.toFixed(2)}`);
                }
                console.groupEnd();
                return {
                    success: true,
                    hostHint,
                    link: link || '',
                    title: title || hostHint,
                    letter,
                    answerText: originalOptionsMap[letter],
                    confidence,
                    evidence: aiResult.evidence || snippet || '',
                    positionShifted: shifted || true,
                    sourceOriginalLetter: aiResult.sourceLetter || null
                };
            }
            console.log(`[SimpleSearch] [PIN] ${hostHint}: fonte tem gabarito mas não casa com alternativas: "${aiResult.rawSourceAnswer.slice(0, 80)}"`);
            console.groupEnd();
            return {
                success: false,
                hasRawAnswer: true,
                rawAnswer: aiResult.rawSourceAnswer,
                sourceLetter: aiResult.sourceLetter || null,
                evidence: aiResult.evidence || snippet || '',
                hostHint,
                link: link || '',
                title: title || hostHint,
                letter: null,
                answerText: null,
                confidence: null
            };
        }
        return _fail('IA: nenhum texto de resposta encontrado');
    }

    const matchResult = OptionsMatchService.matchAnswerTextToOptions(aiResult.answerText, originalOptionsMap);

    if (!matchResult?.letter) {
        // Text matching failed but AI DID find an answer — preserve it as rawAnswer
        // so the LLM consensus mechanism (aiConsolidateExtractedAnswers) can evaluate it
        const rawText = aiResult.answerText || '';
        console.log(`[SimpleSearch] [RAW] ${hostHint}: match falhou, preservando para consenso LLM: "${rawText.slice(0, 80)}"`);
        console.groupEnd();
        return {
            success: false,
            hasRawAnswer: true,
            rawAnswer: rawText,
            sourceLetter: aiResult.sourceLetter || null,
            evidence: aiResult.evidence || snippet || '',
            hostHint,
            link: link || '',
            title: title || hostHint,
            letter: null,
            answerText: null,
            confidence: null
        };
    }

    const letter = matchResult.letter;
    // Detect position shift: source explicitly cited a different letter than what text matching found
    const sourceLetter = aiResult.sourceLetter || null;
    const positionShifted = !!(sourceLetter && sourceLetter !== letter);
    if (positionShifted) {
        console.log(`[SimpleSearch] [SHUFFLE] ${hostHint}: POSIÇÃO DIFERENTE — fonte cita "${sourceLetter}" mas texto atual está em "${letter}"`);
    }
    const confidence = Math.min(
        aiResult.confidence || 0.85,
        matchResult.confidence || 0.85
    );

    console.log(`[SimpleSearch] [TEST] Candidato da fonte (${hostHint}): ${letter}) ${originalOptionsMap[letter]} (conf=${confidence.toFixed(2)}, match="${matchResult.method}")`);
    console.groupEnd();

    return {
        success: true,
        title: title || hostHint,
        link,
        letter,
        answerText: originalOptionsMap[letter],
        evidence: aiResult.evidence || snippet || '',
        confidence,
        hostHint,
        evidenceType: 'jina-ai-text',
        positionShifted: positionShifted || false,
        sourceOriginalLetter: sourceLetter
    };
}

/**
 * Executa todos os processadores de fonte em paralelo e resolve assim que
 * maxSources resultados válidos forem coletados (ou todas as fontes esgotem).
 * Substitui o for-loop sequencial — elimina o tempo de espera das fontes falhas.
 * Usa um cancel token para impedir que fontes em-flight abram BackgroundTabs desnecessárias.
 * @param {boolean} [allowBgTab=false] - se true, permite BackgroundTab como último recurso
 * @param {Array} [priorSources=[]] - fontes já coletadas em fases anteriores (para herança de votos)
 */
function _collectFirstNSources(topResults, questionForInference, originalOptionsMap, minSources, maxSources, onStatus, allowBgTab = false, priorSources = []) {
    return new Promise((resolve) => {
        const total = topResults.length;
        if (total === 0) { resolve({ sources: [], allAttempts: [] }); return; }

        const sources = [];      // apenas tentativas com success=true
        const allAttempts = [];  // todas as tentativas (para tabela de diagnóstico)
        let settled = 0;
        let launched = 0;
        let resolved = false;
        const cancel = { cancelled: false };
        const CONCURRENCY = 4;  // Max concurrent source processors (prevents quota exhaustion)

        // Pre-compute inherited votes from prior phases (Fase 0 snippets, Fase 1, Scholar)
        const priorVotes = {};
        for (const src of priorSources) {
            if (src.letter) priorVotes[src.letter] = (priorVotes[src.letter] || 0) + (src.confidence || 0);
        }
        if (Object.keys(priorVotes).length > 0) {
            console.log(`[SimpleSearch] [VOTE_INHERIT] Fase anterior contribuiu ${priorSources.length} voto(s):`, priorVotes);
        }

        const checkDoneAndLaunchMore = () => {
            if (resolved) return;

            // Check consensus among successful sources + inherited votes
            let consensusScore = 0;
            const allSourceCount = sources.length + priorSources.length;
            if (allSourceCount > 0) {
                const votes = { ...priorVotes };
                for (const src of sources) votes[src.letter] = (votes[src.letter] || 0) + (src.confidence || 0);
                const totalScore = Object.values(votes).reduce((a, b) => a + b, 0);
                const bestScore = Math.max(...Object.values(votes));
                consensusScore = totalScore > 0 ? bestScore / totalScore : 0;
            }

            // Early exit conditions:
            // 1. We hit minSources AND consensus is strong (>= 0.6)
            //    OR we have ≥1 new source + prior votes AND combined consensus ≥ 0.6
            // 2. We hit maxSources (hard limit)
            // 3. We exhausted all available results
            const hasEnoughSources = sources.length >= minSources
                || (sources.length >= 1 && priorSources.length > 0);
            const strongConsensus = hasEnoughSources && consensusScore >= 0.6;

            if (strongConsensus || sources.length >= maxSources || settled >= total) {
                if (!resolved) {
                    if (strongConsensus && sources.length < maxSources && typeof onStatus === 'function') {
                        onStatus(` Consenso forte atingido (${(consensusScore * 100).toFixed(0)}%), ignorando mais fontes...`);
                    } else if (sources.length >= minSources && sources.length < maxSources && !strongConsensus) {
                        if (typeof onStatus === 'function') onStatus(' Consenso fraco, expandindo busca para desempatar...');
                    }
                    resolved = true;
                    cancel.cancelled = true;
                    resolve({ sources: [...sources], allAttempts: [...allAttempts] });
                }
                return;
            }

            // Launch more sources if we have available concurrency slots
            launchMore();
        };

        const launchOne = (idx) => {
            const result = topResults[idx];
            _processSingleSource(result, idx + 1, total, questionForInference, originalOptionsMap, onStatus, cancel, allowBgTab)
                .then(attempt => {
                    settled++;
                    if (attempt) {
                        allAttempts.push(attempt);
                        if (attempt.success && !resolved) sources.push(attempt);
                    }
                    checkDoneAndLaunchMore();
                })
                .catch(() => {
                    settled++;
                    checkDoneAndLaunchMore();
                });
        };

        const launchMore = () => {
            while (launched < total && !resolved && (launched - settled) < CONCURRENCY) {
                launchOne(launched);
                launched++;
            }
        };

        // Start initial batch (up to CONCURRENCY)
        launchMore();
    });
}

/**
 * Retorna o candidato com maior score de votos ponderados das fontes coletadas até agora.
 * Usado pela Fase 3 para construir a query de confirmação (espelha "Turno 6" do fluxo humano).
 * @returns {{ letter: string, answerText: string, avgConf: number }|null}
 */
function _getLeadingCandidate(sources) {
    if (!sources || sources.length === 0) return null;
    const votes = {};
    for (const src of sources) {
        if (!votes[src.letter]) votes[src.letter] = { score: 0, answerText: src.answerText, count: 0 };
        votes[src.letter].score += src.confidence || 0;
        votes[src.letter].count += 1;
    }
    // Desempate estável: score → count → ordem alfabética
    const best = Object.entries(votes).sort((a, b) =>
        b[1].score - a[1].score || b[1].count - a[1].count || a[0].localeCompare(b[0])
    )[0];
    if (!best) return null;
    const [letter, data] = best;
    return { letter, answerText: data.answerText || '', avgConf: data.count > 0 ? data.score / data.count : 0 };
}

/**
 * Retorna TODOS os candidatos empatados com o líder (mesmo score).
 * Usado pela Fase 3 para confirmar todos os candidatos em disputa.
 */
function _getTiedCandidates(sources) {
    if (!sources || sources.length === 0) return [];
    const votes = {};
    for (const src of sources) {
        if (!votes[src.letter]) votes[src.letter] = { score: 0, answerText: src.answerText, count: 0 };
        votes[src.letter].score += src.confidence || 0;
        votes[src.letter].count += 1;
    }
    const sorted = Object.entries(votes).sort((a, b) =>
        b[1].score - a[1].score || b[1].count - a[1].count || a[0].localeCompare(b[0])
    );
    if (sorted.length === 0) return [];
    const topScore = sorted[0][1].score;
    return sorted
        .filter(([, data]) => Math.abs(data.score - topScore) < 0.001)
        .map(([letter, data]) => ({
            letter,
            answerText: data.answerText || '',
            avgConf: data.count > 0 ? data.score / data.count : 0
        }));
}

export const SimpleSearchService = {

    /**
     * searchOnly — Passo 1: busca URLs no Serper para a questão dada.
     *
     * Chamado por SearchService.searchOnly(), que é chamado por background.js
     * quando o usuário clica em "Buscar" (antes de refineFromResults).
     *
     * Retorna o array bruto do Serper: [{ title, link, snippet, ... }]
     * Não faz nenhuma análise — apenas obtém os candidatos.
     *
     * @param {string} questionText - Texto da questão (sem alternativas geralmente)
     * @returns {Promise<Array>}
     */
    async searchOnly(questionText) {
        const results = await ApiService.searchWithSerper(questionText);
        return results || [];
    },

    /**
     * refineFromResults — Passos 2-5: para cada URL candidata, extrai o gabarito via IA.
     *
     * Chamado por SearchService.refineFromResults(), que é chamado por background.js
     * com os resultados de searchOnly + a questão completa com alternativas.
     *
     * IMPORTANTE: originalQuestionWithOptions deve conter a questão COM as alternativas
     * no formato "A) texto\nB) texto\n..." para que o mapa de opções seja construído.
     * Se vier vazio, usa questionText como fallback (mas a extração vai falhar se não
     * tiver alternativas).
     *
     * @param {string}   questionText               - Texto da questão (pode ser sem opções)
     * @param {Array}    results                    - Array de resultados do Serper
     * @param {string}   [originalQuestionWithOptions=''] - Questão COMPLETA com alternativas
     * @param {Function} [onStatus=null]            - Callback de status para a UI (ex: "Analisando 2/10...")
     * @returns {Promise<Array>} Array com 0 ou 1 objeto de resultado
     */
    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║  ⛔ refineFromResults — PIPELINE DE GABARITO — NÃO MODIFIQUE     ║
    // ║                                                                   ║
    // ║  Este método constrói o mapa de opções do usuário, busca em       ║
    // ║  múltiplas fontes (Serper, Scholar, Jina), extrai respostas       ║
    // ║  via LLM (snippets + aiExtract), e faz remapeamento texto→letra.  ║
    // ║                                                                   ║
    // ║  CORRIGIDO: sanitizeOptionsMap valida coerência stem↔opções.      ║
    // ║  CORRIGIDO: QuestionParser.extractOptionsFromQuestion já limpa    ║
    // ║  letras fundidas antes de chegar aqui.                            ║
    // ║                                                                   ║
    // ║  NÃO ALTERE o mapa de opções, a lógica de matching texto→letra,  ║
    // ║  nem os thresholds de confiança. Cada um corrige um bug real.     ║
    // ║  Última calibração: 2026-03-04                                    ║
    // ╚═══════════════════════════════════════════════════════════════════╝
    async refineFromResults(questionText, results, originalQuestionWithOptions = '', onStatus = null, visionGuidedParsed = null) {
        if (!results || results.length === 0) return [];

        // Prefere a versão completa (com alternativas) para enviar à IA
        const questionForInference = originalQuestionWithOptions || questionText;

        // ── Construção do mapa de opções do usuário ──────────────────────────────
        // Ex: { A: 'Chave de partição', B: 'Chave primária', C: 'Chave composta', ... }
        // Este mapa é a referência para remapear o texto retornado pela IA → letra correta.
        //
        // FAST PATH: se visionGuidedParsed estiver disponível, usa as alternativas já
        // corretamente separadas pela LLM — evita que QuestionParser pegue itens do
        // enunciado (ex: "A. %d") em vez das alternativas reais de múltipla escolha.
        let originalOptionsMap = {};
        if (visionGuidedParsed && Array.isArray(visionGuidedParsed.alternatives) && visionGuidedParsed.alternatives.length >= 2) {
            for (const alt of visionGuidedParsed.alternatives) {
                if (alt.letter && alt.body) {
                    originalOptionsMap[alt.letter.toUpperCase()] = alt.body.trim();
                }
            }
            console.log('[SimpleSearch] [visionGuided] Usando mapa de opções da extração LLM:', originalOptionsMap);
        } else {
            // QuestionParser.extractOptionsFromQuestion() suporta variações de formato:
            //   "A) texto", "a) texto", "A. texto", "(A) texto", etc.
            const options = QuestionParser.extractOptionsFromQuestion(questionForInference);
            for (const opt of options) {
                const m = opt.match(/^([A-E])\)\s*(.+)$/is);
                if (m) originalOptionsMap[m[1].toUpperCase()] = m[2].trim();
            }
        }

        const sanitizeOptionsMap = (stemText, rawMap) => {
            const orderedLetters = ['A', 'B', 'C', 'D', 'E'];
            const entries = orderedLetters
                .filter((letter) => rawMap && rawMap[letter])
                .map((letter) => ({
                    letter,
                    body: QuestionParser.stripOptionTailNoise(rawMap[letter] || '')
                }))
                .filter((entry) => !!entry.body);

            const contiguous = [];
            for (let i = 0; i < entries.length; i++) {
                const expected = String.fromCharCode(65 + i);
                if (entries[i].letter !== expected) break;
                contiguous.push(entries[i]);
            }
            let working = contiguous.length >= 2 ? contiguous : entries;

            const lengths = working.map((entry) => entry.body.length).sort((a, b) => a - b);
            const medianLen = lengths.length > 0 ? lengths[Math.floor(lengths.length / 2)] : 0;
            const leakMarkers = /\b(?:considere|assinale|marque|associe|associa[cç][aã]o|sobre a|sobre o|s[aã]o corretas|est[aã]o corretas|analise|verifique|qual(?:is)?\b|quest[aã]o|pergunta)\b/i;
            const questionishBodyRe = /\b(?:marque|assinale|considere|associe|qual(?:is)?|pergunta|quest[aã]o)\b/i;
            const hardLeakPattern = /\b(?:\d{1,2}\s+(?:marcar|revis[aã]o|quest[aã]o|um|uma|voce|você)|marcar\s+para\s+revis[aã]o)\b/i;

            working = working.filter((entry) => {
                const body = String(entry.body || '').trim();
                if (!body || !QuestionParser.isUsableOptionBody(body)) return false;
                if (body.length > 320) return false;
                if (hardLeakPattern.test(body)) return false;
                if (body.length >= 45 && questionishBodyRe.test(body)) return false;
                if (medianLen > 0 && body.length > Math.max(90, medianLen * 3.5) && leakMarkers.test(body)) return false;
                return true;
            });

            const deduped = [];
            const seen = new Set();
            for (const entry of working) {
                const norm = QuestionParser.looksLikeCodeOption(entry.body)
                    ? QuestionParser.normalizeCodeAwareOption(entry.body)
                    : QuestionParser.normalizeOption(entry.body);
                if (!norm || seen.has(norm)) continue;
                seen.add(norm);
                deduped.push(entry);
            }

            const sanitized = {};
            for (const entry of deduped) sanitized[entry.letter] = entry.body;

            // Reliability: require lexical contact between stem and at least one option when options are verbose.
            const tokenize = (text) => String(text || '')
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, ' ')
                .trim()
                .split(/\s+/)
                .filter((t) => t.length >= 4);
            const stemTokens = tokenize(stemText);
            const stemSet = new Set(stemTokens);
            const optionEntries = Object.entries(sanitized);
            const verboseOptions = optionEntries.filter(([, body]) => String(body || '').length >= 22);
            const overlapHits = verboseOptions.reduce((acc, [, body]) => {
                const hit = tokenize(body).some((tk) => stemSet.has(tk));
                return acc + (hit ? 1 : 0);
            }, 0);

            const contiguousLetters = (() => {
                const letters = Object.keys(sanitized).sort();
                if (letters.length === 0) return false;
                for (let i = 0; i < letters.length; i++) {
                    if (letters[i] !== String.fromCharCode(65 + i)) return false;
                }
                return true;
            })();

            const reliable = optionEntries.length >= 3
                && contiguousLetters
                && (verboseOptions.length === 0 || stemTokens.length < 6 || overlapHits >= 1);

            return {
                map: sanitized,
                reliable,
                contiguous: contiguousLetters
            };
        };

        const optionIntegrity = sanitizeOptionsMap(questionText, originalOptionsMap);
        originalOptionsMap = optionIntegrity.map;

        const hasOptions = Object.keys(originalOptionsMap).length >= 2;
        if (!hasOptions) {
            // Sem alternativas válidas não é possível fazer remapeamento texto→letra.
            // Isso acontece quando: OCR não capturou as alternativas, questão é dissertativa,
            // ou o formato das opções não foi reconhecido pelo QuestionParser.
            console.log('[SimpleSearch] [WARN] Sem alternativas válidas — abortando');
            return [];
        }

        if (!optionIntegrity.reliable) {
            console.log('[SimpleSearch] [WARN] Mapa de opções parcial/inconsistente após sanitização; busca seguirá com opções limpas.');
        }
        console.log('[SimpleSearch] Mapa de opções:', originalOptionsMap);

        // ── Validação de coerência enunciado↔alternativas ─────────────────────────
        // Reproduz o raciocínio humano: antes de buscar, perguntar à IA se as
        // alternativas fazem sentido para o enunciado — detecta casos como questão
        // sobre IHC com alternativas coladas de outra questão ("Segurança de mensagens",
        // "Integração com redes sociais", etc.).
        // Falha silenciosa: se a IA não responder, a busca continua normalmente.
        // PARALELIZADO: rodamos a validação sem await para não bloquear o fetch inicial.
        const validationPromise = (async () => {
            try {
                const stemForValidation = questionText.slice(0, 2000);
                const optsText = Object.entries(originalOptionsMap).map(([l, t]) => `${l}) ${t}`).join('\n');
                const validation = await ApiService.validateOptionsCoherence(stemForValidation, optsText);
                if (!validation.coherent) {
                    console.log(`[SimpleSearch] [WARN] Alternativas incoerentes: ${validation.reason}`);
                    return validation.reason;
                }
            } catch (_) { /* silencioso */ }
            return '';
        })();

        // ── Deduplicação por domínio (max 2 URLs por host) ──────────────────────
        // Evita gastar slots com 5+ URLs do mesmo domínio (brainly, passeidireto)
        const MAX_PER_DOMAIN = 3;
        const _domainCounts = {};
        const topResults = [];
        for (const r of results.slice(0, MAX_CANDIDATES + 6)) {
            if (topResults.length >= MAX_CANDIDATES) break;
            let host = '';
            try { host = new URL(r.link).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
            _domainCounts[host] = (_domainCounts[host] || 0) + 1;
            if (_domainCounts[host] <= MAX_PER_DOMAIN) {
                topResults.push(r);
            }
        }

        if (typeof onStatus === 'function') {
            onStatus(` ${topResults.length} fontes encontradas, iniciando análise…`);
        }

        // ── Pre-warm: abrir tabs de sites com paywall DURANTE Fase 0 ────────────
        // Tabs ficam carregando em background enquanto a IA analisa os snippets.
        // Quando Fase 1 precisa dos textos, as tabs já estão prontas (~2-5s de ganho).
        _preWarmRenderTabs(topResults);

        // ── Fase 0: Extração de snippets — UM call de IA para todos os snippets ──
        // Antes de abrir qualquer página, envia todos os snippets do Serper para a IA.
        // Muitos sites de questões (passeidireto, brainly, studocu) expõem o gabarito
        // no snippet → resultado em < 3s sem nenhum fetch de página.
        const snippetInputs = topResults
            .filter(r => r.snippet && r.snippet.length >= 30)
            .map(r => {
                let host = '';
                try { host = new URL(r.link).hostname.replace(/^www\./, ''); } catch { host = r.link || ''; }
                return { host, title: r.title || '', snippet: r.snippet };
            });

        const snippetSources = [];
        const snippetAttempts = [];

        // ── Fase 0: Snippets PRIMEIRO (rápido, ~1-2s) ──────────────────────────
        // Roda antes da Fase 1 para decidir quantas fontes precisamos
        if (snippetInputs.length >= 2) {
            try {
                if (typeof onStatus === 'function') onStatus(' Leitura rápida dos resultados de busca…');
                const snipResult = await ApiService.aiExtractFromSnippets(snippetInputs, questionForInference);
                if (snipResult?.answerText) {
                    const matchResult = OptionsMatchService.matchAnswerTextToOptions(snipResult.answerText, originalOptionsMap);
                    if (matchResult?.letter) {
                        const letter = matchResult.letter;
                        const sourceLetter = snipResult.sourceLetter || null;
                        const positionShifted = !!(sourceLetter && sourceLetter !== letter);
                        const conf = Math.min(snipResult.confidence || 0.78, matchResult.confidence || 0.78);
                        console.log(`[SimpleSearch] [OK] Fase 0 (snippets): ${letter}) conf=${conf.toFixed(2)}${positionShifted ? ` [POSIÇÃO_DIFERENTE: fonte=${sourceLetter}]` : ''}`);
                        snippetSources.push({
                            success: true, hostHint: 'search-snippets', link: '', title: `${snippetInputs.length} snippets de busca`,
                            letter, answerText: originalOptionsMap[letter], confidence: conf, evidence: snipResult.evidence || '',
                            evidenceType: 'snippet', positionShifted, sourceOriginalLetter: sourceLetter
                        });
                    }
                } else if (snipResult?.rawSourceAnswer) {
                    const rawMatch = OptionsMatchService.matchAnswerTextToOptions(snipResult.rawSourceAnswer, originalOptionsMap);
                    if (rawMatch?.letter) {
                        const letter = rawMatch.letter;
                        const conf = Math.min(snipResult.confidence || 0.72, rawMatch.confidence || 0.72);
                        console.log(`[SimpleSearch] [SHUFFLE] Fase 0 (snippets POSIÇÃO_DIFERENTE): rawAnswer → ${letter}) conf=${conf.toFixed(2)}`);
                        snippetSources.push({
                            success: true, hostHint: 'search-snippets', link: '', title: `${snippetInputs.length} snippets de busca`,
                            letter, answerText: originalOptionsMap[letter], confidence: conf, evidence: snipResult.evidence || '',
                            evidenceType: 'snippet', positionShifted: true, sourceOriginalLetter: snipResult.sourceLetter || null
                        });
                    } else {
                        console.log(`[SimpleSearch] [PIN] Fase 0 (snippets ENCONTRADO_FORA): "${snipResult.rawSourceAnswer.slice(0, 80)}"`);
                        snippetAttempts.push({
                            success: false, hasRawAnswer: true, rawAnswer: snipResult.rawSourceAnswer, sourceLetter: snipResult.sourceLetter || null,
                            hostHint: 'search-snippets', link: '', title: 'search-snippets', letter: null, answerText: null, confidence: null
                        });
                    }
                }
            } catch (snipErr) {
                console.warn('[SimpleSearch] Fase 0 (snippets) erro:', snipErr?.message);
            }
        }

        // ── Fase 1 e Scholar (Paralelo) ─────────────
        // Se Fase 0 já achou resposta com boa confiança, precisamos de menos fontes para confirmar
        const snippetFoundAnswer = snippetSources.length > 0 && snippetSources[0].confidence >= 0.75;
        const snippetHighConf = snippetSources.length > 0 && snippetSources[0].confidence >= 0.90;
        // High confidence (>=0.90): 1 source confirms. Mid confidence (>=0.75): 2 sources. No snippet: full.
        const fase1MaxSources = snippetHighConf ? 1 : snippetFoundAnswer ? 2 : MAX_SOURCES;
        const fase1MinSources = snippetHighConf ? 1 : snippetFoundAnswer ? 1 : 3;
        if (snippetFoundAnswer) {
            console.log(`[SimpleSearch] [FAST] Snippet achou resposta (conf=${snippetSources[0].confidence.toFixed(2)}), reduzindo fontes: max=${fase1MaxSources}, min=${fase1MinSources}`);
        }

        const _scholarStem = QuestionParser.extractQuestionStem(questionForInference);
        const scholarPromise = _scholarStem && _scholarStem.length >= 15
            ? ApiService.searchWithScholar(_scholarStem.slice(0, 220), 5).catch(() => [])
            : Promise.resolve([]);

        const fase1Promise = _collectFirstNSources(
            topResults, questionForInference, originalOptionsMap, fase1MinSources, fase1MaxSources, onStatus, true
        );

        // Espera Fase 1 concluir
        const fase1Result = await fase1Promise;
        const sources = fase1Result.sources;
        const allAttempts = fase1Result.allAttempts;

        // Merge snippet results into the main arrays
        sources.unshift(...snippetSources);
        allAttempts.unshift(...snippetAttempts);

        // ── Fase 0.5: Scholar snippets (Google Scholar) ──────────────────────
        // Already running in parallel since before Fase 1; conditionally wait for it.
        // Skip Scholar if we already have strong consensus from snippets + Fase 1
        const _qVotes = {};
        for (const s of sources) _qVotes[s.letter] = (_qVotes[s.letter] || 0) + (s.confidence || 0);
        const _qTotal = Object.values(_qVotes).reduce((a, b) => a + b, 0);
        const _qBest = Math.max(...Object.values(_qVotes), 0);
        const _skipScholar = sources.length >= 2 && _qTotal > 0 && (_qBest / _qTotal) >= 0.85;

        if (_skipScholar) {
            console.log(`[SimpleSearch] [FAST] Pulando await do Scholar (consenso forte atingido: ${(_qBest / _qTotal * 100).toFixed(0)}%)`);
        }
        const scholarResults = _skipScholar ? [] : await scholarPromise;
        if (scholarResults.length > 0) {
            const scholarInputs = scholarResults
                .filter(r => r.snippet && r.snippet.length >= 30)
                .map(r => ({ host: 'scholar.google.com', title: r.title || '', snippet: r.snippet }));
            if (scholarInputs.length >= 1) {
                try {
                    const scholarExtracted = await ApiService.aiExtractFromSnippets(scholarInputs, questionForInference);
                    if (scholarExtracted?.answerText) {
                        const matchResult = OptionsMatchService.matchAnswerTextToOptions(scholarExtracted.answerText, originalOptionsMap);
                        if (matchResult?.letter) {
                            const letter = matchResult.letter;
                            const conf = Math.min(scholarExtracted.confidence || 0.75, matchResult.confidence || 0.75);
                            const positionShifted = !!(scholarExtracted.sourceLetter && scholarExtracted.sourceLetter !== letter);
                            console.log(`[SimpleSearch] [STUDY] Fase 0.5 (Scholar): ${letter}) conf=${conf.toFixed(2)}`);
                            sources.unshift({
                                success: true,
                                hostHint: 'scholar.google.com',
                                link: scholarResults[0]?.link || '',
                                title: `Google Scholar (${scholarResults.length} artigos)`,
                                letter,
                                answerText: originalOptionsMap[letter],
                                confidence: conf,
                                evidence: scholarExtracted.evidence || '',
                                evidenceType: 'scholar',
                                positionShifted,
                                sourceOriginalLetter: scholarExtracted.sourceLetter || null
                            });
                        }
                    } else if (scholarExtracted?.rawSourceAnswer) {
                        const rawMatch = OptionsMatchService.matchAnswerTextToOptions(scholarExtracted.rawSourceAnswer, originalOptionsMap);
                        if (rawMatch?.letter) {
                            const letter = rawMatch.letter;
                            const conf = Math.min(scholarExtracted.confidence || 0.70, rawMatch.confidence || 0.70);
                            console.log(`[SimpleSearch] [STUDY] Fase 0.5 (Scholar POSIÇÃO_DIFERENTE): ${letter}) conf=${conf.toFixed(2)}`);
                            sources.unshift({
                                success: true,
                                hostHint: 'scholar.google.com',
                                link: scholarResults[0]?.link || '',
                                title: `Google Scholar (${scholarResults.length} artigos)`,
                                letter,
                                answerText: originalOptionsMap[letter],
                                confidence: conf,
                                evidence: scholarExtracted.evidence || '',
                                evidenceType: 'scholar',
                                positionShifted: true,
                                sourceOriginalLetter: scholarExtracted.sourceLetter || null
                            });
                        } else {
                            console.log(`[SimpleSearch] [STUDY] Fase 0.5 (Scholar ENCONTRADO_FORA): "${scholarExtracted.rawSourceAnswer.slice(0, 80)}"`);
                            allAttempts.unshift({
                                success: false,
                                hasRawAnswer: true,
                                rawAnswer: scholarExtracted.rawSourceAnswer,
                                sourceLetter: scholarExtracted.sourceLetter || null,
                                hostHint: 'scholar.google.com',
                                link: '',
                                title: 'google-scholar',
                                letter: null,
                                answerText: null,
                                confidence: null
                            });
                        }
                    }
                } catch (scholarErr) {
                    console.warn('[SimpleSearch] Fase 0.5 (Scholar) erro:', scholarErr?.message);
                }
            }
        }

        // ── Fase 2: BackgroundTab — complementa quando Fase 1 não atingiu o alvo ──
        // Usa o mesmo maxSources da Fase 1 (que pode ter sido reduzido pelo snippet early-exit)
        const effectiveMaxSources = snippetFoundAnswer ? fase1MaxSources + snippetSources.length : MAX_SOURCES;

        // Skip Phase 2 if we already have strong consensus from Phase 1
        const _p2Votes = {};
        for (const s of sources) _p2Votes[s.letter] = (_p2Votes[s.letter] || 0) + (s.confidence || 0);
        const _p2Total = Object.values(_p2Votes).reduce((a, b) => a + b, 0);
        const _p2Best = Math.max(...Object.values(_p2Votes), 0);
        const _skipPhase2 = sources.length >= 2 && _p2Total > 0 && (_p2Best / _p2Total) >= 0.80;

        if (_skipPhase2) {
            console.log(`[SimpleSearch] [FAST] Pulando Fase 2 (consenso ≥ 80%: ${(_p2Best / _p2Total * 100).toFixed(0)}%)`);
        }

        if (!_skipPhase2 && sources.length < effectiveMaxSources) {
            const alreadyProcessed = new Set(allAttempts.map(a => a.link));
            const spaResults = topResults
                .filter(r => r.link && !alreadyProcessed.has(r.link));
            if (spaResults.length > 0) {
                if (typeof onStatus === 'function') onStatus(' Expandindo busca com mais fontes…');
                const remaining = effectiveMaxSources - sources.length;
                const bgResult = await _collectFirstNSources(
                    spaResults, questionForInference, originalOptionsMap, remaining, remaining + 2, onStatus, true, sources
                );
                sources.push(...bgResult.sources);
                allAttempts.push(...bgResult.allAttempts);
            }
        }

        const optionsMismatchWarning = await validationPromise;

        if (sources.length === 0) {
            // ── Tabela de diagnóstico COMPLETA no DevTools ──────────────────────────
            // Mostra TODAS as tentativas (sucesso ou falha) para debug fácil
            console.log('\n[SimpleSearch] 📊 ═══ DIAGNÓSTICO COMPLETO DE FONTES ═══');
            console.table(allAttempts.map(a => ({
                'Fonte': (a.hostHint || '').slice(0, 30),
                'Link': (a.link || '').slice(0, 60),
                'Extraiu?': a.success ? '✅ SIM' : (a.hasRawAnswer ? '⚠️ PARCIAL' : '❌ NÃO'),
                'Gabarito': a.success
                    ? `${a.letter}) ${(a.answerText || '').slice(0, 50)}`
                    : (a.hasRawAnswer ? (a.rawAnswer || '').slice(0, 50) : '—')
            })));
            console.log('═══════════════════════════════════════════════════════\n');

            // Nenhuma URL retornou resultado útil via match de alternativas.
            // Verificar se há respostas ENCONTRADO_FORA (fonte tem gabarito mas alternativas são erradas)
            const rawAnswerItems = allAttempts.filter(a => a.hasRawAnswer && a.rawAnswer);

            if (rawAnswerItems.length > 0) {
                // Feature requested: tabelinha userfriendly no console
                console.log('\n[SimpleSearch] 📊 --- RESUMO DOS GABARITOS EXTRAÍDOS ---');
                console.table(rawAnswerItems.map(a => ({
                    Fonte: a.hostHint || a.link,
                    'Extração com Sucesso': 'SIM',
                    'Gabarito Encontrado': a.rawAnswer.length > 100 ? a.rawAnswer.slice(0, 100) + '...' : a.rawAnswer
                })));
                console.log('-------------------------------------------------------\n');

                if (typeof onStatus === 'function') onStatus(' Consolidando gabaritos com IA...');
                
                // Super Feature: Consenso de LLM
                console.log('[SimpleSearch] Solicitando consenso analítico da IA sobre gabaritos cru...');
                const extractedForLLM = rawAnswerItems.map(a => ({ host: a.hostHint || a.link, text: a.rawAnswer }));
                const llmConsensus = await ApiService.aiConsolidateExtractedAnswers(extractedForLLM, questionForInference);

                if (llmConsensus?.letter && originalOptionsMap[llmConsensus.letter]) {
                    const bestLetter = llmConsensus.letter;
                    const shiftNote = `Letra identificada por consenso da IA mapeando e interpretando os diferentes gabaritos das fontes.\nJustificativa da IA: ${llmConsensus.reasoning}`;
                    console.log(`[SimpleSearch] [LLM_CONSENSUS] 🏆 Venceu a Letra ${bestLetter}. Motivo: ${llmConsensus.reasoning}`);
                    
                    const fakeResultState = llmConsensus.confidence >= 0.8 ? 'confirmed' : 'suggested';
                    return [{
                        question: questionText,
                        answer: `Letra ${bestLetter}: ${originalOptionsMap[bestLetter]}`,
                        answerLetter: bestLetter,
                        answerText: originalOptionsMap[bestLetter],
                        resultState: fakeResultState,
                        confidence: llmConsensus.confidence,
                        evidenceTier: 'WEB_SOURCES',
                        positionShiftNote: shiftNote,
                        mismatchWarning: optionsMismatchWarning || undefined,
                        optionsMap: originalOptionsMap,
                        votes: { [bestLetter]: llmConsensus.confidence },
                        allAttempts: allAttempts.map(a => ({ hostHint: a.hostHint, link: a.link, success: a.success, letter: a.letter, answerText: a.rawAnswer || a.answerText })),
                        sources: rawAnswerItems.map(m => ({ 
                            letter: bestLetter, 
                            confidence: 0.75, 
                            answerText: m.rawAnswer, 
                            positionShifted: true, 
                            hostHint: m.hostHint, 
                            link: m.link, 
                            title: m.hostHint 
                        }))
                    }];
                }

                // --------- Fallback 1: tentamos string match se a IA não ajudou ---------
                // First: try to match raw answers against current alternatives (position shift case)
                // Example: source from last year says "B. Sistematização..." but current question
                // has the same text as "D" → we find D by text matching
                const matchedFromRaw = [];
                for (const item of rawAnswerItems) {
                    const m = OptionsMatchService.matchAnswerTextToOptions(item.rawAnswer, originalOptionsMap);
                    if (m?.letter) {
                        matchedFromRaw.push({
                            letter: m.letter,
                            confidence: Math.min(0.78, m.confidence || 0.70),
                            rawAnswer: item.rawAnswer,
                            sourceOriginalLetter: item.sourceLetter || null,
                            hostHint: item.hostHint
                        });
                    }
                }

                if (matchedFromRaw.length > 0) {
                    const fakeVotes = {};
                    for (const m of matchedFromRaw) {
                        fakeVotes[m.letter] = (fakeVotes[m.letter] || 0) + m.confidence;
                    }
                    const sortedFake = Object.entries(fakeVotes).sort((a, b) => b[1] - a[1]);
                    const [bestFakeLetter, bestFakeScore] = sortedFake[0];
                    const totalFakeScore = Object.values(fakeVotes).reduce((a, b) => a + b, 0);
                    const fakeDominance = bestFakeScore / totalFakeScore;
                    const fakeResultState = matchedFromRaw.length >= 2 && fakeDominance >= 0.6 ? 'confirmed' : 'suggested';
                    const fakeConf = Math.min(0.88, 0.55 + matchedFromRaw.length * 0.10);
                    // Find sources that explicitly mentioned a different letter (true position shift)
                    const withShift = matchedFromRaw.filter(m => m.sourceOriginalLetter && m.sourceOriginalLetter !== bestFakeLetter);
                    const shiftLetters = [...new Set(withShift.map(m => m.sourceOriginalLetter))].join('/');
                    const shiftNote = shiftLetters
                        ? ` Fonte(s) de anos anteriores indicam a letra ${shiftLetters}, mas o mesmo texto está na alternativa ${bestFakeLetter} da questão atual.`
                        : `Gabarito encontrado por correspondência de texto em fonte(s) externas. A posição pode ter mudado em relação a versões anteriores da questão.`;
                    console.log(`[SimpleSearch] [SHUFFLE] POSIÇÃO_DIFERENTE (${matchedFromRaw.length} fontes raw → ${bestFakeLetter}${shiftLetters ? `, antes: ${shiftLetters}` : ''})`);
                    return [{
                        question: questionText,
                        answer: `Letra ${bestFakeLetter}: ${originalOptionsMap[bestFakeLetter] || ''}`,
                        answerLetter: bestFakeLetter,
                        answerText: originalOptionsMap[bestFakeLetter] || '',
                        resultState: fakeResultState,
                        confidence: fakeConf,
                        evidenceTier: 'WEB_SOURCES',
                        positionShiftNote: shiftNote,
                        mismatchWarning: optionsMismatchWarning || undefined,
                        optionsMap: originalOptionsMap,
                        votes: fakeVotes,
                        allAttempts: allAttempts.map(a => ({ hostHint: a.hostHint, link: a.link, success: a.success, letter: a.letter, answerText: a.rawAnswer || a.answerText })),
                        sources: matchedFromRaw.map(m => ({ letter: m.letter, confidence: m.confidence, answerText: m.rawAnswer, positionShifted: true, sourceOriginalLetter: m.sourceOriginalLetter, hostHint: m.hostHint, link: '', title: m.hostHint }))
                    }];
                }

                // No text match possible: vote on raw answer strings and display as-is
                const rawAnswers = rawAnswerItems.map(a => a.rawAnswer);
                const rawCounts = {};
                for (const raw of rawAnswers) {
                    // Normalize key: strip surrounding quotes before deduplication
                    // Without this, `"Apenas I e II estão corretas."` and `Apenas I e II estão corretas.`
                    // are counted as different answers, splitting votes and letting a minority answer win.
                    const normalized = raw.trim().replace(/^["""''`]+|["""''`]+$/g, '').trim();
                    const key = normalized.toLowerCase().slice(0, 80);
                    if (!rawCounts[key]) rawCounts[key] = { text: normalized, count: 0 };
                    rawCounts[key].count += 1;
                }
                const bestRaw = Object.values(rawCounts).sort((a, b) => b.count - a.count)[0];
                const warningMsg = optionsMismatchWarning
                    ? ` ${optionsMismatchWarning} Gabarito encontrado nas fontes: "${bestRaw.text.slice(0, 100)}"`
                    : `As alternativas fornecidas não correspondem ao gabarito encontrado nas fontes. Gabarito das fontes: "${bestRaw.text.slice(0, 100)}"`;
                console.log(`[SimpleSearch] [PIN] ENCONTRADO_FORA (${rawAnswers.length} fontes): "${bestRaw.text.slice(0, 80)}"`);
                return [{
                    question: questionText,
                    answer: bestRaw.text,
                    answerLetter: null,
                    answerText: bestRaw.text,
                    resultState: 'suggested',
                    confidence: Math.min(0.80, 0.40 + bestRaw.count * 0.15),
                    evidenceTier: 'WEB_SOURCES',
                    mismatchWarning: warningMsg,
                    optionsMap: originalOptionsMap,
                    votes: {},
                    allAttempts: allAttempts.map(a => ({ hostHint: a.hostHint, link: a.link, success: a.success, letter: a.letter, answerText: a.rawAnswer || a.answerText })),
                    sources: []
                }];
            }
            // Nenhuma URL retornou resultado útil. background.js vai cair para answerFromAi().
            console.log('[SimpleSearch] [WARN] Nenhuma fonte gerou resposta válida');
            return [];
        }

        // ── Fase 3: Busca de confirmação (espelha "Turno 6" do fluxo humano) ──────
        // Após a Fase 1/2, se há candidatos mas ainda não temos cobertura total,
        // fazemos buscas adicionais usando o texto de TODOS os candidatos empatados.

        const preVotes = {};
        for (const src of sources) preVotes[src.letter] = (preVotes[src.letter] || 0) + (src.confidence || 0);
        const preTotal = Object.values(preVotes).reduce((a, b) => a + b, 0);
        const preBest = Math.max(...Object.values(preVotes), 0);
        const skipPhase3 = sources.length >= 2 && preTotal > 0 && (preBest / preTotal) >= 0.75;

        if (skipPhase3) {
            console.log(`[SimpleSearch] [FAST] Pulando Fase 3 de confirmação (consenso atual ≥ 75%: ${(preBest / preTotal * 100).toFixed(0)}%)`);
        }

        if (!skipPhase3 && sources.length < effectiveMaxSources) {
            const tiedCandidates = _getTiedCandidates(sources);
            const validCandidates = tiedCandidates.filter(c => c.answerText && c.answerText.length >= 12 && c.avgConf >= 0.60);
            if (validCandidates.length > 0) {
                const existingLinks = new Set([
                    ...topResults.map(r => r.link),
                    ...allAttempts.map(a => a.link)
                ]);
                if (typeof onStatus === 'function') onStatus(' Confirmando resposta com mais fontes…');
                for (const candidate of validCandidates) {
                    if (sources.length >= effectiveMaxSources) break;
                    const cleanText = candidate.answerText.slice(0, 60).replace(/["""''`]/g, '').trim();
                    const confirmQ = `"${cleanText}" gabarito`;
                    console.log(`[SimpleSearch] [RETRY] Fase 3 (confirmação ${candidate.letter}): "${confirmQ.slice(0, 100)}"`);
                    try {
                        const confirmRaw = await ApiService.searchSingleQuery(confirmQ, 8);
                        if (confirmRaw && confirmRaw.length > 0) {
                            const newCandidates = confirmRaw
                                .filter(r => r.link && !existingLinks.has(r.link))
                                .slice(0, 5);
                            // Track new links to avoid duplicates across tied candidates
                            for (const nc of newCandidates) existingLinks.add(nc.link);
                            if (newCandidates.length > 0) {
                                const { sources: confirmSources, allAttempts: confirmAttempts } =
                                    await _collectFirstNSources(
                                        newCandidates, questionForInference, originalOptionsMap,
                                        effectiveMaxSources - sources.length, onStatus, false
                                    );
                                if (confirmSources.length > 0) {
                                    console.log(`[SimpleSearch] [OK] Fase 3 (${candidate.letter}): +${confirmSources.length} fontes de confirmação`);
                                    sources.push(...confirmSources);
                                    allAttempts.push(...confirmAttempts);
                                }
                            }
                        }
                    } catch (confirmErr) {
                        console.warn(`[SimpleSearch] Fase 3 (${candidate.letter}) erro:`, confirmErr?.message);
                    }
                }
            }
        }


        // ── Passo 5: Votação ponderada por confiança ──────────────────────────────
        // Cada fonte vota na sua letra com peso = sua confidence (0.0 – 1.0).
        // Fontes com positionShifted (remapeamento texto→letra bem-sucedido entre versões
        // diferentes da questão) recebem bônus de +0.10 — é evidência forte de que o texto
        // foi encontrado em outra prova e remapeado corretamente para a posição atual.
        // Ex: A=1.70 (2 fontes), B=0.85 (1 fonte) → A vence com dominância 67%
        const votes = {};
        const voteCounts = {};
        for (const src of sources) {
            votes[src.letter] = (votes[src.letter] || 0) + (src.confidence || 0);
            voteCounts[src.letter] = (voteCounts[src.letter] || 0) + 1;
        }

        // Desempate estável: score → nº de fontes → ordem alfabética
        const sorted = Object.entries(votes).sort((a, b) =>
            b[1] - a[1] || (voteCounts[b[0]] || 0) - (voteCounts[a[0]] || 0) || a[0].localeCompare(b[0])
        );
        const [bestLetter, bestScore] = sorted[0];
        const totalScore = Object.values(votes).reduce((a, b) => a + b, 0);
        // dominância: fração do score total que a letra vencedora recebeu (0.0 – 1.0)
        const dominance = totalScore > 0 ? bestScore / totalScore : 0;

        // finalConfidence: combinação de unanimidade (dominance) e quantidade de fontes.
        // - sources.length/2 penaliza quando só uma fonte votou (0.5 máx com 1 fonte)
        // - Cap em 0.99 (nunca 100% — sempre há incerteza)
        const finalConfidence = Math.min(0.99, dominance * Math.min(1.0, sources.length / 2));

        // resultState: lido por PopupController para decidir cor/ícone do resultado
        // 'confirmed' = ≥2 fontes concordam E dominância ≥60% → resultado confiável
        // 'suggested' = apenas 1 fonte, ou fontes divergem → resultado menos confiável
        const resultState = sources.length >= 2 && dominance >= 0.6 ? 'confirmed' : 'suggested';

        const answerText = originalOptionsMap[bestLetter] || '';

        // Detect position shift across sources: any source voted for bestLetter but had a different original letter?
        const shiftedSources = sources.filter(s => s.positionShifted && s.sourceOriginalLetter && s.sourceOriginalLetter !== bestLetter);
        const shiftedLetters = [...new Set(shiftedSources.map(s => s.sourceOriginalLetter))].join('/');
        const positionShiftNote = shiftedLetters
            ? ` Fonte(s) de anos anteriores indicam a letra ${shiftedLetters}, mas o mesmo texto corresponde à alternativa ${bestLetter} na questão atual.`
            : (sources.some(s => s.positionShifted) ? ` Gabarito encontrado por correspondência de texto. A posição pode ser diferente de versões anteriores da questão.` : undefined);

        console.log(`[SimpleSearch] [TROPHY] Vencedor: ${bestLetter}) ${answerText}`);
        console.log(`[SimpleSearch] [CHART] Votos:`, Object.entries(votes).map(([l, v]) => `${l}=${v.toFixed(2)}`).join(','));
        console.log(`[SimpleSearch] [CHART] Fontes=${sources.length} dominance=${dominance.toFixed(2)} resultState=${resultState}${positionShiftNote ? ' [POSIÇÃO_DIFERENTE]' : ''}`);

        // Retorna array de 1 elemento — formato esperado por PopupController._finishBackgroundSearch()
        return [{
            question: questionText,
            answer: `Letra ${bestLetter}: ${answerText}`,
            answerLetter: bestLetter,
            answerText,
            resultState,
            confidence: finalConfidence,
            evidenceTier: 'WEB_SOURCES',
            mismatchWarning: optionsMismatchWarning || undefined,
            positionShiftNote: positionShiftNote || undefined,
            optionsMap: originalOptionsMap,// { A: 'texto', B: 'texto', ... } — necessário para os pills de override
            votes, // { A: 1.70, B: 0.85 } — exibido no painel de debug da extensão
            // allAttempts: todas as tentativas (para tabela de diagnóstico na UI)
            allAttempts: allAttempts.map(a => ({
                hostHint: a.hostHint,
                link: a.link,
                success: a.success,
                letter: a.letter,
                answerText: a.answerText,
            })),
            sources: sources.map(s => ({
                title: s.title,
                link: s.link,
                letter: s.letter,           // letra JÁ REMAPEADA para as opções do usuário
                hostHint: s.hostHint,
                evidenceType: s.evidenceType,
                weight: s.confidence,
                evidenceBlock: s.evidence   // trecho de texto da página que levou à resposta
            }))
        }];
    }
};
