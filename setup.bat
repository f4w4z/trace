@echo off
:: Trace Setup — double-click to install (requires Admin)
:: Delegates to setup.ps1
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
