# Study Page: Toolbar Buttons

Top-level toolbar actions: reset, print, copy all, export Anki, export/import full backup, tag all visible.

## Buttons in this group

### Button: Reset Progress
- **DOM**: `#btnReset`
- **File**: study.js line 1992
- **Handler**: inline arrow function
- **Trace**: UI click → `confirm()` dialog → if confirmed: iterate all `.card` elements → `hideCard(card)` → reset chipReveal state → remove `.active` from chipHideAnswered, chipReviewOnly, chipHideToday → reset subject select to 'all' → persist subject filter → `filterCards()`

#### Static Analysis
- Element reference: ❌ — `document.getElementById('btnReset')` at line 1992 with **no null check** before `.addEventListener`
- Null safety: ⚠️ — `chipReveal`, `chipHideAnswered`, `chipReviewOnly` referenced directly (lines 1995-1997) without null checks; `chipHideToday` checked with `if (chipHT)` (line 1999)
- Error handling: ⚠️ — `chrome.storage.local.set` wrapped in try/catch with empty catch (lines 2001, 2005)
- Promise handling: ✅ — All operations are synchronous

#### Issues
- **S1** — No null guard on `#btnReset`. If missing, line 1992 throws.
- **S0** — Destructive action guarded only by `confirm()`. Resets all session progress with no undo. This is expected behavior but documented as S0 severity awareness.
- **S3** — References `chipReveal` (line 1995) which is a module-level variable; if `#chipRevealAll` doesn't exist, `chipReveal.dataset` throws.

---

### Button: Print
- **DOM**: `#btnPrint`
- **File**: study.js line 2022
- **Handler**: inline arrow `() => window.print()`
- **Trace**: UI click → `window.print()` → opens browser print dialog

#### Static Analysis
- Element reference: ❌ — No null check before addEventListener at line 2022
- Null safety: ❌ — Direct `.addEventListener` without guard
- Error handling: ✅ — `window.print()` is synchronous and doesn't throw
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `#btnPrint`.

---

### Button: Copy All
- **DOM**: `#btnCopyAll`
- **File**: study.js line 2027
- **Handler**: async arrow with `(e)` parameter
- **Trace**: UI click → query all visible cards → build concatenated text (question + answer + explanation) → `navigator.clipboard.writeText()` → flash "Copiado!" for 2s

#### Static Analysis
- Element reference: ❌ — No null check before addEventListener at line 2027
- Null safety: ⚠️ — `card.querySelector('.card-question').innerText` could throw if `.card-question` missing; `.answer-explanation` checked with ternary
- Error handling: ✅ — `try/catch` around clipboard API (lines 2042-2052)
- Promise handling: ✅ — `await navigator.clipboard.writeText()` properly awaited

#### Issues
- **S1** — No null guard on `#btnCopyAll`.
- **S3** — Early return `if (visibleCards.length === 0) return` at line 2030 gives no user feedback.

---

### Button: Export Anki
- **DOM**: `#btnExportAnki`
- **File**: study.js line 4198
- **Handler**: inline arrow function
- **Trace**: UI click → query visible cards → build tab-separated text (Anki format) → create Blob → trigger download → show toast

#### Static Analysis
- Element reference: ❌ — No null check before addEventListener at line 4198
- Null safety: ⚠️ — `card.querySelector('.card-question')` and `.answer-text-content` checked with `if (!qEl || !aEl) return` inside forEach (line 4213)
- Error handling: ⚠️ — No try/catch around Blob creation or download; `URL.createObjectURL` and download could fail
- Promise handling: ✅ — Synchronous operations

#### Issues
- **S1** — No null guard on `#btnExportAnki`.
- **S3** — No error handling for failed downloads; no feedback if 0 valid cards after filtering.
- **S3** — `alert()` used at line 4201 instead of toast for empty cards message.

---

### Button: Export Full Backup
- **DOM**: `#btnExportFull`
- **File**: study.js line 4691
- **Handler**: async arrow function
- **Trace**: UI click → `loadXPData()` → `loadSm2Data()` → get binderStructure → build JSON payload (v2 format) → create Blob → trigger download → show toast

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `document.getElementById('btnExportFull')?.addEventListener` at line 4691
- Null safety: ✅ — Optional chaining prevents crash
- Error handling: ✅ — Full `try/catch` with toast on error (lines 4692-4705)
- Promise handling: ✅ — All async operations properly awaited

#### Issues
- None identified. Well-implemented with optional chaining, try/catch, and user feedback.

---

### Button: Import Full Backup
- **DOM**: `#btnImportFull`
- **File**: study.js line 4708
- **Handler**: inline arrow triggering `#importFileInput` click
- **Trace**: UI click → programmatically click hidden file input → file picker opens

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener` at line 4708
- Null safety: ✅ — `?.click()` at line 4709 prevents crash
- Error handling: ✅ — File reading/parsing handled in the `change` event handler (lines 4712-4735) with try/catch
- Promise handling: ✅ — Properly awaited in change handler

#### Issues
- **S2** — `confirm()` at line 4723 is the only guard before overwriting all data. The message warns about data replacement but there's no intermediate backup.
- **S3** — After import success, `window.location.reload()` is called after 1.5s timeout (line 4732); if user navigates away during this window, import may be inconsistent.

---

### Button: Tag All Visible
- **DOM**: `#btnTagAllVisible`
- **File**: study.js line 1848
- **Handler**: inline arrow function
- **Trace**: UI click → `generateTagsForVisibleCards().catch(...)` → iterates visible cards → calls AI tagging for each → updates SM-2 data → refresh subject organization → show toast

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnTagAllVisible)` at line 1847
- Null safety: ✅ — Null check present
- Error handling: ✅ — `.catch()` on the promise at line 1849 shows error toast
- Promise handling: ⚠️ — Fire-and-forget with `.catch()` handler; not awaited. This means the handler returns immediately.

#### Issues
- **S3** — Fire-and-forget async call. If `generateTagsForVisibleCards` partially fails, only the `.catch()` handler fires; individual card failures are handled internally (shown in toast at line 4190).

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click reset → confirm | All cards hidden, chips reset, filter cleared | [Unverified] — requires browser runtime |
| Click reset → cancel | No changes | [Unverified] — requires browser runtime |
| Click print | Browser print dialog opens | [Unverified] — requires browser runtime |
| Click copy all with visible cards | All Q&A text copied to clipboard | [Unverified] — requires browser runtime |
| Click copy all with 0 visible cards | No action, no feedback | [Unverified] — requires browser runtime |
| Click export Anki with cards | .txt file downloaded | [Unverified] — requires browser runtime |
| Click export Anki with 0 cards | Alert shown | [Unverified] — requires browser runtime |
| Click export full | JSON backup file downloaded | [Unverified] — requires browser runtime |
| Click import full → select valid v2 JSON | Confirm dialog → data replaced → page reloads | [Unverified] — requires browser runtime |
| Click import full → select invalid file | Error toast shown | [Unverified] — requires browser runtime |
| Click import full → cancel confirm | No changes | [Unverified] — requires browser runtime |
| Click tag all visible | AI tags generated for all visible cards | [Unverified] — requires browser runtime |
| Tag all visible with API failure | Error toast "Falha ao gerar tags em lote" | [Unverified] — requires browser runtime |
| `#btnReset` missing from HTML | TypeError at line 1992 | [Unverified] — requires browser runtime |
| `#btnPrint` missing from HTML | TypeError at line 2022 | [Unverified] — requires browser runtime |
| `#btnCopyAll` missing from HTML | TypeError at line 2027 | [Unverified] — requires browser runtime |

## Overall Status: ⚠️ — `#btnReset`, `#btnPrint`, `#btnCopyAll`, `#btnExportAnki` lack null guards. Export/import full backup uses proper optional chaining and error handling (good pattern).
