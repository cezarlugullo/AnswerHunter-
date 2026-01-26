#!/bin/bash
# Q&A Extractor - Instalador (Linux)

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║     🎓 Q&A Extractor - Instalador         ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

echo "Esta extensão precisa ser instalada manualmente no Chrome."
echo ""
echo "Siga os passos abaixo:"
echo ""
echo "1. Abra o Chrome"
echo "2. Digite na barra de endereço: chrome://extensions/"
echo "3. Ative o 'Modo do desenvolvedor' (canto superior direito)"
echo "4. Clique em 'Carregar sem compactação'"
echo "5. Selecione esta pasta: $(pwd)"
echo ""
echo "─────────────────────────────────────────────"
echo ""

# Abrir a página de extensões automaticamente (tentativa)
echo "Tentando abrir chrome://extensions/..."
if command -v xdg-open &> /dev/null; then
    xdg-open "chrome://extensions/" 2>/dev/null || echo "Nao foi possivel abrir o navegador automaticamente."
elif command -v google-chrome &> /dev/null; then
     google-chrome "chrome://extensions/" 2>/dev/null || echo "Nao foi possivel abrir o navegador automaticamente."
else
    echo "Nao foi possivel detectar o comando para abrir o navegador."
fi

echo ""
echo "Pressione Enter após instalar a extensão..."
read temp

echo ""
echo "✅ Instalação concluída!"
echo ""
echo "Para atualizar no futuro, execute: ./atualizar.sh"
echo ""
read -p "Pressione Enter para sair..."
