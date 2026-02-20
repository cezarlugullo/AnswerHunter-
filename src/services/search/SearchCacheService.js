/**
 * SearchCacheService.js
 * Manages all caching for the search pipeline:
 *   - Decision cache: persistent storage of confirmed answers (chrome.storage.local)
 *   - AI result cache: LLM extraction results keyed by URL+question to avoid re-calling
 *   - Snapshot cache: in-memory cache of fetched HTML pages (per session)
 *   - Search metrics: usage telemetry persisted to chrome.storage.local
 */
export const SearchCacheService = {

    // ── Decision cache config ──────────────────────────────────────────────────
    SEARCH_CACHE_KEY: 'ahSearchDecisionCacheV2',
    SEARCH_METRICS_KEY: 'ahSearchMetricsV1',
    CACHE_MAX_ENTRIES: 220,
    CACHE_MAX_AGE_MS: 1000 * 60 * 60 * 24 * 7, // 7 days

    // ── Snapshot cache (in-memory, per-session) ────────────────────────────────
    snapshotCache: new Map(),          // url → { snap, fetchedAt }
    SNAPSHOT_CACHE_TTL: 5 * 60 * 1000, // 5 minutes
    SNAPSHOT_CACHE_MAX: 30,

    // ── AI extraction result cache ─────────────────────────────────────────────
    _aiResultCache: null,  // null = not yet loaded from storage
    AI_RESULT_CACHE_KEY: 'ahAiResultCacheV1',
    AI_RESULT_CACHE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
    AI_RESULT_CACHE_MAX_ENTRIES: 500,

    // ── Low-level storage helpers ──────────────────────────────────────────────

    async storageGet(keys) {
        try {
            if (typeof chrome === 'undefined' || !chrome?.storage?.local) return {};
            return await chrome.storage.local.get(keys);
        } catch {
            return {};
        }
    },

    async storageSet(payload) {
        try {
            if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
            await chrome.storage.local.set(payload);
        } catch {
            // no-op
        }
    },

    // ── Snapshot cache ─────────────────────────────────────────────────────────

    evictStaleSnapshots() {
        const now = Date.now();
        for (const [url, entry] of this.snapshotCache) {
            if (now - entry.fetchedAt > this.SNAPSHOT_CACHE_TTL) {
                this.snapshotCache.delete(url);
            }
        }
    },

    setSnapshot(url, snap) {
        if (this.snapshotCache.size >= this.SNAPSHOT_CACHE_MAX) {
            const oldest = [...this.snapshotCache.entries()]
                .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
            if (oldest) this.snapshotCache.delete(oldest[0]);
        }
        this.snapshotCache.set(url, { snap, fetchedAt: Date.now() });
    },

    getSnapshot(url) {
        return this.snapshotCache.get(url) || null;
    },

    // ── AI extraction result cache ─────────────────────────────────────────────

    /**
     * Returns a stable cache key: hostname + first 80 chars of question stem.
     */
    getAiResultCacheKey(url, questionStem) {
        let host = url;
        try { host = new URL(url).hostname; } catch (_) { /* keep full url */ }
        const stem = String(questionStem || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        return `${host}|${stem}`;
    },

    /**
     * Load AI result cache from storage (no-op if already loaded).
     */
    async loadAiResultCache() {
        if (this._aiResultCache !== null) return;
        this._aiResultCache = new Map();
        try {
            await new Promise(resolve => {
                chrome.storage.local.get([this.AI_RESULT_CACHE_KEY], (result) => {
                    const raw = result[this.AI_RESULT_CACHE_KEY];
                    if (raw && typeof raw === 'object') {
                        const now = Date.now();
                        for (const [k, v] of Object.entries(raw)) {
                            if (v && now - (v.cachedAt || 0) < this.AI_RESULT_CACHE_MAX_AGE_MS) {
                                this._aiResultCache.set(k, v);
                            }
                        }
                    }
                    resolve();
                });
            });
        } catch (_) { /* non-critical */ }
    },

    /**
     * Persist AI result cache to storage (fire-and-forget).
     */
    async saveAiResultCache() {
        if (!this._aiResultCache) return;
        try {
            if (this._aiResultCache.size > this.AI_RESULT_CACHE_MAX_ENTRIES) {
                const sorted = [...this._aiResultCache.entries()]
                    .sort((a, b) => (a[1].cachedAt || 0) - (b[1].cachedAt || 0));
                const toDelete = sorted.slice(0, this._aiResultCache.size - this.AI_RESULT_CACHE_MAX_ENTRIES);
                for (const [k] of toDelete) this._aiResultCache.delete(k);
            }
            const obj = Object.fromEntries(this._aiResultCache);
            chrome.storage.local.set({ [this.AI_RESULT_CACHE_KEY]: obj });
        } catch (_) { /* non-critical */ }
    },

    /**
     * Returns cached AI extraction result or null if missing/expired.
     */
    getCachedAiResult(url, questionStem) {
        if (!this._aiResultCache) return null;
        const key = this.getAiResultCacheKey(url, questionStem);
        const entry = this._aiResultCache.get(key);
        if (!entry) return null;
        if (Date.now() - (entry.cachedAt || 0) > this.AI_RESULT_CACHE_MAX_AGE_MS) {
            this._aiResultCache.delete(key);
            return null;
        }
        return entry;
    },

    /**
     * Stores an AI extraction result and persists asynchronously.
     */
    setCachedAiResult(url, questionStem, result) {
        if (!this._aiResultCache) return;
        const key = this.getAiResultCacheKey(url, questionStem);
        this._aiResultCache.set(key, { ...result, cachedAt: Date.now() });
        this.saveAiResultCache(); // fire-and-forget
    },

    // ── Decision cache ─────────────────────────────────────────────────────────

    async _getDecisionCacheBucket() {
        const data = await this.storageGet([this.SEARCH_CACHE_KEY]);
        const bucket = data?.[this.SEARCH_CACHE_KEY];
        return (bucket && typeof bucket === 'object') ? bucket : {};
    },

    async _setDecisionCacheBucket(bucket) {
        const safeBucket = bucket && typeof bucket === 'object' ? bucket : {};
        await this.storageSet({ [this.SEARCH_CACHE_KEY]: safeBucket });
    },

    async clearSearchCache(options = {}) {
        const { keepMetrics = true } = options || {};
        const payload = { [this.SEARCH_CACHE_KEY]: {} };
        if (!keepMetrics) payload[this.SEARCH_METRICS_KEY] = {};
        await this.storageSet(payload);
    },

    async getCachedDecision(questionFingerprint) {
        if (!questionFingerprint) return null;
        const bucket = await this._getDecisionCacheBucket();
        const entry = bucket?.[questionFingerprint];
        if (!entry || typeof entry !== 'object') return null;
        const age = Date.now() - Number(entry.updatedAt || 0);
        if (!Number.isFinite(age) || age < 0 || age > this.CACHE_MAX_AGE_MS) return null;
        const decision = entry.decision;
        if (!decision || decision.resultState !== 'confirmed') return null;
        if (decision.evidenceTier !== 'EVIDENCE_STRONG') return null;
        return decision;
    },

    sanitizeSourcesForCache(sources = []) {
        return (sources || [])
            .slice(0, 8)
            .map((s) => ({
                title: String(s?.title || ''),
                link: String(s?.link || ''),
                hostHint: String(s?.hostHint || ''),
                evidenceType: String(s?.evidenceType || ''),
                letter: String(s?.letter || ''),
                weight: Number(s?.weight || 0)
            }))
            .filter((s) => s.link || s.hostHint || s.letter);
    },

    async setCachedDecision(questionFingerprint, resultItem, sources = []) {
        if (!questionFingerprint || !resultItem) return;
        const bucket = await this._getDecisionCacheBucket();
        const now = Date.now();
        const sourceLinks = (sources || [])
            .map((s) => String(s?.link || '').trim())
            .filter(Boolean)
            .slice(0, 12);

        bucket[questionFingerprint] = {
            updatedAt: now,
            decision: {
                answer: String(resultItem.answer || ''),
                answerLetter: String(resultItem.answerLetter || ''),
                answerText: String(resultItem.answerText || ''),
                bestLetter: String(resultItem.bestLetter || ''),
                votes: resultItem.votes || {},
                baseVotes: resultItem.baseVotes || {},
                evidenceVotes: resultItem.evidenceVotes || {},
                confidence: Number(resultItem.confidence || 0),
                resultState: String(resultItem.resultState || 'inconclusive'),
                reason: String(resultItem.reason || 'inconclusive'),
                evidenceTier: String(resultItem.evidenceTier || 'EVIDENCE_WEAK'),
                evidenceConsensus: resultItem.evidenceConsensus || {},
                questionPolarity: String(resultItem.questionPolarity || 'CORRECT'),
                sources: this.sanitizeSourcesForCache(sources)
            },
            sourceLinks
        };

        const keys = Object.keys(bucket);
        if (keys.length > this.CACHE_MAX_ENTRIES) {
            keys
                .map((k) => ({ k, t: Number(bucket[k]?.updatedAt || 0) }))
                .sort((a, b) => a.t - b.t)
                .slice(0, keys.length - this.CACHE_MAX_ENTRIES)
                .forEach((entry) => { delete bucket[entry.k]; });
        }

        await this._setDecisionCacheBucket(bucket);
    },

    async getCachedSourceLinks(questionFingerprint) {
        if (!questionFingerprint) return [];
        const bucket = await this._getDecisionCacheBucket();
        const entry = bucket?.[questionFingerprint];
        if (!entry) return [];
        const sourceLinks = Array.isArray(entry.sourceLinks) ? entry.sourceLinks : [];
        return sourceLinks.map((l) => String(l || '').trim()).filter(Boolean).slice(0, 12);
    },

    async mergeCachedSourcesIntoResults(questionFingerprint, results = []) {
        const cachedLinks = await this.getCachedSourceLinks(questionFingerprint);
        if (!cachedLinks || cachedLinks.length === 0) return results || [];

        const merged = new Map();
        for (const item of (results || [])) {
            const link = String(item?.link || '').trim();
            if (!link) continue;
            if (!merged.has(link)) merged.set(link, item);
        }
        for (const link of cachedLinks) {
            if (merged.has(link)) continue;
            merged.set(link, { title: 'Cached source', snippet: '', link, fromCache: true });
        }
        return Array.from(merged.values());
    },

    // ── Canonical hash ─────────────────────────────────────────────────────────

    /**
     * Creates a stable SHA-256 hash from a canonical question string.
     * Requires QuestionParser.canonicalizeQuestion(questionText) to be passed in.
     */
    async canonicalHash(canonicalText) {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            try {
                const encoder = new TextEncoder();
                const data = encoder.encode(canonicalText);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            } catch { /* fallback below */ }
        }
        // FNV-1a fallback
        let hash = 2166136261;
        for (let i = 0; i < canonicalText.length; i++) {
            hash ^= canonicalText.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16);
    },

    // ── Metrics ────────────────────────────────────────────────────────────────

    async recordMetrics(payload = {}) {
        const {
            cacheHit = false,
            outcome = 'finished',
            resultState = 'inconclusive',
            evidenceTier = 'EVIDENCE_WEAK',
            runStats = null,
            bestLetter = '',
            confidence = 0
        } = payload;
        try {
            const data = await this.storageGet([this.SEARCH_METRICS_KEY]);
            const metrics = data?.[this.SEARCH_METRICS_KEY] || {
                totalRuns: 0,
                cacheHits: 0,
                outcomes: {},
                resultStates: {},
                evidenceTiers: {},
                blocked: { paywall: 0, obfuscation: 0, optionsMismatch: 0, snapshotMismatch: 0, errors: 0 },
                lastRuns: []
            };

            metrics.totalRuns += 1;
            if (cacheHit) metrics.cacheHits += 1;
            metrics.outcomes[outcome] = (metrics.outcomes[outcome] || 0) + 1;
            metrics.resultStates[resultState] = (metrics.resultStates[resultState] || 0) + 1;
            metrics.evidenceTiers[evidenceTier] = (metrics.evidenceTiers[evidenceTier] || 0) + 1;

            if (runStats) {
                metrics.blocked.paywall += Number(runStats.blockedPaywall || 0);
                metrics.blocked.obfuscation += Number(runStats.blockedObfuscation || 0);
                metrics.blocked.optionsMismatch += Number(runStats.blockedOptionsMismatch || 0);
                metrics.blocked.snapshotMismatch += Number(runStats.blockedSnapshotMismatch || 0);
                metrics.blocked.errors += Number(runStats.blockedByError || 0);
            }

            metrics.lastRuns.push({
                at: Date.now(),
                outcome,
                cacheHit: !!cacheHit,
                resultState,
                evidenceTier,
                bestLetter: String(bestLetter || ''),
                confidence: Number(confidence || 0),
                analyzed: Number(runStats?.analyzed || 0),
                acceptedVotes: Number(runStats?.acceptedForVotes || 0),
                acceptedAi: Number(runStats?.acceptedForAiEvidence || 0)
            });

            if (metrics.lastRuns.length > 120) {
                metrics.lastRuns = metrics.lastRuns.slice(metrics.lastRuns.length - 120);
            }

            metrics.updatedAt = Date.now();
            await this.storageSet({ [this.SEARCH_METRICS_KEY]: metrics });
        } catch {
            // non-critical
        }
    },
};
