# Buttons: Auth (ChatGPT / Gemini / Copilot — Login, Logout, Panels)

## Overview
Three OAuth/auth flows: ChatGPT, Gemini (Google), and GitHub Copilot. Each has header buttons, auth panel open/close, login, and logout.

---

## ChatGPT Header Button
### Location
- **DOM Element**: `#chatgptBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 102

### Event Binding
- **Event**: click
- **Handler**: Inline — `document.getElementById('chatgpt-auth-section')?.classList.remove('hidden')`
- **Bound at**: line 102

### Static Analysis
- ✅ Simple DOM toggle, no async, no error risk.

---

## ChatGPT Auth Close
### Location
- **DOM Element**: `#chatgpt-auth-close`
- **Line**: 178

### Event Binding
- **Handler**: Inline — `document.getElementById('chatgpt-auth-section')?.classList.add('hidden')`

### Static Analysis
- ✅ Simple DOM toggle.

---

## ChatGPT Login Button
### Location
- **DOM Element**: `#chatgpt-login-btn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 176

### Event Binding
- **Event**: click
- **Handler**: `handleChatGPTLogin()`
- **Bound at**: line 176

### Code Trace
UI click → `handleChatGPTLogin()` → show spinner in status → disable button → `ChatGPTAuthService.startLogin()` → update status to "Waiting for authentication..." → background service handles callback via `chrome.runtime.onMessage` listener (lines 63–96).

### Handler analysis
- Null/undefined handling: ✅ `statusEl` and `loginBtn` checked with `if` before use.
- Try/catch for async: ✅ `ChatGPTAuthService.startLogin()` wrapped in try/catch (lines 754–765).
- Promise handling: ✅ `startLogin()` is properly awaited.
- Variable dependencies: ✅ `ChatGPTAuthService` imported at module level.

### Issues
- **S3 (Low)**: If `startLogin()` succeeds, the login button stays disabled until the `CHATGPT_AUTH_SUCCESS` message arrives from background. If that message never arrives, the button remains permanently disabled. No timeout recovery.

---

## ChatGPT Logout Button
### Location
- **DOM Element**: `#chatgpt-logout-btn`
- **Line**: 177

### Event Binding
- **Handler**: `handleChatGPTLogout()`

### Code Trace
UI click → `handleChatGPTLogout()` → `ChatGPTAuthService.logout()` → `refreshChatGPTAuthUI()` → if primary provider was chatgpt → `setProviderPill('groq')` → toast "ChatGPT disconnected"

### Handler analysis
- Null/undefined handling: ✅ Auth check and provider switch are guarded.
- Try/catch for async: ⚠️ No try/catch. If `ChatGPTAuthService.logout()` throws, the error is unhandled.
- Promise handling: ✅ All awaited.
- Variable dependencies: ✅

### Issues
- **S2 (Medium)**: `handleChatGPTLogout()` at line 768 has no try/catch. If `logout()` or `refreshChatGPTAuthUI()` throws, the promise rejection is unhandled.

---

## Gemini Header Button
### Location
- **DOM Element**: `#geminiAuthBtn`
- **Line**: 184

### Event Binding
- **Handler**: `openGeminiAuthPanel()`

### Code Trace
`openGeminiAuthPanel()` → `document.getElementById('gemini-auth-section')?.classList.remove('hidden')`

### Static Analysis
- ✅ Simple DOM toggle via helper method.

---

## Gemini Auth Close
### Location
- **DOM Element**: `#gemini-auth-close`
- **Line**: 185

### Static Analysis
- ✅ Simple DOM toggle.

---

## Gemini Login Button
### Location
- **DOM Element**: `#gemini-login-btn`
- **Line**: 188

### Event Binding
- **Handler**: `handleGeminiLogin()`

### Code Trace
UI click → `handleGeminiLogin()` → disable button + spinner → `GeminiCLIAuthService.startLogin()` → show "Waiting" status → background service handles callback.

### Handler analysis
- Null/undefined handling: ✅ `btn` and `statusEl` checked with `if`.
- Try/catch for async: ✅ Wrapped in try/catch (lines 839–854).
- Promise handling: ✅ Properly awaited.
- Variable dependencies: ✅

---

## Gemini Logout Button
### Location
- **DOM Element**: `#gemini-logout-btn`
- **Line**: 189

### Event Binding
- **Handler**: `handleGeminiLogout()`

### Code Trace
`handleGeminiLogout()` → `GeminiCLIAuthService.logout()` → `refreshGeminiAuthUI()` → toast "Desconectado do Google"

### Handler analysis
- Null/undefined handling: ✅
- Try/catch for async: ⚠️ No try/catch wrapper.
- Promise handling: ✅ All awaited.

### Issues
- **S2 (Medium)**: `handleGeminiLogout()` at line 857 has no try/catch. Same pattern as ChatGPT logout.

---

## Copilot Header Button
### Location
- **DOM Element**: `#copilotBtn`
- **Line**: 193

### Event Binding
- **Handler**: Inline — opens `#copilot-auth-section`

### Static Analysis
- ✅ Simple DOM toggle.

---

## Copilot Auth Close
### Location
- **DOM Element**: `#copilot-auth-close`
- **Line**: 196

### Static Analysis
- ✅ Simple DOM toggle.

---

## Copilot Login Button
### Location
- **DOM Element**: `#copilot-login-btn`
- **Line**: 199

### Event Binding
- **Handler**: `handleCopilotLogin()`

### Code Trace
UI click → `handleCopilotLogin()` → disable button → `CopilotAuthService.startLogin()` → receives `{ user_code, verification_uri }` → saves to `chrome.storage.local` → `_showCopilotCode()` (renders code for user to paste, auto-copies to clipboard, opens link) → background service handles polling.

### Handler analysis
- Null/undefined handling: ✅ `loginBtn`, `statusEl`, `codeDisplay` all checked.
- Try/catch for async: ✅ Wrapped in try/catch (lines 894–908).
- Promise handling: ✅ All awaited. `chrome.storage.local.set` wrapped in `new Promise(r => ...)`.
- Variable dependencies: ✅

---

## Copilot Logout Button
### Location
- **DOM Element**: `#copilot-logout-btn`
- **Line**: 200

### Event Binding
- **Handler**: `handleCopilotLogout()`

### Code Trace
`handleCopilotLogout()` → `CopilotAuthService.logout()` → remove `copilot_pending_code` → `refreshCopilotAuthUI()` → if copilot was primary → `setProviderPill('groq')` → toast.

### Handler analysis
- Null/undefined handling: ✅
- Try/catch for async: ⚠️ No try/catch wrapper.
- Promise handling: ✅ All awaited.

### Issues
- **S2 (Medium)**: `handleCopilotLogout()` at line 944 has no try/catch. Consistent with the other logout handlers.

---

## Copilot Test Connection Button
### Location
- **DOM Element**: `#copilot-test-btn`
- **Line**: 201

### Event Binding
- **Handler**: `handleCopilotTestConnection()`

### Code Trace
UI click → `handleCopilotTestConnection()` → disable button → `CopilotAuthService.getValidToken()` → `CopilotAuthService.getApiUrl()` → `fetch(apiUrl/chat/completions)` with test message → show result (success/failure).

### Handler analysis
- Null/undefined handling: ✅ `btn`, `resultEl` checked. Token null check returns early with error message.
- Try/catch for async: ✅ Wrapped in try/catch/finally (lines 1093–1136).
- Promise handling: ✅ All awaited. `response.text()` has `.catch(() => '')` for safety.
- Variable dependencies: ✅ `CopilotAuthService` imported.

---

## Copilot Copy Code Button
### Location
- **DOM Element**: `#copilot-copy-code-btn`
- **Line**: 202

### Event Binding
- **Handler**: `handleCopilotCopyCode()`

### Code Trace
UI click → `handleCopilotCopyCode()` → read `#copilot-user-code` text → guard against empty/placeholder → `navigator.clipboard.writeText(code)` → show feedback.

### Handler analysis
- Null/undefined handling: ✅ Checks `if (!code || code === '--------') return`.
- Try/catch for async: ✅ Uses `.then()/.catch()` pattern on clipboard promise.
- Promise handling: ✅ Clipboard promise handled with `.then()` and `.catch()`.
- Variable dependencies: ✅

---

## Test Scenarios (All Auth Buttons)
| Scenario | Expected | Status |
|----------|----------|--------|
| ChatGPT login success | Shows "connected" toast, updates UI | [Unverified] — requires browser runtime |
| ChatGPT login failure | Shows error in status element | [Unverified] — requires browser runtime |
| ChatGPT logout | Clears auth, switches to Groq if active | [Unverified] — requires browser runtime |
| Gemini login success | Shows "Google conectado" toast | [Unverified] — requires browser runtime |
| Gemini login failure | Re-enables button, shows error | [Unverified] — requires browser runtime |
| Gemini logout | Clears auth, shows disconnect toast | [Unverified] — requires browser runtime |
| Copilot login — code displayed | Shows user code, auto-copies | [Unverified] — requires browser runtime |
| Copilot login — startLogin fails | Shows error, re-enables button | [Unverified] — requires browser runtime |
| Copilot logout | Clears auth, pending code, switches to Groq | [Unverified] — requires browser runtime |
| Copilot test connection — success | Shows green checkmark with model reply | [Unverified] — requires browser runtime |
| Copilot test connection — no token | Shows red "no valid token" message | [Unverified] — requires browser runtime |
| Copilot copy code — valid code | Copies to clipboard, shows "Copiado!" | [Unverified] — requires browser runtime |
| Copilot copy code — no code | Returns silently | [Unverified] — requires browser runtime |
| Open/close auth panels | Toggles hidden class | [Unverified] — requires browser runtime |

## Status: ⚠️ — Functional but logout handlers lack try/catch.

## Issues Found
- **S2 (Medium)**: `handleChatGPTLogout()` (line 768), `handleGeminiLogout()` (line 857), and `handleCopilotLogout()` (line 944) all lack try/catch wrappers. If the auth service's `logout()` or `refreshUI()` methods throw, it results in an unhandled promise rejection. Recommendation: wrap each in try/catch.
- **S3 (Low)**: After `handleChatGPTLogin()` succeeds, the login button stays disabled waiting for a message from the background service worker. No timeout or recovery mechanism exists if the message never arrives (e.g., background worker crashed).
