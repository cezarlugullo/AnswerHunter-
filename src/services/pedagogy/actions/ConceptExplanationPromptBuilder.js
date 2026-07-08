import { buildMathFormattingBlock } from '../core/PedagogicalPromptKernel.js';

export function buildConceptExplanationRequest({
    resolvedConcept = '',
    resolvedContext = '',
    subject = '',
    conceptProfile = null,
    domain = 'general',
    mathSignals = null,
    roleBlock = '',
    bestPracticesBlock = '',
    exactSciencesFewShot = '',
}) {
    const systemMsg = domain === 'exact_sciences'
        ? `${roleBlock}

${bestPracticesBlock}

    ${buildMathFormattingBlock()}

${exactSciencesFewShot}

<instructions>Você é um professor de exatas extremamente didático.

Método obrigatório para questões de exatas:
1. IDENTIFIQUE O TIPO DE PROBLEMA: diga o que a questão está pedindo de fato
2. FERRAMENTA CERTA: diga qual regra ou teste entra primeiro
3. PASSO A PASSO: mostre a sequência operacional com a expressão da questão
4. ARMADILHA CLÁSSICA: explique o erro mais comum do aluno
5. CHECKLIST DE PROVA: termine com um roteiro reutilizável de 3 itens

Regras:
- Nada de analogia infantil ou metáfora frouxa
- Use linguagem de resolução e passos curtos
- Quando houver expressão, gráfico, unidade, grandeza ou circuito, trabalhe sobre isso explicitamente
- Se aparecer 0/0, diga que é indeterminação; se houver domínio, mostre a restrição antes do resto; se houver unidade, valide o resultado fisicamente</instructions>`
        : `${roleBlock}

${bestPracticesBlock}

<instructions>Você é um professor que transforma conceitos complexos em entendimento real.

Método de explicação obrigatório (SEMPRE nesta ordem):
1. DEFINIÇÃO SIMPLES: o que é, em 1 frase sem jargão
2. ANALOGIA: compare com algo do cotidiano brasileiro
3. COMO FUNCIONA: mecanismo em 2-3 passos numerados
4. EXEMPLO CONCRETO: caso real ou aplicação prática
5. CONEXÕES: 2-3 conceitos relacionados para revisar junto

Formato: Markdown com emojis. ADHD-friendly: parágrafos curtos, bullets quando possível.</instructions>`;

    const prompt = `<context>
Explique o conceito: **${resolvedConcept.slice(0, 200)}**

    ${resolvedContext ? `Apareceu neste contexto:\n${resolvedContext.slice(0, 500)}` : ''}
    ${conceptProfile?.scenario ? `Tipo de situação: ${conceptProfile.scenario}` : ''}
    ${domain === 'exact_sciences' && mathSignals ? `Tema de exatas detectado: ${mathSignals.topic}\nPrimeiro passo importante: ${mathSignals.firstStep}` : ''}
${subject ? `Disciplina: ${subject}` : ''}
</context>

<task>
${domain === 'exact_sciences'
        ? 'Mostre a lógica operacional da questão. Máximo 380 palavras. Linguagem acessível mas rigorosa.'
        : 'Siga o método de 5 etapas. Máximo 300 palavras. Linguagem acessível mas rigorosa.'}
</task>`;

    return {
        systemMsg,
        prompt,
        maxTokens: domain === 'exact_sciences' ? 750 : 600,
        fallbackValue: `Não foi possível gerar a explicação de "${resolvedConcept}". Tente pesquisar o conceito diretamente.`,
    };
}
