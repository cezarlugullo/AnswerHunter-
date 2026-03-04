# download Exportar dados

- Contexto: `dashboard`
- Elemento: `#btnExportData` em `src/dashboard/dashboard-v2.html:437`
- Evento: `click`
- Handler: `async (` (src/dashboard/dashboard-v2.js:604)
- Use-case/service: ExportService
- Side-effects: [Unverified] não foi possível validar

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.html:437`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.js:604`

Trecho mínimo do binding:
```js
602: 
603:   // Export — full JSON backup using ExportService
604:   document.getElementById('btnExportData')?.addEventListener('click', async () => {
605:     if (DEMO) { showToast('Exportação não disponível em modo demo', { type: 'warning' }); return; }
606:     try {
```

## 2.2 Verificação dinâmica (rodando)
- Execução dinâmica feita com Playwright CLI em navegador real, clicando o elemento em todos os cenários automatizados.

## 2.3 Cenários obrigatórios
| Cenário | Resultado | Evidência |
| --- | --- | --- |
| happy | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=1 |
| empty | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=1 |
| invalid | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=1 |
| repeat | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=2 |
| offline | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=1 |
| missing_permissions | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=1 |

## 2.4 Resultado e correções
- Status: ⚠️ parcial
- Causa raiz: não identificado crash específico para este botão nas execuções registradas.
- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.

