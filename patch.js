const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'study', 'study-hub.css');
let css = fs.readFileSync(cssPath, 'utf8');

// 1. Upgrade Dark Theme
css = css.replace(
  /\[data-theme="dark"\] \{[\s\S]*?(?=\/\*)/,
  `[data-theme="dark"] {
  --color-bg: #09090b;
  --color-surface: #121214;
  --color-surface-raised: #18181b;
  --color-surface-hover: #27272a;
  --color-border: rgba(255, 255, 255, 0.08); /* Minimalist super thin border */
  --color-border-strong: rgba(255, 255, 255, 0.15);
  --color-text-primary: #ededef;
  --color-text-secondary: #a1a1aa;
  --color-text-tertiary: #71717a;
  --color-accent: #facc15; /* Neon-like Gold */
  --color-accent-light: rgba(250, 204, 21, 0.12);
  --color-accent-hover: #eab308;
  --color-accent-muted: rgba(250, 204, 21, 0.3);
  --color-accent-rgb: 250, 204, 21;
  --color-accent-text: #09090b;
  --color-accent-on-surface: #facc15;
  --color-ochre: #818cf8; /* Tech Indigo */
  --color-ochre-light: rgba(129, 140, 248, 0.15);
  --color-ochre-muted: rgba(129, 140, 248, 0.5);
  --color-success: #34d399; /* Emerald */
  --color-success-light: rgba(52, 211, 153, 0.12);
  --color-success-hover: #10b981;
  --color-warning: #fbbf24;
  --color-warning-light: rgba(251, 191, 36, 0.12);
  --color-warning-hover: #f59e0b;
  --color-error: #f87171;
  --color-error-light: rgba(248, 113, 113, 0.12);
  --color-error-hover: #ef4444;
  --color-danger: #f87171;
  --color-danger-bg: rgba(248, 113, 113, 0.12);
  --color-danger-border: rgba(248, 113, 113, 0.3);
  --color-success-bg: rgba(52, 211, 153, 0.12);
  --color-warning-bg: rgba(251, 191, 36, 0.12);
  --color-info: #60a5fa;
  --color-info-light: rgba(96, 165, 250, 0.12);
  --color-info-hover: #3b82f6;
  `
);

// 2. Refine Study Card
css = css.replace(
  /\.study-card \{[\s\S]*?box-shadow:.*?;[\s\S]*?\}/,
  `.study-card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  padding: var(--sp-8) var(--sp-6);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border); /* Thinner border for pro feel */
  border-radius: var(--radius-xl);
  flex: 1;
  min-height: 0;
  transition: transform var(--dur-base) var(--ease-smooth), box-shadow var(--dur-base) var(--ease-smooth), border-color var(--dur-base) var(--ease-smooth);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.03); /* Subtle depth */
}`
);

// 3. Make actions bar floating/glass
css = css.replace(
  /\.card-actions-bar \{[\s\S]*?width: 100%;[\s\S]*?\}/,
  `.card-actions-bar {
  display: flex;
  justify-content: space-evenly;
  flex-wrap: wrap;
  gap: var(--sp-2);
  padding: var(--sp-2);
  background: var(--color-surface);
  border-radius: 99px; /* Pill shape */
  border: 1px solid var(--color-border);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  margin-top: var(--sp-6);
  width: 100%;
  position: sticky;
  bottom: 24px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 10;
}`
);

// 4. Refine Rating Bar buttons (Bento style)
css = css.replace(
  /\.rating-btn \{[\s\S]*?cursor: pointer;[\s\S]*?\}/,
  `.rating-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-4) var(--sp-3);
  background-color: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
}`
);

css = css.replace(
  /\.rating-btn:hover \{[\s\S]*?\}/,
  `.rating-btn:hover {
  background-color: var(--color-surface-hover);
  border-color: var(--color-border-strong);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}`
);


// 5. Add a bit more spacing globally for ADHD focus
css = css.replace(
  /--reading-line-height: 1.75;/,
  `--reading-line-height: 1.8; /* Maximize ADHD readability */`
);

css = css.replace(
  /--reading-letter-spacing: 0.012em;/,
  `--reading-letter-spacing: 0.015em;`
);


fs.writeFileSync(cssPath, css);
console.log('CSS updated');
