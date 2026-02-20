const fs = require('fs');
const file = 'src/popup/popup.css';
let css = fs.readFileSync(file, 'utf8');

const newCss = `
/* ========== TRANSLATION & CHAT STUDY FEATURES ========== */

.dict-tooltip {
  font-family: var(--ah-font-main, system-ui, sans-serif);
}

.study-chat-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background-color: var(--ah-surface, #fff);
  border: 1px solid var(--ah-border, #eee);
  border-radius: 12px;
  overflow: hidden;
}

.study-chat-history {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 250px;
  overflow-y: auto;
  padding: 12px;
  background-color: var(--ah-surface-alt, #fafafa);
}

.chat-message {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: 90%;
}

.chat-message .material-symbols-rounded {
  font-size: 18px;
  color: var(--ah-text-muted, #888);
  margin-bottom: 2px;
}

.chat-message .msg-content {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ah-text, #333);
}

.chat-message.ai-message {
  align-self: flex-start;
}

.chat-message.ai-message .msg-content {
  background-color: var(--ah-surface, #fff);
  border: 1px solid var(--ah-border, #eee);
  border-bottom-left-radius: 4px;
}

.chat-message.user-message {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.chat-message.user-message .msg-content {
  background-color: var(--ah-primary, #FF6B00);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.chat-message.user-message .material-symbols-rounded {
  color: var(--ah-primary, #FF6B00);
}

.study-chat-input-area {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--ah-border, #eee);
  background-color: var(--ah-surface, #fff);
}

.study-chat-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 13px;
  color: var(--ah-text, #333);
}

.study-chat-input::placeholder {
  color: var(--ah-text-muted, #aaa);
}

.study-chat-send {
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ah-primary, #FF6B00);
  cursor: pointer;
  padding: 4px;
  border-radius: 50%;
  transition: background-color 0.2s;
}

.study-chat-send:hover:not(:disabled) {
  background-color: rgba(255, 107, 0, 0.1);
}

.study-chat-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-msg .msg-content {
  color: #d32f2f;
  background-color: #ffebee;
  border-color: #ffcdd2;
}
`;

if (!css.includes('.study-chat-container')) {
    fs.appendFileSync(file, newCss);
    console.log("Appended Chat CSS");
} else {
    console.log("Chat CSS already exists");
}
`;

fs.writeFileSync('patch_css.js', scriptContent);
