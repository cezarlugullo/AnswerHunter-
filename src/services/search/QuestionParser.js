/**
 * QuestionParser.js
 * Parsing, normalization, and tokenization of question text and options.
 * No external dependencies — pure functions on text.
 */
export const QuestionParser = {

    // ── Text normalization ─────────────────────────────────────────────────────

    stripOptionTailNoise(text) {
        if (!text) return '';
        let cleaned = String(text).replace(/\s+/g, ' ').trim();
        const noiseMarker = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parabéns|você\s+acertou|confira\s+o\s+gabarito|explicação)\b/i;
        const idx = cleaned.search(noiseMarker);
        if (idx > 20) cleaned = cleaned.slice(0, idx).trim();
        return cleaned.replace(/[;:,\-.\s]+$/g, '').trim();
    },

    normalizeOption(text) {
        return (text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^[a-e]\s*[\)\.\-:]\s*/i, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    },

    looksLikeCodeOption(text) {
        const body = String(text || '');
        return /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|->|jsonb?|\bdb\.\w|\.(?:find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(body);
    },

    normalizeCodeAwareOption(text) {
        return (text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^[a-e]\s*[\)\.\-:]\s*/i, '')
            .replace(/->>|/g, ' op_json_text ')
            .replace(/->/g, ' op_json_obj ')
            .replace(/=>/g, ' op_arrow ')
            .replace(/::/g, ' op_dcolon ')
            .replace(/:=/g, ' op_assign ')
            .replace(/!=/g, ' op_neq ')
            .replace(/<>/g, ' op_neq ')
            .replace(/<=/g, ' op_lte ')
            .replace(/>=/g, ' op_gte ')
            .replace(/</g, ' op_lt ')
            .replace(/>/g, ' op_gt ')
            .replace(/:/g, ' op_colon ')
            .replace(/=/g, ' op_eq ')
            .replace(/[^a-z0-9_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    isUsableOptionBody(body) {
        const cleaned = String(body || '').replace(/\s+/g, ' ').trim();
        if (!cleaned || cleaned.length < 1) return false;
        if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(cleaned)) return false;
        if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(cleaned)) return false;
        if (/^(?:resposta|gabarito|alternativa\s+correta)\b/i.test(cleaned)) return false;
        return true;
    },

    // ── Question structure ─────────────────────────────────────────────────────

    extractQuestionStem(questionWithOptions) {
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

    extractOptionsFromQuestion(questionText) {
        if (!questionText) return [];
        const text = String(questionText || '').replace(/\r\n/g, '\n');
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const options = [];
        const seen = new Set();
        const seenBodies = new Set();
        const _codeDedupKey = (body) => this.normalizeCodeAwareOption(body).replace(/\s+/g, '');
        const optionRe = /^["'""\u2018\u2019\(\[]?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;

        for (const line of lines) {
            const m = line.match(optionRe);
            if (!m) continue;
            const letter = (m[1] || '').toUpperCase();
            const cleanedBody = this.stripOptionTailNoise(m[2]);
            const normalizedBody = this.normalizeOption(cleanedBody);
            const isCodeLike = this.looksLikeCodeOption(cleanedBody);
            const dedupKey = isCodeLike ? _codeDedupKey(cleanedBody) : normalizedBody;
            const duplicateBody = seenBodies.has(dedupKey);
            if (!this.isUsableOptionBody(cleanedBody) || !normalizedBody || seen.has(letter) || (!isCodeLike && duplicateBody)) continue;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
            if (!isCodeLike) seenBodies.add(dedupKey);
        }

        // Secondary pass: recover missing letters from inline/quoted patterns
        const inlineRe = /(?:^|[\n\r\t ;"'""''])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;"'""''][A-E]\s*[\)\.\-:]\s)|$)/gi;
        let m;
        while ((m = inlineRe.exec(text)) !== null) {
            const letter = (m[1] || '').toUpperCase();
            if (!letter || seen.has(letter)) continue;
            const cleanedBody = this.stripOptionTailNoise(m[2]);
            const normalizedBody = this.normalizeOption(cleanedBody);
            const isCodeLike = this.looksLikeCodeOption(cleanedBody);
            const inlineDedupKey = isCodeLike ? _codeDedupKey(cleanedBody) : normalizedBody;
            const duplicateBody = seenBodies.has(inlineDedupKey);
            if (!this.isUsableOptionBody(cleanedBody) || !normalizedBody || (!isCodeLike && duplicateBody)) continue;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
            if (!isCodeLike) seenBodies.add(inlineDedupKey);
            if (seen.size >= 5) break;
        }

        // Contamination guard: for code-oriented stems, drop textual outlier options
        const stemNorm = this.normalizeOption(this.extractQuestionStem(text));
        const expectsCodeOptions = /\b(?:sql|jsonb?|insert|update|delete|select|comando|sintaxe|codigo)\b/i.test(stemNorm);
        if (expectsCodeOptions && options.length >= 4) {
            const parsed = options.map((line) => {
                const mm = String(line || '').match(/^([A-E])\)\s*(.+)$/i);
                const letter = (mm?.[1] || '').toUpperCase();
                const body = this.stripOptionTailNoise(mm?.[2] || '');
                const codeLike = this.looksLikeCodeOption(body);
                return { letter, body, codeLike };
            }).filter((o) => /^[A-E]$/.test(o.letter) && !!o.body);

            const codeEntries = parsed.filter((o) => o.codeLike);
            const nonCodeEntries = parsed.filter((o) => !o.codeLike);
            const allLetters = parsed.map((o) => o.letter).sort();
            const expectedLettersForCount = ['A', 'B', 'C', 'D', 'E'].slice(0, allLetters.length);
            const isCompleteSequence = allLetters.join('') === expectedLettersForCount.join('');
            if (codeEntries.length >= 3 && nonCodeEntries.length >= 1 && !isCompleteSequence) {
                return codeEntries.map((o) => `${o.letter}) ${o.body}`);
            }
        }

        return options;
    },

    buildOptionsMap(questionText) {
        const options = this.extractOptionsFromQuestion(questionText);
        const map = {};
        for (const opt of options) {
            const m = opt.match(/^([A-E])\)\s*(.+)$/i);
            if (m) map[m[1].toUpperCase()] = this.stripOptionTailNoise(m[2]);
        }
        return map;
    },

    // ── Answer letter parsing ──────────────────────────────────────────────────

    parseAnswerLetter(answerText) {
        if (!answerText) return null;
        const text = String(answerText).replace(/\r/g, '\n').trim();
        if (!text) return null;

        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const finalLineRe = /^(?:(?:resposta\s+final|conclus[aã]o|gabarito)\s*[:\-]\s*)?(?:letra|gabarito|resposta\s+final|alternativa\s+correta|letter|option)\s*[:\-]?\s*([A-E])\b(?:\s*[:.·\-]|$)/i;
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
            const m = lines[i].match(finalLineRe);
            if (m) return (m[1] || '').toUpperCase();
        }

        const taggedMatches = [...text.matchAll(/(?:^|\b)(?:resposta\s+final|gabarito|alternativa\s+correta|letra|letter|option)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi)]
            .map(m => (m[1] || '').toUpperCase()).filter(Boolean);
        const uniqueTagged = [...new Set(taggedMatches)];
        if (uniqueTagged.length === 1) return uniqueTagged[0];
        if (uniqueTagged.length > 1) return null;

        const prosePatterns = [
            /(?:resposta|answer)\s+(?:correta\s+)?(?:[eéÉ]|seria)\s+(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi,
            /(?:alternativa|opção|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?([A-E])\b/gi,
            /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi
        ];
        for (const re of prosePatterns) {
            const proseHits = [...text.matchAll(re)].map(m => (m[1] || '').toUpperCase()).filter(Boolean);
            const uniqueProse = [...new Set(proseHits)];
            if (uniqueProse.length === 1) return uniqueProse[0];
        }

        const optionLineMatches = [...text.matchAll(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s+/gim)]
            .map(m => (m[1] || '').toUpperCase()).filter(Boolean);
        const uniqueOptionLines = [...new Set(optionLineMatches)];
        if (uniqueOptionLines.length === 1) return uniqueOptionLines[0];

        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            if (lastLine.length < 40) {
                const bareMatch = lastLine.match(/\b([A-E])\b/i);
                if (bareMatch) return bareMatch[1].toUpperCase();
            }
        }
        return null;
    },

    parseAnswerText(answerText) {
        if (!answerText) return '';
        const text = String(answerText).replace(/\r/g, '\n').trim();
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const finalBodyRe = /(?:letra|alternativa|letter|option)\s*[A-E]\s*[:.·\-]\s*(.{5,})/i;
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
            const m = lines[i].match(finalBodyRe);
            if (m && m[1]) return m[1].trim();
        }
        return text
            .replace(/^(?:Letra|Alternativa|Letter|Option)\s*[A-E]\s*[:.·\-]?\s*/i, '')
            .replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '')
            .trim();
    },

    findLetterByAnswerText(answerBody, optionsMap) {
        if (!answerBody || !optionsMap) return null;
        const normalizedAnswer = this.normalizeOption(answerBody);
        if (!normalizedAnswer || normalizedAnswer.length < 20) return null;

        const normalizedEntries = Object.entries(optionsMap)
            .map(([letter, body]) => [letter, this.normalizeOption(body)])
            .filter(([, body]) => !!body && body.length >= 8);
        if (normalizedEntries.length < 2) return null;

        const containsHits = normalizedEntries.filter(([, body]) => normalizedAnswer.includes(body));
        if (containsHits.length >= 2) return null;

        const finalChunkNorm = this.normalizeOption(String(answerBody).slice(-420));
        let bestLetter = null;
        let bestScore = 0;
        normalizedEntries.forEach(([letter, normalizedBody]) => {
            if (!normalizedBody) return;
            const inFinalChunk = finalChunkNorm.includes(normalizedBody);
            const inFullAnswer = normalizedAnswer.includes(normalizedBody);
            if (inFinalChunk || inFullAnswer) {
                const score = normalizedBody.length + (inFinalChunk ? 120 : 0);
                if (score > bestScore) { bestScore = score; bestLetter = letter; }
            }
        });
        return bestLetter;
    },

    // ── Tokenization & similarity ──────────────────────────────────────────────

    extractKeyTokens(stem) {
        const stop = new Set([
            'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'resposta', 'gabarito',
            'que', 'qual', 'quais', 'como', 'para', 'por', 'com', 'sem', 'uma', 'um', 'de', 'da', 'do',
            'das', 'dos', 'na', 'no', 'nas', 'nos', 'ao', 'aos', 'as', 'os', 'e', 'ou', 'em'
        ]);
        const tokens = this.normalizeOption(stem).split(' ').filter(Boolean);
        return tokens.filter(t => t.length >= 5 && !stop.has(t)).slice(0, 10);
    },

    countTokenHits(text, tokens) {
        if (!text || !tokens || tokens.length === 0) return 0;
        const normalized = this.normalizeOption(text);
        let hits = 0;
        for (const t of tokens) {
            if (normalized.includes(t)) hits++;
        }
        return hits;
    },

    /**
     * Extracts discriminative tokens from option bodies (NOT present in the stem).
     * These help distinguish one question from another on the same topic/page.
     */
    extractOptionTokens(questionText) {
        const options = this.extractOptionsFromQuestion(questionText);
        if (options.length < 2) return [];

        const stem = this.extractQuestionStem(questionText);
        const stemTokenSet = new Set(this.extractKeyTokens(stem));
        const stemNorm = this.normalizeOption(stem);
        for (const w of stemNorm.split(/\s+/)) {
            if (w.length >= 3) stemTokenSet.add(w);
        }

        const tokenFreq = new Map();
        const optionCount = options.length;

        for (const rawOpt of options) {
            const m = String(rawOpt || '').match(/^([A-E])\)\s*(.+)$/i);
            const body = m ? this.stripOptionTailNoise(m[2]) : '';
            if (!body) continue;

            const isCode = this.looksLikeCodeOption(body);
            const normalized = isCode
                ? this.normalizeCodeAwareOption(body)
                : this.normalizeOption(body);
            if (!normalized) continue;

            const seenInThisOption = new Set();
            for (const w of normalized.split(/\s+/).filter(Boolean)) {
                if (w.length >= 3 && !stemTokenSet.has(w) && !seenInThisOption.has(w)) {
                    seenInThisOption.add(w);
                    tokenFreq.set(w, (tokenFreq.get(w) || 0) + 1);
                }
            }
        }

        const maxFreq = Math.ceil(optionCount / 2);
        return [...tokenFreq.entries()]
            .filter(([, count]) => count <= maxFreq)
            .sort((a, b) => a[1] - b[1])
            .map(([token]) => token)
            .slice(0, 8);
    },

    diceSimilarity(a, b) {
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

    questionSimilarityScore(sourceText, questionStem) {
        if (!sourceText || !questionStem) return 0;
        const srcNorm = this.normalizeOption(sourceText);
        const stemNorm = this.normalizeOption(questionStem);

        const stemTokens = stemNorm.split(/\s+/).filter(t => t.length >= 4);
        const srcTokens = new Set(srcNorm.split(/\s+/).filter(t => t.length >= 4));
        if (stemTokens.length === 0) return 0;

        let hits = 0;
        for (const t of stemTokens) {
            if (srcTokens.has(t)) hits++;
        }
        const tokenScore = hits / stemTokens.length;
        const prefix = stemNorm.slice(0, 50);
        const prefixMatch = prefix.length >= 20 && srcNorm.includes(prefix) ? 0.3 : 0;
        const diceScore = this.diceSimilarity(stemNorm.slice(0, 120), srcNorm.slice(0, Math.min(srcNorm.length, 500)));

        return Math.min(1.0, tokenScore * 0.5 + prefixMatch + diceScore * 0.3);
    },

    detectQuestionPolarity(questionText) {
        const text = String(questionText || '').toLowerCase();
        const incorrectMarkers = /\b(?:incorreta|errada|falsa|inv[áa]lida|n[aã]o\s+(?:[eé]|est[aá])|incorreto|errado|falso|inv[áa]lido)\b/;
        const correctMarkers = /\b(?:correta|verdadeira|v[áa]lida|certa|correto|verdadeiro|v[áa]lido|certo)\b/;

        const incorrectScore = (text.match(incorrectMarkers) || []).length;
        const correctScore = (text.match(correctMarkers) || []).length;

        return incorrectScore > correctScore ? 'INCORRECT' : 'CORRECT';
    },

    /**
     * Creates a canonical string from question + options for hashing/dedup.
     */
    canonicalizeQuestion(questionText) {
        const stem = this.extractQuestionStem(questionText);
        const options = this.extractOptionsFromQuestion(questionText);
        const normStem = this.normalizeOption(stem).replace(/\s+/g, ' ').trim();
        const normOpts = (options || []).map(o => this.normalizeOption(o).replace(/\s+/g, ' ').trim()).sort();
        return `${normStem}||${normOpts.join('|')}`;
    },
};
