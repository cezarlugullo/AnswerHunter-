/**
 * CorrectionFeedback.js
 * Phase 3.1 — User correction feedback loop.
 * Saves user corrections (wrong extraction, wrong answer) per site/domain.
 * Over time, this data helps the extension learn which extraction strategies
 * work best for which domains.
 *
 * Storage key: ah_correction_feedback
 * Structure: {
 *   corrections: [{
 *     url: string,
 *     hostname: string,
 *     timestamp: number,
 *     type: 'wrong_question' | 'wrong_answer' | 'incomplete',
 *     extractedText: string (first 500 chars),
 *     userNote?: string,
 *     extractionMethod: string ('dom' | 'ocr' | 'platform' | 'viewport')
 *   }],
 *   domainStats: {
 *     [hostname]: { total: number, corrections: number, lastCorrected: number }
 *   }
 * }
 */

const STORAGE_KEY = 'ah_correction_feedback';
const MAX_CORRECTIONS = 200;

async function _load() {
    try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        return data[STORAGE_KEY] || { corrections: [], domainStats: {} };
    } catch {
        return { corrections: [], domainStats: {} };
    }
}

async function _save(data) {
    try {
        // Trim old corrections if over limit
        if (data.corrections.length > MAX_CORRECTIONS) {
            data.corrections = data.corrections.slice(-MAX_CORRECTIONS);
        }
        await chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch (e) {
        console.warn('AnswerHunter: CorrectionFeedback save failed:', e?.message);
    }
}

export const CorrectionFeedback = {
    /**
     * Record a user correction.
     * @param {{ url: string, type: string, extractedText: string, extractionMethod?: string, userNote?: string }} correction
     */
    async recordCorrection(correction) {
        const data = await _load();
        const hostname = (() => {
            try { return new URL(correction.url).hostname.replace(/^www\./, '').toLowerCase(); }
            catch { return 'unknown'; }
        })();

        data.corrections.push({
            url: correction.url || '',
            hostname,
            timestamp: Date.now(),
            type: correction.type || 'wrong_question',
            extractedText: (correction.extractedText || '').substring(0, 500),
            userNote: correction.userNote || '',
            extractionMethod: correction.extractionMethod || 'unknown'
        });

        // Update domain stats
        if (!data.domainStats[hostname]) {
            data.domainStats[hostname] = { total: 0, corrections: 0, lastCorrected: 0 };
        }
        data.domainStats[hostname].corrections++;
        data.domainStats[hostname].lastCorrected = Date.now();

        await _save(data);
        console.log(`AnswerHunter: CORRECTION recorded for ${hostname} (type=${correction.type})`);
    },

    /**
     * Record a successful extraction (no correction needed).
     * @param {string} url
     */
    async recordSuccess(url) {
        const data = await _load();
        const hostname = (() => {
            try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
            catch { return 'unknown'; }
        })();

        if (!data.domainStats[hostname]) {
            data.domainStats[hostname] = { total: 0, corrections: 0, lastCorrected: 0 };
        }
        data.domainStats[hostname].total++;

        await _save(data);
    },

    /**
     * Get the correction rate for a hostname.
     * @param {string} url
     * @returns {Promise<{ hostname: string, total: number, corrections: number, rate: number, isProblematic: boolean }>}
     */
    async getDomainStats(url) {
        const data = await _load();
        const hostname = (() => {
            try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
            catch { return 'unknown'; }
        })();

        const stats = data.domainStats[hostname] || { total: 0, corrections: 0, lastCorrected: 0 };
        const rate = stats.total > 0 ? stats.corrections / stats.total : 0;
        return {
            hostname,
            total: stats.total,
            corrections: stats.corrections,
            rate,
            isProblematic: rate > 0.3 && stats.corrections >= 3
        };
    },

    /**
     * Get all corrections for display/export.
     * @returns {Promise<Array>}
     */
    async getAllCorrections() {
        const data = await _load();
        return data.corrections;
    },

    /**
     * Clear all correction data.
     */
    async clear() {
        await chrome.storage.local.remove(STORAGE_KEY);
    }
};
