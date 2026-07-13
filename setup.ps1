<#
.SYNOPSIS
  Zero-to-running setup for trace on a fresh Windows machine.

.DESCRIPTION
  Checks and installs all prerequisites (Node.js, Docker Desktop, Git),
  installs npm dependencies, builds TypeScript, configures .env,
  starts Supermemory Local via Docker, extracts the API key automatically,
  and launches the backend + Electron overlay.

  Run from the repo root (where package.json lives):
    .\setup.ps1

  Flags:
    -SkipNode       Skip Node.js install check
    -SkipDocker     Skip Docker Desktop install check
    -SkipApp        Don't launch the Electron overlay at the end
    -DevMode        Start backend with `npm run dev` (hot-reload) instead of compiled dist
    -LLMUrl         OpenAI-compatible base URL for AI Q&A  (e.g. https://api.openai.com/v1)
    -LLMModel       Model name                              (e.g. gpt-4o)
    -LLMApiKey      API key for the LLM endpoint
    -WatchPaths     Semicolon-separated paths to monitor    (e.g. "C:\Projects;D:\Work")
#>

param(
  [switch]$SkipNode,
  [switch]$SkipDocker,
  [switch]$SkipApp,
  [switch]$DevMode,
  [string]$LLMUrl     = 'https://openrouter.ai/api/v1',
  [string]$LLMModel   = 'tencent/hy3:free',
  [string]$LLMApiKey  = '',        # Pass your OpenRouter API key via -LLMApiKey
  [string]$WatchPaths = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------

function Title($msg) {
  Write-Host ""
  Write-Host "  $msg" -ForegroundColor Cyan
  Write-Host ("  " + ("─" * ($msg.Length))) -ForegroundColor DarkGray
}

function Ok($msg)   { Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "   ->   $msg" -ForegroundColor Gray }
function Warn($msg) { Write-Host "  [!!]  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  [XX]  $msg" -ForegroundColor Red; exit 1 }

function Has($cmd) {
  return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function RefreshPath {
  $env:PATH = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function WingetInstall($id, $label) {
  Info "Installing $label via winget..."
  winget install --id $id --silent --accept-package-agreements --accept-source-agreements
  RefreshPath
}

function WaitForPort([int]$port, [int]$timeoutSec = 120, [string]$label = "service") {
  Info "Waiting for $label on :$port (up to ${timeoutSec}s)..."
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $tcp.Connect('127.0.0.1', $port)
      $tcp.Close()
      Ok "$label is up on :$port"
      return $true
    } catch { Start-Sleep -Milliseconds 2000 }
  }
  return $false
}

function GetEnvKey([string]$key) {
  $line = Get-Content ".env" -ErrorAction SilentlyContinue |
          Where-Object { $_ -match "^$key=" } |
          Select-Object -First 1
  if ($line) { return ($line -split '=', 2)[1].Trim() }
  return ''
}

function SetEnvKey([string]$key, [string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return }
  $raw = Get-Content ".env" -Raw -ErrorAction SilentlyContinue
  if ($raw -match "(?m)^$key=") {
    $raw = [regex]::Replace($raw, "(?m)^$key=.*", "$key=$value")
  } else {
    $raw = $raw.TrimEnd() + "`n$key=$value`n"
  }
  Set-Content ".env" $raw -NoNewline
}

# ---------------------------------------------------------------------------
#  Banner
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Magenta
Write-Host "         trace  --  Local Context Cloud          " -ForegroundColor Magenta
Write-Host "              automated setup script             " -ForegroundColor DarkGray
Write-Host "  ===============================================" -ForegroundColor Magenta
Write-Host ""

if (-not (Test-Path "package.json")) {
  Fail "Run this script from the trace repo root (where package.json lives)."
}

# ---------------------------------------------------------------------------
#  1. Node.js (>= 18)
# ---------------------------------------------------------------------------

Title "1/6  Node.js"

if (-not $SkipNode) {
  $needsNode = $false

  if (Has 'node') {
    $verStr = (node --version) -replace 'v', ''
    $major  = [int]($verStr.Split('.')[0])
    if ($major -ge 18) {
      Ok "Node.js $verStr already installed"
    } else {
      Warn "Node.js $verStr found but >= 18 is required. Upgrading..."
      $needsNode = $true
    }
  } else {
    Info "Node.js not found."
    $needsNode = $true
  }

  if ($needsNode) {
    if (Has 'winget') {
      WingetInstall 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    } else {
      Fail "winget not available. Install Node.js 18+ manually from https://nodejs.org then re-run."
    }

    if (-not (Has 'node')) {
      Warn "Node.js was installed but is not yet on PATH."
      Warn "Please close this terminal, open a new one, and re-run setup.ps1."
      exit 0
    }
    Ok "Node.js $(node --version) installed"
  }
} else {
  Info "Skipping Node.js check (-SkipNode)"
}

# ---------------------------------------------------------------------------
#  2. Git
# ---------------------------------------------------------------------------

Title "2/6  Git"

if (Has 'git') {
  Ok "$(git --version) already installed"
} else {
  Info "Git not found."
  if (Has 'winget') {
    WingetInstall 'Git.Git' 'Git'
    if (-not (Has 'git')) {
      Warn "Git installed but not yet on PATH. Restart this terminal and re-run setup.ps1."
      exit 0
    }
    Ok "Git installed"
  } else {
    Warn "winget not found. If you already have the repo cloned, Git is not strictly required. Continuing..."
  }
}

# ---------------------------------------------------------------------------
#  3. Docker Desktop
# ---------------------------------------------------------------------------

Title "3/6  Docker Desktop"

$dockerReady = $false

if (-not $SkipDocker) {

  if (Has 'docker') {
    $null = docker info 2>&1
    if ($LASTEXITCODE -eq 0) {
      Ok "Docker is running ($(docker --version))"
      $dockerReady = $true
    } else {
      Warn "Docker CLI found but Docker Desktop is not running."
      Info "Attempting to start Docker Desktop..."

      $ddExe = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe"
      ) | Where-Object { Test-Path $_ } | Select-Object -First 1

      if ($ddExe) {
        Start-Process $ddExe
        Info "Waiting up to 90s for Docker daemon..."
        for ($i = 0; $i -lt 45; $i++) {
          Start-Sleep 2
          $null = docker info 2>&1
          if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
        }
        if ($dockerReady) {
          Ok "Docker Desktop started"
        } else {
          Warn "Docker Desktop didn't respond in time."
          Warn "Make sure it finishes loading (check the system tray), then re-run setup.ps1."
          exit 0
        }
      } else {
        Warn "Docker Desktop executable not found at the expected path."
        Info "Installing Docker Desktop via winget..."
        WingetInstall 'Docker.DockerDesktop' 'Docker Desktop'
        Warn "Docker Desktop installed. Start it from the Start Menu, wait for it to fully load, then re-run setup.ps1."
        exit 0
      }
    }
  } else {
    Info "Docker not found. Installing Docker Desktop via winget..."
    if (Has 'winget') {
      WingetInstall 'Docker.DockerDesktop' 'Docker Desktop'
      Warn "Docker Desktop installed. Start it from the Start Menu, wait for it to fully load, then re-run setup.ps1."
      exit 0
    } else {
      Fail "Install Docker Desktop from https://www.docker.com/products/docker-desktop then re-run."
    }
  }

} else {
  Info "Skipping Docker check (-SkipDocker)"
  $dockerReady = $false
}

# ---------------------------------------------------------------------------
#  4. npm install + TypeScript build
# ---------------------------------------------------------------------------

Title "4/6  Dependencies & build"

Info "Running npm install..."
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
Ok "npm packages installed"

Info "Compiling TypeScript..."
npm run build
if ($LASTEXITCODE -ne 0) { Fail "TypeScript build failed. Run: npm run lint" }
Ok "Built to dist/"

# ---------------------------------------------------------------------------
#  5. .env configuration
# ---------------------------------------------------------------------------

Title "5/6  Environment (.env)"

if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    Ok "Created .env from .env.example"
  } else {
    Fail ".env.example is missing — cannot create .env."
  }
} else {
  Ok ".env already exists, leaving existing values untouched"
}

# Apply any CLI-supplied overrides
if ($LLMUrl)    { SetEnvKey 'LLM_URL'     $LLMUrl;    Info "Set LLM_URL=$LLMUrl" }
if ($LLMModel)  { SetEnvKey 'LLM_MODEL'   $LLMModel;  Info "Set LLM_MODEL=$LLMModel" }
if ($LLMApiKey) { SetEnvKey 'LLM_API_KEY' $LLMApiKey; Info "Set LLM_API_KEY=<hidden>" }

if ($WatchPaths) {
  SetEnvKey 'WATCH_PATHS' $WatchPaths
  Info "Set WATCH_PATHS=$WatchPaths"
} else {
  $existing = GetEnvKey 'WATCH_PATHS'
  if ([string]::IsNullOrWhiteSpace($existing)) {
    # Default to the parent directory of the repo
    $defaultWatch = Split-Path (Get-Location).Path -Parent
    SetEnvKey 'WATCH_PATHS' $defaultWatch
    Info "Defaulted WATCH_PATHS=$defaultWatch  (override with -WatchPaths)"
  }
}

Ok ".env configured"

# ---------------------------------------------------------------------------
#  6. Supermemory Local
# ---------------------------------------------------------------------------

Title "6/6  Supermemory Local (Docker)"

if ($dockerReady) {
  # Check if container already exists and is running
  $running = $false
  try {
    $state = docker inspect --format '{{.State.Running}}' trace-supermemory 2>&1
    if ($state -eq 'true') { $running = $true }
  } catch {}

  if ($running) {
    Ok "trace-supermemory container already running"
  } else {
    Info "Starting Supermemory Local (first run builds the image — this can take a few minutes)..."
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { Fail "docker compose up failed. Check Docker Desktop is fully loaded." }
  }

  $smUp = WaitForPort 6767 180 "Supermemory Local"

  if ($smUp) {
    # Auto-extract the API key from container logs
    $existingKey = GetEnvKey 'SUPERMEMORY_API_KEY'
    if ([string]::IsNullOrWhiteSpace($existingKey)) {
      Info "Looking for Supermemory API key in container logs..."
      Start-Sleep 3
      $logs = docker logs trace-supermemory 2>&1 | Out-String
      $m = [regex]::Match($logs, '(?i)(api[_\-\s]?key[=:\s]+)([A-Za-z0-9_\-]{20,})')
      if ($m.Success) {
        $key = $m.Groups[2].Value.Trim()
        SetEnvKey 'SUPERMEMORY_API_KEY' $key
        Ok "SUPERMEMORY_API_KEY extracted and written to .env"
      } else {
        Warn "Could not auto-detect the Supermemory API key in logs."
        Warn "Run:  docker logs trace-supermemory | Select-String key"
        Warn "Then set in .env:  SUPERMEMORY_API_KEY=<your-key>"
      }
    } else {
      Ok "SUPERMEMORY_API_KEY already set in .env"
    }
  } else {
    Warn "Supermemory did not respond on :6767 within 3 minutes."
    Warn "trace will run in degraded mode (local JSONL fallback)."
    Warn "Check:  docker logs trace-supermemory"
  }

} else {
  Warn "Docker not ready — skipping Supermemory startup."
  Warn "Re-run setup.ps1 after Docker Desktop is running to complete this step."
}

# ---------------------------------------------------------------------------
#  Launch
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor DarkGray
Write-Host "   Launching trace..." -ForegroundColor Green
Write-Host "  ===============================================" -ForegroundColor DarkGray
Write-Host ""

$backendCmd  = if ($DevMode) { 'npm run dev' } else { 'npm start' }
$backendMode = if ($DevMode) { 'dev (hot-reload)' } else { 'production' }
Info "Starting backend in $backendMode mode (minimised window)..."

Start-Process powershell `
  -ArgumentList "-NoExit", "-Command", $backendCmd `
  -WorkingDirectory (Get-Location).Path `
  -WindowStyle Minimized

# Wait for the API to come up
$apiPort = GetEnvKey 'API_PORT'
if ([string]::IsNullOrWhiteSpace($apiPort)) { $apiPort = '6768' }
$apiUp = WaitForPort ([int]$apiPort) 30 "trace API"
if (-not $apiUp) {
  Warn "Backend API didn't respond on :$apiPort within 30s."
  Warn "The overlay will still open but may show 'Connecting...' briefly."
}

if (-not $SkipApp) {
  Info "Launching Electron overlay..."
  Start-Process powershell `
    -ArgumentList "-NoExit", "-Command", "npm run app" `
    -WorkingDirectory (Get-Location).Path `
    -WindowStyle Normal
  Ok "Electron overlay launched"
}

# ---------------------------------------------------------------------------
#  Done
# ---------------------------------------------------------------------------

$hudPort = GetEnvKey 'HUD_PORT'
if ([string]::IsNullOrWhiteSpace($hudPort)) { $hudPort = '6769' }

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host "   trace is running!" -ForegroundColor Green
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "    Overlay  ->  press Alt+X to toggle" -ForegroundColor White
Write-Host "    Web HUD  ->  http://localhost:$hudPort" -ForegroundColor White
Write-Host "    API      ->  http://localhost:$apiPort" -ForegroundColor White
Write-Host ""
Write-Host "    Logs     ->  backend.log" -ForegroundColor DarkGray
Write-Host "    Docker   ->  docker logs trace-supermemory" -ForegroundColor DarkGray
Write-Host "    Stop     ->  close the backend terminal window, or run stop.vbs" -ForegroundColor DarkGray
Write-Host ""
