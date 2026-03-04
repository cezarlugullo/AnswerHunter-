# Buttons: Model Picker (Copilot Custom Picker in popup.js)

## Overview
A custom `<ah-mpicker>` widget in `popup.js` that syncs with the hidden `<select id="select-copilot-model">`. Provides a dropdown panel with model options, keyboard navigation, and bidirectional sync.

---

## Trigger Button (Open/Close Picker)
### Location
- **DOM Element**: `#copilot-model-trigger`
- **File**: `src/popup/popup.js`
- **Line**: 124

### Event Binding
- **Event**: click
- **Handler**: `togglePicker()` → opens or closes the dropdown panel
- **Bound at**: line 124

### Code Trace
UI click → `e.stopPropagation()` → `togglePicker()` → if closed: `openPicker()` → detect space below for upward direction → add `.ah-mpicker--open` → scroll selected into view | if open: `closePicker()` → remove `.ah-mpicker--open`

### Handler analysis
- Null/undefined handling: ✅ Early null check on all four elements at line 72: `if (!picker || !panel || !trigger || !hidden) return`.
- Try/catch for async: N/A — synchronous.
- Promise handling: N/A
- Variable dependencies: ✅ All closure-scoped.

---

## Option Click (Select Model)
### Location
- **DOM Elements**: `.ah-mpicker-option` elements inside `#copilot-model-panel`
- **File**: `src/popup/popup.js`
- **Lines**: 130–135

### Event Binding
- **Event**: click
- **Handler**: `selectByValue(opt.dataset.value, true)` → `closePicker()`
- **Bound at**: lines 130–135 via `options.forEach(...)`

### Code Trace
UI click → `e.stopPropagation()` → `selectByValue(value, fireEvent=true)` → iterate all options, toggle `.ah-mpicker-option--selected` → update trigger icon/name/meta from matched option → if `fireEvent && hidden.value !== value` → set `hidden.value = value` → dispatch `change` event → `closePicker()`

The dispatched `change` event on `#select-copilot-model` triggers `persistAiConfig()` (bound at PopupController line 203).

### Handler analysis
- Null/undefined handling: ✅ `matched` checked with `if (matched)`. Optional chaining on `matched.querySelector(...)?.textContent`.
- Try/catch for async: N/A — synchronous.
- Promise handling: N/A
- Variable dependencies: ✅

---

## Keyboard Navigation

### Trigger Keyboard (Enter/Space/ArrowDown → open, Escape → close)
- **Line**: 154–161
- **Handler**: Opens picker, focuses first option.
- ✅ `e.preventDefault()` prevents scroll on Space.

### Option Keyboard (Enter/Space → select, Escape → close)
- **Lines**: 137–145
- **Handler**: `selectByValue()`, `closePicker()`, `trigger.focus()`.
- ✅ Proper focus management on close.

---

## Click Outside (Close Picker)
### Location
- **File**: `src/popup/popup.js`
- **Line**: 149

### Event Binding
- **Event**: click on `document`
- **Handler**: `if (!picker.contains(e.target)) closePicker()`

### Static Analysis
- ✅ Standard pattern. `picker.contains()` prevents closing when clicking inside.

---

## Hidden Select Sync (Programmatic .value patch)
### Location
- **File**: `src/popup/popup.js`
- **Lines**: 167–174

### Mechanism
Patches `HTMLSelectElement.prototype.value` setter on the hidden `#select-copilot-model` element. When PopupController programmatically sets `hidden.value = copilotModel`, the patched setter calls `selectByValue(v, false)` to update the picker UI without re-firing the `change` event.

### Static Analysis
- ✅ Uses `Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')` to preserve original behavior.
- ⚠️ Prototype property patching is a clever but fragile technique. If another script also patches `HTMLSelectElement.prototype.value`, conflicts could occur. Acceptable for a self-contained extension.

---

## Model Select Dropdowns (Provider Model Selects)
### Location
- **DOM Elements**: `#select-groq-model`, `#select-gemini-model`, `#select-openrouter-model`, `#select-chatgpt-model`, `#select-gemini-oauth-model`, `#select-copilot-model`
- **File**: `src/controllers/PopupController.js`
- **Lines**: 171–173, 181, 190, 203

### Event Binding
- **Event**: change
- **Handler**: `persistAiConfig()`

### Code Trace
Select change → `persistAiConfig()` → reads all active pills and model selects → `SettingsModel.saveSettings(...)` with provider + model config → console table log.

### Handler analysis
- Null/undefined handling: ✅ All select values use fallbacks: `?.value || 'default-model'`.
- Try/catch for async: ⚠️ `persistAiConfig()` is async but has no try/catch. If `SettingsModel.saveSettings()` throws, the rejection is unhandled.
- Promise handling: ✅ `saveSettings()` is awaited.
- Variable dependencies: ✅

---

## Provider Pill Buttons (Groq / Gemini / OpenRouter / ChatGPT / Copilot)
### Location
- **DOM Elements**: `#pill-groq`, `#pill-gemini`, `#pill-openrouter`, `#pill-chatgpt-ob`, plus `.ob-provider-pill` elements
- **File**: `src/controllers/PopupController.js`
- **Lines**: 143–169

### Event Binding
- **Event**: click
- **Handler**: `setProviderPill(providerCandidate)`
- **Bound at**: lines 160–169 via `bindProviderPillButton()` utility
- **Guard**: `button.dataset.providerBound = '1'` prevents duplicate binding.

### Code Trace
UI click → `e.preventDefault()` → `e.stopPropagation()` → `setProviderPill(provider)` → validate provider access (key/login) → if not accessible, fallback to `groq` with toast → update active pill classes → `syncObPills()` → `updateProviderHint()` → `persistAiConfig()`

### Handler analysis
- Null/undefined handling: ✅ Provider validated against whitelist `['groq', 'gemini', 'openrouter', 'chatgpt', 'copilot']`. Access checks use `hasOpenrouterKey()`, `hasGeminiAccess()`, `ChatGPTAuthService.isLoggedIn()`, `CopilotAuthService.isLoggedIn()`.
- Try/catch for async: ⚠️ `setProviderPill()` is async but the click handler calls it without catch. Internally, the method has no try/catch either.
- Promise handling: ✅ All auth checks are awaited.
- Variable dependencies: ✅

---

## Search Provider Dropdown
### Location
- **DOM Element**: `#select-search-provider`
- **File**: `src/controllers/PopupController.js`
- **Lines**: 136–141

### Event Binding
- **Event**: change
- **Handler**: `applySearchProviderSelection()`

### Code Trace
Select change → `this.getSelectedSearchProvider()` → `applySearchProviderSelection(provider, { persistDraft: true, resetValidation: true })`.

### Static Analysis
- ✅ Synchronous call to apply selection UI. No error risk.

---

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Open model picker | Panel opens, selected option scrolled into view | [Unverified] — requires browser runtime |
| Select model option | Updates trigger display, fires change, persists | [Unverified] — requires browser runtime |
| Keyboard navigation (Enter/Space/Arrow) | Opens picker, selects option | [Unverified] — requires browser runtime |
| Escape key | Closes picker, returns focus to trigger | [Unverified] — requires browser runtime |
| Click outside picker | Closes picker | [Unverified] — requires browser runtime |
| Programmatic value set | Picker UI updates without firing change | [Unverified] — requires browser runtime |
| Select Groq pill | Groq becomes active, config persisted | [Unverified] — requires browser runtime |
| Select OpenRouter without key | Falls back to Groq with toast | [Unverified] — requires browser runtime |
| Select ChatGPT without login | Falls back to Groq, opens auth panel | [Unverified] — requires browser runtime |
| Change Groq model select | persistAiConfig() saves new model | [Unverified] — requires browser runtime |

## Status: ⚠️ — Functional with good UX patterns, but some async handlers lack try/catch.

## Issues Found
- **S3 (Low)**: `persistAiConfig()` (line 672) has no try/catch. If `SettingsModel.saveSettings()` throws, it results in an unhandled rejection.
- **S3 (Low)**: `setProviderPill()` (line 564) has no try/catch. Auth checks (`isLoggedIn()`) could theoretically throw.
- **S3 (Low)**: Hidden select property patching (line 167) is fragile if other scripts also patch the prototype. Acceptable for isolated extension context.
