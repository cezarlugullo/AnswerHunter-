const fs = require('fs');
let s = fs.readFileSync('src/services/ApiService.js', 'utf8');

// Pattern for simple fallback:
// let content = null;
// const geminiPrimary = await this._isGeminiPrimary();
// if (geminiPrimary) { ... } else { ... }

// We want to replace the standard tryGemini/tryGroq logic with something that includes tryOpenRouter.
// Wait, instead of regex matching everything which is fragile, let's inject a new fallback executer!

s = s.replace(/const fallbackChain = \[\];[\s\S]*?if \(!geminiPrimary && fallbackChain\.length > 1\) \{[\s\S]*?fallbackChain\.reverse\(\);\s*\}/,
    `const fallbackChain = [];
        if (settings.geminiApiKey) fallbackChain.push({ name: 'gemini', fn: tryGemini });
        if (settings.openrouterApiKey && this._openRouterQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: 'openrouter', fn: tryOpenRouter });
        }
        if (settings.groqApiKey && this._groqQuotaExhaustedUntil <= Date.now()) {
            fallbackChain.push({ name: 'groq', fn: tryGroq });
        }

        const primary = settings.primaryProvider || 'groq';
        if (primary === 'gemini') {
            const idx = fallbackChain.findIndex(p => p.name === 'gemini');
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
        } else if (primary === 'openrouter') {
            const idx = fallbackChain.findIndex(p => p.name === 'openrouter');
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
        } else {
            const idx = fallbackChain.findIndex(p => p.name === 'groq');
            if (idx > -1) fallbackChain.unshift(...fallbackChain.splice(idx, 1));
        }
`);

// For the rest of the functions that use:
// content = await tryGemini(); if (!content) content = await tryGroq();
// or
// content = await tryGroq(); if (!content) content = await tryGemini();

const replacementLogic = `const primary = settings.primaryProvider || 'groq';
        if (primary === 'openrouter') {
            content = await tryOpenRouter();
            if (!content) content = await tryGroq();
            if (!content) content = await tryGemini();
        } else if (primary === 'gemini') {
            content = await tryGemini();
            if (!content) content = await tryGroq();
            if (!content) content = await tryOpenRouter();
        } else {
            content = await tryGroq();
            if (!content) content = await tryOpenRouter();
            if (!content) content = await tryGemini();
        }`;

s = s.replace(/const geminiPrimary = await this\._isGeminiPrimary\(\);\s*if \(geminiPrimary\) \{\s*content = await tryGemini\(\);\s*if \(!content\) content = await tryGroq\(\);\s*\} else \{\s*content = await tryGroq\(\);\s*if \(!content\) content = await tryGemini\(\);\s*\}/g, replacementLogic);

// What about geminiPrimaryOpen?
const replacementOpen = `const primary = settings.primaryProvider || 'groq';
        if (primary === 'openrouter') {
            content = await tryOpenRouter();
            if (!content) content = await tryGroq();
            if (!content) content = await tryGemini();
        } else if (primary === 'gemini') {
            content = await tryGemini();
            if (!content) content = await tryOpenRouter();
            if (!content) content = await tryGroq();
        } else {
            content = await tryGroq();
            if (!content) content = await tryOpenRouter();
            if (!content) content = await tryGemini();
        }`;
s = s.replace(/const geminiPrimaryOpen = await this\._isGeminiPrimary\(\);\s*if \(geminiPrimaryOpen\) \{\s*content = await tryGemini\(\);\s*if \(!content\) content = await tryGroq\(\);\s*\} else \{\s*content = await tryGroq\(\);\s*if \(!content\) content = await tryGemini\(\);\s*\}/g, replacementOpen);

fs.writeFileSync('src/services/ApiService.js', s);
console.log('Fixed Fallbacks.');
