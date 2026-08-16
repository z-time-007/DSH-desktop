import os from 'node:os'
import path from 'node:path'
import { statfs } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { throwIfAborted } from './security.js'

const execFileAsync = promisify(execFile)
const WINDOWS_SECURITY_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$d=Get-MpComputerStatus',
  '$f=Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction',
  '[pscustomobject]@{defender=[pscustomobject]@{antivirusEnabled=$d.AntivirusEnabled;realTimeProtectionEnabled=$d.RealTimeProtectionEnabled;behaviorMonitorEnabled=$d.BehaviorMonitorEnabled;tamperProtected=$d.IsTamperProtected;signatureLastUpdated=$d.AntivirusSignatureLastUpdated};firewall=@($f)} | ConvertTo-Json -Compress -Depth 5',
].join(';')

function gib(value) {
  return Math.round((Number(value) / (1024 ** 3)) * 100) / 100
}

async function windowsSecuritySummary(signal) {
  if (process.platform !== 'win32') return { available: false, reason: 'Windows-only check' }
  try {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const { stdout } = await execFileAsync(powershell, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'RemoteSigned',
      '-Command', WINDOWS_SECURITY_SCRIPT,
    ], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 256 * 1024,
      signal,
      encoding: 'utf8',
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH },
    })
    return { available: true, ...JSON.parse(stdout.trim()) }
  } catch (error) {
    return { available: false, reason: error?.code ?? error?.name ?? 'query_failed' }
  }
}

export async function getComputerStatus({ workspaceRoot, signal }) {
  throwIfAborted(signal)
  const cpus = os.cpus()
  const memoryTotal = os.totalmem()
  const memoryFree = os.freemem()
  const fileSystem = await statfs(workspaceRoot)
  const totalBytes = Number(fileSystem.blocks) * Number(fileSystem.bsize)
  const freeBlocks = fileSystem.bavail ?? fileSystem.bfree
  const freeBytes = Number(freeBlocks) * Number(fileSystem.bsize)
  const interfaces = os.networkInterfaces()
  const network = Object.entries(interfaces)
    .map(([name, addresses]) => {
      const active = (addresses ?? []).filter((address) => !address.internal)
      return {
        name,
        activeAddressCount: active.length,
        families: [...new Set(active.map((address) => address.family))],
      }
    })
    .filter((entry) => entry.activeAddressCount > 0)

  const security = await windowsSecuritySummary(signal)
  throwIfAborted(signal)
  return {
    capturedAt: new Date().toISOString(),
    platform: { type: os.type(), release: os.release(), architecture: os.arch(), uptimeSeconds: Math.round(os.uptime()) },
    cpu: { model: cpus[0]?.model ?? 'unknown', logicalCores: cpus.length, loadAverage: os.loadavg() },
    memory: {
      totalGiB: gib(memoryTotal),
      freeGiB: gib(memoryFree),
      usedPercent: Math.round(((memoryTotal - memoryFree) / memoryTotal) * 10000) / 100,
    },
    workspaceDisk: {
      totalGiB: gib(totalBytes),
      freeGiB: gib(freeBytes),
      usedPercent: totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 10000) / 100 : null,
    },
    network: { activeInterfaces: network },
    security,
  }
}

export { WINDOWS_SECURITY_SCRIPT }
