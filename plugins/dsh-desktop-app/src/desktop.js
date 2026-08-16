/**
 * Desktop-integration module for @local/dsh-desktop-app.
 *
 * Registers agent tools that manage the desktop mode of the local DSH
 * installation. Two layers:
 *
 *   1. The installation's own security-reviewed desktop scripts (no script
 *      copies are bundled, so the plugin always drives the exact scripts that
 *      shipped with the install):
 *
 *        Install-DeepSeek-HarnessDesktop.ps1  logon autostart task + desktop shortcut
 *        Open-DeepSeek-HarnessDesktop.ps1     health check + start backend + app window
 *        Test-DeepSeek-HarnessDesktop.ps1     installation/health report
 *        Disable-DeepSeek-HarnessDesktop.ps1  remove task + shortcut (+ optional stop)
 *
 *   2. The native desktop application (dsh-desktop, built to
 *      `dsh-desktop/dist/DeepSeekHarness/DeepSeekHarness.exe`): when the
 *      packaged exe is present, `desktop_app_open` launches it instead of the
 *      legacy Edge/Chrome `--app=` window, and `desktop_app_install` points
 *      the desktop shortcut at the exe. The native app bootstraps the backend
 *      itself (health check + background starter).
 *
 * The harness root is auto-detected from DSH_HOME (<root>/data/dsh-home) and
 * can be overridden through the `harnessRoot` plugin config. Mutating tools
 * (install/disable) are gated by the DSH user-approval service through the
 * `tools/pre-execute` hook, mirroring the personal-assistant write gate.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { compileParameters, jsonOutput } from './tool-schema.js'

const execFileAsync = promisify(execFile)

const DESKTOP_SCRIPTS = [
  'Install-DeepSeek-HarnessDesktop.ps1',
  'Open-DeepSeek-HarnessDesktop.ps1',
  'Test-DeepSeek-HarnessDesktop.ps1',
  'Disable-DeepSeek-HarnessDesktop.ps1',
]

export { DESKTOP_SCRIPTS }

/** Default locations of the native desktop app exe; `nativeAppPath` overrides. */
export const NATIVE_APP_CANDIDATES = [
  'D:\\path\\to\\dsh-plugins\\dsh-desktop\\dist\\DeepSeekHarness\\DeepSeekHarness.exe',
]

/** Resolve the packaged native app executable (null when not built). Exported for tests. */
export function resolveNativeApp(config = {}) {
  if (config.nativeAppPath) {
    const candidate = resolve(config.nativeAppPath)
    return existsSync(candidate) ? candidate : null
  }
  return NATIVE_APP_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null
}

/** Fire-and-forget launch of the native app (single-instance focuses the window). */
async function launchNativeApp(config) {
  const exe = resolveNativeApp(config)
  if (!exe) return null
  const command = `Start-Process -FilePath '${exe}' -WorkingDirectory '${dirname(exe)}'`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    timeout: 30000,
  })
  return { nativeApp: true, executable: exe }
}

/** Repoint the desktop shortcut at the native exe (COM shell link rewrite). */
async function rewriteShortcutToNative(config) {
  const exe = resolveNativeApp(config)
  if (!exe) return { nativeApp: false, reason: 'native app executable not found' }
  const shortcutPath = join(process.env.USERPROFILE ?? '', 'Desktop', 'DeepSeek Harness.lnk')
  const command =
    `$p = '${shortcutPath}'; $s = (New-Object -ComObject WScript.Shell).CreateShortcut($p); ` +
    `$s.TargetPath = '${exe}'; $s.WorkingDirectory = '${dirname(exe)}'; ` +
    `$s.Description = 'DeepSeek Harness — native desktop application'; $s.IconLocation = '${exe},0'; $s.Save()`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    timeout: 30000,
  })
  return { nativeApp: true, executable: exe }
}

/** Tools that change Windows system-level objects; require one-time approval. */
export const MUTATING_TOOLS = new Set(['desktop_app_install', 'desktop_app_disable'])

/** Resolve the DeepSeek Harness installation root. Exported for tests. */
export function resolveHarnessRoot(config) {
  if (config.harnessRoot) {
    const root = resolve(config.harnessRoot)
    if (!existsSync(join(root, 'scripts'))) {
      throw new Error(`configured harnessRoot has no scripts directory: ${root}`)
    }
    return root
  }
  const home = process.env.DSH_HOME
  if (home) {
    const root = dirname(dirname(home))
    if (existsSync(join(root, 'scripts'))) return root
  }
  throw new Error('Unable to locate the DeepSeek Harness installation: configure harnessRoot or run inside a DSH process that sets DSH_HOME.')
}

function requireScripts(root) {
  const missing = DESKTOP_SCRIPTS.filter((name) => !existsSync(join(root, 'scripts', name)))
  if (missing.length > 0) {
    throw new Error(`DeepSeek Harness desktop scripts are missing under ${join(root, 'scripts')}: ${missing.join(', ')}`)
  }
}

async function runScript(config, scriptName, args, signal) {
  const root = resolveHarnessRoot(config)
  requireScripts(root)
  const script = join(root, 'scripts', scriptName)
  const result = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    {
      windowsHide: true,
      timeout: config.scriptTimeoutMs ?? 180000,
      maxBuffer: 16 * 1024 * 1024,
      ...(signal ? { signal } : {}),
    },
  )
  return {
    script: scriptName,
    harnessRoot: root,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

function registerTool(ctx, definition, invoke) {
  ctx.tools.register({
    ...definition,
    parameters: compileParameters(definition.parameters),
    output: jsonOutput,
    async execute(args, exec) {
      return invoke(args, exec.signal)
    },
  })
}

/** Mount the desktop-integration tools on the tools service. */
export function applyDesktopTools(ctx, config) {
  const defaultPort = config.port ?? 3080

  registerTool(
    ctx,
    {
      name: 'desktop_app_install',
      description:
        'Install DeepSeek Harness desktop mode for the current Windows user: a logon scheduled task that starts the loopback-only backend and a desktop shortcut that opens the native desktop application (DeepSeekHarness.exe when built, otherwise the legacy app window). Re-running repairs both. Changes Windows scheduled tasks and the desktop; requires one-time human approval.',
      parameters: {
        port: { type: 'integer', description: 'Loopback port the backend listens on. Defaults to 3080.', required: false },
      },
    },
    async (args, signal) => {
      const result = await runScript(config, 'Install-DeepSeek-HarnessDesktop.ps1', ['-Port', String(args.port ?? defaultPort)], signal)
      const shortcut = await rewriteShortcutToNative(config)
      return { ...result, nativeDesktopShortcut: shortcut }
    },
  )

  registerTool(
    ctx,
    {
      name: 'desktop_app_open',
      description:
        'Open DeepSeek Harness as a native desktop application: launches the packaged DeepSeekHarness.exe (which health-checks and starts the loopback backend itself, then opens the frameless app window). Falls back to the legacy Edge/Chrome app window only when the native app is not built.',
      parameters: {
        port: { type: 'integer', description: 'Loopback port. Defaults to 3080.', required: false },
      },
    },
    async (args, signal) => {
      const launched = await launchNativeApp(config)
      if (launched) return { ...launched, fallback: false }
      return {
        ...(await runScript(config, 'Open-DeepSeek-HarnessDesktop.ps1', ['-Port', String(args.port ?? defaultPort)], signal)),
        fallback: true,
        note: 'native app not built; used the legacy Edge/Chrome app window',
      }
    },
  )

  registerTool(
    ctx,
    {
      name: 'desktop_app_test',
      description:
        'Check the DeepSeek Harness desktop mode installation: scheduled task presence, run level, logon trigger, desktop shortcut, icon, backend health on the loopback port, and whether the native desktop app executable is present. Read-only.',
      parameters: {
        port: { type: 'integer', description: 'Loopback port. Defaults to 3080.', required: false },
      },
    },
    async (args, signal) => {
      const result = await runScript(config, 'Test-DeepSeek-HarnessDesktop.ps1', ['-Port', String(args.port ?? defaultPort)], signal)
      const native = resolveNativeApp(config)
      return {
        ...result,
        nativeDesktopApp: native
          ? { present: true, executable: native }
          : { present: false, note: 'native app not built (dsh-desktop)' },
      }
    },
  )

  registerTool(
    ctx,
    {
      name: 'desktop_app_disable',
      description:
        'Remove DeepSeek Harness desktop mode for the current Windows user: the logon scheduled task and the desktop shortcut. Does not stop a running backend unless stopNow is true. Changes Windows scheduled tasks and the desktop; requires one-time human approval.',
      parameters: {
        port: { type: 'integer', description: 'Loopback port. Defaults to 3080.', required: false },
        stopNow: { type: 'boolean', description: 'Also stop the verified loopback backend process. Defaults to false.', required: false },
      },
    },
    (args, signal) =>
      runScript(config, 'Disable-DeepSeek-HarnessDesktop.ps1', ['-Port', String(args.port ?? defaultPort), ...(args.stopNow ? ['-StopNow'] : [])], signal),
  )
}
