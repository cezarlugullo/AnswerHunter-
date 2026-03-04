# Button: Search (Find Answers)

## Location
- **Screen**: Popup — Main Search Tab
- **DOM Element**: `#searchBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 206

## Event Binding
- **Event**: click
- **Handler**: `handleSearch()`
- **Bound at**: line 206 via `this.view.elements.searchBtn?.addEventListener('click', ...)`

## Code Trace
UI click → `handleSearch()` → `ensureReadyOrShowSetup()` → `chrome.tabs.query()` → `chrome.scripting.executeScript(ExtractionService.extractQuestionOnlyScript)` → platform detection → viewport-centric extraction → question parsing/merging → `SearchService.searchAndRefine()` → `view.appendResults()` → `saveLastResults()`

1. **Guard**: `ensureReadyOrShowSetup()` checks provider readiness.
2. **Shows loading**: Disables searchBtn and copyBtn, clears results.
3. **Performance timer**: `PerformanceTimer.create('handleSearch()')`.
4. **Tab query + URL validation**: Same as Extract — blocks restricted pages.
5. **Multi-extraction pipeline**: Runs 3 parallel extraction strategies:
   - `extractQuestionOnlyScript` (all frames)
   - `PlatformExtractors.detectPlatformScript` + platform-specific extractor
   - `ExtractionService.extractViewportCentricScript`
6. **Question parsing**: Complex merging logic comparing extracted text quality, option counts, fingerprints.
7. **AI validation**: `ApiService.validateQuestion()` for validation.
8. **Search pipeline**: `SearchService.searchAndRefine()` for answer retrieval.
9. **Result rendering**: Decorated with saved/review-later metadata.

## Static Analysis

### Element exists and is rendered
✅ `#searchBtn` cached in `PopupView.cacheElements()` at line 134. Present in popup.html.

### Event binding confirmed
✅ Bound at line 206 with optional chaining.

### Handler analysis
- Null/undefined handling: ✅ Extensive null checks on `tab?.url`, `extractionResults`, `vpResult?.result`, `platformDetect?.result`. All optional chains used.
- Try/catch for async: ✅ Outer try/catch/finally wraps the entire handler. Inner try/catch blocks for platform detection (line 1956) and viewport extraction (line 1983).
- Promise handling: ✅ All promises are awaited. `PerformanceTimer` marks are placed after awaits.
- Variable dependencies: ✅ All imports resolved at module level. `PlatformExtractors` and `QuestionParser` are imported.

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Happy path — page with a question | Extracts, searches, shows answer card | [Unverified] — requires browser runtime |
| No question found on page | Shows "no question found" error | [Unverified] — requires browser runtime |
| Restricted page | Shows restricted page error | [Unverified] — requires browser runtime |
| Setup not ready | Opens setup panel | [Unverified] — requires browser runtime |
| Platform-specific page (e.g., Moodle) | Uses platform extractor for better accuracy | [Unverified] — requires browser runtime |
| Network error during search | Error caught, shows error status | [Unverified] — requires browser runtime |
| Double click | Button disabled during search | [Unverified] — requires browser runtime |

## Status: ✅ — Robust implementation with multi-strategy extraction and proper error handling.

## Issues Found
None — well-structured with nested try/catch blocks for each extraction phase.
