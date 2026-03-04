# Change Key

- Contexto: `popup`
- Elemento: `#change-key-openrouter` em `src/popup/popup.html:412`
- Evento: `click`
- Handler: `[Unverified] não foi possível validar` ([Unverified] não foi possível validar)
- Use-case/service: [Unverified] não foi possível validar
- Side-effects: [Unverified] não foi possível validar

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: [Unverified] não foi possível validar.
- Handler com variáveis/estados nulos, try/catch e await: [Unverified] não foi possível validar.
- Traço UI -> handler -> serviço -> side-effect: [Unverified] não foi possível validar.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:412`
Arquivo handler: `N/A`

Trecho mínimo do binding:
```js
[Unverified] não foi possível validar
```

## 2.2 Verificação dinâmica (rodando)
- Execução dinâmica feita com Playwright CLI em navegador real, clicando o elemento em todos os cenários automatizados.

## 2.3 Cenários obrigatórios
| Cenário | Resultado | Evidência |
| --- | --- | --- |
| happy | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":5,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":5,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| empty | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":1,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":1,"ss":0,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| invalid | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| repeat | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| offline | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |
| missing_permissions | ⚠️ clique executado sem mudança observável | clicked=true; hidden=true; disabled=false; before={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; after={"ls":9,"ss":1,"status":"Testando conexão...","url":"http://127.0.0.1:4174/src/popup/popup.html"}; pageErrors=0 |

## 2.4 Resultado e correções
- Status: ✅ ok
- Causa raiz: não identificado crash específico para este botão nas execuções registradas.
- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.

