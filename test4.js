const text = `
Algum texto.
A) 4
B) 1/2
C) -2
D) -3
E) -1/2
`;

const limitToFirstQuestion = (raw) => {
    const lines = raw.split('\n');
    const result = [];
    let altCount = 0;
    const altRe = /^([A-E])\s*(?:(?:[\)\-:])|(?:\.\s)|->>|->|=>)/i;
    const newQuestionRe = /^\d+\s*[\.\):]?\s*(Marcar para|Quest[ãa]o|\(.*\/\d{4})/i;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (newQuestionRe.test(line.trim()) && altCount >= 2) break;

        if (altRe.test(line.trim())) {
            altCount++;
        }

        result.push(line);

        if (altCount >= 5) {
            const nextLines = lines.slice(result.length, result.length + 2);
            const hasMoreAlt = nextLines.some(l => altRe.test(l.trim()));
            if (!hasMoreAlt) break;
        }
    }
    return result.join('\n');
};

console.log("LIMITED:", limitToFirstQuestion(text.trim()));

