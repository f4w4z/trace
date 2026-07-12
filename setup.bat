@echo off
:: Trace Setup — double-click to install (requires Admin)
title Trace Setup
cd /d "%~dp0"
:: Enable ANSI escape codes for colors/symbols
reg add "HKCU\Console" /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
echo.
echo Press any key to exit...
pause >nul
