@echo off
chcp 65001 >nul
title Q&A Extractor - Instalador

echo.
echo ╔═══════════════════════════════════════════╗
echo ║     🎓 Q&A Extractor - Instalador         ║
echo ╚═══════════════════════════════════════════╝
echo.

echo Esta extensão precisa ser instalada manualmente no Chrome.
echo.
echo Siga os passos abaixo:
echo.
echo 1. Abra o Chrome
echo 2. Digite na barra de endereço: chrome://extensions/
echo 3. Ative o "Modo do desenvolvedor" (canto superior direito)
echo 4. Clique em "Carregar sem compactação"
echo 5. Selecione esta pasta: %~dp0
echo.
echo ─────────────────────────────────────────────
echo.

:: Abrir a página de extensões automaticamente
echo Abrindo chrome://extensions/ no Chrome...
start chrome://extensions/

echo.
echo Pressione qualquer tecla após instalar a extensão...
pause >nul

echo.
echo ✅ Instalação concluída!
echo.
echo Para atualizar no futuro, execute: atualizar.bat
echo.
pause
