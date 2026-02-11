import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { load as loadHtml } from 'cheerio';
import 'dotenv/config';

const PORT = Number(process.env.PORT || 8787);
const SERPER_API_KEY = String(process.env.SERPER_API_KEY || '').trim();
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || '').trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || 'llama-3.1-8b-instant').trim();
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 9000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const MAX_SEARCH_RESULTS = Number(process.env.MAX_SEARCH_RESULTS || 12);
const MAX_SOURCE_FETCH = Number(process.env.MAX_SOURCE_FETCH || 8);
const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 4);

const HOST_WEIGHTS = {
  'qconcursos.com': 1.55,
  'qconcursos.com.br': 1.55,
  'passeidireto.com': 1.25,
  'studocu.com': 1.05,
  'brainly.com.br': 0.9,
  'brainly.com': 0.9
};

const RISKY_HOSTS = new Set(['passeidireto.com', 'brainly.com.br', 'brainly.com']);
const cache = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stripDiacritics(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeLoose(text) {
  return stripDiacritics(String(text || '').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForIndex(text) {
  return stripDiacritics(String(text || '').toLowerCase());
}

function normalizeSpace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripOptionTailNoise(text) {
  if (!text) return '';
  let cleaned = normalizeSpace(text);
  const marker = /\b(?:gabarito|resposta\s+correta|alternativa\s+correta|parabens|explicacao)\b/i;
  const idx = cleaned.search(marker);
  if (idx > 20) cleaned = cleaned.slice(0, idx).trim();
  return cleaned.replace(/[;:,\-.\s]+$/g, '').trim();
}

function extractOptionsFromQuestion(questionText) {
  const text = String(questionText || '').replace(/\r\n/g, '\n');
  if (!text) return [];
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const options = [];
  const seen = new Set();
  const lineRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
  for (const line of lines) {
    const match = line.match(lineRe);
    if (!match) continue;
    const label = (match[1] || '').toUpperCase();
    const body = stripOptionTailNoise(match[2]);
    if (!label || !body || seen.has(label)) continue;
    options.push({ label, text: body });
    seen.add(label);
  }
  if (options.length >= 2) return options;

  const inlineRe = /(?:^|[\n\r\t ;])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;][A-E]\s*[\)\.\-:]\s)|$)/gi;
  let match;
  while ((match = inlineRe.exec(text)) !== null) {
    const label = (match[1] || '').toUpperCase();
    const body = stripOptionTailNoise(match[2]);
    if (!label || !body || seen.has(label)) continue;
    options.push({ label, text: body });
    seen.add(label);
    if (options.length >= 5) break;
  }
  return options;
}

function extractQuestionStem(questionText) {
  const text = String(questionText || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const stemLines = [];
  const optionRe = /^([A-E])\s*[\)\.\-:]/i;
  for (const line of lines) {
    if (optionRe.test(line)) break;
    stemLines.push(line);
  }
  let stem = stemLines.join(' ').trim() || text.trim();
  const inlineMarker = stem.match(/[\s:;]([A-E])\s*[\)\.\-:]\s+/i);
  if (inlineMarker && Number.isFinite(inlineMarker.index) && inlineMarker.index > 30) {
    stem = stem.slice(0, inlineMarker.index).trim();
  }
  return stem.slice(0, 700);
}

function getCanonicalHash(stem, options) {
  const normStem = normalizeLoose(stem);
  const normOpts = (options || [])
    .map((opt) => `${String(opt.label || '').toUpperCase()}:${normalizeLoose(opt.text || '')}`)
    .filter(Boolean)
    .sort();
  const canonical = `${normStem}||${normOpts.join('|')}`;
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function getHost(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function toTokens(text, minLen = 4) {
  return normalizeLoose(text)
    .split(' ')
    .filter((token) => token.length >= minLen);
}

function diceSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const mapA = new Map();
  const mapB = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const bi = a.slice(i, i + 2);
    mapA.set(bi, (mapA.get(bi) || 0) + 1);
  }
  for (let i = 0; i < b.length - 1; i += 1) {
    const bi = b.slice(i, i + 2);
    mapB.set(bi, (mapB.get(bi) || 0) + 1);
  }
  let inter = 0;
  for (const [bi, count] of mapA.entries()) {
    inter += Math.min(count, mapB.get(bi) || 0);
  }
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

function questionSimilarityScore(sourceText, questionStem) {
  const srcNorm = normalizeLoose(sourceText);
  const stemNorm = normalizeLoose(questionStem);
  if (!srcNorm || !stemNorm) return 0;
  const stemTokens = stemNorm.split(' ').filter((token) => token.length >= 4);
  if (stemTokens.length === 0) return 0;
  const srcTokenSet = new Set(srcNorm.split(' ').filter((token) => token.length >= 4));
  let hits = 0;
  for (const token of stemTokens) {
    if (srcTokenSet.has(token)) hits += 1;
  }
  const tokenScore = hits / stemTokens.length;
  const prefix = stemNorm.slice(0, 50);
  const prefixBonus = prefix.length >= 20 && srcNorm.includes(prefix) ? 0.3 : 0;
  const dice = diceSimilarity(stemNorm.slice(0, 120), srcNorm.slice(0, 600));
  return clamp((tokenScore * 0.5) + prefixBonus + (dice * 0.3), 0, 1);
}

function optionsCoverageInText(options, text) {
  if (!Array.isArray(options) || options.length < 2) {
    return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
  }
  const normSource = normalizeLoose(text);
  if (!normSource || normSource.length < 50) {
    return { hits: 0, total: options.length, ratio: 0, hasEnoughOptions: true };
  }
  const normalizedOptions = options
    .map((opt) => normalizeLoose(stripOptionTailNoise(opt.text || '')))
    .filter((opt) => opt.length >= 8);
  const unique = [...new Set(normalizedOptions)];
  if (unique.length === 0) {
    return { hits: 0, total: 0, ratio: 0, hasEnoughOptions: false };
  }
  let hits = 0;
  for (const opt of unique) {
    if (normSource.includes(opt)) hits += 1;
  }
  return {
    hits,
    total: unique.length,
    ratio: hits / unique.length,
    hasEnoughOptions: true
  };
}

function extractExplicitLetter(text) {
  if (!text) return null;
  const norm = normalizeLoose(text);
  const patterns = [
    /\bgabarito\s*[:\-]?\s*(?:letra\s*)?([a-e])\b/i,
    /\bresposta\s+correta\s*[:\-]?\s*(?:letra\s*)?([a-e])\b/i,
    /\balternativa\s+correta\s*[:\-]?\s*(?:letra\s*)?([a-e])\b/i,
    /\bresposta\s*:\s*(?:letra\s*)?([a-e])\b/i,
    /\bletra\s+([a-e])\s+(?:e|eh)\s+a\s+correta\b/i
  ];
  for (const pattern of patterns) {
    const match = norm.match(pattern);
    if (match && match[1]) {
      return { letter: match[1].toUpperCase(), explicit: true };
    }
  }
  return null;
}

function findLetterByAnswerText(answerBody, options) {
  const normAnswer = normalizeLoose(answerBody);
  if (!normAnswer || !options || options.length === 0) return null;
  let bestLetter = null;
  let bestScore = 0;
  for (const opt of options) {
    const optNorm = normalizeLoose(opt.text || '');
    if (!optNorm || optNorm.length < 8) continue;
    if (normAnswer.includes(optNorm)) {
      const score = optNorm.length;
      if (score > bestScore) {
        bestScore = score;
        bestLetter = String(opt.label || '').toUpperCase();
      }
    }
  }
  return bestLetter;
}

function isLikelyObfuscatedText(text) {
  const normalized = normalizeLoose(text);
  if (normalized.length < 120) return false;
  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 20) return false;
  const letters = (normalized.match(/[a-z]/g) || []).length || 1;
  const vowels = (normalized.match(/[aeiou]/g) || []).length;
  const vowelRatio = vowels / letters;
  const relevant = words.filter((word) => word.length >= 4);
  let noVowelWords = 0;
  let longConsonantRuns = 0;
  for (const word of relevant) {
    if (!/[aeiou]/.test(word)) noVowelWords += 1;
    if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(word)) longConsonantRuns += 1;
  }
  const junkRatio = noVowelWords / Math.max(1, relevant.length);
  return (vowelRatio < 0.24 && junkRatio >= 0.28) || longConsonantRuns >= 4;
}

function buildQueries(stem, options) {
  const cleanStem = normalizeSpace(stem).slice(0, 280);
  const optionBodies = (options || []).map((opt) => normalizeSpace(opt.text || '')).filter(Boolean);
  const distributed = [];
  const pushUnique = (value) => {
    if (value && !distributed.includes(value)) distributed.push(value);
  };
  pushUnique(optionBodies[0]);
  pushUnique(optionBodies[1]);
  pushUnique(optionBodies[optionBodies.length - 1]);
  pushUnique(optionBodies[2]);
  const hintTexts = distributed
    .slice(0, 4)
    .map((opt) => `"${opt.split(' ').slice(0, 8).join(' ')}"`);

  const siteFilter = 'site:qconcursos.com OR site:passeidireto.com OR site:studocu.com OR site:brainly.com.br';
  const queries = [
    `${cleanStem} gabarito`,
    hintTexts.length >= 2 ? `${cleanStem} ${hintTexts.join(' ')} gabarito` : '',
    `"${cleanStem.replace(/["']/g, '').slice(0, 180)}"`,
    `${cleanStem} ${siteFilter}`
  ].filter(Boolean);

  return [...new Set(queries)].slice(0, 4);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error };
  } finally {
    clearTimeout(timer);
  }
}

async function runSerperSearches(stem, options) {
  if (!SERPER_API_KEY) return { queries: [], results: [] };
  const queries = buildQueries(stem, options);
  const stemTokens = toTokens(stem, 4).slice(0, 14);
  const optionTokens = toTokens((options || []).map((opt) => opt.text).join(' '), 4).slice(0, 12);
  const pooled = [];

  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i];
    const res = await fetchJsonWithTimeout('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: query,
        gl: 'br',
        hl: 'pt-br',
        num: 8
      })
    });
    if (!res.ok || !res.data?.organic) continue;
    const queryBoost = i === 0 ? 0.45 : i === 1 ? 0.7 : i === 2 ? 0.8 : 0.55;
    for (let pos = 0; pos < res.data.organic.length; pos += 1) {
      const item = res.data.organic[pos];
      const host = getHost(item.link || '');
      const hay = normalizeLoose(`${item.title || ''} ${item.snippet || ''} ${item.link || ''}`);
      let stemHits = 0;
      let optionHits = 0;
      for (const token of stemTokens) if (hay.includes(token)) stemHits += 1;
      for (const token of optionTokens) if (hay.includes(token)) optionHits += 1;
      const hostBoost = HOST_WEIGHTS[host] || 0.65;
      const rankBoost = Math.max(0, 1.2 - (pos * 0.1));
      const score = (stemHits * 0.34) + (optionHits * 0.3) + hostBoost + rankBoost + queryBoost;
      pooled.push({ item, score });
    }
  }

  const dedup = new Map();
  for (const entry of pooled) {
    const link = String(entry.item?.link || '').trim();
    if (!link) continue;
    const prev = dedup.get(link);
    if (!prev || entry.score > prev.score) dedup.set(link, entry);
  }

  const ranked = [...dedup.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
    .slice(0, MAX_SEARCH_RESULTS);

  return { queries, results: ranked };
}

async function fetchHtml(url, timeoutMs = HTTP_TIMEOUT_MS) {
  const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };
  const fetchText = async (targetUrl) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal
      });
      const text = await response.text().catch(() => '');
      return { ok: response.ok, status: response.status, url: response.url || targetUrl, html: text };
    } catch (error) {
      return { ok: false, status: 0, url: targetUrl, html: '', error };
    } finally {
      clearTimeout(timer);
    }
  };

  const primary = await fetchText(url);
  if (primary.ok && primary.html.length > 500) return primary;
  if (![0, 403, 429].includes(primary.status) && primary.html.length > 500) return primary;
  const webcacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
  const cached = await fetchText(webcacheUrl);
  if (cached.ok && cached.html.length > 800) return { ...cached, viaWebcache: true };
  return primary;
}

function extractRelevantTextFromHtml(html) {
  if (!html) return '';
  try {
    const $ = loadHtml(html);
    $('script, style, noscript, iframe, object, embed, nav, header, footer, aside, [role="navigation"], .ads, .advertisement').remove();
    const root = $('main').first().length
      ? $('main').first()
      : $('article').first().length
        ? $('article').first()
        : $('body');
    let text = root.text();
    if (!text || text.length < 120) text = $('body').text();
    return normalizeSpace(text).slice(0, 250000);
  } catch {
    return '';
  }
}

function analyzeEvidenceFromText(text, stem, options, host, sourceUrl, sourceTitle) {
  if (!text || text.length < 120) return null;
  const normIndexText = normalizeForIndex(text);
  const stemNorm = normalizeLoose(stem);
  const stemPrefix = stemNorm.slice(0, 50);
  const questionIdx = stemPrefix.length >= 15 ? normIndexText.indexOf(stemPrefix) : -1;
  const isMultiQuestion = (normIndexText.match(/(?:^|\s)\d{1,2}\s*[\)\.\-]/g) || []).length >= 6;
  const anchorRe = /(gabarito|resposta correta|alternativa correta|resposta:\s*letra|a resposta e)/gi;
  const directiveRe = /(assinale|marque|selecione|indique)\s+(a\s+)?(alternativa|afirmativa|opcao)\s+(correta|incorreta|falsa|errada)/i;
  const strongAnchorRe = /(gabarito|resposta correta|resposta:\s*(letra\s*)?[a-e]|a resposta e)/i;

  const candidates = [];
  let match;
  let guard = 0;
  while ((match = anchorRe.exec(normIndexText)) !== null && guard < 10) {
    guard += 1;
    const anchorIdx = match.index || 0;
    const start = Math.max(0, anchorIdx - 240);
    const end = Math.min(text.length, anchorIdx + 900);
    const ctx = text.slice(start, end);
    const nearPrefix = text.slice(Math.max(0, anchorIdx - 160), Math.min(text.length, anchorIdx + 80));
    const anchorLabel = String(match[1] || '').toLowerCase();
    if (/alternativa correta/.test(anchorLabel) && directiveRe.test(normalizeLoose(nearPrefix))) continue;

    const ctxNorm = normalizeLoose(ctx);
    const hasStrongAnchor = strongAnchorRe.test(ctxNorm);
    if (!hasStrongAnchor) continue;
    if (directiveRe.test(ctxNorm) && !/(gabarito|resposta correta|a resposta e|resposta:)/i.test(ctxNorm)) continue;

    const similarity = questionSimilarityScore(ctx, stem);
    const coverage = optionsCoverageInText(options, ctx);
    const explicit = extractExplicitLetter(ctx);
    const mapped = explicit?.letter || findLetterByAnswerText(ctx, options);
    if (!mapped) continue;

    let score = 0;
    if (similarity >= 0.85) score += 5;
    else if (similarity >= 0.7) score += 3;
    else if (similarity >= 0.55) score += 1;
    if (coverage.hits >= 2) score += 3;
    if (explicit?.letter) score += 4;
    if (isMultiQuestion && coverage.hits < 2) score -= 4;
    if (questionIdx >= 0 && Math.abs(anchorIdx - questionIdx) > 3600) score -= 3;

    const riskyHost = RISKY_HOSTS.has(host);
    const strongOptions = coverage.ratio >= 0.8 || coverage.hits >= Math.min(4, coverage.total || 4);
    if (riskyHost && !strongOptions && similarity < 0.62) continue;
    if (!explicit?.letter && coverage.hits < 2 && similarity < 0.6) continue;

    candidates.push({
      letter: mapped.toUpperCase(),
      explicit: !!explicit?.letter,
      similarity,
      optionHits: coverage.hits,
      optionRatio: coverage.ratio,
      score,
      evidence: ctx.slice(0, 1000),
      anchorIdx,
      sourceUrl,
      sourceTitle,
      host
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    return b.similarity - a.similarity;
  });
  return candidates[0];
}

async function analyzeSource(result, stem, options) {
  const link = String(result?.link || '').trim();
  if (!link) return null;
  const title = String(result?.title || '').trim();
  const host = getHost(link);
  const fetched = await fetchHtml(link);
  const text = extractRelevantTextFromHtml(fetched.html || '');
  if (!text || text.length < 150) {
    return {
      url: link,
      title,
      host,
      skipped: true,
      reason: 'empty_text'
    };
  }
  if (isLikelyObfuscatedText(text)) {
    return {
      url: link,
      title,
      host,
      skipped: true,
      reason: 'obfuscated_html'
    };
  }
  const pageSim = questionSimilarityScore(text.slice(0, 12000), stem);
  const pageCoverage = optionsCoverageInText(options, text.slice(0, 12000));
  if (pageSim < 0.16 && pageCoverage.hits < 1) {
    return {
      url: link,
      title,
      host,
      skipped: true,
      reason: 'low_similarity'
    };
  }

  const evidence = analyzeEvidenceFromText(text, stem, options, host, link, title);
  if (!evidence) {
    return {
      url: link,
      title,
      host,
      skipped: true,
      reason: 'no_answer_signal',
      pageSim,
      pageOptionHits: pageCoverage.hits
    };
  }

  const hostWeight = HOST_WEIGHTS[host] || 1;
  const weightedScore = Math.max(0, evidence.score) * hostWeight;
  return {
    url: link,
    title,
    host,
    skipped: false,
    viaWebcache: !!fetched.viaWebcache,
    status: fetched.status || 0,
    letter: evidence.letter,
    explicit: evidence.explicit,
    similarity: evidence.similarity,
    optionHits: evidence.optionHits,
    optionRatio: evidence.optionRatio,
    rawScore: evidence.score,
    weightedScore,
    evidence: evidence.evidence
  };
}

function computeConsensus(candidates) {
  if (!candidates || candidates.length === 0) {
    return {
      votes: {},
      bestLetter: null,
      confidence: 0.25,
      state: 'inconclusive',
      reason: 'no_evidence'
    };
  }

  const votes = {};
  const explicitByLetter = {};
  const domainsByLetter = {};
  for (const c of candidates) {
    const letter = String(c.letter || '').toUpperCase();
    if (!letter) continue;
    votes[letter] = (votes[letter] || 0) + Math.max(0.2, c.weightedScore || 0);
    if (c.explicit) explicitByLetter[letter] = (explicitByLetter[letter] || 0) + 1;
    if (!domainsByLetter[letter]) domainsByLetter[letter] = new Set();
    if (c.host) domainsByLetter[letter].add(c.host);
  }

  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    return {
      votes,
      bestLetter: null,
      confidence: 0.25,
      state: 'inconclusive',
      reason: 'no_vote'
    };
  }

  const [bestLetter, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] || 0;
  const margin = bestScore - secondScore;
  const bestDomains = domainsByLetter[bestLetter] ? domainsByLetter[bestLetter].size : 0;
  const bestExplicit = explicitByLetter[bestLetter] || 0;
  const total = Object.values(votes).reduce((sum, value) => sum + value, 0) || 1;
  let confidence = clamp(bestScore / total, 0.25, 0.98);
  let state = 'inconclusive';
  let reason = 'weak_consensus';

  if (bestScore >= 6.2 && margin >= 1.1 && (bestDomains >= 2 || bestExplicit >= 1)) {
    state = 'confirmed';
    reason = 'confirmed_by_sources';
    confidence = Math.max(confidence, 0.86);
  } else if (margin < 1.0 && ranked.length >= 2) {
    state = 'conflict';
    reason = 'source_conflict';
    confidence = Math.min(confidence, 0.74);
  } else {
    confidence = Math.min(confidence, 0.79);
  }

  return { votes, bestLetter, confidence, state, reason, margin, bestScore };
}

async function fallbackWithGroq(questionText, options, evidenceList) {
  if (!GROQ_API_KEY || !evidenceList || evidenceList.length === 0) return null;
  const optionsText = options.map((opt) => `${opt.label}) ${opt.text}`).join('\n');
  const evidenceText = evidenceList
    .slice(0, 4)
    .map((e, i) => `SOURCE ${i + 1} (${e.host || 'host'}): ${e.evidence.slice(0, 800)}`)
    .join('\n\n');
  const prompt = [
    'Responda com JSON valido no formato: {"letter":"A-E|null","confidence":0-1,"reason":"..."}',
    'Nao invente fontes. Use somente as evidencias abaixo.',
    'Se nao houver evidencia suficiente, use letter=null.',
    '',
    'QUESTAO:',
    questionText,
    '',
    'ALTERNATIVAS:',
    optionsText,
    '',
    'EVIDENCIAS:',
    evidenceText
  ].join('\n');

  const response = await fetchJsonWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.1,
      max_tokens: 180,
      messages: [
        { role: 'system', content: 'Voce e um validador de questoes. Retorne apenas JSON.' },
        { role: 'user', content: prompt }
      ]
    })
  }, Math.max(HTTP_TIMEOUT_MS, 12000));

  if (!response.ok) return null;
  const content = String(response.data?.choices?.[0]?.message?.content || '').trim();
  if (!content) return null;
  let parsed = null;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {
    parsed = null;
  }
  const letter = String(parsed?.letter || '').toUpperCase();
  if (!/^[A-E]$/.test(letter)) return null;
  return {
    letter,
    confidence: clamp(Number(parsed?.confidence || 0.65), 0.4, 0.92),
    reason: String(parsed?.reason || 'llm_fallback').slice(0, 240)
  };
}

function getCached(hash) {
  const entry = cache.get(hash);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(hash);
    return null;
  }
  return entry.payload;
}

function setCached(hash, payload) {
  cache.set(hash, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload
  });
}

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= now) cache.delete(key);
  }
}

async function mapConcurrent(items, limit, mapper) {
  const max = Math.max(1, Number(limit || 1));
  const queue = [...items];
  const out = [];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (typeof item === 'undefined') break;
      // eslint-disable-next-line no-await-in-loop
      const mapped = await mapper(item);
      out.push(mapped);
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, () => worker()));
  return out;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'answerhunter-backend',
    cache_entries: cache.size,
    serper_configured: !!SERPER_API_KEY,
    groq_configured: !!GROQ_API_KEY
  });
});

app.post('/resolve', async (req, res) => {
  const startedAt = Date.now();
  try {
    const questionText = normalizeSpace(req.body?.question_text || '');
    if (!questionText || questionText.length < 20) {
      res.status(400).json({ ok: false, error: 'question_text is required' });
      return;
    }

    const suppliedOptions = Array.isArray(req.body?.options)
      ? req.body.options
          .map((opt) => ({
            label: String(opt?.label || '').toUpperCase().slice(0, 1),
            text: stripOptionTailNoise(opt?.text || '')
          }))
          .filter((opt) => /^[A-E]$/.test(opt.label) && opt.text.length >= 2)
      : [];

    const options = suppliedOptions.length >= 2 ? suppliedOptions : extractOptionsFromQuestion(questionText);
    const stem = extractQuestionStem(questionText);
    const hash = getCanonicalHash(stem, options);
    const cached = getCached(hash);
    if (cached) {
      res.json({
        ...cached,
        cache_hit: true,
        elapsed_ms: Date.now() - startedAt
      });
      return;
    }

    if (!SERPER_API_KEY) {
      res.status(500).json({
        ok: false,
        error: 'SERPER_API_KEY is not configured'
      });
      return;
    }

    const search = await runSerperSearches(stem, options);
    const topResults = (search.results || []).slice(0, Math.max(1, MAX_SOURCE_FETCH));
    const analyzed = await mapConcurrent(topResults, FETCH_CONCURRENCY, (item) => analyzeSource(item, stem, options));
    const withEvidence = analyzed.filter((item) => item && !item.skipped && /^[A-E]$/.test(item.letter));
    const evidencePool = withEvidence
      .filter((item) => item.evidence && item.evidence.length >= 80)
      .sort((a, b) => (b.weightedScore || 0) - (a.weightedScore || 0));

    const consensus = computeConsensus(withEvidence);
    let finalLetter = consensus.bestLetter;
    let finalConfidence = consensus.confidence;
    let finalState = consensus.state;
    let finalReason = consensus.reason;
    let usedLlmFallback = false;

    if ((!finalLetter || finalState !== 'confirmed') && evidencePool.length > 0) {
      const llm = await fallbackWithGroq(questionText, options, evidencePool);
      if (llm?.letter) {
        finalLetter = llm.letter;
        finalConfidence = Math.max(finalConfidence, llm.confidence || 0.65);
        if (!consensus.bestLetter) {
          finalState = 'inconclusive';
          finalReason = llm.reason || 'llm_fallback';
        }
        usedLlmFallback = true;
      }
    }

    const answerText = finalLetter
      ? (options.find((opt) => opt.label === finalLetter)?.text || '')
      : '';

    const payload = {
      ok: true,
      question_hash: hash,
      answer_letter: finalLetter || null,
      answer_text: answerText,
      confidence: clamp(Number(finalConfidence || 0.25), 0.25, 0.99),
      state: finalState || 'inconclusive',
      reason: finalReason || 'inconclusive',
      votes: consensus.votes || {},
      used_llm_fallback: usedLlmFallback,
      search_queries: search.queries || [],
      sources: withEvidence
        .sort((a, b) => (b.weightedScore || 0) - (a.weightedScore || 0))
        .map((item) => ({
          url: item.url,
          title: item.title,
          host: item.host,
          letter: item.letter,
          explicit: item.explicit,
          similarity: Number((item.similarity || 0).toFixed(3)),
          option_hits: item.optionHits || 0,
          raw_score: item.rawScore || 0,
          weighted_score: Number((item.weightedScore || 0).toFixed(2)),
          evidence_excerpt: (item.evidence || '').slice(0, 420)
        })),
      skipped_sources: analyzed
        .filter((item) => item?.skipped)
        .map((item) => ({
          url: item.url,
          host: item.host,
          reason: item.reason
        }))
    };

    setCached(hash, payload);
    res.json({
      ...payload,
      cache_hit: false,
      elapsed_ms: Date.now() - startedAt
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'internal_error'
    });
  }
});

setInterval(cleanupCache, 5 * 60 * 1000).unref();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AnswerHunter backend listening on http://127.0.0.1:${PORT}`);
});
