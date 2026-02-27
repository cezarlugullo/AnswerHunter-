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
const MAX_CANDIDATES = 10;

// Parar ao atingir este número de fontes que geraram resposta válida.
// 5 fontes são suficientes para uma votação confiável e evitam timeout.
const MAX_SOURCES = 5;

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
        console.log(`[SimpleSearch] ⛔ ${reason}`);
        console.groupEnd();
        return { success: false, hostHint, link: link || '', title: title || hostHint, letter: null, answerText: null, confidence: null };
    };

    if (!link) return _fail('URL vazia');

    if (typeof onStatus === 'function') {
        onStatus(`Analisando fonte ${idx}/${total}: ${hostHint}...`);
    }

    console.group(`[SimpleSearch] 🔍 Fonte ${idx}: ${hostHint}`);

    let pageText = await ApiService.fetchViaJina(link);

    // NativeFetch: binário Go com TLS fingerprint Chrome_131 — bypassa CloudFront (PasseiDireto)
    // e outros CDNs que bloqueiam TLS automático. Só tenta se o binário nativo estiver instalado.
    if (!pageText && !cancel.cancelled) {
        try {
            const nativeAvail = await NativeFetchBridgeService.isAvailable();
            if (nativeAvail) {
                console.log(`[SimpleSearch] 🔄 Jina falhou → tentando NativeFetch (TLS bypass)...`);
                pageText = await NativeFetchBridgeService.fetchText(link);
                if (pageText) console.log(`[SimpleSearch] ✅ NativeFetch: ${pageText.length} chars`);
            }
        } catch (_) { /* binário não instalado ou erro — silencioso */ }
    }

    // Não abre aba oculta se já temos resultados suficientes (cancellation token)
    // BackgroundTab só é permitido na fase 2 (allowBgTab=true), nunca na fase 1 paralela
    if (!pageText && !cancel.cancelled && allowBgTab && BackgroundTabExtractorService.isJsHeavySpa(link)) {
        console.log(`[SimpleSearch] 🔄 Jina falhou → tentando BackgroundTab...`);
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

    console.log(`[SimpleSearch] ✅ ${pageText.length} chars obtidos`);

    const aiResult = await ApiService.aiExtractTextFromPage(pageText, questionForInference, hostHint);

    if (!aiResult?.answerText) {
        return _fail('IA: nenhum texto de resposta encontrado');
    }

    const matchResult = OptionsMatchService.matchAnswerTextToOptions(aiResult.answerText, originalOptionsMap);

    if (!matchResult?.letter) {
        return _fail(`Texto "${aiResult.answerText.slice(0, 60)}" não casou com nenhuma opção`);
    }

    const letter = matchResult.letter;
    const confidence = Math.min(
        aiResult.confidence || 0.85,
        matchResult.confidence || 0.85
    );

    console.log(`[SimpleSearch] ✅ Resposta: ${letter}) ${originalOptionsMap[letter]} (conf=${confidence.toFixed(2)}, match="${matchResult.method}")`);
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
        evidenceType: 'jina-ai-text'
    };
}

/**
 * Executa todos os processadores de fonte em paralelo e resolve assim que
 * maxSources resultados válidos forem coletados (ou todas as fontes esgotem).
 * Substitui o for-loop sequencial — elimina o tempo de espera das fontes falhas.
 * Usa um cancel token para impedir que fontes em-flight abram BackgroundTabs desnecessárias.
 * @param {boolean} [allowBgTab=false] - se true, permite BackgroundTab como último recurso
 */
function _collectFirstNSources(topResults, questionForInference, originalOptionsMap, maxSources, onStatus, allowBgTab = false) {
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
            // Early exit: 3+ sources agree with dominance ≥ 0.80 → no need to wait for more
            if (sources.length >= 3) {
                const votes = {};
                for (const src of sources) votes[src.letter] = (votes[src.letter] || 0) + src.confidence;
                const totalScore = Object.values(votes).reduce((a, b) => a + b, 0);
                const bestScore = Math.max(...Object.values(votes));
                if (totalScore > 0 && bestScore / totalScore >= 0.80) {
                    resolved = true;
                    cancel.cancelled = true;
                    resolve({ sources: [...sources], allAttempts: [...allAttempts] });
                    return;
                }
            }
            if (sources.length >= maxSources || settled >= total) {
                resolved = true;
                cancel.cancelled = true;
                resolve({ sources: [...sources], allAttempts: [...allAttempts] });
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
        const originalOptionsMap = {};
        for (const opt of options) {
            const m = opt.match(/^([A-E])\)\s*(.+)$/is);
            if (m) originalOptionsMap[m[1].toUpperCase()] = m[2].trim();
        }

        const hasOptions = Object.keys(originalOptionsMap).length >= 2;
        if (!hasOptions) {
            // Sem alternativas válidas não é possível fazer remapeamento texto→letra.
            // Isso acontece quando: OCR não capturou as alternativas, questão é dissertativa,
            // ou o formato das opções não foi reconhecido pelo QuestionParser.
            console.log('[SimpleSearch] ⚠️ Sem alternativas válidas — abortando');
            return [];
        }

        console.log('[SimpleSearch] Mapa de opções:', originalOptionsMap);

        const topResults = results.slice(0, MAX_CANDIDATES);

        if (typeof onStatus === 'function') {
            onStatus(`Verificando ${topResults.length} fontes...`);
        }

        // ── Fase 1: Jina + NativeFetch em paralelo (sem abrir abas) ─────────────
        const { sources, allAttempts } = await _collectFirstNSources(
            topResults, questionForInference, originalOptionsMap, MAX_SOURCES, onStatus, false
        );

        // ── Fase 2: BackgroundTab — só se Fase 1 não encontrou nada ─────────────
        // Filtra apenas os candidatos que são SPAs JS-pesadas e ainda não tiveram sucesso
        if (sources.length === 0) {
            const spaResults = topResults.filter(r => r.link && BackgroundTabExtractorService.isJsHeavySpa(r.link));
            if (spaResults.length > 0) {
                if (typeof onStatus === 'function') onStatus('Tentando extração via aba oculta (último recurso)...');
                const bgResult = await _collectFirstNSources(
                    spaResults, questionForInference, originalOptionsMap, MAX_SOURCES, onStatus, true
                );
                sources.push(...bgResult.sources);
                allAttempts.push(...bgResult.allAttempts);
            }
        }

        if (sources.length === 0) {
            // Nenhuma URL retornou resultado útil. background.js vai cair para answerFromAi().
            console.log('[SimpleSearch] ⚠️ Nenhuma fonte gerou resposta válida');
            return [];
        }

        // ── Passo 5: Votação ponderada por confiança ──────────────────────────────
        // Cada fonte vota na sua letra com peso = sua confidence (0.0 – 1.0).
        // Ex: A=1.70 (2 fontes), B=0.85 (1 fonte) → A vence com dominância 67%
        const votes = {};
        for (const src of sources) {
            votes[src.letter] = (votes[src.letter] || 0) + src.confidence;
        }

        const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
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

        console.log(`[SimpleSearch] 🏆 Vencedor: ${bestLetter}) ${answerText}`);
        console.log(`[SimpleSearch] 📊 Votos:`, Object.entries(votes).map(([l, v]) => `${l}=${v.toFixed(2)}`).join(', '));
        console.log(`[SimpleSearch] 📊 Fontes=${sources.length} dominance=${dominance.toFixed(2)} resultState=${resultState}`);

        // Retorna array de 1 elemento — formato esperado por PopupController._finishBackgroundSearch()
        return [{
            question: questionText,
            answer: `Letra ${bestLetter}: ${answerText}`,
            answerLetter: bestLetter,
            answerText,
            resultState,
            confidence: finalConfidence,
            evidenceTier: 'WEB_SOURCES',
            optionsMap: originalOptionsMap, // { A: 'texto', B: 'texto', ... } — necessário para os pills de override
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
