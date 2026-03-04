# Study Page: Miscellaneous Buttons

Miscellaneous interactive elements: dark mode toggle, shortcuts modal, proxy clicks, new cards limit badge, manual add question, session summary, subject cards, done drawer toggle, subject group headers.

## Buttons in this group

### Button: Dark Mode Toggle
- **DOM**: `#darkModeToggle` (dynamically created in `initDarkMode()`)
- **File**: study.js line 4767
- **Handler**: inline arrow function
- **Trace**: UI click → toggle `.dark-mode` on `document.body` → persist to `localStorage` → update icon (light_mode / dark_mode)

#### Static Analysis
- Element reference: ✅ — created dynamically and appended; only listeners attached if element exists (inside `if (headerRight)` at line 4759)
- Null safety: ✅ — Element is freshly created
- Error handling: ✅ — `localStorage.setItem` is synchronous and rarely throws
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Shortcuts Modal Close
- **DOM**: `#shortcutsClose` (dynamically created in `toggleShortcutsModal()`)
- **File**: study.js line 4831
- **Handler**: inline arrow `() => modal.hidden = true`
- **Trace**: UI click → set `modal.hidden = true` → hides shortcuts modal

#### Static Analysis
- Element reference: ✅ — queried from freshly created modal at line 4831
- Null safety: ✅ — Element always exists in template
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Shortcuts Modal Overlay Click
- **DOM**: `#shortcutsModal` (dynamically created)
- **File**: study.js line 4832
- **Handler**: inline arrow `e => { if (e.target === modal) modal.hidden = true; }`
- **Trace**: UI click on backdrop → if target is the modal overlay → hides modal

#### Static Analysis
- Element reference: ✅ — `modal` reference from closure
- Null safety: ✅ — Target check prevents child click propagation
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Session Summary Modal Overlay Click
- **DOM**: `#sessionSummaryModal` (dynamically created in `showSessionSummary()`)
- **File**: study.js line 4883
- **Handler**: inline arrow `e => { if (e.target === modal) modal.hidden = true; }`
- **Trace**: UI click on backdrop → if target is the modal → hides session summary modal

#### Static Analysis
- Element reference: ✅ — `modal` reference from closure
- Null safety: ✅ — Target check present
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Proxy Click Handler (Sidebar)
- **DOM**: Any element with `[data-proxy-click]` attribute (document-level delegated listener)
- **File**: study.js line 1523
- **Handler**: inline arrow `event => { ... }`
- **Trace**: UI click anywhere → find closest `[data-proxy-click]` → get `data-proxy-click` attribute value → find target element by ID → programmatically `.click()` the target

#### Static Analysis
- Element reference: ✅ — Uses event delegation; no specific element reference needed
- Null safety: ✅ — Guards: `if (!proxyBtn) return` (line 1525), `if (!target) return` (line 1528)
- Error handling: ✅ — Synchronous; safe fallthrough
- Promise handling: ✅ — N/A

#### Issues
- None identified. Well-implemented delegation pattern.

---

### Button: New Cards Limit Badge
- **DOM**: `#newCardsLimitBadge`
- **File**: study.js line 2009
- **Handler**: async arrow function
- **Trace**: UI click → get current limit from storage → `prompt()` dialog → parse input → validate > 0 → persist to storage → `updateNewCardsLimitBadge()` → toast

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener` at line 2009
- Null safety: ✅ — Optional chaining prevents crash
- Error handling: ⚠️ — No try/catch around the async operations; `chrome.storage.local.get` and `chrome.storage.local.set` wrapped in Promise constructors but no catch
- Promise handling: ✅ — `await` used for both storage calls (lines 2010, 2015)

#### Issues
- **S3** — Uses `prompt()` which is blocking and non-styleable.
- **S3** — `parseInt(input)` could produce `NaN`; guarded by `if (n > 0)` which handles NaN (NaN > 0 is false).

---

### Button: Subject Group Header (Collapse/Expand)
- **DOM**: `.subject-group-header` (dynamically created in `buildSubjectHeader()`)
- **File**: study.js line 1717
- **Handler**: inline arrow function
- **Trace**: UI click → toggle `dataset.collapsed` between 'true'/'false' → update chevron icon → iterate sibling nodes until next header → toggle `.subject-collapsed` class

#### Static Analysis
- Element reference: ✅ — `header` is the element being created; always exists
- Null safety: ✅ — `header.querySelector('.subject-chevron')` will find the freshly created element
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified. Clean collapse/expand pattern.

---

### Button: Done Drawer Toggle
- **DOM**: `#doneDrwrToggle`
- **File**: study.js line 2535
- **Handler**: inline arrow function
- **Trace**: UI click → toggle `.open` on `#doneDrwr` → toggle `.hidden` on `#doneDrwrList` → update `aria-expanded` → set `dataset.manuallySet = 'true'`

#### Static Analysis
- Element reference: ✅ — guarded by `if (doneDrwrToggle)` at line 2534
- Null safety: ⚠️ — `document.getElementById('doneDrwr')` and `document.getElementById('doneDrwrList')` at lines 2536-2537 not null-checked; if missing, `.classList.toggle()` throws
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S2** — `#doneDrwr` and `#doneDrwrList` accessed without null guards at lines 2536-2537. If either element is missing, TypeError thrown.

---

### Button: Note Toggle (Card Personal Notes)
- **DOM**: `.card-note-toggle` (dynamically created in `injectNoteField()`)
- **File**: study.js line 4988
- **Handler**: async arrow function
- **Trace**: UI click → toggle `.hidden` on note content → update chevron icon → if opened and not yet loaded: `await loadNotes()` → populate textarea → set `loaded` flag

#### Static Analysis
- Element reference: ✅ — `toggle` obtained from freshly created section at line 4983
- Null safety: ✅ — Elements always exist in template
- Error handling: ⚠️ — No try/catch around `await loadNotes()` at line 4994; if storage read fails, error propagates
- Promise handling: ✅ — `await loadNotes()` properly awaited

#### Issues
- **S2** — No try/catch around `await loadNotes()`. If chrome.storage fails, the unhandled rejection propagates and textarea stays empty with no feedback.

---

### Button: Session Summary Button
- **DOM**: `#btnSessionSummary` (dynamically created in DOMContentLoaded)
- **File**: study.js line 5043
- **Handler**: `showSessionSummary` (named function, line 4867)
- **Trace**: UI click → calculate session stats → if no activity (revealed=0, total=0): return → create/update modal with stats grid → show modal

#### Static Analysis
- Element reference: ✅ — created dynamically; listener attached after creation (line 5043)
- Null safety: ✅ — `darkToggle` checked with `if (darkToggle)` at line 5041
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S3** — Silent no-op if `revealed === 0 && total === 0` (line 4873). User clicks button but nothing happens. Could show a "No activity yet" message instead.

---

### Button: Subject Cards (Dashboard Click-to-Filter)
- **DOM**: `.subject-progress-card` (dynamically created in `renderSubjectCards()`)
- **File**: study.js line 5464
- **Handler**: inline arrow function
- **Trace**: UI click → set `#subjectSelect` value to clicked subject → dispatch `change` event → click `#tabQuestions` to switch to question view

#### Static Analysis
- Element reference: ✅ — `card` is freshly created element
- Null safety: ✅ — `subjectSelect` checked with `if (subjectSelect)` at line 5466; `tabQuestions` checked with `if (tabQuestions)` at line 5471
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Sidebar Subject Items (Click-to-Filter)
- **DOM**: `.sidebar-subject-item` (dynamically created in `buildProfessionalSidebar()`)
- **File**: study.js line 5199
- **Handler**: inline arrow function
- **Trace**: UI click → update `.active` state on siblings → set `#subjectSelect` value → dispatch `change` event to trigger filter

#### Static Analysis
- Element reference: ✅ — queried from freshly created `wrapper` at line 5198
- Null safety: ✅ — `subjectSelect` checked with `if (subjectSelect)` at line 5206
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Manual Add Question — Open
- **DOM**: `#btnAddQuestion`
- **File**: study.js line 4405
- **Handler**: `openModal` (named function, line 4397)
- **Trace**: UI click → `resetForm()` → `populateFolders()` → remove `.hidden` from overlay → focus question textarea after 60ms

#### Static Analysis
- Element reference: ✅ — guarded by `if (!triggerBtn || !overlay) return` at line 4343
- Null safety: ✅ — Comprehensive early return
- Error handling: ✅ — Synchronous open; form reset is safe
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Manual Add Question — Close (X)
- **DOM**: `#maqCloseBtn`
- **File**: study.js line 4408
- **Handler**: `closeModal` (named function, line 4345)
- **Trace**: UI click → add `.hidden` to overlay

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener` at line 4408
- Null safety: ✅ — Optional chaining
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Manual Add Question — Cancel
- **DOM**: `#maqCancelBtn`
- **File**: study.js line 4409
- **Handler**: `closeModal` (same function)
- **Trace**: Same as Close

#### Static Analysis
- Same as Close button.

#### Issues
- None identified.

---

### Button: Manual Add Question — Overlay Click
- **DOM**: `#maqOverlay`
- **File**: study.js line 4410
- **Handler**: inline arrow `(e) => { if (e.target === overlay) closeModal(); }`
- **Trace**: UI click on backdrop → if target is overlay → `closeModal()`

#### Static Analysis
- Element reference: ✅ — `overlay` from closure, guarded by early return at line 4343
- Null safety: ✅ — Target check present
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Manual Add Question — Save
- **DOM**: `#maqSaveBtn`
- **File**: study.js line 4425
- **Handler**: `doSave` (named function, line 4427)
- **Trace**: UI click → validate question/answer → get folder/subject/source → build question node → `chrome.storage.local.get/set` to add to binder → toast → rebuild card list → close modal

#### Static Analysis
- Element reference: ✅ — Uses optional chaining `?.addEventListener` at line 4425
- Null safety: ✅ — Validates required fields at line 4435-4437
- Error handling: ⚠️ — `chrome.storage.local` operations use callback pattern without error handling
- Promise handling: ⚠️ — Mixed callback/Promise patterns inside `doSave`

#### Issues
- **S2** — No error handling for `chrome.storage.local.get/set` inside `doSave()`. If storage is full or fails, question appears saved but isn't persisted.

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click dark mode toggle | Theme switches, icon updates, preference saved | [Unverified] — requires browser runtime |
| Click shortcuts '?' key | Shortcuts modal appears with key list | [Unverified] — requires browser runtime |
| Click shortcuts close | Modal hides | [Unverified] — requires browser runtime |
| Click shortcuts overlay | Modal hides | [Unverified] — requires browser runtime |
| Click element with data-proxy-click | Target element's click triggered | [Unverified] — requires browser runtime |
| Click proxy with invalid target ID | No action (null guard) | [Unverified] — requires browser runtime |
| Click new cards limit badge | Prompt dialog for new limit | [Unverified] — requires browser runtime |
| Enter 0 or negative in limit prompt | No change (guard: n > 0) | [Unverified] — requires browser runtime |
| Click subject group header | Cards under header collapse/expand | [Unverified] — requires browser runtime |
| Click done drawer toggle | Drawer opens/closes with animation | [Unverified] — requires browser runtime |
| Click done drawer with missing `#doneDrwr` | TypeError thrown | [Unverified] — requires browser runtime |
| Click note toggle first time | Notes loaded from storage, textarea shown | [Unverified] — requires browser runtime |
| Click note toggle second time | Content hidden, no re-fetch | [Unverified] — requires browser runtime |
| Click session summary with no activity | No action (guard: revealed=0, total=0) | [Unverified] — requires browser runtime |
| Click session summary with activity | Stats modal shown | [Unverified] — requires browser runtime |
| Click subject card in dashboard | Filters by subject, switches to questions | [Unverified] — requires browser runtime |
| Click sidebar subject item | Subject filter applied | [Unverified] — requires browser runtime |
| Click manual add → fill → save | Question added to binder, card list rebuilt | [Unverified] — requires browser runtime |
| Click manual add → save without question | Error "Enunciado e resposta são obrigatórios" | [Unverified] — requires browser runtime |
| Click manual add → cancel | Modal closes, form reset | [Unverified] — requires browser runtime |
| Click manual add → overlay click | Modal closes | [Unverified] — requires browser runtime |
| Storage full during manual add save | Silent failure; question not persisted | [Unverified] — requires browser runtime |

## Overall Status: ⚠️ — Most buttons are well-guarded with null checks and optional chaining. Key concerns: done drawer toggle has missing null checks for child elements; note toggle and manual add save lack error handling for storage operations; session summary silently no-ops with no activity.
