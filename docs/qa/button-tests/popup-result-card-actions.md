# Buttons: Result Card Actions (Save, Review Later, Override, Tutor, Similar, Feedback, Sources)

## Overview
Result card actions are bound via a single delegated click listener on `#results` div at `PopupController.setupEventListeners()` line 226. The handler `handleResultClick(event)` dispatches to sub-handlers based on the clicked element's class.

---

## Event Delegation Root
### Location
- **DOM Element**: `#results`
- **File**: `src/controllers/PopupController.js`
- **Line**: 226

### Event Binding
- **Event**: click (delegated)
- **Handler**: `handleResultClick(event)` (line 4546)
- **Bound at**: line 226 via `this.view.elements.resultsDiv?.addEventListener('click', ...)`

---

## Answer Override Trigger
### Selector: `.answer-override-trigger`
### Lines: 4548–4558

### Code Trace
Click → find `.answer-override-section` → toggle `.answer-override-pills` hidden state → toggle trigger `.active` class.

### Handler analysis
- ✅ Synchronous DOM toggle. Safe.

---

## Answer Override Cancel
### Selector: `.override-cancel`
### Lines: 4561–4568

### Code Trace
Click → hide pills panel → remove trigger `.active` class.

### Handler analysis
- ✅ Synchronous. Safe.

---

## Answer Override Pill Selection
### Selector: `.override-pill`
### Lines: 4572–4617

### Code Trace
Click → read `pill.dataset.letter` + `decodeURIComponent(pill.dataset.body)` → find parent `.qa-card` → update answer display (letter + text elements) → update answer header to "override" style → mark selected pill → hide pills panel → `_persistAnswerOverride(card, newLetter, newBody)`

### Handler analysis
- Null/undefined handling: ✅ `if (!newLetter) return`, `if (!card) return`. Checks for `letterEl && textEl` before updating.
- Try/catch for async: ✅ `_persistAnswerOverride()` has internal try/catch (line 4487).
- Promise handling: ✅ `_persistAnswerOverride()` is awaited.
- Variable dependencies: ✅

### `_persistAnswerOverride(card, newLetter, newBody)` (line 4487)
- Reads `lastSearchResults` from `chrome.storage.local`
- Finds card by index in resultsDiv
- Updates the cached result with new letter/body
- Wrapped in try/catch

---

## Sources Toggle
### Selector: `.sources-toggle`
### Lines: 4620–4630

### Code Trace
Click → toggle `.expanded` on `.sources-box` → toggle `.sources-list` hidden → update `aria-expanded`.

### Handler analysis
- ✅ Synchronous. Proper ARIA handling.

---

## Review Later Button
### Selector: `.btn-review-later`
### Lines: 4632–4676

### Code Trace
Click → decode `btn.dataset.content` (URI-encoded JSON) → `_buildLiveCardData()` → extract question/answer/sources → `StorageModel.getQuestionMeta()` → toggle review-later state → if not saved: `StorageModel.addItem()` with `reviewLater: true` → if already saved: `StorageModel.setReviewLater()` → update UI buttons → `_persistResultFlags()` → `BinderController.refreshSearchSaveStates()`

### Handler analysis
- Null/undefined handling: ✅ `if (!dataContent) return`, `if (!question) return`. `Array.isArray()` check on sources.
- Try/catch for async: ✅ Entire block wrapped in try/catch (lines 4637–4674).
- Promise handling: ✅ All storage operations awaited.
- Variable dependencies: ✅ `StorageModel` and `BinderController` available.

---

## Save Button
### Selector: `.save-btn`
### Lines: 4678–4696

### Code Trace
Click → decode `saveButton.dataset.content` → `_buildLiveCardData()` → `BinderController.toggleSaveItem(question, answer, source, saveButton, sources)` → update save/review-later button states → `_persistResultFlags(card, { saved, reviewLater })`

### Handler analysis
- Null/undefined handling: ✅ `if (!dataContent) return`.
- Try/catch for async: ⚠️ No try/catch wrapper. `JSON.parse(decodeURIComponent(dataContent))` could throw on malformed data.
- Promise handling: ✅ `toggleSaveItem()` and `_persistResultFlags()` are awaited.
- Variable dependencies: ✅

### Issues
- **S2 (Medium)**: The save button handler (lines 4678–4696) does NOT have a try/catch. If `JSON.parse()` throws (malformed `dataContent`), the error propagates as unhandled. The review-later handler (lines 4632–4676) does wrap in try/catch. This is inconsistent.

---

## Feedback Button (Report Extraction Error)
### Selector: `.feedback-btn`
### Lines: 4700–4718

### Code Trace
Click → dynamic import `CorrectionFeedback` → get active tab → parse `btn.dataset.content` → `CorrectionFeedback.recordCorrection()` → update button to "Registrado!" + disable.

### Handler analysis
- Null/undefined handling: ✅ `dataContent` conditional with ternary for parse.
- Try/catch for async: ✅ Wrapped in try/catch (lines 4701–4717).
- Promise handling: ✅ Dynamic import and `recordCorrection()` both awaited.
- Variable dependencies: ✅ Dynamic import handles module loading.

---

## Tutor Button (AI Explanation)
### Selector: `.btn-tutor`
### Lines: 4722–4764

### Code Trace
Click → find study output container → decode question/answer/context from `btn.dataset.*` → disable button + show spinner → dynamic import `ApiService` → `ApiService.generateTutorExplanation()` → format result with markdown→HTML conversion → render in container.

### Handler analysis
- Null/undefined handling: ✅ `if (!container) return`. `decodeURIComponent()` used on all dataset values.
- Try/catch for async: ✅ Wrapped in try/catch/finally (lines 4736–4763).
- Promise handling: ✅ Dynamic import and API call both awaited.
- Variable dependencies: ✅
- **Note**: Button is re-enabled in `finally` block — proper UX pattern.

---

## Similar Question Button (AI Generation)
### Selector: `.btn-similar`
### Lines: 4768–4812

### Code Trace
Click → find study output container → decode question → disable button + show spinner → dynamic import `ApiService` → `ApiService.generateSimilarQuestion()` → render question with options + collapsible answer.

### Handler analysis
- Null/undefined handling: ✅ `if (!container) return`. Checks `if (newQuestion && newQuestion.questionText)`.
- Try/catch for async: ✅ Wrapped in try/catch/finally (lines 4782–4811).
- Promise handling: ✅ Dynamic import and API call both awaited.
- Variable dependencies: ✅
- **Note**: `_escapeHtml()` used on all user-facing content — XSS safe.

---

## Contextual Dictionary (Text Selection)
### Location
- **File**: `src/controllers/PopupController.js`
- **Lines**: 323–375

### Event Binding
- **Event**: `mouseup` on `document`
- **Handler**: Inline async handler

### Code Trace
Mouse up → check if selection is within `.qa-card-question`, `.qa-card-answer`, etc. → if 1–5 words and < 50 chars → create tooltip → dynamic import `ApiService` → `ApiService.defineTerm(text, contextText)` → render definition in tooltip.

### Handler analysis
- Null/undefined handling: ✅ Guards: `if (e.target.closest('.dict-tooltip')) return`, length/word checks.
- Try/catch for async: ✅ Wrapped in try/catch (lines 335–372).
- Promise handling: ✅ Dynamic import and `defineTerm()` both awaited.
- Variable dependencies: ✅
- **Note**: Tooltip removed on error. `escapeHtml()` used on both term and definition.

---

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Save result — not saved | Adds to binder, button shows "saved" | [Unverified] — requires browser runtime |
| Save result — already saved | Removes from binder, button shows "unsaved" | [Unverified] — requires browser runtime |
| Review later — not saved | Saves to binder with reviewLater flag | [Unverified] — requires browser runtime |
| Review later — already saved | Toggles reviewLater flag | [Unverified] — requires browser runtime |
| Override answer — select pill | Updates displayed answer letter/text | [Unverified] — requires browser runtime |
| Override answer — cancel | Hides pills panel | [Unverified] — requires browser runtime |
| Sources toggle | Expands/collapses source list | [Unverified] — requires browser runtime |
| Feedback button | Records correction, disables button | [Unverified] — requires browser runtime |
| Tutor button | Shows AI explanation | [Unverified] — requires browser runtime |
| Similar question button | Generates and shows similar question | [Unverified] — requires browser runtime |
| Contextual dictionary — valid selection | Shows tooltip with definition | [Unverified] — requires browser runtime |
| Contextual dictionary — selection outside card | No tooltip shown | [Unverified] — requires browser runtime |
| Contextual dictionary — API error | Tooltip removed | [Unverified] — requires browser runtime |
| Save with malformed data-content | Error thrown (no try/catch) | [Unverified] — requires browser runtime |

## Status: ⚠️ — Mostly well-implemented, one missing try/catch on save handler.

## Issues Found
- **S2 (Medium)**: Save button handler (lines 4678–4696) lacks try/catch. `JSON.parse(decodeURIComponent(dataContent))` at line 4683 can throw on malformed data. Unlike the review-later handler which wraps the same pattern in try/catch, the save handler does not. If `dataContent` is corrupted or URL-encoding is broken, an unhandled exception occurs.
- **S3 (Low)**: The contextual dictionary tooltip positioning uses `rect.left + window.scrollX` which may place tooltips off-screen on narrow popups. No boundary clamping on the right edge.
