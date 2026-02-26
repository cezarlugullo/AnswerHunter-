const fs = require('fs');
const vm = require('vm');

function loadTranslations() {
  const code = fs.readFileSync('src/i18n/translations.js', 'utf8');
  const patched = code
    .replace(/export\s+const\s+SUPPORTED_LANGUAGES\s*=\s*/, 'const SUPPORTED_LANGUAGES = ')
    .replace(/export\s+const\s+TRANSLATIONS\s*=\s*/, 'const TRANSLATIONS = ')
    + '\nmodule.exports = { SUPPORTED_LANGUAGES, TRANSLATIONS };';

  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  vm.runInContext(patched, context);
  return context.module.exports;
}

function main() {
  const { SUPPORTED_LANGUAGES, TRANSLATIONS } = loadTranslations();
  const baseLang = 'en';

  if (!TRANSLATIONS[baseLang]) {
    console.error(`[i18n] Missing base language dictionary: ${baseLang}`);
    process.exit(1);
  }

  const baseKeys = new Set(Object.keys(TRANSLATIONS[baseLang]));
  let hasError = false;

  for (const lang of SUPPORTED_LANGUAGES) {
    const dict = TRANSLATIONS[lang];
    if (!dict || typeof dict !== 'object') {
      console.error(`[i18n] Missing dictionary for language: ${lang}`);
      hasError = true;
      continue;
    }

    const keys = new Set(Object.keys(dict));
    const missing = [...baseKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !baseKeys.has(key));

    if (missing.length || extra.length) {
      hasError = true;
      console.error(`\n[i18n] Language ${lang} is out of sync with ${baseLang}:`);
      if (missing.length) {
        console.error(`  Missing keys (${missing.length}):`);
        missing.slice(0, 30).forEach((key) => console.error(`    - ${key}`));
        if (missing.length > 30) console.error(`    ... and ${missing.length - 30} more`);
      }
      if (extra.length) {
        console.error(`  Extra keys (${extra.length}):`);
        extra.slice(0, 30).forEach((key) => console.error(`    + ${key}`));
        if (extra.length > 30) console.error(`    ... and ${extra.length - 30} more`);
      }
    }
  }

  if (hasError) {
    process.exit(1);
  }

  console.log('[i18n] OK: all supported languages are synchronized with en.');
}

main();
