# ← Voltar

- Contexto: `popup`
- Elemento: `#tw-back-btn` em `src/popup/popup.html:1392`
- Evento: `click`
- Handler: `() => this._turboWizardGoTo('tw-step-1')` (src/controllers/PopupController.js:5001)
- Use-case/service: NativeFetchBridgeService
- Side-effects: [Unverified] não foi possível validar

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:1392`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\controllers\PopupController.js:5001`

Trecho mínimo do binding:
```js
4999:       document.getElementById('tw-skip-btn')?.addEventListener('click', () => this._closeTurboWizard());
5000:       document.getElementById('tw-start-btn')?.addEventListener('click', () => this._turboWizardBeginDownload());
5001:       document.getElementById('tw-back-btn')?.addEventListener('click', () => this._turboWizardGoTo('tw-step-1'));
5002:       document.getElementById('tw-done-install-btn')?.addEventListener('click', () => this._turboWizardVerify());
5003:       document.getElementById('tw-success-close-btn')?.addEventListener('click', () => {
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
