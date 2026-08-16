/**
 * Unit tests for @local/dsh-desktop-app. Run with:
 *   node --test test/*.test.mjs
 *
 * Tests are offline and never start the DSH server, invoke the desktop
 * scripts, or touch Windows system state.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildManifest, injectIntoIndex, SERVICE_WORKER, BOOTSTRAP, applyPwa } from '../src/pwa.js'
import { resolveHarnessRoot, resolveNativeApp, MUTATING_TOOLS, DESKTOP_SCRIPTS } from '../src/desktop.js'
import { compileParameters } from '../src/tool-schema.js'
import * as plugin from '../src/dsh-plugin.js'

const ASSET_DIR = fileURLToPath(new URL('../assets/', import.meta.url))

function makeFakeHarness() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-app-test-'))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'data', 'dsh-home'), { recursive: true })
  for (const name of DESKTOP_SCRIPTS) {
    // Placeholder scripts; the desktop module only checks existence.
    writeFileSync(join(root, 'scripts', name), '# placeholder\n')
  }
  return root
}

test('manifest: correct install metadata and icons', () => {
  const manifest = buildManifest({
    appName: 'DeepSeek Harness',
    shortName: 'DSH',
    description: 'desc',
    themeColor: '#0f1115',
    backgroundColor: '#0f1115',
  })
  assert.equal(manifest.name, 'DeepSeek Harness')
  assert.equal(manifest.short_name, 'DSH')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.theme_color, '#0f1115')
  assert.equal(manifest.icons.length, 3)
  const anyIcons = manifest.icons.filter((icon) => icon.purpose === 'any')
  assert.deepEqual(anyIcons.map((icon) => icon.sizes).sort(), ['192x192', '512x512'])
  const maskable = manifest.icons.find((icon) => icon.purpose === 'maskable')
  assert.equal(maskable.sizes, '512x512')
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith('/dsh-app-icon-')))
})

test('index tap: injects once and is idempotent', () => {
  const config = { themeColor: '#0f1115' }
  const html = '<!doctype html><html><head>\n    <meta charset="utf-8" />\n  </head><body></body></html>'
  const once = injectIntoIndex(html, config)
  assert.ok(once.includes('<link rel="manifest" href="/dsh-app.webmanifest" />'))
  assert.ok(once.includes('<meta name="theme-color" content="#0f1115" />'))
  assert.ok(once.includes('<script src="/dsh-app-bootstrap.js" defer></script>'))
  assert.ok(once.includes('<meta charset="utf-8" />'))
  assert.equal(injectIntoIndex(once, config), once, 'second pass must not re-inject')
})

test('service worker and bootstrap are pass-through, non-caching', () => {
  assert.ok(SERVICE_WORKER.includes("self.addEventListener('fetch'"))
  assert.ok(SERVICE_WORKER.includes('fetch(event.request)'))
  assert.ok(!SERVICE_WORKER.includes('caches.'))
  assert.ok(BOOTSTRAP.includes("navigator.serviceWorker.register('/dsh-app-sw.js'"))
})

test('tool schema adapter produces standard JSON Schema', () => {
  const schema = compileParameters({
    port: { type: 'integer', description: 'loopback port', required: false },
    stopNow: { type: 'boolean', description: 'stop backend', required: false },
  })
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.port.type, 'integer')
  assert.equal(schema.properties.stopNow.type, 'boolean')
  assert.equal(schema.required, undefined)
})

test('harness root: explicit config wins', () => {
  const root = makeFakeHarness()
  try {
    assert.equal(resolveHarnessRoot({ harnessRoot: root }), root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('harness root: DSH_HOME fallback derives the install root', () => {
  const root = makeFakeHarness()
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = join(root, 'data', 'dsh-home')
    assert.equal(resolveHarnessRoot({}), root)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('harness root: throws when no install is discoverable', () => {
  const previous = process.env.DSH_HOME
  try {
    delete process.env.DSH_HOME
    assert.throws(() => resolveHarnessRoot({}), /Unable to locate/)
    assert.throws(() => resolveHarnessRoot({ harnessRoot: tmpdir() }), /has no scripts directory/)
  } finally {
    if (previous !== undefined) process.env.DSH_HOME = previous
  }
})

test('mutating tool set covers install and disable only', () => {
  assert.deepEqual([...MUTATING_TOOLS].sort(), ['desktop_app_disable', 'desktop_app_install'])
})

test('native app: explicit nativeAppPath wins when the file exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-app-test-'))
  try {
    const exe = join(root, 'DeepSeekHarness.exe')
    writeFileSync(exe, '# fake exe\n')
    assert.equal(resolveNativeApp({ nativeAppPath: exe }), exe)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('native app: missing configured path resolves to null (no silent fallback)', () => {
  const missing = join(tmpdir(), 'definitely-missing', 'DeepSeekHarness.exe')
  assert.equal(resolveNativeApp({ nativeAppPath: missing }), null)
})

test('plugin entry exposes the official contract', () => {
  assert.equal(plugin.name, 'local-desktop-app')
  assert.deepEqual(plugin.inject, ['webServer', 'tools'])
  assert.equal(typeof plugin.apply, 'function')
})

test('plugin apply is inert when disabled', async () => {
  const touched = []
  const ctx = {
    on: () => touched.push('on'),
    effect: () => touched.push('effect'),
    tools: { register: () => touched.push('tools.register') },
    webServer: {},
  }
  const result = await plugin.apply(ctx, { enabled: false })
  assert.equal(result, undefined)
  assert.deepEqual(touched, [], 'disabled plugin must not touch services')
})

test('pwa smoke: registers routes and index tap on the webServer service', async (t) => {
  if (!existsSync(join(ASSET_DIR, 'dsh-app-icon-192.png'))) {
    t.skip('assets not generated yet; run build/Generate-DshAppIcons.mjs first')
    return
  }
  const routes = []
  const taps = []
  const webServer = {
    register: (route) => {
      routes.push(route)
      return () => {}
    },
    tapIndex: (fn) => {
      taps.push(fn)
      return () => {}
    },
  }
  const ctx = {
    webServer,
    effect: (fn) => {
      const dispose = fn()
      assert.equal(typeof dispose, 'function')
    },
  }
  await applyPwa(ctx, { appName: 'A', shortName: 'S', description: 'd', themeColor: '#000000', backgroundColor: '#000000' })
  assert.equal(routes.length, 6)
  const paths = routes.map((route) => route.path).sort()
  assert.deepEqual(paths, [
    '/dsh-app-bootstrap.js',
    '/dsh-app-icon-192.png',
    '/dsh-app-icon-512.png',
    '/dsh-app-icon-maskable-512.png',
    '/dsh-app-sw.js',
    '/dsh-app.webmanifest',
  ])
  assert.equal(taps.length, 1)
  assert.ok(taps[0]('<head>x</head>').includes('rel="manifest"'))
})
