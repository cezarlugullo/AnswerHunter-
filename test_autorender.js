const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const dom = new JSDOM(`<!DOCTYPE html><p id="test">$f(x) = \\begin{cases} \\frac{x^3-1}{x^2-1}, & \\text{se } x \\neq 1 \\\\ a, & \\text{se } x = 1 \\end{cases}$</p>`);

global.window = dom.window;
global.document = dom.window.document;
const katex = require('./src/vendor/katex/katex.min.js');
window.katex = katex;
require('./src/vendor/katex/auto-render.min.js');

const container = document.getElementById("test");

window.renderMathInElement(container, {
    delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\[', right: '\\]', display: true }
    ],
    throwOnError: false
});

console.log('Resulting HTML:', container.innerHTML);
