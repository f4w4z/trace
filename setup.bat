@echo off
setlocal enabledelayedexpansion
title Trace — Setup
color 0B

echo.
echo  ============================================
echo    trace — Local Context Cloud Setup
echo  ============================================
echo.

:: -----------------------------------------------------------
:: 1. Check Node.js
:: -----------------------------------------------------------
echo  [1/7] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Node.js is not installed or not in PATH.
    echo         Download LTS from https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo         Found %%v

:: -----------------------------------------------------------
:: 2. Check Docker Desktop
:: -----------------------------------------------------------
echo  [2/7] Checking Docker Desktop...
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Docker is not installed or not in PATH.
    echo         Download from https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Docker Desktop is not running.
    echo         Start Docker Desktop and run setup.bat again.
    echo.
    pause
    exit /b 1
)
echo         Docker is running

:: -----------------------------------------------------------
:: 3. Create .env from .env.example if missing
:: -----------------------------------------------------------
echo  [3/7] Configuring environment...
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo         Created .env from .env.example
    ) else (
        echo  ERROR: No .env.example found. Repository may be corrupt.
        pause
        exit /b 1
    )
) else (
    echo         .env already exists
)

:: -----------------------------------------------------------
:: 4. Configure Supermemory API key (.env.docker)
:: -----------------------------------------------------------
echo  [4/7] Configuring Supermemory API key...

:: Check if .env.docker already has a real key
set "HAS_KEY=0"
if exist ".env.docker" (
    findstr /r "^[A-Z_]*API_KEY=." ".env.docker" >nul 2>&1
    if !errorlevel! equ 0 set "HAS_KEY=1"
)

if "!HAS_KEY!"=="0" (
    echo.
    echo  Supermemory needs an LLM API key to function.
    echo  Supported: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY
    echo.
    set /p "SM_KEY=  Enter your GROQ API key (or other provider key): "
    if "!SM_KEY!"=="" (
        echo.
        echo  ERROR: No API key provided. Supermemory will fail to start.
        echo         You can manually edit .env.docker later.
        echo.
        (echo # Docker-specific env overrides) > ".env.docker"
        (echo # Add your API key below:) >> ".env.docker"
        (echo # GROQ_API_KEY=your_key_here) >> ".env.docker"
    ) else (
        echo  Which provider is this key for?
        echo    1. GROQ        (default)
        echo    2. OPENAI
        echo    3. ANTHROPIC
        echo    4. GEMINI
        set /p "PROVIDER_CHOICE=  Enter choice [1]: "
        if "!PROVIDER_CHOICE!"=="" set "PROVIDER_CHOICE=1"
        if "!PROVIDER_CHOICE!"=="1" set "KEY_NAME=GROQ_API_KEY"
        if "!PROVIDER_CHOICE!"=="2" set "KEY_NAME=OPENAI_API_KEY"
        if "!PROVIDER_CHOICE!"=="3" set "KEY_NAME=ANTHROPIC_API_KEY"
        if "!PROVIDER_CHOICE!"=="4" set "KEY_NAME=GEMINI_API_KEY"
        if not defined KEY_NAME set "KEY_NAME=GROQ_API_KEY"
        (echo # Docker-specific env overrides) > ".env.docker"
        (echo !KEY_NAME!=!SM_KEY!) >> ".env.docker"
        echo         Saved !KEY_NAME! to .env.docker
    )
) else (
    echo         .env.docker already configured
)

:: -----------------------------------------------------------
:: 5. Install npm dependencies
:: -----------------------------------------------------------
echo  [5/7] Installing dependencies (this may take a minute)...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: npm install failed. Check the output above.
    echo.
    pause
    exit /b 1
)
echo         Dependencies installed

:: Verify Electron binary exists
if not exist "node_modules\electron\dist\electron.exe" (
    echo         Electron binary missing — running electron install...
    call npx electron-install
    if not exist "node_modules\electron\dist\electron.exe" (
        echo.
        echo  WARNING: Electron binary could not be downloaded.
        echo           Try running 'npm install electron' manually.
        echo.
    )
)

:: -----------------------------------------------------------
:: 6. Build TypeScript
:: -----------------------------------------------------------
echo  [6/7] Building TypeScript...
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: TypeScript build failed. Check the output above.
    echo.
    pause
    exit /b 1
)
echo         Build complete

:: -----------------------------------------------------------
:: 7. Build Docker image
:: -----------------------------------------------------------
echo  [7/7] Building Supermemory Docker image (first time may take 2-3 min)...
docker compose build
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Docker build failed. Check the output above.
    echo.
    pause
    exit /b 1
)
echo         Docker image ready

:: -----------------------------------------------------------
:: Done — Launch!
:: -----------------------------------------------------------
echo.
echo  ============================================
echo    Setup complete! Launching Trace...
echo  ============================================
echo.

:: Launch via start.vbs (handles Docker Compose up + Electron)
wscript.exe "%~dp0start.vbs"

echo  Trace is starting in the background.
echo  Look for the tray icon — press Alt+X to open the overlay.
echo.
timeout /t 5
