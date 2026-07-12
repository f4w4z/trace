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
$NeedsReboot = $false

# ── Helpers ───────────────────────────────────────────────────────────────
$Dim    = "`e[2m"
$Reset  = "`e[0m"
$Bold   = "`e[1m"
$Green  = "`e[32m"
$Yellow = "`e[33m"
$Cyan   = "`e[36m"
$Red    = "`e[31m"
$Gray   = "`e[90m"
$White  = "`e[37m"

function Write-Banner {
    Write-Host ""
    Write-Host "  $Bold$Cyan  _                                              $Reset"
    Write-Host "  $Bold$Cyan | |_ ___ _ __ _ __   _____      __            $Reset"
    Write-Host "  $Bold$Cyan | __/ _ \ '__| '_ \ / _ \ \ /\ / /            $Reset"
    Write-Host "  $Bold$Cyan | ||  __/ |  | | | | (_) \ V  V /             $Reset"
    Write-Host "  $Bold$Cyan  \__\___|_|  |_| |_|\___/ \_/\_/              $Reset"
    Write-Host ""
    Write-Host "  ${Dim}$Gray$($MyInvocation.MyCommand.Name) v0.1.0$Reset"
    Write-Host ""
}

function Write-Step($n, $total, $msg) {
    Write-Host ""
    Write-Host "  ${Bold}${Cyan}[$n/$total]${Reset} ${Bold}$msg${Reset}"
}

function Write-OK($msg) {
    Write-Host "  ${Green}$([char]0x2713)${Reset} $msg"
}

function Write-Installed($msg) {
    Write-Host "  ${Green}$([char]0x2191)${Reset} $msg"
    $script:Installed += $msg
}

function Write-Skipped($msg) {
    Write-Host "  ${Gray}$([char]0x2013)${Reset} ${Gray}$msg${Reset}"
    $script:Skipped += $msg
}

function Write-Warn($msg) {
    Write-Host "  ${Yellow}!${Reset} $msg"
}

function Write-Err($msg) {
    Write-Host "  ${Red}x${Reset} $msg"
}

function Write-Status($line) {
    Write-Host "    ${Dim}$line${Reset}"
}

# ── Admin check ───────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host ""
    Write-Host "  ${Red}${Bold}Run as Administrator${Reset}" -NoNewline
    Write-Host ""
    Write-Host "  Right-click ${Bold}setup.bat${Reset} and choose ${Bold}'Run as administrator'${Reset}"
    Write-Host ""
    exit 1
}

Write-Banner
$total = 7
if ($SkipWSL) { $total = 5 }

# ── 1. Git ────────────────────────────────────────────────────────────────
Write-Step 1 $total "Git"
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    $gitVer = (git --version) -replace 'git version ',''
    Write-OK "Already installed ${Bold}v$gitVer${Reset}"
} else {
    Write-Status "Installing via winget..."
    winget install Git.Git --accept-package-agreements --accept-source-agreements 2>$null | Out-Null
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Installed "Git installed"
}

# ── 2. Node.js ────────────────────────────────────────────────────────────
Write-Step 2 $total "Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node -and -not $Force) {
    $ver = (node -v) -replace 'v',''
    if ([version]$ver -ge [version]"20.0.0") {
        Write-OK "Already installed ${Bold}v$ver${Reset}"
    } else {
        Write-Warn "v$ver is too old (need >=20)"
        Write-Status "Upgrading to LTS..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>$null | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        Write-Installed "Node.js upgraded to LTS"
    }
} elseif (-not $node) {
    Write-Status "Not found. Installing via winget..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>$null | Out-Null
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Installed "Node.js installed"
} else {
    Write-OK "Already installed"
}

# ── 3. npm dependencies ───────────────────────────────────────────────────
Write-Step 3 $total "Dependencies"
$nodeModules = Join-Path $Root "node_modules"
$pkgLock = Join-Path $Root "package-lock.json"
$needsInstall = $false

if (-not (Test-Path $nodeModules)) {
    $needsInstall = $true
} elseif (-not (Test-Path $pkgLock)) {
    $needsInstall = $true
} else {
    $modCount = (Get-ChildItem $nodeModules -Directory | Measure-Object).Count
    if ($modCount -lt 3) { $needsInstall = $true }
}

if ($needsInstall -or $Force) {
    Write-Status "Running npm install..."
    Push-Location $Root
    npm install 2>$null | Out-Null
    Pop-Location
    $modCount = (Get-ChildItem $nodeModules -Directory | Measure-Object).Count
    Write-Installed "$modCount packages installed"
} else {
    $modCount = (Get-ChildItem $nodeModules -Directory | Measure-Object).Count
    Write-OK "${Bold}$modCount${Reset} packages already installed"
}

# ── 4. Build TypeScript ───────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Step 4 $total "TypeScript"
    $distDir = Join-Path $Root "dist"
    $srcDir = Join-Path $Root "src"
    $needsBuild = $false

    if (-not (Test-Path $distDir)) {
        $needsBuild = $true
    } else {
        $newestSrc = (Get-ChildItem $srcDir -Recurse -Filter "*.ts" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
        $newestDist = (Get-ChildItem $distDir -Recurse -Filter "*.js" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
        if ($newestSrc -gt $newestDist) { $needsBuild = $true }
    }

    if ($needsBuild -or $Force) {
        Write-Status "Compiling..."
        Push-Location $Root
        npm run build 2>$null | Out-Null
        Pop-Location
        Write-Installed "TypeScript compiled"
    } else {
        Write-OK "dist/ is up to date"
    }
} else {
    $total--
    Write-Step 4 $total "TypeScript"
    Write-Skipped "Skipped (-SkipBuild)"
}

# ── 5. .env file ──────────────────────────────────────────────────────────
Write-Step 5 $total "Configuration"
$envFile = Join-Path $Root ".env"
$envExample = Join-Path $Root ".env.example"
if (-not (Test-Path $envFile)) {
    Copy-Item $envExample $envFile
    Write-Installed ".env created from .env.example"
} else {
    $exampleKeys = Get-Content $envExample | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { ($_ -split '=')[0] }
    $envKeys = Get-Content $envFile | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { ($_ -split '=')[0] }
    $missing = $exampleKeys | Where-Object { $_ -notin $envKeys }
    if ($missing) {
        $missing | ForEach-Object {
            $line = (Get-Content $envExample | Where-Object { $_ -match "^$_=" }) -replace '^[^=]+=',''
            Add-Content $envFile "`n$_=$line"
        }
        Write-Installed ".env updated ($($missing.Count) missing keys added)"
    } else {
        Write-OK "Exists with all keys"
    }
}

# ── 6. WSL ────────────────────────────────────────────────────────────────
if (-not $SkipWSL) {
    Write-Step 6 $total "WSL + Ubuntu"
    $wslInstalled = $false
    try {
        $wslList = wsl --list --quiet 2>$null
        if ($wslList -and ($wslList | Where-Object { $_ -match "Ubuntu" })) {
            $wslInstalled = $true
        }
    } catch {}

    $wslNeedsReboot = $false
    if ($wslInstalled) {
        Write-OK "Ubuntu is installed"
    } else {
        Write-Status "Installing WSL + Ubuntu..."
        wsl --install --distribution Ubuntu --no-launch 2>$null | Out-Null
        $wslNeedsReboot = $true
        $NeedsReboot = $true
        Write-Installed "WSL + Ubuntu installed"
        Write-Warn "Reboot required to finish WSL setup"
    }

    # ── 7. Supermemory ────────────────────────────────────────────────────
    if (-not $SkipSupermemory) {
        Write-Step 7 $total "Supermemory Local"

        $wslReady = $false
        if (-not $wslNeedsReboot) {
            try {
                $testRun = wsl -d Ubuntu -- echo ok 2>$null
                if ($testRun -match "ok") { $wslReady = $true }
            } catch {}
        }

        if (-not $wslReady) {
            Write-Skipped "Pending — WSL needs reboot first"
        } else {
            $smBinary = $false
            try {
                $smCheck = wsl -d Ubuntu -- bash -c "test -f /root/.supermemory/bin/supermemory-server && echo ok" 2>$null
                if ($smCheck -match "ok") { $smBinary = $true }
            } catch {}

            if ($smBinary -and -not $Force) {
                Write-OK "Already installed"
            } else {
                Write-Status "Downloading..."
                $installOk = $false
                try {
                    wsl -d Ubuntu -u root -- bash -c @"
set -e
mkdir -p /root/.supermemory
cd /root/.supermemory
curl -fsSL https://github.com/supermemoryai/supermemory/releases/latest/download/supermemory-linux-amd64.tar.gz -o sm.tar.gz
tar xzf sm.tar.gz --strip-components=0 -C /root/.supermemory
rm -f sm.tar.gz
chmod +x /root/.supermemory/bin/supermemory-server
"@ 2>$null
                    $installOk = $true
                } catch {}

                if ($installOk) {
                    Write-Installed "Supermemory Local installed"
                } else {
                    Write-Warn "Install failed — will retry after reboot"
                }
            }

            if ($smBinary -or $installOk) {
                wsl -d Ubuntu -u root -- bash -c "mkdir -p /root/.supermemory/data" 2>$null | Out-Null
            }
        }
    }
} else {
    Write-Step 6 $total "WSL + Ubuntu"
    Write-Skipped "Skipped (-SkipWSL)"
    if (-not $SkipSupermemory) {
        Write-Step 7 $total "Supermemory Local"
        Write-Skipped "Skipped (-SkipWSL)"
    }
}

# ── 8. Firewall ───────────────────────────────────────────────────────────
# (always runs, no step number — it's a finalization step)
Write-Host ""
Write-Host "  ${Bold}${Cyan}Finalizing${Reset}"
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
        $ports = @()
        if ($needAPI) { $ports += "6768" }
        if ($needHUD) { $ports += "6769" }
        Write-OK "Firewall rules added (ports $($ports -join ', '))"
    } catch {
        Write-Warn "Could not add firewall rules (non-critical)"
    }
} else {
    Write-OK "Firewall rules already exist"
}

# ── Summary ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  $Bold$('=' * 44)$Reset"
Write-Host ""

if ($NeedsReboot) {
    Write-Host "  ${Yellow}${Bold}Reboot required to continue setup.${Reset}"
    Write-Host ""
    Write-Host "  ${Dim}What just happened:${Reset}"
    Write-Host "  ${Dim}  - Installed Git, Node.js, and dependencies${Reset}"
    Write-Host "  ${Dim}  - Built the project${Reset}"
    Write-Host "  ${Dim}  - Created .env config${Reset}"
    Write-Host "  ${Dim}  - Installed WSL + Ubuntu (pending reboot)${Reset}"
    Write-Host ""
    Write-Host "  ${Bold}${Yellow}Next steps:${Reset}"
    Write-Host ""
    Write-Host "    ${Bold}1.${Reset} ${Bold}Reboot your PC now${Reset}"
    Write-Host "    ${Bold}2.${Reset} After reboot, ${Bold}open Ubuntu once${Reset} from the Start menu"
    Write-Host "       to set your UNIX username and password"
    Write-Host "    ${Bold}3.${Reset} Run ${Bold}setup.bat${Reset} again — it will:"
    Write-Host "       ${Dim}- Skip everything already done (< 5 seconds)${Reset}"
    Write-Host "       ${Dim}- Install Supermemory Local in WSL${Reset}"
    Write-Host "       ${Dim}- Finish the remaining setup${Reset}"
    Write-Host ""
} else {
    Write-Host "  ${Green}${Bold}Setup complete!${Reset}"
    Write-Host ""

    if ($Installed.Count -gt 0) {
        Write-Host "  ${Cyan}Installed:${Reset}"
        $Installed | ForEach-Object { Write-Host "    ${Green}$([char]0x2191)${Reset} $_" }
        Write-Host ""
    }
    if ($Skipped.Count -gt 0) {
        Write-Host "  ${Gray}Already done:${Reset}"
        $Skipped | ForEach-Object { Write-Host "    ${Gray}$([char]0x2013)${Reset} $_" }
        Write-Host ""
    }

    Write-Host "  ${Bold}Launch:${Reset}"
    Write-Host "    Double-click ${Bold}start.vbs${Reset}  (full app)"
    Write-Host "    Or:  npm run app   ${Dim}(Electron overlay)${Reset}"
    Write-Host "         npm start     ${Dim}(API + daemon)${Reset}"
    Write-Host ""
    Write-Host "  ${Dim}First launch: Supermemory will start inside WSL and print"
    Write-Host "  an API key. Paste it into SUPERMEMORY_API_KEY in .env${Reset}"
    Write-Host ""
}

Write-Host "  $Bold$('=' * 44)$Reset"
Write-Host ""
