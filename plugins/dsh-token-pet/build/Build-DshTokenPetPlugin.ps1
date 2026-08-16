[CmdletBinding()]
param(
    [string]$HarnessRoot = ''
)

$ErrorActionPreference = 'Stop'

# --- locate the DeepSeek Harness installation --------------------------------
if (-not $HarnessRoot) {
    if ($env:DSH_HOME) {
        $candidate = Split-Path (Split-Path $env:DSH_HOME -Parent) -Parent
        if (Test-Path -LiteralPath (Join-Path $candidate 'scripts') -PathType Container) { $HarnessRoot = $candidate }
    }
    if (-not $HarnessRoot -and (Test-Path -LiteralPath 'D:\path\to\deepseek-harness\scripts' -PathType Container)) {
        $HarnessRoot = 'D:\path\to\deepseek-harness'
    }
}
if (-not $HarnessRoot -or -not (Test-Path -LiteralPath (Join-Path $HarnessRoot 'scripts') -PathType Container)) {
    throw 'Unable to locate the DeepSeek Harness installation. Pass -HarnessRoot or set DSH_HOME.'
}
$HarnessRoot = [IO.Path]::GetFullPath($HarnessRoot)

$pluginRoot = Split-Path $PSScriptRoot -Parent
$distRoot = Join-Path $HarnessRoot 'plugins\dist'
$pnpm = Join-Path $HarnessRoot 'runtime\pnpm.cmd'
$inspector = Join-Path $HarnessRoot 'security\Inspect-PluginPackage.ps1'

if (-not (Test-Path -LiteralPath $pnpm -PathType Leaf)) { $pnpm = 'pnpm' }

# --- refuse lifecycle scripts -------------------------------------------------
$manifest = Get-Content -LiteralPath (Join-Path $pluginRoot 'package.json') -Raw | ConvertFrom-Json
foreach ($name in @('preinstall', 'install', 'postinstall', 'prepare', 'prepack')) {
    if ($null -ne $manifest.scripts -and $null -ne $manifest.scripts.PSObject.Properties[$name]) {
        throw "dsh-token-pet package unexpectedly defines lifecycle script: $name"
    }
}

# --- pnpm pack into a staging dir --------------------------------------------
New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
$stagingRoot = Join-Path $distRoot ".pack-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
Push-Location $pluginRoot
try {
    $previousIgnoreScripts = $env:npm_config_ignore_scripts
    $env:npm_config_ignore_scripts = 'true'
    & $pnpm pack --pack-destination $stagingRoot
    if ($LASTEXITCODE -ne 0) { throw 'dsh-token-pet package creation failed.' }
} finally {
    $env:npm_config_ignore_scripts = $previousIgnoreScripts
    Pop-Location
}
$created = @(Get-ChildItem -LiteralPath $stagingRoot -Filter '*.tgz' -File)
if ($created.Count -ne 1) { throw 'Expected exactly one dsh-token-pet .tgz from pnpm pack.' }
$finalName = "$([IO.Path]::GetFileNameWithoutExtension($created[0].Name))-$(Get-Date -Format 'yyyyMMdd-HHmmss').tgz"
$finalPath = Join-Path $distRoot $finalName
if (Test-Path -LiteralPath $finalPath) { throw "Refusing to overwrite existing package: $finalPath" }
Move-Item -LiteralPath $created[0].FullName -Destination $finalPath
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

# --- run the security inspector on the tgz -----------------------------------
& $inspector -Package $finalPath
if (-not (Test-Path -LiteralPath $finalPath)) { throw "Build artifact missing: $finalPath" }
Write-Host "Built: $finalPath"
Write-Host 'Review the inspection report, then approve installation of the SAME tgz.'
exit 0
