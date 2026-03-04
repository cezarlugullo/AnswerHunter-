# Recommendations — AnswerHunter v1.3.0

## Classification of Unreachable Candidates

### 🟢 Alta Confiança — Ready to Graveyard

These files are proven dead with multiple lines of evidence:

---

#### 1. `src/study/study.js` (~5600 lines)

| Criterion | Evidence |
|---|---|
| Not in manifest | ✅ Not listed in `manifest.json` |
| Not loaded by any HTML | ✅ `study.html` loads `study-hub.js` only (line 932) |
| Not imported by any JS | ✅ Zero in-degree in import graph |
| Not referenced by `getURL` | ✅ No `getURL('...study.js')` anywhere |
| Not referenced by strings | ✅ Only self-references in comments |
| Superseded by | `src/study/study-hub.js` (redesigned "Study Hub" controller) |
| Dynamic import check | ✅ No `import('...study.js')` |
| Message handler check | ✅ Not a message listener target |

**Confidence**: 🟢 HIGH  
**Motivo**: Superseded by `study-hub.js`. `study.html` was rewritten to load the new controller. The old `study.js` is a dead legacy file.  
**Risco**: Zero. `study-hub.js` is the active controller.  
**Sugestão**: Move to `graveyard/src/study/study.js`  
**Estimated savings**: ~5600 lines, ~244 KB

---

#### 2. `src/services/search/index.js` (~10 lines)

| Criterion | Evidence |
|---|---|
| Not in manifest | ✅ |
| Not loaded by any HTML | ✅ |
| Not imported by any JS | ✅ Zero in-degree; consumers import individual files |
| Not referenced by strings | ✅ Only self-reference in JSDoc comment |
| Purpose | Barrel re-export for `QuestionParser`, `OptionsMatchService`, etc. |

**Confidence**: 🟢 HIGH  
**Motivo**: Barrel file that nobody uses. Every consumer imports directly: `from './QuestionParser.js'` etc.  
**Risco**: Zero. Removing it changes nothing; direct imports work.  
**Sugestão**: Move to `graveyard/src/services/search/index.js`  
**Estimated savings**: ~10 lines

---

#### 3. `src/dashboard/dashboard.html` + `src/dashboard/dashboard.js` (legacy dashboard)

| Criterion | Evidence |
|---|---|
| Not in manifest | ✅ Not referenced as popup, options, or page |
| Not referenced by `getURL` | ✅ All `getURL` calls use `dashboard-v2.html` |
| Not imported by any JS | ✅ `dashboard.js` has zero in-degree |
| Superseded by | `src/dashboard/dashboard-v2.html` + `dashboard-v2.js` |

**Confidence**: 🟢 HIGH  
**Motivo**: The old dashboard v1 was replaced by v2. No code references `dashboard.html`.  
**Risco**: Zero. `dashboard-v2.*` is the active dashboard.  
**Sugestão**: Move both to `graveyard/src/dashboard/`  
**Estimated savings**: `dashboard.html` (~600 lines) + `dashboard.js` (~200 lines)

---

#### 4. `src/popup/new_popup.html` (empty file)

| Criterion | Evidence |
|---|---|
| File content | Empty (1 byte) |
| Not in manifest | ✅ |
| Not referenced anywhere | ✅ |

**Confidence**: 🟢 HIGH  
**Motivo**: Empty placeholder file, never created/used.  
**Risco**: Zero.  
**Sugestão**: Move to `graveyard/src/popup/new_popup.html` or delete directly.  
**Estimated savings**: 1 file

---

#### 5. `src/background.js.bak` (backup file)

| Criterion | Evidence |
|---|---|
| File extension | `.bak` — obvious backup |
| Not in manifest | ✅ Service worker is `src/background.js` |
| Not imported/referenced | ✅ |

**Confidence**: 🟢 HIGH  
**Motivo**: Manual backup of `background.js`. Not loaded by Chrome.  
**Risco**: Zero.  
**Sugestão**: Move to `graveyard/src/background.js.bak` or delete directly.

---

#### 6. Additional backup artifacts (`*.bak`)

Files:
- `src/controllers/PopupController.js.bak`
- `src/services/SearchService.js.bak`
- `src/dashboard/dashboard.html.bak`
- `src/study/study.html.bak`

| Criterion | Evidence |
|---|---|
| File extension | ✅ `.bak` backup artifacts |
| Not in manifest | ✅ No `.bak` path in `manifest.json` |
| Not imported/referenced | ✅ `rg` found no references to these filenames |
| Runtime loading path | ✅ extension entrypoints point to non-`.bak` files only |

**Confidence**: 🟢 HIGH  
**Motivo**: Backup snapshots not connected to manifest/import graph/runtime references.  
**Risco**: Zero.  
**Sugestão**: Move each file to matching path under `graveyard/`.

---

## Dynamic Execution Check

| Scenario | Method | Result |
|---|---|---|
| Popup open | Static analysis of HTML `<script>` tags | `popup.js` → full tree reachable |
| Dashboard open | Static analysis of `getURL` → `dashboard-v2.html` | `dashboard-v2.js` → tree reachable |
| Study open | Static analysis of `getURL` → `study.html` | `study-hub.js` → tree reachable |
| Content script | Manifest `content_scripts` | `content.js` loaded on all pages |
| Background | Manifest `service_worker` | `background.js` always running |
| Chrome headless run | `chrome.exe --headless --disable-extensions-except --load-extension` | Warning shows flag ignored (`extension_service.cc:428`) |
| Edge headless run | `msedge.exe --headless --disable-extensions-except --load-extension` | [Unverified] no explicit custom-extension load signal in logs |
| Playwright smoke | `npx ... playwright` runtime attempt | Failed: `MODULE_NOT_FOUND: playwright` in node script context |

**Note**: [Unverified] Full interactive extension exercise (popup clicks, dashboard/study flows) could not be completed in this CLI session. Classification is based on static analysis plus partial runtime attempts above, with high confidence because:
1. No bundler — files must be explicitly referenced by HTML or import statements
2. Chrome MV3 enforces strict CSP — no `eval()`, no remote scripts
3. All `chrome.runtime.getURL()` calls were enumerated exhaustively
4. All `import()` dynamic calls were enumerated exhaustively

---

## Observations (not dead, but noteworthy)

### `src/popup/chrome-mock.js`
- Loaded by every popup open, even in production
- Only useful in development (mocks `chrome.*` APIs)
- **Suggestion**: Gate behind a build flag or `#if DEV` to save ~3KB in production
- **Confidence**: Not dead — just wasteful in production

### `web_accessible_resources` over-exposure
- The manifest exposes all `src/services/*.js`, `src/models/*.js`, etc. to `<all_urls>`
- Any webpage can `fetch()` these files if it discovers the extension ID
- **Suggestion**: Restrict to `chrome-extension://` origin or specific pages
- **Confidence**: Security concern, not dead code

### Large files that could be split
- `src/controllers/PopupController.js` — 244.5 KB, ~5000 lines
- `src/popup/popup.html` — 78.8 KB
- **Suggestion**: Refactor into smaller modules for maintainability

---

## Ready to Graveyard (Alta Confiança)

```
graveyard/src/study/study.js                    # ~5600 lines, superseded by study-hub.js
graveyard/src/services/search/index.js          # ~10 lines, unused barrel
graveyard/src/dashboard/dashboard.html          # ~600 lines, superseded by dashboard-v2.html
graveyard/src/dashboard/dashboard.js            # ~200 lines, superseded by dashboard-v2.js
graveyard/src/popup/new_popup.html              # 1 byte, empty placeholder
graveyard/src/background.js.bak                 # backup artifact
graveyard/src/controllers/PopupController.js.bak # backup artifact
graveyard/src/services/SearchService.js.bak      # backup artifact
graveyard/src/dashboard/dashboard.html.bak       # backup artifact
graveyard/src/study/study.html.bak               # backup artifact
```

**Total estimated dead code**: ~6400+ lines across 10 files.

## Investigar (Média/Baixa Confiança)

None. All candidates are high-confidence dead code. The codebase is well-structured with clean imports.

---

## Action Plan

1. **Create `graveyard/` directory** at project root
2. **Move 10 files** listed above (preserving directory structure)
3. **Verify extension loads** after removal (load unpacked in Chrome, test popup/dashboard/study)
4. **Commit** with descriptive message referencing this analysis
5. **Optional**: Tighten `web_accessible_resources` in manifest
6. **Optional**: Remove `chrome-mock.js` from production popup.html
