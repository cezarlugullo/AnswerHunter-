import test from 'node:test';
import assert from 'node:assert/strict';

import { OptionsMatchService } from '../../src/services/search/OptionsMatchService.js';
import { parseAiExtractionResponse } from '../../src/services/search/AiExtractionParser.js';

// Cenário real da Estácio: a prova do aluno embaralha as alternativas.
// A fonte na web tem a MESMA questão com as opções em OUTRA ordem.
const STUDENT_OPTIONS = {
    A: 'Chave primária',
    B: 'View materializada',
    C: 'Índice composto',
    D: 'Trigger de auditoria'
};

test('letra da fonte embaralhada é corrigida pelo texto da resposta', () => {
    // Na fonte, "Chave primária" era a letra C. Na prova do aluno, é a A.
    // O fluxo antigo votava em C (errado). O texto resolve:
    const letter = OptionsMatchService.findLetterByAnswerText('Chave primária', STUDENT_OPTIONS);
    assert.equal(letter, 'A');
});

test('texto com prefixo de apresentação ainda mapeia', () => {
    const letter = OptionsMatchService.findLetterByAnswerText('a alternativa correta: Chave primária', STUDENT_OPTIONS);
    assert.equal(letter, 'A');
});

test('texto ambíguo ou sem correspondência não força mapeamento', () => {
    const letter = OptionsMatchService.findLetterByAnswerText('nenhuma das anteriores mencionadas', STUDENT_OPTIONS);
    assert.equal(letter, null);
});

test('fluxo completo: resposta de LLM da fonte embaralhada → letra do aluno', () => {
    // A fonte tinha: A) View B) Trigger C) Chave primária D) Índice → "Gabarito: C"
    const sourcePage = `Questão 12. No modelo relacional, o que identifica unicamente um registro?
A) View materializada B) Trigger de auditoria C) Chave primária D) Índice composto
Gabarito: C`;

    const llmResponse = `RESULTADO: ENCONTRADO
EVIDÊNCIA: "Gabarito: C"
RACIOCÍNIO: O gabarito explícito da questão 12 indica a letra C, cuja alternativa é "Chave primária".
Letra C: Chave primária`;

    const parsed = parseAiExtractionResponse(llmResponse, { sourceText: sourcePage });
    assert.equal(parsed.status, 'found');
    assert.equal(parsed.letter, 'C');            // letra no espaço da FONTE
    assert.equal(parsed.evidenceVerified, true);

    // O SearchService agora faz TEXT-FIRST: mapeia o answerText para as opções do aluno
    const match = OptionsMatchService.matchAnswerTextToOptions(parsed.answerText, STUDENT_OPTIONS);
    assert.equal(match?.letter, 'A');            // letra correta na prova do ALUNO
    assert.notEqual(match?.letter, parsed.letter, 'o teste deve exercitar o caso embaralhado');
});
