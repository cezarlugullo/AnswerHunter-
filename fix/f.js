const fs = require('fs');
let code = fs.readFileSync('../src/controllers/PopupController.js', 'utf8');
let target1 = 'async _persistAnswerOverride(card, newLetter, newBody) {\r\n      try {\r\n        const data = await chrome.storage.local.get';
let target2 = target1.replace('\r\n', '\n').replace('\r\n', '\n');
let replacePart1 = 'async _persistAnswerOverride(card, newLetter, newBody) {\n      try {\n        const fullAnswer = Letra : ;';
let replacePart2 = '\n        card.querySelectorAll([data-content]).forEach(btn => { try { if (btn.dataset.content) { const d = JSON.parse(decodeURIComponent(btn.dataset.content)); d.answerLetter = newLetter; d.bestLetter = newLetter; d.answerText = newBody; d.answer = fullAnswer; btn.dataset.content = encodeURIComponent(JSON.stringify(d)); } } catch (e) {} });\n        const data = await chrome.storage.local.get';
code = code.replace(target1, replacePart1.replace('newLetter', '$'+'{newLetter}').replace('newBody', '$'+'{newBody}') + replacePart2);
code = code.replace(target2, replacePart1.replace('newLetter', '$'+'{newLetter}').replace('newBody', '$'+'{newBody}') + replacePart2);
fs.writeFileSync('../src/controllers/PopupController.js', code);
