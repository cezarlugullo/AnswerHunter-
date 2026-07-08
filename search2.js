const https = require('https');
const url = 'https://html.duckduckgo.com/html/?q="cloudcode-pa.googleapis.com" "thinkingBudget"';
const options = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } };
https.get(url, options, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const urls = [...data.matchAll(/<a class="result__url" href="([^"]+)">/g)].map(m => m[1]);
    const snippets = [...data.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/gs)].map(m => m[1]);
    for(let i=0; i<Math.min(urls.length, 5); i++) {
      console.log('URL:', decodeURIComponent(urls[i].split('uddg=')[1].split('&')[0]));
      console.log('SNIPPET:', snippets[i].trim().replace(/\n/g, ' '));
      console.log('---');
    }
  });
}).on('error', e => console.error(e));
