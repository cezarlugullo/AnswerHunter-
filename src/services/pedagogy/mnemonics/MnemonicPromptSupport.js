import {
    buildExactSciencesMnemonicElements,
    inferPedagogicalDomain,
} from '../domains/ExactSciencesPedagogy.js';

const mnemonicStopwords = new Set([
    'que', 'para', 'com', 'sem', 'dos', 'das', 'nos', 'nas', 'uma', 'uns', 'umas', 'de', 'da', 'do',
    'e', 'o', 'a', 'os', 'as', 'no', 'na', 'em', 'por', 'ou', 'ao', 'aos', 'se', 'um', 'mais', 'menos',
    'sobre', 'apenas', 'indica', 'afirmativa', 'fator', 'importante', 'desempenho', 'assinale', 'marque',
    'alternativa', 'correta', 'incorreta', 'seguinte', 'questao', 'questão', 'opcao', 'opção', 'item'
]);

export function normalizeMnemonicText(text = '') {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function extractAlternatives(questionText = '') {
    const raw = normalizeMnemonicText(questionText);
    const matches = [...raw.matchAll(/(?:^|\n)([A-E])\s*[\)\.\-:]\s*([\s\S]*?)(?=(?:\n[A-E]\s*[\)\.\-:])|$)/gim)];
    return matches.map((m) => ({
        letter: (m[1] || '').toUpperCase(),
        text: normalizeMnemonicText(m[2] || '')
    }));
}

export function extractTopKeywords(text = '', limit = 4) {
    const counts = new Map();
    const tokens = String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => token.length >= 4 && !mnemonicStopwords.has(token));

    for (const token of tokens) {
        counts.set(token, (counts.get(token) || 0) + 1);
    }

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, limit)
        .map(([token]) => token);
}

export function inferMnemonicScenario(questionText = '', answerText = '') {
    const combined = `${questionText}\n${answerText}`;
    if (/(?:^|\n)\s*[IVX]+\s*[\)\.\-:]/im.test(combined) || /\bI\b.*\bII\b.*\bIII\b/im.test(combined)) return 'affirmatives';
    if (/\b(ordem|sequ[eê]ncia|etapas|fases|cronol[oó]gica|passos?)\b/i.test(combined)) return 'sequence';
    if (/\b(vs\.?|versus|diferen[cç]a|compare|comparar|contraste)\b/i.test(combined)) return 'comparison';
    if (/[A-Z]{2,}(?:\s*[\/\-→>]+\s*[A-Z0-9]{1,})+/.test(combined) || /\b(?:sql|api|http|tcp|udp|ansi|iso|json|html|css|fsrs)\b/i.test(combined)) return 'technical';
    if (/[=<>±×÷∑∫√]|\\frac|\\sqrt|\\lim|\$[^$]+\$/.test(combined)) return 'formula';
    return 'concept';
}

export function inferMnemonicType(questionText = '', answerText = '', preferredType = 'any') {
    const normalized = String(preferredType || 'any').trim().toLowerCase();
    if (normalized && normalized !== 'any' && normalized !== 'auto') return normalized;

    const scenario = inferMnemonicScenario(questionText, answerText);
    if (scenario === 'sequence') return 'acronym';
    if (scenario === 'technical') return 'keyword';
    if (scenario === 'formula') return 'visual';
    if (scenario === 'affirmatives') return 'story';
    if (scenario === 'comparison') return 'visual';

    const answerLen = normalizeMnemonicText(answerText).length;
    if (answerLen > 0 && answerLen <= 45) return 'keyword';
    return 'story';
}

export function buildMnemonicKeyElements(questionText = '', answerText = '', concept = '') {
    const parts = [];
    const exactSciencesParts = inferPedagogicalDomain(questionText, `${answerText}\n${concept}`) === 'exact_sciences'
        ? buildExactSciencesMnemonicElements(questionText, answerText, concept)
        : [];
    const alternatives = extractAlternatives(questionText);
    const correctAlt = alternatives.find((alt) => answerText && new RegExp(`^${alt.letter}\b`, 'i').test(answerText))
        || alternatives.find((alt) => answerText && alt.text && answerText.toLowerCase().includes(alt.text.toLowerCase().slice(0, 20)));

    if (concept) parts.push(`Conceito central → ${concept}`);
    if (correctAlt?.text) parts.push(`Resposta correta → ${correctAlt.text.slice(0, 90)}`);
    exactSciencesParts.forEach((item) => {
        if (parts.length >= 4) return;
        parts.push(item);
    });

    const keywords = extractTopKeywords(`${questionText}\n${answerText}`, 4);
    keywords.forEach((kw) => {
        if (parts.length >= 4) return;
        parts.push(`${kw} → pista-chave do tema`);
    });

    return [...new Set(parts)].slice(0, 4);
}

export function buildMnemonicSignature(prepared) {
    return JSON.stringify({
        version: 'mnemonic-exact-v3',
        concept: prepared?.concept || '',
        scenario: prepared?.scenario || '',
        type: prepared?.resolvedType || '',
        answer: prepared?.answerText || '',
        question: String(prepared?.rawQuestion || '').slice(0, 220)
    });
}

export function trimMnemonicText(text = '', maxChars = 220, maxWords = 40) {
    const normalized = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/^['"“”‘’]+|['"“”‘’]+$/g, '')
        .trim();

    if (!normalized) return '';

    const words = normalized.split(/\s+/).filter(Boolean).slice(0, maxWords);
    let result = words.join(' ');
    if (result.length > maxChars) result = `${result.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
    return result.trim();
}

export function scoreMnemonicPayload(payload, prepared) {
    if (!payload || typeof payload !== 'object') return 0;
    let score = 0;
    const mnemonic = String(payload.mnemonic || '').trim();
    const visualization = String(payload.visualization || '').trim();
    const connection = String(payload.connection || '').trim();
    const selfTest = String(payload.selfTest || '').trim();
    const keyElements = Array.isArray(payload.keyElements) ? payload.keyElements.filter(Boolean) : [];
    const weirdWordplay = /\b\p{Ll}*\p{Lu}{2,}\p{Ll}+\b/gu.test(mnemonic)
        || /\b(?:fra[cç][aã]o|limite|fun[cç][aã]o|termo|sigla)\b/i.test(mnemonic) && /\b(?:pizza|rob[oô]|boneco|monstro)\b/i.test(mnemonic) && /\p{Lu}{2,}/u.test(mnemonic);

    if (mnemonic.length >= 8 && mnemonic.length <= 280 && !/^para lembrar[:\s]/i.test(mnemonic)) score += 3;
    if (mnemonic.split(/\s+/).filter(Boolean).length <= 12) score += 1;
    if (keyElements.length >= 2) score += 2;
    if (visualization.length >= 30) score += 2;
    if (connection.length >= 20) score += 2;
    if (selfTest.length >= 12 && /\?/i.test(selfTest)) score += 1;
    if (prepared?.resolvedType && payload.type === prepared.resolvedType) score += 1;
    if (weirdWordplay) score -= 3;
    return score;
}

export function finalizeMnemonicPayload(payload, prepared) {
    const normalized = {
        emoji: String(payload?.emoji || '').trim() || '🧠',
        mnemonic: trimMnemonicText(payload?.mnemonic || payload?.hook || '', 120, 12),
        keyElements: Array.isArray(payload?.keyElements)
            ? payload.keyElements
                .map((item) => trimMnemonicText(item, 110, 14))
                .filter(Boolean)
                .slice(0, 3)
            : [],
        visualization: trimMnemonicText(payload?.visualization || payload?.visual || '', 420, 75),
        connection: trimMnemonicText(payload?.connection || payload?.howToUse || '', 300, 55),
        selfTest: trimMnemonicText(payload?.selfTest || payload?.self_test || '', 180, 24),
        type: String(payload?.type || prepared?.resolvedType || 'story').trim() || 'story',
        concept: prepared.concept,
        scenario: prepared.scenario,
        requestedType: prepared.requestedType,
        resolvedType: prepared.resolvedType,
        signature: prepared.signature,
    };

    if (!normalized.selfTest.endsWith('?')) {
        normalized.selfTest = normalized.selfTest ? `${normalized.selfTest.replace(/[.!…]+$/g, '').trim()}?` : '';
    }

    if (normalized.keyElements.length === 0 && Array.isArray(prepared?.keyElements)) {
        normalized.keyElements = prepared.keyElements.slice(0, 2);
    }

    normalized.qualityScore = scoreMnemonicPayload(normalized, prepared);
    return normalized;
}
