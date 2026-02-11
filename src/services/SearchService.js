import { ApiService } from './ApiService.js';

// SearchService
// Coordinates (1) direct extraction and (2) web search + evidence-based refinement.
export const SearchService = {
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
        const lines = questionText.split('\n').map(l => l.trim()).filter(Boolean);
        const options = [];
        const optionRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
        for (const line of lines) {
            const m = line.match(optionRe);
            if (m) options.push(`${m[1].toUpperCase()}) ${m[2].trim()}`);
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
        return (stemLines.join(' ').trim() || text.trim()).slice(0, 600);
    },

    // ═══ Dice bigram similarity for fuzzy matching ═══
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

        const origNorms = originalOptions.map(o => this._normalizeOption(o)).filter(Boolean);
        const srcNorms = sourceOptions.map(o => this._normalizeOption(o)).filter(Boolean);
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

    _optionsMatchInFreeText(originalOptions, sourceText) {
        if (!originalOptions || originalOptions.length < 2) return true;
        if (!sourceText || sourceText.length < 80) return true;

        const normalizedSource = this._normalizeOption(sourceText);
        if (!normalizedSource) return true;

        const originalSet = new Set(originalOptions.map(o => this._normalizeOption(o)).filter(Boolean));
        if (originalSet.size === 0) return true;

        let hits = 0;
        for (const opt of originalSet) {
            if (opt && normalizedSource.includes(opt)) hits += 1;
        }

        const ratio = hits / originalSet.size;
        return ratio >= 0.6 || hits >= Math.min(3, originalSet.size);
    },

    _buildOptionsMap(questionText) {
        const options = this._extractOptionsFromQuestion(questionText);
        const map = {};
        for (const opt of options) {
            const m = opt.match(/^([A-E])\)\s*(.+)$/i);
            if (m) map[m[1].toUpperCase()] = m[2].trim();
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

    // ═══ DICE SIMILARITY (bigram) ═══
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

    // ═══ QUESTION SIMILARITY SCORE ═══
    // Returns 0..1 score indicating how similar a source snippet is to the original question stem.
    // Used to gate Brainly and other weak sources — they must match the actual question.
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

    // ═══ CANONICAL QUESTION HASH ═══
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

    // ═══ POLARITY DETECTION ═══
    _detectQuestionPolarity(questionText) {
        if (!questionText) return 'CORRECT';
        const text = questionText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
            /\bexceto\b/i,
            /\bnao\b.*\bcorret/i
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

    // ═══ FINGERPRINT-BASED QUESTION BLOCK FINDING ═══
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
                new RegExp(`(?:^|\\n)\\s*(?:Quest[aã]o|Questao)\\s+${qNum}\\b`, 'im')
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

    // ═══ RANKED CANDIDATE SELECTION ═══
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

    // ═══ ENHANCED EXPLICIT GABARITO EXTRACTION (polarity-aware) ═══
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

    // ═══ LOCAL ANSWER EXTRACTION ═══
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

    // ═══ MATCH QUALITY COMPUTATION ═══
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
                /(?:^|\b)(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*(?:é|e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i,
                /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+([A-E])\s*(?:é|e)\s*(?:a\s+)?(?:falsa|incorreta|errada)\b/i,
                /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*[:\-]?\s*([A-E])\b/i,
                // Common SERP phrasing: "A opção falsa é a e) ..."
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

    _extractPdfLikeHighlightLetterFromHtml(html, questionStem, originalOptionsMap, originalOptions) {
        if (!html || html.length < 2000) return null;
        const tokens = this._extractKeyTokens(questionStem);

        let doc;
        try {
            doc = new DOMParser().parseFromString(html, 'text/html');
        } catch {
            return null;
        }

        let nodes = Array.from(doc.querySelectorAll('div.t'));

        // Some sources embed the PDF-like HTML as an escaped string inside JSON (e.g. \u003cdiv...).
        // If the DOM looks empty, try to decode a slice of embedded HTML and parse again.
        if (nodes.length < 50 && html.includes('\\u003cdiv')) {
            const idx = html.indexOf('\\u003cdiv');
            const slice = html.slice(idx, Math.min(html.length, idx + 450000));
            const decoded = slice
                .replace(/\\u003c/gi, '<')
                .replace(/\\u003e/gi, '>')
                .replace(/\\u0026/gi, '&')
                .replace(/\\\"/g, '"')
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t');
            try {
                doc = new DOMParser().parseFromString(decoded, 'text/html');
                nodes = Array.from(doc.querySelectorAll('div.t'));
            } catch (_) {
                // no-op
            }
        }

        if (nodes.length < 50) return null;

        const frags = nodes
            .map((n) => ({
                text: (n.textContent || '').replace(/\s+/g, ' ').trim(),
                cls: (n.getAttribute('class') || '').toLowerCase(),
                style: (n.getAttribute('style') || '').toLowerCase()
            }))
            .filter(f => f.text && f.text.length >= 1);

        if (frags.length < 50) return null;

        // Find the best anchor position for the question block.
        let bestIdx = -1;
        let bestHits = 0;
        for (let i = 0; i < frags.length; i += 1) {
            const hits = this._countTokenHits(frags[i].text, tokens);
            if (hits > bestHits) {
                bestHits = hits;
                bestIdx = i;
            }
        }

        if (bestIdx < 0 || bestHits < Math.min(2, Math.max(1, tokens.length))) return null;

        const windowFrags = frags.slice(bestIdx, Math.min(frags.length, bestIdx + 500));
        const windowText = windowFrags.map(f => f.text).join('\n');

        // Options evidence gate: require at least 2 option bodies present in this window.
        const optBodies = Object.values(originalOptionsMap || {}).map(v => this._normalizeOption(v)).filter(v => v.length >= 8);
        let optionHits = 0;
        const normWindow = this._normalizeOption(windowText);
        for (const body of optBodies) {
            if (body && normWindow.includes(body)) optionHits += 1;
        }
        if (originalOptions && originalOptions.length >= 2 && optionHits < 2) return null;

        const altStartRe = /^([A-E])\s*[\)\.\-:]\s*/i;
        const groups = {};
        let current = null;

        const isNextQuestionMarker = (t) => {
            const s = (t || '').trim();
            return /^\d+\)\s*/.test(s) || /^aula\s+\d+/i.test(s);
        };

        for (const f of windowFrags) {
            const t = f.text;
            const m = t.match(altStartRe);
            if (m) {
                const letter = m[1].toUpperCase();
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

        const scoreByLetter = {};
        for (const letter of letters) {
            const parts = groups[letter];
            let ff1Hits = 0;
            for (const p of parts) {
                // "ff1" is a known highlight in PDF-like HTML exports.
                if (/\bff1\b/.test(p.cls)) ff1Hits += 1;
            }
            scoreByLetter[letter] = ff1Hits;
        }

        let bestLetter = null;
        let bestScore = 0;
        let secondScore = 0;
        for (const [letter, score] of Object.entries(scoreByLetter)) {
            if (score > bestScore) {
                secondScore = bestScore;
                bestScore = score;
                bestLetter = letter;
            } else if (score > secondScore) {
                secondScore = score;
            }
        }

        if (!bestLetter || bestScore < 1) return null;
        if (bestScore === secondScore) return null;

        return {
            letter: bestLetter,
            confidence: 0.95,
            evidence: `ff1_hits=${bestScore} window_tokens=${bestHits}`
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
            if (evidenceType.includes('ff1-highlight')) return true;
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
        const topResults = results.slice(0, 6);

        const questionForInference = originalQuestionWithOptions || questionText;
        const questionStem = this._extractQuestionStem(questionForInference);

        const originalOptions = this._extractOptionsFromQuestion(questionForInference);
        const originalOptionsMap = this._buildOptionsMap(questionForInference);
        const hasOptions = originalOptions && originalOptions.length >= 2;

        // ═══ Detect question polarity ═══
        const questionPolarity = this._detectQuestionPolarity(questionForInference);
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

                // Relaxed options gate: skip only if text is long enough and clearly wrong topic
                if (hasOptions && combinedText.length > 500 && !this._optionsMatchInFreeText(originalOptions, combinedText)) {
                    // Still usable for combined inference at low weight
                    const topicSim = this._questionSimilarityScore(combinedText, questionStem);
                    if (topicSim >= 0.2) {
                        collectedForCombined.push({ title, link, text: combinedText.slice(0, 3000), topicSim });
                        console.log(`SearchService: Options mismatch but topic similar (${topicSim.toFixed(2)}), saved for combined: ${link}`);
                    } else {
                        console.log(`SearchService: Options mismatch, skipping: ${link}`);
                    }
                    continue;
                }

                const hostHint = this._getHostHintFromLink(link);

                // 1) PDF-like highlight extraction (PasseiDireto/Studocu), scoped by question.
                let extracted = null;
                if (hostHint === 'passeidireto.com' || hostHint === 'studocu.com') {
                    extracted = this._extractPdfLikeHighlightLetterFromHtml(snap?.html || '', questionStem, originalOptionsMap, originalOptions);
                    if (extracted?.letter) {
                        console.log(`SearchService: PDF highlight detected. host=${hostHint} letter=${extracted.letter}`);
                        const baseWeight = getDomainWeight(link);
                        const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                        const weight = baseWeight + 4.0 + (quality * 0.3);
                        sources.push({
                            title, link,
                            letter: extracted.letter,
                            weight,
                            evidenceType: hostHint === 'passeidireto.com' ? 'passeidireto-ff1-highlight-scoped' : 'studocu-ff1-highlight-scoped',
                            questionPolarity, matchQuality: quality
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
                    const { bestLetter, votes } = this._computeVotesAndState(sources);
                    if (bestLetter && (votes[bestLetter] || 0) >= 6.5) break;
                    continue;
                }

                // 4) No explicit evidence found: keep as low-priority AI evidence.
                const clipped = combinedText.slice(0, 4000);
                if (clipped.length >= 200) {
                    const topicSim = this._questionSimilarityScore(clipped, questionStem);
                    aiEvidence.push({ title, link, text: clipped, topicSim });
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

        // ═══ PAGE-LEVEL GABARITO TIE-BREAKER ═══
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

        // ═══ Determine evidence tier ═══
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
