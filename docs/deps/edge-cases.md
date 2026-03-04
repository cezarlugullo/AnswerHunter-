# Edge Cases — AnswerHunter v1.3.0

Analysis of dynamic references, runtime messages, and indirect file usage that could make
statically-unreachable files actually alive at runtime.

---

## 1. Dynamic `import()` Calls (7 occurrences)

All dynamic imports resolve to files already in the static reachable set. No edge case here.

| File | Line | Target | Reachable? |
|---|---|---|---|
| `PopupController.js` | 359 | `../services/ApiService.js` | ✅ |
| `PopupController.js` | 556 | `../services/GeminiCLIAuthService.js` | ✅ |
| `PopupController.js` | 4702 | `../services/CorrectionFeedback.js` | ✅ |
| `PopupController.js` | 4737 | `../services/ApiService.js` | ✅ |
| `PopupController.js` | 4783 | `../services/ApiService.js` | ✅ |
| `PopupController.js` | 4871 | `../services/ApiService.js` | ✅ |
| `FreeTextAnswerService.js` | 21 | `../ApiService.js` | ✅ |

**Conclusion**: No unreachable file is rescued by dynamic imports.

---

## 2. `chrome.runtime.getURL()` References (9 occurrences)

| File | Line | URL Referenced | Reachable? |
|---|---|---|---|
| `background.js` | 226 | `src/dashboard/dashboard-v2.html` | ✅ |
| `BinderController.js` | 674 | `src/study/study.html` | ✅ |
| `DisciplinasController.js` | 215 | `src/study/study.html` | ✅ |
| `DisciplinasController.js` | 220 | `src/study/study.html` | ✅ |
| `dashboard-v2.js` | 146 | `src/dashboard/dashboard-v2.html` | ✅ |
| `dashboard-v2.js` | 579 | `src/study/study.html` | ✅ |
| `dashboard-v2.js` | 703 | ``src/dashboard/discipline-detail.html?id=${discId}`` | ✅ (path prefix resolved statically) |
| `discipline-detail.html` | 314 | `src/dashboard/dashboard-v2.html` | ✅ |
| `study.js` | 3453 | `src/dashboard/dashboard-v2.html` | ✅ (but study.js itself is unreachable) |

**Note**: `study.js:3453` references `dashboard-v2.html`, but `study.js` itself is never loaded.
No unreachable files referenced — only `dashboard-v2.html` and `study.html` (both reachable).

**Special check**: No code uses `getURL('src/dashboard/dashboard.html')` or `getURL('src/popup/new_popup.html')`.

---

## 3. `chrome.runtime` Message Passing

### Senders (6 occurrences)
| File | Line | Message Type |
|---|---|---|
| `background.js` | 164 | `CHATGPT_AUTH_SUCCESS` |
| `background.js` | 167 | `CHATGPT_AUTH_FAILED` |
| `background.js` | 183 | `GEMINI_CLI_AUTH_SUCCESS` |
| `background.js` | 186 | `GEMINI_CLI_AUTH_FAILED` |
| `PopupController.js` | 3960 | `SEARCH_PHASE2` |
| `CopilotAuthService.js` | 331 | `COPILOT_AUTH_*` |

### Listeners (2 occurrences)
| File | Line | Handles |
|---|---|---|
| `background.js` | 217 | `SEARCH_PHASE2`, `AH_OPEN_DASHBOARD_V2`, `AH_EVALUATE_BADGES`, `AH_RECORD_REVIEW`, `AH_END_SESSION` |
| `PopupController.js` | 63 | `CHATGPT_AUTH_SUCCESS`, `CHATGPT_AUTH_FAILED`, `GEMINI_CLI_AUTH_SUCCESS`, `GEMINI_CLI_AUTH_FAILED`, `COPILOT_AUTH_*` |

**Conclusion**: All message senders and listeners are in reachable files. No unreachable file participates in message passing. `content.js` only listens for `action: 'highlight'` and that's in the manifest content script.

---

## 4. `chrome.tabs.sendMessage` / `chrome.scripting.executeScript`

### `chrome.scripting.executeScript` (27 occurrences)
All in reachable files: `PopupController.js`, `BackgroundTabExtractorService.js`, `CloudflareBypassService.js`, `HumanMouseSimulator.js`, `StealthEvasions.js`, `PlatformExtractors.js`.

These inject **inline functions** (not file references), so no unreachable JS files are loaded this way.

---

## 5. `chrome.alarms` (6 occurrences)

All in `background.js` (reachable):
- `COPILOT_OAUTH_ALARM` — polls for Copilot device code
- `AH_STUDY_REMINDER` — periodic study notifications
- `AH_DAILY_CLEANUP` — daily stale data cleanup

No unreachable files involved.

---

## 6. HTML/CSS Cross-References

### CSS `@import` chains
| File | Imports |
|---|---|
| `dashboard-v2.html` | `tokens.css`, `base.css`, `animations.css` |
| `discipline-detail.html` | `tokens.css`, `base.css`, `animations.css` |
| `study-hub.css` | 12 font files from `src/fonts/` |
| `popup.html` | `popup.css` (via `<link>`) |
| `study.html` | `study-hub.css` (via `<link>`) |

All CSS files are reachable via HTML pages that are themselves reachable.

### Inline `<script type="module">` in HTML
| File | Imports |
|---|---|
| `discipline-detail.html:161-163` | `ContentHierarchyService.js`, `ComponentLibrary.js` |

Both already in the reachable set.

---

## 7. `web_accessible_resources` Exposure

The manifest exposes broad glob patterns:
```
src/services/*.js, src/models/*.js, src/views/*.js, src/utils/*.js, src/i18n/*.js
```

This means ANY webpage could `fetch()` these JS files if it knows the extension ID. However, this doesn't mean these files are _used_ — it just means they're _fetchable_. The `search/index.js` barrel is exposed but unused.

---

## 8. Special Cases

### `src/popup/chrome-mock.js`
Loaded by `popup.html` as a non-module `<script>` before `popup.js`. Provides mock `chrome.*` APIs for offline/dev testing. It IS reachable (loaded every time popup opens).

### `src/dashboard/dashboard.js`
Loaded ONLY by `src/dashboard/dashboard.html`. Since `dashboard.html` is never referenced by any `getURL()` or `tabs.create()` call in the codebase, both `dashboard.html` and `dashboard.js` are dead together.

### `src/study/study.js`
Was the original study page controller. Superseded by `study-hub.js` when `study.html` was redesigned. `study.js` still imports `ApiService`, `PedagogicalPromptsService`, `FSRSService` — but since `study.html` loads `study-hub.js` instead, `study.js` is never executed.

### `src/services/search/index.js`
Barrel re-export file. Every consumer imports individual services directly (e.g., `import { QuestionParser } from './QuestionParser.js'`). Nobody imports from `./index.js` or `./search/index.js`.

### `src/popup/new_popup.html`
Empty file (1 byte). Never referenced.

### `src/background.js.bak`
Backup of `background.js`. Not in manifest, not loaded. Pure backup artifact.

### `src/controllers/PopupController.js.bak`, `src/services/SearchService.js.bak`, `src/dashboard/dashboard.html.bak`, `src/study/study.html.bak`
Additional backup artifacts (`*.bak`). `rg` search found no references, and none are listed in manifest entrypoints.

---

## Summary

| Edge Case Category | Files Rescued? | Details |
|---|---|---|
| Dynamic imports | 0 | All targets already reachable |
| `chrome.runtime.getURL` | 0 | Only `dashboard-v2.html` and `study.html` |
| Message passing | 0 | All handlers in reachable files |
| `chrome.scripting.executeScript` | 0 | Inline functions only |
| `chrome.alarms` | 0 | All in `background.js` |
| CSS/HTML cross-refs | 0 | All CSS/fonts reachable |
| `web_accessible_resources` | 0 | Exposure ≠ usage |

**No unreachable candidate was rescued by edge case analysis.**
