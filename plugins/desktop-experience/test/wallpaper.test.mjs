import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { ConfigStore } from '../src/config.js'
import { validateInboxName, WallpaperManager } from '../src/wallpaper.js'
import { Readable } from 'node:stream'

test('validateInboxName blocks traversal and unsafe formats', () => {
  assert.equal(validateInboxName('wallpaper.gif'), 'wallpaper.gif')
  assert.throws(() => validateInboxName('../wallpaper.png'))
  assert.throws(() => validateInboxName('wallpaper.svg'))
  assert.throws(() => validateInboxName('folder\\wallpaper.png'))
})

test('WallpaperManager accepts a bounded local upload and removes its staging file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wallpaper-upload-'))
  const inboxRoot = path.join(root, 'inbox')
  const assetsRoot = path.join(root, 'assets')
  const store = new ConfigStore(path.join(root, 'config.json'))
  try {
    await store.load()
    const manager = new WallpaperManager({ inboxRoot, assetsRoot, configStore: store, imageProcessor: sharp })
    const image = await sharp({ create: { width: 48, height: 32, channels: 4, background: '#10263d' } }).png().toBuffer()
    const result = await manager.upload('电脑图片.png', Readable.from([image]))
    assert.equal(result.originalName, '电脑图片.png')
    assert.match(result.asset, /^[a-f0-9]{64}\.webp$/u)
    assert.deepEqual((await fs.readdir(inboxRoot)).filter((name) => name.startsWith('.upload-')), [])
  } finally {
    sharp.cache(false)
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
})

test('WallpaperManager sanitizes a PNG into WebP plus a poster', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wallpaper-'))
  const inboxRoot = path.join(root, 'inbox')
  const assetsRoot = path.join(root, 'assets')
  const store = new ConfigStore(path.join(root, 'config.json'))
  try {
    await store.load()
    await fs.mkdir(inboxRoot, { recursive: true })
    await sharp({ create: { width: 64, height: 48, channels: 4, background: '#184b78' } })
      .png()
      .withMetadata({ comment: 'must be stripped' })
      .toFile(path.join(inboxRoot, 'safe.png'))
    const manager = new WallpaperManager({ inboxRoot, assetsRoot, configStore: store, imageProcessor: sharp })
    await manager.initialize()
    const result = await manager.import('safe.png')
    assert.match(result.asset, /^[a-f0-9]{64}\.webp$/u)
    assert.match(result.poster, /^[a-f0-9]{64}\.png$/u)
    assert.equal(store.get().wallpaperEnabled, true)
    const outputMetadata = await sharp(path.join(assetsRoot, result.asset)).metadata()
    assert.equal(outputMetadata.format, 'webp')
    assert.equal(outputMetadata.hasProfile, false)
  } finally {
    sharp.cache(false)
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
})

test('WallpaperManager preserves a bounded animation and creates a static fallback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wallpaper-animation-'))
  const inboxRoot = path.join(root, 'inbox')
  const assetsRoot = path.join(root, 'assets')
  const store = new ConfigStore(path.join(root, 'config.json'))
  try {
    await store.load()
    await fs.mkdir(inboxRoot, { recursive: true })
    const pixels = Buffer.alloc(4 * 4 * 4)
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const offset = (y * 4 + x) * 4
        pixels[offset] = y < 2 ? 255 : 0
        pixels[offset + 2] = y < 2 ? 0 : 255
        pixels[offset + 3] = 255
      }
    }
    await sharp(pixels, { raw: { width: 4, height: 4, channels: 4, pageHeight: 2 } })
      .gif({ delay: [100, 120], loop: 0 })
      .toFile(path.join(inboxRoot, 'animated.gif'))
    const manager = new WallpaperManager({ inboxRoot, assetsRoot, configStore: store, imageProcessor: sharp })
    const result = await manager.import('animated.gif')
    assert.equal(result.animated, true)
    assert.equal(result.frames, 2)
    const animatedMetadata = await sharp(path.join(assetsRoot, result.asset), { animated: true }).metadata()
    assert.equal(animatedMetadata.format, 'webp')
    assert.equal(animatedMetadata.pages, 2)
    const posterMetadata = await sharp(path.join(assetsRoot, result.poster)).metadata()
    assert.equal(posterMetadata.format, 'png')
    assert.equal(posterMetadata.pages, undefined)
  } finally {
    sharp.cache(false)
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
})
