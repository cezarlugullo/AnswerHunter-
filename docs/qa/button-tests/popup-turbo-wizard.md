# Buttons: Turbo Wizard (NativeFetchBridge Install Wizard)

## Overview
The Turbo Wizard is a multi-step overlay that guides users through installing the NativeFetchBridge native messaging host. It has 4 main steps (0–3), plus success/not-found terminal states.

---

## Button: Open Turbo Wizard (Native Bridge Install)
### Location
- **DOM Element**: `#nativeBridgeInstallBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 111–116

### Event Binding
- **Event**: click
- **Handler**: `_openTurboWizard()`
- **Bound at**: lines 112–116 via `getElementById` + null check

### Code Trace
UI click → `_openTurboWizard()` → reset wizard state → show `#turbo-wizard-overlay` → show `#tw-step-0` → bind wizard buttons (once).

---

## Button: Turbo Wizard Close
### Location
- **DOM Element**: `#tw-close-btn`
- **Line**: 4998

### Event Binding
- **Handler**: `_closeTurboWizard()`

### Code Trace
`_closeTurboWizard()` → `document.getElementById('turbo-wizard-overlay')?.classList.add('hidden')`

---

## Button: Turbo Wizard Skip
### Location
- **DOM Element**: `#tw-skip-btn`
- **Line**: 4999

### Event Binding
- **Handler**: `_closeTurboWizard()`

---

## Button: Turbo Wizard Start Download
### Location
- **DOM Element**: `#tw-start-btn`
- **Line**: 5000

### Event Binding
- **Handler**: `_turboWizardBeginDownload()`

### Code Trace
UI click → `_turboWizardBeginDownload()` → go to step 1 → set progress bar to 10% → `_downloadBridgeInstaller()` → set progress to 100% → go to step 2 (install instructions).

### Handler analysis
- Null/undefined handling: ✅ `progressBar` and `progressLabel` checked with `if`.
- Try/catch for async: ✅ Wrapped in try/catch (lines 5046–5055).
- Promise handling: ✅ `_downloadBridgeInstaller()` awaited. Uses `await new Promise(r => setTimeout(r, 600))` for UX delay.
- Variable dependencies: ✅

---

## Button: Turbo Wizard Back
### Location
- **DOM Element**: `#tw-back-btn`
- **Line**: 5001

### Event Binding
- **Handler**: `_turboWizardGoTo('tw-step-1')`

---

## Button: Turbo Wizard Done Install (Verify)
### Location
- **DOM Element**: `#tw-done-install-btn`
- **Line**: 5002

### Event Binding
- **Handler**: `_turboWizardVerify()`

### Code Trace
UI click → `_turboWizardVerify()` → go to step 3 → wait 1.5s → `NativeFetchBridgeService.isAvailable()` (with 4s timeout via `Promise.race`) → show success (with confetti) or not-found step.

### Handler analysis
- Null/undefined handling: ✅ `overlay` null check.
- Try/catch for async: ✅ `isAvailable()` wrapped in try/catch (lines 5066–5071).
- Promise handling: ✅ `Promise.race` with timeout prevents infinite hang.
- Variable dependencies: ✅ `NativeFetchBridgeService` imported.

---

## Button: Turbo Wizard Success Close
### Location
- **DOM Element**: `#tw-success-close-btn`
- **Line**: 5003

### Event Binding
- **Handler**: `_closeTurboWizard()` + `_checkNativeBridgeStatus()`

---

## Button: Turbo Wizard Not Found Skip
### Location
- **DOM Element**: `#tw-notfound-skip-btn`
- **Line**: 5007

### Event Binding
- **Handler**: `_closeTurboWizard()`

---

## Button: Turbo Wizard Retry
### Location
- **DOM Element**: `#tw-retry-btn`
- **Line**: 5008

### Event Binding
- **Handler**: `_turboWizardGoTo('tw-step-2')`

---

## Button: Backdrop Click
### Location
- **DOM Element**: `.tw-backdrop` inside `#turbo-wizard-overlay`
- **Line**: 5011

### Event Binding
- **Handler**: `_closeTurboWizard()`

---

## Shared Helper: `_turboWizardGoTo(stepId)`
### Location
- **Line**: 5019

### Code Trace
Hides all `.tw-step` elements → shows the target step by ID → updates dot indicator.

### Static Analysis
- ✅ Synchronous, straightforward DOM manipulation.

---

## Static Analysis (All Turbo Wizard Buttons)

### Element exists and is rendered
✅ All elements are referenced by `getElementById` within `_openTurboWizard()`. The wizard overlay is present in popup.html.

### Event binding confirmed
✅ All buttons bound inside the `if (!overlay._wizardBound)` guard (line 4995), ensuring one-time binding. Uses `_wizardBound` flag on the overlay DOM element.

### Handler analysis (aggregate)
- Null/undefined handling: ✅ All element references checked.
- Try/catch for async: ✅ Both `_turboWizardBeginDownload` and `_turboWizardVerify` have try/catch.
- Promise handling: ✅ All async operations properly awaited. `Promise.race` used for timeout.
- Variable dependencies: ✅

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Open wizard | Shows step 0, resets state | [Unverified] — requires browser runtime |
| Start download — success | Progress bar fills, advances to step 2 | [Unverified] — requires browser runtime |
| Start download — failure | Shows error in progress label | [Unverified] — requires browser runtime |
| Verify install — bridge available | Shows success step with confetti | [Unverified] — requires browser runtime |
| Verify install — bridge not found | Shows not-found step | [Unverified] — requires browser runtime |
| Skip/Close at any step | Hides overlay | [Unverified] — requires browser runtime |
| Back from step 2 | Returns to step 1 | [Unverified] — requires browser runtime |
| Retry from not-found | Goes back to step 2 | [Unverified] — requires browser runtime |
| Backdrop click | Closes wizard | [Unverified] — requires browser runtime |
| Double open | Resets wizard state each time | [Unverified] — requires browser runtime |

## Status: ✅ — Well-structured wizard with proper guards and error handling.

## Issues Found
None.
