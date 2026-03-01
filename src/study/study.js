// study.js — AnswerHunter Study Page
// Reads binder data from chrome.storage.local and renders interactive study cards.

import { ApiService } from '../services/ApiService.js';
import { PedagogicalPromptsService } from '../services/PedagogicalPromptsService.js';
import { FSRSService } from '../services/FSRSService.js';

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

const MARK_OK = String.fromCodePoint(0x2705);
const MARK_SUMMARY = String.fromCodePoint(0x1F4A1);
const MARK_WRONG = String.fromCodePoint(0x274C);
const REV_MARKERS = {
  concept: String.fromCodePoint(0x1F4CC),
  definition: String.fromCodePoint(0x1F4D6),
  memorize: String.fromCodePoint(0x1F511),
  pitfall: String.fromCodePoint(0x26A0, 0xFE0F),
  mnemonic: String.fromCodePoint(0x1F9E0),
  related: String.fromCodePoint(0x1F517),
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
    
    // Correct answer header line
    if (line.startsWith(MARK_OK)) {
      result += `<div class="exp-correct-answer"><span class="icon">check_circle</span> ${line.slice(MARK_OK.length).trim()}</div>`;
      continue;
    }
    
    // Summary line
    if (line.startsWith(MARK_SUMMARY)) {
      result += `<div class="exp-summary"><span class="icon">lightbulb</span> ${line.slice(MARK_SUMMARY.length).trim()}</div>`;
      continue;
    }
    
    // Wrong alternative line
    if (line.startsWith(MARK_WRONG)) {
      result += `<div class="exp-wrong"><span class="icon">cancel</span> ${line.slice(MARK_WRONG.length).trim()}</div>`;
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

    // Section headers with markers (legacy marker-compatible)
    const reviewMarkerRegex = new RegExp(`^(${REV_MARKERS.concept}|${REV_MARKERS.definition}|${REV_MARKERS.memorize}|${REV_MARKERS.pitfall}|${REV_MARKERS.mnemonic}|${REV_MARKERS.related})\\s+(.*)`);
    const markerMatch = line.match(reviewMarkerRegex);
    if (markerMatch) {
      const marker = markerMatch[1];
      const title = markerMatch[2];
      let cls = 'rev-section';
      let icon = 'label';
      if (marker === REV_MARKERS.concept) { cls += ' rev-concept'; icon = 'push_pin'; }
      else if (marker === REV_MARKERS.definition) { cls += ' rev-definition'; icon = 'book_2'; }
      else if (marker === REV_MARKERS.memorize) { cls += ' rev-memorize'; icon = 'key'; }
      else if (marker === REV_MARKERS.pitfall) { cls += ' rev-pitfall'; icon = 'warning'; }
      else if (marker === REV_MARKERS.mnemonic) { cls += ' rev-mnemonic'; icon = 'neurology'; }
      else if (marker === REV_MARKERS.related) { cls += ' rev-related'; icon = 'link'; }
      result += `<div class="${cls}"><span class="rev-emoji icon">${icon}</span><span class="rev-title">${title}</span></div>`;
      continue;
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

  // Normalize: put options that use A) or A. delimiters onto their own line
  let normalized = safeText
    .replace(/([^\n])\s+([A-Ea-e][\)\.\-:])/g, '$1\n$2')
    // Also split bare "letter SPACE non-alpha" inline options e.g. "D .jsp E JSON" → "D .jsp\nE JSON"
    .replace(/([^\n])\s+\b([B-Eb-e])\s+([^a-z\d\n])/g, (_, pre, letter, after) =>
      `${pre}\n${letter} ${after}`
    );

  const lines = normalized.split('\n');
  const enunciado = [];
  const alternativas = [];

  // Strict: A) A. A- A: followed by space
  const strictOptRe = /^[A-Ea-e][\)\.\-:]\s/;
  // Relaxed: bare "A <non-alpha>" e.g. "A .csv", "A +x"  (space then non-letter/digit)
  const relaxedOptRe = /^([A-Ea-e])\s+([^A-Za-z\d\s])/;
  // Sequential (already in options): bare "E Word" where E matches next expected letter
  const seqOptRe = /^([A-Ea-e])\s+(\S)/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const expectedLetter = alternativas.length < 5
      ? String.fromCharCode(65 + alternativas.length) : null;

    const isStrict = strictOptRe.test(trimmed);
    const isRelaxed = !isStrict && relaxedOptRe.test(trimmed);
    // Sequential: already collecting options AND this line's first char is the expected letter
    const isSeq = !isStrict && !isRelaxed && alternativas.length > 0 &&
      expectedLetter && seqOptRe.test(trimmed) &&
      trimmed[0].toUpperCase() === expectedLetter;

    if (isStrict || isRelaxed || isSeq) {
      // Normalize "A .csv" → "A) .csv" for consistent downstream parsing
      const normalized2 = trimmed.replace(/^([A-Ea-e])\s+/, '$1) ');
      alternativas.push(stripOptionTailNoise(normalized2));
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

function persistAnswerKeyState(questionId, questionText, nextLetter, nextAnswerText) {
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
            const nodeId = String(node.id ?? '');
            const targetId = String(questionId ?? '');
            const byId = targetId && nodeId === targetId;
            const byContent = !targetId && node.content.question === questionText;
            if (byId || byContent) {
              const currentAnswer = String(node.content.answer || '').trim();
              const parsedCurrent = parseAnswer(currentAnswer);
              const baseSteps = String(parsedCurrent.steps || '').trim();
              const finalLine = `Letra ${nextLetter}: ${nextAnswerText}`;

              node.content.answer = baseSteps ? `${baseSteps}\n${finalLine}` : finalLine;
              node.content.updatedAt = Date.now();
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

  const subject = getQuestionSubject(q);
  article.dataset.subject = subject;

  const showFolder = q.folderPath && q.folderPath !== 'Raiz';
  const cleanQuestion = sanitizeQuestionText(q.question);
  let cleanAnswer = sanitizeAnswerText(q.answer);
  const parsedQ = parseQuestion(cleanQuestion);
  const parsedA = parseAnswer(cleanAnswer);

  article.innerHTML = `
    <div class="card-meta">
      <span class="card-num">#${index + 1}</span>
      ${showFolder ? `<span class="card-folder"><span class="icon">folder</span> ${escH(q.folderPath)}</span>` : ''}
      <span class="card-subject"><span class="icon">account_tree</span> ${escH(subject)}</span>
      <span class="review-flag${q.reviewLater ? ' visible' : ''}">
        <span class="icon">bookmark</span> Revisar depois
      </span>
      <div class="card-actions">
        <button class="card-action-btn btn-edit-answer" title="Editar gabarito" type="button">
          <span class="icon">edit</span>
        </button>
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
          ${parsedQ.alternativas.map((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            return `<button class="option-item" type="button" data-letter="${letter}" aria-pressed="false">${escH(opt)}</button>`;
          }).join('')}
        </div>
      ` : ''}
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

    <div class="jol-confidence-bar" id="jolBar_${escH(q.id || '')}" style="display:none">
  <div class="jol-label"><span class="icon">psychology</span> Antes de revelar — como você se sente?</div>
  <div class="jol-buttons">
    <button class="jol-btn" data-confidence="unsure" type="button">
      <span class="icon">help_outline</span> Não sei
    </button>
    <button class="jol-btn" data-confidence="think_so" type="button">
      <span class="icon">thumbs_up_down</span> Acho que sei
    </button>
    <button class="jol-btn" data-confidence="certain" type="button">
      <span class="icon">check_circle</span> Tenho certeza
    </button>
  </div>
</div>
<div class="jol-calibration-badge" id="jolBadge_${escH(q.id || '')}" style="display:none"></div>
    <div class="card-bottom-zone">
      <div class="card-primary-actions">
        <button class="reveal-btn" type="button">
          <span class="icon">lightbulb</span> Revelar resposta
        </button>
      </div>

      <div class="card-ai-strip">
        <button class="ai-strip-toggle" type="button" aria-expanded="false">
          <span class="icon">expand_more</span>
          Ferramentas de Estudo
          <span class="ai-strip-hint">IA • Áudio • Tags</span>
        </button>
        <div class="ai-tools-grid collapsed">
          <button class="answer-tool-btn btn-explanation" type="button">
            <span class="icon">menu_book</span> Explicação
          </button>
          <button class="answer-tool-btn btn-review" type="button">
            <span class="icon">summarize</span> Resumo
          </button>
          <button class="answer-tool-btn btn-test-learning" type="button">
            <span class="icon">quiz</span> Testar
          </button>
          <button class="answer-tool-btn btn-chat-doubt" type="button">
            <span class="icon">forum</span> Chat
          </button>
          <button class="btn-voice" type="button" title="Ler questão em voz alta">
            <span class="icon">record_voice_over</span> Ouvir
          </button>
          <button class="btn-tags" type="button" title="Gerar tags por IA" data-qid="${escH(q.id || '')}">
            <span class="icon">local_offer</span> Tags
          </button>
          <button class="answer-tool-btn btn-why-wrong" type="button" style="display:none">
            <span class="icon">psychology</span> Por que errei?
          </button>
          <button class="answer-tool-btn btn-hint" type="button">
            <span class="icon">lightbulb_circle</span> Dica
          </button>
          <button class="answer-tool-btn btn-mnemonic" type="button">
            <span class="icon">neurology</span> Mnemônico
          </button>
        </div>
        <div class="card-tags" id="tags_${escH(q.id || '')}"></div>
      </div>
    </div>
    
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
      <div class="why-wrong-panel" id="whyWrong_${escH(q.id || '')}" style="display:none">
        <div class="why-wrong-header"><span class="icon">psychology</span> Por que errei?</div>
        <div class="why-wrong-content"></div>
        <div class="why-wrong-loading" style="display:none">
          <span class="icon" style="animation:spin 1s linear infinite">autorenew</span> Analisando seu erro...
        </div>
      </div>
      <div class="hint-panel" id="hintPanel_${escH(q.id || '')}" style="display:none">
        <div class="hint-header"></div>
        <div class="hint-content"></div>
        <div class="hint-loading" style="display:none">
          <span class="icon" style="animation:spin 1s linear infinite">autorenew</span> Gerando dica...
        </div>
        <button class="btn-next-hint" type="button" style="display:none">
          <span class="icon">arrow_forward</span> Próxima dica
        </button>
      </div>
      <div class="mnemonic-panel" id="mnemonicPanel_${escH(q.id || '')}" style="display:none">
        <div class="mnemonic-header"><span class="icon">neurology</span> Mnemônico</div>
        <div class="mnemonic-content"></div>
        <div class="mnemonic-loading" style="display:none">
          <span class="icon" style="animation:spin 1s linear infinite">autorenew</span> Criando mnemônico...
        </div>
      </div>
    </div>
    ${fmtDate(q.createdAt) ? `<div class="card-date">Salvo em ${fmtDate(q.createdAt)}</div>` : ''}
  `;

  applyReviewLaterState(article, Boolean(q.reviewLater));

  // AI strip toggle
  const aiStripToggle = article.querySelector('.ai-strip-toggle');
  if (aiStripToggle) {
    aiStripToggle.addEventListener('click', () => {
      const grid = article.querySelector('.ai-tools-grid');
      const isOpen = !grid.classList.contains('collapsed');
      grid.classList.toggle('collapsed', isOpen);
      aiStripToggle.setAttribute('aria-expanded', String(!isOpen));
    });
  }

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
      openQuizModal(cleanQuestion, cleanAnswer, q.id);
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

  const btnEditAnswer = article.querySelector('.btn-edit-answer');
  if (btnEditAnswer) {
    btnEditAnswer.addEventListener('click', async () => {
      const optionItems = Array.from(article.querySelectorAll('.option-item'));
      if (!optionItems.length) {
        showSyncToast('Essa questão não possui alternativas para editar o gabarito.');
        return;
      }

      const validLetters = optionItems
        .map(item => String(item.dataset.letter || '').toUpperCase())
        .filter(Boolean);

      const currentLetter = String(article.dataset.correctLetter || '').toUpperCase() || validLetters[0];
      const optionsPreview = optionItems
        .map(item => `${String(item.dataset.letter || '').toUpperCase()}) ${String(item.textContent || '').replace(/^[A-Ea-e][\)\.\-:]\s*/, '').trim()}`)
        .join('\n');

      const typed = prompt(
        `Editar gabarito (digite a letra):\nAtual: ${currentLetter}\n\n${optionsPreview}`,
        currentLetter
      );
      if (typed === null) return;

      const nextLetter = String(typed).trim().charAt(0).toUpperCase();
      if (!validLetters.includes(nextLetter)) {
        showSyncToast('Letra inválida. Escolha uma alternativa existente.');
        return;
      }

      const targetOption = optionItems.find(item => String(item.dataset.letter || '').toUpperCase() === nextLetter);
      const nextAnswerText = String(targetOption?.textContent || '')
        .replace(/^[A-Ea-e][\)\.\-:]\s*/, '')
        .trim();

      btnEditAnswer.disabled = true;
      const saved = await persistAnswerKeyState(q.id, q.question, nextLetter, nextAnswerText || nextLetter);
      btnEditAnswer.disabled = false;

      if (!saved) {
        showSyncToast('Não foi possível salvar o novo gabarito.');
        return;
      }

      const newAnswerLine = `Letra ${nextLetter}: ${nextAnswerText || nextLetter}`;
      cleanAnswer = newAnswerLine;
      q.answer = newAnswerLine;

      article.dataset.correctLetter = nextLetter;
      const answerTextEl = article.querySelector('.answer-text-content');
      if (answerTextEl) {
        answerTextEl.innerHTML = `<strong>${nextLetter})</strong> ${escH(nextAnswerText || nextLetter)}`;
      }

      if (article.classList.contains('answered')) {
        const selectedEl = article.querySelector('.option-item.selected');
        const selectedLetter = String(selectedEl?.dataset.letter || '').toUpperCase();
        const selectedText = selectedEl?.textContent?.trim() || selectedLetter;
        revealCard(article, { selectedLetter, selectedText });
      }

      showSyncToast(`Gabarito atualizado para ${nextLetter}.`);
    });
  }

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
      const ok = await generateTagsForCardElement(article);
      if (ok) refreshSubjectOrganizationAfterTags();
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

  // ── JOL Confidence buttons ──
  const jolBar = article.querySelector(`#jolBar_${q.id || ''}`);
  const jolBadge = article.querySelector(`#jolBadge_${q.id || ''}`);
  let userConfidence = null;

  if (jolBar) {
    jolBar.querySelectorAll('.jol-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        userConfidence = btn.dataset.confidence;
        jolBar.querySelectorAll('.jol-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        // Enable reveal button visually
        const revealBtn = article.querySelector('.reveal-btn');
        if (revealBtn) revealBtn.classList.add('jol-ready');
      });
    });
  }

  // Show JOL bar when question has options (retrieval gate)
  if (jolBar && parsedQ.alternativas.length > 0) {
    jolBar.style.display = 'block';
  }

  // ── Por que errei? button ──
  const btnWhyWrong = article.querySelector('.btn-why-wrong');
  const whyWrongPanel = article.querySelector(`#whyWrong_${q.id || ''}`);
  if (btnWhyWrong && whyWrongPanel) {
    btnWhyWrong.addEventListener('click', async () => {
      const isVisible = whyWrongPanel.style.display !== 'none';
      if (isVisible) { whyWrongPanel.style.display = 'none'; return; }
      whyWrongPanel.style.display = 'block';
      const contentDiv = whyWrongPanel.querySelector('.why-wrong-content');
      const loadingDiv = whyWrongPanel.querySelector('.why-wrong-loading');
      if (contentDiv.innerHTML.trim()) return; // already generated
      contentDiv.style.display = 'none';
      loadingDiv.style.display = 'flex';
      try {
        const selectedEl = article.querySelector('.option-item.selected');
        const wrongLetter = String(selectedEl?.dataset.letter || '').toUpperCase();
        const wrongText = selectedEl?.textContent?.trim() || wrongLetter;
        const correctLetter = String(article.dataset.correctLetter || '').toUpperCase();
        const correctEl = article.querySelector(`.option-item[data-letter="${correctLetter}"]`);
        const correctText = correctEl?.textContent?.trim() || correctLetter;
        const subject = article.dataset.subject || '';
        const analysis = await PedagogicalPromptsService.generateWhyWrong(
          cleanQuestion, wrongLetter, wrongText, correctLetter, correctText, subject
        );
        contentDiv.innerHTML = parseMarkdown(analysis || 'Não foi possível gerar a análise.');
        contentDiv.style.display = 'block';
      } catch (e) {
        contentDiv.textContent = 'Erro ao gerar análise. Tente novamente.';
        contentDiv.style.display = 'block';
      } finally {
        loadingDiv.style.display = 'none';
      }
    });
  }

  // ── Dica Socrática button ──
  const btnHint = article.querySelector('.btn-hint');
  const hintPanel = article.querySelector(`#hintPanel_${q.id || ''}`);
  let currentHintLevel = 0;
  let lastHint = '';
  if (btnHint && hintPanel) {
    const hintHeader = hintPanel.querySelector('.hint-header');
    const hintContent = hintPanel.querySelector('.hint-content');
    const hintLoading = hintPanel.querySelector('.hint-loading');
    const btnNextHint = hintPanel.querySelector('.btn-next-hint');

    const loadHint = async () => {
      currentHintLevel = Math.min(currentHintLevel + 1, 3);
      hintHeader.innerHTML = `<span class="icon">lightbulb_circle</span> Dica ${currentHintLevel}/3`;
      hintContent.style.display = 'none';
      hintLoading.style.display = 'flex';
      try {
        const optMap = {};
        parsedQ.alternativas.forEach((alt, idx) => {
          optMap[String.fromCharCode(65 + idx)] = alt;
        });
        const hint = await PedagogicalPromptsService.generateSocraticHint(
          cleanQuestion, optMap, currentHintLevel, lastHint
        );
        lastHint = hint || '';
        hintContent.innerHTML = parseMarkdown(lastHint || 'Nenhuma dica disponível.');
        hintContent.style.display = 'block';
        if (btnNextHint) btnNextHint.style.display = currentHintLevel < 3 ? 'inline-flex' : 'none';
      } catch (e) {
        hintContent.textContent = 'Erro ao gerar dica. Tente novamente.';
        hintContent.style.display = 'block';
      } finally {
        hintLoading.style.display = 'none';
      }
    };

    btnHint.addEventListener('click', async () => {
      const isVisible = hintPanel.style.display !== 'none';
      if (isVisible && currentHintLevel > 0) { hintPanel.style.display = 'none'; return; }
      hintPanel.style.display = 'block';
      if (currentHintLevel === 0) await loadHint();
    });

    if (btnNextHint) {
      btnNextHint.addEventListener('click', loadHint);
    }
  }

  // ── Mnemônico button ──
  const btnMnemonic = article.querySelector('.btn-mnemonic');
  const mnemonicPanel = article.querySelector(`#mnemonicPanel_${q.id || ''}`);
  if (btnMnemonic && mnemonicPanel) {
    const mnemonicContent = mnemonicPanel.querySelector('.mnemonic-content');
    const mnemonicLoading = mnemonicPanel.querySelector('.mnemonic-loading');
    btnMnemonic.addEventListener('click', async () => {
      const isVisible = mnemonicPanel.style.display !== 'none';
      if (isVisible) { mnemonicPanel.style.display = 'none'; return; }
      mnemonicPanel.style.display = 'block';
      if (mnemonicContent.innerHTML.trim()) return; // already generated
      mnemonicContent.style.display = 'none';
      mnemonicLoading.style.display = 'flex';
      try {
        const concept = await PedagogicalPromptsService.extractConceptTag(cleanQuestion);
        const result = await PedagogicalPromptsService.generateMnemonic(concept, cleanQuestion);
        mnemonicContent.innerHTML = `
          <div class="mnemonic-emoji">${result.emoji || '🧠'}</div>
          <div class="mnemonic-text">${parseMarkdown(result.mnemonic || '')}</div>
          <div class="mnemonic-type">Tipo: ${result.type || 'associação'}</div>
          <div class="mnemonic-howto">💡 ${escH(result.howToUse || '')}</div>
        `;
        mnemonicContent.style.display = 'block';
      } catch (e) {
        mnemonicContent.textContent = 'Erro ao gerar mnemônico.';
        mnemonicContent.style.display = 'block';
      } finally {
        mnemonicLoading.style.display = 'none';
      }
    });
  }

  // Compare toggle
  const optionItems = Array.from(article.querySelectorAll('.option-item'));
  const correctLetter = (parsedA.letter || '').toUpperCase();
  if (correctLetter) article.dataset.correctLetter = correctLetter;
  article.classList.add('click-mode');

  optionItems.forEach(optionEl => {
    optionEl.addEventListener('click', () => {
      if (!article.classList.contains('click-mode')) return;
      if (article.classList.contains('answered')) return;

      const selectedLetter = String(optionEl.dataset.letter || '').toUpperCase();
      const selectedText = optionEl.textContent?.trim() || selectedLetter;
      // Save JOL confidence in element for revealCard to read
      article._jolConfidence = userConfidence;
      revealCard(article, { selectedLetter, selectedText });
    });
  });

  return article;
}

function revealCard(card, context = {}) {
  card.querySelector('.reveal-btn').hidden = true;
  card.classList.remove('click-mode');
  card.querySelector('.card-answer').hidden = false;

  const optionItems = Array.from(card.querySelectorAll('.option-item'));
  optionItems.forEach(item => {
    item.classList.remove('selected', 'correct', 'wrong');
    item.setAttribute('aria-pressed', 'false');
  });

  const selectedLetter = String(context.selectedLetter || '').toUpperCase();
  const correctLetter = String(card.dataset.correctLetter || '').toUpperCase();
  if (selectedLetter) {
    const selectedEl = optionItems.find(el => String(el.dataset.letter || '').toUpperCase() === selectedLetter);
    if (selectedEl) {
      selectedEl.classList.add('selected');
      selectedEl.setAttribute('aria-pressed', 'true');
    }

    if (correctLetter) {
      const correctEl = optionItems.find(el => String(el.dataset.letter || '').toUpperCase() === correctLetter);
      if (correctEl) correctEl.classList.add('correct');
      if (selectedEl && selectedLetter !== correctLetter) selectedEl.classList.add('wrong');

    // JOL Calibration feedback
    const jolBadgeEl = card.querySelector('[id^="jolBadge_"]');
    const jolBarEl = card.querySelector('[id^="jolBar_"]');
    const cardUserConfidence = card._jolConfidence || null;
    if (jolBadgeEl && cardUserConfidence) {
      const wasCorrect = selectedLetter === correctLetter;
      const fb = PedagogicalPromptsService.getCalibrationFeedback(cardUserConfidence, wasCorrect);
      jolBadgeEl.innerHTML = `<span style="color:${fb.color};font-weight:600">${escH(fb.badge)}</span> ${escH(fb.message)}`;
      jolBadgeEl.style.display = 'block';
      if (jolBarEl) jolBarEl.style.display = 'none';
    }
    // Show 'Por que errei?' button if wrong
    const btnWW = card.querySelector('.btn-why-wrong');
    if (btnWW) {
      btnWW.style.display = selectedLetter !== correctLetter ? 'inline-flex' : 'none';
    }
    }

    const comparePanel = card.querySelector('.compare-panel');
    if (comparePanel) {
      const cols = comparePanel.querySelectorAll('.compare-col-text');
      if (cols[0]) cols[0].textContent = context.selectedText || selectedLetter;
      if (cols[1]) cols[1].textContent = card.querySelector('.answer-text-content')?.textContent?.trim() || '';
      comparePanel.hidden = false;
    }
  }

  card.classList.add('answered');
  // Hide JOL bar on reveal
  const jolBarOnReveal = card.querySelector('[id^="jolBar_"]');
  if (jolBarOnReveal) jolBarOnReveal.style.display = 'none';
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
  card.classList.add('click-mode');

  const comparePanel = card.querySelector('.compare-panel');
  if (comparePanel) comparePanel.hidden = true;

  card.querySelectorAll('.option-item').forEach(item => {
    item.classList.remove('selected', 'correct', 'wrong');
    item.setAttribute('aria-pressed', 'false');
  });

  card.querySelector('.card-answer').hidden = true;
  card.classList.remove('answered');
  updateProgress();
}

let total = 0;
let allQuestions = [];
let _originalOrder = []; // preserve insertion order for "default"

const SUBJECT_KEYWORDS = {
  'Direito Constitucional': ['constituicao', 'constitucional', 'direitos fundamentais', 'controle de constitucionalidade'],
  'Direito Administrativo': ['administrativo', 'licitacao', 'improbidade', 'servidor publico', 'ato administrativo'],
  'Direito Penal': ['penal', 'crime', 'pena', 'tipicidade', 'ilicitude'],
  'Direito Processual': ['processo', 'processual', 'competencia', 'recurso', 'jurisdicao'],
  'Português': ['portugues', 'gramatica', 'acentuacao', 'sintaxe', 'morfologia'],
  'Matemática': ['matematica', 'algebra', 'geometria', 'probabilidade', 'estatistica'],
  'Informática': ['informatica', 'computador', 'algoritmo', 'programacao', 'software', 'hardware'],
  'Redação': ['redacao', 'dissertativa', 'argumentacao', 'texto'],
  'Atualidades': ['atualidades', 'geopolitica', 'sociedade', 'economia', 'politica internacional'],
  'Biologia': ['biologia', 'celula', 'genetica', 'ecologia', 'fisiologia'],
  'Química': ['quimica', 'reacao', 'molecula', 'atomo', 'ligacao quimica'],
  'Física': ['fisica', 'cinematica', 'dinamica', 'energia', 'termodinamica']
};

const GENERIC_SUBJECT_TAGS = new Set(['geral', 'outros', 'misc', 'varios', 'sem categoria']);

function normText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Canonical forms for subjects that appear with different casing/plural
const SUBJECT_ALIASES = {
  // Banco de Dados variants
  'bancos de dados'          : 'Banco de Dados',
  'banco de dados'           : 'Banco de Dados',
  'banco de dado'            : 'Banco de Dados',
  'base de dados'            : 'Banco de Dados',
  'bases de dados'           : 'Banco de Dados',
  'banco de dados nosql'     : 'Banco de Dados NoSQL',
  'bancos de dados nosql'    : 'Banco de Dados NoSQL',
  'sistemas de bancos'       : 'Banco de Dados',
  'sistemas de banco'        : 'Banco de Dados',
  'modelos de dados'         : 'Banco de Dados',
  'modelo de dados'          : 'Banco de Dados',
  // Ciência da Computação
  'ciencia da computacao'    : 'Ciência da Computação',
  'ciencias da computacao'   : 'Ciência da Computação',
  // Sistemas distribuídos
  'sistemas distribuidos'    : 'Sistemas Distribuídos',
  'sistema distribuido'      : 'Sistemas Distribuídos',
  'computacao distribuida'   : 'Computação Distribuída',
  // Tecnologia da Informação
  'tecnologia da informacao' : 'Tecnologia da Informação',
  'tecnologias da informacao': 'Tecnologia da Informação',
  // Sistemas de Informação
  'sistemas de informacao'   : 'Sistemas de Informação',
  'sistema de informacao'    : 'Sistemas de Informação',
  // Computação / Informática
  'computacao'               : 'Computação',
  'informatica'              : 'Informática',
};

function normalizeSubject(value = '') {
  const cleaned = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  // Look up in alias map (accent- and case-insensitive)
  const key = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return SUBJECT_ALIASES[key] ?? cleaned;
}

function inferSubjectFromText(question = '', answer = '') {
  const haystack = `${normText(question)} ${normText(answer)}`;
  if (!haystack.trim()) return 'Geral';

  let best = { subject: 'Geral', score: 0 };
  for (const [subject, terms] of Object.entries(SUBJECT_KEYWORDS)) {
    const score = terms.reduce((acc, term) => acc + (haystack.includes(normText(term)) ? 1 : 0), 0);
    if (score > best.score) best = { subject, score };
  }
  return best.score > 0 ? best.subject : 'Geral';
}

function getQuestionSubject(q) {
  if (!q) return 'Geral';

  const explicit = normalizeSubject(q.subject || q.topic || q.discipline || q.area || '');
  if (explicit) return explicit;

  const sm2Tags = _sm2Cache?.[q.id]?.tags;
  if (Array.isArray(sm2Tags) && sm2Tags.length) {
    const tag = normalizeSubject(sm2Tags[0]);
    if (tag && !GENERIC_SUBJECT_TAGS.has(normText(tag))) return tag;
  }

  const folder = normalizeSubject(q.folderPath || '');
  if (folder && folder !== 'Raiz') {
    const firstFolder = folder.split('/')[0]?.trim();
    if (firstFolder && !GENERIC_SUBJECT_TAGS.has(normText(firstFolder))) return firstFolder;
  }

  return inferSubjectFromText(q.question || '', q.answer || '');
}

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
  const searchInputEl = document.getElementById('searchInput');
  const anchorTopBefore = searchInputEl?.getBoundingClientRect().top ?? null;
  const q = (searchInputEl?.value || '').toLowerCase().trim();
  const selectedSubject = document.getElementById('subjectSelect')?.value || 'all';
  const hideAnswered = document.getElementById('chipHideAnswered').classList.contains('active');
  const onlyReview = document.getElementById('chipReviewOnly').classList.contains('active');
  const onlySm2Due = document.getElementById('chipSm2Due')?.classList.contains('active');
  const onlyErrors = document.getElementById('chipErrors')?.classList.contains('active');
  const hideToday = document.getElementById('chipHideToday')?.classList.contains('active');
  const todayStr = todayISO();

  document.querySelectorAll('.card').forEach(card => {
    const text = card.querySelector('.card-question').textContent.toLowerCase();
    const qid = String(card.dataset.qid || '');
    const sm2Entry = _sm2Cache[qid];
    const isAnswered = card.classList.contains('answered') || hasAnsweredHistory(qid);
    const isReviewLater = card.classList.contains('for-review');
    const isDue = onlySm2Due ? sm2IsDue(sm2Entry) : true;
    const hasErrors = onlyErrors ? (sm2Entry && (sm2Entry.errors || 0) > 0) : true;
    const ratedToday = sm2Entry?.lastRated === todayStr;
    const matchesSearch = !q || text.includes(q);
    const matchesSubject = selectedSubject === 'all' || card.dataset.subject === selectedSubject;
    const hiddenByFilter = hideAnswered && isAnswered;
    const hiddenByReviewFilter = onlyReview && !isReviewLater;
    const hiddenBySm2Filter = onlySm2Due && !isDue;
    const hiddenByErrorFilter = onlyErrors && !hasErrors;
    const hiddenByTodayFilter = hideToday && ratedToday;
    card.classList.toggle('hidden-card', !matchesSearch || !matchesSubject || hiddenByFilter || hiddenByReviewFilter || hiddenBySm2Filter || hiddenByErrorFilter || hiddenByTodayFilter);
  });

  document.querySelectorAll('.subject-group-header').forEach(header => {
    let hasVisible = false;
    let node = header.nextElementSibling;
    while (node && !node.classList.contains('subject-group-header')) {
      if (node.classList.contains('card') && !node.classList.contains('hidden-card')) {
        hasVisible = true;
        break;
      }
      node = node.nextElementSibling;
    }
    header.style.display = hasVisible ? 'flex' : 'none';
  });

  updateProgress();

  // Keep the search bar visually stable while cards are hidden/shown.
  if (anchorTopBefore !== null) {
    const anchorTopAfter = searchInputEl?.getBoundingClientRect().top ?? null;
    if (anchorTopAfter !== null) {
      const delta = anchorTopAfter - anchorTopBefore;
      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
      }
    }
  }
}

/* ═══ Sorting ═══════════════════════════════════════════════════════════════ */

function getSortedQuestions(questions, mode) {
  const sorted = [...questions];
  switch (mode) {
    case 'subject':
    case 'subject_grouped':
      sorted.sort((a, b) => {
        const sa = getQuestionSubject(a);
        const sb = getQuestionSubject(b);
        if (sa !== sb) return sa.localeCompare(sb, 'pt-BR', { sensitivity: 'base' });
        return (a.question || '').localeCompare(b.question || '', 'pt-BR', { sensitivity: 'base' });
      });
      break;
    case 'newest':
      sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      break;
    case 'oldest':
      sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      break;
    case 'az':
      sorted.sort((a, b) => (a.question || '').localeCompare(b.question || '', 'pt-BR', { sensitivity: 'base' }));
      break;
    case 'za':
      sorted.sort((a, b) => (b.question || '').localeCompare(a.question || '', 'pt-BR', { sensitivity: 'base' }));
      break;
    case 'folder':
    case 'folder_grouped':
      sorted.sort((a, b) => (a.folderPath || 'Raiz').localeCompare(b.folderPath || 'Raiz', 'pt-BR'));
      break;
    case 'difficulty': {
      sorted.sort((a, b) => {
        const efA = _sm2Cache[a.id] ? _sm2Cache[a.id].ef : 2.5;
        const efB = _sm2Cache[b.id] ? _sm2Cache[b.id].ef : 2.5;
        return efA - efB; // lower EF = harder → shown first
      });
      break;
    }
    case 'due': {
      sorted.sort((a, b) => {
        const entryA = _sm2Cache[a.id];
        const entryB = _sm2Cache[b.id];
        const dueA = entryA && entryA.nextReview ? entryA.nextReview : '9999-12-31';
        const dueB = entryB && entryB.nextReview ? entryB.nextReview : '9999-12-31';
        return dueA.localeCompare(dueB);
      });
      break;
    }
    case 'interleaved': {
      const bySubject = new Map();
      sorted.forEach(q => {
        const subj = getQuestionSubject(q);
        if (!bySubject.has(subj)) bySubject.set(subj, []);
        bySubject.get(subj).push(q);
      });
      const subjects = [...bySubject.keys()].sort();
      const result = [];
      const maxLen = Math.max(...[...bySubject.values()].map(a => a.length), 0);
      for (let i = 0; i < maxLen; i++) {
        for (const subj of subjects) {
          const arr = bySubject.get(subj);
          if (arr && i < arr.length) result.push(arr[i]);
        }
      }
      return result;
    }
    default: // 'default' — original insertion order
      return _originalOrder.length ? [..._originalOrder] : sorted;
  }
  return sorted;
}

function populateSubjectSelect(questions) {
  const subjectSelect = document.getElementById('subjectSelect');
  if (!subjectSelect) return;

  const current = subjectSelect.value || 'all';
  const counts = new Map();
  questions.forEach(q => {
    const subject = getQuestionSubject(q);
    counts.set(subject, (counts.get(subject) || 0) + 1);
  });

  const subjects = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR', { sensitivity: 'base' }));

  subjectSelect.innerHTML = '<option value="all">Todos os assuntos</option>' + subjects
    .map(([subject, count]) => `<option value="${escH(subject)}">${escH(subject)} (${count})</option>`)
    .join('');

  subjectSelect.value = [...subjectSelect.options].some(opt => opt.value === current) ? current : 'all';
}

function buildSubjectHeader(subject, count, icon = 'account_tree') {
  const header = document.createElement('div');
  header.className = 'subject-group-header';
  header.dataset.subject = subject;
  header.dataset.collapsed = 'false';
  header.innerHTML = `
    <span class="left"><span class="icon">${icon}</span>${escH(subject)}</span>
    <span class="right">
      <span class="count">${count} questão${count !== 1 ? 'ões' : ''}</span>
      <span class="icon subject-chevron">expand_more</span>
    </span>
  `;
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    const collapsed = header.dataset.collapsed === 'true';
    header.dataset.collapsed = collapsed ? 'false' : 'true';
    header.querySelector('.subject-chevron').textContent = collapsed ? 'expand_more' : 'chevron_right';
    let node = header.nextElementSibling;
    while (node && !node.classList.contains('subject-group-header')) {
      node.classList.toggle('subject-collapsed', !collapsed);
      node = node.nextElementSibling;
    }
  });
  return header;
}

function rebuildCardList(questions, mode = 'default') {
  const cardList = document.getElementById('cardList');
  const toQid = value => String(value ?? '');

  // Save answered and review state
  const answeredIds = new Set();
  const reviewIds = new Set();
  document.querySelectorAll('.card').forEach(c => {
    const qid = toQid(c.dataset.qid);
    if (!qid) return;
    if (c.classList.contains('answered')) answeredIds.add(qid);
    if (c.classList.contains('for-review')) reviewIds.add(qid);
  });

  cardList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  const isGrouped = mode === 'subject_grouped' || mode === 'folder_grouped';
  let groupCounts = null;
  let renderedGroups = null;
  const getGroupKey = mode === 'folder_grouped'
    ? q => q.folderPath || 'Raiz'
    : q => getQuestionSubject(q);
  const groupIcon = mode === 'folder_grouped' ? 'folder' : 'account_tree';

  if (isGrouped) {
    groupCounts = questions.reduce((acc, q) => {
      const key = getGroupKey(q);
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map());
    renderedGroups = new Set();
  }

  questions.forEach((q, i) => {
    const groupKey = getGroupKey(q);
    if (isGrouped && !renderedGroups.has(groupKey)) {
      fragment.appendChild(buildSubjectHeader(groupKey, groupCounts.get(groupKey) || 0, groupIcon));
      renderedGroups.add(groupKey);
    }

    const card = buildCard(q, i);
    const qid = toQid(q.id);
    if (answeredIds.has(qid) || hasAnsweredHistory(qid)) {
      card.querySelector('.reveal-btn').hidden = true;
      card.querySelector('.card-answer').hidden = false;
      card.classList.add('answered');
    }
    if (reviewIds.has(qid)) {
      applyReviewLaterState(card, true);
    }
    fragment.appendChild(card);
  });
  cardList.appendChild(fragment);

  updateReviewChipCounter();
  filterCards();
  setTimeout(() => { updateSm2DueBadge(); updateTodayDoneBadge(); }, 100);
}

function applySortFromSelect() {
  const select = document.getElementById('sortSelect');
  if (!select) return;
  const mode = select.value;
  const sorted = getSortedQuestions(_originalOrder, mode);
  allQuestions = sorted;
  rebuildCardList(sorted, mode);
  // Persist preference
  try { chrome.storage.local.set({ ah_sortMode: mode }); } catch (e) {}
}

function init(questions) {
  allQuestions = questions;
  _originalOrder = [...questions];
  total = questions.length;

  const counterEl = document.getElementById('counterEl');
  counterEl.textContent = `${total} questão${total !== 1 ? 'ões' : ''}`;

  syncSidebarSessionInfo();
  const cardList = document.getElementById('cardList');
  const emptyState = document.getElementById('emptyState');

  if (total === 0) {
    emptyState.querySelector('p').textContent = 'Nenhuma questão salva no fichário.';
    setMainView('dashboard');
    return;
  }

  emptyState.remove();

  const fragment = document.createDocumentFragment();
  questions.forEach((q, i) => fragment.appendChild(buildCard(q, i)));
  cardList.appendChild(fragment);
  populateSubjectSelect(questions);

  updateReviewChipCounter();
  updateProgress();
  // Initialize SM-2 due badge
  setTimeout(() => { updateSm2DueBadge(); updateTodayDoneBadge(); }, 300);

  document.getElementById('footer').textContent =
    `AnswerHunter — ${total} questão${total !== 1 ? 'ões' : ''} · gerado em ${new Date().toLocaleString('pt-BR')}`;

  // Search
  document.getElementById('searchInput').addEventListener('input', filterCards);

  // Subject filter
  const subjectSelect = document.getElementById('subjectSelect');
  if (subjectSelect) {
    subjectSelect.addEventListener('change', () => {
      filterCards();
      try { chrome.storage.local.set({ ah_subjectFilter: subjectSelect.value }); } catch (_) {}
    });
  }

  const btnTagAllVisible = document.getElementById('btnTagAllVisible');
  if (btnTagAllVisible) {
    btnTagAllVisible.addEventListener('click', () => {
      generateTagsForVisibleCards().catch(() => {
        showSyncToast('Falha ao gerar tags em lote.');
      });
    });
  }

  // Sort
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', applySortFromSelect);
  }

  // Restore saved preferences
  chrome.storage.local.get(['ah_sortMode', 'ah_subjectFilter', 'ah_chipHideToday'], (res) => {
    if (subjectSelect && res.ah_subjectFilter) {
      subjectSelect.value = res.ah_subjectFilter;
    }
    const saved = res.ah_sortMode || 'interleaved';
    if (sortSelect && saved) {
      sortSelect.value = saved;
    }
    // Restore hide-today chip state
    if (res.ah_chipHideToday) {
      const chipHT = document.getElementById('chipHideToday');
      if (chipHT) chipHT.classList.add('active');
    }
    applySortFromSelect();
  });

  loadSm2Data().then(() => {
    migrateSmToStorage().catch((e) => console.warn('migrateSmToStorage:', e));
    populateSubjectSelect(_originalOrder);
    const mode = sortSelect ? sortSelect.value : 'default';
    const sorted = getSortedQuestions(_originalOrder, mode);
    allQuestions = sorted;
    rebuildCardList(sorted, mode);
    initDoneDrawerFromSm2(); // move today's rated cards to the done drawer on reload

    // Initialize gamification on load
    loadStreakData().then(data => renderStreakUI(data));
    updateDailyProgress();
  }).catch(() => {});

  // Hide answered chip
  document.getElementById('chipHideAnswered').addEventListener('click', function () {
    this.classList.toggle('active');
    filterCards();

    // Aplicar modo prova inicial aos cards
    document.querySelectorAll('.card:not(.answered)').forEach(card => {
      const hasOptions = card.querySelectorAll('.option-item').length > 0;
      const revealBtn = card.querySelector('.reveal-btn');
      if (revealBtn && _modoProva && hasOptions) revealBtn.hidden = true;
    });

    updateNewCardsLimitBadge();
  });

  // Review later filter chip
  document.getElementById('chipReviewOnly').addEventListener('click', function () {
    this.classList.toggle('active');
    filterCards();
  });

  // Hide today's rated questions chip
  const chipHideToday = document.getElementById('chipHideToday');
  if (chipHideToday) {
    chipHideToday.addEventListener('click', async function () {
      this.classList.toggle('active');
      const active = this.classList.contains('active');
      try { chrome.storage.local.set({ ah_chipHideToday: active }); } catch (_) {}
      await loadSm2Data(); // ensure cache is fresh
      filterCards();
      updateTodayDoneBadge();
    });
  }

  // Reveal/hide all — mode toggle
  const chipReveal = document.getElementById('chipRevealAll');

  function updateModeToggle(isRevealMode) {
    if (isRevealMode) {
      chipReveal.innerHTML = '<span class="icon">visibility_off</span> Modo prova';
      chipReveal.title = 'Modo livre ativo: gabarito visível. Clique para voltar ao modo prova.';
    } else {
      chipReveal.innerHTML = '<span class="icon">checklist</span> Modo prova';
      chipReveal.title = 'Modo prova ativo: clique em uma alternativa para responder.';
    }
  }

  chipReveal.dataset.state = 'hide';
  updateModeToggle(false);

  chipReveal.addEventListener('click', function () {
    const reveal = this.dataset.state === 'hide';
    document.querySelectorAll('.card:not(.hidden-card)').forEach(card => {
      reveal ? revealCard(card) : hideCard(card);
    });
    this.dataset.state = reveal ? 'reveal' : 'hide';
    updateModeToggle(reveal);
  });

  // BK-03: modo estudo Prova/Treino
  const chipModo = document.getElementById('chipModoEstudo');
  if (chipModo) {
    const applyModo = () => {
      const label = document.getElementById('modoEstudoLabel');
      if (label) label.textContent = _modoProva ? 'Modo Prova' : 'Modo Treino';
      chipModo.classList.toggle('active', _modoProva);
      document.querySelectorAll('.card:not(.hidden-card):not(.answered)').forEach(card => {
        const revealBtn = card.querySelector('.reveal-btn');
        if (!revealBtn) return;
        const hasOptions = card.querySelectorAll('.option-item').length > 0;
        revealBtn.hidden = _modoProva && hasOptions;
      });
    };
    chipModo.addEventListener('click', () => {
      _modoProva = !_modoProva;
      applyModo();
      try { chrome.storage.local.set({ ah_modoProva: _modoProva }); } catch(_){}
    });
    chrome.storage.local.get(['ah_modoProva'], r => {
      if (r.ah_modoProva !== undefined) _modoProva = r.ah_modoProva;
      applyModo();
    });
  }

  // Reset progress
  document.getElementById('btnReset').addEventListener('click', () => {
    if (!confirm('Reiniciar todo o progresso desta sessão?')) return;
    document.querySelectorAll('.card').forEach(card => hideCard(card));
    chipReveal.dataset.state = 'hide';
    updateModeToggle(false);    document.getElementById('chipHideAnswered').classList.remove('active');
    document.getElementById('chipReviewOnly').classList.remove('active');
    const chipHT = document.getElementById('chipHideToday');
    if (chipHT) {
      chipHT.classList.remove('active');
      try { chrome.storage.local.set({ ah_chipHideToday: false }); } catch (_) {}
    }
    const subjectSelect = document.getElementById('subjectSelect');
    if (subjectSelect) subjectSelect.value = 'all';
    try { chrome.storage.local.set({ ah_subjectFilter: 'all' }); } catch (_) {}
    filterCards();
  });

  document.getElementById('newCardsLimitBadge')?.addEventListener('click', async () => {
    const current = await new Promise(r => chrome.storage.local.get(['ah_newCardsPerDay'], d => r(d.ah_newCardsPerDay || 20)));
    const input = prompt(`Limite de novas questões por dia (atual: ${current}):`, current);
    if (input === null) return;
    const n = parseInt(input);
    if (n > 0) {
      await new Promise(r => chrome.storage.local.set({ ah_newCardsPerDay: n }, r));
      await updateNewCardsLimitBadge();
      showSyncToast(`Limite: ${n} novas por dia`);
    }
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

  // Dashboard is the default landing view
  setMainView('dashboard');
}

// Load data from chrome.storage.local
chrome.storage.local.get(['binderStructure'], (result) => {
  const data = result.binderStructure;
  if (!Array.isArray(data) || data.length === 0) {
    document.getElementById('emptyState').querySelector('p').textContent =
      'Nenhuma questão salva. Use a extensão para salvar questões no fichário.';
    setMainView('dashboard');
    renderDashboard(dashHome, { inline: true }).catch(() => {});
  } else {
    init(collectQuestions(data));
  }
});

// Live sync: re-render whenever the binder is updated in the extension
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.binderStructure) return;
  const data = changes.binderStructure.newValue;
  let questions = Array.isArray(data) ? collectQuestions(data) : [];
  _originalOrder = [...questions];

  // Keep SM-2 cache in sync so "Feitas hoje"/answered filters remain correct
  await loadSm2Data();

  // Apply current sort
  const sortSelect = document.getElementById('sortSelect');
  const sortMode = sortSelect ? sortSelect.value : 'default';
  questions = getSortedQuestions(questions, sortMode);
  allQuestions = questions;
  populateSubjectSelect(_originalOrder);

  // Show toast notification
  const prev = document.querySelectorAll('.card').length;
  const next = questions.length;
  const diff = next - prev;
  rebuildCardList(questions, sortMode);

  // Rebuild done drawer from SM-2 (rated today) to avoid cards reappearing in main list
  const doneList = document.getElementById('doneDrwrList');
  const doneCount = document.getElementById('doneDrwrCount');
  const doneDrawer = document.getElementById('doneDrwr');
  if (doneList) doneList.innerHTML = '';
  if (doneCount) doneCount.textContent = '0';
  if (doneDrawer) doneDrawer.style.display = 'none';
  initDoneDrawerFromSm2();

  total = questions.length;
  document.getElementById('counterEl').textContent =
    `${total} questão${total !== 1 ? 'ões' : ''}`;
  document.getElementById('footer').textContent =
    `AnswerHunter — ${total} questão${total !== 1 ? 'ões' : ''} · atualizado em ${new Date().toLocaleString('pt-BR')}`;

  // Re-apply current filter
  filterCards();
  syncSidebarSessionInfo();

  if (_mainView === 'dashboard') {
    renderDashboard(dashHome, { inline: true }).catch(() => {});
  }

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

// ══ Revisão Espaçada FSRS-5 (migrado de SM-2) ═════════════════════════════════

const SM2_STORAGE_KEY = 'ah_sm2Data';
let _modoProva = true; // BK-03 exam mode
let _sm2Cache = {};
let _userAnswers = {}; // qid → user's typed answer (for Comparar)

function todayISO() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function hasAnsweredHistory(qid) {
  const key = String(qid ?? '');
  if (!key) return false;
  const entry = _sm2Cache[key];
  if (!entry) return false;
  return (entry.totalRatings || 0) > 0 || Boolean(entry.lastRated);
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
  // 🔄 Delegado ao FSRS (inclui anos, semanas, meses)
  return FSRSService.nextLabel(entry, quality);
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
    const retrievability = FSRSService.retrievability(entry);
    const retStr = retrievability !== null ? ` · Retenção: ${retrievability}%` : '';
    doneEl.querySelector('.sm2-done-text').textContent = `Avaliado hoje — próxima revisão ${label}${retStr}`;
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

// ── SM-2 card fly-off ────────────────────────────────────────────────────────────────
function flyCardOff(card) {
  return new Promise(resolve => {
    // Store current height so the collapse animation knows the start value
    const h = card.offsetHeight;
    card.style.setProperty('--collapsing-height', h + 'px');

    // Phase 1: fly to the right (400 ms)
    card.classList.add('flying-off');

    setTimeout(() => {
      card.classList.remove('flying-off');
      card.style.opacity = '0';

      // Phase 2: collapse the empty space (280 ms)
      card.classList.add('collapsing-away');

      setTimeout(() => {
        card.classList.remove('collapsing-away');
        card.style.cssText = ''; // wipe all inline styles
        resolve();
      }, 285);
    }, 400);
  });
}

function moveToDoneDrawer(card) {
  const drawer = document.getElementById('doneDrwr');
  const list   = document.getElementById('doneDrwrList');
  const countEl = document.getElementById('doneDrwrCount');
  if (!drawer || !list) return;

  // Ensure no leftover animation classes/styles
  card.classList.remove('flying-off', 'collapsing-away', 'hidden-card');
  card.style.cssText = '';

  list.appendChild(card);

  const count = list.querySelectorAll('.card').length;
  if (countEl) countEl.textContent = count;
  drawer.style.display = '';

  // Auto-open the drawer on the first card of the session
  if (!drawer.dataset.manuallySet) {
    drawer.classList.add('open');
    list.classList.remove('hidden');
    if (drawer.querySelector('[aria-expanded]')) {
      drawer.querySelector('[aria-expanded]').setAttribute('aria-expanded', 'true');
    }
  }

  // Play a small "land" animation on the card
  card.classList.add('landing-in-drawer');
  card.addEventListener('animationend', () => card.classList.remove('landing-in-drawer'), { once: true });
}

function initDoneDrawerFromSm2() {
  const todayStr = todayISO();
  const drawer  = document.getElementById('doneDrwr');
  const list    = document.getElementById('doneDrwrList');
  const countEl = document.getElementById('doneDrwrCount');
  if (!drawer || !list) return;

  let count = 0;
  document.querySelectorAll('#cardList .card').forEach(card => {
    const qid   = card.dataset.qid;
    const entry = _sm2Cache[qid];
    if (entry?.lastRated === todayStr) {
      card.classList.remove('hidden-card');
      list.appendChild(card);
      count++;
    }
  });

  if (count > 0) {
    if (countEl) countEl.textContent = count;
    drawer.style.display = '';
    // Start collapsed on reload so the main list feels clean
    drawer.classList.remove('open');
    list.classList.add('hidden');
    drawer.dataset.manuallySet = 'true';
  }
}



// === BK-01/BK-04/BK-05 helpers ===
async function persistSm2ToNode(qid, sm2Partial) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['binderStructure'], (result) => {
        const data = result && result.binderStructure;
        if (!Array.isArray(data)) { resolve(false); return; }
        const findAndUpdate = (nodes) => {
          for (const node of nodes) {
            if (node && node.id === qid && node.type === 'question') {
              node.content = node.content || {};
              node.content.sm2 = { ...(node.content.sm2 || {}), ...sm2Partial };
              node.updatedAt = Date.now();
              return true;
            }
            if (node && Array.isArray(node.children) && findAndUpdate(node.children)) return true;
          }
          return false;
        };
        const found = findAndUpdate(data);
        if (!found) { resolve(false); return; }
        chrome.storage.local.set({ binderStructure: data }, () => resolve(!chrome.runtime.lastError));
      });
    } catch (_) { resolve(false); }
  });
}

async function migrateSmToStorage() {
  try {
    if (!Array.isArray(allQuestions) || !allQuestions.length || !_sm2Cache) return;
    const pending = allQuestions
      .filter(q => q && q.id && _sm2Cache[q.id] && (_sm2Cache[q.id].lastRated || _sm2Cache[q.id].nextReview))
      .map(q => q.id);
    for (let i = 0; i < pending.length; i += 10) {
      const chunk = pending.slice(i, i + 10);
      await Promise.all(chunk.map(async (qid) => {
        try {
          await persistSm2ToNode(qid, _sm2Cache[qid] || {});
        } catch (_) {}
      }));
      await new Promise(r => setTimeout(r, 0));
    }
  } catch (e) {
    console.warn('migrateSmToStorage error:', e);
  }
}

async function checkMastery(qid, entry) {
  try {
    const wasMastered = !!(entry && entry.mastered);
    const nowMastered = ((entry && entry.interval) || 0) >= 21 && ((entry && entry.repetition) || 0) >= 3;
    if (nowMastered && !wasMastered) {
      entry.mastered = true;
      const data = await loadSm2Data();
      if (data[qid]) { data[qid].mastered = true; await saveSm2Data(data); }
      await persistSm2ToNode(qid, { mastered: true });
      setTimeout(() => {
        try { microCelebrate('complete'); } catch (_) {}
        try { showSyncToast('Questão dominada! Intervalo ≥21 dias.'); } catch (_) {}
      }, 500);
      const card = document.querySelector(`.card[data-qid="${qid}"]`);
      if (card && !card.querySelector('.mastered-badge')) {
        const badge = document.createElement('span');
        badge.className = 'mastered-badge';
        badge.innerHTML = '<span class="icon">workspace_premium</span> Dominada';
        const cm = card.querySelector('.card-meta');
        if (cm) cm.appendChild(badge);
      }
    }
    return nowMastered;
  } catch (_) {
    return false;
  }
}

async function rateSm2Silent(qid, quality) {
  try {
    const data = await loadSm2Data();
    const entry = data[qid] || {};
    const migratedEntry = FSRSService.migrateSm2Entry(entry);
  const newEntry = FSRSService.calculate(migratedEntry, quality);
    newEntry.errors = (entry.errors || 0) + (quality === 0 ? 1 : 0);
    newEntry.totalRatings = (entry.totalRatings || 0) + 1;
    newEntry.attempt_count = (entry.attempt_count || entry.totalRatings || 0) + 1;
    newEntry.correct_count = (entry.correct_count || 0) + (quality >= 2 ? 1 : 0);
    data[qid] = newEntry;
    await saveSm2Data(data);
    await persistSm2ToNode(qid, newEntry);
    updateSm2DueBadge();
    await checkMastery(qid, newEntry);
  } catch (e) {
    console.warn('rateSm2Silent error:', e);
  }
}

async function getSessionQueue(questions) {
  const data = await loadSm2Data();
  const settings = await new Promise(r => chrome.storage.local.get(['ah_newCardsPerDay'], d => r(d || {})));
  const limit = parseInt(settings.ah_newCardsPerDay || 20);
  const todayStr = todayISO();
  const dueCards = (questions || []).filter(q => {
    const e = data[q.id];
    return e && e.lastRated && e.nextReview && e.nextReview <= todayStr;
  });
  const newCardsAll = (questions || []).filter(q => {
    const e = data[q.id];
    return !e || !e.lastRated;
  });
  const newStudiedToday = (questions || []).filter(q => (data[q.id] && data[q.id].lastRated === todayStr && (!data[q.id].repetition || data[q.id].repetition <= 1))).length;
  const newAllowed = Math.max(0, limit - newStudiedToday);
  return { dueCards, newCards: newCardsAll.slice(0, newAllowed), newLimit: limit, newStudiedToday };
}

async function updateNewCardsLimitBadge() {
  try {
    const queue = await getSessionQueue(allQuestions || []);
    const badge = document.getElementById('newCardsLimitBadge');
    if (badge) {
      badge.textContent = `${queue.newCards.length} novas hoje`;
      badge.title = `Limite diário: ${queue.newLimit} novas | Estudadas hoje: ${queue.newStudiedToday}`;
    }
  } catch (_) {}
}

async function rateSm2(qid, quality, sm2Bar, doneEl) {
  const data = await loadSm2Data();
  const entry = data[qid] || {};
  const migratedEntry = FSRSService.migrateSm2Entry(entry);
  const newEntry = FSRSService.calculate(migratedEntry, quality);
  // Track error count for Caderno de Erros
  newEntry.errors = (entry.errors || 0) + (quality === 0 ? 1 : 0);
  newEntry.totalRatings = (entry.totalRatings || 0) + 1;
  newEntry.attempt_count = (entry.attempt_count || entry.totalRatings || 0) + 1;
  newEntry.correct_count = (entry.correct_count || 0) + (quality >= 2 ? 1 : 0);
  data[qid] = newEntry;
  await saveSm2Data(data);
  await persistSm2ToNode(qid, newEntry);
  await checkMastery(qid, newEntry);

  // Update XP (also triggers streak + daily progress inside awardXP)
  awardXP(quality === 0 ? 2 : quality === 1 ? 5 : quality === 2 ? 10 : 15);

  // Motivational nudge every N cards
  maybeShowMotivation();

  // Prepare done badge (will be visible in the drawer after animation)
  showSm2DoneBadge(sm2Bar, doneEl, newEntry);
  updateSm2DueBadge();
  updateTodayDoneBadge();

  // Flash colour overlay on the card to give haptic-like feedback
  const card = sm2Bar.closest('.card');
  if (card) {
    const flashClass = quality === 0 ? 'flash-red' : quality === 1 ? 'flash-amber' : quality === 2 ? 'flash-green' : 'flash-indigo';
    const flash = document.createElement('div');
    flash.className = `rating-flash ${flashClass}`;

    moveToDoneDrawer(card);
  }

  // If hide-today chip is active, keep filter in sync (drawer handles the card now)
  if (document.getElementById('chipHideToday')?.classList.contains('active')) {
    filterCards();
  }
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

async function updateTodayDoneBadge() {
  const data = await loadSm2Data();
  const todayStr = todayISO();
  const doneCount = allQuestions.filter(q => data[q.id]?.lastRated === todayStr).length;
  const countEl = document.getElementById('todayDoneCount');
  const chip = document.getElementById('chipHideToday');
  if (countEl) {
    countEl.textContent = doneCount;
    countEl.style.display = doneCount > 0 ? 'inline' : 'none';
  }
  if (chip) chip.title = `Ocultar ${doneCount} questão${doneCount !== 1 ? 'ões' : ''} já avaliada${doneCount !== 1 ? 's' : ''} hoje`;
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

// Done drawer toggle
const doneDrwrToggle = document.getElementById('doneDrwrToggle');
if (doneDrwrToggle) {
  doneDrwrToggle.addEventListener('click', () => {
    const drawer = document.getElementById('doneDrwr');
    const list   = document.getElementById('doneDrwrList');
    const isOpen = drawer.classList.toggle('open');
    list.classList.toggle('hidden', !isOpen);
    doneDrwrToggle.setAttribute('aria-expanded', String(isOpen));
    drawer.dataset.manuallySet = 'true';
  });
}

// Initialize SM-2 badge when page loads
document.addEventListener('DOMContentLoaded', () => {
  if (allQuestions.length > 0) {
    updateSm2DueBadge();
    updateTodayDoneBadge();
  }
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

function openQuizModal(question, answer, sourceQid = null) {
  _quizState.current = { question, answer, sourceQid };
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
  if (_quizState.current?.sourceQid) {
    rateSm2Silent(_quizState.current.sourceQid, isCorrect ? 2 : 0);
    showSyncToast(isCorrect ? 'SM2 da questão original atualizado (+acerto)' : 'SM2 da questão original atualizado (+erro)');
  }

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
  // if (e.target === quizOverlay) closeQuizModal();
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
  // if (e.target === simOverlay) closeSimulado();
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
      showSyncToast(`Nível ${newLevel} alcançado!`);
      microCelebrate('levelup');
    }, 400);
  }

  // Update streak and daily progress after XP award
  updateStreak();
  updateDailyProgress();
}

// ══ Streak System (dopamine-friendly daily consistency) ══════════════════════

const STREAK_KEY = 'ah_streakData';

async function loadStreakData() {
  return new Promise(resolve => {
    chrome.storage.local.get([STREAK_KEY], r => resolve(r[STREAK_KEY] || { count: 0, lastDate: null }));
  });
}

async function saveStreakData(data) {
  return new Promise(resolve => chrome.storage.local.set({ [STREAK_KEY]: data }, resolve));
}

async function updateStreak() {
  const data = await loadStreakData();
  const todayStr = todayISO();

  if (data.lastDate === todayStr) {
    // Already counted today — just refresh UI
    renderStreakUI(data);
    return data;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  if (data.lastDate === yesterdayStr) {
    // Consecutive day — increment streak
    data.count = (data.count || 0) + 1;
  } else if (data.lastDate && data.lastDate !== todayStr) {
    // Streak broken — reset to 1
    data.count = 1;
  } else {
    // First ever
    data.count = 1;
  }
  data.lastDate = todayStr;
  await saveStreakData(data);
  renderStreakUI(data);

  // Milestone celebrations
  if ([3, 7, 14, 30, 50, 100].includes(data.count)) {
    setTimeout(() => {
      microCelebrate('streak');
      showSyncToast(`Streak: ${data.count} ${data.count === 1 ? 'dia seguido' : 'dias seguidos'}! Continue assim!`);
    }, 600);
  }

  return data;
}

function renderStreakUI(data) {
  const el = document.getElementById('streakCount');
  const container = document.getElementById('streakBar');
  if (!el || !container) return;
  el.textContent = data.count || 0;
  container.style.display = (data.count || 0) > 0 ? '' : 'none';
  // Update text for singular/plural
  const textEl = container.querySelector('.streak-text');
  if (textEl) textEl.textContent = data.count === 1 ? 'dia seguido' : 'dias seguidos';
  // Streak icon by level
  const fireEl = container.querySelector('.streak-fire');
  if (fireEl) {
    const iconName = data.count >= 30 ? 'military_tech' : data.count >= 14 ? 'diamond' : data.count >= 7 ? 'bolt' : 'local_fire_department';
    fireEl.innerHTML = `<span class="icon">${iconName}</span>`;
  }
}

// ══ Daily Progress Tracking (visual progress bar — ADHD-friendly) ════════════

async function updateDailyProgress() {
  const data = await loadSm2Data();
  const todayStr = todayISO();
  const doneToday = allQuestions.filter(q => data[q.id]?.lastRated === todayStr).length;
  const totalCards = allQuestions.length;
  const pct = totalCards > 0 ? Math.round((doneToday / totalCards) * 100) : 0;

  const bar = document.getElementById('dailyProgressFill');
  const label = document.getElementById('dailyProgressLabel');
  const container = document.getElementById('dailyProgressBar');
  if (!bar || !label || !container) return;

  container.style.display = '';
  bar.style.width = pct + '%';
  label.textContent = `${doneToday}/${totalCards} hoje (${pct}%)`;

  // Color transitions for progress milestones
  if (pct >= 100) {
    bar.style.background = 'linear-gradient(90deg, var(--accent) 0%, #a855f7 100%)';
  } else if (pct >= 75) {
    bar.style.background = 'linear-gradient(90deg, var(--accent) 0%, #22c55e 100%)';
  } else if (pct >= 50) {
    bar.style.background = 'var(--accent)';
  } else {
    bar.style.background = 'var(--accent)';
  }

  // Milestone micro-celebrations
  if (doneToday > 0 && doneToday === totalCards) {
    microCelebrate('complete');
  } else if (doneToday === Math.ceil(totalCards / 2) && totalCards > 3) {
    microCelebrate('halfway');
  }
}

// ══ Micro-Celebrations (dopamine-friendly feedback — research backed) ════════

const MOTIVATIONAL_MESSAGES = [
  'Cada questão revisada fortalece suas conexões neurais.',
  'Espaçamento ativo: seu cérebro está consolidando agora.',
  'Retrieval practice: testar > reler. Você está no caminho certo.',
  'Elaboração: você está construindo pontes entre conceitos.',
  'Consistência > intensidade. Continue assim.',
  'Seu hipocampo agradece cada revisão espaçada.',
  'Progresso real acontece no longo prazo. Você está investindo.',
  'Cada peça de conhecimento se conecta com as outras.',
  'Micro-learning funciona: sessões curtas = retenção longa.',
  'Você está construindo memória de longo prazo agora.',
];

function microCelebrate(type = 'generic') {
  const container = document.createElement('div');
  container.className = 'micro-celebration';
  container.setAttribute('aria-hidden', 'true');

  if (type === 'levelup') {
    container.innerHTML = '<span class="icon">military_tech</span>';
    container.classList.add('celebrate-levelup');
  } else if (type === 'streak') {
    container.innerHTML = '<span class="icon">local_fire_department</span>';
    container.classList.add('celebrate-streak');
  } else if (type === 'complete') {
    container.innerHTML = '<span class="icon">celebration</span>';
    container.classList.add('celebrate-complete');
  } else if (type === 'halfway') {
    container.innerHTML = '<span class="icon">star</span>';
    container.classList.add('celebrate-halfway');
  } else {
    container.innerHTML = '<span class="icon">auto_awesome</span>';
  }

  document.body.appendChild(container);
  setTimeout(() => container.remove(), 2200);
}

function showMotivationalMessage() {
  const msg = MOTIVATIONAL_MESSAGES[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)];
  const el = document.getElementById('motivationMsg');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 6000);
  }
}

// Show a motivational message every N rated cards
let _ratedCountSession = 0;
function maybeShowMotivation() {
  _ratedCountSession++;
  if (_ratedCountSession % 5 === 0) {
    showMotivationalMessage();
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
const dashBackBtn = document.getElementById('dashBackBtn');
const btnDashboard = document.getElementById('btnDashboard');
const dashHome = document.getElementById('dashboardHome');
const tabDashboard = document.getElementById('tabDashboard');
const tabQuestions = document.getElementById('tabQuestions');

let _mainView = 'dashboard';

function setMainView(view, { rerender = true } = {}) {
  _mainView = view === 'study' ? 'study' : 'dashboard';
  document.body.classList.toggle('dashboard-main-mode', _mainView === 'dashboard');

  if (tabDashboard) {
    const active = _mainView === 'dashboard';
    tabDashboard.classList.toggle('active', active);
    tabDashboard.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (tabQuestions) {
    const active = _mainView === 'study';
    tabQuestions.classList.toggle('active', active);
    tabQuestions.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  if (_mainView === 'dashboard' && rerender) {
    renderDashboard(dashHome, { inline: true }).catch(() => {});
  }
}

function openDashboard() {
  setMainView('dashboard');
}

function closeDashboard() {
  setMainView('study');
}

function buildEvidenceBasedPlan(state) {
  if (!state) return 'Plano sugerido: 10 min de revisão espaçada + 1 simulado curto.';
  if (state.dueToday > 0) {
    return `Prioridade máxima: revisar ${state.dueToday} questões vencidas hoje (efeito de espaçamento).`;
  }
  if (state.errorRate >= 35) {
    return 'Prioridade: foco em recuperação ativa de erros (retrieval practice) antes de conteúdo novo.';
  }
  if (state.totalReviewed < Math.max(10, Math.round(state.totalAvailable * 0.3))) {
    return 'Prioridade: aumentar cobertura com blocos curtos e intercalados entre matérias.';
  }
  return 'Plano sugerido: intercalar assuntos + 1 simulado + revisão dos erros críticos.';
}

async function runEvidenceProtocol(type) {
  if (type === 'spacing') {
    setMainView('study', { rerender: false });
    const chip = document.getElementById('chipSm2Due');
    if (chip && !chip.classList.contains('active')) chip.click();
    return;
  }

  if (type === 'retrieval') {
    setMainView('study', { rerender: false });
    const chipMode = document.getElementById('chipModoEstudo');
    if (chipMode && !_modoProva) chipMode.click();
    const simBtn = document.getElementById('btnSimulado');
    if (simBtn) simBtn.click();
    return;
  }

  if (type === 'interleaving') {
    setMainView('study', { rerender: false });
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.value = 'interleaved';
      applySortFromSelect();
      showSyncToast('Modo intercalado ativado (prática intercalada).');
    }
    return;
  }

  if (type === 'error-first') {
    setMainView('study', { rerender: false });
    const chip = document.getElementById('chipErrors');
    if (chip && !chip.classList.contains('active')) chip.click();
    return;
  }

  if (type === 'focus') {
    setMainView('study', { rerender: false });
    const pomBtn = document.getElementById('btnPomodoro');
    if (pomBtn) pomBtn.click();
  }
}

async function renderDashboard(targetEl = dashBody, { inline = false } = {}) {
  if (!targetEl) return;

  // Load new dashboard inline (no iframe → single scroll)
  const already = targetEl.querySelector('.ah-dash-root');
  if (already) return;

  targetEl.innerHTML = '<div class="quiz-loading"><span class="icon spin-icon">autorenew</span><p>Carregando dashboard...</p></div>';

  try {
    const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Inject scoped CSS once
    if (!document.getElementById('ah-dash-style')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'ah-dash-style';
      const rawCSS = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
      styleEl.textContent = rawCSS
        .replace(/\bbody\b/g, '.ah-dash-root')
        .replace(/:root/g, '.ah-dash-root');
      document.head.appendChild(styleEl);
    }

    // Inject body HTML
    const wrapper = document.createElement('div');
    wrapper.className = 'ah-dash-root';
    wrapper.innerHTML = doc.body.innerHTML;
    // Remove any <script> from injected HTML (we'll load the JS file)
    wrapper.querySelectorAll('script').forEach(s => s.remove());
    targetEl.innerHTML = '';
    targetEl.appendChild(wrapper);

    // Load dashboard JS via <script src> (CSP-safe)
    if (!document.getElementById('ah-dash-script')) {
      const tag = document.createElement('script');
      tag.id = 'ah-dash-script';
      tag.src = chrome.runtime.getURL('src/dashboard/dashboard.js');
      document.body.appendChild(tag);
    }
  } catch (err) {
    console.error('[Dashboard] Failed to load inline dashboard:', err);
    targetEl.innerHTML = '<div class="quiz-loading"><p>Erro ao carregar dashboard.</p></div>';
  }
  return;

  /* ── legacy inline dashboard (kept for reference) ── */
  const [sm2Data, simHistory, xpData] = await Promise.all([
    loadSm2Data(), loadSimHistory(), loadXPData()
  ]);

  const getTodayISO = () => new Date().toISOString().slice(0, 10);
  const getWeekStartISO = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const d = new Date(now);
    d.setDate(now.getDate() + diff);
    return d.toISOString().slice(0, 10);
  };

  const fmtElapsed = s => {
    const safe = Number.isFinite(s) ? s : 0;
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const sec = safe % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const subjects = [...new Set(allQuestions.map(getQuestionSubject))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

  const goals = await new Promise(resolve => {
    chrome.storage.local.get(['ah_studyGoals'], r => {
      resolve(r.ah_studyGoals || { daily: 30, weekly: 150 });
    });
  });
  const dailyGoal = Math.max(1, parseInt(goals.daily, 10) || 30);
  const weeklyGoal = Math.max(1, parseInt(goals.weekly, 10) || 150);

  const filters = await new Promise(resolve => {
    chrome.storage.local.get(['ah_dash_filters'], r => resolve(r.ah_dash_filters || { subject: 'all', period: '30d' }));
  });

  const computeDashboard = ({ subject = 'all', period = '30d' }) => {
    const baseQuestions = subject === 'all'
      ? allQuestions
      : allQuestions.filter(q => getQuestionSubject(q) === subject);

    const reviewedQuestions = baseQuestions.filter(q => sm2Data[q.id]);
    const totalReviewed = reviewedQuestions.length;
    const totalAvailable = baseQuestions.length;
    const dueToday = baseQuestions.filter(q => sm2IsDue(sm2Data[q.id])).length;
    const mastered = reviewedQuestions.filter(q => (sm2Data[q.id]?.interval || 0) >= 21).length;

    let ratingsTotal = 0;
    let errorsTotal = 0;
    reviewedQuestions.forEach(q => {
      const entry = sm2Data[q.id];
      ratingsTotal += entry?.totalRatings || 0;
      errorsTotal += entry?.errors || 0;
    });
    const hitRate = ratingsTotal > 0 ? Math.max(0, Math.round(((ratingsTotal - errorsTotal) / ratingsTotal) * 100)) : 0;
    const errorRate = ratingsTotal > 0 ? Math.max(0, Math.min(100, 100 - hitRate)) : 0;

    const today = getTodayISO();
    const weekStart = getWeekStartISO();
    const todayDone = reviewedQuestions.filter(q => sm2Data[q.id]?.lastRated === today).length;
    const weekDone = reviewedQuestions.filter(q => {
      const last = sm2Data[q.id]?.lastRated;
      return last && last >= weekStart;
    }).length;

    const totalStudyTime = simHistory.reduce((sum, h) => sum + (h.elapsed || 0), 0);

    const subjectRows = subjects.map(subj => {
      const list = allQuestions.filter(q => getQuestionSubject(q) === subj);
      let subjRatings = 0;
      let subjErrors = 0;
      list.forEach(q => {
        const e = sm2Data[q.id];
        subjRatings += e?.totalRatings || 0;
        subjErrors += e?.errors || 0;
      });
      const subjHit = subjRatings > 0 ? Math.round(((subjRatings - subjErrors) / subjRatings) * 100) : 0;
      return {
        subject: subj,
        questions: list.length,
        ratings: subjRatings,
        errors: subjErrors,
        hit: subjHit
      };
    });

    const byErrors = [...subjectRows].sort((a, b) => b.errors - a.errors).slice(0, 6);
    const byHit = [...subjectRows]
      .filter(r => r.ratings > 0)
      .sort((a, b) => b.hit - a.hit)
      .slice(0, 6);

    const filteredHistory = (() => {
      if (!Array.isArray(simHistory)) return [];
      if (period === 'all') return simHistory.slice(0, 12).reverse();
      const days = period === '7d' ? 7 : 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const toDate = d => {
        const parts = String(d || '').split('/');
        if (parts.length !== 3) return null;
        const [day, month, year] = parts.map(n => parseInt(n, 10));
        if (!day || !month || !year) return null;
        return new Date(year, month - 1, day);
      };
      return simHistory
        .filter(item => {
          const dt = toDate(item.date);
          return dt && dt >= cutoff;
        })
        .slice(0, 12)
        .reverse();
    })();

    const trendBars = filteredHistory.map(item => ({
      label: item.date,
      pct: Math.max(0, Math.min(100, item.pct || 0))
    }));

    const predictedScore = calcPredictedScore(sm2Data, baseQuestions);
    const avgHit = subjectRows.filter(r => r.ratings > 0).reduce((acc, r) => acc + r.hit, 0) / Math.max(1, subjectRows.filter(r => r.ratings > 0).length);
    const rankEstimate = Math.max(1, Math.min(99, Math.round((hitRate * 0.7) + (Math.max(0, predictedScore || 0) * 0.3))));

    const topErrorSubject = byErrors.find(r => r.errors > 0);
    const agenda = baseQuestions
      .map(q => ({ q, entry: sm2Data[q.id] }))
      .filter(item => item.entry?.nextReview)
      .sort((a, b) => String(a.entry.nextReview).localeCompare(String(b.entry.nextReview)))
      .slice(0, 6)
      .map(item => ({
        date: item.entry.nextReview,
        subject: getQuestionSubject(item.q),
        title: sanitizeQuestionText(item.q.question || '').slice(0, 56)
      }));

    return {
      baseQuestions,
      totalAvailable,
      totalReviewed,
      dueToday,
      mastered,
      ratingsTotal,
      errorsTotal,
      hitRate,
      errorRate,
      todayDone,
      weekDone,
      totalStudyTime,
      subjectRows,
      byErrors,
      byHit,
      trendBars,
      predictedScore,
      avgHit: Number.isFinite(avgHit) ? Math.round(avgHit) : 0,
      rankEstimate,
      topErrorSubject,
      agenda
    };
  };

  const state = computeDashboard({ subject: filters.subject || 'all', period: filters.period || '30d' });
  const { xp, level } = xpData;
  const xpInLevel = xp % XP_PER_LEVEL;
  const xpPct = Math.round((xpInLevel / XP_PER_LEVEL) * 100);

  const dailyPct = Math.min(100, Math.round((state.todayDone / dailyGoal) * 100));
  const weeklyPct = Math.min(100, Math.round((state.weekDone / weeklyGoal) * 100));

  const subjectOptions = ['<option value="all">Todos os assuntos</option>']
    .concat(subjects.map(sub => `<option value="${escH(sub)}" ${filters.subject === sub ? 'selected' : ''}>${escH(sub)}</option>`))
    .join('');

  const periodOptions = `
    <option value="7d" ${filters.period === '7d' ? 'selected' : ''}>Últimos 7 dias</option>
    <option value="30d" ${filters.period === '30d' ? 'selected' : ''}>Últimos 30 dias</option>
    <option value="all" ${filters.period === 'all' ? 'selected' : ''}>Histórico completo</option>
  `;

  const trendHtml = state.trendBars.length
    ? state.trendBars.map(item => `
      <div class="dash-bar-row">
        <div class="dash-bar-label">${escH(item.label)}</div>
        <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${item.pct}%"></div></div>
        <div class="dash-bar-val">${item.pct}%</div>
      </div>
    `).join('')
    : '<div style="font-size:0.78rem;color:var(--muted)">Sem dados suficientes para tendência no período.</div>';

  const byErrorsHtml = state.byErrors.length
    ? state.byErrors.map(row => `
      <div class="dash-bar-row">
        <div class="dash-bar-label">${escH(row.subject)}</div>
        <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${Math.min(100, row.errors * 10)}%;background:linear-gradient(90deg,#EF4444,#F97316)"></div></div>
        <div class="dash-bar-val">${row.errors} <span class="icon" style="font-size:12px;vertical-align:middle">close</span></div>
      </div>
    `).join('')
    : '<div style="font-size:0.78rem;color:var(--muted)">Ainda sem erros registrados.</div>';

  const byHitHtml = state.byHit.length
    ? state.byHit.map(row => `
      <div class="dash-bar-row">
        <div class="dash-bar-label">${escH(row.subject)}</div>
        <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${row.hit}%;background:linear-gradient(90deg,#16A34A,#22C55E)"></div></div>
        <div class="dash-bar-val">${row.hit}%</div>
      </div>
    `).join('')
    : '<div style="font-size:0.78rem;color:var(--muted)">Responda mais questões para comparar disciplinas.</div>';

  const agendaHtml = state.agenda.length
    ? state.agenda.map(item => `
      <div class="dash-agenda-item">
        <div><strong>${escH(item.subject)}</strong><br>${escH(item.title)}${item.title.length >= 56 ? '…' : ''}</div>
        <div style="font-weight:700;color:var(--muted)">${escH(item.date)}</div>
      </div>
    `).join('')
    : '<div style="font-size:0.78rem;color:var(--muted)">Sem revisões agendadas ainda.</div>';

  targetEl.innerHTML = `
    <div class="dash-toolbar">
      <select id="dashSubjectFilter" class="dash-filter" aria-label="Filtro de assunto">
        ${subjectOptions}
      </select>
      <select id="dashPeriodFilter" class="dash-filter" aria-label="Filtro de período">
        ${periodOptions}
      </select>
    </div>

    <div class="dash-kpi-grid">
      <div class="dash-kpi">
        <div class="dash-kpi-label">Taxa de acerto</div>
        <div class="dash-kpi-value">${state.hitRate}%</div>
        <div class="dash-kpi-sub">Erro: ${state.errorRate}%</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-label">Respondidas</div>
        <div class="dash-kpi-value">${state.totalReviewed}/${state.totalAvailable}</div>
        <div class="dash-kpi-sub">Taxa de cobertura: ${state.totalAvailable > 0 ? Math.round((state.totalReviewed / state.totalAvailable) * 100) : 0}%</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-label">Disciplina crítica</div>
        <div class="dash-kpi-value" style="font-size:0.95rem">${escH(state.topErrorSubject?.subject || '—')}</div>
        <div class="dash-kpi-sub">${state.topErrorSubject ? `${state.topErrorSubject.errors} erros` : 'Sem erros relevantes'}</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-label">Tempo total</div>
        <div class="dash-kpi-value">${fmtElapsed(state.totalStudyTime)}</div>
        <div class="dash-kpi-sub">Simulados + sessões registradas</div>
      </div>
    </div>

    <div class="dash-goals">
      <div class="dash-goal-row"><span>Meta diária</span><strong>${state.todayDone}/${dailyGoal}</strong></div>
      <div class="dash-progress-track"><div class="dash-progress-fill" style="width:${dailyPct}%"></div></div>
      <div class="dash-goal-row"><span>Meta semanal</span><strong>${state.weekDone}/${weeklyGoal}</strong></div>
      <div class="dash-progress-track"><div class="dash-progress-fill" style="width:${weeklyPct}%"></div></div>
      <div class="dash-goal-row" style="margin-bottom:0"><span>XP</span><strong>Nível ${level} · ${xpInLevel}/${XP_PER_LEVEL}</strong></div>
      <div class="dash-progress-track" style="margin-bottom:0"><div class="dash-progress-fill" style="width:${xpPct}%"></div></div>
    </div>

    <div class="dash-actions-grid">
      <button class="dash-action-btn" id="dashActionContinue" type="button"><span class="icon">play_arrow</span> Continuar de onde parou</button>
      <button class="dash-action-btn" id="dashActionReviewDue" type="button"><span class="icon">calendar_today</span> Revisar hoje (${state.dueToday})</button>
      <button class="dash-action-btn" id="dashActionReviewErrors" type="button"><span class="icon">warning_amber</span> Revisar erros</button>
      <button class="dash-action-btn" id="dashActionSim" type="button"><span class="icon">avg_pace</span> Gerar simulado</button>
      <button class="dash-action-btn" id="dashActionOpenQuestions" type="button"><span class="icon">menu_book</span> Ver questões</button>
    </div>

    <div class="dash-split">
      <div class="dash-panel">
        <div class="dash-panel-title"><span class="icon">insights</span> Tendência de desempenho</div>
        <div class="dash-bars">${trendHtml}</div>
      </div>
      <div class="dash-panel">
        <div class="dash-panel-title"><span class="icon">schedule</span> Agenda de revisão</div>
        <div class="dash-agenda-list">${agendaHtml}</div>
      </div>
    </div>

    <div class="dash-split">
      <div class="dash-panel">
        <div class="dash-panel-title"><span class="icon">trending_down</span> Erros por disciplina</div>
        <div class="dash-bars">${byErrorsHtml}</div>
      </div>
      <div class="dash-panel">
        <div class="dash-panel-title"><span class="icon">trending_up</span> Acerto por disciplina</div>
        <div class="dash-bars">${byHitHtml}</div>
      </div>
    </div>

    <div class="dash-panel" style="margin-bottom:14px;">
      <div class="dash-panel-title"><span class="icon">science</span> Protocolo de estudo comprovado</div>
      <div style="font-size:0.78rem;color:var(--text-2);line-height:1.55;margin-bottom:10px;">
        ${escH(buildEvidenceBasedPlan(state))}
      </div>
      <div class="dash-actions-grid" style="margin-bottom:0;">
        <button class="dash-action-btn" id="dashProtocolSpacing" type="button"><span class="icon">event_repeat</span> Revisão espaçada</button>
        <button class="dash-action-btn" id="dashProtocolRetrieval" type="button"><span class="icon">psychology</span> Recuperação ativa</button>
        <button class="dash-action-btn" id="dashProtocolInterleaving" type="button"><span class="icon">shuffle</span> Intercalar matérias</button>
        <button class="dash-action-btn" id="dashProtocolErrorFirst" type="button"><span class="icon">error</span> Priorizar erros</button>
        <button class="dash-action-btn" id="dashProtocolFocus" type="button"><span class="icon">timer</span> Bloco de foco (Pomodoro)</button>
      </div>
    </div>

    <div class="dash-insights">
      <div class="dash-insight-line"><strong>Predição de nota:</strong> ${state.predictedScore !== null ? `${state.predictedScore}%` : 'dados insuficientes'}</div>
      <div class="dash-insight-line"><strong>Ranking estimado:</strong> top ${100 - state.rankEstimate}% (base local)</div>
      <div class="dash-insight-line"><strong>Comparativo de disciplinas:</strong> média geral ${state.avgHit}% de acerto.</div>
      <div class="dash-comparison-note">Comparativos e ranking são estimativas locais para orientar próximas ações de estudo. Não representam ranking social global.</div>
    </div>
  `;

  const subjectFilterEl = targetEl.querySelector('#dashSubjectFilter');
  const periodFilterEl = targetEl.querySelector('#dashPeriodFilter');

  subjectFilterEl?.addEventListener('change', async () => {
    const next = { subject: subjectFilterEl.value, period: periodFilterEl?.value || '30d' };
    await new Promise(resolve => chrome.storage.local.set({ ah_dash_filters: next }, resolve));
    renderDashboard(targetEl, { inline });
  });

  periodFilterEl?.addEventListener('change', async () => {
    const next = { subject: subjectFilterEl?.value || 'all', period: periodFilterEl.value };
    await new Promise(resolve => chrome.storage.local.set({ ah_dash_filters: next }, resolve));
    renderDashboard(targetEl, { inline });
  });

  const exitDashboard = () => {
    if (inline) setMainView('study', { rerender: false });
    else closeDashboard();
  };

  targetEl.querySelector('#dashActionContinue')?.addEventListener('click', () => {
    exitDashboard();
    const target = [...document.querySelectorAll('.card:not(.hidden-card)')].find(c => !c.classList.contains('answered'))
      || document.querySelector('.card:not(.hidden-card)');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.style.outline = '2px solid rgba(255,107,0,0.45)';
      setTimeout(() => { target.style.outline = ''; }, 1500);
    }
  });

  targetEl.querySelector('#dashActionReviewDue')?.addEventListener('click', async () => {
    exitDashboard();
    const chip = document.getElementById('chipSm2Due');
    if (chip && !chip.classList.contains('active')) chip.click();
  });

  targetEl.querySelector('#dashActionReviewErrors')?.addEventListener('click', async () => {
    exitDashboard();
    const chip = document.getElementById('chipErrors');
    if (chip && !chip.classList.contains('active')) chip.click();
  });

  targetEl.querySelector('#dashActionSim')?.addEventListener('click', () => {
    exitDashboard();
    document.getElementById('btnSimulado')?.click();
  });

  targetEl.querySelector('#dashActionOpenQuestions')?.addEventListener('click', () => {
    exitDashboard();
  });

  targetEl.querySelector('#dashProtocolSpacing')?.addEventListener('click', () => runEvidenceProtocol('spacing'));
  targetEl.querySelector('#dashProtocolRetrieval')?.addEventListener('click', () => runEvidenceProtocol('retrieval'));
  targetEl.querySelector('#dashProtocolInterleaving')?.addEventListener('click', () => runEvidenceProtocol('interleaving'));
  targetEl.querySelector('#dashProtocolErrorFirst')?.addEventListener('click', () => runEvidenceProtocol('error-first'));
  targetEl.querySelector('#dashProtocolFocus')?.addEventListener('click', () => runEvidenceProtocol('focus'));
}


btnDashboard?.addEventListener('click', () => {
  if (_mainView === 'dashboard') setMainView('study', { rerender: false });
  else openDashboard();
});

tabDashboard?.addEventListener('click', () => setMainView('dashboard'));
tabQuestions?.addEventListener('click', () => setMainView('study', { rerender: false }));

dashCloseBtn?.addEventListener('click', closeDashboard);
dashBackBtn?.addEventListener('click', closeDashboard);
dashOverlay?.addEventListener('click', e => { if (e.target === dashOverlay) closeDashboard(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _mainView === 'dashboard') closeDashboard();
  if (e.key === 'Escape' && dashOverlay?.classList.contains('open')) closeDashboard();
});

// ══ Caderno de Erros chip ════════════════════════════════════════════════════

const chipErrors = document.getElementById('chipErrors');
if (chipErrors) {
  chipErrors.addEventListener('click', async function () {
    this.classList.toggle('active');
    await loadSm2Data();
    filterCards();
  });
}

// ══ Leitura em Voz Alta (compatível com extensão, grátis) ═══════════════════

let _speechUtterance = null;
let _ttsAudio = null;
let _ttsQueue = [];
let _ttsPlaying = false;

function _resetVoiceBtn(btn) {
  btn.classList.remove('speaking');
  btn.innerHTML = '<span class="icon">record_voice_over</span> Ouvir';
}

function _stopAllSpeech() {
  _ttsQueue = [];
  _ttsPlaying = false;
  if (_ttsAudio) {
    _ttsAudio.pause();
    _ttsAudio.currentTime = 0;
    _ttsAudio = null;
  }
  if (globalThis.chrome?.tts?.stop) {
    try { chrome.tts.stop(); } catch (_) { }
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  document.querySelectorAll('.btn-voice.speaking').forEach(b => _resetVoiceBtn(b));
}

function _chunkText(text, maxLen = 180) {
  const chunks = [];
  let remaining = String(text || '').trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cut = -1;
    for (let i = maxLen; i > maxLen * 0.4; i--) {
      if ('.!?;'.includes(remaining[i])) { cut = i + 1; break; }
    }
    if (cut === -1) {
      for (let i = maxLen; i > maxLen * 0.3; i--) {
        if (remaining[i] === ' ') { cut = i; break; }
      }
    }
    if (cut === -1) cut = maxLen;
    chunks.push(remaining.substring(0, cut).trim());
    remaining = remaining.substring(cut).trim();
  }
  return chunks.filter(Boolean);
}

function _gTranslateTtsUrl(text) {
  const encoded = encodeURIComponent(text);
  return `https://translate.google.com/translate_tts?ie=UTF-8&tl=pt-BR&client=tw-ob&q=${encoded}&textlen=${text.length}`;
}

function _playNextChunk(btn) {
  if (_ttsQueue.length === 0) {
    _ttsPlaying = false;
    _ttsAudio = null;
    _resetVoiceBtn(btn);
    return;
  }

  const url = _ttsQueue.shift();
  const audio = new Audio(url);
  _ttsAudio = audio;
  _ttsPlaying = true;

  audio.addEventListener('ended', () => _playNextChunk(btn));
  audio.addEventListener('error', () => {
    _ttsQueue = [];
    _ttsAudio = null;
    _ttsPlaying = false;
    _resetVoiceBtn(btn);
  });

  audio.play().catch(() => {
    _ttsQueue = [];
    _ttsAudio = null;
    _ttsPlaying = false;
    _resetVoiceBtn(btn);
  });
}

function _tryGoogleTranslateTTS(text, btn) {
  const chunks = _chunkText(text, 180);
  if (!chunks.length) return false;
  _ttsQueue = chunks.map(c => _gTranslateTtsUrl(c));
  _playNextChunk(btn);
  return true;
}

function _pickBestChromeTtsVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];
  return list.find(v => v.lang === 'pt-BR' && /natural|neural|online/i.test(v.voiceName || ''))
    || list.find(v => v.lang === 'pt-BR' && /microsoft|google/i.test(v.voiceName || ''))
    || list.find(v => v.lang === 'pt-BR')
    || list.find(v => String(v.lang || '').startsWith('pt'))
    || null;
}

function _tryChromeTTS(text, btn) {
  return new Promise(resolve => {
    if (!globalThis.chrome?.tts?.speak || !globalThis.chrome?.tts?.getVoices) {
      resolve(false);
      return;
    }

    chrome.tts.getVoices((voices) => {
      const picked = _pickBestChromeTtsVoice(voices);
      const options = {
        lang: picked?.lang || 'pt-BR',
        rate: 0.95,
        pitch: 1,
        enqueue: false,
        onEvent: (event) => {
          if (event.type === 'end' || event.type === 'interrupted' || event.type === 'cancelled' || event.type === 'error') {
            _ttsPlaying = false;
            _resetVoiceBtn(btn);
          }
        }
      };
      if (picked?.voiceName) options.voiceName = picked.voiceName;

      try {
        chrome.tts.speak(text, options, () => {
          if (chrome.runtime?.lastError) {
            resolve(false);
            return;
          }
          _ttsPlaying = true;
          resolve(true);
        });
      } catch (_) {
        resolve(false);
      }
    });
  });
}

function _fallbackWebSpeech(text, btn) {
  if (!('speechSynthesis' in window)) {
    _resetVoiceBtn(btn);
    return;
  }

  _speechUtterance = new SpeechSynthesisUtterance(text);
  _speechUtterance.lang = 'pt-BR';
  _speechUtterance.rate = 0.92;
  _speechUtterance.pitch = 1;

  const voices = window.speechSynthesis.getVoices();
  const bestVoice = voices.find(v => v.lang === 'pt-BR' && /google/i.test(v.name))
    || voices.find(v => v.lang === 'pt-BR')
    || voices.find(v => v.lang.startsWith('pt'));
  if (bestVoice) _speechUtterance.voice = bestVoice;

  _speechUtterance.onend = () => _resetVoiceBtn(btn);
  _speechUtterance.onerror = () => _resetVoiceBtn(btn);
  window.speechSynthesis.speak(_speechUtterance);
}

/* ── Main entry point ───────────────────────────────────────────────────── */

/**
 * Main entry: speak text with best available voice.
 * 1) chrome.tts (extensão, pode usar voz natural do sistema)
 * 2) Google Translate TTS (grátis, sem chave)
 * 3) Web Speech API fallback
 */
async function speakText(text, btn) {
  if (btn.classList.contains('speaking')) {
    _stopAllSpeech();
    return;
  }

  _stopAllSpeech();
  btn.classList.add('speaking');
  btn.innerHTML = '<span class="icon">stop_circle</span> Parar';

  const startedChromeTts = await _tryChromeTTS(text, btn);
  if (startedChromeTts) return;

  const startedGoogleTts = _tryGoogleTranslateTTS(text, btn);
  if (startedGoogleTts) return;

  _fallbackWebSpeech(text, btn);
}

// ══ Tags IA ══════════════════════════════════════════════════════════════════

function renderCardTags(container, tags) {
  container.innerHTML = tags.map(tag =>
    `<span class="card-tag"><span class="icon">local_offer</span>${escH(tag)}</span>`
  ).join('');
}

function refreshSubjectOrganizationAfterTags() {
  populateSubjectSelect(_originalOrder);
  const sortMode = document.getElementById('sortSelect')?.value || 'default';
  if (sortMode === 'subject' || sortMode === 'subject_grouped' || sortMode === 'folder' || sortMode === 'folder_grouped') {
    const sorted = getSortedQuestions(_originalOrder, sortMode);
    allQuestions = sorted;
    rebuildCardList(sorted, sortMode);
  } else {
    filterCards();
  }
}

async function generateTagsForCardElement(cardEl, sharedSm2Data = null) {
  if (!cardEl) return false;
  const qid = cardEl.dataset.qid;
  if (!qid) return false;

  const btnTags = cardEl.querySelector('.btn-tags');
  const tagsContainer = cardEl.querySelector('.card-tags');
  if (!btnTags || !tagsContainer) return false;

  const originalBtnHtml = btnTags.innerHTML;
  btnTags.classList.add('loading');
  btnTags.innerHTML = '<span class="icon" style="animation:spin 1s linear infinite">autorenew</span> Gerando...';

  try {
    const questionText = sanitizeQuestionText(cardEl.querySelector('.card-question')?.innerText || '');
    if (!questionText) throw new Error('no-question-text');

    const tags = await ApiService.generateTags(questionText);
    if (!Array.isArray(tags) || tags.length === 0) throw new Error('no-tags');

    renderCardTags(tagsContainer, tags);
    btnTags.style.display = 'none';

    if (sharedSm2Data) {
      if (!sharedSm2Data[qid]) sharedSm2Data[qid] = {};
      sharedSm2Data[qid].tags = tags;
    } else {
      const data = await loadSm2Data();
      if (!data[qid]) data[qid] = {};
      data[qid].tags = tags;
      await saveSm2Data(data);
    }

    const subject = getQuestionSubject({ id: qid, question: questionText, answer: '' });
    cardEl.dataset.subject = subject;
    const subjectBadge = cardEl.querySelector('.card-subject');
    if (subjectBadge) {
      subjectBadge.innerHTML = `<span class="icon">account_tree</span> ${escH(subject)}`;
    }

    return true;
  } catch (err) {
    btnTags.classList.remove('loading');
    btnTags.innerHTML = originalBtnHtml;
    return false;
  }
}

async function generateTagsForVisibleCards() {
  const batchBtn = document.getElementById('btnTagAllVisible');
  if (!batchBtn) return;

  const visibleCards = [...document.querySelectorAll('.card:not(.hidden-card)')];
  const targetCards = visibleCards.filter(card => {
    const hasTags = card.querySelector('.card-tag');
    const btnTags = card.querySelector('.btn-tags');
    return card.dataset.qid && !hasTags && btnTags;
  });

  if (!targetCards.length) {
    showSyncToast('Todas as questões visíveis já têm tags.');
    return;
  }

  const original = batchBtn.innerHTML;
  batchBtn.disabled = true;
  batchBtn.innerHTML = '<span class="icon" style="animation:spin 1s linear infinite">autorenew</span> Tagueando...';

  let success = 0;
  let failed = 0;
  const sm2Data = await loadSm2Data();
  for (const card of targetCards) {
    const ok = await generateTagsForCardElement(card, sm2Data);
    if (ok) success += 1;
    else failed += 1;
  }
  await saveSm2Data(sm2Data);

  refreshSubjectOrganizationAfterTags();
  showSyncToast(`${success} questão${success !== 1 ? 'ões' : ''} tagueada${success !== 1 ? 's' : ''}${failed ? ` · ${failed} falharam` : ''}`);

  batchBtn.disabled = false;
  batchBtn.innerHTML = original;
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
const POM_POSITION_KEY = 'ah_pomodoro_position';

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
  document.getElementById('pomPlayIcon').textContent = 'play_arrow';
  updatePomDisplay();
}

function clampPomPosition(left, top, widget) {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - widget.offsetWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - widget.offsetHeight - margin);
  return {
    left: Math.max(margin, Math.min(left, maxLeft)),
    top: Math.max(margin, Math.min(top, maxTop))
  };
}

function applyPomPosition(widget, left, top) {
  const pos = clampPomPosition(left, top, widget);
  widget.style.left = `${pos.left}px`;
  widget.style.top = `${pos.top}px`;
  widget.style.bottom = 'auto';
}

async function restorePomodoroPosition(widget) {
  try {
    const saved = await new Promise(resolve => {
      chrome.storage.local.get([POM_POSITION_KEY], r => resolve(r[POM_POSITION_KEY] || null));
    });
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      applyPomPosition(widget, saved.left, saved.top);
    }
  } catch (_) {
    // ignore restore errors
  }
}

// ════════════════════════════════════════════════════════════════
//  MANUAL ADD QUESTION
// ════════════════════════════════════════════════════════════════
function setupManualAddQuestion() {
  const triggerBtn = document.getElementById('btnAddQuestion');
  const overlay    = document.getElementById('maqOverlay');
  if (!triggerBtn || !overlay) return;

  const closeModal = () => overlay.classList.add('hidden');

  const showError = (msg) => {
    const el = document.getElementById('maqError');
    const ms = document.getElementById('maqErrorMsg');
    if (ms) ms.textContent = msg;
    if (el) el.classList.remove('hidden');
  };

  const hideError = () => {
    document.getElementById('maqError')?.classList.add('hidden');
  };

  const resetForm = () => {
    const qTA = document.getElementById('maqQuestion');
    const aTA = document.getElementById('maqAnswer');
    const sub = document.getElementById('maqSubject');
    const src = document.getElementById('maqSource');
    const saveBtn = document.getElementById('maqSaveBtn');
    if (qTA)  { qTA.value = ''; document.getElementById('maqQCount').textContent = '0'; }
    if (aTA)  { aTA.value = ''; document.getElementById('maqACount').textContent = '0'; }
    if (sub)  sub.value = '';
    if (src)  src.value = '';
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span class="icon">save</span> Salvar questão';
    }
    hideError();
  };

  const populateFolders = () => {
    const select = document.getElementById('maqFolder');
    if (!select) return;
    select.innerHTML = '';
    chrome.storage.local.get(['binderStructure'], (result) => {
      const data = result.binderStructure;
      if (!Array.isArray(data)) return;
      const addOpts = (nodes, prefix) => {
        for (const node of nodes) {
          if (node.type === 'folder') {
            const opt = document.createElement('option');
            opt.value = node.id;
            opt.textContent = prefix + (node.title || node.id);
            select.appendChild(opt);
            if (node.children?.length) addOpts(node.children, prefix + '\u00a0\u00a0\u203a ');
          }
        }
      };
      addOpts(data, '');
    });
  };

  const openModal = () => {
    resetForm();
    populateFolders();
    overlay.classList.remove('hidden');
    setTimeout(() => document.getElementById('maqQuestion')?.focus(), 60);
  };

  // Open trigger
  triggerBtn.addEventListener('click', openModal);

  // Close buttons
  document.getElementById('maqCloseBtn')?.addEventListener('click', closeModal);
  document.getElementById('maqCancelBtn')?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doSave();
  });

  // Character counters
  document.getElementById('maqQuestion')?.addEventListener('input', function () {
    document.getElementById('maqQCount').textContent = this.value.length;
  });
  document.getElementById('maqAnswer')?.addEventListener('input', function () {
    document.getElementById('maqACount').textContent = this.value.length;
  });

  // Save
  document.getElementById('maqSaveBtn')?.addEventListener('click', doSave);

  function doSave() {
    hideError();
    const question = document.getElementById('maqQuestion')?.value.trim();
    const answer   = document.getElementById('maqAnswer')?.value.trim();
    const subject  = document.getElementById('maqSubject')?.value.trim() || '';
    const source   = document.getElementById('maqSource')?.value.trim()  || '';
    const folderId = document.getElementById('maqFolder')?.value;

    if (!question || !answer) {
      showError('Enunciado e resposta são obrigatórios.');
      return;
    }

    const saveBtn = document.getElementById('maqSaveBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="icon" style="animation:spin 0.8s linear infinite;display:inline-block">sync</span> Salvando...';
    }

    chrome.storage.local.get(['binderStructure'], (result) => {
      let data = result.binderStructure;
      if (!Array.isArray(data) || !data.length) {
        data = [{ id: 'root', type: 'folder', title: 'Raiz', children: [] }];
      }

      // Duplicate check
      const isDupe = ((nodes) => {
        const check = (nl) => {
          for (const n of nl) {
            if (n.type === 'question' && n.content?.question === question) return true;
            if (n.children && check(n.children)) return true;
          }
          return false;
        };
        return check(nodes);
      })(data);

      if (isDupe) {
        showError('Essa questão já está salva.');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<span class="icon">save</span> Salvar questão';
        }
        return;
      }

      // Find target folder
      const findFolder = (nodes, id) => {
        for (const n of nodes) {
          if (n.type === 'folder' && n.id === id) return n;
          if (n.children) { const f = findFolder(n.children, id); if (f) return f; }
        }
        return null;
      };

      const target = (folderId && findFolder(data, folderId)) || data[0];
      if (!target || !target.children) {
        showError('Pasta inválida. Tente novamente.');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<span class="icon">save</span> Salvar questão'; }
        return;
      }

      target.children.push({
        id: 'q' + Date.now(),
        type: 'question',
        content: { question, answer, source, subject },
        createdAt: Date.now()
      });

      chrome.storage.local.set({ binderStructure: data }, () => {
        if (chrome.runtime.lastError) {
          showError('Erro ao salvar: ' + chrome.runtime.lastError.message);
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<span class="icon">save</span> Salvar questão'; }
          return;
        }
        closeModal();
        // The live chrome.storage.onChanged listener in study.js will auto-reload cards
      });
    });
  }
}

function setupPomodoroDrag() {
  const widget = document.getElementById('pomodoroWidget');
  if (!widget) return;

  restorePomodoroPosition(widget);

  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const savePosition = (left, top) => {
    chrome.storage.local.set({ [POM_POSITION_KEY]: { left, top } });
  };

  const onPointerMove = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    const nextLeft = startLeft + (event.clientX - startX);
    const nextTop = startTop + (event.clientY - startY);
    applyPomPosition(widget, nextLeft, nextTop);
  };

  const onPointerUp = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    widget.classList.remove('dragging');
    widget.releasePointerCapture(pointerId);

    const left = parseFloat(widget.style.left);
    const top = parseFloat(widget.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      savePosition(left, top);
    }
  };

  widget.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('.pom-btn')) return;

    const rect = widget.getBoundingClientRect();
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    widget.classList.add('dragging');
    widget.setPointerCapture(pointerId);
    event.preventDefault();
  });

  widget.addEventListener('pointermove', onPointerMove);
  widget.addEventListener('pointerup', onPointerUp);
  widget.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('resize', () => {
    const left = parseFloat(widget.style.left);
    const top = parseFloat(widget.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      applyPomPosition(widget, left, top);
    }
  });
}

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

setupPomodoroDrag();

setupStickyOffsets();
setupSidebarProxyClicks();
setupSidebarSessionSync();
setupManualAddQuestion();


// === BK-08: Export/Import Full ===
document.getElementById('btnExportFull')?.addEventListener('click', async () => {
  try {
    const xpData = await loadXPData();
    const sm2Data = await loadSm2Data();
    const binderData = await new Promise(r => chrome.storage.local.get(['binderStructure'], d => r(d.binderStructure || [])));
    const payload = { version: 2, exportedAt: Date.now(), exportedAtISO: new Date().toISOString(), binderStructure: binderData, sm2Data, xpData };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AnswerHunter_backup_v2_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showSyncToast(`Backup v2 exportado: ${allQuestions.length} questões + SM2 + XP`);
  } catch(err) { showSyncToast('Erro ao exportar: ' + err.message); }
});

document.getElementById('btnImportFull')?.addEventListener('click', () => {
  document.getElementById('importFileInput')?.click();
});

document.getElementById('importFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') throw new Error('JSON inválido');
    const isV2 = data.version === 2 && data.binderStructure;
    const isLegacy = Array.isArray(data) || (data.binderStructure && !data.version);
    if (!isV2 && !isLegacy) throw new Error('Formato não reconhecido. Esperado v2 ou legacy.');
    const questionCount = isV2 ? countQuestionsInTree(data.binderStructure) : countQuestionsInTree(Array.isArray(data) ? data : data.binderStructure);
    if (!confirm(`Importar backup ${isV2 ? 'v2' : 'legado'} com ${questionCount} questões?

ISTO SUBSTITUIRÁ todos os dados atuais!`)) { e.target.value=''; return; }
    showSyncToast('Importando...');
    const structure = Array.isArray(data) ? data : data.binderStructure;
    await new Promise(r => chrome.storage.local.set({ binderStructure: structure }, r));
    if (isV2 && data.sm2Data) await new Promise(r => chrome.storage.local.set({ ah_sm2Data: data.sm2Data }, r));
    if (isV2 && data.xpData) await new Promise(r => chrome.storage.local.set({ ah_xpData: data.xpData }, r));
    showSyncToast(`Importado: ${questionCount} questões` + (isV2 ? ' + SM2 + XP' : ' (legado)'));
    setTimeout(() => window.location.reload(), 1500);
  } catch(err) { showSyncToast('Erro ao importar: ' + (err.message || 'arquivo inválido')); }
  e.target.value='';
});

function countQuestionsInTree(nodes) {
  if (!Array.isArray(nodes)) return 0;
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'question') count++;
    if (n.children) count += countQuestionsInTree(n.children);
  }
  return count;
}
