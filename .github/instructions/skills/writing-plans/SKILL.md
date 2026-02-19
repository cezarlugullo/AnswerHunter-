# Skill: Writing Plans

## Quando usar
- Após spec ser aprovada no brainstorming
- Antes de começar implementação
- Para trabalho que levará mais de 30 minutos
- Quando múltiplos arquivos precisam ser modificados

## Objetivo
Quebrar trabalho em tarefas bite-sized (2-5 minutos cada) com detalhes suficientes para executar sem ambiguidade.

## Estrutura do Plano

### Metadata
```markdown
# Implementation Plan: [Feature Name]

**Spec**: `.agents/specs/FEATURE_NAME.md`
**Estimativa Total**: X horas
**Data**: YYYY-MM-DD
**Status**: [ ] Not started / [ ] In progress / [x] Complete
```

### Tarefas

Cada tarefa deve ter:

```markdown
## Task N: [Título claro e acionável]

**Estimativa**: 2-5 minutos
**Arquivos**: 
- `path/to/file1.js` (modificar)
- `path/to/file2.js` (criar)

**Pré-requisitos**: Task M completed

**Implementação**:
1. Passo específico 1
2. Passo específico 2
3. ...

**Código**:
```javascript
// Código completo ou pseudocódigo detalhado
function exemplo() {
  // implementação exata
}
```

**Testes**:
```javascript
// Teste que valida esta tarefa
describe('Feature', () => {
  it('should...', () => {
    // assertions
  });
});
```

**Verificação**:
- [ ] Teste passa
- [ ] Sem erros no console
- [ ] Comportamento esperado confirmado
```

## Princípios

### YAGNI (You Aren't Gonna Need It)
- Implemente APENAS o que a spec pede
- Zero features especulativas
- Se não está na spec, não está no plano

### DRY (Don't Repeat Yourself)
- Identifique código duplicado
- Refatore antes de adicionar
- Use abstrações apropriadas

### TDD First
- TODA tarefa começa escrevendo teste
- RED → GREEN → REFACTOR
- Sem exceções

### Granularidade
- 2-5 minutos por tarefa
- Uma responsabilidade por tarefa
- Fácil de revisar e reverter

## Exemplo para AnswerHunter

```markdown
# Implementation Plan: Add PDF Search Support

**Spec**: `.agents/specs/pdf-search.md`
**Estimativa Total**: 3 horas
**Approach**: PDF.js local processing

---

## Task 1: Add PDF.js dependency

**Estimativa**: 2 min
**Arquivos**: 
- `manifest.json` (modificar)
- `package.json` (modificar)

**Implementação**:
1. Adicionar PDF.js ao manifest.json permissions
2. Instalar pdf-parse no backend

**Verificação**:
- [ ] `npm install` roda sem erros
- [ ] Extensão carrega sem warnings

---

## Task 2: Create PDF extraction service (TDD)

**Estimativa**: 5 min
**Arquivos**:
- `backend/src/services/PdfExtractorService.js` (criar)
- `backend/src/services/__tests__/PdfExtractorService.test.js` (criar)

**Implementação - RED phase**:
```javascript
// PdfExtractorService.test.js
describe('PdfExtractorService', () => {
  it('should extract text from PDF buffer', async () => {
    const buffer = fs.readFileSync('./fixtures/sample.pdf');
    const text = await PdfExtractorService.extractText(buffer);
    expect(text).toContain('expected content');
  });
});
```

**Verificação**:
- [x] Test fails (RED)
- [ ] Reason for failure is clear

---

## Task 3: Implement PDF extraction service

**Estimativa**: 4 min
**Arquivos**:
- `backend/src/services/PdfExtractorService.js` (implementar)

**Implementação - GREEN phase**:
```javascript
const pdfParse = require('pdf-parse');

class PdfExtractorService {
  static async extractText(buffer) {
    const data = await pdfParse(buffer);
    return data.text;
  }
}

module.exports = PdfExtractorService;
```

**Verificação**:
- [x] Test passes (GREEN)
- [ ] No console errors
- [ ] Ready for refactor

...continua
```

## Template de Tarefa

Use este template para cada tarefa:

```markdown
## Task N: [Verbo de ação] + [o quê] + [onde]

**Estimativa**: X min
**Arquivos**: 
- `path/file.js` (action)

**Pré-requisitos**: [Tarefas anteriores]

**TDD Phase**: RED / GREEN / REFACTOR

**Implementação**:
[Passos numerados específicos]

**Código**:
[Código completo]

**Testes**:
[Testes específicos]

**Verificação**:
- [ ] Checklist item 1
- [ ] Checklist item 2
```

## Anti-patterns

❌ Tarefas vagas ("melhorar performance")
❌ Tarefas muito grandes (>10 minutos)
❌ Falar de testes mas não escrever
❌ Esquecer dependências entre tarefas
❌ Não especificar arquivos exatos
❌ Detalhes de implementação ambíguos

## Output Esperado

Arquivo `.agents/plans/FEATURE_NAME-plan.md` com:
- 10-30 tarefas bem definidas
- Ordem de execução clara
- Testes para cada tarefa
- Critérios de verificação explícitos
- Pronto para executar com `executing-plans`

## Integração com AnswerHunter

Estrutura comum de arquivos para mencionar em tarefas:
- Services: `src/services/XxxService.js`
- Controllers: `src/controllers/XxxController.js`
- Models: `src/models/XxxModel.js`
- Views: `src/views/XxxView.js`
- Backend API: `backend/src/routes/xxx.js`
- Testes: `__tests__/` ou `*.test.js`

Sempre considere:
1. **Content script** modifications
2. **Background script** implications
3. **Popup UI** updates
4. **Backend API** changes
5. **Storage** persistence
