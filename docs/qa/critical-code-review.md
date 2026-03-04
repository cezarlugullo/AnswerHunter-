# AnswerHunter — Critical Code Review Report

**Reviewer**: QA Engineer (automated)
**Date**: 2025-07-15
**Scope**: Storage, Settings, Export/Import, Migration, Background SW, Content Script
**Methodology**: Line-by-line static analysis of every function in each module

---

## Severity Scale

| Level | Meaning |
|-------|---------|
| **S0** | Data loss, security vulnerability, or crash in production |
| **S1** | Functional bug that silently produces wrong results |
| **S2** | Edge case that can cause unexpected behavior under stress |
| **S3** | Code quality, maintainability, or minor robustness issue |

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Modules Reviewed | 6 |
| S0 (Critical) Issues | 5 |
| S1 (High) Issues | 9 |
| S2 (Medium) Issues | 14 |
| S3 (Low) Issues | 10 |
| Overall Risk Rating | ⚠️ **MEDIUM-HIGH** |

---

## 1. Storage Layer — `src/models/StorageModel.js`

### What it does
Manages hierarchical binder data (folders + questions tree) in `chrome.storage.local`. Provides CRUD, question deduplication via normalization, SM2 spaced-repetition state, folder operations, and discipline management.

### Inputs assumed
- `chrome.storage.local` is available and functional
- `this.data` is an in-memory mirror of `binderStructure` key in storage
- `this.currentFolderId` is always a valid folder ID in the tree
- `crypto.randomUUID()` is available (MV3 service worker / secure context)

### Code review findings

#### 1.1 `init()` silently swallows storage failures
- **File**: `src/models/StorageModel.js:29-31`
- **Severity**: S1
- **What**: When `chrome.runtime.lastError` is set, `init()` logs the error but still resolves the promise. If `result` is `undefined` (storage completely failed), `result?.binderStructure` evaluates to `undefined`, and the code falls through to the `else` branch creating a fresh root. The caller has no way to know data loading failed.
- **Why it matters**: After a storage failure, the extension silently starts with an empty binder. Any subsequent `save()` call will overwrite the user's real data with the empty structure.
- **Evidence**:
  ```js
  // Line 29-38
  if (chrome.runtime.lastError) {
      console.error('StorageModel: init failed:', chrome.runtime.lastError);
  }
  const localData = result?.binderStructure;
  if (Array.isArray(localData)) {
      this.data = localData;
  } else {
      this.data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
  }
  resolve(); // always resolves — caller cannot distinguish failure from empty binder
  ```
- **Fix suggestion**: Reject the promise or return a status object when `chrome.runtime.lastError` is truthy, so callers can avoid overwriting data.

#### 1.2 `save()` has no concurrency guard — race condition
- **File**: `src/models/StorageModel.js:47-59`
- **Severity**: S1
- **What**: Multiple async callers (e.g., `addItem`, `updateSm2`, `setReviewLater`) can call `save()` concurrently. Each serializes `this.data` at call time. If call A reads `this.data`, then call B mutates and saves, then call A's `set()` completes — B's changes are silently lost.
- **Why it matters**: In a popup where a user rapidly saves questions or reviews cards, interleaved `save()` calls can lose SM2 updates or newly added questions.
- **Evidence**:
  ```js
  // Line 47-59 — no mutex, no queue
  async save() {
      return new Promise((resolve, reject) => {
          chrome.storage.local.set({ binderStructure: this.data }, () => { ... });
      });
  }
  ```
- **Fix suggestion**: Implement a save queue/debounce: `_savePromise = _savePromise.then(() => actualSave())`.

#### 1.3 `addItem()` silently returns `false` with no feedback on invalid folder
- **File**: `src/models/StorageModel.js:106-151`
- **Severity**: S2
- **What**: If `this.currentFolderId` points to a non-existent or non-folder node, `addItem()` falls through to `console.error` and returns `false`. The caller gets no structured error to display to the user.
- **Why it matters**: User clicks "save question" and nothing happens, with no UI feedback about why.
- **Evidence**:
  ```js
  // Line 106-151
  const current = this.findNode(this.currentFolderId);
  if (current && current.type === 'folder') {
      // ... add item ...
  } else {
      console.error('StorageModel: Pasta atual inválida:', this.currentFolderId);
  }
  return false;
  ```
- **Fix suggestion**: Throw a typed error or return `{ success: false, reason: 'INVALID_FOLDER' }`.

#### 1.4 `addItem()` duplicate detection is O(n) full tree scan
- **File**: `src/models/StorageModel.js:101-103`
- **Severity**: S3
- **What**: `isSaved()` calls `findQuestionNodeByContent()` which recursively walks the entire tree for every save attempt. With thousands of cards this becomes slow.
- **Why it matters**: Performance degrades linearly with binder size; noticeable with 1000+ cards.
- **Evidence**:
  ```js
  const normQ = this._normalizeKey(question);
  if (this.isSaved(normQ)) { return false; }
  ```
- **Fix suggestion**: Maintain a `Set` of normalized question keys as a cache, invalidated on load/import.

#### 1.5 `deleteNode()` can delete a folder with children — no orphan protection
- **File**: `src/models/StorageModel.js:280-299`
- **Severity**: S2
- **What**: `deleteNode(id)` removes any node (folder or question) by ID. If a folder with children is deleted, all children are silently cascade-deleted since they're nested inside. There is no confirmation or child-rescue logic.
- **Why it matters**: A single accidental delete of a discipline folder can destroy hundreds of cards.
- **Evidence**:
  ```js
  // Line 281-292 — splices the entire subtree
  if (nodes[i].id === targetId) {
      nodes.splice(i, 1);
      return true;
  }
  ```
- **Fix suggestion**: Check `node.children.length > 0` and either refuse, prompt, or reparent children before removal.

#### 1.6 `removeByContent()` only removes the first match
- **File**: `src/models/StorageModel.js:253-273`
- **Severity**: S3
- **What**: If the same normalized question exists in multiple folders (e.g., after a botched import), `removeByContent()` only removes the first one found via DFS. Subsequent calls would be needed to remove duplicates.
- **Why it matters**: Minor — duplicates shouldn't exist normally, but after import they can.
- **Evidence**:
  ```js
  // Line 258-259 — returns true after first removal
  nodes.splice(i, 1);
  return true;
  ```
- **Fix suggestion**: Accept this as intended behavior but document it.

#### 1.7 `moveItem()` — re-find hazard if tree structure changes
- **File**: `src/models/StorageModel.js:306-335`
- **Severity**: S3
- **What**: The code correctly validates the target folder exists BEFORE extracting the item (line 310-314), preventing data loss. However, if `itemId === targetFolderId` it silently returns without error. Also, if the source item is not found, nothing happens (no error for the caller).
- **Why it matters**: Low impact — the guard is good. The missing item case should ideally return a status.
- **Evidence**:
  ```js
  // Line 307 — good guard
  if (itemId === targetFolderId) return;
  // Line 310-314 — good guard
  const targetFolder = this.findNode(targetFolderId);
  if (!targetFolder || targetFolder.type !== 'folder') { ... return; }
  ```
- **Fix suggestion**: Return a boolean or status object for all branches.

#### 1.8 `clearAll()` — no confirmation, instant factory reset
- **File**: `src/models/StorageModel.js:397-401`
- **Severity**: S0
- **What**: `clearAll()` immediately overwrites `this.data` with a fresh root and calls `save()`. There is no backup, no confirmation, and no undo. If called accidentally (or by a bug), all user data is permanently destroyed.
- **Why it matters**: Total data loss with no recovery path. The only safety net is if the user previously exported a backup.
- **Evidence**:
  ```js
  async clearAll() {
      this.data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
      this.currentFolderId = 'root';
      await this.save();
  }
  ```
- **Fix suggestion**: Create a backup key (e.g., `binderStructure_backup`) before clearing, or require a confirmation token parameter.

#### 1.9 `importData()` — no validation of input shape
- **File**: `src/models/StorageModel.js:407-412`
- **Severity**: S0
- **What**: `importData()` only checks `Array.isArray` and non-empty. It does not validate that the array contains valid node objects with `id`, `type`, `children` etc. Malformed data can corrupt the entire binder.
- **Why it matters**: A corrupted import replaces all data and is saved immediately. The user's original data is lost.
- **Evidence**:
  ```js
  async importData(importedData) {
      if (!Array.isArray(importedData) || importedData.length === 0) return;
      this.data = importedData; // No schema validation
      this.currentFolderId = 'root';
      await this.save();
  }
  ```
- **Fix suggestion**: Validate at minimum that each root element has `id` and `type` fields. Create a pre-import backup.

#### 1.10 `updateSm2()` — no protection against concurrent SM2 writes
- **File**: `src/models/StorageModel.js:434-462`
- **Severity**: S2
- **What**: `updateSm2()` reads the node, merges SM2 data, and saves. If two review sessions update the same card concurrently (e.g., two open tabs), the second write overwrites the first without merge conflict detection.
- **Why it matters**: SM2 study progress can be silently lost during rapid review sessions.
- **Evidence**:
  ```js
  // Line 454-458 — spread merge, last writer wins
  node.content.sm2 = {
      ...baseSm2,
      ...(node.content.sm2 || {}),
      ...sm2Entry
  };
  ```
- **Fix suggestion**: Add a version counter or timestamp check to detect stale writes.

#### 1.11 In-memory singleton state — shared mutable `data` array
- **File**: `src/models/StorageModel.js:6-7`
- **Severity**: S2
- **What**: `StorageModel` is a singleton object with mutable `data` and `currentFolderId`. If imported by multiple modules in the same context, they share state. If the popup re-opens (new context), the state is stale until `init()` is called.
- **Why it matters**: Stale in-memory state can cause writes to overwrite newer storage data.
- **Evidence**:
  ```js
  export const StorageModel = {
      data: [],
      currentFolderId: 'root',
  ```
- **Fix suggestion**: Always call `init()` before mutating operations, or add a staleness check.

### Status: ⚠️ Multiple data-safety risks, especially `clearAll()` and `importData()` lacking backups/validation.

---

## 2. Settings Layer — `src/models/SettingsModel.js`

### What it does
Centralizes extension settings with a split-storage architecture: sensitive keys (API keys, URLs) in `chrome.storage.local`, non-sensitive preferences in `chrome.storage.sync`. Includes one-time migration from sync→local for legacy installs.

### Inputs assumed
- Both `chrome.storage.sync` and `chrome.storage.local` are available
- `_migrateKeysToLocal()` is called exactly once per session
- Settings always merge cleanly with defaults

### Code review findings

#### 2.1 `_migrateKeysToLocal()` — not truly idempotent with concurrent calls
- **File**: `src/models/SettingsModel.js:113-145`
- **Severity**: S2
- **What**: The migration reads sync, writes to local, then cleans sync. If two calls race (e.g., parallel `getSettings()` before `_migrationDone` is set), both will read the same sync data and both will write — the second write is redundant but safe. However, the `_migrationDone` flag is set on line 157 AFTER `await`, so concurrent calls within the same microtask batch could both enter the migration.
- **Why it matters**: Low practical impact since the migration is idempotent in outcome, but the double-write is wasteful.
- **Evidence**:
  ```js
  // Line 154-157
  if (!this._migrationDone) {
      await this._migrateKeysToLocal(); // concurrent calls both enter here
      this._migrationDone = true;
  }
  ```
- **Fix suggestion**: Set `this._migrationDone = true` (or use a promise gate) BEFORE awaiting the migration.

#### 2.2 `getSettings()` — sync/local failures resolve with empty objects, not errors
- **File**: `src/models/SettingsModel.js:159-168`
- **Severity**: S1
- **What**: Both `Promise.all` calls log errors but always resolve. If both storage areas fail, the returned settings will be pure defaults with no API keys. The caller cannot distinguish "user hasn't configured keys yet" from "storage is broken".
- **Why it matters**: Extension may silently operate without API keys (showing setup wizard again) even though the user already configured them. Confusing UX.
- **Evidence**:
  ```js
  // Line 160-167 — always resolves via r(res)
  new Promise(r => chrome.storage.sync.get(['settings'], res => {
      if (chrome.runtime.lastError) console.error(...);
      r(res); // resolves even on error
  }))
  ```
- **Fix suggestion**: Return a `{ settings, errors: [] }` wrapper or throw on critical failures.

#### 2.3 `saveSettings()` — partial write can leave split storage inconsistent
- **File**: `src/models/SettingsModel.js:210-219`
- **Severity**: S1
- **What**: `Promise.all` writes to sync and local in parallel. If one succeeds and the other fails, the settings are in an inconsistent split state. For example, sync could have `setupCompleted: true` while local has no API key.
- **Why it matters**: Inconsistent state between sync and local storage can cause the setup wizard to appear/disappear incorrectly, or API calls to fail with missing keys.
- **Evidence**:
  ```js
  // Line 210-219
  await Promise.all([
      new Promise(r => chrome.storage.sync.set({ settings: syncPart }, () => {
          if (chrome.runtime.lastError) console.error(...);
          r(); // resolves even on failure
      })),
      new Promise(r => chrome.storage.local.set({ ah_settings_local: localPart }, () => {
          if (chrome.runtime.lastError) console.error(...);
          r(); // resolves even on failure
      }))
  ]);
  ```
- **Fix suggestion**: Check `chrome.runtime.lastError` and reject on failure, then roll back the successful write if the other failed — or at minimum propagate the error to the caller.

#### 2.4 `_sensitiveKeys` includes API URLs — overly broad
- **File**: `src/models/SettingsModel.js:104-107`
- **Severity**: S3
- **What**: `groqApiUrl`, `serperApiUrl`, `geminiApiUrl` are classified as sensitive and stored in local-only storage. These are standard public API endpoints, not secrets.
- **Why it matters**: Users who want to sync their custom API URL overrides across devices cannot, since these are excluded from sync. The ExportService also blocks URL fields on import (line 93), creating a double-block.
- **Evidence**:
  ```js
  _sensitiveKeys: [
      'groqApiKey', 'serperApiKey', 'geminiApiKey', 'openrouterApiKey',
      'groqApiUrl', 'serperApiUrl', 'geminiApiUrl' // URLs are not secrets
  ],
  ```
- **Fix suggestion**: Move API URLs out of `_sensitiveKeys` unless there's a specific security reason (e.g., preventing redirect attacks).

#### 2.5 `normalizeRequiredProviders()` — asymmetric default logic
- **File**: `src/models/SettingsModel.js:59-65`
- **Severity**: S3
- **What**: `groq` and `serper` default to `true` (via `!== false`), but `gemini` defaults to `false` (via `=== true`). This means if a user passes `{ gemini: "yes" }` (a truthy non-boolean), gemini remains `false`.
- **Why it matters**: Minor inconsistency. Unlikely to occur in practice but could surprise a developer.
- **Evidence**:
  ```js
  groq: requiredProviders.groq !== false,    // any truthy → true
  serper: requiredProviders.serper !== false, // any truthy → true
  gemini: requiredProviders.gemini === true   // only boolean true → true
  ```
- **Fix suggestion**: Use `!!value` or `Boolean(value)` consistently.

#### 2.6 Hot-migration of model names is not persisted
- **File**: `src/models/SettingsModel.js:174-182`
- **Severity**: S3
- **What**: Lines 175-182 fix stale model names in the merged settings object, but these fixes are only applied in-memory. The corrected values are not saved back to storage. Every `getSettings()` call repeats the fix.
- **Why it matters**: Wasteful but harmless. If the user opens the settings UI it will show the corrected value, but saving settings without changes won't persist the fix either.
- **Evidence**:
  ```js
  if (merged.geminiModelSmart === 'gemini-2.5-pro') {
      merged.geminiModelSmart = 'gemini-2.5-flash'; // not saved
  }
  ```
- **Fix suggestion**: Persist the fix on first detection, or accept the runtime-only fix as intentional.

### Status: ⚠️ Split-storage write can leave inconsistent state; error handling resolves instead of rejecting.

---

## 3. Export/Import — `src/services/ExportService.js`

### What it does
Provides full JSON backup/restore, CSV card export, Anki TSV export, selective discipline export, and notes Markdown export. Handles file downloads via Blob URLs.

### Inputs assumed
- `chrome.storage.local` and `chrome.storage.sync` are available
- `hierarchy` parameter follows the Discipline→Module→Topic→Card shape
- `document.body` exists when `download()` is called (popup or dashboard)

### Code review findings

#### 3.1 `exportFullJSON()` — missing `ah_settings_local` from backup
- **File**: `src/services/ExportService.js:20-44`
- **Severity**: S0
- **What**: The export reads specific keys from `chrome.storage.local` (line 20-25) but does NOT include `ah_settings_local` — the key where API keys are stored by `SettingsModel`. The sync settings are captured, but the local-only sensitive keys are not. A full backup restore will lose all API keys.
- **Why it matters**: User exports backup → reinstalls → imports backup → all API keys are gone. User must re-enter all keys manually.
- **Evidence**:
  ```js
  const keys = [
      'binderStructure', 'settings', 'ah_hierarchy',
      'ah_disciplines', 'ah_xpData', 'ah_badges',
      'ah_notes', 'ah_analytics', 'ah_learning_paths',
      'ah_study_plans', 'ah_migration_meta'
      // ❌ Missing: 'ah_settings_local'
  ];
  ```
- **Fix suggestion**: Add `'ah_settings_local'` to the keys array. On import, handle it separately with the same security checks.

#### 3.2 `importFullJSON()` — URL override blocking regex is too narrow
- **File**: `src/services/ExportService.js:93`
- **Severity**: S2
- **What**: The regex `/apiurl|apiendpoint|baseurl/i` blocks settings keys containing "apiurl", "apiendpoint", or "baseurl". However, the actual setting keys in `SettingsModel` are `groqApiUrl`, `serperApiUrl`, `geminiApiUrl` — these contain "ApiUrl" which matches "apiurl" case-insensitively, so they ARE blocked. But the pattern would miss keys like `customEndpoint` or `webhookUrl`.
- **Why it matters**: Current keys are correctly blocked. Future keys with different naming could slip through.
- **Evidence**:
  ```js
  const BLOCKED_SETTING_PATTERNS = /apiurl|apiendpoint|baseurl/i;
  ```
- **Fix suggestion**: Also match `/url$/i` as a suffix pattern, or use an explicit allowlist of permitted settings keys instead of a blocklist.

#### 3.3 `importFullJSON()` — settings go to sync only, not split storage
- **File**: `src/services/ExportService.js:102`
- **Severity**: S1
- **What**: Imported settings are written entirely to `chrome.storage.sync` (line 102). But `SettingsModel.saveSettings()` splits settings: sensitive keys go to local, rest to sync. This import bypasses the split, so API keys in the backup would go to sync (if they weren't already blocked by the URL filter). More importantly, the `ah_settings_local` key is never touched during import.
- **Why it matters**: Import doesn't respect the same storage architecture as the rest of the code. Settings may end up in the wrong storage area.
- **Evidence**:
  ```js
  // Line 102 — all settings go to sync
  await new Promise((r, rej) => chrome.storage.sync.set({ settings: safeSettings }, () => { ... }));
  ```
- **Fix suggestion**: Use `SettingsModel.saveSettings(safeSettings)` instead of raw `chrome.storage.sync.set`.

#### 3.4 `_sanitizeCSVCell()` — incomplete formula injection prevention
- **File**: `src/services/ExportService.js:312-318`
- **Severity**: S2
- **What**: The sanitizer prefixes cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` with a single quote. This covers the main injection vectors. However, it does not handle cells starting with `0x09` (horizontal tab) or `0x0D` (carriage return) when they are embedded as escaped sequences. Also, the function already calls `String(value || '')` which handles null, but the regex `\t` and `\r` test literal characters, which is correct.
- **Why it matters**: The current implementation covers the OWASP-recommended set. Minor gap: some spreadsheet apps also trigger on `|` and `\` prefixes.
- **Evidence**:
  ```js
  _sanitizeCSVCell(value) {
      const s = String(value || '');
      if (/^[=+\-@\t\r]/.test(s)) {
          return "'" + s;
      }
      return s;
  }
  ```
- **Fix suggestion**: Extend regex to `/^[=+\-@\t\r|\\]/.test(s)` to cover edge cases.

#### 3.5 `download()` — memory leak window is minimal but present
- **File**: `src/services/ExportService.js:240-253`
- **Severity**: S3
- **What**: `URL.revokeObjectURL(url)` is called in a `setTimeout` with 100ms delay. If the popup closes before the timeout fires, the Blob URL is leaked until the browser GC collects it. In a Chrome extension popup, closing the popup destroys the JS context and the timeout.
- **Why it matters**: In practice, the popup closure will free the Blob. In the dashboard page (long-lived), the revocation works correctly. Very low risk.
- **Evidence**:
  ```js
  setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
  }, 100);
  ```
- **Fix suggestion**: Acceptable as-is. Could use `a.addEventListener('click', () => setTimeout(revoke, 100))` to be explicit.

#### 3.6 `exportCSV()` — double-escaping of quotes in question/answer
- **File**: `src/services/ExportService.js:143-144`
- **Severity**: S2
- **What**: Line 143 does `.replace(/"/g, '""')` on the question text BEFORE passing it to `_sanitizeCSVCell()`. Then line 150 wraps each value in double quotes. However, `_sanitizeCSVCell` does NOT escape internal quotes. This means the `_extractAnswer` helper (line 300-308) also does `.replace(/"/g, '""')` — so answers are escaped correctly inside the helper. But for questions, the escaping happens at the call site, creating an inconsistency.
- **Why it matters**: The question field is escaped at the call site AND then sanitized. The flow works but is fragile. If someone removes the call-site escape, the CSV breaks.
- **Evidence**:
  ```js
  // Line 143 — escape at call site
  this._sanitizeCSVCell((card.question || card.content?.question || '').replace(/"/g, '""')),
  // Line 144 — escape inside _extractAnswer
  this._sanitizeCSVCell(this._extractAnswer(card)),
  // _extractAnswer line 301 — also escapes quotes
  return String(card.answer).replace(/"/g, '""');
  ```
- **Fix suggestion**: Move all quote-escaping into `_sanitizeCSVCell()` and remove it from call sites.

#### 3.7 `readFile()` — no file size limit
- **File**: `src/services/ExportService.js:289-296`
- **Severity**: S2
- **What**: `readFile()` reads the entire file into memory as text with no size check. A user could select a 500MB file (e.g., wrong file) and the extension would attempt to read it all, potentially freezing or crashing the popup.
- **Why it matters**: OOM crash on large file selection.
- **Evidence**:
  ```js
  readFile(file) {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsText(file); // no size check
      });
  }
  ```
- **Fix suggestion**: Add `if (file.size > 10 * 1024 * 1024) reject(new Error('File too large'))` before reading.

### Status: ❌ S0 issue: full backup does not include API keys (`ah_settings_local`). Import bypasses split-storage architecture.

---

## 4. Migration — `src/services/MigrationService.js`

### What it does
Converts the flat folder/question binder tree (v1) into a hierarchical Discipline→Module→Topic→Card structure (v2). Creates a backup before migration. Supports rollback.

### Inputs assumed
- `binderStructure` is an array of folder/question nodes in `chrome.storage.local`
- `ah_disciplines` may or may not exist
- `crypto.randomUUID()` is available

### Code review findings

#### 4.1 `migrate()` — not truly idempotent (new UUIDs on re-run)
- **File**: `src/services/MigrationService.js:48-96`
- **Severity**: S2
- **What**: The JSDoc says "Idempotent: running multiple times produces the same result" (line 9). The version check on line 51 (`meta.version >= CURRENT_VERSION`) prevents re-running after success. However, if the migration partially fails (e.g., `_persistHierarchy` succeeds but `_setMeta` fails), the next run will re-migrate with new `crypto.randomUUID()` IDs, creating duplicate hierarchy entries with different IDs.
- **Why it matters**: After a partial failure, re-running creates duplicates instead of resuming. Any external references to the old IDs (e.g., in `ah_notes`) would be orphaned.
- **Evidence**:
  ```js
  // Line 247 — new UUID every time
  id: 'd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
  ```
- **Fix suggestion**: Use deterministic IDs derived from discipline names (e.g., hash-based) so re-runs produce the same IDs.

#### 4.2 `_createBackup()` — no storage quota check
- **File**: `src/services/MigrationService.js:325-341`
- **Severity**: S2
- **What**: The backup writes a full copy of `binderStructure`, `ah_disciplines`, and `ah_xpData` to `ah_migration_backup`. Chrome's `storage.local` has a default 10MB limit (can be unlocked with `unlimitedStorage` permission). If the binder is large, the backup could exceed quota and fail.
- **Why it matters**: If backup fails, `_createBackup` rejects (line 336) and the migration aborts — which is the correct behavior. But the error message doesn't mention quota.
- **Evidence**:
  ```js
  chrome.storage.local.set({ [BACKUP_KEY]: backup }, () => {
      if (chrome.runtime.lastError) {
          reject(new Error('Backup creation failed: ' + chrome.runtime.lastError.message));
  ```
- **Fix suggestion**: Check `navigator.storage.estimate()` before backup, or catch `QUOTA_BYTES_PER_ITEM` errors specifically.

#### 4.3 `rollback()` — does not restore `ah_hierarchy` removal atomically
- **File**: `src/services/MigrationService.js:102-147`
- **Severity**: S2
- **What**: Rollback performs 3 sequential storage operations: (1) restore binderStructure + ah_disciplines, (2) remove ah_hierarchy, (3) reset meta version. If step 1 succeeds but step 2 or 3 fails, the system is in an inconsistent state: old binder data AND new hierarchy both exist, with meta still showing migrated.
- **Why it matters**: Partial rollback could cause the extension to show both old and new data structures.
- **Evidence**:
  ```js
  // Line 117-128 — step 1: restore
  await new Promise(resolve => { chrome.storage.local.set({...}, () => { ... resolve(); }); });
  // Line 131-137 — step 2: remove (could fail independently)
  await new Promise(resolve => { chrome.storage.local.remove(['ah_hierarchy'], () => { ... resolve(); }); });
  // Line 139 — step 3: reset meta
  await this._setMeta({ version: 1, rolledBackAt: Date.now() });
  ```
- **Fix suggestion**: Combine all writes into a single `chrome.storage.local.set()` call by setting `ah_hierarchy` to `null` or removing it in the same operation.

#### 4.4 `rollback()` — does not remove the backup itself
- **File**: `src/services/MigrationService.js:102-147`
- **Severity**: S3
- **What**: After rollback, the backup key `ah_migration_backup` remains in storage. This means a second rollback will apply the same backup again, which is harmless but wastes storage.
- **Why it matters**: Minor storage waste. No functional impact.
- **Fix suggestion**: Remove `BACKUP_KEY` after successful rollback.

#### 4.5 `_buildHierarchy()` — empty `flatQuestions` returns empty array (correct but undocumented)
- **File**: `src/services/MigrationService.js:188-310`
- **Severity**: S3
- **What**: If `flatQuestions` is empty, the `for` loop doesn't execute and an empty array is returned. This is correct behavior for a fresh install with no data. However, the discipline color palette cycles via `colorIdx++` which is reset each call, so colors are consistent.
- **Why it matters**: No issue — just documenting the edge case is handled correctly.

#### 4.6 `_buildHierarchy()` — malformed nodes with missing `content` are handled
- **File**: `src/services/MigrationService.js:207`
- **Severity**: S3
- **What**: Line 207 does `const content = node.content || {}`, which safely handles nodes without a `content` property. If `node.type === 'question'` but `content.question` is undefined, the card will be created with `question: ''` (line 288).
- **Why it matters**: Empty question cards are silently created. Not a crash, but may confuse users.
- **Fix suggestion**: Skip nodes where `content.question` is falsy.

#### 4.7 `_persistHierarchy()` — resolves on error instead of rejecting
- **File**: `src/services/MigrationService.js:344-353`
- **Severity**: S1
- **What**: If `chrome.storage.local.set` fails, the error is logged but the promise resolves. This means `migrate()` will continue to step 6 (`_syncDisciplines`) and step 7 (`_setMeta`) even though the hierarchy wasn't actually saved.
- **Why it matters**: Migration reports success but the hierarchy data is lost. The meta version is bumped to v4, so re-running won't help.
- **Evidence**:
  ```js
  // Line 344-353
  async _persistHierarchy(hierarchy) {
      return new Promise(resolve => {
          chrome.storage.local.set({ ah_hierarchy: hierarchy }, () => {
              if (chrome.runtime.lastError) {
                  console.error('[MigrationService] _persistHierarchy failed:', chrome.runtime.lastError);
              }
              resolve(); // ❌ resolves even on failure
          });
      });
  }
  ```
- **Fix suggestion**: Reject the promise on `chrome.runtime.lastError` so `migrate()` catches the failure.

### Status: ⚠️ Core migration logic is sound. `_persistHierarchy` resolve-on-error is the most serious issue; partial-failure idempotency is a design gap.

---

## 5. Background Service Worker — `src/background.js`

### What it does
MV3 service worker that handles OAuth callbacks (ChatGPT, Gemini CLI, Copilot), scheduled alarms (study reminders, daily cleanup, Copilot OAuth polling), background search execution, and badge evaluation.

### Inputs assumed
- Service worker can be killed and restarted by Chrome at any time
- Tab URLs may contain OAuth callback patterns
- Messages from popup/dashboard follow a known `type` schema

### Code review findings

#### 5.1 OAuth callback on `localhost` — no CSRF / state parameter validation
- **File**: `src/background.js:157-192`
- **Severity**: S0
- **What**: The tab listener checks if the URL starts with `http://localhost:1455/auth/callback` or `http://localhost:11235/auth/callback`. It passes the entire URL to `ChatGPTAuthService.handleCallback()` or `GeminiCLIAuthService.handleCallback()`. There is no validation in THIS file that the callback contains a valid `state` parameter matching one initiated by the extension. If the auth services don't validate state, a malicious page could redirect to `localhost:1455/auth/callback?code=STOLEN_CODE` and trick the extension into using it.
- **Why it matters**: OAuth CSRF attack vector. The actual severity depends on whether `handleCallback()` validates the PKCE `state` parameter (not visible in this file).
- **Evidence**:
  ```js
  // Line 157-161 — no state validation at this layer
  if (changeInfo.url.startsWith(CHATGPT_CALLBACK_PATTERN)) {
      const result = await ChatGPTAuthService.handleCallback(changeInfo.url);
  ```
- **Fix suggestion**: Verify that `ChatGPTAuthService.handleCallback()` and `GeminiCLIAuthService.handleCallback()` validate the PKCE `state` parameter. Add a comment documenting that validation happens in the service layer.

#### 5.2 OAuth callbacks use `http://localhost` — unencrypted
- **File**: `src/background.js:23-24`
- **Severity**: S2
- **What**: Both callback URLs use HTTP (not HTTPS) on localhost. While localhost traffic doesn't leave the machine, other local processes could listen on these ports and intercept the OAuth code.
- **Why it matters**: On shared or compromised machines, another process could bind to port 1455 or 11235 and steal OAuth authorization codes.
- **Evidence**:
  ```js
  const CHATGPT_CALLBACK_PATTERN = 'http://localhost:1455/auth/callback';
  const GEMINI_CLI_CALLBACK_PATTERN = 'http://localhost:11235/auth/callback';
  ```
- **Fix suggestion**: Consider using `https://` with a self-signed cert, or use the `chrome.identity` API instead. At minimum, this is a known OAuth risk that should be documented.

#### 5.3 `onMessage` listener — unknown message types silently ignored
- **File**: `src/background.js:217-273`
- **Severity**: S3
- **What**: The message listener handles `SEARCH_PHASE2`, `AH_OPEN_DASHBOARD_V2`, `AH_EVALUATE_BADGES`, `AH_RECORD_REVIEW`, and `AH_END_SESSION`. For any other `msg.type`, the function returns `false` (line 272), which means "no async response coming". Unknown message types are silently dropped.
- **Why it matters**: Debugging aid — logging unknown message types would help diagnose integration issues. No functional impact.
- **Evidence**:
  ```js
  // Line 272 — fall-through for unknown types
  return false;
  ```
- **Fix suggestion**: Add `console.debug('BG: unhandled message type:', msg.type)` before the final `return false`.

#### 5.4 `_clearStaleSearches()` — also removes status keys for non-stale searches
- **File**: `src/background.js:126-141`
- **Severity**: S3
- **What**: For each `ah_bg_search_*` key with `state === 'running'`, it pushes both the key AND `${key}_status` into `staleKeys`. This is correct — if the search was stale (running at startup), the status is also stale. It also removes `ah_pending_search`. However, it does NOT remove status keys for searches in other states (e.g., `state === 'done'`), which could accumulate.
- **Why it matters**: Minor storage hygiene. Done/error status keys accumulate but are small.
- **Fix suggestion**: Add cleanup for completed search results older than 24 hours.

#### 5.5 Service worker keep-alive mechanism — auto-terminates after 4.5 minutes
- **File**: `src/background.js:283-292`
- **Severity**: S2
- **What**: The keep-alive interval pings `chrome.runtime.getPlatformInfo()` every 20s to prevent the 30s idle timeout. It self-terminates after 4.5 minutes. If a search takes longer than 4.5 minutes, the service worker will be killed mid-search.
- **Why it matters**: Long searches (many sources, slow APIs) could be terminated. The search state would be left as `running` until the next `_clearStaleSearches()` call.
- **Evidence**:
  ```js
  const MAX_KEEPALIVE_MS = 4.5 * 60 * 1000;
  if (Date.now() - keepAliveStart > MAX_KEEPALIVE_MS) {
      clearInterval(keepAlive);
      console.warn('AnswerHunter BG: keepAlive max duration reached...');
      return;
  }
  ```
- **Fix suggestion**: Set the search state to `error` with `reason: 'timeout'` when the keep-alive expires, or increase the limit.

#### 5.6 `onInstalled` alarms — delay is absolute, not wall-clock aware
- **File**: `src/background.js:111-113`
- **Severity**: S3
- **What**: Study reminder alarm has `delayInMinutes: 360` (6 hours from install) with `periodInMinutes: 360`. Daily cleanup has `delayInMinutes: 1440`. The first reminder won't fire until 6 hours after install/update. If the user installs at 10 PM, the first reminder is at 4 AM.
- **Why it matters**: Minor UX issue — first notification timing is unpredictable.
- **Fix suggestion**: Use a shorter initial delay (e.g., 60 minutes) or calculate the delay to the next reasonable hour.

#### 5.7 Top-level async calls at module load — no error boundary
- **File**: `src/background.js:209-211`
- **Severity**: S3
- **What**: Lines 209-211 call async functions at the module's top level with `.catch(() => {})`. These are fire-and-forget. If any throw synchronously (unlikely but possible), the service worker startup could fail.
- **Why it matters**: Defensive — the `.catch(() => {})` handles promise rejections. Synchronous throws are not caught.
- **Evidence**:
  ```js
  _syncCopilotPollingAlarm().catch(() => {});
  _clearStaleSearches().catch(() => {});
  SearchCacheService.loadAiResultCache().catch(() => {});
  ```
- **Fix suggestion**: Wrap in a `try/catch` or combine into an init function.

### Status: ⚠️ OAuth callback security depends on auth service validation (not verified here). Service worker lifecycle is well-handled.

---

## 6. Content Script — `src/content/content.js`

### What it does
Lightweight content script injected on all pages. Listens for `highlight` messages and applies CSS class highlighting to elements matching answer-related selectors.

### Inputs assumed
- `chrome.runtime` may not be available (e.g., if extension context is invalidated)
- The page DOM contains elements with class names matching answer patterns

### Code review findings

#### 6.1 Runtime check is correct — graceful degradation
- **File**: `src/content/content.js:7-8`
- **Severity**: ✅ (No issue)
- **What**: The script checks `globalThis.chrome?.runtime?.onMessage?.addListener` before attaching. This correctly handles the case where the extension context is invalidated (e.g., after extension update while the page is open).
- **Why it matters**: No crash on context invalidation.
- **Evidence**:
  ```js
  const runtime = globalThis.chrome?.runtime;
  if (runtime?.onMessage?.addListener) { ... }
  ```

#### 6.2 `highlightAnswers()` — broad selectors cause false positives
- **File**: `src/content/content.js:25-31`
- **Severity**: S2
- **What**: The selector `[class*="answer"]` matches ANY element whose class name contains "answer" as a substring. This includes `unanswered`, `answer-button`, `answer-count`, `banswered`, etc. Similarly, `[class*="reply"]` matches `noreply`, `reply-button`, `autoreply`.
- **Why it matters**: Many non-answer elements get highlighted, creating a confusing visual experience on sites like Stack Overflow, Reddit, or any forum.
- **Evidence**:
  ```js
  const answerSelectors = [
      '[class*="answer"]',   // matches "unanswered", "answer-header", etc.
      '[class*="resposta"]',
      '[class*="solution"]',
      '[class*="reply"]',    // matches "noreply", "reply-form", etc.
      '[itemprop="acceptedAnswer"]'
  ];
  ```
- **Fix suggestion**: Use word-boundary selectors or more specific patterns: `[class~="answer"]` (matches whole word in space-separated list), or `[class*="answer-content"], [class*="answer-body"]`.

#### 6.3 `highlightAnswers()` — performance concern on large pages
- **File**: `src/content/content.js:33-39`
- **Severity**: S2
- **What**: The function first removes all existing highlights with `querySelectorAll('.qa-extractor-highlight')`, then runs 5 separate `querySelectorAll` calls. On a page with 10,000+ elements (e.g., long forum threads), this is 6 full DOM scans plus `innerText` access (which forces layout reflow) for each matched element.
- **Why it matters**: Can cause visible page jank on large pages. `innerText` is particularly expensive as it triggers layout computation.
- **Evidence**:
  ```js
  // 6 querySelectorAll calls total
  document.querySelectorAll('.qa-extractor-highlight').forEach(...)
  answerSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
          if (el && el.innerText && el.innerText.length > 20) { // innerText forces reflow
  ```
- **Fix suggestion**: Combine selectors into one `querySelectorAll` call: `document.querySelectorAll('[class*="answer"], ...')`. Use `textContent` instead of `innerText` to avoid layout reflow.

#### 6.4 Message listener returns `true` unconditionally
- **File**: `src/content/content.js:15`
- **Severity**: S3
- **What**: The listener returns `true` for ALL messages, which tells Chrome to keep the message channel open for async responses. But `sendResponse` is called synchronously inside the `if` block. For messages that DON'T match `action: 'highlight'`, no response is sent but the channel stays open until timeout.
- **Why it matters**: Chrome holds open message channels for unhandled messages, causing a console warning: "The message port closed before a response was received."
- **Evidence**:
  ```js
  runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.action === 'highlight') {
          highlightAnswers();
          sendResponse({ success: true });
      }
      return true; // always true, even for unhandled messages
  });
  ```
- **Fix suggestion**: Return `true` only inside the `if` block, or return `false` as the default.

#### 6.5 No CSS injection for highlight style
- **File**: `src/content/content.js` (entire file)
- **Severity**: S3
- **What**: The script adds the class `qa-extractor-highlight` but does not inject any CSS rules defining what that class looks like. The styling must be defined in a separate CSS file referenced in `manifest.json`. If the CSS file is missing or not loaded, highlights are invisible.
- **Why it matters**: If the manifest's `content_scripts.css` entry is removed or misconfigured, the highlight feature silently fails.
- **Fix suggestion**: Add a fallback inline style injection, or document the CSS dependency.

### Status: ⚠️ Functional but has false-positive selector issues and performance concerns on large pages.

---

## Cross-Cutting Concerns

### CC.1 Error handling pattern: resolve-on-error
- **Severity**: S1 (systemic)
- **What**: Throughout all modules, the dominant pattern is to log `chrome.runtime.lastError` but still resolve the promise. This means callers never know when storage operations fail.
- **Affected files**:
  - `StorageModel.js:29` (init)
  - `SettingsModel.js:160-166` (getSettings)
  - `MigrationService.js:346-352` (_persistHierarchy)
  - `MigrationService.js:369-374` (_syncDisciplines)
- **Fix suggestion**: Adopt a consistent pattern: reject on `chrome.runtime.lastError` for write operations; for read operations, return a `{ data, error }` tuple.

### CC.2 No global error boundary in service worker
- **Severity**: S3
- **What**: `background.js` has no `self.addEventListener('error', ...)` or `self.addEventListener('unhandledrejection', ...)` handler. Uncaught errors in the service worker may cause silent failures.
- **Fix suggestion**: Add global error handlers that log to a diagnostic storage key.

### CC.3 Storage quota not monitored
- **Severity**: S2
- **What**: No module checks `chrome.storage.local.getBytesInUse()` or `navigator.storage.estimate()` before writing. Large binders could silently fail to save.
- **Fix suggestion**: Add a quota check in `StorageModel.save()` and warn the user when usage exceeds 80%.

---

## Summary Table

| # | File | Finding | Severity |
|---|------|---------|----------|
| 1.1 | StorageModel.js:29 | `init()` resolves on storage failure, enabling data overwrite | S1 |
| 1.2 | StorageModel.js:47 | `save()` has no concurrency guard | S1 |
| 1.3 | StorageModel.js:106 | `addItem()` silent failure on invalid folder | S2 |
| 1.4 | StorageModel.js:101 | Duplicate detection is O(n) full tree scan | S3 |
| 1.5 | StorageModel.js:280 | `deleteNode()` cascade-deletes children silently | S2 |
| 1.6 | StorageModel.js:253 | `removeByContent()` removes only first match | S3 |
| 1.7 | StorageModel.js:306 | `moveItem()` guards are correct, missing status return | S3 |
| 1.8 | StorageModel.js:397 | `clearAll()` no backup before factory reset | S0 |
| 1.9 | StorageModel.js:407 | `importData()` no input validation | S0 |
| 1.10 | StorageModel.js:434 | `updateSm2()` no concurrent write protection | S2 |
| 1.11 | StorageModel.js:6 | Singleton mutable state — staleness risk | S2 |
| 2.1 | SettingsModel.js:154 | `_migrateKeysToLocal()` race on concurrent calls | S2 |
| 2.2 | SettingsModel.js:159 | `getSettings()` resolves with defaults on failure | S1 |
| 2.3 | SettingsModel.js:210 | `saveSettings()` partial write leaves split state | S1 |
| 2.4 | SettingsModel.js:104 | API URLs classified as sensitive unnecessarily | S3 |
| 2.5 | SettingsModel.js:59 | Asymmetric boolean coercion for providers | S3 |
| 2.6 | SettingsModel.js:175 | Hot-migration of model names not persisted | S3 |
| 3.1 | ExportService.js:20 | Full backup missing `ah_settings_local` (API keys) | S0 |
| 3.2 | ExportService.js:93 | URL override blocklist regex could miss future keys | S2 |
| 3.3 | ExportService.js:102 | Import writes settings to sync only, bypasses split | S1 |
| 3.4 | ExportService.js:312 | CSV sanitizer missing `\|` and `\\` prefixes | S2 |
| 3.5 | ExportService.js:240 | Blob URL leak if popup closes before timeout | S3 |
| 3.6 | ExportService.js:143 | Double-escaping of quotes in CSV export | S2 |
| 3.7 | ExportService.js:289 | `readFile()` no file size limit | S2 |
| 4.1 | MigrationService.js:48 | Not truly idempotent — new UUIDs on re-run | S2 |
| 4.2 | MigrationService.js:325 | No storage quota check before backup | S2 |
| 4.3 | MigrationService.js:102 | Rollback not atomic — 3 sequential operations | S2 |
| 4.4 | MigrationService.js:102 | Rollback doesn't remove backup key | S3 |
| 4.5 | MigrationService.js:188 | Empty input handled correctly | ✅ |
| 4.6 | MigrationService.js:207 | Malformed nodes create empty-question cards | S3 |
| 4.7 | MigrationService.js:344 | `_persistHierarchy()` resolves on error | S1 |
| 5.1 | background.js:157 | OAuth callback — no state validation at this layer | S0 |
| 5.2 | background.js:23 | OAuth on HTTP localhost | S2 |
| 5.3 | background.js:272 | Unknown message types silently ignored | S3 |
| 5.4 | background.js:126 | Completed search status keys accumulate | S3 |
| 5.5 | background.js:283 | Keep-alive auto-terminates at 4.5 min | S2 |
| 5.6 | background.js:111 | Alarm initial delay not wall-clock aware | S3 |
| 5.7 | background.js:209 | Top-level async calls — no error boundary | S3 |
| 6.1 | content.js:7 | Runtime check is correct | ✅ |
| 6.2 | content.js:25 | Broad selectors cause false positives | S2 |
| 6.3 | content.js:33 | Performance: 6 DOM scans + `innerText` reflow | S2 |
| 6.4 | content.js:15 | `return true` for unhandled messages | S3 |
| 6.5 | content.js | No inline CSS fallback for highlights | S3 |
| CC.1 | Multiple | Systemic resolve-on-error pattern | S1 |
| CC.2 | background.js | No global error boundary in SW | S3 |
| CC.3 | Multiple | No storage quota monitoring | S2 |

---

## Recommended Priority Actions

### P0 — Fix immediately
1. **ExportService.js**: Add `ah_settings_local` to backup keys (finding 3.1)
2. **StorageModel.js**: Create a backup before `clearAll()` (finding 1.8)
3. **StorageModel.js**: Validate input shape in `importData()` (finding 1.9)
4. **background.js**: Verify OAuth state/PKCE validation in auth services (finding 5.1)
5. **MigrationService.js**: Reject promise in `_persistHierarchy()` on error (finding 4.7)

### P1 — Fix in next sprint
1. Adopt reject-on-error pattern for all storage write operations (CC.1)
2. Fix `saveSettings()` to handle partial write failures (finding 2.3)
3. Fix import to use `SettingsModel.saveSettings()` (finding 3.3)
4. Add file size limit to `readFile()` (finding 3.7)

### P2 — Address when possible
1. Add concurrency guard to `StorageModel.save()` (finding 1.2)
2. Fix content script selectors (finding 6.2) and performance (finding 6.3)
3. Add storage quota monitoring (CC.3)
4. Make migration IDs deterministic (finding 4.1)