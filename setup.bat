@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Trace — Setup
color 0B

set "OK=   ✓"
set "NO=   ✗"
set "IN=   →"

cls
echo.
echo   ╔══════════════════════════════════════════════════════════════╗
echo   ║                                                                ║
echo   ║                     Welcome to Trace!                        ║
echo   ║                                                                ║
echo   ║        Let's get everything set up on your computer.         ║
echo   ║             This usually takes about 5 minutes.               ║
echo   ║                                                                ║
echo   ╚══════════════════════════════════════════════════════════════╝
echo.

:: =================================================================
::  1. Check Node.js
:: =================================================================
echo   Step 1 of 7 — Checking for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   %NO% We couldn't find Node.js on your computer.
    echo.
    echo        Trace needs Node.js to run. It's free and only
    echo        takes a minute to install:
    echo.
    echo          1. Go to https://nodejs.org/
    echo          2. Download the version that says "LTS"
    echo          3. Run the installer ^(the defaults are fine^)
    echo          4. Come back and run this setup again
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo   %OK% Node.js is ready to go  ^(%NODE_VER%^)
echo.

:: =================================================================
::  2. Check Docker Desktop
:: =================================================================
echo   Step 2 of 7 — Checking for Docker Desktop
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo   %NO% We couldn't find Docker Desktop on your computer.
    echo.
    echo        Trace uses Docker to run some things safely in the
    echo        background. It's free and easy to install:
    echo.
    echo          1. Go to https://www.docker.com/products/docker-desktop/
    echo          2. Download and install Docker Desktop
    echo          3. Open it once so it can finish setting up
    echo          4. Come back and run this setup again
    echo.
    pause
    exit /b 1
)
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo   %NO% Docker Desktop is installed, but it isn't running yet.
    echo.
    echo        Please open Docker Desktop, wait for it to say
    echo        "running," and then try this setup again.
    echo.
    pause
    exit /b 1
)
echo   %OK% Docker Desktop is up and running
echo.

:: =================================================================
::  3. Create .env from .env.example if missing
:: =================================================================
echo   Step 3 of 7 — Setting up your configuration
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo   %OK% Created your settings file
    ) else (
        echo   %NO% Something's missing from this download.
        echo.
        echo        A required file ^(.env.example^) wasn't found.
        echo        Try downloading Trace again — the files may be
        echo        incomplete.
        echo.
        pause
        exit /b 1
    )
) else (
    echo   %OK% Your settings are already in place
)
echo.

:: =================================================================
::  4. Configure Supermemory API key (.env.docker)
:: =================================================================
echo   Step 4 of 7 — Connecting your AI key

set "HAS_KEY=0"
if exist ".env.docker" (
    findstr /r "^[A-Z_]*API_KEY=." ".env.docker" >nul 2>&1
    if !errorlevel! equ 0 set "HAS_KEY=1"
)

if "!HAS_KEY!"=="0" (
    echo   %IN% Trace's memory feature needs a key from an AI provider
    echo        so it can understand and organize your notes.
    echo.
    echo        If you don't have one yet, you can get a free key from:
    echo          • Groq       — console.groq.com
    echo          • OpenAI     — platform.openai.com
    echo          • Anthropic  — console.anthropic.com
    echo          • Google     — aistudio.google.com
    echo.
    echo        ^(You can skip this for now and add it later if you'd like.^)
    echo.
    set /p "SM_KEY=        Paste your API key here, or press Enter to skip:  "

    if "!SM_KEY!"=="" (
        echo.
        echo   %IN% No problem — you can add a key later.
        echo        Just open the ".env.docker" file in this folder
        echo        and follow the instructions inside.
        echo        ^(Note: the memory feature won't work until you do.^)
        (echo # Add your API key below, then remove the # in front of it:) > ".env.docker"
        (echo # GROQ_API_KEY=your_key_here) >> ".env.docker"
    ) else (
        echo.
        echo        Which provider is this key from?
        echo          1^) Groq        ^(default^)
        echo          2^) OpenAI
        echo          3^) Anthropic
        echo          4^) Google Gemini
        echo.
        set /p "PROVIDER_CHOICE=        Type a number and press Enter [1]:  "
        if "!PROVIDER_CHOICE!"=="" set "PROVIDER_CHOICE=1"
        if "!PROVIDER_CHOICE!"=="1" set "KEY_NAME=GROQ_API_KEY"
        if "!PROVIDER_CHOICE!"=="2" set "KEY_NAME=OPENAI_API_KEY"
        if "!PROVIDER_CHOICE!"=="3" set "KEY_NAME=ANTHROPIC_API_KEY"
        if "!PROVIDER_CHOICE!"=="4" set "KEY_NAME=GEMINI_API_KEY"
        if not defined KEY_NAME set "KEY_NAME=GROQ_API_KEY"
        (echo # Docker-specific env overrides) > ".env.docker"
        (echo !KEY_NAME!=!SM_KEY!) >> ".env.docker"
        echo.
        echo   %OK% Great, your key is saved and ready to use
    )
) else (
    echo   %OK% Your AI key is already set up
)
echo.

:: =================================================================
::  5. Install npm dependencies
:: =================================================================
echo   Step 5 of 7 — Downloading a few components
echo   %IN% This can take a minute or two — thanks for your patience!
call npm install
if %errorlevel% neq 0 (
    echo.
    echo   %NO% Something went wrong while downloading components.
    echo.
    echo        Scroll up to see the full error message. Common fixes:
    echo          • Check your internet connection
    echo          • Make sure you have enough free disk space
    echo          • Try running this setup again
    echo.
    pause
    exit /b 1
)
echo   %OK% All set

if not exist "node_modules\electron\dist\electron.exe" (
    echo   %IN% Grabbing one more piece...
    call npx electron-install
    if not exist "node_modules\electron\dist\electron.exe" (
        echo   %NO% That last piece didn't download properly.
        echo        Try closing this window and running setup.bat again.
    ) else (
        echo   %OK% Got it
    )
)
echo.

:: =================================================================
::  6. Build TypeScript
:: =================================================================
echo   Step 6 of 7 — Getting Trace ready
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo   %NO% Something went wrong while preparing Trace.
    echo        Scroll up to see the full error message, or try
    echo        running this setup again.
    echo.
    pause
    exit /b 1
)
echo   %OK% Trace is ready
echo.

:: =================================================================
::  7. Build Docker image
:: =================================================================
echo   Step 7 of 7 — Setting up the background service
echo   %IN% First-time setup can take 2-3 minutes — almost there!
docker compose build
if %errorlevel% neq 0 (
    echo.
    echo   %NO% Something went wrong setting up the background service.
    echo.
    echo        Make sure Docker Desktop is open and running, then
    echo        try this setup again.
    echo.
    pause
    exit /b 1
)
echo   %OK% All done
echo.

:: =================================================================
::  Done — Launch!
:: =================================================================
echo   ╔══════════════════════════════════════════════════════════════╗
echo   ║                                                                ║
echo   ║              You're all set! Launching Trace...              ║
echo   ║                                                                ║
echo   ╚══════════════════════════════════════════════════════════════╝
echo.

wscript.exe "%~dp0start.vbs"

echo   %IN% Trace is starting up in the background.
echo        Look for its icon in your system tray, and press
echo        Alt+X anytime to open it.
echo.
timeout /t 5
