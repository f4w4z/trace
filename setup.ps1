#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Trace — full setup on a fresh Windows PC.
.DESCRIPTION
    Installs Node.js, WSL (Ubuntu), Supermemory Local, npm dependencies,
    builds the project, and creates .env from .env.example.
    Skips any step that is already satisfied.
    Run from the project root as Administrator.
#>
param(
    [switch]$SkipWSL,
    [switch]$SkipSupermemory,
    [switch]$SkipBuild,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Skipped = @()
$Installed = @()

function Write-Step($msg)  { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-OK($msg)    { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Skip($msg)  { Write-Host "   SKIP: $msg" -ForegroundColor DarkGray; $script:Skipped += $msg }
function Write-Warn($msg)  { Write-Host "   WARN: $msg" -ForegroundColor Yellow }
function Write-Done($msg)  { $script:Installed += $msg }

# ── Admin check ───────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "This script must be run as Administrator." -ForegroundColor Red
    Write-Host "Right-click setup.bat and choose 'Run as administrator'." -ForegroundColor Yellow
    exit 1
}

# ── 1. Git ────────────────────────────────────────────────────────────────
Write-Step "Checking Git"
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    $gitVer = (git --version) -replace 'git version ',''
    Write-OK "Git $gitVer"
} else {
    Write-Warn "Git not found. Installing via winget..."
    winget install Git.Git --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Done "Git installed"
}

# ── 2. Node.js ────────────────────────────────────────────────────────────
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node -and -not $Force) {
    $ver = (node -v) -replace 'v',''
    if ([version]$ver -ge [version]"20.0.0") {
        Write-OK "Node.js $ver"
    } else {
        Write-Warn "Node.js $ver is too old (need >=20). Upgrading..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        Write-Done "Node.js upgraded to LTS"
    }
} elseif (-not $node) {
    Write-Host "   Node.js not found. Installing via winget..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Done "Node.js installed"
} else {
    Write-OK "Node.js $((node -v)) (--Force not set, skipping)"
}

# ── 3. npm dependencies ───────────────────────────────────────────────────
Write-Step "Checking npm dependencies"
$nodeModules = Join-Path $Root "node_modules"
$pkgLock = Join-Path $Root "package-lock.json"
$needsInstall = $false

if (-not (Test-Path $nodeModules)) {
    $needsInstall = $true
} elseif (-not (Test-Path $pkgLock)) {
    $needsInstall = $true
} else {
    $modCount = (Get-ChildItem $nodeModules -Directory | Measure-Object).Count
    if ($modCount -lt 3) {
        $needsInstall = $true
    }
}

if ($needsInstall -or $Force) {
    Push-Location $Root
    npm install
    Pop-Location
    Write-Done "npm install complete"
} else {
    $modCount = (Get-ChildItem $nodeModules -Directory | Measure-Object).Count
    Write-OK "$modCount packages already installed"
}

# ── 4. Build TypeScript ───────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Step "Checking TypeScript build"
    $distDir = Join-Path $Root "dist"
    $srcDir = Join-Path $Root "src"
    $needsBuild = $false

    if (-not (Test-Path $distDir)) {
        $needsBuild = $true
    } else {
        $newestSrc = (Get-ChildItem $srcDir -Recurse -Filter "*.ts" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
        $newestDist = (Get-ChildItem $distDir -Recurse -Filter "*.js" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
        if ($newestSrc -gt $newestDist) {
            $needsBuild = $true
        }
    }

    if ($needsBuild -or $Force) {
        Push-Location $Root
        npm run build
        Pop-Location
        Write-Done "TypeScript built"
    } else {
        Write-OK "dist/ is up to date"
    }
} else {
    Write-Skip "TypeScript build (-SkipBuild)"
}

# ── 5. .env file ──────────────────────────────────────────────────────────
Write-Step "Checking .env"
$envFile = Join-Path $Root ".env"
$envExample = Join-Path $Root ".env.example"
if (-not (Test-Path $envFile)) {
    Copy-Item $envExample $envFile
    Write-Done ".env created from .env.example"
} else {
    # Check if .env is missing any keys from .env.example
    $exampleKeys = Get-Content $envExample | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { ($_ -split '=')[0] }
    $envKeys = Get-Content $envFile | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { ($_ -split '=')[0] }
    $missing = $exampleKeys | Where-Object { $_ -notin $envKeys }
    if ($missing) {
        Write-Warn ".env is missing keys: $($missing -join ', ')"
        $missing | ForEach-Object {
            $line = (Get-Content $envExample | Where-Object { $_ -match "^$_=" }) -replace '^[^=]+=',''
            Add-Content $envFile "`n$_=$line"
        }
        Write-Done ".env updated with missing keys"
    } else {
        Write-OK ".env exists with all keys"
    }
}

# ── 6. WSL (Ubuntu) ───────────────────────────────────────────────────────
if (-not $SkipWSL) {
    Write-Step "Checking WSL / Ubuntu"
    $wslInstalled = $false
    try {
        $wslList = wsl --list --quiet 2>$null
        if ($wslList -and ($wslList | Where-Object { $_ -match "Ubuntu" })) {
            $wslInstalled = $true
        }
    } catch {
        # wsl --list fails if WSL feature is not enabled
    }

    if ($wslInstalled) {
        Write-OK "Ubuntu is installed in WSL"
    } else {
        Write-Host "   Installing WSL with Ubuntu..."
        wsl --install --distribution Ubuntu --no-launch
        Write-Done "WSL + Ubuntu installed (reboot may be required)"
        Write-Warn "After reboot, open Ubuntu once to set your UNIX username/password."
    }

    # ── 7. Supermemory Local ──────────────────────────────────────────────
    if (-not $SkipSupermemory) {
        Write-Step "Checking Supermemory Local"
        $smBinary = $false
        try {
            $smCheck = wsl -d Ubuntu -- bash -c "test -f /root/.supermemory/bin/supermemory-server && echo ok" 2>$null
            if ($smCheck -match "ok") { $smBinary = $true }
        } catch {}

        if ($smBinary -and -not $Force) {
            Write-OK "Supermemory Local already installed"
        } else {
            Write-Host "   Downloading and installing Supermemory..."
            wsl -d Ubuntu -u root -- bash -c @"
set -e
mkdir -p /root/.supermemory
cd /root/.supermemory
curl -fsSL https://github.com/supermemoryai/supermemory/releases/latest/download/supermemory-linux-amd64.tar.gz -o sm.tar.gz
tar xzf sm.tar.gz --strip-components=0 -C /root/.supermemory
rm -f sm.tar.gz
chmod +x /root/.supermemory/bin/supermemory-server
echo 'Supermemory Local installed at /root/.supermemory/bin/supermemory-server'
"@
            Write-Done "Supermemory Local installed"
        }

        # Ensure data dir exists
        wsl -d Ubuntu -u root -- bash -c "mkdir -p /root/.supermemory/data" 2>$null | Out-Null
    }
} else {
    Write-Skip "WSL / Ubuntu (-SkipWSL)"
    Write-Skip "Supermemory Local (-SkipWSL)"
}

# ── 8. Windows Firewall rules ─────────────────────────────────────────────
Write-Step "Checking Windows Firewall rules"
$traceAPI = Get-NetFirewallRule -DisplayName "Trace API" -ErrorAction SilentlyContinue
$traceHUD = Get-NetFirewallRule -DisplayName "Trace HUD" -ErrorAction SilentlyContinue

$needAPI = -not $traceAPI
$needHUD = -not $traceHUD

if ($needAPI -or $needHUD) {
    try {
        if ($needAPI) {
            New-NetFirewallRule -DisplayName "Trace API" -Direction Inbound -LocalPort 6768 -Protocol TCP -Action Allow | Out-Null
        }
        if ($needHUD) {
            New-NetFirewallRule -DisplayName "Trace HUD" -Direction Inbound -LocalPort 6769 -Protocol TCP -Action Allow | Out-Null
        }
        $added = @()
        if ($needAPI) { $added += "6768" }
        if ($needHUD) { $added += "6769" }
        Write-Done "Firewall rules added for ports $($added -join ' and ')"
    } catch {
        Write-Warn "Could not add firewall rules (non-critical)"
    }
} else {
    Write-OK "Firewall rules already exist"
}

# ── Summary ────────────────────────────────────────────────────────────────
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Trace setup complete!"                   -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

if ($Installed.Count -gt 0) {
    Write-Host "`n  Installed/updated:" -ForegroundColor Cyan
    $Installed | ForEach-Object { Write-Host "    + $_" -ForegroundColor Green }
}
if ($Skipped.Count -gt 0) {
    Write-Host "`n  Skipped:" -ForegroundColor DarkGray
    $Skipped | ForEach-Object { Write-Host "    - $_" -ForegroundColor DarkGray }
}

Write-Host "`n  Next steps:" -ForegroundColor White
Write-Host "    1. Edit .env to set WATCH_PATHS, LLM keys, etc."
Write-Host "    2. Double-click start.vbs to launch Trace"
Write-Host "    3. Or run:  npm run app   (Electron overlay only)"
Write-Host "               npm start     (API + daemon only)"
Write-Host ""
Write-Host "  First launch: Supermemory will start inside WSL and"
Write-Host "  print an API key. Paste it into SUPERMEMORY_API_KEY in .env."
Write-Host ""
