# AnswerHunter

AnswerHunter is an open-source Chrome extension that helps students extract questions from the current page, search web evidence, and suggest the best answer with AI.

---

## English

### What it does
- Extracts question text from the active tab (including iframe pages).
- Searches multiple sources using Serper.
- Scores and ranks evidence to reduce false positives from similar questions.
- Uses Groq to infer answers when explicit evidence is weak.
- Shows reliability state for every answer:
  - `Confirmed by sources`
  - `Conflict`
  - `Inconclusive`
- Saves results in a local Binder for study and review.

### Core architecture
- `src/controllers` - popup and binder orchestration
- `src/services` - extraction, search, API calls
- `src/models` - settings and storage persistence
- `src/views` - popup rendering
- `src/i18n` - UI translations (`en`, `pt-BR`)

### Required API keys
- Groq API key (required)
- Serper API key (required)
- Gemini API key (optional fallback)

Setup is done directly in the extension popup. Click the gear icon to open setup.

### Language support
- English
- Portuguese (Brazil)

Use the language selector in the popup header.

### Local development
1. Clone this repository.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked` and select this project folder.
5. Open the extension popup and run setup.

### Security model
- API keys are never hardcoded in source.
- Keys are stored locally via `chrome.storage.sync`.
- No backend is required for normal usage.

---

## Portugues (Brasil)

### O que faz
- Extrai o texto da questao da aba ativa (incluindo iframes).
- Busca evidencias em varias fontes usando Serper.
- Pontua e ranqueia evidencias para reduzir falso positivo de questao parecida.
- Usa Groq para inferir resposta quando a evidencia explicita e fraca.
- Mostra estado de confiabilidade para cada resposta:
  - `Confirmado por fontes`
  - `Conflito`
  - `Inconclusivo`
- Salva resultados no fichario para estudo e revisao.

### Arquitetura principal
- `src/controllers` - orquestracao do popup e fichario
- `src/services` - extracao, busca e chamadas de API
- `src/models` - persistencia de configuracoes e dados
- `src/views` - renderizacao da interface
- `src/i18n` - traducoes (`en`, `pt-BR`)

### Chaves de API obrigatorias
- Chave Groq (obrigatoria)
- Chave Serper (obrigatoria)
- Chave Gemini (opcional, fallback)

A configuracao e feita no popup da extensao. Clique na engrenagem para abrir.

### Idiomas
- Ingles
- Portugues (Brasil)

Use o seletor de idioma no cabecalho do popup.

### Desenvolvimento local
1. Clone este repositorio.
2. Abra `chrome://extensions`.
3. Ative `Modo do desenvolvedor`.
4. Clique em `Carregar sem compactacao` e selecione esta pasta.
5. Abra o popup da extensao e execute a configuracao.

### Modelo de seguranca
- Nenhuma API key fica hardcoded no codigo.
- As chaves ficam no `chrome.storage.sync` local do usuario.
- Nao existe backend obrigatorio para uso comum.

---

## Additional docs
- Full install and API setup guide: `COMO_INSTALAR.md`
- Technical documentation: `DOCUMENTATION.md`
