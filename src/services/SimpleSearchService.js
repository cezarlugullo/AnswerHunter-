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
 *    Para cada URL (até MAX_CANDIDATES = 10, para em MAX_SOURCES = 5 válidas):
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
const MAX_CANDIDATES = 6;

// Parar ao atingir este número de fontes que geraram resposta válida.
const MAX_SOURCES = 3;

// Tamanho mínimo de texto para enviar à IA.
// Textos abaixo disso são páginas de erro, CAPTCHA ou redirecionamentos.
const MIN_TEXT_LENGTH = 150;

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

    // Alguns sites com Cloudflare agressivo SEMPRE bloqueiam requests server-side (Jina/NativeFetch)
    // Pular eles na Fase 1 (allowBgTab=false) economiza ~2-4s por URL de timeout inútil.
    const BLOCKED_DOMAINS = ['studocu.com', 'gauthmath.com', 'scribd.com'];
    const skipServerFetches = !allowBgTab && BLOCKED_DOMAINS.some(d => hostHint.endsWith(d));

    let pageText = null;

    if (skipServerFetches) {
        console.log(`[SimpleSearch] [FAST] Pulando server fetches para ${hostHint} (só funciona via BackgroundTab)`);
    } else {
        pageText = await ApiService.fetchViaJina(link);

        // NativeFetch: binário Go com TLS fingerprint Chrome_131 — bypassa CloudFront (PasseiDireto)
        // e outros CDNs que bloqueiam TLS automático. Só tenta se o binário nativo estiver instalado.
        if (!pageText && !cancel.cancelled) {
            try {
                const nativeAvail = await NativeFetchBridgeService.isAvailable();
                if (nativeAvail) {
                    console.log(`[SimpleSearch] [RETRY] Jina falhou → tentando NativeFetch (TLS bypass)...`);
                    pageText = await NativeFetchBridgeService.fetchText(link);
                    if (pageText) console.log(`[SimpleSearch] [OK] NativeFetch: ${pageText.length} chars`);
                }
            } catch (_) { /* binário não instalado ou erro — silencioso */ }
        }
    }

    // Não abre aba oculta se já temos resultados suficientes (cancellation token)
    // BackgroundTab só é permitido na fase 2 (allowBgTab=true), nunca na fase 1 paralela
    if (!pageText && !cancel.cancelled && allowBgTab && BackgroundTabExtractorService.isJsHeavySpa(link)) {
        console.log(`[SimpleSearch] [RETRY] Jina falhou → tentando BackgroundTab...`);
        try {
            pageText = await BackgroundTabExtractorService.extractFromUrl(link, { timeoutMs: 15000 });
        } catch (e) {
            console.warn(`[SimpleSearch] BackgroundTab erro:`, e?.message);
        }
    }

    if (!pageText || pageText.length < MIN_TEXT_LENGTH) {
        return _fail(`Sem texto útil (len=${pageText?.length || 0})`);
    }

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
        return _fail(`Texto "${aiResult.answerText.slice(0, 60)}" não casou com nenhuma opção`);
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
 */
function _collectFirstNSources(topResults, questionForInference, originalOptionsMap, minSources, maxSources, onStatus, allowBgTab = false) {
    return new Promise((resolve) => {
        const total = topResults.length;
        if (total === 0) { resolve({ sources: [], allAttempts: [] }); return; }

        const sources = [];      // apenas tentativas com success=true
        const allAttempts = [];  // todas as tentativas (para tabela de diagnóstico)
        let settled = 0;
        let resolved = false;
        const cancel = { cancelled: false };

        const checkDone = () => {
            if (resolved) return;

            // Check consensus among successful sources
            let consensusScore = 0;
            if (sources.length > 0) {
                const votes = {};
                for (const src of sources) votes[src.letter] = (votes[src.letter] || 0) + (src.confidence || 0);
                const totalScore = Object.values(votes).reduce((a, b) => a + b, 0);
                const bestScore = Math.max(...Object.values(votes));
                consensusScore = totalScore > 0 ? bestScore / totalScore : 0;
            }

            // Early exit conditions:
            // 1. We hit minSources AND consensus is strong (>= 0.6)
            // 2. We hit maxSources (hard limit)
            // 3. We exhausted all available results
            const strongConsensus = sources.length >= minSources && consensusScore >= 0.6;

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
            }
        };

        topResults.forEach((result, idx) => {
            _processSingleSource(result, idx + 1, total, questionForInference, originalOptionsMap, onStatus, cancel, allowBgTab)
                .then(attempt => {
                    settled++;
                    if (attempt) {
                        allAttempts.push(attempt);
                        if (attempt.success && !resolved) sources.push(attempt);
                    }
                    checkDone();
                })
                .catch(() => {
                    settled++;
                    checkDone();
                });
        });
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
    async refineFromResults(questionText, results, originalQuestionWithOptions = '', onStatus = null) {
        if (!results || results.length === 0) return [];

        // Prefere a versão completa (com alternativas) para enviar à IA
        const questionForInference = originalQuestionWithOptions || questionText;

        // ── Construção do mapa de opções do usuário ──────────────────────────────
        // Ex: { A: 'Chave de partição', B: 'Chave primária', C: 'Chave composta', ... }
        // Este mapa é a referência para remapear o texto retornado pela IA → letra correta.
        // QuestionParser.extractOptionsFromQuestion() suporta variações de formato:
        //   "A) texto", "a) texto", "A. texto", "(A) texto", etc.
        const options = QuestionParser.extractOptionsFromQuestion(questionForInference);
        let originalOptionsMap = {};
        for (const opt of options) {
            const m = opt.match(/^([A-E])\)\s*(.+)$/is);
            if (m) originalOptionsMap[m[1].toUpperCase()] = m[2].trim();
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

        const topResults = results.slice(0, MAX_CANDIDATES);

        if (typeof onStatus === 'function') {
            onStatus(` ${topResults.length} fontes encontradas, iniciando análise…`);
        }

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

        // ── Fase 1 e Scholar (Paralelo) ─────────────
        const _scholarStem = QuestionParser.extractQuestionStem(questionForInference);
        const scholarPromise = _scholarStem && _scholarStem.length >= 15
            ? ApiService.searchWithScholar(_scholarStem.slice(0, 220), 5).catch(() => [])
            : Promise.resolve([]);

        const fase1Promise = _collectFirstNSources(
            topResults, questionForInference, originalOptionsMap, 3, 5, onStatus, false
        );

        // Lançar Fase 0 (snippets) em paralelo
        const snippetPromise = async () => {
            if (snippetInputs.length < 2) return;
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
        };

        // Espera Fase 0 e 1 concluirem juntas
        const [, fase1Result] = await Promise.all([snippetPromise(), fase1Promise]);
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

        // ── Fase 2: BackgroundTab — só se Fase 1 não encontrou nada ─────────────
        // Filtra apenas os candidatos que são SPAs JS-pesadas e ainda não tiveram sucesso
        if (sources.length === 0) {
            const spaResults = topResults.filter(r => r.link && BackgroundTabExtractorService.isJsHeavySpa(r.link));
            if (spaResults.length > 0) {
                if (typeof onStatus === 'function') onStatus(' Tentando método alternativo de extração…');
                const bgResult = await _collectFirstNSources(
                    spaResults, questionForInference, originalOptionsMap, 3, 5, onStatus, true
                );
                sources.push(...bgResult.sources);
                allAttempts.push(...bgResult.allAttempts);
            }
        }

        const optionsMismatchWarning = await validationPromise;

        if (sources.length === 0) {
            // Nenhuma URL retornou resultado útil via match de alternativas.
            // Verificar se há respostas ENCONTRADO_FORA (fonte tem gabarito mas alternativas são erradas)
            const rawAnswerItems = allAttempts.filter(a => a.hasRawAnswer && a.rawAnswer);

            if (rawAnswerItems.length > 0) {
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
        const skipPhase3 = sources.length >= 2 && preTotal > 0 && (preBest / preTotal) >= 0.80;

        if (skipPhase3) {
            console.log(`[SimpleSearch] [FAST] Pulando Fase 3 de confirmação (consenso atual ≥ 80%)`);
        }

        if (!skipPhase3 && sources.length < MAX_SOURCES) {
            const tiedCandidates = _getTiedCandidates(sources);
            const validCandidates = tiedCandidates.filter(c => c.answerText && c.answerText.length >= 12 && c.avgConf >= 0.60);
            if (validCandidates.length > 0) {
                const existingLinks = new Set([
                    ...topResults.map(r => r.link),
                    ...allAttempts.map(a => a.link)
                ]);
                if (typeof onStatus === 'function') onStatus(' Confirmando resposta com mais fontes…');
                for (const candidate of validCandidates) {
                    if (sources.length >= MAX_SOURCES) break;
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
                                        MAX_SOURCES - sources.length, onStatus, false
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
