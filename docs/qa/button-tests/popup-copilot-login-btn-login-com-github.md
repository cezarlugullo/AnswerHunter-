# Login com GitHub

- Contexto: `popup`
- Elemento: `#copilot-login-btn` em `src/popup/popup.html:742`
- Evento: `click`
- Handler: `() => this.handleCopilotLogin()` (src/controllers/PopupController.js:199)
- Use-case/service: BinderController, DisciplinasController
- Side-effects: chrome.tabs

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:742`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\controllers\PopupController.js:199`

Trecho mínimo do binding:
```js
197:       document.getElementById('copilot-auth-section')?.classList.add('hidden');
198:     });
199:     document.getElementById('copilot-login-btn')?.addEventListener('click', () => this.handleCopilotLogin());
200:     document.getElementById('copilot-logout-btn')?.addEventListener('click', () => this.handleCopilotLogout());
201:     document.getElementById('copilot-test-btn')?.addEventListener('click', () => this.handleCopilotTestConnection());
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
