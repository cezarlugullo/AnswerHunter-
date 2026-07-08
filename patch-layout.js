const fs = require('fs');

const splitLayoutCSS = 
/* ─── Split Layout for Simulado on Desktop ─── */
@media (min-width: 1024px) {
  .card-arena {
    max-width: 1240px;
  }
  .study-card {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    grid-template-rows: auto auto auto;
    column-gap: var(--sp-10);
    row-gap: var(--sp-6);
    width: 100%;
    align-items: start;
    padding: var(--sp-10) var(--sp-8);
  }
  .card-source {
    grid-column: 1 / 3;
    grid-row: 1;
    margin-bottom: calc(-1 * var(--sp-2));
  }
  .card-question {
    grid-column: 1;
    grid-row: 2 / 4;
    position: sticky;
    top: calc(var(--topbar-height) + 120px);
    max-height: calc(100vh - var(--topbar-height) - 180px);
    overflow-y: auto;
    padding-right: var(--sp-6);
    padding-bottom: var(--sp-6);
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
    border-bottom: none;
    margin-bottom: 0;
  }
  
  /* Add a subtle right border on the left column */
  .card-question::after {
    content: '';
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 1px;
    background: linear-gradient(to bottom, transparent, var(--color-border), transparent);
  }

  .card-question::-webkit-scrollbar {
    width: 4px;
  }
  .card-question::-webkit-scrollbar-track {
    background: transparent;
  }
  .card-question::-webkit-scrollbar-thumb {
    background-color: var(--color-border-strong);
    border-radius: 10px;
  }
  
  .card-options {
    grid-column: 2;
    grid-row: 2;
    margin-bottom: 0;
  }
  
  .card-reveal-zone {
    grid-column: 2;
    grid-row: 3;
  }
  
  .card-actions-bar {
    grid-column: 1 / 3;
    max-width: 600px;
    margin: var(--sp-6) auto 0;
  }
}
;

fs.appendFileSync('src/study/study-hub.css', '\n' + splitLayoutCSS);
console.log('Split layout patched!');
