/**
 * PedagogicalPromptsService.js
 *
 * Serviço de prompts pedagógicos avançados para o AnswerHunter.
 * Baseado em evidências científicas de Ciência Cognitiva e Educacional:
 *
 * - Roediger & Karpicke (2006): Retrieval Practice Effect
 * - Dunlosky & Metcalfe (2009): Metacognição e JOL (Judgment of Learning)
 * - Kornell & Bjork (2008): Interleaving (+43% retenção)
 * - Yeager et al. (2014): Feedback de crescimento, não punitivo
 * - Pardos & Bhandari (2023): Tutoria socrática por IA (+28% aprendizado)
 * - Deci & Ryan (SDT): Autonomia, competência, pertencimento
 *
 * Integra com ApiService._callWithProviderChain para fallback automático
 * entre Groq, Gemini, OpenRouter, ChatGPT e Copilot.
 *
 * @module PedagogicalPromptsService
 * @version 1.0.0
 * @author AnswerHunter Research Team
 */

import { ApiService } from './ApiService.js';

export const PedagogicalPromptsService = {

    // ─────────────────────────────────────────────────────────────────────────
    // 1. GENERATE WHY WRONG — "Por que eu errei?"
    //    Análise personalizada e empática do erro cognitivo do aluno.
    //    Baseado em: Yeager et al. (2014) — feedback de crescimento, não punitivo
    //    Impacto: reduz ansiedade de teste, aumenta disposição para rever erros
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera análise personalizada de por que o aluno errou uma questão.
     * @param {string} questionText - Enunciado completo da questão
     * @param {string} wrongLetter - Letra que o aluno escolheu (ex: "B")
     * @param {string} wrongText - Texto da alternativa errada escolhida
     * @param {string} correctLetter - Letra da resposta correta (ex: "D")
     * @param {string} correctText - Texto da alternativa correta
     * @param {string} [subject] - Disciplina/assunto (opcional)
     * @returns {Promise<string>} Análise pedagógica formatada em Markdown
     */
    async generateWhyWrong(questionText, wrongLetter, wrongText, correctLetter, correctText, subject = '', allAlternatives = []) {
        const settings = await ApiService._getSettings();

        // Build alternatives list for the prompt
        let altsList = '';
        if (allAlternatives.length > 0) {
            altsList = allAlternatives.map(a => `${a.letter}) ${a.text}`).join('\n');
        }

        const systemMsg = `Você é um tutor especialista em diagnosticar erros conceituais de estudantes.
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

Gere uma análise diagnóstica PERSONALIZADA seguindo este formato EXATO:

🎯 **O que você estava pensando:**
[Em 2-3 frases, reconstituir o raciocínio PLAUSÍVEL que levou o aluno a escolher ${wrongLetter}.
Nunca condene — compreenda. Use "É natural pensar que..." ou "Faz sentido considerar..."]

📋 **Análise das Alternativas:**
${allAlternatives.map(a => `- **${a.letter})** ${a.letter === correctLetter ? '✅' : '❌'} [Em 1-2 frases explique o motivo. Se errada, diga qual conceito invalida. Se correta, qual a sustenta.]`).join('\n\n')}

🔑 **Regra para nunca mais errar:**
[Uma heurística prática, memorável e aplicável. Ex: "Sempre que ver X, pergunte-se Y."
Máximo 2 frases.]

🧠 **Checkpoint de compreensão:**
[Uma mini-pergunta reflexiva para o aluno testar se realmente entendeu.]

MÁX: 300 palavras total. Tom: coach encorajador, nunca professor decepcionado.`;

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.35, max_tokens: 800 },
            models: {
                gemini: settings.geminiModelSmart || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            label: 'generateWhyWrong',
            fallbackValue: `Você escolheu ${wrongLetter}, mas a resposta correta é ${correctLetter}. Revise o conceito relacionado e tente novamente!`,
        });
        return result;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 2. GENERATE SOCRATIC HINT — Dica Socrática Progressiva (3 Níveis)
    //    Guia o raciocínio do aluno SEM revelar a resposta diretamente.
    //    Baseado em: Método Socrático + Khanmigo (Pardos & Bhandari 2023)
    //    Impacto: +28% de ganho de aprendizado vs explicação direta
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera dica socrática progressiva para guiar o aluno sem revelar a resposta.
     * @param {string} questionText - Enunciado completo da questão
     * @param {Object} optionsMap - Mapa { A: "texto", B: "texto", ... }
     * @param {number} hintLevel - Nível: 1 (mínima), 2 (média), 3 (máxima)
     * @param {string} [previousHint] - Dica anterior para evitar repetição
     * @returns {Promise<string>} Dica socrática formatada
     */
    async generateSocraticHint(questionText, optionsMap = {}, hintLevel = 1, previousHint = '') {
        const settings = await ApiService._getSettings();
        const optionsList = Object.entries(optionsMap)
            .map(([k, v]) => `${k}) ${v}`)
            .join('\n');

        const systemMsg = `Você é um tutor socrático mestre. Sua lei suprema: NUNCA revelar a resposta diretamente.

Filosofia socrática aplicada:
- Perguntas que ativam o conhecimento que o aluno JÁ TEM
- Eliminar confusões, não fornecer respostas
- Conduzir o aluno a "descobrir" a resposta por conta própria
- Cada nível progressivamente mais revelador, mas NUNCA completo

Violação absoluta: mencionar qual é a alternativa correta, mesmo indiretamente.`;

        const levelInstructions = {
            1: `NÍVEL 1 — DICA MÍNIMA (ativa o conceito):
- Faça UMA pergunta aberta que direcione ao conceito central da questão
- Não mencione nenhuma alternativa específica
- Estilo: "O que você sabe sobre o papel de X no contexto Y?"
- Máximo 2 frases. Termine sempre com "?"`,

            2: `NÍVEL 2 — DICA MÉDIA (elimina distratores):
- Ajude a eliminar 1-2 alternativas claramente incorretas SEM revelar a correta
- Faça uma pergunta sobre as alternativas restantes
- Máximo 4 frases`,

            3: `NÍVEL 3 — DICA MÁXIMA (revela conceito, não a letra):
- Explique o CONCEITO central detalhadamente (como uma mini-aula)
- Diga qual TIPO de raciocínio leva à resposta correta
- NUNCA nomeie a alternativa correta por letra ou texto exato
- Máximo 5 frases`
        };

        const prompt = `QUESTÃO:
${questionText.slice(0, 1000)}

${optionsList ? `ALTERNATIVAS:\n${optionsList}\n` : ''}
${previousHint ? `DICA ANTERIOR (não repita):\n${previousHint}\n` : ''}
${levelInstructions[hintLevel] || levelInstructions[1]}

Gere APENAS o texto da dica. Sem título, sem prefixo "Dica:", sem introdução.`;

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.4, max_tokens: 200 },
            models: {
                gemini: settings.geminiModel || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            label: `generateSocraticHint_L${hintLevel}`,
            fallbackValue: hintLevel === 1
                ? 'Tente identificar a palavra-chave do enunciado. Qual conceito principal ela ativa?'
                : hintLevel === 2
                    ? 'Elimine as alternativas que claramente contradizem o enunciado. O que resta?'
                    : 'Releia o enunciado focando no que a questão realmente pede: contexto, exceção ou regra geral?',
        });
        return result;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 3. GENERATE SIMILAR QUESTION V2 — Com Nível de Dificuldade
    //    Versão melhorada com difficulty levels e conceito explicitado.
    //    Baseado em: Interleaving (Kornell & Bjork 2008), Design de Questões
    //    Impacto: +43% retenção vs blocking quando combinado com interleaving
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera questão similar com nível de dificuldade configurável.
     * @param {string} originalQuestion - Questão original completa
     * @param {number} difficulty - 1 (mais fácil), 2 (igual), 3 (mais difícil)
     * @param {string} [conceptTag] - Conceito central identificado (opcional)
     * @param {string} [subject] - Disciplina para contexto de interleaving
     * @returns {Promise<Object>} { questionText, optionsMap, answerLetter, explanation, conceptTag, difficulty }
     */
    async generateSimilarQuestionV2(originalQuestion, difficulty = 2, conceptTag = '', subject = '') {
        const settings = await ApiService._getSettings();

        const difficultyGuide = {
            1: 'MAIS FÁCIL: Cenário familiar, contexto direto, distradores com erros mais óbvios.',
            2: 'IGUAL: Mesmo nível de abstração, contexto diferente, distradores plausíveis similares.',
            3: 'MAIS DIFÍCIL: Adicione condição extra, negação, exceção à regra ou situação-limite. Exige análise profunda.'
        };

        const systemMsg = `Você é especialista em design educacional de questões para provas brasileiras (ENEM, vestibular, concursos).

Princípios de design:
- INTERLEAVING: contexto/cenário diferente do original (força transferência de conhecimento)
- DISTRADORES COGNITIVOS: alternativas erradas baseadas em equívocos REAIS de estudantes
- VALIDADE PREDITIVA: distingue quem entendeu de quem memorizou
- EVITAR: dupla negação, "sempre/nunca" absolutos, alternativas óbvias por tamanho

Responda APENAS em JSON válido. Sem markdown, sem texto adicional.`;

        const prompt = `QUESTÃO ORIGINAL:
${originalQuestion.slice(0, 1000)}

${conceptTag ? `CONCEITO CENTRAL: ${conceptTag}` : ''}
${subject ? `DISCIPLINA: ${subject}` : ''}
NÍVEL DE DIFICULDADE: ${difficulty}/3
DIRETIVA: ${difficultyGuide[difficulty] || difficultyGuide[2]}

ESTRATÉGIA:
1. Identifique o conceito central testado
2. Crie cenário COMPLETAMENTE DIFERENTE para o mesmo conceito
3. Monte 4-5 alternativas com distradores cognitivos reais
4. Aplique a diretiva de dificuldade

FORMATO JSON OBRIGATÓRIO:
{
  "questionText": "enunciado completo contextualizado",
  "optionsMap": { "A": "...", "B": "...", "C": "...", "D": "..." },
  "answerLetter": "A",
  "explanation": "Por que esta é a resposta em 1-2 frases",
  "conceptTag": "nome do conceito central",
  "difficulty": ${difficulty}
}`;

        const parseResponse = (content) => {
            if (!content) return null;
            try {
                const cleaned = content
                    .replace(/^```(?:json)?\s*/i, '')
                    .replace(/\s*```$/, '')
                    .trim();
                const parsed = JSON.parse(cleaned);
                if (!parsed.questionText || !parsed.optionsMap || !parsed.answerLetter) return null;
                return parsed;
            } catch (_) {
                const match = content.match(/\{[\s\S]*\}/);
                if (match) {
                    try { return JSON.parse(match[0]); } catch (_2) { return null; }
                }
                return null;
            }
        };

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.55, max_tokens: 700 },
            models: {
                gemini: settings.geminiModelSmart || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            postProcess: parseResponse,
            isValid: (v) => v && typeof v.questionText === 'string' && v.questionText.length > 10,
            label: `generateSimilarQuestionV2_D${difficulty}`,
        });

        if (!result) throw new Error('Não foi possível gerar questão similar. Tente novamente.');
        return result;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 4. GENERATE MNEMONIC — Gerador de Mnemônicos Multi-Sensoriais (v2)
    //    10 fontes de pesquisa em pedagogia e neurociência:
    //    [1] Dual Coding (Paivio 1971): verbal + visual → 2 vias de retrieval
    //    [2] Von Restorff / Isolation Effect (1933): bizarro → 2-3x mais lembrado
    //    [3] Elaborative Encoding (Bradshaw & Anderson 1982): conexões ricas
    //    [4] Chunking (Miller 1956): 2-4 elementos gerenciáveis
    //    [5] Testing Effect (Roediger 2006): auto-teste reforça consolidação
    //    [6] Method of Loci: imagem mental espacial ancorada
    //    [7] Keyword Method (Atkinson 1975): som-âncora → imagem → significado
    //    [8] Story Method / Narrative Mnemonic: micro-narrativa emocional
    //    [9] Elaborative Interrogation (Dunlosky 2013): perguntas "por quê?"
    //    [10] Humor Effect + Emotional Encoding: emoção dispara dopamina → memorização
    //    Meta-análise: alunos com mnemônicos recordam 2-3x mais que memorização rote
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera mnemônico multi-sensorial para um conceito de questão.
     * Aplica mecanismos psicológicos comprovados: dual coding, bizarreness effect,
     * elaborative encoding, chunking, testing effect.
     * @param {string} concept - Conceito ou fato a memorizar
     * @param {string} [questionContext] - Contexto da questão (resposta correta)
     * @param {'acronym'|'story'|'rhyme'|'visual'|'any'} preferredType - Tipo preferido
     * @returns {Promise<Object>} { emoji, mnemonic, keyElements[], visualization, connection, selfTest, type }
     */
    async generateMnemonic(concept, questionContext = '', preferredType = 'any') {
        const settings = await ApiService._getSettings();

        const typeGuides = {
            acronym: 'Use acrônimo ou acróstico: primeira letra de cada elemento-chave forma uma palavra ou frase memorável e rítmica. A frase deve ser absurda o suficiente para grudar.',
            story: 'Crie uma micro-narrativa CINEMATOGRÁFICA de 2-3 frases: personagens absurdos + ação exagerada + desfecho que revela o conceito. Ative o hipocampo via narrativa emocional.',
            rhyme: 'Crie uma rima curta de 2-4 versos com RITMO forte (pode ser cantada). Rimas são 2x mais retidas que prosa. Use humor nos versos.',
            visual: 'Foque em uma CENA MENTAL impossível e espacial: exagere tamanhos, cores e ações. O aluno deve "ver um filme" na cabeça. Use Method of Loci se houver sequência.',
            keyword: 'Use Keyword Method: encontre uma palavra em português que SOE PARECIDO com o termo técnico, e crie uma imagem que conecte o som ao significado real.',
            any: 'Escolha a técnica que criar o mnemônico mais IMPACTANTE e engraçado: acrônimo, micro-história, rima, keyword sonoro, ou cena visual impossível. Priorize humor + absurdidade.'
        };

        const systemMsg = `Você é um MESTRE em técnicas de memorização baseadas em neurociência cognitiva. Você aplica 10 mecanismos científicos comprovados para criar mnemônicos que fazem o aluno ENTENDER E DECORAR DE PRIMEIRA.

━━━ ARSENAL CIENTÍFICO (aplique TODOS os relevantes) ━━━

1. CHUNKING (Miller 1956): Quebre em 2-4 pedaços. Memória de trabalho = 4±1 itens. Agrupe termos relacionados.

2. DUAL CODING (Paivio 1971): Crie uma FRASE (canal verbal) + uma CENA MENTAL (canal visual). Dois caminhos de recordação = o dobro da chance de lembrar.

3. VON RESTORFF / EFEITO BIZARRENESS (1933): A cena mental DEVE ser ABSURDA, EXAGERADA ou IMPOSSÍVEL. Um elefante rosa digitando SQL é 3x mais memorável que "uma tela de computador". REGRA: se a imagem parece normal, REFAÇA até ficar bizarra.

4. HUMOR + EMOÇÃO (Humor Effect): FAÇA O ALUNO RIR. Humor libera dopamina → codificação mais profunda. Use trocadilhos, situações ridículas, personificação cômica. Se não provocar pelo menos um sorriso, está fraco demais.

5. KEYWORD METHOD (Atkinson 1975): Para termos técnicos, encontre uma PALAVRA-ÂNCORA em português que SOE PARECIDO com o termo. Ex: "fork()" → "garfo" → "um garfo gigante que espeta o processo e divide em dois". O som conecta o termo à imagem.

6. STORY METHOD / NARRATIVA (Stanford CTL): Transforme os elementos-chave em PERSONAGENS de uma micro-história de 2-3 frases. Histórias ativam o hipocampo + rede neural padrão = consolidação superior. A história deve ter INÍCIO (situação), AÇÃO (conflito absurdo) e RESULTADO (conceito aprendido).

7. ELABORATIVE ENCODING (Bradshaw & Anderson 1982): Conecte a algo do COTIDIANO do aluno. "Isso funciona como quando você..." — analogias concretas vencem definições abstratas sempre.

8. ELABORATIVE INTERROGATION (Dunlosky 2013): Inclua um "POR QUÊ?" que force o aluno a pensar. Não dê a resposta direta — faça ele reconstruir a lógica a partir do mnemônico. Ganho de aprendizado: +28% vs explicação passiva.

9. METHOD OF LOCI (Palácio da Memória): Quando houver SEQUÊNCIA ou ORDEM, ancore cada elemento em um LOCAL espacial familiar (porta da casa → sala → cozinha). Efeito d=0.88 em recall serial.

10. TESTING EFFECT (Roediger 2006): O selfTest deve ser uma pergunta que SÓ é respondível se o mnemônico foi internalizado. Não aceite perguntas que possam ser respondidas por eliminação ou senso comum.

━━━ PROCESSO OBRIGATÓRIO (5 PASSOS) ━━━

PASSO 1 → CHUNKING: Identifique 2-4 ELEMENTOS-CHAVE (termos, ordem, relações críticas).
PASSO 2 → FRASE-ÂNCORA: Crie o mnemônico principal (máx 2 linhas). DEVE ser:
   • Curto e rítmico (fácil de repetir em voz alta)
   • Com humor ou absurdidade (Von Restorff + Humor Effect)
   • Com palavra-âncora sonora se houver termo técnico (Keyword Method)
PASSO 3 → CENA MENTAL CINEMATOGRÁFICA: Descreva uma imagem/cena que o aluno deve "ver" na mente:
   • EXAGERADA (tamanho, quantidade, cor impossível)
   • EMOCIONAL (engraçada, assustadora ou nojenta)
   • INTERATIVA (os elementos-chave estão FAZENDO algo, não parados)
   • ESPACIAL (acontece em um lugar específico que o aluno conhece)
PASSO 4 → CONEXÃO "POR QUÊ?": Explique como cada parte do mnemônico mapeia para o conceito real. Use a pergunta: "Por que cada parte faz sentido?"
PASSO 5 → AUTO-TESTE DESAFIADOR: Crie uma pergunta que EXIJA reconstruir o mnemônico para responder. Nível: se o aluno não memorizou, NÃO consegue responder.

━━━ FORMATO JSON ━━━
- "emoji" = emoji que represente o tema
- "mnemonic" = frase-âncora (máx 2 linhas, curta, rítmica)
- "keyElements" = array de 2-4 strings "elemento → significado"
- "visualization" = cena mental bizarra/engraçada (1-3 frases cinematográficas)
- "connection" = "Por que funciona:" + mapeamento mnemônico→conceito (1-3 frases)
- "selfTest" = pergunta desafiadora (1 frase)
- "type" = "acronym"|"story"|"rhyme"|"visual"|"keyword"

REGRAS ABSOLUTAS:
- Idioma: português brasileiro coloquial (como um professor jovem e carismático fala)
- O aluno deve conseguir RECONSTRUIR a resposta COMPLETA a partir do mnemônico
- Se o conceito é abstrato, a cena mental deve ser CONCRETA (personifique!)
- PROIBIDO: cenas genéricas, imagens "normais", auto-testes triviais
- OBRIGATÓRIO: pelo menos 1 elemento de humor/absurdo + 1 analogia do cotidiano

EXEMPLOS:

CONCEITO: "Ordem dos planetas do sistema solar"
{"emoji":"🪐","mnemonic":"Minha Vó Tem Muitas Joias, Só Usa No Pescoço","keyElements":["Minha→Mercúrio","Vó→Vênus","Tem→Terra","Muitas→Marte","Joias→Júpiter","Só→Saturno","Usa→Urano","No Pescoço→Netuno"],"visualization":"Imagine sua avó GIGANTE (do tamanho do Sol) flutuando no espaço com TODAS as joias do universo penduradas no pescoço — tão pesadas que ela roda e os planetas orbitam em volta dela por causa da gravidade das joias. Cada planeta que ela passa, ela dá um tchauzinho.","connection":"Por que funciona: Cada INICIAL da frase corresponde à INICIAL do planeta, na ordem do mais próximo ao mais distante do Sol. M-V-T-M-J-S-U-N. Basta recitar a frase da vó e extrair as letras.","selfTest":"Complete sem olhar: 'Minha Vó ___ Muitas ___, Só ___ No ___' — traduza cada palavra para o planeta correspondente.","type":"acronym"}

CONCEITO: "SQL ALTER TABLE ADD COLUMN"
{"emoji":"🏗️","mnemonic":"ALTER a mesa, ADD uma tábua, escreva NOME e TIPO","keyElements":["ALTER TABLE→qual tabela modificar","ADD COLUMN→adicionar nova coluna","nome→nome da coluna","tipo→tipo de dado (INT, VARCHAR...)"],"visualization":"Imagine uma MESA de jantar velha no meio de um terremoto. Você pega um MARTELO DOURADO gigante (ALTER) e prega uma TÁBUA nova na lateral (ADD COLUMN). Na tábua, você escreve com KETCHUP o NOME da coluna e com MOSTARDA o TIPO de dado — a mesa sai andando com pernas de galinha.","connection":"Por que funciona: ALTER = alterar/reformar, como reformar um móvel caindo aos pedaços. ADD COLUMN = adicionar uma 'coluna' como se fosse uma tábua extra. A ordem na sintaxe SQL é sempre: O QUÊ mudar (tabela) → COMO mudar (add) → DETALHES (nome, tipo).","selfTest":"Escreva de cabeça o comando SQL para adicionar 'idade INT' na tabela 'alunos'. Em que ORDEM vêm os 4 termos-chave?","type":"visual"}

Responda APENAS em JSON válido, sem texto extra, sem markdown.`;

        const prompt = `CONCEITO A MEMORIZAR:
${concept.slice(0, 500)}

${questionContext ? `RESPOSTA CORRETA / CONTEXTO:\n${questionContext.slice(0, 400)}\n` : ''}
TÉCNICA PREFERIDA: ${typeGuides[preferredType] || typeGuides.any}

Agora siga os 5 passos e gere o JSON:`;

        const parseResponse = (content) => {
            if (!content) return null;
            try {
                // Extract JSON from possible markdown/text wrapping
                let cleaned = content
                    .replace(/^```(?:json)?\s*/i, '')
                    .replace(/\s*```$/, '')
                    .trim();
                // Some models wrap in <think> tags or add preamble; extract JSON
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) cleaned = jsonMatch[0];
                const parsed = JSON.parse(cleaned);
                // Normalize: ensure all fields exist with fallbacks
                return {
                    emoji: parsed.emoji || '',
                    mnemonic: parsed.mnemonic || parsed.hook || '',
                    keyElements: Array.isArray(parsed.keyElements) ? parsed.keyElements : [],
                    visualization: parsed.visualization || parsed.visual || '',
                    connection: parsed.connection || parsed.howToUse || '',
                    selfTest: parsed.selfTest || parsed.self_test || '',
                    type: parsed.type || 'phrase',
                };
            } catch (_) {
                if (content.trim().length > 5) {
                    return {
                        emoji: '',
                        mnemonic: content.trim(),
                        keyElements: [],
                        visualization: '',
                        connection: '',
                        selfTest: '',
                        type: 'text',
                    };
                }
                return null;
            }
        };

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.7, max_tokens: 800 },
            models: {
                gemini: settings.geminiModel || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            postProcess: parseResponse,
            isValid: (v) => v && typeof v.mnemonic === 'string' && v.mnemonic.length > 3 && v.mnemonic.length < 800,
            label: 'generateMnemonic',
            fallbackValue: {
                emoji: '🧠',
                mnemonic: `Para lembrar: "${concept.slice(0, 50)}"`,
                keyElements: [],
                visualization: 'Crie uma imagem mental associando este conceito a algo familiar.',
                connection: 'Conecte este conceito a algo que você já conhece.',
                selfTest: '',
                type: 'association',
            },
        });
        return result;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 5. GENERATE SESSION SUMMARY — Resumo Motivante de Sessão
    //    Coach analítico que transforma dados de sessão em feedback acionável.
    //    Baseado em: SDT (Deci & Ryan), Progress Principle (Amabile & Kramer 2011)
    //    Impacto: feedback de progresso aumenta motivação intrínseca em 73%
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera resumo motivante ao final de uma sessão de estudo.
     * @param {Object} sessionData
     * @param {number} sessionData.total - Total de questões respondidas
     * @param {number} sessionData.correct - Quantidade de acertos
     * @param {number} sessionData.wrong - Quantidade de erros
     * @param {number} sessionData.skipped - Questões puladas
     * @param {string[]} sessionData.subjects - Disciplinas estudadas
     * @param {Object[]} sessionData.wrongQuestions - [{text, subject}]
     * @param {number} sessionData.elapsedMinutes - Tempo em minutos
     * @param {number} sessionData.xpEarned - XP ganho
     * @param {number} sessionData.currentStreak - Dias consecutivos
     * @param {string} [sessionData.goal] - Meta do aluno (ex: "ENEM 2025")
     * @returns {Promise<string>} Resumo motivante formatado em Markdown
     */
    async generateSessionSummary(sessionData) {
        const settings = await ApiService._getSettings();
        const {
            total = 0, correct = 0, wrong = 0, skipped = 0,
            subjects = [], wrongQuestions = [], elapsedMinutes = 0,
            xpEarned = 0, currentStreak = 0, goal = ''
        } = sessionData;

        const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
        const wrongSubjects = [...new Set(wrongQuestions.map(q => q.subject).filter(Boolean))];
        const wrongTexts = wrongQuestions
            .slice(0, 3)
            .map(q => `- ${(q.text || '(questão sem texto)').slice(0, 80)}`)
            .join('\n');

        const systemMsg = `Você é um coach de estudos de alto desempenho — parte psicólogo motivacional, parte analista de dados.

Estilo de feedback:
- HONESTO mas ENCORAJADOR: verdade sobre desempenho sem desmotivar
- ESPECÍFICO: usa dados reais da sessão, não platitudes genéricas
- ORIENTADO À AÇÃO: termina sempre com próximo passo concreto
- CURTO e DENSO: cada palavra vale

Referência de tom por desempenho:
- 0–40%: sessão difícil → encorajamento + estratégia
- 40–70%: progresso sólido → reconhecer + identificar gaps
- 70–90%: muito bom → celebrar + desafiar
- 90–100%: excelente → celebrar + próximo nível`;

        const prompt = `DADOS DA SESSÃO:
- Total respondidas: ${total}
- Acertos: ${correct} (${pct}%)
- Erros: ${wrong}
- Puladas: ${skipped}
- Disciplinas: ${subjects.join(',') || 'Geral'}
- Tempo de estudo: ${elapsedMinutes} minutos
- XP ganho: ${xpEarned} XP
- Streak atual: ${currentStreak} dia(s)
- Erros em: ${wrongSubjects.join(',') || 'nenhum'}
${wrongTexts ? `- Questões com dificuldade:\n${wrongTexts}` : ''}
${goal ? `- Meta do aluno: ${goal}` : ''}

Gere o resumo seguindo este formato EXATO:

${pct >= 70 ? '🎯' : pct >= 40 ? '💪' : '🔥'} **Resultado: ${pct}% de acerto (${correct}/${total})**
[Avaliação honesta e encorajadora em 1-2 frases.]

✨ **Ponto forte desta sessão:**
[O que o aluno demonstrou dominar. Específico, não genérico.]

🎯 **Foco para próxima sessão:**
[1-2 tópicos específicos baseados nos erros. Seja cirúrgico.]

⚡ **Próximo passo agora:**
[Uma ação concreta. Ex: "Revise as 3 questões de [tópico] que errou antes de fechar."]

${currentStreak > 0 ? `🔥 **Streak: ${currentStreak} dia(s) consecutivos!**` : ''}
${xpEarned > 0 ? `✨ **+${xpEarned} XP ganhos nesta sessão**` : ''}

Máx: 120 palavras. Tom: coach esportivo, não professor avaliando prova.`;

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.45, max_tokens: 400 },
            models: {
                gemini: settings.geminiModel || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            label: 'generateSessionSummary',
            fallbackValue: `**Sessão concluída!** Você respondeu ${total} questão(ões) com ${pct}% de acerto.\n\n Continue assim! Cada sessão é um passo em direção ao seu objetivo.`,
        });
        return result;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 6. CALIBRATION FEEDBACK — JOL (Judgment of Learning) Metacognição
    //    Processa confiança declarada vs resultado para feedback metacognitivo.
    //    Baseado em: Dunlosky & Metcalfe (2009) — JOL aumenta retenção 30–45%
    //    NOTA: função SÍNCRONA — não requer chamada de IA, resposta instantânea
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Retorna feedback de calibração metacognitiva (SÍNCRONO — sem IA).
     * Deve ser chamado APÓS revelar a resposta para fechar o loop JOL.
     *
     * @param {'unsure'|'think_so'|'certain'} confidence - Confiança declarada antes de revelar
     * @param {boolean} wasCorrect - Se o aluno acertou a questão
     * @param {string} [subject] - Disciplina (para personalização futura)
     * @returns {Object} { badge, message, color, sm2Action, insight, calibrationKey }
     *
     * @example
     * // Antes de revelar: aluno clica 'Tenho certeza'
     * // Após revelar: chamamos getCalibrationFeedback('certain', false)
     * const fb = PedagogicalPromptsService.getCalibrationFeedback('certain', false);
     * // => { badge: 'Atenção: Overconfidence!', sm2Action: 'again', ... }
     */
    getCalibrationFeedback(confidence, wasCorrect, subject = '') {
        // JOL Pattern Matrix (confidence × resultado)
        const patterns = {
            // Acertou COM certeza → calibração perfeita
            certain_correct: {
                badge: 'Calibrado!',
                message: 'Você sabia e estava certo. Excelente domínio deste conteúdo!',
                color: '#16a34a',
                sm2Action: 'easy',
                insight: null
            },
            // Acertou mas estava inseguro → underconfidence
            unsure_correct: {
                badge: 'Você sabe mais do que pensa!',
                message: 'Você acertou mesmo sem certeza. Confie mais em si mesmo neste tópico.',
                color: '#0891b2',
                sm2Action: 'good',
                insight: 'Underconfidence detectado: você tem o conhecimento, só precisa de mais prática para consolidar a confiança.'
            },
            // Acertou achando que sabia → bom instinto
            think_so_correct: {
                badge: 'Bom instinto!',
                message: 'Sua intuição estava certa. Continue praticando para ter certeza plena!',
                color: '#16a34a',
                sm2Action: 'good',
                insight: null
            },
            // Errou COM certeza → overconfidence (mais perigoso!)
            certain_wrong: {
                badge: 'Overconfidence detectado!',
                message: 'Você tinha certeza, mas errou. Este é o ponto que mais precisa de revisão prioritária.',
                color: '#d97706',
                sm2Action: 'again',
                insight: 'Overconfidence é o erro mais traiçoeiro: você não sabia que não sabia. Marque este conceito para revisão intensiva.'
            },
            // Errou achando que sabia → instinto errado
            think_so_wrong: {
                badge: 'Quase! Para revisar.',
                message: 'Sua intuição te traiu desta vez. Que tal entender exatamente o porquê?',
                color: '#d97706',
                sm2Action: 'hard',
                insight: null
            },
            // Errou e SABIA que não sabia → autoconsciência + aprendizado
            unsure_wrong: {
                badge: 'Autoconsciência em dia!',
                message: 'Você sabia que não sabia — isso é metacognição real! Agora é hora de aprender.',
                color: '#7c3aed',
                sm2Action: 'again',
                insight: 'Saber o que não sabe é o primeiro passo para aprender. Você está no caminho certo — agora foque em entender este conceito.'
            },
        };

        const key = `${confidence}_${wasCorrect ? 'correct' : 'wrong'}`;
        const feedback = patterns[key] || patterns.unsure_wrong;

        return {
            ...feedback,
            subject: subject || null,
            timestamp: Date.now(),
            calibrationKey: key
        };
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 7. GENERATE CONCEPT EXPLANATION — Explicação Aprofundada de Conceito
    //    Para quando o aluno quer entender um conceito além da questão.
    //    Baseado em: Elaborative Interrogation, Dual Coding, Concrete Examples
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera explicação aprofundada de um conceito específico.
     * @param {string} concept - Conceito a explicar
     * @param {string} [questionContext] - Questão onde apareceu (opcional)
     * @param {string} [subject] - Disciplina
     * @returns {Promise<string>} Explicação formatada em Markdown
     */
    async generateConceptExplanation(concept, questionContext = '', subject = '') {
        const settings = await ApiService._getSettings();

        const systemMsg = `Você é um professor que transforma conceitos complexos em entendimento real.

Método de explicação obrigatório (SEMPRE nesta ordem):
1. DEFINIÇÃO SIMPLES: o que é, em 1 frase sem jargão
2. ANALOGIA: compare com algo do cotidiano brasileiro
3. COMO FUNCIONA: mecanismo em 2-3 passos numerados
4. EXEMPLO CONCRETO: caso real ou aplicação prática
5. CONEXÕES: 2-3 conceitos relacionados para revisar junto

Formato: Markdown com emojis. ADHD-friendly: parágrafos curtos, bullets quando possível.`;

        const prompt = `Explique o conceito: **${concept.slice(0, 200)}**

${questionContext ? `Apareceu neste contexto:\n${questionContext.slice(0, 500)}` : ''}
${subject ? `Disciplina: ${subject}` : ''}

Siga o método de 5 etapas. Máximo 300 palavras. Linguagem acessível mas rigorosa.`;

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.3, max_tokens: 600 },
            models: {
                gemini: settings.geminiModelSmart || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            label: 'generateConceptExplanation',
            fallbackValue: `Não foi possível gerar a explicação de "${concept}". Tente pesquisar o conceito diretamente.`,
        });
        return result;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 8. GENERATE WORD DEFINITION — Definição rápida de palavra/termo
    //    Para o recurso "selecionar palavra → tooltip com explicação"
    //    Rápido, conciso, contextual — pensado para não interromper o fluxo
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera definição rápida de uma palavra/termo selecionado pelo aluno.
     * @param {string} word - Palavra ou termo selecionado
     * @param {string} [questionContext] - Trecho da questão onde aparece
     * @param {string} [subject] - Disciplina
     * @returns {Promise<string>} Definição curta em texto simples
     */
    async generateWordDefinition(word, questionContext = '', subject = '') {
        const settings = await ApiService._getSettings();

        const systemMsg = `Você é um dicionário acadêmico inteligente. Explique termos de forma ULTRA-CONCISA, contextual e didática.

FORMATO OBRIGATÓRIO:
📖 **[termo]**: definição em 1-2 frases simples, sem jargão desnecessário.
${questionContext ? '🔗 **No contexto**: como esse termo se aplica especificamente nesta questão (1 frase).' : ''}
💡 **Macete**: dica curta para lembrar (analogia, etimologia ou associação).

REGRAS:
- Máximo 80 palavras
- Se for sigla, expanda e explique
- Se for termo técnico, use analogia do cotidiano
- Linguagem acessível para estudante brasileiro
- NÃO repita a pergunta, NÃO diga "claro" ou "com certeza"`;

        const prompt = `Defina: "${word.slice(0, 80)}"${subject ? `\nDisciplina: ${subject}` : ''}${questionContext ? `\nContexto da questão: "${questionContext.slice(0, 300)}"` : ''}`;

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.2, max_tokens: 200 },
            models: {
                gemini: settings.geminiModel || 'gemini-2.5-flash',
                groq: settings.groqModelFast || 'llama-3.1-8b-instant',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            label: 'generateWordDefinition',
            fallbackValue: `Não foi possível definir "${word}".`,
        });
        return result;
    },
    //          Útil para alimentar generateMnemonic e generateSimilarQuestionV2
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // BATCH QUESTION GENERATION — Simulado IA
    //    Gera múltiplas questões originais por IA em uma única chamada.
    //    Usa questões salvas pelo aluno como referência temática, gerando
    //    questões NOVAS e INÉDITAS sobre os mesmos conceitos.
    //    Baseado em: Interleaving (Kornell & Bjork 2008), Retrieval Practice
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera um lote de questões inéditas baseadas em questões-semente do aluno.
     * Cada chamada produz até `count` questões em um único request à IA.
     * @param {Array<{question: string, answer?: string, _disc?: string, _topic?: string}>} seedCards
     *   Questões salvas usadas como referência temática (4-8 seeds são suficientes)
     * @param {number} count - Quantas questões gerar nesta chamada (max 8 por batch)
     * @param {number} difficulty - 1 (fácil), 2 (médio), 3 (difícil)
     * @param {string} subject - Disciplina ou tema geral
     * @returns {Promise<Array<{questionText: string, optionsMap: Object, answerLetter: string, explanation: string, conceptTag: string, difficulty: number}>>}
     */
    async generateBatchQuestions(seedCards, count = 5, difficulty = 2, subject = '') {
        const settings = await ApiService._getSettings();

        const difficultyGuide = {
            1: 'FÁCIL: Cenários diretos, termos familiares, distradores com erros mais óbvios. Ideal para quem está começando.',
            2: 'MÉDIO: Nível de provas regulares. Distradores plausíveis, raciocínio necessário.',
            3: 'DIFÍCIL: Nível concurso/vestibular difícil. Negações, exceções, situações-limite. Exige análise profunda.'
        };

        // Build seed questions summary (limit each to ~300 chars to fit context)
        const seedsSummary = seedCards
            .slice(0, 8)
            .map((c, i) => {
                const q = (c.question || c.pergunta || '').slice(0, 300);
                return `[Questão ${i + 1}]: ${q}`;
            })
            .join('\n\n');

        const systemMsg = `Você é especialista em design de questões para provas brasileiras (ENEM, vestibulares, concursos, provas universitárias).

MISSÃO: criar ${count} questões COMPLETAMENTE ORIGINAIS e INÉDITAS, sobre os MESMOS temas/conceitos das questões de referência fornecidas.

Regras invioláveis:
- NUNCA copie ou parafraseie as questões originais — crie cenários 100% novos
- Cada questão deve testar um conceito presente nas referências, mas com contexto diferente
- USE interleaving: varie os conceitos entre as questões (não repita o mesmo tema seguido)
- Distradores devem refletir erros REAIS de estudantes (equívocos conceituais comuns)
- 4 ou 5 alternativas por questão (A, B, C, D[, E])
- Enunciados com contexto realista (casos, situações, dados)
- EVITE: duplicação de conceitos, "nenhuma das alternativas", dupla negação, "sempre/nunca" absolutos

Responda APENAS com um JSON array válido. Sem markdown, sem texto extra.`;

        const prompt = `QUESTÕES DE REFERÊNCIA (base temática — NÃO copie, apenas use como inspiração de conceitos):
${seedsSummary}

${subject ? `DISCIPLINA: ${subject}` : ''}
QUANTIDADE: ${count} questões
DIFICULDADE: ${difficulty}/3 — ${difficultyGuide[difficulty] || difficultyGuide[2]}

Gere EXATAMENTE ${count} questões no formato JSON array:
[
  {
    "questionText": "enunciado completo e contextualizado",
    "optionsMap": { "A": "...", "B": "...", "C": "...", "D": "..." },
    "answerLetter": "B",
    "explanation": "Explicação clara em 1-2 frases",
    "conceptTag": "nome do conceito central (2-5 palavras)",
    "difficulty": ${difficulty}
  }
]

IMPORTANTE: retorne APENAS o JSON array, sem nenhum texto antes ou depois.`;

        const parseResponse = (content) => {
            if (!content) return null;
            try {
                const cleaned = content
                    .replace(/^```(?:json)?\s*/i, '')
                    .replace(/\s*```$/, '')
                    .trim();
                const parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed)) {
                    const valid = parsed.filter(q =>
                        q && typeof q.questionText === 'string' && q.questionText.length > 10 &&
                        q.optionsMap && Object.keys(q.optionsMap).length >= 3 &&
                        q.answerLetter
                    );
                    return valid.length > 0 ? valid : null;
                }
                // Single object wrapped response
                if (parsed && parsed.questionText) return [parsed];
                return null;
            } catch (_) {
                // Try to extract JSON array from response
                const match = content.match(/\[[\s\S]*\]/);
                if (match) {
                    try {
                        const arr = JSON.parse(match[0]);
                        const valid = arr.filter(q =>
                            q && typeof q.questionText === 'string' && q.questionText.length > 10 &&
                            q.optionsMap && q.answerLetter
                        );
                        return valid.length > 0 ? valid : null;
                    } catch (_2) { return null; }
                }
                return null;
            }
        };

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.6, max_tokens: count * 350 + 200 },
            models: {
                gemini: settings.geminiModelSmart || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            postProcess: parseResponse,
            isValid: (v) => Array.isArray(v) && v.length > 0,
            label: `generateBatchQuestions_${count}x_D${difficulty}`,
        });

        if (!result || result.length === 0) {
            throw new Error('Não foi possível gerar questões. Verifique sua conexão ou chaves de API.');
        }
        return result;
    },

    /**
     * Extrai o conceito central de uma questão (retorna string curta de 2–5 palavras).
     * @param {string} questionText
     * @returns {Promise<string>} Nome do conceito (ex: "Mitose vs Meiose")
     */
    async extractConceptTag(questionText) {
        const settings = await ApiService._getSettings();

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                {
                    role: 'system',
                    content: 'Você identifica o conceito acadêmico central de questões de prova. Responda APENAS com o nome do conceito em 2-5 palavras. Sem explicações, sem pontuação extra.'
                },
                {
                    role: 'user',
                    content: `Qual o conceito central testado nesta questão?\n\n${questionText.slice(0, 600)}`
                }
            ],
            opts: { temperature: 0.2, max_tokens: 30 },
            models: {
                gemini: settings.geminiModel || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.1-8b-instant',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
            },
            label: 'extractConceptTag',
            fallbackValue: 'Conceito não identificado',
        });
        return (result || '').trim().slice(0, 50);
    },

};
