/**
 * helpers.js
 * Pure utility functions
 */

export function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function cleanText(text) {
    return (text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isLikelyQuestion(text) {
    if (!text) return false;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 30) return false;
    const hasQuestionMark = clean.includes('?');
    const hasKeywords = /Quest(?:a|ã)o|Pergunta|Exerc[íi]cio|Enunciado|Atividade/i.test(clean);
    const hasOptions = /(?:^|\s)[A-E]\s*[\)\.\-:]/i.test(clean);
    const looksLikeMenu = /menu|disciplina|progresso|conteudos|concluidos|simulados|acessar|voltar|avançar|finalizar|marcar para revis[aã]o/i.test(clean);
    return (hasQuestionMark || hasKeywords || hasOptions) && !looksLikeMenu;
}

export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Function to format question separating statement from alternatives
export function formatQuestionText(text) {
    if (!text) return '';
    const translate = (key, fallback) => {
        try {
            if (typeof window !== 'undefined' && typeof window.__answerHunterTranslate === 'function') {
                return window.__answerHunterTranslate(key);
            }
        } catch (_) {
            // no-op
        }
        return fallback;
    };

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const trimGlobalNoise = (raw) => {
        if (!raw) return '';
        // Only cut on isolated labels (start of line or after dot/break),
        // never in the middle of sentences like "Check the correct alternative..."
        const noiseRe = /(?:^|\n)\s*(?:Gabarito(?:\s+Comentado)?|Resposta\s+sugerida|Confira\s+o\s+gabarito|Resposta\s+certa|Voc[eê]\s+selecionou|Fontes?\s*\(\d+\)|check_circle)\b/im;
        const idx = raw.search(noiseRe);
        if (idx > 10) return raw.substring(0, idx).trim();
        return raw.trim();
    };
    const trimNoise = (s) => {
        if (!s) return s;
        // Only cut when the label appears isolated (not inside "check the correct alternative")
        const noiseRe = /(?:^|\n)\s*(?:Resposta\s+correta\s*[:\-]|Parab[eé]ns|Gabarito(?:\s+Comentado)?|Alternativa\s+correta\s*[:\-]|Confira\s+o\s+gabarito|Resposta\s+certa|Voc[eê]\s+selecionou|Marcar\s+para\s+revis[ãa]o)/im;
        const idx = s.search(noiseRe);
        if (idx > 10) return s.substring(0, idx).trim();
        return s.trim();
    };

    // NEW: Limit text to only the first question (cut after 5 alternatives or next question)
    const limitToFirstQuestion = (raw) => {
        const lines = raw.split('\n');
        const result = [];
        let altCount = 0;
        const altRe = /^([A-E])\s*[\)\.\-:]/i;
        const newQuestionRe = /^\d+\s*[\.\):]?\s*(Marcar para|Quest[ãa]o|\(.*\/\d{4})/i;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // If new question start found, stop
            if (newQuestionRe.test(line.trim()) && altCount >= 2) {
                break;
            }

            // Count alternatives
            if (altRe.test(line.trim())) {
                altCount++;
            }

            result.push(line);

            // If we already have 5 alternatives (A-E), stop after the last one
            if (altCount >= 5) {
                // Continue only if the next line is part of alternative E
                const nextLines = lines.slice(result.length, result.length + 2);
                const hasMoreAlt = nextLines.some(l => altRe.test(l.trim()));
                if (!hasMoreAlt) break;
            }
        }

        return result.join('\n');
    };

    const rawTrimmed = trimGlobalNoise(text);
    let normalized = rawTrimmed.replace(/\r\n/g, '\n');
    const inlineAltBreakRe = /(?:^|\s)([A-E])\s*[\)\.\-:](?=\s*\S)/gi;
    const inlineAltMatches = normalized.match(inlineAltBreakRe) || [];
    if (inlineAltMatches.length >= 2) {
        normalized = normalized.replace(inlineAltBreakRe, (_m, letter) => `\n${letter.toUpperCase()}) `);
    }

    const limitedText = limitToFirstQuestion(normalized);
    const normalizedForParsing = limitedText;

    const looksLikeAcronymStart = (body) => {
        const match = (body || '').match(/^([A-Z\u00C0-\u00DC]{2,5})(\b|\s*\()/);
        return !!match;
    };

    const isLikelyFalseLooseAlt = (letter, body, lineIndex, hasAlternatives) => {
        if (hasAlternatives) return false;
        if (letter !== 'A') return false;
        if (lineIndex <= 2 && looksLikeAcronymStart(body)) return true;
        return false;
    };

    const render = (enunciado, alternatives) => {
        // Limit to 5 alternatives max
        const limitedAlts = alternatives.slice(0, 5);
        const formattedAlternatives = limitedAlts
            .map(a => `
                    <div class="alternative">
                        <span class="alt-letter">${escapeHtml(a.letter)}</span>
                        <span class="alt-text">${escapeHtml(a.body)}</span>
                    </div>
                `)
            .join('');
        const enunciadoHtml = `
                <div class="question-section">
                    <div class="question-section-title">${escapeHtml(translate('result.statement', 'Statement'))}</div>
                    <div class="question-enunciado">${escapeHtml(enunciado)}</div>
                </div>`;

        if (!formattedAlternatives) {
            return enunciadoHtml;
        }

        return `
                ${enunciadoHtml}
                <div class="question-section">
                    <div class="question-section-title">${escapeHtml(translate('result.options', 'Options'))}</div>
                    <div class="question-alternatives">${formattedAlternatives}</div>
                </div>
            `;
    };

    const parseByLines = (raw, allowLoose = false) => {
        const lines = raw.split(/\n+/).map(line => line.trim()).filter(Boolean);
        const alternatives = [];
        const enunciadoParts = [];
        let currentAlt = null;
        const altStartRe = allowLoose
            ? /^([A-E])\s*(?:[\)\.\-:]\s*|\s+)(.+)$/i
            : /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
        const altSoloRe = /^([A-E])$/i;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const m = line.match(altStartRe);
            if (m) {
                const letter = m[1].toUpperCase();
                const body = trimNoise(clean(m[2]));
                if (allowLoose && isLikelyFalseLooseAlt(letter, body, i, alternatives.length > 0)) {
                    enunciadoParts.push(line);
                    continue;
                }
                if (currentAlt) alternatives.push(currentAlt);
                currentAlt = { letter, body };
                continue;
            }
            const solo = line.match(altSoloRe);
            if (solo) {
                if (currentAlt) alternatives.push(currentAlt);
                currentAlt = { letter: solo[1].toUpperCase(), body: '' };
                continue;
            }

            if (currentAlt) {
                currentAlt.body = trimNoise(clean(`${currentAlt.body} ${line}`));
            } else {
                enunciadoParts.push(line);
            }
        }

        if (currentAlt) alternatives.push(currentAlt);

        return { enunciado: clean(enunciadoParts.join(' ')), alternatives };
    };

    const parsedByLines = parseByLines(normalizedForParsing, false);
    if (parsedByLines.alternatives.length >= 2) {
        return render(parsedByLines.enunciado, parsedByLines.alternatives);
    }

    const parsedByLooseLines = parseByLines(normalizedForParsing, true);
    if (parsedByLooseLines.alternatives.length >= 2) {
        return render(parsedByLooseLines.enunciado, parsedByLooseLines.alternatives);
    }

    // Fallback: inline alternatives (no line break), after punctuation
    const inlineAltPattern = /(^|[\\n:;?.!]\\s+)([A-E])\\s+(?=[A-Za-z])/g;
    const inlineAltLetters = new Set();
    normalized.replace(inlineAltPattern, (_m, _prefix, letter) => {
        inlineAltLetters.add(letter.toUpperCase());
        return _m;
    });
    if (inlineAltLetters.size >= 2) {
        const normalizedInline = normalized.replace(inlineAltPattern, (m, prefix, letter, offset, full) => {
            const after = full.slice(offset + m.length);
            if (letter.toUpperCase() === 'A') {
                const nextWord = after.match(/^([A-Z\u00C0-\u00DC]{2,5})\b/);
                if (nextWord) return m;
            }
            return `${prefix}\n${letter}) `;
        });
        const parsedInline = parseByLines(normalizedInline, false);
        if (parsedInline.alternatives.length >= 2) {
            return render(parsedInline.enunciado, parsedInline.alternatives);
        }
    }

    // Fallback for single line alternatives (avoids false positives like "software)")
    const inlinePattern = /(^|[\s])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:\s)[A-E]\s*[\)\.\-:]|$)/gi;
    const alternatives = [];
    let firstIndex = null;
    let m;

    while ((m = inlinePattern.exec(normalized)) !== null) {
        if (firstIndex === null) firstIndex = m.index + m[1].length;
        const letter = m[2].toUpperCase();
        const body = trimNoise(clean(m[3]));
        if (body) alternatives.push({ letter, body });
    }

    if (alternatives.length >= 2) {
        const enunciado = firstIndex !== null ? clean(normalized.substring(0, firstIndex)) : '';
        return render(enunciado, alternatives);
    }

    // Extra fallback: alternatives without punctuation (e.g. "A Text. B Text.")
    const plainAltPattern = /(?:^|[.!?]\\s+)([A-E])\\s+([A-Za-z][^]*?)(?=(?:[.!?]\\s+)[A-E]\\s+[A-Za-z]|$)/g;
    const plainAlternatives = [];
    let plainFirstIndex = null;
    let pm;

    while ((pm = plainAltPattern.exec(normalized)) !== null) {
        if (plainFirstIndex === null) plainFirstIndex = pm.index;
        const letter = pm[1].toUpperCase();
        const body = trimNoise(clean(pm[2].replace(/\s+[.!?]\s*$/, '')));
        if (body) plainAlternatives.push({ letter, body });
    }

    if (plainAlternatives.length >= 2) {
        const enunciado = plainFirstIndex !== null ? clean(normalized.substring(0, plainFirstIndex)) : '';
        return render(enunciado, plainAlternatives);
    }

    return `
        <div class="question-section">
            <div class="question-section-title">${escapeHtml(translate('result.statement', 'Statement'))}</div>
            <div class="question-enunciado">${escapeHtml(clean(normalized))}</div>
        </div>`;
}



