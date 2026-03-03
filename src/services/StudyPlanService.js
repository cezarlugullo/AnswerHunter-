/**
 * StudyPlanService.js
 * Generates and manages daily/weekly study plans.
 *
 * Features:
 *  - Auto-generate daily plan based on due cards, weak areas, new cards
 *  - Track plan completion
 *  - Weekly summary
 *  - Time-based session goals
 */

const SP_KEY = 'ah_study_plans';

export const StudyPlanService = {

  _cache: null,

  async _load() {
    if (this._cache) return this._cache;
    const data = await new Promise(r => chrome.storage.local.get([SP_KEY], d => r(d[SP_KEY] || {})));
    this._cache = data;
    return data;
  },

  async _save(data) {
    this._cache = data;
    return new Promise(r => chrome.storage.local.set({ [SP_KEY]: data }, r));
  },

  // ─── Plan Generation ─────────────────────────────────────────────────────

  /**
   * Generates a daily plan for today.
   * @param {Object} params
   * @param {Array} params.dueCards - cards due today
   * @param {Array} params.disciplines - hierarchy data
   * @param {number} [params.maxItems=10]
   * @param {number} [params.targetMinutes=30]
   * @returns {Promise<Object>} plan
   */
  async generateDailyPlan({ dueCards = [], disciplines = [], maxItems = 10, targetMinutes = 30 }) {
    const today = new Date().toISOString().slice(0, 10);
    const data = await this._load();

    // Don't regenerate if plan already exists for today
    if (data[today] && !data[today].regenerated) {
      return data[today];
    }

    const items = [];

    // 1. Priority: overdue cards (sorted by most overdue first)
    const overdue = dueCards
      .filter(c => c.sm2?.nextReview && c.sm2.nextReview < today)
      .sort((a, b) => (a.sm2?.nextReview || '').localeCompare(b.sm2?.nextReview || ''));

    for (const card of overdue.slice(0, Math.ceil(maxItems * 0.4))) {
      items.push({
        id: 'sp_' + Date.now() + '_' + items.length,
        type: 'review_overdue',
        cardId: card.id,
        label: `📌 Revisar (atrasado): ${this._truncate(card.question, 60)}`,
        disciplineName: card.disciplineName || '',
        completed: false,
        estimatedMinutes: 2
      });
    }

    // 2. Due today
    const dueToday = dueCards
      .filter(c => c.sm2?.nextReview === today)
      .slice(0, Math.ceil(maxItems * 0.3));

    for (const card of dueToday) {
      items.push({
        id: 'sp_' + Date.now() + '_' + items.length,
        type: 'review_due',
        cardId: card.id,
        label: `🔄 Revisar: ${this._truncate(card.question, 60)}`,
        disciplineName: card.disciplineName || '',
        completed: false,
        estimatedMinutes: 2
      });
    }

    // 3. Weak discipline focus
    const weakestDisc = this._findWeakestDiscipline(disciplines);
    if (weakestDisc && items.length < maxItems) {
      items.push({
        id: 'sp_' + Date.now() + '_' + items.length,
        type: 'focus_weak',
        label: `🎯 Focar em: ${weakestDisc.name} (15 min)`,
        disciplineId: weakestDisc.id,
        disciplineName: weakestDisc.name,
        completed: false,
        estimatedMinutes: 15
      });
    }

    // 4. New cards
    const newCards = dueCards.filter(c => !c.sm2?.lastRated).slice(0, 3);
    for (const card of newCards) {
      if (items.length >= maxItems) break;
      items.push({
        id: 'sp_' + Date.now() + '_' + items.length,
        type: 'learn_new',
        cardId: card.id,
        label: `✨ Aprender: ${this._truncate(card.question, 60)}`,
        disciplineName: card.disciplineName || '',
        completed: false,
        estimatedMinutes: 3
      });
    }

    const plan = {
      date: today,
      items,
      targetMinutes,
      totalEstimatedMinutes: items.reduce((s, i) => s + (i.estimatedMinutes || 2), 0),
      generatedAt: Date.now(),
      completedAt: null
    };

    data[today] = plan;

    // Clean old plans (keep last 30 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const key of Object.keys(data)) {
      if (key < cutoffStr) delete data[key];
    }

    await this._save(data);
    return plan;
  },

  /**
   * Mark a plan item as completed.
   */
  async completeItem(date, itemId) {
    const data = await this._load();
    const plan = data[date];
    if (!plan) return false;
    const item = plan.items.find(i => i.id === itemId);
    if (!item) return false;
    item.completed = true;
    item.completedAt = Date.now();

    // Check if all items are done
    if (plan.items.every(i => i.completed)) {
      plan.completedAt = Date.now();
    }

    await this._save(data);
    return true;
  },

  /**
   * Get today's plan.
   */
  async getTodayPlan() {
    const today = new Date().toISOString().slice(0, 10);
    const data = await this._load();
    return data[today] || null;
  },

  /**
   * Get weekly summary.
   * @returns {Promise<Object>}
   */
  async getWeeklySummary() {
    const data = await this._load();
    const now = new Date();
    const results = { daysStudied: 0, itemsCompleted: 0, totalItems: 0, minutesEstimated: 0 };

    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const plan = data[key];
      if (plan) {
        if (plan.items.some(item => item.completed)) results.daysStudied++;
        results.totalItems += plan.items.length;
        results.itemsCompleted += plan.items.filter(i => i.completed).length;
        results.minutesEstimated += plan.totalEstimatedMinutes || 0;
      }
    }

    results.completionRate = results.totalItems > 0
      ? Math.round((results.itemsCompleted / results.totalItems) * 100)
      : 0;

    return results;
  },

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _findWeakestDiscipline(disciplines) {
    let weakest = null;
    let lowestRatio = 1;

    for (const disc of disciplines) {
      let total = 0, mastered = 0;
      for (const mod of disc.modules || []) {
        for (const topic of mod.topics || []) {
          for (const card of topic.cards || []) {
            total++;
            if (card.sm2?.mastered) mastered++;
          }
        }
      }
      if (total >= 3) {
        const ratio = mastered / total;
        if (ratio < lowestRatio) {
          lowestRatio = ratio;
          weakest = disc;
        }
      }
    }
    return weakest;
  },

  _truncate(text, maxLen) {
    if (!text) return '(sem texto)';
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  }
};
