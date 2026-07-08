/**
 * AiExtractionParser.js
 * Pure parsing of LLM responses in the aiExtractFromPage prompt format
 * (RESULTADO / EVIDÊNCIA / RACIOCÍNIO / "Letra X: texto").
 *
 * Fixes two chronic sources of wrong gabaritos with weaker LLMs:
 *  1. Greedy letter matching — the old regex accepted any "A)" that appeared
 *     anywhere in the response, including options the model was merely QUOTING
 *     while reasoning. Here the letter must come from an anchored pattern, and
 *     "Letra X:" lines use the LAST occurrence (the prompt places it last).
 *  2. Hallucinated evidence — the EVIDÊNCIA quote is checked against the real
 *     source text. A letter backed by a quote that does not exist in the page
 *     gets a much lower confidence, so it cannot dominate the vote.
 *
 * No dependencies, no chrome.* — safe to unit test under node --test.
 */

const MIN_USEFUL_LENGTH = 40;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function normalizeForCompare(text = '') {
    return String(text || '')
        .normalize('NFD').replace(COMBINING_MARKS_RE, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function tokenizeForCompare(text = '') {
    return String(text || '')
        .normalize('NFD').replace(COMBINING_MARKS_RE, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(t => t.length >= 4);
}

/**
 * Checks whether an EVIDÊNCIA quote plausibly exists in the source text.
 * @returns {boolean|null} true = quote found (verbatim or ≥70% of its content
 *   tokens), false = quote absent (likely hallucinated), null = cannot verify
 *   (missing/too-short quote or source).
 */
export function verifyEvidenceQuote(evidence, sourceText) {
    if (!evidence || !sourceText) return null;
    const evidCompact = normalizeForCompare(evidence);
    const srcCompact = normalizeForCompare(sourceText);
    if (evidCompact.length < 8 || srcCompact.length < 40) return null;

    // Exact containment verifies even short quotes ("Gabarito: C" → "gabaritoc")
    const head = evidCompact.slice(0, 120);
    const tail = evidCompact.slice(-120);
    if (srcCompact.includes(head)) return true;
    if (evidCompact.length > 120 && srcCompact.includes(tail)) return true;

    // Token-based tolerance (paraphrase-resistant) needs more material to be safe
    if (evidCompact.length < 12) return null;
    const tokens = tokenizeForCompare(evidence);
    if (tokens.length < 3) return false;
    let hits = 0;
    for (const t of tokens) { if (srcCompact.includes(t)) hits++; }
    return (hits / tokens.length) >= 0.7;
}

/**
 * Cleans the alternative text captured after "Letra X:".
 * Strips trailing model commentary without destroying code-style options
 * (e.g. "CREATE ( : Cliente { nome : 'Léa' } )" keeps its parentheses).
 */
function cleanAnswerText(raw = '') {
    let text = String(raw || '').replace(/\s+/g, ' ').trim();
    // Trailing parenthetical is stripped only when it reads like commentary
    const trailingParen = text.match(/\s*\(([^()]*)\)\s*$/);
    if (trailingParen && /\b(conforme|segundo|pois|porque|gabarito|evid[eê]ncia|texto|fonte|correta?|resposta)\b/i.test(trailingParen[1])) {
        text = text.slice(0, trailingParen.index).trim();
    }
    text = text
        .replace(/\s*["“”].*$/, '')
        .replace(/[.;,:]+\s*$/, '')
        .trim();
    return text || null;
}

/**
 * Parses an extraction response.
 * @param {string} content - Raw LLM response.
 * @param {{sourceText?: string, questionText?: string}} [opts]
 *   sourceText: page text used to verify the evidence quote.
 *   questionText: the student's question — used to detect "stem echo": weak LLMs
 *   that can't find the answer in the page often answer from their OWN knowledge
 *   and quote the QUESTION back as "evidence". If the quote is absent from the
 *   source but present in the question, the letter is a knowledge guess, not an
 *   extraction (evidenceEchoesQuestion=true, confidence drops to 0.45).
 * @returns {{
 *   status: 'empty'|'not_found'|'partial'|'no_letter'|'found',
 *   letter: string|null,
 *   answerText: string|null,
 *   evidence: string|null,
 *   evidenceVerified: boolean|null,
 *   evidenceEchoesQuestion: boolean,
 *   knowledge: string|null,
 *   confidence: number,
 *   parseMethod: string|null
 * }}
 */
export function parseAiExtractionResponse(content, { sourceText = '', questionText = '' } = {}) {
    const base = {
        status: 'empty', letter: null, answerText: null, evidence: null,
        evidenceVerified: null, evidenceEchoesQuestion: false, knowledge: null, confidence: 0, parseMethod: null
    };
    const raw = String(content || '').trim();
    if (!raw || raw.length < MIN_USEFUL_LENGTH) return base;

    if (/^RESULTADO:\s*NAO_ENCONTRADO/im.test(raw)) {
        return { ...base, status: 'not_found' };
    }

    if (/RESULTADO:\s*CONHECIMENTO_PARCIAL/i.test(raw)) {
        const km = raw.match(/CONHECIMENTOS?:\s*([\s\S]+)/i);
        const knowledge = (km ? km[1] : raw).trim().slice(0, 1200);
        return { ...base, status: 'partial', knowledge };
    }

    // Strip markdown emphasis (Claude/Copilot often answer "**Letra A**")
    const plain = raw.replace(/[*_]{1,3}/g, '');

    let letter = null;
    let answerText = null;
    let parseMethod = null;

    // 1) Anchored "Letra X: texto" line — LAST occurrence wins. Earlier ones are
    //    usually the model quoting alternatives while it reasons.
    const letraRe = /^[ \t>]*Letra\s+([A-E])\b\s*[:\-–]?\s*(.*)$/gim;
    let m;
    let lastLetra = null;
    while ((m = letraRe.exec(plain)) !== null) lastLetra = m;
    if (lastLetra) {
        letter = lastLetra[1].toUpperCase();
        answerText = cleanAnswerText(lastLetra[2]);
        parseMethod = 'letra-line';
    }

    // 2) Contextual statements — require "correta"/"gabarito"/"resposta" nearby,
    //    never a bare "A)" (that was the greedy-regex bug). The `(?:a\s+)?` group
    //    consumes the Portuguese article in "é a C" so it can't be captured as
    //    letter A (same proven technique as EvidenceService.extractExplicitGabarito).
    if (!letter) {
        const ARTICLE = /(?:a\s+)?(?:(?:letra|alternativa)\s+)?/.source;
        const TAIL = /(?=[)\s.,;:!\n]|$)/.source;
        const ctx = plain.match(new RegExp(`(?:alternativa|resposta|op[cç][aã]o)\\s+correta\\s*(?:[eé:\\-]\\s*)?${ARTICLE}([A-E])${TAIL}`, 'i'))
            || plain.match(new RegExp(`\\bgabarito\\s*[:\\-]?\\s*${ARTICLE}([A-E])${TAIL}`, 'i'))
            || plain.match(new RegExp(`\\bresposta\\s*[:\\-]\\s*${ARTICLE}([A-E])${TAIL}`, 'i'))
            || plain.match(/\b[eé]\s+a\s+(?:letra|alternativa)\s+([A-E])(?=[)\s.,;:!\n]|$)/i);
        if (ctx) {
            letter = ctx[1].toUpperCase();
            parseMethod = 'contextual';
        }
    }

    // 3) Weakest fallback: the FINAL non-empty line formatted as an option
    //    ("C) Escalabilidade horizontal"). Never matched mid-text.
    if (!letter) {
        const lines = plain.split('\n').map(l => l.trim()).filter(Boolean);
        const lastLine = lines[lines.length - 1] || '';
        const lm = lastLine.match(/^([A-E])\s*[\)\.\-:]\s*(\S.*)$/);
        if (lm) {
            letter = lm[1].toUpperCase();
            answerText = cleanAnswerText(lm[2]);
            parseMethod = 'last-line';
        }
    }

    const evMatch = plain.match(/EVID[EÊ]NCIA:\s*([\s\S]*?)(?=\bRACIOC[IÍ]NIO:|^[ \t>]*Letra\s+[A-E]\b|$)/im);
    const quotedEvidence = evMatch ? evMatch[1].trim() : null;
    const evidenceVerified = verifyEvidenceQuote(quotedEvidence, sourceText);
    // Stem echo: quote not in the page, but it IS a quote of the question itself
    const evidenceEchoesQuestion = evidenceVerified !== true && !!questionText
        && verifyEvidenceQuote(quotedEvidence, questionText) === true;
    // Downstream guards expect *some* evidence text; fall back to the full response
    const evidence = quotedEvidence || plain;
    const knowledge = raw.slice(0, 1200);

    if (!letter) {
        return { ...base, status: 'no_letter', evidence, evidenceVerified, evidenceEchoesQuestion, knowledge };
    }

    let confidence = 0.75;               // evidence present but unverifiable
    if (evidenceVerified === true) confidence = 0.86;
    else if (evidenceVerified === false) confidence = 0.55;
    if (evidenceEchoesQuestion) confidence = 0.45; // knowledge guess disguised as extraction
    if (parseMethod === 'last-line') confidence = Math.min(confidence, 0.65);

    return {
        status: 'found', letter, answerText,
        evidence: evidence.slice(0, 900),
        evidenceVerified, evidenceEchoesQuestion, knowledge, confidence, parseMethod
    };
}
