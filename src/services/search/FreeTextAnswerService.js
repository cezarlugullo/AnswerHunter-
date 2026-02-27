/**
 * FreeTextAnswerService.js
 * Extracts an answer letter from a free-text page (e.g. Brainly) where the
 * response is written in natural language and does NOT necessarily replicate
 * the original question options verbatim.
 *
 * Three strategies (ordered by cost / reliability):
 *  1. Anchor – finds a "Resposta:" block and uses OptionsMatchService (no LLM)
 *  2. Inverse scan – scores every user option against the full answer block (no LLM)
 *  3. LLM fallback – sends a focused prompt to the configured AI provider
 *
 * Depends on: QuestionParser, OptionsMatchService, ApiService
 */
import { QuestionParser } from './QuestionParser.js';
import { OptionsMatchService } from './OptionsMatchService.js';

// Lazy import to break circular dependency (ApiService imports SearchService transitively)
let _ApiService = null;
const getApiService = async () => {
    if (!_ApiService) {
        const mod = await import('../ApiService.js');
        _ApiService = mod.ApiService;
    }
    return _ApiService;
};

export const FreeTextAnswerService = {

    // ── Public entry point ────────────────────────────────────────────────────

    /**
     * Attempts to map the natural-language answer found in `pageText` to one
     * of the user's options.
     *
     * @param {string} pageText  - full plain text of the source page
     * @param {Object} optionsMap - { A: "body", B: "body", ... }
     * @param {string} questionStem - stem of the user's question (for relevance check)
     * @returns {{ letter, confidence, method, snippet } | null}
     */
    async extractAnswerFromFreeText(pageText, optionsMap, questionStem) {
        if (!pageText || !optionsMap || Object.keys(optionsMap).length < 2) return null;

        const answerBlock = this._extractAnswerBlock(pageText);
        if (!answerBlock) return null;

        // ── Strategy 1: anchor-based with OptionsMatchService ─────────────────
        const s1 = this._strategyAnchor(answerBlock, optionsMap);
        if (s1) return s1;

        // ── Strategy 2: inverse scan (Dice similarity per option) ─────────────
        const s2 = this._strategyInverseScan(answerBlock, optionsMap);
        if (s2) return s2;

        // ── Strategy 3: LLM fallback ──────────────────────────────────────────
        return await this._strategyLLM(answerBlock, optionsMap, questionStem);
    },

    // ── Answer block extraction ───────────────────────────────────────────────

    /**
     * Finds the "Resposta:" section in the page text and returns the answer body.
     * Returns null if no recognizable answer block is found.
     */
    _extractAnswerBlock(pageText) {
        const text = String(pageText || '');
        const lines = text.replace(/\r/g, '\n').split('\n')
            .map(l => l.replace(/\s+/g, ' ').trim())
            .filter(Boolean);

        const ANSWER_MARKER = /^(?:resposta|resposta\s+correta|alternativa\s+correta)\s*[:\-]?\s*$/i;
        const INLINE_MARKER = /^(?:resposta|resposta\s+correta|alternativa\s+correta)\s*[:\-]\s*(.+)$/i;
        // Matches full-sentence Brainly GQL answers like:
        // "A alternativa correta é a D. O comando..."
        // "A resposta correta é a alternativa B) Lista..."
        const SENTENCE_LETTER_MARKER = /^a\s+(?:alternativa|resposta|afirmativa)\s+(?:correta|certa)\s+[ée]+\s+a(?:\s+alternativa)?(?:\s+letra)?\s*([A-E])(?:[)\s\.]|$)/i;
        const NOISE_STOP = /^(?:explica[cç][aã]o|coment[aá]rio|pergunta|quest[aã]o|ver\s+mais|resposta[s]?\s+relacionadas|novas?\s+perguntas|ainda\s+tem|experimente|confira)\b/i;
        // Lines that are clearly UI chrome from Brainly, not answer content
        const UI_NOISE = /^(?:\d+\s+pesso|aluno|entrar|anuncio|bloqueador|avaliacao|para\s+estudantes|para\s+pais|codigo\s+de\s+conduta|brainly\b)/i;

        // 1a. Direct letter from sentence: "A alternativa correta é a D. ..."
        for (const line of lines) {
            const ms = line.match(SENTENCE_LETTER_MARKER);
            if (ms?.[1]) {
                // Return the FULL line as answer block so downstream can also access evidence
                return line.trim();
            }
        }

        // 1. Inline: "Resposta: texto da resposta"
        for (const line of lines) {
            const m = line.match(INLINE_MARKER);
            if (m?.[1] && m[1].length >= 2) return m[1].trim();
        }

        // 2. Block: "Resposta:" followed by content lines
        for (let i = 0; i < lines.length; i++) {
            if (!ANSWER_MARKER.test(lines[i])) continue;
            const collected = [];
            for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
                const next = lines[j];
                if (!next) continue;
                if (NOISE_STOP.test(next) || UI_NOISE.test(next)) break;
                if (collected.length > 0 && next.length < 5) break;
                collected.push(next);
                // Stop after one meaningful content line if short answer
                if (collected.length === 1 && next.length > 30) break;
            }
            if (collected.length > 0) return collected.join(' ').trim();
        }

        return null;
    },

    // ── Strategy 1: anchor via OptionsMatchService ────────────────────────────

    _strategyAnchor(answerBlock, optionsMap) {
        if (!answerBlock || answerBlock.length < 2) return null;

        // ── Direct letter extraction from Portuguese exam answer patterns ────────
        // Catches: "A alternativa correta é a D.", "é a alternativa B)", "letra C", "(D)"
        const DIRECT_LETTER_RE = /(?:alternativa|resposta|afirmativa)\s+(?:correta|certa)\s+[ée]+\s+a(?:\s+alternativa)?\s*([A-E])[)\s\.\b]|(?:\bé\s+a\s+|\bletra\s+|\bopcao\s+|\bopção\s+)([A-E])\b|\(([A-E])\)/i;
        const directMatch = answerBlock.match(DIRECT_LETTER_RE);
        if (directMatch) {
            const letter = (directMatch[1] || directMatch[2] || directMatch[3] || '').toUpperCase();
            if (letter && optionsMap[letter]) {
                return {
                    letter,
                    confidence: 0.88,
                    method: 'gql-direct-letter',
                    snippet: answerBlock.slice(0, 200)
                };
            }
        }

        const mapped = OptionsMatchService.matchAnswerTextToOptions(answerBlock, optionsMap);
        if (!mapped?.letter) return null;

        // Relaxed thresholds for natural-language answers
        if ((mapped.confidence || 0) < 0.65) return null;
        if ((mapped.margin || 0) < 0.06) return null;

        return {
            letter: mapped.letter,
            confidence: Math.min(0.88, mapped.confidence),
            method: 'freetext-anchor',
            snippet: answerBlock.slice(0, 200)
        };
    },

    // ── Strategy 2: inverse scan ──────────────────────────────────────────────

    /**
     * For each option in optionsMap, computes how well the answer block matches
     * that option using Dice similarity. Picks the winner if the margin is clear.
     */
    _strategyInverseScan(answerBlock, optionsMap) {
        if (!answerBlock || answerBlock.length < 8) return null;

        const normAnswer = QuestionParser.normalizeOption(answerBlock);
        if (!normAnswer || normAnswer.length < 6) return null;

        const scores = [];
        for (const [letter, body] of Object.entries(optionsMap)) {
            if (!body) continue;
            const normBody = QuestionParser.normalizeOption(body);
            if (!normBody || normBody.length < 4) continue;

            // Dice similarity between answer text and option body
            const dice = QuestionParser.diceSimilarity(
                normAnswer.slice(0, 200),
                normBody.slice(0, 200)
            );

            // Also check substring containment in both directions
            const answerContainsOption = normAnswer.includes(normBody.slice(0, Math.min(normBody.length, 40)));
            const optionContainsAnswer = normBody.includes(normAnswer.slice(0, Math.min(normAnswer.length, 40)));
            const containmentBonus = (answerContainsOption || optionContainsAnswer) ? 0.25 : 0;

            scores.push({ letter, score: Math.min(1.0, dice + containmentBonus), body });
        }

        if (scores.length < 2) return null;
        scores.sort((a, b) => b.score - a.score);

        const top = scores[0];
        const second = scores[1];
        const margin = top.score - second.score;

        if (top.score < 0.18 || margin < 0.12) return null;

        const confidence = Math.min(0.82, 0.55 + top.score * 0.3 + margin * 0.2);

        return {
            letter: top.letter,
            confidence,
            method: 'freetext-semantic',
            snippet: answerBlock.slice(0, 200)
        };
    },

    // ── Strategy 3: LLM fallback ──────────────────────────────────────────────

    async _strategyLLM(answerBlock, optionsMap, questionStem) {
        if (!answerBlock || answerBlock.length < 8) return null;

        const optionsList = Object.entries(optionsMap)
            .map(([letter, body]) => `${letter}) ${body}`)
            .join('\n');

        if (!optionsList) return null;

        // Build a synthetic "page text" that contains the answer block + options
        // so aiExtractFromPage can do its structured extraction
        const syntheticPageText = `Resposta:\n${answerBlock}\n\nAlternativas:\n${optionsList}`;
        // Build the question text in standard format that aiExtractFromPage expects
        const questionText = questionStem
            ? `${questionStem}\n${optionsList}`
            : optionsList;

        try {
            const ApiService = await getApiService();
            const result = await ApiService.aiExtractFromPage(syntheticPageText, questionText, 'brainly.com.br');
            if (!result?.letter) return null;

            return {
                letter: result.letter,
                confidence: Math.min(0.74, result.confidence || 0.70),
                method: 'freetext-ai',
                snippet: answerBlock.slice(0, 200)
            };
        } catch {
            return null;
        }
    }
};
