/**
 * ExtractionService.js
 * Functions injected to read the active page DOM
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⛔⛔⛔  ZONA CRÍTICA — NÃO MODIFIQUE ESTE ARQUIVO  ⛔⛔⛔            ║
 * ║                                                                        ║
 * ║  Este arquivo contém a lógica CORE de extração de questões e           ║
 * ║  alternativas do DOM de páginas educacionais.                          ║
 * ║                                                                        ║
 * ║  CADA LINHA FOI CALIBRADA após centenas de testes reais em:            ║
 * ║    - Estácio (saladeavaliacoes, SIA, simulados)                        ║
 * ║    - Kroton AVA (Unopar, Anhanguera, Colaborar)                        ║
 * ║    - Passei Direto, QConcursos, Gran, Estratégia                       ║
 * ║    - Unicesumar/Studeo e dezenas de outros LMS                         ║
 * ║                                                                        ║
 * ║  PROBLEMAS JÁ RESOLVIDOS AQUI (que voltam se mexer):                   ║
 * ║    1. Letra badge fundida no corpo ("Afprintf()" → "fprintf()")        ║
 * ║       → letterFromChild + bodyFromFullText tracking                    ║
 * ║    2. parseOptionNode: separação precisa letter vs body                ║
 * ║    3. extractByGenericOptionAnchors: resolução de container + stem     ║
 * ║    4. extractViewportCentricScript: grid de probes + scoring           ║
 * ║    5. extractQuestionOnlyScript: multi-strategy cascade                ║
 * ║                                                                        ║
 * ║  SE VOCÊ É UMA LLM/IA: NÃO REFATORE, NÃO "MELHORE", NÃO SIMPLIFIQUE ║
 * ║  NADA NESTE ARQUIVO. Cada regex, cada fallback, cada threshold foi     ║
 * ║  ajustado para resolver um bug REAL em produção. "Melhorar" = quebrar. ║
 * ║                                                                        ║
 * ║  SE VOCÊ É UM HUMANO: Converse com o autor antes de tocar aqui.       ║
 * ║  Última calibração: 2026-03-04 — FUNCIONANDO EM PRODUÇÃO.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export const ExtractionService = {

    /**
     * Extract Question and Answer (Complete/Robust)
     * Used for the EXTRACT button
     */
    extractQAContentScript: function () {
        const results = [];

        const selectors = {
            questions: [
                '[class*="question"]',
                '[class*="pergunta"]',
                '[class*="titulo"]',
                '[class*="title"]',
                '[class*="ask"]',
                '[data-question]',
                '.question-text',
                '.question-title',
                '.question-content',
                'h1', 'h2', 'h3',
                '[itemprop="name"]',
                '[itemprop="text"]'
            ],
            answers: [
                '[class*="answer"]',
                '[class*="resposta"]',
                '[class*="solution"]',
                '[class*="solucao"]',
                '[class*="reply"]',
                '[data-answer]',
                '.answer-text',
                '.answer-content',
                '.best-answer',
                '[itemprop="acceptedAnswer"]',
                '[itemprop="suggestedAnswer"]'
            ]
        };

        function cleanText(text) {
            return text
                .replace(/[ \t\r]+/g, ' ')
                .replace(/\n{2,}/g, '\n')
                .trim()
                .substring(0, 3000);
        }

        function isVisible(el) {
            return el.offsetParent !== null &&
                getComputedStyle(el).display !== 'none' &&
                getComputedStyle(el).visibility !== 'hidden';
        }

        const qaContainers = document.querySelectorAll(
            '[class*="qa"], [class*="question-answer"], [class*="pergunta-resposta"], ' +
            '[class*="card"], [class*="post"], [class*="item"], article, section'
        );

        qaContainers.forEach(container => {
            if (!isVisible(container)) return;

            let question = '';
            let answer = '';

            for (const selector of selectors.questions) {
                const el = container.querySelector(selector);
                if (el && isVisible(el)) {
                    const text = cleanText(el.innerText);
                    if (text.length > 10 && text.length > question.length) {
                        question = text;
                    }
                }
            }

            for (const selector of selectors.answers) {
                const el = container.querySelector(selector);
                if (el && isVisible(el)) {
                    const text = cleanText(el.innerText);
                    if (text.length > 10 && text.length > answer.length) {
                        answer = text;
                    }
                }
            }

            if (question && answer && question !== answer) {
                const exists = results.some(r =>
                    r.question === question || r.answer === answer
                );
                if (!exists) {
                    results.push({ question, answer });
                }
            }
        });

        if (results.length === 0) {
            const allText = document.body.innerText;
            const questionPatterns = allText.match(/[^.!?\n]+\?/g) || [];

            questionPatterns.forEach(q => {
                const cleanQ = cleanText(q);
                if (cleanQ.length > 20 && cleanQ.length < 500) {
                    const qIndex = allText.indexOf(q);
                    const afterQ = allText.substring(qIndex + q.length, qIndex + q.length + 2000);
                    const possibleAnswer = afterQ.split(/\n\n/)[0];

                    if (possibleAnswer && possibleAnswer.length > 20) {
                        results.push({
                            question: cleanQ,
                            answer: cleanText(possibleAnswer)
                        });
                    }
                }
            });
        }

        const schemaQA = document.querySelectorAll('[itemtype*="Question"], [itemtype*="Answer"]');
        schemaQA.forEach(el => {
            const name = el.querySelector('[itemprop="name"], [itemprop="text"]');
            const answer = el.querySelector('[itemprop="acceptedAnswer"] [itemprop="text"]');

            if (name && answer) {
                results.push({
                    question: cleanText(name.innerText),
                    answer: cleanText(answer.innerText)
                });
            }
        });

        const uniqueResults = [];
        const seen = new Set();

        for (const item of results) {
            const key = item.question.substring(0, 50);
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(item);
            }
        }

        return uniqueResults.slice(0, 10);
    },

    /**
     * Extract ONLY the Question (Protected Sites / V19 Dom Only)
     * Used for SEARCH
     *
     * ⛔ FROZEN — NÃO MODIFIQUE. Lógica de extração DOM multi-strategy testada
     * e aprovada em produção em dezenas de plataformas educacionais.
     * Qualquer alteração aqui QUEBRA a extração de questões. Sério.
     */
    extractQuestionOnlyScript: function () {
        console.log('AnswerHunter: Iniciando extracao (v19 - DOM only)...');

        function cleanText(text) {
            return (text || '').replace(/[ \t\r]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
        }

        function sanitizeQuestionText(text) {
            if (!text) return '';
            let cleaned = cleanText(text);
            cleaned = cleaned.replace(/\bMarcar para revis(?:a|ã)o\b/gi, '');
            cleaned = cleaned.replace(/^\s*\d+\s*[-.)]?\s*/i, '');
            cleaned = cleaned.replace(/^(?:Quest(?:a|ã)o|Questao)\s*\d+\s*[:.\-]?\s*/i, '');
            cleaned = cleaned.replace(/^Atividade\s*\d+\s*[:.\-]?\s*/i, '');
            return cleaned.trim();
        }

        function isOnScreen(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            return rect.width > 30 && rect.height > 15 &&
                rect.bottom > 0 && rect.top < window.innerHeight &&
                rect.right > 0 && rect.left < window.innerWidth;
        }

        function getVisibleArea(rect) {
            const left = Math.max(0, rect.left);
            const right = Math.min(window.innerWidth, rect.right);
            const top = Math.max(0, rect.top);
            const bottom = Math.min(window.innerHeight, rect.bottom);
            const width = Math.max(0, right - left);
            const height = Math.max(0, bottom - top);
            return width * height;
        }

        function getVisibilityRatio(rect) {
            const area = rect.width * rect.height;
            if (area <= 0) return 0;
            return getVisibleArea(rect) / area;
        }

        function pickMostVisible(elements) {
            let best = null;
            let bestArea = 0;
            for (const el of elements) {
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                const area = getVisibleArea(rect);
                if (area > bestArea) {
                    bestArea = area;
                    best = el;
                }
            }
            return best;
        }

        function buildFromActivitySection(sectionEl) {
            if (!sectionEl) return null;

            const headerNodes = Array.from(sectionEl.querySelectorAll('[data-testid="openResponseQuestionHeader"]'));
            const visibleHeaders = headerNodes.filter(isOnScreen);
            let questionContainer = pickMostVisible(visibleHeaders);
            if (!questionContainer && headerNodes.length > 0) {
                questionContainer = headerNodes[headerNodes.length - 1];
            }
            // Walk up to find option scope FIRST — needed for comprehensive text collection
            let optionScope = questionContainer || sectionEl;
            while (optionScope && optionScope !== sectionEl) {
                if (optionScope.querySelectorAll('button[type="submit"]').length >= 2) break;
                optionScope = optionScope.parentElement;
            }
            if (!optionScope) optionScope = sectionEl;

            // ── Collect full question text: ALL <p> in optionScope NOT inside option buttons ──
            // Captures preamble + Roman numeral items (I, II, III, IV) + closing question.
            // Previous approach only grabbed <p> inside the header, missing items outside it.
            let questionText = '';

            const fullParas = Array.from(optionScope.querySelectorAll('p'))
                .filter(p => !p.closest('button[type="submit"]'))
                .map(p => cleanText(p.innerText))
                .filter(t => t.length > 0);

            if (fullParas.length > 0) {
                questionText = sanitizeQuestionText(fullParas.join('\n'));
            }

            // Fallback: header-only paragraphs (preserving \n between paragraphs)
            if (!questionText && questionContainer) {
                const parts = Array.from(questionContainer.querySelectorAll('p'))
                    .map(p => p.innerText)
                    .filter(Boolean);
                questionText = sanitizeQuestionText(parts.join('\n'));
            }

            // Fallback: all non-button paragraphs in optionScope (no limit)
            if (!questionText) {
                const looseParts = Array.from(optionScope.querySelectorAll('p'))
                    .filter(p => !p.closest('button'))
                    .map(p => p.innerText)
                    .filter(Boolean);
                questionText = sanitizeQuestionText(looseParts.join('\n'));
            }

            const optionButtons = optionScope.querySelectorAll('button[type="submit"]');
            const options = [];

            optionButtons.forEach((btn) => {
                const letterRaw = btn.querySelector('strong[aria-label]')?.getAttribute('aria-label') || '';
                const letter = letterRaw.toUpperCase();
                const optionTextEl = btn.querySelector('div.text-neutral-dark-low p') || btn.querySelector('p');
                const optionText = optionTextEl ? cleanText(optionTextEl.innerText) : '';
                if (letter && optionText) {
                    options.push(`${letter}) ${optionText}`);
                    return;
                }
                const fallbackText = cleanText(btn.innerText || '');
                // FIX: Require MANDATORY delimiter and validate false positives
                const match = fallbackText.match(/^\s*([A-E])\s*[).:]\s*(.+)$/i);
                if (match) {
                    const body = match[2].trim();
                    // Validate it is not a false positive (e.g. "A UX" is not an alternative)
                    const isFalsePositive = /^[A-Z]{2,}\s|^UX\s|^UI\s|^TI\s/i.test(body);
                    if (!isFalsePositive) {
                        options.push(`${match[1].toUpperCase()}) ${body}`);
                    }
                }
            });

            if (!questionText) return null;

            const text = options.length >= 2
                ? `${questionText}\n${options.join('\n')}`
                : questionText;

            const anchorCandidates = [];
            if (questionContainer) anchorCandidates.push(questionContainer);
            if (optionButtons[0]) anchorCandidates.push(optionButtons[0]);
            if (optionButtons.length > 1) anchorCandidates.push(optionButtons[optionButtons.length - 1]);
            const anchorEl = pickMostVisible(anchorCandidates) || sectionEl;

            return {
                text: text.substring(0, 3500),
                optionCount: options.length,
                questionLength: questionText.length,
                anchorRect: anchorEl.getBoundingClientRect()
            };
        }

        // Generic, CSS-agnostic extractor:
        // 1) find option anchors (A-E) anywhere in DOM
        // 2) group by nearest container with >=3 distinct letters
        // 3) pick the visible group closest to viewport focus
        // 4) rebuild as "stem + A..E"
        const GENERIC_OPTION_SELECTORS =
            'button[data-testid^="alternative-"], ' +
            'button[data-element*="resposta"], ' +
            'button[class*="alternative"], ' +
            'button[class*="alternativa"], ' +
            'label[for^="option"], .radio-option, ' +
            '[role="radio"], [role="option"], ' +
            '[data-testid^="alternative-"], [data-option]';

        // ╔═══════════════════════════════════════════════════════════════╗
        // ║  ⛔ extractByGenericOptionAnchors — ZONA BLINDADA               ║
        // ║  Resolve extração de opções em QUALQUER framework CSS.          ║
        // ║  Inclui fix crítico de letra fundida (letterFromChild).         ║
        // ║  NÃO TOQUE. NÃO REFATORE. NÃO SIMPLIFIQUE.                    ║
        // ╚═══════════════════════════════════════════════════════════════╝
        function extractByGenericOptionAnchors() {
            const optionNodes = Array.from(document.querySelectorAll(GENERIC_OPTION_SELECTORS));
            if (optionNodes.length < 2) return null;

            const optionCache = new WeakMap();
            const cleanInline = (t) => cleanText(String(t || '').replace(/\s+/g, ' '));
            const isNoiseChunk = (t) => /^(?:marcar para revis[aã]o|respondidas|em branco|finalizar exerc[ií]cio|sair|menu)$/i.test(String(t || '').trim());
            const overlapX = (a, b) => {
                const left = Math.max(a.left, b.left);
                const right = Math.min(a.right, b.right);
                return Math.max(0, right - left);
            };

            const parseOptionNode = (el) => {
                if (!el) return null;
                if (optionCache.has(el)) return optionCache.get(el);

                const fullText = cleanInline(el.innerText || el.textContent || '');
                if (!fullText || fullText.length < 2) {
                    optionCache.set(el, null);
                    return null;
                }

                let letter = '';
                let letterFromChild = false;
                const letterNodes = Array.from(el.querySelectorAll('[data-testid*="letter"], [class*="letter"], small, strong, span, p, div'));
                for (const node of letterNodes) {
                    const tx = cleanInline(node.innerText || node.textContent || '');
                    if (/^[A-E]$/i.test(tx)) {
                        letter = tx.toUpperCase();
                        letterFromChild = true;
                        break;
                    }
                }
                if (!letter) {
                    const m = fullText.match(/^([A-E])(?:\s*[\)\.\-:]\s*|\s+)/i);
                    if (m) letter = (m[1] || '').toUpperCase();
                }
                if (!/^[A-E]$/.test(letter)) {
                    optionCache.set(el, null);
                    return null;
                }

                let body = '';
                let bodyFromFullText = false;
                const bodyCandidates = Array.from(el.querySelectorAll('[data-testid*="question-typography"], [class*="question-typography"], p, div, span'))
                    .map((node) => cleanInline(node.textContent || node.innerText || ''))
                    .filter((txt) => txt && txt.length >= 2 && !/^[A-E]$/i.test(txt));
                if (bodyCandidates.length > 0) {
                    bodyCandidates.sort((a, b) => b.length - a.length);
                    body = bodyCandidates[0];
                }
                if (!body) {
                    body = fullText;
                    bodyFromFullText = true;
                }

                body = cleanInline(body
                    .replace(new RegExp('^' + letter + '\\s*[\\)\\.\\-:]\\s*', 'i'), '')
                    .replace(new RegExp('^' + letter + '\\s+', 'i'), ''));

                // When body came from fullText and letter was found in a separate child element,
                // the letter badge text is fused into the body (e.g. "Afprintf()" → "fprintf()").
                // Strip the leading letter in this case.
                if (bodyFromFullText && letterFromChild && body.length > 1 && body[0].toUpperCase() === letter) {
                    body = body.slice(1).trim();
                }

                const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
                const noiseIdx = body.search(noise);
                if (noiseIdx > 1) body = body.slice(0, noiseIdx).trim();
                body = body.replace(/[;:,\-.\s]+$/, '').trim();

                if (!body || isNoiseChunk(body) || /^[A-Z]{2,}\s|^UX\s|^UI\s|^TI\s/i.test(body)) {
                    optionCache.set(el, null);
                    return null;
                }

                const parsed = {
                    el,
                    letter,
                    body,
                    rect: el.getBoundingClientRect()
                };
                optionCache.set(el, parsed);
                return parsed;
            };

            const parsedOptions = optionNodes
                .map(parseOptionNode)
                .filter(Boolean);

            if (parsedOptions.length < 2) return null;

            const resolveContainer = (opt) => {
                let current = opt.el;
                let best = null;
                let bestTextLen = Infinity;

                for (let depth = 0; current && depth < 10; depth++) {
                    const textLen = cleanText(current.textContent || '').length;
                    if (textLen > 50000) break;

                    const inside = parsedOptions.filter((o) => current.contains(o.el));
                    const letters = new Set(inside.map((o) => o.letter));

                    if (letters.size >= 3 && textLen < bestTextLen) {
                        best = current;
                        bestTextLen = textLen;
                        if (textLen <= 15000) break;
                    }
                    current = current.parentElement;
                }
                return best;
            };

            const byContainer = new Map();
            for (const opt of parsedOptions) {
                const container = resolveContainer(opt);
                if (!container) continue;
                if (!byContainer.has(container)) byContainer.set(container, []);
                byContainer.get(container).push(opt);
            }
            if (byContainer.size === 0) return null;

            const candidates = [];
            const viewportFocusY = window.innerHeight * 0.35;

            const buildStemFromGroup = (container, group) => {
                const sorted = [...group].sort((a, b) => a.rect.top - b.rect.top);
                const optionEls = sorted.map((o) => o.el);
                const firstOpt = sorted[0];
                if (!firstOpt) return '';

                const isOptionRelated = (node) =>
                    optionEls.some((optEl) => optEl === node || optEl.contains(node) || node.contains(optEl));

                const chunks = [];
                const seenChunk = new Set();
                const pushChunk = (rawText, prepend = false) => {
                    const txt = cleanInline(rawText);
                    if (!txt || txt.length < 18 || txt.length > 2200) return;
                    if (isNoiseChunk(txt)) return;
                    if (/^([A-E])\s*(?:[\)\.\-:]|$)/i.test(txt)) return;
                    const key = txt.toLowerCase();
                    if (seenChunk.has(key)) return;
                    seenChunk.add(key);
                    if (prepend) chunks.unshift(txt);
                    else chunks.push(txt);
                };

                // Prefer nearby siblings before the first option (most robust across frameworks)
                let cursor = firstOpt.el;
                for (let level = 0; cursor && level < 5; level++) {
                    const parent = cursor.parentElement;
                    if (!parent) break;

                    let sib = cursor.previousElementSibling;
                    let scanned = 0;
                    while (sib && scanned < 12) {
                        scanned += 1;
                        if (!isOptionRelated(sib)) {
                            pushChunk(sib.innerText || sib.textContent || '', true);
                        }
                        sib = sib.previousElementSibling;
                    }

                    if (parent === container) break;
                    cursor = parent;
                }

                // Geometric fallback: text blocks above the first option and aligned on X axis.
                if (chunks.length === 0) {
                    const optionBand = {
                        left: Math.min(...sorted.map((o) => o.rect.left)),
                        right: Math.max(...sorted.map((o) => o.rect.right))
                    };
                    const firstTop = firstOpt.rect.top;
                    const textNodes = Array.from(container.querySelectorAll('p, div, span, li, h1, h2, h3, h4'));
                    const geoChunks = [];
                    for (const node of textNodes) {
                        if (isOptionRelated(node)) continue;
                        const txt = cleanInline(node.innerText || node.textContent || '');
                        if (!txt || txt.length < 18 || txt.length > 2200 || isNoiseChunk(txt)) continue;
                        const rect = node.getBoundingClientRect();
                        if (rect.bottom > firstTop + 28) continue;
                        if (rect.top < firstTop - 1600) continue;
                        if (overlapX(rect, optionBand) < Math.min(80, (rect.width || 0) * 0.2)) continue;
                        geoChunks.push({ txt, top: rect.top, left: rect.left });
                    }
                    geoChunks.sort((a, b) => a.top - b.top || a.left - b.left);
                    geoChunks.forEach((g) => pushChunk(g.txt));
                }

                let stem = sanitizeQuestionText(chunks.join('\n'));
                stem = stem
                    .replace(/(?:^|\n)\s*(?:enunciado|pergunta)\s*(?=\n|$)/gi, '\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
                return stem;
            };

            for (const [container, containerOpts] of byContainer.entries()) {
                const sorted = [...containerOpts].sort((a, b) => a.rect.top - b.rect.top);
                if (sorted.length < 2) continue;

                // Split by vertical gap to avoid merging multiple questions within the same wrapper.
                const groups = [];
                let currentGroup = [];
                for (let i = 0; i < sorted.length; i++) {
                    const opt = sorted[i];
                    if (currentGroup.length === 0) {
                        currentGroup.push(opt);
                        continue;
                    }
                    const prev = currentGroup[currentGroup.length - 1];
                    const gap = opt.rect.top - prev.rect.top;
                    if (gap > Math.max(72, (prev.rect.height || 20) * 2.4)) {
                        groups.push(currentGroup);
                        currentGroup = [opt];
                    } else {
                        currentGroup.push(opt);
                    }
                }
                if (currentGroup.length > 0) groups.push(currentGroup);

                for (const group of groups) {
                    const letterMap = new Map();
                    for (const opt of group) {
                        if (!letterMap.has(opt.letter) || opt.body.length > letterMap.get(opt.letter).body.length) {
                            letterMap.set(opt.letter, opt);
                        }
                    }
                    if (letterMap.size < 3) continue;

                    const ordered = ['A', 'B', 'C', 'D', 'E']
                        .filter((letter) => letterMap.has(letter))
                        .map((letter) => `${letter}) ${letterMap.get(letter).body}`);

                    if (ordered.length < 2) continue;
                    const stem = buildStemFromGroup(container, group);
                    if (!stem || stem.length < 25) continue;

                    const top = Math.min(...group.map((o) => o.rect.top));
                    const bottom = Math.max(...group.map((o) => o.rect.bottom));
                    const centerY = (top + bottom) / 2;
                    const visibleTop = Math.max(0, top);
                    const visibleBottom = Math.min(window.innerHeight, bottom);
                    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
                    const score =
                        (letterMap.size * 130) +
                        (visibleHeight * 0.8) -
                        (Math.abs(centerY - viewportFocusY) * 1.15) +
                        (/[?]/.test(stem) ? 20 : 0) +
                        (stem.length >= 120 ? 18 : 0);

                    candidates.push({
                        score,
                        optionCount: ordered.length,
                        questionLength: stem.length,
                        text: `${stem}\n${ordered.join('\n')}`.trim().substring(0, 3500)
                    });
                }
            }

            if (candidates.length === 0) return null;
            candidates.sort((a, b) => b.score - a.score);
            return candidates[0];
        }

        // 1) Specific site structure (data-section)
        const activitySections = Array.from(document.querySelectorAll('[data-section="section_cms-atividade"]'));
        const visibleSections = activitySections.filter(isOnScreen);

        // 1) Try to use "Mark for review" button as anchor (more precise)
        const reviewButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(btn => isOnScreen(btn))
            .filter(btn => /Marcar para revis[aã]o/i.test((btn.innerText || btn.textContent || '')));

        if (reviewButtons.length > 0) {
            reviewButtons.sort((a, b) => {
                const topA = Math.abs(a.getBoundingClientRect().top);
                const topB = Math.abs(b.getBoundingClientRect().top);
                return topA - topB;
            });
            const anchored = reviewButtons[0].closest('[data-section="section_cms-atividade"]');
            if (anchored) {
                const anchoredRect = anchored.getBoundingClientRect();
                const anchoredVisibility = getVisibilityRatio(anchoredRect);
                const built = buildFromActivitySection(anchored);
                if (built && anchoredVisibility >= 0.3) {
                    console.log('AnswerHunter: Encontrado via botao Marcar para revisao.');
                    return built.text;
                }
            }
        }

        // 2) Use anchor points in viewport (more precise)
        const probeX = Math.floor(window.innerWidth * 0.5);
        const probeYs = [
            Math.floor(window.innerHeight * 0.15),
            Math.floor(window.innerHeight * 0.3),
            Math.floor(window.innerHeight * 0.5)
        ];
        const hitCount = new Map();

        for (const y of probeYs) {
            const elAtPoint = document.elementFromPoint(probeX, y);
            if (!elAtPoint) continue;
            const anchored = elAtPoint.closest('[data-section="section_cms-atividade"]');
            if (anchored) {
                hitCount.set(anchored, (hitCount.get(anchored) || 0) + 1);
            }
        }

        if (hitCount.size > 0) {
            let bestSection = null;
            let bestHits = 0;
            hitCount.forEach((hits, section) => {
                if (hits > bestHits) {
                    bestHits = hits;
                    bestSection = section;
                }
            });

            if (bestSection && bestHits >= 2) {
                const built = buildFromActivitySection(bestSection);
                if (built) {
                    console.log('AnswerHunter: Encontrado via elementFromPoint (ancora multipla).');
                    return built.text;
                }
            }
        }

        // 3) Fallback: choose by largest visible block and closest top
        const sectionsToScore = visibleSections.length > 0 ? visibleSections : activitySections;
        const scoredCandidates = [];

        const viewportCenter = window.innerHeight / 2;
        for (const section of sectionsToScore) {
            const built = buildFromActivitySection(section);
            if (!built) continue;
            const rect = built.anchorRect || section.getBoundingClientRect();
            const visibleTop = Math.max(0, rect.top);
            const visibleBottom = Math.min(window.innerHeight, rect.bottom);
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            const visibilityRatio = rect.height > 0 ? (visibleHeight / rect.height) : 0;
            const isMostlyVisible = visibilityRatio >= 0.6;

            // Prioritize elements near the top of the viewport instead of the absolute center
            const distanceFromTop = Math.abs(rect.top);
            const isNearTop = distanceFromTop <= window.innerHeight * 0.3;

            const score =
                (built.optionCount * 10) +
                (built.questionLength > 30 ? 5 : 0) +
                (visibleHeight * 0.6) +
                (visibilityRatio * 120) -
                (distanceFromTop * 0.1) +
                (isNearTop ? 50 : 0) +
                (isMostlyVisible ? 30 : 0);

            scoredCandidates.push({ text: built.text, score, rect, visibleHeight });
        }

        if (scoredCandidates.length > 0) {
            scoredCandidates.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const topA = Math.abs(a.rect.top);
                const topB = Math.abs(b.rect.top);
                return topA - topB;
            });
            console.log('AnswerHunter: Encontrado via section_cms-atividade (visibilidade).');
            return scoredCandidates[0].text;
        }

        // 2) Specific question header
        const questionHeader = document.querySelector('[data-testid="openResponseQuestionHeader"]');
        if (questionHeader) {
            const parent = questionHeader.closest('[data-section]') || questionHeader.parentElement;
            const built = buildFromActivitySection(parent || questionHeader);
            if (built) {
                console.log('AnswerHunter: Encontrado via openResponseQuestionHeader.');
                return built.text;
            }
        }

        // 2.5) Generic option-anchored extraction (framework-agnostic)
        const genericAnchored = extractByGenericOptionAnchors();
        if (genericAnchored?.text) {
            console.log(`AnswerHunter: Encontrado via option-anchor generico (opts=${genericAnchored.optionCount}, score=${genericAnchored.score.toFixed(1)}).`);
            return genericAnchored.text;
        }

        // 3) Manual selection (if any)
        const selection = window.getSelection ? window.getSelection().toString() : '';
        if (selection && selection.trim().length > 5) {
            console.log('AnswerHunter: Usando selecao manual.');
            return sanitizeQuestionText(selection).substring(0, 3500);
        }

        // 4) Minimal fallback (no global text)
        const containers = document.querySelectorAll('main, article, section, div, form');
        let best = { score: -999, text: '' };

        function scoreContainer(el) {
            if (!isOnScreen(el)) return null;
            const text = cleanText(el.innerText || '');
            if (text.length < 30 || text.length > 6000) return null;
            const rect = el.getBoundingClientRect();
            let score = 0;

            if (text.includes('?')) score += 6;
            if (/Atividade|Quest|Exercicio|Pergunta|Enunciado/i.test(text)) score += 4;
            if (/[A-E]\)\s+|[A-E]\.\s+/i.test(text)) score += 4;
            if (el.querySelectorAll('button[type="submit"]').length >= 2) score += 4;
            if (rect.top >= 0 && rect.top < 350) score += 2;
            // Bonus for structured questions with Roman numeral assertion items (I., II., III.)
            if (/\bI\.\s+\S/.test(text) && /\bII\.\s+\S/.test(text)) score += 5;
            // Bonus for common conclusion patterns
            if (/Quais\s+afirmativas|Assinale|Est[aá]\s+corret/i.test(text)) score += 3;

            // Penalize containers that are too large (likely contain multiple questions)
            if (text.length > 3000) score -= 3;

            // Penalize menus/sidebars
            if (/menu|disciplina|progresso|conteudos|concluidos|simulados|acessar|ola\b/i.test(text)) score -= 8;
            if (rect.width < window.innerWidth * 0.35) score -= 4;
            if (rect.left > window.innerWidth * 0.55) score -= 3;

            return { score, text };
        }

        containers.forEach((el) => {
            const candidate = scoreContainer(el);
            if (candidate && candidate.score > best.score) best = candidate;
        });

        if (best.text) {
            console.log('AnswerHunter: Fallback heuristico usado.');
            return sanitizeQuestionText(best.text).substring(0, 3500);
        }

        console.log('AnswerHunter: Nenhuma questao encontrada.');
        return '';
    },

    /**
     * PHASE 1.1 — Viewport-centric extraction
     * Uses elementFromPoint on a grid of viewport positions to find the question
     * container that occupies the most central/visible area. This is independent
     * of site-specific selectors and works on any educational platform.
     * Returns { text, confidence, containerTag } or null.
     *
     * ⛔ FROZEN — NÃO MODIFIQUE. O grid de probes, os thresholds de scoring,
     * e a lógica de isolamento de questão foram calibrados empiricamente.
     * Alterar QUALQUER número aqui causa falha silenciosa em produção.
     */
    extractViewportCentricScript: function () {
        function cleanText(text) {
            return (text || '').replace(/[ \t\r]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
        }
        function sanitize(text) {
            if (!text) return '';
            let c = cleanText(text);
            c = c.replace(/\bMarcar para revis(?:a|ã)o\b/gi, '');
            c = c.replace(/^\s*\d+\s*[-.)]?\s*/i, '');
            c = c.replace(/^(?:Quest(?:a|ã)o|Questao)\s*\d+\s*[:.\-]?\s*/i, '');
            return c.trim();
        }
        function countOptions(text) {
            if (!text) return 0;
            const m = text.match(/(?:^|\n)\s*[A-E]\s*[\)\.\-:]\s*\S/gi) || [];
            return new Set(m.map(x => x.trim().charAt(0).toUpperCase())).size;
        }

        const W = window.innerWidth;
        const H = window.innerHeight;

        // Grid of probe points — weighted towards center and upper half
        const probes = [];
        const xPcts = [0.25, 0.4, 0.5, 0.6, 0.75];
        const yPcts = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
        for (const xp of xPcts) {
            for (const yp of yPcts) {
                probes.push({ x: Math.floor(W * xp), y: Math.floor(H * yp) });
            }
        }

        // Collect all unique elements hit by probes and their ancestors
        const hitMap = new Map(); // el -> { hits, minDist }
        const centerX = W / 2;
        const centerY = H * 0.35; // slightly above center (questions tend to be upper)

        for (const p of probes) {
            const el = document.elementFromPoint(p.x, p.y);
            if (!el || el === document.body || el === document.documentElement) continue;

            // Walk up to find suitable container (not too small, not too large)
            let current = el;
            for (let i = 0; i < 12; i++) {
                if (!current || current === document.body) break;
                const text = cleanText(current.innerText || '');
                const rect = current.getBoundingClientRect();

                // Skip tiny elements, skip menus/sidebars
                if (text.length < 40 || rect.width < W * 0.3) {
                    current = current.parentElement;
                    continue;
                }

                // Skip elements that are too large (whole page body)
                if (text.length > 8000) break;

                const dist = Math.sqrt(
                    Math.pow(rect.left + rect.width / 2 - centerX, 2) +
                    Math.pow(rect.top + rect.height / 2 - centerY, 2)
                );

                const key = current;
                const existing = hitMap.get(key);
                if (existing) {
                    existing.hits++;
                    existing.minDist = Math.min(existing.minDist, dist);
                } else {
                    hitMap.set(key, { el: current, hits: 1, minDist: dist, textLen: text.length });
                }
                break; // found a suitable container for this probe
            }
        }

        if (hitMap.size === 0) return null;

        // Score each candidate container
        let bestCandidate = null;
        let bestScore = -Infinity;

        for (const [, entry] of hitMap) {
            const text = cleanText(entry.el.innerText || '');
            if (text.length < 40) continue;
            const opts = countOptions(text);
            const hasQ = text.includes('?');
            const isMenu = /menu|disciplina|progresso|conteudos|concluidos|simulados|acessar|ola\b|voltar|avançar/i.test(text);
            if (isMenu) continue;

            const rect = entry.el.getBoundingClientRect();
            const isMainContent = rect.width >= W * 0.35 && rect.left < W * 0.5;

            let score = 0;
            score += entry.hits * 25;                                    // more probe hits = more central
            score -= entry.minDist * 0.15;                               // closer to center = better
            score += opts * 80;                                          // options are strong signal
            score += hasQ ? 20 : 0;                                      // question mark
            score += isMainContent ? 40 : 0;                             // in main content area
            score += /[A-E]\)\s+|button\[type="submit"\]/i.test(text) ? 15 : 0;
            // Bonus for structured questions with Roman numeral assertion items
            const hasRomanItems = /\bI\.\s+\S/.test(text) && /\bII\.\s+\S/.test(text);
            score += hasRomanItems ? 35 : 0;
            score -= text.length > 4000 ? 30 : 0;                       // too large = multi-question risk
            score += text.length >= 100 && text.length <= 2500 ? 20 : 0; // ideal question length

            if (score > bestScore) {
                bestScore = score;
                bestCandidate = { el: entry.el, text, opts, score };
            }
        }

        if (!bestCandidate || bestCandidate.text.length < 40) return null;

        // Isolate to first question if text contains multiple
        let finalText = bestCandidate.text;
        const secondQStart = finalText.search(/\n\s*\d+\s*[\.\)]\s*(?=[A-ZÀ-ÖÙ-ÝÉ])/);
        if (secondQStart > 100 && countOptions(finalText.substring(0, secondQStart)) >= 2) {
            finalText = finalText.substring(0, secondQStart).trim();
        }

        return {
            text: sanitize(finalText).substring(0, 3500),
            confidence: Math.min(0.95, bestCandidate.opts >= 3 ? 0.9 : bestCandidate.opts >= 2 ? 0.75 : 0.5),
            containerTag: bestCandidate.el.tagName?.toLowerCase() || 'unknown',
            probeHits: hitMap.get(bestCandidate.el)?.hits || 0,
            optionCount: bestCandidate.opts,
            bbox: (() => {
                try {
                    const rect = bestCandidate.el.getBoundingClientRect();
                    const left = Math.max(0, Math.round(rect.left));
                    const top = Math.max(0, Math.round(rect.top));
                    const right = Math.min(window.innerWidth, Math.round(rect.right));
                    const bottom = Math.min(window.innerHeight, Math.round(rect.bottom));
                    return {
                        left,
                        top,
                        width: Math.max(0, right - left),
                        height: Math.max(0, bottom - top),
                        viewportWidth: Math.max(1, Math.round(window.innerWidth || 1)),
                        viewportHeight: Math.max(1, Math.round(window.innerHeight || 1)),
                        dpr: Number(window.devicePixelRatio || 1)
                    };
                } catch (_) {
                    return null;
                }
            })()
        };
    },

    /**
     * Hover-first extraction:
     * Use the element currently under :hover as the primary anchor and walk up
     * to a question-like container with alternatives.
     */
    extractHoveredQuestionScript: function () {
        function cleanText(text) {
            return (text || '').replace(/[ \t\r]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
        }
        function sanitize(text) {
            if (!text) return '';
            let c = cleanText(text);
            c = c.replace(/\bMarcar para revis(?:a|ã)o\b/gi, '');
            c = c.replace(/^\s*\d+\s*[-.)]?\s*/i, '');
            c = c.replace(/^(?:Quest(?:a|ã)o|Questao)\s*\d+\s*[:.\-]?\s*/i, '');
            return c.trim();
        }
        function countOptions(text) {
            if (!text) return 0;
            const m = text.match(/(?:^|\n)\s*["'“”‘’]?\s*([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*\S/gi) || [];
            const letters = new Set();
            m.forEach((line) => {
                const mm = String(line || '').match(/([A-E])/i);
                if (mm?.[1]) letters.add(mm[1].toUpperCase());
            });
            return letters.size;
        }
        function isVisible(el) {
            if (!el || !el.getBoundingClientRect) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 20 || rect.height < 12) return false;
            const style = window.getComputedStyle(el);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
            return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        }
        function looksLikeQuestion(text) {
            return /[?]/.test(String(text || ''))
                || /(?:assinale|marque|considere|analise|qual(?:is)?|quest[aã]o|pergunta|afirmativas?|itens?)/i.test(String(text || ''));
        }
        function buildBbox(rect) {
            const left = Math.max(0, Math.round(rect.left));
            const top = Math.max(0, Math.round(rect.top));
            const right = Math.min(window.innerWidth, Math.round(rect.right));
            const bottom = Math.min(window.innerHeight, Math.round(rect.bottom));
            return {
                left,
                top,
                width: Math.max(0, right - left),
                height: Math.max(0, bottom - top),
                viewportWidth: Math.max(1, Math.round(window.innerWidth || 1)),
                viewportHeight: Math.max(1, Math.round(window.innerHeight || 1)),
                dpr: Number(window.devicePixelRatio || 1)
            };
        }

        const hovered = Array.from(document.querySelectorAll(':hover')).filter(Boolean);
        if (hovered.length === 0) return null;

        const anchor = hovered[hovered.length - 1];
        if (!anchor || anchor === document.body || anchor === document.documentElement) return null;

        let best = null;
        let current = anchor;
        for (let depth = 0; current && depth < 12; depth++) {
            if (!isVisible(current)) {
                current = current.parentElement;
                continue;
            }
            const rect = current.getBoundingClientRect();
            const text = cleanText(current.innerText || current.textContent || '');
            if (!text || text.length < 40 || text.length > 25000) {
                current = current.parentElement;
                continue;
            }
            const opts = countOptions(text);
            const qLike = looksLikeQuestion(text);
            const centerY = rect.top + (rect.height / 2);
            const distance = Math.abs(centerY - window.innerHeight * 0.35);
            const score = (opts * 120) + (qLike ? 40 : 0) - (distance * 0.25) + Math.min(45, text.length / 70);

            if (!best || score > best.score) {
                best = {
                    score,
                    text,
                    opts,
                    rect,
                    tag: current.tagName?.toLowerCase() || 'unknown'
                };
            }

            if (opts >= 3 && text.length <= 6500) break;
            current = current.parentElement;
        }

        if (!best || !best.text || best.text.length < 40) return null;
        return {
            text: sanitize(best.text).slice(0, 3500),
            confidence: Math.min(0.98, best.opts >= 3 ? 0.95 : best.opts >= 2 ? 0.82 : 0.62),
            optionCount: best.opts,
            containerTag: best.tag,
            probeHits: 1,
            bbox: buildBbox(best.rect),
            anchor: 'hover'
        };
    },

    /**
     * Extract ONLY alternatives (when statement is already captured)
     * IMPORTANT: This function tries to find alternatives for the most relevant VISIBLE question
     * Identifies the question section by "Mark for review" marker or question header.
     */
    extractOptionsOnlyScript: function () {
        function cleanText(text) {
            return (text || '').replace(/[ \t\r]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
        }

        const OPTION_SELECTORS =
            'button[data-testid^="alternative-"], ' +
            'button[data-element="link_resposta"], ' +
            '[data-testid^="alternative-"], ' +
            '[class*="alternative"], ' +
            '[class*="alternativa"], ' +
            'label[for^="option"], ' +
            '.radio-option, ' +
            'label:has(input[type="radio"]), ' +
            '[role="radio"], [role="option"]';

        function normalizeText(text) {
            return (text || '')
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '')
                .replace(/\s+/g, '')
                .trim();
        }

        function looksLikeQuestionLine(text) {
            return /assinale|considerando|analise|marque|afirmativa|correta|incorreta|quest[aã]o|enunciado|pergunta/i.test(text || '');
        }

        function isOnScreen(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            return rect.width > 30 && rect.height > 15 &&
                rect.bottom > 0 && rect.top < window.innerHeight &&
                rect.right > 0 && rect.left < window.innerWidth;
        }

        function getVisibleArea(rect) {
            const left = Math.max(0, rect.left);
            const right = Math.min(window.innerWidth, rect.right);
            const top = Math.max(0, rect.top);
            const bottom = Math.min(window.innerHeight, rect.bottom);
            return Math.max(0, right - left) * Math.max(0, bottom - top);
        }

        function getQuestionTextFromHeader() {
            const headerNodes = Array.from(document.querySelectorAll('[data-testid="openResponseQuestionHeader"]'))
                .filter(el => isOnScreen(el));
            if (headerNodes.length === 0) return '';
            let bestHeader = headerNodes[0];
            let bestArea = 0;
            for (const h of headerNodes) {
                const area = getVisibleArea(h.getBoundingClientRect());
                if (area > bestArea) {
                    bestArea = area;
                    bestHeader = h;
                }
            }
            const parts = Array.from(bestHeader.querySelectorAll('p, span, div'))
                .map(el => cleanText(el.innerText || el.textContent || ''))
                .filter(t => t.length >= 8);
            return parts.length > 0 ? parts.join(' ') : cleanText(bestHeader.innerText || bestHeader.textContent || '');
        }

        const questionText = getQuestionTextFromHeader();

        function isLikelyQuestionBody(body) {
            if (!body) return false;
            if (looksLikeQuestionLine(body)) return true;
            if (/\(.*?\/\d{4}.*?\)/.test(body)) return true;

            const bNorm = normalizeText(body);
            const qNorm = normalizeText(questionText);
            if (bNorm.length >= 40 && qNorm.length >= 40) {
                if (qNorm.includes(bNorm)) return true;
                const _tokenize = (s) => (s || '')
                    .toLowerCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9]+/g, ' ').trim()
                    .split(/\s+/)
                    .filter(t => t.length >= 3);
                const bTokens = _tokenize(body);
                const qTokens = new Set(_tokenize(questionText));
                if (bTokens.length >= 6) {
                    let hit = 0;
                    for (const t of bTokens) {
                        if (qTokens.has(t)) hit += 1;
                    }
                    if (hit / bTokens.length >= 0.6) return true;
                }
            }
            return false;
        }

        function isNoiseElement(el) {
            if (!el) return false;
            const attr = (el.getAttribute && (el.getAttribute('data-testid') || '')) || '';
            if (/right-answer-alert|wrong-answer-alert|info-box/i.test(attr)) return true;
            const className = (el.className || '').toString();
            if (/gabarito|comentado|resposta/i.test(className)) return true;
            const text = cleanText(el.innerText || el.textContent || '');
            return /Gabarito|Resposta correta|Resposta incorreta/i.test(text);
        }

        function countPotentialOptions(rootEl) {
            if (!rootEl || !rootEl.querySelectorAll) return 0;
            try {
                const bySelector = rootEl.querySelectorAll(OPTION_SELECTORS).length;
                if (bySelector > 0) return bySelector;
            } catch (_) { }

            const raw = cleanText(rootEl.textContent || rootEl.innerText || '');
            if (!raw) return 0;
            const m = raw.match(/(?:^|\s)([A-E])\s*[\)\-:]\s*\S/gi) || [];
            return m.length;
        }

        // Expand a visible anchor to the full question scope that contains the alternatives,
        // so off-screen options (e.g. E) are still captured.
        function resolveQuestionScope(anchorEl) {
            if (!anchorEl) return null;

            let current = anchorEl;
            let best = anchorEl;
            let bestScore = -1;

            for (let depth = 0; current && depth < 12; depth++) {
                const optCount = countPotentialOptions(current);
                const textLen = cleanText(current.textContent || '').length;
                // Prefer smallest ancestor that already has enough options.
                // Penalize overly huge containers to avoid multi-question bleed.
                const sizePenalty = textLen > 35000 ? 4 : textLen > 18000 ? 2 : 0;
                const score = (optCount * 10) - sizePenalty;

                if (score > bestScore) {
                    bestScore = score;
                    best = current;
                }

                if (optCount >= 4 && textLen <= 25000) {
                    best = current;
                    break;
                }

                if (current.matches && current.matches('[data-section="section_cms-atividade"], section, article, form, main')) {
                    if (optCount >= 2) {
                        best = current;
                        break;
                    }
                }

                current = current.parentElement;
            }

            return best || anchorEl;
        }

        function extractOptionsFromButtons(rootEl) {
            if (!rootEl) return [];
            const options = [];
            const seenLetters = new Set();

            const buttons = rootEl.querySelectorAll(OPTION_SELECTORS);

            for (const btn of buttons) {
                if (isNoiseElement(btn) || isNoiseElement(btn.parentElement)) continue;

                const letterEl =
                    btn.querySelector('[data-testid="circle-letter"]') ||
                    btn.querySelector('[class*="letter"]') ||
                    btn.querySelector('small, strong, span');

                let letterText = cleanText(letterEl ? (letterEl.innerText || letterEl.textContent || '') : '');

                if (!/^[A-E]$/i.test(letterText)) {
                    const fullText = cleanText(btn.innerText || btn.textContent || '');
                    // FIX: Require MANDATORY delimiter to avoid confusing "A UX" with alternative
                    const letterMatch = fullText.match(/^([A-E])\s*[\)\.]\s+/i);
                    if (letterMatch) letterText = letterMatch[1];
                }

                const letter = /^[A-E]$/i.test(letterText) ? letterText.toUpperCase() : '';

                const textEl =
                    btn.querySelector('[data-testid="question-typography"]') ||
                    btn.querySelector('p, div');

                let raw = cleanText(textEl ? (textEl.textContent || textEl.innerText || '') : '');
                if (!raw || raw.length < 5) {
                    raw = cleanText(btn.textContent || btn.innerText || '');
                }

                // Strip leading letter+delimiter (e.g. "A) text" or "A. text").
                // Also handle bare letter prefix without delimiter (e.g. "E JSON" when
                // letter was already captured from a circle element).
                let body = cleanText(raw.replace(/^[A-E]\s*[\)\.\-:]\s*/i, '').trim());
                if (letter && body && new RegExp('^' + letter + '\\s+', 'i').test(body)) {
                    body = body.replace(new RegExp('^' + letter + '\\s+', 'i'), '').trim();
                }

                const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
                const idx = body.search(noise);
                if (idx > 1) body = body.slice(0, idx).trim();
                body = body.replace(/[;:,\-.\s]+$/, '');

                const isFalsePositive = !body || /^[A-Z]{2,}\s|^UX\s|^UI\s|^TI\s/i.test(body);
                // Only flag as question-like if body is long enough to reliably match
                const isQuestionLike = body.length >= 30 && isLikelyQuestionBody(body);

                if (letter && body && body.length >= 1 && !seenLetters.has(letter) && !isFalsePositive && !isQuestionLike) {
                    options.push(`${letter}) ${body}`);
                    seenLetters.add(letter);
                }
            }

            return options.length >= 2 ? options : [];
        }

        function extractOptionsFromText(rawText) {
            if (!rawText) return [];
            const lines = rawText.split(/\n+/).map(line => line.trim()).filter(Boolean);
            const alternatives = [];
            const altStartRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
            let current = null;

            for (const line of lines) {
                const m = line.match(altStartRe);
                if (m) {
                    const body = cleanText(m[2]);
                    // Validate it is not a false positive (e.g. "A UX" is not an alternative)
                    const isFalsePositive = /^[A-Z]{2,}\s|^UX\s|^UI\s|^TI\s/i.test(body);
                    // Only reject as question-like if body is long enough to reliably classify
                    const isQuestionLike = body.length >= 30 && isLikelyQuestionBody(body);

                    if (!isFalsePositive && !isQuestionLike) {
                        if (current) alternatives.push(current);
                        current = { letter: m[1].toUpperCase(), body: body };
                        if (alternatives.length >= 5) break;
                    }
                } else if (current) {
                    current.body = cleanText(`${current.body} ${line}`);
                }
            }

            if (current) {
                let body = cleanText(current.body || '');
                const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
                const idx = body.search(noise);
                if (idx > 1) body = body.slice(0, idx).trim();
                body = body.replace(/[;:,\-.\s]+$/, '');
                current.body = body;
                if (body && alternatives.length < 5) alternatives.push(current);
            }

            for (const alt of alternatives) {
                const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
                const idx = alt.body.search(noise);
                if (idx > 1) alt.body = alt.body.slice(0, idx).trim();
                alt.body = alt.body.replace(/[;:,\-.\s]+$/, '');
            }

            let merged = alternatives
                .filter(a => a.body && a.body.length >= 1)
                .slice(0, 5)
                .map(a => `${a.letter}) ${a.body}`);

            return merged.length >= 2 ? merged : [];
        }

        function extractFromSection(sectionEl) {
            if (!sectionEl) return [];
            const scoped = resolveQuestionScope(sectionEl) || sectionEl;
            let opts = extractOptionsFromButtons(scoped);
            if (opts.length >= 2) return opts;
            opts = extractOptionsFromText(scoped.textContent || scoped.innerText || '');
            return opts;
        }

        // Try to identify the active question section (same logic as extractQuestionOnlyScript)
        const reviewButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(btn => /Marcar para revis[aã]o/i.test((btn.innerText || '').trim()))
            .filter(btn => isOnScreen(btn));

        let targetSection = null;

        if (!targetSection) {
            const viewportCenterY = window.innerHeight / 2;
            const questionBlocks = Array.from(document.querySelectorAll('[data-testid^="question-"]'))
                .filter(el => isOnScreen(el));

            let bestBlock = null;
            let bestScore = -Infinity;

            for (const block of questionBlocks) {
                const rect = block.getBoundingClientRect();
                const visibleArea = getVisibleArea(rect);
                if (visibleArea <= 0) continue;

                const blockCenterY = rect.top + (rect.height / 2);
                const distCenter = Math.abs(blockCenterY - viewportCenterY);
                const optionsCount = extractFromSection(block).length;

                const score = (optionsCount * 220) + (visibleArea / 900) - (distCenter * 1.6);
                if (score > bestScore) {
                    bestScore = score;
                    bestBlock = block;
                }
            }

            if (bestBlock) {
                targetSection = bestBlock;
                console.log('AnswerHunter: extractOptionsOnlyScript - usando bloco data-testid question-*');
            }
        }

        if (reviewButtons.length > 0) {
            reviewButtons.sort((a, b) => {
                const topA = Math.abs(a.getBoundingClientRect().top - window.innerHeight * 0.2);
                const topB = Math.abs(b.getBoundingClientRect().top - window.innerHeight * 0.2);
                return topA - topB;
            });
            targetSection = targetSection || reviewButtons[0].closest('[data-section="section_cms-atividade"]');
        }

        if (!targetSection) {
            const headerNodes = Array.from(document.querySelectorAll('[data-testid="openResponseQuestionHeader"]'))
                .filter(el => isOnScreen(el));
            if (headerNodes.length > 0) {
                let bestHeader = headerNodes[0];
                let bestArea = 0;
                for (const h of headerNodes) {
                    const area = getVisibleArea(h.getBoundingClientRect());
                    if (area > bestArea) {
                        bestArea = area;
                        bestHeader = h;
                    }
                }
                targetSection = bestHeader.closest('[data-section="section_cms-atividade"]') ||
                    bestHeader.closest('section, article, form');
            }
        }

        if (targetSection) {
            targetSection = resolveQuestionScope(targetSection) || targetSection;
            console.log('AnswerHunter: extractOptionsOnlyScript - usando seção específica');
            const opts = extractFromSection(targetSection);
            if (opts.length >= 2) {
                return opts.slice(0, 5).join('\n');
            }
        }

        // Fallback: search in general viewport
        console.log('AnswerHunter: extractOptionsOnlyScript - fallback para viewport geral');
        const candidates = Array.from(document.querySelectorAll('[data-testid="feedback-container"], section, article, div, form'));
        let best = { score: -1, options: [] };

        for (const el of candidates) {
            if (!isOnScreen(el)) continue;
            const opts = extractFromSection(el);
            if (opts.length < 2 || opts.length > 5) continue;
            const rect = el.getBoundingClientRect();
            const score = opts.length * 100 + getVisibleArea(rect) / 1000;
            if (score > best.score) {
                best = { score, options: opts };
            }
        }

        return best.options.length >= 2 ? best.options.slice(0, 5).join('\n') : '';
    },


    /**
     * Extracts answer key displayed on page (post-answer), when it exists.
     * Returns { letter, confidence, source, evidence } or null.
     */
    

  extractPasseiDiretoExplicitAnswerScript: function (questionText = '') {
    const normalize = (t) => String(t || '').replace(/\s+/g, '').trim();
    const text = normalize(document?.body?.innerText || '');
    if (!text) return null;

    const patterns = [
      { re: /portanto,?\s*a\s*alternativa\s*correta\s*(?:é|e)\s*[:-]?\s*([A-E])\s*[).-:]/i, confidence: 0.97, source: 'pd-portanto' },
      { re: /alternativa\s*correta\s*(?:é|e)\s*[:-]?\s*([A-E])\s*[).-:]/i, confidence: 0.94, source: 'pd-alternativa-correta' },
      { re: /resposta\s*correta\s*(?:é|e)?\s*[:-]?\s*([A-E])\s*[).-:]/i, confidence: 0.92, source: 'pd-resposta-correta' },
      { re: /gabarito\s*[:-]?\s*([A-E])\b/i, confidence: 0.90, source: 'pd-gabarito' },
      { re: /\bR\s*[:-]\s*([A-E])\b/i, confidence: 0.88, source: 'pd-r-letra' }
    ];

    let best = null;
    for (const p of patterns) {
      const m = text.match(p.re);
      if (!m) continue;
      const letter = String(m[1] || '').toUpperCase();
      if (!/^[A-E]$/.test(letter)) continue;

      const hit = text.search(p.re);
      const start = Math.max(0, hit - 120);
      const end = Math.min(text.length, hit + 220);

      const candidate = {
        letter,
        confidence: p.confidence,
        source: p.source,
        evidence: text.slice(start, end)
      };

      if (!best || candidate.confidence > best.confidence) best = candidate;
    }

    return best;
  },


  extractCanonicalExplicitAnswerScript: function () {
    const text = String(document?.body?.innerText || '').replace(/\s+/g, '').trim();
    if (!text) return null;

    const patterns = [
      { re: /portanto,?\s*a\s*resposta\s*correta\s*(?:é|e)\s*a\s*alternativa\s*([A-E])\b/i, c: 0.98, m: 'explicit-portanto' },
      { re: /alternativa\s*correta\s*(?:é|e)\s*(?:a\s*letra\s*)?([A-E])\b/i, c: 0.96, m: 'explicit-alternativa' },
      { re: /resposta\s*correta\s*(?:é|e)\s*(?:a\s*letra\s*)?([A-E])\b/i, c: 0.94, m: 'explicit-resposta' },
      { re: /gabarito\s*[:-]?\s*([A-E])\b/i, c: 0.92, m: 'explicit-gabarito' }
    ];

    for (const p of patterns) {
      const m = text.match(p.re);
      if (m && /^[A-E]$/i.test(m[1])) {
        return {
          letter: m[1].toUpperCase(),
          confidence: p.c,
          method: p.m,
          evidence: text.slice(Math.max(0, text.search(p.re)-120), Math.min(text.length, text.search(p.re)+220))
        };
      }
    }
    return null;
  },
extractGabaritoFromPageScript: function (questionText = '') {
    const canonical = this.extractCanonicalExplicitAnswerScript();
    if (canonical && /^[A-E]$/.test(canonical.letter || '')) return canonical;
    const pdExplicit = this.extractPasseiDiretoExplicitAnswerScript(questionText);
    if (pdExplicit && /^[A-E]$/.test(pdExplicit.letter || '')) {
      return pdExplicit;
    }
        try {
            const raw = String(document.body?.innerText || '');
            if (!raw || raw.length < 30) return null;

            const normalize = (t) => String(t || '')
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '')
                .trim();

            const qNorm = normalize(questionText).slice(0, 240);

            const patterns = [
                { re: /resposta\s+correta\s*[:\-]\s*(?:letra\s+)?([A-E])\b/gi, confidence: 0.95, source: 'resposta-correta' },
                { re: /gabarito\s*[:\-]\s*(?:letra\s+)?([A-E])\b/gi, confidence: 0.95, source: 'gabarito' },
                { re: /alternativa\s+correta\s*[:\-]\s*(?:letra\s+)?([A-E])\b/gi, confidence: 0.85, source: 'alternativa-correta' },
                { re: /\bletra\s+([A-E])\b\s*(?:é|e|esta|est[aá])\s*(?:a\s+)?(?:correta|certa|verdadeira)\b/gi, confidence: 0.75, source: 'letra-correta' }
            ];

            let best = null;
            for (const p of patterns) {
                p.re.lastIndex = 0;
                let m;
                while ((m = p.re.exec(raw)) !== null) {
                    const letter = String(m[1] || '').toUpperCase();
                    if (!/^[A-E]$/.test(letter)) continue;

                    const start = Math.max(0, m.index - 180);
                    const end = Math.min(raw.length, m.index + 220);
                    const evidence = raw.substring(start, end).replace(/\s+/g, '').trim();

                    let conf = p.confidence;
                    if (qNorm && qNorm.length >= 40) {
                        const qStart = qNorm.slice(0, 80);
                        if (qStart.length >= 30 && !normalize(evidence).includes(qStart.slice(0, 50))) {
                            conf = Math.max(0.55, conf - 0.2);
                        }
                    }

                    if (!best || conf > best.confidence) {
                        best = { letter, confidence: conf, source: p.source, evidence };
                    }
                }
            }

            return best;
        } catch (_) {
            return null;
        }
    },
    // Alias for getSelectionScript if needed, or use extractQuestionOnlyScript directly which already has manual Fallback
    getSelectionScript: function () {
        return window.getSelection().toString().trim();
    },

    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║  ⛔ extractViewportHtmlScript — EXTRAÇÃO DE HTML DO VIEWPORT        ║
    // ║  NÃO REMOVA. Retorna o HTML bruto da área de viewport onde a        ║
    // ║  questão está. Usado pela extração inteligente (vision-guided)      ║
    // ║  para enviar HTML + screenshot à LLM, que encontra a questão        ║
    // ║  COMPLETA no HTML mesmo quando recortada/incompleta na tela.        ║
    // ║  Última calibração: 2026-03-04                                      ║
    // ╚══════════════════════════════════════════════════════════════════════╝
    extractViewportHtmlScript: function () {
        try {
            const W = window.innerWidth;
            const H = window.innerHeight;

            // ── Probe grid: find DOM container holding the question ──
            const probes = [];
            for (const xp of [0.25, 0.4, 0.5, 0.6, 0.75]) {
                for (const yp of [0.15, 0.25, 0.35, 0.45, 0.55, 0.65]) {
                    probes.push({ x: Math.floor(W * xp), y: Math.floor(H * yp) });
                }
            }

            const hitMap = new Map();
            const centerX = W / 2;
            const centerY = H * 0.35;

            for (const p of probes) {
                let el = document.elementFromPoint(p.x, p.y);
                if (!el || el === document.body || el === document.documentElement) continue;

                for (let i = 0; i < 10; i++) {
                    if (!el || el === document.body || el === document.documentElement) break;
                    const text = (el.innerText || '').trim();
                    const rect = el.getBoundingClientRect();

                    if (text.length < 40 || rect.width < W * 0.3) {
                        el = el.parentElement;
                        continue;
                    }
                    if (text.length > 10000) break;

                    const dist = Math.sqrt(
                        Math.pow(rect.left + rect.width / 2 - centerX, 2) +
                        Math.pow(rect.top + rect.height / 2 - centerY, 2)
                    );

                    const key = el;
                    const existing = hitMap.get(key);
                    if (existing) {
                        existing.hits++;
                        existing.minDist = Math.min(existing.minDist, dist);
                    } else {
                        hitMap.set(key, { el, hits: 1, minDist: dist, textLen: text.length });
                    }
                    break;
                }
            }

            if (hitMap.size === 0) return null;

            // ── Score candidates ──
            let bestCandidate = null;
            let bestScore = -Infinity;
            for (const [, entry] of hitMap) {
                const text = (entry.el.innerText || '').trim();
                if (text.length < 40) continue;
                const isMenu = /menu|disciplina|progresso|conteudos|concluidos|simulados|acessar|voltar|avançar/i.test(text);
                if (isMenu) continue;

                const optMatches = text.match(/(?:^|\n)\s*[A-E]\s*[\)\.\-:]\s*\S/gi) || [];
                const optCount = new Set(optMatches.map(x => x.trim().charAt(0).toUpperCase())).size;
                const rect = entry.el.getBoundingClientRect();
                const isMainContent = rect.width >= W * 0.35;

                let score = entry.hits * 25 - entry.minDist * 0.15 + optCount * 80;
                score += isMainContent ? 40 : 0;
                score += text.includes('?') ? 20 : 0;
                score -= text.length > 4000 ? 30 : 0;
                score += text.length >= 100 && text.length <= 2500 ? 20 : 0;

                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = entry;
                }
            }

            if (!bestCandidate) return null;

            // ── Sanitize HTML: strip scripts, styles, svgs, data attrs ──
            function sanitizeHtml(html) {
                let h = html;
                // Remove <script>, <style>, <svg>, <noscript>, <link>, <meta> and contents
                h = h.replace(/<(script|style|svg|noscript|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
                h = h.replace(/<(script|style|svg|noscript|link|meta)\b[^>]*\/?\s*>/gi, '');
                // Remove data-* attributes and style="" to reduce size
                h = h.replace(/\s+data-[\w-]+="[^"]*"/gi, '');
                h = h.replace(/\s+data-[\w-]+='[^']*'/gi, '');
                h = h.replace(/\s+style="[^"]*"/gi, '');
                h = h.replace(/\s+style='[^']*'/gi, '');
                // Remove event handlers
                h = h.replace(/\s+on\w+="[^"]*"/gi, '');
                // Collapse whitespace
                h = h.replace(/\s{2,}/g, ' ');
                return h.trim();
            }

            // ── Get outerHTML: walk up to parent for broader context ──
            let htmlEl = bestCandidate.el;
            // Walk up 1-2 levels if parent is not too large
            for (let up = 0; up < 2; up++) {
                if (!htmlEl.parentElement || htmlEl.parentElement === document.body || htmlEl.parentElement === document.documentElement) break;
                const parentText = (htmlEl.parentElement.innerText || '').trim();
                if (parentText.length > 15000) break;
                htmlEl = htmlEl.parentElement;
            }

            let rawHtml = sanitizeHtml(htmlEl.outerHTML || '');
            // Hard limit: 15K chars (to fit in LLM context with screenshot)
            if (rawHtml.length > 15000) {
                rawHtml = rawHtml.substring(0, 15000) + '<!-- ...truncated -->';
            }

            return {
                html: rawHtml,
                textPreview: (bestCandidate.el.innerText || '').substring(0, 300),
                containerTag: bestCandidate.el.tagName?.toLowerCase() || 'unknown',
                htmlLength: rawHtml.length
            };
        } catch (_) {
            return null;
        }
    }
};
