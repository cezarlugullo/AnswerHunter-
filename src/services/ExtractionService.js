/**
 * ExtractionService.js
 * FunÃ§Ãµes injetadas para ler o DOM da pÃ¡gina ativa
 */
export const ExtractionService = {

    /**
     * Extrair Pergunta e Resposta (Completo/Robusto)
     * Usado para o botÃ£o EXTRAIR
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
     * Extrair APENAS a Pergunta (Sites Protegidos / V19 Dom Only)
     * Usado para a BUSCA
     */
    extractQuestionOnlyScript: function () {
        console.log('AnswerHunter: Iniciando extracao (v19 - DOM only)...');

        function cleanText(text) {
            return (text || '').replace(/\s+/g, ' ').trim();
        }

        function sanitizeQuestionText(text) {
            if (!text) return '';
            let cleaned = cleanText(text);
            cleaned = cleaned.replace(/\bMarcar para revis(?:a|Ã£)o\b/gi, '');
            cleaned = cleaned.replace(/^\s*\d+\s*[-.)]?\s*/i, '');
            cleaned = cleaned.replace(/^(?:Quest(?:a|Ã£)o|Questao)\s*\d+\s*[:.\-]?\s*/i, '');
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
                // CORREÃ‡ÃƒO: Exigir delimitador OBRIGATÃ“RIO e validar falsos positivos
                const match = fallbackText.match(/^\s*([A-E])\s*[).:]\s*(.+)$/i);
                if (match) {
                    const body = match[2].trim();
                    // Validar que nÃ£o Ã© falso positivo (ex: "A UX" nÃ£o Ã© alternativa)
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

        // 1) Estrutura especÃ­fica do site (data-section)
        const activitySections = Array.from(document.querySelectorAll('[data-section="section_cms-atividade"]'));
        const visibleSections = activitySections.filter(isOnScreen);

        // 1) Tentar usar o botao "Marcar para revisao" como ancora (mais preciso)
        const reviewButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(btn => isOnScreen(btn))
            .filter(btn => /Marcar para revis[aÃ©]o/i.test((btn.innerText || btn.textContent || '')));

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

        // 2) Usar pontos de ancoragem no viewport (mais preciso)
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

        // 3) Fallback: escolher pelo maior bloco visÃ­vel e topo mais prÃ³ximo
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

        // 2) Header especÃ­fico da questÃ£o
        const questionHeader = document.querySelector('[data-testid="openResponseQuestionHeader"]');
        if (questionHeader) {
            const parent = questionHeader.closest('[data-section]') || questionHeader.parentElement;
            const built = buildFromActivitySection(parent || questionHeader);
            if (built) {
                console.log('AnswerHunter: Encontrado via openResponseQuestionHeader.');
                return built.text;
            }
        }

        // 3) SeleÃ§Ã©o manual (se houver)
        const selection = window.getSelection ? window.getSelection().toString() : '';
        if (selection && selection.trim().length > 5) {
            console.log('AnswerHunter: Usando selecao manual.');
            return sanitizeQuestionText(selection).substring(0, 3500);
        }

        // 4) Fallback mÃ­nimo (sem texto global)
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

            // Penalizar menus/sidebars
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
     * Extrair APENAS as alternativas (quando o enunciado jÃ¡ foi capturado)
     * IMPORTANTE: Esta funÃ§Ã£o tenta encontrar alternativas da questÃ£o VISÃVEL mais relevante
     * Identifica a seÃ§Ã£o da questÃ£o pelo marcador "Marcar para revisÃ£o" ou header da questÃ£o.
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
            return /assinale|considerando|analise|marque|afirmativa|correta|incorreta|quest[aÃ£]o|enunciado|pergunta/i.test(text || '');
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
                    // CORREÃ‡ÃƒO: Exigir delimitador OBRIGATÃ“RIO para evitar confundir "A UX" com alternativa
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

                // Validar que nÃ£o Ã© falso positivo (ex: "A UX" nÃ£o Ã© alternativa)
                // Se body comeÃ§a com palavra muito curta seguida de maiÃºsculas, provavelmente Ã© enunciado
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
                    // Validar que nÃ£o Ã© falso positivo (ex: "A UX" nÃ£o Ã© alternativa)
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
            let opts = extractOptionsFromButtons(sectionEl);
            if (opts.length >= 2) return opts;
            opts = extractOptionsFromText(sectionEl.innerText || '');
            return opts;
        }

        // Tentar identificar a seÃ§Ã£o da questÃ£o ativa (mesma lÃ³gica de extractQuestionOnlyScript)
        const reviewButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(btn => /Marcar para revis[aÃ©]o/i.test((btn.innerText || '').trim()))
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
            console.log('AnswerHunter: extractOptionsOnlyScript - usando seÃ§Ã£o especÃ­fica');
            const opts = extractFromSection(targetSection);
            if (opts.length >= 2) {
                return opts.slice(0, 5).join('\n');
            }
        }

        // Fallback: buscar no viewport geral
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
     * Extrai gabarito exibido na pagina (pos-resposta), quando existir.
     * Retorna { letter, confidence, source, evidence } ou null.
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
                { re: /resposta\\s+correta\\s*[:\\-]\\s*(?:letra\\s+)?([A-E])\\b/gi, confidence: 0.95, source: 'resposta-correta' },
                { re: /gabarito\\s*[:\\-]\\s*(?:letra\\s+)?([A-E])\\b/gi, confidence: 0.95, source: 'gabarito' },
                { re: /alternativa\\s+correta\\s*[:\\-]\\s*(?:letra\\s+)?([A-E])\\b/gi, confidence: 0.85, source: 'alternativa-correta' },
                { re: /\\bletra\\s+([A-E])\\b\\s*(?:é|e|esta|est[aá])\\s*(?:a\\s+)?(?:correta|certa|verdadeira)\\b/gi, confidence: 0.75, source: 'letra-correta' }
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
                    const evidence = raw.substring(start, end).replace(/\\s+/g, ' ').trim();

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
    // Alias para o getSelectionScript se necessÃ¡rio, ou usar direto extractQuestionOnlyScript que ja tem Fallback manual
    getSelectionScript: function () {
        return window.getSelection().toString().trim();
    }
};
