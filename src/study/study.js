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
    /\b(?:Revisar depois|Somente revis[aã]o)\b/i,
    /\bRevelar resposta\b/i,
    /\blightbulb\b/i,
    /\bcheck_circle\b/i,
    /\bbookmark(?:_add)?\b/i,
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
  const iconNoiseLineRe = /^(?:menu_book|quiz|forum|lightbulb|check_circle|content_copy|delete|folder|restart_alt|sync|summarize|bookmark|bookmark_add)$/i;
  const uiPhraseNoiseLineRe = /^(?:Explica(?:ç|c)[aã]o Passo a Passo|Testar se aprendi|Chat de d[úu]vida|Revelar resposta|Revisar depois|Somente revis[aã]o)$/i;
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

function updateReviewChipCounter() {
  const chip = document.getElementById('chipReviewOnly');
  if (!chip) return;

  const labelEl = chip.querySelector('.chip-label');
  if (!labelEl) return;

  const totalReview = document.querySelectorAll('.card.for-review').length;
  labelEl.textContent = totalReview > 0 ? `Somente revisão (${totalReview})` : 'Somente revisão';
}

function applyReviewLaterState(card, isReviewLater) {
  if (!card) return;

  card.classList.toggle('for-review', !!isReviewLater);
  card.dataset.reviewLater = isReviewLater ? '1' : '0';

  const badge = card.querySelector('.review-flag');
  if (badge) badge.classList.toggle('visible', !!isReviewLater);

  const btn = card.querySelector('.btn-review-card');
  if (!btn) return;

  btn.classList.toggle('active', !!isReviewLater);
  btn.title = isReviewLater ? 'Remover de revisar depois' : 'Marcar para revisar depois';

  const icon = btn.querySelector('.icon');
  if (icon) icon.textContent = isReviewLater ? 'bookmark' : 'bookmark_add';
}

function persistReviewLaterState(questionId, questionText, isReviewLater) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['binderStructure'], (result) => {
      const data = result.binderStructure;
      if (!Array.isArray(data)) {
        resolve(false);
        return;
      }

      const updateInTree = (nodes) => {
        for (const node of nodes) {
          if (node.type === 'question' && node.content) {
            const byId = questionId && node.id === questionId;
            const byContent = !questionId && node.content.question === questionText;
            if (byId || byContent) {
              if (isReviewLater) {
                node.content.reviewLater = true;
              } else {
                delete node.content.reviewLater;
              }
              return true;
            }
          }

          if (node.children && updateInTree(node.children)) {
            return true;
          }
        }
        return false;
      };

      const found = updateInTree(data);
      if (!found) {
        resolve(false);
        return;
      }

      chrome.storage.local.set({ binderStructure: data }, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  });
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
      <span class="review-flag${q.reviewLater ? ' visible' : ''}">
        <span class="icon">bookmark</span> Revisar depois
      </span>
      <div class="card-actions">
        <button class="card-action-btn btn-review-card${q.reviewLater ? ' active' : ''}" title="${q.reviewLater ? 'Remover de revisar depois' : 'Marcar para revisar depois'}" type="button">
          <span class="icon">${q.reviewLater ? 'bookmark' : 'bookmark_add'}</span>
        </button>
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
      <button class="btn-voice" type="button" title="Ler questão em voz alta">
        <span class="icon">record_voice_over</span> Ouvir
      </button>
      <button class="btn-tags" type="button" title="Gerar tags por IA" data-qid="${escH(q.id || '')}">
        <span class="icon">local_offer</span> Tags IA
      </button>
    </div>
    <div class="card-tags" id="tags_${escH(q.id || '')}"></div>
    
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

    <div class="answer-chat">
      <div class="chat-header">
        <span class="icon">forum</span>
        <span class="chat-header-title">Chat de Dúvida</span>
        <button class="chat-clear-btn" type="button" title="Limpar conversa" aria-label="Limpar conversa">
          <span class="icon">delete_sweep</span>
        </button>
      </div>
      <div class="chat-messages">
        <div class="chat-empty-state">
          <span class="icon">chat_bubble_outline</span>
          <p>Tire suas dúvidas sobre esta questão com o tutor de IA.</p>
        </div>
      </div>
      <div class="chat-input-row">
        <textarea class="chat-textarea" rows="1" placeholder="Pergunte sobre esta questão..." aria-label="Sua pergunta"></textarea>
        <button class="chat-send-btn" type="button" aria-label="Enviar mensagem">
          <span class="icon">send</span>
        </button>
      </div>
    </div>

    <div class="compare-wrap">
      <button class="compare-toggle-btn" type="button">
        <span class="icon">edit_note</span> Escrever antes de ver
      </button>
      <div class="compare-input-area" hidden>
        <textarea class="compare-textarea" rows="2" placeholder="Digite sua resposta aqui antes de revelar o gabarito…"></textarea>
      </div>
    </div>

    <button class="reveal-btn" type="button">
      <span class="icon">lightbulb</span> Revelar resposta
    </button>
    
    <div class="card-answer" hidden>
      <div class="compare-panel" hidden>
        <div class="compare-col user">
          <div class="compare-col-label"><span class="icon">person</span> Sua resposta</div>
          <div class="compare-col-text"></div>
        </div>
        <div class="compare-col correct">
          <div class="compare-col-label"><span class="icon">check_circle</span> Gabarito</div>
          <div class="compare-col-text"></div>
        </div>
      </div>

      <div class="answer-final-box">
        <span class="answer-badge"><span class="icon">check_circle</span> Gabarito</span>
        <span class="answer-text-content">
          ${parsedA.letter ? `<strong>${parsedA.letter})</strong> ` : ''}${escH(parsedA.text)}
        </span>
      </div>
      
      ${(() => {
        const srcs = Array.isArray(q.sources) && q.sources.length ? q.sources : (q.source ? [{ title: q.source, link: q.source }] : []);
        if (!srcs.length) return '';
        const links = srcs.map(s => {
          const url = String(s?.link || s || '').trim();
          const label = String(s?.title || url).trim();
          let host = '';
          try { host = new URL(url).hostname.replace(/^www\./i, ''); } catch (_) { host = label; }
          return url ? `<a href="${escH(url)}" target="_blank" rel="noopener noreferrer">${escH(host || label)}</a>` : escH(label);
        }).filter(Boolean).join(' · ');
        return links ? `<div class="answer-source"><span class="icon">link</span> ${links}</div>` : '';
      })()}

      <div class="sm2-rating-bar" id="sm2Bar_${escH(q.id || '')}">
        <div class="sm2-rating-label"><span class="icon">event_repeat</span> Revisão espaçada — como foi?</div>
        <div class="sm2-buttons">
          <button class="sm2-btn again" data-quality="0" type="button">
            <span class="icon">replay</span>
            Não lembrei
            <span class="sm2-next"></span>
          </button>
          <button class="sm2-btn hard" data-quality="1" type="button">
            <span class="icon">sentiment_dissatisfied</span>
            Difícil
            <span class="sm2-next"></span>
          </button>
          <button class="sm2-btn good" data-quality="2" type="button">
            <span class="icon">sentiment_satisfied</span>
            Bom
            <span class="sm2-next"></span>
          </button>
          <button class="sm2-btn easy" data-quality="3" type="button">
            <span class="icon">sentiment_very_satisfied</span>
            Fácil
            <span class="sm2-next"></span>
          </button>
        </div>
        <div class="sm2-done-badge" id="sm2Done_${escH(q.id || '')}">
          <span class="icon">check_circle</span>
          <span class="sm2-done-text"></span>
        </div>
      </div>
    </div>
    ${fmtDate(q.createdAt) ? `<div class="card-date">Salvo em ${fmtDate(q.createdAt)}</div>` : ''}
  `;

  applyReviewLaterState(article, Boolean(q.reviewLater));

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

  const btnReviewCard = article.querySelector('.btn-review-card');
  if (btnReviewCard) {
    btnReviewCard.addEventListener('click', async () => {
      const nextState = !article.classList.contains('for-review');
      applyReviewLaterState(article, nextState);
      updateReviewChipCounter();
      filterCards();

      const saved = await persistReviewLaterState(q.id, q.question, nextState);
      if (!saved) {
        applyReviewLaterState(article, !nextState);
        updateReviewChipCounter();
        filterCards();
        showSyncToast('Nao foi possivel salvar o marcador de revisao.');
        return;
      }

      showSyncToast(nextState ? 'Questao marcada para revisar depois.' : 'Questao removida da revisao.');
    });
  }

  const btnTest = article.querySelector('.btn-test-learning');
  if (btnTest) {
    btnTest.addEventListener('click', () => {
      openQuizModal(cleanQuestion, cleanAnswer);
    });
  }

  const btnChat = article.querySelector('.btn-chat-doubt');
  if (btnChat) {
    const chatPanel = article.querySelector('.answer-chat');
    const chatMessages = chatPanel.querySelector('.chat-messages');
    const chatTextarea = chatPanel.querySelector('.chat-textarea');
    const chatSendBtn = chatPanel.querySelector('.chat-send-btn');
    const chatClearBtn = chatPanel.querySelector('.chat-clear-btn');
    let chatHistory = [];

    // Toggle panel
    btnChat.addEventListener('click', () => {
      const isOpen = chatPanel.classList.toggle('visible');
      btnChat.classList.toggle('active', isOpen);
      if (isOpen) {
        setTimeout(() => chatTextarea.focus(), 50);
      }
    });

    // Auto-resize textarea
    chatTextarea.addEventListener('input', () => {
      chatTextarea.style.height = 'auto';
      chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 100) + 'px';
    });

    // Send on Enter (Shift+Enter for newline)
    chatTextarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
    chatSendBtn.addEventListener('click', sendChatMessage);

    // Clear chat
    chatClearBtn.addEventListener('click', () => {
      chatHistory = [];
      chatMessages.innerHTML = `
        <div class="chat-empty-state">
          <span class="icon">chat_bubble_outline</span>
          <p>Tire suas dúvidas sobre esta questão com o tutor de IA.</p>
        </div>`;
    });

    async function sendChatMessage() {
      const userMsg = chatTextarea.value.trim();
      if (!userMsg) return;

      // Remove empty state if present
      const emptyState = chatMessages.querySelector('.chat-empty-state');
      if (emptyState) emptyState.remove();

      // Add user bubble
      appendChatBubble(chatMessages, 'user', userMsg);
      chatHistory.push({ role: 'user', content: userMsg });

      // Clear + disable input
      chatTextarea.value = '';
      chatTextarea.style.height = 'auto';
      chatSendBtn.disabled = true;
      chatTextarea.disabled = true;

      // Typing indicator
      const typingEl = appendTypingIndicator(chatMessages);

      try {
        const response = await ApiService.answerFollowUp(
          cleanQuestion, cleanAnswer, q.source || '', userMsg, chatHistory.slice(0, -1)
        );
        typingEl.remove();
        const aiText = response || 'Desculpe, não consegui gerar uma resposta. Tente novamente.';
        appendChatBubble(chatMessages, 'ai', aiText);
        chatHistory.push({ role: 'assistant', content: aiText });
      } catch (err) {
        typingEl.remove();
        appendChatBubble(chatMessages, 'ai', 'Erro ao conectar com a IA. Verifique suas configurações e tente novamente.');
      } finally {
        chatSendBtn.disabled = false;
        chatTextarea.disabled = false;
        chatTextarea.focus();
      }
    }
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

  // Voice button
  const btnVoice = article.querySelector('.btn-voice');
  if (btnVoice) {
    btnVoice.addEventListener('click', () => {
      speakText(cleanQuestion, btnVoice);
    });
  }

  // Tags IA button
  const btnTags = article.querySelector('.btn-tags');
  const tagsContainer = article.querySelector(`#tags_${q.id || ''}`);
  if (btnTags && tagsContainer && q.id) {
    // Load cached tags from SM-2 storage
    loadSm2Data().then(data => {
      const entry = data[q.id];
      if (entry && entry.tags && entry.tags.length > 0) {
        renderCardTags(tagsContainer, entry.tags);
        btnTags.style.display = 'none';
      }
    });

    btnTags.addEventListener('click', async () => {
      btnTags.classList.add('loading');
      btnTags.innerHTML = '<span class="icon" style="animation:spin 1s linear infinite">autorenew</span> Gerando...';
      try {
        const tags = await ApiService.generateTags(cleanQuestion);
        if (tags && tags.length > 0) {
          renderCardTags(tagsContainer, tags);
          btnTags.style.display = 'none';
          // Cache tags in SM-2 data
          const data = await loadSm2Data();
          if (!data[q.id]) data[q.id] = {};
          data[q.id].tags = tags;
          saveSm2Data(data);
        } else {
          btnTags.classList.remove('loading');
          btnTags.innerHTML = '<span class="icon">local_offer</span> Tags IA';
        }
      } catch (err) {
        btnTags.classList.remove('loading');
        btnTags.innerHTML = '<span class="icon">local_offer</span> Tags IA';
      }
    });
  }

  // SM-2 rating buttons
  const sm2Bar = article.querySelector('.sm2-rating-bar');
  if (sm2Bar && q.id) {
    sm2Bar.querySelectorAll('.sm2-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const quality = parseInt(btn.dataset.quality);
        rateSm2(q.id, quality, sm2Bar, article.querySelector(`#sm2Done_${q.id}`));
      });
    });
  }

  // Compare toggle
  const compareToggle = article.querySelector('.compare-toggle-btn');
  const compareInputArea = article.querySelector('.compare-input-area');
  if (compareToggle && compareInputArea) {
    compareToggle.addEventListener('click', () => {
      const opening = compareInputArea.hidden;
      compareInputArea.hidden = !opening;

  // Comparar resposta: if user typed something, show side-by-side panel
  const compareTextarea = card.querySelector('.compare-textarea');
  const comparePanel = card.querySelector('.compare-panel');
  if (comparePanel && compareTextarea) {
    const userText = compareTextarea.value.trim();
    if (userText) {
      const qid = card.dataset.qid;
      if (qid) _userAnswers[qid] = userText;
      // Collapse input area
      const compareInputArea = card.querySelector('.compare-input-area');
      if (compareInputArea) compareInputArea.hidden = true;
      const toggleBtn = card.querySelector('.compare-toggle-btn');
      if (toggleBtn) toggleBtn.hidden = true;
      // Populate compare panel
      const correctText = card.querySelector('.answer-text-content')?.textContent?.trim() || '';
      comparePanel.querySelectorAll('.compare-col-text')[0].textContent = userText;
      comparePanel.querySelectorAll('.compare-col-text')[1].textContent = correctText;
      comparePanel.hidden = false;
    }
  }

      compareToggle.classList.toggle('active', opening);
      if (opening) {
        const ta = compareInputArea.querySelector('.compare-textarea');
        setTimeout(() => ta && ta.focus(), 30);
      }
    });
  }

  return article;
}

function revealCard(card) {
  card.querySelector('.reveal-btn').hidden = true;
  card.querySelector('.card-answer').hidden = false;
  card.classList.add('answered');
  // Show SM-2 rating bar if not already rated today
  const sm2Bar = card.querySelector('.sm2-rating-bar');
  if (sm2Bar) {
    const qid = card.dataset.qid;
    loadSm2Data().then(data => {
      const entry = data[qid];
      const todayStr = todayISO();
      if (entry && entry.lastRated === todayStr) {
        // Already rated today - show done badge instead
        showSm2DoneBadge(sm2Bar, card.querySelector('[id^="sm2Done_"]'), entry);
      } else {
        sm2Bar.classList.add('show');
        // Populate "next review" labels
        updateSm2Labels(sm2Bar, entry);
      }
    });
  }
  updateProgress();
}

function hideCard(card) {
  card.querySelector('.reveal-btn').hidden = false;
  card.querySelector('.card-answer').hidden = true;
  card.classList.remove('answered');
  updateProgress();
}

let total = 0;
let allQuestions = [];

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

function syncSidebarSessionInfo() {
  const counterEl = document.getElementById('counterEl');
  const progressEl = document.getElementById('progressLabel');
  const sideCounter = document.getElementById('sideCounterText');
  const sideProgress = document.getElementById('sideProgressText');
  if (counterEl && sideCounter) sideCounter.textContent = counterEl.textContent || '0 questões';
  if (progressEl && sideProgress) sideProgress.textContent = progressEl.textContent || '0 de 0 respondidas';
}

function setupSidebarProxyClicks() {
  document.addEventListener('click', event => {
    const proxyBtn = event.target.closest('[data-proxy-click]');
    if (!proxyBtn) return;
    const targetId = proxyBtn.getAttribute('data-proxy-click');
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;
    target.click();
  });
}

function setupSidebarSessionSync() {
  syncSidebarSessionInfo();
  const counterEl = document.getElementById('counterEl');
  const progressEl = document.getElementById('progressLabel');
  if (!counterEl && !progressEl) return;
  const obs = new MutationObserver(syncSidebarSessionInfo);
  if (counterEl) obs.observe(counterEl, { childList: true, characterData: true, subtree: true });
  if (progressEl) obs.observe(progressEl, { childList: true, characterData: true, subtree: true });
}

function updateProgress() {
  const answered = document.querySelectorAll('.card.answered:not(.hidden-card)').length;
  const visible = document.querySelectorAll('.card:not(.hidden-card)').length;
  const pct = visible > 0 ? Math.round(answered / visible * 100) : 0;
  document.getElementById('progressLabel').textContent = `${answered} de ${visible} respondidas`;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  syncSidebarSessionInfo();
}

function filterCards() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const hideAnswered = document.getElementById('chipHideAnswered').classList.contains('active');
  const onlyReview = document.getElementById('chipReviewOnly').classList.contains('active');
  const onlySm2Due = document.getElementById('chipSm2Due')?.classList.contains('active');
  const onlyErrors = document.getElementById('chipErrors')?.classList.contains('active');

  document.querySelectorAll('.card').forEach(card => {
    const text = card.querySelector('.card-question').textContent.toLowerCase();
    const isAnswered = card.classList.contains('answered');
    const isReviewLater = card.classList.contains('for-review');
    const qid = card.dataset.qid;
    const sm2Entry = _sm2Cache[qid];
    const isDue = onlySm2Due ? sm2IsDue(sm2Entry) : true;
    const hasErrors = onlyErrors ? (sm2Entry && (sm2Entry.errors || 0) > 0) : true;
    const matchesSearch = !q || text.includes(q);
    const hiddenByFilter = hideAnswered && isAnswered;
    const hiddenByReviewFilter = onlyReview && !isReviewLater;
    const hiddenBySm2Filter = onlySm2Due && !isDue;
    const hiddenByErrorFilter = onlyErrors && !hasErrors;
    card.classList.toggle('hidden-card', !matchesSearch || hiddenByFilter || hiddenByReviewFilter || hiddenBySm2Filter || hiddenByErrorFilter);
  });

  updateProgress();
}

function init(questions) {
  allQuestions = questions;
  total = questions.length;

  const counterEl = document.getElementById('counterEl');
  counterEl.textContent = `${total} questão${total !== 1 ? 'ões' : ''}`;

  syncSidebarSessionInfo();
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

  updateReviewChipCounter();
  updateProgress();
  // Initialize SM-2 due badge
  setTimeout(() => updateSm2DueBadge(), 300);

  document.getElementById('footer').textContent =
    `AnswerHunter — ${total} questão${total !== 1 ? 'ões' : ''} · gerado em ${new Date().toLocaleString('pt-BR')}`;

  // Search
  document.getElementById('searchInput').addEventListener('input', filterCards);

  // Hide answered chip
  document.getElementById('chipHideAnswered').addEventListener('click', function () {
    this.classList.toggle('active');
    filterCards();
  });

  // Review later filter chip
  document.getElementById('chipReviewOnly').addEventListener('click', function () {
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
    document.getElementById('chipReviewOnly').classList.remove('active');
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
  allQuestions = questions;

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
  updateReviewChipCounter();
  filterCards();
  updateProgress();
  syncSidebarSessionInfo();

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

// ══ Revisão Espaçada SM-2 ════════════════════════════════════════════════════

const SM2_STORAGE_KEY = 'ah_sm2Data';
let _sm2Cache = {};
let _userAnswers = {}; // qid → user's typed answer (for Comparar)

function todayISO() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function sm2Calculate(entry, quality) {
  // quality: 0=Again, 1=Hard, 2=Good, 3=Easy
  let { interval = 1, repetition = 0, ef = 2.5 } = entry || {};

  if (quality === 0) {
    // Forgot: reset
    repetition = 0;
    interval = 1;
  } else {
    if (repetition === 0) interval = 1;
    else if (repetition === 1) interval = 6;
    else interval = Math.round(interval * ef);
    repetition++;
  }
  // Update EF: clamp between 1.3 and 3.0
  ef = Math.max(1.3, Math.min(3.0, ef + 0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02)));

  const today = todayISO();
  const nextReview = addDays(today, interval);
  return { interval, repetition, ef, nextReview, lastRated: today };
}

function sm2IsDue(entry) {
  if (!entry || !entry.nextReview) return true; // never reviewed = due
  return entry.nextReview <= todayISO();
}

function sm2NextLabel(entry, quality) {
  const next = sm2Calculate(entry, quality);
  if (next.interval === 1) return 'amanhã';
  if (next.interval < 7) return `${next.interval} dias`;
  if (next.interval < 30) return `${Math.round(next.interval / 7)}sem`;
  return `${Math.round(next.interval / 30)}mês`;
}

function updateSm2Labels(bar, entry) {
  const buttons = bar.querySelectorAll('.sm2-btn');
  buttons.forEach(btn => {
    const q = parseInt(btn.dataset.quality);
    const label = btn.querySelector('.sm2-next');
    if (label) label.textContent = sm2NextLabel(entry, q);
  });
}

function showSm2DoneBadge(bar, doneEl, entry) {
  bar.classList.add('show');
  bar.querySelector('.sm2-buttons').style.display = 'none';
  if (doneEl) {
    doneEl.classList.add('show');
    const interval = entry.interval || 1;
    const label = interval === 1 ? 'amanhã' : `em ${interval} dia${interval !== 1 ? 's' : ''}`;
    doneEl.querySelector('.sm2-done-text').textContent = `Avaliado hoje — próxima revisão ${label}`;
  }
}

async function loadSm2Data() {
  return new Promise(resolve => {
    chrome.storage.local.get([SM2_STORAGE_KEY], result => {
      const data = result[SM2_STORAGE_KEY] || {};
      _sm2Cache = data;
      resolve(data);
    });
  });
}

async function saveSm2Data(data) {
  _sm2Cache = data;
  return new Promise(resolve => {
    chrome.storage.local.set({ [SM2_STORAGE_KEY]: data }, resolve);
  });
}

async function rateSm2(qid, quality, sm2Bar, doneEl) {
  const data = await loadSm2Data();
  const entry = data[qid] || {};
  const newEntry = sm2Calculate(entry, quality);
  // Track error count for Caderno de Erros
  newEntry.errors = (entry.errors || 0) + (quality === 0 ? 1 : 0);
  newEntry.totalRatings = (entry.totalRatings || 0) + 1;
  data[qid] = newEntry;
  await saveSm2Data(data);

  // Update XP
  awardXP(quality === 0 ? 2 : quality === 1 ? 5 : quality === 2 ? 10 : 15);

  // Update UI
  showSm2DoneBadge(sm2Bar, doneEl, newEntry);
  updateSm2DueBadge();
}

async function updateSm2DueBadge() {
  const data = await loadSm2Data();
  const dueCount = allQuestions.filter(q => sm2IsDue(data[q.id])).length;
  const countEl = document.getElementById('sm2DueCount');
  const chip = document.getElementById('chipSm2Due');
  if (countEl) {
    countEl.textContent = dueCount;
    countEl.style.display = dueCount > 0 ? 'inline' : 'none';
  }
  if (chip) chip.title = `${dueCount} questões para revisar hoje`;
  return dueCount;
}

// SM-2 chip filter
const chipSm2Due = document.getElementById('chipSm2Due');
if (chipSm2Due) {
  chipSm2Due.addEventListener('click', async function () {
    this.classList.toggle('active');
    await loadSm2Data(); // refresh cache
    filterCards();
  });
}

// Initialize SM-2 badge when page loads
document.addEventListener('DOMContentLoaded', () => {
  if (allQuestions.length > 0) updateSm2DueBadge();
});
// Also update after init is called (via `init` setting allQuestions first)

// ══ Chat de Dúvida helpers ════════════════════════════════════════════════════

function appendChatBubble(container, role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;

  const avatarIcon = role === 'ai' ? 'smart_toy' : 'person';
  // Render markdown-lite: bold, line breaks
  const rendered = escH(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  bubble.innerHTML = `
    <div class="chat-avatar"><span class="icon">${avatarIcon}</span></div>
    <div class="chat-bubble-text">${rendered}</div>`;

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

function appendTypingIndicator(container) {
  const el = document.createElement('div');
  el.className = 'chat-bubble ai';
  el.innerHTML = `
    <div class="chat-avatar"><span class="icon">smart_toy</span></div>
    <div class="chat-typing">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

// ══ Quiz Interativo ══════════════════════════════════════════════════════════

const quizOverlay = document.getElementById('quizOverlay');
const quizModalBody = document.getElementById('quizModalBody');
const quizModalFooter = document.getElementById('quizModalFooter');
const quizScoreBadge = document.getElementById('quizScoreBadge');
const quizScoreText = document.getElementById('quizScoreText');
const quizModalClose = document.getElementById('quizModalClose');
const quizCloseFooterBtn = document.getElementById('quizCloseFooterBtn');
const quizRetryBtn = document.getElementById('quizRetryBtn');

let _quizState = { current: null, total: 0, correct: 0 };

function openQuizModal(question, answer) {
  _quizState.current = { question, answer };
  quizOverlay.removeAttribute('hidden');
  // rAF to trigger CSS transition
  requestAnimationFrame(() => {
    requestAnimationFrame(() => quizOverlay.classList.add('open'));
  });
  quizModalFooter.style.display = 'none';
  document.body.style.overflow = 'hidden';
  renderQuizLoading();
  loadQuizQuestion(question);
}

function closeQuizModal() {
  quizOverlay.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => {
    quizOverlay.setAttribute('hidden', '');
    quizModalBody.innerHTML = '';
    quizModalFooter.style.display = 'none';
  }, 220);
}

async function loadQuizQuestion(question) {
  renderQuizLoading();
  try {
    const data = await ApiService.generateSimilarQuestion(question);
    if (!data || !data.questionText || !data.optionsMap || !data.answerLetter) {
      renderQuizError('Não foi possível gerar a questão. Tente novamente.');
      return;
    }
    renderQuizQuestion(data);
  } catch (err) {
    renderQuizError('Erro ao gerar questão: ' + (err?.message || 'Falha na IA'));
  }
}

function renderQuizLoading() {
  quizModalFooter.style.display = 'none';
  quizModalBody.innerHTML = `
    <div class="quiz-loading">
      <span class="icon spin-icon">autorenew</span>
      <p>Gerando questão similar...</p>
    </div>`;
}

function renderQuizError(msg) {
  quizModalBody.innerHTML = `
    <div class="quiz-loading">
      <span class="icon" style="font-size:36px;color:#EF4444">error_outline</span>
      <p style="color:#EF4444">${escH(msg)}</p>
    </div>`;
  quizModalFooter.style.display = 'flex';
}

function renderQuizQuestion(data) {
  const { questionText, optionsMap, answerLetter } = data;
  const letters = Object.keys(optionsMap).filter(k => optionsMap[k]);

  const optionsHtml = letters.map(letter => `
    <button class="quiz-option" data-letter="${escH(letter)}" type="button" aria-pressed="false">
      <span class="quiz-option-letter">${escH(letter)}</span>
      <span class="quiz-option-text">${escH(optionsMap[letter])}</span>
      <span class="quiz-option-result-icon"><span class="icon" style="font-size:20px"></span></span>
    </button>`).join('');

  quizModalBody.innerHTML = `
    <div class="quiz-context-badge">
      <span class="icon">school</span>
      Questão similar gerada por IA
    </div>
    <div class="quiz-question-text">${escH(questionText)}</div>
    <div class="quiz-options" id="quizOptions">${optionsHtml}</div>
    <div class="quiz-result-banner" id="quizResultBanner">
      <span class="icon"></span>
      <span id="quizResultText"></span>
    </div>
    <div class="quiz-explanation" id="quizExplanation"></div>
    <button class="quiz-confirm-btn" id="quizConfirmBtn" disabled type="button">
      Confirmar resposta
    </button>`;

  let selectedLetter = null;
  const confirmBtn = quizModalBody.querySelector('#quizConfirmBtn');
  const optionBtns = quizModalBody.querySelectorAll('.quiz-option');

  optionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      selectedLetter = btn.dataset.letter;
      optionBtns.forEach(b => {
        b.classList.toggle('selected', b.dataset.letter === selectedLetter);
        b.setAttribute('aria-pressed', b.dataset.letter === selectedLetter ? 'true' : 'false');
      });
      confirmBtn.disabled = false;
    });
  });

  confirmBtn.addEventListener('click', () => {
    if (!selectedLetter) return;
    revealQuizResult(selectedLetter, answerLetter, optionBtns, questionText, optionsMap);
  });

  quizModalFooter.style.display = 'none';
}

function revealQuizResult(selected, correct, optionBtns, questionText, optionsMap) {
  const isCorrect = selected === correct;

  // Update score
  _quizState.total += 1;
  if (isCorrect) _quizState.correct += 1;
  quizScoreText.textContent = `${_quizState.correct}/${_quizState.total}`;
  quizScoreBadge.classList.add('show');

  // Style options
  optionBtns.forEach(btn => {
    btn.disabled = true;
    const letter = btn.dataset.letter;
    const icon = btn.querySelector('.quiz-option-result-icon .icon');
    btn.classList.remove('selected');
    if (letter === correct) {
      btn.classList.add('correct');
      icon.textContent = 'check_circle';
    } else if (letter === selected && !isCorrect) {
      btn.classList.add('wrong');
      icon.textContent = 'cancel';
    }
  });

  // Disable confirm
  const confirmBtn = quizModalBody.querySelector('#quizConfirmBtn');
  if (confirmBtn) confirmBtn.style.display = 'none';

  // Result banner
  const banner = quizModalBody.querySelector('#quizResultBanner');
  const bannerIcon = banner.querySelector('.icon');
  const bannerText = banner.querySelector('#quizResultText');
  banner.classList.add('show');
  if (isCorrect) {
    banner.classList.add('correct');
    bannerIcon.textContent = 'check_circle';
    bannerText.textContent = 'Correto! Você acertou essa questão.';
  } else {
    banner.classList.add('wrong');
    bannerIcon.textContent = 'cancel';
    bannerText.textContent = `Incorreto. A resposta certa era a alternativa ${correct}: ${optionsMap[correct]}`;
  }

  // Explanation
  const expBox = quizModalBody.querySelector('#quizExplanation');
  expBox.classList.add('show');
  expBox.innerHTML = `<strong>Por que ${correct} é a correta?</strong> Esta questão testa o mesmo conceito da questão original. A alternativa correta é <strong>${escH(correct)}: ${escH(optionsMap[correct])}</strong>.`;

  // Show footer
  quizModalFooter.style.display = 'flex';
}

// Modal controls
quizModalClose.addEventListener('click', closeQuizModal);
quizCloseFooterBtn.addEventListener('click', closeQuizModal);
quizRetryBtn.addEventListener('click', () => {
  if (_quizState.current) {
    quizModalFooter.style.display = 'none';
    loadQuizQuestion(_quizState.current.question);
  }
});

// Close on overlay click
quizOverlay.addEventListener('click', e => {
  if (e.target === quizOverlay) closeQuizModal();
});

// ESC key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !quizOverlay.hasAttribute('hidden')) closeQuizModal();
});

// ══ Simulado Cronometrado ════════════════════════════════════════════════════

const simOverlay = document.getElementById('simOverlay');
const simModalBody = document.getElementById('simModalBody');
const simHeaderSub = document.getElementById('simHeaderSub');
const simCloseBtn = document.getElementById('simCloseBtn');
const btnSimulado = document.getElementById('btnSimulado');

let _sim = {
  questions: [], idx: 0, results: [],
  timerInterval: null, elapsed: 0, timeLimitSec: 0,
  nQuestions: 10
};

function openSimulado() {
  simOverlay.removeAttribute('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => simOverlay.classList.add('open')));
  document.body.style.overflow = 'hidden';
  simHeaderSub.textContent = 'Configure e inicie seu simulado';
  renderSimSetup();
}

function closeSimulado() {
  clearInterval(_sim.timerInterval);
  simOverlay.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => simOverlay.setAttribute('hidden', ''), 220);
}

function renderSimSetup() {
  const available = allQuestions.length;
  const countOptions = [5, 10, 20, Math.min(available, 30)].filter((v, i, a) => a.indexOf(v) === i && v <= available);
  if (!countOptions.includes(available) && available > 0) countOptions.push(available);

  simModalBody.innerHTML = `
    <div class="sim-setup-section">
      <div class="sim-setup-label"><span class="icon">format_list_numbered</span> Número de questões</div>
      <div class="sim-options-grid" id="simCountGrid">
        ${countOptions.map(n => `
          <button class="sim-option-pill${n === 10 ? ' selected' : ''}" data-count="${n}" type="button">
            <span class="icon">apps</span>${n === available ? `Todas (${n})` : n}
          </button>`).join('')}
      </div>
    </div>
    <div class="sim-setup-section">
      <div class="sim-setup-label"><span class="icon">schedule</span> Tempo limite</div>
      <div class="sim-options-grid" id="simTimeGrid">
        <button class="sim-option-pill" data-time="300" type="button"><span class="icon">timer</span> 5 min</button>
        <button class="sim-option-pill selected" data-time="600" type="button"><span class="icon">timer</span> 10 min</button>
        <button class="sim-option-pill" data-time="1800" type="button"><span class="icon">timer</span> 30 min</button>
        <button class="sim-option-pill" data-time="0" type="button"><span class="icon">all_inclusive</span> Sem limite</button>
      </div>
    </div>
    <button class="sim-start-btn" id="simStartBtn" type="button">
      <span class="icon">play_circle</span> Iniciar Simulado
    </button>`;

  let selectedCount = Math.min(10, available);
  let selectedTime = 600;

  // Count pills
  simModalBody.querySelectorAll('#simCountGrid .sim-option-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      simModalBody.querySelectorAll('#simCountGrid .sim-option-pill').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedCount = parseInt(btn.dataset.count);
    });
  });

  // Time pills
  simModalBody.querySelectorAll('#simTimeGrid .sim-option-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      simModalBody.querySelectorAll('#simTimeGrid .sim-option-pill').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedTime = parseInt(btn.dataset.time);
    });
  });

  simModalBody.querySelector('#simStartBtn').addEventListener('click', () => {
    startSimulado(selectedCount, selectedTime);
  });
}

function startSimulado(n, timeLimitSec) {
  // Shuffle and pick N questions
  const shuffled = [...allQuestions].sort(() => Math.random() - 0.5).slice(0, n);
  _sim = { questions: shuffled, idx: 0, results: [], timerInterval: null, elapsed: 0, timeLimitSec, nQuestions: n };
  renderSimQuestion();

  // Start timer
  _sim.timerInterval = setInterval(() => {
    _sim.elapsed++;
    updateSimTimer();
    if (timeLimitSec > 0 && _sim.elapsed >= timeLimitSec) {
      clearInterval(_sim.timerInterval);
      finishSimulado();
    }
  }, 1000);
}

function updateSimTimer() {
  const timerEl = document.getElementById('simTimer');
  if (!timerEl) return;
  const { elapsed, timeLimitSec } = _sim;
  let display, isWarning = false;
  if (timeLimitSec > 0) {
    const remaining = timeLimitSec - elapsed;
    isWarning = remaining <= 60;
    const m = Math.floor(Math.max(0, remaining) / 60).toString().padStart(2, '0');
    const s = (Math.max(0, remaining) % 60).toString().padStart(2, '0');
    display = `${m}:${s}`;
  } else {
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    display = `${m}:${s}`;
  }
  timerEl.textContent = display;
  timerEl.parentElement.classList.toggle('warning', isWarning);
}

function renderSimQuestion() {
  const { questions, idx } = _sim;
  const q = questions[idx];
  const total = questions.length;
  const pct = Math.round((idx / total) * 100);
  const cleanQ = sanitizeQuestionText(q.question || '');
  const cleanA = sanitizeAnswerText(q.answer || '');

  simHeaderSub.textContent = `Questão ${idx + 1} de ${total}`;

  simModalBody.innerHTML = `
    <div class="sim-progress-row">
      <span class="sim-progress-info">Questão ${idx + 1} / ${total}</span>
      <div class="sim-timer" id="simTimerWrap">
        <span class="icon">schedule</span>
        <span id="simTimer">--:--</span>
      </div>
    </div>
    <div class="sim-progress-bar-track">
      <div class="sim-progress-bar-fill" style="width:${pct}%"></div>
    </div>

    <div class="sim-q-number">Questão ${idx + 1}</div>
    <div class="sim-q-text">${escH(cleanQ)}</div>

    <div class="sim-answer-box" id="simAnswerBox">
      <div class="sim-answer-label"><span class="icon" style="font-size:13px">check_circle</span> Gabarito</div>
      <div class="sim-answer-text">${escH(cleanA)}</div>
    </div>

    <div class="sim-self-assess" id="simSelfAssess">
      <button class="sim-assess-btn correct" id="simCorrectBtn" type="button">
        <span class="icon">check_circle</span> Acertei
      </button>
      <button class="sim-assess-btn wrong" id="simWrongBtn" type="button">
        <span class="icon">cancel</span> Errei
      </button>
    </div>

    <button class="sim-reveal-btn" id="simRevealBtn" type="button">
      <span class="icon">lightbulb</span> Revelar Gabarito
    </button>`;

  // Initial timer display
  updateSimTimer();

  // Reveal gabarito
  simModalBody.querySelector('#simRevealBtn').addEventListener('click', () => {
    simModalBody.querySelector('#simAnswerBox').classList.add('show');
    simModalBody.querySelector('#simSelfAssess').classList.add('show');
    simModalBody.querySelector('#simRevealBtn').style.display = 'none';
  });

  // Self-assessment
  simModalBody.querySelector('#simCorrectBtn').addEventListener('click', () => recordSimResult(true));
  simModalBody.querySelector('#simWrongBtn').addEventListener('click', () => recordSimResult(false));
}

function recordSimResult(isCorrect) {
  const { questions, idx } = _sim;
  const q = questions[idx];
  const cleanQ = sanitizeQuestionText(q.question || '');
  const cleanA = sanitizeAnswerText(q.answer || '');
  _sim.results.push({ question: cleanQ, answer: cleanA, correct: isCorrect });
  _sim.idx++;

  if (_sim.idx >= _sim.questions.length) {
    finishSimulado();
  } else {
    renderSimQuestion();
  }
}

function finishSimulado() {
  clearInterval(_sim.timerInterval);
  const { results, elapsed } = _sim;
  const correct = results.filter(r => r.correct).length;
  const total = results.length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const mm = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const ss = (elapsed % 60).toString().padStart(2, '0');

  // Save history + award XP
  if (total > 0) {
    saveSimResult(correct, total, elapsed);
    awardXP(correct * 5);
  }

  simHeaderSub.textContent = 'Resultado final';

  // Conic gradient for score circle
  const degrees = Math.round((pct / 100) * 360);
  const emoji = pct >= 80 ? 'Excelente!' : pct >= 60 ? 'Bom resultado!' : pct >= 40 ? 'Continue praticando!' : 'Precisa praticar mais.';
  const wrong = total - correct;
  const missed = results.filter(r => !r.correct);

  simModalBody.innerHTML = `
    <div class="sim-results">
      <div class="sim-score-circle" style="background: conic-gradient(var(--green) ${degrees}deg, var(--green-bg) ${degrees}deg)">
        <div class="sim-score-inner">
          <span class="sim-score-pct">${pct}%</span>
          <span class="sim-score-pct-label">acertos</span>
        </div>
      </div>
      <div class="sim-results-title">${escH(emoji)}</div>
      <div class="sim-results-sub">${correct} de ${total} questões corretas</div>
      <div class="sim-stats-row">
        <div class="sim-stat-pill green"><span class="icon">check_circle</span> ${correct} certas</div>
        <div class="sim-stat-pill red"><span class="icon">cancel</span> ${wrong} erradas</div>
        <div class="sim-stat-pill"><span class="icon">schedule</span> ${mm}:${ss}</div>
      </div>
      ${missed.length > 0 ? `
        <div class="sim-missed-title"><span class="icon" style="font-size:14px">close</span> Questões que você errou</div>
        <div class="sim-missed-list">
          ${missed.map((r, i) => `
            <div class="sim-missed-item">
              <strong>Q${i + 1}:</strong> ${escH(r.question.slice(0, 120))}${r.question.length > 120 ? '…' : ''}
              <br><span style="color:#15803D">✓ ${escH(r.answer.slice(0, 100))}${r.answer.length > 100 ? '…' : ''}</span>
            </div>`).join('')}
        </div>` : '<div class="sim-stat-pill green" style="margin:0 auto"><span class="icon">emoji_events</span> Parabéns, gabaritou!</div>'}
      <div class="sim-results-footer">
        <button class="sim-result-btn secondary" id="simResultCloseBtn" type="button">
          <span class="icon">close</span> Fechar
        </button>
        <button class="sim-result-btn primary" id="simResultRetryBtn" type="button">
          <span class="icon">refresh</span> Novo simulado
        </button>
      </div>
    </div>`;

  simModalBody.querySelector('#simResultCloseBtn').addEventListener('click', closeSimulado);
  simModalBody.querySelector('#simResultRetryBtn').addEventListener('click', renderSimSetup);
}

// Toolbar button
btnSimulado.addEventListener('click', () => {
  if (allQuestions.length === 0) {
    alert('Nenhuma questão disponível para o simulado.');
    return;
  }
  openSimulado();
});

// Close btn
simCloseBtn.addEventListener('click', closeSimulado);

// Backdrop click
simOverlay.addEventListener('click', e => {
  if (e.target === simOverlay) closeSimulado();
});

// ══ Gamificação XP ══════════════════════════════════════════════════════════

const XP_STORAGE_KEY = 'ah_xpData';
const XP_PER_LEVEL = 100;

async function loadXPData() {
  return new Promise(resolve => {
    chrome.storage.local.get([XP_STORAGE_KEY], r => resolve(r[XP_STORAGE_KEY] || { xp: 0, level: 1 }));
  });
}

async function saveXPData(data) {
  return new Promise(resolve => chrome.storage.local.set({ [XP_STORAGE_KEY]: data }, resolve));
}

async function awardXP(amount) {
  const data = await loadXPData();
  data.xp = (data.xp || 0) + amount;
  const newLevel = Math.floor(data.xp / XP_PER_LEVEL) + 1;
  const leveledUp = newLevel > (data.level || 1);
  data.level = newLevel;
  await saveXPData(data);

  // Show XP toast
  const toast = document.createElement('div');
  toast.className = 'xp-toast';
  toast.innerHTML = `<span class="icon">bolt</span>+${amount} XP`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1900);

  if (leveledUp) {
    setTimeout(() => {
      showSyncToast(`Nível ${newLevel} alcançado! +XP`);
    }, 400);
  }
}

// ══ Simulado History ═════════════════════════════════════════════════════════

const SIM_HISTORY_KEY = 'ah_simHistory';

async function loadSimHistory() {
  return new Promise(resolve => {
    chrome.storage.local.get([SIM_HISTORY_KEY], r => resolve(r[SIM_HISTORY_KEY] || []));
  });
}

async function saveSimResult(correct, total, elapsed) {
  const history = await loadSimHistory();
  history.unshift({
    date: new Date().toLocaleDateString('pt-BR'),
    correct, total,
    pct: Math.round((correct / total) * 100),
    elapsed,
  });
  // Keep last 20
  if (history.length > 20) history.splice(20);
  return new Promise(resolve => chrome.storage.local.set({ [SIM_HISTORY_KEY]: history }, resolve));
}

// ══ Dashboard de Desempenho ══════════════════════════════════════════════════

const dashOverlay = document.getElementById('dashOverlay');
const dashBody = document.getElementById('dashBody');
const dashCloseBtn = document.getElementById('dashCloseBtn');
const btnDashboard = document.getElementById('btnDashboard');

function openDashboard() {
  dashOverlay.removeAttribute('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => dashOverlay.classList.add('open')));
  document.body.style.overflow = 'hidden';
  renderDashboard();
}

function closeDashboard() {
  dashOverlay.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => dashOverlay.setAttribute('hidden', ''), 220);
}

async function renderDashboard() {
  dashBody.innerHTML = `<div class="quiz-loading"><span class="icon spin-icon">autorenew</span><p>Carregando dados...</p></div>`;

  const [sm2Data, simHistory, xpData] = await Promise.all([
    loadSm2Data(), loadSimHistory(), loadXPData()
  ]);

  const total = allQuestions.length;
  const sm2Entries = Object.values(sm2Data);
  const reviewed = sm2Entries.length;
  const mastered = sm2Entries.filter(e => e.interval >= 21).length;
  const dueToday = allQuestions.filter(q => sm2IsDue(sm2Data[q.id])).length;
  const predictedScore = calcPredictedScore(sm2Data, allQuestions);

  // XP
  const { xp, level } = xpData;
  const xpInLevel = xp % XP_PER_LEVEL;
  const xpPct = Math.round((xpInLevel / XP_PER_LEVEL) * 100);

  // Hardest cards (lowest ef, min 1 rating)
  const ratedCards = allQuestions
    .filter(q => sm2Data[q.id] && sm2Data[q.id].totalRatings > 0)
    .map(q => ({ q, entry: sm2Data[q.id] }))
    .sort((a, b) => (a.entry.ef || 2.5) - (b.entry.ef || 2.5))
    .slice(0, 5);

  // Format elapsed
  const fmtElapsed = s => {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  dashBody.innerHTML = `
    <div class="dash-stats-grid">
      <div class="dash-stat-card blue">
        <div class="dash-stat-value">${total}</div>
        <div class="dash-stat-label">Total</div>
      </div>
      <div class="dash-stat-card purple">
        <div class="dash-stat-value">${reviewed}</div>
        <div class="dash-stat-label">Revisadas</div>
      </div>
      <div class="dash-stat-card green">
        <div class="dash-stat-value">${mastered}</div>
        <div class="dash-stat-label">Dominadas</div>
      </div>
      <div class="dash-stat-card orange">
        <div class="dash-stat-value">${dueToday}</div>
        <div class="dash-stat-label">Due Hoje</div>
      </div>
    </div>

    ${predictedScore !== null ? `
    <div class="prediction-section">
      <div class="prediction-score">${predictedScore}%</div>
      <div class="prediction-label">Predição de nota (baseada em EF + domínio)</div>
    </div>` : ''}

    <div class="dash-xp-section">
      <div class="dash-section-title"><span class="icon">bolt</span> Progresso XP</div>
      <div class="dash-xp-row">
        <span class="dash-xp-label">Nível ${level}</span>
        <span class="dash-xp-val">${xp} XP total · ${xpInLevel}/${XP_PER_LEVEL}</span>
      </div>
      <div class="dash-xp-track">
        <div class="dash-xp-fill" style="width:${xpPct}%"></div>
      </div>
    </div>

    ${ratedCards.length > 0 ? `
    <div class="dash-section-title" style="margin-bottom:8px"><span class="icon">trending_down</span> Questões mais difíceis</div>
    <div class="dash-hard-list">
      ${ratedCards.map(({ q, entry }) => {
        const ef = (entry.ef || 2.5).toFixed(1);
        const efClass = entry.ef < 1.8 ? 'hard' : entry.ef < 2.2 ? 'medium' : 'easy';
        const cleanQ = sanitizeQuestionText(q.question || '').slice(0, 80);
        return `<div class="dash-hard-item">
          <div class="dash-ef-badge ${efClass}">EF<br>${ef}</div>
          <div class="dash-hard-text">${escH(cleanQ)}${cleanQ.length >= 80 ? '…' : ''}</div>
          ${entry.errors > 0 ? `<div class="dash-hard-errors">${entry.errors}× ✗</div>` : ''}
        </div>`;
      }).join('')}
    </div>` : ''}

    ${simHistory.length > 0 ? `
    <div class="dash-section-title" style="margin-top:10px;margin-bottom:8px"><span class="icon">history</span> Histórico de Simulados</div>
    <table class="dash-sim-table">
      <thead><tr><th>Data</th><th>Questões</th><th>Resultado</th><th>Tempo</th></tr></thead>
      <tbody>
        ${simHistory.slice(0, 8).map(s => {
          const scoreClass = s.pct >= 70 ? 'high' : s.pct >= 40 ? 'mid' : 'low';
          return `<tr>
            <td>${s.date}</td>
            <td>${s.total}q</td>
            <td><span class="dash-sim-score ${scoreClass}">${s.correct}/${s.total} · ${s.pct}%</span></td>
            <td>${fmtElapsed(s.elapsed)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : `<div style="text-align:center;color:var(--muted);font-size:0.84rem;padding:20px 0">Nenhum simulado realizado ainda.</div>`}
  `;
}

btnDashboard.addEventListener('click', openDashboard);
dashCloseBtn.addEventListener('click', closeDashboard);
dashOverlay.addEventListener('click', e => { if (e.target === dashOverlay) closeDashboard(); });

// ══ Caderno de Erros chip ════════════════════════════════════════════════════

const chipErrors = document.getElementById('chipErrors');
if (chipErrors) {
  chipErrors.addEventListener('click', async function () {
    this.classList.toggle('active');
    await loadSm2Data();
    filterCards();
  });
}

// ══ Leitura em Voz Alta ══════════════════════════════════════════════════════

let _speechUtterance = null;

function speakText(text, btn) {
  if (!('speechSynthesis' in window)) {
    alert('Leitura em voz alta não suportada neste navegador.');
    return;
  }
  // If currently speaking this button's text, stop
  if (btn.classList.contains('speaking')) {
    window.speechSynthesis.cancel();
    btn.classList.remove('speaking');
    btn.innerHTML = '<span class="icon">record_voice_over</span> Ouvir';
    return;
  }

  // Cancel any current speech
  window.speechSynthesis.cancel();
  document.querySelectorAll('.btn-voice.speaking').forEach(b => {
    b.classList.remove('speaking');
    b.innerHTML = '<span class="icon">record_voice_over</span> Ouvir';
  });

  _speechUtterance = new SpeechSynthesisUtterance(text);
  _speechUtterance.lang = 'pt-BR';
  _speechUtterance.rate = 0.9;
  _speechUtterance.pitch = 1;

  // Find Portuguese voice if available
  const voices = window.speechSynthesis.getVoices();
  const ptVoice = voices.find(v => v.lang.startsWith('pt'));
  if (ptVoice) _speechUtterance.voice = ptVoice;

  btn.classList.add('speaking');
  btn.innerHTML = '<span class="icon">stop_circle</span> Parar';

  _speechUtterance.onend = () => {
    btn.classList.remove('speaking');
    btn.innerHTML = '<span class="icon">record_voice_over</span> Ouvir';
  };
  _speechUtterance.onerror = () => {
    btn.classList.remove('speaking');
    btn.innerHTML = '<span class="icon">record_voice_over</span> Ouvir';
  };

  window.speechSynthesis.speak(_speechUtterance);
}

// ══ Tags IA ══════════════════════════════════════════════════════════════════

function renderCardTags(container, tags) {
  container.innerHTML = tags.map(tag =>
    `<span class="card-tag"><span class="icon">local_offer</span>${escH(tag)}</span>`
  ).join('');
}

// ══ Exportar para Anki ═══════════════════════════════════════════════════════

document.getElementById('btnExportAnki').addEventListener('click', () => {
  const cards = document.querySelectorAll('.card:not(.hidden-card)');
  if (cards.length === 0) {
    alert('Nenhuma questão disponível para exportar.');
    return;
  }

  const lines = [];
  lines.push('#separator:Tab');
  lines.push('#html:false');
  lines.push('#notetype:Basic');

  cards.forEach(card => {
    const qEl = card.querySelector('.card-question');
    const aEl = card.querySelector('.answer-text-content');
    if (!qEl || !aEl) return;
    const q = qEl.innerText.replace(/\t|\n/g, ' ').trim();
    const a = aEl.innerText.replace(/\t|\n/g, ' ').trim();
    if (q && a) lines.push(`${q}\t${a}`);
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AnswerHunter_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);

  showSyncToast(`${cards.length} questão${cards.length !== 1 ? 'ões' : ''} exportada${cards.length !== 1 ? 's' : ''} para Anki`);
});

// ══ Predição de Nota (adicionada ao Dashboard) ════════════════════════════════

function calcPredictedScore(sm2Data, questions) {
  if (!questions.length) return null;
  const reviewed = questions.filter(q => sm2Data[q.id]);
  if (!reviewed.length) return null;
  const avgEF = reviewed.reduce((sum, q) => sum + (sm2Data[q.id].ef || 2.5), 0) / reviewed.length;
  // Normalize EF: 1.3 = 0%, 3.0 = 100%
  const pct = Math.round(((avgEF - 1.3) / (3.0 - 1.3)) * 100);
  const mastered = reviewed.filter(q => (sm2Data[q.id].interval || 0) >= 21).length;
  const mastery = Math.round((mastered / questions.length) * 100);
  // Weighted: 60% EF, 40% mastery
  return Math.round(0.6 * pct + 0.4 * mastery);
}

// ══ Modo Pomodoro ════════════════════════════════════════════════════════════

const POM_WORK = 25 * 60; // 25 min
const POM_BREAK = 5 * 60; // 5 min
let _pom = { running: false, isBreak: false, remaining: POM_WORK, intervalId: null };

function formatPomTime(sec) {
  return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
}

function updatePomDisplay() {
  const circle = document.getElementById('pomCircle');
  const timeEl = document.getElementById('pomTime');
  const labelEl = document.getElementById('pomLabel');
  const display = formatPomTime(_pom.remaining);
  if (circle) circle.textContent = display;
  if (timeEl) timeEl.textContent = display;
  const label = _pom.isBreak ? 'Pausa' : 'Foco';
  if (labelEl) labelEl.textContent = label;
  if (circle) {
    circle.classList.toggle('break', _pom.isBreak);
  }
}

function startPomodoro() {
  if (_pom.running) return;
  _pom.running = true;
  document.getElementById('pomPlayIcon').textContent = 'pause';
  _pom.intervalId = setInterval(() => {
    _pom.remaining--;
    updatePomDisplay();
    if (_pom.remaining <= 0) {
      clearInterval(_pom.intervalId);
      _pom.running = false;
      _pom.isBreak = !_pom.isBreak;
      _pom.remaining = _pom.isBreak ? POM_BREAK : POM_WORK;
      document.getElementById('pomPlayIcon').textContent = 'play_arrow';
      updatePomDisplay();
      showSyncToast(_pom.isBreak ? 'Hora da pausa! ☕ 5 minutos.' : 'Pausa encerrada! Hora de focar.');
      awardXP(_pom.isBreak ? 0 : 20);
    }
  }, 1000);
}

function pausePomodoro() {
  if (!_pom.running) return;
  clearInterval(_pom.intervalId);
  _pom.running = false;
  document.getElementById('pomPlayIcon').textContent = 'play_arrow';
}

function resetPomodoro() {
  clearInterval(_pom.intervalId);
  _pom.running = false;
  _pom.isBreak = false;
  _pom.remaining = POM_WORK;
// ══ #14 Mapa Mental ══════════════════════════════════════════════════════════

const mindMapOverlay  = document.getElementById('mindMapOverlay');
const mindMapCloseBtn = document.getElementById('mindMapCloseBtn');
const mindMapBody     = document.getElementById('mindMapBody');

function openMindMap() {
  mindMapOverlay.classList.add('open');
  renderMindMap();
}
function closeMindMap() {
  mindMapOverlay.classList.remove('open');
}

async function renderMindMap() {
  mindMapBody.innerHTML = `<div class="quiz-loading"><span class="icon spin-icon">autorenew</span><p>Construindo mapa…</p></div>`;

  const sm2Data = await loadSm2Data();
  const visible = allQuestions.filter(q => {
    const el = document.querySelector(`.card[data-qid="${q.id}"]`);
    return el && !el.classList.contains('hidden-card');
  });

  if (!visible.length) {
    mindMapBody.innerHTML = `<div class="mindmap-empty"><span class="icon" style="font-size:32px;display:block;margin-bottom:8px">search_off</span>Nenhuma questão visível para mapear.</div>`;
    return;
  }

  // Group by tags; fallback to "Geral"
  const map = new Map(); // tag → [{q, idx}]
  visible.forEach((q, i) => {
    const tags = sm2Data[q.id]?.tags;
    if (tags && tags.length > 0) {
      tags.forEach(tag => {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag).push({ q, i });
      });
    } else {
      const bucket = 'Geral';
      if (!map.has(bucket)) map.set(bucket, []);
      map.get(bucket).push({ q, i });
    }
  });

  // Sort topics: most questions first; "Geral" last
  const topics = [...map.entries()].sort((a, b) => {
    if (a[0] === 'Geral') return 1;
    if (b[0] === 'Geral') return -1;
    return b[1].length - a[1].length;
  });

  const topicPillColors = [
    '#4f46e5','#0284c7','#16a34a','#d97706','#dc2626',
    '#7c3aed','#0891b2','#65a30d','#ca8a04','#db2777'
  ];

  const legendHtml = topics.slice(0, 6).map(([ tag ], i) =>
    `<span class="mindmap-legend-pill" style="background:${topicPillColors[i % topicPillColors.length]}22;color:${topicPillColors[i % topicPillColors.length]}">${escH(tag)}</span>`
  ).join('');

  const blocksHtml = topics.map(([tag, items], ti) => {
    const color = topicPillColors[ti % topicPillColors.length];
    const nodesHtml = items.slice(0, 8).map(({ q, i }) => {
      const text = sanitizeQuestionText(q.question || '').slice(0, 90);
      return `<div class="mindmap-node"><span class="node-num">#${i + 1}</span>${escH(text)}${text.length >= 90 ? '…' : ''}</div>`;
    }).join('');
    const extra = items.length > 8 ? `<div class="mindmap-node" style="color:var(--muted);font-style:italic">+${items.length - 8} questões</div>` : '';
    return `
      <div class="mindmap-topic-block">
        <div class="mindmap-topic-pill" style="background:${color}">${escH(tag)}<br><small style="font-weight:400;font-size:0.72rem;opacity:.8">${items.length}q</small></div>
        <div class="mindmap-connector"></div>
        <div class="mindmap-nodes">${nodesHtml}${extra}</div>
      </div>`;
  }).join('');

  mindMapBody.innerHTML = `
    <div class="mindmap-legend">${legendHtml.length ? '<span>Tópicos:</span>' + legendHtml : ''}</div>
    <div class="mindmap-root">${blocksHtml}</div>
  `;
}

document.getElementById('btnMindMap').addEventListener('click', openMindMap);
mindMapCloseBtn.addEventListener('click', closeMindMap);
mindMapOverlay.addEventListener('click', e => { if (e.target === mindMapOverlay) closeMindMap(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && mindMapOverlay.classList.contains('open')) closeMindMap();
});

  document.getElementById('pomPlayIcon').textContent = 'play_arrow';
  updatePomDisplay();
}

document.getElementById('btnPomodoro').addEventListener('click', () => {
  const widget = document.getElementById('pomodoroWidget');
  widget.classList.toggle('visible');
  updatePomDisplay();
});

document.getElementById('pomPlayPause').addEventListener('click', () => {
  if (_pom.running) pausePomodoro();
  else startPomodoro();
});

document.getElementById('pomReset').addEventListener('click', resetPomodoro);

document.getElementById('pomClose').addEventListener('click', () => {
  pausePomodoro();
  document.getElementById('pomodoroWidget').classList.remove('visible');
});

setupStickyOffsets();
setupSidebarProxyClicks();
setupSidebarSessionSync();
