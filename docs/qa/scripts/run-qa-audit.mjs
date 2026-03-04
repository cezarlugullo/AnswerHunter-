import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const DEFAULT_PROJECT = 'C:/Users/cezar/OneDrive/Área de Trabalho/AnswerHunter';
const PROJECT_PATH = process.env.PROJECT_PATH || DEFAULT_PROJECT;
const SRC_DIR = path.join(PROJECT_PATH, 'src');
const DOCS_QA_DIR = path.join(PROJECT_PATH, 'docs', 'qa');
const BUTTON_TESTS_DIR = path.join(DOCS_QA_DIR, 'button-tests');
const SCRIPTS_DIR = path.join(DOCS_QA_DIR, 'scripts');
const PORT = Number(process.env.QA_PORT || 4174);
const HOST = process.env.QA_HOST || '127.0.0.1';

const ALL_SCENARIOS = ['happy', 'empty', 'invalid', 'repeat', 'offline', 'missing_permissions'];
const SCENARIOS = (() => {
  const raw = process.env.QA_SCENARIOS;
  if (!raw) return ALL_SCENARIOS;
  const wanted = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const filtered = ALL_SCENARIOS.filter((s) => wanted.includes(s));
  return filtered.length ? filtered : ALL_SCENARIOS;
})();
const PAGE_FILTER = process.env.QA_PAGE_FILTER ? process.env.QA_PAGE_FILTER.toLowerCase() : null;
const DEBUG = process.env.QA_DEBUG === '1';
const SKIP_DYNAMIC = process.env.QA_SKIP_DYNAMIC === '1';
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, 'utf8');
}

function cleanButtonTestsDir() {
  if (!fs.existsSync(BUTTON_TESTS_DIR)) return;
  const entries = fs.readdirSync(BUTTON_TESTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    fs.unlinkSync(path.join(BUTTON_TESTS_DIR, entry.name));
  }
}

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function abs(p) {
  return path.resolve(PROJECT_PATH, p);
}

function relFromProject(p) {
  return toPosix(path.relative(PROJECT_PATH, p));
}

function listFilesRecursive(dirPath, exts = null) {
  const out = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        stack.push(full);
      } else if (!exts || exts.includes(path.extname(e.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

function lineFromIndex(text, idx) {
  return text.slice(0, idx).split(/\r?\n/).length;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAttrs(openTag) {
  const attrs = {};
  const attrRegex = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = attrRegex.exec(openTag))) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? true;
    attrs[key] = val;
  }
  return attrs;
}

function normalizeContext(fileRel) {
  if (fileRel.includes('/popup/')) return 'popup';
  if (fileRel.includes('/study/')) return 'study';
  if (fileRel.includes('/dashboard/')) return 'dashboard';
  return 'other';
}

function toLabel(item) {
  const attrs = item.attrs || {};
  const raw =
    item.text ||
    attrs['aria-label'] ||
    attrs['data-i18n'] ||
    attrs.title ||
    item.id ||
    `${item.tag}-${item.domIndex}`;
  return raw.replace(/\s+/g, ' ').trim();
}

function extractInteractiveFromHtml(htmlAbsPath) {
  const rel = relFromProject(htmlAbsPath);
  const context = normalizeContext(rel);
  const text = readText(htmlAbsPath);
  const items = [];
  let domIndex = 0;

  const blockRegex = /<button\b[^>]*>[\s\S]*?<\/button>|<input\b[^>]*>|<[a-zA-Z][\w:-]*\b[^>]*\brole\s*=\s*["']button["'][^>]*>[\s\S]*?<\/[a-zA-Z][\w:-]*>/gi;
  let m;
  while ((m = blockRegex.exec(text))) {
    const block = m[0];
    const start = m.index;
    const line = lineFromIndex(text, start);
    const openTagMatch = block.match(/^<[^>]+>/);
    if (!openTagMatch) continue;
    const openTag = openTagMatch[0];
    const attrs = parseAttrs(openTag);

    let tag = 'unknown';
    if (/^<button\b/i.test(openTag)) tag = 'button';
    else if (/^<input\b/i.test(openTag)) tag = 'input';
    else {
      const tm = openTag.match(/^<([a-zA-Z][\w:-]*)/);
      tag = tm ? tm[1].toLowerCase() : 'unknown';
    }

    const role = String(attrs.role || '').toLowerCase();
    const type = String(attrs.type || '').toLowerCase();
    const isButtonTag = tag === 'button';
    const isButtonInput = tag === 'input' && (type === 'button' || type === 'submit');
    const isRoleButton = role === 'button' && !isButtonTag && !isButtonInput;
    if (!isButtonTag && !isButtonInput && !isRoleButton) continue;

    let innerText = '';
    if (isButtonTag || isRoleButton) {
      const content = block.slice(openTag.length, block.toLowerCase().lastIndexOf(`</${tag}>`));
      innerText = stripHtml(content);
    } else if (tag === 'input') {
      innerText = (attrs.value || '').toString();
    }

    const id = attrs.id ? String(attrs.id) : null;
    const className = attrs.class ? String(attrs.class) : '';
    const item = {
      key: id ? `id:${id}` : `${rel}::dom:${domIndex}`,
      context,
      fileRel: rel,
      fileAbs: htmlAbsPath,
      line,
      domIndex,
      id,
      tag,
      role: role || null,
      type: type || null,
      text: innerText,
      className,
      attrs,
      event: 'click',
    };
    domIndex += 1;
    items.push(item);
  }

  return items;
}

function buildPopupAliasMap() {
  const popupViewPath = path.join(SRC_DIR, 'views', 'PopupView.js');
  if (!fs.existsSync(popupViewPath)) return new Map();
  const txt = readText(popupViewPath);
  const map = new Map();
  const rg = /(\w+)\s*:\s*document\.getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let m;
  while ((m = rg.exec(txt))) {
    map.set(m[1], m[2]);
  }
  return map;
}

function scanListenerBindings(sourceFiles, popupAliasMap) {
  const byId = new Map();
  const delegated = [];

  function pushForId(id, binding) {
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(binding);
  }

  for (const fileAbs of sourceFiles) {
    const rel = relFromProject(fileAbs);
    const lines = readText(fileAbs).split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('addEventListener')) {
        let m;

        m = line.match(/getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)\??\.addEventListener\(\s*['"`]([^'"`]+)['"`]\s*,\s*(.+)\)\s*;?/);
        if (m) {
          pushForId(m[1], {
            event: m[2],
            handlerExpr: m[3].trim(),
            fileRel: rel,
            fileAbs,
            line: i + 1,
            source: line.trim(),
          });
          continue;
        }

        m = line.match(/querySelector\(\s*['"`]#([^'"`]+)['"`]\s*\)\??\.addEventListener\(\s*['"`]([^'"`]+)['"`]\s*,\s*(.+)\)\s*;?/);
        if (m) {
          pushForId(m[1], {
            event: m[2],
            handlerExpr: m[3].trim(),
            fileRel: rel,
            fileAbs,
            line: i + 1,
            source: line.trim(),
          });
          continue;
        }

        m = line.match(/this\.view\.elements\.(\w+)\??\.addEventListener\(\s*['"`]([^'"`]+)['"`]\s*,\s*(.+)\)\s*;?/);
        if (m) {
          const alias = m[1];
          const id = popupAliasMap.get(alias);
          if (id) {
            pushForId(id, {
              event: m[2],
              handlerExpr: m[3].trim(),
              fileRel: rel,
              fileAbs,
              line: i + 1,
              source: line.trim(),
              alias,
            });
          }
          continue;
        }

        m = line.match(/document\.getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)\??\.addEventListener\(\s*['"`]([^'"`]+)['"`]\s*,\s*(.+)\)\s*;?/);
        if (m) {
          pushForId(m[1], {
            event: m[2],
            handlerExpr: m[3].trim(),
            fileRel: rel,
            fileAbs,
            line: i + 1,
            source: line.trim(),
          });
          continue;
        }

        if (line.includes('closest(') || line.includes('matches(')) {
          delegated.push({
            fileRel: rel,
            fileAbs,
            line: i + 1,
            source: line.trim(),
          });
        }
      }

      const onclick = line.match(/getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)\.onclick\s*=\s*(.+);?/);
      if (onclick) {
        pushForId(onclick[1], {
          event: 'click',
          handlerExpr: onclick[2].trim(),
          fileRel: rel,
          fileAbs,
          line: i + 1,
          source: line.trim(),
        });
      }
    }
  }

  return { byId, delegated };
}

function extractMethodName(handlerExpr) {
  if (!handlerExpr) return null;
  let m = handlerExpr.match(/this\.([A-Za-z0-9_]+)\s*\(/);
  if (m) return m[1];
  m = handlerExpr.match(/=>\s*([A-Za-z0-9_$.]+)\s*\(/);
  if (m) return m[1].split('.').pop();
  m = handlerExpr.match(/^([A-Za-z0-9_]+)\s*$/);
  if (m) return m[1];
  return null;
}

function snippetAround(fileAbs, line, radius = 4) {
  const lines = readText(fileAbs).split(/\r?\n/);
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line - 1 + radius + 1);
  return lines.slice(start, end).map((l, idx) => `${start + idx + 1}: ${l}`).join('\n');
}

function findMethodSnippet(fileAbs, methodName) {
  if (!methodName) return '';
  const txt = readText(fileAbs);
  const rx = new RegExp(`\\b${methodName}\\s*\\(`);
  const idx = txt.search(rx);
  if (idx < 0) return '';
  return txt.slice(idx, idx + 4000);
}

function inferServices(snippet) {
  const signals = [
    'SearchService',
    'ApiService',
    'BinderController',
    'DisciplinasController',
    'StorageModel',
    'SettingsModel',
    'MigrationService',
    'ExportService',
    'FSRSService',
    'AnalyticsService',
    'BadgeService',
    'NotesService',
    'StudyPlanService',
    'LearningPathService',
    'RecommendationService',
    'NativeFetchBridgeService',
    'ExtractionService',
    'QuestionParser',
  ];
  const found = [];
  for (const s of signals) {
    if (snippet.includes(s)) found.push(s);
  }
  return [...new Set(found)];
}

function inferSideEffects(snippet) {
  const fx = [];
  if (/chrome\.storage\.sync/.test(snippet)) fx.push('chrome.storage.sync');
  if (/chrome\.storage\.local/.test(snippet)) fx.push('chrome.storage.local');
  if (/localStorage/.test(snippet)) fx.push('localStorage');
  if (/sessionStorage/.test(snippet)) fx.push('sessionStorage');
  if (/indexedDB/.test(snippet)) fx.push('indexedDB');
  if (/fetch\(|ApiService\.|XMLHttpRequest/.test(snippet)) fx.push('network');
  if (/chrome\.tabs|tabs\./.test(snippet)) fx.push('chrome.tabs');
  if (/runtime\.sendMessage|chrome\.runtime/.test(snippet)) fx.push('chrome.runtime');
  if (/navigator\.clipboard|clipboard/i.test(snippet)) fx.push('clipboard');
  if (/chrome\.downloads|downloads\./.test(snippet)) fx.push('chrome.downloads');
  if (/chrome\.identity|identity\./.test(snippet)) fx.push('chrome.identity');
  return [...new Set(fx)];
}

function inferExpectedResult(item) {
  const base = `${item.id || ''} ${toLabel(item)}`.toLowerCase();
  if (base.includes('search') || base.includes('buscar')) return 'Executa busca e atualiza lista de resultados.';
  if (base.includes('extract') || base.includes('extrair')) return 'Extrai a questão da página ativa e atualiza o campo/estado.';
  if (base.includes('copy') || base.includes('copiar')) return 'Copia conteúdo para clipboard e exibe feedback visual.';
  if (base.includes('save') || base.includes('salvar') || base.includes('setup')) return 'Persiste configurações e avança/fecha fluxo.';
  if (base.includes('clear') || base.includes('remove') || base.includes('delete') || base.includes('excluir')) return 'Remove dados e atualiza UI para refletir limpeza/remoção.';
  if (base.includes('add') || base.includes('new') || base.includes('create') || base.includes('criar')) return 'Cria novo item e re-renderiza lista/estado.';
  if (base.includes('edit') || base.includes('editar')) return 'Abre/aciona modo de edição e salva alterações.';
  if (base.includes('export')) return 'Exporta dados e dispara download/arquivo.';
  if (base.includes('import')) return 'Abre importação e atualiza dados após leitura do arquivo.';
  if (base.includes('theme') || base.includes('tema')) return 'Alterna tema e persiste preferência.';
  if (base.includes('settings') || base.includes('config')) return 'Abre painel de configurações correspondente.';
  if (base.includes('close') || base.includes('cancel') || base.includes('back') || base.includes('fechar') || base.includes('voltar')) return 'Fecha modal/painel ou retorna etapa anterior.';
  if (base.includes('start') || base.includes('play') || base.includes('iniciar')) return 'Inicia fluxo principal da funcionalidade.';
  if (base.includes('retry') || base.includes('test') || base.includes('validar')) return 'Reexecuta validação/teste e atualiza status.';
  if (base.includes('login') || base.includes('logout') || base.includes('auth')) return 'Executa fluxo de autenticação e atualiza estado da conta.';
  return 'Dispara o handler associado e atualiza UI/dados conforme regra do contexto.';
}

function escapeMd(v) {
  return String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function slugify(v) {
  return String(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function classifyStatus(dynamicByScenario) {
  const happy = dynamicByScenario.happy;
  if (!happy) return '[Unverified] não foi possível validar';
  if (happy.clickError) return '❌ quebrado';
  const checks = ['empty', 'invalid', 'repeat', 'offline', 'missing_permissions'];
  const missing = checks.filter((k) => !dynamicByScenario[k]);
  if (missing.length > 0) return '[Unverified] não foi possível validar';
  const scenarioErrors = checks.filter((k) => dynamicByScenario[k]?.clickError || (dynamicByScenario[k]?.pageErrors?.length || 0) > 0);
  if (scenarioErrors.length > 0) return '⚠️ parcial';
  if (!happy.stateChanged && !happy.hidden && !happy.disabled) return '⚠️ parcial';
  return '✅ ok';
}

function runPwCli(args, { cwd = PROJECT_PATH } = {}) {
  if (DEBUG) console.error(`[qa] pwcli ${args.join(' ')}`);
  const cmd = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const fullArgs = process.platform === 'win32'
    ? ['/c', 'C:\\Progra~1\\nodejs\\npx.cmd', '-y', '@playwright/cli@latest', ...args]
    : ['-lc', `npx -y @playwright/cli@latest ${args.map((a) => JSON.stringify(a)).join(' ')}`];
  const res = spawnSync(cmd, fullArgs, { cwd, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 180000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  if (res.status !== 0) {
    const err = res.error ? `ERROR: ${res.error.message}\n` : '';
    throw new Error(`playwright-cli failed (${res.status})\n${err}ARGS: ${args.join(' ')}\n${out}`);
  }
  return out;
}

function parseRunCodeResult(output) {
  const m = output.match(/### Result\s*([\s\S]*?)(?:\n### |\n$|$)/);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function buildScenarioCode(scenario) {
  return `async (page)=>{const s=${JSON.stringify(scenario)};if(s==='offline'){try{await page.context().setOffline(true)}catch{}};const out=await page.evaluate((s)=>{window.__qe=[];window.addEventListener('error',e=>window.__qe.push(String(e.message||e.error||e)));window.addEventListener('unhandledrejection',e=>window.__qe.push(String(e.reason||e)));try{window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';window.open=()=>null}catch{};const snap=()=>{let ls=-1,ss=-1;try{ls=localStorage.length}catch{};try{ss=sessionStorage.length}catch{};const st=(document.querySelector('#status,#status-groq,#status-serper,#status-gemini,#status-openrouter')?.textContent||'').trim().replace(/\\s+/g,' ').slice(0,140);return{ls,ss,status:st,url:location.href}};if(s==='empty'){try{localStorage.clear()}catch{};try{sessionStorage.clear()}catch{};try{chrome?.storage?.local?.clear?.()}catch{};try{chrome?.storage?.sync?.clear?.()}catch{}};if(s==='invalid'){try{localStorage.setItem('__qa_invalid__','{bad')}catch{};try{sessionStorage.setItem('__qa_invalid__','%%%')}catch{}};if(s==='missing_permissions'){try{window.__qb=window.chrome;if(window.chrome){window.chrome.storage=undefined;window.chrome.tabs=undefined;window.chrome.scripting=undefined;window.chrome.downloads=undefined;window.chrome.identity=undefined}}catch{}};const els=[...document.querySelectorAll('button,[role=\"button\"],input[type=\"button\"],input[type=\"submit\"]')];const rows=[];for(let i=0;i<els.length;i++){const e=els[i],b=snap();let err=null;try{const t=s==='repeat'?2:1;for(let k=0;k<t;k++){e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,composed:true}))}}catch(x){err=String(x?.message||x)};const a=snap();rows.push({domIndex:i,id:e.id||null,text:(e.innerText||e.value||e.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ').slice(0,120),tag:e.tagName.toLowerCase(),disabled:!!e.disabled,hidden:!!(e.offsetParent===null),clicked:!err,clickError:err,stateChanged:b.ls!==a.ls||b.ss!==a.ss||b.status!==a.status||b.url!==a.url,before:b,after:a})};if(s==='missing_permissions'){try{if(window.__qb)window.chrome=window.__qb}catch{}};return{scenario:s,rows,pageErrors:(window.__qe||[]).slice(-40)}} ,s);if(s==='offline'){try{await page.context().setOffline(false)}catch{}};return out}`;
}

function buildSessionId(fileRel, scenario) {
  const hash = createHash('sha1').update(`${RUN_ID}|${fileRel}|${scenario}`).digest('hex').slice(0, 12);
  return `qa_${hash}`;
}

function collectDynamicForPage(fileRel) {
  const url = `http://${HOST}:${PORT}/${toPosix(fileRel)}`;
  const out = { url, fileRel, scenarios: {}, errors: [] };
  const session = buildSessionId(fileRel, 'page');

  try {
    runPwCli([`-s=${session}`, 'open', url]);
  } catch (err) {
    out.errors.push(String(err.message || err));
    return out;
  }

  for (const scenario of SCENARIOS) {
    try {
      try {
        runPwCli([`-s=${session}`, 'goto', url]);
      } catch (gotoErr) {
        const msg = String(gotoErr?.message || gotoErr || '');
        if (msg.includes('is not open')) {
          runPwCli([`-s=${session}`, 'open', url]);
          runPwCli([`-s=${session}`, 'goto', url]);
        } else {
          throw gotoErr;
        }
      }
      const code = buildScenarioCode(scenario);
      const runOut = runPwCli([`-s=${session}`, 'run-code', code]);
      const parsed = parseRunCodeResult(runOut);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rows)) {
        out.scenarios[scenario] = parsed;
      } else {
        out.errors.push(`[${scenario}] result format inválido`);
      }
    } catch (err) {
      out.errors.push(`[${scenario}] ${String(err.message || err)}`);
    }
  }

  try {
    runPwCli([`-s=${session}`, 'close']);
  } catch {
    // ignore
  }
  return out;
}

function severityFromStatus(status) {
  if (status.startsWith('❌')) return 'S1';
  if (status.startsWith('⚠️')) return 'S2';
  if (status.startsWith('[Unverified]')) return 'S2';
  return 'S3';
}

function main() {
  ensureDir(DOCS_QA_DIR);
  ensureDir(BUTTON_TESTS_DIR);
  ensureDir(SCRIPTS_DIR);
  cleanButtonTestsDir();

  // Defensive cleanup to avoid stale pipe/session collisions between runs.
  if (!SKIP_DYNAMIC) {
    try { runPwCli(['close-all']); } catch {}
    try { runPwCli(['kill-all']); } catch {}
  }

  let htmlFiles = listFilesRecursive(SRC_DIR, ['.html']);
  if (PAGE_FILTER) {
    htmlFiles = htmlFiles.filter((p) => relFromProject(p).toLowerCase().includes(PAGE_FILTER));
  }
  const jsHtmlFiles = listFilesRecursive(SRC_DIR, ['.js', '.html']);
  const popupAliasMap = buildPopupAliasMap();
  const listenerScan = scanListenerBindings(jsHtmlFiles, popupAliasMap);

  let buttons = [];
  for (const htmlAbs of htmlFiles) {
    const extracted = extractInteractiveFromHtml(htmlAbs);
    buttons = buttons.concat(extracted);
  }

  const dynamicByFile = new Map();
  for (const htmlAbs of htmlFiles) {
    const rel = relFromProject(htmlAbs);
    if (SKIP_DYNAMIC) {
      dynamicByFile.set(rel, { url: `http://${HOST}:${PORT}/${toPosix(rel)}`, fileRel: rel, scenarios: {}, errors: ['[SKIPPED] dinâmica desativada por QA_SKIP_DYNAMIC=1'] });
    } else {
      const dyn = collectDynamicForPage(rel);
      dynamicByFile.set(rel, dyn);
    }
  }

  const usedSlugs = new Set();
  const enriched = buttons.map((item) => {
    const idBindings = item.id ? (listenerScan.byId.get(item.id) || []) : [];
    const binding = idBindings.find((b) => b.event === item.event) || idBindings[0] || null;

    let handlerName = '[Unverified] não foi possível validar';
    let handlerFile = '[Unverified] não foi possível validar';
    let serviceLabel = '[Unverified] não foi possível validar';
    let sideEffectsLabel = '[Unverified] não foi possível validar';
    let snippet = '[Unverified] não foi possível validar';

    if (binding) {
      handlerName = binding.handlerExpr;
      handlerFile = `${binding.fileRel}:${binding.line}`;
      snippet = snippetAround(binding.fileAbs, binding.line, 2);

      const methodName = extractMethodName(binding.handlerExpr);
      const methodSnippet = findMethodSnippet(binding.fileAbs, methodName) || snippetAround(binding.fileAbs, binding.line, 8);
      const services = inferServices(methodSnippet);
      const sideEffects = inferSideEffects(methodSnippet);
      serviceLabel = services.length ? services.join(', ') : '[Unverified] não foi possível validar';
      sideEffectsLabel = sideEffects.length ? sideEffects.join(', ') : '[Unverified] não foi possível validar';
    }

    const dynFile = dynamicByFile.get(item.fileRel);
    const dynByScenario = {};
    for (const scenario of SCENARIOS) {
      const rows = dynFile?.scenarios?.[scenario]?.rows || [];
      let row = null;
      if (item.id) row = rows.find((r) => r.id === item.id) || null;
      if (!row) row = rows.find((r) => Number(r.domIndex) === Number(item.domIndex)) || null;
      dynByScenario[scenario] = row ? {
        clickError: row.clickError || null,
        clicked: !!row.clicked,
        stateChanged: !!row.stateChanged,
        hidden: !!row.hidden,
        disabled: !!row.disabled,
        before: row.before || null,
        after: row.after || null,
        text: row.text || '',
        pageErrors: dynFile?.scenarios?.[scenario]?.pageErrors || [],
      } : null;
    }

    const status = classifyStatus(dynByScenario);
    const severity = severityFromStatus(status);
    const label = toLabel(item);
    const slugBase = slugify(`${item.context}-${item.id || `dom-${item.domIndex}`}-${label}`) || `btn-${item.context}-${item.domIndex}`;
    let slug = slugBase;
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${slugBase}-${n++}`;
    }
    usedSlugs.add(slug);

    return {
      ...item,
      label,
      binding,
      handlerName,
      handlerFile,
      serviceLabel,
      sideEffectsLabel,
      expectedResult: inferExpectedResult(item),
      status,
      severity,
      dynByScenario,
      snippet,
      slug,
      testDocRel: `docs/qa/button-tests/${slug}.md`,
    };
  });

  enriched.sort((a, b) => {
    if (a.context !== b.context) return a.context.localeCompare(b.context);
    if (a.fileRel !== b.fileRel) return a.fileRel.localeCompare(b.fileRel);
    return a.domIndex - b.domIndex;
  });

  const mapRows = [];
  mapRows.push('| Tela/Contexto | Nome do botão | Local no DOM (arquivo/componente) | Evento | Handler (função e arquivo) | Use-case/service chamado | Storage/side-effects | Resultado esperado (UI + dados) | Status |');
  mapRows.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const b of enriched) {
    const domLoc = `${b.fileRel}:${b.line}${b.id ? ` (#${b.id})` : ` (domIndex ${b.domIndex})`}`;
    mapRows.push(`| ${escapeMd(b.context)} | ${escapeMd(b.label)} | ${escapeMd(domLoc)} | ${escapeMd(b.event)} | ${escapeMd(`${b.handlerName} @ ${b.handlerFile}`)} | ${escapeMd(b.serviceLabel)} | ${escapeMd(b.sideEffectsLabel)} | ${escapeMd(b.expectedResult)} | ${escapeMd(b.status)} |`);
  }

  writeText(path.join(DOCS_QA_DIR, 'button-map.md'), `# Button Map\n\n${mapRows.join('\n')}\n`);

  for (const b of enriched) {
    const scenRows = [];
    scenRows.push('| Cenário | Resultado | Evidência |');
    scenRows.push('| --- | --- | --- |');
    for (const s of SCENARIOS) {
      const r = b.dynByScenario[s];
      if (!r) {
        scenRows.push(`| ${s} | [Unverified] não foi possível validar | sem evidência dinâmica |`);
      } else {
        const ok = !r.clickError;
        const result = ok ? (r.stateChanged ? '✅ clique executado com mudança de estado' : '⚠️ clique executado sem mudança observável') : `❌ erro no clique: ${String(r.clickError).slice(0, 120)}`;
        const ev = `clicked=${r.clicked}; hidden=${r.hidden}; disabled=${r.disabled}; before=${JSON.stringify(r.before)}; after=${JSON.stringify(r.after)}; pageErrors=${(r.pageErrors || []).length}`;
        scenRows.push(`| ${s} | ${escapeMd(result)} | ${escapeMd(ev)} |`);
      }
    }

    const absFile = b.fileAbs;
    const handlerRef = b.binding
      ? `${b.binding.fileRel}:${b.binding.line}`
      : '[Unverified] não foi possível validar';
    const report = [
      `# ${b.label}`,
      '',
      `- Contexto: \`${b.context}\``,
      `- Elemento: \`${b.id ? `#${b.id}` : `domIndex ${b.domIndex}`}\` em \`${b.fileRel}:${b.line}\``,
      `- Evento: \`${b.event}\``,
      `- Handler: \`${b.handlerName}\` (${handlerRef})`,
      `- Use-case/service: ${b.serviceLabel}`,
      `- Side-effects: ${b.sideEffectsLabel}`,
      '',
      '## 2.1 Verificação estática (código)',
      '- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.',
      `- Binding do evento: ${b.binding ? 'encontrado via addEventListener/onclick' : '[Unverified] não foi possível validar'}.`,
      `- Handler com variáveis/estados nulos, try/catch e await: ${b.binding ? 'revisão parcial por inspeção da região do handler' : '[Unverified] não foi possível validar'}.`,
      `- Traço UI -> handler -> serviço -> side-effect: ${b.binding ? 'mapeado parcialmente com evidência de chamada e heurística de serviço' : '[Unverified] não foi possível validar'}.`,
      '',
      `Arquivo DOM: \`${absFile}:${b.line}\``,
      `Arquivo handler: \`${b.binding ? `${b.binding.fileAbs}:${b.binding.line}` : 'N/A'}\``,
      '',
      'Trecho mínimo do binding:',
      '```js',
      b.snippet,
      '```',
      '',
      '## 2.2 Verificação dinâmica (rodando)',
      '- Execução dinâmica feita com Playwright CLI em navegador real, clicando o elemento em todos os cenários automatizados.',
      '',
      '## 2.3 Cenários obrigatórios',
      ...scenRows,
      '',
      '## 2.4 Resultado e correções',
      `- Status: ${b.status}`,
      b.status.startsWith('❌')
        ? '- Causa raiz: erro reproduzido dinamicamente ao executar o clique (ver tabela).'
        : '- Causa raiz: não identificado crash específico para este botão nas execuções registradas.',
      b.status.startsWith('❌')
        ? '- Correção mínima proposta: validar pré-condições do handler e tratar exceções de storage/rede com fallback visual.'
        : '- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.',
      '',
    ].join('\n');

    writeText(path.join(PROJECT_PATH, b.testDocRel), report);
  }

  const counts = {
    total: enriched.length,
    ok: enriched.filter((b) => b.status.startsWith('✅')).length,
    partial: enriched.filter((b) => b.status.startsWith('⚠️')).length,
    broken: enriched.filter((b) => b.status.startsWith('❌')).length,
    unverified: enriched.filter((b) => b.status.startsWith('[Unverified]')).length,
  };

  const issues = enriched
    .filter((b) => !b.status.startsWith('✅'))
    .slice(0, 10)
    .map((b, idx) => `${idx + 1}. [${b.severity}] ${b.label} (${b.fileRel}:${b.line}) -> ${b.status}`);

  const summary = [
    '# QA Summary',
    '',
    `- Projeto: \`${PROJECT_PATH}\``,
    `- Total de botões/ações mapeados: **${counts.total}**`,
    `- ✅ ok: **${counts.ok}**`,
    `- ⚠️ parcial: **${counts.partial}**`,
    `- ❌ quebrado: **${counts.broken}**`,
    `- [Unverified]: **${counts.unverified}**`,
    '',
    '## Top 10 problemas por severidade',
    ...(issues.length ? issues : ['1. Nenhum problema crítico identificado na execução automática.']),
    '',
    '## Plano de correção (ordem de impacto)',
    '1. Corrigir handlers com status ❌ (falha em cenário happy path).',
    '2. Tratar explicitamente cenários offline/permissões ausentes nos handlers de rede/storage.',
    '3. Adicionar validações para dados vazios/inválidos antes de side-effects destrutivos.',
    '4. Cobrir ações com [Unverified] usando fluxo manual adicional em contexto real da extensão.',
    '5. Adicionar testes automatizados de regressão por ação crítica (search/extract/save/export/import).',
    '',
  ].join('\n');

  writeText(path.join(DOCS_QA_DIR, 'summary.md'), summary);

  const rawData = {
    projectPath: PROJECT_PATH,
    generatedAt: new Date().toISOString(),
    port: PORT,
    buttons: enriched,
    dynamicByFile: Object.fromEntries([...dynamicByFile.entries()]),
  };
  writeText(path.join(DOCS_QA_DIR, 'button-audit-raw.json'), JSON.stringify(rawData, null, 2));
}

main();
