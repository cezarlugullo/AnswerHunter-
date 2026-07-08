import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAiExtractionResponse } from '../../src/services/search/AiExtractionParser.js';
import { tallySourceVotes } from '../../src/services/search/VoteTally.js';

// ═══ Detecção de eco do enunciado (palpite de conhecimento) ═══════════════════
// Padrão real capturado no log de 2026-07-08: o llama-3.1-8b não acha a resposta
// na página e "extrai" citando o PRÓPRIO ENUNCIADO como evidência.

const QUESTION = `Ao estudar algoritmos quadráticos de ordenação, um estudante precisa associar corretamente características específicas aos métodos Bubble Sort e Selection Sort. Compreender essas propriedades ajuda a decidir qual algoritmo utilizar em diferentes contextos práticos.
A) (2); (1); (3). B) (1); (2); (3). C) (2); (3); (1). D) (3); (1); (2). E) (1); (3); (2).`;

const UNRELATED_PAGE = `QConcursos - Questões de concursos públicos. Banco de questões sobre ordenação,
estruturas de dados e programação. Bubble Sort compara elementos adjacentes repetidamente.
Selection Sort busca o menor elemento a cada passagem. Algoritmos in-place economizam memória.`;

test('eco do enunciado é detectado: evidência = enunciado, ausente na página', () => {
    // Resposta REAL do Groq 8B no log do usuário (Questão 10, que a extensão errou)
    const content = `RESULTADO: ENCONTRADO

EVIDÊNCIA: "Compreender essas propriedades ajuda a decidir qual algoritmo utilizar em diferentes contextos práticos."
RACIOCÍNIO: Passo 1: O texto afirma que compreender as propriedades ajuda a decidir.
Letra B: (1); (2); (3)`;

    const r = parseAiExtractionResponse(content, { sourceText: UNRELATED_PAGE, questionText: QUESTION });
    assert.equal(r.status, 'found');
    assert.equal(r.letter, 'B');
    assert.equal(r.evidenceVerified, false);
    assert.equal(r.evidenceEchoesQuestion, true, 'deveria detectar que a evidência é o próprio enunciado');
    assert.equal(r.confidence, 0.45);
});

test('evidência presente na PÁGINA (mesmo estando também na questão) → verificada, sem eco', () => {
    // Caso Brainly: a página contém a questão inteira + gabarito. Evidência existe
    // nos dois lugares → verified=true vence e NÃO é palpite.
    const pageWithQuestion = `${QUESTION}\nGabarito: A. O Selection Sort realiza uma única troca por iteração externa.`;
    const content = `RESULTADO: ENCONTRADO
EVIDÊNCIA: "Compreender essas propriedades ajuda a decidir qual algoritmo utilizar em diferentes contextos práticos."
RACIOCÍNIO: a página contém a questão completa com gabarito A.
Letra A: (2); (1); (3)`;

    const r = parseAiExtractionResponse(content, { sourceText: pageWithQuestion, questionText: QUESTION });
    assert.equal(r.evidenceVerified, true);
    assert.equal(r.evidenceEchoesQuestion, false);
    assert.ok(r.confidence >= 0.85);
});

// ═══ VoteTally: colapso de votos correlatos ═══════════════════════════════════

test('3 palpites de conhecimento na mesma letra contam UMA vez (max, não soma)', () => {
    // Era assim que 3×0.55 do mesmo 8B viravam "confirmed 99%" no log
    const sources = [
        { letter: 'A', confidence: 0.45, evidenceType: 'ai-knowledge', evidenceVerified: false },
        { letter: 'A', confidence: 0.45, evidenceType: 'ai-knowledge', evidenceVerified: false },
        { letter: 'A', confidence: 0.45, evidenceType: 'ai-knowledge', evidenceVerified: false }
    ];
    const t = tallySourceVotes(sources);
    assert.equal(t.votes.A, 0.45, 'votos correlatos não podem somar');
    assert.equal(t.hasGroundedEvidence, false);
    assert.equal(t.knowledgeOnly, true);
});

test('fonte com evidência verificada domina palpites de conhecimento', () => {
    const sources = [
        { letter: 'B', confidence: 0.45, evidenceType: 'ai-knowledge', evidenceVerified: false },
        { letter: 'B', confidence: 0.45, evidenceType: 'ai-knowledge', evidenceVerified: false },
        { letter: 'A', confidence: 0.86, evidenceType: 'jina-ai-text', evidenceVerified: true }
    ];
    const t = tallySourceVotes(sources);
    assert.equal(t.bestLetter, 'A');
    assert.equal(t.hasGroundedEvidence, true);
    assert.equal(t.knowledgeOnly, false);
});

test('REGRESSÃO Q10: 1 palpite errado (B) vs árbitro forte (A) → A vence', () => {
    // Cenário exato da Questão 10 do usuário: o 8B chutou B "(1); (2); (3)" com
    // evidência-eco; o árbitro (modelo forte) raciocina e conclui A "(2); (1); (3)".
    const sources = [
        { letter: 'B', confidence: 0.45, evidenceType: 'ai-knowledge', evidenceVerified: false },
        { letter: 'A', confidence: 0.78, evidenceType: 'ai-reasoning', evidenceVerified: null }
    ];
    const t = tallySourceVotes(sources);
    assert.equal(t.bestLetter, 'A', 'o raciocínio do modelo forte deve vencer o palpite do 8B');
    assert.equal(t.hasGroundedEvidence, false, 'ainda é opinião de IA — não pode virar "confirmed"');
});

test('votos fundamentados de páginas diferentes continuam somando normalmente', () => {
    const sources = [
        { letter: 'A', confidence: 0.86, evidenceType: 'jina-ai-text', evidenceVerified: true },
        { letter: 'A', confidence: 0.86, evidenceType: 'jina-ai-text', evidenceVerified: true },
        { letter: 'C', confidence: 0.55, evidenceType: 'jina-ai-text', evidenceVerified: false }
    ];
    const t = tallySourceVotes(sources);
    assert.ok(Math.abs(t.votes.A - 1.72) < 1e-9, 'evidência independente soma');
    assert.equal(t.bestLetter, 'A');
    assert.equal(t.hasGroundedEvidence, true);
});

test('snippet rebaixado para ai-knowledge também colapsa com os demais palpites', () => {
    const sources = [
        { letter: 'A', confidence: 0.50, evidenceType: 'ai-knowledge', evidenceVerified: false }, // snippet não verificado
        { letter: 'A', confidence: 0.45, evidenceType: 'ai-knowledge', evidenceVerified: false }  // extração-eco
    ];
    const t = tallySourceVotes(sources);
    assert.equal(t.votes.A, 0.50, 'usa o máximo entre os palpites');
    assert.equal(t.knowledgeOnly, true);
});
