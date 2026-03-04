/**
 * AnswerHunter — Study Hub Controller
 * 
 * ES Module entry point for the redesigned Study Hub.
 * Imports existing service singletons and orchestrates the UI.
 * 
 * Design system: "Tinta & Papel" (Ink & Paper)
 * Aesthetic: editorial-academic, warm tones, precise typography
 */

/* ─── Imports ──────────────────────────────────────────────────────── */

import { FSRSService } from '../services/FSRSService.js';
import { ContentHierarchyService } from '../services/ContentHierarchyService.js';
import { ApiService } from '../services/ApiService.js';
import { AnalyticsService } from '../services/AnalyticsService.js';
import { BadgeService } from '../services/BadgeService.js';
import { NotesService } from '../services/NotesService.js';
import { ExportService } from '../services/ExportService.js';
import { SearchIndexService } from '../services/SearchIndexService.js';
import { FlashcardGeneratorService } from '../services/FlashcardGeneratorService.js';
import { PedagogicalPromptsService } from '../services/PedagogicalPromptsService.js';
import { StudyPlanService } from '../services/StudyPlanService.js';
import { LearningPathService } from '../services/LearningPathService.js';
import { RecommendationService } from '../services/RecommendationService.js';
import { MigrationService } from '../services/MigrationService.js';
import { ElevenLabsTTSService } from '../services/ElevenLabsTTSService.js';

/* ─── DOM Helpers ──────────────────────────────────────────────────── */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const on = (el, evt, fn, opts) => { if (el) el.addEventListener(evt, fn, opts); };
const hide = el => { if (el) el.hidden = true; };
const show = el => { if (el) el.hidden = false; };

/* ─── Global State ─────────────────────────────────────────────────── */

const state = {
  currentView: 'home',
  sidebarCollapsed: false,
  theme: 'light',
  hierarchy: null,

  // Study session
  session: {
    active: false,
    cards: [],
    index: 0,
    results: [],
    revealed: false,
  },

  // Flashcards
  flashcards: {
    cards: [],
    index: 0,
    flipped: false,
  },

  // Pomodoro
  pomodoro: {
    running: false,
    seconds: 25 * 60,
    mode: 'focus', // focus | break
    interval: null,
  },

  // Library
  library: {
    viewMode: 'grid',
    sort: 'name',
    collection: 'all',
  },

  // Analytics cache
  analytics: null,
  xpData: null,
  badges: null,

  // Insights UI state
  insights: {
    badgesFilter: 'all',
  },

  // Practice filter (Quiz/Simulado): supports discipline or folder/topic
  practiceFilter: 'all',
};

/* ─── Disc Colors ──────────────────────────────────────────────────── */

const DISC_COLORS = [
  '#c17832', '#2d7a4f', '#4a7fb5', '#a3547c', '#d4883e',
  '#5b8c5a', '#7b68ae', '#c45c4a', '#3d8b8b', '#8a7242',
  '#6a8fc7', '#c4a35a', '#e07a5f', '#81b29a', '#f2cc8f',
];

function discColor(index) {
  return DISC_COLORS[index % DISC_COLORS.length];
}

/* ─── Toast System ─────────────────────────────────────────────────── */

function toast(message, type = 'info', duration = 3500) {
  const container = $('#toastContainer');
  if (!container) return;
  const icons = { info: 'info', success: 'check_circle', warning: 'warning', error: 'error' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast__icon icon" style="font-size:18px">${icons[type] || 'info'}</span><span>${message}</span>`;
  container.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.add('exit');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

/* ─── Modal System ─────────────────────────────────────────────────── */

function openModal(title, bodyHtml, footerHtml = '') {
  const overlay = $('#modalOverlay');
  const titleEl = $('#modalTitle');
  const bodyEl = $('#modalBody');
  const footerEl = $('#modalFooter');
  if (!overlay) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;
  footerEl.innerHTML = footerHtml;
  footerEl.style.display = footerHtml ? '' : 'none';
  overlay.classList.add('active');
}

function closeModal() {
  const overlay = $('#modalOverlay');
  if (overlay) overlay.classList.remove('active');
}

/* ─── Tool Dock ────────────────────────────────────────────────────── */

function openToolDock(title, contentHtml) {
  const dock = $('#toolDock');
  if (!dock) return;
  $('#toolDockTitle').textContent = title;
  $('#toolDockBody').innerHTML = contentHtml;
  dock.classList.add('open');
}

function closeToolDock() {
  const dock = $('#toolDock');
  if (dock) dock.classList.remove('open');
}

/* ─── Theme ────────────────────────────────────────────────────────── */

function setTheme(theme) {
  if (theme === 'auto') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const icon = $('#themeIcon');
  if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
  chrome.storage?.sync?.set({ ah_theme: theme }).catch(() => { });
}

async function loadTheme() {
  try {
    const data = await chrome.storage.sync.get('ah_theme');
    setTheme(data.ah_theme || 'light');
  } catch {
    setTheme('light');
  }
}

/* ─── View Router ──────────────────────────────────────────────────── */

function navigateTo(viewId) {
  if (state.currentView === viewId) return;
  state.currentView = viewId;

  // Update nav items
  $$('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewId);
  });

  // Show/hide panels 
  $$('.view-panel').forEach(panel => {
    const isTarget = panel.id === `view${capitalize(viewId)}`;
    panel.classList.toggle('active', isTarget);
  });

  // Close mobile sidebar
  const sidebar = $('#sidebar');
  if (sidebar && window.innerWidth < 768) {
    sidebar.classList.remove('mobile-open');
    $('#mobileOverlay')?.classList.remove('active');
  }

  // Lazy-load view data
  loadViewData(viewId);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function loadViewData(viewId) {
  switch (viewId) {
    case 'home': return renderHome();
    case 'library': return renderLibrary();
    case 'review': return renderReview();
    case 'insights': return renderInsights();
    case 'planning': return renderPlanning();
  }
}

/* ─── Sidebar ──────────────────────────────────────────────────────── */

function initSidebar() {
  // Nav item clicks
  $$('.nav-item[data-view]').forEach(item => {
    on(item, 'click', () => navigateTo(item.dataset.view));
  });

  // Handle ALL elements with data-view attribute (panel action links, buttons, etc.)
  on(document, 'click', e => {
    const target = e.target.closest('[data-view]');
    if (target && !target.classList.contains('nav-item')) {
      e.preventDefault();
      navigateTo(target.dataset.view);
    }
  });

  // Toggle (sidebar collapse button)
  on($('#sidebarToggle'), 'click', () => {
    const sidebar = $('#sidebar');
    if (!sidebar) return;
    if (window.innerWidth < 768) {
      sidebar.classList.toggle('mobile-open');
      $('#mobileOverlay')?.classList.toggle('active');
    } else {
      sidebar.classList.toggle('collapsed');
      state.sidebarCollapsed = !state.sidebarCollapsed;
      $('#app')?.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    }
  });

  // Mobile sidebar toggle (topbar hamburger)
  on($('#mobileSidebarToggle'), 'click', () => {
    const sidebar = $('#sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('mobile-open');
    $('#mobileOverlay')?.classList.toggle('active');
  });

  // Mobile overlay close
  on($('#mobileOverlay'), 'click', () => {
    $('#sidebar')?.classList.remove('mobile-open');
    $('#mobileOverlay')?.classList.remove('active');
  });

  // Cross-navigation buttons
  on($('#startReviewBtn'), 'click', () => navigateTo('review'));
  on($('#goLibraryBtn'), 'click', () => navigateTo('library'));
  on($('#goInsightsBtn'), 'click', () => navigateTo('insights'));
}

/* ─── Command Palette ──────────────────────────────────────────────── */

function initCommandPalette() {
  const overlay = $('#cmdPalette');
  const input = $('#cmdInput');
  const results = $('#cmdResults');
  if (!overlay || !input) return;

  function openPalette() {
    overlay.classList.add('active');
    input.value = '';
    input.focus();
    filterResults('');
  }
  function closePalette() {
    overlay.classList.remove('active');
  }

  function filterResults(query) {
    const q = query.toLowerCase().trim();
    $$('.cmd-result', results).forEach(r => {
      const text = r.textContent.toLowerCase();
      r.style.display = !q || text.includes(q) ? '' : 'none';
    });
  }

  function executeResult(action) {
    closePalette();
    if (action.startsWith('nav:')) {
      navigateTo(action.replace('nav:', ''));
    } else if (action === 'toggle-theme') {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
    } else if (action === 'pomodoro') {
      togglePomodoroTimer();
    }
  }

  on(input, 'input', () => filterResults(input.value));
  on(overlay, 'click', e => { if (e.target === overlay) closePalette(); });
  on(input, 'keydown', e => {
    if (e.key === 'Escape') closePalette();
    if (e.key === 'Enter') {
      const first = $('.cmd-result:not([style*="none"])', results);
      if (first) executeResult(first.dataset.action);
    }
  });
  $$('.cmd-result', results).forEach(r => {
    on(r, 'click', () => executeResult(r.dataset.action));
  });

  // Focus search input (topbar)
  on($('#globalSearch'), 'focus', e => {
    e.target.blur();
    openPalette();
  });

  // Sidebar search trigger
  on($('#searchTrigger'), 'click', openPalette);

  // Populate command palette with navigation results
  if (results && results.children.length === 0) {
    const commands = [
      { icon: 'home', label: 'Ir para Início', action: 'nav:home' },
      { icon: 'menu_book', label: 'Ir para Biblioteca', action: 'nav:library' },
      { icon: 'school', label: 'Ir para Estudar', action: 'nav:study' },
      { icon: 'refresh', label: 'Ir para Revisão', action: 'nav:review' },
      { icon: 'exercise', label: 'Ir para Prática', action: 'nav:practice' },
      { icon: 'calendar_month', label: 'Ir para Planejamento', action: 'nav:planning' },
      { icon: 'insights', label: 'Ir para Insights', action: 'nav:insights' },
      { icon: 'dark_mode', label: 'Alternar Tema', action: 'toggle-theme' },
      { icon: 'timer', label: 'Pomodoro Timer', action: 'pomodoro' },
    ];
    results.innerHTML = commands.map(c => `
      <div class="cmd-result command-item" data-action="${c.action}" tabindex="0">
        <span class="material-symbols-rounded command-item-icon">${c.icon}</span>
        <span class="command-item-label">${c.label}</span>
      </div>
    `).join('');
    // Re-bind click events on new results
    $$('.cmd-result', results).forEach(r => {
      on(r, 'click', () => executeResult(r.dataset.action));
    });
  }

  // Ctrl+K shortcut registration (in global keydown handler)
  window.__openPalette = openPalette;
}

/* ─── Keyboard Shortcuts ───────────────────────────────────────────── */

function initKeyboard() {
  on(document, 'keydown', e => {
    // Skip if typing in input
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    // Ctrl+K → command palette
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      window.__openPalette?.();
      return;
    }

    // Single-key shortcuts (only when not in input)
    const key = e.key.toLowerCase();
    const shortcuts = {
      'h': 'home',
      'l': 'library',
      's': 'study',
      'r': 'review',
      'p': 'practice',
      'f': 'practice',
      'i': 'insights',
    };
    if (shortcuts[key]) {
      navigateTo(shortcuts[key]);
      return;
    }
    if (key === 't') {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
      return;
    }
    if (key === 'escape') {
      closeModal();
      closeToolDock();
      $('#cmdPalette')?.classList.remove('active');
    }

    // Study session shortcuts
    if (state.session.active && state.session.revealed) {
      const rateMap = { '1': 1, '2': 2, '3': 3, '4': 4 };
      if (rateMap[key]) rateCurrentCard(rateMap[key]);
    }
    if (state.session.active && !state.session.revealed && key === ' ') {
      e.preventDefault();
      revealAnswer();
    }
  });
}

/* ─── Pomodoro Timer ───────────────────────────────────────────────── */

function initPomodoro() {
  on($('#pomodoroToggle'), 'click', togglePomodoroTimer);
  on($('#pomodoroReset'), 'click', () => {
    stopPomodoro();
    state.pomodoro.mode = 'focus';
    state.pomodoro.seconds = 25 * 60;
    updatePomodoroDisplay();
  });
}

function togglePomodoroTimer() {
  if (state.pomodoro.running) {
    stopPomodoro();
  } else {
    startPomodoro();
  }
}

function startPomodoro() {
  state.pomodoro.running = true;
  const icon = $('#pomodoroToggle .material-symbols-rounded');
  if (icon) icon.textContent = 'pause';
  state.pomodoro.interval = setInterval(() => {
    state.pomodoro.seconds--;
    updatePomodoroDisplay();
    if (state.pomodoro.seconds <= 0) {
      stopPomodoro();
      if (state.pomodoro.mode === 'focus') {
        toast('Tempo de foco concluído! Faça uma pausa.', 'success');
        state.pomodoro.mode = 'break';
        state.pomodoro.seconds = 5 * 60;
      } else {
        toast('Pausa concluída! Volte ao foco.', 'info');
        state.pomodoro.mode = 'focus';
        state.pomodoro.seconds = 25 * 60;
      }
      updatePomodoroDisplay();
    }
  }, 1000);
}

function stopPomodoro() {
  state.pomodoro.running = false;
  clearInterval(state.pomodoro.interval);
  const icon = $('#pomodoroToggle .material-symbols-rounded');
  if (icon) icon.textContent = 'play_arrow';
}

function updatePomodoroDisplay() {
  const m = Math.floor(state.pomodoro.seconds / 60);
  const s = state.pomodoro.seconds % 60;
  const timeEl = $('#pomodoroTime');
  const labelEl = $('#pomodoroLabel');
  const progressEl = $('#pomodoroProgress');
  const wrapEl = $('#topbarPomodoro');

  if (timeEl) timeEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (labelEl) labelEl.textContent = state.pomodoro.mode === 'focus' ? 'Foco' : 'Pausa';

  if (progressEl) {
    const total = state.pomodoro.mode === 'focus' ? 25 * 60 : 5 * 60;
    const progress = (state.pomodoro.seconds / total) * 100;
    progressEl.style.width = `${progress}%`;
  }

  if (wrapEl) {
    if (state.pomodoro.mode === 'break') {
      wrapEl.classList.add('break-mode');
    } else {
      wrapEl.classList.remove('break-mode');
    }

    if (state.pomodoro.running) {
      wrapEl.classList.add('is-running');
    } else {
      wrapEl.classList.remove('is-running');
    }
  }
}

/* ─── Data Loading ─────────────────────────────────────────────────── */

async function loadData() {
  try {
    // Check migration
    if (await MigrationService.needsMigration()) {
      toast('Migrando dados para novo formato...', 'info');
      await MigrationService.migrate();
      ContentHierarchyService.invalidate();
      toast('Migração concluída!', 'success');
    }

    // Load hierarchy
    state.hierarchy = await ContentHierarchyService.load();

    // Load analytics
    state.analytics = await AnalyticsService.getOverview();

    // Load XP
    try {
      const xpRaw = await new Promise(resolve => {
        chrome.storage.local.get('ah_xpData', r => resolve(r.ah_xpData));
      });
      state.xpData = xpRaw || { totalXP: 0, level: 1 };
    } catch {
      state.xpData = { totalXP: 0, level: 1 };
    }

    // Load badges
    state.badges = await BadgeService.getUnlocked();

    // Build search index
    await SearchIndexService.build();

    return true;
  } catch (err) {
    console.error('[StudyHub] loadData failed:', err);
    toast('Erro ao carregar dados. Verifique o console.', 'error');
    return false;
  }
}

/* ─── Utility: Get All Cards Flat ──────────────────────────────────── */

function getAllCards() {
  if (!state.hierarchy) return [];
  const cards = [];
  const discs = state.hierarchy || [];
  for (const disc of discs) {
    const modules = disc.modules || [];
    for (const mod of modules) {
      const topics = mod.topics || [];
      for (const topic of topics) {
        const tCards = topic.cards || [];
        for (const card of tCards) {
          // IMPORTANT: Keep original reference so mutations (e.g. sm2 updates)
          // propagate back to state.hierarchy for correct persistence.
          card._disc = disc.name;
          card._discId = disc.id;
          card._topic = topic.name;
          cards.push(card);
        }
      }
    }
  }
  return cards;
}

function getDueCards() {
  return getAllCards().filter(c => {
    if (!c.sm2 || !c.sm2.lastRated) return true; // New card, never reviewed
    return FSRSService.isDue(c.sm2);
  });
}

function getOverdueCards() {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  return getAllCards().filter(c => {
    if (!c.sm2 || !c.sm2.nextReview) return false;
    return c.sm2.nextReview < today; // overdue = nextReview is strictly before today
  });
}

function getNewCards() {
  return getAllCards().filter(c => !c.sm2 || !c.sm2.lastRated);
}

/**
 * Remove temporary runtime metadata from cards before persisting.
 * These props (_disc, _discId, _topic) are added at runtime by getAllCards()
 * and should not be serialized into chrome.storage.
 */
function _cleanTempProps(hierarchy) {
  if (!Array.isArray(hierarchy)) return;
  for (const disc of hierarchy) {
    for (const mod of (disc.modules || [])) {
      for (const topic of (mod.topics || [])) {
        for (const card of (topic.cards || [])) {
          delete card._disc;
          delete card._discId;
          delete card._topic;
          delete card._aiGenerated;
        }
      }
    }
  }
}

/* ─── Greeting ─────────────────────────────────────────────────────── */

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Boa madrugada!';
  if (h < 12) return 'Bom dia!';
  if (h < 18) return 'Boa tarde!';
  return 'Boa noite!';
}

/* ─── HOME VIEW ────────────────────────────────────────────────────── */

async function renderHome() {
  const greeting = $('#greeting');
  if (greeting) greeting.textContent = getGreeting();

  const allCards = getAllCards();
  const dueCards = getDueCards();
  const totalCards = allCards.length;

  // Summary text
  const summary = $('#homeSummary');
  if (summary) {
    if (totalCards === 0) {
      summary.textContent = 'Use o popup do AnswerHunter para buscar respostas e construir seu acervo.';
    } else if (dueCards.length > 0) {
      summary.textContent = `Você tem ${dueCards.length} card${dueCards.length > 1 ? 's' : ''} para revisar hoje.`;
    } else {
      summary.textContent = 'Tudo em dia! Que tal explorar novos tópicos?';
    }
  }

  // Hero CTA
  const ctaLabel = $('#heroCtaLabel');
  if (ctaLabel) {
    ctaLabel.textContent = dueCards.length > 0 ? `Revisar ${dueCards.length} cards` : 'Iniciar sessão';
  }
  on($('#heroCta'), 'click', () => {
    if (dueCards.length > 0) {
      navigateTo('review');
    } else {
      navigateTo('study');
    }
  });

  // Stats
  const reviewed = state.analytics?.todayReviews || 0;
  const accuracy = state.analytics?.todayAccuracy != null
    ? `${Math.round(state.analytics.todayAccuracy * 100)}%`
    : '—';
  const xp = state.xpData?.totalXP || 0;

  safeText('#statCards', totalCards.toLocaleString());
  safeText('#statReviewed', reviewed.toLocaleString());
  safeText('#statAccuracy', accuracy);
  safeText('#statXp', xp.toLocaleString());

  // Streak
  const streak = state.analytics?.currentStreak || 0;
  safeText('#streakNum', streak);

  // Due today list
  renderDueToday(dueCards.slice(0, 5));

  // Disciplines (top 6)
  renderHomeDisciplines();

  // Heatmap
  renderHeatmap('#homeHeatmap', 12);

  // Recommendations
  renderHomeRecommendations();

  // Badges preview
  renderHomeBadges();

  // Update nav badges
  updateNavBadges(dueCards.length);
}

function safeText(sel, text) {
  const el = $(sel);
  if (el) el.textContent = text;
}

function updateNavBadges(dueCount) {
  const reviewBadge = $('#navReviewBadge');
  if (reviewBadge) {
    if (dueCount > 0) {
      reviewBadge.textContent = dueCount > 99 ? '99+' : dueCount;
      show(reviewBadge);
    } else {
      hide(reviewBadge);
    }
  }
  const notifDot = $('#notifDot');
  if (notifDot) {
    dueCount > 0 ? show(notifDot) : hide(notifDot);
  }
}

function renderDueToday(cards) {
  const container = $('#dueToday');
  if (!container) return;

  if (cards.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--sp-8) 0">
        <span class="empty-state__icon icon">celebration</span>
        <div class="empty-state__title">Tudo em dia!</div>
        <div class="empty-state__desc">Nenhuma revisão pendente para hoje.</div>
      </div>`;
    return;
  }

  container.innerHTML = cards.map(c => {
    const raw = c.question || c.pergunta || '—';
    const parsed = parseQuestionText(raw);
    const preview = parsed.alternatives.length >= 2 ? parsed.stem : raw;
    return `
    <div class="review-queue-item" data-card-id="${c.id || ''}">
      <div class="review-queue-item__status due"></div>
      <div class="review-queue-item__disc">${escHtml(c._disc || '—')}</div>
      <div class="review-queue-item__q">${escHtml(truncate(preview, 100))}</div>
    </div>`;
  }).join('');
}

function renderHomeDisciplines() {
  const container = $('#homeDiscGrid');
  if (!container) return;
  const discs = state.hierarchy || [];

  if (discs.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1;text-align:center;padding:var(--sp-6);color:var(--text-3)">Nenhuma disciplina ainda.</div>`;
    return;
  }

  container.innerHTML = discs.slice(0, 6).map((d, i) => renderDiscCard(d, i)).join('');
}

function renderDiscCard(disc, index) {
  const color = discColor(index);
  const totalCards = countCards(disc);
  const dueCount = countDueCards(disc);
  const progress = totalCards > 0 ? Math.round(((totalCards - dueCount) / totalCards) * 100) : 0;

  return `
    <div class="disc-card" data-disc-id="${disc.id || ''}" style="--disc-color: ${color}" tabindex="0" role="button">
      <div class="disc-card__top">
        <div>
          <div class="disc-card__name">${escHtml(disc.name || '—')}</div>
          <div class="disc-card__meta">${totalCards} cards</div>
        </div>
      </div>
      <div class="disc-card__progress">
        <div class="disc-card__progress-bar">
          <div class="disc-card__progress-fill" style="width:${progress}%"></div>
        </div>
        <span class="disc-card__progress-pct">${progress}%</span>
      </div>
      ${dueCount > 0 ? `<div class="disc-card__due">${dueCount} para revisar</div>` : ''}
    </div>`;
}

function countCards(disc) {
  let count = 0;
  for (const mod of (disc.modules || [])) {
    for (const topic of (mod.topics || [])) {
      count += (topic.cards || []).length;
    }
  }
  return count;
}

function countDueCards(disc) {
  const now = new Date();
  let count = 0;
  for (const mod of (disc.modules || [])) {
    for (const topic of (mod.topics || [])) {
      for (const card of (topic.cards || [])) {
        if (!card.sm2 || !card.sm2.lastRated || FSRSService.isDue(card.sm2)) count++;
      }
    }
  }
  return count;
}

/* ─── Heatmap ──────────────────────────────────────────────────────── */

function renderHeatmap(selector, weeks = 20) {
  const container = $(selector);
  if (!container) return;

  const activityData = state.analytics?.dailyActivity || {};
  const today = new Date();
  const days = weeks * 7;

  const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  // Only show Mon (1), Wed (3), Fri (5) labels to avoid crowding
  const SHOW_DAY = new Set([1, 3, 5]);
  const GRID_GAP_PX = 3;
  const MIN_CELL_PX = 12;
  const isLargeHeatmap = container.classList.contains('large');
  const MAX_CELL_PX = isLargeHeatmap ? 56 : 26;

  let maxActivity = 1;
  Object.values(activityData).forEach(v => { if (v > maxActivity) maxActivity = v; });

  // Build ordered array of day data (oldest → newest)
  const cells = [];
  let totalReviews = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const count = activityData[key] || 0;
    const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxActivity) * 4));
    totalReviews += count;
    cells.push({ key, count, level, date: new Date(d) });
  }

  // ── Day-of-week alignment padding ─────────────────────────────────
  const firstDow = cells[0].date.getDay(); // 0=Sun … 6=Sat
  const totalCols = Math.ceil((cells.length + firstDow) / 7);

  // ── Adaptive cell sizing: fill available panel width ─────────────
  // Accounts for left labels column + wrapper horizontal padding.
  const leftLabelsAndGapPx = 36; // 32px labels + 4px gap
  const wrapperHorizontalPaddingPx = 24; // var(--sp-3) * 2
  const availableGridWidth = Math.max(
    180,
    (container.clientWidth || 0) - leftLabelsAndGapPx - wrapperHorizontalPaddingPx
  );
  const estimatedCellPx = Math.floor((availableGridWidth - ((totalCols - 1) * GRID_GAP_PX)) / totalCols);
  const cellPx = Number.isFinite(estimatedCellPx)
    ? Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, estimatedCellPx))
    : 14;
  const CELL_PX = cellPx + GRID_GAP_PX;

  // ── Month labels ──────────────────────────────────────────────────
  const monthLabels = [];
  let lastMonth = -1;
  cells.forEach((cell, idx) => {
    const m = cell.date.getMonth();
    if (m !== lastMonth) {
      const colIdx = Math.floor((idx + firstDow) / 7);
      // Only label if there's enough room (at least 2 cols from end)
      if (colIdx <= totalCols - 2) monthLabels.push({ name: MONTH_NAMES[m], colIdx });
      lastMonth = m;
    }
  });

  // ── Month labels row ──────────────────────────────────────────────
  const monthsHtml = monthLabels.map(({ name, colIdx }) =>
    `<span class="heatmap-month" style="left:${colIdx * CELL_PX}px">${name}</span>`
  ).join('');

  // ── Day labels column ─────────────────────────────────────────────
  const dayLabelsHtml = DAY_LABELS.map((d, i) =>
    `<span class="heatmap-daylabel">${SHOW_DAY.has(i) ? d : ''}</span>`
  ).join('');

  // ── Cells (with leading empty pads for alignment) ─────────────────
  let cellsHtml = '';
  for (let p = 0; p < firstDow; p++) {
    cellsHtml += '<div class="heatmap__cell heatmap__cell--pad"></div>';
  }
  cellsHtml += cells.map(({ key, count, level }) => {
    const [y, mo, d] = key.split('-');
    const dateFormatted = `${parseInt(d)} ${MONTH_NAMES[parseInt(mo) - 1]} ${y}`;
    const label = count === 0
      ? `${dateFormatted}: nenhuma revisão`
      : `${dateFormatted}: ${count} revisão${count !== 1 ? 'ões' : ''}`;
    return `<div class="heatmap__cell" data-level="${level}" data-tooltip="${label}" title="${label}" tabindex="-1" role="gridcell" aria-label="${label}"></div>`;
  }).join('');

  // ── Summary line ──────────────────────────────────────────────────
  const activeDays = cells.filter(c => c.count > 0).length;
  const summaryHtml = `
    <div class="heatmap-summary">
      <span class="heatmap-summary-count">${totalReviews.toLocaleString('pt-BR')} revisões</span>
      <span class="heatmap-summary-sep">·</span>
      <span>${activeDays} dia${activeDays !== 1 ? 's' : ''} ativo${activeDays !== 1 ? 's' : ''}</span>
      <span class="heatmap-summary-sep">·</span>
      <span>últimas ${weeks} semanas</span>
    </div>`;

  // ── Legend ────────────────────────────────────────────────────────
  const legendHtml = `
    <div class="heatmap-legend">
      <span class="heatmap-legend-lbl">Menos</span>
      ${[0, 1, 2, 3, 4].map(l => `<div class="heatmap__cell heatmap__cell--lg" data-level="${l}"></div>`).join('')}
      <span class="heatmap-legend-lbl">Mais</span>
    </div>`;

  // ── Assemble ──────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="heatmap-wrapper">
      <div class="heatmap-top">
        <div class="heatmap-corner"></div>
        <div class="heatmap-months-row">${monthsHtml}</div>
      </div>
      <div class="heatmap-mid">
        <div class="heatmap-day-labels" style="grid-template-rows:repeat(7,${cellPx}px)">${dayLabelsHtml}</div>
        <div class="heatmap-scroll">
          <div class="heatmap-grid" role="grid" aria-label="Mapa de atividade de estudo" style="grid-template-columns:repeat(${totalCols},${cellPx}px);grid-template-rows:repeat(7,${cellPx}px)">
            ${cellsHtml}
          </div>
        </div>
      </div>
      <div class="heatmap-bot">
        <div class="heatmap-corner"></div>
        <div class="heatmap-bot-right">
          ${summaryHtml}
          ${legendHtml}
        </div>
      </div>
    </div>`;
}

/* ─── Recommendations ──────────────────────────────────────────────── */

async function renderHomeRecommendations() {
  const container = $('#homeInsights');
  if (!container) return;

  try {
    const recs = await RecommendationService.generateRecommendations();
    if (!recs || recs.length === 0) {
      container.innerHTML = '<div style="color:var(--text-3);font-size:var(--text-sm);padding:var(--sp-4) 0">Estude mais para receber recomendações personalizadas.</div>';
      return;
    }
    container.innerHTML = recs.slice(0, 3).map(r => `
      <div style="padding:var(--sp-3) 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:600;font-size:var(--text-sm)">${escHtml(r.title || r.type || '—')}</div>
        <div style="font-size:var(--text-xs);color:var(--text-3);margin-top:2px">${escHtml(r.description || r.reason || '—')}</div>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div style="color:var(--text-3);font-size:var(--text-sm)">Sem recomendações disponíveis.</div>';
  }
}

/* ─── Badges Preview ───────────────────────────────────────────────── */

async function renderHomeBadges() {
  const container = $('#homeBadges');
  if (!container) return;

  try {
    const badges = state.badges || [];
    if (badges.length === 0) {
      container.innerHTML = '<div style="color:var(--text-3);font-size:var(--text-sm);padding:var(--sp-4) 0">Nenhuma conquista desbloqueada ainda. Continue estudando!</div>';
      return;
    }
    container.innerHTML = `<div style="display:flex;gap:var(--sp-3);flex-wrap:wrap">${badges.slice(0, 6).map(b => `
        <div style="text-align:center;width:60px" title="${escHtml(b.description || b.name || '')}">
          <div style="font-size:28px">${b.icon || '🏆'}</div>
          <div style="font-size:10px;color:var(--text-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(b.name || '—')}</div>
        </div>
      `).join('')
      }</div>`;
  } catch {
    container.innerHTML = '';
  }
}

/* ─── LIBRARY VIEW ─────────────────────────────────────────────────── */

function renderLibrary() {
  const discs = state.hierarchy || [];

  // Filter by collection
  let filtered = filterByCollection(discs, state.library.collection);

  // Sort
  filtered = sortDisciplines(filtered, state.library.sort);

  // Update chip count
  const chipCount = $('#chipReviewCount');
  if (chipCount) {
    const dueCount = getDueCards().length;
    chipCount.textContent = dueCount;
  }

  if (filtered.length === 0) {
    show($('#libEmpty'));
    hide($('#libGridView'));
    hide($('#libListView'));
    return;
  }

  hide($('#libEmpty'));

  if (state.library.viewMode === 'grid') {
    show($('#libGridView'));
    hide($('#libListView'));
    renderLibraryGrid(filtered);
  } else {
    hide($('#libGridView'));
    show($('#libListView'));
    renderLibraryList(filtered);
  }
}

function filterByCollection(discs, collection) {
  const now = new Date();
  switch (collection) {
    case 'in-progress':
      return discs.filter(d => countCards(d) > 0 && countDueCards(d) > 0);
    case 'review-today':
      return discs.filter(d => countDueCards(d) > 0);
    case 'overdue':
      return discs.filter(d => {
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        for (const mod of (d.modules || [])) {
          for (const topic of (mod.topics || [])) {
            for (const card of (topic.cards || [])) {
              if (card.sm2 && card.sm2.nextReview && card.sm2.nextReview < new Date().toISOString().slice(0, 10)) return true;
            }
          }
        }
        return false;
      });
    case 'mastered':
      return discs.filter(d => countCards(d) > 0 && countDueCards(d) === 0);
    case 'untouched':
      return discs.filter(d => {
        const cards = [];
        for (const mod of (d.modules || [])) {
          for (const topic of (mod.topics || [])) { cards.push(...(topic.cards || [])); }
        }
        return cards.every(c => !c.sm2 || !c.sm2.lastRated);
      });
    default:
      return discs;
  }
}

function sortDisciplines(discs, sort) {
  const arr = [...discs];
  switch (sort) {
    case 'name':
      arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
    case 'progress':
      arr.sort((a, b) => {
        const pa = countCards(a) > 0 ? (countCards(a) - countDueCards(a)) / countCards(a) : 0;
        const pb = countCards(b) > 0 ? (countCards(b) - countDueCards(b)) / countCards(b) : 0;
        return pb - pa;
      });
      break;
    case 'due':
      arr.sort((a, b) => countDueCards(b) - countDueCards(a));
      break;
    case 'recent':
      arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      break;
  }
  return arr;
}

function renderLibraryGrid(discs) {
  const container = $('#libGridView');
  if (!container) return;
  container.innerHTML = discs.map((d, i) => renderDiscCard(d, i)).join('');

  // Click handlers
  $$('.disc-card[data-disc-id]', container).forEach(card => {
    on(card, 'click', () => showDisciplineDetail(card.dataset.discId));
  });
}

function renderLibraryList(discs) {
  const container = $('#libListView');
  if (!container) return;

  container.innerHTML = discs.map((d, i) => {
    const total = countCards(d);
    const due = countDueCards(d);
    const progress = total > 0 ? Math.round(((total - due) / total) * 100) : 0;
    return `
      <div class="lib-list-item" data-disc-id="${d.id || ''}" tabindex="0">
        <div class="lib-list-item__color" style="background:${discColor(i)}"></div>
        <div class="lib-list-item__name">
          ${escHtml(d.name || '—')}
          <div style="font-size:var(--text-xs);color:var(--text-3);font-weight:400">${total} cards ${due > 0 ? `· ${due} pendentes` : ''}</div>
        </div>
        <div class="lib-list-item__meta">
          <div class="disc-card__progress-bar" style="width:80px"><div class="disc-card__progress-fill" style="width:${progress}%"></div></div>
        </div>
        <div class="lib-list-item__progress">${progress}%</div>
      </div>`;
  }).join('');

  $$('.lib-list-item[data-disc-id]', container).forEach(item => {
    on(item, 'click', () => showDisciplineDetail(item.dataset.discId));
  });
}

function initLibraryControls() {
  // Create discipline (main + empty state CTA)
  const handleCreateDiscipline = async () => {
    const name = prompt('Nome da nova disciplina:');
    if (!name || !name.trim()) return;
    try {
      await ContentHierarchyService.createDiscipline({ name: name.trim() });
      state.hierarchy = await ContentHierarchyService.load(true);
      populateDisciplineSelects();
      renderLibrary();
      renderHome();
      toast('Disciplina criada com sucesso!', 'success');
    } catch (err) {
      toast('Erro ao criar disciplina.', 'error');
    }
  };
  on($('#addDiscBtn'), 'click', handleCreateDiscipline);
  on($('#addDiscBtnEmpty'), 'click', handleCreateDiscipline);

  // View toggle (grid/list)
  on($('#libGridToggle'), 'click', () => {
    $('#libGridToggle')?.classList.add('active');
    $('#libGridToggle')?.setAttribute('aria-pressed', 'true');
    $('#libListToggle')?.classList.remove('active');
    $('#libListToggle')?.setAttribute('aria-pressed', 'false');
    state.library.viewMode = 'grid';
    renderLibrary();
  });
  on($('#libListToggle'), 'click', () => {
    $('#libListToggle')?.classList.add('active');
    $('#libListToggle')?.setAttribute('aria-pressed', 'true');
    $('#libGridToggle')?.classList.remove('active');
    $('#libGridToggle')?.setAttribute('aria-pressed', 'false');
    state.library.viewMode = 'list';
    renderLibrary();
  });

  // Sort
  $$('#libSortMenu .sort-btn').forEach(btn => {
    on(btn, 'click', () => {
      $$('#libSortMenu .sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.library.sort = btn.dataset.sort;
      renderLibrary();
    });
  });

  // Collection chips
  $$('#libChips .chip').forEach(chip => {
    on(chip, 'click', () => {
      $$('#libChips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.library.collection = chip.dataset.collection;
      renderLibrary();
    });
  });
}

function showDisciplineDetail(discId) {
  const discs = state.hierarchy || [];
  const disc = discs.find(d => d.id === discId);
  if (!disc) return;

  const cards = [];
  for (const mod of (disc.modules || [])) {
    for (const topic of (mod.topics || [])) {
      for (const card of (topic.cards || [])) {
        cards.push({ ...card, _topic: topic.name });
      }
    }
  }

  const body = cards.length === 0
    ? '<div class="empty-state"><span class="empty-state__icon icon">description</span><div class="empty-state__title">Sem cards</div></div>'
    : `<div style="max-height:400px;overflow-y:auto">${cards.map(c => `
        <div style="padding:var(--sp-3) 0;border-bottom:1px solid var(--border)">
          <div style="font-size:var(--text-xs);color:var(--text-3);margin-bottom:2px">${escHtml(c._topic)}</div>
          <div style="font-size:var(--text-sm)">${escHtml(truncate(c.question || c.pergunta || '—', 120))}</div>
        </div>
      `).join('')}</div>`;

  const footer = `
    <button class="btn btn-primary btn-pill" onclick="document.querySelector('#modalOverlay').classList.remove('active');window.__startSessionForDisc?.('${discId}')">
      <span class="icon">play_arrow</span> Estudar esta disciplina
    </button>`;

  openModal(disc.name || 'Disciplina', body, footer);
}

/* ─── STUDY SESSION ────────────────────────────────────────────────── */

function initStudySession() {
  // Populate discipline selects
  populateDisciplineSelects();

  // Start session button
  on($('#startSessionBtn'), 'click', startStudySession);
  on($('#endSessionBtn'), 'click', endStudySession);
  on($('#summaryNewSession'), 'click', () => {
    hide($('#studySummary'));
    show($('#studySetup'));
  });
  on($('#summaryGoHome'), 'click', () => navigateTo('home'));

  // Hero CTA redirect
  window.__startSessionForDisc = (discId) => {
    const discSel = $('#sessionDisc');
    if (discSel) discSel.value = discId;
    navigateTo('study');
    setTimeout(startStudySession, 100);
  };

  // Card action buttons
  on($('#revealBtn'), 'click', () => revealAnswer());
  on($('#actExplain'), 'click', () => aiAction('explain'));
  on($('#actHint'), 'click', () => aiAction('hint'));
  on($('#actMnemonic'), 'click', () => aiAction('mnemonic'));
  on($('#actNote'), 'click', addNote);
  on($('#actTTS'), 'click', readAloud);
  on($('#actFlag'), 'click', flagCard);
  on($('#actChat'), 'click', () => aiAction('chat'));
}

function populateDisciplineSelects() {
  const discs = state.hierarchy || [];
  const discSelects = ['#sessionDisc', '#flashcardDisc']
    .map(s => $(s))
    .filter(Boolean);

  // Session/Flashcard selects: disciplinas only
  discSelects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">Todas</option>';
    discs.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id || d.name;
      opt.textContent = d.name;
      sel.appendChild(opt);
    });
    sel.value = current;
  });

  // Build unique topic/folder names from hierarchy
  const topicNames = new Set();
  discs.forEach((disc) => {
    (disc.modules || []).forEach((mod) => {
      (mod.topics || []).forEach((topic) => {
        const name = String(topic?.name || '').trim();
        if (name) topicNames.add(name);
      });
    });
  });

  // Practice selects: disciplina + pasta/tópico
  const practiceSelects = ['#quizDisc', '#simulateDisc', '#aiSimuladoDisc']
    .map(s => $(s))
    .filter(Boolean);

  practiceSelects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="all">Todas pastas/disciplinas</option>';

    // Discipline options
    discs.forEach((d) => {
      const opt = document.createElement('option');
      const raw = d.id || d.name;
      opt.value = `disc:${raw}`;
      opt.textContent = `Disciplina: ${d.name}`;
      sel.appendChild(opt);
    });

    // Folder/topic options
    [...topicNames]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .forEach((topicName) => {
        const opt = document.createElement('option');
        opt.value = `topic:${topicName}`;
        opt.textContent = `Pasta: ${topicName}`;
        sel.appendChild(opt);
      });

    // Keep prior selection if still available
    const exists = [...sel.options].some(o => o.value === current);
    sel.value = exists ? current : 'all';
  });
}

function startStudySession() {
  const source = $('#sessionSource')?.value || 'due';
  const discId = $('#sessionDisc')?.value || '';
  const count = parseInt($('#sessionCount')?.value || '20', 10);
  const practiceFilter = String(state.practiceFilter || 'all');

  let cards = [];
  switch (source) {
    case 'due': cards = getDueCards(); break;
    case 'new': cards = getNewCards(); break;
    case 'weak': cards = getAllCards().filter(c => c.sm2 && (c.sm2.fsrs_difficulty || 0) > 0.5); break;
    default: cards = getAllCards(); break;
  }

  // Filter by practice mode (Quiz/Simulado) if provided
  if (practiceFilter && practiceFilter !== 'all') {
    if (practiceFilter.startsWith('disc:')) {
      const value = practiceFilter.slice(5);
      cards = cards.filter(c => c._discId === value || c._disc === value);
    } else if (practiceFilter.startsWith('topic:')) {
      const value = practiceFilter.slice(6).toLowerCase();
      cards = cards.filter(c => String(c._topic || '').toLowerCase() === value);
    }
  } else if (discId) {
    // Legacy filter by discipline from session setup
    cards = cards.filter(c => c._discId === discId || c._disc === discId);
  }

  // One-shot filter for practice flow
  state.practiceFilter = 'all';

  // Shuffle and limit
  cards = shuffle(cards).slice(0, count);

  if (cards.length === 0) {
    toast('Nenhum card encontrado com esses filtros.', 'warning');
    return;
  }

  state.session = {
    active: true,
    cards,
    index: 0,
    results: [],
    revealed: false,
  };

  hide($('#studySetup'));
  hide($('#studySummary'));
  show($('#studyActive'));

  renderCurrentCard();
  try { AnalyticsService.startSession?.(); } catch (_) { }
}

/**
 * Parse a question string, separating the stem from inline alternatives.
 * Handles patterns like: "Enunciado: A) opt B) opt C) opt" or "Enunciado: a) opt b) opt"
 * @returns {{ stem: string, alternatives: Array<{letter: string, text: string}> }}
 */
function parseQuestionText(raw) {
  if (!raw) return { stem: raw || '', alternatives: [] };

  const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const stemParts = [];
  const alternatives = [];
  let currentAlt = null;

  // Patterns: "A) text", "A. text", "A: text", "A - text", "A text" (loose)
  const altStartRe = /^([A-E])\s*(?:[\)\.\:\-]|->>|->|=>)\s*(.+)$/i;
  // Bare letter on its own line: "A"
  const altSoloRe = /^([A-E])$/i;
  // Strip noise word "Alternativas" from stem
  const noiseRe = /^alternativas?\s*:?\s*$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip "Alternativas" label
    if (noiseRe.test(line)) continue;

    // Check "A) text" or "A. text" style
    const m = line.match(altStartRe);
    if (m) {
      const letter = m[1].toUpperCase();
      const expectedLetter = String.fromCharCode(65 + alternatives.length + (currentAlt ? 1 : 0));
      if (letter === expectedLetter || alternatives.length + (currentAlt ? 1 : 0) === 0) {
        if (currentAlt) alternatives.push(currentAlt);
        currentAlt = { letter, text: m[2].trim() };
        continue;
      }
    }

    // Check bare letter on own line
    const solo = line.match(altSoloRe);
    if (solo) {
      const letter = solo[1].toUpperCase();
      const expectedLetter = String.fromCharCode(65 + alternatives.length + (currentAlt ? 1 : 0));
      if (letter === expectedLetter) {
        if (currentAlt) alternatives.push(currentAlt);
        currentAlt = { letter, text: '' };
        continue;
      }
    }

    // Continuation of current alternative or stem
    if (currentAlt) {
      currentAlt.text = currentAlt.text ? `${currentAlt.text} ${line}` : line;
    } else {
      stemParts.push(line);
    }
  }
  if (currentAlt) alternatives.push(currentAlt);

  // Clean up alternative texts
  alternatives.forEach(a => { a.text = a.text.trim(); });

  if (alternatives.length >= 2) {
    return { stem: stemParts.join('\n').trim(), alternatives };
  }

  // Fallback: inline pattern "A) ... B) ... " on single/few lines
  const inlineRe = /(?:^|\s)([A-Ea-e])[).]\s*/g;
  const inlineMatches = [...raw.matchAll(inlineRe)];
  if (inlineMatches.length >= 2) {
    const stem = raw.slice(0, inlineMatches[0].index).trim();
    const alts = [];
    for (let i = 0; i < inlineMatches.length; i++) {
      const letter = inlineMatches[i][1].toUpperCase();
      const start = inlineMatches[i].index + inlineMatches[i][0].length;
      const end = i + 1 < inlineMatches.length ? inlineMatches[i + 1].index : raw.length;
      const text = raw.slice(start, end).trim();
      if (text) alts.push({ letter, text });
    }
    if (alts.length >= 2) return { stem: stem || raw.trim(), alternatives: alts };
  }

  return { stem: raw.trim(), alternatives: [] };
}

function renderCurrentCard() {
  const { cards, index } = state.session;
  const container = $('#currentCard');
  if (!container || index >= cards.length) return;

  state.session.revealed = false;
  // Always keep card actions bar visible
  show($('#cardActionsBar'));

  const card = cards[index];
  const progress = ((index) / cards.length) * 100;
  const fill = $('#sessionProgressFill');
  if (fill) fill.style.width = `${progress}%`;
  safeText('#sessionProgressCount', `${index + 1}/${cards.length}`);

  const question = card.question || card.pergunta || '—';
  const options = card.options || card.alternatives || [];
  const parsed = parseQuestionText(question);

  // Use parsed alternatives if no explicit options array exists
  const hasExplicitOptions = options.length > 0;
  const hasInlineAlts = parsed.alternatives.length >= 2;

  let html = `
    <div class="study-card${card._aiGenerated ? ' ai-card' : ''}">
      <div class="study-card__header">
        <span class="study-card__disc-tag">${escHtml(card._disc || '—')}</span>
        ${card._aiGenerated ? '<span class="study-card__ai-badge"><span class="material-symbols-rounded">auto_awesome</span>IA</span>' : ''}
        <span class="study-card__num">${card._topic ? escHtml(card._topic) : ''}</span>
      </div>`;

  if (hasInlineAlts && !hasExplicitOptions) {
    // Render separated stem + alternatives (preserve line breaks for long enunciados)
    html += `<div class="study-card__question">${escHtml(parsed.stem).replace(/\n/g, '<br>')}</div>`;
    html += `<div class="study-card__options study-card__options--parsed" id="optionsContainer">
      ${parsed.alternatives.map((alt, i) => {
      return `<div class="option-item option-item--parsed" data-idx="${i}" tabindex="0">
          <span class="option-item__letter">${escHtml(alt.letter)}</span>
          <span class="option-item__text">${escHtml(alt.text)}</span>
        </div>`;
    }).join('')}
    </div>`;
  } else {
    // Render original question as-is (preserve line breaks)
    html += `<div class="study-card__question">${escHtml(question).replace(/\n/g, '<br>')}</div>`;
  }

  if (hasExplicitOptions) {
    const letters = 'ABCDEFGHIJ';
    html += `<div class="study-card__options" id="optionsContainer">
      ${options.map((opt, i) => {
      const text = typeof opt === 'string' ? opt : (opt.text || opt.label || '');
      return `<div class="option-item" data-idx="${i}" tabindex="0"><span class="option-item__letter">${letters[i] || i + 1}</span><span>${escHtml(text)}</span></div>`;
    }).join('')}
    </div>`;
  }

  html += `<div class="card-reveal-prompt" id="revealPromptArea">
    <button class="btn btn-secondary" id="revealCardBtn">
      <span class="material-symbols-rounded">visibility</span>
      Revelar resposta <kbd>Espaço</kbd>
    </button>
  </div>`;

  html += `<div id="answerReveal" hidden>
      <div class="study-card__answer"></div>
      <div class="rating-bar" id="sessionRating">
        <button class="rate-btn again" data-rate="1"><span class="icon" style="font-size:18px">close</span> Errei</button>
        <button class="rate-btn hard" data-rate="2"><span class="icon" style="font-size:18px">trending_down</span> Difícil</button>
        <button class="rate-btn good" data-rate="3"><span class="icon" style="font-size:18px">check</span> Bom</button>
        <button class="rate-btn easy" data-rate="4"><span class="icon" style="font-size:18px">bolt</span> Fácil</button>
      </div>
    </div>
  </div>`;

  container.innerHTML = html;

  on($('#revealCardBtn', container), 'click', () => revealAnswer());

  // Option click
  $$('.option-item', container).forEach(opt => {
    on(opt, 'click', () => selectOption(parseInt(opt.dataset.idx, 10)));
  });

  // Rating buttons
  $$('.rate-btn', container).forEach(btn => {
    on(btn, 'click', () => rateCurrentCard(parseInt(btn.dataset.rate, 10)));
  });
}

function selectOption(idx) {
  const card = state.session.cards[state.session.index];
  if (!card || state.session.revealed) return;

  const options = card.options || card.alternatives || [];
  let correctIdx = card.correctIndex ?? card.correct ?? null;
  const parsed = parseQuestionText(card.question || card.pergunta || '');

  // For parsed inline alternatives (no explicit options array),
  // try to detect the correct answer from the answer field
  if (options.length === 0 && correctIdx === null) {
    const answer = (card.answer || card.resposta || '').trim().toUpperCase();
    if (parsed.alternatives.length >= 2) {
      const letterMatch = answer.match(/^(?:letra\s+)?([A-E])[).\s:,]/i) || answer.match(/^([A-E])$/i);
      if (letterMatch) {
        const correctLetter = letterMatch[1].toUpperCase();
        correctIdx = parsed.alternatives.findIndex(a => a.letter === correctLetter);
      }
    }
  }

  if (correctIdx === null) correctIdx = 0;

  const studyCard = document.querySelector('#currentCard .study-card');
  if (studyCard) studyCard.classList.add('revealed');

  $$('.option-item').forEach((opt, i) => {
    opt.classList.add('option-item--locked');
    if (i === correctIdx) opt.classList.add('correct');
    if (i === idx && i !== correctIdx) opt.classList.add('wrong-selected');
  });

  const wasCorrect = idx === correctIdx;
  revealAnswer(wasCorrect);

  // If wrong, show "Why Wrong" explanation panel
  if (!wasCorrect) {
    const alts = parsed.alternatives.length >= 2 ? parsed.alternatives : [];
    const explicitOpts = options.length > 0 ? options : [];
    const letters = 'ABCDEFGHIJ';

    let wrongLetter, wrongText, correctLetter, correctText, questionStem, allAlts;

    if (alts.length >= 2) {
      wrongLetter = alts[idx]?.letter || letters[idx];
      wrongText = alts[idx]?.text || '';
      correctLetter = alts[correctIdx]?.letter || letters[correctIdx];
      correctText = alts[correctIdx]?.text || '';
      questionStem = parsed.stem;
      allAlts = alts;
    } else if (explicitOpts.length > 0) {
      wrongLetter = letters[idx];
      wrongText = typeof explicitOpts[idx] === 'string' ? explicitOpts[idx] : (explicitOpts[idx]?.text || '');
      correctLetter = letters[correctIdx];
      correctText = typeof explicitOpts[correctIdx] === 'string' ? explicitOpts[correctIdx] : (explicitOpts[correctIdx]?.text || '');
      questionStem = card.question || card.pergunta || '';
      allAlts = explicitOpts.map((opt, i) => ({
        letter: letters[i],
        text: typeof opt === 'string' ? opt : (opt?.text || opt?.label || '')
      }));
    } else {
      return;
    }

    showWhyWrongPanel(questionStem, wrongLetter, wrongText, correctLetter, correctText, card._disc || '', allAlts, idx, correctIdx);
  }
}

/**
 * Shows an inline "Why Wrong" explanation panel below the answer.
 */
async function showWhyWrongPanel(question, wrongLetter, wrongText, correctLetter, correctText, subject, allAlts, chosenIdx, correctIdx) {
  const revealEl = $('#answerReveal');
  if (!revealEl) return;

  // Create the panel container
  let panel = $('#whyWrongPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'whyWrongPanel';
    panel.className = 'why-wrong-panel';
    const ratingBar = $('#sessionRating', revealEl);
    if (ratingBar) {
      revealEl.insertBefore(panel, ratingBar);
    } else {
      revealEl.appendChild(panel);
    }
  }

  // Build all alternatives visual list
  const altsHtml = (allAlts || []).map((a, i) => {
    const isCorrect = i === correctIdx;
    const isChosen = i === chosenIdx;
    let cls = 'why-wrong-panel__alt';
    if (isCorrect) cls += ' why-wrong-panel__alt--correct';
    else if (isChosen) cls += ' why-wrong-panel__alt--chosen';
    const statusIcon = isCorrect ? 'check_circle' : 'cancel';
    const statusCls = isCorrect ? 'why-wrong-panel__status--correct' : 'why-wrong-panel__status--wrong';
    const chosenTag = isChosen ? '<span class="why-wrong-panel__you-tag">Sua escolha</span>' : '';
    return `
      <div class="${cls}">
        <span class="material-symbols-rounded ${statusCls}" style="font-size:18px">${statusIcon}</span>
        <span class="why-wrong-panel__alt-letter">${escHtml(a.letter)}</span>
        <span class="why-wrong-panel__alt-text">${escHtml(a.text)}</span>
        ${chosenTag}
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="why-wrong-panel__header">
      <span class="material-symbols-rounded why-wrong-panel__icon">psychology</span>
      <span class="why-wrong-panel__title">Entenda cada alternativa</span>
    </div>
    <div class="why-wrong-panel__alts-list">
      ${altsHtml}
    </div>
    <div class="why-wrong-panel__body" id="whyWrongBody">
      <div class="why-wrong-panel__loading">
        <span class="material-symbols-rounded why-wrong-panel__spinner">autorenew</span>
        Analisando todas as alternativas...
      </div>
    </div>
  `;

  // Call AI for full explanation
  try {
    const explanation = await PedagogicalPromptsService.generateWhyWrong(
      question, wrongLetter, wrongText, correctLetter, correctText, subject, allAlts || []
    );
    const body = $('#whyWrongBody');
    if (body) {
      body.innerHTML = `<div class="why-wrong-panel__content">${formatMarkdown(explanation)}</div>`;
    }
  } catch (err) {
    const body = $('#whyWrongBody');
    if (body) {
      body.innerHTML = `<div class="why-wrong-panel__content">
        <p>🎯 Você escolheu <strong>${escHtml(wrongLetter)}</strong>, mas a resposta correta é <strong>${escHtml(correctLetter)}</strong>.</p>
        <p>Revise o conceito e tente novamente!</p>
      </div>`;
    }
  }
}

/**
 * Enhanced Markdown-like formatter for AI pedagogical output.
 * Creates a didactic layout with color-coded sections, keyword highlights,
 * expandable alternative analyses, and visual hierarchy for learning.
 */
function formatMarkdown(text) {
  if (!text) return '';

  let html = escHtml(text);

  // ── 1. Restore <details> and <summary> safely ──
  html = html
    .replace(/&lt;details&gt;/g, '%%DETAILS_OPEN%%')
    .replace(/&lt;\/details&gt;/g, '%%DETAILS_CLOSE%%')
    .replace(/&lt;summary&gt;([\s\S]*?)&lt;\/summary&gt;/g, '%%SUMMARY_START%%$1%%SUMMARY_END%%');

  // ── 2. Parse section headers with emoji identifiers ──
  // 🎯 "O que você estava pensando" → empathy card (blue)
  html = html.replace(/(🎯)\s*\*\*(.*?)\*\*[:]*/g,
    '%%SECTION_EMPATHY_START%%<span class="ww-sec__emoji">$1</span><span class="ww-sec__title">$2</span>%%SECTION_TITLE_END%%');

  // 🔑 "Regra para nunca mais errar" → key takeaway card (green)
  html = html.replace(/(🔑)\s*\*\*(.*?)\*\*[:]*/g,
    '%%SECTION_KEY_START%%<span class="ww-sec__emoji">$1</span><span class="ww-sec__title">$2</span>%%SECTION_TITLE_END%%');

  // 🧠 "Checkpoint de compreensão" → challenge card (purple)
  html = html.replace(/(🧠)\s*\*\*(.*?)\*\*[:]*/g,
    '%%SECTION_CHALLENGE_START%%<span class="ww-sec__emoji">$1</span><span class="ww-sec__title">$2</span>%%SECTION_TITLE_END%%');

  // 📋 generic section header
  html = html.replace(/(📋)\s*\*\*(.*?)\*\*[:]*/g,
    '%%SECTION_GENERIC_START%%<span class="ww-sec__emoji">$1</span><span class="ww-sec__title">$2</span>%%SECTION_TITLE_END%%');

  // ── 3. Highlight ✅ and ❌ markers with styled spans ──
  html = html.replace(/✅/g, '<span class="ww-mark ww-mark--correct">✅</span>');
  html = html.replace(/❌/g, '<span class="ww-mark ww-mark--wrong">❌</span>');

  // ── 4. Bold text → accent-colored strong ──
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="ww-keyword">$1</strong>');

  // ── 5. Backtick-wrapped text → highlighted code/concept pill ──
  html = html.replace(/`([^`]+)`/g, '<code class="ww-concept">$1</code>');

  // ── 6. Individual alternative analysis lines: "- A) ✅/❌ explanation" ──
  // Match lines dynamically, even if they are mashed together without newlines
  const altRegex = /(?:^|<br>|\s|[-*]\s*)\*?\*?([A-E])\)\*?\*?\s*(?:.*?)?(<span class="ww-mark ww-mark--(correct|wrong)">[^<]+<\/span>)\s*(.*?)(?=(?:<br>|\s|[-*]\s*)\*?\*?[A-E]\)|\n|$|%%DETAILS|📋|🔑|🧠)/g;
  html = html.replace(altRegex, (_, letter, mark, type, explanation) => {
    const isCorrect = type === 'correct';
    const cls = isCorrect ? 'ww-alt-card--correct' : 'ww-alt-card--wrong';
    const iconLabel = isCorrect ? '<span class="material-symbols-rounded">check_circle</span> Correta' : '<span class="material-symbols-rounded">cancel</span> Incorreta';
    
    // Clean up explanation of trailing markup
    let cleanExp = explanation.replace(/<\/?(div|span|p)[^>]*>/g, '').trim();
    // Remove "**Por que?**" or similar prefixes if AI generated them
    cleanExp = cleanExp.replace(/^\*\*(Por que\??|Motivo|Justificativa)\*\*\s*/i, '');
    
    return `</div><div class="ww-alt-card ${cls}">
      <div class="ww-alt-card__header">
        <span class="ww-alt-card__badge">${letter}</span>
        <span class="ww-alt-card__status">${iconLabel}</span>
      </div>
      <div class="ww-alt-card__explanation">${cleanExp}</div>
    </div><div class="ww-sec__body">`;
  });

  // ── 7. Split into blocks and wrap ──
  let blocks = html.split(/\n\n+/);
  let output = '';
  let inSection = false;
  let sectionType = '';

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Check for section starts
    const sectionMatch = trimmed.match(/%%SECTION_(EMPATHY|KEY|CHALLENGE|GENERIC)_START%%/);
    if (sectionMatch) {
      if (inSection) output += '</div></div>'; // close previous section
      sectionType = sectionMatch[1].toLowerCase();
      const sectionHtml = trimmed
        .replace(/%%SECTION_\w+_START%%/, `<div class="ww-sec ww-sec--${sectionType}"><div class="ww-sec__header">`)
        .replace(/%%SECTION_TITLE_END%%/, '</div><div class="ww-sec__body">')
        .replace(/\n/g, '<br>');
      output += sectionHtml;
      inSection = true;
      continue;
    }

    // Details/summary
    if (trimmed.includes('%%DETAILS_OPEN%%')) {
      if (inSection) output += '</div></div>';
      inSection = false;
      const processed = trimmed
        .replace(/%%DETAILS_OPEN%%/, '<details class="why-wrong-details">')
        .replace(/%%DETAILS_CLOSE%%/, '</details>')
        .replace(/%%SUMMARY_START%%/, '<summary class="why-wrong-summary"><span class="material-symbols-rounded view-more-icon">chevron_right</span><span class="summary-text">')
        .replace(/%%SUMMARY_END%%/, '</span></summary>')
        .replace(/\n/g, '<br>');
      output += processed;
      continue;
    }
    if (trimmed.includes('%%DETAILS_CLOSE%%')) {
      output += trimmed.replace(/%%DETAILS_CLOSE%%/, '</details>');
      continue;
    }

    // Regular content block
    const blockHtml = trimmed.replace(/\n/g, '<br>');
    if (inSection) {
      output += `<p>${blockHtml}</p>`;
    } else {
      output += `<p>${blockHtml}</p>`;
    }
  }

  if (inSection) output += '</div></div>'; // close last section

  // Clean up any remaining placeholders
  output = output
    .replace(/%%\w+%%/g, '')
    .replace(/<p>\s*<\/p>/g, '');

  return output;
}

function revealAnswer(wasCorrect = null) {
  const card = state.session.cards[state.session.index];
  if (!card) return;

  state.session.revealed = true;
  const answer = card.answer || card.resposta || card.explanation || '';

  const revealEl = $('#answerReveal');
  if (revealEl) {
    const answerDiv = $('.study-card__answer', revealEl);
    if (answerDiv) answerDiv.textContent = answer || 'Sem resposta registrada.';
    show(revealEl);
    hide($('#revealPromptArea'));
  }

  // show($('#cardActionsBar')); already visible

  // If was an option selection, auto-suggest a rating
  if (wasCorrect !== null) {
    // Highlight the suggested rating
    const suggested = wasCorrect ? 3 : 1;
    $$('.rate-btn', $('#currentCard')).forEach(btn => {
      btn.classList.toggle('suggested', parseInt(btn.dataset.rate) === suggested);
    });
  }
}

async function rateCurrentCard(rating) {
  const card = state.session.cards[state.session.index];
  if (!card) return;

  // Skip FSRS persistence for AI-generated cards (ephemeral)
  if (!card._aiGenerated) {
    // Apply FSRS calculation
    try {
      const result = FSRSService.calculate(card.sm2 || {}, rating);
      card.sm2 = result;

      // Clean temporary metadata from all cards before saving
      _cleanTempProps(state.hierarchy);
      // Save to hierarchy
      await ContentHierarchyService.save(state.hierarchy);
    } catch (err) {
      console.warn('[StudyHub] FSRS error:', err);
    }
  }

  // Record analytics
  try {
    AnalyticsService.recordReview?.({ cardId: card.id, disciplineId: card._discId, rating });
  } catch { }

  // Check badges
  try {
    await BadgeService.evaluate?.();
  } catch { }

  // Record result
  state.session.results.push({ cardId: card.id, rating });

  // Next card
  state.session.index++;
  if (state.session.index >= state.session.cards.length) {
    endStudySession();
  } else {
    renderCurrentCard();
  }
}

function endStudySession() {
  state.session.active = false;

  hide($('#studyActive'));
  hide($('#studySetup'));
  show($('#studySummary'));

  const results = state.session.results;
  const total = results.length;
  const correct = results.filter(r => r.rating >= 3).length;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const xp = total * 10 + correct * 5;

  // Add XP
  AnalyticsService.addDailyXP?.(xp).catch(() => { });
  AnalyticsService.endSession?.().catch(() => { });

  const stats = $('#summaryStats');
  if (stats) {
    stats.innerHTML = `
      <div class="stat-card">
        <div class="stat-card__icon copper"><span class="icon">style</span></div>
        <div><div class="stat-card__value">${total}</div><div class="stat-card__label">Cards revisados</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-card__icon green"><span class="icon">check_circle</span></div>
        <div><div class="stat-card__value">${correct}</div><div class="stat-card__label">Acertos</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-card__icon blue"><span class="icon">target</span></div>
        <div><div class="stat-card__value">${accuracy}%</div><div class="stat-card__label">Acurácia</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-card__icon gold"><span class="icon">local_fire_department</span></div>
        <div><div class="stat-card__value">+${xp}</div><div class="stat-card__label">XP ganho</div></div>
      </div>`;
  }

  toast(`Sessão concluída! +${xp} XP`, 'success');
}

/* ─── AI Actions ───────────────────────────────────────────────────── */

async function aiAction(type) {
  const card = state.session.cards[state.session.index];
  if (!card) return;

  const question = card.question || card.pergunta || '';
  const answer = card.answer || card.resposta || '';
  const titles = { explain: 'Explicação IA', hint: 'Dica Socrática', mnemonic: 'Mnemônico', chat: 'Chat de Dúvida' };

  openToolDock(titles[type] || 'IA', '<div style="padding:var(--sp-4);color:var(--text-3)">Gerando...</div>');

  try {
    let result = '';
    switch (type) {
      case 'explain':
        result = await PedagogicalPromptsService.generateConceptExplanation(question, answer);
        break;
      case 'hint':
        result = await PedagogicalPromptsService.generateSocraticHint(question);
        break;
      case 'mnemonic':
        result = await PedagogicalPromptsService.generateMnemonic(question, answer);
        break;
      case 'chat':
        result = `Sobre: "${truncate(question, 80)}"\n\nPergunta aberta - use o chat para discutir.`;
        break;
    }
    const dock = $('#toolDockBody');
    if (dock) {
      dock.innerHTML = `<div style="padding:var(--sp-4);white-space:pre-wrap;font-size:var(--text-sm);line-height:1.7">${escHtml(result || 'Sem resposta da IA.')}</div>`;
    }
  } catch (err) {
    const dock = $('#toolDockBody');
    if (dock) {
      dock.innerHTML = `<div style="padding:var(--sp-4);color:var(--danger)">Erro: ${escHtml(err.message || 'Falha na requisição.')}</div>`;
    }
  }
}

function addNote() {
  const card = state.session.cards[state.session.index];
  if (!card) return;

  openModal('Anotação', `
    <textarea id="noteText" style="width:100%;min-height:120px;resize:vertical;font-family:var(--font-body);font-size:var(--text-sm);padding:var(--sp-3);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);color:var(--text-1)" placeholder="Escreva sua anotação..."></textarea>
  `, `
    <button class="btn btn-primary btn-pill" id="saveNoteBtn">Salvar</button>
  `);

  setTimeout(() => {
    on($('#saveNoteBtn'), 'click', async () => {
      const text = $('#noteText')?.value?.trim();
      if (!text) return;
      try {
        await NotesService.create(card.id || card._discId, text);
        toast('Anotação salva!', 'success');
        closeModal();
      } catch (err) {
        toast('Erro ao salvar anotação.', 'error');
      }
    });
  }, 50);
}

async function readAloud() {
  const card = state.session.cards[state.session.index];
  if (!card) return;

  // Stop any current playback
  ElevenLabsTTSService.stop();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();

  const ttsBtn = $('#actTTS');

  // Build text: only question if answer not revealed, else both
  const question = card.question || card.pergunta || '';
  const answer = state.session.revealed ? (card.answer || card.resposta || '') : '';
  const text = answer ? `${question}. Resposta: ${answer}` : question;

  if (!text.trim()) return;

  // Try ElevenLabs first
  try {
    if (await ElevenLabsTTSService.isAvailable()) {
      if (ttsBtn) ttsBtn.classList.add('playing');
      toast('Reproduzindo áudio IA...', 'info', 2000);
      const ok = await ElevenLabsTTSService.speak(text);
      if (ok) {
        // Wait for playback to end to remove 'playing' class
        const checkEnd = setInterval(() => {
          if (!ElevenLabsTTSService.isPlaying()) {
            clearInterval(checkEnd);
            if (ttsBtn) ttsBtn.classList.remove('playing');
          }
        }, 500);
        return;
      }
    }
  } catch (err) {
    toast(err.message || 'Erro no ElevenLabs TTS.', 'error', 3000);
    if (ttsBtn) ttsBtn.classList.remove('playing');
  }

  // Fallback: Web Speech API
  if ('speechSynthesis' in window) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'pt-BR';
    utter.rate = 0.9;
    if (ttsBtn) ttsBtn.classList.add('playing');
    utter.onend = () => { if (ttsBtn) ttsBtn.classList.remove('playing'); };
    window.speechSynthesis.speak(utter);
    toast('Reproduzindo áudio...', 'info', 2000);
  } else {
    toast('Síntese de voz não disponível.', 'warning');
  }
}

function flagCard() {
  const card = state.session.cards[state.session.index];
  if (!card) return;
  card._flagged = !card._flagged;
  const btn = $('#actFlag');
  if (btn) {
    btn.classList.toggle('flagged', card._flagged);
  }
  toast(card._flagged ? 'Card marcado para revisão posterior.' : 'Marcação removida.', 'info', 2000);
}

/* ─── REVIEW VIEW ──────────────────────────────────────────────────── */

function renderReview() {
  const due = getDueCards();
  const overdue = getOverdueCards();
  const newCards = getNewCards();

  safeText('#reviewOverdue', overdue.length);
  safeText('#reviewDueToday', due.length);
  safeText('#reviewNew', newCards.length);

  on($('#startReviewSession'), 'click', () => {
    const sel = $('#sessionSource');
    if (sel) sel.value = 'due';
    navigateTo('study');
    setTimeout(startStudySession, 100);
  });
}

/* ─── FLASHCARD VIEW ───────────────────────────────────────────────── */

function initFlashcards() {
  const el = $('#flashcardEl');
  on(el, 'click', flipFlashcard);
  on(el, 'keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipFlashcard(); } });
  on($('#flashcardPrev'), 'click', () => navFlashcard(-1));
  on($('#flashcardNext'), 'click', () => navFlashcard(1));
  on($('#shuffleFlashcards'), 'click', shuffleAndResetFlashcards);

  // Start flashcard mode
  on($('#startFlashcardBtn'), 'click', () => {
    const discId = $('#flashcardDisc')?.value || '';
    loadFlashcards(discId);
    hide($('.practice-modes'));
    show($('#flashcardArena'));
  });

  // Exit flashcard mode
  on($('#exitFlashcardBtn'), 'click', () => {
    hide($('#flashcardArena'));
    show($('.practice-modes'));
  });

  on($('#flashcardDisc'), 'change', () => {
    loadFlashcards($('#flashcardDisc')?.value);
  });

  // Rating
  $$('#flashcardRating .rate-btn').forEach(btn => {
    on(btn, 'click', async () => {
      const rating = parseInt(btn.dataset.rate, 10);
      const card = state.flashcards.cards[state.flashcards.index];
      if (card) {
        try {
          card.sm2 = FSRSService.calculate(card.sm2 || {}, rating);
          await ContentHierarchyService.save?.(state.hierarchy);
          await AnalyticsService.recordReview?.(card._discId, rating);
        } catch { }
      }
      hide($('#flashcardRating'));
      navFlashcard(1);
    });
  });
}

function loadFlashcards(discId = '') {
  let cards = getAllCards();
  if (discId) {
    cards = cards.filter(c => c._discId === discId || c._disc === discId);
  }
  state.flashcards.cards = shuffle(cards);
  state.flashcards.index = 0;
  state.flashcards.flipped = false;
  renderFlashcard();
}

function flipFlashcard() {
  const el = $('#flashcardEl');
  if (!el) return;
  state.flashcards.flipped = !state.flashcards.flipped;
  el.classList.toggle('flipped', state.flashcards.flipped);

  // Show rating if flipped to back
  if (state.flashcards.flipped) {
    show($('#flashcardRating'));
  } else {
    hide($('#flashcardRating'));
  }
}

function navFlashcard(dir) {
  const total = state.flashcards.cards.length;
  if (total === 0) return;
  state.flashcards.index = (state.flashcards.index + dir + total) % total;
  state.flashcards.flipped = false;
  hide($('#flashcardRating'));
  renderFlashcard();
}

function shuffleAndResetFlashcards() {
  state.flashcards.cards = shuffle(state.flashcards.cards);
  state.flashcards.index = 0;
  state.flashcards.flipped = false;
  hide($('#flashcardRating'));
  renderFlashcard();
  toast('Flashcards embaralhados!', 'info', 2000);
}

function renderFlashcard() {
  const { cards, index, flipped } = state.flashcards;
  const el = $('#flashcardEl');
  if (el) el.classList.toggle('flipped', flipped);

  const front = $('#flashcardFront');
  const back = $('#flashcardBack');
  const counter = $('#flashcardCounter');

  if (cards.length === 0) {
    if (front) front.textContent = 'Nenhum flashcard disponível.';
    if (back) back.textContent = '—';
    if (counter) counter.textContent = '0/0';
    return;
  }

  const card = cards[index];
  if (front) front.textContent = card.question || card.pergunta || '—';
  if (back) back.textContent = card.answer || card.resposta || '—';
  if (counter) counter.textContent = `${index + 1}/${cards.length}`;
}

/* ─── PLANNING VIEW ────────────────────────────────────────────────── */

async function renderPlanning() {
  // Study Plan
  try {
    const plan = await StudyPlanService.getTodayPlan();
    const container = $('#planContent');
    if (container && plan && plan.items && plan.items.length > 0) {
      container.innerHTML = plan.items.map(item => `
        <div style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) 0;border-bottom:1px solid var(--border)">
          <input type="checkbox" ${item.completed ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          <div style="flex:1">
            <div style="font-size:var(--text-sm);font-weight:500">${escHtml(item.title || item.description || '—')}</div>
            ${item.discipline ? `<div style="font-size:var(--text-xs);color:var(--text-3)">${escHtml(item.discipline)}</div>` : ''}
          </div>
          <div style="font-size:var(--text-xs);color:var(--text-3)">${item.duration || ''}</div>
        </div>
      `).join('');
    }
  } catch { }

  // Learning Paths
  try {
    const paths = await LearningPathService.getAll();
    const container = $('#pathsContent');
    if (container && paths && paths.length > 0) {
      container.innerHTML = paths.map(p => `
        <div style="padding:var(--sp-3) 0;border-bottom:1px solid var(--border)">
          <div class="fw-600" style="font-size:var(--text-sm)">${escHtml(p.name || '—')}</div>
          <div style="font-size:var(--text-xs);color:var(--text-3);margin-top:2px">${p.steps?.length || 0} etapas</div>
        </div>
      `).join('');
    }
  } catch { }

  // Generate Plan button
  on($('#generatePlanBtn'), 'click', async () => {
    toast('Gerando plano de estudo...', 'info');
    try {
      await StudyPlanService.generateDailyPlan();
      toast('Plano gerado!', 'success');
      renderPlanning();
    } catch (err) {
      toast('Erro ao gerar plano: ' + (err.message || ''), 'error');
    }
  });

  // Create Path button
  on($('#createPathBtn'), 'click', () => {
    openModal('Nova Trilha de Aprendizado', `
      <label style="display:block;margin-bottom:var(--sp-4)">
        <span class="fw-600" style="display:block;margin-bottom:var(--sp-2);font-size:var(--text-sm)">Nome da trilha</span>
        <input type="text" id="pathName" class="topbar__search-input" style="border-radius:var(--radius-md);padding-left:var(--sp-4)" placeholder="Ex: Cálculo I">
      </label>
    `, `<button class="btn btn-primary btn-pill" id="savePathBtn">Criar</button>`);

    setTimeout(() => {
      on($('#savePathBtn'), 'click', async () => {
        const name = $('#pathName')?.value?.trim();
        if (!name) return;
        try {
          await LearningPathService.create({ name, steps: [] });
          toast('Trilha criada!', 'success');
          closeModal();
          renderPlanning();
        } catch (err) {
          toast('Erro ao criar trilha.', 'error');
        }
      });
    }, 50);
  });
}

/* ─── INSIGHTS VIEW ────────────────────────────────────────────────── */

async function renderInsights() {
  // Reload analytics
  try {
    state.analytics = await AnalyticsService.getOverview();
  } catch { }

  // XP / Level
  const xp = state.xpData?.totalXP || 0;
  const level = Math.floor(xp / 100) + 1;
  const xpInLevel = xp % 100;
  safeText('#insightLevel', level);
  safeText('#insightXpCurrent', `${xpInLevel} XP`);
  safeText('#insightXpNext', `${100} XP`);
  const xpBar = $('#insightXpBar');
  if (xpBar) xpBar.style.width = `${xpInLevel}%`;

  // Stats row
  const statsEl = $('#insightStats');
  if (statsEl && state.analytics) {
    const a = state.analytics;
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-card__icon copper"><span class="icon">style</span></div><div><div class="stat-card__value">${a.totalCards || 0}</div><div class="stat-card__label">Cards totais</div></div></div>
      <div class="stat-card"><div class="stat-card__icon green"><span class="icon">check_circle</span></div><div><div class="stat-card__value">${a.totalReviews || 0}</div><div class="stat-card__label">Revisões totais</div></div></div>
      <div class="stat-card"><div class="stat-card__icon blue"><span class="icon">calendar_today</span></div><div><div class="stat-card__value">${a.daysActive || 0}</div><div class="stat-card__label">Dias ativos</div></div></div>
      <div class="stat-card"><div class="stat-card__icon gold"><span class="icon">local_fire_department</span></div><div><div class="stat-card__value">${a.currentStreak || 0}</div><div class="stat-card__label">Sequência atual</div></div></div>
    `;
  }

  // Heatmap (full)
  renderHeatmap('#insightHeatmap', 24);

  // Discipline breakdown
  renderDiscBreakdown();

  // Badges
  renderInsightBadges();
}

function renderDiscBreakdown() {
  const container = $('#insightDiscBreakdown');
  if (!container) return;
  const discs = state.hierarchy || [];

  if (discs.length === 0) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:var(--text-sm)">Nenhuma disciplina.</div>';
    return;
  }

  container.innerHTML = discs.map((d, i) => {
    const total = countCards(d);
    const due = countDueCards(d);
    const progress = total > 0 ? Math.round(((total - due) / total) * 100) : 0;
    return `
      <div class="insights-disc-row">
        <div class="insights-disc-dot" style="background:${discColor(i)}"></div>
        <div class="insights-disc-main">
          <div class="insights-disc-name" title="${escHtml(d.name || '—')}">${escHtml(d.name || '—')}</div>
          <div class="insights-disc-meta">${total} cards · ${due} pendentes</div>
        </div>
        <div class="insights-disc-bar-wrap">
          <div class="disc-card__progress-bar"><div class="disc-card__progress-fill" style="width:${progress}%"></div></div>
        </div>
        <div class="insights-disc-pct">${progress}%</div>
      </div>`;
  }).join('');
}

async function renderInsightBadges() {
  const container = $('#insightBadges');
  if (!container) return;

  try {
    const all = await BadgeService.getAllBadges();
    const unlocked = new Set((state.badges || []).map(b => b.id || b.name));

    if (!all || all.length === 0) {
      container.innerHTML = '<div style="color:var(--text-3);font-size:var(--text-sm)">Nenhuma conquista disponível.</div>';
      return;
    }

    const totalCount = all.length;
    const unlockedCount = all.filter(b => unlocked.has(b.id || b.name)).length;
    const lockedCount = totalCount - unlockedCount;
    const currentFilter = state.insights?.badgesFilter || 'all';

    const visibleBadges = all.filter(b => {
      const isUnlocked = unlocked.has(b.id || b.name);
      if (currentFilter === 'unlocked') return isUnlocked;
      if (currentFilter === 'locked') return !isUnlocked;
      return true;
    });

    container.innerHTML = `
      <div class="insights-badges-toolbar chip-group" role="tablist" aria-label="Filtro de conquistas">
        <button class="chip${currentFilter === 'all' ? ' active' : ''}" data-badge-filter="all" role="tab" aria-selected="${currentFilter === 'all'}">
          Todas <span class="chip-badge">${totalCount}</span>
        </button>
        <button class="chip${currentFilter === 'unlocked' ? ' active' : ''}" data-badge-filter="unlocked" role="tab" aria-selected="${currentFilter === 'unlocked'}">
          Desbloqueadas <span class="chip-badge">${unlockedCount}</span>
        </button>
        <button class="chip${currentFilter === 'locked' ? ' active' : ''}" data-badge-filter="locked" role="tab" aria-selected="${currentFilter === 'locked'}">
          Bloqueadas <span class="chip-badge">${lockedCount}</span>
        </button>
      </div>
      <div class="insights-badges-grid">${visibleBadges.map(b => {
      const isUnlocked = unlocked.has(b.id || b.name);
      return `
            <div class="insights-badge-item${isUnlocked ? ' is-unlocked' : ' is-locked'}" title="${escHtml(b.description || b.name || '')}">
              <div class="insights-badge-icon">${b.icon || '<span class="material-symbols-rounded">emoji_events</span>'}</div>
              <div class="insights-badge-name">${escHtml(b.name || '—')}</div>
            </div>`;
    }).join('')
      }</div>`;

    $$('[data-badge-filter]', container).forEach((btn) => {
      on(btn, 'click', () => {
        const nextFilter = btn.getAttribute('data-badge-filter') || 'all';
        state.insights.badgesFilter = nextFilter;
        renderInsightBadges();
      });
    });
  } catch {
    container.innerHTML = '';
  }
}

/* ─── EXPORT / IMPORT ──────────────────────────────────────────────── */

function initExport() {
  const ensureImportInput = () => {
    let input = $('#importFile');
    if (input) return input;
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'importFile';
    input.accept = '.json';
    input.hidden = true;
    document.body.appendChild(input);
    return input;
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = await ExportService.importFullJSON(text);
      if (!result?.success) throw new Error(result?.message || 'Falha na importação');
      toast('Backup importado! Recarregando...', 'success');
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      toast('Erro ao importar: ' + (err.message || err), 'error');
    }
  };

  const triggerImportPicker = () => ensureImportInput().click();

  const confirmAndResetData = () => {
    openModal('Resetar todos os dados', `
      <p style="color:var(--danger);font-weight:600;margin-bottom:var(--sp-3)">Esta ação é irreversível!</p>
      <p style="font-size:var(--text-sm);color:var(--text-2)">Todos os seus cards, notas, estatísticas e configurações serão apagados permanentemente.</p>
    `, `
      <button class="btn btn-danger btn-pill" id="confirmReset">Sim, resetar tudo</button>
      <button class="btn btn-secondary btn-pill" style="margin-left:var(--sp-2)" onclick="document.querySelector('#modalOverlay').classList.remove('active')">Cancelar</button>
    `);
    setTimeout(() => {
      on($('#confirmReset'), 'click', async () => {
        try {
          await chrome.storage.local.clear();
          toast('Dados resetados. Recarregando...', 'success');
          setTimeout(() => location.reload(), 1000);
        } catch (e) {
          toast('Erro ao resetar: ' + e.message, 'error');
        }
        closeModal();
      });
    }, 50);
  };

  const importInput = ensureImportInput();
  on(importInput, 'change', async e => {
    const file = e.target.files?.[0];
    await handleImportFile(file);
    e.target.value = '';
  });

  on($('#exportJson'), 'click', async () => {
    try { await ExportService.exportFullJSON(); toast('Backup JSON exportado!', 'success'); }
    catch (e) { toast('Erro ao exportar: ' + e.message, 'error'); }
  });
  on($('#exportDataBtn'), 'click', async () => {
    try { await ExportService.downloadBackup(); toast('Backup exportado!', 'success'); }
    catch (e) { toast('Erro ao exportar: ' + e.message, 'error'); }
  });
  on($('#exportCsv'), 'click', async () => {
    try { ExportService.downloadCSV(getAllCardsHierarchySafe()); toast('CSV exportado!', 'success'); }
    catch (e) { toast('Erro ao exportar: ' + e.message, 'error'); }
  });
  on($('#exportAnki'), 'click', async () => {
    try { ExportService.downloadAnki(getAllCardsHierarchySafe()); toast('Anki TSV exportado!', 'success'); }
    catch (e) { toast('Erro ao exportar: ' + e.message, 'error'); }
  });
  on($('#importBtn'), 'click', triggerImportPicker);

  // Settings export/import/reset
  on($('#settingsExport'), 'click', async () => {
    try { await ExportService.downloadBackup(); toast('Backup exportado!', 'success'); }
    catch (e) { toast('Erro ao exportar: ' + e.message, 'error'); }
  });
  on($('#settingsImport'), 'click', triggerImportPicker);
  on($('#settingsReset'), 'click', confirmAndResetData);

  // Expose for settings modal dynamic buttons
  window.__studyHubTriggerImport = triggerImportPicker;
  window.__studyHubResetAllData = confirmAndResetData;
}

function getAllCardsHierarchySafe() {
  return Array.isArray(state.hierarchy) ? state.hierarchy : [];
}

/* ─── SETTINGS ─────────────────────────────────────────────────────── */

function initSettings() {
  // Settings button opens settings modal
  on($('#settingsBtn'), 'click', openSettingsModal);

  // Theme selector
  $$('#themeSelector .segmented__item').forEach(btn => {
    on(btn, 'click', () => {
      $$('#themeSelector .segmented__item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setTheme(btn.dataset.themeopt);
    });
  });

  // Language selector
  $$('#langSelector .segmented__item').forEach(btn => {
    on(btn, 'click', () => {
      $$('#langSelector .segmented__item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chrome.storage.sync.set({ ah_language: btn.dataset.lang }).catch(() => { });
      toast(`Idioma alterado para ${btn.textContent}. Recarregue para aplicar.`, 'info');
    });
  });

  // Theme toggle (topbar)
  on($('#btnTheme'), 'click', () => {
    setTheme(state.theme === 'dark' ? 'light' : 'dark');
  });
}

async function openSettingsModal() {
  const cfg = await ElevenLabsTTSService.getConfig();
  const masked = cfg.apiKey ? cfg.apiKey.slice(0, 6) + '••••••••' + cfg.apiKey.slice(-4) : '';

  openModal('Configurações', `
    <div style="display:flex;flex-direction:column;gap:var(--sp-5)">
      <!-- TTS Section -->
      <div>
        <h3 style="font-size:var(--text-base);font-weight:700;margin-bottom:var(--sp-3);display:flex;align-items:center;gap:var(--sp-2)">
          <span class="material-symbols-rounded" style="font-size:20px">record_voice_over</span>
          Voz IA (ElevenLabs)
        </h3>
        <p style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--sp-3)">
          Vozes ultra-realistas por IA. Plano grátis: ~10.000 caracteres/mês.
          <a href="https://elevenlabs.io" target="_blank" rel="noopener" style="color:var(--color-accent)">Criar conta gratuita →</a>
        </p>

        <label style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3);cursor:pointer">
          <input type="checkbox" id="ttsEnabled" ${cfg.enabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--color-accent)">
          <span style="font-size:var(--text-sm);font-weight:500">Ativar voz IA</span>
        </label>

        <label style="display:block;margin-bottom:var(--sp-3)">
          <span style="display:block;font-size:var(--text-xs);font-weight:600;margin-bottom:var(--sp-1);color:var(--color-text-secondary)">API Key</span>
          <input type="password" id="ttsApiKey" value="${cfg.apiKey || ''}"
            placeholder="${masked || 'Cole sua API key aqui...'}"
            autocomplete="off"
            style="width:100%;padding:var(--sp-2) var(--sp-3);border:1.5px solid var(--color-border);border-radius:var(--radius-md);font-size:var(--text-sm);background:var(--color-surface);color:var(--color-text-primary)">
        </label>

        <div id="ttsUsageInfo" style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--sp-2)"></div>

        <button class="btn btn-secondary btn-pill" id="ttsTestBtn" style="font-size:var(--text-xs);padding:var(--sp-1) var(--sp-3)">
          <span class="material-symbols-rounded" style="font-size:16px">play_arrow</span> Testar voz
        </button>
      </div>

      <hr style="border:none;border-top:1px solid var(--color-border)">

      <!-- Data Section -->
      <div>
        <h3 style="font-size:var(--text-base);font-weight:700;margin-bottom:var(--sp-3);display:flex;align-items:center;gap:var(--sp-2)">
          <span class="material-symbols-rounded" style="font-size:20px">database</span>
          Dados
        </h3>
        <div style="display:flex;gap:var(--sp-2);flex-wrap:wrap">
          <button class="btn btn-secondary btn-pill" id="settingsExportBtn" style="font-size:var(--text-xs)">
            <span class="material-symbols-rounded" style="font-size:16px">download</span> Exportar backup
          </button>
          <button class="btn btn-secondary btn-pill" id="settingsImportBtn" style="font-size:var(--text-xs)">
            <span class="material-symbols-rounded" style="font-size:16px">upload</span> Importar backup
          </button>
          <button class="btn btn-danger btn-pill" id="settingsResetBtn" style="font-size:var(--text-xs)">
            <span class="material-symbols-rounded" style="font-size:16px">delete_forever</span> Resetar dados
          </button>
        </div>
      </div>
    </div>
  `, `
    <button class="btn btn-primary btn-pill" id="saveSettingsBtn">
      <span class="material-symbols-rounded" style="font-size:18px">save</span> Salvar
    </button>
  `);

  // Wire up modal buttons after DOM renders
  setTimeout(async () => {
    // Save settings
    on($('#saveSettingsBtn'), 'click', async () => {
      const apiKey = $('#ttsApiKey')?.value?.trim() || '';
      const enabled = $('#ttsEnabled')?.checked || false;
      await ElevenLabsTTSService.saveConfig({ apiKey, enabled });
      toast(enabled && apiKey ? 'Voz IA ativada!' : 'Configurações salvas.', 'success');
      closeModal();
    });

    // Test voice
    on($('#ttsTestBtn'), 'click', async () => {
      const apiKey = $('#ttsApiKey')?.value?.trim() || '';
      if (!apiKey) {
        toast('Cole uma API key primeiro.', 'warning');
        return;
      }
      // Temporarily save and test
      await ElevenLabsTTSService.saveConfig({ apiKey, enabled: true });
      try {
        const ok = await ElevenLabsTTSService.speak('Olá! Eu sou a voz do AnswerHunter. Como estou soando?');
        if (ok) toast('Teste de voz em andamento!', 'success');
        else toast('Não foi possível reproduzir. Verifique a API key.', 'error');
      } catch (err) {
        toast(err.message || 'Erro ao testar voz.', 'error');
      }
    });

    // Show usage info
    const apiKey = $('#ttsApiKey')?.value?.trim() || '';
    if (apiKey) {
      await ElevenLabsTTSService.saveConfig({ apiKey });
      const usage = await ElevenLabsTTSService.getUsage();
      const infoEl = $('#ttsUsageInfo');
      if (usage && infoEl) {
        const pct = usage.limit > 0 ? Math.round((usage.used / usage.limit) * 100) : 0;
        infoEl.innerHTML = `<span style="color:var(--color-accent);font-weight:600">${usage.remaining.toLocaleString()}</span> caracteres restantes de ${usage.limit.toLocaleString()} (${pct}% usado)`;
      }
    }

    // Data buttons → proxy to existing handlers
    on($('#settingsExportBtn'), 'click', async () => {
      try {
        await ExportService.downloadBackup();
        toast('Backup exportado!', 'success');
      } catch (err) {
        toast('Erro ao exportar: ' + (err.message || err), 'error');
      }
      closeModal();
    });
    on($('#settingsImportBtn'), 'click', () => { closeModal(); window.__studyHubTriggerImport?.(); });
    on($('#settingsResetBtn'), 'click', () => {
      closeModal();
      window.__studyHubResetAllData?.();
    });
  }, 50);
}

/* ─── Practice ─────────────────────────────────────────────────────── */

function initPractice() {
  on($('#practiceQuiz'), 'click', () => {
    const selectedFilter = $('#quizDisc')?.value || 'all';
    state.practiceFilter = selectedFilter;

    // Sync visual selector in study setup when discipline filter is chosen
    const sessionDisc = $('#sessionDisc');
    if (sessionDisc) {
      if (selectedFilter.startsWith('disc:')) {
        sessionDisc.value = selectedFilter.slice(5);
      } else {
        sessionDisc.value = '';
      }
    }

    const sel = $('#sessionSource');
    if (sel) sel.value = 'all';
    navigateTo('study');
    // Could generate quiz with AI — placeholder for now
    toast('Quiz iniciado com o filtro selecionado (disciplina/pasta).', 'info');
    setTimeout(startStudySession, 100);
  });

  on($('#practiceSimulado'), 'click', () => {
    const selectedFilter = $('#simulateDisc')?.value || 'all';
    openModal('Configurar Simulado', `
      <label style="display:block;margin-bottom:var(--sp-4)">
        <span class="fw-600" style="display:block;margin-bottom:var(--sp-2);font-size:var(--text-sm)">Número de questões</span>
        <input type="number" id="simuladoCount" value="30" min="10" max="200" class="topbar__search-input" style="border-radius:var(--radius-md);padding-left:var(--sp-4);width:120px">
      </label>
      <label style="display:block;margin-bottom:var(--sp-4)">
        <span class="fw-600" style="display:block;margin-bottom:var(--sp-2);font-size:var(--text-sm)">Tempo (minutos)</span>
        <input type="number" id="simuladoTime" value="60" min="10" max="300" class="topbar__search-input" style="border-radius:var(--radius-md);padding-left:var(--sp-4);width:120px">
      </label>
    `, `<button class="btn btn-primary btn-pill" id="startSimuladoBtn"><span class="icon">play_arrow</span> Iniciar</button>`);

    setTimeout(() => {
      on($('#startSimuladoBtn'), 'click', () => {
        const count = parseInt($('#simuladoCount')?.value || '30', 10);
        state.practiceFilter = selectedFilter;

        const sessionCountEl = $('#sessionCount');
        if (sessionCountEl) sessionCountEl.value = count;
        const sel = $('#sessionSource');
        if (sel) sel.value = 'all';

        const sessionDisc = $('#sessionDisc');
        if (sessionDisc) {
          if (selectedFilter.startsWith('disc:')) {
            sessionDisc.value = selectedFilter.slice(5);
          } else {
            sessionDisc.value = '';
          }
        }

        closeModal();
        navigateTo('study');
        setTimeout(startStudySession, 100);
      });
    }, 50);
  });

  on($('#practiceChallenge'), 'click', () => {
    const sel = $('#sessionSource');
    if (sel) sel.value = 'all';
    const countEl = $('#sessionCount');
    if (countEl) countEl.value = '10';
    navigateTo('study');
    toast('Desafio aleatório: 10 cards de disciplinas variadas!', 'info');
    setTimeout(startStudySession, 100);
  });

  // ── AI Simulado ──
  on($('#practiceAISimulado'), 'click', () => {
    const selectedFilter = $('#aiSimuladoDisc')?.value || 'all';
    openModal('Simulado IA — Questões Geradas por IA', `
      <p style="font-size:var(--text-sm);color:var(--text-muted);margin-bottom:var(--sp-4);line-height:1.5">
        A IA analisará suas questões salvas e gerará questões <strong>inéditas</strong> sobre os mesmos temas para você praticar.
      </p>
      <label style="display:block;margin-bottom:var(--sp-4)">
        <span class="fw-600" style="display:block;margin-bottom:var(--sp-2);font-size:var(--text-sm)">Número de questões</span>
        <input type="number" id="aiSimCount" value="10" min="3" max="30" class="topbar__search-input" style="border-radius:var(--radius-md);padding-left:var(--sp-4);width:120px">
      </label>
      <label style="display:block;margin-bottom:var(--sp-4)">
        <span class="fw-600" style="display:block;margin-bottom:var(--sp-2);font-size:var(--text-sm)">Dificuldade</span>
        <select id="aiSimDifficulty" class="topbar__search-input" style="border-radius:var(--radius-md);padding-left:var(--sp-4);width:200px">
          <option value="1">Fácil — Conceitos diretos</option>
          <option value="2" selected>Médio — Nível de prova</option>
          <option value="3">Difícil — Nível concurso</option>
        </select>
      </label>
    `, `<button class="btn btn-primary btn-pill" id="startAISimBtn"><span class="material-symbols-rounded" style="font-size:18px">auto_awesome</span> Gerar Simulado</button>`);

    setTimeout(() => {
      on($('#startAISimBtn'), 'click', async () => {
        const count = Math.min(30, Math.max(3, parseInt($('#aiSimCount')?.value || '10', 10)));
        const difficulty = parseInt($('#aiSimDifficulty')?.value || '2', 10);
        closeModal();
        await startAISimulado(selectedFilter, count, difficulty);
      });
    }, 50);
  });
}

/* ─── AI Simulado ─────────────────────────────────────────── */

/**
 * Generates AI questions based on saved cards and starts a study session.
 * Uses PedagogicalPromptsService.generateBatchQuestions() for efficient batch generation.
 * @param {string} filter - 'all', 'disc:X', or 'topic:X'
 * @param {number} count - Number of questions to generate
 * @param {number} difficulty - 1/2/3
 */
async function startAISimulado(filter, count, difficulty) {
  // 1. Gather seed cards from the selected filter
  let seedPool = getAllCards();
  if (filter && filter !== 'all') {
    if (filter.startsWith('disc:')) {
      const value = filter.slice(5);
      seedPool = seedPool.filter(c => c._discId === value || c._disc === value);
    } else if (filter.startsWith('topic:')) {
      const value = filter.slice(6).toLowerCase();
      seedPool = seedPool.filter(c => String(c._topic || '').toLowerCase() === value);
    }
  }

  if (seedPool.length < 2) {
    toast('Você precisa ter ao menos 2 questões salvas neste filtro para gerar um simulado IA.', 'warning');
    return;
  }

  // Determine subject from seeds
  const subjectCounts = {};
  seedPool.forEach(c => {
    const d = c._disc || 'Geral';
    subjectCounts[d] = (subjectCounts[d] || 0) + 1;
  });
  const subject = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  // Navigate to study view and show loading state
  navigateTo('study');
  hide($('#studySetup'));
  hide($('#studySummary'));
  show($('#studyActive'));

  const container = $('#currentCard');
  if (container) {
    container.innerHTML = `
      <div class="study-card ai-generation-loading">
        <div class="ai-gen-header">
          <span class="material-symbols-rounded ai-gen-icon spinning">auto_awesome</span>
          <h3 class="ai-gen-title">Gerando Simulado IA</h3>
        </div>
        <p class="ai-gen-subtitle">A IA está criando <strong>${count}</strong> questões inéditas sobre ${subject || 'seus temas de estudo'}...</p>
        <div class="ai-gen-progress">
          <div class="ai-gen-progress-track">
            <div class="ai-gen-progress-fill" id="aiGenProgressFill" style="width:0%"></div>
          </div>
          <span class="ai-gen-progress-text" id="aiGenProgressText">Preparando...</span>
        </div>
        <p class="ai-gen-tip">💡 Questões são geradas com base nos conceitos das suas questões salvas, mas com cenários totalmente novos.</p>
      </div>`;
  }

  // 2. Generate questions in batches of up to 6
  const BATCH_SIZE = 6;
  const totalBatches = Math.ceil(count / BATCH_SIZE);
  const generatedQuestions = [];
  let failed = 0;

  for (let i = 0; i < totalBatches; i++) {
    const batchCount = Math.min(BATCH_SIZE, count - generatedQuestions.length);
    // Pick random seed cards for this batch
    const seeds = shuffle([...seedPool]).slice(0, Math.min(8, seedPool.length));

    const progress = Math.round(((i) / totalBatches) * 100);
    const fillEl = $('#aiGenProgressFill');
    const textEl = $('#aiGenProgressText');
    if (fillEl) fillEl.style.width = `${progress}%`;
    if (textEl) textEl.textContent = `Gerando lote ${i + 1}/${totalBatches}... (${generatedQuestions.length}/${count} questões)`;

    try {
      const batch = await PedagogicalPromptsService.generateBatchQuestions(
        seeds, batchCount, difficulty, subject
      );
      if (batch && batch.length > 0) {
        generatedQuestions.push(...batch);
      } else {
        failed++;
      }
    } catch (err) {
      console.warn('[AISimulado] Batch error:', err);
      failed++;
    }

    // Early exit if all batches failed
    if (failed >= totalBatches) break;
  }

  // Update progress to 100%
  const fillEl = $('#aiGenProgressFill');
  if (fillEl) fillEl.style.width = '100%';
  const textEl = $('#aiGenProgressText');
  if (textEl) textEl.textContent = `${generatedQuestions.length} questões geradas!`;

  if (generatedQuestions.length === 0) {
    toast('Não foi possível gerar questões. Verifique sua conexão ou configuração de IA.', 'error');
    hide($('#studyActive'));
    show($('#studySetup'));
    return;
  }

  // 3. Convert AI questions to card format compatible with renderCurrentCard()
  const aiCards = generatedQuestions.map((q, i) => {
    const optionsMap = q.optionsMap || {};
    const letters = Object.keys(optionsMap).sort();
    const correctLetter = (q.answerLetter || 'A').toUpperCase();
    const correctIdx = letters.indexOf(correctLetter);

    // Build question text with inline alternatives (the parser will handle separation)
    const optionsText = letters.map(l => `${l}) ${optionsMap[l]}`).join('\n');
    const fullQuestion = `${q.questionText}\n\n${optionsText}`;

    return {
      id: `ai_sim_${Date.now()}_${i}`,
      question: fullQuestion,
      answer: `${correctLetter}) ${optionsMap[correctLetter] || ''}\n\n${q.explanation || ''}`,
      explanation: q.explanation || '',
      options: letters.map(l => optionsMap[l]),
      correctIndex: correctIdx >= 0 ? correctIdx : 0,
      _disc: subject || 'Simulado IA',
      _discId: '__ai_simulado__',
      _topic: q.conceptTag || 'IA',
      _aiGenerated: true,
      _difficulty: q.difficulty || difficulty,
    };
  });

  // 4. Start the study session with AI cards
  state.session = {
    active: true,
    cards: shuffle(aiCards),
    index: 0,
    results: [],
    revealed: false,
  };

  // Small delay for the user to see "100% done"
  await new Promise(r => setTimeout(r, 600));

  toast(`Simulado IA iniciado: ${aiCards.length} questões geradas!`, 'success');
  renderCurrentCard();
  try { AnalyticsService.startSession?.(); } catch (_) { }
}

/* ─── Notifications Button ─────────────────────────────────────────── */

function initNotifications() {
  on($('#btnNotifications'), 'click', () => {
    const due = getDueCards().length;
    if (due > 0) {
      navigateTo('review');
    } else {
      toast('Nenhuma revisão pendente!', 'info', 2000);
    }
  });
}

/* ─── Add Question Button ──────────────────────────────────────────── */

function initAddQuestion() {
  on($('#btnAddQuestion'), 'click', () => {
    openModal('Adicionar Card Manual', `
      <label style="display:block;margin-bottom:var(--sp-4)">
        <span class="fw-600" style="display:block;margin-bottom:var(--sp-2);font-size:var(--text-sm)">Disciplina</span>
        <select id="addCardDisc" class="topbar__search-input" style="border-radius:var(--radius-md);padding-left:var(--sp-4)">
          <option value="">Selecione...</option>
        </select>
      </label>
      <label style="display:block;margin-bottom:var(--sp-4)">
        <span class="fw-600" style="display:block;margin-bottom:var(--sp-2);font-size:var(--text-sm)">Pergunta</span>
        <textarea id="addCardQ" rows="3" class="topbar__search-input" style="border-radius:var(--radius-md);padding:var(--sp-3);resize:vertical" placeholder="Digite a pergunta..."></textarea>
      </label>
      <label style="display:block;margin-bottom:var(--sp-4)">
        <span class="fw-600" style="display:block;margin-bottom:var(--sp-2);font-size:var(--text-sm)">Resposta</span>
        <textarea id="addCardA" rows="3" class="topbar__search-input" style="border-radius:var(--radius-md);padding:var(--sp-3);resize:vertical" placeholder="Digite a resposta..."></textarea>
      </label>
    `, `<button class="btn btn-primary btn-pill" id="saveCardBtn">Salvar card</button>`);

    setTimeout(() => {
      const discSel = $('#addCardDisc');
      const discs = state.hierarchy || [];
      discs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        discSel?.appendChild(opt);
      });

      on($('#saveCardBtn'), 'click', async () => {
        const discId = $('#addCardDisc')?.value;
        const q = $('#addCardQ')?.value?.trim();
        const a = $('#addCardA')?.value?.trim();
        if (!discId || !q) {
          toast('Preencha disciplina e pergunta.', 'warning');
          return;
        }
        try {
          let modules = await ContentHierarchyService.getModules(discId);
          let moduleId = modules?.[0]?.id;
          if (!moduleId) {
            const createdModule = await ContentHierarchyService.createModule(discId, { name: 'Geral' });
            moduleId = createdModule?.id;
          }

          let topics = moduleId ? await ContentHierarchyService.getTopics(discId, moduleId) : [];
          let topicId = topics?.[0]?.id;
          if (!topicId && moduleId) {
            const createdTopic = await ContentHierarchyService.createTopic(discId, moduleId, { name: 'Geral' });
            topicId = createdTopic?.id;
          }

          if (!moduleId || !topicId) {
            throw new Error('Não foi possível preparar disciplina/módulo/tópico para salvar o card.');
          }

          const createdCard = await ContentHierarchyService.createCard(discId, moduleId, topicId, {
            question: q, answer: a || '', pergunta: q, resposta: a || ''
          });
          if (!createdCard) {
            throw new Error('Não foi possível criar o card.');
          }

          toast('Card adicionado!', 'success');
          closeModal();
          state.hierarchy = await ContentHierarchyService.load(true);
        } catch (e) {
          toast('Erro ao criar card: ' + e.message, 'error');
        }
      });
    }, 50);
  });
}

/* ─── Utility Functions ────────────────────────────────────────────── */

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─── Init ─────────────────────────────────────────────────────────── */

async function init() {
  console.log('[StudyHub] Initializing...');

  // Load theme first (prevents flash)
  await loadTheme();

  // Init UI modules
  initSidebar();
  initCommandPalette();
  initKeyboard();
  initPomodoro();
  initSettings();
  initExport();
  initNotifications();
  initAddQuestion();
  initPractice();

  // Close modal/dock listeners
  on($('#closeModal'), 'click', closeModal);
  on($('#modalOverlay'), 'click', e => { if (e.target.id === 'modalOverlay') closeModal(); });
  on($('#closeToolDock'), 'click', closeToolDock);

  // Load data
  const success = await loadData();
  if (!success) {
    toast('Tentando carregar dados novamente...', 'warning');
    await loadData();
  }

  // Init data-dependent modules
  initStudySession();
  initFlashcards();
  initLibraryControls();

  // Render home
  await renderHome();

  // Handle URL parameters (e.g., ?discipline=X&mode=simulado)
  handleUrlParams();

  console.log('[StudyHub] Ready.');
}

function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const discipline = params.get('discipline');
  const mode = params.get('mode');

  if (discipline) {
    // Pre-select discipline
    const discSel = $('#sessionDisc');
    if (discSel) {
      // Find matching option
      const discs = state.hierarchy || [];
      const match = discs.find(d => d.name === discipline || d.id === discipline);
      if (match) {
        discSel.value = match.id || match.name;
      }
    }

    if (mode === 'simulado') {
      navigateTo('study');
      const sel = $('#sessionSource');
      if (sel) sel.value = 'all';
      setTimeout(startStudySession, 200);
    } else {
      navigateTo('study');
      setTimeout(startStudySession, 200);
    }
  }
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
