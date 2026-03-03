/**
 * LearningPathService.js
 * Manages learning paths — structured sequences of modules/topics
 * with prerequisites and competency gates.
 *
 * A LearningPath is:
 *   { id, name, description, disciplineId, steps: Step[], createdAt }
 * A Step is:
 *   { id, topicId, moduleId, order, requiredMastery: 0-100, locked: boolean }
 */

const LP_KEY = 'ah_learning_paths';

export const LearningPathService = {

  _cache: null,

  async _load() {
    if (this._cache) return this._cache;
    const data = await new Promise(r => chrome.storage.local.get([LP_KEY], d => r(d[LP_KEY] || [])));
    this._cache = data;
    return data;
  },

  async _save(data) {
    this._cache = data;
    return new Promise(r => chrome.storage.local.set({ [LP_KEY]: data }, r));
  },

  // ─── CRUD ────────────────────────────────────────────────────────────────

  async getAll() { return this._load(); },

  async getByDiscipline(disciplineId) {
    const all = await this._load();
    return all.filter(p => p.disciplineId === disciplineId);
  },

  async get(id) {
    const all = await this._load();
    return all.find(p => p.id === id) || null;
  },

  async create({ name, description = '', disciplineId, steps = [] }) {
    const all = await this._load();
    const path = {
      id: 'lp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      name: name.trim(),
      description,
      disciplineId,
      steps: steps.map((s, i) => ({
        id: 'lps_' + Date.now() + '_' + i,
        topicId: s.topicId || '',
        moduleId: s.moduleId || '',
        order: i,
        requiredMastery: s.requiredMastery || 70,
        locked: i > 0
      })),
      createdAt: Date.now()
    };
    all.push(path);
    await this._save(all);
    return path;
  },

  async update(id, updates) {
    const all = await this._load();
    const path = all.find(p => p.id === id);
    if (!path) return null;
    if (updates.name !== undefined) path.name = updates.name.trim();
    if (updates.description !== undefined) path.description = updates.description;
    if (updates.steps !== undefined) path.steps = updates.steps;
    path.updatedAt = Date.now();
    await this._save(all);
    return path;
  },

  async delete(id) {
    let all = await this._load();
    const before = all.length;
    all = all.filter(p => p.id !== id);
    if (all.length === before) return false;
    await this._save(all);
    return true;
  },

  // ─── Step Management ─────────────────────────────────────────────────────

  async addStep(pathId, step) {
    const all = await this._load();
    const path = all.find(p => p.id === pathId);
    if (!path) return null;
    const newStep = {
      id: 'lps_' + Date.now(),
      topicId: step.topicId || '',
      moduleId: step.moduleId || '',
      order: path.steps.length,
      requiredMastery: step.requiredMastery || 70,
      locked: path.steps.length > 0
    };
    path.steps.push(newStep);
    await this._save(all);
    return newStep;
  },

  async removeStep(pathId, stepId) {
    const all = await this._load();
    const path = all.find(p => p.id === pathId);
    if (!path) return false;
    path.steps = path.steps.filter(s => s.id !== stepId);
    path.steps.forEach((s, i) => { s.order = i; });
    await this._save(all);
    return true;
  },

  async reorderSteps(pathId, stepIds) {
    const all = await this._load();
    const path = all.find(p => p.id === pathId);
    if (!path) return false;
    const lookup = new Map(path.steps.map(s => [s.id, s]));
    path.steps = stepIds.map((id, i) => {
      const s = lookup.get(id);
      if (s) { s.order = i; s.locked = i > 0; }
      return s;
    }).filter(Boolean);
    await this._save(all);
    return true;
  },

  // ─── Progress Evaluation ─────────────────────────────────────────────────

  /**
   * Evaluates which steps are unlocked based on actual card mastery.
   * @param {string} pathId
   * @param {Function} getMasteryPct - async (topicId) => number 0-100
   * @returns {Promise<Array<{step, mastery, unlocked}>>}
   */
  async evaluateProgress(pathId, getMasteryPct) {
    const path = await this.get(pathId);
    if (!path) return [];

    const results = [];
    let allPreviousMet = true;

    for (const step of path.steps.sort((a, b) => a.order - b.order)) {
      const mastery = await getMasteryPct(step.topicId);
      const meetsThreshold = mastery >= step.requiredMastery;
      const unlocked = allPreviousMet;

      results.push({
        step,
        mastery,
        unlocked,
        completed: meetsThreshold
      });

      if (!meetsThreshold) allPreviousMet = false;
    }

    return results;
  },

  /**
   * Auto-generate a learning path from a discipline's modules/topics.
   * Creates a linear path with all topics in order.
   * @param {Object} discipline - from ContentHierarchyService
   * @returns {Promise<Object>} created path
   */
  async autoGenerate(discipline) {
    const steps = [];
    for (const mod of discipline.modules) {
      for (const topic of mod.topics) {
        steps.push({
          topicId: topic.id,
          moduleId: mod.id,
          requiredMastery: 70
        });
      }
    }
    return this.create({
      name: `Trilha: ${discipline.name}`,
      description: `Trilha automática para ${discipline.name}`,
      disciplineId: discipline.id,
      steps
    });
  }
};
