import { QuestionParser } from './src/rules/QuestionParser.js';

const text = "Algum texto.\nA) 4\nB) 1/2\nC) -2\nD) -3\nE) -1/2\n";
const options = QuestionParser.extractOptionsFromQuestion(text);
console.log("ext:", options);

const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
const parsedByLines = (() => {
    const raw = text;
    const lines = raw.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const alternatives = [];
    const enunciadoParts = [];
    let currentAlt = null;
    const altStartRe = /^([A-E])\s*(?:(?:[\)\:])|(?:\.\s)|->>|->|=>)\s*(.+)$/i; 
    const altSoloRe = /^([A-E])$/i;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(altStartRe);
        if (m) {
            const letter = m[1].toUpperCase();
            const body = m[2];
            if (currentAlt) alternatives.push(currentAlt);
            currentAlt = { letter, body };
            continue;
        }
        if (currentAlt) {
            currentAlt.body += (currentAlt.body ? ' ' : '') + line;
        } else {
            enunciadoParts.push(line);
        }
    }
    if (currentAlt) alternatives.push(currentAlt);
    return alternatives;
})();

console.log("parseByLines:", parsedByLines);
