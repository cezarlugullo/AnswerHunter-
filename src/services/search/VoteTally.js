/**
 * VoteTally.js
 * Pure weighted-vote tally for gabarito sources, with one crucial correction:
 *
 * KNOWLEDGE VOTES ARE CORRELATED, NOT INDEPENDENT.
 * When the extraction LLM can't find the answer in a page, it answers from its
 * own knowledge (evidenceType 'ai-knowledge'). Running it on 3 different pages
 * produces 3 copies of the SAME guess — summing them (3 × 0.45 = 1.35) fakes a
 * strong consensus ("confirmed 99%") out of a single opinion. Here, knowledge
 * votes for the same letter contribute only their MAX confidence.
 *
 * Grounded votes (real page evidence, verified quotes, snippets) sum normally —
 * different pages agreeing IS independent evidence.
 *
 * No dependencies, no chrome.* — safe to unit test under node --test.
 */

/**
 * @param {Array<{letter?:string, confidence?:number, evidenceType?:string, evidenceVerified?:boolean|null}>} sources
 * @returns {{
 *   votes: Object<string, number>,
 *   voteCounts: Object<string, number>,
 *   bestLetter: string|null,
 *   bestScore: number,
 *   totalScore: number,
 *   dominance: number,
 *   hasGroundedEvidence: boolean,  // alguma fonte com citação verificada no texto real
 *   knowledgeOnly: boolean          // todos os votos são palpite de conhecimento da IA
 * }}
 */
export function tallySourceVotes(sources = []) {
    const votes = {};
    const voteCounts = {};
    const knowledgeBest = {};

    for (const src of sources) {
        const letter = String(src?.letter || '').toUpperCase();
        if (!/^[A-E]$/.test(letter)) continue;
        const conf = Number(src?.confidence) || 0;
        voteCounts[letter] = (voteCounts[letter] || 0) + 1;

        if (src?.evidenceType === 'ai-knowledge') {
            knowledgeBest[letter] = Math.max(knowledgeBest[letter] || 0, conf);
            continue;
        }
        votes[letter] = (votes[letter] || 0) + conf;
    }

    for (const [letter, conf] of Object.entries(knowledgeBest)) {
        votes[letter] = (votes[letter] || 0) + conf;
    }

    const sorted = Object.entries(votes).sort((a, b) =>
        b[1] - a[1]
        || (voteCounts[b[0]] || 0) - (voteCounts[a[0]] || 0)
        || a[0].localeCompare(b[0])
    );
    const bestLetter = sorted.length > 0 ? sorted[0][0] : null;
    const bestScore = sorted.length > 0 ? sorted[0][1] : 0;
    const totalScore = sorted.reduce((acc, [, v]) => acc + v, 0);
    const dominance = totalScore > 0 ? bestScore / totalScore : 0;

    const hasGroundedEvidence = sources.some(s => s?.evidenceVerified === true);
    const votingSources = sources.filter(s => /^[A-E]$/.test(String(s?.letter || '').toUpperCase()));
    const knowledgeOnly = votingSources.length > 0
        && votingSources.every(s => s?.evidenceType === 'ai-knowledge' || s?.evidenceType === 'ai-reasoning');

    return { votes, voteCounts, bestLetter, bestScore, totalScore, dominance, hasGroundedEvidence, knowledgeOnly };
}
