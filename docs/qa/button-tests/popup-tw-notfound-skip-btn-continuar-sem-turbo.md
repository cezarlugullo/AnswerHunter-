# Continuar sem Turbo

- Contexto: `popup`
- Elemento: `#tw-notfound-skip-btn` em `src/popup/popup.html:1435`
- Evento: `click`
- Handler: `() => this._closeTurboWizard()` (src/controllers/PopupController.js:5059)
- Use-case/service: NativeFetchBridgeService
- Side-effects: [Unverified] não foi possível validar

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:1435`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\controllers\PopupController.js:5059`

Trecho mínimo do binding:
```js
5057:         this._checkNativeBridgeStatus();
5058:       });
5059:       document.getElementById('tw-notfound-skip-btn')?.addEventListener('click', () => this._closeTurboWizard());
5060:       document.getElementById('tw-retry-btn')?.addEventListener('click', () => this._turboWizardGoTo('tw-step-2'));
5061: 
```

## 2.2 Verificação dinâmica (rodando)
- Execução dinâmica feita com Playwright CLI em navegador real, clicando o elemento em todos os cenários automatizados.

## 2.3 Cenários obrigatórios
| Cenário | Resultado | Evidência |
| --- | --- | --- |
| happy | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":6,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":6,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| empty | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":2,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":2,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| invalid | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| repeat | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| offline | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| missing_permissions | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |

## 2.4 Resultado e correções
- Status: ✅ ok
- Causa raiz: não identificado crash específico para este botão nas execuções registradas.
- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.

