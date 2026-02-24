import { ApiService } from './ApiService.js';
import { QuestionParser } from './search/QuestionParser.js';
import { OptionsMatchService } from './search/OptionsMatchService.js';
import { HtmlExtractorService } from './search/HtmlExtractorService.js';
import { EvidenceService } from './search/EvidenceService.js';
import { SearchCacheService } from './search/SearchCacheService.js';
import { FreeTextAnswerService } from './search/FreeTextAnswerService.js';

// SearchService
// Coordinates (1) direct extraction and (2) web search + evidence-based refinement.
// Sub-services handle the heavy lifting; this file remains the orchestrator.
export const SearchService = {
  // 7 days

  // Snapshot cache: reuse fetched pages across searches (same session)
  // url → { snap, fetchedAt }
  // 5 minutes
  // max 30 URLs in memory

  // AI extraction result cache: persisted to chrome.storage.local so LLM calls
  // are not repeated for the same URL + question on subsequent searches.
  // null = not loaded yet; Map<cacheKey, {letter,knowledge,cachedAt}>

  // 7 days

  _buildOptionsMap(questionText) {
    const options = QuestionParser.extractOptionsFromQuestion(questionText);
    const map = {};
    for (const opt of options) {
      const m = opt.match(/^([A-E])\)\s*(.+)$/i);
      if (m) map[m[1].toUpperCase()] = QuestionParser.stripOptionTailNoise(m[2]);
    }
    return map;
  },
  _parseAnswerLetter(answerText) {
    if (!answerText) return null;
    const text = String(answerText).replace(/\r/g, '\n').trim();
    if (!text) return null;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const finalLineRe = /^(?:(?:resposta\s+final|conclus[aã]o|gabarito)\s*[:\-]\s*)?(?:letra|gabarito|resposta\s+final|alternativa\s+correta|letter|option)\s*[:\-]?\s*([A-E])\b(?:\s*[:.\-]|$)/i;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
      const m = lines[i].match(finalLineRe);
      if (m) return (m[1] || '').toUpperCase();
    }
    const taggedMatches = [...text.matchAll(/(?:^|\b)(?:resposta\s+final|gabarito|alternativa\s+correta|letra|letter|option)\s*[:\-]?\s*(?:letra\s*)?([A-E])\b/gi)].map(m => (m[1] || '').toUpperCase()).filter(Boolean);
    const uniqueTagged = [...new Set(taggedMatches)];
    if (uniqueTagged.length === 1) return uniqueTagged[0];
    if (uniqueTagged.length > 1) return null;

    // Match "a resposta (correta) é/seria (a alternativa) X"
    const prosePatterns = [/(?:resposta|answer)\s+(?:correta\s+)?(?:[eéÉ]|seria)\s+(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /(?:alternativa|opção|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?([A-E])\b/gi, /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi];
    for (const re of prosePatterns) {
      const proseHits = [...text.matchAll(re)].map(m => (m[1] || '').toUpperCase()).filter(Boolean);
      const uniqueProse = [...new Set(proseHits)];
      if (uniqueProse.length === 1) return uniqueProse[0];
    }

    // Last resort for terse answers like "A) ..."
    const optionLineMatches = [...text.matchAll(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s+/gim)].map(m => (m[1] || '').toUpperCase()).filter(Boolean);
    const uniqueOptionLines = [...new Set(optionLineMatches)];
    if (uniqueOptionLines.length === 1) return uniqueOptionLines[0];

    // V/F inference: AI wrote "X) V" / "X) F" but no explicit final answer line
    // Pick the single V (correct) or F (incorrect question)
    const asksIncorrect = /\b(incorreta|falsa|exceto|n[aã]o\s+[eé]|errada)\b/i.test(text);
    const vfAll = [...text.matchAll(/\b([A-E])\s*\)\s*[*_]*\s*([VF])\b/gi)];
    if (vfAll.length >= 2) {
      const targetMark = asksIncorrect ? 'F' : 'V';
      const targets = vfAll.filter(m => String(m[2]).toUpperCase() === targetMark);
      if (targets.length === 1) return String(targets[0][1]).toUpperCase();
    }

    // Bare letter in last line (very short conclusion line)
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      if (lastLine.length < 40) {
        const bareMatch = lastLine.match(/\b([A-E])\b/i);
        if (bareMatch) return bareMatch[1].toUpperCase();
      }
    }
    return null;
  },
  _parseAnswerText(answerText) {
    if (!answerText) return '';
    const text = String(answerText).replace(/\r/g, '\n').trim();

    // For step-by-step AI responses (PASSO 1/2/3), find "Letra X: [text]" in the last lines
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const finalBodyRe = /(?:letra|alternativa|letter|option)\s*[A-E]\s*[:.\-]\s*(.{5,})/i;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
      const m = lines[i].match(finalBodyRe);
      if (m && m[1]) return m[1].trim();
    }

    // Fallback: strip letter prefix from beginning of text
    return text.replace(/^(?:Letra|Alternativa|Letter|Option)\s*[A-E]\s*[:.\-]?\s*/i, '').replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '').trim();
  },
  // ▸▸▸ GOOGLE AI OVERVIEW / ANSWER BOX EXTRACTION ▸▸▸
  // Extracts an answer letter from Serper meta signals (answerBox, aiOverview,
  // peopleAlsoAsk) that come "for free" with the search results.
  _extractLetterFromGoogleMeta(serperMeta, questionStem, originalOptionsMap, originalOptions) {
    if (!serperMeta) return null;
    const results = []; // {letter, confidence, method, evidence}

    // ── 1) answerBox ──
    const ab = serperMeta.answerBox;
    if (ab) {
      const abText = [ab.title, ab.snippet, ab.answer, ab.highlighted_words?.join(' ')].filter(Boolean).join(' ').trim();
      if (abText.length >= 20) {
        const parsed = this._parseGoogleMetaText(abText, originalOptionsMap, originalOptions);
        if (parsed) {
          results.push({
            ...parsed,
            method: 'google-answerbox',
            evidence: abText.slice(0, 600)
          });
        }
      }
    }

    // ── 2) aiOverview (Serper may return embedded or via separate key) ──
    const aio = serperMeta.aiOverview;
    if (aio) {
      let aioText = '';
      if (typeof aio === 'string') {
        aioText = aio;
      } else if (aio.text_blocks && Array.isArray(aio.text_blocks)) {
        aioText = this._flattenAiOverviewBlocks(aio.text_blocks);
      } else if (aio.snippet) {
        aioText = String(aio.snippet || '');
      } else if (aio.text) {
        aioText = String(aio.text || '');
      }
      if (aioText.length >= 30) {
        const parsed = this._parseGoogleMetaText(aioText, originalOptionsMap, originalOptions);
        if (parsed) {
          results.push({
            ...parsed,
            method: 'google-ai-overview',
            evidence: aioText.slice(0, 800)
          });
        }
      }
    }

    // ── 3) peopleAlsoAsk ──
    const paa = serperMeta.peopleAlsoAsk;
    if (Array.isArray(paa) && paa.length > 0) {
      // Only use PAA entries whose question is similar to the user's question
      const normStem = QuestionParser.normalizeOption(questionStem);
      for (const entry of paa.slice(0, 4)) {
        const paaQ = String(entry.question || entry.title || '');
        const paaSnippet = String(entry.snippet || entry.answer || '');
        if (!paaSnippet || paaSnippet.length < 20) continue;
        // Check topic relevance of the PAA question
        const paaQNorm = QuestionParser.normalizeOption(paaQ);
        const qSim = QuestionParser.diceSimilarity(normStem, paaQNorm);
        if (qSim < 0.40) continue;
        const parsed = this._parseGoogleMetaText(paaSnippet, originalOptionsMap, originalOptions);
        if (parsed) {
          // PAA is less reliable — reduce confidence
          results.push({
            ...parsed,
            confidence: Math.min(parsed.confidence, 0.72),
            method: 'google-paa',
            evidence: `Q: ${paaQ}\nA: ${paaSnippet}`.slice(0, 500)
          });
          break; // Only use first matching PAA
        }
      }
    }
    if (results.length === 0) return null;

    // Pick the highest-confidence result
    results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const best = results[0];
    console.log(`SearchService: [google-meta] Found letter=${best.letter} confidence=${best.confidence.toFixed(2)} method=${best.method} from ${results.length} candidate(s)`);
    return best;
  },
  // Flatten AI Overview text_blocks (nested structure from Serper/SerpAPI)
  _flattenAiOverviewBlocks(blocks) {
    if (!Array.isArray(blocks)) return '';
    const parts = [];
    for (const block of blocks) {
      if (block.snippet) parts.push(block.snippet);
      if (block.text) parts.push(block.text);
      if (block.list && Array.isArray(block.list)) {
        for (const item of block.list) {
          if (item.snippet) parts.push(item.snippet);
          if (item.title) parts.push(item.title);
          if (item.text_blocks) parts.push(this._flattenAiOverviewBlocks(item.text_blocks));
        }
      }
      if (block.text_blocks) parts.push(this._flattenAiOverviewBlocks(block.text_blocks));
    }
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  },
  // Core parser: extracts answer letter from Google meta text by:
  // 1. Explicit "alternativa correta é a C" / "Letra C" patterns
  // 2. Content match against user's option bodies
  _parseGoogleMetaText(text, originalOptionsMap, originalOptions) {
    if (!text || text.length < 15) return null;

    // Strategy 1: Explicit letter mention
    const explicitPatterns = [/(?:alternativa|resposta|gabarito|letra|op[çc][aã]o)\s+(?:correta\s+)?(?:[eéÉ]\s+)?(?:a\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /\b([A-E])\s*[\)\.\-:]\s*(?:[Nn][aã]o\s+exige|[Ee]xige|[Pp]ermite|[Rr]equere?|[Dd]efine|[Rr]epresenta)/gi, /\bcorresponde\s+(?:[aà]\s+)?(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /(?:alternativa\s+correta\s+(?:[eéÉ]|seria)\s+(?:a\s+)?)([A-E])\b/gi];
    const explicitHits = [];
    for (const re of explicitPatterns) {
      for (const m of text.matchAll(re)) {
        const letter = (m[1] || '').toUpperCase();
        if (/^[A-E]$/.test(letter)) explicitHits.push(letter);
      }
    }
    const uniqueExplicit = [...new Set(explicitHits)];
    if (uniqueExplicit.length === 1) {
      const letter = uniqueExplicit[0];
      // Verify the letter exists in user's options
      if (originalOptionsMap && originalOptionsMap[letter]) {
        return {
          letter,
          confidence: 0.88
        };
      }
    }

    // Strategy 2: Check for "✅" or bold marker followed by letter
    const checkMarkPatterns = [/[✅✓☑]\s*(?:alternativa\s+|letra\s+)?([A-E])\b/gi, /(?:correta|certa|right|correct)\s*[:\-–]?\s*(?:alternativa\s+|letra\s+)?([A-E])\b/gi];
    for (const re of checkMarkPatterns) {
      const matches = [...text.matchAll(re)].map(m => (m[1] || '').toUpperCase()).filter(l => /^[A-E]$/.test(l));
      const unique = [...new Set(matches)];
      if (unique.length === 1 && originalOptionsMap?.[unique[0]]) {
        return {
          letter: unique[0],
          confidence: 0.85
        };
      }
    }

    // Strategy 3: Content-match — find which user option body is best contained in the text
    if (originalOptionsMap && Object.keys(originalOptionsMap).length >= 2) {
      const normText = QuestionParser.normalizeOption(text);
      let bestLetter = null;
      let bestScore = 0;
      let bestMethod = '';
      for (const [letter, body] of Object.entries(originalOptionsMap)) {
        const normBody = QuestionParser.normalizeOption(body);
        if (!normBody || normBody.length < 8) continue;

        // Containment check
        if (normText.includes(normBody)) {
          const score = normBody.length;
          if (score > bestScore) {
            bestScore = score;
            bestLetter = letter;
            bestMethod = 'containment';
          }
          continue;
        }

        // Dice similarity for partial matches
        const dice = QuestionParser.diceSimilarity(normText, normBody);
        // Only match on high Dice (the text should strongly talk about one option)
        if (dice >= 0.65 && dice * 100 > bestScore) {
          bestScore = dice * 100;
          bestLetter = letter;
          bestMethod = 'dice';
        }
      }
      if (bestLetter) {
        const conf = bestMethod === 'containment' ? 0.82 : 0.68;
        console.log(`SearchService: [google-meta] Content-match: letter=${bestLetter} method=${bestMethod} score=${bestScore}`);
        return {
          letter: bestLetter,
          confidence: conf
        };
      }
    }

    // Strategy 4: Fallback — try _parseAnswerLetter on the raw text
    const parsedLetter = this._parseAnswerLetter(text);
    if (parsedLetter && originalOptionsMap?.[parsedLetter]) {
      return {
        letter: parsedLetter,
        confidence: 0.70
      };
    }
    return null;
  },
  // Parses A) / B) / C) options from source text and returns {letter: body} map.
  // Handles line-by-line format AND inline "A) text B) text" format.
  _buildSourceOptionsMapFromText(sourceText) {
    if (!sourceText || sourceText.length < 30) return {};
    const map = {};
    const lines = sourceText.split('\n');
    let currentLetter = null;
    let currentParts = [];
    const flush = () => {
      if (currentLetter && currentParts.length > 0) {
        const body = currentParts.join(' ').replace(/\s+/g, ' ').trim();
        if (body.length >= 5) map[currentLetter] = body;
      }
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^([A-E])\s*[\)\.\-:]\s*(.*)$/i);
      if (m) {
        flush();
        currentLetter = m[1].toUpperCase();
        currentParts = m[2].trim() ? [m[2].trim()] : [];
      } else if (currentLetter) {
        if (/^(?:\d{1,3}\s*[\)\.\-:]|Aula\s+\d|Quest[a\u00e3]o\s+\d|Pergunta\s+\d)/i.test(trimmed)) {
          flush();
          currentLetter = null;
          currentParts = [];
        } else {
          currentParts.push(trimmed);
        }
      }
    }
    flush();
    // ── Fallback: inline option parsing (options concatenated on same line/few lines) ──
    // Handles: "...question stem... A) optA B) optB C) optC D) optD"
    if (Object.keys(map).length < 2) {
      const flat = sourceText.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ');
      // Split on letter-separator boundaries: looks for " A) " " B. " " C- " etc.
      const parts = flat.split(/\s(?=[A-E]\s*[\)\.\-:])/i);
      for (const part of parts) {
        const m2 = part.match(/^([A-E])\s*[\)\.\-:]\s*(.{4,})/i);
        if (m2) {
          const letter = m2[1].toUpperCase();
          if (!map[letter]) map[letter] = m2[2].trim().slice(0, 300).replace(/\s+/g, ' ');
        }
      }
    }
    return map;
  }

  // ▸▸▸ LETTER REMAPPING FOR SHUFFLED OPTIONS ▸▸▸
  // Smart-join PDF fragment texts: detects mid-word breaks (caused by
  // <span class="blank"> spacers) and joins WITHOUT a space when the
  // previous fragment ends with a letter and the next starts lowercase.

  // Content-based verification: after remapping, verify the highlighted text
  // actually matches the user's option at the resulting letter.
  // Returns { confidence, letter } — if the highlighted text doesn't match ANY
  // user option, returns null (reject the signal — wrong question anchored).
  // If it matches a DIFFERENT user option than remappedLetter, returns the correct one.

  // When a source has the same question but with options in a different order,
  // remap the source's letter to the user's letter by matching option text content.
  ,

  // Fallback remap: for each user option, finds its text in the source, looks back for a
  // letter label. Works regardless of source formatting — no structured option lines needed.
  _remapByReverseTextLookup(sourceLetter, sourceText, userOptionsMap) {
    if (!sourceLetter || !sourceText || !userOptionsMap) return sourceLetter;
    const userEntries = Object.entries(userOptionsMap);
    if (userEntries.length < 2) return sourceLetter;
    const normSource = QuestionParser.normalizeOption(sourceText);
    const sourceLetterForUser = {}; // userLetter → source letter label that precedes its text
    for (const [userLetter, userBody] of userEntries) {
      if (!userBody || userBody.length < 8) continue;
      const normUser = QuestionParser.normalizeOption(userBody);
      if (!normUser || normUser.length < 8) continue;
      // Try progressively shorter probes to locate option text in source
      for (const probeLen of [40, 25, 15]) {
        const probe = normUser.slice(0, Math.min(probeLen, normUser.length));
        if (probe.length < 8) break;
        const idx = normSource.indexOf(probe);
        if (idx < 0) continue;
        // Look back up to 30 chars for a letter marker ("A) ", "A. ", "A " etc.)
        const ctxBefore = normSource.slice(Math.max(0, idx - 30), idx + 2);
        const lm = ctxBefore.match(/\b([A-E])\s*[\)\.\- ]?\s*$/i);
        if (lm) { sourceLetterForUser[userLetter] = lm[1].toUpperCase(); break; }
      }
    }
    console.log(`    [reverseTextLookup] source=${sourceLetter} userToSourceMap=${JSON.stringify(sourceLetterForUser)}`);
    for (const [uLet, sLet] of Object.entries(sourceLetterForUser)) {
      if (sLet === sourceLetter) {
        if (uLet !== sourceLetter) console.log(`    [reverseTextLookup] REMAPPED: ${sourceLetter} \u2192 ${uLet}`);
        else console.log(`    [reverseTextLookup] CONFIRMED: ${sourceLetter}`);
        return uLet;
      }
    }
    console.log(`    [reverseTextLookup] NO REMAP for ${sourceLetter}`);
    return sourceLetter;
  },

  _remapLetterIfShuffled(sourceLetter, sourceText, userOptionsMap) {
    if (!sourceLetter || !userOptionsMap) return sourceLetter;
    if (Object.keys(userOptionsMap).length < 2) return sourceLetter;
    const sourceOptionsMap = sourceText ? this._buildSourceOptionsMapFromText(sourceText) : {};
    console.log(`    [remapIfShuffled] letter=${sourceLetter} sourceTextLen=${(sourceText || '').length} sourceOpts=${Object.keys(sourceOptionsMap).length} keys=[${Object.keys(sourceOptionsMap).join(',')}]`);
    if (Object.keys(sourceOptionsMap).length >= 2) {
      for (const [k, v] of Object.entries(sourceOptionsMap)) {
        console.log(`      src ${k}) "${v.slice(0, 70)}"`);
      }
      return OptionsMatchService.remapLetterToUserOptions(sourceLetter, sourceOptionsMap, userOptionsMap);
    }
    // Fallback: reverse-text lookup — find each user option's text in source, detect nearby letter label
    if (sourceText && sourceText.length >= 30) {
      console.log(`    [remapIfShuffled] FALLBACK to reverseTextLookup (sourceTextLen=${sourceText.length})`);
      return this._remapByReverseTextLookup(sourceLetter, sourceText, userOptionsMap);
    }
    console.log(`    [remapIfShuffled] SKIP: no usable source text for remap`);
    return sourceLetter;
  }

  // ═══ OPTION-BASED DISCRIMINATIVE TOKENS ═══
  // Extracts tokens from option bodies that are NOT present in the stem.
  // These tokens uniquely identify a specific question among many on the same topic.

  // ═══ DICE SIMILARITY (bigram) ═══
  // Character-bigram Dice coefficient: 0..1

  // ═══ QUESTION SIMILARITY SCORE ═══
  // Returns 0..1 score indicating how similar a source snippet is to the original question stem.
  // Used to gate Brainly and other weak sources Ã¢â‚¬â€ they must match the actual question.
  ,

  // ═══ CANONICAL QUESTION HASH ═══
  // Creates a stable hash from question + options for cache/dedup
  _canonicalizeQuestion(questionText) {
    const stem = QuestionParser.extractQuestionStem(questionText);
    const options = QuestionParser.extractOptionsFromQuestion(questionText);
    const normStem = QuestionParser.normalizeOption(stem).replace(/\s+/g, ' ').trim();
    const normOpts = (options || []).map(o => QuestionParser.normalizeOption(o).replace(/\s+/g, ' ').trim()).sort();
    return `${normStem}||${normOpts.join('|')}`;
  },
  async _canonicalHash(questionText) {
    const canonical = this._canonicalizeQuestion(questionText);
    // Use SubtleCrypto if available, else simple hash
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(canonical);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch {
        // fallback
      }
    }
    // Simple FNV-1a fallback
    let hash = 2166136261;
    for (let i = 0; i < canonical.length; i++) {
      hash ^= canonical.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  },
  async clearSearchCache(options = {}) {
    const {
      keepMetrics = true
    } = options || {};
    const payload = {
      [SearchCacheService.SEARCH_CACHE_KEY]: {}
    };
    if (!keepMetrics) payload[SearchCacheService.SEARCH_METRICS_KEY] = {};
    await SearchCacheService.storageSet(payload);
  },
  async _getCachedDecisionForFingerprint(questionFingerprint) {
    if (!questionFingerprint) return null;
    const bucket = await SearchCacheService._getDecisionCacheBucket();
    const entry = bucket?.[questionFingerprint];
    if (!entry || typeof entry !== 'object') return null;
    const age = Date.now() - Number(entry.updatedAt || 0);
    if (!Number.isFinite(age) || age < 0 || age > SearchCacheService.CACHE_MAX_AGE_MS) return null;
    const decision = entry.decision;
    if (!decision || decision.resultState !== 'confirmed') return null;
    if (decision.evidenceTier !== 'EVIDENCE_STRONG') return null;
    return decision;
  },
  async _setCachedDecisionForFingerprint(questionFingerprint, resultItem, sources = []) {
    if (!questionFingerprint || !resultItem) return;
    const bucket = await SearchCacheService._getDecisionCacheBucket();
    const now = Date.now();
    const sourceLinks = (sources || []).map(s => String(s?.link || '').trim()).filter(Boolean).slice(0, 12);
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
        sources: SearchCacheService.sanitizeSourcesForCache(sources)
      },
      sourceLinks
    };
    const keys = Object.keys(bucket);
    if (keys.length > SearchCacheService.CACHE_MAX_ENTRIES) {
      keys.map(k => ({
        k,
        t: Number(bucket[k]?.updatedAt || 0)
      })).sort((a, b) => a.t - b.t).slice(0, keys.length - SearchCacheService.CACHE_MAX_ENTRIES).forEach(entry => {
        delete bucket[entry.k];
      });
    }
    await SearchCacheService._setDecisionCacheBucket(bucket);
  },
  async _mergeCachedSourcesIntoResults(questionFingerprint, results = []) {
    const cachedLinks = await SearchCacheService.getCachedSourceLinks(questionFingerprint);
    if (!cachedLinks || cachedLinks.length === 0) return results || [];
    const merged = new Map();
    for (const item of results || []) {
      const link = String(item?.link || '').trim();
      if (!link) continue;
      if (!merged.has(link)) merged.set(link, item);
    }
    for (const link of cachedLinks) {
      if (merged.has(link)) continue;
      merged.set(link, {
        title: 'Cached source',
        snippet: '',
        link,
        fromCache: true
      });
    }
    return Array.from(merged.values());
  },
  _buildResultFromCachedDecision(questionText, questionForInference, cachedDecision) {
    const answerLetter = String(cachedDecision?.answerLetter || cachedDecision?.bestLetter || '').toUpperCase();
    const answerText = String(cachedDecision?.answerText || '').trim();
    const answer = String(cachedDecision?.answer || '').trim() || (answerLetter ? `Letra ${answerLetter}: ${answerText}`.trim() : '');
    return [{
      question: questionText,
      answer,
      answerLetter,
      answerText,
      sources: Array.isArray(cachedDecision?.sources) ? cachedDecision.sources : [],
      bestLetter: String(cachedDecision?.bestLetter || answerLetter || ''),
      votes: cachedDecision?.votes || {},
      baseVotes: cachedDecision?.baseVotes || {},
      evidenceVotes: cachedDecision?.evidenceVotes || {},
      evidenceConsensus: cachedDecision?.evidenceConsensus || {},
      confidence: Number(cachedDecision?.confidence || 0.9),
      resultState: String(cachedDecision?.resultState || 'confirmed'),
      reason: String(cachedDecision?.reason || 'confirmed_by_sources'),
      evidenceTier: String(cachedDecision?.evidenceTier || 'EVIDENCE_STRONG'),
      questionPolarity: String(cachedDecision?.questionPolarity || QuestionParser.detectQuestionPolarity(QuestionParser.extractQuestionStem(questionForInference || questionText))),
      title: 'Cached verified result',
      aiFallback: false,
      cacheHit: true,
      runStats: {
        analyzed: 0,
        acceptedForVotes: 0,
        acceptedForAiEvidence: 0,
        blockedPaywall: 0,
        blockedObfuscation: 0,
        blockedOptionsMismatch: 0,
        blockedSnapshotMismatch: 0,
        blockedByError: 0
      }
    }];
  },
  async _recordSearchMetrics(payload = {}) {
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
      const data = await SearchCacheService.storageGet([SearchCacheService.SEARCH_METRICS_KEY]);
      const metrics = data?.[SearchCacheService.SEARCH_METRICS_KEY] || {
        totalRuns: 0,
        cacheHits: 0,
        outcomes: {},
        resultStates: {},
        evidenceTiers: {},
        blocked: {
          paywall: 0,
          obfuscation: 0,
          optionsMismatch: 0,
          snapshotMismatch: 0,
          errors: 0
        },
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
      await SearchCacheService.storageSet({
        [SearchCacheService.SEARCH_METRICS_KEY]: metrics
      });
    } catch {
      // no-op
    }
  },
  _getHostHintFromLink(link) {
    try {
      const u = new URL(link);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'webcache.googleusercontent.com') {
        const q = u.searchParams.get('q') || '';
        const m = q.match(/cache:(.+)$/i);
        if (m) {
          const decoded = decodeURIComponent(m[1]);
          const inner = new URL(decoded);
          return inner.hostname.replace(/^www\./, '').toLowerCase();
        }
      }
      return host;
    } catch {
      return '';
    }
  }

  // ═══ POLARITY DETECTION ═══

  // ═══ FINGERPRINT-BASED QUESTION BLOCK FINDING ═══

  // ═══ RANKED CANDIDATE SELECTION ═══
  /**
   * Extract a chunk of raw HTML centered on the user's question.
   * Used to send HTML+CSS to AI so it can detect visual highlights
   * without hardcoded class names.
   */

  // ═══ ENHANCED EXPLICIT GABARITO EXTRACTION (polarity-aware) ═══

  // ═══ LOCAL ANSWER EXTRACTION ═══

  /**
   * Explanation-to-option content matching.
   * Many educational sources contain explanatory text AFTER the question that describes
   * WHY a given option is correct, without explicitly stating "Gabarito: X".
   * This method extracts such explanation blocks and matches them back to the user's options
   * using keyword/concept overlap.
   *
   * Example: "...devido ao fato de que seu suporte ao processamento não segue o modelo
   * clássico de transações..." → matches option E: "Ter suporte de transações diferente do relacional"
   */
  // --- LOCAL HALLUCINATION GUARD ---
  ,

  // ═══ MATCH QUALITY COMPUTATION ═══
  computeMatchQuality(sourceText, questionText, originalOptions, originalOptionsMap) {
    let quality = 0;
    const block = EvidenceService.findQuestionBlock(sourceText, questionText);
    if (block) quality += block.method === 'fingerprint' ? 3 : 2;
    if (originalOptions && originalOptions.length >= 2) {
      const sourceOptions = [];
      const optRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/gim;
      let om;
      while ((om = optRe.exec(sourceText)) !== null) {
        sourceOptions.push(`${om[1].toUpperCase()}) ${om[2].trim()}`);
      }
      if (OptionsMatchService.optionsMatch(originalOptions, sourceOptions)) quality += 2;
    }
    const gabarito = EvidenceService.extractExplicitGabarito(sourceText, questionText);
    if (gabarito) quality += 3;
    return Math.min(quality, 10);
  },
  _selectDiverseTopResults(results, options = {}) {
    const limit = Math.max(1, Number(options.limit) || 10);
    const initialWindow = Math.max(limit, Number(options.initialWindow) || 18);
    const maxPerHost = Math.max(1, Number(options.maxPerHost) || 1);

    const pool = (Array.isArray(results) ? results : [])
      .filter(item => item && String(item.link || '').trim())
      .slice(0, initialWindow);

    if (pool.length <= 1) {
      return {
        selected: pool.slice(0, limit),
        stats: {
          totalPool: pool.length,
          uniqueHosts: pool.length,
          cappedHosts: 0,
          duplicatesDropped: 0
        }
      };
    }

    const selected = [];
    const seenLinks = new Set();
    const hostCounts = new Map();

    const pushResult = (item, ignoreHostCap = false) => {
      if (!item) return false;
      const link = String(item.link || '').trim();
      if (!link || seenLinks.has(link)) return false;
      const host = this._getHostHintFromLink(link);
      const hostCount = host ? (hostCounts.get(host) || 0) : 0;
      if (!ignoreHostCap && host && hostCount >= maxPerHost) return false;

      selected.push(item);
      seenLinks.add(link);
      if (host) hostCounts.set(host, hostCount + 1);
      return true;
    };

    // Pass 1: maximize host diversity (one result per host).
    const seenHosts = new Set();
    for (const item of pool) {
      if (selected.length >= limit) break;
      const host = this._getHostHintFromLink(item.link);
      if (!host || seenHosts.has(host)) continue;
      if (pushResult(item, true)) seenHosts.add(host);
    }

    // Pass 2: fill remaining slots with host cap applied.
    for (const item of pool) {
      if (selected.length >= limit) break;
      pushResult(item, false);
    }

    // Pass 3 fallback: if still short, allow extra same-host links.
    for (const item of pool) {
      if (selected.length >= limit) break;
      pushResult(item, true);
    }

    const uniqueHosts = new Set(selected.map(item => this._getHostHintFromLink(item.link)).filter(Boolean)).size;
    const cappedHosts = [...hostCounts.values()].filter(v => v > 1).length;
    const duplicatesDropped = Math.max(0, Math.min(limit, pool.length) - selected.length);

    return {
      selected: selected.slice(0, limit),
      stats: {
        totalPool: pool.length,
        uniqueHosts,
        cappedHosts,
        duplicatesDropped
      }
    };
  },
  _logSourceDiagnostic(diag) {
    if (!diag) return;
    const host = diag.hostHint || 'unknown';
    const type = diag.type || 'TYPE_UNKNOWN';
    const phase = diag.phase || 'info';
    const sim = Number.isFinite(diag.topicSim) ? diag.topicSim.toFixed(2) : 'n/a';
    const opts = diag.optionsMatch === undefined ? 'n/a' : diag.optionsMatch ? 'ok' : 'mismatch';
    const obf = diag.obfuscation?.isObfuscated ? `yes(vr=${(diag.obfuscation.vowelRatio || 0).toFixed(2)},jr=${(diag.obfuscation.junkRatio || 0).toFixed(2)},cr=${(diag.obfuscation.consonantRunRatio || 0).toFixed(3)},lcr=${diag.obfuscation.longConsonantRuns || 0})` : 'no';
    const paywall = diag.paywall?.isPaywalled ? `yes(m=${diag.paywall.markerHits || 0})` : 'no';
    const reason = diag.reason ? ` reason=${diag.reason}` : '';
    const decision = diag.decision ? ` decision=${diag.decision}` : '';
    const method = diag.method ? ` method=${diag.method}` : '';
    const letter = diag.letter ? ` letter=${diag.letter}` : '';
    const textLen = Number.isFinite(diag.textLength) ? ` text=${diag.textLength}` : '';
    console.log(`SearchService: SourceDiag[${phase}] host=${host} type=${type} sim=${sim} opts=${opts} obf=${obf} pw=${paywall}${textLen}${decision}${method}${letter}${reason}`);
  },
  async searchOnly(questionText) {
    const results = await ApiService.searchWithSerper(questionText);
    const fingerprint = await this._canonicalHash(questionText || '');
    return this._mergeCachedSourcesIntoResults(fingerprint, results || []);
  },
  async answerFromAi(questionText) {
    const extractedOptions = QuestionParser.extractOptionsFromQuestion(questionText);
    const optionLetters = extractedOptions.map(line => {
      const m = String(line || '').match(/^([A-E])\)/i);
      return (m?.[1] || '').toUpperCase();
    }).filter(Boolean);
    const hasOptions = extractedOptions.length >= 2;
    const hasReliableOptions = extractedOptions.length >= 3 && optionLetters[0] === 'A' && optionLetters[1] === 'B' && optionLetters.every((letter, index) => letter.charCodeAt(0) === 'A'.charCodeAt(0) + index);
    if (hasOptions && !hasReliableOptions) {
      return [{
        question: questionText,
        answer: 'INCONCLUSIVO: alternativas malformadas na captura (OCR/DOM).',
        answerLetter: null,
        answerText: 'Alternativas malformadas na captura (OCR/DOM).',
        aiFallback: true,
        evidenceTier: 'AI_ONLY',
        resultState: 'inconclusive',
        reason: 'malformed_options',
        confidence: 0.12,
        votes: undefined,
        sources: []
      }];
    }
    const aiAnswer = await ApiService.generateAnswerFromQuestion(questionText);
    if (!aiAnswer) {
      if (hasOptions) {
        return [{
          question: questionText,
          answer: 'INCONCLUSIVO: sem evidência externa confiável para marcar alternativa.',
          answerLetter: null,
          answerText: 'Sem evidência externa confiável para marcar alternativa.',
          aiFallback: true,
          evidenceTier: 'AI_ONLY',
          resultState: 'inconclusive',
          reason: 'inconclusive',
          confidence: 0.15,
          votes: undefined,
          sources: []
        }];
      }
      return [];
    }
    const answerLetter = this._parseAnswerLetter(aiAnswer);
    const answerText = this._parseAnswerText(aiAnswer);

    // If AI returns INCONCLUSIVO, respect it
    if (!answerLetter && /INCONCLUSIVO/i.test(aiAnswer)) {
      return [{
        question: questionText,
        answer: aiAnswer,
        answerLetter: null,
        answerText: 'Sem evidência suficiente para marcar alternativa.',
        aiFallback: true,
        evidenceTier: 'AI_ONLY',
        resultState: 'inconclusive',
        reason: 'inconclusive',
        confidence: 0.15,
        votes: undefined,
        sources: []
      }];
    }
    const optionsMap = this._buildOptionsMap(questionText);
    return [{
      question: questionText,
      answer: aiAnswer,
      answerLetter,
      answerText,
      aiReasoning: aiAnswer,
      optionsMap: Object.keys(optionsMap).length >= 2 ? optionsMap : null,
      aiFallback: true,
      evidenceTier: 'AI_ONLY',
      resultState: answerLetter ? 'suggested' : 'inconclusive',
      reason: answerLetter ? 'ai_knowledge' : 'inconclusive',
      confidence: answerLetter ? 0.55 : 0.15,
      votes: answerLetter ? {
        [answerLetter]: 1
      } : undefined,
      sources: []
    }];
  },
  // Flow 1: process extracted items (Extract button)
  async processExtractedItems(items) {
    const refinedData = [];
    for (const item of items) {
      const refined = await ApiService.refineWithGroq(item);
      if (refined) refinedData.push(refined);
    }
    return refinedData;
  },
  // Flow 2: Google search + evidence-based refine (Search button)
  async refineFromResults(questionText, results, originalQuestionWithOptions = '', onStatus = null, pageGabarito = null) {
    if (!results || results.length === 0) return [];

    // Reset webcache 429 tracking for this search session.
    ApiService.resetWebcache429();

    // Load AI extraction result cache (no-op if already loaded this session).
    await SearchCacheService.loadAiResultCache();
    const sources = [];
    const {
      selected: topResults,
      stats: topResultsDiversity
    } = this._selectDiverseTopResults(results, {
      limit: 10,
      initialWindow: 18,
      maxPerHost: 1
    });
    console.log(`SearchService: Top results diversified => selected=${topResults.length}, uniqueHosts=${topResultsDiversity.uniqueHosts}/${topResultsDiversity.totalPool}, hostsWithDuplicates=${topResultsDiversity.cappedHosts}`);
    const questionForInference = originalQuestionWithOptions || questionText;
    const questionStem = QuestionParser.extractQuestionStem(questionForInference);
    const questionFingerprint = await this._canonicalHash(questionForInference);
    const originalOptions = QuestionParser.extractOptionsFromQuestion(questionForInference);
    const originalOptionsMap = this._buildOptionsMap(questionForInference);
    const hasOptions = originalOptions && originalOptions.length >= 2;

    // ═══ Detect question polarity ═══
    const questionPolarity = QuestionParser.detectQuestionPolarity(questionStem);
    console.log(`SearchService: Polarity detected: ${questionPolarity}`);

    // ═══ DEBUG: Pipeline Start ═══
    console.group('🔍 SearchService DEBUG — Pipeline Start');
    console.log('Question stem:', questionStem.slice(0, 120));
    console.log('Options extracted:', originalOptions);
    console.log('Has options:', hasOptions, '| Options count:', originalOptions.length);
    console.log('Options map:', originalOptionsMap);
    console.log('Total results to analyze:', topResults.length);
    console.groupEnd();
    const domainWeights = {
      'qconcursos.com': 2.5,
      'qconcursos.com.br': 2.5,
      'passeidireto.com': 1.4,
      'studocu.com': 1.3,
      'brainly.com.br': 0.9,
      'brainly.com': 0.9,
      'brainly.lat': 0.9
    };
    const riskyCombinedHosts = new Set(['passeidireto.com', 'brainly.com.br', 'brainly.com', 'scribd.com', 'pt.scribd.com']);
    const trustedCombinedHosts = new Set(['qconcursos.com', 'qconcursos.com.br', 'google', 'studocu.com', 'meuguru.com']);
    const isTrustedCombinedHost = host => {
      const h = String(host || '').toLowerCase();
      if (!h) return false;
      return trustedCombinedHosts.has(h) || h.endsWith('.gov.br') || h.endsWith('.edu.br');
    };
    const hasStrongOptionCoverage = coverage => {
      if (!hasOptions) return true;
      if (!coverage || !coverage.hasEnoughOptions || !coverage.total) return false;
      return coverage.ratio >= 0.55 || coverage.hits >= Math.min(3, coverage.total || 3);
    };
    const hasMediumOptionCoverage = coverage => {
      if (!hasOptions) return true;
      if (!coverage || !coverage.hasEnoughOptions || !coverage.total) return false;
      return coverage.ratio >= 0.34 || coverage.hits >= Math.min(2, coverage.total || 2);
    };
    const hasVeryStrongOptionCoverage = coverage => {
      if (!hasOptions) return true;
      if (!coverage || !coverage.hasEnoughOptions || !coverage.total) return false;
      return coverage.ratio >= 0.74 || coverage.hits >= Math.min(4, coverage.total || 4);
    };
    const getDomainWeight = link => {
      try {
        const host = this._getHostHintFromLink(link);
        return domainWeights[host] || 1.0;
      } catch {
        return 1.0;
      }
    };
    const extractExplicitAnswerTextCandidates = rawText => {
      if (!rawText) return [];
      const lines = String(rawText || '').replace(/\r/g, '\n').split('\n').map(l => String(l || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      const candidates = [];
      const seen = new Set();
      const addCandidate = value => {
        let cleaned = String(value || '').replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();
        cleaned = cleaned.replace(/^([A-E])\s*[\)\.\-:]\s*/i, '').trim();
        if (cleaned.length < 18) return;
        const key = QuestionParser.normalizeOption(cleaned);
        if (!key || key.length < 12 || seen.has(key)) return;
        seen.add(key);
        candidates.push(cleaned);
      };
      const isNoiseLine = line => /^(?:\d+\s+pessoas?\b|aluno\b|entrar\b|anuncio\b|bloqueador\b|avaliacao\b|coment[aá]rio\b|novas?\s+perguntas\b|ainda\s+tem\s+perguntas\b|para\s+estudantes\b|para\s+pais\b|codigo\s+de\s+conduta\b|resposta\s*:?\s*$|explica[cç][aã]o\s*:?\s*$)$/i.test(String(line || '').trim());

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        const inlineMatch = line.match(/^(?:resposta|resposta\s+correta|alternativa\s+correta)\s*[:\-]\s*(.+)$/i);
        if (inlineMatch?.[1]) addCandidate(inlineMatch[1]);

        const markerOnly = /^(?:resposta|resposta\s+correta|alternativa\s+correta)\s*[:\-]?\s*$/i.test(line);
        if (markerOnly) {
          for (let j = i + 1; j < Math.min(lines.length, i + 9); j++) {
            const nextLine = lines[j];
            if (!nextLine || isNoiseLine(nextLine)) continue;
            if (/^(?:pergunta|quest[aã]o)\b/i.test(nextLine)) break;
            addCandidate(nextLine);
            break;
          }
        }
      }
      return candidates.slice(0, 5);
    };
    const tryMapTextAnswerCandidate = (candidateText, hostHint, topicSim) => {
      if (!hasOptions || !candidateText || !originalOptionsMap || Object.keys(originalOptionsMap).length < 2) return null;
      const host = String(hostHint || '').toLowerCase();
      const risky = riskyCombinedHosts.has(host);
      const minTopicSim = risky ? 0.72 : 0.58;
      if ((topicSim || 0) < minTopicSim) return null;

      const mapped = OptionsMatchService.matchAnswerTextToOptions(candidateText, originalOptionsMap);
      if (!mapped?.letter) return null;

      const minConfidence = risky ? 0.86 : 0.72;
      const minMargin = risky ? 0.14 : 0.10;
      if ((mapped.confidence || 0) < minConfidence) return null;
      if ((mapped.margin || 0) < minMargin) return null;
      return mapped;
    };
    const addTextMappedSource = ({
      title,
      link,
      hostHint,
      sourceType,
      topicSim,
      obfuscation,
      mapped,
      evidenceText,
      methodTag
    }) => {
      const baseWeight = getDomainWeight(link);
      const risky = riskyCombinedHosts.has(String(hostHint || '').toLowerCase());
      const weight = baseWeight + (risky ? 0.95 : 1.25) + (mapped.confidence || 0.7) * 0.35;
      const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
      const evidenceBlock = EvidenceService.buildEvidenceBlock({
        questionFingerprint,
        sourceId,
        sourceLink: link,
        hostHint,
        evidenceText: evidenceText || mapped.matchedBody || '',
        originalOptionsMap,
        explicitLetter: mapped.letter,
        confidenceLocal: mapped.confidence || 0.75,
        evidenceType: 'textual-answer-map'
      });
      sources.push({
        title,
        link,
        letter: mapped.letter,
        weight,
        evidenceType: 'textual-answer-map',
        questionPolarity,
        matchQuality: Math.min(10, Math.round((mapped.score || 0) * 10)),
        hostHint,
        sourceId,
        evidenceBlock
      });
      runStats.acceptedForVotes += 1;
      this._logSourceDiagnostic({
        phase: 'decision',
        hostHint,
        type: sourceType,
        topicSim,
        optionsMatch: false,
        obfuscation,
        decision: 'use-textual-answer-map',
        method: methodTag || mapped.method || 'textual-answer-map',
        letter: mapped.letter
      });
      console.log(`  ✅ [TEXT-MAP] accepted letter=${mapped.letter} via ${methodTag || mapped.method} conf=${(mapped.confidence || 0).toFixed(2)} margin=${(mapped.margin || 0).toFixed(2)} weight=${weight.toFixed(2)}`);
    };
    const aiEvidence = [];
    const collectedForCombined = [];
    let aiExtractionCount = 0; // max AI per-page extraction calls per search run
    let aiHtmlExtractionCount = 0; // max AI HTML extraction calls per search run
    const aiKnowledgePool = []; // Accumulated knowledge from AI extraction (partial + full)
    // Mismatch sources deferred for post-loop AI extraction (avoids blocking the main analysis loop)
    const _pendingMismatchAI = [];
    const runStats = {
      analyzed: 0,
      acceptedForVotes: 0,
      acceptedForAiEvidence: 0,
      blockedPaywall: 0,
      blockedObfuscation: 0,
      blockedOptionsMismatch: 0,
      blockedSnapshotMismatch: 0,
      blockedByError: 0,
      acceptedViaAiExtraction: 0
    };
    const logRunSummary = (outcome = 'finished') => {
      console.log(`SearchService: RunSummary outcome=${outcome} analyzed=${runStats.analyzed} acceptedVotes=${runStats.acceptedForVotes} acceptedAi=${runStats.acceptedForAiEvidence} aiExtraction=${runStats.acceptedViaAiExtraction} knowledgePool=${aiKnowledgePool.length} blockedPaywall=${runStats.blockedPaywall} blockedObf=${runStats.blockedObfuscation} blockedMismatch=${runStats.blockedOptionsMismatch} blockedSnapshotMismatch=${runStats.blockedSnapshotMismatch} blockedErrors=${runStats.blockedByError}`);
    };

    // ═══ GOOGLE AI OVERVIEW / ANSWER BOX / PEOPLE ALSO ASK ═══
    // Process Serper meta signals (answerBox, aiOverview, peopleAlsoAsk)
    // as high-priority evidence BEFORE iterating page sources.
    // These come for free with the Serper API response.
    const serperMeta = results._serperMeta || null;
    const searchProvider = results._searchProvider || 'serper';
    const googleMetaSignals = {
      provider: searchProvider,
      answerBox: !!serperMeta?.answerBox,
      aiOverview: !!serperMeta?.aiOverview,
      peopleAlsoAsk: Array.isArray(serperMeta?.peopleAlsoAsk) ? serperMeta.peopleAlsoAsk.length > 0 : !!serperMeta?.peopleAlsoAsk
    };
    if (serperMeta && hasOptions) {
      console.group('🌐 Google Meta Signals (answerBox / AI Overview / PAA)');
      console.log('answerBox:', serperMeta.answerBox ? 'present' : 'absent');
      console.log('aiOverview:', serperMeta.aiOverview ? 'present' : 'absent');
      console.log('peopleAlsoAsk:', serperMeta.peopleAlsoAsk ? `${serperMeta.peopleAlsoAsk.length} entries` : 'absent');
      const googleMeta = this._extractLetterFromGoogleMeta(serperMeta, questionStem, originalOptionsMap, originalOptions);
      if (googleMeta?.letter) {
        const googleWeight = googleMeta.method === 'google-ai-overview' ? 3.8 : googleMeta.method === 'google-answerbox' ? 3.2 : 1.8; // PAA
        const confFactor = Math.max(0.5, Math.min(1.0, googleMeta.confidence || 0.75));
        const adjustedWeight = googleWeight * confFactor;
        const sourceId = `google-meta:${sources.length + 1}`;
        const evidenceBlock = EvidenceService.buildEvidenceBlock({
          questionFingerprint,
          sourceId,
          sourceLink: '',
          hostHint: 'google',
          evidenceText: googleMeta.evidence || '',
          originalOptionsMap,
          explicitLetter: googleMeta.letter,
          confidenceLocal: googleMeta.confidence || 0.75,
          evidenceType: googleMeta.method
        });
        sources.push({
          title: `Google ${googleMeta.method === 'google-ai-overview' ? 'AI Overview' : googleMeta.method === 'google-answerbox' ? 'Answer Box' : 'PAA'}`,
          link: '',
          letter: googleMeta.letter,
          weight: adjustedWeight,
          evidenceType: googleMeta.method,
          questionPolarity,
          matchQuality: 8,
          hostHint: 'google',
          sourceId,
          evidenceBlock
        });
        runStats.acceptedForVotes += 1;
        console.log(`  ✅ Google meta ACCEPTED: letter=${googleMeta.letter} method=${googleMeta.method} weight=${adjustedWeight.toFixed(2)} confidence=${(googleMeta.confidence || 0).toFixed(2)}`);
      } else {
        console.log('  ℹ️ No answer letter extracted from Google meta signals');
        // Still collect answerBox/aiOverview text as evidence for AI combined
        const metaTexts = [];
        if (serperMeta.answerBox) {
          const abText = [serperMeta.answerBox.title, serperMeta.answerBox.snippet, serperMeta.answerBox.answer].filter(Boolean).join(' ').trim();
          if (abText.length >= 40) metaTexts.push(abText);
        }
        if (serperMeta.aiOverview) {
          let aioText = '';
          if (typeof serperMeta.aiOverview === 'string') aioText = serperMeta.aiOverview;else if (serperMeta.aiOverview.text_blocks) aioText = this._flattenAiOverviewBlocks(serperMeta.aiOverview.text_blocks);else if (serperMeta.aiOverview.snippet) aioText = serperMeta.aiOverview.snippet;
          if (aioText.length >= 40) metaTexts.push(aioText);
        }
        if (metaTexts.length > 0) {
          const combinedMeta = metaTexts.join('\n\n').slice(0, 3000);
          const topicSim = QuestionParser.questionSimilarityScore(combinedMeta, questionStem);
          if (topicSim >= 0.25) {
            collectedForCombined.push({
              title: 'Google AI Overview / Answer Box',
              link: '',
              text: combinedMeta,
              topicSim,
              optionsMatch: true,
              optionsCoverage: {
                hits: 0,
                total: 0,
                ratio: 0,
                hasEnoughOptions: false
              },
              hostHint: 'google',
              obfuscated: false,
              paywalled: false
            });
            console.log(`  📝 Google meta text collected for AI combined (topicSim=${topicSim.toFixed(2)}, len=${combinedMeta.length})`);
          }
        }
      }
      console.groupEnd();
    }

    // ═══ BATCHED PAGE FETCH (with cross-search cache) ═══
    // Fetch in 2 batches: first 5 results (usually contain the answer), then
    // remaining 5 only if no strong answer found. Saves 2-4s when batch 1 suffices.
    // Also reuses snapshots from previous searches (5-min TTL, max 30 URLs).
    const _cacheNow = Date.now();
    for (const [_cUrl, _cEntry] of SearchCacheService.snapshotCache) {
      if (_cacheNow - _cEntry.fetchedAt > SearchCacheService.SNAPSHOT_CACHE_TTL) {
        SearchCacheService.snapshotCache.delete(_cUrl);
      }
    }
    const _prefetchedSnaps = new Map();
    let _cacheHits = 0;
    for (const r of topResults) {
      const cached = SearchCacheService.snapshotCache.get(r.link);
      if (cached) {
        _prefetchedSnaps.set(r.link, cached.snap);
        _cacheHits++;
        try {
          console.log(`  📦 [cache-hit] ${new URL(r.link).hostname} (age=${Math.round((_cacheNow - cached.fetchedAt) / 1000)}s)`);
        } catch (_) {/* invalid URL */}
      }
    }
    const _BATCH_SIZE = 5;
    const _storeFetchInCache = () => {
      for (const [_sUrl, _sSnap] of _prefetchedSnaps) {
        if (_sSnap?.ok && !SearchCacheService.snapshotCache.has(_sUrl)) {
          if (SearchCacheService.snapshotCache.size >= SearchCacheService.SNAPSHOT_CACHE_MAX) {
            const oldest = [...SearchCacheService.snapshotCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
            if (oldest) SearchCacheService.snapshotCache.delete(oldest[0]);
          }
          SearchCacheService.snapshotCache.set(_sUrl, {
            snap: _sSnap,
            fetchedAt: _cacheNow
          });
        }
      }
    };
    const _fetchBatch = async batch => {
      const toFetch = batch.filter(r => !_prefetchedSnaps.has(r.link));
      if (toFetch.length === 0) return;
      let idx = 0;
      const workers = Array.from({
        length: Math.min(5, toFetch.length)
      }, async () => {
        while (idx < toFetch.length) {
          const r = toFetch[idx++];
          try {
            const snap = await ApiService.fetchPageSnapshot(r.link, {
              timeoutMs: 4500,
              maxHtmlChars: 1500000,
              maxTextChars: 12000
            });
            _prefetchedSnaps.set(r.link, snap);
          } catch (e) {
            _prefetchedSnaps.set(r.link, null);
          }
        }
      });
      await Promise.all(workers);
    };

    // Batch 1: first 5 results
    const batch1 = topResults.slice(0, _BATCH_SIZE);
    const batch2 = topResults.slice(_BATCH_SIZE);
    if (typeof onStatus === 'function') {
      const cached = batch1.filter(r => _prefetchedSnaps.has(r.link)).length;
      const fetching = batch1.length - cached;
      onStatus(fetching > 0 ? `Fetching batch 1/${batch2.length > 0 ? '2' : '1'} (${fetching} sources${cached > 0 ? `, ${cached} cached` : ''})...` : `Analyzing ${batch1.length} cached sources...`);
    }
    await _fetchBatch(batch1);
    _storeFetchInCache();
    console.log(`SearchService: Batch 1 fetch complete — ${_prefetchedSnaps.size} pages ready (${_cacheHits} from cache)`);
    let _batch2Fetched = batch2.length === 0;
    for (const result of topResults) {
      // Batch 2 trigger: after analyzing batch 1, check if we need more sources
      if (!_batch2Fetched && runStats.analyzed >= _BATCH_SIZE) {
        const {
          bestLetter,
          votes
        } = EvidenceService.computeVotesAndState(sources);
        const topVote = bestLetter ? votes[bestLetter] || 0 : 0;
        if (bestLetter && topVote >= 5.5) {
          console.log(`SearchService: ⚡ Batch 1 sufficient — skipping batch 2 (votes[${bestLetter}]=${topVote.toFixed(1)})`);
          _batch2Fetched = true; // skip fetch, but still mark as handled
          break; // exit analysis loop early
        }
        // Need more evidence — fetch batch 2
        console.log(`SearchService: Batch 1 insufficient (topVote=${topVote.toFixed(1)}) — fetching batch 2 (${batch2.length} sources)...`);
        if (typeof onStatus === 'function') {
          onStatus(`Fetching batch 2 (${batch2.length} more sources)...`);
        }
        await _fetchBatch(batch2);
        _storeFetchInCache();
        console.log(`SearchService: Batch 2 fetch complete — ${_prefetchedSnaps.size} total pages ready`);
        _batch2Fetched = true;
      }
      try {
        const snippet = result.snippet || '';
        const title = result.title || '';
        const link = result.link;
        runStats.analyzed += 1;
        if (typeof onStatus === 'function') {
          onStatus(`Analyzing source ${runStats.analyzed}/${topResults.length}...`);
        }
        const snap = _prefetchedSnaps.get(link) || null;
        const pageText = (snap?.text || '').trim();
        const combinedText = `${title}. ${snippet}\n\n${pageText}`.trim();
        const scopedCombinedText = EvidenceService.buildQuestionScopedText(combinedText, questionForInference, 3600);
        console.log(`  📐 scopedCombinedText length=${scopedCombinedText.length} (full combined=${combinedText.length}) preview="${scopedCombinedText.slice(0, 200)}"`);
        const seedText = `${title}. ${snippet}`.trim();
        const snapshotWeak = !snap?.ok || pageText.length < 120;
        if (snapshotWeak && hasOptions) {
          const seedCoverage = OptionsMatchService.optionsCoverageInFreeText(originalOptions, seedText);
          const seedTopicSim = QuestionParser.questionSimilarityScore(seedText, questionStem);
          // When topicSim is very high (the snippet clearly describes the same question),
          // relax the option coverage requirement — the snippet may simply be truncated.
          const highTopicSim = seedTopicSim >= 0.85;
          const minHitsForStrong = highTopicSim ? Math.min(2, seedCoverage.total || 2) : Math.min(4, seedCoverage.total || 4);
          const minRatioForStrong = highTopicSim ? 0.35 : 0.8;
          const seedStrongMatch = (seedCoverage.ratio >= minRatioForStrong || seedCoverage.hits >= minHitsForStrong) && seedTopicSim >= 0.55;
          if (!seedStrongMatch) {
            // Escape hatch: if the snippet itself contains an explicit gabarito signal and the question
            // topic similarity is reasonable, let the source through so the evidence pipeline can use it.
            // This handles cases where webcache is rate-limited and only snippet is available, yet the
            // snippet already reveals the answer (e.g. "a resposta correta é a alternativa D").
            const snapGab = EvidenceService.extractExplicitGabarito(seedText, questionStem);
            let snippetAnswerLetter = null;
            if (!snapGab?.letter && originalOptionsMap && Object.keys(originalOptionsMap).length >= 2) {
              const markerMatch = seedText.match(/(?:\bR(?:esposta)?\s*[:\-]\s*|resposta\s+correta\s*(?:e|é)\s*[:\-]?\s*)([A-Za-z0-9_.+\-]{2,40})/i);
              if (markerMatch && markerMatch[1]) {
                snippetAnswerLetter = OptionsMatchService.findLetterByAnswerText(String(markerMatch[1]).trim(), originalOptionsMap);
              }
            }
            const bypassLetter = snapGab?.letter || snippetAnswerLetter;
            if (bypassLetter && seedTopicSim >= 0.50) {
              console.log(`  ✅ Source #${runStats.analyzed} (${this._getHostHintFromLink(link)}): snapshot-gabarito-bypass letter=${bypassLetter} topicSim=${seedTopicSim.toFixed(2)} (option coverage low but explicit answer marker found in snippet)`);
              // fall through — let the evidence pipeline extract the gabarito from scopedCombinedText
            } else {
              console.log(`\u26d4 Source #${runStats.analyzed} (${this._getHostHintFromLink(link)}): snapshot-empty-options-mismatch (seedCoverage: ${seedCoverage.hits}/${seedCoverage.total})`);
              runStats.blockedSnapshotMismatch += 1;
              this._logSourceDiagnostic({
                phase: 'decision',
                hostHint: this._getHostHintFromLink(link),
                type: 'TYPE_SNAPSHOT_WEAK',
                topicSim: seedTopicSim,
                optionsMatch: false,
                obfuscation: null,
                decision: 'skip',
                reason: 'snapshot-empty-options-mismatch'
              });
              continue;
            }
          }
        }
        const hostHint = this._getHostHintFromLink(link);
        const htmlText = snap?.html || '';
        const parsedForDiag = HtmlExtractorService.parseHtmlDom(htmlText);
        const sourceType = HtmlExtractorService.detectHtmlType(htmlText, parsedForDiag.doc);
        const docText = HtmlExtractorService.extractDocText(parsedForDiag.doc);
        const obfuscation = HtmlExtractorService.obfuscationSignals(docText);
        let paywall = HtmlExtractorService.paywallSignals(htmlText, docText, hostHint);
        const topicSimBase = QuestionParser.questionSimilarityScore(combinedText, questionStem);

        // ═══ DEBUG: Source Fetch ═══
        console.group(`📄 Source #${runStats.analyzed}: ${hostHint}`);
        console.log('Link:', link);
        console.log('Fetch OK:', snap?.ok, '| HTML length:', htmlText.length, '| Text length:', pageText.length);
        console.log('Source type:', sourceType);
        console.log('Topic similarity:', topicSimBase.toFixed(3));
        console.log('Paywall:', JSON.stringify(paywall));
        console.log('Obfuscation:', JSON.stringify(obfuscation));
        let optionsCoverageBase = hasOptions ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, scopedCombinedText) : {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: false
        };
        let optionsMatchBase = hasOptions ? OptionsMatchService.optionsMatchInFreeText(originalOptions, scopedCombinedText) : true;

        // Fallback: if scoped text fails options matching, try the full combined text.
        // The question may be further in the document beyond the 3600-char scoped window.
        if (hasOptions && !optionsMatchBase && combinedText.length > scopedCombinedText.length + 200) {
          const fullCoverage = OptionsMatchService.optionsCoverageInFreeText(originalOptions, combinedText);
          const fullMatch = fullCoverage.ratio >= 0.6 || fullCoverage.hits >= Math.min(3, fullCoverage.total || 3);
          if (fullMatch) {
            optionsCoverageBase = fullCoverage;
            optionsMatchBase = true;
            console.log(`SearchService: Options matched via full-text fallback for ${hostHint} (hits=${fullCoverage.hits}/${fullCoverage.total})`);
          } else {
            console.log(`  ❌ Full-text options fallback also failed: hits=${fullCoverage.hits}/${fullCoverage.total} ratio=${fullCoverage.ratio.toFixed(2)}`);
          }
        }
        console.log('Options match:', optionsMatchBase, '| Coverage:', JSON.stringify(optionsCoverageBase));
        this._logSourceDiagnostic({
          phase: 'start',
          hostHint,
          type: sourceType,
          topicSim: topicSimBase,
          optionsMatch: optionsMatchBase,
          obfuscation,
          paywall,
          textLength: combinedText.length
        });
        if (paywall?.isPaywalled) {
          // Soft-block: if the extracted text is substantial, the content IS
          // readable in the DOM despite paywall CSS (blur/overlay). Only block
          // when text is truly empty or very short.
          const readableTextLen = (docText || '').length;
          console.log(`  🔒 Paywall detected: readableTextLen=${readableTextLen}`);
          if (readableTextLen < 400) {
            console.log(`  ⛔ BLOCKED: paywall-overlay (text too short: ${readableTextLen} < 400)`);
            console.groupEnd();
            runStats.blockedPaywall += 1;
            this._logSourceDiagnostic({
              phase: 'decision',
              hostHint,
              type: sourceType,
              topicSim: topicSimBase,
              optionsMatch: optionsMatchBase,
              obfuscation,
              paywall,
              decision: 'skip',
              reason: 'paywall-overlay'
            });
            continue;
          }
          // Content IS readable — proceed with extraction despite paywall signals.
          // Clear the paywall flag so downstream extractors (structured, PDF-highlight,
          // local regex) don't redundantly re-block this source.
          paywall = {
            ...paywall,
            isPaywalled: false,
            softPassed: true
          };
          console.log(`  ✅ Paywall SOFT-PASSED: text readable (${readableTextLen} chars) — flag cleared`);
        }
        if (obfuscation?.isObfuscated) {
          console.log(`  ⛔ BLOCKED: obfuscated HTML`);
          // Still collect for AI combined if topic similarity is decent —
          // the combined pass uses title + snippet + text, not raw HTML.
          if (topicSimBase >= 0.30 && !paywall?.isPaywalled) {
            const clipped = scopedCombinedText.slice(0, 3000);
            if (clipped.length >= 200) {
              collectedForCombined.push({
                title,
                link,
                text: clipped,
                topicSim: topicSimBase,
                optionsMatch: optionsMatchBase,
                optionsCoverage: optionsCoverageBase,
                hostHint,
                obfuscated: true,
                paywalled: false
              });
            }
          }
          runStats.blockedObfuscation += 1;
          this._logSourceDiagnostic({
            phase: 'decision',
            hostHint,
            type: sourceType,
            topicSim: topicSimBase,
            optionsMatch: optionsMatchBase,
            obfuscation,
            paywall,
            decision: 'skip',
            reason: 'obfuscated_html'
          });
          console.groupEnd();
          continue;
        }
        const allowStructuredMismatchBypass = hasOptions && !optionsMatchBase && !obfuscation?.isObfuscated && topicSimBase >= 0.26 && (hostHint === 'passeidireto.com' || hostHint === 'studocu.com');
        if (allowStructuredMismatchBypass) {
          console.log(`  [BYPASS] options mismatch softened for structured extractors (host=${hostHint}, topicSim=${topicSimBase.toFixed(3)})`);
        }

        // Hard integrity policy: options mismatch cannot contribute direct evidence/votes.
        // However, high-similarity sources are still collected for AI combined inference
        // AND can contribute knowledge via AI extraction.
        if (hasOptions && !optionsMatchBase && !allowStructuredMismatchBypass) {
          console.log(`  ⛔ BLOCKED: options-mismatch-hard-block (topicSim=${topicSimBase.toFixed(3)})`);
          // Collect sources with decent topic similarity for AI combined pass.
          // Allow paywalled-but-readable sources (they passed the soft-block above).
          if (topicSimBase >= 0.25 && !obfuscation?.isObfuscated) {
            const clipped = scopedCombinedText.slice(0, 3000);
            if (clipped.length >= 200) {
              collectedForCombined.push({
                title,
                link,
                text: clipped,
                topicSim: topicSimBase,
                optionsMatch: false,
                optionsCoverage: optionsCoverageBase,
                hostHint,
                obfuscated: false,
                paywalled: !!paywall?.isPaywalled
              });
            }
          }

          // Additional style: map explicit textual answers (e.g. "Resposta: ...")
          // directly to the user's options when the letter itself is unreliable.
          const plainAnswerCandidates = extractExplicitAnswerTextCandidates(scopedCombinedText);
          if (plainAnswerCandidates.length > 0) {
            console.log(`  🧩 [TEXT-MAP] explicit answer candidates found=${plainAnswerCandidates.length} host=${hostHint}`);
            let mappedFromPlain = null;
            let mappedCandidateText = '';
            for (const candidate of plainAnswerCandidates) {
              const mapped = tryMapTextAnswerCandidate(candidate, hostHint, topicSimBase);
              if (!mapped) continue;
              mappedFromPlain = mapped;
              mappedCandidateText = candidate;
              break;
            }
            if (mappedFromPlain) {
              addTextMappedSource.call(this, {
                title,
                link,
                hostHint,
                sourceType,
                topicSim: topicSimBase,
                obfuscation,
                mapped: mappedFromPlain,
                evidenceText: mappedCandidateText,
                methodTag: 'textual-answer-plain'
              });
              console.groupEnd();
              continue;
            }
          }

          // ── FreeText extraction for Brainly and similar free-answer sources ──
          // When the page has a natural-language answer (e.g. "Resposta: texto..."),
          // try to map it to the user's options even when options don't appear verbatim.
          const isFreeTextHost = hostHint === 'brainly.com.br' || hostHint === 'brainly.com' || hostHint === 'brainly.lat';
          if (isFreeTextHost && hasOptions && topicSimBase >= 0.28 && !obfuscation?.isObfuscated) {
            console.log(`  🗒️ [FREETEXT] Attempting FreeTextAnswerService for ${hostHint} (topicSim=${topicSimBase.toFixed(3)})`);
            try {
              const ftResult = await FreeTextAnswerService.extractAnswerFromFreeText(pageText, originalOptionsMap, questionStem);
              if (ftResult?.letter) {
                console.log(`  🗒️ [FREETEXT] Found letter=${ftResult.letter} method=${ftResult.method} confidence=${ftResult.confidence.toFixed(3)}`);
                const domainWeight = getDomainWeight(link);
                const ftWeight = Math.min(1.0, (ftResult.confidence || 0.70) * domainWeight * 0.95);
                sources.push({
                  title,
                  link,
                  letter: ftResult.letter,
                  weight: ftWeight,
                  evidenceType: ftResult.method,
                  hostHint,
                  sourceId: `${hostHint}:freetext`,
                  evidenceBlock: ftResult.snippet || '',
                  matchQuality: topicSimBase,
                  questionPolarity
                });
                runStats.acceptedViaFreeText = (runStats.acceptedViaFreeText || 0) + 1;
                this._logSourceDiagnostic({
                  phase: 'decision',
                  hostHint,
                  type: sourceType,
                  topicSim: topicSimBase,
                  optionsMatch: false,
                  obfuscation,
                  decision: 'accept',
                  reason: ftResult.method
                });
                console.groupEnd();
                continue;
              }
            } catch (ftErr) {
              console.warn(`  🗒️ [FREETEXT] FreeTextAnswerService failed:`, ftErr?.message || ftErr);
            }
          }

          // AI knowledge extraction for mismatch sources — DEFERRED to post-loop.
          // Queuing here avoids blocking the main analysis loop (each Groq call
          // takes 2.5s queue-wait + 4-8s inference). Sources with direct answers
          // (qconcursos, passeidireto) now process without waiting for mismatch AI.
          if (aiExtractionCount < 5 && topicSimBase >= 0.50 && !obfuscation?.isObfuscated && scopedCombinedText.length >= 300) {
            _pendingMismatchAI.push({
              aiScopedText: EvidenceService.buildQuestionScopedText(combinedText, questionForInference, 8000),
              hostHint,
              sourceType,
              title,
              link,
              topicSim: topicSimBase,
              obfuscation
            });
            console.log(`  🤖 [AI-MISMATCH] Deferred to post-loop (topicSim=${topicSimBase.toFixed(3)}, host=${hostHint}) — queue size=${_pendingMismatchAI.length}`);
          }
          runStats.blockedOptionsMismatch += 1;
          this._logSourceDiagnostic({
            phase: 'decision',
            hostHint,
            type: sourceType,
            topicSim: topicSimBase,
            optionsMatch: false,
            obfuscation,
            paywall,
            decision: 'skip',
            reason: 'options-mismatch-hard-block'
          });
          console.groupEnd();
          continue;
        }
        console.log('  ✅ Passed all filters — entering extraction chain');

        // 0) Structured extractors by page signature (PDF-like, AnswerCard, anchored gabarito).
        const structured = HtmlExtractorService.extractStructuredEvidence(htmlText, hostHint, questionForInference, questionStem, originalOptionsMap, originalOptions, {
          findQuestionBlock: (text, stem) => EvidenceService.findQuestionBlock(text, stem),
          extractExplicitGabarito: (text, q) => EvidenceService.extractExplicitGabarito(text, q),
          extractExplicitLetterFromText: (text, stem, opts) => EvidenceService.extractExplicitLetterFromText(text, stem, opts)
        }, {
          parsed: parsedForDiag,
          type: sourceType,
          obfuscation,
          paywall
        });
        console.log(`  🏗️ Structured extractor: skip=${!!structured?.skip} reason=${structured?.reason || 'none'} letter=${structured?.letter || 'none'} method=${structured?.method || 'none'}`);
        if (structured?.skip) {
          this._logSourceDiagnostic({
            phase: 'decision',
            hostHint,
            type: sourceType,
            topicSim: topicSimBase,
            optionsMatch: optionsMatchBase,
            obfuscation,
            decision: 'structured-skip-fallback',
            reason: structured.reason || 'structured-skip'
          });
          if (structured.reason === 'obfuscated_html' || structured.reason === 'paywall-overlay') {
            console.log(`  ⛔ Structured hard-skip: ${structured.reason}`);
            console.groupEnd();
            continue;
          }
          console.log(`  ⚠️ Structured skip (soft): ${structured.reason} — continuing to fallbacks`);
        }
        if (structured?.letter) {
          console.log(`  🎯 Structured found letter: ${structured.letter} method=${structured.method} confidence=${structured.confidence} matchQuality=${structured.matchQuality}`);
          const riskyHost = hostHint === 'passeidireto.com' || hostHint === 'brainly.com.br' || hostHint === 'brainly.com';
          const structuredMethod = structured.method || 'structured-html';
          const structuredSim = structured.matchQuality || 0;
          const evidenceScope = `${structured.evidence || ''}\n${scopedCombinedText.slice(0, 1800)}`;
          const structuredCoverage = hasOptions ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, evidenceScope) : {
            hits: 0,
            total: 0,
            ratio: 0,
            hasEnoughOptions: false
          };
          const structuredOptionsMatch = !structuredCoverage.hasEnoughOptions || structuredCoverage.ratio >= 0.6 || structuredCoverage.hits >= Math.min(3, structuredCoverage.total || 3);
          const structuredOptionsStrong = !structuredCoverage.hasEnoughOptions || structuredCoverage.ratio >= 0.8 || structuredCoverage.hits >= Math.min(4, structuredCoverage.total || 4);
          const isGenericAnchor = structuredMethod === 'generic-anchor';
          console.log(`  📊 Structured coverage: match=${structuredOptionsMatch} strong=${structuredOptionsStrong} hits=${structuredCoverage.hits}/${structuredCoverage.total} ratio=${structuredCoverage.ratio?.toFixed(2)} isGenericAnchor=${isGenericAnchor} riskyHost=${riskyHost} sim=${structuredSim.toFixed(2)}`);
          // FIX: Extend the risky-host demotion guard to ALL structured
          // methods (answercard-ql, pdf-anchor-text-match, etc.) when
          // option coverage is zero — not just generic-anchor.  Without
          // this, an answercard from a DIFFERENT question on a risky host
          // gets accepted with high weight despite 0/5 option body matches.
          const isZeroCoverageOnRiskyHost = riskyHost && structuredCoverage.hasEnoughOptions && structuredCoverage.hits === 0 && structuredSim < 0.45;
          if (isZeroCoverageOnRiskyHost && !isGenericAnchor) {
            console.log(`  ⚠️ Structured ${structuredMethod} demoted: risky host with 0 option hits and low sim=${structuredSim.toFixed(2)}`);
            if (topicSimBase >= 0.2) {
              collectedForCombined.push({
                title,
                link,
                text: scopedCombinedText.slice(0, 3000),
                topicSim: topicSimBase,
                optionsMatch: structuredOptionsMatch,
                optionsCoverage: structuredCoverage,
                hostHint,
                obfuscated: !!obfuscation?.isObfuscated,
                paywalled: !!paywall?.isPaywalled
              });
            }
            this._logSourceDiagnostic({
              phase: 'decision',
              hostHint,
              type: sourceType,
              topicSim: topicSimBase,
              optionsMatch: structuredOptionsMatch,
              obfuscation,
              decision: 'combined-only',
              method: structuredMethod,
              reason: 'structured-zero-coverage-risky-host'
            });
            console.groupEnd();
            continue;
          }
          if (isGenericAnchor && riskyHost && !structuredOptionsStrong && structuredSim < 0.62) {
            if (topicSimBase >= 0.2) {
              collectedForCombined.push({
                title,
                link,
                text: scopedCombinedText.slice(0, 3000),
                topicSim: topicSimBase,
                optionsMatch: structuredOptionsMatch,
                optionsCoverage: structuredCoverage,
                hostHint,
                obfuscated: !!obfuscation?.isObfuscated,
                paywalled: !!paywall?.isPaywalled
              });
            }
            this._logSourceDiagnostic({
              phase: 'decision',
              hostHint,
              type: sourceType,
              topicSim: topicSimBase,
              optionsMatch: structuredOptionsMatch,
              obfuscation,
              decision: 'combined-only',
              method: structuredMethod,
              reason: 'generic-anchor-options-mismatch'
            });
            console.log(`  ⚠️ Generic anchor demoted to combined-only (risky=${riskyHost} strongOpts=${structuredOptionsStrong} sim=${structuredSim.toFixed(2)})`);
            console.groupEnd();
            continue;
          }
          // Remap letter if source has shuffled options — use full combinedText for best coverage
          console.log(`  🔀 Structured pre-remap letter: ${structured.letter} — attempting remap via combinedText (len=${combinedText.length})...`);
          structured.letter = this._remapLetterIfShuffled(structured.letter, combinedText, originalOptionsMap);
          console.log(`  🔀 Structured post-remap letter: ${structured.letter}`);
          const baseWeight = getDomainWeight(link);
          const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
          const structuredBoost = (structured.confidence || 0.82) >= 0.9 ? 4.4 : 3.7;
          const weight = baseWeight + structuredBoost + quality * 0.35;
          const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
          const evidenceBlock = EvidenceService.buildEvidenceBlock({
            questionFingerprint,
            sourceId,
            sourceLink: link,
            hostHint,
            evidenceText: structured.evidence || scopedCombinedText,
            originalOptionsMap,
            explicitLetter: structured.letter,
            confidenceLocal: structured.confidence || 0.82,
            evidenceType: structured.evidenceType || 'structured-html'
          });
          sources.push({
            title,
            link,
            letter: structured.letter,
            weight,
            evidenceType: structured.evidenceType || 'structured-html',
            questionPolarity,
            matchQuality: Math.max(quality, Math.round((structured.matchQuality || 0) * 10)),
            extractionMethod: structuredMethod,
            evidence: structured.evidence || '',
            hostHint,
            sourceId,
            evidenceBlock
          });
          runStats.acceptedForVotes += 1;
          console.log(`  ✅ ACCEPTED via structured: letter=${structured.letter} weight=${weight.toFixed(2)} method=${structuredMethod}`);
          this._logSourceDiagnostic({
            phase: 'decision',
            hostHint,
            type: sourceType,
            topicSim: topicSimBase,
            optionsMatch: optionsMatchBase,
            obfuscation,
            decision: 'use-structured',
            method: structuredMethod,
            letter: structured.letter
          });
          const {
            bestLetter,
            votes
          } = EvidenceService.computeVotesAndState(sources);
          if (bestLetter && (votes[bestLetter] || 0) >= 6.5) {
            console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`);
            console.groupEnd();
            break;
          }
          console.groupEnd();
          continue;
        }

        // 1) PDF-like highlight extraction (PasseiDireto/Studocu), scoped by question.
        let extracted = null;
        if (hostHint === 'passeidireto.com' || hostHint === 'studocu.com') {
          const blockedByIntegrity = !!obfuscation?.isObfuscated || !!paywall?.isPaywalled || hasOptions && !optionsMatchBase && !allowStructuredMismatchBypass;
          console.log(`  📄 PDF-highlight check: blockedByIntegrity=${blockedByIntegrity} (obf=${!!obfuscation?.isObfuscated} pw=${!!paywall?.isPaywalled} optMismatch=${hasOptions && !optionsMatchBase})`);
          if (blockedByIntegrity) {
            console.log(`  ⛔ PDF-highlight blocked: integrity check failed`);
            this._logSourceDiagnostic({
              phase: 'decision',
              hostHint,
              type: sourceType,
              topicSim: topicSimBase,
              optionsMatch: optionsMatchBase,
              obfuscation,
              paywall,
              decision: 'skip',
              reason: 'pdf-signal-blocked-low-integrity'
            });
            console.groupEnd();
            continue;
          }
          extracted = HtmlExtractorService.extractPdfHighlightLetter(snap?.html || '', questionStem, originalOptionsMap, originalOptions);
          console.log(`  📄 PDF-highlight result: letter=${extracted?.letter || 'none'} method=${extracted?.method || 'none'} confidence=${extracted?.confidence || 0} evidence="${extracted?.evidence || 'none'}"`);

          // AI-HTML fallback: when ff1-highlight couldn't find the answer,
          // send a chunk of raw HTML to AI so it can detect visual highlights
          // using any CSS pattern (not just hardcoded ff1/ff4).
          if (!extracted?.letter && snap?.html && snap.html.length > 5000 && aiHtmlExtractionCount < 2) {
            const reconstructedQ = questionStem + '\n' + (originalOptions || []).join('\n');
            const optTokensForHtml = QuestionParser.extractOptionTokens(reconstructedQ);
            const htmlSnippet = EvidenceService.extractHtmlAroundQuestion(snap.html, questionStem, optTokensForHtml, 12000);
            if (htmlSnippet && htmlSnippet.length > 500) {
              console.log(`  🤖 [AI-HTML] Attempting AI HTML extraction (host=${hostHint}, snippetLen=${htmlSnippet.length})`);
              if (typeof onStatus === 'function') {
                onStatus(`AI analyzing HTML from ${hostHint}...`);
              }
              // Check AI result cache first to avoid re-calling LLM on the same URL+question
              const _aiHtmlCacheKey = link + '|html';
              const _aiHtmlCached = SearchCacheService.getCachedAiResult(_aiHtmlCacheKey, questionForInference);
              let aiHtmlResult;
              if (_aiHtmlCached) {
                console.log(`  🤖 [AI-HTML] 📦 Cache hit for ${hostHint} — skipping LLM call`);
                aiHtmlResult = _aiHtmlCached;
              } else {
                aiHtmlResult = await ApiService.aiExtractFromHtml(htmlSnippet, questionForInference, hostHint);
                if (aiHtmlResult) SearchCacheService.setCachedAiResult(_aiHtmlCacheKey, questionForInference, aiHtmlResult);
              }
              aiHtmlExtractionCount++;
              if (aiHtmlResult?.letter) {
                console.log(`  🤖 [AI-HTML] Found letter=${aiHtmlResult.letter} via ${aiHtmlResult.method}`);
                extracted = {
                  letter: aiHtmlResult.letter,
                  confidence: aiHtmlResult.confidence || 0.85,
                  method: aiHtmlResult.method || 'ai-html-extraction',
                  evidence: aiHtmlResult.evidence || ''
                };
              } else {
                console.log(`  🤖 [AI-HTML] No letter found`);
                if (aiHtmlResult?.knowledge) {
                  aiKnowledgePool.push({
                    host: hostHint,
                    knowledge: aiHtmlResult.knowledge,
                    topicSim: topicSimBase,
                    link,
                    title
                  });
                }
              }
            }
          }
          if (extracted?.letter) {
            console.log(`  📄 PDF-highlight raw letter: ${extracted.letter} — attempting remap via combinedText (len=${combinedText.length})...`);
            // Remap letter if source has shuffled options
            extracted.letter = this._remapLetterIfShuffled(extracted.letter, combinedText, originalOptionsMap);
            console.log(`SearchService: PDF signal detected. host=${hostHint} letter=${extracted.letter} method=${extracted.method || 'ff1-highlight'}`);
            const baseWeight = getDomainWeight(link);
            const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
            const method = extracted.method || 'ff1-highlight';
            const heuristicSignal = method === 'ff1-highlight' || method === 'css-signature';
            const signalBoost = heuristicSignal ? 1.8 : 3.2;
            const confFactor = Math.max(0.35, Math.min(1.0, Number(extracted.confidence) || 0.82));
            const adjustedSignalBoost = signalBoost * confFactor;
            console.log(`  📄 PDF weight factors: base=${baseWeight.toFixed(2)} signal=${signalBoost.toFixed(2)} conf=${confFactor.toFixed(2)} adjustedSignal=${adjustedSignalBoost.toFixed(2)} quality=${quality}`);
            const weight = baseWeight + adjustedSignalBoost + quality * 0.25;
            const hostPrefix = hostHint === 'passeidireto.com' ? 'passeidireto' : 'studocu';
            const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
            const evidenceBlock = EvidenceService.buildEvidenceBlock({
              questionFingerprint,
              sourceId,
              sourceLink: link,
              hostHint,
              evidenceText: extracted.evidence || scopedCombinedText,
              originalOptionsMap,
              explicitLetter: extracted.letter,
              confidenceLocal: extracted.confidence || 0.82,
              evidenceType: `${hostPrefix}-${method}-scoped`
            });
            sources.push({
              title,
              link,
              letter: extracted.letter,
              weight,
              evidenceType: `${hostPrefix}-${method}-scoped`,
              questionPolarity,
              matchQuality: quality,
              hostHint,
              sourceId,
              evidenceBlock
            });
            runStats.acceptedForVotes += 1;
            this._logSourceDiagnostic({
              phase: 'decision',
              hostHint,
              type: sourceType,
              topicSim: topicSimBase,
              optionsMatch: optionsMatchBase,
              obfuscation,
              decision: 'use-pdf-signal',
              method,
              letter: extracted.letter
            });
            const {
              bestLetter,
              votes
            } = EvidenceService.computeVotesAndState(sources);
            if (bestLetter && (votes[bestLetter] || 0) >= 6.5) {
              console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`);
              console.groupEnd();
              break;
            }
            console.groupEnd();
            continue;
          }
        }
        if (hasOptions && !optionsMatchBase) {
          console.log(`  [BLOCKED] options-mismatch-post-structured (topicSim=${topicSimBase.toFixed(3)})`);
          runStats.blockedOptionsMismatch += 1;
          this._logSourceDiagnostic({
            phase: 'decision',
            hostHint,
            type: sourceType,
            topicSim: topicSimBase,
            optionsMatch: false,
            obfuscation,
            paywall,
            decision: 'skip',
            reason: 'options-mismatch-post-structured'
          });
          console.groupEnd();
          continue;
        }

        // 2) Enhanced local extraction (uses _findQuestionBlock + _extractExplicitGabarito)
        const localResult = EvidenceService.extractAnswerLocally(combinedText, questionForInference, originalOptions);
        console.log(`  📝 Local extraction: letter=${localResult?.letter || 'none'} type=${localResult?.evidenceType || 'none'} confidence=${localResult?.confidence || 0}`);
        // TopicSim gate: gabarito from low-similarity sources (compilados with many questions)
        // is extremely unreliable — the matched pattern is likely for a DIFFERENT question.
        if (localResult?.letter && topicSimBase < 0.50) {
          console.log(`  ⛔ Gabarito REJECTED: topicSim=${topicSimBase.toFixed(3)} < 0.50 — likely wrong question in compilado`);
          localResult.letter = null;
        }
        if (localResult?.letter) {
          console.log(`  🔀 Local pre-remap letter: ${localResult.letter}`);
          // Remap letter if source has shuffled options
          localResult.letter = this._remapLetterIfShuffled(localResult.letter, combinedText, originalOptionsMap);
          console.log(`  🔀 Local post-remap letter: ${localResult.letter}`);
          const baseWeight = getDomainWeight(link);
          const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
          let weight = baseWeight + 2.6 + quality * 0.4;
          // Reduce gabarito weight when topicSim is moderate — source may be wrong question
          if (topicSimBase < 0.70) {
            weight *= topicSimBase;
            console.log(`  ⚠️ Gabarito weight reduced: topicSim=${topicSimBase.toFixed(3)} → weight=${weight.toFixed(2)}`);
          }
          const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
          const evidenceBlock = EvidenceService.buildEvidenceBlock({
            questionFingerprint,
            sourceId,
            sourceLink: link,
            hostHint,
            evidenceText: localResult.evidence || scopedCombinedText,
            originalOptionsMap,
            explicitLetter: localResult.letter,
            confidenceLocal: localResult.confidence || 0.84,
            evidenceType: localResult.evidenceType || 'explicit-gabarito'
          });
          sources.push({
            title,
            link,
            letter: localResult.letter,
            weight,
            evidenceType: localResult.evidenceType || 'explicit-gabarito',
            questionPolarity,
            matchQuality: quality,
            blockMethod: localResult.blockMethod,
            hostHint,
            sourceId,
            evidenceBlock
          });
          runStats.acceptedForVotes += 1;
          this._logSourceDiagnostic({
            phase: 'decision',
            hostHint,
            type: sourceType,
            topicSim: topicSimBase,
            optionsMatch: optionsMatchBase,
            obfuscation,
            decision: 'use-local',
            method: localResult.evidenceType || 'explicit-gabarito',
            letter: localResult.letter
          });
          const {
            bestLetter,
            votes
          } = EvidenceService.computeVotesAndState(sources);
          if (bestLetter && (votes[bestLetter] || 0) >= 6.5) {
            console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`);
            console.groupEnd();
            break;
          }
          console.groupEnd();
          continue;
        }

        // 3) Fallback: simpler explicit letter extraction
        extracted = EvidenceService.extractExplicitLetterFromText(combinedText, questionStem, originalOptions);
        console.log(`  🔤 Explicit letter: letter=${extracted?.letter || 'none'} confidence=${extracted?.confidence || 0}`);
        if (extracted?.letter) {
          console.log(`  🔀 Explicit pre-remap letter: ${extracted.letter}`);
          // Remap letter if source has shuffled options
          extracted.letter = this._remapLetterIfShuffled(extracted.letter, combinedText, originalOptionsMap);
          console.log(`  🔀 Explicit post-remap letter: ${extracted.letter}`);
          const baseWeight = getDomainWeight(link);
          const weight = baseWeight + 2.0;
          const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
          const evidenceBlock = EvidenceService.buildEvidenceBlock({
            questionFingerprint,
            sourceId,
            sourceLink: link,
            hostHint,
            evidenceText: extracted.evidence || scopedCombinedText,
            originalOptionsMap,
            explicitLetter: extracted.letter,
            confidenceLocal: extracted.confidence || 0.8,
            evidenceType: 'explicit-gabarito-simple'
          });
          sources.push({
            title,
            link,
            letter: extracted.letter,
            weight,
            evidenceType: 'explicit-gabarito-simple',
            questionPolarity,
            hostHint,
            sourceId,
            evidenceBlock
          });
          runStats.acceptedForVotes += 1;
          this._logSourceDiagnostic({
            phase: 'decision',
            hostHint,
            type: sourceType,
            topicSim: topicSimBase,
            optionsMatch: optionsMatchBase,
            obfuscation,
            decision: 'use-explicit-simple',
            method: 'explicit-gabarito-simple',
            letter: extracted.letter
          });
          const {
            bestLetter,
            votes
          } = EvidenceService.computeVotesAndState(sources);
          if (bestLetter && (votes[bestLetter] || 0) >= 6.5) {
            console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`);
            console.groupEnd();
            break;
          }
          console.groupEnd();
          continue;
        }

        // 3.5) AI per-page deep extraction: when regex/DOM extractors all failed,
        // send the page text to AI for a "pente fino" — finds answers that patterns miss.
        // Truncating to 6000 chars (up from 3500) gives AI more context for multi-question pages.
        if (aiExtractionCount < 3 && topicSimBase >= 0.35 && !obfuscation?.isObfuscated && scopedCombinedText.length >= 250) {
          const aiScopedText = EvidenceService.buildQuestionScopedText(combinedText, questionForInference, 6000);
          console.log(`  🤖 [AI-EXTRACT] Attempting AI page extraction (call ${aiExtractionCount + 1}/3, topicSim=${topicSimBase.toFixed(3)}, textLen=${aiScopedText.length}, host=${hostHint})`);
          if (typeof onStatus === 'function') {
            onStatus(`AI analyzing ${hostHint || 'source'} (${runStats.analyzed}/${topResults.length})...`);
          }
          // Check AI result cache to avoid re-calling LLM for same URL+question
          const _aiPageCached = SearchCacheService.getCachedAiResult(link, questionForInference);
          let aiExtracted;
          if (_aiPageCached) {
            console.log(`  🤖 [AI-EXTRACT] 📦 Cache hit for ${hostHint} — skipping LLM call`);
            aiExtracted = _aiPageCached;
          } else {
            aiExtracted = await ApiService.aiExtractFromPage(aiScopedText, questionForInference, hostHint);
            if (aiExtracted) SearchCacheService.setCachedAiResult(link, questionForInference, aiExtracted);
          }
          aiExtractionCount++;

          // Collect knowledge even if no definitive letter found
          if (aiExtracted?.knowledge) {
            aiKnowledgePool.push({
              host: hostHint,
              knowledge: aiExtracted.knowledge,
              topicSim: topicSimBase,
              link,
              title
            });
            console.log(`  🤖 [AI-EXTRACT] Knowledge collected from ${hostHint} (${aiExtracted.knowledge.length} chars, pool size=${aiKnowledgePool.length})`);
          }

          // Cross-question guard: verify the AI's evidence actually relates to
          // the user's question — multi-question pages often cause the AI to
          // find a gabarito from a DIFFERENT question on the same page.
          if (aiExtracted?.letter && aiExtracted?.evidence && originalOptionsMap) {
            const evNorm = QuestionParser.normalizeOption(aiExtracted.evidence);
            // Check 1: evidence should mention concepts from the claimed option
            const claimedBody = QuestionParser.normalizeOption(originalOptionsMap[aiExtracted.letter] || '');
            const claimedTokens = claimedBody.split(/\s+/).filter(t => t.length >= 4);
            const claimedHits = claimedTokens.filter(t => evNorm.includes(t)).length;
            const claimedRatio = claimedTokens.length > 0 ? claimedHits / claimedTokens.length : 1;
            // Check 2: evidence should mention the question's distinguishing keywords
            const stemTokens = QuestionParser.extractKeyTokens(questionStem);
            const stemHits = stemTokens.filter(t => evNorm.includes(t)).length;
            const stemRatio = stemTokens.length > 0 ? stemHits / stemTokens.length : 1;
            console.log(`  🤖 [AI-EXTRACT] Cross-Q check: claimedHits=${claimedHits}/${claimedTokens.length} (${claimedRatio.toFixed(2)}) stemHits=${stemHits}/${stemTokens.length} (${stemRatio.toFixed(2)})`);
            if (claimedRatio < 0.38 && stemRatio < 0.25 || claimedRatio < 0.15) {
              console.log(`  🤖 [AI-EXTRACT] ❌ Cross-question REJECTED: evidence relates to a different question on the page (claimRatio < 0.38 & stemRatio < 0.25, or claimRatio < 0.15)`);
              console.log(`  🤖 [AI-EXTRACT] Keeping knowledge but discarding letter ${aiExtracted.letter}`);
              aiExtracted.letter = null;
              // Strip misleading letter/resultado from knowledge so it
              // doesn't poison downstream reflection
              if (aiExtracted.knowledge) {
                aiExtracted.knowledge = aiExtracted.knowledge.replace(/^RESULTADO:\s*ENCONTRADO\s*$/gim, '').replace(/^Letra\s+[A-E]\b.*$/gim, '').trim();
              }
            }
          }
          if (aiExtracted?.letter) {
            console.log(`  🤖 [AI-EXTRACT] Letter found: ${aiExtracted.letter} (pre-remap)`);
            aiExtracted.letter = this._remapLetterIfShuffled(aiExtracted.letter, combinedText, originalOptionsMap);
            console.log(`  🤖 [AI-EXTRACT] Post-remap letter: ${aiExtracted.letter}`);
            // Validate the letter exists in the user's options map.
            // The AI may find a different question on the same page (e.g. one with 5 options)
            // and return a letter that doesn't exist in the current question (e.g. E when only A-D exist).
            if (originalOptionsMap && aiExtracted.letter && !originalOptionsMap[aiExtracted.letter]) {
              console.log(`  🤖 [AI-EXTRACT] ❌ Letter ${aiExtracted.letter} not in options map [${Object.keys(originalOptionsMap).join(',')}] — discarding`);
              aiExtracted.letter = null;
            }
            const baseWeight = getDomainWeight(link);
            const quality = this.computeMatchQuality(combinedText, questionForInference, originalOptions, originalOptionsMap);
            // Penalize risky hosts (passeidireto, brainly, scribd) when options didn't match exactly.
            // These pages often have many questions; the AI can accidentally read a neighbor question's gabarito.
            const riskyMismatchPenalty = riskyCombinedHosts.has(hostHint) && !optionsMatchBase ? 0.4 : 0;
            const weight = baseWeight + 0.85 + quality * 0.35 - riskyMismatchPenalty;
            const sourceId = `${hostHint || 'source'}:${sources.length + 1}`;
            const evidenceBlock = EvidenceService.buildEvidenceBlock({
              questionFingerprint,
              sourceId,
              sourceLink: link,
              hostHint,
              evidenceText: aiExtracted.evidence || scopedCombinedText,
              originalOptionsMap,
              explicitLetter: aiExtracted.letter,
              confidenceLocal: aiExtracted.confidence || 0.82,
              evidenceType: 'ai-page-extraction'
            });
            sources.push({
              title,
              link,
              letter: aiExtracted.letter,
              weight,
              evidenceType: 'ai-page-extraction',
              questionPolarity,
              matchQuality: quality,
              hostHint,
              sourceId,
              evidenceBlock
            });
            runStats.acceptedViaAiExtraction += 1;
            runStats.acceptedForVotes += 1;
            this._logSourceDiagnostic({
              phase: 'decision',
              hostHint,
              type: sourceType,
              topicSim: topicSimBase,
              optionsMatch: optionsMatchBase,
              obfuscation,
              decision: 'use-ai-extraction',
              method: 'ai-page-extraction',
              letter: aiExtracted.letter
            });
            console.log(`  ✅ ACCEPTED via AI page extraction: letter=${aiExtracted.letter} weight=${weight.toFixed(2)}`);
            const {
              bestLetter,
              votes
            } = EvidenceService.computeVotesAndState(sources);
            if (bestLetter && (votes[bestLetter] || 0) >= 6.5) {
              console.log(`  🏁 Early exit: votes[${bestLetter}]=${votes[bestLetter]}`);
              console.groupEnd();
              break;
            }
            console.groupEnd();
            continue;
          } else {
            console.log(`  🤖 [AI-EXTRACT] No letter found for ${hostHint} — knowledge ${aiExtracted?.knowledge ? 'saved' : 'empty'}`);
          }
        }

        // 4) No explicit evidence found: keep as low-priority AI evidence.
        console.log(`  ℹ️ No direct evidence found — collecting for AI combined`);
        const clipped = scopedCombinedText.slice(0, 4000);
        if (clipped.length >= 200) {
          const topicSim = topicSimBase;
          aiEvidence.push({
            title,
            link,
            text: clipped,
            topicSim,
            optionsMatch: optionsMatchBase,
            optionsCoverage: optionsCoverageBase,
            hostHint,
            obfuscated: !!obfuscation?.isObfuscated,
            paywalled: !!paywall?.isPaywalled
          });
          runStats.acceptedForAiEvidence += 1;
          this._logSourceDiagnostic({
            phase: 'decision',
            hostHint,
            type: sourceType,
            topicSim,
            optionsMatch: optionsMatchBase,
            obfuscation,
            decision: 'ai-evidence'
          });
        }
        console.groupEnd();
      } catch (error) {
        console.error('SearchService Error:', error);
        console.groupEnd();
        runStats.blockedByError += 1;
      }
    }

    // Merge aiEvidence + collectedForCombined, sorted by topic similarity

    // ═══ DEFERRED AI-MISMATCH EXTRACTION ═══
    // Process mismatch sources that were queued during the main loop.
    // Only runs if we still lack strong explicit evidence — skip entirely when
    // direct sources already produced sufficient votes (saves 5-15s in typical cases).
    if (_pendingMismatchAI.length > 0) {
      const { bestLetter: _midLetter, votes: _midVotes } = EvidenceService.computeVotesAndState(sources);
      const _midTopVote = _midLetter ? (_midVotes[_midLetter] || 0) : 0;
      if (_midTopVote < 5.5) {
        console.log(`SearchService: 🤖 Processing ${_pendingMismatchAI.length} deferred mismatch AI sources (midTopVote=${_midTopVote.toFixed(1)})...`);
        const toProcess = _pendingMismatchAI.slice(0, 3); // cap at 3 to limit latency
        for (const pending of toProcess) {
          if (aiExtractionCount >= 5) break;
          const { aiScopedText, hostHint: ph, sourceType: pst, title: pt, link: pl, topicSim: ptopicSim, obfuscation: pobf } = pending;
          if (typeof onStatus === 'function') onStatus(`AI extracting knowledge from ${ph || 'source'}...`);
          try {
            const aiExtracted = await ApiService.aiExtractFromPage(aiScopedText, questionForInference, ph);
            aiExtractionCount++;
            if (aiExtracted?.knowledge) {
              const cleanKnowledge = aiExtracted.knowledge.replace(/^RESULTADO:\s*ENCONTRADO\s*$/gim, '').replace(/^Letra\s+[A-E]\b.*$/gim, '').trim();
              aiKnowledgePool.push({ host: ph, knowledge: cleanKnowledge, topicSim: ptopicSim, link: pl, title: pt, origin: 'mismatch' });
              console.log(`  🤖 [AI-MISMATCH-DEFERRED] Knowledge collected: ${cleanKnowledge.length} chars (pool=${aiKnowledgePool.length})`);
            }
            // Try to map AI evidence/knowledge to an answer letter
            const aiTextCandidates = [];
            if (aiExtracted?.evidence) aiTextCandidates.push({ text: aiExtracted.evidence, tag: 'ai-evidence' });
            if (aiExtracted?.knowledge) {
              const parsedFromKnowledge = this._parseAnswerText(aiExtracted.knowledge);
              if (parsedFromKnowledge && parsedFromKnowledge.length >= 18) aiTextCandidates.push({ text: parsedFromKnowledge, tag: 'ai-knowledge-answer' });
            }
            let mappedFromAiText = null;
            let mappedAiEvidenceText = '';
            for (const candidate of aiTextCandidates) {
              const mapped = tryMapTextAnswerCandidate(candidate.text, ph, ptopicSim);
              if (!mapped) continue;
              mappedFromAiText = { mapped, methodTag: candidate.tag };
              mappedAiEvidenceText = candidate.text;
              break;
            }
            if (mappedFromAiText) {
              runStats.acceptedViaAiExtraction += 1;
              addTextMappedSource.call(this, { title: pt, link: pl, hostHint: ph, sourceType: pst, topicSim: ptopicSim, obfuscation: pobf, mapped: mappedFromAiText.mapped, evidenceText: mappedAiEvidenceText, methodTag: mappedFromAiText.methodTag });
            }
            if (aiExtracted?.letter && !mappedFromAiText) {
              console.log(`  [AI-MISMATCH-DEFERRED] Letter ${aiExtracted.letter} found but IGNORED (options mismatch without validated textual mapping)`);
            }
          } catch (e) {
            console.warn(`  🤖 [AI-MISMATCH-DEFERRED] Extraction failed:`, e?.message || e);
          }
        }
      } else {
        console.log(`SearchService: ⚡ Skipping deferred AI-mismatch (midTopVote=${_midTopVote.toFixed(1)} ≥ 5.5 — sufficient evidence)`);
      }
    }

    // ═══ SNIPPET-LEVEL GABARITO EXTRACTION ═══
    // When no direct sources found, try to extract explicit gabarito from Serper
    // snippet + title text for each result. This catches cases where the SERP itself
    // reveals the answer (e.g. "Gabarito: E" in snippet) without needing page fetch.
    if (sources.length === 0 && hasOptions) {
      console.group('📋 Snippet-level gabarito extraction');
      for (const result of topResults) {
        const snipText = `${result.title || ''}. ${result.snippet || ''}`.trim();
        if (snipText.length < 60) continue;
        const snipSim = QuestionParser.questionSimilarityScore(snipText, questionStem);
        if (snipSim < 0.40) continue;
        const snipCoverage = OptionsMatchService.optionsCoverageInFreeText(originalOptions, snipText);

        // Try explicit gabarito extraction BEFORE coverage gate — a snippet like
        // "a resposta correta é a alternativa D" is valuable even when option text is absent
        // (webcache rate-limited → snippets only contain the question stem, not option bodies).
        const gabarito = EvidenceService.extractExplicitGabarito(snipText, questionStem);
        const snipPassesCoverage = snipCoverage.hasEnoughOptions && snipCoverage.ratio >= 0.5;
        // Allow through if strong option coverage OR explicit gabarito found with decent topic sim
        if (!snipPassesCoverage && !(gabarito?.letter && snipSim >= 0.50)) continue;
        if (gabarito?.letter) {
          const hostHint = this._getHostHintFromLink(result.link);
          const letter = gabarito.letter.toUpperCase();
          const baseWeight = getDomainWeight(result.link);
          const weight = baseWeight + 1.6;
          const sourceId = `snippet-gabarito:${sources.length + 1}`;
          const evidenceBlock = EvidenceService.buildEvidenceBlock({
            questionFingerprint,
            sourceId,
            sourceLink: result.link,
            hostHint,
            evidenceText: snipText,
            originalOptionsMap,
            explicitLetter: letter,
            confidenceLocal: gabarito.confidence || 0.85,
            evidenceType: 'snippet-gabarito'
          });
          sources.push({
            title: result.title || '',
            link: result.link,
            letter,
            weight,
            evidenceType: 'snippet-gabarito',
            questionPolarity,
            matchQuality: 7,
            hostHint,
            sourceId,
            evidenceBlock
          });
          runStats.acceptedForVotes += 1;
          console.log(`  ✅ Snippet gabarito: letter=${letter} host=${hostHint} sim=${snipSim.toFixed(2)} coverage=${snipCoverage.hits}/${snipCoverage.total} weight=${weight.toFixed(2)}`);
        }
      }
      console.log(`  Snippet gabarito sources added: ${sources.filter(s => s.evidenceType === 'snippet-gabarito').length}`);
      console.groupEnd();
    }

    // Snippet fallback: use Serper snippets as a lightweight evidence source
    // for AI combined inference when other sources are insufficient.
    const totalBlocked = runStats.blockedSnapshotMismatch + runStats.blockedByError + runStats.blockedOptionsMismatch + runStats.blockedObfuscation;
    const failRate = runStats.analyzed > 0 ? totalBlocked / runStats.analyzed : 0;
    const snippetEvidence = [];
    if (topResults.length > 0) {
      for (const result of topResults) {
        const snipText = `${result.title || ''}. ${result.snippet || ''}`.trim();
        if (snipText.length < 80) continue;
        const snipSim = QuestionParser.questionSimilarityScore(snipText, questionStem);
        if (snipSim < 0.20) continue;
        const snipCoverage = hasOptions ? OptionsMatchService.optionsCoverageInFreeText(originalOptions, snipText) : {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: false
        };
        const snipStrongCoverage = !hasOptions || snipCoverage.ratio >= 0.60 || snipCoverage.hits >= Math.min(3, snipCoverage.total || 3);
        // High topicSim bypass: when the snippet clearly describes the exact same question
        // (topicSim >= 0.90), admit it even without option coverage — the snippet may be
        // truncated (e.g. webcache rate-limited, only question stem visible in SERP).
        const snipHighTopicSimBypass = snipSim >= 0.90 && !snipStrongCoverage;
        if (hasOptions && (!snipStrongCoverage || snipSim < 0.32) && !snipHighTopicSimBypass) continue;
        snippetEvidence.push({
          title: result.title || '',
          link: result.link || '',
          text: snipText.slice(0, 1500),
          topicSim: snipSim,
          optionsMatch: snipStrongCoverage,
          optionsCoverage: snipCoverage,
          hostHint: this._getHostHintFromLink(result.link),
          obfuscated: false,
          paywalled: false
        });
      }
      if (snippetEvidence.length > 0) {
        console.log(`SearchService: Snippet fallback collected ${snippetEvidence.length} snippet sources (failRate=${failRate.toFixed(2)})`);
      }
    }
    const allForCombined = [...aiEvidence.map(e => ({
      ...e,
      origin: 'aiEvidence'
    })), ...collectedForCombined.map(e => ({
      ...e,
      origin: 'mismatch'
    })), ...snippetEvidence.map(e => ({
      ...e,
      origin: 'snippet'
    }))].sort((a, b) => {
      const getScore = (e) => {
        let score = e.topicSim || 0;
        if (e.origin === 'aiEvidence') score += 0.15;
        if (e.origin === 'mismatch') score += 0.05;
        return score;
      };
      return getScore(b) - getScore(a);
    });

    // ═══ DEBUG: AI Combined Pool ═══
    console.group('🧠 AI Combined Evidence Pool');
    console.log(`Direct sources found: ${sources.length}`);
    console.log(`AI evidence pool: ${aiEvidence.length} | Mismatch pool: ${collectedForCombined.length} | Snippet pool: ${snippetEvidence.length}`);
    console.log(`AI knowledge pool: ${aiKnowledgePool.length} entries`);
    if (aiKnowledgePool.length > 0) {
      aiKnowledgePool.forEach((k, i) => {
        console.log(`  📚 [${i}] host=${k.host} topicSim=${(k.topicSim || 0).toFixed(3)} knowledge=${(k.knowledge || '').length} chars origin=${k.origin || 'direct'}`);
      });
    }
    console.log(`Total for combined: ${allForCombined.length}`);
    allForCombined.forEach((e, i) => {
      console.log(`  [${i}] origin=${e.origin} host=${e.hostHint} topicSim=${(e.topicSim || 0).toFixed(3)} optMatch=${e.optionsMatch} coverage=${JSON.stringify(e.optionsCoverage)} textLen=${(e.text || '').length}`);
    });
    console.groupEnd();

    // Determine if we already have strong explicit evidence
    const hasStrongExplicit = sources.some(s => (s.weight || 0) >= 5.0);

    // If we have no explicit sources OR we need more evidence, do AI combined pass
    if (allForCombined.length > 0 && (!hasStrongExplicit || sources.length < 2)) {
      if (typeof onStatus === 'function') {
        onStatus(sources.length === 0 ? 'No explicit answer found. Using AI best-effort...' : 'Cross-checking with additional sources...');
      }

      // Only use combined evidence with minimum topic + option alignment quality.
      const minTopicSim = hasOptions ? 0.22 : 0.15;
      let relevant = allForCombined.filter(e => {
        const topicSim = e.topicSim || 0;
        if (topicSim < minTopicSim) {
          console.log(`    ❌ Filtered (low topicSim ${topicSim.toFixed(3)} < ${minTopicSim}): ${e.hostHint}`);
          return false;
        }
        if (!hasOptions) return true;
        const origin = String(e.origin || '').toLowerCase();
        const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
        const coverage = e.optionsCoverage || {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: true
        };
        const strongCoverage = e.optionsMatch === true || hasStrongOptionCoverage(coverage);

        // Risky hosts (multi-question dumps / user-generated pages):
        // aiEvidence already passed the main options-match check, so the page
        // DOES contain the user's question. Only reject when coverage is weak.
        if (origin === 'aievidence' && riskyCombinedHosts.has(host)) {
          if (!strongCoverage) {
            console.log(`    ❌ Risky aiEvidence rejected (weak coverage): host=${host} topicSim=${topicSim.toFixed(2)} coverage=${coverage.hits}/${coverage.total}`);
            return false;
          }
        }
        if (origin === 'snippet') {
          // High topicSim bypass: snippets describing the exact same question can feed
          // the AI even without option coverage (e.g. when only SERP stem is available).
          if (!strongCoverage && topicSim < 0.90) return false;
          if (topicSim < 0.30) return false;
          // Allow risky-host snippets when they have strong option coverage
          // (snippets are just title + SERP text — no cross-question risk).
          return true;
        }
        if (strongCoverage) return true;

        // Cross-question evidence: when a source has a DIFFERENT question but
        // strongly related topic (same subject area), the AI can still extract
        // relevant concepts from its answer text. This is common on Brainly where
        // the search returns a related question whose explanation contains the key
        // concept needed to answer the user's actual question.
        // Requirements: high topicSim, substantial text, NOT a snippet, origin is mismatch.
        const veryHighSimLowCoverageOk = topicSim >= 0.85 && (coverage.hits || 0) >= 1 && isTrustedCombinedHost(host) && !e.obfuscated && !e.paywalled;
        if (origin === 'mismatch' && topicSim >= 0.62 && (e.text || '').length >= 500 && (hasMediumOptionCoverage(coverage) || veryHighSimLowCoverageOk) && !riskyCombinedHosts.has(host) && !e.obfuscated && !e.paywalled && isTrustedCombinedHost(host)) {
          console.log(`    ✅ Cross-question evidence ADMITTED: host=${host} topicSim=${topicSim.toFixed(2)} textLen=${(e.text || '').length}`);
          console.log(`SearchService: Cross-question evidence admitted for AI combined: host=${host} topicSim=${topicSim.toFixed(2)} textLen=${(e.text || '').length}`);
          return true;
        } else if (origin === 'mismatch') {
          console.log(`    ❌ Cross-question REJECTED: host=${host} topicSim=${topicSim.toFixed(2)} len=${(e.text || '').length}`);
        }
        if (riskyCombinedHosts.has(host) || e.obfuscated || e.paywalled) return false;
        const mediumCoverage = hasMediumOptionCoverage(coverage);
        return mediumCoverage && topicSim >= 0.45;
      }).slice(0, 5);
      const hasReliableOptionAlignedSource = !hasOptions || relevant.some(e => {
        const coverage = e.optionsCoverage || {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: true
        };
        return e.optionsMatch === true || hasStrongOptionCoverage(coverage);
      });
      const hasAnyOptionAlignedSource = !hasOptions || relevant.some(e => {
        const coverage = e.optionsCoverage || {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: true
        };
        return e.optionsMatch === true || hasMediumOptionCoverage(coverage);
      });
      const hasTrustedRelevantSource = relevant.some(e => {
        const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
        return isTrustedCombinedHost(host);
      });
      const hasVeryStrongAlignedSource = !hasOptions || relevant.some(e => {
        const coverage = e.optionsCoverage || {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: true
        };
        return hasVeryStrongOptionCoverage(coverage);
      });
      const minRelevantSources = hasOptions && !hasStrongExplicit ? 2 : 1;

      // ═══ DEBUG: AI Combined Decision ═══
      console.group('🤖 AI Combined Decision');
      console.log(`Relevant sources after filtering: ${relevant.length}`);
      relevant.forEach((e, i) => {
        console.log(`  [${i}] origin=${e.origin} host=${e.hostHint} topicSim=${(e.topicSim || 0).toFixed(3)} optMatch=${e.optionsMatch} textLen=${(e.text || '').length}`);
      });
      console.log(`desperateMode=false | hasStrongExplicit=${hasStrongExplicit} | hasReliableOptionAligned=${hasReliableOptionAlignedSource} | minRelevantSources=${minRelevantSources}`);
      if (hasOptions && !hasReliableOptionAlignedSource && relevant.length < minRelevantSources) {
        console.log(`⛔ AI combined SKIPPED: weak option alignment (relevant=${relevant.length}, reliable=${hasReliableOptionAlignedSource})`);
        console.log(`SearchService: AI combined skipped - weak option alignment (relevant=${relevant.length}, reliable=${hasReliableOptionAlignedSource})`);
        // Only bail out completely when we have no direct evidence at all.
        // When sources[] already contains snippet-gabarito or other direct hits,
        // skip the AI combined pass but let the vote computation below use them.
        if (sources.length === 0) {
          console.groupEnd();
          return [];
        }
        console.log(`SearchService: AI combined skipped but ${sources.length} direct source(s) remain — continuing to vote computation`);
        console.groupEnd();
      }
      const strongRelevant = relevant.filter(e => {
        const host = String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase();
        const coverage = e.optionsCoverage || {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: true
        };
        const strongCoverage = !hasOptions || e.optionsMatch === true || hasStrongOptionCoverage(coverage);
        return strongCoverage && (e.topicSim || 0) >= (hasOptions ? 0.45 : 0.30) && !riskyCombinedHosts.has(host) && isTrustedCombinedHost(host) && !e.obfuscated && !e.paywalled;
      });
      const strongRelevantDomainCount = new Set(strongRelevant.map(e => String(e.hostHint || this._getHostHintFromLink(e.link)).toLowerCase()).filter(Boolean)).size;
      const hasEliteAnchoredEvidence = relevant.some(e => {
        const coverage = e.optionsCoverage || {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: true
        };
        const strongCoverage = !hasOptions || e.optionsMatch === true || hasStrongOptionCoverage(coverage);
        return String(e.origin || '') === 'aiEvidence' && strongCoverage && (e.topicSim || 0) >= 0.78 && (e.text || '').length >= 1800 && !e.obfuscated && !e.paywalled;
      });
      const corroboratingSnippetCount = relevant.filter(e => {
        if (String(e.origin || '') !== 'snippet') return false;
        const coverage = e.optionsCoverage || {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: true
        };
        return hasStrongOptionCoverage(coverage) && (e.topicSim || 0) >= 0.30;
      }).length;
      // Path 4 prerequisite: count high-confidence snippet stems whose topicSim
      // indicates they describe the exact same question (even without option text).
      const highConfidenceSnippetStems = relevant.filter(e =>
        String(e.origin || '') === 'snippet' && (e.topicSim || 0) >= 0.90
      );
      const highConfidenceSnippetDomains = new Set(
        highConfidenceSnippetStems.map(e => String(e.hostHint || '').toLowerCase()).filter(Boolean)
      ).size;
      const canProceedAISynthesisOnly = sources.length === 0 && hasOptions && (strongRelevant.length >= 3 && strongRelevantDomainCount >= 2 && hasVeryStrongAlignedSource || hasEliteAnchoredEvidence && hasReliableOptionAlignedSource && relevant.length >= 2 && corroboratingSnippetCount >= 1 ||
      // Path 3: high topic-similarity source provides strong anchor
      // even without corroborating snippets.
      hasReliableOptionAlignedSource && relevant.length >= 2 && relevant.some(e => (e.topicSim || 0) >= 0.55) && relevant.filter(e => (e.topicSim || 0) >= 0.40 && e.optionsMatch).length >= 2 ||
      // Path 4: multiple high-confidence snippet stems — the SERP snippets clearly
      // describe the exact same question even though full pages couldn't be fetched
      // (e.g. webcache rate-limited). The snippets carry the correct question text
      // (SQL operators, code fragments, etc.) that the AI can use to infer the answer.
      highConfidenceSnippetStems.length >= 2 && highConfidenceSnippetDomains >= 1 ||
      // Path 5: we have at least one very strong aiEvidence source (topicSim >= 0.95)
      // and at least one other relevant source (even if it's just a snippet).
      // This handles cases where a single strong source is found but we need a second
      // source to satisfy minRelevantSources.
      relevant.some(e => e.origin === 'aiEvidence' && (e.topicSim || 0) >= 0.95) && relevant.length >= 2);
      const isSnippetStemSynthesis = canProceedAISynthesisOnly && highConfidenceSnippetStems.length >= 2;
      const canProceedAI = relevant.length > 0 && sources.length > 0 && (!hasOptions || hasReliableOptionAlignedSource && relevant.length >= minRelevantSources) || canProceedAISynthesisOnly;
      console.log(`canProceedAI=${canProceedAI}`);
      if (canProceedAISynthesisOnly) {
        console.log(`✅ AI synthesis-only mode enabled: strongRelevant=${strongRelevant.length}, domainDiversity=${strongRelevantDomainCount}`);
        console.log(`   anchorMode=${hasEliteAnchoredEvidence} corroboratingSnippets=${corroboratingSnippetCount} snippetStems=${highConfidenceSnippetStems.length} snippetDomains=${highConfidenceSnippetDomains}`);
      }
      if (!canProceedAI) {
        console.log('❌ AI combined will NOT run');
        console.groupEnd();
      }
      if (canProceedAI) {
        const merged = relevant.map((e, i) => `SOURCE ${i + 1}: ${e.title}\n${e.text}\nLINK: ${e.link}`).join('\n\n');

        // Desperate mode disabled: knowledge-only voting is not allowed without explicit evidence.
        const knowledgePromise = Promise.resolve(null);
        try {
          const [aiAnswer, knowledgeAnswer] = await Promise.all([ApiService.inferAnswerFromEvidence(questionForInference, merged), knowledgePromise]);
          let aiLetter = this._parseAnswerLetter(aiAnswer);
          let aiWeightUsed = null;
          // Fallback: match AI prose against known option texts
          if (!aiLetter && aiAnswer && originalOptionsMap) {
            aiLetter = OptionsMatchService.findLetterByAnswerText(aiAnswer, originalOptionsMap);
            if (aiLetter) console.log(`SearchService: AI combined letter recovered via text match => ${aiLetter}`);
          }
          if (aiLetter) {
            // Skip evidence-support guard for snippet-stem synthesis: the snippets contain
            // only the question stem (no answer/option text), so lexical overlap between
            // evidence corpus and option bodies is meaningless. Trust the AI inference.
            if (canProceedAISynthesisOnly && !isSnippetStemSynthesis && hasOptions && originalOptionsMap) {
              const evidenceCorpus = QuestionParser.normalizeOption(relevant.map(e => String(e.text || '').slice(0, 2200)).join(' '));
              const optionEntries = Object.entries(originalOptionsMap).filter(([letter]) => /^[A-E]$/.test(String(letter || '').toUpperCase())).map(([letter, text]) => {
                const norm = QuestionParser.normalizeOption(String(text || ''));
                const tokens = norm.split(/\s+/).filter(token => token.length >= 4);
                const hits = tokens.reduce((count, token) => count + (evidenceCorpus.includes(token) ? 1 : 0), 0);
                const tokenRatio = tokens.length > 0 ? hits / tokens.length : 0;
                const dice = norm ? QuestionParser.diceSimilarity(evidenceCorpus, norm) : 0;
                const score = tokenRatio * 0.7 + dice * 0.3;
                return {
                  letter: String(letter).toUpperCase(),
                  score,
                  tokenRatio,
                  dice,
                  hits,
                  tokenCount: tokens.length
                };
              }).sort((a, b) => b.score - a.score);
              const topOption = optionEntries[0] || null;
              const secondOption = optionEntries[1] || null;
              const selected = optionEntries.find(entry => entry.letter === String(aiLetter).toUpperCase()) || null;
              const supportMinScore = 0.22;
              const supportMinTokenRatio = 0.38;
              const supportMargin = topOption && secondOption ? topOption.score - secondOption.score : 1;
              // Dynamic margin: when the selected option has decent support (score > 0.4),
              // allow a wider margin because lexical overlap doesn't capture semantics
              // (e.g. "Exige" vs "Não exige" share most tokens but are opposites).
              const effectiveMarginThreshold = selected && selected.score >= 0.40 ? 0.25 : selected && selected.score >= 0.30 ? 0.12 : 0.03;
              const selectedSupported = !!selected && selected.score >= supportMinScore && selected.tokenRatio >= supportMinTokenRatio && (!topOption || topOption.letter === selected.letter || supportMargin < effectiveMarginThreshold);
              console.log(`SearchService: AI synthesis support check => selected=${selected?.letter || 'none'} score=${(selected?.score || 0).toFixed(3)} tokenRatio=${(selected?.tokenRatio || 0).toFixed(3)} top=${topOption?.letter || 'none'} topScore=${(topOption?.score || 0).toFixed(3)} margin=${supportMargin.toFixed(3)}`);
              if (!selectedSupported) {
                console.log(`⛔ AI combined letter rejected by evidence-support guard (selected=${aiLetter}, top=${topOption?.letter || 'none'})`);
                aiLetter = null;
              }
            }
          }
          if (aiLetter) {
            // Weight depends on whether we already have explicit evidence.
            // When ALL sources are cross-question (different questions, no option match),
            // reduce weight significantly — cross-question evidence is inherently unreliable.
            const allCrossQuestion = relevant.every(e => String(e.origin || '') === 'mismatch' || e.optionsMatch === false);
            const aiWeight = hasStrongExplicit ? 0.3 : canProceedAISynthesisOnly ? 0.35 : allCrossQuestion ? 0.20 : 0.45;
            aiWeightUsed = aiWeight;
            console.log(`  AI combined result: letter=${aiLetter} allCrossQuestion=${allCrossQuestion} weight=${aiWeight}`);
            const sourceId = `ai-combined:${sources.length + 1}`;
            const evidenceBlock = EvidenceService.buildEvidenceBlock({
              questionFingerprint,
              sourceId,
              sourceLink: '',
              hostHint: 'ai',
              evidenceText: aiAnswer || merged,
              originalOptionsMap,
              explicitLetter: aiLetter,
              confidenceLocal: hasStrongExplicit ? 0.42 : 0.5,
              evidenceType: 'ai-combined'
            });
            sources.push({
              title: 'AI (combined evidence)',
              link: '',
              letter: aiLetter,
              weight: aiWeight,
              evidenceType: 'ai-combined',
              questionPolarity,
              hostHint: 'ai',
              sourceId,
              evidenceBlock
            });
            runStats.acceptedForVotes += 1;
            console.log(`SearchService: AI combined => Letra ${aiLetter}, weight=${aiWeight}`);
          }

          // Process knowledge-based answer as separate vote
          if (knowledgeAnswer) {
            let knLetter = this._parseAnswerLetter(knowledgeAnswer);
            if (!knLetter && originalOptionsMap) {
              knLetter = OptionsMatchService.findLetterByAnswerText(knowledgeAnswer, originalOptionsMap);
              if (knLetter) console.log(`SearchService: AI knowledge letter recovered via text match => ${knLetter}`);
            }
            if (knLetter) {
              // Knowledge vote gets HIGHER weight than evidence-based in desperate mode
              // because the evidence is thin (just question text, no real answer).
              const knWeight = 0.55;
              const knSourceId = `ai-knowledge:${sources.length + 1}`;
              const knEvidenceBlock = EvidenceService.buildEvidenceBlock({
                questionFingerprint,
                sourceId: knSourceId,
                sourceLink: '',
                hostHint: 'ai',
                evidenceText: knowledgeAnswer || '',
                originalOptionsMap,
                explicitLetter: knLetter,
                confidenceLocal: 0.60,
                evidenceType: 'ai-knowledge'
              });
              sources.push({
                title: 'AI (knowledge-based)',
                link: '',
                letter: knLetter,
                weight: knWeight,
                evidenceType: 'ai-knowledge',
                questionPolarity,
                hostHint: 'ai',
                sourceId: knSourceId,
                evidenceBlock: knEvidenceBlock
              });
              runStats.acceptedForVotes += 1;
              console.log(`SearchService: AI knowledge => Letra ${knLetter}, weight=${knWeight}`);
              if (aiLetter && knLetter !== aiLetter) {
                console.warn(`SearchService: CONFLICT evidence=${aiLetter} vs knowledge=${knLetter} — knowledge (${knWeight}) overrides evidence (${aiWeightUsed ?? 'n/a'})`);
              }
            }
          }
          console.groupEnd();
        } catch (error) {
          console.warn('AI evidence inference failed:', error);
          console.groupEnd();
        }
      }
    }

    // ═══ PAGE-LEVEL GABARITO TIE-BREAKER ═══
    if (pageGabarito) {
      const pgLetter = (pageGabarito || '').toUpperCase().trim();
      if (/^[A-E]$/.test(pgLetter)) {
        const sourceId = `page-gabarito:${sources.length + 1}`;
        const evidenceBlock = EvidenceService.buildEvidenceBlock({
          questionFingerprint,
          sourceId,
          sourceLink: '',
          hostHint: 'page',
          evidenceText: String(pageGabarito || ''),
          originalOptionsMap,
          explicitLetter: pgLetter,
          confidenceLocal: 0.9,
          evidenceType: 'page-gabarito'
        });
        sources.push({
          title: 'Page Gabarito',
          link: '',
          letter: pgLetter,
          weight: 5.0,
          evidenceType: 'page-gabarito',
          questionPolarity,
          hostHint: 'page',
          sourceId,
          evidenceBlock
        });
        runStats.acceptedForVotes += 1;
      }
    }

    // ═══ AI COMBINED REFLECTION FALLBACK ═══
    // When no sources were accepted for voting but we accumulated knowledge
    // from AI page extraction, try a combined reflection as last resort.
    if (sources.length === 0 && aiKnowledgePool.length > 0 && hasOptions) {
      console.group('🧠 AI Combined Reflection Fallback');
      console.log(`No voting sources. Knowledge pool has ${aiKnowledgePool.length} entries from AI extraction.`);
      aiKnowledgePool.forEach((k, i) => {
        console.log(`  [${i}] host=${k.host} topicSim=${(k.topicSim || 0).toFixed(3)} knowledge=${(k.knowledge || '').length} chars origin=${k.origin || 'direct'}`);
      });
      if (typeof onStatus === 'function') {
        onStatus('Reflecting on accumulated knowledge...');
      }
      try {
        const reflectionResult = await ApiService.aiReflectOnSources(questionForInference, aiKnowledgePool);
        if (reflectionResult?.letter) {
          let reflectLetter = reflectionResult.letter.toUpperCase();
          if (/^[A-E]$/.test(reflectLetter)) {
            // Remap if options were shuffled
            reflectLetter = this._remapLetterIfShuffled(reflectLetter, '', originalOptionsMap);
            console.log(`  🧠 [REFLECTION] Letter found: ${reflectLetter}`);
            const reflectWeight = 1.2; // Lower than direct evidence but higher than zero
            const sourceId = `ai-reflection:${sources.length + 1}`;
            const evidenceBlock = EvidenceService.buildEvidenceBlock({
              questionFingerprint,
              sourceId,
              sourceLink: '',
              hostHint: 'ai-reflection',
              evidenceText: reflectionResult.response || '',
              originalOptionsMap,
              explicitLetter: reflectLetter,
              confidenceLocal: 0.55,
              evidenceType: 'ai-combined-reflection'
            });
            sources.push({
              title: 'AI (combined reflection)',
              link: '',
              letter: reflectLetter,
              weight: reflectWeight,
              evidenceType: 'ai-combined-reflection',
              questionPolarity,
              hostHint: 'ai-reflection',
              sourceId,
              evidenceBlock
            });
            runStats.acceptedForVotes += 1;
            console.log(`  ✅ AI reflection accepted: letter=${reflectLetter} weight=${reflectWeight}`);
          } else {
            console.log(`  ❌ AI reflection returned invalid letter: "${reflectionResult.letter}"`);
          }
        } else {
          console.log(`  ❌ AI reflection returned no letter (INCONCLUSIVO)`);
        }
      } catch (e) {
        console.warn(`  🧠 AI reflection error:`, e?.message || e);
      }
      console.groupEnd();
    } else if (sources.length === 0 && aiKnowledgePool.length === 0) {
      console.log('🧠 No knowledge pool accumulated — reflection fallback skipped');
    }
    if (sources.length === 0) {
      logRunSummary('no-sources');
      return [];
    }
    const {
      votes,
      baseVotes,
      evidenceVotes,
      bestLetter,
      resultState,
      reason,
      confidence,
      evidenceConsensus
    } = EvidenceService.computeVotesAndState(sources);

    // ═══ DEBUG: Final Voting Breakdown ═══
    console.group('🏳️ Final Voting Breakdown');
    console.log('All sources:');
    sources.forEach((s, i) => {
      console.log(`  [${i}] host=${s.hostHint} letter=${s.letter} weight=${s.weight?.toFixed?.(2) || s.weight} type=${s.evidenceType} method=${s.extractionMethod || 'n/a'}`);
    });
    console.log('Votes:', JSON.stringify(votes));
    console.log('Base votes:', JSON.stringify(baseVotes));
    console.log('Evidence votes:', JSON.stringify(evidenceVotes));
    console.log(`Best letter: ${bestLetter} | State: ${resultState} | Confidence: ${confidence} | Reason: ${reason}`);
    console.log('Evidence consensus:', JSON.stringify(evidenceConsensus));
    console.groupEnd();
    let answerText = '';
    if (bestLetter && originalOptionsMap[bestLetter]) {
      answerText = originalOptionsMap[bestLetter];
    }
    const answer = bestLetter ? `Letra ${bestLetter}: ${answerText}`.trim() : (sources[0]?.answer || '').trim();

    // ═══ Determine evidence tier ═══
    const isAiOnly = sources.every(s => s.evidenceType === 'ai' || s.evidenceType === 'ai-combined');
    const hasExplicitEvidence = sources.some(s => s.evidenceType && s.evidenceType !== 'ai' && s.evidenceType !== 'ai-combined');
    let evidenceTier = 'EVIDENCE_WEAK';
    if (isAiOnly) {
      evidenceTier = 'AI_ONLY';
    } else if (resultState === 'confirmed') {
      evidenceTier = 'EVIDENCE_STRONG';
    } else if (hasExplicitEvidence && (evidenceConsensus?.bestEvidenceCount || 0) >= 1) {
      evidenceTier = 'EVIDENCE_MEDIUM';
    }
    let overview = null;
    try {
      const overviewCandidates = [];
      const seenOverviewKeys = new Set();
      const pushOverviewCandidate = candidate => {
        const title = String(candidate?.title || '').trim();
        const link = String(candidate?.link || '').trim();
        const text = String(candidate?.text || '').trim();
        if (text.length < 120) return;
        const key = `${title}|${link}`.slice(0, 500);
        if (seenOverviewKeys.has(key)) return;
        seenOverviewKeys.add(key);
        overviewCandidates.push({
          title,
          link,
          text
        });
      };
      for (const source of sources) {
        if (!source || source.evidenceType === 'ai' || source.evidenceType === 'ai-combined') continue;
        const text = source?.evidence || source?.evidenceBlock?.evidenceText || '';
        pushOverviewCandidate({
          title: source.title,
          link: source.link,
          text
        });
      }
      for (const evidence of allForCombined) {
        if (!evidence) continue;
        const coverage = evidence.optionsCoverage || {
          hits: 0,
          total: 0,
          ratio: 0,
          hasEnoughOptions: false
        };
        const alignedEnough = !hasOptions || evidence.optionsMatch === true || hasMediumOptionCoverage(coverage);
        if (!alignedEnough) continue;
        if ((evidence.topicSim || 0) < 0.28) continue;
        pushOverviewCandidate({
          title: evidence.title,
          link: evidence.link,
          text: evidence.text
        });
      }
      if (overviewCandidates.length >= 2) {
        overview = await ApiService.generateOverviewFromEvidence(questionForInference, overviewCandidates.slice(0, 6));
      }
    } catch (error) {
      console.warn('SearchService: failed to build overview payload:', error?.message || String(error));
    }
    const finalPayload = [{
      question: questionText,
      answer,
      answerLetter: bestLetter,
      answerText,
      optionsMap: originalOptionsMap && Object.keys(originalOptionsMap).length >= 2 ? {
        ...originalOptionsMap
      } : null,
      sources,
      bestLetter,
      votes,
      baseVotes,
      evidenceVotes,
      evidenceConsensus,
      confidence,
      resultState,
      reason,
      evidenceTier,
      questionPolarity,
      title: sources[0]?.title || 'Result',
      aiFallback: isAiOnly,
      questionFingerprint,
      runStats,
      googleMetaSignals,
      overview
    }];
    logRunSummary(resultState);
    return finalPayload;
  },
  async searchAndRefine(questionText, originalQuestionWithOptions = '', onStatus = null) {
    const questionForInference = originalQuestionWithOptions || questionText;
    const questionFingerprint = await this._canonicalHash(questionForInference);
    const buildInconclusiveNoEvidence = reason => [{
      question: questionText,
      answer: 'INCONCLUSIVO: sem evidência externa confiável para marcar alternativa.',
      answerLetter: null,
      answerText: 'Sem evidência externa confiável para marcar alternativa.',
      aiFallback: false,
      evidenceTier: 'EVIDENCE_WEAK',
      resultState: 'inconclusive',
      reason,
      confidence: 0.12,
      votes: undefined,
      sources: []
    }];
    const cachedDecision = await this._getCachedDecisionForFingerprint(questionFingerprint);
    const cachedResult = cachedDecision ? this._buildResultFromCachedDecision(questionText, questionForInference, cachedDecision) : null;
    const cachedItem = cachedResult?.[0] || null;
    const hasCached = !!cachedItem;
    const results = await ApiService.searchWithSerper(questionText);
    const serperMeta = results?._serperMeta || null;
    const searchProvider = results?._searchProvider || null;
    const mergedResults = await this._mergeCachedSourcesIntoResults(questionFingerprint, results || []);
    if (serperMeta) mergedResults._serperMeta = serperMeta;
    if (searchProvider) mergedResults._searchProvider = searchProvider;
    if (!mergedResults || mergedResults.length === 0) {
      if (hasCached) {
        await this._recordSearchMetrics({
          cacheHit: true,
          outcome: 'cache-fallback-no-search-results',
          resultState: cachedItem.resultState || 'confirmed',
          evidenceTier: cachedItem.evidenceTier || 'EVIDENCE_STRONG',
          runStats: null,
          bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || '',
          confidence: Number(cachedItem.confidence || 0.9)
        });
        return cachedResult;
      }
      const inconclusive = buildInconclusiveNoEvidence('no_search_results');
      const inconclusiveItem = inconclusive[0] || {};
      await this._recordSearchMetrics({
        cacheHit: false,
        outcome: 'no-search-results',
        resultState: inconclusiveItem.resultState || 'inconclusive',
        evidenceTier: inconclusiveItem.evidenceTier || 'EVIDENCE_WEAK',
        runStats: null,
        bestLetter: '',
        confidence: Number(inconclusiveItem.confidence || 0.12)
      });
      return inconclusive;
    }
    const refined = await this.refineFromResults(questionText, mergedResults, originalQuestionWithOptions);
    if (!refined || refined.length === 0) {
      if (hasCached) {
        await this._recordSearchMetrics({
          cacheHit: true,
          outcome: 'cache-fallback-no-evidence',
          resultState: cachedItem.resultState || 'confirmed',
          evidenceTier: cachedItem.evidenceTier || 'EVIDENCE_STRONG',
          runStats: null,
          bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || '',
          confidence: Number(cachedItem.confidence || 0.9)
        });
        return cachedResult;
      }
      const inconclusive = buildInconclusiveNoEvidence('no_evidence');
      const inconclusiveItem = inconclusive[0] || {};
      await this._recordSearchMetrics({
        cacheHit: false,
        outcome: 'no-evidence',
        resultState: inconclusiveItem.resultState || 'inconclusive',
        evidenceTier: inconclusiveItem.evidenceTier || 'EVIDENCE_WEAK',
        runStats: null,
        bestLetter: '',
        confidence: Number(inconclusiveItem.confidence || 0.12)
      });
      return inconclusive;
    }
    const resultItem = refined[0] || {};
    const freshIsStrongConfirmed = resultItem.resultState === 'confirmed' && resultItem.evidenceTier === 'EVIDENCE_STRONG';
    const freshLetter = String(resultItem.answerLetter || resultItem.bestLetter || '').toUpperCase();
    const cachedLetter = String(cachedItem?.answerLetter || cachedItem?.bestLetter || '').toUpperCase();
    const freshHasNonAiEvidence = Array.isArray(resultItem.sources) && resultItem.sources.some(s => s?.evidenceType && s.evidenceType !== 'ai' && s.evidenceType !== 'ai-combined');
    const freshDiffersFromCache = !!(freshLetter && cachedLetter && freshLetter !== cachedLetter);
    const freshUpgradeCandidate = freshDiffersFromCache && freshHasNonAiEvidence && resultItem.evidenceTier !== 'AI_ONLY' && Number(resultItem.confidence || 0) >= 0.72;

    // If cache exists, prefer fresh only when it is strongly confirmed; otherwise keep cached.
    if (hasCached && !freshIsStrongConfirmed && !freshUpgradeCandidate) {
      await this._recordSearchMetrics({
        cacheHit: true,
        outcome: 'cache-fallback-fresh-weak',
        resultState: cachedItem.resultState || 'confirmed',
        evidenceTier: cachedItem.evidenceTier || 'EVIDENCE_STRONG',
        runStats: resultItem.runStats || null,
        bestLetter: cachedItem.bestLetter || cachedItem.answerLetter || '',
        confidence: Number(cachedItem.confidence || 0.9)
      });
      return cachedResult;
    }
    const cacheSources = Array.isArray(resultItem.sources) ? resultItem.sources : [];
    const hasLinkSource = cacheSources.some(s => String(s?.link || '').trim().length > 0);
    if (hasLinkSource || resultItem.resultState === 'confirmed') {
      await this._setCachedDecisionForFingerprint(questionFingerprint, resultItem, cacheSources);
    }
    if (hasCached && freshIsStrongConfirmed && freshLetter && cachedLetter && freshLetter !== cachedLetter) {
      console.warn(`SearchService: cache corrected from ${cachedLetter} to ${freshLetter} by fresh strong evidence`);
    }
    if (hasCached && freshUpgradeCandidate) {
      console.warn(`SearchService: cache updated by fresh non-AI evidence (${cachedLetter} -> ${freshLetter})`);
    }
    await this._recordSearchMetrics({
      cacheHit: hasCached,
      outcome: hasCached ? freshUpgradeCandidate ? 'cache-revalidated-upgrade' : 'cache-revalidated' : 'refined',
      resultState: resultItem.resultState || 'inconclusive',
      evidenceTier: resultItem.evidenceTier || 'EVIDENCE_WEAK',
      runStats: resultItem.runStats || null,
      bestLetter: resultItem.bestLetter || resultItem.answerLetter || '',
      confidence: Number(resultItem.confidence || 0)
    });
    return refined;
  }
};

