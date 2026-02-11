// Content script - executes on all pages
// Responsible for optional utilities on the page (e.g., answer highlighting).

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
        // Removes previous highlights
        document.querySelectorAll('.qa-extractor-highlight').forEach((el) => {
            el.classList.remove('qa-extractor-highlight');
        });

        // Answer selectors
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

