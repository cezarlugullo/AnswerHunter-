/**
 * PlatformExtractors.js
 * Phase 2.1 — Platform-specific extractors for known educational sites.
 * Each extractor uses CSS selectors specific to the platform's DOM structure,
 * providing much higher accuracy than generic heuristics.
 *
 * Each extractor is a function meant to be injected via chrome.scripting.executeScript.
 * Returns { text, platform, confidence } or null if the platform is not detected.
 */
export const PlatformExtractors = {

    /**
     * Detects which platform the current page belongs to.
     * Returns the platform key or null.
     * Injected into the page via executeScript.
     */
    detectPlatformScript: function () {
        const url = window.location.href.toLowerCase();
        const host = window.location.hostname.toLowerCase();

        // Passei Direto
        if (host.includes('passeidireto.com')) return 'passeiDireto';

        // Estácio (SIA / AVA)
        if (host.includes('estacio.br') || host.includes('sia.estacio') || host.includes('simulado.estacio')) return 'estacio';

        // Gran Cursos
        if (host.includes('grancursosonline.com.br') || host.includes('gran.com.br')) return 'gran';

        // Estratégia Concursos
        if (host.includes('estrategiaconcursos.com.br') || host.includes('app.estrategia')) return 'estrategia';

        // QConcursos
        if (host.includes('qconcursos.com')) return 'qconcursos';

        // Brainly
        if (host.includes('brainly.com')) return 'brainly';

        // Unicesumar / Studeo
        if (host.includes('studeo.unicesumar') || host.includes('unicesumar.com')) return 'unicesumar';

        // Unopar / Anhanguera / Kroton AVA
        if (host.includes('colaborar') || host.includes('unopar.') || host.includes('anhanguera.') || host.includes('kroton.')) return 'krotonAva';

        // Generic LMS detection via data attributes
        if (document.querySelector('[data-section="section_cms-atividade"]')) return 'krotonAva';
        if (document.querySelector('[data-testid="openResponseQuestionHeader"]')) return 'krotonAva';

        return null;
    },

    /**
     * PasseiDireto — Extracts from exercise/question pages
     */
    extractPasseiDiretoScript: function () {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const noise = /\b(?:gabarito|resposta\s+correta|alternativa\s+correta|parabéns|confira|você\s+acertou)\b/i;

        // Question text
        const questionEl =
            document.querySelector('[class*="question-statement"]') ||
            document.querySelector('[class*="question-text"]') ||
            document.querySelector('[class*="enunciado"]') ||
            document.querySelector('.exercise-question');

        if (!questionEl) return null;

        let stem = clean(questionEl.innerText || questionEl.textContent || '');
        const noiseIdx = stem.search(noise);
        if (noiseIdx > 20) stem = stem.substring(0, noiseIdx).trim();

        // Alternatives
        const altEls = document.querySelectorAll(
            '[class*="alternative"], [class*="alternativa"], [class*="option-item"], ' +
            '.exercise-option, [class*="choice"]'
        );

        const options = [];
        const letters = ['A', 'B', 'C', 'D', 'E'];
        altEls.forEach((el, i) => {
            if (i >= 5) return;
            let text = clean(el.innerText || el.textContent || '');
            // Strip leading letter if already present
            text = text.replace(/^\s*[A-E]\s*[\)\.\-:]\s*/i, '').trim();
            const ni = text.search(noise);
            if (ni > 1) text = text.substring(0, ni).trim();
            if (text.length >= 1) {
                options.push(`${letters[i]}) ${text}`);
            }
        });

        if (!stem || stem.length < 20) return null;

        return {
            text: options.length >= 2 ? `${stem}\n${options.join('\n')}` : stem,
            platform: 'passeiDireto',
            confidence: options.length >= 3 ? 0.92 : 0.7,
            optionCount: options.length
        };
    },

    /**
     * QConcursos — Highly structured exam question site
     */
    extractQConcursosScript: function () {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

        const questionEl =
            document.querySelector('.q-question-enunciation') ||
            document.querySelector('[class*="question-enunciation"]') ||
            document.querySelector('[class*="enunciado"]') ||
            document.querySelector('.question__text');

        if (!questionEl) return null;

        const stem = clean(questionEl.innerText || '');
        if (stem.length < 20) return null;

        const altEls = document.querySelectorAll(
            '.q-question-alternative, [class*="question-alternative"], ' +
            '.question__option, [class*="alternativa"]'
        );

        const options = [];
        altEls.forEach((el) => {
            const text = clean(el.innerText || '');
            const m = text.match(/^\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i);
            if (m && m[2].trim()) {
                options.push(`${m[1].toUpperCase()}) ${m[2].trim()}`);
            }
        });

        return {
            text: options.length >= 2 ? `${stem}\n${options.join('\n')}` : stem,
            platform: 'qconcursos',
            confidence: options.length >= 4 ? 0.95 : 0.8,
            optionCount: options.length
        };
    },

    /**
     * Gran Cursos — Question pages
     */
    extractGranScript: function () {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

        const questionEl =
            document.querySelector('[class*="question-text"]') ||
            document.querySelector('[class*="questao-texto"]') ||
            document.querySelector('[class*="enunciado"]') ||
            document.querySelector('.statement');

        if (!questionEl) return null;

        const stem = clean(questionEl.innerText || '');
        if (stem.length < 20) return null;

        const altEls = document.querySelectorAll(
            '[class*="alternative"], [class*="alternativa"], ' +
            '[class*="option"], .choice-item'
        );

        const options = [];
        const seen = new Set();
        altEls.forEach((el) => {
            const text = clean(el.innerText || '');
            const m = text.match(/^\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i);
            if (m && m[2].trim() && !seen.has(m[1].toUpperCase())) {
                seen.add(m[1].toUpperCase());
                options.push(`${m[1].toUpperCase()}) ${m[2].trim()}`);
            }
        });

        return {
            text: options.length >= 2 ? `${stem}\n${options.join('\n')}` : stem,
            platform: 'gran',
            confidence: options.length >= 3 ? 0.9 : 0.7,
            optionCount: options.length
        };
    },

    /**
     * Estratégia Concursos
     */
    extractEstrategiaScript: function () {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

        const questionEl =
            document.querySelector('[class*="question-statement"]') ||
            document.querySelector('[class*="questao"]') ||
            document.querySelector('.question-body');

        if (!questionEl) return null;

        const stem = clean(questionEl.innerText || '');
        if (stem.length < 20) return null;

        const altEls = document.querySelectorAll(
            '[class*="alternative"], [class*="opcao"], [class*="option"]'
        );

        const options = [];
        const seen = new Set();
        altEls.forEach((el) => {
            const text = clean(el.innerText || '');
            const m = text.match(/^\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i);
            if (m && m[2].trim() && !seen.has(m[1].toUpperCase())) {
                seen.add(m[1].toUpperCase());
                options.push(`${m[1].toUpperCase()}) ${m[2].trim()}`);
            }
        });

        return {
            text: options.length >= 2 ? `${stem}\n${options.join('\n')}` : stem,
            platform: 'estrategia',
            confidence: options.length >= 3 ? 0.9 : 0.7,
            optionCount: options.length
        };
    },

    /**
     * Estácio SIA/AVA
     */
    extractEstacioScript: function () {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

        // Estácio often wraps questions in .question-text or numbered divs
        const questionEl =
            document.querySelector('.question-text') ||
            document.querySelector('[class*="enunciado"]') ||
            document.querySelector('[class*="pergunta"]');

        if (!questionEl) return null;

        const stem = clean(questionEl.innerText || '');
        if (stem.length < 20) return null;

        const altEls = document.querySelectorAll('.option, [class*="alternativa"], [class*="opcao"]');
        const options = [];
        const seen = new Set();
        altEls.forEach((el) => {
            const text = clean(el.innerText || '');
            const m = text.match(/^\s*([A-E])\s*[\)\.\-:]\s*(.+)$/i);
            if (m && m[2].trim() && !seen.has(m[1].toUpperCase())) {
                seen.add(m[1].toUpperCase());
                options.push(`${m[1].toUpperCase()}) ${m[2].trim()}`);
            }
        });

        return {
            text: options.length >= 2 ? `${stem}\n${options.join('\n')}` : stem,
            platform: 'estacio',
            confidence: options.length >= 3 ? 0.88 : 0.65,
            optionCount: options.length
        };
    },

    /**
     * Returns the appropriate extractor function for the given platform key.
     */
    getExtractorForPlatform(platform) {
        const map = {
            passeiDireto: this.extractPasseiDiretoScript,
            qconcursos: this.extractQConcursosScript,
            gran: this.extractGranScript,
            estrategia: this.extractEstrategiaScript,
            estacio: this.extractEstacioScript,
            // krotonAva is handled by the existing extractQuestionOnlyScript
        };
        return map[platform] || null;
    }
};
