import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

test('client bundle exposes a read-only automatic approval settings tab', async () => {
  let plugin
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        plugin = definition.factory((id) => {
          if (id === 'react') return { createElement() {}, useState() {}, useEffect() {} }
          throw new Error(`Unexpected module: ${id}`)
        })
      },
    },
  }
  delete globalThis.document
  try {
    await import(`../lib/client.js?test=${Date.now()}`)
    assert.deepEqual(plugin.inject, ['slots'])
    let injected
    const registrations = []
    plugin.apply({
      slots: {
        inject(name, callback) { injected = { name, callback } },
        register(metadata, component) { registrations.push({ metadata, component }); return () => {} },
      },
    })
    assert.equal(injected.name, 'settings.plugins.tab')
    assert.equal(typeof injected.callback(), 'function')
    assert.equal(registrations[0].metadata.id, 'safe-auto-approval')
    assert.equal(registrations[0].metadata.label, '自动审批')
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
