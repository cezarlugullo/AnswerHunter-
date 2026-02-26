/**
 * PasseiDiretoAnswersApiService
 *
 * Complementary source for PasseiDireto:
 * - discovers questionId from page HTML/JSON snippets
 * - fetches answers from material-api
 *
 * Fix log:
 * - 2026-02-25: Added Jina fallback in _fetchText() when direct fetch returns partial HTML
 *              (<80 KB from SW context). Jina renders the full SPA and returns __NEXT_DATA__
 *              with embedded question IDs.
 * - 2026-02-25: Added base64('question:'+id) ID format as primary path per material-api spec.
 * - 2026-02-25: Added extractDocIdFromUrl() to get numeric doc ID directly from /arquivo/<id>/
 *              URL without any HTML fetch needed.
 */

const MATERIAL_API_BASE = 'https://material-api.passeidireto.com';
const JINA_PREFIX = 'https://r.jina.ai/';
// Minimum HTML size threshold — anything below this from SW context is the partial SSR shell
const MIN_FULL_HTML_BYTES = 80_000;

function _stripHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function _extractQuestionIdsFromText(text = '') {
  const ids = new Set();

  // Common patterns found in embedded JSON/state
  const patterns = [
    /"questionId"\s*:\s*"?([0-9]{2,20})"?/gi,
    /"question_id"\s*:\s*"?([0-9]{2,20})"?/gi,
    /questions\/(\d{2,20})/gi,
    /"id"\s*:\s*"?([0-9]{2,20})"?\s*,\s*"__typename"\s*:\s*"Question"/gi,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) ids.add(m[1]);
    }
  }

  return [...ids];
}

/**
 * Fetch raw text from a URL.
 * Primary: direct fetch (works when SW has access to full HTML).
 * Fallback: Jina mirror (https://r.jina.ai/<url>) when direct fetch returns < MIN_FULL_HTML_BYTES.
 * Jina renders the full SPA including __NEXT_DATA__, giving us embedded question IDs.
 */
async function _fetchText(url, timeoutMs = 12000) {
  const _get = async (target) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(target, {
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      if (!r.ok) return '';
      return await r.text();
    } catch (_) {
      return '';
    } finally {
      clearTimeout(t);
    }
  };

  const direct = await _get(url);
  if (direct.length >= MIN_FULL_HTML_BYTES) {
    // Got full HTML — no need for Jina
    return direct;
  }

  // Partial HTML (50 KB SSR shell from SW context) — fall back to Jina
  console.log(`[PD-API] Direct fetch too small (${direct.length} B) — trying Jina fallback`);
  const jina = await _get(JINA_PREFIX + url);
  if (jina.length > 0) {
    console.log(`[PD-API] Jina returned ${jina.length} chars for ${url}`);
    return jina;
  }

  // Return whatever we got
  return direct;
}

/**
 * Fetch answers for a question ID from material-api.
 * Tries both raw numeric ID and base64('question:'+id) formats.
 */
async function _fetchAnswers(questionId, timeoutMs = 12000) {
  // material-api accepts two ID formats:
  // 1. Raw numeric: /questions/12345/answers
  // 2. Base64 encoded: /questions/cXVlc3Rpb246MTIzNDU=/answers  (btoa('question:12345'))
  const b64Id = (() => {
    try { return btoa('question:' + questionId); } catch { return null; }
  })();

  const idsToTry = [b64Id, String(questionId)].filter(Boolean);

  for (const id of idsToTry) {
    const result = await _fetchAnswersByEncodedId(id, questionId, timeoutMs);
    if (result) return result;
  }
  return null;
}

async function _fetchAnswersByEncodedId(encodedId, questionId, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${MATERIAL_API_BASE}/questions/${encodeURIComponent(encodedId)}/answers`;
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'pd-app-client-version': '1.169.15',
      },
      signal: controller.signal,
    });

    if (!r.ok) return null;

    const data = await r.json().catch(() => null);
    if (!data) return null;

    // Flexible parsing for array/dict payloads
    let answerItems = [];
    if (Array.isArray(data)) {
      answerItems = data;
    } else if (Array.isArray(data.answers)) {
      answerItems = data.answers;
    } else if (Array.isArray(data.data)) {
      answerItems = data.data;
    }

    const combined = answerItems
      .map(a => a?.Text || a?.text || a?.body || a?.content || '')
      .filter(Boolean)
      .map(_stripHtml)
      .filter(t => t.length > 0)
      .join('\n\n');

    if (!combined) return null;

    return {
      questionId,
      encodedId,
      answerCount: answerItems.length,
      text: combined.slice(0, 14000),
      raw: data,
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const PasseiDiretoAnswersApiService = {
  isPasseiDiretoUrl(url = '') {
    return /(^|\.)passeidireto\.com$/i.test((() => {
      try { return new URL(url).hostname; } catch { return ''; }
    })());
  },

  /**
   * Extract the numeric document/arquivo ID directly from the URL.
   * e.g. passeidireto.com/arquivo/102355168/slug → '102355168'
   * Returns null if not found.
   */
  extractDocIdFromUrl(url = '') {
    const m = url.match(/\/arquivo\/(\d{4,20})/);
    return m ? m[1] : null;
  },

  async extractQuestionIdsFromPage(url) {
    const html = await _fetchText(url, 15000);
    if (!html) return [];

    const ids = _extractQuestionIdsFromText(html);

    // Also try extracting from __NEXT_DATA__ script for robustness
    if (ids.length === 0) {
      const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (m && m[1]) {
        ids.push(..._extractQuestionIdsFromText(m[1]));
      }
    }

    return [...new Set(ids)].slice(0, 10);
  },

  async getAnswersTextByUrl(url) {
    const ids = await this.extractQuestionIdsFromPage(url);
    if (!ids.length) {
      console.log('[PD-API] No question IDs found for', url);
      return null;
    }

    console.log('[PD-API] Found question IDs:', ids.slice(0, 4), 'for', url);

    // try first few IDs and keep best text
    let best = null;
    for (const qid of ids.slice(0, 4)) {
      const res = await _fetchAnswers(qid, 12000);
      if (!res || !res.text) continue;
      if (!best || res.text.length > best.text.length) best = res;
    }
    return best;
  },

  async getTextsFromUrls(urls = [], concurrency = 2) {
    const queue = [...new Set(urls.filter(Boolean))];
    const out = [];

    async function worker() {
      while (queue.length) {
        const url = queue.shift();
        const got = await PasseiDiretoAnswersApiService.getAnswersTextByUrl(url);
        if (got?.text) out.push({ url, ...got });
      }
    }

    const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
    await Promise.all(workers);
    return out;
  }
};
