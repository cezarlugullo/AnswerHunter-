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

## PORTUGUÊS (BRASIL)

### 1. Visão geral
AnswerHunter é uma extensão Chrome que extrai questões da aba ativa, busca evidências na web e sugere resposta com confiança ponderada.

Objetivos principais:
- setup simples para usuário leigo
- sem dependência obrigatória de backend
- priorizar evidência em vez de chute de modelo
- expor incerteza (`Confirmado`, `Conflito`, `Inconclusivo`)

### 2. Arquitetura de alto nível
```
src/
   content/        # scripts de extração no DOM
   controllers/    # orquestração do popup e fichário
   i18n/           # traduções e serviço de idioma
   models/         # configurações e dados persistentes
   popup/          # entrada do popup (html/css/js)
   services/       # APIs, ranking de busca e extração
   utils/          # helpers puros
   views/          # renderização da interface
```

### 3. Fluxo de execução
1. Usuário abre o popup.
2. `PopupController` inicializa i18n, configurações, onboarding e fichário.
3. Se faltar provedor obrigatório (`Groq`, `Serper`), abre o wizard.
4. Fluxo Buscar:
   - extrai questão da página
   - consulta Serper
   - busca e pontua evidências
   - classifica estado final
   - renderiza resposta + fontes + confiança
5. Fluxo Extrair:
   - lê pergunta/resposta da página
   - refina com IA
   - salva e exibe

### 4. Modelo de provedores
Obrigatórios:
- Groq: análise IA e fallback
- Serper: descoberta de fontes

Opcional:
- Gemini: canal de fallback não bloqueante

### 5. Configurações e segurança
`SettingsModel` guarda:
- idioma (`en`, `pt-BR`)
- chaves de API
- endpoints/modelos
- flags de prontidão do setup

Notas de segurança:
- sem chaves hardcoded no repositório
- chaves guardadas em `chrome.storage.sync`
- sem backend obrigatório para uso normal

### 6. Sistema de confiabilidade da busca
`SearchService` aplica:
- canonicalização da questão
- filtro de similaridade para descartar página diferente
- contagem de match de alternativas
- extração de gabarito explícito
- janela local de evidência
- votação ponderada multi-fonte

Estados de saída:
- `confirmed`: acordo forte com gabarito explicito
- `conflict`: letras concorrentes com margem baixa
- `inconclusive`: evidência fraca/indireta

### 7. Sistema de idioma
- `src/i18n/translations.js`: dicionários
- `src/i18n/I18nService.js`: aplicação de tradução no DOM
- seletor de idioma no cabeçalho do popup
- mensagens principais traduzidas

### 8. Persistência do fichário
`StorageModel` usa `chrome.storage.sync` para:
- estrutura de pastas
- itens salvos
- organização por drag and drop

Backup/importação:
- exporta JSON
- importa JSON com confirmação de sobrescrita

### 9. Tratamento de erro
Código comum:
- `SETUP_REQUIRED`: faltam chaves obrigatórias

Comportamento UX:
- abre setup automaticamente
- mostra status/toast amigável
- segue normalmente se provedor opcional faltar

### 10. Permissões da extensão
Permissões:
- `activeTab`
- `scripting`
- `storage`
- `clipboardWrite`

Host permissions:
- API Groq
- API Serper
- API Gemini
- `<all_urls>` para cobertura de extração
