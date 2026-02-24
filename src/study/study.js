// study.js — AnswerHunter Study Page
// Reads binder data from chrome.storage.local and renders interactive study cards.

import { ApiService } from '../services/ApiService.js';

const escH = s => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const parseMarkdown = text => {
  let html = escH(text);
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  return html;
};

const formatExplanation = text => {
  if (!text) return '';
  let html = escH(text);
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Split into lines for structured rendering
  const lines = html.split('\n');
  let result = '';
  let inList = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (inList) { result += '</div>'; inList = false; }
      continue;
    }
    
    // Correct answer header line (✅)
    if (line.startsWith('✅')) {
      result += `<div class="exp-correct-answer">${line}</div>`;
      continue;
    }
    
    // Summary line (💡)
    if (line.startsWith('💡')) {
      result += `<div class="exp-summary">${line}</div>`;
      continue;
    }
    
    // Wrong alternative line (❌)
    if (line.startsWith('❌')) {
      result += `<div class="exp-wrong">${line}</div>`;
      continue;
    }
    
    // Numbered steps (1., 2., 3., etc.)
    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      result += `<div class="exp-step"><span class="exp-step-num">${numMatch[1]}</span><span class="exp-step-text">${numMatch[2]}</span></div>`;
      continue;
    }
    
    // Sub-items with dash (- text)
    if (line.startsWith('- ')) {
      result += `<div class="exp-sub-item">${line.slice(2)}</div>`;
      continue;
    }
    
    // Regular paragraph
    result += `<p class="exp-paragraph">${line}</p>`;
  }
  
  if (inList) result += '</div>';
  return result;
};

const formatReviewCard = text => {
  if (!text) return '';
  let html = escH(text);

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  const lines = html.split('\n');
  let result = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Section headers with emoji (📌 📖 🔑 ⚠️ 🧠 🔗)
    if (/^(📌|📖|🔑|⚠️|🧠|🔗)\s+/.test(line)) {
      const emojiMatch = line.match(/^(📌|📖|🔑|⚠️|🧠|🔗)\s+(.*)/);
      if (emojiMatch) {
        const emoji = emojiMatch[1];
        const title = emojiMatch[2];
        let cls = 'rev-section';
        if (emoji === '📌') cls += ' rev-concept';
        else if (emoji === '📖') cls += ' rev-definition';
        else if (emoji === '🔑') cls += ' rev-memorize';
        else if (emoji === '⚠️') cls += ' rev-pitfall';
        else if (emoji === '🧠') cls += ' rev-mnemonic';
        else if (emoji === '🔗') cls += ' rev-related';
        result += `<div class="${cls}"><span class="rev-emoji">${emoji}</span><span class="rev-title">${title}</span></div>`;
        continue;
      }
    }

    // Bullet items
    if (line.startsWith('- ')) {
      result += `<div class="rev-bullet">${line.slice(2)}</div>`;
      continue;
    }

    // Regular text
    result += `<p class="rev-text">${line}</p>`;
  }

  return result;
};

const formatText = text => {
  if (!text) return '';
  // Add newlines before options like A), B), a), b), etc. if they are not already on a new line
  return text.replace(/([^\n])\s+([A-Ea-e]\))/g, '$1\n$2');
};

const normalizeNewlines = text => String(text || '')
  .replace(/\u00A0/g, ' ')
  .replace(/\r\n?/g, '\n')
  .trim();

function cutAtFirstMarker(text, patterns, minIndex = 0) {
  let cutIndex = -1;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match.index >= minIndex) {
      cutIndex = cutIndex === -1 ? match.index : Math.min(cutIndex, match.index);
    }
  }
  return cutIndex >= 0 ? text.slice(0, cutIndex).trim() : text;
}

function stripOptionTailNoise(text) {
  if (!text) return '';
  let cleaned = String(text).replace(/\s+/g, ' ').trim();
  const noiseMarker = /\b(?:gabarito(?:\s+comentado)?|resposta\s+correta|resposta\s+incorreta|alternativa\s+correta|alternativa\s+incorreta|parab[eé]ns|voc[eê]\s+acertou|confira\s+o\s+gabarito|explica[cç][aã]o)\b/i;
  const idx = cleaned.search(noiseMarker);
  if (idx > 20) cleaned = cleaned.slice(0, idx).trim();
  return cleaned.replace(/[;:,\-.\s]+$/g, '').trim();
}

function sanitizeQuestionText(text) {
  let cleaned = normalizeNewlines(text);
  if (!cleaned) return '';

  cleaned = cutAtFirstMarker(cleaned, [
    /\bmenu_book\b/i,
    /\bExplica(?:ç|c)[aã]o Passo a Passo\b/i,
    /\bTestar se aprendi\b/i,
    /\bChat de d[úu]vida\b/i,
    /\bRevisar\b/i,
    /\bRevelar resposta\b/i,
    /\blightbulb\b/i,
    /\bcheck_circle\b/i,
    /\bcontent_copy\b/i,
    /\bsummarize\b/i,
    /\bSalvo em\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/i
  ], 40);

  cleaned = cleaned.replace(
    /\bGabarito\b(?=[\s\S]{0,240}(?:Parab[eé]ns|Infelizmente|Resposta\s+correta|menu_book|check_circle|Salvo em|Revelar resposta))[\s\S]*$/i,
    ''
  ).trim();

  const lines = cleaned.split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) return cleaned;

  const result = [];
  const optionLineRe = /^[A-Ea-e][\)\.\-:]\s+/;
  const nextQuestionLineRe = /^\d+\.\s+\S/;
  const iconNoiseLineRe = /^(?:menu_book|quiz|forum|lightbulb|check_circle|content_copy|delete|folder|restart_alt|sync|summarize)$/i;
  const uiPhraseNoiseLineRe = /^(?:Explica(?:ç|c)[aã]o Passo a Passo|Testar se aprendi|Chat de d[úu]vida|Revelar resposta|Revisar)$/i;
  const feedbackNoiseLineRe = /^(?:Parab[eé]ns!?|Infelizmente[,!]?|Resposta\s+correta\b|Resposta\s+incorreta\b|Gabarito\b)/i;
  const metaNoiseLineRe = /^(?:Salvo em\s+\d{1,2}\/\d{1,2}\/\d{2,4}|Raiz\s*\/|#\d+)\b/i;

  let optionCount = 0;

  for (const line of lines) {
    if (optionLineRe.test(line)) optionCount += 1;

    const isNoise = iconNoiseLineRe.test(line)
      || uiPhraseNoiseLineRe.test(line)
      || feedbackNoiseLineRe.test(line)
      || metaNoiseLineRe.test(line)
      || (optionCount >= 2 && nextQuestionLineRe.test(line));

    if (isNoise && (optionCount > 0 || result.length >= 2)) break;
    result.push(line);
  }

  cleaned = result.join('\n').trim();
  return cleaned || normalizeNewlines(text);
}

function sanitizeAnswerText(text) {
  let cleaned = normalizeNewlines(text);
  if (!cleaned) return '';

  cleaned = cutAtFirstMarker(cleaned, [
    /\bmenu_book\b/i,
    /\bExplica(?:ç|c)[aã]o Passo a Passo\b/i,
    /\bTestar se aprendi\b/i,
    /\bChat de d[úu]vida\b/i,
    /\bRevelar resposta\b/i,
    /\blightbulb\b/i,
    /\bcontent_copy\b/i,
    /\bSalvo em\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/i
  ], 20);

  return cleaned.trim();
}

function parseQuestion(text) {
  if (!text) return { enunciado: '', alternativas: [] };

  const safeText = sanitizeQuestionText(text);
  let normalized = safeText.replace(/([^\n])\s+([A-Ea-e][\)\.])/g, '$1\n$2');
  const lines = normalized.split('\n');
  const enunciado = [];
  const alternativas = [];
  
  const optionRegex = /^[A-Ea-e][\)\.]\s/;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (optionRegex.test(trimmed)) {
      alternativas.push(stripOptionTailNoise(trimmed));
    } else {
      if (alternativas.length === 0) {
        enunciado.push(trimmed);
      } else {
        const merged = `${alternativas[alternativas.length - 1]} ${trimmed}`;
        alternativas[alternativas.length - 1] = stripOptionTailNoise(merged);
      }
    }
  }
  
  return {
    enunciado: enunciado.join('\n').trim(),
    alternativas: alternativas
  };
}

function parseAnswer(text) {
  if (!text) return { steps: '', final: '', letter: '', text: '' };

  const safeText = sanitizeAnswerText(text);
  const lines = safeText.split('\n');
  const steps = [];
  const final = [];
  
  let inFinal = false;
  for (const line of lines) {
    const lower = line.trim().toLowerCase();
    if (lower.startsWith('letra ') || 
        lower.startsWith('resposta correta:') || 
        lower.startsWith('gabarito') ||
        lower.match(/^[a-e]\s*-/)) {
      inFinal = true;
    }
    
    if (inFinal) {
      final.push(line);
    } else {
      steps.push(line);
    }
  }
  
  let finalStr = final.length > 0 ? final.join('\n').trim() : safeText.trim();
  let stepsStr = final.length > 0 ? steps.join('\n').trim() : '';
  
  // Try to extract letter and text
  let letter = '';
  let answerText = finalStr;
  
  // Match "Letra X: text" or "X - text"
  const match = finalStr.match(/^(?:Letra\s+)?([A-E])(?:[:\-\)\.]\s*)(.*)/is);
  if (match) {
    letter = match[1].toUpperCase();
    answerText = match[2].trim();
  } else {
    // fallback
    const match2 = finalStr.match(/^(?:Resposta correta|Gabarito)[:\s]*(?:Letra\s+)?([A-E])?(?:[:\-\)\.]\s*)(.*)/is);
    if (match2) {
      letter = match2[1] ? match2[1].toUpperCase() : '';
      answerText = match2[2].trim();
    }
  }
  
  return {
    steps: stepsStr,
    final: finalStr,
    letter: letter,
    text: answerText || finalStr // fallback to full final string if text is empty
  };
}

const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('pt-BR') : '';

function collectQuestions(nodes, folderPath = '') {
  const items = [];
  for (const node of nodes) {
    if (node.type === 'question' && node.content) {
      items.push({ ...node.content, folderPath, createdAt: node.createdAt, id: node.id });
    } else if (node.type === 'folder') {
      const path = folderPath ? `${folderPath} / ${node.title}` : node.title;
      items.push(...collectQuestions(node.children || [], path));
    }
  }
  return items;
}

function buildCard(q, index) {
  const article = document.createElement('article');
  article.className = 'card';
  article.dataset.idx = index;
  if (q.id) article.dataset.qid = q.id;

  const showFolder = q.folderPath && q.folderPath !== 'Raiz';
  const cleanQuestion = sanitizeQuestionText(q.question);
  const cleanAnswer = sanitizeAnswerText(q.answer);
  const parsedQ = parseQuestion(cleanQuestion);
  const parsedA = parseAnswer(cleanAnswer);

  article.innerHTML = `
    <div class="card-meta">
      <span class="card-num">#${index + 1}</span>
      ${showFolder ? `<span class="card-folder"><span class="icon">folder</span> ${escH(q.folderPath)}</span>` : ''}
      <div class="card-actions">
        <button class="card-action-btn btn-copy-card" title="Copiar questão e resposta" type="button">
          <span class="icon">content_copy</span>
        </button>
        <button class="card-action-btn btn-delete-card" title="Excluir questão" type="button">
          <span class="icon">delete</span>
        </button>
      </div>
    </div>
    <div class="card-question">
      <div class="question-enunciado">${escH(parsedQ.enunciado)}</div>
      ${parsedQ.alternativas.length > 0 ? `
        <div class="question-options">
          ${parsedQ.alternativas.map(opt => `<div class="option-item">${escH(opt)}</div>`).join('')}
        </div>
      ` : ''}
    </div>
    
    <div class="answer-tools">
      <button class="answer-tool-btn btn-explanation" type="button">
        <span class="icon">menu_book</span> Explicação Passo a Passo
      </button>
      <button class="answer-tool-btn btn-review" type="button">
        <span class="icon">summarize</span> Revisar
      </button>
      <button class="answer-tool-btn btn-test-learning" type="button">
        <span class="icon">quiz</span> Testar se aprendi
      </button>
      <button class="answer-tool-btn btn-chat-doubt" type="button">
        <span class="icon">forum</span> Chat de dúvida
      </button>
    </div>
    
    <div class="answer-explanation">
      <div class="explanation-content"></div>
      <div class="explanation-loading" style="display: none; color: var(--muted); font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
        <span class="icon" style="animation: spin 1s linear infinite;">autorenew</span> Gerando explicação com IA...
      </div>
    </div>

    <div class="answer-review">
      <div class="review-content"></div>
      <div class="review-loading" style="display: none; color: var(--muted); font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
        <span class="icon" style="animation: spin 1s linear infinite;">autorenew</span> Gerando ficha de revisão...
      </div>
    </div>

    <button class="reveal-btn" type="button">
      <span class="icon">lightbulb</span> Revelar resposta
    </button>
    
    <div class="card-answer" hidden>
      <div class="answer-final-box">
        <span class="answer-badge"><span class="icon">check_circle</span> Gabarito</span>
        <span class="answer-text-content">
          ${parsedA.letter ? `<strong>${parsedA.letter})</strong> ` : ''}${escH(parsedA.text)}
        </span>
      </div>
      
      ${q.source ? `<div class="answer-source"><span class="icon">link</span> ${escH(q.source)}</div>` : ''}
    </div>
    ${fmtDate(q.createdAt) ? `<div class="card-date">Salvo em ${fmtDate(q.createdAt)}</div>` : ''}
  `;

  article.querySelector('.reveal-btn').addEventListener('click', () => {
    revealCard(article);
  });

  const btnExplanation = article.querySelector('.btn-explanation');
  if (btnExplanation) {
    btnExplanation.addEventListener('click', async () => {
      const exp = article.querySelector('.answer-explanation');
      const contentDiv = exp.querySelector('.explanation-content');
      const loadingDiv = exp.querySelector('.explanation-loading');
      const isVisible = exp.classList.contains('visible');
      
      if (isVisible) {
        exp.classList.remove('visible');
        btnExplanation.classList.remove('active');
      } else {
        exp.classList.add('visible');
        btnExplanation.classList.add('active');
        
        // If there's no content yet, generate it
        if (!contentDiv.innerHTML.trim()) {
          contentDiv.style.display = 'none';
          loadingDiv.style.display = 'flex';
          
          try {
            const explanation = await ApiService.generateTutorExplanation(cleanQuestion, cleanAnswer, q.source);
            if (explanation) {
              contentDiv.innerHTML = formatExplanation(explanation);
            } else {
              contentDiv.innerHTML = '<em>Não foi possível gerar a explicação no momento. Verifique suas chaves de API nas configurações.</em>';
            }
          } catch (err) {
            console.error('Error generating explanation:', err);
            contentDiv.innerHTML = '<em>Ocorreu um erro ao gerar a explicação.</em>';
          } finally {
            loadingDiv.style.display = 'none';
            contentDiv.style.display = 'block';
          }
        } else {
          loadingDiv.style.display = 'none';
          contentDiv.style.display = 'block';
        }
      }
    });
  }

  const btnReview = article.querySelector('.btn-review');
  if (btnReview) {
    btnReview.addEventListener('click', async () => {
      const rev = article.querySelector('.answer-review');
      const contentDiv = rev.querySelector('.review-content');
      const loadingDiv = rev.querySelector('.review-loading');
      const isVisible = rev.classList.contains('visible');

      if (isVisible) {
        rev.classList.remove('visible');
        btnReview.classList.remove('active');
      } else {
        rev.classList.add('visible');
        btnReview.classList.add('active');

        if (!contentDiv.innerHTML.trim()) {
          contentDiv.style.display = 'none';
          loadingDiv.style.display = 'flex';

          try {
            const review = await ApiService.generateReviewCard(cleanQuestion, cleanAnswer, q.source);
            if (review) {
              contentDiv.innerHTML = formatReviewCard(review);
            } else {
              contentDiv.innerHTML = '<em>Não foi possível gerar a ficha de revisão. Verifique suas chaves de API.</em>';
            }
          } catch (err) {
            console.error('Error generating review card:', err);
            contentDiv.innerHTML = '<em>Ocorreu um erro ao gerar a ficha de revisão.</em>';
          } finally {
            loadingDiv.style.display = 'none';
            contentDiv.style.display = 'block';
          }
        } else {
          loadingDiv.style.display = 'none';
          contentDiv.style.display = 'block';
        }
      }
    });
  }

  const btnTest = article.querySelector('.btn-test-learning');
  if (btnTest) {
    btnTest.addEventListener('click', () => {
      alert('Funcionalidade "Testar se aprendi" em breve!');
    });
  }

  const btnChat = article.querySelector('.btn-chat-doubt');
  if (btnChat) {
    btnChat.addEventListener('click', () => {
      alert('Funcionalidade "Chat de dúvida" em breve!');
    });
  }

  article.querySelector('.btn-copy-card').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const qText = article.querySelector('.card-question').innerText;
    const aText = article.querySelector('.answer-final-box').innerText;
    const expText = article.querySelector('.answer-explanation') ? article.querySelector('.answer-explanation').innerText : '';
    
    let text = `Questão:\n${qText}\n\nResposta:\n${aText}\n`;
    if (expText) text += `\nExplicação:\n${expText}\n`;
    
    try {
      await navigator.clipboard.writeText(text);
      const icon = btn.querySelector('.icon');
      icon.textContent = 'check';
      icon.style.color = 'var(--green)';
      setTimeout(() => {
        icon.textContent = 'content_copy';
        icon.style.color = '';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  });

  article.querySelector('.btn-delete-card').addEventListener('click', async () => {
    if (!confirm('Tem certeza que deseja excluir esta questão?')) return;
    
    chrome.storage.local.get(['binderStructure'], (result) => {
      const data = result.binderStructure;
      if (!Array.isArray(data)) return;
      
      const removeFromTree = (nodes, targetId) => {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === targetId) {
            nodes.splice(i, 1);
            return true;
          }
          if (nodes[i].children) {
            if (removeFromTree(nodes[i].children, targetId)) return true;
          }
        }
        return false;
      };
      
      if (removeFromTree(data, q.id)) {
        chrome.storage.local.set({ binderStructure: data });
      }
    });
  });

  return article;
}

function revealCard(card) {
  card.querySelector('.reveal-btn').hidden = true;
  card.querySelector('.card-answer').hidden = false;
  card.classList.add('answered');
  updateProgress();
}

function hideCard(card) {
  card.querySelector('.reveal-btn').hidden = false;
  card.querySelector('.card-answer').hidden = true;
  card.classList.remove('answered');
  updateProgress();
}

let total = 0;

function syncStickyOffsets() {
  const header = document.querySelector('header');
  if (!header) return;

  const headerHeight = Math.ceil(header.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--header-sticky-offset', `${headerHeight}px`);
}

function setupStickyOffsets() {
  const header = document.querySelector('header');
  if (!header) return;

  syncStickyOffsets();

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(syncStickyOffsets);
    observer.observe(header);
  }

  window.addEventListener('resize', syncStickyOffsets, { passive: true });
}

function updateProgress() {
  const answered = document.querySelectorAll('.card.answered:not(.hidden-card)').length;
  const visible = document.querySelectorAll('.card:not(.hidden-card)').length;
  const pct = visible > 0 ? Math.round(answered / visible * 100) : 0;
  document.getElementById('progressLabel').textContent = `${answered} de ${visible} respondidas`;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
}

function filterCards() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const hideAnswered = document.getElementById('chipHideAnswered').classList.contains('active');

  document.querySelectorAll('.card').forEach(card => {
    const text = card.querySelector('.card-question').textContent.toLowerCase();
    const isAnswered = card.classList.contains('answered');
    const matchesSearch = !q || text.includes(q);
    const hiddenByFilter = hideAnswered && isAnswered;
    card.classList.toggle('hidden-card', !matchesSearch || hiddenByFilter);
  });

  updateProgress();
}

function init(questions) {
  total = questions.length;

  const counterEl = document.getElementById('counterEl');
  counterEl.textContent = `${total} questão${total !== 1 ? 'ões' : ''}`;

  const cardList = document.getElementById('cardList');
  const emptyState = document.getElementById('emptyState');

  if (total === 0) {
    emptyState.querySelector('p').textContent = 'Nenhuma questão salva no fichário.';
    return;
  }

  emptyState.remove();

  const fragment = document.createDocumentFragment();
  questions.forEach((q, i) => fragment.appendChild(buildCard(q, i)));
  cardList.appendChild(fragment);

  updateProgress();

  document.getElementById('footer').textContent =
    `AnswerHunter — ${total} questão${total !== 1 ? 'ões' : ''} · gerado em ${new Date().toLocaleString('pt-BR')}`;

  // Search
  document.getElementById('searchInput').addEventListener('input', filterCards);

  // Hide answered chip
  document.getElementById('chipHideAnswered').addEventListener('click', function () {
    this.classList.toggle('active');
    filterCards();
  });

  // Reveal/hide all chip
  const chipReveal = document.getElementById('chipRevealAll');
  chipReveal.dataset.state = 'hide'; // starts as "hide all" meaning answers are hidden

  chipReveal.addEventListener('click', function () {
    const reveal = this.dataset.state === 'hide';
    document.querySelectorAll('.card:not(.hidden-card)').forEach(card => {
      reveal ? revealCard(card) : hideCard(card);
    });
    this.dataset.state = reveal ? 'reveal' : 'hide';
    this.innerHTML = reveal
      ? '<span class="icon">lock</span> Ocultar todas'
      : '<span class="icon">lock_open</span> Revelar todas';
  });

  // Reset progress
  document.getElementById('btnReset').addEventListener('click', () => {
    if (!confirm('Reiniciar todo o progresso desta sessão?')) return;
    document.querySelectorAll('.card').forEach(card => hideCard(card));
    chipReveal.dataset.state = 'hide';
    chipReveal.innerHTML = '<span class="icon">lock_open</span> Revelar todas';
    document.getElementById('chipHideAnswered').classList.remove('active');
    filterCards();
  });

  // Print
  document.getElementById('btnPrint').addEventListener('click', () => {
    window.print();
  });

  // Copy All
  document.getElementById('btnCopyAll').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const visibleCards = document.querySelectorAll('.card:not(.hidden-card)');
    if (visibleCards.length === 0) return;

    let text = '';
    visibleCards.forEach((card, idx) => {
      const qText = card.querySelector('.card-question').innerText;
      const aText = card.querySelector('.answer-final-box').innerText;
      const expText = card.querySelector('.answer-explanation') ? card.querySelector('.answer-explanation').innerText : '';
      text += `--- Questão ${idx + 1} ---\n${qText}\n\nResposta:\n${aText}\n`;
      if (expText) text += `\nExplicação:\n${expText}\n`;
      text += `\n`;
    });

    try {
      await navigator.clipboard.writeText(text);
      const icon = btn.querySelector('.icon');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<span class="icon" style="color: var(--green);">check</span> Copiado!';
      setTimeout(() => {
        btn.innerHTML = originalText;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy all', err);
    }
  });
}

// Load data from chrome.storage.local
chrome.storage.local.get(['binderStructure'], (result) => {
  const data = result.binderStructure;
  if (!Array.isArray(data) || data.length === 0) {
    document.getElementById('emptyState').querySelector('p').textContent =
      'Nenhuma questão salva. Use a extensão para salvar questões no fichário.';
  } else {
    init(collectQuestions(data));
  }
});

// Live sync: re-render whenever the binder is updated in the extension
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.binderStructure) return;
  const data = changes.binderStructure.newValue;
  const questions = Array.isArray(data) ? collectQuestions(data) : [];

  // Show toast notification
  const prev = document.querySelectorAll('.card').length;
  const next = questions.length;
  const diff = next - prev;

  // Rebuild card list preserving answered state
  const answeredIds = new Set(
    [...document.querySelectorAll('.card.answered')]
      .map(c => c.dataset.qid)
      .filter(Boolean)
  );

  const cardList = document.getElementById('cardList');
  cardList.innerHTML = '';

  if (questions.length === 0) {
    cardList.innerHTML = '<div class="empty-state"><span class="icon">folder_open</span><p>Nenhuma questão salva.</p></div>';
  } else {
    const fragment = document.createDocumentFragment();
    questions.forEach((q, i) => {
      const card = buildCard(q, i);
      if (answeredIds.has(q.id)) {
        card.querySelector('.reveal-btn').hidden = true;
        card.querySelector('.card-answer').hidden = false;
        card.classList.add('answered');
      }
      fragment.appendChild(card);
    });
    cardList.appendChild(fragment);
  }

  total = questions.length;
  document.getElementById('counterEl').textContent =
    `${total} questão${total !== 1 ? 'ões' : ''}`;
  document.getElementById('footer').textContent =
    `AnswerHunter — ${total} questão${total !== 1 ? 'ões' : ''} · atualizado em ${new Date().toLocaleString('pt-BR')}`;

  // Re-apply current filter
  filterCards();
  updateProgress();

  // Show inline sync toast
  if (diff !== 0) {
    showSyncToast(diff > 0 ? `+${diff} questão${Math.abs(diff) !== 1 ? 'ões' : ''} adicionada${Math.abs(diff) !== 1 ? 's' : ''}` : `${diff} questão${Math.abs(diff) !== 1 ? 'ões' : ''} removida${Math.abs(diff) !== 1 ? 's' : ''}`);
  }
});

function showSyncToast(msg) {
  let toast = document.getElementById('syncToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'syncToast';
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      background: #1A1A2E; color: #fff; padding: 10px 18px;
      border-radius: 10px; font-size: 0.82rem; font-weight: 600;
      display: flex; align-items: center; gap: 7px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      animation: fadeInUp 0.25s ease;
    `;
    document.head.insertAdjacentHTML('beforeend', `<style>
      @keyframes fadeInUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
    </style>`);
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span style="font-family:'Material Symbols Rounded';font-variation-settings:'FILL' 1;font-size:16px;">sync</span> ${msg}`;
  toast.style.display = 'flex';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

setupStickyOffsets();
