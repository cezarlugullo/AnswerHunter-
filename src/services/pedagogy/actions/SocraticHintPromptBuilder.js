import { buildMathFormattingBlock } from '../core/PedagogicalPromptKernel.js';

export function buildSocraticHintRequest({
    questionText = '',
    parsedQuestion = { stem: '' },
    parsedOptionsMap = {},
    hasStructuredOptions = false,
    conceptName = 'conceito central',
    scenarioName = 'concept',
    keywords = '',
    domain = 'general',
    mathSignals = null,
    hintLevel = 1,
    previousHint = '',
    roleBlock = '',
    bestPracticesBlock = '',
    exactSciencesFewShot = '',
}) {
    const optionsList = Object.entries(parsedOptionsMap)
        .map(([k, v]) => `${k}) ${v}`)
        .join('\n');

    const systemMsg = domain === 'exact_sciences'
        ? `${roleBlock}

${bestPracticesBlock}

${buildMathFormattingBlock()}

<instructions>Você é um tutor socrático de exatas. Sua lei suprema: NUNCA revelar a alternativa correta diretamente.

Princípios obrigatórios:
- Fazer o aluno identificar o TIPO de problema antes de calcular
- Guiar por procedimento: grandezas, restrições, lei/regra/equação aplicável e comparação de alternativas
- Tratar domínio, unidade, sinal, gráfico e consistência física/matemática como pistas operacionais
- Falar em passos curtos e verificáveis, não em abstrações vagas
- Em exatas, uma boa dica mostra o próximo passo, não uma história decorativa

Violação absoluta: dizer a letra correta, o valor final exato ou copiar a alternativa correta.</instructions>

${exactSciencesFewShot}`
        : `${roleBlock}

${bestPracticesBlock}

<instructions>Você é um tutor socrático mestre. Sua lei suprema: NUNCA revelar a resposta diretamente.

Filosofia socrática aplicada:
- Perguntas que ativam o conhecimento que o aluno JÁ TEM
- Eliminar confusões, não fornecer respostas
- Conduzir o aluno a "descobrir" a resposta por conta própria
- Cada nível progressivamente mais revelador, mas NUNCA completo
- Se o enunciado vier sem alternativas estruturadas, adapte a dica para trabalhar com conceito, contraste e pistas do enunciado

Violação absoluta: mencionar qual é a alternativa correta, mesmo indiretamente.</instructions>`;

    const levelInstructions = domain === 'exact_sciences' ? {
        1: `NÍVEL 1 — ORIENTAÇÃO INICIAL:
- Diga qual é o PRIMEIRO teste ou verificação que o aluno precisa fazer
- Puxe o aluno para o tipo de problema: ${mathSignals?.topic || 'exatas'}
- Se houver função, peça para analisar cada uma separadamente
- Máximo 3 frases e termine com 1 pergunta útil`,
        2: `NÍVEL 2 — ROTEIRO DE RESOLUÇÃO:
- Aponte 2 ou 3 passos concretos de resolução sem concluir a resposta
- Se houver alternativas, mostre como eliminar as que violam domínio, sinal, forma algébrica ou procedimento
- Use a heurística principal: ${mathSignals?.checklist?.join('; ') || 'classifique, simplifique e compare'}
- Máximo 4 frases`,
        3: `NÍVEL 3 — MINI-AULA PROCEDURAL:
- Explique o raciocínio correto em sequência operacional
- Diga a armadilha principal: ${mathSignals?.warning || 'não confundir procedimento com resposta'}
- Pode mostrar a estrutura do cálculo, mas SEM dar a letra correta ou copiar a alternativa certa
- Máximo 5 frases`
    } : {
        1: `NÍVEL 1 — DICA MÍNIMA (ativa o conceito):
- Faça UMA pergunta aberta que direcione ao conceito central da questão
- Não mencione nenhuma alternativa específica
- Estilo: "O que você sabe sobre o papel de X no contexto Y?"
- Máximo 2 frases. Termine sempre com "?"`,
        2: `NÍVEL 2 — DICA MÉDIA (elimina distratores):
- Se houver alternativas claras, ajude a eliminar 1-2 distratores SEM revelar a correta
- Se NÃO houver alternativas claras, destaque a distinção mais importante que separa a resposta certa dos erros comuns
- Termine com uma pergunta que force comparação, não adivinhação
- Máximo 4 frases`,
        3: `NÍVEL 3 — DICA MÁXIMA (revela conceito, não a letra):
- Explique o CONCEITO central detalhadamente (como uma mini-aula)
- Diga qual TIPO de raciocínio leva à resposta correta
- NUNCA nomeie a alternativa correta por letra ou texto exato
- Máximo 5 frases`
    };

    const prompt = `<context>
QUESTÃO:
    ${(parsedQuestion.stem || questionText).slice(0, 1000)}

    CONCEITO CENTRAL INFERIDO: ${conceptName}
    CENÁRIO DE APRENDIZAGEM: ${scenarioName}
    DOMÍNIO PEDAGÓGICO: ${domain === 'exact_sciences' ? `exatas (${mathSignals?.topic || 'geral'})` : 'geral'}
    ${keywords ? `PALAVRAS-CHAVE: ${keywords}` : ''}
    ${domain === 'exact_sciences' && mathSignals ? `PISTA OPERACIONAL: ${mathSignals.firstStep}` : ''}

${optionsList ? `ALTERNATIVAS:\n${optionsList}\n` : ''}
${previousHint ? `DICA ANTERIOR (não repita):\n${previousHint}\n` : ''}
</context>

<task>
${levelInstructions[hintLevel] || levelInstructions[1]}

    REGRAS ADICIONAIS:
    - ${hasStructuredOptions ? 'Se mencionar alternativas, fale do ERRO conceitual ou procedural delas, nunca da letra correta.' : 'Como não há alternativas bem estruturadas, concentre-se no próximo passo do procedimento.'}
    - ${domain === 'exact_sciences' ? 'Em exatas, prefira verbos de ação: isole, substitua, testa domínio, aplica lei, compara unidade, verifica sinal.' : 'Mantenha o foco no contraste conceitual principal.'}
    - Use no máximo 1 pergunta final.
    - Gere APENAS o texto da dica. Sem título, sem prefixo "Dica:", sem introdução.
</task>`;

    const fallbackValue = domain === 'exact_sciences'
        ? hintLevel === 1
            ? `Antes de pensar na alternativa, identifique o tipo de problema e faça este primeiro teste: ${mathSignals?.firstStep || 'classifique a relação entre dados e incógnita'}.`
            : hintLevel === 2
                ? `Monte um roteiro curto: ${mathSignals?.checklist?.slice(0, 2).join('; ') || 'classifique, simplifique e compare'}. Depois elimine as alternativas que violam esse roteiro.`
                : `Resolva por procedimento: ${mathSignals?.checklist?.join('; ') || 'classifique, simplifique e compare'}, mas sem pular direto para a alternativa.`
        : hintLevel === 1
            ? `Tente identificar a palavra-chave do enunciado. O que ela ativa dentro de ${conceptName}?`
            : hintLevel === 2
                ? (hasStructuredOptions
                    ? 'Quais alternativas contradizem diretamente a ideia central do enunciado? O que sobra depois dessa eliminação?'
                    : `Qual contraste separa ${conceptName} dos erros mais comuns neste tipo de questão?`)
                : `Releia o enunciado focando no raciocínio exigido por ${conceptName}: regra geral, exceção, comparação ou sequência?`;

    return {
        systemMsg,
        prompt,
        fallbackValue,
    };
}
