# Skill: Brainstorming

## Quando usar
- Antes de começar a implementar uma nova feature
- Quando receber um pedido vago ou ambíguo
- Para explorar alternativas de design
- Antes de fazer mudanças arquiteturais significativas

## Objetivo
Refinar ideias através de perguntas socráticas, explorando alternativas e validando a compreensão antes de codificar.

## Processo

### 1. Entender o Contexto
Primeiro, faça perguntas para clarificar:
- Qual é o problema real que estamos resolvendo?
- Quem são os usuários afetados?
- Quais são as restrições técnicas?
- Há soluções existentes que podemos aproveitar?

### 2. Explorar Alternativas
Apresente pelo menos 2-3 abordagens diferentes:
- Abordagem simples (MVP)
- Abordagem robusta (completa)
- Abordagem inovadora (se aplicável)

Para cada uma, liste:
- ✅ Prós
- ❌ Contras
- ⏱️ Estimativa de esforço
- 🎯 Casos de uso cobertos

### 3. Apresentar Design em Seções
Divida o design em seções digestíveis:
- **User Stories** (3-5 frases cada)
- **Arquitetura** (componentes e fluxos)
- **Interface** (UI/UX se aplicável)
- **Dados** (estruturas e persistência)
- **Testes** (estratégia de validação)

Apresente UMA seção por vez e aguarde validação.

### 4. Salvar Documentação
Após aprovação, salve em `.agents/specs/FEATURE_NAME.md` com:
- Resumo executivo
- Decisões de design e justificativas
- Arquitetura proposta
- Cronograma aproximado
- Riscos identificados

## Exemplo para AnswerHunter

**Contexto**: Adicionar suporte para buscar em PDFs

**Perguntas**:
- Os PDFs estão localmente ou online?
- Precisamos extrair texto ou só buscar?
- Como isso se integra com a busca existente do Word?
- Há limite de tamanho de PDF?

**Alternativas**:
1. **Simples**: Integrar com API do Google Drive
   - ✅ Rápido, confiável
   - ❌ Depende de serviço externo
   - ⏱️ 1 dia

2. **Robusta**: Usar PDF.js para processar localmente
   - ✅ Offline, privado
   - ❌ Mais complexo
   - ⏱️ 3-4 dias

3. **Híbrida**: PDF.js com cache inteligente
   - ✅ Melhor dos dois mundos
   - ❌ Requer mais planejamento
   - ⏱️ 5 dias

## Anti-patterns a Evitar
❌ Começar a codificar antes de entender o problema
❌ Assumir requisitos sem validar
❌ Ignorar complexidade oculta
❌ Não documentar decisões de design
❌ Apresentar design completo de uma vez (too much info)

## Output Esperado
- Documento de spec aprovado em `.agents/specs/`
- Lista clara de user stories priorizadas
- Consenso sobre a abordagem escolhida
- Pronto para passar para `writing-plans`

## Integração com AnswerHunter
Este projeto tem:
- **Frontend**: Extension MVC (controllers, models, views, services)
- **Backend**: Node.js/Express API
- **Integração**: Word COM, Chrome APIs

Considere impacto em todas as camadas durante brainstorming.
