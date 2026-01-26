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
echo "⚠️  ATENCAO: Vai pedir login no GitHub (ou token)."
echo "⚠️  Faca login com sua conta para autorizar o acesso."
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
    echo "Nao foi possivel acessar o repositorio."
    echo "Verifique se voce tem permissao de acesso ao repositorio privado."
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
