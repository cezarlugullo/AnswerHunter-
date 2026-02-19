# Skill: Systematic Debugging

## Quando usar
- Quando um bug é reportado
- Testes estão falhando inexplicavelmente
- Comportamento inconsistente em produção
- Performance degradada sem causa óbvia

## Objetivo
Encontrar e corrigir a causa raiz de forma metódica, não apenas os sintomas.

## Processo de 4 Fases

### Phase 1: REPRODUCE (5-10 min)

#### Objetivo
Criar teste que reproduz o bug de forma confiável.

#### Passos
1. **Coletar informações**:
   - O que era esperado?
   - O que aconteceu?
   - Como reproduzir?
   - Quando começou?
   - Ambiente (browser, OS, versão)?

2. **Criar teste reprodutor**:
```javascript
describe('Bug #123: Search crashes with special chars', () => {
  it('should handle special characters in query', () => {
    const query = "test & <script>";
    
    // Este teste deve FALHAR inicialmente
    expect(() => SearchService.search(query))
      .not.toThrow();
  });
});
```

3. **Verificar reprodução**:
   - [ ] Teste falha consistentemente
   - [ ] Mensagem de erro é a mesma do bug
   - [ ] É o erro mínimo que reproduz

#### Output
- Teste automatizado que falha (RED)
- Compreensão clara do comportamento incorreto

---

### Phase 2: LOCATE (10-20 min)

#### Objetivo
Identificar exatamente onde no código o bug ocorre.

#### Técnicas

**A. Binary Search**
Comente metade do código até isolar a seção problemática:
```javascript
// function search(query) {
//   const normalized = normalize(query); // ✅ OK até aqui
//   const tokens = tokenize(normalized); // ❌ Falha aqui
//   return tokens;
// }
```

**B. Logging Estratégico**
```javascript
function problematicFunction(input) {
  console.log('🔍 Input:', input);
  const step1 = processStep1(input);
  console.log('🔍 After step1:', step1);
  const step2 = processStep2(step1);
  console.log('🔍 After step2:', step2);
  return step2;
}
```

**C. Debugger**
```javascript
function search(query) {
  debugger; // Pause aqui
  const result = process(query);
  return result;
}
```

**D. Stack Trace Analysis**
```
Error: Cannot read property 'length' of undefined
    at SearchService.search (SearchService.js:45)    ← Aqui falha
    at ApiService.query (ApiService.js:23)           ← Chamou daqui
    at PopupController.handleSearch (PopupController.js:12)
```

#### Output
- Linha exata onde o erro ocorre
- Função/método específico
- Variável ou operação problemática

---

### Phase 3: DIAGNOSE (10-15 min)

#### Objetivo
Entender **POR QUÊ** o bug ocorre (causa raiz).

#### Perguntas

1. **O que é o valor atual vs esperado?**
```javascript
// Esperado: string "test"
// Atual: undefined
// Por quê undefined? De onde vem?
```

2. **Quais são as condições necessárias?**
```javascript
// Bug só acontece quando:
// - Query tem caracteres especiais
// - E usuário não está logado
// E cache está vazio
```

3. **Qual é a root cause?**

**❌ Sintoma**: "App crasha"
**❌ Causa proximal**: "Variable is undefined"
**✅ Root cause**: "API retorna null quando rate-limited, código não valida"

#### Root Cause Analysis

Use os "5 Porquês":
```
❓ Por quê o search falha?
→ Porque tokenize() recebe null

❓ Por quê tokenize recebe null?
→ Porque normalize() retorna null

❓ Por quê normalize retorna null?
→ Porque input.trim() falha

❓ Por quê trim falha?
→ Porque input é undefined

❓ Por quê input é undefined?
→ Porque API retorna null em rate-limit sem validação

🎯 ROOT CAUSE: Missing null validation after API call
```

#### Output
- Root cause identificada com clareza
- Compreensão de por quê o bug existe
- Conhecimento de onde/como corrigir

---

### Phase 4: FIX (10-15 min)

#### Objetivo
Corrigir a root cause, não o sintoma.

#### Estratégias

**A. Defense in Depth**
Adicione validações em múltiplas camadas:

```javascript
// ❌ Fix no sintoma (band-aid)
function tokenize(text) {
  if (!text) return []; // Só trata o null aqui
  return text.split(' ');
}

// ✅ Fix na root cause + defesa
// Layer 1: API call
async function searchApi(query) {
  const response = await fetch('/search', { query });
  
  if (response.status === 429) {
    throw new RateLimitError('Too many requests');
  }
  
  const data = await response.json();
  return data || { results: [] }; // Nunca retorna null
}

// Layer 2: Service
async function search(query) {
  if (!query || typeof query !== 'string') {
    throw new ValidationError('Query must be non-empty string');
  }
  
  const data = await searchApi(query);
  return data.results;
}

// Layer 3: Tokenize (defensive)
function tokenize(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text.split(' ');
}
```

**B. Add Tests for Edge Cases**
```javascript
describe('SearchService', () => {
  it('should handle null API response', async () => {
    mockApi.mockReturnValue(null);
    const result = await SearchService.search('query');
    expect(result).toEqual([]);
  });
  
  it('should throw on rate limit', async () => {
    mockApi.mockRejectedValue(new RateLimitError());
    await expect(SearchService.search('query'))
      .rejects.toThrow(RateLimitError);
  });
  
  it('should handle special characters', async () => {
    const result = await SearchService.search('test & <script>');
    expect(result).toBeDefined();
  });
});
```

**C. Commit Sequence**
```bash
# 1. Commit the failing test
git add SearchService.test.js
git commit -m "test: add failing test for rate limit bug #123"

# 2. Commit the fix
git add SearchService.js ApiService.js
git commit -m "fix: handle API null response on rate limit #123

- Add null validation after API call
- Throw RateLimitError instead of crashing
- Add defensive checks in tokenize
- Fixes #123"

# 3. Commit additional tests
git add SearchService.test.js
git commit -m "test: add edge case coverage for bug #123"
```

#### Output
- Teste reprodutor agora passa (GREEN)
- Root cause corrigida
- Edge cases cobertos
- Documentação do fix (commit message)

---

## Checklist Completo

### Phase 1: REPRODUCE
- [ ] Bug report compreendido
- [ ] Teste automatizado criado
- [ ] Teste falha consistentemente
- [ ] Erro corresponde ao bug reportado

### Phase 2: LOCATE
- [ ] Arquivo/função identificado
- [ ] Linha exata conhecida
- [ ] Stack trace analisado
- [ ] Variável problemática isolada

### Phase 3: DIAGNOSE
- [ ] Root cause (não sintoma) identificada
- [ ] "5 Porquês" aplicados
- [ ] Condições necessárias conhecidas
- [ ] Impacto avaliado

### Phase 4: FIX
- [ ] Fix implementado na root cause
- [ ] Teste original passa
- [ ] Edge cases adicionados
- [ ] Code review feito
- [ ] Commits bem documentados

## Exemplo Completo - AnswerHunter

### Bug Report
```
Bug #456: Extension crasha ao buscar no Word quando documento está vazio

Passos:
1. Abrir Word com documento vazio
2. Abrir popup da extensão
3. Digitar "test" e pressionar Enter
4. Chrome crasha

Ambiente: Chrome 120, Windows 11, Word 365
```

### Phase 1: REPRODUCE
```javascript
// content.test.js
describe('Word extraction', () => {
  it('should handle empty Word document', async () => {
    // Mock empty document
    mockWordDocument({ content: '', paragraphs: [] });
    
    const controller = new BinderController();
    
    // Should not throw
    await expect(controller.extractContent())
      .resolves.not.toThrow();
  });
});
```
❌ Test FAILS with "Cannot read property 'text' of undefined"

### Phase 2: LOCATE
```javascript
// BinderController.js:67
async extractContent() {
  const paragraphs = await this.wordApp.ActiveDocument.Paragraphs;
  const text = paragraphs[0].Range.Text; // ❌ CRASHES HERE
  return text;
}
```
Found: Linha 67, acessa paragraphs[0] sem verificar se existe

### Phase 3: DIAGNOSE
```
❓ Por quê crasha?
→ paragraphs[0] é undefined

❓ Por quê undefined?
→ Array está vazio (documento vazio)

❓ Por quê não valida?
→ Código assume sempre há paragraphs

❓ Por quê assume isso?
→ Desenvolvedor testou só com docs populados

🎯 ROOT CAUSE: Missing empty document validation
```

### Phase 4: FIX
```javascript
// BinderController.js
async extractContent() {
  const doc = await this.wordApp.ActiveDocument;
  
  // Validate document exists
  if (!doc) {
    throw new Error('No active Word document');
  }
  
  const paragraphs = await doc.Paragraphs;
  
  // Handle empty document
  if (!paragraphs || paragraphs.length === 0) {
    return { content: '', paragraphs: [] };
  }
  
  // Extract content
  const content = paragraphs.map(p => {
    try {
      return p.Range.Text || '';
    } catch (e) {
      console.warn('Could not extract paragraph:', e);
      return '';
    }
  }).filter(Boolean).join('\n');
  
  return { content, paragraphs: paragraphs.length };
}
```

**Tests**:
```javascript
describe('BinderController.extractContent', () => {
  it('should handle empty document', async () => {
    mockWordDocument({ paragraphs: [] });
    const result = await controller.extractContent();
    expect(result).toEqual({ content: '', paragraphs: [] });
  });
  
  it('should handle missing document', async () => {
    mockWordDocument(null);
    await expect(controller.extractContent())
      .rejects.toThrow('No active Word document');
  });
  
  it('should handle corrupted paragraphs', async () => {
    mockWordDocument({
      paragraphs: [
        { Range: { Text: 'OK' } },
        { Range: null }, // corrupted
        { Range: { Text: 'OK2' } }
      ]
    });
    const result = await controller.extractContent();
    expect(result.content).toBe('OK\nOK2');
  });
});
```

✅ All tests GREEN

**Commits**:
```bash
git commit -m "test: add failing test for empty document crash #456"
git commit -m "fix: handle empty Word document gracefully #456

- Add null/empty validation for ActiveDocument
- Return empty object instead of crashing
- Add try/catch for individual paragraph extraction
- Fixes #456"
git commit -m "test: add edge cases for document extraction #456"
```

## Tools & Commands

### Chrome Extension Debugging
```javascript
// In background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('📨 Message received:', {
    msg,
    sender: sender.tab?.url,
    timestamp: new Date().toISOString()
  });
});
```

### Word COM Debugging
```javascript
// Test Word connection
async function testWordConnection() {
  try {
    const word = new ActiveXObject("Word.Application");
    console.log('✅ Word connected:', word.Version);
    return true;
  } catch (e) {
    console.error('❌ Word connection failed:', e);
    return false;
  }
}
```

### Network Debugging
```bash
# Check if backend is running
curl http://localhost:3000/health

# Test specific endpoint
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}'
```

## Anti-patterns

❌ **Guess & Check**: Mudar código aleatoriamente até funcionar
❌ **Symptom Fix**: Corrigir só onde falha visualmente
❌ **No Test**: Corrigir sem teste reprodutor
❌ **Quick Fix**: Corrigir sem entender o porquê
❌ **Move On**: Corrigir e não adicionar testes preventivos

## Integration com AnswerHunter

Áreas comuns de bugs:
1. **COM Integration**: Word pode estar fechado/travado
2. **Chrome APIs**: Permissions podem ser negadas
3. **Backend API**: Rede pode falhar
4. **Storage**: QuotaExceeded errors
5. **Content Script**: Page context isolado

Para cada área, tenha defensive programming.

## Logs Structure

```javascript
// Use níveis apropriados
console.error('🔴 CRITICAL:', err); // Quebra funcionalidade
console.warn('🟡 WARNING:', issue); // Degradação
console.info('🔵 INFO:', event); // Eventos importantes
console.debug('🟤 DEBUG:', data); // Debugging detalhado
```

## Quando Chamar Ajuda

Se after 45-60 minutos você:
- Não consegue reproduzir
- Não consegue localizar
- Não entende a causa
- Fix não funciona

Documente o que tentou e peça ajuda com contexto completo.

## Mantras

> "Fix the cause, not the crash"
> "If you can't reproduce it, you can't fix it"
> "Tests first, fix second"
> "Defensive code prevents defensive debugging"
