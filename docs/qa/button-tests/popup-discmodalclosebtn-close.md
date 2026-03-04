# close

- Contexto: `popup`
- Elemento: `#discModalCloseBtn` em `src/popup/popup.html:1449`
- Evento: `click`
- Handler: `() => overlay.classList.add('hidden')` (src/controllers/BinderController.js:379)
- Use-case/service: StorageModel
- Side-effects: [Unverified] não foi possível validar

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:1449`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\controllers\BinderController.js:379`

Trecho mínimo do binding:
```js
377:         if (!overlay.dataset.bound) {
378:             overlay.dataset.bound = '1';
379:             document.getElementById('discModalCloseBtn')?.addEventListener('click', () => overlay.classList.add('hidden'));
380:             overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
381: 
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
