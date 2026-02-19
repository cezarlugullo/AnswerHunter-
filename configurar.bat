@echo off
chcp 65001 >nul
title AnswerHunter - Configuracao Inicial
color 0f

echo.
echo ╔═══════════════════════════════════════════╗
echo ║      ANSWER HUNTER - CONFIGURACAO         ║
echo ╚═══════════════════════════════════════════╝
echo.
echo Este script vai configurar a atualizacao automatica para voce.
echo.

:: 1. Verificar Git
echo [1/4] Verificando Git...
git --version >nul 2>&1
if %errorlevel% neq 0 (
    color 0c
    echo.
    echo [X] O GIT NAO ESTA INSTALADO!
    echo.
    echo Voce precisa instalar o Git para receber atualizacoes.
    echo 1. Baixe e instale o Git do site oficial, apenas clicando em "Next" ate o fim
    echo 2. Apos instalar, rode este arquivo novamente.
    echo.
    echo Pressione qualquer tecla para abrir o site do Git...
    pause >nul
    start https://git-scm.com/download/win
    exit
)
echo [OK] Git encontrado.

:: 2. Inicializar Git se não existir
if not exist ".git" (
    echo.
    echo [2/4] Configurando repositorio...
    git init
    git branch -M main
    git remote add origin https://github.com/SEU_USUARIO/AnswerHunter.git
    echo [OK] Repositorio configurado.
) else (
    echo [OK] Repositorio ja configurado.
)

:: 3. Autenticação e Primeiro Download
echo.
echo [3/4] Conectando ao GitHub...
echo.
echo ⚠️  ATENCAO: Para clonar repositorios privados, voce precisa:
echo.
echo OPCAO 1 - Personal Access Token (Recomendado):
echo   1. Acesse: https://github.com/settings/tokens
echo   2. Clique em "Generate new token" - "Generate new token (classic)"
echo   3. Selecione o escopo "repo"
echo   4. Copie o token gerado
echo   5. Cole aqui como senha quando for solicitado
echo.
echo OPCAO 2 - Git Credential Manager (Mais facil):
echo   1. Deixe o Git abrir um popup de login quando pedir
echo   2. Use sua senha do GitHub OU um token pessoal
echo.
pause

echo.
echo Baixando arquivos...
git fetch --all
git reset --hard origin/main

if %errorlevel% neq 0 (
    color 0c
    echo.
    echo [X] FALHA NA AUTENTICACAO!
    echo.
    echo Nao foi possivel acessar o repositorio. Tente:
    echo.
    echo 1. Gere um token em https://github.com/settings/tokens
    echo    - Token (classic) com escopo 'repo'
    echo.
    echo 2. Configure para salvar a senha:
    echo    - git config --global credential.helper wincred
    echo.
    echo 3. Verifique permissoes em https://github.com/settings/keys
    echo.
    pause
    exit
)

echo.
echo ╔═══════════════════════════════════════════╗
echo ║     ✅ TUDO PRONTO! AGORA E SO USAR     ║
echo ╚═══════════════════════════════════════════╝
echo.
echo A partir de agora, para atualizar, basta rodar o arquivo "atualizar.bat".
echo.
pause
