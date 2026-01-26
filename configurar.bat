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
    git remote add origin https://github.com/cezarlugullo/AnswerHunter-.git
    echo [OK] Repositorio configurado.
) else (
    echo [OK] Repositorio ja configurado.
)

:: 3. Autenticação e Primeiro Download
echo.
echo [3/4] Conectando ao GitHub...
echo.
echo ⚠️  ATENCAO: Vai abrir uma janela pedindo login no GitHub.
echo ⚠️  Faca login com sua conta para autorizar o acesso.
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
    echo Nao foi possivel acessar o repositorio.
    echo Verifique se voce tem permissao de acesso ao repositorio privado.
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
