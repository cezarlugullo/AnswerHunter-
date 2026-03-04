/**
 * MigrationService.js
 * Non-destructive v1→v2 data migration for AnswerHunter.
 *
 * Converts the flat folder/question binder tree into a hierarchical
 * Discipline → Module → Topic → Card structure while preserving all
 * original data. Creates a backup before migration, and supports rollback.
 *
 * Idempotent: running multiple times produces the same result.
 */

const MIGRATION_KEY = 'ah_migration_meta';
const BACKUP_KEY = 'ah_migration_backup';
const CURRENT_VERSION = 4;

export const MigrationService = {

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Checks whether migration is needed.
   * @returns {Promise<boolean>}
   */
  async needsMigration() {
    const meta = await this._getMeta();
    return meta.version < CURRENT_VERSION;
  },

  /**
   * Returns current migration metadata.
   * @returns {Promise<Object>}
   */
  async getStatus() {
    return this._getMeta();
  },

  /**
   * Runs the full v1→v2 migration pipeline.
   * Steps:
   *   1. Create full backup of binderStructure + ah_disciplines
   *   2. Analyse existing folder structure & question subjects
   *   3. Build hierarchical discipline tree
   *   4. Persist migrated data
   *   5. Update migration metadata
   *
   * @returns {Promise<{success: boolean, stats: Object, error?: string}>}
   */
  async migrate() {
    try {
      const meta = await this._getMeta();
      if (meta.version >= CURRENT_VERSION) {
        return { success: true, stats: { skipped: true, reason: 'already_migrated' } };
      }

      // 1. Load current data
      const raw = await this._loadRaw();
      const binderData = raw.binderStructure || [];
      const disciplines = raw.ah_disciplines || [];

      // 2. Create backup
      await this._createBackup(raw);

      // 3. Gather all questions with path info
      const flatQuestions = this._extractQuestions(binderData);

      // 4. Derive discipline → module → topic hierarchy
      const hierarchy = this._buildHierarchy(flatQuestions, disciplines);

      // 5. Persist the new hierarchy alongside old data
      //    We store the v2 hierarchy as ah_hierarchy and keep binderStructure untouched
      //    so the extension still works with existing code.
      await this._persistHierarchy(hierarchy);

      // 6. Ensure all disciplines from hierarchy exist in ah_disciplines
      await this._syncDisciplines(hierarchy, disciplines);

      // 7. Update migration meta
      const stats = {
        totalQuestions: flatQuestions.length,
        disciplinesCreated: hierarchy.length,
        modulesCreated: hierarchy.reduce((sum, d) => sum + d.modules.length, 0),
        topicsCreated: hierarchy.reduce((sum, d) =>
          sum + d.modules.reduce((s, m) => s + m.topics.length, 0), 0),
        migratedAt: Date.now()
      };

      await this._setMeta({ version: CURRENT_VERSION, ...stats });

      console.log('[MigrationService] Migration complete (v' + CURRENT_VERSION +'):', stats);
      return { success: true, stats };

    } catch (err) {
      console.error('[MigrationService] Migration failed:', err);
      return { success: false, stats: {}, error: err.message };
    }
  },

  /**
   * Restores the backup created before migration.
   * @returns {Promise<boolean>}
   */
  async rollback() {
    try {
      const backup = await new Promise(resolve => {
        chrome.storage.local.get([BACKUP_KEY], d => {
          if (chrome.runtime.lastError) {
            console.error('[MigrationService] rollback get failed:', chrome.runtime.lastError);
          }
          resolve(d?.[BACKUP_KEY]);
        });
      });
      if (!backup) {
        console.warn('[MigrationService] No backup found for rollback.');
        return false;
      }

      // Atomic rollback: restore data + remove hierarchy + reset meta in one operation
      await new Promise((resolve, reject) => {
        const restoreData = {
          binderStructure: backup.binderStructure,
          ah_disciplines: backup.ah_disciplines || [],
          ah_hierarchy: null, // null to clear the key
          ah_migration_meta: { version: 1, rolledBackAt: Date.now() }
        };
        if (backup.ah_xpData) {
          restoreData.ah_xpData = backup.ah_xpData;
        }
        chrome.storage.local.set(restoreData, () => {
          if (chrome.runtime.lastError) {
            console.error('[MigrationService] rollback set failed:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          // Remove the null-ed key and backup
          chrome.storage.local.remove(['ah_hierarchy', BACKUP_KEY], () => {
            resolve();
          });
        });
      });

      console.log('[MigrationService] Rollback complete.');
      return true;
    } catch (err) {
      console.error('[MigrationService] Rollback failed:', err);
      return false;
    }
  },

  // ─── Data extraction ─────────────────────────────────────────────────────

  /**
   * Recursively extracts all question nodes with their folder path.
   * @param {Array} nodes
   * @param {string[]} path - folder names traversed
   * @returns {Array<{node: Object, path: string[]}>}
   */
  _extractQuestions(nodes, path = []) {
    const results = [];
    for (const node of nodes) {
      if (node.type === 'question') {
        results.push({ node, path: [...path] });
      } else if (node.type === 'folder') {
        if (!node.children || node.children.length === 0) {
          // Push empty folder as a placeholder to ensure the discipline is created
          results.push({ node: { id: node.id, type: 'empty_folder', createdAt: node.createdAt, updatedAt: node.createdAt }, path: [...path, node.title || 'Sem nome'] });
        } else {
          results.push(...this._extractQuestions(node.children, [...path, node.title || 'Sem nome']));
        }
      }
    }
    return results;
  },

  /**
   * Builds hierarchical Discipline → Module → Topic → Card structure.
   *
   * Heuristic for mapping:
   *  - If the question has `content.subject` or `content.discipline` → discipline name
   *  - Else use the top-level folder name as discipline
   *  - Second-level folder → module
   *  - Third-level folder → topic
   *  - If only one level, module + topic get a default name
   *
   * @param {Array} flatQuestions - from _extractQuestions
   * @param {Array} existingDisciplines - from ah_disciplines
   * @returns {Array<Discipline>}
   */
  _buildHierarchy(flatQuestions, existingDisciplines) {
    const disciplineMap = new Map(); // name → { discipline, modules: Map }

    // Build a lookup for existing discipline colors
    const colorLookup = {};
    for (const d of existingDisciplines) {
      colorLookup[d.name.toLowerCase()] = d.color;
    }

    const PALETTE = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];
    let colorIdx = 0;

    // Root-like folder names that should be skipped as discipline names
    const ROOT_NAMES = new Set(['raiz', 'root', 'my study', 'binder', 'meu estudo']);

    for (const { node, path } of flatQuestions) {
      const content = node.content || {};

      // Determine discipline name
      let discName = content.subject || content.discipline || content.topic || '';
      let moduleName, topicName;

      if (!discName && path.length > 0) {
        // If the first folder is a root-like name
        if (ROOT_NAMES.has((path[0] || '').toLowerCase())) {
          if (path.length > 1) {
            // promote the subfolder to discipline level
            discName = path[1];
            moduleName = path.length > 2 ? path[2] : 'Módulo 1';
            topicName = path.length > 3 ? path[3] : 'Tópico geral';
          } else {
            // It's just 'Raiz' with no subfolders -> put in 'Geral'
            discName = 'Geral';
            moduleName = 'Módulo 1';
            topicName = 'Tópico geral';
          }
        } else {
          discName = path[0];
          moduleName = path.length > 1 ? path[1] : 'Módulo 1';
          topicName = path.length > 2 ? path[2] : 'Tópico geral';
        }
      } else {
        moduleName = path.length > 1 ? path[1] : 'Módulo 1';
        topicName = path.length > 2 ? path[2] : 'Tópico geral';
      }
      if (!discName) discName = 'Geral';

      // Fallback defaults
      if (!moduleName) moduleName = 'Módulo 1';
      if (!topicName) topicName = 'Tópico geral';

      // Get or create discipline entry
      const discKey = discName.toLowerCase();
      if (!disciplineMap.has(discKey)) {
        const color = colorLookup[discKey] || PALETTE[colorIdx++ % PALETTE.length];
        disciplineMap.set(discKey, {
          id: 'd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
          name: discName,
          icon: '',
          color,
          modules: new Map(),
          createdAt: Date.now()
        });
      }
      const disc = disciplineMap.get(discKey);

      // Get or create module
      const modKey = moduleName.toLowerCase();
      if (!disc.modules.has(modKey)) {
        disc.modules.set(modKey, {
          id: 'm_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
          name: moduleName,
          order: disc.modules.size,
          topics: new Map(),
          createdAt: Date.now()
        });
      }
      const mod = disc.modules.get(modKey);

      // Get or create topic
      const topKey = topicName.toLowerCase();
      if (!mod.topics.has(topKey)) {
        mod.topics.set(topKey, {
          id: 't_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
          name: topicName,
          order: mod.topics.size,
          cards: [],
          createdAt: Date.now()
        });
      }
      const top = mod.topics.get(topKey);

      // Add card (preserve original node ID for cross-referencing)
      if (node.type === 'question') {
        top.cards.push({
          id: node.id,
          question: content.question || '',
          answer: content.answer || '',
          source: content.source || '',
          sm2: content.sm2 || {},
          tags: content.sm2?.tags || content.tags || [],
          notes: content.notes || '',
          createdAt: node.createdAt || Date.now(),
          updatedAt: node.updatedAt || Date.now(),
          originalPath: path
        });
      }
    }

    // Convert Maps to arrays
    return Array.from(disciplineMap.values()).map(disc => ({
      ...disc,
      modules: Array.from(disc.modules.values()).map(mod => ({
        ...mod,
        topics: Array.from(mod.topics.values()).map(top => ({
          ...top
        }))
      }))
    }));
  },

  // ─── Storage helpers ─────────────────────────────────────────────────────

  async _loadRaw() {
    return new Promise(resolve => {
      chrome.storage.local.get(['binderStructure', 'ah_disciplines', 'ah_xpData'], d => {
        if (chrome.runtime.lastError) {
          console.error('[MigrationService] _loadRaw failed:', chrome.runtime.lastError);
        }
        resolve(d || {});
      });
    });
  },

  async _createBackup(raw) {
    const backup = {
      binderStructure: raw.binderStructure || [],
      ah_disciplines: raw.ah_disciplines || [],
      ah_xpData: raw.ah_xpData || {},
      backedUpAt: Date.now()
    };
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [BACKUP_KEY]: backup }, () => {
        if (chrome.runtime.lastError) {
          console.error('[MigrationService] _createBackup failed:', chrome.runtime.lastError);
          reject(new Error('Backup creation failed: ' + chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  },

  async _persistHierarchy(hierarchy) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ ah_hierarchy: hierarchy }, () => {
        if (chrome.runtime.lastError) {
          console.error('[MigrationService] _persistHierarchy failed:', chrome.runtime.lastError);
          reject(new Error('_persistHierarchy failed: ' + chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  },

  async _syncDisciplines(hierarchy, existing) {
    const existingNames = new Set(existing.map(d => d.name.toLowerCase()));
    const updated = [...existing];
    for (const disc of hierarchy) {
      if (!existingNames.has(disc.name.toLowerCase())) {
        updated.push({
          id: disc.id,
          name: disc.name,
          color: disc.color,
          createdAt: disc.createdAt
        });
      }
    }
    return new Promise(resolve => {
      chrome.storage.local.set({ ah_disciplines: updated }, () => {
        if (chrome.runtime.lastError) {
          console.error('[MigrationService] _syncDisciplines failed:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  },

  async _getMeta() {
    return new Promise(resolve => {
      chrome.storage.local.get([MIGRATION_KEY], d => {
        if (chrome.runtime.lastError) {
          console.error('[MigrationService] _getMeta failed:', chrome.runtime.lastError);
        }
        resolve(d?.[MIGRATION_KEY] || { version: 1 });
      });
    });
  },

  async _setMeta(meta) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [MIGRATION_KEY]: meta }, () => {
        if (chrome.runtime.lastError) {
          console.error('[MigrationService] _setMeta failed:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }
};
