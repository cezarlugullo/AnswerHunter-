# AnswerHunter — Proposta de Reestruturação UX

> **Data:** 2026-02-11
> **Versão:** 1.1
> **Superfície:** Chrome Popup (~360x600px)
> **Regra:** Sem scrollbar NAS TELAS DE SETUP. Scrollbar OK na tela principal pós-setup.
> **Ícones:** Material Symbols Rounded (notação `[icon_name]` nos wireframes)

---

## Premissas Confirmadas

| Pergunta | Resposta |
|----------|----------|
| Tamanho | Mesmo viewport do onboarding atual (~360x600 popup) |
| Scroll nas telas de setup | Proibido |
| Scroll na tela principal | Permitido |
| Settings pós-setup | Reabre wizard, persiste chaves, permite alterá-las |
| Bandeiras de idioma | Em TODAS as telas (inclusive onboarding) |
| Botões Search/Extract | Ambos permanecem |

---

## BLOQUEIOS (NÃO MEXER)

- Tela de boas-vindas com foguete (slide 0) — estrutura, posição e comportamento intactos
- Barra de progresso no topo (`ob-progress-track`)
- Bolinhas indicadoras de passo (`ob-step-dots`)

---

# ENTREGÁVEL 1: Arquitetura de Informação

## Mapa de Telas/Estados

```
+-----------------------------------------------------+
|                   ESTADOS DA EXTENSÃO                |
+-----------------------------------------------------+
|                                                      |
|  +----------+   +----------+   +----------+          |
|  | SLIDE 0  |-->| SLIDE 1  |-->| SLIDE 2  |--+      |
|  | Welcome  |   |  Groq    |   |  Serper  |  |      |
|  |(BLOQUEADO |   |  Setup   |   |  Setup   |  |      |
|  | foguete) |   |          |   |          |  |      |
|  +----------+   +----------+   +----------+  |      |
|                                               v      |
|                                          +----------+|
|                                          | SLIDE 3  ||
|                                          | Gemini   ||
|                                          | (Opcion.)||
|                                          +----+-----+|
|                                               |      |
|                          +--------------------+      |
|                          v                           |
|  +----------------------------------------------+   |
|  |           TELA PRINCIPAL (scroll OK)          |   |
|  |  +-----------+  +-------------------+         |   |
|  |  | Tab Search |  |  Tab Binder      |         |   |
|  |  | +--------+ |  | +-------------+  |         |   |
|  |  | | Estado | |  | | Estado vazio |  |         |   |
|  |  | | vazio  | |  | | c/ CTA      |  |         |   |
|  |  | +--------+ |  | +-------------+  |         |   |
|  |  | | Loading| |  | | Com itens   |  |         |   |
|  |  | +--------+ |  | +-------------+  |         |   |
|  |  | |Resulta-| |  +-------------------+         |   |
|  |  | | dos    | |                                |   |
|  |  | +--------+ |  +-------------------+         |   |
|  |  | | Erro   | |  | [settings] Panel  |         |   |
|  |  | +--------+ |  | (reabre wizard    |         |   |
|  |  +-----------+  | c/ chaves preench.)|         |   |
|  |                  +-------------------+         |   |
|  +----------------------------------------------+   |
+-----------------------------------------------------+
```

## Prioridade de Conteúdo (acima da dobra)

### Telas de Setup (sem scroll — TUDO acima da dobra)

| Prioridade | Bloco | Ícone | Justificativa |
|:---:|---|---|---|
| LOCK | Barra de progresso | — | BLOQUEADO — orientação visual do progresso |
| LOCK | Dots indicadores | — | BLOQUEADO — mostra posição no fluxo |
| NEW | Bandeiras de idioma | SVG flags | Acessibilidade imediata — leigo pode não entender EN |
| 1 | Número + título do passo | `[looks_one]` / `[looks_two]` / `[looks_3]` | Situa o usuário: "onde estou?" |
| 2 | Descrição curta (1 linha) | — | "Por que preciso disso?" |
| 3 | Sub-passos numerados (1-2-3) | `[counter_1]` `[counter_2]` `[counter_3]` | "Como eu faço?" — guia sequencial |
| 4 | Campo de input da chave | `[vpn_key]` | Ação principal da tela |
| 5 | Botões de ação (abrir site + validar) | `[open_in_new]` + `[wifi_tethering]` | Ações secundárias que suportam a principal |
| 6 | Feedback de status | `[check_circle]` / `[error]` | Confirma sucesso ou explica erro |
| 7 | Navegação (voltar/próximo) | `[arrow_back]` / `[arrow_forward]` | Progressão entre passos |

### Tela Principal (scroll OK)

| Prioridade | Bloco | Ícone | Justificativa |
|:---:|---|---|---|
| 1 | Header (marca + bandeiras + settings) | `[track_changes]` + `[settings]` | Identidade + acesso rápido |
| 2 | Tabs (Search / Binder) | `[search]` + `[folder]` | Navegação primária — sempre visível |
| 3 | Botões de ação (Search + Extract) | `[travel_explore]` + `[description]` | CTAs principais — acima da dobra sempre |
| 4 | Status bar | `[sync]` / `[check_circle]` | Feedback do que está acontecendo |
| 5 | Área de resultados | vários | Pode rolar — conteúdo dinâmico |
| 6 | Footer | `[smart_toy]` | Info decorativa — pode ficar abaixo |

## Componentes Removidos/Alterados

| Componente Atual | Ação | Motivo | Substituto |
|---|---|---|---|
| `ob-begin-hint` ("Comece pelo botão 1...") | **REMOVER** | Redundante com os sub-passos 1-2-3 do tutorial | Os próprios sub-passos já guiam sequencialmente |
| `ob-next-help` ("Quando a validação...") | **REMOVER** | O botão Next desabilitado + pulso visual já comunica isso | Botão Next com estado visual (disabled -> pulse when ready) |
| `ob-privacy-bar` (footer fixo) | **MOVER** para ícone-tooltip no slide 1 | Ocupa ~30px fixos, não é crítico em TODOS os slides | Ícone `[shield]` no header do slide 1 com tooltip ao hover |
| `ob-info-banner` (slide Gemini) | **COMPACTAR** | Pode virar uma linha inline sob o título | Badge "Opcional" já existe + hint de 1 linha |
| Tutorial card accordion | **MUDAR** para lista fixa compacta | Accordion começa expandido = ocupa mesmo espaço. Versão compacta sempre visível é mais previsível | Lista numerada inline sem collapse |
| Language toggle (main app header) | **ADICIONAR** ao onboarding | Usuário leigo BR pode travar em tela EN | Bandeiras discretas no canto superior direito de TODAS as telas |
| `EN`/`PT` text labels nos botões | **REMOVER** | Pedido explícito: apenas bandeiras, sem texto | Apenas SVG flags com borda/realce no ativo |

## Componentes Adicionados

| Componente Novo | Ícone | Onde | Propósito |
|---|---|---|---|
| **Bandeiras de idioma** | SVG (US + BR flags) | Canto superior direito de TODAS as telas (setup + main) | Trocar idioma a qualquer momento |
| **Key status chips** (ao reabrir settings) | `[check_circle]` ou `[warning]` | Slides 1-3 quando reabertos | Mostra "Configurada" ou "Não configurada" |
| **Botão "Alterar chave"** | `[edit]` | Slides 1-3 quando key já existe | Permite trocar sem perder a key atual |
| **Tooltip de privacidade** | `[shield]` | Slide 1, ícone no canto | Substitui a barra fixa de privacidade |
| **Botão "Fechar configurações"** | `[close]` | Footer dos slides ao reabrir settings | Volta à tela principal |
| **CTA no Binder vazio** | `[search]` | Tab Binder quando vazio | Botão "Ir para Buscar" para guiar o leigo |

---

# ENTREGÁVEL 2: Wireframes ASCII

## Orçamento de Altura (Budget)

Viewport: **600px disponíveis**

### A) Primeira Vez — Setup (SLIDE 0: Welcome)

> **BLOQUEADO** — estrutura mantida. Único acréscimo: bandeiras de idioma.

```
+----------------------------------------- 360px ----+
| [progress_bar]  10%                      | Bar    |  ~6px   LOCK
|         (o) ( ) ( ) ( )                  | Dots   |  ~20px  LOCK
|                            [flag][flag]  | Flags  |  ~24px  NEW
|                                          |        |
|              .-------.                   |        |
|             / [search]  \                |        |
|            | [rocket_launch] |           | Hero   | ~120px LOCK
|             \ [psychology] /             | Illust |
|              '-------'                   |        |
|                                          |        |
|       Welcome to AnswerHunter            | Title  |  ~28px  LOCK
|      Vamos te guiar passo a passo.       | Sub    |  ~36px  LOCK
|      Voce so precisa copiar e colar      |        |
|      suas chaves.                        |        |
|                                          |        |
| [bolt]Simples [lock]Privado [money_off]  | Pills  |  ~36px  LOCK
|  Gratis                                  |        |
|                                          |        |
|      +---------------------------+       |        |
|      | [arrow_forward] Iniciar   |       | CTA    |  ~48px  LOCK
|      |            guia           |       |        |
|      +---------------------------+       |        |
|                                          |        |
|      [schedule] Leva ~2 minutos          | Hint   |  ~20px  LOCK
|                                          |        |
+-----------------------------------------+
                                    TOTAL = ~338px  SEM SCROLL
                                    Sobra = ~262px de respiro
```

### A) Primeira Vez — Setup (SLIDES 1-2: Groq / Serper)

> Mesma estrutura para slides 1 e 2. Troca: cor, nome do servico, URL.

```
+----------------------------------------- 360px ----+
| [progress_bar]  35%  /  65%              | Bar    |  ~6px   LOCK
|         (o)(o)( )( ) / (o)(o)(o)( )      | Dots   |  ~20px  LOCK
|                            [flag][flag]  | Flags  |  ~24px  NEW
|                                          |        |
| +--+  Passo 1/3  +----------+           |        |
| |1 |  Obrigatorio            |           | Header |  ~44px
| +--+              +----------+           |        |
| Configurar chave Groq                    | Title  |  ~24px
| Groq ajuda a entender cada questao.      | Desc   |  ~18px
|                                          |        |
| (1)  Clique "Abrir site" e crie         |        |
|      sua conta gratis na Groq.           | Guia   |
| (2)  Abra "API Keys" e crie uma         | 3-step |  ~72px
|      nova chave.                         |        |
| (3)  Copie a chave, cole abaixo         |        |
|      e clique "Validar chave".           |        |
|                                          |        |
| [vpn_key] API Key                        |        |
| +----------------------------+--+        | Input  |  ~44px
| | gsk_...                    |EE|        |        |
| +----------------------------+--+        |        |
|    EE = [visibility] toggle              |        |
| [info] Comeca com "gsk_"                 | Hint   |  ~16px
|                                          |        |
| +---------------+ +----------------+    | Actions|  ~40px
| |[open_in_new]  | |[wifi_tethering]|    |        |
| | 1.Abrir site  | | 2.Validar     |    |        |
| |         FREE  | |    chave      |    |        |
| +---------------+ +----------------+    |        |
|                                          |        |
| [status feedback area]                   | Status |  ~24px
|                                          |        |
| +----+                     +---------+   | Nav    |  ~44px
| |[arrow_back]|             |Proximo  |   | Footer |
| +----+                     |[arrow_forward]|      |
|                            +---------+   |        |
+-----------------------------------------+
                                    TOTAL = ~376px  SEM SCROLL
                                    Sobra = ~224px
```

### A) Primeira Vez — Setup (SLIDE 3: Gemini — Opcional)

```
+----------------------------------------- 360px ----+
| [progress_bar]  100%                     | Bar    |  ~6px   LOCK
|         (o)(o)(o)(o)                     | Dots   |  ~20px  LOCK
|                            [flag][flag]  | Flags  |  ~24px  NEW
|                                          |        |
| +--+  Passo 3/3  +----------+           |        |
| |3 |  Opcional                |           | Header |  ~44px
| +--+              +----------+           |        |
| Opcional: backup Gemini                  | Title  |  ~24px
| So entra quando Groq estiver            | Desc   |  ~18px
| indisponivel.                            |        |
|                                          |        |
| [lightbulb] Pode pular ou config agora. | Banner |  ~24px
|                                          |        |
| (1)  Clique "Abrir site" e entre        |        |
|      no Google AI Studio.                | Guia   |
| (2)  Clique "Get API key" e depois      | 3-step |  ~72px
|      "Create API key".                   |        |
| (3)  Copie a chave, cole e valide.      |        |
|                                          |        |
| [auto_awesome] API Key                   |        |
| +----------------------------+--+        | Input  |  ~44px
| | AIza...                    |EE|        |        |
| +----------------------------+--+        |        |
| [info] Comeca com "AIza"                 | Hint   |  ~16px
|                                          |        |
| +---------------+ +----------------+    | Actions|  ~40px
| |[open_in_new]  | |[wifi_tethering]|    |        |
| | 1.Abrir site  | | 2.Validar     |    |        |
| |         FREE  | |    chave      |    |        |
| +---------------+ +----------------+    |        |
|                                          |        |
| +----+              +---------------+    | Nav    |  ~44px
| |[arrow_back]|      |[check_circle] |    | Footer |
| +----+              |  Finalizar    |    |        |
|                     +---------------+    |        |
|                                          |        |
|   [skip] Pular Gemini e finalizar        | Skip   |  ~20px
+-----------------------------------------+
                                    TOTAL = ~396px  SEM SCROLL
                                    Sobra = ~204px
```

### A') Reabrindo Settings (chaves já configuradas)

> Mesma estrutura dos slides, mas com key status e botão de alterar.

```
+----------------------------------------- 360px ----+
| [progress_bar]  35%                      | Bar    |  ~6px   LOCK
|         (o)(o)( )( )                     | Dots   |  ~20px  LOCK
|                            [flag][flag]  | Flags  |  ~24px
|                                          |        |
| +--+ Passo 1/3                           |        |
| |1 | Obrigatorio                         | Header |  ~44px
| +--+ [check_circle] Configurada          |        |
|                                          |        |
| Configurar chave Groq                    | Title  |  ~24px
|                                          |        |
| [vpn_key] API Key                        |        |
| +----------------------------+--+        | Input  |  ~44px
| | gsk_****...****Fk2         |EE|        | masked |
| +----------------------------+--+        |        |
| [check_circle] Chave configurada         | Status |  ~20px
|                                          |        |
|    +-----------------------------+       | Change |  ~36px
|    | [edit] Alterar esta chave   |       | Button |
|    +-----------------------------+       |        |
|                                          |        |
| [school] Guia passo a passo   [expand_more]| Toggle| ~36px
| (tutorial oculto — expandir se quiser)   |        |
|                                          |        |
| +----+                     +---------+   | Nav    |  ~44px
| |[arrow_back]|             |Proximo  |   | Footer |
| +----+                     |[arrow_forward]|      |
|                            +---------+   |        |
|                                          |        |
|     [close] Fechar configuracoes         | Close  |  ~24px
+-----------------------------------------+
                                    TOTAL = ~322px  SEM SCROLL
```

### B) Uso Normal — Tab Search (scroll OK)

```
+----------------------------------------- 360px ----+
| [track_changes] AnswerHunter  [flag][flag] [settings]| Header| ~48px
|    Cacador educacional                   |        |
|                                          |        |
| +------------+ +--------------------+    | Tabs   |  ~40px
| |[search]    | |[folder]            |    |        |
| | Buscar     | | Fichario           |    |        |
| |  ======    | |                    |    |        |
| +------------+ +--------------------+    |        |
|                                          |        |
| +---------+ +---------+ +--------+      | Action |  ~40px
| |[travel_ | |[descript| |[content|      | Btns   |
| | explore]| | ion]    | | _copy] |      |        |
| | Buscar  | | Extrair | | Copiar |      |        |
| +---------+ +---------+ +--------+      |        |
|                                          |        |
| [status: Buscando fontes...]             | Status |  ~28px
|-------------- scroll v -----------------|        |
|                                          |        |
| +----------------------------------+    |        |
| | [help] Melhor correspondencia    |    | Q&A    |
| |        [confidence_circle] [bookmark]| | Card   |
| | --------------------------------- |    |        | scroll
| | [check_circle] Confirmado por fontes| |        | OK
| | Multiplas fontes alinhadas...     |    |        |
| | --------------------------------- |    |        |
| | Questao extraida aqui...          |    |        |
| | --------------------------------- |    |        |
| | [check_circle] Resposta verificada|    |        |
| | +----+-------------------------+  |    |        |
| | | B  | Texto da alternativa    |  |    |        |
| | +----+-------------------------+  |    |        |
| | [link] Fontes (3) [expand_more]   |    |        |
| +----------------------------------+    |        |
|                                          |        |
| [smart_toy] Respostas com IA             | Footer |  ~24px
+-----------------------------------------+
```

### C) Estado de Erro — Chave Invalida/Faltando

> Cenario: usuario tenta buscar mas chave esta invalida ou ausente.

```
+----------------------------------------- 360px ----+
| [track_changes] AnswerHunter  [flag][flag] [settings]| Header| ~48px
|    Cacador educacional         (pulsa!)  | settings|
|                                          | pulsa  |
| +------------+ +--------------------+    | Tabs   |  ~40px
| |[search]    | |[folder]            |    |        |
| | Buscar     | | Fichario           |    |        |
| +------------+ +--------------------+    |        |
|                                          |        |
| +---------+ +---------+ +--------+      | Action |  ~40px
| |[travel_ | |[descript| |[content|      | Btns   |
| | explore]| | ion]    | | _copy] |      |        |
| | Buscar  | | Extrair | | Copiar |      |        |
| +---------+ +---------+ +--------+      |        |
|                                          |        |
| +----------------------------------+    |        |
| | [warning] Configuracao necessaria |    | Error  |  ~80px
| |                                   |    | Banner |
| | Configure as chaves Groq e       |    |        |
| | Serper para comecar a usar.       |    |        |
| |                                   |    |        |
| |  +---------------------------+    |    |        |
| |  |[settings] Abrir config.  |    |    | CTA    |  ~40px
| |  +---------------------------+    |    |        |
| +----------------------------------+    |        |
|                                          |        |
|          +------------------+            | Toast  |
|          |[error] Essa chave|            | (temp) |  ~44px
|          |nao funcionou.    |            |        |
|          |Verifique e tente |            |        |
|          |novamente.        |            |        |
|          +------------------+            |        |
|                                          |        |
| [smart_toy] Respostas com IA             | Footer |  ~24px
+-----------------------------------------+
```

### D) Estado Vazio — Sem Dados (Search + Binder)

**Search — estado vazio:**
```
+----------------------------------------- 360px ----+
| [track_changes] AnswerHunter  [flag][flag] [settings]| Header| ~48px
|    Cacador educacional                   |        |
|                                          |        |
| +------------+ +--------------------+    | Tabs   |  ~40px
| |[search]    | |[folder]            |    |        |
| | Buscar     | | Fichario           |    |        |
| |  ======    | |                    |    |        |
| +------------+ +--------------------+    |        |
|                                          |        |
| +---------+ +---------+ +--------+      | Action |  ~40px
| |[travel_ | |[descript| |[content|      | Btns   |
| | explore]| | ion]    | | _copy] |      | copy   |
| | Buscar  | | Extrair | | Copiar |      |disabled|
| +---------+ +---------+ +--------+      |        |
|                                          |        |
|                                          |        |
|           .----------.                   |        |
|           | [library |                   | Empty  |
|           |  _books] |                   | State  | ~140px
|           '----------'                   | Illust |
|                                          |        |
|    Encontre respostas e salve            | CTA    |
|    no seu fichario.                      | Text   |
|                                          |        |
|    Abra uma questao no navegador         | Hint   |
|    e clique em "Buscar" ou               |        |
|    "Extrair".                            |        |
|                                          |        |
| [smart_toy] Respostas com IA             | Footer |  ~24px
+-----------------------------------------+
```

**Binder — estado vazio:**
```
+----------------------------------------- 360px ----+
| [track_changes] AnswerHunter  [flag][flag] [settings]| Header| ~48px
|    Cacador educacional                   |        |
|                                          |        |
| +--------------------+ +------------+   | Tabs   |  ~40px
| |[search]            | |[folder]    |   |        |
| | Buscar             | | Fichario   |   |        |
| |                    | |  ======    |   |        |
| +--------------------+ +------------+   |        |
|                                          |        |
| [menu_book] Meus Estudos                 | Binder |  ~36px
|    Questoes salvas para revisao          | Header |
|                                          |        |
|                                          |        |
|           .----------.                   |        |
|           | [folder  |                   | Empty  |
|           |  _open]  |                   | State  | ~140px
|           '----------'                   | Illust |
|                                          |        |
|    Seu fichario esta vazio.              | CTA    |
|    Salve questoes para revisar           | Text   |
|    depois.                               |        |
|                                          |        |
|    +---------------------------+         | CTA    |
|    | [search] Ir para Buscar   |         | Button |  ~40px
|    +---------------------------+         |        |
|                                          |        |
| [smart_toy] Respostas com IA             | Footer |  ~24px
+-----------------------------------------+
```

---

# ENTREGÁVEL 3: Fluxo Guiado (10 Passos)

## Primeira Vez — Setup Completo

| Passo | Gatilho | Tela/Estado | Resultado Esperado |
|:---:|---|---|---|
| 1 | Usuario instala e clica no icone da extensao | **Slide 0 (Welcome)** aparece | Ve foguete, titulo, pills, botão "Iniciar guia" |
| 2 | Clica **"Iniciar guia"** | **Slide 1 (Groq)** aparece com transicao suave | Ve "Passo 1/3", sub-passos 1-2-3, campo de input, botoes |
| 3 | Clica **"1. Abrir site oficial"** `[open_in_new]` | Abre `console.groq.com/keys` em nova aba | Usuario cria conta e copia a chave Groq |
| 4 | Volta a extensao e **cola a chave** no campo | Input recebe a chave, hint muda para `[check_circle]` se formato correto | Feedback visual imediato de formato valido |
| 5 | Clica **"2. Validar chave"** `[wifi_tethering]` | Botao mostra `[sync]` loading -> `[check_circle]` "Chave validada" | Toast de sucesso. Botao "Proximo" habilita com pulse |
| 6 | Clica **"Proximo"** `[arrow_forward]` | **Slide 2 (Serper)** aparece | Mesmo padrao: sub-passos, input, botoes |
| 7 | Repete passos 3-5 para **Serper** | Abre site -> cola chave -> valida | "Proximo" habilita |
| 8 | Clica **"Proximo"** `[arrow_forward]` | **Slide 3 (Gemini — Opcional)** | Ve badge "Opcional", banner com `[lightbulb]`, botao "Finalizar" |
| 9 | Clica **"Finalizar"** `[check_circle]` ou **"Pular Gemini"** | Setup salva. Confetti. **Tela Principal** aparece | Toast "Tudo pronto!" + Main app visivel |
| 10 | Na tela principal, abre questao no navegador e clica **"Buscar"** `[travel_explore]` | Extensao extrai questao, busca fontes, mostra resultado | Card de resultado com resposta, confianca, fontes |

## Fluxo de Erro e Recuperacao

| Passo | Gatilho | Resultado |
|:---:|---|---|
| E1 | Usuario cola **chave invalida** e clica Validar | Botao fica `[error]` "Tentar novamente". Toast "Essa chave nao funcionou." Status em vermelho. |
| E2 | Usuario **corrige** a chave e clica Validar novamente | Transicao suave erro->sucesso. Botao fica `[check_circle]`. Proximo habilita. |
| E3 | Usuario tenta buscar **sem ter chave** configurada | Toast de erro + banner na tela Search com CTA "Abrir configuracoes" `[settings]`. Icone settings pulsa. |

## Fluxo de Reabertura (Settings)

| Passo | Gatilho | Resultado |
|:---:|---|---|
| S1 | Clica no icone `[settings]` no header | Wizard reabre no passo da chave que precisa atencao (ou passo 1 se todas OK) |
| S2 | Ve chave mascarada (gsk_****...Fk2) + chip `[check_circle]` "Configurada" | Sabe que a chave existe |
| S3 | Clica `[edit]` "Alterar esta chave" | Campo desbloqueia para editar. Botao "Validar" reaparece |
| S4 | Clica `[close]` "Fechar configuracoes" | Volta a tela principal sem alterar nada |

---

# ENTREGÁVEL 4: Microcopy (PT-BR + EN)

## Titulos e Subtitulos

| Chave i18n | PT-BR | EN |
|---|---|---|
| `setup.new.welcome.title` | Bem-vindo ao AnswerHunter | Welcome to AnswerHunter |
| `setup.new.welcome.desc` | Vamos te guiar passo a passo. Voce so precisa copiar e colar suas chaves. | We'll guide you step by step. You only need to copy and paste your keys. |
| `setup.groq.title` | Configurar chave Groq | Set up your Groq key |
| `setup.serper.title` | Configurar chave Serper | Set up your Serper key |
| `setup.gemini.title` | Opcional: backup Gemini | Optional: Gemini backup |
| `setup.groq.tagline` | Groq e obrigatorio. Ajuda a extensao a entender cada questao. | Groq is required. It helps the extension understand each question. |
| `setup.serper.tagline` | Serper e obrigatorio. Permite buscar fontes confiaveis na web. | Serper is required. It searches trusted sources on the web. |
| `setup.gemini.tagline` | Etapa opcional. Gemini so entra quando Groq estiver indisponivel. | Optional step. Gemini only activates when Groq is unavailable. |

## Botoes

| Chave i18n | PT-BR | EN |
|---|---|---|
| `setup.new.start` | Iniciar guia | Start guided setup |
| `setup.openSiteAction` | 1. Abrir site oficial | 1. Open official site |
| `setup.validateAction` | 2. Validar chave | 2. Validate key |
| `setup.next` | Proximo | Next |
| `setup.back` | Voltar | Back |
| `setup.finish` | Finalizar | Finish Setup |
| `setup.skipGemini` | Pular Gemini e finalizar | Skip Gemini, finish setup |
| `setup.changeKey` | Alterar esta chave | Change this key |
| `setup.closeSettings` | Fechar configuracoes | Close settings |
| `setup.freeTag` | GRATIS | FREE |
| `action.search` | Buscar | Search |
| `action.extract` | Extrair | Extract |
| `action.copyAll` | Copiar tudo | Copy all |

## Mensagens de Status/Feedback

| Chave i18n | PT-BR | EN |
|---|---|---|
| `setup.status.empty` | Cole uma chave primeiro. | Paste a key first. |
| `setup.status.testing` | Validando conexao... | Validating connection... |
| `setup.status.ok` | Conexao OK! | Connection OK! |
| `setup.status.error` | Chave invalida ou erro do provedor. | Invalid key or provider error. |
| `setup.toast.saved` | Tudo pronto! Voce ja pode buscar respostas. | All set! You're ready to hunt answers. |
| `setup.toast.required` | Configure as chaves Groq e Serper para comecar. | Set up your Groq and Serper keys to get started. |
| `setup.toast.pasteKey` | Cole sua chave de API no campo primeiro. | Paste your API key in the field first. |
| `setup.toast.connectionOk` | {provider} conectado com sucesso! | {provider} connected successfully! |
| `setup.toast.invalidKey` | Essa chave nao funcionou. Verifique e tente novamente. | This key didn't work. Double-check and try again. |
| `setup.toast.testError` | Teste falhou. Verifique sua internet. | Test failed. Check your internet. |
| `setup.keyStatus.configured` | Configurada | Configured |
| `setup.keyStatus.missing` | Nao configurada | Not configured |

## Dicas e Hints

| Chave i18n | PT-BR | EN |
|---|---|---|
| `setup.hint.groq` | Comeca com "gsk_" | Starts with "gsk_" |
| `setup.hint.serper` | Copie a chave longa do dashboard Serper | Copy the long key from your Serper dashboard |
| `setup.hint.gemini` | Comeca com "AIza" | Starts with "AIza" |
| `setup.timeHint` | Leva cerca de 2 minutos | Takes about 2 minutes |
| `setup.privacy` | Suas chaves ficam no seu dispositivo e nunca sao enviadas aos nossos servidores. | Your keys are stored locally and never sent to our servers. |
| `setup.gemini.hint` | Pode pular e configurar depois nas configuracoes. | You can skip and set this up later in settings. |

## Sub-passos do Tutorial

| Chave i18n | PT-BR | EN |
|---|---|---|
| `setup.groq.step1` | Clique "Abrir site oficial" e crie sua conta gratis na Groq. | Click "Open official site" and create your free Groq account. |
| `setup.groq.step2` | Na Groq, abra "API Keys" e crie uma nova chave. | On Groq, open "API Keys" and create a new key. |
| `setup.groq.step3` | Copie a chave, cole abaixo e clique "Validar chave". | Copy the key, paste below, then click "Validate key". |
| `setup.serper.step1` | Clique "Abrir site oficial" e crie sua conta gratis na Serper. | Click "Open official site" and create your free Serper account. |
| `setup.serper.step2` | Abra seu dashboard e localize sua API Key. | Open your dashboard and locate your API Key. |
| `setup.serper.step3` | Copie a chave, cole abaixo e clique "Validar chave". | Copy the key, paste below, then click "Validate key". |
| `setup.gemini.step1` | Clique "Abrir site oficial" e entre no Google AI Studio. | Click "Open official site" and sign in to Google AI Studio. |
| `setup.gemini.step2` | Clique "Get API key" e depois "Create API key". | Click "Get API key" then "Create API key". |
| `setup.gemini.step3` | Copie a chave, cole abaixo e valide se quiser backup de IA. | Copy the key, paste below, and validate if you want backup AI. |

## Placeholder / Estado Vazio

| Chave i18n | PT-BR | EN |
|---|---|---|
| `placeholder.search` | Encontre respostas e salve no seu fichario. | Find answers and save them to your binder. |
| `placeholder.searchHint` | Abra uma questao no navegador e clique em "Buscar" ou "Extrair". | Open a question in your browser and click "Search" or "Extract". |
| `binder.placeholderHtml` | Seu fichario esta vazio.<br>Salve questoes para revisar depois. | Your binder is empty.<br>Save questions to review later. |
| `binder.goToSearch` | Ir para Buscar | Go to Search |

## Acoes de Guia

| Chave i18n | PT-BR | EN |
|---|---|---|
| `setup.skipGuide` | Pular guia | Skip guide |
| `setup.restartGuide` | Reiniciar guia | Restart guide |

---

# ENTREGÁVEL 5: Checklist Final de Validação

## O usuario deve conseguir finalizar tudo em 3 minutos ou menos

### Setup (menos de 2 min)

- [ ] **Bandeiras visiveis** em todas as telas (onboarding + main)
- [ ] Clicar em bandeira **troca TODO o conteudo textual** instantaneamente
- [ ] Estado selecionado indicado com **borda/realce leve** (sem texto PT/EN)
- [ ] **Slide 0 (Welcome)** — foguete, titulo, pills, CTA intactos (BLOQUEADO)
- [ ] **Barra de progresso** — funciona e avanca corretamente (BLOQUEADA)
- [ ] **Dots** — marcam passo atual (BLOQUEADOS)
- [ ] **Slide 1 (Groq)** — sub-passos visiveis, input funcional, "Abrir site" abre aba, "Validar" testa
- [ ] **Slide 2 (Serper)** — idem
- [ ] **Slide 3 (Gemini)** — idem + "Pular" funciona
- [ ] Input aceita **paste** e da feedback visual (flash + hint atualiza)
- [ ] **Validacao OK** -> botao fica `[check_circle]`, toast de sucesso, Next habilita com pulse
- [ ] **Validacao falha** -> botao fica `[error]` "Tentar novamente", toast de erro, campo nao reseta
- [ ] **Next desabilitado** ate validacao passar (Groq, Serper)
- [ ] **Finalizar** salva chaves localmente, fecha wizard, toast "Tudo pronto!", confetti
- [ ] **Sem scroll** em nenhum slide de setup

### Tela Principal (apos setup)

- [ ] Header com marca, bandeiras, icone `[settings]`
- [ ] Tabs Search / Binder funcionam
- [ ] Botoes **Search** `[travel_explore]` e **Extract** `[description]` presentes e funcionais
- [ ] **Estado vazio** (Search) mostra placeholder `[library_books]` com instrucao clara
- [ ] **Estado vazio** (Binder) mostra placeholder `[folder_open]` com CTA "Ir para Buscar"
- [ ] **Resultado** aparece em card com questao, resposta, confianca, fontes
- [ ] **Botao Copy** `[content_copy]` habilita quando ha resultados

### Erro e Recuperacao

- [ ] Tentar Search/Extract **sem chaves** -> toast + banner `[warning]` com CTA "Abrir configuracoes"
- [ ] `[settings]` **pulsa** para chamar atencao quando chaves faltam
- [ ] Clicar `[settings]` -> reabre wizard **com chaves preenchidas** (mascaradas)
- [ ] Chip `[check_circle]` "Configurada" ou `[warning]` "Nao configurada" visivel
- [ ] Botao **`[edit]` "Alterar esta chave"** permite editar chave existente
- [ ] Botao **`[close]` "Fechar configuracoes"** volta a tela principal sem alterar nada

### Acessibilidade

- [ ] Contraste WCAG AA em todos os textos
- [ ] Focus visivel no teclado (Tab navega, Enter ativa)
- [ ] Mensagens de erro sao **claras e nao tecnicas**
- [ ] Icones tem `title` ou `aria-label` descritivo

---

# BONUS: Visual System — Icones, Ilustracoes e Microinteracoes

## Estilo de Icone

| Propriedade | Valor |
|---|---|
| **Biblioteca** | Material Symbols Rounded (ja em uso) |
| **Estilo** | Outlined (padrao) / Filled (quando ativo/selecionado) |
| **Tamanho padrao** | 20px (texto inline), 24px (botoes), 16px (hints/small) |
| **Cor** | Herda a cor do contexto (texto/accent) |
| **Peso** | 400 (normal), 600 (enfase) |

## Mapa de Icones por Funcao

| Funcao | Icone Material Symbols | Contexto |
|---|---|---|
| Abrir site externo | `open_in_new` | Botao "Abrir site oficial" |
| Validar chave | `wifi_tethering` | Botao "Validar chave" |
| Loading/testando | `sync` (animado spin) | Durante validacao |
| Sucesso | `check_circle` | Apos validacao OK |
| Erro | `error` | Apos validacao falha |
| Informacao | `info` | Hints de formato de chave |
| Chave/key | `vpn_key` | Label do input Groq |
| Busca web | `travel_explore` | Label do input Serper + botao Search |
| IA/auto | `auto_awesome` | Label do input Gemini |
| Privacidade | `shield` | Tooltip de privacidade |
| Dica/luz | `lightbulb` | Banner Gemini opcional |
| Escola/guia | `school` | Header do tutorial |
| Voltar | `arrow_back` | Navegacao |
| Avancar | `arrow_forward` | Navegacao |
| Finalizar | `check_circle` | Botao de finalizar |
| Pular | `skip_next` | Botao pular Gemini |
| Editar/alterar | `edit` | Botao alterar chave |
| Fechar | `close` | Botao fechar settings |
| Settings | `settings` | Icone engrenagem header |
| Visibilidade | `visibility` / `visibility_off` | Toggle de mostrar/esconder chave |
| Copiar | `content_copy` | Botao copiar |
| Timer | `schedule` | Hint de tempo |
| Marca | `track_changes` | Logo header |
| Aviso | `warning` | Estado de erro/faltando |

## Ilustracoes (2 estilos maximo)

| Estilo | Onde Aparece | Descricao |
|---|---|---|
| **A: Hero animado (orbitas)** | Welcome (foguete) — BLOQUEADO | Icone central `[rocket_launch]` com orbiting dots (`[search]`, `[psychology]`, `[auto_awesome]`) |
| **B: Icone centralizado c/ fundo suave** | Empty states (Search + Binder) | Icone Material Symbol grande (~48px) em container circular suave + texto descritivo abaixo. Icones: `[library_books]` (Search vazio) e `[folder_open]` (Binder vazio) |

## Microinteracoes

| Efeito | Objetivo (UX) | Onde Aparece | Regra de Uso |
|---|---|---|---|
| **Pulse no botao Next** | Chamar atencao para proxima acao | Botao "Proximo" apos validacao OK | Aplicar APENAS apos transicao ok->enabled. Remover apos clique. |
| **Flash no input (paste)** | Confirmar que chave foi colada | Campo de input ao detectar paste | Borda brilha por 700ms. Nao repetir se colar novamente antes de acabar. |
| **Spin `[sync]` no botao Validate** | Indicar teste em andamento | Botao "Validar chave" durante teste | Icone `[sync]` gira. Botao fica disabled. Parar ao terminar (ok ou fail). |
| **Transicao erro->sucesso** | Reduzir ansiedade ao corrigir | Status/hint do input | Cor faz fade de vermelho->verde em 300ms. Icone troca `[error]`->`[check_circle]`. |
| **Confetti** | Celebrar conclusao do setup | Tela inteira ao finalizar setup | Apenas 1 vez (quando `setupDone` e setado pela primeira vez). |
| **Toast slide-in** | Feedback nao-intrusivo | Canto superior da extensao | Aparece por 3.2s, sai com fade. Maximo 1 toast visivel por vez. |
| **`[settings]` Attention pulse** | Chamar atencao para configuracoes | Icone `[settings]` no header | Pulse leve quando chaves faltam. Parar quando setup esta OK. |
| **Slide transition** | Progressao fluida entre passos | Troca de slides no wizard | `translateX` com `ease-out 400ms`. Usar `ease-in` ao voltar. |

### Efeitos a EVITAR

| Efeito | Motivo |
|---|---|
| Parallax scroll | Sem scroll nas telas de setup |
| Hover tooltips em mobile | Touch nao tem hover |
| Auto-advance com timer | Leigo precisa controlar o ritmo |
| Skeleton loading nos inputs | Inputs sao estaticos, skeleton confundiria |
| Animacao ao digitar no input | Distrai durante acao focada |

---

## Proximos Passos

> **Apos aprovacao dos wireframes:**
> 1. Implementar alteracoes no `popup.html` (novo layout)
> 2. Implementar novos componentes no `PopupView.js`
> 3. Atualizar `PopupController.js` (settings reopen logic, close button)
> 4. Atualizar `translations.js` (novas chaves de microcopy)
> 5. Atualizar `popup.css` (tema visual final)
> 6. Testar todos os estados em 360x600
