# play_arrow Estudar tudo

- Contexto: `dashboard`
- Elemento: `#btnStudyAll` em `src/dashboard/dashboard-v2.html:330`
- Evento: `click`
- Handler: `(` (src/dashboard/dashboard-v2.js:577)
- Use-case/service: [Unverified] não foi possível validar
- Side-effects: chrome.tabs, chrome.runtime

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.html:330`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.js:577`

Trecho mínimo do binding:
```js
575: 
576:   // Study all
577:   document.getElementById('btnStudyAll')?.addEventListener('click', () => {
578:     if (!DEMO) {
579:       chrome.tabs.create({ url: chrome.runtime.getURL('src/study/study.html') });
```

## 2.2 Verificação dinâmica (rodando)
- Execução dinâmica feita com Playwright CLI em navegador real (chrome), clicando o elemento em todos os cenários automatizados.

## 2.3 Cenários obrigatórios
| Cenário | Resultado | Evidência |
| --- | --- | --- |
| happy | [Unverified] não foi possível validar | sem evidência dinâmica |
| empty | [Unverified] não foi possível validar | sem evidência dinâmica |
| invalid | [Unverified] não foi possível validar | sem evidência dinâmica |
| repeat | [Unverified] não foi possível validar | sem evidência dinâmica |
| offline | [Unverified] não foi possível validar | sem evidência dinâmica |
| missing_permissions | [Unverified] não foi possível validar | sem evidência dinâmica |

## 2.4 Resultado e correções
- Status: [Unverified] não foi possível validar
- Causa raiz: não identificado crash específico para este botão nas execuções registradas.
- Correção mínima proposta: endurecer validações de estado e mensagens de erro para cenários inválidos/permissões/offline.
