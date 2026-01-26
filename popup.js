// Configuração das APIs
const GROQ_API_KEY = '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';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const SERPER_API_KEY = 'feffb9d9843cbe91d25ea499ae460068d5518f45';
const SERPER_API_URL = 'https://google.serper.dev/search';

// Global Data
let refinedData = [];


document.addEventListener('DOMContentLoaded', () => {
  // Elementos da UI
  const extractBtn = document.getElementById('extractBtn');
  const searchBtn = document.getElementById('searchBtn');
  const copyBtn = document.getElementById('copyBtn');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  // Global variables
  // refinedData is now global


  // === EXTRAIR DA PÁGINA ATUAL ===
  if (extractBtn) {
    extractBtn.addEventListener('click', async () => {
      showStatus('loading', '🔄 Extraindo conteúdo...');
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
              if (copyBtn) copyBtn.disabled = false;
            } else {
              showStatus('error', '⚠️ Nenhuma questão válida encontrada');
              displayResults([]);
            }
          } else {
            showStatus('error', '⚠️ Nenhuma pergunta extraída. Tente selecionar o texto.');
            displayResults([]);
          }
        }
      } catch (error) {
        console.error('Erro:', error);
        showStatus('error', '❌ Erro: ' + error.message);
      } finally {
        extractBtn.disabled = false;
      }
    });
  }

  // === BUSCAR NO GOOGLE ===
  if (searchBtn) {
    searchBtn.addEventListener('click', async () => {
      showStatus('loading', '🔄 Obtendo pergunta...');
      searchBtn.disabled = true;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Extrair pergunta (Prioridade: Seleção -> Brainly -> Estácio -> Genérico)
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: extractQuestionOnly
        });

        const question = results?.[0]?.result;

        if (!question || question.length < 5) {
          showStatus('error', '⚠️ Selecione o texto da pergunta e tente novamente.');
          return;
        }

        showStatus('loading', '🌐 Buscando no Google...');

        const searchResults = await searchWithSerper(question);

        if (!searchResults || searchResults.length === 0) {
          showStatus('error', '⚠️ Nenhum resultado encontrado no Google.');
          return;
        }

        showStatus('loading', `📥 Analisando ${searchResults.length} resultados...`);

        const answers = await extractAnswersFromSearch(question, searchResults);

        if (answers.length > 0) {
          refinedData = answers;
          displayResults(refinedData);
          showStatus('success', `✅ ${answers.length} resposta(s) encontrada(s)!`);
          if (copyBtn) copyBtn.disabled = false;
        } else {
          showStatus('error', '⚠️ IA não encontrou a resposta nos resultados.');
        }

      } catch (error) {
        console.error('Erro na busca:', error);
        showStatus('error', '❌ Erro: ' + error.message);
      } finally {
        searchBtn.disabled = false;
      }
    });
  }

  // === BUSCAR COM SERPER ===
  async function searchWithSerper(query) {
    // Limita tamanho e remove quebras excessivas
    const cleanQuery = query.replace(/\s+/g, ' ').substring(0, 300);

    try {
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

      if (!response.ok) throw new Error(`API Google: ${response.status}`);

      const data = await response.json();
      return data.organic || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // === EXTRACTION LOGIC ===
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

4. FORMATO DE SAÍDA:

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
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (refinedData.length === 0) return;
      const text = refinedData.map((item, i) =>
        `📝 Q${i + 1}: ${item.question}\n✅ R: ${item.answer}\n🔗 ${item.source || ''}`
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
    if (type === 'error') icon = 'warning';
    if (type === 'loading') icon = 'hourglass_top';

    statusDiv.innerHTML = `<span class="material-symbols-rounded" style="vertical-align:middle;margin-right:4px">${icon}</span> ${message}`;
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

  // === DISPLAY ===
  function displayResults(data) {
    if (!resultsDiv) return;
    if (data.length === 0) {
      resultsDiv.innerHTML = '<div class="placeholder"><p>Nada encontrado.</p></div>';
      return;
    }

    resultsDiv.innerHTML = data.map((item, index) => `
            <div class="qa-item">
               <div class="qa-actions" style="position: absolute; top: 10px; right: 10px;">
                   <button class="action-btn save-btn material-symbols-rounded" data-index="${index}" title="Salvar">bookmark_border</button>
               </div>
               <div class="question">${escapeHtml(item.question)}</div>
               <div class="answer">${escapeHtml(item.answer)}</div>
               ${item.source ? `<div class="source"><a href="${item.source}" target="_blank">Fonte</a></div>` : ''}
            </div>
        `).join('');

    // Event Delegation para o botão Salvar
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
// === FUNÇÕES INJETADAS (CONTENTSCRIPT) ===
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
function extractQuestionOnly() {
  console.log('AnswerHunter: Iniciando extração (v2 robusta)...');

  // === MÉTODO ESPECÍFICO PARA ESTÁCIO (Via data-testid) ===
  // Detectar se é o portal da Estácio
  const isEstacio = document.querySelector('[data-testid="wrapper-Practice"]') ||
    document.querySelector('[data-testid^="question-"]') ||
    window.location.hostname.includes('estacio');

  if (isEstacio) {
    // Pegar todos os containers de questão
    const questionContainers = document.querySelectorAll('[data-testid^="question-"]');
    let targetContainer = null;

    // LÓGICA DE DETECÇÃO DA QUESTÃO VISÍVEL (VIEWPORT)
    if (questionContainers.length > 0) {
      let maxVisibility = 0;

      questionContainers.forEach(container => {
        const rect = container.getBoundingClientRect();

        // Calcular sobreposição com a janela visível
        const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        const visibleWidth = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);

        // Se o elemento está visível
        if (visibleHeight > 0 && visibleWidth > 0) {
          const area = visibleHeight * visibleWidth;

          // Prioriza o elemento que ocupa mais espaço na tela
          if (area > maxVisibility) {
            maxVisibility = area;
            targetContainer = container;
          }
        }
      });

      // Se nenhum estiver visível (ex: todos fora da tela), pega o primeiro
      if (!targetContainer) {
        targetContainer = questionContainers[0];
      }
    }

    if (targetContainer) {
      console.log('AnswerHunter: Container encontrado:', targetContainer.getAttribute('data-testid'));

      // 1. Extrair Enunciado
      // Estratégia: Pegar o data-testid="question-typography" que NÃO está dentro de uma alternativa
      const allTypography = targetContainer.querySelectorAll('[data-testid="question-typography"]');
      let enunciado = '';

      for (const el of allTypography) {
        // Verificar se esse elemento ou seus pais são um botão de alternativa
        if (!el.closest('button[data-testid^="alternative-"]')) {
          // É parte do enunciado
          enunciado += ' ' + (el.textContent || '').trim();
        }
      }
      enunciado = enunciado.trim();
      console.log('AnswerHunter: Enunciado extraído:', enunciado.substring(0, 50));

      // 2. Extrair Alternativas
      const alternativas = [];
      const altButtons = targetContainer.querySelectorAll('button[data-testid^="alternative-"]');

      altButtons.forEach(btn => {
        const letraEl = btn.querySelector('[data-testid="circle-letter"]');
        const textoEl = btn.querySelector('[data-testid="question-typography"]');

        if (letraEl && textoEl) {
          const letra = letraEl.innerText.replace(/[\n\r]/g, '').trim();
          const texto = textoEl.innerText.replace(/[\n\r]/g, ' ').trim();
          alternativas.push(`${letra}) ${texto}`);
        }
      });

      let questaoCompleta = enunciado;
      if (alternativas.length > 0) {
        questaoCompleta += '\n\n' + alternativas.join('\n');
      }

      if (questaoCompleta.length > 20) {
        return questaoCompleta.substring(0, 2500);
      }
    }
  }

  // === MÉTODO GENÉRICO DE BACKUP ===
  // Se falhar o método específico, tenta pegar texto visível com heurísticas
  console.log('AnswerHunter: Tentando método genérico...');

  // Lista de seletores comuns em sites de questões
  const genericSelectors = [
    // Estácio (caso mude data-testid)
    '.questao-texto', '.enunciado',
    // Gran Cursos, QConcursos, etc
    '.q-question-text', '.js-question-text',
    '.text-content', '.statement',
    // Genérico
    'div[class*="texto"]', 'div[class*="enunciado"]'
  ];

  for (const sel of genericSelectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.length > 50) {
      return el.innerText.trim().substring(0, 2000);
    }
  }

  // Fallback final: Texto selecionado pelo usuário (se houver)
  const selection = window.getSelection().toString().trim();
  if (selection.length > 20) {
    console.log('AnswerHunter: Usando texto selecionado pelo usuário.');
    return selection;
  }

  // Fallback bruto: Regex no body
  const bodyText = document.body.innerText;
  const match = bodyText.match(/(?:Questão|Pergunta)\s*\d+[:\s\n]*([^]*?)(?:Alternativa|a\)|A\))/i);
  if (match && match[1] && match[1].length > 50) {
    return match[1].trim().substring(0, 1000);
  }

  return '';
}

// ==========================================
// === BINDER MANAGER (Real) ===
// ==========================================


window.binderManager = {
  data: [], // Estrutura em árvore
  currentFolderId: 'root', // Pasta atual visível
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
    // Helper para remover item de qualquer lugar na árvore
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

    // Previne mover uma pasta para dentro dela mesma (básico)
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

  render() {
    const container = document.getElementById('binder-list');
    if (!container) return;

    const folder = this.findNode(this.currentFolderId) || this.data[0];

    // Toolbar
    let html = `<div class="binder-toolbar">
            <span class="crumb-current">📂 ${folder.title}</span>
            <div class="toolbar-actions">
               ${folder.id !== 'root' ? `<button id="btnBackRoot" class="btn-text">⬅ Voltar</button>` : ''}
               <button id="newFolderBtnBinder" class="btn-text">+ Pasta</button>
            </div>
        </div>`;

    html += `<div class="binder-content">`;

    folder.children.forEach(item => {
      if (item.type === 'folder') {
        html += `<div class="folder-item drop-zone" draggable="true" data-id="${item.id}" data-type="folder">
                    <span class="material-symbols-rounded">folder</span> ${item.title}
                </div>`;
      } else {
        html += `<div class="qa-item expandable" draggable="true" data-id="${item.id}" data-type="question">
                    <div class="summary-view">${item.content.question.substring(0, 60)}...</div>
                    <div class="full-view" style="display:none">
                       <p>${item.content.question}</p>
                       <p>✅ ${item.content.answer}</p>
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
        e.preventDefault(); // Necessário para permitir o drop
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

    // Delegation for Click (Navigation & Expand)
    const contentDiv = container.querySelector('.binder-content');
    if (contentDiv) {
      contentDiv.onclick = (e) => {
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
    window.binderManager.addItem(item.question, item.answer, item.source);

    // Feedback Visual
    btn.textContent = 'bookmark';
    btn.classList.add('saved', 'filled');
    btn.onclick = null; // Previne duplo clique
  }
};
