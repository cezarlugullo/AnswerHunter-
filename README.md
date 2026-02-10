# 🎯 AnswerHunter

Extensão Chrome que caça respostas para questões educacionais usando IA.

## ✨ Funcionalidades

- **🔍 Extrair Página**: Extrai perguntas e respostas da página atual
- **🌐 Buscar Resposta**: Busca automaticamente a resposta no Google
- **🤖 IA Integrada**: Refina e formata as respostas automaticamente
- **📋 Copiar**: Copia as questões formatadas para estudar
- **🎓 Suporte Estácio**: Extração específica para o portal da Estácio

## 📥 Instalação

### 📺 Tutorial Visual
**Parte 1: Baixando e Extraindo**
![Instalação Parte 1](gif/passo-a-passo-1.gif)

**Parte 2: Carregando no Chrome**
![Instalação Parte 2](gif/passo-a-passo-2.gif)

### Passo a Passo em Texto:
1. Baixe este repositório (Code → Download ZIP)
2. Extraia para uma pasta no seu computador
3. **IMPORTANTE:** Entre na pasta extraída até ver o arquivo `manifest.json`
4. Abra `chrome://extensions/` no Chrome
5. Ative o **Modo do desenvolvedor** (canto superior direito)
6. Clique em **Carregar sem compactação**
7. Selecione a pasta correta

### 🔄 Atualizações Automáticas
![Atualizando a Extensão](gif/atualizando%20com%20.bat.gif)

1. Execute o arquivo `atualizar.bat`
2. Recarregue a extensão em `chrome://extensions/`
   *(Se der erro, execute `configurar.bat` primeiro)*

## 🚀 Como Usar

1. Acesse um site com perguntas (ex: lista de exercícios da Estácio)
2. Clique no ícone da extensão
3. Escolha:
   - **Extrair Página**: Se a resposta já está visível na página
   - **Buscar Resposta**: Se precisa buscar a resposta no Google

## ⚙️ Configuração de API Keys

Para usar a extensão, você precisa das suas próprias chaves de API:

1. **Groq** (IA): Crie uma conta em [console.groq.com](https://console.groq.com) e gere uma API key
2. **Serper** (Busca Google): Crie uma conta em [serper.dev](https://serper.dev) e gere uma API key

Após obter as chaves, insira-as nas configurações da extensão.

## ⚠️ Importante

- Use apenas para fins educacionais

## 📝 Changelog

### v1.2.0
- Renomeado para AnswerHunter
- Suporte específico para portal da Estácio
- Extração melhorada com data-testid
- Novo visual estilo Passei Direto (Checkpointer)

### v1.1.0
- Adicionada busca automática no Google
- Melhor detecção de questões de asserções (I, II, III)
- Interface atualizada com dois botões
