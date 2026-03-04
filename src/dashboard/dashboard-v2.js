/**
 * Dashboard v2 — Main Script (ES Module)
 * AnswerHunter v2 hub with sidebar navigation, stats, heatmap, insights.
 */

import { ContentHierarchyService } from '../services/ContentHierarchyService.js';
import { SearchIndexService } from '../services/SearchIndexService.js';
import { MigrationService } from '../services/MigrationService.js';
import { AnalyticsService } from '../services/AnalyticsService.js';
import { BadgeService } from '../services/BadgeService.js';
import { ExportService } from '../services/ExportService.js';
import { ComponentLibrary } from '../views/ComponentLibrary.js';

const { el, icon, ProgressRing, StatWidget, DisciplineCard, Breadcrumb,
        SearchBar, FilterPanel, Heatmap, InsightCard, EmptyState, Sidebar, showToast } = ComponentLibrary;

// ─── DEMO MODE ──────────────────────────────────────────────────────────────
const DEMO = typeof chrome === 'undefined' || !chrome.storage;

// ─── EMBEDDED MODE (inside iframe in study.html) ────────────────────────────
const IS_EMBEDDED = window.self !== window.top;

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
const LEVELS = [
  { min: 0, max: 100, lbl: 'Nível 1 — Iniciante', badge: 'L1' },
  { min: 100, max: 300, lbl: 'Nível 2 — Aprendiz', badge: 'L2' },
  { min: 300, max: 700, lbl: 'Nível 3 — Estudioso', badge: 'L3' },
  { min: 700, max: 1500, lbl: 'Nível 4 — Dedicado', badge: 'L4' },
  { min: 1500, max: 3000, lbl: 'Nível 5 — Focado', badge: 'L5' },
  { min: 3000, max: 6000, lbl: 'Nível 6 — Avançado', badge: 'L6' },
  { min: 6000, max: 12000, lbl: 'Nível 7 — Expert', badge: 'L7' },
  { min: 12000, max: 25000, lbl: 'Nível 8 — Mestre', badge: 'L8' },
  { min: 25000, max: 1e9, lbl: 'Nível 9 — Lendário', badge: 'L9' },
];

function getLevel(xp) { return LEVELS.find(l => xp >= l.min && xp < l.max) || LEVELS[LEVELS.length - 1]; }
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

// ─── STORAGE HELPERS ────────────────────────────────────────────────────────
function storageGet(keys) {
  if (DEMO) return Promise.resolve(makeDemoData(keys));
  return new Promise(r => chrome.storage.local.get(keys, r));
}

function makeDemoData(keys) {
  const SUBJS = ['Direito Constitucional', 'Direito Administrativo', 'Português', 'Matemática'];
  const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFD43B'];
  const hierarchy = SUBJS.map((name, i) => ({
    id: 'd_demo_' + i, name, icon: ['balance', 'account_balance', 'translate', 'calculate'][i], color: COLORS[i],
    modules: [{
      id: 'm_demo_' + i, name: 'Módulo 1', order: 0,
      topics: [{
        id: 't_demo_' + i, name: 'Tópico Geral', order: 0,
        cards: Array.from({ length: 8 + Math.floor(Math.random() * 12) }, (_, j) => {
          const lastD = new Date(Date.now() - Math.random() * 30 * 86400000);
          const dueD = new Date(Date.now() + (Math.random() * 18 - 4) * 86400000);
          return {
            id: 'c_demo_' + i + '_' + j,
            question: `Questão ${j + 1} sobre ${name}?`,
            answer: `Resposta detalhada sobre ${name}.`,
            source: 'demo',
            sm2: {
              interval: Math.round(Math.random() * 20),
              repetition: Math.floor(Math.random() * 10),
              ef: 1.6 + Math.random() * 1.4,
              nextReview: dueD.toISOString().slice(0, 10),
              lastRated: j > 2 ? lastD.toISOString().slice(0, 10) : '',
              attempts: Math.floor(Math.random() * 10),
              correct: Math.floor(Math.random() * 8),
              errors: Math.floor(Math.random() * 3),
              mastered: Math.random() > 0.65,
              fsrs_stability: 0.8 + Math.random() * 25,
              fsrs_difficulty: 2.5 + Math.random() * 5,
              fsrs_state: [0, 1, 2, 2, 2, 3][Math.floor(Math.random() * 6)],
              tags: [name],
            },
            tags: [name],
            createdAt: lastD.getTime(),
            updatedAt: lastD.getTime(),
          };
        })
      }]
    }],
    createdAt: Date.now(), updatedAt: Date.now()
  }));

  const result = {};
  if (keys.includes('ah_hierarchy')) result.ah_hierarchy = hierarchy;
  if (keys.includes('ah_xpData')) result.ah_xpData = { xp: 2847, streak: 12 };
  return result;
}

// ─── STATE ──────────────────────────────────────────────────────────────────
let currentPage = 'overview';
let hierarchyData = [];
let xpData = {};

// ─── INIT ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (DEMO) {
    document.getElementById('demoBanner').style.display = 'flex';
  }

  // Load saved theme
  if (!DEMO) {
    const themeData = await new Promise(r => chrome.storage.local.get(['ah_theme'], r));
    const theme = themeData.ah_theme;
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else if (theme === '') document.documentElement.setAttribute('data-theme', '');
    // 'auto' = no attribute, OS preference takes over
  }

  // Check migration
  if (!DEMO) {
    const needsMigration = await MigrationService.needsMigration();
    if (needsMigration) {
      showToast('Migrando dados para v2...', { type: 'info', duration: 5000 });
      const result = await MigrationService.migrate();
      if (result.success) {
        showToast(`Migração completa! ${result.stats.totalQuestions} cards organizados.`, { type: 'success' });
      } else {
        showToast('Erro na migração: ' + result.error, { type: 'danger', duration: 8000 });
      }
    }
  }

  // Load data
  const raw = await storageGet(['ah_hierarchy', 'ah_xpData']);
  hierarchyData = raw.ah_hierarchy || [];
  xpData = raw.ah_xpData || {};

  // Build search index
  if (!DEMO) {
    await SearchIndexService.build();
  }

  // Embedded mode: hide sidebar, expand main, add open-in-tab button
  if (IS_EMBEDDED) {
    const sidebarMount = document.getElementById('sidebar-mount');
    if (sidebarMount) sidebarMount.style.display = 'none';
    const mainEl = document.getElementById('main-content');
    if (mainEl) mainEl.style.marginLeft = '0';
    document.body.style.overflow = 'auto';

    // Insert "Open in new tab" floating action
    const fullUrl = chrome.runtime.getURL('src/dashboard/dashboard-v2.html');
    const fab = document.createElement('a');
    fab.href = fullUrl;
    fab.target = '_blank';
    fab.title = 'Abrir em nova aba (versão completa com sidebar)';
    fab.style.cssText =`
      position: fixed; bottom: 20px; right: 20px; z-index: 999;
      display: flex; align-items: center; gap: 6px;
      padding: 10px 18px; background: var(--ah-coral, #FF6B6B); color: #fff;
      border-radius: 50px; font-size: 13px; font-weight: 700;
      text-decoration: none; box-shadow: 0 4px 16px rgba(255,107,107,0.35);
      transition: transform 0.2s, box-shadow 0.2s;
      font-family: var(--ah-font-body, 'Nunito', sans-serif);
    `;
    fab.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px">open_in_new</span> Abrir completo';
    fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.06)'; });
    fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });
    document.body.appendChild(fab);
  }

  // Render
  renderSidebar();
  renderGreeting();
  renderLevelBar();
  renderStats();
  renderDisciplineGrid();
  renderDueList();
  renderHeatmap();
  renderInsights();
  renderStudyPlan();
  bindEvents();
});

// ─── SIDEBAR ────────────────────────────────────────────────────────────────
function renderSidebar() {
  if (IS_EMBEDDED) return; // No sidebar inside iframe
  const mount = document.getElementById('sidebar-mount');
  const sidebar = Sidebar({
    items: [
      { id: 'overview', icon: 'dashboard', label: 'Visão Geral', active: true },
      { id: 'disciplines', icon: 'school', label: 'Disciplinas' },
      { id: 'analytics', icon: 'monitoring', label: 'Analytics' },
      { id: 'badges', icon: 'emoji_events', label: 'Conquistas' },
      { id: 'settings', icon: 'settings', label: 'Configurações' },
    ],
    onNavigate: (pageId) => navigateTo(pageId)
  });
  mount.appendChild(sidebar);
}

function navigateTo(pageId) {
  currentPage = pageId;

  // Update sidebar
  document.querySelectorAll('.ah-sidebar__item').forEach(item => {
    item.classList.toggle('ah-sidebar__item--active', item.dataset.navId === pageId);
  });

  // Show/hide pages
  document.querySelectorAll('.page-section').forEach(section => {
    section.classList.toggle('page-section--active', section.id === 'page-' + pageId);
  });

  // Lazy-load discipline grid on disciplines page
  if (pageId === 'disciplines') {
    renderAllDisciplines();
  }
  if (pageId === 'analytics') {
    renderAnalyticsPage();
  }
  if (pageId === 'badges') {
    renderBadgesPage();
  }
}

// ─── GREETING ───────────────────────────────────────────────────────────────
function renderGreeting() {
  const h = new Date().getHours();
  let greeting;
  if (h < 6) greeting = 'Boa madrugada!';
  else if (h < 12) greeting = 'Bom dia!';
  else if (h < 18) greeting = 'Boa tarde!';
  else greeting = 'Boa noite!';

  const totalDue = countDue();
  document.getElementById('greetingTitle').textContent = greeting;
  document.getElementById('greetingSubtext').textContent =
    totalDue > 0 ? `Você tem ${totalDue} card${totalDue > 1 ? 's' : ''} para revisar hoje.` : 'Nenhuma revisão pendente — aproveite para explorar!';
}

// ─── LEVEL BAR ──────────────────────────────────────────────────────────────
function renderLevelBar() {
  const xp = xpData.xp || 0;
  const streak = xpData.streak || 0;
  const level = getLevel(xp);

  document.getElementById('levelBadge').textContent = level.badge;
  document.getElementById('levelName').textContent = level.lbl;
  document.getElementById('levelXp').textContent = `${xp.toLocaleString('pt-BR')} / ${level.max.toLocaleString('pt-BR')} XP`;
  document.getElementById('streakCount').textContent = streak;

  const fill = document.getElementById('levelFill');
  const progress = pct(xp - level.min, level.max - level.min);
  requestAnimationFrame(() => { fill.style.width = progress + '%'; });
}

// ─── STATS ROW ──────────────────────────────────────────────────────────────
function renderStats() {
  const row = document.getElementById('statsRow');
  row.innerHTML = '';

  const today = new Date().toISOString().slice(0, 10);
  let totalCards = 0, mastered = 0, due = 0, newCards = 0;

  for (const disc of hierarchyData) {
    for (const mod of disc.modules) {
      for (const topic of mod.topics) {
        for (const card of topic.cards) {
          totalCards++;
          const sm2 = card.sm2 || {};
          if (sm2.mastered) mastered++;
          if (!sm2.lastRated) newCards++;
          else if (!sm2.nextReview || sm2.nextReview <= today) due++;
        }
      }
    }
  }

  const widgets = [
    StatWidget({ icon: 'layers', label: 'Total de Cards', value: totalCards, color: 'var(--ah-blue)' }),
    StatWidget({ icon: 'schedule', label: 'Para Revisar', value: due, subtext: 'devido hoje', color: 'var(--ah-coral)' }),
    StatWidget({ icon: 'check_circle', label: 'Dominados', value: mastered, subtext: pct(mastered, totalCards) + '%', color: 'var(--ah-mint)' }),
    StatWidget({ icon: 'fiber_new', label: 'Novos', value: newCards, color: 'var(--ah-lavender)' }),
  ];

  widgets.forEach(w => row.appendChild(w));
}

// ─── DISCIPLINE GRID ────────────────────────────────────────────────────────
function renderDisciplineGrid() {
  const grid = document.getElementById('discGrid');
  const emptyMount = document.getElementById('discEmpty');
  grid.innerHTML = '';
  emptyMount.innerHTML = '';

  if (hierarchyData.length === 0) {
    emptyMount.appendChild(EmptyState({
      icon: '',
      title: 'Nenhuma disciplina ainda',
      description: 'Crie sua primeira disciplina ou salve questões no Binder para organizá-las.',
      action: { label: 'Criar Disciplina', onClick: () => promptNewDiscipline() }
    }));
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const disc of hierarchyData) {
    let totalCards = 0, mastered = 0, due = 0;
    for (const mod of disc.modules) {
      for (const topic of mod.topics) {
        for (const card of topic.cards) {
          totalCards++;
          if (card.sm2?.mastered) mastered++;
          if (!card.sm2?.nextReview || card.sm2.nextReview <= today) due++;
        }
      }
    }

    const card = DisciplineCard({
      ...disc,
      stats: { totalCards, mastered, due, masteryPct: pct(mastered, totalCards) }
    }, (discId) => openDisciplineDetail(discId));

    grid.appendChild(card);
  }
}

// ─── DUE LIST ───────────────────────────────────────────────────────────────
function renderDueList() {
  const list = document.getElementById('dueList');
  const emptyMount = document.getElementById('dueEmpty');
  list.innerHTML = '';
  emptyMount.innerHTML = '';

  const today = new Date().toISOString().slice(0, 10);
  const dueCards = [];

  for (const disc of hierarchyData) {
    for (const mod of disc.modules) {
      for (const topic of mod.topics) {
        for (const card of topic.cards) {
          const sm2 = card.sm2 || {};
          if (!sm2.nextReview || sm2.nextReview <= today) {
            dueCards.push({ ...card, disciplineName: disc.name, disciplineColor: disc.color });
          }
        }
      }
    }
  }

  if (dueCards.length === 0) {
    emptyMount.appendChild(EmptyState({
      icon: '',
      title: 'Tudo em dia!',
      description: 'Nenhum card para revisar hoje. Que tal adicionar novas questões?'
    }));
    return;
  }

  const shown = dueCards.slice(0, 15);
  for (const card of shown) {
    const item = el('div', { className: 'due-item' }, [
      el('div', { className: 'due-item__disc', style: { background: card.disciplineColor || 'var(--ah-coral)' } }),
      el('div', { className: 'due-item__text', textContent: card.question || '(sem texto)' }),
      el('div', { className: 'due-item__meta', textContent: card.disciplineName })
    ]);
    list.appendChild(item);
  }

  if (dueCards.length > 15) {
    list.appendChild(el('div', {
      style: { textAlign: 'center', padding: 'var(--ah-space-3)', fontSize: 'var(--ah-text-sm)', color: 'var(--ah-text-muted)' },
      textContent: `+ ${dueCards.length - 15} mais cards...`
    }));
  }
}

// ─── HEATMAP ────────────────────────────────────────────────────────────────
function renderHeatmap() {
  const mount = document.getElementById('heatmapMount');
  mount.innerHTML = '';

  // Build activity data from all cards
  const activity = {};
  for (const disc of hierarchyData) {
    for (const mod of disc.modules) {
      for (const topic of mod.topics) {
        for (const card of topic.cards) {
          const lastRated = card.sm2?.lastRated;
          if (lastRated) {
            activity[lastRated] = (activity[lastRated] || 0) + 1;
          }
        }
      }
    }
  }

  mount.appendChild(Heatmap(activity, { weeks: 26 }));
}

// ─── INSIGHTS ───────────────────────────────────────────────────────────────
function renderInsights() {
  const mount = document.getElementById('insightsMount');
  mount.innerHTML = '';

  const today = new Date().toISOString().slice(0, 10);
  let totalCards = 0, mastered = 0, due = 0, overdue = 0;
  const worstDisc = { name: '', ratio: 1 };

  for (const disc of hierarchyData) {
    let dCards = 0, dMastered = 0;
    for (const mod of disc.modules) {
      for (const topic of mod.topics) {
        for (const card of topic.cards) {
          totalCards++;
          dCards++;
          if (card.sm2?.mastered) { mastered++; dMastered++; }
          const nr = card.sm2?.nextReview;
          if (nr && nr <= today) due++;
          if (nr && nr < today) overdue++;
        }
      }
    }
    if (dCards > 3) {
      const ratio = dMastered / dCards;
      if (ratio < worstDisc.ratio) {
        worstDisc.name = disc.name;
        worstDisc.ratio = ratio;
      }
    }
  }

  const insights = [];

  if (due > 10) {
    insights.push(InsightCard({
      type: 'warning', icon: 'pending_actions',
      title: 'Acúmulo de revisões',
      body: `Você tem ${due} cards pendentes. Tente revisar pelo menos 10 por dia para manter a retenção.`
    }));
  }

  if (overdue > 5) {
    insights.push(InsightCard({
      type: 'danger', icon: 'warning',
      title: 'Cards atrasados!',
      body: `${overdue} cards estão atrasados. Quanto mais tempo passa, menor a retenção. Priorize eles.`
    }));
  }

  if (worstDisc.name && worstDisc.ratio < 0.3) {
    insights.push(InsightCard({
      type: 'info', icon: 'school',
      title: `Foco recomendado: ${worstDisc.name}`,
      body: `Somente ${Math.round(worstDisc.ratio * 100)}% dominado. Dedique mais tempo de estudo a essa disciplina.`
    }));
  }

  if (mastered > 0 && totalCards > 0) {
    insights.push(InsightCard({
      type: 'success', icon: 'check_circle',
      title: 'Progresso sólido!',
      body: `Você já dominou ${mastered} de ${totalCards} cards (${pct(mastered, totalCards)}%). Continue assim!`
    }));
  }

  if (insights.length === 0) {
    insights.push(InsightCard({
      type: 'info', icon: 'lightbulb',
      title: 'Sem insights por enquanto',
      body: 'Salve e revise mais questões para receber sugestões personalizadas de estudo.'
    }));
  }

  insights.forEach(i => mount.appendChild(i));
}

// ─── STUDY PLAN ─────────────────────────────────────────────────────────────
function renderStudyPlan() {
  const mount = document.getElementById('studyPlanItems');
  mount.innerHTML = '';

  const dueCount = countDue();
  const plans = [
    { label: `Revisar ${Math.min(dueCount, 10)} cards pendentes`, done: dueCount === 0 },
    { label: 'Adicionar 5 novas questões ao Binder', done: false },
    { label: 'Estudar disciplina mais fraca por 15 min', done: false },
  ];

  for (const plan of plans) {
    const item = el('div', { className: `study-plan__item ${plan.done ? 'study-plan__item--done' : ''}` }, [
      el('div', { className: `study-plan__check ${plan.done ? 'study-plan__check--done' : ''}` }),
      el('span', { textContent: plan.label })
    ]);
    mount.appendChild(item);
  }
}

// ─── ALL DISCIPLINES PAGE ───────────────────────────────────────────────────
function renderAllDisciplines() {
  const grid = document.getElementById('allDiscGrid');
  grid.innerHTML = '';

  const searchMount = document.getElementById('allDiscSearchMount');
  if (!searchMount.children.length) {
    searchMount.appendChild(SearchBar({
      placeholder: 'Buscar disciplina...',
      onSearch: (q) => filterDisciplines(q)
    }));
  }

  renderDiscGrid(grid, hierarchyData);
}

function renderDiscGrid(container, data) {
  container.innerHTML = '';
  const today = new Date().toISOString().slice(0, 10);

  for (const disc of data) {
    let totalCards = 0, mastered = 0, due = 0;
    for (const mod of disc.modules) {
      for (const topic of mod.topics) {
        for (const card of topic.cards) {
          totalCards++;
          if (card.sm2?.mastered) mastered++;
          if (!card.sm2?.nextReview || card.sm2.nextReview <= today) due++;
        }
      }
    }

    container.appendChild(DisciplineCard({
      ...disc,
      stats: { totalCards, mastered, due, masteryPct: pct(mastered, totalCards) }
    }, (id) => openDisciplineDetail(id)));
  }
}

function filterDisciplines(query) {
  const grid = document.getElementById('allDiscGrid');
  if (!query) {
    renderDiscGrid(grid, hierarchyData);
    return;
  }
  const q = query.toLowerCase();
  const filtered = hierarchyData.filter(d => d.name.toLowerCase().includes(q));
  renderDiscGrid(grid, filtered);
}

// ─── EVENTS ─────────────────────────────────────────────────────────────────
function bindEvents() {
  // Theme toggle
  document.getElementById('btnThemeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? '' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    if (!DEMO) chrome.storage.local.set({ ah_theme: next });
  });

  // Theme settings page buttons
  document.getElementById('btnLightTheme')?.addEventListener('click', () => {
    document.documentElement.setAttribute('data-theme', '');
    if (!DEMO) chrome.storage.local.set({ ah_theme: '' });
  });
  document.getElementById('btnDarkTheme')?.addEventListener('click', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (!DEMO) chrome.storage.local.set({ ah_theme: 'dark' });
  });
  document.getElementById('btnAutoTheme')?.addEventListener('click', () => {
    document.documentElement.removeAttribute('data-theme');
    if (!DEMO) chrome.storage.local.set({ ah_theme: 'auto' });
  });

  // Settings
  document.getElementById('btnSettings')?.addEventListener('click', () => navigateTo('settings'));

  // New discipline buttons
  document.getElementById('btnNewDisc')?.addEventListener('click', promptNewDiscipline);
  document.getElementById('btnNewDiscAll')?.addEventListener('click', promptNewDiscipline);

  // Study all
  document.getElementById('btnStudyAll')?.addEventListener('click', () => {
    if (!DEMO) {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/study/study.html') });
    }
  });

  // Migrate button
  document.getElementById('btnMigrate')?.addEventListener('click', async () => {
    if (DEMO) {
      showToast('Migração não disponível em modo demo', { type: 'warning' });
      return;
    }
    try {
      showToast('Iniciando migração v1→v2...', { type: 'info' });
      const result = await MigrationService.migrate();
      if (result.success) {
        showToast(`Migração completa! ${result.stats.totalQuestions || 0} cards.`, { type: 'success' });
        location.reload();
      } else {
        showToast('Erro: ' + result.error, { type: 'danger' });
      }
    } catch (err) {
      showToast('Erro na migração: ' + err.message, { type: 'danger' });
    }
  });

  // Export — full JSON backup using ExportService
  document.getElementById('btnExportData')?.addEventListener('click', async () => {
    if (DEMO) { showToast('Exportação não disponível em modo demo', { type: 'warning' }); return; }
    try {
      await ExportService.downloadBackup();
      showToast('Backup exportado!', { type: 'success' });
    } catch (err) {
      showToast('Erro ao exportar: ' + err.message, { type: 'danger' });
    }
  });

  // Import
  document.getElementById('btnImportData')?.addEventListener('click', () => {
    if (DEMO) { showToast('Importação não disponível em modo demo', { type: 'warning' }); return; }
    document.getElementById('importFileInput')?.click();
  });
  document.getElementById('importFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await ExportService.readFile(file);
      const result = await ExportService.importFullJSON(text);
      if (result.success) {
        showToast('Importação concluída! Recarregando...', { type: 'success' });
        setTimeout(() => location.reload(), 1500);
      } else {
        showToast(result.message, { type: 'danger' });
      }
    } catch (err) {
      showToast('Erro na importação: ' + err.message, { type: 'danger' });
    }
  });

  // Export CSV/Anki/JSON from analytics page
  document.getElementById('btnExportCSV')?.addEventListener('click', () => {
    if (DEMO) return;
    ExportService.downloadCSV(hierarchyData);
    showToast('CSV exportado!', { type: 'success' });
  });
  document.getElementById('btnExportAnki')?.addEventListener('click', () => {
    if (DEMO) return;
    ExportService.downloadAnki(hierarchyData);
    showToast('Anki exportado!', { type: 'success' });
  });
  document.getElementById('btnExportJSON')?.addEventListener('click', async () => {
    if (DEMO) return;
    try {
      await ExportService.downloadBackup();
      showToast('Backup JSON exportado!', { type: 'success' });
    } catch (err) {
      showToast('Erro ao exportar JSON: ' + err.message, { type: 'danger' });
    }
  });

  // Search bar on overview
  const searchMount = document.getElementById('searchBarMount');
  if (searchMount) {
    searchMount.appendChild(SearchBar({
      placeholder: 'Buscar cards...',
      onSearch: (q) => {
        if (!q) return;
        // Switch to disciplines page with search
        navigateTo('disciplines');
        // TODO: implement global search result page
        showToast(`Buscando: "${q}"...`, { type: 'info' });
      }
    }));
  }
}

// ─── ACTIONS ────────────────────────────────────────────────────────────────
function promptNewDiscipline() {
  const name = prompt('Nome da nova disciplina:');
  if (!name || !name.trim()) return;

  if (DEMO) {
    const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFD43B', '#DDA0DD', '#98D8C8'];
    hierarchyData.push({
      id: 'd_' + Date.now(), name: name.trim(), icon: '',
      color: COLORS[hierarchyData.length % COLORS.length],
      modules: [], createdAt: Date.now(), updatedAt: Date.now()
    });
    renderDisciplineGrid();
    showToast(`Disciplina "${name}" criada!`, { type: 'success' });
    return;
  }

  ContentHierarchyService.createDiscipline({ name: name.trim() }).then(disc => {
    hierarchyData.push(disc);
    renderDisciplineGrid();
    showToast(`Disciplina "${disc.name}" criada!`, { type: 'success' });
  });
}

function openDisciplineDetail(discId) {
  // Open discipline detail page in new tab
  if (DEMO) {
    showToast('Detalhe de disciplina — disponível na versão real', { type: 'info' });
    return;
  }
  const url = chrome.runtime.getURL(`src/dashboard/discipline-detail.html?id=${discId}`);
  chrome.tabs.create({ url });
}

// ─── ANALYTICS PAGE ─────────────────────────────────────────────────────────
async function renderAnalyticsPage() {
  const statsRow = document.getElementById('analyticsStatsRow');
  const dailyChart = document.getElementById('dailyChart');
  const weeklyChart = document.getElementById('weeklyChart');
  const discPerf = document.getElementById('discPerformance');

  if (!statsRow) return;

  if (DEMO) {
    statsRow.innerHTML = '<p style="color:var(--ah-text-muted);font-size:var(--ah-text-sm)">Analytics disponível apenas com dados reais.</p>';
    return;
  }

  try {
    const overview = await AnalyticsService.getOverview();
    const daily = await AnalyticsService.getDailyRange(30);
    const weekly = await AnalyticsService.getWeeklyTrend();
    const discData = await AnalyticsService.getDisciplinePerformance(hierarchyData);

    // Stats row
    statsRow.innerHTML = '';
    [
      StatWidget({ icon: 'rate_review', label: 'Revisões (30d)', value: overview.totalReviews, color: 'var(--ah-coral)' }),
      StatWidget({ icon: 'percent', label: 'Precisão', value: overview.avgAccuracy + '%', color: 'var(--ah-mint)' }),
      StatWidget({ icon: 'schedule', label: 'Min. Estudados', value: overview.totalMinutes, color: 'var(--ah-blue)' }),
      StatWidget({ icon: 'calendar_month', label: 'Dias Ativos', value: overview.activeDays, color: 'var(--ah-gold)' }),
    ].forEach(w => statsRow.appendChild(w));

    // Daily bar chart
    dailyChart.innerHTML = '';
    const maxDaily = Math.max(...daily.map(d => d.reviews), 1);
    for (const day of daily) {
      const height = Math.max(2, (day.reviews / maxDaily) * 180);
      const bar = el('div', {
        style: {
          flex: '1', minWidth: '4px', background: day.reviews > 0 ? 'var(--ah-coral)' : 'var(--ah-border)',
          height: height + 'px', borderRadius: '3px 3px 0 0', transition: 'height 0.5s ease'
        },
        title: `${day.date}: ${day.reviews} revisões`
      });
      dailyChart.appendChild(bar);
    }

    // Weekly bar chart
    weeklyChart.innerHTML = '';
    const maxWeek = Math.max(...weekly.map(w => w.reviews), 1);
    for (const week of weekly) {
      const height = Math.max(2, (week.reviews / maxWeek) * 180);
      const bar = el('div', {
        style: {
          flex: '1', minWidth: '10px', background: week.reviews > 0 ? 'var(--ah-blue)' : 'var(--ah-border)',
          height: height + 'px', borderRadius: '4px 4px 0 0', transition: 'height 0.5s ease'
        },
        title: `Semana ${Math.abs(week.weekOffset)}: ${week.reviews} revisões`
      });
      weeklyChart.appendChild(bar);
    }

    // Discipline performance bars
    discPerf.innerHTML = '';
    if (discData.length === 0) {
      discPerf.appendChild(el('p', {
        style: { fontSize: 'var(--ah-text-sm)', color: 'var(--ah-text-muted)' },
        textContent: 'Sem dados de desempenho ainda — estude para ver estatísticas.'
      }));
    } else {
      for (const d of discData) {
        const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--ah-space-3)' } }, [
          el('div', { style: { width: '4px', height: '32px', borderRadius: '4px', background: d.color || 'var(--ah-coral)' } }),
          el('div', { style: { flex: '1', minWidth: 0 } }, [
            el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--ah-text-sm)' } }, [
              el('span', { textContent: d.name, style: { fontWeight: '600' } }),
              el('span', { textContent: `${d.reviews} rev · ${d.accuracy}%`, style: { color: 'var(--ah-text-muted)' } })
            ]),
            el('div', { className: 'ah-progress', style: { marginTop: '4px' } }, [
              el('div', { className: 'ah-progress__fill', style: { width: d.accuracy + '%', background: d.color || 'var(--ah-coral)' } })
            ])
          ])
        ]);
        discPerf.appendChild(row);
      }
    }
  } catch (err) {
    console.warn('[Dashboard] Analytics load error:', err);
    statsRow.innerHTML = '<p style="color:var(--ah-danger)">Erro ao carregar analytics.</p>';
  }
}

// ─── BADGES PAGE ────────────────────────────────────────────────────────────
async function renderBadgesPage() {
  const mount = document.getElementById('badgeCategoriesMount');
  const countLabel = document.getElementById('badgeCountLabel');
  if (!mount) return;

  try {
    // Evaluate badges first
    if (!DEMO) {
      const xp = xpData;
      const stats = BadgeService.buildStats(hierarchyData, xp);
      await BadgeService.evaluate(stats);
    }

    const allBadges = await BadgeService.getAllBadges();
    const categories = BadgeService.getCategories();
    const unlockedCount = allBadges.filter(b => b.unlocked).length;

    if (countLabel) {
      countLabel.textContent = `${unlockedCount} / ${allBadges.length} desbloqueadas`;
    }

    mount.innerHTML = '';

    for (const cat of categories) {
      const catSection = el('div', {}, [
        el('h3', {
          style: { fontFamily: 'var(--ah-font-display)', fontSize: 'var(--ah-text-base)', marginBottom: 'var(--ah-space-3)' },
          textContent: cat.name
        })
      ]);

      const grid = el('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--ah-space-3)' }
      });

      // Find unlock status from full badge list
      for (const def of cat.badges) {
        const badge = allBadges.find(b => b.id === def.id);
        const isUnlocked = badge?.unlocked;

        const card = el('div', {
          className: `ah-card ${isUnlocked ? '' : 'ah-badge--locked'}`,
          style: {
            padding: 'var(--ah-space-4)', textAlign: 'center',
            opacity: isUnlocked ? '1' : '0.45', transition: 'all 0.3s ease',
            cursor: 'default'
          }
        }, [
          el('div', { innerHTML: def.icon, style: { width: '72px', height: '72px', margin: '0 auto var(--ah-space-2)', filter: isUnlocked ? 'drop-shadow(0 2px 6px rgba(0,0,0,0.18))' : 'grayscale(1) brightness(0.7)', opacity: isUnlocked ? '1' : '0.4' } }),
          el('div', {
            textContent: def.name,
            style: { fontWeight: '700', fontFamily: 'var(--ah-font-display)', fontSize: 'var(--ah-text-sm)' }
          }),
          el('div', {
            textContent: def.desc,
            style: { fontSize: 'var(--ah-text-xs)', color: 'var(--ah-text-muted)', marginTop: 'var(--ah-space-1)' }
          }),
          isUnlocked ? el('div', {
            textContent: 'Desbloqueado',
            style: { fontSize: 'var(--ah-text-xs)', color: 'var(--ah-mint)', fontWeight: '600', marginTop: 'var(--ah-space-2)' }
          }) : el('div', {
            textContent: 'Bloqueado',
            style: { fontSize: 'var(--ah-text-xs)', color: 'var(--ah-text-muted)', marginTop: 'var(--ah-space-2)' }
          })
        ]);

        grid.appendChild(card);
      }

      catSection.appendChild(grid);
      mount.appendChild(catSection);
    }
  } catch (err) {
    console.warn('[Dashboard] Badges load error:', err);
    mount.innerHTML = '<p style="color:var(--ah-danger)">Erro ao carregar conquistas.</p>';
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
function countDue() {
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  for (const disc of hierarchyData) {
    for (const mod of disc.modules) {
      for (const topic of mod.topics) {
        for (const card of topic.cards) {
          const nr = card.sm2?.nextReview;
          if (!nr || nr <= today) count++;
        }
      }
    }
  }
  return count;
}
