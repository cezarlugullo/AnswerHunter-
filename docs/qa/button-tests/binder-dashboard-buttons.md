Now I have all the source code. Let me compile the complete audit report.

---

# 🔍 COMPLETE STATIC CODE AUDIT — AnswerHunter Button & Interactive Element Report

## Legend
| Symbol | Meaning |
|--------|---------|
| ✅ | No issues found — safe |
| ⚠️ | Minor concern — functional but improvable |
| ❌ | Defect or significant risk |

---

## 1. BinderController (`src/controllers/BinderController.js`)

All buttons are handled through a **single delegated click handler** on `container` (line 95), using `e.target.closest(...)` delegation pattern. This is a good architectural choice for dynamically rendered content.

---

### 1.1 — Sources Toggle Button (`.sources-toggle`)

| Field | Detail |
|---|---|
| **Button** | `.sources-toggle` (delegated) |
| **File:Line** | `BinderController.js:96–107` |
| **Event** | `click` (delegated from container) |
| **Handler** | Inline in delegated handler |
| **Service calls** | None |
| **Storage/side effects** | DOM only — toggles `.expanded` class, sets `aria-expanded`, toggles `list.hidden` |
| **Expected result** | Expand/collapse sources list on a binder card |
| **Static analysis** | ✔ `e.stopPropagation()` prevents bubbling. ✔ Null-safe via optional chaining on `box?.querySelector`. ✔ `aria-expanded` set correctly. No async, no service calls — very safe. |
| **Status** | ✅ |

---

### 1.2 — New Folder Button (`#newFolderBtnBinder`)

| Field | Detail |
|---|---|
| **Button** | `#newFolderBtnBinder` (delegated) |
| **File:Line** | `BinderController.js:109–114` |
| **Event** | `click` (delegated) |
| **Handler** | `this.handleCreateFolder()` (line 256) |
| **Service calls** | `StorageModel.createFolder(name)` |
| **Storage/side effects** | Creates new folder in binder tree, calls `renderBinder()` |
| **Expected result** | Prompt user for folder name → create → re-render |
| **Static analysis** | ✔ `e.preventDefault()` present. ⚠️ `handleCreateFolder` (line 256–261) uses `prompt()` — if user enters empty string `""`, it's truthy and would create a folder with empty name. Only checks `if (name)`, not `if (name.trim())`. No try/catch around `StorageModel.createFolder`. No double-click guard. |
| **Status** | ⚠️ **Empty-name folder possible** — `prompt()` returns `""` which is falsy in JS, so actually safe. But whitespace-only name `" "` is truthy and would pass. Missing `.trim()` check. |

---

### 1.3 — Study Mode Toggle (`#btnStudyMode`)

| Field | Detail |
|---|---|
| **Button** | `#btnStudyMode` (delegated) |
| **File:Line** | `BinderController.js:116–122` |
| **Event** | `click` (delegated) |
| **Handler** | Inline — toggles `this.isStudyMode`, calls `this.renderBinder()` |
| **Service calls** | None |
| **Storage/side effects** | Toggles in-memory `isStudyMode` flag, re-renders binder |
| **Expected result** | Toggle study mode view (hides answers) |
| **Static analysis** | ✔ `e.preventDefault()` present. ✔ Synchronous toggle, no race condition. ✔ Clean. |
| **Status** | ✅ |

---

### 1.4 — Study Reveal Button (`.study-reveal-btn`)

| Field | Detail |
|---|---|
| **Button** | `.study-reveal-btn` (delegated) |
| **File:Line** | `BinderController.js:124–135` |
| **Event** | `click` (delegated) |
| **Handler** | Inline — hides button, shows answer block |
| **Service calls** | None |
| **Storage/side effects** | DOM only |
| **Expected result** | In study mode, reveals the answer for the current card |
| **Static analysis** | ✔ `e.preventDefault()` and `e.stopPropagation()`. ✔ Null-safe check on `answerBlock`. ✔ Uses `nextElementSibling` — fragile if HTML structure changes, but acceptable for tightly coupled view. |
| **Status** | ✅ |

---

### 1.5 — Back to Root (`#btnBackRoot`)

| Field | Detail |
|---|---|
| **Button** | `#btnBackRoot` (delegated) |
| **File:Line** | `BinderController.js:137–142` |
| **Event** | `click` (delegated) |
| **Handler** | `this.handleNavigateRoot()` (line 269) |
| **Service calls** | None |
| **Storage/side effects** | Sets `StorageModel.currentFolderId = 'root'`, re-renders |
| **Expected result** | Navigate back to root folder |
| **Static analysis** | ✔ Simple. ✔ `e.preventDefault()`. No issues. |
| **Status** | ✅ |

---

### 1.6 — Open Study Page (`#openStudyPageBtn`)

| Field | Detail |
|---|---|
| **Button** | `#openStudyPageBtn` (delegated) |
| **File:Line** | `BinderController.js:144–149` |
| **Event** | `click` (delegated) |
| **Handler** | `this.handleOpenStudyPage()` (line 657) |
| **Service calls** | `chrome.runtime.getURL()`, `chrome.tabs.create()` |
| **Storage/side effects** | Opens new tab |
| **Expected result** | Open study page for current binder questions |
| **Static analysis** | ✔ `e.preventDefault()`. ✔ Empty-check on questions (line 659). ⚠️ No try/catch around `chrome.tabs.create()` — if called outside extension context, will throw. No double-click guard — rapid clicks could open multiple tabs. |
| **Status** | ⚠️ **Multiple tabs on rapid click** |

---

### 1.7 — Export Binder (`#exportBinderBtn`)

| Field | Detail |
|---|---|
| **Button** | `#exportBinderBtn` (delegated) |
| **File:Line** | `BinderController.js:151–156` |
| **Event** | `click` (delegated) |
| **Handler** | `this.handleExport()` (line 667) |
| **Service calls** | `StorageModel.data`, `chrome.storage.local.set()` |
| **Storage/side effects** | Creates blob, triggers download, saves export timestamp |
| **Expected result** | Download JSON backup file |
| **Static analysis** | ✔ **Full try/catch** (line 668–698). ✔ Empty-data check (line 670). ✔ `URL.revokeObjectURL()` called — no memory leak. ✔ Saves export timestamp for backup reminder. ⚠️ No double-click guard — rapid clicks could trigger multiple downloads. |
| **Status** | ⚠️ **Minor: no double-click debounce** |

---

### 1.8 — Import Binder (`#importBinderBtn`)

| Field | Detail |
|---|---|
| **Button** | `#importBinderBtn` (delegated) |
| **File:Line** | `BinderController.js:158–163` |
| **Event** | `click` (delegated) → creates `<input type="file">` → `change` handler |
| **Handler** | `this.handleImport()` (line 701) |
| **Service calls** | `StorageModel.importData(data)` |
| **Storage/side effects** | Overwrites binder data from file, re-renders |
| **Expected result** | Import JSON file, replace binder data |
| **Static analysis** | ✔ **Excellent error handling** — outer try/catch (line 702), inner try/catch (line 719), finally cleanup (line 757). ✔ JSON.parse in try/catch with clear error (line 725–729). ✔ Validates structure (`Array.isArray`, non-empty) (line 736). ✔ Handles wrapped format (`data.binderStructure`) (line 732). ✔ `confirm()` before overwrite (line 744). ✔ File input cleanup on cancel via `window.focus` listener (line 713). ⚠️ Potential double-click: rapid clicks create multiple file inputs. ⚠️ `document.body.removeChild(input)` in finally could throw if already removed by `cleanupInput` — though unlikely since `change` fires before `focus` resolves. |
| **Status** | ⚠️ **Minor: cleanup race between focus listener and finally block (line 758 vs 711)** — could call `removeChild` twice. Should guard with `if (document.body.contains(input))` in finally too. |

---

### 1.9 — Dismiss Backup Reminder (`.dismiss-reminder`)

| Field | Detail |
|---|---|
| **Button** | `.dismiss-reminder` (delegated) |
| **File:Line** | `BinderController.js:165–170` |
| **Event** | `click` (delegated) |
| **Handler** | `this._dismissBackupReminder()` (line 83) |
| **Service calls** | `chrome.storage.local.set()` |
| **Storage/side effects** | Writes `_backupReminderDismissedUntil` (7 days from now), re-renders |
| **Expected result** | Hides backup reminder for 7 days |
| **Static analysis** | ✔ try/catch (line 84). ✔ Clean. |
| **Status** | ✅ |

---

### 1.10 — Rename Folder (`.rename-btn`)

| Field | Detail |
|---|---|
| **Button** | `.rename-btn[data-id]` (delegated) |
| **File:Line** | `BinderController.js:172–177` |
| **Event** | `click` (delegated) |
| **Handler** | `this.handleRename(id)` (line 274) |
| **Service calls** | `StorageModel.findNode()`, `StorageModel.renameFolder()` |
| **Storage/side effects** | Renames folder in storage, re-renders |
| **Expected result** | Prompt for new name → rename → re-render |
| **Static analysis** | ✔ `e.stopPropagation()`. ✔ Null/type check on node (line 276). ✔ Checks `newName.trim()` and that it differs from current (line 278). ✔ Only renames folders (type guard). ⚠️ No try/catch around `StorageModel.renameFolder`. |
| **Status** | ⚠️ **Minor: unhandled async rejection if StorageModel throws** |

---

### 1.11 — Delete Item (`.delete-btn`)

| Field | Detail |
|---|---|
| **Button** | `.delete-btn[data-id]` (delegated) |
| **File:Line** | `BinderController.js:179–184` |
| **Event** | `click` (delegated) |
| **Handler** | `this.handleDelete(id)` (line 284) |
| **Service calls** | `StorageModel.findNode()`, `StorageModel.deleteNode()`, `StorageModel.deleteFolderKeepChildren()` |
| **Storage/side effects** | Deletes node from binder tree, re-renders, refreshes search save states |
| **Expected result** | Confirm → delete → re-render |
| **Static analysis** | ✔ `e.stopPropagation()`. ✔ Null check on node (line 286). ✔ Smart UX for folders with children — offers "1" (delete all) or "2" (keep children) via `prompt()` (line 290). ✔ Calls `refreshSearchSaveStates()` after deletion. ⚠️ `prompt()` returns any string — typing "3" or "abc" silently does nothing (acceptable). ⚠️ No try/catch around storage calls. |
| **Status** | ⚠️ **Minor: no try/catch on async storage calls** |

---

### 1.12 — Copy Question (`.copy-single-btn`)

| Field | Detail |
|---|---|
| **Button** | `.copy-single-btn[data-id]` (delegated) |
| **File:Line** | `BinderController.js:186–195` |
| **Event** | `click` (delegated) |
| **Handler** | Inline |
| **Service calls** | `StorageModel.findNode()`, `navigator.clipboard.writeText()` |
| **Storage/side effects** | Copies Q&A text to clipboard |
| **Expected result** | Copy question+answer to clipboard |
| **Static analysis** | ✔ `e.stopPropagation()`. ✔ Null-check on item and content. ❌ **`navigator.clipboard.writeText()` returns a Promise but it's not awaited and has no `.catch()`** — if clipboard permission is denied, the error is silently swallowed (uncaught promise rejection). ⚠️ No user feedback (toast) on success or failure. |
| **Status** | ❌ **Unhandled promise rejection on clipboard write** |

---

### 1.13 — Navigate to Folder (`.folder-item`)

| Field | Detail |
|---|---|
| **Button** | `.folder-item[data-id]` (delegated) |
| **File:Line** | `BinderController.js:197–201` |
| **Event** | `click` (delegated) |
| **Handler** | `this.handleNavigate(folderId)` (line 264) |
| **Service calls** | None |
| **Storage/side effects** | Sets `StorageModel.currentFolderId`, re-renders |
| **Expected result** | Navigate into clicked folder |
| **Static analysis** | ✔ Clean, synchronous. ⚠️ No validation that `folderItem.dataset.id` exists (could be `undefined`). |
| **Status** | ✅ |

---

### 1.14 — Expand QA Item (`.qa-item.expandable`)

| Field | Detail |
|---|---|
| **Button** | `.qa-item.expandable` (delegated) |
| **File:Line** | `BinderController.js:203–210` |
| **Event** | `click` (delegated) |
| **Handler** | Inline |
| **Service calls** | None |
| **Storage/side effects** | DOM only — toggles `.expanded` class and `.full-view` display |
| **Expected result** | Expand/collapse a QA card to show full content |
| **Static analysis** | ✔ Null check on `fullView`. ⚠️ Uses inline `style.display` toggle — fragile against CSS changes, but acceptable. |
| **Status** | ✅ |

---

### 1.15 — Discipline Modal Close (`#discModalCloseBtn`)

| Field | Detail |
|---|---|
| **Button** | `#discModalCloseBtn` |
| **File:Line** | `BinderController.js:377` |
| **Event** | `click` (direct, bound once via `overlay.dataset.bound` guard) |
| **Handler** | Inline — `overlay.classList.add('hidden')` |
| **Service calls** | None |
| **Storage/side effects** | DOM only — hides overlay |
| **Expected result** | Close discipline manager modal |
| **Static analysis** | ✔ Optional chaining `?.addEventListener`. ✔ One-time binding via `dataset.bound` guard (line 375). |
| **Status** | ✅ |

---

### 1.16 — Discipline Modal Overlay Click

| Field | Detail |
|---|---|
| **Button** | Discipline overlay (click on backdrop) |
| **File:Line** | `BinderController.js:378` |
| **Event** | `click` |
| **Handler** | Inline — checks `e.target === overlay` |
| **Service calls** | None |
| **Storage/side effects** | DOM only |
| **Expected result** | Click outside modal closes it |
| **Static analysis** | ✔ Correct `e.target === overlay` check prevents closing on inner clicks. |
| **Status** | ✅ |

---

### 1.17 — Add Discipline Button (`#discAddBtn`)

| Field | Detail |
|---|---|
| **Button** | `#discAddBtn` |
| **File:Line** | `BinderController.js:380` |
| **Event** | `click` |
| **Handler** | `this._createDisciplineFromInput()` (line 388) |
| **Service calls** | `StorageModel.getDisciplines()`, `StorageModel.addDiscipline()` |
| **Storage/side effects** | Creates new discipline, clears input, re-renders list + select |
| **Expected result** | Create discipline from modal input |
| **Static analysis** | ✔ Empty-name check (line 391). ✔ Clears input after creation (line 396). ⚠️ No try/catch around storage calls. ⚠️ No duplicate-name check — user can create "Math" twice. ⚠️ No double-click guard — rapid clicks could create duplicates. |
| **Status** | ⚠️ **No duplicate discipline name prevention, no double-click guard** |

---

### 1.18 — Discipline Name Input Enter Key (`#disc-new-name`)

| Field | Detail |
|---|---|
| **Element** | `#disc-new-name` input |
| **File:Line** | `BinderController.js:381–383` |
| **Event** | `keydown` (Enter) |
| **Handler** | Same as 1.17 — `this._createDisciplineFromInput()` |
| **Static analysis** | Same issues as 1.17. |
| **Status** | ⚠️ |

---

### 1.19 — Discipline Delete (`[data-disc-delete]` in modal)

| Field | Detail |
|---|---|
| **Button** | `[data-disc-delete]` (in disc modal list) |
| **File:Line** | `BinderController.js:434–442` |
| **Event** | `click` (bound each render of `_renderDisciplineList`) |
| **Handler** | Inline async |
| **Service calls** | `StorageModel.deleteDiscipline()` |
| **Storage/side effects** | Deletes discipline, re-renders list + select |
| **Expected result** | Confirm → delete discipline |
| **Static analysis** | ✔ `confirm()` before deletion. ⚠️ **Event listener accumulation** — `_renderDisciplineList()` re-renders innerHTML then re-binds listeners. Since `innerHTML =` destroys previous elements, old listeners are GC'd. This is correct. ⚠️ Uses `btn.closest('div').querySelector('span[id]')?.textContent` for confirm message — fragile DOM traversal. |
| **Status** | ⚠️ **Minor: fragile DOM traversal for discipline name in confirm dialog** |

---

### 1.20 — Discipline Rename (`[data-disc-rename]` in modal)

| Field | Detail |
|---|---|
| **Button** | `[data-disc-rename]` (in disc modal list) |
| **File:Line** | `BinderController.js:443–453` |
| **Event** | `click` |
| **Handler** | Inline async |
| **Service calls** | `StorageModel.renameDiscipline()` |
| **Storage/side effects** | Renames discipline, re-renders |
| **Expected result** | Prompt → rename → re-render |
| **Static analysis** | ✔ Checks `newName?.trim()`. ⚠️ Allows renaming to same name (no `!== current` check, unlike folder rename at line 278). ⚠️ No try/catch. |
| **Status** | ⚠️ **Minor: allows no-op rename to same name (wastes storage write)** |

---

### 1.21 — Manual Add Modal Open (`handleAddManual`)

| Field | Detail |
|---|---|
| **Button** | External trigger calling `handleAddManual()` |
| **File:Line** | `BinderController.js:501–503` |
| **Event** | Called externally |
| **Handler** | `this._openManualAddModal()` (line 505) |
| **Service calls** | `StorageModel.getDisciplines()`, `StorageModel.currentFolderId` |
| **Storage/side effects** | Resets form, populates dropdowns, shows overlay |
| **Expected result** | Open manual add modal with clean form |
| **Static analysis** | ✔ Resets all form fields (lines 510–525). ✔ One-time event binding via `overlay.dataset.bound` (line 532). ✔ Good focus management — `setTimeout(() => qTA?.focus(), 60)` (line 560). |
| **Status** | ✅ |

---

### 1.22 — Manual Add Close (`#manualAddCloseBtn`)

| Field | Detail |
|---|---|
| **Button** | `#manualAddCloseBtn` |
| **File:Line** | `BinderController.js:536` |
| **Event** | `click` |
| **Handler** | `this._closeManualAddModal()` (line 563) |
| **Service calls** | None |
| **Storage/side effects** | Hides overlay |
| **Expected result** | Close manual add modal |
| **Static analysis** | ✔ Optional chaining. ✔ Clean. |
| **Status** | ✅ |

---

### 1.23 — Manual Add Cancel (`#manualAddCancelBtn`)

| Field | Detail |
|---|---|
| **Button** | `#manualAddCancelBtn` |
| **File:Line** | `BinderController.js:537` |
| **Event** | `click` |
| **Handler** | Same as 1.22 |
| **Static analysis** | Same. |
| **Status** | ✅ |

---

### 1.24 — Manual Add Overlay Backdrop Click

| Field | Detail |
|---|---|
| **Button** | `#manual-add-overlay` backdrop |
| **File:Line** | `BinderController.js:538` |
| **Event** | `click` |
| **Handler** | Checks `e.target === overlay` → close |
| **Static analysis** | ✔ Correct backdrop detection. |
| **Status** | ✅ |

---

### 1.25 — Manual Add Save (`#manualAddSaveBtn`)

| Field | Detail |
|---|---|
| **Button** | `#manualAddSaveBtn` |
| **File:Line** | `BinderController.js:550` |
| **Event** | `click` |
| **Handler** | `this._submitManualAdd()` (line 587) |
| **Service calls** | `StorageModel.addItem()` |
| **Storage/side effects** | Adds question to binder, closes modal, re-renders, shows toast |
| **Expected result** | Validate → save → close → toast |
| **Static analysis** | ✔ **Excellent validation** — checks `!question \|\| !answer` (line 600). ✔ **Loading state** — disables button, shows spinner (line 610–613). ✔ **Button re-enabled** after completion (line 624–627). ✔ Handles `added === false` (duplicate) with error message (line 629). ✔ Restores `currentFolderId` after folder switch (line 621). ✔ Keyboard shortcut `Ctrl+Enter` (line 555). ⚠️ No try/catch around `StorageModel.addItem()` — if it throws, button stays disabled forever (loading state set at 610 but restored at 624 only in non-throw path). |
| **Status** | ⚠️ **Button stuck in loading state if `StorageModel.addItem()` throws** — needs try/finally |

---

### 1.26 — Manual Add Escape Key

| Field | Detail |
|---|---|
| **Element** | `#manual-add-overlay` |
| **File:Line** | `BinderController.js:554` |
| **Event** | `keydown` (Escape) |
| **Handler** | `this._closeManualAddModal()` |
| **Static analysis** | ✔ Good UX. |
| **Status** | ✅ |

---

### 1.27 — Manage Disciplines (`#btnManageDisciplines`)

| Field | Detail |
|---|---|
| **Button** | `#btnManageDisciplines` |
| **File:Line** | `BinderController.js:535` |
| **Event** | `click` |
| **Handler** | `this.openDisciplinaManager()` (line 370) |
| **Service calls** | `StorageModel.getDisciplines()` |
| **Storage/side effects** | Opens discipline manager overlay |
| **Expected result** | Open discipline management modal |
| **Static analysis** | ✔ Null-safe. |
| **Status** | ✅ |

---

### 1.28 — New Discipline Input Enter Key in Manual Add (`#manual-new-discipline-input`)

| Field | Detail |
|---|---|
| **Element** | `#manual-new-discipline-input` |
| **File:Line** | `BinderController.js:482–496` |
| **Event** | `keydown` (Enter) |
| **Handler** | Inline async — creates discipline, re-populates select |
| **Service calls** | `StorageModel.getDisciplines()`, `StorageModel.addDiscipline()` |
| **Storage/side effects** | Creates discipline, updates dropdown, clears input |
| **Expected result** | Type new discipline name → Enter → create → select it |
| **Static analysis** | ✔ One-time binding via `newInput.dataset.bound` (line 480). ✔ Empty check (line 485). ⚠️ No try/catch on async storage calls. ⚠️ `disc.name` on line 491 — if `addDiscipline` returns `undefined`, accessing `.name` throws. |
| **Status** | ⚠️ **Possible null reference if `StorageModel.addDiscipline()` returns undefined** |

---

### 1.29 — Drag & Drop Events

| Field | Detail |
|---|---|
| **Events** | `dragstart`, `dragend`, `dragover`, `dragleave`, `drop` |
| **File:Line** | `BinderController.js:213–251` |
| **Handler** | `this.handleMoveItem(itemId, targetId)` (line 324) |
| **Service calls** | `StorageModel.moveItem()` |
| **Storage/side effects** | Moves binder item between folders |
| **Expected result** | Drag item to folder → move it |
| **Static analysis** | ✔ `itemId !== targetId` check (line 248). ✔ Cleanup on `dragend` (line 222–226). ✔ `e.preventDefault()` on `dragover` and `drop`. ⚠️ No try/catch on `handleMoveItem`. ⚠️ Allows dropping item into itself if hierarchy is nested (parent into child) — no cycle check visible here. |
| **Status** | ⚠️ **No cycle detection for nested folder moves (depends on StorageModel implementation)** |

---

## 2. DisciplinasController (`src/controllers/DisciplinasController.js`)

---

### 2.1 — Add Discipline Toggle (`#btnAddDiscNew`)

| Field | Detail |
|---|---|
| **Button** | `#btnAddDiscNew` |
| **File:Line** | `DisciplinasController.js:13` |
| **Event** | `click` |
| **Handler** | `this._toggleCreateForm(true)` (line 22) |
| **Service calls** | None |
| **Storage/side effects** | DOM only — shows form, focuses input |
| **Expected result** | Show inline create form and focus input |
| **Static analysis** | ✔ Optional chaining `?.addEventListener`. ✔ `input?.focus()`. |
| **Status** | ✅ |

---

### 2.2 — Cancel Create (`#disc-create-cancel`)

| Field | Detail |
|---|---|
| **Button** | `#disc-create-cancel` |
| **File:Line** | `DisciplinasController.js:14` |
| **Event** | `click` |
| **Handler** | `this._toggleCreateForm(false)` |
| **Service calls** | None |
| **Storage/side effects** | DOM only — hides form, clears input |
| **Expected result** | Hide create form, clear input |
| **Static analysis** | ✔ Clean. |
| **Status** | ✅ |

---

### 2.3 — Submit Create (`#disc-create-submit`)

| Field | Detail |
|---|---|
| **Button** | `#disc-create-submit` |
| **File:Line** | `DisciplinasController.js:15` |
| **Event** | `click` |
| **Handler** | `this._handleCreate()` (line 34) |
| **Service calls** | `StorageModel.getDisciplines()`, `StorageModel.addDiscipline()` |
| **Storage/side effects** | Creates discipline, hides form, re-renders list |
| **Expected result** | Validate → create → close form → re-render |
| **Static analysis** | ✔ Empty check `if (!name) return` (line 37). ✔ Calls `renderDisciplinas()` to refresh. ⚠️ No try/catch on async storage calls. ⚠️ No duplicate-name check. ⚠️ No double-click guard — rapid clicks can create duplicates before form closes. ⚠️ No loading state feedback. |
| **Status** | ⚠️ **No duplicate prevention, no double-click guard, no error handling** |

---

### 2.4 — Create Input Enter Key (`#disc-create-input`)

| Field | Detail |
|---|---|
| **Element** | `#disc-create-input` |
| **File:Line** | `DisciplinasController.js:16–19` |
| **Event** | `keydown` (Enter/Escape) |
| **Handler** | Enter → `_handleCreate()`, Escape → `_toggleCreateForm(false)` |
| **Static analysis** | Same issues as 2.3. ✔ Escape handling is good UX. |
| **Status** | ⚠️ |

---

### 2.5 — Empty State Add Button (`#discEmptyAddBtn`)

| Field | Detail |
|---|---|
| **Button** | `#discEmptyAddBtn` |
| **File:Line** | `DisciplinasController.js:89–94` |
| **Event** | `click` |
| **Handler** | `this._toggleCreateForm(true)` |
| **Service calls** | None |
| **Storage/side effects** | Shows create form |
| **Expected result** | Show create form from empty state |
| **Static analysis** | ✔ Optional chaining. ⚠️ This button is rendered via `innerHTML` (line 84–93) and bound immediately after (line 94). If `renderDisciplinas()` is called multiple times, old listeners are GC'd because innerHTML replaces elements — **correct**. |
| **Status** | ✅ |

---

### 2.6 — Study Button (`[data-disc-study]`)

| Field | Detail |
|---|---|
| **Button** | `[data-disc-study="<name>"]` |
| **File:Line** | `DisciplinasController.js:158–160` |
| **Event** | `click` (per-element) |
| **Handler** | `this._openStudy(btn.dataset.discStudy)` (line 209) |
| **Service calls** | `chrome.runtime.getURL()`, `chrome.tabs.create()` |
| **Storage/side effects** | Opens new tab |
| **Expected result** | Open study page for discipline |
| **Static analysis** | ✔ `encodeURIComponent` for URL param (line 210). ⚠️ No try/catch on `chrome.tabs.create()`. ⚠️ No double-click guard — rapid clicks open multiple tabs. ⚠️ Button has `disabled` attr when no questions (line 147), but no JS check — HTML `disabled` prevents clicks natively. ✔ Disabled attribute is correct. |
| **Status** | ⚠️ **No double-click guard, no try/catch** |

---

### 2.7 — Simulado Button (`[data-disc-sim]`)

| Field | Detail |
|---|---|
| **Button** | `[data-disc-sim="<name>"]` |
| **File:Line** | `DisciplinasController.js:161–163` |
| **Event** | `click` |
| **Handler** | `this._openSimulado(btn.dataset.discSim)` (line 214) |
| **Service calls** | `chrome.runtime.getURL()`, `chrome.tabs.create()` |
| **Storage/side effects** | Opens new tab with `mode=simulado` |
| **Expected result** | Open simulado page for discipline |
| **Static analysis** | Same issues as 2.6. ✔ `encodeURIComponent` used. |
| **Status** | ⚠️ **Same as 2.6** |

---

### 2.8 — Context Menu Toggle (`[data-disc-opts]`)

| Field | Detail |
|---|---|
| **Button** | `.disc-menu-btn[data-disc-opts]` |
| **File:Line** | `DisciplinasController.js:166–170` |
| **Event** | `click` |
| **Handler** | `this._toggleMenu(discId, container)` (line 201) |
| **Service calls** | None |
| **Storage/side effects** | DOM only — toggles dropdown visibility |
| **Expected result** | Show/hide context menu for explicit discipline |
| **Static analysis** | ✔ `e.stopPropagation()` prevents bubbling. ✔ `_toggleMenu` closes other menus before toggling (line 203–206). |
| **Status** | ✅ |

---

### 2.9 — Context Menu Rename (`[data-disc-rename]`)

| Field | Detail |
|---|---|
| **Button** | `[data-disc-rename]` (in card context menu) |
| **File:Line** | `DisciplinasController.js:172–181` |
| **Event** | `click` |
| **Handler** | Inline async |
| **Service calls** | `StorageModel.getDisciplines()`, `StorageModel.renameDiscipline()` |
| **Storage/side effects** | Renames discipline, re-renders |
| **Expected result** | Prompt → rename → re-render |
| **Static analysis** | ✔ Checks `newName?.trim()` and `!== disc?.name`. ⚠️ No try/catch. ⚠️ If `list.find()` returns `undefined` (race condition — discipline deleted between render and click), `disc?.name` is `undefined`, and `prompt('Novo nome:', undefined)` shows "undefined" as default value. |
| **Status** | ⚠️ **Race condition: disc could be deleted between render and rename click** |

---

### 2.10 — Context Menu Delete (`[data-disc-delete]`)

| Field | Detail |
|---|---|
| **Button** | `[data-disc-delete]` (in card context menu) |
| **File:Line** | `DisciplinasController.js:183–191` |
| **Event** | `click` |
| **Handler** | Inline async |
| **Service calls** | `StorageModel.getDisciplines()`, `StorageModel.deleteDiscipline()` |
| **Storage/side effects** | Deletes discipline, re-renders |
| **Expected result** | Confirm → delete → re-render |
| **Static analysis** | ✔ `confirm()` before deletion. ⚠️ Same race condition as 2.9 — `disc?.name` could be `undefined`, showing `"Excluir a disciplina "undefined"?"`. ⚠️ No try/catch. |
| **Status** | ⚠️ **Race condition in confirm message** |

---

### 2.11 — Document Click (Close All Menus)

| Field | Detail |
|---|---|
| **Element** | `document` |
| **File:Line** | `DisciplinasController.js:194–198` |
| **Event** | `click` (one-time, delayed via `setTimeout`) |
| **Handler** | Closes all `.disc-menu-dropdown` menus |
| **Static analysis** | ❌ **BUG: `{ once: true }` is passed as the third argument to `addEventListener`** (line 197), which means this close handler fires **only once** and is never re-registered. After the first click anywhere on the document, subsequent menu openings will never auto-close when clicking outside. The `setTimeout(..., 0)` delays registration to avoid catching the current click, but `once: true` means it permanently stops working after first use. **This should be a persistent listener, or re-registered on every `renderDisciplinas` call.** |
| **Status** | ❌ **BUG: Menus won't auto-close after first outside click** |

---

## 3. Dashboard V2 (`src/dashboard/dashboard-v2.js` + `dashboard-v2.html`)

---

### 3.1 — Theme Toggle (`#btnThemeToggle`)

| Field | Detail |
|---|---|
| **Button** | `#btnThemeToggle` |
| **File:Line** | `dashboard-v2.js:548–553` / `dashboard-v2.html:285–287` |
| **Event** | `click` |
| **Handler** | Inline — toggles between `''` and `'dark'` |
| **Service calls** | `chrome.storage.local.set()` |
| **Storage/side effects** | Saves `ah_theme` to storage, updates `data-theme` attribute |
| **Expected result** | Toggle light/dark theme |
| **Static analysis** | ✔ DEMO guard (`if (!DEMO)`). ✔ Clean toggle logic. ⚠️ No try/catch on `chrome.storage.local.set()` — acceptable since it's fire-and-forget. |
| **Status** | ✅ |

---

### 3.2 — Light Theme (`#btnLightTheme`)

| Field | Detail |
|---|---|
| **Button** | `#btnLightTheme` |
| **File:Line** | `dashboard-v2.js:556–558` / `dashboard-v2.html:455` |
| **Event** | `click` |
| **Handler** | Sets `data-theme` to `''`, saves `ah_theme: ''` |
| **Service calls** | `chrome.storage.local.set()` |
| **Expected result** | Force light theme |
| **Static analysis** | ✔ Clean. ⚠️ No active-state visual feedback on which theme button is selected. |
| **Status** | ✅ |

---

### 3.3 — Dark Theme (`#btnDarkTheme`)

| Field | Detail |
|---|---|
| **Button** | `#btnDarkTheme` |
| **File:Line** | `dashboard-v2.js:560–562` / `dashboard-v2.html:456` |
| **Event** | `click` |
| **Handler** | Sets `data-theme` to `'dark'` |
| **Static analysis** | ✔ Same pattern as 3.2. |
| **Status** | ✅ |

---

### 3.4 — Auto Theme (`#btnAutoTheme`)

| Field | Detail |
|---|---|
| **Button** | `#btnAutoTheme` |
| **File:Line** | `dashboard-v2.js:564–567` / `dashboard-v2.html:457` |
| **Event** | `click` |
| **Handler** | Removes `data-theme` attribute, saves `ah_theme: 'auto'` |
| **Static analysis** | ✔ Clean. ⚠️ Initial theme load (line 107–110) handles `''` and `'auto'` differently but stores them as different values. On load, `theme === ''` sets attribute to empty string, while `'auto'` falls through (no attribute set). Both produce same visual effect but the empty-string storage path (`theme === ''`) sets `data-theme=""` which may or may not match CSS selectors expecting no attribute. **Inconsistency between Light theme save (`''`) and load behavior.** |
| **Status** | ⚠️ **Inconsistency: Light saves `ah_theme: ''`, which on reload sets `data-theme=""` (via line 109). Auto saves `ah_theme: 'auto'`, which on reload removes attribute (falls through). Both produce "light" visually, but `data-theme=""` vs no attribute could differ if CSS targets `[data-theme=""]`.** |

---

### 3.5 — Settings Navigation (`#btnSettings`)

| Field | Detail |
|---|---|
| **Button** | `#btnSettings` |
| **File:Line** | `dashboard-v2.js:570` / `dashboard-v2.html:288–290` |
| **Event** | `click` |
| **Handler** | `navigateTo('settings')` (line 196) |
| **Service calls** | None |
| **Storage/side effects** | DOM only — page navigation |
| **Expected result** | Navigate to settings page |
| **Static analysis** | ✔ Clean. |
| **Status** | ✅ |

---

### 3.6 — New Discipline (Overview) (`#btnNewDisc`)

| Field | Detail |
|---|---|
| **Button** | `#btnNewDisc` |
| **File:Line** | `dashboard-v2.js:573` / `dashboard-v2.html:317–320` |
| **Event** | `click` |
| **Handler** | `promptNewDiscipline()` (line 665) |
| **Service calls** | `ContentHierarchyService.createDiscipline()` |
| **Storage/side effects** | Creates discipline, re-renders grid, shows toast |
| **Expected result** | Prompt → create → re-render → toast |
| **Static analysis** | ✔ Empty check `if (!name \|\| !name.trim())` (line 667). ✔ DEMO mode handling (line 669–678). ⚠️ `.then()` without `.catch()` (line 681) — if `ContentHierarchyService.createDiscipline` rejects, **unhandled promise rejection**. ⚠️ No double-click guard on `prompt()` — though `prompt()` is blocking, so this is inherently safe. |
| **Status** | ⚠️ **Missing `.catch()` on `ContentHierarchyService.createDiscipline().then()` (line 681)** |

---

### 3.7 — New Discipline (All) (`#btnNewDiscAll`)

| Field | Detail |
|---|---|
| **Button** | `#btnNewDiscAll` |
| **File:Line** | `dashboard-v2.js:574` / `dashboard-v2.html:368–371` |
| **Event** | `click` |
| **Handler** | Same `promptNewDiscipline()` |
| **Static analysis** | Same as 3.6. |
| **Status** | ⚠️ |

---

### 3.8 — Study All (`#btnStudyAll`)

| Field | Detail |
|---|---|
| **Button** | `#btnStudyAll` |
| **File:Line** | `dashboard-v2.js:577–581` / `dashboard-v2.html:330–333` |
| **Event** | `click` |
| **Handler** | Inline — opens study.html in new tab |
| **Service calls** | `chrome.runtime.getURL()`, `chrome.tabs.create()` |
| **Storage/side effects** | Opens new tab |
| **Expected result** | Open study page with all cards |
| **Static analysis** | ✔ DEMO guard. ⚠️ No try/catch. ⚠️ No double-click guard — rapid clicks open multiple tabs. ⚠️ Doesn't check if any cards exist before opening. |
| **Status** | ⚠️ **Opens empty study page if no cards; multiple tabs on rapid click** |

---

### 3.9 — Migrate (`#btnMigrate`)

| Field | Detail |
|---|---|
| **Button** | `#btnMigrate` |
| **File:Line** | `dashboard-v2.js:584–597` / `dashboard-v2.html:446–449` |
| **Event** | `click` |
| **Handler** | Inline async |
| **Service calls** | `MigrationService.migrate()` |
| **Storage/side effects** | Migrates v1→v2 data, reloads page |
| **Expected result** | Migrate data, show toast, reload |
| **Static analysis** | ✔ DEMO guard with early return + toast (line 585–588). ✔ Progress toast before start (line 589). ✔ Success/error handling (line 591–596). ⚠️ **No try/catch** — if `MigrationService.migrate()` throws (not just returns `{success:false}`), **unhandled rejection**. ⚠️ No double-click guard — user could click multiple times during migration. ⚠️ `result.stats.totalQuestions || 0` (line 592) — if `result.stats` is `undefined`, accessing `.totalQuestions` throws. |
| **Status** | ⚠️ **No try/catch; possible null reference on `result.stats`** |

---

### 3.10 — Export Data (`#btnExportData`)

| Field | Detail |
|---|---|
| **Button** | `#btnExportData` |
| **File:Line** | `dashboard-v2.js:600–608` / `dashboard-v2.html:437–440` |
| **Event** | `click` |
| **Handler** | Inline async |
| **Service calls** | `ExportService.downloadBackup()` |
| **Storage/side effects** | Downloads backup file |
| **Expected result** | Download JSON backup |
| **Static analysis** | ✔ DEMO guard. ✔ **try/catch with error toast** (line 602–607). ✔ Success toast. |
| **Status** | ✅ |

---

### 3.11 — Import Data (`#btnImportData`)

| Field | Detail |
|---|---|
| **Button** | `#btnImportData` |
| **File:Line** | `dashboard-v2.js:611–613` / `dashboard-v2.html:441–444` |
| **Event** | `click` |
| **Handler** | Triggers `importFileInput.click()` |
| **Service calls** | None (delegates to file input) |
| **Storage/side effects** | None directly |
| **Expected result** | Open file picker |
| **Static analysis** | ✔ Optional chaining. |
| **Status** | ✅ |

---

### 3.12 — Import File Input (`#importFileInput`)

| Field | Detail |
|---|---|
| **Element** | `#importFileInput` (`<input type="file">`) |
| **File:Line** | `dashboard-v2.js:614–629` / `dashboard-v2.html:445` |
| **Event** | `change` |
| **Handler** | Inline async |
| **Service calls** | `ExportService.readFile()`, `ExportService.importFullJSON()` |
| **Storage/side effects** | Imports data, reloads page |
| **Expected result** | Read file → import → reload |
| **Static analysis** | ✔ **try/catch** (line 617–628). ✔ Null check on file (line 616). ✔ Success toast + delayed reload (line 621–622). ✔ Error toast with message (line 627). ⚠️ **File input not reset** after import — selecting the same file again won't trigger `change` event. Should add `e.target.value = ''` in finally. |
| **Status** | ⚠️ **File input not reset — re-importing same file won't trigger change event** |

---

### 3.13 — Export CSV (`#btnExportCSV`)

| Field | Detail |
|---|---|
| **Button** | `#btnExportCSV` |
| **File:Line** | `dashboard-v2.js:632–636` / `dashboard-v2.html:409–411` |
| **Event** | `click` |
| **Handler** | Inline |
| **Service calls** | `ExportService.downloadCSV(hierarchyData)` |
| **Storage/side effects** | Downloads CSV file |
| **Expected result** | Download CSV export |
| **Static analysis** | ✔ DEMO guard. ❌ **No try/catch** — `ExportService.downloadCSV` could throw. ❌ **Toast shown BEFORE confirming success** — `showToast` is called after `downloadCSV` (line 635), but since `downloadCSV` is not awaited (no async), if it's synchronous and throws, the toast won't execute. If it's async, the toast fires immediately regardless of outcome. |
| **Status** | ⚠️ **No error handling; toast assumes success** |

---

### 3.14 — Export Anki (`#btnExportAnki`)

| Field | Detail |
|---|---|
| **Button** | `#btnExportAnki` |
| **File:Line** | `dashboard-v2.js:637–641` / `dashboard-v2.html:412–414` |
| **Event** | `click` |
| **Handler** | Same pattern as 3.13 |
| **Service calls** | `ExportService.downloadAnki(hierarchyData)` |
| **Static analysis** | Same issues as 3.13. |
| **Status** | ⚠️ |

---

### 3.15 — Export JSON (Analytics) (`#btnExportJSON`)

| Field | Detail |
|---|---|
| **Button** | `#btnExportJSON` |
| **File:Line** | `dashboard-v2.js:642–646` / `dashboard-v2.html:415–417` |
| **Event** | `click` |
| **Handler** | Inline async |
| **Service calls** | `ExportService.downloadBackup()` |
| **Storage/side effects** | Downloads backup |
| **Expected result** | Download JSON backup from analytics page |
| **Static analysis** | ✔ DEMO guard. ⚠️ **No try/catch** unlike `btnExportData` (3.10) which has identical functionality WITH try/catch. **Inconsistency.** |
| **Status** | ⚠️ **Missing try/catch — inconsistent with identical btnExportData handler** |

---

### 3.16 — Per-Discipline Card Click

| Field | Detail |
|---|---|
| **Element** | `DisciplineCard` component (created by `ComponentLibrary`) |
| **File:Line** | `dashboard-v2.js:315–318` (overview), `527–530` (all disciplines) |
| **Event** | `click` (bound inside `DisciplineCard` component) |
| **Handler** | `openDisciplineDetail(discId)` (line 688) |
| **Service calls** | `chrome.runtime.getURL()`, `chrome.tabs.create()` |
| **Storage/side effects** | Opens discipline detail page in new tab |
| **Expected result** | Open discipline detail page |
| **Static analysis** | ✔ DEMO guard with toast (line 690–693). ✔ `encodeURIComponent` not needed since IDs are generated internally. ⚠️ No try/catch on `chrome.tabs.create`. |
| **Status** | ✅ |

---

### 3.17 — Search Bar (Overview)

| Field | Detail |
|---|---|
| **Element** | `SearchBar` component mounted at `#searchBarMount` |
| **File:Line** | `dashboard-v2.js:649–661` |
| **Event** | `onSearch` callback |
| **Handler** | Navigates to disciplines page, shows toast |
| **Service calls** | None |
| **Storage/side effects** | Page navigation |
| **Expected result** | Navigate + search (TODO: implement) |
| **Static analysis** | ⚠️ **TODO on line 657** — `// TODO: implement global search result page`. Currently just navigates to disciplines page and shows a toast, doesn't actually search. |
| **Status** | ⚠️ **Incomplete implementation (search does nothing useful)** |

---

### 3.18 — Embedded Mode FAB (Open in New Tab)

| Field | Detail |
|---|---|
| **Element** | Dynamically created `<a>` element |
| **File:Line** | `dashboard-v2.js:146–163` |
| **Event** | `mouseenter`, `mouseleave` (hover effects) |
| **Handler** | CSS transform animation |
| **Service calls** | `chrome.runtime.getURL()` |
| **Storage/side effects** | Opens dashboard in new tab (native `<a>` link behavior) |
| **Expected result** | Floating action button to open full dashboard |
| **Static analysis** | ✔ Uses native `<a>` with `target="_blank"` — no JS click handler needed. ✔ Hover animations are clean. |
| **Status** | ✅ |

---

## 4. Discipline Detail (`src/dashboard/discipline-detail.html`)

---

### 4.1 — Study Button (`#btnStudy`)

| Field | Detail |
|---|---|
| **Button** | `#btnStudy` |
| **File:Line** | `discipline-detail.html:275–278` |
| **Event** | `click` |
| **Handler** | Inline — opens study page in new tab |
| **Service calls** | `chrome.runtime.getURL()`, `chrome.tabs.create()` |
| **Storage/side effects** | Opens new tab |
| **Expected result** | Open study page for this discipline |
| **Static analysis** | ✔ Optional chaining `?.addEventListener`. ✔ `encodeURIComponent` used. ⚠️ No try/catch. ⚠️ No check for empty cards before opening study. ⚠️ No double-click guard. |
| **Status** | ⚠️ **No error handling, no double-click guard** |

---

### 4.2 — New Module Button (`#btnNewModule`)

| Field | Detail |
|---|---|
| **Button** | `#btnNewModule` |
| **File:Line** | `discipline-detail.html:280` |
| **Event** | `click` |
| **Handler** | `createModule()` (line 301) |
| **Service calls** | `ContentHierarchyService.createModule()` |
| **Storage/side effects** | Creates module, pushes to local `discipline.modules`, re-renders, shows toast |
| **Expected result** | Prompt → create module → re-render |
| **Static analysis** | ✔ Empty check `if (!name \|\| !name.trim())` (line 303). ✔ Checks `if (mod)` before using result (line 305). ✔ Shows success toast. ⚠️ No try/catch around `ContentHierarchyService.createModule()`. ⚠️ No double-click guard. |
| **Status** | ⚠️ **No try/catch** |

---

### 4.3 — Edit Discipline (`#btnEdit`)

| Field | Detail |
|---|---|
| **Button** | `#btnEdit` |
| **File:Line** | `discipline-detail.html:282–289` |
| **Event** | `click` |
| **Handler** | Inline async |
| **Service calls** | `ContentHierarchyService.updateDiscipline()` |
| **Storage/side effects** | Renames discipline, updates local state, re-renders header + breadcrumb, shows toast |
| **Expected result** | Prompt → rename → re-render → toast |
| **Static analysis** | ✔ Checks `newName && newName.trim()` (line 284). ✔ Updates local `discipline.name` for immediate UI update without re-fetch. ⚠️ No try/catch — if `updateDiscipline` fails, local state is still updated (line 286) but storage isn't. **Desync risk.** ⚠️ Doesn't check `newName !== discipline.name` — allows no-op rename. |
| **Status** | ⚠️ **No try/catch — local state desync risk on storage failure** |

---

### 4.4 — Delete Discipline (`#btnDelete`)

| Field | Detail |
|---|---|
| **Button** | `#btnDelete` |
| **File:Line** | `discipline-detail.html:293–298` |
| **Event** | `click` |
| **Handler** | Inline async |
| **Service calls** | `ContentHierarchyService.deleteDiscipline()` |
| **Storage/side effects** | Deletes discipline + all cards, navigates to dashboard |
| **Expected result** | Confirm → delete → toast → navigate |
| **Static analysis** | ✔ `confirm()` with clear message (line 294). ✔ Toast before navigation (line 296). ✔ `goToDashboard()` navigates away. ⚠️ No try/catch — if `deleteDiscipline` throws, user sees nothing and stays on broken page. ⚠️ **Destructive action** — confirm message mentions "todos os seus cards" which is good. |
| **Status** | ⚠️ **No try/catch on destructive operation** |

---

### 4.5 — Breadcrumb Links

| Field | Detail |
|---|---|
| **Element** | `Breadcrumb` component items |
| **File:Line** | `discipline-detail.html:194–198` |
| **Event** | `onClick` callbacks |
| **Handler** | `goToDashboard()` (line 313) |
| **Service calls** | `chrome.runtime.getURL()` |
| **Storage/side effects** | Page navigation |
| **Expected result** | Navigate back to dashboard |
| **Static analysis** | ✔ Both "Dashboard" and "Disciplinas" crumbs go to same page — correct for current architecture. |
| **Status** | ✅ |

---

### 4.6 — Empty State "Criar Módulo" Button

| Field | Detail |
|---|---|
| **Element** | `EmptyState` action button |
| **File:Line** | `discipline-detail.html:256–262` |
| **Event** | `onClick` callback |
| **Handler** | `createModule()` |
| **Static analysis** | Same as 4.2. |
| **Status** | ⚠️ |

---

### 4.7 — Module Topic Click

| Field | Detail |
|---|---|
| **Element** | `ModuleAccordion` topic items |
| **File:Line** | `discipline-detail.html:266–270` |
| **Event** | `onTopicClick` callback |
| **Handler** | Shows info toast with topic ID |
| **Static analysis** | ⚠️ **Incomplete implementation** — just shows a toast `"Tópico selecionado (ID: ...)"`. No actual topic detail navigation. Placeholder code. |
| **Status** | ⚠️ **Stub/placeholder — not implemented** |

---

## 5. Content Script (`src/content/content.js`)

---

### 5.1 — Message Listener (highlight action)

| Field | Detail |
|---|---|
| **Element** | `chrome.runtime.onMessage` listener |
| **File:Line** | `content.js:8–16` |
| **Event** | `onMessage` (Chrome runtime) |
| **Handler** | `highlightAnswers()` |
| **Service calls** | None |
| **Storage/side effects** | Adds/removes CSS classes on page DOM elements |
| **Expected result** | Highlight answer elements on page |
| **Static analysis** | ✔ `return true` for async sendResponse compatibility. ✔ Guards with `runtime?.onMessage?.addListener`. ✔ `sendResponse({ success: true })`. ⚠️ No error handling — if `highlightAnswers()` throws, `sendResponse` still returns `{ success: true }`. |
| **Status** | ⚠️ **Always returns success even if highlighting fails** |

---

### 5.2 — No Click Handlers / Injected UI

| Field | Detail |
|---|---|
| **Analysis** | Content script does NOT inject any UI elements or click handlers. It only adds CSS classes to existing elements. |
| **Status** | ✅ **No interactive elements — clean content script** |

---

## 📊 SUMMARY MATRIX

| # | Component | Button/Action | Status | Primary Issue |
|---|-----------|---------------|--------|---------------|
| 1.1 | Binder | Sources Toggle | ✅ | — |
| 1.2 | Binder | New Folder | ⚠️ | Whitespace-only name accepted |
| 1.3 | Binder | Study Mode Toggle | ✅ | — |
| 1.4 | Binder | Study Reveal | ✅ | — |
| 1.5 | Binder | Back to Root | ✅ | — |
| 1.6 | Binder | Open Study Page | ⚠️ | Multiple tabs on rapid click |
| 1.7 | Binder | Export | ⚠️ | No double-click debounce |
| 1.8 | Binder | Import | ⚠️ | Cleanup race condition |
| 1.9 | Binder | Dismiss Reminder | ✅ | — |
| 1.10 | Binder | Rename Folder | ⚠️ | No try/catch on async |
| 1.11 | Binder | Delete Item | ⚠️ | No try/catch on async |
| 1.12 | Binder | Copy Question | ❌ | **Unhandled clipboard promise rejection** |
| 1.13 | Binder | Navigate Folder | ✅ | — |
| 1.14 | Binder | Expand QA Item | ✅ | — |
| 1.15 | Binder | Disc Modal Close | ✅ | — |
| 1.16 | Binder | Disc Modal Overlay | ✅ | — |
| 1.17 | Binder | Add Discipline | ⚠️ | No duplicate check, no double-click |
| 1.18 | Binder | Disc Input Enter | ⚠️ | Same as 1.17 |
| 1.19 | Binder | Disc Delete (modal) | ⚠️ | Fragile DOM traversal |
| 1.20 | Binder | Disc Rename (modal) | ⚠️ | Allows no-op rename |
| 1.21 | Binder | Manual Add Open | ✅ | — |
| 1.22 | Binder | Manual Add Close | ✅ | — |
| 1.23 | Binder | Manual Add Cancel | ✅ | — |
| 1.24 | Binder | Manual Add Overlay | ✅ | — |
| 1.25 | Binder | Manual Add Save | ⚠️ | **Button stuck on throw** (no try/finally) |
| 1.26 | Binder | Manual Add Escape | ✅ | — |
| 1.27 | Binder | Manage Disciplines | ✅ | — |
| 1.28 | Binder | New Disc Input Enter | ⚠️ | Possible null ref on `.name` |
| 1.29 | Binder | Drag & Drop | ⚠️ | No cycle detection |
| 2.1 | Disciplinas | Add Disc Toggle | ✅ | — |
| 2.2 | Disciplinas | Cancel Create | ✅ | — |
| 2.3 | Disciplinas | Submit Create | ⚠️ | No duplicate/double-click/error |
| 2.4 | Disciplinas | Input Enter/Escape | ⚠️ | Same as 2.3 |
| 2.5 | Disciplinas | Empty Add Btn | ✅ | — |
| 2.6 | Disciplinas | Study Button | ⚠️ | No double-click guard |
| 2.7 | Disciplinas | Simulado Button | ⚠️ | No double-click guard |
| 2.8 | Disciplinas | Context Menu Toggle | ✅ | — |
| 2.9 | Disciplinas | Context Rename | ⚠️ | Race condition |
| 2.10 | Disciplinas | Context Delete | ⚠️ | Race condition |
| 2.11 | Disciplinas | Document Click Close | ❌ | **BUG: `{once:true}` breaks menu closing** |
| 3.1 | Dashboard | Theme Toggle | ✅ | — |
| 3.2 | Dashboard | Light Theme | ✅ | — |
| 3.3 | Dashboard | Dark Theme | ✅ | — |
| 3.4 | Dashboard | Auto Theme | ⚠️ | Light/auto theme inconsistency |
| 3.5 | Dashboard | Settings Nav | ✅ | — |
| 3.6 | Dashboard | New Discipline | ⚠️ | Missing `.catch()` |
| 3.7 | Dashboard | New Disc (All) | ⚠️ | Same as 3.6 |
| 3.8 | Dashboard | Study All | ⚠️ | No empty-check, multi-tab |
| 3.9 | Dashboard | Migrate | ⚠️ | No try/catch, null ref risk |
| 3.10 | Dashboard | Export Data | ✅ | — |
| 3.11 | Dashboard | Import Trigger | ✅ | — |
| 3.12 | Dashboard | Import File | ⚠️ | File input not reset |
| 3.13 | Dashboard | Export CSV | ⚠️ | No error handling |
| 3.14 | Dashboard | Export Anki | ⚠️ | No error handling |
| 3.15 | Dashboard | Export JSON | ⚠️ | Missing try/catch (inconsistent) |
| 3.16 | Dashboard | Disc Card Click | ✅ | — |
| 3.17 | Dashboard | Search Bar | ⚠️ | TODO: not implemented |
| 3.18 | Dashboard | Embedded FAB | ✅ | — |
| 4.1 | Detail | Study | ⚠️ | No error handling |
| 4.2 | Detail | New Module | ⚠️ | No try/catch |
| 4.3 | Detail | Edit Discipline | ⚠️ | Desync risk on failure |
| 4.4 | Detail | Delete Discipline | ⚠️ | No try/catch on destructive op |
| 4.5 | Detail | Breadcrumbs | ✅ | — |
| 4.6 | Detail | Empty Create Module | ⚠️ | Same as 4.2 |
| 4.7 | Detail | Topic Click | ⚠️ | Stub/not implemented |
| 5.1 | Content | Message Listener | ⚠️ | Always returns success |
| 5.2 | Content | (No click handlers) | ✅ | — |

---

## 🚨 CRITICAL FINDINGS (❌)

### 1. **Clipboard Write — Unhandled Promise Rejection** (BinderController.js:192)
```javascript
navigator.clipboard.writeText(text);  // ← Promise not awaited, no .catch()
```
**Fix:** Add `.catch()` or `await` with try/catch, and show user feedback:
```javascript
navigator.clipboard.writeText(text)
  .then(() => { if (this.view?.showToast) this.view.showToast('Copiado!', 'success'); })
  .catch(() => { if (this.view?.showToast) this.view.showToast('Erro ao copiar', 'error'); });
```

### 2. **Menu Auto-Close Broken After First Click** (DisciplinasController.js:194–198)
```javascript
setTimeout(() => {
    document.addEventListener('click', () => {
        container.querySelectorAll('.disc-menu-dropdown').forEach(m => m.classList.add('hidden'));
    }, { once: true });  // ← BUG: fires once then dies
}, 0);
```
**Fix:** Remove `{ once: true }`, or (better) use a persistent click-outside handler:
```javascript
// Add a persistent handler, not { once: true }
document.addEventListener('click', () => {
    container.querySelectorAll('.disc-menu-dropdown').forEach(m => m.classList.add('hidden'));
});
```

---

## 🔶 HIGH-PRIORITY WARNINGS

| Priority | Issue | Where | Recommendation |
|----------|-------|-------|----------------|
| **P1** | Manual Add Save button stuck in loading state if `StorageModel.addItem()` throws | Binder:587–638 | Wrap in `try/finally` to always restore button |
| **P1** | `promptNewDiscipline()` has `.then()` without `.catch()` | Dashboard:681 | Add `.catch(err => showToast(...))` |
| **P1** | `btnMigrate` handler: `result.stats.totalQuestions` — null ref if `stats` undefined | Dashboard:592 | Use `result.stats?.totalQuestions \|\| 0` |
| **P2** | Import file input never reset — can't re-import same file | Dashboard:614–629 | Add `e.target.value = ''` in finally |
| **P2** | Export CSV/Anki/JSON (analytics) — no error handling | Dashboard:632–646 | Add try/catch like `btnExportData` |
| **P2** | Discipline detail `btnEdit` — local state updated before confirming storage success | Detail:285–286 | Move `discipline.name = ...` inside success callback |
| **P3** | Theme storage inconsistency (Light='', Auto='auto') | Dashboard:107–110, 556–567 | Standardize theme values |
| **P3** | Search bar on overview not implemented | Dashboard:657 | Implement or remove TODO |
| **P3** | Topic click in discipline detail is a stub | Detail:267–269 | Implement or hide |

---

## 📈 OVERALL SCORES

| Metric | Score | Notes |
|--------|-------|-------|
| **Total buttons/interactions audited** | **50** | Across all 5 files |
| ✅ No issues | **20** (40%) | Clean implementations |
| ⚠️ Warnings | **28** (56%) | Mostly missing try/catch and double-click guards |
| ❌ Defects | **2** (4%) | Clipboard + menu auto-close |
| **Error handling coverage** | ~35% | Most async handlers lack try/catch |
| **Double-click protection** | ~5% | Only Manual Add Save has loading state |
| **Input validation** | ~85% | Empty checks generally present |
| **Null safety** | ~80% | Good use of `?.` but some gaps |
| **User feedback** | ~60% | Toasts on success, but few on errors |

---

## 🎯 TOP RECOMMENDATIONS

1. **Add a `safeAsync` wrapper** for all button handlers that provides: try/catch, error toast, and optional double-click debounce
2. **Fix the 2 critical bugs** immediately (clipboard + menu close)
3. **Add `try/finally` to all loading-state patterns** to prevent stuck buttons
4. **Standardize error handling**: every `await ServiceCall()` should be in try/catch
5. **Add `.catch()` to all `.then()` chains** (or convert to async/await)
6. **Reset file inputs** after use (`input.value = ''`)
7. **Implement or remove** TODO stubs (search, topic click)
