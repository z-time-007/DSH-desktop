import fs from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_CONFIG = Object.freeze({
  dockVisible: true,
  petVisible: false,
  petSize: 112,
  petPosition: 'bottom-right',
  petX: 0.86,
  petY: 0.82,
  petRefreshSeconds: 60,
  wallpaperEnabled: false,
  wallpaperOpacity: 0.14,
  wallpaperBlur: 0,
  wallpaperGlass: 0,
  inputOpacity: 100,
  sidebarOpacity: 100,
  wallpaperFit: 'cover',
  wallpaperAsset: null,
  wallpaperPoster: null,
  wallpaperAnimated: false,
})

const POSITIONS = new Set(['bottom-right', 'bottom-left', 'top-right', 'top-left', 'free'])
const FITS = new Set(['cover', 'contain'])

function clampNumber(value, fallback, min, max, integer = false) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const bounded = Math.min(max, Math.max(min, parsed))
  return integer ? Math.round(bounded) : Math.round(bounded * 100) / 100
}

function safeAssetName(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^[a-f0-9]{64}\.(?:webp|png)$/u.test(value)) return null
  return value
}

export function normalizeConfig(value = {}) {
  return {
    dockVisible: typeof value.dockVisible === 'boolean' ? value.dockVisible : DEFAULT_CONFIG.dockVisible,
    petVisible: typeof value.petVisible === 'boolean' ? value.petVisible : DEFAULT_CONFIG.petVisible,
    petSize: clampNumber(value.petSize, DEFAULT_CONFIG.petSize, 72, 180, true),
    petPosition: POSITIONS.has(value.petPosition) ? value.petPosition : DEFAULT_CONFIG.petPosition,
    petX: clampNumber(value.petX, DEFAULT_CONFIG.petX, 0, 1),
    petY: clampNumber(value.petY, DEFAULT_CONFIG.petY, 0, 1),
    petRefreshSeconds: clampNumber(value.petRefreshSeconds, DEFAULT_CONFIG.petRefreshSeconds, 30, 300, true),
    wallpaperEnabled: typeof value.wallpaperEnabled === 'boolean' ? value.wallpaperEnabled : DEFAULT_CONFIG.wallpaperEnabled,
    wallpaperOpacity: clampNumber(value.wallpaperOpacity, DEFAULT_CONFIG.wallpaperOpacity, 0.05, 0.35),
    wallpaperBlur: clampNumber(value.wallpaperBlur, DEFAULT_CONFIG.wallpaperBlur, 0, 40, true),
    wallpaperGlass: clampNumber(value.wallpaperGlass, DEFAULT_CONFIG.wallpaperGlass, 0, 100, true),
    inputOpacity: clampNumber(value.inputOpacity, DEFAULT_CONFIG.inputOpacity, 0, 100, true),
    sidebarOpacity: clampNumber(value.sidebarOpacity, DEFAULT_CONFIG.sidebarOpacity, 0, 100, true),
    wallpaperFit: FITS.has(value.wallpaperFit) ? value.wallpaperFit : DEFAULT_CONFIG.wallpaperFit,
    wallpaperAsset: safeAssetName(value.wallpaperAsset),
    wallpaperPoster: safeAssetName(value.wallpaperPoster),
    wallpaperAnimated: typeof value.wallpaperAnimated === 'boolean' ? value.wallpaperAnimated : false,
  }
}

export function mergeConfig(current, patch) {
  const allowed = new Set([
    'dockVisible', 'petVisible', 'petSize', 'petPosition', 'petX', 'petY', 'petRefreshSeconds',
    'wallpaperEnabled', 'wallpaperOpacity', 'wallpaperBlur', 'wallpaperGlass', 'inputOpacity', 'sidebarOpacity', 'wallpaperFit',
  ])
  const next = { ...current }
  for (const [key, value] of Object.entries(patch || {})) {
    if (allowed.has(key)) next[key] = value
  }
  return normalizeConfig(next)
}

export class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath
    this.value = { ...DEFAULT_CONFIG }
    this.writeChain = Promise.resolve()
  }

  async load() {
    try {
      const text = await fs.readFile(this.filePath, 'utf8')
      this.value = normalizeConfig(JSON.parse(text))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await this.save(this.value)
    }
    return this.get()
  }

  get() {
    return { ...this.value }
  }

  async update(patch) {
    return this.save(mergeConfig(this.value, patch))
  }

  async setWallpaper({ asset, poster, animated }) {
    return this.save(normalizeConfig({
      ...this.value,
      wallpaperAsset: asset,
      wallpaperPoster: poster,
      wallpaperAnimated: Boolean(animated),
      wallpaperEnabled: true,
    }))
  }

  async clearWallpaper() {
    return this.save(normalizeConfig({
      ...this.value,
      wallpaperAsset: null,
      wallpaperPoster: null,
      wallpaperAnimated: false,
      wallpaperEnabled: false,
    }))
  }

  async save(next) {
    const normalized = normalizeConfig(next)
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await fs.rename(temporary, this.filePath)
      this.value = normalized
    })
    await this.writeChain
    return this.get()
  }
}
