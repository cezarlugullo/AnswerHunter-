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
import {
    normalizePromptText,
    extractQuestionStructure,
    optionsMapFromQuestion,
    inferLearningScenario,
    buildPedagogicalRoleBlock,
    buildPromptBestPracticesBlock,
} from './pedagogy/core/PedagogicalPromptKernel.js';
import {
    inferPedagogicalDomain,
    extractExactSciencesSignals,
    buildExactSciencesFewShot,
    buildExactSciencesMnemonicElements,
} from './pedagogy/domains/ExactSciencesPedagogy.js';
import {
    normalizeMnemonicText,
    extractAlternatives,
    extractTopKeywords,
    inferMnemonicScenario,
    inferMnemonicType,
    buildMnemonicKeyElements,
    buildMnemonicSignature,
    trimMnemonicText,
    scoreMnemonicPayload,
    finalizeMnemonicPayload,
} from './pedagogy/mnemonics/MnemonicPromptSupport.js';
import { buildWhyWrongRequest } from './pedagogy/actions/WhyWrongPromptBuilder.js';
import { buildSocraticHintRequest } from './pedagogy/actions/SocraticHintPromptBuilder.js';
import {
    buildMnemonicRequest,
    createMnemonicResponseParser,
    isValidMnemonicPayload,
} from './pedagogy/actions/MnemonicPromptBuilder.js';
import { buildConceptExplanationRequest } from './pedagogy/actions/ConceptExplanationPromptBuilder.js';

export const PedagogicalPromptsService = {

    _normalizePromptText(text = '') {
        return normalizePromptText(text);
    },

    _extractQuestionStructure(questionText = '') {
        return extractQuestionStructure(questionText);
    },

    _optionsMapFromQuestion(questionText = '') {
        return optionsMapFromQuestion(questionText);
    },

    _inferLearningScenario(questionText = '') {
        return inferLearningScenario(questionText);
    },

    _inferPedagogicalDomain(text = '', extra = '') {
        return inferPedagogicalDomain(text, extra);
    },

    _extractMathSignals(text = '') {
        return extractExactSciencesSignals(text);
    },

    _buildMathMnemonicElements(questionText = '', answerText = '', concept = '') {
        return buildExactSciencesMnemonicElements(questionText, answerText, concept);
    },

    _buildPedagogicalRoleBlock(domain = 'general', purpose = '') {
        return buildPedagogicalRoleBlock(domain, purpose);
    },

    _buildPromptBestPracticesBlock() {
        return buildPromptBestPracticesBlock();
    },

    _buildExactSciencesFewShot(taskType = 'hint') {
        return buildExactSciencesFewShot(taskType);
    },

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
        const combinedAlternatives = allAlternatives.map((a) => `${a.letter}) ${a.text}`).join('\n');
        const domain = this._inferPedagogicalDomain(
            `${questionText}\n${wrongText}\n${correctText}`,
            `${subject}\n${combinedAlternatives}`,
        );
        const mathSignals = domain === 'exact_sciences'
            ? this._extractMathSignals(`${questionText}\n${combinedAlternatives}\n${correctText}`)
            : null;
        const { systemMsg, prompt, fallbackValue } = buildWhyWrongRequest({
            questionText,
            wrongLetter,
            wrongText,
            correctLetter,
            correctText,
            subject,
            allAlternatives,
            domain,
            mathSignals,
            roleBlock: this._buildPedagogicalRoleBlock(domain, 'diagnostic_feedback'),
            bestPracticesBlock: this._buildPromptBestPracticesBlock(),
        });

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.35, max_tokens: 800 },
            models: {
                gemini: settings.geminiModelSmart || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-chat-v3-0324:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            label: 'generateWhyWrong',
            fallbackValue,
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
        const parsedOptionsMap = (optionsMap && Object.keys(optionsMap).length > 0)
            ? optionsMap
            : this._optionsMapFromQuestion(questionText);
        const parsedQuestion = this._extractQuestionStructure(questionText);
        const conceptProfile = await this.extractConceptProfile(questionText);
        const hasStructuredOptions = Object.keys(parsedOptionsMap).length >= 2;
        const conceptName = conceptProfile?.concept || 'conceito central';
        const scenarioName = conceptProfile?.scenario || this._inferLearningScenario(questionText);
        const keywords = Array.isArray(conceptProfile?.keywords) ? conceptProfile.keywords.join(', ') : '';
        const domain = this._inferPedagogicalDomain(questionText, `${conceptName} ${keywords}`);
        const mathSignals = domain === 'exact_sciences' ? this._extractMathSignals(questionText) : null;
        const { systemMsg, prompt, fallbackValue } = buildSocraticHintRequest({
            questionText,
            parsedQuestion,
            parsedOptionsMap,
            hasStructuredOptions,
            conceptName,
            scenarioName,
            keywords,
            domain,
            mathSignals,
            hintLevel,
            previousHint,
            roleBlock: this._buildPedagogicalRoleBlock(domain === 'exact_sciences' ? 'exact_sciences' : 'general', domain === 'exact_sciences' ? 'guiar o aluno por um próximo passo correto, sem entregar a resposta' : 'guiar o aluno a descobrir o raciocínio correto sem entregar a resposta'),
            bestPracticesBlock: this._buildPromptBestPracticesBlock(),
            exactSciencesFewShot: domain === 'exact_sciences' ? this._buildExactSciencesFewShot('hint') : '',
        });

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.35, max_tokens: 240 },
            models: {
                gemini: settings.geminiModel || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-chat-v3-0324:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            label: `generateSocraticHint_L${hintLevel}`,
            fallbackValue,
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
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-chat-v3-0324:free',
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
    _normalizeMnemonicText(text = '') {
        return normalizeMnemonicText(text);
    },

    _extractAlternatives(questionText = '') {
        return extractAlternatives(questionText);
    },

    _extractTopKeywords(text = '', limit = 4) {
        return extractTopKeywords(text, limit);
    },

    _inferMnemonicScenario(questionText = '', answerText = '') {
        return inferMnemonicScenario(questionText, answerText);
    },

    _inferMnemonicType(questionText = '', answerText = '', preferredType = 'any') {
        return inferMnemonicType(questionText, answerText, preferredType);
    },

    _buildMnemonicKeyElements(questionText = '', answerText = '', concept = '') {
        return buildMnemonicKeyElements(questionText, answerText, concept);
    },

    _buildMnemonicSignature(prepared) {
        return buildMnemonicSignature(prepared);
    },

    _getMnemonicPromptSections() {
        return {
            preamble: `Você é um MESTRE em técnicas de memorização baseadas em neurociência cognitiva. Você aplica mecanismos científicos comprovados para criar mnemônicos que fazem o aluno ENTENDER E DECORAR DE PRIMEIRA.

━━━ ARSENAL CIENTÍFICO ━━━
1. CHUNKING: quebre em 2-4 elementos gerenciáveis.
2. DUAL CODING: una frase verbal + cena mental vívida.
3. VON RESTORFF: a cena precisa ser absurda, exagerada ou impossível.
4. HUMOR + EMOÇÃO: faça o aluno sorrir ou estranhar.
5. TESTING EFFECT: o auto-teste deve exigir reconstrução, nunca reconhecimento passivo.`,

            brevity: `━━━ LEI DE OURO DA CONCISÃO ━━━
O resultado precisa funcionar mesmo para um aluno cansado, vendo tudo em poucos segundos.
- "mnemonic": 4-10 palavras, natural em português, ritmo claro
- "keyElements": 2-3 itens curtos e limpos
- "visualization": no máximo 75 palavras
- "connection": no máximo 55 palavras
- "selfTest": uma pergunta curta, direta e reconstruível`,

            visualization: `━━━ LEI DE OURO DA VISUALIZAÇÃO ━━━
CADA ELEMENTO DA CENA MENTAL DEVE SER CONCRETO E VISUALIZÁVEL.
PROIBIDO: personificar siglas abstratas sem som/imagem concreta, usar cenas genéricas, ou criar elementos que só fazem sentido se o aluno já souber a resposta.
PERMITIDO: objetos do cotidiano, personagens reconhecíveis, ações exageradas, locais familiares e humor físico.`,

            naturalness: `━━━ REGRAS DE NATURALIDADE ━━━
PROIBIDO criar trocadilhos artificiais com pedaços do termo técnico, como "FRAcote", "pizza FRAção", "robô LIMITE".
PROIBIDO usar MAIÚSCULAS no meio da palavra para "explicar" o mnemônico.
Se a palavra-âncora soar forçada ou infantil demais, abandone a técnica e use uma cena visual ou micro-história mais natural.
Prefira imagens concretas e familiares a "piadas linguísticas" ruins.`,

            technical: `━━━ REGRAS PARA TERMOS TÉCNICOS E SIGLAS ━━━
Use Keyword Method quando houver siglas, APIs, padrões, protocolos, sintaxe ou termos técnicos.
Se houver sequência, prefira frase-acróstico. Se houver sigla isolada, use palavra-âncora sonora em português + imagem concreta.
Nunca diga algo como "robô ANSI" ou "relógio C99" se isso não for visualmente concreto.
Se não houver âncora sonora boa, use visualização funcional do conceito em vez de forçar keyword method.`,

            affirmatives: `━━━ REGRAS PARA QUESTÕES ESTRUTURAIS ━━━
PROIBIDO ABSOLUTO: memorizar o FORMATO da questão.
NUNCA use "Asserção", "Razão", "V ou F", letras de alternativas, ou numerais romanos (I, II, III) como âncoras.
Não crie cenas tipo "A Asserção faz isso e a Razão faz aquilo".
Você deve extrair o CONTEÚDO TÉCNICO das afirmativas corretas e criar o mnemônico EXCLUSIVAMENTE para a teoria subjacente.
Tudo que é falso deve ser ignorado ou usado apenas como contraste conceitual, não como parte do mecanismo.`,

            output: `━━━ FORMATO JSON OBRIGATÓRIO ━━━
- "emoji" = emoji do tema
- "mnemonic" = frase-âncora curta, rítmica, memorável
- "keyElements" = array de 2-4 strings "elemento → significado"
- "visualization" = cena mental cinematográfica, absurda e concreta
- "connection" = explique como a cena reconstrói o conceito
- "selfTest" = pergunta que obriga o aluno a reconstruir a lógica
- "type" = "acronym"|"story"|"rhyme"|"visual"|"keyword"
Responda APENAS em JSON válido.`,

            examples: `EXEMPLOS BONS:
- Planetas em ordem → frase-acróstico.
- SQL ALTER TABLE ADD COLUMN → visualização de reforma em uma mesa.
- Questão com callback/thread/GLUT/assíncrono → história concreta com fone, fio, joystick e quatro mãos.

EXEMPLO RUIM:
- "ANSI fantasiado", "robô ISO", "relógio C99".
Motivo: não são imagens concretas o bastante.`
        };
    },

    _scoreMnemonicPayload(payload, prepared) {
        return scoreMnemonicPayload(payload, prepared);
    },

    _trimMnemonicText(text = '', maxChars = 220, maxWords = 40) {
        return trimMnemonicText(text, maxChars, maxWords);
    },

    _finalizeMnemonicPayload(payload, prepared) {
        return finalizeMnemonicPayload(payload, prepared);
    },

    async prepareMnemonicInput(conceptOrQuestion, questionContext = '', preferredType = 'auto') {
        const rawQuestion = this._normalizeMnemonicText(conceptOrQuestion);
        const answerText = this._normalizeMnemonicText(questionContext);
        const looksLikeQuestion = /\?|\b[A-E]\s*[\)\.\-:]\s|\bassinale\b|\bquest[aã]o\b/i.test(rawQuestion) || rawQuestion.length > 120;
        const profile = looksLikeQuestion ? await this.extractConceptProfile(rawQuestion) : null;

        let concept = rawQuestion.slice(0, 80);
        if (looksLikeQuestion) {
            const extracted = profile?.concept || await this.extractConceptTag(rawQuestion);
            if (extracted && !/conceito n[aã]o identificado/i.test(extracted)) {
                concept = extracted;
            }
        }
        if (!concept || /conceito n[aã]o identificado/i.test(concept)) {
            concept = answerText ? answerText.slice(0, 80) : rawQuestion.slice(0, 80);
        }

        const scenario = profile?.scenario || this._inferMnemonicScenario(rawQuestion, answerText);
        const resolvedType = this._inferMnemonicType(rawQuestion, answerText, preferredType);
        const keyElements = this._buildMnemonicKeyElements(rawQuestion, answerText, concept);

        const prepared = {
            concept,
            rawQuestion,
            answerText,
            scenario,
            resolvedType,
            requestedType: preferredType,
            keyElements,
            conceptProfile: profile,
        };
        prepared.signature = this._buildMnemonicSignature(prepared);
        return prepared;
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
    async generateMnemonic(concept, questionContext = '', preferredType = 'any', extra = {}) {
        const settings = await ApiService._getSettings();
        const prepared = extra?.preparedInput || await this.prepareMnemonicInput(concept, questionContext, preferredType);
        const promptSections = this._getMnemonicPromptSections();
        const domain = this._inferPedagogicalDomain(prepared.rawQuestion, `${prepared.concept}\n${prepared.answerText}`);
        const mathSignals = domain === 'exact_sciences' ? this._extractMathSignals(`${prepared.rawQuestion}\n${prepared.answerText}\n${prepared.concept}`) : null;
        const { systemMsg, prompt, fallbackValue } = buildMnemonicRequest({
            prepared,
            promptSections,
            domain,
            mathSignals,
            roleBlock: this._buildPedagogicalRoleBlock(domain === 'exact_sciences' ? 'exact_sciences' : 'general', 'criar um mnemônico realmente útil para recuperar o procedimento ou conceito certo'),
            bestPracticesBlock: this._buildPromptBestPracticesBlock(),
            exactSciencesFewShot: domain === 'exact_sciences' ? this._buildExactSciencesFewShot('mnemonic') : '',
        });
        const parseResponse = createMnemonicResponseParser(prepared);

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.45, max_tokens: 650 },
            models: {
                gemini: settings.geminiModel || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-chat-v3-0324:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            postProcess: parseResponse,
            isValid: (v) => isValidMnemonicPayload(v, prepared),
            label: 'generateMnemonic',
            fallbackValue,
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
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-chat-v3-0324:free',
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
        const rawConcept = this._normalizePromptText(concept);
        const looksLikeQuestion = /\?|\b[A-E]\s*[\)\.\-:]\s|\bassinale\b|\bquest[aã]o\b/i.test(rawConcept) || rawConcept.length > 120;
        const conceptProfile = looksLikeQuestion ? await this.extractConceptProfile(rawConcept) : null;
        const domain = this._inferPedagogicalDomain(rawConcept, `${questionContext}\n${subject}\n${conceptProfile?.concept || ''}`);
        const mathSignals = domain === 'exact_sciences' ? this._extractMathSignals(`${rawConcept}\n${questionContext}\n${conceptProfile?.concept || ''}`) : null;
        const resolvedConcept = conceptProfile?.concept && !/conceito n[aã]o identificado/i.test(conceptProfile.concept)
            ? conceptProfile.concept
            : rawConcept;
        const resolvedContext = looksLikeQuestion
            ? `${rawConcept.slice(0, 500)}${questionContext ? `\n\nResposta/contexto: ${questionContext.slice(0, 240)}` : ''}`
            : questionContext;

        const { systemMsg, prompt, maxTokens, fallbackValue } = buildConceptExplanationRequest({
            resolvedConcept,
            resolvedContext,
            subject,
            conceptProfile,
            domain,
            mathSignals,
            roleBlock: this._buildPedagogicalRoleBlock(domain === 'exact_sciences' ? 'exact_sciences' : 'general', domain === 'exact_sciences' ? 'explicar com didática universitária, em passos verificáveis, sem infantilizar o conteúdo' : 'explicar com clareza, rigor e boa didática universitária'),
            bestPracticesBlock: this._buildPromptBestPracticesBlock(),
            exactSciencesFewShot: domain === 'exact_sciences' ? this._buildExactSciencesFewShot('explain') : '',
        });

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: prompt }
            ],
            opts: { temperature: 0.25, max_tokens: maxTokens },
            models: {
                gemini: settings.geminiModelSmart || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.3-70b-versatile',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-chat-v3-0324:free',
                chatgpt: settings.chatgptModel || 'gpt-4o',
                copilot: settings.copilotModel || 'gpt-4o',
            },
            label: 'generateConceptExplanation',
            fallbackValue,
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
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-chat-v3-0324:free',
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
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-chat-v3-0324:free',
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
    async extractConceptProfile(questionText) {
        const settings = await ApiService._getSettings();
        const normalizedQuestion = this._normalizePromptText(questionText);
        const fallbackKeywords = this._extractTopKeywords(normalizedQuestion, 4);
        const fallback = {
            concept: 'Conceito não identificado',
            subconcept: fallbackKeywords[0] || '',
            scenario: this._inferLearningScenario(normalizedQuestion),
            keywords: fallbackKeywords,
        };

        const parseResponse = (content) => {
            if (!content) return null;
            try {
                let cleaned = String(content || '')
                    .replace(/^```(?:json)?\s*/i, '')
                    .replace(/\s*```$/, '')
                    .trim();
                const match = cleaned.match(/\{[\s\S]*\}/);
                if (match) cleaned = match[0];
                const parsed = JSON.parse(cleaned);
                const concept = String(parsed?.concept || parsed?.topic || '').trim();
                if (!concept) return null;
                return {
                    concept: concept.slice(0, 80),
                    subconcept: String(parsed?.subconcept || parsed?.focus || '').trim().slice(0, 80),
                    scenario: String(parsed?.scenario || '').trim().slice(0, 40) || fallback.scenario,
                    keywords: Array.isArray(parsed?.keywords)
                        ? parsed.keywords.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 4)
                        : fallback.keywords,
                };
            } catch {
                const line = String(content || '').split(/\n+/).map((part) => part.trim()).find(Boolean);
                if (!line) return null;
                return { ...fallback, concept: line.slice(0, 80) };
            }
        };

        const { result } = await ApiService._callWithProviderChain({
            messages: [
                {
                    role: 'system',
                    content: `Você identifica o conceito acadêmico central de questões de prova brasileiras.

Responda APENAS em JSON válido neste formato:
{
  "concept": "conceito central em 2-6 palavras, específico e útil para estudo",
  "subconcept": "recorte mais fino ou contraste principal",
  "scenario": "afirmativas|sequência|comparação|fórmula|termo técnico|conceito central",
  "keywords": ["palavra1", "palavra2", "palavra3"]
}

REGRAS:
- Evite rótulos genéricos como "interpretação de texto" ou "conhecimentos gerais"
- NUNCA retorne o formato da questão como conceito (ex: "Asserção e Razão", "Verdadeiro ou Falso", "Soma de alternativas", "Análise de afirmativas")
- Priorize o conteúdo realmente testado, não o tema superficial ou a estrutura
- Se a questão tiver alternativas, use o enunciado para decidir o conceito central`
                },
                {
                    role: 'user',
                    content: `Qual o conceito central testado nesta questão?\n\n${normalizedQuestion.slice(0, 900)}`
                }
            ],
            opts: { temperature: 0.15, max_tokens: 140 },
            models: {
                gemini: settings.geminiModel || 'gemini-2.5-flash',
                groq: settings.groqModelSmart || 'llama-3.1-8b-instant',
                openrouter: settings.openrouterModelSmart || 'deepseek/deepseek-chat-v3-0324:free',
            },
            postProcess: parseResponse,
            isValid: (v) => !!v && typeof v.concept === 'string' && v.concept.length >= 4,
            label: 'extractConceptTag',
            fallbackValue: fallback,
        });
        return result || fallback;
    },

    async extractConceptTag(questionText) {
        const profile = await this.extractConceptProfile(questionText);
        return String(profile?.concept || 'Conceito não identificado').trim().slice(0, 80);
    },

};
