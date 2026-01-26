// Content script - executa em todas as páginas
// Busca automática de questões conforme o usuário rola

(function () {
    'use strict';

    // Estado do auto search
    let autoSearchActive = false;
    let questionsToTrack = [];
    let questionElements = [];

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
        if (request.action === 'startAutoSearch') {
            startAutoSearch(request.questions);
            sendResponse({ success: true });
        }
        if (request.action === 'stopAutoSearch') {
            stopAutoSearch();
            sendResponse({ success: true });
        }
        return true;
    });

    // === AUTO SEARCH - DETECTAR QUESTÃO VISÍVEL ===
    function startAutoSearch(questions) {
        questionsToTrack = questions;
        autoSearchActive = true;
        questionElements = [];

        console.log('AnswerHunter: Auto search iniciado. Rastreando', questions.length, 'questões');

        // Encontrar elementos de questão na página
        const pageText = document.body.innerText || '';
        
        // Procurar por elementos que contenham as primeiras palavras de cada questão
        questions.forEach((question, index) => {
            // Buscar por padrão numérico (Questão 1, 2, 3, etc) ou apenas o text
            const firstWords = question.substring(0, 30);
            
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                if (el.innerText && el.innerText.includes(firstWords) && !el.querySelector('script')) {
                    questionElements.push({
                        index,
                        element: el,
                        text: question
                    });
                    break;
                }
            }
        });

        console.log('AnswerHunter: Encontrados', questionElements.length, 'elementos de questão');

        // Iniciar observer de scroll
        observeVisibleQuestions();
    }

    function stopAutoSearch() {
        autoSearchActive = false;
        questionsToTrack = [];
        questionElements = [];
        console.log('AnswerHunter: Auto search parado');
    }

    function observeVisibleQuestions() {
        const handleScroll = () => {
            if (!autoSearchActive) return;

            // Encontrar qual questão está mais visível na tela
            let mostVisibleIndex = -1;
            let maxVisibility = 0;

            questionElements.forEach(qEl => {
                const rect = qEl.element.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                
                // Calcular quanto da questão está visível
                const topVisible = Math.max(0, rect.top);
                const bottomVisible = Math.min(viewportHeight, rect.bottom);
                const visibleHeight = Math.max(0, bottomVisible - topVisible);
                const visibility = visibleHeight / (rect.height || 1);

                // Se a questão ocupa pelo menos 30% da tela, considerar como visível
                if (visibility > maxVisibility && visibility > 0.3) {
                    maxVisibility = visibility;
                    mostVisibleIndex = qEl.index;
                }
            });

            // Se encontrou uma questão visível, notificar o popup
            if (mostVisibleIndex >= 0) {
                console.log('AnswerHunter: Questão visível:', mostVisibleIndex);
                
                chrome.runtime.sendMessage({
                    action: 'visibleQuestionChanged',
                    questionIndex: mostVisibleIndex
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log('AnswerHunter: Popup não respondeu');
                    }
                });
            }
        };

        // Listener de scroll
        window.addEventListener('scroll', handleScroll, { passive: true });
        
        // Também verificar quando a página carrega
        handleScroll();
    }

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

        const onMove = (e) => {
            const target = e.target;
            if (!target || target === outline || target === hint) return;
            const rect = target.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return;
            currentTarget = target;
            outline.style.top = `${Math.max(0, rect.top)}px`;
            outline.style.left = `${Math.max(0, rect.left)}px`;
            outline.style.width = `${rect.width}px`;
            outline.style.height = `${rect.height}px`;
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
