# AnswerHunter

AnswerHunter is an open-source Chrome extension that helps students extract questions from the current page, search web evidence, and suggest the best answer with AI.

---

## English

### Who is this for?
As an **academic extension** powered by **Artificial Intelligence for studies**, AnswerHunter is designed for students who need fast assistance. Whether you are looking for an **exam answer key**, finding **answers to questions**, studying for **university exams**, or solving **civil service exam questions**, the tool acts as your invisible assistant. It automates searches that would normally take hours across major educational document and Q&A platforms like **Passei Direto**, **Brainly**, **Studocu**, and **Qconcursos**.

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
- No backend is used; everything runs locally in the extension.

---

## Português (Brasil)

### Para quem é?
Sendo uma **extensão acadêmica** impulsionada por **Inteligência Artificial para estudos**, o AnswerHunter foi desenhado para estudantes que precisam de ajuda ágil. Seja buscando o **gabarito de provas**, encontrando **respostas de questões** complexas, revisando para **provas universitárias** ou resolvendo **questões de concursos**, a ferramenta atua como um assistente invisível. Ela automatiza pesquisas que normalmente levariam horas em plataformas conceituadas de documentos e perguntas educacionais, como **Passei Direto**, **Brainly**, **Studocu** e **Qconcursos**.

### O que faz
- Extrai o texto da questão da aba ativa (incluindo iframes).
- Busca evidências em várias fontes usando Serper.
- Pontua e ranqueia evidências para reduzir falso positivo de questão parecida.
- Usa Groq para inferir resposta quando a evidência explícita é fraca.
- Mostra estado de confiabilidade para cada resposta:
  - `Confirmado por fontes`
  - `Conflito`
  - `Inconclusivo`
- Salva resultados no fichário para estudo e revisão.

### Arquitetura principal
- `src/controllers` - orquestração do popup e fichário
- `src/services` - extração, busca e chamadas de API
- `src/models` - persistência de configurações e dados
- `src/views` - renderização da interface
- `src/i18n` - traduções (`en`, `pt-BR`)

### Chaves de API obrigatórias
- Chave Groq (obrigatória)
- Chave Serper (obrigatória)
- Chave Gemini (opcional, fallback)

A configuração é feita no popup da extensão. Clique na engrenagem para abrir.

### Idiomas
- Inglês
- Português (Brasil)

Use o seletor de idioma no cabeçalho do popup.

### Desenvolvimento local
1. Clone este repositório.
2. Abra `chrome://extensions`.
3. Ative `Modo do desenvolvedor`.
4. Clique em `Carregar sem compactação` e selecione esta pasta.
5. Abra o popup da extensão e execute a configuração.

### Modelo de segurança
- Nenhuma API key fica hardcoded no código.
- As chaves ficam no `chrome.storage.sync` local do usuário.
- Não existe backend; tudo roda localmente na extensão.

## Additional docs
- Full install and API setup guide: `COMO_INSTALAR.md`
- Technical documentation: `DOCUMENTATION.md`
