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

// Funçéo para formatar questão separando enunciado das alternativas
export function formatQuestionText(text) {
    if (!text) return '';

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const trimNoise = (s) => {
        if (!s) return s;
        const noiseRe = /(Resposta correta|Parab[eé]ns|Gabarito|Gabarito Comentado|Alternativa correta|Confira o gabarito|Resposta certa|Resposta correta|Você selecionou a alternativa correta)/i;
        const idx = s.search(noiseRe);
        if (idx !== -1) return s.substring(0, idx).trim();
        return s.trim();
    };
    const normalized = (text || '').replace(/\r\n/g, '\n');

    const render = (enunciado, alternatives) => {
        const formattedAlternatives = alternatives
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

    const parseByLines = (raw) => {
        const lines = raw.split(/\n+/).map(line => line.trim()).filter(Boolean);
        const alternatives = [];
        const enunciadoParts = [];
        let currentAlt = null;
        const altStartRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;

        for (const line of lines) {
            const m = line.match(altStartRe);
            if (m) {
                if (currentAlt) alternatives.push(currentAlt);
                currentAlt = { letter: m[1].toUpperCase(), body: trimNoise(clean(m[2])) };
            } else if (currentAlt) {
                currentAlt.body = trimNoise(clean(`${currentAlt.body} ${line}`));
            } else {
                enunciadoParts.push(line);
            }
        }

        if (currentAlt) alternatives.push(currentAlt);

        return { enunciado: clean(enunciadoParts.join(' ')), alternatives };
    };

    const parsedByLines = parseByLines(normalized);
    if (parsedByLines.alternatives.length >= 2) {
        return render(parsedByLines.enunciado, parsedByLines.alternatives);
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
