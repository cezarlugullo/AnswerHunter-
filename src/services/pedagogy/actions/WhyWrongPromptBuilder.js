import { buildMathFormattingBlock } from '../core/PedagogicalPromptKernel.js';

export function buildWhyWrongRequest({
    questionText = '',
    wrongLetter = '',
    wrongText = '',
    correctLetter = '',
    correctText = '',
    subject = '',
    allAlternatives = [],
    domain = 'general',
    mathSignals = null,
    roleBlock = '',
    bestPracticesBlock = '',
}) {
    let altsList = '';
    if (allAlternatives.length > 0) {
        altsList = allAlternatives.map((a) => `${a.letter}) ${a.text}`).join('\n');
    }

    const systemMsg = domain === 'exact_sciences'
        ? `${roleBlock}

${bestPracticesBlock}

${buildMathFormattingBlock()}

<instructions>Você é um tutor especialista em diagnosticar erros conceituais e procedurais em exatas.
Sua missão é transformar cada erro em uma oportunidade de aprendizado genuíno.

Princípios científicos que você aplica:
- FEEDBACK DE CRESCIMENTO: nunca punitivo, sempre construtivo (Yeager et al. 2014)
- DIAGNÓSTICO PRECISO: identifique o primeiro desvio relevante do procedimento, não apenas o resultado final
- FOCO OPERACIONAL: mostre onde o aluno trocou regra, ignorou domínio, errou sinal, unidade, comparação ou interpretação algébrica
- ADHD-FRIENDLY: frases curtas, uma ideia por vez, emojis como âncoras visuais

⚠️ PROIBIDO: começar com "Você errou porque...", "Infelizmente", "Está errado pois".
✅ OBRIGATÓRIO: começar com compreensão do raciocínio plausível do aluno, sem julgamento.
✅ Em exatas, sempre que houver expressão, função, unidade, gráfico ou equação, comente isso explicitamente.</instructions>`
        : `Você é um tutor especialista em diagnosticar erros conceituais de estudantes.
Sua missão é transformar cada erro em uma oportunidade de aprendizado genuíno.

Princípios científicos que você aplica:
- FEEDBACK DE CRESCIMENTO: nunca punitivo, sempre construtivo (Yeager et al. 2014)
- DIAGNÓSTICO PRECISO: identifique o equívoco cognitivo ESPECÍFICO, não o erro genérico
- ELABORATIVE INTERROGATION: faça o aluno reconstruir o raciocínio correto
- ADHD-FRIENDLY: frases curtas, uma ideia por vez, emojis como âncoras visuais

⚠️ PROIBIDO: começar com "Você errou porque...", "Infelizmente", "Está errado pois".
✅ OBRIGATÓRIO: começar com compreensão do raciocínio do aluno, sem julgamento.`;

    const prompt = `QUESTÃO:
${questionText.slice(0, 1200)}

ALTERNATIVAS:
${altsList || `${wrongLetter}) ${wrongText}\n${correctLetter}) ${correctText}`}

O aluno escolheu: ${wrongLetter}) ${wrongText}
Resposta correta: ${correctLetter}) ${correctText}
${subject ? `Disciplina: ${subject}` : ''}
${domain === 'exact_sciences' && mathSignals ? `Tema de exatas detectado: ${mathSignals.topic}\nPrimeiro ponto de verificação: ${mathSignals.firstStep || 'identifique o procedimento aplicável'}` : ''}

Gere uma análise diagnóstica PERSONALIZADA seguindo este formato EXATO:

🎯 **O que você estava pensando:**
[Em 2-3 frases, reconstituir o raciocínio PLAUSÍVEL que levou o aluno a escolher ${wrongLetter}.
Nunca condene — compreenda. Use "É natural pensar que..." ou "Faz sentido considerar..."]

📋 **Análise das Alternativas:**
${allAlternatives.map((a) => `- **${a.letter})** ${a.letter === correctLetter ? '✅' : '❌'} [Em 1-2 frases explique o motivo. Se errada, diga qual conceito invalida. Se correta, qual a sustenta.]`).join('\n\n')}

🔑 **Regra para nunca mais errar:**
[Uma heurística prática, memorável e aplicável. Ex: "Sempre que ver X, pergunte-se Y."
Máximo 2 frases.]

🧠 **Checkpoint de compreensão:**
[Uma mini-pergunta reflexiva para o aluno testar se realmente entendeu.]

MÁX: 300 palavras total. Tom: coach encorajador, nunca professor decepcionado.
${domain === 'exact_sciences'
        ? 'Em exatas, priorize linguagem procedural: isolar, substituir, verificar domínio, comparar unidade, conferir sinal, aplicar regra e testar consistência.'
        : ''}`;

    return {
        systemMsg,
        prompt,
        fallbackValue: `Você escolheu ${wrongLetter}, mas a resposta correta é ${correctLetter}. Revise o conceito relacionado e tente novamente!`,
    };
}
