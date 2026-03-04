# logout Sair

- Contexto: `popup`
- Elemento: `#gemini-logout-btn` em `src/popup/popup.html:686`
- Evento: `click`
- Handler: `() => this.handleGeminiLogout()` (src/controllers/PopupController.js:189)
- Use-case/service: BinderController, DisciplinasController
- Side-effects: chrome.tabs

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:686`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\controllers\PopupController.js:189`

Trecho mínimo do binding:
```js
187:     });
188:     document.getElementById('gemini-login-btn')?.addEventListener('click', () => this.handleGeminiLogin());
189:     document.getElementById('gemini-logout-btn')?.addEventListener('click', () => this.handleGeminiLogout());
190:     document.getElementById('select-gemini-oauth-model')?.addEventListener('change', () => this.persistAiConfig());
191: 
```

## 2.2 Verificação dinâmica (rodando)
- Execução dinâmica feita com Playwright CLI em navegador real (chrome), clicando o elemento em todos os cenários automatizados.

## 2.3 Cenários obrigatórios
| Cenário | Resultado | Evidência |
| --- | --- | --- |
| happy | [Unverified] não foi possível validar | sem evidência dinâmica |

## 2.4 Resultado e correções
- Status: [Unverified] não foi possível validar
- Causa raiz: não identificado crash específico para este botão nas execuções registradas.
- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.
