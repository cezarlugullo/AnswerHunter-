# Dashboard: Study All & Migrate

## Buttons in this group

### Button: Study All
- **DOM**: `#btnStudyAll`
- **File**: dashboard-v2.js line 577
- **Handler**: Opens the study page (`src/study/study.html`) in a new Chrome tab. Only fires in non-DEMO mode; in DEMO mode the click handler does nothing (no toast, no feedback).
- **Trace**: UI click → `if (!DEMO)` → `chrome.tabs.create({ url: chrome.runtime.getURL('src/study/study.html') })`

#### Static Analysis
- Element reference: ✅ — optional chaining (`?.addEventListener`)
- Null safety: ✅
- Error handling: ⚠️ — `chrome.tabs.create` is called without a callback or `.catch`. If the URL is invalid or the tabs API is restricted, the error is silently ignored.
- DEMO mode guard: ⚠️ — **Guard present but incomplete**. The handler checks `if (!DEMO)` to skip the Chrome API call, but provides **no user feedback** (no toast, no message) when in DEMO mode. The user clicks the button and nothing visible happens.

#### Issues
- **S2 — Silent no-op in DEMO mode**: Clicking "Study All" in DEMO mode produces zero feedback. User may perceive the button as broken. Should show a toast like `"Estudo não disponível em modo demo"`.
- **S3 — No error handling on `chrome.tabs.create`**: If the tab creation fails (e.g., extension context invalidated), the failure is silent.

---

### Button: Migrate (v1 → v2)
- **DOM**: `#btnMigrate`
- **File**: dashboard-v2.js line 584
- **Handler**: Runs the v1→v2 data migration via `MigrationService.migrate()`. Shows info/success/danger toasts based on result.
  - **DEMO path**: Shows warning toast `"Migração não disponível em modo demo"` and returns early.
  - **Non-DEMO path**: Calls `MigrationService.migrate()`. On success, shows toast with card count and calls `location.reload()`. On failure, shows error toast.
- **Trace**: UI click → DEMO check → (DEMO) warning toast + return / (non-DEMO) info toast → `MigrationService.migrate()` → success: success toast + `location.reload()` / failure: danger toast

#### Static Analysis
- Element reference: ✅ — optional chaining
- Null safety: ✅ — uses `result.stats.totalQuestions || 0` fallback for card count
- Error handling: ⚠️ — **Partial**. The handler checks `result.success` and shows `result.error` on failure, but the `await MigrationService.migrate()` call is **not wrapped in try/catch**. If `MigrationService.migrate()` itself throws an exception (as opposed to returning `{ success: false }`), the error is an unhandled promise rejection with no user feedback.
- DEMO mode guard: ✅ — proper guard with user-visible warning toast and early return

#### Issues
- **S1 — Missing try/catch around `MigrationService.migrate()`**: The handler assumes `migrate()` always returns a result object. If it throws (network error, storage corruption, internal bug), the async handler produces an unhandled rejection. The "Iniciando migração..." info toast remains on screen with no follow-up. This is a data migration operation — failures must be caught.
- **S3 — No confirmation dialog**: Migration is a potentially destructive operation (restructures all v1 data). There is no `confirm()` dialog before proceeding — a single accidental click triggers immediate migration.
- **S3 — Button remains visible after successful migration**: After migration + reload, the migrate button reappears on the settings page. There is no logic in `bindEvents` to hide/disable it if migration is already complete.

---

## Cross-Cutting Issues

| ID | Severity | Description |
|----|----------|-------------|
| STD-1 | S2 | `btnStudyAll` in DEMO mode: silent no-op, no user feedback. |
| STD-2 | S1 | `btnMigrate` async handler has no try/catch — thrown exceptions produce unhandled rejection with misleading "Iniciando migração..." toast left on screen. |
| STD-3 | S3 | `btnMigrate` has no confirmation dialog before starting destructive migration. |
| STD-4 | S3 | Migrate button stays visible even after successful prior migration. |

## Test Scenarios

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 1 | Click `btnStudyAll` in non-DEMO mode | New tab opens with `study.html` | [Unverified] — requires browser runtime |
| 2 | Click `btnStudyAll` in DEMO mode | Nothing happens (BUG: should show toast) | [Unverified] — requires browser runtime |
| 3 | Click `btnMigrate` in DEMO mode | Warning toast shown, no migration runs | [Unverified] — requires browser runtime |
| 4 | Click `btnMigrate`, migration succeeds | Info toast → success toast with card count → page reload | [Unverified] — requires browser runtime |
| 5 | Click `btnMigrate`, migration returns `{ success: false, error: "..." }` | Danger toast with error message | [Unverified] — requires browser runtime |
| 6 | Click `btnMigrate`, `MigrationService.migrate()` throws exception | Unhandled rejection, info toast stuck on screen (BUG) | [Unverified] — requires browser runtime |
| 7 | Click `btnMigrate` when no v1 data exists | Should succeed with 0 cards or show appropriate message | [Unverified] — requires browser runtime |
| 8 | Double-click `btnMigrate` rapidly | Two concurrent migrations may run — no debounce/disable | [Unverified] — requires browser runtime |
| 9 | Click `btnMigrate` after prior successful migration | Button is still visible; re-migration may produce unexpected results | [Unverified] — requires browser runtime |

## Overall Status: ⚠️ — `btnStudyAll` has silent DEMO mode (S2); `btnMigrate` has missing try/catch on critical async operation (S1)
