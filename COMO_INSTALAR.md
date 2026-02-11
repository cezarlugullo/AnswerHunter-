# AnswerHunter Setup Guide / Guia de Configuração

This guide is bilingual (`EN` + `PT-BR`) and focused on non-technical users.

## Quick links
- Groq keys: https://console.groq.com/keys
- Serper keys: https://serper.dev/api-key
- Gemini keys (optional): https://aistudio.google.com/app/apikey

---

## ENGLISH

### 1) Install extension in Chrome (developer mode)
1. Download and extract this project.
2. Open `chrome://extensions`.
3. Enable `Developer mode` (top-right).
4. Click `Load unpacked`.
5. Select the folder containing `manifest.json`.

### 2) Open AnswerHunter and run first setup
1. Click the extension icon.
2. Open AnswerHunter popup.
3. On first run, a welcome guide appears automatically.
4. Click `Start setup`.

### 3) Get your Groq API key (required)
1. Open https://console.groq.com/keys
2. Sign in or create a free account.
3. Click `Create API Key`.
4. Copy the key and paste into AnswerHunter.
5. Click `Test`.

![Groq login screen](docs/screenshots/groq-login.png)

### 4) Get your Serper API key (required)
1. Open https://serper.dev/api-key
2. Sign in or create a free account.
3. Copy your API key from dashboard.
4. Paste into AnswerHunter.
5. Click `Test`.

![Serper login screen](docs/screenshots/serper-login.png)

### 5) Gemini key (optional)
1. Open https://aistudio.google.com/app/apikey
2. Create an API key.
3. Paste into AnswerHunter (optional).
4. Click `Test` if provided.

### 6) Save setup
1. After Groq + Serper are valid, click `Save settings`.
2. The setup panel closes and you can start searching.

![AnswerHunter setup panel](docs/screenshots/answerhunter-setup.png)

### 7) Change extension language
1. Open popup.
2. Use the language selector in the header.
3. Choose `English` or `Portuguese (Brazil)`.

### Troubleshooting
- `SETUP_REQUIRED`: required keys are missing. Open gear icon and configure Groq + Serper.
- `Invalid key`: confirm key copy (no spaces at start/end).
- No answers found: select full question text including options and retry.

---

## PORTUGUÊS (BRASIL)

### 1) Instalar a extensão no Chrome (modo desenvolvedor)
1. Baixe e extraia este projeto.
2. Abra `chrome://extensions`.
3. Ative `Modo do desenvolvedor` (canto superior direito).
4. Clique em `Carregar sem compactação`.
5. Selecione a pasta que contém `manifest.json`.

### 2) Abrir o AnswerHunter e iniciar configuração
1. Clique no ícone da extensão.
2. Abra o popup do AnswerHunter.
3. No primeiro uso, o guia de boas-vindas abre automaticamente.
4. Clique em `Iniciar configuração`.

### 3) Obter chave da API Groq (obrigatória)
1. Acesse https://console.groq.com/keys
2. Entre ou crie uma conta gratuita.
3. Clique em `Create API Key`.
4. Copie a chave e cole no AnswerHunter.
5. Clique em `Testar`.

![Tela de login Groq](docs/screenshots/groq-login.png)

### 4) Obter chave da API Serper (obrigatória)
1. Acesse https://serper.dev/api-key
2. Entre ou crie conta gratuita.
3. Copie a API key do dashboard.
4. Cole no AnswerHunter.
5. Clique em `Testar`.

![Tela de login Serper](docs/screenshots/serper-login.png)

### 5) Chave Gemini (opcional)
1. Acesse https://aistudio.google.com/app/apikey
2. Gere uma API key.
3. Cole no AnswerHunter (opcional).
4. Clique em `Testar` se desejar validar.

### 6) Salvar configuração
1. Com Groq + Serper validados, clique em `Salvar configuracoes`.
2. O painel fecha e a extensão fica pronta para uso.

![Painel de configuração AnswerHunter](docs/screenshots/answerhunter-setup.png)

### 7) Trocar idioma da extensão
1. Abra o popup.
2. Use o seletor de idioma no cabeçalho.
3. Escolha `Inglês` ou `Português (Brasil)`.

### Solução de problemas
- `SETUP_REQUIRED`: faltam chaves obrigatórias. Clique na engrenagem e configure Groq + Serper.
- `Chave inválida`: confirme cópia completa da chave (sem espaços).
- Sem resposta: selecione a questão completa com alternativas e tente novamente.

---

## Screenshot note
If your repo does not include the PNG files yet, add them to:
- `docs/screenshots/groq-login.png`
- `docs/screenshots/serper-login.png`
- `docs/screenshots/answerhunter-setup.png`

The markdown links above will work automatically after adding these images.
