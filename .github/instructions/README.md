# AnswerHunter Agent Skills

Sistema de skills inspirado no **Superpowers**, adaptado para GitHub Copilot no VS Code.

## Como usar

O GitHub Copilot lerá automaticamente estas instruções quando relevante. Você também pode:

1. **Referenciar skills explicitamente**: 
   - "Use a skill de brainstorming para refinar esta feature"
   - "Aplique TDD conforme a skill"

2. **Abrir o arquivo da skill** que desejar usar para dar contexto ao Copilot

3. **Usar comandos naturais** que o Copilot associará às skills apropriadas

## Skills Disponíveis

### Design & Planejamento
- **brainstorming** - Refina ideias antes de codificar
- **writing-plans** - Cria planos detalhados de implementação

### [TEST] Desenvolvimento
- **test-driven-development** - Ciclo RED-GREEN-REFACTOR
- **systematic-debugging** - Processo estruturado de debug

### Colaboração
- **requesting-code-review** - Checklist antes de commitar
- **finishing-a-task** - Verifica completude antes de finalizar

## Estrutura

```
.agents/
├── README.md (este arquivo)
├── skills/
│   ├── brainstorming/
│   │   └── SKILL.md
│   ├── writing-plans/
│   │   └── SKILL.md
│   ├── test-driven-development/
│   │   └── SKILL.md
│   └── ...
└── templates/
    ├── FEATURE_SPEC.md
    └── IMPLEMENTATION_PLAN.md
```

## Filosofia

- **Test-Driven Development** - Testes primeiro, sempre
- **Systematic over ad-hoc** - Processo ao invés de improviso
- **Complexity reduction** - Simplicidade como objetivo primário
- **Evidence over claims** - Verificar antes de declarar sucesso

## Para o Projeto AnswerHunter

Este projeto é uma extensão Chrome com backend Node.js. As skills são adaptadas para:
- Arquitetura MVC da extensão
- API backend em Express
- Integração COM Microsoft Word
- Testes com Jest e Puppeteer
