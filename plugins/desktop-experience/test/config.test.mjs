import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ConfigStore, DEFAULT_CONFIG, mergeConfig, normalizeConfig } from '../src/config.js'

test('normalizeConfig clamps user-controlled values', () => {
  const value = normalizeConfig({
    petSize: 999,
    petPosition: 'center',
    petX: 3,
    petY: -2,
    petRefreshSeconds: 1,
    wallpaperOpacity: 1,
    wallpaperFit: 'stretch',
    wallpaperAsset: '../../bad.webp',
  })
  assert.equal(value.petSize, 180)
  assert.equal(value.petPosition, DEFAULT_CONFIG.petPosition)
  assert.equal(value.petX, 1)
  assert.equal(value.petY, 0)
  assert.equal(value.petRefreshSeconds, 30)
  assert.equal(value.wallpaperOpacity, 0.35)
  assert.equal(value.wallpaperFit, DEFAULT_CONFIG.wallpaperFit)
  assert.equal(value.wallpaperAsset, null)
})

test('free pet coordinates are accepted and persisted', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, { petPosition: 'free', petX: 0.27, petY: 0.61 })
  assert.equal(merged.petPosition, 'free')
  assert.equal(merged.petX, 0.27)
  assert.equal(merged.petY, 0.61)
})

test('mergeConfig ignores internal wallpaper path fields', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, {
    petVisible: false,
    wallpaperAsset: 'a'.repeat(64) + '.webp',
    wallpaperPoster: 'b'.repeat(64) + '.png',
  })
  assert.equal(merged.petVisible, false)
  assert.equal(merged.wallpaperAsset, null)
  assert.equal(merged.wallpaperPoster, null)
})

test('ConfigStore persists an atomic normalized document', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-config-'))
  const filePath = path.join(root, 'state', 'config.json')
  try {
    const store = new ConfigStore(filePath)
    await store.load()
    await store.update({ petSize: 120, dockVisible: false })
    const stored = JSON.parse(await fs.readFile(filePath, 'utf8'))
    assert.equal(stored.petSize, 120)
    assert.equal(stored.dockVisible, false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
