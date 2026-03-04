/**
 * FSRSService.js — FSRS-5 Algorithm for AnswerHunter
 * 
 * Implementação nativa do FSRS-5 (Free Spaced Repetition Scheduler)
 * Baseado no paper: https://github.com/open-spaced-repetition/fsrs5
 * 
 * Drop-in replacement para o SM-2 existente.
 * Compatível com dados SM-2 anteriores (migração automática).
 * 
 * Mapeamento de qualidade SM-2 → FSRS:
 *   0 (Não lembrei) → 1 (Again)
 *   1 (Difícil)      → 2 (Hard)
 *   2 (Bom)          → 3 (Good)
 *   3 (Fácil)        → 4 (Easy)
 */

// ── FSRS-5 Default Parameters (treinados em 6M+ revisões Anki) ──────────────
const FSRS_W = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.5330,
  0.1544, 1.0070, 1.9395, 0.1100, 0.2900, 2.2700, 0.1600, 2.9898, 0.5100, 0.4300
];

// Retenção-alvo (90% = padrão Anki/FSRS)
const REQUESTED_RETENTION = 0.90;

// Fator de decaimento FSRS
const DECAY   = -0.5;
const FACTOR  = 0.9 ** (1 / DECAY) - 1; // ≈ 19/81

// Estados do cartão
const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 };

// ── Funções núcleo FSRS ──────────────────────────────────────────────────────

/** Estabilidade inicial para novos cartões */
function initStability(rating) {
  // rating: 1=Again, 2=Hard, 3=Good, 4=Easy
  return Math.max(FSRS_W[rating - 1], 0.1);
}

/** Dificuldade inicial */
function initDifficulty(rating) {
  return Math.min(Math.max(FSRS_W[4] - Math.exp(FSRS_W[5] * (rating - 1)) + 1, 1), 10);
}

/** Recuperabilidade no momento t (dias desde última revisão) */
function forgettingCurve(elapsedDays, stability) {
  return (1 + FACTOR * elapsedDays / stability) ** DECAY;
}

/** Intervalo ótimo para atingir retenção alvo */
function nextInterval(stability) {
  const interval = (stability / FACTOR) * (REQUESTED_RETENTION ** (1 / DECAY) - 1);
  return Math.max(1, Math.round(interval));
}

/** Dificuldade após revisão */
function nextDifficulty(d, rating) {
  const d2 = d - FSRS_W[6] * (rating - 3);
  return Math.min(Math.max(
    d2 + FSRS_W[7] * (10 - d2), // mean-reversion
    1
  ), 10);
}

/** Estabilidade após revisão bem-sucedida (rating >= 2) */
function nextRecallStability(d, s, r, rating) {
  const hardPenalty = rating === 2 ? FSRS_W[15] : 1;
  const easyBonus   = rating === 4 ? FSRS_W[16] : 1;
  return s * (
    Math.exp(FSRS_W[8]) *
    (11 - d) *
    s ** (-FSRS_W[9]) *
    (Math.exp((1 - r) * FSRS_W[10]) - 1) *
    hardPenalty *
    easyBonus
    + 1
  );
}

/** Estabilidade após esquecimento (rating == 1) */
function nextForgetStability(d, s, r) {
  return (
    FSRS_W[11] *
    d ** (-FSRS_W[12]) *
    ((s + 1) ** FSRS_W[13] - 1) *
    Math.exp((1 - r) * FSRS_W[14])
  );
}

// ── API Pública ──────────────────────────────────────────────────────────────

export const FSRSService = {

  /**
   * Calcula o próximo estado do cartão com FSRS-5.
   * 
   * @param {object} entry  - Estado atual (ou {} para novo cartão)
   * @param {number} quality - Qualidade SM-2: 0=Again, 1=Hard, 2=Good, 3=Easy
   * @returns {object}       - Novo estado compatível com formato ah_sm2Data
   */
  calculate(entry, quality) {
    // Auto-migrate legacy SM-2 entries to FSRS format
    if (entry && entry.fsrs_state === undefined) {
      entry = this.migrateSm2Entry(entry);
    }

    // Mapear quality SM-2 (0-3) → rating FSRS (1-4)
    const rating = quality + 1; // 0→1, 1→2, 2→3, 3→4

    // Obter estado FSRS atual (ou inicializar)
    const state      = entry.fsrs_state ?? State.New;
    const stability  = entry.fsrs_stability ?? 0;
    const difficulty = entry.fsrs_difficulty ?? 0;
    const lastRated  = entry.lastRated;
    const today      = new Date().toISOString().slice(0, 10);

    // Calcular dias decorridos desde última revisão
    const elapsedDays = lastRated
      ? Math.max(0, Math.round((Date.parse(today) - Date.parse(lastRated)) / 86400000))
      : 0;

    let newStability, newDifficulty, newState;

    if (state === State.New) {
      // ── Primeiro uso ────────────────────────────────────────────────────
      newStability  = initStability(rating);
      newDifficulty = initDifficulty(rating);
      newState      = rating === 1 ? State.Learning : State.Review;

    } else if (state === State.Learning || state === State.Relearning) {
      // ── Aprendizado / Reaprendizado ──────────────────────────────────────
      if (rating === 1) {
        newStability  = Math.max(stability * 0.2, 0.1);
        newDifficulty = Math.min(difficulty + 2, 10);
        newState      = state;
      } else {
        newStability  = nextRecallStability(difficulty, stability, 0.9, rating);
        newDifficulty = nextDifficulty(difficulty, rating);
        newState      = State.Review;
      }

    } else {
      // ── Revisão (Review) ─────────────────────────────────────────────────
      const retrievability = forgettingCurve(elapsedDays, stability);

      if (rating === 1) {
        // Esqueceu: penalizar estabilidade
        newStability  = nextForgetStability(difficulty, stability, retrievability);
        newDifficulty = Math.min(difficulty + FSRS_W[6], 10);
        newState      = State.Relearning;
      } else {
        newStability  = nextRecallStability(difficulty, stability, retrievability, rating);
        newDifficulty = nextDifficulty(difficulty, rating);
        newState      = State.Review;
      }
    }

    // Calcular intervalo
    const interval = newState === State.Review
      ? nextInterval(newStability)
      : 1; // Learning/Relearning: sempre 1 dia

    // Data da próxima revisão
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() + interval);
    const nextReview = d.toISOString().slice(0, 10);

    return {
      // Campos compatíveis com SM-2 (mantidos para não quebrar código existente)
      interval,
      repetition : (entry.repetition || 0) + (rating > 1 ? 1 : 0),
      ef         : this._fsrsToEF(newDifficulty), // ef aproximado para compatibilidade
      nextReview,
      lastRated  : today,

      // Campos FSRS nativos (salvos junto para cálculos futuros)
      fsrs_stability  : Math.round(newStability * 1000) / 1000,
      fsrs_difficulty : Math.round(newDifficulty * 1000) / 1000,
      fsrs_state      : newState,
      fsrs_version    : 5,
    };
  },

  /**
   * Verifica se o cartão está due (mesma interface que sm2IsDue)
   */
  isDue(entry) {
    if (!entry || !entry.nextReview) return true;
    return entry.nextReview <= new Date().toISOString().slice(0, 10);
  },

  /**
   * Label do próximo intervalo para a UI (mesma interface que sm2NextLabel)
   */
  nextLabel(entry, quality) {
    const preview = this.calculate(entry || {}, quality);
    const d = preview.interval;
    if (d === 1)  return 'amanhã';
    if (d < 7)    return `${d} dias`;
    if (d < 30)   return `${Math.round(d / 7)}sem`;
    if (d < 365)  return `${Math.round(d / 30)}mês`;
    return `${Math.round(d / 365)}ano`;
  },

  /**
   * Retorna a recuperabilidade atual (0-100%) — novo dado pedagógico!
   * Mostra visualmente o quanto o aluno vai lembrar agora.
   */
  retrievability(entry) {
    if (!entry || !entry.fsrs_stability || !entry.lastRated) return null;
    const today = new Date().toISOString().slice(0, 10);
    const elapsed = Math.max(0, Math.round(
      (Date.parse(today) - Date.parse(entry.lastRated)) / 86400000
    ));
    const r = forgettingCurve(elapsed, entry.fsrs_stability);
    return Math.round(r * 100);
  },

  /**
   * Migra dados SM-2 legados para o formato FSRS sem perder dados.
   * Chamado automaticamente na primeira calculate() se fsrs_state === undefined.
   */
  migrateSm2Entry(entry) {
    if (!entry || entry.fsrs_state !== undefined) return entry;
    // Estimar parâmetros FSRS a partir de dados SM-2
    const ef = entry.ef ?? 2.5;
    const interval = entry.interval ?? 1;
    // stability ≈ interval (correlação direta para cartões em Review)
    const stability = Math.max(interval, 0.5);
    // difficulty ≈ inverso do ef
    const difficulty = Math.min(Math.max(11 - ef * 2, 1), 10);
    return {
      ...entry,
      fsrs_stability  : stability,
      fsrs_difficulty : difficulty,
      fsrs_state      : entry.repetition > 0 ? State.Review : State.New,
      fsrs_version    : 5,
    };
  },

  /**
   * Retorna estado legível para debug/analytics
   */
  stateName(entry) {
    const names = ['Novo', 'Aprendendo', 'Revisão', 'Reaprendendo'];
    return names[entry?.fsrs_state ?? 0] ?? 'Novo';
  },

  // ── Helpers privados ────────────────────────────────────────────────────────

  /** Converte dificuldade FSRS (1-10) para EF SM-2 (1.3-3.0) — backward compat */
  _fsrsToEF(difficulty) {
    // difficulty 1 → ef 3.0 (fácil), difficulty 10 → ef 1.3 (difícil)
    const ef = 3.0 - (difficulty - 1) * (1.7 / 9);
    return Math.round(Math.max(1.3, Math.min(3.0, ef)) * 100) / 100;
  },
};
