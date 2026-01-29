/**
 * helpers.js
 * Funções utilitárias puras
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
    const hasKeywords = /Quest(?:a|ã)o|Pergunta|Exerc[ií]cio|Enunciado|Atividade/i.test(clean);
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

// Função para formatar questão separando enunciado das alternativas
export function formatQuestionText(text) {
    if (!text) return '';

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const trimNoise = (s) => {
        if (!s) return s;
        const noiseRe = /(Resposta correta|Parab[eé]ns|Gabarito|Gabarito Comentado|Alternativa correta|Confira o gabarito|Resposta certa|Resposta correta|Você selecionou a alternativa correta|Marcar para revis[ãa]o)/i;
        const idx = s.search(noiseRe);
        if (idx !== -1) return s.substring(0, idx).trim();
        return s.trim();
    };
    
    // NOVO: Limitar texto para apenas a primeira questão (cortar após 5 alternativas ou próxima questão)
    const limitToFirstQuestion = (raw) => {
        const lines = raw.split('\n');
        const result = [];
        let altCount = 0;
        const altRe = /^([A-E])\s*[\)\.\-:]/i;
        const newQuestionRe = /^\d+\s*[\.\):]?\s*(Marcar para|Quest[ãa]o|\(.*\/\d{4})/i;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Se encontrar início de nova questão, parar
            if (newQuestionRe.test(line.trim()) && altCount >= 2) {
                break;
            }
            
            // Contar alternativas
            if (altRe.test(line.trim())) {
                altCount++;
            }
            
            result.push(line);
            
            // Se já temos 5 alternativas (A-E), parar após a última
            if (altCount >= 5) {
                // Continuar apenas se a próxima linha faz parte da alternativa E
                const nextLines = lines.slice(result.length, result.length + 2);
                const hasMoreAlt = nextLines.some(l => altRe.test(l.trim()));
                if (!hasMoreAlt) break;
            }
        }
        
        return result.join('\n');
    };
    
    const limitedText = limitToFirstQuestion(text);
    const normalized = limitedText.replace(/\r\n/g, '\n');
    const normalizedForParsing = normalized;

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
        // Limitar a 5 alternativas máximo
        const limitedAlts = alternatives.slice(0, 5);
        const formattedAlternatives = limitedAlts
            .map(a => `
          <div class="alternative">
            <span class="alt-letter">${escapeHtml(a.letter)}</span>
            <span class="alt-text">${escapeHtml(a.body)}</span>
          </div>
        `)
            .join('');
        return `
        <div class="question-enunciado">${escapeHtml(enunciado)}</div>
        <div class="question-alternatives">${formattedAlternatives}</div>
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

    // Fallback: alternativas inline (sem quebra de linha), após pontuação
    const inlineAltPattern = /(^|[\n:;?.!]\s+)([A-E])\s+(?=[A-ZÀ-Ú])/g;
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

    // Fallback para alternativas em linha unica (evita falsos positivos como "software)")
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

    // Fallback extra: alternativas sem pontuação (ex: "A Texto. B Texto.")
    const plainAltPattern = /(?:^|[.!?]\s+)([A-E])\s+([A-ZÀ-Ú][^]*?)(?=(?:[.!?]\s+)[A-E]\s+[A-ZÀ-Ú]|$)/g;
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

    return `<div class="question-enunciado">${escapeHtml(clean(normalized))}</div>`;
}



