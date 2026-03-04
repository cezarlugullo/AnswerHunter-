# QA Summary

- Projeto: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter`
- Total de botões/ações mapeados: **85**
- ✅ ok: **79**
- ⚠️ parcial: **6**
- ❌ quebrado: **0**
- [Unverified]: **0**

## Top 10 problemas por severidade
1. [S2] button-54 (src/popup/popup.html:1018) -> ⚠️ parcial
2. [S2] button-55 (src/popup/popup.html:1046) -> ⚠️ parcial
3. [S2] settings (src/popup/popup.html:1056) -> ⚠️ parcial
4. [S2] search Search (src/popup/popup.html:1079) -> ⚠️ parcial
5. [S2] folder Binder (src/popup/popup.html:1083) -> ⚠️ parcial
6. [S2] school Disciplinas (src/popup/popup.html:1087) -> ⚠️ parcial

## Plano de correção (ordem de impacto)
1. Corrigir handlers com status ❌ (falha em cenário happy path).
2. Tratar explicitamente cenários offline/permissões ausentes nos handlers de rede/storage.
3. Adicionar validações para dados vazios/inválidos antes de side-effects destrutivos.
4. Cobrir ações com [Unverified] usando fluxo manual adicional em contexto real da extensão.
5. Adicionar testes automatizados de regressão por ação crítica (search/extract/save/export/import).
