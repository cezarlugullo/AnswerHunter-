// Content script - executa em todas as páginas
// Adiciona funcionalidade de highlight nas respostas encontradas

(function () {
    'use strict';

    // Listener para mensagens do popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'highlight') {
            highlightAnswers();
            sendResponse({ success: true });
        }
        if (request.action === 'pick-question') {
            startPickQuestion(sendResponse);
            return true;
        }
        return true;
    });

    function highlightAnswers() {
        // Remove highlights anteriores
        document.querySelectorAll('.qa-extractor-highlight').forEach(el => {
            el.classList.remove('qa-extractor-highlight');
        });

        // Seletores de respostas
        const answerSelectors = [
            '[class*="answer"]',
            '[class*="resposta"]',
            '[class*="solution"]',
            '[class*="reply"]',
            '[itemprop="acceptedAnswer"]'
        ];

        answerSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if (el.innerText && el.innerText.length > 20) {
                    el.classList.add('qa-extractor-highlight');
                }
            });
        });
    }

    function startPickQuestion(sendResponse) {
        if (window.__answerHunterPickActive) {
            sendResponse({ error: 'picker-active' });
            return;
        }
        window.__answerHunterPickActive = true;

        const outline = document.createElement('div');
        outline.id = 'answerhunter-picker-outline';
        Object.assign(outline.style, {
            position: 'fixed',
            border: '2px solid #FF6B00',
            background: 'rgba(255, 107, 0, 0.08)',
            zIndex: '2147483647',
            pointerEvents: 'none',
            borderRadius: '6px',
            boxSizing: 'border-box'
        });

        const hint = document.createElement('div');
        hint.id = 'answerhunter-picker-hint';
        hint.textContent = 'Clique na pergunta para selecionar (Esc cancela)';
        Object.assign(hint.style, {
            position: 'fixed',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#FF6B00',
            color: '#FFFFFF',
            padding: '6px 10px',
            fontSize: '12px',
            fontFamily: 'Arial, sans-serif',
            borderRadius: '999px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            zIndex: '2147483647',
            pointerEvents: 'none'
        });

        document.documentElement.appendChild(outline);
        document.documentElement.appendChild(hint);

        let currentTarget = null;
        const screenCenterX = window.innerWidth / 2;
        const screenCenterY = window.innerHeight / 2;

        // Função auxiliar para extrair texto com proteção contra seleção
        const extractTextSafely = (el) => {
            try {
                // Tenta innerText primeiro
                if (el.innerText) return el.innerText.trim();
            } catch (e) {}
            
            try {
                // Tenta textContent
                if (el.textContent) return el.textContent.trim();
            } catch (e) {}
            
            try {
                // Se tudo falhar, tenta juntar o texto de todos os nós filhos
                let text = '';
                for (let child of el.childNodes) {
                    if (child.nodeType === 3) { // Node.TEXT_NODE
                        text += child.textContent;
                    } else if (child.nodeType === 1) { // Node.ELEMENT_NODE
                        text += extractTextSafely(child);
                    }
                }
                return text.trim();
            } catch (e) {}
            
            return '';
        };

        // Função para encontrar questões por estrutura DOM (fallback para proteção de seleção)
        const findQuestionByStructure = () => {
            let bestElement = null;
            let bestScore = -Infinity;

            const allElements = document.querySelectorAll('div, section, article');
            
            for (const el of allElements) {
                const rect = el.getBoundingClientRect();
                
                // Pular elementos muito pequenos ou fora da viewport
                if (rect.width < 100 || rect.height < 50) continue;
                if (rect.top >= window.innerHeight || rect.bottom <= 0) continue;
                if (rect.left >= window.innerWidth || rect.right <= 0) continue;

                // Contar filhos e estrutura
                const children = el.children.length;
                const labels = el.querySelectorAll('label').length;
                const inputs = el.querySelectorAll('input, textarea').length;
                const ps = el.querySelectorAll('p').length;
                const lis = el.querySelectorAll('li').length;
                
                // Procurar por estrutura típica de questão
                let structureScore = 0;
                
                // Questão com múltiplas opções
                if (labels >= 2 || lis >= 2) structureScore += 100;
                if (inputs >= 2) structureScore += 80;
                if (ps >= 2) structureScore += 50;
                if (children >= 3 && children <= 20) structureScore += 60; // Número típico de opções
                
                // Bônus por tamanho razoável
                if (rect.width > 200 && rect.height > 100) structureScore += 40;
                if (rect.width < window.innerWidth * 0.95) structureScore += 30;
                
                // Bônus por estar perto do centro
                const elementCenterX = rect.left + rect.width / 2;
                const elementCenterY = rect.top + rect.height / 2;
                const distToCenter = Math.sqrt(
                    Math.pow(elementCenterX - screenCenterX, 2) +
                    Math.pow(elementCenterY - screenCenterY, 2)
                );
                structureScore += Math.max(0, 40 - distToCenter / 100);
                
                // Penalidade se for muito grande
                if (rect.width > window.innerWidth * 0.9 || rect.height > window.innerHeight * 0.8) {
                    structureScore -= 50;
                }
                
                if (structureScore > bestScore) {
                    bestScore = structureScore;
                    bestElement = el;
                }
            }

            return bestElement;
        };

        // Função para encontrar containers com alternativas (A, B, C, D, E)
        const findQuestionByAlternatives = () => {
            let bestElement = null;
            let bestScore = -Infinity;

            const allElements = document.querySelectorAll('*');
            
            for (const el of allElements) {
                const rect = el.getBoundingClientRect();
                const text = el.innerText?.trim() || '';

                // Pular elementos muito pequenos ou fora da viewport
                if (rect.width < 5 || rect.height < 5) continue;
                if (rect.top >= window.innerHeight || rect.bottom <= 0) continue;
                if (rect.left >= window.innerWidth || rect.right <= 0) continue;
                if (text.length < 30) continue;

                // Procurar por padrão de alternativas
                const alternativePattern = /[A-E]\)\s[\w]/gi;
                const matches = text.match(alternativePattern) || [];
                
                if (matches.length >= 2) {
                    // Encontrou pelo menos 2 alternativas - é provavelmente uma questão
                    let score = matches.length * 100; // Pontuação por número de alternativas
                    score += Math.min(text.length / 50, 50); // Bônus por texto
                    
                    // Bônus se tiver "?" na questão
                    if (text.includes('?')) score += 200;
                    
                    // Bônus por classes
                    if (el.className.includes('question') || el.className.includes('pergunta') ||
                        el.className.includes('exercise') || el.className.includes('qa')) score += 100;
                    
                    // Bônus se estiver perto do centro
                    const elementCenterX = rect.left + rect.width / 2;
                    const elementCenterY = rect.top + rect.height / 2;
                    const distToCenter = Math.sqrt(
                        Math.pow(elementCenterX - screenCenterX, 2) +
                        Math.pow(elementCenterY - screenCenterY, 2)
                    );
                    score += Math.max(0, 30 - distToCenter / 50);
                    
                    // Penalidade se muito grande
                    if (text.length > 4000) score -= 50;
                    if (rect.width > window.innerWidth * 0.95) score -= 50;

                    if (score > bestScore) {
                        bestScore = score;
                        bestElement = el;
                    }
                }
            }

            return bestElement;
        };

        // Função para encontrar a melhor questão visível na tela
        const findBestQuestionInViewport = () => {
            let bestElement = null;
            let bestScore = -Infinity;

            // Procurar por elementos que pareçam questões
            const allElements = document.querySelectorAll('*');
            
            for (const el of allElements) {
                const rect = el.getBoundingClientRect();
                const text = el.innerText?.trim() || '';

                // Pular elementos muito pequenos ou fora da viewport
                if (rect.width < 5 || rect.height < 5) continue;
                if (rect.top >= window.innerHeight || rect.bottom <= 0) continue;
                if (rect.left >= window.innerWidth || rect.right <= 0) continue;
                if (text.length < 10) continue;

                // Calcular score
                let score = 0;

                // Pontuação base por tamanho de texto
                score = Math.min(text.length / 100, 10);

                // Bônus por indicadores de questão
                if (text.includes('?')) score += 50;
                if (/[A-E]\)\s|[A-E]\]\s|[A-E]\s\-/i.test(text)) score += 30;
                if (/Questão|Pergunta|Exercício|Atividade|Problema/i.test(text)) score += 20;
                if (el.className.includes('question') || el.className.includes('pergunta') ||
                    el.className.includes('exercise') || el.className.includes('qa-item')) score += 20;

                // Bônus por estar próximo ao centro (mas não tão crucial)
                const elementCenterX = rect.left + rect.width / 2;
                const elementCenterY = rect.top + rect.height / 2;
                const distToCenter = Math.sqrt(
                    Math.pow(elementCenterX - screenCenterX, 2) +
                    Math.pow(elementCenterY - screenCenterY, 2)
                );
                score += Math.max(0, 20 - distToCenter / 50);

                // Penalidade se for muito grande (container)
                if (text.length > 3000) score -= 30;
                if (rect.width > window.innerWidth * 0.9) score -= 20;

                if (score > bestScore) {
                    bestScore = score;
                    bestElement = el;
                }
            }

            return bestElement;
        };

        // Encontrar questão inicial quando o picker é ativado
        const updateHighlight = () => {
            let target = currentTarget;
            
            if (!target) {
                // Primeiro tenta por estrutura DOM (melhor para proteção contra seleção)
                target = findQuestionByStructure();
                
                // Se não encontrou, tenta o método por padrões de texto
                if (!target) {
                    target = findBestQuestionInViewport();
                }
                
                // Se ainda não encontrou, tenta buscar por alternativas
                if (!target) {
                    target = findQuestionByAlternatives();
                }
            }
            
            if (target) {
                currentTarget = target;
                const rect = target.getBoundingClientRect();
                outline.style.top = `${Math.max(0, rect.top)}px`;
                outline.style.left = `${Math.max(0, rect.left)}px`;
                outline.style.width = `${rect.width}px`;
                outline.style.height = `${rect.height}px`;
            }
        };

        // Atualizar imediatamente
        updateHighlight();

        const onMove = (e) => {
            const target = e.target;
            if (!target || target === outline || target === hint) return;

            // Procurar por elemento de questão a partir do mouse
            let current = target;
            let bestElement = null;
            let bestScore = -1;

            for (let depth = 0; depth < 8 && current; depth++) {
                if (current.nodeType !== 1) {
                    current = current.parentElement;
                    continue;
                }

                const text = current.innerText?.trim() || '';
                const rect = current.getBoundingClientRect();

                if (rect.width < 5 || rect.height < 5 || text.length < 10) {
                    current = current.parentElement;
                    continue;
                }

                if (rect.top >= window.innerHeight || rect.bottom <= 0 ||
                    rect.left >= window.innerWidth || rect.right <= 0) {
                    current = current.parentElement;
                    continue;
                }

                let score = text.length;
                if (text.includes('?')) score += 5000;
                if (/[A-E]\)\s|[A-E]\]\s|[A-E]\s\-/i.test(text)) score += 3000;
                if (/Questão|Pergunta|Exercício|Atividade|Problema/i.test(text)) score += 2000;
                if (current.className.includes('question') || current.className.includes('pergunta')) score += 1500;

                if (text.length > 5000) score -= 500;

                if (score > bestScore) {
                    bestScore = score;
                    bestElement = current;
                }

                current = current.parentElement;
            }

            if (bestElement) {
                currentTarget = bestElement;
                const rect = bestElement.getBoundingClientRect();
                outline.style.top = `${Math.max(0, rect.top)}px`;
                outline.style.left = `${Math.max(0, rect.left)}px`;
                outline.style.width = `${rect.width}px`;
                outline.style.height = `${rect.height}px`;
            } else {
                // Fallback 1: Tenta detectar por alternativas
                let altElement = findQuestionByAlternatives();
                
                // Fallback 2: Se ainda não encontrou, tenta por estrutura
                if (!altElement) {
                    altElement = findQuestionByStructure();
                }
                
                if (altElement) {
                    currentTarget = altElement;
                    const rect = altElement.getBoundingClientRect();
                    outline.style.top = `${Math.max(0, rect.top)}px`;
                    outline.style.left = `${Math.max(0, rect.left)}px`;
                    outline.style.width = `${rect.width}px`;
                    outline.style.height = `${rect.height}px`;
                }
            }
        };

        const cleanup = () => {
            window.__answerHunterPickActive = false;
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKey, true);
            if (outline.parentNode) outline.parentNode.removeChild(outline);
            if (hint.parentNode) hint.parentNode.removeChild(hint);
        };

        const onClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const text = extractQuestionFromTarget(currentTarget || e.target);
            cleanup();
            sendResponse({ question: text });
        };

        const onKey = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                sendResponse({ cancelled: true });
            }
        };

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKey, true);
    }

    function extractQuestionFromTarget(target) {
        if (!target) return '';

        const cleanText = (text) => (text || '').replace(/\s+/g, ' ').trim();

        const candidates = [];
        let current = target;
        let depth = 0;

        while (current && depth < 10) {
            if (current.nodeType === 1) {
                const text = cleanText(current.innerText);
                if (text.length > 30) {
                    let score = 0;
                    if (text.includes('?')) score += 4;
                    if (/Atividade|Questao|Exercicio|Pergunta/i.test(text)) score += 3;
                    if (current.querySelectorAll('input, label, li').length >= 2) score += 2;
                    if (text.length <= 2000) score += 1;
                    candidates.push({ text, score });
                }
            }
            current = current.parentElement;
            depth++;
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
            return candidates[0].text.substring(0, 3500);
        }

        const fallback = cleanText(target.innerText);
        return fallback.substring(0, 3500);
    }
})();
