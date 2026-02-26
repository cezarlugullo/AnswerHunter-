/**
 * HumanMouseSimulator.js
 * 
 * Simulates human-like mouse movement using cubic Bezier curves.
 * Inspired by ghost-cursor (github.com/Xetera/ghost-cursor, ⭐1.4k)
 * Ported to pure JS for Chrome MV3 extensions — no Node.js required.
 * 
 * Algorithm:
 *   1. Generate cubic Bezier curve from current to target position
 *   2. Add random control points for natural curve shape
 *   3. Walk the curve with variable speed (acceleration + deceleration)
 *   4. Add micro-jitter at each step (hand tremor simulation)
 *   5. Optional: overshoot target and correct back
 * 
 * @license MIT
 */
export class HumanMouseSimulator {

  static DEFAULT_CONFIG = {
    steps:         25,       // Points along Bezier curve
    stepDelayMs:   8,        // Base delay between steps (ms)
    jitterMax:     2.5,      // Max pixel jitter per step
    overshootPct:  0.12,     // 12% chance of overshoot
    overshootPx:   8,        // Max overshoot distance
    easingPower:   2,        // Easing curve power (2 = quadratic)
  };

  /**
   * Injects this simulator into a Chrome tab.
   * After injection, call window.__humanMouse.moveTo(x, y) from page context.
   */
  static async inject(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: HumanMouseSimulator._pageScript,
    });
  }

  /**
   * Moves mouse from current to target position with human-like curve.
   * Runs inside the page context via executeScript.
   */
  static async moveTo(tabId, targetX, targetY, config = {}) {
    const cfg = { ...HumanMouseSimulator.DEFAULT_CONFIG, ...config };
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (tx, ty, cfg) => window.__humanMouse?.moveTo(tx, ty, cfg),
      args: [targetX, targetY, cfg],
    });
  }

  /**
   * Performs a full human-like interaction sequence:
   * move → hover → optional scroll → optional click
   */
  static async interact(tabId, options = {}) {
    const {
      targetX   = 400 + Math.random() * 400,
      targetY   = 200 + Math.random() * 300,
      doClick   = false,
      doScroll  = true,
      scrollPx  = 60 + Math.random() * 120,
      config    = {},
    } = options;

    await HumanMouseSimulator.inject(tabId);
    await HumanMouseSimulator.moveTo(tabId, targetX, targetY, config);

    if (doScroll) {
      await new Promise(r => setTimeout(r, 150 + Math.random() * 200));
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (px) => {
          window.dispatchEvent(new WheelEvent('wheel', {
            deltaY: px, bubbles: true, cancelable: true,
            clientX: window.innerWidth / 2,
            clientY: window.innerHeight / 2,
          }));
          window.scrollBy({ top: px, behavior: 'smooth' });
        },
        args: [scrollPx],
      });
    }

    if (doClick) {
      await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (x, y) => {
          const el = document.elementFromPoint(x, y);
          if (el) {
            el.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
            setTimeout(() => el.dispatchEvent(new MouseEvent('mouseup',  { clientX: x, clientY: y, bubbles: true })), 60 + Math.random() * 80);
            setTimeout(() => el.dispatchEvent(new MouseEvent('click',    { clientX: x, clientY: y, bubbles: true })), 120 + Math.random() * 60);
          }
        },
        args: [targetX, targetY],
      });
    }
  }

  /**
   * Script injected into page context.
   * Implements the Bezier curve mouse movement algorithm.
   */
  static _pageScript() {
    if (window.__humanMouse) return;

    window.__humanMouse = {
      x: Math.random() * 400 + 100,
      y: Math.random() * 300 + 100,

      // ── Cubic Bezier point calculation ──────────────────────────
      // B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
      bezier(t, p0, p1, p2, p3) {
        const u = 1 - t;
        return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
      },

      // ── Easing function (ease-in-out) ────────────────────────────
      // Simulates acceleration at start and deceleration at end
      easeInOut(t, power = 2) {
        return t < 0.5
          ? Math.pow(2 * t, power) / 2
          : 1 - Math.pow(2 * (1 - t), power) / 2;
      },

      // ── Generate random control points for natural curve ─────────
      randomControl(x0, y0, x1, y1) {
        const midX = (x0 + x1) / 2;
        const midY = (y0 + y1) / 2;
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const spread = dist * 0.3;
        return {
          cx1: midX + (Math.random() - 0.5) * spread * 2,
          cy1: midY + (Math.random() - 0.5) * spread * 2,
          cx2: midX + (Math.random() - 0.5) * spread,
          cy2: midY + (Math.random() - 0.5) * spread,
        };
      },

      // ── Main movement function ───────────────────────────────────
      async moveTo(targetX, targetY, cfg = {}) {
        const steps       = cfg.steps       || 25;
        const stepDelay   = cfg.stepDelayMs || 8;
        const jitterMax   = cfg.jitterMax   || 2.5;
        const overshootP  = cfg.overshootPct || 0.12;
        const overshootPx = cfg.overshootPx  || 8;
        const easingPow   = cfg.easingPower  || 2;

        // Optional overshoot: go slightly past target then correct
        let finalX = targetX;
        let finalY = targetY;
        if (Math.random() < overshootP) {
          const angle = Math.atan2(targetY - this.y, targetX - this.x);
          const over  = (Math.random() * overshootPx);
          finalX = targetX + Math.cos(angle) * over;
          finalY = targetY + Math.sin(angle) * over;
        }

        const { cx1, cy1, cx2, cy2 } = this.randomControl(this.x, this.y, finalX, finalY);

        for (let i = 0; i <= steps; i++) {
          const t  = i / steps;
          const et = this.easeInOut(t, easingPow);

          const nx = this.bezier(et, this.x, cx1, cx2, finalX)
                   + (Math.random() - 0.5) * jitterMax;
          const ny = this.bezier(et, this.y, cy1, cy2, finalY)
                   + (Math.random() - 0.5) * jitterMax;

          document.dispatchEvent(new MouseEvent('mousemove', {
            clientX:   Math.round(nx),
            clientY:   Math.round(ny),
            screenX:   Math.round(nx + window.screenX),
            screenY:   Math.round(ny + window.screenY),
            movementX: Math.round(nx - (i > 0 ? this._lastX : this.x)),
            movementY: Math.round(ny - (i > 0 ? this._lastY : this.y)),
            bubbles:   true,
            cancelable: true,
            buttons:   0,
          }));

          this._lastX = nx;
          this._lastY = ny;

          // Variable step delay: faster in middle, slower at start/end
          const speedFactor = 0.3 + Math.sin(t * Math.PI) * 0.7;
          await new Promise(r => setTimeout(r, stepDelay / speedFactor + Math.random() * 4));
        }

        // If we overshot, correct back to real target
        if (finalX !== targetX || finalY !== targetY) {
          await this.moveTo(targetX, targetY, { ...cfg, steps: 6, overshootPct: 0 });
        } else {
          this.x = targetX;
          this.y = targetY;
        }
      },
    };

    console.debug('[CF-BYPASS] HumanMouse injected (Bezier curves active)');
  }
}
