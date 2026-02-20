/**
 * HtmlExtractorService.js
 * Extracts answer letters directly from raw HTML of source pages.
 * Handles:
 *  - PDF-like HTML exports (passeidireto.com, studocu.com) via ff1-highlight / CSS signature
 *  - QuizLet/AnswerCard style containers (.ql-editor)
 *  - Generic anchor-based extraction (gabarito/resposta correta patterns)
 *  - Obfuscation and paywall detection
 *
 * Depends on: QuestionParser, OptionsMatchService
 */
import { QuestionParser } from './QuestionParser.js';
import { OptionsMatchService } from './OptionsMatchService.js';

export const HtmlExtractorService = {

    // ── HTML DOM parsing ───────────────────────────────────────────────────────

    parseHtmlDom(html) {
        if (!html || html.length < 200) return { doc: null, nodes: [] };
        const rawHtml = String(html || '');
        const sanitize = (input) => String(input || '')
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
            .replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, ' ')
            .replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.captcha-display\.com(?:\/|\\?\/)[^\s"'<>]*/gi, ' ')
            .replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)(?:api-js\.)?datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, ' ')
            .replace(/datadome\.co/gi, ' ')
            .replace(/captcha-display\.com/gi, ' ');

        let doc = null;
        let nodes = [];
        const safeHtml = sanitize(rawHtml);
        try {
            doc = new DOMParser().parseFromString(safeHtml, 'text/html');
            nodes = Array.from(doc.querySelectorAll('div.t'));
        } catch {
            return { doc: null, nodes: [] };
        }

        const embeddedSource = rawHtml.includes('\\u003cdiv') ? rawHtml : safeHtml;
        if (nodes.length < 50 && embeddedSource.includes('\\u003cdiv')) {
            const idx = embeddedSource.indexOf('\\u003cdiv');
            const slice = embeddedSource.slice(idx, Math.min(embeddedSource.length, idx + 650000));
            const decoded = slice
                .replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>')
                .replace(/\\u0026/gi, '&').replace(/\\\"/g, '"')
                .replace(/\\n/g, '\n').replace(/\\t/g, '\t');
            try {
                const parsed = new DOMParser().parseFromString(sanitize(decoded), 'text/html');
                const parsedNodes = Array.from(parsed.querySelectorAll('div.t'));
                if (parsedNodes.length > nodes.length) { doc = parsed; nodes = parsedNodes; }
            } catch (_) { /* no-op */ }
        }
        return { doc, nodes };
    },

    extractDocText(doc) {
        if (!doc || !doc.body) return '';
        try {
            const clone = doc.body.cloneNode(true);
            clone.querySelectorAll('script, style, noscript, .blank').forEach(n => n.remove());
            clone.querySelectorAll('div, p, br, li, h1, h2, h3, h4, h5, h6, tr, td, article, section, footer, header')
                .forEach(el => el.appendChild(doc.createTextNode(' ')));
            return (clone.textContent || '').replace(/\s+/g, ' ').trim();
        } catch {
            return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
        }
    },

    detectHtmlType(html, doc = null) {
        const h = String(html || '').toLowerCase();
        if (!h) return 'TYPE_UNKNOWN';
        if ((h.includes('id="pf1"') || h.includes('class="pf') || h.includes('class="pc')) && h.includes('class="t')) {
            return 'TYPE_PD_PDF_HTML';
        }
        if (h.includes('answercard_') || h.includes('ql-editor') || h.includes('answer-content-container')) {
            return 'TYPE_PD_ANSWERCARD';
        }
        if (/resposta\s+correta|gabarito|alternativa\s+correta/i.test(h)) return 'TYPE_GENERIC_QA';
        if (doc && doc.querySelector('.ql-editor')) return 'TYPE_PD_ANSWERCARD';
        return 'TYPE_UNKNOWN';
    },

    // ── Obfuscation & paywall ──────────────────────────────────────────────────

    obfuscationSignals(text) {
        const normalized = QuestionParser.normalizeOption(String(text || ''));
        if (normalized.length < 120 || normalized.split(/\s+/).filter(Boolean).length < 20) {
            return { isObfuscated: false, vowelRatio: 0, junkRatio: 0, longConsonantRuns: 0, consonantRunRatio: 0, relevantWordCount: 0 };
        }
        const words = normalized.split(/\s+/).filter(Boolean);
        const letters = (normalized.match(/[a-z]/g) || []).length || 1;
        const vowels = (normalized.match(/[aeiou]/g) || []).length;
        const vowelRatio = vowels / letters;
        const relevantWords = words.filter(w => w.length >= 4);
        let noVowelWords = 0;
        let longConsonantRuns = 0;
        for (const w of relevantWords) {
            if (!/[aeiou]/.test(w)) noVowelWords++;
            if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(w)) longConsonantRuns++;
        }
        const junkRatio = noVowelWords / Math.max(1, relevantWords.length);
        const consonantRunRatio = relevantWords.length > 0 ? longConsonantRuns / relevantWords.length : 0;
        const isObfuscated = (vowelRatio < 0.24 && junkRatio >= 0.28)
            || (longConsonantRuns >= 8 && vowelRatio < 0.34 && consonantRunRatio >= 0.10);
        return { isObfuscated, vowelRatio, junkRatio, longConsonantRuns, consonantRunRatio, relevantWordCount: relevantWords.length };
    },

    isLikelyObfuscated(text) {
        return this.obfuscationSignals(text).isObfuscated;
    },

    paywallSignals(html, text = '', hostHint = '') {
        const h = String(html || '').toLowerCase();
        const t = QuestionParser.normalizeOption(text || '');
        if (!h && !t) return { isPaywalled: false, markerHits: 0, riskyHost: false };

        const markers = [
            /voce\s+esta\s+vendo\s+uma\s+previa/i, /desbloqueie/i, /seja\s+premium/i,
            /torne[\s-]*se\s+premium/i, /documento\s+premium/i, /conteudos?\s+liberados/i,
            /teste\s+gratis/i, /upload\s+para\s+desbloquear/i,
            /short-preview-version/i, /limitation-blocked/i, /paywall-structure/i,
            /mv-content-limitation-fake-page/i, /new-monetization-test-paywall/i
        ];
        let markerHits = 0;
        for (const re of markers) { if (re.test(h) || re.test(t)) markerHits++; }

        const host = String(hostHint || '').toLowerCase();
        const riskyHost = ['passeidireto.com', 'studocu.com', 'scribd.com', 'pt.scribd.com', 'brainly.com', 'brainly.com.br'].includes(host);
        const isPaywalled = riskyHost ? markerHits >= 2 : markerHits >= 3;
        return { isPaywalled, markerHits, riskyHost };
    },

    // ── PDF-like anchor extraction ─────────────────────────────────────────────

    extractPdfLikeAnswerByAnchors(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs) {
        const { doc, nodes } = this.parseHtmlDom(html);
        if (!doc || nodes.length < 20) return null;

        const frags = nodes.map(n => {
            const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) return null;
            return { text, cls: (n.getAttribute('class') || '').toLowerCase() };
        }).filter(Boolean);
        if (frags.length < 20) return null;

        const startQuestionRe = /^(?:\)?\s*)?\d{1,3}\s*[\)\.\-:]\s*/;
        const starts = [];
        for (let i = 0; i < frags.length; i++) {
            if (startQuestionRe.test(frags[i].text)) starts.push(i);
        }

        const blocks = starts.length === 0
            ? [{ start: 0, end: frags.length - 1 }]
            : starts.map((start, i) => {
                const end = i < starts.length - 1 ? starts[i + 1] - 1 : frags.length - 1;
                return end - start >= 4 ? { start, end } : null;
            }).filter(Boolean);
        if (blocks.length === 0) return null;

        let bestBlock = null;
        let bestBlockScore = 0;
        for (const b of blocks) {
            const text = frags.slice(b.start, b.end + 1).map(x => x.text).join(' ');
            const sim = QuestionParser.questionSimilarityScore(text, questionStem);
            if (sim > bestBlockScore) { bestBlockScore = sim; bestBlock = { ...b, text }; }
        }
        if (!bestBlock || bestBlockScore < 0.12) return null;

        const blockFrags = frags.slice(bestBlock.start, bestBlock.end + 1);
        const blockText = blockFrags.map(f => f.text).join('\n');

        const explicitInBlock = extractorRefs.extractExplicitGabarito(blockText, questionForInference);
        if (explicitInBlock?.letter) {
            return { letter: explicitInBlock.letter, confidence: 0.94, method: 'pdf-anchor-gabarito', evidence: blockText.slice(0, 900), matchQuality: bestBlockScore };
        }

        const anchorRe = /(resposta\s+correta|gabarito|alternativa\s+correta|resposta\s*:\s*letra)/i;
        const stopRe = /(coment[aá]rio|resolu[cç][aã]o|explica[cç][aã]o|pergunta\s+\d+|quest[aã]o\s+\d+)/i;
        let anchorIdx = -1;
        for (let i = 0; i < blockFrags.length; i++) {
            if (anchorRe.test(blockFrags[i].text)) { anchorIdx = i; break; }
        }
        if (anchorIdx < 0) return null;

        const evidenceParts = [];
        for (let i = anchorIdx; i < Math.min(blockFrags.length, anchorIdx + 30); i++) {
            const line = blockFrags[i].text;
            if (i > anchorIdx + 1 && startQuestionRe.test(line)) break;
            if (i > anchorIdx + 1 && stopRe.test(line)) break;
            evidenceParts.push(line);
        }
        const evidenceText = evidenceParts.join(' ').trim();
        if (!evidenceText || evidenceText.length < 20) return null;

        const explicit = extractorRefs.extractExplicitGabarito(evidenceText, questionForInference)
            || extractorRefs.extractExplicitLetterFromText(evidenceText, questionStem, originalOptions);
        if (explicit?.letter) {
            return { letter: explicit.letter, confidence: 0.93, method: 'pdf-anchor-gabarito', evidence: evidenceText.slice(0, 900), matchQuality: bestBlockScore };
        }

        const candidateByText = QuestionParser.findLetterByAnswerText(evidenceText, originalOptionsMap);
        if (!candidateByText) return null;
        return { letter: candidateByText, confidence: 0.86, method: 'pdf-anchor-text-match', evidence: evidenceText.slice(0, 900), matchQuality: bestBlockScore };
    },

    // ── AnswerCard extraction ──────────────────────────────────────────────────

    extractAnswerCardEvidence(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs) {
        const { doc } = this.parseHtmlDom(html);
        if (!doc) return null;

        const containers = Array.from(doc.querySelectorAll(
            '.ql-editor, [class*="AnswerCard_answer-content"], [class*="answer-content-container"], [data-testid*="answer"]'
        ));
        if (containers.length === 0) return null;

        const candidates = [];
        for (const c of containers.slice(0, 18)) {
            let text = (c.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text || text.length < 40 || this.isLikelyObfuscated(text)) continue;

            const block = extractorRefs.findQuestionBlock(text, questionStem);
            if (block?.text?.length >= 80) text = block.text;

            const sim = QuestionParser.questionSimilarityScore(text, questionStem);
            const explicit = extractorRefs.extractExplicitGabarito(text, questionForInference)
                || extractorRefs.extractExplicitLetterFromText(text, questionStem, originalOptions);

            let letter = explicit?.letter || QuestionParser.findLetterByAnswerText(text, originalOptionsMap);
            if (!letter) continue;

            const confidence = explicit?.letter ? 0.9 : 0.82;
            candidates.push({ letter, confidence, method: 'answercard-ql', evidence: text.slice(0, 900), matchQuality: sim, _score: confidence + (sim * 0.6) });
        }

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b._score - a._score);
        return candidates[0];
    },

    // ── Generic anchor extraction ──────────────────────────────────────────────

    extractGenericAnchoredEvidence(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs) {
        const { doc } = this.parseHtmlDom(html);
        if (!doc) return null;
        const fullText = this.extractDocText(doc);
        if (!fullText || fullText.length < 120 || this.isLikelyObfuscated(fullText)) return null;

        const noisyContextRe = /(resposta\s+gerada\s+por\s+ia|desbloqueie|premium|ajude\s+estudantes|conte[íu]dos\s+liberados|respostas?\s+dispon[íi]veis\s+nesse\s+material)/i;
        const strongAnchorRe = /(gabarito|resposta\s+correta|resposta\s*:\s*(?:letra\s*)?[A-E]|a\s+resposta\s+[eé]|alternativa\s+correta\s*(?:[eé]|[:\-]))/i;
        const anchorRe = /(gabarito|resposta\s+correta|alternativa\s+correta|resposta\s*:\s*letra|a\s+resposta\s+[eé])/ig;
        const directiveRe = /(assinale|marque|selecione|indique)\s+(?:a\s+)?(?:alternativa|afirmativa|op[cç][aã]o)\s+(?:correta|incorreta|falsa|errada)/i;
        const riskyHost = ['passeidireto.com', 'brainly.com.br', 'brainly.com'].includes(hostHint);
        const candidates = [];
        let m;
        let guard = 0;
        while ((m = anchorRe.exec(fullText)) !== null && guard < 8) {
            guard++;
            const idx = m.index || 0;
            const anchorLabel = (m[1] || '').toLowerCase();
            const nearPrefix = fullText.slice(Math.max(0, idx - 140), Math.min(fullText.length, idx + 60));
            if (/alternativa\s+correta/.test(anchorLabel) && directiveRe.test(nearPrefix)) continue;

            const start = Math.max(0, idx - 230);
            const end = Math.min(fullText.length, idx + 760);
            const ctx = fullText.slice(start, end);
            if (!ctx || ctx.length < 40 || noisyContextRe.test(ctx)) continue;
            if (!strongAnchorRe.test(ctx)) continue;
            if (directiveRe.test(ctx) && !/(gabarito|resposta\s+correta|a\s+resposta\s+[eé]|resposta\s*:)/i.test(ctx)) continue;

            const sim = QuestionParser.questionSimilarityScore(ctx, questionStem);
            if (sim < (riskyHost ? 0.22 : 0.16)) continue;

            const coverage = originalOptions?.length >= 2
                ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, ctx)
                : { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
            const optionsMatch = !coverage.hasEnoughOptions || coverage.ratio >= 0.6 || coverage.hits >= Math.min(3, coverage.total || 3);
            const optionsStrong = !coverage.hasEnoughOptions || coverage.ratio >= 0.8 || coverage.hits >= Math.min(4, coverage.total || 4);

            const explicit = extractorRefs.extractExplicitGabarito(ctx, questionForInference)
                || extractorRefs.extractExplicitLetterFromText(ctx, questionStem, originalOptions);
            let letter = explicit?.letter || QuestionParser.findLetterByAnswerText(ctx, originalOptionsMap);
            if (!letter) continue;

            if (!optionsMatch) { if (!explicit?.letter) continue; if (sim < (riskyHost ? 0.52 : 0.42)) continue; }
            if (riskyHost && !optionsStrong) { if (!explicit?.letter) continue; if (sim < 0.6) continue; }

            const confidence = explicit?.letter ? 0.9 : 0.8;
            candidates.push({
                letter, confidence, method: 'generic-anchor',
                evidence: ctx.slice(0, 900), matchQuality: sim,
                optionsMatch, optionsStrong, explicitLetter: !!explicit?.letter,
                hasStrongAnchorSignal: true, _score: confidence + (sim * 0.55)
            });
        }

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b._score - a._score);
        const best = candidates[0];
        if (!best.hasStrongAnchorSignal) return null;
        if ((best.matchQuality || 0) < (riskyHost ? 0.46 : 0.34) && !best.optionsMatch) return null;
        if (riskyHost && !best.optionsStrong) { if (!best.explicitLetter || (best.matchQuality || 0) < 0.6) return null; }
        if ((best.matchQuality || 0) < 0.08 && best.confidence < 0.88) return null;
        return best;
    },

    // ── Structured dispatcher ──────────────────────────────────────────────────

    extractStructuredEvidence(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs, diagnosticsCtx = null) {
        if (!html || html.length < 500) return null;

        const parsed = diagnosticsCtx?.parsed || this.parseHtmlDom(html);
        const type = diagnosticsCtx?.type || this.detectHtmlType(html, parsed.doc);
        const docText = this.extractDocText(parsed.doc);
        const obfuscation = diagnosticsCtx?.obfuscation || this.obfuscationSignals(docText);
        const paywall = diagnosticsCtx?.paywall || this.paywallSignals(html, docText, hostHint);

        console.log(`    [Structured] host=${hostHint} type=${type} paywall=${paywall?.isPaywalled} obfuscated=${obfuscation?.isObfuscated}`);

        if (paywall?.isPaywalled) {
            console.log(`    [Structured] ⛔ Blocked by paywall`);
            return { skip: true, reason: 'paywall-overlay', diagnostics: { type, obfuscation, paywall } };
        }

        if (type === 'TYPE_PD_PDF_HTML' || hostHint === 'passeidireto.com' || hostHint === 'studocu.com') {
            const byAnchor = this.extractPdfLikeAnswerByAnchors(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs);
            if (byAnchor?.letter) {
                return { ...byAnchor, evidenceType: `${hostHint || 'pdf'}-${byAnchor.method}-scoped`, diagnostics: { type, obfuscation, paywall } };
            }
        }

        if (type === 'TYPE_PD_ANSWERCARD') {
            const byAnswerCard = this.extractAnswerCardEvidence(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs);
            if (byAnswerCard?.letter) {
                return { ...byAnswerCard, evidenceType: `${hostHint || 'page'}-${byAnswerCard.method}-scoped`, diagnostics: { type, obfuscation, paywall } };
            }
        }

        const byGeneric = this.extractGenericAnchoredEvidence(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs);
        if (byGeneric?.letter) {
            return { ...byGeneric, evidenceType: `${hostHint || 'page'}-${byGeneric.method}-scoped`, diagnostics: { type, obfuscation, paywall } };
        }

        if (obfuscation?.isObfuscated) {
            return { skip: true, reason: 'obfuscated_html', diagnostics: { type, obfuscation, paywall } };
        }
        return { diagnostics: { type, obfuscation, paywall } };
    },

    // ── PDF-like highlight letter extraction (ff1/CSS) ─────────────────────────

    extractPdfHighlightLetter(html, questionStem, originalOptionsMap, originalOptions) {
        if (!html || html.length < 2000) return null;
        const tokens = QuestionParser.extractKeyTokens(questionStem);
        const reconstructedQ = questionStem + '\n' + (originalOptions || []).join('\n');
        const optTokens = QuestionParser.extractOptionTokens(reconstructedQ);
        const hasOptTokens = optTokens.length >= 2;

        const { doc, nodes } = this.parseHtmlDom(html);
        console.log(`    [ff1-highlight] check: html_len=${html.length} div.t nodes=${nodes.length}`);
        if (nodes.length < 15) return null;

        const frags = nodes.map(n => ({
            text: (n.textContent || '').replace(/\s+/g, ' ').trim(),
            cls: (n.getAttribute('class') || '').toLowerCase(),
            style: (n.getAttribute('style') || '').toLowerCase(),
            inner: (n.innerHTML || '').toLowerCase()
        })).filter(f => f.text && f.text.length >= 1);

        if (frags.length < 15) return null;

        // Find best anchor
        let bestIdx = -1;
        let bestAnchorScore = 0;
        const anchorWindowSize = hasOptTokens ? 10 : 5;
        for (let i = 0; i < frags.length; i++) {
            const windowText = frags.slice(i, Math.min(frags.length, i + anchorWindowSize)).map(f => f.text).join(' ');
            const stemHits = QuestionParser.countTokenHits(windowText, tokens);
            const optHits = hasOptTokens ? QuestionParser.countTokenHits(windowText, optTokens) : 0;
            const score = stemHits + (optHits * 2);
            if (score > bestAnchorScore) { bestAnchorScore = score; bestIdx = i; }
        }

        const bestWindowText = bestIdx >= 0 ? frags.slice(bestIdx, Math.min(frags.length, bestIdx + anchorWindowSize)).map(f => f.text).join(' ') : '';
        const bestStemHits = bestIdx >= 0 ? QuestionParser.countTokenHits(bestWindowText, tokens) : 0;
        const bestOptHits = hasOptTokens && bestIdx >= 0 ? QuestionParser.countTokenHits(bestWindowText, optTokens) : 0;
        const minAnchorHits = Math.max(2, Math.floor(tokens.length * 0.35));

        console.log(`    [ff1-highlight] tokens=${JSON.stringify(tokens)} bestIdx=${bestIdx} stemHits=${bestStemHits}/${tokens.length} optHits=${bestOptHits}/${optTokens.length} score=${bestAnchorScore} minRequired=${minAnchorHits}`);

        if (bestIdx < 0 || bestStemHits < minAnchorHits) {
            console.log(`    [ff1-highlight] REJECTED: anchor not found`);
            return null;
        }
        if (hasOptTokens && bestOptHits < 1) {
            console.log(`    [ff1-highlight] REJECTED: stem matched but 0/${optTokens.length} option tokens near anchor. Wrong question block.`);
            return null;
        }

        const windowStart = Math.max(0, bestIdx - 30);
        const windowFrags = frags.slice(windowStart, Math.min(frags.length, bestIdx + 120));
        const windowText = windowFrags.map(f => f.text).join('\n');

        // Options evidence gate
        const optBodies = Object.values(originalOptionsMap || {}).map(v => QuestionParser.normalizeOption(v)).filter(v => v.length >= 2);
        let optionHits = 0;
        const normWindow = QuestionParser.normalizeOption(windowText);
        for (const body of optBodies) { if (body && normWindow.includes(body)) optionHits++; }
        console.log(`    [ff1-highlight] optionHits=${optionHits}/${optBodies.length} windowLen=${windowText.length}`);

        const parseAlternativeStart = (rawText) => {
            const t = (rawText || '').trim();
            if (!t) return null;
            let m = t.match(/^([A-E])\s*[\)\.\-:]\s*/i);
            if (m) return m[1].toUpperCase();
            m = t.match(/^\)\s*([A-E])\b/i);
            if (m) return m[1].toUpperCase();
            m = t.match(/^\(\s*([A-E])\s*\)/i);
            if (m) return m[1].toUpperCase();
            return null;
        };

        const isNextQuestionMarker = (t) => {
            const s = (t || '').trim();
            return /^(?:\)?\s*)?\d{1,3}\s*[\)\.\-:]\s*/.test(s) || /^aula\s+\d+/i.test(s);
        };

        // Clip option grouping to start near anchor, NOT from full lookback
        const anchorOffset = bestIdx - windowStart;
        const maxGroupLookback = Math.min(anchorOffset, 15);
        let groupStartOffset = anchorOffset;
        for (let g = anchorOffset - 1; g >= anchorOffset - maxGroupLookback; g--) {
            if (g < 0) break;
            if (isNextQuestionMarker(windowFrags[g].text)) { groupStartOffset = g + 1; break; }
            groupStartOffset = g;
        }
        const groupingFrags = windowFrags.slice(groupStartOffset);

        const groups = {};
        let current = null;
        for (const f of groupingFrags) {
            const letter = parseAlternativeStart(f.text);
            if (letter) {
                current = letter;
                if (!groups[current]) groups[current] = [];
                groups[current].push(f);
                continue;
            }
            if (current) {
                if (Object.keys(groups).length >= 2 && isNextQuestionMarker(f.text)) break;
                groups[current].push(f);
            }
        }

        const letters = Object.keys(groups);
        if (letters.length < 2) return null;
        if (originalOptions?.length >= 2 && optionHits < 1) {
            console.log(`    [ff1-highlight] REJECTED: 0 option-body matches in window`);
            return null;
        }

        const featuresByLetter = {};
        const tokenOwners = new Map();

        for (const letter of letters) {
            const parts = groups[letter];
            let ff1Hits = 0, blurHits = 0, clearHits = 0;
            const classTokenCounts = new Map();
            for (const p of parts) {
                if (/\bff1\b/.test(p.cls) || /\bff1\b/.test(p.inner)) ff1Hits++;
                const isBlurred = /\bfb\b/.test(p.cls) || /blur\(/.test(p.style);
                if (isBlurred) blurHits++; else clearHits++;
                const clsTokens = String(p.cls || '').split(/\s+/).map(x => x.trim().toLowerCase()).filter(Boolean);
                const classAttrRe = /class\s*=\s*["']([^"']+)["']/gi;
                const nestedClassTokens = [];
                let cm;
                while ((cm = classAttrRe.exec(String(p.inner || ''))) !== null) {
                    nestedClassTokens.push(...(cm[1] || '').split(/\s+/).map(x => x.trim().toLowerCase()).filter(Boolean));
                }
                for (const token of [...clsTokens, ...nestedClassTokens]) {
                    if (!/^(ff|fs|fc|sc|ls)\d+$/i.test(token)) continue;
                    classTokenCounts.set(token, (classTokenCounts.get(token) || 0) + 1);
                }
            }
            featuresByLetter[letter] = { ff1Hits, blurHits, clearHits, fragCount: parts.length, classTokenCounts };
            for (const token of classTokenCounts.keys()) {
                if (!tokenOwners.has(token)) tokenOwners.set(token, new Set());
                tokenOwners.get(token).add(letter);
            }
        }

        // Build source options map for remapping
        const sourceOptionsFromGroups = {};
        for (const [gl, gParts] of Object.entries(groups)) {
            const gBody = this._joinPdfFragments(gParts).replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '').trim();
            if (gBody.length >= 5) sourceOptionsFromGroups[gl] = gBody;
        }

        // Strategy 1: classic ff1 highlight
        let bestLetter = null;
        let bestScore = -1;
        let secondScore = -1;
        for (const [letter, feat] of Object.entries(featuresByLetter)) {
            const score = feat.ff1Hits;
            if (score > bestScore) { secondScore = bestScore; bestScore = score; bestLetter = letter; }
            else if (score > secondScore) { secondScore = score; }
        }
        console.log(`    [ff1-highlight] Strategy1: bestLetter=${bestLetter} bestScore=${bestScore} secondScore=${secondScore}`);

        if (bestLetter && bestScore >= 1 && bestScore > secondScore) {
            const remappedFf1 = OptionsMatchService.remapLetterToUserOptions(bestLetter, sourceOptionsFromGroups, originalOptionsMap);
            const verified = OptionsMatchService.verifyHighlightMatch(bestLetter, remappedFf1, sourceOptionsFromGroups, originalOptionsMap, 0.95);
            if (verified) {
                return { letter: verified.letter, confidence: verified.confidence, method: 'ff1-highlight', evidence: `ff1_hits=${bestScore} window_tokens=${bestStemHits} option_hits=${optionHits}` };
            }
        }

        // Strategy 1.5: font-family outlier detection
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
            if (count > globalDominantFfCount) { globalDominantFfCount = count; globalDominantFf = token; }
        }

        if (globalDominantFf && letters.length >= 3) {
            const outliers = [];
            for (const letter of letters) {
                for (const [token, count] of ffCountsByLetter[letter].entries()) {
                    if (token === globalDominantFf) continue;
                    const owners = tokenOwners.get(token);
                    if (owners?.size === 1 && count >= 1) outliers.push({ letter, token, count });
                }
            }
            const outlierLetters = [...new Set(outliers.map(o => o.letter))];
            if (outlierLetters.length === 1) {
                const outlier = outliers[0];
                const remappedOutlier = OptionsMatchService.remapLetterToUserOptions(outlier.letter, sourceOptionsFromGroups, originalOptionsMap);
                const outlierConf = OptionsMatchService.verifyHighlightMatch(outlier.letter, remappedOutlier, sourceOptionsFromGroups, originalOptionsMap, 0.93);
                if (outlierConf) {
                    return { letter: outlierConf.letter, confidence: outlierConf.confidence, method: 'ff-outlier', evidence: `outlier_ff=${outlier.token} dominant_ff=${globalDominantFf} option_hits=${optionHits}` };
                }
            }
        }

        // Strategy 2: CSS signature outlier
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
            if (score > sigBestScore) { sigSecondScore = sigBestScore; sigBestScore = score; sigBestLetter = letter; }
            else if (score > sigSecondScore) { sigSecondScore = score; }
        }

        if (!sigBestLetter) return null;
        const sigMargin = sigBestScore - sigSecondScore;
        const sigFeat = featuresByLetter[sigBestLetter];
        const strongOutlier = sigBestScore >= 1.8 && sigMargin >= 0.8;
        const permissiveOutlier = sigBestScore >= 2.4 && sigMargin >= 0.5 && optionHits >= 1;
        if (!sigFeat || sigFeat.fragCount < 1 || (!strongOutlier && !permissiveOutlier)) return null;

        const remappedSig = OptionsMatchService.remapLetterToUserOptions(sigBestLetter, sourceOptionsFromGroups, originalOptionsMap);
        const sigConf = OptionsMatchService.verifyHighlightMatch(sigBestLetter, remappedSig, sourceOptionsFromGroups, originalOptionsMap, Math.max(0.82, Math.min(0.9, 0.82 + (sigMargin * 0.06))));
        if (!sigConf) { console.log(`    [css-signature] REJECTED by content verification`); return null; }
        return { letter: sigConf.letter, confidence: sigConf.confidence, method: 'css-signature', evidence: `sig_score=${sigBestScore.toFixed(2)} margin=${sigMargin.toFixed(2)} option_hits=${optionHits}` };
    },

    // ── PDF fragment joining ───────────────────────────────────────────────────

    _joinPdfFragments(frags) {
        if (!frags || frags.length === 0) return '';
        let result = frags[0].text || '';
        for (let i = 1; i < frags.length; i++) {
            const t = frags[i].text || '';
            if (!t) continue;
            const prevChar = result.slice(-1);
            const nextChar = t.charAt(0);
            const isMidWord = /[a-z\u00e0-\u00fc]/i.test(prevChar) && /[a-z\u00e0-\u00fc]/.test(nextChar);
            result += isMidWord ? t : ' ' + t;
        }
        return result.replace(/\s+/g, ' ').trim();
    },
};
