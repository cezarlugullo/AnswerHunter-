# Critical Code Review

- Projeto: `C:/Users/cezar/OneDrive/Área de Trabalho/AnswerHunter`
- Data: `2026-03-04`
- Evidência dinâmica usada: `docs/qa/button-audit-raw.json` (162 ações, 6 cenários por ação)
- Escala: `S0` perda de dados/crash/segurança, `S1` feature principal quebrada, `S2` bug com workaround, `S3` cosmético/performance.

## 1) Camada de storage (get/set/migrations)

### 1.1 `StorageModel.init/save` (`src/models/StorageModel.js:28-73`)
- O que faz: carrega `binderStructure` de `chrome.storage.local` e serializa gravações com `_saveQueue`.
- Entradas assumidas: API `chrome.storage.local` disponível; estrutura em formato de array.
- Falhas prováveis:
  - `saveDisciplines` e `getDisciplines` logam erro mas resolvem promessa mesmo com `lastError` (`src/models/StorageModel.js:590-613`), podendo mascarar falha de persistência.
  - chamadas em contexto sem API `chrome` (fora da extensão) não representam comportamento real.
- Como comprovar funcionando:
  - execução de ações que gravam estado em `docs/qa/button-tests/popup-manualaddsavebtn-save-save-question.md` e `docs/qa/button-tests/popup-clearbinderbtn-delete-sweep.md`.
  - inspeção de `before/after` no `button-audit-raw.json`.
- Status: `⚠️` (funciona, mas com pontos de mascaramento de erro em caminhos de disciplinas).

### 1.2 `SettingsModel` split storage + migração (`src/models/SettingsModel.js:103-241`)
- O que faz: migra chaves sensíveis para `chrome.storage.local` e mantém não sensíveis em `chrome.storage.sync`.
- Entradas assumidas: ambas áreas de storage disponíveis e graváveis.
- Falhas prováveis:
  - `_migrateKeysToLocal` captura exceções e apenas registra warning (`src/models/SettingsModel.js:113-145`), sem sinalizar falha para UI.
- Como comprovar funcionando:
  - fluxos de setup e remoção de chaves (`docs/qa/button-tests/popup-remove-key-gemini-remove-gemini-key.md`, `popup-remove-key-openrouter-remove-key.md`, `popup-remove-key-serper-remove-serper-key.md`).
- Status: `⚠️`.

### 1.3 Migração v1->v2 (`src/services/MigrationService.js:48-147`)
- O que faz: backup, transformação para `ah_hierarchy`, sincronização de disciplinas e rollback.
- Entradas assumidas: `binderStructure` legível e dados mínimos válidos.
- Falhas prováveis:
  - heurística de mapeamento por caminho pode classificar disciplina/módulo/tópico de forma incorreta em árvores antigas atípicas (`src/services/MigrationService.js:188-241`).
- Como comprovar funcionando:
  - botão de migração (`docs/qa/button-tests/dashboard-btnmigrate-sync-migrar-v1-v2.md`), inspeção de `ah_hierarchy` após execução.
- Status: `⚠️` (sem crash observado; risco de classificação semântica incorreta).

## 2) Parsing de questão / extração / normalização

### 2.1 `QuestionParser` (`src/services/search/QuestionParser.js:10-459`)
- O que faz: normalização de texto/opções, extração de stem/opções, parsing de letra final, similaridade e canonicalização.
- Entradas assumidas: texto OCR razoável e delimitadores de alternativas minimamente detectáveis.
- Falhas prováveis:
  - heurísticas regex podem descartar opções válidas ou introduzir falso positivo em formatos muito ruidosos (`extractOptionsFromQuestion`, `extractQuestionStem`).
- Como comprovar funcionando:
  - cenários de busca/extract no popup (`docs/qa/button-tests/popup-searchbtn-travel-explore-search.md`, `popup-extractbtn-description-extract.md`) e verificação de resultado em `button-audit-raw.json`.
- Status: `⚠️`.

### 2.2 `HtmlExtractorService` (`src/services/search/HtmlExtractorService.js:19-256`)
- O que faz: parse de HTML, detecção de tipo de página, extração de evidência por blocos/âncoras e filtros de obfuscação/paywall.
- Entradas assumidas: HTML suficientemente grande (`>=200`) e estruturas conhecidas de fonte.
- Falhas prováveis:
  - baixa cobertura para estruturas novas de sites externos (dependência de seletor/heurística).
- Como comprovar funcionando:
  - buscas reais via pipeline em background; validação indireta via botões de busca do popup com evidência dinâmica presente.
- Status: `⚠️`.

## 3) Filtros / tags / search

### 3.1 Índice de busca (`src/services/SearchIndexService.js:30-260`)
- O que faz: indexa cards e executa busca full-text/fuzzy com filtros por disciplina/módulo/tópico/tags.
- Entradas assumidas: hierarquia válida com `disc.modules`, `mod.topics`, `topic.cards`.
- Falhas prováveis:
  - ausência de validação estrutural profunda no `build()` pode quebrar se dado estiver corrompido (ex.: `modules` indefinido).
  - custo computacional alto em fuzzy com acervo grande (O(n) * termos * palavras).
- Como comprovar funcionando:
  - fluxo de filtros de biblioteca e sessão no Study Hub (`docs/qa/button-tests/study-filters-chips.md`, `study-searchtrigger-search-span.md`).
- Status: `⚠️`.

### 3.2 Filtros da biblioteca/sessão (`src/study/study-hub.js:1216-1271`, `1552-1570`)
- O que faz: aplica coleções (todas/em andamento/revisar etc.) e filtro por disciplina/tópico.
- Entradas assumidas: `state.hierarchy` carregado e cards com metadados `_discId/_topic`.
- Falhas prováveis:
  - inconsistência de metadados temporários pode filtrar menos/mais cards que o esperado.
- Como comprovar funcionando:
  - chips e navegação de sessão com evidência dinâmica nos relatórios de `study-dom-11...20` e `study-startsessionbtn...`.
- Status: `⚠️`.

## 4) Import / export

### 4.1 `ExportService.importFullJSON` (`src/services/ExportService.js:53-130`)
- O que faz: parse de backup, allowlist de chaves, validação mínima e gravação em local/sync.
- Entradas assumidas: JSON válido com `backup.data`.
- Falhas prováveis:
  - validação de `binderStructure` é superficial (apenas array), sem schema profundo de nós.
- Como comprovar funcionando:
  - ações de import/export no dashboard e study (`docs/qa/button-tests/dashboard-btnimportdata-upload-importar-dados.md`, `dashboard-btnexportdata-download-exportar-dados.md`, `study-exportdatabtn-download-exportar.md`).
- Status: `⚠️`.

### 4.2 Reset total no Study Hub (`src/study/study-hub.js:2717-2735`)
- O que faz: confirmação modal e `chrome.storage.local.clear()`.
- Entradas assumidas: confirmação explícita do usuário.
- Falhas prováveis:
  - perda total de dados locais sem backup automático nesse fluxo.
- Como comprovar funcionando:
  - teste controlado em perfil de desenvolvimento isolado; verificar limpeza de chaves após confirmação.
- Status: `❌` (risco `S0` de perda de dados em operação destrutiva).

### 4.3 Ação `exportJson` no Study Hub (`src/study/study-hub.js:2746-2748`)
- O que faz: chama `ExportService.exportFullJSON()` e mostra toast.
- Entradas assumidas: usuário espera exportação de arquivo.
- Falhas prováveis:
  - não aciona download (gera JSON em memória, mas não salva arquivo).
- Como comprovar funcionando:
  - clique em `#exportJson` não produz arquivo baixado; contraste com `#exportDataBtn` que chama `downloadBackup()`.
- Status: `❌` (risco `S1`: feature principal de exportação parcial quebrada nessa ação específica).

## 5) Sincronização / integrações externas

### 5.1 Fallback multi-provider (`src/services/ApiService.js:1158-1269`)
- O que faz: ordena provedores por `primaryProvider`, tenta cascata (Gemini/OpenRouter/Groq/ChatGPT/Copilot) com cooldowns e strike policy.
- Entradas assumidas: chaves/tokens válidos e rede disponível.
- Falhas prováveis:
  - retorno `null` em cadeia pode degradar sem erro explícito para usuário final em alguns cenários.
- Como comprovar funcionando:
  - cenários `offline` e `missing_permissions` nos botões de busca/teste de chave (`popup-searchbtn...`, `popup-test-groq...`, `popup-test-gemini...`).
- Status: `⚠️`.

### 5.2 Busca em background (`src/background.js:217-290`, `src/services/SimpleSearchService.js:133-260`)
- O que faz: executa fase 2 no service worker, persiste progresso em `chrome.storage.local`, processa fontes e votação.
- Entradas assumidas: conectividade, fontes acessíveis, worker vivo durante execução.
- Falhas prováveis:
  - timeouts/restrições de fonte externa reduzem taxa de sucesso; keepalive tem limite de 4.5 min.
- Como comprovar funcionando:
  - executar busca e acompanhar `ah_bg_search_*` em storage + status no popup.
- Status: `⚠️`.

## 6) Inicialização (startup), permissões e listeners

### 6.1 Service worker listeners (`src/background.js:47-225`, `106-120`, `153-193`)
- O que faz: registra alarms, startup/onInstalled, OAuth callbacks e mensagens `SEARCH_PHASE2`.
- Entradas assumidas: permissões de `tabs`, `alarms`, `storage`, `notifications` e URLs de callback válidas.
- Falhas prováveis:
  - sem permissões de extensão, fluxos ficam parcialmente inoperantes (esperado fora do runtime da extensão).
- Como comprovar funcionando:
  - validação dinâmica em ambiente da extensão (não só HTML estático) + inspeção de logs no background DevTools.
- Status: `⚠️`.

### 6.2 Bootstrap de popup (`src/popup/popup.js:7-59`, `181-183`)
- O que faz: instrumenta serviços, inicializa view/controller e picker de modelo.
- Entradas assumidas: DOM pronto e elementos do picker existentes.
- Falhas prováveis:
  - dupla inscrição em `DOMContentLoaded` exige idempotência de inicialização (sem evidência de crash, mas atenção).
- Como comprovar funcionando:
  - abrir popup repetidamente e validar ausência de handlers duplicados (uma ação por clique).
- Status: `⚠️`.

## Resultado consolidado

- Storage: `⚠️`
- Parsing/extração/normalização: `⚠️`
- Filtros/tags/search: `⚠️`
- Import/export: `❌` (há achados de `S0` e `S1`)
- Sincronização/integrações externas: `⚠️`
- Inicialização/permissões/listeners: `⚠️`

- Achados críticos diretos:
  - `S0`: reset total sem backup no fluxo do Study Hub.
  - `S1`: botão `exportJson` não baixa arquivo.
