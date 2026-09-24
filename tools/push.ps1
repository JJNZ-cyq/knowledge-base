# push.ps1 -- one-command push to GitHub (last step of the weekly Sunday routine)
#
# Usage (run in YOUR OWN terminal, not the agent environment):
#     .\tools\push.ps1
#     .\tools\push.ps1 "weekly: 2026-W39"     # custom commit message
#
# Why this script exists: the agent sandbox blocks outbound TLS, so `git push`
# can only run on your machine.
#
# NOTE ON ENCODING: every Write-Host string below is intentionally ASCII.
# PowerShell 5.1 reads a .ps1 file as ANSI(GBK) when it has no BOM, which
# would garble non-ASCII output. Chinese comments are safe because comments
# never affect execution.
#
# 中文说明：
#   本脚本自动完成：暂存全部改动 -> 提交（无改动则跳过）-> 推送。
#   输出文字刻意只用 ASCII：PowerShell 5.1 对无 BOM 的 .ps1 会按 GBK 读取，
#   中文输出会乱码；注释里的中文不影响运行，所以保留。

param(
    [string]$Message = ""
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=== Knowledge base push ===" -ForegroundColor Cyan

# -- 1. check remote ---------------------------------------------------
$remote = git config --get remote.origin.url
if (-not $remote) {
    Write-Host "[X] No remote configured. Run this first:" -ForegroundColor Red
    Write-Host "      node tools/remote.mjs <your-github-username>"
    exit 1
}
Write-Host "remote: $remote"
Write-Host "branch: $(git rev-parse --abbrev-ref HEAD)"

# -- 2. commit changes -------------------------------------------------
git add -A
$staged = git diff --cached --name-only
if ($staged) {
    $count = ($staged | Measure-Object).Count
    if (-not $Message) {
        $Message = "notes: update $count file(s) ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
    }
    git commit -q -m $Message
    Write-Host "[OK] committed $count file(s)" -ForegroundColor Green
    Write-Host "     message: $Message"
} else {
    Write-Host "[--] nothing new to commit" -ForegroundColor Yellow
}

# -- 3. push -----------------------------------------------------------
# Detect first push: refs/remotes/origin/main does not exist before the first
# fetch/push, and a bare `git push` then fails with "no upstream configured".
# So use -u on the very first run only.
$isFirstPush = $false
git rev-parse --verify --quiet refs/remotes/origin/main *> $null
if ($LASTEXITCODE -ne 0) { $isFirstPush = $true }

Write-Host ""
Write-Host "pushing..." -ForegroundColor Cyan
if ($isFirstPush) {
    Write-Host "(first push detected, setting up branch tracking)"
    git push -u origin main
} else {
    git push
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[OK] push succeeded - offsite backup is up to date" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host ""
Write-Host "[X] push FAILED" -ForegroundColor Red
Write-Host ""
Write-Host "Common causes and fixes:"
Write-Host ""
Write-Host "  1) Credentials needed -> use a Personal Access Token, NOT your password"
Write-Host "     GitHub -> Settings -> Developer settings -> Personal access tokens"
Write-Host "     Scope: repo.  Windows Credential Manager will remember it."
Write-Host ""
Write-Host "  2) Network blocked -> start your proxy (v2rayN / clash) first, then:"
Write-Host "       git config --global http.proxy  http://127.0.0.1:<port>"
Write-Host "       git config --global https.proxy http://127.0.0.1:<port>"
Write-Host "     Check which port your proxy actually listens on (often 10809 / 7890)."
Write-Host ""
Write-Host "  3) Remote has commits you do not have (e.g. you edited files on the web):"
Write-Host "       git pull --rebase origin main"
Write-Host ""
exit 1
