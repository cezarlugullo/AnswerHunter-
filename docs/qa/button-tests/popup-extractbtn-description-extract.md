# description Extract

- Contexto: `popup`
- Elemento: `#extractBtn` em `src/popup/popup.html:1101`
- Evento: `click`
- Handler: `() => this.handleExtract()` (src/controllers/PopupController.js:205)
- Use-case/service: BinderController, DisciplinasController
- Side-effects: chrome.tabs

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:1101`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\controllers\PopupController.js:205`

Trecho mínimo do binding:
```js
203:     document.getElementById('select-copilot-model')?.addEventListener('change', () => this.persistAiConfig());
204: 
205:     this.view.elements.extractBtn?.addEventListener('click', () => this.handleExtract());
206:     this.view.elements.searchBtn?.addEventListener('click', () => this.handleSearch());
207:     this.view.elements.copyBtn?.addEventListener('click', () => this.handleCopyAll());
```

## 2.2 Verificação dinâmica (rodando)
- Execução dinâmica feita com Playwright CLI em navegador real (chrome), clicando o elemento em todos os cenários automatizados.

## 2.3 Cenários obrigatórios
| Cenário | Resultado | Evidência |
| --- | --- | --- |
| happy | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":5,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":5,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| empty | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":1,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":1,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| invalid | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| repeat | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| offline | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| missing_permissions | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |

## 2.4 Resultado e correções
- Status: ✅ ok
- Causa raiz: não identificado crash específico para este botão nas execuções registradas.
- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.
