# Dead Code Re-Analysis Report

> Date: 2026-03-04  
> Scope: Post-graveyard deep re-analysis (line-by-line verification)

---

## 1. Graveyard Validation — Did We Discard Anything Functional?

### Verdict: ✅ NO — All 10 graveyarded files are confirmed 100% dead

| File | Evidence | Status |
|------|----------|--------|
| `src/study/study.js` | `study.html:932` loads `study-hub.js`, NOT `study.js`. 0 imports in codebase. | ✅ DEAD |
| `src/services/search/index.js` | 0 barrel imports. All consumers import specific submodules directly. | ✅ DEAD |
| `src/dashboard/dashboard.html` | `background.js:226` opens `dashboard-v2.html`. 0 getURL refs. | ✅ DEAD |
| `src/dashboard/dashboard.js` | Only loaded by dead `dashboard.html`. 0 imports. | ✅ DEAD |
| `src/popup/new_popup.html` | 1 byte (empty). `manifest.json:46` uses `popup.html`. 0 refs. | ✅ DEAD |
| `src/background.js.bak` | Backup artifact, untracked. | ✅ DEAD |
| `src/controllers/PopupController.js.bak` | Backup artifact, untracked. | ✅ DEAD |
| `src/services/SearchService.js.bak` | Backup artifact, untracked. | ✅ DEAD |
| `src/dashboard/dashboard.html.bak` | Backup artifact, untracked. | ✅ DEAD |
| `src/study/study.html.bak` | Backup artifact, untracked. | ✅ DEAD |

### False positives caught (NOT dead, verified alive):

| File | Why alive | Who flagged it dead |
|------|-----------|-------------------|
| `CorrectionFeedback.js` | Dynamic `import()` at `PopupController.js:4782` | Node.js import graph script (missed dynamic imports) |
| `GeminiCLIApiAdapter.js` | Static import at `ApiService.js:5`, used at `:56` | Sub-agent explore (false analysis) |
| `SearchIndexService.js` | Imported by `study-hub.js:20` and `dashboard-v2.js:7` | Sub-agent explore (false analysis) |

---

## 2. New Dead Code Found

### 2.1 Dead Message Handlers in `background.js`

**4 handlers with 0 senders anywhere in the codebase:**

| Handler (msg.type) | Lines | What it does | Why dead |
|-------------------|-------|-------------|---------|
| `AH_OPEN_DASHBOARD_V2` | 225–229 | Opens dashboard-v2.html in new tab | Dashboard is opened directly via `chrome.runtime.getURL()` in dashboard-v2.js and discipline-detail.html |
| `AH_EVALUATE_BADGES` | 231–246 | Evaluates badges via BadgeService | study-hub.js and dashboard-v2.js call BadgeService directly |
| `AH_RECORD_REVIEW` | 248–258 | Records review via AnalyticsService | study-hub.js calls AnalyticsService.recordReview directly |
| `AH_END_SESSION` | 260–270 | Ends session via AnalyticsService | study-hub.js calls AnalyticsService.endSession directly |

**Impact of removal:** None. BadgeService and AnalyticsService are still used by alarm handlers (lines 80–100) and directly by study-hub/dashboard.

**Severity:** S3 (cosmetic / dead code bloat, ~46 lines)

### 2.2 Dead Exports in `utils/helpers.js`

| Export | Line | Evidence |
|--------|------|----------|
| `cleanText()` | 18 | 0 imports. Other files define their own local `cleanText` functions. |
| `debounce()` | 36 | 0 imports. ComponentLibrary.js implements its own inline debounce. |

**Severity:** S3 (~16 lines)

### 2.3 Dead No-Op Method in `PopupController.js`

| Method | Line | Evidence |
|--------|------|----------|
| `updateStepperState()` | 1370–1372 | No-op (empty body). Comment says "Not needed in new design". 2 vestigial calls at lines 1424, 1740 do nothing. |

**Severity:** S3 (~5 lines including 2 call sites)

### 2.4 Dead CSS Selectors (91 selectors across 4 files)

| CSS File | Dead Count | Total | Key orphaned clusters |
|----------|-----------|-------|----------------------|
| `popup.css` | 23 | 140 | Old onboarding (`ob-slide-inner`, `ob-step-header`, `ob-blob`, `ob-btn-hero-shine`), answer UI (`answer-text`, `qa-actions`) |
| `study-hub.css` | 36 | 424 | Old discipline cards (`disc-card-*`, `disc-breakdown-*`), why-wrong UI (`why-wrong-*`, `ww-sec--*`) |
| `base.css` | 24 | 86 | Unused design-system utilities (`ah-gap-*`, `ah-badge--*`, `ah-toast--*`, `ah-insight--*`) |
| `animations.css` | 8 | 9 | Nearly all animation utilities (`ah-fade-up`, `ah-spinner`, `ah-slide-*`) |

**Severity:** S3 (cosmetic, ~400+ lines of CSS)

### 2.5 chrome-mock.js — Dev-Only File Loaded in Production

- **Location:** `src/popup/popup.html:1470` — `<script src="chrome-mock.js"></script>`
- **Guard:** Line 15 checks for real Chrome APIs and returns early (no-op in production)
- **Impact:** Harmless but unnecessary file load in extension
- **Severity:** S3

---

## 3. Summary

| Category | Count | Severity |
|----------|-------|----------|
| Files graveyarded (confirmed dead) | 10 | ✅ Done |
| Functional files incorrectly flagged | 0 | ✅ Nothing lost |
| Dead message handlers | 4 | S3 |
| Dead JS exports | 2 | S3 |
| Dead no-op methods | 1 + 2 calls | S3 |
| Dead CSS selectors | 91 | S3 |
| Dev-only file in production | 1 | S3 |

### Total remaining dead code: ~470 lines (all S3 — cosmetic/bloat)

---

## 4. Recommended Actions (by impact)

| # | Action | Lines saved | Risk |
|---|--------|-------------|------|
| 1 | Remove 4 dead handlers from `background.js` (lines 224–270) | ~46 | Zero — no senders exist |
| 2 | Remove `cleanText` and `debounce` from `helpers.js` | ~16 | Zero — no importers |
| 3 | Remove `updateStepperState()` and 2 call sites from `PopupController.js` | ~5 | Zero — method is no-op |
| 4 | Clean dead CSS selectors (91 rules across 4 files) | ~400+ | Low — visual-only |
| 5 | Conditional-load chrome-mock.js (or remove from popup.html) | 1 line | Low — guard exists |

All items are S3 severity. No S0/S1/S2 dead code issues remain.
