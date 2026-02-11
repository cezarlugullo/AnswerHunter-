import { SettingsModel } from '../models/SettingsModel.js';

/**
 * ApiService.js
 * Manages all external calls (Groq, Serper) with robust recovered logic.
 */
export const ApiService = {
    lastGroqCallAt: 0,
    _groqQueue: Promise.resolve(),

    async _getSettings() {
        return await SettingsModel.getSettings();
    },

    /**
     * Respects Groq rate limit
     */
    async _waitForRateLimit() {
        const { minGroqIntervalMs } = await this._getSettings();
        const now = Date.now();
        const elapsed = now - this.lastGroqCallAt;
        const remaining = minGroqIntervalMs - elapsed;
        if (remaining > 0) {
            await new Promise(resolve => setTimeout(resolve, remaining));
        }
        this.lastGroqCallAt = Date.now();
    },
    /**
     * Queues Groq calls to avoid concurrency and respect rate limit
     */
    async _withGroqRateLimit(taskFn) {
        const run = async () => {
            await this._waitForRateLimit();
            return taskFn();
        };
        const task = this._groqQueue.then(run, run);
        this._groqQueue = task.catch(() => { });
        return task;
    },

    /**
     * Wrapper for fetch with common headers and robust retry
     */
    async _fetch(url, options) {
        const maxRetries = 3;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) {
                    return await response.json();
                }

                if (response.status === 429 && attempt < maxRetries) {
                    const retryAfter = parseFloat(response.headers.get('retry-after') || '0');
                    // Exponential backoff: 2s, 4s, 8s - max 10s
                    const backoffMs = Math.min(10000, Math.max(2000 * Math.pow(2, attempt), retryAfter * 1000));
                    console.log(`AnswerHunter: Rate limit 429, aguardando ${backoffMs}ms (tentativa ${attempt + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    continue;
                }

                throw new Error(`HTTP Error ${response.status}`);
            } catch (error) {
                if (attempt < maxRetries && !error.message?.includes('HTTP Error')) {
                    const jitter = 500 + Math.random() * 500;
                    await new Promise(resolve => setTimeout(resolve, jitter));
                    continue;
                }
                console.error(`ApiService Fetch Error (${url}):`, error);
                throw error;
            }
        }
    },

    _makeWebcacheUrl(url) {
        try {
            if (/webcache\.googleusercontent\.com\/search\?q=cache:/i.test(url)) return url;
            return `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
        } catch {
            return null;
        }
    },

    async _fetchTextWithTimeout(url, options = {}, timeoutMs = 6500) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            const text = await res.text().catch(() => '');
            return { ok: res.ok, status: res.status, url: res.url || url, text };
        } catch (error) {
            return { ok: false, status: 0, url, text: '', error };
        } finally {
            clearTimeout(timeout);
        }
    },

    /**
     * Fetches a snapshot preserving BOTH HTML and derived text, with fallback for blocked sources.
     * Needed for PDF-like HTML sources (PasseiDireto/Studocu) where answers may be encoded by CSS classes.
     */
    async fetchPageSnapshot(url, opts = {}) {
        if (!url) return null;

        const {
            timeoutMs = 6500,
            maxHtmlChars = 1500000,
            maxTextChars = 12000
        } = opts;

        const commonHeaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache'
        };

        const primary = await this._fetchTextWithTimeout(url, {
            method: 'GET',
            headers: commonHeaders,
            mode: 'cors',
            credentials: 'omit'
        }, timeoutMs);

        let viaWebcache = false;
        let final = primary;

        if ((!primary.ok && (primary.status === 403 || primary.status === 429 || primary.status === 0)) || (primary.ok && (primary.text || '').length < 500)) {
            const webcacheUrl = this._makeWebcacheUrl(url);
            if (webcacheUrl) {
                const cached = await this._fetchTextWithTimeout(webcacheUrl, {
                    method: 'GET',
                    headers: commonHeaders,
                    mode: 'cors',
                    credentials: 'omit'
                }, timeoutMs);
                if (cached.ok && (cached.text || '').length > 800) {
                    final = cached;
                    viaWebcache = true;
                }
            }
        }

        if (!final.ok || !final.text) {
            return {
                ok: false,
                status: final.status || 0,
                url: final.url || url,
                viaWebcache,
                html: '',
                text: ''
            };
        }

        const html = String(final.text || '').slice(0, maxHtmlChars);

        let derivedText = '';
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const elementsToRemove = doc.querySelectorAll('script, style, nav, header, footer, aside, iframe, noscript, [role="navigation"], [role="banner"], .ads, .advertisement, .sidebar');
            elementsToRemove.forEach(el => el.remove());
            derivedText = (doc.body?.innerText || '').trim();
        } catch {
            derivedText = '';
        }

        const cleanedText = (derivedText || '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, maxTextChars);

        return {
            ok: true,
            status: final.status || 200,
            url: final.url || url,
            viaWebcache,
            html,
            text: cleanedText
        };
    },

    /**
     * Validates if the text is a valid question using Groq
     */
    async validateQuestion(questionText) {
        if (!questionText) return false;
        const { groqApiUrl, groqApiKey, groqModelFast } = await this._getSettings();

        const prompt = `Voce deve validar se o texto abaixo e UMA questao limpa e coerente.\n\nRegras:\n- Deve ser uma pergunta/questao de prova ou exercicio.\n- Pode ter alternativas (A, B, C, D, E).\n- NAO pode conter menus, botoes, avisos, instrucoes de site, ou texto sem relacao.\n- Se estiver poluida, misturando outra questao, ou sem sentido, responda INVALIDO.\n\nTexto:\n${questionText}\n\nResponda apenas: OK ou INVALIDO.`;

        try {
            const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelFast,
                    messages: [
                        { role: 'system', content: 'Responda apenas OK ou INVALIDO.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 10
                })
            }));

            const content = data.choices?.[0]?.message?.content?.trim().toUpperCase() || '';
            if (content.includes('INVALIDO')) return false;
            if (content.includes('OK')) return true;
            return true;
        } catch (error) {
            console.error('Erro validacao Groq:', error);
            return true;
        }
    },

    /**
     * Search on Serper (Google) with fallback to educational sites
     * Exact logic from legacy searchWithSerper
     */
    async searchWithSerper(query) {
        const { serperApiUrl, serperApiKey } = await this._getSettings();

        // 1. Query cleaning (internal cleanQueryForSearch)
        let cleanQuery = query
            .replace(/^(?:Questão|Pergunta|Atividade|Exercício)\s*\d+[\s.:-]*/gi, '')
            .replace(/Marcar para revisão/gi, '')
            .replace(/\s*(Responda|O que você achou|Relatar problema|Voltar|Avançar|Menu|Finalizar)[\s\S]*/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        // If it has "?" and the text before is substantial, use only up to "?"
        // But only if it is not a question without a question mark (like "select the correct one")
        if (cleanQuery.includes('?')) {
            const questionEnd = cleanQuery.indexOf('?');
            const questionText = cleanQuery.substring(0, questionEnd + 1).trim();
            // Only cut if it really seems to be the main question
            if (questionText.length >= 50) cleanQuery = questionText;
        }

        // Remove alternatives ONLY if clearly marked with A), B), etc
        const optionMarkers = [...cleanQuery.matchAll(/(^|\s)[A-E]\s*[\)\.\-:]\s/g)];
        if (optionMarkers.length >= 2) {
            const firstMarkerIndex = optionMarkers[0].index ?? -1;
            if (firstMarkerIndex > 30) {
                cleanQuery = cleanQuery.substring(0, firstMarkerIndex).trim();
            }
        }

        cleanQuery = cleanQuery.substring(0, 250); // Limit

        console.log(`AnswerHunter: Query limpa: "${cleanQuery}"`);

        const TOP_SITES = ['brainly.com.br', 'passeidireto.com', 'studocu.com'];
        const siteFilter = TOP_SITES.map(s => `site:${s}`).join(' OR ');

        try {
            // First: search WITHOUT filter
            console.log(`AnswerHunter: Buscando resposta...`);
            let data = await this._fetch(serperApiUrl, {
                method: 'POST',
                headers: {
                    'X-API-KEY': serperApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q: cleanQuery + ' resposta correta',
                    gl: 'br',
                    hl: 'pt-br',
                    num: 8
                })
            });

            if (data.organic && data.organic.length > 0) {
                console.log(`AnswerHunter: ${data.organic.length} resultados encontrados no Serper`);
                return data.organic;
            }

            // Fallback: with filter
            console.log('AnswerHunter: Tentando com sites educacionais...');
            data = await this._fetch(serperApiUrl, {
                method: 'POST',
                headers: {
                    'X-API-KEY': serperApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q: cleanQuery + ' ' + siteFilter,
                    gl: 'br',
                    hl: 'pt-br',
                    num: 5
                })
            });

            return data.organic || [];
        } catch (e) {
            console.error('AnswerHunter: Erro na busca:', e);
            return [];
        }
    },

    /**
     * Verifies match between question and source
     */
    async verifyQuestionMatch(originalQuestion, sourceContent) {
        const { groqApiUrl, groqApiKey, groqModelFast } = await this._getSettings();

        const prompt = `Voce deve verificar se o conteudo da FONTE corresponde a mesma questao do CLIENTE.

=== QUESTAO DO CLIENTE ===
${originalQuestion.substring(0, 500)}

=== CONTEUDO DA FONTE ===
${sourceContent.substring(0, 500)}

REGRAS:
- Compare o TEMA/ASSUNTO das duas questoes
- Se forem sobre o MESMO assunto, responda: CORRESPONDE
- Se forem sobre assuntos DIFERENTES, responda: NAO_CORRESPONDE
- Exemplos de NAO correspondencia:
  * Cliente pergunta sobre ergonomia, fonte fala sobre regioes geograficas
  * Cliente pergunta sobre biologia, fonte fala sobre matematica

Responda APENAS: CORRESPONDE ou NAO_CORRESPONDE`;

        try {
            const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelFast,
                    messages: [
                        { role: 'system', content: 'Voce verifica se duas questoes sao sobre o mesmo assunto. Responda apenas CORRESPONDE ou NAO_CORRESPONDE.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 20
                })
            }));

            const content = data.choices?.[0]?.message?.content?.trim().toUpperCase() || '';
            console.log('AnswerHunter: Verificacao de correspondencia:', content);
            return content.includes('CORRESPONDE') && !content.includes('NAO_CORRESPONDE');
        } catch (error) {
            console.error('Erro ao verificar correspondencia:', error);
            return true;
        }
    },

    /**
     * Extract Options Locally (Regex) - Internal helper used in refinement
     */
    _extractOptionsLocally(sourceContent) {
        if (!sourceContent) return null;
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const normalized = sourceContent.replace(/\r\n/g, '\n');

        const byLines = () => {
            const lines = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean);
            const options = [];
            const altStartRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;
            let current = null;

            for (const line of lines) {
                const m = line.match(altStartRe);
                if (m) {
                    if (current) options.push(current);
                    current = { letter: m[1].toUpperCase(), body: clean(m[2]) };
                } else if (current) {
                    current.body = clean(`${current.body} ${line}`);
                }
            }
            if (current) options.push(current);
            return options.length >= 2 ? options : null;
        };

        const byInline = () => {
            const options = [];
            const inlinePattern = /(^|[\s])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:\s)[A-E]\s*[\)\.\-:]|$)/gi;
            let m;
            while ((m = inlinePattern.exec(normalized)) !== null) {
                const letter = m[2].toUpperCase();
                const body = clean(m[3]);
                if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
        };

        const byPlain = () => {
            const options = [];
            const plainAltPattern = /(?:^|[.!?]\\s+)([A-E])\\s+([A-Za-z][^]*?)(?=(?:[.!?]\\s+)[A-E]\\s+[A-Za-z]|$)/g;
            let m;
            while ((m = plainAltPattern.exec(normalized)) !== null) {
                const letter = m[1].toUpperCase();
                const body = clean(m[2].replace(/\s+[.!?]\s*$/, ''));
                if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
        };

        // IMPROVED method for alternatives without letter (Estácio/Brainly format)
        // Detects consecutive sentences that appear to be options after markers
        const bySentencesAfterMarker = () => {
            // Search for option start markers
            const markers = [
                /(?:assinale|marque)\s+(?:a\s+)?(?:alternativa\s+)?(?:correta|verdadeira|incorreta|falsa)[.:]/gi, ,
                /(?:opção|alternativa)\s+(?:correta|verdadeira)[.:]/gi,
                /\(Ref\.?:\s*\d+\)/gi,
                /assinale\s+(?:a\s+)?(?:afirmativa|assertiva)\s+correta[.:]/gi
            ];

            let startIdx = -1;
            for (const marker of markers) {
                marker.lastIndex = 0;
                const match = marker.exec(sourceContent);
                if (match) {
                    startIdx = match.index + match[0].length;
                    break;
                }
            }

            if (startIdx === -1) {
                // Fallback: search after "?" or at the beginning
                const questionMark = sourceContent.indexOf('?');
                if (questionMark > 30) {
                    startIdx = questionMark + 1;
                } else {
                    return null;
                }
            }

            // Get text after the marker
            let afterMarker = sourceContent.substring(startIdx).trim();

            // Remove references like (Ref.: 123456)
            afterMarker = afterMarker.replace(/\(Ref\.?:\s*\d+\)\s*/gi, '');

            // Try to split by sentences that look like alternatives
            // Pattern: sentences starting with uppercase after dot/newline and having medium length
            const sentences = afterMarker
                .split(/(?<=[.!])\s+(?=[A-ZÀ-ÚÉ])/)
                .map(s => s.trim())
                .filter(s => {
                    // Filters sentences that look like valid alternatives
                    if (s.length < 20 || s.length > 500) return false;
                    // Remove sentences that look like answers/keys
                    if (/^(Resposta|Gabarito|Correta|A resposta|portanto|letra\s+[A-E]|De acordo|Segundo)/i.test(s)) return false;
                    // Remove sentences with site metadata
                    if (/verificad[ao]|especialista|winnyfernandes|Excelente|curtidas|usuário|respondeu/i.test(s)) return false;
                    return true;
                });

            // If we have between 3-6 valid sentences, assign letters
            if (sentences.length >= 3 && sentences.length <= 6) {
                const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
                return sentences.slice(0, 5).map((body, idx) => ({
                    letter: letters[idx],
                    body: clean(body.replace(/\.+$/, ''))
                }));
            }
            return null;
        };

        // Method for alternatives in paragraphs (common format in educational sites)
        const byParagraphs = () => {
            const lines = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean);
            const candidateOptions = [];
            let foundStartMarker = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Marks start of options section
                if (/assinale|alternativa|opção|opções|correta[.:]|incorreta[.:]/i.test(line)) {
                    foundStartMarker = true;
                    continue;
                }

                // Stops when finding answer markers
                if (/^(Resposta|Gabarito|Correta|Alternativa correta|A resposta|está correta|portanto|letra\s+[A-E])/i.test(line)) {
                    break;
                }

                // If marker already found, add lines as options
                if (foundStartMarker) {
                    // Ignore lines too short or too long
                    if (line.length < 15 || line.length > 500) continue;
                    // Ignore lines that look like statements
                    if (line.endsWith('?') || line.endsWith(':')) continue;
                    // Ignore metadata
                    if (/verificad[ao]|especialista|curtidas|respondeu/i.test(line)) continue;

                    candidateOptions.push(line);
                }
            }

            // If we have 3+ candidate paragraphs, assign letters
            if (candidateOptions.length >= 3 && candidateOptions.length <= 6) {
                const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
                return candidateOptions.slice(0, 5).map((body, idx) => ({
                    letter: letters[idx],
                    body: clean(body)
                }));
            }
            return null;
        };

        const found = byLines() || byInline() || byPlain() || bySentencesAfterMarker() || byParagraphs();
        if (!found) return null;

        return found.map(o => `${o.letter}) ${o.body}`).join('\n');
    },

    /**
     * Extracts options (A, B, C...) from any text
     */
    extractOptionsFromText(sourceContent) {
        const raw = this._extractOptionsLocally(sourceContent);
        if (!raw) return [];
        return raw
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
    },

    /**
     * Prompt 1: Extract options (AI)
     */
    async extractOptionsFromSource(sourceContent) {
        const { groqApiUrl, groqApiKey, groqModelFast } = await this._getSettings();

        const prompt = `Voce deve extrair APENAS as alternativas (opcoes A, B, C, D, E) do texto abaixo.

TEXTO DA FONTE:
${sourceContent}

REGRAS:
- Extraia APENAS as alternativas no formato: A) texto, B) texto, etc.
- Se nao houver alternativas claras, responda: SEM_OPCOES
- NAO invente alternativas
- NAO inclua o enunciado da pergunta

FORMATO DE SAIDA (apenas as alternativas):
A) [texto da alternativa A]
B) [texto da alternativa B]
C) [texto da alternativa C]
D) [texto da alternativa D]
E) [texto da alternativa E se houver]`;

        try {
            const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelFast,
                    messages: [
                        { role: 'system', content: 'Voce extrai apenas alternativas de questoes. Responda APENAS com as alternativas no formato A) B) C) D) E) ou SEM_OPCOES.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 500
                })
            }));

            const content = data.choices?.[0]?.message?.content?.trim() || '';
            if (content.includes('SEM_OPCOES')) return null;
            return content;
        } catch (error) {
            console.error('Erro ao extrair opcoes:', error);
            return null;
        }
    },

    /**
     * Prompt 2: Identify the correct answer (AI)
     */
    async extractAnswerFromSource(originalQuestion, sourceContent) {
        const { groqApiUrl, groqApiKey, groqModelAnswer } = await this._getSettings();

        const prompt = `Analise a fonte e identifique a resposta correta para a questão.

QUESTÃO:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

INSTRUÇÕES:
- Identifique a letra da resposta correta (A, B, C, D ou E)
- Extraia o texto completo da alternativa correta
- Responda APENAS no formato: "Letra X: [texto completo da alternativa]"
- Se não encontrar resposta clara, diga apenas: NAO_ENCONTRADO`;

        try {
            const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelAnswer,
                    messages: [
                        { role: 'system', content: 'Você extrai respostas de questões de múltipla escolha. Sempre responda no formato "Letra X: [texto da alternativa]".' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 200
                })
            }));

            let content = data.choices?.[0]?.message?.content?.trim() || '';
            console.log('AnswerHunter: Resposta IA bruta:', content);

            // Clear answers indicating not found
            if (!content || content.length < 3) return null;
            if (/^(NAO_ENCONTRADO|SEM_RESPOSTA|INVALIDO|N[ãa]o\s+(encontr|consigo|h[áa]))/i.test(content)) return null;

            // If contains not found indication in middle/end, try to extract useful part
            if (/NAO_ENCONTRADO|SEM_RESPOSTA/i.test(content)) {
                // Try to extract letter before error indication
                const beforeError = content.split(/NAO_ENCONTRADO|SEM_RESPOSTA/i)[0].trim();
                const letterMatch = beforeError.match(/(?:letra|alternativa)\s*([A-E])\b/i);
                if (letterMatch) {
                    content = `Letra ${letterMatch[1].toUpperCase()}`;
                } else {
                    return null;
                }
            }

            return content;
        } catch (error) {
            console.error('Erro ao extrair resposta:', error);
            return null;
        }
    },

    /**
     * Infer answer based on evidence (answer key/comments)
     * Enhanced with per-alternative evaluation & polarity awareness
     */
    async inferAnswerFromEvidence(originalQuestion, sourceContent) {
        const { groqApiUrl, groqApiKey, groqModelAnswer } = await this._getSettings();

        // Detect question polarity
        const normQ = originalQuestion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const wantsIncorrect = /\b(falsa|incorreta|errada|exceto|nao\s+correta)\b/i.test(normQ);
        const polarityNote = wantsIncorrect
            ? '\n⚠️ ATENÇÃO: A questão pede a alternativa INCORRETA/FALSA/EXCETO. Você deve encontrar a alternativa ERRADA, não a correta.'
            : '';

        const prompt = `INFERÊNCIA DE RESPOSTA COM BASE EM EVIDÊNCIAS

QUESTÃO DO CLIENTE:
${originalQuestion.substring(0, 2000)}

EVIDÊNCIAS DAS FONTES:
${sourceContent.substring(0, 3500)}
${polarityNote}

INSTRUÇÕES - siga EXATAMENTE esta ordem:

PASSO 1 (VERIFICAÇÃO): As fontes discutem a MESMA questão ou o MESMO tema?
- Se sim, indique "TEMA COMPATÍVEL" e continue.
- Se não, responda apenas: NAO_ENCONTRADO

PASSO 2 (EVIDÊNCIAS): Liste os gabaritos, comentários ou definições relevantes encontrados nas fontes.

PASSO 3 (AVALIAÇÃO): Para cada alternativa da questão do cliente, indique:
- Se as evidências CONFIRMAM, REFUTAM ou são NEUTRAS sobre ela.

PASSO 4 (CONCLUSÃO): Com base nos passos anteriores, indique a resposta.

FORMATO FINAL OBRIGATÓRIO (última linha):
Letra X: [texto completo da alternativa]

Se não houver evidência suficiente: NAO_ENCONTRADO

REGRAS:
- Nunca invente alternativas que não estejam na questão do cliente.
- Se múltiplas fontes concordam, dê mais peso a esse consenso.
- Se houver gabarito explícito (ex: "Gabarito: C"), priorize-o.`;

        try {
            const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelAnswer,
                    messages: [
                        { role: 'system', content: 'Você infere respostas de questões com base em evidências de fontes. Analise sistematicamente antes de responder. Formato final: "Letra X: [texto]" ou NAO_ENCONTRADO.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 450
                })
            }));

            let content = data.choices?.[0]?.message?.content?.trim() || '';
            console.log('AnswerHunter: Inferencia IA bruta:', content?.substring(0, 200));

            if (!content || content.length < 3) return null;
            if (/^(NAO_ENCONTRADO|SEM_RESPOSTA|INVALIDO|N[ãa]o\s+(encontr|consigo|h[áa]))/i.test(content)) return null;

            if (/NAO_ENCONTRADO|SEM_RESPOSTA/i.test(content)) {
                const beforeError = content.split(/NAO_ENCONTRADO|SEM_RESPOSTA/i)[0].trim();
                const letterMatch = beforeError.match(/(?:letra|alternativa)\s*([A-E])\b/i);
                if (letterMatch) {
                    content = `Letra ${letterMatch[1].toUpperCase()}`;
                } else {
                    return null;
                }
            }

            return content;
        } catch (error) {
            console.error('Erro ao inferir resposta:', error);
            return null;
        }
    },

    /**
     * Main refinement function (3-Steps)
     */
    async refineWithGroq(item) {
        console.log('AnswerHunter: Iniciando refinamento com 3 prompts...');
        const originalQuestion = item.question;
        const hasOptionsInOriginal = /[A-E]\s*[\)\.]\s*\S+/i.test(originalQuestion);

        let options = null;
        let optionsPromise = null;
        if (!hasOptionsInOriginal && item.answer && item.answer.length > 30) {
            options = this._extractOptionsLocally(item.answer);
            if (!options) {
                optionsPromise = this.extractOptionsFromSource(item.answer);
            }
        }

        const answerPromise = this.inferAnswerFromEvidence(originalQuestion, item.answer);
        const [answer, optionsFromGroq] = await Promise.all([
            answerPromise,
            optionsPromise ? optionsPromise : Promise.resolve(null)
        ]);

        if (!options && optionsFromGroq) options = optionsFromGroq;
        console.log('AnswerHunter: Resposta identificada:', answer ? 'Sim' : 'Nao');

        if (!answer) {
            return null;
        }

        let finalQuestion = originalQuestion;
        if (!hasOptionsInOriginal && options) {
            finalQuestion = originalQuestion + '\n' + options;
        }

        return {
            question: finalQuestion.trim(),
            answer: answer.trim()
        };
    },

    /**
     * Fallback: generate answer directly by AI when there are no sources
     * Uses anti-hallucination prompt: evaluates each alternative individually,
     * checks for contradictions, then selects.
     */
    async generateAnswerFromQuestion(questionText) {
        if (!questionText) return null;
        const { groqApiUrl, groqApiKey, groqModelFallback } = await this._getSettings();

        // Detect if multiple choice
        const hasOptions = /\b[A-E]\s*[).\-]\s/m.test(questionText);

        const prompt = hasOptions
            ? `ANÁLISE SISTEMÁTICA DE QUESTÃO DE MÚLTIPLA ESCOLHA

QUESTÃO:
${questionText}

INSTRUÇÕES - siga EXATAMENTE esta ordem:

PASSO 1: Classifique CADA alternativa como V (verdadeira) ou F (falsa), com uma justificativa OBJETIVA de 1 linha baseada em fatos/definições.
Formato: "X) V/F - [justificativa]"

PASSO 2: Verifique contradições:
- Há duas alternativas dizendo a mesma coisa? 
- A questão pede a CORRETA ou a INCORRETA/FALSA/EXCETO?

PASSO 3: Com base nos passos anteriores, indique a resposta FINAL.
Se a questão pede a CORRETA: escolha a alternativa V.
Se a questão pede a INCORRETA/FALSA/EXCETO: escolha a alternativa F.

FORMATO FINAL OBRIGATÓRIO (última linha):
Letra X: [texto completo da alternativa escolhida]

REGRAS:
- Nunca invente alternativas que não estejam na questão.
- Se não tiver certeza, indique a mais provável mas mantenha o formato.
- Preste atenção especial se a questão pede "incorreta", "falsa", "exceto" ou "não é".`
            : `Responda a questão abaixo de forma direta e objetiva.\n\nQUESTÃO:\n${questionText}\n\nREGRAS:\n- Responda em 1 a 3 frases.\n- Não invente citações.`;

        try {
            const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: groqModelFallback,
                    messages: [
                        {
                            role: 'system', content: hasOptions
                                ? 'Você é um especialista em análise de questões de múltipla escolha. Analise cada alternativa sistematicamente antes de responder. Sempre termine com "Letra X: [texto]".'
                                : 'Você é um assistente que responde questões com objetividade.'
                        },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.15,
                    max_tokens: hasOptions ? 600 : 300
                })
            }));

            const content = data.choices?.[0]?.message?.content?.trim() || '';
            console.log('AnswerHunter: AI fallback raw response:', content?.substring(0, 200));
            return content || null;
        } catch (error) {
            console.error('Erro ao gerar resposta direta:', error);
            return null;
        }
    },

    /**
     * Fetches the content of a web page via fetch
     * Used to analyze sources more deeply
     */
    async fetchPageText(url) {
        if (!url) return null;

        try {
            const snap = await this.fetchPageSnapshot(url, {
                timeoutMs: 6500,
                maxHtmlChars: 1500000,
                maxTextChars: 12000
            });
            const text = snap?.text || '';
            return text.length > 120 ? text : null;
        } catch (error) {
            console.log(`AnswerHunter: Erro ao buscar página:`, error?.message || String(error));
            return null;
        }
    }
};