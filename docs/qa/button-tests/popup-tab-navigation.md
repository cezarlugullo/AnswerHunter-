# Buttons: Tab Navigation

## Overview
Tab navigation buttons switch between the popup's main views (search, binder, disciplinas).

---

## Tab Buttons (`.tab-btn`)
### Location
- **Screen**: Popup — Tab bar
- **DOM Element**: `.tab-btn` elements (NodeList)
- **File**: `src/controllers/PopupController.js`
- **Lines**: 214–224

### Event Binding
- **Event**: click (on each tab)
- **Handler**: Inline — reads `tab.dataset.tab`, calls `view.switchTab(target)`, then conditionally renders binder or disciplinas.
- **Bound at**: lines 214–224 via `this.view.elements.tabs.forEach(...)`

### Code Trace
UI click → read `tab.dataset.tab` → `view.switchTab(target)` → if `target === 'binder'` → `BinderController.renderBinder()` | if `target === 'disciplinas'` → `DisciplinasController.renderDisciplinas()`

### Static Analysis

#### Element exists and is rendered
✅ `tabs` cached as `document.querySelectorAll('.tab-btn')` in `PopupView.cacheElements()` at line 140. Present in popup.html.

#### Event binding confirmed
✅ Bound via `forEach` loop. Each tab gets its own click listener.

#### Handler analysis
- Null/undefined handling: ✅ `tab.dataset.tab` is always a string (empty string if absent). `view.switchTab()` handles the active class toggling internally.
- Try/catch for async: ⚠️ The handler is not async, but `BinderController.renderBinder()` and `DisciplinasController.renderDisciplinas()` are async. They are called without `await` — fire-and-forget.
- Promise handling: ⚠️ `renderBinder()` and `renderDisciplinas()` return promises that are not awaited. If they throw, it results in unhandled promise rejections.
- Variable dependencies: ✅ `BinderController` and `DisciplinasController` initialized before event binding.

---

## Button: Settings (Gear Icon)
### Location
- **DOM Element**: `#settingsBtn`
- **File**: `src/controllers/PopupController.js`
- **Line**: 100

### Event Binding
- **Event**: click
- **Handler**: `toggleSetupPanel()`
- **Bound at**: line 100

### Code Trace
UI click → `toggleSetupPanel()` → checks if onboarding view is hidden → if showing: determines reopen vs first-time mode → `view.setSetupVisible(true)` → `determineCurrentStep()` → `goToSetupStep(startStep)` → if hiding: `view.setSetupVisible(false)`

### Handler analysis
- Null/undefined handling: ✅ `this.view.elements.onboardingView?.classList.contains('hidden')` uses optional chaining.
- Try/catch for async: ⚠️ `toggleSetupPanel` is async but the click handler does not handle its rejection. However, internal logic is self-contained.
- Promise handling: ✅ Internally all awaited (`determineCurrentStep()`, `SettingsModel.getSettings()`).
- Variable dependencies: ✅

---

## Button: Binder "Go to Search" CTA
### Location
- **DOM Element**: `#binderGoToSearch`
- **File**: `src/controllers/PopupController.js`
- **Lines**: 318–320

### Event Binding
- **Event**: click
- **Handler**: `this.view.switchTab('search')`
- **Bound at**: lines 318–320

### Static Analysis
- ✅ Simple view method call, synchronous, no error risk.

---

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Click Search tab | Shows search section | [Unverified] — requires browser runtime |
| Click Binder tab | Shows binder section, renders binder list | [Unverified] — requires browser runtime |
| Click Disciplinas tab | Shows disciplinas section, renders list | [Unverified] — requires browser runtime |
| Click Settings button | Opens/closes setup panel | [Unverified] — requires browser runtime |
| Click Binder Go to Search | Switches to search tab | [Unverified] — requires browser runtime |
| Rapid tab switching | No race conditions — rendering is idempotent | [Unverified] — requires browser runtime |
| Tab with empty binder data | Binder renders empty state | [Unverified] — requires browser runtime |

## Status: ⚠️ — Functional, but tab handlers have unhandled async calls.

## Issues Found
- **S3 (Low)**: Tab click handlers call async methods (`renderBinder()`, `renderDisciplinas()`) without awaiting them and without catch handlers. If these methods throw, the promise rejection is unhandled. Recommendation: make the tab click handler async and await the render calls, or add `.catch()`.
