@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Trace — Setup
color 0B

set "OK=  ✓"
set "OOPS=  Hmm, that didn't work."
set "LOG=%~dp0setup.log"

cls
echo.
echo   Welcome to Trace 👋
echo   Let's get everything set up — should take about 5 minutes.
echo.

:: =================================================================
::  1. Check Node.js
:: =================================================================
echo   1. Checking for Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   %OOPS%
    echo   Trace needs Node.js, which isn't installed yet.
    echo.
    echo     - Go to https://nodejs.org/
    echo     - Download the version marked "LTS" and install it
    echo     - Then run this setup again
    echo.
    pause
    exit /b 1
)
echo   %OK% Node.js found
echo.

:: =================================================================
::  2. Check Docker Desktop
:: =================================================================
echo   2. Checking for Docker Desktop...
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo   %OOPS%
    echo   Trace needs Docker Desktop, which isn't installed yet.
    echo.
    echo     - Go to https://www.docker.com/products/docker-desktop/
    echo     - Download and install it, then open it once
    echo     - Then run this setup again
    echo.
    pause
    exit /b 1
)
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo   %OOPS%
    echo   Docker Desktop is installed but not open yet.
    echo   Open Docker Desktop, wait a few seconds, then try again.
    echo.
    pause
    exit /b 1
)
echo   %OK% Docker Desktop is running
echo.

:: =================================================================
::  3. Create .env from .env.example if missing
:: =================================================================
echo   3. Setting up your configuration...
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
    ) else (
        echo   %OOPS%
        echo   A required file is missing from this folder.
        echo   Try downloading Trace again.
        echo.
        pause
        exit /b 1
    )
)
echo   %OK% Configuration ready
echo.

:: =================================================================
::  4. Configure Supermemory API key (.env.docker)
:: =================================================================
echo   4. Connecting your AI key...

set "HAS_KEY=0"
if exist ".env.docker" (
    findstr /r "^[A-Z_]*API_KEY=." ".env.docker" >nul 2>&1
    if !errorlevel! equ 0 set "HAS_KEY=1"
)

if "!HAS_KEY!"=="0" (
    echo   This lets Trace understand and organize your notes.
    echo   Free keys: console.groq.com  ^|  platform.openai.com
    echo.
    set /p "SM_KEY=  Paste a key, or just press Enter to skip:  "

    if "!SM_KEY!"=="" (
        echo   Skipped — you can add one later by editing .env.docker
        (echo # Add your API key below, then remove the # in front of it:) > ".env.docker"
        (echo # GROQ_API_KEY=your_key_here) >> ".env.docker"
    ) else (
        set "PROVIDER_CHOICE="
        set /p "PROVIDER_CHOICE=  Groq, OpenAI, Anthropic, or Gemini? [Groq]:  "
        if /i "!PROVIDER_CHOICE!"=="" set "KEY_NAME=GROQ_API_KEY"
        if /i "!PROVIDER_CHOICE!"=="groq" set "KEY_NAME=GROQ_API_KEY"
        if /i "!PROVIDER_CHOICE!"=="openai" set "KEY_NAME=OPENAI_API_KEY"
        if /i "!PROVIDER_CHOICE!"=="anthropic" set "KEY_NAME=ANTHROPIC_API_KEY"
        if /i "!PROVIDER_CHOICE!"=="gemini" set "KEY_NAME=GEMINI_API_KEY"
        if not defined KEY_NAME set "KEY_NAME=GROQ_API_KEY"
        (echo # Docker-specific env overrides) > ".env.docker"
        (echo !KEY_NAME!=!SM_KEY!) >> ".env.docker"
        echo   %OK% Key saved

        :: Also configure the app's built-in Q&A to use the same key
        call :configure_llm "!KEY_NAME!" "!SM_KEY!"
    )
) else (
    echo   %OK% Already connected
    :: If .env exists but LLM is not configured, try to auto-detect from .env.docker
    call :ensure_llm_from_docker
)
echo.

:: =================================================================
::  5. Install npm dependencies
:: =================================================================
echo   5. Downloading components (about a minute)...
call npm install >"%LOG%" 2>&1
if %errorlevel% neq 0 (
    echo   %OOPS%
    echo   Check your internet connection and try again.
    echo   Details were saved to setup.log if you want to look.
    echo.
    pause
    exit /b 1
)
echo   %OK% Done

if not exist "node_modules\electron\dist\electron.exe" (
    if exist "node_modules\electron\install.js" (
        call node "node_modules\electron\install.js" >>"%LOG%" 2>&1
    )
)
echo.

:: =================================================================
::  6. Build TypeScript
:: =================================================================
echo   6. Getting Trace ready...
call npm run build >>"%LOG%" 2>&1
if %errorlevel% neq 0 (
    echo   %OOPS%
    echo   Details were saved to setup.log — try running setup again.
    echo.
    pause
    exit /b 1
)
echo   %OK% Ready
echo.

:: =================================================================
::  7. Build Docker image
:: =================================================================
echo   7. Setting up the background service (2-3 min, first time only)...
docker compose build >>"%LOG%" 2>&1
if %errorlevel% neq 0 (
    echo   %OOPS%
    echo   Make sure Docker Desktop is open, then try again.
    echo   Details were saved to setup.log if you want to look.
    echo.
    pause
    exit /b 1
)
echo   %OK% Done
echo.

:: =================================================================
::  Done — Launch!
:: =================================================================
echo   You're all set! Launching Trace...
echo.

wscript.exe "%~dp0start.vbs"

echo   Look for the Trace icon in your system tray.
echo   Press Alt+X anytime to open it.
echo.
timeout /t 5
goto :eof

:: =================================================================
::  Subroutines
:: =================================================================

:configure_llm
:: %1 = key name (e.g. GROQ_API_KEY), %2 = key value
set "_llm_name=%~1"
set "_llm_key=%~2"
set "_llm_url="
set "_llm_model="

if /i "!_llm_name!"=="GROQ_API_KEY" (
    set "_llm_url=https://api.groq.com/openai/v1"
    set "_llm_model=llama-3.3-70b-versatile"
)
if /i "!_llm_name!"=="OPENAI_API_KEY" (
    set "_llm_url=https://api.openai.com/v1"
    set "_llm_model=gpt-4o"
)
if /i "!_llm_name!"=="GEMINI_API_KEY" (
    set "_llm_url=https://generativelanguage.googleapis.com/v1beta/openai"
    set "_llm_model=gemini-2.0-flash"
)

if not defined _llm_url goto :eof

powershell -NoProfile -Command "$f = Get-Content '.env' -Raw; $f = $f -replace '(?m)^LLM_URL=.*$', 'LLM_URL=!_llm_url!'; $f = $f -replace '(?m)^LLM_MODEL=.*$', 'LLM_MODEL=!_llm_model!'; $f = $f -replace '(?m)^LLM_API_KEY=.*$', 'LLM_API_KEY=!_llm_key!'; Set-Content '.env' $f -NoNewline"
echo   %OK% Q&A enabled with !_llm_model!
goto :eof

:ensure_llm_from_docker
:: If .env LLM vars are empty but .env.docker has a key, configure LLM
if not exist ".env" goto :eof
findstr /r "^LLM_URL=https://" ".env" >nul 2>&1
if !errorlevel! equ 0 goto :eof

:: LLM not configured — try to detect from .env.docker
if not exist ".env.docker" goto :eof
set "_detected_key="
set "_detected_name="
for /f "tokens=1,* delims==" %%a in ('findstr /r "^[A-Z_]*API_KEY=." ".env.docker"') do (
    set "_detected_name=%%a"
    set "_detected_key=%%b"
)
if not defined _detected_key goto :eof
call :configure_llm "!_detected_name!" "!_detected_key!"
goto :eof
