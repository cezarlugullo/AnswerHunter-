'use strict';

// ─── DEMO DATA ───────────────────────────────────────────────────────
const DEMO = typeof chrome === 'undefined' || !chrome.storage;
if (DEMO) document.getElementById('hDemo').style.display = 'flex';

const SUBJS = ['Direito Constitucional','Direito Administrativo','Direito Penal','Português','Matemática','Informática','Raciocínio Lógico','Legislação'];
const COLORS = ['#FF6B6B','#FF9A3C','#FFD43B','#3ecf6a','#4dabf7','#b197fc','#ffa94d','#ff6b9d'];

function makeDemo() {
  const sm2 = {};
  const now = Date.now();
  for (let i = 0; i < 48; i++) {
    const subj = SUBJS[i % SUBJS.length];
    const lastD = new Date(now - Math.random()*30*86400000);
    const dueD  = new Date(now + (Math.random()*18-4)*86400000);
    const stab  = 0.8 + Math.random()*25;
    sm2['q'+i] = {
      interval:      Math.round(stab),
      repetition:    Math.floor(Math.random()*10),
      ef:            1.6 + Math.random()*1.4,
      nextReview:    dueD.toISOString().slice(0,10),
      lastRated:     lastD.toISOString().slice(0,10),
      errors:        Math.floor(Math.random()*5),
      totalRatings:  2 + Math.floor(Math.random()*16),
      correct_count: Math.floor(Math.random()*14),
      mastered:      Math.random() > 0.62,
      fsrs_stability: stab,
      fsrs_difficulty: 2.5 + Math.random()*5,
      fsrs_state:    [0,1,2,2,2,2,3][Math.floor(Math.random()*7)],
      tags:          [subj],
      questionText:  ['Qual o conceito de','O que caracteriza','Segundo a doutrina,','Assinale a alternativa sobre','De acordo com a CF/88,'][i%5] + ' ' + subj + '?',
    };
  }
  return {
    sm2,
    xp:     2847,
    streak: 12,
    jol: { unsure_total:45, unsure_correct:18, think_total:120, think_correct:89, certain_total:180, certain_correct:163 },
  };
}

function storageGet(keys) {
  return new Promise(r => {
    if (DEMO) { const d=makeDemo(); const o={}; keys.forEach(k=>o[k]=d[k]); r(o); }
    else chrome.storage.local.get(keys, r);
  });
}

// ─── UTILS ──────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0,10);
function addDays(d,n){ const dt=new Date(d+'T00:00:00'); dt.setDate(dt.getDate()+n); return dt.toISOString().slice(0,10); }
function pct(a,b){ return b>0?Math.round(a/b*100):0; }
function counter(el,target,dur=900){
  const s=performance.now();
  (function step(now){
    const p=Math.min((now-s)/dur,1);
    const e=1-Math.pow(1-p,3);
    el.textContent=Math.round(e*target).toLocaleString('pt-BR');
    if(p<1)requestAnimationFrame(step);
  })(s);
}
function retrievability(stability,lastRated){
  if(!stability||!lastRated)return null;
  const elapsed=Math.max(0,Math.round((Date.parse(today())-Date.parse(lastRated))/86400000));
  const DECAY=-0.5, F=Math.pow(0.9,1/DECAY)-1;
  return Math.round(Math.pow(1+F*elapsed/stability,DECAY)*100);
}

const LEVELS=[
  {min:0,    max:100,   lbl:'Nível 1 — Iniciante',  badge:'🌱',av:'1'},
  {min:100,  max:300,   lbl:'Nível 2 — Aprendiz',   badge:'📖',av:'2'},
  {min:300,  max:700,   lbl:'Nível 3 — Estudioso',  badge:'💡',av:'3'},
  {min:700,  max:1500,  lbl:'Nível 4 — Dedicado',   badge:'🎯',av:'4'},
  {min:1500, max:3000,  lbl:'Nível 5 — Focado',     badge:'⚡',av:'5'},
  {min:3000, max:6000,  lbl:'Nível 6 — Avançado',   badge:'🔥',av:'6'},
  {min:6000, max:12000, lbl:'Nível 7 — Expert',     badge:'🏆',av:'7'},
  {min:12000,max:25000, lbl:'Nível 8 — Mestre',     badge:'💎',av:'8'},
  {min:25000,max:1e9,   lbl:'Nível 9 — Lendário',  badge:'👑',av:'9'},
];
function getLevel(xp){ return LEVELS.find(l=>xp>=l.min&&xp<l.max)||LEVELS[LEVELS.length-1]; }

// ─── HEATMAP ─────────────────────────────────────────────────────────
function buildHeatmap(sm2){
  const act={};
  Object.values(sm2).forEach(e=>{ if(e.lastRated) act[e.lastRated]=(act[e.lastRated]||0)+1; });
  const WEEKS=52;
  const start=new Date(); start.setDate(start.getDate()-WEEKS*7+1);
  const grid=document.getElementById('hmapGrid');
  const months=document.getElementById('hmapMonths');
  grid.innerHTML=months.innerHTML='';
  let lastMo='', moPositions=[];
  const cur=new Date(start);
  for(let w=0;w<WEEKS;w++){
    const col=document.createElement('div'); col.className='hmap-col';
    for(let d=0;d<7;d++){
      const iso=cur.toISOString().slice(0,10);
      const mo=cur.toLocaleString('pt-BR',{month:'short'});
      if(mo!==lastMo){ moPositions.push({mo,w}); lastMo=mo; }
      const cnt=act[iso]||0;
      const cell=document.createElement('div');
      cell.className='hcell'+(cnt===0?'':(cnt<3?' l1':cnt<7?' l2':cnt<15?' l3':' l4'));
      cell.setAttribute('data-tip',`${iso}: ${cnt} revisão(ões)`);
      col.appendChild(cell); cur.setDate(cur.getDate()+1);
    }
    grid.appendChild(col);
  }
  // month labels
  moPositions.forEach(({mo,w})=>{
    const sp=document.createElement('span');
    sp.textContent=mo; sp.style.cssText=`display:inline-block;width:${16*WEEKS/moPositions.length}px;font-size:.62rem;`;
    months.appendChild(sp);
  });
  const totalDays=Object.values(act).reduce((a,v)=>a+v,0);
  document.getElementById('hmapBadge').textContent=`${totalDays} revisões`;
}

// ─── RETENTION CHART ─────────────────────────────────────────────────
function drawRetChart(sm2){
  const canvas=document.getElementById('retChart');
  if(!canvas)return;
  const dpr=devicePixelRatio||1;
  canvas.width=(canvas.offsetWidth||280)*dpr;
  canvas.height=110*dpr;
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  const W=canvas.width/dpr, H=110;
  const PAD={l:28,r:8,t:8,b:18};
  ctx.clearRect(0,0,W,H);

  const buckets={};
  Object.values(sm2).forEach(e=>{
    if(!e.fsrs_stability||!e.lastRated)return;
    const ret=retrievability(e.fsrs_stability,e.lastRated);
    if(ret===null)return;
    const elapsed=Math.max(0,Math.round((Date.parse(today())-Date.parse(e.lastRated))/86400000));
    const bk=Math.min(30,Math.floor(elapsed/3)*3);
    (buckets[bk]=buckets[bk]||[]).push(ret);
  });
  const DECAY=-0.5, F=Math.pow(0.9,1/DECAY)-1;
  const days=Array.from({length:11},(_,i)=>i*3);
  const vals=days.map(d=>{
    const b=buckets[d];
    return b?b.reduce((a,v)=>a+v,0)/b.length:Math.round(Math.pow(1+F*d/8,DECAY)*100);
  });

  // grid
  ctx.strokeStyle='#eceae4'; ctx.lineWidth=1;
  [25,50,75,100].forEach(v=>{
    const y=PAD.t+(1-v/100)*(H-PAD.t-PAD.b);
    ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(W-PAD.r,y); ctx.stroke();
    ctx.fillStyle='#bbb'; ctx.font='500 8px Lexend,sans-serif';
    ctx.fillText(v+'%',0,y+3);
  });

  const xs=days.map((_,i)=>PAD.l+(i/(days.length-1))*(W-PAD.l-PAD.r));
  const ys=vals.map(v=>PAD.t+(1-v/100)*(H-PAD.t-PAD.b));

  // fill
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'rgba(255,107,107,.3)'); g.addColorStop(1,'rgba(255,107,107,0)');
  ctx.beginPath(); ctx.moveTo(xs[0],H-PAD.b);
  xs.forEach((x,i)=>ctx.lineTo(x,ys[i]));
  ctx.lineTo(xs[xs.length-1],H-PAD.b); ctx.closePath();
  ctx.fillStyle=g; ctx.fill();

  // line
  ctx.beginPath(); ctx.moveTo(xs[0],ys[0]);
  xs.forEach((x,i)=>{if(i>0)ctx.lineTo(x,ys[i]);});
  ctx.strokeStyle='#FF6B6B'; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.stroke();

  // dots + labels
  xs.forEach((x,i)=>{
    ctx.beginPath(); ctx.arc(x,ys[i],3.5,0,Math.PI*2);
    ctx.fillStyle='#FF6B6B'; ctx.fill();
    ctx.fillStyle='#aaa89a'; ctx.font='500 8px Lexend,sans-serif';
    ctx.fillText(days[i]+'d',x-6,H-2);
  });
}

// ─── SUBJECTS ────────────────────────────────────────────────────────
function buildSubjects(sm2){
  const counts={};
  Object.values(sm2).forEach(e=>{
    const s=(e.tags&&e.tags[0])||'Geral';
    const c=counts[s]=counts[s]||{total:0,due:0,mastered:0};
    c.total++;
    if((e.nextReview||'9999')<=today())c.due++;
    if(e.mastered)c.mastered++;
  });
  const sorted=Object.entries(counts).sort((a,b)=>b[1].total-a[1].total);
  const maxV=Math.max(...sorted.map(s=>s[1].total),1);
  const el=document.getElementById('subjList');
  if(!sorted.length){el.innerHTML='<div class="empty"><span class="icon">school</span>Nenhuma questão</div>';return;}
  el.innerHTML=sorted.slice(0,8).map(([name,d],i)=>`
    <div class="subj-row">
      <div class="subj-head">
        <div class="subj-name"><div class="sdot" style="background:${COLORS[i%COLORS.length]}"></div>${name}</div>
        <div class="subj-cnt">${d.total}q · ${d.due} hoje</div>
      </div>
      <div class="strack"><div class="sfill" data-p="${pct(d.total,maxV)}" style="background:${COLORS[i%COLORS.length]}"></div></div>
    </div>`).join('');
  document.getElementById('subjBadge').textContent=`${sorted.length} matérias`;
  setTimeout(()=>el.querySelectorAll('.sfill').forEach(f=>f.style.width=f.dataset.p+'%'),80);
  buildRings(sorted.slice(0,6));
}

// ─── MASTERY RINGS ────────────────────────────────────────────────────
function buildRings(subjects){
  const el=document.getElementById('rings'); if(!el)return;
  const R=27,CIRC=2*Math.PI*R;
  el.innerHTML=subjects.map(([name,d],i)=>{
    const p=pct(d.mastered,d.total);
    const offset=CIRC-(p/100)*CIRC;
    const c=COLORS[i%COLORS.length];
    const short=name.split(' ').slice(0,2).join('<br>');
    return `<div class="ring-wrap">
      <svg class="ring-svg" viewBox="0 0 64 64">
        <circle class="ring-bg" cx="32" cy="32" r="${R}"/>
        <circle class="ring-arc" cx="32" cy="32" r="${R}" stroke="${c}"
          stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"
          data-offset="${offset}"/>
        <text class="ring-txt" x="32" y="32" fill="${c}">${p}%</text>
      </svg>
      <div class="ring-lbl">${short}</div>
    </div>`;
  }).join('');
  setTimeout(()=>el.querySelectorAll('.ring-arc').forEach(a=>a.style.strokeDashoffset=a.dataset.offset),120);
}

// ─── TIMELINE ────────────────────────────────────────────────────────
function buildTimeline(sm2){
  const el=document.getElementById('timeline'); if(!el)return;
  const tod=today();
  const days=Array.from({length:7},(_,i)=>addDays(tod,i));
  const bk={}; days.forEach(d=>bk[d]=[]);
  Object.values(sm2).forEach(e=>{
    const nr=e.nextReview||tod;
    if(bk[nr])bk[nr].push(e);
    else if(nr<tod)bk[tod].push(e);
  });
  const DN=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  el.innerHTML=days.map((d,i)=>{
    const ents=bk[d]||[];
    const lbl=i===0?'Hoje':(i===1?'Amanhã':DN[new Date(d+'T12:00').getDay()]);
    const isT=i===0;
    const chips=ents.slice(0,5).map(e=>{
      const st=e.fsrs_state??2;
      const cls=st===0?'chip-new':st===3?'chip-rel':'chip-rev';
      const s=((e.tags&&e.tags[0])||'Geral').split(' ')[0].substring(0,5);
      return `<span class="chip ${cls}">${s}</span>`;
    }).join('');
    const extra=ents.length>5?`<span style="font-size:.68rem;color:var(--muted)">+${ents.length-5}</span>`:''
    return `<div class="tl-day">
      <div class="tl-date${isT?' today':''}">${lbl}</div>
      <div class="tl-chips">${chips||'<span style="font-size:.72rem;color:var(--muted-light)">—</span>'}${extra}</div>
      <div class="tl-cnt">${ents.length}</div>
    </div>`;
  }).join('');
  const total=days.reduce((a,d)=>a+(bk[d]||[]).length,0);
  document.getElementById('tlBadge').textContent=`${total} revisões`;
}

// ─── JOL ─────────────────────────────────────────────────────────────
function buildJOL(j){
  j=j||{unsure_total:0,unsure_correct:0,think_total:0,think_correct:0,certain_total:0,certain_correct:0};
  const tot=j.unsure_total+j.think_total+j.certain_total;
  function bar(fId,pId,v,max){
    setTimeout(()=>{
      const f=document.getElementById(fId),p=document.getElementById(pId);
      const val=max>0?pct(v,max):0;
      if(f)f.style.width=val+'%';
      if(p)p.textContent=max>0?val+'%':'—%';
    },200);
  }
  bar('jU','jUP',j.unsure_total,tot);
  bar('jT','jTP',j.think_total,tot);
  bar('jC','jCP',j.certain_total,tot);
  bar('jUH','jUHP',j.unsure_correct,j.unsure_total);
  bar('jCM','jCMP',j.certain_total-j.certain_correct,j.certain_total);
}

// ─── ERRORS ──────────────────────────────────────────────────────────
function buildErrors(sm2){
  const el=document.getElementById('errList'); if(!el)return;
  const errs=Object.values(sm2).filter(e=>(e.errors||0)>0).sort((a,b)=>(b.errors||0)-(a.errors||0)).slice(0,5);
  if(!errs.length){
    el.innerHTML='<div class="empty"><span class="icon">check_circle</span>Sem erros registrados!</div>';
    document.getElementById('errBadge').textContent='0 erros'; return;
  }
  el.innerHTML=errs.map(e=>{
    const subj=(e.tags&&e.tags[0])||'Geral';
    const txt=(e.questionText||'Questão sem título').substring(0,78);
    const acc=pct(e.correct_count||0,e.totalRatings||1);
    return `<div class="err-item">${txt}${e.questionText&&e.questionText.length>78?'...':''}
      <div class="err-meta">
        <span class="etag">${subj}</span>
        <span class="ecnt">${e.errors}× erro</span>
        <span class="eacc">${acc}% acerto</span>
      </div></div>`;
  }).join('');
  document.getElementById('errBadge').textContent=`${errs.length} com erros`;
}

// ─── MAIN ────────────────────────────────────────────────────────────
async function init(){
  const res = await storageGet(['sm2','xp','streak','jol']);
  // support both key names used in AnswerHunter
  const sm2    = res.sm2 || res.ah_sm2Data || {};
  const xp     = res.xp  || res.ah_xp     || 0;
  const streak = res.streak || res.ah_streak || 0;
  const jol    = res.jol || res.ah_jol    || null;

  const tod    = today();
  const ents   = Object.values(sm2);
  const total  = ents.length;
  const due    = ents.filter(e=>!e.nextReview||e.nextReview<=tod).length;
  const master = ents.filter(e=>e.mastered).length;
  const totRat = ents.reduce((a,e)=>a+(e.totalRatings||0),0);
  const totCor = ents.reduce((a,e)=>a+(e.correct_count||0),0);
  const acc    = pct(totCor,totRat);

  const fsrsE  = ents.filter(e=>e.fsrs_stability);
  const avgRet = fsrsE.length?Math.round(fsrsE.reduce((a,e)=>a+(retrievability(e.fsrs_stability,e.lastRated)||90),0)/fsrsE.length):90;
  const avgStb = fsrsE.length?Math.round(fsrsE.reduce((a,e)=>a+(e.fsrs_stability||0),0)/fsrsE.length):0;
  const inRev  = fsrsE.filter(e=>e.fsrs_state===2).length;
  const inRel  = fsrsE.filter(e=>e.fsrs_state===3).length;

  // Greeting
  const h=new Date().getHours();
  const gw=h<12?'Bom dia':h<18?'Boa tarde':'Boa noite';
  const ge=h<12?'☀️':h<18?'🌤️':'🌙';
  document.getElementById('greetWord').textContent=gw;
  document.getElementById('greetEmoji').textContent=ge;
  document.getElementById('greetSub').textContent=due>0
    ?`Você tem ${due} questão(ões) para revisar hoje. Vamos lá! 💪`
    :'Nenhuma revisão pendente hoje. Continue assim! 🎉';

  // Header
  document.getElementById('hStreak').textContent=streak;
  document.getElementById('hXP').textContent=xp.toLocaleString('pt-BR');

  // Footer
  document.getElementById('ftDate').textContent=new Date().toLocaleDateString('pt-BR',{dateStyle:'full'});

  // Level
  const lv=getLevel(xp);
  const lvN=LEVELS[LEVELS.indexOf(lv)+1];
  document.getElementById('lvAvatar').textContent=lv.av;
  document.getElementById('lvTitle').textContent=lv.lbl;
  document.getElementById('lvBadge').textContent=lv.badge;
  document.getElementById('xpCur').textContent=xp.toLocaleString('pt-BR')+' XP';
  document.getElementById('xpNxt').textContent=lvN?'Próximo: '+lvN.min.toLocaleString('pt-BR')+' XP':'👑 Nível máximo!';
  setTimeout(()=>{
    document.getElementById('xpFill').style.width=(lvN?pct(xp-lv.min,lvN.min-lv.min):100)+'%';
  },150);

  // Hero counters
  counter(document.getElementById('sTotal'),total);
  counter(document.getElementById('sDue'),due);
  counter(document.getElementById('sMastered'),master);
  document.getElementById('sAccuracy').textContent=acc+'%';
  document.getElementById('sDueSub').textContent=due>0?'revisões pendentes':'tudo em dia ✅';
  document.getElementById('sMasteredSub').textContent='de '+total+' questões';

  // FSRS
  document.getElementById('fRet').textContent=avgRet+'%';
  document.getElementById('fStab').textContent=avgStb+'d';
  document.getElementById('fRev').textContent=inRev;
  document.getElementById('fRel').textContent=inRel;

  buildHeatmap(sm2);
  drawRetChart(sm2);
  buildSubjects(sm2);
  buildTimeline(sm2);
  buildJOL(jol);
  buildErrors(sm2);
}

document.addEventListener('DOMContentLoaded',init);
// Also call init directly when injected inline (DOMContentLoaded already fired)
if (document.readyState !== 'loading') init();
