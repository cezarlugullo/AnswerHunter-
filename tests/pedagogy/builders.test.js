import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWhyWrongRequest } from '../../src/services/pedagogy/actions/WhyWrongPromptBuilder.js';
import { buildSocraticHintRequest } from '../../src/services/pedagogy/actions/SocraticHintPromptBuilder.js';
import {
    buildMnemonicRequest,
    createMnemonicResponseParser,
    isValidMnemonicPayload,
} from '../../src/services/pedagogy/actions/MnemonicPromptBuilder.js';
import { buildConceptExplanationRequest } from '../../src/services/pedagogy/actions/ConceptExplanationPromptBuilder.js';

test('buildWhyWrongRequest returns prompt package with fallback', () => {
    const built = buildWhyWrongRequest({
        questionText: 'Qual alternativa está correta?\nA) errado\nB) certo',
        wrongLetter: 'A',
        wrongText: 'errado',
        correctLetter: 'B',
        correctText: 'certo',
        subject: 'Lógica',
        allAlternatives: [
            { letter: 'A', text: 'errado' },
            { letter: 'B', text: 'certo' }
        ]
    });

    assert.match(built.systemMsg, /diagnosticar erros conceituais/i);
    assert.match(built.prompt, /O aluno escolheu: A\) errado/);
    assert.match(built.fallbackValue, /resposta correta é B/i);
});

test('buildWhyWrongRequest handles exact sciences formatting guidance', () => {
    const built = buildWhyWrongRequest({
        questionText: 'Calcule o limite de f(x) = 7 - (1/3)^x quando x tende ao infinito.',
        wrongLetter: 'A',
        wrongText: '0',
        correctLetter: 'B',
        correctText: '7',
        subject: 'Cálculo',
        allAlternatives: [
            { letter: 'A', text: '0' },
            { letter: 'B', text: '7' }
        ],
        domain: 'exact_sciences',
        mathSignals: {
            topic: 'limites',
            firstStep: 'faça a substituição direta e observe o comportamento do termo exponencial',
        },
        roleBlock: '<role />',
        bestPracticesBlock: '<best />',
    });

    assert.match(built.systemMsg, /diagnosticar erros conceituais e procedurais em exatas/i);
    assert.match(built.systemMsg, /Matemática inline: use \\\( \.\.\. \\\)/);
    assert.match(built.prompt, /Tema de exatas detectado: limites/i);
});

test('buildSocraticHintRequest handles exact sciences path', () => {
    const built = buildSocraticHintRequest({
        questionText: 'Calcule o limite.',
        parsedQuestion: { stem: 'Calcule o limite.' },
        parsedOptionsMap: { A: '1', B: '2' },
        hasStructuredOptions: true,
        conceptName: 'limites',
        scenarioName: 'formula',
        keywords: 'limite, função',
        domain: 'exact_sciences',
        mathSignals: {
            topic: 'limites',
            firstStep: 'faça a substituição direta',
            checklist: ['substituição direta', 'simplifique'],
            warning: '0/0 é indeterminação',
        },
        hintLevel: 2,
        previousHint: 'Veja o domínio primeiro.',
        roleBlock: '<role>role</role>',
        bestPracticesBlock: '<prompt_engineering_best_practices />',
        exactSciencesFewShot: '<examples />',
    });

    assert.match(built.systemMsg, /tutor socrático de exatas/i);
    assert.match(built.prompt, /PISTA OPERACIONAL: faça a substituição direta/i);
    assert.match(built.fallbackValue, /roteiro curto/i);
});

test('buildMnemonicRequest and parser normalize JSON output', () => {
    const prepared = {
        concept: 'limites',
        scenario: 'formula',
        resolvedType: 'visual',
        requestedType: 'auto',
        rawQuestion: 'Calcule o limite da função.',
        answerText: 'B) 2',
        keyElements: ['0/0 → simplifique', 'substitua no fim'],
        signature: 'sig',
    };

    const built = buildMnemonicRequest({
        prepared,
        promptSections: {
            preamble: 'PRE',
            brevity: 'BREV',
            visualization: 'VIS',
            naturalness: 'NAT',
            technical: 'TECH',
            affirmatives: 'AFF',
            output: 'OUT',
            examples: 'EX',
        },
        domain: 'exact_sciences',
        mathSignals: { topic: 'limites', firstStep: 'substituição direta' },
        roleBlock: '<role />',
        bestPracticesBlock: '<best />',
        exactSciencesFewShot: '<examples />',
    });

    assert.match(built.systemMsg, /REGRAS PARA EXATAS/);
    assert.match(built.prompt, /CONCEITO A MEMORIZAR/);

    const parse = createMnemonicResponseParser(prepared);
    const parsed = parse('{"mnemonic":"0/0? simplifica primeiro","keyElements":["0/0 → simplifique","substitua no fim"],"visualization":"Uma placa 0/0 bloqueia a estrada até você simplificar.","connection":"A cena faz você lembrar que 0/0 não é resposta final.","selfTest":"O que fazer antes de substituir de novo?","type":"visual"}');

    assert.equal(parsed.type, 'visual');
    assert.ok(isValidMnemonicPayload(parsed, prepared));
    assert.match(built.fallbackValue.mnemonic, /cena concreta/i);
});

test('buildConceptExplanationRequest returns specialized tokens and fallback', () => {
    const built = buildConceptExplanationRequest({
        resolvedConcept: 'limites',
        resolvedContext: 'Questão sobre 0/0',
        subject: 'Cálculo I',
        conceptProfile: { scenario: 'formula' },
        domain: 'exact_sciences',
        mathSignals: { topic: 'limites', firstStep: 'substituição direta' },
        roleBlock: '<role />',
        bestPracticesBlock: '<best />',
        exactSciencesFewShot: '<examples />',
    });

    assert.match(built.systemMsg, /professor de exatas/i);
    assert.match(built.prompt, /Tema de exatas detectado: limites/i);
    assert.equal(built.maxTokens, 750);
    assert.match(built.fallbackValue, /Não foi possível gerar a explicação/i);
});
