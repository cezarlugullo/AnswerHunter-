const katex = require('./src/vendor/katex/katex.min.js');
const tex = 'f(x) = \\begin{cases} \\frac{x^3-1}{x^2-1}, & \\text{se } x \\neq 1 \\\\ a, & \\text{se } x = 1 \\end{cases}';
console.log('TEX:', tex);
try {
  katex.renderToString(tex, { throwOnError: true });
  console.log('SUCCESS');
} catch(e) {
  console.log('ERROR: ' + e.message);
}