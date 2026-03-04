# download Exportar dados

- Contexto: `dashboard`
- Elemento: `#btnExportData` em `src/dashboard/dashboard-v2.html:437`
- Evento: `click`
- Handler: `async (` (src/dashboard/dashboard-v2.js:600)
- Use-case/service: ExportService
- Side-effects: [Unverified] não foi possível validar

## 2.1 Verificação estática (código)
- Elemento renderizado no DOM estático: confirmado pelo HTML da tela.
- Binding do evento: encontrado via addEventListener/onclick.
- Handler com variáveis/estados nulos, try/catch e await: revisão parcial por inspeção da região do handler.
- Traço UI -> handler -> serviço -> side-effect: mapeado parcialmente com evidência de chamada e heurística de serviço.

Arquivo DOM: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.html:437`
Arquivo handler: `C:\Users\cezar\OneDrive\Área de Trabalho\AnswerHunter\src\dashboard\dashboard-v2.js:600`

Trecho mínimo do binding:
```js
598: 
599:   // Export — full JSON backup using ExportService
600:   document.getElementById('btnExportData')?.addEventListener('click', async () => {
601:     if (DEMO) { showToast('Exportação não disponível em modo demo', { type: 'warning' }); return; }
602:     try {
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
