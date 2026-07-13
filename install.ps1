<#
.SYNOPSIS
  One-command installer for trace (Local Context Cloud) on Windows.
.DESCRIPTION
  Checks prerequisites (Node, Docker, Git), installs dependencies, builds the
  project, configures .env, starts Supermemory Local, and launches trace under
  the watchdog supervisor.
#>
$ErrorActionPreference = 'Stop'

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "Missing prerequisite: $cmd. $hint"
  }
}

Write-Host "== trace installer ==" -ForegroundColor Cyan

Need node    "Install from https://nodejs.org"
Need docker  "Install Docker Desktop from https://www.docker.com/products/docker-desktop"
Need git     "Install from https://git-scm.com"

# 1. Dependencies
Write-Host "[1/5] Installing npm dependencies..." -ForegroundColor Yellow
npm install

# 2. Build
Write-Host "[2/5] Building TypeScript..." -ForegroundColor Yellow
npm run build

# 3. Config
Write-Host "[3/5] Configuring .env..." -ForegroundColor Yellow
if (-not (Test-Path .env)) {
  if (Test-Path .env.example) { Copy-Item .env.example .env; Write-Host "  created .env from .env.example" }
  else { Write-Warning "  no .env.example found; skipping" }
} else {
  Write-Host "  .env already exists, leaving it untouched"
}

# 4. Supermemory Local
Write-Host "[4/5] Starting Supermemory Local (docker compose)..." -ForegroundColor Yellow
if (Test-Path docker-compose.yml) {
  docker compose up -d
} else {
  Write-Warning "  docker-compose.yml not found; start Supermemory manually"
}

# 5. Launch
Write-Host "[5/5] Launching trace under watchdog..." -ForegroundColor Yellow
Start-Process -FilePath "npm" -ArgumentList "run","watchdog" -WindowStyle Minimized
Write-Host "trace is starting. Open http://localhost:6769 for the HUD." -ForegroundColor Green
