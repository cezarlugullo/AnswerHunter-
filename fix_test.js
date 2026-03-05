import { QuestionParser } from './src/services/search/QuestionParser.js';

let text = "Algum texto.\nA) 4\nB) 1/2\nC) -2\nD) -3\nE) -1/2\n";
const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
const optionRe = /^["'\(\[]?\s*([A-E])\s*(?:[\)\-:]|(?:\.\s))\s*(.+)$/i;
const options = [];
const seen = new Set();
const seenBodies = new Set();

for (const line of lines) {
    const m = line.match(optionRe);
    if (!m) continue;
    let cleanedBody = m[2];
    const letter = m[1].toUpperCase();

    const dedupKey = cleanedBody.toLowerCase().replace(/\s+/g, '');
    const duplicateBody = seenBodies.has(dedupKey);

    if (duplicateBody) continue;

    options.push(line);
    seen.add(letter);
    seenBodies.add(dedupKey);
}

console.log(options);
