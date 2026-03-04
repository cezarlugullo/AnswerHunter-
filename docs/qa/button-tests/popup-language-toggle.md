# Buttons: Language Toggle

## Overview
Two language toggle containers exist: one in the main app header and one in the onboarding overlay. Both use the same handler and delegate-style event binding.

---

## Main App Language Toggle
### Location
- **Screen**: Popup — Header area
- **DOM Element**: `#languageToggle` (container with `.lang-btn` children)
- **File**: `src/controllers/PopupController.js`
- **Lines**: 228–233

### Event Binding
- **Event**: click (delegated)
- **Handler**: `handleLanguageChange(btn.dataset.lang)`
- **Bound at**: lines 228–233 via `this.view.elements.languageToggle?.addEventListener('click', ...)`
- **Delegation**: `event.target.closest('.lang-btn')` — only fires if a `.lang-btn` was clicked.

### Code Trace
UI click → find `.lang-btn` ancestor → read `btn.dataset.lang` → `handleLanguageChange(language)` → `I18nService.setLanguage(language)` → `I18nService.apply(document)` → `syncLanguageSelector()` → if binder tab active → `BinderController.renderBinder()` | else → `restoreLastResults({ clear: true })`

### Handler analysis
- Null/undefined handling: ✅ Guard `if (btn && btn.dataset.lang)` ensures both the button and lang data exist.
- Try/catch for async: ⚠️ `handleLanguageChange` is async (line 388) but the click handler `async (event) => { ... }` doesn't have try/catch. However, `handleLanguageChange` itself has no internal try/catch either.
- Promise handling: ✅ All calls inside `handleLanguageChange` are properly awaited: `I18nService.setLanguage()`, `syncLanguageSelector()`, `renderBinder()`, `restoreLastResults()`.
- Variable dependencies: ✅ `I18nService` imported at module level.

---

## Onboarding Language Toggle
### Location
- **DOM Element**: `#obLanguageToggle` (container with `.ob-lang-btn` children)
- **File**: `src/controllers/PopupController.js`
- **Lines**: 294–299

### Event Binding
- **Event**: click (delegated)
- **Handler**: `handleLanguageChange(btn.dataset.lang)`
- **Bound at**: lines 294–299
- **Delegation**: `event.target.closest('.ob-lang-btn')`

### Static Analysis
- Same handler as main toggle, same analysis applies.

---

## Shared Handler: `handleLanguageChange(language)`

### Location
- **File**: `src/controllers/PopupController.js`
- **Line**: 388

### Code Trace
```
handleLanguageChange(language)
  → I18nService.setLanguage(language)     // persists language to storage
  → I18nService.apply(document)           // updates all [data-i18n] elements
  → syncLanguageSelector()                // syncs toggle UI state
  → if binder tab active:
      → BinderController.renderBinder()
  → else:
      → restoreLastResults({ clear: true })
```

### Handler analysis
- Null/undefined handling: ⚠️ `language` parameter is not validated. If `btn.dataset.lang` is an unexpected value (e.g., `'fr'`), `I18nService.setLanguage()` may fail silently or use a fallback.
- Try/catch for async: ⚠️ No try/catch. If any of the awaited calls throw, the error propagates as an unhandled rejection from the click handler.
- Promise handling: ✅ All internal calls are properly awaited.
- Variable dependencies: ✅

---

## `syncLanguageSelector()`
### Location
- **Line**: 383

### Code Trace
`syncLanguageSelector()` → `SettingsModel.getSettings()` → `view.setLanguageSelectValue(settings.language || 'en')`

### Static Analysis
- ✅ Simple getter + view update. No error risk beyond missing settings.

---

## Test Scenarios
| Scenario | Expected | Status |
|----------|----------|--------|
| Switch to Portuguese (pt) | All i18n strings update, toggle reflects PT active | [Unverified] — requires browser runtime |
| Switch to English (en) | All i18n strings update, toggle reflects EN active | [Unverified] — requires browser runtime |
| Switch language while on binder tab | Binder re-renders with new language | [Unverified] — requires browser runtime |
| Switch language while on search tab | Results re-rendered with clear | [Unverified] — requires browser runtime |
| Click non-button area in toggle container | Delegation guard prevents handler execution | [Unverified] — requires browser runtime |
| Onboarding language toggle | Same behavior as main toggle | [Unverified] — requires browser runtime |
| Rapid language switching | No race condition — each call awaits the previous | [Unverified] — requires browser runtime |

## Status: ⚠️ — Works correctly but lacks try/catch.

## Issues Found
- **S3 (Low)**: `handleLanguageChange()` at line 388 has no try/catch. If `I18nService.setLanguage()` or `I18nService.apply()` throws, the error is unhandled.
- **S3 (Low)**: No validation on the `language` parameter value — relies on the data attribute being correct.
