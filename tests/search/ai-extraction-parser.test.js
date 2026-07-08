import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAiExtractionResponse, verifyEvidenceQuote } from '../../src/services/search/AiExtractionParser.js';

const SOURCE_PAGE = `Questão 5. No modelo relacional, o que identifica unicamente um registro?
A) Índice B) View C) Chave primária D) Trigger
O modelo relacional utiliza chaves primárias para identificar registros de forma única.
Gabarito: C`;

test('resposta padrão ENCONTRADO extrai letra, texto e valida evidência', () => {
    const content = `RESULTADO: ENCONTRADO
EVIDÊNCIA: "O modelo relacional utiliza chaves primárias para identificar registros de forma única."
RACIOCÍNIO: O texto afirma que chaves primárias identificam registros unicamente.
Letra C: Chave primária`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.status, 'found');
    assert.equal(r.letter, 'C');
    assert.equal(r.answerText, 'Chave primária');
    assert.equal(r.evidenceVerified, true);
    assert.ok(r.confidence >= 0.85);
});

test('LLM fraca que cita alternativas no raciocínio NÃO captura letra errada', () => {
    // O bug antigo: /\b([A-E])\s*[\):\.\-]\s*\S/ capturava o "A)" da citação.
    const content = `RESULTADO: ENCONTRADO
EVIDÊNCIA: "chaves primárias identificam registros"
RACIOCÍNIO: Vamos analisar. As opções são A) Índice, B) View, C) Chave primária, D) Trigger.
A) Índice serve para acelerar buscas, não identifica.
B) View é uma tabela virtual.
Analisando C, o texto diz que chaves primárias identificam registros de forma única.
Letra C: Chave primária`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.letter, 'C');
    assert.equal(r.parseMethod, 'letra-line');
});

test('sem linha "Letra X", usa afirmação contextual e ignora "A)" solto', () => {
    const content = `Analisando o texto fornecido: as opções eram A) Índice B) View C) Chave primária D) Trigger.
O texto menciona explicitamente que chaves primárias identificam registros.
Portanto a alternativa correta é a C.`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.letter, 'C');
    assert.equal(r.parseMethod, 'contextual');
});

test('markdown bold do Copilot/Claude é tratado', () => {
    const content = `RESULTADO: ENCONTRADO
EVIDÊNCIA: **"Gabarito: C"**
RACIOCÍNIO: O gabarito explícito aponta C.
**Letra C:** Chave primária`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.letter, 'C');
    assert.equal(r.answerText, 'Chave primária');
});

test('CONHECIMENTO_PARCIAL retorna knowledge sem letra', () => {
    const content = `RESULTADO: CONHECIMENTO_PARCIAL
CONHECIMENTOS: Chaves primárias identificam registros; índices aceleram consultas.`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.status, 'partial');
    assert.equal(r.letter, null);
    assert.match(r.knowledge, /Chaves primárias identificam/);
});

test('NAO_ENCONTRADO retorna not_found', () => {
    const r = parseAiExtractionResponse('RESULTADO: NAO_ENCONTRADO', { sourceText: SOURCE_PAGE });
    assert.equal(r.status, 'empty'); // < 40 chars é curto demais para ser útil
    const r2 = parseAiExtractionResponse('RESULTADO: NAO_ENCONTRADO\n(nenhuma informação relevante no texto)', { sourceText: SOURCE_PAGE });
    assert.equal(r2.status, 'not_found');
});

test('evidência alucinada (não existe na fonte) derruba a confiança', () => {
    const content = `RESULTADO: ENCONTRADO
EVIDÊNCIA: "Segundo estudos avançados de bancos distribuídos, triggers garantem unicidade absoluta dos registros armazenados"
RACIOCÍNIO: O texto confirma que triggers identificam registros.
Letra D: Trigger`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.letter, 'D');
    assert.equal(r.evidenceVerified, false);
    assert.ok(r.confidence <= 0.6, `confiança deveria ser <= 0.6, veio ${r.confidence}`);
});

test('evidência com acentos/pontuação diferente ainda verifica (normalização)', () => {
    const content = `RESULTADO: ENCONTRADO
EVIDÊNCIA: O modelo relacional utiliza chaves primarias para identificar registros de forma unica
RACIOCÍNIO: afirmação direta do texto.
Letra C: Chave primária`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.evidenceVerified, true);
});

test('fallback de última linha "C) texto" funciona mas com confiança reduzida', () => {
    const content = `Analisei o texto e identifiquei que a chave primária é o mecanismo de identificação única no modelo relacional descrito.
C) Chave primária`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.letter, 'C');
    assert.equal(r.parseMethod, 'last-line');
    assert.ok(r.confidence <= 0.65);
});

test('resposta sem letra vira no_letter com knowledge preservado', () => {
    const content = `O texto discute o papel de chaves primárias na identificação de registros em bancos relacionais, mas não há gabarito explícito para a questão apresentada.`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.status, 'no_letter');
    assert.equal(r.letter, null);
    assert.ok(r.knowledge.length > 50);
});

test('texto de alternativa com código não é mutilado pela limpeza', () => {
    const content = `RESULTADO: ENCONTRADO
EVIDÊNCIA: "CREATE ( : Cliente { nome : 'Léa' } ) x"
RACIOCÍNIO: A opção marcada com x é a correta.
Letra B: CREATE ( : Cliente { nome : 'Léa' } )`;

    const r = parseAiExtractionResponse(content, { sourceText: `enunciado... CREATE ( : Cliente { nome : 'Léa' } ) x ...outras opções` });
    assert.equal(r.letter, 'B');
    assert.match(r.answerText, /CREATE \( : Cliente/);
});

test('comentário entre parênteses no fim do answerText é removido', () => {
    const content = `RESULTADO: ENCONTRADO
EVIDÊNCIA: "Gabarito: C"
RACIOCÍNIO: gabarito explícito.
Letra C: Chave primária (conforme o gabarito do texto)`;

    const r = parseAiExtractionResponse(content, { sourceText: SOURCE_PAGE });
    assert.equal(r.answerText, 'Chave primária');
});

test('verifyEvidenceQuote: null quando não há como verificar', () => {
    assert.equal(verifyEvidenceQuote('', SOURCE_PAGE), null);
    assert.equal(verifyEvidenceQuote('citação qualquer aqui', ''), null);
    assert.equal(verifyEvidenceQuote('abc', SOURCE_PAGE), null); // curta demais
});
