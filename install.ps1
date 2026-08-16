<#
.SYNOPSIS
  DSH 桌面增强套件 · 一键安装脚本（Windows）

.DESCRIPTION
  自动完成：
    1. 检查环境（Node.js / pnpm / git）
    2. 定位 DeepSeek Harness（完整版 harness 或官方 npm 版）
    3. 安装本仓库的 6 个增强插件
       - 完整版 harness：打包 → 安全扫描 → 门禁安装
       - 官方 npm 版：打包 → dsh plugin add（自动装 sharp 等依赖）
    4. 构建原生桌面应用（可选）
    5. 重启后端并验证

  使用方式（在 PowerShell 中）：
    powershell -ExecutionPolicy Bypass -File install.ps1
    或
    ./install.ps1

  常用参数：
    -HarnessRoot "D:\path\to\deepseek-harness"  手动指定 DSH 根目录
    -Port 3090                                   换端口（默认 3080）
    -SkipDesktopApp                              跳过桌面应用构建
    -SkipRestart                                 安装后不自动重启后端
#>
[CmdletBinding()]
param(
    [string]$HarnessRoot = '',
    [string]$DshInstallDir = '',
    [int]$Port = 3080,
    [switch]$SkipDesktopApp,
    [switch]$SkipRestart
)

# 让桌面应用跟随同一端口
$env:DSH_DESKTOP_PORT = [string]$Port

# 避免 pwsh 7 把原生命令的 stderr 当成错误抛出
$PSNativeCommandUseErrorActionPreference = $false
$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }

# ---------- 输出工具 ----------
function Step([string]$Msg) { Write-Host "`n===== $Msg =====" -ForegroundColor Cyan }
function Ok([string]$Msg)    { Write-Host "[OK] $Msg" -ForegroundColor Green }
function Warn([string]$Msg)  { Write-Host "[!] $Msg" -ForegroundColor Yellow }
function Err([string]$Msg)   { Write-Host "[x] $Msg" -ForegroundColor Red }

# ---------- 1. 环境检查 ----------
Step "检查环境"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Warn "未检测到 Node.js，尝试用 winget 自动安装 LTS 版本……"
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Err "Node.js 安装失败。请手动安装 https://nodejs.org 的 LTS 版本，然后重新运行本脚本。"
    exit 1
}
Ok "Node.js $(node -v)"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "未检测到 pnpm，正在通过 npm 安装……"
    npm install -g pnpm 2>&1 | Out-Null
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Err "pnpm 安装失败。请手动执行 npm install -g pnpm 后重试。"
    exit 1
}
Ok "pnpm $(pnpm -v)"

# ---------- 2. 定位 DeepSeek Harness + 判断安装模式 ----------
Step "定位 DeepSeek Harness"

function Find-HarnessRoot {
    param([string]$Candidate)
    if ($Candidate -and (Test-Path (Join-Path $Candidate 'scripts\Start-DeepSeek-Harness.ps1'))) {
        return (Resolve-Path $Candidate).Path
    }
    if ($env:DSH_HOME) {
        $r = Split-Path (Split-Path $env:DSH_HOME -Parent) -Parent
        if (Test-Path (Join-Path $r 'scripts')) { return $r }
    }
    foreach ($c in @(
        "$env:USERPROFILE\deepseek-harness",
        "$env:LOCALAPPDATA\deepseek-harness",
        'D:\ai\deepseek-harness',
        'C:\deepseek-harness',
        "$env:ProgramFiles\deepseek-harness"
    )) {
        if (Test-Path (Join-Path $c 'scripts\Start-DeepSeek-Harness.ps1')) { return $c }
    }
    return $null
}

$harness = Find-HarnessRoot -Candidate $HarnessRoot
if (-not $harness) {
    Warn "未找到完整版 DeepSeek Harness（可能是官方 npm 版，稍后会用 dsh plugin add 安装）。"
    $harness = $RepoRoot
}

# 判断安装模式
$inspector = Join-Path $harness 'security\Inspect-PluginPackage.ps1'
$installer = Join-Path $harness 'security\Install-PluginSafely.ps1'
$hasGate = (Test-Path $inspector) -and (Test-Path $installer)
$mode = if ($hasGate) { 'harness' } else { 'npm' }
if ($mode -eq 'harness') { Ok "检测到完整版 harness，走安全门禁安装" }
else { Warn "未检测到安全门禁，按官方 npm 版处理（dsh plugin add 安装）" }

$pnpmCmd = if (Test-Path (Join-Path $harness 'runtime\pnpm.cmd')) { Join-Path $harness 'runtime\pnpm.cmd' } else { 'pnpm' }

# 官方 npm 版需要 dsh 命令
$dshCmd = $null
if (Get-Command dsh -ErrorAction SilentlyContinue) { $dshCmd = 'dsh' }
elseif (Get-Command npx -ErrorAction SilentlyContinue) { $dshCmd = 'npx' }
if ($mode -eq 'npm' -and -not $dshCmd) {
    Err "未找到 dsh 命令。请先安装：npm install -g @deepseek-ai/dsh，然后重新运行本脚本。"
    exit 1
}

# ---------- 3. 安装 6 个增强插件 ----------
Step "安装增强插件"
$distRoot = if ($mode -eq 'harness') { Join-Path $harness 'plugins\dist' } else { Join-Path $RepoRoot '.build-dist' }
New-Item -ItemType Directory -Force -Path $distRoot | Out-Null

$pluginDirs = @(Get-ChildItem (Join-Path $RepoRoot 'plugins') -Directory | Sort-Object Name)
if ($pluginDirs.Count -eq 0) {
    Err "未找到 plugins 目录（$RepoRoot\plugins）。请确认在仓库根目录运行本脚本。"
    exit 1
}

foreach ($pluginDir in $pluginDirs) {
    $name = $pluginDir.Name
    Step "插件：$name"
    try {
        # 1) 打包
        $staging = Join-Path $distRoot ('.pack-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        Push-Location $pluginDir.FullName
        try {
            $prev = $env:npm_config_ignore_scripts
            $env:npm_config_ignore_scripts = 'true'
            & $pnpmCmd pack --pack-destination $staging 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "打包失败（$name）" }
            $env:npm_config_ignore_scripts = $prev
        } finally { Pop-Location }

        $created = @(Get-ChildItem $staging -Filter '*.tgz' -File)
        if ($created.Count -ne 1) { throw "打包未生成唯一 tgz（$name）" }
        $finalName = "$([IO.Path]::GetFileNameWithoutExtension($created[0].Name))-$(Get-Date -Format 'yyyyMMdd-HHmmss').tgz"
        $finalPath = Join-Path $distRoot $finalName
        Move-Item $created[0].FullName $finalPath -Force
        Remove-Item $staging -Recurse -Force
        Write-Host "打包完成：$finalName"

        # 2) 安装
        if ($mode -eq 'harness') {
            Write-Host "安全扫描（Defender + 静态分析 + 依赖审计）……"
            & $inspector -Package $finalPath | Out-Null
            if ($LASTEXITCODE -gt 2) { throw "扫描判定为 blocked（$name），已停止安装该插件" }
            $report = @(Get-ChildItem (Join-Path $harness 'security\reports') -Filter 'plugin-review-*.json' -File |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1)
            if ($report.Count -ne 1) { throw "未生成扫描报告（$name）" }
            Write-Host "安装中……"
            & $installer -Package $finalPath -ApprovedReport $report[0].FullName -Approve | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "安装失败（$name）" }
        } else {
            Write-Host "安装中（dsh plugin add，自动安装依赖）……"
            if ($dshCmd -eq 'dsh') { & dsh plugin add $finalPath }
            else { & npx @deepseek-ai/dsh plugin add $finalPath }
            if ($LASTEXITCODE -ne 0) { throw "安装失败（$name）" }
        }
        Ok "已安装 $name"
    } catch {
        Err $_.Exception.Message
        Write-Host "继续下一个插件……" -ForegroundColor Yellow
    }
}

# ---------- 4. 构建桌面应用 ----------
if (-not $SkipDesktopApp) {
    Step "构建桌面应用"
    $buildApp = Join-Path $RepoRoot 'desktop\build\Build-DshDesktopApp.ps1'
    if (Test-Path $buildApp) {
        & $buildApp -HarnessRoot $harness
        if ($LASTEXITCODE -ne 0) { Warn '桌面应用构建未完全成功（不影响插件使用）' }
        else { Ok '桌面应用已构建' }
    } else {
        Warn "未找到 $buildApp，跳过桌面应用构建"
    }
}

# ---------- 5. 重启后端 + 验证 ----------
if (-not $SkipRestart) {
    Step "重启后端（加载新插件）"
    $restartScript = Join-Path $RepoRoot 'tools\Restart-DshService.ps1'
    if ($mode -eq 'harness' -and (Test-Path $restartScript)) {
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', $restartScript) | Out-Null
        Write-Host "后端正在重启，等待就绪……"
        Start-Sleep -Seconds 12
        for ($i = 0; $i -lt 30; $i++) {
            try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { break } } catch {}
            Start-Sleep -Seconds 2
        }
    } else {
        Write-Host "官方 npm 版请手动重启 DSH（或重新运行 dsh web）使插件生效。"
    }
}

# ---------- 6. 验证 ----------
Step "验证"
try {
    $d = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/dsh-token-pet/data.json" -UseBasicParsing -TimeoutSec 8).Content | ConvertFrom-Json
    if ($d.session) { Ok "token-pet 数据接口正常（session=$($d.session.sessionId)）" } else { Warn 'token-pet 接口未就绪' }
} catch { Warn "token-pet 接口未就绪（后端可能尚未启动）：$($_.Exception.Message)" }

Write-Host "`n========== 安装完成 ==========" -ForegroundColor Green
Write-Host "1. 打开 DSH：http://127.0.0.1:$Port"
Write-Host "2. 在设置里可看到「桌面体验 / 桌宠 / 壁纸」标签，即插件已生效"
Write-Host "3. 如遇任何问题，请带上本脚本输出到仓库 Issues 反馈"
