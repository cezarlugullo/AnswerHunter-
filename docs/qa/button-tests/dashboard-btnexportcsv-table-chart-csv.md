# table_chart CSV

- Contexto: `dashboard`
- Elemento: `#btnExportCSV` em `src/dashboard/dashboard-v2.html:409`
- Evento: `click`
- Handler: `(` (src/dashboard/dashboard-v2.js:637)
- Use-case/service: ExportService
- Side-effects: [Unverified] não foi possível validar

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.html:409`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.js:637`

Trecho mínimo do binding:
```js
635: 
636:   // Export CSV/Anki/JSON from analytics page
637:   document.getElementById('btnExportCSV')?.addEventListener('click', () => {
638:     if (DEMO) return;
639:     ExportService.downloadCSV(hierarchyData);
```

## 2.2 Verificação dinâmica (rodando)
- Execução dinâmica feita com Playwright CLI em navegador real (chrome), clicando o elemento em todos os cenários automatizados.

## 2.3 Cenários obrigatórios
| Cenário | Resultado | Evidência |
| --- | --- | --- |
| happy | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=1 |
| empty | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=1 |
| invalid | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=1 |
| repeat | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=2 |
| offline | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/dashboard-v2.html"}; pageErrors=1 |
| missing_permissions | [Unverified] não foi possível validar | sem evidência dinâmica |

## 2.4 Resultado e correções
- Status: [Unverified] não foi possível validar
- Causa raiz: não identificado crash específico para este botão nas execuções registradas.
- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.
