/**
 * @local/dsh-desktop-app — DeepSeek Harness desktop-app mode.
 *
 * Host-side Cordis plugin: makes the DSH Web UI installable as a desktop
 * app (PWA manifest + service worker + official icons) and exposes agent
 * tools for desktop-mode integration (logon autostart, desktop shortcut,
 * address-bar-free app window).
 *
 * Official plugin contract: exports `name`, `inject`, and `apply(ctx, config)`.
 * Loaded through the `dsh.bundle.patch` row in this package's cordis.patch.yml
 * once installed into a DSH profile.
 */

import { applyPwa } from './pwa.js'
import { applyDesktopTools, MUTATING_TOOLS } from './desktop.js'

export const name = 'local-desktop-app'
export const inject = ['webServer', 'tools']

const DEFAULTS = {
  enabled: true,
  pwa: true,
  desktopTools: true,
  desktopToolsWriteApproval: true,
  appName: 'DeepSeek Harness',
  shortName: 'DSH',
  description: 'DeepSeek Harness — local agent harness',
  themeColor: '#0f1115',
  backgroundColor: '#0f1115',
  port: 3080,
  harnessRoot: undefined,
  nativeAppPath: undefined,
  scriptTimeoutMs: 180000,
}

function booleanOrDefault(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function stringOrDefault(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

export async function apply(ctx, rawConfig = {}) {
  const config = {
    ...DEFAULTS,
    ...rawConfig,
    enabled: booleanOrDefault(rawConfig.enabled, DEFAULTS.enabled),
    pwa: booleanOrDefault(rawConfig.pwa, DEFAULTS.pwa),
    desktopTools: booleanOrDefault(rawConfig.desktopTools, DEFAULTS.desktopTools),
    desktopToolsWriteApproval: booleanOrDefault(rawConfig.desktopToolsWriteApproval, DEFAULTS.desktopToolsWriteApproval),
    appName: stringOrDefault(rawConfig.appName, DEFAULTS.appName),
    shortName: stringOrDefault(rawConfig.shortName, DEFAULTS.shortName),
    description: stringOrDefault(rawConfig.description, DEFAULTS.description),
    themeColor: stringOrDefault(rawConfig.themeColor, DEFAULTS.themeColor),
    backgroundColor: stringOrDefault(rawConfig.backgroundColor, DEFAULTS.backgroundColor),
  }
  if (!config.enabled) return

  if (config.pwa) {
    await applyPwa(ctx, config)
  }

  if (config.desktopTools) {
    applyDesktopTools(ctx, config)
    if (config.desktopToolsWriteApproval) {
      ctx.on('tools/pre-execute', async (exec, next) => {
        const downstream = await next()
        if (downstream.kind !== 'allow' || !MUTATING_TOOLS.has(exec.name)) return downstream
        return {
          kind: 'ask',
          reason: 'Desktop-app integration changes Windows scheduled tasks or the desktop shortcut. Confirm this one operation.',
        }
      })
    }
  }
}
