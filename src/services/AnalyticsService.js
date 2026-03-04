/**
 * AnalyticsService.js
 * Comprehensive learning analytics and study-session tracking.
 *
 * Tracks:
 *  - Study sessions (start/end, cards reviewed, accuracy)
 *  - Per-discipline performance over time
 *  - Retention curves
 *  - Study patterns (time-of-day, day-of-week)
 *  - Historical performance snapshots
 */

const ANALYTICS_KEY = 'ah_analytics';

export const AnalyticsService = {

  _cache: null,

  async _load() {
    if (this._cache) return this._cache;
    const data = await new Promise(r =>
      chrome.storage.local.get([ANALYTICS_KEY], d => r(d[ANALYTICS_KEY] || this._default()))
    );
    this._cache = data;
    return data;
  },

  async _save(data) {
    this._cache = data;
    return new Promise(r => chrome.storage.local.set({ [ANALYTICS_KEY]: data }, r));
  },

  _default() {
    return {
      sessions: [],       // {id, startedAt, endedAt, cardsReviewed, correct, incorrect, disciplineIds}
      dailyStats: {},     // { 'YYYY-MM-DD': { reviews, correct, xpGained, minutesStudied, disciplines } }
      weeklyGoals: {},    // { 'YYYY-Wxx': { target, actual } }
      retentionLog: [],   // { date, cardId, rating, retrievability }
      firstRecordDate: null
    };
  },

  // ─── Session Tracking ─────────────────────────────────────────────────────

  _activeSession: null,

  /**
   * Start a new study session.
   * @returns {string} sessionId
   */
  startSession() {
    const id = 'sess_' + Date.now().toString(36);
    this._activeSession = {
      id,
      startedAt: Date.now(),
      endedAt: null,
      cardsReviewed: 0,
      correct: 0,
      incorrect: 0,
      disciplineIds: new Set(),
      ratings: []
    };
    return id;
  },

  /**
   * Record a single review within the active session.
   * @param {Object} opts
   * @param {string} opts.cardId
   * @param {string} opts.disciplineId
   * @param {number} opts.rating - Self-rating (1-4) for FSRS scheduling
   * @param {number|null} opts.retrievability
   * @param {boolean} [opts.isCorrect] - Actual answer correctness (from option selection).
   *   When undefined, falls back to rating >= 3.
   */
  recordReview({ cardId, disciplineId, rating, retrievability, isCorrect }) {
    if (!this._activeSession) this.startSession();
    const s = this._activeSession;
    s.cardsReviewed++;
    // Use explicit correctness when available (multiple-choice); otherwise infer from rating
    const correct = isCorrect !== undefined ? isCorrect : (rating >= 3);
    if (correct) s.correct++;
    else s.incorrect++;
    if (disciplineId) s.disciplineIds.add(disciplineId);
    s.ratings.push({ cardId, rating, retrievability, isCorrect: correct, at: Date.now() });
  },

  /**
   * End the active session and persist.
   * @returns {Promise<Object>} session summary
   */
  async endSession() {
    if (!this._activeSession) return null;
    const s = this._activeSession;
    s.endedAt = Date.now();
    s.disciplineIds = Array.from(s.disciplineIds);

    const data = await this._load();

    // Save session (keep last 500 sessions)
    data.sessions.push({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      cardsReviewed: s.cardsReviewed,
      correct: s.correct,
      incorrect: s.incorrect,
      disciplineIds: s.disciplineIds,
      durationMs: s.endedAt - s.startedAt
    });
    if (data.sessions.length > 500) {
      data.sessions = data.sessions.slice(-500);
    }

    // Update daily stats
    const dateKey = this._dateKey(s.startedAt);
    if (!data.dailyStats[dateKey]) {
      data.dailyStats[dateKey] = { reviews: 0, correct: 0, xpGained: 0, minutesStudied: 0, disciplines: [] };
    }
    const daily = data.dailyStats[dateKey];
    daily.reviews += s.cardsReviewed;
    daily.correct += s.correct;
    daily.minutesStudied += Math.round((s.endedAt - s.startedAt) / 60000);
    // Merge discipline IDs
    const discSet = new Set([...(daily.disciplines || []), ...s.disciplineIds]);
    daily.disciplines = Array.from(discSet);

    // Save retention logs
    for (const rev of s.ratings) {
      data.retentionLog.push({
        date: rev.at,
        cardId: rev.cardId,
        rating: rev.rating,
        retrievability: rev.retrievability || null
      });
    }
    // Keep last 5000 retention entries
    if (data.retentionLog.length > 5000) {
      data.retentionLog = data.retentionLog.slice(-5000);
    }

    if (!data.firstRecordDate) data.firstRecordDate = s.startedAt;

    await this._save(data);
    this._activeSession = null;

    return {
      duration: s.endedAt - s.startedAt,
      cardsReviewed: s.cardsReviewed,
      accuracy: s.cardsReviewed ? Math.round((s.correct / s.cardsReviewed) * 100) : 0,
      disciplines: s.disciplineIds.length
    };
  },

  // ─── Daily Stats ──────────────────────────────────────────────────────────

  /**
   * Add XP to today's daily tally.
   */
  async addDailyXP(amount) {
    const data = await this._load();
    const key = this._dateKey();
    if (!data.dailyStats[key]) {
      data.dailyStats[key] = { reviews: 0, correct: 0, xpGained: 0, minutesStudied: 0, disciplines: [] };
    }
    data.dailyStats[key].xpGained += amount;
    await this._save(data);
  },

  /**
   * Get today's stats.
   */
  async getToday() {
    const data = await this._load();
    return data.dailyStats[this._dateKey()] || { reviews: 0, correct: 0, xpGained: 0, minutesStudied: 0, disciplines: [] };
  },

  /**
   * Get daily stats for the last N days.
   */
  async getDailyRange(days = 30) {
    const data = await this._load();
    const result = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = this._dateKey(d.getTime());
      result.push({
        date: key,
        ...(data.dailyStats[key] || { reviews: 0, correct: 0, xpGained: 0, minutesStudied: 0, disciplines: [] })
      });
    }
    return result;
  },

  // ─── Analytics Queries ────────────────────────────────────────────────────

  /**
   * Get performance overview (used by dashboard).
   */
  async getOverview() {
    const data = await this._load();
    const sessions = data.sessions;
    const last30 = await this.getDailyRange(30);

    const totalReviews = last30.reduce((s, d) => s + d.reviews, 0);
    const totalCorrect = last30.reduce((s, d) => s + d.correct, 0);
    const totalMinutes = last30.reduce((s, d) => s + d.minutesStudied, 0);
    const activeDays = last30.filter(d => d.reviews > 0).length;
    const avgAccuracy = totalReviews ? Math.round((totalCorrect / totalReviews) * 100) : 0;

    // Today's stats
    const today = data.dailyStats[this._dateKey()] || { reviews: 0, correct: 0, xpGained: 0, minutesStudied: 0 };

    // Streak calculation
    const currentStreak = this._computeStreak(data.dailyStats);

    // Daily activity map for heatmap (YYYY-MM-DD → count)
    const dailyActivity = {};
    for (const [date, stats] of Object.entries(data.dailyStats)) {
      dailyActivity[date] = stats.reviews || 0;
    }

    return {
      totalReviews,
      totalMinutes,
      activeDays,
      avgAccuracy,
      totalSessions: sessions.length,
      avgSessionMinutes: sessions.length
        ? Math.round(sessions.reduce((s, se) => s + (se.durationMs || 0), 0) / sessions.length / 60000)
        : 0,
      // Enrichment fields used by Study Hub
      currentStreak,
      _today: today,
      _dailyActivity: dailyActivity
    };
  },

  /**
   * Compute current streak (consecutive days with reviews, including today).
   * @param {Object} dailyStats
   * @returns {number}
   */
  _computeStreak(dailyStats) {
    let streak = 0;
    const d = new Date();

    // Check today first
    const todayKey = this._dateKey(d.getTime());
    if (!dailyStats[todayKey] || dailyStats[todayKey].reviews === 0) {
      // Today has no activity yet — check if yesterday does (grace: streak not broken until end of today)
      d.setDate(d.getDate() - 1);
      const yestKey = this._dateKey(d.getTime());
      if (!dailyStats[yestKey] || dailyStats[yestKey].reviews === 0) return 0;
      // Count from yesterday backwards
    }

    // Walk backwards from current day
    for (let i = 0; i < 365; i++) {
      const key = this._dateKey(d.getTime());
      if (dailyStats[key] && dailyStats[key].reviews > 0) {
        streak++;
      } else if (i > 0) {
        // First gap after at least one counted day → stop
        break;
      }
      d.setDate(d.getDate() - 1);
    }

    return streak;
  },

  /**
   * Get study-pattern heatmap data (hour-of-day × day-of-week).
   * @returns {Promise<number[][]>} 7×24 grid
   */
  async getStudyPattern() {
    const data = await this._load();
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));

    for (const sess of data.sessions) {
      const d = new Date(sess.startedAt);
      grid[d.getDay()][d.getHours()] += sess.cardsReviewed;
    }

    return grid;
  },

  /**
   * Get retention curve data (avg retrievability over days since review).
   */
  async getRetentionCurve() {
    const data = await this._load();
    const log = data.retentionLog.filter(e => e.retrievability != null);

    if (log.length < 10) return [];

    // Bucket by days since first review
    const buckets = new Map();
    for (const entry of log) {
      const daysSinceFirst = Math.floor((Date.now() - entry.date) / 86400000);
      const bucket = Math.min(daysSinceFirst, 30); // Cap at 30 days
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(entry.retrievability);
    }

    return Array.from(buckets.entries())
      .map(([day, vals]) => ({
        day,
        avgRetention: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100)
      }))
      .sort((a, b) => a.day - b.day);
  },

  /**
   * Get per-discipline performance (last 30 days).
   * @param {Array} hierarchy
   */
  async getDisciplinePerformance(hierarchy) {
    const data = await this._load();
    const discMap = new Map();

    for (const disc of hierarchy) {
      discMap.set(disc.id, { name: disc.name, color: disc.color, reviews: 0, correct: 0 });
    }

    // Count from recent sessions
    const cutoff = Date.now() - 30 * 86400000;
    for (const sess of data.sessions) {
      if (sess.startedAt < cutoff) continue;
      for (const discId of (sess.disciplineIds || [])) {
        const entry = discMap.get(discId);
        if (entry) {
          entry.reviews += sess.cardsReviewed;
          entry.correct += sess.correct;
        }
      }
    }

    return Array.from(discMap.values())
      .filter(d => d.reviews > 0)
      .map(d => ({
        ...d,
        accuracy: d.reviews ? Math.round((d.correct / d.reviews) * 100) : 0
      }))
      .sort((a, b) => b.reviews - a.reviews);
  },

  /**
   * Get weekly trend (reviews per week for last 12 weeks).
   */
  async getWeeklyTrend() {
    const data = await this._load();
    const weeks = [];
    const now = new Date();

    for (let w = 11; w >= 0; w--) {
      let weekTotal = 0;
      for (let d = 0; d < 7; d++) {
        const date = new Date(now);
        date.setDate(date.getDate() - (w * 7 + d));
        const key = this._dateKey(date.getTime());
        weekTotal += (data.dailyStats[key]?.reviews || 0);
      }
      weeks.push({
        weekOffset: -w,
        reviews: weekTotal
      });
    }

    return weeks;
  },

  /**
   * Clean up old data (keep last 90 days of daily stats).
   */
  async cleanup() {
    const data = await this._load();
    const cutoff = Date.now() - 90 * 86400000;
    const cutoffKey = this._dateKey(cutoff);

    for (const key of Object.keys(data.dailyStats)) {
      if (key < cutoffKey) delete data.dailyStats[key];
    }

    await this._save(data);
  },

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _dateKey(timestamp) {
    const d = timestamp ? new Date(timestamp) : new Date();
    return d.toISOString().slice(0, 10);
  }
};
