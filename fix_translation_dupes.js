const fs = require('fs');

function removeDuplicatesInLangBlock(blockStr) {
    const lines = blockStr.split('\n');
    const seen = new Set();
    const result = [];
    // We want the LAST occurrence to win if it's an object property,
    // but esbuild warns about later declarations overriding earlier ones.
    // Actually, let's keep the FIRST occurrence (the original one) as it was probably right?
    // Wait, earlier the user and I added strings at the bottom of the dictionary. So we should keep the LAST occurrence!

    // traverse backwards
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const match = line.match(/^\s*'([^']+)':\s*'/);
        if (match) {
            const key = match[1];
            if (seen.has(key)) {
                // duplicate duplicate, skip creating
                continue;
            }
            seen.add(key);
            result.unshift(line);
        } else {
            result.unshift(line);
        }
    }
    return result.join('\n');
}

let code = fs.readFileSync('src/i18n/translations.js', 'utf8');

// The file has export const translations = { en: { ... }, 'pt-BR': { ... } };
// Let's just find the english block and portuguese block.
const enStart = code.indexOf('en: {');
const ptBStart = code.indexOf("'pt-BR': {");

let enBlock = code.substring(enStart, ptBStart);
let ptBBlock = code.substring(ptBStart);

enBlock = removeDuplicatesInLangBlock(enBlock);
ptBBlock = removeDuplicatesInLangBlock(ptBBlock);

// Re-inject missing openrouter strings if they got lost or don't exist
const openrouterEn = `
    'setup.openrouter.title': 'Optional: set up OpenRouter API',
    'setup.openrouter.step2': 'Sign up or Log in to OpenRouter.ai to get your API key.',
    'setup.openrouter.step3': 'Go to Keys, generate a new key and paste it below.',
    'setup.openrouter.tagline': 'OpenRouter provides free access to powerful models like DeepSeek and Qwen.',
    'setup.openrouter.modelLabel': 'Select Model',
    'setup.prefs.openrouterLabel': 'OpenRouter',
`;

const openrouterPt = `
    'setup.openrouter.title': 'Opcional: configure a API da OpenRouter',
    'setup.openrouter.step2': 'Crie uma conta ou faça login na OpenRouter.ai',
    'setup.openrouter.step3': 'Vá em Keys, gere uma chave nova e cole abaixo.',
    'setup.openrouter.tagline': 'OpenRouter fornece acesso gratuito a modelos como DeepSeek R1 e Qwen 32B.',
    'setup.openrouter.modelLabel': 'Selecionar Modelo',
    'setup.prefs.openrouterLabel': 'OpenRouter',
`;

if (!enBlock.includes("'setup.openrouter.tagline'")) {
    enBlock = enBlock.replace("'setup.gemini.finishHelp'", openrouterEn + "\n    'setup.gemini.finishHelp'");
}

if (!ptBBlock.includes("'setup.openrouter.tagline'")) {
    ptBBlock = ptBBlock.replace("'setup.gemini.finishHelp'", openrouterPt + "\n    'setup.gemini.finishHelp'");
}

fs.writeFileSync('src/i18n/translations.js', code.substring(0, enStart) + enBlock + ptBBlock);
console.log('Translations fixed without duplicates.');
