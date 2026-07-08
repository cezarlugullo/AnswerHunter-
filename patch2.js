const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'study', 'study-hub.css');
let css = fs.readFileSync(cssPath, 'utf8');

// 1. Refine Options
css = css.replace(
  /\.card-option \{[\s\S]*?font-size: var\(--text-sm\);\s*\}/,
  `.card-option {
  padding: var(--sp-4) var(--sp-5);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  text-align: left;
  font-size: var(--text-base);
  line-height: var(--reading-line-height);
  position: relative;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}`
);

css = css.replace(
  /\.card-option:hover \{[\s\S]*?\}/,
  `.card-option:hover {
  border-color: var(--color-border-strong);
  background-color: var(--color-surface-hover);
  transform: scale(1.01) translateX(2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}`
);

// Smooth transition for general App background
css = css.replace(
  /\.app-shell \{[\s\S]*?transition: grid-template-columns[^\n]*\n\}/,
  `.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  grid-template-rows: 1fr;
  min-height: 100vh;
  background-color: var(--color-bg);
  transition: grid-template-columns var(--dur-slow) var(--ease-smooth), background-color var(--dur-base) ease;
}`
);

fs.writeFileSync(cssPath, css);
console.log('CSS patch 2 updated');
