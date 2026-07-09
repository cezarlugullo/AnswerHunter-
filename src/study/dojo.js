/**
 * AnswerHunter — Dojo de Código
 *
 * Ferramenta de prática deliberada contra o bloqueio de "tela em branco":
 * o aluno escreve um PLANO em português (passos numerados), depois traduz
 * UM passo por vez para código C. A IA atua como tutor socrático — valida
 * cada etapa e dá dicas mínimas, nunca a solução.
 *
 * Protocolo de resposta da IA em linha (APROVADO/AJUSTAR na 1ª linha) em
 * vez de JSON: modelos fracos quebram JSON com frequência, mas raramente
 * erram uma palavra-chave na primeira linha.
 */

import { ApiService } from '../services/ApiService.js';

/* ─── Exercícios embutidos (escada progressiva, C) ─────────────────── */

const EXERCISES = [
  {
    id: 'soma-vetor', level: 1, title: 'Soma dos elementos',
    goal: 'Somar todos os elementos de um vetor de inteiros.',
    statement: 'Implemente uma função que receba um vetor de inteiros e seu tamanho, e retorne a soma de todos os elementos.',
    signature: 'int soma(int v[], int n)',
  },
  {
    id: 'contar-pares', level: 1, title: 'Contar pares',
    goal: 'Contar quantos elementos pares existem no vetor.',
    statement: 'Implemente uma função que receba um vetor de inteiros e seu tamanho, e retorne quantos elementos são pares. Lembre-se: um número é par quando o resto da divisão por 2 é zero.',
    signature: 'int contarPares(int v[], int n)',
  },
  {
    id: 'maior-elemento', level: 1, title: 'Maior elemento',
    goal: 'Encontrar o maior valor do vetor.',
    statement: 'Implemente uma função que receba um vetor de inteiros (n >= 1) e retorne o MAIOR valor presente nele.',
    signature: 'int maior(int v[], int n)',
  },
  {
    id: 'inverter-vetor', level: 2, title: 'Inverter vetor',
    goal: 'Inverter a ordem dos elementos no próprio vetor (in-place).',
    statement: 'Implemente uma função que inverta a ordem dos elementos do vetor, sem usar um segundo vetor. Dica de raciocínio: pense em trocar as pontas e caminhar para o centro.',
    signature: 'void inverter(int v[], int n)',
  },
  {
    id: 'busca-linear', level: 2, title: 'Busca linear',
    goal: 'Encontrar a posição de um valor no vetor (ou -1).',
    statement: 'Implemente uma função que procure o valor x no vetor e retorne o índice da primeira ocorrência, ou -1 se não existir.',
    signature: 'int buscar(int v[], int n, int x)',
  },
  {
    id: 'bubble-passada', level: 2, title: 'Uma passada do Bubble Sort',
    goal: 'Fazer UMA passada de trocas de vizinhos.',
    statement: 'Implemente uma função que faça UMA única passada do Bubble Sort: percorra o vetor comparando vizinhos (v[i] e v[i+1]) e troque quando estiverem fora de ordem. Retorne 1 se houve alguma troca, 0 se nenhuma.',
    signature: 'int passadaBubble(int v[], int n)',
  },
  {
    id: 'selection-sort', level: 3, title: 'Selection Sort completo',
    goal: 'Ordenar o vetor com Selection Sort.',
    statement: 'Implemente o Selection Sort: para cada posição i, encontre o índice do menor elemento da parte não ordenada (de i até o fim) e troque-o com v[i].',
    signature: 'void selectionSort(int v[], int n)',
  },
  {
    id: 'heapify-no', level: 3, title: 'Heapify de um nó',
    goal: 'Reparar a propriedade de max-heap a partir de um nó.',
    statement: 'Implemente o heapify: dado um vetor que representa um heap e um índice i, garanta que o nó i obedeça à regra do max-heap (pai >= filhos). Os filhos de i estão em 2*i+1 e 2*i+2. Se trocar com um filho, continue o reparo a partir dele. O parâmetro n limita a área válida do heap.',
    signature: 'void heapify(int v[], int n, int i)',
  },
];

const STORAGE_KEY = 'ah-dojo-state-v1';

/* ─── Estado ───────────────────────────────────────────────────────── */

const dojo = {
  phase: 'pick',          // pick | plan | code | done
  exercise: null,         // exercício ativo (embutido ou gerado por IA)
  steps: [],              // passos do plano aprovado
  currentStep: 0,
  planText: '',
  codeText: '',
  busy: false,
};

let ctx = null;           // { toast } injetado pelo study-hub
let root = null;          // #viewDojo .view-inner

/* ─── Helpers ──────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      phase: dojo.phase,
      exercise: dojo.exercise,
      steps: dojo.steps,
      currentStep: dojo.currentStep,
      planText: dojo.planText,
      codeText: dojo.codeText,
    }));
  } catch { /* storage cheio/indisponível não é fatal */ }
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && saved.phase && saved.phase !== 'pick' && saved.exercise) {
      Object.assign(dojo, saved, { busy: false });
    }
  } catch { /* estado corrompido → começa do zero */ }
}

function parseSteps(text) {
  return String(text || '')
    .split('\n')
    .map(l => l.replace(/^\s*(?:\d+[.)]\s*|[-*]\s*)?/, '').trim())
    .filter(Boolean);
}

/**
 * Chama a cadeia de providers "inteligentes". Sem overrides de modelo:
 * cada _call* já usa o modelo smart configurado nas settings (70B/GPT/
 * DeepSeek) — nunca o 8B "fast", que só existe no pipeline de extração.
 */
async function askTutor(messages, maxTokens = 350) {
  const { result } = await ApiService._callWithProviderChain({
    messages,
    opts: { temperature: 0.3, max_tokens: maxTokens },
    label: 'dojo',
    fallbackValue: null,
  });
  return result;
}

/** Protocolo em linha: 1ª linha contém o veredito, o resto é feedback. */
function parseVerdict(text, approvedWord, adjustWord) {
  if (!text) return { verdict: null, feedback: '' };
  const lines = String(text).trim().split('\n');
  const first = (lines[0] || '').toUpperCase();
  let verdict = null;
  if (first.includes(approvedWord)) verdict = true;
  else if (first.includes(adjustWord)) verdict = false;
  const feedback = (verdict === null ? lines : lines.slice(1)).join('\n').trim();
  return { verdict, feedback };
}

const TUTOR_RULES = `Você é um tutor socrático de programação para um aluno brasileiro de Ciência da Computação com TDAH.
REGRAS INEGOCIÁVEIS:
- NUNCA escreva o código da solução, nem parcial, nem "por exemplo". Zero linhas de código.
- Dê no máximo UMA dica por vez, curta (até 50 palavras), apontando para o raciocínio.
- Elogie o que estiver certo antes de apontar o que falta.
- Responda em português do Brasil.`;

/* ─── Render ───────────────────────────────────────────────────────── */

function render() {
  if (!root) return;
  if (dojo.phase === 'pick') renderPicker();
  else if (dojo.phase === 'plan') renderPlan();
  else if (dojo.phase === 'code') renderCode();
  else if (dojo.phase === 'done') renderDone();
  saveState();
}

function renderPicker() {
  const cards = EXERCISES.map(ex => `
    <button class="dojo-ex-card" data-ex="${ex.id}">
      <span class="dojo-ex-level" data-level="${ex.level}">${'●'.repeat(ex.level)}${'○'.repeat(3 - ex.level)}</span>
      <span class="dojo-ex-title">${esc(ex.title)}</span>
      <span class="dojo-ex-goal">${esc(ex.goal)}</span>
    </button>`).join('');

  root.innerHTML = `
    <div class="view-header">
      <div>
        <p class="view-eyebrow">Prática deliberada</p>
        <h1 class="view-title">Dojo de Código</h1>
        <p class="view-subtitle">Plano primeiro, código depois — um passo de cada vez, nunca a tela em branco</p>
      </div>
    </div>
    <div class="dojo-method-strip">
      <span class="dojo-method-step"><b>1</b> Escreva o plano em português</span>
      <span class="material-symbols-rounded">arrow_forward</span>
      <span class="dojo-method-step"><b>2</b> Traduza um passo por vez</span>
      <span class="material-symbols-rounded">arrow_forward</span>
      <span class="dojo-method-step"><b>3</b> A IA revisa cada etapa (sem dar a resposta)</span>
    </div>
    <div class="dojo-ex-grid">${cards}</div>`;

  root.querySelectorAll('.dojo-ex-card').forEach(btn => {
    btn.addEventListener('click', () => startExercise(btn.dataset.ex));
  });
}

function renderPlan() {
  const ex = dojo.exercise;
  root.innerHTML = `
    <div class="view-header">
      <div>
        <p class="view-eyebrow">Dojo · Fase 1 de 2</p>
        <h1 class="view-title">${esc(ex.title)}</h1>
        <p class="view-subtitle">Escreva o plano em português, ainda sem código</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-ghost btn-sm" id="dojoExit"><span class="material-symbols-rounded">arrow_back</span> Trocar exercício</button>
      </div>
    </div>
    <div class="panel dojo-statement">
      <div class="panel-body">
        <p>${esc(ex.statement)}</p>
        <code class="dojo-signature">${esc(ex.signature)}</code>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><h2 class="panel-title"><span class="material-symbols-rounded">checklist</span> Seu plano (passos numerados, em português)</h2></div>
      <div class="panel-body">
        <textarea id="dojoPlanInput" class="dojo-textarea" rows="7"
          placeholder="1. criar uma variável para...&#10;2. percorrer o vetor...&#10;3. ...">${esc(dojo.planText)}</textarea>
        <div class="dojo-feedback" id="dojoPlanFeedback" hidden></div>
        <div class="dojo-actions">
          <button class="btn btn-primary" id="dojoValidatePlan">
            <span class="material-symbols-rounded">auto_awesome</span> Validar plano com a IA
          </button>
          <button class="btn btn-secondary" id="dojoSkipValidation" title="Seguir com o plano do jeito que está">
            Seguir sem validar
          </button>
        </div>
      </div>
    </div>`;

  root.querySelector('#dojoExit').addEventListener('click', resetToPicker);
  root.querySelector('#dojoPlanInput').addEventListener('input', (e) => { dojo.planText = e.target.value; });
  root.querySelector('#dojoValidatePlan').addEventListener('click', validatePlan);
  root.querySelector('#dojoSkipValidation').addEventListener('click', () => acceptPlan(parseSteps(dojo.planText)));
}

function renderCode() {
  const ex = dojo.exercise;
  const stepsHtml = dojo.steps.map((s, i) => {
    const cls = i < dojo.currentStep ? 'done' : (i === dojo.currentStep ? 'current' : '');
    const icon = i < dojo.currentStep ? 'check_circle' : (i === dojo.currentStep ? 'play_arrow' : 'radio_button_unchecked');
    return `<li class="dojo-step ${cls}"><span class="material-symbols-rounded">${icon}</span> ${esc(s)}</li>`;
  }).join('');

  root.innerHTML = `
    <div class="view-header">
      <div>
        <p class="view-eyebrow">Dojo · Fase 2 de 2</p>
        <h1 class="view-title">${esc(ex.title)}</h1>
        <p class="view-subtitle">Traduza só o passo destacado, ignore o resto</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-ghost btn-sm" id="dojoBackPlan"><span class="material-symbols-rounded">edit_note</span> Revisar plano</button>
        <button class="btn btn-ghost btn-sm" id="dojoExit"><span class="material-symbols-rounded">arrow_back</span> Sair</button>
      </div>
    </div>
    <div class="dojo-workbench">
      <aside class="panel dojo-steps-panel">
        <div class="panel-header"><h2 class="panel-title"><span class="material-symbols-rounded">checklist</span> Plano</h2></div>
        <ol class="dojo-steps-list">${stepsHtml}</ol>
      </aside>
      <div class="panel dojo-editor-panel">
        <div class="panel-header">
          <h2 class="panel-title"><span class="material-symbols-rounded">code</span> Seu código</h2>
          <span class="panel-meta">C</span>
        </div>
        <textarea id="dojoCodeInput" class="dojo-textarea dojo-code" rows="16" spellcheck="false">${esc(dojo.codeText)}</textarea>
        <div class="dojo-feedback" id="dojoCodeFeedback" hidden></div>
        <div class="dojo-actions">
          <button class="btn btn-primary" id="dojoCheckStep">
            <span class="material-symbols-rounded">task_alt</span> Verificar etapa ${dojo.currentStep + 1}
          </button>
          <button class="btn btn-secondary" id="dojoHint">
            <span class="material-symbols-rounded">lightbulb</span> Dica
          </button>
        </div>
      </div>
    </div>`;

  const code = root.querySelector('#dojoCodeInput');
  code.addEventListener('input', (e) => { dojo.codeText = e.target.value; });
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = code;
      code.value = code.value.slice(0, s) + '    ' + code.value.slice(en);
      code.selectionStart = code.selectionEnd = s + 4;
      dojo.codeText = code.value;
    }
  });
  root.querySelector('#dojoBackPlan').addEventListener('click', () => { dojo.phase = 'plan'; render(); });
  root.querySelector('#dojoExit').addEventListener('click', resetToPicker);
  root.querySelector('#dojoCheckStep').addEventListener('click', checkStep);
  root.querySelector('#dojoHint').addEventListener('click', giveHint);
}

function renderDone() {
  const ex = dojo.exercise;
  root.innerHTML = `
    <div class="dojo-done">
      <div class="dojo-done-icon">🦊🎉</div>
      <h2 class="view-title">Você escreveu ${esc(ex.title)} sozinho!</h2>
      <p class="view-subtitle">Sem tutorial, sem copiar — plano seu, código seu. É assim que se aprende de verdade.</p>
      <pre class="dojo-final-code"><code>${esc(dojo.codeText)}</code></pre>
      <div class="dojo-actions dojo-actions-center">
        <button class="btn btn-primary" id="dojoNext"><span class="material-symbols-rounded">skip_next</span> Próximo exercício</button>
        <button class="btn btn-secondary" id="dojoRedo"><span class="material-symbols-rounded">refresh</span> Refazer este</button>
      </div>
    </div>`;
  root.querySelector('#dojoNext').addEventListener('click', resetToPicker);
  root.querySelector('#dojoRedo').addEventListener('click', () => startExercise(ex.id));
}

/* ─── Ações ────────────────────────────────────────────────────────── */

function resetToPicker() {
  dojo.phase = 'pick';
  dojo.exercise = null;
  dojo.steps = [];
  dojo.currentStep = 0;
  dojo.planText = '';
  dojo.codeText = '';
  try { localStorage.removeItem(STORAGE_KEY); } catch { }
  render();
}

function startExercise(id) {
  const ex = EXERCISES.find(e => e.id === id) || dojo.exercise;
  if (!ex) return;
  dojo.exercise = ex;
  dojo.phase = 'plan';
  dojo.steps = [];
  dojo.currentStep = 0;
  dojo.planText = '';
  dojo.codeText = '';
  render();
}

function acceptPlan(steps) {
  if (!steps.length) {
    showFeedback('#dojoPlanFeedback', 'warn', 'Escreva pelo menos um passo antes de continuar. Pode ser simples: "1. criar uma variável para guardar a soma".');
    return;
  }
  dojo.steps = steps;
  dojo.currentStep = 0;
  if (!dojo.codeText.trim()) {
    const comments = steps.map((s, i) => `    // ${i + 1}. ${s}\n`).join('\n');
    dojo.codeText = `${dojo.exercise.signature} {\n${comments}}\n`;
  }
  dojo.phase = 'code';
  render();
}

async function validatePlan() {
  if (dojo.busy) return;
  const steps = parseSteps(dojo.planText);
  if (!steps.length) {
    showFeedback('#dojoPlanFeedback', 'warn', 'Escreva o plano primeiro — um passo por linha, em português.');
    return;
  }
  setBusy('#dojoValidatePlan', true);
  try {
    const reply = await askTutor([
      { role: 'system', content: TUTOR_RULES },
      {
        role: 'user', content: `EXERCÍCIO: ${dojo.exercise.statement}
ASSINATURA: ${dojo.exercise.signature}

PLANO DO ALUNO (em português, ainda sem código):
${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Avalie APENAS se o plano, executado à risca, resolveria o exercício.
PRIMEIRA LINHA da resposta: exatamente PLANO_OK ou PLANO_AJUSTAR.
Depois, 1-3 frases de feedback (sem código).`
      },
    ]);
    const { verdict, feedback } = parseVerdict(reply, 'PLANO_OK', 'PLANO_AJUSTAR');
    if (verdict === true) {
      ctx.toast('🦊 Plano aprovado! Agora um passo de cada vez.', 'success');
      acceptPlan(steps);
    } else if (verdict === false) {
      showFeedback('#dojoPlanFeedback', 'warn', feedback || 'O plano ainda não cobre o exercício todo. Releia o enunciado e complete os passos.');
    } else {
      showFeedback('#dojoPlanFeedback', 'info', 'A IA não respondeu no formato esperado. Você pode tentar de novo ou seguir sem validar.');
    }
  } catch (err) {
    showFeedback('#dojoPlanFeedback', 'info', 'IA indisponível agora — sem problema, você pode seguir sem validar.');
  } finally {
    setBusy('#dojoValidatePlan', false);
  }
}

async function checkStep() {
  if (dojo.busy) return;
  setBusy('#dojoCheckStep', true);
  const stepNum = dojo.currentStep + 1;
  try {
    const reply = await askTutor([
      { role: 'system', content: TUTOR_RULES },
      {
        role: 'user', content: `EXERCÍCIO: ${dojo.exercise.statement}
ASSINATURA: ${dojo.exercise.signature}

PLANO COMPLETO:
${dojo.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

CÓDIGO ATUAL DO ALUNO:
${dojo.codeText}

Avalie SOMENTE a etapa ${stepNum} ("${dojo.steps[dojo.currentStep]}").
Ignore etapas futuras ainda não implementadas — isso é esperado.
A etapa ${stepNum} está implementada corretamente no código?
PRIMEIRA LINHA: exatamente APROVADO ou AJUSTAR.
Depois, 1-2 frases: se APROVADO, um elogio específico; se AJUSTAR, UMA dica mínima sem código.`
      },
    ]);
    const { verdict, feedback } = parseVerdict(reply, 'APROVADO', 'AJUSTAR');
    if (verdict === true) {
      dojo.currentStep += 1;
      if (dojo.currentStep >= dojo.steps.length) {
        dojo.phase = 'done';
        ctx.toast('🦊 Exercício completo!', 'success');
      } else {
        ctx.toast(`🦊 Etapa ${stepNum} ok! Agora só a etapa ${stepNum + 1} — nada mais.`, 'success');
      }
      render();
    } else if (verdict === false) {
      showFeedback('#dojoCodeFeedback', 'warn', feedback || 'Quase — releia o comentário desta etapa e compare com o que o código faz.');
    } else {
      showFeedback('#dojoCodeFeedback', 'info', 'A IA não respondeu no formato esperado. Tente verificar de novo.');
    }
  } catch (err) {
    showFeedback('#dojoCodeFeedback', 'info', 'IA indisponível agora. Continue escrevendo e verifique depois.');
  } finally {
    setBusy('#dojoCheckStep', false);
  }
}

async function giveHint() {
  if (dojo.busy) return;
  setBusy('#dojoHint', true);
  try {
    const reply = await askTutor([
      { role: 'system', content: TUTOR_RULES },
      {
        role: 'user', content: `EXERCÍCIO: ${dojo.exercise.statement}
ETAPA ATUAL: "${dojo.steps[dojo.currentStep]}"
CÓDIGO ATUAL:
${dojo.codeText}

O aluno pediu uma dica para a etapa atual. Dê UMA pergunta socrática ou
lembrete conceitual (máx. 40 palavras). NENHUMA linha de código.`
      },
    ], 150);
    showFeedback('#dojoCodeFeedback', 'info', reply || 'Pense: o que o comentário desta etapa pede, em uma frase? Escreva só isso.');
  } catch {
    showFeedback('#dojoCodeFeedback', 'info', 'IA indisponível. Dica genérica: leia o comentário da etapa em voz alta e escreva a menor linha de código que o satisfaça.');
  } finally {
    setBusy('#dojoHint', false);
  }
}

/* ─── UI utils ─────────────────────────────────────────────────────── */

function showFeedback(sel, kind, text) {
  const el = root.querySelector(sel);
  if (!el) return;
  el.hidden = false;
  el.dataset.kind = kind;
  el.innerHTML = `<span class="dojo-feedback-mascot">🦊</span><div>${esc(text).replace(/\n/g, '<br>')}</div>`;
}

function setBusy(btnSel, busy) {
  dojo.busy = busy;
  const btn = root.querySelector(btnSel);
  if (btn) {
    btn.disabled = busy;
    btn.classList.toggle('is-loading', busy);
  }
}

/* ─── API pública ──────────────────────────────────────────────────── */

export function initDojo(context) {
  ctx = context;
  root = document.querySelector('#viewDojo .view-inner');
  restoreState();
}

export function renderDojo() {
  if (!root) root = document.querySelector('#viewDojo .view-inner');
  render();
}
