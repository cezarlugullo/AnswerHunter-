<div align="center">

<img src="icons/icon128.png" alt="AnswerHunter Logo" width="96" />

# AnswerHunter

**Extensão para Chrome com IA que encontra e explica respostas de questões de múltipla escolha em plataformas educacionais.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extensão-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![License: MIT](https://img.shields.io/badge/Licença-MIT-green.svg)](LICENSE)
[![Idiomas](https://img.shields.io/badge/Idiomas-PT--BR%20%7C%20EN-orange)](src/i18n/translations.js)

🇺🇸 [Read in English](README.md)

</div>

---

## O que é o AnswerHunter?

O AnswerHunter é uma extensão para Chrome que te ajuda a **entender questões de múltipla escolha** em plataformas educacionais como o **Estácio SIA/AVA**. Ele:

- 🔍 **Extrai** a questão e todas as alternativas direto da página
- 🌐 **Pesquisa no Google** por conteúdo acadêmico relevante
- 🤖 **Usa IA** para analisar as fontes e identificar a alternativa mais provável
- 📖 **Explica** o raciocínio passo a passo

> O AnswerHunter é uma **ferramenta de aprendizagem** — ele te ajuda a entender *por que* uma resposta está correta, não apenas qual é a resposta.

---

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| **Extração inteligente** | Captura questões de estruturas DOM complexas, incluindo iframes |
| **Busca na web** | Pesquisa no Google via API Serper por evidências acadêmicas |
| **Análise por IA** | Usa os modelos Groq/Gemini para avaliar cada alternativa |
| **Raciocínio passo a passo** | Mostra a análise completa em seção expansível |
| **Corrigir resposta** | Permite marcar manualmente a alternativa correta |
| **Fichário de estudos** | Salva questões e respostas para revisar depois |
| **Bilíngue** | Suporte completo para Português (pt-BR) e Inglês |

---

## O que você vai precisar

Você vai precisar de chaves de API gratuitas dos seguintes serviços:

| Serviço | Para que serve | Obrigatório? | Plano gratuito |
|---|---|---|---|
| [Groq](https://console.groq.com) | IA para análise das questões | ✅ Sim | 14.400 requisições/dia |
| [Serper](https://serper.dev) | Pesquisa no Google | Opcional | 2.500 buscas/mês |
| [Google AI Studio](https://aistudio.google.com) | IA Gemini (backup) | Opcional | Plano generoso |

Não se preocupe — o processo é simples e gratuito. As instruções abaixo explicam tudo passo a passo.

---

## Instalação

### Passo 1 — Baixar a extensão

Clique em **Code → Download ZIP** nesta página e extraia em uma **pasta permanente** no seu computador.

> ⚠️ Não apague a pasta depois de instalar — o Chrome carrega a extensão a partir dela.

---

### Passo 2 — Abrir as Extensões do Chrome

Abra uma nova aba e digite na barra de endereço:

```
chrome://extensions
```

Ative o **Modo do desenvolvedor** com o botão no canto superior direito:

```
┌──────────────────────────────────────────────────────┐
│  Extensões                     Modo desenvolvedor ●  │
│                                                      │
│  [ Carregar sem compactação ]  [ Compactar ]  [ ↺ ] │
└──────────────────────────────────────────────────────┘
```

---

### Passo 3 — Carregar a extensão

Clique em **"Carregar sem compactação"** e selecione a pasta onde você extraiu o ZIP.

O ícone do AnswerHunter ( 🔍 ) vai aparecer na barra de ferramentas do Chrome. Clique no ícone de quebra-cabeça 🧩 e fixe-o para facilitar o acesso.

---

### Passo 4 — Obter sua chave gratuita do Groq

> O Groq oferece acesso gratuito a modelos de IA avançados. Não é necessário cartão de crédito.

1. Acesse **[console.groq.com](https://console.groq.com)** e crie uma conta gratuita
2. No menu à esquerda, clique em **"API Keys"**
3. Clique em **"Create API Key"**
4. Dê um nome à chave (ex: `AnswerHunter`) e clique em criar
5. **Copie a chave** — ela começa com `gsk_...`

```
┌──────────────────────────────────────────────────────┐
│  Groq Console → API Keys                             │
│                                                      │
│  [ + Create API Key ]                                │
│                                                      │
│  Nome: AnswerHunter                                  │
│  ┌────────────────────────────────────────────────┐  │
│  │ gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  [📋] │  │
│  └────────────────────────────────────────────────┘  │
│                    ⚠️ Copie agora! Não aparece novamente │
└──────────────────────────────────────────────────────┘
```

> 💡 O plano gratuito do Groq dá 14.400 requisições de IA por dia — mais do que suficiente para uso diário.

---

### Passo 5 — Configurar a extensão

1. Clique no ícone do AnswerHunter na barra de ferramentas do Chrome
2. O **assistente de configuração** abre automaticamente no primeiro uso
3. Cole sua chave do Groq no campo indicado
4. Clique em **"Testar conexão"** — você deve ver ✅ Conexão OK!
5. Clique em **"Próximo"** e depois **"Salvar"**

```
┌──────────────────────────────────────────────────────┐
│  🔑  Configurar chave Groq                           │
│                                                      │
│  Chave de API:  [ gsk_xxxx...              ]  👁    │
│                                                      │
│         [ ✓ Testar conexão ]                         │
│         ✅ Conexão OK!                                │
│                                                      │
│                          [ Próximo → ]               │
└──────────────────────────────────────────────────────┘
```

---

### Passo 6 — (Opcional) Adicionar Serper para resultados melhores

Com a chave do Serper, a extensão pesquisa no Google por evidências acadêmicas antes de responder — isso melhora significativamente a precisão.

1. Acesse **[serper.dev](https://serper.dev)** e crie uma conta gratuita
2. Copie sua chave de API no dashboard
3. Abra a extensão, clique no **ícone ⚙️** e cole a chave no campo Serper

> O plano gratuito do Serper inclui 2.500 pesquisas no Google por mês.

---

## Como usar

1. **Acesse uma página de questão** na sua plataforma educacional (ex: Estácio SIA)
2. **Clique** no ícone do AnswerHunter na barra de ferramentas
3. Escolha uma ação:

```
┌─────────────────────────────────────────────────┐
│  [ 🔍 Buscar ]      [ 📄 Extrair ]              │
│                                                  │
│  Buscar  = Google + IA  (mais preciso)           │
│  Extrair = Só IA        (mais rápido)            │
└─────────────────────────────────────────────────┘
```

4. O card de resultado aparece com:
   - ✅ A **letra da alternativa sugerida** (ex: **E**)
   - 📝 O **texto da resposta**
   - 🎯 Um **índice de confiança** (0–100%)
   - 🧠 Uma seção **"Ver raciocínio da IA"** expansível com a análise completa

---

## Plataformas suportadas

Testado principalmente em:
- **Estácio SIA** (Ambiente Virtual de Aprendizagem)
- **Estácio AVA**

Pode funcionar em outras plataformas LMS com estrutura HTML padrão.

---

## Perguntas frequentes

**A extensão garante a resposta certa?**
Não. O AnswerHunter sugere a resposta mais provável com base em evidências, mas a IA pode errar. Sempre use o raciocínio mostrado para confirmar por conta própria.

**Meus dados ficam seguros?**
Sim. Suas chaves de API ficam armazenadas localmente no seu Chrome. Nenhum dado é enviado para servidores externos — as requisições vão direto do seu navegador para os serviços (Groq, Serper, Google).

**Funciona em outras plataformas além do Estácio?**
Pode funcionar. A extensão tenta extrair questões de qualquer página HTML. Resultados variam conforme a estrutura da plataforma.

**O que acontece quando acabo as requisições gratuitas?**
O Groq tem um limite diário. Se atingir o limite, a extensão avisa e você pode aguardar a renovação (todo dia à meia-noite UTC) ou criar uma nova chave gratuita.

---

## Privacidade e segurança

- ✅ **Nenhum dado é armazenado em servidores externos** — tudo usa suas próprias chaves de API
- ✅ **Suas chaves ficam no armazenamento local** e criptografado do Chrome
- ✅ **Sem rastreamento, sem analytics, sem cadastro**
- ✅ **Código totalmente aberto** — você pode ler cada linha aqui

---

## Contribuindo

Pull requests são bem-vindos! Por favor, abra uma issue primeiro para discutir o que você gostaria de mudar.

---

## Licença

MIT © Contribuidores do AnswerHunter
