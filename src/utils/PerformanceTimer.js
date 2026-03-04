
// AnswerHunter Performance Timer
// Tracks timing for each phase of the search flow and prints a summary table
export const PerformanceTimer = {
  create(label = 'Search Flow') {
    const phases = [];
    const t0 = performance.now();
    let lastMark = t0;

    const css = {
      title:   'font-weight:bold; color:#fff; background:#333; padding:2px 6px; border-radius:3px;',
      phase:   'color:#4fc3f7; font-weight:bold;',
      time:    'color:#fff176; font-weight:bold;',
      fast:    'color:#a5d6a7;',
      medium:  'color:#fff176;',
      slow:    'color:#ef9a9a;',
      header:  'font-weight:bold; color:#ce93d8;',
      total:   'font-weight:bold; color:#80deea;',
    };

    return {
      mark(phaseName) {
        const now = performance.now();
        const duration = now - lastMark;
        lastMark = now;
        phases.push({ name: phaseName, duration });
        const color = duration < 500 ? css.fast : duration < 2000 ? css.medium : css.slow;
        console.log(`%c[TIMER] [AH-TIMER] %c${phaseName}%c → %c${duration.toFixed(0)}ms`, css.phase, css.phase, '', color);
        return duration;
      },

      skip(phaseName) {
        phases.push({ name: phaseName, duration: 0, skipped: true });
        console.log(`%c⏭ [AH-TIMER] %c${phaseName}%c → SKIPPED`, css.phase, css.phase, 'color:#888;');
      },

      summary() {
        const total = performance.now() - t0;
        const longestName = Math.max(...phases.map(p => p.name.length), 10);
        console.group(`%c[CHART] [AH-TIMER] ${label} — Total: ${total.toFixed(0)}ms`, css.total);
        console.log('%c Phase Duration   % of total', css.header);
        console.log('%c─────────────────────────────────────────────────────', 'color:#555;');
        for (const p of phases) {
          if (p.skipped) {
            console.log(`%c ${p.name.padEnd(30)} SKIPPED`, 'color:#888;');
            continue;
          }
          const pct = total > 0 ? ((p.duration / total) * 100).toFixed(1) : '0.0';
          const bar = '█'.repeat(Math.round(Number(pct) / 5));
          const color = p.duration < 500 ? css.fast : p.duration < 2000 ? css.medium : css.slow;
          const name = p.name.padEnd(30);
          const durStr = `${p.duration.toFixed(0)}ms`.padStart(8);
          const pctStr = `${pct}%`.padStart(6);
          console.log(`%c ${name}${durStr}  ${pctStr}  ${bar}`, color);
        }
        console.log('%c─────────────────────────────────────────────────────', 'color:#555;');
        console.log(`%c ${'TOTAL'.padEnd(30)}${total.toFixed(0).padStart(8)}ms 100.0%`, css.total);
        console.groupEnd();
        return { phases, total };
      }
    };
  }
};
