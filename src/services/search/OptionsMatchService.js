

// AH_TEXT_TO_OPTION_V2
function __ahNorm(t = '') {
    return String(t || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function mapAnswerTextToOptionLetter(answerText = '', optionsMap = {}) {
    const ans = __ahNorm(answerText);
    if (!ans) return null;
    let best = null;
    for (const [letter, text] of Object.entries(optionsMap || {})) {
        const opt = __ahNorm(text);
        if (!opt) continue;
        const exact = (opt === ans || opt.includes(ans) || ans.includes(opt));
        const score = exact ? 1 : 0;
        if (!best || score > best.score) best = { letter, score };
    }
    return best && best.score > 0 ? best.letter : null;
}
/**
 * OptionsMatchService.js
 * Verifies whether a source page contains the same question options as the user's question.
 * Also handles letter remapping when options are in a different order on the source page.
 *
 * Depends on: QuestionParser
 */
import { QuestionParser } from './QuestionParser.js';

export const OptionsMatchService = {

    // ── Coverage ──────────────────────────────────────────────────────────────

    /**
     * Counts how many of the user's options appear in the free-form source text.
     * Returns { hits, total, ratio, hasEnoughOptions }
     */
    optionsCoverageInFreeText(originalOptions, sourceText) {
        if (!originalOptions || originalOptions.length < 2) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
        }
        if (!sourceText || sourceText.length < 80) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
        }

        const normalizedSource = QuestionParser.normalizeOption(sourceText);
        if (!normalizedSource) return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };

        const optionEntries = [];
        const seen = new Set();
        for (const rawOpt of originalOptions) {
            const cleaned = QuestionParser.stripOptionTailNoise(rawOpt);
            if (!cleaned) continue;
            const isCodeLike = QuestionParser.looksLikeCodeOption(cleaned);
            const normalized = isCodeLike
                ? QuestionParser.normalizeCodeAwareOption(cleaned)
                : QuestionParser.normalizeOption(cleaned);
            if (!normalized) continue;
            const dedupKey = isCodeLike ? `code:${normalized.replace(/\s+/g, '')}` : `text:${normalized}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            optionEntries.push({ normalized, isCodeLike });
        }

        const total = optionEntries.length;
        if (total === 0) return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };

        const normalizedSourceCode = QuestionParser.normalizeCodeAwareOption(sourceText);
        const sourceCompact = normalizedSource.replace(/\s+/g, '');
        const sourceCompactCode = normalizedSourceCode.replace(/\s+/g, '');
        const sourceTokenSet = new Set(normalizedSource.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 3));
        const sourceCodeTokenSet = new Set(normalizedSourceCode.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 3));
        const weakStop = new Set([
            'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'resposta',
            'dados', 'bancos', 'banco', 'modelo', 'modelos', 'nosql', 'sql'
        ]);

        let hits = 0;
        for (const entry of optionEntries) {
            const opt = entry.normalized;
            if (!opt) continue;

            if (entry.isCodeLike) {
                if (normalizedSourceCode.includes(opt)) { hits++; continue; }
                const optCompactCode = opt.replace(/\s+/g, '');
                if (optCompactCode.length >= 14 && sourceCompactCode.includes(optCompactCode)) { hits++; continue; }

                const optTokens = opt.split(/\s+/).map(t => t.trim()).filter(Boolean);
                const opTokens = optTokens.filter(t => t.startsWith('op_'));
                const lexTokens = optTokens.filter(t => !t.startsWith('op_') && t.length >= 4 && !weakStop.has(t));
                if (lexTokens.length === 0) continue;

                let lexHits = 0; for (const tk of lexTokens) { if (sourceCodeTokenSet.has(tk)) lexHits++; }
                const lexRatio = lexHits / lexTokens.length;
                let opHits = 0; for (const op of opTokens) { if (sourceCodeTokenSet.has(op)) opHits++; }
                const opRatio = opTokens.length > 0 ? (opHits / opTokens.length) : 1;

                if ((lexHits >= 2 && lexRatio >= 0.5 && opRatio >= 0.5) || (lexRatio >= 0.7 && opRatio >= 0.34)) hits++;
                continue;
            }

            if (normalizedSource.includes(opt)) { hits++; continue; }
            const optCompact = opt.replace(/\s+/g, '');
            if (optCompact.length >= 12 && sourceCompact.includes(optCompact)) { hits++; continue; }

            const optTokens = opt.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 4 && !weakStop.has(t));
            // For very short option bodies (< 4 chars each token, e.g. "csv", "txt", "xml"),
            // token matching would produce 0 tokens and skip entirely.
            // Fall back to a relaxed direct-substring check for these short options.
            if (optTokens.length === 0) {
                const shortTokens = opt.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2 && !weakStop.has(t));
                if (shortTokens.length > 0 && shortTokens.some(t => sourceTokenSet.has(t) || normalizedSource.includes(t))) hits++;
                continue;
            }
            let tokenHits = 0; for (const tk of optTokens) { if (sourceTokenSet.has(tk)) tokenHits++; }
            const tokenRatio = tokenHits / optTokens.length;
            if ((tokenHits >= 2 && tokenRatio >= 0.55) || tokenRatio >= 0.72) hits++;
        }

        return { hits, total, ratio: hits / total, hasEnoughOptions: true };
    },

    optionsMatchInFreeText(originalOptions, sourceText) {
        const coverage = this.optionsCoverageInFreeText(originalOptions, sourceText);
        if (!coverage.hasEnoughOptions || coverage.total === 0) return true;
        return coverage.ratio >= 0.6 || coverage.hits >= Math.min(3, coverage.total);
    },

    optionsMatch(originalOptions, sourceOptions) {
        if (!originalOptions || originalOptions.length < 2) return true;
        if (!sourceOptions || sourceOptions.length < 2) return true;

        const origNorms = originalOptions.map(o => QuestionParser.normalizeOption(QuestionParser.stripOptionTailNoise(o))).filter(Boolean);
        const srcNorms = sourceOptions.map(o => QuestionParser.normalizeOption(QuestionParser.stripOptionTailNoise(o))).filter(Boolean);
        if (origNorms.length === 0 || srcNorms.length === 0) return true;

        const srcSet = new Set(srcNorms);
        let exactHits = 0;
        for (const opt of origNorms) { if (srcSet.has(opt)) exactHits++; }
        if (exactHits >= 3 || (exactHits / origNorms.length) >= 0.6) return true;

        let fuzzyHits = 0;
        for (const orig of origNorms) {
            let bestSim = 0;
            for (const src of srcNorms) {
                const sim = QuestionParser.diceSimilarity(orig, src);
                if (sim > bestSim) bestSim = sim;
            }
            if (bestSim >= 0.75) fuzzyHits++;
        }
        return fuzzyHits >= 3 || (fuzzyHits / origNorms.length) >= 0.6;
    },

    computeMatchQuality(sourceText, questionText, originalOptions, originalOptionsMap) {
        if (!sourceText || !questionText) return 0;
        const stem = QuestionParser.extractQuestionStem(questionText);
        const topicScore = QuestionParser.questionSimilarityScore(sourceText, stem);
        const coverage = this.optionsCoverageInFreeText(originalOptions, sourceText);
        const coverageScore = coverage.hasEnoughOptions ? coverage.ratio : 0.5;
        return Math.min(1.0, topicScore * 0.6 + coverageScore * 0.4) * 3;
    },

    /**
     * Maps a free-form answer body to the closest user option body.
     * Returns null when confidence is weak or the match is ambiguous.
     */
    matchAnswerTextToOptions(answerText, optionsMap) {
        if (!answerText || !optionsMap || Object.keys(optionsMap).length < 2) return null;

        const normalizedAnswer = QuestionParser.normalizeOption(String(answerText || ''));
        if (!normalizedAnswer || normalizedAnswer.length < 2) return null;

        const stop = new Set([
            'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'resposta',
            'dados', 'banco', 'bancos', 'modelo', 'modelos', 'sobre', 'qual', 'quais',
            'como', 'para', 'com', 'sem', 'uma', 'um', 'de', 'da', 'do', 'das', 'dos',
            'na', 'no', 'nas', 'nos', 'ao', 'aos', 'as', 'os', 'e', 'ou', 'em'
        ]);
        const answerTokens = normalizedAnswer.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 4 && !stop.has(t));
        const normalizedAnswerCompact = normalizedAnswer.replace(/\s+/g, '');

        const scored = [];
        for (const [letterRaw, bodyRaw] of Object.entries(optionsMap || {})) {
            const letter = String(letterRaw || '').toUpperCase();
            if (!/^[A-E]$/.test(letter)) continue;

            const body = QuestionParser.stripOptionTailNoise(bodyRaw);
            const normalizedBody = QuestionParser.normalizeOption(body);
            if (!normalizedBody || normalizedBody.length < 2) continue;

            const bodyTokens = normalizedBody.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 4 && !stop.has(t));
            const normalizedBodyCompact = normalizedBody.replace(/\s+/g, '');
            const contains = normalizedAnswer.includes(normalizedBody)
                || (normalizedBodyCompact.length >= 16 && normalizedAnswerCompact.includes(normalizedBodyCompact));
            const reverseContains = (normalizedAnswer.length >= 20 && normalizedBody.includes(normalizedAnswer))
                || (normalizedAnswerCompact.length >= 16 && normalizedBodyCompact.includes(normalizedAnswerCompact));

            let tokenRatio = 0;
            let tokenHits = 0;
            if (answerTokens.length > 0 && bodyTokens.length > 0) {
                const bodyTokenSet = new Set(bodyTokens);
                for (const tk of answerTokens) {
                    if (bodyTokenSet.has(tk)) tokenHits += 1;
                }
                // Use answerTokens.length as denominator so shorter options don't
                // get artificially high scores when the answer has more context tokens
                tokenRatio = tokenHits / Math.max(1, answerTokens.length);
            }

            const dice = QuestionParser.diceSimilarity(normalizedAnswer, normalizedBody);
            const semanticScore = tokenRatio * 0.72 + dice * 0.28;
            const score = contains ? 1.0 : reverseContains ? 0.95 : semanticScore;
            scored.push({
                letter,
                body,
                score,
                tokenRatio,
                tokenHits,
                dice,
                contains,
                reverseContains,
                method: contains || reverseContains ? 'text-containment' : 'text-semantic'
            });
        }

        if (scored.length === 0) return null;
        scored.sort((a, b) => b.score - a.score);
        const top = scored[0];
        const second = scored[1] || null;
        const margin = top.score - (second?.score || 0);
        if (normalizedAnswer.length < 12) {
            const strictShortHits = scored.filter((entry) => {
                const normalizedBody = QuestionParser.normalizeOption(entry.body || '');
                return normalizedBody && normalizedBody === normalizedAnswer;
            });
            if (strictShortHits.length === 1) {
                return {
                    letter: strictShortHits[0].letter,
                    confidence: 0.90,
                    score: strictShortHits[0].score,
                    margin,
                    method: 'text-short-exact',
                    matchedBody: strictShortHits[0].body
                };
            }
        }
        const topStrong = top.contains || top.reverseContains;
        const topGoodSemantic = !topStrong && top.score >= 0.68 && top.tokenRatio >= 0.42 && top.tokenHits >= 2;
        const secondStrong = !!second && (second.contains || second.reverseContains || second.score >= 0.62);
        // If top has exact text containment, it's never ambiguous — containment is definitive
        const ambiguous = !topStrong && !!second && secondStrong && margin < (topStrong ? 0.12 : 0.10);

        if (!topStrong && !topGoodSemantic) return null;
        if (ambiguous) return null;

        return {
            letter: top.letter,
            confidence: topStrong ? 0.92 : Math.max(0.70, Math.min(0.90, top.score)),
            score: top.score,
            margin,
            method: top.method,
            matchedBody: top.body
        };
    },

    findLetterByAnswerText(answerText, optionsMap) {
        const match = this.matchAnswerTextToOptions(answerText, optionsMap);
        return match?.letter || null;
    },

    // ── Source option map ─────────────────────────────────────────────────────

    /**
     * Parses A) / B) / C) options from source text and returns { letter: body } map.
     */
    buildSourceOptionsMapFromText(sourceText) {
        if (!sourceText || sourceText.length < 30) return {};
        const map = {};
        const lines = sourceText.split('\n');
        let currentLetter = null;
        let currentParts = [];
        const flush = () => {
            if (currentLetter && currentParts.length > 0) {
                const body = currentParts.join(' ').replace(/\s+/g, ' ').trim();
                if (body.length >= 5) map[currentLetter] = body;
            }
        };
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const m = trimmed.match(/^([A-E])\s*[\)\.\-:]\s*(.*)$/i);
            if (m) {
                flush();
                currentLetter = m[1].toUpperCase();
                currentParts = m[2].trim() ? [m[2].trim()] : [];
            } else if (currentLetter) {
                if (/^(?:\d{1,3}\s*[\)\.\-:]|Aula\s+\d|Quest[aã]o\s+\d|Pergunta\s+\d)/i.test(trimmed)) {
                    flush(); currentLetter = null; currentParts = [];
                } else {
                    currentParts.push(trimmed);
                }
            }
        }
        flush();
        return map;
    },

    // ── Letter remapping ──────────────────────────────────────────────────────

    remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap) {
        if (!sourceLetter || !sourceOptionsMap || !userOptionsMap) {
            console.log(`    [remap] SKIP: missing data`);
            return sourceLetter;
        }
        const userEntries = Object.entries(userOptionsMap);
        if (userEntries.length < 2 || Object.keys(sourceOptionsMap).length < 2) {
            console.log(`    [remap] SKIP: too few options`);
            return sourceLetter;
        }
        const sourceBody = sourceOptionsMap[sourceLetter];
        if (!sourceBody || sourceBody.length < 5) {
            console.log(`    [remap] SKIP: source letter ${sourceLetter} has no body`);
            return sourceLetter;
        }
        console.log(`    [remap] Source letter=${sourceLetter} body="${sourceBody.slice(0, 80)}"`);

        const normSource = QuestionParser.normalizeOption(sourceBody);
        if (!normSource) return sourceLetter;
        const skeletonSource = normSource.replace(/\s+/g, '');

        let bestLetter = null;
        let bestScore = 0;
        for (const [userLetter, userBody] of userEntries) {
            const normUser = QuestionParser.normalizeOption(userBody);
            if (!normUser) continue;

            const containsFwd = normSource.includes(normUser);
            const containsRev = normUser.includes(normSource);
            if (containsFwd || containsRev) {
                const score = Math.min(normSource.length, normUser.length) + 1000;
                if (score > bestScore) { bestScore = score; bestLetter = userLetter; }
                continue;
            }
            const sim = QuestionParser.diceSimilarity(normSource, normUser);
            if (sim >= 0.70) {
                const score = sim * normUser.length;
                if (score > bestScore) { bestScore = score; bestLetter = userLetter; }
                continue;
            }
            const skeletonUser = normUser.replace(/\s+/g, '');
            const skelContainsFwd = skeletonSource.includes(skeletonUser);
            const skelContainsRev = skeletonUser.includes(skeletonSource);
            if (skelContainsFwd || skelContainsRev) {
                const score = Math.min(skeletonSource.length, skeletonUser.length) + 900;
                if (score > bestScore) { bestScore = score; bestLetter = userLetter; }
                continue;
            }
            const skelSim = QuestionParser.diceSimilarity(skeletonSource, skeletonUser);
            if (skelSim >= 0.70) {
                const score = skelSim * skeletonUser.length * 0.95;
                if (score > bestScore) { bestScore = score; bestLetter = userLetter; }
            }
        }

        if (bestLetter && bestLetter !== sourceLetter) {
            console.log(`    [remap] REMAPPED: ${sourceLetter} → ${bestLetter}`);
            return bestLetter;
        }
        console.log(`    [remap] NO CHANGE: best=${bestLetter || 'none'} === source=${sourceLetter}`);
        return bestLetter || sourceLetter;
    },

    remapLetterIfShuffled(sourceLetter, sourceText, userOptionsMap) {
        if (!sourceLetter || !sourceText || !userOptionsMap) return sourceLetter;
        if (Object.keys(userOptionsMap).length < 2) return sourceLetter;
        const sourceOptionsMap = this.buildSourceOptionsMapFromText(sourceText);
        console.log(`    [remapIfShuffled] letter=${sourceLetter} sourceOpts=${Object.keys(sourceOptionsMap).length}`);
        if (Object.keys(sourceOptionsMap).length < 2) {
            console.log(`    [remapIfShuffled] SKIP: not enough source options parsed`);
            return sourceLetter;
        }
        return this.remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap);
    },

    verifyHighlightMatch(rawLetter, remappedLetter, sourceOptionsMap, userOptionsMap, baseConfidence) {
        const highlightedText = (sourceOptionsMap || {})[rawLetter] || '';
        if (!highlightedText || highlightedText.length < 5) {
            console.log(`    [verify] SKIP: no highlighted text for raw letter ${rawLetter}`);
            return { confidence: baseConfidence, letter: remappedLetter };
        }
        if (!userOptionsMap || Object.keys(userOptionsMap).length < 2) {
            return { confidence: baseConfidence, letter: remappedLetter };
        }

        const normH = QuestionParser.normalizeOption(highlightedText).replace(/\s+/g, '');
        console.log(`    [verify] highlighted text for ${rawLetter}: "${highlightedText.slice(0, 100)}"`);

        let bestMatchLetter = null;
        let bestMatchScore = 0;
        for (const [userLetter, userBody] of Object.entries(userOptionsMap)) {
            const normU = QuestionParser.normalizeOption(userBody).replace(/\s+/g, '');
            if (!normU || normU.length < 5) continue;
            const skelContains = normH.includes(normU) || normU.includes(normH);
            const skelDice = QuestionParser.diceSimilarity(normH, normU);
            const score = skelContains ? (1000 + Math.min(normH.length, normU.length)) : skelDice;
            if (score > bestMatchScore) { bestMatchScore = score; bestMatchLetter = userLetter; }
        }

        if (bestMatchLetter && bestMatchScore >= 0.55) {
            if (bestMatchLetter !== remappedLetter) {
                console.log(`    [verify] ✅ CONTENT OVERRIDE: ${remappedLetter} → ${bestMatchLetter}`);
            } else {
                console.log(`    [verify] ✅ CONFIRMED: ${bestMatchLetter}`);
            }
            return { confidence: baseConfidence, letter: bestMatchLetter };
        }

        console.log(`    [verify] ❌ REJECTED: highlighted text matches NO user option. Anchor likely on wrong question.`);
        return null;
    },
};
