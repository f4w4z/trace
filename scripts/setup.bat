@echo off
setlocal
chcp 65001 >nul
title Trace — Setup

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Trace needs Node.js, which isn't installed yet.
    echo   Download the "LTS" version from https://nodejs.org/ and run setup again.
    echo.
    pause
    exit /b 1
)

node "%~dp0setup.mjs"
