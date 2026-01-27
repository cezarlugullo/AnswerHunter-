// Configuração das APIs
const GROQ_API_KEY = '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';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const SERPER_API_KEY = 'feffb9d9843cbe91d25ea499ae460068d5518f45';
const SERPER_API_URL = 'https://google.serper.dev/search';

// Global Data
let refinedData = [];
let lastGroqCallAt = 0;
const MIN_GROQ_INTERVAL_MS = 2500;
async function validateQuestionWithGroq(questionText) {
  const now = Date.now();
  if (now - lastGroqCallAt < MIN_GROQ_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_GROQ_INTERVAL_MS));
  }
  lastGroqCallAt = Date.now();

  const prompt = `Voce deve validar se o texto abaixo e UMA questao limpa e coerente.\n\nRegras:\n- Deve ser uma pergunta/questao de prova ou exercicio.\n- Pode ter alternativas (A, B, C, D, E).\n- NAO pode conter menus, botoes, avisos, instrucoes de site, ou texto sem relacao.\n- Se estiver poluida, misturando outra questao, ou sem sentido, responda INVALIDO.\n\nTexto:\n${questionText}\n\nResponda apenas: OK ou INVALIDO.`;

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'groq/compound',
        messages: [
          { role: 'system', content: 'Responda apenas OK ou INVALIDO.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 10
      })
    });

    if (!response.ok) {
      console.error('Erro validacao Groq:', response.status);
      return true;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim().toUpperCase() || '';
    if (content.includes('INVALIDO')) return false;
    if (content.includes('OK')) return true;
    return true;
  } catch (error) {
    console.error('Erro validacao Groq:', error);
    return true;
  }
}


document.addEventListener('DOMContentLoaded', () => {
  // Elementos da UI
  const extractBtn = document.getElementById('extractBtn');
  const searchBtn = document.getElementById('searchBtn');
  const copyBtn = document.getElementById('copyBtn');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  // Global variables
  // refinedData is now global


  // === EXTRAIR DA PéGINA ATUAL ===
  if (extractBtn) {
    extractBtn.addEventListener('click', async () => {
      showStatus('loading', 'Extraindo conteúdo...');
      extractBtn.disabled = true;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: extractQAContent
        });

        if (results && results[0] && results[0].result) {
          const extractedData = results[0].result;

          if (extractedData.length > 0) {
            showStatus('loading', 'Refinando com IA...');

            const refined = [];
            for (const item of extractedData) {
              const result = await refineWithGroq(item);
              refined.push(result);
            }

            refinedData = refined.filter(item => item !== null);

            if (refinedData.length > 0) {
              displayResults(refinedData);
              showStatus('success', `${refinedData.length} questão(ões) encontrada(s)!`);
              if (copyBtn) copyBtn.disabled = false;
            } else {
              showStatus('error', 'Nenhuma questão válida encontrada');
              displayResults([]);
            }
          } else {
            showStatus('error', 'Nenhuma pergunta extraída. Tente selecionar o texto.');
            displayResults([]);
          }
        }
      } catch (error) {
        console.error('Erro:', error);
        showStatus('error', 'Erro: ' + error.message);
      } finally {
        extractBtn.disabled = false;
      }
    });
  }

  // === BUSCAR NO GOOGLE ===
  if (searchBtn) {
    searchBtn.addEventListener('click', async () => {
      showStatus('loading', 'Obtendo pergunta...');
      searchBtn.disabled = true;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Extrair pergunta de TODOS os frames (incluindo iframes)
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          function: extractQuestionOnly
        });

        // Pegar o melhor resultado de todos os frames
        let question = '';
        let bestScore = 0;
        
        for (const frameResult of results || []) {
          const text = frameResult?.result || '';
          if (text.length > question.length) {
            // Pontuar para escolher o melhor
            let score = text.length;
            if (text.includes('?')) score += 500;
            if (/Atividade|Questão|Exercício/i.test(text)) score += 300;
            if (/\b[A-E]\b/g.test(text)) score += 200;
            
            if (score > bestScore) {
              bestScore = score;
              question = text;
            }
          }
        }
        
        console.log('AnswerHunter: Melhor questão encontrada:', question?.substring(0, 100));

        if (!question || question.length < 5) {
          showStatus('error', 'Selecione o texto da pergunta e tente novamente.');
          return;
        }

        showStatus('loading', 'Validando pergunta com IA...');
        const isValid = await validateQuestionWithGroq(question);
        if (!isValid) {
          showStatus('error', 'Pergunta inválida ou poluída. Tente rolar até a questão correta.');
          return;
        }

        showStatus('loading', 'Buscando no Google...');

        const searchResults = await searchWithSerper(question);

        if (!searchResults || searchResults.length === 0) {
          showStatus('error', 'Nenhum resultado encontrado no Google.');
          return;
        }

        showStatus('loading', `Analisando ${searchResults.length} resultados...`);

        const answers = await extractAnswersFromSearch(question, searchResults);

        if (answers.length > 0) {
          refinedData = answers;
          displayResults(refinedData);
          showStatus('success', `${answers.length} resposta(s) encontrada(s)!`);
          if (copyBtn) copyBtn.disabled = false;
        } else {
          showStatus('error', 'IA não encontrou a resposta nos resultados.');
        }

      } catch (error) {
        console.error('Erro na busca:', error);
        showStatus('error', 'Erro: ' + error.message);
      } finally {
        searchBtn.disabled = false;
      }
    });
  }

  // === BUSCAR COM SERPER ===
  // Sites educacionais de perguntas e respostas
  const EDUCATION_SITES = [
    'brainly.com.br', 'brainly.com',
    'passeidireto.com',
    'respondeai.com.br',
    'studocu.com',
    'chegg.com',
    'quizlet.com',
    'trabalhosfeitos.com',
    'todamateria.com.br',
    'brasilescola.uol.com.br',
    'mundoeducacao.uol.com.br',
    'infoescola.com',
    'khanacademy.org'
  ];

  function cleanQueryForSearch(query) {
    let clean = query
      // Remover prefixos de questão
      .replace(/^(?:Questão|Pergunta|Atividade|Exercício)\s*\d+[\s.:-]*/gi, '')
      // Remover marcadores de revisão
      .replace(/Marcar para revisão/gi, '')
      // Remover "Responda", "O que você achou", etc
      .replace(/\s*(Responda|O que você achou|Relatar problema|Voltar|Avançar|Menu|Finalizar)[\s\S]*/gi, '')
      // Limpar espaços
      .replace(/\s+/g, ' ')
      .trim();
    
    // Tentar extrair apenas a pergunta (até a interrogação)
    if (clean.includes('?')) {
      const questionEnd = clean.indexOf('?');
      const questionText = clean.substring(0, questionEnd + 1).trim();
      // Se a pergunta tem tamanho razoável, usar só ela
      if (questionText.length >= 30) {
        clean = questionText;
      }
    }
    
    // Remover alternativas A, B, C, D, E se ainda existirem
    clean = clean
      .replace(/\s+[A-E]\s+[A-Za-zÀ-ú][^?]*$/g, '') // Alternativas no final
      .replace(/\s+[A-E]\s*$/g, '') // Letra solta no final
      .trim();
    
    // Limitar tamanho para busca eficiente
    return clean.substring(0, 250);
  }

  async function searchWithSerper(query) {
    const cleanQuery = cleanQueryForSearch(query);
    
    console.log(`AnswerHunter: Query original: "${query.substring(0, 100)}..."`);
    console.log(`AnswerHunter: Query limpa: "${cleanQuery}"`);

    // Sites principais para busca educacional
    const TOP_SITES = ['brainly.com.br', 'passeidireto.com', 'studocu.com'];
    const siteFilter = TOP_SITES.map(s => `site:${s}`).join(' OR ');

    try {
      // Primeiro: buscar SEM filtro (mais resultados)
      console.log(`AnswerHunter: Buscando resposta...`);
      let response = await fetch(SERPER_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: cleanQuery + ' resposta correta',
          gl: 'br',
          hl: 'pt-br',
          num: 8
        })
      });

      if (!response.ok) throw new Error(`API Google: ${response.status}`);

      let data = await response.json();
      console.log('AnswerHunter: Resultados encontrados:', data.organic?.length || 0);
      
      // Se encontrou resultados, retornar
      if (data.organic && data.organic.length > 0) {
        return data.organic;
      }
      
      // Se não encontrou, tentar com filtro de sites educacionais
      console.log('AnswerHunter: Tentando com sites educacionais...');
      response = await fetch(SERPER_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: cleanQuery + ' ' + siteFilter,
          gl: 'br',
          hl: 'pt-br',
          num: 5
        })
      });
      
      if (response.ok) {
        data = await response.json();
        console.log('AnswerHunter: Resultados com filtro:', data.organic?.length || 0);
      }
      
      return data.organic || [];
    } catch (e) {
      console.error('AnswerHunter: Erro na busca:', e);
      return [];
    }
  }

  // === EXTRACTION LOGIC ===
  // === EXTRAIR RESPOSTAS DOS RESULTADOS DE BUSCA ===
// === VERIFICAR CORRESPONDENCIA ENTRE QUESTAO E FONTE ===
async function verifyQuestionMatch(originalQuestion, sourceContent) {
    const now = Date.now();
    if (now - lastGroqCallAt < MIN_GROQ_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_GROQ_INTERVAL_MS));
    }
    lastGroqCallAt = Date.now();

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
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'groq/compound',
                messages: [
                    { role: 'system', content: 'Voce verifica se duas questoes sao sobre o mesmo assunto. Responda apenas CORRESPONDE ou NAO_CORRESPONDE.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 20
            })
        });

        if (!response.ok) return true; // Em caso de erro, assume que corresponde
        const data = await response.json();
        const content = data.choices[0]?.message?.content?.trim().toUpperCase() || '';

        console.log('AnswerHunter: Verificacao de correspondencia:', content);
        return content.includes('CORRESPONDE') && !content.includes('NAO_CORRESPONDE');
    } catch (error) {
        console.error('Erro ao verificar correspondencia:', error);
        return true; // Em caso de erro, assume que corresponde
    }
}

// === EXTRACTION LOGIC ===
// === EXTRAIR RESPOSTAS DOS RESULTADOS DE BUSCA ===
async function extractAnswersFromSearch(originalQuestion, searchResults) {
    const answers = [];
    console.log(`AnswerHunter: Debug - Analisando ${searchResults.length} resultados da busca.`);

    // Processar multiplos resultados ate encontrar um que corresponda
    const topResults = searchResults.slice(0, 5); // Aumentar para 5 resultados

    for (const result of topResults) {
        try {
            console.log(`AnswerHunter: Debug - Processando resultado: ${result.title}`);
            const snippet = result.snippet || '';
            const title = result.title || '';
            const fullContent = `${title}. ${snippet}`;

            if (snippet.length < 30) {
                console.log('AnswerHunter: Debug - Snippet muito curto, ignorando.');
                continue;
            }

            // NOVA VERIFICACAO: Checar se a fonte corresponde a mesma questao
            const isMatch = await verifyQuestionMatch(originalQuestion, fullContent);

            if (!isMatch) {
                console.log('AnswerHunter: Debug - Fonte NAO corresponde a questao. Tentando proximo resultado...');
                continue; // Pular para o proximo resultado
            }

            console.log('AnswerHunter: Debug - Fonte CORRESPONDE a questao!');

            // Usar Groq para analisar o snippet
            const refined = await refineWithGroq({
                question: originalQuestion,
                answer: fullContent
            });

            if (refined) {
                console.log('AnswerHunter: Debug - Resposta encontrada:', refined);
                refined.source = result.link;
                answers.push(refined);
                break; // Pegar so a primeira resposta valida
            }
        } catch (e) {
            console.error('Erro ao processar resultado:', e);
        }
    }

    // Se nenhum resultado correspondeu, avisar o usuario
    if (answers.length === 0) {
        console.log('AnswerHunter: Nenhum resultado correspondente encontrado.');
    }

    return answers;
}


// === REFINAR COM GROQ - 3 PROMPTS SEPARADOS ===

// Prompt 1: Extrair apenas as OPCOES do conteudo das fontes
async function extractOptionsFromSource(sourceContent) {
    const now = Date.now();
    if (now - lastGroqCallAt < MIN_GROQ_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_GROQ_INTERVAL_MS));
    }
    lastGroqCallAt = Date.now();

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
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'groq/compound',
                messages: [
                    { role: 'system', content: 'Voce extrai apenas alternativas de questoes. Responda APENAS com as alternativas no formato A) B) C) D) E) ou SEM_OPCOES.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 500
            })
        });

        if (!response.ok) return null;
        const data = await response.json();
        const content = data.choices[0]?.message?.content?.trim() || '';

        if (content.includes('SEM_OPCOES')) return null;
        return content;
    } catch (error) {
        console.error('Erro ao extrair opcoes:', error);
        return null;
    }
}

// Prompt 2: Identificar a RESPOSTA CORRETA do conteudo das fontes
async function extractAnswerFromSource(originalQuestion, sourceContent) {
    const now = Date.now();
    if (now - lastGroqCallAt < MIN_GROQ_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_GROQ_INTERVAL_MS));
    }
    lastGroqCallAt = Date.now();

    const prompt = `Voce deve identificar APENAS a RESPOSTA CORRETA para a questao abaixo, baseado no conteudo da fonte.

=== QUESTAO DO CLIENTE ===
${originalQuestion}

=== CONTEUDO DA FONTE ===
${sourceContent}

REGRAS CRITICAS:
1. Procure por indicacoes como: "Gab", "Gabarito", "Resposta correta", "alternativa correta e", "A resposta e"
2. Para questoes de multipla escolha: responda APENAS a LETRA (A, B, C, D ou E) seguida do texto
3. Para assercoes (I, II, III): identifique quais estao corretas
4. Para questoes abertas: responda o conteudo da resposta
5. NUNCA invente uma resposta - extraia apenas o que esta indicado na fonte
6. Se nao encontrar resposta clara, responda: SEM_RESPOSTA

FORMATO DE SAIDA:
[Apenas a resposta, ex: "Alternativa B: texto" ou "I e III estao corretas" ou resposta direta]`;

    try {
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'groq/compound',
                messages: [
                    { role: 'system', content: 'Voce identifica a resposta correta de questoes. Procure por indicacoes de gabarito. Responda APENAS a resposta encontrada, nunca invente.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 300
            })
        });

        if (!response.ok) return null;
        const data = await response.json();
        const content = data.choices[0]?.message?.content?.trim() || '';

        if (content.includes('SEM_RESPOSTA') || content.includes('INVALIDO')) return null;
        return content;
    } catch (error) {
        console.error('Erro ao extrair resposta:', error);
        return null;
    }
}

// Funcao principal que combina os 3 prompts
async function refineWithGroq(item, retryCount = 0) {
    console.log('AnswerHunter: Iniciando refinamento com 3 prompts...');

    // PROMPT 1: O enunciado SEMPRE vem do site do cliente (item.question)
    // Nao alteramos o enunciado original capturado
    const originalQuestion = item.question;
    console.log('AnswerHunter: Enunciado original preservado:', originalQuestion?.substring(0, 100));

    // PROMPT 2: Extrair opcoes das fontes (se necessario)
    let options = null;
    if (item.answer && item.answer.length > 30) {
        options = await extractOptionsFromSource(item.answer);
        console.log('AnswerHunter: Opcoes extraidas:', options ? 'Sim' : 'Nao');
    }

    // PROMPT 3: Identificar a resposta correta
    const answer = await extractAnswerFromSource(originalQuestion, item.answer);
    console.log('AnswerHunter: Resposta identificada:', answer ? 'Sim' : 'Nao');

    if (!answer) {
        console.log('AnswerHunter: Nao foi possivel identificar a resposta.');
        return null;
    }

    // Montar o resultado final
    // O enunciado e SEMPRE o original do site do cliente
    let finalQuestion = originalQuestion;

    // Se nao temos opcoes no enunciado original mas encontramos nas fontes, adicionamos
    const hasOptionsInOriginal = /[A-E]\s*[\)\.]\s*\S+/i.test(originalQuestion);
    if (!hasOptionsInOriginal && options) {
        finalQuestion = originalQuestion + '\n' + options;
    }

    return {
        question: finalQuestion.trim(),
        answer: answer.trim()
    };
}



  function parseAIResponse(content) {
    const lines = content.split('\n').filter(l => l.trim());

    let question = '';
    let answer = '';
    let inQuestion = false;

    for (const line of lines) {
      if (line.startsWith('PERGUNTA:')) {
        question = line.replace('PERGUNTA:', '').trim();
        inQuestion = true;
      } else if (line.startsWith('RESPOSTA:')) {
        answer = line.replace('RESPOSTA:', '').trim();
        inQuestion = false;
      } else if (line.match(/^[A-E]\)/)) {
        question += '\n' + line;
      } else if (inQuestion && question) {
        question += ' ' + line;
      }
    }

    if (!question || !answer) {
      return null;
    }

    return { question: question.trim(), answer: answer.trim() };
  }

  // === COPIAR ===
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (refinedData.length === 0) return;
      const text = refinedData.map((item, i) =>
        `Q${i + 1}: ${item.question}\nR: ${item.answer}\nLink: ${item.source || ''}`
      ).join('\n\n');
      navigator.clipboard.writeText(text);
      showStatus('success', 'Copiado!');
    });
  }

  // === UTILS ===
  function showStatus(type, message) {
    if (!statusDiv) return;
    statusDiv.className = `status ${type}`;

    let icon = 'info';
    if (type === 'success') icon = 'check_circle';
    if (type === 'error') icon = 'error';
    if (type === 'loading') icon = 'progress_activity';

    const spinClass = type === 'loading' ? 'spin-loading' : '';

    statusDiv.innerHTML = `<span class="material-symbols-rounded ${spinClass}" style="vertical-align:middle;margin-right:4px">${icon}</span> ${message}`;
  }

  // === TABS & BINDER ===
  const tabs = document.querySelectorAll('.tab-btn');
  const sections = document.querySelectorAll('.view-section');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      sections.forEach(s => s.classList.remove('active'));
      document.getElementById(`view-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'binder' && window.binderManager) window.binderManager.init();
    });
  });

  // === CLEAR BINDER ===
  const clearBtn = document.getElementById('clearBinderBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (window.binderManager) window.binderManager.clearAll();
    });
  }

  // Init binder to ensure data is loaded for checks
  if (window.binderManager) window.binderManager.init();

  // === DISPLAY ===
  function displayResults(data) {
    if (!resultsDiv) return;
    if (data.length === 0) {
      resultsDiv.innerHTML = '<div class="placeholder"><p>Nada encontrado.</p></div>';
      return;
    }

    resultsDiv.innerHTML = data.map((item, index) => {
      const isSaved = window.binderManager && window.binderManager.isSaved(item.question);
      const savedClass = isSaved ? 'saved filled' : '';
      const iconText = isSaved ? 'bookmark' : 'bookmark_border';

      // Formatar questão separando enunciado das alternativas
      const formattedQuestion = formatQuestionText(item.question);

      return `
            <div class="qa-item">
               <div class="qa-actions" style="position: absolute; top: 10px; right: 10px; z-index: 10;">
                   <button class="action-btn save-btn material-symbols-rounded ${savedClass}" data-index="${index}" title="Salvar">${iconText}</button>
               </div>
               <div class="question-header">
                  <span class="material-symbols-rounded question-icon">help</span>
                  <span class="header-title">QUestão</span>
               </div>
               <div class="question-content">
                  ${formattedQuestion}
               </div>
               <div class="answer-header">
                  <span class="material-symbols-rounded answer-icon">check_circle</span>
                  <span class="header-title">RESPOSTA CORRETA</span>
               </div>
               <div class="answer">${escapeHtml(item.answer)}</div>
               ${item.source ? `<div class="source"><a href="${item.source}" target="_blank"><span class="material-symbols-rounded" style="font-size: 14px;">link</span> Ver fonte</a></div>` : ''}
            </div>
        `;
    }).join('');

    // Event Delegation para o botéo Salvar
    resultsDiv.onclick = (e) => {
      const btn = e.target.closest('.save-btn');
      if (btn) {
        saveItem(btn);
      }
    };
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // Funçéo para formatar questão separando enunciado das alternativas
  function formatQuestionText(text) {
    if (!text) return '';

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const normalized = (text || '').replace(/\r\n/g, '\n');

    const render = (enunciado, alternatives) => {
      const formattedAlternatives = alternatives
        .map(a => `
          <div class="alternative">
            <span class="alt-letter">${escapeHtml(a.letter)}</span>
            <span class="alt-text">${escapeHtml(a.body)}</span>
          </div>
        `)
        .join('');
      return `
        <div class="question-enunciado">${escapeHtml(enunciado)}</div>
        <div class="question-alternatives">${formattedAlternatives}</div>
      `;
    };

    const parseByLines = (raw) => {
      const lines = raw.split(/\n+/).map(line => line.trim()).filter(Boolean);
      const alternatives = [];
      const enunciadoParts = [];
      let currentAlt = null;
      const altStartRe = /^([A-E])\s*[\)\.\-:]\s*(.+)$/i;

      for (const line of lines) {
        const m = line.match(altStartRe);
        if (m) {
          if (currentAlt) alternatives.push(currentAlt);
          currentAlt = { letter: m[1].toUpperCase(), body: clean(m[2]) };
        } else if (currentAlt) {
          currentAlt.body = clean(`${currentAlt.body} ${line}`);
        } else {
          enunciadoParts.push(line);
        }
      }

      if (currentAlt) alternatives.push(currentAlt);

      return { enunciado: clean(enunciadoParts.join(' ')), alternatives };
    };

    const parsedByLines = parseByLines(normalized);
    if (parsedByLines.alternatives.length >= 2) {
      return render(parsedByLines.enunciado, parsedByLines.alternatives);
    }

    // Fallback para alternativas em linha unica (evita falsos positivos como "software)")
    const inlinePattern = /(^|[\s])([A-E])\s*[\)\.\-:]\s*([^]*?)(?=(?:\s)[A-E]\s*[\)\.\-:]|$)/gi;
    const alternatives = [];
    let firstIndex = null;
    let m;

    while ((m = inlinePattern.exec(normalized)) !== null) {
      if (firstIndex === null) firstIndex = m.index + m[1].length;
      const letter = m[2].toUpperCase();
      const body = clean(m[3]);
      if (body) alternatives.push({ letter, body });
    }

    if (alternatives.length >= 2) {
      const enunciado = firstIndex !== null ? clean(normalized.substring(0, firstIndex)) : '';
      return render(enunciado, alternatives);
    }

    // Fallback extra: alternativas sem pontuação (ex: "A Texto. B Texto.")
    const plainAltPattern = /(?:^|[.!?]\s+)([A-E])\s+([A-ZÀ-Ú][^]*?)(?=(?:[.!?]\s+)[A-E]\s+[A-ZÀ-Ú]|$)/g;
    const plainAlternatives = [];
    let plainFirstIndex = null;
    let pm;

    while ((pm = plainAltPattern.exec(normalized)) !== null) {
      if (plainFirstIndex === null) plainFirstIndex = pm.index;
      const letter = pm[1].toUpperCase();
      const body = clean(pm[2].replace(/\s+[.!?]\s*$/, ''));
      if (body) plainAlternatives.push({ letter, body });
    }

    if (plainAlternatives.length >= 2) {
      const enunciado = plainFirstIndex !== null ? clean(normalized.substring(0, plainFirstIndex)) : '';
      return render(enunciado, plainAlternatives);
    }

    return `<div class="question-enunciado">${escapeHtml(clean(normalized))}</div>`;
  }
});

// ==========================================
// === FUNé‡é•ES INJETADAS (CONTENTSCRIPT) ===
// ==========================================

// 1. Extrair Pergunta e Resposta (Completo/Robusto)
function extractQAContent() {
  const results = [];

  const selectors = {
    questions: [
      '[class*="question"]',
      '[class*="pergunta"]',
      '[class*="titulo"]',
      '[class*="title"]',
      '[class*="ask"]',
      '[data-question]',
      '.question-text',
      '.question-title',
      '.question-content',
      'h1', 'h2', 'h3',
      '[itemprop="name"]',
      '[itemprop="text"]'
    ],
    answers: [
      '[class*="answer"]',
      '[class*="resposta"]',
      '[class*="solution"]',
      '[class*="solucao"]',
      '[class*="reply"]',
      '[data-answer]',
      '.answer-text',
      '.answer-content',
      '.best-answer',
      '[itemprop="acceptedAnswer"]',
      '[itemprop="suggestedAnswer"]'
    ]
  };

  function cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim()
      .substring(0, 3000);
  }

  function isVisible(el) {
    return el.offsetParent !== null &&
      getComputedStyle(el).display !== 'none' &&
      getComputedStyle(el).visibility !== 'hidden';
  }

  const qaContainers = document.querySelectorAll(
    '[class*="qa"], [class*="question-answer"], [class*="pergunta-resposta"], ' +
    '[class*="card"], [class*="post"], [class*="item"], article, section'
  );

  qaContainers.forEach(container => {
    if (!isVisible(container)) return;

    let question = '';
    let answer = '';

    for (const selector of selectors.questions) {
      const el = container.querySelector(selector);
      if (el && isVisible(el)) {
        const text = cleanText(el.innerText);
        if (text.length > 10 && text.length > question.length) {
          question = text;
        }
      }
    }

    for (const selector of selectors.answers) {
      const el = container.querySelector(selector);
      if (el && isVisible(el)) {
        const text = cleanText(el.innerText);
        if (text.length > 10 && text.length > answer.length) {
          answer = text;
        }
      }
    }

    if (question && answer && question !== answer) {
      const exists = results.some(r =>
        r.question === question || r.answer === answer
      );
      if (!exists) {
        results.push({ question, answer });
      }
    }
  });

  if (results.length === 0) {
    const allText = document.body.innerText;
    const questionPatterns = allText.match(/[^.!?\n]+\?/g) || [];

    questionPatterns.forEach(q => {
      const cleanQ = cleanText(q);
      if (cleanQ.length > 20 && cleanQ.length < 500) {
        const qIndex = allText.indexOf(q);
        const afterQ = allText.substring(qIndex + q.length, qIndex + q.length + 2000);
        const possibleAnswer = afterQ.split(/\n\n/)[0];

        if (possibleAnswer && possibleAnswer.length > 20) {
          results.push({
            question: cleanQ,
            answer: cleanText(possibleAnswer)
          });
        }
      }
    });
  }

  const schemaQA = document.querySelectorAll('[itemtype*="Question"], [itemtype*="Answer"]');
  schemaQA.forEach(el => {
    const name = el.querySelector('[itemprop="name"], [itemprop="text"]');
    const answer = el.querySelector('[itemprop="acceptedAnswer"] [itemprop="text"]');

    if (name && answer) {
      results.push({
        question: cleanText(name.innerText),
        answer: cleanText(answer.innerText)
      });
    }
  });

  const uniqueResults = [];
  const seen = new Set();

  for (const item of results) {
    const key = item.question.substring(0, 50);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueResults.push(item);
    }
  }

  return uniqueResults.slice(0, 10);
}

// === FUNÇéO PARA EXTRAIR APENAS A PERGUNTA (SITES PROTEGIDOS) ===
// V19 - Foco em seletores do DOM, sem ler texto global/iframes
// === FUNÇéO PARA EXTRAIR APENAS A PERGUNTA (SITES PROTEGIDOS) ===
// V19 - Foco em seletores do DOM, sem ler texto global/iframes
function extractQuestionOnly() {
  console.log('AnswerHunter: Iniciando extracao (v19 - DOM only)...');

  function cleanText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeQuestionText(text) {
    if (!text) return '';
    let cleaned = cleanText(text);
    cleaned = cleaned.replace(/\bMarcar para revis(?:a|ã)o\b/gi, '');
    cleaned = cleaned.replace(/^\s*\d+\s*[-.)]?\s*/i, '');
    cleaned = cleaned.replace(/^(?:Quest(?:a|ã)o|Questao)\s*\d+\s*[:.\-]?\s*/i, '');
    cleaned = cleaned.replace(/^Atividade\s*\d+\s*[:.\-]?\s*/i, '');
    return cleaned.trim();
  }

  function isOnScreen(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return rect.width > 30 && rect.height > 15 &&
      rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;
  }

  function getVisibleArea(rect) {
    const left = Math.max(0, rect.left);
    const right = Math.min(window.innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    return width * height;
  }

  function getVisibilityRatio(rect) {
    const area = rect.width * rect.height;
    if (area <= 0) return 0;
    return getVisibleArea(rect) / area;
  }

  function pickMostVisible(elements) {
    let best = null;
    let bestArea = 0;
    for (const el of elements) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const area = getVisibleArea(rect);
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }

  function buildFromActivitySection(sectionEl) {
    if (!sectionEl) return null;

    const headerNodes = Array.from(sectionEl.querySelectorAll('[data-testid="openResponseQuestionHeader"]'));
    const visibleHeaders = headerNodes.filter(isOnScreen);
    let questionContainer = pickMostVisible(visibleHeaders);
    if (!questionContainer && headerNodes.length > 0) {
      questionContainer = headerNodes[headerNodes.length - 1];
    }
    let questionText = '';

    if (questionContainer) {
      const parts = Array.from(questionContainer.querySelectorAll('p'))
        .map(p => p.innerText)
        .filter(Boolean);
      questionText = sanitizeQuestionText(parts.join(' '));
    } else {
      const questionEl = sectionEl.querySelector('[data-testid="openResponseQuestionHeader"] p p') ||
        sectionEl.querySelector('[data-testid="openResponseQuestionHeader"] p');
      questionText = questionEl ? sanitizeQuestionText(questionEl.innerText) : '';
    }

    let optionScope = questionContainer || sectionEl;
    while (optionScope && optionScope !== sectionEl) {
      if (optionScope.querySelectorAll('button[type="submit"]').length >= 2) break;
      optionScope = optionScope.parentElement;
    }
    if (!optionScope) optionScope = sectionEl;

    if (!questionText) {
      const looseParts = Array.from(optionScope.querySelectorAll('p'))
        .filter(p => !p.closest('button'))
        .map(p => p.innerText)
        .filter(Boolean);
      questionText = sanitizeQuestionText(looseParts.slice(0, 3).join(' '));
    }

    const optionButtons = optionScope.querySelectorAll('button[type="submit"]');
    const options = [];

    optionButtons.forEach((btn) => {
      const letterRaw = btn.querySelector('strong[aria-label]')?.getAttribute('aria-label') || '';
      const letter = letterRaw.toUpperCase();
      const optionTextEl = btn.querySelector('div.text-neutral-dark-low p') || btn.querySelector('p');
      const optionText = optionTextEl ? cleanText(optionTextEl.innerText) : '';
      if (letter && optionText) {
        options.push(`${letter}) ${optionText}`);
        return;
      }
      const fallbackText = cleanText(btn.innerText || '');
      const match = fallbackText.match(/^\s*([A-E])\s*[).:-]?\s*(.+)$/i);
      if (match) {
        options.push(`${match[1].toUpperCase()}) ${match[2].trim()}`);
      }
    });

    if (!questionText) return null;

    const text = options.length >= 2
      ? `${questionText}\n${options.join('\n')}`
      : questionText;

    const anchorCandidates = [];
    if (questionContainer) anchorCandidates.push(questionContainer);
    if (optionButtons[0]) anchorCandidates.push(optionButtons[0]);
    if (optionButtons.length > 1) anchorCandidates.push(optionButtons[optionButtons.length - 1]);
    const anchorEl = pickMostVisible(anchorCandidates) || sectionEl;

    return {
      text: text.substring(0, 3500),
      optionCount: options.length,
      questionLength: questionText.length,
      anchorRect: anchorEl.getBoundingClientRect()
    };
  }

  // 1) Estrutura específica do site (data-section)
  const activitySections = Array.from(document.querySelectorAll('[data-section="section_cms-atividade"]'));
  const visibleSections = activitySections.filter(isOnScreen);

  // 1) Tentar usar o botao "Marcar para revisao" como ancora (mais preciso)
  const reviewButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter(btn => isOnScreen(btn))
    .filter(btn => /Marcar para revis[aé]o/i.test((btn.innerText || btn.textContent || '')));

  if (reviewButtons.length > 0) {
    reviewButtons.sort((a, b) => {
      const topA = Math.abs(a.getBoundingClientRect().top);
      const topB = Math.abs(b.getBoundingClientRect().top);
      return topA - topB;
    });
    const anchored = reviewButtons[0].closest('[data-section="section_cms-atividade"]');
    if (anchored) {
      const anchoredRect = anchored.getBoundingClientRect();
      const anchoredVisibility = getVisibilityRatio(anchoredRect);
      const built = buildFromActivitySection(anchored);
      if (built && anchoredVisibility >= 0.3) {
        console.log('AnswerHunter: Encontrado via botao Marcar para revisao.');
        return built.text;
      }
    }
  }

  // 2) Usar pontos de ancoragem no viewport (mais preciso)
  const probeX = Math.floor(window.innerWidth * 0.5);
  const probeYs = [
    Math.floor(window.innerHeight * 0.3),
    Math.floor(window.innerHeight * 0.5),
    Math.floor(window.innerHeight * 0.7)
  ];
  const hitCount = new Map();

  for (const y of probeYs) {
    const elAtPoint = document.elementFromPoint(probeX, y);
    if (!elAtPoint) continue;
    const anchored = elAtPoint.closest('[data-section="section_cms-atividade"]');
    if (anchored) {
      hitCount.set(anchored, (hitCount.get(anchored) || 0) + 1);
    }
  }

  if (hitCount.size > 0) {
    let bestSection = null;
    let bestHits = 0;
    hitCount.forEach((hits, section) => {
      if (hits > bestHits) {
        bestHits = hits;
        bestSection = section;
      }
    });

    if (bestSection && bestHits >= 2) {
      const built = buildFromActivitySection(bestSection);
      if (built) {
        console.log('AnswerHunter: Encontrado via elementFromPoint (ancora multipla).');
        return built.text;
      }
    }
  }

  // 3) Fallback: escolher pelo maior bloco visível e topo mais próximo
  const sectionsToScore = visibleSections.length > 0 ? visibleSections : activitySections;
  const scoredCandidates = [];

  const viewportCenter = window.innerHeight / 2;
  for (const section of sectionsToScore) {
    const built = buildFromActivitySection(section);
    if (!built) continue;
    const rect = built.anchorRect || section.getBoundingClientRect();
    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const visibilityRatio = rect.height > 0 ? (visibleHeight / rect.height) : 0;
    const sectionCenter = rect.top + rect.height / 2;
    const distanceFromCenter = Math.abs(sectionCenter - viewportCenter);
    const isCentered = distanceFromCenter <= window.innerHeight * 0.25;
    const isMostlyVisible = visibilityRatio >= 0.6;
    const score =
      (built.optionCount * 10) +
      (built.questionLength > 30 ? 5 : 0) +
      (visibleHeight * 0.6) +
      (visibilityRatio * 120) -
      (distanceFromCenter * 0.2) +
      (isCentered ? 40 : 0) +
      (isMostlyVisible ? 30 : 0);

    scoredCandidates.push({ text: built.text, score, rect, visibleHeight });
  }

  if (scoredCandidates.length > 0) {
    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const topA = Math.abs(a.rect.top);
      const topB = Math.abs(b.rect.top);
      return topA - topB;
    });
    console.log('AnswerHunter: Encontrado via section_cms-atividade (visibilidade).');
    return scoredCandidates[0].text;
  }

  // 2) Header específico da questão
  const questionHeader = document.querySelector('[data-testid="openResponseQuestionHeader"]');
  if (questionHeader) {
    const parent = questionHeader.closest('[data-section]') || questionHeader.parentElement;
    const built = buildFromActivitySection(parent || questionHeader);
    if (built) {
      console.log('AnswerHunter: Encontrado via openResponseQuestionHeader.');
      return built.text;
    }
  }

  // 3) Seleçéo manual (se houver)
  const selection = window.getSelection ? window.getSelection().toString() : '';
  if (selection && selection.trim().length > 5) {
    console.log('AnswerHunter: Usando selecao manual.');
    return sanitizeQuestionText(selection).substring(0, 3500);
  }

  // 4) Fallback mínimo (sem texto global)
  const containers = document.querySelectorAll('main, article, section, div, form');
  let best = { score: -999, text: '' };

  function scoreContainer(el) {
    if (!isOnScreen(el)) return null;
    const text = cleanText(el.innerText || '');
    if (text.length < 30 || text.length > 6000) return null;
    const rect = el.getBoundingClientRect();
    let score = 0;

    if (text.includes('?')) score += 6;
    if (/Atividade|Quest|Exercicio|Pergunta|Enunciado/i.test(text)) score += 4;
    if (/[A-E]\)\s+|[A-E]\.\s+/i.test(text)) score += 4;
    if (el.querySelectorAll('button[type="submit"]').length >= 2) score += 4;
    if (rect.top >= 0 && rect.top < 350) score += 2;

    // Penalizar menus/sidebars
    if (/menu|disciplina|progresso|conteudos|concluidos|simulados|acessar|ola\b/i.test(text)) score -= 8;
    if (rect.width < window.innerWidth * 0.35) score -= 4;
    if (rect.left > window.innerWidth * 0.55) score -= 3;

    return { score, text };
  }

  containers.forEach((el) => {
    const candidate = scoreContainer(el);
    if (candidate && candidate.score > best.score) best = candidate;
  });

  if (best.text) {
    console.log('AnswerHunter: Fallback heuristico usado.');
    return sanitizeQuestionText(best.text).substring(0, 3500);
  }

  console.log('AnswerHunter: Nenhuma questao encontrada.');
  return '';
}
window.binderManager = {
  data: [], // Estrutura em é¡rvore
  currentFolderId: 'root', // Pasta atual visé­vel
  draggedItem: null, // Item sendo arrastado

  init() {
    console.log('AnswerHunter: Inicializando binderManager...');
    chrome.storage.local.get(['binderStructure'], (result) => {
      console.log('AnswerHunter: Dados carregados do storage:', result);
      if (result.binderStructure && Array.isArray(result.binderStructure) && result.binderStructure.length > 0) {
        this.data = result.binderStructure;
        console.log('AnswerHunter: Estrutura carregada com sucesso. Items:', this.countItems(this.data));
        this.render();
      } else {
        console.log('AnswerHunter: Inicializando estrutura vazia');
        this.data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
        this.save();
        this.render();
      }
    });
  },

  save() {
    console.log('AnswerHunter: Salvando estrutura... Items:', this.countItems(this.data));
    chrome.storage.local.set({ binderStructure: this.data }, () => {
      if (chrome.runtime.lastError) {
        console.error('AnswerHunter: Erro ao salvar:', chrome.runtime.lastError);
      } else {
        console.log('AnswerHunter: Dados salvos com sucesso!');
        // Verificar imediatamente se foi salvo
        chrome.storage.local.get(['binderStructure'], (result) => {
          console.log('AnswerHunter: Verificação pós-save:', result.binderStructure ? 'Dados confirmados' : 'ERRO: Dados não encontrados!');
        });
      }
    });
  },

  countItems(nodes = this.data) {
    let count = 0;
    for (const node of nodes) {
      if (node.type === 'question') count++;
      if (node.children) count += this.countItems(node.children);
    }
    return count;
  },

  findNode(id, nodes = this.data) {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.type === 'folder' && node.children) {
        const found = this.findNode(id, node.children);
        if (found) return found;
      }
    }
    return null;
  },

  createFolder() {
    const name = prompt("Nome da nova pasta:");
    if (name) {
      const current = this.findNode(this.currentFolderId);
      if (current) {
        current.children.push({ id: 'f' + Date.now(), type: 'folder', title: name, children: [], createdAt: Date.now() });
        this.save(); this.render();
      }
    }
  },

  addItem(question, answer, source) {
    const current = this.findNode(this.currentFolderId);
    if (current) {
      current.children.push({
        id: 'q' + Date.now(),
        type: 'question',
        content: { question, answer, source },
        createdAt: Date.now()
      });
      this.save();
      this.render();
    }
  },

  moveItem(itemId, targetFolderId) {
    // Helper para remover item de qualquer lugar na é¡rvore
    const removeFromTree = (nodes, id) => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) {
          return nodes.splice(i, 1)[0];
        }
        if (nodes[i].children) {
          const found = removeFromTree(nodes[i].children, id);
          if (found) return found;
        }
      }
      return null;
    };

    // Previne mover uma pasta para dentro dela mesma (bé¡sico)
    if (itemId === targetFolderId) return;

    const itemNode = removeFromTree(this.data, itemId);
    if (itemNode) {
      const targetFolder = this.findNode(targetFolderId);
      if (targetFolder) {
        targetFolder.children.push(itemNode);
        this.save();
        this.render();
      } else {
        // Se falhar (ex: target não existe), recarrega para restaurar
        this.init();
      }
    }
  },

  navigateTo(id) {
    this.currentFolderId = id;
    this.render();
  },

  deleteNode(id) {
    if (!confirm('Deseja realmente excluir este item?')) return;

    const removeFromTree = (nodes, id) => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) {
          nodes.splice(i, 1);
          return true;
        }
        if (nodes[i].children) {
          if (removeFromTree(nodes[i].children, id)) return true;
        }
      }
      return false;
    };

    if (removeFromTree(this.data, id)) {
      this.save();
      this.render();
      // Atualizar é­cones de salvo na busca se necessé¡rio
      const activeTab = document.querySelector('.tab-btn.active');
      if (activeTab && activeTab.dataset.tab === 'search') {
        // Re-render search results handled poorly but ok for now
      }
    }
  },

  clearAll() {
    if (confirm('Tem certeza que deseja apagar TODO o fiché¡rio? Esta ação é© irreversé­vel.')) {
      this.data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
      this.currentFolderId = 'root';
      this.save();
      this.render();
      // Atualizar UI de busca
      document.querySelectorAll('.save-btn').forEach(btn => {
        btn.classList.remove('saved', 'filled');
        btn.textContent = 'bookmark_border';
      });
    }
  },

  isSaved(questionText) {
    const search = (nodes) => {
      for (const node of nodes) {
        if (node.type === 'question' && node.content && node.content.question === questionText) return true;
        if (node.children) {
          if (search(node.children)) return true;
        }
      }
      return false;
    };
    return search(this.data);
  },

  removeByContent(questionText) {
    const removeFromTree = (nodes) => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].type === 'question' && nodes[i].content && nodes[i].content.question === questionText) {
          nodes.splice(i, 1);
          return true;
        }
        if (nodes[i].children) {
          if (removeFromTree(nodes[i].children)) return true;
        }
      }
      return false;
    };
    if (removeFromTree(this.data)) {
      this.save();
      this.render();
      return true;
    }
    return false;
  },

  render() {
    const container = document.getElementById('binder-list');
    if (!container) return;

    const folder = this.findNode(this.currentFolderId) || this.data[0];

    // Toolbar
    let html = `<div class="binder-toolbar">
            <span class="crumb-current"><span class="material-symbols-rounded" style="font-size:18px">folder_open</span> ${folder.title}</span>
            <div class="toolbar-actions">
               ${folder.id !== 'root' ? `<button id="btnBackRoot" class="btn-text"><span class="material-symbols-rounded" style="font-size:16px">arrow_back</span> Voltar</button>` : ''}
               <button id="newFolderBtnBinder" class="btn-text">+ Pasta</button>
            </div>
        </div>`;

    html += `<div class="binder-content">`;

    folder.children.forEach(item => {
      if (item.type === 'folder') {
        html += `<div class="folder-item drop-zone" draggable="true" data-id="${item.id}" data-type="folder">
                    <div style="display:flex;align-items:center;gap:8px;pointer-events:none">
                       <span class="material-symbols-rounded">folder</span> ${item.title}
                    </div>
                    <button class="action-btn delete-btn" data-id="${item.id}" title="Excluir"><span class="material-symbols-rounded" style="font-size:18px">delete</span></button>
                </div>`;
      } else {
        const questionPreview = item.content.question.length > 50 
          ? item.content.question.substring(0, 50) + '...' 
          : item.content.question;
        const savedDate = item.createdAt ? new Date(item.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
        
        html += `<div class="qa-item expandable" draggable="true" data-id="${item.id}" data-type="question">
                    <div class="summary-view">
                        <div class="summary-icon">
                            <span class="material-symbols-rounded">quiz</span>
                        </div>
                        <div class="summary-content">
                            <div class="summary-title">${questionPreview}</div>
                            <div class="summary-meta">
                                <span class="material-symbols-rounded">schedule</span>
                                ${savedDate || 'Salvo'}
                            </div>
                        </div>
                        <span class="material-symbols-rounded expand-indicator">expand_more</span>
                    </div>
                    <div class="full-view" style="display:none">
                        <div class="full-question">
                            <div class="full-question-label">
                                <span class="material-symbols-rounded" style="font-size:14px">help_outline</span>
                                Questão
                            </div>
                            <div class="full-question-text">${item.content.question}</div>
                        </div>
                        <div class="full-answer">
                            <div class="full-answer-label">
                                <span class="material-symbols-rounded" style="font-size:14px">check_circle</span>
                                Resposta Correta
                            </div>
                            <div class="full-answer-text">${item.content.answer}</div>
                        </div>
                        <div class="full-actions">
                            <button class="action-btn copy-single-btn" data-id="${item.id}" title="Copiar">
                                <span class="material-symbols-rounded" style="font-size:16px">content_copy</span>
                                Copiar
                            </button>
                            <button class="action-btn delete-btn" data-id="${item.id}" title="Excluir">
                                <span class="material-symbols-rounded" style="font-size:16px">delete</span>
                                Excluir
                            </button>
                        </div>
                    </div>
                </div>`;
      }
    });

    html += `</div>`;
    container.innerHTML = html;

    // Listeners UI
    const btnNew = document.getElementById('newFolderBtnBinder');
    if (btnNew) btnNew.onclick = () => this.createFolder();

    const btnBack = document.getElementById('btnBackRoot');
    if (btnBack) btnBack.onclick = () => this.navigateTo('root');

    const btnClearAll = document.getElementById('clearBinderBtn');
    if (btnClearAll) btnClearAll.onclick = () => this.clearAll();

    // Drag & Drop Listeners
    const items = container.querySelectorAll('[draggable="true"]');
    items.forEach(el => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', el.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
        this.draggedItem = el.dataset.id;
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        this.draggedItem = null;
        // Limpar destaques
        container.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
      });
    });

    const folders = container.querySelectorAll('.folder-item');
    folders.forEach(el => {
      el.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessé¡rio para permitir o drop
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over');
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const itemId = e.dataTransfer.getData('text/plain');
        const targetId = el.dataset.id;

        if (itemId && targetId && itemId !== targetId) {
          this.moveItem(itemId, targetId);
        }
      });
    });

    // Delegation for Click (Navigation, Expand, Delete, Copy)
    const contentDiv = container.querySelector('.binder-content');
    if (contentDiv) {
      contentDiv.onclick = (e) => {
        // Click Delete
        const delBtn = e.target.closest('.delete-btn');
        if (delBtn) {
          e.stopPropagation();
          this.deleteNode(delBtn.dataset.id);
          return;
        }

        // Click Copy
        const copyBtn = e.target.closest('.copy-single-btn');
        if (copyBtn) {
          e.stopPropagation();
          const itemId = copyBtn.dataset.id;
          const item = this.findNode(itemId);
          if (item && item.content) {
            const text = `Questão: ${item.content.question}\n\nResposta: ${item.content.answer}`;
            navigator.clipboard.writeText(text).then(() => {
              // Feedback visual
              const icon = copyBtn.querySelector('.material-symbols-rounded');
              const originalText = icon.nextSibling.textContent;
              icon.textContent = 'check';
              icon.nextSibling.textContent = ' Copiado!';
              copyBtn.style.background = '#27AE60';
              copyBtn.style.color = '#FFF';
              setTimeout(() => {
                icon.textContent = 'content_copy';
                icon.nextSibling.textContent = originalText;
                copyBtn.style.background = '';
                copyBtn.style.color = '';
              }, 1500);
            });
          }
          return;
        }

        // Click Folder (Navegação)
        const folderItem = e.target.closest('.folder-item');
        if (folderItem) {
          const fid = folderItem.dataset.id;
          this.navigateTo(fid);
          return;
        }

        // Expand Item
        const expandItem = e.target.closest('.qa-item.expandable');
        if (expandItem) {
          expandItem.classList.toggle('expanded');
          const fullView = expandItem.querySelector('.full-view');
          if (fullView) {
            fullView.style.display = fullView.style.display === 'none' ? 'block' : 'none';
          }
        }
      };
    }
  }
};

// Helpers para Save/Delete
window.saveItem = function (btn) {
  const index = btn.dataset.index;
  const item = refinedData[index];

  if (item && window.binderManager) {
    if (btn.classList.contains('saved')) {
      // Desmarcar (Remover)
      if (window.binderManager.removeByContent(item.question)) {
        btn.textContent = 'bookmark_border';
        btn.classList.remove('saved', 'filled');
      }
    } else {
      // Salvar (Adicionar)
      window.binderManager.addItem(item.question, item.answer, item.source);
      // Feedback Visual
      btn.textContent = 'bookmark';
      btn.classList.add('saved', 'filled');
    }
  }
};








