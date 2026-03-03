/**
 * ContentHierarchyService.js
 * Full CRUD for the v2 hierarchical data model:
 *   Discipline → Module → Topic → Card
 *
 * Works with the ah_hierarchy storage key (created by MigrationService).
 * Falls back to building hierarchy from binderStructure + ah_disciplines
 * if ah_hierarchy doesn't exist yet.
 */

const H_KEY = 'ah_hierarchy';

export const ContentHierarchyService = {

  _cache: null,

  // ─── Initialization ──────────────────────────────────────────────────────

  /**
   * Load the hierarchy from storage (with caching).
   * @param {boolean} force - bypass cache
   * @returns {Promise<Array<Discipline>>}
   */
  async load(force = false) {
    if (this._cache && !force) return this._cache;
    const data = await new Promise(resolve => {
      chrome.storage.local.get([H_KEY], d => resolve(d[H_KEY] || []));
    });
    this._cache = data;
    return data;
  },

  /**
   * Persist the entire hierarchy.
   * @param {Array} hierarchy
   */
  async save(hierarchy) {
    this._cache = hierarchy;
    return new Promise(resolve => {
      chrome.storage.local.set({ [H_KEY]: hierarchy }, resolve);
    });
  },

  /** Invalidate cache */
  invalidate() { this._cache = null; },

  // ─── Discipline CRUD ─────────────────────────────────────────────────────

  /**
   * @returns {Promise<Array>}
   */
  async getDisciplines() {
    return this.load();
  },

  /**
   * Get a single discipline by ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getDiscipline(id) {
    const h = await this.load();
    return h.find(d => d.id === id) || null;
  },

  /**
   * Create a new discipline.
   * @param {{name: string, icon?: string, color?: string}} data
   * @returns {Promise<Object>}
   */
  async createDiscipline({ name, icon = '📚', color = '#FF6B6B' }) {
    const h = await this.load();
    const disc = {
      id: 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      icon,
      color,
      modules: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    h.push(disc);
    await this.save(h);

    // Also add to ah_disciplines for backward compatibility
    await this._syncToLegacyDisciplines(disc);

    return disc;
  },

  /**
   * Update discipline fields (name, icon, color).
   * @param {string} id
   * @param {Object} updates
   * @returns {Promise<Object|null>}
   */
  async updateDiscipline(id, updates) {
    const h = await this.load();
    const disc = h.find(d => d.id === id);
    if (!disc) return null;
    if (updates.name !== undefined) disc.name = updates.name.trim();
    if (updates.icon !== undefined) disc.icon = updates.icon;
    if (updates.color !== undefined) disc.color = updates.color;
    disc.updatedAt = Date.now();
    await this.save(h);
    return disc;
  },

  /**
   * Delete a discipline and all its contents.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteDiscipline(id) {
    let h = await this.load();
    const before = h.length;
    h = h.filter(d => d.id !== id);
    if (h.length === before) return false;
    await this.save(h);
    return true;
  },

  // ─── Module CRUD ─────────────────────────────────────────────────────────

  /**
   * Get all modules for a discipline.
   * @param {string} disciplineId
   * @returns {Promise<Array>}
   */
  async getModules(disciplineId) {
    const disc = await this.getDiscipline(disciplineId);
    return disc ? disc.modules : [];
  },

  /**
   * Create a module inside a discipline.
   * @param {string} disciplineId
   * @param {{name: string}} data
   * @returns {Promise<Object|null>}
   */
  async createModule(disciplineId, { name }) {
    const h = await this.load();
    const disc = h.find(d => d.id === disciplineId);
    if (!disc) return null;
    const mod = {
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      order: disc.modules.length,
      topics: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    disc.modules.push(mod);
    disc.updatedAt = Date.now();
    await this.save(h);
    return mod;
  },

  /**
   * Update a module (name, order).
   * @param {string} disciplineId
   * @param {string} moduleId
   * @param {Object} updates
   * @returns {Promise<Object|null>}
   */
  async updateModule(disciplineId, moduleId, updates) {
    const h = await this.load();
    const disc = h.find(d => d.id === disciplineId);
    if (!disc) return null;
    const mod = disc.modules.find(m => m.id === moduleId);
    if (!mod) return null;
    if (updates.name !== undefined) mod.name = updates.name.trim();
    if (updates.order !== undefined) mod.order = updates.order;
    mod.updatedAt = Date.now();
    disc.updatedAt = Date.now();
    await this.save(h);
    return mod;
  },

  /**
   * Delete a module.
   * @param {string} disciplineId
   * @param {string} moduleId
   * @returns {Promise<boolean>}
   */
  async deleteModule(disciplineId, moduleId) {
    const h = await this.load();
    const disc = h.find(d => d.id === disciplineId);
    if (!disc) return false;
    const before = disc.modules.length;
    disc.modules = disc.modules.filter(m => m.id !== moduleId);
    if (disc.modules.length === before) return false;
    disc.updatedAt = Date.now();
    await this.save(h);
    return true;
  },

  /**
   * Reorder modules within a discipline.
   * @param {string} disciplineId
   * @param {string[]} moduleIds - ordered list of IDs
   */
  async reorderModules(disciplineId, moduleIds) {
    const h = await this.load();
    const disc = h.find(d => d.id === disciplineId);
    if (!disc) return;
    const lookup = new Map(disc.modules.map(m => [m.id, m]));
    disc.modules = moduleIds.map((id, i) => {
      const m = lookup.get(id);
      if (m) m.order = i;
      return m;
    }).filter(Boolean);
    disc.updatedAt = Date.now();
    await this.save(h);
  },

  // ─── Topic CRUD ──────────────────────────────────────────────────────────

  /**
   * Find a module within a discipline.
   * @param {string} disciplineId
   * @param {string} moduleId
   * @returns {Promise<Object|null>}
   */
  async _findModule(disciplineId, moduleId) {
    const disc = await this.getDiscipline(disciplineId);
    if (!disc) return null;
    return disc.modules.find(m => m.id === moduleId) || null;
  },

  /**
   * Get all topics for a module.
   */
  async getTopics(disciplineId, moduleId) {
    const mod = await this._findModule(disciplineId, moduleId);
    return mod ? mod.topics : [];
  },

  /**
   * Create a topic inside a module.
   */
  async createTopic(disciplineId, moduleId, { name }) {
    const h = await this.load();
    const disc = h.find(d => d.id === disciplineId);
    if (!disc) return null;
    const mod = disc.modules.find(m => m.id === moduleId);
    if (!mod) return null;
    const topic = {
      id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      order: mod.topics.length,
      cards: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    mod.topics.push(topic);
    mod.updatedAt = Date.now();
    disc.updatedAt = Date.now();
    await this.save(h);
    return topic;
  },

  /**
   * Update a topic.
   */
  async updateTopic(disciplineId, moduleId, topicId, updates) {
    const h = await this.load();
    const disc = h.find(d => d.id === disciplineId);
    if (!disc) return null;
    const mod = disc.modules.find(m => m.id === moduleId);
    if (!mod) return null;
    const topic = mod.topics.find(t => t.id === topicId);
    if (!topic) return null;
    if (updates.name !== undefined) topic.name = updates.name.trim();
    if (updates.order !== undefined) topic.order = updates.order;
    topic.updatedAt = Date.now();
    await this.save(h);
    return topic;
  },

  /**
   * Delete a topic.
   */
  async deleteTopic(disciplineId, moduleId, topicId) {
    const h = await this.load();
    const disc = h.find(d => d.id === disciplineId);
    if (!disc) return false;
    const mod = disc.modules.find(m => m.id === moduleId);
    if (!mod) return false;
    const before = mod.topics.length;
    mod.topics = mod.topics.filter(t => t.id !== topicId);
    if (mod.topics.length === before) return false;
    mod.updatedAt = Date.now();
    await this.save(h);
    return true;
  },

  // ─── Card CRUD ───────────────────────────────────────────────────────────

  /**
   * Find the topic that contains a card location.
   * @returns {{disc, mod, topic}|null}
   */
  _findCardLocation(hierarchy, cardId) {
    for (const disc of hierarchy) {
      for (const mod of disc.modules) {
        for (const topic of mod.topics) {
          if (topic.cards.some(c => c.id === cardId)) {
            return { disc, mod, topic };
          }
        }
      }
    }
    return null;
  },

  /**
   * Get all cards for a topic.
   */
  async getCards(disciplineId, moduleId, topicId) {
    const h = await this.load();
    const disc = h.find(d => d.id === disciplineId);
    if (!disc) return [];
    const mod = disc.modules.find(m => m.id === moduleId);
    if (!mod) return [];
    const topic = mod.topics.find(t => t.id === topicId);
    return topic ? topic.cards : [];
  },

  /**
   * Add a card to a topic.
   */
  async createCard(disciplineId, moduleId, topicId, cardData) {
    const h = await this.load();
    const disc = h.find(d => d.id === disciplineId);
    if (!disc) return null;
    const mod = disc.modules.find(m => m.id === moduleId);
    if (!mod) return null;
    const topic = mod.topics.find(t => t.id === topicId);
    if (!topic) return null;

    const card = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      question: cardData.question || '',
      answer: cardData.answer || '',
      source: cardData.source || '',
      sm2: cardData.sm2 || {
        interval: 0, repetition: 0, ef: 2.5, nextReview: '', lastRated: '',
        attempts: 0, correct: 0, errors: 0, mastered: false, tags: [], hintUsedLast: false
      },
      tags: cardData.tags || [],
      notes: cardData.notes || '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    topic.cards.push(card);
    topic.updatedAt = Date.now();
    await this.save(h);
    return card;
  },

  /**
   * Update a card.
   */
  async updateCard(cardId, updates) {
    const h = await this.load();
    const loc = this._findCardLocation(h, cardId);
    if (!loc) return null;

    const card = loc.topic.cards.find(c => c.id === cardId);
    if (!card) return null;

    for (const key of ['question', 'answer', 'source', 'tags', 'notes']) {
      if (updates[key] !== undefined) card[key] = updates[key];
    }
    if (updates.sm2) {
      card.sm2 = { ...card.sm2, ...updates.sm2 };
    }
    card.updatedAt = Date.now();
    await this.save(h);
    return card;
  },

  /**
   * Delete a card.
   */
  async deleteCard(cardId) {
    const h = await this.load();
    const loc = this._findCardLocation(h, cardId);
    if (!loc) return false;
    const before = loc.topic.cards.length;
    loc.topic.cards = loc.topic.cards.filter(c => c.id !== cardId);
    if (loc.topic.cards.length === before) return false;
    loc.topic.updatedAt = Date.now();
    await this.save(h);
    return true;
  },

  /**
   * Move card from one topic to another.
   */
  async moveCard(cardId, targetDisciplineId, targetModuleId, targetTopicId) {
    const h = await this.load();
    const loc = this._findCardLocation(h, cardId);
    if (!loc) return false;

    // Extract card
    const cardIndex = loc.topic.cards.findIndex(c => c.id === cardId);
    const [card] = loc.topic.cards.splice(cardIndex, 1);

    // Find target
    const targetDisc = h.find(d => d.id === targetDisciplineId);
    if (!targetDisc) { loc.topic.cards.push(card); return false; }
    const targetMod = targetDisc.modules.find(m => m.id === targetModuleId);
    if (!targetMod) { loc.topic.cards.push(card); return false; }
    const targetTopic = targetMod.topics.find(t => t.id === targetTopicId);
    if (!targetTopic) { loc.topic.cards.push(card); return false; }

    targetTopic.cards.push(card);
    card.updatedAt = Date.now();
    await this.save(h);
    return true;
  },

  // ─── Aggregation / Stats ─────────────────────────────────────────────────

  /**
   * Get all cards across the entire hierarchy.
   * @returns {Promise<Array>}
   */
  async getAllCards() {
    const h = await this.load();
    const cards = [];
    for (const disc of h) {
      for (const mod of disc.modules) {
        for (const topic of mod.topics) {
          for (const card of topic.cards) {
            cards.push({ ...card, disciplineId: disc.id, disciplineName: disc.name, moduleName: mod.name, topicName: topic.name });
          }
        }
      }
    }
    return cards;
  },

  /**
   * Get statistics for a discipline.
   * @param {string} disciplineId
   * @returns {Promise<Object>}
   */
  async getDisciplineStats(disciplineId) {
    const disc = await this.getDiscipline(disciplineId);
    if (!disc) return null;

    const today = new Date().toISOString().slice(0, 10);
    let totalCards = 0, mastered = 0, due = 0, newCards = 0;
    let totalModules = disc.modules.length;
    let totalTopics = 0;

    for (const mod of disc.modules) {
      totalTopics += mod.topics.length;
      for (const topic of mod.topics) {
        for (const card of topic.cards) {
          totalCards++;
          const sm2 = card.sm2 || {};
          if (sm2.mastered) mastered++;
          if (!sm2.lastRated) newCards++;
          else if (!sm2.nextReview || sm2.nextReview <= today) due++;
        }
      }
    }

    return {
      totalCards,
      mastered,
      due,
      newCards,
      totalModules,
      totalTopics,
      masteryPct: totalCards > 0 ? Math.round((mastered / totalCards) * 100) : 0,
      duePct: totalCards > 0 ? Math.round((due / totalCards) * 100) : 0
    };
  },

  /**
   * Get global stats across all disciplines.
   * @returns {Promise<Object>}
   */
  async getGlobalStats() {
    const h = await this.load();
    const today = new Date().toISOString().slice(0, 10);
    let totalCards = 0, mastered = 0, due = 0, newCards = 0;

    for (const disc of h) {
      for (const mod of disc.modules) {
        for (const topic of mod.topics) {
          for (const card of topic.cards) {
            totalCards++;
            const sm2 = card.sm2 || {};
            if (sm2.mastered) mastered++;
            if (!sm2.lastRated) newCards++;
            else if (!sm2.nextReview || sm2.nextReview <= today) due++;
          }
        }
      }
    }

    return {
      totalDisciplines: h.length,
      totalCards,
      mastered,
      due,
      newCards,
      masteryPct: totalCards > 0 ? Math.round((mastered / totalCards) * 100) : 0
    };
  },

  /**
   * Get due cards across all disciplines.
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async getDueCards(limit = 50) {
    const all = await this.getAllCards();
    const today = new Date().toISOString().slice(0, 10);
    return all
      .filter(c => {
        const sm2 = c.sm2 || {};
        return !sm2.nextReview || sm2.nextReview <= today;
      })
      .slice(0, limit);
  },

  // ─── Backward Compat ─────────────────────────────────────────────────────

  async _syncToLegacyDisciplines(disc) {
    const list = await new Promise(resolve => {
      chrome.storage.local.get(['ah_disciplines'], d => resolve(d.ah_disciplines || []));
    });
    if (!list.some(d => d.name.toLowerCase() === disc.name.toLowerCase())) {
      list.push({ id: disc.id, name: disc.name, color: disc.color, createdAt: disc.createdAt });
      await new Promise(resolve => {
        chrome.storage.local.set({ ah_disciplines: list }, resolve);
      });
    }
  }
};
