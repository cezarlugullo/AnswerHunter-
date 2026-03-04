# Buttons: Settings (Change Key, Remove Key, Close Settings, Provider Test)

## Overview
Settings reopen mode provides key management buttons for each API provider: change key, remove key, close settings panel, and test connection.

---

## Change Key Buttons (Groq / Serper / Gemini / OpenRouter)

### Location
- **DOM Elements**: `#change-key-groq`, `#change-key-serper`, `#change-key-gemini`, `#change-key-openrouter`
- **File**: `src/controllers/PopupController.js`
- **Lines**: 302–307

### Event Binding
- **Event**: click
- **Handler**: `handleChangeKey(provider)`
- **Bound at**: lines 302–307 via dynamic loop over `['groq', 'serper', 'gemini', 'openrouter']`

### Code Trace
UI click → `handleChangeKey(provider)` → `view.hideKeyStatus(provider)` → reveal input card → set input type to `text` → sync visibility toggle icon → focus and select input → hide change-key button → hide key-mgmt wrapper if no visible buttons remain.

### Handler analysis
- Null/undefined handling: ✅ All DOM lookups use `if` guards: `if (keyCard)`, `if (input)`, `if (changeBtn)`, `if (keyMgmtEl)`.
- Try/catch for async: ✅ Not async — synchronous method.
- Promise handling: N/A
- Variable dependencies: ✅ View elements are pre-cached.

---

## Close Settings Buttons (Groq / Serper / Gemini / OpenRouter)

### Location
- **DOM Elements**: `#close-settings-groq`, `#close-settings-serper`, `#close-settings-gemini`, `#close-settings-openrouter`
- **Lines**: 308–311

### Event Binding
- **Handler**: `handleCloseSettings()`

### Code Trace
UI click → `handleCloseSettings()` → set `_isReopenMode = false` → `view.setSettingsReopenMode(false)` → `view.setSetupVisible(false)`

### Handler analysis
- ✅ Simple, synchronous. No error risk.

---

## Remove Key Buttons

### Remove Serper Key
- **DOM Element**: `#remove-key-serper`
- **Line**: 313
- **Handler**: `handleRemoveSerperKey()`

### Code Trace
UI click → clear input value → set input type to `password` → `SettingsModel.getSettings()` → `SettingsModel.saveSettings({ serperApiKey: '', requiredProviders: { serper: false } })` → `resetProviderValidation('serper')` → `view.showKeyStatus('serper', false)` → `saveDraftKeys()` → show status + toast.

### Handler analysis
- Null/undefined handling: ✅ `if (this.view.elements.inputSerper)` guard.
- Try/catch for async: ⚠️ No try/catch wrapper around `SettingsModel.getSettings()` and `saveSettings()`.
- Promise handling: ✅ All awaited.
- Variable dependencies: ✅

### Issues
- **S3 (Low)**: No try/catch. If `SettingsModel.saveSettings()` throws, unhandled rejection.

---

### Remove OpenRouter Key
- **DOM Element**: `#remove-key-openrouter`
- **Line**: 315
- **Handler**: `handleRemoveOpenrouterKey()`

### Code Trace
Similar to Remove Serper, plus: if OpenRouter was primary provider → force switch to Groq → update pills and hint.

### Handler analysis
- Null/undefined handling: ✅
- Try/catch for async: ⚠️ No try/catch.
- Promise handling: ✅ All awaited. Updates `_settingsCache` inline.

---

### Remove Gemini Key
- **DOM Element**: `#remove-key-gemini`
- **Line**: 314
- **Handler**: `handleRemoveGeminiKey()`

### Code Trace
Same pattern as Remove OpenRouter — clears key, forces Groq if Gemini was primary.

### Handler analysis
- Null/undefined handling: ✅
- Try/catch for async: ⚠️ No try/catch.
- Promise handling: ✅

---

## Provider Test Buttons (Groq / Serper / Gemini / OpenRouter)

### Location
- **DOM Elements**: `#test-groq`, `#test-serper`, `#test-gemini`, `#test-openrouter`
- **File**: `src/controllers/PopupController.js`
- **Lines**: 251–260

### Event Binding
- **Event**: click
- **Handler**: `handleTestProvider(providerCandidate)`
- **Bound at**: lines 251–260 via `bindProviderTestButton()` utility
- **Guard**: `button.dataset.testBound = '1'` prevents duplicate binding.

### Code Trace
UI click → `handleTestProvider(provider)` → read input value → if empty, show error → set loading state → call `testGroqKey()` / `testSerperKey()` / `testGeminiKey()` / `testOpenrouterKey()` → if OK → show success, enable next step → if fail → show specific error (quota, rate limit, etc.).

### Handler analysis
- Null/undefined handling: ✅ Input checked for empty with `if (!key)`. Provider test results checked with `!!orCheck?.ok`.
- Try/catch for async: ✅ Outer try/catch wraps the entire handler (lines 1399–1464).
- Promise handling: ✅ All test methods awaited.
- Variable dependencies: ✅

### Sub-handlers
- `testGroqKey(key)` — line 1469: Fetch `api.groq.com/openai/v1/models`. Internal try/catch, returns boolean.
- `testSerperKey(key)` — line 1480: Supports both serper.dev and serpapi.com. Internal try/catch.
- `testGeminiKey(key)` — uses `testGeminiKey()` method (not shown in read range). Returns `{ ok, reason }`.
- `testOpenrouterKey(key)` — similar structure, returns `{ ok, reason }`.

---

## Visibility Toggle Buttons
### Location
- **DOM Elements**: `.visibility-toggle` buttons
- **File**: `src/controllers/PopupController.js`
- **Lines**: 262–264

### Event Binding
- **Handler**: `this.view.setupVisibilityToggle(button)` — delegated to PopupView.
- **Bound at**: line 262 via `document.querySelectorAll('.visibility-toggle').forEach(...)`

### Code Trace
Toggles `input.type` between `password` and `text`, updates icon between `visibility` and `visibility_off`.

### Static Analysis
- ✅ Handled entirely by the view layer. No async, no error risk.

---

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Change key — Groq | Reveals input, focuses, hides change button | [Unverified] — requires browser runtime |
| Change key — already revealed | No-op or idempotent | [Unverified] — requires browser runtime |
| Close settings | Hides setup panel | [Unverified] — requires browser runtime |
| Remove Serper key | Clears key, saves settings, shows toast | [Unverified] — requires browser runtime |
| Remove OpenRouter key (was primary) | Clears key, switches to Groq | [Unverified] — requires browser runtime |
| Remove Gemini key (was primary) | Clears key, switches to Groq | [Unverified] — requires browser runtime |
| Test Groq — valid key | Shows success, enables next | [Unverified] — requires browser runtime |
| Test Groq — invalid key | Shows error status | [Unverified] — requires browser runtime |
| Test Groq — empty input | Shows "paste key" toast | [Unverified] — requires browser runtime |
| Test Gemini — quota exceeded | Shows quota-specific message | [Unverified] — requires browser runtime |
| Test OpenRouter — rate limited | Shows rate limit message | [Unverified] — requires browser runtime |
| Toggle password visibility | Input type toggles, icon updates | [Unverified] — requires browser runtime |

## Status: ⚠️ — Remove key handlers lack try/catch.

## Issues Found
- **S3 (Low)**: `handleRemoveSerperKey()` (line 1612), `handleRemoveOpenrouterKey()` (line 1639), and `handleRemoveGeminiKey()` (line 1668) do not have try/catch wrappers. If `SettingsModel.saveSettings()` throws, the error propagates as an unhandled rejection.
