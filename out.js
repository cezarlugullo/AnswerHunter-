(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/services/ExtractionService.js
  var ExtractionService;
  var init_ExtractionService = __esm({
    "src/services/ExtractionService.js"() {
      ExtractionService = {
        /**
         * Extract Question and Answer (Complete/Robust)
         * Used for the EXTRACT button
         */
        extractQAContentScript: function() {
          const results = [];
          const selectors = {
            questions: [
              '[class*="question"]',
              '[class*="pergunta"]',
              '[class*="titulo"]',
              '[class*="title"]',
              '[class*="ask"]',
              "[data-question]",
              ".question-text",
              ".question-title",
              ".question-content",
              "h1",
              "h2",
              "h3",
              '[itemprop="name"]',
              '[itemprop="text"]'
            ],
            answers: [
              '[class*="answer"]',
              '[class*="resposta"]',
              '[class*="solution"]',
              '[class*="solucao"]',
              '[class*="reply"]',
              "[data-answer]",
              ".answer-text",
              ".answer-content",
              ".best-answer",
              '[itemprop="acceptedAnswer"]',
              '[itemprop="suggestedAnswer"]'
            ]
          };
          function cleanText(text) {
            return text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim().substring(0, 3e3);
          }
          function isVisible(el) {
            return el.offsetParent !== null && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
          }
          const qaContainers = document.querySelectorAll(
            '[class*="qa"], [class*="question-answer"], [class*="pergunta-resposta"], [class*="card"], [class*="post"], [class*="item"], article, section'
          );
          qaContainers.forEach((container) => {
            if (!isVisible(container)) return;
            let question = "";
            let answer = "";
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
              const exists = results.some(
                (r) => r.question === question || r.answer === answer
              );
              if (!exists) {
                results.push({ question, answer });
              }
            }
          });
          if (results.length === 0) {
            const allText = document.body.innerText;
            const questionPatterns = allText.match(/[^.!?\n]+\?/g) || [];
            questionPatterns.forEach((q) => {
              const cleanQ = cleanText(q);
              if (cleanQ.length > 20 && cleanQ.length < 500) {
                const qIndex = allText.indexOf(q);
                const afterQ = allText.substring(qIndex + q.length, qIndex + q.length + 2e3);
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
          schemaQA.forEach((el) => {
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
          const seen = /* @__PURE__ */ new Set();
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
        extractQuestionOnlyScript: function() {
          console.log("AnswerHunter: Iniciando extracao (v19 - DOM only)...");
          function cleanText(text) {
            return (text || "").replace(/\s+/g, " ").trim();
          }
          function sanitizeQuestionText(text) {
            if (!text) return "";
            let cleaned = cleanText(text);
            cleaned = cleaned.replace(/\bMarcar para revis(?:a|ã)o\b/gi, "");
            cleaned = cleaned.replace(/^\s*\d+\s*[-.)]?\s*/i, "");
            cleaned = cleaned.replace(/^(?:Quest(?:a|ã)o|Questao)\s*\d+\s*[:.\-]?\s*/i, "");
            cleaned = cleaned.replace(/^Atividade\s*\d+\s*[:.\-]?\s*/i, "");
            return cleaned.trim();
          }
          function isOnScreen(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
              return false;
            }
            return rect.width > 30 && rect.height > 15 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
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
            let best2 = null;
            let bestArea = 0;
            for (const el of elements) {
              if (!el) continue;
              const rect = el.getBoundingClientRect();
              const area = getVisibleArea(rect);
              if (area > bestArea) {
                bestArea = area;
                best2 = el;
              }
            }
            return best2;
          }
          function buildFromActivitySection(sectionEl) {
            if (!sectionEl) return null;
            const headerNodes = Array.from(sectionEl.querySelectorAll('[data-testid="openResponseQuestionHeader"]'));
            const visibleHeaders = headerNodes.filter(isOnScreen);
            let questionContainer = pickMostVisible(visibleHeaders);
            if (!questionContainer && headerNodes.length > 0) {
              questionContainer = headerNodes[headerNodes.length - 1];
            }
            let questionText = "";
            if (questionContainer) {
              const parts = Array.from(questionContainer.querySelectorAll("p")).map((p) => p.innerText).filter(Boolean);
              questionText = sanitizeQuestionText(parts.join(" "));
            } else {
              const questionEl = sectionEl.querySelector('[data-testid="openResponseQuestionHeader"] p p') || sectionEl.querySelector('[data-testid="openResponseQuestionHeader"] p');
              questionText = questionEl ? sanitizeQuestionText(questionEl.innerText) : "";
            }
            let optionScope = questionContainer || sectionEl;
            while (optionScope && optionScope !== sectionEl) {
              if (optionScope.querySelectorAll('button[type="submit"]').length >= 2) break;
              optionScope = optionScope.parentElement;
            }
            if (!optionScope) optionScope = sectionEl;
            if (!questionText) {
              const looseParts = Array.from(optionScope.querySelectorAll("p")).filter((p) => !p.closest("button")).map((p) => p.innerText).filter(Boolean);
              questionText = sanitizeQuestionText(looseParts.slice(0, 3).join(" "));
            }
            const optionButtons = optionScope.querySelectorAll('button[type="submit"]');
            const options = [];
            optionButtons.forEach((btn) => {
              const letterRaw = btn.querySelector("strong[aria-label]")?.getAttribute("aria-label") || "";
              const letter = letterRaw.toUpperCase();
              const optionTextEl = btn.querySelector("div.text-neutral-dark-low p") || btn.querySelector("p");
              const optionText = optionTextEl ? cleanText(optionTextEl.innerText) : "";
              if (letter && optionText) {
                options.push(`${letter}) ${optionText}`);
                return;
              }
              const fallbackText = cleanText(btn.innerText || "");
              const match = fallbackText.match(/^\s*([A-E])\s*[).:]\s*(.+)$/i);
              if (match) {
                const body = match[2].trim();
                const isFalsePositive = /^[A-Z]{2,}\s|^UX\s|^UI\s|^TI\s/i.test(body);
                if (!isFalsePositive) {
                  options.push(`${match[1].toUpperCase()}) ${body}`);
                }
              }
            });
            if (!questionText) return null;
            const text = options.length >= 2 ? `${questionText}
${options.join("\n")}` : questionText;
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
          const activitySections = Array.from(document.querySelectorAll('[data-section="section_cms-atividade"]'));
          const visibleSections = activitySections.filter(isOnScreen);
          const reviewButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter((btn) => isOnScreen(btn)).filter((btn) => /Marcar para revis[aã]o/i.test(btn.innerText || btn.textContent || ""));
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
                console.log("AnswerHunter: Encontrado via botao Marcar para revisao.");
                return built.text;
              }
            }
          }
          const probeX = Math.floor(window.innerWidth * 0.5);
          const probeYs = [
            Math.floor(window.innerHeight * 0.15),
            Math.floor(window.innerHeight * 0.3),
            Math.floor(window.innerHeight * 0.5)
          ];
          const hitCount = /* @__PURE__ */ new Map();
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
                console.log("AnswerHunter: Encontrado via elementFromPoint (ancora multipla).");
                return built.text;
              }
            }
          }
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
            const visibilityRatio = rect.height > 0 ? visibleHeight / rect.height : 0;
            const isMostlyVisible = visibilityRatio >= 0.6;
            const distanceFromTop = Math.abs(rect.top);
            const isNearTop = distanceFromTop <= window.innerHeight * 0.3;
            const score = built.optionCount * 10 + (built.questionLength > 30 ? 5 : 0) + visibleHeight * 0.6 + visibilityRatio * 120 - distanceFromTop * 0.1 + (isNearTop ? 50 : 0) + (isMostlyVisible ? 30 : 0);
            scoredCandidates.push({ text: built.text, score, rect, visibleHeight });
          }
          if (scoredCandidates.length > 0) {
            scoredCandidates.sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              const topA = Math.abs(a.rect.top);
              const topB = Math.abs(b.rect.top);
              return topA - topB;
            });
            console.log("AnswerHunter: Encontrado via section_cms-atividade (visibilidade).");
            return scoredCandidates[0].text;
          }
          const questionHeader = document.querySelector('[data-testid="openResponseQuestionHeader"]');
          if (questionHeader) {
            const parent = questionHeader.closest("[data-section]") || questionHeader.parentElement;
            const built = buildFromActivitySection(parent || questionHeader);
            if (built) {
              console.log("AnswerHunter: Encontrado via openResponseQuestionHeader.");
              return built.text;
            }
          }
          const selection = window.getSelection ? window.getSelection().toString() : "";
          if (selection && selection.trim().length > 5) {
            console.log("AnswerHunter: Usando selecao manual.");
            return sanitizeQuestionText(selection).substring(0, 3500);
          }
          const containers = document.querySelectorAll("main, article, section, div, form");
          let best = { score: -999, text: "" };
          function scoreContainer(el) {
            if (!isOnScreen(el)) return null;
            const text = cleanText(el.innerText || "");
            if (text.length < 30 || text.length > 6e3) return null;
            const rect = el.getBoundingClientRect();
            let score = 0;
            if (text.includes("?")) score += 6;
            if (/Atividade|Quest|Exercicio|Pergunta|Enunciado/i.test(text)) score += 4;
            if (/[A-E]\)\s+|[A-E]\.\s+/i.test(text)) score += 4;
            if (el.querySelectorAll('button[type="submit"]').length >= 2) score += 4;
            if (rect.top >= 0 && rect.top < 350) score += 2;
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
            console.log("AnswerHunter: Fallback heuristico usado.");
            return sanitizeQuestionText(best.text).substring(0, 3500);
          }
          console.log("AnswerHunter: Nenhuma questao encontrada.");
          return "";
        },
        /**
         * Extract ONLY alternatives (when statement is already captured)
         * IMPORTANT: This function tries to find alternatives for the most relevant VISIBLE question
         * Identifies the question section by "Mark for review" marker or question header.
         */
        extractOptionsOnlyScript: function() {
          function cleanText(text) {
            return (text || "").replace(/\s+/g, " ").trim();
          }
          function normalizeText(text) {
            return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
          }
          function looksLikeQuestionLine(text) {
            return /assinale|considerando|analise|marque|afirmativa|correta|incorreta|quest[aã]o|enunciado|pergunta/i.test(text || "");
          }
          function isOnScreen(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
              return false;
            }
            return rect.width > 30 && rect.height > 15 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
          }
          function getVisibleArea(rect) {
            const left = Math.max(0, rect.left);
            const right = Math.min(window.innerWidth, rect.right);
            const top = Math.max(0, rect.top);
            const bottom = Math.min(window.innerHeight, rect.bottom);
            return Math.max(0, right - left) * Math.max(0, bottom - top);
          }
          function getQuestionTextFromHeader() {
            const headerNodes = Array.from(document.querySelectorAll('[data-testid="openResponseQuestionHeader"]')).filter((el) => isOnScreen(el));
            if (headerNodes.length === 0) return "";
            let bestHeader = headerNodes[0];
            let bestArea = 0;
            for (const h of headerNodes) {
              const area = getVisibleArea(h.getBoundingClientRect());
              if (area > bestArea) {
                bestArea = area;
                bestHeader = h;
              }
            }
            const parts = Array.from(bestHeader.querySelectorAll("p, span, div")).map((el) => cleanText(el.innerText || el.textContent || "")).filter((t) => t.length >= 8);
            return parts.length > 0 ? parts.join(" ") : cleanText(bestHeader.innerText || bestHeader.textContent || "");
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
              const bTokens = bNorm.split(" ").filter((t) => t.length >= 3);
              const qTokens = new Set(qNorm.split(" ").filter((t) => t.length >= 3));
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
            const attr = el.getAttribute && (el.getAttribute("data-testid") || "") || "";
            if (/right-answer-alert|wrong-answer-alert|info-box/i.test(attr)) return true;
            const className = (el.className || "").toString();
            if (/gabarito|comentado|resposta/i.test(className)) return true;
            const text = cleanText(el.innerText || el.textContent || "");
            return /Gabarito|Resposta correta|Resposta incorreta/i.test(text);
          }
          function extractOptionsFromButtons(rootEl) {
            if (!rootEl) return [];
            const options = [];
            const seenLetters = /* @__PURE__ */ new Set();
            const buttons = rootEl.querySelectorAll(
              'button[data-testid^="alternative-"], button[data-element="link_resposta"], [data-testid^="alternative-"], [class*="alternative"], [class*="alternativa"], label[for^="option"], .radio-option'
            );
            for (const btn of buttons) {
              if (isNoiseElement(btn) || isNoiseElement(btn.parentElement)) continue;
              const letterEl = btn.querySelector('[data-testid="circle-letter"]') || btn.querySelector('[class*="letter"]') || btn.querySelector("small, strong, span");
              let letterText = cleanText(letterEl ? letterEl.innerText || letterEl.textContent || "" : "");
              if (!/^[A-E]$/i.test(letterText)) {
                const fullText = cleanText(btn.innerText || btn.textContent || "");
                const letterMatch = fullText.match(/^([A-E])\s*[\)\.]\s+/i);
                if (letterMatch) letterText = letterMatch[1];
              }
              const letter = /^[A-E]$/i.test(letterText) ? letterText.toUpperCase() : "";
              const textEl = btn.querySelector('[data-testid="question-typography"]') || btn.querySelector("p, div");
              let raw = cleanText(textEl ? textEl.innerText || textEl.textContent || "" : "");
              if (!raw || raw.length < 5) {
                raw = cleanText(btn.innerText || btn.textContent || "");
              }
              let body = cleanText(raw.replace(/^[A-E]\s*[\)\.\-:]\s*/i, "").trim());
              const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
              const idx = body.search(noise);
              if (idx > 1) body = body.slice(0, idx).trim();
              body = body.replace(/[;:,\-.\s]+$/, "");
              const isFalsePositive = !body || /^[A-Z]{2,}\s|^UX\s|^UI\s|^TI\s/i.test(body);
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
            const lines = rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
            const alternatives = [];
            const altStartRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
            let current = null;
            for (const line of lines) {
              const m = line.match(altStartRe);
              if (m) {
                const body = cleanText(m[2]);
                const isFalsePositive = /^[A-Z]{2,}\s|^UX\s|^UI\s|^TI\s/i.test(body);
                const isQuestionLike = body.length >= 30 && isLikelyQuestionBody(body);
                if (!isFalsePositive && !isQuestionLike) {
                  if (current) alternatives.push(current);
                  current = { letter: m[1].toUpperCase(), body };
                  if (alternatives.length >= 5) break;
                }
              } else if (current) {
                current.body = cleanText(`${current.body} ${line}`);
              }
            }
            if (current) {
              let body = cleanText(current.body || "");
              const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
              const idx = body.search(noise);
              if (idx > 1) body = body.slice(0, idx).trim();
              body = body.replace(/[;:,\-.\s]+$/, "");
              current.body = body;
              if (body && alternatives.length < 5) alternatives.push(current);
            }
            for (const alt of alternatives) {
              const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
              const idx = alt.body.search(noise);
              if (idx > 1) alt.body = alt.body.slice(0, idx).trim();
              alt.body = alt.body.replace(/[;:,\-.\s]+$/, "");
            }
            let merged = alternatives.filter((a) => a.body && a.body.length >= 1).slice(0, 5).map((a) => `${a.letter}) ${a.body}`);
            return merged.length >= 2 ? merged : [];
          }
          function extractFromSection(sectionEl) {
            if (!sectionEl) return [];
            let opts = extractOptionsFromButtons(sectionEl);
            if (opts.length >= 2) return opts;
            opts = extractOptionsFromText(sectionEl.innerText || "");
            return opts;
          }
          const reviewButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter((btn) => /Marcar para revis[aã]o/i.test((btn.innerText || "").trim())).filter((btn) => isOnScreen(btn));
          let targetSection = null;
          if (reviewButtons.length > 0) {
            reviewButtons.sort((a, b) => {
              const topA = Math.abs(a.getBoundingClientRect().top - window.innerHeight * 0.2);
              const topB = Math.abs(b.getBoundingClientRect().top - window.innerHeight * 0.2);
              return topA - topB;
            });
            targetSection = reviewButtons[0].closest('[data-section="section_cms-atividade"]');
          }
          if (!targetSection) {
            const headerNodes = Array.from(document.querySelectorAll('[data-testid="openResponseQuestionHeader"]')).filter((el) => isOnScreen(el));
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
              targetSection = bestHeader.closest('[data-section="section_cms-atividade"]') || bestHeader.closest("section, article, form");
            }
          }
          if (targetSection) {
            console.log("AnswerHunter: extractOptionsOnlyScript - usando se\xE7\xE3o espec\xEDfica");
            const opts = extractFromSection(targetSection);
            if (opts.length >= 2) {
              return opts.slice(0, 5).join("\n");
            }
          }
          console.log("AnswerHunter: extractOptionsOnlyScript - fallback para viewport geral");
          const candidates = Array.from(document.querySelectorAll('[data-testid="feedback-container"], section, article, div, form'));
          let best = { score: -1, options: [] };
          for (const el of candidates) {
            if (!isOnScreen(el)) continue;
            const opts = extractFromSection(el);
            if (opts.length < 2 || opts.length > 5) continue;
            const rect = el.getBoundingClientRect();
            const score = opts.length * 100 + getVisibleArea(rect) / 1e3;
            if (score > best.score) {
              best = { score, options: opts };
            }
          }
          return best.options.length >= 2 ? best.options.slice(0, 5).join("\n") : "";
        },
        /**
         * Extracts answer key displayed on page (post-answer), when it exists.
         * Returns { letter, confidence, source, evidence } or null.
         */
        extractGabaritoFromPageScript: function(questionText = "") {
          try {
            const raw = String(document.body?.innerText || "");
            if (!raw || raw.length < 30) return null;
            const normalize = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
            const qNorm = normalize(questionText).slice(0, 240);
            const patterns = [
              { re: /resposta\s+correta\s*[:\-]\s*(?:letra\s+)?([A-E])\b/gi, confidence: 0.95, source: "resposta-correta" },
              { re: /gabarito\s*[:\-]\s*(?:letra\s+)?([A-E])\b/gi, confidence: 0.95, source: "gabarito" },
              { re: /alternativa\s+correta\s*[:\-]\s*(?:letra\s+)?([A-E])\b/gi, confidence: 0.85, source: "alternativa-correta" },
              { re: /\bletra\s+([A-E])\b\s*(?:é|e|esta|est[aá])\s*(?:a\s+)?(?:correta|certa|verdadeira)\b/gi, confidence: 0.75, source: "letra-correta" }
            ];
            let best = null;
            for (const p of patterns) {
              p.re.lastIndex = 0;
              let m;
              while ((m = p.re.exec(raw)) !== null) {
                const letter = String(m[1] || "").toUpperCase();
                if (!/^[A-E]$/.test(letter)) continue;
                const start = Math.max(0, m.index - 180);
                const end = Math.min(raw.length, m.index + 220);
                const evidence = raw.substring(start, end).replace(/\s+/g, " ").trim();
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
        getSelectionScript: function() {
          return window.getSelection().toString().trim();
        }
      };
    }
  });

  // src/models/SettingsModel.js
  var SettingsModel;
  var init_SettingsModel = __esm({
    "src/models/SettingsModel.js"() {
      SettingsModel = {
        defaults: {
          language: "",
          groqApiKey: "",
          groqApiUrl: "https://api.groq.com/openai/v1/chat/completions",
          // Fast model for simple tasks (1000 t/s): validation, extraction, parsing
          groqModelFast: "openai/gpt-oss-20b",
          // Smart model for complex reasoning (280 t/s): inference, consensus, analysis
          groqModelSmart: "llama-3.3-70b-versatile",
          // Most capable model for Google-like overview synthesis (tries this first)
          groqModelOverview: "openai/gpt-oss-120b",
          groqModelVision: "meta-llama/llama-4-scout-17b-16e-instruct",
          serperApiKey: "",
          serperApiUrl: "https://google.serper.dev/search",
          geminiApiKey: "",
          geminiApiUrl: "https://generativelanguage.googleapis.com/v1beta",
          geminiModel: "gemini-2.5-flash",
          geminiModelSmart: "gemini-2.5-flash",
          openrouterApiKey: "",
          openrouterModelSmart: "deepseek/deepseek-r1:free",
          primaryProvider: "groq",
          setupCompleted: false,
          requiredProviders: {
            groq: true,
            serper: false,
            gemini: false
          },
          minGroqIntervalMs: 2500,
          minGeminiIntervalMs: 4200,
          consensusVotingEnabled: true,
          // Enable multi-attempt consensus
          consensusMinAttempts: 2,
          // Minimum attempts for consensus (2-3)
          consensusThreshold: 0.5
          // Minimum vote ratio to accept (0.5 = 50%)
        },
        normalizeLanguage(language) {
          if (typeof language !== "string") return "en";
          return /^pt/i.test(language) ? "pt-BR" : "en";
        },
        getBrowserDefaultLanguage() {
          try {
            return this.normalizeLanguage(navigator?.language || "en");
          } catch (_) {
            return "en";
          }
        },
        isPresent(value) {
          return typeof value === "string" && value.trim().length > 0;
        },
        normalizeRequiredProviders(requiredProviders = {}) {
          return {
            groq: requiredProviders.groq !== false,
            serper: requiredProviders.serper !== false,
            gemini: requiredProviders.gemini === true
          };
        },
        getProviderReadiness(settings = {}) {
          const requiredProviders = this.normalizeRequiredProviders(
            settings.requiredProviders || this.defaults.requiredProviders
          );
          const missingRequired = [];
          const optionalMissing = [];
          if (requiredProviders.groq && !this.isPresent(settings.groqApiKey)) {
            missingRequired.push("groq");
          }
          if (requiredProviders.serper && !this.isPresent(settings.serperApiKey)) {
            missingRequired.push("serper");
          }
          if (requiredProviders.gemini && !this.isPresent(settings.geminiApiKey)) {
            missingRequired.push("gemini");
          } else if (!this.isPresent(settings.geminiApiKey)) {
            optionalMissing.push("gemini");
          }
          return {
            ready: missingRequired.length === 0,
            missingRequired,
            optionalMissing,
            requiredProviders
          };
        },
        computeSetupCompleted(settings = {}) {
          return this.getProviderReadiness(settings).ready;
        },
        async getCurrentProviderReadiness() {
          const settings = await this.getSettings();
          return this.getProviderReadiness(settings);
        },
        /**
         * Returns settings merged with defaults.
         */
        async getSettings() {
          return new Promise((resolve) => {
            chrome.storage.sync.get(["settings"], (result) => {
              const stored = result.settings || {};
              const merged = { ...this.defaults, ...stored };
              if (merged.geminiModelSmart === "gemini-2.5-pro") {
                merged.geminiModelSmart = "gemini-2.5-flash";
              }
              merged.language = this.normalizeLanguage(merged.language || this.getBrowserDefaultLanguage());
              merged.requiredProviders = this.normalizeRequiredProviders(merged.requiredProviders);
              merged.setupCompleted = this.computeSetupCompleted(merged);
              resolve(merged);
            });
          });
        },
        /**
         * Persists settings into chrome.storage.sync.
         */
        async saveSettings(newSettings) {
          const current = await this.getSettings();
          const updated = { ...current, ...newSettings };
          updated.language = this.normalizeLanguage(updated.language || this.getBrowserDefaultLanguage());
          updated.requiredProviders = this.normalizeRequiredProviders(updated.requiredProviders);
          updated.setupCompleted = this.computeSetupCompleted(updated);
          return new Promise((resolve) => {
            chrome.storage.sync.set({ settings: updated }, () => resolve());
          });
        },
        /**
         * Returns only API keys.
         */
        async getApiKeys() {
          const settings = await this.getSettings();
          return {
            groqKey: settings.groqApiKey,
            serperKey: settings.serperApiKey,
            geminiKey: settings.geminiApiKey,
            openrouterKey: settings.openrouterApiKey
          };
        }
      };
    }
  });

  // src/services/ApiService.js
  var ApiService_exports = {};
  __export(ApiService_exports, {
    ApiService: () => ApiService
  });
  var ApiService;
  var init_ApiService = __esm({
    "src/services/ApiService.js"() {
      init_SettingsModel();
      ApiService = {
        lastGroqCallAt: 0,
        _groqQueue: Promise.resolve(),
        // When Groq returns retry-after > 90s, the quota is depleted at hourly/daily level.
        // All subsequent Groq calls should fail fast instead of hanging for minutes.
        _groqQuotaExhaustedUntil: 0,
        /**
         * Call Gemini via its OpenAI-compatible endpoint.
         * Used as fallback when Groq quota is exhausted, or as primary when user selects Gemini.
         * @param {Array<{role:string,content:string}>} messages
         * @param {{model?:string, temperature?:number, max_tokens?:number}} opts
         * @returns {Promise<string|null>} The assistant message content, or null on failure
         */
        async _callGemini(messages, opts = {}) {
          const settings = await this._getSettings();
          const { geminiApiKey, geminiApiUrl, geminiModel } = settings;
          if (!geminiApiKey) return null;
          const model = opts.model || geminiModel || "gemini-2.5-flash";
          const baseUrl = (geminiApiUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
          const url = `${baseUrl}/openai/chat/completions`;
          const doCall = async (callModel) => {
            try {
              const isThinkingModel = /pro|ultra/i.test(callModel) && /2\.5/i.test(callModel);
              const effectiveMaxTokens = isThinkingModel ? Math.max(opts.max_tokens ?? 700, 4096) : opts.max_tokens ?? 700;
              const response = await fetch(url, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${geminiApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: callModel,
                  messages,
                  temperature: opts.temperature ?? 0.1,
                  max_tokens: effectiveMaxTokens
                })
              });
              if (!response.ok) {
                const errText = await response.text().catch(() => "");
                console.warn(`AnswerHunter: Gemini HTTP ${response.status} (model=${callModel}): ${errText.slice(0, 200)}`);
                return null;
              }
              const data = await response.json();
              const msg = data?.choices?.[0]?.message;
              let content = msg?.content?.trim() || "";
              if (!content && msg?.reasoning_content) {
                content = String(msg.reasoning_content).trim();
                console.log(`AnswerHunter: Gemini used reasoning_content (model=${callModel}, ${content.length} chars)`);
              }
              if (!content) {
                const msgKeys = msg ? Object.keys(msg).join(",") : "no-message";
                const finishReason = data?.choices?.[0]?.finish_reason || "unknown";
                console.warn(`AnswerHunter: Gemini empty content (model=${callModel}, finish=${finishReason}, msgKeys=[${msgKeys}])`);
                return null;
              }
              console.log(`AnswerHunter: Gemini success (model=${callModel}, ${content.length} chars)`);
              return content;
            } catch (err) {
              console.warn(`AnswerHunter: Gemini error (model=${callModel}):`, err?.message || String(err));
              return null;
            }
          };
          let result = await doCall(model);
          if (result) return result;
          const flashModel = geminiModel || "gemini-2.5-flash";
          if (model !== flashModel && /pro|ultra/i.test(model) && !opts._noDowngrade) {
            console.log(`AnswerHunter: Gemini auto-downgrade ${model} \u2192 ${flashModel}`);
            result = await doCall(flashModel);
            if (result) return result;
          }
          return null;
        },
        async _getSettings() {
          return await SettingsModel.getSettings();
        },
        /**
         * Returns true if user selected Gemini as the primary AI provider.
         */
        async _isGeminiPrimary() {
          const s = await this._getSettings();
          return s.primaryProvider === "gemini" && !!s.geminiApiKey;
        },
        /**
         * Run multi-attempt Gemini consensus for MC inference.
         * @param {string} systemMsg - System prompt
         * @param {string} userPrompt - User prompt
         * @param {RegExp} letterPattern - Regex to extract letter
         * @param {{smart?:boolean}} opts
         * @returns {{votes:Object, responses:Object, winner:string|null, response:string|null}}
         */
        async _geminiConsensus(systemMsg, userPrompt, letterPattern, opts = {}) {
          const settings = await this._getSettings();
          const smartModel = opts.smart !== false ? settings.geminiModelSmart || "gemini-2.5-flash" : settings.geminiModel || "gemini-2.5-flash";
          const flashModel = settings.geminiModel || "gemini-2.5-flash";
          const temps = [0.1, 0.5];
          const runConsensusLoop = async (model, tempList) => {
            const votes2 = {};
            const responses2 = {};
            let nullCount2 = 0;
            for (const temp of tempList) {
              try {
                const content = await this._callGemini([
                  { role: "system", content: systemMsg },
                  { role: "user", content: userPrompt }
                ], { model, temperature: temp, max_tokens: 700, _noDowngrade: true });
                if (!content) {
                  nullCount2++;
                  continue;
                }
                if (content.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA|INCONCLUSIVO)/i.test(content)) {
                  const contentClean = content.replace(/[*_~`]+/g, "");
                  const m = contentClean.match(letterPattern) || content.match(letterPattern);
                  if (m) {
                    const letter = (m[1] || m[2] || "").toUpperCase();
                    if (letter) {
                      votes2[letter] = (votes2[letter] || 0) + 1;
                      if (!responses2[letter] || content.length > responses2[letter].length) {
                        responses2[letter] = content;
                      }
                      if (votes2[letter] >= 2) break;
                    } else {
                      if (!responses2["_noletter"] || content.length > responses2["_noletter"].length) {
                        responses2["_noletter"] = content;
                      }
                    }
                  } else {
                    if (!responses2["_noletter"] || content.length > responses2["_noletter"].length) {
                      responses2["_noletter"] = content;
                    }
                  }
                }
              } catch (err) {
                console.warn(`AnswerHunter: Gemini consensus temp=${temp} model=${model} error:`, err?.message || err);
                nullCount2++;
              }
            }
            return { votes: votes2, responses: responses2, nullCount: nullCount2 };
          };
          let { votes, responses, nullCount } = await runConsensusLoop(smartModel, temps);
          if (nullCount >= temps.length && smartModel !== flashModel && /pro|ultra/i.test(smartModel)) {
            console.log(`AnswerHunter: Gemini consensus auto-downgrade ${smartModel} \u2192 ${flashModel}`);
            const fallback = await runConsensusLoop(flashModel, [0.1, 0.3]);
            votes = { ...votes, ...fallback.votes };
            for (const [k, v] of Object.entries(fallback.responses)) {
              if (!responses[k] || v.length > responses[k].length) responses[k] = v;
            }
          }
          const entries = Object.entries(votes);
          if (entries.length > 0) {
            entries.sort((a, b) => b[1] - a[1]);
            const [winner] = entries[0];
            return { votes, responses, winner, response: responses[winner] };
          }
          if (responses["_noletter"]) {
            return { votes, responses, winner: null, response: responses["_noletter"] };
          }
          return { votes, responses, winner: null, response: null };
        },
        /**
         * Run multi-attempt Groq consensus for MC inference.
         * @param {string} systemMsg - System prompt
         * @param {string} userPrompt - User prompt
         * @param {RegExp} letterPattern - Regex to extract letter
         * @param {{model?:string, temps?:number[]}} opts
         * @returns {{votes:Object, responses:Object, attempts:string[], winner:string|null, response:string|null}}
         */
        async _groqConsensus(systemMsg, userPrompt, letterPattern, opts = {}) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey } = settings;
          const model = opts.model || settings.groqModelSmart || "llama-3.3-70b-versatile";
          const temps = opts.temps || [0.07, 0.15, 0.24];
          const votes = {};
          const responses = {};
          const attempts = [];
          let noValidCount = 0;
          for (const temp of temps) {
            if (this._groqQuotaExhaustedUntil > Date.now()) {
              const waitMin = Math.ceil((this._groqQuotaExhaustedUntil - Date.now()) / 6e4);
              console.warn(`AnswerHunter: Groq consensus skipping temp=${temp} \u2014 quota exhausted (~${waitMin}min left)`);
              break;
            }
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model,
                  messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: userPrompt }
                  ],
                  temperature: temp,
                  max_tokens: 700
                })
              }));
              const content = data?.choices?.[0]?.message?.content?.trim() || "";
              if (!content || content.length < 3 || /^(NAO_ENCONTRADO|SEM_RESPOSTA|INCONCLUSIVO)/i.test(content)) {
                noValidCount += 1;
                continue;
              }
              attempts.push(content);
              const m = content.match(letterPattern);
              if (m) {
                const letter = m[1].toUpperCase();
                votes[letter] = (votes[letter] || 0) + 1;
                if (!responses[letter] || content.length > responses[letter].length) {
                  responses[letter] = content;
                }
                if (votes[letter] >= 2) break;
              }
            } catch (err) {
              const errMsg = err?.message || String(err);
              console.warn(`AnswerHunter: Groq consensus error:`, errMsg);
              if (errMsg.includes("GROQ_QUOTA_EXHAUSTED")) break;
            }
          }
          const entries = Object.entries(votes);
          if (entries.length > 0) {
            entries.sort((a, b) => b[1] - a[1]);
            const [winner] = entries[0];
            return { votes, responses, attempts, winner, response: responses[winner] };
          }
          if (attempts.length > 0) {
            const longest = attempts.reduce((a, b) => a.length > b.length ? a : b);
            return { votes, responses, attempts, winner: null, response: longest };
          }
          return { votes, responses, attempts, winner: null, response: null };
        },
        /**
         * Respects Groq rate limit
         */
        async _waitForRateLimit() {
          const { minGroqIntervalMs } = await this._getSettings();
          const now = Date.now();
          const elapsed = now - this.lastGroqCallAt;
          const remaining = minGroqIntervalMs - elapsed;
          if (remaining > 0) {
            await new Promise((resolve) => setTimeout(resolve, remaining));
          }
          this.lastGroqCallAt = Date.now();
        },
        /**
         * Queues Groq calls to avoid concurrency and respect rate limit
         */
        async _withGroqRateLimit(taskFn) {
          const run = async () => {
            if (this._groqQuotaExhaustedUntil > Date.now()) {
              const waitMin = Math.ceil((this._groqQuotaExhaustedUntil - Date.now()) / 6e4);
              throw new Error(`GROQ_QUOTA_EXHAUSTED: quota resets in ~${waitMin}min`);
            }
            await this._waitForRateLimit();
            return taskFn();
          };
          const task = this._groqQueue.then(run, run);
          this._groqQueue = task.catch(() => {
          });
          return task;
        },
        /**
         * Wrapper for fetch with common headers and robust retry
         */
        async _fetch(url, options) {
          const maxRetries = 3;
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
              const response = await fetch(url, options);
              if (response.ok) {
                return await response.json();
              }
              if (response.status === 429) {
                const retryAfter = parseFloat(response.headers.get("retry-after") || "0");
                if (retryAfter > 30) {
                  this._groqQuotaExhaustedUntil = Date.now() + retryAfter * 1e3;
                  const waitMin = Math.ceil(retryAfter / 60);
                  console.warn(`AnswerHunter: Groq quota EXHAUSTED \u2014 retry-after=${retryAfter}s (~${waitMin}min). Skipping all Groq calls.`);
                  throw new Error(`GROQ_QUOTA_EXHAUSTED: retry-after=${retryAfter}s (~${waitMin}min)`);
                }
                if (attempt < maxRetries - 1 && retryAfter > 0 && retryAfter <= 30) {
                  const backoffMs = Math.ceil(retryAfter * 1e3) + 500;
                  console.log(`AnswerHunter: Rate limit 429, aguardando ${backoffMs}ms (retry-after=${retryAfter}s, tentativa ${attempt + 1}/${maxRetries})...`);
                  await new Promise((resolve) => setTimeout(resolve, backoffMs));
                  continue;
                }
                this._groqQuotaExhaustedUntil = Date.now() + 12e4;
                console.warn("AnswerHunter: Groq 429 without retry-after \u2014 assuming quota exhausted for 2min");
                throw new Error("GROQ_QUOTA_EXHAUSTED: 429 without retry-after");
              }
              throw new Error(`HTTP Error ${response.status}`);
            } catch (error) {
              const isQuotaError = error.message?.includes("GROQ_QUOTA_EXHAUSTED");
              if (attempt < maxRetries - 1 && !isQuotaError && !error.message?.includes("HTTP Error")) {
                const jitter = 500 + Math.random() * 500;
                await new Promise((resolve) => setTimeout(resolve, jitter));
                continue;
              }
              console.error(`ApiService Fetch Error (${url}):`, error);
              throw error;
            }
          }
        },
        _makeWebcacheUrl(url) {
          try {
            if (/webcache\.googleusercontent\.com\/search\?q=cache:/i.test(url)) return url;
            return `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
          } catch {
            return null;
          }
        },
        _makeJinaMirrorUrl(url) {
          try {
            if (!url) return null;
            const u = new URL(url);
            const hostAndPath = `${u.host}${u.pathname || "/"}${u.search || ""}${u.hash || ""}`;
            return `https://r.jina.ai/${u.protocol}//${hostAndPath}`;
          } catch {
            return null;
          }
        },
        _looksBlockedLikeContent(raw = "", targetUrl = "") {
          const text = String(raw || "").toLowerCase();
          if (!text) return false;
          const host = (() => {
            try {
              return new URL(targetUrl).hostname.replace(/^www\./, "").toLowerCase();
            } catch {
              return "";
            }
          })();
          const commonMarkers = [
            /verifying you are human/i,
            /ray id/i,
            /captcha/i,
            /cloudflare/i,
            /access denied/i,
            /forbidden/i,
            /datadome/i,
            /challenge/i,
            /httpservice\/retry\/enablejs/i
          ];
          const paywallMarkers = [
            /voce\s+esta\s+vendo\s+uma\s+previa/i,
            /documento\s+premium/i,
            /desbloqueie/i,
            /seja\s+premium/i,
            /limitation-blocked/i,
            /paywall-structure/i,
            /short-preview-version/i,
            /new-monetization-test-paywall/i,
            /filter\s*:\s*blur\(/i
          ];
          const hasCommon = commonMarkers.some((re) => re.test(text));
          const hasPaywall = paywallMarkers.some((re) => re.test(text));
          const hasReadablePreviewSignals = (() => {
            if (!hasPaywall) return false;
            const optionMatches = text.match(/(?:^|\s)[a-e]\s*[\)\.\-:]\s+/gim) || [];
            const hasQuestionLanguage = /\b(?:assinale|quest(?:ao|ão)|alternativa|afirmativa|aula\s+\d+)\b/i.test(text);
            return text.length > 3500 && optionMatches.length >= 3 && hasQuestionLanguage;
          })();
          if (hasCommon) return true;
          if (host === "passeidireto.com" || host === "studocu.com" || host.endsWith(".scribd.com")) {
            if (hasReadablePreviewSignals) return false;
            return hasPaywall;
          }
          return false;
        },
        async _fetchTextWithTimeout(url, options = {}, timeoutMs = 6500) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            const text = await res.text().catch(() => "");
            return { ok: res.ok, status: res.status, url: res.url || url, text };
          } catch (error) {
            return { ok: false, status: 0, url, text: "", error };
          } finally {
            clearTimeout(timeout);
          }
        },
        // Shared webcache 429 tracking — skip cache after too many consecutive 429s.
        _webcache429Count: 0,
        _webcache429Threshold: 2,
        resetWebcache429() {
          this._webcache429Count = 0;
        },
        /**
         * AI-powered per-page deep answer extraction.
         * Sends page text + question to AI for a "pente fino" — deep analysis.
         * Uses SMART model for best accuracy. Prefers Gemini (free, higher limits).
         * @param {string} pageText - Page text (will be truncated to ~8000 chars)
         * @param {string} questionText - The question with options
         * @param {string} hostHint - Source domain for logging
         * @returns {Promise<{letter:string, evidence:string, confidence:number, method:string, knowledge:string}|null>}
         */
        async aiExtractFromPage(pageText, questionText, hostHint = "") {
          if (!pageText || pageText.length < 100 || !questionText) {
            console.log(`  \u{1F52C} [aiExtract] SKIP: text too short (${(pageText || "").length} chars)`);
            return null;
          }
          const settings = await this._getSettings();
          const truncatedPage = pageText.substring(0, 8e3);
          const truncatedQuestion = questionText.substring(0, 1800);
          console.log(`  \u{1F52C} [aiExtract] START host=${hostHint} pageLen=${truncatedPage.length} questionLen=${truncatedQuestion.length}`);
          const systemMsg = `Voc\xEA \xE9 um especialista em encontrar respostas de quest\xF5es de m\xFAltipla escolha dentro de textos acad\xEAmicos. Analise o texto fornecido com rigor. Responda APENAS com base no texto \u2014 nunca invente informa\xE7\xF5es.`;
          const prompt2 = `# Tarefa
Analise o TEXTO abaixo e encontre a resposta para a QUEST\xC3O do aluno.

# ATEN\xC7\xC3O CR\xCDTICA: P\xE1ginas com m\xFAltiplas quest\xF5es
O texto pode conter V\xC1RIAS quest\xF5es sobre o mesmo tema. Voc\xEA DEVE:
- Comparar o ENUNCIADO EXATO e as ALTERNATIVAS EXATAS da quest\xE3o do aluno
- Se encontrar um gabarito, confirmar que ele pertence \xE0 quest\xE3o CERTA (mesmo enunciado, mesmas alternativas)
- NUNCA usar gabarito/resposta de uma quest\xE3o DIFERENTE, mesmo que trate do mesmo assunto

# O que procurar (em ordem de prioridade)
1. Gabarito expl\xEDcito: "Gabarito: X", "Resposta: X", "Alternativa correta: X", marca\xE7\xE3o \u2713/\u2605
2. Resolu\xE7\xE3o da quest\xE3o: explica\xE7\xE3o que conclua em uma alternativa
3. Quest\xE3o id\xEAntica/similar com resposta em outro local do texto
4. Defini\xE7\xF5es ou conceitos que confirmem/refutem alternativas
5. Informa\xE7\xF5es acad\xEAmicas relevantes ao tema

# Formato de resposta (siga EXATAMENTE um dos tr\xEAs)

## Se encontrou a resposta:
RESULTADO: ENCONTRADO
EVID\xCANCIA: [trecho exato copiado do texto]
RACIOC\xCDNIO: [como o trecho leva \xE0 resposta, passo a passo]
Letra X: [texto da alternativa]

## Se h\xE1 conhecimento \xFAtil mas sem resposta definitiva:
RESULTADO: CONHECIMENTO_PARCIAL
CONHECIMENTOS: [fatos/conceitos encontrados, relevantes \xE0 quest\xE3o]

## Se n\xE3o encontrou nada \xFAtil:
RESULTADO: NAO_ENCONTRADO

# Exemplos

<exemplo_1>
TEXTO: "...Quest\xE3o 5. O modelo relacional utiliza chaves prim\xE1rias para identificar registros. Gabarito: C..."
QUEST\xC3O: "No modelo relacional, o que identifica unicamente um registro? A) \xCDndice B) View C) Chave prim\xE1ria D) Trigger"

RESULTADO: ENCONTRADO
EVID\xCANCIA: "Gabarito: C"
RACIOC\xCDNIO: O texto cont\xE9m o gabarito expl\xEDcito da quest\xE3o 5 indicando letra C.
Letra C: Chave prim\xE1ria
</exemplo_1>

<exemplo_2>
TEXTO: "...NoSQL prioriza escalabilidade horizontal e flexibilidade de esquema, sacrificando consist\xEAncia forte em favor de disponibilidade (teorema CAP)..."
QUEST\xC3O: "Qual fator \xE9 mais importante para o desempenho de bancos NoSQL? A) Normaliza\xE7\xE3o B) Joins complexos C) Escalabilidade horizontal D) ACID completo"

RESULTADO: ENCONTRADO
EVID\xCANCIA: "NoSQL prioriza escalabilidade horizontal e flexibilidade de esquema"
RACIOC\xCDNIO: Passo 1: O texto afirma que NoSQL prioriza escalabilidade horizontal. Passo 2: A alternativa C menciona exatamente "escalabilidade horizontal". Passo 3: As alternativas A, B e D s\xE3o caracter\xEDsticas de bancos relacionais, n\xE3o NoSQL.
Letra C: Escalabilidade horizontal
</exemplo_2>

<exemplo_3>
TEXTO: "...O sistema imunol\xF3gico possui c\xE9lulas T e c\xE9lulas B que atuam na defesa adaptativa..."
QUEST\xC3O: "Qual a capital da Fran\xE7a? A) Londres B) Paris C) Berlim"

RESULTADO: NAO_ENCONTRADO
</exemplo_3>

<exemplo_4>
TEXTO: "...Quest\xE3o 3. Marque a op\xE7\xE3o falsa sobre diferen\xE7as NoSQL vs relacional: a) Grafos ... e) Escalabilidade horizontal. Gabarito: E. Quest\xE3o 4. Assinale o fator importante para o desempenho de bancos NoSQL: a) Ser schemaless b) SQL..."
QUEST\xC3O: "Assinale o fator importante para o desempenho de bancos NoSQL: A) Ser schemaless B) SQL C) Escalabilidade vertical D) Transa\xE7\xF5es E) Chave-valor"

RESULTADO: NAO_ENCONTRADO
(O "Gabarito: E" no texto pertence \xE0 Quest\xE3o 3 \u2014 uma quest\xE3o DIFERENTE com alternativas DIFERENTES. A Quest\xE3o 4 n\xE3o tem gabarito no texto.)
</exemplo_4>

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
TEXTO (${hostHint}):
${truncatedPage}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
QUEST\xC3O:
${truncatedQuestion}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

Analise o texto passo a passo e responda no formato acima:`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) {
              console.log(`  \u{1F52C} [aiExtract] Gemini: no API key`);
              return null;
            }
            try {
              console.log(`  \u{1F52C} [aiExtract] Trying Gemini (${settings.geminiModelSmart || "gemini-2.5-flash"})...`);
              const result = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], {
                temperature: 0.05,
                max_tokens: 300,
                model: "gemini-2.5-flash"
                // Force fast model for heavy extraction loop
              });
              console.log(`  \u{1F52C} [aiExtract] Gemini response: ${result ? result.length + " chars" : "null"}`);
              if (result) console.log(`  \u{1F52C} [aiExtract] Gemini preview: "${result.substring(0, 200)}"`);
              return result;
            } catch (e) {
              console.warn(`  \u{1F52C} [aiExtract] Gemini error:`, e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, {
                temperature: 0.05,
                max_tokens: 300,
                model: "gemini-2.5-flash"
                // Force fast model for heavy extraction loop
              });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
            if (!groqApiKey) {
              console.log(`  \u{1F52C} [aiExtract] Groq: no API key`);
              return null;
            }
            if (this._groqQuotaExhaustedUntil > Date.now()) {
              console.log(`  \u{1F52C} [aiExtract] Groq: quota exhausted, skipping`);
              return null;
            }
            try {
              console.log(`  \u{1F52C} [aiExtract] Trying Groq (${groqModelSmart})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt2 }],
                  temperature: 0.05,
                  max_tokens: 300
                })
              }));
              const result = data?.choices?.[0]?.message?.content?.trim() || null;
              console.log(`  \u{1F52C} [aiExtract] Groq response: ${result ? result.length + " chars" : "null"}`);
              if (result) console.log(`  \u{1F52C} [aiExtract] Groq preview: "${result.substring(0, 200)}"`);
              return result;
            } catch (e) {
              console.warn(`  \u{1F52C} [aiExtract] Groq error:`, e?.message || e);
              return null;
            }
          };
          let content = null;
          const fallbackChain = [];
          if (settings.geminiApiKey) fallbackChain.push({ name: "gemini", fn: tryGemini });
          if (settings.openrouterApiKey && this._openRouterQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: "openrouter", fn: tryOpenRouter2 });
          }
          if (settings.groqApiKey && this._groqQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: "groq", fn: tryGroq });
          }
          const primary = settings.primaryProvider || "groq";
          if (primary === "gemini") {
            const idx = fallbackChain.findIndex((p) => p.name === "gemini");
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
          } else if (primary === "openrouter") {
            const idx = fallbackChain.findIndex((p) => p.name === "openrouter");
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
          } else {
            const idx = fallbackChain.findIndex((p) => p.name === "groq");
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
          }
          for (const provider of fallbackChain) {
            content = await provider.fn();
            if (content && content.length >= 10 && !/^RESULTADO:\s*NAO_ENCONTRADO/im.test(content)) {
              break;
            }
            console.log(`  \u{1F52C} [aiExtract] ${provider.name} failed or NAO_ENCONTRADO, trying next fallback...`);
          }
          if (!content || content.length < 10) {
            console.log(`  \u{1F52C} [aiExtract] RESULT: no response from any provider`);
            return null;
          }
          if (/RESULTADO:\s*CONHECIMENTO_PARCIAL/i.test(content)) {
            const knowledgeMatch = content.match(/CONHECIMENTOS?:\s*([\s\S]+)/i);
            const knowledge = knowledgeMatch ? knowledgeMatch[1].trim().substring(0, 1200) : content.substring(0, 1200);
            console.log(`  \u{1F52C} [aiExtract] RESULT: PARTIAL KNOWLEDGE (${knowledge.length} chars)`);
            console.log(`  \u{1F52C} [aiExtract] Knowledge preview: "${knowledge.substring(0, 200)}"`);
            return {
              letter: null,
              evidence: null,
              confidence: 0,
              method: "ai-knowledge-partial",
              knowledge
            };
          }
          if (/RESULTADO:\s*NAO_ENCONTRADO/i.test(content)) {
            console.log(`  \u{1F52C} [aiExtract] RESULT: NAO_ENCONTRADO`);
            return null;
          }
          const letterMatch = content.match(/\bLetra\s+([A-E])\b/i) || content.match(/\b([A-E])\s*[\):\.\-]\s*\S/);
          if (!letterMatch) {
            console.log(`  \u{1F52C} [aiExtract] RESULT: response but no letter found. Treating as knowledge.`);
            return {
              letter: null,
              evidence: null,
              confidence: 0,
              method: "ai-knowledge-noletter",
              knowledge: content.substring(0, 1200)
            };
          }
          const letter = letterMatch[1].toUpperCase();
          const evidenceMatch = content.match(/EVID[EÊ]NCIA:\s*([\s\S]*?)(?=RACIOC[IÍ]NIO:|Letra\s+[A-E]|$)/i);
          const evidence = evidenceMatch ? evidenceMatch[1].trim() : content;
          console.log(`  \u{1F52C} [aiExtract] RESULT: FOUND letter=${letter} evidence="${evidence.substring(0, 150)}"`);
          return {
            letter,
            evidence: evidence.slice(0, 900),
            confidence: 0.82,
            method: "ai-page-extraction",
            knowledge: content.substring(0, 1200)
          };
        },
        /**
         * AI extraction from raw HTML — lets the LLM detect visual highlights
         * (CSS classes, bold, colors) without hardcoded selectors.
         * @param {string} htmlSnippet - Raw HTML chunk centered on the question
         * @param {string} questionText - Full question with options
         * @param {string} hostHint - Domain for logging
         * @returns {Promise<{letter:string|null, evidence:string, confidence:number, method:string, knowledge:string}|null>}
         */
        async aiExtractFromHtml(htmlSnippet, questionText, hostHint = "") {
          if (!htmlSnippet || htmlSnippet.length < 300 || !questionText) {
            console.log(`  \u{1F52C} [aiHtml] SKIP: snippet too short (${(htmlSnippet || "").length} chars)`);
            return null;
          }
          const settings = await this._getSettings();
          const truncatedHtml = htmlSnippet.substring(0, 12e3);
          const truncatedQuestion = questionText.substring(0, 1800);
          console.log(`  \u{1F52C} [aiHtml] START host=${hostHint} htmlLen=${truncatedHtml.length} questionLen=${truncatedQuestion.length}`);
          const systemMsg = `Voc\xEA \xE9 um especialista em an\xE1lise de HTML/CSS de p\xE1ginas educacionais. Sua tarefa \xE9 encontrar respostas de quest\xF5es identificando DESTAQUES VISUAIS no HTML.`;
          const prompt2 = `# Tarefa
Analise o HTML abaixo de uma p\xE1gina de exerc\xEDcios acad\xEAmicos. Encontre a quest\xE3o do aluno e identifique qual alternativa est\xE1 VISUALMENTE DESTACADA como correta.

# Como identificar a resposta no HTML

## Destaques CSS (mais comum em PDFs renderizados como HTML):
- Uma alternativa tem classe CSS DIFERENTE das outras (ex: alternativas normais t\xEAm "ff2" mas a correta tem "ff1" ou "ff4")
- Font-family ou font-weight diferente em uma alternativa
- Uma alternativa est\xE1 em <b>, <strong>, ou tem font-weight: bold
- Cor de fundo diferente (background-color, highlight)

## Marca\xE7\xF5es expl\xEDcitas:
- \xCDcone de check (\u2713, \u2714, \u2605) pr\xF3ximo de uma alternativa
- Texto "Gabarito: X", "Resposta: X", "Correta: X"
- Classe CSS com nome sugestivo (correct, right, answer, selected, checked)

## IMPORTANTE:
- A p\xE1gina pode ter V\xC1RIAS quest\xF5es. Compare o ENUNCIADO e as ALTERNATIVAS EXATAS
- Procure diferen\xE7as ENTRE as alternativas da mesma quest\xE3o (uma destacada vs as demais)
- Se todas alternativas t\xEAm o mesmo estilo, N\xC3O h\xE1 destaque visual

# Formato de resposta

## Se encontrou destaque visual:
RESULTADO: ENCONTRADO
LETRA_DESTACADA: [A-E]
EVIDENCIA_CSS: [descreva a diferen\xE7a CSS/HTML que indica o destaque]
TEXTO_ALTERNATIVA: [texto da alternativa destacada]

## Se encontrou gabarito textual:
RESULTADO: ENCONTRADO
EVID\xCANCIA: [trecho exato]
Letra [A-E]: [texto da alternativa]

## Se n\xE3o encontrou:
RESULTADO: NAO_ENCONTRADO

# HTML da p\xE1gina (${hostHint}):
${truncatedHtml}

# Quest\xE3o do aluno:
${truncatedQuestion}

Analise o HTML e responda:`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              console.log(`  \u{1F52C} [aiHtml] Trying Gemini...`);
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.05, max_tokens: 400, model: "gemini-2.5-flash" });
            } catch (e) {
              console.warn(`  \u{1F52C} [aiHtml] Gemini error:`, e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.05, max_tokens: 400, model: "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!settings.groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              console.log(`  \u{1F52C} [aiHtml] Trying Groq (${settings.groqModelSmart})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(settings.groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${settings.groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: settings.groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt2 }],
                  temperature: 0.05,
                  max_tokens: 400
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn(`  \u{1F52C} [aiHtml] Groq error:`, e?.message || e);
              return null;
            }
          };
          let content = null;
          const primary = settings.primaryProvider || "groq";
          if (primary === "openrouter") {
            content = await tryOpenRouter2();
            if (!content) content = await tryGroq();
            if (!content) content = await tryGemini();
          } else if (primary === "gemini") {
            content = await tryGemini();
            if (!content) content = await tryGroq();
            if (!content) content = await tryOpenRouter2();
          } else {
            content = await tryGroq();
            if (!content) content = await tryOpenRouter2();
            if (!content) content = await tryGemini();
          }
          if (!content || content.length < 10) {
            console.log(`  \u{1F52C} [aiHtml] RESULT: no response`);
            return null;
          }
          console.log(`  \u{1F52C} [aiHtml] Response (${content.length} chars): "${content.substring(0, 250)}"`);
          if (/RESULTADO:\s*NAO_ENCONTRADO/i.test(content)) {
            console.log(`  \u{1F52C} [aiHtml] RESULT: NAO_ENCONTRADO`);
            return null;
          }
          const highlightMatch = content.match(/LETRA_DESTACADA:\s*([A-E])\b/i);
          const letterMatch = highlightMatch || content.match(/\bLetra\s+([A-E])\b/i) || content.match(/\b([A-E])\s*[\):\.\-]\s*\S/);
          if (!letterMatch) {
            console.log(`  \u{1F52C} [aiHtml] RESULT: response but no letter found`);
            return {
              letter: null,
              evidence: null,
              confidence: 0,
              method: "ai-html-noletter",
              knowledge: content.substring(0, 1200)
            };
          }
          const letter = letterMatch[1].toUpperCase();
          const evidenceCss = content.match(/EVIDENCIA_CSS:\s*([\s\S]*?)(?=TEXTO_ALTERNATIVA:|Letra\s+[A-E]|$)/i);
          const evidenceText = content.match(/EVID[EÊ]NCIA:\s*([\s\S]*?)(?=RACIOC[IÍ]NIO:|Letra\s+[A-E]|$)/i);
          const evidence = (evidenceCss ? evidenceCss[1].trim() : evidenceText ? evidenceText[1].trim() : content).slice(0, 900);
          console.log(`  \u{1F52C} [aiHtml] RESULT: FOUND letter=${letter} evidence="${evidence.substring(0, 150)}"`);
          return {
            letter,
            evidence,
            confidence: 0.85,
            method: "ai-html-extraction",
            knowledge: content.substring(0, 1200)
          };
        },
        /**
         * AI combined reflection: takes accumulated knowledge from multiple sources
         * and reflects on them together to infer the answer.
         * This is the "last resort" when no single source had a definitive answer.
         * @param {string} questionText - The question with options
         * @param {Array<{host:string, knowledge:string, topicSim:number}>} knowledgePool - Collected insights
         * @returns {Promise<{letter:string, response:string, method:string}|null>}
         */
        async aiReflectOnSources(questionText, knowledgePool = []) {
          if (!questionText || !knowledgePool.length) return null;
          const settings = await this._getSettings();
          const knowledgeSection = knowledgePool.slice(0, 8).map((k, i) => `FONTE ${i + 1} (${k.host}, relev\xE2ncia=${(k.topicSim || 0).toFixed(2)}):
${String(k.knowledge || "").substring(0, 1500)}`).join("\n\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n");
          const totalKnowledge = knowledgePool.reduce((sum, k) => sum + (k.knowledge || "").length, 0);
          console.log(`  \u{1F9E0} [aiReflect] START: ${knowledgePool.length} sources, ${totalKnowledge} total knowledge chars`);
          const systemMsg = `Voc\xEA \xE9 um professor universit\xE1rio. Analise as informa\xE7\xF5es das fontes para responder a quest\xE3o. Use seu conhecimento acad\xEAmico para complementar quando necess\xE1rio. IGNORE quaisquer indica\xE7\xF5es de "Letra", "Gabarito" ou "Resposta" que estejam nas fontes \u2014 essas podem ser de quest\xF5es diferentes. Avalie cada alternativa de forma independente com base nos FATOS. Responda APENAS no formato solicitado.`;
          const prompt2 = `# Tarefa
V\xE1rias p\xE1ginas foram analisadas e nenhuma tinha a resposta definitiva. Abaixo est\xE3o os CONHECIMENTOS EXTRA\xCDDOS de cada fonte. Combine essas informa\xE7\xF5es para inferir a resposta.

# Fontes
${knowledgeSection}

# Quest\xE3o
${questionText.substring(0, 1800)}

# M\xE9todo (siga passo a passo)

PASSO 1 \u2014 COMPILAR: Liste os fatos-chave de TODAS as fontes acima.
PASSO 2 \u2014 AVALIAR: Para cada alternativa, indique se as fontes CONFIRMAM, REFUTAM ou s\xE3o INCERTAS.
PASSO 3 \u2014 ELIMINAR: Descarte alternativas refutadas pelas fontes.
PASSO 4 \u2014 CONCLUIR: Se restar apenas uma vi\xE1vel, essa \xE9 a resposta. Se n\xE3o, declare INCONCLUSIVO.

# Exemplo

<exemplo>
Fontes dizem: "TCP usa handshake de 3 vias", "UDP n\xE3o garante entrega"
Quest\xE3o: "Qual protocolo garante entrega? A) UDP B) TCP C) ICMP"

PASSO 1: TCP usa handshake 3 vias (fonte 1). UDP n\xE3o garante entrega (fonte 2).
PASSO 2:
A) UDP \u2014 REFUTADA (fonte 2 diz que n\xE3o garante entrega)
B) TCP \u2014 CONFIRMADA (handshake 3 vias = garantia de entrega)
C) ICMP \u2014 INCERTA (nenhuma fonte menciona)
PASSO 3: A eliminada. C sem evid\xEAncia. B confirmada.
PASSO 4: Apenas B \xE9 vi\xE1vel.

CONCLUS\xC3O:
Letra B: TCP
</exemplo>

# Sua an\xE1lise (siga os 4 passos):`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              console.log(`  \u{1F9E0} [aiReflect] Trying Gemini (${settings.geminiModelSmart || "gemini-2.5-flash"})...`);
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.1, max_tokens: 800, model: settings.geminiModelSmart || "gemini-2.5-flash" });
            } catch (e) {
              console.warn(`  \u{1F9E0} [aiReflect] Gemini error:`, e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.1, max_tokens: 800, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!settings.groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              console.log(`  \u{1F9E0} [aiReflect] Trying Groq (${settings.groqModelSmart})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(settings.groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${settings.groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: settings.groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt2 }],
                  temperature: 0.1,
                  max_tokens: 800
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn(`  \u{1F9E0} [aiReflect] Groq error:`, e?.message || e);
              return null;
            }
          };
          const geminiPrimary = await this._isGeminiPrimary();
          let content = null;
          if (geminiPrimary) {
            content = await tryGemini();
            if (!content || /INCONCLUSIVO/i.test(content)) {
              const groqContent = await tryGroq();
              if (groqContent && !/INCONCLUSIVO/i.test(groqContent)) content = groqContent;
            }
          } else {
            content = await tryGroq();
            if (!content || /INCONCLUSIVO/i.test(content)) {
              const geminiContent = await tryGemini();
              if (geminiContent && !/INCONCLUSIVO/i.test(geminiContent)) content = geminiContent;
            }
          }
          if (!content || content.length < 20) {
            console.log(`  \u{1F9E0} [aiReflect] RESULT: no response`);
            return null;
          }
          console.log(`  \u{1F9E0} [aiReflect] Response (${content.length} chars): "${content.substring(0, 300)}"`);
          const letterMatch = content.match(/\bLetra\s+([A-E])\b/i) || content.match(/CONCLUS[AÃ]O:[\s\S]*?\b([A-E])\s*[\):\.\-]/i);
          if (!letterMatch) {
            console.log(`  \u{1F9E0} [aiReflect] RESULT: response but no letter (INCONCLUSIVO?)`);
            return null;
          }
          const letter = letterMatch[1].toUpperCase();
          console.log(`  \u{1F9E0} [aiReflect] RESULT: letter=${letter}`);
          return { letter, response: content, method: "ai-combined-reflection" };
        },
        /**
         * Fetches a snapshot preserving BOTH HTML and derived text, with fallback for blocked sources.
         * Needed for PDF-like HTML sources (PasseiDireto/Studocu) where answers may be encoded by CSS classes.
         */
        async fetchPageSnapshot(url, opts = {}) {
          if (!url) return null;
          const {
            timeoutMs = 6500,
            maxHtmlChars = 15e5,
            maxTextChars = 12e3
          } = opts;
          const commonHeaders = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cache-Control": "no-cache"
          };
          const primary = await this._fetchTextWithTimeout(url, {
            method: "GET",
            headers: commonHeaders,
            mode: "cors",
            credentials: "omit"
          }, timeoutMs);
          let viaWebcache = false;
          let viaMirror = false;
          let final = primary;
          const primaryBlockedLike = primary.ok && this._looksBlockedLikeContent(primary.text, url);
          const primaryTooSmall = primary.ok && (primary.text || "").length < 500;
          const shouldTryFallbacks = !primary.ok && (primary.status === 403 || primary.status === 429 || primary.status === 0) || primaryTooSmall || primaryBlockedLike;
          if (shouldTryFallbacks) {
            const skipWebcache = this._webcache429Count >= this._webcache429Threshold;
            const webcacheUrl = skipWebcache ? null : this._makeWebcacheUrl(url);
            if (webcacheUrl) {
              const cached = await this._fetchTextWithTimeout(webcacheUrl, {
                method: "GET",
                headers: commonHeaders,
                mode: "cors",
                credentials: "omit"
              }, timeoutMs);
              const cachedBlockedLike = cached.ok && this._looksBlockedLikeContent(cached.text, url);
              const is429 = cached.status === 429 || !cached.ok && /google\.com\/sorry/i.test(cached.url || "") || cached.ok && /google\.com\/sorry/i.test(cached.url || "");
              if (is429) {
                this._webcache429Count += 1;
                if (this._webcache429Count >= this._webcache429Threshold) {
                  console.log(`ApiService: Webcache rate-limited (${this._webcache429Count} consecutive 429s) \u2014 will skip cache for remaining URLs`);
                }
              } else if (cached.ok) {
                this._webcache429Count = 0;
              }
              if (cached.ok && (cached.text || "").length > 800 && !cachedBlockedLike) {
                final = cached;
                viaWebcache = true;
              }
            } else if (skipWebcache) {
              console.log(`ApiService: Skipping webcache for ${url} (${this._webcache429Count} consecutive 429s)`);
            }
            const finalBlockedLike = final.ok && this._looksBlockedLikeContent(final.text, url);
            if (!final.ok || (final.text || "").length < 1200 || finalBlockedLike) {
              const mirrorUrl = this._makeJinaMirrorUrl(url);
              if (mirrorUrl) {
                const mirrored = await this._fetchTextWithTimeout(mirrorUrl, {
                  method: "GET",
                  headers: {
                    "Accept": "text/plain,text/html;q=0.9,*/*;q=0.8",
                    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Cache-Control": "no-cache"
                  },
                  mode: "cors",
                  credentials: "omit"
                }, timeoutMs + 1800);
                const mirroredBlockedLike = mirrored.ok && this._looksBlockedLikeContent(mirrored.text, url);
                if (mirrored.ok && (mirrored.text || "").length > 700 && !mirroredBlockedLike) {
                  final = mirrored;
                  viaMirror = true;
                }
              }
            }
          }
          const finalHtmlRaw = String(final.text || "");
          const isGoogleChallengePage = /<title>\s*Google Search\s*<\/title>/i.test(finalHtmlRaw) && /httpservice\/retry\/enablejs/i.test(finalHtmlRaw);
          if (isGoogleChallengePage) {
            return {
              ok: false,
              status: 0,
              url: final.url || url,
              viaWebcache,
              viaMirror,
              html: "",
              text: ""
            };
          }
          if (!final.ok || !final.text) {
            return {
              ok: false,
              status: final.status || 0,
              url: final.url || url,
              viaWebcache,
              viaMirror,
              html: "",
              text: ""
            };
          }
          const rawHtml = String(final.text || "").slice(0, maxHtmlChars);
          const html = rawHtml;
          let derivedText = "";
          try {
            const sanitized = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<script\b[^>]*\/?>/gi, " ").replace(/<script\b[\s\S]*?(?=<(?:\/head|\/body|!--|meta|link))/gi, " ").replace(/<\s*script\b[\s\S]*$/gi, " ").replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ").replace(/<noscript\b[^>]*\/?>/gi, " ").replace(/<\s*noscript\b[\s\S]*$/gi, " ").replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ").replace(/<iframe\b[^>]*\/?>/gi, " ").replace(/<\s*iframe\b[\s\S]*$/gi, " ").replace(/<object\b[\s\S]*?<\/object>/gi, " ").replace(/<\s*object\b[\s\S]*$/gi, " ").replace(/<embed\b[^>]*>/gi, " ").replace(/<link\b[^>]*>/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.captcha-display\.com(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)(?:api-js\.)?datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/datadome\.co/gi, " ").replace(/captcha-display\.com/gi, " ");
            const parser = new DOMParser();
            const doc = parser.parseFromString(sanitized, "text/html");
            const elementsToRemove = doc.querySelectorAll('style, nav, header, footer, aside, noscript, [role="navigation"], [role="banner"], .ads, .advertisement, .sidebar');
            elementsToRemove.forEach((el) => el.remove());
            doc.querySelectorAll(".blank").forEach((el) => el.remove());
            doc.querySelectorAll("div, p, br, li, h1, h2, h3, h4, h5, h6, tr, td, article, section, footer, header").forEach((el) => {
              el.appendChild(doc.createTextNode(" "));
            });
            derivedText = (doc.body?.textContent || "").trim();
          } catch {
            derivedText = "";
          }
          const cleanedText = (derivedText || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxTextChars);
          return {
            ok: true,
            status: final.status || 200,
            url: final.url || url,
            viaWebcache,
            viaMirror,
            html,
            text: cleanedText
          };
        },
        /**
         * Validates if the text is a valid question using Groq
         */
        async validateQuestion(questionText) {
          if (!questionText) return false;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelFast } = settings;
          const prompt2 = `Voce deve validar se o texto abaixo e UMA quest\xE3o limpa e coerente.

Regras:
- Deve ser uma pergunta/quest\xE3o de prova ou exercicio.
- Pode ter alternativas (A, B, C, D, E).
- NAO pode conter menus, botoes, avisos, instrucoes de site, ou texto sem rela\xE7\xE3o.
- Se estiver poluida, misturando outra quest\xE3o, ou sem sentido, responda INVALIDO.

Texto:
${questionText}

Responda apenas: OK ou INVALIDO.`;
          const systemMsg = "Responda apenas OK ou INVALIDO.";
          const parseValidation = (content) => {
            const upper = (content || "").trim().toUpperCase();
            if (upper.includes("INVALIDO")) return false;
            if (upper.includes("OK")) return true;
            return true;
          };
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const content = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.1, max_tokens: 10, model: settings.geminiModel || "gemini-2.5-flash" });
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Gemini validateQuestion error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.1, max_tokens: 10, model: settings.geminiModel || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: groqModelFast,
                  messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: prompt2 }
                  ],
                  temperature: 0.1,
                  max_tokens: 10
                })
              }));
              return data?.choices?.[0]?.message?.content || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq validateQuestion error:", e?.message || e);
              return null;
            }
          };
          try {
            const geminiPrimary = await this._isGeminiPrimary();
            let content = null;
            if (geminiPrimary) {
              content = await tryGemini();
              if (content == null) content = await tryGroq();
            } else {
              content = await tryGroq();
              if (content == null) content = await tryGemini();
            }
            return parseValidation(content);
          } catch (error) {
            console.error("Erro validacao:", error);
            return true;
          }
        },
        /**
         * Vision OCR: extracts question text from a screenshot using Groq vision model.
         * @param {string} base64Image - base64-encoded JPEG/PNG screenshot (without data URI prefix)
         * @returns {Promise<string>} extracted question text, or '' on failure
         */
        async extractTextFromScreenshot(base64Image) {
          if (!base64Image) return "";
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelVision } = settings;
          const promptText = [
            "Voc\xEA \xE9 um OCR especializado em provas educacionais.",
            "Extraia APENAS a quest\xE3o (enunciado + alternativas A-E) que est\xE1 mais centralizada/vis\xEDvel na imagem.",
            "Se houver m\xFAltiplas quest\xF5es, escolha a que est\xE1 mais ao centro da tela.",
            "Retorne o texto puro da quest\xE3o com as alternativas, sem nenhum coment\xE1rio adicional.",
            "Formato esperado:",
            "<enunciado da quest\xE3o>",
            "A) <texto>",
            "B) <texto>",
            "C) <texto>",
            "D) <texto>",
            "E) <texto>"
          ].join("\n");
          const visionMessages = [
            {
              role: "user",
              content: [
                { type: "text", text: promptText },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ];
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const model = settings.geminiModel || "gemini-2.5-flash";
              console.log(`AnswerHunter: Vision OCR \u2014 sending screenshot to Gemini (${model})...`);
              const content = await this._callGemini(visionMessages, {
                temperature: 0.1,
                max_tokens: 700,
                model
              });
              if (!content || content.length < 20) {
                console.warn("AnswerHunter: Gemini Vision OCR returned too little text:", (content || "").length);
                return null;
              }
              console.log(`AnswerHunter: Gemini Vision OCR success \u2014 ${content.length} chars extracted`);
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Gemini Vision OCR failed:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            const model = groqModelVision || "meta-llama/llama-4-scout-17b-16e-instruct";
            try {
              console.log(`AnswerHunter: Vision OCR \u2014 sending screenshot to Groq (${model})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model,
                  messages: visionMessages,
                  temperature: 0.1,
                  max_tokens: 700
                })
              }));
              const content = (data.choices?.[0]?.message?.content || "").trim();
              if (content.length < 20) {
                console.warn("AnswerHunter: Groq Vision OCR returned too little text:", content.length);
                return null;
              }
              console.log(`AnswerHunter: Groq Vision OCR success \u2014 ${content.length} chars extracted`);
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Groq Vision OCR failed:", e?.message || e);
              return null;
            }
          };
          try {
            const geminiPrimary = await this._isGeminiPrimary();
            let result = null;
            if (geminiPrimary) {
              result = await tryGemini();
              if (!result) result = await tryGroq();
            } else {
              result = await tryGroq();
              if (!result) result = await tryGemini();
            }
            return result || "";
          } catch (error) {
            console.error("AnswerHunter: Vision OCR failed:", error);
            return "";
          }
        },
        /**
         * Search on Serper (Google) with fallback to educational sites
         * Exact logic from legacy searchWithSerper
         */
        async searchWithSerper(query) {
          const { serperApiUrl, serperApiKey } = await this._getSettings();
          const hasSerperKey = Boolean(String(serperApiKey || "").trim());
          const providerMode = /serpapi\.com\//i.test(String(serperApiUrl || "")) ? "serpapi" : "serper";
          const normalizeSpace = (s) => String(s || "").replace(/\s+/g, " ").trim();
          const normalizeForMatch = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
          const STOPWORDS = /* @__PURE__ */ new Set([
            "que",
            "para",
            "com",
            "sem",
            "dos",
            "das",
            "nos",
            "nas",
            "uma",
            "uns",
            "umas",
            "de",
            "da",
            "do",
            "e",
            "o",
            "a",
            "os",
            "as",
            "no",
            "na",
            "em",
            "por",
            "ou",
            "ao",
            "aos",
            "se",
            "um",
            "mais",
            "menos",
            "sobre",
            "apenas",
            "indica",
            "afirmativa",
            "fator",
            "importante",
            "desempenho"
          ]);
          const toTokens = (text) => normalizeForMatch(text).split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
          const unique = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
          const decodeHtml = (raw) => String(raw || "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
          const looksLikeCodeOption = (text) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|->|jsonb?|\bdb\.\w|\.(?:find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(text || ""));
          const normalizeCodeAwareHint = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^[a-e]\s*[\)\.\-:]\s*/i, "").replace(/->>/g, " op_json_text ").replace(/->/g, " op_json_obj ").replace(/=>/g, " op_arrow ").replace(/::/g, " op_dcolon ").replace(/:=/g, " op_assign ").replace(/!=/g, " op_neq ").replace(/<>/g, " op_neq ").replace(/<=/g, " op_lte ").replace(/>=/g, " op_gte ").replace(/</g, " op_lt ").replace(/>/g, " op_gt ").replace(/:/g, " op_colon ").replace(/=/g, " op_eq ").replace(/[^a-z0-9_]+/g, " ").replace(/\s+/g, " ").trim();
          const extractOptionHints = (raw) => {
            const text = String(raw || "").replace(/\r\n/g, "\n");
            const re = /(?:^|[\n\r\t ;])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;][A-E]\s*[\)\.\-:]\s)|$)/gi;
            const out = [];
            const seen = /* @__PURE__ */ new Set();
            let m;
            while ((m = re.exec(text)) !== null) {
              const body = normalizeSpace(m[2] || "").replace(/\b(?:gabarito|resposta\s+correta|parab(?:ens|\u00e9ns))\b.*$/i, "").trim();
              const bodyNorm = looksLikeCodeOption(body) ? normalizeCodeAwareHint(body) : normalizeForMatch(body);
              const malformed = !body || body.length < 12 || /^[A-E]\s*[\)\.\-:]?\s*$/i.test(body) || /^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(body) || seen.has(bodyNorm);
              if (!malformed) {
                out.push(body);
                seen.add(bodyNorm);
              }
              if (out.length >= 5) break;
            }
            return out;
          };
          const compactOptionHint = (optRaw) => {
            let opt = normalizeSpace(optRaw || "").replace(/["'`]+/g, " ").trim();
            if (!opt) return "";
            if (looksLikeCodeOption(opt)) {
              opt = opt.replace(/\binsert\s+into[\s\S]*?\bvalues\s*\(/i, " ").replace(/^\s*\(+/, "").replace(/\)+\s*;?$/, "").trim();
              const braceMatch = opt.match(/\{[\s\S]*\}/);
              if (braceMatch && braceMatch[0].length > 6) opt = braceMatch[0];
            }
            return normalizeSpace(opt).split(" ").slice(0, looksLikeCodeOption(optRaw) ? 12 : 7).join(" ");
          };
          const buildHintQuery = (stem, options) => {
            if (!options || options.length < 2) return "";
            const pickDistributedOptions = (arr) => {
              if (!arr || arr.length === 0) return [];
              const picked = [];
              const pushUnique = (v) => {
                if (!v) return;
                if (!picked.includes(v)) picked.push(v);
              };
              pushUnique(arr[0]);
              pushUnique(arr[1]);
              pushUnique(arr[Math.floor(arr.length / 2)]);
              pushUnique(arr[arr.length - 1]);
              pushUnique(arr[2]);
              pushUnique(arr[3]);
              return picked.slice(0, 5);
            };
            const hints = pickDistributedOptions(options).map((opt) => compactOptionHint(opt)).filter(Boolean).map((h) => `"${h}"`);
            if (hints.length === 0) return "";
            const maxLen = 340;
            const hintPart = hints.join(" ");
            const suffix = " gabarito";
            const reserved = hintPart.length + suffix.length + 1;
            const maxStemLen = Math.max(70, maxLen - reserved);
            const stemPart = normalizeSpace(stem).slice(0, maxStemLen);
            return normalizeSpace(`${stemPart} ${hintPart}${suffix}`).slice(0, maxLen);
          };
          const normalizeSerpApiOrganic = (items = []) => {
            return (items || []).map((entry) => {
              const title = normalizeSpace(entry?.title || "");
              const link = normalizeSpace(entry?.link || entry?.url || "");
              const snippet = normalizeSpace(entry?.snippet || entry?.snippet_highlighted_words?.join(" ") || "");
              return { title, link, snippet };
            }).filter((entry) => entry.title && entry.link);
          };
          const normalizeSearchPayload = (raw) => {
            if (!raw || typeof raw !== "object") {
              return {
                organic: [],
                answerBox: null,
                aiOverview: null,
                peopleAlsoAsk: null,
                provider: providerMode
              };
            }
            if (providerMode === "serpapi") {
              return {
                organic: normalizeSerpApiOrganic(raw.organic_results || []),
                answerBox: raw.answer_box || raw.answerBox || null,
                aiOverview: raw.ai_overview || raw.aiOverview || null,
                peopleAlsoAsk: raw.related_questions || raw.peopleAlsoAsk || raw.people_also_ask || null,
                provider: "serpapi"
              };
            }
            return {
              organic: raw.organic || [],
              answerBox: raw.answerBox || null,
              aiOverview: raw.aiOverview || raw.ai_overview || null,
              peopleAlsoAsk: raw.peopleAlsoAsk || null,
              provider: "serper"
            };
          };
          const runSerper = async (q, num = 8) => {
            if (providerMode === "serpapi") {
              const url = new URL(String(serperApiUrl || "https://serpapi.com/search.json"));
              url.searchParams.set("engine", url.searchParams.get("engine") || "google");
              url.searchParams.set("q", q);
              url.searchParams.set("gl", "br");
              url.searchParams.set("hl", "pt-br");
              url.searchParams.set("num", String(num));
              url.searchParams.set("api_key", serperApiKey);
              if (!url.searchParams.has("output")) {
                url.searchParams.set("output", "json");
              }
              const payload2 = await this._fetch(url.toString(), {
                method: "GET",
                headers: {
                  "Accept": "application/json"
                }
              });
              return normalizeSearchPayload(payload2);
            }
            const payload = await this._fetch(serperApiUrl, {
              method: "POST",
              headers: {
                "X-API-KEY": serperApiKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                q,
                gl: "br",
                hl: "pt-br",
                num
              })
            });
            return normalizeSearchPayload(payload);
          };
          const runDuckDuckGo = async (q, num = 8) => {
            const endpoint = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
            const response = await this._fetchTextWithTimeout(endpoint, {
              method: "GET",
              headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                "Cache-Control": "no-cache"
              },
              mode: "cors",
              credentials: "omit"
            }, 6500);
            if (!response?.ok || !response?.text) return [];
            const html = String(response.text || "");
            const blocks = html.split(/<div[^>]+class="result[^"]*"[^>]*>/gi).slice(1);
            const organic = [];
            for (const block of blocks) {
              const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
              if (!linkMatch) continue;
              let link = decodeHtml(linkMatch[1] || "").trim();
              const title = normalizeSpace(decodeHtml((linkMatch[2] || "").replace(/<[^>]+>/g, " ")));
              const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
              const snippetRaw = snippetMatch ? snippetMatch[1] || snippetMatch[2] || "" : "";
              const snippet = normalizeSpace(decodeHtml(String(snippetRaw).replace(/<[^>]+>/g, " ")));
              if (link.startsWith("/l/?")) {
                try {
                  const tmp = new URL(`https://duckduckgo.com${link}`);
                  const redirected = tmp.searchParams.get("uddg");
                  if (redirected) link = decodeURIComponent(redirected);
                } catch (_) {
                }
              }
              if (!/^https?:\/\//i.test(link)) continue;
              if (!title) continue;
              organic.push({ title, link, snippet });
              if (organic.length >= num) break;
            }
            return organic;
          };
          const rawQuery = String(query || "").replace(/([a-z\u00e0-\u00ff])([A-Z])/g, "$1 $2");
          const headSample = rawQuery.slice(0, 180);
          const leadingNumberedMatch = headSample.match(/^\s*(\d+)\s*([\.\-])\s+/i) || headSample.match(/(?:^|[\n\r])\s*(\d+)\s*([\.\-])\s+/i);
          const leadingLabelNumberMatch = headSample.match(/^\s*(?:Quest(?:ao|\u00e3o)|Pergunta|Atividade|Exerc(?:icio|\u00edcio))\s*(\d+)\s*([\.\-:)]?)\s*/i) || headSample.match(/(?:^|[\n\r])\s*(?:Quest(?:ao|\u00e3o)|Pergunta|Atividade|Exerc(?:icio|\u00edcio))\s*(\d+)\s*([\.\-:)]?)\s*/i);
          let preservedPrefix = "";
          if (leadingNumberedMatch) {
            const num = leadingNumberedMatch[1];
            const sep = leadingNumberedMatch[2] === "-" ? "-" : ".";
            preservedPrefix = `${num}${sep} `;
          } else if (leadingLabelNumberMatch) {
            const num = leadingLabelNumberMatch[1];
            const sep = leadingLabelNumberMatch[2] === "-" ? "-" : ".";
            preservedPrefix = `${num}${sep} `;
          }
          let cleanQuery = rawQuery.replace(/^(?:Quest(?:ao|\u00e3o)|Pergunta|Atividade|Exerc(?:icio|\u00edcio))\s*\d+[\s.:-]*/gi, "").replace(/Marcar para revis(?:ao|\u00e3o)/gi, "").replace(/\s*(Responda|O que voc(?:e|\u00ea) achou|Relatar problema|Voltar|Avan(?:car|\u00e7ar)|Menu|Finalizar)[\s\S]*/gi, "").replace(/\bNo\s+SQL\b/gi, "NoSQL").replace(/\s+/g, " ").trim();
          if (cleanQuery.includes("?")) {
            const questionEnd = cleanQuery.indexOf("?");
            const questionText = cleanQuery.substring(0, questionEnd + 1).trim();
            if (questionText.length >= 50) cleanQuery = questionText;
          }
          const optionMarkers = [...cleanQuery.matchAll(/(^|[\s:;])[A-E]\s*[\)\.\-:]\s/gi)];
          if (optionMarkers.length >= 2) {
            const firstMarkerIndex = optionMarkers[0].index ?? -1;
            if (firstMarkerIndex > 30) {
              cleanQuery = cleanQuery.substring(0, firstMarkerIndex).trim();
            }
          }
          const hasMultipleChoiceShape = (rawQuery.match(/(?:^|[\s:;])[A-E]\s*[\)\.\-:]\s/gi) || []).length >= 2;
          const startsWithQuestionVerb = /^(?:assinale|marque|indique|selecione|avalie|sobre)\b/i.test(cleanQuery);
          if (!preservedPrefix && hasMultipleChoiceShape && startsWithQuestionVerb) {
            preservedPrefix = "1. ";
          }
          if (preservedPrefix && !new RegExp(`^${preservedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(cleanQuery)) {
            cleanQuery = `${preservedPrefix}${cleanQuery}`.replace(/\s+/g, " ").trim();
          }
          const maxQueryLen = hasMultipleChoiceShape ? 380 : 250;
          cleanQuery = cleanQuery.substring(0, maxQueryLen);
          console.log(`AnswerHunter: Query limpa: "${cleanQuery}"`);
          const optionHints = extractOptionHints(rawQuery);
          const hintQuery = buildHintQuery(cleanQuery, optionHints);
          if (hintQuery) {
            console.log(`AnswerHunter: Query com alternativas: "${hintQuery}"`);
          }
          const BOOST_SITES = [
            "qconcursos.com",
            "qconcursos.com.br",
            "tecconcursos.com.br",
            "gran.com.br",
            "passeidireto.com",
            "studocu.com",
            "brainly.com.br"
          ];
          const siteFilter = BOOST_SITES.map((s2) => `site:${s2}`).join(" OR ");
          const domainFromLink = (link) => {
            try {
              return new URL(link).hostname.replace(/^www\./, "");
            } catch (_) {
              return "";
            }
          };
          const hostBoost = {
            "qconcursos.com": 1.95,
            "qconcursos.com.br": 1.95,
            "tecconcursos.com.br": 1.85,
            "gran.com.br": 1.55,
            "passeidireto.com": 1.35,
            "studocu.com": 1.05,
            "brainly.com.br": 0.72,
            "brainly.com": 0.7,
            "scribd.com": 0.55,
            "pt.scribd.com": 0.5
          };
          const hostPenalty = {
            "brainly.com.br": 0.5,
            "brainly.com": 0.5,
            "scribd.com": 0.75,
            "pt.scribd.com": 0.75
          };
          const stemTokens = toTokens(cleanQuery).slice(0, 12);
          const optionTokens = toTokens(optionHints.join(" ")).slice(0, 10);
          const rareTokens = unique([...toTokens(cleanQuery), ...toTokens(optionHints.join(" "))]).filter((t) => t.length >= 7).slice(0, 5);
          const scoreOrganic = (item, position = 0, queryBoost = 0, provider = "serper") => {
            const link = String(item?.link || "");
            const host = domainFromLink(link);
            const normHay = normalizeForMatch(`${item?.title || ""} ${item?.snippet || ""} ${link}`);
            let stemHits = 0;
            let optionHits = 0;
            let rareHits = 0;
            for (const t of stemTokens) if (normHay.includes(t)) stemHits += 1;
            for (const t of optionTokens) if (normHay.includes(t)) optionHits += 1;
            for (const t of rareTokens) if (normHay.includes(t)) rareHits += 1;
            const hostScore = hostBoost[host] || (host.endsWith(".gov.br") || host.endsWith(".edu.br") ? 1.5 : 0.65);
            const positionScore = Math.max(0, 1.25 - position * 0.11);
            const penalty = hostPenalty[host] || 0;
            const providerBoost = provider === "duckduckgo" ? -0.05 : 0.08;
            return stemHits * 0.42 + optionHits * 0.33 + rareHits * 0.2 + hostScore + positionScore + queryBoost + providerBoost - penalty;
          };
          const dedupeAndRank = (entries) => {
            const byLink = /* @__PURE__ */ new Map();
            for (const e of entries) {
              const link = String(e?.item?.link || "").trim();
              if (!link) continue;
              const prev = byLink.get(link);
              if (!prev || e.score > prev.score) byLink.set(link, e);
            }
            return Array.from(byLink.values()).sort((a, b) => b.score - a.score).map((e) => e.item);
          };
          const hasTrustedCoverage = (items) => {
            const hosts = new Set((items || []).map((it) => domainFromLink(it?.link || "")));
            return hosts.has("passeidireto.com") || hosts.has("qconcursos.com") || hosts.has("qconcursos.com.br") || hosts.has("tecconcursos.com.br") || Array.from(hosts).some((h) => h.endsWith(".gov.br") || h.endsWith(".edu.br"));
          };
          const buildQueryPlan = () => {
            const safe = cleanQuery.replace(/[:"']/g, "").slice(0, 200);
            const compactTokens = toTokens(cleanQuery).slice(0, 10).join(" ");
            const rareTokenQuery = rareTokens.slice(0, 3).join(" ");
            const exactQuery = safe ? `"${safe}"` : "";
            const plan = [
              { q: normalizeSpace(`${cleanQuery} resposta correta`), num: 10, boost: 0.55, label: "base" },
              { q: normalizeSpace(`${cleanQuery} gabarito`), num: 10, boost: 0.6, label: "gabarito" }
            ];
            if (hintQuery) {
              plan.push({ q: hintQuery, num: 10, boost: 0.78, label: "hint" });
            }
            if (hintQuery) {
              plan.push({ q: normalizeSpace(`${hintQuery} ${siteFilter}`).slice(0, 340), num: 8, boost: 0.62, label: "site-filter-hint" });
            }
            if (exactQuery.length > 20) {
              plan.push({ q: exactQuery, num: 10, boost: 0.9, label: "exact" });
            }
            if (compactTokens && compactTokens.length > 16) {
              plan.push({ q: normalizeSpace(`${compactTokens} gabarito`), num: 8, boost: 0.44, label: "compact" });
            }
            if (rareTokenQuery && rareTokenQuery.length > 8) {
              plan.push({ q: normalizeSpace(`${rareTokenQuery} ${cleanQuery.slice(0, 120)} gabarito`), num: 8, boost: 0.52, label: "rare" });
            }
            plan.push({ q: normalizeSpace(`${cleanQuery} ${siteFilter}`).slice(0, 340), num: 8, boost: 0.5, label: "site-filter" });
            return plan.filter((entry) => entry.q && entry.q.length >= 8);
          };
          try {
            console.log("AnswerHunter: Buscando resposta...");
            const pooled = [];
            const pushScored = (items, queryBoost, provider = "serper") => {
              (items || []).forEach((it, idx) => {
                pooled.push({
                  item: it,
                  score: scoreOrganic(it, idx, queryBoost, provider)
                });
              });
            };
            const plan = buildQueryPlan();
            const seenQueries = /* @__PURE__ */ new Set();
            let serperCalls = 0;
            let serperMeta = { answerBox: null, aiOverview: null, peopleAlsoAsk: null };
            const captureSerperMeta = (data) => {
              if (!data) return;
              if (!serperMeta.answerBox && data.answerBox) {
                serperMeta.answerBox = data.answerBox;
                console.log(`AnswerHunter: Captured answerBox from ${data.provider || providerMode}:`, JSON.stringify(data.answerBox).slice(0, 300));
              }
              if (!serperMeta.aiOverview && (data.aiOverview || data.ai_overview)) {
                serperMeta.aiOverview = data.aiOverview || data.ai_overview;
                console.log(`AnswerHunter: Captured aiOverview from ${data.provider || providerMode}:`, JSON.stringify(serperMeta.aiOverview).slice(0, 300));
              }
              if (!serperMeta.peopleAlsoAsk && data.peopleAlsoAsk && data.peopleAlsoAsk.length > 0) {
                serperMeta.peopleAlsoAsk = data.peopleAlsoAsk;
                console.log(`AnswerHunter: Captured ${data.peopleAlsoAsk.length} peopleAlsoAsk entries`);
              }
            };
            if (hasSerperKey) {
              for (const task of plan.slice(0, 4)) {
                if (seenQueries.has(task.q)) continue;
                seenQueries.add(task.q);
                const data = await runSerper(task.q, task.num);
                captureSerperMeta(data);
                pushScored(data?.organic || [], task.boost, providerMode === "serpapi" ? "serpapi" : "serper");
                serperCalls += 1;
              }
            }
            let ranked = dedupeAndRank(pooled);
            if (hasSerperKey && (ranked.length < 10 || !hasTrustedCoverage(ranked.slice(0, 7)))) {
              for (const task of plan.slice(4)) {
                if (seenQueries.has(task.q)) continue;
                seenQueries.add(task.q);
                const data = await runSerper(task.q, task.num);
                captureSerperMeta(data);
                pushScored(data?.organic || [], task.boost, providerMode === "serpapi" ? "serpapi" : "serper");
                serperCalls += 1;
              }
              ranked = dedupeAndRank(pooled);
            }
            let fallbackProviderUsed = false;
            if (!hasSerperKey || ranked.length < 9 || !hasTrustedCoverage(ranked.slice(0, 8))) {
              const fallbackTasks = [
                { q: normalizeSpace(`${cleanQuery} gabarito`), boost: 0.36 },
                hintQuery ? { q: hintQuery, boost: 0.4 } : null,
                { q: normalizeSpace(`${cleanQuery} resposta correta`), boost: 0.34 }
              ].filter(Boolean);
              for (const task of fallbackTasks) {
                try {
                  const organic = await runDuckDuckGo(task.q, 8);
                  if (organic.length > 0) {
                    pushScored(organic, task.boost, "duckduckgo");
                    fallbackProviderUsed = true;
                  }
                } catch (fallbackErr) {
                  console.warn("AnswerHunter: Fallback provider failed:", fallbackErr);
                }
              }
              ranked = dedupeAndRank(pooled);
            }
            if (ranked.length > 0) {
              console.log(`AnswerHunter: Search diagnostics => provider=${providerMode}, providerCalls=${serperCalls}, fallbackProvider=${fallbackProviderUsed ? "duckduckgo" : "none"}, uniqueResults=${ranked.length}`);
              console.log(`AnswerHunter: ${ranked.length} resultados combinados e ranqueados (${hasSerperKey ? "Serper + fallback" : "fallback only"})`);
              const finalResults = ranked.slice(0, 12);
              finalResults._serperMeta = serperMeta;
              finalResults._searchProvider = providerMode;
              return finalResults;
            }
            return [];
          } catch (e) {
            console.error("AnswerHunter: Erro na busca:", e);
            return [];
          }
        },
        /**
         * Extract Options Locally (Regex) - Internal helper used in refinement
         */
        _extractOptionsLocally(sourceContent) {
          if (!sourceContent) return null;
          const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
          const normalized = sourceContent.replace(/\r\n/g, "\n");
          const byLines = () => {
            const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
            const options = [];
            const altStartRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
            let current = null;
            for (const line of lines) {
              const m = line.match(altStartRe);
              if (m) {
                if (current) options.push(current);
                current = { letter: m[1].toUpperCase(), body: clean(m[2]) };
              } else if (current) {
                current.body = clean(`${current.body} ${line}`);
              }
            }
            if (current) options.push(current);
            return options.length >= 2 ? options : null;
          };
          const byInline = () => {
            const options = [];
            const inlinePattern = /(^|[\s])([A-E])\s*[\)\.\-:]\s*([^\n]*?)(?=(?:\s)[A-E]\s*[\)\.\-:]|$)/gi;
            let m;
            while ((m = inlinePattern.exec(normalized)) !== null) {
              const letter = m[2].toUpperCase();
              const body = clean(m[3]);
              if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
          };
          const byPlain = () => {
            const options = [];
            const plainAltPattern = /(?:^|[.!?]\\s+)([A-E])\\s+([A-Za-z][^]*?)(?=(?:[.!?]\\s+)[A-E]\\s+[A-Za-z]|$)/g;
            let m;
            while ((m = plainAltPattern.exec(normalized)) !== null) {
              const letter = m[1].toUpperCase();
              const body = clean(m[2].replace(/\s+[.!?]\s*$/, ""));
              if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
          };
          const bySentencesAfterMarker = () => {
            const markers = [
              /(?:assinale|marque)\s+(?:a\s+)?(?:alternativa\s+)?(?:correta|verdadeira|incorreta|falsa)[.:]/gi,
              ,
              /(?:opção|alternativa)\s+(?:correta|verdadeira)[.:]/gi,
              /\(Ref\.?:\s*\d+\)/gi,
              /assinale\s+(?:a\s+)?(?:afirmativa|assertiva)\s+correta[.:]/gi
            ];
            let startIdx = -1;
            for (const marker of markers) {
              marker.lastIndex = 0;
              const match = marker.exec(sourceContent);
              if (match) {
                startIdx = match.index + match[0].length;
                break;
              }
            }
            if (startIdx === -1) {
              const questionMark = sourceContent.indexOf("?");
              if (questionMark > 30) {
                startIdx = questionMark + 1;
              } else {
                return null;
              }
            }
            let afterMarker = sourceContent.substring(startIdx).trim();
            afterMarker = afterMarker.replace(/\(Ref\.?:\s*\d+\)\s*/gi, "");
            const sentences = afterMarker.split(/(?<=[.!])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => {
              if (s.length < 20 || s.length > 500) return false;
              if (/^(Resposta|Gabarito|Correta|A resposta|portanto|letra\s+[A-E]|De acordo|Segundo)/i.test(s)) return false;
              if (/verificad[ao]|especialista|winnyfernandes|Excelente|curtidas|usuário|respondeu/i.test(s)) return false;
              return true;
            });
            if (sentences.length >= 3 && sentences.length <= 6) {
              const letters = ["A", "B", "C", "D", "E", "F"];
              return sentences.slice(0, 5).map((body, idx) => ({
                letter: letters[idx],
                body: clean(body.replace(/\.+$/, ""))
              }));
            }
            return null;
          };
          const byParagraphs = () => {
            const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
            const candidateOptions = [];
            let foundStartMarker = false;
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (/assinale|alternativa|opção|opções|correta[.:]|incorreta[.:]/i.test(line)) {
                foundStartMarker = true;
                continue;
              }
              if (/^(Resposta|Gabarito|Correta|Alternativa correta|A resposta|está correta|portanto|letra\s+[A-E])/i.test(line)) {
                break;
              }
              if (foundStartMarker) {
                if (line.length < 15 || line.length > 500) continue;
                if (line.endsWith("?") || line.endsWith(":")) continue;
                if (/verificad[ao]|especialista|curtidas|respondeu/i.test(line)) continue;
                candidateOptions.push(line);
              }
            }
            if (candidateOptions.length >= 3 && candidateOptions.length <= 6) {
              const letters = ["A", "B", "C", "D", "E", "F"];
              return candidateOptions.slice(0, 5).map((body, idx) => ({
                letter: letters[idx],
                body: clean(body)
              }));
            }
            return null;
          };
          const found = byLines() || byInline() || byPlain() || bySentencesAfterMarker() || byParagraphs();
          if (!found) return null;
          return found.map((o) => `${o.letter}) ${o.body}`).join("\n");
        },
        /**
         * Extracts options (A, B, C...) from any text
         */
        extractOptionsFromText(sourceContent) {
          const raw = this._extractOptionsLocally(sourceContent);
          if (!raw) return [];
          return raw.split("\n").map((line) => line.trim()).filter(Boolean);
        },
        /**
         * Extracts text from an image base64 dataUri using AI Vision
         */
        async aiExtractTextFromImage(dataUri) {
          if (!dataUri || !dataUri.startsWith("data:image/")) return "";
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelVision } = settings;
          const systemMsg = "Extraia rigorosamente o texto completo da imagem enviada. Responda APENAS com o texto, ignorando sauda\xE7\xF5es.";
          const visionMessages = [
            { role: "system", content: systemMsg },
            {
              role: "user",
              content: [
                { type: "text", text: "Transcri\xE7\xE3o fiel do conte\xFAdo (preservando formato, alternativas, c\xF3digo, tabelas):" },
                { type: "image_url", image_url: { url: dataUri } }
              ]
            }
          ];
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const base64Data = dataUri.split(",")[1];
              const mimeType = dataUri.split(";")[0].split(":")[1];
              const content = await this._callGemini([
                { role: "system", content: systemMsg },
                {
                  role: "user",
                  content: [
                    { inline_data: { mime_type: mimeType, data: base64Data } },
                    { text: "Transcri\xE7\xE3o fiel do conte\xFAdo:" }
                  ]
                }
              ], { temperature: 0.1, max_tokens: 1500, model: settings.geminiModel || "gemini-2.5-flash" });
              if (!content || content.length < 20) {
                console.warn("AnswerHunter: Gemini Vision OCR returned too little text:", (content || "").length);
                return null;
              }
              console.log(`AnswerHunter: Gemini Vision OCR success \u2014 ${content.length} chars extracted`);
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Gemini Vision OCR failed:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              const content = await this._callOpenRouter(visionMessages, {
                temperature: 0.1,
                max_tokens: 1500,
                model
              });
              if (!content || content.length < 20) {
                return null;
              }
              return content;
            } catch (e) {
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            const model = groqModelVision || "meta-llama/llama-4-scout-17b-16e-instruct";
            try {
              console.log(`AnswerHunter: Vision OCR \u2014 sending screenshot to Groq (${model})...`);
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model,
                  messages: visionMessages,
                  temperature: 0.1,
                  max_tokens: 1500
                })
              }));
              const content = (data.choices?.[0]?.message?.content || "").trim();
              if (content.length < 20) {
                console.warn("AnswerHunter: Groq Vision OCR returned too little text:", content.length);
                return null;
              }
              console.log(`AnswerHunter: Groq Vision OCR success \u2014 ${content.length} chars extracted`);
              return content;
            } catch (e) {
              console.warn("AnswerHunter: Groq Vision OCR failed:", e?.message || e);
              return null;
            }
          };
          try {
            const primary = settings.primaryProvider || "groq";
            let result = null;
            if (primary === "openrouter") {
              result = await tryOpenRouter2();
              if (!result) result = await tryGroq();
              if (!result) result = await tryGemini();
            } else if (primary === "gemini") {
              result = await tryGemini();
              if (!result) result = await tryOpenRouter2();
              if (!result) result = await tryGroq();
            } else {
              result = await tryGroq();
              if (!result) result = await tryOpenRouter2();
              if (!result) result = await tryGemini();
            }
            return result || "";
          } catch (error) {
            console.error("AnswerHunter: Vision OCR failed:", error);
            return "";
          }
        },
        /**
         * Prompt 1: Extract options (AI)
         * Uses FAST model (1000 t/s) - simple extraction task
         */
        async extractOptionsFromSource(sourceContent) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelFast } = settings;
          const prompt2 = `Voce deve extrair APENAS as alternativas (opcoes A, B, C, D, E) do texto abaixo.

TEXTO DA FONTE:
${sourceContent}

REGRAS:
- Extraia APENAS as alternativas no formato: A) texto, B) texto, etc.
- Se nao houver alternativas claras, responda: SEM_OPCOES
- NAO invente alternativas
- NAO inclua o enunciado da pergunta

FORMATO DE SAIDA (apenas as alternativas):
A) [texto da alternativa A]
B) [texto da alternativa B]
C) [texto da alternativa C]
D) [texto da alternativa D]
E) [texto da alternativa E se houver]`;
          const systemMsg = "Voce extrai apenas alternativas de questoes. Responda APENAS com as alternativas no formato A) B) C) D) E) ou SEM_OPCOES.";
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.1, max_tokens: 500, model: settings.geminiModel || "gemini-2.5-flash" });
            } catch (e) {
              console.warn("AnswerHunter: Gemini extractOptionsFromSource error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.1, max_tokens: 500, model: "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter extractOptions error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: groqModelFast,
                  messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: prompt2 }
                  ],
                  temperature: 0.1,
                  max_tokens: 500
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq extractOptionsFromSource error:", e?.message || e);
              return null;
            }
          };
          try {
            const primary = settings.primaryProvider || "groq";
            let content = null;
            if (primary === "openrouter") {
              content = await tryOpenRouter2();
              if (!content) content = await tryGroq();
              if (!content) content = await tryGemini();
            } else if (primary === "gemini") {
              content = await tryGemini();
              if (!content) content = await tryGroq();
              if (!content) content = await tryOpenRouter2();
            } else {
              content = await tryGroq();
              if (!content) content = await tryOpenRouter2();
              if (!content) content = await tryGemini();
            }
            if (!content || content.includes("SEM_OPCOES")) return null;
            return content;
          } catch (error) {
            console.error("Erro ao extrair opcoes:", error);
            return null;
          }
        },
        /**
         * Multiple-attempt consensus voting with provider routing
         * Uses SMART model - complex reasoning task requiring precision
         */
        async _extractAnswerWithConsensus(originalQuestion, sourceContent, attempts = 3) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart, consensusVotingEnabled, consensusMinAttempts, consensusThreshold } = settings;
          if (!consensusVotingEnabled) return null;
          const maxAttempts = Math.max(2, Math.min(attempts, consensusMinAttempts || 2));
          const prompts = [
            // Prompt 1: Direct extraction
            `Analise a fonte e identifique a resposta correta para a quest\xE3o.

QUEST\xC3O:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

INSTRU\xC7\xD5ES:
- Identifique a letra da resposta correta (A, B, C, D ou E)
- Extraia o texto completo da alternativa correta
- Responda APENAS no formato: "Letra X: [texto completo da alternativa]"
- Se n\xE3o encontrar resposta clara, diga apenas: NAO_ENCONTRADO`,
            // Prompt 2: Step-by-step reasoning
            `AN\xC1LISE PASSO A PASSO:

QUEST\xC3O:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

PASSO 1: A fonte cont\xE9m um gabarito expl\xEDcito ("gabarito:", "resposta:", etc.)? Qual letra?
PASSO 2: Se n\xE3o houver gabarito expl\xEDcito, qual alternativa \xE9 confirmada como correta pela fonte?
PASSO 3: Resposta final no formato: "Letra X: [texto]"

Se n\xE3o houver evid\xEAncia: NAO_ENCONTRADO`,
            // Prompt 3: Evidence-based
            `IDENTIFICA\xC7\xC3O POR EVID\xCANCIAS:

QUEST\xC3O:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

Busque na fonte:
1. Marca\xE7\xF5es expl\xEDcitas: "gabarito", "correta", "resposta"
2. Explica\xE7\xF5es que confirmam uma alternativa espec\xEDfica
3. Coment\xE1rios de professores/especialistas

Formato de resposta: "Letra X: [texto]"
Se incerto: NAO_ENCONTRADO`
          ];
          const systemMsg = 'Voc\xEA extrai respostas de quest\xF5es de m\xFAltipla escolha. Sempre responda no formato "Letra X: [texto da alternativa]".';
          const runGroqConsensus = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return [];
            const responses2 = [];
            for (let i = 0; i < Math.min(maxAttempts, prompts.length); i++) {
              try {
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${groqApiKey}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    model: groqModelSmart,
                    messages: [
                      { role: "system", content: systemMsg },
                      { role: "user", content: prompts[i] }
                    ],
                    temperature: 0.05 + i * 0.05,
                    max_tokens: 250
                  })
                }));
                const content = data.choices?.[0]?.message?.content?.trim() || "";
                if (content && content.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA)/i.test(content)) {
                  responses2.push(content);
                }
              } catch (error) {
                console.warn(`AnswerHunter: Groq consensus attempt ${i + 1} failed:`, error);
              }
            }
            return responses2;
          };
          const runGeminiConsensus = async () => {
            if (!settings.geminiApiKey) return [];
            const geminiModel = settings.geminiModelSmart || "gemini-2.5-flash";
            const responses2 = [];
            for (let i = 0; i < Math.min(maxAttempts, prompts.length); i++) {
              try {
                const content = await this._callGemini([
                  { role: "system", content: systemMsg },
                  { role: "user", content: prompts[i] }
                ], { temperature: 0.05 + i * 0.05, max_tokens: 250, model: geminiModel, _noDowngrade: true });
                if (content && content.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA)/i.test(content)) {
                  responses2.push(content);
                }
              } catch (error) {
                console.warn(`AnswerHunter: Gemini consensus attempt ${i + 1} failed:`, error);
              }
            }
            return responses2;
          };
          const geminiPrimary = await this._isGeminiPrimary();
          let responses = geminiPrimary ? await runGeminiConsensus() : await runGroqConsensus();
          if (responses.length === 0) {
            responses = geminiPrimary ? await runGroqConsensus() : await runGeminiConsensus();
          }
          if (responses.length === 0) return null;
          const letterPattern = /(?:Letra|Letter)\s*([A-E])[:\s\)]/i;
          const votes = {};
          const fullResponses = {};
          for (const response of responses) {
            const match = response.match(letterPattern);
            if (match) {
              const letter = match[1].toUpperCase();
              votes[letter] = (votes[letter] || 0) + 1;
              if (!fullResponses[letter] || response.length > fullResponses[letter].length) {
                fullResponses[letter] = response;
              }
            }
          }
          if (Object.keys(votes).length === 0) return null;
          const sortedVotes = Object.entries(votes).sort((a, b) => b[1] - a[1]);
          const [winnerLetter, winnerCount] = sortedVotes[0];
          const confidence = winnerCount / responses.length;
          const threshold = consensusThreshold || 0.5;
          if (confidence < threshold && responses.length >= 2) {
            console.log(`AnswerHunter: Weak consensus (${confidence.toFixed(2)} < ${threshold}), votes:`, votes);
            return null;
          }
          console.log(`AnswerHunter: Consensus achieved - Letter ${winnerLetter} (${winnerCount}/${responses.length} votes, confidence: ${confidence.toFixed(2)})`);
          return fullResponses[winnerLetter];
        },
        /**
         * Prompt 2: Identify the correct answer (AI)
         * Uses hybrid approach: SMART for single attempt, consensus handles multi-attempt
         */
        async extractAnswerFromSource(originalQuestion, sourceContent) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const consensusAnswer = await this._extractAnswerWithConsensus(originalQuestion, sourceContent, 3);
          if (consensusAnswer) {
            console.log("AnswerHunter: Using consensus answer");
            return consensusAnswer;
          }
          const prompt2 = `Analise a fonte e identifique a resposta correta para a quest\xE3o.

QUEST\xC3O:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

INSTRU\xC7\xD5ES:
- Identifique a letra da resposta correta (A, B, C, D ou E)
- Extraia o texto completo da alternativa correta
- Responda APENAS no formato: "Letra X: [texto completo da alternativa]"
- Se n\xE3o encontrar resposta clara, diga apenas: NAO_ENCONTRADO`;
          const systemMsg = 'Voc\xEA extrai respostas de quest\xF5es de m\xFAltipla escolha. Sempre responda no formato "Letra X: [texto da alternativa]".';
          const parseResponse = (content) => {
            if (!content || content.length < 3) return null;
            if (/^(NAO_ENCONTRADO|SEM_RESPOSTA|INVALIDO|N[ãa]o\s+(encontr|consigo|h[áa]))/i.test(content)) return null;
            if (/NAO_ENCONTRADO|SEM_RESPOSTA/i.test(content)) return null;
            return content;
          };
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const content = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.1, max_tokens: 200, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              console.log("AnswerHunter: Resposta Gemini bruta:", content);
              return parseResponse((content || "").trim());
            } catch (e) {
              console.warn("AnswerHunter: Gemini extractAnswerFromSource error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.1, max_tokens: 200, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: prompt2 }
                  ],
                  temperature: 0.1,
                  max_tokens: 200
                })
              }));
              const content = data?.choices?.[0]?.message?.content?.trim() || "";
              console.log("AnswerHunter: Resposta Groq bruta:", content);
              return parseResponse(content);
            } catch (e) {
              console.warn("AnswerHunter: Groq extractAnswerFromSource error:", e?.message || e);
              return null;
            }
          };
          try {
            const geminiPrimary = await this._isGeminiPrimary();
            let result = null;
            if (geminiPrimary) {
              result = await tryGemini();
              if (!result) result = await tryGroq();
            } else {
              result = await tryGroq();
              if (!result) result = await tryGemini();
            }
            return result;
          } catch (error) {
            console.error("Erro ao extrair resposta:", error);
            return null;
          }
        },
        /**
         * Infer answer based on evidence (answer key/comments)
         * Enhanced with per-alternative evaluation & polarity awareness + Consensus voting
         * Uses SMART model (280 t/s) - most complex reasoning task
         */
        async inferAnswerFromEvidence(originalQuestion, sourceContent, options = {}) {
          const { isDesperate = false } = options;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const normQ = originalQuestion.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const wantsIncorrect = /\b(falsa|incorreta|errada|exceto|nao\s+correta)\b/i.test(normQ);
          const polarityNote = wantsIncorrect ? "\n\u26A0\uFE0F ATEN\xC7\xC3O: A quest\xE3o pede a alternativa INCORRETA/FALSA/EXCETO. Voc\xEA deve encontrar a alternativa ERRADA, n\xE3o a correta." : "";
          const basePrompt = `INFER\xCANCIA DE RESPOSTA COM BASE EM EVID\xCANCIAS

QUEST\xC3O DO CLIENTE:
${originalQuestion.substring(0, 2e3)}

EVID\xCANCIAS DAS FONTES:
${sourceContent.substring(0, 3500)}
${polarityNote}

INSTRU\xC7\xD5ES - siga EXATAMENTE esta ordem:

PASSO 1: Leitura atenta do enunciado
- Identifique o ASPECTO ESPEC\xCDFICO que a quest\xE3o pede (ex: desempenho, seguran\xE7a, flexibilidade, etc.).
- A quest\xE3o pede a alternativa CORRETA ou INCORRETA/FALSA/EXCETO?
- N\xE3o basta uma alternativa ser "verdadeira" \u2014 ela precisa responder ao que o ENUNCIADO pergunta.

PASSO 2: An\xE1lise das evid\xEAncias/explica\xE7\xF5es das fontes
- Procure textos explicativos, justificativas ou defini\xE7\xF5es nas fontes.
- Identifique trechos que mencionem conceitos presentes nas alternativas.
- Conecte cada trecho explicativo \xE0 alternativa que ele descreve.
- IMPORTANTE: Preste aten\xE7\xE3o em frases como "isso se deve a...", "o motivo \xE9...", "por conta de...", que revelam a rela\xE7\xE3o causal.

PASSO 3: Classifica\xE7\xE3o de cada alternativa
Para cada alternativa (A-E):
- Essa alternativa trata do ASPECTO ESPEC\xCDFICO pedido no enunciado? (sim/n\xE3o)
- As evid\xEAncias CONFIRMAM ou REFUTAM essa alternativa para o aspecto pedido?
- Classifique como V (verdadeira E responde ao enunciado) ou F (falsa OU n\xE3o responde ao aspecto pedido).

PASSO 4: Resposta FINAL
- Se apenas UMA alternativa \xE9 V e responde ao aspecto pedido, essa \xE9 a resposta.
- Se m\xFAltiplas s\xE3o V, releia o enunciado e escolha a mais PRECISA para o aspecto pedido.
- Se as fontes t\xEAm texto explicativo que aponta para uma alternativa, PRIORIZE essa evid\xEAncia.

FORMATO FINAL OBRIGAT\xD3RIO (\xFAltima linha):
Letra X: [texto completo da alternativa]

Se n\xE3o houver evid\xEAncia suficiente: NAO_ENCONTRADO

REGRAS:
- Nunca invente alternativas que n\xE3o estejam na quest\xE3o do cliente.
- O ENUNCIADO define o crit\xE9rio: responda ao que ele PERGUNTA, n\xE3o ao que parece "mais correto" em geral.
- Textos explicativos/justificativos nas fontes s\xE3o a evid\xEAncia mais valiosa \u2014 use-os.
${isDesperate ? `
ATEN\xC7\xC3O - EVID\xCANCIA LIMITADA:
As fontes acima cont\xEAm informa\xE7\xE3o limitada e podem n\xE3o ter a resposta expl\xEDcita.
Nesse caso, use seu CONHECIMENTO ACAD\xCAMICO para avaliar cada alternativa:
- Foque EXCLUSIVAMENTE no ASPECTO ESPEC\xCDFICO pedido no enunciado (ex: "desempenho", "seguran\xE7a", etc.).
- Uma alternativa pode ser VERDADEIRA sobre o tema geral mas N\xC3O responder ao aspecto espec\xEDfico pedido.
- Exemplo: se a quest\xE3o pede sobre "desempenho", caracter\xEDsticas de "flexibilidade" ou "linguagem" N\xC3O s\xE3o sobre desempenho.
- Elimine primeiro alternativas factualmente INCORRETAS.
- Depois, entre as corretas, escolha a que tem rela\xE7\xE3o CAUSAL DIRETA com o aspecto pedido.
- O modelo de transa\xE7\xF5es (ACID vs BASE) afeta diretamente throughput/lat\xEAncia = desempenho.
- Schemaless afeta flexibilidade, n\xE3o desempenho. Escalabilidade horizontal \u2260 vertical.` : ""}`;
          const sinceLastGroq = Date.now() - this.lastGroqCallAt;
          const preInferenceCooldown = 4e3;
          if (sinceLastGroq < preInferenceCooldown) {
            const waitMs = preInferenceCooldown - sinceLastGroq;
            console.log(`AnswerHunter: Pre-inference cooldown ${waitMs}ms (last Groq call ${sinceLastGroq}ms ago)`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
          const systemMsg = 'Voc\xEA infere respostas de quest\xF5es educacionais com base em evid\xEAncias de fontes. Analise textos explicativos, justificativas e defini\xE7\xF5es nas fontes para encontrar qual alternativa responde ao ASPECTO ESPEC\xCDFICO do enunciado. N\xE3o se limite a verificar se uma alternativa \xE9 "verdadeira" \u2014 ela precisa responder ao que o enunciado PERGUNTA. Formato final: "Letra X: [texto]" ou NAO_ENCONTRADO.';
          const letterPattern = /(?:Letra|Letter)\s*([A-E])[:\s\)]/i;
          const geminiPrimary = await this._isGeminiPrimary();
          if (geminiPrimary) {
            console.log("AnswerHunter: Inference via Gemini (primary)...");
            const gResult = await this._geminiConsensus(systemMsg, basePrompt, letterPattern, { smart: true });
            if (gResult.response) {
              console.log("AnswerHunter: Gemini primary inference votes:", gResult.votes);
              return gResult.response;
            }
            console.log("AnswerHunter: Gemini primary failed \u2014 trying Groq fallback...");
            const groqResult2 = await this._groqConsensus(systemMsg, basePrompt, letterPattern, { model: groqModelSmart });
            if (groqResult2.response) {
              console.log("AnswerHunter: Groq fallback inference votes:", groqResult2.votes);
              return groqResult2.response;
            }
            return null;
          }
          console.log("AnswerHunter: Inference via Groq (primary)...");
          const groqResult = await this._groqConsensus(systemMsg, basePrompt, letterPattern, { model: groqModelSmart });
          if (groqResult.response && groqResult.attempts.length > 0) {
            console.log("AnswerHunter: Groq primary inference votes:", groqResult.votes);
            return groqResult.response;
          }
          console.log("AnswerHunter: Groq primary failed \u2014 trying Gemini fallback...");
          const geminiResult = await this._geminiConsensus(systemMsg, basePrompt, letterPattern, { smart: true });
          if (geminiResult.response) {
            console.log("AnswerHunter: Gemini fallback inference votes:", geminiResult.votes);
            return geminiResult.response;
          }
          return null;
        },
        async generateOverviewFromEvidence(questionText, evidenceItems = []) {
          if (!questionText || !Array.isArray(evidenceItems) || evidenceItems.length === 0) return null;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelOverview, groqModelSmart } = settings;
          const modelCandidates = [
            groqModelOverview,
            "openai/gpt-oss-120b",
            groqModelSmart,
            "llama-3.3-70b-versatile"
          ].filter((m, idx, arr) => typeof m === "string" && m.trim() && arr.indexOf(m) === idx);
          const compactEvidence = evidenceItems.slice(0, 6).map((item, index) => {
            const title = String(item?.title || `Fonte ${index + 1}`).slice(0, 180);
            const link = String(item?.link || "").slice(0, 500);
            const text = String(item?.text || "").replace(/\s+/g, " ").slice(0, 850);
            return `FONTE ${index + 1}
TITULO: ${title}
LINK: ${link || "n/a"}
TRECHO: ${text}`;
          }).join("\n\n");
          const prompt2 = `Voc\xEA vai gerar um overview curto e \xFAtil (estilo Google AI Overview), SEM inventar fatos.

QUEST\xC3O:
${String(questionText).slice(0, 1800)}

EVID\xCANCIAS:
${compactEvidence}

RETORNE APENAS JSON v\xE1lido no formato:
{
  "summary": "resumo em 2-4 frases, objetivo",
  "keyPoints": ["ponto 1", "ponto 2", "ponto 3"],
  "references": [
    {"title": "nome curto da fonte", "link": "https://..."}
  ]
}

REGRAS:
- Use apenas o que est\xE1 nas evid\xEAncias.
- Se houver conflito ou baixa clareza, mencione isso no summary.
- keyPoints: no m\xE1ximo 4 itens.
- references: no m\xE1ximo 5 itens.
- N\xE3o inclua markdown, coment\xE1rio ou texto fora do JSON.`;
          const sysMsg = "Voc\xEA transforma evid\xEAncias em resumo estruturado e confi\xE1vel. Nunca invente links, cita\xE7\xF5es ou fatos fora da entrada.";
          const parseOverview = (raw, modelLabel) => {
            if (!raw) return null;
            const start = raw.indexOf("{");
            const end = raw.lastIndexOf("}");
            if (start < 0 || end <= start) return null;
            try {
              const parsed = JSON.parse(raw.slice(start, end + 1));
              const summary = String(parsed?.summary || "").trim();
              if (!summary) return null;
              const keyPoints = Array.isArray(parsed?.keyPoints) ? parsed.keyPoints.map((p) => String(p || "").trim()).filter(Boolean).slice(0, 4) : [];
              const references = Array.isArray(parsed?.references) ? parsed.references.map((ref) => ({
                title: String(ref?.title || "").trim(),
                link: String(ref?.link || "").trim()
              })).filter((ref) => ref.title || ref.link).slice(0, 5) : [];
              console.log(`AnswerHunter: Overview generated with model=${modelLabel}`);
              return { summary, keyPoints, references, model: modelLabel };
            } catch {
              return null;
            }
          };
          const geminiPrimary = await this._isGeminiPrimary();
          if (geminiPrimary) {
            try {
              console.log("AnswerHunter: Overview via Gemini (primary)...");
              const geminiRaw = await this._callGemini([
                { role: "system", content: sysMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.1, max_tokens: 700 });
              const result = parseOverview(geminiRaw, "gemini-primary");
              if (result) return result;
            } catch (gErr) {
              console.warn("AnswerHunter: Gemini primary overview failed:", gErr?.message || String(gErr));
            }
            console.log("AnswerHunter: Gemini overview failed \u2014 trying Groq fallback...");
          }
          for (const model of modelCandidates) {
            const sinceLast = Date.now() - this.lastGroqCallAt;
            if (sinceLast < 3e3) {
              await new Promise((resolve) => setTimeout(resolve, 3e3 - sinceLast));
            }
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model,
                  messages: [
                    { role: "system", content: sysMsg },
                    { role: "user", content: prompt2 }
                  ],
                  temperature: 0.1,
                  max_tokens: 700
                })
              }));
              const raw = data?.choices?.[0]?.message?.content?.trim() || "";
              const result = parseOverview(raw, model);
              if (result) return result;
            } catch (error) {
              const errMsg = error?.message || String(error);
              console.warn(`AnswerHunter: overview model failed (${model}):`, errMsg);
              if (errMsg.includes("GROQ_QUOTA_EXHAUSTED")) break;
            }
          }
          if (!geminiPrimary) {
            try {
              console.log("AnswerHunter: Groq overview failed \u2014 trying Gemini fallback...");
              const geminiRaw = await this._callGemini([
                { role: "system", content: sysMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.1, max_tokens: 700 });
              const result = parseOverview(geminiRaw, "gemini-fallback");
              if (result) return result;
            } catch (gErr) {
              console.warn("AnswerHunter: Gemini overview fallback failed:", gErr?.message || String(gErr));
            }
          }
          return null;
        },
        /**
         * Knowledge-based answer: uses LLM domain expertise when evidence is thin.
         * Runs in parallel with inferAnswerFromEvidence during desperate mode.
         * Single call, no consensus needed — acts as a tiebreaker vote.
         */
        async generateKnowledgeAnswer(questionText) {
          if (!questionText) return null;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const normQ = questionText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const wantsIncorrect = /\b(falsa|incorreta|errada|exceto|nao\s+correta)\b/i.test(normQ);
          const polarityNote = wantsIncorrect ? "\n\u26A0\uFE0F A quest\xE3o pede a alternativa INCORRETA/FALSA/EXCETO." : "";
          const prompt2 = `AN\xC1LISE ACAD\xCAMICA POR ELIMINA\xC7\xC3O

Voc\xEA \xE9 um professor universit\xE1rio especialista. Use EXCLUSIVAMENTE seu conhecimento acad\xEAmico.

QUEST\xC3O:
${questionText.substring(0, 2e3)}
${polarityNote}

INSTRU\xC7\xD5ES \u2014 siga esta ordem RIGOROSA:

1. ASPECTO PEDIDO: Identifique qual aspecto espec\xEDfico o enunciado pergunta (ex: desempenho, seguran\xE7a, modelo, etc.).

2. ELIMINA\xC7\xC3O: Para cada alternativa, an\xE1lise em 1 linha:
   - \xC9 factualmente CORRETA? Se N\xC3O \u2192 eliminada.
   - Trata DIRETAMENTE do aspecto pedido? Se N\xC3O \u2192 eliminada (mesmo sendo verdadeira).
   Formato: "X) ELIMINADA \u2014 [motivo]" ou "X) MANTIDA \u2014 [rela\xE7\xE3o com o aspecto]"

3. SELE\xC7\xC3O FINAL: Entre as mantidas, escolha a que tem rela\xE7\xE3o CAUSAL mais direta com o aspecto.
   - N\xE3o escolha a "mais famosa" \u2014 escolha a mais ESPEC\xCDFICA para o aspecto pedido.

FORMATO FINAL (\xFAltima linha):
Letra X: [texto completo da alternativa]
Ou: NAO_ENCONTRADO`;
          const systemMsg = "Voc\xEA \xE9 um professor universit\xE1rio especialista em an\xE1lise de quest\xF5es. Responda com rigor acad\xEAmico, focando no ASPECTO ESPEC\xCDFICO que o enunciado pede. N\xE3o escolha a alternativa mais popular \u2014 escolha a mais precisa para o aspecto pedido.";
          const isValid = (c) => c && c.length >= 3 && !/^(NAO_ENCONTRADO|SEM_RESPOSTA|INCONCLUSIVO)/i.test(c);
          const geminiPrimary = await this._isGeminiPrimary();
          const tryGroq = async () => {
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt2 }],
                  temperature: 0.1,
                  max_tokens: 600
                })
              }));
              const c = data?.choices?.[0]?.message?.content?.trim() || "";
              if (isValid(c)) {
                console.log("AnswerHunter: Knowledge answer (Groq):", c.substring(0, 120));
                return c;
              }
            } catch (e) {
              console.warn("AnswerHunter: Knowledge Groq failed:", e);
            }
            return null;
          };
          const tryGemini = async () => {
            try {
              const r = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], {
                temperature: 0.1,
                max_tokens: 600,
                model: settings.geminiModelSmart || "gemini-2.5-flash"
              });
              const c = r?.trim() || "";
              if (isValid(c)) {
                console.log("AnswerHunter: Knowledge answer (Gemini):", c.substring(0, 120));
                return c;
              }
            } catch (e) {
              console.warn("AnswerHunter: Knowledge Gemini failed:", e);
            }
            return null;
          };
          if (geminiPrimary) {
            const res2 = await tryGemini();
            if (res2) return res2;
            return await tryGroq();
          }
          const res = await tryGroq();
          if (res) return res;
          return await tryGemini();
        },
        /**
         * Main refinement function (3-Steps)
         */
        async refineWithGroq(item) {
          console.log("AnswerHunter: Iniciando refinamento com 3 prompts...");
          const originalQuestion = item.question;
          const hasOptionsInOriginal = /[A-E]\s*[\)\.]\s*\S+/i.test(originalQuestion);
          let options = null;
          let optionsPromise = null;
          if (!hasOptionsInOriginal && item.answer && item.answer.length > 30) {
            options = this._extractOptionsLocally(item.answer);
            if (!options) {
              optionsPromise = this.extractOptionsFromSource(item.answer);
            }
          }
          const answerPromise = this.inferAnswerFromEvidence(originalQuestion, item.answer);
          const [answer, optionsFromGroq] = await Promise.all([
            answerPromise,
            optionsPromise ? optionsPromise : Promise.resolve(null)
          ]);
          if (!options && optionsFromGroq) options = optionsFromGroq;
          console.log("AnswerHunter: Resposta identificada:", answer ? "Sim" : "Nao");
          if (!answer) {
            return null;
          }
          let finalQuestion = originalQuestion;
          if (!hasOptionsInOriginal && options) {
            finalQuestion = originalQuestion + "\n" + options;
          }
          return {
            question: finalQuestion.trim(),
            answer: answer.trim()
          };
        },
        /**
         * Fallback: generate answer directly by AI when there are no sources
         * Uses anti-hallucination prompt: evaluates each alternative individually,
         * checks for contradictions, then selects.
         * NOW WITH CONSENSUS VOTING for unreliable models
         * Uses SMART model (280 t/s) - requires deep reasoning without external evidence
         */
        async generateAnswerFromQuestion(questionText) {
          if (!questionText) return null;
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const hasOptions = /\b[A-E]\s*[).\-]\s/m.test(questionText);
          const prompt2 = hasOptions ? `AN\xC1LISE SISTEM\xC1TICA DE QUEST\xC3O DE M\xDALTIPLA ESCOLHA

QUEST\xC3O:
${questionText}

INSTRU\xC7\xD5ES - siga EXATAMENTE esta ordem:

PASSO 1: Classifique CADA alternativa como V (verdadeira) ou F (falsa), com uma justificativa OBJETIVA de 1 linha baseada em fatos/defini\xE7\xF5es.
Formato: "X) V/F - [justificativa]"

PASSO 2: Verifique contradi\xE7\xF5es:
- H\xE1 duas alternativas dizendo a mesma coisa? 
- A quest\xE3o pede a CORRETA ou a INCORRETA/FALSA/EXCETO?

PASSO 3: Com base nos passos anteriores, indique a resposta FINAL.
Se a quest\xE3o pede a CORRETA: escolha a alternativa V.
Se a quest\xE3o pede a INCORRETA/FALSA/EXCETO: escolha a alternativa F.

FORMATO FINAL (\xFAltima linha):
- Se houver seguran\xE7a razo\xE1vel: "Letra X: [texto completo da alternativa escolhida]"
- Se n\xE3o houver seguran\xE7a suficiente: "INCONCLUSIVO: sem evid\xEAncia suficiente para marcar alternativa"

REGRAS:
- Nunca invente alternativas que n\xE3o estejam na quest\xE3o.
- Se houver d\xFAvida real entre duas alternativas, use INCONCLUSIVO.
- Preste aten\xE7\xE3o especial se a quest\xE3o pede "incorreta", "falsa", "exceto" ou "n\xE3o \xE9".` : `Responda a quest\xE3o abaixo de forma direta e objetiva.

QUEST\xC3O:
${questionText}

REGRAS:
- Responda em 1 a 3 frases.
- N\xE3o invente cita\xE7\xF5es.`;
          if (hasOptions) {
            const mcSystemMsg = "Voc\xEA \xE9 um especialista em an\xE1lise de quest\xF5es de m\xFAltipla escolha. Seja conservador: quando faltar evid\xEAncia clara, responda INCONCLUSIVO em vez de chutar.";
            const mcLetterPattern = /[*_]{0,2}(?:Letra|Letter|Alternativa|Resposta\s+(?:correta|final))[:\s*_]{0,4}[*_]{0,2}\s*([A-E])\b|\b([A-E])\s*[).]\s*(?:V\b|verdadeira|correta)/i;
            const geminiPrimary = await this._isGeminiPrimary();
            const tabulateGroqAttempts = (attempts) => {
              const asksIncorrect = /\b(incorreta|falsa|exceto|nao\s+e|não\s+é|errada)\b/i.test(questionText);
              const votes = {};
              const fullResponses = {};
              let validVoteCount = 0;
              for (const response of attempts) {
                if (!response || /^INCONCLUSIVO/i.test(response)) continue;
                const normalized = String(response);
                const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                const lastLine = lines.length > 0 ? lines[lines.length - 1] : normalized.trim();
                let match = lastLine.match(/(?:^|\b)(?:resposta\s+final\s*[:\-]\s*)?(?:letra|letter)\s*([A-E])\b/i);
                if (!match) match = normalized.match(/(?:^|\b)(?:letra|letter)\s*([A-E])\b/i);
                if (!match) continue;
                const vfMatches = [...normalized.matchAll(/\b([A-E])\)\s*([VF])\b/gi)];
                if (vfMatches.length >= 2) {
                  const vCount = vfMatches.filter((m) => String(m[2]).toUpperCase() === "V").length;
                  const fCount = vfMatches.filter((m) => String(m[2]).toUpperCase() === "F").length;
                  if (!asksIncorrect && vCount > 1 || asksIncorrect && fCount > 1) continue;
                }
                const letter = String(match[1]).toUpperCase();
                validVoteCount += 1;
                votes[letter] = (votes[letter] || 0) + 1;
                if (!fullResponses[letter] || response.length > fullResponses[letter].length) {
                  fullResponses[letter] = response;
                }
              }
              if (validVoteCount === 0) return null;
              const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
              const [winnerLetter, winnerCount] = sorted[0];
              const secondCount = sorted[1]?.[1] || 0;
              const hasRobustConsensus = winnerCount >= 2 && winnerCount > secondCount && winnerCount / validVoteCount >= 0.6;
              if (hasRobustConsensus) {
                console.log(`AnswerHunter: MC consensus \u2192 Letter ${winnerLetter} (${winnerCount}/${validVoteCount})`);
                return fullResponses[winnerLetter];
              }
              return null;
            };
            if (geminiPrimary) {
              console.log("AnswerHunter: MC via Gemini (primary)...");
              const gResult2 = await this._geminiConsensus(mcSystemMsg, prompt2, mcLetterPattern, { smart: true });
              if (gResult2.response) {
                console.log("AnswerHunter: Gemini primary MC votes:", gResult2.votes);
                return gResult2.response;
              }
              console.log("AnswerHunter: Gemini MC failed \u2014 trying Groq fallback...");
              const groqResult2 = await this._groqConsensus(mcSystemMsg, prompt2, mcLetterPattern, {
                model: groqModelSmart,
                temps: [0.12, 0.28]
                // 2 attempts to preserve quota
              });
              if (groqResult2.attempts.length > 0) {
                const tabulated = tabulateGroqAttempts(groqResult2.attempts);
                if (tabulated) return tabulated;
              }
              return "INCONCLUSIVO: sem consenso confi\xE1vel entre tentativas da IA.";
            }
            const groqResult = await this._groqConsensus(mcSystemMsg, prompt2, mcLetterPattern, {
              model: groqModelSmart,
              temps: [0.12, 0.28]
              // 2 attempts to preserve quota
            });
            if (groqResult.attempts.length > 0) {
              const tabulated = tabulateGroqAttempts(groqResult.attempts);
              if (tabulated) return tabulated;
            }
            console.log("AnswerHunter: Groq MC failed \u2014 trying Gemini fallback...");
            const gResult = await this._geminiConsensus(mcSystemMsg, prompt2, mcLetterPattern, { smart: true });
            if (gResult.response) {
              console.log("AnswerHunter: Gemini MC fallback votes:", gResult.votes);
              return gResult.response;
            }
            return "INCONCLUSIVO: sem evid\xEAncia suficiente para marcar alternativa.";
          }
          const geminiPrimaryOpen = await this._isGeminiPrimary();
          const openSysMsg = "Voc\xEA \xE9 um assistente que responde quest\xF5es com objetividade.";
          if (geminiPrimaryOpen) {
            const geminiOpen = await this._callGemini([
              { role: "system", content: openSysMsg },
              { role: "user", content: prompt2 }
            ], { temperature: 0.15, max_tokens: 300 });
            if (geminiOpen) return geminiOpen;
          }
          if (settings.groqApiKey && this._groqQuotaExhaustedUntil <= Date.now()) {
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [
                    { role: "system", content: openSysMsg },
                    { role: "user", content: prompt2 }
                  ],
                  temperature: 0.15,
                  max_tokens: 300
                })
              }));
              const content = data.choices?.[0]?.message?.content?.trim() || "";
              if (content && content.length > 5 && !/^(NAO_ENCONTRADO|INCONCLUSIVO)/i.test(content)) return content;
            } catch (error) {
              console.warn("AnswerHunter: Groq open-ended failed:", error?.message || String(error));
            }
          }
          console.log("AnswerHunter: Trying Gemini fallback for open-ended...");
          const geminiOpenFallback = await this._callGemini([
            { role: "system", content: openSysMsg },
            { role: "user", content: prompt2 }
          ], { temperature: 0.15, max_tokens: 300 });
          if (geminiOpenFallback) return geminiOpenFallback;
          return null;
        },
        /**
         * Define a term in context (contextual dictionary tooltip)
         */
        async defineTerm(term, contextText = "") {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelFast } = settings;
          const systemMsg = "Voc\xEA \xE9 um dicion\xE1rio educacional conciso. Defina termos de forma clara e breve (2-3 linhas).";
          const prompt2 = contextText ? `Defina o termo "${term}" considerando o seguinte contexto educacional:

${contextText.slice(0, 500)}

Defini\xE7\xE3o breve:` : `Defina o termo "${term}" de forma breve e educacional. Defini\xE7\xE3o:`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.2, max_tokens: 150, model: settings.geminiModel || "gemini-2.5-flash" });
            } catch (e) {
              console.warn("AnswerHunter: Gemini defineTerm error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, {
                temperature: 0.1,
                max_tokens: 600,
                model: settings.geminiModelSmart || "gemini-2.5-flash"
              });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelFast,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt2 }],
                  temperature: 0.2,
                  max_tokens: 150
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq defineTerm error:", e?.message || e);
              return null;
            }
          };
          const geminiPrimary = false;
          const settingsForFallback = await this._getSettings();
          const primary = settingsForFallback.primaryProvider || "groq";
          let chain = [];
          if (typeof tryOpenRouter2 !== "undefined") {
            chain = [tryGroq, tryOpenRouter2, tryGemini];
            if (primary === "openrouter") chain = [tryOpenRouter2, tryGemini, tryGroq];
            else if (primary === "gemini") chain = [tryGemini, tryOpenRouter2, tryGroq];
          } else {
            chain = [tryGroq, tryGemini];
            if (primary === "gemini") chain = [tryGemini, tryGroq];
          }
          let result = null;
          for (const fn of chain) {
            result = await fn();
            if (result) break;
          }
          return result || `Termo n\xE3o encontrado: ${term}`;
        },
        /**
         * Generate a step-by-step tutor explanation for a question and answer
         */
        async generateTutorExplanation(question, answer, context = "") {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const systemMsg = "Voc\xEA \xE9 um tutor educacional especializado. Explique conceitos de forma did\xE1tica, passo a passo.";
          const prompt2 = `Explique de forma did\xE1tica e passo a passo por que a resposta correta para a quest\xE3o abaixo \xE9 a alternativa indicada.

QUEST\xC3O:
${question.slice(0, 1500)}

RESPOSTA CORRETA:
${answer.slice(0, 500)}

${context ? `CONTEXTO ADICIONAL:
${context.slice(0, 300)}
` : ""}
INSTRU\xC7\xD5ES:
- Use linguagem clara e acess\xEDvel para estudantes
- Explique o racioc\xEDnio por tr\xE1s da resposta
- Mencione por que as outras alternativas est\xE3o incorretas se poss\xEDvel
- Use marcadores e par\xE1grafos para facilitar a leitura
- Seja objetivo (m\xE1ximo 300 palavras)`;
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              return await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.3, max_tokens: 600, model: settings.geminiModelSmart || "gemini-2.5-flash" });
            } catch (e) {
              console.warn("AnswerHunter: Gemini generateTutorExplanation error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.3, max_tokens: 600, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt2 }],
                  temperature: 0.3,
                  max_tokens: 600
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq generateTutorExplanation error:", e?.message || e);
              return null;
            }
          };
          const geminiPrimary = false;
          const settingsForFallback = await this._getSettings();
          const primary = settingsForFallback.primaryProvider || "groq";
          let chain = [];
          if (typeof tryOpenRouter2 !== "undefined") {
            if (primary === "openrouter") chain = [tryOpenRouter2, tryGemini, tryGroq];
            else if (primary === "gemini") chain = [tryGemini, tryOpenRouter2, tryGroq];
            else chain = [tryGroq, tryOpenRouter2, tryGemini];
          } else {
            if (primary === "gemini") chain = [tryGemini, tryGroq];
            else chain = [tryGroq, tryGemini];
          }
          let result = null;
          for (const fn of chain) {
            result = await fn();
            if (result) break;
          }
          return result || "N\xE3o foi poss\xEDvel gerar a explica\xE7\xE3o. Tente novamente.";
        },
        /**
         * Generate a similar multiple-choice question to test the user's knowledge
         * Returns { questionText, optionsMap, answerLetter } or throws on failure
         */
        async generateSimilarQuestion(originalQuestion) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const systemMsg = "Voc\xEA cria quest\xF5es de m\xFAltipla escolha educacionais. Responda APENAS em JSON v\xE1lido, sem texto adicional.";
          const prompt2 = `Com base na quest\xE3o abaixo, crie UMA quest\xE3o similar de m\xFAltipla escolha com 4 alternativas (A, B, C, D).

QUEST\xC3O ORIGINAL:
${originalQuestion.slice(0, 1e3)}

FORMATO DE RESPOSTA (JSON exato, sem markdown):
{
  "questionText": "enunciado da nova quest\xE3o",
  "optionsMap": {
    "A": "texto da alternativa A",
    "B": "texto da alternativa B",
    "C": "texto da alternativa C",
    "D": "texto da alternativa D"
  },
  "answerLetter": "A"
}

REGRAS:
- A quest\xE3o deve testar o mesmo conceito, mas com abordagem diferente
- Apenas UMA alternativa deve ser correta
- As alternativas incorretas devem ser plaus\xEDveis
- Responda APENAS com o JSON, sem explica\xE7\xF5es adicionais`;
          const parseResponse = (content) => {
            if (!content) return null;
            try {
              const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
              const parsed = JSON.parse(cleaned);
              if (!parsed.questionText || !parsed.optionsMap || !parsed.answerLetter) return null;
              return parsed;
            } catch (_) {
              return null;
            }
          };
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              const content = await this._callGemini([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], { temperature: 0.5, max_tokens: 500, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              return parseResponse(content);
            } catch (e) {
              console.warn("AnswerHunter: Gemini generateSimilarQuestion error:", e?.message || e);
              return null;
            }
          };
          const tryOpenRouter2 = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
              const opts = Object.assign({}, { temperature: 0.5, max_tokens: 500, model: settings.geminiModelSmart || "gemini-2.5-flash" });
              opts.model = settings.openrouterModelSmart || "deepseek/deepseek-r1:free";
              return await this._callOpenRouter([
                { role: "system", content: systemMsg },
                { role: "user", content: prompt2 }
              ], opts);
            } catch (e) {
              console.warn("AnswerHunter: OpenRouter logic error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt2 }],
                  temperature: 0.5,
                  max_tokens: 500
                })
              }));
              return parseResponse(data?.choices?.[0]?.message?.content?.trim() || "");
            } catch (e) {
              console.warn("AnswerHunter: Groq generateSimilarQuestion error:", e?.message || e);
              return null;
            }
          };
          const geminiPrimary = false;
          const settingsForFallback = await this._getSettings();
          const primary = settingsForFallback.primaryProvider || "groq";
          let chain = [];
          if (typeof tryOpenRouter2 !== "undefined") {
            if (primary === "openrouter") chain = [tryOpenRouter2, tryGemini, tryGroq];
            else if (primary === "gemini") chain = [tryGemini, tryOpenRouter2, tryGroq];
            else chain = [tryGroq, tryOpenRouter2, tryGemini];
          } else {
            if (primary === "gemini") chain = [tryGemini, tryGroq];
            else chain = [tryGroq, tryGemini];
          }
          let result = null;
          for (const fn of chain) {
            result = await fn();
            if (result) break;
          }
          if (!result) throw new Error("N\xE3o foi poss\xEDvel gerar uma quest\xE3o similar.");
          return result;
        },
        /**
         * Answer a follow-up question from the user in the context of a previous question/answer
         */
        async answerFollowUp(originalQuestion, originalAnswer, context, userMessage, messageHistory = []) {
          const settings = await this._getSettings();
          const { groqApiUrl, groqApiKey, groqModelSmart } = settings;
          const systemMsg = `Voc\xEA \xE9 um tutor educacional. O estudante acabou de resolver uma quest\xE3o e tem d\xFAvidas.
Quest\xE3o original: ${originalQuestion.slice(0, 800)}
Resposta correta: ${originalAnswer.slice(0, 300)}
${context ? `Contexto: ${context.slice(0, 200)}` : ""}

Responda de forma clara, did\xE1tica e concisa (m\xE1ximo 200 palavras). N\xE3o repita a quest\xE3o inteira.`;
          const recentHistory = messageHistory.slice(-6);
          const messages = [
            { role: "system", content: systemMsg },
            ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: userMessage }
          ];
          const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
              return await this._callGemini(messages, {
                temperature: 0.3,
                max_tokens: 400,
                model: settings.geminiModel || "gemini-2.5-flash"
              });
            } catch (e) {
              console.warn("AnswerHunter: Gemini answerFollowUp error:", e?.message || e);
              return null;
            }
          };
          const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            try {
              const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: groqModelSmart,
                  messages,
                  temperature: 0.3,
                  max_tokens: 400
                })
              }));
              return data?.choices?.[0]?.message?.content?.trim() || null;
            } catch (e) {
              console.warn("AnswerHunter: Groq answerFollowUp error:", e?.message || e);
              return null;
            }
          };
          const geminiPrimary = false;
          const settingsForFallback = await this._getSettings();
          const primary = settingsForFallback.primaryProvider || "groq";
          let chain = [];
          if (typeof tryOpenRouter !== "undefined") {
            if (primary === "openrouter") chain = [tryOpenRouter, tryGemini, tryGroq];
            else if (primary === "gemini") chain = [tryGemini, tryOpenRouter, tryGroq];
            else chain = [tryGroq, tryOpenRouter, tryGemini];
          } else {
            if (primary === "gemini") chain = [tryGemini, tryGroq];
            else chain = [tryGroq, tryGemini];
          }
          let result = null;
          for (const fn of chain) {
            result = await fn();
            if (result) break;
          }
          return result || "N\xE3o foi poss\xEDvel processar sua pergunta. Tente novamente.";
        }
      };
    }
  });

  // src/services/search/QuestionParser.js
  var QuestionParser;
  var init_QuestionParser = __esm({
    "src/services/search/QuestionParser.js"() {
      QuestionParser = {
        // ── Text normalization ─────────────────────────────────────────────────────
        stripOptionTailNoise(text) {
          if (!text) return "";
          let cleaned = String(text).replace(/\s+/g, " ").trim();
          const noiseMarker = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parabéns|você\s+acertou|confira\s+o\s+gabarito|explicação)\b/i;
          const idx = cleaned.search(noiseMarker);
          if (idx > 20) cleaned = cleaned.slice(0, idx).trim();
          return cleaned.replace(/[;:,\-.\s]+$/g, "").trim();
        },
        normalizeOption(text) {
          return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^[a-e]\s*[\)\.\-:]\s*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
        },
        looksLikeCodeOption(text) {
          const body = String(text || "");
          return /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|->|jsonb?|\bdb\.\w|\.(?:find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(body);
        },
        normalizeCodeAwareOption(text) {
          return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^[a-e]\s*[\)\.\-:]\s*/i, "").replace(/->>|/g, " op_json_text ").replace(/->/g, " op_json_obj ").replace(/=>/g, " op_arrow ").replace(/::/g, " op_dcolon ").replace(/:=/g, " op_assign ").replace(/!=/g, " op_neq ").replace(/<>/g, " op_neq ").replace(/<=/g, " op_lte ").replace(/>=/g, " op_gte ").replace(/</g, " op_lt ").replace(/>/g, " op_gt ").replace(/:/g, " op_colon ").replace(/=/g, " op_eq ").replace(/[^a-z0-9_]+/g, " ").replace(/\s+/g, " ").trim();
        },
        isUsableOptionBody(body) {
          const cleaned = String(body || "").replace(/\s+/g, " ").trim();
          if (!cleaned || cleaned.length < 1) return false;
          if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(cleaned)) return false;
          if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(cleaned)) return false;
          if (/^(?:resposta|gabarito|alternativa\s+correta)\b/i.test(cleaned)) return false;
          return true;
        },
        // ── Question structure ─────────────────────────────────────────────────────
        extractQuestionStem(questionWithOptions) {
          const text = (questionWithOptions || "").replace(/\r\n/g, "\n");
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const optionRe = /^([A-E])\s*[\)\.\-:]/i;
          const stemLines = [];
          for (const line of lines) {
            if (optionRe.test(line)) break;
            stemLines.push(line);
          }
          let stem = stemLines.join(" ").trim() || text.trim();
          const inlineOpt = stem.match(/[\s:;]([A-E])\s*[\)\.\-:]\s+/i);
          if (inlineOpt && Number.isFinite(inlineOpt.index) && inlineOpt.index > 30) {
            stem = stem.slice(0, inlineOpt.index).trim();
          }
          return stem.slice(0, 600);
        },
        extractOptionsFromQuestion(questionText) {
          if (!questionText) return [];
          const text = String(questionText || "").replace(/\r\n/g, "\n");
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const options = [];
          const seen = /* @__PURE__ */ new Set();
          const seenBodies = /* @__PURE__ */ new Set();
          const _codeDedupKey = (body) => this.normalizeCodeAwareOption(body).replace(/\s+/g, "");
          const optionRe = /^["'""\u2018\u2019\(\[]?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
          for (const line of lines) {
            const m2 = line.match(optionRe);
            if (!m2) continue;
            const letter = (m2[1] || "").toUpperCase();
            const cleanedBody = this.stripOptionTailNoise(m2[2]);
            const normalizedBody = this.normalizeOption(cleanedBody);
            const isCodeLike = this.looksLikeCodeOption(cleanedBody);
            const dedupKey = isCodeLike ? _codeDedupKey(cleanedBody) : normalizedBody;
            const duplicateBody = seenBodies.has(dedupKey);
            if (!this.isUsableOptionBody(cleanedBody) || !normalizedBody || seen.has(letter) || !isCodeLike && duplicateBody) continue;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
            if (!isCodeLike) seenBodies.add(dedupKey);
          }
          const inlineRe = /(?:^|[\n\r\t ;"'""''])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;"'""''][A-E]\s*[\)\.\-:]\s)|$)/gi;
          let m;
          while ((m = inlineRe.exec(text)) !== null) {
            const letter = (m[1] || "").toUpperCase();
            if (!letter || seen.has(letter)) continue;
            const cleanedBody = this.stripOptionTailNoise(m[2]);
            const normalizedBody = this.normalizeOption(cleanedBody);
            const isCodeLike = this.looksLikeCodeOption(cleanedBody);
            const inlineDedupKey = isCodeLike ? _codeDedupKey(cleanedBody) : normalizedBody;
            const duplicateBody = seenBodies.has(inlineDedupKey);
            if (!this.isUsableOptionBody(cleanedBody) || !normalizedBody || !isCodeLike && duplicateBody) continue;
            options.push(`${letter}) ${cleanedBody}`);
            seen.add(letter);
            if (!isCodeLike) seenBodies.add(inlineDedupKey);
            if (seen.size >= 5) break;
          }
          const stemNorm = this.normalizeOption(this.extractQuestionStem(text));
          const expectsCodeOptions = /\b(?:sql|jsonb?|insert|update|delete|select|comando|sintaxe|codigo)\b/i.test(stemNorm);
          if (expectsCodeOptions && options.length >= 4) {
            const parsed = options.map((line) => {
              const mm = String(line || "").match(/^([A-E])\)\s*(.+)$/i);
              const letter = (mm?.[1] || "").toUpperCase();
              const body = this.stripOptionTailNoise(mm?.[2] || "");
              const codeLike = this.looksLikeCodeOption(body);
              return { letter, body, codeLike };
            }).filter((o) => /^[A-E]$/.test(o.letter) && !!o.body);
            const codeEntries = parsed.filter((o) => o.codeLike);
            const nonCodeEntries = parsed.filter((o) => !o.codeLike);
            const allLetters = parsed.map((o) => o.letter).sort();
            const expectedLettersForCount = ["A", "B", "C", "D", "E"].slice(0, allLetters.length);
            const isCompleteSequence = allLetters.join("") === expectedLettersForCount.join("");
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
          const text = String(answerText).replace(/\r/g, "\n").trim();
          if (!text) return null;
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const finalLineRe = /^(?:(?:resposta\s+final|conclus[aã]o|gabarito)\s*[:\-]\s*)?(?:letra|gabarito|resposta\s+final|alternativa\s+correta|letter|option)\s*[:\-]?\s*([A-E])\b(?:\s*[:.·\-]|$)/i;
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
            const m = lines[i].match(finalLineRe);
            if (m) return (m[1] || "").toUpperCase();
          }
          const taggedMatches = [...text.matchAll(/(?:^|\b)(?:resposta\s+final|gabarito|alternativa\s+correta|letra|letter|option)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
          const uniqueTagged = [...new Set(taggedMatches)];
          if (uniqueTagged.length === 1) return uniqueTagged[0];
          if (uniqueTagged.length > 1) return null;
          const prosePatterns = [
            /(?:resposta|answer)\s+(?:correta\s+)?(?:[eéÉ]|seria)\s+(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi,
            /(?:alternativa|opção|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?([A-E])\b/gi,
            /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi
          ];
          for (const re of prosePatterns) {
            const proseHits = [...text.matchAll(re)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
            const uniqueProse = [...new Set(proseHits)];
            if (uniqueProse.length === 1) return uniqueProse[0];
          }
          const optionLineMatches = [...text.matchAll(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s+/gim)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
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
          if (!answerText) return "";
          const text = String(answerText).replace(/\r/g, "\n").trim();
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const finalBodyRe = /(?:letra|alternativa|letter|option)\s*[A-E]\s*[:.·\-]\s*(.{5,})/i;
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
            const m = lines[i].match(finalBodyRe);
            if (m && m[1]) return m[1].trim();
          }
          return text.replace(/^(?:Letra|Alternativa|Letter|Option)\s*[A-E]\s*[:.·\-]?\s*/i, "").replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, "").trim();
        },
        findLetterByAnswerText(answerBody, optionsMap) {
          if (!answerBody || !optionsMap) return null;
          const normalizedAnswer = this.normalizeOption(answerBody);
          if (!normalizedAnswer || normalizedAnswer.length < 20) return null;
          const normalizedEntries = Object.entries(optionsMap).map(([letter, body]) => [letter, this.normalizeOption(body)]).filter(([, body]) => !!body && body.length >= 8);
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
              if (score > bestScore) {
                bestScore = score;
                bestLetter = letter;
              }
            }
          });
          return bestLetter;
        },
        // ── Tokenization & similarity ──────────────────────────────────────────────
        extractKeyTokens(stem) {
          const stop = /* @__PURE__ */ new Set([
            "assinale",
            "afirmativa",
            "alternativa",
            "correta",
            "incorreta",
            "resposta",
            "gabarito",
            "que",
            "qual",
            "quais",
            "como",
            "para",
            "por",
            "com",
            "sem",
            "uma",
            "um",
            "de",
            "da",
            "do",
            "das",
            "dos",
            "na",
            "no",
            "nas",
            "nos",
            "ao",
            "aos",
            "as",
            "os",
            "e",
            "ou",
            "em"
          ]);
          const tokens = this.normalizeOption(stem).split(" ").filter(Boolean);
          return tokens.filter((t) => t.length >= 5 && !stop.has(t)).slice(0, 10);
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
          const tokenFreq = /* @__PURE__ */ new Map();
          const optionCount = options.length;
          for (const rawOpt of options) {
            const m = String(rawOpt || "").match(/^([A-E])\)\s*(.+)$/i);
            const body = m ? this.stripOptionTailNoise(m[2]) : "";
            if (!body) continue;
            const isCode = this.looksLikeCodeOption(body);
            const normalized = isCode ? this.normalizeCodeAwareOption(body) : this.normalizeOption(body);
            if (!normalized) continue;
            const seenInThisOption = /* @__PURE__ */ new Set();
            for (const w of normalized.split(/\s+/).filter(Boolean)) {
              if (w.length >= 3 && !stemTokenSet.has(w) && !seenInThisOption.has(w)) {
                seenInThisOption.add(w);
                tokenFreq.set(w, (tokenFreq.get(w) || 0) + 1);
              }
            }
          }
          const maxFreq = Math.ceil(optionCount / 2);
          return [...tokenFreq.entries()].filter(([, count]) => count <= maxFreq).sort((a, b) => a[1] - b[1]).map(([token]) => token).slice(0, 8);
        },
        diceSimilarity(a, b) {
          if (!a || !b) return 0;
          if (a === b) return 1;
          const bigrams = (s) => {
            const set = /* @__PURE__ */ new Map();
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
          return 2 * intersection / (a.length - 1 + b.length - 1) || 0;
        },
        questionSimilarityScore(sourceText, questionStem) {
          if (!sourceText || !questionStem) return 0;
          const srcNorm = this.normalizeOption(sourceText);
          const stemNorm = this.normalizeOption(questionStem);
          const stemTokens = stemNorm.split(/\s+/).filter((t) => t.length >= 4);
          const srcTokens = new Set(srcNorm.split(/\s+/).filter((t) => t.length >= 4));
          if (stemTokens.length === 0) return 0;
          let hits = 0;
          for (const t of stemTokens) {
            if (srcTokens.has(t)) hits++;
          }
          const tokenScore = hits / stemTokens.length;
          const prefix = stemNorm.slice(0, 50);
          const prefixMatch = prefix.length >= 20 && srcNorm.includes(prefix) ? 0.3 : 0;
          const diceScore = this.diceSimilarity(stemNorm.slice(0, 120), srcNorm.slice(0, Math.min(srcNorm.length, 500)));
          return Math.min(1, tokenScore * 0.5 + prefixMatch + diceScore * 0.3);
        },
        detectQuestionPolarity(questionText) {
          const text = String(questionText || "").toLowerCase();
          const incorrectMarkers = /\b(?:incorreta|errada|falsa|inv[áa]lida|n[aã]o\s+(?:[eé]|est[aá])|incorreto|errado|falso|inv[áa]lido)\b/;
          const correctMarkers = /\b(?:correta|verdadeira|v[áa]lida|certa|correto|verdadeiro|v[áa]lido|certo)\b/;
          const incorrectScore = (text.match(incorrectMarkers) || []).length;
          const correctScore = (text.match(correctMarkers) || []).length;
          return incorrectScore > correctScore ? "INCORRECT" : "CORRECT";
        },
        /**
         * Creates a canonical string from question + options for hashing/dedup.
         */
        canonicalizeQuestion(questionText) {
          const stem = this.extractQuestionStem(questionText);
          const options = this.extractOptionsFromQuestion(questionText);
          const normStem = this.normalizeOption(stem).replace(/\s+/g, " ").trim();
          const normOpts = (options || []).map((o) => this.normalizeOption(o).replace(/\s+/g, " ").trim()).sort();
          return `${normStem}||${normOpts.join("|")}`;
        }
      };
    }
  });

  // src/services/search/OptionsMatchService.js
  var OptionsMatchService;
  var init_OptionsMatchService = __esm({
    "src/services/search/OptionsMatchService.js"() {
      init_QuestionParser();
      OptionsMatchService = {
        // ── Coverage ──────────────────────────────────────────────────────────────
        /**
         * Counts how many of the user's options appear in the free-form source text.
         * Returns { hits, total, ratio, hasEnoughOptions }
         */
        optionsCoverageInFreeText(originalOptions, sourceText) {
          if (!originalOptions || originalOptions.length < 2) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
          }
          if (!sourceText || sourceText.length < 80) {
            return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
          }
          const normalizedSource = QuestionParser.normalizeOption(sourceText);
          if (!normalizedSource) return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: true };
          const optionEntries = [];
          const seen = /* @__PURE__ */ new Set();
          for (const rawOpt of originalOptions) {
            const cleaned = QuestionParser.stripOptionTailNoise(rawOpt);
            if (!cleaned) continue;
            const isCodeLike = QuestionParser.looksLikeCodeOption(cleaned);
            const normalized = isCodeLike ? QuestionParser.normalizeCodeAwareOption(cleaned) : QuestionParser.normalizeOption(cleaned);
            if (!normalized) continue;
            const dedupKey = isCodeLike ? `code:${normalized.replace(/\s+/g, "")}` : `text:${normalized}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            optionEntries.push({ normalized, isCodeLike });
          }
          const total = optionEntries.length;
          if (total === 0) return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
          const normalizedSourceCode = QuestionParser.normalizeCodeAwareOption(sourceText);
          const sourceCompact = normalizedSource.replace(/\s+/g, "");
          const sourceCompactCode = normalizedSourceCode.replace(/\s+/g, "");
          const sourceTokenSet = new Set(normalizedSource.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 3));
          const sourceCodeTokenSet = new Set(normalizedSourceCode.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 3));
          const weakStop = /* @__PURE__ */ new Set([
            "assinale",
            "afirmativa",
            "alternativa",
            "correta",
            "incorreta",
            "resposta",
            "dados",
            "bancos",
            "banco",
            "modelo",
            "modelos",
            "nosql",
            "sql"
          ]);
          let hits = 0;
          for (const entry of optionEntries) {
            const opt = entry.normalized;
            if (!opt) continue;
            if (entry.isCodeLike) {
              if (normalizedSourceCode.includes(opt)) {
                hits++;
                continue;
              }
              const optCompactCode = opt.replace(/\s+/g, "");
              if (optCompactCode.length >= 14 && sourceCompactCode.includes(optCompactCode)) {
                hits++;
                continue;
              }
              const optTokens2 = opt.split(/\s+/).map((t) => t.trim()).filter(Boolean);
              const opTokens = optTokens2.filter((t) => t.startsWith("op_"));
              const lexTokens = optTokens2.filter((t) => !t.startsWith("op_") && t.length >= 4 && !weakStop.has(t));
              if (lexTokens.length === 0) continue;
              let lexHits = 0;
              for (const tk of lexTokens) {
                if (sourceCodeTokenSet.has(tk)) lexHits++;
              }
              const lexRatio = lexHits / lexTokens.length;
              let opHits = 0;
              for (const op of opTokens) {
                if (sourceCodeTokenSet.has(op)) opHits++;
              }
              const opRatio = opTokens.length > 0 ? opHits / opTokens.length : 1;
              if (lexHits >= 2 && lexRatio >= 0.5 && opRatio >= 0.5 || lexRatio >= 0.7 && opRatio >= 0.34) hits++;
              continue;
            }
            if (normalizedSource.includes(opt)) {
              hits++;
              continue;
            }
            const optCompact = opt.replace(/\s+/g, "");
            if (optCompact.length >= 12 && sourceCompact.includes(optCompact)) {
              hits++;
              continue;
            }
            const optTokens = opt.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 4 && !weakStop.has(t));
            if (optTokens.length === 0) continue;
            let tokenHits = 0;
            for (const tk of optTokens) {
              if (sourceTokenSet.has(tk)) tokenHits++;
            }
            const tokenRatio = tokenHits / optTokens.length;
            if (tokenHits >= 2 && tokenRatio >= 0.55 || tokenRatio >= 0.72) hits++;
          }
          return { hits, total, ratio: hits / total, hasEnoughOptions: true };
        },
        optionsMatchInFreeText(originalOptions, sourceText) {
          const coverage = this.optionsCoverageInFreeText(originalOptions, sourceText);
          if (!coverage.hasEnoughOptions || coverage.total === 0) return true;
          return coverage.ratio >= 0.6 || coverage.hits >= Math.min(3, coverage.total);
        },
        optionsMatch(originalOptions, sourceOptions) {
          if (!originalOptions || originalOptions.length < 2) return true;
          if (!sourceOptions || sourceOptions.length < 2) return true;
          const origNorms = originalOptions.map((o) => QuestionParser.normalizeOption(QuestionParser.stripOptionTailNoise(o))).filter(Boolean);
          const srcNorms = sourceOptions.map((o) => QuestionParser.normalizeOption(QuestionParser.stripOptionTailNoise(o))).filter(Boolean);
          if (origNorms.length === 0 || srcNorms.length === 0) return true;
          const srcSet = new Set(srcNorms);
          let exactHits = 0;
          for (const opt of origNorms) {
            if (srcSet.has(opt)) exactHits++;
          }
          if (exactHits >= 3 || exactHits / origNorms.length >= 0.6) return true;
          let fuzzyHits = 0;
          for (const orig of origNorms) {
            let bestSim = 0;
            for (const src of srcNorms) {
              const sim = QuestionParser.diceSimilarity(orig, src);
              if (sim > bestSim) bestSim = sim;
            }
            if (bestSim >= 0.75) fuzzyHits++;
          }
          return fuzzyHits >= 3 || fuzzyHits / origNorms.length >= 0.6;
        },
        computeMatchQuality(sourceText, questionText, originalOptions, originalOptionsMap) {
          if (!sourceText || !questionText) return 0;
          const stem = QuestionParser.extractQuestionStem(questionText);
          const topicScore = QuestionParser.questionSimilarityScore(sourceText, stem);
          const coverage = this.optionsCoverageInFreeText(originalOptions, sourceText);
          const coverageScore = coverage.hasEnoughOptions ? coverage.ratio : 0.5;
          return Math.min(1, topicScore * 0.6 + coverageScore * 0.4) * 3;
        },
        // ── Source option map ─────────────────────────────────────────────────────
        /**
         * Parses A) / B) / C) options from source text and returns { letter: body } map.
         */
        buildSourceOptionsMapFromText(sourceText) {
          if (!sourceText || sourceText.length < 30) return {};
          const map = {};
          const lines = sourceText.split("\n");
          let currentLetter = null;
          let currentParts = [];
          const flush = () => {
            if (currentLetter && currentParts.length > 0) {
              const body = currentParts.join(" ").replace(/\s+/g, " ").trim();
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
              if (/^(?:\d{1,3}\s*[\)\.\-:]|Aula\s+\d|Quest[aã]o\s+\d|Pergunta\s+\d)/i.test(trimmed)) {
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
        // ── Letter remapping ──────────────────────────────────────────────────────
        remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap) {
          if (!sourceLetter || !sourceOptionsMap || !userOptionsMap) {
            console.log(`    [remap] SKIP: missing data`);
            return sourceLetter;
          }
          const userEntries = Object.entries(userOptionsMap);
          if (userEntries.length < 2 || Object.keys(sourceOptionsMap).length < 2) {
            console.log(`    [remap] SKIP: too few options`);
            return sourceLetter;
          }
          const sourceBody = sourceOptionsMap[sourceLetter];
          if (!sourceBody || sourceBody.length < 5) {
            console.log(`    [remap] SKIP: source letter ${sourceLetter} has no body`);
            return sourceLetter;
          }
          console.log(`    [remap] Source letter=${sourceLetter} body="${sourceBody.slice(0, 80)}"`);
          const normSource = QuestionParser.normalizeOption(sourceBody);
          if (!normSource) return sourceLetter;
          const skeletonSource = normSource.replace(/\s+/g, "");
          let bestLetter = null;
          let bestScore = 0;
          for (const [userLetter, userBody] of userEntries) {
            const normUser = QuestionParser.normalizeOption(userBody);
            if (!normUser) continue;
            const containsFwd = normSource.includes(normUser);
            const containsRev = normUser.includes(normSource);
            if (containsFwd || containsRev) {
              const score = Math.min(normSource.length, normUser.length) + 1e3;
              if (score > bestScore) {
                bestScore = score;
                bestLetter = userLetter;
              }
              continue;
            }
            const sim = QuestionParser.diceSimilarity(normSource, normUser);
            if (sim >= 0.7) {
              const score = sim * normUser.length;
              if (score > bestScore) {
                bestScore = score;
                bestLetter = userLetter;
              }
              continue;
            }
            const skeletonUser = normUser.replace(/\s+/g, "");
            const skelContainsFwd = skeletonSource.includes(skeletonUser);
            const skelContainsRev = skeletonUser.includes(skeletonSource);
            if (skelContainsFwd || skelContainsRev) {
              const score = Math.min(skeletonSource.length, skeletonUser.length) + 900;
              if (score > bestScore) {
                bestScore = score;
                bestLetter = userLetter;
              }
              continue;
            }
            const skelSim = QuestionParser.diceSimilarity(skeletonSource, skeletonUser);
            if (skelSim >= 0.7) {
              const score = skelSim * skeletonUser.length * 0.95;
              if (score > bestScore) {
                bestScore = score;
                bestLetter = userLetter;
              }
            }
          }
          if (bestLetter && bestLetter !== sourceLetter) {
            console.log(`    [remap] REMAPPED: ${sourceLetter} \u2192 ${bestLetter}`);
            return bestLetter;
          }
          console.log(`    [remap] NO CHANGE: best=${bestLetter || "none"} === source=${sourceLetter}`);
          return bestLetter || sourceLetter;
        },
        remapLetterIfShuffled(sourceLetter, sourceText, userOptionsMap) {
          if (!sourceLetter || !sourceText || !userOptionsMap) return sourceLetter;
          if (Object.keys(userOptionsMap).length < 2) return sourceLetter;
          const sourceOptionsMap = this.buildSourceOptionsMapFromText(sourceText);
          console.log(`    [remapIfShuffled] letter=${sourceLetter} sourceOpts=${Object.keys(sourceOptionsMap).length}`);
          if (Object.keys(sourceOptionsMap).length < 2) {
            console.log(`    [remapIfShuffled] SKIP: not enough source options parsed`);
            return sourceLetter;
          }
          return this.remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap);
        },
        verifyHighlightMatch(rawLetter, remappedLetter, sourceOptionsMap, userOptionsMap, baseConfidence) {
          const highlightedText = (sourceOptionsMap || {})[rawLetter] || "";
          if (!highlightedText || highlightedText.length < 5) {
            console.log(`    [verify] SKIP: no highlighted text for raw letter ${rawLetter}`);
            return { confidence: baseConfidence, letter: remappedLetter };
          }
          if (!userOptionsMap || Object.keys(userOptionsMap).length < 2) {
            return { confidence: baseConfidence, letter: remappedLetter };
          }
          const normH = QuestionParser.normalizeOption(highlightedText).replace(/\s+/g, "");
          console.log(`    [verify] highlighted text for ${rawLetter}: "${highlightedText.slice(0, 100)}"`);
          let bestMatchLetter = null;
          let bestMatchScore = 0;
          for (const [userLetter, userBody] of Object.entries(userOptionsMap)) {
            const normU = QuestionParser.normalizeOption(userBody).replace(/\s+/g, "");
            if (!normU || normU.length < 5) continue;
            const skelContains = normH.includes(normU) || normU.includes(normH);
            const skelDice = QuestionParser.diceSimilarity(normH, normU);
            const score = skelContains ? 1e3 + Math.min(normH.length, normU.length) : skelDice;
            if (score > bestMatchScore) {
              bestMatchScore = score;
              bestMatchLetter = userLetter;
            }
          }
          if (bestMatchLetter && bestMatchScore >= 0.55) {
            if (bestMatchLetter !== remappedLetter) {
              console.log(`    [verify] \u2705 CONTENT OVERRIDE: ${remappedLetter} \u2192 ${bestMatchLetter}`);
            } else {
              console.log(`    [verify] \u2705 CONFIRMED: ${bestMatchLetter}`);
            }
            return { confidence: baseConfidence, letter: bestMatchLetter };
          }
          console.log(`    [verify] \u274C REJECTED: highlighted text matches NO user option. Anchor likely on wrong question.`);
          return null;
        }
      };
    }
  });

  // src/services/search/HtmlExtractorService.js
  var HtmlExtractorService;
  var init_HtmlExtractorService = __esm({
    "src/services/search/HtmlExtractorService.js"() {
      init_QuestionParser();
      init_OptionsMatchService();
      HtmlExtractorService = {
        // ── HTML DOM parsing ───────────────────────────────────────────────────────
        parseHtmlDom(html) {
          if (!html || html.length < 200) return { doc: null, nodes: [] };
          const rawHtml = String(html || "");
          const sanitize = (input) => String(input || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<script\b[^>]*\/?>/gi, " ").replace(/<script\b[\s\S]*?(?=<(?:\/head|\/body|!--|meta|link))/gi, " ").replace(/<\s*script\b[\s\S]*$/gi, " ").replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ").replace(/<noscript\b[^>]*\/?>/gi, " ").replace(/<\s*noscript\b[\s\S]*$/gi, " ").replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ").replace(/<iframe\b[^>]*\/?>/gi, " ").replace(/<\s*iframe\b[\s\S]*$/gi, " ").replace(/<object\b[\s\S]*?<\/object>/gi, " ").replace(/<\s*object\b[\s\S]*$/gi, " ").replace(/<embed\b[^>]*>/gi, " ").replace(/<link\b[^>]*>/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)js\.captcha-display\.com(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/(?:https?:)?(?:\/\/|\\?\/\\?\/)(?:api-js\.)?datadome\.co(?:\/|\\?\/)[^\s"'<>]*/gi, " ").replace(/datadome\.co/gi, " ").replace(/captcha-display\.com/gi, " ");
          let doc = null;
          let nodes = [];
          const safeHtml = sanitize(rawHtml);
          try {
            doc = new DOMParser().parseFromString(safeHtml, "text/html");
            nodes = Array.from(doc.querySelectorAll("div.t"));
          } catch {
            return { doc: null, nodes: [] };
          }
          const embeddedSource = rawHtml.includes("\\u003cdiv") ? rawHtml : safeHtml;
          if (nodes.length < 50 && embeddedSource.includes("\\u003cdiv")) {
            const idx = embeddedSource.indexOf("\\u003cdiv");
            const slice = embeddedSource.slice(idx, Math.min(embeddedSource.length, idx + 65e4));
            const decoded = slice.replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">").replace(/\\u0026/gi, "&").replace(/\\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "	");
            try {
              const parsed = new DOMParser().parseFromString(sanitize(decoded), "text/html");
              const parsedNodes = Array.from(parsed.querySelectorAll("div.t"));
              if (parsedNodes.length > nodes.length) {
                doc = parsed;
                nodes = parsedNodes;
              }
            } catch (_) {
            }
          }
          return { doc, nodes };
        },
        extractDocText(doc) {
          if (!doc || !doc.body) return "";
          try {
            const clone = doc.body.cloneNode(true);
            clone.querySelectorAll("script, style, noscript, .blank").forEach((n) => n.remove());
            clone.querySelectorAll("div, p, br, li, h1, h2, h3, h4, h5, h6, tr, td, article, section, footer, header").forEach((el) => el.appendChild(doc.createTextNode(" ")));
            return (clone.textContent || "").replace(/\s+/g, " ").trim();
          } catch {
            return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
          }
        },
        detectHtmlType(html, doc = null) {
          const h = String(html || "").toLowerCase();
          if (!h) return "TYPE_UNKNOWN";
          if ((h.includes('id="pf1"') || h.includes('class="pf') || h.includes('class="pc')) && h.includes('class="t')) {
            return "TYPE_PD_PDF_HTML";
          }
          if (h.includes("answercard_") || h.includes("ql-editor") || h.includes("answer-content-container")) {
            return "TYPE_PD_ANSWERCARD";
          }
          if (/resposta\s+correta|gabarito|alternativa\s+correta/i.test(h)) return "TYPE_GENERIC_QA";
          if (doc && doc.querySelector(".ql-editor")) return "TYPE_PD_ANSWERCARD";
          return "TYPE_UNKNOWN";
        },
        // ── Obfuscation & paywall ──────────────────────────────────────────────────
        obfuscationSignals(text) {
          const normalized = QuestionParser.normalizeOption(String(text || ""));
          if (normalized.length < 120 || normalized.split(/\s+/).filter(Boolean).length < 20) {
            return { isObfuscated: false, vowelRatio: 0, junkRatio: 0, longConsonantRuns: 0, consonantRunRatio: 0, relevantWordCount: 0 };
          }
          const words = normalized.split(/\s+/).filter(Boolean);
          const letters = (normalized.match(/[a-z]/g) || []).length || 1;
          const vowels = (normalized.match(/[aeiou]/g) || []).length;
          const vowelRatio = vowels / letters;
          const relevantWords = words.filter((w) => w.length >= 4);
          let noVowelWords = 0;
          let longConsonantRuns = 0;
          for (const w of relevantWords) {
            if (!/[aeiou]/.test(w)) noVowelWords++;
            if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(w)) longConsonantRuns++;
          }
          const junkRatio = noVowelWords / Math.max(1, relevantWords.length);
          const consonantRunRatio = relevantWords.length > 0 ? longConsonantRuns / relevantWords.length : 0;
          const isObfuscated = vowelRatio < 0.24 && junkRatio >= 0.28 || longConsonantRuns >= 8 && vowelRatio < 0.34 && consonantRunRatio >= 0.1;
          return { isObfuscated, vowelRatio, junkRatio, longConsonantRuns, consonantRunRatio, relevantWordCount: relevantWords.length };
        },
        isLikelyObfuscated(text) {
          return this.obfuscationSignals(text).isObfuscated;
        },
        paywallSignals(html, text = "", hostHint = "") {
          const h = String(html || "").toLowerCase();
          const t = QuestionParser.normalizeOption(text || "");
          if (!h && !t) return { isPaywalled: false, markerHits: 0, riskyHost: false };
          const markers = [
            /voce\s+esta\s+vendo\s+uma\s+previa/i,
            /desbloqueie/i,
            /seja\s+premium/i,
            /torne[\s-]*se\s+premium/i,
            /documento\s+premium/i,
            /conteudos?\s+liberados/i,
            /teste\s+gratis/i,
            /upload\s+para\s+desbloquear/i,
            /short-preview-version/i,
            /limitation-blocked/i,
            /paywall-structure/i,
            /mv-content-limitation-fake-page/i,
            /new-monetization-test-paywall/i
          ];
          let markerHits = 0;
          for (const re of markers) {
            if (re.test(h) || re.test(t)) markerHits++;
          }
          const host = String(hostHint || "").toLowerCase();
          const riskyHost = ["passeidireto.com", "studocu.com", "scribd.com", "pt.scribd.com", "brainly.com", "brainly.com.br"].includes(host);
          const isPaywalled = riskyHost ? markerHits >= 2 : markerHits >= 3;
          return { isPaywalled, markerHits, riskyHost };
        },
        // ── PDF-like anchor extraction ─────────────────────────────────────────────
        extractPdfLikeAnswerByAnchors(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs) {
          const { doc, nodes } = this.parseHtmlDom(html);
          if (!doc || nodes.length < 20) return null;
          const frags = nodes.map((n) => {
            const text = (n.textContent || "").replace(/\s+/g, " ").trim();
            if (!text) return null;
            return { text, cls: (n.getAttribute("class") || "").toLowerCase() };
          }).filter(Boolean);
          if (frags.length < 20) return null;
          const startQuestionRe = /^(?:\)?\s*)?\d{1,3}\s*[\)\.\-:]\s*/;
          const starts = [];
          for (let i = 0; i < frags.length; i++) {
            if (startQuestionRe.test(frags[i].text)) starts.push(i);
          }
          const blocks = starts.length === 0 ? [{ start: 0, end: frags.length - 1 }] : starts.map((start, i) => {
            const end = i < starts.length - 1 ? starts[i + 1] - 1 : frags.length - 1;
            return end - start >= 4 ? { start, end } : null;
          }).filter(Boolean);
          if (blocks.length === 0) return null;
          let bestBlock = null;
          let bestBlockScore = 0;
          for (const b of blocks) {
            const text = frags.slice(b.start, b.end + 1).map((x) => x.text).join(" ");
            const sim = QuestionParser.questionSimilarityScore(text, questionStem);
            if (sim > bestBlockScore) {
              bestBlockScore = sim;
              bestBlock = { ...b, text };
            }
          }
          if (!bestBlock || bestBlockScore < 0.12) return null;
          const blockFrags = frags.slice(bestBlock.start, bestBlock.end + 1);
          const blockText = blockFrags.map((f) => f.text).join("\n");
          const explicitInBlock = extractorRefs.extractExplicitGabarito(blockText, questionForInference);
          if (explicitInBlock?.letter) {
            return { letter: explicitInBlock.letter, confidence: 0.94, method: "pdf-anchor-gabarito", evidence: blockText.slice(0, 900), matchQuality: bestBlockScore };
          }
          const anchorRe = /(resposta\s+correta|gabarito|alternativa\s+correta|resposta\s*:\s*letra)/i;
          const stopRe = /(coment[aá]rio|resolu[cç][aã]o|explica[cç][aã]o|pergunta\s+\d+|quest[aã]o\s+\d+)/i;
          let anchorIdx = -1;
          for (let i = 0; i < blockFrags.length; i++) {
            if (anchorRe.test(blockFrags[i].text)) {
              anchorIdx = i;
              break;
            }
          }
          if (anchorIdx < 0) return null;
          const evidenceParts = [];
          for (let i = anchorIdx; i < Math.min(blockFrags.length, anchorIdx + 30); i++) {
            const line = blockFrags[i].text;
            if (i > anchorIdx + 1 && startQuestionRe.test(line)) break;
            if (i > anchorIdx + 1 && stopRe.test(line)) break;
            evidenceParts.push(line);
          }
          const evidenceText = evidenceParts.join(" ").trim();
          if (!evidenceText || evidenceText.length < 20) return null;
          const explicit = extractorRefs.extractExplicitGabarito(evidenceText, questionForInference) || extractorRefs.extractExplicitLetterFromText(evidenceText, questionStem, originalOptions);
          if (explicit?.letter) {
            return { letter: explicit.letter, confidence: 0.93, method: "pdf-anchor-gabarito", evidence: evidenceText.slice(0, 900), matchQuality: bestBlockScore };
          }
          const candidateByText = QuestionParser.findLetterByAnswerText(evidenceText, originalOptionsMap);
          if (!candidateByText) return null;
          return { letter: candidateByText, confidence: 0.86, method: "pdf-anchor-text-match", evidence: evidenceText.slice(0, 900), matchQuality: bestBlockScore };
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
            let text = (c.textContent || "").replace(/\s+/g, " ").trim();
            if (!text || text.length < 40 || this.isLikelyObfuscated(text)) continue;
            const block = extractorRefs.findQuestionBlock(text, questionStem);
            if (block?.text?.length >= 80) text = block.text;
            const sim = QuestionParser.questionSimilarityScore(text, questionStem);
            const explicit = extractorRefs.extractExplicitGabarito(text, questionForInference) || extractorRefs.extractExplicitLetterFromText(text, questionStem, originalOptions);
            let letter = explicit?.letter || QuestionParser.findLetterByAnswerText(text, originalOptionsMap);
            if (!letter) continue;
            const confidence = explicit?.letter ? 0.9 : 0.82;
            candidates.push({ letter, confidence, method: "answercard-ql", evidence: text.slice(0, 900), matchQuality: sim, _score: confidence + sim * 0.6 });
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
          const riskyHost = ["passeidireto.com", "brainly.com.br", "brainly.com"].includes(hostHint);
          const candidates = [];
          let m;
          let guard = 0;
          while ((m = anchorRe.exec(fullText)) !== null && guard < 8) {
            guard++;
            const idx = m.index || 0;
            const anchorLabel = (m[1] || "").toLowerCase();
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
            const coverage = originalOptions?.length >= 2 ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, ctx) : { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
            const optionsMatch = !coverage.hasEnoughOptions || coverage.ratio >= 0.6 || coverage.hits >= Math.min(3, coverage.total || 3);
            const optionsStrong = !coverage.hasEnoughOptions || coverage.ratio >= 0.8 || coverage.hits >= Math.min(4, coverage.total || 4);
            const explicit = extractorRefs.extractExplicitGabarito(ctx, questionForInference) || extractorRefs.extractExplicitLetterFromText(ctx, questionStem, originalOptions);
            let letter = explicit?.letter || QuestionParser.findLetterByAnswerText(ctx, originalOptionsMap);
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
            candidates.push({
              letter,
              confidence,
              method: "generic-anchor",
              evidence: ctx.slice(0, 900),
              matchQuality: sim,
              optionsMatch,
              optionsStrong,
              explicitLetter: !!explicit?.letter,
              hasStrongAnchorSignal: true,
              _score: confidence + sim * 0.55
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
            console.log(`    [Structured] \u26D4 Blocked by paywall`);
            return { skip: true, reason: "paywall-overlay", diagnostics: { type, obfuscation, paywall } };
          }
          if (type === "TYPE_PD_PDF_HTML" || hostHint === "passeidireto.com" || hostHint === "studocu.com") {
            const byAnchor = this.extractPdfLikeAnswerByAnchors(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs);
            if (byAnchor?.letter) {
              return { ...byAnchor, evidenceType: `${hostHint || "pdf"}-${byAnchor.method}-scoped`, diagnostics: { type, obfuscation, paywall } };
            }
          }
          if (type === "TYPE_PD_ANSWERCARD") {
            const byAnswerCard = this.extractAnswerCardEvidence(html, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs);
            if (byAnswerCard?.letter) {
              return { ...byAnswerCard, evidenceType: `${hostHint || "page"}-${byAnswerCard.method}-scoped`, diagnostics: { type, obfuscation, paywall } };
            }
          }
          const byGeneric = this.extractGenericAnchoredEvidence(html, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, extractorRefs);
          if (byGeneric?.letter) {
            return { ...byGeneric, evidenceType: `${hostHint || "page"}-${byGeneric.method}-scoped`, diagnostics: { type, obfuscation, paywall } };
          }
          if (obfuscation?.isObfuscated) {
            return { skip: true, reason: "obfuscated_html", diagnostics: { type, obfuscation, paywall } };
          }
          return { diagnostics: { type, obfuscation, paywall } };
        },
        // ── PDF-like highlight letter extraction (ff1/CSS) ─────────────────────────
        extractPdfHighlightLetter(html, questionStem, originalOptionsMap, originalOptions) {
          if (!html || html.length < 2e3) return null;
          const tokens = QuestionParser.extractKeyTokens(questionStem);
          const reconstructedQ = questionStem + "\n" + (originalOptions || []).join("\n");
          const optTokens = QuestionParser.extractOptionTokens(reconstructedQ);
          const hasOptTokens = optTokens.length >= 2;
          const { doc, nodes } = this.parseHtmlDom(html);
          console.log(`    [ff1-highlight] check: html_len=${html.length} div.t nodes=${nodes.length}`);
          if (nodes.length < 15) return null;
          const frags = nodes.map((n) => ({
            text: (n.textContent || "").replace(/\s+/g, " ").trim(),
            cls: (n.getAttribute("class") || "").toLowerCase(),
            style: (n.getAttribute("style") || "").toLowerCase(),
            inner: (n.innerHTML || "").toLowerCase()
          })).filter((f) => f.text && f.text.length >= 1);
          if (frags.length < 15) return null;
          let bestIdx = -1;
          let bestAnchorScore = 0;
          const anchorWindowSize = hasOptTokens ? 10 : 5;
          for (let i = 0; i < frags.length; i++) {
            const windowText2 = frags.slice(i, Math.min(frags.length, i + anchorWindowSize)).map((f) => f.text).join(" ");
            const stemHits = QuestionParser.countTokenHits(windowText2, tokens);
            const optHits = hasOptTokens ? QuestionParser.countTokenHits(windowText2, optTokens) : 0;
            const score = stemHits + optHits * 2;
            if (score > bestAnchorScore) {
              bestAnchorScore = score;
              bestIdx = i;
            }
          }
          const bestWindowText = bestIdx >= 0 ? frags.slice(bestIdx, Math.min(frags.length, bestIdx + anchorWindowSize)).map((f) => f.text).join(" ") : "";
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
          const windowText = windowFrags.map((f) => f.text).join("\n");
          const optBodies = Object.values(originalOptionsMap || {}).map((v) => QuestionParser.normalizeOption(v)).filter((v) => v.length >= 2);
          let optionHits = 0;
          const normWindow = QuestionParser.normalizeOption(windowText);
          for (const body of optBodies) {
            if (body && normWindow.includes(body)) optionHits++;
          }
          console.log(`    [ff1-highlight] optionHits=${optionHits}/${optBodies.length} windowLen=${windowText.length}`);
          const parseAlternativeStart = (rawText) => {
            const t = (rawText || "").trim();
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
            const s = (t || "").trim();
            return /^(?:\)?\s*)?\d{1,3}\s*[\)\.\-:]\s*/.test(s) || /^aula\s+\d+/i.test(s);
          };
          const anchorOffset = bestIdx - windowStart;
          const maxGroupLookback = Math.min(anchorOffset, 15);
          let groupStartOffset = anchorOffset;
          for (let g = anchorOffset - 1; g >= anchorOffset - maxGroupLookback; g--) {
            if (g < 0) break;
            if (isNextQuestionMarker(windowFrags[g].text)) {
              groupStartOffset = g + 1;
              break;
            }
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
          const tokenOwners = /* @__PURE__ */ new Map();
          for (const letter of letters) {
            const parts = groups[letter];
            let ff1Hits = 0, blurHits = 0, clearHits = 0;
            const classTokenCounts = /* @__PURE__ */ new Map();
            for (const p of parts) {
              if (/\bff1\b/.test(p.cls) || /\bff1\b/.test(p.inner)) ff1Hits++;
              const isBlurred = /\bfb\b/.test(p.cls) || /blur\(/.test(p.style);
              if (isBlurred) blurHits++;
              else clearHits++;
              const clsTokens = String(p.cls || "").split(/\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
              const classAttrRe = /class\s*=\s*["']([^"']+)["']/gi;
              const nestedClassTokens = [];
              let cm;
              while ((cm = classAttrRe.exec(String(p.inner || ""))) !== null) {
                nestedClassTokens.push(...(cm[1] || "").split(/\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean));
              }
              for (const token of [...clsTokens, ...nestedClassTokens]) {
                if (!/^(ff|fs|fc|sc|ls)\d+$/i.test(token)) continue;
                classTokenCounts.set(token, (classTokenCounts.get(token) || 0) + 1);
              }
            }
            featuresByLetter[letter] = { ff1Hits, blurHits, clearHits, fragCount: parts.length, classTokenCounts };
            for (const token of classTokenCounts.keys()) {
              if (!tokenOwners.has(token)) tokenOwners.set(token, /* @__PURE__ */ new Set());
              tokenOwners.get(token).add(letter);
            }
          }
          const sourceOptionsFromGroups = {};
          for (const [gl, gParts] of Object.entries(groups)) {
            const gBody = this._joinPdfFragments(gParts).replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, "").trim();
            if (gBody.length >= 5) sourceOptionsFromGroups[gl] = gBody;
          }
          let bestLetter = null;
          let bestScore = -1;
          let secondScore = -1;
          for (const [letter, feat] of Object.entries(featuresByLetter)) {
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
            const remappedFf1 = OptionsMatchService.remapLetterToUserOptions(bestLetter, sourceOptionsFromGroups, originalOptionsMap);
            const verified = OptionsMatchService.verifyHighlightMatch(bestLetter, remappedFf1, sourceOptionsFromGroups, originalOptionsMap, 0.95);
            if (verified) {
              return { letter: verified.letter, confidence: verified.confidence, method: "ff1-highlight", evidence: `ff1_hits=${bestScore} window_tokens=${bestStemHits} option_hits=${optionHits}` };
            }
          }
          const ffCountsByLetter = {};
          const ffGlobalCounts = /* @__PURE__ */ new Map();
          for (const [letter, feat] of Object.entries(featuresByLetter)) {
            const localFf = /* @__PURE__ */ new Map();
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
              for (const [token, count] of ffCountsByLetter[letter].entries()) {
                if (token === globalDominantFf) continue;
                const owners = tokenOwners.get(token);
                if (owners?.size === 1 && count >= 1) outliers.push({ letter, token, count });
              }
            }
            const outlierLetters = [...new Set(outliers.map((o) => o.letter))];
            if (outlierLetters.length === 1) {
              const outlier = outliers[0];
              const remappedOutlier = OptionsMatchService.remapLetterToUserOptions(outlier.letter, sourceOptionsFromGroups, originalOptionsMap);
              const outlierConf = OptionsMatchService.verifyHighlightMatch(outlier.letter, remappedOutlier, sourceOptionsFromGroups, originalOptionsMap, 0.93);
              if (outlierConf) {
                return { letter: outlierConf.letter, confidence: outlierConf.confidence, method: "ff-outlier", evidence: `outlier_ff=${outlier.token} dominant_ff=${globalDominantFf} option_hits=${optionHits}` };
              }
            }
          }
          const signatureScores = {};
          for (const letter of letters) {
            const feat = featuresByLetter[letter];
            let uniqueTokenScore = 0;
            for (const [token, count] of feat.classTokenCounts.entries()) {
              const owners = tokenOwners.get(token);
              if (!owners || owners.size !== 1) continue;
              const base = token.startsWith("ff") ? 1.3 : token.startsWith("ls") ? 0.6 : 0.8;
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
          const strongOutlier = sigBestScore >= 1.8 && sigMargin >= 0.8;
          const permissiveOutlier = sigBestScore >= 2.4 && sigMargin >= 0.5 && optionHits >= 1;
          if (!sigFeat || sigFeat.fragCount < 1 || !strongOutlier && !permissiveOutlier) return null;
          const remappedSig = OptionsMatchService.remapLetterToUserOptions(sigBestLetter, sourceOptionsFromGroups, originalOptionsMap);
          const sigConf = OptionsMatchService.verifyHighlightMatch(sigBestLetter, remappedSig, sourceOptionsFromGroups, originalOptionsMap, Math.max(0.82, Math.min(0.9, 0.82 + sigMargin * 0.06)));
          if (!sigConf) {
            console.log(`    [css-signature] REJECTED by content verification`);
            return null;
          }
          return { letter: sigConf.letter, confidence: sigConf.confidence, method: "css-signature", evidence: `sig_score=${sigBestScore.toFixed(2)} margin=${sigMargin.toFixed(2)} option_hits=${optionHits}` };
        },
        // ── PDF fragment joining ───────────────────────────────────────────────────
        _joinPdfFragments(frags) {
          if (!frags || frags.length === 0) return "";
          let result = frags[0].text || "";
          for (let i = 1; i < frags.length; i++) {
            const t = frags[i].text || "";
            if (!t) continue;
            const prevChar = result.slice(-1);
            const nextChar = t.charAt(0);
            const isMidWord = /[a-z\u00e0-\u00fc]/i.test(prevChar) && /[a-z\u00e0-\u00fc]/.test(nextChar);
            result += isMidWord ? t : " " + t;
          }
          return result.replace(/\s+/g, " ").trim();
        }
      };
    }
  });

  // src/services/search/EvidenceService.js
  var EvidenceService;
  var init_EvidenceService = __esm({
    "src/services/search/EvidenceService.js"() {
      init_QuestionParser();
      init_OptionsMatchService();
      EvidenceService = {
        // ── Question block finding ─────────────────────────────────────────────────
        findQuestionBlockByFingerprint(sourceText, questionText) {
          if (!sourceText || !questionText) return null;
          const stem = QuestionParser.extractQuestionStem(questionText);
          const stemTokens = QuestionParser.extractKeyTokens(stem);
          if (stemTokens.length < 3) return null;
          const optionTokens = QuestionParser.extractOptionTokens(questionText);
          const hasOptionTokens = optionTokens.length >= 2;
          let chunks = sourceText.split("\n");
          if (chunks.length < 5 || chunks.some((c) => c.length > 500)) {
            chunks = sourceText.replace(/([.?!])\s+(?=[A-Z0-9])/g, "$1\n").split("\n");
          }
          let bestStart = -1;
          let bestScore = 0;
          const windowSize = hasOptionTokens ? 10 : 5;
          for (let i = 0; i <= chunks.length - 1; i++) {
            const windowText = chunks.slice(i, i + windowSize).join(" ");
            const stemHits = QuestionParser.countTokenHits(windowText, stemTokens);
            const optHits = hasOptionTokens ? QuestionParser.countTokenHits(windowText, optionTokens) : 0;
            const score = stemHits + optHits * 2;
            if (score > bestScore) {
              bestScore = score;
              bestStart = i;
            }
          }
          const stemThreshold = Math.max(3, Math.floor(stemTokens.length * 0.45));
          const bestWindowText = bestStart >= 0 ? chunks.slice(bestStart, bestStart + windowSize).join(" ") : "";
          const bestStemHits = bestStart >= 0 ? QuestionParser.countTokenHits(bestWindowText, stemTokens) : 0;
          const bestOptHits = hasOptionTokens && bestStart >= 0 ? QuestionParser.countTokenHits(bestWindowText, optionTokens) : 0;
          console.log(`    [find-block] bestStart=${bestStart}, stemHits=${bestStemHits}/${stemTokens.length}, optHits=${bestOptHits}/${optionTokens.length}, score=${bestScore}`);
          if (bestStart < 0 || bestStemHits < stemThreshold) return null;
          if (hasOptionTokens) {
            const minOptionHits = Math.max(1, Math.floor(optionTokens.length * 0.25));
            if (bestOptHits < minOptionHits) {
              console.log(`    [find-block] REJECTED: only ${bestOptHits}/${optionTokens.length} option tokens found. Wrong question block.`);
              return null;
            }
          }
          const blockStart = Math.max(0, bestStart - 2);
          const blockEnd = Math.min(chunks.length, bestStart + 20);
          return chunks.slice(blockStart, blockEnd).join("\n");
        },
        findQuestionBlock(sourceText, questionText) {
          if (!sourceText || !questionText) return null;
          const qNumMatch = (questionText || "").match(/^\s*(\d{1,3})\s*[\)\.\:\-]/);
          if (qNumMatch) {
            const qNum = qNumMatch[1];
            const patterns = [
              new RegExp(`(?:^|\\n)\\s*${qNum}\\s*[\\)\\.\\.\\:\\-]`, "m"),
              new RegExp(`(?:^|\\n)\\s*(?:Quest[a\xE3]o|Quest\xE3o)\\s+${qNum}\\b`, "im")
            ];
            for (const re of patterns) {
              const match = re.exec(sourceText);
              if (match) {
                const start = Math.max(0, match.index - 50);
                const end = Math.min(sourceText.length, match.index + 3e3);
                return { text: sourceText.slice(start, end), method: "number" };
              }
            }
          }
          const fpBlock = this.findQuestionBlockByFingerprint(sourceText, questionText);
          if (fpBlock) return { text: fpBlock, method: "fingerprint" };
          return null;
        },
        buildQuestionScopedText(sourceText, questionText, maxChars = 3200) {
          const raw = String(sourceText || "").trim();
          if (!raw) return "";
          const block = this.findQuestionBlock(raw, questionText);
          if (block?.text && block.text.length >= 120) return block.text.slice(0, maxChars);
          return raw.slice(0, maxChars);
        },
        // ── HTML snippet for AI ────────────────────────────────────────────────────
        extractHtmlAroundQuestion(html, questionStem, optionTokens, maxChars = 6e3) {
          if (!html || !questionStem || html.length < 500) return null;
          const stemNorm = (questionStem || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
          const stemWords = stemNorm.split(/\s+/).filter((w) => w.length >= 5).slice(0, 6);
          if (stemWords.length < 2) return null;
          const htmlLower = html.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          let bestPos = -1;
          let bestHits = 0;
          for (let i = 0; i < htmlLower.length - 200; i += 200) {
            const window2 = htmlLower.substring(i, i + 600);
            let hits = 0;
            for (const w of stemWords) {
              if (window2.includes(w)) hits++;
            }
            if (optionTokens?.length >= 2) {
              for (const t of optionTokens) {
                if (window2.includes(t)) hits += 2;
              }
            }
            if (hits > bestHits) {
              bestHits = hits;
              bestPos = i;
            }
          }
          if (bestPos < 0 || bestHits < 2) return null;
          const halfWindow = Math.floor(maxChars / 2);
          let start = Math.max(0, bestPos - halfWindow);
          let end = Math.min(html.length, bestPos + halfWindow);
          const tagOpen = html.lastIndexOf("<", start + 50);
          if (tagOpen > start - 200 && tagOpen >= 0) start = tagOpen;
          const tagClose = html.indexOf(">", end - 50);
          if (tagClose > 0 && tagClose < end + 200) end = tagClose + 1;
          return html.substring(start, end);
        },
        // ── Candidate selection ────────────────────────────────────────────────────
        chooseBestCandidate(candidates) {
          if (!candidates || candidates.length === 0) return null;
          if (candidates.length === 1) return candidates[0];
          const patternPriority = {
            "gab-explicito": 1,
            "gab-letra": 0.9,
            "resposta-correta": 0.85,
            "gab-abrev": 0.8,
            "gab-inline": 0.7,
            "ai": 0.5
          };
          const scored = candidates.map((c) => ({ ...c, score: (c.confidence || 0.5) * (patternPriority[c.matchLabel] || 0.6) }));
          scored.sort((a, b) => b.score - a.score);
          const best = scored[0];
          const second = scored[1];
          if (second && second.letter !== best.letter && best.score - second.score < 0.15) {
            console.log(`EvidenceService: Conflict between candidates: ${best.letter}(${best.score.toFixed(2)}) vs ${second.letter}(${second.score.toFixed(2)})`);
            return null;
          }
          return best;
        },
        // ── Explicit gabarito extraction (polarity-aware) ──────────────────────────
        extractExplicitGabarito(text, questionText = "") {
          if (!text) return null;
          const questionPolarity = QuestionParser.detectQuestionPolarity(questionText);
          const patterns = [
            { re: /(?:^|\b)(?:gabarito|resposta\s+correta|alternativa\s+correta|item\s+correto)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi, label: "gab-explicito", confidence: 0.95 },
            { re: /(?:^|\b)(?:a\s+resposta\s+correta\s+[eé]|a\s+alternativa\s+correta\s+[eé])\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/gi, label: "resposta-correta", confidence: 0.92 },
            { re: /(?:^|\b)(?:letra|alternativa)\s+([A-E])\s*(?:[eé]\s+(?:a\s+)?(?:correta|certa|resposta))/gi, label: "gab-letra", confidence: 0.9 },
            { re: /(?:^|\b)gab(?:arito)?\.?\s*[:\-]?\s*([A-E])\b/gi, label: "gab-abrev", confidence: 0.88 }
          ];
          const matches = [];
          for (const { re, label, confidence } of patterns) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text)) !== null) {
              const letter = (m[1] || "").toUpperCase();
              if (!letter) continue;
              matches.push({ letter, confidence, matchLabel: label, index: m.index, questionPolarity });
            }
          }
          if (matches.length === 0) return null;
          return this.chooseBestCandidate(matches);
        },
        // ── Explicit letter from text ──────────────────────────────────────────────
        extractExplicitLetterFromText(text, questionStem, originalOptions) {
          if (!text) return null;
          const polarity = QuestionParser.detectQuestionPolarity(questionStem);
          const tokens = QuestionParser.extractKeyTokens(questionStem);
          const patterns = [
            /(?:^|\b)(?:gabarito|resposta\s+correta|alternativa\s+correta|item\s+correto)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/i,
            /(?:^|\b)(?:a\s+resposta\s+correta\s+e|a\s+alternativa\s+correta\s+e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i
          ];
          if (polarity === "INCORRECT" || polarity === "UNKNOWN") {
            patterns.push(
              /(?:^|\b)(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*(?:é|e)\s*(?:a\s+)?(?:letra\s*)?([A-E])\b/i,
              /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+([A-E])\s*(?:é|e)\s*(?:a\s+)?(?:falsa|incorreta|errada)\b/i,
              /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*[:\-]?\s*([A-E])\b/i,
              /(?:^|\b)(?:a\s+)?(?:op[cç][aã]o|alternativa)\s+(?:falsa|incorreta|errada)\s*(?:é|e)\s*(?:a\s+)?([A-E])\s*[\)\.\-:]/i
            );
          }
          for (const re of patterns) {
            const m = text.match(re);
            if (!m) continue;
            const letter = (m[1] || "").toUpperCase();
            if (!letter) continue;
            const idx = m.index || 0;
            const start = Math.max(0, idx - 600);
            const end = Math.min(text.length, idx + 900);
            const window2 = text.slice(start, end);
            if (tokens.length > 0 && QuestionParser.countTokenHits(window2, tokens) < Math.min(2, tokens.length)) continue;
            if (originalOptions?.length >= 2 && !OptionsMatchService.optionsMatchInFreeText(originalOptions, window2)) continue;
            return { letter, confidence: 0.9, evidence: window2 };
          }
          return null;
        },
        // ── Hallucination guard ────────────────────────────────────────────────────
        isExplicitLetterSafe(text, letter, expectedBody) {
          if (!expectedBody) return true;
          const isShortAcronym = expectedBody.length <= 6 && QuestionParser.looksLikeCodeOption(expectedBody);
          if (isShortAcronym && text.length > 80) {
            if (!QuestionParser.normalizeCodeAwareOption(text).includes(QuestionParser.normalizeCodeAwareOption(expectedBody))) {
              console.log(`    [guard] REJECT: Explicit said ${letter} but short option "${expectedBody}" is absent.`);
              return false;
            }
          }
          const rx = new RegExp(`(?:letra|alternativa|op[c\xE7][a\xE3]o|resposta)\\s*(?:correta\\s*(?:[e\xE9]\\s*(?:a\\s+)?)?)?${letter}\\s*[)\\.\\-:]?\\s*([^\\.\\.,;\\n]+)`, "i");
          const m = text.match(rx);
          if (m && m[1]) {
            const nextWords = QuestionParser.normalizeOption(m[1].trim());
            if (nextWords && !/^(?:pois|porque|já\s*que|dado|como|sendo|visto|uma\s*vez)/.test(nextWords)) {
              const dice = QuestionParser.diceSimilarity(nextWords, expectedBody);
              if (dice < 0.2) {
                const nextTokens = nextWords.split(/\s+/).filter((t) => t.length >= 3);
                let shared = 0;
                for (const tk of nextTokens) {
                  if (expectedBody.includes(tk)) shared++;
                }
                if (shared === 0 && nextTokens.length >= 1 && nextTokens.length <= 4) {
                  console.log(`    [guard] REJECT: Explicit text "${nextWords}" contradicts expected "${expectedBody}".`);
                  return false;
                }
              }
            }
          }
          return true;
        },
        // ── Local answer extraction ────────────────────────────────────────────────
        extractAnswerLocally(sourceText, questionText, originalOptions) {
          if (!sourceText || sourceText.length < 50) return null;
          const block = this.findQuestionBlock(sourceText, questionText);
          const searchText = block ? block.text : sourceText;
          const optionsMap = {};
          if (originalOptions) {
            for (const opt of originalOptions) {
              const m = opt.match(/^([A-E])\)\s*(.*)/i);
              if (m) optionsMap[m[1].toUpperCase()] = m[2].trim();
            }
          }
          const gabarito = this.extractExplicitGabarito(searchText, questionText);
          if (gabarito) {
            const expectedBody = optionsMap[gabarito.letter];
            if (!expectedBody || this.isExplicitLetterSafe(searchText, gabarito.letter, expectedBody)) {
              return { ...gabarito, evidenceType: "explicit-gabarito", blockMethod: block?.method || "full-text" };
            }
          }
          const explanationMatch = this.matchExplanationToOption(searchText, questionText, originalOptions);
          if (explanationMatch) return { ...explanationMatch, evidenceType: "explanation-content-match", blockMethod: block?.method || "full-text" };
          return null;
        },
        // ── Explanation-to-option matching ─────────────────────────────────────────
        matchExplanationToOption(sourceText, questionText, originalOptions) {
          if (!sourceText || !originalOptions || originalOptions.length < 2) return null;
          const questionStem = QuestionParser.extractQuestionStem(questionText);
          const stemTokens = QuestionParser.extractKeyTokens(questionStem);
          if (stemTokens.length < 2) return null;
          const polarity = QuestionParser.detectQuestionPolarity(questionStem);
          const hasNegation = polarity === "INCORRECT";
          const optionsMap = {};
          for (const opt of originalOptions) {
            const m = opt.match(/^([A-E])\)\s*(.*)/i);
            if (m) optionsMap[m[1].toUpperCase()] = m[2].trim();
          }
          if (Object.keys(optionsMap).length < 2) return null;
          const block = this.findQuestionBlock(sourceText, questionText);
          const searchText = block ? block.text : sourceText;
          const lastOptPattern = /(?:^|\n)\s*[eE]\s*[\)\.\-:]\s*.{5,}/m;
          const lastOptMatch = lastOptPattern.exec(searchText);
          if (!lastOptMatch) return null;
          const explanationStart = lastOptMatch.index + lastOptMatch[0].length;
          const explanationText = searchText.slice(explanationStart, explanationStart + 2e3).trim();
          if (explanationText.length < 80) return null;
          const explNorm = QuestionParser.normalizeOption(explanationText);
          const topicHits = QuestionParser.countTokenHits(explNorm, stemTokens);
          const requiredTopicHits = Math.max(2, Math.floor(stemTokens.length * 0.4));
          if (topicHits < requiredTopicHits) {
            console.log(`    [expl-match] REJECTED: topicHits=${topicHits} < required=${requiredTopicHits}`);
            return null;
          }
          const scores = {};
          for (const [letter, body] of Object.entries(optionsMap)) {
            const optNorm = QuestionParser.normalizeOption(body);
            const optTokens = optNorm.split(/\s+/).filter((t) => t.length >= 3);
            if (optTokens.length === 0) {
              scores[letter] = 0;
              continue;
            }
            let tokenHits = 0;
            for (const tok of optTokens) {
              if (explNorm.includes(tok)) tokenHits++;
            }
            const tokenRatio = tokenHits / optTokens.length;
            const dice = QuestionParser.diceSimilarity(explNorm, optNorm);
            scores[letter] = tokenRatio * 0.6 + dice * 0.4;
          }
          if (hasNegation) {
            const maxScore = Math.max(...Object.values(scores));
            if (maxScore > 0) {
              for (const letter of Object.keys(scores)) {
                scores[letter] = maxScore - scores[letter];
              }
            }
          }
          const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
          if (sorted.length < 2) return null;
          const [bestLetter, bestScore] = sorted[0];
          const [, secondScore] = sorted[1];
          const margin = bestScore - secondScore;
          if (bestScore < 0.25 || margin < 0.08) return null;
          let confidence = Math.min(0.88, 0.6 + bestScore * 0.2 + margin * 0.3);
          if (hasNegation) confidence = Math.min(confidence, 0.72);
          return { letter: bestLetter, confidence, matchLabel: "explanation-content-match", evidence: explanationText.slice(0, 500) };
        },
        // ── Stance classification ──────────────────────────────────────────────────
        extractOptionAnchor(optionBody = "") {
          const stop = /* @__PURE__ */ new Set([
            "assinale",
            "afirmativa",
            "alternativa",
            "correta",
            "incorreta",
            "resposta",
            "gabarito",
            "dados",
            "banco",
            "bancos",
            "modelo",
            "modelos",
            "nosql",
            "sql",
            "apenas",
            "nao",
            "com",
            "sem"
          ]);
          return QuestionParser.normalizeOption(optionBody).split(/\s+/).filter((t) => t.length >= 4 && !stop.has(t)).slice(0, 7).join(" ");
        },
        classifyOptionStance(evidenceText, optionBody, optionLetter) {
          const evidenceNorm = QuestionParser.normalizeOption(evidenceText || "");
          const optionNorm = QuestionParser.normalizeOption(optionBody || "");
          if (!evidenceNorm || !optionNorm) return { stance: "neutral", score: 0 };
          const letter = String(optionLetter || "").toUpperCase();
          const letPosRe = letter ? new RegExp(`(?:letra|alternativa|op\xE7\xE3o)\\s*${letter}\\s*(?:e|eh)?\\s*(?:a\\s+)?(?:correta|certa|resposta)`, "i") : null;
          const letNegRe = letter ? new RegExp(`(?:letra|alternativa|op\xE7\xE3o)\\s*${letter}\\s*(?:e|eh)?\\s*(?:a\\s+)?(?:incorreta|falsa|errada)`, "i") : null;
          if (letPosRe && letPosRe.test(evidenceText || "")) return { stance: "entails", score: 0.84 };
          if (letNegRe && letNegRe.test(evidenceText || "")) return { stance: "contradicts", score: 0.84 };
          const anchor = this.extractOptionAnchor(optionBody);
          if (!anchor || anchor.length < 10) return { stance: "neutral", score: 0 };
          const idx = evidenceNorm.indexOf(anchor);
          if (idx < 0) return { stance: "neutral", score: 0 };
          const start = Math.max(0, idx - 160);
          const end = Math.min(evidenceNorm.length, idx + anchor.length + 200);
          const ctx = evidenceNorm.slice(start, end);
          const hasPositive = /(gabarito|resposta correta|alternativa correta|esta correta|item correto|resposta final)/i.test(ctx);
          const hasNegative = /(incorreta|falsa|errada|nao correta|item incorreto)/i.test(ctx);
          if (hasPositive && !hasNegative) return { stance: "entails", score: 0.74 };
          if (hasNegative && !hasPositive) return { stance: "contradicts", score: 0.74 };
          return { stance: "neutral", score: 0.2 };
        },
        // ── Evidence block building ────────────────────────────────────────────────
        buildDefaultOptionEvals(originalOptionsMap = {}) {
          const evals = {};
          const letters = Object.keys(originalOptionsMap).length > 0 ? Object.keys(originalOptionsMap) : ["A", "B", "C", "D", "E"];
          for (const letter of letters) {
            evals[letter] = { stance: "neutral", score: 0 };
          }
          return evals;
        },
        buildEvidenceBlock({ questionFingerprint = "", sourceId = "", sourceLink = "", hostHint = "", evidenceText = "", originalOptionsMap = {}, explicitLetter = "", confidenceLocal = 0.65, evidenceType = "" } = {}) {
          const optionEvals = this.buildDefaultOptionEvals(originalOptionsMap);
          for (const [letter, body] of Object.entries(originalOptionsMap || {})) {
            optionEvals[letter] = this.classifyOptionStance(evidenceText, body, letter);
          }
          const chosen = String(explicitLetter || "").toUpperCase().trim();
          if (/^[A-E]$/.test(chosen)) {
            const prev = optionEvals[chosen] || { stance: "neutral", score: 0 };
            const nextScore = Math.max(prev.score || 0, Math.max(0.72, Math.min(0.96, Number(confidenceLocal) || 0.72)));
            optionEvals[chosen] = { stance: "entails", score: nextScore };
          }
          const citationText = String(evidenceText || "").replace(/\s+/g, " ").trim().slice(0, 320);
          return {
            questionFingerprint,
            sourceId,
            sourceLink: sourceLink || "",
            hostHint: hostHint || "",
            explicitLetter: /^[A-E]$/.test(chosen) ? chosen : null,
            optionEvals,
            citations: citationText ? [{ text: citationText, sourceLink: sourceLink || "", host: hostHint || "" }] : [],
            confidenceLocal: Math.max(0.25, Math.min(0.98, Number(confidenceLocal) || 0.65)),
            evidenceType: String(evidenceType || "")
          };
        },
        // ── Vote computation ───────────────────────────────────────────────────────
        computeVotesAndState(sources) {
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
              return new URL(src?.link || "").hostname.replace(/^www\./, "").toLowerCase();
            } catch {
              return "";
            }
          };
          for (const src of sources) {
            if (!src?.evidenceBlock || !src?.letter) continue;
            const host = getHostFromSource(src);
            const block = src.evidenceBlock;
            const localWeight = Math.max(0.2, Math.min(1.1, block.confidenceLocal || 0.65));
            const optionEval = block.optionEvals?.[src.letter];
            if (optionEval?.stance !== "entails") continue;
            const evalScore = Math.max(0.2, Math.min(1, optionEval?.score || localWeight));
            const bonus = (src.weight || 1) * evalScore * 0.45;
            evidenceVotes[src.letter] = (evidenceVotes[src.letter] || 0) + bonus;
            evidenceEntailsCount[src.letter] = (evidenceEntailsCount[src.letter] || 0) + 1;
            if (!evidenceDomainsByLetter[src.letter]) evidenceDomainsByLetter[src.letter] = /* @__PURE__ */ new Set();
            if (host) evidenceDomainsByLetter[src.letter].add(host);
          }
          const mergedVotes = {};
          const allLetters = /* @__PURE__ */ new Set([...Object.keys(votes), ...Object.keys(evidenceVotes)]);
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
              return new URL(link).hostname.replace(/^www\./, "").toLowerCase();
            } catch {
              return "";
            }
          };
          const isWeakHost = (host) => ["brainly.com.br", "brainly.com", "studocu.com", "passeidireto.com"].includes(String(host || "").toLowerCase());
          const isStrongSource = (src) => {
            const host = src.hostHint || getHost(src.link);
            const et = String(src.evidenceType || "").toLowerCase();
            if (isWeakHost(host)) return false;
            if (/\.(pdf)(\?|$)/i.test(String(src.link || ""))) return true;
            if (host.endsWith(".gov.br") || host.endsWith(".edu.br")) return true;
            if (host === "qconcursos.com" || host === "qconcursos.com.br") return true;
            if (et.includes("pdf-anchor") || et.includes("answercard")) return true;
            return false;
          };
          const nonAiSources = sources.filter((s) => s.evidenceType && s.evidenceType !== "ai" && s.evidenceType !== "ai-combined");
          const bestNonAi = nonAiSources.filter((s) => s.letter === bestLetter);
          const bestDomains = new Set(bestNonAi.map((s) => s.hostHint || getHost(s.link)).filter(Boolean));
          const bestStrongDomains = new Set(bestNonAi.filter(isStrongSource).map((s) => s.hostHint || getHost(s.link)).filter(Boolean));
          const bestEvidenceCount = bestLetter ? evidenceEntailsCount[bestLetter] || 0 : 0;
          const bestEvidenceDomains = bestLetter ? evidenceDomainsByLetter[bestLetter]?.size || 0 : 0;
          let resultState = "inconclusive";
          let reason = "inconclusive";
          if (bestLetter) {
            const hasAnyNonAi = bestNonAi.length > 0;
            const hasStrongConsensus = bestStrongDomains.size >= 2;
            const hasDomainConsensus = bestDomains.size >= 2;
            const hasMinimumVotes = bestScore >= 5;
            const hasMargin = margin >= 1;
            const hasEvidenceConsensus = bestEvidenceCount >= 2 && bestEvidenceDomains >= 2;
            if (hasAnyNonAi && hasStrongConsensus && hasDomainConsensus && hasMinimumVotes && hasMargin && hasEvidenceConsensus) {
              resultState = "confirmed";
              reason = "confirmed_by_sources";
            } else if (hasAnyNonAi && bestNonAi.length >= 1 && bestScore >= 3) {
              const hasHighQualityMethod = bestNonAi.some((s) => {
                const et = String(s.evidenceType || "").toLowerCase();
                return et.includes("pdf") || et.includes("highlight") || et.includes("answercard") || et.includes("gabarito");
              });
              if (hasHighQualityMethod || hasDomainConsensus) {
                resultState = "suggested";
                reason = "ai_combined_suggestion";
              }
            } else if (bestScore > 0 && !hasAnyNonAi && sources.length >= 1) {
              resultState = "suggested";
              reason = "ai_combined_suggestion";
            } else if (second && margin < 1 && hasAnyNonAi) {
              resultState = "conflict";
              reason = "source_conflict";
            }
          }
          let confidence = Math.max(0.25, Math.min(0.98, bestScore / total));
          if (resultState !== "confirmed") confidence = Math.min(confidence, 0.79);
          if (resultState === "confirmed") confidence = Math.max(confidence, 0.85);
          if (resultState === "suggested") confidence = Math.max(confidence, 0.5);
          return {
            votes: mergedVotes,
            baseVotes: votes,
            evidenceVotes,
            bestLetter,
            resultState,
            reason,
            confidence,
            margin,
            evidenceConsensus: { bestEvidenceCount, bestEvidenceDomains }
          };
        }
      };
    }
  });

  // src/services/search/SearchCacheService.js
  var SearchCacheService;
  var init_SearchCacheService = __esm({
    "src/services/search/SearchCacheService.js"() {
      SearchCacheService = {
        // ── Decision cache config ──────────────────────────────────────────────────
        SEARCH_CACHE_KEY: "ahSearchDecisionCacheV2",
        SEARCH_METRICS_KEY: "ahSearchMetricsV1",
        CACHE_MAX_ENTRIES: 220,
        CACHE_MAX_AGE_MS: 1e3 * 60 * 60 * 24 * 7,
        // 7 days
        // ── Snapshot cache (in-memory, per-session) ────────────────────────────────
        snapshotCache: /* @__PURE__ */ new Map(),
        // url → { snap, fetchedAt }
        SNAPSHOT_CACHE_TTL: 5 * 60 * 1e3,
        // 5 minutes
        SNAPSHOT_CACHE_MAX: 30,
        // ── AI extraction result cache ─────────────────────────────────────────────
        _aiResultCache: null,
        // null = not yet loaded from storage
        AI_RESULT_CACHE_KEY: "ahAiResultCacheV1",
        AI_RESULT_CACHE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1e3,
        // 7 days
        AI_RESULT_CACHE_MAX_ENTRIES: 500,
        // ── Low-level storage helpers ──────────────────────────────────────────────
        async storageGet(keys) {
          try {
            if (typeof chrome === "undefined" || !chrome?.storage?.local) return {};
            return await chrome.storage.local.get(keys);
          } catch {
            return {};
          }
        },
        async storageSet(payload) {
          try {
            if (typeof chrome === "undefined" || !chrome?.storage?.local) return;
            await chrome.storage.local.set(payload);
          } catch {
          }
        },
        // ── Snapshot cache ─────────────────────────────────────────────────────────
        evictStaleSnapshots() {
          const now = Date.now();
          for (const [url, entry] of this.snapshotCache) {
            if (now - entry.fetchedAt > this.SNAPSHOT_CACHE_TTL) {
              this.snapshotCache.delete(url);
            }
          }
        },
        setSnapshot(url, snap) {
          if (this.snapshotCache.size >= this.SNAPSHOT_CACHE_MAX) {
            const oldest = [...this.snapshotCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
            if (oldest) this.snapshotCache.delete(oldest[0]);
          }
          this.snapshotCache.set(url, { snap, fetchedAt: Date.now() });
        },
        getSnapshot(url) {
          return this.snapshotCache.get(url) || null;
        },
        // ── AI extraction result cache ─────────────────────────────────────────────
        /**
         * Returns a stable cache key: hostname + first 80 chars of question stem.
         */
        getAiResultCacheKey(url, questionStem) {
          let host = url;
          try {
            host = new URL(url).hostname;
          } catch (_) {
          }
          const stem = String(questionStem || "").replace(/\s+/g, " ").trim().slice(0, 80);
          return `${host}|${stem}`;
        },
        /**
         * Load AI result cache from storage (no-op if already loaded).
         */
        async loadAiResultCache() {
          if (this._aiResultCache !== null) return;
          this._aiResultCache = /* @__PURE__ */ new Map();
          try {
            await new Promise((resolve) => {
              chrome.storage.local.get([this.AI_RESULT_CACHE_KEY], (result) => {
                const raw = result[this.AI_RESULT_CACHE_KEY];
                if (raw && typeof raw === "object") {
                  const now = Date.now();
                  for (const [k, v] of Object.entries(raw)) {
                    if (v && now - (v.cachedAt || 0) < this.AI_RESULT_CACHE_MAX_AGE_MS) {
                      this._aiResultCache.set(k, v);
                    }
                  }
                }
                resolve();
              });
            });
          } catch (_) {
          }
        },
        /**
         * Persist AI result cache to storage (fire-and-forget).
         */
        async saveAiResultCache() {
          if (!this._aiResultCache) return;
          try {
            if (this._aiResultCache.size > this.AI_RESULT_CACHE_MAX_ENTRIES) {
              const sorted = [...this._aiResultCache.entries()].sort((a, b) => (a[1].cachedAt || 0) - (b[1].cachedAt || 0));
              const toDelete = sorted.slice(0, this._aiResultCache.size - this.AI_RESULT_CACHE_MAX_ENTRIES);
              for (const [k] of toDelete) this._aiResultCache.delete(k);
            }
            const obj = Object.fromEntries(this._aiResultCache);
            chrome.storage.local.set({ [this.AI_RESULT_CACHE_KEY]: obj });
          } catch (_) {
          }
        },
        /**
         * Returns cached AI extraction result or null if missing/expired.
         */
        getCachedAiResult(url, questionStem) {
          if (!this._aiResultCache) return null;
          const key = this.getAiResultCacheKey(url, questionStem);
          const entry = this._aiResultCache.get(key);
          if (!entry) return null;
          if (Date.now() - (entry.cachedAt || 0) > this.AI_RESULT_CACHE_MAX_AGE_MS) {
            this._aiResultCache.delete(key);
            return null;
          }
          return entry;
        },
        /**
         * Stores an AI extraction result and persists asynchronously.
         */
        setCachedAiResult(url, questionStem, result) {
          if (!this._aiResultCache) return;
          const key = this.getAiResultCacheKey(url, questionStem);
          this._aiResultCache.set(key, { ...result, cachedAt: Date.now() });
          this.saveAiResultCache();
        },
        // ── Decision cache ─────────────────────────────────────────────────────────
        async _getDecisionCacheBucket() {
          const data = await this.storageGet([this.SEARCH_CACHE_KEY]);
          const bucket = data?.[this.SEARCH_CACHE_KEY];
          return bucket && typeof bucket === "object" ? bucket : {};
        },
        async _setDecisionCacheBucket(bucket) {
          const safeBucket = bucket && typeof bucket === "object" ? bucket : {};
          await this.storageSet({ [this.SEARCH_CACHE_KEY]: safeBucket });
        },
        async clearSearchCache(options = {}) {
          const { keepMetrics = true } = options || {};
          const payload = { [this.SEARCH_CACHE_KEY]: {} };
          if (!keepMetrics) payload[this.SEARCH_METRICS_KEY] = {};
          await this.storageSet(payload);
        },
        async getCachedDecision(questionFingerprint) {
          if (!questionFingerprint) return null;
          const bucket = await this._getDecisionCacheBucket();
          const entry = bucket?.[questionFingerprint];
          if (!entry || typeof entry !== "object") return null;
          const age = Date.now() - Number(entry.updatedAt || 0);
          if (!Number.isFinite(age) || age < 0 || age > this.CACHE_MAX_AGE_MS) return null;
          const decision = entry.decision;
          if (!decision || decision.resultState !== "confirmed") return null;
          if (decision.evidenceTier !== "EVIDENCE_STRONG") return null;
          return decision;
        },
        sanitizeSourcesForCache(sources = []) {
          return (sources || []).slice(0, 8).map((s) => ({
            title: String(s?.title || ""),
            link: String(s?.link || ""),
            hostHint: String(s?.hostHint || ""),
            evidenceType: String(s?.evidenceType || ""),
            letter: String(s?.letter || ""),
            weight: Number(s?.weight || 0)
          })).filter((s) => s.link || s.hostHint || s.letter);
        },
        async setCachedDecision(questionFingerprint, resultItem, sources = []) {
          if (!questionFingerprint || !resultItem) return;
          const bucket = await this._getDecisionCacheBucket();
          const now = Date.now();
          const sourceLinks = (sources || []).map((s) => String(s?.link || "").trim()).filter(Boolean).slice(0, 12);
          bucket[questionFingerprint] = {
            updatedAt: now,
            decision: {
              answer: String(resultItem.answer || ""),
              answerLetter: String(resultItem.answerLetter || ""),
              answerText: String(resultItem.answerText || ""),
              bestLetter: String(resultItem.bestLetter || ""),
              votes: resultItem.votes || {},
              baseVotes: resultItem.baseVotes || {},
              evidenceVotes: resultItem.evidenceVotes || {},
              confidence: Number(resultItem.confidence || 0),
              resultState: String(resultItem.resultState || "inconclusive"),
              reason: String(resultItem.reason || "inconclusive"),
              evidenceTier: String(resultItem.evidenceTier || "EVIDENCE_WEAK"),
              evidenceConsensus: resultItem.evidenceConsensus || {},
              questionPolarity: String(resultItem.questionPolarity || "CORRECT"),
              sources: this.sanitizeSourcesForCache(sources)
            },
            sourceLinks
          };
          const keys = Object.keys(bucket);
          if (keys.length > this.CACHE_MAX_ENTRIES) {
            keys.map((k) => ({ k, t: Number(bucket[k]?.updatedAt || 0) })).sort((a, b) => a.t - b.t).slice(0, keys.length - this.CACHE_MAX_ENTRIES).forEach((entry) => {
              delete bucket[entry.k];
            });
          }
          await this._setDecisionCacheBucket(bucket);
        },
        async getCachedSourceLinks(questionFingerprint) {
          if (!questionFingerprint) return [];
          const bucket = await this._getDecisionCacheBucket();
          const entry = bucket?.[questionFingerprint];
          if (!entry) return [];
          const sourceLinks = Array.isArray(entry.sourceLinks) ? entry.sourceLinks : [];
          return sourceLinks.map((l) => String(l || "").trim()).filter(Boolean).slice(0, 12);
        },
        async mergeCachedSourcesIntoResults(questionFingerprint, results = []) {
          const cachedLinks = await this.getCachedSourceLinks(questionFingerprint);
          if (!cachedLinks || cachedLinks.length === 0) return results || [];
          const merged = /* @__PURE__ */ new Map();
          for (const item of results || []) {
            const link = String(item?.link || "").trim();
            if (!link) continue;
            if (!merged.has(link)) merged.set(link, item);
          }
          for (const link of cachedLinks) {
            if (merged.has(link)) continue;
            merged.set(link, { title: "Cached source", snippet: "", link, fromCache: true });
          }
          return Array.from(merged.values());
        },
        // ── Canonical hash ─────────────────────────────────────────────────────────
        /**
         * Creates a stable SHA-256 hash from a canonical question string.
         * Requires QuestionParser.canonicalizeQuestion(questionText) to be passed in.
         */
        async canonicalHash(canonicalText) {
          if (typeof crypto !== "undefined" && crypto.subtle) {
            try {
              const encoder = new TextEncoder();
              const data = encoder.encode(canonicalText);
              const hashBuffer = await crypto.subtle.digest("SHA-256", data);
              const hashArray = Array.from(new Uint8Array(hashBuffer));
              return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
            } catch {
            }
          }
          let hash = 2166136261;
          for (let i = 0; i < canonicalText.length; i++) {
            hash ^= canonicalText.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          return (hash >>> 0).toString(16);
        },
        // ── Metrics ────────────────────────────────────────────────────────────────
        async recordMetrics(payload = {}) {
          const {
            cacheHit = false,
            outcome = "finished",
            resultState = "inconclusive",
            evidenceTier = "EVIDENCE_WEAK",
            runStats = null,
            bestLetter = "",
            confidence = 0
          } = payload;
          try {
            const data = await this.storageGet([this.SEARCH_METRICS_KEY]);
            const metrics = data?.[this.SEARCH_METRICS_KEY] || {
              totalRuns: 0,
              cacheHits: 0,
              outcomes: {},
              resultStates: {},
              evidenceTiers: {},
              blocked: { paywall: 0, obfuscation: 0, optionsMismatch: 0, snapshotMismatch: 0, errors: 0 },
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
              bestLetter: String(bestLetter || ""),
              confidence: Number(confidence || 0),
              analyzed: Number(runStats?.analyzed || 0),
              acceptedVotes: Number(runStats?.acceptedForVotes || 0),
              acceptedAi: Number(runStats?.acceptedForAiEvidence || 0)
            });
            if (metrics.lastRuns.length > 120) {
              metrics.lastRuns = metrics.lastRuns.slice(metrics.lastRuns.length - 120);
            }
            metrics.updatedAt = Date.now();
            await this.storageSet({ [this.SEARCH_METRICS_KEY]: metrics });
          } catch {
          }
        }
      };
    }
  });

  // src/services/SearchService.js
  var SearchService;
  var init_SearchService = __esm({
    "src/services/SearchService.js"() {
      init_ApiService();
      init_QuestionParser();
      init_OptionsMatchService();
      init_HtmlExtractorService();
      init_EvidenceService();
      init_SearchCacheService();
      SearchService = {
        // 7 days
        // Snapshot cache: reuse fetched pages across searches (same session)
        // url → { snap, fetchedAt }
        // 5 minutes
        // max 30 URLs in memory
        // AI extraction result cache: persisted to chrome.storage.local so LLM calls
        // are not repeated for the same URL + question on subsequent searches.
        // null = not loaded yet; Map<cacheKey, {letter,knowledge,cachedAt}>
        // 7 days
        _buildOptionsMap(questionText) {
          const options = QuestionParser.extractOptionsFromQuestion(questionText);
          const map = {};
          for (const opt of options) {
            const m = opt.match(/^([A-E])\)\s*(.+)$/i);
            if (m) map[m[1].toUpperCase()] = QuestionParser.stripOptionTailNoise(m[2]);
          }
          return map;
        },
        _parseAnswerLetter(answerText) {
          if (!answerText) return null;
          const text = String(answerText).replace(/\r/g, "\n").trim();
          if (!text) return null;
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const finalLineRe = /^(?:(?:resposta\s+final|conclus[aã]o|gabarito)\s*[:\-]\s*)?(?:letra|gabarito|resposta\s+final|alternativa\s+correta|letter|option)\s*[:\-]?\s*([A-E])\b(?:\s*[:.\-]|$)/i;
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
            const m = lines[i].match(finalLineRe);
            if (m) return (m[1] || "").toUpperCase();
          }
          const taggedMatches = [...text.matchAll(/(?:^|\b)(?:resposta\s+final|gabarito|alternativa\s+correta|letra|letter|option)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
          const uniqueTagged = [...new Set(taggedMatches)];
          if (uniqueTagged.length === 1) return uniqueTagged[0];
          if (uniqueTagged.length > 1) return null;
          const prosePatterns = [/(?:resposta|answer)\s+(?:correta\s+)?(?:[eéÉ]|seria)\s+(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /(?:alternativa|opção|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?([A-E])\b/gi, /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi];
          for (const re of prosePatterns) {
            const proseHits = [...text.matchAll(re)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
            const uniqueProse = [...new Set(proseHits)];
            if (uniqueProse.length === 1) return uniqueProse[0];
          }
          const optionLineMatches = [...text.matchAll(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s+/gim)].map((m) => (m[1] || "").toUpperCase()).filter(Boolean);
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
        _parseAnswerText(answerText) {
          if (!answerText) return "";
          const text = String(answerText).replace(/\r/g, "\n").trim();
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          const finalBodyRe = /(?:letra|alternativa|letter|option)\s*[A-E]\s*[:.\-]\s*(.{5,})/i;
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
            const m = lines[i].match(finalBodyRe);
            if (m && m[1]) return m[1].trim();
          }
          return text.replace(/^(?:Letra|Alternativa|Letter|Option)\s*[A-E]\s*[:.\-]?\s*/i, "").replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, "").trim();
        },
        // ▸▸▸ GOOGLE AI OVERVIEW / ANSWER BOX EXTRACTION ▸▸▸
        // Extracts an answer letter from Serper meta signals (answerBox, aiOverview,
        // peopleAlsoAsk) that come "for free" with the search results.
        _extractLetterFromGoogleMeta(serperMeta, questionStem, originalOptionsMap, originalOptions) {
          if (!serperMeta) return null;
          const results = [];
          const ab = serperMeta.answerBox;
          if (ab) {
            const abText = [ab.title, ab.snippet, ab.answer, ab.highlighted_words?.join(" ")].filter(Boolean).join(" ").trim();
            if (abText.length >= 20) {
              const parsed = this._parseGoogleMetaText(abText, originalOptionsMap, originalOptions);
              if (parsed) {
                results.push({
                  ...parsed,
                  method: "google-answerbox",
                  evidence: abText.slice(0, 600)
                });
              }
            }
          }
          const aio = serperMeta.aiOverview;
          if (aio) {
            let aioText = "";
            if (typeof aio === "string") {
              aioText = aio;
            } else if (aio.text_blocks && Array.isArray(aio.text_blocks)) {
              aioText = this._flattenAiOverviewBlocks(aio.text_blocks);
            } else if (aio.snippet) {
              aioText = String(aio.snippet || "");
            } else if (aio.text) {
              aioText = String(aio.text || "");
            }
            if (aioText.length >= 30) {
              const parsed = this._parseGoogleMetaText(aioText, originalOptionsMap, originalOptions);
              if (parsed) {
                results.push({
                  ...parsed,
                  method: "google-ai-overview",
                  evidence: aioText.slice(0, 800)
                });
              }
            }
          }
          const paa = serperMeta.peopleAlsoAsk;
          if (Array.isArray(paa) && paa.length > 0) {
            const normStem = QuestionParser.normalizeOption(questionStem);
            for (const entry of paa.slice(0, 4)) {
              const paaQ = String(entry.question || entry.title || "");
              const paaSnippet = String(entry.snippet || entry.answer || "");
              if (!paaSnippet || paaSnippet.length < 20) continue;
              const paaQNorm = QuestionParser.normalizeOption(paaQ);
              const qSim = QuestionParser.diceSimilarity(normStem, paaQNorm);
              if (qSim < 0.4) continue;
              const parsed = this._parseGoogleMetaText(paaSnippet, originalOptionsMap, originalOptions);
              if (parsed) {
                results.push({
                  ...parsed,
                  confidence: Math.min(parsed.confidence, 0.72),
                  method: "google-paa",
                  evidence: `Q: ${paaQ}
A: ${paaSnippet}`.slice(0, 500)
                });
                break;
              }
            }
          }
          if (results.length === 0) return null;
          results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
          const best = results[0];
          console.log(`SearchService: [google-meta] Found letter=${best.letter} confidence=${best.confidence.toFixed(2)} method=${best.method} from ${results.length} candidate(s)`);
          return best;
        },
        // Flatten AI Overview text_blocks (nested structure from Serper/SerpAPI)
        _flattenAiOverviewBlocks(blocks) {
          if (!Array.isArray(blocks)) return "";
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
          return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        },
        // Core parser: extracts answer letter from Google meta text by:
        // 1. Explicit "alternativa correta é a C" / "Letra C" patterns
        // 2. Content match against user's option bodies
        _parseGoogleMetaText(text, originalOptionsMap, originalOptions) {
          if (!text || text.length < 15) return null;
          const explicitPatterns = [/(?:alternativa|resposta|gabarito|letra|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /\b([A-E])\s*[\)\.\-:]\s*(?:[Nn][aã]o\s+exige|[Ee]xige|[Pp]ermite|[Rr]equere?|[Dd]efine|[Rr]epresenta)/gi, /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /(?:alternativa\s+correta\s+(?:[eéÉ]|seria)\s+(?:a\s+)?)([A-E])\b/gi];
          const explicitHits = [];
          for (const re of explicitPatterns) {
            for (const m of text.matchAll(re)) {
              const letter = (m[1] || "").toUpperCase();
              if (/^[A-E]$/.test(letter)) explicitHits.push(letter);
            }
          }
          const uniqueExplicit = [...new Set(explicitHits)];
          if (uniqueExplicit.length === 1) {
            const letter = uniqueExplicit[0];
            if (originalOptionsMap && originalOptionsMap[letter]) {
              return {
                letter,
                confidence: 0.88
              };
            }
          }
          const checkMarkPatterns = [/[✅✓☑]\s*(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /(?:correta|certa|right|correct)\s*[:\-–]?\s*(?:alternativa\s+|letra\s+)?([A-E])\b/gi];
          for (const re of checkMarkPatterns) {
            const matches = [...text.matchAll(re)].map((m) => (m[1] || "").toUpperCase()).filter((l) => /^[A-E]$/.test(l));
            const unique = [...new Set(matches)];
            if (unique.length === 1 && originalOptionsMap?.[unique[0]]) {
              return {
                letter: unique[0],
                confidence: 0.85
              };
            }
          }
          if (originalOptionsMap && Object.keys(originalOptionsMap).length >= 2) {
            const normText = QuestionParser.normalizeOption(text);
            let bestLetter = null;
            let bestScore = 0;
            let bestMethod = "";
            for (const [letter, body] of Object.entries(originalOptionsMap)) {
              const normBody = QuestionParser.normalizeOption(body);
              if (!normBody || normBody.length < 8) continue;
              if (normText.includes(normBody)) {
                const score = normBody.length;
                if (score > bestScore) {
                  bestScore = score;
                  bestLetter = letter;
                  bestMethod = "containment";
                }
                continue;
              }
              const dice = QuestionParser.diceSimilarity(normText, normBody);
              if (dice >= 0.65 && dice * 100 > bestScore) {
                bestScore = dice * 100;
                bestLetter = letter;
                bestMethod = "dice";
              }
            }
            if (bestLetter) {
              const conf = bestMethod === "containment" ? 0.82 : 0.68;
              console.log(`SearchService: [google-meta] Content-match: letter=${bestLetter} method=${bestMethod} score=${bestScore}`);
              return {
                letter: bestLetter,
                confidence: conf
              };
            }
          }
          const parsedLetter = this._parseAnswerLetter(text);
          if (parsedLetter && originalOptionsMap?.[parsedLetter]) {
            return {
              letter: parsedLetter,
              confidence: 0.7
            };
          }
          return null;
        },
        // Parses A) / B) / C) options from source text and returns {letter: body} map.
        _buildSourceOptionsMapFromText(sourceText) {
          if (!sourceText || sourceText.length < 30) return {};
          const map = {};
          const lines = sourceText.split("\n");
          let currentLetter = null;
          let currentParts = [];
          const flush = () => {
            if (currentLetter && currentParts.length > 0) {
              const body = currentParts.join(" ").replace(/\s+/g, " ").trim();
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
        _remapLetterIfShuffled(sourceLetter, sourceText, userOptionsMap) {
          if (!sourceLetter || !sourceText || !userOptionsMap) return sourceLetter;
          if (Object.keys(userOptionsMap).length < 2) return sourceLetter;
          const sourceOptionsMap = this._buildSourceOptionsMapFromText(sourceText);
          console.log(`    [remapIfShuffled] letter=${sourceLetter} sourceTextLen=${sourceText.length} sourceOpts=${Object.keys(sourceOptionsMap).length} keys=[${Object.keys(sourceOptionsMap).join(",")}]`);
          if (Object.keys(sourceOptionsMap).length >= 2) {
            for (const [k, v] of Object.entries(sourceOptionsMap)) {
              console.log(`      src ${k}) "${v.slice(0, 70)}"`);
            }
          }
          if (Object.keys(sourceOptionsMap).length < 2) {
            console.log(`    [remapIfShuffled] SKIP: not enough source options parsed from text`);
            return sourceLetter;
          }
          return OptionsMatchService.remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap);
        },
        // ═══ CANONICAL QUESTION HASH ═══
        // Creates a stable hash from question + options for cache/dedup
        _canonicalizeQuestion(questionText) {
          const stem = QuestionParser.extractQuestionStem(questionText);
          const options = QuestionParser.extractOptionsFromQuestion(questionText);
          const normStem = QuestionParser.normalizeOption(stem).replace(/\s+/g, " ").trim();
          const normOpts = (options || []).map((o) => QuestionParser.normalizeOption(o).replace(/\s+/g, " ").trim()).sort();
          return `${normStem}||${normOpts.join("|")}`;
        },
        async _canonicalHash(questionText) {
          const canonical = this._canonicalizeQuestion(questionText);
          if (typeof crypto !== "undefined" && crypto.subtle) {
            try {
              const encoder = new TextEncoder();
              const data = encoder.encode(canonical);
              const hashBuffer = await crypto.subtle.digest("SHA-256", data);
              const hashArray = Array.from(new Uint8Array(hashBuffer));
              return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
            } catch {
            }
          }
          let hash = 2166136261;
          for (let i = 0; i < canonical.length; i++) {
            hash ^= canonical.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          return (hash >>> 0).toString(16);
        },
        async clearSearchCache(options = {}) {
          const {
            keepMetrics = true
          } = options || {};
          const payload = {
            [SearchCacheService.SEARCH_CACHE_KEY]: {}
          };
          if (!keepMetrics) payload[SearchCacheService.SEARCH_METRICS_KEY] = {};
          await SearchCacheService.storageSet(payload);
        },
        async _getCachedDecisionForFingerprint(questionFingerprint) {
          if (!questionFingerprint) return null;
          const bucket = await SearchCacheService._getDecisionCacheBucket();
          const entry = bucket?.[questionFingerprint];
          if (!entry || typeof entry !== "object") return null;
          const age = Date.now() - Number(entry.updatedAt || 0);
          if (!Number.isFinite(age) || age < 0 || age > SearchCacheService.CACHE_MAX_AGE_MS) return null;
          const decision = entry.decision;
          if (!decision || decision.resultState !== "confirmed") return null;
          if (decision.evidenceTier !== "EVIDENCE_STRONG") return null;
          return decision;
        },
        async _setCachedDecisionForFingerprint(questionFingerprint, resultItem, sources = []) {
          if (!questionFingerprint || !resultItem) return;
          const bucket = await SearchCacheService._getDecisionCacheBucket();
          const now = Date.now();
          const sourceLinks = (sources || []).map((s) => String(s?.link || "").trim()).filter(Boolean).slice(0, 12);
          bucket[questionFingerprint] = {
            updatedAt: now,
            decision: {
              answer: String(resultItem.answer || ""),
              answerLetter: String(resultItem.answerLetter || ""),
              answerText: String(resultItem.answerText || ""),
              bestLetter: String(resultItem.bestLetter || ""),
              votes: resultItem.votes || {},
              baseVotes: resultItem.baseVotes || {},
              evidenceVotes: resultItem.evidenceVotes || {},
              confidence: Number(resultItem.confidence || 0),
              resultState: String(resultItem.resultState || "inconclusive"),
              reason: String(resultItem.reason || "inconclusive"),
              evidenceTier: String(resultItem.evidenceTier || "EVIDENCE_WEAK"),
              evidenceConsensus: resultItem.evidenceConsensus || {},
              questionPolarity: String(resultItem.questionPolarity || "CORRECT"),
              sources: SearchCacheService.sanitizeSourcesForCache(sources)
            },
            sourceLinks
          };
          const keys = Object.keys(bucket);
          if (keys.length > SearchCacheService.CACHE_MAX_ENTRIES) {
            keys.map((k) => ({
              k,
              t: Number(bucket[k]?.updatedAt || 0)
            })).sort((a, b) => a.t - b.t).slice(0, keys.length - SearchCacheService.CACHE_MAX_ENTRIES).forEach((entry) => {
              delete bucket[entry.k];
            });
          }
          await SearchCacheService._setDecisionCacheBucket(bucket);
        },
        async _mergeCachedSourcesIntoResults(questionFingerprint, results = []) {
          const cachedLinks = await SearchCacheService.getCachedSourceLinks(questionFingerprint);
          if (!cachedLinks || cachedLinks.length === 0) return results || [];
          const merged = /* @__PURE__ */ new Map();
          for (const item of results || []) {
            const link = String(item?.link || "").trim();
            if (!link) continue;
            if (!merged.has(link)) merged.set(link, item);
          }
          for (const link of cachedLinks) {
            if (merged.has(link)) continue;
            merged.set(link, {
              title: "Cached source",
              snippet: "",
              link,
              fromCache: true
            });
          }
          return Array.from(merged.values());
        },
        _buildResultFromCachedDecision(questionText, questionForInference, cachedDecision) {
          const answerLetter = String(cachedDecision?.answerLetter || cachedDecision?.bestLetter || "").toUpperCase();
          const answerText = String(cachedDecision?.answerText || "").trim();
          const answer = String(cachedDecision?.answer || "").trim() || (answerLetter ? `Letra ${answerLetter}: ${answerText}`.trim() : "");
          return [{
            question: questionText,
            answer,
            answerLetter,
            answerText,
            sources: Array.isArray(cachedDecision?.sources) ? cachedDecision.sources : [],
            bestLetter: String(cachedDecision?.bestLetter || answerLetter || ""),
            votes: cachedDecision?.votes || {},
            baseVotes: cachedDecision?.baseVotes || {},
            evidenceVotes: cachedDecision?.evidenceVotes || {},
            evidenceConsensus: cachedDecision?.evidenceConsensus || {},
            confidence: Number(cachedDecision?.confidence || 0.9),
            resultState: String(cachedDecision?.resultState || "confirmed"),
            reason: String(cachedDecision?.reason || "confirmed_by_sources"),
            evidenceTier: String(cachedDecision?.evidenceTier || "EVIDENCE_STRONG"),
            questionPolarity: String(cachedDecision?.questionPolarity || QuestionParser.detectQuestionPolarity(QuestionParser.extractQuestionStem(questionForInference || questionText))),
            title: "Cached verified result",
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
            outcome = "finished",
            resultState = "inconclusive",
            evidenceTier = "EVIDENCE_WEAK",
            runStats = null,
            bestLetter = "",
            confidence = 0
          } = payload;
          try {
            const data = await SearchCacheService.storageGet([SearchCacheService.SEARCH_METRICS_KEY]);
            const metrics = data?.[SearchCacheService.SEARCH_METRICS_KEY] || {
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
              bestLetter: String(bestLetter || ""),
              confidence: Number(confidence || 0),
              analyzed: Number(runStats?.analyzed || 0),
              acceptedVotes: Number(runStats?.acceptedForVotes || 0),
              acceptedAi: Number(runStats?.acceptedForAiEvidence || 0)
            });
            if (metrics.lastRuns.length > 120) {
              metrics.lastRuns = metrics.lastRuns.slice(metrics.lastRuns.length - 120);
            }
            metrics.updatedAt = Date.now();
            await SearchCacheService.storageSet({
              [SearchCacheService.SEARCH_METRICS_KEY]: metrics
            });
          } catch {
          }
        },
        _getHostHintFromLink(link) {
          try {
            const u = new URL(link);
            const host = u.hostname.replace(/^www\./, "").toLowerCase();
            if (host === "webcache.googleusercontent.com") {
              const q = u.searchParams.get("q") || "";
              const m = q.match(/cache:(.+)$/i);
              if (m) {
                const decoded = decodeURIComponent(m[1]);
                const inner = new URL(decoded);
                return inner.hostname.replace(/^www\./, "").toLowerCase();
              }
            }
            return host;
          } catch {
            return "";
          }
        },
        // ═══ MATCH QUALITY COMPUTATION ═══
        computeMatchQuality(sourceText, questionText, originalOptions, originalOptionsMap) {
          let quality = 0;
          const block = EvidenceService.findQuestionBlock(sourceText, questionText);
          if (block) quality += block.method === "fingerprint" ? 3 : 2;
          if (originalOptions && originalOptions.length >= 2) {
            const sourceOptions = [];
            const optRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/gim;
            let om;
            while ((om = optRe.exec(sourceText)) !== null) {
              sourceOptions.push(`${om[1].toUpperCase()}) ${om[2].trim()}`);
            }
            if (OptionsMatchService.optionsMatch(originalOptions, sourceOptions)) quality += 2;
          }
          const gabarito = EvidenceService.extractExplicitGabarito(sourceText, questionText);
          if (gabarito) quality += 3;
          return Math.min(quality, 10);
        },
        _logSourceDiagnostic(diag) {
          if (!diag) return;
          const host = diag.hostHint || "unknown";
          const type = diag.type || "TYPE_UNKNOWN";
          const phase = diag.phase || "info";
          const sim = Number.isFinite(diag.topicSim) ? diag.topicSim.toFixed(2) : "n/a";
          const opts = diag.optionsMatch === void 0 ? "n/a" : diag.optionsMatch ? "ok" : "mismatch";
          const obf = diag.obfuscation?.isObfuscated ? `yes(vr=${(diag.obfuscation.vowelRatio || 0).toFixed(2)},jr=${(diag.obfuscation.junkRatio || 0).toFixed(2)},cr=${(diag.obfuscation.consonantRunRatio || 0).toFixed(3)},lcr=${diag.obfuscation.longConsonantRuns || 0})` : "no";
          const paywall = diag.paywall?.isPaywalled ? `yes(m=${diag.paywall.markerHits || 0})` : "no";
          const reason = diag.reason ? ` reason=${diag.reason}` : "";
          const decision = diag.decision ? ` decision=${diag.decision}` : "";
          const method = diag.method ? ` method=${diag.method}` : "";
          const letter = diag.letter ? ` letter=${diag.letter}` : "";
          const textLen = Number.isFinite(diag.textLength) ? ` text=${diag.textLength}` : "";
          console.log(`SearchService: SourceDiag[${phase}] host=${host} type=${type} sim=${sim} opts=${opts} obf=${obf} pw=${paywall}${textLen}${decision}${method}${letter}${reason}`);
        },
        async searchOnly(questionText) {
          const results = await ApiService.searchWithSerper(questionText);
          const fingerprint = await this._canonicalHash(questionText || "");
          return this._mergeCachedSourcesIntoResults(fingerprint, results || []);
        },
        async answerFromAi(questionText) {
          const extractedOptions = QuestionParser.extractOptionsFromQuestion(questionText);
          const optionLetters = extractedOptions.map((line) => {
            const m = String(line || "").match(/^([A-E])\)/i);
            return (m?.[1] || "").toUpperCase();
          }).filter(Boolean);
          const hasOptions = extractedOptions.length >= 2;
          const hasReliableOptions = extractedOptions.length >= 3 && optionLetters[0] === "A" && optionLetters[1] === "B" && optionLetters.every((letter, index) => letter.charCodeAt(0) === "A".charCodeAt(0) + index);
          if (hasOptions && !hasReliableOptions) {
            return [{
              question: questionText,
              answer: "INCONCLUSIVO: alternativas malformadas na captura (OCR/DOM).",
              answerLetter: null,
              answerText: "Alternativas malformadas na captura (OCR/DOM).",
              aiFallback: true,
              evidenceTier: "AI_ONLY",
              resultState: "inconclusive",
              reason: "malformed_options",
              confidence: 0.12,
              votes: void 0,
              sources: []
            }];
          }
          const aiAnswer = await ApiService.generateAnswerFromQuestion(questionText);
          if (!aiAnswer) {
            if (hasOptions) {
              return [{
                question: questionText,
                answer: "INCONCLUSIVO: sem evid\xEAncia externa confi\xE1vel para marcar alternativa.",
                answerLetter: null,
                answerText: "Sem evid\xEAncia externa confi\xE1vel para marcar alternativa.",
                aiFallback: true,
                evidenceTier: "AI_ONLY",
                resultState: "inconclusive",
                reason: "inconclusive",
                confidence: 0.15,
                votes: void 0,
                sources: []
              }];
            }
            return [];
          }
          const answerLetter = this._parseAnswerLetter(aiAnswer);
          const answerText = this._parseAnswerText(aiAnswer);
          if (!answerLetter && /INCONCLUSIVO/i.test(aiAnswer)) {
            return [{
              question: questionText,
              answer: aiAnswer,
              answerLetter: null,
              answerText: "Sem evid\xEAncia suficiente para marcar alternativa.",
              aiFallback: true,
              evidenceTier: "AI_ONLY",
              resultState: "inconclusive",
              reason: "inconclusive",
              confidence: 0.15,
              votes: void 0,
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
            evidenceTier: "AI_ONLY",
            resultState: answerLetter ? "suggested" : "inconclusive",
            reason: answerLetter ? "ai_knowledge" : "inconclusive",
            confidence: answerLetter ? 0.55 : 0.15,
            votes: answerLetter ? {
              [answerLetter]: 1
            } : void 0,
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
        async refineFromResults(questionText, results, originalQuestionWithOptions = "", onStatus = null, pageGabarito = null) {
          if (!results || results.length === 0) return [];
          ApiService.resetWebcache429();
          await SearchCacheService.loadAiResultCache();
          const sources = [];
          const topResults = results.slice(0, 10);
          const questionForInference = originalQuestionWithOptions || questionText;
          const questionStem = QuestionParser.extractQuestionStem(questionForInference);
          const questionFingerprint = await this._canonicalHash(questionForInference);
          const originalOptions = QuestionParser.extractOptionsFromQuestion(questionForInference);
          const originalOptionsMap = this._buildOptionsMap(questionForInference);
          const hasOptions = originalOptions && originalOptions.length >= 2;
          const questionPolarity = QuestionParser.detectQuestionPolarity(questionStem);
          console.log(`SearchService: Polarity detected: ${questionPolarity}`);
          console.group("\u{1F50D} SearchService DEBUG \u2014 Pipeline Start");
          console.log("Question stem:", questionStem.slice(0, 120));
          console.log("Options extracted:", originalOptions);
          console.log("Has options:", hasOptions, "| Options count:", originalOptions.length);
          console.log("Options map:", originalOptionsMap);
          console.log("Total results to analyze:", topResults.length);
          console.groupEnd();
          const domainWeights = {
            "qconcursos.com": 2.5,
            "qconcursos.com.br": 2.5,
            "passeidireto.com": 1.4,
            "studocu.com": 1.3,
            "brainly.com.br": 0.9,
            "brainly.com": 0.9
          };
          const riskyCombinedHosts = /* @__PURE__ */ new Set(["passeidireto.com", "brainly.com.br", "brainly.com", "scribd.com", "pt.scribd.com"]);
          const trustedCombinedHosts = /* @__PURE__ */ new Set(["qconcursos.com", "qconcursos.com.br", "google", "studocu.com"]);
          const isTrustedCombinedHost = (host) => {
            const h = String(host || "").toLowerCase();
            if (!h) return false;
            return trustedCombinedHosts.has(h) || h.endsWith(".gov.br") || h.endsWith(".edu.br");
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
              return domainWeights[host] || 1;
            } catch {
              return 1;
            }
          };
          const aiEvidence = [];
          const collectedForCombined = [];
          let aiExtractionCount = 0;
          let aiHtmlExtractionCount = 0;
          const aiKnowledgePool = [];
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
          const logRunSummary = (outcome = "finished") => {
            console.log(`SearchService: RunSummary outcome=${outcome} analyzed=${runStats.analyzed} acceptedVotes=${runStats.acceptedForVotes} acceptedAi=${runStats.acceptedForAiEvidence} aiExtraction=${runStats.acceptedViaAiExtraction} knowledgePool=${aiKnowledgePool.length} blockedPaywall=${runStats.blockedPaywall} blockedObf=${runStats.blockedObfuscation} blockedMismatch=${runStats.blockedOptionsMismatch} blockedSnapshotMismatch=${runStats.blockedSnapshotMismatch} blockedErrors=${runStats.blockedByError}`);
          };
          const serperMeta = results._serperMeta || null;
          const searchProvider = results._searchProvider || "serper";
          const googleMetaSignals = {
            provider: searchProvider,
            answerBox: !!serperMeta?.answerBox,
            aiOverview: !!serperMeta?.aiOverview,
            peopleAlsoAsk: Array.isArray(serperMeta?.peopleAlsoAsk) ? serperMeta.peopleAlsoAsk.length > 0 : !!serperMeta?.peopleAlsoAsk
          };
          if (serperMeta && hasOptions) {
            console.group("\u{1F310} Google Meta Signals (answerBox / AI Overview / PAA)");
            console.log("answerBox:", serperMeta.answerBox ? "present" : "absent");
            console.log("aiOverview:", serperMeta.aiOverview ? "present" : "absent");
            console.log("peopleAlsoAsk:", serperMeta.peopleAlsoAsk ? `${serperMeta.peopleAlsoAsk.length} entries` : "absent");
            const googleMeta = this._extractLetterFromGoogleMeta(serperMeta, questionStem, originalOptionsMap, originalOptions);
            if (googleMeta?.letter) {
              const googleWeight = googleMeta.method === "google-ai-overview" ? 3.8 : googleMeta.method === "google-answerbox" ? 3.2 : 1.8;
              const confFactor = Math.max(0.5, Math.min(1, googleMeta.confidence || 0.75));
              const adjustedWeight = googleWeight * confFactor;
              const sourceId = `google-meta:${sources.length + 1}`;
              const evidenceBlock = EvidenceService.buildEvidenceBlock({
                questionFingerprint,
                sourceId,
                sourceLink: "",
                hostHint: "google",
                evidenceText: googleMeta.evidence || "",
                originalOptionsMap,
                explicitLetter: googleMeta.letter,
                confidenceLocal: googleMeta.confidence || 0.75,
                evidenceType: googleMeta.method
              });
              sources.push({
                title: `Google ${googleMeta.method === "google-ai-overview" ? "AI Overview" : googleMeta.method === "google-answerbox" ? "Answer Box" : "PAA"}`,
                link: "",
                letter: googleMeta.letter,
                weight: adjustedWeight,
                evidenceType: googleMeta.method,
                questionPolarity,
                matchQuality: 8,
                hostHint: "google",
                sourceId,
                evidenceBlock
              });
              runStats.acceptedForVotes += 1;
              console.log(`  \u2705 Google meta ACCEPTED: letter=${googleMeta.letter} method=${googleMeta.method} weight=${adjustedWeight.toFixed(2)} confidence=${(googleMeta.confidence || 0).toFixed(2)}`);
            } else {
              console.log("  \u2139\uFE0F No answer letter extracted from Google meta signals");
              const metaTexts = [];
              if (serperMeta.answerBox) {
                const abText = [serperMeta.answerBox.title, serperMeta.answerBox.snippet, serperMeta.answerBox.answer].filter(Boolean).join(" ").trim();
                if (abText.length >= 40) metaTexts.push(abText);
              }
              if (serperMeta.aiOverview) {
                let aioText = "";
                if (typeof serperMeta.aiOverview === "string") aioText = serperMeta.aiOverview;
                else if (serperMeta.aiOverview.text_blocks) aioText = this._flattenAiOverviewBlocks(serperMeta.aiOverview.text_blocks);
                else if (serperMeta.aiOverview.snippet) aioText = serperMeta.aiOverview.snippet;
                if (aioText.length >= 40) metaTexts.push(aioText);
              }
              if (metaTexts.length > 0) {
                const combinedMeta = metaTexts.join("\n\n").slice(0, 3e3);
                const topicSim = QuestionParser.questionSimilarityScore(combinedMeta, questionStem);
                if (topicSim >= 0.25) {
                  collectedForCombined.push({
                    title: "Google AI Overview / Answer Box",
                    link: "",
                    text: combinedMeta,
                    topicSim,
                    optionsMatch: true,
                    optionsCoverage: {
                      hits: 0,
                      total: 0,
                      ratio: 0,
                      hasEnoughOptions: false
                    },
                    hostHint: "google",
                    obfuscated: false,
                    paywalled: false
                  });
                  console.log(`  \u{1F4DD} Google meta text collected for AI combined (topicSim=${topicSim.toFixed(2)}, len=${combinedMeta.length})`);
                }
              }
            }
            console.groupEnd();
          }
          const _cacheNow = Date.now();
          for (const [_cUrl, _cEntry] of SearchCacheService.snapshotCache) {
            if (_cacheNow - _cEntry.fetchedAt > SearchCacheService.SNAPSHOT_CACHE_TTL) {
              SearchCacheService.snapshotCache.delete(_cUrl);
            }
          }
          const _prefetchedSnaps = /* @__PURE__ */ new Map();
          let _cacheHits = 0;
          for (const r of topResults) {
            const cached = SearchCacheService.snapshotCache.get(r.link);
            if (cached) {
              _prefetchedSnaps.set(r.link, cached.snap);
              _cacheHits++;
              try {
                console.log(`  \u{1F4E6} [cache-hit] ${new URL(r.link).hostname} (age=${Math.round((_cacheNow - cached.fetchedAt) / 1e3)}s)`);
              } catch (_) {
              }
            }
          }
          const _BATCH_SIZE = 5;
          const _storeFetchInCache = () => {
            for (const [_sUrl, _sSnap] of _prefetchedSnaps) {
              if (_sSnap?.ok && !SearchCacheService.snapshotCache.has(_sUrl)) {
                if (SearchCacheService.snapshotCache.size >= SearchCacheService.SNAPSHOT_CACHE_MAX) {
                  const oldest = [...SearchCacheService.snapshotCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
                  if (oldest) SearchCacheService.snapshotCache.delete(oldest[0]);
                }
                SearchCacheService.snapshotCache.set(_sUrl, {
                  snap: _sSnap,
                  fetchedAt: _cacheNow
                });
              }
            }
          };
          const _fetchBatch = async (batch) => {
            const toFetch = batch.filter((r) => !_prefetchedSnaps.has(r.link));
            if (toFetch.length === 0) return;
            let idx = 0;
            const workers = Array.from({
              length: Math.min(5, toFetch.length)
            }, async () => {
              while (idx < toFetch.length) {
                const r = toFetch[idx++];
                try {
                  const snap = await ApiService.fetchPageSnapshot(r.link, {
                    timeoutMs: 6500,
                    maxHtmlChars: 15e5,
                    maxTextChars: 12e3
                  });
                  _prefetchedSnaps.set(r.link, snap);
                } catch (e) {
                  _prefetchedSnaps.set(r.link, null);
                }
              }
            });
            await Promise.all(workers);
          };
          const batch1 = topResults.slice(0, _BATCH_SIZE);
          const batch2 = topResults.slice(_BATCH_SIZE);
          if (typeof onStatus === "function") {
            const cached = batch1.filter((r) => _prefetchedSnaps.has(r.link)).length;
            const fetching = batch1.length - cached;
            onStatus(fetching > 0 ? `Fetching batch 1/${batch2.length > 0 ? "2" : "1"} (${fetching} sources${cached > 0 ? `, ${cached} cached` : ""})...` : `Analyzing ${batch1.length} cached sources...`);
          }
          await _fetchBatch(batch1);
          _storeFetchInCache();
          console.log(`SearchService: Batch 1 fetch complete \u2014 ${_prefetchedSnaps.size} pages ready (${_cacheHits} from cache)`);
          let _batch2Fetched = batch2.length === 0;
          for (const result of topResults) {
            if (!_batch2Fetched && runStats.analyzed >= _BATCH_SIZE) {
              const {
                bestLetter: bestLetter2,
                votes: votes2
              } = EvidenceService.computeVotesAndState(sources);
              const topVote = bestLetter2 ? votes2[bestLetter2] || 0 : 0;
              if (bestLetter2 && topVote >= 4) {
                console.log(`SearchService: \u26A1 Batch 1 sufficient \u2014 skipping batch 2 (votes[${bestLetter2}]=${topVote.toFixed(1)})`);
                _batch2Fetched = true;
                break;
              }
              console.log(`SearchService: Batch 1 insufficient (topVote=${topVote.toFixed(1)}) \u2014 fetching batch 2 (${batch2.length} sources)...`);
              if (typeof onStatus === "function") {
                onStatus(`Fetching batch 2 (${batch2.length} more sources)...`);
              }
              await _fetchBatch(batch2);
              _storeFetchInCache();
              console.log(`SearchService: Batch 2 fetch complete \u2014 ${_prefetchedSnaps.size} total pages ready`);
              _batch2Fetched = true;
            }
            try {
              const snippet = result.snippet || "";
              const title = result.title || "";
              const link = result.link;
              runStats.analyzed += 1;
              if (typeof onStatus === "function") {
                onStatus(`Analyzing source ${runStats.analyzed}/${topResults.length}...`);
              }
              const snap = _prefetchedSnaps.get(link) || null;
              const pageText = (snap?.text || "").trim();
              const combinedText = `${title}. ${snippet}

${pageText}`.trim();
              const scopedCombinedText = EvidenceService.buildQuestionScopedText(combinedText, questionForInference, 3600);
              console.log(`  \u{1F4D0} scopedCombinedText length=${scopedCombinedText.length} (full combined=${combinedText.length}) preview="${scopedCombinedText.slice(0, 200)}"`);
              const seedText = `${title}. ${snippet}`.trim();
              const snapshotWeak = !snap?.ok || pageText.length < 120;
              if (snapshotWeak && hasOptions) {
                const seedCoverage = OptionsMatchService.optionsCoverageInFreeText(originalOptions, seedText);
                const seedTopicSim = QuestionParser.questionSimilarityScore(seedText, questionStem);
                const highTopicSim = seedTopicSim >= 0.85;
                const minHitsForStrong = highTopicSim ? Math.min(2, seedCoverage.total || 2) : Math.min(4, seedCoverage.total || 4);
                const minRatioForStrong = highTopicSim ? 0.35 : 0.8;
                const seedStrongMatch = (seedCoverage.ratio >= minRatioForStrong || seedCoverage.hits >= minHitsForStrong) && seedTopicSim >= 0.55;
                if (!seedStrongMatch) {
                  console.log(`\u26D4 Source #${runStats.analyzed} (${this._getHostHintFromLink(link)}): snapshot-empty-options-mismatch (seedCoverage: ${seedCoverage.hits}/${seedCoverage.total})`);
                  runStats.blockedSnapshotMismatch += 1;
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint: this._getHostHintFromLink(link),
                    type: "TYPE_SNAPSHOT_WEAK",
                    topicSim: seedTopicSim,
                    optionsMatch: false,
                    obfuscation: null,
                    decision: "skip",
                    reason: "snapshot-empty-options-mismatch"
                  });
                  continue;
                }
              }
              const hostHint = this._getHostHintFromLink(link);
              const htmlText = snap?.html || "";
              const parsedForDiag = HtmlExtractorService.parseHtmlDom(htmlText);
              const sourceType = HtmlExtractorService.detectHtmlType(htmlText, parsedForDiag.doc);
              const docText = HtmlExtractorService.extractDocText(parsedForDiag.doc);
              const obfuscation = HtmlExtractorService.obfuscationSignals(docText);
              let paywall = HtmlExtractorService.paywallSignals(htmlText, docText, hostHint);
              const topicSimBase = QuestionParser.questionSimilarityScore(combinedText, questionStem);
              console.group(`\u{1F4C4} Source #${runStats.analyzed}: ${hostHint}`);
              console.log("Link:", link);
              console.log("Fetch OK:", snap?.ok, "| HTML length:", htmlText.length, "| Text length:", pageText.length);
              console.log("Source type:", sourceType);
              console.log("Topic similarity:", topicSimBase.toFixed(3));
              console.log("Paywall:", JSON.stringify(paywall));
              console.log("Obfuscation:", JSON.stringify(obfuscation));
              let optionsCoverageBase = hasOptions ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, scopedCombinedText) : {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: false
              };
              let optionsMatchBase = hasOptions ? OptionsMatchService.optionsMatchInFreeText(originalOptions, scopedCombinedText) : true;
              if (hasOptions && !optionsMatchBase && combinedText.length > scopedCombinedText.length + 200) {
                const fullCoverage = OptionsMatchService.optionsCoverageInFreeText(originalOptions, combinedText);
                const fullMatch = fullCoverage.ratio >= 0.6 || fullCoverage.hits >= Math.min(3, fullCoverage.total || 3);
                if (fullMatch) {
                  optionsCoverageBase = fullCoverage;
                  optionsMatchBase = true;
                  console.log(`SearchService: Options matched via full-text fallback for ${hostHint} (hits=${fullCoverage.hits}/${fullCoverage.total})`);
                } else {
                  console.log(`  \u274C Full-text options fallback also failed: hits=${fullCoverage.hits}/${fullCoverage.total} ratio=${fullCoverage.ratio.toFixed(2)}`);
                }
              }
              console.log("Options match:", optionsMatchBase, "| Coverage:", JSON.stringify(optionsCoverageBase));
              this._logSourceDiagnostic({
                phase: "start",
                hostHint,
                type: sourceType,
                topicSim: topicSimBase,
                optionsMatch: optionsMatchBase,
                obfuscation,
                paywall,
                textLength: combinedText.length
              });
              if (paywall?.isPaywalled) {
                const readableTextLen = (docText || "").length;
                console.log(`  \u{1F512} Paywall detected: readableTextLen=${readableTextLen}`);
                if (readableTextLen < 400) {
                  console.log(`  \u26D4 BLOCKED: paywall-overlay (text too short: ${readableTextLen} < 400)`);
                  console.groupEnd();
                  runStats.blockedPaywall += 1;
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    paywall,
                    decision: "skip",
                    reason: "paywall-overlay"
                  });
                  continue;
                }
                paywall = {
                  ...paywall,
                  isPaywalled: false,
                  softPassed: true
                };
                console.log(`  \u2705 Paywall SOFT-PASSED: text readable (${readableTextLen} chars) \u2014 flag cleared`);
              }
              if (obfuscation?.isObfuscated) {
                console.log(`  \u26D4 BLOCKED: obfuscated HTML`);
                if (topicSimBase >= 0.3 && !paywall?.isPaywalled) {
                  const clipped2 = scopedCombinedText.slice(0, 3e3);
                  if (clipped2.length >= 200) {
                    collectedForCombined.push({
                      title,
                      link,
                      text: clipped2,
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
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  paywall,
                  decision: "skip",
                  reason: "obfuscated_html"
                });
                console.groupEnd();
                continue;
              }
              const allowStructuredMismatchBypass = hasOptions && !optionsMatchBase && !obfuscation?.isObfuscated && topicSimBase >= 0.26 && (hostHint === "passeidireto.com" || hostHint === "studocu.com");
              if (allowStructuredMismatchBypass) {
                console.log(`  [BYPASS] options mismatch softened for structured extractors (host=${hostHint}, topicSim=${topicSimBase.toFixed(3)})`);
              }
              if (hasOptions && !optionsMatchBase && !allowStructuredMismatchBypass) {
                console.log(`  \u26D4 BLOCKED: options-mismatch-hard-block (topicSim=${topicSimBase.toFixed(3)})`);
                if (topicSimBase >= 0.25 && !obfuscation?.isObfuscated) {
                  const clipped2 = scopedCombinedText.slice(0, 3e3);
                  if (clipped2.length >= 200) {
                    collectedForCombined.push({
                      title,
                      link,
                      text: clipped2,
                      topicSim: topicSimBase,
                      optionsMatch: false,
                      optionsCoverage: optionsCoverageBase,
                      hostHint,
                      obfuscated: false,
                      paywalled: !!paywall?.isPaywalled
                    });
                  }
                }
                if (aiExtractionCount < 5 && topicSimBase >= 0.5 && !obfuscation?.isObfuscated && scopedCombinedText.length >= 300) {
                  const aiScopedText = EvidenceService.buildQuestionScopedText(combinedText, questionForInference, 8e3);
                  console.log(`  \u{1F916} [AI-MISMATCH] Attempting knowledge extraction from mismatch source (call ${aiExtractionCount + 1}/5, topicSim=${topicSimBase.toFixed(3)}, textLen=${aiScopedText.length}, host=${hostHint})`);
                  if (typeof onStatus === "function") {
                    onStatus(`AI extracting knowledge from ${hostHint || "source"}...`);
                  }
                  try {
                    const aiExtracted = await ApiService.aiExtractFromPage(aiScopedText, questionForInference, hostHint);
                    aiExtractionCount++;
                    if (aiExtracted?.knowledge) {
                      const cleanKnowledge = aiExtracted.knowledge.replace(/^RESULTADO:\s*ENCONTRADO\s*$/gim, "").replace(/^Letra\s+[A-E]\b.*$/gim, "").trim();
                      aiKnowledgePool.push({
                        host: hostHint,
                        knowledge: cleanKnowledge,
                        topicSim: topicSimBase,
                        link,
                        title,
                        origin: "mismatch"
                      });
                      console.log(`  \u{1F916} [AI-MISMATCH] Knowledge collected: ${cleanKnowledge.length} chars (pool size=${aiKnowledgePool.length})`);
                    }
                    if (aiExtracted?.letter) {
                      console.log(`  \u{1F916} [AI-MISMATCH] Letter ${aiExtracted.letter} found but IGNORED (options mismatch \u2014 cannot map to user's options)`);
                    }
                  } catch (e) {
                    console.warn(`  \u{1F916} [AI-MISMATCH] Extraction failed:`, e?.message || e);
                  }
                }
                runStats.blockedOptionsMismatch += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: false,
                  obfuscation,
                  paywall,
                  decision: "skip",
                  reason: "options-mismatch-hard-block"
                });
                console.groupEnd();
                continue;
              }
              console.log("  \u2705 Passed all filters \u2014 entering extraction chain");
              const structured = HtmlExtractorService.extractStructuredEvidence(htmlText, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, {
                parsed: parsedForDiag,
                type: sourceType,
                obfuscation,
                paywall
              });
              console.log(`  \u{1F3D7}\uFE0F Structured extractor: skip=${!!structured?.skip} reason=${structured?.reason || "none"} letter=${structured?.letter || "none"} method=${structured?.method || "none"}`);
              if (structured?.skip) {
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "structured-skip-fallback",
                  reason: structured.reason || "structured-skip"
                });
                if (structured.reason === "obfuscated_html" || structured.reason === "paywall-overlay") {
                  console.log(`  \u26D4 Structured hard-skip: ${structured.reason}`);
                  console.groupEnd();
                  continue;
                }
                console.log(`  \u26A0\uFE0F Structured skip (soft): ${structured.reason} \u2014 continuing to fallbacks`);
              }
              if (structured?.letter) {
                console.log(`  \u{1F3AF} Structured found letter: ${structured.letter} method=${structured.method} confidence=${structured.confidence} matchQuality=${structured.matchQuality}`);
                const riskyHost = hostHint === "passeidireto.com" || hostHint === "brainly.com.br" || hostHint === "brainly.com";
                const structuredMethod = structured.method || "structured-html";
                const structuredSim = structured.matchQuality || 0;
                const evidenceScope = `${structured.evidence || ""}
${scopedCombinedText.slice(0, 1800)}`;
                const structuredCoverage = hasOptions ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, evidenceScope) : {
                  hits: 0,
                  total: 0,
                  ratio: 0,
                  hasEnoughOptions: false
                };
                const structuredOptionsMatch = !structuredCoverage.hasEnoughOptions || structuredCoverage.ratio >= 0.6 || structuredCoverage.hits >= Math.min(3, structuredCoverage.total || 3);
                const structuredOptionsStrong = !structuredCoverage.hasEnoughOptions || structuredCoverage.ratio >= 0.8 || structuredCoverage.hits >= Math.min(4, structuredCoverage.total || 4);
                const isGenericAnchor = structuredMethod === "generic-anchor";
                console.log(`  \u{1F4CA} Structured coverage: match=${structuredOptionsMatch} strong=${structuredOptionsStrong} hits=${structuredCoverage.hits}/${structuredCoverage.total} ratio=${structuredCoverage.ratio?.toFixed(2)} isGenericAnchor=${isGenericAnchor} riskyHost=${riskyHost} sim=${structuredSim.toFixed(2)}`);
                const isZeroCoverageOnRiskyHost = riskyHost && structuredCoverage.hasEnoughOptions && structuredCoverage.hits === 0 && structuredSim < 0.45;
                if (isZeroCoverageOnRiskyHost && !isGenericAnchor) {
                  console.log(`  \u26A0\uFE0F Structured ${structuredMethod} demoted: risky host with 0 option hits and low sim=${structuredSim.toFixed(2)}`);
                  if (topicSimBase >= 0.2) {
                    collectedForCombined.push({
                      title,
                      link,
                      text: scopedCombinedText.slice(0, 3e3),
                      topicSim: topicSimBase,
                      optionsMatch: structuredOptionsMatch,
                      optionsCoverage: structuredCoverage,
                      hostHint,
                      obfuscated: !!obfuscation?.isObfuscated,
                      paywalled: !!paywall?.isPaywalled
                    });
                  }
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: structuredOptionsMatch,
                    obfuscation,
                    decision: "combined-only",
                    method: structuredMethod,
                    reason: "structured-zero-coverage-risky-host"
                  });
                  console.groupEnd();
                  continue;
                }
                if (isGenericAnchor && riskyHost && !structuredOptionsStrong && structuredSim < 0.62) {
                  if (topicSimBase >= 0.2) {
                    collectedForCombined.push({
                      title,
                      link,
                      text: scopedCombinedText.slice(0, 3e3),
                      topicSim: topicSimBase,
                      optionsMatch: structuredOptionsMatch,
                      optionsCoverage: structuredCoverage,
                      hostHint,
                      obfuscated: !!obfuscation?.isObfuscated,
                      paywalled: !!paywall?.isPaywalled
                    });
                  }
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: structuredOptionsMatch,
                    obfuscation,
                    decision: "combined-only",
                    method: structuredMethod,
                    reason: "generic-anchor-options-mismatch"
                  });
                  console.log(`  \u26A0\uFE0F Generic anchor demoted to combined-only (risky=${riskyHost} strongOpts=${structuredOptionsStrong} sim=${structuredSim.toFixed(2)})`);
                  console.groupEnd();
                  continue;
                }
                console.log(`  \u{1F500} Structured pre-remap letter: ${structured.letter} \u2014 attempting remap via scopedCombinedText (len=${scopedCombinedText.length})...`);
                structured.letter = this._remapLetterIfShuffled(structured.letter, scopedCombinedText, originalOptionsMap);
                console.log(`  \u{1F500} Structured post-remap letter: ${structured.letter}`);
                const baseWeight = getDomainWeight(link);
                const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                const structuredBoost = (structured.confidence || 0.82) >= 0.9 ? 4.4 : 3.7;
                const weight = baseWeight + structuredBoost + quality * 0.35;
                const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                const evidenceBlock = EvidenceService.buildEvidenceBlock({
                  questionFingerprint,
                  sourceId,
                  sourceLink: link,
                  hostHint,
                  evidenceText: structured.evidence || scopedCombinedText,
                  originalOptionsMap,
                  explicitLetter: structured.letter,
                  confidenceLocal: structured.confidence || 0.82,
                  evidenceType: structured.evidenceType || "structured-html"
                });
                sources.push({
                  title,
                  link,
                  letter: structured.letter,
                  weight,
                  evidenceType: structured.evidenceType || "structured-html",
                  questionPolarity,
                  matchQuality: Math.max(quality, Math.round((structured.matchQuality || 0) * 10)),
                  extractionMethod: structuredMethod,
                  evidence: structured.evidence || "",
                  hostHint,
                  sourceId,
                  evidenceBlock
                });
                runStats.acceptedForVotes += 1;
                console.log(`  \u2705 ACCEPTED via structured: letter=${structured.letter} weight=${weight.toFixed(2)} method=${structuredMethod}`);
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "use-structured",
                  method: structuredMethod,
                  letter: structured.letter
                });
                const {
                  bestLetter: bestLetter2,
                  votes: votes2
                } = EvidenceService.computeVotesAndState(sources);
                if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                  console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                  console.groupEnd();
                  break;
                }
                console.groupEnd();
                continue;
              }
              let extracted = null;
              if (hostHint === "passeidireto.com" || hostHint === "studocu.com") {
                const blockedByIntegrity = !!obfuscation?.isObfuscated || !!paywall?.isPaywalled || hasOptions && !optionsMatchBase && !allowStructuredMismatchBypass;
                console.log(`  \u{1F4C4} PDF-highlight check: blockedByIntegrity=${blockedByIntegrity} (obf=${!!obfuscation?.isObfuscated} pw=${!!paywall?.isPaywalled} optMismatch=${hasOptions && !optionsMatchBase})`);
                if (blockedByIntegrity) {
                  console.log(`  \u26D4 PDF-highlight blocked: integrity check failed`);
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    paywall,
                    decision: "skip",
                    reason: "pdf-signal-blocked-low-integrity"
                  });
                  console.groupEnd();
                  continue;
                }
                extracted = HtmlExtractorService.extractPdfHighlightLetter(snap?.html || "", questionStem, originalOptionsMap, originalOptions);
                console.log(`  \u{1F4C4} PDF-highlight result: letter=${extracted?.letter || "none"} method=${extracted?.method || "none"} confidence=${extracted?.confidence || 0} evidence="${extracted?.evidence || "none"}"`);
                if (!extracted?.letter && snap?.html && snap.html.length > 5e3 && aiHtmlExtractionCount < 2) {
                  const reconstructedQ = questionStem + "\n" + (originalOptions || []).join("\n");
                  const optTokensForHtml = QuestionParser.extractOptionTokens(reconstructedQ);
                  const htmlSnippet = EvidenceService.extractHtmlAroundQuestion(snap.html, questionStem, optTokensForHtml, 12e3);
                  if (htmlSnippet && htmlSnippet.length > 500) {
                    console.log(`  \u{1F916} [AI-HTML] Attempting AI HTML extraction (host=${hostHint}, snippetLen=${htmlSnippet.length})`);
                    if (typeof onStatus === "function") {
                      onStatus(`AI analyzing HTML from ${hostHint}...`);
                    }
                    const _aiHtmlCacheKey = link + "|html";
                    const _aiHtmlCached = SearchCacheService.getCachedAiResult(_aiHtmlCacheKey, questionForInference);
                    let aiHtmlResult;
                    if (_aiHtmlCached) {
                      console.log(`  \u{1F916} [AI-HTML] \u{1F4E6} Cache hit for ${hostHint} \u2014 skipping LLM call`);
                      aiHtmlResult = _aiHtmlCached;
                    } else {
                      aiHtmlResult = await ApiService.aiExtractFromHtml(htmlSnippet, questionForInference, hostHint);
                      if (aiHtmlResult) SearchCacheService.setCachedAiResult(_aiHtmlCacheKey, questionForInference, aiHtmlResult);
                    }
                    aiHtmlExtractionCount++;
                    if (aiHtmlResult?.letter) {
                      console.log(`  \u{1F916} [AI-HTML] Found letter=${aiHtmlResult.letter} via ${aiHtmlResult.method}`);
                      extracted = {
                        letter: aiHtmlResult.letter,
                        confidence: aiHtmlResult.confidence || 0.85,
                        method: aiHtmlResult.method || "ai-html-extraction",
                        evidence: aiHtmlResult.evidence || ""
                      };
                    } else {
                      console.log(`  \u{1F916} [AI-HTML] No letter found`);
                      if (aiHtmlResult?.knowledge) {
                        aiKnowledgePool.push({
                          host: hostHint,
                          knowledge: aiHtmlResult.knowledge,
                          topicSim: topicSimBase,
                          link,
                          title
                        });
                      }
                    }
                  }
                }
                if (extracted?.letter) {
                  console.log(`  \u{1F4C4} PDF-highlight raw letter: ${extracted.letter} \u2014 attempting remap via scopedCombinedText (len=${scopedCombinedText.length})...`);
                  extracted.letter = this._remapLetterIfShuffled(extracted.letter, scopedCombinedText, originalOptionsMap);
                  console.log(`SearchService: PDF signal detected. host=${hostHint} letter=${extracted.letter} method=${extracted.method || "ff1-highlight"}`);
                  const baseWeight = getDomainWeight(link);
                  const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                  const method = extracted.method || "ff1-highlight";
                  const heuristicSignal = method === "ff1-highlight" || method === "css-signature";
                  const signalBoost = heuristicSignal ? 1.8 : 3.2;
                  const confFactor = Math.max(0.35, Math.min(1, Number(extracted.confidence) || 0.82));
                  const adjustedSignalBoost = signalBoost * confFactor;
                  console.log(`  \u{1F4C4} PDF weight factors: base=${baseWeight.toFixed(2)} signal=${signalBoost.toFixed(2)} conf=${confFactor.toFixed(2)} adjustedSignal=${adjustedSignalBoost.toFixed(2)} quality=${quality}`);
                  const weight = baseWeight + adjustedSignalBoost + quality * 0.25;
                  const hostPrefix = hostHint === "passeidireto.com" ? "passeidireto" : "studocu";
                  const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                  const evidenceBlock = EvidenceService.buildEvidenceBlock({
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
                    title,
                    link,
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
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    decision: "use-pdf-signal",
                    method,
                    letter: extracted.letter
                  });
                  const {
                    bestLetter: bestLetter2,
                    votes: votes2
                  } = EvidenceService.computeVotesAndState(sources);
                  if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                    console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                    console.groupEnd();
                    break;
                  }
                  console.groupEnd();
                  continue;
                }
              }
              if (hasOptions && !optionsMatchBase) {
                console.log(`  [BLOCKED] options-mismatch-post-structured (topicSim=${topicSimBase.toFixed(3)})`);
                runStats.blockedOptionsMismatch += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: false,
                  obfuscation,
                  paywall,
                  decision: "skip",
                  reason: "options-mismatch-post-structured"
                });
                console.groupEnd();
                continue;
              }
              const localResult = EvidenceService.extractAnswerLocally(combinedText, questionForInference, originalOptions);
              console.log(`  \u{1F4DD} Local extraction: letter=${localResult?.letter || "none"} type=${localResult?.evidenceType || "none"} confidence=${localResult?.confidence || 0}`);
              if (localResult?.letter && topicSimBase < 0.5) {
                console.log(`  \u26D4 Gabarito REJECTED: topicSim=${topicSimBase.toFixed(3)} < 0.50 \u2014 likely wrong question in compilado`);
                localResult.letter = null;
              }
              if (localResult?.letter) {
                console.log(`  \u{1F500} Local pre-remap letter: ${localResult.letter}`);
                localResult.letter = this._remapLetterIfShuffled(localResult.letter, scopedCombinedText, originalOptionsMap);
                console.log(`  \u{1F500} Local post-remap letter: ${localResult.letter}`);
                const baseWeight = getDomainWeight(link);
                const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                let weight = baseWeight + 2.6 + quality * 0.4;
                if (topicSimBase < 0.7) {
                  weight *= topicSimBase;
                  console.log(`  \u26A0\uFE0F Gabarito weight reduced: topicSim=${topicSimBase.toFixed(3)} \u2192 weight=${weight.toFixed(2)}`);
                }
                const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                const evidenceBlock = EvidenceService.buildEvidenceBlock({
                  questionFingerprint,
                  sourceId,
                  sourceLink: link,
                  hostHint,
                  evidenceText: localResult.evidence || scopedCombinedText,
                  originalOptionsMap,
                  explicitLetter: localResult.letter,
                  confidenceLocal: localResult.confidence || 0.84,
                  evidenceType: localResult.evidenceType || "explicit-gabarito"
                });
                sources.push({
                  title,
                  link,
                  letter: localResult.letter,
                  weight,
                  evidenceType: localResult.evidenceType || "explicit-gabarito",
                  questionPolarity,
                  matchQuality: quality,
                  blockMethod: localResult.blockMethod,
                  hostHint,
                  sourceId,
                  evidenceBlock
                });
                runStats.acceptedForVotes += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "use-local",
                  method: localResult.evidenceType || "explicit-gabarito",
                  letter: localResult.letter
                });
                const {
                  bestLetter: bestLetter2,
                  votes: votes2
                } = EvidenceService.computeVotesAndState(sources);
                if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                  console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                  console.groupEnd();
                  break;
                }
                console.groupEnd();
                continue;
              }
              extracted = EvidenceService.extractExplicitLetterFromText(combinedText, questionStem, originalOptions);
              console.log(`  \u{1F524} Explicit letter: letter=${extracted?.letter || "none"} confidence=${extracted?.confidence || 0}`);
              if (extracted?.letter) {
                console.log(`  \u{1F500} Explicit pre-remap letter: ${extracted.letter}`);
                extracted.letter = this._remapLetterIfShuffled(extracted.letter, scopedCombinedText, originalOptionsMap);
                console.log(`  \u{1F500} Explicit post-remap letter: ${extracted.letter}`);
                const baseWeight = getDomainWeight(link);
                const weight = baseWeight + 2;
                const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                const evidenceBlock = EvidenceService.buildEvidenceBlock({
                  questionFingerprint,
                  sourceId,
                  sourceLink: link,
                  hostHint,
                  evidenceText: extracted.evidence || scopedCombinedText,
                  originalOptionsMap,
                  explicitLetter: extracted.letter,
                  confidenceLocal: extracted.confidence || 0.8,
                  evidenceType: "explicit-gabarito-simple"
                });
                sources.push({
                  title,
                  link,
                  letter: extracted.letter,
                  weight,
                  evidenceType: "explicit-gabarito-simple",
                  questionPolarity,
                  hostHint,
                  sourceId,
                  evidenceBlock
                });
                runStats.acceptedForVotes += 1;
                this._logSourceDiagnostic({
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "use-explicit-simple",
                  method: "explicit-gabarito-simple",
                  letter: extracted.letter
                });
                const {
                  bestLetter: bestLetter2,
                  votes: votes2
                } = EvidenceService.computeVotesAndState(sources);
                if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                  console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                  console.groupEnd();
                  break;
                }
                console.groupEnd();
                continue;
              }
              if (aiExtractionCount < 3 && topicSimBase >= 0.35 && !obfuscation?.isObfuscated && scopedCombinedText.length >= 250) {
                const aiScopedText = EvidenceService.buildQuestionScopedText(combinedText, questionForInference, 6e3);
                console.log(`  \u{1F916} [AI-EXTRACT] Attempting AI page extraction (call ${aiExtractionCount + 1}/3, topicSim=${topicSimBase.toFixed(3)}, textLen=${aiScopedText.length}, host=${hostHint})`);
                if (typeof onStatus === "function") {
                  onStatus(`AI analyzing ${hostHint || "source"} (${runStats.analyzed}/${topResults.length})...`);
                }
                const _aiPageCached = SearchCacheService.getCachedAiResult(link, questionForInference);
                let aiExtracted;
                if (_aiPageCached) {
                  console.log(`  \u{1F916} [AI-EXTRACT] \u{1F4E6} Cache hit for ${hostHint} \u2014 skipping LLM call`);
                  aiExtracted = _aiPageCached;
                } else {
                  aiExtracted = await ApiService.aiExtractFromPage(aiScopedText, questionForInference, hostHint);
                  if (aiExtracted) SearchCacheService.setCachedAiResult(link, questionForInference, aiExtracted);
                }
                aiExtractionCount++;
                if (aiExtracted?.knowledge) {
                  aiKnowledgePool.push({
                    host: hostHint,
                    knowledge: aiExtracted.knowledge,
                    topicSim: topicSimBase,
                    link,
                    title
                  });
                  console.log(`  \u{1F916} [AI-EXTRACT] Knowledge collected from ${hostHint} (${aiExtracted.knowledge.length} chars, pool size=${aiKnowledgePool.length})`);
                }
                if (aiExtracted?.letter && aiExtracted?.evidence && originalOptionsMap) {
                  const evNorm = QuestionParser.normalizeOption(aiExtracted.evidence);
                  const claimedBody = QuestionParser.normalizeOption(originalOptionsMap[aiExtracted.letter] || "");
                  const claimedTokens = claimedBody.split(/\s+/).filter((t) => t.length >= 4);
                  const claimedHits = claimedTokens.filter((t) => evNorm.includes(t)).length;
                  const claimedRatio = claimedTokens.length > 0 ? claimedHits / claimedTokens.length : 1;
                  const stemTokens = QuestionParser.extractKeyTokens(questionStem);
                  const stemHits = stemTokens.filter((t) => evNorm.includes(t)).length;
                  const stemRatio = stemTokens.length > 0 ? stemHits / stemTokens.length : 1;
                  console.log(`  \u{1F916} [AI-EXTRACT] Cross-Q check: claimedHits=${claimedHits}/${claimedTokens.length} (${claimedRatio.toFixed(2)}) stemHits=${stemHits}/${stemTokens.length} (${stemRatio.toFixed(2)})`);
                  if (claimedRatio < 0.38 && stemRatio < 0.25 || claimedRatio < 0.15) {
                    console.log(`  \u{1F916} [AI-EXTRACT] \u274C Cross-question REJECTED: evidence relates to a different question on the page (claimRatio < 0.38 & stemRatio < 0.25, or claimRatio < 0.15)`);
                    console.log(`  \u{1F916} [AI-EXTRACT] Keeping knowledge but discarding letter ${aiExtracted.letter}`);
                    aiExtracted.letter = null;
                    if (aiExtracted.knowledge) {
                      aiExtracted.knowledge = aiExtracted.knowledge.replace(/^RESULTADO:\s*ENCONTRADO\s*$/gim, "").replace(/^Letra\s+[A-E]\b.*$/gim, "").trim();
                    }
                  }
                }
                if (aiExtracted?.letter) {
                  console.log(`  \u{1F916} [AI-EXTRACT] Letter found: ${aiExtracted.letter} (pre-remap)`);
                  aiExtracted.letter = this._remapLetterIfShuffled(aiExtracted.letter, scopedCombinedText, originalOptionsMap);
                  console.log(`  \u{1F916} [AI-EXTRACT] Post-remap letter: ${aiExtracted.letter}`);
                  if (originalOptionsMap && aiExtracted.letter && !originalOptionsMap[aiExtracted.letter]) {
                    console.log(`  \u{1F916} [AI-EXTRACT] \u274C Letter ${aiExtracted.letter} not in options map [${Object.keys(originalOptionsMap).join(",")}] \u2014 discarding`);
                    aiExtracted.letter = null;
                  }
                  const baseWeight = getDomainWeight(link);
                  const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
                  const riskyMismatchPenalty = riskyCombinedHosts.has(hostHint) && !optionsMatchBase ? 0.4 : 0;
                  const weight = baseWeight + 0.85 + quality * 0.35 - riskyMismatchPenalty;
                  const sourceId = `${hostHint || "source"}:${sources.length + 1}`;
                  const evidenceBlock = EvidenceService.buildEvidenceBlock({
                    questionFingerprint,
                    sourceId,
                    sourceLink: link,
                    hostHint,
                    evidenceText: aiExtracted.evidence || scopedCombinedText,
                    originalOptionsMap,
                    explicitLetter: aiExtracted.letter,
                    confidenceLocal: aiExtracted.confidence || 0.82,
                    evidenceType: "ai-page-extraction"
                  });
                  sources.push({
                    title,
                    link,
                    letter: aiExtracted.letter,
                    weight,
                    evidenceType: "ai-page-extraction",
                    questionPolarity,
                    matchQuality: quality,
                    hostHint,
                    sourceId,
                    evidenceBlock
                  });
                  runStats.acceptedViaAiExtraction += 1;
                  runStats.acceptedForVotes += 1;
                  this._logSourceDiagnostic({
                    phase: "decision",
                    hostHint,
                    type: sourceType,
                    topicSim: topicSimBase,
                    optionsMatch: optionsMatchBase,
                    obfuscation,
                    decision: "use-ai-extraction",
                    method: "ai-page-extraction",
                    letter: aiExtracted.letter
                  });
                  console.log(`  \u2705 ACCEPTED via AI page extraction: letter=${aiExtracted.letter} weight=${weight.toFixed(2)}`);
                  const {
                    bestLetter: bestLetter2,
                    votes: votes2
                  } = EvidenceService.computeVotesAndState(sources);
                  if (bestLetter2 && (votes2[bestLetter2] || 0) >= 6.5) {
                    console.log(`  \u{1F3C1} Early exit: votes[${bestLetter2}]=${votes2[bestLetter2]}`);
                    console.groupEnd();
                    break;
                  }
                  console.groupEnd();
                  continue;
                } else {
                  console.log(`  \u{1F916} [AI-EXTRACT] No letter found for ${hostHint} \u2014 knowledge ${aiExtracted?.knowledge ? "saved" : "empty"}`);
                }
              }
              console.log(`  \u2139\uFE0F No direct evidence found \u2014 collecting for AI combined`);
              const clipped = scopedCombinedText.slice(0, 4e3);
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
                  phase: "decision",
                  hostHint,
                  type: sourceType,
                  topicSim,
                  optionsMatch: optionsMatchBase,
                  obfuscation,
                  decision: "ai-evidence"
                });
              }
              console.groupEnd();
            } catch (error) {
              console.error("SearchService Error:", error);
              console.groupEnd();
              runStats.blockedByError += 1;
            }
          }
          if (sources.length === 0 && hasOptions) {
            console.group("\u{1F4CB} Snippet-level gabarito extraction");
            for (const result of topResults) {
              const snipText = `${result.title || ""}. ${result.snippet || ""}`.trim();
              if (snipText.length < 60) continue;
              const snipSim = QuestionParser.questionSimilarityScore(snipText, questionStem);
              if (snipSim < 0.4) continue;
              const snipCoverage = OptionsMatchService.optionsCoverageInFreeText(originalOptions, snipText);
              if (!snipCoverage.hasEnoughOptions || snipCoverage.ratio < 0.5) continue;
              const gabarito = EvidenceService.extractExplicitGabarito(snipText, questionStem);
              if (gabarito?.letter) {
                const hostHint = this._getHostHintFromLink(result.link);
                const letter = gabarito.letter.toUpperCase();
                const baseWeight = getDomainWeight(result.link);
                const weight = baseWeight + 1.6;
                const sourceId = `snippet-gabarito:${sources.length + 1}`;
                const evidenceBlock = EvidenceService.buildEvidenceBlock({
                  questionFingerprint,
                  sourceId,
                  sourceLink: result.link,
                  hostHint,
                  evidenceText: snipText,
                  originalOptionsMap,
                  explicitLetter: letter,
                  confidenceLocal: gabarito.confidence || 0.85,
                  evidenceType: "snippet-gabarito"
                });
                sources.push({
                  title: result.title || "",
                  link: result.link,
                  letter,
                  weight,
                  evidenceType: "snippet-gabarito",
                  questionPolarity,
                  matchQuality: 7,
                  hostHint,
                  sourceId,
                  evidenceBlock
                });
                runStats.acceptedForVotes += 1;
                console.log(`  \u2705 Snippet gabarito: letter=${letter} host=${hostHint} sim=${snipSim.toFixed(2)} coverage=${snipCoverage.hits}/${snipCoverage.total} weight=${weight.toFixed(2)}`);
              }
            }
            console.log(`  Snippet gabarito sources added: ${sources.filter((s) => s.evidenceType === "snippet-gabarito").length}`);
            console.groupEnd();
          }
          const totalBlocked = runStats.blockedSnapshotMismatch + runStats.blockedByError + runStats.blockedOptionsMismatch + runStats.blockedObfuscation;
          const failRate = runStats.analyzed > 0 ? totalBlocked / runStats.analyzed : 0;
          const snippetEvidence = [];
          if (sources.length === 0 && failRate >= 0.7 && topResults.length > 0) {
            for (const result of topResults) {
              const snipText = `${result.title || ""}. ${result.snippet || ""}`.trim();
              if (snipText.length < 80) continue;
              const snipSim = QuestionParser.questionSimilarityScore(snipText, questionStem);
              if (snipSim < 0.2) continue;
              const snipCoverage = hasOptions ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, snipText) : {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: false
              };
              const snipStrongCoverage = !hasOptions || snipCoverage.ratio >= 0.6 || snipCoverage.hits >= Math.min(3, snipCoverage.total || 3);
              if (hasOptions && (!snipStrongCoverage || snipSim < 0.32)) continue;
              snippetEvidence.push({
                title: result.title || "",
                link: result.link || "",
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
          const allForCombined = [...aiEvidence.map((e) => ({
            ...e,
            origin: "aiEvidence"
          })), ...collectedForCombined.map((e) => ({
            ...e,
            origin: "mismatch"
          })), ...snippetEvidence.map((e) => ({
            ...e,
            origin: "snippet"
          }))].sort((a, b) => (b.topicSim || 0) - (a.topicSim || 0));
          console.group("\u{1F9E0} AI Combined Evidence Pool");
          console.log(`Direct sources found: ${sources.length}`);
          console.log(`AI evidence pool: ${aiEvidence.length} | Mismatch pool: ${collectedForCombined.length} | Snippet pool: ${snippetEvidence.length}`);
          console.log(`AI knowledge pool: ${aiKnowledgePool.length} entries`);
          if (aiKnowledgePool.length > 0) {
            aiKnowledgePool.forEach((k, i) => {
              console.log(`  \u{1F4DA} [${i}] host=${k.host} topicSim=${(k.topicSim || 0).toFixed(3)} knowledge=${(k.knowledge || "").length} chars origin=${k.origin || "direct"}`);
            });
          }
          console.log(`Total for combined: ${allForCombined.length}`);
          allForCombined.forEach((e, i) => {
            console.log(`  [${i}] origin=${e.origin} host=${e.hostHint} topicSim=${(e.topicSim || 0).toFixed(3)} optMatch=${e.optionsMatch} coverage=${JSON.stringify(e.optionsCoverage)} textLen=${(e.text || "").length}`);
          });
          console.groupEnd();
          const hasStrongExplicit = sources.some((s) => (s.weight || 0) >= 5);
          if (allForCombined.length > 0 && (!hasStrongExplicit || sources.length < 2)) {
            if (typeof onStatus === "function") {
              onStatus(sources.length === 0 ? "No explicit answer found. Using AI best-effort..." : "Cross-checking with additional sources...");
            }
            const minTopicSim = hasOptions ? 0.22 : 0.15;
            let relevant = allForCombined.filter((e) => {
              const topicSim = e.topicSim || 0;
              if (topicSim < minTopicSim) {
                console.log(`    \u274C Filtered (low topicSim ${topicSim.toFixed(3)} < ${minTopicSim}): ${e.hostHint}`);
                return false;
              }
              if (!hasOptions) return true;
              const origin = String(e.origin || "").toLowerCase();
              const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              const strongCoverage = e.optionsMatch === true || hasStrongOptionCoverage(coverage);
              if (origin === "aievidence" && riskyCombinedHosts.has(host)) {
                if (!strongCoverage) {
                  console.log(`    \u274C Risky aiEvidence rejected (weak coverage): host=${host} topicSim=${topicSim.toFixed(2)} coverage=${coverage.hits}/${coverage.total}`);
                  return false;
                }
              }
              if (origin === "snippet") {
                if (!strongCoverage) return false;
                if (topicSim < 0.3) return false;
              }
              if (strongCoverage) return true;
              if (origin === "mismatch" && topicSim >= 0.62 && (e.text || "").length >= 500 && hasMediumOptionCoverage(coverage) && !riskyCombinedHosts.has(host) && !e.obfuscated && !e.paywalled && isTrustedCombinedHost(host)) {
                console.log(`    \u2705 Cross-question evidence ADMITTED: host=${host} topicSim=${topicSim.toFixed(2)} textLen=${(e.text || "").length}`);
                console.log(`SearchService: Cross-question evidence admitted for AI combined: host=${host} topicSim=${topicSim.toFixed(2)} textLen=${(e.text || "").length}`);
                return true;
              } else if (origin === "mismatch") {
                console.log(`    \u274C Cross-question REJECTED: host=${host} topicSim=${topicSim.toFixed(2)} len=${(e.text || "").length}`);
              }
              if (riskyCombinedHosts.has(host) || e.obfuscated || e.paywalled) return false;
              const mediumCoverage = hasMediumOptionCoverage(coverage);
              return mediumCoverage && topicSim >= 0.45;
            }).slice(0, 5);
            const hasReliableOptionAlignedSource = !hasOptions || relevant.some((e) => {
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              return e.optionsMatch === true || hasStrongOptionCoverage(coverage);
            });
            const hasAnyOptionAlignedSource = !hasOptions || relevant.some((e) => {
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              return e.optionsMatch === true || hasMediumOptionCoverage(coverage);
            });
            const hasTrustedRelevantSource = relevant.some((e) => {
              const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
              return isTrustedCombinedHost(host);
            });
            const hasVeryStrongAlignedSource = !hasOptions || relevant.some((e) => {
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              return hasVeryStrongOptionCoverage(coverage);
            });
            const minRelevantSources = hasOptions && !hasStrongExplicit ? 2 : 1;
            console.group("\u{1F916} AI Combined Decision");
            console.log(`Relevant sources after filtering: ${relevant.length}`);
            relevant.forEach((e, i) => {
              console.log(`  [${i}] origin=${e.origin} host=${e.hostHint} topicSim=${(e.topicSim || 0).toFixed(3)} optMatch=${e.optionsMatch} textLen=${(e.text || "").length}`);
            });
            console.log(`desperateMode=false | hasStrongExplicit=${hasStrongExplicit} | hasReliableOptionAligned=${hasReliableOptionAlignedSource} | minRelevantSources=${minRelevantSources}`);
            if (hasOptions && !hasReliableOptionAlignedSource && relevant.length < minRelevantSources) {
              console.log(`\u26D4 AI combined SKIPPED: weak option alignment (relevant=${relevant.length}, reliable=${hasReliableOptionAlignedSource})`);
              console.log(`SearchService: AI combined skipped - weak option alignment (relevant=${relevant.length}, reliable=${hasReliableOptionAlignedSource})`);
              return [];
            }
            const strongRelevant = relevant.filter((e) => {
              const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              const strongCoverage = !hasOptions || e.optionsMatch === true || hasStrongOptionCoverage(coverage);
              return strongCoverage && (e.topicSim || 0) >= (hasOptions ? 0.45 : 0.3) && !riskyCombinedHosts.has(host) && isTrustedCombinedHost(host) && !e.obfuscated && !e.paywalled;
            });
            const strongRelevantDomainCount = new Set(strongRelevant.map((e) => String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase()).filter(Boolean)).size;
            const hasEliteAnchoredEvidence = relevant.some((e) => {
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              const strongCoverage = !hasOptions || e.optionsMatch === true || hasStrongOptionCoverage(coverage);
              return String(e.origin || "") === "aiEvidence" && strongCoverage && (e.topicSim || 0) >= 0.78 && (e.text || "").length >= 1800 && !e.obfuscated && !e.paywalled;
            });
            const corroboratingSnippetCount = relevant.filter((e) => {
              if (String(e.origin || "") !== "snippet") return false;
              const coverage = e.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: true
              };
              return hasStrongOptionCoverage(coverage) && (e.topicSim || 0) >= 0.3;
            }).length;
            const canProceedAISynthesisOnly = sources.length === 0 && hasOptions && (strongRelevant.length >= 3 && strongRelevantDomainCount >= 2 && hasVeryStrongAlignedSource || hasEliteAnchoredEvidence && hasReliableOptionAlignedSource && relevant.length >= 2 && corroboratingSnippetCount >= 1 || // Path 3: high topic-similarity source provides strong anchor
            // even without corroborating snippets.
            hasReliableOptionAlignedSource && relevant.length >= 2 && relevant.some((e) => (e.topicSim || 0) >= 0.55) && relevant.filter((e) => (e.topicSim || 0) >= 0.4 && e.optionsMatch).length >= 2);
            const canProceedAI = relevant.length > 0 && sources.length > 0 && (!hasOptions || hasReliableOptionAlignedSource && relevant.length >= minRelevantSources) || canProceedAISynthesisOnly;
            console.log(`canProceedAI=${canProceedAI}`);
            if (canProceedAISynthesisOnly) {
              console.log(`\u2705 AI synthesis-only mode enabled: strongRelevant=${strongRelevant.length}, domainDiversity=${strongRelevantDomainCount}`);
              console.log(`   anchorMode=${hasEliteAnchoredEvidence} corroboratingSnippets=${corroboratingSnippetCount}`);
            }
            if (!canProceedAI) {
              console.log("\u274C AI combined will NOT run");
              console.groupEnd();
            }
            if (canProceedAI) {
              const merged = relevant.map((e, i) => `SOURCE ${i + 1}: ${e.title}
${e.text}
LINK: ${e.link}`).join("\n\n");
              const knowledgePromise = Promise.resolve(null);
              try {
                const [aiAnswer, knowledgeAnswer] = await Promise.all([ApiService.inferAnswerFromEvidence(questionForInference, merged), knowledgePromise]);
                let aiLetter = this._parseAnswerLetter(aiAnswer);
                let aiWeightUsed = null;
                if (!aiLetter && aiAnswer && originalOptionsMap) {
                  aiLetter = OptionsMatchService.findLetterByAnswerText(aiAnswer, originalOptionsMap);
                  if (aiLetter) console.log(`SearchService: AI combined letter recovered via text match => ${aiLetter}`);
                }
                if (aiLetter) {
                  if (canProceedAISynthesisOnly && hasOptions && originalOptionsMap) {
                    const evidenceCorpus = QuestionParser.normalizeOption(relevant.map((e) => String(e.text || "").slice(0, 2200)).join(" "));
                    const optionEntries = Object.entries(originalOptionsMap).filter(([letter]) => /^[A-E]$/.test(String(letter || "").toUpperCase())).map(([letter, text]) => {
                      const norm = QuestionParser.normalizeOption(String(text || ""));
                      const tokens = norm.split(/\s+/).filter((token) => token.length >= 4);
                      const hits = tokens.reduce((count, token) => count + (evidenceCorpus.includes(token) ? 1 : 0), 0);
                      const tokenRatio = tokens.length > 0 ? hits / tokens.length : 0;
                      const dice = norm ? QuestionParser.diceSimilarity(evidenceCorpus, norm) : 0;
                      const score = tokenRatio * 0.7 + dice * 0.3;
                      return {
                        letter: String(letter).toUpperCase(),
                        score,
                        tokenRatio,
                        dice,
                        hits,
                        tokenCount: tokens.length
                      };
                    }).sort((a, b) => b.score - a.score);
                    const topOption = optionEntries[0] || null;
                    const secondOption = optionEntries[1] || null;
                    const selected = optionEntries.find((entry) => entry.letter === String(aiLetter).toUpperCase()) || null;
                    const supportMinScore = 0.22;
                    const supportMinTokenRatio = 0.38;
                    const supportMargin = topOption && secondOption ? topOption.score - secondOption.score : 1;
                    const effectiveMarginThreshold = selected && selected.score >= 0.4 ? 0.25 : selected && selected.score >= 0.3 ? 0.12 : 0.03;
                    const selectedSupported = !!selected && selected.score >= supportMinScore && selected.tokenRatio >= supportMinTokenRatio && (!topOption || topOption.letter === selected.letter || supportMargin < effectiveMarginThreshold);
                    console.log(`SearchService: AI synthesis support check => selected=${selected?.letter || "none"} score=${(selected?.score || 0).toFixed(3)} tokenRatio=${(selected?.tokenRatio || 0).toFixed(3)} top=${topOption?.letter || "none"} topScore=${(topOption?.score || 0).toFixed(3)} margin=${supportMargin.toFixed(3)}`);
                    if (!selectedSupported) {
                      console.log(`\u26D4 AI combined letter rejected by evidence-support guard (selected=${aiLetter}, top=${topOption?.letter || "none"})`);
                      aiLetter = null;
                    }
                  }
                }
                if (aiLetter) {
                  const allCrossQuestion = relevant.every((e) => String(e.origin || "") === "mismatch" || e.optionsMatch === false);
                  const aiWeight = hasStrongExplicit ? 0.3 : canProceedAISynthesisOnly ? 0.35 : allCrossQuestion ? 0.2 : 0.45;
                  aiWeightUsed = aiWeight;
                  console.log(`  AI combined result: letter=${aiLetter} allCrossQuestion=${allCrossQuestion} weight=${aiWeight}`);
                  const sourceId = `ai-combined:${sources.length + 1}`;
                  const evidenceBlock = EvidenceService.buildEvidenceBlock({
                    questionFingerprint,
                    sourceId,
                    sourceLink: "",
                    hostHint: "ai",
                    evidenceText: aiAnswer || merged,
                    originalOptionsMap,
                    explicitLetter: aiLetter,
                    confidenceLocal: hasStrongExplicit ? 0.42 : 0.5,
                    evidenceType: "ai-combined"
                  });
                  sources.push({
                    title: "AI (combined evidence)",
                    link: "",
                    letter: aiLetter,
                    weight: aiWeight,
                    evidenceType: "ai-combined",
                    questionPolarity,
                    hostHint: "ai",
                    sourceId,
                    evidenceBlock
                  });
                  runStats.acceptedForVotes += 1;
                  console.log(`SearchService: AI combined => Letra ${aiLetter}, weight=${aiWeight}`);
                }
                if (knowledgeAnswer) {
                  let knLetter = this._parseAnswerLetter(knowledgeAnswer);
                  if (!knLetter && originalOptionsMap) {
                    knLetter = OptionsMatchService.findLetterByAnswerText(knowledgeAnswer, originalOptionsMap);
                    if (knLetter) console.log(`SearchService: AI knowledge letter recovered via text match => ${knLetter}`);
                  }
                  if (knLetter) {
                    const knWeight = 0.55;
                    const knSourceId = `ai-knowledge:${sources.length + 1}`;
                    const knEvidenceBlock = EvidenceService.buildEvidenceBlock({
                      questionFingerprint,
                      sourceId: knSourceId,
                      sourceLink: "",
                      hostHint: "ai",
                      evidenceText: knowledgeAnswer || "",
                      originalOptionsMap,
                      explicitLetter: knLetter,
                      confidenceLocal: 0.6,
                      evidenceType: "ai-knowledge"
                    });
                    sources.push({
                      title: "AI (knowledge-based)",
                      link: "",
                      letter: knLetter,
                      weight: knWeight,
                      evidenceType: "ai-knowledge",
                      questionPolarity,
                      hostHint: "ai",
                      sourceId: knSourceId,
                      evidenceBlock: knEvidenceBlock
                    });
                    runStats.acceptedForVotes += 1;
                    console.log(`SearchService: AI knowledge => Letra ${knLetter}, weight=${knWeight}`);
                    if (aiLetter && knLetter !== aiLetter) {
                      console.warn(`SearchService: CONFLICT evidence=${aiLetter} vs knowledge=${knLetter} \u2014 knowledge (${knWeight}) overrides evidence (${aiWeightUsed ?? "n/a"})`);
                    }
                  }
                }
                console.groupEnd();
              } catch (error) {
                console.warn("AI evidence inference failed:", error);
                console.groupEnd();
              }
            }
          }
          if (pageGabarito) {
            const pgLetter = (pageGabarito || "").toUpperCase().trim();
            if (/^[A-E]$/.test(pgLetter)) {
              const sourceId = `page-gabarito:${sources.length + 1}`;
              const evidenceBlock = EvidenceService.buildEvidenceBlock({
                questionFingerprint,
                sourceId,
                sourceLink: "",
                hostHint: "page",
                evidenceText: String(pageGabarito || ""),
                originalOptionsMap,
                explicitLetter: pgLetter,
                confidenceLocal: 0.9,
                evidenceType: "page-gabarito"
              });
              sources.push({
                title: "Page Gabarito",
                link: "",
                letter: pgLetter,
                weight: 5,
                evidenceType: "page-gabarito",
                questionPolarity,
                hostHint: "page",
                sourceId,
                evidenceBlock
              });
              runStats.acceptedForVotes += 1;
            }
          }
          if (sources.length === 0 && aiKnowledgePool.length > 0 && hasOptions) {
            console.group("\u{1F9E0} AI Combined Reflection Fallback");
            console.log(`No voting sources. Knowledge pool has ${aiKnowledgePool.length} entries from AI extraction.`);
            aiKnowledgePool.forEach((k, i) => {
              console.log(`  [${i}] host=${k.host} topicSim=${(k.topicSim || 0).toFixed(3)} knowledge=${(k.knowledge || "").length} chars origin=${k.origin || "direct"}`);
            });
            if (typeof onStatus === "function") {
              onStatus("Reflecting on accumulated knowledge...");
            }
            try {
              const reflectionResult = await ApiService.aiReflectOnSources(questionForInference, aiKnowledgePool);
              if (reflectionResult?.letter) {
                let reflectLetter = reflectionResult.letter.toUpperCase();
                if (/^[A-E]$/.test(reflectLetter)) {
                  reflectLetter = this._remapLetterIfShuffled(reflectLetter, "", originalOptionsMap);
                  console.log(`  \u{1F9E0} [REFLECTION] Letter found: ${reflectLetter}`);
                  const reflectWeight = 1.2;
                  const sourceId = `ai-reflection:${sources.length + 1}`;
                  const evidenceBlock = EvidenceService.buildEvidenceBlock({
                    questionFingerprint,
                    sourceId,
                    sourceLink: "",
                    hostHint: "ai-reflection",
                    evidenceText: reflectionResult.response || "",
                    originalOptionsMap,
                    explicitLetter: reflectLetter,
                    confidenceLocal: 0.55,
                    evidenceType: "ai-combined-reflection"
                  });
                  sources.push({
                    title: "AI (combined reflection)",
                    link: "",
                    letter: reflectLetter,
                    weight: reflectWeight,
                    evidenceType: "ai-combined-reflection",
                    questionPolarity,
                    hostHint: "ai-reflection",
                    sourceId,
                    evidenceBlock
                  });
                  runStats.acceptedForVotes += 1;
                  console.log(`  \u2705 AI reflection accepted: letter=${reflectLetter} weight=${reflectWeight}`);
                } else {
                  console.log(`  \u274C AI reflection returned invalid letter: "${reflectionResult.letter}"`);
                }
              } else {
                console.log(`  \u274C AI reflection returned no letter (INCONCLUSIVO)`);
              }
            } catch (e) {
              console.warn(`  \u{1F9E0} AI reflection error:`, e?.message || e);
            }
            console.groupEnd();
          } else if (sources.length === 0 && aiKnowledgePool.length === 0) {
            console.log("\u{1F9E0} No knowledge pool accumulated \u2014 reflection fallback skipped");
          }
          if (sources.length === 0) {
            logRunSummary("no-sources");
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
          } = EvidenceService.computeVotesAndState(sources);
          console.group("\u{1F3F3}\uFE0F Final Voting Breakdown");
          console.log("All sources:");
          sources.forEach((s, i) => {
            console.log(`  [${i}] host=${s.hostHint} letter=${s.letter} weight=${s.weight?.toFixed?.(2) || s.weight} type=${s.evidenceType} method=${s.extractionMethod || "n/a"}`);
          });
          console.log("Votes:", JSON.stringify(votes));
          console.log("Base votes:", JSON.stringify(baseVotes));
          console.log("Evidence votes:", JSON.stringify(evidenceVotes));
          console.log(`Best letter: ${bestLetter} | State: ${resultState} | Confidence: ${confidence} | Reason: ${reason}`);
          console.log("Evidence consensus:", JSON.stringify(evidenceConsensus));
          console.groupEnd();
          let answerText = "";
          if (bestLetter && originalOptionsMap[bestLetter]) {
            answerText = originalOptionsMap[bestLetter];
          }
          const answer = bestLetter ? `Letra ${bestLetter}: ${answerText}`.trim() : (sources[0]?.answer || "").trim();
          const isAiOnly = sources.every((s) => s.evidenceType === "ai" || s.evidenceType === "ai-combined");
          const hasExplicitEvidence = sources.some((s) => s.evidenceType && s.evidenceType !== "ai" && s.evidenceType !== "ai-combined");
          let evidenceTier = "EVIDENCE_WEAK";
          if (isAiOnly) {
            evidenceTier = "AI_ONLY";
          } else if (resultState === "confirmed") {
            evidenceTier = "EVIDENCE_STRONG";
          } else if (hasExplicitEvidence && (evidenceConsensus?.bestEvidenceCount || 0) >= 1) {
            evidenceTier = "EVIDENCE_MEDIUM";
          }
          let overview = null;
          try {
            const overviewCandidates = [];
            const seenOverviewKeys = /* @__PURE__ */ new Set();
            const pushOverviewCandidate = (candidate) => {
              const title = String(candidate?.title || "").trim();
              const link = String(candidate?.link || "").trim();
              const text = String(candidate?.text || "").trim();
              if (text.length < 120) return;
              const key = `${title}|${link}`.slice(0, 500);
              if (seenOverviewKeys.has(key)) return;
              seenOverviewKeys.add(key);
              overviewCandidates.push({
                title,
                link,
                text
              });
            };
            for (const source of sources) {
              if (!source || source.evidenceType === "ai" || source.evidenceType === "ai-combined") continue;
              const text = source?.evidence || source?.evidenceBlock?.evidenceText || "";
              pushOverviewCandidate({
                title: source.title,
                link: source.link,
                text
              });
            }
            for (const evidence of allForCombined) {
              if (!evidence) continue;
              const coverage = evidence.optionsCoverage || {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: false
              };
              const alignedEnough = !hasOptions || evidence.optionsMatch === true || hasMediumOptionCoverage(coverage);
              if (!alignedEnough) continue;
              if ((evidence.topicSim || 0) < 0.28) continue;
              pushOverviewCandidate({
                title: evidence.title,
                link: evidence.link,
                text: evidence.text
              });
            }
            if (overviewCandidates.length >= 2) {
              overview = await ApiService.generateOverviewFromEvidence(questionForInference, overviewCandidates.slice(0, 6));
            }
          } catch (error) {
            console.warn("SearchService: failed to build overview payload:", error?.message || String(error));
          }
          const finalPayload = [{
            question: questionText,
            answer,
            answerLetter: bestLetter,
            answerText,
            optionsMap: originalOptionsMap && Object.keys(originalOptionsMap).length >= 2 ? {
              ...originalOptionsMap
            } : null,
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
            title: sources[0]?.title || "Result",
            aiFallback: isAiOnly,
            questionFingerprint,
            runStats,
            googleMetaSignals,
            overview
          }];
          logRunSummary(resultState);
          return finalPayload;
        },
        async searchAndRefine(questionText, originalQuestionWithOptions = "", onStatus = null) {
          const questionForInference = originalQuestionWithOptions || questionText;
          const questionFingerprint = await this._canonicalHash(questionForInference);
          const buildInconclusiveNoEvidence = (reason) => [{
            question: questionText,
            answer: "INCONCLUSIVO: sem evid\xEAncia externa confi\xE1vel para marcar alternativa.",
            answerLetter: null,
            answerText: "Sem evid\xEAncia externa confi\xE1vel para marcar alternativa.",
            aiFallback: false,
            evidenceTier: "EVIDENCE_WEAK",
            resultState: "inconclusive",
            reason,
            confidence: 0.12,
            votes: void 0,
            sources: []
          }];
          const cachedDecision = await this._getCachedDecisionForFingerprint(questionFingerprint);
          const cachedResult = cachedDecision ? this._buildResultFromCachedDecision(questionText, questionForInference, cachedDecision) : null;
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
                outcome: "cache-fallback-no-search-results",
                resultState: cachedItem.resultState || "confirmed",
                evidenceTier: cachedItem.evidenceTier || "EVIDENCE_STRONG",
                runStats: null,
                bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || "",
                confidence: Number(cachedItem.confidence || 0.9)
              });
              return cachedResult;
            }
            const inconclusive = buildInconclusiveNoEvidence("no_search_results");
            const inconclusiveItem = inconclusive[0] || {};
            await this._recordSearchMetrics({
              cacheHit: false,
              outcome: "no-search-results",
              resultState: inconclusiveItem.resultState || "inconclusive",
              evidenceTier: inconclusiveItem.evidenceTier || "EVIDENCE_WEAK",
              runStats: null,
              bestLetter: "",
              confidence: Number(inconclusiveItem.confidence || 0.12)
            });
            return inconclusive;
          }
          const refined = await this.refineFromResults(questionText, mergedResults, originalQuestionWithOptions);
          if (!refined || refined.length === 0) {
            if (hasCached) {
              await this._recordSearchMetrics({
                cacheHit: true,
                outcome: "cache-fallback-no-evidence",
                resultState: cachedItem.resultState || "confirmed",
                evidenceTier: cachedItem.evidenceTier || "EVIDENCE_STRONG",
                runStats: null,
                bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || "",
                confidence: Number(cachedItem.confidence || 0.9)
              });
              return cachedResult;
            }
            const inconclusive = buildInconclusiveNoEvidence("no_evidence");
            const inconclusiveItem = inconclusive[0] || {};
            await this._recordSearchMetrics({
              cacheHit: false,
              outcome: "no-evidence",
              resultState: inconclusiveItem.resultState || "inconclusive",
              evidenceTier: inconclusiveItem.evidenceTier || "EVIDENCE_WEAK",
              runStats: null,
              bestLetter: "",
              confidence: Number(inconclusiveItem.confidence || 0.12)
            });
            return inconclusive;
          }
          const resultItem = refined[0] || {};
          const freshIsStrongConfirmed = resultItem.resultState === "confirmed" && resultItem.evidenceTier === "EVIDENCE_STRONG";
          const freshLetter = String(resultItem.answerLetter || resultItem.bestLetter || "").toUpperCase();
          const cachedLetter = String(cachedItem?.answerLetter || cachedItem?.bestLetter || "").toUpperCase();
          const freshHasNonAiEvidence = Array.isArray(resultItem.sources) && resultItem.sources.some((s) => s?.evidenceType && s.evidenceType !== "ai" && s.evidenceType !== "ai-combined");
          const freshDiffersFromCache = !!(freshLetter && cachedLetter && freshLetter !== cachedLetter);
          const freshUpgradeCandidate = freshDiffersFromCache && freshHasNonAiEvidence && resultItem.evidenceTier !== "AI_ONLY" && Number(resultItem.confidence || 0) >= 0.72;
          if (hasCached && !freshIsStrongConfirmed && !freshUpgradeCandidate) {
            await this._recordSearchMetrics({
              cacheHit: true,
              outcome: "cache-fallback-fresh-weak",
              resultState: cachedItem.resultState || "confirmed",
              evidenceTier: cachedItem.evidenceTier || "EVIDENCE_STRONG",
              runStats: resultItem.runStats || null,
              bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || "",
              confidence: Number(cachedItem.confidence || 0.9)
            });
            return cachedResult;
          }
          const cacheSources = Array.isArray(resultItem.sources) ? resultItem.sources : [];
          const hasLinkSource = cacheSources.some((s) => String(s?.link || "").trim().length > 0);
          if (hasLinkSource || resultItem.resultState === "confirmed") {
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
            outcome: hasCached ? freshUpgradeCandidate ? "cache-revalidated-upgrade" : "cache-revalidated" : "refined",
            resultState: resultItem.resultState || "inconclusive",
            evidenceTier: resultItem.evidenceTier || "EVIDENCE_WEAK",
            runStats: resultItem.runStats || null,
            bestLetter: resultItem.bestLetter || resultItem.answerLetter || "",
            confidence: Number(resultItem.confidence || 0)
          });
          return refined;
        }
      };
    }
  });

  // src/models/StorageModel.js
  var StorageModel;
  var init_StorageModel = __esm({
    "src/models/StorageModel.js"() {
      StorageModel = {
        data: [],
        currentFolderId: "root",
        /**
         * Initializes storage, loading data from chrome.storage.local
         * @returns {Promise<void>}
         */
        async init() {
          return new Promise((resolve) => {
            chrome.storage.local.get(["binderStructure"], (result) => {
              const localData = result.binderStructure;
              if (Array.isArray(localData)) {
                this.data = localData;
              } else {
                this.data = [{ id: "root", type: "folder", title: "Raiz", children: [] }];
              }
              resolve();
            });
          });
        },
        /**
         * Saves current state to storage
         * @returns {Promise<void>}
         */
        async save() {
          console.log("StorageModel: Salvando estrutura...", this.countItems());
          return new Promise((resolve) => {
            chrome.storage.local.set({ binderStructure: this.data }, () => {
              if (chrome.runtime.lastError) {
                console.error("StorageModel: Local save failed:", chrome.runtime.lastError);
              }
              resolve();
            });
          });
        },
        /**
         * Total count of saved questions (recursive)
         * @param {Array} nodes 
         * @returns {number}
         */
        countItems(nodes = this.data) {
          let count = 0;
          for (const node of nodes) {
            if (node.type === "question") count++;
            if (node.children) count += this.countItems(node.children);
          }
          return count;
        },
        /**
         * Finds a node (folder or item) by ID
         * @param {string} id 
         * @param {Array} nodes 
         * @returns {Object|null}
         */
        findNode(id, nodes = this.data) {
          for (const node of nodes) {
            if (node.id === id) return node;
            if (node.type === "folder" && node.children) {
              const found = this.findNode(id, node.children);
              if (found) return found;
            }
          }
          return null;
        },
        /**
         * Adds a new question to the current folder
         * @param {string} question 
         * @param {string} answer 
         * @param {string} source 
         */
        async addItem(question, answer, source) {
          if (!this.data.length) await this.init();
          if (this.isSaved(question)) {
            return false;
          }
          const current = this.findNode(this.currentFolderId);
          if (current && current.type === "folder") {
            current.children.push({
              id: "q" + Date.now(),
              type: "question",
              content: { question, answer, source },
              createdAt: Date.now()
            });
            await this.save();
            return true;
          } else {
            console.error("StorageModel: Pasta atual inv\xE1lida:", this.currentFolderId);
          }
          return false;
        },
        /**
         * Creates a new folder inside the current folder
         * @param {string} name 
         */
        async createFolder(name) {
          if (!name) return;
          const current = this.findNode(this.currentFolderId);
          if (current && current.type === "folder") {
            current.children.push({
              id: "f" + Date.now(),
              type: "folder",
              title: name,
              children: [],
              createdAt: Date.now()
            });
            await this.save();
          }
        },
        /**
         * Checks if a question is already saved
         * @param {string} questionText 
         * @returns {boolean}
         */
        isSaved(questionText) {
          const search = (nodes) => {
            for (const node of nodes) {
              if (node.type === "question" && node.content && node.content.question === questionText) return true;
              if (node.children) {
                if (search(node.children)) return true;
              }
            }
            return false;
          };
          return search(this.data);
        },
        /**
         * Removes a question by content text
         * @param {string} questionText 
         * @returns {boolean} Sucesso
         */
        async removeByContent(questionText) {
          const removeFromTree = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
              if (nodes[i].type === "question" && nodes[i].content && nodes[i].content.question === questionText) {
                nodes.splice(i, 1);
                return true;
              }
              if (nodes[i].children) {
                if (removeFromTree(nodes[i].children)) return true;
              }
            }
            return false;
          };
          if (removeFromTree(this.data)) {
            await this.save();
            return true;
          }
          return false;
        },
        /**
         * Removes a node by ID
         * @param {string} id 
         * @returns {boolean} Sucesso
         */
        async deleteNode(id) {
          const removeFromTree = (nodes, targetId) => {
            for (let i = 0; i < nodes.length; i++) {
              if (nodes[i].id === targetId) {
                nodes.splice(i, 1);
                return true;
              }
              if (nodes[i].children) {
                if (removeFromTree(nodes[i].children, targetId)) return true;
              }
            }
            return false;
          };
          if (removeFromTree(this.data, id)) {
            await this.save();
            return true;
          }
          return false;
        },
        /**
         * Moves an item to another folder
         * @param {string} itemId 
         * @param {string} targetFolderId 
         */
        async moveItem(itemId, targetFolderId) {
          if (itemId === targetFolderId) return;
          const extractFromTree = (nodes, id) => {
            for (let i = 0; i < nodes.length; i++) {
              if (nodes[i].id === id) {
                return nodes.splice(i, 1)[0];
              }
              if (nodes[i].children) {
                const found = extractFromTree(nodes[i].children, id);
                if (found) return found;
              }
            }
            return null;
          };
          const itemNode = extractFromTree(this.data, itemId);
          if (itemNode) {
            const targetFolder = this.findNode(targetFolderId);
            if (targetFolder && targetFolder.type === "folder") {
              targetFolder.children.push(itemNode);
              await this.save();
            } else {
              await this.init();
            }
          }
        },
        /**
         * Renames a folder
         * @param {string} folderId
         * @param {string} newName
         * @returns {Promise<boolean>}
         */
        async renameFolder(folderId, newName) {
          if (!newName) return false;
          const folder = this.findNode(folderId);
          if (!folder || folder.type !== "folder") return false;
          folder.title = newName;
          await this.save();
          return true;
        },
        /**
         * Finds the parent node of a given ID
         * @param {string} childId
         * @param {Array} nodes
         * @returns {Object|null}
         */
        findParent(childId, nodes = this.data) {
          for (const node of nodes) {
            if (node.children) {
              for (const child of node.children) {
                if (child.id === childId) return node;
              }
              const found = this.findParent(childId, node.children);
              if (found) return found;
            }
          }
          return null;
        },
        /**
         * Deletes a folder but moves its children to the parent folder
         * @param {string} folderId
         * @returns {Promise<boolean>}
         */
        async deleteFolderKeepChildren(folderId) {
          const folder = this.findNode(folderId);
          if (!folder || folder.type !== "folder") return false;
          const parent = this.findParent(folderId);
          if (!parent || !parent.children) return false;
          const folderIndex = parent.children.findIndex((c) => c.id === folderId);
          if (folderIndex === -1) return false;
          const children = folder.children || [];
          parent.children.splice(folderIndex, 1, ...children);
          await this.save();
          return true;
        },
        /**
         * Clears everything (Factory Reset)
         */
        async clearAll() {
          this.data = [{ id: "root", type: "folder", title: "Raiz", children: [] }];
          this.currentFolderId = "root";
          await this.save();
        },
        /**
         * Imports data from a backup JSON
         * @param {Array} importedData
         */
        async importData(importedData) {
          if (!Array.isArray(importedData) || importedData.length === 0) return;
          this.data = importedData;
          this.currentFolderId = "root";
          await this.save();
        }
      };
    }
  });

  // src/i18n/translations.js
  var SUPPORTED_LANGUAGES, TRANSLATIONS;
  var init_translations = __esm({
    "src/i18n/translations.js"() {
      SUPPORTED_LANGUAGES = ["en", "pt-BR"];
      TRANSLATIONS = {
        en: {
          "app.title": "AnswerHunter",
          "app.subtitle": "Educational answer hunter",
          "app.settings": "Settings",
          "app.language": "Language",
          "tab.search": "Search",
          "tab.binder": "Binder",
          "action.search": "Search",
          "action.extract": "Extract",
          "action.copyAll": "Copy all",
          "placeholder.search": "Find answers and save them to your binder.",
          "status.extractingContent": "Extracting content...",
          "status.noQuestionFound": "No question found. Try selecting the text first.",
          "status.refiningWithAi": "Refining with AI...",
          "status.questionsFound": "{count} question(s) found.",
          "status.noValidQuestion": "No valid question found after refinement.",
          "status.extractError": "Extraction error: {message}",
          "status.gettingQuestion": "Reading question from page...",
          "status.visionOcr": "Capturing screen for visual OCR...",
          "status.selectQuestionText": "Select the question text and try again.",
          "status.validatingQuestion": "Validating question with AI...",
          "status.invalidQuestion": "Invalid or noisy question. Select the correct text and retry.",
          "status.searchingGoogle": "Searching sources...",
          "status.noSourcesAskAi": "No source found. Asking AI...",
          "status.foundAndAnalyzing": "{count} source(s) found. Analyzing...",
          "status.noSourceAnswerAskAi": "No clear answer in sources. Asking AI...",
          "status.answersFound": "{count} answer(s) found.",
          "status.couldNotGetAnswer": "Could not get an answer.",
          "status.searchError": "Search error: {message}",
          "status.copied": "Copied to clipboard.",
          "status.restrictedPage": "Cannot use this extension on restricted pages (chrome://, etc).",
          "setup.welcome.title": "Welcome to AnswerHunter",
          "setup.welcome.description": "Before you start, set up your API keys. This takes less than 2 minutes.",
          "setup.welcome.start": "Start setup",
          "setup.welcome.feature1": "AI-powered answers",
          "setup.welcome.feature2": "Source-backed results",
          "setup.welcome.feature3": "100% private keys",
          "setup.welcome.timeHint": "~2 min setup, free APIs",
          "setup.title": "API Setup",
          "setup.close": "Close",
          "setup.required": "Required",
          "setup.step1": "Step 1 of 3",
          "setup.step2": "Step 2 of 3",
          "setup.step3": "Step 3 of 3 - Optional",
          "setup.groq.description": "Groq powers answer analysis.",
          "setup.groq.descriptionFull": "Groq provides the AI brain that analyzes questions and finds the best answers. It's free and takes 30 seconds to set up.",
          "setup.serper.description": "Serper powers web search evidence.",
          "setup.serper.descriptionFull": "Serper searches the web for evidence to validate and support answers. Free plan includes 2,500 searches.",
          "setup.gemini.description": "Gemini is an optional fallback model.",
          "setup.gemini.descriptionFull": "Gemini serves as an optional backup AI. If Groq has issues, Gemini kicks in automatically. You can skip this.",
          "setup.gemini.skipHint": "You can skip this step and add it later from settings.",
          "setup.instructions.groq.1": "Open console.groq.com/keys",
          "setup.instructions.groq.2": "Create a free account (Google or GitHub)",
          "setup.instructions.groq.3": 'Click "Create API Key" and copy the key',
          "setup.instructions.serper.1": "Open serper.dev/api-key",
          "setup.instructions.serper.2": "Create a free account",
          "setup.instructions.serper.3": "Copy the API key from dashboard",
          "setup.instructions.gemini.1": "Open aistudio.google.com/app/apikey",
          "setup.instructions.gemini.2": "Create an API key and copy it",
          "setup.instructions.gemini.3": "Paste it below, or skip this step",
          "setup.getFreeKey": "Get free key",
          "setup.openGroqSite": "Open Groq Console",
          "setup.openSerperSite": "Open Serper Dashboard",
          "setup.openGeminiSite": "Open Google AI Studio",
          "setup.placeholder.groq": "gsk_xxxxxxxxxxxxxxxxxxxx",
          "setup.placeholder.serper": "Paste your Serper API key",
          "setup.placeholder.gemini": "Paste your Gemini API key (optional)",
          "setup.toggleVisibility": "Show or hide key",
          "setup.howTo": "How to get your key:",
          "setup.optional": "Optional",
          "setup.testConnection": "Test",
          "setup.back": "Back",
          "setup.next": "Next",
          "setup.skip": "Skip",
          "setup.save": "Save & start using",
          "setup.privacy": "Your keys are stored locally and never sent to our servers.",
          "setup.pasteKeyBelow": "Paste your key here:",
          "setup.pasteDetected": "Key pasted!",
          "setup.freeTag": "FREE",
          "setup.status.empty": "Paste a key first.",
          "setup.status.testing": "Testing connection...",
          "setup.status.ok": "Connection OK!",
          "setup.status.error": "Invalid key or provider error.",
          "setup.autoAdvance": "Moving to next step...",
          "setup.toast.saved": "All set! You're ready to hunt answers.",
          "setup.toast.required": "Setup required: add your Groq key first.",
          "setup.toast.pasteKey": "Paste your API key in the field first.",
          "setup.toast.connectionOk": "{provider} connected successfully!",
          "setup.toast.invalidKey": "This key didn't work. Double-check and try again.",
          "setup.toast.testError": "Connection test failed. Check your internet.",
          "result.title": "Best match",
          "result.correctAnswer": "Suggested answer",
          "result.verifiedAnswer": "Verified answer",
          "result.aiSuggestion": "AI suggestion",
          "result.aiReasoning": "View AI reasoning",
          "result.inconclusiveAnswer": "Inconclusive",
          "result.suggestedAnswer": "Suggested Answer",
          "result.inconclusive": "Inconclusive",
          "result.statement": "Statement",
          "result.options": "Options",
          "result.sources": "Sources ({count})",
          "result.source": "Source",
          "result.sourceHost": "Source: {host}",
          "result.save": "Save to binder",
          "result.savedQuestion": "Saved question",
          "result.state.confirmed": "Confirmed by sources",
          "result.state.conflict": "Conflict",
          "result.state.suggested": "AI Suggestion",
          "result.state.inconclusive": "Inconclusive",
          "result.reason.confirmed": "Multiple aligned sources with explicit answer evidence.",
          "result.reason.conflict": "Sources disagree and score margin is low.",
          "result.reason.suggested": "Answer inferred by AI from available evidence or knowledge.",
          "result.reason.inconclusive": "No strong explicit answer evidence. Using best estimate.",
          "result.meta.aiOverview": "AI Overview: {status}",
          "result.meta.captured": "captured",
          "result.meta.absent": "absent",
          "result.overview.title": "Overview",
          "result.overview.points": "Key points",
          "result.overview.references": "References",
          "result.votes": "Votes",
          "result.confidenceTooltip": "Confidence: {value}% \u2014 How certain the AI is about this answer based on source agreement.",
          "result.votesTooltip": "Vote scores show how strongly each option was supported across sources. Higher = more evidence.",
          "result.voteScoreTooltip": "Option {letter}: score {score} \u2014 based on weighted evidence from multiple sources.",
          "result.override.btn": "Change answer",
          "result.override.tooltip": "Select the correct answer manually",
          "result.override.pick": "Pick the correct option:",
          "result.override.cancel": "Cancel",
          "result.override.applied": "Answer changed by you",
          "binder.title": "My Study",
          "binder.subtitle": "Saved questions for review",
          "binder.clearAll": "Clear all",
          "binder.placeholderHtml": "Your binder is empty.<br>Save questions to review later.",
          "binder.back": "Back",
          "binder.newFolder": "New folder",
          "binder.rename": "Rename",
          "binder.delete": "Delete",
          "binder.copy": "Copy",
          "binder.copy.question": "Question",
          "binder.copy.answer": "Answer",
          "binder.emptyFolder": "Empty folder",
          "binder.savedQuestion": "Saved question",
          "binder.prompt.newFolder": "New folder name:",
          "binder.prompt.renameFolder": "Rename folder:",
          "binder.prompt.deleteFolderOptions": 'Folder "{title}" has {count} item(s).\n\nChoose:\n1 - Delete folder and all content\n2 - Delete folder only (move content to parent)\n0 - Cancel',
          "binder.confirm.deleteItem": "Delete this item?",
          "binder.confirm.clearAll": "Delete the entire binder? This action is irreversible.",
          "binder.toast.nothingToExport": "Nothing to export.",
          "binder.toast.exportSuccess": "Backup exported successfully.",
          "binder.toast.exportError": "Export error: {message}",
          "binder.toast.invalidFile": "Invalid file.",
          "binder.confirm.importReplace": "This will replace your entire binder. Continue?",
          "binder.toast.importSuccess": "Data imported successfully.",
          "binder.toast.importError": "Import error: {message}",
          "binder.backupReminder": "Backup reminder: export your binder regularly.",
          "binder.backupDismiss": "Dismiss",
          "footer.refined": "AI-refined answers with source weighting",
          "provider.groq": "Groq",
          "provider.serper": "Serper",
          "provider.serpapi": "SerpApi",
          "provider.gemini": "Gemini",
          "lang.english": "English",
          "lang.portuguese": "Portuguese (Brazil)",
          // New Onboarding Keys
          "setup.new.welcome.title": "Welcome to AnswerHunter",
          "setup.new.welcome.desc": "We will guide you step by step. You only need to copy and paste your keys.",
          "setup.new.start": "Start guided setup",
          "setup.getKey": "Get Free Key",
          "setup.test": "Test Key",
          "setup.finish": "Finish Setup",
          "setup.step": "Step",
          "setup.feature.fast": "Simple Steps",
          "setup.feature.private": "100% Private",
          "setup.feature.free": "Free APIs",
          "setup.timeHint": "Usually takes about 2 minutes",
          "setup.keyLabel": "API key",
          "setup.howToGetKey": "How to get your key",
          "setup.stepByStepGuide": "Step-by-step guide",
          "setup.beginHint": "Start with button 1 below. After copying the key, come back and paste it here.",
          "setup.openSiteAction": "1. Open official site",
          "setup.validateAction": "2. Validate key",
          "setup.nextHelp": "When validation is successful, the Next button unlocks automatically.",
          "setup.groq.title": "Set up your Groq key",
          "setup.groq.tagline": "Groq is required. It helps the extension understand and analyze each question.",
          "setup.groq.step1": 'Click "Open official site" and create your free Groq account.',
          "setup.groq.step2": 'On Groq, open "API Keys" and create a new key.',
          "setup.groq.step3": 'Copy the key, paste below, then click "Validate key".',
          "setup.hint.groq": 'Groq keys start with "gsk_".',
          "setup.serper.title": "Set up your Serper key",
          "setup.serper.tagline": "Serper is optional. It improves web evidence coverage and ranking quality.",
          "setup.serper.step1": 'Click "Open official site" and create your free Serper account.',
          "setup.serper.step2": "Open your dashboard and locate your API Key.",
          "setup.serper.step3": 'Copy the key, paste below, then click "Validate key".',
          "setup.hint.serper": "Copy the long key shown in your Serper dashboard.",
          "setup.searchProvider.label": "Search provider",
          "setup.searchProvider.serper": "Serper (free tier)",
          "setup.searchProvider.serpapi": "SerpApi (better AI Overview coverage)",
          "setup.searchProvider.hint": "Choose the provider. SerpApi usually returns AI Overview more often.",
          "setup.gemini.title": "Optional: set up Gemini backup",
          "setup.gemini.tagline": "Optional step. Gemini is only used if Groq is unavailable.",
          "setup.gemini.step1": 'Click "Open official site" and sign in to Google AI Studio.',
          "setup.gemini.step2": 'Click "Get API key" then "Create API key".',
          "setup.gemini.step3": "Copy the key, paste below, and validate it if you want backup AI.",
          "setup.hint.gemini": 'Gemini keys start with "AIza".',
          "setup.gemini.hint": "You can skip this step and finish now.",
          "setup.openrouter.title": "Optional: set up OpenRouter API",
          "setup.openrouter.step2": "Sign up or Log in to OpenRouter.ai to get your API key.",
          "setup.openrouter.step3": "Go to Keys, generate a new key and paste it below.",
          "setup.openrouter.tagline": "OpenRouter provides free access to powerful models like DeepSeek and Qwen.",
          "setup.openrouter.modelLabel": "Select Model",
          "setup.prefs.openrouterLabel": "OpenRouter",
          "setup.gemini.finishHelp": "Gemini is optional. You can validate now or skip and finish.",
          "setup.aiConfig.title": "AI Provider & Models",
          "setup.aiConfig.primaryLabel": "Primary AI provider",
          "setup.aiConfig.fast": "Fast",
          "setup.aiConfig.smart": "Smart",
          "setup.aiConfig.groqModel": "Groq model",
          "setup.aiConfig.geminiModel": "Gemini model",
          "setup.aiConfig.hintGroqPrimary": "Groq runs first (fast). Gemini kicks in if Groq is busy.",
          "setup.aiConfig.hintGeminiPrimary": "Gemini runs first (smarter). Groq kicks in if Gemini is busy.",
          "setup.prefs.title": "All set!",
          "setup.prefs.subtitle": "One last choice before you start.",
          "setup.prefs.aiLabel": "How should the AI respond?",
          "setup.prefs.groqLabel": "Faster",
          "setup.prefs.groqDesc": "Answers in seconds",
          "setup.prefs.geminiLabel": "Smarter",
          "setup.prefs.geminiDesc": "Deeper analysis",
          "setup.prefs.hintGroq": "You can change this anytime in settings.",
          "setup.prefs.hintGemini": "You can change this anytime in settings.",
          "setup.test.short": "Validating...",
          "setup.test.success": "Key validated",
          "setup.test.failed": "Try again",
          "setup.skipGemini": "Skip Gemini, finish setup",
          "setup.changeKey": "Change this key",
          "setup.removeSerperKey": "Remove Serper key",
          "setup.removeGeminiKey": "Remove Gemini key",
          "setup.closeSettings": "Close settings",
          "setup.keyStatus.configured": "Configured",
          "setup.keyStatus.missing": "Not configured",
          "setup.keyStatus.geminiMissing": "No Gemini key saved",
          "setup.status.geminiMissing": "You have no Gemini key saved.",
          "setup.status.serperMissing": "You have no Serper key saved.",
          "setup.toast.noGeminiKeySaved": "You have no Gemini key saved.",
          "setup.toast.serperKeyRemoved": "Serper key removed. Search will use fallback mode when needed.",
          "setup.toast.geminiKeyRemoved": "Gemini key removed. Groq-only mode is active.",
          "placeholder.searchHint": 'Open a question in your browser and click "Search" or "Extract".',
          "binder.goToSearch": "Go to Search",
          "result.aiWarning": "AI-generated questions and answers may contain errors. Please verify.",
          "result.tutor.btn": "Explain step-by-step",
          "result.tutor.title": "Tutor Mode",
          "result.similar.btn": "Test my knowledge",
          "result.similar.title": "Similar Question",
          "result.chat.placeholder": "Ask a question...",
          "result.chat.btn": "Send",
          "result.chat.title": "Follow-up Chat",
          "result.chat.hello": "Hi! How can I help you better understand this question?",
          "result.dictionary.loading": "Looking up...",
          "binder.studyMode.enable": "Enable Study Mode",
          "binder.studyMode.disable": "Disable Study Mode",
          "binder.studyMode.reveal": "Reveal Answer",
          "setup.removeOpenrouterKey": "Remove OpenRouter key"
        },
        "pt-BR": {
          "app.title": "AnswerHunter",
          "app.subtitle": "Ca\xE7ador de respostas educacionais",
          "app.settings": "Configura\xE7\xF5es",
          "app.language": "Idioma",
          "tab.search": "Buscar",
          "tab.binder": "Fich\xE1rio",
          "action.search": "Buscar",
          "action.extract": "Extrair",
          "action.copyAll": "Copiar tudo",
          "placeholder.search": "Encontre respostas e salve no seu fich\xE1rio.",
          "status.extractingContent": "Extraindo conte\xFAdo...",
          "status.noQuestionFound": "Nenhuma quest\xE3o encontrada. Tente selecionar o texto primeiro.",
          "status.refiningWithAi": "Refinando com IA...",
          "status.questionsFound": "{count} quest\xE3o(\xF5es) encontrada(s).",
          "status.noValidQuestion": "Nenhuma quest\xE3o v\xE1lida encontrada ap\xF3s o refinamento.",
          "status.extractError": "Erro ao extrair: {message}",
          "status.gettingQuestion": "Lendo a quest\xE3o da p\xE1gina...",
          "status.visionOcr": "Capturando tela para OCR visual...",
          "status.selectQuestionText": "Selecione o texto da quest\xE3o e tente novamente.",
          "status.validatingQuestion": "Validando quest\xE3o com IA...",
          "status.invalidQuestion": "Quest\xE3o inv\xE1lida ou polu\xEDda. Selecione o texto correto e tente novamente.",
          "status.searchingGoogle": "Buscando fontes...",
          "status.noSourcesAskAi": "Nenhuma fonte encontrada. Consultando IA...",
          "status.foundAndAnalyzing": "{count} fonte(s) encontrada(s). Analisando...",
          "status.noSourceAnswerAskAi": "Sem resposta clara nas fontes. Consultando IA...",
          "status.answersFound": "{count} resposta(s) encontrada(s).",
          "status.couldNotGetAnswer": "N\xE3o foi poss\xEDvel obter resposta.",
          "status.searchError": "Erro na busca: {message}",
          "status.copied": "Copiado para a \xE1rea de transfer\xEAncia.",
          "status.restrictedPage": "N\xE3o \xE9 poss\xEDvel usar a extens\xE3o em p\xE1ginas restritas (chrome://, etc).",
          "setup.welcome.title": "Bem-vindo ao AnswerHunter",
          "setup.welcome.description": "Antes de come\xE7ar, configure suas chaves de API. Isso leva menos de 2 minutos.",
          "setup.welcome.start": "Iniciar configura\xE7\xE3o",
          "setup.welcome.feature1": "Respostas com IA",
          "setup.welcome.feature2": "Fontes verificadas",
          "setup.welcome.feature3": "Chaves 100% privadas",
          "setup.welcome.timeHint": "~2 min de configura\xE7\xE3o, APIs gratuitas",
          "setup.title": "Configura\xE7\xE3o da API",
          "setup.close": "Fechar",
          "setup.required": "Obrigat\xF3rio",
          "setup.step1": "Passo 1 de 3",
          "setup.step2": "Passo 2 de 3",
          "setup.step3": "Passo 3 de 3 - Opcional",
          "setup.groq.description": "Groq faz a an\xE1lise principal das respostas.",
          "setup.groq.descriptionFull": "Groq fornece a IA que analisa quest\xF5es e encontra as melhores respostas. \xC9 gratuito e leva 30 segundos para configurar.",
          "setup.serper.description": "Serper busca evid\xEAncias na web.",
          "setup.serper.descriptionFull": "Serper faz buscas na web para validar e embasar as respostas. O plano gr\xE1tis inclui 2.500 buscas.",
          "setup.gemini.description": "Gemini \xE9 um fallback opcional.",
          "setup.gemini.descriptionFull": "Gemini serve como IA de backup opcional. Se o Groq tiver problemas, o Gemini entra automaticamente. Voc\xEA pode pular esta etapa.",
          "setup.gemini.skipHint": "Voc\xEA pode pular esta etapa e adicionar depois nas configura\xE7\xF5es.",
          "setup.instructions.groq.1": "Acesse console.groq.com/keys",
          "setup.instructions.groq.2": "Crie uma conta gratuita (Google ou GitHub)",
          "setup.instructions.groq.3": 'Clique em "Create API Key" e copie a chave',
          "setup.instructions.serper.1": "Acesse serper.dev/api-key",
          "setup.instructions.serper.2": "Crie uma conta gratuita",
          "setup.instructions.serper.3": "Copie a chave no dashboard",
          "setup.instructions.gemini.1": "Acesse aistudio.google.com/app/apikey",
          "setup.instructions.gemini.2": "Crie uma API key e copie",
          "setup.instructions.gemini.3": "Cole abaixo, ou pule esta etapa",
          "setup.getFreeKey": "Obter chave gr\xE1tis",
          "setup.openGroqSite": "Abrir Console Groq",
          "setup.openSerperSite": "Abrir Dashboard Serper",
          "setup.openGeminiSite": "Abrir Google AI Studio",
          "setup.placeholder.groq": "gsk_xxxxxxxxxxxxxxxxxxxx",
          "setup.placeholder.serper": "Cole sua chave da API Serper",
          "setup.placeholder.gemini": "Cole sua chave da API Gemini (opcional)",
          "setup.toggleVisibility": "Mostrar ou ocultar chave",
          "setup.howTo": "Como obter sua chave:",
          "setup.optional": "Opcional",
          "setup.testConnection": "Testar",
          "setup.back": "Voltar",
          "setup.next": "Pr\xF3ximo",
          "setup.skip": "Pular",
          "setup.save": "Salvar e come\xE7ar a usar",
          "setup.privacy": "Suas chaves ficam no seu dispositivo e nunca s\xE3o enviadas aos nossos servidores.",
          "setup.pasteKeyBelow": "Cole sua chave aqui:",
          "setup.pasteDetected": "Chave colada!",
          "setup.freeTag": "GR\xC1TIS",
          "setup.status.empty": "Cole uma chave primeiro.",
          "setup.status.testing": "Testando conex\xE3o...",
          "setup.status.ok": "Conex\xE3o OK!",
          "setup.status.error": "Chave invalida ou erro do provedor.",
          "setup.autoAdvance": "Indo para a pr\xF3xima etapa...",
          "setup.toast.saved": "Tudo pronto! Voc\xEA j\xE1 pode buscar respostas.",
          "setup.toast.required": "Configura\xE7\xE3o necess\xE1ria: adicione primeiro sua chave Groq.",
          "setup.toast.pasteKey": "Cole sua chave de API no campo primeiro.",
          "setup.toast.connectionOk": "{provider} conectado com sucesso!",
          "setup.toast.invalidKey": "Essa chave n\xE3o funcionou. Verifique e tente novamente.",
          "setup.toast.testError": "Teste de conex\xE3o falhou. Verifique sua internet.",
          "result.title": "Melhor correspond\xEAncia",
          "result.correctAnswer": "Resposta sugerida",
          "result.verifiedAnswer": "Resposta verificada",
          "result.aiSuggestion": "Sugest\xE3o da IA",
          "result.aiReasoning": "Ver racioc\xEDnio da IA",
          "result.inconclusiveAnswer": "Inconclusivo",
          "result.suggestedAnswer": "Resposta Sugerida",
          "result.inconclusive": "Inconclusivo",
          "result.statement": "Enunciado",
          "result.options": "Alternativas",
          "result.sources": "Fontes ({count})",
          "result.source": "Fonte",
          "result.sourceHost": "Fonte: {host}",
          "result.save": "Salvar no fich\xE1rio",
          "result.savedQuestion": "Quest\xE3o salva",
          "result.state.confirmed": "Confirmado por fontes",
          "result.state.conflict": "Conflito",
          "result.state.suggested": "Sugest\xE3o IA",
          "result.state.inconclusive": "Inconclusivo",
          "result.reason.confirmed": "M\xFAltiplas fontes alinhadas com evid\xEAncia expl\xEDcita de gabarito.",
          "result.reason.conflict": "As fontes divergem e a margem de pontua\xE7\xE3o \xE9 baixa.",
          "result.reason.suggested": "Resposta inferida pela IA com base nas evid\xEAncias ou conhecimento dispon\xEDvel.",
          "result.reason.inconclusive": "Sem evid\xEAncia expl\xEDcita forte. Melhor estimativa aplicada.",
          "result.meta.aiOverview": "Vis\xE3o Geral IA: {status}",
          "result.meta.captured": "capturado",
          "result.meta.absent": "ausente",
          "result.overview.title": "Resumo",
          "result.overview.points": "Pontos-chave",
          "result.overview.references": "Refer\xEAncias",
          "result.votes": "Votos",
          "result.confidenceTooltip": "Confian\xE7a: {value}% \u2014 Grau de certeza da IA com base na concord\xE2ncia das fontes.",
          "result.votesTooltip": "Pontua\xE7\xE3o de votos mostra o quanto cada alternativa foi apoiada pelas fontes. Maior = mais evid\xEAncia.",
          "result.voteScoreTooltip": "Alternativa {letter}: pontua\xE7\xE3o {score} \u2014 calculada com base em evid\xEAncias ponderadas de m\xFAltiplas fontes.",
          "result.override.btn": "Alterar resposta",
          "result.override.tooltip": "Selecionar a resposta correta manualmente",
          "result.override.pick": "Escolha a alternativa correta:",
          "result.override.cancel": "Cancelar",
          "result.override.applied": "Resposta alterada por voc\xEA",
          "binder.title": "Meus Estudos",
          "binder.subtitle": "Quest\xF5es salvas para revis\xE3o",
          "binder.clearAll": "Limpar tudo",
          "binder.placeholderHtml": "Seu fich\xE1rio est\xE1 vazio.<br>Salve quest\xF5es para revisar depois.",
          "binder.back": "Voltar",
          "binder.newFolder": "Nova pasta",
          "binder.rename": "Renomear",
          "binder.delete": "Excluir",
          "binder.copy": "Copiar",
          "binder.copy.question": "Quest\xE3o",
          "binder.copy.answer": "Resposta",
          "binder.emptyFolder": "Pasta vazia",
          "binder.savedQuestion": "Quest\xE3o salva",
          "binder.prompt.newFolder": "Nome da nova pasta:",
          "binder.prompt.renameFolder": "Novo nome da pasta:",
          "binder.prompt.deleteFolderOptions": 'A pasta "{title}" possui {count} item(ns).\n\nEscolha:\n1 - Excluir pasta e todo o conte\xFAdo\n2 - Excluir s\xF3 a pasta (mover conte\xFAdo para pasta pai)\n0 - Cancelar',
          "binder.confirm.deleteItem": "Deseja excluir este item?",
          "binder.confirm.clearAll": "Deseja excluir todo o fich\xE1rio? Esta a\xE7\xE3o \xE9 irrevers\xEDvel.",
          "binder.toast.nothingToExport": "Nada para exportar.",
          "binder.toast.exportSuccess": "Backup exportado com sucesso.",
          "binder.toast.exportError": "Erro ao exportar: {message}",
          "binder.toast.invalidFile": "Arquivo inv\xE1lido.",
          "binder.confirm.importReplace": "Isso vai substituir todo o fich\xE1rio atual. Continuar?",
          "binder.toast.importSuccess": "Dados importados com sucesso.",
          "binder.toast.importError": "Erro ao importar: {message}",
          "binder.backupReminder": "Lembrete: exporte seu fich\xE1rio regularmente.",
          "binder.backupDismiss": "Dispensar",
          "footer.refined": "Respostas com IA e pondera\xE7\xE3o por fontes",
          "provider.groq": "Groq",
          "provider.serper": "Serper",
          "provider.serpapi": "SerpApi",
          "provider.gemini": "Gemini",
          "lang.english": "Ingl\xEAs",
          "lang.portuguese": "Portugu\xEAs (Brasil)",
          // New Onboarding Keys (PT)
          "setup.new.welcome.title": "Bem-vindo ao AnswerHunter",
          "setup.new.welcome.desc": "Vamos te guiar passo a passo. Voc\xEA s\xF3 precisa copiar e colar suas chaves.",
          "setup.new.start": "Iniciar guia",
          "setup.getKey": "Obter chave gr\xE1tis",
          "setup.test": "Testar chave",
          "setup.finish": "Concluir",
          "setup.step": "Passo",
          "setup.feature.fast": "Passos Simples",
          "setup.feature.private": "100% Privado",
          "setup.feature.free": "APIs Gr\xE1tis",
          "setup.timeHint": "Geralmente leva cerca de 2 minutos",
          "setup.keyLabel": "Chave de API",
          "setup.howToGetKey": "Como obter sua chave",
          "setup.stepByStepGuide": "Guia passo a passo",
          "setup.beginHint": "Comece pelo bot\xE3o 1 abaixo. Ap\xF3s copiar a chave, volte e cole aqui.",
          "setup.openSiteAction": "1. Abrir site oficial",
          "setup.validateAction": "2. Validar chave",
          "setup.nextHelp": "Quando a valida\xE7\xE3o for bem-sucedida, o bot\xE3o Pr\xF3ximo ser\xE1 desbloqueado automaticamente.",
          "setup.groq.title": "Configure sua chave Groq",
          "setup.groq.tagline": "Groq \xE9 obrigat\xF3rio. Ele ajuda a extens\xE3o a entender e analisar cada quest\xE3o.",
          "setup.groq.step1": 'Clique em "Abrir site oficial" e crie sua conta Groq (gr\xE1tis).',
          "setup.groq.step2": 'No Groq, abra "API Keys" e crie uma nova chave.',
          "setup.groq.step3": 'Copie a chave, cole abaixo e depois clique em "Validar chave".',
          "setup.hint.groq": 'Chaves do Groq come\xE7am com "gsk_".',
          "setup.serper.title": "Configure sua chave Serper",
          "setup.serper.tagline": "Serper \xE9 opcional. Ele melhora a cobertura de evid\xEAncias na web.",
          "setup.serper.step1": 'Clique em "Abrir site oficial" e crie sua conta Serper (gr\xE1tis).',
          "setup.serper.step2": "Abra seu painel (dashboard) e localize sua API Key.",
          "setup.serper.step3": 'Copie a chave, cole abaixo e depois clique em "Validar chave".',
          "setup.hint.serper": "Copie a chave longa exibida no painel Serper.",
          "setup.searchProvider.label": "Provedor de Busca",
          "setup.searchProvider.serper": "Serper (plano gr\xE1tis)",
          "setup.searchProvider.serpapi": "SerpApi (melhor cobertura)",
          "setup.searchProvider.hint": "Escolha o provedor de busca.",
          "setup.gemini.title": "Opcional: configure o Gemini",
          "setup.gemini.tagline": "Passo opcional. O Gemini \xE9 usado apenas se o Groq ficar indispon\xEDvel.",
          "setup.gemini.step1": 'Clique em "Abrir site oficial" e fa\xE7a login no Google AI Studio.',
          "setup.gemini.step2": 'Clique em "Get API key" e depois "Create API key".',
          "setup.gemini.step3": "Copie a chave, cole abaixo e valide-a se desejar um backup.",
          "setup.hint.gemini": 'Chaves Gemini come\xE7am com "AIza".',
          "setup.gemini.hint": "Voc\xEA pode pular esta etapa.",
          "setup.openrouter.title": "Opcional: configure a API da OpenRouter",
          "setup.openrouter.step2": "Crie uma conta ou fa\xE7a login na OpenRouter.ai",
          "setup.openrouter.step3": "V\xE1 em Keys, gere uma chave nova e cole abaixo.",
          "setup.openrouter.tagline": "OpenRouter fornece acesso gratuito a modelos como DeepSeek R1 e Qwen 32B.",
          "setup.openrouter.modelLabel": "Selecionar Modelo",
          "setup.prefs.openrouterLabel": "OpenRouter",
          "setup.gemini.finishHelp": "Voc\xEA pode validar agora ou apenas concluir direto.",
          "setup.aiConfig.title": "Provedor & Modelos IA",
          "setup.aiConfig.primaryLabel": "IA principal",
          "setup.aiConfig.fast": "R\xE1pido",
          "setup.aiConfig.smart": "Inteligente",
          "setup.aiConfig.groqModel": "Modelo Groq",
          "setup.aiConfig.geminiModel": "Modelo Gemini",
          "setup.aiConfig.hintGroqPrimary": "Groq ser\xE1 o principal. Gemini assume se o Groq estiver ocupado.",
          "setup.aiConfig.hintGeminiPrimary": "Gemini ser\xE1 o principal. Groq assume se o Gemini estiver ocupado.",
          "setup.prefs.title": "Tudo pronto!",
          "setup.prefs.subtitle": "Uma \xFAltima escolha antes de come\xE7ar.",
          "setup.prefs.aiLabel": "Como a IA deve responder?",
          "setup.prefs.groqLabel": "Mais r\xE1pido",
          "setup.prefs.groqDesc": "Responde em segundos",
          "setup.prefs.geminiLabel": "Mais inteligente",
          "setup.prefs.geminiDesc": "An\xE1lise mais profunda",
          "setup.prefs.hintGroq": "Voc\xEA pode mudar isso a qualquer momento nas configura\xE7\xF5es.",
          "setup.prefs.hintGemini": "Voc\xEA pode mudar isso a qualquer momento nas configura\xE7\xF5es.",
          "setup.test.short": "Validando...",
          "setup.test.success": "Chave validada",
          "setup.test.failed": "Tente novamente",
          "setup.skipGemini": "Pular e concluir",
          "setup.changeKey": "Trocar chave",
          "setup.removeSerperKey": "Remover chave Serper",
          "setup.removeGeminiKey": "Remover chave Gemini",
          "setup.closeSettings": "Fechar configura\xE7\xF5es",
          "setup.keyStatus.configured": "Configurado",
          "setup.keyStatus.missing": "N\xE3o configurado",
          "setup.keyStatus.geminiMissing": "Voc\xEA n\xE3o tem nenhuma chave do Gemini salva/gravada",
          "setup.status.geminiMissing": "Voc\xEA n\xE3o tem nenhuma chave do Gemini salva/gravada.",
          "setup.status.serperMissing": "Voc\xEA n\xE3o tem nenhuma chave da Serper salva/gravada.",
          "setup.toast.noGeminiKeySaved": "Voc\xEA n\xE3o tem nenhuma chave do Gemini salva/gravada.",
          "setup.toast.serperKeyRemoved": "Chave Serper removida. A busca usar\xE1 fallback quando necess\xE1rio.",
          "setup.toast.geminiKeyRemoved": "Chave Gemini removida. Agora voc\xEA est\xE1 usando s\xF3 o Groq.",
          "placeholder.searchHint": 'Abra uma quest\xE3o no navegador e clique em "Buscar" ou "Extrair".',
          "binder.goToSearch": "Ir para Busca",
          "result.aiWarning": "Quest\xF5es e respostas geradas por IA podem conter erros. Por favor, verifique.",
          "result.tutor.btn": "Explicar passo-a-passo",
          "result.tutor.title": "Modo Tutor",
          "result.similar.btn": "Testar se aprendi",
          "result.similar.title": "Quest\xE3o Parecida",
          "result.chat.placeholder": "Ficou com d\xFAvida? Pergunte...",
          "result.chat.btn": "Enviar",
          "result.chat.title": "Chat de D\xFAvidas",
          "result.chat.hello": "Ol\xE1! Como posso ajudar voc\xEA a entender melhor esta quest\xE3o?",
          "result.dictionary.loading": "Buscando significado...",
          "binder.studyMode.enable": "Ativar Modo Estudo",
          "binder.studyMode.disable": "Desativar Modo Estudo",
          "binder.studyMode.reveal": "Revelar Resposta",
          "setup.removeOpenrouterKey": "Remover chave OpenRouter"
        }
      };
    }
  });

  // src/i18n/I18nService.js
  var DEFAULT_LANGUAGE, I18nService;
  var init_I18nService = __esm({
    "src/i18n/I18nService.js"() {
      init_translations();
      init_SettingsModel();
      DEFAULT_LANGUAGE = "en";
      I18nService = {
        language: DEFAULT_LANGUAGE,
        normalizeLanguage(language) {
          if (typeof language !== "string") return DEFAULT_LANGUAGE;
          if (/^pt/i.test(language)) return "pt-BR";
          return "en";
        },
        resolveLanguage(candidate) {
          const normalized = this.normalizeLanguage(candidate);
          return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : DEFAULT_LANGUAGE;
        },
        async init() {
          const settings = await SettingsModel.getSettings();
          this.language = this.resolveLanguage(settings.language || navigator?.language || DEFAULT_LANGUAGE);
          this._exposeTranslator();
          return this.language;
        },
        async setLanguage(language) {
          const nextLanguage = this.resolveLanguage(language);
          this.language = nextLanguage;
          await SettingsModel.saveSettings({ language: nextLanguage });
          this._exposeTranslator();
          return nextLanguage;
        },
        getDictionary(language = this.language) {
          return TRANSLATIONS[this.resolveLanguage(language)] || TRANSLATIONS[DEFAULT_LANGUAGE];
        },
        t(key, variables = {}) {
          const dict = this.getDictionary(this.language);
          const fallback = TRANSLATIONS[DEFAULT_LANGUAGE][key] || key;
          const raw = dict[key] || fallback;
          if (typeof raw !== "string") return String(raw ?? key);
          return raw.replace(/\{(\w+)\}/g, (_match, token) => {
            const value = variables[token];
            return value === void 0 || value === null ? "" : String(value);
          });
        },
        apply(root = document) {
          if (!root) return;
          root.querySelectorAll("[data-i18n]").forEach((element) => {
            const key = element.getAttribute("data-i18n");
            element.textContent = this.t(key);
          });
          root.querySelectorAll("[data-i18n-html]").forEach((element) => {
            const key = element.getAttribute("data-i18n-html");
            element.innerHTML = this.t(key);
          });
          root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
            const key = element.getAttribute("data-i18n-placeholder");
            element.setAttribute("placeholder", this.t(key));
          });
          root.querySelectorAll("[data-i18n-title]").forEach((element) => {
            const key = element.getAttribute("data-i18n-title");
            element.setAttribute("title", this.t(key));
          });
          root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
            const key = element.getAttribute("data-i18n-aria-label");
            element.setAttribute("aria-label", this.t(key));
          });
          const htmlElement = root.ownerDocument?.documentElement || document.documentElement;
          if (htmlElement) {
            htmlElement.lang = this.language === "pt-BR" ? "pt-BR" : "en";
          }
          this._exposeTranslator();
        },
        _exposeTranslator() {
          try {
            window.__answerHunterTranslate = (key, variables) => this.t(key, variables);
          } catch (_) {
          }
        }
      };
    }
  });

  // src/controllers/BinderController.js
  var BinderController;
  var init_BinderController = __esm({
    "src/controllers/BinderController.js"() {
      init_StorageModel();
      init_I18nService();
      BinderController = {
        view: null,
        eventsBound: false,
        draggedItemId: null,
        lastExportTimestamp: null,
        isStudyMode: false,
        t(key, variables) {
          return I18nService.t(key, variables);
        },
        init(view) {
          this.view = view;
          StorageModel.init();
          this._loadLastExportTimestamp();
          this.bindEvents();
        },
        async renderBinder() {
          if (!this.view) return;
          if (!StorageModel.data || StorageModel.data.length === 0) {
            await StorageModel.init();
          }
          const currentFolder = StorageModel.findNode(StorageModel.currentFolderId) || StorageModel.data[0];
          const showBackupReminder = await this._shouldShowBackupReminder();
          this.view.renderBinderList(currentFolder, { showBackupReminder, isStudyMode: this.isStudyMode });
        },
        async _shouldShowBackupReminder() {
          const itemCount = this._countBinderItems();
          if (itemCount < 5) return false;
          try {
            const data = await chrome.storage.local.get(["_backupReminderDismissedUntil"]);
            const dismissedUntil = data?._backupReminderDismissedUntil;
            if (dismissedUntil && Date.now() < dismissedUntil) return false;
          } catch {
          }
          const daysSince = this._daysSinceLastExport();
          return daysSince === null || daysSince >= 7;
        },
        _countBinderItems() {
          const root = StorageModel.data?.[0];
          if (!root) return 0;
          let count = 0;
          const walk = (node) => {
            if (node.type === "question") count++;
            if (node.children) node.children.forEach(walk);
          };
          walk(root);
          return count;
        },
        _daysSinceLastExport() {
          if (!this.lastExportTimestamp) return null;
          return Math.floor((Date.now() - this.lastExportTimestamp) / (1e3 * 60 * 60 * 24));
        },
        async _loadLastExportTimestamp() {
          try {
            const data = await chrome.storage.local.get(["lastExportTimestamp"]);
            this.lastExportTimestamp = data?.lastExportTimestamp || null;
          } catch {
          }
        },
        async _saveLastExportTimestamp() {
          this.lastExportTimestamp = Date.now();
          try {
            await chrome.storage.local.set({ lastExportTimestamp: this.lastExportTimestamp });
          } catch {
          }
        },
        async _dismissBackupReminder() {
          try {
            const dismissUntil = Date.now() + 7 * 24 * 60 * 60 * 1e3;
            await chrome.storage.local.set({ _backupReminderDismissedUntil: dismissUntil });
            this.renderBinder();
          } catch {
          }
        },
        bindEvents() {
          if (this.eventsBound || !this.view || !this.view.elements.binderList) return;
          const container = this.view.elements.binderList;
          container.addEventListener("click", (e) => {
            const toggleBtn = e.target.closest(".sources-toggle");
            if (toggleBtn) {
              e.stopPropagation();
              const box = toggleBtn.closest(".sources-box");
              const list = box?.querySelector(".sources-list");
              if (box && list) {
                const isExpanded = box.classList.toggle("expanded");
                list.hidden = !isExpanded;
                toggleBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
              }
              return;
            }
            const newFolderBtn = e.target.closest("#newFolderBtnBinder");
            if (newFolderBtn) {
              e.preventDefault();
              this.handleCreateFolder();
              return;
            }
            const studyModeBtn = e.target.closest("#btnStudyMode");
            if (studyModeBtn) {
              e.preventDefault();
              this.isStudyMode = !this.isStudyMode;
              this.renderBinder();
              return;
            }
            const studyRevealBtn = e.target.closest(".study-reveal-btn");
            if (studyRevealBtn) {
              e.preventDefault();
              e.stopPropagation();
              studyRevealBtn.style.display = "none";
              const answerBlock = studyRevealBtn.nextElementSibling;
              if (answerBlock && answerBlock.classList.contains("qa-card-answer")) {
                answerBlock.classList.remove("study-hidden");
              }
              return;
            }
            const backBtn = e.target.closest("#btnBackRoot");
            if (backBtn) {
              e.preventDefault();
              this.handleNavigateRoot();
              return;
            }
            const exportBtn = e.target.closest("#exportBinderBtn");
            if (exportBtn) {
              e.preventDefault();
              this.handleExport();
              return;
            }
            const importBtn = e.target.closest("#importBinderBtn");
            if (importBtn) {
              e.preventDefault();
              this.handleImport();
              return;
            }
            const dismissBtn = e.target.closest(".dismiss-reminder");
            if (dismissBtn) {
              e.preventDefault();
              this._dismissBackupReminder();
              return;
            }
            const renameBtn = e.target.closest(".rename-btn");
            if (renameBtn) {
              e.stopPropagation();
              this.handleRename(renameBtn.dataset.id);
              return;
            }
            const delBtn = e.target.closest(".delete-btn");
            if (delBtn) {
              e.stopPropagation();
              this.handleDelete(delBtn.dataset.id);
              return;
            }
            const copyBtn = e.target.closest(".copy-single-btn");
            if (copyBtn) {
              e.stopPropagation();
              const item = StorageModel.findNode(copyBtn.dataset.id);
              if (item && item.content) {
                const text = `${this.t("binder.copy.question")}: ${item.content.question}

${this.t("binder.copy.answer")}: ${item.content.answer}`;
                navigator.clipboard.writeText(text);
              }
              return;
            }
            const folderItem = e.target.closest(".folder-item");
            if (folderItem) {
              this.handleNavigate(folderItem.dataset.id);
              return;
            }
            const expandItem = e.target.closest(".qa-item.expandable");
            if (expandItem) {
              expandItem.classList.toggle("expanded");
              const fullView = expandItem.querySelector(".full-view");
              if (fullView) {
                fullView.style.display = fullView.style.display === "none" ? "block" : "none";
              }
            }
          });
          container.addEventListener("dragstart", (e) => {
            const draggable = e.target.closest('[draggable="true"]');
            if (!draggable) return;
            e.dataTransfer.setData("text/plain", draggable.dataset.id);
            e.dataTransfer.effectAllowed = "move";
            draggable.classList.add("dragging");
            this.draggedItemId = draggable.dataset.id;
          });
          container.addEventListener("dragend", () => {
            this.draggedItemId = null;
            container.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
            container.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
          });
          container.addEventListener("dragover", (e) => {
            const folder = e.target.closest(".folder-item");
            if (!folder) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            folder.classList.add("drag-over");
          });
          container.addEventListener("dragleave", (e) => {
            const folder = e.target.closest(".folder-item");
            if (folder) folder.classList.remove("drag-over");
          });
          container.addEventListener("drop", (e) => {
            const folder = e.target.closest(".folder-item");
            if (!folder) return;
            e.preventDefault();
            folder.classList.remove("drag-over");
            const itemId = e.dataTransfer.getData("text/plain") || this.draggedItemId;
            const targetId = folder.dataset.id;
            if (itemId && targetId && itemId !== targetId) {
              this.handleMoveItem(itemId, targetId);
            }
          });
          this.eventsBound = true;
        },
        async handleCreateFolder() {
          const name = prompt(this.t("binder.prompt.newFolder"));
          if (name) {
            await StorageModel.createFolder(name);
            this.renderBinder();
          }
        },
        handleNavigate(folderId) {
          StorageModel.currentFolderId = folderId;
          this.renderBinder();
        },
        handleNavigateRoot() {
          StorageModel.currentFolderId = "root";
          this.renderBinder();
        },
        async handleRename(id) {
          const node = StorageModel.findNode(id);
          if (!node || node.type !== "folder") return;
          const newName = prompt(this.t("binder.prompt.renameFolder"), node.title);
          if (newName && newName.trim() && newName.trim() !== node.title) {
            await StorageModel.renameFolder(id, newName.trim());
            this.renderBinder();
          }
        },
        async handleDelete(id) {
          const node = StorageModel.findNode(id);
          if (!node) return;
          if (node.type === "folder" && node.children && node.children.length > 0) {
            const choice = prompt(this.t("binder.prompt.deleteFolderOptions", {
              title: node.title,
              count: node.children.length
            }));
            if (choice === "1") {
              await StorageModel.deleteNode(id);
              this.renderBinder();
              this.refreshSearchSaveStates();
            } else if (choice === "2") {
              await StorageModel.deleteFolderKeepChildren(id);
              this.renderBinder();
              this.refreshSearchSaveStates();
            }
            return;
          }
          if (confirm(this.t("binder.confirm.deleteItem"))) {
            const success = await StorageModel.deleteNode(id);
            if (success) {
              this.renderBinder();
              this.refreshSearchSaveStates();
            }
          }
        },
        async handleClearAll() {
          if (confirm(this.t("binder.confirm.clearAll"))) {
            await StorageModel.clearAll();
            this.renderBinder();
            this.view.resetAllSaveButtons();
            this.refreshSearchSaveStates();
          }
        },
        async handleMoveItem(itemId, targetFolderId) {
          await StorageModel.moveItem(itemId, targetFolderId);
          this.renderBinder();
        },
        refreshSearchSaveStates() {
          const resultsDiv = this.view?.elements?.resultsDiv;
          if (!resultsDiv) return;
          const buttons = resultsDiv.querySelectorAll(".save-btn");
          buttons.forEach((btn) => {
            const dataContent = btn.dataset.content;
            if (!dataContent) return;
            try {
              const data = JSON.parse(decodeURIComponent(dataContent));
              const saved = StorageModel.isSaved(data.question);
              this.view.setSaveButtonState(btn, saved);
            } catch (error) {
              console.warn("BinderController: erro ao atualizar status de salvo", error);
            }
          });
        },
        // Called when clicking Save/Remove button in search results
        async toggleSaveItem(question, answer, source, btnElement) {
          const isSaved = btnElement.classList.contains("saved");
          if (isSaved) {
            const removed = await StorageModel.removeByContent(question);
            if (removed) {
              this.view.setSaveButtonState(btnElement, false);
            }
          } else {
            const added = await StorageModel.addItem(question, answer, source);
            this.view.setSaveButtonState(btnElement, true);
            if (!added) {
              console.warn("BinderController: duplicate item, not added.");
            }
          }
        },
        // === EXPORT / IMPORT ===
        async handleExport() {
          try {
            const data = StorageModel.data;
            if (!data || data.length === 0) {
              if (this.view.showToast) {
                this.view.showToast(this.t("binder.toast.nothingToExport"), "error");
              }
              return;
            }
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `answerhunter-backup-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            await this._saveLastExportTimestamp();
            if (this.view.showToast) {
              this.view.showToast(this.t("binder.toast.exportSuccess"), "success");
            }
          } catch (err) {
            console.error("Export error:", err);
            if (this.view.showToast) {
              this.view.showToast(this.t("binder.toast.exportError", { message: err.message }), "error");
            }
          }
        },
        async handleImport() {
          try {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json";
            input.style.display = "none";
            document.body.appendChild(input);
            const cleanupInput = () => {
              if (document.body.contains(input)) document.body.removeChild(input);
            };
            window.addEventListener("focus", function onWindowFocus() {
              window.removeEventListener("focus", onWindowFocus);
              setTimeout(cleanupInput, 500);
            }, { once: true });
            input.addEventListener("change", async (e) => {
              try {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                let data;
                try {
                  data = JSON.parse(text);
                } catch (e2) {
                  throw new Error("Invalid JSON format");
                }
                if (data && !Array.isArray(data) && Array.isArray(data.binderStructure)) {
                  data = data.binderStructure;
                }
                if (!Array.isArray(data) || data.length === 0) {
                  if (this.view.showToast) {
                    this.view.showToast(this.t("binder.toast.invalidFile"), "error");
                  }
                  return;
                }
                if (!confirm(this.t("binder.confirm.importReplace"))) return;
                await StorageModel.importData(data);
                this.renderBinder();
                if (this.view.showToast) {
                  this.view.showToast(this.t("binder.toast.importSuccess"), "success");
                }
              } catch (innerErr) {
                console.error("Import processing error:", innerErr);
                if (this.view.showToast) {
                  this.view.showToast(this.t("binder.toast.importError", { message: innerErr.message }), "error");
                }
              } finally {
                document.body.removeChild(input);
              }
            });
            input.click();
          } catch (err) {
            console.error("Import setup error:", err);
            if (this.view.showToast) {
              this.view.showToast(this.t("binder.toast.importError", { message: err.message }), "error");
            }
          }
        }
      };
    }
  });

  // src/utils/helpers.js
  function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function isLikelyQuestion(text) {
    if (!text) return false;
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length < 30) return false;
    const hasQuestionMark = clean.includes("?");
    const hasKeywords = /Quest(?:a|ã)o|Pergunta|Exerc[íi]cio|Enunciado|Atividade/i.test(clean);
    const hasOptions = /(?:^|\s)[A-E]\s*[\)\.\-:]/i.test(clean);
    const looksLikeMenu = /menu|disciplina|progresso|conteudos|concluidos|simulados|acessar|voltar|avançar|finalizar|marcar para revis[aã]o/i.test(clean);
    return (hasQuestionMark || hasKeywords || hasOptions) && !looksLikeMenu;
  }
  function formatQuestionText(text) {
    if (!text) return "";
    const translate = (key, fallback) => {
      try {
        if (typeof window !== "undefined" && typeof window.__answerHunterTranslate === "function") {
          return window.__answerHunterTranslate(key);
        }
      } catch (_) {
      }
      return fallback;
    };
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const trimGlobalNoise = (raw) => {
      if (!raw) return "";
      const noiseRe = /(?:^|\n)\s*(?:Gabarito(?:\s+Comentado)?|Resposta\s+sugerida|Confira\s+o\s+gabarito|Resposta\s+certa|Voc[eê]\s+selecionou|Fontes?\s*\(\d+\)|check_circle)\b/im;
      const idx = raw.search(noiseRe);
      if (idx > 10) return raw.substring(0, idx).trim();
      return raw.trim();
    };
    const trimNoise = (s) => {
      if (!s) return s;
      let value = String(s).trim();
      const isolatedNoiseRe = /(?:^|\n)\s*(?:Resposta\s+correta\s*[:\-]|Parab[eé]ns|Gabarito(?:\s+Comentado)?|Alternativa\s+correta\s*[:\-]|Confira\s+o\s+gabarito|Resposta\s+certa|Voc[eê]\s+selecionou|Marcar\s+para\s+revis[ãa]o)\b/im;
      let idx = value.search(isolatedNoiseRe);
      if (idx > 10) return value.substring(0, idx).trim();
      const inlineNoiseRe = /\b(?:Gabarito(?:\s+Comentado)?|Resposta\s+correta|Alternativa\s+correta|Parab[eé]ns|Voc[eê]\s+acertou|Confira\s+o\s+gabarito)\b/i;
      idx = value.search(inlineNoiseRe);
      if (idx > 20) value = value.substring(0, idx).trim();
      return value.trim();
    };
    const limitToFirstQuestion = (raw) => {
      const lines = raw.split("\n");
      const result = [];
      let altCount = 0;
      const altRe = /^([A-E])\s*(?:[\)\.\-:]|->>|->|=>)/i;
      const newQuestionRe = /^\d+\s*[\.\):]?\s*(Marcar para|Quest[ãa]o|\(.*\/\d{4})/i;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (newQuestionRe.test(line.trim()) && altCount >= 2) {
          break;
        }
        if (altRe.test(line.trim())) {
          altCount++;
        }
        result.push(line);
        if (altCount >= 5) {
          const nextLines = lines.slice(result.length, result.length + 2);
          const hasMoreAlt = nextLines.some((l) => altRe.test(l.trim()));
          if (!hasMoreAlt) break;
        }
      }
      return result.join("\n");
    };
    const rawTrimmed = trimGlobalNoise(text);
    let normalized = rawTrimmed.replace(/\r\n/g, "\n");
    const inlineAltBreakRe = /(?:^|\s)([A-E])\s*(?:[\)\.\-:]|->>|->|=>)(?=\s*\S)/gi;
    const inlineAltMatches = normalized.match(inlineAltBreakRe) || [];
    if (inlineAltMatches.length >= 2) {
      normalized = normalized.replace(inlineAltBreakRe, (_m, letter) => `
${letter.toUpperCase()}) `);
    }
    const limitedText = limitToFirstQuestion(normalized);
    const normalizedForParsing = limitedText;
    const looksLikeAcronymStart = (body) => {
      const match = (body || "").match(/^([A-Z\u00C0-\u00DC]{2,5})(\b|\s*\()/);
      return !!match;
    };
    const isLikelyFalseLooseAlt = (letter, body, lineIndex, hasAlternatives) => {
      if (hasAlternatives) return false;
      if (letter !== "A") return false;
      if (lineIndex <= 2 && looksLikeAcronymStart(body)) return true;
      return false;
    };
    const render = (enunciado, alternatives2) => {
      const limitedAlts = alternatives2.slice(0, 5);
      const formattedAlternatives = limitedAlts.map((a) => `
                    <div class="alternative">
                        <span class="alt-letter">${escapeHtml(a.letter)}</span>
                        <span class="alt-text">${escapeHtml(a.body)}</span>
                    </div>
                `).join("");
      const enunciadoHtml = `
                <div class="question-section">
                    <div class="question-section-title">${escapeHtml(translate("result.statement", "Statement"))}</div>
                    <div class="question-enunciado">${escapeHtml(enunciado)}</div>
                </div>`;
      if (!formattedAlternatives) {
        return enunciadoHtml;
      }
      return `
                ${enunciadoHtml}
                <div class="question-section">
                    <div class="question-section-title">${escapeHtml(translate("result.options", "Options"))}</div>
                    <div class="question-alternatives">${formattedAlternatives}</div>
                </div>
            `;
    };
    const parseByLines = (raw, allowLoose = false) => {
      const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const alternatives2 = [];
      const enunciadoParts = [];
      let currentAlt = null;
      const altStartRe = allowLoose ? /^([A-E])\s*(?:(?:[\)\.\-:]|->>|->|=>)\s*|\s+)(.+)$/i : /^([A-E])\s*(?:[\)\.\-:]|->>|->|=>)\s*(.+)$/i;
      const altSoloRe = /^([A-E])$/i;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m2 = line.match(altStartRe);
        if (m2) {
          const letter = m2[1].toUpperCase();
          const body = trimNoise(clean(m2[2]));
          if (allowLoose && isLikelyFalseLooseAlt(letter, body, i, alternatives2.length > 0)) {
            enunciadoParts.push(line);
            continue;
          }
          if (currentAlt) alternatives2.push(currentAlt);
          currentAlt = { letter, body };
          continue;
        }
        const solo = line.match(altSoloRe);
        if (solo) {
          if (currentAlt) alternatives2.push(currentAlt);
          currentAlt = { letter: solo[1].toUpperCase(), body: "" };
          continue;
        }
        if (currentAlt) {
          currentAlt.body = trimNoise(clean(`${currentAlt.body} ${line}`));
        } else {
          enunciadoParts.push(line);
        }
      }
      if (currentAlt) alternatives2.push(currentAlt);
      return { enunciado: clean(enunciadoParts.join(" ")), alternatives: alternatives2 };
    };
    const parsedByLines = parseByLines(normalizedForParsing, false);
    if (parsedByLines.alternatives.length >= 2) {
      return render(parsedByLines.enunciado, parsedByLines.alternatives);
    }
    const parsedByLooseLines = parseByLines(normalizedForParsing, true);
    if (parsedByLooseLines.alternatives.length >= 2) {
      return render(parsedByLooseLines.enunciado, parsedByLooseLines.alternatives);
    }
    const inlineAltPattern = /(^|[\\n:;?.!]\\s+)([A-E])\\s+(?=[A-Za-z])/g;
    const inlineAltLetters = /* @__PURE__ */ new Set();
    normalized.replace(inlineAltPattern, (_m, _prefix, letter) => {
      inlineAltLetters.add(letter.toUpperCase());
      return _m;
    });
    if (inlineAltLetters.size >= 2) {
      const normalizedInline = normalized.replace(inlineAltPattern, (m2, prefix, letter, offset, full) => {
        const after = full.slice(offset + m2.length);
        if (letter.toUpperCase() === "A") {
          const nextWord = after.match(/^([A-Z\u00C0-\u00DC]{2,5})\b/);
          if (nextWord) return m2;
        }
        return `${prefix}
${letter}) `;
      });
      const parsedInline = parseByLines(normalizedInline, false);
      if (parsedInline.alternatives.length >= 2) {
        return render(parsedInline.enunciado, parsedInline.alternatives);
      }
    }
    const inlinePattern = /(^|[\s])([A-E])\s*(?:[\)\.\-:]|->>|->|=>)\s*([^]*?)(?=(?:\s)[A-E]\s*(?:[\)\.\-:]|->>|->|=>)|$)/gi;
    const alternatives = [];
    let firstIndex = null;
    let m;
    while ((m = inlinePattern.exec(normalized)) !== null) {
      if (firstIndex === null) firstIndex = m.index + m[1].length;
      const letter = m[2].toUpperCase();
      const body = trimNoise(clean(m[3]));
      if (body) alternatives.push({ letter, body });
    }
    if (alternatives.length >= 2) {
      const enunciado = firstIndex !== null ? clean(normalized.substring(0, firstIndex)) : "";
      return render(enunciado, alternatives);
    }
    const plainAltPattern = /(?:^|[.!?]\\s+)([A-E])\\s+([A-Za-z][^]*?)(?=(?:[.!?]\\s+)[A-E]\\s+[A-Za-z]|$)/g;
    const plainAlternatives = [];
    let plainFirstIndex = null;
    let pm;
    while ((pm = plainAltPattern.exec(normalized)) !== null) {
      if (plainFirstIndex === null) plainFirstIndex = pm.index;
      const letter = pm[1].toUpperCase();
      const body = trimNoise(clean(pm[2].replace(/\s+[.!?]\s*$/, "")));
      if (body) plainAlternatives.push({ letter, body });
    }
    if (plainAlternatives.length >= 2) {
      const enunciado = plainFirstIndex !== null ? clean(normalized.substring(0, plainFirstIndex)) : "";
      return render(enunciado, plainAlternatives);
    }
    return `
        <div class="question-section">
            <div class="question-section-title">${escapeHtml(translate("result.statement", "Statement"))}</div>
            <div class="question-enunciado">${escapeHtml(clean(normalized))}</div>
        </div>`;
  }
  var init_helpers = __esm({
    "src/utils/helpers.js"() {
    }
  });

  // src/controllers/PopupController.js
  var PopupController;
  var init_PopupController = __esm({
    "src/controllers/PopupController.js"() {
      init_ExtractionService();
      init_SearchService();
      init_ApiService();
      init_BinderController();
      init_StorageModel();
      init_SettingsModel();
      init_I18nService();
      init_helpers();
      PopupController = {
        view: null,
        currentSetupStep: 1,
        onboardingFlags: { welcomed: false, setupDone: false },
        _isReopenMode: false,
        async init(view) {
          this.view = view;
          this.view.setTranslator((key, variables) => I18nService.t(key, variables));
          await I18nService.init();
          I18nService.apply(document);
          window.__answerHunterTranslate = (key, variables) => I18nService.t(key, variables);
          BinderController.init(view);
          this.setupEventListeners();
          await StorageModel.init();
          await this.loadOnboardingFlags();
          await this.fillInputsFromSettings();
          await this.restoreDraftKeys();
          await this.syncLanguageSelector();
          await this.ensureSetupReady();
          await this.restoreLastResults({ clear: false });
          window.addEventListener("pagehide", () => {
            this.clearDraftKeys();
          }, { once: true });
        },
        setupEventListeners() {
          this.view.elements.settingsBtn?.addEventListener("click", () => this.toggleSetupPanel());
          this.view.elements.welcomeStartBtn?.addEventListener("click", () => this.handleWelcomeStart());
          this.view.elements.btnNextGroq?.addEventListener("click", () => this.goToSetupStep(2));
          this.view.elements.prevGroq?.addEventListener("click", () => this.goToSetupStep(0));
          this.view.elements.btnNextSerper?.addEventListener("click", () => this.goToSetupStep(3));
          this.view.elements.prevSerper?.addEventListener("click", () => this.goToSetupStep(1));
          this.view.elements.prevGemini?.addEventListener("click", () => this.goToSetupStep(2));
          this.view.elements.btnNextGemini?.addEventListener("click", () => this.goToSetupStep(4));
          this.view.elements.btnNextOpenrouter?.addEventListener("click", () => this.goToSetupStep(5));
          this.view.elements.prevOpenrouter?.addEventListener("click", () => this.goToSetupStep(3));
          this.view.elements.prevPrefs?.addEventListener("click", () => this.goToSetupStep(4));
          this.view.elements.saveSetupBtn?.addEventListener("click", () => this.handleSaveSetup());
          this.view.elements.setupSkipBtn?.addEventListener("click", () => this.handleSaveSetup());
          this.view.elements.selectSearchProvider?.addEventListener("change", () => {
            this.applySearchProviderSelection(this.getSelectedSearchProvider(), {
              persistDraft: true,
              resetValidation: true
            });
          });
          this.view.elements.pillGroq?.addEventListener("click", () => {
            this.setProviderPill("groq");
          });
          this.view.elements.pillGemini?.addEventListener("click", () => {
            this.setProviderPill("gemini");
          });
          this.view.elements.pillOpenrouterOb?.addEventListener("click", () => {
            this.setProviderPill("openrouter");
          });
          this.view.elements.pillGroqOb?.addEventListener("click", () => {
            this.setProviderPill("groq");
          });
          this.view.elements.pillGeminiOb?.addEventListener("click", () => {
            this.setProviderPill("gemini");
          });
          this.view.elements.selectGroqModel?.addEventListener("change", () => this.persistAiConfig());
          this.view.elements.selectGeminiModel?.addEventListener("change", () => this.persistAiConfig());
          this.view.elements.selectOpenrouterModel?.addEventListener("change", () => this.persistAiConfig());
          this.view.elements.extractBtn?.addEventListener("click", () => this.handleExtract());
          this.view.elements.searchBtn?.addEventListener("click", () => this.handleSearch());
          this.view.elements.copyBtn?.addEventListener("click", () => this.handleCopyAll());
          this.view.elements.clearBinderBtn?.addEventListener("click", () => BinderController.handleClearAll());
          this.view.elements.tabs.forEach((tab) => {
            tab.addEventListener("click", () => {
              const target = tab.dataset.tab;
              this.view.switchTab(target);
              if (target === "binder") {
                BinderController.renderBinder();
              }
            });
          });
          this.view.elements.resultsDiv?.addEventListener("click", (event) => this.handleResultClick(event));
          this.view.elements.languageToggle?.addEventListener("click", async (event) => {
            const btn = event.target.closest(".lang-btn");
            if (btn && btn.dataset.lang) {
              await this.handleLanguageChange(btn.dataset.lang);
            }
          });
          const bindProviderTestButton = (button, fallbackProvider = "") => {
            if (!button || button.dataset.testBound === "1") return;
            const providerCandidate = (button.dataset.provider || fallbackProvider || button.id?.replace(/^test-/, "") || "").toLowerCase().trim();
            if (!["groq", "serper", "gemini"].includes(providerCandidate)) return;
            button.dataset.testBound = "1";
            button.addEventListener("click", (event) => {
              event.preventDefault();
              this.handleTestProvider(providerCandidate);
            });
          };
          bindProviderTestButton(this.view.elements.testGroq, "groq");
          bindProviderTestButton(this.view.elements.testSerper, "serper");
          bindProviderTestButton(this.view.elements.testGemini, "gemini");
          bindProviderTestButton(this.view.elements.testOpenrouter, "openrouter");
          document.querySelectorAll(".ob-btn-test, .test-btn").forEach((button) => {
            bindProviderTestButton(button);
          });
          document.querySelectorAll(".visibility-toggle").forEach((button) => {
            this.view.setupVisibilityToggle(button);
          });
          [
            { input: this.view.elements.inputGroq, provider: "groq", prefix: "gsk_" },
            { input: this.view.elements.inputSerper, provider: "serper", prefix: "" },
            { input: this.view.elements.inputGemini, provider: "gemini", prefix: "AIza" },
            { input: this.view.elements.inputOpenrouter, provider: "openrouter", prefix: "sk-or" }
          ].forEach(({ input, provider, prefix }) => {
            if (!input) return;
            input.addEventListener("paste", () => {
              setTimeout(() => {
                this.saveDraftKeys();
                this.resetProviderValidation(provider);
                this.view.showPasteNotification(input);
                this.view.updateKeyFormatHint(provider, input.value, prefix);
              }, 50);
            });
            input.addEventListener("input", () => {
              this.saveDraftKeys();
              this.resetProviderValidation(provider);
              this.view.updateKeyFormatHint(
                provider,
                input.value,
                provider === "groq" ? "gsk_" : provider === "gemini" ? "AIza" : provider === "openrouter" ? "sk-or" : ""
              );
            });
          });
          this.view.elements.obLanguageToggle?.addEventListener("click", async (event) => {
            const btn = event.target.closest(".ob-lang-btn");
            if (btn && btn.dataset.lang) {
              await this.handleLanguageChange(btn.dataset.lang);
            }
          });
          ["groq", "serper", "gemini", "openrouter"].forEach((provider) => {
            const cap = provider.charAt(0).toUpperCase() + provider.slice(1);
            const changeBtn = this.view.elements[`changeKey${cap}`];
            if (changeBtn) {
              changeBtn.addEventListener("click", () => this.handleChangeKey(provider));
            }
            const closeBtn = this.view.elements[`closeSettings${cap}`];
            if (closeBtn) {
              closeBtn.addEventListener("click", () => this.handleCloseSettings());
            }
          });
          this.view.elements.removeKeySerper?.addEventListener("click", () => this.handleRemoveSerperKey());
          this.view.elements.removeKeyGemini?.addEventListener("click", () => this.handleRemoveGeminiKey());
          this.view.elements.removeKeyOpenrouter?.addEventListener("click", () => this.handleRemoveOpenrouterKey());
          this.view.elements.binderGoToSearch?.addEventListener("click", () => {
            this.view.switchTab("search");
          });
          document.addEventListener("mouseup", async (e) => {
            if (e.target.closest(".dict-tooltip")) return;
            const selection = window.getSelection();
            const text = selection.toString().trim();
            const existing = document.querySelector(".dict-tooltip");
            if (existing) existing.remove();
            if (text && text.length > 0 && text.length < 50 && text.split(/\s+/).length <= 5) {
              const cardContext = e.target.closest(".qa-card-question, .qa-card-answer, .full-question-text, .full-answer-text, .qa-card-answer-text, .alt-text");
              if (cardContext) {
                try {
                  const range = selection.getRangeAt(0);
                  const rect = range.getBoundingClientRect();
                  const tooltip = document.createElement("div");
                  tooltip.className = "dict-tooltip";
                  tooltip.innerHTML = `<span class="material-symbols-rounded spin-loading" style="font-size:14px; vertical-align: middle;">sync</span> <span style="font-size:12px; margin-left:4px; vertical-align: middle;">Definindo...</span>`;
                  tooltip.style.position = "absolute";
                  tooltip.style.left = `${Math.max(10, rect.left + window.scrollX)}px`;
                  tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
                  tooltip.style.zIndex = "99999";
                  tooltip.style.backgroundColor = "var(--bg-card, #fff)";
                  tooltip.style.border = "1px solid var(--border-color, #eee)";
                  tooltip.style.padding = "8px 12px";
                  tooltip.style.borderRadius = "8px";
                  tooltip.style.boxShadow = "0 10px 25px rgba(0,0,0,0.15)";
                  tooltip.style.maxWidth = "250px";
                  tooltip.style.color = "var(--text-color, #333)";
                  tooltip.style.fontFamily = "var(--font-family, sans-serif)";
                  document.body.appendChild(tooltip);
                  const contextText = cardContext.textContent || "";
                  const ApiModule = await Promise.resolve().then(() => (init_ApiService(), ApiService_exports));
                  const definition = await ApiModule.ApiService.defineTerm(text, contextText);
                  const escapeHtml2 = (str) => {
                    const div = document.createElement("div");
                    div.textContent = str;
                    return div.innerHTML;
                  };
                  tooltip.innerHTML = `<div style="font-size:12.5px; line-height: 1.45;"><strong>${escapeHtml2(text)}:</strong> ${escapeHtml2(definition)}</div>`;
                } catch (err) {
                  console.warn("AnswerHunter Dict Error", err);
                  document.querySelector(".dict-tooltip")?.remove();
                }
              }
            }
          });
        },
        t(key, variables) {
          return I18nService.t(key, variables);
        },
        async syncLanguageSelector() {
          const settings = await SettingsModel.getSettings();
          this.view.setLanguageSelectValue(settings.language || "en");
        },
        async handleLanguageChange(language) {
          await I18nService.setLanguage(language);
          I18nService.apply(document);
          await this.syncLanguageSelector();
          const currentTabIsBinder = document.querySelector(".tab-btn.active")?.dataset.tab === "binder";
          if (currentTabIsBinder) {
            await BinderController.renderBinder();
            return;
          }
          await this.restoreLastResults({ clear: true });
        },
        async getProviderReadiness() {
          const settings = await SettingsModel.getSettings();
          return SettingsModel.getProviderReadiness(settings);
        },
        async ensureSetupReady() {
          const readiness = await this.getProviderReadiness();
          if (!readiness.ready) {
            this.view.setSettingsAttention(true);
            if (!this.onboardingFlags.welcomed) {
              this.view.showWelcomeOverlay();
            } else if (!this.onboardingFlags.setupDone) {
              this.toggleSetupPanel(true);
            }
            return;
          }
          this.view.setSettingsAttention(false);
          this.onboardingFlags.setupDone = true;
          await this.saveOnboardingFlags();
        },
        async ensureReadyOrShowSetup() {
          const readiness = await this.getProviderReadiness();
          if (readiness.ready) return true;
          this.view.setSettingsAttention(true);
          this.view.showToast(this.t("setup.toast.required"), "error");
          this.view.showStatus("error", this.t("setup.toast.required"));
          if (!this.onboardingFlags.welcomed) {
            this.view.showWelcomeOverlay();
          } else {
            this.toggleSetupPanel(true);
          }
          return false;
        },
        async fillInputsFromSettings() {
          const settings = await SettingsModel.getSettings();
          const keys = await SettingsModel.getApiKeys();
          if (this.view.elements.inputGroq) {
            this.view.elements.inputGroq.value = keys.groqKey || this.view.elements.inputGroq.value || "";
          }
          if (this.view.elements.inputSerper) {
            this.view.elements.inputSerper.value = keys.serperKey || this.view.elements.inputSerper.value || "";
          }
          if (this.view.elements.inputOpenrouter) {
            this.view.elements.inputOpenrouter.value = keys.openrouterKey || this.view.elements.inputOpenrouter.value || "";
          }
          if (this.view.elements.inputGemini) {
            this.view.elements.inputGemini.value = keys.geminiKey || this.view.elements.inputGemini.value || "";
          }
          this.applySearchProviderSelection(this.getSearchProviderFromUrl(settings.serperApiUrl), {
            persistDraft: false,
            resetValidation: false
          });
          this.restoreAiConfig(settings);
        },
        /** Restore AI provider toggle and model selects from saved settings */
        restoreAiConfig(settings) {
          const provider = settings.primaryProvider || "groq";
          const pills = [this.view.elements.pillGroq, this.view.elements.pillGemini, this.view.elements.pillOpenrouter];
          pills.forEach((p) => p?.classList.remove("active"));
          if (provider === "openrouter") {
            this.view.elements.pillOpenrouter?.classList.add("active");
          } else if (provider === "gemini") {
            this.view.elements.pillGemini?.classList.add("active");
          } else {
            this.view.elements.pillGroq?.classList.add("active");
          }
          this.updateProviderHint(provider);
          const groqModel = settings.groqModelSmart || "llama-3.3-70b-versatile";
          const geminiModel = settings.geminiModelSmart || "gemini-2.5-flash";
          if (this.view.elements.selectGroqModel) {
            this.view.elements.selectGroqModel.value = groqModel;
          }
          if (this.view.elements.selectGeminiModel) {
            this.view.elements.selectGeminiModel.value = geminiModel;
          }
          this.syncObPills(provider);
        },
        syncObPills(provider) {
          const obPills = [this.view.elements.pillGroqOb, this.view.elements.pillGeminiOb, this.view.elements.pillOpenrouterOb];
          obPills.forEach((p) => p?.classList.remove("active"));
          if (provider === "gemini") {
            this.view.elements.pillGeminiOb?.classList.add("active");
          } else if (provider === "openrouter") {
            this.view.elements.pillOpenrouterOb?.classList.add("active");
          } else {
            this.view.elements.pillGroqOb?.classList.add("active");
          }
        },
        hasOpenrouterKey() {
          return SettingsModel.isPresent(this.sanitizeKey(this.view.elements.inputOpenrouter?.value));
        },
        hasGeminiKey() {
          return SettingsModel.isPresent(this.sanitizeKey(this.view.elements.inputGemini?.value));
        },
        /** Handle provider pill click */
        setProviderPill(provider) {
          let effectiveProvider = provider;
          if (provider === "openrouter" && !this.hasOpenrouterKey()) {
            effectiveProvider = "groq";
            this.view.showToast(this.t("setup.toast.noOpenrouterKeySaved") || "OpenRouter key missing", "warning");
            this.view.setSetupStatus("openrouter", "Missing OpenRouter key", "error");
          }
          if (provider === "gemini" && !this.hasGeminiKey()) {
            effectiveProvider = "groq";
            this.view.showToast(this.t("setup.toast.noGeminiKeySaved"), "warning");
            this.view.setSetupStatus("gemini", this.t("setup.status.geminiMissing"), "error");
          }
          const pills = [this.view.elements.pillGroq, this.view.elements.pillGemini];
          pills.forEach((p) => p?.classList.remove("active"));
          if (effectiveProvider === "openrouter") {
            this.view.elements.pillOpenrouter?.classList.add("active");
          } else if (effectiveProvider === "gemini") {
            this.view.elements.pillGemini?.classList.add("active");
          } else {
            this.view.elements.pillGroq?.classList.add("active");
          }
          this.syncObPills(effectiveProvider);
          this.updateProviderHint(effectiveProvider);
          this.persistAiConfig();
          return effectiveProvider;
        },
        /** Update the hint text below the toggle */
        updateProviderHint(provider) {
          const hint = this.view.elements.providerHint;
          if (hint) {
            const key = provider === "gemini" ? "setup.aiConfig.hintGeminiPrimary" : "setup.aiConfig.hintGroqPrimary";
            const text = this.view.t(key);
            if (text) {
              const textSpan = hint.querySelector("span:last-child") || hint;
              textSpan.textContent = text;
            }
          }
          const obHint = document.getElementById("provider-hint-ob");
          if (obHint) {
            const key = provider === "gemini" ? "setup.prefs.hintGemini" : "setup.prefs.hintGroq";
            obHint.textContent = this.view.t(key) || obHint.textContent;
          }
        },
        /** Persist the current AI config selections to storage */
        async persistAiConfig() {
          const isOpenrouter = this.view.elements.pillOpenrouter?.classList.contains("active") || this.view.elements.pillOpenrouterOb?.classList.contains("active");
          const isGemini = this.view.elements.pillGemini?.classList.contains("active") || this.view.elements.pillGeminiOb?.classList.contains("active");
          let primaryProvider = isOpenrouter ? "openrouter" : isGemini ? "gemini" : "groq";
          if (primaryProvider === "openrouter" && !this.hasOpenrouterKey()) {
            primaryProvider = "groq";
            this.view.elements.pillOpenrouter?.classList.remove("active");
            this.view.elements.pillOpenrouterOb?.classList.remove("active");
            this.view.elements.pillGroq?.classList.add("active");
            this.view.elements.pillGroqOb?.classList.add("active");
            this.updateProviderHint("groq");
          }
          if (primaryProvider === "gemini" && !this.hasGeminiKey()) {
            primaryProvider = "groq";
            this.view.elements.pillGemini?.classList.remove("active");
            this.view.elements.pillGeminiOb?.classList.remove("active");
            this.view.elements.pillGroq?.classList.add("active");
            this.view.elements.pillGroqOb?.classList.add("active");
            this.updateProviderHint("groq");
          }
          const groqModel = this.view.elements.selectGroqModel?.value || "llama-3.3-70b-versatile";
          const geminiModel = this.view.elements.selectGeminiModel?.value || "gemini-2.5-flash";
          const openrouterModelSmart = this.view.elements.selectOpenrouterModel?.value || "deepseek/deepseek-r1:free";
          await SettingsModel.saveSettings({ primaryProvider, groqModelSmart: groqModel, geminiModelSmart: geminiModel, geminiModel, openrouterModelSmart });
          console.log(`AnswerHunter: AI config saved \u2014 primary=${primaryProvider}, groq=${groqModel}, gemini=${geminiModel}, or=${openrouterModelSmart}`);
        },
        handleWelcomeStart() {
          this.view.hideWelcomeOverlay();
          this.onboardingFlags.welcomed = true;
          this.saveOnboardingFlags();
          this.goToSetupStep(1);
        },
        async toggleSetupPanel(forceState) {
          const isHidden = this.view.elements.onboardingView?.classList.contains("hidden");
          const shouldShow = forceState !== void 0 ? forceState : isHidden;
          if (shouldShow) {
            const isReopen = this.onboardingFlags.setupDone;
            this._isReopenMode = isReopen;
            this.view.setSetupVisible(true);
            const startStep = isReopen ? 4 : await this.determineCurrentStep();
            if (isReopen) {
              this.view.setSettingsReopenMode(true);
              const settings = await SettingsModel.getSettings();
              this.view.showKeyStatus("groq", SettingsModel.isPresent(settings.groqApiKey));
              this.view.showKeyStatus("serper", SettingsModel.isPresent(settings.serperApiKey));
              this.view.showKeyStatus("gemini", SettingsModel.isPresent(settings.geminiApiKey));
            } else {
              this.view.setSettingsReopenMode(false);
            }
            this.goToSetupStep(startStep);
            return;
          }
          this._isReopenMode = false;
          this.view.setSettingsReopenMode(false);
          this.view.setSetupVisible(false);
        },
        async determineCurrentStep() {
          const settings = await SettingsModel.getSettings();
          if (!SettingsModel.isPresent(settings.groqApiKey)) return 1;
          if (!SettingsModel.isPresent(settings.serperApiKey)) return 2;
          if (!SettingsModel.isPresent(settings.geminiApiKey)) return 3;
          if (!SettingsModel.isPresent(settings.openrouterApiKey)) return 4;
          return 5;
        },
        goToSetupStep(step) {
          let normalizedStep = Number(step);
          if (normalizedStep < 0) normalizedStep = 0;
          if (normalizedStep > 5) normalizedStep = 5;
          this.currentSetupStep = normalizedStep;
          this.view.showSetupStep(normalizedStep);
          if (normalizedStep === 3) {
            this.view.enableNextButton("gemini");
          }
          if (normalizedStep === 4) {
            this.view.enableNextButton("openrouter");
          }
        },
        async updateStepperState() {
        },
        resetProviderValidation(provider) {
          this.view.setTestButtonLoading(provider, "");
          this.view.setSetupStatus(provider, "");
          const inputName = `input${provider.charAt(0).toUpperCase() + provider.slice(1)}`;
          const input = this.view.elements[inputName];
          if (input) input.classList.remove("input-valid");
          if (provider === "groq") {
            this.view.disableNextButton(provider);
          }
        },
        async handleTestProvider(provider) {
          const inputName = `input${provider.charAt(0).toUpperCase() + provider.slice(1)}`;
          const input = this.view.elements[inputName];
          const key = input?.value?.trim();
          if (!key) {
            this.view.setSetupStatus(provider, this.t("setup.status.empty"), "fail");
            this.view.showToast(this.t("setup.toast.pasteKey"), "warning");
            return;
          }
          this.view.setTestButtonLoading(provider, "loading");
          this.view.setSetupStatus(provider, this.t("setup.status.testing"), "loading");
          try {
            let ok = false;
            let failReason = "";
            if (provider === "groq") ok = await this.testGroqKey(key);
            if (provider === "serper") ok = await this.testSerperKey(key);
            if (provider === "openrouter") {
              const orCheck = await this.testOpenrouterKey(key);
              ok = !!orCheck?.ok;
              failReason = orCheck?.reason || "";
            }
            if (provider === "gemini") {
              const geminiCheck = await this.testGeminiKey(key);
              ok = !!geminiCheck?.ok;
              failReason = geminiCheck?.reason || "";
            }
            if (ok) {
              this.view.setTestButtonLoading(provider, "ok");
              this.view.setSetupStatus(provider, this.t("setup.status.ok"), "ok");
              const providerLabel = provider === "serper" ? this.t(this.getSelectedSearchProvider() === "serpapi" ? "provider.serpapi" : "provider.serper") : provider.charAt(0).toUpperCase() + provider.slice(1);
              this.view.showToast(this.t("setup.toast.connectionOk", { provider: providerLabel }), "success");
              input.classList.add("input-valid");
              await this.updateStepperState();
              if (this.currentSetupStep < 4) {
                this.view.showAutoAdvance(() => {
                });
              }
            } else {
              this.view.setTestButtonLoading(provider, "fail");
              if (provider === "gemini" && failReason === "quota") {
                const quotaMsg = "Chave v\xE1lida, mas o projeto Gemini est\xE1 sem cota (HTTP 429). Trocar a chave no mesmo projeto n\xE3o resolve.";
                this.view.setSetupStatus(provider, quotaMsg, "fail");
                this.view.showToast(quotaMsg, "warning");
              } else if (provider === "gemini" && failReason === "rate_limit") {
                const rateMsg = "Gemini respondeu 429 por limite de taxa. Tente novamente em alguns segundos.";
                this.view.setSetupStatus(provider, rateMsg, "fail");
                this.view.showToast(rateMsg, "warning");
              } else {
                this.view.setSetupStatus(provider, this.t("setup.status.error"), "fail");
                this.view.showToast(this.t("setup.toast.invalidKey"), "error");
              }
              input.classList.remove("input-valid");
            }
          } catch (error) {
            console.error(`Provider test error (${provider}):`, error);
            this.view.setTestButtonLoading(provider, "fail");
            this.view.setSetupStatus(provider, `${this.t("setup.status.error")} ${error.message || ""}`.trim(), "fail");
            this.view.showToast(this.t("setup.toast.testError"), "error");
            input.classList.remove("input-valid");
          }
        },
        // handleSkipStep removed/merged into handleSaveSetup
        async testGroqKey(key) {
          try {
            const response = await fetch("https://api.groq.com/openai/v1/models", {
              headers: { Authorization: `Bearer ${key}` }
            });
            return response.ok;
          } catch (_) {
            return false;
          }
        },
        async testSerperKey(key) {
          try {
            const provider = this.getSelectedSearchProvider();
            const providerConfig = this.getSearchProviderConfig(provider);
            let response;
            if (provider === "serpapi") {
              const url = new URL(providerConfig.apiUrl);
              url.searchParams.set("engine", "google");
              url.searchParams.set("q", "api health check");
              url.searchParams.set("num", "1");
              url.searchParams.set("hl", "pt-br");
              url.searchParams.set("gl", "br");
              url.searchParams.set("output", "json");
              url.searchParams.set("api_key", key);
              response = await fetch(url.toString(), { method: "GET" });
            } else {
              response = await fetch(providerConfig.apiUrl, {
                method: "POST",
                headers: {
                  "X-API-KEY": key,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ q: "api health check", num: 1 })
              });
            }
            return response.ok;
          } catch (_) {
            return false;
          }
        },
        async testGeminiKey(key) {
          try {
            const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
            const response = await fetch(url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [{ role: "user", content: "healthcheck" }],
                max_tokens: 1,
                temperature: 0
              })
            });
            if (response.ok) return { ok: true };
            const errText = await response.text().catch(() => "");
            if (response.status === 429) {
              if (/exceeded your current quota|plan and billing|quota/i.test(errText)) {
                return { ok: false, reason: "quota" };
              }
              return { ok: false, reason: "rate_limit" };
            }
            return { ok: false, reason: `http_${response.status}` };
          } catch (_) {
            return { ok: false, reason: "network" };
          }
        },
        async testOpenrouterKey(key) {
          try {
            const url = "https://openrouter.ai/api/v1/chat/completions";
            const response = await fetch(url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "deepseek/deepseek-r1:free",
                messages: [{ role: "user", content: "healthcheck" }],
                max_tokens: 1
              })
            });
            if (response.ok) return { ok: true };
            return { ok: false, reason: "invalid" };
          } catch (_) {
            return { ok: false, reason: "network" };
          }
        },
        /**
         * Handle "Change this key" button click in settings reopen mode.
         * Reveals the input card, hides the key status chip, focuses the input.
         */
        handleChangeKey(provider) {
          const cap = provider.charAt(0).toUpperCase() + provider.slice(1);
          this.view.hideKeyStatus(provider);
          const keyCard = this.view.elements[`input${cap}`]?.closest(".ob-key-card");
          if (keyCard) keyCard.style.display = "";
          const input = this.view.elements[`input${cap}`];
          if (input) {
            input.type = "text";
            input.focus();
            input.select();
          }
          const changeBtn = this.view.elements[`changeKey${cap}`];
          if (changeBtn) changeBtn.classList.add("hidden");
        },
        /**
         * Handle "Close settings" button click. Closes the onboarding panel.
         */
        handleCloseSettings() {
          this._isReopenMode = false;
          this.view.setSettingsReopenMode(false);
          this.view.setSetupVisible(false);
        },
        async handleRemoveSerperKey() {
          if (this.view.elements.inputSerper) {
            this.view.elements.inputSerper.value = "";
            this.view.elements.inputSerper.type = "password";
          }
          const settings = await SettingsModel.getSettings();
          await SettingsModel.saveSettings({
            serperApiKey: "",
            requiredProviders: {
              ...settings.requiredProviders || {},
              serper: false
            }
          });
          this.resetProviderValidation("serper");
          this.view.showKeyStatus("serper", false);
          this.saveDraftKeys();
          this.view.setSetupStatus("serper", this.t("setup.status.serperMissing"), "error");
          this.view.showToast(this.t("setup.toast.serperKeyRemoved"), "success");
        },
        async handleRemoveOpenrouterKey() {
          if (this.view.elements.inputOpenrouter) {
            this.view.elements.inputOpenrouter.value = "";
            this.view.elements.inputOpenrouter.type = "password";
          }
          const settings = await SettingsModel.getSettings();
          const forceGroq = settings.primaryProvider === "openrouter";
          const payload = { openrouterApiKey: "" };
          if (forceGroq) payload.primaryProvider = "groq";
          await SettingsModel.saveSettings(payload);
          this.resetProviderValidation("openrouter");
          this.view.showKeyStatus("openrouter", false);
          this.saveDraftKeys();
          if (forceGroq) {
            this.view.elements.pillOpenrouter?.classList.remove("active");
            this.view.elements.pillOpenrouterOb?.classList.remove("active");
            this.view.elements.pillGroq?.classList.add("active");
            this.view.elements.pillGroqOb?.classList.add("active");
            this.updateProviderHint("groq");
          }
          this.view.setSetupStatus("openrouter", "OpenRouter missing", "error");
          this.view.showToast("OpenRouter key removed", "success");
        },
        async handleRemoveGeminiKey() {
          if (this.view.elements.inputGemini) {
            this.view.elements.inputGemini.value = "";
            this.view.elements.inputGemini.type = "password";
          }
          const settings = await SettingsModel.getSettings();
          const forceGroq = settings.primaryProvider === "gemini";
          const payload = { geminiApiKey: "" };
          if (forceGroq) payload.primaryProvider = "groq";
          await SettingsModel.saveSettings(payload);
          this.resetProviderValidation("gemini");
          this.view.showKeyStatus("gemini", false);
          this.saveDraftKeys();
          if (forceGroq) {
            this.view.elements.pillGemini?.classList.remove("active");
            this.view.elements.pillGeminiOb?.classList.remove("active");
            this.view.elements.pillGroq?.classList.add("active");
            this.view.elements.pillGroqOb?.classList.add("active");
            this.updateProviderHint("groq");
          }
          this.view.setSetupStatus("gemini", this.t("setup.status.geminiMissing"), "error");
          this.view.showToast(this.t("setup.toast.geminiKeyRemoved"), "success");
        },
        async handleSaveSetup() {
          const groqApiKey = this.sanitizeKey(this.view.elements.inputGroq?.value);
          const serperApiKey = this.sanitizeKey(this.view.elements.inputSerper?.value);
          const openrouterApiKey = this.sanitizeKey(this.view.elements.inputOpenrouter?.value);
          const geminiApiKey = this.sanitizeKey(this.view.elements.inputGemini?.value);
          const providerConfig = this.getSearchProviderConfig(this.getSelectedSearchProvider());
          if (!groqApiKey) {
            this.view.showToast(this.t("setup.toast.required"), "error");
            return;
          }
          try {
            await SettingsModel.saveSettings({
              groqApiKey,
              serperApiKey,
              serperApiUrl: providerConfig.apiUrl,
              geminiApiKey,
              openrouterApiKey,
              requiredProviders: {
                groq: true,
                serper: false,
                gemini: false
              }
            });
            this.onboardingFlags.setupDone = true;
            this.onboardingFlags.welcomed = true;
            await this.saveOnboardingFlags();
            await this.clearDraftKeys();
            this.view.setSettingsAttention(false);
            this.view.setSetupVisible(false);
            this.view.showToast(this.t("setup.toast.saved"), "success");
            this.view.showConfetti();
            await this.updateStepperState();
          } catch (error) {
            console.error("Save setup error:", error);
            this.view.showToast(`Save error: ${error.message}`, "error");
          }
        },
        sanitizeKey(value) {
          return (value || "").trim();
        },
        async saveDraftKeys() {
          try {
            const payload = {
              groq: this.view.elements.inputGroq?.value || "",
              serper: this.view.elements.inputSerper?.value || "",
              gemini: this.view.elements.inputGemini?.value || "",
              searchProvider: this.getSelectedSearchProvider()
            };
            await chrome.storage.local.set({ _draftApiKeys: payload });
          } catch (error) {
            console.warn("Could not persist draft keys:", error);
          }
        },
        async restoreDraftKeys() {
          try {
            const data = await chrome.storage.local.get(["_draftApiKeys"]);
            const drafts = data?._draftApiKeys;
            if (!drafts) return;
            if (this.view.elements.inputGroq && !this.view.elements.inputGroq.value && drafts.groq) {
              this.view.elements.inputGroq.value = drafts.groq;
            }
            if (this.view.elements.inputSerper && !this.view.elements.inputSerper.value && drafts.serper) {
              this.view.elements.inputSerper.value = drafts.serper;
            }
            if (this.view.elements.inputGemini && !this.view.elements.inputGemini.value && drafts.gemini) {
              this.view.elements.inputGemini.value = drafts.gemini;
            }
            if (drafts.searchProvider) {
              this.applySearchProviderSelection(drafts.searchProvider, {
                persistDraft: false,
                resetValidation: false
              });
            }
          } catch (error) {
            console.warn("Could not restore draft keys:", error);
          }
        },
        async clearDraftKeys() {
          try {
            await chrome.storage.local.remove(["_draftApiKeys"]);
          } catch (error) {
            console.warn("Could not clear draft keys:", error);
          }
        },
        getSearchProviderFromUrl(url) {
          return /serpapi\.com\//i.test(String(url || "")) ? "serpapi" : "serper";
        },
        getSearchProviderConfig(provider) {
          if (provider === "serpapi") {
            return {
              provider: "serpapi",
              apiUrl: "https://serpapi.com/search.json",
              siteUrl: "https://serpapi.com/"
            };
          }
          return {
            provider: "serper",
            apiUrl: "https://google.serper.dev/search",
            siteUrl: "https://serper.dev/"
          };
        },
        getSelectedSearchProvider() {
          const selected = this.view.elements.selectSearchProvider?.value;
          return selected === "serpapi" ? "serpapi" : "serper";
        },
        applySearchProviderSelection(provider, options = {}) {
          const { persistDraft = false, resetValidation = false } = options;
          const normalizedProvider = provider === "serpapi" ? "serpapi" : "serper";
          const config = this.getSearchProviderConfig(normalizedProvider);
          if (this.view.elements.selectSearchProvider) {
            this.view.elements.selectSearchProvider.value = normalizedProvider;
          }
          if (this.view.elements.linkSearchProvider) {
            this.view.elements.linkSearchProvider.href = config.siteUrl;
          }
          if (resetValidation) {
            this.resetProviderValidation("serper");
          }
          if (persistDraft) {
            this.saveDraftKeys();
          }
        },
        async loadOnboardingFlags() {
          try {
            const data = await chrome.storage.local.get(["_onboardingFlags"]);
            if (data?._onboardingFlags) {
              this.onboardingFlags = { ...this.onboardingFlags, ...data._onboardingFlags };
            }
          } catch (error) {
            console.warn("Could not load onboarding flags:", error);
          }
        },
        async saveOnboardingFlags() {
          try {
            await chrome.storage.local.set({ _onboardingFlags: this.onboardingFlags });
          } catch (error) {
            console.warn("Could not save onboarding flags:", error);
          }
        },
        async handleExtract() {
          if (!await this.ensureReadyOrShowSetup()) return;
          this.view.showStatus("loading", this.t("status.extractingContent"));
          this.view.setButtonDisabled("extractBtn", true);
          this.view.setButtonDisabled("copyBtn", true);
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:") || tab.url.startsWith("chrome-extension://")) {
              this.view.showStatus("error", this.t("status.restrictedPage"));
              return;
            }
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              function: ExtractionService.extractQAContentScript
            });
            const extractedItems = results?.[0]?.result || [];
            if (extractedItems.length === 0) {
              this.view.showStatus("error", this.t("status.noQuestionFound"));
              return;
            }
            this.view.showStatus("loading", this.t("status.refiningWithAi"));
            this.view.clearResults();
            const refined = await SearchService.processExtractedItems(extractedItems);
            if (refined.length === 0) {
              this.view.showStatus("error", this.t("status.noValidQuestion"));
              return;
            }
            const withSaved = refined.map((item) => ({
              ...item,
              saved: StorageModel.isSaved(item.question)
            }));
            this.view.appendResults(withSaved);
            await this.saveLastResults(withSaved);
            this.view.showStatus("success", this.t("status.questionsFound", { count: refined.length }));
            this.view.toggleViewSection("view-search");
            this.view.setButtonDisabled("copyBtn", false);
          } catch (error) {
            console.error("Extract flow error:", error);
            const message = error?.message === "SETUP_REQUIRED" ? this.t("setup.toast.required") : this.t("status.extractError", { message: error.message || "unknown" });
            this.view.showStatus("error", message);
            if (error?.message === "SETUP_REQUIRED") {
              this.toggleSetupPanel(true);
            }
          } finally {
            this.view.setButtonDisabled("extractBtn", false);
          }
        },
        async handleSearch() {
          if (!await this.ensureReadyOrShowSetup()) return;
          this.view.showStatus("loading", this.t("status.gettingQuestion"));
          this.view.setButtonDisabled("searchBtn", true);
          this.view.setButtonDisabled("copyBtn", true);
          this.view.clearResults();
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:") || tab.url.startsWith("chrome-extension://")) {
              this.view.showStatus("error", this.t("status.restrictedPage"));
              return;
            }
            const extractionResults = await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              function: ExtractionService.extractQuestionOnlyScript
            });
            const countDistinctOptions = (text) => {
              if (!text) return 0;
              const matches = text.match(/(?:^|\n)\s*["'â€œâ€â€˜â€™]?\s*([A-E])\s*[\)\.\-:]\s*\S/gi) || [];
              const letters = new Set(matches.map((m) => m.trim().charAt(0).toUpperCase()));
              return letters.size;
            };
            const isValidOptionLine = (line) => {
              const m = String(line || "").trim().match(/^([A-E])\s*[\)\.\-:]\s*(.+)$/i);
              if (!m) return false;
              let body = String(m[2] || "").replace(/\s+/g, " ").trim();
              const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
              const idx = body.search(noise);
              if (idx > 1) body = body.slice(0, idx).trim();
              body = body.replace(/[;:,\-.\s]+$/, "");
              if (!body || body.length < 1) return false;
              if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(body)) return false;
              if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(body)) return false;
              if (/^(?:resposta|gabarito|alternativa\s+correta)\b/i.test(body) && body.length < 60) return false;
              return true;
            };
            const looksLikeCodeOptionBody = (body) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?|\bdb\.\w|\.(find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(body || ""));
            const normalizeOptionBody = (body) => String(body || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^[a-e]\s*[\)\.\-:]\s*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
            const optionTokens = (body) => normalizeOptionBody(body).split(/\s+/).filter((t) => t.length >= 4);
            const buildOptionsProfile = (text) => {
              const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
              const entries = [];
              const letters = /* @__PURE__ */ new Set();
              const tokenSet = /* @__PURE__ */ new Set();
              const re = /^["']?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
              for (const line of lines) {
                const m = line.match(re);
                if (!m) continue;
                const letter = (m[1] || "").toUpperCase();
                const body = String(m[2] || "").replace(/\s+/g, " ").trim();
                if (!isValidOptionLine(`${letter}) ${body}`)) continue;
                entries.push({ letter, body, codeLike: looksLikeCodeOptionBody(body) });
                letters.add(letter);
                optionTokens(body).forEach((t) => tokenSet.add(t));
              }
              const codeCount = entries.filter((e) => e.codeLike).length;
              const codeRatio = entries.length > 0 ? codeCount / entries.length : 0;
              return { entries, letters, tokenSet, codeCount, codeRatio };
            };
            const optionsAreContextuallyRelated = (stemText, optionsTextToCheck) => {
              if (!stemText || !optionsTextToCheck) return true;
              const normalizeTokens = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((t) => t.length >= 4);
              const stopWords = /* @__PURE__ */ new Set([
                "assinale",
                "afirmativa",
                "alternativa",
                "correta",
                "incorreta",
                "quest\xE3o",
                "considere",
                "para",
                "como",
                "quando",
                "cada",
                "qual",
                "onde",
                "quais",
                "entre",
                "sobre",
                "essa",
                "esse",
                "este",
                "esta"
              ]);
              const stemLines = stemText.split("\n").filter((l) => !l.trim().match(/^([A-E])\s*[\)\.\-:]/i));
              const stemNorm = normalizeTokens(stemLines.join(" ")).filter((t) => !stopWords.has(t));
              if (stemNorm.length < 5) return true;
              const stemSet = new Set(stemNorm);
              const optionLines = optionsTextToCheck.split("\n").filter((l) => l.trim().match(/^([A-E])\s*[\)\.\-:]/i));
              if (optionLines.length < 2) return true;
              const optBodies = optionLines.map((l) => l.replace(/^([A-E])\s*[\)\.\-:]\s*/i, "").trim());
              const allOptTokens = normalizeTokens(optBodies.join(" ")).filter((t) => !stopWords.has(t));
              const stemContextTokens = normalizeTokens(stemLines.join(" "));
              const acronymContextHints = /* @__PURE__ */ new Set(["formato", "arquivo", "arquivos", "extensao", "documento", "documentos", "json", "xml", "bson", "yaml", "csv", "dados"]);
              const hasAcronymContext = stemContextTokens.some((t) => acronymContextHints.has(t));
              const avgOptLength = optBodies.reduce((sum, b) => sum + b.length, 0) / optBodies.length;
              const allAcronym = avgOptLength <= 6 && optBodies.every((b) => b.length <= 8);
              if (allOptTokens.length === 0) {
                if (allAcronym) {
                  if (optionLines.length >= 4 && hasAcronymContext) {
                    console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD allowed options (all-acronym, contextual stem match). Options: "${optionLines.slice(0, 3).join(" | ")}"`);
                    return true;
                  }
                  console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected options (all-acronym, no contextual stem match). Options: "${optionLines.slice(0, 3).join(" | ")}"`);
                  return false;
                }
                return true;
              }
              let sharedTokens = 0;
              for (const tk of allOptTokens) {
                if (stemSet.has(tk)) sharedTokens++;
              }
              const overlapRatio = sharedTokens / allOptTokens.length;
              if (allAcronym && overlapRatio === 0) {
                if (optionLines.length >= 4 && hasAcronymContext) {
                  console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD allowed options (all-acronym with contextual stem match). Options: "${optionLines.slice(0, 3).join(" | ")}"`);
                  return true;
                }
                console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected options (all-acronym with 0 stem overlap and no contextual stem match). Options: "${optionLines.slice(0, 3).join(" | ")}"`);
                return false;
              }
              return true;
            };
            let bestQuestion = "";
            let bestScore = -1;
            let bestFrameIndex = -1;
            const frameDiagnostics = [];
            (extractionResults || []).forEach((frameResult) => {
              const text = String(frameResult?.result || "");
              if (text.length < 5) return;
              const optCount = countDistinctOptions(text);
              const isLikely = isLikelyQuestion(text);
              const likelyQuestionBonus = isLikely ? 250 : 0;
              const lengthScore = Math.min(text.length, 3500) / 10;
              const score = optCount * 1e3 + likelyQuestionBonus + lengthScore;
              frameDiagnostics.push({
                frameIndex: Number(frameResult?.frameId ?? frameDiagnostics.length),
                textLength: text.length,
                optCount,
                isLikely,
                score,
                preview: text.replace(/\s+/g, " ").trim().slice(0, 120)
              });
              if (score > bestScore) {
                bestScore = score;
                bestQuestion = text;
                bestFrameIndex = Number(frameResult?.frameId ?? bestFrameIndex);
              }
            });
            if (frameDiagnostics.length > 0) {
              console.group("AnswerHunter: Frame extraction diagnostics");
              frameDiagnostics.sort((a, b) => b.score - a.score).forEach((d, idx) => {
                const tag = idx === 0 ? "WINNER" : "CANDIDATE";
                console.log(
                  `[${tag}] frame=${d.frameIndex} score=${d.score.toFixed(1)} optCount=${d.optCount} likely=${d.isLikely} len=${d.textLength} preview="${d.preview}"`
                );
              });
              console.log(`AnswerHunter: selected frame=${bestFrameIndex} bestScore=${bestScore.toFixed(1)}`);
              console.groupEnd();
            }
            const domQuestion = bestQuestion;
            const domOptionCount = countDistinctOptions(domQuestion);
            let usedVisionOcr = false;
            let ocrVisionText = null;
            const domIsSufficient = domOptionCount >= 4 && (domQuestion || "").length >= 100 && isLikelyQuestion(domQuestion);
            console.log(`AnswerHunter: OCR_PRIORITY mode=conditional frame=${bestFrameIndex} dom_len=${(domQuestion || "").length} opts_dom=${domOptionCount} dom_sufficient=${domIsSufficient}`);
            if (domIsSufficient) {
              console.log("AnswerHunter: OCR_PRIORITY decision=skipped (DOM already sufficient)");
            } else {
              this.view.showStatus("loading", this.t("status.visionOcr") || "Capturando tela para OCR visual...");
              try {
                const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 60 });
                if (dataUrl) {
                  const base64 = dataUrl.split(",")[1];
                  if (base64) {
                    const visionText = await ApiService.extractTextFromScreenshot(base64);
                    if (visionText && visionText.length >= 30) {
                      const visionOpts = countDistinctOptions(visionText);
                      const domOptCount = domOptionCount;
                      console.log(`AnswerHunter: OCR_COMPARE opts_ocr=${visionOpts} opts_dom=${domOptCount} len_ocr=${visionText.length} len_dom=${(domQuestion || "").length}`);
                      console.log(`AnswerHunter: Vision OCR returned ${visionText.length} chars, ${visionOpts} options`);
                      bestQuestion = visionText;
                      usedVisionOcr = true;
                      ocrVisionText = visionText;
                      const domIsLikely = isLikelyQuestion(domQuestion);
                      const ocrHasOptionAdvantage = visionOpts >= domOptCount + 2;
                      const domClearlyBetter = domQuestion && !ocrHasOptionAdvantage && (domOptCount >= Math.max(4, visionOpts + 2) || domQuestion.length > visionText.length * 1.8 && domIsLikely);
                      if (domClearlyBetter) {
                        bestQuestion = domQuestion;
                        usedVisionOcr = false;
                        console.log("AnswerHunter: DOM extraction retained (clearly more complete than OCR)");
                        console.log("AnswerHunter: OCR_PRIORITY decision=dom");
                      } else {
                        console.log("AnswerHunter: Using Vision OCR result as primary statement");
                        console.log("AnswerHunter: OCR_PRIORITY decision=ocr");
                      }
                    } else {
                      console.log("AnswerHunter: Vision OCR returned insufficient text, keeping DOM result");
                      console.log("AnswerHunter: OCR_PRIORITY decision=dom_insufficient_ocr");
                    }
                  }
                }
              } catch (visionErr) {
                console.warn("AnswerHunter: Vision OCR capture failed:", visionErr.message || visionErr);
                console.log("AnswerHunter: OCR_PRIORITY decision=dom_capture_failed");
              }
            }
            if (!bestQuestion || bestQuestion.length < 5) {
              this.view.showStatus("error", this.t("status.selectQuestionText"));
              return;
            }
            const multiQRe = /(?:^|\n)\s*(\d+)[\.\)]\s+\S/g;
            const qNumbers = [];
            let qm;
            while ((qm = multiQRe.exec(bestQuestion)) !== null) {
              qNumbers.push({ num: parseInt(qm[1], 10), index: qm.index });
            }
            if (qNumbers.length >= 2) {
              console.log(`AnswerHunter: Multi-question text detected (questions ${qNumbers.map((q) => q.num).join(", ")}). Isolating viewport question...`);
              try {
                const [viewportResult] = await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  function: () => {
                    const viewportCenter = window.innerHeight / 2;
                    let bestNum = -1;
                    let bestDist = Infinity;
                    document.querySelectorAll("p, div, li, span, h1, h2, h3, h4, h5, h6, td").forEach((el) => {
                      const rect = el.getBoundingClientRect();
                      if (rect.width < 100 || rect.height < 10) return;
                      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
                      const text = (el.innerText || "").trim();
                      const m = text.match(/^\s*(\d+)[\.\)]\s+/);
                      if (!m || text.length < 30) return;
                      const centerY = rect.top + rect.height / 2;
                      const dist = Math.abs(centerY - viewportCenter);
                      if (dist < bestDist) {
                        bestDist = dist;
                        bestNum = parseInt(m[1], 10);
                      }
                    });
                    return bestNum;
                  }
                });
                const targetQNum = viewportResult?.result;
                if (targetQNum && targetQNum > 0) {
                  const targetIdx = qNumbers.findIndex((q) => q.num === targetQNum);
                  if (targetIdx >= 0) {
                    const startIdx = qNumbers[targetIdx].index;
                    const endIdx = targetIdx + 1 < qNumbers.length ? qNumbers[targetIdx + 1].index : bestQuestion.length;
                    const isolated = bestQuestion.substring(startIdx, endIdx).trim();
                    if (isolated.length >= 30) {
                      console.log(`AnswerHunter: Isolated question ${targetQNum} (was extracting from question ${qNumbers[0].num})`);
                      bestQuestion = isolated;
                    }
                  }
                }
              } catch (isoErr) {
                console.warn("AnswerHunter: Multi-question isolation failed, using full text:", isoErr);
              }
            }
            if (!isLikelyQuestion(bestQuestion)) {
              console.log("AnswerHunter: bestQuestion (raw, pre-options) \xE2\u2020\u2019", bestQuestion.substring(0, 200));
              this.view.showStatus("loading", this.t("status.validatingQuestion"));
              const valid = await ApiService.validateQuestion(bestQuestion);
              if (!valid) {
                this.view.showStatus("error", this.t("status.invalidQuestion"));
                return;
              }
            }
            {
              const _inlineOptsRe = /\b([a-eA-E])\s*[\)\.\-:]\s*\S/g;
              const _inlineLetters = /* @__PURE__ */ new Set();
              let _im;
              while ((_im = _inlineOptsRe.exec(bestQuestion)) !== null) {
                _inlineLetters.add(_im[1].toUpperCase());
              }
              const inlineDetected = _inlineLetters.size;
              const lineDetected = countDistinctOptions(bestQuestion);
              if (inlineDetected >= 3 && lineDetected < inlineDetected) {
                bestQuestion = bestQuestion.replace(/(\S)\s+([a-eA-E]\s*[\)\.\-:]\s)/g, "$1\n$2");
                console.log(`AnswerHunter: INLINE_OPTIONS_SPLIT inline=${inlineDetected} wasOnLines=${lineDetected} nowOnLines=${countDistinctOptions(bestQuestion)}`);
              }
            }
            {
              const optionLinesFromBest = String(bestQuestion || "").split("\n").filter((line) => line.trim().match(/^([A-E])\s*[\)\.\-:]\s+/i));
              if (optionLinesFromBest.length >= 2) {
                const stemOnly = String(bestQuestion || "").split("\n").filter((line) => !line.trim().match(/^([A-E])\s*[\)\.\-:]\s+/i)).join("\n").trim();
                const optionsOnly = optionLinesFromBest.join("\n");
                if (!optionsAreContextuallyRelated(stemOnly, optionsOnly)) {
                  bestQuestion = stemOnly || bestQuestion;
                  console.log("AnswerHunter: OPTIONS_CONTAMINATION_GUARD removed unrelated options from primary question text");
                }
              }
            }
            let displayQuestion = bestQuestion;
            const existingOptionCount = countDistinctOptions(bestQuestion);
            if (usedVisionOcr || existingOptionCount < 5) {
              if (usedVisionOcr) {
                console.log(`AnswerHunter: OCR_PRIORITY post-step=dom_options_scan force=true opts_current=${existingOptionCount}`);
              }
              let optionsResults = [];
              if (Number.isFinite(bestFrameIndex) && bestFrameIndex >= 0) {
                try {
                  optionsResults = await chrome.scripting.executeScript({
                    target: { tabId: tab.id, frameIds: [bestFrameIndex] },
                    function: ExtractionService.extractOptionsOnlyScript
                  });
                } catch (_) {
                  optionsResults = [];
                }
              }
              const stemForOptions = String(domQuestion || bestQuestion || "").split("\n").filter((line) => !line.trim().match(/^([A-E])\s*[\)\.\-:]/i)).join("\n").trim();
              const stemTokenCount = normalizeOptionBody(stemForOptions).split(/\s+/).filter((t) => t.length >= 4).length;
              const pickBestOptionsText = (resultsArray) => {
                let bestAnyText = "";
                let bestAnyScore = -1;
                let bestContextText = "";
                let bestContextScore = -1;
                (resultsArray || []).forEach((frameResult) => {
                  const text = String(frameResult?.result || "");
                  if (text.length < 10) return;
                  const optCount = countDistinctOptions(text);
                  if (optCount < 2) return;
                  const lines = text.split("\n").map((line) => String(line || "").trim()).filter((line) => /^([A-E])\s*[\)\.\-:]\s+.+$/i.test(line));
                  const bodies = lines.map((line) => line.replace(/^([A-E])\s*[\)\.\-:]\s*/i, "").trim());
                  const avgBodyLen = bodies.length > 0 ? bodies.reduce((sum, b) => sum + b.length, 0) / bodies.length : 0;
                  const acronymCluster = bodies.length >= 3 && avgBodyLen <= 6 && bodies.every((b) => b.length <= 8);
                  let localScore = optCount * 1e3 + Math.min(text.length, 2500) / 10;
                  if (acronymCluster && stemTokenCount >= 8) localScore -= 1200;
                  const contextOk = optionsAreContextuallyRelated(stemForOptions || bestQuestion, text);
                  if (localScore > bestAnyScore) {
                    bestAnyScore = localScore;
                    bestAnyText = text;
                  }
                  if (contextOk && localScore > bestContextScore) {
                    bestContextScore = localScore;
                    bestContextText = text;
                  }
                });
                if (bestContextText) return bestContextText;
                if (bestAnyText && stemTokenCount >= 8 && !optionsAreContextuallyRelated(stemForOptions || bestQuestion, bestAnyText)) {
                  return "";
                }
                return bestAnyText;
              };
              let optionsText = pickBestOptionsText(optionsResults);
              const anchorSeedText = ocrVisionText || domQuestion || bestQuestion;
              const existingOptionsProfile = buildOptionsProfile(bestQuestion);
              const preferCodeLikeOptions = existingOptionsProfile.entries.length >= 3 && existingOptionsProfile.codeRatio >= 0.66;
              if (Number.isFinite(bestFrameIndex) && bestFrameIndex >= 0 && anchorSeedText) {
                try {
                  const [anchoredResult] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id, frameIds: [bestFrameIndex] },
                    function: (anchorText, preferCode) => {
                      const normalize = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                      const isCodeLike = (body) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?|\bdb\.\w|\.(find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(body || ""));
                      const extractOptionLines = (rawText) => {
                        if (!rawText) return [];
                        const normalized = String(rawText).replace(/\r/g, "\n").replace(/(\S)\s+([A-Ea-e]\s*[\)\.\-:]\s+)/g, "$1\n$2");
                        const lines = normalized.split(/\n+/).map((l) => l.trim()).filter(Boolean);
                        const out = [];
                        const seen = /* @__PURE__ */ new Set();
                        const startRe = /^["']?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
                        let current = null;
                        const flush = () => {
                          if (!current) return;
                          const letter = (current.letter || "").toUpperCase();
                          let body = String(current.body || "").replace(/\s+/g, " ").trim();
                          const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
                          const idx = body.search(noise);
                          if (idx > 1) body = body.slice(0, idx).trim();
                          body = body.replace(/[;:,\-.\s]+$/, "");
                          if (!/^[A-E]$/.test(letter)) {
                            current = null;
                            return;
                          }
                          if (!body || body.length < 1 || seen.has(letter)) {
                            current = null;
                            return;
                          }
                          seen.add(letter);
                          out.push(`${letter}) ${body}`);
                          current = null;
                        };
                        for (const line of lines) {
                          const m = line.match(startRe);
                          if (m) {
                            flush();
                            current = { letter: m[1], body: m[2] };
                            continue;
                          }
                          if (current && !/^\d+\s*[\)\.\-:]/.test(line) && !/^(?:quest[aã]o|aula)\b/i.test(line)) {
                            current.body = `${current.body} ${line}`.replace(/\s+/g, " ").trim();
                          }
                        }
                        flush();
                        return out.slice(0, 5);
                      };
                      const stop = /* @__PURE__ */ new Set([
                        "assinale",
                        "afirmativa",
                        "alternativa",
                        "correta",
                        "incorreta",
                        "quest\xE3o",
                        "considere",
                        "tabela",
                        "dados",
                        "produto",
                        "produtos",
                        "registro",
                        "registros",
                        "para",
                        "com",
                        "sem",
                        "dos",
                        "das",
                        "uma",
                        "de",
                        "da",
                        "do",
                        "e",
                        "o",
                        "a",
                        "os",
                        "as",
                        "no",
                        "na",
                        "em",
                        "por",
                        "ou",
                        "ao",
                        "aos"
                      ]);
                      const anchorTokens = normalize(anchorText).split(" ").filter((t) => t.length >= 4 && !stop.has(t)).slice(0, 16);
                      if (anchorTokens.length < 4) return "";
                      const containers = Array.from(document.querySelectorAll("section, article, main, form, div, [data-section], [data-testid]"));
                      let best = { score: -1, options: [] };
                      for (const el of containers) {
                        const raw = String(el?.innerText || "").replace(/\r/g, "\n").trim();
                        if (!raw || raw.length < 140 || raw.length > 14e4) continue;
                        const norm = normalize(raw);
                        if (!norm) continue;
                        let hits = 0;
                        for (const tk of anchorTokens) if (norm.includes(tk)) hits += 1;
                        if (hits < 4) continue;
                        const rawLines = raw.split(/\n/);
                        let bestLineIdx = 0;
                        let maxLineHits = 0;
                        for (let i = 0; i < rawLines.length; i++) {
                          const lineNorm = normalize(rawLines[i]);
                          if (!lineNorm) continue;
                          let lineHits = 0;
                          for (const tk of anchorTokens) if (lineNorm.includes(tk)) lineHits++;
                          if (lineHits > maxLineHits) {
                            maxLineHits = lineHits;
                            bestLineIdx = i;
                            if (lineHits >= 4) break;
                          }
                        }
                        const croppedRaw = rawLines.slice(Math.max(0, bestLineIdx - 1)).join("\n");
                        const extracted = extractOptionLines(croppedRaw);
                        if (extracted.length < 2) continue;
                        const codeCount = extracted.filter((line) => {
                          const m = String(line || "").match(/^([A-E])\s*[\)\.\-:]\s*(.+)$/i);
                          return m ? isCodeLike(m[2]) : false;
                        }).length;
                        const codeBonus = preferCode ? codeCount >= Math.max(2, extracted.length - 1) ? 60 : -50 : 0;
                        const score = hits * 16 + extracted.length * 38 + codeBonus - Math.min(30, Math.abs(raw.length - 7e3) / 300);
                        if (score > best.score) best = { score, options: extracted };
                      }
                      return best.options.length >= 2 ? best.options.join("\n") : "";
                    },
                    args: [anchorSeedText, preferCodeLikeOptions]
                  });
                  const anchoredText = String(anchoredResult?.result || "");
                  const anchoredCount = countDistinctOptions(anchoredText);
                  const currentCount = countDistinctOptions(optionsText || "");
                  const anchoredRelated = optionsAreContextuallyRelated(stemForOptions || bestQuestion, anchoredText);
                  if (anchoredCount >= 2 && !anchoredRelated) {
                    console.log(`AnswerHunter: HTML_ANCHORED_OPTIONS rejected=${anchoredCount} (context mismatch)`);
                  } else if (anchoredCount >= 2 && (anchoredCount >= currentCount || usedVisionOcr)) {
                    optionsText = anchoredText;
                    console.log(`AnswerHunter: HTML_ANCHORED_OPTIONS used=${anchoredCount} (replaced previous=${currentCount})`);
                  } else if (anchoredCount >= 2) {
                    console.log(`AnswerHunter: HTML_ANCHORED_OPTIONS found=${anchoredCount} (kept current=${currentCount})`);
                  }
                } catch (anchErr) {
                  console.warn("AnswerHunter: HTML anchored options extraction failed:", anchErr?.message || anchErr);
                }
              }
              if (Number.isFinite(bestFrameIndex) && bestFrameIndex >= 0 && countDistinctOptions(optionsText || "") < 5) {
                try {
                  const [scannedResult] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id, frameIds: [bestFrameIndex] },
                    function: async (anchorText, preferCode) => {
                      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                      const normalize = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                      const isCodeLike = (body) => /INSERT\s+INTO|SELECT\s|UPDATE\s|DELETE\s|VALUES\s*\(|CREATE\s|\{.*:.*\}|=>|jsonb?|\bdb\.\w|\.(find|findOne|aggregate|insert|pretty|update|remove)\s*\(/i.test(String(body || ""));
                      const stop = /* @__PURE__ */ new Set([
                        "assinale",
                        "afirmativa",
                        "alternativa",
                        "correta",
                        "incorreta",
                        "quest\xE3o",
                        "considere",
                        "tabela",
                        "dados",
                        "produto",
                        "produtos",
                        "registro",
                        "registros",
                        "para",
                        "com",
                        "sem",
                        "dos",
                        "das",
                        "uma",
                        "de",
                        "da",
                        "do",
                        "e",
                        "o",
                        "a",
                        "os",
                        "as",
                        "no",
                        "na",
                        "em",
                        "por",
                        "ou",
                        "ao",
                        "aos"
                      ]);
                      const anchorTokens = normalize(anchorText).split(" ").filter((t) => t.length >= 4 && !stop.has(t)).slice(0, 18);
                      if (anchorTokens.length < 4) return "";
                      const extractOptionLines = (rawText) => {
                        if (!rawText) return [];
                        const normalized = String(rawText).replace(/\r/g, "\n").replace(/(\S)\s+([A-Ea-e]\s*[\)\.\-:]\s+)/g, "$1\n$2");
                        const lines = normalized.split(/\n+/).map((l) => l.trim()).filter(Boolean);
                        const out2 = [];
                        const seen = /* @__PURE__ */ new Set();
                        const startRe = /^["']?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
                        let current = null;
                        const flush = () => {
                          if (!current) return;
                          const letter = (current.letter || "").toUpperCase();
                          let body = String(current.body || "").replace(/\s+/g, " ").trim();
                          const noise = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o|explica[cç][aã]o)\b/i;
                          const idx = body.search(noise);
                          if (idx > 1) body = body.slice(0, idx).trim();
                          body = body.replace(/[;:,\-.\s]+$/, "");
                          if (!/^[A-E]$/.test(letter)) {
                            current = null;
                            return;
                          }
                          if (!body || body.length < 1 || seen.has(letter)) {
                            current = null;
                            return;
                          }
                          seen.add(letter);
                          out2.push(`${letter}) ${body}`);
                          current = null;
                        };
                        for (const line of lines) {
                          const m = line.match(startRe);
                          if (m) {
                            flush();
                            current = { letter: m[1], body: m[2] };
                            continue;
                          }
                          if (current && !/^\d+\s*[\)\.\-:]/.test(line) && !/^(?:quest[aã]o|aula)\b/i.test(line)) {
                            current.body = `${current.body} ${line}`.replace(/\s+/g, " ").trim();
                          }
                        }
                        flush();
                        return out2.slice(0, 5);
                      };
                      const pickBestOptions = () => {
                        const containers = Array.from(document.querySelectorAll("section, article, main, form, div, [data-section], [data-testid]"));
                        let best = { score: -1, options: [] };
                        for (const el of containers) {
                          const raw = String(el?.innerText || "").replace(/\r/g, "\n").trim();
                          if (!raw || raw.length < 140 || raw.length > 16e4) continue;
                          const norm = normalize(raw);
                          if (!norm) continue;
                          let hits = 0;
                          for (const tk of anchorTokens) if (norm.includes(tk)) hits += 1;
                          if (hits < 4) continue;
                          const extracted = extractOptionLines(raw);
                          if (extracted.length < 2) continue;
                          const codeCount = extracted.filter((line) => {
                            const m = String(line || "").match(/^([A-E])\s*[\)\.\-:]\s*(.+)$/i);
                            return m ? isCodeLike(m[2]) : false;
                          }).length;
                          const codeBonus = preferCode ? codeCount >= Math.max(2, extracted.length - 1) ? 60 : -50 : 0;
                          const score = hits * 16 + extracted.length * 38 + codeBonus - Math.min(40, Math.abs(raw.length - 7e3) / 300);
                          if (score > best.score) best = { score, options: extracted };
                        }
                        return best.options;
                      };
                      const mergeByLetter = (targetMap, lines) => {
                        for (const line of lines || []) {
                          const m = String(line || "").match(/^([A-E])\s*[\)\.\-:]\s*(.+)$/i);
                          if (!m) continue;
                          const letter = m[1].toUpperCase();
                          const body = String(m[2] || "").replace(/\s+/g, " ").trim();
                          if (!body || targetMap.has(letter)) continue;
                          targetMap.set(letter, body);
                          if (targetMap.size >= 5) break;
                        }
                      };
                      const centerEl = document.elementFromPoint(Math.floor(window.innerWidth * 0.5), Math.floor(window.innerHeight * 0.5));
                      const findScrollableParent = (startEl) => {
                        let el = startEl;
                        while (el && el !== document.body && el !== document.documentElement) {
                          const style = window.getComputedStyle(el);
                          const canScroll = /(auto|scroll)/i.test(`${style.overflowY} ${style.overflow}`);
                          if (canScroll && el.scrollHeight - el.clientHeight > 140) return el;
                          el = el.parentElement;
                        }
                        return document.scrollingElement || document.documentElement || document.body;
                      };
                      const scrollEl = findScrollableParent(centerEl);
                      const startTop = Number(scrollEl.scrollTop || 0);
                      const maxTop = Math.max(0, (scrollEl.scrollHeight || 0) - (scrollEl.clientHeight || window.innerHeight));
                      const merged = /* @__PURE__ */ new Map();
                      try {
                        for (let step = 0; step < 8; step += 1) {
                          mergeByLetter(merged, pickBestOptions());
                          if (merged.size >= 5) break;
                          const currentTop = Number(scrollEl.scrollTop || 0);
                          if (currentTop >= maxTop - 2) break;
                          const delta = Math.max(180, Math.floor((scrollEl.clientHeight || window.innerHeight) * 0.78));
                          const nextTop = Math.min(maxTop, currentTop + delta);
                          if (nextTop <= currentTop + 1) break;
                          scrollEl.scrollTop = nextTop;
                          await sleep(180);
                        }
                      } finally {
                        scrollEl.scrollTop = startTop;
                      }
                      if (merged.size < 2) return "";
                      const order = ["A", "B", "C", "D", "E"];
                      const out = [];
                      for (const letter of order) {
                        if (!merged.has(letter)) continue;
                        out.push(`${letter}) ${merged.get(letter)}`);
                      }
                      return out.join("\n");
                    },
                    args: [anchorSeedText, preferCodeLikeOptions]
                  });
                  const scannedText = String(scannedResult?.result || "");
                  const scannedCount = countDistinctOptions(scannedText);
                  const currentCount = countDistinctOptions(optionsText || "");
                  const scannedRelated = optionsAreContextuallyRelated(stemForOptions || bestQuestion, scannedText);
                  if (scannedCount >= 2 && !scannedRelated) {
                    console.log(`AnswerHunter: AUTO_SCROLL_OPTIONS rejected=${scannedCount} (context mismatch)`);
                  } else if (scannedCount >= 2 && scannedCount > currentCount) {
                    optionsText = scannedText;
                    console.log(`AnswerHunter: AUTO_SCROLL_OPTIONS used=${scannedCount} (replaced previous=${currentCount})`);
                  } else if (scannedCount >= 2) {
                    console.log(`AnswerHunter: AUTO_SCROLL_OPTIONS found=${scannedCount} (kept current=${currentCount})`);
                  }
                } catch (scrollErr) {
                  console.warn("AnswerHunter: Auto-scroll options scan failed:", scrollErr?.message || scrollErr);
                }
              }
              if (!optionsText && ocrVisionText) {
                const ocrOptLines = ocrVisionText.split("\n").filter(
                  (line) => isValidOptionLine(line)
                );
                if (ocrOptLines.length >= 2) {
                  optionsText = ocrOptLines.join("\n");
                  console.log(`AnswerHunter: OCR_OPTIONS_FALLBACK used=${ocrOptLines.length} options from stored OCR text`);
                }
              }
              if (!optionsText) {
                optionsResults = await chrome.scripting.executeScript({
                  target: { tabId: tab.id, allFrames: true },
                  function: ExtractionService.extractOptionsOnlyScript
                });
                optionsText = pickBestOptionsText(optionsResults);
                if (optionsText) {
                  console.log("AnswerHunter: OCR_OPTIONS_FALLBACK used=allFrames (last resort)");
                }
              }
              if (optionsText && optionsText.length > 10) {
                if (existingOptionCount < 2) {
                  if (optionsAreContextuallyRelated(bestQuestion, optionsText)) {
                    displayQuestion = `${bestQuestion}
${optionsText}`;
                  } else {
                    console.log("AnswerHunter: OPTIONS_CONTAMINATION_GUARD blocked options append (existingOptionCount<2). Options likely from another question.");
                  }
                } else {
                  let processedQuestion = bestQuestion;
                  const domOptsCount = countDistinctOptions(optionsText);
                  if (usedVisionOcr && domOptsCount >= 2) {
                    const domLines = optionsText.split("\n").filter((line) => isValidOptionLine(line));
                    const domLetters = /* @__PURE__ */ new Map();
                    domLines.forEach((line) => {
                      const match = line.trim().match(/^([A-E])\s*[\)\.\-:]/i);
                      if (match) {
                        domLetters.set(match[1].toUpperCase(), line.trim());
                      }
                    });
                    if (domLetters.size > 0) {
                      const stemLines = processedQuestion.split("\n").filter((line) => {
                        const m = line.trim().match(/^([A-E])\s*[\)\.\-:]\s*/i);
                        return !m;
                      });
                      let stemText = stemLines.join("\n").trim();
                      if (!stemText) {
                        const domStem = String(domQuestion || "").split("\n").filter((line) => !line.trim().match(/^([A-E])\s*[\)\.\-:]\s*/i)).join("\n").trim();
                        if (domStem.length >= 30) {
                          stemText = domStem;
                          console.log("AnswerHunter: OCR stem empty; recovered stem from DOM extraction");
                        }
                      }
                      const domOptionsText = Array.from(domLetters.values()).join("\n");
                      if (!optionsAreContextuallyRelated(stemText || bestQuestion || domQuestion || "", domOptionsText)) {
                        console.log("AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected DOM replacement on OCR path");
                      } else {
                        processedQuestion = stemText ? `${stemText}
${domOptionsText}` : domOptionsText;
                        displayQuestion = processedQuestion;
                        console.log(`AnswerHunter: REBUILT question from stem + ${domLetters.size} precise DOM options (stripped OCR option lines)`);
                        console.log(`AnswerHunter: OCR_DOM_REPLACE opts_before=${existingOptionCount} opts_after=${countDistinctOptions(displayQuestion)}`);
                      }
                    }
                  } else {
                    const existingProfile = buildOptionsProfile(bestQuestion);
                    const existingLetters = existingProfile.letters;
                    const codeDominant = existingProfile.entries.length >= 3 && existingProfile.codeRatio >= 0.66;
                    const newLines = optionsText.split("\n").filter((line) => {
                      const lineMatch = line.trim().match(/^([A-E])\s*[\)\.\-:]/i);
                      if (!lineMatch || !isValidOptionLine(line)) return false;
                      const letter = lineMatch[1].toUpperCase();
                      if (existingLetters.has(letter)) return false;
                      const body = String(line.replace(/^([A-E])\s*[\)\.\-:]\s*/i, "") || "").replace(/\s+/g, " ").trim();
                      if (!body) return false;
                      if (codeDominant) {
                        if (!looksLikeCodeOptionBody(body)) return false;
                        const candTokens = optionTokens(body);
                        if (candTokens.length >= 3 && existingProfile.tokenSet.size > 0) {
                          let overlap = 0;
                          for (const tk of candTokens) {
                            if (existingProfile.tokenSet.has(tk)) overlap += 1;
                          }
                          const overlapRatio = overlap / candTokens.length;
                          if (overlap < 2 && overlapRatio < 0.28) return false;
                        }
                      }
                      return true;
                    });
                    if (newLines.length > 0) {
                      if (optionsAreContextuallyRelated(bestQuestion, newLines.join("\n"))) {
                        displayQuestion = `${bestQuestion}
${newLines.join("\n")}`;
                        console.log(`AnswerHunter: Merged ${newLines.length} missing option(s) from extractOptionsOnlyScript`);
                        console.log(`AnswerHunter: OCR_DOM_MERGE opts_before=${existingOptionCount} opts_added=${newLines.length} opts_after=${countDistinctOptions(displayQuestion)}`);
                      } else {
                        console.log(`AnswerHunter: OPTIONS_CONTAMINATION_GUARD rejected ${newLines.length} missing option(s) as cross-question contamination`);
                      }
                    } else if (usedVisionOcr) {
                      console.log("AnswerHunter: OCR was used; CSS/HTML options scan executed with no new alternatives found");
                      console.log(`AnswerHunter: OCR_DOM_MERGE opts_before=${existingOptionCount} opts_added=0 opts_after=${countDistinctOptions(displayQuestion)}`);
                    }
                  }
                }
              }
            }
            const cached = await this._getOfficialAnswerFromCache(displayQuestion);
            if (cached?.letter) {
              const optionsMap = this._extractOptionsMap(displayQuestion);
              const answerText = optionsMap[cached.letter] || "";
              const direct = [{
                question: displayQuestion,
                answer: `Letra ${cached.letter}: ${answerText}`.trim(),
                answerLetter: cached.letter,
                answerText,
                sources: [{
                  title: "Cache (gabarito oficial)",
                  link: cached.sourceUrl || "",
                  type: "cache"
                }],
                bestLetter: cached.letter,
                votes: { [cached.letter]: 10 },
                confidence: 0.95,
                resultState: "confirmed",
                reason: "confirmed_by_sources",
                title: this.t("result.title"),
                aiFallback: false
              }];
              const withSaved2 = direct.map((item) => ({
                ...item,
                saved: StorageModel.isSaved(displayQuestion)
              }));
              this.view.appendResults(withSaved2);
              await this.saveLastResults(withSaved2);
              this.view.showStatus("success", this.t("status.answersFound", { count: 1 }));
              this.view.toggleViewSection("view-search");
              this.view.setButtonDisabled("copyBtn", false);
              return;
            }
            const pageGab = await this._tryExtractPageGabarito(tab.id, displayQuestion);
            if (pageGab?.letter && pageGab.confidence >= 0.85) {
              const optionsMap = this._extractOptionsMap(displayQuestion);
              const answerText = optionsMap[pageGab.letter] || "";
              await this._setOfficialAnswerCache(displayQuestion, {
                letter: pageGab.letter,
                sourceUrl: tab.url || "",
                evidence: pageGab.evidence || "",
                updatedAt: Date.now()
              });
              const direct = [{
                question: displayQuestion,
                answer: `Letra ${pageGab.letter}: ${answerText}`.trim(),
                answerLetter: pageGab.letter,
                answerText,
                sources: [{
                  title: "Gabarito da pagina",
                  link: tab.url || "",
                  type: "page"
                }],
                bestLetter: pageGab.letter,
                votes: { [pageGab.letter]: 15 },
                confidence: Math.max(0.85, Math.min(0.99, pageGab.confidence)),
                resultState: "confirmed",
                reason: "confirmed_by_sources",
                title: this.t("result.title"),
                aiFallback: false
              }];
              const withSaved2 = direct.map((item) => ({
                ...item,
                saved: StorageModel.isSaved(displayQuestion)
              }));
              this.view.appendResults(withSaved2);
              await this.saveLastResults(withSaved2);
              this.view.showStatus("success", this.t("status.answersFound", { count: 1 }));
              this.view.toggleViewSection("view-search");
              this.view.setButtonDisabled("copyBtn", false);
              return;
            }
            console.log("AnswerHunter: displayQuestion sent to search \xE2\u2020\u2019", displayQuestion.substring(0, 200));
            this.view.showStatus("loading", this.t("status.searchingGoogle"));
            const searchResults = await SearchService.searchOnly(displayQuestion);
            if (!searchResults || searchResults.length === 0) {
              this.view.showStatus("loading", this.t("status.noSourcesAskAi"));
              await this.renderAiFallback(displayQuestion, displayQuestion);
              return;
            }
            this.view.showStatus("loading", this.t("status.foundAndAnalyzing", { count: searchResults.length }));
            const finalResults = await SearchService.refineFromResults(
              bestQuestion,
              searchResults,
              displayQuestion,
              (message) => this.view.showStatus("loading", message)
            );
            if (!finalResults || finalResults.length === 0) {
              this.view.showStatus("loading", this.t("status.noSourceAnswerAskAi"));
              await this.renderAiFallback(displayQuestion, displayQuestion);
              return;
            }
            const firstResult = finalResults[0];
            if (!firstResult?.answerLetter && firstResult?.resultState === "inconclusive") {
              this.view.showStatus("loading", this.t("status.noSourceAnswerAskAi"));
              await this.renderAiFallback(displayQuestion, displayQuestion);
              return;
            }
            console.log("AnswerHunter: Final results to display:", finalResults);
            const withSaved = finalResults.map((item) => ({
              ...item,
              question: displayQuestion,
              saved: StorageModel.isSaved(displayQuestion)
            }));
            this.view.appendResults(withSaved);
            await this.saveLastResults(withSaved);
            this.view.showStatus("success", this.t("status.answersFound", { count: finalResults.length }));
            this.view.toggleViewSection("view-search");
            this.view.setButtonDisabled("copyBtn", false);
          } catch (error) {
            console.error("Search flow error:", error);
            const message = error?.message === "SETUP_REQUIRED" ? this.t("setup.toast.required") : this.t("status.searchError", { message: error.message || "unknown" });
            this.view.showStatus("error", message);
            if (error?.message === "SETUP_REQUIRED") {
              this.toggleSetupPanel(true);
            }
          } finally {
            this.view.setButtonDisabled("searchBtn", false);
          }
        },
        _extractOptionsMap(text) {
          const map = {};
          const cleanOptionBody = (raw) => {
            let body = String(raw || "").replace(/\s+/g, " ").trim();
            const noiseMarker = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eÃ©]ns|voc[eÃª]\s+acertou|confira\s+o\s+gabarito|explica[cÃ§][aÃ£]o)\b/i;
            const idx = body.search(noiseMarker);
            if (idx > 20) body = body.slice(0, idx).trim();
            return body.replace(/[;:,\-.\s]+$/g, "").trim();
          };
          const isUsableBody = (body) => {
            if (!body || body.length < 1) return false;
            if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(body)) return false;
            if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(body)) return false;
            return true;
          };
          const lines = String(text || "").split("\n");
          const re = /^\s*["'â€œâ€â€˜â€™]?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;
          for (const line of lines) {
            const m = line.match(re);
            if (m) {
              const cleaned = cleanOptionBody(m[2]);
              if (!isUsableBody(cleaned)) continue;
              map[m[1].toUpperCase()] = cleaned;
            }
          }
          return map;
        },
        _normalizeForFingerprint(text) {
          return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ").slice(0, 2200);
        },
        _fnv1a32(str) {
          let hash = 2166136261;
          for (let i = 0; i < str.length; i += 1) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
            hash >>>= 0;
          }
          return ("0000000" + hash.toString(16)).slice(-8);
        },
        _makeQuestionFingerprint(displayQuestion) {
          const norm = this._normalizeForFingerprint(displayQuestion);
          return `qa_${this._fnv1a32(norm)}`;
        },
        async _getOfficialAnswerFromCache(displayQuestion) {
          try {
            const key = this._makeQuestionFingerprint(displayQuestion);
            const data = await chrome.storage.local.get(["officialAnswerCache"]);
            const cache = data?.officialAnswerCache || {};
            return cache[key] || null;
          } catch (_) {
            return null;
          }
        },
        async _setOfficialAnswerCache(displayQuestion, value) {
          try {
            const key = this._makeQuestionFingerprint(displayQuestion);
            const data = await chrome.storage.local.get(["officialAnswerCache"]);
            const cache = data?.officialAnswerCache || {};
            cache[key] = value;
            const keys = Object.keys(cache);
            if (keys.length > 500) {
              keys.map((k) => ({ k, t: Number(cache[k]?.updatedAt || 0) })).sort((a, b) => a.t - b.t).slice(0, Math.max(0, keys.length - 450)).forEach((entry) => {
                delete cache[entry.k];
              });
            }
            await chrome.storage.local.set({ officialAnswerCache: cache });
          } catch (_) {
          }
        },
        async _tryExtractPageGabarito(tabId, displayQuestion) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              function: ExtractionService.extractGabaritoFromPageScript,
              args: [displayQuestion || ""]
            });
            let best = null;
            (results || []).forEach((r) => {
              const gab = r?.result;
              if (gab?.letter && (!best || (gab.confidence || 0) > (best.confidence || 0))) {
                best = gab;
              }
            });
            return best;
          } catch (_) {
            return null;
          }
        },
        async renderAiFallback(questionText, displayQuestion) {
          const aiInput = displayQuestion || questionText;
          const aiResults = await SearchService.answerFromAi(aiInput);
          if (!aiResults || aiResults.length === 0) {
            this.view.showStatus("error", this.t("status.couldNotGetAnswer"));
            return;
          }
          const withSaved = aiResults.map((item) => ({
            ...item,
            question: displayQuestion,
            saved: StorageModel.isSaved(displayQuestion)
          }));
          this.view.appendResults(withSaved);
          await this.saveLastResults(withSaved);
          this.view.showStatus("success", this.t("status.answersFound", { count: aiResults.length }));
          this.view.toggleViewSection("view-search");
          this.view.setButtonDisabled("copyBtn", false);
        },
        async handleCopyAll() {
          const text = this.view.getAllResultsText();
          if (!text) return;
          await navigator.clipboard.writeText(text);
          this.view.showStatus("success", this.t("status.copied"));
        },
        async saveLastResults(results) {
          try {
            await chrome.storage.local.set({ lastSearchResults: results });
          } catch (error) {
            console.warn("Could not store last results:", error);
          }
        },
        _escapeHtml(str) {
          const div = document.createElement("div");
          div.textContent = str;
          return div.innerHTML;
        },
        async _persistAnswerOverride(card, newLetter, newBody) {
          try {
            const data = await chrome.storage.local.get(["lastSearchResults"]);
            const cached = data?.lastSearchResults;
            if (!Array.isArray(cached) || cached.length === 0) return;
            const allCards = [...this.view.elements.resultsDiv?.querySelectorAll(".qa-card") || []];
            const cardIndex = allCards.indexOf(card);
            if (cardIndex < 0 || cardIndex >= cached.length) return;
            cached[cardIndex].answerLetter = newLetter;
            cached[cardIndex].bestLetter = newLetter;
            cached[cardIndex].answerText = newBody;
            cached[cardIndex].answer = `Letra ${newLetter}: ${newBody}`;
            cached[cardIndex].userOverride = true;
            cached[cardIndex].resultState = "confirmed";
            await chrome.storage.local.set({ lastSearchResults: cached });
            console.log(`AnswerHunter: User override applied \xE2\u20AC\u201D Letra ${newLetter}`);
          } catch (error) {
            console.warn("Could not persist answer override:", error);
          }
        },
        async restoreLastResults({ clear = true } = {}) {
          try {
            const data = await chrome.storage.local.get(["lastSearchResults"]);
            const cached = data?.lastSearchResults;
            if (clear) this.view.clearResults();
            if (!Array.isArray(cached) || cached.length === 0) return;
            const withSaved = cached.map((item) => ({
              ...item,
              saved: StorageModel.isSaved(item.question)
            }));
            this.view.appendResults(withSaved);
            this.view.toggleViewSection("view-search");
            this.view.setButtonDisabled("copyBtn", false);
          } catch (error) {
            console.warn("Could not restore last results:", error);
          }
        },
        async handleResultClick(event) {
          const overrideTrigger = event.target.closest(".answer-override-trigger");
          if (overrideTrigger) {
            const section = overrideTrigger.closest(".answer-override-section");
            const pills = section?.querySelector(".answer-override-pills");
            if (pills) {
              const isHidden = pills.hidden;
              pills.hidden = !isHidden;
              overrideTrigger.classList.toggle("active", isHidden);
            }
            return;
          }
          const overrideCancel = event.target.closest(".override-cancel");
          if (overrideCancel) {
            const section = overrideCancel.closest(".answer-override-section");
            const pills = section?.querySelector(".answer-override-pills");
            const trigger = section?.querySelector(".answer-override-trigger");
            if (pills) pills.hidden = true;
            if (trigger) trigger.classList.remove("active");
            return;
          }
          const overridePill = event.target.closest(".override-pill");
          if (overridePill) {
            const newLetter = overridePill.dataset.letter;
            const newBody = decodeURIComponent(overridePill.dataset.body || "");
            if (!newLetter) return;
            const card = overridePill.closest(".qa-card");
            if (!card) return;
            const answerOption = card.querySelector(".answer-option");
            const answerText = card.querySelector(".qa-card-answer-text");
            const letterEl = answerOption?.querySelector(".alt-letter");
            const textEl = answerOption?.querySelector(".alt-text");
            if (letterEl && textEl) {
              letterEl.textContent = newLetter;
              textEl.textContent = newBody;
            } else if (answerText) {
              const newHtml = `<div class="answer-option"><div class="alternative answer-alternative"><span class="alt-letter">${this._escapeHtml(newLetter)}</span><span class="alt-text">${this._escapeHtml(newBody)}</span></div></div>`;
              answerText.outerHTML = newHtml;
            }
            const header = card.querySelector(".qa-card-answer-header");
            if (header) {
              header.className = "qa-card-answer-header override-answer";
              const iconEl = header.querySelector(".answer-state-icon");
              if (iconEl) iconEl.textContent = "person";
              const titleEl = header.querySelector(".answer-header-title");
              if (titleEl) titleEl.textContent = this.t("result.override.applied");
            }
            const section = overridePill.closest(".answer-override-section");
            section?.querySelectorAll(".override-pill").forEach((p) => {
              p.classList.remove("override-selected", "override-current");
            });
            overridePill.classList.add("override-selected");
            const pills = section?.querySelector(".answer-override-pills");
            const trigger = section?.querySelector(".answer-override-trigger");
            if (pills) pills.hidden = true;
            if (trigger) trigger.classList.remove("active");
            await this._persistAnswerOverride(card, newLetter, newBody);
            return;
          }
          const toggleButton = event.target.closest(".sources-toggle");
          if (toggleButton) {
            const box = toggleButton.closest(".sources-box");
            const list = box?.querySelector(".sources-list");
            if (box && list) {
              const expanded = box.classList.toggle("expanded");
              list.hidden = !expanded;
              toggleButton.setAttribute("aria-expanded", expanded ? "true" : "false");
            }
            return;
          }
          const saveButton = event.target.closest(".save-btn");
          if (saveButton) {
            const dataContent = saveButton.dataset.content;
            if (!dataContent) return;
            const data = JSON.parse(decodeURIComponent(dataContent));
            await BinderController.toggleSaveItem(data.question, data.answer, data.source, saveButton);
            return;
          }
          const tutorBtn = event.target.closest(".btn-tutor");
          if (tutorBtn) {
            const container = tutorBtn.closest(".study-actions-container")?.nextElementSibling;
            if (!container) return;
            const question = decodeURIComponent(tutorBtn.dataset.question || "");
            const answer = decodeURIComponent(tutorBtn.dataset.answer || "");
            const context = decodeURIComponent(tutorBtn.dataset.context || "");
            tutorBtn.disabled = true;
            tutorBtn.innerHTML = `<span class="material-symbols-rounded spin-loading">sync</span> <span>${this.t("status.refiningWithAi") || "Pensando..."}</span>`;
            container.classList.remove("hidden");
            container.innerHTML = `<div class="study-loading-placeholder">Gerando explica\xE7\xE3o passo a passo...</div>`;
            try {
              const ApiServiceModule = (await Promise.resolve().then(() => (init_ApiService(), ApiService_exports))).ApiService;
              const explanation = await ApiServiceModule.generateTutorExplanation(question, answer, context);
              const safeExplanation = this._escapeHtml(explanation);
              const htmlExplanation = safeExplanation.replace(/^### (.*$)/gim, "<strong>$1</strong>").replace(/^## (.*$)/gim, "<strong>$1</strong>").replace(/^# (.*$)/gim, "<strong>$1</strong>").replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>").replace(/\*(.*?)\*/gim, "<em>$1</em>").replace(/\n\+/g, "\n\u2022 ").replace(/\n-/g, "\n\u2022 ").replace(/\n/g, "<br>");
              container.innerHTML = `<div class="study-tutor-explanation">${htmlExplanation}</div>`;
            } catch (err) {
              console.error("AnswerHunter Tutor Mode err:", err);
              container.innerHTML = `<div class="study-error">Erro ao gerar explica\xE7\xE3o. Tente novamente mais tarde.</div>`;
            } finally {
              tutorBtn.disabled = false;
              tutorBtn.innerHTML = `<span class="material-symbols-rounded">school</span> <span>${this.t("result.tutor.btn")}</span>`;
            }
            return;
          }
          const similarBtn = event.target.closest(".btn-similar");
          if (similarBtn) {
            const container = similarBtn.closest(".study-actions-container")?.nextElementSibling;
            if (!container) return;
            const question = decodeURIComponent(similarBtn.dataset.question || "");
            similarBtn.disabled = true;
            similarBtn.innerHTML = `<span class="material-symbols-rounded spin-loading">sync</span> <span>${this.t("status.refiningWithAi") || "Criando quest\xE3o..."}</span>`;
            container.classList.remove("hidden");
            container.innerHTML = `<div class="study-loading-placeholder">Gerando uma quest\xE3o similar para testar seus conhecimentos...</div>`;
            try {
              const ApiServiceModule = (await Promise.resolve().then(() => (init_ApiService(), ApiService_exports))).ApiService;
              const newQuestion = await ApiServiceModule.generateSimilarQuestion(question);
              if (newQuestion && newQuestion.questionText) {
                const optionsHtml = Object.entries(newQuestion.optionsMap || {}).map(([letter, text]) => `<div class="similar-option"><strong>${this._escapeHtml(letter)})</strong> ${this._escapeHtml(text)}</div>`).join("");
                container.innerHTML = `
            <div class="similar-question-block">
              <div class="similar-q-text"><strong>Q:</strong> ${this._escapeHtml(newQuestion.questionText)}</div>
              <div class="similar-options-list">${optionsHtml}</div>
              <details class="similar-answer-reveal">
                <summary>Ver Resposta</summary>
                <div class="similar-answer-text">Alternativa correta: <strong>${this._escapeHtml(newQuestion.answerLetter)}</strong></div>
              </details>
            </div>
          `;
              } else {
                throw new Error("Invalid question format received.");
              }
            } catch (err) {
              console.error("AnswerHunter Similar Question err:", err);
              container.innerHTML = `<div class="study-error">Erro ao gerar quest\xE3o. Tente novamente mais tarde.</div>`;
            } finally {
              similarBtn.disabled = false;
              similarBtn.innerHTML = `<span class="material-symbols-rounded">quiz</span> <span>${this.t("result.similar.btn")}</span>`;
            }
            return;
          }
          const chatBtn = event.target.closest(".btn-chat");
          if (chatBtn) {
            const container = chatBtn.closest(".study-actions-container")?.nextElementSibling;
            if (!container) return;
            const question = decodeURIComponent(chatBtn.dataset.question || "");
            const answer = decodeURIComponent(chatBtn.dataset.answer || "");
            const context = decodeURIComponent(chatBtn.dataset.context || "");
            if (!container.dataset.chatInitialized) {
              container.dataset.chatInitialized = "true";
              container.classList.remove("hidden");
              container.innerHTML = `
          <div class="study-chat-container">
            <div class="study-chat-history">
              <div class="chat-message ai-message">
                <span class="material-symbols-rounded">robot_2</span>
                <div class="msg-content">${this.t ? this.t("result.chat.hello") || "Ol\xE1! Como posso ajudar voc\xEA a entender melhor esta quest\xE3o?" : "Ol\xE1! Como posso ajudar voc\xEA a entender melhor esta quest\xE3o?"}</div>
              </div>
            </div>
            <div class="study-chat-input-area">
              <input type="text" class="study-chat-input" placeholder="${this.t ? this.t("result.chat.placeholder") || "Digite sua d\xFAvida aqui..." : "Digite sua d\xFAvida aqui..."}">
              <button class="study-chat-send" type="button">
                <span class="material-symbols-rounded">send</span>
              </button>
            </div>
          </div>
        `;
              const input = container.querySelector(".study-chat-input");
              const sendBtn = container.querySelector(".study-chat-send");
              const history = container.querySelector(".study-chat-history");
              let messageHistory = [];
              const handleSend = async () => {
                const userMsg = input.value.trim();
                if (!userMsg) return;
                input.value = "";
                input.disabled = true;
                sendBtn.disabled = true;
                history.insertAdjacentHTML("beforeend", `
            <div class="chat-message user-message">
              <div class="msg-content">${this._escapeHtml ? this._escapeHtml(userMsg) : userMsg}</div>
              <span class="material-symbols-rounded">person</span>
            </div>
            <div class="chat-message ai-message pending-msg">
              <span class="material-symbols-rounded spin-loading">sync</span>
              <div class="msg-content">...</div>
            </div>
          `);
                history.scrollTop = history.scrollHeight;
                try {
                  const ApiServiceModule = (await Promise.resolve().then(() => (init_ApiService(), ApiService_exports))).ApiService;
                  const response = await ApiServiceModule.answerFollowUp(question, answer, context, userMsg, messageHistory);
                  messageHistory.push({ role: "user", content: userMsg });
                  messageHistory.push({ role: "assistant", content: response });
                  const pending = history.querySelector(".pending-msg");
                  if (pending) pending.remove();
                  const safeResponse = this._escapeHtml(response);
                  const htmlResponse = safeResponse.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\*(.*?)\*/g, "<em>$1</em>").replace(/\n\+/g, "\n\u2022 ").replace(/\n-/g, "\n\u2022 ").replace(/\n/g, "<br>");
                  history.insertAdjacentHTML("beforeend", `
              <div class="chat-message ai-message">
                <span class="material-symbols-rounded">robot_2</span>
                <div class="msg-content">${htmlResponse}</div>
              </div>
            `);
                } catch (err) {
                  console.error("AnswerHunter Chat Error:", err);
                  const pending = history.querySelector(".pending-msg");
                  if (pending) pending.remove();
                  history.insertAdjacentHTML("beforeend", `
              <div class="chat-message ai-message error-msg">
                <span class="material-symbols-rounded">error</span>
                <div class="msg-content">Erro de conex\xE3o. Tente novamente.</div>
              </div>
            `);
                } finally {
                  input.disabled = false;
                  sendBtn.disabled = false;
                  input.focus();
                  history.scrollTop = history.scrollHeight;
                }
              };
              sendBtn.addEventListener("click", handleSend);
              input.addEventListener("keypress", (e) => {
                if (e.key === "Enter") handleSend();
              });
              input.focus();
            } else {
              container.classList.toggle("hidden");
            }
            return;
          }
        }
      };
    }
  });

  // src/views/PopupView.js
  var PopupView;
  var init_PopupView = __esm({
    "src/views/PopupView.js"() {
      init_helpers();
      PopupView = {
        elements: {},
        _translator: (key) => key,
        _currentSlide: 0,
        init() {
          this.cacheElements();
          this._setupTutorialToggles();
          this._setupGlowBackground();
        },
        /** Interactive glow background that follows mouse cursor */
        _setupGlowBackground() {
          document.addEventListener("mousemove", (e) => {
            document.documentElement.style.setProperty("--ah-mouse-x", e.clientX + "px");
            document.documentElement.style.setProperty("--ah-mouse-y", e.clientY + "px");
          });
        },
        setTranslator(translator) {
          if (typeof translator === "function") {
            this._translator = translator;
          }
        },
        t(key, variables) {
          try {
            return this._translator(key, variables);
          } catch (_) {
            return key;
          }
        },
        cacheElements() {
          this.elements = {
            // Main App
            extractBtn: document.getElementById("extractBtn"),
            searchBtn: document.getElementById("searchBtn"),
            copyBtn: document.getElementById("copyBtn"),
            statusDiv: document.getElementById("status"),
            resultsDiv: document.getElementById("results"),
            binderList: document.getElementById("binder-list"),
            clearBinderBtn: document.getElementById("clearBinderBtn"),
            tabs: document.querySelectorAll(".tab-btn"),
            sections: document.querySelectorAll(".view-section"),
            settingsBtn: document.getElementById("settingsBtn"),
            languageToggle: document.getElementById("languageToggle"),
            toastContainer: document.getElementById("toast-container"),
            // Onboarding Elements
            onboardingView: document.getElementById("onboarding-view"),
            onboardingSlides: document.getElementById("onboarding-slides"),
            progressBar: document.getElementById("onboarding-progress-bar"),
            progressGlow: document.getElementById("ob-progress-glow"),
            stepDots: document.getElementById("ob-step-dots"),
            // Buttons
            welcomeStartBtn: document.getElementById("welcomeStartBtn"),
            btnNextGroq: document.getElementById("btn-next-groq"),
            btnNextSerper: document.getElementById("btn-next-serper"),
            btnNextGemini: document.getElementById("btn-next-gemini"),
            saveSetupBtn: document.getElementById("saveSetupBtn"),
            setupSkipBtn: document.getElementById("setupSkipBtn"),
            prevGroq: document.getElementById("prev-groq"),
            prevSerper: document.getElementById("prev-serper"),
            prevGemini: document.getElementById("prev-gemini"),
            prevPrefs: document.getElementById("prev-prefs"),
            // Inputs
            inputGroq: document.getElementById("input-groq"),
            inputSerper: document.getElementById("input-serper"),
            inputGemini: document.getElementById("input-gemini"),
            selectSearchProvider: document.getElementById("select-search-provider"),
            linkSearchProvider: document.getElementById("link-search-provider"),
            selectSearchProviderOb: document.getElementById("selectSearchProviderOb"),
            // Tests
            testGroq: document.getElementById("test-groq"),
            testSerper: document.getElementById("test-serper"),
            testGemini: document.getElementById("test-gemini"),
            // OpenRouter elements
            btnNextOpenrouter: document.getElementById("btn-next-openrouter"),
            prevOpenrouter: document.getElementById("prev-openrouter"),
            inputOpenrouter: document.getElementById("input-openrouter"),
            testOpenrouter: document.getElementById("test-openrouter"),
            statusOpenrouter: document.getElementById("status-openrouter"),
            pillOpenrouterOb: document.getElementById("pill-openrouter-ob"),
            selectOpenrouterModel: document.getElementById("select-openrouter-model"),
            keyStatusOpenrouter: document.getElementById("key-status-openrouter"),
            changeKeyOpenrouter: document.getElementById("change-key-openrouter"),
            removeKeyOpenrouter: document.getElementById("remove-key-openrouter"),
            closeSettingsOpenrouter: document.getElementById("close-settings-openrouter"),
            // Status
            statusGroq: document.getElementById("status-groq"),
            statusSerper: document.getElementById("status-serper"),
            statusGemini: document.getElementById("status-gemini"),
            // AI Provider & Model Config
            providerToggle: document.getElementById("provider-toggle"),
            pillGroq: document.getElementById("pill-groq"),
            pillGemini: document.getElementById("pill-gemini"),
            pillGroqOb: document.getElementById("pill-groq-ob"),
            pillGeminiOb: document.getElementById("pill-gemini-ob"),
            providerHint: document.getElementById("provider-hint"),
            selectGroqModel: document.getElementById("select-groq-model"),
            selectGeminiModel: document.getElementById("select-gemini-model"),
            // Key Status Chips (settings reopen)
            keyStatusGroq: document.getElementById("key-status-groq"),
            keyStatusSerper: document.getElementById("key-status-serper"),
            keyStatusGemini: document.getElementById("key-status-gemini"),
            // Change Key Buttons
            changeKeyGroq: document.getElementById("change-key-groq"),
            changeKeySerper: document.getElementById("change-key-serper"),
            changeKeyGemini: document.getElementById("change-key-gemini"),
            removeKeySerper: document.getElementById("remove-key-serper"),
            removeKeyGemini: document.getElementById("remove-key-gemini"),
            // Close Settings Buttons
            closeSettingsGroq: document.getElementById("close-settings-groq"),
            closeSettingsSerper: document.getElementById("close-settings-serper"),
            closeSettingsGemini: document.getElementById("close-settings-gemini"),
            // Onboarding Language Toggle
            obLanguageToggle: document.getElementById("obLanguageToggle"),
            // Binder Go to Search CTA
            binderGoToSearch: document.getElementById("binderGoToSearch")
          };
        },
        /** Tutorial is always visible now — no accordion toggle needed */
        _setupTutorialToggles() {
        },
        setLanguageSelectValue(language) {
          if (this.elements.languageToggle) {
            this.elements.languageToggle.querySelectorAll(".lang-btn").forEach((btn) => {
              btn.classList.toggle("active", btn.dataset.lang === language);
            });
          }
          this.setObLanguageSelectValue(language);
        },
        setObLanguageSelectValue(language) {
          if (this.elements.obLanguageToggle) {
            this.elements.obLanguageToggle.querySelectorAll(".ob-lang-btn").forEach((btn) => {
              btn.classList.toggle("active", btn.dataset.lang === language);
            });
          }
        },
        showStatus(type, message) {
          const status = this.elements.statusDiv;
          if (!status) return;
          status.className = `status ${type}`;
          status.innerHTML = type === "loading" ? `<span class="material-symbols-rounded spin-loading">sync</span> ${escapeHtml(message)}` : escapeHtml(message);
          status.style.display = "flex";
          if (type !== "loading") {
            setTimeout(() => {
              status.style.opacity = "0";
              setTimeout(() => {
                status.style.display = "none";
                status.style.opacity = "1";
              }, 250);
            }, 3500);
          }
        },
        setButtonDisabled(buttonId, disabled) {
          const button = document.getElementById(buttonId);
          if (button) button.disabled = !!disabled;
        },
        clearResults() {
          if (this.elements.resultsDiv) {
            this.elements.resultsDiv.innerHTML = "";
          }
        },
        switchTab(tabName) {
          this.elements.tabs.forEach((tab) => {
            tab.classList.toggle("active", tab.dataset.tab === tabName);
          });
          this.elements.sections.forEach((section) => {
            section.classList.toggle("active", section.id === `view-${tabName}`);
          });
          const indicator = document.getElementById("tab-indicator");
          if (indicator) {
            indicator.classList.toggle("tab-binder", tabName === "binder");
          }
        },
        toggleViewSection(sectionId) {
          this.elements.sections.forEach((section) => {
            section.classList.toggle("active", section.id === sectionId);
          });
        },
        // ===== ONBOARDING LOGIC (REVAMPED) =====
        setSetupVisible(visible) {
          if (this.elements.onboardingView) {
            this.elements.onboardingView.classList.toggle("hidden", !visible);
          }
        },
        /**
         * Show a specific onboarding slide (0=welcome, 1=groq, 2=serper, 3=gemini)
         * Uses CSS translateX on the slides container.
         */
        showSetupStep(stepNumber) {
          this._currentSlide = stepNumber;
          if (this.elements.onboardingSlides) {
            const translate = stepNumber * -100;
            this.elements.onboardingSlides.style.transform = `translateX(${translate}%)`;
          }
          if (this.elements.onboardingView) {
            this.elements.onboardingView.classList.toggle("ob-glow-active", stepNumber === 0);
          }
          this.updateProgressBar(stepNumber);
          this.updateStepDots(stepNumber);
          this.syncTutorialCard(stepNumber);
        },
        updateProgressBar(stepNumber) {
          const percents = [10, 25, 40, 55, 70, 85, 100];
          const percent = percents[stepNumber] ?? 10;
          if (this.elements.progressBar) {
            this.elements.progressBar.style.width = `${percent}%`;
          }
          if (this.elements.progressGlow) {
            this.elements.progressGlow.style.left = `${Math.max(0, percent - 5)}%`;
          }
        },
        updateStepDots(currentStep) {
          if (!this.elements.stepDots) return;
          const dots = this.elements.stepDots.querySelectorAll(".ob-dot");
          dots.forEach((dot, index) => {
            dot.classList.remove("active", "done");
            if (index === currentStep) {
              dot.classList.add("active");
            } else if (index < currentStep) {
              dot.classList.add("done");
            }
          });
        },
        syncTutorialCard(currentStep) {
          const cards = document.querySelectorAll(".ob-tutorial-card");
          cards.forEach((card) => {
            const body = card.querySelector(".ob-tutorial-body");
            if (!body) return;
            body.hidden = true;
            card.classList.remove("expanded");
          });
          const activeSlide = document.querySelector(`.ob-slide[data-slide="${currentStep}"]`);
          const activeCard = activeSlide?.querySelector(".ob-tutorial-card");
          if (!activeCard) return;
          const activeBody = activeCard.querySelector(".ob-tutorial-body");
          if (!activeBody) return;
          activeBody.hidden = false;
          activeCard.classList.add("expanded");
        },
        // Backwards compatibility shim for Controller
        updateStepper(currentStep, completedSteps) {
        },
        showWelcomeOverlay() {
          this.setSetupVisible(true);
          this.showSetupStep(0);
        },
        hideWelcomeOverlay() {
        },
        showToast(message, type = "", duration = 3200) {
          const container = this.elements.toastContainer;
          if (!container) return;
          const iconByType = {
            success: "check_circle",
            error: "error",
            warning: "warning",
            info: "info"
          };
          const toast = document.createElement("div");
          toast.className = `toast ${type}`;
          toast.innerHTML = `
      <span class="material-symbols-rounded" style="font-size:18px;">${iconByType[type] || "info"}</span>
      <span>${escapeHtml(message)}</span>
    `;
          container.appendChild(toast);
          setTimeout(() => {
            toast.style.animation = "toastOut 0.28s ease forwards";
            setTimeout(() => toast.remove(), 300);
          }, duration);
        },
        setTestButtonLoading(provider, state) {
          const button = document.getElementById(`test-${provider}`);
          if (!button) return;
          button.classList.remove("testing", "test-ok", "test-fail");
          button.disabled = false;
          if (state === "loading") {
            button.classList.add("testing");
            button.disabled = true;
            button.innerHTML = `<span class="material-symbols-rounded spin-loading">sync</span> ${escapeHtml(this.t("setup.test.short"))}`;
            return;
          }
          if (state === "ok") {
            button.classList.add("test-ok");
            button.innerHTML = `<span class="material-symbols-rounded">check_circle</span> ${escapeHtml(this.t("setup.test.success"))}`;
            this.enableNextButton(provider);
            return;
          }
          if (state === "fail") {
            button.classList.add("test-fail");
            button.innerHTML = `<span class="material-symbols-rounded">error</span> ${escapeHtml(this.t("setup.test.failed"))}`;
            return;
          }
          button.innerHTML = `<span class="material-symbols-rounded">wifi_tethering</span> ${escapeHtml(this.t("setup.validateAction"))}`;
        },
        enableNextButton(provider) {
          const btnId = `btn-next-${provider}`;
          const btn = document.getElementById(btnId);
          if (btn) {
            btn.disabled = false;
            btn.classList.add("pulse-next");
          }
        },
        disableNextButton(provider) {
          const btnId = `btn-next-${provider}`;
          const btn = document.getElementById(btnId);
          if (btn) {
            btn.disabled = true;
            btn.classList.remove("pulse-next");
          }
        },
        setSetupStatus(provider, text, type = "") {
          const status = this.elements[`status${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
          if (!status) return;
          status.className = `ob-test-status ${type}`;
          status.textContent = text;
        },
        setupVisibilityToggle(button) {
          if (!button || button.dataset.visibilityBound === "1") return;
          button.dataset.visibilityBound = "1";
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const targetId = button.dataset.target;
            const input = document.getElementById(targetId);
            if (!input) return;
            const isPassword = input.type === "password";
            input.type = isPassword ? "text" : "password";
            const icon = button.querySelector(".material-symbols-rounded");
            if (icon) {
              icon.textContent = isPassword ? "visibility_off" : "visibility";
            }
          });
        },
        showPasteNotification(input) {
          if (!input) return;
          input.classList.add("just-pasted");
          setTimeout(() => input.classList.remove("just-pasted"), 700);
        },
        updateKeyFormatHint(provider, value, expectedPrefix) {
          const hintEl = document.getElementById(`hint-${provider}`);
          if (!hintEl) return;
          const trimmed = (value || "").trim();
          hintEl.classList.remove("valid", "error");
          const icon = hintEl.querySelector(".material-symbols-rounded");
          if (!trimmed) {
            if (icon) icon.textContent = "info";
            hintEl.style.color = "";
            return;
          }
          if (expectedPrefix && trimmed.length > 5) {
            if (trimmed.startsWith(expectedPrefix)) {
              hintEl.classList.add("valid");
              if (icon) icon.textContent = "check_circle";
            } else {
              hintEl.classList.add("error");
              if (icon) icon.textContent = "error";
            }
          } else if (trimmed.length > 10) {
            hintEl.classList.add("valid");
            if (icon) icon.textContent = "check_circle";
          }
        },
        setSettingsAttention(active) {
          if (this.elements.settingsBtn) {
            this.elements.settingsBtn.classList.toggle("attention", !!active);
          }
        },
        /**
         * Show key status chip (configured / missing) for a provider.
         * Used when reopening settings.
         */
        showKeyStatus(provider, isConfigured) {
          const statusEl = this.elements[`keyStatus${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
          if (!statusEl) return;
          statusEl.classList.remove("hidden", "configured", "missing");
          const iconEl = statusEl.querySelector(".ob-key-status-icon");
          const textEl = statusEl.querySelector(".ob-key-status-text");
          if (isConfigured) {
            statusEl.classList.add("configured");
            if (iconEl) iconEl.textContent = "check_circle";
            if (textEl) textEl.textContent = this.t("setup.keyStatus.configured");
          } else {
            statusEl.classList.add("missing");
            if (iconEl) iconEl.textContent = "warning";
            if (textEl) {
              const missingKey = provider === "gemini" ? "setup.keyStatus.geminiMissing" : "setup.keyStatus.missing";
              textEl.textContent = this.t(missingKey);
            }
          }
        },
        /** Hide key status chip */
        hideKeyStatus(provider) {
          const statusEl = this.elements[`keyStatus${provider.charAt(0).toUpperCase() + provider.slice(1)}`];
          if (statusEl) statusEl.classList.add("hidden");
        },
        /**
         * Show/hide change-key buttons and close-settings buttons.
         * Used when reopening settings (not first-time setup).
         */
        setSettingsReopenMode(isReopen) {
          if (this.elements.onboardingView) {
            this.elements.onboardingView.classList.toggle("ob-reopen-mode", !!isReopen);
          }
          const providers = ["groq", "serper", "gemini", "openrouter"];
          providers.forEach((p) => {
            const cap = p.charAt(0).toUpperCase() + p.slice(1);
            const changeBtn = this.elements[`changeKey${cap}`];
            const closeBtn = this.elements[`closeSettings${cap}`];
            if (changeBtn) changeBtn.classList.toggle("hidden", !isReopen);
            if (closeBtn) closeBtn.classList.toggle("hidden", !isReopen);
          });
          if (this.elements.removeKeyGemini) {
            this.elements.removeKeyGemini.classList.toggle("hidden", !isReopen);
          }
          if (this.elements.removeKeyOpenrouter) {
            this.elements.removeKeyOpenrouter.classList.toggle("hidden", !isReopen);
          }
          if (this.elements.removeKeySerper) {
            this.elements.removeKeySerper.classList.toggle("hidden", !isReopen);
          }
        },
        showAutoAdvance(callback) {
          if (typeof callback === "function") {
            setTimeout(callback, 500);
          }
        },
        clearAutoAdvance() {
        },
        showConfetti() {
          const colors = ["#FF6B00", "#FFD700", "#27AE60", "#3498DB", "#E74C3C", "#8B5CF6"];
          for (let i = 0; i < 60; i += 1) {
            const piece = document.createElement("div");
            piece.className = "confetti-piece";
            piece.style.left = `${Math.random() * 100}%`;
            piece.style.top = `${-12 + Math.random() * 18}px`;
            piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animation = `confettiFall ${1.5 + Math.random()}s linear forwards`;
            piece.style.position = "fixed";
            piece.style.width = `${6 + Math.random() * 6}px`;
            piece.style.height = `${6 + Math.random() * 6}px`;
            piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
            piece.style.zIndex = "3000";
            document.body.appendChild(piece);
            setTimeout(() => piece.remove(), 2800);
          }
          if (!document.getElementById("confetti-style")) {
            const style = document.createElement("style");
            style.id = "confetti-style";
            style.textContent = `
        @keyframes confettiFall {
          0% { transform: translateY(0) rotate(0); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `;
            document.head.appendChild(style);
          }
        },
        appendResults(results) {
          if (!this.elements.resultsDiv) return;
          const discardedUrlDiagnostics = [];
          const sanitizeUrl = (rawUrl, context = "unknown") => {
            const value = String(rawUrl || "").trim();
            if (!value) return "";
            try {
              const parsed = new URL(value);
              if (!/^https?:$/i.test(parsed.protocol)) {
                discardedUrlDiagnostics.push({ context, reason: "invalid-protocol", raw: value.slice(0, 240) });
                return "";
              }
              return parsed.href;
            } catch (_) {
              discardedUrlDiagnostics.push({ context, reason: "invalid-url", raw: value.slice(0, 240) });
              return "";
            }
          };
          const sanitizeInjectedMarkup = (markup) => String(markup || "").replace(/<\s*script\b[\s\S]*?(?:<\/\s*script\s*>|$)/gi, " ").replace(/<\s*iframe\b[\s\S]*?(?:<\/\s*iframe\s*>|$)/gi, " ").replace(/<\s*object\b[\s\S]*?(?:<\/\s*object\s*>|$)/gi, " ").replace(/<\s*embed\b[^>]*>?/gi, " ").replace(/<\s*link\b[^>]*>?/gi, " ");
          const html = results.map((item, index) => {
            const isSaved = Boolean(item.saved);
            const saveIcon = isSaved ? "bookmark" : "bookmark_border";
            const saveClass = isSaved ? "saved" : "";
            const iconClass = isSaved ? "filled" : "";
            const dataContent = encodeURIComponent(JSON.stringify(item));
            const answerLetter = item.answerLetter || item.bestLetter || item.answer?.match(/\b(?:letter|letra|alternativa)\s*([A-E])\b/i)?.[1]?.toUpperCase() || null;
            const answerBody = (item.answerText || item.answer || "").replace(/^(?:Letter|Letra|Alternativa)\s*[A-E]\s*[:.\-]?\s*/i, "").replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, "").trim();
            const confidence = Number.isFinite(item.confidence) ? Math.round(item.confidence * 100) : null;
            const resultState = item.resultState || "inconclusive";
            const reasonKey = item.reason === "confirmed_by_sources" ? "result.reason.confirmed" : item.reason === "source_conflict" ? "result.reason.conflict" : item.reason === "ai_combined_suggestion" || item.reason === "ai_knowledge" ? "result.reason.suggested" : "result.reason.inconclusive";
            const votesEntries = item.votes ? Object.entries(item.votes) : [];
            const showVotes = votesEntries.length >= 2;
            const aiOverviewStatusText = item.googleMetaSignals ? this.t("result.meta.aiOverview", {
              status: this.t(item.googleMetaSignals.aiOverview ? "result.meta.captured" : "result.meta.absent")
            }) : "";
            const providerText = item.googleMetaSignals?.provider ? ` (${escapeHtml(this.t(item.googleMetaSignals.provider === "serpapi" ? "provider.serpapi" : "provider.serper"))})` : "";
            const overviewSummary = typeof item.overview?.summary === "string" ? item.overview.summary.trim() : "";
            const overviewPoints = Array.isArray(item.overview?.keyPoints) ? item.overview.keyPoints.map((point) => String(point || "").trim()).filter(Boolean) : [];
            const overviewReferences = Array.isArray(item.overview?.references) ? item.overview.references.map((ref) => ({
              title: String(ref?.title || "").trim(),
              link: String(ref?.link || "").trim()
            })).filter((ref) => ref.title || ref.link) : [];
            return `
        <div class="qa-card" style="animation-delay:${index * 0.07}s;">
          <div class="qa-card-header">
            <span class="material-symbols-rounded question-icon">help</span>
            <span class="qa-card-title">${escapeHtml(item.title || this.t("result.title"))}</span>
            <button class="action-btn save-btn ${saveClass}" data-content="${dataContent}" title="${escapeHtml(this.t("result.save"))}">
              <span class="material-symbols-rounded ${iconClass}">${saveIcon}</span>
            </button>
          </div>

          <div class="qa-card-question">${formatQuestionText(item.question)}</div>

          <div class="qa-card-ai-warning">
            <span class="material-symbols-rounded">info</span>
            <span>${escapeHtml(this.t("result.aiWarning"))}</span>
          </div>

          <div class="qa-card-answer">
            <div class="qa-card-answer-header ${item.userOverride ? "override-answer" : resultState === "conflict" ? "conflict-answer" : resultState === "suggested" || item.aiFallback ? item.aiFallback ? "ai-suggestion" : "suggested-answer" : ""}">
              <span class="material-symbols-rounded answer-state-icon">${(() => {
              if (item.userOverride) return "person";
              if (resultState === "confirmed") return "check_circle";
              if (resultState === "conflict") return "warning";
              if (resultState === "suggested") return "lightbulb";
              if (item.aiFallback) return "smart_toy";
              return "info";
            })()}</span>
              <span class="answer-header-title">${escapeHtml((() => {
              if (item.userOverride) return this.t("result.override.applied");
              if (resultState === "confirmed") return this.t("result.verifiedAnswer");
              if (resultState === "conflict") return this.t("result.inconclusiveAnswer");
              if (resultState === "suggested") return this.t("result.suggestedAnswer");
              if (item.aiFallback) return this.t("result.aiSuggestion");
              return this.t("result.correctAnswer");
            })())}</span>
              ${confidence !== null ? `
              <div class="confidence-pill" style="--conf-color: ${confidence >= 80 ? "#27AE60" : confidence >= 60 ? "#F39C12" : confidence >= 40 ? "#E67E22" : "#E74C3C"}">
                <svg class="confidence-ring" viewBox="0 0 36 36">
                  <circle class="confidence-ring-bg" cx="18" cy="18" r="15.9" />
                  <circle class="confidence-ring-fill" cx="18" cy="18" r="15.9" style="stroke: var(--conf-color); stroke-dasharray: ${confidence}, 100;" />
                </svg>
                <span class="confidence-value">${confidence}</span>
                <span class="confidence-tooltip">${escapeHtml(this.t("result.confidenceTooltip", { value: confidence }))}</span>
              </div>` : ""}
            </div>

            <div class="result-detail-strip">
              <span class="result-detail-reason">${escapeHtml(this.t(reasonKey))}</span>
              ${aiOverviewStatusText ? `<span class="result-detail-reason">${escapeHtml(aiOverviewStatusText)}${providerText}</span>` : ""}
              ${showVotes ? `<div class="result-votes-inline">
                <span class="votes-label-tooltip">
                  <span class="material-symbols-rounded votes-label-icon">help_outline</span>
                  <span class="votes-tooltip-text">${escapeHtml(this.t("result.votesTooltip"))}</span>
                </span>
                ${votesEntries.map(([letter, score]) => {
              const isTop = votesEntries.every(([, s]) => score >= s);
              return `<span class="vote-pill ${isTop ? "vote-top" : ""}" title="${escapeHtml(this.t("result.voteScoreTooltip", { letter, score: typeof score === "number" ? score.toFixed(1) : score }))}"><span class="vote-letter">${escapeHtml(letter)}</span><span class="vote-score">${typeof score === "number" ? score.toFixed(1) : score}</span></span>`;
            }).join("")}
              </div>` : ""}
            </div>

            ${answerLetter ? `<div class="answer-option"><div class="alternative answer-alternative"><span class="alt-letter">${escapeHtml(answerLetter)}</span><span class="alt-text">${escapeHtml(answerBody)}</span></div></div>` : `<div class="qa-card-answer-text">${escapeHtml(answerBody)}</div>`}

            ${item.aiReasoning ? `
            <details class="answer-reasoning">
              <summary class="answer-reasoning-toggle">
                <span class="material-symbols-rounded">psychology</span>
                <span>${escapeHtml(this.t("result.aiReasoning"))}</span>
                <span class="material-symbols-rounded answer-reasoning-caret">expand_more</span>
              </summary>
              <div class="answer-reasoning-body">${escapeHtml(item.aiReasoning)}</div>
            </details>` : ""}

            ${item.optionsMap && Object.keys(item.optionsMap).length >= 2 ? `
            <div class="answer-override-section">
              <button class="answer-override-trigger" type="button" title="${escapeHtml(this.t("result.override.tooltip"))}">
                <span class="material-symbols-rounded">edit</span>
                <span>${escapeHtml(this.t("result.override.btn"))}</span>
              </button>
              <div class="answer-override-pills" hidden>
                <span class="override-label">${escapeHtml(this.t("result.override.pick"))}</span>
                <div class="override-options">
                  ${Object.entries(item.optionsMap).sort(([a], [b]) => a.localeCompare(b)).map(
              ([letter, body]) => `<button class="override-pill ${letter === answerLetter ? "override-current" : ""}" data-letter="${escapeHtml(letter)}" data-body="${encodeURIComponent(body)}" title="${escapeHtml(body.slice(0, 100))}" type="button"><span class="override-pill-letter">${escapeHtml(letter)}</span><span class="override-pill-body">${escapeHtml(body.length > 50 ? body.slice(0, 47) + "..." : body)}</span></button>`
            ).join("")}
                </div>
                <button class="override-cancel" type="button">${escapeHtml(this.t("result.override.cancel"))}</button>
              </div>
            </div>` : ""}

            <div class="study-actions-container">
              <button class="study-action-btn btn-tutor" type="button" data-question="${encodeURIComponent(item.question)}" data-answer="${encodeURIComponent(item.answer || "")}" data-context="${encodeURIComponent(overviewSummary || Object.values(item.optionsMap || {}).join(" "))}" title="${escapeHtml(this.t("result.tutor.title"))}">
                <span class="material-symbols-rounded">school</span>
                <span>${escapeHtml(this.t("result.tutor.btn"))}</span>
              </button>
              <button class="study-action-btn btn-similar" type="button" data-question="${encodeURIComponent(item.question)}" title="${escapeHtml(this.t("result.similar.title"))}">
                <span class="material-symbols-rounded">quiz</span>
                <span>${escapeHtml(this.t("result.similar.btn"))}</span>
              </button>
              <button class="study-action-btn btn-chat" type="button" data-question="${encodeURIComponent(item.question)}" data-answer="${encodeURIComponent(item.answer || "")}" data-context="${encodeURIComponent(overviewSummary || Object.values(item.optionsMap || {}).join(" "))}" title="${escapeHtml(this.t("result.chat.title") || "Follow-up Chat")}">
                <span class="material-symbols-rounded">forum</span>
                <span>${escapeHtml(this.t("result.chat.btn") || "D\xFAvidas")}</span>
              </button>
            </div>
            <div class="study-feature-output hidden"></div>

            ${overviewSummary ? `<div class="qa-card-answer-text"><strong>${escapeHtml(this.t("result.overview.title"))}</strong><br>${escapeHtml(overviewSummary)}</div>` : ""}
            ${overviewPoints.length > 0 ? `<div class="qa-card-answer-text"><strong>${escapeHtml(this.t("result.overview.points"))}</strong><br>${overviewPoints.map((point) => `\u2022 ${escapeHtml(point)}`).join("<br>")}</div>` : ""}
            ${overviewReferences.length > 0 ? `<div class="qa-card-answer-text"><strong>${escapeHtml(this.t("result.overview.references"))}</strong><br>${overviewReferences.map((ref) => {
              const label = escapeHtml(ref.title || ref.link);
              const safeRefLink = sanitizeUrl(ref.link, "overview-reference");
              return safeRefLink ? `<a href="${escapeHtml(safeRefLink)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`;
            }).join("<br>")}</div>` : ""}
          </div>

          <div class="qa-card-actions">
            ${Array.isArray(item.sources) && item.sources.length > 0 ? `<div class="sources-box">
                  <button class="sources-toggle" type="button" aria-expanded="false">
                    <span class="material-symbols-rounded">link</span>
                    <span>${escapeHtml(this.t("result.sources", { count: item.sources.length }))}</span>
                    <span class="material-symbols-rounded sources-caret">expand_more</span>
                  </button>
                  <div class="sources-list" hidden>
                    ${item.sources.map((source) => {
              let host = source.title || source.link || "";
              const safeSourceLink = sanitizeUrl(source.link, "source-link");
              try {
                if (safeSourceLink) host = new URL(safeSourceLink).hostname;
              } catch (_) {
              }
              return `<div class="source-item">${safeSourceLink ? `<a href="${escapeHtml(safeSourceLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)}</a>` : `<span>${escapeHtml(host)}</span>`}</div>`;
            }).join("")}
                  </div>
                </div>` : `<div class="source muted">${escapeHtml(this.t("result.source"))}: AI</div>`}
          </div>
        </div>
      `;
          }).join("");
          this.elements.resultsDiv.innerHTML = sanitizeInjectedMarkup(html);
          this.elements.resultsDiv.querySelectorAll('script, iframe, object, embed, link[rel="preload"][as="script"], link[rel="modulepreload"]').forEach((el) => el.remove());
          if (discardedUrlDiagnostics.length > 0) {
            const compact = discardedUrlDiagnostics.slice(0, 6).map((d) => `[${d.context}] ${d.reason}: ${d.raw}`).join(" | ");
            console.warn(`AnswerHunter: Sanitizer discarded ${discardedUrlDiagnostics.length} URL(s): ${compact}`);
          }
        },
        getAllResultsText() {
          let text = "";
          const cards = this.elements.resultsDiv?.querySelectorAll(".qa-card") || [];
          cards.forEach((card, index) => {
            const question = card.querySelector(".qa-card-question")?.innerText?.trim() || "";
            let answer = "";
            const answerText = card.querySelector(".qa-card-answer-text")?.innerText?.trim();
            if (answerText) {
              answer = answerText;
            } else {
              const letter = card.querySelector(".answer-alternative .alt-letter")?.innerText?.trim() || "";
              const body = card.querySelector(".answer-alternative .alt-text")?.innerText?.trim() || "";
              answer = [letter, body].filter(Boolean).join(" - ");
            }
            text += `Q${index + 1}: ${question}
A: ${answer}

`;
          });
          return text;
        },
        setSaveButtonState(button, saved) {
          const icon = button.querySelector(".material-symbols-rounded");
          button.classList.toggle("saved", !!saved);
          if (icon) {
            icon.textContent = saved ? "bookmark" : "bookmark_border";
            icon.classList.toggle("filled", !!saved);
          }
        },
        resetAllSaveButtons() {
          document.querySelectorAll(".save-btn").forEach((button) => this.setSaveButtonState(button, false));
        },
        renderBinderList(folder, options = {}) {
          if (!this.elements.binderList) return;
          const { showBackupReminder = false, isStudyMode = false } = options;
          const sanitizeUrl = (rawUrl) => {
            const value = String(rawUrl || "").trim();
            if (!value) return "";
            try {
              const parsed = new URL(value);
              return /^https?:$/i.test(parsed.protocol) ? parsed.href : "";
            } catch (_) {
              return "";
            }
          };
          const sanitizeInjectedMarkup = (markup) => String(markup || "").replace(/<\s*script\b[\s\S]*?(?:<\/\s*script\s*>|$)/gi, " ").replace(/<\s*iframe\b[\s\S]*?(?:<\/\s*iframe\s*>|$)/gi, " ").replace(/<\s*object\b[\s\S]*?(?:<\/\s*object\s*>|$)/gi, " ").replace(/<\s*embed\b[^>]*>?/gi, " ").replace(/<\s*link\b[^>]*>?/gi, " ");
          const reminderHtml = showBackupReminder ? `<div class="backup-reminder"><span class="material-symbols-rounded">backup</span><span>${escapeHtml(this.t("binder.backupReminder"))}</span><button class="dismiss-reminder" title="${escapeHtml(this.t("binder.backupDismiss"))}"><span class="material-symbols-rounded" style="font-size:16px;">close</span></button></div>` : "";
          let html = `
      ${reminderHtml}
      <div class="binder-toolbar">
        <span class="crumb-current"><span class="material-symbols-rounded" style="font-size:18px;">folder_open</span> ${folder.id === "root" ? escapeHtml(this.t("binder.title")) : escapeHtml(folder.title)}</span>
        <div class="toolbar-actions">
          ${folder.id !== "root" ? `<button id="btnBackRoot" class="toolbar-icon-btn" title="${escapeHtml(this.t("binder.back"))}"><span class="material-symbols-rounded" style="font-size:18px;">arrow_back</span></button>` : ""}
          <button id="btnStudyMode" class="toolbar-icon-btn ${isStudyMode ? "active-study-mode" : ""}" title="${escapeHtml(this.t("binder.studyMode.toggle") || "Study Mode")}"><span class="material-symbols-rounded" style="font-size:18px;">${isStudyMode ? "school" : "menu_book"}</span></button>
          <button id="newFolderBtnBinder" class="toolbar-icon-btn" title="${escapeHtml(this.t("binder.newFolder"))}"><span class="material-symbols-rounded" style="font-size:18px;">create_new_folder</span></button>
          <button id="exportBinderBtn" class="toolbar-icon-btn" title="Export"><span class="material-symbols-rounded" style="font-size:18px;">download</span></button>
          <button id="importBinderBtn" class="toolbar-icon-btn" title="Import"><span class="material-symbols-rounded" style="font-size:18px;">upload</span></button>
        </div>
      </div>
      <div class="binder-content">
    `;
          if (!Array.isArray(folder.children) || folder.children.length === 0) {
            html += `<div class="placeholder"><p>${escapeHtml(this.t("binder.emptyFolder"))}</p></div>`;
          } else {
            folder.children.forEach((item) => {
              if (item.type === "folder") {
                html += `
            <div class="folder-item drop-zone" draggable="true" data-id="${item.id}" data-type="folder">
              <div class="folder-info">
                <span class="material-symbols-rounded folder-icon">folder</span>
                <span class="folder-name">${escapeHtml(item.title)}</span>
              </div>
              <div class="folder-actions">
                <button class="action-btn rename-btn" data-id="${item.id}" title="${escapeHtml(this.t("binder.rename"))}"><span class="material-symbols-rounded" style="font-size:18px;">edit</span></button>
                <button class="action-btn delete-btn" data-id="${item.id}" title="${escapeHtml(this.t("binder.delete"))}"><span class="material-symbols-rounded" style="font-size:18px;">delete</span></button>
              </div>
            </div>
          `;
                return;
              }
              const questionText = item.content?.question || "";
              const preview = questionText.length > 60 ? `${questionText.slice(0, 60)}...` : questionText;
              const answerRaw = item.content?.answer || "";
              const answerLetter = answerRaw.match(/\b(?:letter|letra|alternativa)\s*([A-E])\b/i)?.[1]?.toUpperCase() || null;
              const answerBody = answerRaw.replace(/^(?:Letter|Letra|Alternativa)\s*[A-E]\s*[:.\-]?\s*/i, "").replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, "").trim();
              const safeSourceLink = sanitizeUrl(item.content?.source);
              let host = "";
              if (safeSourceLink) {
                host = safeSourceLink;
                try {
                  host = new URL(safeSourceLink).hostname;
                } catch (_) {
                }
              }
              html += `
          <div class="qa-item expandable" draggable="true" data-id="${item.id}" data-type="question">
            <div class="summary-view">
              <div class="summary-icon"><span class="material-symbols-rounded">quiz</span></div>
              <div class="summary-content"><div class="summary-title">${escapeHtml(preview)}</div></div>
              <span class="material-symbols-rounded expand-indicator">expand_more</span>
            </div>

            <div class="full-view" style="display:none;">
              <div class="qa-card">
                <div class="qa-card-header">
                  <span class="material-symbols-rounded question-icon">help</span>
                  <span class="qa-card-title">${escapeHtml(this.t("binder.savedQuestion"))}</span>
                </div>

                <div class="qa-card-question">${formatQuestionText(questionText)}</div>

                ${isStudyMode ? `
                <button class="study-reveal-btn" type="button">
                  <span class="material-symbols-rounded">visibility</span>
                  <span>${escapeHtml(this.t("binder.studyMode.reveal") || "Ver Resposta")}</span>
                </button>
                ` : ""}
                <div class="qa-card-answer ${isStudyMode ? "study-hidden" : ""}">
                  <div class="qa-card-answer-header ${item.aiFallback ? "ai-suggestion" : item.resultState === "conflict" ? "conflict-answer" : item.resultState === "confirmed" ? "" : "suggested-answer"}">
                    <span class="material-symbols-rounded">${item.aiFallback ? "auto_awesome" : item.resultState === "conflict" ? "help_outline" : item.resultState === "confirmed" ? "check_circle" : "lightbulb"}</span>
                    ${escapeHtml(
                item.aiFallback ? this.t("result.aiSuggestion") || "AI Suggestion" : item.resultState === "conflict" ? this.t("result.inconclusive") || "Inconclusive" : item.resultState === "confirmed" ? this.t("result.correctAnswer") : this.t("result.suggestedAnswer") || "Suggested Answer"
              )}
                  </div>
                  ${answerLetter ? `<div class="answer-option"><div class="alternative answer-alternative"><span class="alt-letter">${escapeHtml(answerLetter)}</span><span class="alt-text">${escapeHtml(answerBody)}</span></div></div>` : `<div class="qa-card-answer-text">${escapeHtml(answerBody)}</div>`}
                </div>

                <div class="study-actions-container">
                  <button class="study-action-btn btn-tutor" type="button" data-question="${encodeURIComponent(questionText)}" data-answer="${encodeURIComponent(answerRaw || "")}" data-context="${encodeURIComponent(item.content?.overview?.summary || "")}" title="${escapeHtml(this.t("result.tutor.title") || "Tutor")}">
                    <span class="material-symbols-rounded">school</span>
                    <span>${escapeHtml(this.t("result.tutor.btn") || "Tutor")}</span>
                  </button>
                  <button class="study-action-btn btn-similar" type="button" data-question="${encodeURIComponent(questionText)}" title="${escapeHtml(this.t("result.similar.title") || "Similar Question")}">
                    <span class="material-symbols-rounded">quiz</span>
                    <span>${escapeHtml(this.t("result.similar.btn") || "Similar")}</span>
                  </button>
                  <button class="study-action-btn btn-chat" type="button" data-question="${encodeURIComponent(questionText)}" data-answer="${encodeURIComponent(answerRaw || "")}" data-context="${encodeURIComponent(item.content?.overview?.summary || "")}" title="${escapeHtml(this.t("result.chat.title") || "Follow-up Chat")}">
                    <span class="material-symbols-rounded">forum</span>
                    <span>${escapeHtml(this.t("result.chat.btn") || "D\xFAvidas")}</span>
                  </button>
                </div>
                <div class="study-feature-output hidden"></div>

                <div class="qa-card-actions">
                  ${safeSourceLink ? `<div class="sources-box"><button class="sources-toggle" type="button" aria-expanded="false"><span class="material-symbols-rounded">link</span><span>${escapeHtml(this.t("result.source"))}</span><span class="material-symbols-rounded sources-caret">expand_more</span></button><div class="sources-list" hidden><div class="source-item"><a href="${escapeHtml(safeSourceLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)}</a></div></div></div>` : ""}
                  <div class="binder-actions">
                    <button class="action-btn copy-single-btn" data-id="${item.id}" title="${escapeHtml(this.t("binder.copy"))}"><span class="material-symbols-rounded">content_copy</span></button>
                    <button class="action-btn delete-btn" data-id="${item.id}" title="${escapeHtml(this.t("binder.delete"))}"><span class="material-symbols-rounded">delete</span></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
            });
          }
          html += "</div>";
          this.elements.binderList.innerHTML = sanitizeInjectedMarkup(html);
          this.elements.binderList.querySelectorAll('script, iframe, object, embed, link[rel="preload"][as="script"], link[rel="modulepreload"]').forEach((el) => el.remove());
        }
      };
    }
  });

  // src/popup/popup.js
  var require_popup = __commonJS({
    "src/popup/popup.js"() {
      init_PopupController();
      init_PopupView();
      document.addEventListener("DOMContentLoaded", () => {
        PopupView.init();
        PopupController.init(PopupView);
      });
    }
  });
  require_popup();
})();
