# delete

- Contexto: `dashboard`
- Elemento: `#btnDelete` em `src/dashboard/discipline-detail.html:140`
- Evento: `click`
- Handler: `async (` (src/dashboard/discipline-detail.html:293)
- Use-case/service: [Unverified] não foi possível validar
- Side-effects: [Unverified] não foi possível validar

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\discipline-detail.html:140`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\discipline-detail.html:293`

Trecho mínimo do binding:
```js
291:       });
292: 
293:       document.getElementById('btnDelete')?.addEventListener('click', async () => {
294:         if (!confirm(`Deletar "${discipline.name}" e todos os seus cards?`)) return;
295:         await ContentHierarchyService.deleteDiscipline(discId);
```

## 2.2 Verificação dinâmica (rodando)
- Execução dinâmica feita com Playwright CLI em navegador real (chrome), clicando o elemento em todos os cenários automatizados.

## 2.3 Cenários obrigatórios
| Cenário | Resultado | Evidência |
| --- | --- | --- |
| happy | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; after={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; pageErrors=0 |
| empty | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; after={"ls":0,"ss":0,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; pageErrors=0 |
| invalid | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; pageErrors=0 |
| repeat | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; pageErrors=0 |
| offline | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; pageErrors=0 |
| missing_permissions | ⚠️ clique executado sem mudança observável | clicked=true; hidden=false; disabled=false; before={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; after={"ls":1,"ss":1,"status":"","url":"http://127.0.0.1:4174/src/dashboard/discipline-detail.html"}; pageErrors=0 |

## 2.4 Resultado e correções
- Status: ⚠️ parcial
- Causa raiz: não identificado crash específico para este botão nas execuções registradas.
- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.
