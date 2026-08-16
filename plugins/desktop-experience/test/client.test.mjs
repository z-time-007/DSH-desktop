import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

test('client bundle registers the local settings tab and official overlay slots', async () => {
  let plugin
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {
    dshDesktop: { pet: { open() {} } },
    __ModuleLoader__: {
      load(definition) {
        assert.equal(definition.id, '@local/dsh-desktop-experience')
        plugin = definition.factory((id) => {
          if (id === 'react') return { createElement() {}, useState() {}, useEffect() {}, useCallback() {}, useRef() {} }
          throw new Error(`Unexpected browser module request: ${id}`)
        })
      },
    },
  }
  delete globalThis.document
  try {
    await import(`../lib/client.js?test=${Date.now()}`)
    assert.deepEqual(plugin.inject, ['slots', 'layout'])
    const injected = []
    const registered = []
    const ctx = {
      layout: { toggleSidebar() {}, closeDetails() {}, openDetails() {} },
      slots: {
        inject(name, registration) { injected.push({ name, registration }) },
        register(metadata, component) {
          registered.push({ metadata, component })
          return () => {}
        },
      },
    }
    plugin.apply(ctx)
    assert.deepEqual(injected.map((entry) => entry.name), [
      'settings.plugins.tab',
      'settings.plugins.tab',
      'settings.plugins.tab',
      'shell.overlay',
    ])

    for (const entry of injected.slice(0, 3)) {
      const settingsRegistration = entry.registration()
      assert.equal(typeof settingsRegistration, 'function')
    }
    const overlays = injected[3].registration()
    for (const disposer of overlays) assert.equal(typeof disposer, 'function')
    assert.deepEqual(registered.map((entry) => entry.metadata.id), [
      'local-plugins',
      'local-token-pet-settings',
      'local-wallpaper-settings',
      'local-wallpaper',
      'local-desktop-dock',
      'local-token-pet',
    ])
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('package exports the manifest path required by DSH client discovery', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.exports['./package.json'], './package.json')
  assert.equal(manifest.exports['./client'], './lib/client.js')
})

test('desktop dock shows names, separates layout and appearance controls, and stays dark', async () => {
  const client = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /\.dxe-dock\{[^}]*background:rgba\(15,17,21,\.94\)/u)
  assert.match(client, /dxe-dock-divider/u)
  assert.match(client, /h\("span", null, label\)/u)
  assert.match(client, /"aria-label": label/u)
})

test('client includes free pet movement, cache metrics, native pet entry, and local file import', async () => {
  const client = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /petPosition: "free"/u)
  assert.match(client, /缓存命中/u)
  assert.match(client, /dshDesktop\.pet\.open/u)
  assert.match(client, /if \(!window\.dshDesktop\) return/u)
  assert.match(client, /"桌面桌宠"/u)
  assert.match(client, /wallpaper\/upload/u)
  assert.match(client, /type: "file"/u)
  assert.match(client, /NATIVE_PET_MODE/u)
  assert.match(client, /dshDesktop\.pet\.dragStart/u)
  assert.match(client, /dshDesktop\.pet\.pointerInteractive/u)
  assert.match(client, /dshDesktop\.pet\.onRefresh/u)
  assert.match(client, /dshDesktop\.pet\.reset/u)
  assert.match(client, /local-token-pet-native/u)
})

test('desktop pet upgrade preserves every existing pet, dock, settings, and wallpaper capability', async () => {
  const client = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const requiredLabels = [
    'DEEPSEEK 余额',
    '总用量',
    '输入 / 输出',
    '缓存写入',
    '缓存命中',
    '桌面桌宠',
    '窗口内桌宠（兼容）',
    '数据刷新',
    '侧边栏',
    '收起详情',
    '壁纸',
    '从本地导入壁纸',
  ]
  for (const label of requiredLabels) assert.match(client, new RegExp(label, 'u'))
  assert.match(client, /setOpen\(\(value\) => !value\)/u)
  assert.match(client, /dragStart/u)
  assert.match(client, /dragMove/u)
  assert.match(client, /dragEnd/u)
  assert.match(client, /showMenu/u)
  assert.match(client, /petRefreshSeconds/u)
  assert.match(client, /wallpaper\/upload/u)
})

test('native pet mode registers only the existing Experience pet overlay', async () => {
  let plugin
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {
    location: { search: '?dshNativePet=1' },
    dshDesktop: { pet: { open() {}, reset() {}, pointerInteractive() {}, onRefresh() { return () => {} }, dragStart() {}, dragMove() {}, dragEnd() {}, showMenu() {} } },
    __ModuleLoader__: {
      load(definition) {
        plugin = definition.factory((id) => {
          if (id === 'react') return { createElement() {}, useState() {}, useEffect() {}, useCallback() {}, useRef() {} }
          throw new Error(`Unexpected browser module request: ${id}`)
        })
      },
    },
  }
  delete globalThis.document
  try {
    await import(`../lib/client.js?native-pet=${Date.now()}`)
    const injected = []
    const registered = []
    const ctx = {
      slots: {
        inject(name, registration) { injected.push({ name, registration }) },
        register(metadata) { registered.push(metadata); return () => {} },
      },
    }
    plugin.apply(ctx)
    assert.deepEqual(injected.map((entry) => entry.name), ['shell.overlay'])
    for (const disposer of injected[0].registration()) assert.equal(typeof disposer, 'function')
    assert.deepEqual(registered.map((entry) => entry.id), ['local-token-pet-native'])
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})
