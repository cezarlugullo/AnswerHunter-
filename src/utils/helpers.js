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

/**
 * Formata texto de questão com HTML para enunciado e alternativas
 * @param {string} text - Texto completo da questão
 * @returns {string} HTML formatado
 */
export function formatQuestionText(text) {
    if (!text) return '';

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
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
      <div class="question-alternatives">
        ${formattedAlternatives}
      </div>
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
                currentAlt = { letter: m[1].toUpperCase(), body: clean(m[2]) };
            } else if (currentAlt) {
                currentAlt.body = clean(`${currentAlt.body} ${line}`);
            } else {
                enunciadoParts.push(line);
            }
        }

        if (currentAlt) alternatives.push(currentAlt);

        return { enunciado: clean(enunciadoParts.join(' ')), alternatives };
    };

    // 1. Tentar parsear por linhas (mais seguro)
    const parsedByLines = parseByLines(normalized);
    if (parsedByLines.alternatives.length >= 2) {
        return render(parsedByLines.enunciado, parsedByLines.alternatives);
    }

    // 2. Fallback para regex inline
    const inlinePattern = /(^|[\s])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:\s)[A-E]\s*[\)\.\-:]|$)/gi;
    const alternatives = [];
    let firstIndex = null;
    let m;

    // Clone para não estragar regex state global se houver
    const inlineRe = new RegExp(inlinePattern);

    while ((m = inlineRe.exec(normalized)) !== null) {
        if (firstIndex === null) firstIndex = m.index + m[1].length;
        const letter = m[2].toUpperCase();
        const body = clean(m[3]);
        if (body) alternatives.push({ letter, body });
    }

    if (alternatives.length >= 2) {
        const enunciado = firstIndex !== null ? clean(normalized.substring(0, firstIndex)) : '';
        return render(enunciado, alternatives);
    }

    // 3. Texto simples se não achar alternativas
    return `<div class="question-enunciado">${escapeHtml(clean(normalized))}</div>`;
}
