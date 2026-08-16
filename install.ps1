<#
.SYNOPSIS
  DSH 桌面增强套件 · 一键安装脚本（Windows）

.DESCRIPTION
  自动完成：
    1. 检查环境（Node.js / pnpm / git）
    2. 定位或安装 DeepSeek Harness
    3. 安装本仓库的 6 个增强插件（打包 → 安全扫描 → 安装）
    4. 构建原生桌面应用
    5. 重启后端并验证

  使用方式（在 PowerShell 中）：
    powershell -ExecutionPolicy Bypass -File install.ps1
    或
    ./install.ps1

  常用参数：
    -HarnessRoot "D:\path\to\deepseek-harness"  手动指定 DSH 根目录
    -SkipDesktopApp                              跳过桌面应用构建
    -SkipRestart                                 安装后不自动重启后端
#>
[CmdletBinding()]
param(
    [string]$HarnessRoot = '',
    [string]$DshInstallDir = '',
    [switch]$SkipDesktopApp,
    [switch]$SkipRestart
)

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
    # 刷新 PATH
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

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Err "未检测到 git。请安装 https://git-scm.com 后重新运行本脚本。"
    exit 1
}
Ok "git $(git --version | Out-String).Trim()"

# ---------- 2. 定位 / 安装 DeepSeek Harness ----------
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
    Warn "未找到已安装的 DeepSeek Harness。"
    if (-not $DshInstallDir) { $DshInstallDir = Join-Path $env:USERPROFILE 'deepseek-harness' }
    Write-Host "正在从官方仓库安装到：$DshInstallDir（首次构建可能需要几分钟）"
    New-Item -ItemType Directory -Force -Path $DshInstallDir | Out-Null
    git clone https://github.com/deepseek-ai/DeepSeek-Harness.git $DshInstallDir
    Push-Location $DshInstallDir
    try {
        pnpm install
        if ($LASTEXITCODE -ne 0) { throw 'pnpm install 失败' }
        pnpm run build
        if ($LASTEXITCODE -ne 0) { throw 'pnpm run build 失败' }
    } finally { Pop-Location }
    $harness = $DshInstallDir
}
Ok "DeepSeek Harness 目录：$harness"

# 插件安装依赖完整版 harness 的安全门禁
$inspector = Join-Path $harness 'security\Inspect-PluginPackage.ps1'
$installer = Join-Path $harness 'security\Install-PluginSafely.ps1'
if (-not (Test-Path $inspector) -or -not (Test-Path $installer)) {
    Err "当前 DSH 缺少插件安全门禁（security\Inspect-PluginPackage.ps1）。"
    Err "请使用包含完整插件门禁的 DeepSeek Harness 安装（或用 -HarnessRoot 指定），再运行本脚本安装插件。"
    exit 1
}
$pnpmCmd = if (Test-Path (Join-Path $harness 'runtime\pnpm.cmd')) { Join-Path $harness 'runtime\pnpm.cmd' } else { 'pnpm' }

# 启动后端（如未运行）
Step "启动 DeepSeek Harness 后端"
$health = $false
try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $health = $true } } catch {}
if (-not $health) {
    $starter = Join-Path $harness 'scripts\Start-DeepSeek-HarnessBackground.ps1'
    if (Test-Path $starter) {
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', $starter, '-Port', '3080') | Out-Null
        Write-Host "后端正在启动，等待就绪……"
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 2
            try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $health = $true; break } } catch {}
        }
    } else {
        Write-Host "未找到后台启动脚本，请手动启动 DSH 后重试。"
    }
}
if ($health) { Ok '后端已就绪 http://127.0.0.1:3080' } else { Warn '后端尚未就绪（可稍后手动启动）' }

# ---------- 3. 安装 6 个增强插件 ----------
Step "安装增强插件"
$distRoot = Join-Path $harness 'plugins\dist'
New-Item -ItemType Directory -Force -Path $distRoot | Out-Null

# 壁纸功能可选依赖 sharp：缺失不影响安装，仅提示（避免小白误以为装坏了）
if (-not (Test-Path (Join-Path $harness 'node_modules\sharp'))) {
    Warn "未检测到 sharp（壁纸图像库）：壁纸功能不可用，但桌宠 / dock / 透明度等其它功能正常。"
    Write-Host "  如需壁纸功能，可在 DSH 根目录执行：pnpm add sharp"
}

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

        # 2) 安全扫描
        Write-Host "安全扫描（Defender + 静态分析 + 依赖审计）……"
        & $inspector -Package $finalPath | Out-Null
        if ($LASTEXITCODE -gt 2) { throw "扫描判定为 blocked（$name），已停止安装该插件" }
        $report = @(Get-ChildItem (Join-Path $harness 'security\reports') -Filter 'plugin-review-*.json' -File |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1)
        if ($report.Count -ne 1) { throw "未生成扫描报告（$name）" }
        Write-Host "扫描报告：$($report[0].Name)"

        # 3) 安装（-Approve：本仓库插件为仓库作者自研，安装前已复核扫描报告）
        Write-Host "安装中……"
        & $installer -Package $finalPath -ApprovedReport $report[0].FullName -Approve | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "安装失败（$name）" }
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
    if (Test-Path $restartScript) {
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', $restartScript) | Out-Null
        Write-Host "后端正在重启，等待就绪……"
        Start-Sleep -Seconds 12
        for ($i = 0; $i -lt 30; $i++) {
            try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { break } } catch {}
            Start-Sleep -Seconds 2
        }
    } else {
        Write-Host "未找到重启脚本，请手动重启 DSH 使插件生效。"
    }
}

# ---------- 6. 验证 ----------
Step "验证"
try {
    $d = (Invoke-WebRequest -Uri 'http://127.0.0.1:3080/dsh-token-pet/data.json' -UseBasicParsing -TimeoutSec 8).Content | ConvertFrom-Json
    if ($d.session) { Ok "token-pet 数据接口正常（session=$($d.session.sessionId)）" } else { Warn 'token-pet 接口未就绪' }
} catch { Warn "token-pet 接口未就绪：$($_.Exception.Message)" }

Write-Host "`n========== 安装完成 ==========" -ForegroundColor Green
Write-Host "1. 打开 DSH：http://127.0.0.1:3080"
Write-Host "2. 桌面应用：$harness 桌面快捷方式或 desktop\dist\DeepSeekHarness\DeepSeekHarness.exe"
Write-Host "3. 在设置里可看到「桌面体验 / 桌宠 / 壁纸」标签，即插件已生效"
Write-Host "4. 如遇任何问题，请带上本脚本输出到仓库 Issues 反馈"
