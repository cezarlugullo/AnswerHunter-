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


// ============================================================
// ah-mpicker — Custom Model Picker Initialization
// Syncs with hidden <select id="select-copilot-model">
// ============================================================
function initCopilotModelPicker() {
  const picker   = document.getElementById('copilot-model-picker');
  const panel    = document.getElementById('copilot-model-panel');
  const trigger  = document.getElementById('copilot-model-trigger');
  const hidden   = document.getElementById('select-copilot-model');

  if (!picker || !panel || !trigger || !hidden) return;

  const triggerIcon = trigger.querySelector('.ah-mpicker-trigger-icon');
  const triggerName = trigger.querySelector('.ah-mpicker-trigger-name');
  const triggerMeta = trigger.querySelector('.ah-mpicker-trigger-meta');
  const options     = panel.querySelectorAll('.ah-mpicker-option');

  // --- Select an option by value ---
  function selectByValue(value, fireEvent = false) {
    let matched = null;
    options.forEach(opt => {
      const isMatch = opt.dataset.value === value;
      opt.classList.toggle('ah-mpicker-option--selected', isMatch);
      if (isMatch) matched = opt;
    });
    if (matched) {
      const name = matched.querySelector('.ah-mpicker-opt-name')?.textContent || value;
      const icon = matched.dataset.icon || 'auto_awesome';
      const meta = matched.dataset.meta || '';
      triggerIcon.textContent = icon;
      triggerName.textContent = name;
      triggerMeta.textContent = meta;
    }
    if (fireEvent && hidden.value !== value) {
      hidden.value = value;
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // --- Toggle open/close ---
  function openPicker() {
    // Detect if we should open upward
    const rect = picker.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    picker.classList.toggle('ah-mpicker--up', spaceBelow < 200);
    picker.classList.add('ah-mpicker--open');
    trigger.setAttribute('aria-expanded', 'true');
    // Scroll selected option into view
    const sel = panel.querySelector('.ah-mpicker-option--selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function closePicker() {
    picker.classList.remove('ah-mpicker--open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function togglePicker() {
    picker.classList.contains('ah-mpicker--open') ? closePicker() : openPicker();
  }

  // --- Event: trigger click ---
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePicker();
  });

  // --- Event: option click ---
  options.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      selectByValue(opt.dataset.value, true);
      closePicker();
    });
    // Keyboard: Enter/Space to select
    opt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectByValue(opt.dataset.value, true);
        closePicker();
        trigger.focus();
      }
      if (e.key === 'Escape') { closePicker(); trigger.focus(); }
    });
  });

  // --- Event: click outside closes picker ---
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target)) closePicker();
  });

  // --- Keyboard: Escape on trigger ---
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openPicker();
      panel.querySelector('.ah-mpicker-option--selected, .ah-mpicker-option')?.focus();
    }
    if (e.key === 'Escape') closePicker();
  });

  // --- Watch hidden select for programmatic .value changes (PopupController restore) ---
  // PopupController does: copilotModelSelect.value = copilotModel
  // Since that doesn't fire 'change', we use a MutationObserver + polling trick
  // The cleanest approach: patch the hidden select's value property
  const hiddenProto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(hidden, 'value', {
    get() { return hiddenProto.get.call(this); },
    set(v) {
      hiddenProto.set.call(this, v);
      selectByValue(v, false); // update UI without re-firing change
    }
  });

  // --- Init: set initial state from hidden select ---
  selectByValue(hidden.value || 'claude-sonnet-4.6', false);
}

// Run after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initCopilotModelPicker();
});
