# Study Page: Card Actions

Per-card interactive buttons rendered inside each question card via `buildCard()`.

## Buttons in this group

### Button: Reveal Answer
- **DOM**: `.reveal-btn` (inside each `.card` article)
- **File**: study.js line 774
- **Handler**: inline arrow `() => revealCard(article)`
- **Trace**: UI click → `revealCard(card)` → hides reveal-btn, shows `.card-answer`, marks options correct/wrong, persists SM-2 data, updates progress bar

#### Static Analysis
- Element reference: ⚠️ — `article.querySelector('.reveal-btn')` with no null check; will throw if element missing
- Null safety: ❌ — No optional chaining; crashes if `.reveal-btn` absent from card HTML
- Error handling: ✅ — `revealCard` is synchronous, no async risk
- Promise handling: ✅ — N/A (sync)

#### Issues
- **S1** — No null guard on `querySelector('.reveal-btn')` at line 774. If card template changes and `.reveal-btn` is removed, `addEventListener` throws `TypeError: Cannot read properties of null`.

---

### Button: Explanation (AI Tutor)
- **DOM**: `.btn-explanation` (inside card)
- **File**: study.js line 780
- **Handler**: async arrow function
- **Trace**: UI click → toggle `.visible` on `.answer-explanation` → if no cached content, call `ApiService.generateTutorExplanation()` → render formatted HTML → loading spinner hide

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnExplanation)` at line 779
- Null safety: ⚠️ — `exp.querySelector('.explanation-content')` and `.explanation-loading` accessed without null check (line 782-783); relies on HTML structure being correct
- Error handling: ✅ — `try/catch` wraps the `await ApiService.generateTutorExplanation()` call (lines 798-811)
- Promise handling: ✅ — Properly `await`ed inside async handler

#### Issues
- **S2** — If `.answer-explanation` child elements are missing (`.explanation-content`, `.explanation-loading`), lines 782-783 will throw. Low probability since HTML is templated.

---

### Button: Review Card (AI Summary)
- **DOM**: `.btn-review` (inside card)
- **File**: study.js line 822
- **Handler**: async arrow function
- **Trace**: UI click → toggle `.visible` on `.answer-review` → if no cached content, call `ApiService.generateReviewCard()` → render formatted HTML

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnReview)` at line 821
- Null safety: ⚠️ — Same pattern as explanation: inner selectors `.review-content` / `.review-loading` not null-checked
- Error handling: ✅ — `try/catch` with `finally` block (lines 839-856)
- Promise handling: ✅ — Properly `await`ed

#### Issues
- **S3** — Minor: no user-visible toast on error, just inline HTML fallback message.

---

### Button: Mark for Review Later
- **DOM**: `.btn-review-card` (inside card)
- **File**: study.js line 863
- **Handler**: async arrow function
- **Trace**: UI click → toggle `.for-review` class → `updateReviewChipCounter()` → `filterCards()` → `persistReviewLaterState()` → if save fails, revert state and show toast

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnReviewCard)` at line 862
- Null safety: ✅ — Uses `q.id`, `q.question` from closure; safe
- Error handling: ✅ — Checks `saved` return value and reverts on failure (lines 870-876)
- Promise handling: ✅ — `await persistReviewLaterState()` properly awaited

#### Issues
- None identified. Excellent rollback pattern.

---

### Button: Test Learning (Quiz)
- **DOM**: `.btn-test-learning` (inside card)
- **File**: study.js line 884
- **Handler**: inline arrow `() => openQuizModal(cleanQuestion, cleanAnswer, q.id)`
- **Trace**: UI click → `openQuizModal()` → opens quiz overlay → calls `loadQuizQuestion()` → AI generates similar question

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnTest)` at line 883
- Null safety: ✅ — `cleanQuestion`, `cleanAnswer`, `q.id` from closure
- Error handling: ✅ — Error handling is in `loadQuizQuestion()` which has try/catch
- Promise handling: ✅ — `openQuizModal` handles async internally

#### Issues
- None identified.

---

### Button: Chat Doubt (Toggle Panel)
- **DOM**: `.btn-chat-doubt` (inside card)
- **File**: study.js line 899
- **Handler**: inline arrow toggling `.visible` class on `.answer-chat`
- **Trace**: UI click → toggle chat panel visibility → focus textarea if opened

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnChat)` at line 890
- Null safety: ⚠️ — `chatPanel`, `chatMessages`, `chatTextarea`, `chatSendBtn`, `chatClearBtn` queried at lines 891-895 without individual null checks; if any element is missing, later usage crashes
- Error handling: ✅ — Toggle is synchronous, no async risk in toggle handler
- Promise handling: ✅ — N/A for toggle; `sendChatMessage` (line 920) has try/catch

#### Issues
- **S2** — No individual null checks for `chatTextarea`, `chatSendBtn`, `chatClearBtn` at lines 892-895. If `.answer-chat` exists but child elements are missing, runtime error.

---

### Button: Chat Send
- **DOM**: `.chat-send-btn` (inside card's chat panel)
- **File**: study.js line 920
- **Handler**: `sendChatMessage` (named function, line 932)
- **Trace**: UI click → read textarea → append user bubble → disable input → show typing indicator → `ApiService.answerFollowUp()` → append AI response → re-enable input

#### Static Analysis
- Element reference: ✅ — obtained from closure in `btnChat` block
- Null safety: ✅ — Early return if `!userMsg` (line 934)
- Error handling: ✅ — `try/catch/finally` wraps the API call (lines 953-968)
- Promise handling: ✅ — `await ApiService.answerFollowUp()` properly awaited

#### Issues
- None identified.

---

### Button: Chat Clear
- **DOM**: `.chat-clear-btn` (inside card's chat panel)
- **File**: study.js line 923
- **Handler**: inline arrow resetting `chatHistory` and restoring empty state HTML
- **Trace**: UI click → clear `chatHistory` array → replace chat messages innerHTML with empty state

#### Static Analysis
- Element reference: ✅ — from closure
- Null safety: ✅ — Simple assignment
- Error handling: ✅ — Synchronous, no risk
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Copy Card
- **DOM**: `.btn-copy-card` (inside card)
- **File**: study.js line 972
- **Handler**: async arrow with `(e)` parameter
- **Trace**: UI click → read question/answer/explanation text → `navigator.clipboard.writeText()` → flash check icon for 2s

#### Static Analysis
- Element reference: ⚠️ — `article.querySelector('.btn-copy-card')` at line 972 with **no null check**; will throw if missing
- Null safety: ⚠️ — `article.querySelector('.card-question').innerText` not null-checked; `.answer-explanation` is checked with ternary
- Error handling: ✅ — `try/catch` around clipboard API (lines 981-992)
- Promise handling: ✅ — `await navigator.clipboard.writeText()` properly awaited

#### Issues
- **S1** — No null guard on `querySelector('.btn-copy-card')` at line 972. If element missing, `addEventListener` throws.
- **S2** — `querySelector('.card-question')` could return null; `.innerText` would throw.

---

### Button: Edit Answer Key
- **DOM**: `.btn-edit-answer` (inside card)
- **File**: study.js line 997
- **Handler**: async arrow function
- **Trace**: UI click → check if options exist → show `prompt()` dialog → validate letter → `persistAnswerKeyState()` → update DOM → re-reveal if already answered

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnEditAnswer)` at line 996
- Null safety: ✅ — Uses optional chaining for `targetOption?.textContent` (line 1026) and `selectedEl?.dataset` (line 1051)
- Error handling: ⚠️ — No try/catch around `persistAnswerKeyState()` (line 1031); if it throws, handler crashes
- Promise handling: ✅ — `await persistAnswerKeyState()` properly awaited

#### Issues
- **S2** — No try/catch around `persistAnswerKeyState()`. If storage write fails with exception (vs returning false), the handler throws unhandled.
- **S3** — Uses `prompt()` which is blocking and non-styleable; functional but UX concern.

---

### Button: Delete Card
- **DOM**: `.btn-delete-card` (inside card)
- **File**: study.js line 1060
- **Handler**: async arrow function
- **Trace**: UI click → `confirm()` dialog → `chrome.storage.local.get(['binderStructure'])` → recursive `removeFromTree()` → `chrome.storage.local.set()`

#### Static Analysis
- Element reference: ⚠️ — `article.querySelector('.btn-delete-card')` at line 1060 with **no null check**; will throw if missing
- Null safety: ✅ — Checks `Array.isArray(data)` before iterating (line 1065)
- Error handling: ⚠️ — No error callback on `chrome.storage.local.get/set`; no try/catch around the operation
- Promise handling: ⚠️ — Uses callback-based `chrome.storage.local.get()` instead of Promise; not `await`ed. The `async` on the handler is unused.

#### Issues
- **S1** — No null guard on `querySelector('.btn-delete-card')` at line 1060.
- **S1** — Card article is not removed from DOM after deletion. User sees deleted card until page reload.
- **S2** — `confirm()` is the only guard before destructive deletion; no undo mechanism.
- **S2** — No toast/feedback after successful deletion.

---

### Button: Voice (TTS)
- **DOM**: `.btn-voice` (inside card)
- **File**: study.js line 1089
- **Handler**: inline arrow `() => speakText(cleanQuestion, btnVoice)`
- **Trace**: UI click → `speakText()` → Web Speech API or TTS service → button style changes to "speaking"

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnVoice)` at line 1088
- Null safety: ✅ — `cleanQuestion` from closure is always a string
- Error handling: ⚠️ — Error handling depends on `speakText()` implementation (not analyzed in detail here)
- Promise handling: ✅ — `speakText` appears synchronous in its invocation

#### Issues
- None critical. TTS error handling depends on `speakText()` internals.

---

### Button: Tags (AI Auto-Tag)
- **DOM**: `.btn-tags` (inside card)
- **File**: study.js line 1107
- **Handler**: async arrow function
- **Trace**: UI click → `generateTagsForCardElement(article)` → AI generates tags → render tags → refresh subject organization

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnTags && tagsContainer && q.id)` at line 1097
- Null safety: ✅ — Pre-checked
- Error handling: ⚠️ — No try/catch in handler; relies on `generateTagsForCardElement` not throwing
- Promise handling: ✅ — `await generateTagsForCardElement()` properly awaited

#### Issues
- **S2** — If `generateTagsForCardElement` throws, the error is unhandled. Should wrap in try/catch.
- **S3** — `refreshSubjectOrganizationAfterTags()` called without await; fire-and-forget if async.

---

### Button: SM-2 Rating Buttons (0-5)
- **DOM**: `.sm2-btn` (inside `.sm2-rating-bar`, multiple per card)
- **File**: study.js line 1117
- **Handler**: inline arrow calling `rateSm2(q.id, quality, sm2Bar, doneEl)`
- **Trace**: UI click → parse `data-quality` → `rateSm2()` → updates SM-2 parameters → persists to storage → visual feedback

#### Static Analysis
- Element reference: ✅ — guarded by `if (sm2Bar && q.id)` at line 1115
- Null safety: ⚠️ — `article.querySelector('#sm2Done_${q.id}')` could return null if element ID doesn't exist; passed to `rateSm2` which must handle it
- Error handling: ⚠️ — No try/catch; depends on `rateSm2` error handling
- Promise handling: ⚠️ — `rateSm2` may be async but is not awaited here

#### Issues
- **S2** — `parseInt(btn.dataset.quality)` can return `NaN` if `data-quality` is missing; no validation.
- **S3** — `rateSm2` is called without await in a non-async handler; any promise rejection is silently swallowed.

---

### Button: JOL Confidence Buttons
- **DOM**: `.jol-btn` (inside JOL bar, multiple per card)
- **File**: study.js line 1131
- **Handler**: inline arrow setting `userConfidence` and toggling `.selected` class
- **Trace**: UI click → set `userConfidence` variable → remove `.selected` from siblings → add `.selected` to clicked → add `.jol-ready` to reveal button

#### Static Analysis
- Element reference: ✅ — guarded by `if (jolBar)` at line 1129
- Null safety: ✅ — Uses optional chaining-like pattern; `revealBtn` checked at line 1137
- Error handling: ✅ — Synchronous, no risk
- Promise handling: ✅ — N/A

#### Issues
- None identified.

---

### Button: Why Wrong (Por que errei?)
- **DOM**: `.btn-why-wrong` (inside card)
- **File**: study.js line 1151
- **Handler**: async arrow function
- **Trace**: UI click → toggle panel visibility → if no cached content, get selected/correct options → `PedagogicalPromptsService.generateWhyWrong()` → render markdown analysis

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnWhyWrong && whyWrongPanel)` at line 1150
- Null safety: ✅ — Uses optional chaining: `selectedEl?.dataset.letter`, `correctEl?.textContent` (lines 1162-1166)
- Error handling: ✅ — `try/catch/finally` wraps AI call (lines 1160-1178)
- Promise handling: ✅ — `await PedagogicalPromptsService.generateWhyWrong()` properly awaited

#### Issues
- None identified. Well-structured handler.

---

### Button: Socratic Hint (Dica)
- **DOM**: `.btn-hint` (inside card)
- **File**: study.js line 1218
- **Handler**: async arrow function
- **Trace**: UI click → toggle hint panel → if first time, call `loadHint()` → `PedagogicalPromptsService.generateSocraticHint()` → render markdown → show "next hint" button if level < 3

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnHint && hintPanel)` at line 1187
- Null safety: ✅ — Child elements queried within guarded block
- Error handling: ✅ — `try/catch/finally` in `loadHint()` (lines 1198-1215)
- Promise handling: ✅ — `await loadHint()` at line 1222

#### Issues
- None identified.

---

### Button: Next Hint
- **DOM**: `.btn-next-hint` (inside hint panel)
- **File**: study.js line 1226
- **Handler**: `loadHint` (named async function)
- **Trace**: UI click → increment hint level (max 3) → `PedagogicalPromptsService.generateSocraticHint()` → update hint content → hide button at level 3

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnNextHint)` at line 1225
- Null safety: ✅ — Level clamped with `Math.min`
- Error handling: ✅ — Handled within `loadHint` try/catch
- Promise handling: ✅ — `loadHint` is async and properly structured

#### Issues
- None identified.

---

### Button: Mnemonic
- **DOM**: `.btn-mnemonic` (inside card)
- **File**: study.js line 1236
- **Handler**: async arrow function
- **Trace**: UI click → toggle panel → if no cached content, `PedagogicalPromptsService.extractConceptTag()` → `PedagogicalPromptsService.generateMnemonic()` → render emoji + text + type + how-to-use

#### Static Analysis
- Element reference: ✅ — guarded by `if (btnMnemonic && mnemonicPanel)` at line 1233
- Null safety: ✅ — Uses fallbacks: `result.emoji || '🧠'`, `result.type || 'associação'`
- Error handling: ✅ — `try/catch/finally` wraps both AI calls (lines 1243-1258)
- Promise handling: ✅ — Both `await` calls properly sequenced

#### Issues
- **S3** — Two sequential AI calls (`extractConceptTag` then `generateMnemonic`); if first succeeds but second fails, no partial result is shown. Minor UX concern.

---

### Button: AI Strip Toggle
- **DOM**: `.ai-strip-toggle` (inside card)
- **File**: study.js line 766
- **Handler**: inline arrow toggling `.collapsed` on `.ai-tools-grid`
- **Trace**: UI click → toggle collapsed class → update `aria-expanded`

#### Static Analysis
- Element reference: ✅ — guarded by `if (aiStripToggle)` at line 765
- Null safety: ⚠️ — `article.querySelector('.ai-tools-grid')` at line 767 not null-checked
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S2** — `grid` could be null if `.ai-tools-grid` is missing; `grid.classList.contains()` would throw.

---

### Button: Option Click (Click-Mode Answer)
- **DOM**: `.option-item` (inside card, one per alternative)
- **File**: study.js line 1269
- **Handler**: inline arrow function
- **Trace**: UI click → guard: exit if not in click-mode or already answered → extract selected letter/text → set `article._jolConfidence` → `revealCard(article, { selectedLetter, selectedText })`

#### Static Analysis
- Element reference: ✅ — iterated from `article.querySelectorAll('.option-item')` at line 1263
- Null safety: ✅ — Uses optional chaining `optionEl.textContent?.trim()` (line 1274)
- Error handling: ✅ — Synchronous with guard clauses
- Promise handling: ✅ — N/A

#### Issues
- None identified. Good guard pattern.

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click reveal-btn on unanswered card | Answer section becomes visible, reveal button hides | [Unverified] — requires browser runtime |
| Click reveal-btn when `.reveal-btn` missing from DOM | Should not throw | [Unverified] — requires browser runtime |
| Click explanation button first time | Loading spinner shown, API called, explanation rendered | [Unverified] — requires browser runtime |
| Click explanation button second time | Toggles visibility without re-fetching | [Unverified] — requires browser runtime |
| Explanation API returns null | Fallback message displayed | [Unverified] — requires browser runtime |
| Click review card toggle on/off | `.for-review` toggled, chip counter updated, filter applied | [Unverified] — requires browser runtime |
| Review card save fails | State reverted, toast shown | [Unverified] — requires browser runtime |
| Click copy card | Text copied to clipboard, icon changes to check for 2s | [Unverified] — requires browser runtime |
| Click copy card when clipboard API blocked | Error caught, no crash | [Unverified] — requires browser runtime |
| Click delete card → confirm | Card removed from binderStructure in storage | [Unverified] — requires browser runtime |
| Click delete card → cancel | No changes | [Unverified] — requires browser runtime |
| Click edit answer with invalid letter | Toast "Letra inválida" shown | [Unverified] — requires browser runtime |
| Click option in click-mode on unanswered card | Card revealed with correct/wrong styling | [Unverified] — requires browser runtime |
| Click option on already-answered card | No action (guard clause) | [Unverified] — requires browser runtime |
| Click SM-2 button with missing data-quality | `NaN` passed to `rateSm2` | [Unverified] — requires browser runtime |
| Click why-wrong when no option selected | Uses fallback empty strings for letter/text | [Unverified] — requires browser runtime |
| Click mnemonic → both AI calls succeed | Full mnemonic card rendered | [Unverified] — requires browser runtime |
| Click AI strip toggle when grid missing | Throws TypeError on null `.classList` | [Unverified] — requires browser runtime |
| Chat send with empty textarea | Early return, no API call | [Unverified] — requires browser runtime |
| Chat API call fails | Error bubble shown, input re-enabled | [Unverified] — requires browser runtime |

## Overall Status: ⚠️ — Multiple missing null checks on unguarded `querySelector` calls (reveal-btn, copy-card, delete-card). Delete handler lacks DOM removal and user feedback.
