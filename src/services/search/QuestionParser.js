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
        const noiseMarker = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parabéns|você\s+acertou|confira\s+o\s+gabarito|explicação|quest[ãa]o\s+\d+\s+de\s+\d+)\b/i;
        const idx = cleaned.search(noiseMarker);
        if (idx > 20) cleaned = cleaned.slice(0, idx).trim();
        return cleaned.replace(/[;:,\-.\s]+$/g, '').trim();
    },

    normalizeOption(text) {
        return (text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^[a-e]\s*[\)\.\-:]\s*/i, '')
            .replace(/[^a-z0-9]+/g, '')
            .trim();
    },

    looksLikeCodeOption(text) {
        const body = String(text || '');
        return /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|->|jsonb?|\bdb\.\w|\.(?:find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(body);
    },

    cleanExtraneousUI(text) {
        if (!text) return '';
        let cleaned = String(text);
        // Anti-Mistura: Rejeitar vazamento de interface da própria extensão (AnswerHunter UI vazando no clipboard/DOM)
        const uiPatterns = [
            /info\s*A IA pode cometer erros — confirme em fontes confiáveis antes de usar\./gi,
            /warning\s*As alternativas A-[E] referem-se.*/gi,
            /check_circle\s*Resposta verificada/gi,
            /\d+\s*Sem evidência explícita forte\. Melhor estimativa aplicada\./gi,
            /[\r\n]+(info|warning|check_circle)[\r\n]+/gi,
            /(?:^|\n)\s*(?:enunciado|alternativas?|pergunta)\s*(?=\n|$)/gim
        ];
        for (const pt of uiPatterns) {
            cleaned = cleaned.replace(pt, '\n');
        }
        return cleaned.replace(/\n{3,}/g, '\n\n').trim();
    },

    normalizeCodeAwareOption(text) {
        return (text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^[a-e]\s*[\)\.\-:]\s*/i, '')
            .replace(/->>/g, ' op_json_text')
            .replace(/->/g, ' op_json_obj')
            .replace(/=>/g, ' op_arrow')
            .replace(/::/g, ' op_dcolon')
            .replace(/:=/g, ' op_assign')
            .replace(/!=/g, ' op_neq')
            .replace(/<>/g, ' op_neq')
            .replace(/<=/g, ' op_lte')
            .replace(/>=/g, ' op_gte')
            .replace(/</g, ' op_lt')
            .replace(/>/g, ' op_gt')
            .replace(/:/g, ' op_colon')
            .replace(/=/g, ' op_eq')
            .replace(/[^a-z0-9_]+/g, '')
            .replace(/\s+/g, '')
            .trim();
    },

    isUsableOptionBody(body) {
        const cleaned = String(body || '').replace(/\s+/g, '').trim();
        if (!cleaned || cleaned.length < 1) return false;
        if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(cleaned)) return false;
        if (/^(?:[A-E]\s*(?:[\)\-:]|(?:\.\s))\s*){1,2}$/i.test(cleaned)) return false;
        if (/^(?:resposta|gabarito|alternativa\s+correta)\b/i.test(cleaned)) return false;
        return true;
    },

    // ── Question structure ─────────────────────────────────────────────────────

    extractQuestionStem(questionWithOptions) {
        let text = (questionWithOptions || '').replace(/\r\n/g, '\n');
        text = this.cleanExtraneousUI(text);

        // Anti-Mistura: Detectar se o texto cru tem alternativas misturadas e quebradas (ex: A, B, Enunciado Vazado no C, D)
        // Isso impede que o stem engula partes estranhas se houver descompasso estrutural severo
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const optionRe = /^([A-E])\s*(?:[\)\-:]|(?:\.\s))/i;
        const soloLetterRe = /^["'""\u2018\u2019\(\[]?\s*([A-E])\s*$/i;
        const bareLetterBodyRe = /^["'""\u2018\u2019\(\[]?\s*([A-E])\s+(.+)$/i;
        const hintLetters = new Set();
        lines.forEach((line) => {
            const m = line.match(optionRe) || line.match(soloLetterRe);
            if (m?.[1]) hintLetters.add(String(m[1]).toUpperCase());
        });
        const hasStrongOptionHints = hintLetters.size >= 2;
        const stemLines = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const optionMatch = line.match(optionRe);
            const soloMatch = line.match(soloLetterRe);
            const bareMatch = hasStrongOptionHints ? line.match(bareLetterBodyRe) : null;
            const looksLikeOptionStart = !!optionMatch
                || (!!soloMatch && i + 1 < lines.length)
                || !!bareMatch;
            if (looksLikeOptionStart) {
                // Guard: dot-space format "X. text" at line start might be a sentence
                // continuation, e.g. "linguagem\nC. O programa..." where "C." refers
                // to the programming language, not option C.
                const isDotSpaceFmt = /^[A-E]\s*\.\s/i.test(line);
                if (isDotSpaceFmt && stemLines.length > 0) {
                    const prevLine = stemLines[stemLines.length - 1];
                    if (/[a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]\s*$/.test(prevLine)) {
                        stemLines.push(line);
                        continue;
                    }
                }
                break;
            }
            stemLines.push(line);
        }
        let stem = (stemLines.join(' ').trim() || text.trim());
        // Detect first inline option: handles both "A) text" and "A .csv" formats.
        // Use exec loop to skip false positives like "linguagem C. O programa"
        // where the letter is a sentence-level reference, not an option label.
        const inlineOptRe = /[\s:;]([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*/gi;
        let inlineOpt;
        while ((inlineOpt = inlineOptRe.exec(stem)) !== null) {
            if (inlineOpt.index <= 30) continue;
            // Guard: for dot-space format ("X. "), reject when the char right
            // before the separator is a word char — signals "word X." (e.g.
            // "linguagem C.", "vitamina B.", "hepatite C.") not an option label.
            const isDotFmt = /\.\s/.test(inlineOpt[0]) && !/[\)\-:]/.test(inlineOpt[0]);
            if (isDotFmt && inlineOpt.index > 0 && /\w/.test(stem[inlineOpt.index - 1])) {
                continue;
            }
            stem = stem.slice(0, inlineOpt.index).trim();
            break;
        }
        // Bare inline option marker after question punctuation: "? A body"
        // Apply only when there are strong option hints elsewhere (B/C... markers).
        if (hasStrongOptionHints) {
            const inlineBareRe = /[?;:]\s*([A-E])\s+(?=\S)/gi;
            let inlineBare;
            while ((inlineBare = inlineBareRe.exec(stem)) !== null) {
                if (inlineBare.index <= 30) continue;
                stem = stem.slice(0, inlineBare.index + 1).trim();
                break;
            }
        }

        // Hard cut on explicit section labels that often prepend options.
        // Only match when "ALTERNATIVA(S)" is a standalone label, NOT when it's
        // embedded in a sentence (e.g. "qual alternativa corresponde...").
        // A label is typically preceded by start-of-string, newline, or punctuation,
        // NOT by a determiner/connector word.
        const altLabelMatch = stem.match(/\bALTERNATIVAS?\b/i);
        if (altLabelMatch && altLabelMatch.index > 30) {
            const before = stem.slice(Math.max(0, altLabelMatch.index - 30), altLabelMatch.index).trim().toLowerCase();
            const isPartOfSentence = /(?:qual|a|da|das|na|nas|essa|este|esta|uma|cada|outra|seguintes?|pr[oó]ximas?|demais|marque|assinale|indique|identifique|encontre|selecione)\s*$/i.test(before);
            if (!isPartOfSentence) {
                stem = stem.slice(0, altLabelMatch.index).trim();
            }
        }

        // Compact inline options without punctuation:
        // "... C.CODIGONIVEL A Sim ... B Nao ... C Sim ..."
        // If we detect ordered A->B markers in the tail, cut at first A marker.
        const compactStart = stem.search(/\sA\s+(?=[A-ZÀ-ÖÙ-Ý])/);
        const hasRomanAssertions = /\bI\.\s+[A-ZÀ-ÖÙ-Ý]/.test(stem) && /\bII\.\s+[A-ZÀ-ÖÙ-Ý]/.test(stem);
        if (compactStart > 40 && !hasRomanAssertions) {
            const tail = stem.slice(compactStart);
            const hasOrderedAB = /\sA\s+(?=[A-ZÀ-ÖÙ-Ý])[\s\S]{0,500}\sB\s+(?=[A-ZÀ-ÖÙ-Ý])/.test(tail);
            const compactMarkers = tail.match(/\s[ABCDE]\s+(?=[A-ZÀ-ÖÙ-Ý])/g) || [];
            if (hasOrderedAB && compactMarkers.length >= 3) {
                stem = stem.slice(0, compactStart).trim();
            }
        }

        return stem.slice(0, 2000);
    },

    extractOptionsFromQuestion(questionText) {
        if (!questionText) return [];
        let text = String(questionText || '').replace(/\r\n/g, '\n');
        text = this.cleanExtraneousUI(text);

        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const options = [];
        const seen = new Set();
        const seenBodies = new Set();
        const _codeDedupKey = (body) => this.normalizeCodeAwareOption(body).replace(/\s+/g, '');
        const optionRe = /^["'""\u2018\u2019\(\[]?\s*([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*(.+)$/i;
        const soloLetterRe = /^["'""\u2018\u2019\(\[]?\s*([A-E])\s*$/i;
        const bareLetterBodyRe = /^["'""\u2018\u2019\(\[]?\s*([A-E])\s+(.+)$/i;
        const sectionLabelRe = /^(?:enunciado|alternativas?|pergunta|op[cç][oõ]es?)$/i;
        const stopNoiseLineRe = /^(?:info|warning|check_circle|resposta\s+verificada)$/i;
        const nextQuestionLineRe = /^\d{1,2}\s*[\.\)]?\s+(?=[A-ZÀ-ÖÙ-Ý])/;

        const optionHintLetters = new Set();
        for (const line of lines) {
            const m = line.match(optionRe) || line.match(soloLetterRe);
            if (m?.[1]) optionHintLetters.add(String(m[1]).toUpperCase());
        }
        const hasStrongOptionHints = optionHintLetters.size >= 2;

        const registerOption = (letterRaw, bodyRaw) => {
            const letter = String(letterRaw || '').toUpperCase();
            let cleanedBody = this.stripOptionTailNoise(bodyRaw);
            const nextQuestionInlineIdx = cleanedBody.search(/\s+\d{1,2}\s*[\.\)]?\s+(?:um|uma|voce|você|considere|qual|quais|em|no|na)\b/i);
            if (nextQuestionInlineIdx > 25) {
                cleanedBody = cleanedBody.slice(0, nextQuestionInlineIdx).trim();
            }
            const normalizedBody = this.normalizeOption(cleanedBody);
            const isCodeLike = this.looksLikeCodeOption(cleanedBody);
            const dedupKey = isCodeLike ? _codeDedupKey(cleanedBody) : normalizedBody;
            const duplicateBody = seenBodies.has(dedupKey);
            if (!/^[A-E]$/.test(letter)) return false;
            if (!this.isUsableOptionBody(cleanedBody) || !normalizedBody || seen.has(letter) || (!isCodeLike && duplicateBody)) return false;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
            if (!isCodeLike) seenBodies.add(dedupKey);
            return true;
        };

        const matchedOptionLines = new Set();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const m = line.match(optionRe);
            if (!m) continue;
            // Guard: dot-space format "X. text" may be sentence continuation
            const isDotSpaceFmt = /^["'\u201C\u2018\u2019\(\[]?\s*[A-E]\s*\.\s/i.test(line);
            if (isDotSpaceFmt) {
                let prevNonOptLine = null;
                for (let j = i - 1; j >= 0; j--) {
                    if (!matchedOptionLines.has(j) && lines[j].trim()) {
                        prevNonOptLine = lines[j].trim();
                        break;
                    }
                }
                if (prevNonOptLine && /[a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]\s*$/.test(prevNonOptLine)) {
                    continue;
                }
            }
            if (registerOption(m[1], m[2])) matchedOptionLines.add(i);
        }

        // Secondary pass: recover missing letters from inline/quoted patterns
        // Lookahead updated: \s after delimiter is optional to handle "A .csv" format
        const inlineRe = /(?:^|[\n\r\t ;"'""''])([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*([^]*?)(?=(?:[\n\r\t ;"'""''][A-E]\s*(?:[\)\-:]|(?:\.\s)))|$)/gi;
        let m;
        while ((m = inlineRe.exec(text)) !== null) {
            // Guard against sentence continuations like "linguagem C. O programa"
            const matchStr = m[0]; // the full match starting with the separator
            const isDotSpaceFmt = /\.\s/.test(matchStr.substring(0, 10)) && !/[\)\-:]/.test(matchStr.substring(0, 10));
            if (isDotSpaceFmt) {
                let scanIdx = m.index;
                if (m.index > 0 && /[\n\r\t ;"'""'']/.test(text[m.index])) {
                    // m[0] starts with the separator. We want the char BEFORE the separator.
                    scanIdx = m.index - 1;
                }
                while (scanIdx >= 0 && /\s/.test(text[scanIdx])) scanIdx--;
                if (scanIdx >= 0 && /[a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF0-9]/.test(text[scanIdx])) {
                    continue; // Character before ' X. ' is alphanumeric, so it's a sentence continuation.
                }
            }

            const letter = (m[1] || '').toUpperCase();
            if (!letter || seen.has(letter)) continue;
            registerOption(letter, m[2]);
            if (seen.size >= 5) break;
        }

        // Secondary.1 pass: recover "A body" directly after question punctuation
        // when B/C/D/E markers are present in separate lines.
        if (hasStrongOptionHints && !seen.has('A')) {
            const inlineABare = text.match(/\?\s*A\s+(.+?)(?=(?:\n\s*(?:alternativas?|B(?:\s*(?:[\)\-:]|(?:\.\s)|\s)|$))|$))/i);
            if (inlineABare?.[1]) {
                registerOption('A', inlineABare[1]);
            }
        }

        // Tertiary pass: recover last missing option with no delimiter.
        // Common case: options A-D use "A .csv" format but E is bare "E JSON".
        // If we have sequential A..D but no E, and the last option body contains
        // a trailing " E <text>" pattern, split it out.
        if (options.length >= 3 && options.length <= 4) {
            const expectedNextLetter = String.fromCharCode(65 + options.length); // A=65
            if (/^[A-E]$/.test(expectedNextLetter) && !seen.has(expectedNextLetter)) {
                // Check last option body for embedded next option
                const lastOpt = options[options.length - 1];
                const lastMatch = lastOpt.match(/^([A-E])\)\s*(.+)$/i);
                if (lastMatch) {
                    const lastBody = lastMatch[2];
                    const trailRe = new RegExp('\\s+' + expectedNextLetter + '\\s+(.+)$');
                    const trailMatch = lastBody.match(trailRe);
                    if (trailMatch) {
                        const fixedBody = lastBody.slice(0, trailMatch.index).trim();
                        const newBody = this.stripOptionTailNoise(trailMatch[1]);
                        const newNorm = this.normalizeOption(newBody);
                        const looksLikeAssertionContinuation = /^(?:I{1,3}|IV|V)\b/i.test(newBody)
                            && /\b(?:apenas|somente|todas?)\b/i.test(fixedBody);
                        if (!looksLikeAssertionContinuation && fixedBody && newBody && newNorm && this.isUsableOptionBody(newBody)) {
                            options[options.length - 1] = `${lastMatch[1].toUpperCase()}) ${fixedBody}`;
                            options.push(`${expectedNextLetter}) ${newBody}`);
                            seen.add(expectedNextLetter);
                        }
                    }
                }
            }
        }

        // Quaternary pass: support split-line alternatives:
        // A
        // option body
        // and bare "A body" lines (without punctuation).
        if (hasStrongOptionHints && seen.size < 5) {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line || sectionLabelRe.test(line) || stopNoiseLineRe.test(line)) continue;

                const bareInline = line.match(bareLetterBodyRe);
                if (bareInline && !line.match(optionRe)) {
                    registerOption(bareInline[1], bareInline[2]);
                    continue;
                }

                const solo = line.match(soloLetterRe);
                if (!solo) continue;
                const letter = String(solo[1] || '').toUpperCase();
                if (seen.has(letter)) continue;

                const bodyParts = [];
                for (let j = i + 1; j < lines.length; j++) {
                    const nextLine = lines[j];
                    if (!nextLine) continue;
                    if (nextQuestionLineRe.test(nextLine)) break;
                    if (sectionLabelRe.test(nextLine) || stopNoiseLineRe.test(nextLine)) break;
                    if (optionRe.test(nextLine) || soloLetterRe.test(nextLine) || bareLetterBodyRe.test(nextLine)) break;
                    bodyParts.push(nextLine);
                    if (bodyParts.join(' ').length > 420) break;
                }

                if (bodyParts.length > 0) {
                    registerOption(letter, bodyParts.join(' '));
                }
            }
        }

        // Contamination guard: for code-oriented stems, drop textual outlier options
        const stemNorm = this.normalizeOption(this.extractQuestionStem(text));
        const expectsCodeOptions = /\b(?:sql|jsonb?|insert|update|delete|select|comando|sintaxe|codigo)\b/i.test(stemNorm);

        // Detect assertion-based questions (I, II, III)
        const hasAssertions = /\b(?:I|II|III|IV)\s*[\-\.)]\s*[A-ZÀ-Ö]/i.test(text) || /\b(?:afirmações|assertivas|itens)\b/i.test(stemNorm);

        if (options.length >= 4) {
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

            // Scenario 1: Stem expects code, options have a mix of code and non-code -> Keep only code
            if (expectsCodeOptions && codeEntries.length >= 3 && nonCodeEntries.length >= 1 && !isCompleteSequence) {
                return codeEntries.map((o) => `${o.letter}) ${o.body}`);
            }

            // Scenario 2: Stem expects assertions (I, II, III) but extracted mostly code -> Reject code options
            // (They are likely from another question entirely, like an SQL question above this one)
            const assertionLikeRe = /\b(?:somente|apenas|afirma[cç][aã]o(?:es)?|assertiva(?:s)?|itens?|est[aã]o\s+corretas?|i\s*e\s*ii|ii\s*e\s*iii|i\s*,\s*ii|iii\s+est[aá])\b/i;
            const assertionLikeEntries = parsed.filter((o) => assertionLikeRe.test(o.body));
            if (hasAssertions && !expectsCodeOptions && codeEntries.length >= 3 && assertionLikeEntries.length === 0) {
                console.log(`AnswerHunter: QuestionParser dropped ${codeEntries.length} code-like options (likely contamination) because stem contains assertions (I/II/III).`);
                return []; // Return empty so fallback logic can look for the REAL text options
            }

            // [ANTI-MISTURA] Scenario 3: Length disparity anomaly (Stem leaked into an Option)
            const lengths = parsed.map(o => o.body.length).sort((a, b) => a - b);
            const medianLen = lengths[Math.floor(lengths.length / 2)];
            if (medianLen > 0) {
                const leakMarkers = /\b(?:considere|assinale|marque|associe|associa[cç][aã]o|sobre a|sobre o|s[aã]o corretas|est[aã]o corretas|analise|verifique[ \-]|programa\s+precisa|para\s+responder|qual(?:is)?\b|quest[aã]o|pergunta)\b/i;
                const cleanedOptions = [];
                let rejectedAny = false;
                
                for (const o of parsed) {
                    const hardLeakPattern = /\b(?:\d{1,2}\s+(?:marcar|revis[aã]o|quest[aã]o|um|uma|voce|você)|marcar\s+para\s+revis[aã]o)\b/i;
                    const likelyHardLeak = o.body.length > 45 && hardLeakPattern.test(o.body);
                    // If an option is disproportionately massive and has question markers,
                    // or contains a hard leak signature (next-question/UI spill), suppress it.
                    if ((o.body.length > medianLen * 4 && o.body.length > 80 && leakMarkers.test(o.body)) || likelyHardLeak) {
                        console.warn(`[Anti-Mistura] Option ${o.letter} suppressed (length ${o.body.length} vs median ${medianLen}). Suspected stem leak.`);
                        rejectedAny = true;
                        continue;
                    }
                    cleanedOptions.push(`${o.letter}) ${o.body}`);
                }
                
                if (rejectedAny && cleanedOptions.length >= 2) {
                    return cleanedOptions;
                }
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
        if (!normalizedAnswer || normalizedAnswer.length < 2) return null;

        const normalizedEntries = Object.entries(optionsMap)
            .map(([letter, body]) => [letter, this.normalizeOption(body)])
            .filter(([, body]) => !!body && body.length >= 2);
        if (normalizedEntries.length < 2) return null;

        if (normalizedAnswer.length < 20) {
            const strictHits = normalizedEntries.filter(([, body]) => body === normalizedAnswer);
            if (strictHits.length === 1) return strictHits[0][0];
        }

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
        const tokens = (stem || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ').trim()
            .split(/\s+/)
            .filter(Boolean);
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
        const normStem = this.normalizeOption(stem).replace(/\s+/g, '').trim();
        const normOpts = (options || []).map(o => this.normalizeOption(o).replace(/\s+/g, '').trim()).sort();
        return `${normStem}||${normOpts.join('|')}`;
    },
};
