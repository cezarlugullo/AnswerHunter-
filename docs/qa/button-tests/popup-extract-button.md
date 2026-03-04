# Button: Extract Questions

## Location
- **Screen**: Popup — Main Search Tab
- **DOM Element**: `#extractBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 205

## Event Binding
- **Event**: click
- **Handler**: `handleExtract()`
- **Bound at**: line 205 via `this.view.elements.extractBtn?.addEventListener('click', ...)`

## Code Trace
UI click → `handleExtract()` → `ensureReadyOrShowSetup()` → `chrome.tabs.query()` → `chrome.scripting.executeScript(ExtractionService.extractQAContentScript)` → `SearchService.processExtractedItems()` → `_decorateWithSavedMeta()` → `view.appendResults()` → `saveLastResults()`

1. **Guard**: Calls `ensureReadyOrShowSetup()` which checks `SettingsModel.getProviderReadiness()`. If not ready, shows setup panel and returns.
2. **Shows loading**: `view.showStatus('loading', ...)`, disables extractBtn and copyBtn.
3. **Tab query**: `chrome.tabs.query({ active: true, currentWindow: true })` — gets the active tab.
4. **URL validation**: Blocks `chrome://`, `edge://`, `about:`, `chrome-extension://` URLs.
5. **Content script execution**: Injects `ExtractionService.extractQAContentScript` via `chrome.scripting.executeScript`.
6. **Empty check**: If no items extracted, shows error status.
7. **AI refinement**: Calls `SearchService.processExtractedItems(extractedItems)`.
8. **Binder decoration**: `_decorateWithSavedMeta(refined)` adds `saved` and `reviewLater` flags.
9. **Render**: `view.appendResults(withSaved)`, persists via `saveLastResults()`.
10. **Finally**: Re-enables extractBtn.

## Static Analysis

### Element exists and is rendered
✅ `#extractBtn` cached in `PopupView.cacheElements()` at line 133. Present in popup.html.

### Event binding confirmed
✅ Bound at line 205 with optional chaining (`?.addEventListener`). Safe if element is null.

### Handler analysis
- Null/undefined handling: ✅ Guards `tab?.url`, `results?.[0]?.result`, checks `extractedItems.length === 0`, checks `refined.length === 0`.
- Try/catch for async: ✅ Entire async body is wrapped in try/catch/finally at lines 1878–1924.
- Promise handling: ✅ All promises are properly awaited.
- Variable dependencies: ✅ `ExtractionService`, `SearchService`, `StorageModel` are imported at module level.

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Happy path — page with questions | Extracts and refines questions, shows results | [Unverified] — requires browser runtime |
| Restricted page (chrome://) | Shows "restricted page" error status | [Unverified] — requires browser runtime |
| No questions found on page | Shows "no question found" error status | [Unverified] — requires browser runtime |
| AI refinement returns empty | Shows "no valid question" error status | [Unverified] — requires browser runtime |
| Setup not ready | Opens setup panel, does not extract | [Unverified] — requires browser runtime |
| Double click (rapid) | Button disabled during extraction, re-enabled in finally | [Unverified] — requires browser runtime |
| Content script throws | Error caught, shows extractError message | [Unverified] — requires browser runtime |

## Status: ✅ — Code is well-structured with proper guards and error handling.

## Issues Found
None — handler follows best practices with try/catch/finally and button disabling.
