import { PopupController } from '../controllers/PopupController.js';
import { PopupView } from '../views/PopupView.js';
import { SearchService } from '../services/SearchService.js';
import { ApiService } from '../services/ApiService.js';
import { DebugLogger } from '../utils/DebugLogger.js';

document.addEventListener('DOMContentLoaded', async () => {
    await DebugLogger.bootstrap();

    // Popup flow instrumentation
    DebugLogger.instrumentService('PopupController', PopupController, [
        'init',
        'handleExtract',
        'handleSearch',
        'handleSaveSetup',
        'handleTestProvider',
        'setProviderPill',
        'persistAiConfig',
        'renderAiFallback',
        'restoreLastResults',
        'handleResultClick'
    ]);

    // Search/evidence pipeline instrumentation
    DebugLogger.instrumentService('SearchService', SearchService, [
        'searchOnly',
        'answerFromAi',
        'processExtractedItems',
        'refineFromResults',
        'searchAndRefine',
        '_recordSearchMetrics'
    ]);

    // AI/provider instrumentation (model/provider/quota snapshots included)
    DebugLogger.instrumentService('ApiService', ApiService, [
        '_callGemini',
        '_geminiConsensus',
        '_groqConsensus',
        '_withGroqRateLimit',
        '_fetch',
        'validateQuestion',
        'extractTextFromScreenshot',
        'searchWithSerper',
        'aiExtractFromPage',
        'aiExtractFromHtml',
        'extractAnswerFromSource',
        'inferAnswerFromEvidence',
        'generateOverviewFromEvidence',
        'generateKnowledgeAnswer',
        'generateAnswerFromQuestion',
        'refineWithAI'
    ]);

    // Initialize the view (cache DOM elements)
    PopupView.init();

    // Initialize the controller (bind events, load data)
    PopupController.init(PopupView);
});
