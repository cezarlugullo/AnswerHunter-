# Study Page: Filter Chips

Filter chips in the toolbar area that toggle visibility of question cards.

## Buttons in this group

### Button: Hide Answered Chip
- **DOM**: `#chipHideAnswered`
- **File**: study.js line 1908
- **Handler**: `function()` (traditional, `this` = element)
- **Trace**: UI click → toggle `.active` class → `filterCards()` → apply modo prova to unanswered cards → `updateNewCardsLimitBadge()`

#### Static Analysis
- Element reference: ❌ — `document.getElementById('chipHideAnswered')` at line 1908 with **no null check**; `addEventListener` will throw if element missing
- Null safety: ❌ — Direct `.addEventListener()` without guard
- Error handling: ✅ — Synchronous operations; `updateNewCardsLimitBadge()` is called without await but is non-critical
- Promise handling: ⚠️ — `updateNewCardsLimitBadge()` appears async but called without await (fire-and-forget)

#### Issues
- **S1** — No null guard. If `#chipHideAnswered` is missing from HTML, script throws at line 1908.
- **S3** — `updateNewCardsLimitBadge()` fire-and-forget.

---

### Button: Review Only Chip
- **DOM**: `#chipReviewOnly`
- **File**: study.js line 1923
- **Handler**: `function()` (traditional)
- **Trace**: UI click → toggle `.active` class → `filterCards()`

#### Static Analysis
- Element reference: ❌ — No null check before addEventListener at line 1923
- Null safety: ❌ — Same issue as chipHideAnswered
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `#chipReviewOnly`.

---

### Button: Hide Today Chip
- **DOM**: `#chipHideToday`
- **File**: study.js line 1931
- **Handler**: async `function()` (traditional)
- **Trace**: UI click → toggle `.active` → persist state to `chrome.storage.local` → `await loadSm2Data()` → `filterCards()` → `updateTodayDoneBadge()`

#### Static Analysis
- Element reference: ✅ — guarded by `if (chipHideToday)` at line 1930
- Null safety: ✅ — Null check present
- Error handling: ⚠️ — `chrome.storage.local.set` wrapped in try/catch with empty catch (line 1934); `loadSm2Data()` awaited but no error handling for it
- Promise handling: ✅ — `await loadSm2Data()` properly awaited; `updateTodayDoneBadge()` called without await but is non-critical

#### Issues
- **S3** — `updateTodayDoneBadge()` is async but not awaited.
- **S3** — Empty catch block `catch (_) {}` swallows storage errors silently.

---

### Button: Reveal All / Modo Prova Toggle
- **DOM**: `#chipRevealAll`
- **File**: study.js line 1957
- **Handler**: `function()` (traditional)
- **Trace**: UI click → check `dataset.state` → if 'hide': reveal all visible cards, set state to 'reveal' → if 'reveal': hide all visible cards, set state to 'hide' → `updateModeToggle()` updates chip label/icon

#### Static Analysis
- Element reference: ⚠️ — `chipReveal` obtained at line 1942 without null check; line 1954 accesses `.dataset` and line 1957 calls `.addEventListener` without guard
- Null safety: ⚠️ — No null check on `chipReveal`
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `#chipRevealAll`. If missing, lines 1954-1963 throw.

---

### Button: Modo Estudo (Prova/Treino)
- **DOM**: `#chipModoEstudo`
- **File**: study.js line 1980
- **Handler**: inline arrow function
- **Trace**: UI click → flip `_modoProva` boolean → `applyModo()` → update label text → toggle `.active` → iterate unanswered cards: if modo prova + has options, hide reveal button → persist to `chrome.storage.local`

#### Static Analysis
- Element reference: ✅ — guarded by `if (chipModo)` at line 1968
- Null safety: ✅ — `label` checked with `if (label)` at line 1971; `revealBtn` checked with `if (!revealBtn) return` at line 1975
- Error handling: ⚠️ — `chrome.storage.local.set` in try/catch with empty catch (line 1983)
- Promise handling: ✅ — N/A (sync save, fire-and-forget)

#### Issues
- **S3** — Empty catch block swallows storage errors.

---

### Button: SM-2 Due Chip
- **DOM**: `#chipSm2Due`
- **File**: study.js line 2525
- **Handler**: async `function()` (traditional)
- **Trace**: UI click → toggle `.active` → `await loadSm2Data()` → `filterCards()`

#### Static Analysis
- Element reference: ✅ — guarded by `if (chipSm2Due)` at line 2524
- Null safety: ✅ — Null check present
- Error handling: ⚠️ — No try/catch around `loadSm2Data()` or `filterCards()`
- Promise handling: ✅ — `await loadSm2Data()` properly awaited

#### Issues
- **S2** — If `loadSm2Data()` throws, the unhandled promise rejection propagates. Should wrap in try/catch.

---

### Button: Errors Chip (Caderno de Erros)
- **DOM**: `#chipErrors`
- **File**: study.js line 3894
- **Handler**: async `function()` (traditional)
- **Trace**: UI click → toggle `.active` → `await loadSm2Data()` → `filterCards()`

#### Static Analysis
- Element reference: ✅ — guarded by `if (chipErrors)` at line 3893
- Null safety: ✅ — Null check present
- Error handling: ⚠️ — Same as SM-2 Due; no try/catch
- Promise handling: ✅ — `await loadSm2Data()` properly awaited

#### Issues
- **S2** — Same unhandled rejection risk as SM-2 Due chip.

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click hide answered chip | Answered cards hidden, chip highlighted | [Unverified] — requires browser runtime |
| Click hide answered again | Answered cards shown, chip unhighlighted | [Unverified] — requires browser runtime |
| Click review only chip | Only for-review cards shown | [Unverified] — requires browser runtime |
| Click hide today chip | Today's SM-2 rated cards hidden | [Unverified] — requires browser runtime |
| Click reveal all → all cards revealed | All visible cards show answers | [Unverified] — requires browser runtime |
| Click reveal all again → all cards hidden | Cards return to hidden answer state | [Unverified] — requires browser runtime |
| Click modo prova toggle | Reveal buttons hidden for cards with options | [Unverified] — requires browser runtime |
| Click modo treino toggle | Reveal buttons shown for all cards | [Unverified] — requires browser runtime |
| Click SM-2 due chip | Only due-for-review cards shown | [Unverified] — requires browser runtime |
| Click errors chip | Only cards with wrong answers shown | [Unverified] — requires browser runtime |
| Multiple chips active simultaneously | Filters combine (AND logic) | [Unverified] — requires browser runtime |
| `#chipHideAnswered` missing from HTML | TypeError thrown at line 1908 | [Unverified] — requires browser runtime |
| `#chipReviewOnly` missing from HTML | TypeError thrown at line 1923 | [Unverified] — requires browser runtime |
| `loadSm2Data()` rejects while SM-2 chip active | Unhandled promise rejection | [Unverified] — requires browser runtime |
| Chrome storage unavailable | Empty catch swallows error | [Unverified] — requires browser runtime |

## Overall Status: ⚠️ — `#chipHideAnswered`, `#chipReviewOnly`, and `#chipRevealAll` lack null guards and will crash if elements are missing. Async chip handlers lack try/catch.
