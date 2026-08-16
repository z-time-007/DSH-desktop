[CmdletBinding()]
param(
    [string]$HarnessRoot = 'D:\path\to\deepseek-harness',
    [ValidateRange(1, 65535)]
    [int]$Port = 3080
)

# Standalone restart helper for the local DeepSeek Harness web service.
# Runs detached from the DSH host process so it survives the host being
# stopped: waits briefly, stops the verified loopback listener, starts the
# background starter (mutex-guarded, logs to logs\desktop-background.log),
# then polls the health endpoint.

$ErrorActionPreference = 'Stop'
$log = Join-Path $HarnessRoot 'logs\desktop-app-restart.log'
New-Item -ItemType Directory -Path (Split-Path $log -Parent) -Force | Out-Null
function Write-Log([string]$Message) {
    "[$([DateTimeOffset]::Now.ToString('o'))] $Message" | Add-Content -LiteralPath $log -Encoding UTF8
}

Write-Log "restart helper started for port $Port"
Start-Sleep -Seconds 6

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    $commandLine = [string]$process.CommandLine
    $verified = $commandLine -like "*$HarnessRoot*" -or
        ($commandLine -like "*bin.js*" -and $commandLine -like "*--host 127.0.0.1*")
    if ($verified) {
        Write-Log "stopping verified listener PID $($listener.OwningProcess)"
        Stop-Process -Id $listener.OwningProcess -Force
    } else {
        Write-Log "skipping unverified listener PID $($listener.OwningProcess): $commandLine"
    }
}
Start-Sleep -Seconds 2

$backgroundScript = Join-Path $HarnessRoot 'scripts\Start-DeepSeek-HarnessBackground.ps1'
Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $backgroundScript), '-Port', "$Port"
) | Out-Null
Write-Log "background starter launched: $backgroundScript"

$healthy = $false
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { $healthy = $true; break }
    } catch { }
}

Write-Log "health check result: healthy=$healthy"
if (-not $healthy) {
    Write-Log "log tail: $(Get-Content -LiteralPath (Join-Path $HarnessRoot 'logs\desktop-background.log') -Tail 20 -ErrorAction SilentlyContinue | Out-String)"
    exit 1
}
Write-Log "DSH is up at http://127.0.0.1:$Port"
exit 0
