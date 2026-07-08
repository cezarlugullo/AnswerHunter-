import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizePromptText,
    extractQuestionStructure,
    optionsMapFromQuestion,
    inferLearningScenario,
    buildPedagogicalRoleBlock,
    buildPromptBestPracticesBlock,
} from '../../src/services/pedagogy/core/PedagogicalPromptKernel.js';
import {
    inferPedagogicalDomain,
    extractExactSciencesSignals,
    buildExactSciencesFewShot,
    buildExactSciencesMnemonicElements,
} from '../../src/services/pedagogy/domains/ExactSciencesPedagogy.js';
import {
    normalizeMnemonicText,
    extractAlternatives,
    extractTopKeywords,
    inferMnemonicScenario,
    inferMnemonicType,
    buildMnemonicKeyElements,
    buildMnemonicSignature,
    trimMnemonicText,
    scoreMnemonicPayload,
    finalizeMnemonicPayload,
} from '../../src/services/pedagogy/mnemonics/MnemonicPromptSupport.js';

test('normalizePromptText collapses whitespace safely', () => {
    assert.equal(normalizePromptText(' A\r\n\r\nB   C '), 'A\n\nB C');
});

test('extractQuestionStructure separates stem and options', () => {
    const parsed = extractQuestionStructure('Quanto é 2+2?\nA) 3\nB) 4\nC) 5');
    assert.match(parsed.stem, /Quanto é 2\+2\?/);
    assert.equal(parsed.alternatives.length, 3);
    assert.equal(parsed.alternatives[1].letter, 'B');
    assert.equal(parsed.alternatives[1].text, '4');
});

test('optionsMapFromQuestion maps alternatives by letter', () => {
    const options = optionsMapFromQuestion('Teste\nA) alfa\nB) beta\nC) gama');
    assert.deepEqual(options, { A: 'alfa', B: 'beta', C: 'gama' });
});

test('inferLearningScenario identifies formula and comparison patterns', () => {
    assert.equal(inferLearningScenario('Considere a expressão f(x)=x² e calcule.'), 'fórmula');
    assert.equal(inferLearningScenario('Compare mitose versus meiose.'), 'comparação');
});

test('role and best practices blocks expose structured prompt guidance', () => {
    assert.match(buildPedagogicalRoleBlock('exact_sciences', 'guiar o aluno'), /<role>/);
    assert.match(buildPromptBestPracticesBlock(), /<prompting_best_practices>/);
});

test('inferPedagogicalDomain detects exact sciences content', () => {
    const domain = inferPedagogicalDomain('Calcule o limite lim x->2 de f(x)=x^2-4 sobre x-2.');
    assert.equal(domain, 'exact_sciences');
});

test('extractExactSciencesSignals detects a limit workflow', () => {
    const signals = extractExactSciencesSignals('Se der 0/0 em um limite, o que fazer?');
    assert.equal(signals.topic, 'limites');
    assert.match(signals.firstStep, /substituição direta/i);
    assert.ok(signals.checklist.length >= 2);
});

test('exact sciences helpers build few-shot and mnemonic elements', () => {
    assert.match(buildExactSciencesFewShot('hint'), /<examples>/);
    const elements = buildExactSciencesMnemonicElements('Questão sobre velocidade e aceleração', 'Use a equação correta', 'cinemática');
    assert.ok(elements.some((item) => /lei física|dados e incógnita|unidade/i.test(item)));
});

test('mnemonic helpers infer scenario, type and alternatives', () => {
    const question = 'Qual protocolo usar?\nA) HTTP\nB) UDP\nC) CSS';
    assert.equal(normalizeMnemonicText(' A\n\nB '), 'A\n\nB');
    assert.equal(inferMnemonicScenario(question, 'A) HTTP'), 'technical');
    assert.equal(inferMnemonicType(question, 'A) HTTP', 'auto'), 'keyword');
    assert.equal(extractAlternatives(question)[0].letter, 'A');
});

test('buildMnemonicKeyElements includes concept and exact sciences procedure', () => {
    const elements = buildMnemonicKeyElements(
        'Calcule o limite da função.\nA) 1\nB) 2',
        'B) 2',
        'limites'
    );
    assert.ok(elements.some((item) => /Conceito central → limites/i.test(item)));
    assert.ok(elements.some((item) => /0\/0|simplifique|Resposta correta/i.test(item)));
});

test('mnemonic signature is stable and trimming works', () => {
    const signature = buildMnemonicSignature({
        concept: 'limites',
        scenario: 'formula',
        resolvedType: 'visual',
        answerText: 'B) 2',
        rawQuestion: 'Pergunta longa'
    });
    assert.match(signature, /mnemonic-exact-v3/);
    assert.equal(trimMnemonicText('um dois três quatro cinco', 8, 5), 'um dois…');
});

test('score and finalize mnemonic payload normalize output', () => {
    const prepared = {
        concept: 'limites',
        scenario: 'formula',
        requestedType: 'auto',
        resolvedType: 'visual',
        signature: 'sig',
        keyElements: ['0/0 → simplifique', 'só depois substitua']
    };

    const payload = finalizeMnemonicPayload({
        mnemonic: '0/0? simplifica primeiro',
        keyElements: ['0/0 → simplifique', 'só depois substitua'],
        visualization: 'Imagine uma placa 0/0 bloqueando a estrada até você simplificar a expressão.',
        connection: 'A imagem força você a simplificar antes de substituir no limite.',
        selfTest: 'O que fazer quando a substituição direta dá 0/0',
        type: 'visual'
    }, prepared);

    assert.equal(payload.type, 'visual');
    assert.match(payload.selfTest, /\?$/);
    assert.ok(scoreMnemonicPayload(payload, prepared) >= 6);
});

test('extractTopKeywords returns repeated salient tokens', () => {
    const keywords = extractTopKeywords('limite limite função função derivada integral', 3);
    assert.ok(keywords.includes('limite'));
    assert.ok(keywords.includes('funcao') || keywords.includes('função'));
});
