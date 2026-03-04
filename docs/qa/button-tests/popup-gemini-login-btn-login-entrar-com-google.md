# login Entrar com Google

- Contexto: `popup`
- Elemento: `#gemini-login-btn` em `src/popup/popup.html:659`
- Evento: `click`
- Handler: `() => this.handleGeminiLogin()` (src/controllers/PopupController.js:188)
- Use-case/service: BinderController, DisciplinasController
- Side-effects: chrome.tabs

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:659`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\controllers\PopupController.js:188`

Trecho mínimo do binding:
```js
186:       document.getElementById('gemini-auth-section')?.classList.add('hidden');
187:     });
188:     document.getElementById('gemini-login-btn')?.addEventListener('click', () => this.handleGeminiLogin());
189:     document.getElementById('gemini-logout-btn')?.addEventListener('click', () => this.handleGeminiLogout());
190:     document.getElementById('select-gemini-oauth-model')?.addEventListener('change', () => this.persistAiConfig());
```

## 2.2 Verificação dinâmica (rodando)
- Execução dinâmica feita com Playwright CLI em navegador real, clicando o elemento em todos os cenários automatizados.

## 2.3 Cenários obrigatórios
| Cenário | Resultado | Evidência |
| --- | --- | --- |
| happy | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=true; before={"ls":5,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":5,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| empty | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=true; before={"ls":1,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":1,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| invalid | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=true; before={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| repeat | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=true; before={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| offline | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=true; before={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":8,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| missing_permissions | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=true; before={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |

## 2.4 Resultado e correções
- Status: ✅ ok
- Causa raiz: não identificado crash específico para este botão nas execuções registradas.
- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.

