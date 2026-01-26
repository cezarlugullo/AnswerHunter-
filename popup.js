// Configuração das APIs
const GROQ_API_KEY = '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';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const SERPER_API_KEY = 'feffb9d9843cbe91d25ea499ae460068d5518f45';
const SERPER_API_URL = 'https://google.serper.dev/search';

document.addEventListener('DOMContentLoaded', () => {
  const extractBtn = document.getElementById('extractBtn');
  const searchBtn = document.getElementById('searchBtn');
  const copyBtn = document.getElementById('copyBtn');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');

  let refinedData = [];

  // === EXTRAIR DA PÁGINA ATUAL ===
  extractBtn.addEventListener('click', async () => {
    showStatus('loading', '🔄 Extraindo conteúdo da página...');
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
          showStatus('loading', '🤖 Refinando com IA...');

          const refined = await Promise.all(
            extractedData.map(item => refineWithGroq(item))
          );

          refinedData = refined.filter(item => item !== null);

          if (refinedData.length > 0) {
            displayResults(refinedData);
            showStatus('success', `✅ ${refinedData.length} questão(ões) encontrada(s)!`);
            copyBtn.disabled = false;
          } else {
            showStatus('error', '⚠️ Nenhuma questão válida encontrada');
            displayResults([]);
          }
        } else {
          showStatus('error', '⚠️ Nenhuma pergunta/resposta encontrada nesta página');
          displayResults([]);
        }
      }
    } catch (error) {
      console.error('Erro:', error);
      showStatus('error', '❌ Erro ao extrair conteúdo.');
    } finally {
      extractBtn.disabled = false;
    }
  });

  // === BUSCAR NO GOOGLE ===
  searchBtn.addEventListener('click', async () => {
    showStatus('loading', '🔄 Extraindo pergunta da página...');
    searchBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Primeiro, extrair a pergunta da página atual
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: extractQuestionOnly
      });

      const question = results?.[0]?.result;

      if (!question || question.length < 20) {
        showStatus('error', '⚠️ Não foi possível extrair a pergunta desta página');
        return;
      }

      showStatus('loading', '🌐 Buscando no Google...');

      // Buscar no Google via Serper
      const searchResults = await searchWithSerper(question);

      if (!searchResults || searchResults.length === 0) {
        showStatus('error', '⚠️ Nenhum resultado encontrado');
        return;
      }

      showStatus('loading', `📥 Analisando ${searchResults.length} resultado(s)...`);

      // Tentar extrair resposta dos resultados
      const answers = await extractAnswersFromSearch(question, searchResults);

      if (answers.length > 0) {
        refinedData = answers;
        displayResults(refinedData);
        showStatus('success', `✅ Encontrada(s) ${answers.length} resposta(s)!`);
        copyBtn.disabled = false;
      } else {
        showStatus('error', '⚠️ Não foi possível extrair respostas dos resultados');
      }

    } catch (error) {
      console.error('Erro na busca:', error);
      showStatus('error', '❌ Erro ao buscar resposta.');
    } finally {
      searchBtn.disabled = false;
    }
  });

  // === BUSCAR COM SERPER ===
  async function searchWithSerper(query) {
    // Limitar a query para evitar erros
    const cleanQuery = query.substring(0, 200);

    const response = await fetch(SERPER_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: cleanQuery + ' site:brainly.com.br OR site:passeidireto.com OR site:respondeai.com.br',
        gl: 'br',
        hl: 'pt-br',
        num: 5
      })
    });

    if (!response.ok) {
      throw new Error(`Serper HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.organic || [];
  }

  // === EXTRAIR RESPOSTAS DOS RESULTADOS DE BUSCA ===
  async function extractAnswersFromSearch(originalQuestion, searchResults) {
    const answers = [];

    for (const result of searchResults.slice(0, 3)) {
      try {
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
            refined.source = result.link;
            answers.push(refined);
            break; // Pegar só a primeira resposta válida
          }
        }
      } catch (e) {
        console.error('Erro ao processar resultado:', e);
      }
    }

    return answers;
  }

  // === REFINAR COM GROQ ===
  async function refineWithGroq(item) {
    const prompt = `Você é um especialista em extrair respostas de questões educacionais de sites como Brainly e Passei Direto.

CONTEÚDO BRUTO EXTRAÍDO DO SITE:

=== ÁREA DA PERGUNTA ===
${item.question}

=== ÁREA DA RESPOSTA ===
${item.answer}

INSTRUÇÕES CRÍTICAS:

1. DETECTE O TIPO DE QUESTÃO:
   - Múltipla escolha tradicional (A, B, C, D, E)
   - Asserções (I, II, III com análise de quais estão corretas)
   - Verdadeiro/Falso
   - Questão aberta

2. ENCONTRE A RESPOSTA CORRETA:
   - Procure por indicações como "Gab", "Gabarito", "Resposta correta", "alternativa correta é"
   - Procure frases como "I e II estão corretas", "apenas I está correta", etc.
   - A resposta geralmente está na área de resposta, NÃO na pergunta

3. IGNORE COMPLETAMENTE:
   - Textos promocionais (Assine, Plus, Premium, desbloqueie)
   - Metadata de usuários (especialista, votos, útil, respostas)
   - Outras perguntas que aparecem no site
   - Se for APENAS conteúdo promocional, responda: INVALIDO

FORMATO DE SAÍDA:

Para questões de ASSERÇÕES (I, II, III):
PERGUNTA: [enunciado com as asserções]
RESPOSTA: [ex: "I e II estão corretas" ou "Apenas a asserção I é verdadeira"]

Para MÚLTIPLA ESCOLHA (A, B, C, D, E):
PERGUNTA: [enunciado]
A) [opção A]
B) [opção B]
C) [opção C]
D) [opção D]
E) [opção E se houver]
RESPOSTA: Alternativa [LETRA]: [texto da alternativa]

Para questão ABERTA:
PERGUNTA: [pergunta]
RESPOSTA: [resposta direta]

IMPORTANTE: Extraia a resposta que está INDICADA NO SITE, não invente uma resposta.`;

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
              content: 'Você extrai respostas de sites educacionais como Brainly. Identifique o tipo de questão (múltipla escolha, asserções I/II/III, ou aberta). Procure por indicações de gabarito como "Gab", "I e II estão corretas", etc. Extraia APENAS a resposta indicada no site, nunca invente. Se for conteúdo promocional, responda INVALIDO.'
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content?.trim() || '';

      if (content === 'INVALIDO' || content.includes('INVALIDO')) {
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
  copyBtn.addEventListener('click', () => {
    if (refinedData.length === 0) return;

    const text = refinedData.map((item, index) => {
      let result = `📝 QUESTÃO ${index + 1}:\n${item.question}\n\n✅ ${item.answer}\n`;
      if (item.source) {
        result += `🔗 Fonte: ${item.source}\n`;
      }
      return result;
    }).join('\n' + '─'.repeat(40) + '\n\n');

    navigator.clipboard.writeText(text).then(() => {
      showStatus('success', '📋 Copiado para a área de transferência!');
    }).catch(() => {
      showStatus('error', '❌ Erro ao copiar');
    });
  });

  function showStatus(type, message) {
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
  }

  function displayResults(data) {
    if (data.length === 0) {
      resultsDiv.innerHTML = `
        <div class="no-results">
          <span class="emoji">🔍</span>
          <p>Nenhuma questão válida encontrada.</p>
        </div>
      `;
      return;
    }

    resultsDiv.innerHTML = data.map(item => `
      <div class="qa-item">
        <div class="question">${escapeHtml(item.question).replace(/\n/g, '<br>')}</div>
        <div class="answer">${escapeHtml(item.answer)}</div>
        ${item.source ? `<div class="source">🔗 <a href="${item.source}" target="_blank">Fonte</a></div>` : ''}
      </div>
    `).join('');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});

// === FUNÇÃO PARA EXTRAIR APENAS A PERGUNTA (SITES PROTEGIDOS) ===
function extractQuestionOnly() {

  // === MÉTODO ESPECÍFICO PARA ESTÁCIO ===
  // Detectar se é o portal da Estácio
  const isEstacio = document.querySelector('[data-testid="wrapper-Practice"]') ||
    document.querySelector('[data-testid^="question-"]') ||
    window.location.hostname.includes('estacio');

  if (isEstacio) {
    // Pegar a PRIMEIRA questão disponível
    const questionContainer = document.querySelector('[data-testid^="question-"]');

    if (questionContainer) {
      // Extrair o enunciado (texto principal da questão)
      const enunciadoEl = questionContainer.querySelector('.css-1cwyvh6 [data-testid="question-typography"]');
      let enunciado = '';

      if (enunciadoEl) {
        enunciado = (enunciadoEl.textContent || '').replace(/\s+/g, ' ').trim();
      }

      // Extrair as alternativas
      const alternativas = [];
      const altButtons = questionContainer.querySelectorAll('button[data-testid^="alternative-"]');

      altButtons.forEach(btn => {
        const letraEl = btn.querySelector('[data-testid="circle-letter"]');
        const textoEl = btn.querySelector('[data-testid="question-typography"]');

        if (letraEl && textoEl) {
          const letra = (letraEl.textContent || '').trim();
          const texto = (textoEl.textContent || '').trim();
          alternativas.push(`${letra}) ${texto}`);
        }
      });

      // Montar a questão completa
      let questaoCompleta = enunciado;
      if (alternativas.length > 0) {
        questaoCompleta += ' ' + alternativas.join(' ');
      }

      if (questaoCompleta.length > 50) {
        return questaoCompleta.substring(0, 1000);
      }
    }
  }

  // === MÉTODO GENÉRICO PARA OUTROS SITES ===
  const platformSelectors = [
    '[data-testid="question-typography"]',
    '[class*="enunciado"]',
    '[class*="questao"]',
    '[class*="question"]',
    '[class*="pergunta"]',
    'main p',
    'article p',
    '.content p'
  ];

  let questionParts = [];

  for (const selector of platformSelectors) {
    try {
      const els = document.querySelectorAll(selector);
      els.forEach(el => {
        let text = (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();

        if (text.length > 30 && text.length < 3000) {
          const isQuestion = text.includes('?') ||
            text.includes('alternativa') ||
            text.includes('assinale') ||
            text.includes('marque') ||
            text.includes('correto') ||
            text.includes('analise') ||
            text.includes('considere') ||
            text.includes('asserção');

          const isUI = text.includes('Sair') ||
            text.includes('Login') ||
            text.includes('Menu') ||
            text.includes('revisão') ||
            text.length < 50;

          if (isQuestion && !isUI) {
            questionParts.push(text);
          }
        }
      });
    } catch (e) {
      // Ignorar erros
    }
  }

  if (questionParts.length > 0) {
    questionParts.sort((a, b) => b.length - a.length);
    return questionParts[0].substring(0, 800);
  }

  // Fallback: pegar todo o texto
  const bodyText = document.body.textContent || '';
  const patterns = [
    /(?:Questão|Pergunta|Enunciado)[:\s]*([^]*?)(?:A\)|a\)|Alternativa)/i,
    /[^.!?]*\?[^.!?]*/g
  ];

  for (const pattern of patterns) {
    const matches = bodyText.match(pattern);
    if (matches && matches[0] && matches[0].length > 50) {
      return matches[0].replace(/\s+/g, ' ').trim().substring(0, 800);
    }
  }

  return '';
}

// === FUNÇÃO PARA EXTRAIR Q&A COMPLETO ===
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
