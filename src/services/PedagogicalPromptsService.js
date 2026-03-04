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
            fallbackValue: `🎯 Você escolheu ${wrongLetter}, mas a resposta correta é ${correctLetter}. Revise o conceito relacionado e tente novamente!`,
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
    // 4. GENERATE MNEMONIC — Gerador de Mnemônicos Criativos
    //    Cria mnemônicos personalizados para conceitos difíceis.
    //    Baseado em: Dual Coding (Paivio), Von Restorff Effect, Elaborative Encoding
    //    Impacto: mnemônicos criativos aumentam retenção em 40–60%
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gera mnemônico criativo para um conceito de questão.
     * @param {string} concept - Conceito ou fato a memorizar
     * @param {string} [questionContext] - Contexto da questão
     * @param {'acronym'|'story'|'rhyme'|'visual'|'any'} preferredType - Tipo preferido
     * @returns {Promise<Object>} { mnemonic, type, howToUse, emoji }
     */
    async generateMnemonic(concept, questionContext = '', preferredType = 'any') {
        const settings = await ApiService._getSettings();

        const typeGuides = {
            acronym: 'Use acrônimo ou acróstico: primeira letra de cada elemento-chave forma uma palavra ou frase fácil.',
            story: 'Crie uma frase curta (máx 2 linhas) ligando os elementos-chave em sequência lógica.',
            rhyme: 'Crie uma rima curta de 2-4 versos que encode os elementos-chave.',
            visual: 'Descreva UMA imagem mental simples e marcante que represente o conceito.',
            any: 'Escolha entre acrônimo, frase-chave, rima curta ou imagem mental — o que funcionar melhor.'
        };

        const systemMsg = `Você cria mnemônicos ÚTEIS e SIMPLES para estudantes brasileiros.

REGRAS OBRIGATÓRIAS:
- O mnemônico deve codificar os ELEMENTOS-CHAVE do conceito (nomes, termos, ordem, relações)
- Máximo 2-3 frases. Quanto mais curto, melhor.
- NÃO invente histórias longas, personagens fictícios ou narrativas complexas
- NÃO use referências a celebridades, memes ou cultura pop
- PRIORIZE: acrônimos, frases-chave, rimas curtas, associações diretas
- O aluno deve conseguir RECONSTRUIR a resposta a partir do mnemônico

EXEMPLOS de bons mnemônicos:
- "MaRiA VaI CoM aS OuTrAs" → ordem dos planetas (Mercúrio, Vênus, Terra...)
- "SeCaPiCoFiReGe" → camadas OSI (Sessão, Apresentação, Aplicação...)
- "Lei, Medida Provisória, Decreto" → hierarquia: "LeMeDe" 
- Para SQL ALTER TABLE: "ALTER = ALTERAR estrutura, ADD = adicionar coluna, DROP = remover"

Responda APENAS em JSON válido, sem texto extra.`;

        const prompt = `CONCEITO:
${concept.slice(0, 400)}

${questionContext ? `CONTEXTO:\n${questionContext.slice(0, 300)}\n` : ''}
TIPO: ${typeGuides[preferredType] || typeGuides.any}

Identifique os 2-4 elementos-chave do conceito e crie UM mnemônico curto e prático.

JSON:
{"mnemonic": "texto curto do mnemônico", "type": "acronym|phrase|rhyme|visual", "howToUse": "como usar na prova (1 frase)", "emoji": "1 emoji"}`;

        const parseResponse = (content) => {
            if (!content) return null;
            try {
                // Extract JSON from possible markdown/text wrapping
                let cleaned = content
                    .replace(/^```(?:json)?\s*/i, '')
                    .replace(/\s*```$/, '')
                    .trim();
                // Try to find JSON object in the response
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) cleaned = jsonMatch[0];
                return JSON.parse(cleaned);
            } catch (_) {
                if (content.trim().length > 5) {
                    return { mnemonic: content.trim(), type: 'text', howToUse: 'Repita 3 vezes em voz alta.', emoji: '🧠' };
                }
                return null;
            }
        };

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.5, max_tokens: 200 },
            models: {
                gemini: settings.geminiModel || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-r1:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            postProcess: parseResponse,
            isValid: (v) => v && typeof v.mnemonic === 'string' && v.mnemonic.length > 3 && v.mnemonic.length < 500,
            label: 'generateMnemonic',
            fallbackValue: {
                mnemonic: `Para lembrar: "${concept.slice(0, 50)}"`,
                type: 'association',
                howToUse: 'Associe visualmente este conceito a algo familiar.',
                emoji: '🧠'
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
- Disciplinas: ${subjects.join(', ') || 'Geral'}
- Tempo de estudo: ${elapsedMinutes} minutos
- XP ganho: ${xpEarned} XP
- Streak atual: ${currentStreak} dia(s)
- Erros em: ${wrongSubjects.join(', ') || 'nenhum'}
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
            fallbackValue: `🎯 **Sessão concluída!** Você respondeu ${total} questão(ões) com ${pct}% de acerto.\n\n💪 Continue assim! Cada sessão é um passo em direção ao seu objetivo.`,
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
     * // => { badge: '⚠️ Atenção: Overconfidence!', sm2Action: 'again', ... }
     */
    getCalibrationFeedback(confidence, wasCorrect, subject = '') {
        // JOL Pattern Matrix (confidence × resultado)
        const patterns = {
            // ✅ Acertou COM certeza → calibração perfeita
            certain_correct: {
                badge: '🎯 Calibrado!',
                message: 'Você sabia e estava certo. Excelente domínio deste conteúdo!',
                color: '#16a34a',
                sm2Action: 'easy',
                insight: null
            },
            // ✅ Acertou mas estava inseguro → underconfidence
            unsure_correct: {
                badge: '😮 Você sabe mais do que pensa!',
                message: 'Você acertou mesmo sem certeza. Confie mais em si mesmo neste tópico.',
                color: '#0891b2',
                sm2Action: 'good',
                insight: 'Underconfidence detectado: você tem o conhecimento, só precisa de mais prática para consolidar a confiança.'
            },
            // ✅ Acertou achando que sabia → bom instinto
            think_so_correct: {
                badge: '✅ Bom instinto!',
                message: 'Sua intuição estava certa. Continue praticando para ter certeza plena!',
                color: '#16a34a',
                sm2Action: 'good',
                insight: null
            },
            // ❌ Errou COM certeza → overconfidence (mais perigoso!)
            certain_wrong: {
                badge: '⚠️ Overconfidence detectado!',
                message: 'Você tinha certeza, mas errou. Este é o ponto que mais precisa de revisão prioritária.',
                color: '#d97706',
                sm2Action: 'again',
                insight: 'Overconfidence é o erro mais traiçoeiro: você não sabia que não sabia. Marque este conceito para revisão intensiva.'
            },
            // ❌ Errou achando que sabia → instinto errado
            think_so_wrong: {
                badge: '📚 Quase! Para revisar.',
                message: 'Sua intuição te traiu desta vez. Que tal entender exatamente o porquê?',
                color: '#d97706',
                sm2Action: 'hard',
                insight: null
            },
            // ❌ Errou e SABIA que não sabia → autoconsciência + aprendizado
            unsure_wrong: {
                badge: '🎯 Autoconsciência em dia!',
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
    // UTILITY: Extrair conceito central de uma questão
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
