# AnswerHunter Technical Documentation

## ENGLISH

### 1. Overview
AnswerHunter is a Chrome extension that extracts educational questions from the active tab, searches external evidence, and suggests an answer with weighted confidence.

Main design goals:
- Keep setup simple for non-technical users.
- Avoid backend dependency for normal usage.
- Prioritize evidence over pure model guessing.
- Expose uncertainty (`Confirmed`, `Conflict`, `Inconclusive`).

### 2. High-level architecture
```
src/
  content/        # DOM extraction scripts injected into pages
  controllers/    # Popup orchestration and binder actions
  i18n/           # Translation dictionaries and language service
  models/         # Settings + persistent binder data
  popup/          # Popup entry HTML/CSS/boot script
  services/       # API clients, search ranking, extraction helpers
  utils/          # Pure helpers and formatting
  views/          # Popup rendering layer
```

### 3. Runtime flow
1. User opens popup.
2. `PopupController` initializes `I18nService`, settings, onboarding flags, and binder.
3. If required providers are missing (`Groq`, `Serper`), setup wizard is shown.
4. Search flow:
   - extract question from page
   - query Serper
   - fetch and score evidence
   - classify result state
   - render answer + sources + confidence
5. Extract flow:
   - parse Q/A from page
   - refine with AI
   - save and display

### 4. Provider model
Required:
- Groq: AI analysis and fallback answer generation.
- Serper: web search source discovery.

Optional:
- Gemini: reserved fallback channel (non-blocking when missing).

### 5. Settings and security
`SettingsModel` stores:
- language (`en`, `pt-BR`)
- provider API keys
- model and endpoint settings
- setup readiness flags

Security notes:
- no hardcoded API keys in repository
- keys stored locally in `chrome.storage.sync`
- no mandatory backend required

### 6. Search reliability system
`SearchService` applies:
- question canonicalization
- similarity gating to reject unrelated pages
- option match counting
- explicit-answer extraction patterns
- local evidence window validation
- multi-source weighted voting

Output states:
- `confirmed`: strong explicit agreement
- `conflict`: competing letters with low margin
- `inconclusive`: weak or indirect evidence

### 7. i18n system
- `src/i18n/translations.js`: dictionaries
- `src/i18n/I18nService.js`: runtime translation and DOM application
- language selector in popup header
- all key statuses and setup messages translated

### 8. Binder storage
`StorageModel` stores tree data in `chrome.storage.sync`:
- folders
- question records
- drag/drop structure

Backup/import:
- export to JSON
- import from JSON with full replace confirmation

### 9. Error handling strategy
Common error codes:
- `SETUP_REQUIRED`: required keys missing

UX behavior:
- open setup panel automatically
- show user-friendly error toast/status
- continue gracefully when optional providers are missing

### 10. Extension permissions
Manifest permissions:
- `activeTab`
- `scripting`
- `storage`
- `clipboardWrite`

Host permissions:
- Groq API
- Serper API
- Gemini API
- `<all_urls>` for extraction coverage

---

## PORTUGUES (BRASIL)

### 1. Visao geral
AnswerHunter e uma extensao Chrome que extrai questoes da aba ativa, busca evidencias na web e sugere resposta com confianca ponderada.

Objetivos principais:
- setup simples para usuario leigo
- sem dependencia obrigatoria de backend
- priorizar evidencia em vez de chute de modelo
- expor incerteza (`Confirmado`, `Conflito`, `Inconclusivo`)

### 2. Arquitetura de alto nivel
```
src/
  content/        # scripts de extracao no DOM
  controllers/    # orquestracao do popup e fichario
  i18n/           # traducoes e servico de idioma
  models/         # configuracoes e dados persistentes
  popup/          # entrada do popup (html/css/js)
  services/       # APIs, ranking de busca e extracao
  utils/          # helpers puros
  views/          # renderizacao da interface
```

### 3. Fluxo de execucao
1. Usuario abre o popup.
2. `PopupController` inicializa i18n, configuracoes, onboarding e fichario.
3. Se faltar provedor obrigatorio (`Groq`, `Serper`), abre o wizard.
4. Fluxo Buscar:
   - extrai questao da pagina
   - consulta Serper
   - busca e pontua evidencias
   - classifica estado final
   - renderiza resposta + fontes + confianca
5. Fluxo Extrair:
   - le pergunta/resposta da pagina
   - refina com IA
   - salva e exibe

### 4. Modelo de provedores
Obrigatorios:
- Groq: analise IA e fallback
- Serper: descoberta de fontes

Opcional:
- Gemini: canal de fallback nao bloqueante

### 5. Configuracoes e seguranca
`SettingsModel` guarda:
- idioma (`en`, `pt-BR`)
- chaves de API
- endpoints/modelos
- flags de prontidao do setup

Notas de seguranca:
- sem chaves hardcoded no repositorio
- chaves guardadas em `chrome.storage.sync`
- sem backend obrigatorio para uso normal

### 6. Sistema de confiabilidade da busca
`SearchService` aplica:
- canonicalizacao da questao
- filtro de similaridade para descartar pagina diferente
- contagem de match de alternativas
- extracao de gabarito explicito
- janela local de evidencia
- votacao ponderada multi-fonte

Estados de saida:
- `confirmed`: acordo forte com gabarito explicito
- `conflict`: letras concorrentes com margem baixa
- `inconclusive`: evidencia fraca/indireta

### 7. Sistema de idioma
- `src/i18n/translations.js`: dicionarios
- `src/i18n/I18nService.js`: aplicacao de traducao no DOM
- seletor de idioma no cabecalho do popup
- mensagens principais traduzidas

### 8. Persistencia do fichario
`StorageModel` usa `chrome.storage.sync` para:
- estrutura de pastas
- itens salvos
- organizacao por drag and drop

Backup/importacao:
- exporta JSON
- importa JSON com confirmacao de sobrescrita

### 9. Tratamento de erro
Codigo comum:
- `SETUP_REQUIRED`: faltam chaves obrigatorias

Comportamento UX:
- abre setup automaticamente
- mostra status/toast amigavel
- segue normalmente se provedor opcional faltar

### 10. Permissoes da extensao
Permissoes:
- `activeTab`
- `scripting`
- `storage`
- `clipboardWrite`

Host permissions:
- API Groq
- API Serper
- API Gemini
- `<all_urls>` para cobertura de extracao
