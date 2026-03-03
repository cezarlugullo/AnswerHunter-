/**
 * NotesService.js
 * Per-card and per-topic note-taking system.
 *
 * Features:
 *  - Markdown-like notes
 *  - Tag support
 *  - Timestamps
 *  - Search within notes
 *  - Pin important notes
 */

const NOTES_KEY = 'ah_notes';

export const NotesService = {

  _cache: null,

  async _load() {
    if (this._cache) return this._cache;
    const data = await new Promise(r =>
      chrome.storage.local.get([NOTES_KEY], d => r(d[NOTES_KEY] || {}))
    );
    this._cache = data;
    return data;
  },

  async _save(data) {
    this._cache = data;
    return new Promise(r => chrome.storage.local.set({ [NOTES_KEY]: data }, r));
  },

  _generateId() {
    return 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  /**
   * Create a new note.
   * @param {Object} opts
   * @param {string} opts.content   - Note text (markdown)
   * @param {string} [opts.cardId]  - Parent card ID
   * @param {string} [opts.topicId] - Parent topic ID
   * @param {string} [opts.discId]  - Parent discipline ID
   * @param {string[]} [opts.tags]  - Note tags
   * @param {boolean} [opts.pinned] - Whether pinned
   * @returns {Promise<Object>} created note
   */
  async create({ content, cardId, topicId, discId, tags = [], pinned = false }) {
    const data = await this._load();
    const noteId = this._generateId();

    const note = {
      id: noteId,
      content: content.trim(),
      cardId: cardId || null,
      topicId: topicId || null,
      discId: discId || null,
      tags,
      pinned,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    data[noteId] = note;
    await this._save(data);
    return note;
  },

  /**
   * Update note content / meta.
   */
  async update(noteId, updates) {
    const data = await this._load();
    if (!data[noteId]) throw new Error('Note not found');

    const allowed = ['content', 'tags', 'pinned', 'cardId', 'topicId', 'discId'];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        data[noteId][key] = updates[key];
      }
    }
    data[noteId].updatedAt = Date.now();

    await this._save(data);
    return data[noteId];
  },

  /**
   * Delete a note.
   */
  async delete(noteId) {
    const data = await this._load();
    delete data[noteId];
    await this._save(data);
  },

  /**
   * Get a single note.
   */
  async get(noteId) {
    const data = await this._load();
    return data[noteId] || null;
  },

  // ─── Queries ──────────────────────────────────────────────────────────────

  /**
   * Get all notes, sorted by pinned first then newest.
   */
  async getAll() {
    const data = await this._load();
    return this._sorted(Object.values(data));
  },

  /**
   * Get notes for a specific card.
   */
  async getForCard(cardId) {
    const data = await this._load();
    return this._sorted(Object.values(data).filter(n => n.cardId === cardId));
  },

  /**
   * Get notes for a specific topic.
   */
  async getForTopic(topicId) {
    const data = await this._load();
    return this._sorted(Object.values(data).filter(n => n.topicId === topicId));
  },

  /**
   * Get notes for a specific discipline.
   */
  async getForDiscipline(discId) {
    const data = await this._load();
    return this._sorted(Object.values(data).filter(n => n.discId === discId));
  },

  /**
   * Search notes by text or tags.
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async search(query) {
    if (!query || !query.trim()) return this.getAll();
    const data = await this._load();
    const q = query.toLowerCase().trim();

    const results = Object.values(data).filter(n => {
      // Match content
      if (n.content.toLowerCase().includes(q)) return true;
      // Match tags
      if (n.tags.some(tag => tag.toLowerCase().includes(q))) return true;
      return false;
    });

    return this._sorted(results);
  },

  /**
   * Get all unique tags across all notes.
   */
  async getAllTags() {
    const data = await this._load();
    const tagSet = new Set();
    for (const note of Object.values(data)) {
      for (const tag of note.tags) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  },

  /**
   * Get notes by tag.
   */
  async getByTag(tag) {
    const data = await this._load();
    return this._sorted(
      Object.values(data).filter(n => n.tags.includes(tag))
    );
  },

  /**
   * Toggle pin status.
   */
  async togglePin(noteId) {
    const data = await this._load();
    if (!data[noteId]) return null;
    data[noteId].pinned = !data[noteId].pinned;
    data[noteId].updatedAt = Date.now();
    await this._save(data);
    return data[noteId];
  },

  /**
   * Get total note count.
   */
  async getCount() {
    const data = await this._load();
    return Object.keys(data).length;
  },

  /**
   * Get note statistics.
   */
  async getStats() {
    const data = await this._load();
    const notes = Object.values(data);
    const tags = new Set();
    let totalChars = 0;
    let pinned = 0;
    let withCards = 0;

    for (const n of notes) {
      totalChars += n.content.length;
      if (n.pinned) pinned++;
      if (n.cardId) withCards++;
      for (const t of n.tags) tags.add(t);
    }

    return {
      total: notes.length,
      pinned,
      withCards,
      uniqueTags: tags.size,
      avgLength: notes.length ? Math.round(totalChars / notes.length) : 0
    };
  },

  /**
   * Bulk delete notes for a card (cleanup).
   */
  async deleteForCard(cardId) {
    const data = await this._load();
    for (const id of Object.keys(data)) {
      if (data[id].cardId === cardId) delete data[id];
    }
    await this._save(data);
  },

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _sorted(notes) {
    return notes.sort((a, b) => {
      // Pinned first
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      // Then newest
      return b.updatedAt - a.updatedAt;
    });
  }
};
