#!/bin/bash
# AnswerHunter - Atualizador (Linux)

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║         ANSWER HUNTER - UPDATER           ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# Verifica se existe pasta .git
if [ -d ".git" ]; then
    echo "[1/2] Repositorio GIT detectado. Tentando atualizar via git pull..."
    git pull origin main
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "╔═══════════════════════════════════════════╗"
        echo "║     ✅ Atualizacao concluida!             ║"
        echo "╚═══════════════════════════════════════════╝"
        echo ""
        echo "Agora voce precisa:"
        echo "1. Abrir chrome://extensions/"
        echo "2. Clicar no botao de recarregar (seta girando) da extensao"
        echo ""
        read -p "Pressione Enter para sair..."
        exit 0
    fi
    
    echo ""
    echo "[X] Erro ao atualizar via GIT."
    echo "Tente rodar o arquivo 'configurar.sh' novamente para corrigir a autenticacao."
    echo ""
    read -p "Pressione Enter para sair..."
    exit 1
fi

# Se não for git
echo ""
echo "[!] ATENCAO: Repositorio nao configurado!"
echo ""
echo "Para receber atualizacoes automaticas, voce precisa rodar o arquivo"
echo "'configurar.sh' uma unica vez."
echo ""
echo "1. Feche esta janela"
echo "2. Execute o comando: ./configurar.sh"
echo ""
read -p "Pressione Enter para sair..."
exit 1
