# Study Page: Flashcard Mode

Buttons for the 3D flip flashcard study mode including tab switching, navigation, and FSRS quality rating.

## Buttons in this group

### Button: Flashcard Tab
- **DOM**: `#tabFlashcards`
- **File**: study.js line 5595
- **Handler**: inline arrow function inside `initFlashcardMode()`
- **Trace**: UI click → remove `.active` from all `.main-mode-tab` → add `.active` to self → remove `dashboard-main-mode` from body → add `flashcard-main-mode` → `buildFlashcardQueue()` → `renderFlashcard()`

#### Static Analysis
- Element reference: ✅ — guarded by `if (!tabFlashcards) return` at line 5593
- Null safety: ✅ — Early return if element missing
- Error handling: ⚠️ — `buildFlashcardQueue()` and `renderFlashcard()` called without error handling
- Promise handling: ✅ — Synchronous operations

#### Issues
- None critical. Guard clause is exemplary.

---

### Button: Exit Flashcard Mode (Dashboard Tab click)
- **DOM**: `#tabDashboard` (inside `initFlashcardMode`)
- **File**: study.js line 5616 (inside forEach over `[tabDashboard, tabQuestions]`)
- **Handler**: inline arrow function
- **Trace**: UI click → remove `flashcard-main-mode` from body → remove `.active` from flashcard tab → update `aria-pressed`

#### Static Analysis
- Element reference: ✅ — guarded by `if (!tab) return` at line 5615
- Null safety: ✅ — Null check present
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Exit Flashcard Mode (Questions Tab click)
- **DOM**: `#tabQuestions` (inside `initFlashcardMode`)
- **File**: study.js line 5616 (same forEach)
- **Handler**: Same as Dashboard Tab click above

#### Static Analysis
- Same as above

#### Issues
- None identified.

---

### Button: Flip Flashcard (Button)
- **DOM**: `#flashcardFlip`
- **File**: study.js line 5627
- **Handler**: `flipFlashcard` (named function)
- **Trace**: UI click → toggle `_flashcardFlipped` boolean → toggle `.flipped` class on flashcard container → updates ARIA labels

#### Static Analysis
- Element reference: ✅ — guarded by `if (flipBtn && container)` at line 5626
- Null safety: ✅ — Both elements checked
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Flip Flashcard (Container Click)
- **DOM**: `#flashcardContainer`
- **File**: study.js line 5628
- **Handler**: `flipFlashcard` (same function)
- **Trace**: Same as Flip Button — clicking the card itself also flips it

#### Static Analysis
- Element reference: ✅ — guarded by same `if (flipBtn && container)` at line 5626
- Null safety: ✅ — Same guard
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Previous Flashcard
- **DOM**: `#flashcardPrev`
- **File**: study.js line 5632
- **Handler**: inline arrow `() => navigateFlashcard(-1)`
- **Trace**: UI click → `navigateFlashcard(-1)` → decrement `_flashcardIndex` (wraps to end if at 0) → `renderFlashcard()` → reset flip state

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener` at line 5632
- Null safety: ✅ — Optional chaining
- Error handling: ⚠️ — `navigateFlashcard` not wrapped in try/catch; depends on internal safety
- Promise handling: ✅ — Synchronous

#### Issues
- None identified.

---

### Button: Next Flashcard
- **DOM**: `#flashcardNext`
- **File**: study.js line 5633
- **Handler**: inline arrow `() => navigateFlashcard(1)`
- **Trace**: UI click → `navigateFlashcard(1)` → increment `_flashcardIndex` (wraps to 0 if at end) → `renderFlashcard()` → reset flip state

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener` at line 5633
- Null safety: ✅ — Optional chaining
- Error handling: ⚠️ — Same as Previous
- Promise handling: ✅ — Synchronous

#### Issues
- None identified.

---

### Button: FSRS Quality Rating Buttons
- **DOM**: `.flashcard-rate-btn` (multiple, with `data-quality` attribute)
- **File**: study.js line 5637
- **Handler**: async arrow function
- **Trace**: UI click → parse `data-quality` → get current question from `_flashcardQueue[_flashcardIndex]` → `rateSm2Silent(q.id, quality)` → `trackSessionAction()` (correct if quality >= 3, wrong otherwise) → `navigateFlashcard(1)` auto-advances

#### Static Analysis
- Element reference: ✅ — `document.querySelectorAll('.flashcard-rate-btn')` returns empty NodeList if none found; `.forEach` is safe on empty list
- Null safety: ✅ — `q` checked with `if (q && typeof rateSm2Silent === 'function')` at line 5640
- Error handling: ⚠️ — No try/catch around `await rateSm2Silent()` at line 5641; if it rejects, auto-advance won't happen
- Promise handling: ✅ — `await rateSm2Silent()` properly awaited

#### Issues
- **S2** — No try/catch around `await rateSm2Silent()`. If SM-2 persistence fails, `navigateFlashcard(1)` at line 5647 is never reached, leaving user stuck on current card.
- **S3** — `parseInt(btn.dataset.quality, 10)` could return `NaN` if `data-quality` attribute is missing.

---

### Button: Tab Dashboard (inside DOMContentLoaded, study-hub.js integration)
- **DOM**: `#tabDashboard` (second listener in `DOMContentLoaded` at line 5557)
- **File**: study.js line 5557
- **Handler**: inline arrow `() => { setTimeout(renderSubjectCards, 300); }`
- **Trace**: UI click → after 300ms delay, `renderSubjectCards()` builds subject progress cards in dashboard

#### Static Analysis
- Element reference: ✅ — guarded by `if (tabDashboardEl)` at line 5556
- Null safety: ✅ — Null check present
- Error handling: ⚠️ — `renderSubjectCards` may throw; `setTimeout` swallows errors
- Promise handling: ⚠️ — `renderSubjectCards` may be async; `setTimeout` doesn't handle promises

#### Issues
- **S3** — Errors inside `setTimeout(renderSubjectCards, 300)` are uncaught (not promise rejections, just thrown errors inside setTimeout callback).

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click Flashcard tab | Flashcard mode activated, first card shown | [Unverified] — requires browser runtime |
| Click Dashboard tab while in flashcard mode | Flashcard mode exited cleanly | [Unverified] — requires browser runtime |
| Click flip button | Card flips to show answer | [Unverified] — requires browser runtime |
| Click flashcard container | Card flips (same as button) | [Unverified] — requires browser runtime |
| Click next on last card | Wraps to first card | [Unverified] — requires browser runtime |
| Click prev on first card | Wraps to last card | [Unverified] — requires browser runtime |
| Click quality button (e.g., 5 = Easy) | SM-2 updated, auto-advances to next card | [Unverified] — requires browser runtime |
| Click quality button on empty queue | `q` is undefined; guard prevents crash | [Unverified] — requires browser runtime |
| SM-2 save fails during rating | Card stuck, no auto-advance | [Unverified] — requires browser runtime |
| Flashcard mode with 0 questions | Empty queue; `renderFlashcard` handles empty state | [Unverified] — requires browser runtime |
| `#tabFlashcards` missing from HTML | `initFlashcardMode` returns early | [Unverified] — requires browser runtime |
| `#flashcardFlip` missing | No flip handler attached (guarded) | [Unverified] — requires browser runtime |
| `#flashcardPrev` / `#flashcardNext` missing | Optional chaining prevents crash | [Unverified] — requires browser runtime |

## Overall Status: ✅ — Well-implemented with proper null guards, optional chaining, and guard clauses. One S2 issue: missing try/catch on `rateSm2Silent` could leave user stuck.
