const fs = require('fs');

let s = fs.readFileSync('src/services/ApiService.js', 'utf8');

const sNormalized = s.replace(/\r\n/g, '\n');

const startIndex = sNormalized.indexOf('    /**\n     * Prompt 1: Extract options (AI)');
const endIndex = sNormalized.indexOf('    /**\n     * Search on Serper (Google) with fallback to educational sites');

const newCode = `    /**
     * Extracts text from an image base64 dataUri using AI Vision
     */
    async aiExtractTextFromImage(dataUri) {
        if (!dataUri || !dataUri.startsWith('data:image/')) return '';
        const settings = await this._getSettings();
        const { groqApiUrl, groqApiKey, groqModelVision } = settings;

        const systemMsg = "Extraia rigorosamente o texto completo da imagem enviada. Responda APENAS com o texto, ignorando saudações.";
        
        const visionMessages = [
            { role: 'system', content: systemMsg },
            {
                role: 'user',
                content: [
                    { type: "text", text: "Transcrição fiel do conteúdo (preservando formato, alternativas, código, tabelas):" },
                    { type: "image_url", image_url: { url: dataUri } }
                ]
            }
        ];

        const tryGemini = async () => {
            if (!settings.geminiApiKey) return null;
            try {
                const base64Data = dataUri.split(',')[1];
                const mimeType = dataUri.split(';')[0].split(':')[1];
                const content = await this._callGemini([
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: [
                        { inline_data: { mime_type: mimeType, data: base64Data } },
                        { text: "Transcrição fiel do conteúdo:" }
                    ]}
                ], { temperature: 0.1, max_tokens: 1500, model: settings.geminiModel || 'gemini-2.5-flash' });
                if (!content || content.length < 20) {
                    console.warn('AnswerHunter: Gemini Vision OCR returned too little text:', (content || '').length);
                    return null;
                }
                console.log(\`AnswerHunter: Gemini Vision OCR success — \${content.length} chars extracted\`);
                return content;
            } catch (e) {
                console.warn('AnswerHunter: Gemini Vision OCR failed:', e?.message || e);
                return null;
            }
        };

        const tryOpenRouter = async () => {
            if (!settings.openrouterApiKey || this._openRouterQuotaExhaustedUntil > Date.now()) return null;
            try {
                const model = settings.openrouterModelSmart || 'deepseek/deepseek-r1:free';
                const content = await this._callOpenRouter(visionMessages, {
                    temperature: 0.1,
                    max_tokens: 1500,
                    model
                });
                if (!content || content.length < 20) {
                    return null;
                }
                return content;
            } catch (e) {
                return null;
            }
        };

        const tryGroq = async () => {
            if (!groqApiKey || this._groqQuotaExhaustedUntil > Date.now()) return null;
            const model = groqModelVision || 'meta-llama/llama-4-scout-17b-16e-instruct';
            try {
                console.log(\`AnswerHunter: Vision OCR — sending screenshot to Groq (\${model})...\`);
                const data = await this._withGroqRateLimit(() => this._fetch(groqApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': \`Bearer \${groqApiKey}\`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model,
                        messages: visionMessages,
                        temperature: 0.1,
                        max_tokens: 1500
                    })
                }));

                const content = (data.choices?.[0]?.message?.content || '').trim();
                if (content.length < 20) {
                    console.warn('AnswerHunter: Groq Vision OCR returned too little text:', content.length);
                    return null;
                }
                console.log(\`AnswerHunter: Groq Vision OCR success — \${content.length} chars extracted\`);
                return content;
            } catch (e) {
                console.warn('AnswerHunter: Groq Vision OCR failed:', e?.message || e);
                return null;
            }
        };

        try {
            const primary = settings.primaryProvider || 'groq';
            let result = null;
            if (primary === 'openrouter') {
                result = await tryOpenRouter();
                if (!result) result = await tryGroq();
                if (!result) result = await tryGemini();
            } else if (primary === 'gemini') {
                result = await tryGemini();
                if (!result) result = await tryOpenRouter();
                if (!result) result = await tryGroq();
            } else {
                result = await tryGroq();
                if (!result) result = await tryOpenRouter();
                if (!result) result = await tryGemini();
            }
            return result || '';
        } catch (error) {
            console.error('AnswerHunter: Vision OCR failed:', error);
            return '';
        }
    },

`;

// Perform replacement
if (startIndex !== -1 && endIndex !== -1) {
    const updated = sNormalized.substring(0, startIndex) + newCode + sNormalized.substring(endIndex);
    fs.writeFileSync('src/services/ApiService.js', updated);
    console.log('Restored aiExtractTextFromImage successfully.');
} else {
    console.log('Could not find start or end index', startIndex, endIndex);
}

