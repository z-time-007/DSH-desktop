[CmdletBinding()]
param(
    [string]$HarnessRoot = '',
    [switch]$SkipIcons
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
$node = Join-Path $HarnessRoot 'runtime\node.exe'
$inspector = Join-Path $HarnessRoot 'security\Inspect-PluginPackage.ps1'

if (-not (Test-Path -LiteralPath $pnpm -PathType Leaf)) { $pnpm = 'pnpm' }
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { $node = 'node' }

# --- 1. generate PWA icons from the official favicon ------------------------
if (-not $SkipIcons) {
    $favicon = $null
    $farmFavicon = Join-Path $HarnessRoot 'data\dsh-home\profiles\node_modules\@deepseek-ai\dsh-web-frontend\dist\favicon.svg'
    if (Test-Path -LiteralPath $farmFavicon -PathType Leaf) { $favicon = $farmFavicon }
    if (-not $favicon) {
        $found = @(Get-ChildItem -LiteralPath (Join-Path $HarnessRoot 'node_modules\.pnpm') -Recurse -Filter 'favicon.svg' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -like '*dsh-web-frontend*' } | Select-Object -First 1)
        if ($found.Count -eq 1) { $favicon = $found[0].FullName }
    }
    if (-not $favicon) { throw "Official DSH favicon not found under $HarnessRoot" }
    $sharpDir = Join-Path $HarnessRoot 'node_modules\sharp'
    if (-not (Test-Path -LiteralPath (Join-Path $sharpDir 'package.json') -PathType Leaf)) {
        throw "sharp package not found: $sharpDir"
    }
    & $node "$pluginRoot\build\Generate-DshAppIcons.mjs" $favicon $sharpDir (Join-Path $pluginRoot 'assets')
    if ($LASTEXITCODE -ne 0) { throw 'PWA icon generation failed.' }
}

# --- 2. refuse lifecycle scripts ---------------------------------------------
$manifest = Get-Content -LiteralPath (Join-Path $pluginRoot 'package.json') -Raw | ConvertFrom-Json
foreach ($name in @('preinstall', 'install', 'postinstall', 'prepare', 'prepack')) {
    if ($null -ne $manifest.scripts -and $null -ne $manifest.scripts.PSObject.Properties[$name]) {
        throw "dsh-desktop-app package unexpectedly defines lifecycle script: $name"
    }
}

# --- 3. pnpm pack into a staging dir ----------------------------------------
New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
$stagingRoot = Join-Path $distRoot ".pack-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
Push-Location $pluginRoot
try {
    $previousIgnoreScripts = $env:npm_config_ignore_scripts
    $env:npm_config_ignore_scripts = 'true'
    & $pnpm pack --pack-destination $stagingRoot
    if ($LASTEXITCODE -ne 0) { throw 'dsh-desktop-app package creation failed.' }
} finally {
    $env:npm_config_ignore_scripts = $previousIgnoreScripts
    Pop-Location
}
$created = @(Get-ChildItem -LiteralPath $stagingRoot -Filter '*.tgz' -File)
if ($created.Count -ne 1) { throw 'Expected exactly one dsh-desktop-app .tgz from pnpm pack.' }
$finalName = "$([IO.Path]::GetFileNameWithoutExtension($created[0].Name))-$(Get-Date -Format 'yyyyMMdd-HHmmss').tgz"
$finalPath = Join-Path $distRoot $finalName
if (Test-Path -LiteralPath $finalPath) { throw "Refusing to overwrite existing package: $finalPath" }
Move-Item -LiteralPath $created[0].FullName -Destination $finalPath
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

# --- 4. run the security inspector on the tgz --------------------------------
& $inspector -Package $finalPath
if (-not (Test-Path -LiteralPath $finalPath)) { throw "Build artifact missing: $finalPath" }
Write-Host "Built: $finalPath"
Write-Host "Review the inspection report, then approve installation of the SAME tgz."
exit 0
