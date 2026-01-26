@echo off
chcp 65001 >nul
title Q&A Extractor - Atualizador

echo.
echo ╔═══════════════════════════════════════════╗
echo ║     🎓 Q&A Extractor - Atualizador        ║
echo ╚═══════════════════════════════════════════╝
echo.

:: Configuração - Link do repositório GitHub
set REPO_URL=https://github.com/cezarlugullo/AnswerHunter-/archive/refs/heads/main.zip
set TEMP_ZIP=%TEMP%\qa-extractor-update.zip
set TEMP_FOLDER=%TEMP%\qa-extractor-temp

echo [1/4] Baixando última versão...
powershell -Command "Invoke-WebRequest -Uri '%REPO_URL%' -OutFile '%TEMP_ZIP%'" 2>nul

if not exist "%TEMP_ZIP%" (
    echo.
    echo ❌ Erro ao baixar. Verifique sua conexão e o link do repositório.
    echo.
    pause
    exit /b 1
)

echo [2/4] Extraindo arquivos...
if exist "%TEMP_FOLDER%" rmdir /s /q "%TEMP_FOLDER%"
powershell -Command "Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%TEMP_FOLDER%' -Force"

echo [3/4] Atualizando arquivos...
:: Encontra a pasta extraída (geralmente nome-do-repo-main)
for /d %%i in ("%TEMP_FOLDER%\*") do (
    xcopy "%%i\*" "%~dp0" /s /y /q >nul
)

echo [4/4] Limpando arquivos temporários...
del "%TEMP_ZIP%" 2>nul
rmdir /s /q "%TEMP_FOLDER%" 2>nul

echo.
echo ╔═══════════════════════════════════════════╗
echo ║     ✅ Atualização concluída!             ║
echo ╚═══════════════════════════════════════════╝
echo.
echo Agora você precisa:
echo 1. Abrir chrome://extensions/
echo 2. Clicar no botão de recarregar (🔄) da extensão
echo.
pause
