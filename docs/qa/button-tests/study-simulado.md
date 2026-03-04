# Study Page: Simulado (Timed Practice Exam)

Buttons for the simulado (timed practice exam) feature including setup, question navigation, and results.

## Buttons in this group

### Button: Simulado Toolbar Trigger
- **DOM**: `#btnSimulado`
- **File**: study.js line 3100
- **Handler**: inline arrow function
- **Trace**: UI click → guard: `allQuestions.length === 0` → `alert()` → else `openSimulado()` → opens overlay → renders setup screen

#### Static Analysis
- Element reference: ⚠️ — `btnSimulado` obtained via `document.getElementById('btnSimulado')` at line 2792; no null check before `addEventListener` at line 3100
- Null safety: ⚠️ — If `#btnSimulado` is missing, line 3100 throws
- Error handling: ✅ — Guard for empty questions with `alert()`
- Promise handling: ✅ — `openSimulado()` is synchronous

#### Issues
- **S1** — No null guard on `btnSimulado` before addEventListener.
- **S3** — Uses `alert()` instead of toast for empty questions notification.

---

### Button: Discipline Selection Pills
- **DOM**: `#simDiscGrid .sim-option-pill` (dynamically created in `renderSimSetup()`)
- **File**: study.js line 2891
- **Handler**: inline arrow function
- **Trace**: UI click → remove `.selected` from siblings → add `.selected` to clicked → update `selectedDiscipline` → `rebuildCountGrid(pool)` to update available counts

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered `simModalBody` at line 2890
- Null safety: ✅ — `btn.dataset.disc` always present from template
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Count Selection Pills
- **DOM**: `#simCountGrid .sim-option-pill` (dynamically created in `renderSimSetup()`)
- **File**: study.js line 2904
- **Handler**: inline arrow function
- **Trace**: UI click → remove `.selected` from siblings → add `.selected` → update `selectedCount` via `parseInt(btn.dataset.count)`

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered modal body at line 2903
- Null safety: ✅ — `btn.dataset.count` always present from template
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S3** — `parseInt(btn.dataset.count)` could produce `NaN` if data attribute is malformed; no validation.

---

### Button: Count Selection Pills (inside rebuildCountGrid)
- **DOM**: `#simCountGrid .sim-option-pill` (rebuilt dynamically)
- **File**: study.js line 2881
- **Handler**: inline arrow function (same pattern as above)
- **Trace**: Same as count pills; these are re-rendered when discipline changes

#### Static Analysis
- Element reference: ✅ — freshly rendered
- Null safety: ✅ — Same
- Error handling: ✅ — Same
- Promise handling: ✅ — N/A

#### Issues
- None beyond parent issues.

---

### Button: Time Selection Pills
- **DOM**: `#simTimeGrid .sim-option-pill` (dynamically created in `renderSimSetup()`)
- **File**: study.js line 2913
- **Handler**: inline arrow function
- **Trace**: UI click → remove `.selected` from siblings → add `.selected` → update `selectedTime` via `parseInt(btn.dataset.time)`

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered modal body at line 2912
- Null safety: ✅ — `btn.dataset.time` always present from template
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Start Simulado
- **DOM**: `#simStartBtn` (dynamically created in `renderSimSetup()`)
- **File**: study.js line 2920
- **Handler**: inline arrow calling `startSimulado(selectedCount, selectedTime, selectedDiscipline)`
- **Trace**: UI click → `startSimulado()` → filter questions by discipline → shuffle → pick N → `renderSimQuestion()` → start timer interval

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered `simModalBody` at line 2920
- Null safety: ✅ — Relies on closure variables `selectedCount`, `selectedTime`, `selectedDiscipline`
- Error handling: ⚠️ — No try/catch; if `renderSimQuestion()` fails, timer starts but no question shown
- Promise handling: ✅ — `startSimulado` is synchronous

#### Issues
- **S2** — No guard for edge case where filtered pool has 0 questions after discipline filter. `[...pool].sort(...).slice(0, n)` returns empty array, `renderSimQuestion()` will access `questions[0]` which is `undefined`, causing `cleanQ = sanitizeQuestionText(undefined.question)` → TypeError.

---

### Button: Reveal Gabarito (Answer)
- **DOM**: `#simRevealBtn` (dynamically created in `renderSimQuestion()`)
- **File**: study.js line 3012
- **Handler**: inline arrow function
- **Trace**: UI click → show `#simAnswerBox` (add `.show`) → show `#simSelfAssess` (add `.show`) → hide reveal button

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered `simModalBody` at line 3012
- Null safety: ✅ — Elements always present in template
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Sim Correct (Acertei)
- **DOM**: `#simCorrectBtn` (dynamically created in `renderSimQuestion()`)
- **File**: study.js line 3019
- **Handler**: inline arrow `() => recordSimResult(true)`
- **Trace**: UI click → `recordSimResult(true)` → push result → increment index → if last question: `finishSimulado()`, else `renderSimQuestion()`

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered `simModalBody`
- Null safety: ✅ — `_sim.questions[idx]` should exist since idx is bounded
- Error handling: ⚠️ — No try/catch in `recordSimResult`; `renderSimQuestion()` could fail
- Promise handling: ✅ — Synchronous

#### Issues
- None critical.

---

### Button: Sim Wrong (Errei)
- **DOM**: `#simWrongBtn` (dynamically created in `renderSimQuestion()`)
- **File**: study.js line 3020
- **Handler**: inline arrow `() => recordSimResult(false)`
- **Trace**: Same as Correct but with `isCorrect = false`

#### Static Analysis
- Same as Sim Correct

#### Issues
- None critical.

---

### Button: Sim Result Close
- **DOM**: `#simResultCloseBtn` (dynamically created in `finishSimulado()`)
- **File**: study.js line 3095
- **Handler**: `closeSimulado` (named function, line 2808)
- **Trace**: UI click → `clearInterval(_sim.timerInterval)` → remove `.open` class → restore body scroll → after 220ms: set `hidden` attribute

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered `simModalBody`
- Null safety: ✅ — `clearInterval` handles null/undefined safely
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Sim Result Retry (New Simulado)
- **DOM**: `#simResultRetryBtn` (dynamically created in `finishSimulado()`)
- **File**: study.js line 3096
- **Handler**: `renderSimSetup` (named async function, line 2815)
- **Trace**: UI click → re-renders setup screen with discipline/count/time selection

#### Static Analysis
- Element reference: ✅ — queried from freshly rendered `simModalBody`
- Null safety: ✅ — `renderSimSetup` rebuilds everything
- Error handling: ⚠️ — `renderSimSetup` is async but called without await; any rejection is unhandled
- Promise handling: ⚠️ — Fire-and-forget async call. `renderSimSetup` is async due to internal operations, but the click handler doesn't await it.

#### Issues
- **S3** — `renderSimSetup` is async but invoked as fire-and-forget from click handler at line 3096. Low risk since it mainly does DOM manipulation.

---

### Button: Sim Close (X button)
- **DOM**: `#simCloseBtn`
- **File**: study.js line 3109
- **Handler**: `closeSimulado` (named function)
- **Trace**: Same as Sim Result Close

#### Static Analysis
- Element reference: ⚠️ — `simCloseBtn` obtained at line 2791; no null check before addEventListener at line 3109
- Null safety: ⚠️ — If `#simCloseBtn` missing, throws
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `simCloseBtn` before addEventListener at line 3109.

---

### Button: Sim Overlay Click
- **DOM**: `#simOverlay`
- **File**: study.js line 3112
- **Handler**: inline arrow `e => { /* commented out: if (e.target === simOverlay) closeSimulado(); */ }`
- **Trace**: UI click → **NO ACTION** — backdrop close is commented out

#### Static Analysis
- Element reference: ⚠️ — `simOverlay` obtained at line 2788; no null check before addEventListener
- Null safety: ⚠️ — If `#simOverlay` missing, throws
- Error handling: ✅ — N/A (no-op)
- Promise handling: ✅ — N/A

#### Issues
- **S3** — Backdrop click disabled by commented-out code. Design decision to prevent accidental dismissal during timed exam.
- **S1** — No null guard on `simOverlay` before addEventListener.

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click simulado with 0 questions | Alert "Nenhuma questão disponível" | [Unverified] — requires browser runtime |
| Select discipline → count grid updates | Count grid rebuilds with filtered pool | [Unverified] — requires browser runtime |
| Select "all" discipline | Full question pool available | [Unverified] — requires browser runtime |
| Start simulado with 10 questions, 10 min | Timer starts, first question shown | [Unverified] — requires browser runtime |
| Click reveal → correct/wrong buttons appear | Self-assessment buttons shown, reveal hidden | [Unverified] — requires browser runtime |
| Click "Acertei" | Result recorded, next question shown | [Unverified] — requires browser runtime |
| Click "Errei" | Result recorded, next question shown | [Unverified] — requires browser runtime |
| Complete all questions | Results screen with score circle shown | [Unverified] — requires browser runtime |
| Timer expires during exam | Auto-finish, results shown | [Unverified] — requires browser runtime |
| Click retry on results | Setup screen re-rendered | [Unverified] — requires browser runtime |
| Click close during exam | Timer cleared, overlay closes | [Unverified] — requires browser runtime |
| Click overlay background | No action (commented out) | [Unverified] — requires browser runtime |
| Filter discipline with 0 matching questions | Start button click → TypeError on undefined.question | [Unverified] — requires browser runtime |
| Start with "no time limit" option | Timer counts up, never auto-finishes | [Unverified] — requires browser runtime |
| Score 100% → "Parabéns, gabaritou!" shown | Green pill with trophy emoji | [Unverified] — requires browser runtime |
| Sim modal elements missing from HTML | TypeError at module level | [Unverified] — requires browser runtime |

## Overall Status: ⚠️ — Global DOM references (`simOverlay`, `simCloseBtn`, `btnSimulado`) lack null guards. Edge case where filtered pool is empty not handled in `startSimulado`.
