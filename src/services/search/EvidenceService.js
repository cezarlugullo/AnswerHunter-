/**
 * EvidenceService.js
 * Handles evidence scoring, voting, and answer confirmation logic.
 * Includes:
 *  - Explicit gabarito extraction (polarity-aware)
 *  - Question block finding (number-based + fingerprint)
 *  - Explanation-to-option content matching
 *  - Evidence block building (stance classification per option)
 *  - Vote computation and result state determination
 *
 * Depends on: QuestionParser, OptionsMatchService
 */
import { QuestionParser } from './QuestionParser.js';
import { OptionsMatchService } from './OptionsMatchService.js';

export const EvidenceService = {

    // ── Question block finding ─────────────────────────────────────────────────

    findQuestionBlockByFingerprint(sourceText, questionText) {
        if (!sourceText || !questionText) return null;
        const stem = QuestionParser.extractQuestionStem(questionText);
        const stemTokens = QuestionParser.extractKeyTokens(stem);
        if (stemTokens.length < 3) return null;

        const optionTokens = QuestionParser.extractOptionTokens(questionText);
        const hasOptionTokens = optionTokens.length >= 2;

        let chunks = sourceText.split('\n');
        if (chunks.length < 5 || chunks.some(c => c.length > 500)) {
            chunks = sourceText.replace(/([.?!])\s+(?=[A-Z0-9])/g, '$1\n').split('\n');
        }

        let bestStart = -1;
        let bestScore = 0;
        const windowSize = hasOptionTokens ? 10 : 5;

        for (let i = 0; i <= chunks.length - 1; i++) {
            const windowText = chunks.slice(i, i + windowSize).join(' ');
            const stemHits = QuestionParser.countTokenHits(windowText, stemTokens);
            const optHits = hasOptionTokens ? QuestionParser.countTokenHits(windowText, optionTokens) : 0;
            const score = stemHits + (optHits * 2);
            if (score > bestScore) { bestScore = score; bestStart = i; }
        }

        const stemThreshold = Math.max(3, Math.floor(stemTokens.length * 0.45));
        const bestWindowText = bestStart >= 0 ? chunks.slice(bestStart, bestStart + windowSize).join(' ') : '';
        const bestStemHits = bestStart >= 0 ? QuestionParser.countTokenHits(bestWindowText, stemTokens) : 0;
        const bestOptHits = hasOptionTokens && bestStart >= 0 ? QuestionParser.countTokenHits(bestWindowText, optionTokens) : 0;

        console.log(`    [find-block] bestStart=${bestStart}, stemHits=${bestStemHits}/${stemTokens.length}, optHits=${bestOptHits}/${optionTokens.length}, score=${bestScore}`);

        if (bestStart < 0 || bestStemHits < stemThreshold) return null;

        if (hasOptionTokens) {
            const minOptionHits = Math.max(1, Math.floor(optionTokens.length * 0.25));
            if (bestOptHits < minOptionHits) {
                console.log(`    [find-block] REJECTED: only ${bestOptHits}/${optionTokens.length} option tokens found. Wrong question block.`);
                return null;
            }
        }

        const blockStart = Math.max(0, bestStart - 2);
        const blockEnd = Math.min(chunks.length, bestStart + 20);
        return chunks.slice(blockStart, blockEnd).join('\n');
    },

    findQuestionBlock(sourceText, questionText) {
        if (!sourceText || !questionText) return null;
        const qNumMatch = (questionText || '').match(/^\s*(\d{1,3})\s*[\)\.\:\-]/);
        if (qNumMatch) {
            const qNum = qNumMatch[1];
            const patterns = [
                new RegExp(`(?:^|\\n)\\s*${qNum}\\s*[\\)\\.\\.\\:\\-]`, 'm'),
                new RegExp(`(?:^|\\n)\\s*(?:Quest[aã]o|Questão)\\s+${qNum}\\b`, 'im')
            ];
            for (const re of patterns) {
                const match = re.exec(sourceText);
                if (match) {
                    const start = Math.max(0, match.index - 50);
                    const end = Math.min(sourceText.length, match.index + 3000);
                    return { text: sourceText.slice(start, end), method: 'number' };
                }
            }
        }
        const fpBlock = this.findQuestionBlockByFingerprint(sourceText, questionText);
        if (fpBlock) return { text: fpBlock, method: 'fingerprint' };
        return null;
    },

    buildQuestionScopedText(sourceText, questionText, maxChars = 3200) {
        const raw = String(sourceText || '').trim();
        if (!raw) return '';
        const block = this.findQuestionBlock(raw, questionText);
        if (block?.text && block.text.length >= 120) return block.text.slice(0, maxChars);
        return raw.slice(0, maxChars);
    },

    // ── HTML snippet for AI ────────────────────────────────────────────────────

    extractHtmlAroundQuestion(html, questionStem, optionTokens, maxChars = 6000) {
        if (!html || !questionStem || html.length < 500) return null;
        const stemNorm = (questionStem || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
        const stemWords = stemNorm.split(/\s+/).filter(w => w.length >= 5).slice(0, 6);
        if (stemWords.length < 2) return null;

        const htmlLower = html.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let bestPos = -1;
        let bestHits = 0;

        for (let i = 0; i < htmlLower.length - 200; i += 200) {
            const window = htmlLower.substring(i, i + 600);
            let hits = 0;
            for (const w of stemWords) { if (window.includes(w)) hits++; }
            if (optionTokens?.length >= 2) { for (const t of optionTokens) { if (window.includes(t)) hits += 2; } }
            if (hits > bestHits) { bestHits = hits; bestPos = i; }
        }

        if (bestPos < 0 || bestHits < 2) return null;
        const halfWindow = Math.floor(maxChars / 2);
        let start = Math.max(0, bestPos - halfWindow);
        let end = Math.min(html.length, bestPos + halfWindow);
        const tagOpen = html.lastIndexOf('<', start + 50);
        if (tagOpen > start - 200 && tagOpen >= 0) start = tagOpen;
        const tagClose = html.indexOf('>', end - 50);
        if (tagClose > 0 && tagClose < end + 200) end = tagClose + 1;
        return html.substring(start, end);
    },

    // ── Candidate selection ────────────────────────────────────────────────────

    chooseBestCandidate(candidates) {
        if (!candidates || candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];
        const patternPriority = {
            'gab-explicito': 1.0, 'gab-letra': 0.9, 'resposta-correta': 0.85,
            'gab-abrev': 0.8, 'gab-inline': 0.7, 'ai': 0.5
        };
        const scored = candidates.map(c => ({ ...c, score: (c.confidence || 0.5) * (patternPriority[c.matchLabel] || 0.6) }));
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const second = scored[1];
        if (second && second.letter !== best.letter && (best.score - second.score) < 0.15) {
            console.log(`EvidenceService: Conflict between candidates: ${best.letter}(${best.score.toFixed(2)}) vs ${second.letter}(${second.score.toFixed(2)})`);
            return null;
        }
        return best;
    },

    // ── Explicit gabarito extraction (polarity-aware) ──────────────────────────

    extractExplicitGabarito(text, questionText = '') {
        if (!text) return null;
        const questionPolarity = QuestionParser.detectQuestionPolarity(questionText);
        const patterns = [
            { re: /(?:^|\b)(?:gabarito|resposta\s+correta|alternativa\s+correta|item\s+correto)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi, label: 'gab-explicito', confidence: 0.95 },
            { re: /(?:^|\b)(?:a\s+resposta\s+correta\s+[eé]|a\s+alternativa\s+correta\s+[eé])\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/gi, label: 'resposta-correta', confidence: 0.92 },
            { re: /(?:^|\b)(?:letra|alternativa)\s+([A-E])\s*(?:[eé]\s+(?:a\s+)?(?:correta|certa|resposta))/gi, label: 'gab-letra', confidence: 0.9 },
            { re: /(?:^|\b)gab(?:arito)?\.?\s*[:\-]?\s*([A-E])\b/gi, label: 'gab-abrev', confidence: 0.88 }
        ];
        const matches = [];
        for (const { re, label, confidence } of patterns) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
                const letter = (m[1] || '').toUpperCase();
                if (!letter) continue;
                matches.push({ letter, confidence, matchLabel: label, index: m.index, questionPolarity });
            }
        }
        if (matches.length === 0) return null;
        return this.chooseBestCandidate(matches);
    },

    // ── Explicit letter from text ──────────────────────────────────────────────

    extractExplicitLetterFromText(text, questionStem, originalOptions) {
        if (!text) return null;
        const polarity = QuestionParser.detectQuestionPolarity(questionStem);
        const tokens = QuestionParser.extractKeyTokens(questionStem);

        const patterns = [
            /(?:^|\b)(?:gabarito|resposta\s+correta|alternativa\s+correta|item\s+correto)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/i,
            /(?:^|\b)(?:a\s+resposta\s+correta\s+e|a\s+alternativa\s+correta\s+e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i
        ];

        if (polarity === 'INCORRECT' || polarity === 'UNKNOWN') {
            patterns.push(
                /(?:^|\b)(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*(?:é|e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i,
                /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+([A-E])\s*(?:é|e)\s*(?:a\s+)?(?:falsa|incorreta|errada)\b/i,
                /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*[:\-]?\s*([A-E])\b/i,
                /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*(?:é|e)\s*(?:a\s+)?([A-E])\s*[\)\.\-:]/i
            );
        }

        for (const re of patterns) {
            const m = text.match(re);
            if (!m) continue;
            const letter = (m[1] || '').toUpperCase();
            if (!letter) continue;
            const idx = m.index || 0;
            const start = Math.max(0, idx - 600);
            const end = Math.min(text.length, idx + 900);
            const window = text.slice(start, end);
            if (tokens.length > 0 && QuestionParser.countTokenHits(window, tokens) < Math.min(2, tokens.length)) continue;
            if (originalOptions?.length >= 2 && !OptionsMatchService.optionsMatchInFreeText(originalOptions, window)) continue;
            return { letter, confidence: 0.9, evidence: window };
        }
        return null;
    },

    // ── Hallucination guard ────────────────────────────────────────────────────

    isExplicitLetterSafe(text, letter, expectedBody) {
        if (!expectedBody) return true;
        const isShortAcronym = expectedBody.length <= 6 && QuestionParser.looksLikeCodeOption(expectedBody);

        if (isShortAcronym && text.length > 80) {
            if (!QuestionParser.normalizeCodeAwareOption(text).includes(QuestionParser.normalizeCodeAwareOption(expectedBody))) {
                console.log(`    [guard] REJECT: Explicit said ${letter} but short option "${expectedBody}" is absent.`);
                return false;
            }
        }

        const rx = new RegExp(`(?:letra|alternativa|op[cç][aã]o|resposta)\\s*(?:correta\\s*(?:[eé]\\s*(?:a\\s+)?)?)?${letter}\\s*[)\\.\\-:]?\\s*([^\\.\\.,;\\n]+)`, 'i');
        const m = text.match(rx);
        if (m && m[1]) {
            const nextWords = QuestionParser.normalizeOption(m[1].trim());
            if (nextWords && !/^(?:pois|porque|já\s*que|dado|como|sendo|visto|uma\s*vez)/.test(nextWords)) {
                const dice = QuestionParser.diceSimilarity(nextWords, expectedBody);
                if (dice < 0.2) {
                    const nextTokens = nextWords.split(/\s+/).filter(t => t.length >= 3);
                    let shared = 0;
                    for (const tk of nextTokens) { if (expectedBody.includes(tk)) shared++; }
                    if (shared === 0 && nextTokens.length >= 1 && nextTokens.length <= 4) {
                        console.log(`    [guard] REJECT: Explicit text "${nextWords}" contradicts expected "${expectedBody}".`);
                        return false;
                    }
                }
            }
        }
        return true;
    },

    // ── Local answer extraction ────────────────────────────────────────────────

    extractAnswerLocally(sourceText, questionText, originalOptions) {
        if (!sourceText || sourceText.length < 50) return null;
        const block = this.findQuestionBlock(sourceText, questionText);
        const searchText = block ? block.text : sourceText;

        const optionsMap = {};
        if (originalOptions) {
            for (const opt of originalOptions) {
                const m = opt.match(/^([A-E])\)\s*(.*)/i);
                if (m) optionsMap[m[1].toUpperCase()] = m[2].trim();
            }
        }

        const gabarito = this.extractExplicitGabarito(searchText, questionText);
        if (gabarito) {
            const expectedBody = optionsMap[gabarito.letter];
            if (!expectedBody || this.isExplicitLetterSafe(searchText, gabarito.letter, expectedBody)) {
                return { ...gabarito, evidenceType: 'explicit-gabarito', blockMethod: block?.method || 'full-text' };
            }
        }

        const explanationMatch = this.matchExplanationToOption(searchText, questionText, originalOptions);
        if (explanationMatch) return { ...explanationMatch, evidenceType: 'explanation-content-match', blockMethod: block?.method || 'full-text' };

        return null;
    },

    // ── Explanation-to-option matching ─────────────────────────────────────────

    matchExplanationToOption(sourceText, questionText, originalOptions) {
        if (!sourceText || !originalOptions || originalOptions.length < 2) return null;
        const questionStem = QuestionParser.extractQuestionStem(questionText);
        const stemTokens = QuestionParser.extractKeyTokens(questionStem);
        if (stemTokens.length < 2) return null;

        const polarity = QuestionParser.detectQuestionPolarity(questionStem);
        const hasNegation = polarity === 'INCORRECT';

        const optionsMap = {};
        for (const opt of originalOptions) {
            const m = opt.match(/^([A-E])\)\s*(.*)/i);
            if (m) optionsMap[m[1].toUpperCase()] = m[2].trim();
        }
        if (Object.keys(optionsMap).length < 2) return null;

        const block = this.findQuestionBlock(sourceText, questionText);
        const searchText = block ? block.text : sourceText;

        const lastOptPattern = /(?:^|\n)\s*[eE]\s*[\)\.\-:]\s*.{5,}/m;
        const lastOptMatch = lastOptPattern.exec(searchText);
        if (!lastOptMatch) return null;

        const explanationStart = lastOptMatch.index + lastOptMatch[0].length;
        const explanationText = searchText.slice(explanationStart, explanationStart + 2000).trim();
        if (explanationText.length < 80) return null;

        const explNorm = QuestionParser.normalizeOption(explanationText);
        const topicHits = QuestionParser.countTokenHits(explNorm, stemTokens);
        const requiredTopicHits = Math.max(2, Math.floor(stemTokens.length * 0.4));
        if (topicHits < requiredTopicHits) {
            console.log(`    [expl-match] REJECTED: topicHits=${topicHits} < required=${requiredTopicHits}`);
            return null;
        }

        const scores = {};
        for (const [letter, body] of Object.entries(optionsMap)) {
            const optNorm = QuestionParser.normalizeOption(body);
            const optTokens = optNorm.split(/\s+/).filter(t => t.length >= 3);
            if (optTokens.length === 0) { scores[letter] = 0; continue; }
            let tokenHits = 0;
            for (const tok of optTokens) { if (explNorm.includes(tok)) tokenHits++; }
            const tokenRatio = tokenHits / optTokens.length;
            const dice = QuestionParser.diceSimilarity(explNorm, optNorm);
            scores[letter] = (tokenRatio * 0.6) + (dice * 0.4);
        }

        if (hasNegation) {
            const maxScore = Math.max(...Object.values(scores));
            if (maxScore > 0) {
                for (const letter of Object.keys(scores)) { scores[letter] = maxScore - scores[letter]; }
            }
        }

        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        if (sorted.length < 2) return null;
        const [bestLetter, bestScore] = sorted[0];
        const [, secondScore] = sorted[1];
        const margin = bestScore - secondScore;

        if (bestScore < 0.25 || margin < 0.08) return null;

        let confidence = Math.min(0.88, 0.60 + (bestScore * 0.2) + (margin * 0.3));
        if (hasNegation) confidence = Math.min(confidence, 0.72);

        return { letter: bestLetter, confidence, matchLabel: 'explanation-content-match', evidence: explanationText.slice(0, 500) };
    },

    // ── Stance classification ──────────────────────────────────────────────────

    extractOptionAnchor(optionBody = '') {
        const stop = new Set([
            'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'resposta', 'gabarito',
            'dados', 'banco', 'bancos', 'modelo', 'modelos', 'nosql', 'sql', 'apenas', 'nao', 'com', 'sem'
        ]);
        return QuestionParser.normalizeOption(optionBody).split(/\s+/).filter(t => t.length >= 4 && !stop.has(t)).slice(0, 7).join(' ');
    },

    classifyOptionStance(evidenceText, optionBody, optionLetter) {
        const evidenceNorm = QuestionParser.normalizeOption(evidenceText || '');
        const optionNorm = QuestionParser.normalizeOption(optionBody || '');
        if (!evidenceNorm || !optionNorm) return { stance: 'neutral', score: 0 };

        const letter = String(optionLetter || '').toUpperCase();
        const letPosRe = letter ? new RegExp(`(?:letra|alternativa|opção)\\s*${letter}\\s*(?:e|eh)?\\s*(?:a\\s+)?(?:correta|certa|resposta)`, 'i') : null;
        const letNegRe = letter ? new RegExp(`(?:letra|alternativa|opção)\\s*${letter}\\s*(?:e|eh)?\\s*(?:a\\s+)?(?:incorreta|falsa|errada)`, 'i') : null;

        if (letPosRe && letPosRe.test(evidenceText || '')) return { stance: 'entails', score: 0.84 };
        if (letNegRe && letNegRe.test(evidenceText || '')) return { stance: 'contradicts', score: 0.84 };

        const anchor = this.extractOptionAnchor(optionBody);
        if (!anchor || anchor.length < 10) return { stance: 'neutral', score: 0 };

        const idx = evidenceNorm.indexOf(anchor);
        if (idx < 0) return { stance: 'neutral', score: 0 };

        const start = Math.max(0, idx - 160);
        const end = Math.min(evidenceNorm.length, idx + anchor.length + 200);
        const ctx = evidenceNorm.slice(start, end);

        const hasPositive = /(gabarito|resposta correta|alternativa correta|esta correta|item correto|resposta final)/i.test(ctx);
        const hasNegative = /(incorreta|falsa|errada|nao correta|item incorreto)/i.test(ctx);

        if (hasPositive && !hasNegative) return { stance: 'entails', score: 0.74 };
        if (hasNegative && !hasPositive) return { stance: 'contradicts', score: 0.74 };
        return { stance: 'neutral', score: 0.2 };
    },

    // ── Evidence block building ────────────────────────────────────────────────

    buildDefaultOptionEvals(originalOptionsMap = {}) {
        const evals = {};
        const letters = Object.keys(originalOptionsMap).length > 0 ? Object.keys(originalOptionsMap) : ['A', 'B', 'C', 'D', 'E'];
        for (const letter of letters) { evals[letter] = { stance: 'neutral', score: 0 }; }
        return evals;
    },

    buildEvidenceBlock({ questionFingerprint = '', sourceId = '', sourceLink = '', hostHint = '', evidenceText = '', originalOptionsMap = {}, explicitLetter = '', confidenceLocal = 0.65, evidenceType = '' } = {}) {
        const optionEvals = this.buildDefaultOptionEvals(originalOptionsMap);
        for (const [letter, body] of Object.entries(originalOptionsMap || {})) {
            optionEvals[letter] = this.classifyOptionStance(evidenceText, body, letter);
        }
        const chosen = String(explicitLetter || '').toUpperCase().trim();
        if (/^[A-E]$/.test(chosen)) {
            const prev = optionEvals[chosen] || { stance: 'neutral', score: 0 };
            const nextScore = Math.max(prev.score || 0, Math.max(0.72, Math.min(0.96, Number(confidenceLocal) || 0.72)));
            optionEvals[chosen] = { stance: 'entails', score: nextScore };
        }
        const citationText = String(evidenceText || '').replace(/\s+/g, ' ').trim().slice(0, 320);
        return {
            questionFingerprint,
            sourceId,
            sourceLink: sourceLink || '',
            hostHint: hostHint || '',
            explicitLetter: /^[A-E]$/.test(chosen) ? chosen : null,
            optionEvals,
            citations: citationText ? [{ text: citationText, sourceLink: sourceLink || '', host: hostHint || '' }] : [],
            confidenceLocal: Math.max(0.25, Math.min(0.98, Number(confidenceLocal) || 0.65)),
            evidenceType: String(evidenceType || '')
        };
    },

    // ── Vote computation ───────────────────────────────────────────────────────

    computeVotesAndState(sources) {
        const votes = {};
        for (const s of sources) {
            if (!s.letter) continue;
            votes[s.letter] = (votes[s.letter] || 0) + (s.weight || 1);
        }

        const evidenceVotes = {};
        const evidenceEntailsCount = {};
        const evidenceDomainsByLetter = {};
        const getHostFromSource = (src) => {
            if (src?.hostHint) return String(src.hostHint).toLowerCase();
            try { return new URL(src?.link || '').hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
        };

        for (const src of sources) {
            if (!src?.evidenceBlock || !src?.letter) continue;
            const host = getHostFromSource(src);
            const block = src.evidenceBlock;
            const localWeight = Math.max(0.2, Math.min(1.1, block.confidenceLocal || 0.65));
            const optionEval = block.optionEvals?.[src.letter];
            if (optionEval?.stance !== 'entails') continue;
            const evalScore = Math.max(0.2, Math.min(1.0, optionEval?.score || localWeight));
            const bonus = (src.weight || 1) * evalScore * 0.45;
            evidenceVotes[src.letter] = (evidenceVotes[src.letter] || 0) + bonus;
            evidenceEntailsCount[src.letter] = (evidenceEntailsCount[src.letter] || 0) + 1;
            if (!evidenceDomainsByLetter[src.letter]) evidenceDomainsByLetter[src.letter] = new Set();
            if (host) evidenceDomainsByLetter[src.letter].add(host);
        }

        const mergedVotes = {};
        const allLetters = new Set([...Object.keys(votes), ...Object.keys(evidenceVotes)]);
        for (const letter of allLetters) {
            mergedVotes[letter] = (votes[letter] || 0) + (evidenceVotes[letter] || 0);
        }

        const sorted = Object.entries(mergedVotes).sort((a, b) => b[1] - a[1]);
        const best = sorted[0] || null;
        const second = sorted[1] || null;
        const bestLetter = best ? best[0] : null;
        const bestScore = best ? best[1] : 0;
        const secondScore = second ? second[1] : 0;
        const total = sorted.reduce((acc, [, v]) => acc + v, 0) || 1;
        const margin = bestScore - secondScore;

        const getHost = (link) => { try { return new URL(link).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
        const isWeakHost = (host) => ['brainly.com.br', 'brainly.com', 'studocu.com', 'passeidireto.com'].includes(String(host || '').toLowerCase());
        const isStrongSource = (src) => {
            const host = src.hostHint || getHost(src.link);
            const et = String(src.evidenceType || '').toLowerCase();
            if (isWeakHost(host)) return false;
            if (/\.(pdf)(\?|$)/i.test(String(src.link || ''))) return true;
            if (host.endsWith('.gov.br') || host.endsWith('.edu.br')) return true;
            if (host === 'qconcursos.com' || host === 'qconcursos.com.br') return true;
            if (et.includes('pdf-anchor') || et.includes('answercard')) return true;
            return false;
        };

        const nonAiSources = sources.filter(s => s.evidenceType && s.evidenceType !== 'ai' && s.evidenceType !== 'ai-combined');
        const bestNonAi = nonAiSources.filter(s => s.letter === bestLetter);
        const bestDomains = new Set(bestNonAi.map(s => (s.hostHint || getHost(s.link))).filter(Boolean));
        const bestStrongDomains = new Set(bestNonAi.filter(isStrongSource).map(s => (s.hostHint || getHost(s.link))).filter(Boolean));
        const bestEvidenceCount = bestLetter ? (evidenceEntailsCount[bestLetter] || 0) : 0;
        const bestEvidenceDomains = bestLetter ? ((evidenceDomainsByLetter[bestLetter]?.size) || 0) : 0;

        let resultState = 'inconclusive';
        let reason = 'inconclusive';

        if (bestLetter) {
            const hasAnyNonAi = bestNonAi.length > 0;
            const hasStrongConsensus = bestStrongDomains.size >= 2;
            const hasDomainConsensus = bestDomains.size >= 2;
            const hasMinimumVotes = bestScore >= 5.0;
            const hasMargin = margin >= 1.0;
            const hasEvidenceConsensus = bestEvidenceCount >= 2 && bestEvidenceDomains >= 2;

            if (hasAnyNonAi && hasStrongConsensus && hasDomainConsensus && hasMinimumVotes && hasMargin && hasEvidenceConsensus) {
                resultState = 'confirmed'; reason = 'confirmed_by_sources';
            } else if (hasAnyNonAi && bestNonAi.length >= 1 && bestScore >= 3.0) {
                const hasHighQualityMethod = bestNonAi.some(s => {
                    const et = String(s.evidenceType || '').toLowerCase();
                    return et.includes('pdf') || et.includes('highlight') || et.includes('answercard') || et.includes('gabarito');
                });
                if (hasHighQualityMethod || hasDomainConsensus) { resultState = 'suggested'; reason = 'ai_combined_suggestion'; }
            } else if (bestScore > 0 && !hasAnyNonAi && sources.length >= 1) {
                resultState = 'suggested'; reason = 'ai_combined_suggestion';
            } else if (second && margin < 1.0 && hasAnyNonAi) {
                resultState = 'conflict'; reason = 'source_conflict';
            }
        }

        let confidence = Math.max(0.25, Math.min(0.98, bestScore / total));
        if (resultState !== 'confirmed') confidence = Math.min(confidence, 0.79);
        if (resultState === 'confirmed') confidence = Math.max(confidence, 0.85);
        if (resultState === 'suggested') confidence = Math.max(confidence, 0.50);

        return {
            votes: mergedVotes, baseVotes: votes, evidenceVotes,
            bestLetter, resultState, reason, confidence, margin,
            evidenceConsensus: { bestEvidenceCount, bestEvidenceDomains }
        };
    },
};
