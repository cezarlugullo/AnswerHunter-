# Dashboard: Theme Controls

## Buttons in this group

### Button: Theme Toggle
- **DOM**: `#btnThemeToggle`
- **File**: dashboard-v2.js line 548
- **Handler**: Cycles between light (`""`) and dark (`"dark"`) themes by toggling the `data-theme` attribute on `<html>`. Persists to `chrome.storage.local` under key `ah_theme` when not in DEMO mode.
- **Trace**: UI click → read current `data-theme` → set next value (`""` ↔ `"dark"`) → `chrome.storage.local.set({ ah_theme })` (non-DEMO only)

#### Static Analysis
- Element reference: ✅ — uses optional chaining (`?.addEventListener`), null-safe
- Null safety: ✅ — `?.` prevents crash if element missing
- Error handling: ⚠️ — no error handling on `chrome.storage.local.set`; if storage quota exceeded or write fails, the error is silently swallowed
- DEMO mode guard: ✅ — checks `if (!DEMO)` before calling `chrome.storage.local.set`

#### Issues
- **S3 — Two-state toggle only**: The toggle cycles between `""` (light) and `"dark"` only. It does not cycle through the `"auto"` state that `btnAutoTheme` introduces, so a user who selected Auto via settings has their preference silently overwritten on next toggle click. Inconsistent with the three-state model on the settings page.
- **S3 — No storage error handling**: `chrome.storage.local.set` callback is not used; storage write failures are silent.

---

### Button: Light Theme
- **DOM**: `#btnLightTheme`
- **File**: dashboard-v2.js line 556
- **Handler**: Sets `data-theme=""` on `<html>` and persists `ah_theme: ""` to storage.
- **Trace**: UI click → `setAttribute('data-theme', '')` → `chrome.storage.local.set({ ah_theme: '' })` (non-DEMO only)

#### Static Analysis
- Element reference: ✅ — optional chaining used
- Null safety: ✅
- Error handling: ⚠️ — no error handling on storage write
- DEMO mode guard: ✅ — checks `if (!DEMO)` before storage call

#### Issues
- **S3 — No storage error handling**: Same as Theme Toggle.

---

### Button: Dark Theme
- **DOM**: `#btnDarkTheme`
- **File**: dashboard-v2.js line 560
- **Handler**: Sets `data-theme="dark"` on `<html>` and persists `ah_theme: "dark"` to storage.
- **Trace**: UI click → `setAttribute('data-theme', 'dark')` → `chrome.storage.local.set({ ah_theme: 'dark' })` (non-DEMO only)

#### Static Analysis
- Element reference: ✅ — optional chaining used
- Null safety: ✅
- Error handling: ⚠️ — no error handling on storage write
- DEMO mode guard: ✅ — checks `if (!DEMO)` before storage call

#### Issues
- **S3 — No storage error handling**: Same as Theme Toggle.

---

### Button: Auto Theme
- **DOM**: `#btnAutoTheme`
- **File**: dashboard-v2.js line 564
- **Handler**: Removes `data-theme` attribute entirely (lets OS/CSS `prefers-color-scheme` take over). Persists `ah_theme: "auto"` to storage.
- **Trace**: UI click → `removeAttribute('data-theme')` → `chrome.storage.local.set({ ah_theme: 'auto' })` (non-DEMO only)

#### Static Analysis
- Element reference: ✅ — optional chaining used
- Null safety: ✅
- Error handling: ⚠️ — no error handling on storage write
- DEMO mode guard: ✅ — checks `if (!DEMO)` before storage call

#### Issues
- **S3 — No storage error handling**: Same as Theme Toggle.
- **S3 — Auto state invisible to toggle**: After selecting Auto, using `btnThemeToggle` will not cycle back to Auto; toggle only knows two states.

---

## Cross-Cutting Issues

| ID | Severity | Description |
|----|----------|-------------|
| THM-1 | S3 | `btnThemeToggle` implements a two-state toggle (`""` ↔ `"dark"`) but the settings page exposes three states (light / dark / auto). The Auto state is unreachable from the toggle and is silently overwritten. |
| THM-2 | S3 | None of the four theme handlers wrap `chrome.storage.local.set` in a try/catch or use the callback to detect write errors. |
| THM-3 | S3 | No active-state indicator logic in the handlers — the user has no visual feedback for which theme button is currently selected on the settings page. UI may rely on CSS `:active` / external logic, but the handlers themselves do not toggle any active class. |

## Test Scenarios

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 1 | Click `btnThemeToggle` when current theme is light | `data-theme` set to `"dark"`, `ah_theme: "dark"` saved | [Unverified] — requires browser runtime |
| 2 | Click `btnThemeToggle` when current theme is dark | `data-theme` set to `""`, `ah_theme: ""` saved | [Unverified] — requires browser runtime |
| 3 | Click `btnThemeToggle` when current theme is auto (no attribute) | `data-theme` set to `"dark"` (attribute was `null`, handler reads it as falsy → next = `"dark"`) | [Unverified] — requires browser runtime |
| 4 | Click `btnLightTheme` | `data-theme=""`, stored as `""` | [Unverified] — requires browser runtime |
| 5 | Click `btnDarkTheme` | `data-theme="dark"`, stored as `"dark"` | [Unverified] — requires browser runtime |
| 6 | Click `btnAutoTheme` | `data-theme` attribute removed, stored as `"auto"` | [Unverified] — requires browser runtime |
| 7 | Set Auto then use toggle | Auto preference lost — toggle overrides with `""` or `"dark"` | [Unverified] — requires browser runtime |
| 8 | All theme buttons in DEMO mode | Theme visually changes but nothing written to storage | [Unverified] — requires browser runtime |
| 9 | Storage quota exceeded during theme save | Error silently ignored; UI theme still changes | [Unverified] — requires browser runtime |

## Overall Status: ⚠️ — Functional but with minor inconsistencies (two-state toggle vs three-state settings, no storage error handling)
