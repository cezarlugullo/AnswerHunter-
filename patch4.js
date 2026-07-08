const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'study', 'study-hub.css');
let css = fs.readFileSync(cssPath, 'utf8');

// 1. Topbar Glassmorphism
css = css.replace(
  /\.topbar \{[\s\S]*?z-index: var\(--z-sticky\);\s*\}/,
  `.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--topbar-height);
  padding: 0 var(--sp-6);
  background-color: rgba(var(--color-surface-rgb), 0.7);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
}`
);

// We need to inject --color-surface-rgb into light theme and dark theme because rgba() needs the rgb values
// Let's add them via regex. We already know dark theme base variables.
// Actually, it's safer to just dynamically find the topbar replace point, let's omit the rgba if we are not sure surface-rgb is defined.

// Let's just create a generic replace for topbar to use transparency if possible.
// Wait, the user already uses color variables. We can use color-mix(in srgb, var(--color-surface) 80%, transparent) which works in modern CSS!

css = css.replace(
  /\.topbar \{[\s\S]*?z-index: var\(--z-sticky\);\s*\}/,
  `.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--topbar-height);
  padding: 0 var(--sp-6);
  background-color: color-mix(in srgb, var(--color-surface) 80%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
}`
);

fs.writeFileSync(cssPath, css);
console.log('CSS patch 4 updated');
