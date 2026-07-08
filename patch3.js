const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'study', 'study-hub.css');
let css = fs.readFileSync(cssPath, 'utf8');

css = css.replace(
  /\.card-arena \{[\s\S]*?min-height: 0;\s*\}/,
  `.card-arena {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 800px;
  margin: 0 auto; /* Center it */
  position: relative;
}`
);

fs.writeFileSync(cssPath, css);
console.log('CSS patch 3 updated');
