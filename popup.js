// ConfiguraÃ§Ã£o das APIs
const GROQ_API_KEY = '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';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const SERPER_API_KEY = 'feffb9d9843cbe91d25ea499ae460068d5518f45';
const SERPER_API_URL = 'https://google.serper.dev/search';

// Global Data
let refinedData = [];
let lastGroqCallAt = 0;
const MIN_GROQ_INTERVAL_MS = 2500;


document.addEventListener('DOMContentLoaded', () => {
  // Elementos da UI
  const extractBtn = document.getElementById('extractBtn');
  const searchBtn = document.getElementById('searchBtn');
  const copyBtn = document.getElementById('copyBtn');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  // Global variables
  // refinedData is now global


  // === EXTRAIR DA PÃGINA ATUAL ===
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
            showStatus('error', 'Nenhuma pergunta extraÃ­da. Tente selecionar o texto.');
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
          showStatus('error', 'IA nÃ£o encontrou a resposta nos resultados.');
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
  async function extractAnswersFromSearch(originalQuestion, searchResults) {
    const answers = [];
    console.log(`AnswerHunter: Debug - Analisando ${searchResults.length} resultados da busca.`);

    // Processar apenas o primeiro resultado mais relevante para evitar rate limit
    const topResults = searchResults.slice(0, 1);
    for (const result of topResults) {
      try {
        console.log(`AnswerHunter: Debug - Processando resultado: ${result.title}`);
        // Usar o snippet do Google como fonte de resposta
        const snippet = result.snippet || '';
        const title = result.title || '';

        if (snippet.length > 30) {
          // Usar Groq para analisar o snippet
          const refined = await refineWithGroq({
            question: originalQuestion,
            answer: `${title}. ${snippet}`
          });

          if (refined) {
            console.log('AnswerHunter: Debug - Resposta encontrada:', refined);
            refined.source = result.link;
            answers.push(refined);
            break; // Pegar sÃ³ a primeira resposta vÃ¡lida
          } else {
            // Fallback: retornar snippet como resposta quando a IA nÃ£o estiver disponÃ­vel
            console.log('AnswerHunter: Debug - IA indisponÃ­vel. Usando snippet como resposta.');
            answers.push({
              question: originalQuestion,
              answer: `${title}. ${snippet}`,
              source: result.link
            });
            break;
          }
        } else {
          console.log('AnswerHunter: Debug - Snippet muito curto, ignorando.');
        }
      } catch (e) {
        console.error('Erro ao processar resultado:', e);
      }
    }

    return answers;
  }

  // === REFINAR COM GROQ ===
  async function refineWithGroq(item, retryCount = 0) {
    const now = Date.now();
    if (now - lastGroqCallAt < MIN_GROQ_INTERVAL_MS) {
      console.log('AnswerHunter: Aguardando cooldown do Groq.');
      await new Promise(resolve => setTimeout(resolve, MIN_GROQ_INTERVAL_MS));
    }
    lastGroqCallAt = Date.now();

    const prompt = `VocÃª Ã© um especialista em extrair respostas de questÃµes educacionais de sites como Brainly e Passei Direto.

CONTEÃšDO BRUTO EXTRAÃDO DO SITE:

=== ÃREA DA PERGUNTA ===
${item.question}

=== ÃREA DA RESPOSTA ===
${item.answer}

INSTRUÃ‡Ã•ES CRÃTICAS:

1. DETECTE O TIPO DE QUESTÃƒO:
   - MÃºltipla escolha tradicional (A, B, C, D, E)
   - AsserÃ§Ãµes (I, II, III com anÃ¡lise de quais estÃ£o corretas)
   - Verdadeiro/Falso
   - QuestÃ£o aberta

2. ENCONTRE A RESPOSTA CORRETA:
   - Procure por indicaÃ§Ãµes como "Gab", "Gabarito", "Resposta correta", "alternativa correta Ã©"
   - Procure frases como "I e II estÃ£o corretas", "apenas I estÃ¡ correta", etc.
   - A resposta geralmente estÃ¡ na Ã¡rea de resposta, NÃƒO na pergunta

3. IGNORE COMPLETAMENTE:
   - Textos promocionais (Assine, Plus, Premium, desbloqueie)
   - Metadata de usuÃ¡rios (especialista, votos, Ãºtil, respostas)
   - Outras perguntas que aparecem no site
   - Se for APENAS conteÃºdo promocional, responda: INVALIDO

4. FORMATO DE SAÃDA:

Para questÃµes de ASSERÃ‡Ã•ES (I, II, III):
PERGUNTA: [enunciado com as asserÃ§Ãµes]
RESPOSTA: [ex: "I e II estÃ£o corretas" ou "Apenas a asserÃ§Ã£o I Ã© verdadeira"]

Para MÃšLTIPLA ESCOLHA (A, B, C, D, E):
PERGUNTA: [enunciado]
A) [opÃ§Ã£o A]
B) [opÃ§Ã£o B]
C) [opÃ§Ã£o C]
D) [opÃ§Ã£o D]
E) [opÃ§Ã£o E se houver]
RESPOSTA: Alternativa [LETRA]: [texto da alternativa]

Para questÃ£o ABERTA:
PERGUNTA: [pergunta]
RESPOSTA: [resposta direta]

IMPORTANTE: Extraia a resposta que estÃ¡ INDICADA NO SITE, nÃ£o invente uma resposta.`;

    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            {
              role: 'system',
              content: 'VocÃª extrai respostas de sites educacionais como Brainly. Identifique o tipo de questÃ£o (mÃºltipla escolha, asserÃ§Ãµes I/II/III, ou aberta). Procure por indicaÃ§Ãµes de gabarito como "Gab", "I e II estÃ£o corretas", etc. Extraia APENAS a resposta indicada no site, nunca invente. Se for conteÃºdo promocional, responda INVALIDO.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 800
        })
      });

      if (response.status === 429) {
      console.log('AnswerHunter: Rate Limit (429). Pulando Groq e usando fallback.');
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content?.trim() || '';

      console.log('AnswerHunter: Debug - Resposta RAW da IA:', content);

      if (content === 'INVALIDO' || content.includes('INVALIDO')) {
        console.log('AnswerHunter: Debug - IA marcou como INVALIDO');
        return null;
      }

      return parseAIResponse(content);
    } catch (error) {
      console.error('Erro Groq:', error);
      return null;
    }
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

      return `
            <div class="qa-item">
               <div class="qa-actions" style="position: absolute; top: 10px; right: 10px;">
                   <button class="action-btn save-btn material-symbols-rounded ${savedClass}" data-index="${index}" title="Salvar">${iconText}</button>
               </div>
               <div class="question">${escapeHtml(item.question)}</div>
               <div class="answer">${escapeHtml(item.answer)}</div>
               ${item.source ? `<div class="source"><a href="${item.source}" target="_blank">Fonte</a></div>` : ''}
            </div>
        `;
    }).join('');

    // Event Delegation para o botÃ£o Salvar
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
});

// ==========================================
// === FUNÃ‡Ã•ES INJETADAS (CONTENTSCRIPT) ===
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

// === FUNÇÃO PARA EXTRAIR APENAS A PERGUNTA (SITES PROTEGIDOS) ===
// V13 - Detecta questão VISÍVEL na viewport para páginas com múltiplas questões
function extractQuestionOnly() {
  console.log('AnswerHunter: Iniciando extração (v13 - viewport detection)...');

  // Função para obter texto mesmo em sites com proteção de cópia
  function getTextContent(element) {
    if (!element) return '';
    
    // Usar textContent que funciona mesmo com proteção CSS
    let text = '';
    
    // Método 1: textContent direto (ignora CSS user-select: none)
    text = element.textContent || '';
    
    // Método 2: Se vazio, tentar innerText
    if (!text.trim()) {
      text = element.innerText || '';
    }
    
    // Método 3: Iterar nós de texto (para casos extremos)
    if (!text.trim()) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode.textContent);
      }
      text = textNodes.join(' ');
    }
    
    return text.trim();
  }

  // Função para verificar se elemento está visível na viewport
  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    
    // Elemento está visível se pelo menos 30% dele está na tela
    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(windowHeight, rect.bottom);
    const visibleHeight = visibleBottom - visibleTop;
    const elementHeight = rect.bottom - rect.top;
    
    if (elementHeight <= 0) return false;
    
    const visibilityRatio = visibleHeight / elementHeight;
    return visibilityRatio >= 0.3 && visibleTop < windowHeight && rect.bottom > 0;
  }

  // Função para encontrar containers de questões
  function findQuestionContainers() {
    const containers = [];
    
    // Seletores comuns para containers de questões (mais abrangente)
    const selectors = [
      // Containers genéricos de questão
      '[class*="question"]',
      '[class*="questao"]',
      '[class*="atividade"]',
      '[class*="exercicio"]',
      '[class*="item-prova"]',
      '[class*="enunciado"]',
      '[class*="pergunta"]',
      // IDs comuns
      '[id*="question"]',
      '[id*="questao"]',
      // Data attributes
      '[data-question]',
      '[data-questao]',
      // Estácio específico
      '.question-content',
      '.activity-item',
      '.exercise-container',
      '[class*="exercise"]',
      '[class*="quiz"]',
      '[class*="test"]',
      '[class*="prova"]',
      // Elementos com numeração
      '[class*="q-"]',
      '[class*="item-"]',
      // Containers genéricos que podem ter questões
      'article',
      'section',
      '.card',
      '[class*="card"]',
      '[class*="panel"]',
      '[class*="box"]',
      // Divs genéricos maiores
      'main > div',
      '.container > div',
      '.content > div'
    ];
    
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = getTextContent(el);
          // Verificar se parece uma questão (tem ? ou alternativas A-E)
          const hasQuestion = text.includes('?');
          const hasAlternatives = (text.match(/\b[A-E]\b/g) || []).length >= 3;
          if (text.length > 50 && text.length < 5000 && (hasQuestion || hasAlternatives)) {
            // Evitar duplicatas
            if (!containers.some(c => c === el || c.contains(el) || el.contains(c))) {
              containers.push(el);
            }
          }
        });
      } catch (e) {}
    }
    
    // Se não encontrou containers específicos, buscar por padrão de texto
    if (containers.length === 0) {
      console.log('AnswerHunter: Buscando containers por padrão de texto...');
      // Buscar todos os elementos que contêm texto de questão
      const allElements = document.querySelectorAll('div, section, article, li, p');
      allElements.forEach(el => {
        const text = getTextContent(el);
        // Verificar se tem padrão de questão
        const hasQuestionPattern = /\?/.test(text) && (text.match(/\b[A-E]\b/g) || []).length >= 2;
        const hasActivityPattern = /^(Atividade|Questão|Exercício|Pergunta)\s*\d+/im.test(text);
        
        if ((hasQuestionPattern || hasActivityPattern) && text.length > 100 && text.length < 5000) {
          // Verificar se não é apenas um label pequeno
          if (!containers.some(c => c === el || c.contains(el) || el.contains(c))) {
            containers.push(el);
          }
        }
      });
    }
    
    // Ordenar por tamanho (preferir containers menores e mais específicos)
    containers.sort((a, b) => {
      const textA = getTextContent(a).length;
      const textB = getTextContent(b).length;
      return textA - textB;
    });
    
    console.log('AnswerHunter: Containers após filtro:', containers.length);
    return containers;
  }

  // Função para extrair questão de um container
  function extractFromContainer(container) {
    const fullText = getTextContent(container);
    
    // Padrão: "Atividade X" seguido de texto até marcadores de fim
    const activityMatch = fullText.match(/(?:Atividade|Questão|Exercício|Pergunta)\s*\d+\s*\n?([^]*?)(?:\nResponda|\nO que você achou|\nRelatar problema|\nVoltar\s*\n|\nAvançar|$)/i);
    
    if (activityMatch) {
      let questionBlock = activityMatch[0]
        .replace(/\nResponda[\s\S]*$/i, '')
        .replace(/\nO que você achou[\s\S]*$/i, '')
        .replace(/\nRelatar problema[\s\S]*$/i, '')
        .replace(/\nVoltar[\s\S]*$/i, '')
        .replace(/\nAvançar[\s\S]*$/i, '')
        .trim();
      
      if (questionBlock.length > 50) {
        return questionBlock;
      }
    }
    
    // Se não encontrou padrão específico, retornar texto limpo
    if (fullText.includes('?') && fullText.length > 50) {
      return fullText.split(/\n{3,}/)[0].trim(); // Primeiro bloco
    }
    
    return '';
  }

  // === LÓGICA PRINCIPAL: Encontrar questão visível ===
  
  // 1. Verificar em iframes primeiro
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc && iframeDoc.body) {
        // Executar a mesma lógica dentro do iframe
        const iframeContainers = [];
        const iframeSelectors = ['[class*="question"]', '[class*="questao"]', '[class*="atividade"]', 'article', 'section', '.card', 'div'];
        
        for (const selector of iframeSelectors) {
          try {
            const elements = iframeDoc.querySelectorAll(selector);
            elements.forEach(el => {
              const text = el.textContent || '';
              if (text.length > 50 && (text.includes('?') || /\b[A-E]\b/.test(text))) {
                iframeContainers.push(el);
              }
            });
          } catch (e) {}
        }
        
        // Encontrar questão visível no iframe
        for (const container of iframeContainers) {
          const rect = container.getBoundingClientRect();
          // No iframe, considerar posição relativa
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            const question = extractFromContainer(container);
            if (question && question.length > 50) {
              console.log('AnswerHunter: Questão visível encontrada no iframe');
              return question.replace(/\s+/g, ' ').trim().substring(0, 3500);
            }
          }
        }
        
        // Fallback: buscar no texto do iframe
        const iframeText = iframeDoc.body.textContent || '';
        if (iframeText.length > 100) {
          const match = iframeText.match(/(?:Atividade|Questão)\s*\d+\s*\n?([^]*?)(?:\nResponda|\nO que você|$)/i);
          if (match) {
            console.log('AnswerHunter: Questão extraída do iframe (texto)');
            return match[0].replace(/\s+/g, ' ').trim().substring(0, 3500);
          }
        }
      }
    } catch (e) {
      // Cross-origin
    }
  }
  
  // 2. Buscar containers de questões na página principal
  const containers = findQuestionContainers();
  console.log('AnswerHunter: Containers encontrados:', containers.length);
  
  // 3. Encontrar qual container está visível na viewport
  let visibleQuestion = '';
  let bestVisibility = 0;
  
  for (const container of containers) {
    if (isInViewport(container)) {
      const rect = container.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      
      // Calcular quão centralizado está
      const center = (rect.top + rect.bottom) / 2;
      const centerDistance = Math.abs(center - windowHeight / 2);
      const visibility = 1 - (centerDistance / windowHeight);
      
      if (visibility > bestVisibility) {
        const question = extractFromContainer(container);
        if (question && question.length > 50) {
          bestVisibility = visibility;
          visibleQuestion = question;
        }
      }
    }
  }
  
  if (visibleQuestion) {
    console.log('AnswerHunter: Questão visível na viewport:', visibleQuestion.substring(0, 100) + '...');
    return visibleQuestion.replace(/\s+/g, ' ').trim().substring(0, 3500);
  }
  
  // 4. Fallback: Método antigo (texto da página inteira)
  console.log('AnswerHunter: Fallback - buscando no texto completo');
  const fullText = document.body ? (document.body.textContent || document.body.innerText || '') : '';
  
  // Tentar encontrar primeira questão
  const activityMatch = fullText.match(/(?:Atividade|Questão|Exercício|Pergunta)\s*\d+\s*\n([^]*?)(?:\nResponda|\nO que você achou|\nRelatar problema|\nVoltar\s*\nAvançar|$)/i);
  
  if (activityMatch) {
    let questionBlock = activityMatch[0]
      .replace(/\nResponda[\s\S]*$/i, '')
      .replace(/\nO que você achou[\s\S]*$/i, '')
      .replace(/\nRelatar problema[\s\S]*$/i, '')
      .replace(/\nVoltar[\s\S]*$/i, '')
      .trim();
    
    if (questionBlock.length > 50) {
      return questionBlock.replace(/\s+/g, ' ').trim().substring(0, 3500);
    }
  }
  
  // Último fallback: primeiro bloco com ?
  const blocks = fullText.split(/\n{2,}/);
  for (const block of blocks) {
    if (block.includes('?') && block.length > 30 && block.length < 2000) {
      if (/progresso|concluídos|acessar|disciplina/i.test(block)) continue;
      console.log('AnswerHunter: Usando primeiro bloco com ?');
      return block.replace(/\s+/g, ' ').trim().substring(0, 3500);
    }
  }
  
  console.log('AnswerHunter: Nada encontrado.');
  return '';
}
// ==========================================
// === BINDER MANAGER (Real) ===
// ==========================================


window.binderManager = {
  data: [], // Estrutura em Ã¡rvore
  currentFolderId: 'root', // Pasta atual visÃ­vel
  draggedItem: null, // Item sendo arrastado

  init() {
    chrome.storage.local.get(['binderStructure'], (result) => {
      if (result.binderStructure) {
        this.data = result.binderStructure;
        this.render();
      } else {
        this.data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
        this.save();
        this.render();
      }
    });
  },

  save() {
    chrome.storage.local.set({ binderStructure: this.data });
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
    // Helper para remover item de qualquer lugar na Ã¡rvore
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

    // Previne mover uma pasta para dentro dela mesma (bÃ¡sico)
    if (itemId === targetFolderId) return;

    const itemNode = removeFromTree(this.data, itemId);
    if (itemNode) {
      const targetFolder = this.findNode(targetFolderId);
      if (targetFolder) {
        targetFolder.children.push(itemNode);
        this.save();
        this.render();
      } else {
        // Se falhar (ex: target nÃ£o existe), recarrega para restaurar
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
      // Atualizar Ã­cones de salvo na busca se necessÃ¡rio
      const activeTab = document.querySelector('.tab-btn.active');
      if (activeTab && activeTab.dataset.tab === 'search') {
        // Re-render search results handled poorly but ok for now
      }
    }
  },

  clearAll() {
    if (confirm('Tem certeza que deseja apagar TODO o fichÃ¡rio? Esta aÃ§Ã£o Ã© irreversÃ­vel.')) {
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
        e.preventDefault(); // NecessÃ¡rio para permitir o drop
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



