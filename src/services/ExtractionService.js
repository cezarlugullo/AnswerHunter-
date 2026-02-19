/**
 * ExtractionService.js
 * Functions injected to read the active page DOM
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
                .replace(/\s+/g, ' ')
                .replace(/\n+/g, ' ')
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
     */
    extractQuestionOnlyScript: function () {
        console.log('AnswerHunter: Iniciando extracao (v19 - DOM only)...');

        function cleanText(text) {
            return (text || '').replace(/\s+/g, ' ').trim();
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

        function pickMostCentered(elements) {
            const vpCenter = window.innerHeight / 2;
            let best = null;
            let bestDist = Infinity;
            for (const el of elements) {
                if (!el || !isOnScreen(el)) continue;
                const rect = el.getBoundingClientRect();
                const centerY = rect.top + rect.height / 2;
                const dist = Math.abs(centerY - vpCenter);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = el;
                }
            }
            return best;
        }

        function buildFromActivitySection(sectionEl) {
            if (!sectionEl) return null;

            const headerNodes = Array.from(sectionEl.querySelectorAll('[data-testid="openResponseQuestionHeader"]'));
            const visibleHeaders = headerNodes.filter(isOnScreen);
            let questionContainer = pickMostCentered(visibleHeaders) || pickMostVisible(visibleHeaders);
            if (!questionContainer && headerNodes.length > 0) {
                questionContainer = headerNodes[headerNodes.length - 1];
            }
            let questionText = '';

            if (questionContainer) {
                const parts = Array.from(questionContainer.querySelectorAll('p'))
                    .map(p => p.innerText)
                    .filter(Boolean);
                questionText = sanitizeQuestionText(parts.join(' '));
            } else {
                const questionEl = sectionEl.querySelector('[data-testid="openResponseQuestionHeader"] p p') ||
                    sectionEl.querySelector('[data-testid="openResponseQuestionHeader"] p');
                questionText = questionEl ? sanitizeQuestionText(questionEl.innerText) : '';
            }

            let optionScope = questionContainer || sectionEl;
            while (optionScope && optionScope !== sectionEl) {
                if (optionScope.querySelectorAll('button[type="submit"]').length >= 2) break;
                optionScope = optionScope.parentElement;
            }
            if (!optionScope) optionScope = sectionEl;

            if (!questionText) {
                const looseParts = Array.from(optionScope.querySelectorAll('p'))
                    .filter(p => !p.closest('button'))
                    .map(p => p.innerText)
                    .filter(Boolean);
                questionText = sanitizeQuestionText(looseParts.slice(0, 3).join(' '));
            }

            const optionButtons = optionScope.querySelectorAll('button[type="submit"]');
            const optionMap = new Map();
            const orderedLetters = ['A', 'B', 'C', 'D', 'E'];

            const addOption = (letterRaw, bodyRaw) => {
                const letter = String(letterRaw || '').toUpperCase().trim();
                if (!/^[A-E]$/.test(letter) || optionMap.has(letter)) return;
                const body = cleanText(String(bodyRaw || '').replace(/^[A-E]\s*[)\.\-:]\s*/i, ''));
                if (!body) return;
                const isFalsePositive = /^[A-Z]{2,}\s|^UX\s|^UI\s|^TI\s/i.test(body);
                if (isFalsePositive) return;
                optionMap.set(letter, body);
            };

            const optionCandidates = optionScope.querySelectorAll(
                'button[type="submit"], ' +
                'button[data-testid^="alternative-"], ' +
                '[data-testid^="alternative-"], ' +
                '[role="radio"], ' +
                'label[for^="option"], ' +
                '[class*="alternative"], ' +
                '[class*="alternativa"]'
            );

            optionCandidates.forEach((el) => {
                const letterRaw =
                    el.querySelector('strong[aria-label]')?.getAttribute('aria-label') ||
                    el.querySelector('[data-testid="circle-letter"]')?.innerText ||
                    el.getAttribute('data-letter') ||
                    '';
                const optionTextEl =
                    el.querySelector('div.text-neutral-dark-low p') ||
                    el.querySelector('[data-testid="question-typography"]') ||
                    el.querySelector('p, div, span');
                const optionText = optionTextEl ? cleanText(optionTextEl.innerText || optionTextEl.textContent || '') : '';
                if (letterRaw && optionText) {
                    addOption(letterRaw, optionText);
                }

                const fallbackText = cleanText(el.innerText || el.textContent || '');
                const match = fallbackText.match(/^\s*["'“”‘’]?\s*([A-E])\s*[).:\-]\s*(.+)$/i);
                if (match) {
                    addOption(match[1], match[2]);
                }
            });

            if (optionMap.size < 5) {
                const rawScopeText = String(optionScope.innerText || '');
                const lines = rawScopeText.split(/\n+/).map(line => cleanText(line)).filter(Boolean);
                const altStartRe = /^["'“”‘’]?\s*([A-E])\s*[)\.\-:]\s*(.+)$/i;
                let current = null;
                for (const line of lines) {
                    const m = line.match(altStartRe);
                    if (m) {
                        if (current && current.body) addOption(current.letter, current.body);
                        current = { letter: m[1].toUpperCase(), body: m[2] };
                    } else if (current) {
                        current.body = cleanText(`${current.body} ${line}`);
                    }
                }
                if (current && current.body) addOption(current.letter, current.body);
            }

            const options = orderedLetters
                .filter(letter => optionMap.has(letter))
                .map(letter => `${letter}) ${optionMap.get(letter)}`);

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
            Math.floor(window.innerHeight * 0.3),
            Math.floor(window.innerHeight * 0.5),
            Math.floor(window.innerHeight * 0.7)
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
            const sectionCenter = rect.top + rect.height / 2;
            const distanceFromCenter = Math.abs(sectionCenter - viewportCenter);
            const isCentered = distanceFromCenter <= window.innerHeight * 0.25;
            const isMostlyVisible = visibilityRatio >= 0.6;
            const score =
                (built.optionCount * 10) +
                (built.questionLength > 30 ? 5 : 0) +
                (visibleHeight * 0.6) +
                (visibilityRatio * 120) -
                (distanceFromCenter * 0.2) +
                (isCentered ? 40 : 0) +
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

        // 2) Specific question header (viewport-centered when multiple exist)
        const allQHeaders = Array.from(document.querySelectorAll('[data-testid="openResponseQuestionHeader"]'));
        const questionHeader = pickMostCentered(allQHeaders) || allQHeaders[0];
        if (questionHeader) {
            // When multiple headers exist, try to isolate the centered one's scope
            // by walking up only until we hit a parent with MULTIPLE headers (shared parent).
            let scope = questionHeader.closest('[data-section]') || questionHeader.parentElement;
            if (allQHeaders.length >= 2 && scope) {
                // Walk up to find a scope that wraps JUST this question
                let walk = questionHeader.parentElement;
                for (let i = 0; i < 8 && walk; i++) {
                    const headersInside = walk.querySelectorAll('[data-testid="openResponseQuestionHeader"]').length;
                    if (headersInside > 1) {
                        // This parent has multiple questions — use the previous (tighter) scope
                        break;
                    }
                    scope = walk;
                    walk = walk.parentElement;
                }
            }
            const built = buildFromActivitySection(scope || questionHeader);
            if (built) {
                console.log('AnswerHunter: Encontrado via openResponseQuestionHeader (viewport-centered, ' + allQHeaders.length + ' total).');
                return built.text;
            }
        }

        // 3) Manual selection (if any) — only when selection is visible on screen
        const selectionObj = window.getSelection ? window.getSelection() : null;
        const selection = selectionObj ? (selectionObj.toString() || '') : '';
        if (selection && selection.trim().length > 5 && selectionObj && selectionObj.rangeCount > 0) {
            try {
                const range = selectionObj.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                const isVisibleSelection = rect && rect.width > 10 && rect.height > 10 &&
                    rect.bottom > 0 && rect.top < window.innerHeight &&
                    rect.right > 0 && rect.left < window.innerWidth;
                if (isVisibleSelection) {
                    console.log('AnswerHunter: Usando selecao manual visivel.');
                    return sanitizeQuestionText(selection).substring(0, 3500);
                }
                console.log('AnswerHunter: Selecao manual ignorada (fora da viewport).');
            } catch (_) {
                // ignore range errors and continue fallback chain
            }
        }

        // 4) Content page with embedded questions
        // On Estácio "Conteúdo" pages, questions appear as plain text with A-E options
        // but without data-section or question-header elements.
        // Strategy: find DOM blocks containing >= 4 options, then isolate the
        // viewport-centered numbered question from the raw text.
        {
            const vpCenterQ = window.innerHeight / 2;
            const scanEls = document.querySelectorAll('main, article, section, div, form, p, li');
            const qBlockCandidates = [];
            const seenKeys = new Set();

            for (const el of scanEls) {
                if (!isOnScreen(el)) continue;
                const rawText = (el.innerText || '').trim();
                if (rawText.length < 80 || rawText.length > 15000) continue;

                // Count distinct option letters (a-e) with a delimiter
                const optSet = new Set();
                const optRe = /(?:^|\n)\s*([a-eA-E])\s*[\)\.\-:]\s*\S/gm;
                let om;
                while ((om = optRe.exec(rawText)) !== null) {
                    optSet.add(om[1].toUpperCase());
                }

                if (optSet.size < 4) continue;

                // Dedup by first 100 chars
                const key = rawText.substring(0, 100);
                if (seenKeys.has(key)) continue;
                seenKeys.add(key);

                const rect = el.getBoundingClientRect();
                const elCenter = rect.top + rect.height / 2;
                const distFromCenter = Math.abs(elCenter - vpCenterQ);

                qBlockCandidates.push({
                    rawText,
                    optCount: optSet.size,
                    distFromCenter,
                    textLength: rawText.length
                });
            }

            if (qBlockCandidates.length > 0) {
                // Sort: prefer smaller focused elements, then by viewport centering
                qBlockCandidates.sort((a, b) => {
                    if (a.optCount >= 4 && b.optCount >= 4) {
                        if (a.textLength < 1500 && b.textLength > 4000) return -1;
                        if (b.textLength < 1500 && a.textLength > 4000) return 1;
                    }
                    return a.distFromCenter - b.distFromCenter;
                });

                let bestRaw = qBlockCandidates[0].rawText;

                // Multi-question isolation:
                // Detect numbered questions (e.g. "1. Assinale...", "2. Assinale...") and
                // keep only the one whose number is closest to viewport center.
                const multiQPattern = /(?:^|\n)\s*(\d+)[\.\)]\s+\S/gm;
                const qNums = [];
                let qmatch;
                while ((qmatch = multiQPattern.exec(bestRaw)) !== null) {
                    qNums.push({ num: parseInt(qmatch[1], 10), index: qmatch.index });
                }

                if (qNums.length >= 2) {
                    let targetNum = -1;
                    let targetDist = Infinity;
                    const vpScanEls = document.querySelectorAll('p, div, li, span, h1, h2, h3, h4, h5, h6, td');
                    for (const vpEl of vpScanEls) {
                        const vpRect = vpEl.getBoundingClientRect();
                        if (vpRect.width < 80 || vpRect.height < 8) continue;
                        if (vpRect.bottom < 0 || vpRect.top > window.innerHeight) continue;
                        const vpText = (vpEl.innerText || '').trim();
                        const vpMatch = vpText.match(/^\s*(\d+)[\.\)]\s+/);
                        if (!vpMatch || vpText.length < 20) continue;
                        const vpElCenter = vpRect.top + vpRect.height / 2;
                        const vpDist = Math.abs(vpElCenter - vpCenterQ);
                        if (vpDist < targetDist) {
                            targetDist = vpDist;
                            targetNum = parseInt(vpMatch[1], 10);
                        }
                    }

                    if (targetNum > 0) {
                        const tIdx = qNums.findIndex(q => q.num === targetNum);
                        if (tIdx >= 0) {
                            const sIdx = qNums[tIdx].index;
                            const eIdx = tIdx + 1 < qNums.length ? qNums[tIdx + 1].index : bestRaw.length;
                            const isolated = bestRaw.substring(sIdx, eIdx).trim();
                            if (isolated.length >= 50) {
                                console.log(`AnswerHunter: Content page - isolated question ${targetNum} of ${qNums.length}.`);
                                return sanitizeQuestionText(isolated).substring(0, 3500);
                            }
                        }
                    }
                }

                console.log(`AnswerHunter: Content page question block (${qBlockCandidates[0].optCount} options, ${qBlockCandidates[0].textLength} chars).`);
                return sanitizeQuestionText(bestRaw).substring(0, 3500);
            }
        }

        // 5) Minimal fallback (no global text)
        const containers = document.querySelectorAll('main, article, section, div, form');
        let best = { score: -999, text: '' };

        function scoreContainer(el) {
            if (!isOnScreen(el)) return null;
            const text = cleanText(el.innerText || '');
            if (text.length < 30 || text.length > 8000) return null;
            const rect = el.getBoundingClientRect();
            let score = 0;

            // Count distinct options
            const optSetFb = new Set();
            const optReFb = /(?:^|\s)([A-E])\s*[\)\.\-:]\s*\S/gi;
            let omFb;
            while ((omFb = optReFb.exec(text)) !== null) {
                optSetFb.add(omFb[1].toUpperCase());
            }
            const distinctOptsFb = optSetFb.size;

            if (text.includes('?')) score += 6;
            if (/Atividade|Quest|Exercicio|Pergunta|Enunciado/i.test(text)) score += 4;

            // Require >= 3 distinct options AND >= 100 chars for option bonus
            // (prevents tiny fragments like "d) Exige..." from scoring high)
            if (distinctOptsFb >= 3 && text.length >= 100) {
                score += distinctOptsFb * 3;
            }

            if (el.querySelectorAll('button[type="submit"]').length >= 2) score += 4;

            // Viewport centering: strong bonus for elements near viewport center
            const vpCenter = window.innerHeight / 2;
            const elCenter = rect.top + rect.height / 2;
            const distFromCenter = Math.abs(elCenter - vpCenter);
            score += Math.max(0, 15 - (distFromCenter / window.innerHeight * 30));

            // Penalize tiny fragments (a real question is at least ~100 chars)
            if (text.length < 100) score -= 10;

            // Penalize large containers
            if (text.length > 3000) score -= 3;
            const qMarkCount = (text.match(/\?/g) || []).length;
            if (qMarkCount > 3) score -= 2;

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
     * Extract ONLY alternatives (when statement is already captured)
     * IMPORTANT: This function tries to find alternatives for the most relevant VISIBLE question
     * Identifies the question section by "Mark for review" marker or question header.
     */
    extractOptionsOnlyScript: function () {
        function cleanText(text) {
            return (text || '').replace(/\s+/g, ' ').trim();
        }

        function normalizeText(text) {
            return (text || '')
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, ' ')
                .replace(/\s+/g, ' ')
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
            let bestDist = Infinity;
            const vpCenter = window.innerHeight / 2;
            for (const h of headerNodes) {
                const hRect = h.getBoundingClientRect();
                const hCenter = hRect.top + hRect.height / 2;
                const dist = Math.abs(hCenter - vpCenter);
                if (dist < bestDist) {
                    bestDist = dist;
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
                const bTokens = bNorm.split(' ').filter(t => t.length >= 3);
                const qTokens = new Set(qNorm.split(' ').filter(t => t.length >= 3));
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

        function extractOptionsFromButtons(rootEl) {
            if (!rootEl) return [];
            const options = [];
            const seenLetters = new Set();

            const buttons = rootEl.querySelectorAll(
                'button[type="submit"], ' +
                'button[data-testid^="alternative-"], ' +
                'button[data-element="link_resposta"], ' +
                '[data-testid^="alternative-"], ' +
                '[class*="alternative"], ' +
                '[class*="alternativa"], ' +
                'label[for^="option"], ' +
                '.radio-option'
            );

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

                let raw = cleanText(textEl ? (textEl.innerText || textEl.textContent || '') : '');
                if (!raw || raw.length < 5) {
                    raw = cleanText(btn.innerText || btn.textContent || '');
                }

                const body = cleanText(raw.replace(/^[A-E]\s*[\)\.\-:]\s*/i, '').trim());

                // Validate it is not a false positive (e.g. "A UX" is not an alternative)
                // If body starts with very short word followed by uppercase, it's likely a statement
                const isFalsePositive = /^[A-Z]{2,}\s|^UX\s|^UI\s|^TI\s/i.test(body);
                const isQuestionLike = isLikelyQuestionBody(body);

                if (letter && body && body.length >= 5 && !seenLetters.has(letter) && !isFalsePositive && !isQuestionLike) {
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
                    const isQuestionLike = isLikelyQuestionBody(body);

                    if (!isFalsePositive && !isQuestionLike) {
                        if (current) alternatives.push(current);
                        current = { letter: m[1].toUpperCase(), body: body };
                        if (alternatives.length >= 5) break;
                    }
                } else if (current) {
                    current.body = cleanText(`${current.body} ${line}`);
                }
            }
            if (current && alternatives.length < 5) alternatives.push(current);

            let merged = alternatives
                .filter(a => a.body && a.body.length >= 2)
                .slice(0, 5)
                .map(a => `${a.letter}) ${a.body}`);

            return merged.length >= 2 ? merged : [];
        }

        function extractFromSection(sectionEl) {
            if (!sectionEl) return [];
            const byButton = extractOptionsFromButtons(sectionEl);
            const byText = extractOptionsFromText(sectionEl.innerText || '');

            if (byButton.length === 0) return byText;
            if (byText.length === 0) return byButton;

            const merged = [];
            const seen = new Set();
            const addLine = (line) => {
                const m = String(line || '').match(/^([A-E])\s*[)\.\-:]\s*(.+)$/i);
                if (!m) return;
                const letter = m[1].toUpperCase();
                const body = cleanText(m[2]);
                if (!body || seen.has(letter)) return;
                seen.add(letter);
                merged.push(`${letter}) ${body}`);
            };

            byButton.forEach(addLine);
            byText.forEach(addLine);

            return merged.length >= 2 ? merged.slice(0, 5) : byButton;
        }

        // Try to identify the active question section (same logic as extractQuestionOnlyScript)
        const reviewButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(btn => /Marcar para revis[aã]o/i.test((btn.innerText || '').trim()))
            .filter(btn => isOnScreen(btn));

        let targetSection = null;

        if (reviewButtons.length > 0) {
            reviewButtons.sort((a, b) => {
                const topA = Math.abs(a.getBoundingClientRect().top - window.innerHeight / 2);
                const topB = Math.abs(b.getBoundingClientRect().top - window.innerHeight / 2);
                return topA - topB;
            });
            targetSection = reviewButtons[0].closest('[data-section="section_cms-atividade"]');
        }

        if (!targetSection) {
            const headerNodes = Array.from(document.querySelectorAll('[data-testid="openResponseQuestionHeader"]'))
                .filter(el => isOnScreen(el));
            if (headerNodes.length > 0) {
                let bestHeader = headerNodes[0];
                let bestDist = Infinity;
                const vpCenter = window.innerHeight / 2;
                for (const h of headerNodes) {
                    const hRect = h.getBoundingClientRect();
                    const hCenter = hRect.top + hRect.height / 2;
                    const dist = Math.abs(hCenter - vpCenter);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestHeader = h;
                    }
                }
                targetSection = bestHeader.closest('[data-section="section_cms-atividade"]') ||
                    bestHeader.closest('section, article, form');
            }
        }

        if (targetSection) {
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
    extractGabaritoFromPageScript: function (questionText = '') {
        try {
            const raw = String(document.body?.innerText || '');
            if (!raw || raw.length < 30) return null;

            const normalize = (t) => String(t || '')
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, ' ')
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
                    const evidence = raw.substring(start, end).replace(/\s+/g, ' ').trim();

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
    }
};
