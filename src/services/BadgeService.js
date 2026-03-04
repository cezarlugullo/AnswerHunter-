/**
 * BadgeService.js
 * Gamification badges and achievements system.
 *
 * Features:
 *  - 25+ achievements across categories
 *  - Progress tracking per badge
 *  - Unlock notifications
 *  - Badge display data for UI
 */

import { BADGE_ICONS } from './BadgeIcons.js';

const BADGE_KEY = 'ah_badges';

// ─── Badge Definitions ──────────────────────────────────────────────────────
const BADGE_DEFS = [
  // ── Onboarding ──
  { id: 'first_save', category: 'onboarding', icon: BADGE_ICONS.first_save, name: 'Primeiro Passo', desc: 'Salve sua primeira questão', condition: (s) => s.totalSaved >= 1 },
  { id: 'first_review', category: 'onboarding', icon: BADGE_ICONS.first_review, name: 'Primeira Revisão', desc: 'Complete sua primeira revisão', condition: (s) => s.totalReviews >= 1 },
  { id: 'first_disc', category: 'onboarding', icon: BADGE_ICONS.first_disc, name: 'Organizado', desc: 'Crie sua primeira disciplina', condition: (s) => s.totalDisciplines >= 1 },

  // ── Volume ──
  { id: 'save_10', category: 'volume', icon: BADGE_ICONS.save_10, name: 'Colecionador', desc: 'Salve 10 questões', condition: (s) => s.totalSaved >= 10 },
  { id: 'save_50', category: 'volume', icon: BADGE_ICONS.save_50, name: 'Biblioteca', desc: 'Salve 50 questões', condition: (s) => s.totalSaved >= 50 },
  { id: 'save_100', category: 'volume', icon: BADGE_ICONS.save_100, name: 'Arquivo Vivo', desc: 'Salve 100 questões', condition: (s) => s.totalSaved >= 100 },
  { id: 'save_500', category: 'volume', icon: BADGE_ICONS.save_500, name: 'Enciclopédia', desc: 'Salve 500 questões', condition: (s) => s.totalSaved >= 500 },

  // ── Mastery ──
  { id: 'master_1', category: 'mastery', icon: BADGE_ICONS.master_1, name: 'Primeira Estrela', desc: 'Domine seu primeiro card', condition: (s) => s.totalMastered >= 1 },
  { id: 'master_10', category: 'mastery', icon: BADGE_ICONS.master_10, name: 'Estudante Dedicado', desc: 'Domine 10 cards', condition: (s) => s.totalMastered >= 10 },
  { id: 'master_50', category: 'mastery', icon: BADGE_ICONS.master_50, name: 'Semi-Expert', desc: 'Domine 50 cards', condition: (s) => s.totalMastered >= 50 },
  { id: 'master_100', category: 'mastery', icon: BADGE_ICONS.master_100, name: 'Expert', desc: 'Domine 100 cards', condition: (s) => s.totalMastered >= 100 },

  // ── Streak ──
  { id: 'streak_3', category: 'streak', icon: BADGE_ICONS.streak_3, name: 'Em Chamas', desc: '3 dias seguidos de estudo', condition: (s) => s.streak >= 3 },
  { id: 'streak_7', category: 'streak', icon: BADGE_ICONS.streak_7, name: 'Semana Perfeita', desc: '7 dias seguidos de estudo', condition: (s) => s.streak >= 7 },
  { id: 'streak_14', category: 'streak', icon: BADGE_ICONS.streak_14, name: 'Quinzena de Ferro', desc: '14 dias seguidos de estudo', condition: (s) => s.streak >= 14 },
  { id: 'streak_30', category: 'streak', icon: BADGE_ICONS.streak_30, name: 'Mês Invicto', desc: '30 dias seguidos de estudo', condition: (s) => s.streak >= 30 },
  { id: 'streak_100', category: 'streak', icon: BADGE_ICONS.streak_100, name: 'Centurião', desc: '100 dias seguidos de estudo', condition: (s) => s.streak >= 100 },

  // ── Disciplines ──
  { id: 'disc_3', category: 'breadth', icon: BADGE_ICONS.disc_3, name: 'Multidisciplinar', desc: 'Estude 3 disciplinas diferentes', condition: (s) => s.totalDisciplines >= 3 },
  { id: 'disc_5', category: 'breadth', icon: BADGE_ICONS.disc_5, name: 'Polímata', desc: 'Estude 5 disciplinas diferentes', condition: (s) => s.totalDisciplines >= 5 },
  { id: 'disc_10', category: 'breadth', icon: BADGE_ICONS.disc_10, name: 'Renascentista', desc: 'Estude 10 disciplinas diferentes', condition: (s) => s.totalDisciplines >= 10 },

  // ── Perfect Score ──
  { id: 'perfect_10', category: 'accuracy', icon: BADGE_ICONS.perfect_10, name: 'Mira Perfeita', desc: '10 revisões sem erros seguidas', condition: (s) => s.perfectStreak >= 10 },
  { id: 'perfect_25', category: 'accuracy', icon: BADGE_ICONS.perfect_25, name: 'Diamante', desc: '25 revisões sem erros seguidas', condition: (s) => s.perfectStreak >= 25 },

  // ── XP ──
  { id: 'xp_1k', category: 'xp', icon: BADGE_ICONS.xp_1k, name: '1K Club', desc: 'Alcance 1.000 XP', condition: (s) => s.xp >= 1000 },
  { id: 'xp_5k', category: 'xp', icon: BADGE_ICONS.xp_5k, name: '5K Club', desc: 'Alcance 5.000 XP', condition: (s) => s.xp >= 5000 },
  { id: 'xp_10k', category: 'xp', icon: BADGE_ICONS.xp_10k, name: '10K Legend', desc: 'Alcance 10.000 XP', condition: (s) => s.xp >= 10000 },

  // ── Special ──
  { id: 'night_owl', category: 'special', icon: BADGE_ICONS.night_owl, name: 'Coruja Noturna', desc: 'Estude após meia-noite', condition: (s) => s.nightStudy },
  { id: 'early_bird', category: 'special', icon: BADGE_ICONS.early_bird, name: 'Madrugador', desc: 'Estude antes das 6h', condition: (s) => s.earlyStudy },
];

export const BadgeService = {

  _cache: null,

  async _load() {
    if (this._cache) return this._cache;
    const data = await new Promise(r => chrome.storage.local.get([BADGE_KEY], d => r(d[BADGE_KEY] || {})));
    this._cache = data;
    return data;
  },

  async _save(data) {
    this._cache = data;
    return new Promise(r => chrome.storage.local.set({ [BADGE_KEY]: data }, r));
  },

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Get all badges with their current status.
   * @returns {Promise<Array<BadgeDisplay>>}
   */
  async getAllBadges() {
    const unlocked = await this._load();
    return BADGE_DEFS.map(def => ({
      ...def,
      unlocked: !!unlocked[def.id],
      unlockedAt: unlocked[def.id]?.unlockedAt || null
    }));
  },

  /**
   * Get only unlocked badges.
   * @returns {Promise<Array>}
   */
  async getUnlocked() {
    const all = await this.getAllBadges();
    return all.filter(b => b.unlocked);
  },

  /**
   * Get badges by category.
   * @param {string} category
   */
  async getByCategory(category) {
    const all = await this.getAllBadges();
    return all.filter(b => b.category === category);
  },

  /**
   * Evaluate all badges against current stats and unlock new ones.
   * Returns newly unlocked badges.
   * @param {Object} stats - current user stats
   * @returns {Promise<Array<Badge>>}
   */
  async evaluate(stats) {
    const data = await this._load();
    const newlyUnlocked = [];

    for (const def of BADGE_DEFS) {
      if (data[def.id]) continue; // Already unlocked

      try {
        if (def.condition(stats)) {
          data[def.id] = { unlockedAt: Date.now() };
          newlyUnlocked.push(def);
        }
      } catch {
        // Skip evaluation errors
      }
    }

    if (newlyUnlocked.length > 0) {
      await this._save(data);
      console.log('[BadgeService] Newly unlocked:', newlyUnlocked.map(b => b.name));
    }

    return newlyUnlocked;
  },

  /**
   * Build stats object for badge evaluation from hierarchy + XP data.
   * @param {Array} hierarchy
   * @param {Object} xpData
   * @returns {Object}
   */
  buildStats(hierarchy, xpData = {}) {
    let totalSaved = 0, totalMastered = 0, totalReviews = 0;
    let totalDisciplines = hierarchy.length;
    let perfectStreak = 0;

    for (const disc of hierarchy) {
      for (const mod of disc.modules) {
        for (const topic of mod.topics) {
          for (const card of topic.cards) {
            totalSaved++;
            const sm2 = card.sm2 || {};
            if (sm2.mastered) totalMastered++;
            totalReviews += sm2.attempts || 0;
          }
        }
      }
    }

    const hour = new Date().getHours();

    return {
      totalSaved,
      totalMastered,
      totalReviews,
      totalDisciplines,
      streak: xpData.streak || 0,
      xp: xpData.xp || 0,
      perfectStreak: xpData.perfectStreak || 0,
      nightStudy: hour >= 0 && hour < 5,
      earlyStudy: hour >= 4 && hour < 6,
    };
  },

  /**
   * Get total count of unlocked badges.
   */
  async getCount() {
    const data = await this._load();
    return Object.keys(data).length;
  },

  /**
   * Get all badge categories.
   */
  getCategories() {
    const cats = new Map();
    for (const def of BADGE_DEFS) {
      if (!cats.has(def.category)) {
        cats.set(def.category, {
          id: def.category,
          name: this._categoryName(def.category),
          badges: []
        });
      }
      cats.get(def.category).badges.push(def);
    }
    return Array.from(cats.values());
  },

  _categoryName(cat) {
    const names = {
      onboarding: 'Primeiros Passos',
      volume: 'Volume',
      mastery: 'Domínio',
      streak: 'Sequência',
      breadth: 'Amplitude',
      accuracy: 'Precisão',
      xp: 'Experiência',
      special: 'Especiais'
    };
    return names[cat] || cat;
  }
};
