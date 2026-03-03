/**
 * SearchIndexService.js
 * In-memory fuzzy search index over the hierarchy cards.
 *
 * Supports:
 *  - Full-text search with fuzzy matching (Levenshtein-based)
 *  - Tag filtering
 *  - Discipline / module / topic filtering
 *  - Due-date filtering
 *  - Result ranking by relevance
 *
 * The index is rebuilt on init() from the hierarchy stored by ContentHierarchyService.
 * Call rebuild() after bulk mutations.
 */

const H_KEY = 'ah_hierarchy';

export const SearchIndexService = {

  /** @type {Array<IndexEntry>} */
  _index: [],
  _ready: false,

  // ─── Build / Rebuild ─────────────────────────────────────────────────────

  /**
   * Build the search index from hierarchy.
   * @returns {Promise<number>} number of indexed entries
   */
  async build() {
    const hierarchy = await new Promise(resolve => {
      chrome.storage.local.get([H_KEY], d => resolve(d[H_KEY] || []));
    });

    this._index = [];

    for (const disc of hierarchy) {
      for (const mod of disc.modules) {
        for (const topic of mod.topics) {
          for (const card of topic.cards) {
            this._index.push({
              cardId: card.id,
              disciplineId: disc.id,
              disciplineName: disc.name,
              disciplineColor: disc.color,
              moduleId: mod.id,
              moduleName: mod.name,
              topicId: topic.id,
              topicName: topic.name,
              question: (card.question || '').toLowerCase(),
              answer: (card.answer || '').toLowerCase(),
              source: (card.source || '').toLowerCase(),
              tags: (card.tags || []).map(t => t.toLowerCase()),
              notes: (card.notes || '').toLowerCase(),
              sm2: card.sm2 || {},
              createdAt: card.createdAt || 0,
              updatedAt: card.updatedAt || 0,
              // Combined text for relevance scoring
              _text: [
                card.question, card.answer, card.source, card.notes,
                disc.name, mod.name, topic.name,
                ...(card.tags || [])
              ].join(' ').toLowerCase()
            });
          }
        }
      }
    }

    this._ready = true;
    console.log(`[SearchIndex] Indexed ${this._index.length} cards`);
    return this._index.length;
  },

  /**
   * Alias for build()
   */
  async rebuild() {
    return this.build();
  },

  /**
   * Whether the index is built.
   */
  get ready() { return this._ready; },

  // ─── Search ──────────────────────────────────────────────────────────────

  /**
   * Full-text fuzzy search.
   * @param {string} query - search terms
   * @param {Object} [filters] - optional filters
   * @param {string} [filters.disciplineId] - restrict to discipline
   * @param {string} [filters.moduleId] - restrict to module
   * @param {string} [filters.topicId] - restrict to topic
   * @param {string[]} [filters.tags] - must have ALL these tags
   * @param {boolean} [filters.dueOnly] - only cards due for review
   * @param {boolean} [filters.newOnly] - only unreviewed cards
   * @param {boolean} [filters.masteredOnly] - only mastered cards
   * @param {string} [filters.sort] - 'relevance'|'newest'|'oldest'|'due'
   * @param {number} [limit=50]
   * @returns {Array<SearchResult>}
   */
  search(query, filters = {}, limit = 50) {
    if (!this._ready) {
      console.warn('[SearchIndex] Not ready — call build() first');
      return [];
    }

    const terms = (query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    let results = [];

    for (const entry of this._index) {
      // Apply hard filters
      if (filters.disciplineId && entry.disciplineId !== filters.disciplineId) continue;
      if (filters.moduleId && entry.moduleId !== filters.moduleId) continue;
      if (filters.topicId && entry.topicId !== filters.topicId) continue;

      if (filters.tags && filters.tags.length > 0) {
        const entryTags = new Set(entry.tags);
        if (!filters.tags.every(t => entryTags.has(t.toLowerCase()))) continue;
      }

      if (filters.dueOnly) {
        const nr = entry.sm2.nextReview;
        if (nr && nr > today) continue;
      }

      if (filters.newOnly && entry.sm2.lastRated) continue;
      if (filters.masteredOnly && !entry.sm2.mastered) continue;

      // Score terms
      let score = 0;
      if (terms.length === 0) {
        score = 1; // No query = match everything (filtered)
      } else {
        for (const term of terms) {
          // Exact substring match
          if (entry._text.includes(term)) {
            score += 10;
            // Bonus for question match
            if (entry.question.includes(term)) score += 5;
            // Bonus for tag match
            if (entry.tags.some(t => t.includes(term))) score += 3;
          } else {
            // Fuzzy match: check each word in text
            const words = entry._text.split(/\s+/);
            let bestFuzzy = 0;
            for (const word of words) {
              if (word.length < 3 || term.length < 3) continue;
              const dist = this._levenshtein(term, word.slice(0, term.length + 2));
              const maxLen = Math.max(term.length, word.length);
              const similarity = 1 - dist / maxLen;
              if (similarity > 0.7) {
                bestFuzzy = Math.max(bestFuzzy, similarity * 5);
              }
            }
            score += bestFuzzy;
          }
        }
      }

      if (score <= 0) continue;

      results.push({
        ...entry,
        _score: score
      });
    }

    // Sort
    const sort = filters.sort || (terms.length > 0 ? 'relevance' : 'newest');
    switch (sort) {
      case 'relevance':
        results.sort((a, b) => b._score - a._score);
        break;
      case 'newest':
        results.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'oldest':
        results.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'due':
        results.sort((a, b) => {
          const aDate = a.sm2.nextReview || '9999';
          const bDate = b.sm2.nextReview || '9999';
          return aDate.localeCompare(bDate);
        });
        break;
    }

    return results.slice(0, limit).map(({ _score, _text, ...rest }) => ({
      ...rest,
      relevance: _score
    }));
  },

  /**
   * Get all unique tags across the index.
   * @returns {Array<{tag: string, count: number}>}
   */
  getAllTags() {
    const tagMap = new Map();
    for (const entry of this._index) {
      for (const tag of entry.tags) {
        tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
      }
    }
    return Array.from(tagMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  },

  /**
   * Quick stats from the index.
   */
  getStats() {
    const today = new Date().toISOString().slice(0, 10);
    let total = 0, due = 0, mastered = 0, newCards = 0;
    const disciplines = new Set();

    for (const e of this._index) {
      total++;
      disciplines.add(e.disciplineId);
      if (e.sm2.mastered) mastered++;
      if (!e.sm2.lastRated) newCards++;
      else if (!e.sm2.nextReview || e.sm2.nextReview <= today) due++;
    }

    return { total, due, mastered, newCards, disciplineCount: disciplines.size };
  },

  // ─── Utility ─────────────────────────────────────────────────────────────

  /**
   * Basic Levenshtein distance.
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  _levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b[i - 1] === a[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[b.length][a.length];
  }
};
