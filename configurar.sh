#!/bin/bash
# AnswerHunter - Configuracao Inicial (Linux)

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║      ANSWER HUNTER - CONFIGURACAO         ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "Este script vai configurar a atualizacao automatica para voce."
echo ""

# 1. Verificar Git
echo "[1/4] Verificando Git..."
if ! command -v git &> /dev/null; then
    echo ""
    echo "[X] O GIT NAO ESTA INSTALADO!"
    echo ""
    echo "Voce precisa instalar o Git para receber atualizacoes."
    echo "Distros baseadas em Debian/Ubuntu: sudo apt install git"
    echo "Fedora: sudo dnf install git"
    echo "Arch: sudo pacman -S git"
    echo ""
    read -p "Pressione Enter para sair..."
    exit 1
fi
echo "[OK] Git encontrado."

# 2. Inicializar Git se não existir
if [ ! -d ".git" ]; then
    echo ""
    echo "[2/4] Configurando repositorio..."
    git init
    git branch -M main
    git remote add origin https://github.com/cezarlugullo/AnswerHunter-.git
    echo "[OK] Repositorio configurado."
else
    echo "[OK] Repositorio ja configurado."
fi

# 3. Autenticação e Primeiro Download
echo ""
echo "[3/4] Conectando ao GitHub..."
echo ""
echo "⚠️  ATENCAO: Para clonar repositorios privados, voce precisa:"
echo ""
echo "OPCAO 1 - Personal Access Token (Recomendado):"
echo "  1. Acesse: https://github.com/settings/tokens"
echo "  2. Clique em 'Generate new token' > 'Generate new token (classic)'"
echo "  3. Selecione o escopo 'repo'"
echo "  4. Copie o token gerado"
echo "  5. Cole aqui como senha quando for solicitado"
echo ""
echo "OPCAO 2 - SSH (Se ja tem SSH configurado no GitHub):"
echo "  1. Seu cliente Git ja deve estar configurado"
echo "  2. Se nao funcionar, crie uma chave: ssh-keygen -t ed25519"
echo ""
read -p "Pressione Enter para continuar..." temp

echo ""
echo "Baixando arquivos..."
git fetch --all
git reset --hard origin/main

if [ $? -ne 0 ]; then
    echo ""
    echo "[X] FALHA NA AUTENTICACAO!"
    echo ""
    echo "Nao foi possivel acessar o repositorio. Opcoes:"
    echo ""
    echo "1. Se usa token pessoal:"
    echo "   - Gere um novo token em https://github.com/settings/tokens"
    echo "   - Configure com: git config credential.helper store"
    echo "   - Tente novamente (sera pedido usuario e token)"
    echo ""
    echo "2. Se usa SSH:"
    echo "   - Configure chave SSH: ssh-keygen -t ed25519"
    echo "   - Adicione em https://github.com/settings/keys"
    echo ""
    echo "3. Se o repositorio e privado:"
    echo "   - Verifique se tem permissao de acesso"
    echo "   - Contacte o proprietario do repositorio"
    echo ""
    read -p "Pressione Enter para sair..."
    exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║     ✅ TUDO PRONTO! AGORA E SO USAR     ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "A partir de agora, para atualizar, basta rodar o arquivo 'atualizar.sh'."
echo ""
read -p "Pressione Enter para sair..."
