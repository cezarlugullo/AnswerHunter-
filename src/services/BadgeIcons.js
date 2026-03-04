/**
 * BadgeIcons.js
 * GitHub-style illustrated SVG achievement badges.
 * Each badge has a unique illustration, color palette, and personality.
 */

/* ── helper: badge frame with gradient ring + radial bg ──────────── */
function _b(id, c, inner) {
  return `<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
<defs>
<radialGradient id="${id}_bg" cx="50%" cy="38%" r="70%"><stop offset="0%" stop-color="${c.bg1}"/><stop offset="100%" stop-color="${c.bg2}"/></radialGradient>
<linearGradient id="${id}_rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c.r1}"/><stop offset="100%" stop-color="${c.r2}"/></linearGradient>
${c.extra || ''}
</defs>
<circle cx="64" cy="66" r="58" fill="rgba(0,0,0,0.12)"/>
<circle cx="64" cy="64" r="58" fill="url(#${id}_bg)"/>
<circle cx="64" cy="64" r="56" fill="none" stroke="url(#${id}_rg)" stroke-width="5"/>
<circle cx="64" cy="64" r="53" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
<path d="M34,38 Q64,18 94,38" fill="none" stroke="rgba(255,255,255,0.13)" stroke-width="2.5" stroke-linecap="round"/>
${inner}
</svg>`;
}

/* ── sparkle helper ─────────────────────────────────────────────────── */
function _spark(x, y, s = 1, op = 1) {
  return `<g transform="translate(${x},${y}) scale(${s})" opacity="${op}">
<line x1="0" y1="-4" x2="0" y2="4" stroke="#FFF" stroke-width="1.5" stroke-linecap="round"/>
<line x1="-4" y1="0" x2="4" y2="0" stroke="#FFF" stroke-width="1.5" stroke-linecap="round"/>
<line x1="-2.5" y1="-2.5" x2="2.5" y2="2.5" stroke="#FFF" stroke-width="1" stroke-linecap="round"/>
<line x1="2.5" y1="-2.5" x2="-2.5" y2="2.5" stroke="#FFF" stroke-width="1" stroke-linecap="round"/>
</g>`;
}

/* ── star path helper ───────────────────────────────────────────────── */
function _star(cx, cy, r1, r2, pts = 5, fill = '#FFD700') {
  let d = '';
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = (Math.PI / pts) * i - Math.PI / 2;
    d += (i === 0 ? 'M' : 'L') + (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
  }
  return `<polygon points="" fill="none"/><path d="${d}Z" fill="${fill}"/>`;
}

// ═══════════════════════════════════════════════════════════════════
//  25 UNIQUE BADGE ILLUSTRATIONS
// ═══════════════════════════════════════════════════════════════════

export const BADGE_ICONS = {

  /* ━━━ ONBOARDING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  // 1. Seedling — first save
  first_save: _b('fs', { bg1: '#A5D6A7', bg2: '#1B5E20', r1: '#2E7D32', r2: '#81C784' }, `
    <!-- soil -->
    <ellipse cx="64" cy="92" rx="28" ry="9" fill="#4E342E"/>
    <ellipse cx="64" cy="90" rx="26" ry="7" fill="#6D4C41"/>
    <!-- stem -->
    <path d="M64,88 Q63,72 64,55" stroke="#388E3C" stroke-width="4" fill="none" stroke-linecap="round"/>
    <!-- left leaf -->
    <path d="M64,62 Q48,48 42,52 Q46,64 64,62Z" fill="#66BB6A"/>
    <path d="M64,62 Q52,54 48,56" stroke="#388E3C" stroke-width="1" fill="none"/>
    <!-- right leaf -->
    <path d="M64,55 Q80,40 86,44 Q82,58 64,55Z" fill="#81C784"/>
    <path d="M64,55 Q76,46 80,48" stroke="#4CAF50" stroke-width="1" fill="none"/>
    <!-- dew drop -->
    <ellipse cx="52" cy="56" rx="3" ry="4" fill="rgba(255,255,255,0.5)"/>
    ${_spark(84, 38, 0.8, 0.7)}
    ${_spark(44, 42, 0.6, 0.5)}
  `),

  // 2. Open book — first review
  first_review: _b('fr', { bg1: '#FFE0B2', bg2: '#E65100', r1: '#BF360C', r2: '#FFB74D' }, `
    <!-- book body -->
    <path d="M32,80 L32,52 Q48,44 64,52 Q80,44 96,52 L96,80 Q80,72 64,80 Q48,72 32,80Z" fill="#FFF3E0" stroke="#D84315" stroke-width="1.5"/>
    <!-- spine -->
    <line x1="64" y1="52" x2="64" y2="80" stroke="#BF360C" stroke-width="2"/>
    <!-- page lines left -->
    <line x1="38" y1="58" x2="58" y2="54" stroke="#FFCC80" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="38" y1="63" x2="58" y2="59" stroke="#FFCC80" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="38" y1="68" x2="58" y2="64" stroke="#FFCC80" stroke-width="1.5" stroke-linecap="round"/>
    <!-- page lines right -->
    <line x1="70" y1="54" x2="90" y2="58" stroke="#FFCC80" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="70" y1="59" x2="90" y2="63" stroke="#FFCC80" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="70" y1="64" x2="90" y2="68" stroke="#FFCC80" stroke-width="1.5" stroke-linecap="round"/>
    <!-- glow rays -->
    <line x1="64" y1="42" x2="64" y2="30" stroke="#FFD54F" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
    <line x1="50" y1="38" x2="44" y2="28" stroke="#FFD54F" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
    <line x1="78" y1="38" x2="84" y2="28" stroke="#FFD54F" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
    ${_spark(48, 34, 0.7, 0.6)}
    ${_spark(80, 34, 0.7, 0.6)}
  `),

  // 3. Folder with star — first discipline
  first_disc: _b('fd', { bg1: '#BBDEFB', bg2: '#0D47A1', r1: '#1565C0', r2: '#64B5F6' }, `
    <!-- folder back -->
    <rect x="30" y="48" width="68" height="44" rx="4" fill="#42A5F5"/>
    <!-- folder tab -->
    <path d="M30,52 L30,44 Q30,40 34,40 L54,40 Q58,40 60,44 L62,48Z" fill="#42A5F5"/>
    <!-- folder front -->
    <rect x="30" y="54" width="68" height="38" rx="4" fill="#90CAF9"/>
    <!-- folder crease -->
    <line x1="30" y1="60" x2="98" y2="60" stroke="#64B5F6" stroke-width="1"/>
    <!-- star on folder -->
    ${_star(64, 74, 12, 5, 5, '#FFD54F')}
    <circle cx="64" cy="74" r="4" fill="#FFF9C4"/>
    ${_spark(86, 38, 0.8, 0.7)}
  `),

  /* ━━━ VOLUME ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  // 4. Treasure chest — save 10
  save_10: _b('s10', { bg1: '#B2DFDB', bg2: '#004D40', r1: '#00695C', r2: '#4DB6AC' }, `
    <!-- chest body -->
    <rect x="34" y="64" width="60" height="28" rx="4" fill="#8D6E63"/>
    <rect x="34" y="64" width="60" height="10" rx="2" fill="#A1887F"/>
    <!-- chest lid -->
    <path d="M32,66 Q32,48 64,44 Q96,48 96,66Z" fill="#6D4C41"/>
    <path d="M36,64 Q36,52 64,48 Q92,52 92,64" fill="none" stroke="#5D4037" stroke-width="1.5"/>
    <!-- lock -->
    <rect x="58" y="60" width="12" height="10" rx="2" fill="#FFD54F"/>
    <circle cx="64" cy="64" r="2.5" fill="#BF360C"/>
    <!-- gems peeking out -->
    <circle cx="48" cy="56" r="5" fill="#E53935" opacity="0.9"/>
    <circle cx="56" cy="52" r="4" fill="#43A047" opacity="0.9"/>
    <circle cx="72" cy="52" r="4" fill="#1E88E5" opacity="0.9"/>
    <circle cx="80" cy="56" r="5" fill="#AB47BC" opacity="0.9"/>
    ${_spark(44, 38, 0.7, 0.8)}
    ${_spark(84, 40, 0.6, 0.6)}
  `),

  // 5. Book stack — save 50
  save_50: _b('s50', { bg1: '#C5CAE9', bg2: '#1A237E', r1: '#283593', r2: '#7986CB' }, `
    <!-- book 1 (bottom, red) -->
    <rect x="36" y="76" width="56" height="12" rx="2" fill="#E53935"/>
    <rect x="36" y="76" width="6" height="12" rx="1" fill="#C62828"/>
    <!-- book 2 (green) -->
    <rect x="38" y="62" width="52" height="12" rx="2" fill="#43A047"/>
    <rect x="38" y="62" width="6" height="12" rx="1" fill="#2E7D32"/>
    <!-- book 3 (blue) -->
    <rect x="34" y="48" width="60" height="12" rx="2" fill="#1E88E5"/>
    <rect x="34" y="48" width="6" height="12" rx="1" fill="#1565C0"/>
    <!-- book 4 (top, purple) -->
    <rect x="40" y="34" width="48" height="12" rx="2" fill="#8E24AA"/>
    <rect x="40" y="34" width="6" height="12" rx="1" fill="#6A1B9A"/>
    <!-- page lines -->
    <line x1="46" y1="80" x2="88" y2="80" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <line x1="48" y1="66" x2="86" y2="66" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <line x1="44" y1="52" x2="90" y2="52" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <line x1="50" y1="38" x2="84" y2="38" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    ${_spark(90, 30, 0.8, 0.7)}
  `),

  // 6. Ancient scroll — save 100
  save_100: _b('s100', { bg1: '#D7CCC8', bg2: '#3E2723', r1: '#4E342E', r2: '#A1887F',
    extra: `<linearGradient id="s100_scr" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#D7CCC8"/><stop offset="15%" stop-color="#EFEBE9"/><stop offset="85%" stop-color="#EFEBE9"/><stop offset="100%" stop-color="#D7CCC8"/></linearGradient>` }, `
    <!-- scroll body -->
    <rect x="36" y="38" width="56" height="54" rx="2" fill="url(#s100_scr)"/>
    <!-- scroll top roll -->
    <ellipse cx="64" cy="38" rx="30" ry="6" fill="#BCAAA4"/>
    <ellipse cx="64" cy="38" rx="30" ry="4" fill="#D7CCC8"/>
    <!-- scroll bottom roll -->
    <ellipse cx="64" cy="92" rx="30" ry="6" fill="#BCAAA4"/>
    <ellipse cx="64" cy="92" rx="30" ry="4" fill="#D7CCC8"/>
    <!-- text lines -->
    <line x1="44" y1="50" x2="84" y2="50" stroke="#8D6E63" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <line x1="44" y1="57" x2="80" y2="57" stroke="#8D6E63" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <line x1="44" y1="64" x2="84" y2="64" stroke="#8D6E63" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <line x1="44" y1="71" x2="76" y2="71" stroke="#8D6E63" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <line x1="44" y1="78" x2="82" y2="78" stroke="#8D6E63" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <!-- wax seal -->
    <circle cx="76" cy="82" r="8" fill="#C62828"/>
    <circle cx="76" cy="82" r="5" fill="#E53935"/>
    ${_star(76, 82, 4, 2, 5, '#FFCDD2')}
  `),

  // 7. Globe with book — save 500
  save_500: _b('s500', { bg1: '#B3E5FC', bg2: '#01579B', r1: '#0277BD', r2: '#4FC3F7',
    extra: `<linearGradient id="s500_gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4FC3F7"/><stop offset="100%" stop-color="#0277BD"/></linearGradient>` }, `
    <!-- globe -->
    <circle cx="64" cy="60" r="28" fill="url(#s500_gl)"/>
    <!-- continents (simplified) -->
    <path d="M50,48 Q55,42 62,44 Q66,48 60,54 Q54,52 50,48Z" fill="#4CAF50" opacity="0.7"/>
    <path d="M68,46 Q78,44 82,52 Q80,60 72,58 Q66,54 68,46Z" fill="#4CAF50" opacity="0.7"/>
    <path d="M48,62 Q54,58 58,64 Q56,72 48,70 Q44,66 48,62Z" fill="#4CAF50" opacity="0.7"/>
    <path d="M66,64 Q74,62 78,68 Q76,76 68,74 Q62,70 66,64Z" fill="#4CAF50" opacity="0.7"/>
    <!-- latitude lines -->
    <ellipse cx="64" cy="60" rx="28" ry="10" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
    <ellipse cx="64" cy="60" rx="28" ry="20" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
    <!-- longitude -->
    <ellipse cx="64" cy="60" rx="12" ry="28" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
    <!-- globe ring -->
    <circle cx="64" cy="60" r="28" fill="none" stroke="#0288D1" stroke-width="2"/>
    <!-- stand -->
    <path d="M56,88 L64,82 L72,88" fill="none" stroke="#455A64" stroke-width="3" stroke-linecap="round"/>
    <line x1="64" y1="82" x2="64" y2="88" stroke="#455A64" stroke-width="3" stroke-linecap="round"/>
    ${_spark(40, 36, 0.7, 0.6)}
    ${_spark(88, 42, 0.8, 0.7)}
  `),

  /* ━━━ MASTERY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  // 8. Shining star — master 1
  master_1: _b('m1', { bg1: '#FFF9C4', bg2: '#F57F17', r1: '#E65100', r2: '#FFD54F',
    extra: `<radialGradient id="m1_glow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFEE58" stop-opacity="0.8"/><stop offset="100%" stop-color="#FFEE58" stop-opacity="0"/></radialGradient>` }, `
    <!-- star glow -->
    <circle cx="64" cy="62" r="30" fill="url(#m1_glow)"/>
    <!-- rays -->
    <line x1="64" y1="28" x2="64" y2="38" stroke="#FFD54F" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <line x1="64" y1="86" x2="64" y2="96" stroke="#FFD54F" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <line x1="30" y1="62" x2="40" y2="62" stroke="#FFD54F" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <line x1="88" y1="62" x2="98" y2="62" stroke="#FFD54F" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <line x1="40" y1="38" x2="46" y2="44" stroke="#FFD54F" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
    <line x1="88" y1="38" x2="82" y2="44" stroke="#FFD54F" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
    <line x1="40" y1="86" x2="46" y2="80" stroke="#FFD54F" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
    <line x1="88" y1="86" x2="82" y2="80" stroke="#FFD54F" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
    <!-- main star -->
    ${_star(64, 62, 22, 10, 5, '#FFD54F')}
    ${_star(64, 62, 16, 7, 5, '#FFF176')}
    <!-- center highlight -->
    <circle cx="62" cy="58" r="5" fill="rgba(255,255,255,0.4)"/>
  `),

  // 9. Graduation cap — master 10
  master_10: _b('m10', { bg1: '#90CAF9', bg2: '#1A237E', r1: '#0D47A1', r2: '#5C6BC0' }, `
    <!-- tassel string -->
    <path d="M64,52 L42,62 Q38,66 36,76" stroke="#FFD54F" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <!-- tassel end -->
    <rect x="32" y="76" width="8" height="10" rx="2" fill="#FFD54F"/>
    <line x1="33" y1="82" x2="39" y2="82" stroke="#FFC107" stroke-width="1"/>
    <!-- cap base (diamond shape) -->
    <polygon points="64,40 100,58 64,72 28,58" fill="#263238"/>
    <polygon points="64,40 100,58 64,54 28,58" fill="#37474F"/>
    <!-- cap top square -->
    <rect x="50" y="36" width="28" height="4" rx="1" fill="#37474F" transform="rotate(-3 64 38)"/>
    <!-- button -->
    <circle cx="64" cy="52" r="3" fill="#FFD54F"/>
    ${_spark(86, 36, 0.7, 0.6)}
  `),

  // 10. Medal with ribbon — master 50
  master_50: _b('m50', { bg1: '#E1BEE7', bg2: '#4A148C', r1: '#6A1B9A', r2: '#CE93D8',
    extra: `<linearGradient id="m50_medal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFC107"/><stop offset="100%" stop-color="#FF8F00"/></linearGradient>` }, `
    <!-- ribbon left -->
    <path d="M44,30 L54,60 L64,52" fill="#E53935"/>
    <!-- ribbon right -->
    <path d="M84,30 L74,60 L64,52" fill="#C62828"/>
    <!-- medal circle -->
    <circle cx="64" cy="72" r="22" fill="url(#m50_medal)" stroke="#F57F17" stroke-width="2"/>
    <!-- medal inner ring -->
    <circle cx="64" cy="72" r="17" fill="none" stroke="#FFE082" stroke-width="1.5"/>
    <!-- star on medal -->
    ${_star(64, 72, 12, 5, 5, '#FFF8E1')}
    <!-- medal highlight -->
    <path d="M52,62 Q56,56 64,58" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"/>
  `),

  // 11. Golden trophy — master 100
  master_100: _b('m100', { bg1: '#FFF8E1', bg2: '#E65100', r1: '#BF360C', r2: '#FFB300',
    extra: `<linearGradient id="m100_cup" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFD54F"/><stop offset="50%" stop-color="#FFC107"/><stop offset="100%" stop-color="#FF8F00"/></linearGradient>` }, `
    <!-- cup body -->
    <path d="M42,40 L44,70 Q44,80 64,82 Q84,80 84,70 L86,40Z" fill="url(#m100_cup)" stroke="#F57F17" stroke-width="1.5"/>
    <!-- cup handles -->
    <path d="M42,46 Q28,46 28,58 Q28,68 42,68" fill="none" stroke="#FFC107" stroke-width="4" stroke-linecap="round"/>
    <path d="M86,46 Q100,46 100,58 Q100,68 86,68" fill="none" stroke="#FFC107" stroke-width="4" stroke-linecap="round"/>
    <!-- cup highlight -->
    <path d="M52,44 Q54,38 58,44 L56,68" fill="rgba(255,255,255,0.25)" stroke="none"/>
    <!-- base -->
    <rect x="52" y="82" width="24" height="4" rx="2" fill="#FF8F00"/>
    <rect x="48" y="86" width="32" height="6" rx="3" fill="#FFC107"/>
    <!-- star -->
    ${_star(64, 58, 10, 4, 5, '#FFF8E1')}
    ${_spark(38, 32, 0.8, 0.7)}
    ${_spark(90, 34, 0.7, 0.6)}
  `),

  /* ━━━ STREAK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  // 12. Campfire — streak 3
  streak_3: _b('sk3', { bg1: '#FFCCBC', bg2: '#BF360C', r1: '#D84315', r2: '#FF8A65',
    extra: `<radialGradient id="sk3_glow" cx="50%" cy="70%" r="45%"><stop offset="0%" stop-color="#FFEE58" stop-opacity="0.5"/><stop offset="100%" stop-color="#FFEE58" stop-opacity="0"/></radialGradient>` }, `
    <!-- glow -->
    <circle cx="64" cy="65" r="32" fill="url(#sk3_glow)"/>
    <!-- outer flame -->
    <path d="M64,28 Q78,46 76,62 Q74,80 64,84 Q54,80 52,62 Q50,46 64,28Z" fill="#FF6D00"/>
    <!-- mid flame -->
    <path d="M64,38 Q74,50 72,64 Q70,76 64,80 Q58,76 56,64 Q54,50 64,38Z" fill="#FF9100"/>
    <!-- inner flame -->
    <path d="M64,48 Q70,56 68,66 Q66,74 64,76 Q62,74 60,66 Q58,56 64,48Z" fill="#FFD54F"/>
    <!-- core -->
    <ellipse cx="64" cy="68" rx="4" ry="6" fill="#FFF9C4"/>
    <!-- logs -->
    <rect x="40" y="82" width="48" height="6" rx="3" fill="#5D4037" transform="rotate(-8 64 85)"/>
    <rect x="40" y="82" width="48" height="6" rx="3" fill="#6D4C41" transform="rotate(8 64 85)"/>
    <!-- embers -->
    <circle cx="50" cy="42" r="1.5" fill="#FFAB00" opacity="0.8"/>
    <circle cx="78" cy="38" r="1" fill="#FFAB00" opacity="0.6"/>
    <circle cx="56" cy="34" r="1" fill="#FFD54F" opacity="0.7"/>
  `),

  // 13. Lightning bolt — streak 7
  streak_7: _b('sk7', { bg1: '#FFF9C4', bg2: '#E65100', r1: '#F57F17', r2: '#FFE082',
    extra: `<radialGradient id="sk7_glow" cx="50%" cy="50%" r="40%"><stop offset="0%" stop-color="#FFF" stop-opacity="0.4"/><stop offset="100%" stop-color="#FFF" stop-opacity="0"/></radialGradient>` }, `
    <!-- electric glow -->
    <circle cx="64" cy="62" r="28" fill="url(#sk7_glow)"/>
    <!-- bolt shadow -->
    <path d="M72,28 L54,58 L68,58 L52,96" fill="#FF8F00" opacity="0.3" transform="translate(2,2)"/>
    <!-- main bolt -->
    <path d="M72,28 L54,58 L68,58 L52,96" fill="#FFD54F" stroke="#FF8F00" stroke-width="2" stroke-linejoin="round"/>
    <!-- bolt highlight -->
    <path d="M68,34 L58,54 L66,54" fill="rgba(255,255,255,0.35)"/>
    <!-- energy sparks -->
    <circle cx="44" cy="50" r="2" fill="#FFF176" opacity="0.8"/>
    <circle cx="84" cy="68" r="2" fill="#FFF176" opacity="0.8"/>
    <circle cx="48" cy="76" r="1.5" fill="#FFEE58" opacity="0.6"/>
    <circle cx="80" cy="44" r="1.5" fill="#FFEE58" opacity="0.6"/>
    ${_spark(40, 40, 0.6, 0.5)}
    ${_spark(86, 78, 0.6, 0.5)}
  `),

  // 14. Iron dumbbell — streak 14
  streak_14: _b('sk14', { bg1: '#CFD8DC', bg2: '#263238', r1: '#37474F', r2: '#90A4AE',
    extra: `<linearGradient id="sk14_metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#B0BEC5"/><stop offset="40%" stop-color="#78909C"/><stop offset="100%" stop-color="#546E7A"/></linearGradient>` }, `
    <!-- left weight -->
    <rect x="26" y="48" width="16" height="32" rx="3" fill="url(#sk14_metal)" stroke="#455A64" stroke-width="1.5"/>
    <rect x="30" y="44" width="8" height="40" rx="2" fill="#78909C" stroke="#455A64" stroke-width="1"/>
    <!-- right weight -->
    <rect x="86" y="48" width="16" height="32" rx="3" fill="url(#sk14_metal)" stroke="#455A64" stroke-width="1.5"/>
    <rect x="90" y="44" width="8" height="40" rx="2" fill="#78909C" stroke="#455A64" stroke-width="1"/>
    <!-- bar -->
    <rect x="42" y="60" width="44" height="8" rx="4" fill="#90A4AE" stroke="#546E7A" stroke-width="1.5"/>
    <!-- bar grip lines -->
    <line x1="54" y1="61" x2="54" y2="67" stroke="#78909C" stroke-width="1"/>
    <line x1="58" y1="61" x2="58" y2="67" stroke="#78909C" stroke-width="1"/>
    <line x1="70" y1="61" x2="70" y2="67" stroke="#78909C" stroke-width="1"/>
    <line x1="74" y1="61" x2="74" y2="67" stroke="#78909C" stroke-width="1"/>
    <!-- metallic highlights -->
    <rect x="28" y="50" width="4" height="14" rx="1" fill="rgba(255,255,255,0.2)"/>
    <rect x="88" y="50" width="4" height="14" rx="1" fill="rgba(255,255,255,0.2)"/>
    ${_spark(64, 38, 0.8, 0.6)}
  `),

  // 15. Golden crown — streak 30
  streak_30: _b('sk30', { bg1: '#F3E5F5', bg2: '#4A148C', r1: '#6A1B9A', r2: '#CE93D8',
    extra: `<linearGradient id="sk30_crown" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFD54F"/><stop offset="100%" stop-color="#FF8F00"/></linearGradient>` }, `
    <!-- crown body -->
    <path d="M30,76 L34,48 L48,62 L64,38 L80,62 L94,48 L98,76Z" fill="url(#sk30_crown)" stroke="#F57F17" stroke-width="2" stroke-linejoin="round"/>
    <!-- crown base -->
    <rect x="30" y="74" width="68" height="10" rx="3" fill="#FFC107" stroke="#F57F17" stroke-width="1.5"/>
    <!-- crown base band -->
    <rect x="30" y="78" width="68" height="4" rx="2" fill="#FF8F00"/>
    <!-- gems on crown -->
    <circle cx="48" cy="66" r="5" fill="#E53935"/>
    <circle cx="48" cy="66" r="3" fill="#EF5350"/>
    <circle cx="64" cy="54" r="5" fill="#1E88E5"/>
    <circle cx="64" cy="54" r="3" fill="#42A5F5"/>
    <circle cx="80" cy="66" r="5" fill="#43A047"/>
    <circle cx="80" cy="66" r="3" fill="#66BB6A"/>
    <!-- crown tip jewels -->
    <circle cx="34" cy="48" r="3" fill="#FFD54F" stroke="#F57F17" stroke-width="1"/>
    <circle cx="64" cy="38" r="3" fill="#FFD54F" stroke="#F57F17" stroke-width="1"/>
    <circle cx="94" cy="48" r="3" fill="#FFD54F" stroke="#F57F17" stroke-width="1"/>
    <!-- highlight -->
    <path d="M38,56 L44,64" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-linecap="round"/>
    ${_spark(46, 34, 0.7, 0.6)}
    ${_spark(82, 36, 0.6, 0.5)}
  `),

  // 16. Spartan shield — streak 100
  streak_100: _b('sk100', { bg1: '#FFCDD2', bg2: '#B71C1C', r1: '#C62828', r2: '#EF5350',
    extra: `<linearGradient id="sk100_sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#E53935"/><stop offset="100%" stop-color="#B71C1C"/></linearGradient>` }, `
    <!-- shield shape -->
    <path d="M64,24 L96,38 L96,68 Q96,92 64,102 Q32,92 32,68 L32,38Z" fill="url(#sk100_sh)" stroke="#C62828" stroke-width="2"/>
    <!-- shield inner border -->
    <path d="M64,30 L90,42 L90,66 Q90,86 64,96 Q38,86 38,66 L38,42Z" fill="none" stroke="#FFB74D" stroke-width="2"/>
    <!-- shield center emblem -->
    <path d="M64,30 L90,42 L90,66 Q90,86 64,96 Q38,86 38,66 L38,42Z" fill="none"/>
    <!-- lambda/V shape -->
    <path d="M52,44 L64,82 L76,44" fill="none" stroke="#FFD54F" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- shield highlight -->
    <path d="M40,42 Q48,36 56,40" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="3" stroke-linecap="round"/>
    <!-- decorative dots -->
    <circle cx="64" cy="42" r="3" fill="#FFD54F"/>
    ${_spark(48, 28, 0.6, 0.5)}
    ${_spark(82, 30, 0.5, 0.4)}
  `),

  /* ━━━ BREADTH (Disciplines) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  // 17. Artist palette — 3 disciplines
  disc_3: _b('d3', { bg1: '#F3E5F5', bg2: '#4527A0', r1: '#512DA8', r2: '#B39DDB' }, `
    <!-- palette -->
    <path d="M38,52 Q28,68 38,82 Q50,94 74,88 Q96,82 98,66 Q100,48 84,40 Q68,32 52,38 Q42,42 38,52Z" fill="#8D6E63" stroke="#5D4037" stroke-width="2"/>
    <!-- palette hole -->
    <ellipse cx="78" cy="56" rx="6" ry="7" fill="#4527A0"/>
    <!-- paint blobs -->
    <circle cx="48" cy="52" r="7" fill="#E53935"/>
    <circle cx="42" cy="66" r="6" fill="#FFD54F"/>
    <circle cx="50" cy="78" r="6" fill="#43A047"/>
    <circle cx="64" cy="82" r="6" fill="#1E88E5"/>
    <circle cx="76" cy="76" r="6" fill="#AB47BC"/>
    <!-- paint highlights -->
    <circle cx="46" cy="50" r="2.5" fill="rgba(255,255,255,0.35)"/>
    <circle cx="40" cy="64" r="2" fill="rgba(255,255,255,0.35)"/>
    <circle cx="48" cy="76" r="2" fill="rgba(255,255,255,0.35)"/>
    <!-- brush -->
    <rect x="82" y="30" width="4" height="24" rx="2" fill="#FFE0B2" transform="rotate(25 84 42)"/>
    <path d="M80,52 Q82,62 86,52" fill="#E53935" transform="rotate(25 84 42)"/>
  `),

  // 18. Puzzle pieces — 5 disciplines
  disc_5: _b('d5', { bg1: '#E8EAF6', bg2: '#1A237E', r1: '#283593', r2: '#9FA8DA' }, `
    <!-- puzzle piece 1 (top-left, red) -->
    <path d="M34,34 L56,34 Q56,28 60,28 Q64,28 64,34 L64,42 Q58,42 58,46 Q58,50 64,50 L64,58 L34,58Z" fill="#EF5350"/>
    <!-- puzzle piece 2 (top-right, yellow) -->
    <path d="M66,34 Q66,28 70,28 Q74,28 74,34 L94,34 L94,58 L74,58 Q74,52 70,52 Q66,52 66,58 L66,50 Q72,50 72,46 Q72,42 66,42Z" fill="#FFD54F"/>
    <!-- puzzle piece 3 (bottom-left, blue) -->
    <path d="M34,60 L56,60 Q56,66 60,66 Q64,66 64,60 L64,68 Q58,68 58,72 Q58,76 64,76 L64,92 L34,92Z" fill="#42A5F5"/>
    <!-- puzzle piece 4 (bottom-right, green) -->
    <path d="M66,60 Q66,66 70,66 Q74,66 74,60 L94,60 L94,92 L66,92 L66,76 Q72,76 72,72 Q72,68 66,68Z" fill="#66BB6A"/>
    <!-- highlights -->
    <path d="M38,38 L50,38" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-linecap="round"/>
    <path d="M78,38 L88,38" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-linecap="round"/>
  `),

  // 19. Drawing compass — 10 disciplines
  disc_10: _b('d10', { bg1: '#FFF8E1', bg2: '#E65100', r1: '#BF360C', r2: '#FFCC80',
    extra: `<linearGradient id="d10_mtl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#B0BEC5"/><stop offset="100%" stop-color="#78909C"/></linearGradient>` }, `
    <!-- compass arc -->
    <path d="M38,88 A34,34 0 0,1 90,88" fill="none" stroke="#FFB74D" stroke-width="2" stroke-dasharray="4,3" opacity="0.5"/>
    <!-- left leg -->
    <line x1="64" y1="36" x2="40" y2="92" stroke="url(#d10_mtl)" stroke-width="5" stroke-linecap="round"/>
    <!-- right leg -->
    <line x1="64" y1="36" x2="88" y2="92" stroke="url(#d10_mtl)" stroke-width="5" stroke-linecap="round"/>
    <!-- pencil tip (right) -->
    <path d="M86,86 L88,92 L90,86" fill="#FFD54F"/>
    <line x1="88" y1="92" x2="88" y2="96" stroke="#333" stroke-width="1.5"/>
    <!-- needle tip (left) -->
    <line x1="40" y1="92" x2="40" y2="98" stroke="#546E7A" stroke-width="2" stroke-linecap="round"/>
    <!-- pivot joint -->
    <circle cx="64" cy="36" r="6" fill="#90A4AE" stroke="#546E7A" stroke-width="2"/>
    <circle cx="64" cy="36" r="3" fill="#CFD8DC"/>
    <!-- hinge -->
    <circle cx="64" cy="36" r="1.5" fill="#455A64"/>
    <!-- ruler marks for precision feel -->
    <line x1="50" y1="64" x2="52" y2="65" stroke="#90A4AE" stroke-width="1" opacity="0.5"/>
    <line x1="76" y1="64" x2="78" y2="65" stroke="#90A4AE" stroke-width="1" opacity="0.5"/>
    ${_spark(84, 32, 0.7, 0.6)}
  `),

  /* ━━━ ACCURACY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  // 20. Bullseye target — 10 perfect
  perfect_10: _b('p10', { bg1: '#E8F5E9', bg2: '#1B5E20', r1: '#2E7D32', r2: '#81C784' }, `
    <!-- target rings -->
    <circle cx="64" cy="64" r="32" fill="#FFFFFF" stroke="#E53935" stroke-width="3"/>
    <circle cx="64" cy="64" r="24" fill="#E53935"/>
    <circle cx="64" cy="64" r="18" fill="#FFFFFF"/>
    <circle cx="64" cy="64" r="12" fill="#E53935"/>
    <circle cx="64" cy="64" r="6" fill="#FFD54F"/>
    <!-- arrow shaft -->
    <line x1="62" y1="62" x2="36" y2="36" stroke="#5D4037" stroke-width="3" stroke-linecap="round"/>
    <!-- arrow head -->
    <polygon points="62,56 68,62 56,62" fill="#546E7A" transform="rotate(-45 60 60)"/>
    <!-- arrow end feathers -->
    <path d="M38,38 L32,32 L38,36" fill="#E53935" stroke="none"/>
    <path d="M38,38 L32,44 L36,38" fill="#FFFFFF" stroke="none"/>
    <!-- impact effect -->
    <circle cx="64" cy="64" r="3" fill="#FFF" opacity="0.6"/>
    ${_spark(64, 64, 0.5, 0.8)}
  `),

  // 21. Brilliant diamond — 25 perfect
  perfect_25: _b('p25', { bg1: '#E0F7FA', bg2: '#006064', r1: '#00838F', r2: '#4DD0E1',
    extra: `<linearGradient id="p25_dm" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#E0F7FA"/><stop offset="30%" stop-color="#80DEEA"/><stop offset="60%" stop-color="#4DD0E1"/><stop offset="100%" stop-color="#00BCD4"/></linearGradient>` }, `
    <!-- diamond shape -->
    <polygon points="64,28 88,52 64,98 40,52" fill="url(#p25_dm)" stroke="#00ACC1" stroke-width="2"/>
    <!-- top facets -->
    <polygon points="64,28 76,44 64,52 52,44" fill="rgba(255,255,255,0.3)"/>
    <!-- left facet -->
    <polygon points="40,52 52,44 64,52 52,76" fill="rgba(0,0,0,0.08)"/>
    <!-- right facet -->
    <polygon points="88,52 76,44 64,52 76,76" fill="rgba(0,0,0,0.05)"/>
    <!-- bottom facets -->
    <polygon points="64,52 52,76 64,98" fill="rgba(0,0,0,0.12)"/>
    <polygon points="64,52 76,76 64,98" fill="rgba(0,0,0,0.08)"/>
    <!-- inner lines -->
    <line x1="52" y1="44" x2="52" y2="76" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
    <line x1="76" y1="44" x2="76" y2="76" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
    <line x1="40" y1="52" x2="88" y2="52" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    <!-- sparkles -->
    ${_spark(50, 36, 0.8, 0.9)}
    ${_spark(82, 48, 0.6, 0.7)}
    ${_spark(46, 62, 0.5, 0.5)}
  `),

  /* ━━━ XP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  // 22. Bronze coin — 1K XP
  xp_1k: _b('x1k', { bg1: '#FFCCBC', bg2: '#4E342E', r1: '#5D4037', r2: '#BCAAA4',
    extra: `<radialGradient id="x1k_coin" cx="40%" cy="35%" r="65%"><stop offset="0%" stop-color="#FFAB91"/><stop offset="50%" stop-color="#D84315"/><stop offset="100%" stop-color="#BF360C"/></radialGradient>` }, `
    <!-- coin -->
    <circle cx="64" cy="64" r="30" fill="url(#x1k_coin)" stroke="#8D6E63" stroke-width="3"/>
    <!-- coin inner ring -->
    <circle cx="64" cy="64" r="24" fill="none" stroke="#FFAB91" stroke-width="1.5" opacity="0.5"/>
    <!-- "1K" text -->
    <text x="64" y="62" text-anchor="middle" dominant-baseline="middle" font-family="'Lexend',sans-serif" font-size="20" font-weight="800" fill="#FFF3E0" letter-spacing="-1">1K</text>
    <!-- laurel left -->
    <path d="M40,78 Q36,70 42,64 Q38,72 44,76Z" fill="#FFAB91" opacity="0.6"/>
    <path d="M38,82 Q32,74 38,68 Q34,76 40,80Z" fill="#FFAB91" opacity="0.5"/>
    <!-- laurel right -->
    <path d="M88,78 Q92,70 86,64 Q90,72 84,76Z" fill="#FFAB91" opacity="0.6"/>
    <path d="M90,82 Q96,74 90,68 Q94,76 88,80Z" fill="#FFAB91" opacity="0.5"/>
    <!-- XP label -->
    <text x="64" y="78" text-anchor="middle" font-family="'Lexend',sans-serif" font-size="10" font-weight="600" fill="#FFF3E0" opacity="0.8">XP</text>
    <!-- highlight -->
    <path d="M50,48 Q56,40 66,46" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2.5" stroke-linecap="round"/>
  `),

  // 23. Silver coin — 5K XP
  xp_5k: _b('x5k', { bg1: '#ECEFF1', bg2: '#37474F', r1: '#455A64', r2: '#B0BEC5',
    extra: `<radialGradient id="x5k_coin" cx="40%" cy="35%" r="65%"><stop offset="0%" stop-color="#ECEFF1"/><stop offset="50%" stop-color="#90A4AE"/><stop offset="100%" stop-color="#607D8B"/></radialGradient>` }, `
    <!-- coin -->
    <circle cx="64" cy="64" r="30" fill="url(#x5k_coin)" stroke="#78909C" stroke-width="3"/>
    <!-- coin inner ring -->
    <circle cx="64" cy="64" r="24" fill="none" stroke="#CFD8DC" stroke-width="1.5" opacity="0.5"/>
    <!-- "5K" text -->
    <text x="64" y="62" text-anchor="middle" dominant-baseline="middle" font-family="'Lexend',sans-serif" font-size="20" font-weight="800" fill="#ECEFF1" letter-spacing="-1">5K</text>
    <!-- laurel left -->
    <path d="M40,78 Q36,70 42,64 Q38,72 44,76Z" fill="#B0BEC5" opacity="0.6"/>
    <path d="M38,82 Q32,74 38,68 Q34,76 40,80Z" fill="#B0BEC5" opacity="0.5"/>
    <path d="M36,86 Q28,78 34,72 Q30,80 36,84Z" fill="#B0BEC5" opacity="0.4"/>
    <!-- laurel right -->
    <path d="M88,78 Q92,70 86,64 Q90,72 84,76Z" fill="#B0BEC5" opacity="0.6"/>
    <path d="M90,82 Q96,74 90,68 Q94,76 88,80Z" fill="#B0BEC5" opacity="0.5"/>
    <path d="M92,86 Q100,78 94,72 Q98,80 92,84Z" fill="#B0BEC5" opacity="0.4"/>
    <!-- XP label -->
    <text x="64" y="78" text-anchor="middle" font-family="'Lexend',sans-serif" font-size="10" font-weight="600" fill="#ECEFF1" opacity="0.8">XP</text>
    <!-- highlight -->
    <path d="M50,48 Q56,40 66,46" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2.5" stroke-linecap="round"/>
    ${_spark(86, 40, 0.6, 0.5)}
  `),

  // 24. Gold coin — 10K XP
  xp_10k: _b('x10k', { bg1: '#FFF8E1', bg2: '#E65100', r1: '#F57F17', r2: '#FFE082',
    extra: `<radialGradient id="x10k_coin" cx="40%" cy="35%" r="65%"><stop offset="0%" stop-color="#FFF9C4"/><stop offset="50%" stop-color="#FFC107"/><stop offset="100%" stop-color="#FF8F00"/></radialGradient>` }, `
    <!-- glow effect -->
    <circle cx="64" cy="64" r="38" fill="rgba(255,235,59,0.15)"/>
    <!-- coin -->
    <circle cx="64" cy="64" r="30" fill="url(#x10k_coin)" stroke="#F57F17" stroke-width="3"/>
    <!-- coin inner ring -->
    <circle cx="64" cy="64" r="24" fill="none" stroke="#FFE082" stroke-width="1.5"/>
    <!-- "10K" text -->
    <text x="64" y="62" text-anchor="middle" dominant-baseline="middle" font-family="'Lexend',sans-serif" font-size="18" font-weight="800" fill="#FFF8E1" letter-spacing="-1">10K</text>
    <!-- laurel left -->
    <path d="M40,78 Q36,70 42,64 Q38,72 44,76Z" fill="#FFD54F" opacity="0.7"/>
    <path d="M38,82 Q32,74 38,68 Q34,76 40,80Z" fill="#FFD54F" opacity="0.6"/>
    <path d="M36,86 Q28,78 34,72 Q30,80 36,84Z" fill="#FFD54F" opacity="0.5"/>
    <!-- laurel right -->
    <path d="M88,78 Q92,70 86,64 Q90,72 84,76Z" fill="#FFD54F" opacity="0.7"/>
    <path d="M90,82 Q96,74 90,68 Q94,76 88,80Z" fill="#FFD54F" opacity="0.6"/>
    <path d="M92,86 Q100,78 94,72 Q98,80 92,84Z" fill="#FFD54F" opacity="0.5"/>
    <!-- XP label -->
    <text x="64" y="78" text-anchor="middle" font-family="'Lexend',sans-serif" font-size="10" font-weight="600" fill="#FFF8E1">XP</text>
    <!-- highlight -->
    <path d="M50,48 Q56,40 66,46" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2.5" stroke-linecap="round"/>
    ${_spark(42, 36, 0.9, 0.9)}
    ${_spark(88, 38, 0.8, 0.8)}
    ${_spark(36, 56, 0.5, 0.5)}
    ${_spark(92, 72, 0.5, 0.5)}
  `),

  /* ━━━ SPECIAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  // 25. Night owl — Coruja Noturna
  night_owl: _b('owl', { bg1: '#3949AB', bg2: '#0D1B2A', r1: '#1A237E', r2: '#5C6BC0',
    extra: `<radialGradient id="owl_moon" cx="30%" cy="30%" r="60%"><stop offset="0%" stop-color="#FFF9C4"/><stop offset="100%" stop-color="#FFE082"/></radialGradient>` }, `
    <!-- stars -->
    <circle cx="32" cy="34" r="1.5" fill="#FFF" opacity="0.8"/>
    <circle cx="92" cy="38" r="1" fill="#FFF" opacity="0.6"/>
    <circle cx="44" cy="28" r="1" fill="#FFF" opacity="0.5"/>
    <circle cx="84" cy="28" r="1.5" fill="#FFF" opacity="0.7"/>
    <circle cx="28" cy="52" r="1" fill="#FFF" opacity="0.4"/>
    <circle cx="96" cy="56" r="1" fill="#FFF" opacity="0.5"/>
    <!-- crescent moon -->
    <circle cx="88" cy="36" r="10" fill="url(#owl_moon)"/>
    <circle cx="92" cy="32" r="8" fill="#3949AB"/>
    <!-- owl body -->
    <ellipse cx="64" cy="76" rx="22" ry="18" fill="#5D4037"/>
    <!-- owl head -->
    <circle cx="64" cy="56" r="20" fill="#6D4C41"/>
    <!-- ear tufts -->
    <path d="M48,42 L44,28 L54,40Z" fill="#5D4037"/>
    <path d="M80,42 L84,28 L74,40Z" fill="#5D4037"/>
    <!-- eye whites -->
    <circle cx="54" cy="54" r="10" fill="#FFF8E1"/>
    <circle cx="74" cy="54" r="10" fill="#FFF8E1"/>
    <!-- eye irises -->
    <circle cx="54" cy="54" r="6" fill="#FF8F00"/>
    <circle cx="74" cy="54" r="6" fill="#FF8F00"/>
    <!-- pupils -->
    <circle cx="55" cy="54" r="3.5" fill="#1A1A1A"/>
    <circle cx="75" cy="54" r="3.5" fill="#1A1A1A"/>
    <!-- eye highlights -->
    <circle cx="52" cy="52" r="2" fill="rgba(255,255,255,0.7)"/>
    <circle cx="72" cy="52" r="2" fill="rgba(255,255,255,0.7)"/>
    <!-- beak -->
    <path d="M60,62 L64,68 L68,62Z" fill="#FFB74D"/>
    <!-- chest feathers -->
    <ellipse cx="64" cy="80" rx="12" ry="10" fill="#8D6E63"/>
    <path d="M56,76 Q60,72 64,76 Q68,72 72,76" stroke="#A1887F" stroke-width="1" fill="none"/>
    <path d="M54,82 Q60,78 64,82 Q68,78 74,82" stroke="#A1887F" stroke-width="1" fill="none"/>
  `),

  // 26. Sunrise — Madrugador
  early_bird: _b('sun', { bg1: '#FFE0B2', bg2: '#E65100', r1: '#BF360C', r2: '#FFB74D',
    extra: `<radialGradient id="sun_glow" cx="50%" cy="65%" r="50%"><stop offset="0%" stop-color="#FFF9C4" stop-opacity="0.6"/><stop offset="100%" stop-color="#FFF9C4" stop-opacity="0"/></radialGradient>
<linearGradient id="sun_sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF8F00"/><stop offset="60%" stop-color="#FFB74D"/><stop offset="100%" stop-color="#FFE0B2"/></linearGradient>` }, `
    <!-- sky gradient overlay -->
    <circle cx="64" cy="64" r="52" fill="url(#sun_sky)" opacity="0.3"/>
    <!-- sun rays (behind sun) -->
    <line x1="64" y1="30" x2="64" y2="42" stroke="#FFD54F" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <line x1="40" y1="50" x2="48" y2="56" stroke="#FFD54F" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
    <line x1="88" y1="50" x2="80" y2="56" stroke="#FFD54F" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
    <line x1="34" y1="66" x2="44" y2="66" stroke="#FFD54F" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
    <line x1="94" y1="66" x2="84" y2="66" stroke="#FFD54F" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
    <line x1="46" y1="40" x2="52" y2="48" stroke="#FFD54F" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
    <line x1="82" y1="40" x2="76" y2="48" stroke="#FFD54F" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
    <!-- sun glow -->
    <circle cx="64" cy="66" r="28" fill="url(#sun_glow)"/>
    <!-- horizon line -->
    <rect x="26" y="74" width="76" height="24" rx="0" fill="#5D4037" opacity="0.3"/>
    <line x1="26" y1="74" x2="102" y2="74" stroke="#8D6E63" stroke-width="2"/>
    <!-- sun body -->
    <circle cx="64" cy="66" r="18" fill="#FFD54F"/>
    <circle cx="64" cy="66" r="14" fill="#FFEE58"/>
    <!-- sun face -->
    <circle cx="58" cy="64" r="2" fill="#FF8F00"/>
    <circle cx="70" cy="64" r="2" fill="#FF8F00"/>
    <path d="M58,70 Q64,74 70,70" fill="none" stroke="#FF8F00" stroke-width="1.5" stroke-linecap="round"/>
    <!-- hills silhouette -->
    <path d="M26,86 Q40,72 54,82 Q68,74 82,80 Q96,74 102,82 L102,98 L26,98Z" fill="#4E342E" opacity="0.5"/>
    <!-- small clouds -->
    <ellipse cx="40" cy="44" rx="8" ry="4" fill="rgba(255,255,255,0.3)"/>
    <ellipse cx="86" cy="48" rx="6" ry="3" fill="rgba(255,255,255,0.25)"/>
  `)
};
