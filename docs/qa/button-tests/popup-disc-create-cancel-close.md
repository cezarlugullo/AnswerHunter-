# close

- Contexto: `popup`
- Elemento: `#disc-create-cancel` em `src/popup/popup.html:1174`
- Evento: `click`
- Handler: `() => this._toggleCreateForm(false)` (src/controllers/DisciplinasController.js:14)
- Use-case/service: StorageModel
- Side-effects: [Unverified] não foi possível validar

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\popup\popup.html:1174`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\controllers\DisciplinasController.js:14`

Trecho mínimo do binding:
```js
12:     _bindStaticEvents() {
13:         document.getElementById('btnAddDiscNew')?.addEventListener('click', () => this._toggleCreateForm(true));
14:         document.getElementById('disc-create-cancel')?.addEventListener('click', () => this._toggleCreateForm(false));
15:         document.getElementById('disc-create-submit')?.addEventListener('click', () => this._handleCreate());
16:         document.getElementById('disc-create-input')?.addEventListener('keydown', (e) => {
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
