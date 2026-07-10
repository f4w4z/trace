@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$p=Get-NetTCPConnection -LocalPort 6768 -ErrorAction SilentlyContinue; $e=Get-Process -Name electron -ErrorAction SilentlyContinue; if ($p -and $e) { Write-Host '[trace] Already running (port 6768, electron pid ' $e[0].Id ')'; exit }"
echo [trace] Launching server + overlay (hidden windows)...
wscript.exe "%~dp0start.vbs"
echo [trace] Running. Alt+X to open.
