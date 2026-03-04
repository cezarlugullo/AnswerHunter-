# Button: Copy All Results

## Location
- **Screen**: Popup — Main Search Tab
- **DOM Element**: `#copyBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 207

## Event Binding
- **Event**: click
- **Handler**: `handleCopyAll()`
- **Bound at**: line 207 via `this.view.elements.copyBtn?.addEventListener('click', ...)`

## Code Trace
UI click → `handleCopyAll()` → `view.getAllResultsText()` → `navigator.clipboard.writeText(text)` → `view.showStatus('success', ...)`

1. **Get text**: Calls `this.view.getAllResultsText()` — retrieves formatted text from results div.
2. **Empty check**: If `!text`, returns immediately (no error shown).
3. **Clipboard write**: `navigator.clipboard.writeText(text)` — async, awaited.
4. **Success feedback**: `view.showStatus('success', t('status.copied'))`.
5. **Error handling**: Catch block logs warning and shows error status.

## Static Analysis

### Element exists and is rendered
✅ `#copyBtn` cached in `PopupView.cacheElements()` at line 135. Present in popup.html.

### Event binding confirmed
✅ Bound at line 207 with optional chaining.

### Handler analysis
- Null/undefined handling: ✅ Checks `if (!text) return` — handles empty/null results gracefully.
- Try/catch for async: ✅ Clipboard write is wrapped in try/catch (lines 4347–4353).
- Promise handling: ✅ `navigator.clipboard.writeText` is properly awaited.
- Variable dependencies: ✅ `view.getAllResultsText()` is a view method with no external deps.

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Happy path — results present | Copies text, shows "copied" status | [Unverified] — requires browser runtime |
| No results | Returns silently (no-op) | [Unverified] — requires browser runtime |
| Clipboard API blocked (permissions) | Shows error status | [Unverified] — requires browser runtime |
| Double click | No issue — no button disable, clipboard is idempotent | [Unverified] — requires browser runtime |

## Status: ✅ — Simple, well-implemented handler.

## Issues Found
- **S3 (Low)**: No user feedback when `!text` — could show a "no results to copy" toast. Silent no-op may confuse users.
