// study.js — AnswerHunter Study Page
// Reads binder data from chrome.storage.local and renders interactive study cards.

const escH = s => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const formatText = text => {
  if (!text) return '';
  // Add newlines before options like A), B), a), b), etc. if they are not already on a new line
  return text.replace(/([^\n])\s+([A-Ea-e]\))/g, '$1\n$2');
};

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
    <div class="card-question">${escH(formatText(q.question))}</div>
    <button class="reveal-btn" type="button">
      <span class="icon">lightbulb</span> Revelar resposta
    </button>
    <div class="card-answer" hidden>
      <div class="answer-label"><span class="icon">check_circle</span> Resposta</div>
      <div class="answer-text">${escH(formatText(q.answer))}</div>
      ${q.source ? `<div class="answer-source"><span class="icon">link</span> ${escH(q.source)}</div>` : ''}
    </div>
    ${fmtDate(q.createdAt) ? `<div class="card-date">Salvo em ${fmtDate(q.createdAt)}</div>` : ''}
  `;

  article.querySelector('.reveal-btn').addEventListener('click', () => {
    revealCard(article);
  });

  article.querySelector('.btn-copy-card').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = `Questão:\n${q.question}\n\nResposta:\n${q.answer}`;
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
      const qText = card.querySelector('.card-question').textContent;
      const aText = card.querySelector('.answer-text').textContent;
      text += `--- Questão ${idx + 1} ---\n${qText}\n\nResposta:\n${aText}\n\n`;
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
