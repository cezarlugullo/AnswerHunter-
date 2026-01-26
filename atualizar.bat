@echo off
chcp 65001 >nul
title AnswerHunter - Atualizador

echo.
echo ╔═══════════════════════════════════════════╗
echo ║         ANSWER HUNTER - UPDATER           ║
echo ╚═══════════════════════════════════════════╝
echo.

:: Verifica se existe pasta .git (Clone Git)
if exist ".git" (
    echo [1/2] Repositorio GIT detectado. Tentando atualizar via git pull...
    git pull origin main
    if %errorlevel% equ 0 (
        goto :success
    )
    echo.
    echo [X] Erro ao atualizar via GIT.
    echo Tente rodar o arquivo "configurar.bat" novamente para corrigir a autenticacao.
    echo.
    pause
    exit /b
)

:: Se não for git
echo.
echo [!] ATENCAO: Repositorio nao configurado!
echo.
echo Para receber atualizacoes automaticas, voce precisa rodar o arquivo
echo "configurar.bat" uma unica vez.
echo.
echo 1. Feche esta janela
echo 2. Execute o arquivo "configurar.bat"
echo.
pause
exit /b

:success
echo.
echo ╔═══════════════════════════════════════════╗
echo ║     ✅ Atualizacao concluida!             ║
echo ╚═══════════════════════════════════════════╝
echo.
echo Agora voce precisa:
echo 1. Abrir chrome://extensions/
echo 2. Clicar no botao de recarregar (seta girando) da extensao
echo.
pause
