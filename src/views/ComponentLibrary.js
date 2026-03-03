/**
 * ComponentLibrary.js
 * Reusable DOM component generators for AnswerHunter v2 pages.
 *
 * All functions return raw HTMLElement(s) — no framework needed.
 * Uses the design tokens from tokens.css and base.css class names.
 *
 * Works in both ES-module contexts and classic <script> contexts
 * when loaded via importScripts or inline.
 */

// ─── Utility ─────────────────────────────────────────────────────────────────

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') node.className = val;
    else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
    else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2).toLowerCase(), val);
    else if (key === 'innerHTML') node.innerHTML = val;
    else if (key === 'textContent') node.textContent = val;
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else node.setAttribute(key, val);
  }
  for (const child of (Array.isArray(children) ? children : [children])) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else if (child instanceof Node) node.appendChild(child);
  }
  return node;
}

function icon(name, size = 22) {
  return el('span', {
    className: 'material-symbols-rounded',
    textContent: name,
    style: { fontSize: size + 'px', width: size + 'px', lineHeight: '1' }
  });
}

// ─── Components ──────────────────────────────────────────────────────────────

export const ComponentLibrary = {

  // ════ Progress Ring (SVG) ════════════════════════════════════════════════

  /**
   * Creates an SVG circular progress ring.
   * @param {number} percent - 0-100
   * @param {Object} [opts]
   * @param {number} [opts.size=48]
   * @param {number} [opts.stroke=4]
   * @param {string} [opts.color] - CSS color (defaults to --ah-coral)
   * @param {string} [opts.bgColor] - track color
   * @param {boolean} [opts.showLabel=true]
   * @returns {HTMLElement}
   */
  ProgressRing(percent, opts = {}) {
    const size = opts.size || 48;
    const stroke = opts.stroke || 4;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;
    const color = opts.color || 'var(--ah-coral)';
    const bgColor = opts.bgColor || 'var(--ah-gray-200)';

    const wrapper = el('div', {
      className: 'ah-progress-ring',
      style: { position: 'relative', width: size + 'px', height: size + 'px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.style.transform = 'rotate(-90deg)';

    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', size / 2);
    bgCircle.setAttribute('cy', size / 2);
    bgCircle.setAttribute('r', radius);
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', bgColor);
    bgCircle.setAttribute('stroke-width', stroke);

    const fgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fgCircle.setAttribute('cx', size / 2);
    fgCircle.setAttribute('cy', size / 2);
    fgCircle.setAttribute('r', radius);
    fgCircle.setAttribute('fill', 'none');
    fgCircle.setAttribute('stroke', color);
    fgCircle.setAttribute('stroke-width', stroke);
    fgCircle.setAttribute('stroke-linecap', 'round');
    fgCircle.setAttribute('stroke-dasharray', circumference);
    fgCircle.setAttribute('stroke-dashoffset', offset);
    fgCircle.style.transition = 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)';

    svg.appendChild(bgCircle);
    svg.appendChild(fgCircle);
    wrapper.appendChild(svg);

    if (opts.showLabel !== false) {
      const label = el('span', {
        textContent: Math.round(percent) + '%',
        style: {
          position: 'absolute', fontSize: Math.max(9, size / 4.5) + 'px',
          fontWeight: '700', color: 'var(--ah-text-primary)',
          fontFamily: 'var(--ah-font-display)'
        }
      });
      wrapper.appendChild(label);
    }

    return wrapper;
  },

  // ════ Stat Widget ═══════════════════════════════════════════════════════

  /**
   * Creates a stat card with icon, label and value.
   * @param {{icon: string, label: string, value: string|number, subtext?: string, color?: string}} data
   * @returns {HTMLElement}
   */
  StatWidget({ icon: iconName, label, value, subtext, color }) {
    const accentColor = color || 'var(--ah-coral)';
    const card = el('div', { className: 'ah-card ah-stat-widget' }, [
      el('div', { className: 'ah-flex ah-items-center ah-gap-3', style: { marginBottom: '8px' } }, [
        el('div', {
          style: {
            width: '40px', height: '40px', borderRadius: 'var(--ah-radius-lg)',
            background: accentColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }
        }, [
          el('span', { className: 'material-symbols-rounded', textContent: iconName, style: { fontSize: '22px', color: accentColor } })
        ]),
        el('span', { textContent: label, style: { fontSize: 'var(--ah-text-xs)', color: 'var(--ah-text-secondary)', fontWeight: '500' } })
      ]),
      el('div', { textContent: String(value), style: { fontSize: 'var(--ah-text-2xl)', fontWeight: '800', fontFamily: 'var(--ah-font-display)', color: 'var(--ah-text-primary)' } }),
      ...(subtext ? [el('div', { textContent: subtext, style: { fontSize: 'var(--ah-text-xs)', color: 'var(--ah-text-muted)', marginTop: '4px' } })] : [])
    ]);
    return card;
  },

  // ════ Discipline Card ═══════════════════════════════════════════════════

  /**
   * @param {{id, name, icon, color, stats: {totalCards, mastered, due, masteryPct}}} disc
   * @param {Function} [onClick]
   * @returns {HTMLElement}
   */
  DisciplineCard(disc, onClick) {
    const stats = disc.stats || {};
    const card = el('div', { className: 'ah-disc-card ah-fade-in', dataset: { id: disc.id } });
    card.style.borderLeftColor = disc.color || 'var(--ah-coral)';

    if (onClick) {
      card.addEventListener('click', () => onClick(disc.id));
    }

    card.innerHTML = `
      <div class="ah-disc-card__icon">${disc.icon || '📚'}</div>
      <div class="ah-disc-card__title">${this._esc(disc.name)}</div>
      <div class="ah-disc-card__meta">${stats.totalCards || 0} cards · ${stats.due || 0} due</div>
      <div class="ah-disc-card__progress">
        <div class="ah-progress"><div class="ah-progress__fill" style="width:${stats.masteryPct || 0}%;background:${disc.color || 'var(--ah-coral)'}"></div></div>
      </div>
      <div class="ah-disc-card__actions">
        <button class="ah-btn ah-btn--sm ah-btn--primary" data-action="study" style="background:${disc.color}">Study</button>
        <button class="ah-btn ah-btn--sm ah-btn--ghost" data-action="details">Details</button>
      </div>
    `;

    return card;
  },

  // ════ Breadcrumb Navigation ═════════════════════════════════════════════

  /**
   * @param {Array<{label: string, onClick?: Function}>} items
   * @returns {HTMLElement}
   */
  Breadcrumb(items) {
    const nav = el('nav', { className: 'ah-breadcrumb' });
    items.forEach((item, i) => {
      if (i > 0) {
        nav.appendChild(el('span', { className: 'ah-breadcrumb__sep', textContent: '›' }));
      }
      const isLast = i === items.length - 1;
      const crumb = el('span', {
        className: isLast ? 'ah-breadcrumb__current' : 'ah-breadcrumb__item',
        textContent: item.label
      });
      if (!isLast && item.onClick) {
        crumb.addEventListener('click', item.onClick);
      }
      nav.appendChild(crumb);
    });
    return nav;
  },

  // ════ Module Accordion ══════════════════════════════════════════════════

  /**
   * @param {{id, name, topics: Array, order: number}} mod
   * @param {Object} [opts]
   * @param {boolean} [opts.locked=false]
   * @param {Function} [opts.onTopicClick]
   * @returns {HTMLElement}
   */
  ModuleAccordion(mod, opts = {}) {
    const wrapper = el('div', {
      className: `ah-module ${opts.locked ? 'ah-module--locked' : ''}`,
      dataset: { moduleId: mod.id }
    });

    const totalCards = (mod.topics || []).reduce((s, t) => s + (t.cards?.length || 0), 0);

    const header = el('div', { className: 'ah-module__header' }, [
      el('div', { className: 'ah-flex ah-items-center ah-gap-3' }, [
        icon(opts.locked ? 'lock' : 'folder_open'),
        el('span', { className: 'ah-module__title', textContent: mod.name }),
        el('span', { className: 'ah-badge ah-badge--gray', textContent: `${totalCards} cards` })
      ]),
      icon('expand_more', 20)
    ]);

    header.addEventListener('click', () => {
      wrapper.classList.toggle('ah-module--open');
    });

    const body = el('div', { className: 'ah-module__body' });
    const bodyInner = el('div', { className: 'ah-module__body-inner' });

    for (const topic of (mod.topics || [])) {
      const cardCount = topic.cards?.length || 0;
      const mastered = (topic.cards || []).filter(c => c.sm2?.mastered).length;
      const pct = cardCount > 0 ? Math.round((mastered / cardCount) * 100) : 0;

      const row = el('div', { className: 'ah-topic-row', dataset: { topicId: topic.id } }, [
        icon('article', 18),
        el('span', { className: 'ah-topic-row__name', textContent: topic.name }),
        el('div', { className: 'ah-topic-row__progress' }, [
          el('div', { className: 'ah-progress', style: { height: '4px' } }, [
            el('div', { className: 'ah-progress__fill ah-progress--mint', style: { width: pct + '%' } })
          ])
        ]),
        el('span', { className: 'ah-topic-row__badge ah-badge ah-badge--gray', textContent: String(cardCount) })
      ]);

      if (opts.onTopicClick) {
        row.addEventListener('click', () => opts.onTopicClick(topic.id, mod.id));
      }

      bodyInner.appendChild(row);
    }

    body.appendChild(bodyInner);
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  },

  // ════ Filter Panel ══════════════════════════════════════════════════════

  /**
   * @param {{filters: Array<{id, label, active?}>, onToggle: Function}} config
   * @returns {HTMLElement}
   */
  FilterPanel({ filters, onToggle }) {
    const panel = el('div', { className: 'ah-filters' });
    for (const f of filters) {
      const chip = el('button', {
        className: `ah-filter-chip ${f.active ? 'ah-filter-chip--active' : ''}`,
        textContent: f.label,
        dataset: { filterId: f.id }
      });
      chip.addEventListener('click', () => {
        chip.classList.toggle('ah-filter-chip--active');
        onToggle(f.id, chip.classList.contains('ah-filter-chip--active'));
      });
      panel.appendChild(chip);
    }
    return panel;
  },

  // ════ Search Bar ════════════════════════════════════════════════════════

  /**
   * @param {{placeholder?: string, onSearch: Function, onClear?: Function}} config
   * @returns {HTMLElement}
   */
  SearchBar({ placeholder, onSearch, onClear }) {
    let debounceTimer;

    const wrapper = el('div', {
      className: 'ah-flex ah-items-center ah-gap-2',
      style: { position: 'relative', maxWidth: '400px', width: '100%' }
    });

    const input = el('input', {
      className: 'ah-input',
      type: 'text',
      placeholder: placeholder || 'Search cards...',
      style: { paddingLeft: '36px' }
    });

    const searchIcon = icon('search', 18);
    searchIcon.style.cssText = 'position:absolute;left:10px;color:var(--ah-text-muted);pointer-events:none;';

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onSearch(input.value.trim());
      }, 250);
    });

    wrapper.appendChild(searchIcon);
    wrapper.appendChild(input);

    if (onClear) {
      const clearBtn = el('button', {
        className: 'ah-btn ah-btn--ghost ah-btn--sm',
        textContent: '✕',
        style: { position: 'absolute', right: '4px' }
      });
      clearBtn.addEventListener('click', () => {
        input.value = '';
        onClear();
      });
      wrapper.appendChild(clearBtn);
    }

    return wrapper;
  },

  // ════ Toast Notification ════════════════════════════════════════════════

  /**
   * Shows a toast notification.
   * @param {string} message
   * @param {{type?: 'info'|'success'|'warning'|'danger', duration?: number}} opts
   */
  showToast(message, opts = {}) {
    const type = opts.type || 'info';
    const duration = opts.duration || 3500;

    let container = document.querySelector('.ah-toast-container');
    if (!container) {
      container = el('div', { className: 'ah-toast-container' });
      document.body.appendChild(container);
    }

    const toast = el('div', { className: `ah-toast ah-toast--${type}` }, [
      icon(type === 'success' ? 'check_circle' : type === 'warning' ? 'warning' : type === 'danger' ? 'error' : 'info', 20),
      el('span', { textContent: message })
    ]);

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('ah-toast--departing');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  },

  // ════ Empty State ═══════════════════════════════════════════════════════

  /**
   * @param {{icon: string, title: string, description: string, action?: {label: string, onClick: Function}}} config
   * @returns {HTMLElement}
   */
  EmptyState({ icon: iconName, title, description, action }) {
    const wrapper = el('div', { className: 'ah-empty ah-fade-in' }, [
      el('div', { className: 'ah-empty__icon', textContent: iconName }),
      el('div', { className: 'ah-empty__title', textContent: title }),
      el('div', { className: 'ah-empty__description', textContent: description })
    ]);
    if (action) {
      const btn = el('button', {
        className: 'ah-btn ah-btn--primary',
        textContent: action.label
      });
      btn.addEventListener('click', action.onClick);
      wrapper.appendChild(btn);
    }
    return wrapper;
  },

  // ════ Heatmap (Study Activity) ══════════════════════════════════════════

  /**
   * Creates a GitHub-style activity heatmap.
   * @param {Object<string, number>} data - date string → count
   * @param {Object} [opts]
   * @param {number} [opts.weeks=26] - number of weeks to show
   * @returns {HTMLElement}
   */
  Heatmap(data, opts = {}) {
    const weeks = opts.weeks || 26;
    const totalDays = weeks * 7;
    const cellSize = 12;
    const gap = 2;

    const wrapper = el('div', {
      className: 'ah-heatmap',
      style: { overflowX: 'auto', padding: '4px 0' }
    });

    const grid = el('div', {
      style: {
        display: 'grid',
        gridTemplateRows: `repeat(7, ${cellSize}px)`,
        gridAutoFlow: 'column',
        gap: gap + 'px'
      }
    });

    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - totalDays + 1);

    // Get max for color scaling
    const values = Object.values(data);
    const maxVal = Math.max(1, ...values);

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const count = data[key] || 0;

      const intensity = count / maxVal;
      let bg;
      if (count === 0) bg = 'var(--ah-gray-100)';
      else if (intensity < 0.25) bg = 'rgba(var(--ah-mint-rgb), 0.3)';
      else if (intensity < 0.5) bg = 'rgba(var(--ah-mint-rgb), 0.5)';
      else if (intensity < 0.75) bg = 'rgba(var(--ah-mint-rgb), 0.7)';
      else bg = 'var(--ah-mint)';

      const cell = el('div', {
        style: {
          width: cellSize + 'px', height: cellSize + 'px',
          borderRadius: '2px', background: bg
        },
        dataset: { date: key, count: String(count) },
        'data-tooltip': `${key}: ${count} reviews`
      });
      cell.className = 'ah-tooltip';

      grid.appendChild(cell);
    }

    wrapper.appendChild(grid);
    return wrapper;
  },

  // ════ Insight Card ══════════════════════════════════════════════════════

  /**
   * @param {{type?: 'info'|'warning'|'success'|'danger', icon: string, title: string, body: string}} data
   * @returns {HTMLElement}
   */
  InsightCard({ type = 'info', icon: iconName, title, body }) {
    const card = el('div', { className: `ah-insight ah-insight--${type}` }, [
      el('div', { className: 'ah-insight__title' }, [
        icon(iconName || 'lightbulb', 18),
        el('span', { textContent: title })
      ]),
      el('div', { textContent: body, style: { color: 'var(--ah-text-secondary)' } })
    ]);
    return card;
  },

  // ════ Sidebar ═══════════════════════════════════════════════════════════

  /**
   * Creates the dashboard sidebar.
   * @param {{items: Array<{id, icon, label, active?}>, onNavigate: Function, collapsed?: boolean}} config
   * @returns {HTMLElement}
   */
  Sidebar({ items, onNavigate, collapsed = false }) {
    const sidebar = el('aside', {
      className: `ah-sidebar ${collapsed ? 'ah-sidebar--collapsed' : ''}`
    });

    const logo = el('div', { className: 'ah-sidebar__logo' }, [
      el('img', { src: '/icons/icon128.png', alt: 'AnswerHunter' }),
      el('span', { textContent: 'AnswerHunter' })
    ]);

    const nav = el('nav', { className: 'ah-sidebar__nav' });

    for (const item of items) {
      const btn = el('button', {
        className: `ah-sidebar__item ${item.active ? 'ah-sidebar__item--active' : ''}`,
        dataset: { navId: item.id }
      }, [
        icon(item.icon),
        el('span', { textContent: item.label })
      ]);
      btn.addEventListener('click', () => onNavigate(item.id));
      nav.appendChild(btn);
    }

    const footer = el('div', { className: 'ah-sidebar__footer' });
    const collapseBtn = el('button', {
      className: 'ah-btn ah-btn--ghost ah-btn--sm',
      style: { width: '100%' }
    }, [icon(collapsed ? 'chevron_right' : 'chevron_left')]);
    collapseBtn.addEventListener('click', () => {
      sidebar.classList.toggle('ah-sidebar--collapsed');
      const isCollapsed = sidebar.classList.contains('ah-sidebar--collapsed');
      collapseBtn.innerHTML = '';
      collapseBtn.appendChild(icon(isCollapsed ? 'chevron_right' : 'chevron_left'));
    });
    footer.appendChild(collapseBtn);

    sidebar.appendChild(logo);
    sidebar.appendChild(nav);
    sidebar.appendChild(footer);
    return sidebar;
  },

  // ════ Helpers ═══════════════════════════════════════════════════════════

  _esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  },

  /** Create a generic element helper (re-exported for page scripts). */
  el,
  icon
};
