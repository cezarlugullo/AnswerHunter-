# AnswerHunter → Plataforma de Estudo Profissional
## Blueprint de Evolução Completo

> **Autor**: Platform Architect & Learning Experience Designer  
> **Data**: Março 2026  
> **Versão**: 1.0  

---

## Índice

1. [Comparativo de 10 Plataformas Analisadas](#1-comparativo-de-10-plataformas-analisadas)
2. [Mapa de Lacunas da AnswerHunter](#2-mapa-de-lacunas-da-answerhunter)
3. [Blueprint de Arquitetura Profissional](#3-blueprint-de-arquitetura-profissional)
4. [Lista de Ferramentas UI para Melhoria](#4-lista-de-ferramentas-ui-para-melhoria)
5. [Roadmap de Implementação](#5-roadmap-de-implementação)
6. [Métricas e Tracking](#6-métricas-e-tracking)
7. [Guia de Estilo Visual e Interação](#7-guia-de-estilo-visual-e-interação)

---

## 1. Comparativo de 10 Plataformas Analisadas

### 1.1 Tabela Comparativa Principal

| Plataforma | Organização de Conteúdo | Caminhos Personalizados | Engajamento | Métricas/Analytics | Gamificação | AI/Personalização | Certificação |
|---|---|---|---|---|---|---|---|
| **Coursera** | Cursos → Semanas → Módulos → Aulas + Exercícios | Specializations, Professional Certificates, Degree Programs | Quizzes, peer assignments, discussões, projetos | Dashboard de progresso, taxas de conclusão, notas por módulo | Certificados, badges de conclusão | Recomendações baseadas em skill gaps, pacing adaptativo | Certificados verificados, diplomas universitários |
| **edX** | Programas → Cursos → Seções → Subsecções → Unidades | MicroMasters, MicroBachelors, Professional Certificates | Labs interativos, quizzes, projetos, fóruns | Dashboard de progresso, notas cumulativas, deadlines | Badges, certificados, milestones | Recomendações por carreira, adaptive learning | Certificados verificados, graus acadêmicos |
| **Khan Academy** | Domínios → Cursos → Unidades → Lições → Exercícios | Mastery paths por disciplina, courses "Get Ready" | Exercícios práticos, vídeos, hints progressivos | Dashboard de domínio (mastery %), tempo por tópico, heatmap de atividade | Pontos de energia, badges, streaks, avatars | ML para nível de dificuldade personalizado, Khanmigo AI tutor | Badges de maestria por unidade |
| **Udemy** | Cursos → Seções → Aulas (vídeo/texto/quiz) → Recursos | Career Accelerators (learning paths curados) | Q&A por aula, exercícios práticos, quizzes, recursos | Progresso por curso (% concluído), tempo assistido | Certificado de conclusão, selo de "completed" | Recomendações por tópico e histórico | Certificado de conclusão |
| **LinkedIn Learning** | Tópicos → Cursos → Capítulos → Vídeos + Quizzes | Learning Paths (1.300+ curados), Role Guides (35+ papéis) | 300K+ quizzes, exercise files, Codespaces, discussões | Skill evaluations, horas de aprendizado, skills adquiridas | Certificados exibíveis no perfil LinkedIn | Recomendações por cargo, gap analysis de habilidades | Professional Certificates (Microsoft, Zendesk, etc.) |
| **Canvas LMS** | Cursos → Módulos → Assignments → Pages → Discussions | Módulos sequenciais com pré-requisitos configuráveis | SpeedGrader, quizzes, Canvas Studio (vídeo interativo), discussões | Gradebook avançado, analytics de engajamento, relatórios | Outcomes-based tracking, conclusão de módulos | Adaptive release, diferenciação por grupos | Integração com Canvas Catalog para certificação |
| **Moodle** | Categorias → Cursos → Tópicos/Semanas → Atividades → Recursos | Completion tracking, conditional activities, competency frameworks | Fóruns, wikis, workshops, quizzes com banco de questões, H5P | Logs detalhados, relatórios de atividade, competency reports | Badges configuráveis, completion milestones | Plugins de adaptive learning, RecordBuddy | Badges, certificados custom |
| **Duolingo** | Idiomas → Seções → Unidades → Lições → Exercícios | Path único progressivo com checkpoints e desbloqueio | Exercícios gamificados, stories, podcasts, listening/speaking | Streak count, XP diário, accuracy rates, leaderboards | Streaks, XP, ligas, vidas, gems, streak freezes, leaderboards | ML para dificuldade adaptativa (500M+ learners) | Certificado Duolingo English Test |
| **Skillshare** | Categorias → Classes → Lições → Projetos | Curated collections, trending paths | Projetos práticos, discussões, reviews | Tempo assistido, classes concluídas, projetos criados | "Staff Pick" badges, teacher following | Recomendações por interesse e viewing history | Sem certificação formal |
| **Anki / Quizlet** | Decks → Cards (front/back), Tags | Decks organizados por assunto, estudo filtrado | Flashcards SRS, matching games, write mode, test mode | Retention rate, cards due, review forecast, heatmap | Streaks (Quizlet), mastery levels | FSRS-5 scheduling (Anki), adaptive practice | Sem certificação |

### 1.2 Insights Extraídos por Categoria

#### 📐 Organização de Conteúdo — Padrões Identificados

| Padrão | Plataformas que Usam | Descrição |
|---|---|---|
| **Hierarquia 4-5 níveis** | Todas | Mínimo: Programa → Curso → Módulo → Aula → Exercício |
| **Módulos sequenciais** | Canvas, Moodle, Coursera, edX | Desbloqueio progressivo com pré-requisitos |
| **Tags/Categorias transversais** | Khan Academy, LinkedIn Learning | Conteúdo acessível por múltiplos caminhos (por tópico, skill, carreira) |
| **Estimativa de tempo** | Udemy, LinkedIn Learning, Skillshare | Cada item tem duração estimada visível |
| **Nível de dificuldade** | Khan Academy, edX, Coursera | Iniciante → Intermediário → Avançado com labels claros |
| **Prerequisite mapping** | Canvas, Moodle | Sistema formal de dependências entre conteúdos |

**Insight Principal**: Plataformas profissionais NUNCA usam estrutura plana (lista de itens). Sempre há **hierarquia rica** com **metadados** (duração, nível, tipo, tags) e **múltiplos caminhos de acesso** ao mesmo conteúdo.

#### 🎯 Caminhos de Aprendizado — Padrões Identificados

| Estratégia | Exemplos | Impacto |
|---|---|---|
| **Path curado por especialistas** | LinkedIn Learning Paths, Coursera Specializations | Reduz paralisia de escolha, orienta progressão |
| **Path adaptativo por performance** | Khan Academy mastery, Duolingo adaptive | Ajusta dificuldade e conteúdo ao nível do aluno |
| **Path por objetivo/carreira** | LinkedIn Role Guides, edX Professional Certificates | "Quero ser Data Scientist" → sequência específica |
| **Checkpoints e assessment** | Duolingo checkpoints, Khan Academy unit tests | Validação periódica de aprendizado |
| **"Start Here" guidance** | Khan Academy, Duolingo | Onboarding que define ponto de partida |

**Insight Principal**: A combinação de **paths curados** + **adaptação por performance** é o padrão gold standard. O aluno tem um caminho recomendado mas o sistema ajusta com base no desempenho.

#### 🔥 Engajamento — Ferramentas Mais Eficazes

| Ferramenta | Impacto Comprovado | Plataformas |
|---|---|---|
| **Spaced Repetition** | +200% retenção de longo prazo | Anki, Duolingo, Khan Academy |
| **Quizzes interativos** | +40% engajamento vs vídeo passivo | Todas |
| **Hints progressivos (Socráticos)** | Mantém o aluno no desafio sem frustração | Khan Academy, Duolingo |
| **Streak tracking** | +55% retorno diário | Duolingo, Khan Academy, Anki |
| **Leaderboards** | +30% atividade (com grupos pequenos) | Duolingo (ligas), Quizlet |
| **Projetos práticos** | Aplicação de conhecimento, portfólio | Skillshare, Coursera, edX |
| **Social/Community** | Senso de pertencimento | Canvas (discussions), Moodle (forums) |
| **AI-powered explanations** | Reduz abandono em tópicos difíceis | Khan Academy (Khanmigo), Duolingo (Max) |

**Insight Principal**: AnswerHunter já tem FSRS-5, hints Socráticos, streaks e XP — está **muito acima** de extensões de estudo comuns. O gap é em **organização visual**, **paths curados** e **social features**.

#### 📊 Métricas e Analytics — Framework Comum

| Nível | Métricas | Exemplo Visual |
|---|---|---|
| **Micro** (por sessão) | Tempo estudado, cards revisados, accuracy | Timer + counter |
| **Meso** (por semana) | Streak, heatmap de atividade, XP acumulado | Heatmap GitHub-style |
| **Macro** (por disciplina) | Mastery %, retention rate, forgetting curve | Barra de progresso + gráfico |
| **Meta** (plataforma toda) | Progresso geral, disciplinas ativas, previsão | Dashboard overview |

---

## 2. Mapa de Lacunas da AnswerHunter

### 2.1 Estado Atual — Inventário de Features

| Categoria | Feature Existente | Status | Maturidade |
|---|---|---|---|
| **Extração** | Extração de Q&A de qualquer página web | ✅ Funcional | ⭐⭐⭐⭐⭐ |
| **Busca** | Pipeline de busca com múltiplas fontes + AI | ✅ Funcional | ⭐⭐⭐⭐⭐ |
| **AI Multi-provider** | 5 provedores (Groq, Gemini, OpenRouter, ChatGPT, Copilot) | ✅ Funcional | ⭐⭐⭐⭐⭐ |
| **Binder** | Organização em pastas com drag & drop | ✅ Funcional | ⭐⭐⭐ |
| **Disciplinas** | Cards com cor, contagem, botões estudar/simulado | ✅ Funcional | ⭐⭐⭐ |
| **Study Page** | Flashcards, simulado, Pomodoro, mind map | ✅ Funcional | ⭐⭐⭐⭐ |
| **FSRS-5** | Spaced Repetition completo | ✅ Funcional | ⭐⭐⭐⭐⭐ |
| **AI Pedagógica** | Why Wrong, Socratic Hints, Step-by-Step, Review Cards | ✅ Funcional | ⭐⭐⭐⭐⭐ |
| **Dashboard** | Heatmap, retention chart, XP, streaks, JOL | ✅ Funcional | ⭐⭐⭐ |
| **i18n** | pt-BR + English (popup apenas) | ⚠ Parcial | ⭐⭐⭐ |
| **Dark Mode** | Study page only | ⚠ Parcial | ⭐⭐ |

### 2.2 Gap Analysis — AnswerHunter vs. Padrão Profissional

#### 🔴 Lacunas Críticas (Impacto Alto)

| # | Lacuna | Padrão Profissional | Estado Atual AH | Impacto |
|---|---|---|---|---|
| G1 | **Hierarquia de conteúdo insuficiente** | 4-5 níveis (Disciplina → Módulo → Tópico → Exercício → Card) | 2 níveis (Pasta → Questão) | Organização pobre com escala. Impossível navegar 500+ questões. |
| G2 | **Ausência de Learning Paths** | Caminhos recomendados com checkpoints, prerequisitos e progressão | Inexistente | Aluno não sabe o que estudar primeiro, não há orientação de progressão. |
| G3 | **Sem metadados ricos no conteúdo** | Nível, tempo estimado, tags, tipo de conteúdo, ano, fonte | Apenas `subject` e `topic` | Impossível fazer filtros avançados, recomendações ou paths adaptativos. |
| G4 | **Dashboard limitado e hardcoded** | Dashboard como hub central com widgets configuráveis | Dashboard básico, hardcoded em PT | Não escala, não é personalizável, sem i18n. |
| G5 | **Sem calendário/planejamento** | Calendário de estudos com metas, deadlines e lembretes | Inexistente | Falta estrutura temporal para planejar sessões. |
| G6 | **Sem busca inteligente interna** | Search com sugestões, filtros, relevância, histórico | Apenas filtro por disciplina na Study page | Encontrar conteúdo específico em 500+ itens é impossível. |

#### 🟡 Lacunas Importantes (Impacto Médio)

| # | Lacuna | Padrão Profissional | Estado Atual AH | Impacto |
|---|---|---|---|---|
| G7 | **Gamificação limitada** | Badges, leaderboards, metas diárias, rewards | XP + streak (básico) | Falta visualização de conquistas, metas configuráveis, celebrations. |
| G8 | **Sem anotações vinculadas** | Notas/anotações ligadas a questões/tópicos | Inexistente | Aluno não pode registrar insights durante o estudo. |
| G9 | **Sem checklist de estudo semanal** | Planejamento semanal com tasks e tracking | Inexistente | Sem estrutura para rotina de estudo. |
| G10 | **Sem flashcards auto-gerados** | AI gera flashcards de resumos/textos | Precisa criar manualmente | Adicionar questões é gargalo manual. |
| G11 | **Sem recomendações automáticas** | Baseado em performance, identifica pontos fracos | Inexistente | Aluno não sabe onde focar esforço. |
| G12 | **Sem export/relatórios profissionais** | PDF reports, progress sharing | Export JSON apenas | Não comunicável para terceiros. |

#### 🟢 Lacunas Menores (Nice-to-have)

| # | Lacuna | Padrão Profissional | Estado Atual AH |
|---|---|---|---|
| G13 | **Sem collaborative features** | Compartilhar decks, competir com amigos | Single-user |
| G14 | **Sem integração com calendário externo** | Google Calendar, Outlook sync | Inexistente |
| G15 | **Sem modo offline completo** | Service Worker + cache | Depende de storage local |
| G16 | **Study page sem i18n** | Multi-idioma em todas as telas | Hardcoded em PT |
| G17 | **CSS em arquivo monolítico** | CSS Modules ou Tailwind | 13K linhas em arquivo único |
| G18 | **Sem onboarding de estudo** | Tutorial interativo para features de estudo | Apenas setup wizard de API keys |

### 2.3 Mapa Visual de Maturidade

```
                    AnswerHunter Maturity Map
                    ========================

  EXTRAÇÃO & AI        ████████████████████ 95%  ← Excelente
  BUSCA & EVIDÊNCIA    ████████████████████ 90%  ← Excelente
  SPACED REPETITION    ████████████████████ 90%  ← Excelente (FSRS-5)
  AI PEDAGÓGICA        ████████████████████ 85%  ← Muito Bom
  STUDY TOOLS          ███████████████░░░░░ 70%  ← Bom (faltam flashcards auto, anotações)
  BINDER/STORAGE       ██████████████░░░░░░ 65%  ← Bom (hierarquia limitada)
  DASHBOARD            ██████████░░░░░░░░░░ 50%  ← Razoável (hardcoded, limitado)
  GAMIFICAÇÃO          ████████░░░░░░░░░░░░ 40%  ← Básico (XP + streak)
  ORGANIZAÇÃO          ██████░░░░░░░░░░░░░░ 30%  ← Fraco (sem paths, tags, metadados)
  PLANEJAMENTO         ████░░░░░░░░░░░░░░░░ 20%  ← Muito Fraco (sem calendário)
  NAVEGAÇÃO/SEARCH     ███░░░░░░░░░░░░░░░░░ 15%  ← Muito Fraco (sem search interna)
  SOCIAL/COLLAB        █░░░░░░░░░░░░░░░░░░░  5%  ← Inexistente
```

**Diagnóstico**: AnswerHunter é **best-in-class** em AI/extração/SRS, mas tem **nível básico** em organização, navegação e experiência de plataforma. A evolução deve focar em transformar um **motor de questões excelente** em uma **plataforma de estudo completa**.

---

## 3. Blueprint de Arquitetura Profissional

### 3.1 Arquitetura de Conteúdo — Modelo Hierárquico

```
┌─────────────────────────────────────────────────────────────────┐
│                    STUDY WORKSPACE (Raiz)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─── Disciplina (ex: Direito Constitucional) ──────────────┐   │
│  │  metadata: { color, icon, level, totalQuestions,          │   │
│  │             progress%, createdAt, lastStudied,            │   │
│  │             estimatedHours, targetDate }                  │   │
│  │                                                           │   │
│  │  ┌─── Módulo (ex: Direitos Fundamentais) ────────────┐   │   │
│  │  │  metadata: { order, prerequisiteModuleId,          │   │   │
│  │  │             estimatedMinutes, completionRate }      │   │   │
│  │  │                                                    │   │   │
│  │  │  ┌─── Tópico (ex: Art. 5° - Igualdade) ───────┐  │   │   │
│  │  │  │  metadata: { difficulty: 1-5, tags[],        │  │   │   │
│  │  │  │             type: 'teoria'|'exercício',      │  │   │   │
│  │  │  │             year, source, notes[] }          │  │   │   │
│  │  │  │                                              │  │   │   │
│  │  │  │  ┌─── Card/Questão ──────────────────────┐  │  │   │   │
│  │  │  │  │  { question, answer, alternatives[],   │  │   │   │
│  │  │  │  │    sources[], sm2/fsrs{}, tags[],      │  │   │   │
│  │  │  │  │    difficulty, notes[], flashcard{},   │  │   │   │
│  │  │  │  │    relatedCardIds[], createdAt }       │  │   │   │
│  │  │  │  └───────────────────────────────────────┘  │  │   │   │
│  │  │  └─────────────────────────────────────────────┘  │   │   │
│  │  └───────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─── Learning Path (cross-discipline) ─────────────────────┐   │
│  │  { title, description, steps[]: [{disciplineId,           │   │
│  │    moduleId, topicId, order, isCheckpoint}],               │   │
│  │    estimatedDays, difficulty, targetExam }                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─── Tag Registry ─────────────────────────────────────────┐   │
│  │  { tagName → [cardId, cardId, ...] }                      │   │
│  │  Permite acesso transversal: "constitucional" retorna     │   │
│  │  cards de múltiplas disciplinas                            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Modelo de Dados Evoluído

```javascript
// ========== NOVA ESTRUTURA DE DADOS ==========

// Disciplina (evolução de ah_disciplines)
const Discipline = {
  id: 'disc_uuid',
  name: 'Direito Constitucional',
  shortName: 'Dir. Const.',
  color: '#FF6B6B',
  icon: 'gavel',                    // Material Symbol name
  level: 'intermediate',            // beginner | intermediate | advanced
  description: 'Estudo da Constituição Federal...',
  tags: ['direito', 'constitucional', 'oab'],
  modules: ['mod_uuid1', 'mod_uuid2'],
  targetDate: '2026-06-15',         // meta de conclusão
  estimatedHours: 120,
  createdAt: timestamp,
  lastStudiedAt: timestamp,
  settings: {
    dailyGoalCards: 20,
    reviewReminder: true,
    reminderTime: '08:00'
  }
};

// Módulo (NOVO — nível intermediário)
const Module = {
  id: 'mod_uuid',
  disciplineId: 'disc_uuid',
  name: 'Direitos Fundamentais',
  order: 1,
  prerequisiteModuleIds: [],        // módulos que devem ser concluídos antes
  estimatedMinutes: 240,
  topics: ['topic_uuid1', 'topic_uuid2'],
  description: 'Estudo dos arts. 5° ao 17...',
  isLocked: false,                  // baseado em prerequisitos
  completionRate: 0.65
};

// Tópico (NOVO — agrupa questões por tema)
const Topic = {
  id: 'topic_uuid',
  moduleId: 'mod_uuid',
  name: 'Art. 5° - Igualdade',
  order: 1,
  difficulty: 3,                    // 1-5
  type: 'mixed',                    // theory | exercise | mixed
  tags: ['igualdade', 'artigo5', 'clausula-petrea'],
  cards: ['card_uuid1', 'card_uuid2'],
  notes: [{                         // anotações do aluno
    id: 'note_uuid',
    text: 'Lembrar: igualdade formal vs material',
    createdAt: timestamp
  }],
  summary: 'AI-generated summary...',
  estimatedMinutes: 30,
  year: 2024,                       // ano do conteúdo/prova
  source: 'OAB 2024.1'
};

// Card/Questão (evolução do binder question)
const Card = {
  id: 'card_uuid',
  topicId: 'topic_uuid',           // referência hierárquica
  type: 'multiple_choice',          // multiple_choice | true_false | open | flashcard
  question: '...',
  answer: 'B',
  alternatives: [
    { letter: 'A', text: '...', isCorrect: false },
    { letter: 'B', text: '...', isCorrect: true },
    // ...
  ],
  explanation: '...',               // AI step-by-step
  sources: [{url, title, snippet}],
  
  // Metadados ricos
  difficulty: 3,
  tags: ['artigo5', 'igualdade'],
  year: 2024,
  examSource: 'OAB 2024.1 - Q42',
  estimatedSeconds: 120,
  
  // FSRS-5 data (existente, expandido)
  fsrs: {
    stability: 0,
    difficulty: 0,
    state: 'new',                   // new | learning | review | relearning
    nextReview: null,
    lastReview: null,
    reps: 0,
    lapses: 0,
    history: []                     // NEW: histórico de reviews
  },
  
  // Novo: anotações por card
  notes: [],
  
  // Novo: flashcard gerado automaticamente
  flashcard: {
    front: 'O que estabelece o Art. 5° CF?',
    back: 'Igualdade de todos perante a lei...',
    autoGenerated: true
  },
  
  // Novo: relações
  relatedCardIds: [],
  
  createdAt: timestamp,
  updatedAt: timestamp
};

// Learning Path (NOVO — trilha de estudo cross-discipline)
const LearningPath = {
  id: 'path_uuid',
  name: 'Preparação OAB 2026.2',
  description: 'Trilha completa para 1ª fase OAB',
  icon: 'school',
  steps: [
    {
      order: 1,
      disciplineId: 'disc_uuid',
      moduleId: 'mod_uuid',       // optional: pode apontar para módulo específico
      topicId: null,               // optional: pode apontar para tópico
      isCheckpoint: false,
      isCompleted: false
    },
    {
      order: 2,
      type: 'checkpoint',
      isCheckpoint: true,
      checkpointType: 'simulado',  // simulado | review | assessment
      minScore: 0.7,               // 70% para avançar
      isCompleted: false
    }
  ],
  estimatedDays: 90,
  difficulty: 'intermediate',
  targetExam: 'OAB 2026.2',
  progress: 0.35,
  createdAt: timestamp
};

// Study Plan (NOVO — calendário e metas)
const StudyPlan = {
  id: 'plan_uuid',
  name: 'Semana 1 - Março',
  weekStart: '2026-03-02',
  dailyGoals: {
    monday:    { cards: 30, minutes: 60, disciplines: ['disc_uuid'] },
    tuesday:   { cards: 20, minutes: 45, disciplines: ['disc_uuid'] },
    wednesday: { cards: 30, minutes: 60, disciplines: ['disc_uuid2'] },
    thursday:  { cards: 20, minutes: 45, disciplines: ['disc_uuid2'] },
    friday:    { cards: 40, minutes: 90, disciplines: ['disc_uuid', 'disc_uuid2'] },
    saturday:  { cards: 50, minutes: 120, type: 'simulado' },
    sunday:    { cards: 0, minutes: 0, type: 'rest' }
  },
  completedDays: {},
  adherence: 0.85                   // % de aderência ao plano
};

// Badge System (NOVO — gamificação expandida)
const Badge = {
  id: 'badge_first_100',
  name: 'Centenário',
  description: 'Complete 100 questões',
  icon: '🏆',                       // or SVG path
  category: 'milestone',            // milestone | streak | mastery | special
  condition: { type: 'total_cards', threshold: 100 },
  earnedAt: null,
  progress: 67                      // current: 67/100
};

// Notes System (NOVO)
const Note = {
  id: 'note_uuid',
  parentType: 'card',               // card | topic | module | discipline
  parentId: 'card_uuid',
  text: 'Atenção: pegadinha comum neste tema...',
  highlight: 'text snippet highlighted',
  color: 'yellow',
  createdAt: timestamp,
  updatedAt: timestamp
};
```

### 3.3 Arquitetura de Serviços — Novos Módulos

```
┌──────────────────────────────────────────────────────────────────┐
│                     SERVICE LAYER (Evolved)                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  EXISTENTES (mantidos)                                            │
│  ├── ApiService.js          → AI multi-provider calls             │
│  ├── SimpleSearchService.js → Web search pipeline                 │
│  ├── ExtractionService.js   → DOM Q&A extraction                  │
│  ├── FSRSService.js         → Spaced repetition                   │
│  ├── PedagogicalPromptsService.js → AI study aids                 │
│  ├── I18nService.js         → Translations                        │
│  └── StorageModel.js        → Binder persistence                  │
│                                                                   │
│  NOVOS SERVIÇOS                                                   │
│  ├── ContentHierarchyService.js    → CRUD para Discipline →       │
│  │                                   Module → Topic → Card        │
│  ├── LearningPathService.js        → Gestão de trilhas de estudo  │
│  ├── StudyPlanService.js           → Calendário + metas + agenda  │
│  ├── SearchIndexService.js         → Índice de busca interna      │
│  │                                   (fuzzy search, tags, filters) │
│  ├── RecommendationService.js      → Recomendações por performance│
│  │                                   (pontos fracos, próximos      │
│  │                                    tópicos, revisões urgentes)  │
│  ├── FlashcardGeneratorService.js  → AI auto-gera flashcards      │
│  │                                   de textos/questões            │
│  ├── NotesService.js               → CRUD de anotações vinculadas │
│  ├── BadgeService.js               → Sistema de badges/conquistas │
│  ├── StudyPlannerService.js        → Checklist semanal + planner  │
│  ├── AnalyticsService.js           → Métricas expandidas          │
│  │                                   (sessions, time tracking,     │
│  │                                    performance history)         │
│  ├── MigrationService.js           → Migração dados v1 → v2       │
│  └── ExportService.js              → PDF reports, insights export  │
│                                                                   │
│  CONTROLLERS (Evolução)                                           │
│  ├── PopupController.js     → Mantido + integração novos serviços │
│  ├── DashboardController.js → NOVO: orquestra dashboard expandido │
│  ├── StudyController.js     → Refactor de study.js (5700 lines)   │
│  ├── PathController.js      → NOVO: gestão de learning paths      │
│  └── PlannerController.js   → NOVO: calendário e planejamento     │
│                                                                   │
│  VIEWS (Evolução)                                                 │
│  ├── PopupView.js           → Mantido                             │
│  ├── DashboardView.js       → NOVO: rendering dashboard modular   │
│  ├── StudyView.js           → NOVO: desacoplado de study.js       │
│  └── ComponentLibrary.js    → NOVO: componentes reutilizáveis     │
└──────────────────────────────────────────────────────────────────┘
```

### 3.4 Arquitetura de Páginas — Mapa de Navegação

```
┌─────────────────────────────────────────────────────────────┐
│                    POPUP (Entry Point)                        │
│  ┌──────┐ ┌──────┐ ┌───────────┐ ┌──────────┐              │
│  │Search│ │Binder│ │Disciplinas│ │ Settings │              │
│  └──┬───┘ └──┬───┘ └─────┬─────┘ └────┬─────┘              │
│     │        │            │             │                    │
│     │        │            ▼             │                    │
│     │        │     "Abrir Dashboard"    │                    │
│     │        │            │             │                    │
└─────┼────────┼────────────┼─────────────┼────────────────────┘
      │        │            │             │
      ▼        ▼            ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│              DASHBOARD (Full Tab — Hub Central)               │
│                                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │Overview  │ │Disciplines│ │ Paths   │ │ Planner │       │
│  │(widgets) │ │ (grid)   │ │(trilhas) │ │(calendar)│       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│       │             │            │             │              │
│       │             ▼            ▼             │              │
│       │      ┌─────────────────────────┐       │              │
│       │      │  Discipline Detail      │       │              │
│       │      │  ├── Modules list       │       │              │
│       │      │  ├── Topics grid        │       │              │
│       │      │  ├── Progress chart     │       │              │
│       │      │  └── "Estudar" button   │       │              │
│       │      └────────────┬────────────┘       │              │
│       │                   │                    │              │
│       │                   ▼                    │              │
│       │      ┌─────────────────────────┐       │              │
│       │      │  STUDY PAGE (Full Tab)  │       │              │
│       │      │  ├── Flashcard mode     │       │              │
│       │      │  ├── Quiz mode          │       │              │
│       │      │  ├── Simulado mode      │       │              │
│       │      │  ├── Review mode        │       │              │
│       │      │  └── AI Tools sidebar   │       │              │
│       │      └─────────────────────────┘       │              │
│       │                                        │              │
│       ▼                                        ▼              │
│  ┌───────────┐                    ┌───────────────────┐      │
│  │Performance │                    │  Weekly Planner   │      │
│  │Analytics  │                    │  ├── Calendar     │      │
│  │├── Charts │                    │  ├── Checklist    │      │
│  │├── Insights│                    │  ├── Goals       │      │
│  │└── Export │                    │  └── Reminders    │      │
│  └───────────┘                    └───────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 3.5 UX/UI Design — Telas Principais

#### 3.5.1 Dashboard do Aluno (Hub Central)

```
┌─────────────────────────────────────────────────────────────────────┐
│  🎓 AnswerHunter                    🔍 Buscar...    ⚙️  🌙  👤     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─ SIDEBAR ──┐  ┌─────────────────────────────────────────────┐    │
│  │            │  │                                              │    │
│  │ 📊 Overview│  │  Bom dia, Cezar!                            │    │
│  │ 📚 Discipl.│  │  Nível: Estudioso (Lv.5) ████████░░ 2.340XP│    │
│  │ 🛤 Trilhas │  │  🔥 Streak: 12 dias                         │    │
│  │ 📅 Planner │  │                                              │    │
│  │ 📈 Perform.│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐       │    │
│  │ 🏆 Conquist│  │  │ 📝 327  │ │ ⏱ 45min │ │ 🎯 85%  │       │    │
│  │ ⚙ Settings│  │  │Questions│ │ Today   │ │Accuracy │       │    │
│  │            │  │  └─────────┘ └─────────┘ └─────────┘       │    │
│  │            │  │                                              │    │
│  │            │  │  ┌─── HOJE PARA REVISAR ─────────────────┐  │    │
│  │            │  │  │ 🔴 12 cards vencidos  [Revisar agora]  │  │    │
│  │            │  │  │ 🟡 8 cards para hoje  [Começar]        │  │    │
│  │            │  │  │ 🟢 5 cards novos      [Aprender]       │  │    │
│  │            │  │  └────────────────────────────────────────┘  │    │
│  │            │  │                                              │    │
│  │            │  │  ┌─── DISCIPLINAS ────────────────────────┐  │    │
│  │            │  │  │                                         │  │    │
│  │            │  │  │  ┌──────────┐ ┌──────────┐ ┌────────┐ │  │    │
│  │            │  │  │  │ ⚖ Dir.   │ │ 📐 Matemat│ │ 🧬 Bio │ │  │    │
│  │            │  │  │  │ Const.   │ │          │ │        │ │  │    │
│  │            │  │  │  │ ████░ 65%│ │ ██░░ 40% │ │ █░░ 20%│ │  │    │
│  │            │  │  │  │ 120 cards│ │ 87 cards │ │45 cards│ │  │    │
│  │            │  │  │  │ 🕐 3h est│ │ 🕐 2h est│ │🕐 1h   │ │  │    │
│  │            │  │  │  └──────────┘ └──────────┘ └────────┘ │  │    │
│  │            │  │  │                                         │  │    │
│  │            │  │  └────────────────────────────────────────┘  │    │
│  │            │  │                                              │    │
│  │            │  │  ┌─── HEATMAP DE ATIVIDADE ──────────────┐  │    │
│  │            │  │  │  [52 weeks GitHub-style heatmap]        │  │    │
│  │            │  │  └────────────────────────────────────────┘  │    │
│  │            │  │                                              │    │
│  └────────────┘  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.5.2 Tela de Disciplina (Detail View)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Dashboard  /  Direito Constitucional                    ⚙️ 🌙   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─── HEADER DA DISCIPLINA ──────────────────────────────────────┐  │
│  │  ⚖ Direito Constitucional                                      │  │
│  │  ████████████████░░░░ 65% completo · 120 questões · 78 cards  │  │
│  │  🏷 Tags: oab, constitucional, cláusulas-pétreas               │  │
│  │  Meta: Completar até 15/06/2026                                 │  │
│  │                                                                  │  │
│  │  [📝 Estudar]  [🎯 Simulado]  [📊 Performance]  [✏️ Editar]    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─── MÓDULOS ───────────────────────────────────────────────────┐  │
│  │                                                                  │  │
│  │  ┌─ 1. Princípios Fundamentais ──────────────── ✅ 100% ────┐ │  │
│  │  │  Arts. 1° ao 4° · 15 questões · Básico                    │ │  │
│  │  │  ├── Tópico: Fundamentos da República     ████████ 100%   │ │  │
│  │  │  ├── Tópico: Separação de Poderes          ████████ 100%   │ │  │
│  │  │  └── Tópico: Objetivos Fundamentais        ████████ 100%   │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │                                                                  │  │
│  │  ┌─ 2. Direitos Fundamentais ────────────────── 🟡 65% ─────┐ │  │
│  │  │  Arts. 5° ao 17° · 45 questões · Intermediário              │ │  │
│  │  │  ├── Tópico: Art. 5° - Igualdade           ████████ 90%   │ │  │
│  │  │  ├── Tópico: Art. 5° - Liberdades          ██████░░ 70%   │ │  │
│  │  │  ├── Tópico: Direitos Sociais              ████░░░░ 45%   │ │  │
│  │  │  └── Tópico: Direitos Políticos            ██░░░░░░ 25%   │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │                                                                  │  │
│  │  ┌─ 3. Organização do Estado ────────────────── 🔒 Bloqueado ┐ │  │
│  │  │  Pré-requisito: Complete módulo 2 com 70%+                  │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─── INSIGHTS ──────────────────────────────────────────────────┐  │
│  │  ⚠ Pontos fracos: Direitos Sociais (45% accuracy)              │  │
│  │  💡 Recomendação: Foque em Art. 6° e 7° antes de avançar       │  │
│  │  📊 Retention rate: 78% (acima da média)                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.5.3 Navegação de Conteúdos — Breadcrumb + Filtros

```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard > Dir. Constitucional > Direitos Fundamentais > Art. 5° │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌── FILTROS ────────────────────────────────────────────────────┐  │
│  │  Nível: [Todos ▾]  Tipo: [Todos ▾]  Tags: [+ Adicionar]       │  │
│  │  Dificuldade: ★☆☆☆☆ a ★★★★★   Ano: [2020-2026]               │  │
│  │  Status: [◉Todos ○Novos ○Em revisão ○Dominados ○Difíceis]     │  │
│  │  Ordenar: [Relevância ▾]  🔍 Buscar em 120 questões...         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌── RESULTADOS ─────────────────────────────────────────────────┐  │
│  │  Mostrando 12 de 45 questões · Filtro ativo: Intermediário      │  │
│  │                                                                  │  │
│  │  ┌─ Q1 ─────────────────────────────────── ★★★ · 🔴 Vencido ┐ │  │
│  │  │  O princípio da igualdade, previsto no art. 5°...           │ │  │
│  │  │  📝 OAB 2024.1 · ⏱ ~2min · 🏷 igualdade, art5              │ │  │
│  │  │  [Estudar] [Ver detalhes] [📌 Anotar]                       │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │                                                                  │  │
│  │  ┌─ Q2 ─────────────────────────────────── ★★ · 🟢 3 dias ──┐ │  │
│  │  │  Segundo o STF, a liberdade de expressão...                 │ │  │
│  │  │  📝 CESPE 2023 · ⏱ ~1min · 🏷 liberdade, expressao          │ │  │
│  │  │  [Estudar] [Ver detalhes] [📌 Anotar]                       │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.5.4 Painel de Performance

```
┌─────────────────────────────────────────────────────────────────────┐
│  📊 Performance Analytics                              [Exportar PDF]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─── RESUMO GERAL ─────────────────────────────────────────────┐  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────┐ │  │
│  │  │ 📝 327 │ │ ✅ 278 │ │ ⏱ 32h  │ │ 🎯 85% │ │ 📈 +12% this│ │  │
│  │  │ Total  │ │ Domin. │ │ Estud. │ │ Acur.  │ │    month   │ │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─── TEMPO ESTUDADO POR DISCIPLINA (gráfico de barras) ────────┐  │
│  │  Dir. Constitucional  ████████████████████ 12h                  │  │
│  │  Matemática           ████████████████ 9h                       │  │
│  │  Biologia             ████████ 5h                                │  │
│  │  Português            ██████ 4h                                  │  │
│  │  História             ████ 2h                                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─── PERFORMANCE POR DISCIPLINA (tabela) ──────────────────────┐  │
│  │  Disciplina         │ Cards │ Accuracy │ Retention │ Trend     │  │
│  │  ─────────────────  │ ───── │ ──────── │ ───────── │ ───────   │  │
│  │  Dir. Constitucional│  120  │   85%    │    78%    │  ↑ +5%    │  │
│  │  Matemática         │   87  │   72%    │    65%    │  ↑ +3%    │  │
│  │  Biologia           │   45  │   90%    │    82%    │  → estável│  │
│  │  Português          │   43  │   68%    │    55%    │  ↓ -2%    │  │
│  │  História           │   32  │   75%    │    70%    │  ↑ +8%    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─── INSIGHTS PERSONALIZADOS ──────────────────────────────────┐  │
│  │  ⚠ FOCO RECOMENDADO                                           │  │
│  │  • Português tem retention 55% — revise tópicos de gramática   │  │
│  │  • 12 cards vencidos em Dir. Constitucional — priorize hoje    │  │
│  │                                                                  │  │
│  │  💪 PONTOS FORTES                                               │  │
│  │  • Biologia: 90% accuracy, excelente retenção                  │  │
│  │  • História: +8% de melhoria este mês                          │  │
│  │                                                                  │  │
│  │  📈 PREVISÃO                                                    │  │
│  │  • No ritmo atual, você completará Dir. Const. em ~25 dias     │  │
│  │  • Aderência ao plano: 85% — acima da meta de 80%              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─── CURVA DE RETENÇÃO (FSRS) ─────────────────────────────────┐  │
│  │  [Canvas-drawn forgetting curve per discipline]                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─── CALIBRAÇÃO JOL ───────────────────────────────────────────┐  │
│  │  [Metacognitive accuracy chart: confidence vs actual accuracy]   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Lista de Ferramentas UI para Melhoria

### 4.1 Componentes de Interface — Biblioteca Modular

| # | Componente | Descrição | Prioridade | Páginas |
|---|---|---|---|---|
| C1 | **DisciplineCard** | Card rico: ícone, título, progresso, nível, contagem, estimativa | P0 | Dashboard, Disciplinas |
| C2 | **ModuleAccordion** | Acordeão expansível com tópicos, progresso, lock/unlock | P0 | Discipline Detail |
| C3 | **TopicRow** | Linha de tópico com barra de progresso, dificuldade, status | P0 | Module Detail |
| C4 | **BreadcrumbNav** | Navegação hierárquica: Dashboard > Disc > Mod > Tópico | P0 | Todas full-tab |
| C5 | **SearchBar** | Busca global com autocomplete, filtros inline, histórico | P0 | Dashboard, Study |
| C6 | **FilterPanel** | Filtros combinados: nível, tipo, tags, dificuldade, ano, status | P0 | Navegação conteúdo |
| C7 | **ProgressRing** | Anel circular animado com % central | P1 | Dashboard, Cards |
| C8 | **StatsWidget** | Widget de estatística com ícone, número, label, trend arrow | P1 | Dashboard |
| C9 | **HeatmapCalendar** | Calendário com intensidade de atividade, tooltip | P1 | Dashboard, Performance |
| C10 | **BarChart** | Gráfico de barras horizontal para tempo/disciplina | P1 | Performance |
| C11 | **RetentionCurve** | Curva de esquecimento FSRS interativa | P1 | Performance |
| C12 | **WeeklyPlanner** | Calendário semanal com slots, drag tasks, checklist | P1 | Planner |
| C13 | **LearningPathTimeline** | Timeline vertical de steps com checkpoints | P1 | Paths |
| C14 | **BadgeGrid** | Grid de badges earned/locked com progress | P2 | Conquistas |
| C15 | **NoteEditor** | Editor de notas inline com rich text básico | P2 | Study, Tópico |
| C16 | **InsightCard** | Card de insight com ícone, tipo (warning/success/info), texto | P2 | Dashboard, Performance |
| C17 | **ToastNotification** | Notificação toast com tipos (success, warning, info) | P2 | Global |
| C18 | **Sidebar** | Menu lateral colapsável com ícones e labels | P0 | Dashboard |
| C19 | **TabBar** | Barra de tabs com badge de contagem | P0 | Múltiplas |
| C20 | **EmptyState** | Tela vazia com ilustração, título, CTA | P1 | Todas |

### 4.2 Ferramentas de Engajamento e Aprendizado

| # | Ferramenta | Descrição | Integração | Prioridade |
|---|---|---|---|---|
| T1 | **Checklist de Estudo Semanal** | Tasks por dia com categorias (revisar, novos, simulado) | StudyPlanService | P1 |
| T2 | **Quiz Interativo Sincronizado** | Quiz mode com timer, scoring, feedback instantâneo | Study page + FSRS | P0 (existente, evoluir) |
| T3 | **Flashcards Auto-gerados** | AI gera front/back de qualquer questão/texto | FlashcardGeneratorService + ApiService | P1 |
| T4 | **Resumos baseados em IA** | AI gera summary de um tópico/módulo | PedagogicalPromptsService (novo prompt) | P1 |
| T5 | **Calendário de Estudos** | Vis. semanal/mensal com metas e tracking | StudyPlanService + Planner page | P1 |
| T6 | **Anotações Vinculadas** | Notas ligadas a card/tópico/módulo com export | NotesService | P2 |
| T7 | **Recomendações Automáticas** | "Foque em X" baseado em performance e SRS data | RecommendationService | P1 |
| T8 | **Sistema de Badges Expandido** | 30+ badges por milestones, streaks, mastery | BadgeService | P2 |
| T9 | **Notificações/Lembretes** | Chrome notifications para reviews, metas, streaks | chrome.alarms + chrome.notifications | P2 |
| T10 | **Export PDF de Performance** | Relatório visual com gráficos para impressão | ExportService | P3 |
| T11 | **Simulado Avançado** | Multi-disciplina, timer, scoring, histórico | Study page (evoluir) | P1 |
| T12 | **Pomodoro Integrado** | Timer com tracking de sessions por disciplina | Study page (existente, melhorar) | P2 |
| T13 | **Mind Map Visual** | Mapa de conceitos interativo por disciplina | Study page (existente, melhorar) | P3 |
| T14 | **Dark Mode Global** | Tema escuro em todas as páginas | CSS variables global | P1 |

---

## 5. Roadmap de Implementação

### 5.1 Visão Geral das Fases

```
FASE 0: Fundação (2-3 semanas)
├── Migração de dados
├── Modelo hierárquico
└── Componentes base

FASE 1: Organização (3-4 semanas)
├── Hierarquia Disc → Mod → Topic → Card
├── Dashboard expandido
├── Navegação com breadcrumb + filtros
└── Search interna

FASE 2: Engajamento (3-4 semanas)
├── Learning Paths
├── Checklist & Planner
├── Flashcards auto-gerados
├── Recomendações
└── Badges expandidos

FASE 3: Analytics (2-3 semanas)
├── Performance dashboard
├── Insights AI
├── Métricas expandidas
└── Export PDF

FASE 4: Polish (2-3 semanas)
├── Dark mode global
├── i18n completo
├── Onboarding de estudo
├── Notificações
└── Refinamento UX
```

### 5.2 Detalhamento por Fase

#### FASE 0: Fundação (Sem breaking changes)

| Task | Descrição | Critério de Aceitação | Est. |
|---|---|---|---|
| F0.1 | **MigrationService.js** | Converte binderStructure v1 → v2 (hierárquico) sem perda de dados. Rollback automático se falhar. | 3d |
| F0.2 | **ContentHierarchyService.js** | CRUD para Discipline, Module, Topic, Card com validação e constraint checking | 3d |
| F0.3 | **SearchIndexService.js** | Índice in-memory de cards com busca fuzzy por texto, tags, metadados | 2d |
| F0.4 | **ComponentLibrary.js** | DisciplineCard, ProgressRing, StatsWidget, BreadcrumbNav, FilterPanel, Sidebar básicos | 3d |
| F0.5 | **CSS Architecture refactor** | Extrair design tokens do popup.css monolítico para shared variables file. Criar base.css + tokens.css + animations.css | 2d |
| F0.6 | **Testes de migração** | Validar migração com diferentes dados (vazio, 10 itens, 500+ itens, dados corrompidos) | 1d |

**Milestone**: Dados migrados, novos serviços operacionais, componentes básicos prontos. Zero impacto visual.

#### FASE 1: Organização & Dashboard

| Task | Descrição | Critério de Aceitação | Est. |
|---|---|---|---|
| F1.1 | **Dashboard v2 — Overview** | Widgets: greeting, XP/level, streak, cards due today, quick stats (total, accuracy, time), discipline grid | 4d |
| F1.2 | **Dashboard v2 — Sidebar navigation** | Menu lateral com Overview, Disciplinas, Trilhas, Planner, Performance, Conquistas, Settings | 2d |
| F1.3 | **Discipline Detail page** | Header com progresso, módulos accordion, tópicos com barras, insights, botões estudar/simulado | 3d |
| F1.4 | **Módulo e Tópico management** | UI para criar/editar/reordenar módulos e tópicos. Auto-organize questões existentes por similarity. | 3d |
| F1.5 | **BreadcrumbNav + navigation** | Breadcrumb funcional em todas as páginas full-tab. Deep linking por query params. | 1d |
| F1.6 | **Search bar global** | Busca fuzzy com autocomplete de tags, disciplinas, questões. Resultado com preview inline. | 2d |
| F1.7 | **Filtros avançados** | Panel com filtros: nível, dificuldade, tipo, tags, ano, status SRS. Combinação AND/OR. Persistência. | 2d |
| F1.8 | **i18n no Dashboard e Study** | Extrair todos os textos hardcoded do dashboard.html/js e study.html/js para translations. | 2d |

**Milestone**: Dashboard é hub central. Navegação hierárquica completa. Busca e filtros funcionais.

#### FASE 2: Engajamento & Learning tools

| Task | Descrição | Critério de Aceitação | Est. |
|---|---|---|---|
| F2.1 | **LearningPathService.js + UI** | Criar, editar, seguir trilhas. Timeline visual com steps e checkpoints. Progresso automático. | 4d |
| F2.2 | **StudyPlanService.js + Planner UI** | Calendário semanal, metas diárias por disciplina, checklist de tasks, tracking de aderência. | 4d |
| F2.3 | **FlashcardGeneratorService.js** | AI gera flashcards de questões, textos, resumos. Preview e edição antes de salvar. | 2d |
| F2.4 | **RecommendationService.js** | Analisa FSRS data, accuracy, timing para recomendar: próximo tópico, revisões urgentes, pontos fracos. | 3d |
| F2.5 | **BadgeService.js + Badge UI** | 30+ badges em 4 categorias. Grid de conquistas com progresso. Toast notification ao ganhar. | 2d |
| F2.6 | **NotesService.js + Notes UI** | Anotações inline em cards, tópicos, módulos. Editor rich text básico. Export. | 2d |
| F2.7 | **Simulado Avançado** | Multi-disciplina, configuração de timer/quantidade, histórico de simulados, comparação. | 2d |
| F2.8 | **AI Summary por tópico** | Novo prompt em PedagogicalPromptsService: gera resumo de todas as questões de um tópico. | 1d |

**Milestone**: Trilhas de aprendizado funcionais. Planejamento semanal. Flashcards auto. Recomendações ativas.

#### FASE 3: Analytics & Insights

| Task | Descrição | Critério de Aceitação | Est. |
|---|---|---|---|
| F3.1 | **AnalyticsService.js** | Coleta: tempo por sessão, cards/dia, accuracy trend, discipline breakdown. Persiste em storage. | 3d |
| F3.2 | **Performance Dashboard** | Charts: tempo por disciplina, accuracy trend (7d/30d), retention heatmap, completion rates. | 3d |
| F3.3 | **AI Insights** | Analisa analytics data e gera insights: pontos fracos, previsão de conclusão, recomendações de foco. | 2d |
| F3.4 | **JOL Calibration expandido** | Gráfico de calibração metacognitiva por disciplina (confidence vs actual). | 1d |
| F3.5 | **ExportService.js** | Gera relatório PDF/HTML com gráficos, métricas, insights para print/share. | 2d |
| F3.6 | **Session tracking** | Marca início/fim de sessões de estudo. Calcula tempo ativo vs ocioso. | 1d |

**Milestone**: Analytics profissionais. Insights automatizados. Relatórios exportáveis.

#### FASE 4: Polish & UX Refinement

| Task | Descrição | Critério de Aceitação | Est. |
|---|---|---|---|
| F4.1 | **Dark mode global** | Toggle afeta popup, dashboard, study, todas as páginas. Respeita prefers-color-scheme do OS. | 2d |
| F4.2 | **i18n 100% coverage** | TODA string visível ao usuário passa por I18nService. Study page e dashboard inclusos. | 3d |
| F4.3 | **Onboarding de estudo** | Tour interativo após setup: demonstra binder, study, dashboard, FSRS, paths, planner. | 2d |
| F4.4 | **Chrome notifications** | Lembretes de review, streak at risk, metas do dia, celebração de milestone. | 2d |
| F4.5 | **Micro-interactions** | Animações: card flip, progress fill, badge unlock, streak fire, level up. Spring-based. | 2d |
| F4.6 | **Empty states** | Telas vazias com ilustração e CTA para cada seção (disciplines, paths, planner, badges). | 1d |
| F4.7 | **Accessibility audit** | Contrast ratios, focus states, keyboard nav, aria labels, screen reader testing. | 2d |
| F4.8 | **Performance optimization** | Lazy loading de componentes, virtual scrolling para 500+ cards, debounced search. | 2d |

**Milestone**: Experiência polida, acessível, performática. Feature-complete.

### 5.3 Timeline Visual

```
           Mês 1              Mês 2              Mês 3              Mês 4
    ┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
    │    FASE 0        │    FASE 1        │    FASE 2        │  FASE 3  │FASE 4│
    │   Fundação       │   Organização    │  Engajamento     │ Analytics│Polish│
    │   (2-3 sem)      │   (3-4 sem)      │  (3-4 sem)       │ (2-3 sem)│(2-3) │
    ├──────────────────┼──────────────────┼──────────────────┼──────────┼──────┤
    │ MigrationSvc     │ Dashboard v2     │ Learning Paths   │AnalySvc  │Dark  │
    │ HierarchySvc     │ Disc Detail      │ Study Planner    │PerfDash  │i18n  │
    │ SearchIndexSvc   │ Sidebar Nav      │ Flashcard Gen    │AIInsights│Onbrd │
    │ ComponentLib     │ Breadcrumb       │ Recommend Svc    │JOL expand│Notif │
    │ CSS Refactor     │ Search + Filter  │ Badges           │Export PDF│Anims │
    │ Migration Tests  │ i18n partial     │ Notes System     │Sessions  │A11y  │
    │                  │                  │ Simulado Adv     │          │Perf  │
    │                  │                  │ AI Summaries     │          │      │
    └──────────────────┴──────────────────┴──────────────────┴──────────┴──────┘
         ✓ Fundação       ✓ Navegação       ✓ Engajamento     ✓ Completo
         pronta            funcional          ativo
```

---

## 6. Métricas e Tracking

### 6.1 Framework de Métricas

#### Nível 1 — Métricas por Sessão (Micro)

| Métrica | Descrição | Storage | Tracking |
|---|---|---|---|
| `session_start` | Timestamp de início | `ah_analytics.sessions[]` | Automático ao abrir study page |
| `session_end` | Timestamp de fim | `ah_analytics.sessions[]` | Automático ao fechar/inatividade |
| `session_duration_active` | Tempo ativo (exclui idle >5min) | `ah_analytics.sessions[]` | Timer com idle detection |
| `cards_reviewed` | Cards revisados na sessão | `ah_analytics.sessions[]` | Incremento por review |
| `cards_correct` | Cards corretos na sessão | `ah_analytics.sessions[]` | Incremento por correct |
| `disciplines_studied` | Disciplinas tocadas | `ah_analytics.sessions[]` | Set de discipline IDs |

#### Nível 2 — Métricas Diárias (Meso)

| Métrica | Descrição | Storage | Uso |
|---|---|---|---|
| `daily_cards_total` | Total de cards no dia | `ah_analytics.daily[date]` | Heatmap, streak |
| `daily_minutes` | Minutos estudados no dia | `ah_analytics.daily[date]` | Planner tracking |
| `daily_accuracy` | Accuracy do dia | `ah_analytics.daily[date]` | Trend chart |
| `daily_new_cards` | Novos cards aprendidos | `ah_analytics.daily[date]` | Learning rate |
| `streak_current` | Dias consecutivos | `ah_analytics.streak` | Gamificação |
| `streak_longest` | Maior streak | `ah_analytics.streak` | Badge trigger |

#### Nível 3 — Métricas por Disciplina (Macro)

| Métrica | Descrição | Cálculo | Uso |
|---|---|---|---|
| `completion_rate` | % de cards no estado "review" ou "mastered" | `(review + mastered) / total` | Progress bar |
| `accuracy_rate` | % de acertos geral | `correct / attempts` | Performance table |
| `retention_rate` | % de cards mantidos após 30 dias | FSRS stability analysis | Retention chart |
| `average_difficulty` | Dificuldade média dos cards | FSRS difficulty average | Insight |
| `time_invested` | Horas totais na disciplina | Sum of session times | Bar chart |
| `velocity` | Cards/dia nos últimos 7 dias | Rolling average | Previsão |
| `predicted_completion` | Dias estimados para concluir | `remaining / velocity` | Insight |
| `weak_topics` | Tópicos com accuracy < 60% | Topic-level accuracy | Recomendação |

#### Nível 4 — Métricas de Plataforma (Meta)

| Métrica | Descrição | Uso |
|---|---|---|
| `total_questions` | Total de questões na plataforma | Overview |
| `total_disciplines` | Disciplinas ativas | Overview |
| `total_study_hours` | Horas totais de estudo | Lifetime stat |
| `mastery_score` | Pontuação geral de domínio | Level/XP system |
| `plan_adherence` | Aderência ao plano de estudo (%) | Planner insight |
| `path_completion` | % de conclusão de learning paths | Path tracking |
| `jol_calibration` | Calibração metacognitiva | JOL chart |
| `badge_count` | Badges conquistados | Gamificação |

### 6.2 Estrutura de Armazenamento de Analytics

```javascript
// chrome.storage.local['ah_analytics']
const analyticsStore = {
  version: 2,
  
  // Sessions (rolling 90 days, auto-purge older)
  sessions: [
    {
      id: 'sess_uuid',
      startedAt: timestamp,
      endedAt: timestamp,
      durationActiveMs: 3600000,     // 1 hour active
      cardsReviewed: 45,
      cardsCorrect: 38,
      cardsNew: 10,
      disciplines: ['disc_uuid1'],
      mode: 'flashcard'              // flashcard | quiz | simulado
    }
  ],
  
  // Daily aggregates (rolling 365 days)
  daily: {
    '2026-03-01': {
      cards: 45,
      correct: 38,
      minutes: 60,
      newCards: 10,
      disciplines: ['disc_uuid1'],
      xpEarned: 150
    }
  },
  
  // Streak
  streak: {
    current: 12,
    longest: 34,
    lastActiveDate: '2026-03-01'
  },
  
  // Per-discipline performance cache (recalculated daily)
  disciplineStats: {
    'disc_uuid1': {
      totalCards: 120,
      mastered: 78,
      reviewing: 30,
      learning: 12,
      accuracy: 0.85,
      retention: 0.78,
      timeInvestedMs: 43200000,      // 12 hours
      velocity7d: 4.2,               // cards/day
      weakTopics: ['topic_uuid3'],
      lastUpdated: timestamp
    }
  },
  
  // Badges earned
  badges: {
    'badge_first_100': { earnedAt: timestamp },
    'badge_streak_7': { earnedAt: timestamp }
  },
  
  // XP and Level
  xp: {
    total: 2340,
    level: 5,
    levelName: 'Estudioso'
  }
};
```

### 6.3 Eventos de Tracking

| Evento | Trigger | Dados Coletados |
|---|---|---|
| `study_session_start` | Abrir study page | `timestamp, mode, discipline` |
| `study_session_end` | Fechar study page / idle timeout | `duration, cards, accuracy` |
| `card_review` | Avaliar um card (Again/Hard/Good/Easy) | `cardId, rating, responseTime, correct` |
| `card_created` | Salvar nova questão | `cardId, discipline, source` |
| `search_completed` | Pipeline de busca termina | `query, resultCount, sources` |
| `ai_tool_used` | Usar why-wrong, hint, step-by-step | `toolType, cardId, providerId` |
| `path_step_completed` | Completar step de learning path | `pathId, stepIndex` |
| `badge_earned` | Condição de badge atingida | `badgeId, condition` |
| `plan_day_completed` | Cumprir meta diária | `date, adherence%` |
| `simulado_completed` | Finalizar simulado | `score, discipline, time, count` |

---

## 7. Guia de Estilo Visual e Interação

### 7.1 Direção Estética

**Conceito**: "Academic Neo-Warmth" — Fusão entre o calor e ludicidade do design atual ("Playful/Toy-like") com a clareza e organização de plataformas profissionais como Khan Academy e Notion.

**Princípios**:
1. **Warmth with Structure** — Manter a personalidade colorida e calorosa, mas adicionar hierarquia visual clara
2. **Progressive Disclosure** — Informação revelada em camadas (overview → detail → deep-dive)
3. **Data-Informed Delight** — Cada animação e micro-interação está ligada a um dado real de progresso
4. **Consistent Modular** — Componentes reutilizáveis que mantêm identidade em diferentes contextos

### 7.2 Paleta de Cores (Evolução)

```css
:root {
  /* ===== BRAND COLORS (mantém identidade) ===== */
  --ah-coral:        #FF6B6B;    /* Primary action */
  --ah-coral-light:  #FF8787;
  --ah-coral-dark:   #E85D5D;
  
  --ah-blue:         #4DABF7;    /* Info, links */
  --ah-blue-light:   #74C0FC;
  --ah-blue-dark:    #339AF0;
  
  --ah-mint:         #40C057;    /* Success, correct */
  --ah-mint-light:   #69DB7C;
  --ah-mint-dark:    #2F9E44;
  
  --ah-lavender:     #DA77F2;    /* Creative, special */
  --ah-lavender-light: #E599F7;
  --ah-lavender-dark:  #BE4BDB;
  
  --ah-gold:         #FFD43B;    /* XP, achievements */
  --ah-gold-light:   #FFE066;
  --ah-gold-dark:    #FCC419;
  
  /* ===== NEW: SEMANTIC COLORS ===== */
  --ah-danger:       #FF6B6B;
  --ah-warning:      #FFA94D;
  --ah-success:      #40C057;
  --ah-info:         #4DABF7;
  
  /* ===== NEW: NEUTRAL SCALE ===== */
  --ah-gray-50:      #FAFAFA;
  --ah-gray-100:     #F5F5F5;
  --ah-gray-200:     #EEEEEE;
  --ah-gray-300:     #E0E0E0;
  --ah-gray-400:     #BDBDBD;
  --ah-gray-500:     #9E9E9E;
  --ah-gray-600:     #757575;
  --ah-gray-700:     #616161;
  --ah-gray-800:     #424242;
  --ah-gray-900:     #212121;
  
  /* ===== NEW: SURFACE COLORS ===== */
  --ah-surface:      #FFFFFF;
  --ah-surface-raised: #FFFFFF;
  --ah-surface-overlay: rgba(255,255,255,0.95);
  --ah-background:   #F8F9FA;
  --ah-border:       #E9ECEF;
  --ah-text-primary: #212529;
  --ah-text-secondary: #6C757D;
  --ah-text-muted:   #ADB5BD;
  
  /* ===== DARK MODE ===== */
  /* Applied via [data-theme="dark"] */
  --ah-surface-dark:      #1A1B1E;
  --ah-surface-raised-dark: #25262B;
  --ah-background-dark:   #141517;
  --ah-border-dark:       #373A40;
  --ah-text-primary-dark: #C1C2C5;
  --ah-text-secondary-dark: #909296;
}
```

### 7.3 Tipografia

```css
:root {
  /* ===== FONT FAMILIES ===== */
  /* Display/Heading: Baloo 2 (mantido — personalidade forte) */
  --ah-font-display:  'Baloo 2', cursive;
  
  /* Body: Lexend (mantido — excelente legibilidade) */
  --ah-font-body:     'Lexend', sans-serif;
  
  /* Mono: JetBrains Mono (para código, dados) */
  --ah-font-mono:     'JetBrains Mono', monospace;
  
  /* ===== TYPE SCALE (Major Third - 1.25) ===== */
  --ah-text-xs:     0.75rem;    /* 12px */
  --ah-text-sm:     0.875rem;   /* 14px */
  --ah-text-base:   1rem;       /* 16px */
  --ah-text-lg:     1.125rem;   /* 18px */
  --ah-text-xl:     1.25rem;    /* 20px */
  --ah-text-2xl:    1.5rem;     /* 24px */
  --ah-text-3xl:    1.875rem;   /* 30px */
  --ah-text-4xl:    2.25rem;    /* 36px */
  
  /* ===== FONT WEIGHTS ===== */
  --ah-weight-regular:  400;
  --ah-weight-medium:   500;
  --ah-weight-semibold: 600;
  --ah-weight-bold:     700;
  --ah-weight-extrabold:800;
  
  /* ===== LINE HEIGHTS ===== */
  --ah-leading-tight:   1.25;
  --ah-leading-normal:  1.5;
  --ah-leading-relaxed: 1.75;
}
```

### 7.4 Espaçamento

```css
:root {
  /* ===== SPACING SCALE (4px base) ===== */
  --ah-space-0:   0;
  --ah-space-1:   0.25rem;   /* 4px */
  --ah-space-2:   0.5rem;    /* 8px */
  --ah-space-3:   0.75rem;   /* 12px */
  --ah-space-4:   1rem;      /* 16px */
  --ah-space-5:   1.25rem;   /* 20px */
  --ah-space-6:   1.5rem;    /* 24px */
  --ah-space-8:   2rem;      /* 32px */
  --ah-space-10:  2.5rem;    /* 40px */
  --ah-space-12:  3rem;      /* 48px */
  --ah-space-16:  4rem;      /* 64px */
  
  /* ===== BORDER RADIUS ===== */
  --ah-radius-sm:   4px;
  --ah-radius-md:   8px;
  --ah-radius-lg:   12px;
  --ah-radius-xl:   16px;
  --ah-radius-2xl:  24px;
  --ah-radius-full: 9999px;
  
  /* ===== SHADOWS ===== */
  --ah-shadow-xs:   0 1px 2px rgba(0,0,0,0.05);
  --ah-shadow-sm:   0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
  --ah-shadow-md:   0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06);
  --ah-shadow-lg:   0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05);
  --ah-shadow-xl:   0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04);
  
  /* Elevation System */
  --ah-elevation-1: var(--ah-shadow-sm);    /* Cards de conteúdo */
  --ah-elevation-2: var(--ah-shadow-md);    /* Cards interativos (hover) */
  --ah-elevation-3: var(--ah-shadow-lg);    /* Popovers, dropdowns */
  --ah-elevation-4: var(--ah-shadow-xl);    /* Modais, dialogs */
}
```

### 7.5 Animações e Micro-interações

```css
:root {
  /* ===== TIMING FUNCTIONS ===== */
  --ah-ease-out:    cubic-bezier(0.16, 1, 0.3, 1);      /* Deceleration */
  --ah-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);     /* Balanced */
  --ah-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* Bouncy (mantido) */
  --ah-ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
  
  /* ===== DURATIONS ===== */
  --ah-duration-instant: 100ms;
  --ah-duration-fast:    150ms;
  --ah-duration-normal:  250ms;
  --ah-duration-slow:    400ms;
  --ah-duration-slower:  600ms;
}

/* ===== MICRO-INTERACTIONS ===== */

/* Card hover lift */
.ah-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--ah-elevation-2);
  transition: all var(--ah-duration-fast) var(--ah-ease-out);
}

/* Progress bar fill */
.ah-progress-fill {
  transition: width var(--ah-duration-slow) var(--ah-ease-out);
}

/* Badge unlock celebration */
@keyframes ah-badge-unlock {
  0% { transform: scale(0) rotate(-180deg); opacity: 0; }
  60% { transform: scale(1.2) rotate(10deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); }
}

/* Streak fire pulse */
@keyframes ah-streak-pulse {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.1); filter: brightness(1.2); }
}

/* Card flip (flashcard) */
@keyframes ah-card-flip {
  0% { transform: perspective(600px) rotateY(0deg); }
  100% { transform: perspective(600px) rotateY(180deg); }
}

/* Level up celebration */
@keyframes ah-level-up {
  0% { transform: scale(1); }
  25% { transform: scale(1.3); filter: brightness(1.5); }
  50% { transform: scale(0.9); }
  75% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

/* Staggered list entrance */
.ah-stagger-item {
  opacity: 0;
  transform: translateY(20px);
  animation: ah-fade-up var(--ah-duration-normal) var(--ah-ease-out) forwards;
}

.ah-stagger-item:nth-child(1) { animation-delay: 0ms; }
.ah-stagger-item:nth-child(2) { animation-delay: 50ms; }
.ah-stagger-item:nth-child(3) { animation-delay: 100ms; }
.ah-stagger-item:nth-child(4) { animation-delay: 150ms; }
.ah-stagger-item:nth-child(5) { animation-delay: 200ms; }

@keyframes ah-fade-up {
  to { opacity: 1; transform: translateY(0); }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 7.6 Componentes Visuais — Especificações

#### DisciplineCard

```
┌─────────────────────────────────┐
│  ⚖                              │  ← Ícone (Material Symbol, 32px)
│  Direito Constitucional         │  ← Título (Baloo 2, 18px, bold)
│  120 questões · Intermediário   │  ← Metadados (Lexend, 12px, gray-500)
│                                  │
│  ████████████████░░░░ 65%       │  ← ProgressBar (8px height, rounded)
│                                  │
│  🕐 ~3h restantes              │  ← Estimativa (Lexend, 12px)
│  [Estudar]  [Simulado]          │  ← CTAs (botões small, pill shape)
└─────────────────────────────────┘

Visual specs:
- Width: 280px (3-col grid) ou responsive
- Padding: var(--ah-space-5) (20px)
- Border-radius: var(--ah-radius-xl) (16px)
- Shadow: var(--ah-elevation-1) → var(--ah-elevation-2) on hover
- Border-left: 4px solid [discipline.color]
- Background: var(--ah-surface)
- Hover: translateY(-2px) + shadow lift
```

#### StatsWidget

```
┌──────────────┐
│  📝          │  ← Ícone (24px, muted)
│  327         │  ← Número (Baloo 2, 28px, bold)
│  Questões    │  ← Label (Lexend, 12px, gray-500)
│  ↑ +12%      │  ← Trend (12px, green/red)
└──────────────┘

Visual specs:
- Width: 25% of parent (4-col)
- Padding: var(--ah-space-4)
- Border-radius: var(--ah-radius-lg)
- Background: var(--ah-surface)
- Shadow: var(--ah-elevation-1)
- Trend arrow: green (↑), red (↓), gray (→)
```

#### InsightCard

```
┌─ ⚠ FOCO RECOMENDADO ─────────────────────────────────┐
│  Português tem retention 55% — revise tópicos de       │
│  gramática antes de avançar.                           │
│  [Ver disciplina →]                                     │
└────────────────────────────────────────────────────────┘

Visual specs:
- Border-left: 4px solid var(--ah-warning)
- Background: rgba(var(--ah-warning-rgb), 0.05)
- Padding: var(--ah-space-4)
- Border-radius: var(--ah-radius-md)
- Types: warning (orange), success (green), info (blue), danger (red)
```

### 7.7 Regras de Interação

| Interação | Comportamento | Feedback |
|---|---|---|
| **Hover em card** | translateY(-2px) + shadow elevation-2 | Visual lift |
| **Click em card** | Scale(0.98) momentâneo → navegação | Tactile feel |
| **Toggle de filtro** | Slide-in com stagger | Filtros aparecem um a um |
| **Progress update** | Width transition 400ms ease-out | Barra preenche suavemente |
| **Badge unlock** | Scale + rotate animation + confetti particles | Celebration moment |
| **Level up** | Pulsating scale + brightness flash | Achievement moment |
| **Save to binder** | Heart/star fill animation + toast | Confirmation |
| **Delete** | Slide-out left + fade | Remoção suave |
| **Drag & drop** | Ghost element follows cursor, drop zone highlights | Spatial feedback |
| **Error state** | Shake animation (3 cycles) + red border | Attention |
| **Loading** | Skeleton screens (gradient shimmer) | Perceived performance |
| **Search results** | Staggered fade-up, highlight matching text | Discovery |
| **Tab switch** | Underline slide transition | Context awareness |
| **Breadcrumb navigation** | Slide right/left depending on direction | Spatial orientation |

### 7.8 Layout Grid System

```css
/* ===== DASHBOARD GRID ===== */
.ah-dashboard-grid {
  display: grid;
  grid-template-columns: 240px 1fr;        /* Sidebar + Content */
  grid-template-rows: 64px 1fr;            /* Header + Body */
  height: 100vh;
  gap: 0;
}

/* ===== CONTENT GRID (inside main area) ===== */
.ah-content-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--ah-space-6);
  padding: var(--ah-space-6);
}

/* ===== STATS ROW ===== */
.ah-stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--ah-space-4);
}

/* ===== RESPONSIVE BREAKPOINTS ===== */
/* Popup context: max-width 460px (existing) */
/* Full-tab context: */
@media (max-width: 768px) {
  .ah-dashboard-grid {
    grid-template-columns: 1fr;  /* No sidebar, use bottom nav */
  }
  .ah-stats-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .ah-content-grid {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .ah-dashboard-grid {
    grid-template-columns: 60px 1fr;  /* Collapsed sidebar */
  }
}

@media (min-width: 1200px) {
  .ah-content-grid {
    grid-template-columns: repeat(3, 1fr);  /* 3-column cards */
  }
}
```

### 7.9 Iconografia

```
Fonte: Google Material Symbols Rounded (já em uso)
Weight: 400 (regular), 500 (emphasis)
Optical size: 24dp (default), 20dp (small contexts), 48dp (feature icons)
Fill: 0 (outline default), 1 (active/selected state)

Mapeamento de ícones por feature:
─────────────────────────────────
📊 Overview      → dashboard
📚 Disciplinas   → menu_book
🛤 Trilhas       → route
📅 Planner       → calendar_month
📈 Performance   → trending_up
🏆 Conquistas    → emoji_events
⚙ Settings      → settings
🔍 Buscar        → search
🌙 Dark Mode     → dark_mode / light_mode
👤 Perfil        → account_circle
➕ Adicionar     → add_circle
📝 Estudar       → school
🎯 Simulado      → target
✏️ Editar        → edit
🗑 Excluir       → delete
📌 Anotar        → note_add
🔥 Streak        → local_fire_department
⭐ XP            → star
🔒 Bloqueado     → lock
✅ Concluído     → check_circle
⚠ Alerta        → warning
```

---

## Apêndice A: Definição de Badges

| Badge | Nome | Condição | Categoria |
|---|---|---|---|
| 🌱 | Primeiro Passo | Complete 1 questão | milestone |
| 📝 | Dezena | Complete 10 questões | milestone |
| 💯 | Centenário | Complete 100 questões | milestone |
| 🏆 | Mil e Uma | Complete 1000 questões | milestone |
| 🔥 | 3 Dias | Streak de 3 dias | streak |
| 🔥🔥 | Semana de Fogo | Streak de 7 dias | streak |
| 🔥🔥🔥 | Mês Incandescente | Streak de 30 dias | streak |
| ⭐ | Mestre | Domine 1 disciplina (90%+) | mastery |
| 🎓 | Formado | Domine 5 disciplinas | mastery |
| 🧠 | Retenção de Ferro | Retention rate > 90% em qualquer disciplina | mastery |
| 🎯 | Precisão Cirúrgica | 100% accuracy em um simulado (20+ questões) | special |
| ⚡ | Velocista | Complete 50 cards em uma sessão | special |
| 🌅 | Madrugador | Estude antes das 7h | special |
| 🦉 | Coruja | Estude depois das 23h | special |
| 📚 | Bibliotecário | Salve 500+ questões no binder | milestone |
| 🗺 | Explorador | Estude 10 disciplinas diferentes | special |
| 📊 | Analista | Consulte o dashboard 30 vezes | special |
| 🛤 | Trilheiro | Complete 1 learning path | special |
| ✍️ | Anotador | Crie 50 notas | special |
| 🃏 | Flashcard Master | Crie 100 flashcards | special |
| 📅 | Planejador | Mantenha 80%+ de aderência ao plano por 4 semanas | special |
| 🤖 | AI Explorer | Use todas as 5 ferramentas AI pedagógicas | special |

---

## Apêndice B: XP System (Expandido)

| Nível | Nome | XP Necessário | XP por Card | XP por Simulado | XP por Streak Day |
|---|---|---|---|---|---|
| 1 | Iniciante | 0 | 5 | 50 | 10 |
| 2 | Aprendiz | 200 | 5 | 50 | 10 |
| 3 | Estudante | 500 | 5 | 50 | 10 |
| 4 | Dedicado | 1.000 | 7 | 70 | 15 |
| 5 | Estudioso | 2.000 | 7 | 70 | 15 |
| 6 | Avançado | 4.000 | 10 | 100 | 20 |
| 7 | Expert | 8.000 | 10 | 100 | 20 |
| 8 | Mestre | 15.000 | 15 | 150 | 30 |
| 9 | Lendário | 30.000 | 15 | 150 | 30 |

**Bonus XP**:
- First card of the day: +20 XP
- Perfect streak (all correct in session): +30 XP
- Badge earned: +100 XP
- Path checkpoint completed: +200 XP
- Discipline mastered: +500 XP

---

## Apêndice C: Migração de Dados v1 → v2

### Estratégia de Migração

```javascript
/**
 * MigrationService.js — Migração não-destrutiva v1 → v2
 * 
 * PRINCÍPIOS:
 * 1. NEVER delete v1 data before v2 is confirmed working
 * 2. Backup v1 to 'ah_backup_v1' before any migration
 * 3. Rollback automático se migração falhar
 * 4. Migração é idempotente (pode rodar múltiplas vezes)
 */

// Step 1: Backup
// chrome.storage.local['ah_backup_v1'] = deepClone(binderStructure)

// Step 2: Para cada pasta raiz do binder → criar Discipline
// binderStructure[0].children.filter(c => c.type === 'folder') → disciplines[]

// Step 3: Para cada questão dentro de pasta → criar Card v2
// Preservar todos os campos sm2/fsrs
// Adicionar novos campos com defaults: difficulty=3, tags=[], type='multiple_choice'

// Step 4: Auto-organizar em módulos (optional, AI-assisted)
// Agrupar questões por similaridade textual em tópicos
// Criar módulos default ("Geral") para questões sem grupo claro

// Step 5: Migrar ah_disciplines para novo formato
// Merge com pastas do binder (dedup por nome, como já feito no DisciplinasController)

// Step 6: Validar integridade
// Contar total de questões v1 vs v2 — deve ser igual
// Verificar que FSRS data está intacta

// Step 7: Set version flag
// chrome.storage.local['ah_data_version'] = 2
```

---

## Conclusão

A AnswerHunter já possui um **motor de IA e estudo (FSRS-5 + Pedagogical AI) de nível profissional** — superior a muitas extensões e aplicativos de estudo. O gap está na **camada de organização, navegação e experiência de plataforma**.

A evolução proposta transforma a extensão de um **utilitário de busca de respostas** em uma **plataforma de estudo completa**, mantendo o diferencial competitivo (extração AI + busca multicritério + FSRS-5) e adicionando as camadas de:

1. **Hierarquia profissional** de conteúdo (Disciplina → Módulo → Tópico → Card)
2. **Dashboard como hub central** com visão unificada de progresso
3. **Learning paths** com checkpoints e progressão guiada
4. **Planejamento temporal** com calendário e metas
5. **Analytics profissionais** com insights AI automatizados
6. **Gamificação expandida** com badges, celebrations e metas
7. **Busca e filtros avançados** para navegação eficiente em escala

O roadmap de **~4 meses** é conservador e progressivo — cada fase entrega valor incremental sem breaking changes.
