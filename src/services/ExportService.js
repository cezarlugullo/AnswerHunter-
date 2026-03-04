/**
 * ExportService.js
 * Export & import functionality for AnswerHunter data.
 *
 * Formats:
 *  - JSON (full backup / restore)
 *  - CSV (cards spreadsheet)
 *  - Anki-compatible TSV (import into Anki)
 */

import { SettingsModel } from '../models/SettingsModel.js';

export const ExportService = {

  // ─── JSON Full Backup ─────────────────────────────────────────────────────

  /**
   * Export all extension data as JSON.
   * @returns {Promise<string>} JSON string
   */
  async exportFullJSON() {
    const keys = [
      'binderStructure', 'settings', 'ah_hierarchy',
      'ah_disciplines', 'ah_xpData', 'ah_badges',
      'ah_notes', 'ah_analytics', 'ah_learning_paths',
      'ah_study_plans', 'ah_migration_meta', 'ah_settings_local'
    ];

    const data = await new Promise((r, rej) => chrome.storage.local.get(keys, res => {
      if (chrome.runtime.lastError) { console.error('ExportService: local get failed:', chrome.runtime.lastError); }
      r(res);
    }));
    const syncData = await new Promise((r, rej) => chrome.storage.sync.get(['settings'], res => {
      if (chrome.runtime.lastError) { console.error('ExportService: sync get failed:', chrome.runtime.lastError); }
      r(res);
    }));

    const backup = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest?.()?.version || 'unknown',
      data: { ...data, settings: syncData.settings || data.settings }
    };

    return JSON.stringify(backup, null, 2);
  },

  /**
   * Import data from a full JSON backup.
   * @param {string} jsonString
   * @returns {Promise<{success: boolean, message: string, stats: Object}>}
   */
  async importFullJSON(jsonString) {
    try {
      const backup = JSON.parse(jsonString);

      if (!backup.data) {
        return { success: false, message: 'Invalid backup format: missing data field' };
      }

      // Allowlist of permitted storage keys to prevent arbitrary data injection
      const ALLOWED_LOCAL_KEYS = new Set([
        'binderStructure', 'ah_hierarchy', 'ah_disciplines', 'ah_xpData',
        'ah_badges', 'ah_notes', 'ah_analytics', 'ah_learning_paths',
        'ah_study_plans', 'ah_migration_meta'
      ]);

      const { settings, ...rawLocalData } = backup.data;

      // Filter local data to only allowed keys
      const localData = {};
      for (const [key, value] of Object.entries(rawLocalData)) {
        if (ALLOWED_LOCAL_KEYS.has(key)) {
          localData[key] = value;
        } else {
          console.warn(`[ExportService] importFullJSON: rejected unknown key "${key}"`);
        }
      }

      // Validate binderStructure is an array if present
      if (localData.binderStructure !== undefined && !Array.isArray(localData.binderStructure)) {
        return { success: false, message: 'Invalid backup: binderStructure must be an array' };
      }

      // Also import ah_settings_local if present in backup
      if (rawLocalData.ah_settings_local && typeof rawLocalData.ah_settings_local === 'object') {
        localData.ah_settings_local = rawLocalData.ah_settings_local;
      }

      // Save filtered data to local storage
      if (Object.keys(localData).length > 0) {
        await new Promise((r, rej) => chrome.storage.local.set(localData, () => {
          if (chrome.runtime.lastError) { rej(new Error(chrome.runtime.lastError.message)); return; }
          r();
        }));
      }

      // Save settings via SettingsModel (split storage: API keys → local, rest → sync)
      if (settings && typeof settings === 'object') {
        const BLOCKED_SETTING_PATTERNS = /apiurl|apiendpoint|baseurl/i;
        const safeSettings = {};
        for (const [k, v] of Object.entries(settings)) {
          if (!BLOCKED_SETTING_PATTERNS.test(k)) {
            safeSettings[k] = v;
          } else {
            console.warn(`[ExportService] importFullJSON: blocked setting "${k}" (URL override)`);
          }
        }
        try {
          await SettingsModel.saveSettings(safeSettings);
        } catch (e) {
          console.warn('[ExportService] importFullJSON: SettingsModel.saveSettings failed, falling back to raw sync:', e);
          await new Promise((r, rej) => chrome.storage.sync.set({ settings: safeSettings }, () => {
            if (chrome.runtime.lastError) { rej(new Error(chrome.runtime.lastError.message)); return; }
            r();
          }));
        }
      }

      const stats = {
        keys: Object.keys(localData).length + (settings ? 1 : 0),
        version: backup.version || '1.0',
        exportedAt: backup.exportedAt
      };

      return { success: true, message: 'Import completed successfully', stats };
    } catch (err) {
      return { success: false, message: `Import failed: ${err.message}` };
    }
  },

  // ─── CSV Export ───────────────────────────────────────────────────────────

  /**
   * Export cards as CSV spreadsheet.
   * @param {Array} hierarchy - from ContentHierarchyService
   * @returns {string} CSV text
   */
  exportCSV(hierarchy) {
    const rows = [];
    const DELIM = ',';
    const header = ['Discipline', 'Module', 'Topic', 'Question', 'Answer', 'Tags', 'Mastered', 'Stability', 'NextReview'];

    rows.push(header.map(h => `"${h}"`).join(DELIM));

    for (const disc of hierarchy) {
      for (const mod of disc.modules) {
        for (const topic of mod.topics) {
          for (const card of topic.cards) {
            const sm2 = card.sm2 || {};
            const row = [
              this._sanitizeCSVCell(disc.name),
              this._sanitizeCSVCell(mod.name),
              this._sanitizeCSVCell(topic.name),
              this._sanitizeCSVCell((card.question || card.content?.question || '').replace(/"/g, '""')),
              this._sanitizeCSVCell(this._extractAnswer(card)),
              this._sanitizeCSVCell((card.tags || []).join(';')),
              sm2.mastered ? 'Yes' : 'No',
              sm2.stability ? sm2.stability.toFixed(2) : '',
              sm2.nextReview ? new Date(sm2.nextReview).toISOString().slice(0, 10) : ''
            ];
            rows.push(row.map(v => `"${v}"`).join(DELIM));
          }
        }
      }
    }

    return rows.join('\n');
  },

  // ─── Anki Export ──────────────────────────────────────────────────────────

  /**
   * Export cards in Anki-compatible TSV format.
   * Produces tab-separated: Front\tBack\tTags
   * @param {Array} hierarchy
   * @returns {string} TSV text
   */
  exportAnki(hierarchy) {
    const rows = [];

    for (const disc of hierarchy) {
      for (const mod of disc.modules) {
        for (const topic of mod.topics) {
          for (const card of topic.cards) {
            const front = (card.question || card.content?.question || '').replace(/\t/g, '');
            const back = this._extractAnswer(card).replace(/\t/g, '');
            const tags = [
              `AnswerHunter::${disc.name}`,
              `Module::${mod.name}`,
              `Topic::${topic.name}`,
              ...(card.tags || [])
            ].join('');

            if (front) {
              rows.push(`${front}\t${back}\t${tags}`);
            }
          }
        }
      }
    }

    return rows.join('\n');
  },

  // ─── Selective Export ─────────────────────────────────────────────────────

  /**
   * Export a single discipline as JSON.
   * @param {Object} discipline
   * @returns {string}
   */
  exportDisciplineJSON(discipline) {
    return JSON.stringify({
      type: 'ah_discipline_export',
      version: '2.0',
      exportedAt: new Date().toISOString(),
      discipline
    }, null, 2);
  },

  /**
   * Export notes as Markdown.
   * @param {Array} notes
   * @returns {string}
   */
  exportNotesMarkdown(notes) {
    const lines = ['# AnswerHunter — Notes Export', '', `> Exported at ${new Date().toLocaleString()}`, '', '---', ''];

    for (const note of notes) {
      const date = new Date(note.createdAt).toLocaleString();
      lines.push(`## ${note.pinned ? ' ' : ''}Note — ${date}`);
      if (note.tags.length) lines.push(`**Tags:** ${note.tags.join(',')}`);
      lines.push('');
      lines.push(note.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  },

  // ─── Download Helper ─────────────────────────────────────────────────────

  /**
   * Trigger browser download for text content.
   * @param {string} content
   * @param {string} filename
   * @param {string} mimeType
   */
  download(content, filename, mimeType = 'application/json') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 100);
  },

  /**
   * Convenience: full backup download.
   */
  async downloadBackup() {
    const json = await this.exportFullJSON();
    const date = new Date().toISOString().slice(0, 10);
    this.download(json, `answerhunter-backup-${date}.json`, 'application/json');
  },

  /**
   * Convenience: CSV download.
   */
  downloadCSV(hierarchy) {
    const csv = this.exportCSV(hierarchy);
    const date = new Date().toISOString().slice(0, 10);
    this.download(csv, `answerhunter-cards-${date}.csv`, 'text/csv');
  },

  /**
   * Convenience: Anki download.
   */
  downloadAnki(hierarchy) {
    const tsv = this.exportAnki(hierarchy);
    const date = new Date().toISOString().slice(0, 10);
    this.download(tsv, `answerhunter-anki-${date}.txt`, 'text/plain');
  },

  // ─── File Read Helper ─────────────────────────────────────────────────────

  /**
   * Read a file as text (for import).
   * @param {File} file
   * @returns {Promise<string>}
   */
  readFile(file) {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      return Promise.reject(new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 10MB.`));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  },

  // ─── Internal ─────────────────────────────────────────────────────────────

  _extractAnswer(card) {
    if (card.answer) return String(card.answer).replace(/"/g, '""');
    const c = card.content || {};
    if (c.answer) return String(c.answer).replace(/"/g, '""');
    if (c.correctAnswer) return String(c.correctAnswer).replace(/"/g, '""');
    if (c.alternatives && c.correctIndex != null) {
      return String(c.alternatives[c.correctIndex] || '').replace(/"/g, '""');
    }
    return '';
  },

  /** Sanitize CSV cell to prevent formula injection in Excel/Sheets */
  _sanitizeCSVCell(value) {
    const s = String(value || '');
    if (/^[=+\-@\t\r|\\]/.test(s)) {
      return "'" + s;
    }
    return s;
  }
};
