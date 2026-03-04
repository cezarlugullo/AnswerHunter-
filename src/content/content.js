// Content script - executes on all pages
// Responsible for optional utilities on the page (e.g., answer highlighting).

(function () {
    'use strict';

    const runtime = globalThis.chrome?.runtime;
    if (runtime?.onMessage?.addListener) {
        runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request && request.action === 'highlight') {
                highlightAnswers();
                sendResponse({ success: true });
                return true;
            }
            return false;
        });
    }

    function highlightAnswers() {
        // Removes previous highlights
        document.querySelectorAll('.qa-extractor-highlight').forEach((el) => {
            el.classList.remove('qa-extractor-highlight');
        });

        // Combined selector — word-boundary class matches + semantic itemprop
        const combinedSelector = [
            '[class~="answer"]', '[class~="resposta"]', '[class~="solution"]', '[class~="reply"]',
            '[class*="answer-body"]', '[class*="answer-content"]',
            '[class*="resposta-body"]', '[class*="resposta-content"]',
            '[itemprop="acceptedAnswer"]'
        ].join(', ');

        document.querySelectorAll(combinedSelector).forEach((el) => {
            if (el && el.textContent && el.textContent.length > 20) {
                el.classList.add('qa-extractor-highlight');
            }
        });
    }
})();

