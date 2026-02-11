import { SettingsModel } from '../models/SettingsModel.js';

/**
 * ApiService.js
 * Gerencia todas as chamadas externas (Groq, Serper) com lÃ³gica robusta recuperada.
 */
export const ApiService = {
    lastGroqCallAt: 0,
    _groqQueue: Promise.resolve(),

    async _getSettings() {
        return await SettingsModel.getSettings();
    },

    /**
     * Respeita o rate limit do Groq
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
     * Enfileira chamadas Groq para evitar concorrencia e respeitar rate limit
     */
    async _withGroqRateLimit(taskFn) {
        const run = async () => {
            await this._waitForRateLimit();
            return taskFn();
        };
        const task = this._groqQueue.then(run, run);
        this._groqQueue = task.catch(() => {});
        return task;
    },

    /**
     * Wrapper para fetch com headers comuns e retry robusto
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
                    // Backoff exponencial: 2s, 4s, 8s - mÃ¡ximo 10s
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
     * Valida se o texto Ã© uma questÃ£o vÃ¡lida usando Groq
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
     * Busca no Serper (Google) com fallback para sites educacionais
     * LÃ³gica exata do searchWithSerper legado
     */
    async searchWithSerper(query) {
        const { serperApiUrl, serperApiKey } = await this._getSettings();

        // 1. Limpeza da Query (cleanQueryForSearch interna)
        let cleanQuery = query
            .replace(/^(?:QuestÃ£o|Pergunta|Atividade|ExercÃ­cio)\s*\d+[\s.:-]*/gi, '')
            .replace(/Marcar para revisÃ£o/gi, '')
            .replace(/\s*(Responda|O que vocÃª achou|Relatar problema|Voltar|AvanÃ§ar|Menu|Finalizar)[\s\S]*/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Se tem "?" e o texto antes Ã© substancial, usa sÃ³ atÃ© o "?"
        // Mas sÃ³ se nÃ£o for uma questÃ£o sem interrogaÃ§Ã£o (como "assinale a correta")
        if (cleanQuery.includes('?')) {
            const questionEnd = cleanQuery.indexOf('?');
            const questionText = cleanQuery.substring(0, questionEnd + 1).trim();
            // SÃ³ corta se realmente parece ser a pergunta principal
            if (questionText.length >= 50) cleanQuery = questionText;
        }

        // Remove alternativas APENAS se estiverem claramente marcadas com A), B), etc
        const optionMarkers = [...cleanQuery.matchAll(/(^|\s)[A-E]\s*[\)\.\-:]\s/g)];
        if (optionMarkers.length >= 2) {
            const firstMarkerIndex = optionMarkers[0].index ?? -1;
            if (firstMarkerIndex > 30) {
                cleanQuery = cleanQuery.substring(0, firstMarkerIndex).trim();
            }
        }

        cleanQuery = cleanQuery.substring(0, 250); // Limite

        console.log(`AnswerHunter: Query limpa: "${cleanQuery}"`);

        const TOP_SITES = ['brainly.com.br', 'passeidireto.com', 'studocu.com'];
        const siteFilter = TOP_SITES.map(s => `site:${s}`).join(' OR ');

        try {
            // Primeiro: buscar SEM filtro
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

            // Fallback: com filtro
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
     * Verifica correspondÃªncia entre questÃ£o e fonte
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
     * Extrai OpÃ§Ãµes Localmente (Regex) - Helper interno usado no refinamento
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
            const plainAltPattern = /(?:^|[.!?]\s+)([A-E])\s+([A-ZÃ€-Ãš][^]*?)(?=(?:[.!?]\s+)[A-E]\s+[A-ZÃ€-Ãš]|$)/g;
            let m;
            while ((m = plainAltPattern.exec(normalized)) !== null) {
                const letter = m[1].toUpperCase();
                const body = clean(m[2].replace(/\s+[.!?]\s*$/, ''));
                if (body) options.push({ letter, body });
            }
            return options.length >= 2 ? options : null;
        };

        // MÃ©todo MELHORADO para alternativas sem letra (formato EstÃ¡cio/Brainly)
        // Detecta frases consecutivas que parecem ser opÃ§Ãµes apÃ³s marcadores
        const bySentencesAfterMarker = () => {
            // Procura por marcadores de inÃ­cio de opÃ§Ãµes
            const markers = [
                /(?:assinale|marque)\s+(?:a\s+)?(?:alternativa\s+)?(?:correta|verdadeira|incorreta|falsa)[.:]/gi,
                /(?:opÃ§Ã£o|alternativa)\s+(?:correta|verdadeira)[.:]/gi,
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
                // Fallback: procurar apÃ³s "?" ou no inÃ­cio
                const questionMark = sourceContent.indexOf('?');
                if (questionMark > 30) {
                    startIdx = questionMark + 1;
                } else {
                    return null;
                }
            }

            // Pega o texto apÃ³s o marcador
            let afterMarker = sourceContent.substring(startIdx).trim();

            // Remove referÃªncias como (Ref.: 123456)
            afterMarker = afterMarker.replace(/\(Ref\.?:\s*\d+\)\s*/gi, '');

            // Tenta dividir por frases que parecem alternativas
            // PadrÃ£o: frases que comeÃ§am com maiÃºscula apÃ³s ponto/quebra e tÃªm tamanho mÃ©dio
            const sentences = afterMarker
                .split(/(?<=[.!])\s+(?=[A-ZÃ€-ÃšÃ‰])/)
                .map(s => s.trim())
                .filter(s => {
                    // Filtra sentenÃ§as que parecem alternativas vÃ¡lidas
                    if (s.length < 20 || s.length > 500) return false;
                    // Remove sentenÃ§as que parecem ser respostas/gabaritos
                    if (/^(Resposta|Gabarito|Correta|A resposta|portanto|letra\s+[A-E]|De acordo|Segundo)/i.test(s)) return false;
                    // Remove sentenÃ§as com metadados de sites
                    if (/verificad[ao]|especialista|winnyfernandes|Excelente|curtidas|usuÃ¡rio|respondeu/i.test(s)) return false;
                    return true;
                });

            // Se temos entre 3-6 sentenÃ§as vÃ¡lidas, atribui letras
            if (sentences.length >= 3 && sentences.length <= 6) {
                const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
                return sentences.slice(0, 5).map((body, idx) => ({
                    letter: letters[idx],
                    body: clean(body.replace(/\.+$/, ''))
                }));
            }
            return null;
        };

        // MÃ©todo para alternativas em parÃ¡grafos (formato comum em sites educacionais)
        const byParagraphs = () => {
            const lines = normalized.split(/\n+/).map(line => line.trim()).filter(Boolean);
            const candidateOptions = [];
            let foundStartMarker = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                
                // Marca inÃ­cio da seÃ§Ã£o de opÃ§Ãµes
                if (/assinale|alternativa|opÃ§Ã£o|opÃ§Ãµes|correta[.:]|incorreta[.:]/i.test(line)) {
                    foundStartMarker = true;
                    continue;
                }
                
                // Para quando encontra marcadores de resposta
                if (/^(Resposta|Gabarito|Correta|Alternativa correta|A resposta|estÃ¡ correta|portanto|letra\s+[A-E])/i.test(line)) {
                    break;
                }
                
                // Se jÃ¡ encontrou o marcador, adiciona linhas como opÃ§Ãµes
                if (foundStartMarker) {
                    // Ignora linhas muito curtas ou muito longas
                    if (line.length < 15 || line.length > 500) continue;
                    // Ignora linhas que parecem enunciados
                    if (line.endsWith('?') || line.endsWith(':')) continue;
                    // Ignora metadados
                    if (/verificad[ao]|especialista|curtidas|respondeu/i.test(line)) continue;
                    
                    candidateOptions.push(line);
                }
            }

            // Se temos 3+ parÃ¡grafos candidatos, atribui letras
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
     * Extrai opÃ§Ãµes (A, B, C...) de qualquer texto
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
     * Prompt 1: Extrair opÃ§Ãµes (IA)
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
     * Prompt 2: Identificar a resposta correta (IA)
     */
    async extractAnswerFromSource(originalQuestion, sourceContent) {
        const { groqApiUrl, groqApiKey, groqModelAnswer } = await this._getSettings();

        const prompt = `Analise a fonte e identifique a resposta correta para a questÃ£o.

QUESTÃƒO:
${originalQuestion.substring(0, 1500)}

FONTE:
${sourceContent.substring(0, 2500)}

INSTRUÃ‡Ã•ES:
- Identifique a letra da resposta correta (A, B, C, D ou E)
- Extraia o texto completo da alternativa correta
- Responda APENAS no formato: "Letra X: [texto completo da alternativa]"
- Se nÃ£o encontrar resposta clara, diga apenas: NAO_ENCONTRADO`;

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
                        { role: 'system', content: 'VocÃª extrai respostas de questÃµes de mÃºltipla escolha. Sempre responda no formato "Letra X: [texto da alternativa]".' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 200
                })
            }));

            let content = data.choices?.[0]?.message?.content?.trim() || '';
            console.log('AnswerHunter: Resposta IA bruta:', content);
            
            // Limpar respostas que indicam que nÃ£o encontrou
            if (!content || content.length < 3) return null;
            if (/^(NAO_ENCONTRADO|SEM_RESPOSTA|INVALIDO|N[Ã£a]o\s+(encontr|consigo|h[Ã¡a]))/i.test(content)) return null;
            
            // Se contÃ©m indicaÃ§Ã£o de nÃ£o encontrado no meio/fim, tentar extrair a parte Ãºtil
            if (/NAO_ENCONTRADO|SEM_RESPOSTA/i.test(content)) {
                // Tentar extrair letra antes da indicaÃ§Ã£o de erro
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
     * Inferir resposta com base em evidÃªncias (gabarito/comentÃ¡rios)
     */
    async inferAnswerFromEvidence(originalQuestion, sourceContent) {
        const { groqApiUrl, groqApiKey, groqModelAnswer } = await this._getSettings();

        const prompt = `Voce deve INFERIR a resposta correta para a questao do cliente usando as evidencias da fonte.

QUESTAO DO CLIENTE:
${originalQuestion.substring(0, 2000)}

EVIDENCIAS DA FONTE:
${sourceContent.substring(0, 3500)}

INSTRUCOES:
- Use gabarito, comentarios e explicacoes da fonte como evidencias.
- Se a fonte nao for a mesma questao, mas trazer definicoes que permitam responder, use essas definicoes.
- Responda APENAS no formato: "Letra X: [texto completo da alternativa]".
- Se nao houver evidencia suficiente, responda apenas: NAO_ENCONTRADO.
- Nunca invente alternativas que nao estejam na questao do cliente.`;

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
                        { role: 'system', content: 'Voce infere respostas de questoes com base em evidencias. Responda apenas no formato "Letra X: [texto da alternativa]" ou NAO_ENCONTRADO.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 220
                })
            }));

            let content = data.choices?.[0]?.message?.content?.trim() || '';
            console.log('AnswerHunter: Inferencia IA bruta:', content);

            if (!content || content.length < 3) return null;
            if (/^(NAO_ENCONTRADO|SEM_RESPOSTA|INVALIDO|N[Ã£a]o\s+(encontr|consigo|h[Ã¡a]))/i.test(content)) return null;

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
     * FunÃ§Ã£o principal de refinamento (3-Passos)
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
     * Fallback: gerar resposta diretamente pela IA quando nÃ£o houver fontes
     */
    async generateAnswerFromQuestion(questionText) {
        if (!questionText) return null;
        const { groqApiUrl, groqApiKey, groqModelFallback } = await this._getSettings();

        const prompt = `Responda a questÃ£o abaixo de forma direta e objetiva.\n\nQUESTÃƒO:\n${questionText}\n\nREGRAS:\n- Se for mÃºltipla escolha, responda APENAS no formato: "Letra X: [texto completo da alternativa]".\n- Se for aberta, responda em 1 a 3 frases.\n- NÃ£o invente citaÃ§Ãµes.`;

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
                        { role: 'system', content: 'VocÃª Ã© um assistente que responde questÃµes com objetividade.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.2,
                    max_tokens: 300
                })
            }));

            const content = data.choices?.[0]?.message?.content?.trim() || '';
            return content || null;
        } catch (error) {
            console.error('Erro ao gerar resposta direta:', error);
            return null;
        }
    },

    /**
     * Busca o conteÃºdo de uma pÃ¡gina web via fetch
     * Usado para analisar fontes mais profundamente
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
            console.log(AnswerHunter: Erro ao buscar pÃ¡gina :, error?.message || String(error));
            return null;
        }
    }
};