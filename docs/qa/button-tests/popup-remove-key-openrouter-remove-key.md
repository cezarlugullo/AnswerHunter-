# Remove key

- Contexto: `popup`
- Elemento: `#remove-key-openrouter` em `src/popup/popup.html:413`
- Evento: `click`
- Handler: `() => this.handleRemoveOpenrouterKey()` (src/controllers/PopupController.js:315)
- Use-case/service: ApiService, BinderController, SettingsModel
- Side-effects: network

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:413`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\controllers\PopupController.js:315`

Trecho mínimo do binding:
```js
313:     this.view.elements.removeKeySerper?.addEventListener('click', () => this.handleRemoveSerperKey());
314:     this.view.elements.removeKeyGemini?.addEventListener('click', () => this.handleRemoveGeminiKey());
315:     this.view.elements.removeKeyOpenrouter?.addEventListener('click', () => this.handleRemoveOpenrouterKey());
316: 
317:     // Binder CTA: Go to Search
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
