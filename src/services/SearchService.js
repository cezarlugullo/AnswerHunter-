import { ApiService } from './ApiService.js';

// SearchService
// Coordinates (1) direct extraction and (2) web search + evidence-based refinement.
export const SearchService = {
    _SEARCH_CACHE_KEY: 'ahSearchDecisionCacheV2',
    _SEARCH_METRICS_KEY: 'ahSearchMetricsV1',
    _CACHE_MAX_ENTRIES: 220,
    _CACHE_MAX_AGE_MS: 1000 * 60 * 60 * 24 * 7, // 7 days

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

    _looksLikeCodeOption(text) {
        const body = String(text || '');
        return /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?/i.test(body);
    },

    _normalizeCodeAwareOption(text) {
        return (text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^[a-e]\s*[\)\.\-:]\s*/i, '')
            .replace(/=>/g, ' op_arrow ')
            .replace(/::/g, ' op_dcolon ')
            .replace(/:=/g, ' op_assign ')
            .replace(/:/g, ' op_colon ')
            .replace(/=/g, ' op_eq ')
            .replace(/[^a-z0-9_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    _isUsableOptionBody(body) {
        const cleaned = String(body || '').replace(/\s+/g, ' ').trim();
        if (!cleaned || cleaned.length < 8) return false;
        if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(cleaned)) return false;
        if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(cleaned)) return false;
        if (/^(?:resposta|gabarito|alternativa\s+correta)\b/i.test(cleaned)) return false;
        return true;
    },

    _extractOptionsFromQuestion(questionText) {
        if (!questionText) return [];
        const text = String(questionText || '').replace(/\r\n/g, '\n');
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const options = [];
        const seen = new Set();
        const seenBodies = new Set();
        // Code-aware dedup: preserve SQL/JSON operators that plain normalization strips.
        const _codeDedupKey = (body) => this._normalizeCodeAwareOption(body).replace(/\s+/g, '');
        const optionRe = /^["'“”‘’\(\[]?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
        for (const line of lines) {
            const m = line.match(optionRe);
            if (!m) continue;
            const letter = (m[1] || '').toUpperCase();
            const cleanedBody = this._stripOptionTailNoise(m[2]);
            const normalizedBody = this._normalizeOption(cleanedBody);
            const isCodeLike = this._looksLikeCodeOption(cleanedBody);
            const dedupKey = isCodeLike ? _codeDedupKey(cleanedBody) : normalizedBody;
            const duplicateBody = seenBodies.has(dedupKey);
            // Do not body-dedup code-like options. OCR often makes A/E look very similar,
            // but they are still distinct alternatives by letter.
            if (!this._isUsableOptionBody(cleanedBody) || !normalizedBody || seen.has(letter) || (!isCodeLike && duplicateBody)) continue;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
            if (!isCodeLike) seenBodies.add(dedupKey);
        }

        // Secondary pass (always): recover missing letters from inline/quoted patterns.
        const inlineRe = /(?:^|[\n\r\t ;"'“”‘’])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;"'“”‘’][A-E]\s*[\)\.\-:]\s)|$)/gi;
        let m;
        while ((m = inlineRe.exec(text)) !== null) {
            const letter = (m[1] || '').toUpperCase();
            if (!letter || seen.has(letter)) continue;
            const cleanedBody = this._stripOptionTailNoise(m[2]);
            const normalizedBody = this._normalizeOption(cleanedBody);
            const isCodeLike = this._looksLikeCodeOption(cleanedBody);
            const inlineDedupKey = isCodeLike ? _codeDedupKey(cleanedBody) : normalizedBody;
            const duplicateBody = seenBodies.has(inlineDedupKey);
            if (!this._isUsableOptionBody(cleanedBody) || !normalizedBody || (!isCodeLike && duplicateBody)) continue;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
            if (!isCodeLike) seenBodies.add(inlineDedupKey);
            if (seen.size >= 5) break;
        }

        // OCR/DOM contamination guard:
        // for code-oriented stems (SQL/JSON), drop textual outlier options that likely
        // came from a different question block (common in PDF-like pages).
        const stemNorm = this._normalizeOption(this._extractQuestionStem(text));
        const expectsCodeOptions = /\b(?:sql|jsonb?|insert|update|delete|select|comando|sintaxe|codigo)\b/i.test(stemNorm);
        if (expectsCodeOptions && options.length >= 4) {
            const parsed = options.map((line) => {
                const mm = String(line || '').match(/^([A-E])\)\s*(.+)$/i);
                const letter = (mm?.[1] || '').toUpperCase();
                const body = this._stripOptionTailNoise(mm?.[2] || '');
                const codeLike = this._looksLikeCodeOption(body);
                return { letter, body, codeLike };
            }).filter((o) => /^[A-E]$/.test(o.letter) && !!o.body);

            const codeEntries = parsed.filter((o) => o.codeLike);
            const nonCodeEntries = parsed.filter((o) => !o.codeLike);
            if (codeEntries.length >= 3 && nonCodeEntries.length >= 1) {
                return codeEntries.map((o) => `${o.letter}) ${o.body}`);
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

        const optionEntries = [];
        const seen = new Set();
        for (const rawOpt of originalOptions) {
            const cleaned = this._stripOptionTailNoise(rawOpt);
            if (!cleaned) continue;
            const isCodeLike = this._looksLikeCodeOption(cleaned);
            const normalized = isCodeLike
                ? this._normalizeCodeAwareOption(cleaned)
                : this._normalizeOption(cleaned);
            if (!normalized) continue;
            const dedupKey = isCodeLike
                ? `code:${normalized.replace(/\s+/g, '')}`
                : `text:${normalized}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            optionEntries.push({ normalized, isCodeLike });
        }

        const total = optionEntries.length;
        if (total === 0) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
        }

        const normalizedSourceCode = this._normalizeCodeAwareOption(sourceText);
        const sourceCompact = normalizedSource.replace(/\s+/g, '');
        const sourceCompactCode = normalizedSourceCode.replace(/\s+/g, '');
        const sourceTokenSet = new Set(
            normalizedSource
                .split(/\s+/)
                .map(t => t.trim())
                .filter(t => t.length >= 3)
        );
        const sourceCodeTokenSet = new Set(
            normalizedSourceCode
                .split(/\s+/)
                .map(t => t.trim())
                .filter(t => t.length >= 3)
        );
        const weakStop = new Set([
            'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'resposta',
            'dados', 'bancos', 'banco', 'modelo', 'modelos', 'nosql', 'sql'
        ]);

        let hits = 0;
        for (const entry of optionEntries) {
            const opt = entry.normalized;
            if (!opt) continue;

            if (entry.isCodeLike) {
                if (normalizedSourceCode.includes(opt)) {
                    hits += 1;
                    continue;
                }

                const optCompactCode = opt.replace(/\s+/g, '');
                if (optCompactCode.length >= 14 && sourceCompactCode.includes(optCompactCode)) {
                    hits += 1;
                    continue;
                }

                const optTokens = opt
                    .split(/\s+/)
                    .map(t => t.trim())
                    .filter(Boolean);
                const opTokens = optTokens.filter(t => t.startsWith('op_'));
                const lexTokens = optTokens.filter(t => !t.startsWith('op_') && t.length >= 4 && !weakStop.has(t));
                if (lexTokens.length === 0) continue;

                let lexHits = 0;
                for (const tk of lexTokens) {
                    if (sourceCodeTokenSet.has(tk)) lexHits += 1;
                }
                const lexRatio = lexHits / lexTokens.length;

                let opHits = 0;
                for (const op of opTokens) {
                    if (sourceCodeTokenSet.has(op)) opHits += 1;
                }
                const opRatio = opTokens.length > 0 ? (opHits / opTokens.length) : 1;

                if ((lexHits >= 2 && lexRatio >= 0.5 && opRatio >= 0.5) || (lexRatio >= 0.7 && opRatio >= 0.34)) {
                    hits += 1;
                }
                continue;
            }

            if (normalizedSource.includes(opt)) {
                hits += 1;
                continue;
            }

            const optCompact = opt.replace(/\s+/g, '');
            if (optCompact.length >= 12 && sourceCompact.includes(optCompact)) {
                hits += 1;
                continue;
            }

            const optTokens = opt
                .split(/\s+/)
                .map(t => t.trim())
                .filter(t => t.length >= 4 && !weakStop.has(t));
            if (optTokens.length === 0) continue;

            let tokenHits = 0;
            for (const tk of optTokens) {
                if (sourceTokenSet.has(tk)) tokenHits += 1;
            }
            const tokenRatio = tokenHits / optTokens.length;
            if ((tokenHits >= 2 && tokenRatio >= 0.55) || tokenRatio >= 0.72) {
                hits += 1;
            }
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
        const text = String(answerText).replace(/\r/g, '\n').trim();
        if (!text) return null;

        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const finalLineRe = /^(?:(?:resposta\s+final|conclus[aã]o|gabarito)\s*[:\-]\s*)?(?:letra|gabarito|resposta\s+final|alternativa\s+correta|letter|option)\s*[:\-]?\s*([A-E])\b(?:\s*[:.\-]|$)/i;
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
            const m = lines[i].match(finalLineRe);
            if (m) return (m[1] || '').toUpperCase();
        }

        const taggedMatches = [...text.matchAll(/(?:^|\b)(?:resposta\s+final|gabarito|alternativa\s+correta|letra|letter|option)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi)]
            .map(m => (m[1] || '').toUpperCase())
            .filter(Boolean);
        const uniqueTagged = [...new Set(taggedMatches)];
        if (uniqueTagged.length === 1) return uniqueTagged[0];
        if (uniqueTagged.length > 1) return null;

        // Match "a resposta (correta) é/seria (a alternativa) X"
        const prosePatterns = [
            /(?:resposta|answer)\s+(?:correta\s+)?(?:[eéÉ]|seria)\s+(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi,
            /(?:alternativa|opcao|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?([A-E])\b/gi,
            /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi
        ];
        for (const re of prosePatterns) {
            const proseHits = [...text.matchAll(re)].map(m => (m[1] || '').toUpperCase()).filter(Boolean);
            const uniqueProse = [...new Set(proseHits)];
            if (uniqueProse.length === 1) return uniqueProse[0];
        }

        // Last resort for terse answers like "A) ..."
        const optionLineMatches = [...text.matchAll(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s+/gim)]
            .map(m => (m[1] || '').toUpperCase())
            .filter(Boolean);
        const uniqueOptionLines = [...new Set(optionLineMatches)];
        if (uniqueOptionLines.length === 1) return uniqueOptionLines[0];

        // Bare letter in last line (very short conclusion line)
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            if (lastLine.length < 40) {
                const bareMatch = lastLine.match(/\b([A-E])\b/i);
                if (bareMatch) return bareMatch[1].toUpperCase();
            }
        }

        return null;
    },

    _parseAnswerText(answerText) {
        if (!answerText) return '';
        const text = String(answerText).replace(/\r/g, '\n').trim();

        // For step-by-step AI responses (PASSO 1/2/3), find "Letra X: [text]" in the last lines
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const finalBodyRe = /(?:letra|alternativa|letter|option)\s*[A-E]\s*[:.\-]\s*(.{5,})/i;
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
            const m = lines[i].match(finalBodyRe);
            if (m && m[1]) return m[1].trim();
        }

        // Fallback: strip letter prefix from beginning of text
        return text
            .replace(/^(?:Letra|Alternativa|Letter|Option)\s*[A-E]\s*[:.\-]?\s*/i, '')
            .replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '')
            .trim();
    },

    _findLetterByAnswerText(answerBody, optionsMap) {
        if (!answerBody || !optionsMap) return null;
        const normalizedAnswer = this._normalizeOption(answerBody);
        if (!normalizedAnswer || normalizedAnswer.length < 20) return null;

        const normalizedEntries = Object.entries(optionsMap)
            .map(([letter, body]) => [letter, this._normalizeOption(body)])
            .filter(([, body]) => !!body && body.length >= 8);
        if (normalizedEntries.length < 2) return null;

        const containsHits = normalizedEntries.filter(([, body]) => normalizedAnswer.includes(body));
        if (containsHits.length >= 2) return null;

        const finalChunkNorm = this._normalizeOption(String(answerBody).slice(-420));
        let bestLetter = null;
        let bestScore = 0;
        normalizedEntries.forEach(([letter, normalizedBody]) => {
            if (!normalizedBody) return;
            const inFinalChunk = finalChunkNorm.includes(normalizedBody);
            const inFullAnswer = normalizedAnswer.includes(normalizedBody);
            if (inFinalChunk || inFullAnswer) {
                const score = normalizedBody.length + (inFinalChunk ? 120 : 0);
                if (score > bestScore) {
                    bestScore = score;
                    bestLetter = letter;
                }
            }
        });
        return bestLetter;
    },

    // ▸▸▸ GOOGLE AI OVERVIEW / ANSWER BOX EXTRACTION ▸▸▸
    // Extracts an answer letter from Serper meta signals (answerBox, aiOverview,
    // peopleAlsoAsk) that come "for free" with the search results.
    _extractLetterFromGoogleMeta(serperMeta, questionStem, originalOptionsMap, originalOptions) {
        if (!serperMeta) return null;
        const results = []; // {letter, confidence, method, evidence}

        // ── 1) answerBox ──
        const ab = serperMeta.answerBox;
        if (ab) {
            const abText = [ab.title, ab.snippet, ab.answer, ab.highlighted_words?.join(' ')]
                .filter(Boolean).join(' ').trim();
            if (abText.length >= 20) {
                const parsed = this._parseGoogleMetaText(abText, originalOptionsMap, originalOptions);
                if (parsed) {
                    results.push({ ...parsed, method: 'google-answerbox', evidence: abText.slice(0, 600) });
                }
            }
        }

        // ── 2) aiOverview (Serper may return embedded or via separate key) ──
        const aio = serperMeta.aiOverview;
        if (aio) {
            let aioText = '';
            if (typeof aio === 'string') {
                aioText = aio;
            } else if (aio.text_blocks && Array.isArray(aio.text_blocks)) {
                aioText = this._flattenAiOverviewBlocks(aio.text_blocks);
            } else if (aio.snippet) {
                aioText = String(aio.snippet || '');
            } else if (aio.text) {
                aioText = String(aio.text || '');
            }
            if (aioText.length >= 30) {
                const parsed = this._parseGoogleMetaText(aioText, originalOptionsMap, originalOptions);
                if (parsed) {
                    results.push({ ...parsed, method: 'google-ai-overview', evidence: aioText.slice(0, 800) });
                }
            }
        }

        // ── 3) peopleAlsoAsk ──
        const paa = serperMeta.peopleAlsoAsk;
        if (Array.isArray(paa) && paa.length > 0) {
            // Only use PAA entries whose question is similar to the user's question
            const normStem = this._normalizeOption(questionStem);
            for (const entry of paa.slice(0, 4)) {
                const paaQ = String(entry.question || entry.title || '');
                const paaSnippet = String(entry.snippet || entry.answer || '');
                if (!paaSnippet || paaSnippet.length < 20) continue;
                // Check topic relevance of the PAA question
                const paaQNorm = this._normalizeOption(paaQ);
                const qSim = this._diceSimilarity(normStem, paaQNorm);
                if (qSim < 0.40) continue;
                const parsed = this._parseGoogleMetaText(paaSnippet, originalOptionsMap, originalOptions);
                if (parsed) {
                    // PAA is less reliable — reduce confidence
                    results.push({
                        ...parsed,
                        confidence: Math.min(parsed.confidence, 0.72),
                        method: 'google-paa',
                        evidence: `Q: ${paaQ}\nA: ${paaSnippet}`.slice(0, 500)
                    });
                    break; // Only use first matching PAA
                }
            }
        }

        if (results.length === 0) return null;

        // Pick the highest-confidence result
        results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        const best = results[0];
        console.log(`SearchService: [google-meta] Found letter=${best.letter} confidence=${best.confidence.toFixed(2)} method=${best.method} from ${results.length} candidate(s)`);
        return best;
    },

    // Flatten AI Overview text_blocks (nested structure from Serper/SerpAPI)
    _flattenAiOverviewBlocks(blocks) {
        if (!Array.isArray(blocks)) return '';
        const parts = [];
        for (const block of blocks) {
            if (block.snippet) parts.push(block.snippet);
            if (block.text) parts.push(block.text);
            if (block.list && Array.isArray(block.list)) {
                for (const item of block.list) {
                    if (item.snippet) parts.push(item.snippet);
                    if (item.title) parts.push(item.title);
                    if (item.text_blocks) parts.push(this._flattenAiOverviewBlocks(item.text_blocks));
                }
            }
            if (block.text_blocks) parts.push(this._flattenAiOverviewBlocks(block.text_blocks));
        }
        return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    },

    // Core parser: extracts answer letter from Google meta text by:
    // 1. Explicit "alternativa correta é a C" / "Letra C" patterns
    // 2. Content match against user's option bodies
    _parseGoogleMetaText(text, originalOptionsMap, originalOptions) {
        if (!text || text.length < 15) return null;

        // Strategy 1: Explicit letter mention
        const explicitPatterns = [
            /(?:alternativa|resposta|gabarito|letra|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi,
            /\b([A-E])\s*[\)\.\-:]\s*(?:[Nn][aã]o\s+exige|[Ee]xige|[Pp]ermite|[Rr]equere?|[Dd]efine|[Rr]epresenta)/gi,
            /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi,
            /(?:alternativa\s+correta\s+(?:[eéÉ]|seria)\s+(?:a\s+)?)([A-E])\b/gi
        ];
        const explicitHits = [];
        for (const re of explicitPatterns) {
            for (const m of text.matchAll(re)) {
                const letter = (m[1] || '').toUpperCase();
                if (/^[A-E]$/.test(letter)) explicitHits.push(letter);
            }
        }
        const uniqueExplicit = [...new Set(explicitHits)];
        if (uniqueExplicit.length === 1) {
            const letter = uniqueExplicit[0];
            // Verify the letter exists in user's options
            if (originalOptionsMap && originalOptionsMap[letter]) {
                return { letter, confidence: 0.88 };
            }
        }

        // Strategy 2: Check for "✅" or bold marker followed by letter
        const checkMarkPatterns = [
            /[✅✓☑]\s*(?:alternativa\s+|letra\s+)?([A-E])\b/gi,
            /(?:correta|certa|right|correct)\s*[:\-–]?\s*(?:alternativa\s+|letra\s+)?([A-E])\b/gi
        ];
        for (const re of checkMarkPatterns) {
            const matches = [...text.matchAll(re)].map(m => (m[1] || '').toUpperCase()).filter(l => /^[A-E]$/.test(l));
            const unique = [...new Set(matches)];
            if (unique.length === 1 && originalOptionsMap?.[unique[0]]) {
                return { letter: unique[0], confidence: 0.85 };
            }
        }

        // Strategy 3: Content-match — find which user option body is best contained in the text
        if (originalOptionsMap && Object.keys(originalOptionsMap).length >= 2) {
            const normText = this._normalizeOption(text);
            let bestLetter = null;
            let bestScore = 0;
            let bestMethod = '';

            for (const [letter, body] of Object.entries(originalOptionsMap)) {
                const normBody = this._normalizeOption(body);
                if (!normBody || normBody.length < 8) continue;

                // Containment check
                if (normText.includes(normBody)) {
                    const score = normBody.length;
                    if (score > bestScore) {
                        bestScore = score;
                        bestLetter = letter;
                        bestMethod = 'containment';
                    }
                    continue;
                }

                // Dice similarity for partial matches
                const dice = this._diceSimilarity(normText, normBody);
                // Only match on high Dice (the text should strongly talk about one option)
                if (dice >= 0.65 && dice * 100 > bestScore) {
                    bestScore = dice * 100;
                    bestLetter = letter;
                    bestMethod = 'dice';
                }
            }

            if (bestLetter) {
                const conf = bestMethod === 'containment' ? 0.82 : 0.68;
                console.log(`SearchService: [google-meta] Content-match: letter=${bestLetter} method=${bestMethod} score=${bestScore}`);
                return { letter: bestLetter, confidence: conf };
            }
        }

        // Strategy 4: Fallback — try _parseAnswerLetter on the raw text
        const parsedLetter = this._parseAnswerLetter(text);
        if (parsedLetter && originalOptionsMap?.[parsedLetter]) {
            return { letter: parsedLetter, confidence: 0.70 };
        }

        return null;
    },
    // Parses A) / B) / C) options from source text and returns {letter: body} map.
    _buildSourceOptionsMapFromText(sourceText) {
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
                if (/^(?:\d{1,3}\s*[\)\.\-:]|Aula\s+\d|Quest[a\u00e3]o\s+\d|Pergunta\s+\d)/i.test(trimmed)) {
                    flush();
                    currentLetter = null;
                    currentParts = [];
                } else {
                    currentParts.push(trimmed);
                }
            }
        }
        flush();
        return map;
    },

    // ▸▸▸ LETTER REMAPPING FOR SHUFFLED OPTIONS ▸▸▸
    // Smart-join PDF fragment texts: detects mid-word breaks (caused by
    // <span class="blank"> spacers) and joins WITHOUT a space when the
    // previous fragment ends with a letter and the next starts lowercase.
    _joinPdfFragments(frags) {
        if (!frags || frags.length === 0) return '';
        let result = frags[0].text || '';
        for (let i = 1; i < frags.length; i++) {
            const t = frags[i].text || '';
            if (!t) continue;
            const prevChar = result.slice(-1);
            const nextChar = t.charAt(0);
            // Mid-word: prev ends with a letter and next starts with lowercase letter
            const isMidWord = /[a-z\u00e0-\u00fc]/i.test(prevChar)
                && /[a-z\u00e0-\u00fc]/.test(nextChar);
            result += isMidWord ? t : ' ' + t;
        }
        return result.replace(/\s+/g, ' ').trim();
    },

    // Content-based verification: after remapping, verify the highlighted text
    // actually matches the user's option at the resulting letter.
    // Returns { confidence, letter } — if the highlighted text doesn't match ANY
    // user option, returns null (reject the signal — wrong question anchored).
    // If it matches a DIFFERENT user option than remappedLetter, returns the correct one.
    _verifyHighlightMatch(rawLetter, remappedLetter, sourceOptionsMap, userOptionsMap, baseConfidence) {
        const highlightedText = (sourceOptionsMap || {})[rawLetter] || '';
        if (!highlightedText || highlightedText.length < 5) {
            console.log(`    [verify] SKIP: no highlighted text for raw letter ${rawLetter}`);
            return { confidence: baseConfidence, letter: remappedLetter };
        }
        if (!userOptionsMap || Object.keys(userOptionsMap).length < 2) {
            return { confidence: baseConfidence, letter: remappedLetter };
        }

        const normH = this._normalizeOption(highlightedText).replace(/\s+/g, '');
        console.log(`    [verify] highlighted text for ${rawLetter}: "${highlightedText.slice(0, 100)}"`);

        // Check the highlighted text against ALL user options, not just the remapped one.
        let bestMatchLetter = null;
        let bestMatchScore = 0;
        for (const [userLetter, userBody] of Object.entries(userOptionsMap)) {
            const normU = this._normalizeOption(userBody).replace(/\s+/g, '');
            if (!normU || normU.length < 5) continue;
            const skelContains = normH.includes(normU) || normU.includes(normH);
            const skelDice = this._diceSimilarity(normH, normU);
            const score = skelContains ? (1000 + Math.min(normH.length, normU.length)) : skelDice;
            if (score > bestMatchScore) {
                bestMatchScore = score;
                bestMatchLetter = userLetter;
            }
            if (skelContains || skelDice >= 0.50) {
                console.log(`    [verify]   user ${userLetter}) ${skelContains ? 'CONTAINS' : 'Dice=' + skelDice.toFixed(3)} "${userBody.slice(0, 60)}"`);
            }
        }

        // Case 1: highlighted text matches a user option well
        if (bestMatchLetter && bestMatchScore >= 0.55) {
            if (bestMatchLetter !== remappedLetter) {
                console.log(`    [verify] ✅ CONTENT OVERRIDE: remapped was ${remappedLetter} but highlighted text matches user ${bestMatchLetter} (score=${bestMatchScore >= 1000 ? 'contains' : bestMatchScore.toFixed(3)})`);
            } else {
                console.log(`    [verify] ✅ CONFIRMED: highlighted text matches user ${bestMatchLetter} (score=${bestMatchScore >= 1000 ? 'contains' : bestMatchScore.toFixed(3)})`);
            }
            return { confidence: baseConfidence, letter: bestMatchLetter };
        }

        // Case 2: highlighted text doesn't match ANY user option → wrong question
        console.log(`    [verify] ❌ REJECTED: highlighted text matches NO user option (bestScore=${bestMatchScore.toFixed(3)} best=${bestMatchLetter}). Anchor likely on wrong question.`);
        return null;
    },

    // When a source has the same question but with options in a different order,
    // remap the source's letter to the user's letter by matching option text content.
    _remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap) {
        if (!sourceLetter || !sourceOptionsMap || !userOptionsMap) {
            console.log(`    [remap] SKIP: missing data (letter=${sourceLetter} srcOpts=${Object.keys(sourceOptionsMap||{}).length} userOpts=${Object.keys(userOptionsMap||{}).length})`);
            return sourceLetter;
        }
        const userEntries = Object.entries(userOptionsMap);
        if (userEntries.length < 2) {
            console.log(`    [remap] SKIP: too few user options (${userEntries.length})`);
            return sourceLetter;
        }
        if (Object.keys(sourceOptionsMap).length < 2) {
            console.log(`    [remap] SKIP: too few source options (${Object.keys(sourceOptionsMap).length})`);
            return sourceLetter;
        }
        const sourceBody = sourceOptionsMap[sourceLetter];
        if (!sourceBody || sourceBody.length < 5) {
            console.log(`    [remap] SKIP: source letter ${sourceLetter} has no body in sourceOptionsMap (keys=${Object.keys(sourceOptionsMap).join(',')})`);
            return sourceLetter;
        }
        console.log(`    [remap] Source letter=${sourceLetter} body="${sourceBody.slice(0, 80)}"`);
        const normSource = this._normalizeOption(sourceBody);
        if (!normSource) return sourceLetter;
        // Skeleton = space-stripped version. PDF fragments often break words
        // with <span class="blank"> spacers ("relacion al" instead of "relacional").
        // Stripping ALL spaces makes the comparison immune to these artifacts.
        const skeletonSource = normSource.replace(/\s+/g, '');
        // Always search ALL user options to find the best text match.
        // No early-exit alignment check — options like "Exige a definição..."
        // and "Não exige a predefinição..." have high Dice (~0.93) but are
        // completely different options.  The full search reliably picks the
        // correct match because the TRUE match has Dice 1.0 or containment.
        let bestLetter = null;
        let bestScore = 0;
        for (const [userLetter, userBody] of userEntries) {
            const normUser = this._normalizeOption(userBody);
            if (!normUser) continue;
            // --- Layer 1: normal containment ---
            const containsFwd = normSource.includes(normUser);
            const containsRev = normUser.includes(normSource);
            if (containsFwd || containsRev) {
                const score = Math.min(normSource.length, normUser.length) + 1000;
                console.log(`    [remap]   user ${userLetter}) CONTAINS match (fwd=${containsFwd} rev=${containsRev}) score=${score} body="${userBody.slice(0, 60)}"`);
                if (score > bestScore) { bestScore = score; bestLetter = userLetter; }
                continue;
            }
            // --- Layer 2: normal Dice similarity ---
            const sim = this._diceSimilarity(normSource, normUser);
            if (sim >= 0.70) {
                const score = sim * normUser.length;
                console.log(`    [remap]   user ${userLetter}) Dice=${sim.toFixed(3)} MATCH score=${score.toFixed(1)} body="${userBody.slice(0, 60)}"`);
                if (score > bestScore) { bestScore = score; bestLetter = userLetter; }
                continue;
            }
            // --- Layer 3: skeleton (space-stripped) comparison ---
            // Handles PDF text artifacts where words are broken by blank spans.
            const skeletonUser = normUser.replace(/\s+/g, '');
            const skelContainsFwd = skeletonSource.includes(skeletonUser);
            const skelContainsRev = skeletonUser.includes(skeletonSource);
            if (skelContainsFwd || skelContainsRev) {
                const score = Math.min(skeletonSource.length, skeletonUser.length) + 900;
                console.log(`    [remap]   user ${userLetter}) SKELETON-CONTAINS match (fwd=${skelContainsFwd} rev=${skelContainsRev}) score=${score} body="${userBody.slice(0, 60)}"`);
                if (score > bestScore) { bestScore = score; bestLetter = userLetter; }
                continue;
            }
            const skelSim = this._diceSimilarity(skeletonSource, skeletonUser);
            if (skelSim >= 0.70) {
                const score = skelSim * skeletonUser.length * 0.95;
                console.log(`    [remap]   user ${userLetter}) SKELETON-Dice=${skelSim.toFixed(3)} MATCH score=${score.toFixed(1)} body="${userBody.slice(0, 60)}"`);
                if (score > bestScore) { bestScore = score; bestLetter = userLetter; }
                continue;
            }
            // Log near-misses for debugging
            const bestSim = Math.max(sim, skelSim);
            if (bestSim >= 0.45) {
                console.log(`    [remap]   user ${userLetter}) NEAR-MISS Dice=${sim.toFixed(3)} skelDice=${skelSim.toFixed(3)} body="${userBody.slice(0, 60)}"`);
            }
        }
        if (bestLetter && bestLetter !== sourceLetter) {
            console.log(`    [remap] REMAPPED: ${sourceLetter} \u2192 ${bestLetter} (source="${sourceBody.slice(0, 60)}" \u2192 user="${userOptionsMap[bestLetter]?.slice(0, 60)}")`);
            return bestLetter;
        }
        console.log(`    [remap] NO CHANGE: best=${bestLetter || 'none'} === source=${sourceLetter}`);
        return bestLetter || sourceLetter;
    },

    _remapLetterIfShuffled(sourceLetter, sourceText, userOptionsMap) {
        if (!sourceLetter || !sourceText || !userOptionsMap) return sourceLetter;
        if (Object.keys(userOptionsMap).length < 2) return sourceLetter;
        const sourceOptionsMap = this._buildSourceOptionsMapFromText(sourceText);
        console.log(`    [remapIfShuffled] letter=${sourceLetter} sourceTextLen=${sourceText.length} sourceOpts=${Object.keys(sourceOptionsMap).length} keys=[${Object.keys(sourceOptionsMap).join(',')}]`);
        if (Object.keys(sourceOptionsMap).length >= 2) {
            for (const [k, v] of Object.entries(sourceOptionsMap)) {
                console.log(`      src ${k}) "${v.slice(0, 70)}"`);
            }
        }
        if (Object.keys(sourceOptionsMap).length < 2) {
            console.log(`    [remapIfShuffled] SKIP: not enough source options parsed from text`);
            return sourceLetter;
        }
        return this._remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap);
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

    async _storageLocalGet(keys) {
        try {
            if (typeof chrome === 'undefined' || !chrome?.storage?.local) return {};
            return await chrome.storage.local.get(keys);
        } catch {
            return {};
        }
    },

    async _storageLocalSet(payload) {
        try {
            if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
            await chrome.storage.local.set(payload);
        } catch {
            // no-op
        }
    },

    async _getDecisionCacheBucket() {
        const data = await this._storageLocalGet([this._SEARCH_CACHE_KEY]);
        const bucket = data?.[this._SEARCH_CACHE_KEY];
        return (bucket && typeof bucket === 'object') ? bucket : {};
    },

    async _setDecisionCacheBucket(bucket) {
        const safeBucket = bucket && typeof bucket === 'object' ? bucket : {};
        await this._storageLocalSet({ [this._SEARCH_CACHE_KEY]: safeBucket });
    },

    async clearSearchCache(options = {}) {
        const { keepMetrics = true } = options || {};
        const payload = { [this._SEARCH_CACHE_KEY]: {} };
        if (!keepMetrics) payload[this._SEARCH_METRICS_KEY] = {};
        await this._storageLocalSet(payload);
    },

    async _getCachedDecisionForFingerprint(questionFingerprint) {
        if (!questionFingerprint) return null;
        const bucket = await this._getDecisionCacheBucket();
        const entry = bucket?.[questionFingerprint];
        if (!entry || typeof entry !== 'object') return null;
        const age = Date.now() - Number(entry.updatedAt || 0);
        if (!Number.isFinite(age) || age < 0 || age > this._CACHE_MAX_AGE_MS) return null;
        const decision = entry.decision;
        if (!decision || decision.resultState !== 'confirmed') return null;
        if (decision.evidenceTier !== 'EVIDENCE_STRONG') return null;
        return decision;
    },

    _sanitizeSourcesForCache(sources = []) {
        return (sources || [])
            .slice(0, 8)
            .map((s) => ({
                title: String(s?.title || ''),
                link: String(s?.link || ''),
                hostHint: String(s?.hostHint || ''),
                evidenceType: String(s?.evidenceType || ''),
                letter: String(s?.letter || ''),
                weight: Number(s?.weight || 0)
            }))
            .filter((s) => s.link || s.hostHint || s.letter);
    },

    async _setCachedDecisionForFingerprint(questionFingerprint, resultItem, sources = []) {
        if (!questionFingerprint || !resultItem) return;
        const bucket = await this._getDecisionCacheBucket();
        const now = Date.now();
        const sourceLinks = (sources || [])
            .map((s) => String(s?.link || '').trim())
            .filter(Boolean)
            .slice(0, 12);

        bucket[questionFingerprint] = {
            updatedAt: now,
            decision: {
                answer: String(resultItem.answer || ''),
                answerLetter: String(resultItem.answerLetter || ''),
                answerText: String(resultItem.answerText || ''),
                bestLetter: String(resultItem.bestLetter || ''),
                votes: resultItem.votes || {},
                baseVotes: resultItem.baseVotes || {},
                evidenceVotes: resultItem.evidenceVotes || {},
                confidence: Number(resultItem.confidence || 0),
                resultState: String(resultItem.resultState || 'inconclusive'),
                reason: String(resultItem.reason || 'inconclusive'),
                evidenceTier: String(resultItem.evidenceTier || 'EVIDENCE_WEAK'),
                evidenceConsensus: resultItem.evidenceConsensus || {},
                questionPolarity: String(resultItem.questionPolarity || 'CORRECT'),
                sources: this._sanitizeSourcesForCache(sources)
            },
            sourceLinks
        };

        const keys = Object.keys(bucket);
        if (keys.length > this._CACHE_MAX_ENTRIES) {
            keys
                .map((k) => ({ k, t: Number(bucket[k]?.updatedAt || 0) }))
                .sort((a, b) => a.t - b.t)
                .slice(0, keys.length - this._CACHE_MAX_ENTRIES)
                .forEach((entry) => { delete bucket[entry.k]; });
        }

        await this._setDecisionCacheBucket(bucket);
    },

    async _getCachedSourceLinks(questionFingerprint) {
        if (!questionFingerprint) return [];
        const bucket = await this._getDecisionCacheBucket();
        const entry = bucket?.[questionFingerprint];
        if (!entry) return [];
        const sourceLinks = Array.isArray(entry.sourceLinks) ? entry.sourceLinks : [];
        return sourceLinks
            .map((l) => String(l || '').trim())
            .filter(Boolean)
            .slice(0, 12);
    },

    async _mergeCachedSourcesIntoResults(questionFingerprint, results = []) {
        const cachedLinks = await this._getCachedSourceLinks(questionFingerprint);
        if (!cachedLinks || cachedLinks.length === 0) return results || [];

        const merged = new Map();
        for (const item of (results || [])) {
            const link = String(item?.link || '').trim();
            if (!link) continue;
            if (!merged.has(link)) merged.set(link, item);
        }
        for (const link of cachedLinks) {
            if (merged.has(link)) continue;
            merged.set(link, {
                title: 'Cached source',
                snippet: '',
                link,
                fromCache: true
            });
        }
        return Array.from(merged.values());
    },

    _buildResultFromCachedDecision(questionText, questionForInference, cachedDecision) {
        const answerLetter = String(cachedDecision?.answerLetter || cachedDecision?.bestLetter || '').toUpperCase();
        const answerText = String(cachedDecision?.answerText || '').trim();
        const answer = String(cachedDecision?.answer || '').trim()
            || (answerLetter ? `Letra ${answerLetter}: ${answerText}`.trim() : '');

        return [{
            question: questionText,
            answer,
            answerLetter,
            answerText,
            sources: Array.isArray(cachedDecision?.sources) ? cachedDecision.sources : [],
            bestLetter: String(cachedDecision?.bestLetter || answerLetter || ''),
            votes: cachedDecision?.votes || {},
            baseVotes: cachedDecision?.baseVotes || {},
            evidenceVotes: cachedDecision?.evidenceVotes || {},
            evidenceConsensus: cachedDecision?.evidenceConsensus || {},
            confidence: Number(cachedDecision?.confidence || 0.9),
            resultState: String(cachedDecision?.resultState || 'confirmed'),
            reason: String(cachedDecision?.reason || 'confirmed_by_sources'),
            evidenceTier: String(cachedDecision?.evidenceTier || 'EVIDENCE_STRONG'),
            questionPolarity: String(
                cachedDecision?.questionPolarity
                || this._detectQuestionPolarity(this._extractQuestionStem(questionForInference || questionText))
            ),
            title: 'Cached verified result',
            aiFallback: false,
            cacheHit: true,
            runStats: {
                analyzed: 0,
                acceptedForVotes: 0,
                acceptedForAiEvidence: 0,
                blockedPaywall: 0,
                blockedObfuscation: 0,
                blockedOptionsMismatch: 0,
                blockedSnapshotMismatch: 0,
                blockedByError: 0
            }
        }];
    },

    async _recordSearchMetrics(payload = {}) {
        const {
            cacheHit = false,
            outcome = 'finished',
            resultState = 'inconclusive',
            evidenceTier = 'EVIDENCE_WEAK',
            runStats = null,
            bestLetter = '',
            confidence = 0
        } = payload;
        try {
            const data = await this._storageLocalGet([this._SEARCH_METRICS_KEY]);
            const metrics = data?.[this._SEARCH_METRICS_KEY] || {
                totalRuns: 0,
                cacheHits: 0,
                outcomes: {},
                resultStates: {},
                evidenceTiers: {},
                blocked: {
                    paywall: 0,
                    obfuscation: 0,
                    optionsMismatch: 0,
                    snapshotMismatch: 0,
                    errors: 0
                },
                lastRuns: []
            };

            metrics.totalRuns += 1;
            if (cacheHit) metrics.cacheHits += 1;
            metrics.outcomes[outcome] = (metrics.outcomes[outcome] || 0) + 1;
            metrics.resultStates[resultState] = (metrics.resultStates[resultState] || 0) + 1;
            metrics.evidenceTiers[evidenceTier] = (metrics.evidenceTiers[evidenceTier] || 0) + 1;

            if (runStats) {
                metrics.blocked.paywall += Number(runStats.blockedPaywall || 0);
                metrics.blocked.obfuscation += Number(runStats.blockedObfuscation || 0);
                metrics.blocked.optionsMismatch += Number(runStats.blockedOptionsMismatch || 0);
                metrics.blocked.snapshotMismatch += Number(runStats.blockedSnapshotMismatch || 0);
                metrics.blocked.errors += Number(runStats.blockedByError || 0);
            }

            metrics.lastRuns.push({
                at: Date.now(),
                outcome,
                cacheHit: !!cacheHit,
                resultState,
                evidenceTier,
                bestLetter: String(bestLetter || ''),
                confidence: Number(confidence || 0),
                analyzed: Number(runStats?.analyzed || 0),
                acceptedVotes: Number(runStats?.acceptedForVotes || 0),
                acceptedAi: Number(runStats?.acceptedForAiEvidence || 0)
            });

            if (metrics.lastRuns.length > 120) {
                metrics.lastRuns = metrics.lastRuns.slice(metrics.lastRuns.length - 120);
            }

            metrics.updatedAt = Date.now();
            await this._storageLocalSet({ [this._SEARCH_METRICS_KEY]: metrics });
        } catch {
            // no-op
        }
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

    _buildQuestionScopedText(sourceText, questionText, maxChars = 3200) {
        const raw = String(sourceText || '').trim();
        if (!raw) return '';
        const block = this._findQuestionBlock(raw, questionText);
        if (block?.text && block.text.length >= 120) {
            return block.text.slice(0, maxChars);
        }
        return raw.slice(0, maxChars);
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
                matches.push({ letter, confidence, matchLabel: label, index: m.index, questionPolarity });
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
        // 1) Try explicit gabarito patterns first (uploaded answer keys, Brainly, etc.)
        const gabarito = this._extractExplicitGabarito(searchText, questionText);
        if (gabarito) {
            return { ...gabarito, evidenceType: 'explicit-gabarito', blockMethod: block?.method || 'full-text' };
        }
        // 2) Try explanation-to-option content matching
        const explanationMatch = this._matchExplanationToOption(searchText, questionText, originalOptions);
        if (explanationMatch) {
            return { ...explanationMatch, evidenceType: 'explanation-content-match', blockMethod: block?.method || 'full-text' };
        }
        return null;
    },

    /**
     * Explanation-to-option content matching.
     * Many educational sources contain explanatory text AFTER the question that describes
     * WHY a given option is correct, without explicitly stating "Gabarito: X".
     * This method extracts such explanation blocks and matches them back to the user's options
     * using keyword/concept overlap.
     *
     * Example: "...devido ao fato de que seu suporte ao processamento não segue o modelo
     * clássico de transações..." → matches option E: "Ter suporte de transações diferente do relacional"
     */
    _matchExplanationToOption(sourceText, questionText, originalOptions) {
        if (!sourceText || !originalOptions || originalOptions.length < 2) return null;
        const questionStem = this._extractQuestionStem(questionText);
        const stemTokens = this._extractKeyTokens(questionStem);
        if (stemTokens.length < 2) return null;

        // Build options map from originalOptions
        const optionsMap = {};
        for (const opt of originalOptions) {
            const m = opt.match(/^([A-E])\)\s*(.*)/i);
            if (m) optionsMap[m[1].toUpperCase()] = m[2].trim();
        }
        if (Object.keys(optionsMap).length < 2) return null;

        // Find the question block in the source text
        const block = this._findQuestionBlock(sourceText, questionText);
        const searchText = block ? block.text : sourceText;

        // Find the end of the options area (after the last option letter)
        const lastOptPattern = /(?:^|\n)\s*[eE]\s*[\)\.\-:]\s*.{5,}/m;
        const lastOptMatch = lastOptPattern.exec(searchText);
        if (!lastOptMatch) return null;

        const explanationStart = lastOptMatch.index + lastOptMatch[0].length;
        const explanationText = searchText.slice(explanationStart, explanationStart + 2000).trim();
        if (explanationText.length < 80) return null;

        // Check that the explanation is actually about the question topic
        const explNorm = this._normalizeOption(explanationText);
        const topicHits = this._countTokenHits(explNorm, stemTokens);
        if (topicHits < Math.min(2, stemTokens.length)) return null;

        console.log(`    [expl-match] Explanation text found (${explanationText.length} chars), topicHits=${topicHits}/${stemTokens.length}`);

        // For each option, compute how strongly the explanation text mentions its key concepts
        const scores = {};
        for (const [letter, body] of Object.entries(optionsMap)) {
            const optNorm = this._normalizeOption(body);
            const optTokens = optNorm.split(/\s+/).filter(t => t.length >= 3);
            if (optTokens.length === 0) { scores[letter] = 0; continue; }

            // Count how many option-specific tokens appear in the explanation
            let tokenHits = 0;
            for (const tok of optTokens) {
                if (explNorm.includes(tok)) tokenHits++;
            }
            const tokenRatio = tokenHits / optTokens.length;

            // Also compute Dice similarity between explanation and option
            const dice = this._diceSimilarity(explNorm, optNorm);

            // Combined score: token overlap ratio + Dice similarity
            scores[letter] = (tokenRatio * 0.6) + (dice * 0.4);
            console.log(`    [expl-match] ${letter}) tokenHits=${tokenHits}/${optTokens.length} dice=${dice.toFixed(3)} score=${scores[letter].toFixed(3)} body="${body.slice(0, 60)}"`);
        }

        // Find best and second-best
        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        if (sorted.length < 2) return null;
        const [bestLetter, bestScore] = sorted[0];
        const [, secondScore] = sorted[1];

        // Require minimum score AND clear margin over second-best
        const margin = bestScore - secondScore;
        console.log(`    [expl-match] best=${bestLetter} score=${bestScore.toFixed(3)} second=${secondScore.toFixed(3)} margin=${margin.toFixed(3)}`);

        if (bestScore < 0.25 || margin < 0.08) {
            console.log(`    [expl-match] REJECTED: score too low or margin too small`);
            return null;
        }

        // Compute confidence based on score strength and margin
        const confidence = Math.min(0.88, 0.60 + (bestScore * 0.2) + (margin * 0.3));
        console.log(`    [expl-match] ACCEPTED: letter=${bestLetter} confidence=${confidence.toFixed(2)}`);

        return {
            letter: bestLetter,
            confidence,
            matchLabel: 'explanation-content-match',
            evidence: explanationText.slice(0, 500)
        };
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
                // Hard integrity guard: if alternatives in the evidence window do not align,
                // the source cannot emit an explicit letter.
                if (!this._optionsMatchInFreeText(originalOptions, window)) {
                    continue;
                }
            }

            return { letter, confidence: 0.9, evidence: window };
        }

        return null;
    },

    _parseHtmlDomWithEmbeddedFallback(html) {
        if (!html || html.length < 200) return { doc: null, nodes: [] };
        const rawHtml = String(html || '');
        const sanitizeHtmlForParsing = (input) => String(input || '')
            // Avoid CSP noise and risky parsing side-effects from third-party active content.
            // Remove ALL script blocks: paired, self-closing, unclosed, and JSON-embedded
            .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
            .replace(/<script\b[^>]*\/?>/gi, ' ')
            .replace(/<script\b[\s\S]*?(?=<(?:\/head|\/body|!--|meta|link))/gi, ' ')
            .replace(/<\s*script\b[\s\S]*$/gi, ' ')
            .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<noscript\b[^>]*\/?>/gi, ' ')
            .replace(/<\s*noscript\b[\s\S]*$/gi, ' ')
            .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
            .replace(/<iframe\b[^>]*\/?>/gi, ' ')
            .replace(/<\s*iframe\b[\s\S]*$/gi, ' ')
            .replace(/<object\b[\s\S]*?<\/object>/gi, ' ')
            .replace(/<\s*object\b[\s\S]*$/gi, ' ')
            .replace(/<embed\b[^>]*>/gi, ' ')
            .replace(/<link\b[^>]*>/gi, ' ')
            // Remove anti-bot / captcha domains in ALL encoding forms
            .replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, ' ')
            .replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.captcha-display\.com(?:\/|\\?\/)[^\s"'<>]*/gi, ' ')
            .replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)(?:api-js\.)?datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, ' ')
            .replace(/datadome\.co/gi, ' ')
            .replace(/captcha-display\.com/gi, ' ');

        let doc = null;
        let nodes = [];
        const safeHtml = sanitizeHtmlForParsing(rawHtml);
        try {
            doc = new DOMParser().parseFromString(safeHtml, 'text/html');
            nodes = Array.from(doc.querySelectorAll('div.t'));
        } catch {
            return { doc: null, nodes: [] };
        }

        // Some pages embed PDF-like html as escaped JSON (\u003cdiv ...).
        const embeddedSource = rawHtml.includes('\\u003cdiv') ? rawHtml : safeHtml;
        if (nodes.length < 50 && embeddedSource.includes('\\u003cdiv')) {
            const idx = embeddedSource.indexOf('\\u003cdiv');
            const slice = embeddedSource.slice(idx, Math.min(embeddedSource.length, idx + 650000));
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
                consonantRunRatio: 0,
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
                consonantRunRatio: 0,
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
        // Proportional consonant-run check: avoid false positives on pages with normal
        // vowel ratios (Portuguese ≈ 0.45) where a few CSS class names or encoded tokens
        // happen to contain long consonant sequences.
        const consonantRunRatio = relevantWords.length > 0 ? longConsonantRuns / relevantWords.length : 0;
        const isObfuscated = (vowelRatio < 0.24 && junkRatio >= 0.28)
            || (longConsonantRuns >= 8 && vowelRatio < 0.34 && consonantRunRatio >= 0.10);
        return {
            isObfuscated,
            normalizedLength: normalized.length,
            vowelRatio,
            junkRatio,
            longConsonantRuns,
            consonantRunRatio,
            relevantWordCount: relevantWords.length
        };
    },

    _paywallSignals(html, text = '', hostHint = '') {
        const h = String(html || '').toLowerCase();
        const t = this._normalizeOption(text || '');
        if (!h && !t) {
            return { isPaywalled: false, markerHits: 0, riskyHost: false };
        }

        const markers = [
            /voce\s+esta\s+vendo\s+uma\s+previa/i,
            /desbloqueie/i,
            /seja\s+premium/i,
            /torne[\s-]*se\s+premium/i,
            /documento\s+premium/i,
            /conteudos?\s+liberados/i,
            /teste\s+gratis/i,
            /upload\s+para\s+desbloquear/i,
            // Note: /paywall/i and /filter:blur/ removed — they match CSS classes/styles
            // on content divs where the actual text IS readable in the DOM.
            /short-preview-version/i,
            /limitation-blocked/i,
            /paywall-structure/i,
            /mv-content-limitation-fake-page/i,
            /new-monetization-test-paywall/i
        ];

        let markerHits = 0;
        for (const re of markers) {
            if (re.test(h) || re.test(t)) markerHits += 1;
        }

        const host = String(hostHint || '').toLowerCase();
        const riskyHost =
            host === 'passeidireto.com'
            || host === 'studocu.com'
            || host === 'scribd.com'
            || host === 'pt.scribd.com'
            || host === 'brainly.com'
            || host === 'brainly.com.br';

        const isPaywalled = riskyHost ? markerHits >= 2 : markerHits >= 3;
        return { isPaywalled, markerHits, riskyHost };
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
            ? `yes(vr=${(diag.obfuscation.vowelRatio || 0).toFixed(2)},jr=${(diag.obfuscation.junkRatio || 0).toFixed(2)},cr=${(diag.obfuscation.consonantRunRatio || 0).toFixed(3)},lcr=${diag.obfuscation.longConsonantRuns || 0})`
            : 'no';
        const paywall = diag.paywall?.isPaywalled
            ? `yes(m=${diag.paywall.markerHits || 0})`
            : 'no';
        const reason = diag.reason ? ` reason=${diag.reason}` : '';
        const decision = diag.decision ? ` decision=${diag.decision}` : '';
        const method = diag.method ? ` method=${diag.method}` : '';
        const letter = diag.letter ? ` letter=${diag.letter}` : '';
        const textLen = Number.isFinite(diag.textLength) ? ` text=${diag.textLength}` : '';
        console.log(`SearchService: SourceDiag[${phase}] host=${host} type=${type} sim=${sim} opts=${opts} obf=${obf} pw=${paywall}${textLen}${decision}${method}${letter}${reason}`);
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
        console.log(`    [answercard] containers found: ${containers.length}`);
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
            const letterSource = explicit?.letter ? 'explicit' : 'text-match';
            if (!letter) letter = this._findLetterByAnswerText(text, originalOptionsMap);
            if (!letter) continue;

            const confidence = explicit?.letter ? 0.9 : 0.82;
            const score = confidence + (sim * 0.6);
            console.log(`    [answercard] candidate: letter=${letter} via=${letterSource} sim=${sim.toFixed(3)} score=${score.toFixed(3)} preview="${text.slice(0, 120)}"`);
            candidates.push({
                letter,
                confidence,
                method: 'answercard-ql',
                evidence: text.slice(0, 900),
                matchQuality: sim,
                _score: score
            });
        }

        console.log(`    [answercard] total candidates: ${candidates.length}`);
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b._score - a._score);
        console.log(`    [answercard] WINNER: letter=${candidates[0].letter} sim=${candidates[0].matchQuality.toFixed(3)} score=${candidates[0]._score.toFixed(3)}`);
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
        if (!html || html.length < 500) {
            console.log(`    [Structured] Skipped: html too short (${(html || '').length})`);
            return null;
        }

        const parsed = diagnosticsCtx?.parsed || this._parseHtmlDomWithEmbeddedFallback(html);
        const type = diagnosticsCtx?.type || this._detectStructuredHtmlType(html, parsed.doc);

        // Ignore heavily obfuscated pages unless we still found explicit anchors later.
        const docText = this._extractDocText(parsed.doc);
        const obfuscation = diagnosticsCtx?.obfuscation || this._obfuscationSignals(docText);
        const paywall = diagnosticsCtx?.paywall || this._paywallSignals(html, docText, hostHint);
        const maybeObfuscated = !!obfuscation?.isObfuscated;

        console.log(`    [Structured] host=${hostHint} type=${type} paywall=${paywall?.isPaywalled} softPassed=${paywall?.softPassed || false} obfuscated=${maybeObfuscated}`);

        if (paywall?.isPaywalled) {
            console.log(`    [Structured] \u26d4 Blocked by paywall check inside _extractStructuredEvidenceFromHtml`);
            return { skip: true, reason: 'paywall-overlay', diagnostics: { type, obfuscation, paywall } };
        }

        if (type === 'TYPE_PD_PDF_HTML' || hostHint === 'passeidireto.com' || hostHint === 'studocu.com') {
            const byAnchor = this._extractPdfLikeAnswerByAnchors(html, questionForInference, questionStem, originalOptionsMap, originalOptions);
            console.log(`    [Structured] PDF anchor: letter=${byAnchor?.letter || 'none'} method=${byAnchor?.method || 'none'}`);
            if (byAnchor?.letter) {
                return {
                    ...byAnchor,
                    evidenceType: `${hostHint || 'pdf'}-${byAnchor.method || 'pdf-anchor'}-scoped`,
                    diagnostics: { type, obfuscation, paywall }
                };
            }
        }

        if (type === 'TYPE_PD_ANSWERCARD') {
            const byAnswerCard = this._extractAnswerCardEvidenceFromHtml(html, questionForInference, questionStem, originalOptionsMap, originalOptions);
            console.log(`    [Structured] AnswerCard: letter=${byAnswerCard?.letter || 'none'} method=${byAnswerCard?.method || 'none'}`);
            if (byAnswerCard?.letter) {
                return {
                    ...byAnswerCard,
                    evidenceType: `${hostHint || 'page'}-${byAnswerCard.method || 'answercard'}-scoped`,
                    diagnostics: { type, obfuscation, paywall }
                };
            }
        }

        const byGeneric = this._extractGenericAnchoredEvidenceFromHtml(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions);
        console.log(`    [Structured] Generic anchor: letter=${byGeneric?.letter || 'none'} method=${byGeneric?.method || 'none'}`);
        if (byGeneric?.letter) {
            return {
                ...byGeneric,
                evidenceType: `${hostHint || 'page'}-${byGeneric.method || 'generic-anchor'}-scoped`,
                diagnostics: { type, obfuscation, paywall }
            };
        }

        if (maybeObfuscated) {
            console.log(`    [Structured] No letter found + obfuscated \u2014 returning skip`);
            return { skip: true, reason: 'obfuscated_html', diagnostics: { type, obfuscation, paywall } };
        }
        console.log(`    [Structured] No letter found, no skip`);
        return { diagnostics: { type, obfuscation, paywall } };
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
        console.log(`    [ff1-highlight] tokens=${JSON.stringify(tokens)} bestIdx=${bestIdx} bestHits=${bestHits}/${tokens.length} minRequired=${minAnchorHits} totalFrags=${frags.length}`);
        if (bestIdx < 0 || bestHits < minAnchorHits) {
            console.log(`    [ff1-highlight] REJECTED: anchor not found (bestIdx=${bestIdx} bestHits=${bestHits} < ${minAnchorHits})`);
            return null;
        }

        const windowStart = Math.max(0, bestIdx - 80);
        const windowFrags = frags.slice(windowStart, Math.min(frags.length, bestIdx + 520));
        const windowText = windowFrags.map(f => f.text).join('\n');

        // Options evidence gate: require at least 2 option bodies present in this window.
        const optBodies = Object.values(originalOptionsMap || {}).map(v => this._normalizeOption(v)).filter(v => v.length >= 8);
        let optionHits = 0;
        const normWindow = this._normalizeOption(windowText);
        const optionHitDetails = [];
        for (const body of optBodies) {
            const hit = body && normWindow.includes(body);
            if (hit) optionHits += 1;
            optionHitDetails.push({ body: body?.slice(0, 50), hit: !!hit });
        }
        console.log(`    [ff1-highlight] optionHits=${optionHits}/${optBodies.length} windowLen=${windowText.length}`);
        console.log(`    [ff1-highlight] optionDetails:`, JSON.stringify(optionHitDetails));
        // Show anchor context to understand which question was found
        const anchorContextStart = Math.max(0, bestIdx - windowStart - 3);
        const anchorContextEnd = Math.min(windowFrags.length, bestIdx - windowStart + 8);
        const anchorContext = windowFrags.slice(anchorContextStart, anchorContextEnd).map(f => f.text).join(' | ');
        console.log(`    [ff1-highlight] anchorContext: "${anchorContext.slice(0, 300)}"`);

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

        // FIX: Clip option grouping to start near the anchor, NOT from the full
        // lookback window.  The -80 lookback is kept for context (options evidence
        // gate) but must NOT feed into option grouping, otherwise the PREVIOUS
        // question's highlighted answer contaminates the current question.
        // We scan backward from the anchor (max 15 frags) and stop at the nearest
        // question-start marker so we never cross a question boundary.
        const anchorOffset = bestIdx - windowStart;            // anchor position within windowFrags
        const maxGroupLookback = Math.min(anchorOffset, 15);   // cap backward scan
        let groupStartOffset = anchorOffset;                   // default: start at anchor
        for (let g = anchorOffset - 1; g >= anchorOffset - maxGroupLookback; g--) {
            if (g < 0) break;
            if (isNextQuestionMarker(windowFrags[g].text)) {
                groupStartOffset = g + 1;                      // don't include prev question marker
                break;
            }
            groupStartOffset = g;                              // extend backward tentatively
        }
        const groupingFrags = windowFrags.slice(groupStartOffset);

        for (const f of groupingFrags) {
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
        // FIX: Require at least 1 option-body match when the user's question has
        // known options.  The old code had a `letters.length < 4` loophole that
        // allowed a DIFFERENT question in the same PDF to pass (it had 5 option
        // letters A-E, but none of the user's actual option bodies).  Removing the
        // loophole ensures we only consider pages containing the user's exact
        // question+options.
        console.log(`    [ff1-highlight] groups found: ${letters.join(',')} (${letters.length} letters)`);
        for (const [gl, gf] of Object.entries(groups)) {
            const bodyPreview = gf.map(f => f.text).join(' ').slice(0, 100);
            const ffClasses = gf.map(f => f.cls).join(' ').match(/ff\d+/g) || [];
            console.log(`    [ff1-highlight]   ${gl}) "${bodyPreview}" ffClasses=[${[...new Set(ffClasses)].join(',')}]`);
        }
        if (originalOptions && originalOptions.length >= 2 && optionHits < 1) {
            console.log(`    [ff1-highlight] REJECTED: 0 option-body matches in window (letters=${letters.length})`);
            return null;
        }

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
                    if (!/^(ff|fs|fc|sc|ls)\d+$/i.test(token)) continue;
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

        // Build source options map from groups for shuffled-option remapping.
        // Use smart fragment joining to avoid broken words from blank-span spacers.
        const sourceOptionsFromGroups = {};
        for (const [gl, gParts] of Object.entries(groups)) {
            const gBody = this._joinPdfFragments(gParts)
                .replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '').trim();
            if (gBody.length >= 5) sourceOptionsFromGroups[gl] = gBody;
        }
        console.log(`    [ff1-highlight] sourceOptionsFromGroups (for remap):`);
        for (const [gl, gb] of Object.entries(sourceOptionsFromGroups)) {
            console.log(`      src ${gl}) "${gb.slice(0, 100)}"`);
        }
        console.log(`    [ff1-highlight] userOptionsMap (for comparison):`);
        for (const [ul, ub] of Object.entries(originalOptionsMap || {})) {
            console.log(`      usr ${ul}) "${(ub || '').slice(0, 100)}"`);
        }
        console.log(`    [ff1-highlight] features per letter:`);

        // Strategy 1: classic ff1 highlight signal.
        let bestLetter = null;
        let bestScore = -1;
        let secondScore = -1;
        for (const [letter, feat] of Object.entries(featuresByLetter)) {
            const ffCls = [];
            for (const [tk, cnt] of feat.classTokenCounts.entries()) {
                if (/^ff\d+$/i.test(tk)) ffCls.push(`${tk}:${cnt}`);
            }
            console.log(`      ${letter}) ff1Hits=${feat.ff1Hits} blur=${feat.blurHits} clear=${feat.clearHits} frags=${feat.fragCount} ffClasses=[${ffCls.join(',')}]`);
            const score = feat.ff1Hits;
            if (score > bestScore) {
                secondScore = bestScore;
                bestScore = score;
                bestLetter = letter;
            } else if (score > secondScore) {
                secondScore = score;
            }
        }
        console.log(`    [ff1-highlight] Strategy1: bestLetter=${bestLetter} bestScore=${bestScore} secondScore=${secondScore}`);

        if (bestLetter && bestScore >= 1 && bestScore > secondScore) {
            console.log(`    [ff1-highlight] Strategy1 HIT: raw=${bestLetter} — calling remap...`);
            const remappedFf1 = this._remapLetterToUserOptions(bestLetter, sourceOptionsFromGroups, originalOptionsMap);
            console.log(`    [ff1-highlight] Strategy1 RESULT: raw=${bestLetter} remapped=${remappedFf1}`);
            const verified = this._verifyHighlightMatch(bestLetter, remappedFf1, sourceOptionsFromGroups, originalOptionsMap, 0.95);
            if (!verified) {
                console.log(`    [ff1-highlight] Strategy1 REJECTED by content verification — wrong question anchor`);
                // Don't return here — fall through to Strategy 1.5/2
            } else {
                return {
                    letter: verified.letter,
                    confidence: verified.confidence,
                    method: 'ff1-highlight',
                    evidence: `ff1_hits=${bestScore} window_tokens=${bestHits} option_hits=${optionHits}`
                };
            }
        }

        // Strategy 1.5: font-family outlier detection.
        // If most options share one dominant ff* class (e.g. ff3) but one option
        // has a DIFFERENT ff* class (e.g. ff2) unique to it, that option is highlighted.
        const ffCountsByLetter = {};
        const ffGlobalCounts = new Map();
        for (const [letter, feat] of Object.entries(featuresByLetter)) {
            const localFf = new Map();
            for (const [token, count] of feat.classTokenCounts.entries()) {
                if (!/^ff\d+$/i.test(token)) continue;
                localFf.set(token, count);
                ffGlobalCounts.set(token, (ffGlobalCounts.get(token) || 0) + count);
            }
            ffCountsByLetter[letter] = localFf;
        }

        let globalDominantFf = null;
        let globalDominantFfCount = 0;
        for (const [token, count] of ffGlobalCounts.entries()) {
            if (count > globalDominantFfCount) {
                globalDominantFfCount = count;
                globalDominantFf = token;
            }
        }

        if (globalDominantFf && letters.length >= 3) {
            const outliers = [];
            for (const letter of letters) {
                const localFf = ffCountsByLetter[letter];
                for (const [token, count] of localFf.entries()) {
                    if (token === globalDominantFf) continue;
                    // Must be unique to this option
                    const owners = tokenOwners.get(token);
                    if (owners && owners.size === 1 && count >= 1) {
                        outliers.push({ letter, token, count });
                    }
                }
            }

            if (outliers.length === 1) {
                const outlier = outliers[0];
                console.log(`SearchService: ff-outlier detected: letter=${outlier.letter} outlier_ff=${outlier.token} dominant_ff=${globalDominantFf}`);
                const remappedOutlier = this._remapLetterToUserOptions(outlier.letter, sourceOptionsFromGroups, originalOptionsMap);
                console.log(`    [ff-outlier] remap raw=${outlier.letter} → ${remappedOutlier}`);
                const outlierConf = this._verifyHighlightMatch(outlier.letter, remappedOutlier, sourceOptionsFromGroups, originalOptionsMap, 0.93);
                if (!outlierConf) {
                    console.log(`    [ff-outlier] REJECTED by content verification`);
                } else {
                    return {
                        letter: outlierConf.letter,
                        confidence: outlierConf.confidence,
                        method: 'ff-outlier',
                        evidence: `outlier_ff=${outlier.token} dominant_ff=${globalDominantFf} option_hits=${optionHits} window_tokens=${bestHits}`
                    };
                }
            }
        }

        // Strategy 2: CSS signature outlier between alternatives (encrypted/blurred pages).
        const signatureScores = {};
        for (const letter of letters) {
            const feat = featuresByLetter[letter];
            let uniqueTokenScore = 0;
            for (const [token, count] of feat.classTokenCounts.entries()) {
                const owners = tokenOwners.get(token);
                if (!owners || owners.size !== 1) continue;
                const base = token.startsWith('ff') ? 1.3 : token.startsWith('ls') ? 0.6 : 0.8;
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
        const strongOutlier = sigBestScore >= 1.8 && sigMargin >= 0.8;
        const permissiveOutlier = sigBestScore >= 2.4 && sigMargin >= 0.5 && optionHits >= 1;

        if (!hasReasonableSupport || (!strongOutlier && !permissiveOutlier)) return null;

        const remappedSig = this._remapLetterToUserOptions(sigBestLetter, sourceOptionsFromGroups, originalOptionsMap);
        console.log(`    [css-signature] remap raw=${sigBestLetter} → ${remappedSig}`);
        const sigConf = this._verifyHighlightMatch(sigBestLetter, remappedSig, sourceOptionsFromGroups, originalOptionsMap,
            Math.max(0.82, Math.min(0.9, 0.82 + (sigMargin * 0.06))));
        if (!sigConf) {
            console.log(`    [css-signature] REJECTED by content verification`);
            return null;
        }
        return {
            letter: sigConf.letter,
            confidence: sigConf.confidence,
            method: 'css-signature',
            evidence: `sig_score=${sigBestScore.toFixed(2)} margin=${sigMargin.toFixed(2)} option_hits=${optionHits} window_tokens=${bestHits}`
        };
    },

    _buildDefaultOptionEvals(originalOptionsMap = {}) {
        const evals = {};
        const optionLetters = Object.keys(originalOptionsMap).length > 0
            ? Object.keys(originalOptionsMap)
            : ['A', 'B', 'C', 'D', 'E'];
        for (const letter of optionLetters) {
            evals[letter] = { stance: 'neutral', score: 0 };
        }
        return evals;
    },

    _extractOptionAnchor(optionBody = '') {
        const stop = new Set([
            'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'resposta', 'gabarito',
            'dados', 'banco', 'bancos', 'modelo', 'modelos', 'nosql', 'sql', 'apenas', 'nao', 'com', 'sem'
        ]);
        const tokens = this._normalizeOption(optionBody)
            .split(/\s+/)
            .filter(t => t.length >= 4 && !stop.has(t));
        return tokens.slice(0, 7).join(' ');
    },

    _classifyOptionStanceFromEvidence(evidenceText, optionBody, optionLetter) {
        const evidenceNorm = this._normalizeOption(evidenceText || '');
        const optionNorm = this._normalizeOption(optionBody || '');
        if (!evidenceNorm || !optionNorm) return { stance: 'neutral', score: 0 };

        const letter = String(optionLetter || '').toUpperCase();
        const letPosRe = letter
            ? new RegExp(`(?:letra|alternativa|opcao)\\s*${letter}\\s*(?:e|eh)?\\s*(?:a\\s+)?(?:correta|certa|resposta)`, 'i')
            : null;
        const letNegRe = letter
            ? new RegExp(`(?:letra|alternativa|opcao)\\s*${letter}\\s*(?:e|eh)?\\s*(?:a\\s+)?(?:incorreta|falsa|errada)`, 'i')
            : null;

        if (letPosRe && letPosRe.test(evidenceText || '')) return { stance: 'entails', score: 0.84 };
        if (letNegRe && letNegRe.test(evidenceText || '')) return { stance: 'contradicts', score: 0.84 };

        const anchor = this._extractOptionAnchor(optionBody);
        if (!anchor || anchor.length < 10) return { stance: 'neutral', score: 0 };

        const idx = evidenceNorm.indexOf(anchor);
        if (idx < 0) return { stance: 'neutral', score: 0 };

        const start = Math.max(0, idx - 160);
        const end = Math.min(evidenceNorm.length, idx + anchor.length + 200);
        const ctx = evidenceNorm.slice(start, end);

        const positiveCtxRe = /(gabarito|resposta correta|alternativa correta|esta correta|item correto|resposta final)/i;
        const negativeCtxRe = /(incorreta|falsa|errada|nao correta|item incorreto)/i;
        const hasPositive = positiveCtxRe.test(ctx);
        const hasNegative = negativeCtxRe.test(ctx);

        if (hasPositive && !hasNegative) return { stance: 'entails', score: 0.74 };
        if (hasNegative && !hasPositive) return { stance: 'contradicts', score: 0.74 };
        return { stance: 'neutral', score: 0.2 };
    },

    _buildEvidenceBlock({
        questionFingerprint = '',
        sourceId = '',
        sourceLink = '',
        hostHint = '',
        evidenceText = '',
        originalOptionsMap = {},
        explicitLetter = '',
        confidenceLocal = 0.65,
        evidenceType = ''
    } = {}) {
        const optionEvals = this._buildDefaultOptionEvals(originalOptionsMap);

        for (const [letter, body] of Object.entries(originalOptionsMap || {})) {
            optionEvals[letter] = this._classifyOptionStanceFromEvidence(evidenceText, body, letter);
        }

        const chosen = String(explicitLetter || '').toUpperCase().trim();
        if (/^[A-E]$/.test(chosen)) {
            const prev = optionEvals[chosen] || { stance: 'neutral', score: 0 };
            const nextScore = Math.max(prev.score || 0, Math.max(0.72, Math.min(0.96, Number(confidenceLocal) || 0.72)));
            optionEvals[chosen] = { stance: 'entails', score: nextScore };
        }

        const citationText = String(evidenceText || '').replace(/\s+/g, ' ').trim().slice(0, 320);
        const citations = citationText
            ? [{ text: citationText, sourceLink: sourceLink || '', host: hostHint || '' }]
            : [];

        return {
            questionFingerprint,
            sourceId,
            sourceLink: sourceLink || '',
            hostHint: hostHint || '',
            explicitLetter: /^[A-E]$/.test(chosen) ? chosen : null,
            optionEvals,
            citations,
            confidenceLocal: Math.max(0.25, Math.min(0.98, Number(confidenceLocal) || 0.65)),
            evidenceType: String(evidenceType || '')
        };
    },

    _computeVotesAndState(sources) {
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
            try {
                return new URL(src?.link || '').hostname.replace(/^www\./, '').toLowerCase();
            } catch {
                return '';
            }
        };

        for (const src of sources) {
            if (!src?.evidenceBlock || !src?.letter) continue;
            const host = getHostFromSource(src);
            const block = src.evidenceBlock;
            const localWeight = Math.max(0.2, Math.min(1.1, block.confidenceLocal || 0.65));
            const optionEval = block.optionEvals?.[src.letter];
            const entails = optionEval?.stance === 'entails';
            if (!entails) continue;
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

        const getHost = (link) => {
            try {
                return new URL(link).hostname.replace(/^www\./, '').toLowerCase();
            } catch {
                return '';
            }
        };

        const isWeakHost = (host) => {
            const h = String(host || '').toLowerCase();
            return h === 'brainly.com.br' || h === 'brainly.com' || h === 'studocu.com' || h === 'passeidireto.com';
        };

        const isStrongSource = (src) => {
            const host = src.hostHint || getHost(src.link);
            const evidenceType = String(src.evidenceType || '').toLowerCase();
            if (isWeakHost(host)) return false;
            if (/\.(pdf)(\?|$)/i.test(String(src.link || ''))) return true;
            if (host.endsWith('.gov.br') || host.endsWith('.edu.br')) return true;
            if (host === 'qconcursos.com' || host === 'qconcursos.com.br') return true;
            if (evidenceType.includes('pdf-anchor') || evidenceType.includes('answercard')) return true;
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

            // Strict confirmation policy:
            // - at least 2 strong distinct domains
            // - non-AI explicit evidence
            // - sufficient vote weight and margin
            // - cross-source entails consensus in evidence blocks
            if (hasAnyNonAi && hasStrongConsensus && hasDomainConsensus && hasMinimumVotes && hasMargin && hasEvidenceConsensus) {
                resultState = 'confirmed';
                reason = 'confirmed_by_sources';
            } else if (hasAnyNonAi && bestNonAi.length >= 1 && bestScore >= 3.0) {
                // Single high-quality non-AI source with decent weight: promote to "suggested"
                // This handles cases where only one source (e.g. PDF-highlight) produced
                // a clear answer — better than "inconclusive" even if we can't fully confirm.
                const hasHighQualityMethod = bestNonAi.some(s => {
                    const et = String(s.evidenceType || '').toLowerCase();
                    return et.includes('pdf') || et.includes('highlight') || et.includes('answercard') || et.includes('gabarito');
                });
                if (hasHighQualityMethod || hasDomainConsensus) {
                    resultState = 'suggested';
                    reason = 'ai_combined_suggestion';
                }
            } else if (bestScore > 0 && !hasAnyNonAi && sources.length >= 1) {
                // AI-only evidence (from combined inference): show as suggested
                resultState = 'suggested';
                reason = 'ai_combined_suggestion';
            } else if (second && margin < 1.0 && hasAnyNonAi) {
                resultState = 'conflict';
                reason = 'source_conflict';
            }
        }

        let confidence = Math.max(0.25, Math.min(0.98, bestScore / total));
        if (resultState !== 'confirmed') confidence = Math.min(confidence, 0.79);
        if (resultState === 'confirmed') confidence = Math.max(confidence, 0.85);
        if (resultState === 'suggested') confidence = Math.max(confidence, 0.50);

        return {
            votes: mergedVotes,
            baseVotes: votes,
            evidenceVotes,
            bestLetter,
            resultState,
            reason,
            confidence,
            margin,
            evidenceConsensus: {
                bestEvidenceCount,
                bestEvidenceDomains
            }
        };
    },

    async searchOnly(questionText) {
        const results = await ApiService.searchWithSerper(questionText);
        const fingerprint = await this._canonicalHash(questionText || '');
        return this._mergeCachedSourcesIntoResults(fingerprint, results || []);
    },

    async answerFromAi(questionText) {
        const extractedOptions = this._extractOptionsFromQuestion(questionText);
        const optionLetters = extractedOptions
            .map((line) => {
                const m = String(line || '').match(/^([A-E])\)/i);
                return (m?.[1] || '').toUpperCase();
            })
            .filter(Boolean);
        const hasOptions = extractedOptions.length >= 2;
        const hasReliableOptions = extractedOptions.length >= 3
            && optionLetters[0] === 'A'
            && optionLetters[1] === 'B'
            && optionLetters.every((letter, index) => letter.charCodeAt(0) === ('A'.charCodeAt(0) + index));

        if (hasOptions && !hasReliableOptions) {
            return [{
                question: questionText,
                answer: 'INCONCLUSIVO: alternativas malformadas na captura (OCR/DOM).',
                answerLetter: null,
                answerText: 'Alternativas malformadas na captura (OCR/DOM).',
                aiFallback: true,
                evidenceTier: 'AI_ONLY',
                resultState: 'inconclusive',
                reason: 'malformed_options',
                confidence: 0.12,
                votes: undefined,
                sources: []
            }];
        }

        const aiAnswer = await ApiService.generateAnswerFromQuestion(questionText);
        if (!aiAnswer) {
            if (hasOptions) {
                return [{
                    question: questionText,
                    answer: 'INCONCLUSIVO: sem evidência externa confiável para marcar alternativa.',
                    answerLetter: null,
                    answerText: 'Sem evidência externa confiável para marcar alternativa.',
                    aiFallback: true,
                    evidenceTier: 'AI_ONLY',
                    resultState: 'inconclusive',
                    reason: 'inconclusive',
                    confidence: 0.15,
                    votes: undefined,
                    sources: []
                }];
            }
            return [];
        }
        const answerLetter = this._parseAnswerLetter(aiAnswer);
        const answerText = this._parseAnswerText(aiAnswer);

        // If AI returns INCONCLUSIVO, respect it
        if (!answerLetter && /INCONCLUSIVO/i.test(aiAnswer)) {
            return [{
                question: questionText,
                answer: aiAnswer,
                answerLetter: null,
                answerText: 'Sem evidência suficiente para marcar alternativa.',
                aiFallback: true,
                evidenceTier: 'AI_ONLY',
                resultState: 'inconclusive',
                reason: 'inconclusive',
                confidence: 0.15,
                votes: undefined,
                sources: []
            }];
        }

        const optionsMap = this._buildOptionsMap(questionText);
        return [{
            question: questionText,
            answer: aiAnswer,
            answerLetter,
            answerText,
            aiReasoning: aiAnswer,
            optionsMap: Object.keys(optionsMap).length >= 2 ? optionsMap : null,
            aiFallback: true,
            evidenceTier: 'AI_ONLY',
            resultState: answerLetter ? 'suggested' : 'inconclusive',
            reason: answerLetter ? 'ai_knowledge' : 'inconclusive',
            confidence: answerLetter ? 0.55 : 0.15,
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

        // Reset webcache 429 tracking for this search session.
        ApiService.resetWebcache429();

        const sources = [];
        const topResults = results.slice(0, 10);

        const questionForInference = originalQuestionWithOptions || questionText;
        const questionStem = this._extractQuestionStem(questionForInference);
        const questionFingerprint = await this._canonicalHash(questionForInference);

        const originalOptions = this._extractOptionsFromQuestion(questionForInference);
        const originalOptionsMap = this._buildOptionsMap(questionForInference);
        const hasOptions = originalOptions && originalOptions.length >= 2;

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â Detect question polarity Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const questionPolarity = this._detectQuestionPolarity(questionStem);
        console.log(`SearchService: Polarity detected: ${questionPolarity}`);

        // ═══ DEBUG: Pipeline Start ═══
        console.group('🔍 SearchService DEBUG — Pipeline Start');
        console.log('Question stem:', questionStem.slice(0, 120));
        console.log('Options extracted:', originalOptions);
        console.log('Has options:', hasOptions, '| Options count:', originalOptions.length);
        console.log('Options map:', originalOptionsMap);
        console.log('Total results to analyze:', topResults.length);
        console.groupEnd();

        const domainWeights = {
            'qconcursos.com': 2.5,
            'qconcursos.com.br': 2.5,
            'passeidireto.com': 1.4,
            'studocu.com': 1.3,
            'brainly.com.br': 0.9,
            'brainly.com': 0.9
        };

        const riskyCombinedHosts = new Set(['passeidireto.com', 'brainly.com.br', 'brainly.com', 'studocu.com', 'scribd.com', 'pt.scribd.com']);
        const trustedCombinedHosts = new Set(['qconcursos.com', 'qconcursos.com.br', 'google']);
        const isTrustedCombinedHost = (host) => {
            const h = String(host || '').toLowerCase();
            if (!h) return false;
            return trustedCombinedHosts.has(h) || h.endsWith('.gov.br') || h.endsWith('.edu.br');
        };
        const hasStrongOptionCoverage = (coverage) => {
            if (!hasOptions) return true;
            if (!coverage || !coverage.hasEnoughOptions || !coverage.total) return false;
            return coverage.ratio >= 0.55 || coverage.hits >= Math.min(3, coverage.total || 3);
        };
        const hasMediumOptionCoverage = (coverage) => {
            if (!hasOptions) return true;
            if (!coverage || !coverage.hasEnoughOptions || !coverage.total) return false;
            return coverage.ratio >= 0.34 || coverage.hits >= Math.min(2, coverage.total || 2);
        };
        const hasVeryStrongOptionCoverage = (coverage) => {
            if (!hasOptions) return true;
            if (!coverage || !coverage.hasEnoughOptions || !coverage.total) return false;
            return coverage.ratio >= 0.74 || coverage.hits >= Math.min(4, coverage.total || 4);
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
        let aiExtractionCount = 0; // max 5 AI per-page extraction calls per search run
        const aiKnowledgePool = []; // Accumulated knowledge from AI extraction (partial + full)
        const runStats = {
            analyzed: 0,
            acceptedForVotes: 0,
            acceptedForAiEvidence: 0,
            blockedPaywall: 0,
            blockedObfuscation: 0,
            blockedOptionsMismatch: 0,
            blockedSnapshotMismatch: 0,
            blockedByError: 0,
            acceptedViaAiExtraction: 0
        };
        const logRunSummary = (outcome = 'finished') => {
            console.log(
                `SearchService: RunSummary outcome=${outcome} analyzed=${runStats.analyzed} acceptedVotes=${runStats.acceptedForVotes} acceptedAi=${runStats.acceptedForAiEvidence} aiExtraction=${runStats.acceptedViaAiExtraction} knowledgePool=${aiKnowledgePool.length} blockedPaywall=${runStats.blockedPaywall} blockedObf=${runStats.blockedObfuscation} blockedMismatch=${runStats.blockedOptionsMismatch} blockedSnapshotMismatch=${runStats.blockedSnapshotMismatch} blockedErrors=${runStats.blockedByError}`
            );
        };

        // ═══ GOOGLE AI OVERVIEW / ANSWER BOX / PEOPLE ALSO ASK ═══
        // Process Serper meta signals (answerBox, aiOverview, peopleAlsoAsk)
        // as high-priority evidence BEFORE iterating page sources.
        // These come for free with the Serper API response.
        const serperMeta = results._serperMeta || null;
        const searchProvider = results._searchProvider || 'serper';
        const googleMetaSignals = {
            provider: searchProvider,
            answerBox: !!serperMeta?.answerBox,
            aiOverview: !!serperMeta?.aiOverview,
            peopleAlsoAsk: Array.isArray(serperMeta?.peopleAlsoAsk) ? serperMeta.peopleAlsoAsk.length > 0 : !!serperMeta?.peopleAlsoAsk
        };
        if (serperMeta && hasOptions) {
            console.group('🌐 Google Meta Signals (answerBox / AI Overview / PAA)');
            console.log('answerBox:', serperMeta.answerBox ? 'present' : 'absent');
            console.log('aiOverview:', serperMeta.aiOverview ? 'present' : 'absent');
            console.log('peopleAlsoAsk:', serperMeta.peopleAlsoAsk ? `${serperMeta.peopleAlsoAsk.length} entries` : 'absent');

            const googleMeta = this._extractLetterFromGoogleMeta(serperMeta, questionStem, originalOptionsMap, originalOptions);
            if (googleMeta?.letter) {
                const googleWeight = googleMeta.method === 'google-ai-overview' ? 3.8
                    : googleMeta.method === 'google-answerbox' ? 3.2
                    : 1.8; // PAA
                const confFactor = Math.max(0.5, Math.min(1.0, googleMeta.confidence || 0.75));
                const adjustedWeight = googleWeight * confFactor;
                const sourceId = `google-meta:${sources.length + 1}`;
                const evidenceBlock = this._buildEvidenceBlock({
                    questionFingerprint,
                    sourceId,
                    sourceLink: '',
                    hostHint: 'google',
                    evidenceText: googleMeta.evidence || '',
                    originalOptionsMap,
                    explicitLetter: googleMeta.letter,
                    confidenceLocal: googleMeta.confidence || 0.75,
                    evidenceType: googleMeta.method
                });
                sources.push({
                    title: `Google ${googleMeta.method === 'google-ai-overview' ? 'AI Overview' : googleMeta.method === 'google-answerbox' ? 'Answer Box' : 'PAA'}`,
                    link: '',
                    letter: googleMeta.letter,
                    weight: adjustedWeight,
                    evidenceType: googleMeta.method,
                    questionPolarity,
                    matchQuality: 8,
                    hostHint: 'google',
                    sourceId,
                    evidenceBlock
                });
                runStats.acceptedForVotes += 1;
                console.log(`  ✅ Google meta ACCEPTED: letter=${googleMeta.letter} method=${googleMeta.method} weight=${adjustedWeight.toFixed(2)} confidence=${(googleMeta.confidence || 0).toFixed(2)}`);
            } else {
                console.log('  ℹ️ No answer letter extracted from Google meta signals');
                // Still collect answerBox/aiOverview text as evidence for AI combined
                const metaTexts = [];
                if (serperMeta.answerBox) {
                    const abText = [serperMeta.answerBox.title, serperMeta.answerBox.snippet, serperMeta.answerBox.answer]
                        .filter(Boolean).join(' ').trim();
                    if (abText.length >= 40) metaTexts.push(abText);
                }
                if (serperMeta.aiOverview) {
                    let aioText = '';
                    if (typeof serperMeta.aiOverview === 'string') aioText = serperMeta.aiOverview;
                    else if (serperMeta.aiOverview.text_blocks) aioText = this._flattenAiOverviewBlocks(serperMeta.aiOverview.text_blocks);
                    else if (serperMeta.aiOverview.snippet) aioText = serperMeta.aiOverview.snippet;
                    if (aioText.length >= 40) metaTexts.push(aioText);
                }
                if (metaTexts.length > 0) {
                    const combinedMeta = metaTexts.join('\n\n').slice(0, 3000);
                    const topicSim = this._questionSimilarityScore(combinedMeta, questionStem);
                    if (topicSim >= 0.25) {
                        collectedForCombined.push({
                            title: 'Google AI Overview / Answer Box',
                            link: '',
                            text: combinedMeta,
                            topicSim,
                            optionsMatch: true,
                            optionsCoverage: { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false },
                            hostHint: 'google',
                            obfuscated: false,
                            paywalled: false
                        });
                        console.log(`  📝 Google meta text collected for AI combined (topicSim=${topicSim.toFixed(2)}, len=${combinedMeta.length})`);
                    }
                }
            }
            console.groupEnd();
        }

        // ═══ PARALLEL PAGE FETCH ═══
        // Fetch all pages concurrently instead of sequentially.
        // Sequential: 10 × (0.25s delay + ~2s fetch) ≈ 22s
        // Parallel (5 workers): ~4-7s (limited by slowest page)
        if (typeof onStatus === 'function') {
            onStatus(`Fetching ${topResults.length} sources in parallel...`);
        }
        const _prefetchedSnaps = new Map();
        {
            let _fetchIdx = 0;
            const _fetchWorkers = Array.from(
                { length: Math.min(5, topResults.length) },
                async () => {
                    while (_fetchIdx < topResults.length) {
                        const _r = topResults[_fetchIdx++];
                        try {
                            const snap = await ApiService.fetchPageSnapshot(_r.link, {
                                timeoutMs: 6500,
                                maxHtmlChars: 1500000,
                                maxTextChars: 12000
                            });
                            _prefetchedSnaps.set(_r.link, snap);
                        } catch (e) {
                            _prefetchedSnaps.set(_r.link, null);
                        }
                    }
                }
            );
            await Promise.all(_fetchWorkers);
        }
        console.log(`SearchService: Parallel fetch complete — ${_prefetchedSnaps.size}/${topResults.length} pages fetched`);

        for (const result of topResults) {
            try {
                const snippet = result.snippet || '';
                const title = result.title || '';
                const link = result.link;
                runStats.analyzed += 1;

                if (typeof onStatus === 'function') {
                    onStatus(`Analyzing source ${runStats.analyzed}/${topResults.length}...`);
                }

                const snap = _prefetchedSnaps.get(link) || null;

                const pageText = (snap?.text || '').trim();
                const combinedText = `${title}. ${snippet}\n\n${pageText}`.trim();
                const scopedCombinedText = this._buildQuestionScopedText(combinedText, questionForInference, 3600);
                console.log(`  📐 scopedCombinedText length=${scopedCombinedText.length} (full combined=${combinedText.length}) preview="${scopedCombinedText.slice(0, 200)}"`);
                const seedText = `${title}. ${snippet}`.trim();
                const snapshotWeak = !snap?.ok || pageText.length < 120;
                if (snapshotWeak && hasOptions) {
                    const seedCoverage = this._optionsCoverageInFreeText(originalOptions, seedText);
                    const seedTopicSim = this._questionSimilarityScore(seedText, questionStem);
                    // When topicSim is very high (the snippet clearly describes the same question),
                    // relax the option coverage requirement — the snippet may simply be truncated.
                    const highTopicSim = seedTopicSim >= 0.85;
                    const minHitsForStrong = highTopicSim
                        ? Math.min(2, seedCoverage.total || 2)
                        : Math.min(4, seedCoverage.total || 4);
                    const minRatioForStrong = highTopicSim ? 0.35 : 0.8;
                    const seedStrongMatch = (seedCoverage.ratio >= minRatioForStrong || seedCoverage.hits >= minHitsForStrong) && seedTopicSim >= 0.55;
                    if (!seedStrongMatch) {
                        console.log(`\u26d4 Source #${runStats.analyzed} (${this._getHostHintFromLink(link)}): snapshot-empty-options-mismatch (seedCoverage: ${seedCoverage.hits}/${seedCoverage.total})`);
                        runStats.blockedSnapshotMismatch += 1;
                        this._logSourceDiagnostic({
                            phase: 'decision',
                            hostHint: this._getHostHintFromLink(link),
                            type: 'TYPE_SNAPSHOT_WEAK',
                            topicSim: seedTopicSim,
                            optionsMatch: false,
                            obfuscation: null,
                            decision: 'skip',
                            reason: 'snapshot-empty-options-mismatch'
                        });
                        continue;
                    }
                }

                const hostHint = this._getHostHintFromLink(link);
                const htmlText = snap?.html || '';
                const parsedForDiag = this._parseHtmlDomWithEmbeddedFallback(htmlText);
                const sourceType = this._detectStructuredHtmlType(htmlText, parsedForDiag.doc);
                const docText = this._extractDocText(parsedForDiag.doc);
                const obfuscation = this._obfuscationSignals(docText);
                let paywall = this._paywallSignals(htmlText, docText, hostHint);
                const topicSimBase = this._questionSimilarityScore(combinedText, questionStem);

                // ═══ DEBUG: Source Fetch ═══
                console.group(`📄 Source #${runStats.analyzed}: ${hostHint}`);
                console.log('Link:', link);
                console.log('Fetch OK:', snap?.ok, '| HTML length:', htmlText.length, '| Text length:', pageText.length);
                console.log('Source type:', sourceType);
                console.log('Topic similarity:', topicSimBase.toFixed(3));
                console.log('Paywall:', JSON.stringify(paywall));
                console.log('Obfuscation:', JSON.stringify(obfuscation));
                let optionsCoverageBase = hasOptions
                    ? this._optionsCoverageInFreeText(originalOptions, scopedCombinedText)
                    : { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
                let optionsMatchBase = hasOptions ? this._optionsMatchInFreeText(originalOptions, scopedCombinedText) : true;

                // Fallback: if scoped text fails options matching, try the full combined text.
                // The question may be further in the document beyond the 3600-char scoped window.
                if (hasOptions && !optionsMatchBase && combinedText.length > scopedCombinedText.length + 200) {
                    const fullCoverage = this._optionsCoverageInFreeText(originalOptions, combinedText);
                    const fullMatch = fullCoverage.ratio >= 0.6 || fullCoverage.hits >= Math.min(3, fullCoverage.total || 3);
                    if (fullMatch) {
                        optionsCoverageBase = fullCoverage;
                        optionsMatchBase = true;
                        console.log(`SearchService: Options matched via full-text fallback for ${hostHint} (hits=${fullCoverage.hits}/${fullCoverage.total})`);
                    } else {
                        console.log(`  ❌ Full-text options fallback also failed: hits=${fullCoverage.hits}/${fullCoverage.total} ratio=${fullCoverage.ratio.toFixed(2)}`);
                    }
                }
                console.log('Options match:', optionsMatchBase, '| Coverage:', JSON.stringify(optionsCoverageBase));

                this._logSourceDiagnostic({
                    phase: 'start',
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    paywall,
                    textLength: combinedText.length
                });

                if (paywall?.isPaywalled) {
                    // Soft-block: if the extracted text is substantial, the content IS
                    // readable in the DOM despite paywall CSS (blur/overlay). Only block
                    // when text is truly empty or very short.
                    const readableTextLen = (docText || '').length;
                    console.log(`  🔒 Paywall detected: readableTextLen=${readableTextLen}`);
                    if (readableTextLen < 400) {
                        console.log(`  ⛔ BLOCKED: paywall-overlay (text too short: ${readableTextLen} < 400)`);
                        console.groupEnd();
                        runStats.blockedPaywall += 1;
                        this._logSourceDiagnostic({
                            phase: 'decision',
                            hostHint,
                            type: sourceType,
                            topicSim: topicSimBase,
                            optionsMatch: optionsMatchBase,
                            obfuscation,
                            paywall,
                            decision: 'skip',
                            reason: 'paywall-overlay'
                        });
                        continue;
                    }
                    // Content IS readable — proceed with extraction despite paywall signals.
                    // Clear the paywall flag so downstream extractors (structured, PDF-highlight,
                    // local regex) don't redundantly re-block this source.
                    paywall = { ...paywall, isPaywalled: false, softPassed: true };
                    console.log(`  ✅ Paywall SOFT-PASSED: text readable (${readableTextLen} chars) — flag cleared`);
                }

                if (obfuscation?.isObfuscated) {
                    console.log(`  ⛔ BLOCKED: obfuscated HTML`);
                    // Still collect for AI combined if topic similarity is decent —
                    // the combined pass uses title + snippet + text, not raw HTML.
                    if (topicSimBase >= 0.30 && !paywall?.isPaywalled) {
                        const clipped = scopedCombinedText.slice(0, 3000);
                        if (clipped.length >= 200) {
                            collectedForCombined.push({
                                title, link,
                                text: clipped,
                                topicSim: topicSimBase,
                                optionsMatch: optionsMatchBase,
                                optionsCoverage: optionsCoverageBase,
                                hostHint,
                                obfuscated: true,
                                paywalled: false
                            });
                        }
                    }
                    runStats.blockedObfuscation += 1;
                    this._logSourceDiagnostic({
                        phase: 'decision',
                        hostHint,
                        type: sourceType,
                        topicSim: topicSimBase,
                        optionsMatch: optionsMatchBase,
                        obfuscation,
                        paywall,
                        decision: 'skip',
                        reason: 'obfuscated_html'
                    });
                    console.groupEnd();
                    continue;
                }

                const allowStructuredMismatchBypass = hasOptions
                    && !optionsMatchBase
                    && !obfuscation?.isObfuscated
                    && topicSimBase >= 0.26
                    && (hostHint === 'passeidireto.com' || hostHint === 'studocu.com');

                if (allowStructuredMismatchBypass) {
                    console.log(`  [BYPASS] options mismatch softened for structured extractors (host=${hostHint}, topicSim=${topicSimBase.toFixed(3)})`);
                }

                // Hard integrity policy: options mismatch cannot contribute direct evidence/votes.
                // However, high-similarity sources are still collected for AI combined inference
                // AND can contribute knowledge via AI extraction.
                if (hasOptions && !optionsMatchBase && !allowStructuredMismatchBypass) {
                    console.log(`  ⛔ BLOCKED: options-mismatch-hard-block (topicSim=${topicSimBase.toFixed(3)})`);
                    // Collect sources with decent topic similarity for AI combined pass.
                    // Allow paywalled-but-readable sources (they passed the soft-block above).
                    if (topicSimBase >= 0.25 && !obfuscation?.isObfuscated) {
                        const clipped = scopedCombinedText.slice(0, 3000);
                        if (clipped.length >= 200) {
                            collectedForCombined.push({
                                title, link,
                                text: clipped,
                                topicSim: topicSimBase,
                                optionsMatch: false,
                                optionsCoverage: optionsCoverageBase,
                                hostHint,
                                obfuscated: false,
                                paywalled: !!paywall?.isPaywalled
                            });
                        }
                    }

                    // AI knowledge extraction for mismatch sources with high topic relevance.
                    // Even though options don't match, the page may contain relevant knowledge
                    // about the topic that can help in the combined reflection step.
                    if (aiExtractionCount < 5 && topicSimBase >= 0.50 && !obfuscation?.isObfuscated && scopedCombinedText.length >= 300) {
                        const aiScopedText = this._buildQuestionScopedText(combinedText, questionForInference, 8000);
                        console.log(`  🤖 [AI-MISMATCH] Attempting knowledge extraction from mismatch source (call ${aiExtractionCount + 1}/5, topicSim=${topicSimBase.toFixed(3)}, textLen=${aiScopedText.length}, host=${hostHint})`);
                        if (typeof onStatus === 'function') {
                            onStatus(`AI extracting knowledge from ${hostHint || 'source'}...`);
                        }
                        try {
                            const aiExtracted = await ApiService.aiExtractFromPage(aiScopedText, questionForInference, hostHint);
                            aiExtractionCount++;

                            if (aiExtracted?.knowledge) {
                                // Strip letter/resultado claims from knowledge — the letter is
                                // from a different question set and would poison reflection
                                const cleanKnowledge = aiExtracted.knowledge
                                    .replace(/^RESULTADO:\s*ENCONTRADO\s*$/gim, '')
                                    .replace(/^Letra\s+[A-E]\b.*$/gim, '')
                                    .trim();
                                aiKnowledgePool.push({
                                    host: hostHint,
                                    knowledge: cleanKnowledge,
                                    topicSim: topicSimBase,
                                    link,
                                    title,
                                    origin: 'mismatch'
                                });
                                console.log(`  🤖 [AI-MISMATCH] Knowledge collected: ${cleanKnowledge.length} chars (pool size=${aiKnowledgePool.length})`);
                            }
                            // Even if AI finds a letter, we DON'T use it for voting because
                            // options don't match — the letter may correspond to a different set of options.
                            if (aiExtracted?.letter) {
                                console.log(`  🤖 [AI-MISMATCH] Letter ${aiExtracted.letter} found but IGNORED (options mismatch — cannot map to user's options)`);
                            }
                        } catch (e) {
                            console.warn(`  🤖 [AI-MISMATCH] Extraction failed:`, e?.message || e);
                        }
                    }

                    runStats.blockedOptionsMismatch += 1;
                    this._logSourceDiagnostic({
                        phase: 'decision',
                        hostHint,
                        type: sourceType,
                        topicSim: topicSimBase,
                        optionsMatch: false,
                        obfuscation,
                        paywall,
                        decision: 'skip',
                        reason: 'options-mismatch-hard-block'
                    });
                    console.groupEnd();
                    continue;
                }

                console.log('  ✅ Passed all filters — entering extraction chain');

                // 0) Structured extractors by page signature (PDF-like, AnswerCard, anchored gabarito).
                const structured = this._extractStructuredEvidenceFromHtml(
                    htmlText,
                    hostHint,
                    questionForInference,
                    questionStem,
                    originalOptionsMap,
                    originalOptions,
                    { parsed: parsedForDiag, type: sourceType, obfuscation, paywall }
                );
                console.log(`  🏗️ Structured extractor: skip=${!!structured?.skip} reason=${structured?.reason || 'none'} letter=${structured?.letter || 'none'} method=${structured?.method || 'none'}`);
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
                    if (structured.reason === 'obfuscated_html' || structured.reason === 'paywall-overlay') {
                        console.log(`  ⛔ Structured hard-skip: ${structured.reason}`);
                        console.groupEnd();
                        continue;
                    }
                    console.log(`  ⚠️ Structured skip (soft): ${structured.reason} — continuing to fallbacks`);
                }
                if (structured?.letter) {
                    console.log(`  🎯 Structured found letter: ${structured.letter} method=${structured.method} confidence=${structured.confidence} matchQuality=${structured.matchQuality}`);
                    const riskyHost = hostHint === 'passeidireto.com' || hostHint === 'brainly.com.br' || hostHint === 'brainly.com';
                    const structuredMethod = structured.method || 'structured-html';
                    const structuredSim = structured.matchQuality || 0;
                    const evidenceScope = `${structured.evidence || ''}\n${scopedCombinedText.slice(0, 1800)}`;
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
                    console.log(`  📊 Structured coverage: match=${structuredOptionsMatch} strong=${structuredOptionsStrong} hits=${structuredCoverage.hits}/${structuredCoverage.total} ratio=${structuredCoverage.ratio?.toFixed(2)} isGenericAnchor=${isGenericAnchor} riskyHost=${riskyHost} sim=${structuredSim.toFixed(2)}`);
                    // FIX: Extend the risky-host demotion guard to ALL structured
                    // methods (answercard-ql, pdf-anchor-text-match, etc.) when
                    // option coverage is zero — not just generic-anchor.  Without
                    // this, an answercard from a DIFFERENT question on a risky host
                    // gets accepted with high weight despite 0/5 option body matches.
                    const isZeroCoverageOnRiskyHost = riskyHost
                        && structuredCoverage.hasEnoughOptions
                        && structuredCoverage.hits === 0
                        && structuredSim < 0.45;
                    if (isZeroCoverageOnRiskyHost && !isGenericAnchor) {
                        console.log(`  ⚠️ Structured ${structuredMethod} demoted: risky host with 0 option hits and low sim=${structuredSim.toFixed(2)}`);
                        if (topicSimBase >= 0.2) {
                            collectedForCombined.push({
                                title,
                                link,
                                text: scopedCombinedText.slice(0, 3000),
                                topicSim: topicSimBase,
                                optionsMatch: structuredOptionsMatch,
                                optionsCoverage: structuredCoverage,
                                hostHint,
                                obfuscated: !!obfuscation?.isObfuscated,
                                paywalled: !!paywall?.isPaywalled
                            });
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
                            reason: 'structured-zero-coverage-risky-host'
                        });
                        console.groupEnd();
                        continue;
                    }
                    if (isGenericAnchor && riskyHost && !structuredOptionsStrong && structuredSim < 0.62) {
                        if (topicSimBase >= 0.2) {
                            collectedForCombined.push({
                                title,
                                link,
                                text: scopedCombinedText.slice(0, 3000),
                                topicSim: topicSimBase,
                                optionsMatch: structuredOptionsMatch,
                                optionsCoverage: structuredCoverage,
                                hostHint,
                                obfuscated: !!obfuscation?.isObfuscated,
                                paywalled: !!paywall?.isPaywalled
                            });
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
                        console.log(`  ⚠️ Generic anchor demoted to combined-only (risky=${riskyHost} strongOpts=${structuredOptionsStrong} sim=${structuredSim.toFixed(2)})`);
                        console.groupEnd();
                        continue;
                    }
                    // Remap letter if source has shuffled options
                    console.log(`  🔀 Structured pre-remap letter: ${structured.letter} — attempting remap via scopedCombinedText (len=${scopedCombinedText.length})...`);
                    structured.letter = this._remapLetterIfShuffled(structured.letter, scopedCombinedText, originalOptionsMap);
                    console.log(`  🔀 Structured post-remap letter: ${structured.letter}`);
                    const baseWeight = getDomainWeight(link);
                    const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                    const structuredBoost = (structured.confidence || 0.82) >= 0.9 ? 4.4 : 3.7;
                    const weight = baseWeight + structuredBoost + (quality * 0.35);
                    const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
                    const evidenceBlock = this._buildEvidenceBlock({
                        questionFingerprint,
                        sourceId,
                        sourceLink: link,
                        hostHint,
                        evidenceText: structured.evidence || scopedCombinedText,
                        originalOptionsMap,
                        explicitLetter: structured.letter,
                        confidenceLocal: structured.confidence || 0.82,
                        evidenceType: structured.evidenceType || 'structured-html'
                    });
                    sources.push({
                        title, link,
                        letter: structured.letter,
                        weight,
                        evidenceType: structured.evidenceType || 'structured-html',
                        questionPolarity,
                        matchQuality: Math.max(quality, Math.round((structured.matchQuality || 0) * 10)),
                        extractionMethod: structuredMethod,
                        evidence: structured.evidence || '',
                        hostHint,
                        sourceId,
                        evidenceBlock
                    });
                    runStats.acceptedForVotes += 1;
                    console.log(`  ✅ ACCEPTED via structured: letter=${structured.letter} weight=${weight.toFixed(2)} method=${structuredMethod}`);
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
                    if (bestLetter && (votes[bestLetter] || 0) >= 6.5) { console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`); console.groupEnd(); break; }
                    console.groupEnd();
                    continue;
                }

                // 1) PDF-like highlight extraction (PasseiDireto/Studocu), scoped by question.
                let extracted = null;
                if (hostHint === 'passeidireto.com' || hostHint === 'studocu.com') {
                    const blockedByIntegrity = !!obfuscation?.isObfuscated || !!paywall?.isPaywalled || (hasOptions && !optionsMatchBase && !allowStructuredMismatchBypass);
                    console.log(`  📄 PDF-highlight check: blockedByIntegrity=${blockedByIntegrity} (obf=${!!obfuscation?.isObfuscated} pw=${!!paywall?.isPaywalled} optMismatch=${hasOptions && !optionsMatchBase})`);
                    if (blockedByIntegrity) {
                        console.log(`  ⛔ PDF-highlight blocked: integrity check failed`);
                        this._logSourceDiagnostic({
                            phase: 'decision',
                            hostHint,
                            type: sourceType,
                            topicSim: topicSimBase,
                            optionsMatch: optionsMatchBase,
                            obfuscation,
                            paywall,
                            decision: 'skip',
                            reason: 'pdf-signal-blocked-low-integrity'
                        });
                        console.groupEnd();
                        continue;
                    }
                    extracted = this._extractPdfLikeHighlightLetterFromHtml(snap?.html || '', questionStem, originalOptionsMap, originalOptions);
                    console.log(`  📄 PDF-highlight result: letter=${extracted?.letter || 'none'} method=${extracted?.method || 'none'} confidence=${extracted?.confidence || 0} evidence="${extracted?.evidence || 'none'}"`);
                    if (extracted?.letter) {
                        console.log(`  📄 PDF-highlight raw letter: ${extracted.letter} — attempting remap via scopedCombinedText (len=${scopedCombinedText.length})...`);
                        // Remap letter if source has shuffled options
                        extracted.letter = this._remapLetterIfShuffled(extracted.letter, scopedCombinedText, originalOptionsMap);
                        console.log(`SearchService: PDF signal detected. host=${hostHint} letter=${extracted.letter} method=${extracted.method || 'ff1-highlight'}`);
                        const baseWeight = getDomainWeight(link);
                        const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                        const method = extracted.method || 'ff1-highlight';
                        const heuristicSignal = method === 'ff1-highlight' || method === 'css-signature';
                        const signalBoost = heuristicSignal ? 1.8 : 3.2;
                        const confFactor = Math.max(0.35, Math.min(1.0, Number(extracted.confidence) || 0.82));
                        const adjustedSignalBoost = signalBoost * confFactor;
                        console.log(`  📄 PDF weight factors: base=${baseWeight.toFixed(2)} signal=${signalBoost.toFixed(2)} conf=${confFactor.toFixed(2)} adjustedSignal=${adjustedSignalBoost.toFixed(2)} quality=${quality}`);
                        const weight = baseWeight + adjustedSignalBoost + (quality * 0.25);
                        const hostPrefix = hostHint === 'passeidireto.com' ? 'passeidireto' : 'studocu';
                        const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
                        const evidenceBlock = this._buildEvidenceBlock({
                            questionFingerprint,
                            sourceId,
                            sourceLink: link,
                            hostHint,
                            evidenceText: extracted.evidence || scopedCombinedText,
                            originalOptionsMap,
                            explicitLetter: extracted.letter,
                            confidenceLocal: extracted.confidence || 0.82,
                            evidenceType: `${hostPrefix}-${method}-scoped`
                        });
                        sources.push({
                            title, link,
                            letter: extracted.letter,
                            weight,
                            evidenceType: `${hostPrefix}-${method}-scoped`,
                            questionPolarity,
                            matchQuality: quality,
                            hostHint,
                            sourceId,
                            evidenceBlock
                        });
                        runStats.acceptedForVotes += 1;
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
                        if (bestLetter && (votes[bestLetter] || 0) >= 6.5) { console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`); console.groupEnd(); break; }
                        console.groupEnd();
                        continue;
                    }
                }

                if (hasOptions && !optionsMatchBase) {
                    console.log(`  [BLOCKED] options-mismatch-post-structured (topicSim=${topicSimBase.toFixed(3)})`);
                    runStats.blockedOptionsMismatch += 1;
                    this._logSourceDiagnostic({
                        phase: 'decision',
                        hostHint,
                        type: sourceType,
                        topicSim: topicSimBase,
                        optionsMatch: false,
                        obfuscation,
                        paywall,
                        decision: 'skip',
                        reason: 'options-mismatch-post-structured'
                    });
                    console.groupEnd();
                    continue;
                }

                // 2) Enhanced local extraction (uses _findQuestionBlock + _extractExplicitGabarito)
                const localResult = this._extractAnswerLocally(combinedText, questionForInference, originalOptions);
                console.log(`  📝 Local extraction: letter=${localResult?.letter || 'none'} type=${localResult?.evidenceType || 'none'} confidence=${localResult?.confidence || 0}`);
                // TopicSim gate: gabarito from low-similarity sources (compilados with many questions)
                // is extremely unreliable — the matched pattern is likely for a DIFFERENT question.
                if (localResult?.letter && topicSimBase < 0.50) {
                    console.log(`  ⛔ Gabarito REJECTED: topicSim=${topicSimBase.toFixed(3)} < 0.50 — likely wrong question in compilado`);
                    localResult.letter = null;
                }
                if (localResult?.letter) {
                    console.log(`  🔀 Local pre-remap letter: ${localResult.letter}`);
                    // Remap letter if source has shuffled options
                    localResult.letter = this._remapLetterIfShuffled(localResult.letter, scopedCombinedText, originalOptionsMap);
                    console.log(`  🔀 Local post-remap letter: ${localResult.letter}`);
                    const baseWeight = getDomainWeight(link);
                    const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                    let weight = baseWeight + 2.6 + (quality * 0.4);
                    // Reduce gabarito weight when topicSim is moderate — source may be wrong question
                    if (topicSimBase < 0.70) {
                        weight *= topicSimBase;
                        console.log(`  ⚠️ Gabarito weight reduced: topicSim=${topicSimBase.toFixed(3)} → weight=${weight.toFixed(2)}`);
                    }
                    const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
                    const evidenceBlock = this._buildEvidenceBlock({
                        questionFingerprint,
                        sourceId,
                        sourceLink: link,
                        hostHint,
                        evidenceText: localResult.evidence || scopedCombinedText,
                        originalOptionsMap,
                        explicitLetter: localResult.letter,
                        confidenceLocal: localResult.confidence || 0.84,
                        evidenceType: localResult.evidenceType || 'explicit-gabarito'
                    });
                    sources.push({
                        title, link,
                        letter: localResult.letter,
                        weight,
                        evidenceType: localResult.evidenceType || 'explicit-gabarito',
                        questionPolarity,
                        matchQuality: quality,
                        blockMethod: localResult.blockMethod,
                        hostHint,
                        sourceId,
                        evidenceBlock
                    });
                    runStats.acceptedForVotes += 1;
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
                    if (bestLetter && (votes[bestLetter] || 0) >= 6.5) { console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`); console.groupEnd(); break; }
                    console.groupEnd();
                    continue;
                }

                // 3) Fallback: simpler explicit letter extraction
                extracted = this._extractExplicitLetterFromText(combinedText, questionStem, originalOptions);
                console.log(`  🔤 Explicit letter: letter=${extracted?.letter || 'none'} confidence=${extracted?.confidence || 0}`);
                if (extracted?.letter) {
                    console.log(`  🔀 Explicit pre-remap letter: ${extracted.letter}`);
                    // Remap letter if source has shuffled options
                    extracted.letter = this._remapLetterIfShuffled(extracted.letter, scopedCombinedText, originalOptionsMap);
                    console.log(`  🔀 Explicit post-remap letter: ${extracted.letter}`);
                    const baseWeight = getDomainWeight(link);
                    const weight = baseWeight + 2.0;
                    const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
                    const evidenceBlock = this._buildEvidenceBlock({
                        questionFingerprint,
                        sourceId,
                        sourceLink: link,
                        hostHint,
                        evidenceText: extracted.evidence || scopedCombinedText,
                        originalOptionsMap,
                        explicitLetter: extracted.letter,
                        confidenceLocal: extracted.confidence || 0.8,
                        evidenceType: 'explicit-gabarito-simple'
                    });
                    sources.push({
                        title, link,
                        letter: extracted.letter,
                        weight,
                        evidenceType: 'explicit-gabarito-simple',
                        questionPolarity,
                        hostHint,
                        sourceId,
                        evidenceBlock
                    });
                    runStats.acceptedForVotes += 1;
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
                    if (bestLetter && (votes[bestLetter] || 0) >= 6.5) { console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`); console.groupEnd(); break; }
                    console.groupEnd();
                    continue;
                }

                // 3.5) AI per-page deep extraction: when regex/DOM extractors all failed,
                // send the page text to AI for a "pente fino" — finds answers that patterns miss.
                // Uses SMART model + sends up to 8000 chars for thorough analysis.
                if (aiExtractionCount < 5 && topicSimBase >= 0.35 && !obfuscation?.isObfuscated && scopedCombinedText.length >= 250) {
                    const aiScopedText = this._buildQuestionScopedText(combinedText, questionForInference, 8000);
                    console.log(`  🤖 [AI-EXTRACT] Attempting AI page extraction (call ${aiExtractionCount + 1}/5, topicSim=${topicSimBase.toFixed(3)}, textLen=${aiScopedText.length}, host=${hostHint})`);
                    if (typeof onStatus === 'function') {
                        onStatus(`AI analyzing ${hostHint || 'source'} (${runStats.analyzed}/${topResults.length})...`);
                    }
                    const aiExtracted = await ApiService.aiExtractFromPage(aiScopedText, questionForInference, hostHint);
                    aiExtractionCount++;

                    // Collect knowledge even if no definitive letter found
                    if (aiExtracted?.knowledge) {
                        aiKnowledgePool.push({
                            host: hostHint,
                            knowledge: aiExtracted.knowledge,
                            topicSim: topicSimBase,
                            link,
                            title
                        });
                        console.log(`  🤖 [AI-EXTRACT] Knowledge collected from ${hostHint} (${aiExtracted.knowledge.length} chars, pool size=${aiKnowledgePool.length})`);
                    }

                    // Cross-question guard: verify the AI's evidence actually relates to
                    // the user's question — multi-question pages often cause the AI to
                    // find a gabarito from a DIFFERENT question on the same page.
                    if (aiExtracted?.letter && aiExtracted?.evidence && originalOptionsMap) {
                        const evNorm = this._normalizeOption(aiExtracted.evidence);
                        // Check 1: evidence should mention concepts from the claimed option
                        const claimedBody = this._normalizeOption(originalOptionsMap[aiExtracted.letter] || '');
                        const claimedTokens = claimedBody.split(/\s+/).filter(t => t.length >= 4);
                        const claimedHits = claimedTokens.filter(t => evNorm.includes(t)).length;
                        const claimedRatio = claimedTokens.length > 0 ? claimedHits / claimedTokens.length : 1;
                        // Check 2: evidence should mention the question's distinguishing keywords
                        const stemTokens = this._extractKeyTokens(questionStem);
                        const stemHits = stemTokens.filter(t => evNorm.includes(t)).length;
                        const stemRatio = stemTokens.length > 0 ? stemHits / stemTokens.length : 1;
                        console.log(`  🤖 [AI-EXTRACT] Cross-Q check: claimedHits=${claimedHits}/${claimedTokens.length} (${claimedRatio.toFixed(2)}) stemHits=${stemHits}/${stemTokens.length} (${stemRatio.toFixed(2)})`);
                        if (claimedRatio < 0.25 && stemRatio < 0.4) {
                            console.log(`  🤖 [AI-EXTRACT] ❌ Cross-question REJECTED: evidence relates to a different question on the page`);
                            console.log(`  🤖 [AI-EXTRACT] Keeping knowledge but discarding letter ${aiExtracted.letter}`);
                            aiExtracted.letter = null;
                            // Strip misleading letter/resultado from knowledge so it
                            // doesn't poison downstream reflection
                            if (aiExtracted.knowledge) {
                                aiExtracted.knowledge = aiExtracted.knowledge
                                    .replace(/^RESULTADO:\s*ENCONTRADO\s*$/gim, '')
                                    .replace(/^Letra\s+[A-E]\b.*$/gim, '')
                                    .trim();
                            }
                        }
                    }

                    if (aiExtracted?.letter) {
                        console.log(`  🤖 [AI-EXTRACT] Letter found: ${aiExtracted.letter} (pre-remap)`);
                        aiExtracted.letter = this._remapLetterIfShuffled(aiExtracted.letter, scopedCombinedText, originalOptionsMap);
                        console.log(`  🤖 [AI-EXTRACT] Post-remap letter: ${aiExtracted.letter}`);
                        const baseWeight = getDomainWeight(link);
                        const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                        const weight = baseWeight + 2.2 + (quality * 0.35);
                        const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
                        const evidenceBlock = this._buildEvidenceBlock({
                            questionFingerprint,
                            sourceId,
                            sourceLink: link,
                            hostHint,
                            evidenceText: aiExtracted.evidence || scopedCombinedText,
                            originalOptionsMap,
                            explicitLetter: aiExtracted.letter,
                            confidenceLocal: aiExtracted.confidence || 0.82,
                            evidenceType: 'ai-page-extraction'
                        });
                        sources.push({
                            title, link,
                            letter: aiExtracted.letter,
                            weight,
                            evidenceType: 'ai-page-extraction',
                            questionPolarity,
                            matchQuality: quality,
                            hostHint,
                            sourceId,
                            evidenceBlock
                        });
                        runStats.acceptedViaAiExtraction += 1;
                        runStats.acceptedForVotes += 1;
                        this._logSourceDiagnostic({
                            phase: 'decision',
                            hostHint,
                            type: sourceType,
                            topicSim: topicSimBase,
                            optionsMatch: optionsMatchBase,
                            obfuscation,
                            decision: 'use-ai-extraction',
                            method: 'ai-page-extraction',
                            letter: aiExtracted.letter
                        });
                        console.log(`  ✅ ACCEPTED via AI page extraction: letter=${aiExtracted.letter} weight=${weight.toFixed(2)}`);
                        const { bestLetter, votes } = this._computeVotesAndState(sources);
                        if (bestLetter && (votes[bestLetter] || 0) >= 6.5) { console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`); console.groupEnd(); break; }
                        console.groupEnd();
                        continue;
                    } else {
                        console.log(`  🤖 [AI-EXTRACT] No letter found for ${hostHint} — knowledge ${aiExtracted?.knowledge ? 'saved' : 'empty'}`);
                    }
                }

                // 4) No explicit evidence found: keep as low-priority AI evidence.
                console.log(`  ℹ️ No direct evidence found — collecting for AI combined`);
                const clipped = scopedCombinedText.slice(0, 4000);
                if (clipped.length >= 200) {
                    const topicSim = topicSimBase;
                    aiEvidence.push({
                        title,
                        link,
                        text: clipped,
                        topicSim,
                        optionsMatch: optionsMatchBase,
                        optionsCoverage: optionsCoverageBase,
                        hostHint,
                        obfuscated: !!obfuscation?.isObfuscated,
                        paywalled: !!paywall?.isPaywalled
                    });
                    runStats.acceptedForAiEvidence += 1;
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
                console.groupEnd();
            } catch (error) {
                console.error('SearchService Error:', error);
                console.groupEnd();
                runStats.blockedByError += 1;
            }
        }

        // Merge aiEvidence + collectedForCombined, sorted by topic similarity

        // ═══ SNIPPET-LEVEL GABARITO EXTRACTION ═══
        // When no direct sources found, try to extract explicit gabarito from Serper
        // snippet + title text for each result. This catches cases where the SERP itself
        // reveals the answer (e.g. "Gabarito: E" in snippet) without needing page fetch.
        if (sources.length === 0 && hasOptions) {
            console.group('📋 Snippet-level gabarito extraction');
            for (const result of topResults) {
                const snipText = `${result.title || ''}. ${result.snippet || ''}`.trim();
                if (snipText.length < 60) continue;
                const snipSim = this._questionSimilarityScore(snipText, questionStem);
                if (snipSim < 0.40) continue;
                const snipCoverage = this._optionsCoverageInFreeText(originalOptions, snipText);
                if (!snipCoverage.hasEnoughOptions || snipCoverage.ratio < 0.5) continue;

                // Try explicit gabarito extraction from snippet
                const gabarito = this._extractExplicitGabarito(snipText, questionStem);
                if (gabarito?.letter) {
                    const hostHint = this._getHostHintFromLink(result.link);
                    const letter = gabarito.letter.toUpperCase();
                    const baseWeight = getDomainWeight(result.link);
                    const weight = baseWeight + 1.6;
                    const sourceId = `snippet-gabarito:${sources.length + 1}`;
                    const evidenceBlock = this._buildEvidenceBlock({
                        questionFingerprint,
                        sourceId,
                        sourceLink: result.link,
                        hostHint,
                        evidenceText: snipText,
                        originalOptionsMap,
                        explicitLetter: letter,
                        confidenceLocal: gabarito.confidence || 0.85,
                        evidenceType: 'snippet-gabarito'
                    });
                    sources.push({
                        title: result.title || '',
                        link: result.link,
                        letter,
                        weight,
                        evidenceType: 'snippet-gabarito',
                        questionPolarity,
                        matchQuality: 7,
                        hostHint,
                        sourceId,
                        evidenceBlock
                    });
                    runStats.acceptedForVotes += 1;
                    console.log(`  ✅ Snippet gabarito: letter=${letter} host=${hostHint} sim=${snipSim.toFixed(2)} coverage=${snipCoverage.hits}/${snipCoverage.total} weight=${weight.toFixed(2)}`);
                }
            }
            console.log(`  Snippet gabarito sources added: ${sources.filter(s => s.evidenceType === 'snippet-gabarito').length}`);
            console.groupEnd();
        }

        // Snippet fallback: when most pages were blocked by various filters, use Serper
        // snippets as a lightweight evidence source for AI combined inference.
        const totalBlocked = runStats.blockedSnapshotMismatch + runStats.blockedByError
            + runStats.blockedOptionsMismatch + runStats.blockedObfuscation;
        const failRate = runStats.analyzed > 0 ? totalBlocked / runStats.analyzed : 0;
        const snippetEvidence = [];
        if (sources.length === 0 && failRate >= 0.7 && topResults.length > 0) {
            for (const result of topResults) {
                const snipText = `${result.title || ''}. ${result.snippet || ''}`.trim();
                if (snipText.length < 80) continue;
                const snipSim = this._questionSimilarityScore(snipText, questionStem);
                if (snipSim < 0.20) continue;
                const snipCoverage = hasOptions
                    ? this._optionsCoverageInFreeText(originalOptions, snipText)
                    : { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
                const snipStrongCoverage = !hasOptions
                    || snipCoverage.ratio >= 0.60
                    || snipCoverage.hits >= Math.min(3, snipCoverage.total || 3);
                if (hasOptions && (!snipStrongCoverage || snipSim < 0.32)) continue;
                snippetEvidence.push({
                    title: result.title || '',
                    link: result.link || '',
                    text: snipText.slice(0, 1500),
                    topicSim: snipSim,
                    optionsMatch: snipStrongCoverage,
                    optionsCoverage: snipCoverage,
                    hostHint: this._getHostHintFromLink(result.link),
                    obfuscated: false,
                    paywalled: false
                });
            }
            if (snippetEvidence.length > 0) {
                console.log(`SearchService: Snippet fallback collected ${snippetEvidence.length} snippet sources (failRate=${failRate.toFixed(2)})`);
            }
        }

        const allForCombined = [
            ...aiEvidence.map(e => ({ ...e, origin: 'aiEvidence' })),
            ...collectedForCombined.map(e => ({ ...e, origin: 'mismatch' })),
            ...snippetEvidence.map(e => ({ ...e, origin: 'snippet' }))
        ].sort((a, b) => (b.topicSim || 0) - (a.topicSim || 0));

        // ═══ DEBUG: AI Combined Pool ═══
        console.group('🧠 AI Combined Evidence Pool');
        console.log(`Direct sources found: ${sources.length}`);
        console.log(`AI evidence pool: ${aiEvidence.length} | Mismatch pool: ${collectedForCombined.length} | Snippet pool: ${snippetEvidence.length}`);
        console.log(`AI knowledge pool: ${aiKnowledgePool.length} entries`);
        if (aiKnowledgePool.length > 0) {
            aiKnowledgePool.forEach((k, i) => {
                console.log(`  📚 [${i}] host=${k.host} topicSim=${(k.topicSim || 0).toFixed(3)} knowledge=${(k.knowledge || '').length} chars origin=${k.origin || 'direct'}`);
            });
        }
        console.log(`Total for combined: ${allForCombined.length}`);
        allForCombined.forEach((e, i) => {
            console.log(`  [${i}] origin=${e.origin} host=${e.hostHint} topicSim=${(e.topicSim || 0).toFixed(3)} optMatch=${e.optionsMatch} coverage=${JSON.stringify(e.optionsCoverage)} textLen=${(e.text || '').length}`);
        });
        console.groupEnd();

        // Determine if we already have strong explicit evidence
        const hasStrongExplicit = sources.some(s => (s.weight || 0) >= 5.0);

        // If we have no explicit sources OR we need more evidence, do AI combined pass
        if (allForCombined.length > 0 && (!hasStrongExplicit || sources.length < 2)) {
            if (typeof onStatus === 'function') {
                onStatus(sources.length === 0 ? 'No explicit answer found. Using AI best-effort...' : 'Cross-checking with additional sources...');
            }

            // Only use combined evidence with minimum topic + option alignment quality.
            const minTopicSim = hasOptions ? 0.22 : 0.15;
            let relevant = allForCombined
                .filter((e) => {
                    const topicSim = e.topicSim || 0;
                    if (topicSim < minTopicSim) {
                        console.log(`    ❌ Filtered (low topicSim ${topicSim.toFixed(3)} < ${minTopicSim}): ${e.hostHint}`);
                        return false;
                    }
                    if (!hasOptions) return true;

                    const origin = String(e.origin || '').toLowerCase();
                    const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();

                    const coverage = e.optionsCoverage || { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
                    const strongCoverage = e.optionsMatch === true || hasStrongOptionCoverage(coverage);

                    // Risky hosts (multi-question dumps / user-generated pages):
                    // aiEvidence already passed the main options-match check, so the page
                    // DOES contain the user's question. Only reject when coverage is weak.
                    if (origin === 'aievidence' && riskyCombinedHosts.has(host)) {
                        if (!strongCoverage) {
                            console.log(`    ❌ Risky aiEvidence rejected (weak coverage): host=${host} topicSim=${topicSim.toFixed(2)} coverage=${coverage.hits}/${coverage.total}`);
                            return false;
                        }
                    }

                    if (origin === 'snippet') {
                        if (!strongCoverage) return false;
                        if (topicSim < 0.30) return false;
                        // Allow risky-host snippets when they have strong option coverage
                        // (snippets are just title + SERP text — no cross-question risk).
                    }

                    if (strongCoverage) return true;

                    // Cross-question evidence: when a source has a DIFFERENT question but
                    // strongly related topic (same subject area), the AI can still extract
                    // relevant concepts from its answer text. This is common on Brainly where
                    // the search returns a related question whose explanation contains the key
                    // concept needed to answer the user's actual question.
                    // Requirements: high topicSim, substantial text, NOT a snippet, origin is mismatch.
                    if (
                        origin === 'mismatch'
                        && topicSim >= 0.62
                        && (e.text || '').length >= 500
                        && hasMediumOptionCoverage(coverage)
                        && !riskyCombinedHosts.has(host)
                        && !e.obfuscated
                        && !e.paywalled
                        && isTrustedCombinedHost(host)
                    ) {
                        console.log(`    ✅ Cross-question evidence ADMITTED: host=${host} topicSim=${topicSim.toFixed(2)} textLen=${(e.text || '').length}`);
                        console.log(`SearchService: Cross-question evidence admitted for AI combined: host=${host} topicSim=${topicSim.toFixed(2)} textLen=${(e.text || '').length}`);
                        return true;
                    } else if (origin === 'mismatch') {
                        console.log(`    ❌ Cross-question REJECTED: host=${host} topicSim=${topicSim.toFixed(2)} len=${(e.text || '').length}`);
                    }

                    if (riskyCombinedHosts.has(host) || e.obfuscated || e.paywalled) return false;

                    const mediumCoverage = hasMediumOptionCoverage(coverage);
                    return isTrustedCombinedHost(host) && mediumCoverage && topicSim >= 0.45;
                })
                .slice(0, 5);

            const hasReliableOptionAlignedSource = !hasOptions || relevant.some((e) => {
                const coverage = e.optionsCoverage || { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
                return e.optionsMatch === true || hasStrongOptionCoverage(coverage);
            });
            const hasAnyOptionAlignedSource = !hasOptions || relevant.some((e) => {
                const coverage = e.optionsCoverage || { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
                return e.optionsMatch === true || hasMediumOptionCoverage(coverage);
            });
            const hasTrustedRelevantSource = relevant.some((e) => {
                const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
                return isTrustedCombinedHost(host);
            });
            const hasVeryStrongAlignedSource = !hasOptions || relevant.some((e) => {
                const coverage = e.optionsCoverage || { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
                return hasVeryStrongOptionCoverage(coverage);
            });
            const minRelevantSources = hasOptions && !hasStrongExplicit ? 2 : 1;

            // ═══ DEBUG: AI Combined Decision ═══
            console.group('🤖 AI Combined Decision');
            console.log(`Relevant sources after filtering: ${relevant.length}`);
            relevant.forEach((e, i) => {
                console.log(`  [${i}] origin=${e.origin} host=${e.hostHint} topicSim=${(e.topicSim || 0).toFixed(3)} optMatch=${e.optionsMatch} textLen=${(e.text || '').length}`);
            });
            console.log(`desperateMode=false | hasStrongExplicit=${hasStrongExplicit} | hasReliableOptionAligned=${hasReliableOptionAlignedSource} | minRelevantSources=${minRelevantSources}`);

            if (hasOptions && (!hasReliableOptionAlignedSource || relevant.length < minRelevantSources)) {
                console.log(`⛔ AI combined SKIPPED: weak option alignment (relevant=${relevant.length}, reliable=${hasReliableOptionAlignedSource})`);
                console.log(`SearchService: AI combined skipped - weak option alignment (relevant=${relevant.length}, reliable=${hasReliableOptionAlignedSource})`);
            }
            const strongRelevant = relevant.filter((e) => {
                const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
                const coverage = e.optionsCoverage || { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
                const strongCoverage = !hasOptions || e.optionsMatch === true || hasStrongOptionCoverage(coverage);
                return strongCoverage
                    && (e.topicSim || 0) >= (hasOptions ? 0.45 : 0.30)
                    && !riskyCombinedHosts.has(host)
                    && isTrustedCombinedHost(host)
                    && !e.obfuscated
                    && !e.paywalled;
            });
            const strongRelevantDomainCount = new Set(
                strongRelevant.map((e) => String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase()).filter(Boolean)
            ).size;
            const hasEliteAnchoredEvidence = relevant.some((e) => {
                const coverage = e.optionsCoverage || { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
                const strongCoverage = !hasOptions || e.optionsMatch === true || hasStrongOptionCoverage(coverage);
                return String(e.origin || '') === 'aiEvidence'
                    && strongCoverage
                    && (e.topicSim || 0) >= 0.78
                    && (e.text || '').length >= 1800
                    && !e.obfuscated
                    && !e.paywalled;
            });
            const corroboratingSnippetCount = relevant.filter((e) => {
                if (String(e.origin || '') !== 'snippet') return false;
                const coverage = e.optionsCoverage || { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
                return hasStrongOptionCoverage(coverage) && (e.topicSim || 0) >= 0.30;
            }).length;
            const canProceedAISynthesisOnly = sources.length === 0
                && hasOptions
                && (
                    (
                        strongRelevant.length >= 3
                        && strongRelevantDomainCount >= 2
                        && hasVeryStrongAlignedSource
                    )
                    || (
                        hasEliteAnchoredEvidence
                        && hasReliableOptionAlignedSource
                        && relevant.length >= 2
                        && corroboratingSnippetCount >= 1
                    )
                    || (
                        // Path 3: very high topic-similarity source provides strong anchor
                        // even without corroborating snippets (e.g. studocu 403 + passeidireto).
                        hasReliableOptionAlignedSource
                        && relevant.length >= 2
                        && relevant.some(e => (e.topicSim || 0) >= 0.85)
                        && relevant.filter(e => (e.topicSim || 0) >= 0.40 && e.optionsMatch).length >= 2
                    )
                );

            const canProceedAI = (
                relevant.length > 0
                && sources.length > 0
                && (!hasOptions || (hasReliableOptionAlignedSource && relevant.length >= minRelevantSources))
            ) || canProceedAISynthesisOnly;

            console.log(`canProceedAI=${canProceedAI}`);
            if (canProceedAISynthesisOnly) {
                console.log(`✅ AI synthesis-only mode enabled: strongRelevant=${strongRelevant.length}, domainDiversity=${strongRelevantDomainCount}`);
                console.log(`   anchorMode=${hasEliteAnchoredEvidence} corroboratingSnippets=${corroboratingSnippetCount}`);
            }
            if (!canProceedAI) {
                console.log('❌ AI combined will NOT run');
                console.groupEnd();
            }

            if (canProceedAI) {
                const merged = relevant
                    .map((e, i) => `SOURCE ${i + 1}: ${e.title}\n${e.text}\nLINK: ${e.link}`)
                    .join('\n\n');

                // Desperate mode disabled: knowledge-only voting is not allowed without explicit evidence.
                const knowledgePromise = Promise.resolve(null);

                try {
                    const [aiAnswer, knowledgeAnswer] = await Promise.all([
                        ApiService.inferAnswerFromEvidence(questionForInference, merged),
                        knowledgePromise
                    ]);

                    let aiLetter = this._parseAnswerLetter(aiAnswer);
                    let aiWeightUsed = null;
                    // Fallback: match AI prose against known option texts
                    if (!aiLetter && aiAnswer && originalOptionsMap) {
                        aiLetter = this._findLetterByAnswerText(aiAnswer, originalOptionsMap);
                        if (aiLetter) console.log(`SearchService: AI combined letter recovered via text match => ${aiLetter}`);
                    }
                    if (aiLetter) {
                        if (canProceedAISynthesisOnly && hasOptions && originalOptionsMap) {
                            const evidenceCorpus = this._normalizeOption(
                                relevant.map((e) => String(e.text || '').slice(0, 2200)).join(' ')
                            );
                            const optionEntries = Object.entries(originalOptionsMap)
                                .filter(([letter]) => /^[A-E]$/.test(String(letter || '').toUpperCase()))
                                .map(([letter, text]) => {
                                    const norm = this._normalizeOption(String(text || ''));
                                    const tokens = norm.split(/\s+/).filter((token) => token.length >= 4);
                                    const hits = tokens.reduce((count, token) => count + (evidenceCorpus.includes(token) ? 1 : 0), 0);
                                    const tokenRatio = tokens.length > 0 ? hits / tokens.length : 0;
                                    const dice = norm ? this._diceSimilarity(evidenceCorpus, norm) : 0;
                                    const score = (tokenRatio * 0.7) + (dice * 0.3);
                                    return { letter: String(letter).toUpperCase(), score, tokenRatio, dice, hits, tokenCount: tokens.length };
                                })
                                .sort((a, b) => b.score - a.score);

                            const topOption = optionEntries[0] || null;
                            const secondOption = optionEntries[1] || null;
                            const selected = optionEntries.find((entry) => entry.letter === String(aiLetter).toUpperCase()) || null;
                            const supportMinScore = 0.22;
                            const supportMinTokenRatio = 0.38;
                            const supportMargin = topOption && secondOption ? (topOption.score - secondOption.score) : 1;
                            // Dynamic margin: when the selected option has decent support (score > 0.4),
                            // allow a wider margin because lexical overlap doesn't capture semantics
                            // (e.g. "Exige" vs "Não exige" share most tokens but are opposites).
                            const effectiveMarginThreshold = (selected && selected.score >= 0.40)
                                ? 0.25
                                : (selected && selected.score >= 0.30 ? 0.12 : 0.03);
                            const selectedSupported = !!selected
                                && selected.score >= supportMinScore
                                && selected.tokenRatio >= supportMinTokenRatio
                                && (!topOption || topOption.letter === selected.letter || supportMargin < effectiveMarginThreshold);

                            console.log(`SearchService: AI synthesis support check => selected=${selected?.letter || 'none'} score=${(selected?.score || 0).toFixed(3)} tokenRatio=${(selected?.tokenRatio || 0).toFixed(3)} top=${topOption?.letter || 'none'} topScore=${(topOption?.score || 0).toFixed(3)} margin=${supportMargin.toFixed(3)}`);

                            if (!selectedSupported) {
                                console.log(`⛔ AI combined letter rejected by evidence-support guard (selected=${aiLetter}, top=${topOption?.letter || 'none'})`);
                                aiLetter = null;
                            }
                        }
                    }
                    if (aiLetter) {
                        // Weight depends on whether we already have explicit evidence.
                        // When ALL sources are cross-question (different questions, no option match),
                        // reduce weight significantly — cross-question evidence is inherently unreliable.
                        const allCrossQuestion = relevant.every(e => String(e.origin || '') === 'mismatch' || e.optionsMatch === false);
                        const aiWeight = hasStrongExplicit
                            ? 0.3
                            : (canProceedAISynthesisOnly ? 0.35 : (allCrossQuestion ? 0.20 : 0.45));
                        aiWeightUsed = aiWeight;
                        console.log(`  AI combined result: letter=${aiLetter} allCrossQuestion=${allCrossQuestion} weight=${aiWeight}`);
                        const sourceId = `ai-combined:${sources.length + 1}`;
                        const evidenceBlock = this._buildEvidenceBlock({
                            questionFingerprint,
                            sourceId,
                            sourceLink: '',
                            hostHint: 'ai',
                            evidenceText: aiAnswer || merged,
                            originalOptionsMap,
                            explicitLetter: aiLetter,
                            confidenceLocal: hasStrongExplicit ? 0.42 : 0.5,
                            evidenceType: 'ai-combined'
                        });
                        sources.push({
                            title: 'AI (combined evidence)',
                            link: '',
                            letter: aiLetter,
                            weight: aiWeight,
                            evidenceType: 'ai-combined',
                            questionPolarity,
                            hostHint: 'ai',
                            sourceId,
                            evidenceBlock
                        });
                        runStats.acceptedForVotes += 1;
                        console.log(`SearchService: AI combined => Letra ${aiLetter}, weight=${aiWeight}`);
                    }

                    // Process knowledge-based answer as separate vote
                    if (knowledgeAnswer) {
                        let knLetter = this._parseAnswerLetter(knowledgeAnswer);
                        if (!knLetter && originalOptionsMap) {
                            knLetter = this._findLetterByAnswerText(knowledgeAnswer, originalOptionsMap);
                            if (knLetter) console.log(`SearchService: AI knowledge letter recovered via text match => ${knLetter}`);
                        }
                        if (knLetter) {
                            // Knowledge vote gets HIGHER weight than evidence-based in desperate mode
                            // because the evidence is thin (just question text, no real answer).
                            const knWeight = 0.55;
                            const knSourceId = `ai-knowledge:${sources.length + 1}`;
                            const knEvidenceBlock = this._buildEvidenceBlock({
                                questionFingerprint,
                                sourceId: knSourceId,
                                sourceLink: '',
                                hostHint: 'ai',
                                evidenceText: knowledgeAnswer || '',
                                originalOptionsMap,
                                explicitLetter: knLetter,
                                confidenceLocal: 0.60,
                                evidenceType: 'ai-knowledge'
                            });
                            sources.push({
                                title: 'AI (knowledge-based)',
                                link: '',
                                letter: knLetter,
                                weight: knWeight,
                                evidenceType: 'ai-knowledge',
                                questionPolarity,
                                hostHint: 'ai',
                                sourceId: knSourceId,
                                evidenceBlock: knEvidenceBlock
                            });
                            runStats.acceptedForVotes += 1;
                            console.log(`SearchService: AI knowledge => Letra ${knLetter}, weight=${knWeight}`);
                            if (aiLetter && knLetter !== aiLetter) {
                                console.warn(`SearchService: CONFLICT evidence=${aiLetter} vs knowledge=${knLetter} — knowledge (${knWeight}) overrides evidence (${aiWeightUsed ?? 'n/a'})`);
                            }
                        }
                    }

                    console.groupEnd();
                } catch (error) {
                    console.warn('AI evidence inference failed:', error);
                    console.groupEnd();
                }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â PAGE-LEVEL GABARITO TIE-BREAKER Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        if (pageGabarito) {
            const pgLetter = (pageGabarito || '').toUpperCase().trim();
            if (/^[A-E]$/.test(pgLetter)) {
                const sourceId = `page-gabarito:${sources.length + 1}`;
                const evidenceBlock = this._buildEvidenceBlock({
                    questionFingerprint,
                    sourceId,
                    sourceLink: '',
                    hostHint: 'page',
                    evidenceText: String(pageGabarito || ''),
                    originalOptionsMap,
                    explicitLetter: pgLetter,
                    confidenceLocal: 0.9,
                    evidenceType: 'page-gabarito'
                });
                sources.push({
                    title: 'Page Gabarito', link: '',
                    letter: pgLetter, weight: 5.0,
                    evidenceType: 'page-gabarito',
                    questionPolarity,
                    hostHint: 'page',
                    sourceId,
                    evidenceBlock
                });
                runStats.acceptedForVotes += 1;
            }
        }

        // ═══ AI COMBINED REFLECTION FALLBACK ═══
        // When no sources were accepted for voting but we accumulated knowledge
        // from AI page extraction, try a combined reflection as last resort.
        if (sources.length === 0 && aiKnowledgePool.length > 0 && hasOptions) {
            console.group('🧠 AI Combined Reflection Fallback');
            console.log(`No voting sources. Knowledge pool has ${aiKnowledgePool.length} entries from AI extraction.`);
            aiKnowledgePool.forEach((k, i) => {
                console.log(`  [${i}] host=${k.host} topicSim=${(k.topicSim || 0).toFixed(3)} knowledge=${(k.knowledge || '').length} chars origin=${k.origin || 'direct'}`);
            });

            if (typeof onStatus === 'function') {
                onStatus('Reflecting on accumulated knowledge...');
            }

            try {
                const reflectionResult = await ApiService.aiReflectOnSources(questionForInference, aiKnowledgePool);

                if (reflectionResult?.letter) {
                    let reflectLetter = reflectionResult.letter.toUpperCase();
                    if (/^[A-E]$/.test(reflectLetter)) {
                        // Remap if options were shuffled
                        reflectLetter = this._remapLetterIfShuffled(reflectLetter, '', originalOptionsMap);
                        console.log(`  🧠 [REFLECTION] Letter found: ${reflectLetter}`);

                        const reflectWeight = 1.2; // Lower than direct evidence but higher than zero
                        const sourceId = `ai-reflection:${sources.length + 1}`;
                        const evidenceBlock = this._buildEvidenceBlock({
                            questionFingerprint,
                            sourceId,
                            sourceLink: '',
                            hostHint: 'ai-reflection',
                            evidenceText: reflectionResult.response || '',
                            originalOptionsMap,
                            explicitLetter: reflectLetter,
                            confidenceLocal: 0.55,
                            evidenceType: 'ai-combined-reflection'
                        });
                        sources.push({
                            title: 'AI (combined reflection)',
                            link: '',
                            letter: reflectLetter,
                            weight: reflectWeight,
                            evidenceType: 'ai-combined-reflection',
                            questionPolarity,
                            hostHint: 'ai-reflection',
                            sourceId,
                            evidenceBlock
                        });
                        runStats.acceptedForVotes += 1;
                        console.log(`  ✅ AI reflection accepted: letter=${reflectLetter} weight=${reflectWeight}`);
                    } else {
                        console.log(`  ❌ AI reflection returned invalid letter: "${reflectionResult.letter}"`);
                    }
                } else {
                    console.log(`  ❌ AI reflection returned no letter (INCONCLUSIVO)`);
                }
            } catch (e) {
                console.warn(`  🧠 AI reflection error:`, e?.message || e);
            }
            console.groupEnd();
        } else if (sources.length === 0 && aiKnowledgePool.length === 0) {
            console.log('🧠 No knowledge pool accumulated — reflection fallback skipped');
        }

        if (sources.length === 0) {
            logRunSummary('no-sources');
            return [];
        }

        const {
            votes,
            baseVotes,
            evidenceVotes,
            bestLetter,
            resultState,
            reason,
            confidence,
            evidenceConsensus
        } = this._computeVotesAndState(sources);

        // ═══ DEBUG: Final Voting Breakdown ═══
        console.group('🏳️ Final Voting Breakdown');
        console.log('All sources:');
        sources.forEach((s, i) => {
            console.log(`  [${i}] host=${s.hostHint} letter=${s.letter} weight=${s.weight?.toFixed?.(2) || s.weight} type=${s.evidenceType} method=${s.extractionMethod || 'n/a'}`);
        });
        console.log('Votes:', JSON.stringify(votes));
        console.log('Base votes:', JSON.stringify(baseVotes));
        console.log('Evidence votes:', JSON.stringify(evidenceVotes));
        console.log(`Best letter: ${bestLetter} | State: ${resultState} | Confidence: ${confidence} | Reason: ${reason}`);
        console.log('Evidence consensus:', JSON.stringify(evidenceConsensus));
        console.groupEnd();

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
        } else if (hasExplicitEvidence && (evidenceConsensus?.bestEvidenceCount || 0) >= 1) {
            evidenceTier = 'EVIDENCE_MEDIUM';
        }

        let overview = null;
        try {
            const overviewCandidates = [];
            const seenOverviewKeys = new Set();
            const pushOverviewCandidate = (candidate) => {
                const title = String(candidate?.title || '').trim();
                const link = String(candidate?.link || '').trim();
                const text = String(candidate?.text || '').trim();
                if (text.length < 120) return;
                const key = `${title}|${link}`.slice(0, 500);
                if (seenOverviewKeys.has(key)) return;
                seenOverviewKeys.add(key);
                overviewCandidates.push({ title, link, text });
            };

            for (const source of sources) {
                if (!source || source.evidenceType === 'ai' || source.evidenceType === 'ai-combined') continue;
                const text = source?.evidence || source?.evidenceBlock?.evidenceText || '';
                pushOverviewCandidate({ title: source.title, link: source.link, text });
            }

            for (const evidence of allForCombined) {
                if (!evidence) continue;
                const coverage = evidence.optionsCoverage || { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
                const alignedEnough = !hasOptions || evidence.optionsMatch === true || hasMediumOptionCoverage(coverage);
                if (!alignedEnough) continue;
                if ((evidence.topicSim || 0) < 0.28) continue;
                pushOverviewCandidate({ title: evidence.title, link: evidence.link, text: evidence.text });
            }

            if (overviewCandidates.length >= 2) {
                overview = await ApiService.generateOverviewFromEvidence(questionForInference, overviewCandidates.slice(0, 6));
            }
        } catch (error) {
            console.warn('SearchService: failed to build overview payload:', error?.message || String(error));
        }

        const finalPayload = [{
            question: questionText,
            answer,
            answerLetter: bestLetter,
            answerText,
            optionsMap: originalOptionsMap && Object.keys(originalOptionsMap).length >= 2 ? { ...originalOptionsMap } : null,
            sources,
            bestLetter,
            votes,
            baseVotes,
            evidenceVotes,
            evidenceConsensus,
            confidence,
            resultState,
            reason,
            evidenceTier,
            questionPolarity,
            title: sources[0]?.title || 'Result',
            aiFallback: isAiOnly,
            questionFingerprint,
            runStats,
            googleMetaSignals,
            overview
        }];
        logRunSummary(resultState);
        return finalPayload;
    },

    async searchAndRefine(questionText, originalQuestionWithOptions = '') {
        const questionForInference = originalQuestionWithOptions || questionText;
        const questionFingerprint = await this._canonicalHash(questionForInference);
        const buildInconclusiveNoEvidence = (reason) => [{
            question: questionText,
            answer: 'INCONCLUSIVO: sem evidência externa confiável para marcar alternativa.',
            answerLetter: null,
            answerText: 'Sem evidência externa confiável para marcar alternativa.',
            aiFallback: false,
            evidenceTier: 'EVIDENCE_WEAK',
            resultState: 'inconclusive',
            reason,
            confidence: 0.12,
            votes: undefined,
            sources: []
        }];

        const cachedDecision = await this._getCachedDecisionForFingerprint(questionFingerprint);
        const cachedResult = cachedDecision
            ? this._buildResultFromCachedDecision(questionText, questionForInference, cachedDecision)
            : null;
        const cachedItem = cachedResult?.[0] || null;
        const hasCached = !!cachedItem;

        const results = await ApiService.searchWithSerper(questionText);
        const serperMeta = results?._serperMeta || null;
        const searchProvider = results?._searchProvider || null;
        const mergedResults = await this._mergeCachedSourcesIntoResults(questionFingerprint, results || []);
        if (serperMeta) mergedResults._serperMeta = serperMeta;
        if (searchProvider) mergedResults._searchProvider = searchProvider;
        if (!mergedResults || mergedResults.length === 0) {
            if (hasCached) {
                await this._recordSearchMetrics({
                    cacheHit: true,
                    outcome: 'cache-fallback-no-search-results',
                    resultState: cachedItem.resultState || 'confirmed',
                    evidenceTier: cachedItem.evidenceTier || 'EVIDENCE_STRONG',
                    runStats: null,
                    bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || '',
                    confidence: Number(cachedItem.confidence || 0.9)
                });
                return cachedResult;
            }

            const inconclusive = buildInconclusiveNoEvidence('no_search_results');
            const inconclusiveItem = inconclusive[0] || {};
            await this._recordSearchMetrics({
                cacheHit: false,
                outcome: 'no-search-results',
                resultState: inconclusiveItem.resultState || 'inconclusive',
                evidenceTier: inconclusiveItem.evidenceTier || 'EVIDENCE_WEAK',
                runStats: null,
                bestLetter: '',
                confidence: Number(inconclusiveItem.confidence || 0.12)
            });
            return inconclusive;
        }

        const refined = await this.refineFromResults(questionText, mergedResults, originalQuestionWithOptions);
        if (!refined || refined.length === 0) {
            if (hasCached) {
                await this._recordSearchMetrics({
                    cacheHit: true,
                    outcome: 'cache-fallback-no-evidence',
                    resultState: cachedItem.resultState || 'confirmed',
                    evidenceTier: cachedItem.evidenceTier || 'EVIDENCE_STRONG',
                    runStats: null,
                    bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || '',
                    confidence: Number(cachedItem.confidence || 0.9)
                });
                return cachedResult;
            }

            const inconclusive = buildInconclusiveNoEvidence('no_evidence');
            const inconclusiveItem = inconclusive[0] || {};
            await this._recordSearchMetrics({
                cacheHit: false,
                outcome: 'no-evidence',
                resultState: inconclusiveItem.resultState || 'inconclusive',
                evidenceTier: inconclusiveItem.evidenceTier || 'EVIDENCE_WEAK',
                runStats: null,
                bestLetter: '',
                confidence: Number(inconclusiveItem.confidence || 0.12)
            });
            return inconclusive;
        }

        const resultItem = refined[0] || {};
        const freshIsStrongConfirmed = resultItem.resultState === 'confirmed' && resultItem.evidenceTier === 'EVIDENCE_STRONG';
        const freshLetter = String(resultItem.answerLetter || resultItem.bestLetter || '').toUpperCase();
        const cachedLetter = String(cachedItem?.answerLetter || cachedItem?.bestLetter || '').toUpperCase();
        const freshHasNonAiEvidence = Array.isArray(resultItem.sources)
            && resultItem.sources.some(
                (s) => s?.evidenceType && s.evidenceType !== 'ai' && s.evidenceType !== 'ai-combined'
            );
        const freshDiffersFromCache = !!(freshLetter && cachedLetter && freshLetter !== cachedLetter);
        const freshUpgradeCandidate = freshDiffersFromCache
            && freshHasNonAiEvidence
            && resultItem.evidenceTier !== 'AI_ONLY'
            && Number(resultItem.confidence || 0) >= 0.72;

        // If cache exists, prefer fresh only when it is strongly confirmed; otherwise keep cached.
        if (hasCached && !freshIsStrongConfirmed && !freshUpgradeCandidate) {
            await this._recordSearchMetrics({
                cacheHit: true,
                outcome: 'cache-fallback-fresh-weak',
                resultState: cachedItem.resultState || 'confirmed',
                evidenceTier: cachedItem.evidenceTier || 'EVIDENCE_STRONG',
                runStats: resultItem.runStats || null,
                bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || '',
                confidence: Number(cachedItem.confidence || 0.9)
            });
            return cachedResult;
        }

        const cacheSources = Array.isArray(resultItem.sources) ? resultItem.sources : [];
        const hasLinkSource = cacheSources.some((s) => String(s?.link || '').trim().length > 0);
        if (hasLinkSource || resultItem.resultState === 'confirmed') {
            await this._setCachedDecisionForFingerprint(questionFingerprint, resultItem, cacheSources);
        }

        if (hasCached && freshIsStrongConfirmed && freshLetter && cachedLetter && freshLetter !== cachedLetter) {
            console.warn(`SearchService: cache corrected from ${cachedLetter} to ${freshLetter} by fresh strong evidence`);
        }
        if (hasCached && freshUpgradeCandidate) {
            console.warn(`SearchService: cache updated by fresh non-AI evidence (${cachedLetter} -> ${freshLetter})`);
        }

        await this._recordSearchMetrics({
            cacheHit: hasCached,
            outcome: hasCached
                ? (freshUpgradeCandidate ? 'cache-revalidated-upgrade' : 'cache-revalidated')
                : 'refined',
            resultState: resultItem.resultState || 'inconclusive',
            evidenceTier: resultItem.evidenceTier || 'EVIDENCE_WEAK',
            runStats: resultItem.runStats || null,
            bestLetter: resultItem.bestLetter || resultItem.answerLetter || '',
            confidence: Number(resultItem.confidence || 0)
        });

        return refined;
    }
};
