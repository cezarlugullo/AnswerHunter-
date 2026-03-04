# Study Page: Dashboard Buttons

Dashboard action buttons, protocol buttons, navigation tabs, and modal controls.

## Buttons in this group

### Button: Continue (Continuar de onde parou)
- **DOM**: `#dashActionContinue` (dynamically rendered inside dashboard HTML)
- **File**: study.js line 3834
- **Handler**: inline arrow function
- **Trace**: UI click → `exitDashboard()` → find first unanswered visible card (or first visible card) → `scrollIntoView()` → flash outline for 1.5s

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener` at line 3834
- Null safety: ✅ — `target` checked with `if (target)` at line 3838
- Error handling: ✅ — Synchronous, no async risk
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Review Due (Revisar hoje)
- **DOM**: `#dashActionReviewDue` (dynamically rendered)
- **File**: study.js line 3845
- **Handler**: async arrow function
- **Trace**: UI click → `exitDashboard()` → find SM-2 due chip → if not active, programmatically click it

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener` at line 3845
- Null safety: ✅ — `chip` checked with `if (chip && !chip.classList.contains('active'))` at line 3848
- Error handling: ⚠️ — Handler is async but has no try/catch; `.click()` on the chip triggers its own async handler
- Promise handling: ⚠️ — The `async` keyword on the handler is unnecessary since no await is used

#### Issues
- **S3** — Handler marked `async` but performs no awaits; unnecessary but harmless.

---

### Button: Review Errors (Revisar erros)
- **DOM**: `#dashActionReviewErrors` (dynamically rendered)
- **File**: study.js line 3851
- **Handler**: async arrow function
- **Trace**: UI click → `exitDashboard()` → find errors chip → if not active, programmatically click it

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener`
- Null safety: ✅ — `chip` null-checked at line 3854
- Error handling: ⚠️ — Same as Review Due; async without await
- Promise handling: ⚠️ — Same

#### Issues
- **S3** — Same as Review Due.

---

### Button: Generate Simulado (Gerar simulado)
- **DOM**: `#dashActionSim` (dynamically rendered)
- **File**: study.js line 3857
- **Handler**: inline arrow function
- **Trace**: UI click → `exitDashboard()` → programmatically click `#btnSimulado`

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener`
- Null safety: ✅ — `?.click()` on `#btnSimulado` at line 3859
- Error handling: ✅ — Synchronous proxy click
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Open Questions (Ver questões)
- **DOM**: `#dashActionOpenQuestions` (dynamically rendered)
- **File**: study.js line 3862
- **Handler**: inline arrow calling `exitDashboard()`
- **Trace**: UI click → `exitDashboard()` → switches to study view or closes dashboard

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener`
- Null safety: ✅ — N/A
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Protocol — Revisão espaçada (Spacing)
- **DOM**: `#dashProtocolSpacing` (dynamically rendered)
- **File**: study.js line 3866
- **Handler**: inline arrow `() => runEvidenceProtocol('spacing')`
- **Trace**: UI click → `runEvidenceProtocol('spacing')` → applies spacing-based study protocol

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener`
- Null safety: ✅ — N/A
- Error handling: ⚠️ — Depends on `runEvidenceProtocol` error handling
- Promise handling: ⚠️ — `runEvidenceProtocol` may be async but not awaited

#### Issues
- **S3** — If `runEvidenceProtocol` is async, it's fire-and-forget.

---

### Button: Protocol — Recuperação ativa (Retrieval)
- **DOM**: `#dashProtocolRetrieval`
- **File**: study.js line 3867
- **Handler**: inline arrow `() => runEvidenceProtocol('retrieval')`
- **Trace**: Same pattern as spacing protocol

#### Static Analysis
- Same as Protocol Spacing

#### Issues
- Same as Protocol Spacing.

---

### Button: Protocol — Intercalar matérias (Interleaving)
- **DOM**: `#dashProtocolInterleaving`
- **File**: study.js line 3868
- **Handler**: inline arrow `() => runEvidenceProtocol('interleaving')`

#### Static Analysis / Issues
- Same as Protocol Spacing.

---

### Button: Protocol — Priorizar erros (Error-First)
- **DOM**: `#dashProtocolErrorFirst`
- **File**: study.js line 3869
- **Handler**: inline arrow `() => runEvidenceProtocol('error-first')`

#### Static Analysis / Issues
- Same as Protocol Spacing.

---

### Button: Protocol — Bloco de foco (Focus/Pomodoro)
- **DOM**: `#dashProtocolFocus`
- **File**: study.js line 3870
- **Handler**: inline arrow `() => runEvidenceProtocol('focus')`

#### Static Analysis / Issues
- Same as Protocol Spacing.

---

### Button: Dashboard Toggle (Toolbar)
- **DOM**: `#btnDashboard` (referenced as `btnDashboard`)
- **File**: study.js line 3874
- **Handler**: inline arrow function
- **Trace**: UI click → if already in dashboard view: `setMainView('study', { rerender: false })` → else `openDashboard()`

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `btnDashboard?.addEventListener` at line 3874
- Null safety: ✅ — Optional chaining
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Tab Dashboard
- **DOM**: `#tabDashboard` (referenced as `tabDashboard`)
- **File**: study.js line 3879
- **Handler**: inline arrow `() => setMainView('dashboard')`
- **Trace**: UI click → `setMainView('dashboard')` → shows dashboard panel, updates tab active state

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `tabDashboard?.addEventListener` at line 3879
- Null safety: ✅ — Optional chaining
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Tab Questions
- **DOM**: `#tabQuestions` (referenced as `tabQuestions`)
- **File**: study.js line 3880
- **Handler**: inline arrow `() => setMainView('study', { rerender: false })`
- **Trace**: UI click → `setMainView('study')` → shows question list panel, updates tab active state

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `tabQuestions?.addEventListener`
- Null safety: ✅ — Optional chaining
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Dashboard Close (X button)
- **DOM**: `#dashCloseBtn` (referenced as `dashCloseBtn`)
- **File**: study.js line 3882
- **Handler**: `closeDashboard` (named function)
- **Trace**: UI click → `closeDashboard()` → sets main view to study

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `dashCloseBtn?.addEventListener`
- Null safety: ✅ — Optional chaining
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Dashboard Back
- **DOM**: `#dashBackBtn` (referenced as `dashBackBtn`)
- **File**: study.js line 3883
- **Handler**: `closeDashboard` (named function)
- **Trace**: Same as Dashboard Close

#### Static Analysis
- Same as Dashboard Close. Optional chaining used.

#### Issues
- None identified.

---

### Button: Dashboard Overlay Click
- **DOM**: `#dashOverlay` (referenced as `dashOverlay`)
- **File**: study.js line 3884
- **Handler**: inline arrow `e => { if (e.target === dashOverlay) closeDashboard(); }`
- **Trace**: UI click on backdrop → if target is the overlay itself → `closeDashboard()`

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `dashOverlay?.addEventListener`
- Null safety: ✅ — Guard `e.target === dashOverlay` prevents child click propagation
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified. Properly checks target === overlay.

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click "Continue" with unanswered cards | Scrolls to first unanswered card | [Unverified] — requires browser runtime |
| Click "Continue" with all cards answered | Scrolls to first visible card | [Unverified] — requires browser runtime |
| Click "Continue" with 0 visible cards | `target` is null; no scroll, no crash | [Unverified] — requires browser runtime |
| Click "Review Due" | SM-2 due chip activated, cards filtered | [Unverified] — requires browser runtime |
| Click "Review Errors" | Errors chip activated, cards filtered | [Unverified] — requires browser runtime |
| Click "Generate Simulado" | Simulado modal opens | [Unverified] — requires browser runtime |
| Click "Open Questions" | Dashboard exits, question view shown | [Unverified] — requires browser runtime |
| Click Protocol Spacing | Evidence-based protocol applied | [Unverified] — requires browser runtime |
| Click Protocol Retrieval | Retrieval practice protocol applied | [Unverified] — requires browser runtime |
| Click Dashboard tab | Dashboard view shown | [Unverified] — requires browser runtime |
| Click Questions tab | Question list view shown | [Unverified] — requires browser runtime |
| Click Dashboard toggle when in dashboard | Switches to study view | [Unverified] — requires browser runtime |
| Click Dashboard toggle when in study | Opens dashboard | [Unverified] — requires browser runtime |
| Click dashboard close X | Dashboard closes | [Unverified] — requires browser runtime |
| Click dashboard overlay background | Dashboard closes | [Unverified] — requires browser runtime |
| Click child element inside overlay | No action (target check) | [Unverified] — requires browser runtime |
| Press ESC while dashboard open | Dashboard closes | [Unverified] — requires browser runtime |

## Overall Status: ✅ — All dashboard buttons use optional chaining (`?.addEventListener`) consistently. Well-implemented pattern with proper null safety throughout.
