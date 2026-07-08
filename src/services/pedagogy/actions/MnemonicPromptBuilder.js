import {
    finalizeMnemonicPayload,
    scoreMnemonicPayload,
} from '../mnemonics/MnemonicPromptSupport.js';
import { buildMathFormattingBlock } from '../core/PedagogicalPromptKernel.js';

export function buildMnemonicRequest({
    prepared,
    promptSections,
    domain = 'general',
    mathSignals = null,
    roleBlock = '',
    bestPracticesBlock = '',
    exactSciencesFewShot = '',
}) {
    const typeGuides = {
        acronym: 'Use acrônimo ou acróstico: primeira letra de cada elemento-chave forma uma palavra ou frase memorável e rítmica. A frase deve ser absurda o suficiente para grudar.',
        story: 'Crie uma micro-narrativa CINEMATOGRÁFICA de 2-3 frases: personagens absurdos + ação exagerada + desfecho que revela o conceito. Ative o hipocampo via narrativa emocional.',
        rhyme: 'Crie uma rima curta de 2-4 versos com RITMO forte (pode ser cantada). Rimas são 2x mais retidas que prosa. Use humor nos versos.',
        visual: 'Foque em uma CENA MENTAL impossível e espacial: exagere tamanhos, cores e ações. O aluno deve "ver um filme" na cabeça. Use Method of Loci se houver sequência.',
        keyword: 'Use Keyword Method: encontre uma palavra em português que SOE PARECIDO com o termo técnico, e crie uma imagem que conecte o som ao significado real.',
        any: 'Escolha a técnica que criar o mnemônico mais IMPACTANTE e engraçado: acrônimo, micro-história, rima, keyword sonoro, ou cena visual impossível. Priorize humor + absurdidade.'
    };

    const systemMsg = [
        roleBlock,
        bestPracticesBlock,
        domain === 'exact_sciences' ? buildMathFormattingBlock() : '',
        promptSections.preamble,
        promptSections.brevity,
        promptSections.visualization,
        promptSections.naturalness,
        domain === 'exact_sciences' ? `━━━ REGRAS PARA EXATAS ━━━
Se a questão for de matemática, física, química quantitativa ou afins, NÃO force historinhas infantis.
Prefira um mnemônico de PROCEDIMENTO: gatilho curto + ordem de checagem + imagem operacional simples.
Boas âncoras para exatas: reta, buraco, barreira, gráfico, vetor, balança, circuito, eixo e unidade.
O aluno precisa lembrar O QUE FAZER, não só uma frase engraçada.
Tema detectado: ${mathSignals?.topic || 'exatas'}.
Primeiro passo útil: ${mathSignals?.firstStep || 'classificar a relação entre dados e incógnita'}.` : '',
        promptSections.technical,
        promptSections.affirmatives,
        promptSections.output,
        promptSections.examples,
        domain === 'exact_sciences' ? exactSciencesFewShot : ''
    ].filter(Boolean).join('\n\n');

    const prompt = `<context>
CONCEITO A MEMORIZAR:
${prepared.concept.slice(0, 500)}

TIPO DE SITUAÇÃO: ${prepared.scenario}
    DOMÍNIO PEDAGÓGICO: ${domain === 'exact_sciences' ? `exatas (${mathSignals?.topic || 'geral'})` : 'geral'}
TÉCNICA PREFERIDA: ${typeGuides[prepared.resolvedType] || typeGuides.any}
ELEMENTOS-CHAVE SUGERIDOS:
${prepared.keyElements.map((item) => `- ${item}`).join('\n') || '- Use o conceito central e a resposta correta como base'}

QUESTÃO ORIGINAL (para contexto, não para copiar inteira):
${prepared.rawQuestion.slice(0, 900)}


${prepared.answerText ? `RESPOSTA CORRETA / CONTEXTO:\n${prepared.answerText.slice(0, 400)}\n` : ''}
</context>

<task>
CRITÉRIOS DE QUALIDADE OBRIGATÓRIOS:
- O mnemônico precisa soar natural em português brasileiro.
- Se a técnica gerar trocadilho feio ou artificial, troque de técnica.
- O bloco "mnemonic" deve caber sozinho no modo curto.
- "keyElements" devem explicar a lógica sem virar um mini-texto.
- Não copie o enunciado e não escreva uma redação longa.
- ${domain === 'exact_sciences' ? 'Em exatas, o mnemônico deve lembrar o PROCEDIMENTO: o que checar primeiro, qual relação usar, que restrição, sinal ou unidade observar.' : 'Se houver cena mental, ela deve reconstruir o conceito com clareza.'}

Agora siga os 5 passos, gere o JSON e garanta que o aluno consiga RECONSTRUIR a resposta completa a partir do mnemônico.
</task>`;

    const fallbackValue = {
        emoji: '🧠',
        mnemonic: `${prepared.concept.slice(0, 36)} em cena concreta.`,
        keyElements: prepared.keyElements.length ? prepared.keyElements.slice(0, 2) : [`Conceito central → ${prepared.concept}`],
        visualization: `Imagine uma cena simples e concreta ligada a ${prepared.concept.slice(0, 40)} em um lugar familiar.`,
        connection: `A cena concreta ajuda a reconstruir ${prepared.concept} sem decorar o texto literal.`,
        selfTest: `Que cena faz você lembrar ${prepared.concept}?`,
        type: prepared.resolvedType || 'story',
        concept: prepared.concept,
        scenario: prepared.scenario,
        requestedType: prepared.requestedType,
        resolvedType: prepared.resolvedType,
        signature: prepared.signature,
        qualityScore: 3,
    };

    return {
        systemMsg,
        prompt,
        fallbackValue,
    };
}

export function createMnemonicResponseParser(prepared) {
    return (content) => {
        if (!content) return null;
        try {
            let cleaned = content
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/, '')
                .trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) cleaned = jsonMatch[0];
            const parsed = JSON.parse(cleaned);
            return finalizeMnemonicPayload(parsed, prepared);
        } catch (_) {
            if (content.trim().length > 5) {
                return finalizeMnemonicPayload({
                    emoji: '',
                    mnemonic: content.trim(),
                    keyElements: prepared.keyElements || [],
                    visualization: '',
                    connection: '',
                    selfTest: '',
                    type: prepared.resolvedType || 'story',
                }, prepared);
            }
            return null;
        }
    };
}

export function isValidMnemonicPayload(value, prepared) {
    if (!value || typeof value.mnemonic !== 'string' || value.mnemonic.length < 4 || value.mnemonic.length > 800) return false;
    if (scoreMnemonicPayload(value, prepared) < 6) return false;
    if (!Array.isArray(value.keyElements) || value.keyElements.length < 2) return false;
    if (!value.selfTest || !/\?/i.test(value.selfTest)) return false;
    return true;
}
