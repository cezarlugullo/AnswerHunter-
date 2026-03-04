# Entrypoints — AnswerHunter v1.3.0

Chrome Extension MV3 — no bundler, raw ES modules loaded directly by Chrome.

## Manifest Entrypoints (from `manifest.json`)

| Entrypoint | Type | File |
|---|---|---|
| Service Worker | `background.service_worker` | `src/background.js` |
| Content Script JS | `content_scripts[0].js` | `src/content/content.js` |
| Content Script CSS | `content_scripts[0].css` | `src/content/content.css` |
| Popup HTML | `action.default_popup` | `src/popup/popup.html` |
| DNR Rules | `declarative_net_request.rule_resources` | `src/rules/headers.json` |

## HTML Pages (loaded via `chrome.runtime.getURL` or `chrome.tabs.create`)

| Page | Loaded By | Script(s) | CSS |
|---|---|---|---|
| `src/popup/popup.html` | manifest `action.default_popup` | `src/popup/chrome-mock.js`, `src/popup/popup.js` | `src/popup/popup.css` |
| `src/dashboard/dashboard-v2.html` | `background.js:226`, `dashboard-v2.js:146` | `src/dashboard/dashboard-v2.js` | inline + `src/styles/{tokens,base,animations}.css` |
| `src/dashboard/discipline-detail.html` | `dashboard-v2.js:703` | inline `<script type="module">` (imports ContentHierarchyService, ComponentLibrary) | inline + `src/styles/{tokens,base,animations}.css` |
| `src/study/study.html` | `BinderController.js:674`, `DisciplinasController.js:215,220`, `dashboard-v2.js:579` | `src/study/study-hub.js` | `src/study/study-hub.css` |

## JS Module Entrypoints (resolved from HTML `<script>` tags)

1. `src/background.js` — service worker (type: module)
2. `src/content/content.js` — content script (IIFE, no imports)
3. `src/popup/chrome-mock.js` — mock layer for popup dev
4. `src/popup/popup.js` — popup main entry
5. `src/dashboard/dashboard-v2.js` — dashboard v2 entry
6. `src/dashboard/dashboard.js` — **legacy** dashboard (loaded by `dashboard.html`)
7. `src/study/study-hub.js` — study hub entry (redesign)

## Non-JS Assets Referenced by Manifest

| Resource | Type | Referenced By |
|---|---|---|
| `icons/icon{16,32,48,128}.png` | Icons | manifest `icons` + `action.default_icon` |
| `src/rules/headers.json` | DNR rules | manifest `declarative_net_request` |
| `src/content/content.css` | CSS | manifest `content_scripts[0].css` |

## `web_accessible_resources` Patterns

All under `<all_urls>`:
- `src/native/*`
- `src/dashboard/*`
- `src/styles/*.css`
- `src/services/*.js`
- `src/views/*.js`
- `src/study/*`
- `src/fonts/*`
- `src/models/*.js`
- `src/utils/*.js`
- `src/i18n/*.js`
