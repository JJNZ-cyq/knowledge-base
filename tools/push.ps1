# push.ps1 —— 一键推送到 GitHub（每周日维护的最后一步）
#
# 用法（在你自己的终端里运行，不是 Agent 环境）：
#     .\tools\push.ps1
#     .\tools\push.ps1 "weekly: 2026-W39"     # 自定义提交信息
#
# 为什么需要这个脚本：Agent 沙箱禁止出站 TLS，push 只能由你本机执行。
# 本脚本会自动：暂存全部改动 → 提交（若无改动则跳过）→ 推送。

param(
    [string]$Message = ""
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=== 知识库推送 ===" -ForegroundColor Cyan

# ── 1. 检查 remote ───────────────────────────────────────
$remote = git config --get remote.origin.url
if (-not $remote) {
    Write-Host "❌ 未配置远端。先运行：" -ForegroundColor Red
    Write-Host "     node tools/remote.mjs <你的GitHub用户名>"
    exit 1
}
Write-Host "远端: $remote"

# ── 2. 提交改动 ─────────────────────────────────────────
git add -A
$staged = git diff --cached --name-only
if ($staged) {
    $count = ($staged | Measure-Object).Count
    if (-not $Message) {
        $Message = "notes: 更新 $count 个文件 ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
    }
    git commit -q -m $Message
    Write-Host "✅ 已提交 $count 个文件的改动" -ForegroundColor Green
    Write-Host "   提交信息: $Message"
} else {
    Write-Host "ℹ️  没有新改动需要提交" -ForegroundColor Yellow
}

# ── 3. 推送 ─────────────────────────────────────────────
Write-Host ""
Write-Host "正在推送…" -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ 推送成功，异地备份已完成" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ 推送失败" -ForegroundColor Red
    Write-Host ""
    Write-Host "常见原因与对策："
    Write-Host "  1) 需要凭据 → 用 Personal Access Token（不是账号密码）"
    Write-Host "     GitHub → Settings → Developer settings → Personal access tokens → 勾 repo"
    Write-Host "  2) 网络不通 → 先启动你的代理软件，再执行："
    Write-Host "       git config --global http.proxy  http://127.0.0.1:<端口>"
    Write-Host "       git config --global https.proxy http://127.0.0.1:<端口>"
    Write-Host "     端口以 v2rayN / clash 实际监听为准（常见 10809 / 7890）"
    Write-Host "  3) 远端有本地没有的提交（比如你在网页上改过文件）→ 先执行："
    Write-Host "       git pull --rebase origin main"
    exit 1
}
