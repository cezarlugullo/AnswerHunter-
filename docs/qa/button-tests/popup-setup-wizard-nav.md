# Buttons: Setup Wizard Navigation (Next/Prev)

## Overview
The setup wizard is a multi-step onboarding flow with 6 slides (0–5). Each slide has Previous/Next buttons.

---

## Button: Welcome Start
### Location
- **DOM Element**: `#welcomeStartBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 108

### Event Binding
- **Event**: click
- **Handler**: `handleWelcomeStart()`
- **Bound at**: line 108 via `this.view.elements.welcomeStartBtn?.addEventListener('click', ...)`

### Code Trace
UI click → `handleWelcomeStart()` → `view.hideWelcomeOverlay()` → set `onboardingFlags.welcomed = true` → `saveOnboardingFlags()` → `goToSetupStep(1)`

### Handler analysis
- Null/undefined handling: ✅ No external data dependencies.
- Try/catch for async: ⚠️ `saveOnboardingFlags()` is async but NOT awaited at line 1300. However, `saveOnboardingFlags` itself has an internal try/catch (line 1864).
- Promise handling: ⚠️ `saveOnboardingFlags()` fire-and-forget — not awaited. Minor issue; flag saving is best-effort.
- Variable dependencies: ✅ `view.hideWelcomeOverlay()` and `goToSetupStep()` are local methods.

---

## Button: Next Groq (Step 1 → 2)
### Location
- **DOM Element**: `#btn-next-groq`
- **File**: `src/controllers/PopupController.js`
- **Line**: 119

### Event Binding
- **Event**: click
- **Handler**: `goToSetupStep(2)`
- **Bound at**: line 119

---

## Button: Prev Groq (Step 1 → 0)
### Location
- **DOM Element**: `#prev-groq`
- **Line**: 120

### Event Binding
- **Handler**: `goToSetupStep(0)`

---

## Button: Next Serper (Step 2 → 3)
### Location
- **DOM Element**: `#btn-next-serper`
- **Line**: 122

### Event Binding
- **Handler**: `goToSetupStep(3)`

---

## Button: Prev Serper (Step 2 → 1)
### Location
- **DOM Element**: `#prev-serper`
- **Line**: 123

### Event Binding
- **Handler**: `goToSetupStep(1)`

---

## Button: Prev Gemini (Step 3 → 2)
### Location
- **DOM Element**: `#prev-gemini`
- **Line**: 125

### Event Binding
- **Handler**: `goToSetupStep(2)`

---

## Button: Next Gemini (Step 3 → 4)
### Location
- **DOM Element**: `#btn-next-gemini`
- **Line**: 126

### Event Binding
- **Handler**: `goToSetupStep(4)`

---

## Button: Next OpenRouter (Step 4 → 5)
### Location
- **DOM Element**: `#btn-next-openrouter`
- **Line**: 128

### Event Binding
- **Handler**: `goToSetupStep(5)`

---

## Button: Prev OpenRouter (Step 4 → 3)
### Location
- **DOM Element**: `#prev-openrouter`
- **Line**: 129

### Event Binding
- **Handler**: `goToSetupStep(3)`

---

## Button: Prev Prefs (Step 5 → 4)
### Location
- **DOM Element**: `#prev-prefs`
- **Line**: 130

### Event Binding
- **Handler**: `goToSetupStep(4)`

---

## Shared Handler: `goToSetupStep(step)`

### Location
- **File**: `src/controllers/PopupController.js`
- **Line**: 1348

### Code Trace
`goToSetupStep(step)` → normalize step (0–5) → set `currentSetupStep` → `view.showSetupStep(normalizedStep)` → conditionally enable Next buttons for optional steps (Serper step 2, Gemini step 3, OpenRouter step 4).

### Static Analysis
- Null/undefined handling: ✅ Step is coerced via `Number(step)`, clamped to 0–5.
- Try/catch for async: ✅ Not async — synchronous method.
- Promise handling: N/A
- Variable dependencies: ✅ `view.showSetupStep()`, `view.enableNextButton()` are view methods.

## Button: Save Setup
### Location
- **DOM Element**: `#saveSetupBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 132

### Event Binding
- **Event**: click
- **Handler**: `handleSaveSetup()`
- **Bound at**: line 132

### Code Trace
UI click → `handleSaveSetup()` → sanitize all key inputs → validate Groq key present → `SettingsModel.saveSettings()` → update `_settingsCache` → set onboarding flags done → `clearDraftKeys()` → `view.setSetupVisible(false)` → `view.showConfetti()`

### Handler analysis
- Null/undefined handling: ✅ Uses `sanitizeKey()` which handles null/undefined. Checks `if (!groqApiKey)` before saving.
- Try/catch for async: ✅ Save operation wrapped in try/catch (implied by SettingsModel).
- Promise handling: ✅ All awaited: `saveSettings`, `saveOnboardingFlags`, `clearDraftKeys`, `updateStepperState`.
- Variable dependencies: ✅ All inputs read from cached view elements.

---

## Button: Skip Setup
### Location
- **DOM Element**: `#setupSkipBtn`
- **Line**: 133

### Event Binding
- **Handler**: `handleSaveSetup()` (same as Save Setup)
- **Note**: Skip and Save trigger the same handler. If Groq key is missing, a toast error is shown.

---

## Test Scenarios (All Navigation Buttons)
| Scenario | Expected | Status |
|----------|----------|--------|
| Click Next on each step | Advances to correct step | [Unverified] — requires browser runtime |
| Click Prev on each step | Goes back to correct step | [Unverified] — requires browser runtime |
| Welcome Start | Hides overlay, shows step 1 | [Unverified] — requires browser runtime |
| Save Setup with valid keys | Saves settings, hides panel, shows confetti | [Unverified] — requires browser runtime |
| Save Setup without Groq key | Shows toast error, does not save | [Unverified] — requires browser runtime |
| Skip Setup without Groq key | Same as Save — shows toast error | [Unverified] — requires browser runtime |
| Rapid navigation clicks | No race condition — goToSetupStep is synchronous | [Unverified] — requires browser runtime |

## Status: ✅ — Navigation is straightforward. All elements use optional chaining for binding.

## Issues Found
- **S3 (Low)**: `handleWelcomeStart()` does not `await saveOnboardingFlags()` — if storage write fails, the flag state in memory is still correct but not persisted. Very unlikely to cause user-visible issues.
