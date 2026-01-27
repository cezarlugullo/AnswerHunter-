/**
 * ExtractionService.js
 * Funções injetadas para ler o DOM da página ativa
 */
export const ExtractionService = {

    /**
     * Extrair Pergunta e Resposta (Completo/Robusto)
     * Usado para o botão EXTRAIR
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
                const match = fallbackText.match(/^\s*([A-E])\s*[).:-]?\s*(.+)$/i);
                if (match) {
                    options.push(`${match[1].toUpperCase()}) ${match[2].trim()}`);
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

        // 1) Estrutura específica do site (data-section)
        const activitySections = Array.from(document.querySelectorAll('[data-section="section_cms-atividade"]'));
        const visibleSections = activitySections.filter(isOnScreen);

        // 1) Tentar usar o botao "Marcar para revisao" como ancora (mais preciso)
        const reviewButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(btn => isOnScreen(btn))
            .filter(btn => /Marcar para revis[aé]o/i.test((btn.innerText || btn.textContent || '')));

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

        // 3) Fallback: escolher pelo maior bloco visível e topo mais próximo
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

        // 2) Header específico da questão
        const questionHeader = document.querySelector('[data-testid="openResponseQuestionHeader"]');
        if (questionHeader) {
            const parent = questionHeader.closest('[data-section]') || questionHeader.parentElement;
            const built = buildFromActivitySection(parent || questionHeader);
            if (built) {
                console.log('AnswerHunter: Encontrado via openResponseQuestionHeader.');
                return built.text;
            }
        }

        // 3) Seleçéo manual (se houver)
        const selection = window.getSelection ? window.getSelection().toString() : '';
        if (selection && selection.trim().length > 5) {
            console.log('AnswerHunter: Usando selecao manual.');
            return sanitizeQuestionText(selection).substring(0, 3500);
        }

        // 4) Fallback mínimo (sem texto global)
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

    // Alias para o getSelectionScript se necessário, ou usar direto extractQuestionOnlyScript que ja tem Fallback manual
    getSelectionScript: function () {
        return window.getSelection().toString().trim();
    }
};
