<#
.SYNOPSIS
    Creates a minimal WSL tarball with Supermemory Local pre-installed.
    Run once on your dev machine. Output: build/supermemory-ubuntu.tar.gz
#>
param(
    [string]$DistroName = "trace-build",
    [string]$VmDir = "C:\TraceVM\trace-build"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = Join-Path $Root "build"

Write-Host "`n>> Building Supermemory WSL image" -ForegroundColor Cyan

# 1. Clean up any previous build instance
Write-Host "   Cleaning previous build instance..."
wsl --unregister $DistroName 2>$null | Out-Null
if (Test-Path $VmDir) { Remove-Item $VmDir -Recurse -Force }

# 2. Install fresh Ubuntu
Write-Host "   Installing fresh Ubuntu..."
wsl --install --distribution Ubuntu --no-launch 2>$null | Out-Null
wsl --set-version $DistroName 2 2>$null | Out-Null

# The --install creates it under the default name "Ubuntu"
# We need to work with it as "Ubuntu" first
$defaultName = "Ubuntu"

# 3. Set up the distro — create root user, install supermemory
Write-Host "   Configuring Ubuntu and installing Supermemory..."
wsl -d $defaultName -u root -- bash -c @"
set -e

# Create root user setup (needed for --import later)
echo 'root:trace' | chpasswd

# Install dependencies
apt-get update -qq
apt-get install -y -qq curl tar xz-utils > /dev/null 2>&1

# Install Supermemory
mkdir -p /root/.supermemory
cd /root/.supermemory
curl -fsSL https://github.com/supermemoryai/supermemory/releases/latest/download/supermemory-linux-amd64.tar.gz -o sm.tar.gz
tar xzf sm.tar.gz --strip-components=0 -C /root/.supermemory
rm -f sm.tar.gz
chmod +x /root/.supermemory/bin/supermemory-server

# Create data dir
mkdir -p /root/.supermemory/data

# Create a startup script
cat > /root/start-supermemory.sh << 'SCRIPT'
#!/bin/bash
export SUPERMEMORY_NO_PROMPT=1
export OPENAI_API_KEY=\${OPENAI_API_KEY:-dummy}
exec /root/.supermemory/bin/supermemory-server
SCRIPT
chmod +x /root/start-supermemory.sh

echo "Supermemory installed successfully"
ls -la /root/.supermemory/bin/supermemory-server
"@

# 4. Export the distro
Write-Host "   Exporting distro to tarball..."
if (-not (Test-Path $BuildDir)) { New-Item -ItemType Directory -Path $BuildDir | Out-Null }
$tarball = Join-Path $BuildDir "supermemory-ubuntu.tar.gz"
wsl --export $defaultName $tarball

# 5. Clean up — unregister the build instance
Write-Host "   Cleaning up..."
wsl --unregister $defaultName 2>$null | Out-Null

# 6. Report
$size = (Get-Item $tarball).Length / 1MB
Write-Host ""
Write-Host "  Done!" -ForegroundColor Green
Write-Host "  Tarball: $tarball"
Write-Host "  Size: $([math]::Round($size, 1)) MB"
Write-Host ""
Write-Host "  Copy this to your project root for packaging:" -ForegroundColor Yellow
Write-Host "    cp `"$tarball`" `"$Root\build\supermemory-ubuntu.tar.gz`""
Write-Host ""
