# Buttons: Binder (Clear, Add Manual, Disciplinas, Folder, Export/Import, Study)

## Overview
Binder buttons manage the question binder: clearing, adding manually, navigating folders, exporting/importing data, and study features. Most are bound via event delegation on the `#binder-list` container in `BinderController.bindEvents()`.

---

## Clear Binder Button
### Location
- **DOM Element**: `#clearBinderBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 208

### Event Binding
- **Event**: click
- **Handler**: `BinderController.handleClearAll()`
- **Bound at**: line 208

### Code Trace
UI click → `handleClearAll()` → `confirm()` dialog → `StorageModel.clearAll()` → `renderBinder()` → `view.resetAllSaveButtons()` → `refreshSearchSaveStates()`

### Handler analysis
- Null/undefined handling: ✅ Confirmation dialog guards destructive action.
- Try/catch for async: ⚠️ No try/catch. `StorageModel.clearAll()` could throw.
- Promise handling: ✅ All awaited.

---

## Add Question Button
### Location
- **DOM Element**: `#addQuestionBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 209

### Event Binding
- **Handler**: `BinderController.handleAddManual()`

### Code Trace
UI click → `handleAddManual()` → `_openManualAddModal()` → show `#manual-add-overlay` → populate folder/discipline dropdowns → bind modal buttons (once via `overlay.dataset.bound`) → focus question textarea.

### Modal Buttons (bound once inside `_openManualAddModal`):
- `#btnManageDisciplines` → `openDisciplinaManager()` (line 537)
- `#manualAddCloseBtn` → `_closeManualAddModal()` (line 538)
- `#manualAddCancelBtn` → `_closeManualAddModal()` (line 539)
- `#manualAddSaveBtn` → `_submitManualAdd()` (line 552)
- Overlay backdrop click → `_closeManualAddModal()` (line 540)
- Escape key → `_closeManualAddModal()` (line 556)
- Ctrl+Enter → `_submitManualAdd()` (line 557)

### `_submitManualAdd()` handler analysis (line 589)
- Null/undefined handling: ✅ Reads `?.value.trim()`, checks `if (!question || !answer)`.
- Try/catch for async: ✅ `StorageModel.addItem()` wrapped in try/catch/finally (lines 622–638).
- Promise handling: ✅ All awaited.
- Variable dependencies: ✅

---

## Disciplinas Manager Button
### Location
- **DOM Element**: `#btnDisciplinas`
- **File**: `src/controllers/PopupController.js`
- **Line**: 210

### Event Binding
- **Handler**: `BinderController.openDisciplinaManager()`

### Code Trace
UI click → `openDisciplinaManager()` → show `#disciplinas-overlay` → bind modal buttons (once) → `_renderDisciplineList()`.

### Modal Buttons:
- `#discModalCloseBtn` → close overlay (line 379)
- `#discAddBtn` → `_createDisciplineFromInput()` (line 382)
- `#disc-new-name` Enter key → `_createDisciplineFromInput()` (line 383)
- Backdrop click → close overlay (line 380)
- Delete buttons (`[data-disc-delete]`) → confirm + `StorageModel.deleteDiscipline()` (lines 436–444)
- Rename buttons (`[data-disc-rename]`) → prompt + `StorageModel.renameDiscipline()` (lines 445–455)

### Handler analysis
- Null/undefined handling: ✅ `overlay` null check. Input name validated.
- Try/catch for async: ⚠️ `_createDisciplineFromInput()`, delete, rename handlers have no try/catch.
- Promise handling: ✅ All awaited.

---

## Delegated Binder List Buttons (via `bindEvents()`)

All bound at `BinderController.bindEvents()` (line 91) via a single delegated click listener on `#binder-list`.

### Sources Toggle
- **Selector**: `.sources-toggle`
- **Line**: 96
- **Action**: Toggle `.expanded` class, show/hide `.sources-list`, update `aria-expanded`.
- ✅ Synchronous, safe.

### New Folder Button
- **Selector**: `#newFolderBtnBinder`
- **Line**: 109
- **Handler**: `handleCreateFolder()` → `prompt()` → `StorageModel.createFolder(name)` → `renderBinder()`
- ⚠️ No try/catch on `createFolder()`.

### Study Mode Toggle
- **Selector**: `#btnStudyMode`
- **Line**: 116
- **Action**: Toggles `this.isStudyMode` → `renderBinder()`
- ✅ Simple boolean toggle + re-render.

### Study Reveal Button
- **Selector**: `.study-reveal-btn`
- **Line**: 124
- **Action**: Hides button, reveals answer block by removing `.study-hidden` class.
- ✅ Synchronous, safe.

### Back to Root Button
- **Selector**: `#btnBackRoot`
- **Line**: 137
- **Handler**: `handleNavigateRoot()` → sets `StorageModel.currentFolderId = 'root'` → `renderBinder()`
- ✅ Synchronous.

### Open Study Page
- **Selector**: `#openStudyPageBtn`
- **Line**: 144
- **Handler**: `handleOpenStudyPage()` → collects all questions → `chrome.tabs.create({ url })`.
- Handler analysis: ✅ Checks `if (!questions.length)`, shows toast if empty.

### Export Button
- **Selector**: `#exportBinderBtn`
- **Line**: 151
- **Handler**: `handleExport()` → `StorageModel.data` → JSON.stringify → Blob → download link.
- Handler analysis:
  - Null/undefined handling: ✅ Checks `if (!data || data.length === 0)`.
  - Try/catch for async: ✅ Wrapped in try/catch (lines 679–709).
  - Promise handling: ✅ `_saveLastExportTimestamp()` awaited.

### Import Button
- **Selector**: `#importBinderBtn`
- **Line**: 158
- **Handler**: `handleImport()` → creates file input → reads JSON → validates → `confirm()` → `StorageModel.importData()` → `renderBinder()`.
- Handler analysis:
  - Null/undefined handling: ✅ File existence check, array validation.
  - Try/catch for async: ✅ Outer try/catch (lines 713–779) + inner try/catch for file processing (lines 730–771).
  - Promise handling: ✅ `file.text()` and `importData()` both awaited.
  - Cleanup: ✅ `window.addEventListener('focus', ...)` cleans up orphaned file input if user cancels.

### Dismiss Backup Reminder
- **Selector**: `.dismiss-reminder`
- **Line**: 165
- **Handler**: `_dismissBackupReminder()` → sets dismiss timestamp 7 days ahead → `renderBinder()`.
- ✅ Internal try/catch.

### Rename Button
- **Selector**: `.rename-btn`
- **Line**: 172
- **Handler**: `handleRename(id)` → `findNode(id)` → type check → prompt → `StorageModel.renameFolder()` → `renderBinder()`.
- ⚠️ No try/catch on `renameFolder()`.

### Delete Button
- **Selector**: `.delete-btn`
- **Line**: 179
- **Handler**: `handleDelete(id)` → `findNode(id)` → if folder with children → prompt with options (1=delete all, 2=keep children) → `StorageModel.deleteNode()` or `deleteFolderKeepChildren()` → `renderBinder()`.
- Handler analysis: ✅ Null check on `findNode()`. Handles folder vs item differently.
- ⚠️ No try/catch on storage operations.

### Copy Single Button
- **Selector**: `.copy-single-btn`
- **Line**: 186
- **Handler**: Inline — reads item content → `navigator.clipboard.writeText(text)`.
- Handler analysis:
  - ✅ Checks `if (item && item.content)`.
  - ✅ `clipboard.writeText().catch(...)` handles clipboard errors.

### Folder Navigation
- **Selector**: `.folder-item`
- **Line**: 199
- **Handler**: `handleNavigate(folderId)` → sets `StorageModel.currentFolderId` → `renderBinder()`.
- ✅ Simple.

### QA Item Expand
- **Selector**: `.qa-item.expandable`
- **Line**: 205
- **Action**: Toggle `.expanded` class, toggle `.full-view` display.
- ✅ Synchronous.

---

## Drag & Drop (Binder)
### Location
- **File**: `src/controllers/BinderController.js`
- **Lines**: 215–253

### Events: `dragstart`, `dragend`, `dragover`, `dragleave`, `drop`
### Handler: `handleMoveItem(itemId, targetFolderId)` → `StorageModel.moveItem()` → `renderBinder()`
- ✅ Guards: `if (itemId && targetId && itemId !== targetId)`.
- ⚠️ No try/catch on `handleMoveItem()`.

---

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Clear binder — confirm | Clears all data, re-renders | [Unverified] — requires browser runtime |
| Clear binder — cancel | No-op | [Unverified] — requires browser runtime |
| Add manual question — valid | Saves to binder, closes modal, toast | [Unverified] — requires browser runtime |
| Add manual question — empty fields | Shows error, stays open | [Unverified] — requires browser runtime |
| Add manual question — duplicate | Shows duplicate error | [Unverified] — requires browser runtime |
| Create discipline | Adds to list, repopulates select | [Unverified] — requires browser runtime |
| Delete discipline — confirm | Removes, re-renders | [Unverified] — requires browser runtime |
| Create folder | Prompts name, creates folder | [Unverified] — requires browser runtime |
| Navigate folder | Changes currentFolderId, re-renders | [Unverified] — requires browser runtime |
| Back to root | Resets to root folder | [Unverified] — requires browser runtime |
| Export binder — has data | Downloads JSON file | [Unverified] — requires browser runtime |
| Export binder — empty | Shows error toast | [Unverified] — requires browser runtime |
| Import binder — valid JSON | Replaces data after confirm | [Unverified] — requires browser runtime |
| Import binder — invalid JSON | Shows error toast | [Unverified] — requires browser runtime |
| Drag item to folder | Moves item, re-renders | [Unverified] — requires browser runtime |
| Study mode toggle | Toggles reveal behavior | [Unverified] — requires browser runtime |
| Open study page — has items | Opens study.html in new tab | [Unverified] — requires browser runtime |
| Open study page — empty | Shows toast | [Unverified] — requires browser runtime |

## Status: ⚠️ — Mostly solid, but several handlers lack try/catch.

## Issues Found
- **S3 (Low)**: Several async handlers in BinderController lack try/catch: `handleClearAll()` (line 317), `handleCreateFolder()` (line 258), `handleRename()` (line 276), `handleDelete()` (line 286), `handleMoveItem()` (line 326). If `StorageModel` methods throw, errors are unhandled.
- **S3 (Low)**: `_createDisciplineFromInput()` (line 390) and discipline delete/rename handlers (lines 436–455) have no try/catch.
