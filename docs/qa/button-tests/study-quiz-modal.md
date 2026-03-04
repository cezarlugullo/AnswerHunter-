# Study Page: Quiz Modal

Quiz modal buttons for the interactive AI-generated similar question testing feature.

## Buttons in this group

### Button: Quiz Option Selection
- **DOM**: `.quiz-option` (dynamically created inside `#quizModalBody`)
- **File**: study.js line 2691
- **Handler**: inline arrow function inside `renderQuizQuestion()`
- **Trace**: UI click → guard: exit if `btn.disabled` → set `selectedLetter` → toggle `.selected` class on all options → update `aria-pressed` → enable confirm button

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered `quizModalBody.querySelectorAll('.quiz-option')` at line 2688
- Null safety: ✅ — `btn.dataset.letter` always present since rendered from template
- Error handling: ✅ — Synchronous, guard clause for disabled state
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Quiz Confirm Answer
- **DOM**: `#quizConfirmBtn` (dynamically created inside `#quizModalBody`)
- **File**: study.js line 2702
- **Handler**: inline arrow calling `revealQuizResult()`
- **Trace**: UI click → guard: exit if `!selectedLetter` → `revealQuizResult(selected, correct, optionBtns, questionText, optionsMap)` → disables all options → shows result banner → updates SM-2 for source question → shows footer with retry/close

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered modal body at line 2687
- Null safety: ✅ — Guard clause `if (!selectedLetter) return` at line 2703
- Error handling: ⚠️ — `revealQuizResult()` calls `rateSm2Silent()` (line 2713) without try/catch; if SM-2 update fails, no error handling
- Promise handling: ⚠️ — `rateSm2Silent()` appears async but is called without `await` in the synchronous `revealQuizResult()` function (line 2713); promise rejection silently swallowed

#### Issues
- **S2** — `rateSm2Silent()` at line 2713 is fire-and-forget; if it rejects, no error handling. Should be awaited or have `.catch()`.
- **S3** — `_quizState.current?.sourceQid` checked but `rateSm2Silent` called without await.

---

### Button: Quiz Modal Close (X button)
- **DOM**: `#quizModalClose`
- **File**: study.js line 2767
- **Handler**: `closeQuizModal` (named function, line 2617)
- **Trace**: UI click → remove `.open` class → restore `body.overflow` → after 220ms timeout: set `hidden` attribute, clear modal body, hide footer

#### Static Analysis
- Element reference: ⚠️ — `quizModalClose` obtained via `document.getElementById('quizModalClose')` at line 2598; no null check before `addEventListener` at line 2767
- Null safety: ⚠️ — If `#quizModalClose` element doesn't exist in HTML, line 2767 throws
- Error handling: ✅ — `closeQuizModal` is synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard: `quizModalClose.addEventListener(...)` at line 2767 will throw if element not found. Same applies to all quiz modal global references (lines 2593-2600).

---

### Button: Quiz Close (Footer)
- **DOM**: `#quizCloseFooterBtn`
- **File**: study.js line 2768
- **Handler**: `closeQuizModal` (same handler)
- **Trace**: Same as above

#### Static Analysis
- Element reference: ⚠️ — Same risk as `quizModalClose`: obtained at line 2599 without null check
- Null safety: ⚠️ — Same issue
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S1** — Same as Quiz Modal Close. No null guard before `addEventListener`.

---

### Button: Quiz Retry
- **DOM**: `#quizRetryBtn`
- **File**: study.js line 2769
- **Handler**: inline arrow checking `_quizState.current` → hides footer → calls `loadQuizQuestion()`
- **Trace**: UI click → guard: check `_quizState.current` → hide `quizModalFooter` → `loadQuizQuestion(_quizState.current.question)` → shows loading spinner → AI generates new question

#### Static Analysis
- Element reference: ⚠️ — Same pattern: `quizRetryBtn` at line 2600 without null check
- Null safety: ✅ — Guard `if (_quizState.current)` at line 2770
- Error handling: ✅ — `loadQuizQuestion` has try/catch internally (line 2628)
- Promise handling: ⚠️ — `loadQuizQuestion()` is async but not awaited at line 2772; any unhandled rejection is swallowed. However, `loadQuizQuestion` has internal try/catch so this is low risk.

#### Issues
- **S1** — No null guard on `quizRetryBtn` before addEventListener at line 2769.
- **S3** — `loadQuizQuestion()` not awaited (fire-and-forget). Safe due to internal error handling but not ideal.

---

### Button: Quiz Overlay Click
- **DOM**: `#quizOverlay`
- **File**: study.js line 2777
- **Handler**: inline arrow `e => { /* commented out: if (e.target === quizOverlay) closeQuizModal(); */ }`
- **Trace**: UI click → **NO ACTION** — the close-on-backdrop logic is commented out

#### Static Analysis
- Element reference: ⚠️ — `quizOverlay` at line 2593 without null check; addEventListener at line 2777 will throw if missing
- Null safety: ⚠️ — Same issue
- Error handling: ✅ — N/A (no-op)
- Promise handling: ✅ — N/A

#### Issues
- **S3** — Backdrop click is intentionally disabled (commented out). This is a design decision but means the only way to close is via X button, footer close, or ESC key. May be intended to prevent accidental dismissal.
- **S1** — No null guard on `quizOverlay` before addEventListener.

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click quiz option | Option highlighted, confirm enabled | [Unverified] — requires browser runtime |
| Click multiple options sequentially | Only last clicked is selected | [Unverified] — requires browser runtime |
| Click disabled option after reveal | No action | [Unverified] — requires browser runtime |
| Click confirm without selection | No action (guard clause) | [Unverified] — requires browser runtime |
| Click confirm with selection | Result banner shown, options styled correct/wrong | [Unverified] — requires browser runtime |
| Correct answer confirmed | Green banner, SM-2 updated with acerto | [Unverified] — requires browser runtime |
| Wrong answer confirmed | Red banner, SM-2 updated with erro | [Unverified] — requires browser runtime |
| Click retry after answering | New question generated, footer hidden | [Unverified] — requires browser runtime |
| Click retry when `_quizState.current` is null | No action (guard clause) | [Unverified] — requires browser runtime |
| Click X button to close | Modal animates out, body scroll restored | [Unverified] — requires browser runtime |
| Click overlay background | No action (commented out) | [Unverified] — requires browser runtime |
| Press ESC while quiz open | Modal closes | [Unverified] — requires browser runtime |
| Quiz modal elements missing from HTML | TypeError thrown at module level | [Unverified] — requires browser runtime |
| `rateSm2Silent` rejects | Silent failure, no user-visible error | [Unverified] — requires browser runtime |

## Overall Status: ⚠️ — All quiz modal DOM references (lines 2593-2600) lack null guards; if any element is missing from HTML, the script crashes at module load. `rateSm2Silent` is fire-and-forget.
