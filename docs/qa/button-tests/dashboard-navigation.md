# Dashboard: Navigation & New Discipline

## Buttons in this group

### Button: Settings
- **DOM**: `#btnSettings`
- **File**: dashboard-v2.js line 570
- **Handler**: Calls `navigateTo('settings')` which updates sidebar active state, shows the `#page-settings` section, and hides all other `.page-section` elements.
- **Trace**: UI click → `navigateTo('settings')` → toggle `.ah-sidebar__item--active` on sidebar items → toggle `.page-section--active` on page sections

#### Static Analysis
- Element reference: ✅ — optional chaining (`?.addEventListener`)
- Null safety: ✅
- Error handling: ✅ — `navigateTo` is purely synchronous DOM manipulation, no async or storage calls that can throw
- DEMO mode guard: ✅ — no guard needed; `navigateTo` is a pure client-side page switch with no storage or chrome API interaction

#### Issues
- None identified.

---

### Button: New Discipline (Overview)
- **DOM**: `#btnNewDisc`
- **File**: dashboard-v2.js line 573
- **Handler**: Calls `promptNewDiscipline()` (line 665). Opens a `prompt()` dialog asking for a discipline name.
  - **DEMO path** (lines 669–678): pushes a new object into `hierarchyData` with a generated ID, default icon `📚`, and a color from a rotating palette. Calls `renderDisciplineGrid()` and `showToast`.
  - **Non-DEMO path** (lines 681–685): calls `ContentHierarchyService.createDiscipline({ name })`, pushes the result into `hierarchyData`, calls `renderDisciplineGrid()` and `showToast`.
- **Trace**: UI click → `prompt()` → (DEMO) in-memory push + re-render / (non-DEMO) `ContentHierarchyService.createDiscipline` → push + re-render → toast

#### Static Analysis
- Element reference: ✅ — optional chaining
- Null safety: ✅ — checks `if (!name || !name.trim()) return`
- Error handling: ❌ — the non-DEMO path uses `.then()` with no `.catch()`. If `ContentHierarchyService.createDiscipline` rejects, the promise rejection is unhandled. This can cause an `Unhandled Promise Rejection` console error with no user feedback.
- DEMO mode guard: ✅ — separate DEMO and non-DEMO branches

#### Issues
- **S2 — Unhandled promise rejection**: `ContentHierarchyService.createDiscipline().then(...)` has no `.catch()`. If the service throws (e.g., storage full, validation error), the user sees no feedback and gets a console error.
- **S3 — No duplicate-name check**: Neither the DEMO nor non-DEMO path checks if a discipline with the same name already exists.

---

### Button: New Discipline (All Disciplines page)
- **DOM**: `#btnNewDiscAll`
- **File**: dashboard-v2.js line 574
- **Handler**: Same handler — `promptNewDiscipline` (identical to `btnNewDisc`).
- **Trace**: Same as `btnNewDisc` above.

#### Static Analysis
- Element reference: ✅
- Null safety: ✅
- Error handling: ❌ — same unhandled rejection issue
- DEMO mode guard: ✅

#### Issues
- Same issues as `btnNewDisc` (S2 unhandled rejection, S3 no duplicate check).

---

## `navigateTo(pageId)` — Supporting Function (line 196)

```
function navigateTo(pageId) {
  currentPage = pageId;
  // Toggle sidebar active state
  document.querySelectorAll('.ah-sidebar__item').forEach(...)
  // Show/hide page sections
  document.querySelectorAll('.page-section').forEach(...)
  // Lazy-load on certain pages
  if (pageId === 'disciplines') renderAllDisciplines();
  if (pageId === 'analytics') renderAnalyticsPage();
  if (pageId === 'badges') renderBadgesPage();
}
```

**Analysis**:
- No validation of `pageId` — passing an unknown value silently hides all pages (no error, no fallback).
- No scroll-to-top or focus management — accessibility concern for keyboard users.
- Lazy-load functions (`renderAnalyticsPage`, `renderBadgesPage`) are async but their return values are not awaited; errors inside them would be unhandled at this level.

## Cross-Cutting Issues

| ID | Severity | Description |
|----|----------|-------------|
| NAV-1 | S2 | `promptNewDiscipline` non-DEMO path: `.then()` with no `.catch()` — unhandled promise rejection if service call fails. |
| NAV-2 | S3 | `navigateTo` does not validate `pageId` — invalid values silently hide all sections. |
| NAV-3 | S3 | No duplicate discipline name validation in `promptNewDiscipline`. |
| NAV-4 | S3 | `navigateTo` lazy-load calls (`renderAnalyticsPage`, `renderBadgesPage`) are fire-and-forget async — errors not surfaced. |

## Test Scenarios

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 1 | Click `btnSettings` | Settings page shown, sidebar highlights "Configurações" | [Unverified] — requires browser runtime |
| 2 | Click `btnNewDisc`, enter valid name | Discipline created, grid re-rendered, success toast shown | [Unverified] — requires browser runtime |
| 3 | Click `btnNewDisc`, cancel prompt | Nothing happens, no errors | [Unverified] — requires browser runtime |
| 4 | Click `btnNewDisc`, enter empty/whitespace-only name | Early return, no discipline created | [Unverified] — requires browser runtime |
| 5 | Click `btnNewDiscAll`, enter valid name | Same behavior as `btnNewDisc` | [Unverified] — requires browser runtime |
| 6 | Non-DEMO: `ContentHierarchyService.createDiscipline` rejects | Unhandled promise rejection — no toast, console error (BUG) | [Unverified] — requires browser runtime |
| 7 | Create discipline with duplicate name | Allowed without warning (potential data quality issue) | [Unverified] — requires browser runtime |
| 8 | `navigateTo` with unknown pageId | All page sections hidden, sidebar has no active item | [Unverified] — requires browser runtime |
| 9 | DEMO mode: create discipline | In-memory push, grid updates, toast shown | [Unverified] — requires browser runtime |

## Overall Status: ⚠️ — `btnSettings` is clean; `btnNewDisc`/`btnNewDiscAll` have an unhandled rejection risk (S2)
