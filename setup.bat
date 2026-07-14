@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  trace  --  Local Context Cloud
::  Single-file setup / start / stop script for Windows
::
::  Usage:
::    setup.bat              -- full setup + launch
::    setup.bat start        -- start services (skip install)
::    setup.bat stop         -- stop all trace services
::    setup.bat build        -- install deps + compile only
::
::  Optional env overrides (set before running):
::    set LLM_URL=https://openrouter.ai/api/v1
::    set LLM_MODEL=google/gemma-4-31b-it:free
::    set LLM_API_KEY=sk-or-v1-...
::    set WATCH_PATHS=C:\Projects;D:\Work
:: ============================================================

:: Resolve directory where this .bat lives
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

:: ---- Parse command ----
set "CMD=%~1"
if /i "%CMD%"=="stop"  goto :do_stop
if /i "%CMD%"=="start" goto :do_start
if /i "%CMD%"=="build" goto :do_build
goto :do_setup

:: ============================================================
::  STOP
:: ============================================================
:do_stop
echo.
echo   [trace] Stopping all services...
echo.
taskkill /f /im electron.exe >nul 2>&1
echo   [OK] Electron stopped
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":6768 " 2^>nul') do taskkill /f /pid %%a >nul 2>&1
echo   [OK] Backend API stopped (port 6768^)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":6767 " 2^>nul') do taskkill /f /pid %%a >nul 2>&1
docker stop trace-supermemory >nul 2>&1
docker rm   trace-supermemory >nul 2>&1
echo   [OK] Supermemory container stopped
echo.
echo   trace stopped.
echo.
goto :eof

:: ============================================================
::  BUILD  (npm install + tsc)
:: ============================================================
:do_build
echo.
echo   ===============================================
echo          trace  --  Local Context Cloud
echo               build
echo   ===============================================
echo.
cd /d "%ROOT%"
if not exist package.json ( echo   [ERR] Run from the trace repo root. & exit /b 1 )
call :check_node
call :check_git
echo.
echo   [1/2] Installing npm dependencies...
call npm install
if errorlevel 1 ( echo   [ERR] npm install failed. & exit /b 1 )
echo   [OK]  npm packages installed
echo.
echo   [2/2] Compiling TypeScript...
call npm run build
if errorlevel 1 ( echo   [ERR] TypeScript build failed. Run: npm run lint & exit /b 1 )
echo   [OK]  Built to dist/
echo.
echo   Build complete.
echo.
goto :eof

:: ============================================================
::  SETUP  (full first-run)
:: ============================================================
:do_setup
echo.
echo   ===============================================
echo          trace  --  Local Context Cloud
echo              automated setup script
echo   ===============================================
echo.
cd /d "%ROOT%"
if not exist package.json ( echo   [ERR] Run from the trace repo root. & exit /b 1 )

echo   [1/6] Checking Node.js...
call :check_node
if errorlevel 1 exit /b 1

echo   [2/6] Checking Git...
call :check_git

echo   [3/6] Checking Docker...
call :check_docker
if errorlevel 1 exit /b 1

echo.
echo   [4/6] Installing dependencies and building...
call npm install
if errorlevel 1 ( echo   [ERR] npm install failed. & exit /b 1 )
echo   [OK]  npm packages installed
call npm run build
if errorlevel 1 ( echo   [ERR] TypeScript build failed. Run: npm run lint & exit /b 1 )
echo   [OK]  Built to dist/

echo.
echo   [5/6] Configuring .env...
if not exist "%ROOT%\.env" (
    if exist "%ROOT%\.env.example" (
        copy "%ROOT%\.env.example" "%ROOT%\.env" >nul
        echo   [OK]  Created .env from .env.example
    ) else (
        echo   [ERR] .env.example is missing.
        exit /b 1
    )
) else (
    echo   [OK]  .env already exists, leaving existing values untouched
)
if defined LLM_URL     call :set_env_key LLM_URL     "%LLM_URL%"
if defined LLM_MODEL   call :set_env_key LLM_MODEL   "%LLM_MODEL%"
if defined LLM_API_KEY call :set_env_key LLM_API_KEY "%LLM_API_KEY%"
if defined WATCH_PATHS call :set_env_key WATCH_PATHS "%WATCH_PATHS%"
echo   [OK]  .env configured

echo.
echo   [6/6] Configuring .env.docker...
if not exist "%ROOT%\.env.docker" (
    echo # Docker-specific env overrides> "%ROOT%\.env.docker"
    echo   [OK]  Created .env.docker
) else (
    echo   [OK]  .env.docker already exists
)

:: Fall through to start
goto :do_start

:: ============================================================
::  START  (launch Supermemory + backend + Electron)
:: ============================================================
:do_start
echo.
echo   ===============================================
echo    Launching trace...
echo   ===============================================
echo.
cd /d "%ROOT%"

:: Ensure .env exists (start.vbs can be run without setup.bat)
if not exist "%ROOT%\.env" (
    if exist "%ROOT%\.env.example" (
        copy "%ROOT%\.env.example" "%ROOT%\.env" >nul
        echo   [OK]  Created .env from .env.example
    )
)
:: Ensure .env.docker exists (docker-compose.yml requires it)
if not exist "%ROOT%\.env.docker" (
    echo # Docker-specific env overrides> "%ROOT%\.env.docker"
)

echo   -> Starting Supermemory Local (Docker^)...
docker compose up -d --build >nul 2>&1
if errorlevel 1 (
    echo   [!!] docker compose up failed. Docker may not be running.
    echo        Start Docker Desktop and try again.
) else (
    echo   [OK] Supermemory container started
)

echo   -> Waiting for Supermemory on port 6767...
call :wait_for_port 6767 60
if "%PORT_UP%"=="1" (
    echo   [OK] Supermemory is up on :6767
    call :extract_supermemory_key
) else (
    echo   [!!] Supermemory did not respond within 60s.
    echo        trace will run in degraded mode.
)

echo   -> Starting backend (npm start^)...
start "trace-backend" /min cmd /c "cd /d "%ROOT%" && npm start"

echo   -> Waiting for backend API on port 6768...
call :wait_for_port 6768 30
if "%PORT_UP%"=="1" (
    echo   [OK] Backend API is up on :6768
) else (
    echo   [!!] Backend API didn't respond within 30s - overlay may show "Connecting..."
)

echo   -> Launching Electron overlay...
start "" "%ROOT%\node_modules\electron\dist\electron.exe" "%ROOT%\app\main.cjs"
echo   [OK] Electron overlay launched

set "API_PORT=6768"
set "HUD_PORT=6769"
for /f "tokens=2 delims==" %%v in ('findstr /b "API_PORT=" "%ROOT%\.env" 2^>nul') do set "API_PORT=%%v"
for /f "tokens=2 delims==" %%v in ('findstr /b "HUD_PORT=" "%ROOT%\.env" 2^>nul') do set "HUD_PORT=%%v"

echo.
echo   ===============================================
echo    trace is running!
echo   ===============================================
echo.
echo     Overlay  ->  press Alt+X to toggle
echo     Web HUD  ->  http://localhost:%HUD_PORT%
echo     API      ->  http://localhost:%API_PORT%
echo.
echo     Logs     ->  backend.log
echo     Docker   ->  docker logs trace-supermemory
echo     Stop     ->  setup.bat stop
echo.
goto :eof

:: ============================================================
::  SUBROUTINES
:: ============================================================

:check_node
where node >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do echo   [OK]  Node.js %%v
    exit /b 0
)
echo   [!!] Node.js not found.
where winget >nul 2>&1
if errorlevel 1 (
    echo   [ERR] winget not found. Install Node.js 18+ from https://nodejs.org then re-run.
    pause
    exit /b 1
)
echo   -> Installing Node.js LTS via winget...
winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
where node >nul 2>&1
if errorlevel 1 (
    echo   [!!] Node.js installed but not on PATH yet.
    echo        Close this window, open a new one, and re-run setup.bat.
    pause
    exit /b 0
)
exit /b 0

:check_git
where git >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=1,2,3" %%a in ('git --version 2^>nul') do echo   [OK]  %%a %%b %%c
    exit /b 0
)
echo   [!!] Git not found.
where winget >nul 2>&1
if errorlevel 1 (
    echo   [!!] winget not found. Install Git from https://git-scm.com (optional if repo already cloned^).
    exit /b 0
)
echo   -> Installing Git via winget...
winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements
where git >nul 2>&1
if errorlevel 1 (
    echo   [!!] Git installed but not on PATH yet. Restart this window and re-run.
    pause
    exit /b 0
)
exit /b 0

:check_docker
where docker >nul 2>&1
if errorlevel 1 (
    echo   [!!] Docker not found.
    where winget >nul 2>&1
    if errorlevel 1 (
        echo   [ERR] Install Docker Desktop from https://www.docker.com/products/docker-desktop
        pause
        exit /b 1
    )
    echo   -> Installing Docker Desktop via winget...
    winget install --id Docker.DockerDesktop --silent --accept-package-agreements --accept-source-agreements
    echo   [!!] Docker Desktop installed. Start it from the Start Menu, let it fully load, then re-run setup.bat.
    pause
    exit /b 0
)
docker info >nul 2>&1
if not errorlevel 1 (
    echo   [OK]  Docker is running
    exit /b 0
)
echo   [!!] Docker CLI found but Docker Desktop is not running.
echo   -> Attempting to start Docker Desktop...
set "DD_EXE="
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" set "DD_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if exist "%LOCALAPPDATA%\Programs\Docker\Docker\Docker Desktop.exe" set "DD_EXE=%LOCALAPPDATA%\Programs\Docker\Docker\Docker Desktop.exe"
if not defined DD_EXE (
    echo   [!!] Docker Desktop not found at expected path. Start it manually then re-run.
    pause
    exit /b 0
)
start "" "%DD_EXE%"
echo   -> Waiting up to 90s for Docker daemon...
set /a "_dt=0"
:docker_wait
timeout /t 3 /nobreak >nul 2>&1
docker info >nul 2>&1
if not errorlevel 1 goto :docker_ready
set /a "_dt+=3"
if !_dt! lss 90 goto :docker_wait
echo   [!!] Docker Desktop didn't respond in 90s. Make sure it finishes loading then re-run setup.bat.
pause
exit /b 0
:docker_ready
echo   [OK]  Docker Desktop started
exit /b 0

:: wait_for_port PORT TIMEOUT_SECONDS  ->  sets PORT_UP=1 or 0
:wait_for_port
set "PORT_UP=0"
set "_port=%~1"
set /a "_max=%~2"
set /a "_elapsed=0"
:wfp_loop
powershell -NoProfile -Command "try{$t=New-Object Net.Sockets.TcpClient;$t.Connect('127.0.0.1',%_port%);$t.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 ( set "PORT_UP=1" & goto :eof )
timeout /t 2 /nobreak >nul 2>&1
set /a "_elapsed+=2"
if !_elapsed! lss !_max! goto :wfp_loop
goto :eof

:: extract_supermemory_key  -- pulls API key from container logs if not set
:extract_supermemory_key
set "_smkey="
for /f "tokens=2 delims==" %%v in ('findstr /b "SUPERMEMORY_API_KEY=" "%ROOT%\.env" 2^>nul') do set "_smkey=%%v"
if defined _smkey goto :eof
echo   -> Looking for Supermemory API key in container logs...
timeout /t 3 /nobreak >nul 2>&1
for /f "delims=" %%L in ('docker logs trace-supermemory 2^>^&1') do (
    echo %%L | findstr /i "api.key" >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=2 delims==: " %%k in ("%%L") do (
            if not "%%k"=="" (
                call :set_env_key SUPERMEMORY_API_KEY "%%k"
                echo   [OK]  SUPERMEMORY_API_KEY extracted and written to .env
                goto :eof
            )
        )
    )
)
echo   [!!] Could not auto-detect Supermemory API key.
echo        Run: docker logs trace-supermemory ^| findstr /i key
echo        Then set in .env: SUPERMEMORY_API_KEY=^<your-key^>
goto :eof

:: set_env_key KEY VALUE  -- upserts KEY=VALUE in .env
:set_env_key
set "_k=%~1"
set "_v=%~2"
if "%_v%"=="" goto :eof
set "_tmp=%ROOT%\.env.tmp"
set "_found=0"
(for /f "usebackq delims=" %%L in ("%ROOT%\.env") do (
    set "_line=%%L"
    echo !_line! | findstr /b "%_k%=" >nul 2>&1
    if not errorlevel 1 (
        echo %_k%=%_v%
        set "_found=1"
    ) else (
        echo !_line!
    )
)) > "%_tmp%"
if "%_found%"=="0" echo %_k%=%_v% >> "%_tmp%"
move /y "%_tmp%" "%ROOT%\.env" >nul
goto :eof
