# Dashboard: Export & Import

## Buttons in this group

### Button: Export Data (Full JSON Backup)
- **DOM**: `#btnExportData`
- **File**: dashboard-v2.js line 600
- **Handler**: Downloads a full JSON backup via `ExportService.downloadBackup()`. Wrapped in try/catch with toast feedback.
  - **DEMO path**: Shows warning toast `"Exportação não disponível em modo demo"` and returns early.
  - **Non-DEMO path**: Awaits `ExportService.downloadBackup()`, shows success toast. On error, shows danger toast with `err.message`.
- **Trace**: UI click → DEMO check → (DEMO) warning toast + return / (non-DEMO) `await ExportService.downloadBackup()` → success toast / catch → danger toast

#### Static Analysis
- Element reference: ✅ — optional chaining
- Null safety: ✅
- Error handling: ✅ — proper try/catch wrapping the async call, with user-visible error toast
- DEMO mode guard: ✅ — explicit check with warning toast and early return

#### Issues
- None identified. This is the best-implemented handler in the file — proper async/await, try/catch, DEMO guard, and user feedback on both success and error paths.

---

### Button: Import Data
- **DOM**: `#btnImportData`
- **File**: dashboard-v2.js line 611
- **Handler**: Triggers click on the hidden `#importFileInput` file input. The actual import logic is in the `change` event listener on `#importFileInput` (line 614).
- **Trace**: UI click → `document.getElementById('importFileInput')?.click()` → file picker opens

#### Static Analysis
- Element reference: ✅ — optional chaining on both the button and the file input
- Null safety: ✅ — `?.click()` prevents crash if input missing
- Error handling: N/A — this handler only triggers the file picker; error handling is in the `change` handler
- DEMO mode guard: ❌ — **No DEMO guard**. The file picker opens in DEMO mode. The subsequent `change` handler calls `ExportService.readFile` and `ExportService.importFullJSON` which rely on `chrome.storage`. In DEMO mode, `ExportService` methods may throw or behave unexpectedly since `chrome.storage` is unavailable.

#### Issues
- **S1 — No DEMO mode guard on import**: Unlike `btnExportData` and `btnMigrate`, the import flow has no DEMO check. Users in DEMO mode can select a file and the import will attempt to call `ExportService.importFullJSON(text)` which likely calls `chrome.storage.local.set` internally. This will fail with an obscure error or silently corrupt state.

---

### Hidden Input: Import File Input (change handler)
- **DOM**: `#importFileInput`
- **File**: dashboard-v2.js line 614
- **Handler**: Reads the selected file via `ExportService.readFile(file)`, then calls `ExportService.importFullJSON(text)`. On success, shows toast and reloads after 1500ms. On failure, shows error toast.
- **Trace**: file selected → `e.target.files?.[0]` → `ExportService.readFile(file)` → `ExportService.importFullJSON(text)` → success: toast + `setTimeout(reload, 1500)` / failure: toast with `result.message` / catch: toast with `err.message`

#### Static Analysis
- Element reference: ✅ — optional chaining
- Null safety: ✅ — checks `if (!file) return` via `e.target.files?.[0]`
- Error handling: ✅ — proper try/catch, handles both `result.success === false` (shows `result.message`) and thrown exceptions (shows `err.message`)
- DEMO mode guard: ❌ — **No DEMO guard** (inherited from `btnImportData` issue)

#### Issues
- **S1 — No DEMO mode guard**: See `btnImportData` above.
- **S3 — No confirmation dialog**: Import overwrites existing data without confirmation. A `confirm()` dialog would be appropriate for a destructive operation.
- **S3 — File input not reset**: After import (success or failure), `e.target.value` is not reset. Re-selecting the same file will not trigger the `change` event because the file path hasn't changed. The user must select a different file and then re-select the original, which is a confusing UX.

---

### Button: Export CSV
- **DOM**: `#btnExportCSV`
- **File**: dashboard-v2.js line 632
- **Handler**: Calls `ExportService.downloadCSV(hierarchyData)` synchronously, then shows success toast.
  - **DEMO path**: `if (DEMO) return` — silent early return, no toast.
- **Trace**: UI click → `if (DEMO) return` → `ExportService.downloadCSV(hierarchyData)` → success toast

#### Static Analysis
- Element reference: ✅ — optional chaining
- Null safety: ✅
- Error handling: ❌ — **No try/catch**. `ExportService.downloadCSV` is called without error handling. If it throws (e.g., empty `hierarchyData`, blob creation failure), the success toast never fires but no error toast is shown either. The error surfaces only in the console.
- DEMO mode guard: ⚠️ — guard present (`if (DEMO) return`) but **silent** — no toast or feedback. Inconsistent with `btnExportData` which shows a warning toast.

#### Issues
- **S2 — No error handling**: `downloadCSV` call is unwrapped. Errors are swallowed.
- **S2 — Silent DEMO guard**: Unlike `btnExportData` which shows a warning toast, `btnExportCSV` silently returns. Inconsistent UX.
- **S3 — Success toast shown unconditionally**: The success toast fires after `downloadCSV` returns, but if the function throws, execution stops before the toast. However, if `downloadCSV` returns successfully but the download actually fails (e.g., browser blocks the download), the user still sees "CSV exportado!" — false positive.

---

### Button: Export Anki
- **DOM**: `#btnExportAnki`
- **File**: dashboard-v2.js line 637
- **Handler**: Calls `ExportService.downloadAnki(hierarchyData)` synchronously, then shows success toast.
  - **DEMO path**: `if (DEMO) return` — silent early return, no toast.
- **Trace**: UI click → `if (DEMO) return` → `ExportService.downloadAnki(hierarchyData)` → success toast

#### Static Analysis
- Element reference: ✅ — optional chaining
- Null safety: ✅
- Error handling: ❌ — **No try/catch**. Same issue as `btnExportCSV`.
- DEMO mode guard: ⚠️ — silent guard, no toast. Same inconsistency as `btnExportCSV`.

#### Issues
- **S2 — No error handling**: `downloadAnki` call is unwrapped.
- **S2 — Silent DEMO guard**: Inconsistent with `btnExportData`.

---

### Button: Export JSON (Analytics page)
- **DOM**: `#btnExportJSON`
- **File**: dashboard-v2.js line 642
- **Handler**: Calls `await ExportService.downloadBackup()` (same as `btnExportData`), then shows success toast.
  - **DEMO path**: `if (DEMO) return` — silent early return.
- **Trace**: UI click → `if (DEMO) return` → `await ExportService.downloadBackup()` → success toast

#### Static Analysis
- Element reference: ✅ — optional chaining
- Null safety: ✅
- Error handling: ❌ — **No try/catch**. Unlike `btnExportData` (line 600) which wraps the same `ExportService.downloadBackup()` call in try/catch, this handler does not. If `downloadBackup()` throws, it's an unhandled promise rejection.
- DEMO mode guard: ⚠️ — silent guard, no toast. Inconsistent with `btnExportData`.

#### Issues
- **S1 — Missing try/catch on async call**: `btnExportJSON` calls the exact same `ExportService.downloadBackup()` as `btnExportData`, but without the try/catch. This is a copy-paste inconsistency. If the backup fails, the user sees no error feedback and gets an unhandled rejection.
- **S2 — Silent DEMO guard**: Unlike `btnExportData` which shows a warning toast.

---

## DEMO Mode Guard Consistency Matrix

| Button | DEMO Guard | User Feedback in DEMO | Consistent? |
|--------|-----------|----------------------|-------------|
| `btnExportData` | ✅ `if (DEMO) { toast; return }` | ✅ Warning toast | ✅ Best practice |
| `btnImportData` | ❌ None | ❌ No guard at all | ❌ **Missing** |
| `importFileInput` | ❌ None | ❌ No guard at all | ❌ **Missing** |
| `btnExportCSV` | ⚠️ `if (DEMO) return` | ❌ Silent return | ⚠️ Inconsistent |
| `btnExportAnki` | ⚠️ `if (DEMO) return` | ❌ Silent return | ⚠️ Inconsistent |
| `btnExportJSON` | ⚠️ `if (DEMO) return` | ❌ Silent return | ⚠️ Inconsistent |

## Error Handling Consistency Matrix

| Button | try/catch | Async? | Risk |
|--------|----------|--------|------|
| `btnExportData` | ✅ | ✅ async | Low |
| `btnImportData` + `importFileInput` | ✅ | ✅ async | Medium (no DEMO guard) |
| `btnExportCSV` | ❌ | ❌ sync | Medium |
| `btnExportAnki` | ❌ | ❌ sync | Medium |
| `btnExportJSON` | ❌ | ✅ async | **High** — unhandled rejection |

## Cross-Cutting Issues

| ID | Severity | Description |
|----|----------|-------------|
| EXP-1 | S1 | `btnImportData`/`importFileInput`: No DEMO mode guard. Import flow can attempt chrome.storage writes in DEMO mode. |
| EXP-2 | S1 | `btnExportJSON`: Missing try/catch on `await ExportService.downloadBackup()`. Same function that `btnExportData` wraps properly. Copy-paste inconsistency. |
| EXP-3 | S2 | `btnExportCSV`: No error handling around `ExportService.downloadCSV`. |
| EXP-4 | S2 | `btnExportAnki`: No error handling around `ExportService.downloadAnki`. |
| EXP-5 | S2 | `btnExportCSV`, `btnExportAnki`, `btnExportJSON`: DEMO guard uses silent `return` instead of warning toast. Inconsistent with `btnExportData`. |
| EXP-6 | S3 | `importFileInput` change handler: file input value not reset after import — re-selecting the same file won't trigger change event. |
| EXP-7 | S3 | Import has no confirmation dialog before overwriting all data. |

## Test Scenarios

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 1 | Click `btnExportData` in non-DEMO | JSON backup downloads, success toast | [Unverified] — requires browser runtime |
| 2 | Click `btnExportData` in DEMO | Warning toast, no download | [Unverified] — requires browser runtime |
| 3 | Click `btnExportData`, `downloadBackup` throws | Danger toast with error message | [Unverified] — requires browser runtime |
| 4 | Click `btnImportData` in non-DEMO | File picker opens | [Unverified] — requires browser runtime |
| 5 | Click `btnImportData` in DEMO | File picker opens (BUG: should block or warn) | [Unverified] — requires browser runtime |
| 6 | Import valid JSON file | Success toast, page reloads after 1500ms | [Unverified] — requires browser runtime |
| 7 | Import invalid JSON file | Danger toast with error message | [Unverified] — requires browser runtime |
| 8 | Import file, then re-select same file | Change event does not fire (BUG: input not reset) | [Unverified] — requires browser runtime |
| 9 | Import in DEMO mode, select file | Likely throws error from ExportService (BUG) | [Unverified] — requires browser runtime |
| 10 | Click `btnExportCSV` in non-DEMO | CSV downloads, success toast | [Unverified] — requires browser runtime |
| 11 | Click `btnExportCSV` in DEMO | Silent no-op (BUG: should show toast) | [Unverified] — requires browser runtime |
| 12 | Click `btnExportCSV`, `downloadCSV` throws | Unhandled error, no toast (BUG) | [Unverified] — requires browser runtime |
| 13 | Click `btnExportAnki` in non-DEMO | Anki file downloads, success toast | [Unverified] — requires browser runtime |
| 14 | Click `btnExportAnki` in DEMO | Silent no-op (BUG: should show toast) | [Unverified] — requires browser runtime |
| 15 | Click `btnExportAnki`, `downloadAnki` throws | Unhandled error, no toast (BUG) | [Unverified] — requires browser runtime |
| 16 | Click `btnExportJSON` in non-DEMO | JSON backup downloads, success toast | [Unverified] — requires browser runtime |
| 17 | Click `btnExportJSON` in DEMO | Silent no-op (BUG: should show toast) | [Unverified] — requires browser runtime |
| 18 | Click `btnExportJSON`, `downloadBackup` throws | Unhandled rejection, no toast (BUG) | [Unverified] — requires browser runtime |
| 19 | Click `btnExportCSV` with empty `hierarchyData` | Depends on ExportService behavior — may produce empty file or throw | [Unverified] — requires browser runtime |

## Overall Status: ❌ — Two S1 issues (missing DEMO guard on import, missing try/catch on Export JSON), multiple S2 inconsistencies in error handling and DEMO feedback
