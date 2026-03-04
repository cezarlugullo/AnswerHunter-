/**
 * PageGabaritoCache — extrai e cacheia TODAS as Q&A de uma página de prova.
 *
 * Fluxo:
 *  1. Na primeira busca de uma página, `extractAndStore()` é disparado em background.
 *  2. O AI extrai TODAS as questões + respostas corretas de uma vez.
 *  3. O resultado é salvo em chrome.storage.local indexado por URL.
 *  4. Nas buscas seguintes da mesma página, `lookup()` retorna instantaneamente.
 *
 * Cache: chrome.storage.local['ah_pg_gabarito'] = { [urlKey]: { questions: {...}, extractedAt } }
 */

import { ApiService } from './ApiService.js';

const STORAGE_KEY = 'ah_pg_gabarito';
const CACHE_TTL   = 3 * 24 * 60 * 60 * 1000; // 3 days
const MAX_PAGES   = 80;

/** Normaliza a URL para usar como chave (ignora hash e query params) */
function _urlKey(url) {
    try {
        const u = new URL(url);
        return (u.hostname + u.pathname).toLowerCase().replace(/\/+$/, '');
    } catch (_) {
        return String(url || '').substring(0, 200).toLowerCase();
    }
}

/** Normaliza texto para comparação */
function _norm(t) {
    return String(t || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]+/g, '')
        .replace(/\s+/g, '')
        .trim();
}

/** Chave de fingerprint para uma questão (primeiros 90 chars normalizados) */
function _qKey(questionText) {
    return _norm(questionText).substring(0, 90);
}

export const PageGabaritoCache = {

    async _load() {
        try {
            const d = await chrome.storage.local.get([STORAGE_KEY]);
            return d?.[STORAGE_KEY] || {};
        } catch (_) { return {}; }
    },

    async _save(cache) {
        try {
            const pages = Object.keys(cache);
            if (pages.length > MAX_PAGES) {
                pages
                    .map(k => ({ k, t: Number(cache[k]?.extractedAt || 0) }))
                    .sort((a, b) => a.t - b.t)
                    .slice(0, pages.length - MAX_PAGES)
                    .forEach(e => delete cache[e.k]);
            }
            await chrome.storage.local.set({ [STORAGE_KEY]: cache });
        } catch (_) {}
    },

    /**
     * Verifica se a página já foi processada recentemente.
     * @returns {boolean}
     */
    async isPageCached(pageUrl) {
        if (!pageUrl) return false;
        try {
            const cache = await this._load();
            const p = cache[_urlKey(pageUrl)];
            return !!(p?.extractedAt && Date.now() - p.extractedAt < CACHE_TTL);
        } catch (_) { return false; }
    },

    /**
     * Busca a resposta de uma questão no cache de gabarito da página.
     * @param {string} pageUrl
     * @param {string} questionText
     * @returns {Promise<{letter:string, answerText:string}|null>}
     */
    async lookup(pageUrl, questionText) {
        if (!pageUrl || !questionText) return null;
        try {
            const cache = await this._load();
            const urlKey = _urlKey(pageUrl);
            const pageData = cache[urlKey];
            if (!pageData?.questions) return null;
            if (Date.now() - (pageData.extractedAt || 0) > CACHE_TTL) return null;

            const qKey = _qKey(questionText);
            if (!qKey || qKey.length < 20) return null;

            // 1. Correspondência direta pela chave
            if (pageData.questions[qKey]) return pageData.questions[qKey];

            // 2. Correspondência parcial: chave do cache está contida na questão atual
            const qKeyShort = qKey.substring(0, 70);
            for (const [k, v] of Object.entries(pageData.questions)) {
                if (k.length >= 25 && qKey.includes(k.substring(0, 60))) return v;
                if (k.length >= 25 && k.includes(qKeyShort.substring(0, 55))) return v;
            }
            return null;
        } catch (_) { return null; }
    },

    /**
     * Persiste pares Q&A extraídos para uma página.
     * @param {string} pageUrl
     * @param {Array<{question:string, letter:string, answerText:string}>} pairs
     */
    async storeAll(pageUrl, pairs) {
        if (!pageUrl || !Array.isArray(pairs) || pairs.length === 0) return;
        try {
            const cache = await this._load();
            const urlKey = _urlKey(pageUrl);
            const questions = {};
            for (const p of pairs) {
                if (!p.question || !/^[A-E]$/.test(p.letter || '')) continue;
                const k = _qKey(p.question);
                if (k.length < 20) continue;
                questions[k] = { letter: p.letter.toUpperCase(), answerText: String(p.answerText || '') };
            }
            if (Object.keys(questions).length === 0) return;
            const prev = cache[urlKey]?.questions || {};
            cache[urlKey] = {
                questions: { ...prev, ...questions },
                extractedAt: Date.now(),
                count: Object.keys({ ...prev, ...questions }).length
            };
            await this._save(cache);
            console.log(`[PageGabaritoCache] [OK] ${Object.keys(questions).length} Q&A cached for ${urlKey} (total=${cache[urlKey].count})`);
        } catch (_) {}
    },

    /**
     * Usa IA para extrair TODAS as Q&A da página e guarda no cache.
     * Deve ser chamado de forma assíncrona (fire-and-forget) para não bloquear a busca.
     *
     * @param {string} pageText   Texto completo do body da página
     * @param {string} pageUrl    URL da página atual
     * @returns {Promise<number>} Número de pares extraídos (0 se falhou)
     */
    async extractAndStore(pageText, pageUrl) {
        if (!pageText || pageText.length < 300 || !pageUrl) return 0;
        try {
            const truncated = pageText.substring(0, 14000);

            const systemMsg = 'Você é um extrator de gabaritos de provas. Responda SOMENTE com JSON válido, sem markdown nem explicação.';
            const prompt = `Analise o HTML abaixo de uma página de prova ou simulado.
Extraia TODAS as questões de múltipla escolha e suas respectivas respostas corretas.
Preste atenção em elementos com classes como "correct", "gabarito", "resposta", "answer", "checked", "selected", "certa", "acerto".

FORMATO DE RESPOSTA — retorne APENAS este JSON (sem texto extra):
[{"q":"primeiros 80 chars do enunciado","letter":"B","text":"texto da alternativa correta"}]

Regras:
- Inclua somente questões com gabarito explícito ou marcação clara de resposta correta
- "letter" deve ser exatamente A, B, C, D ou E
- Se não houver gabarito nenhum, retorne: []

HTML DA PÁGINA:
${truncated}`;

            const settings = await ApiService._getSettings();
            const { content } = await ApiService._callAnyProvider(
                [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
                {
                    temperature: 0.05,
                    max_tokens: 2000,
                    model_groq: settings.groqModelFast || 'llama-3.1-8b-instant',
                    fastParallel: true
                },
                '[PageGabarito]'
            );

            if (!content) return 0;

            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return 0;

            let pairs;
            try { pairs = JSON.parse(jsonMatch[0]); } catch (_) { return 0; }
            if (!Array.isArray(pairs) || pairs.length === 0) return 0;

            const valid = pairs
                .filter(p => p?.q && /^[A-E]$/.test(String(p?.letter || '')))
                .map(p => ({
                    question: String(p.q).trim(),
                    letter: String(p.letter).toUpperCase(),
                    answerText: String(p.text || '').trim()
                }));

            if (valid.length === 0) return 0;

            await this.storeAll(pageUrl, valid);
            return valid.length;
        } catch (e) {
            console.warn('[PageGabaritoCache] extractAndStore error:', e?.message);
            return 0;
        }
    }
};
