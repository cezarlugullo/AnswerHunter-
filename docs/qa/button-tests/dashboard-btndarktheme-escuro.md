# Escuro

- Contexto: `dashboard`
- Elemento: `#btnDarkTheme` em `src/dashboard/dashboard-v2.html:456`
- Evento: `click`
- Handler: `(` (src/dashboard/dashboard-v2.js:560)
- Use-case/service: [Unverified] não foi possível validar
- Side-effects: chrome.storage.local

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.html:456`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.js:560`

Trecho mínimo do binding:
```js
558:     if (!DEMO) chrome.storage.local.set({ ah_theme: '' });
559:   });
560:   document.getElementById('btnDarkTheme')?.addEventListener('click', () => {
561:     document.documentElement.setAttribute('data-theme', 'dark');
562:     if (!DEMO) chrome.storage.local.set({ ah_theme: 'dark' });
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
