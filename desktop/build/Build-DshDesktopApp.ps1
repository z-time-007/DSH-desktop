[CmdletBinding()]
param(
    # Project root (the folder containing main.js).
    [string]$AppRoot = (Split-Path $PSScriptRoot -Parent),
    # Electron runtime dist to copy (the project's own install, else the pet app's).
    [string]$ElectronDist = '',
    # Where the portable app folder is produced.
    [string]$OutputRoot = '',
    # Harness whale icon for the shortcut / window.
    [string]$WhaleIco = 'D:\path\to\deepseek-harness\assets\dsh-black-whale.ico',
    # Set to true to skip writing the desktop shortcut (e.g. CI).
    [switch]$SkipShortcut
)

$ErrorActionPreference = 'Stop'

if (-not $ElectronDist) {
    $own = Join-Path $AppRoot 'node_modules\electron\dist'
    $pet = 'D:\path\to\dsh-plugins\dsh-token-pet-app\node_modules\electron\dist'
    if (Test-Path -LiteralPath (Join-Path $own 'electron.exe') -PathType Leaf) { $ElectronDist = $own }
    elseif (Test-Path -LiteralPath (Join-Path $pet 'electron.exe') -PathType Leaf) { $ElectronDist = $pet }
    else { throw 'Unable to locate an Electron runtime dist (electron.exe). Install with pnpm install or pass -ElectronDist.' }
}
if (-not $OutputRoot) { $OutputRoot = Join-Path $AppRoot 'dist' }
$appDir = Join-Path $OutputRoot 'DeepSeekHarness'
$exePath = Join-Path $appDir 'DeepSeekHarness.exe'
$resourcesAppDir = Join-Path $appDir 'resources\app'
$assetsDir = Join-Path $AppRoot 'assets'

# --- validate inputs --------------------------------------------------------
if (-not (Test-Path -LiteralPath (Join-Path $ElectronDist 'electron.exe') -PathType Leaf)) {
    throw "Electron runtime not found at: $ElectronDist (electron.exe missing)."
}
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'main.js') -PathType Leaf)) {
    throw "App main.js missing under: $AppRoot"
}

# --- copy the Electron runtime ----------------------------------------------
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
if (Test-Path -LiteralPath $appDir) {
    Write-Host "Removing previous build at $appDir"
    Remove-Item -LiteralPath $appDir -Recurse -Force
}
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

# robocopy: exit codes 0-7 are success; 8+ are failures.
& robocopy $ElectronDist $appDir /E /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

# --- rename the binary so the app has its own process identity ---------------
$electronExe = Join-Path $appDir 'electron.exe'
if (-not (Test-Path -LiteralPath $electronExe -PathType Leaf)) { throw 'electron.exe missing after copy.' }
Move-Item -LiteralPath $electronExe -Destination $exePath -Force

# Drop the default Electron placeholder app.
$defaultApp = Join-Path $appDir 'resources\default_app.asar'
if (Test-Path -LiteralPath $defaultApp -PathType Leaf) { Remove-Item -LiteralPath $defaultApp -Force }

# --- stage the app sources into resources\app --------------------------------
New-Item -ItemType Directory -Path $resourcesAppDir -Force | Out-Null
foreach ($item in @('main.js', 'preload.js', 'renderer', 'package.json')) {
    $src = Join-Path $AppRoot $item
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination $resourcesAppDir -Recurse -Force
    }
}
New-Item -ItemType Directory -Path (Join-Path $resourcesAppDir 'assets') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $assetsDir 'dsh-black-whale.ico') -Destination (Join-Path $resourcesAppDir 'assets') -Force
Copy-Item -LiteralPath (Join-Path $assetsDir 'dsh-app-icon-192.png') -Destination (Join-Path $resourcesAppDir 'assets') -Force
Copy-Item -LiteralPath (Join-Path $assetsDir 'dsh-app-icon-512.png') -Destination (Join-Path $resourcesAppDir 'assets') -Force
Copy-Item -LiteralPath (Join-Path $assetsDir 'dsh-app-icon-maskable-512.png') -Destination (Join-Path $resourcesAppDir 'assets') -Force

# --- desktop shortcut (replaces the old browser-shell entry) -----------------
$shortcutCreated = $false
if (-not $SkipShortcut) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop 'DeepSeek Harness.lnk'
    $shell = New-Object -ComObject WScript.Shell

    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        $existing = $shell.CreateShortcut($shortcutPath)
        $ownedByUs = $existing.TargetPath -ieq $exePath
        $legacyOwned = ($existing.TargetPath -ieq (Join-Path $PSHOME 'powershell.exe')) -and
            ($existing.Arguments -like '*Open-DeepSeek-HarnessDesktop.ps1*')
        if (-not ($ownedByUs -or $legacyOwned)) {
            throw "Desktop shortcut 'DeepSeek Harness.lnk' exists but is not owned by this project. Refusing to overwrite it."
        }
    }

    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exePath
    $shortcut.WorkingDirectory = $appDir
    $shortcut.Description = 'DeepSeek Harness — native desktop application'
    $iconPath = Join-Path $resourcesAppDir 'assets\dsh-black-whale.ico'
    if (Test-Path -LiteralPath $iconPath -PathType Leaf) { $shortcut.IconLocation = "$iconPath,0" }
    $shortcut.Save()
    $shortcutCreated = Test-Path -LiteralPath $shortcutPath -PathType Leaf
}

# --- verify ---------------------------------------------------------------
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) { throw 'Packaged executable missing after build.' }
if (-not (Test-Path -LiteralPath (Join-Path $resourcesAppDir 'main.js') -PathType Leaf)) { throw 'resources\app\main.js missing.' }

[pscustomobject]@{
    Executable = $exePath
    AppDir     = $appDir
    Shortcut   = if ($shortcutCreated) { Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeepSeek Harness.lnk' } else { '(skipped)' }
    Runtime    = $ElectronDist
} | Format-List
Write-Host 'Built. Launch DeepSeekHarness.exe to run the native desktop app.'
exit 0
