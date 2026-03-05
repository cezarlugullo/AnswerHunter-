/**
 * FlashcardGeneratorService.js
 * AI-powered flashcard generation from questions and answers.
 *
 * Uses existing AI service providers to create:
 *  - Cloze deletions (fill-in-the-blank)
 *  - Reverse cards (answer → question)
 *  - Key concept cards
 *  - Summary cards
 */

export const FlashcardGeneratorService = {

  /**
   * Generate flashcards from a question/answer pair using AI.
   * Falls back to algorithmicgeneration if no AI provider is available.
   *
   * @param {Object} card - { question, answer }
   * @param {Object} opts
   * @param {string[]} [opts.types] - 'cloze'|'reverse'|'concept'|'summary'|'application'
   * @param {Function} [opts.aiCall] - async (prompt) => text  (from AI providers)
   * @returns {Promise<Array<{type, front, back}>>}
   */
  async generate(card, opts = {}) {
    const types = opts.types || ['cloze', 'reverse', 'concept'];
    const results = [];

    // Try AI generation first
    if (opts.aiCall) {
      try {
        const aiCards = await this._generateWithAI(card, types, opts.aiCall);
        if (aiCards.length > 0) return aiCards;
      } catch (err) {
        console.warn('[FlashcardGenerator] AI failed, falling back to algorithmic:', err.message);
      }
    }

    // Algorithmic fallback
    for (const type of types) {
      switch (type) {
        case 'cloze':
          results.push(...this._generateCloze(card));
          break;
        case 'reverse':
          results.push(this._generateReverse(card));
          break;
        case 'concept':
          results.push(...this._generateConcept(card));
          break;
        case 'summary':
          results.push(this._generateSummary(card));
          break;
        // v2.0: application type — transfer learning (Mayer 2002)
        case 'application':
          results.push(this._generateApplication(card.answer || card.question || ''));
          break;
      }
    }

    return results.filter(Boolean);
  },

  // ─── AI Generation ───────────────────────────────────────────────────────

  async _generateWithAI(card, types, aiCall) {
    const prompt = `Gere flashcards de estudo a partir desta questão/resposta.

QUESTÃO: ${card.question}
RESPOSTA: ${card.answer}

Tipos solicitados: ${types.join(',')}

Para cada flashcard, retorne em formato JSON:
[
  {"type": "cloze|reverse|concept|summary|application", "front": "texto da frente", "back": "texto do verso"}
]

Regras:
- cloze: texto com lacuna ___ na frente, termo correto no verso
- reverse: resposta como pergunta, questão original como resposta
- concept: conceito chave extraído, definição no verso
- summary: resumo em 1-2 frases na frente, detalhes no verso
- application: cenário NOVO que exige APLICAR o conceito em contexto inédito | verso: resolução
  (ex frente: 'Se X acontecesse em Y, qual seria o efeito em Z?')
- Máximo 5 flashcards
- Responda APENAS o JSON, sem markdown`;

    const response = await aiCall(prompt);
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.filter(c => c.front && c.back);
      }
    } catch {
      console.warn('[FlashcardGenerator] Failed to parse AI response');
    }
    return [];
  },

  // ─── Algorithmic Generation ──────────────────────────────────────────────

  _generateCloze(card) {
    const answer = card.answer || '';
    const results = [];

    // Extract key terms from the answer (words > 4 chars, non-common)
    // Extended stopwords v2.0 (Kilgarriff 1997: function words ≠ cloze targets)
    // PT + EN function words that carry no semantic content for cloze deletion
    const common = new Set([
      // Portuguese
      'de','a','o','que','e','do','da','em','um','para','com','uma','os','no',
      'se','na','por','mais','as','dos','como','mas','ao','ele','das','seu',
      'sua','ou','ser','quando','muito','há','nos','já','está','também','só',
      'após','desde','entre','até','sobre','isso','esse','essa','este','esta',
      'eles','elas','nós','vocês','foi','são','era','eram','seja','sendo','ter',
      'tem','teve','pelo','pela','pelos','pelas','num','numa','disso','desse',
      'desta','nisso','neste','nesta','cuja','cujo','caso','vez','vezes','bem',
      'então','assim','pois','porém','todavia','contudo','logo','portanto','onde',
      'porque','qual','pode','deve','cada','todo','toda','ainda','sendo',
      // English
      'the','of','and','is','in','it','to','that','was','for','on','are','with',
      'as','at','be','by','an','or','not','this','but','from','they','we','you',
      'he','she','its','which','have','had','has','were','been','their','when',
      'can','will','all','would','some','what','there','their','from','that',
      'with','have','this','will','your','they','been','some','which','here'
    ]);

    const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 15);

    for (const sentence of sentences.slice(0, 2)) {
      const words = sentence.trim().split(/\s+/);
      const keyWords = words.filter(w => w.length > 4 && !common.has(w.toLowerCase()));

      if (keyWords.length > 0) {
        const target = keyWords[0];
        const cloze = sentence.replace(new RegExp(this._escapeRegex(target), 'i'), '___');
        results.push({
          type: 'cloze',
          front: cloze.trim(),
          back: target
        });
      }
    }

    return results;
  },

  _generateReverse(card) {
    if (!card.answer || !card.question) return null;

    // Create a reverse card
    const shortAnswer = card.answer.length > 200
      ? card.answer.slice(0, 200) + '…'
      : card.answer;

    return {
      type: 'reverse',
      front: `O que a seguinte afirmação responde?\n\n"${shortAnswer}"`,
      back: card.question
    };
  },

  _generateConcept(card) {
    const results = [];
    const text = (card.answer || '') + ' ' + (card.question || '');

    // Extract capitalized terms (likely key concepts)
    const conceptPattern = /\b([A-ZÀ-Ü][a-zà-ü]+ (?:[A-ZÀ-Ü][a-zà-ü]+\s?){0,3})/g;
    const concepts = new Set();
    let match;
    while ((match = conceptPattern.exec(text)) !== null) {
      const concept = match[1].trim();
      if (concept.length > 3 && concept.split(' ').length <= 4  /* v2.0: split by SPACE (words), not by char */) {
        concepts.add(concept);
      }
    }

    for (const concept of Array.from(concepts).slice(0, 2)) {
      results.push({
        type: 'concept',
        front: `Defina: ${concept}`,
        back: this._extractContext(card.answer, concept)
      });
    }

    return results;
  },

  _generateSummary(card) {
    if (!card.answer) return null;

    const sentences = card.answer.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const summary = sentences.slice(0, 2).join('.').trim() + '.';

    return {
      type: 'summary',
      front: card.question || 'Resuma o conceito:',
      back: summary
    };
  },

  // ─── Batch Operations ────────────────────────────────────────────────────

  /**
   * Generate flashcards for multiple cards.
   * @param {Array} cards
   * @param {Object} opts
   * @returns {Promise<Array>}
   */
  async batchGenerate(cards, opts = {}) {
    const allResults = [];
    for (const card of cards) {
      const generated = await this.generate(card, opts);
      allResults.push(...generated.map(fc => ({
        ...fc,
        sourceCardId: card.id,
        sourceQuestion: card.question
      })));
    }
    return allResults;
  },

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  _extractContext(text, concept) {
    if (!text) return concept;
    const idx = text.toLowerCase().indexOf(concept.toLowerCase());
    if (idx === -1) return text.slice(0, 150);

    const start = Math.max(0, idx - 50);
    const end = Math.min(text.length, idx + concept.length + 100);
    let excerpt = text.slice(start, end).trim();
    if (start > 0) excerpt = '…' + excerpt;
    if (end < text.length) excerpt += '…';
    return excerpt;
  },

    /**
     * Gera flashcard tipo 'application' — aplica conceito em cenário novo.
     * Este tipo exige transferência (Mayer 2002: transfer learning),
     * não apenas recuperação. Força o aluno a usar o conceito em contexto inédito.
     *
     * @param {string} text - Texto fonte com conceito a aplicar
     * @returns {Object} { front, back, type: 'application' }
     */
    _generateApplication(text) {
        // Extract main noun/concept using first significant noun phrase
        const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 20);
        const sourceSentence = sentences[0] || text;

        // Generate contextual application scenario
        const trimmed = sourceSentence.trim();
        const front = `Aplique o conceito: dado o seguinte contexto — "${trimmed.slice(0, 120)}" — `
            + `o que aconteceria se as condições fossem invertidas ou o contexto mudasse?`;

        const back = `Conceito-base:
${text.slice(0, 300)}

`
            + `Para responder: 1) Identifique o conceito central. `
            + `2) Analise como ele se comporta no novo contexto. `
            + `3) Aplique as regras/princípios ao cenário proposto.`;

        return { front, back, type: 'application' };
    },

};
