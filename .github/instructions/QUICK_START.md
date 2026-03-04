# Quick Start Guide - AnswerHunter Agent Skills

## Como usar com GitHub Copilot

### Método 1: Comandos Naturais
Apenas peça o que precisa e o Copilot associará à skill apropriada:

```
"Vamos fazer brainstorming sobre adicionar suporte a PDFs"
"Crie um plano para implementar cache de buscas"
"Aplique TDD para criar o SearchService"
"Faça uma review do meu código"
"Debug deste crash quando documento está vazio"
```

### Método 2: Referência Explícita
Mencione a skill diretamente:

```
"Use a skill de brainstorming para..."
"Seguindo a skill de TDD, vamos..."
"Aplique systematic-debugging neste problema"
```

### Método 3: Abrir Arquivo
Abra o arquivo `.agents/skills/[skill-name]/SKILL.md` para dar contexto ao Copilot.

---

## [STUDY] Skills Disponíveis - Cheat Sheet

### brainstorming
**Quando**: Antes de codificar nova feature
**Output**: Spec document em `.agents/specs/`
**Comando**: *"Vamos fazer brainstorming sobre [feature]"*

### [NOTE] writing-plans
**Quando**: Após spec aprovada
**Output**: Implementation plan em `.agents/plans/`
**Comando**: *"Crie um plano de implementação para [spec]"*

### [TEST] test-driven-development
**Quando**: SEMPRE ao codificar
**Processo**: RED → GREEN → REFACTOR
**Comando**: *"Use TDD para implementar [feature]"*

### [SEARCH] systematic-debugging
**Quando**: Bug ou teste falhando
**Fases**: REPRODUCE → LOCATE → DIAGNOSE → FIX
**Comando**: *"Debug este problema: [descrição]"*

### requesting-code-review
**Quando**: Antes de commit
**Output**: Review report
**Comando**: *"Faça code review das minhas mudanças"*

---

## [TARGET] Workflow Completo - Exemplo

### Cenário: Adicionar busca em histórico

```
1️⃣ BRAINSTORMING
Você: "Preciso adicionar busca no histórico de AnswerHunter"
Copilot: [faz perguntas, explora alternatives, cria spec]
Output: .agents/specs/search-history.md

2️⃣ PLANNING
Você: "Crie um plano baseado na spec"
Copilot: [quebra em tarefas 2-5 min cada]
Output: .agents/plans/search-history-plan.md

3️⃣ IMPLEMENTATION (TDD)
Você: "Vamos implementar a Task 1"
Copilot: 
  - Escreve teste (RED)
  - Implementa código (GREEN)
  - Refatora (REFACTOR)
  - Commit

Repeat for each task...

4️⃣ REVIEW
Você: "Review antes de commitar"
Copilot: [aplica checklist, identifica issues]
Output: .agents/reviews/YYYYMMDD-search-history.md

5️⃣ FIX & MERGE
Você: Corrige issues encontrados
Copilot: Verifica tudo OK
Done! [OK]
```

---

## [TIP] Dicas de Uso

### [OK] Faça
- Mencione context: "No projeto AnswerHunter, que é uma extensão Chrome..."
- Seja específico: "Aplique TDD para criar o cache service"
- Use os templates: Peça para usar os templates em `.agents/templates/`
- Commit frequente: Após cada task GREEN

### [FAIL] Evite
- Pular TDD: "Sem testes" não é opção
- Tarefas grandes: Quebre em pedaços menores
- Specs vagas: Refine até estar clara
- Código sem teste: DELETE e recomece com teste

---

## Templates Disponíveis

### Feature Spec
```bash
# Copie o template
cp .agents/templates/FEATURE_SPEC.md .agents/specs/minha-feature.md
```
Ou peça: *"Use o template de spec para criar spec de [feature]"*

### Implementation Plan
```bash
cp .agents/templates/IMPLEMENTATION_PLAN.md .agents/plans/minha-feature-plan.md
```
Ou peça: *"Use o template de plano para planejar [spec]"*

---

## [FIX] Comandos Úteis

### Testing
```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage

# Specific file
npm test SearchService
```

### Linting
```bash
npm run lint
```

### Backend
```bash
cd backend
npm start
```

### Extension
```
Chrome → Extensions → Load unpacked → Selecione pasta do projeto
```

---

## [GRAD] Princípios Fundamentais

### TDD é Lei
```
[FAIL] NUNCA: Code → Test
[OK] SEMPRE: Test → Code
```

### YAGNI (You Aren't Gonna Need It)
```
[FAIL] "Vou adicionar isso por precaução"
[OK] "Está na spec? Não? Não adicione."
```

### DRY (Don't Repeat Yourself)
```
[FAIL] Copy-paste código
[OK] Abstraia em função/classe
```

### Evidence Over Claims
```
[FAIL] "Está funcionando" (sem verificar)
[OK] "Teste passa, logs confirmam"
```

---

## [OPEN] Estrutura de Arquivos

```
.agents/
├── README.md                  ← Overview geral
├── QUICK_START.md            ← Este arquivo
├── skills/                    ← Skills disponíveis
│   ├── brainstorming/
│   ├── writing-plans/
│   ├── test-driven-development/
│   ├── systematic-debugging/
│   └── requesting-code-review/
├── templates/                 ← Templates para usar
│   ├── FEATURE_SPEC.md
│   └── IMPLEMENTATION_PLAN.md
├── specs/                     ← Specs de features (criar)
├── plans/                     ← Planos de implementação (criar)
└── reviews/                   ← Code reviews (criar)
```

---

## [BUG] Troubleshooting

### "Copilot não está usando as skills"
1. Mencione explicitamente: *"Use a skill de TDD"*
2. Abra o arquivo da skill antes de pedir
3. Dê mais contexto sobre o projeto

### "Plano está muito grande"
- Quebre em tarefas menores (2-5 min cada)
- Uma responsabilidade por task
- Use sub-tasks se necessário

### "Testes estão falhando"
1. Rode `npm test` para ver output completo
2. Use skill de debugging
3. Verifique se seguiu RED-GREEN-REFACTOR

### "Copilot quer pular testes"
[FAIL] Não permita!
- Lembre: *"TDD é obrigatório, escreva o teste primeiro"*
- Abra o arquivo `test-driven-development/SKILL.md`

---

## [BOOK] Aprendendo Mais

### Leia as Skills
Cada skill tem exemplos práticos e anti-patterns.

Comece por:
1. `brainstorming/SKILL.md` - Design antes de código
2. `test-driven-development/SKILL.md` - O ciclo sagrado
3. `writing-plans/SKILL.md` - Como planejar bem

### Pratique
Pegue uma pequena feature e siga o workflow completo:
- Brainstorm → Spec → Plan → Implement w/ TDD → Review → Merge

### Refine
- Ajuste os templates para seu estilo
- Adicione suas próprias skills
- Compartilhe learnings em commits

---

## [TARGET] Próximos Passos

1. **Leia**: [`.agents/README.md`](README.md) para overview
2. **Explore**: Abra cada skill e leia os exemplos
3. **Pratique**: Pegue uma task real e use as skills
4. **Refine**: Ajuste o que não funcionar para você

---

## Exemplos de Interação

### Exemplo 1: Nova Feature
```
 Você: Quero adicionar filtros de busca por data no AnswerHunter

[BOT] Copilot: Vou usar a skill de brainstorming para refinar isso.
           Algumas perguntas primeiro:
           - Os filtros são para resultados de busca no Word?
           - Que range de datas? (última semana, mês, ano, custom?)
           - Onde na UI esses filtros aparecerão?
           ...
           
[Após discussão]

[BOT] Copilot: Aqui está a spec que criei em .agents/specs/date-filters. md
           [mostra seções da spec]
           
 Você: Aprovado! Vamos implementar.

[BOT] Copilot: Criando plano de implementação...
           [cria plano com 15 tasks]
           Pronto! .agents/plans/date-filters-plan.md
           
           Vamos começar pela Task 1? (Adicionar dependências)

 Você: Sim, vamos!

[BOT] Copilot: [RED] Primeiro o teste...
           [escreve teste que falha]
           Teste falha como esperado. Agora implemento?
           
 Você: Sim

[BOT] Copilot: [GREEN] Implementação...
           [escreve código mínimo]
           [OK] Teste passa! Task 1 completa. Próxima?
```

### Exemplo 2: Bug Fix
```
 Você: A extensão crasha quando busco com "&" na query

[BOT] Copilot: Vou usar systematic-debugging.
           
           Phase 1: REPRODUCE
           Criando teste que reproduz o bug...
           [cria teste]
           [OK] Teste falha com mesmo erro. Bug reproduzido.
           
           Phase 2: LOCATE
           Analisando stack trace...
           Encontrado: SearchService.js linha 45
           [mostra código]
           
           Phase 3: DIAGNOSE  
           Root cause: Query não escapa caracteres especiais HTML
           antes de processar.
           
           Phase 4: FIX
           Vou implementar fix com defense-in-depth:
           [implementa validação em múltiplas camadas]
           
           [OK] Teste original passa
           [OK] Edge cases adicionados
           Pronto para commit?

 Você: Sim, faça code review primeiro

[BOT] Copilot: [aplica checklist de review]
           [OK] Tudo OK, pode commitar!
```

---

## Você está pronto!

Comece pequeno, pratique o workflow, e logo estará usando as skills naturalmente.

**Lembre-se**: Skills são ferramentas, não regras rígidas. Adapte ao que funciona para você!

Happy coding! 
