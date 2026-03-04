/**
 * QuestionFingerprint.js
 * Phase 1.2 — Creates a lightweight fingerprint from the first extraction pass.
 * All subsequent pipeline steps (context recovery, stem enrichment, options merge)
 * validate against this fingerprint to prevent cross-question contamination.
 *
 * A fingerprint is the first N significant stem tokens (non-option lines),
 * normalized and deduplicated.
 */

const STOP_WORDS = new Set([
    'assinale', 'afirmativa', 'alternativa', 'correta', 'incorreta', 'questao',
    'considere', 'para', 'como', 'quando', 'cada', 'qual', 'onde', 'quais',
    'entre', 'sobre', 'essa', 'esse', 'este', 'esta', 'isso', 'aqui',
    'nesta', 'neste', 'deste', 'desta', 'pelo', 'pela', 'pelas', 'pelos',
    'forma', 'pode', 'deve', 'sera', 'mais', 'menos', 'todos', 'todas',
    'apenas', 'mesmo', 'mesma', 'tipo', 'true', 'false', 'null', 'void',
    'the', 'and', 'that', 'with', 'from', 'this', 'which', 'have', 'been',
]);

const FINGERPRINT_TOKEN_COUNT = 10;

function _normalize(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}

function _extractStemTokens(text, maxTokens = FINGERPRINT_TOKEN_COUNT) {
    // Get stem lines (non-option lines)
    const lines = String(text || '').split('\n')
        .filter(line => !line.trim().match(/^\s*["']?\s*[A-E]\s*[\)\.\-:]\s/i));
    const normalized = _normalize(lines.join(''));
    const tokens = normalized.split(/\s+/)
        .filter(t => t.length >= 4 && !STOP_WORDS.has(t));
    // Deduplicate while preserving order
    const seen = new Set();
    const unique = [];
    for (const t of tokens) {
        if (!seen.has(t)) {
            seen.add(t);
            unique.push(t);
        }
        if (unique.length >= maxTokens) break;
    }
    return unique;
}

export const QuestionFingerprint = {
    /**
     * Creates a fingerprint from question text.
     * @param {string} text - The initially extracted question text
     * @returns {{ tokens: string[], raw: string }} The fingerprint object
     */
    create(text) {
        const tokens = _extractStemTokens(text);
        return {
            tokens,
            raw: tokens.join('')
        };
    },

    /**
     * Validates a candidate text against the original fingerprint.
     * @param {{ tokens: string[] }} fingerprint - The original fingerprint
     * @param {string} candidateText - The candidate text to check
     * @param {number} [threshold=0.4] - Minimum overlap ratio (0-1)
     * @returns {{ valid: boolean, overlap: number, ratio: number, details: string }}
     */
    validate(fingerprint, candidateText, threshold = 0.4) {
        if (!fingerprint || !fingerprint.tokens || fingerprint.tokens.length === 0) {
            return { valid: true, overlap: 0, ratio: 1, details: 'empty fingerprint — allowing' };
        }
        const candidateNorm = _normalize(candidateText);
        let overlap = 0;
        for (const token of fingerprint.tokens) {
            if (candidateNorm.includes(token)) overlap++;
        }
        const ratio = overlap / fingerprint.tokens.length;
        const valid = ratio >= threshold || (fingerprint.tokens.length <= 3 && overlap >= 2);
        return {
            valid,
            overlap,
            ratio,
            details: `${overlap}/${fingerprint.tokens.length} tokens matched (${(ratio * 100).toFixed(0)}%, threshold=${(threshold * 100).toFixed(0)}%)`
        };
    },

    /**
     * Validates specifically for stem enrichment (stricter threshold).
     * @param {{ tokens: string[] }} fingerprint
     * @param {string} candidateText
     * @returns {{ valid: boolean, overlap: number, ratio: number, details: string }}
     */
    validateStemEnrichment(fingerprint, candidateText) {
        return this.validate(fingerprint, candidateText, 0.5);
    },

    /**
     * Validates specifically for context recovery (moderate threshold).
     * @param {{ tokens: string[] }} fingerprint
     * @param {string} candidateText
     * @returns {{ valid: boolean, overlap: number, ratio: number, details: string }}
     */
    validateContextRecovery(fingerprint, candidateText) {
        return this.validate(fingerprint, candidateText, 0.4);
    },

    /**
     * Validates specifically for options merge (lenient threshold).
     * @param {{ tokens: string[] }} fingerprint
     * @param {string} candidateText
     * @returns {{ valid: boolean, overlap: number, ratio: number, details: string }}
     */
    validateOptionsMerge(fingerprint, candidateText) {
        return this.validate(fingerprint, candidateText, 0.3);
    },

    /**
     * Compute a confidence score for extraction quality based on structural signals.
     * Phase 3.3 — Structural confidence scoring.
     * @param {string} text - Final extracted question text
     * @param {{ usedVision: boolean, platformMatch: boolean, viewportMatch: boolean, fingerprint: object }} ctx
     * @returns {{ score: number, level: string, signals: string[] }}
     */
    computeConfidence(text, ctx = {}) {
        if (!text) return { score: 0, level: 'none', signals: [] };

        const signals = [];
        let score = 0;

        // 1. Option count
        const optMatches = text.match(/(?:^|\n)\s*["']?\s*[A-E]\s*[\)\.\-:]\s*\S/gi) || [];
        const optLetters = new Set(optMatches.map(m => m.trim().charAt(0).toUpperCase()));
        const optCount = optLetters.size;
        if (optCount >= 5) { score += 25; signals.push('5 options (A-E)'); }
        else if (optCount >= 4) { score += 20; signals.push(`${optCount} options`); }
        else if (optCount >= 2) { score += 10; signals.push(`${optCount} options`); }
        else { signals.push('few/no options'); }

        // 2. Stem length
        const stemLines = text.split('\n').filter(l => !l.trim().match(/^\s*["']?\s*[A-E]\s*[\)\.\-:]\s/i));
        const stemLen = stemLines.join('').replace(/\s+/g, '').trim().length;
        if (stemLen >= 200) { score += 20; signals.push('rich stem'); }
        else if (stemLen >= 80) { score += 12; signals.push('adequate stem'); }
        else { score += 3; signals.push('short stem'); }

        // 3. Question mark
        if (text.includes('?')) { score += 8; signals.push('has question mark'); }

        // 4. Question keywords
        if (/Quest(?:a|ã)o|Pergunta|Exerc[íi]cio|Enunciado|Atividade/i.test(text)) {
            score += 5; signals.push('question keyword');
        }

        // 5. Contextual signals (platform, viewport, vision)
        if (ctx.platformMatch) { score += 15; signals.push('platform-specific extractor'); }
        if (ctx.viewportMatch) { score += 10; signals.push('viewport-centric match'); }
        if (ctx.usedVision) { score += 5; signals.push('vision OCR used'); }

        // 6. Fingerprint consistency
        if (ctx.fingerprint && ctx.fingerprint.tokens && ctx.fingerprint.tokens.length > 0) {
            const fpCheck = this.validate(ctx.fingerprint, text, 0.6);
            if (fpCheck.valid) { score += 10; signals.push('fingerprint consistent'); }
            else { score -= 15; signals.push('fingerprint diverged!'); }
        }

        // 7. No-noise check (shouldn't have menu text)
        const hasNoise = /menu|disciplina|progresso|conteudos|concluidos|simulados/i.test(text);
        if (hasNoise) { score -= 10; signals.push('contains noise text'); }

        // Normalize to 0-100
        score = Math.max(0, Math.min(100, score));

        let level;
        if (score >= 75) level = 'high';
        else if (score >= 50) level = 'medium';
        else if (score >= 25) level = 'low';
        else level = 'very-low';

        return { score, level, signals };
    }
};
