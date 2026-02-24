// Test QuestionParser option extraction logic

function stripOptionTailNoise(text) {
    if (!text) return '';
    let cleaned = String(text).replace(/\s+/g, ' ').trim();
    const noiseMarker = /\b(?:gabarito|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|parabéns|explicação)\b/i;
    const idx = cleaned.search(noiseMarker);
    if (idx > 20) cleaned = cleaned.slice(0, idx).trim();
    return cleaned.replace(/[;:,\-.\s]+$/g, '').trim();
}

function normalizeOption(text) {
    return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^[a-e]\s*[\)\.\-:]\s*/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function isUsableOptionBody(body) {
    const cleaned = String(body || '').replace(/\s+/g, ' ').trim();
    if (!cleaned || cleaned.length < 1) return false;
    if (/^[A-E]\s*[\)\.\-:]?\s*$/i.test(cleaned)) return false;
    if (/^(?:[A-E]\s*[\)\.\-:]\s*){1,2}$/i.test(cleaned)) return false;
    return true;
}

function extractOptionsFromQuestion(questionText) {
    if (!questionText) return [];
    const text = String(questionText || '').replace(/\r\n/g, '\n');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const options = [];
    const seen = new Set();
    const seenBodies = new Set();
    const optionRe = /^[\"'\u201C\u201D\u2018\u2019\(\[]?\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i;

    // Primary pass
    for (const line of lines) {
        const m = line.match(optionRe);
        if (!m) continue;
        const letter = (m[1] || '').toUpperCase();
        const cleanedBody = stripOptionTailNoise(m[2]);
        const normalizedBody = normalizeOption(cleanedBody);
        if (!isUsableOptionBody(cleanedBody) || !normalizedBody || seen.has(letter)) continue;
        options.push(letter + ') ' + cleanedBody);
        seen.add(letter);
    }

    console.log('After primary pass:', options, 'seen:', [...seen]);

    // Secondary pass
    const inlineRe = /(?:^|[\n\r\t ;\"'\u201C\u201D\u2018\u2019])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:[\n\r\t ;\"'\u201C\u201D\u2018\u2019][A-E]\s*[\)\.\-:]\s)|$)/gi;
    let m;
    while ((m = inlineRe.exec(text)) !== null) {
        const letter = (m[1] || '').toUpperCase();
        if (!letter || seen.has(letter)) continue;
        const cleanedBody = stripOptionTailNoise(m[2]);
        const normalizedBody = normalizeOption(cleanedBody);
        if (!isUsableOptionBody(cleanedBody) || !normalizedBody) continue;
        options.push(letter + ') ' + cleanedBody);
        seen.add(letter);
        console.log('  SECONDARY FOUND:', letter, '=>', JSON.stringify(cleanedBody));
        if (seen.size >= 5) break;
    }

    return options;
}

function buildOptionsMap(questionText) {
    const options = extractOptionsFromQuestion(questionText);
    const map = {};
    for (const opt of options) {
        const m = opt.match(/^([A-E])\)\s*(.+)$/i);
        if (m) map[m[1].toUpperCase()] = stripOptionTailNoise(m[2]);
    }
    return map;
}

// Test 1: Options on separate lines (what happens after INLINE_OPTIONS_SPLIT)
console.log('=== Test 1: newline-separated options ===');
const test1 = 'A .csv\nB .txt\nC .xml\nD .jsp\nE JSON';
console.log('Input:', JSON.stringify(test1));
console.log('Options:', extractOptionsFromQuestion(test1));
console.log('Map:', buildOptionsMap(test1));
console.log();

// Test 2: All on one line (no split happened)
console.log('=== Test 2: single-line inline ===');
const test2 = 'chave-valor: A .csv B .txt C .xml D .jsp E JSON';
console.log('Input:', JSON.stringify(test2));
console.log('Options:', extractOptionsFromQuestion(test2));
console.log('Map:', buildOptionsMap(test2));
console.log();

// Test 3: Full multi-question blob
console.log('=== Test 3: multi-question blob ===');
const test3 = 'SM1 Banco De Dados Nosql 1  É um formato de dado muito usado no modelo chave-valor: A .csv B .txt C .xml D .jsp E JSON 2  Sobre o modelo chave-valor podemos afirmar, exceto: A Pode ser usado no formato JSON';
console.log('Input:', test3.slice(0, 120));
console.log('Options:', extractOptionsFromQuestion(test3));
console.log('Map:', buildOptionsMap(test3));
console.log();

// Test 4: After INLINE_OPTIONS_SPLIT on multi-question blob
console.log('=== Test 4: after INLINE_OPTIONS_SPLIT ===');
let test4 = test3;
// Simulate the INLINE_OPTIONS_SPLIT
const _inlineOptsRe4 = /\b([a-eA-E])\s*[\)\.\-:]\s*\S/g;
const _inlineLetters4 = new Set();
let _im4;
while ((_im4 = _inlineOptsRe4.exec(test4)) !== null) _inlineLetters4.add(_im4[1].toUpperCase());
console.log('Inline letters detected:', [..._inlineLetters4]);
const lineDetected4 = (test4.match(/(?:^|\n)\s*([A-E])\s*[\)\.\-:]\s+\S/gim) || []).length;
console.log('Line-detected:', lineDetected4);
if (_inlineLetters4.size >= 3 && lineDetected4 < _inlineLetters4.size) {
    test4 = test4.replace(/(\S)\s+([a-eA-E]\s*[\)\.\-:]\s)/g, '$1\n$2');
    console.log('After split:', JSON.stringify(test4));
}
console.log('Options:', extractOptionsFromQuestion(test4));
console.log('Map:', buildOptionsMap(test4));
console.log();

// Test 5: What if the question uses parentheses format?
console.log('=== Test 5: parentheses format ===');
const test5 = 'A) .csv\nB) .txt\nC) .xml\nD) .jsp\nE) JSON';
console.log('Options:', extractOptionsFromQuestion(test5));
console.log('Map:', buildOptionsMap(test5));
