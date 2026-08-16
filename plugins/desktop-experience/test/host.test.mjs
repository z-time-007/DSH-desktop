import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../src/dsh-plugin.js'

function request(method, body = '', headers = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : [])
  req.method = method
  req.headers = headers
  return req
}

function response() {
  return {
    status: 0,
    headers: {},
    body: Buffer.alloc(0),
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; this.headersSent = true },
    end(body) { this.body = body ? Buffer.from(body) : Buffer.alloc(0); this.writableEnded = true },
  }
}

test('host registers bounded routes and rejects cross-origin configuration writes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-host-'))
  const routes = new Map()
  const ctx = {
    effect(register) { return register() },
    webServer: { register(definition) { routes.set(definition.path, definition.handler); return () => {} } },
  }
  try {
    await apply(ctx, { harnessRoot: root, imageProcessor: sharp })
    assert.deepEqual([...routes.keys()].sort(), [
      '/local-desktop-experience/config',
      '/local-desktop-experience/config.json',
      '/local-desktop-experience/wallpaper/clear',
      '/local-desktop-experience/wallpaper/current.webp',
      '/local-desktop-experience/wallpaper/import',
      '/local-desktop-experience/wallpaper/poster.png',
      '/local-desktop-experience/wallpaper/upload',
      '/local-desktop-experience/wallpapers.json',
    ])

    const getRes = response()
    await routes.get('/local-desktop-experience/config.json')(request('GET'), getRes)
    assert.equal(getRes.status, 200)
    assert.equal(JSON.parse(getRes.body).config.petVisible, false)

    const deniedRes = response()
    await routes.get('/local-desktop-experience/config')(
      request('POST', '{"petVisible":false}', { host: '127.0.0.1:3080', origin: 'https://evil.example', 'content-type': 'application/json' }),
      deniedRes,
    )
    assert.equal(deniedRes.status, 403)

    const allowedRes = response()
    await routes.get('/local-desktop-experience/config')(
      request('POST', '{"petVisible":false}', { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }),
      allowedRes,
    )
    assert.equal(allowedRes.status, 200)
    assert.equal(JSON.parse(allowedRes.body).config.petVisible, false)

    const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#17263f' } }).png().toBuffer()
    const uploadRes = response()
    await routes.get('/local-desktop-experience/wallpaper/upload')(
      request('POST', png, {
        host: '127.0.0.1:3080',
        origin: 'http://127.0.0.1:3080',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/octet-stream',
        'content-length': String(png.length),
        'x-dsh-file-name': encodeURIComponent('本地壁纸.png'),
      }),
      uploadRes,
    )
    assert.equal(uploadRes.status, 200)
    assert.equal(JSON.parse(uploadRes.body).result.originalName, '本地壁纸.png')

    const wrongTypeRes = response()
    await routes.get('/local-desktop-experience/wallpaper/upload')(
      request('POST', png, { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' }),
      wrongTypeRes,
    )
    assert.equal(wrongTypeRes.status, 415)
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
})
