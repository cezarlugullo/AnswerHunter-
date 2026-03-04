# QA Summary

- Projeto: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter`
- Total de botões/ações mapeados: **162**
- ✅ ok: **128**
- ⚠️ parcial: **20**
- ❌ quebrado: **0**
- [Unverified]: **14**

## Top 10 problemas por severidade
1. [S2] dark_mode (src/dashboard/dashboard-v2.html:285) -> [Unverified] não foi possível validar
2. [S2] settings (src/dashboard/dashboard-v2.html:288) -> [Unverified] não foi possível validar
3. [S2] add Nova Disciplina (src/dashboard/dashboard-v2.html:317) -> [Unverified] não foi possível validar
4. [S2] play_arrow Estudar tudo (src/dashboard/dashboard-v2.html:330) -> [Unverified] não foi possível validar
5. [S2] add Nova Disciplina (src/dashboard/dashboard-v2.html:368) -> [Unverified] não foi possível validar
6. [S2] table_chart CSV (src/dashboard/dashboard-v2.html:409) -> [Unverified] não foi possível validar
7. [S2] style Anki (src/dashboard/dashboard-v2.html:412) -> [Unverified] não foi possível validar
8. [S2] data_object JSON Backup (src/dashboard/dashboard-v2.html:415) -> [Unverified] não foi possível validar
9. [S2] download Exportar dados (src/dashboard/dashboard-v2.html:437) -> [Unverified] não foi possível validar
10. [S2] upload Importar dados (src/dashboard/dashboard-v2.html:441) -> [Unverified] não foi possível validar

## Plano de correção (ordem de impacto)
1. Corrigir handlers com status ❌ (falha em cenário happy path).
2. Tratar explicitamente cenários offline/permissões ausentes nos handlers de rede/storage.
3. Adicionar validações para dados vazios/inválidos antes de side-effects destrutivos.
4. Cobrir ações com [Unverified] usando fluxo manual adicional em contexto real da extensão.
5. Adicionar testes automatizados de regressão por ação crítica (search/extract/save/export/import).
