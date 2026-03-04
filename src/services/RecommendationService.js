/**
 * RecommendationService.js
 * Smart study recommendations based on spaced repetition data,
 * performance patterns, and study history.
 *
 * Provides:
 *  - "What to study next" ranking
 *  - Weak area detection
 *  - Optimal review time suggestions
 *  - Forgetting risk alerts
 */

export const RecommendationService = {

  /**
   * Generate ranked study recommendations.
   * @param {Object} params
   * @param {Array} params.hierarchy - full discipline hierarchy
   * @param {Object} [params.xpData] - XP and streak data
   * @returns {Array<Recommendation>}
   */
  generateRecommendations({ hierarchy, xpData = {} }) {
    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const recommendations = [];

    // Collect all cards with context
    const allCards = [];
    for (const disc of hierarchy) {
      for (const mod of disc.modules) {
        for (const topic of mod.topics) {
          for (const card of topic.cards) {
            allCards.push({
              ...card,
              disciplineId: disc.id,
              disciplineName: disc.name,
              disciplineColor: disc.color,
              moduleName: mod.name,
              topicName: topic.name,
              topicId: topic.id
            });
          }
        }
      }
    }

    // 1. Critical overdue cards (>3 days overdue)
    const criticalOverdue = allCards.filter(c => {
      const nr = c.sm2?.nextReview;
      if (!nr) return false;
      const days = Math.round((Date.parse(today) - Date.parse(nr)) / 86400000);
      return days > 3;
    }).sort((a, b) => (a.sm2?.nextReview || '').localeCompare(b.sm2?.nextReview || ''));

    if (criticalOverdue.length > 0) {
      recommendations.push({
        id: 'critical_overdue',
        type: 'urgent',
        priority: 100,
        icon: '',
        title: `${criticalOverdue.length} cards criticamente atrasados`,
        description: `Esses cards estão atrasados há mais de 3 dias. Sua retenção está caindo rapidamente.`,
        action: 'review',
        cardIds: criticalOverdue.slice(0, 20).map(c => c.id),
        disciplineName: this._topDiscipline(criticalOverdue)
      });
    }

    // 2. Due today
    const dueToday = allCards.filter(c => {
      const nr = c.sm2?.nextReview;
      return !nr || nr <= today;
    });

    if (dueToday.length > 0) {
      recommendations.push({
        id: 'due_today',
        type: 'review',
        priority: 80,
        icon: '',
        title: `${dueToday.length} cards para revisar hoje`,
        description: 'Complete suas revisões diárias para manter o espaçamento ótimo.',
        action: 'review',
        cardIds: dueToday.slice(0, 30).map(c => c.id)
      });
    }

    // 3. Weak disciplines (mastery < 30%)
    const discStats = this._disciplineStats(hierarchy);
    const weakDiscs = discStats.filter(d => d.masteryPct < 30 && d.totalCards >= 3);
    for (const wd of weakDiscs.slice(0, 2)) {
      recommendations.push({
        id: 'weak_' + wd.id,
        type: 'focus',
        priority: 60,
        icon: '',
        title: `Foco: ${wd.name}`,
        description: `Apenas ${wd.masteryPct}% dominado (${wd.mastered}/${wd.totalCards}). Dedique mais tempo aqui.`,
        action: 'study_discipline',
        disciplineId: wd.id,
        disciplineName: wd.name
      });
    }

    // 4. Low-stability cards at risk of forgetting
    const atRisk = allCards.filter(c => {
      const s = c.sm2?.fsrs_stability;
      const lr = c.sm2?.lastRated;
      if (!s || !lr) return false;
      const elapsed = Math.round((Date.parse(today) - Date.parse(lr)) / 86400000);
      const retention = this._forgettingCurve(elapsed, s);
      return retention < 0.5 && retention > 0; // Between 0-50% retention
    });

    if (atRisk.length > 0) {
      recommendations.push({
        id: 'at_risk',
        type: 'warning',
        priority: 70,
        icon: '',
        title: `${atRisk.length} cards com risco de esquecimento`,
        description: 'Esses cards têm retenção estimada abaixo de 50%. Revise antes que esqueça!',
        action: 'review',
        cardIds: atRisk.slice(0, 20).map(c => c.id)
      });
    }

    // 5. New cards to learn
    const newCards = allCards.filter(c => !c.sm2?.lastRated);
    if (newCards.length > 0) {
      recommendations.push({
        id: 'new_cards',
        type: 'learn',
        priority: 40,
        icon: '',
        title: `${newCards.length} cards novos para aprender`,
        description: 'Comece a aprender novos conteúdos após completar as revisões.',
        action: 'learn',
        cardIds: newCards.slice(0, 10).map(c => c.id)
      });
    }

    // 6. Streak motivation
    const streak = xpData.streak || 0;
    if (streak > 0 && dueToday.length > 0) {
      recommendations.push({
        id: 'streak',
        type: 'motivation',
        priority: 30,
        icon: '',
        title: `Mantenha sua sequência de ${streak} dias!`,
        description: 'Complete pelo menos uma revisão hoje para não perder seu streak.',
        action: 'review'
      });
    }

    // 7. Celebrate progress
    const totalMastered = allCards.filter(c => c.sm2?.mastered).length;
    if (totalMastered > 0 && totalMastered % 10 === 0) {
      recommendations.push({
        id: 'celebrate',
        type: 'celebration',
        priority: 10,
        icon: '',
        title: `Parabéns! ${totalMastered} cards dominados!`,
        description: 'Seu progresso é impressionante. Continue assim!',
        action: 'none'
      });
    }

    // Sort by priority
    return recommendations.sort((a, b) => b.priority - a.priority);
  },

  /**
   * Get the single most important thing to study right now.
   */
  getTopRecommendation(params) {
    const recs = this.generateRecommendations(params);
    return recs[0] || null;
  },

  /**
   * Suggest optimal study time based on past activity.
   * @param {Object<string, number>} activityData - date → reviews count
   * @returns {{hour: number, dayOfWeek: string, reason: string}}
   */
  suggestStudyTime(activityData) {
    // Simple heuristic based on when user has studied most
    // In a real implementation, this would use the AnalyticsService session data
    const now = new Date();
    const hour = now.getHours();

    if (hour < 12) {
      return { hour: 8, dayOfWeek: 'today', reason: 'Manhã é ideal para retenção de longo prazo.' };
    } else if (hour < 18) {
      return { hour: 14, dayOfWeek: 'today', reason: 'Tarde é boa para revisão de material já visto.' };
    }
    return { hour: 20, dayOfWeek: 'today', reason: 'Estudar antes de dormir consolida a memória.' };
  },

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _disciplineStats(hierarchy) {
    return hierarchy.map(disc => {
      let total = 0, mastered = 0;
      for (const mod of disc.modules) {
        for (const topic of mod.topics) {
          for (const card of topic.cards) {
            total++;
            if (card.sm2?.mastered) mastered++;
          }
        }
      }
      return {
        id: disc.id,
        name: disc.name,
        totalCards: total,
        mastered,
        masteryPct: total > 0 ? Math.round((mastered / total) * 100) : 0
      };
    });
  },

  _topDiscipline(cards) {
    const counts = {};
    for (const c of cards) {
      const name = c.disciplineName || 'Geral';
      counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  },

  _forgettingCurve(elapsedDays, stability) {
    const DECAY = -0.5;
    const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
    return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
  }
};
