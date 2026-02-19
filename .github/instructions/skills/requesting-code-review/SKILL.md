# Skill: Requesting Code Review

## Quando usar
- Antes de commitar mudanças significativas
- Após completar uma tarefa do plano
- Antes de fazer merge para main/master
- Quando não tem certeza se a implementação está correta

## Objetivo
Auto-revisar código contra o plano e boas práticas antes de prosseguir.

## Checklist de Auto-Review

### 🎯 Conformidade com o Plano
- [ ] Implementei EXATAMENTE o que o plano pedia?
- [ ] Não adicionei features extras (YAGNI)?
- [ ] Todos os requisitos da tarefa foram atendidos?
- [ ] A verificação da tarefa passa?

### 🧪 Testes
- [ ] Todos os testes estão passando?
- [ ] Segui TDD (RED-GREEN-REFACTOR)?
- [ ] Coverage está acima do threshold (80%)?
- [ ] Testes são independentes e determinísticos?
- [ ] Não há testes ignored/skipped?

### 🏗️ Qualidade do Código
- [ ] Código está limpo e legível?
- [ ] Nomes de variáveis/funções são descritivos?
- [ ] Funções têm uma única responsabilidade?
- [ ] Sem código comentado?
- [ ] Sem console.log() esquecidos?
- [ ] Sem TODOs não resolvidos?

### 🔒 Boas Práticas
- [ ] Tratamento de erros apropriado?
- [ ] Validação de inputs adequada?
- [ ] Sem hardcoded values (use constants)?
- [ ] Async/await usado corretamente?
- [ ] Memory leaks prevenidos?

### 📝 Documentação
- [ ] JSDoc nas funções públicas?
- [ ] README atualizado se necessário?
- [ ] Comentários explicam "por quê", não "o quê"?

### 🔍 AnswerHunter Específico
- [ ] Manifesto da extensão atualizado (se necessário)?
- [ ] Mensagens i18n adicionadas?
- [ ] Backend API em sync com frontend?
- [ ] Storage schema compatível?
- [ ] Chrome APIs usadas corretamente?

## Níveis de Severidade

### 🔴 CRITICAL - Bloqueia progresso
- Testes falhando
- Funcionalidade quebrada
- Security issues
- Data loss
- Performance crítica degradada

**Ação**: Corrigir imediatamente, não prosseguir

### 🟡 MAJOR - Deve ser corrigido
- Código duplicado significativo
- Má arquitetura/design
- Missing error handling
- Inconsistência com padrões do projeto
- Documentação faltando

**Ação**: Corrigir antes de commit final

### 🟢 MINOR - Melhorias sugeridas
- Nomes de variáveis pouco claros
- Comentários desnecessários
- Oportunidades de refactor
- Pequenas otimizações

**Ação**: Considerar corrigir, pode adiar

## Processo de Review

### 1. Review Automático
```bash
# Run linter
npm run lint

# Run all tests
npm test

# Check coverage
npm run test:coverage

# Check for console.logs
grep -r "console.log" src/ --exclude="*.test.js"

# Check for TODOs
grep -r "TODO" src/
```

### 2. Review Manual

#### Diff Review
```bash
# See what changed
git diff

# Review each file individually
git diff src/services/SearchService.js
```

Para cada mudança, pergunte:
- **Por quê?** Essa mudança era necessária?
- **Onde?** Está no arquivo/lugar certo?
- **Como?** É a melhor forma de fazer?
- **Testes?** Está coberto por testes?

#### Code Walkthrough
Leia o código como se fosse um usuário:
1. Ponto de entrada é claro?
2. Fluxo é fácil de seguir?
3. Edge cases estão tratados?
4. Errors são informativos?

### 3. Review Comparativo ao Plano

Abra o plano lado a lado:
```markdown
# Plano dizia:
"Adicionar cache com TTL de 5 minutos"

# Código faz:
✅ Usa Map para cache
✅ Implementa TTL
❌ TTL está hardcoded (deveria ser configurável)
```

## Template de Review Report

```markdown
# Code Review: [Task/Feature Name]

**Data**: YYYY-MM-DD
**Reviewer**: Self / GitHub Copilot
**Branch**: feature/xxx

## Summary
[Breve descrição das mudanças]

## Checklist
- [x] Plan compliance
- [x] Tests passing
- [ ] Code quality
- [x] Documentation

## Issues Found

### 🔴 CRITICAL
None

### 🟡 MAJOR
1. **SearchService.js:45** - Missing error handling for network timeout
   - **Como corrigir**: Add try/catch and specific error message

### 🟢 MINOR
1. **PopupView.js:12** - Variable name `tmp` is not descriptive
   - **Sugestão**: Renomear para `searchResults`

## Metrics
- **Files changed**: 5
- **Lines added**: 120
- **Lines removed**: 30
- **Test coverage**: 87% (+3%)
- **Tests added**: 8

## Recommendation
⚠️ APPROVE WITH CHANGES - Fix MAJOR issues before merge

## Next Steps
1. Add error handling in SearchService
2. Re-run tests
3. Request final review
```

## Exemplo Prático - AnswerHunter

### Cenário: Revisando adição de cache

```javascript
// 🔍 Código sendo revisado
class SearchService {
  cache = {};
  
  async search(query) {
    if (this.cache[query]) return this.cache[query];
    const result = await this.api.search(query);
    this.cache[query] = result;
    return result;
  }
}
```

### Issues Identificados:

🟡 **MAJOR**:
1. **Cache ilimitado** - pode causar memory leak
   - Fix: Implementar LRU cache ou TTL

2. **Sem cache invalidation** - dados antigos ficam para sempre
   - Fix: Adicionar TTL ou método clear()

🟢 **MINOR**:
3. **Object literal como Map** - menos eficiente
   - Sugestão: Usar `new Map()`

### Code Corrigido:

```javascript
class SearchService {
  constructor(cacheSize = 100, ttl = 300000) { // 5 min
    this.cache = new Map();
    this.cacheSize = cacheSize;
    this.ttl = ttl;
  }
  
  async search(query) {
    const cached = this.getCached(query);
    if (cached) return cached;
    
    const result = await this.api.search(query);
    this.setCache(query, result);
    return result;
  }
  
  getCached(query) {
    const entry = this.cache.get(query);
    if (!entry) return null;
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(query);
      return null;
    }
    
    return entry.data;
  }
  
  setCache(query, data) {
    // LRU eviction
    if (this.cache.size >= this.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(query, {
      data,
      timestamp: Date.now()
    });
  }
  
  clearCache() {
    this.cache.clear();
  }
}
```

✅ Issues resolvidos, pronto para commit

## Anti-patterns

❌ **Skipper**: "Está funcionando, não precisa revisar"
❌ **Overconfident**: "Meu código está perfeito"
❌ **Lazy**: Olhar só o diff sem entender contexto
❌ **Ignorer**: Achar issues mas não corrigir
❌ **Perfectionist**: Bloquear por issues MINOR

## Automatização

### Pre-commit Hook
```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running pre-commit checks..."

# Lint
npm run lint || exit 1

# Tests
npm test || exit 1

# Check for console.log
if grep -r "console.log" src/ --exclude="*.test.js" --exclude-dir=node_modules -q; then
  echo "❌ Found console.log statements"
  exit 1
fi

echo "✅ Pre-commit checks passed"
```

### GitHub Actions (futuro)
```yaml
name: Code Review
on: [pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install
      - run: npm run lint
      - run: npm test
      - run: npm run test:coverage
```

## Output Esperado

Ao final da review:
- [ ] Report de review salvo em `.agents/reviews/YYYYMMDD-TASK.md`
- [ ] Todos os issues CRITICAL corrigidos
- [ ] Issues MAJOR resolvidos ou documentados
- [ ] Código pronto para commit/push
- [ ] Confiança de que está correto

## Integração com Workflow

```
Task Complete → Self Review → Issues? → Fix → Re-review → ✅ Commit
```

Não pule a review. É rápida (2-5 min) e previne horas de debug depois.

## Para o Copilot

Quando o usuário pedir review, execute:
1. Verificar testes: `npm test`
2. Verificar lint: `npm run lint`
3. Ler o diff: analisar mudanças
4. Comparar com o plano
5. Aplicar checklist acima
6. Gerar report estruturado
7. Sugerir correções específicas

Seja **rigoroso mas construtivo**.
