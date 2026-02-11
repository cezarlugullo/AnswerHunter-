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

    _optionsMatch(originalOptions, sourceOptions) {
        if (!originalOptions || originalOptions.length < 2) return true;
        if (!sourceOptions || sourceOptions.length < 2) return true;

        const originalSet = new Set(originalOptions.map(o => this._normalizeOption(o)).filter(Boolean));
        const sourceSet = new Set(sourceOptions.map(o => this._normalizeOption(o)).filter(Boolean));
        if (originalSet.size === 0 || sourceSet.size === 0) return true;

        let hits = 0;
        for (const opt of originalSet) {
            if (sourceSet.has(opt)) hits += 1;
        }

        const ratio = hits / originalSet.size;
        return ratio >= 0.6 || hits >= Math.min(3, originalSet.size);
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
            if (t && normalized.includes(t)) hits += 1;
        }
        return hits;
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

    _extractExplicitLetterFromText(text, questionStem, originalOptions) {
        if (!text) return null;
        const tokens = this._extractKeyTokens(questionStem);

        // Strict patterns only (avoid "assinale a alternativa correta" false positives)
        const patterns = [
            /(?:^|\b)(?:gabarito|resposta\s+correta|alternativa\s+correta|item\s+correto)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/i,
            /(?:^|\b)(?:a\s+resposta\s+correta\s+e|a\s+alternativa\s+correta\s+e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i
        ];

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
                if (!this._optionsMatchInFreeText(originalOptions, window)) continue;
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

        const explicitCount = sources.filter(s => s.evidenceType && s.evidenceType !== 'ai').length;
        const bestExplicitSupport = sources.filter(s => s.letter === bestLetter && s.evidenceType && s.evidenceType !== 'ai').length;

        let resultState = 'inconclusive';
        let reason = 'inconclusive';

        if (bestLetter && (bestExplicitSupport >= 2 || (bestScore >= 6.0 && explicitCount >= 1 && margin >= 1.25))) {
            resultState = 'confirmed';
            reason = 'confirmed_by_sources';
        } else if (bestLetter && second && margin < 1.0) {
            resultState = 'conflict';
            reason = 'source_conflict';
        }

        const confidence = Math.max(0.25, Math.min(0.98, bestScore / total));

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
    async refineFromResults(questionText, results, originalQuestionWithOptions = '', onStatus = null) {
        if (!results || results.length === 0) return [];

        const sources = [];
        const topResults = results.slice(0, 6);

        const questionForInference = originalQuestionWithOptions || questionText;
        const questionStem = this._extractQuestionStem(questionForInference);

        const originalOptions = this._extractOptionsFromQuestion(questionForInference);
        const originalOptionsMap = this._buildOptionsMap(questionForInference);
        const hasOptions = originalOptions && originalOptions.length >= 2;

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

                // Basic match gate: ensure the source likely contains this question/options.
                if (hasOptions && !this._optionsMatchInFreeText(originalOptions, combinedText)) {
                    continue;
                }

                const hostHint = this._getHostHintFromLink(link);

                // 1) PDF-like highlight extraction (PasseiDireto/Studocu), scoped by question.
                let extracted = null;
                if (hostHint === 'passeidireto.com' || hostHint === 'studocu.com') {
                    extracted = this._extractPdfLikeHighlightLetterFromHtml(snap?.html || '', questionStem, originalOptionsMap, originalOptions);
                    if (extracted?.letter) {
                        console.log(SearchService: âœ”  ff1 detected (scoped). Letter: );
                        const baseWeight = getDomainWeight(link);
                        const weight = baseWeight + 4.0;
                        sources.push({
                            title,
                            link,
                            letter: extracted.letter,
                            weight,
                            evidenceType: hostHint === 'passeidireto.com' ? 'passeidireto-ff1-highlight-scoped' : 'studocu-ff1-highlight-scoped'
                        });
                        // If we already have a strong explicit signal, we can stop early.
                        const { bestLetter, votes } = this._computeVotesAndState(sources);
                        if (bestLetter && (votes[bestLetter] || 0) >= 6.5) break;
                        continue;
                    }
                }

                // 2) Strict explicit gabarito patterns (only if option evidence also matches).
                extracted = this._extractExplicitLetterFromText(combinedText, questionStem, originalOptions);
                if (extracted?.letter) {
                    const baseWeight = getDomainWeight(link);
                    const weight = baseWeight + 2.6;
                    sources.push({
                        title,
                        link,
                        letter: extracted.letter,
                        weight,
                        evidenceType: 'explicit-gabarito'
                    });
                    const { bestLetter, votes } = this._computeVotesAndState(sources);
                    if (bestLetter && (votes[bestLetter] || 0) >= 6.5) break;
                    continue;
                }

                // 3) No explicit evidence found: keep as low-priority AI evidence.
                const clipped = combinedText.slice(0, 4000);
                if (clipped.length >= 200) {
                    aiEvidence.push({ title, link, text: clipped });
                }
            } catch (error) {
                console.error('SearchService Error:', error);
            }
        }

        // If we have no explicit sources, do a SINGLE AI pass across combined evidence.
        if (sources.length === 0 && aiEvidence.length > 0) {
            if (typeof onStatus === 'function') {
                onStatus('No explicit answer found. Using AI best-effort...');
            }

            const merged = aiEvidence
                .slice(0, 5)
                .map((e, i) => `SOURCE ${i + 1}: ${e.title}\n${e.text}\nLINK: ${e.link}`)
                .join('\n\n');

            try {
                const aiAnswer = await ApiService.inferAnswerFromEvidence(questionForInference, merged);
                const aiLetter = this._parseAnswerLetter(aiAnswer);
                if (aiLetter) {
                    sources.push({
                        title: 'AI (combined evidence)',
                        link: '',
                        letter: aiLetter,
                        weight: 0.9,
                        evidenceType: 'ai'
                    });
                }
            } catch (error) {
                console.warn('AI evidence inference failed:', error);
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
            title: sources[0]?.title || 'Result',
            aiFallback: sources.every(s => s.evidenceType === 'ai')
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