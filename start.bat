@echo off
cd /d "%~dp0"
echo [smt] Launching server + overlay (hidden windows)...
wscript.exe "%~dp0start.vbs"
echo [smt] Done. Alt+X to open. Close with taskkill /f /im node.exe /im electron.exe
