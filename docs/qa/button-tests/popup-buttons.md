Now I have all the data needed. Let me compile the comprehensive audit report.

---

# 🔍 AnswerHunter Popup — Complete Static Button/Action Audit Report

**Scope**: `popup.html`, `popup.js`, `PopupController.js`, `PopupView.js`
**Date**: Static analysis — all findings from source code only

---

## SECTION A: ONBOARDING FLOW

---

### BTN-01: Welcome Start Button
- **Element**: `#welcomeStartBtn`
- **File**: `popup.html:111`
- **Event**: `click`
- **Handler**: `PopupController.handleWelcomeStart()` @ `PopupController.js:1297`
- **Binding**: `PopupController.js:108`
- **Service calls**: `view.hideWelcomeOverlay()`, `saveOnboardingFlags()` → `chrome.storage.local.set()`
- **Side effects**: Sets `onboardingFlags.welcomed = true`, persists flags, navigates to slide 1 via `goToSetupStep(1)`
- **Expected result**: Dismiss welcome overlay, show Groq setup slide
- **Static findings**:
  - ✅ Null-safe via `?.addEventListener`
  - ⚠️ `saveOnboardingFlags()` on line 1300 is a **dangling promise** — `async` method called without `await`. If storage write fails, the error is silently swallowed. The `catch` inside `saveOnboardingFlags` mitigates crash risk, but the flag may not persist.
  - ✅ `handleWelcomeStart` is synchronous (no async risk for double-click)
  - ⚠️ No double-click guard — rapid double-clicks call `goToSetupStep(1)` twice (harmless but wasteful)
- **Status**: ⚠️

---

### BTN-02: Setup Skip Button
- **Element**: `#setupSkipBtn`
- **File**: `popup.html:53`
- **Event**: `click`
- **Handler**: `PopupController.handleSaveSetup()` @ `PopupController.js:1697`
- **Binding**: `PopupController.js:133`
- **Service calls**: `SettingsModel.saveSettings()`, `saveOnboardingFlags()`, `clearDraftKeys()` → `chrome.storage.local` / `chrome.storage.sync`
- **Side effects**: Saves all API keys to storage, hides setup overlay, shows confetti
- **Expected result**: Save current settings and exit onboarding
- **Static findings**:
  - ✅ Full try/catch around entire body (line 1709–1744)
  - ✅ Proper `await` on all async calls
  - ✅ Null-safe with `this.sanitizeKey()` defaulting empty string
  - ⚠️ If groqApiKey is empty, shows toast and **returns early** (line 1704–1707). Skip button on an un-filled form gives error toast — user might be confused since button says "Skip"
  - ⚠️ No double-click guard — multiple rapid clicks could trigger multiple saves
- **Status**: ⚠️

---

### BTN-03: Onboarding Language Toggle (EN)
- **Element**: `.ob-lang-btn[data-lang="en"]`
- **File**: `popup.html:29`
- **Event**: `click` (delegated from `#obLanguageToggle`)
- **Handler**: `PopupController.handleLanguageChange(lang)` @ `PopupController.js:388`
- **Binding**: `PopupController.js:294–299`
- **Service calls**: `I18nService.setLanguage()`, `I18nService.apply()`, `SettingsModel`
- **Side effects**: `chrome.storage` language persistence, full DOM re-render
- **Expected result**: Switch UI language to English
- **Static findings**:
  - ✅ Uses `event.target.closest('.ob-lang-btn')` — null-safe
  - ✅ `async` handler with `await`
  - ✅ Guard: `if (btn && btn.dataset.lang)` prevents nulls
- **Status**: ✅

### BTN-04: Onboarding Language Toggle (PT-BR)
- **Element**: `.ob-lang-btn[data-lang="pt-BR"]`
- **File**: `popup.html:44`
- **Event**: `click` (delegated from `#obLanguageToggle`)
- **Handler**: Same as BTN-03
- **Status**: ✅

---

### BTN-05: Groq Validate Key
- **Element**: `#test-groq`
- **File**: `popup.html:173`
- **Event**: `click`
- **Handler**: `PopupController.handleTestProvider('groq')` @ `PopupController.js:1385`
- **Binding**: `PopupController.js:251` via `bindProviderTestButton()`
- **Service calls**: `PopupController.testGroqKey()` → `fetch('https://api.groq.com/openai/v1/models')`
- **Side effects**: Updates button state, status text, enables/disables Next button, shows toast
- **Expected result**: Validate the Groq API key and show success/failure
- **Static findings**:
  - ✅ Full try/catch on lines 1398–1464
  - ✅ Proper `await` chain
  - ✅ Empty key guard on lines 1388–1394
  - ✅ Uses `event.preventDefault()` in binding (line 246)
  - ✅ Guard `button.dataset.testBound === '1'` prevents duplicate binding
  - ⚠️ No double-click guard — button is NOT disabled before async work. `setTestButtonLoading(provider, 'loading')` sets `button.disabled = true` (PopupView.js:449), so this IS handled by the view. 
  - ✅ Actually protected — `setTestButtonLoading('loading')` disables the button
- **Status**: ✅

### BTN-06: Serper Validate Key
- **Element**: `#test-serper`
- **File**: `popup.html:245`
- **Event**: `click`
- **Handler**: `PopupController.handleTestProvider('serper')` @ `PopupController.js:1385`
- **Binding**: `PopupController.js:252`
- **Status**: ✅ (same pattern as BTN-05)

### BTN-07: Gemini Validate Key
- **Element**: `#test-gemini`
- **File**: `popup.html:318`
- **Event**: `click`
- **Handler**: `PopupController.handleTestProvider('gemini')` @ `PopupController.js:1385`
- **Binding**: `PopupController.js:253`
- **Status**: ✅

### BTN-08: OpenRouter Validate Key
- **Element**: `#test-openrouter`
- **File**: `popup.html:402`
- **Event**: `click`
- **Handler**: `PopupController.handleTestProvider('openrouter')` @ `PopupController.js:1385`
- **Binding**: `PopupController.js:254`
- **Status**: ✅

---

### BTN-09: Groq Prev (Back to Welcome)
- **Element**: `#prev-groq`
- **File**: `popup.html:171`
- **Event**: `click`
- **Handler**: `PopupController.goToSetupStep(0)` @ `PopupController.js:1348`
- **Binding**: `PopupController.js:120`
- **Service calls**: `view.showSetupStep()` — pure DOM manipulation
- **Side effects**: CSS transform on slides, progress bar update
- **Expected result**: Navigate back to welcome slide
- **Static findings**:
  - ✅ Synchronous, no async risk
  - ✅ Input clamped in `goToSetupStep` (lines 1349–1351)
- **Status**: ✅

### BTN-10: Groq Next
- **Element**: `#btn-next-groq`
- **File**: `popup.html:177`
- **Event**: `click`
- **Handler**: `PopupController.goToSetupStep(2)` @ `PopupController.js:1348`
- **Binding**: `PopupController.js:119`
- **Expected result**: Navigate to Serper slide
- **Static findings**:
  - ✅ Starts `disabled` in HTML (`disabled` attribute on line 177)
  - ✅ Only enabled after successful key validation
- **Status**: ✅

### BTN-11: Serper Prev
- **Element**: `#prev-serper` @ `popup.html:243`
- **Binding**: `PopupController.js:123` → `goToSetupStep(1)`
- **Status**: ✅

### BTN-12: Serper Next
- **Element**: `#btn-next-serper` @ `popup.html:249`
- **Binding**: `PopupController.js:122` → `goToSetupStep(3)`
- **Status**: ✅ (starts disabled but auto-enabled at slide entry since Serper is optional — line 1357)

### BTN-13: Gemini Prev
- **Element**: `#prev-gemini` @ `popup.html:316`
- **Binding**: `PopupController.js:125` → `goToSetupStep(2)`
- **Status**: ✅

### BTN-14: Gemini Next
- **Element**: `#btn-next-gemini` @ `popup.html:322`
- **Binding**: `PopupController.js:126` → `goToSetupStep(4)`
- **Note**: NOT disabled initially (line 322 lacks `disabled`) — Gemini is optional
- **Status**: ✅

### BTN-15: OpenRouter Prev
- **Element**: `#prev-openrouter` @ `popup.html:400`
- **Binding**: `PopupController.js:129` → `goToSetupStep(3)`
- **Status**: ✅

### BTN-16: OpenRouter Next
- **Element**: `#btn-next-openrouter` @ `popup.html:406`
- **Binding**: `PopupController.js:128` → `goToSetupStep(5)`
- **Status**: ✅

### BTN-17: Preferences Prev
- **Element**: `#prev-prefs` @ `popup.html:523`
- **Binding**: `PopupController.js:130` → `goToSetupStep(4)`
- **Status**: ✅

---

### BTN-18: Close Settings (Groq)
- **Element**: `#close-settings-groq` @ `popup.html:180`
- **Event**: `click`
- **Handler**: `PopupController.handleCloseSettings()` @ `PopupController.js:1606`
- **Binding**: `PopupController.js:308–311` via forEach loop
- **Side effects**: Hides onboarding view, resets reopen mode
- **Status**: ✅

### BTN-19: Close Settings (Serper)
- **Element**: `#close-settings-serper` @ `popup.html:252`
- **Handler**: Same as BTN-18
- **Status**: ✅

### BTN-20: Close Settings (Gemini)
- **Element**: `#close-settings-gemini` @ `popup.html:325`
- **Status**: ✅

### BTN-21: Close Settings (OpenRouter)
- **Element**: `#close-settings-openrouter` @ `popup.html:409`
- **Status**: ✅

---

### BTN-22: Change Key (Groq)
- **Element**: `#change-key-groq` @ `popup.html:183`
- **Event**: `click`
- **Handler**: `PopupController.handleChangeKey('groq')` @ `PopupController.js:1574`
- **Binding**: `PopupController.js:302–307`
- **Side effects**: Reveals API key input (changes input type to `text`), focuses it, hides the button itself
- **Expected result**: Let user edit a previously saved key
- **Static findings**:
  - ✅ Null-safe via optional chaining throughout
  - ⚠️ **Security note**: Changes input type to `text` (line 1584) — intentional but shows API key in plaintext. The visibility toggle icon is synced, so this is UX-consistent.
- **Status**: ✅

### BTN-23: Change Key (Serper)
- **Element**: `#change-key-serper` @ `popup.html:255`
- **Status**: ✅ (same pattern)

### BTN-24: Change Key (Gemini)
- **Element**: `#change-key-gemini` @ `popup.html:328`
- **Status**: ✅

### BTN-25: Change Key (OpenRouter)
- **Element**: `#change-key-openrouter` @ `popup.html:412`
- **Status**: ✅

---

### BTN-26: Remove Serper Key
- **Element**: `#remove-key-serper` @ `popup.html:256`
- **Event**: `click`
- **Handler**: `PopupController.handleRemoveSerperKey()` @ `PopupController.js:1612`
- **Binding**: `PopupController.js:313`
- **Service calls**: `SettingsModel.saveSettings({serperApiKey: ''})`
- **Side effects**: Clears input, saves empty key to storage, resets validation
- **Expected result**: Remove the Serper API key from storage
- **Static findings**:
  - ✅ `async` with proper `await`
  - ⚠️ **No confirmation dialog** — key is removed immediately without asking user
  - ✅ Input reset to password type (line 1615)
- **Status**: ⚠️

### BTN-27: Remove Gemini Key
- **Element**: `#remove-key-gemini` @ `popup.html:329`
- **Handler**: `PopupController.handleRemoveGeminiKey()` @ `PopupController.js:1668`
- **Binding**: `PopupController.js:314`
- **Static findings**:
  - ✅ Same pattern as BTN-26
  - ✅ Properly falls back provider to Groq if Gemini was active (lines 1685–1691)
  - ⚠️ **No confirmation dialog**
- **Status**: ⚠️

### BTN-28: Remove OpenRouter Key
- **Element**: `#remove-key-openrouter` @ `popup.html:413`
- **Handler**: `PopupController.handleRemoveOpenrouterKey()` @ `PopupController.js:1639`
- **Binding**: `PopupController.js:315`
- **Status**: ⚠️ (same pattern — no confirmation)

---

### BTN-29: Save/Finish Setup
- **Element**: `#saveSetupBtn` @ `popup.html:526`
- **Event**: `click`
- **Handler**: `PopupController.handleSaveSetup()` @ `PopupController.js:1697`
- **Binding**: `PopupController.js:132`
- **Service calls**: `SettingsModel.saveSettings()`, `saveOnboardingFlags()`, `clearDraftKeys()`
- **Side effects**: Saves all API keys, closes onboarding, shows confetti
- **Expected result**: Finalize onboarding
- **Static findings**:
  - ✅ Full try/catch (lines 1709–1744)
  - ✅ Proper null handling via `sanitizeKey()`
  - ⚠️ No double-click guard — successive rapid clicks trigger multiple saves + confetti bursts. Harmless but wasteful.
  - ✅ Early return on empty groqApiKey
- **Status**: ⚠️

---

### BTN-30 through BTN-33: Visibility Toggle Buttons
- **Elements**: `.visibility-toggle` (4 instances) @ `popup.html:158, 229, 302, 373`
- **Event**: `click`
- **Handler**: `PopupView.setupVisibilityToggle()` @ `PopupView.js:497`
- **Binding**: `PopupController.js:262–264` via `querySelectorAll`
- **Service calls**: None — pure DOM
- **Side effects**: Toggles input type between `password`/`text`, updates icon
- **Expected result**: Show/hide API key
- **Static findings**:
  - ✅ Guard `button.dataset.visibilityBound === '1'` prevents duplicate binding
  - ✅ `event.preventDefault()` + `event.stopPropagation()`
  - ✅ Null-safe: `if (!input) return;`
- **Status**: ✅

---

### BTN-34 through BTN-38: Provider Pills (Onboarding)
- **Elements**: `#pill-groq-ob`, `#pill-gemini-ob`, `#pill-openrouter-ob`, `#pill-chatgpt-ob`, `#pill-copilot-ob` @ `popup.html:438–464`
- **Event**: `click`
- **Handler**: `PopupController.setProviderPill(provider)` @ `PopupController.js:564`
- **Binding**: `PopupController.js:143–169` via `bindProviderPillButton()`
- **Service calls**: `SettingsModel.saveSettings()` (via `persistAiConfig()`), `ChatGPTAuthService.isLoggedIn()`, `CopilotAuthService.isLoggedIn()`
- **Side effects**: Changes active provider, saves to storage, updates UI hints
- **Expected result**: Select an AI provider
- **Static findings**:
  - ✅ Guard `button.dataset.providerBound === '1'` prevents duplicate binding
  - ✅ `event.preventDefault()` + `event.stopPropagation()` in binding (line 152)
  - ✅ `setProviderPill` is `async` and handles missing keys gracefully (falls back to Groq)
  - ✅ Auth validation for chatgpt/copilot/gemini with `await`
  - ⚠️ `persistAiConfig()` called without `await` at line 629 — it's fine since the method itself is fire-and-forget with try/catch, but the caller doesn't wait for storage confirmation.
- **Status**: ✅

---

## SECTION B: AUTH PANELS

---

### BTN-39: ChatGPT Header Button (Open Auth Panel)
- **Element**: `#chatgptBtn` @ `popup.html:475`
- **Event**: `click`
- **Handler**: Inline lambda @ `PopupController.js:102–104`
- **Service calls**: None — pure DOM toggle
- **Side effects**: Shows `#chatgpt-auth-section`
- **Expected result**: Opens ChatGPT auth panel
- **Static findings**:
  - ✅ Null-safe via `?.addEventListener` and `?.classList`
- **Status**: ✅

### BTN-40: ChatGPT Login
- **Element**: `#chatgpt-login-btn` @ `popup.html:588`
- **Event**: `click`
- **Handler**: `PopupController.handleChatGPTLogin()` @ `PopupController.js:745`
- **Binding**: `PopupController.js:176`
- **Service calls**: `ChatGPTAuthService.startLogin()` → opens OAuth tab
- **Side effects**: Disables button, shows loading spinner, updates status
- **Expected result**: Initiate ChatGPT OAuth flow
- **Static findings**:
  - ✅ Full try/catch (lines 754–765)
  - ✅ Button disabled immediately (line 752)
  - ⚠️ Button is **not re-enabled on success path** — relies on `CHATGPT_AUTH_SUCCESS` message listener to call `refreshChatGPTAuthUI()` which re-enables it (line 794). If message never arrives, button stays disabled until popup reopens.
- **Status**: ⚠️

### BTN-41: ChatGPT Logout
- **Element**: `#chatgpt-logout-btn` @ `popup.html:615`
- **Event**: `click`
- **Handler**: `PopupController.handleChatGPTLogout()` @ `PopupController.js:768`
- **Binding**: `PopupController.js:177`
- **Service calls**: `ChatGPTAuthService.logout()`, `SettingsModel.getSettings()`
- **Side effects**: Clears auth tokens, falls back to Groq if ChatGPT was active
- **Expected result**: Disconnect ChatGPT account
- **Static findings**:
  - ✅ `async` with proper `await`
  - ⚠️ No try/catch — if `ChatGPTAuthService.logout()` throws, the error propagates unhandled
  - ⚠️ No double-click guard
- **Status**: ⚠️

### BTN-42: ChatGPT Auth Close
- **Element**: `#chatgpt-auth-close` @ `popup.html:567`
- **Event**: `click`
- **Handler**: Inline lambda @ `PopupController.js:178–180`
- **Side effects**: Hides auth section
- **Status**: ✅

### BTN-43: ChatGPT Model Select
- **Element**: `#select-chatgpt-model` @ `popup.html:605`
- **Event**: `change`
- **Handler**: `PopupController.persistAiConfig()` @ `PopupController.js:672`
- **Binding**: `PopupController.js:181`
- **Side effects**: Saves model selection to `chrome.storage`
- **Status**: ✅

---

### BTN-44: Gemini Auth Button (Open Auth Panel)
- **Element**: `#geminiAuthBtn` @ `popup.html:483`
- **Event**: `click`
- **Handler**: `PopupController.openGeminiAuthPanel()` @ `PopupController.js:825`
- **Binding**: `PopupController.js:184`
- **Status**: ✅

### BTN-45: Gemini Login
- **Element**: `#gemini-login-btn` @ `popup.html:659`
- **Event**: `click`
- **Handler**: `PopupController.handleGeminiLogin()` @ `PopupController.js:829`
- **Binding**: `PopupController.js:188`
- **Service calls**: `GeminiCLIAuthService.startLogin()`
- **Static findings**:
  - ✅ Full try/catch (lines 839–854)
  - ✅ Button disabled immediately (line 834)
  - ⚠️ Same pattern as ChatGPT — button not re-enabled on success (relies on message listener line 71–76)
- **Status**: ⚠️

### BTN-46: Gemini Logout
- **Element**: `#gemini-logout-btn` @ `popup.html:686`
- **Handler**: `PopupController.handleGeminiLogout()` @ `PopupController.js:857`
- **Binding**: `PopupController.js:189`
- **Static findings**:
  - ⚠️ No try/catch — if `GeminiCLIAuthService.logout()` throws, unhandled
- **Status**: ⚠️

### BTN-47: Gemini Auth Close
- **Element**: `#gemini-auth-close` @ `popup.html:635`
- **Binding**: `PopupController.js:185–187`
- **Status**: ✅

### BTN-48: Gemini OAuth Model Select
- **Element**: `#select-gemini-oauth-model` @ `popup.html:676`
- **Event**: `change`
- **Handler**: `PopupController.persistAiConfig()` @ `PopupController.js:672`
- **Binding**: `PopupController.js:190`
- **Status**: ✅

---

### BTN-49: Copilot Header Button (Open Auth Panel)
- **Element**: `#copilotBtn` @ `popup.html:496`
- **Event**: `click`
- **Handler**: Inline lambda @ `PopupController.js:193–195`
- **Status**: ✅

### BTN-50: Copilot Login
- **Element**: `#copilot-login-btn` @ `popup.html:742`
- **Event**: `click`
- **Handler**: `PopupController.handleCopilotLogin()` @ `PopupController.js:884`
- **Binding**: `PopupController.js:199`
- **Service calls**: `CopilotAuthService.startLogin()` → GitHub Device Flow
- **Side effects**: Stores pending code in `chrome.storage.local`, shows code section with device code, auto-copies code to clipboard
- **Expected result**: Start GitHub Device Flow, show user code
- **Static findings**:
  - ✅ Full try/catch (lines 894–908)
  - ✅ Button disabled immediately (line 889)
  - ✅ Pending code persisted for popup-reopen scenario (lines 898–901)
  - ⚠️ `navigator.clipboard.writeText()` in `_showCopilotCode` (line 930) — has `.catch(() => {})` — silent failure is acceptable for UX but hides all clipboard errors
- **Status**: ✅

### BTN-51: Copilot Logout
- **Element**: `#copilot-logout-btn` @ `popup.html:999`
- **Handler**: `PopupController.handleCopilotLogout()` @ `PopupController.js:944`
- **Binding**: `PopupController.js:200`
- **Static findings**:
  - ⚠️ No try/catch wrapping the entire method
  - ✅ But `CopilotAuthService.logout()` itself is presumably safe
  - ✅ Falls back provider to Groq properly
- **Status**: ⚠️

### BTN-52: Copilot Test Connection
- **Element**: `#copilot-test-btn` @ `popup.html:761`
- **Event**: `click`
- **Handler**: `PopupController.handleCopilotTestConnection()` @ `PopupController.js:1084`
- **Binding**: `PopupController.js:201`
- **Service calls**: `CopilotAuthService.getValidToken()`, `CopilotAuthService.getApiUrl()`, `fetch()` to Copilot API
- **Side effects**: Shows test result, refreshes auth UI
- **Expected result**: Send a test message to Copilot API
- **Static findings**:
  - ✅ Full try/catch/finally (lines 1093–1136)
  - ✅ Button disabled/re-enabled properly
  - ✅ `finally` block always re-enables button
  - ⚠️ **Token sent via `Authorization: Bearer`** to `api.githubcopilot.com` — correct for Copilot API
- **Status**: ✅

### BTN-53: Copilot Copy Code
- **Element**: `#copilot-copy-code-btn` @ `popup.html:735`
- **Event**: `click`
- **Handler**: `PopupController.handleCopilotCopyCode()` @ `PopupController.js:1062`
- **Binding**: `PopupController.js:202`
- **Service calls**: `navigator.clipboard.writeText()`
- **Side effects**: Visual feedback on copy button, feedback text
- **Expected result**: Copy device code to clipboard
- **Static findings**:
  - ✅ Guard: `if (!code || code === '--------') return;` (line 1066)
  - ✅ `.catch()` handles clipboard failures
  - ✅ Not async — uses promise `.then()/.catch()` appropriately
- **Status**: ✅

### BTN-54: Copilot Auth Close
- **Element**: `#copilot-auth-close` @ `popup.html:706`
- **Binding**: `PopupController.js:196–198`
- **Status**: ✅

### BTN-55: Copilot Model Select (hidden)
- **Element**: `#select-copilot-model` @ `popup.html:777`
- **Event**: `change`
- **Handler**: `PopupController.persistAiConfig()` @ `PopupController.js:672`
- **Binding**: `PopupController.js:203`
- **Status**: ✅

---

## SECTION C: MAIN APP BUTTONS

---

### BTN-56: Settings Button (⚙️)
- **Element**: `#settingsBtn` @ `popup.html:1056`
- **Event**: `click`
- **Handler**: `PopupController.toggleSetupPanel()` @ `PopupController.js:1304`
- **Binding**: `PopupController.js:100`
- **Service calls**: `SettingsModel.getSettings()`, `determineCurrentStep()`, `SettingsModel.isPresent()`
- **Side effects**: Shows/hides onboarding overlay in reopen mode with key status chips
- **Expected result**: Open settings panel
- **Static findings**:
  - ✅ `async` with proper `await` calls
  - ✅ Handles both open/close states via `forceState` parameter
  - ✅ Null-safe throughout
- **Status**: ✅

---

### BTN-57: Search Button
- **Element**: `#searchBtn` @ `popup.html:1097`
- **Event**: `click`
- **Handler**: `PopupController.handleSearch()` @ `PopupController.js:1927`
- **Binding**: `PopupController.js:206`
- **Service calls**: `ensureReadyOrShowSetup()`, `chrome.scripting.executeScript()`, `ApiService.extractTextFromScreenshot()`, `ApiService.validateQuestion()`, `SearchService.searchOnly()`, `chrome.tabs.captureVisibleTab()`, `chrome.runtime.sendMessage(SEARCH_PHASE2)`, many more
- **Side effects**: Full search pipeline — DOM extraction, OCR, background dispatch, result storage, UI updates
- **Expected result**: Extract question from active tab, search, and display AI-refined answer
- **Static findings**:
  - ✅ Full try/catch/finally (lines 1938–4006)
  - ✅ Button disabled at start (line 1931), re-enabled in `finally` (line 4005)
  - ✅ Copy button disabled during search (line 1932)
  - ✅ Setup readiness check at entry (line 1928)
  - ✅ Restricted page check (line 1941)
  - ⚠️ **Extremely long method** — ~2080 lines (1927–4007). Cyclomatic complexity is very high. Should be decomposed into smaller functions.
  - ⚠️ `_triggerPageGabaritoExtraction(tab.url).catch(() => { })` on line 3932 — fire-and-forget, intentionally silent
  - ✅ Double-click safe via button disable at line 1931
- **Status**: ⚠️ (complexity)

---

### BTN-58: Extract Button
- **Element**: `#extractBtn` @ `popup.html:1101`
- **Event**: `click`
- **Handler**: `PopupController.handleExtract()` @ `PopupController.js:1871`
- **Binding**: `PopupController.js:205`
- **Service calls**: `chrome.scripting.executeScript()`, `SearchService.processExtractedItems()`, `saveLastResults()`
- **Side effects**: Extracts Q&A from page, refines with AI, shows results
- **Expected result**: Extract questions from the current page tab
- **Static findings**:
  - ✅ Full try/catch/finally (lines 1878–1924)
  - ✅ Button disabled at start (line 1875), re-enabled in `finally` (line 1923)
  - ✅ Restricted page check (line 1881)
  - ✅ Empty result check (lines 1893–1895)
  - ✅ Double-click safe via disable
- **Status**: ✅

---

### BTN-59: Copy All Button
- **Element**: `#copyBtn` @ `popup.html:1106`
- **Event**: `click`
- **Handler**: `PopupController.handleCopyAll()` @ `PopupController.js:4343`
- **Binding**: `PopupController.js:207`
- **Service calls**: `view.getAllResultsText()`, `navigator.clipboard.writeText()`
- **Side effects**: Copies all results text to clipboard
- **Expected result**: Copy results to clipboard
- **Static findings**:
  - ✅ Early return on empty text (line 4345)
  - ❌ **No try/catch** — `navigator.clipboard.writeText()` can throw (especially if clipboard API is denied). Line 4347 `await navigator.clipboard.writeText(text)` has no error handling.
  - ✅ Button starts `disabled` in HTML (line 1106)
- **Status**: ❌

---

### BTN-60: Clear Binder Button
- **Element**: `#clearBinderBtn` @ `popup.html:1137`
- **Event**: `click`
- **Handler**: `BinderController.handleClearAll()` (external)
- **Binding**: `PopupController.js:208`
- **Status**: ✅ (delegated — not in audit scope but binding is safe)

### BTN-61: Add Question Button
- **Element**: `#addQuestionBtn` @ `popup.html:1134`
- **Event**: `click`
- **Handler**: `BinderController.handleAddManual()` (external)
- **Binding**: `PopupController.js:209`
- **Status**: ✅

### BTN-62: Manage Disciplinas Button
- **Element**: `#btnDisciplinas` @ `popup.html:1131`
- **Event**: `click`
- **Handler**: `BinderController.openDisciplinaManager()` (external)
- **Binding**: `PopupController.js:210`
- **Status**: ✅

---

### BTN-63/64/65: Tab Buttons (Search / Binder / Disciplinas)
- **Elements**: `.tab-btn[data-tab="search"]`, `.tab-btn[data-tab="binder"]`, `.tab-btn[data-tab="disciplinas"]` @ `popup.html:1079, 1083, 1087`
- **Event**: `click`
- **Handler**: Inline lambda @ `PopupController.js:214–224`
- **Service calls**: `view.switchTab()`, `BinderController.renderBinder()`, `DisciplinasController.renderDisciplinas()`
- **Expected result**: Switch between Search/Binder/Disciplinas tabs
- **Static findings**:
  - ✅ Event delegation via `forEach`
  - ✅ Conditional render on tab switch
  - ⚠️ `BinderController.renderBinder()` and `DisciplinasController.renderDisciplinas()` called without `await` — they are presumably async methods whose results are not awaited
- **Status**: ⚠️

---

### BTN-66: Binder "Go to Search" CTA
- **Element**: `#binderGoToSearch` @ `popup.html:1145`
- **Event**: `click`
- **Handler**: `view.switchTab('search')` @ `PopupController.js:318–320`
- **Binding**: `PopupController.js:318–320`
- **Status**: ✅

---

## SECTION D: MAIN LANGUAGE TOGGLE

---

### BTN-67/68: Main App Language Buttons
- **Elements**: `.lang-btn[data-lang="en"]` @ `popup.html:1018`, `.lang-btn[data-lang="pt-BR"]` @ `popup.html:1046`
- **Event**: `click` (delegated from `#languageToggle`)
- **Handler**: `PopupController.handleLanguageChange(lang)` @ `PopupController.js:388`
- **Binding**: `PopupController.js:228–233`
- **Status**: ✅

---

## SECTION E: RESULTS AREA (Delegated Events)

All result interactions use a **single delegated listener** on `#results`:
**Binding**: `PopupController.js:226` — `this.view.elements.resultsDiv?.addEventListener('click', (event) => this.handleResultClick(event))`

---

### BTN-69: Save Button (per result card)
- **Element**: `.save-btn` (dynamically generated in `PopupView.appendResults`)
- **File**: `PopupView.js:773` (HTML template)
- **Event**: `click` (delegated)
- **Handler**: `PopupController.handleResultClick()` → save-btn branch @ `PopupController.js:4673–4691`
- **Service calls**: `BinderController.toggleSaveItem()`, `StorageModel.isReviewLater()`, `_persistResultFlags()`
- **Side effects**: Toggles bookmark in storage, updates button state
- **Static findings**:
  - ✅ `JSON.parse(decodeURIComponent())` — could throw on malformed data, but data is self-serialized
  - ⚠️ No try/catch wrapping the `JSON.parse` on line 4679 — if `dataContent` is corrupted, this throws. However, line 4676 checks `if (!dataContent) return;`
  - ✅ Uses `_buildLiveCardData` which handles nulls
- **Status**: ⚠️

### BTN-70: Review Later Button (per result card)
- **Element**: `.btn-review-later` (dynamically generated)
- **File**: `PopupView.js:776`
- **Event**: `click` (delegated)
- **Handler**: `PopupController.handleResultClick()` → review-later branch @ `PopupController.js:4627–4671`
- **Service calls**: `StorageModel.addItem()`, `StorageModel.setReviewLater()`, `_persistResultFlags()`
- **Static findings**:
  - ✅ Full try/catch (lines 4632–4669)
  - ✅ Proper null checks
- **Status**: ✅

### BTN-71: Answer Override Trigger
- **Element**: `.answer-override-trigger` (dynamically generated)
- **File**: `PopupView.js:863`
- **Event**: `click` (delegated)
- **Handler**: `PopupController.handleResultClick()` → override trigger branch @ `PopupController.js:4543–4553`
- **Side effects**: Toggles pills visibility
- **Status**: ✅

### BTN-72: Answer Override Cancel
- **Element**: `.override-cancel` (dynamically generated)
- **File**: `PopupView.js:874`
- **Handler**: @ `PopupController.js:4556–4563`
- **Status**: ✅

### BTN-73: Answer Override Pill
- **Element**: `.override-pill` (dynamically generated)
- **File**: `PopupView.js:871`
- **Handler**: @ `PopupController.js:4566–4612`
- **Service calls**: `_persistAnswerOverride()` → `chrome.storage.local.set()`
- **Static findings**:
  - ✅ Proper await on `_persistAnswerOverride`
  - ✅ UI updates (letter, text, header) with proper escaping via `_escapeHtml`
- **Status**: ✅

### BTN-74: Sources Toggle
- **Element**: `.sources-toggle` (dynamically generated)
- **File**: `PopupView.js:938`
- **Handler**: @ `PopupController.js:4615–4625`
- **Side effects**: Toggles sources list visibility, ARIA attribute
- **Status**: ✅

### BTN-75: Feedback Button
- **Element**: `.feedback-btn` (dynamically generated)
- **File**: `PopupView.js:932`
- **Handler**: @ `PopupController.js:4694–4714`
- **Service calls**: Dynamic `import('../services/CorrectionFeedback.js')`, `CorrectionFeedback.recordCorrection()`
- **Static findings**:
  - ✅ Full try/catch (lines 4696–4713)
  - ✅ Button disabled after use (line 4708)
- **Status**: ✅

### BTN-76: Tutor Button
- **Element**: `.btn-tutor` (dynamically generated)
- **File**: `PopupView.js:879`
- **Handler**: @ `PopupController.js:4717–4759`
- **Service calls**: Dynamic `import('../services/ApiService.js')`, `ApiService.generateTutorExplanation()`
- **Static findings**:
  - ✅ Full try/catch/finally (lines 4731–4758)
  - ✅ Button disabled during async work, re-enabled in `finally`
  - ✅ AI response is HTML-escaped via `_escapeHtml()` before markdown processing
  - ✅ Double-click safe via disable
- **Status**: ✅

### BTN-77: Similar Question Button
- **Element**: `.btn-similar` (dynamically generated)
- **File**: `PopupView.js:883`
- **Handler**: @ `PopupController.js:4763–4807`
- **Static findings**:
  - ✅ Full try/catch/finally
  - ✅ AI response escaped with `_escapeHtml()`
  - ✅ Button disabled during async work
- **Status**: ✅

### BTN-78: Chat Button
- **Element**: `.btn-chat` (dynamically generated)
- **File**: `PopupView.js:887`
- **Handler**: @ `PopupController.js:4810–4918`
- **Service calls**: Dynamic `import('../services/ApiService.js')`, `ApiService.answerFollowUp()`
- **Static findings**:
  - ✅ Full try/catch/finally in `handleSend` closure (lines 4865–4905)
  - ✅ Input disabled during send, re-enabled in `finally`
  - ✅ Uses `dataset.chatInitialized` to prevent duplicate initialization
  - ✅ AI response HTML-escaped before markdown processing
  - ⚠️ Chat input has no max-length validation — user could paste very long text
  - ⚠️ Inner `addEventListener` for `sendBtn.click` and `input.keypress` are added inside the delegated handler — these listeners accumulate if the same card's chat button is somehow re-initialized (mitigated by `chatInitialized` flag)
- **Status**: ⚠️

---

## SECTION F: MODEL SELECTS (change events)

---

### BTN-79: Groq Model Select
- **Element**: `#select-groq-model` @ `popup.html:543` (hidden utility element)
- **Event**: `change`
- **Handler**: `PopupController.persistAiConfig()` @ `PopupController.js:672`
- **Binding**: `PopupController.js:171`
- **Status**: ✅

### BTN-80: Gemini Model Select
- **Element**: `#select-gemini-model` @ `popup.html:544` (hidden)
- **Binding**: `PopupController.js:172`
- **Status**: ✅

### BTN-81: OpenRouter Model Select
- **Element**: `#select-openrouter-model` @ `popup.html:385`
- **Event**: `change`
- **Binding**: `PopupController.js:173`
- **Status**: ✅

### BTN-82: Search Provider Select
- **Element**: `#select-search-provider` @ `popup.html:545` (hidden)
- **Event**: `change`
- **Handler**: `PopupController.applySearchProviderSelection()` @ `PopupController.js:1830`
- **Binding**: `PopupController.js:136–141`
- **Status**: ✅

---

## SECTION G: API KEY INPUT EVENTS

---

### BTN-83–86: Paste Events on Key Inputs
- **Elements**: `#input-groq`, `#input-serper`, `#input-gemini`, `#input-openrouter`
- **Event**: `paste`
- **Handler**: Inline lambda @ `PopupController.js:276–283`
- **Side effects**: Saves draft keys, resets provider validation, shows paste notification, updates hint
- **Static findings**:
  - ✅ `setTimeout(..., 50)` ensures paste value is available
  - ⚠️ `saveDraftKeys()` called without `await` (fire-and-forget) — has internal try/catch
- **Status**: ✅

### BTN-87–90: Input Events on Key Inputs
- **Elements**: Same 4 inputs
- **Event**: `input`
- **Handler**: Inline lambda @ `PopupController.js:285–290`
- **Static findings**:
  - ⚠️ Same fire-and-forget `saveDraftKeys()` without `await`
- **Status**: ✅

---

## SECTION H: TURBO WIZARD

---

### BTN-91: Native Bridge Install Button (Settings Entry)
- **Element**: `#nativeBridgeInstallBtn` @ `popup.html:511`
- **Event**: `click`
- **Handler**: `PopupController._openTurboWizard()` @ `PopupController.js:4975`
- **Binding**: `PopupController.js:111–116`
- **Status**: ✅

### BTN-92: Native Bridge Install Banner Button
- **Element**: `#native-bridge-install-btn` @ `popup.html:1068`
- **Event**: `click`
- **Handler**: `PopupController._openTurboWizard()` @ `PopupController.js:4975`
- **Binding**: `PopupController.js:4966–4969` (inside `_checkNativeBridgeStatus`)
- **Static findings**:
  - ✅ Guard `installBtn._bridgeHandlerAdded` prevents duplicate binding
- **Status**: ✅

### BTN-93: Turbo Wizard Close
- **Element**: `#tw-close-btn` @ `popup.html:1298`
- **Binding**: `PopupController.js:4993`
- **Status**: ✅

### BTN-94: Turbo Wizard Skip
- **Element**: `#tw-skip-btn` @ `popup.html:1327`
- **Binding**: `PopupController.js:4994`
- **Status**: ✅

### BTN-95: Turbo Wizard Start ("Quero o Turbo!")
- **Element**: `#tw-start-btn` @ `popup.html:1328`
- **Event**: `click`
- **Handler**: `PopupController._turboWizardBeginDownload()` @ `PopupController.js:5029`
- **Binding**: `PopupController.js:4995`
- **Service calls**: `_downloadBridgeInstaller()` → `fetch()` + `chrome.downloads.download()`
- **Static findings**:
  - ✅ try/catch in `_turboWizardBeginDownload` (lines 5041–5049)
  - ⚠️ No double-click guard — button not disabled during download. Multiple rapid clicks could trigger duplicate downloads.
- **Status**: ⚠️

### BTN-96: Turbo Wizard Back
- **Element**: `#tw-back-btn` @ `popup.html:1392`
- **Binding**: `PopupController.js:4996` → `_turboWizardGoTo('tw-step-1')`
- **Status**: ✅

### BTN-97: Turbo Wizard "Done Install"
- **Element**: `#tw-done-install-btn` @ `popup.html:1393`
- **Event**: `click`
- **Handler**: `PopupController._turboWizardVerify()` @ `PopupController.js:5053`
- **Binding**: `PopupController.js:4997`
- **Service calls**: `NativeFetchBridgeService.isAvailable()` with `Promise.race` timeout
- **Static findings**:
  - ✅ try/catch for bridge check (line 5061–5066)
  - ⚠️ No double-click guard
- **Status**: ⚠️

### BTN-98: Turbo Wizard Success Close
- **Element**: `#tw-success-close-btn` @ `popup.html:1418`
- **Binding**: `PopupController.js:4998–5001`
- **Side effects**: Closes wizard, rechecks bridge status
- **Status**: ✅

### BTN-99: Turbo Wizard "Not Found" Skip
- **Element**: `#tw-notfound-skip-btn` @ `popup.html:1435`
- **Binding**: `PopupController.js:5002`
- **Status**: ✅

### BTN-100: Turbo Wizard Retry
- **Element**: `#tw-retry-btn` @ `popup.html:1436`
- **Binding**: `PopupController.js:5003` → `_turboWizardGoTo('tw-step-2')`
- **Status**: ✅

### BTN-101: Turbo Wizard Backdrop Click
- **Element**: `.tw-backdrop` @ `popup.html:1286`
- **Event**: `click`
- **Binding**: `PopupController.js:5006`
- **Status**: ✅

---

## SECTION I: COPILOT MODEL PICKER (popup.js)

---

### BTN-102: Copilot Model Trigger
- **Element**: `#copilot-model-trigger` @ `popup.html:798`
- **Event**: `click`, `keydown`
- **Handler**: `togglePicker()` / `openPicker()` @ `popup.js:119–121, 124–127, 154–161`
- **Static findings**:
  - ✅ `e.stopPropagation()` prevents bubbling
  - ✅ Keyboard accessible: Enter, Space, ArrowDown, Escape
  - ✅ Click-outside-to-close via document click listener (line 149–151)
- **Status**: ✅

### BTN-103: Copilot Model Options (×14)
- **Elements**: `.ah-mpicker-option[role="option"]` @ `popup.html:816–993`
- **Event**: `click`, `keydown`
- **Handler**: `selectByValue(opt.dataset.value, true)` → fires `change` on hidden select @ `popup.js:130–146`
- **Service calls**: Dispatches `change` event which triggers `PopupController.persistAiConfig()`
- **Static findings**:
  - ✅ `e.stopPropagation()` prevents bubbling
  - ✅ Keyboard: Enter/Space/Escape support
  - ✅ `closePicker()` and `trigger.focus()` for accessibility
- **Status**: ✅

---

## SECTION J: DISCIPLINAS VIEW BUTTONS

---

### BTN-104: Add Disciplina Button
- **Element**: `#btnAddDiscNew` @ `popup.html:1163`
- **Event**: `click`
- **Handler**: Managed by `DisciplinasController.init()` (external)
- **Binding**: `PopupController.js:212`
- **Status**: ✅ (out of scope — external controller)

### BTN-105: Disciplina Create Submit
- **Element**: `#disc-create-submit` @ `popup.html:1171`
- **Status**: ✅ (DisciplinasController)

### BTN-106: Disciplina Create Cancel
- **Element**: `#disc-create-cancel` @ `popup.html:1174`
- **Status**: ✅ (DisciplinasController)

---

## SECTION K: MANUAL ADD QUESTION MODAL

---

### BTN-107: Manual Add Close
- **Element**: `#manualAddCloseBtn` @ `popup.html:1197`
- **Handler**: `BinderController.handleAddManual()` (external)
- **Status**: ✅ (BinderController scope)

### BTN-108: Manual Add Cancel
- **Element**: `#manualAddCancelBtn` @ `popup.html:1275`
- **Status**: ✅ (BinderController)

### BTN-109: Manual Add Save
- **Element**: `#manualAddSaveBtn` @ `popup.html:1276`
- **Status**: ✅ (BinderController)

### BTN-110: Manage Disciplines (in modal)
- **Element**: `#btnManageDisciplines` @ `popup.html:1240`
- **Status**: ✅ (BinderController)

---

## SECTION L: DISCIPLINAS MODAL

---

### BTN-111: Disciplinas Modal Close
- **Element**: `#discModalCloseBtn` @ `popup.html:1449`
- **Status**: ✅ (BinderController)

### BTN-112: Disciplinas Add Button (in modal)
- **Element**: `#discAddBtn` @ `popup.html:1457`
- **Status**: ✅ (BinderController)

---

## SECTION M: CONTEXTUAL DICTIONARY (mouseup)

---

### BTN-113: Text Selection → Dictionary Tooltip
- **Element**: `document` (global)
- **Event**: `mouseup`
- **Handler**: Anonymous async handler @ `PopupController.js:323–375`
- **Service calls**: Dynamic `import('../services/ApiService.js')`, `ApiService.defineTerm()`
- **Side effects**: Creates floating tooltip DOM element with definition
- **Expected result**: Select text in a QA card to get a contextual definition
- **Static findings**:
  - ✅ try/catch (lines 335–372)
  - ✅ Guard: skips if selection is inside an existing tooltip (`e.target.closest('.dict-tooltip')`)
  - ✅ Length validation: `text.length > 0 && text.length < 50 && text.split(/\s+/).length <= 5`
  - ✅ Only activates within QA card context elements
  - ✅ Text is escaped via `_escapeHtml` helper (lines 362–366)
  - ⚠️ Old tooltip removal (`document.querySelector('.dict-tooltip')?.remove()`) — only removes the first one. If multiple exist (race condition), only the first is removed.
  - ⚠️ No debounce — every mouseup fires the handler
- **Status**: ⚠️

---

## SECTION N: BACKGROUND MESSAGE LISTENER

---

### BTN-114: Runtime Message Listener
- **Element**: N/A (background communication)
- **Event**: `chrome.runtime.onMessage`
- **Handler**: Anonymous listener @ `PopupController.js:63–96`
- **Messages handled**: `CHATGPT_AUTH_SUCCESS`, `CHATGPT_AUTH_FAILED`, `GEMINI_CLI_AUTH_SUCCESS`, `GEMINI_CLI_AUTH_FAILED`, `COPILOT_AUTH_SUCCESS`, `COPILOT_AUTH_FAILED`
- **Static findings**:
  - ⚠️ **No try/catch** wrapping the entire listener — if any `refreshXxxAuthUI()` method throws, the listener fails silently
  - ✅ Individual branches properly handle success/failure UI updates
  - ✅ `chrome.storage.local.remove(['copilot_pending_code'])` cleanup on success/failure
- **Status**: ⚠️

---

# SUMMARY TABLE

| Category | Total | ✅ Pass | ⚠️ Warning | ❌ Fail |
|----------|-------|---------|------------|--------|
| Onboarding Nav | 17 | 15 | 2 | 0 |
| Key Management | 7 | 4 | 3 | 0 |
| Auth (ChatGPT/Gemini/Copilot) | 16 | 11 | 5 | 0 |
| Main Actions | 7 | 5 | 1 | 1 |
| Result Interactions | 10 | 8 | 2 | 0 |
| Model/Provider Selects | 8 | 8 | 0 | 0 |
| Turbo Wizard | 11 | 8 | 3 | 0 |
| Copilot Picker | 2 | 2 | 0 | 0 |
| Input Events | 8 | 8 | 0 | 0 |
| Other (dict, messages) | 2 | 0 | 2 | 0 |
| **TOTAL** | **~114** | **~92** | **~21** | **1** |

---

# CRITICAL FINDINGS

### ❌ CRIT-01: `handleCopyAll()` has no try/catch (BTN-59)
**File**: `PopupController.js:4343–4349`
**Issue**: `navigator.clipboard.writeText()` can reject if clipboard permission is denied or the document is not focused. The `await` call will throw an unhandled promise rejection.
**Fix**:
```js
async handleCopyAll() {
  const text = this.view.getAllResultsText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    this.view.showStatus('success', this.t('status.copied'));
  } catch (err) {
    console.warn('Clipboard write failed:', err);
    this.view.showToast('Failed to copy to clipboard', 'error');
  }
}
```

### ⚠️ WARN-01: `handleSearch()` is ~2080 lines (BTN-57)
**File**: `PopupController.js:1927–4007`
**Issue**: Extreme cyclomatic complexity. Functions like `optionsAreContextuallyRelated`, `buildOptionsProfile`, `compareOptionsByLetter`, and many content script functions are **defined inline** inside `handleSearch()`. This makes the method nearly impossible to unit test.
**Recommendation**: Extract into separate utility modules:
- `QuestionExtractionPipeline`
- `OptionRecoveryService`
- `CrossValidationService`

### ⚠️ WARN-02: Multiple logout handlers lack try/catch (BTN-41, 46, 51)
**Files**: `PopupController.js:768, 857, 944`
**Issue**: `handleChatGPTLogout()`, `handleGeminiLogout()`, and `handleCopilotLogout()` all call async service methods without top-level try/catch. If the auth service throws, the error propagates unhandled.

### ⚠️ WARN-03: Login buttons not re-enabled on success (BTN-40, 45)
**Files**: `PopupController.js:752, 834`
**Issue**: ChatGPT and Gemini login buttons are disabled at the start of login but are only re-enabled when a background message arrives. If the popup is closed and reopened, the `init()` flow handles this via `refreshXxxAuthUI()`, but if the message is lost, the button stays disabled for the session.

### ⚠️ WARN-04: No confirmation on destructive key removal (BTN-26, 27, 28)
**Issue**: Remove key buttons immediately delete API keys without a `confirm()` dialog. A misclick permanently removes a configured key.

### ⚠️ WARN-05: Turbo Wizard "Start" button has no double-click guard (BTN-95)
**File**: `PopupController.js:5029`
**Issue**: Button is not disabled during download. Rapid clicks trigger duplicate `chrome.downloads.download()` calls, creating duplicate files.
