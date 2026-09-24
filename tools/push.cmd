@echo off
REM ============================================================
REM  push.cmd -- push the knowledge base to GitHub
REM
REM  Double-click this file, or run it from a terminal:
REM      tools\push.cmd
REM      tools\push.cmd "weekly: 2026-W39"      (custom message)
REM
REM  WHY THIS WRAPPER EXISTS
REM    Windows client default PowerShell execution policy is
REM    Restricted, so running .\tools\push.ps1 directly is refused:
REM      "running scripts is disabled on this system"
REM    .cmd files are not subject to that policy, so this wrapper
REM    invokes the real script with -ExecutionPolicy Bypass and you
REM    never have to change system security settings.
REM
REM  ENCODING NOTE
REM    Every line below is intentionally ASCII-only. cmd.exe reads
REM    .cmd files using the OEM code page (936/GBK on this machine),
REM    so non-ASCII comments get parsed as commands and break the file.
REM ============================================================

setlocal
set "SCRIPT=%~dp0push.ps1"

if not exist "%SCRIPT%" (
    echo [X] Script not found: %SCRIPT%
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "RC=%ERRORLEVEL%"

REM NOTE: deliberately no "pause" here.
REM   A pause that also fires during normal terminal use is worse than a
REM   double-click window closing: it looks like the script hangs.
REM   Run it from a terminal when you want to read the output.

exit /b %RC%
