// Content script - executa em todas as paginas
// Responsavel por utilitarios opcionais na pagina (ex: highlight de respostas).

(function () {
    'use strict';

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request && request.action === 'highlight') {
            highlightAnswers();
            sendResponse({ success: true });
        }
        return true;
    });

    function highlightAnswers() {
        // Remove highlights anteriores
        document.querySelectorAll('.qa-extractor-highlight').forEach((el) => {
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

        answerSelectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => {
                if (el && el.innerText && el.innerText.length > 20) {
                    el.classList.add('qa-extractor-highlight');
                }
            });
        });
    }
})();

