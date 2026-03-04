# QA Summary

- Projeto: `C:/Users/cezar/OneDrive/Área de Trabalho/AnswerHunter`
- Total de botões/ações mapeados: **162**
- ✅ ok: **79**
- ⚠️ parcial: **83**
- ❌ quebrado: **0**
- [Unverified]: **0**

## Top 10 problemas por severidade
1. [S0] Reset total apaga todo `chrome.storage.local` sem backup no fluxo do Study Hub (`src/study/study-hub.js:2728`).
2. [S1] Ação `exportJson` não dispara download (gera JSON em memória e mostra sucesso) (`src/study/study-hub.js:2746-2748`).
3. [S1] `SearchIndexService.build()` assume estrutura hierárquica íntegra; dado corrompido pode quebrar indexação (`src/services/SearchIndexService.js:37-41`).
4. [S2] 83 ações ficaram `⚠️ parcial` por ausência de mudança de estado observável ou erros de página em cenários adversos (evidência em `docs/qa/button-tests/*.md`).
5. [S2] Fluxos de integração externa dependem de rede/provedor; em `offline` degradam para execução parcial (`src/services/ApiService.js`, `src/services/SimpleSearchService.js`).
6. [S2] Migração v1→v2 depende de heurística de caminho e pode classificar disciplina/módulo/tópico incorretamente em árvores antigas (`src/services/MigrationService.js:188-241`).
7. [S2] `StorageModel.getDisciplines/saveDisciplines` logam `lastError` sem propagar falha para chamador (`src/models/StorageModel.js:590-613`).
8. [S2] Importação valida `binderStructure` apenas como array, sem validação profunda de schema (`src/services/ExportService.js:80-83`).
9. [S2] Em páginas abertas fora do runtime da extensão, handlers que dependem de `chrome.*` ficam parciais por contexto (observado principalmente no dashboard v2).
10. [S3] Busca fuzzy pode degradar performance em acervos grandes devido custo por termo/palavra (`src/services/SearchIndexService.js:147-159`).

## Plano de correção (ordem de impacto)
1. Corrigir risco de perda de dados (`S0`): reset com backup automático + confirmação de duas etapas.
2. Corrigir `S1` de exportação: trocar `exportFullJSON()` por `downloadBackup()` no botão `exportJson`.
3. Endurecer validação de dados em indexação/import (`SearchIndexService.build`, `ExportService.importFullJSON`).
4. Propagar falhas de storage para a UI (especialmente disciplinas) em vez de apenas `console.error`.
5. Adicionar testes automáticos para cenários adversos (`empty`, `invalid`, `repeat`, `offline`, `missing_permissions`) nos fluxos principais de popup/dashboard/study.
6. Revisar ações `⚠️ parcial` com fallback visual explícito para ausência de permissões/rede.
