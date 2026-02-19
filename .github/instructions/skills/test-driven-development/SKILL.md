# Skill: Test-Driven Development (TDD)

## Quando usar
- **SEMPRE** ao escrever código novo
- Antes de fazer refatorações
- Ao corrigir bugs (escreva teste que reproduz o bug)
- Não há exceções

## Objetivo
Garantir código testável, correto e manutenível através do ciclo RED-GREEN-REFACTOR.

## O Ciclo Sagrado

### 🔴 RED - Write a Failing Test
1. **Escreva UM teste** que falha
2. **Execute o teste** e veja falhar
3. **Veja a mensagem de erro** específica
4. **Se não falhar**, o teste está errado

**Tempo**: 1-2 minutos

### 🟢 GREEN - Make it Pass
1. **Escreva o código mínimo** para passar
2. **Execute o teste** novamente
3. **Verde?** Avance. **Vermelho?** Debug
4. **Commit** quando verde

**Tempo**: 2-3 minutos

### 🔵 REFACTOR - Improve the Code
1. **Revise o código** (DRY? Clean? Performante?)
2. **Refatore** mantendo testes verdes
3. **Execute testes** a cada mudança
4. **Commit** refatorações separadamente

**Tempo**: 1-2 minutos

## Regras Absolutas

### ❌ Proibições
1. **NUNCA escreva código de produção sem teste que falhe primeiro**
2. **NUNCA escreva mais de um teste por vez**
3. **NUNCA ignore/skip testes falhando**
4. **NUNCA commite código sem testes passando**
5. **NUNCA confie em testes manuais para validação**

### ✅ Obrigações
1. **SEMPRE rode testes antes de começar** (baseline limpo)
2. **SEMPRE veja o teste falhar** antes de implementar
3. **SEMPRE escreva o código mais simples** que passa
4. **SEMPRE refatore** quando testes estão verdes
5. **SEMPRE commit** após cada ciclo completo

## Exemplo Completo - AnswerHunter

### Feature: Adicionar cache de buscas

#### 🔴 RED (2 min)

```javascript
// src/services/__tests__/SearchService.test.js
describe('SearchService', () => {
  describe('cache', () => {
    it('should return cached result on repeated search', async () => {
      const query = 'test query';
      
      // First call - should hit API
      const result1 = await SearchService.search(query);
      const apiCallCount1 = mockApi.callCount;
      
      // Second call - should use cache
      const result2 = await SearchService.search(query);
      const apiCallCount2 = mockApi.callCount;
      
      expect(result1).toEqual(result2);
      expect(apiCallCount2).toBe(apiCallCount1); // No new API call
    });
  });
});
```

**Execute**: `npm test SearchService`
**Resultado esperado**: ❌ FAIL - searchService.search is not implemented

#### 🟢 GREEN (3 min)

```javascript
// src/services/SearchService.js
class SearchService {
  constructor() {
    this.cache = new Map();
  }
  
  async search(query) {
    // Check cache
    if (this.cache.has(query)) {
      return this.cache.get(query);
    }
    
    // Call API
    const result = await this.callApi(query);
    
    // Store in cache
    this.cache.set(query, result);
    
    return result;
  }
  
  async callApi(query) {
    // Implementation...
  }
}
```

**Execute**: `npm test SearchService`
**Resultado esperado**: ✅ PASS

**Commit**: `feat: add search result caching`

#### 🔵 REFACTOR (2 min)

```javascript
// src/services/SearchService.js
class SearchService {
  constructor(cacheImpl = new Map()) {
    this.cache = cacheImpl; // Dependency injection
  }
  
  async search(query) {
    const cached = this.cache.get(query);
    if (cached) return cached;
    
    const result = await this.callApi(query);
    this.cache.set(query, result);
    return result;
  }
  
  async callApi(query) {
    // Implementation...
  }
}
```

**Execute**: `npm test SearchService`
**Resultado esperado**: ✅ PASS (ainda verde)

**Commit**: `refactor: improve SearchService testability with DI`

## Templates de Teste

### Unit Test (Service/Model)
```javascript
describe('ComponentName', () => {
  let component;
  
  beforeEach(() => {
    component = new ComponentName();
  });
  
  afterEach(() => {
    // Cleanup
  });
  
  describe('methodName', () => {
    it('should [comportamento esperado] when [condição]', () => {
      // Arrange
      const input = 'test';
      
      // Act
      const result = component.methodName(input);
      
      // Assert
      expect(result).toBe('expected');
    });
    
    it('should throw error when [condição inválida]', () => {
      expect(() => component.methodName(null))
        .toThrow('Expected error message');
    });
  });
});
```

### Integration Test (API)
```javascript
describe('API /endpoint', () => {
  let request;
  
  beforeAll(async () => {
    await setupTestDatabase();
  });
  
  afterAll(async () => {
    await teardownTestDatabase();
  });
  
  it('should return 200 and data when request is valid', async () => {
    const response = await request(app)
      .get('/api/endpoint')
      .query({ param: 'value' });
    
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: expect.any(Array)
    });
  });
});
```

### UI Test (Extension)
```javascript
describe('PopupView', () => {
  let view;
  let container;
  
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    view = new PopupView(container);
  });
  
  afterEach(() => {
    document.body.removeChild(container);
  });
  
  it('should render search input', () => {
    view.render();
    
    const input = container.querySelector('.search-input');
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Type to search...');
  });
});
```

## Anti-patterns a Evitar

### 🚫 Test After (escrever código primeiro)
```javascript
// ❌ NUNCA faça isso
// 1. Escrevi SearchService.js completo
// 2. Agora vou escrever testes...
// 3. Ah, não é testável, preciso refatorar tudo
```

### 🚫 Test Everything (teste demais de uma vez)
```javascript
// ❌ Teste que valida muitas coisas
it('should work correctly', () => {
  // 50 linhas de assertions...
});

// ✅ Separe em testes específicos
it('should cache results', () => { /*...*/ });
it('should invalidate stale cache', () => { /*...*/ });
it('should handle cache misses', () => { /*...*/ });
```

### 🚫 No Assertion (teste sem verificação)
```javascript
// ❌ Teste que não verifica nada
it('should search', async () => {
  await SearchService.search('query');
  // Passou... mas não verificou nada!
});

// ✅ Sempre assert algo
it('should return results when query is valid', async () => {
  const results = await SearchService.search('query');
  expect(results).toBeDefined();
  expect(results.length).toBeGreaterThan(0);
});
```

### 🚫 Testing Implementation (testar privates)
```javascript
// ❌ Não teste detalhes internos
it('should call internal method', () => {
  spyOn(service, '_internalMethod');
  service.publicMethod();
  expect(service._internalMethod).toHaveBeenCalled();
});

// ✅ Teste comportamento público
it('should return formatted result', () => {
  const result = service.publicMethod('input');
  expect(result).toBe('expected output');
});
```

## Configuração para AnswerHunter

### Jest Config
```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'jsdom', // Para extension code
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

### NPM Scripts
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:debug": "node --inspect-brk node_modules/.bin/jest --runInBand"
  }
}
```

## Checklist por Ciclo

### Antes de começar
- [ ] Todos os testes estão passando (baseline verde)
- [ ] Entendo o que vou implementar
- [ ] Sei qual teste escrever primeiro

### RED Phase
- [ ] Escrevi UM teste que falha
- [ ] Executei e vi falhar
- [ ] A mensagem de erro é clara
- [ ] O teste falha pelo motivo certo

### GREEN Phase
- [ ] Escrevi código mínimo para passar
- [ ] Todos os testes estão verdes
- [ ] Nenhum código foi comentado
- [ ] Commit feito

### REFACTOR Phase
- [ ] Código está limpo (DRY, SOLID)
- [ ] Testes continuam verdes
- [ ] Performance é aceitável
- [ ] Commit de refactor separado

## Comandos Úteis

```bash
# Run all tests
npm test

# Watch mode (during development)
npm run test:watch

# Coverage report
npm run test:coverage

# Specific file
npm test SearchService

# Debug test
npm run test:debug
```

## Quando Você Violou TDD

Se você escreveu código antes do teste:
1. **DELETE O CÓDIGO** (sim, delete)
2. Escreva o teste primeiro (RED)
3. Reescreva o código (GREEN)
4. Aprenda com o erro

> "Código escrito sem teste é código legado." - Michael Feathers

## Exceções
Não há exceções. Zero. Nada. Never.

TDD é uma **regra absoluta** neste projeto.
