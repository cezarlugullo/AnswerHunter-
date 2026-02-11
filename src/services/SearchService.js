import { ApiService } from './ApiService.js';

// SearchService
// Coordinates (1) direct extraction and (2) web search + evidence-based refinement.
export const SearchService = {
    _stripOptionTailNoise(text) {
        if (!text) return '';
        let cleaned = String(text).replace(/\s+/g, ' ').trim();
        const noiseMarker = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eÃƒÂ©]ns|voc[eÃƒÂª]\s+acertou|confira\s+o\s+gabarito|explica[cÃƒÂ§][aÃƒÂ£]o)\b/i;
        const idx = cleaned.search(noiseMarker);
        if (idx > 20) cleaned = cleaned.slice(0, idx).trim();
        return cleaned.replace(/[;:,\-.\s]+$/g, '').trim();
    },

    _normalizeOption(text) {
        return (text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^[a-e]\s*[\)\.\-:]\s*/i, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    },

    _extractOptionsFromQuestion(questionText) {
        if (!questionText) return [];
        const text = String(questionText || '').replace(/\r\n/g, '\n');
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const options = [];
        const seen = new Set();
        const optionRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
        for (const line of lines) {
            const m = line.match(optionRe);
            if (!m) continue;
            const letter = (m[1] || '').toUpperCase();
            const cleanedBody = this._stripOptionTailNoise(m[2]);
            if (!cleanedBody || seen.has(letter)) continue;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
        }

        // Fallback for one-line statements: "a) ... b) ... c) ..."
        if (options.length < 2) {
            const inlineRe = /(?:^|[\n\r\t ;])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;][A-E]\s*[\)\.\-:]\s)|$)/gi;
            let m;
            while ((m = inlineRe.exec(text)) !== null) {
                const letter = (m[1] || '').toUpperCase();
                if (!letter || seen.has(letter)) continue;
                const cleanedBody = this._stripOptionTailNoise(m[2]);
                if (!cleanedBody) continue;
                options.push(`${letter}) ${cleanedBody}`);
                seen.add(letter);
                if (options.length >= 5) break;
            }
        }

        return options;
    },

    _extractQuestionStem(questionWithOptions) {
        const text = (questionWithOptions || '').replace(/\r\n/g, '\n');
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const optionRe = /^([A-E])\s*[\)\.\-:]/i;
        const stemLines = [];
        for (const line of lines) {
            if (optionRe.test(line)) break;
            stemLines.push(line);
        }
        let stem = (stemLines.join(' ').trim() || text.trim());
        const inlineOpt = stem.match(/[\s:;]([A-E])\s*[\)\.\-:]\s+/i);
        if (inlineOpt && Number.isFinite(inlineOpt.index) && inlineOpt.index > 30) {
            stem = stem.slice(0, inlineOpt.index).trim();
        }
        return stem.slice(0, 600);
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â Dice bigram similarity for fuzzy matching Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    _diceSimilarity(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 1;
        if (a.length < 2 || b.length < 2) return 0;
        const bigrams = (s) => {
            const set = new Map();
            for (let i = 0; i < s.length - 1; i++) {
                const bi = s.slice(i, i + 2);
                set.set(bi, (set.get(bi) || 0) + 1);
            }
            return set;
        };
        const biA = bigrams(a);
        const biB = bigrams(b);
        let intersection = 0;
        for (const [bi, count] of biA) {
            if (biB.has(bi)) intersection += Math.min(count, biB.get(bi));
        }
        return (2.0 * intersection) / (a.length - 1 + b.length - 1);
    },

    _optionsMatch(originalOptions, sourceOptions) {
        if (!originalOptions || originalOptions.length < 2) return true;
        if (!sourceOptions || sourceOptions.length < 2) return true;

        const origNorms = originalOptions
            .map(o => this._normalizeOption(this._stripOptionTailNoise(o)))
            .filter(Boolean);
        const srcNorms = sourceOptions
            .map(o => this._normalizeOption(this._stripOptionTailNoise(o)))
            .filter(Boolean);
        if (origNorms.length === 0 || srcNorms.length === 0) return true;

        // Exact match
        const srcSet = new Set(srcNorms);
        let exactHits = 0;
        for (const opt of origNorms) {
            if (srcSet.has(opt)) exactHits += 1;
        }
        if (exactHits >= 3 || (exactHits / origNorms.length) >= 0.6) return true;

        // Fuzzy match (Dice similarity)
        let fuzzyHits = 0;
        for (const orig of origNorms) {
            let bestSim = 0;
            for (const src of srcNorms) {
                const sim = this._diceSimilarity(orig, src);
                if (sim > bestSim) bestSim = sim;
            }
            if (bestSim >= 0.75) fuzzyHits++;
        }
        return fuzzyHits >= 3 || (fuzzyHits / origNorms.length) >= 0.6;
    },

    _optionsCoverageInFreeText(originalOptions, sourceText) {
        if (!originalOptions || originalOptions.length < 2) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
        }
        if (!sourceText || sourceText.length < 80) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
        }

        const normalizedSource = this._normalizeOption(sourceText);
        if (!normalizedSource) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
        }

        const originalSet = new Set(
            originalOptions
                .map(o => this._normalizeOption(this._stripOptionTailNoise(o)))
                .filter(Boolean)
        );
        const total = originalSet.size;
        if (total === 0) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
        }

        let hits = 0;
        for (const opt of originalSet) {
            if (opt && normalizedSource.includes(opt)) hits += 1;
        }

        return {
            hits,
            total,
            ratio: hits / total,
            hasEnoughOptions: true
        };
    },

    _optionsMatchInFreeText(originalOptions, sourceText) {
        const coverage = this._optionsCoverageInFreeText(originalOptions, sourceText);
        if (!coverage.hasEnoughOptions || coverage.total === 0) return true;
        return coverage.ratio >= 0.6 || coverage.hits >= Math.min(3, coverage.total);
    },

    _buildOptionsMap(questionText) {
        const options = this._extractOptionsFromQuestion(questionText);
        const map = {};
        for (const opt of options) {
            const m = opt.match(/^([A-E])\)\s*(.+)$/i);
            if (m) map[m[1].toUpperCase()] = this._stripOptionTailNoise(m[2]);
        }
        return map;
    },

    _parseAnswerLetter(answerText) {
        if (!answerText) return null;
        let letter = null;
        let m = answerText.match(/\b(?:letra|alternativa|letter|option)\s*([A-E])\b/i);
        if (m) letter = m[1].toUpperCase();
        if (!letter) {
            m = answerText.match(/^\s*([A-E])\s*[\)\.\-:]/i);
            if (m) letter = m[1].toUpperCase();
        }
        return letter;
    },

    _parseAnswerText(answerText) {
        if (!answerText) return '';
        return answerText
            .replace(/^(?:Letra|Alternativa|Letter|Option)\s*[A-E]\s*[:.\-]?\s*/i, '')
            .replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '')
            .trim();
    },

    _findLetterByAnswerText(answerBody, optionsMap) {
        if (!answerBody || !optionsMap) return null;
        const normalizedAnswer = this._normalizeOption(answerBody);
        let bestLetter = null;
        let bestScore = 0;
        Object.entries(optionsMap).forEach(([letter, body]) => {
            const normalizedBody = this._normalizeOption(body);
            if (!normalizedBody) return;
            if (normalizedAnswer.includes(normalizedBody)) {
                const score = normalizedBody.length;
                if (score > bestScore) {
                    bestScore = score;
                    bestLetter = letter;
                }
            }
        });
        return bestLetter;
    },

    _extractKeyTokens(stem) {
        const stop = new Set([
            'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'resposta', 'gabarito',
            'que', 'qual', 'quais', 'como', 'para', 'por', 'com', 'sem', 'uma', 'um', 'de', 'da', 'do',
            'das', 'dos', 'na', 'no', 'nas', 'nos', 'ao', 'aos', 'as', 'os', 'e', 'ou', 'em'
        ]);
        const tokens = this._normalizeOption(stem).split(' ').filter(Boolean);
        const filtered = tokens.filter(t => t.length >= 5 && !stop.has(t));
        return filtered.slice(0, 10);
    },

    _countTokenHits(text, tokens) {
        if (!text || !tokens || tokens.length === 0) return 0;
        const normalized = this._normalizeOption(text);
        let hits = 0;
        for (const t of tokens) {
            if (normalized.includes(t)) hits++;
        }
        return hits;
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â DICE SIMILARITY (bigram) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    // Character-bigram Dice coefficient: 0..1
    _diceSimilarity(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 1;
        const bigrams = (s) => {
            const set = new Map();
            for (let i = 0; i < s.length - 1; i++) {
                const bg = s.substring(i, i + 2);
                set.set(bg, (set.get(bg) || 0) + 1);
            }
            return set;
        };
        const bga = bigrams(a);
        const bgb = bigrams(b);
        let intersection = 0;
        for (const [bg, count] of bga) {
            intersection += Math.min(count, bgb.get(bg) || 0);
        }
        return (2 * intersection) / (a.length - 1 + b.length - 1) || 0;
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â QUESTION SIMILARITY SCORE Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    // Returns 0..1 score indicating how similar a source snippet is to the original question stem.
    // Used to gate Brainly and other weak sources Ã¢â‚¬â€ they must match the actual question.
    _questionSimilarityScore(sourceText, questionStem) {
        if (!sourceText || !questionStem) return 0;
        const srcNorm = this._normalizeOption(sourceText);
        const stemNorm = this._normalizeOption(questionStem);

        // 1) Token overlap (Jaccard-like)
        const stemTokens = stemNorm.split(/\s+/).filter(t => t.length >= 4);
        const srcTokens = new Set(srcNorm.split(/\s+/).filter(t => t.length >= 4));
        if (stemTokens.length === 0) return 0;
        let hits = 0;
        for (const t of stemTokens) {
            if (srcTokens.has(t)) hits++;
        }
        const tokenScore = hits / stemTokens.length;

        // 2) Prefix match (first 50 chars of normalized stem)
        const prefix = stemNorm.slice(0, 50);
        const prefixMatch = prefix.length >= 20 && srcNorm.includes(prefix) ? 0.3 : 0;

        // 3) Dice similarity on short substring
        const diceScore = this._diceSimilarity(
            stemNorm.slice(0, 120),
            srcNorm.slice(0, Math.min(srcNorm.length, 500))
        );

        return Math.min(1.0, tokenScore * 0.5 + prefixMatch + diceScore * 0.3);
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â CANONICAL QUESTION HASH Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    // Creates a stable hash from question + options for cache/dedup
    _canonicalizeQuestion(questionText) {
        const stem = this._extractQuestionStem(questionText);
        const options = this._extractOptionsFromQuestion(questionText);
        const normStem = this._normalizeOption(stem).replace(/\s+/g, ' ').trim();
        const normOpts = (options || []).map(o => this._normalizeOption(o).replace(/\s+/g, ' ').trim()).sort();
        return `${normStem}||${normOpts.join('|')}`;
    },

    async _canonicalHash(questionText) {
        const canonical = this._canonicalizeQuestion(questionText);
        // Use SubtleCrypto if available, else simple hash
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            try {
                const encoder = new TextEncoder();
                const data = encoder.encode(canonical);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            } catch {
                // fallback
            }
        }
        // Simple FNV-1a fallback
        let hash = 2166136261;
        for (let i = 0; i < canonical.length; i++) {
            hash ^= canonical.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16);
    },

    _getHostHintFromLink(link) {
        try {
            const u = new URL(link);
            const host = u.hostname.replace(/^www\./, '').toLowerCase();
            if (host === 'webcache.googleusercontent.com') {
                const q = u.searchParams.get('q') || '';
                const m = q.match(/cache:(.+)$/i);
                if (m) {
                    const decoded = decodeURIComponent(m[1]);
                    const inner = new URL(decoded);
                    return inner.hostname.replace(/^www\./, '').toLowerCase();
                }
            }
            return host;
        } catch {
            return '';
        }
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â POLARITY DETECTION Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    _detectQuestionPolarity(questionText) {
        if (!questionText) return 'CORRECT';
        const stemOnly = this._extractQuestionStem(questionText);
        const text = stemOnly.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const incorrectPatterns = [
            /alternativa\s+incorreta/i,
            /afirmativa\s+incorreta/i,
            /opcao\s+incorreta/i,
            /alternativa\s+errada/i,
            /alternativa\s+falsa/i,
            /nao\s+(?:e|esta)\s+corret[ao]/i,
            /assinale\s+a\s+incorreta/i,
            /marque\s+a\s+incorreta/i,
            /assinale\s+a\s+errada/i,
            /assinale\s+a\s+falsa/i,
            /\bexceto\b/i
        ];
        for (const re of incorrectPatterns) {
            if (re.test(text)) return 'INCORRECT';
        }
        return 'CORRECT';
    },

    _isMatchCompatibleWithPolarity(matchLabel, polarity) {
        if (!matchLabel || polarity === 'CORRECT') return true;
        // Gabarito always refers to the answer to mark, regardless of polarity
        return true;
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â FINGERPRINT-BASED QUESTION BLOCK FINDING Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    _findQuestionBlockByFingerprint(sourceText, questionText) {
        if (!sourceText || !questionText) return null;
        const stem = this._extractQuestionStem(questionText);
        const tokens = this._extractKeyTokens(stem);
        if (tokens.length < 3) return null;

        const lines = sourceText.split('\n');
        let bestStart = -1;
        let bestHits = 0;
        const windowSize = 15;
        for (let i = 0; i < lines.length - 3; i++) {
            const windowText = lines.slice(i, Math.min(lines.length, i + windowSize)).join('\n');
            const hits = this._countTokenHits(windowText, tokens);
            if (hits > bestHits) {
                bestHits = hits;
                bestStart = i;
            }
        }
        const threshold = Math.max(3, Math.floor(tokens.length * 0.5));
        if (bestStart < 0 || bestHits < threshold) return null;
        const blockStart = Math.max(0, bestStart - 2);
        const blockEnd = Math.min(lines.length, bestStart + 40);
        return lines.slice(blockStart, blockEnd).join('\n');
    },

    _findQuestionBlock(sourceText, questionText) {
        if (!sourceText || !questionText) return null;
        // Attempt 1: by question number
        const qNumMatch = (questionText || '').match(/^\s*(\d{1,3})\s*[\)\.\:\-]/);
        if (qNumMatch) {
            const qNum = qNumMatch[1];
            const patterns = [
                new RegExp(`(?:^|\\n)\\s*${qNum}\\s*[\\)\\.\\:\\-]`, 'm'),
                new RegExp(`(?:^|\\n)\\s*(?:Quest[aÃƒÂ£]o|Questao)\\s+${qNum}\\b`, 'im')
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
        // Attempt 2: fingerprint
        const fpBlock = this._findQuestionBlockByFingerprint(sourceText, questionText);
        if (fpBlock) {
            return { text: fpBlock, method: 'fingerprint' };
        }
        return null;
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â RANKED CANDIDATE SELECTION Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    _chooseBestCandidate(candidates) {
        if (!candidates || candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];
        const patternPriority = {
            'gab-explicito': 1.0, 'gab-letra': 0.9, 'resposta-correta': 0.85,
            'gab-abrev': 0.8, 'gab-inline': 0.7, 'ai': 0.5
        };
        const scored = candidates.map(c => ({
            ...c,
            score: (c.confidence || 0.5) * (patternPriority[c.matchLabel] || 0.6)
        }));
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const second = scored[1];
        if (second && second.letter !== best.letter && (best.score - second.score) < 0.15) {
            console.log(`SearchService: Conflito entre candidatos: ${best.letter}(${best.score.toFixed(2)}) vs ${second.letter}(${second.score.toFixed(2)})`);
            return null;
        }
        return best;
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â ENHANCED EXPLICIT GABARITO EXTRACTION (polarity-aware) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    _extractExplicitGabarito(text, questionText = '') {
        if (!text) return null;
        const questionPolarity = this._detectQuestionPolarity(questionText);
        const patterns = [
            { re: /(?:^|\b)(?:gabarito|resposta\s+correta|alternativa\s+correta|item\s+correto)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi, label: 'gab-explicito', confidence: 0.95 },
            { re: /(?:^|\b)(?:a\s+resposta\s+correta\s+[e\u00e9]|a\s+alternativa\s+correta\s+[e\u00e9])\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/gi, label: 'resposta-correta', confidence: 0.92 },
            { re: /(?:^|\b)(?:letra|alternativa)\s+([A-E])\s*(?:[e\u00e9]\s+(?:a\s+)?(?:correta|certa|resposta))/gi, label: 'gab-letra', confidence: 0.9 },
            { re: /(?:^|\b)gab(?:arito)?\.?\s*[:\-]?\s*([A-E])\b/gi, label: 'gab-abrev', confidence: 0.88 }
        ];
        const matches = [];
        for (const { re, label, confidence } of patterns) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
                const letter = (m[1] || '').toUpperCase();
                if (!letter) continue;
                const compatible = this._isMatchCompatibleWithPolarity(label, questionPolarity);
                if (!compatible) continue;
                matches.push({ letter, confidence, matchLabel: label, index: m.index, compatible, questionPolarity });
            }
        }
        if (matches.length === 0) return null;
        return this._chooseBestCandidate(matches);
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â LOCAL ANSWER EXTRACTION Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    _extractAnswerLocally(sourceText, questionText, originalOptions) {
        if (!sourceText || sourceText.length < 50) return null;
        const block = this._findQuestionBlock(sourceText, questionText);
        const searchText = block ? block.text : sourceText;
        const gabarito = this._extractExplicitGabarito(searchText, questionText);
        if (gabarito) {
            return { ...gabarito, evidenceType: 'explicit-gabarito', blockMethod: block?.method || 'full-text' };
        }
        return null;
    },

    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â MATCH QUALITY COMPUTATION Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    computeMatchQuality(sourceText, questionText, originalOptions, originalOptionsMap) {
        let quality = 0;
        const block = this._findQuestionBlock(sourceText, questionText);
        if (block) quality += block.method === 'fingerprint' ? 3 : 2;
        if (originalOptions && originalOptions.length >= 2) {
            const sourceOptions = [];
            const optRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/gim;
            let om;
            while ((om = optRe.exec(sourceText)) !== null) {
                sourceOptions.push(`${om[1].toUpperCase()}) ${om[2].trim()}`);
            }
            if (this._optionsMatch(originalOptions, sourceOptions)) quality += 2;
        }
        const gabarito = this._extractExplicitGabarito(sourceText, questionText);
        if (gabarito) quality += 3;
        return Math.min(quality, 10);
    },

    _extractExplicitLetterFromText(text, questionStem, originalOptions) {
        if (!text) return null;
        const polarity = this._detectQuestionPolarity(questionStem);
        const tokens = this._extractKeyTokens(questionStem);

        // Prefer explicit patterns; support "opcao falsa/incorreta" when the question asks for the false option.
        const patterns = [];
        patterns.push(
            /(?:^|\b)(?:gabarito|resposta\s+correta|alternativa\s+correta|item\s+correto)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/i,
            /(?:^|\b)(?:a\s+resposta\s+correta\s+e|a\s+alternativa\s+correta\s+e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i
        );

        if (polarity === 'INCORRECT' || polarity === 'UNKNOWN') {
            patterns.push(
                /(?:^|\b)(?:op[cÃƒÂ§][aÃƒÂ£]o|alternativa)\s+(?:falsa|incorreta|errada)\s*(?:ÃƒÂ©|e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i,
                /(?:^|\b)(?:a\s+)?(?:op[cÃƒÂ§][aÃƒÂ£]o|alternativa)\s+([A-E])\s*(?:ÃƒÂ©|e)\s*(?:a\s+)?(?:falsa|incorreta|errada)\b/i,
                /(?:^|\b)(?:a\s+)?(?:op[cÃƒÂ§][aÃƒÂ£]o|alternativa)\s+(?:falsa|incorreta|errada)\s*[:\-]?\s*([A-E])\b/i,
                // Common SERP phrasing: "A opÃƒÂ§ÃƒÂ£o falsa ÃƒÂ© a e) ..."
                /(?:^|\b)(?:a\s+)?(?:op[cÃƒÂ§][aÃƒÂ£]o|alternativa)\s+(?:falsa|incorreta|errada)\s*(?:ÃƒÂ©|e)\s*(?:a\s+)?([A-E])\s*[\)\.\-:]/i
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

            if (tokens.length > 0 && this._countTokenHits(window, tokens) < Math.min(2, tokens.length)) {
                continue;
            }

            if (originalOptions && originalOptions.length >= 2) {
                if (this._optionsMatchInFreeText(originalOptions, window)) {
                    // ok
                } else {
                    // The original code used optionAnchors here, which is no longer passed.
                    // For now, we'll skip this check if optionAnchors is not available.
                    // If optionAnchors is needed, it should be passed as a parameter.
                    // const anchorHits = this._countTokenHits(window, optionAnchors || []);
                    // if (anchorHits < 2) continue;
                }
            }

            return { letter, confidence: 0.9, evidence: window };
        }

        return null;
    },

    _parseHtmlDomWithEmbeddedFallback(html) {
        if (!html || html.length < 200) return { doc: null, nodes: [] };
        const sanitizeHtmlForParsing = (input) => String(input || '')
            // Avoid CSP noise and risky parsing side-effects from third-party active content.
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
            .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
            .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, ' ')
            .replace(/<embed\b[^>]*>/gi, ' ')
            .replace(/<link\b[^>]*>/gi, ' ');

        let doc = null;
        let nodes = [];
        const safeHtml = sanitizeHtmlForParsing(html);
        try {
            doc = new DOMParser().parseFromString(safeHtml, 'text/html');
            nodes = Array.from(doc.querySelectorAll('div.t'));
        } catch {
            return { doc: null, nodes: [] };
        }

        // Some pages embed PDF-like html as escaped JSON (\u003cdiv ...).
        if (nodes.length < 50 && safeHtml.includes('\\u003cdiv')) {
            const idx = safeHtml.indexOf('\\u003cdiv');
            const slice = safeHtml.slice(idx, Math.min(safeHtml.length, idx + 650000));
            const decoded = slice
                .replace(/\\u003c/gi, '<')
                .replace(/\\u003e/gi, '>')
                .replace(/\\u0026/gi, '&')
                .replace(/\\\"/g, '"')
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t');
            try {
                const parsed = new DOMParser().parseFromString(sanitizeHtmlForParsing(decoded), 'text/html');
                const parsedNodes = Array.from(parsed.querySelectorAll('div.t'));
                if (parsedNodes.length > nodes.length) {
                    doc = parsed;
                    nodes = parsedNodes;
                }
            } catch (_) {
                // no-op
            }
        }
        return { doc, nodes };
    },

    _extractDocText(doc) {
        if (!doc || !doc.body) return '';
        try {
            const clone = doc.body.cloneNode(true);
            clone.querySelectorAll('script, style, noscript, .blank').forEach((n) => n.remove());
            return (clone.textContent || '').replace(/\s+/g, ' ').trim();
        } catch {
            return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
        }
    },

    _detectStructuredHtmlType(html, doc = null) {
        const h = String(html || '').toLowerCase();
        if (!h) return 'TYPE_UNKNOWN';
        if ((h.includes('id="pf1"') || h.includes('class="pf') || h.includes('class="pc')) && h.includes('class="t')) {
            return 'TYPE_PD_PDF_HTML';
        }
        if (h.includes('answercard_') || h.includes('ql-editor') || h.includes('answer-content-container')) {
            return 'TYPE_PD_ANSWERCARD';
        }
        if (/resposta\s+correta|gabarito|alternativa\s+correta/i.test(h)) {
            return 'TYPE_GENERIC_QA';
        }
        if (doc && doc.querySelector('.ql-editor')) return 'TYPE_PD_ANSWERCARD';
        return 'TYPE_UNKNOWN';
    },

    _obfuscationSignals(text) {
        const raw = String(text || '');
        const normalized = this._normalizeOption(raw);
        if (normalized.length < 120) {
            return {
                isObfuscated: false,
                normalizedLength: normalized.length,
                vowelRatio: 0,
                junkRatio: 0,
                longConsonantRuns: 0,
                relevantWordCount: 0
            };
        }

        const words = normalized.split(/\s+/).filter(Boolean);
        if (words.length < 20) {
            return {
                isObfuscated: false,
                normalizedLength: normalized.length,
                vowelRatio: 0,
                junkRatio: 0,
                longConsonantRuns: 0,
                relevantWordCount: 0
            };
        }

        const letters = (normalized.match(/[a-z]/g) || []).length || 1;
        const vowels = (normalized.match(/[aeiou]/g) || []).length;
        const vowelRatio = vowels / letters;

        const relevantWords = words.filter(w => w.length >= 4);
        let noVowelWords = 0;
        let longConsonantRuns = 0;
        for (const w of relevantWords) {
            if (!/[aeiou]/.test(w)) noVowelWords += 1;
            if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(w)) longConsonantRuns += 1;
        }

        const junkRatio = noVowelWords / Math.max(1, relevantWords.length);
        const isObfuscated = (vowelRatio < 0.24 && junkRatio >= 0.28) || longConsonantRuns >= 4;
        return {
            isObfuscated,
            normalizedLength: normalized.length,
            vowelRatio,
            junkRatio,
            longConsonantRuns,
            relevantWordCount: relevantWords.length
        };
    },

    _isLikelyObfuscatedText(text) {
        return this._obfuscationSignals(text).isObfuscated;
    },

    _logSourceDiagnostic(diag) {
        if (!diag) return;
        const host = diag.hostHint || 'unknown';
        const type = diag.type || 'TYPE_UNKNOWN';
        const phase = diag.phase || 'info';
        const sim = Number.isFinite(diag.topicSim) ? diag.topicSim.toFixed(2) : 'n/a';
        const opts = diag.optionsMatch === undefined ? 'n/a' : (diag.optionsMatch ? 'ok' : 'mismatch');
        const obf = diag.obfuscation?.isObfuscated
            ? `yes(vr=${(diag.obfuscation.vowelRatio || 0).toFixed(2)},jr=${(diag.obfuscation.junkRatio || 0).toFixed(2)})`
            : 'no';
        const reason = diag.reason ? ` reason=${diag.reason}` : '';
        const decision = diag.decision ? ` decision=${diag.decision}` : '';
        const method = diag.method ? ` method=${diag.method}` : '';
        const letter = diag.letter ? ` letter=${diag.letter}` : '';
        const textLen = Number.isFinite(diag.textLength) ? ` text=${diag.textLength}` : '';
        console.log(`SearchService: SourceDiag[${phase}] host=${host} type=${type} sim=${sim} opts=${opts} obf=${obf}${textLen}${decision}${method}${letter}${reason}`);
    },

    _extractPdfLikeAnswerByAnchors(html, questionForInference, questionStem, originalOptionsMap, originalOptions) {
        const { doc, nodes } = this._parseHtmlDomWithEmbeddedFallback(html);
        if (!doc || nodes.length < 20) return null;

        const frags = nodes
            .map((n) => {
                const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
                if (!text) return null;
                return { text, cls: (n.getAttribute('class') || '').toLowerCase() };
            })
            .filter(Boolean);
        if (frags.length < 20) return null;

        const startQuestionRe = /^(?:\)?\s*)?\d{1,3}\s*[\)\.\-:]\s*/;
        const starts = [];
        for (let i = 0; i < frags.length; i += 1) {
            if (startQuestionRe.test(frags[i].text)) starts.push(i);
        }

        const blocks = [];
        if (starts.length === 0) {
            blocks.push({ start: 0, end: frags.length - 1 });
        } else {
            for (let i = 0; i < starts.length; i += 1) {
                const start = starts[i];
                const end = (i < starts.length - 1 ? starts[i + 1] - 1 : frags.length - 1);
                if (end - start >= 4) blocks.push({ start, end });
            }
        }
        if (blocks.length === 0) return null;

        let bestBlock = null;
        let bestBlockScore = 0;
        for (const b of blocks) {
            const text = frags.slice(b.start, b.end + 1).map(x => x.text).join(' ');
            const sim = this._questionSimilarityScore(text, questionStem);
            if (sim > bestBlockScore) {
                bestBlockScore = sim;
                bestBlock = { ...b, text };
            }
        }
        if (!bestBlock || bestBlockScore < 0.12) return null;

        const blockFrags = frags.slice(bestBlock.start, bestBlock.end + 1);
        const blockText = blockFrags.map(f => f.text).join('\n');

        const explicitInBlock = this._extractExplicitGabarito(blockText, questionForInference);
        if (explicitInBlock?.letter) {
            return {
                letter: explicitInBlock.letter,
                confidence: 0.94,
                method: 'pdf-anchor-gabarito',
                evidence: blockText.slice(0, 900),
                matchQuality: bestBlockScore
            };
        }

        const anchorRe = /(resposta\s+correta|gabarito|alternativa\s+correta|resposta\s*:\s*letra)/i;
        const stopRe = /(coment[aÃƒÂ¡]rio|resolu[cÃƒÂ§][aÃƒÂ£]o|explica[cÃƒÂ§][aÃƒÂ£]o|pergunta\s+\d+|quest[aÃƒÂ£]o\s+\d+)/i;
        let anchorIdx = -1;
        for (let i = 0; i < blockFrags.length; i += 1) {
            if (anchorRe.test(blockFrags[i].text)) {
                anchorIdx = i;
                break;
            }
        }
        if (anchorIdx < 0) return null;

        const evidenceParts = [];
        for (let i = anchorIdx; i < Math.min(blockFrags.length, anchorIdx + 30); i += 1) {
            const line = blockFrags[i].text;
            if (i > anchorIdx + 1 && startQuestionRe.test(line)) break;
            if (i > anchorIdx + 1 && stopRe.test(line)) break;
            evidenceParts.push(line);
        }
        const evidenceText = evidenceParts.join(' ').trim();
        if (!evidenceText || evidenceText.length < 20) return null;

        const explicit = this._extractExplicitGabarito(evidenceText, questionForInference)
            || this._extractExplicitLetterFromText(evidenceText, questionStem, originalOptions);
        if (explicit?.letter) {
            return {
                letter: explicit.letter,
                confidence: 0.93,
                method: 'pdf-anchor-gabarito',
                evidence: evidenceText.slice(0, 900),
                matchQuality: bestBlockScore
            };
        }

        const candidateByText = this._findLetterByAnswerText(evidenceText, originalOptionsMap);
        if (!candidateByText) return null;
        return {
            letter: candidateByText,
            confidence: 0.86,
            method: 'pdf-anchor-text-match',
            evidence: evidenceText.slice(0, 900),
            matchQuality: bestBlockScore
        };
    },

    _extractAnswerCardEvidenceFromHtml(html, questionForInference, questionStem, originalOptionsMap, originalOptions) {
        const { doc } = this._parseHtmlDomWithEmbeddedFallback(html);
        if (!doc) return null;

        const containers = Array.from(doc.querySelectorAll(
            '.ql-editor, [class*="AnswerCard_answer-content"], [class*="answer-content-container"], [data-testid*="answer"]'
        ));
        if (containers.length === 0) return null;

        const candidates = [];
        for (const c of containers.slice(0, 18)) {
            const text = (c.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text || text.length < 40) continue;
            if (this._isLikelyObfuscatedText(text)) continue;

            const sim = this._questionSimilarityScore(text, questionStem);
            const explicit = this._extractExplicitGabarito(text, questionForInference)
                || this._extractExplicitLetterFromText(text, questionStem, originalOptions);

            let letter = explicit?.letter || null;
            if (!letter) letter = this._findLetterByAnswerText(text, originalOptionsMap);
            if (!letter) continue;

            const confidence = explicit?.letter ? 0.9 : 0.82;
            const score = confidence + (sim * 0.6);
            candidates.push({
                letter,
                confidence,
                method: 'answercard-ql',
                evidence: text.slice(0, 900),
                matchQuality: sim,
                _score: score
            });
        }

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b._score - a._score);
        return candidates[0];
    },

    _extractGenericAnchoredEvidenceFromHtml(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions) {
        const { doc } = this._parseHtmlDomWithEmbeddedFallback(html);
        if (!doc) return null;
        const fullText = this._extractDocText(doc);
        if (!fullText || fullText.length < 120) return null;
        if (this._isLikelyObfuscatedText(fullText)) return null;

        const noisyContextRe = /(resposta\s+gerada\s+por\s+ia|desbloqueie|premium|ajude\s+estudantes|conte[ÃƒÂºu]dos\s+liberados|respostas?\s+dispon[ÃƒÂ­i]veis\s+nesse\s+material)/i;
        const strongAnchorRe = /(gabarito|resposta\s+correta|resposta\s*:\s*(?:letra\s*)?[A-E]|a\s+resposta\s+[eÃƒÂ©]|alternativa\s+correta\s*(?:[eÃƒÂ©]|[:\-]))/i;
        const anchorRe = /(gabarito|resposta\s+correta|alternativa\s+correta|resposta\s*:\s*letra|a\s+resposta\s+[eÃƒÂ©])/ig;
        const directiveRe = /(assinale|marque|selecione|indique)\s+(?:a\s+)?(?:alternativa|afirmativa|op[cÃƒÂ§][aÃƒÂ£]o)\s+(?:correta|incorreta|falsa|errada)/i;
        const riskyHost = hostHint === 'passeidireto.com' || hostHint === 'brainly.com.br' || hostHint === 'brainly.com';
        const candidates = [];
        let m;
        let guard = 0;
        while ((m = anchorRe.exec(fullText)) !== null && guard < 8) {
            guard += 1;
            const idx = m.index || 0;
            const anchorLabel = (m[1] || '').toLowerCase();
            const nearPrefix = fullText.slice(Math.max(0, idx - 140), Math.min(fullText.length, idx + 60));
            if (/alternativa\s+correta/.test(anchorLabel) && directiveRe.test(nearPrefix)) continue;

            const start = Math.max(0, idx - 230);
            const end = Math.min(fullText.length, idx + 760);
            const ctx = fullText.slice(start, end);
            if (!ctx || ctx.length < 40) continue;
            if (noisyContextRe.test(ctx)) continue;
            const hasStrongAnchorSignal = strongAnchorRe.test(ctx);
            if (!hasStrongAnchorSignal) continue;
            if (directiveRe.test(ctx) && !/(gabarito|resposta\s+correta|a\s+resposta\s+[eÃƒÂ©]|resposta\s*:)/i.test(ctx)) continue;

            const sim = this._questionSimilarityScore(ctx, questionStem);
            if (sim < (riskyHost ? 0.22 : 0.16)) continue;

            const coverage = originalOptions && originalOptions.length >= 2
                ? this._optionsCoverageInFreeText(originalOptions, ctx)
                : { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
            const optionsMatch = !coverage.hasEnoughOptions
                || coverage.ratio >= 0.6
                || coverage.hits >= Math.min(3, coverage.total || 3);
            const optionsStrong = !coverage.hasEnoughOptions
                || coverage.ratio >= 0.8
                || coverage.hits >= Math.min(4, coverage.total || 4);
            const explicit = this._extractExplicitGabarito(ctx, questionForInference)
                || this._extractExplicitLetterFromText(ctx, questionStem, originalOptions);
            let letter = explicit?.letter || null;
            if (!letter) letter = this._findLetterByAnswerText(ctx, originalOptionsMap);
            if (!letter) continue;

            if (!optionsMatch) {
                if (!explicit?.letter) continue;
                if (sim < (riskyHost ? 0.52 : 0.42)) continue;
            }
            if (riskyHost && !optionsStrong) {
                if (!explicit?.letter) continue;
                if (sim < 0.6) continue;
            }

            const confidence = explicit?.letter ? 0.9 : 0.8;
            const score = confidence + (sim * 0.55);
            candidates.push({
                letter,
                confidence,
                method: 'generic-anchor',
                evidence: ctx.slice(0, 900),
                matchQuality: sim,
                optionsMatch,
                optionsStrong,
                explicitLetter: !!explicit?.letter,
                hasStrongAnchorSignal,
                _score: score
            });
        }

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b._score - a._score);
        const best = candidates[0];
        if (!best.hasStrongAnchorSignal) return null;
        if ((best.matchQuality || 0) < (riskyHost ? 0.46 : 0.34) && !best.optionsMatch) return null;
        if (riskyHost && !best.optionsStrong) {
            if (!best.explicitLetter || (best.matchQuality || 0) < 0.6) return null;
        }
        if ((best.matchQuality || 0) < 0.08 && best.confidence < 0.88) return null;
        return best;
    },

    _extractStructuredEvidenceFromHtml(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, diagnosticsCtx = null) {
        if (!html || html.length < 500) return null;

        const parsed = diagnosticsCtx?.parsed || this._parseHtmlDomWithEmbeddedFallback(html);
        const type = diagnosticsCtx?.type || this._detectStructuredHtmlType(html, parsed.doc);

        // Ignore heavily obfuscated pages unless we still found explicit anchors later.
        const docText = this._extractDocText(parsed.doc);
        const obfuscation = diagnosticsCtx?.obfuscation || this._obfuscationSignals(docText);
        const maybeObfuscated = !!obfuscation?.isObfuscated;

        if (type === 'TYPE_PD_PDF_HTML' || hostHint === 'passeidireto.com' || hostHint === 'studocu.com') {
            const byAnchor = this._extractPdfLikeAnswerByAnchors(html, questionForInference, questionStem, originalOptionsMap, originalOptions);
            if (byAnchor?.letter) {
                return {
                    ...byAnchor,
                    evidenceType: `${hostHint || 'pdf'}-${byAnchor.method || 'pdf-anchor'}-scoped`,
                    diagnostics: { type, obfuscation }
                };
            }
        }

        if (type === 'TYPE_PD_ANSWERCARD') {
            const byAnswerCard = this._extractAnswerCardEvidenceFromHtml(html, questionForInference, questionStem, originalOptionsMap, originalOptions);
            if (byAnswerCard?.letter) {
                return {
                    ...byAnswerCard,
                    evidenceType: `${hostHint || 'page'}-${byAnswerCard.method || 'answercard'}-scoped`,
                    diagnostics: { type, obfuscation }
                };
            }
        }

        const byGeneric = this._extractGenericAnchoredEvidenceFromHtml(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions);
        if (byGeneric?.letter) {
            return {
                ...byGeneric,
                evidenceType: `${hostHint || 'page'}-${byGeneric.method || 'generic-anchor'}-scoped`,
                diagnostics: { type, obfuscation }
            };
        }

        if (maybeObfuscated) {
            return { skip: true, reason: 'obfuscated_html', diagnostics: { type, obfuscation } };
        }
        return { diagnostics: { type, obfuscation } };
    },

    _extractPdfLikeHighlightLetterFromHtml(html, questionStem, originalOptionsMap, originalOptions) {
        if (!html || html.length < 2000) return null;
        const tokens = this._extractKeyTokens(questionStem);

        const { nodes } = this._parseHtmlDomWithEmbeddedFallback(html);

        if (nodes.length < 50) return null;

        const frags = nodes
            .map((n) => ({
                text: (n.textContent || '').replace(/\s+/g, ' ').trim(),
                cls: (n.getAttribute('class') || '').toLowerCase(),
                style: (n.getAttribute('style') || '').toLowerCase(),
                inner: (n.innerHTML || '').toLowerCase()
            }))
            .filter(f => f.text && f.text.length >= 1);

        if (frags.length < 50) return null;

        // Find the best anchor position for the question block.
        // Use a small rolling window because PDF-like exports often split words across many fragments.
        let bestIdx = -1;
        let bestHits = 0;
        for (let i = 0; i < frags.length; i += 1) {
            const windowTextForAnchor = frags
                .slice(i, Math.min(frags.length, i + 5))
                .map(f => f.text)
                .join(' ');
            const hits = this._countTokenHits(windowTextForAnchor, tokens);
            if (hits > bestHits) {
                bestHits = hits;
                bestIdx = i;
            }
        }

        const minAnchorHits = tokens.length >= 4 ? 2 : 1;
        if (bestIdx < 0 || bestHits < minAnchorHits) return null;

        const windowStart = Math.max(0, bestIdx - 80);
        const windowFrags = frags.slice(windowStart, Math.min(frags.length, bestIdx + 520));
        const windowText = windowFrags.map(f => f.text).join('\n');

        // Options evidence gate: require at least 2 option bodies present in this window.
        const optBodies = Object.values(originalOptionsMap || {}).map(v => this._normalizeOption(v)).filter(v => v.length >= 8);
        let optionHits = 0;
        const normWindow = this._normalizeOption(windowText);
        for (const body of optBodies) {
            if (body && normWindow.includes(body)) optionHits += 1;
        }

        const parseAlternativeStart = (rawText) => {
            const t = (rawText || '').trim();
            if (!t) return null;
            let m = t.match(/^([A-E])\s*[\)\.\-:]\s*/i);
            if (m) return m[1].toUpperCase();
            m = t.match(/^\)\s*([A-E])\b/i); // e.g. ")c texto..."
            if (m) return m[1].toUpperCase();
            m = t.match(/^\(\s*([A-E])\s*\)/i); // e.g. "(c) texto..."
            if (m) return m[1].toUpperCase();
            return null;
        };

        const groups = {};
        let current = null;

        const isNextQuestionMarker = (t) => {
            const s = (t || '').trim();
            return /^(?:\)?\s*)?\d{1,3}\s*[\)\.\-:]\s*/.test(s) || /^aula\s+\d+/i.test(s);
        };

        for (const f of windowFrags) {
            const t = f.text;
            const letter = parseAlternativeStart(t);
            if (letter) {
                current = letter;
                if (!groups[current]) groups[current] = [];
                groups[current].push(f);
                continue;
            }

            if (current) {
                // stop if we already collected some options and then hit a new question marker
                if (Object.keys(groups).length >= 2 && isNextQuestionMarker(t)) break;
                groups[current].push(f);
            }
        }

        const letters = Object.keys(groups);
        if (letters.length < 2) return null;
        if (originalOptions && originalOptions.length >= 2 && optionHits < 1 && letters.length < 4) return null;

        const featuresByLetter = {};
        const tokenOwners = new Map();

        for (const letter of letters) {
            const parts = groups[letter];
            let ff1Hits = 0;
            let blurHits = 0;
            let clearHits = 0;
            const classTokenCounts = new Map();

            for (const p of parts) {
                // "ff1" is a known highlight in PDF-like HTML exports.
                if (/\bff1\b/.test(p.cls) || /\bff1\b/.test(p.inner)) ff1Hits += 1;

                const isBlurred = /\bfb\b/.test(p.cls) || /blur\(/.test(p.style);
                if (isBlurred) blurHits += 1;
                else clearHits += 1;

                const clsTokens = String(p.cls || '')
                    .split(/\s+/)
                    .map(x => x.trim().toLowerCase())
                    .filter(Boolean);
                const nestedClassTokens = [];
                const classAttrRe = /class\s*=\s*["']([^"']+)["']/gi;
                let cm;
                while ((cm = classAttrRe.exec(String(p.inner || ''))) !== null) {
                    const sub = (cm[1] || '')
                        .split(/\s+/)
                        .map(x => x.trim().toLowerCase())
                        .filter(Boolean);
                    nestedClassTokens.push(...sub);
                }
                const allTokens = [...clsTokens, ...nestedClassTokens];
                for (const token of allTokens) {
                    if (!/^(ff|fs|fc|sc)\d+$/i.test(token)) continue;
                    classTokenCounts.set(token, (classTokenCounts.get(token) || 0) + 1);
                }
            }

            featuresByLetter[letter] = {
                ff1Hits,
                blurHits,
                clearHits,
                fragCount: parts.length,
                classTokenCounts
            };

            for (const token of classTokenCounts.keys()) {
                if (!tokenOwners.has(token)) tokenOwners.set(token, new Set());
                tokenOwners.get(token).add(letter);
            }
        }

        // Strategy 1: classic ff1 highlight signal.
        let bestLetter = null;
        let bestScore = -1;
        let secondScore = -1;
        for (const [letter, feat] of Object.entries(featuresByLetter)) {
            const score = feat.ff1Hits;
            if (score > bestScore) {
                secondScore = bestScore;
                bestScore = score;
                bestLetter = letter;
            } else if (score > secondScore) {
                secondScore = score;
            }
        }

        if (bestLetter && bestScore >= 1 && bestScore > secondScore) {
            return {
                letter: bestLetter,
                confidence: 0.95,
                method: 'ff1-highlight',
                evidence: `ff1_hits=${bestScore} window_tokens=${bestHits} option_hits=${optionHits}`
            };
        }

        // Strategy 2: CSS signature outlier between alternatives (encrypted/blurred pages).
        const signatureScores = {};
        for (const letter of letters) {
            const feat = featuresByLetter[letter];
            let uniqueTokenScore = 0;
            for (const [token, count] of feat.classTokenCounts.entries()) {
                const owners = tokenOwners.get(token);
                if (!owners || owners.size !== 1) continue;
                const base = token.startsWith('ff') ? 1.3 : 0.8;
                uniqueTokenScore += base * Math.min(2, count);
            }

            let score = uniqueTokenScore;
            if (feat.clearHits >= 2 && feat.blurHits === 0) score += 0.8;
            if (feat.blurHits >= Math.max(3, Math.floor(feat.fragCount * 0.8))) score -= 0.5;
            signatureScores[letter] = score;
        }

        let sigBestLetter = null;
        let sigBestScore = -999;
        let sigSecondScore = -999;
        for (const [letter, score] of Object.entries(signatureScores)) {
            if (score > sigBestScore) {
                sigSecondScore = sigBestScore;
                sigBestScore = score;
                sigBestLetter = letter;
            } else if (score > sigSecondScore) {
                sigSecondScore = score;
            }
        }

        if (!sigBestLetter) return null;

        const sigMargin = sigBestScore - sigSecondScore;
        const sigFeat = featuresByLetter[sigBestLetter];
        const hasReasonableSupport = sigFeat && sigFeat.fragCount >= 2;
        const strongOutlier = sigBestScore >= 2.2 && sigMargin >= 0.9;
        const permissiveOutlier = sigBestScore >= 2.8 && sigMargin >= 0.5 && optionHits >= 1;

        if (!hasReasonableSupport || (!strongOutlier && !permissiveOutlier)) return null;

        return {
            letter: sigBestLetter,
            confidence: Math.max(0.82, Math.min(0.9, 0.82 + (sigMargin * 0.06))),
            method: 'css-signature',
            evidence: `sig_score=${sigBestScore.toFixed(2)} margin=${sigMargin.toFixed(2)} option_hits=${optionHits} window_tokens=${bestHits}`
        };
    },

    _computeVotesAndState(sources) {
        const votes = {};
        for (const s of sources) {
            if (!s.letter) continue;
            votes[s.letter] = (votes[s.letter] || 0) + (s.weight || 1);
        }

        const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
        const best = sorted[0] || null;
        const second = sorted[1] || null;

        const bestLetter = best ? best[0] : null;
        const bestScore = best ? best[1] : 0;
        const secondScore = second ? second[1] : 0;
        const total = sorted.reduce((acc, [, v]) => acc + v, 0) || 1;
        const margin = bestScore - secondScore;

        const getHost = (link) => {
            try {
                return new URL(link).hostname.replace(/^www\./, '').toLowerCase();
            } catch {
                return '';
            }
        };

        const isWeakHost = (host) => {
            const h = String(host || '').toLowerCase();
            return h === 'brainly.com.br' || h === 'brainly.com' || h === 'studocu.com';
        };

        const isStrongSource = (src) => {
            const host = src.hostHint || getHost(src.link);
            const evidenceType = String(src.evidenceType || '').toLowerCase();
            if (/\.(pdf)(\?|$)/i.test(String(src.link || ''))) return true;
            if (host.endsWith('.gov.br') || host.endsWith('.edu.br')) return true;
            if (host === 'qconcursos.com' || host === 'qconcursos.com.br') return true;
            if (evidenceType.includes('ff1-highlight') || evidenceType.includes('css-signature')) return true;
            if (evidenceType.includes('pdf-anchor') || evidenceType.includes('answercard')) return true;
            return false;
        };

        const nonAiSources = sources.filter(s => s.evidenceType && s.evidenceType !== 'ai' && s.evidenceType !== 'ai-combined');
        const bestNonAi = nonAiSources.filter(s => s.letter === bestLetter);
        const bestDomains = new Set(bestNonAi.map(s => (s.hostHint || getHost(s.link))).filter(Boolean));
        const bestNonWeakDomains = new Set(bestNonAi.filter(s => !isWeakHost(s.hostHint || getHost(s.link))).map(s => (s.hostHint || getHost(s.link))).filter(Boolean));
        const bestStrongDomains = new Set(bestNonAi.filter(isStrongSource).map(s => (s.hostHint || getHost(s.link))).filter(Boolean));

        let resultState = 'inconclusive';
        let reason = 'inconclusive';

        // "confirmed" should be hard to reach: require either strong evidence, or multi-domain consensus
        // with at least one non-weak domain. This prevents "Brainly + another weak mirror" from becoming verified.
        if (bestLetter) {
            const hasAnyNonAi = bestNonAi.length > 0;
            const hasStrong = bestStrongDomains.size >= 1;
            const hasMultiDomain = bestDomains.size >= 2;
            const hasNonWeak = bestNonWeakDomains.size >= 1;

            if (hasAnyNonAi && hasStrong && bestScore >= 5.5 && margin >= 1.0) {
                resultState = 'confirmed';
                reason = 'confirmed_by_sources';
            } else if (hasAnyNonAi && hasMultiDomain && hasNonWeak && bestScore >= 5.0 && margin >= 0.9) {
                resultState = 'confirmed';
                reason = 'confirmed_by_sources';
            } else if (second && margin < 1.0 && hasAnyNonAi) {
                resultState = 'conflict';
                reason = 'source_conflict';
            }
        } else if (bestLetter && second && margin < 1.0) {
            resultState = 'conflict';
            reason = 'source_conflict';
        }

        let confidence = Math.max(0.25, Math.min(0.98, bestScore / total));
        if (resultState !== 'confirmed') confidence = Math.min(confidence, 0.79);
        if (resultState === 'confirmed') confidence = Math.max(confidence, 0.85);

        return { votes, bestLetter, resultState, reason, confidence, margin };
    },

    async searchOnly(questionText) {
        return ApiService.searchWithSerper(questionText);
    },

    async answerFromAi(questionText) {
        const aiAnswer = await ApiService.generateAnswerFromQuestion(questionText);
        if (!aiAnswer) return [];
        const answerLetter = this._parseAnswerLetter(aiAnswer);
        const answerText = this._parseAnswerText(aiAnswer);
        return [{
            question: questionText,
            answer: aiAnswer,
            answerLetter,
            answerText,
            aiFallback: true,
            evidenceTier: 'AI_ONLY',
            resultState: 'inconclusive',
            reason: 'inconclusive',
            confidence: 0.45,
            votes: answerLetter ? { [answerLetter]: 1 } : undefined,
            sources: []
        }];
    },

    // Flow 1: process extracted items (Extract button)
    async processExtractedItems(items) {
        const refinedData = [];
        for (const item of items) {
            const refined = await ApiService.refineWithGroq(item);
            if (refined) refinedData.push(refined);
        }
        return refinedData;
    },

    // Flow 2: Google search + evidence-based refine (Search button)
    async refineFromResults(questionText, results, originalQuestionWithOptions = '', onStatus = null, pageGabarito = null) {
        if (!results || results.length === 0) return [];

        const sources = [];
        const topResults = results.slice(0, 12);

        const questionForInference = originalQuestionWithOptions || questionText;
        const questionStem = this._extractQuestionStem(questionForInference);

        const originalOptions = this._extractOptionsFromQuestion(questionForInference);
        const originalOptionsMap = this._buildOptionsMap(questionForInference);
        const hasOptions = originalOptions && originalOptions.length >= 2;

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â Detect question polarity Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const questionPolarity = this._detectQuestionPolarity(questionStem);
        console.log(`SearchService: Polarity detected: ${questionPolarity}`);

        const domainWeights = {
            'qconcursos.com': 2.5,
            'qconcursos.com.br': 2.5,
            'passeidireto.com': 1.4,
            'studocu.com': 1.3,
            'brainly.com.br': 0.9,
            'brainly.com': 0.9
        };

        const getDomainWeight = (link) => {
            try {
                const host = this._getHostHintFromLink(link);
                return domainWeights[host] || 1.0;
            } catch {
                return 1.0;
            }
        };

        const aiEvidence = [];
        const collectedForCombined = [];

        for (const result of topResults) {
            try {
                const snippet = result.snippet || '';
                const title = result.title || '';
                const link = result.link;

                if (typeof onStatus === 'function') {
                    onStatus(`Analyzing source ${sources.length + 1}/${topResults.length}...`);
                }

                const snap = await ApiService.fetchPageSnapshot(link, {
                    timeoutMs: 6500,
                    maxHtmlChars: 1500000,
                    maxTextChars: 12000
                });

                const pageText = (snap?.text || '').trim();
                const combinedText = `${title}. ${snippet}\n\n${pageText}`.trim();

                const hostHint = this._getHostHintFromLink(link);
                const htmlText = snap?.html || '';
                const parsedForDiag = this._parseHtmlDomWithEmbeddedFallback(htmlText);
                const sourceType = this._detectStructuredHtmlType(htmlText, parsedForDiag.doc);
                const docText = this._extractDocText(parsedForDiag.doc);
                const obfuscation = this._obfuscationSignals(docText);
                const topicSimBase = this._questionSimilarityScore(combinedText, questionStem);
                const optionsMatchBase = hasOptions ? this._optionsMatchInFreeText(originalOptions, combinedText) : true;

                this._logSourceDiagnostic({
                    phase: 'start',
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    textLength: combinedText.length
                });

                // 0) Structured extractors by page signature (PDF-like, AnswerCard, anchored gabarito).
                const structured = this._extractStructuredEvidenceFromHtml(
                    htmlText,
                    hostHint,
                    questionForInference,
                    questionStem,
                    originalOptionsMap,
                    originalOptions,
                    { parsed: parsedForDiag, type: sourceType, obfuscation }
                );
                if (structured?.skip) {
                    this._logSourceDiagnostic({
                        phase: 'decision',
                        hostHint,
                        type: sourceType,
                        topicSim: topicSimBase,
                        optionsMatch: optionsMatchBase,
                        obfuscation,
                        decision: 'structured-skip-fallback',
                        reason: structured.reason || 'structured-skip'
                    });
                }
                if (structured?.letter) {
                    const riskyHost = hostHint === 'passeidireto.com' || hostHint === 'brainly.com.br' || hostHint === 'brainly.com';
                    const structuredMethod = structured.method || 'structured-html';
                    const structuredSim = structured.matchQuality || 0;
                    const evidenceScope = `${structured.evidence || ''}\n${combinedText.slice(0, 1800)}`;
                    const structuredCoverage = hasOptions
                        ? this._optionsCoverageInFreeText(originalOptions, evidenceScope)
                        : { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
                    const structuredOptionsMatch = !structuredCoverage.hasEnoughOptions
                        || structuredCoverage.ratio >= 0.6
                        || structuredCoverage.hits >= Math.min(3, structuredCoverage.total || 3);
                    const structuredOptionsStrong = !structuredCoverage.hasEnoughOptions
                        || structuredCoverage.ratio >= 0.8
                        || structuredCoverage.hits >= Math.min(4, structuredCoverage.total || 4);
                    const isGenericAnchor = structuredMethod === 'generic-anchor';
                    if (isGenericAnchor && riskyHost && !structuredOptionsStrong && structuredSim < 0.62) {
                        if (topicSimBase >= 0.2) {
                            collectedForCombined.push({ title, link, text: combinedText.slice(0, 3000), topicSim: topicSimBase });
                        }
                        this._logSourceDiagnostic({
                            phase: 'decision',
                            hostHint,
                            type: sourceType,
                            topicSim: topicSimBase,
                            optionsMatch: structuredOptionsMatch,
                            obfuscation,
                            decision: 'combined-only',
                            method: structuredMethod,
                            reason: 'generic-anchor-options-mismatch'
                        });
                        continue;
                    }
                    const baseWeight = getDomainWeight(link);
                    const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                    const structuredBoost = (structured.confidence || 0.82) >= 0.9 ? 4.4 : 3.7;
                    const weight = baseWeight + structuredBoost + (quality * 0.35);
                    sources.push({
                        title, link,
                        letter: structured.letter,
                        weight,
                        evidenceType: structured.evidenceType || 'structured-html',
                        questionPolarity,
                        matchQuality: Math.max(quality, Math.round((structured.matchQuality || 0) * 10)),
                        extractionMethod: structuredMethod,
                        evidence: structured.evidence || ''
                    });
                    this._logSourceDiagnostic({
                        phase: 'decision',
                        hostHint,
                        type: sourceType,
                        topicSim: topicSimBase,
                        optionsMatch: optionsMatchBase,
                        obfuscation,
                        decision: 'use-structured',
                        method: structuredMethod,
                        letter: structured.letter
                    });
                    const { bestLetter, votes } = this._computeVotesAndState(sources);
                    if (bestLetter && (votes[bestLetter] || 0) >= 6.5) break;
                    continue;
                }

                // Relaxed options gate: keep direct extraction for strong hosts or high topic similarity.
                if (hasOptions && combinedText.length > 500 && !optionsMatchBase) {
                    const topicSim = topicSimBase;
                    const isStrongHost = hostHint === 'qconcursos.com' || hostHint === 'qconcursos.com.br';
                    const isRiskyHost = hostHint === 'passeidireto.com' || hostHint === 'brainly.com.br' || hostHint === 'brainly.com';
                    const allowDirectExtraction = isStrongHost || topicSim >= (isRiskyHost ? 0.48 : 0.35);

                    if (!allowDirectExtraction) {
                        if (topicSim >= 0.2) {
                            collectedForCombined.push({ title, link, text: combinedText.slice(0, 3000), topicSim });
                            console.log(`SearchService: Options mismatch but topic similar (${topicSim.toFixed(2)}), saved for combined: ${link}`);
                            this._logSourceDiagnostic({
                                phase: 'decision',
                                hostHint,
                                type: sourceType,
                                topicSim,
                                optionsMatch: false,
                                obfuscation,
                                decision: 'combined-only',
                                reason: 'options-mismatch-topic-similar'
                            });
                        } else {
                            console.log(`SearchService: Options mismatch, skipping: ${link}`);
                            this._logSourceDiagnostic({
                                phase: 'decision',
                                hostHint,
                                type: sourceType,
                                topicSim,
                                optionsMatch: false,
                                obfuscation,
                                decision: 'skip',
                                reason: 'options-mismatch-low-sim'
                            });
                        }
                        continue;
                    }

                    console.log(`SearchService: Options mismatch (${topicSim.toFixed(2)}), but host/topic trusted; trying direct extraction: ${link}`);
                }

                // 1) PDF-like highlight extraction (PasseiDireto/Studocu), scoped by question.
                let extracted = null;
                if (hostHint === 'passeidireto.com' || hostHint === 'studocu.com') {
                    extracted = this._extractPdfLikeHighlightLetterFromHtml(snap?.html || '', questionStem, originalOptionsMap, originalOptions);
                    if (extracted?.letter) {
                        console.log(`SearchService: PDF signal detected. host=${hostHint} letter=${extracted.letter} method=${extracted.method || 'ff1-highlight'}`);
                        const baseWeight = getDomainWeight(link);
                        const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                        const weight = baseWeight + 4.0 + (quality * 0.3);
                        const method = extracted.method || 'ff1-highlight';
                        const hostPrefix = hostHint === 'passeidireto.com' ? 'passeidireto' : 'studocu';
                        sources.push({
                            title, link,
                            letter: extracted.letter,
                            weight,
                            evidenceType: `${hostPrefix}-${method}-scoped`,
                            questionPolarity, matchQuality: quality
                        });
                        this._logSourceDiagnostic({
                            phase: 'decision',
                            hostHint,
                            type: sourceType,
                            topicSim: topicSimBase,
                            optionsMatch: optionsMatchBase,
                            obfuscation,
                            decision: 'use-pdf-signal',
                            method,
                            letter: extracted.letter
                        });
                        const { bestLetter, votes } = this._computeVotesAndState(sources);
                        if (bestLetter && (votes[bestLetter] || 0) >= 6.5) break;
                        continue;
                    }
                }

                // 2) Enhanced local extraction (uses _findQuestionBlock + _extractExplicitGabarito)
                const localResult = this._extractAnswerLocally(combinedText, questionForInference, originalOptions);
                if (localResult?.letter) {
                    const baseWeight = getDomainWeight(link);
                    const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                    const weight = baseWeight + 2.6 + (quality * 0.4);
                    sources.push({
                        title, link,
                        letter: localResult.letter,
                        weight,
                        evidenceType: localResult.evidenceType || 'explicit-gabarito',
                        questionPolarity, matchQuality: quality,
                        blockMethod: localResult.blockMethod
                    });
                    this._logSourceDiagnostic({
                        phase: 'decision',
                        hostHint,
                        type: sourceType,
                        topicSim: topicSimBase,
                        optionsMatch: optionsMatchBase,
                        obfuscation,
                        decision: 'use-local',
                        method: localResult.evidenceType || 'explicit-gabarito',
                        letter: localResult.letter
                    });
                    const { bestLetter, votes } = this._computeVotesAndState(sources);
                    if (bestLetter && (votes[bestLetter] || 0) >= 6.5) break;
                    continue;
                }

                // 3) Fallback: simpler explicit letter extraction
                extracted = this._extractExplicitLetterFromText(combinedText, questionStem, originalOptions);
                if (extracted?.letter) {
                    const baseWeight = getDomainWeight(link);
                    const weight = baseWeight + 2.0;
                    sources.push({
                        title, link,
                        letter: extracted.letter,
                        weight,
                        evidenceType: 'explicit-gabarito-simple',
                        questionPolarity
                    });
                    this._logSourceDiagnostic({
                        phase: 'decision',
                        hostHint,
                        type: sourceType,
                        topicSim: topicSimBase,
                        optionsMatch: optionsMatchBase,
                        obfuscation,
                        decision: 'use-explicit-simple',
                        method: 'explicit-gabarito-simple',
                        letter: extracted.letter
                    });
                    const { bestLetter, votes } = this._computeVotesAndState(sources);
                    if (bestLetter && (votes[bestLetter] || 0) >= 6.5) break;
                    continue;
                }

                // 4) No explicit evidence found: keep as low-priority AI evidence.
                const clipped = combinedText.slice(0, 4000);
                if (clipped.length >= 200) {
                    const topicSim = topicSimBase;
                    aiEvidence.push({ title, link, text: clipped, topicSim });
                    this._logSourceDiagnostic({
                        phase: 'decision',
                        hostHint,
                        type: sourceType,
                        topicSim,
                        optionsMatch: optionsMatchBase,
                        obfuscation,
                        decision: 'ai-evidence'
                    });
                }
            } catch (error) {
                console.error('SearchService Error:', error);
            }
        }

        // Merge aiEvidence + collectedForCombined, sorted by topic similarity
        const allForCombined = [
            ...aiEvidence.map(e => ({ ...e, origin: 'aiEvidence' })),
            ...collectedForCombined.map(e => ({ ...e, origin: 'mismatch' }))
        ].sort((a, b) => (b.topicSim || 0) - (a.topicSim || 0));

        // Determine if we already have strong explicit evidence
        const hasStrongExplicit = sources.some(s => (s.weight || 0) >= 5.0);

        // If we have no explicit sources OR we need more evidence, do AI combined pass
        if (allForCombined.length > 0 && (!hasStrongExplicit || sources.length < 2)) {
            if (typeof onStatus === 'function') {
                onStatus(sources.length === 0 ? 'No explicit answer found. Using AI best-effort...' : 'Cross-checking with additional sources...');
            }

            // Only use sources with reasonable topic similarity
            const relevant = allForCombined.filter(e => (e.topicSim || 0) >= 0.15).slice(0, 5);

            if (relevant.length > 0) {
                const merged = relevant
                    .map((e, i) => `SOURCE ${i + 1}: ${e.title}\n${e.text}\nLINK: ${e.link}`)
                    .join('\n\n');

                try {
                    const aiAnswer = await ApiService.inferAnswerFromEvidence(questionForInference, merged);
                    const aiLetter = this._parseAnswerLetter(aiAnswer);
                    if (aiLetter) {
                        // Weight depends on whether we already have explicit evidence
                        const aiWeight = hasStrongExplicit ? 0.3 : 0.9;
                        sources.push({
                            title: 'AI (combined evidence)',
                            link: '',
                            letter: aiLetter,
                            weight: aiWeight,
                            evidenceType: 'ai-combined',
                            questionPolarity
                        });
                        console.log(`SearchService: AI combined => Letra ${aiLetter}, weight=${aiWeight}`);
                    }
                } catch (error) {
                    console.warn('AI evidence inference failed:', error);
                }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â PAGE-LEVEL GABARITO TIE-BREAKER Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        if (pageGabarito) {
            const pgLetter = (pageGabarito || '').toUpperCase().trim();
            if (/^[A-E]$/.test(pgLetter)) {
                sources.push({
                    title: 'Page Gabarito', link: '',
                    letter: pgLetter, weight: 5.0,
                    evidenceType: 'page-gabarito', questionPolarity
                });
            }
        }

        if (sources.length === 0) return [];

        const { votes, bestLetter, resultState, reason, confidence } = this._computeVotesAndState(sources);

        let answerText = '';
        if (bestLetter && originalOptionsMap[bestLetter]) {
            answerText = originalOptionsMap[bestLetter];
        }

        const answer = bestLetter
            ? `Letra ${bestLetter}: ${answerText}`.trim()
            : (sources[0]?.answer || '').trim();

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â Determine evidence tier Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const isAiOnly = sources.every(s => s.evidenceType === 'ai' || s.evidenceType === 'ai-combined');
        const hasExplicitEvidence = sources.some(s => s.evidenceType && s.evidenceType !== 'ai' && s.evidenceType !== 'ai-combined');
        let evidenceTier = 'EVIDENCE_WEAK';
        if (isAiOnly) {
            evidenceTier = 'AI_ONLY';
        } else if (resultState === 'confirmed') {
            evidenceTier = 'EVIDENCE_STRONG';
        } else if (hasExplicitEvidence) {
            evidenceTier = 'EVIDENCE_MEDIUM';
        }

        return [{
            question: questionText,
            answer,
            answerLetter: bestLetter,
            answerText,
            sources,
            bestLetter,
            votes,
            confidence,
            resultState,
            reason,
            evidenceTier,
            questionPolarity,
            title: sources[0]?.title || 'Result',
            aiFallback: isAiOnly
        }];
    },

    async searchAndRefine(questionText, originalQuestionWithOptions = '') {
        const results = await ApiService.searchWithSerper(questionText);
        if (!results || results.length === 0) {
            return this.answerFromAi(questionText);
        }

        const refined = await this.refineFromResults(questionText, results, originalQuestionWithOptions);
        if (!refined || refined.length === 0) {
            return this.answerFromAi(questionText);
        }
        return refined;
    }
};
