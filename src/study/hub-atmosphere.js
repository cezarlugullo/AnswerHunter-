/**
 * hub-atmosphere.js — mouse-follow glow for the Study Hub background.
 * Purely decorative: respects prefers-reduced-motion and costs one
 * rAF-throttled pointermove listener.
 */
(() => {
  'use strict';

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
