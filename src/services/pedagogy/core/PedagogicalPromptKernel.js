export function normalizePromptText(text = '') {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function extractQuestionStructure(questionText = '') {
    const raw = normalizePromptText(questionText);
    if (!raw) return { stem: '', alternatives: [] };

    const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const alternatives = [];
    const stemParts = [];
    let currentAlt = null;

    const altStartRe = /^([A-E])\s*(?:[\)\.\:\-]|->>|->|=>)\s*(.+)$/i;
    const altSoloRe = /^([A-E])$/i;
    const noiseRe = /^alternativas?\s*:?$/i;

    for (const line of lines) {
        if (noiseRe.test(line)) continue;

        const match = line.match(altStartRe);
        if (match) {
            if (currentAlt) alternatives.push(currentAlt);
            currentAlt = { letter: match[1].toUpperCase(), text: match[2].trim() };
            continue;
        }

        const solo = line.match(altSoloRe);
        if (solo) {
            if (currentAlt) alternatives.push(currentAlt);
            currentAlt = { letter: solo[1].toUpperCase(), text: '' };
            continue;
        }

        if (currentAlt) currentAlt.text = `${currentAlt.text} ${line}`.trim();
        else stemParts.push(line);
    }
    if (currentAlt) alternatives.push(currentAlt);

    if (alternatives.length < 2) {
        const inlineRe = /(?:^|\s)([A-E])[\)\.]\s*/g;
        const matches = [...raw.matchAll(inlineRe)];
        if (matches.length >= 2) {
            const inlineStem = raw.slice(0, matches[0].index).trim();
            const inlineAlts = [];
            for (let i = 0; i < matches.length; i++) {
                const start = matches[i].index + matches[i][0].length;
                const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
                const text = raw.slice(start, end).trim();
                if (text) inlineAlts.push({ letter: matches[i][1].toUpperCase(), text });
            }
            if (inlineAlts.length >= 2) return { stem: inlineStem || raw, alternatives: inlineAlts };
        }
    }

    return {
        stem: stemParts.join('\n').trim() || raw,
        alternatives: alternatives.filter((alt) => alt && alt.text)
    };
}

export function optionsMapFromQuestion(questionText = '') {
    const { alternatives } = extractQuestionStructure(questionText);
    return alternatives.reduce((acc, alt) => {
        acc[alt.letter] = alt.text;
        return acc;
    }, {});
}

export function inferLearningScenario(questionText = '') {
    const text = normalizePromptText(questionText);
    if (!text) return 'conceito central';
    if (/(?:^|\n)\s*[IVX]+\s*[\)\.\-:]/im.test(text) || /\bI\b.*\bII\b.*\bIII\b/im.test(text)) return 'afirmativas';
    if (/\b(ordem|sequ[eê]ncia|etapas|fases|cronol[oó]gica|passos?)\b/i.test(text)) return 'sequência';
    if (/\b(vs\.?|versus|diferen[cç]a|compare|comparar|contraste)\b/i.test(text)) return 'comparação';
    if (/[=<>±×÷∑∫√]|\\frac|\\sqrt|\\lim|\$[^$]+\$/.test(text)) return 'fórmula';
    if (/\b(?:sql|api|http|tcp|udp|ansi|iso|json|html|css|fsrs)\b/i.test(text)) return 'termo técnico';
    return 'conceito central';
}

export function buildPedagogicalRoleBlock(domain = 'general', purpose = '') {
    if (domain === 'exact_sciences') {
        return `<role>
Você é um pedagogo sênior e professor universitário sênior de exatas.
Especialidades: matemática, física, química quantitativa, didática universitária, diagnóstico de erro, scaffolding cognitivo e explicação passo a passo.
Você é excelente em transformar resolução formal em orientação clara, operacional e verificável para estudantes brasileiros.
Objetivo principal: ${purpose || 'fazer o aluno entender o procedimento correto e reconstruir a solução com autonomia'}.
</role>`;
    }

    return `<role>
Você é um pedagogo sênior e professor universitário sênior, especialista em didática, diagnóstico conceitual e aprendizagem ativa.
Objetivo principal: ${purpose || 'ajudar o aluno a entender o conceito, corrigir o raciocínio e avançar com autonomia'}.
</role>`;
}

export function buildPromptBestPracticesBlock() {
    return `<prompting_best_practices>
- Instruções claras e específicas vencem instruções vagas.
- Priorize formato, restrições e critério de sucesso explicitamente.
- Siga exemplos positivos quando eles existirem.
- Separe papel, contexto, tarefa e saída com blocos distintos.
- Antes de finalizar, confira se a resposta atende ao objetivo pedagógico e às restrições.
</prompting_best_practices>`;
}

export function buildMathFormattingBlock() {
    return `<math_formatting>
Se houver matemática, fórmulas, funções, limites, integrais, unidades ou expressões simbólicas, formate com delimitadores LaTeX consistentes.

Regras obrigatórias de notação:
- Matemática inline: use \\( ... \\)
- Matemática em bloco: use \\[ ... \\]
- Não use $...$ nem $$...$$
- Não misture texto comum com LaTeX quebrado, como \\( f(x) sem fechar o delimitador
- Não deixe barras invertidas soltas ou parênteses LaTeX incompletos
- Preserve a expressão matemática inteira dentro do mesmo delimitador

Exemplos corretos:
- A função é \\( f(x) = 7 - \\left(\\frac{1}{3}\\right)^x \\)
- A assíntota horizontal é \\( y = 7 \\)
- Resolva em bloco: \\[ \\lim_{x \\to \\infty} \\left( 7 - \\left(\\frac{1}{3}\\right)^x \\right) = 7 \\]
</math_formatting>`;
}
