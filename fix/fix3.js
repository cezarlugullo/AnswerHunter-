const fs = require('fs');
let code = fs.readFileSync('../src/controllers/PopupController.js', 'utf8');

const regex = /async _persistAnswerOverride\(card, newLetter, newBody\)\s*\{\s*try\s*\{\s*const data = await chrome\.storage\.local\.get/;

const replacement = \sync _persistAnswerOverride(card, newLetter, newBody) {
      try {
        const fullAnswer = \\\Letra \\\: \\\\\\;
        card.querySelectorAll('[data-content]').forEach(btn => {
          try {
            if (btn.dataset.content) {
              const d = JSON.parse(decodeURIComponent(btn.dataset.content));
              d.answerLetter = newLetter;
              d.bestLetter = newLetter;
              d.answerText = newBody;
              d.answer = fullAnswer;
              btn.dataset.content = encodeURIComponent(JSON.stringify(d));
            }
          } catch (e) {}
        });
        const data = await chrome.storage.local.get\;

code = code.replace(regex, replacement);
fs.writeFileSync('../src/controllers/PopupController.js', code);

