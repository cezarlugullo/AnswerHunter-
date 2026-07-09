/**
 * hub-atmosphere.js — mouse-follow glow for the Study Hub background.
 * Purely decorative: respects prefers-reduced-motion and costs one
 * rAF-throttled pointermove listener.
 */
(() => {
  'use strict';

  // Hero date line — "Quarta-feira · 9 de julho"
  const dateEl = document.getElementById('heroDate');
  if (dateEl) {
    const raw = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long'
    }).format(new Date());
    const pretty = raw.charAt(0).toUpperCase() + raw.slice(1);
    dateEl.textContent = pretty.replace(', ', ' · ');
  }

  // Balão do mascote — uma frase por visita, sensível à hora do dia
  const bubble = document.getElementById('mascotBubble');
  if (bubble) {
    const h = new Date().getHours();
    const pool = [
      'Pronto pra caçar respostas?',
      'Um passo de cada vez — igual no Dojo.',
      'Revisar hoje é lembrar na prova.',
      'Nenhuma tela em branco por aqui.',
      'Sessões curtas, streaks longas.'
    ];
    if (h >= 5 && h < 12) pool.push('Um café e três cards pra começar?');
    else if (h >= 12 && h < 19) pool.push('Uma revisão rápida agora à tarde?');
    else pool.push('Sessão curtinha e sono em dia.');
    bubble.textContent = pool[Math.floor(Math.random() * pool.length)];
  }

  // Topbar ganha elevação quando o conteúdo rola por baixo dele
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const scroller = document.getElementById('content');
    const onScroll = () => {
      const y = window.scrollY + (scroller ? scroller.scrollTop : 0);
      topbar.classList.toggle('is-scrolled', y > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  const glow = document.getElementById('ah-glow-bg');
  if (!glow) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let rafId = 0;
  let x = 0;
  let y = 0;

  function paint() {
    rafId = 0;
    glow.style.setProperty('--glow-x', x + 'px');
    glow.style.setProperty('--glow-y', y + 'px');
  }

  window.addEventListener('pointermove', (e) => {
    if (reduceMotion.matches) return;
    x = e.clientX;
    y = e.clientY;
    if (!rafId) rafId = requestAnimationFrame(paint);
  }, { passive: true });
})();
