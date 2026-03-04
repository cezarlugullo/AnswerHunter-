const { spawnSync } = require('node:child_process');
const args = ['/c','C:\\Program Files\\nodejs\\npx.cmd','-y','@playwright/cli@latest','list'];
const r = spawnSync('cmd.exe', args, { encoding: 'utf8', timeout: 30000 });
console.log('status', r.status, 'signal', r.signal, 'err', r.error && r.error.message);
console.log('OUT', (r.stdout || '').slice(0, 500));
console.error('ERR', (r.stderr || '').slice(0, 300));
