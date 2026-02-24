// ==UserScript==
// @name         Google Auth Platform Autofill (AnswerHunter)
// @namespace    https://answerhunter.local
// @version      1.0.0
// @description  Preenche automaticamente App Information no Google Auth Platform
// @match        https://console.cloud.google.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const APP_NAME = 'Extension AnswerHunter';
  const SUPPORT_EMAIL = 'cezarlugullo@gmail.com';

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setNativeValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    const setter = descriptor && descriptor.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function findTextboxByLabel(labelRegex) {
    const labels = Array.from(document.querySelectorAll('label, div, span'));
    for (const label of labels) {
      const text = (label.textContent || '').trim();
      if (!labelRegex.test(text)) continue;

      const forId = label.getAttribute && label.getAttribute('for');
      if (forId) {
        const direct = document.getElementById(forId);
        if (direct && (direct.tagName === 'INPUT' || direct.getAttribute('role') === 'textbox')) {
          return direct;
        }
      }

      const container = label.closest('form, [role="group"], .cfc-form-field, .mat-form-field') || label.parentElement;
      if (!container) continue;
      const input = container.querySelector('input, [role="textbox"]');
      if (input) return input;
    }

    const fallbackInputs = Array.from(document.querySelectorAll('input[aria-label], input[placeholder]'));
    return fallbackInputs.find((el) => {
      const probe = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`;
      return labelRegex.test(probe);
    }) || null;
  }

  function openEmailDropdown() {
    const candidates = Array.from(document.querySelectorAll('[role="combobox"], input, div'));
    for (const el of candidates) {
      const text = `${el.getAttribute?.('aria-label') || ''} ${el.textContent || ''}`.toLowerCase();
      if (!text.includes('user support email') && !text.includes('support email')) continue;

      if (el.getAttribute?.('role') === 'combobox') {
        el.click();
        return true;
      }

      const combo = el.closest('[role="combobox"], [aria-haspopup="listbox"]');
      if (combo) {
        combo.click();
        return true;
      }
    }
    return false;
  }

  async function pickFirstEmailOption() {
    const options = Array.from(document.querySelectorAll('[role="option"], li, div[role="menuitem"]'));

    const exact = options.find((opt) => (opt.textContent || '').trim().toLowerCase().includes(SUPPORT_EMAIL.toLowerCase()));
    if (exact) {
      exact.click();
      return true;
    }

    const firstEmailLike = options.find((opt) => /@/.test((opt.textContent || '').trim()));
    if (firstEmailLike) {
      firstEmailLike.click();
      return true;
    }

    return false;
  }

  async function fillAppInformation() {
    let changed = false;

    const appNameInput = findTextboxByLabel(/app\s*name/i);
    if (appNameInput && appNameInput.value !== APP_NAME) {
      setNativeValue(appNameInput, APP_NAME);
      changed = true;
    }

    const supportInput = findTextboxByLabel(/user\s*support\s*email|support\s*email/i);
    if (supportInput && supportInput.tagName === 'INPUT') {
      if (supportInput.value !== SUPPORT_EMAIL) {
        setNativeValue(supportInput, SUPPORT_EMAIL);
        changed = true;
      }
    } else {
      const opened = openEmailDropdown();
      if (opened) {
        await wait(400);
        const picked = await pickFirstEmailOption();
        changed = changed || picked;
      }
    }

    if (changed) {
      console.log('[AnswerHunter Autofill] Campos de App Information preenchidos.');
    }
  }

  let running = false;
  async function runSafely() {
    if (running) return;
    running = true;
    try {
      await fillAppInformation();
    } catch (err) {
      console.warn('[AnswerHunter Autofill] Falha no preenchimento automático:', err);
    } finally {
      running = false;
    }
  }

  const observer = new MutationObserver(() => {
    runSafely();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  runSafely();
})();
