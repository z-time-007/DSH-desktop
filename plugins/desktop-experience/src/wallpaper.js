import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif'])
const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_OUTPUT_BYTES = 30 * 1024 * 1024
const MAX_SIDE = 8000
const MAX_FRAME_PIXELS = 40_000_000
const MAX_FRAMES = 300
const MAX_TOTAL_PIXELS = 120_000_000
const MAX_DURATION_MS = 60_000

export function validateInboxName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 180) throw new Error('文件名无效。')
  if (path.basename(value) !== value || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw new Error('只允许收件箱中的单个文件名。')
  }
  const extension = path.extname(value).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error('只支持 PNG、JPEG、WebP 和 GIF。')
  return value
}

async function assertRegularFile(filePath, root) {
  const rootPath = path.resolve(root)
  const resolved = path.resolve(filePath)
  if (resolved !== path.join(rootPath, path.basename(resolved))) throw new Error('文件路径越界。')
  const stats = await fs.lstat(resolved)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('符号链接和非普通文件不允许导入。')
  if (stats.size < 1 || stats.size > MAX_INPUT_BYTES) throw new Error('壁纸文件必须在 1 B 到 20 MiB 之间。')
  return stats
}

function inspectMetadata(metadata, inputName) {
  if (!ALLOWED_FORMATS.has(metadata.format)) throw new Error('图片内容格式与允许列表不符。')
  const extension = path.extname(inputName).toLowerCase()
  const expected = extension === '.jpg' ? '.jpeg' : extension
  if (`.${metadata.format}` !== expected) throw new Error('文件扩展名与图片真实格式不一致。')
  const width = Number(metadata.width || 0)
  const pageHeight = Number(metadata.pageHeight || metadata.height || 0)
  const frames = Number(metadata.pages || 1)
  if (width < 1 || pageHeight < 1 || width > MAX_SIDE || pageHeight > MAX_SIDE) throw new Error('图片边长超出 8000 像素限制。')
  if (width * pageHeight > MAX_FRAME_PIXELS) throw new Error('单帧像素数超过 4000 万限制。')
  if (frames < 1 || frames > MAX_FRAMES) throw new Error('动画帧数超过 300 帧限制。')
  if (width * pageHeight * frames > MAX_TOTAL_PIXELS) throw new Error('动画总解码像素超过 1.2 亿限制。')
  const duration = Array.isArray(metadata.delay) ? metadata.delay.reduce((sum, delay) => sum + Number(delay || 0), 0) : 0
  if (duration > MAX_DURATION_MS) throw new Error('动画时长超过 60 秒限制。')
  return { width, height: pageHeight, frames, duration, animated: frames > 1 }
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export class WallpaperManager {
  constructor({ inboxRoot, assetsRoot, configStore, imageProcessor }) {
    // sharp may be absent on machines without it installed — never throw here,
    // otherwise the whole plugin tree (and the DSH app) fails to start.
    this.inboxRoot = inboxRoot
    this.assetsRoot = assetsRoot
    this.configStore = configStore
    this.sharp = typeof imageProcessor === 'function' ? imageProcessor : null
  }

  async initialize() {
    await fs.mkdir(this.inboxRoot, { recursive: true })
    await fs.mkdir(this.assetsRoot, { recursive: true })
  }

  async list() {
    await this.initialize()
    const entries = await fs.readdir(this.inboxRoot, { withFileTypes: true })
    const inbox = entries
      .filter((entry) => entry.isFile() && ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return { inbox, current: this.configStore.get() }
  }

  async import(fileName) {
    await this.initialize()
    if (!this.sharp) throw new Error('壁纸处理组件（sharp）未安装，壁纸功能不可用；其它功能不受影响。')
    const safeName = validateInboxName(fileName)
    const inputPath = path.join(this.inboxRoot, safeName)
    await assertRegularFile(inputPath, this.inboxRoot)
    const metadata = await this.sharp(inputPath, { animated: true, failOn: 'warning', limitInputPixels: MAX_TOTAL_PIXELS }).metadata()
    const inspected = inspectMetadata(metadata, safeName)
    const digest = await hashFile(inputPath)
    const assetName = `${digest}.webp`
    const posterName = `${digest}.png`
    const assetPath = path.join(this.assetsRoot, assetName)
    const posterPath = path.join(this.assetsRoot, posterName)

    const animated = this.sharp(inputPath, {
      animated: inspected.animated,
      failOn: 'warning',
      limitInputPixels: MAX_TOTAL_PIXELS,
    }).rotate().resize({ width: 3840, height: 2160, fit: 'inside', withoutEnlargement: true })

    await animated.webp({ quality: 84, alphaQuality: 90, effort: 4, loop: 0 }).toFile(assetPath)
    await this.sharp(inputPath, { page: 0, pages: 1, failOn: 'warning', limitInputPixels: MAX_FRAME_PIXELS })
      .rotate()
      .resize({ width: 3840, height: 2160, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toFile(posterPath)

    const output = await fs.stat(assetPath)
    if (output.size > MAX_OUTPUT_BYTES) {
      await Promise.allSettled([fs.unlink(assetPath), fs.unlink(posterPath)])
      throw new Error('安全转码后的壁纸超过 30 MiB，已拒绝。')
    }
    await this.configStore.setWallpaper({ asset: assetName, poster: posterName, animated: inspected.animated })
    return { asset: assetName, poster: posterName, ...inspected, bytes: output.size }
  }

  async upload(fileName, readable) {
    await this.initialize()
    const safeName = validateInboxName(fileName)
    const extension = path.extname(safeName).toLowerCase()
    const stagedName = `.upload-${crypto.randomUUID()}${extension}`
    const stagedPath = path.join(this.inboxRoot, stagedName)
    let handle
    let bytes = 0
    try {
      handle = await fs.open(stagedPath, 'wx', 0o600)
      for await (const chunk of readable) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > MAX_INPUT_BYTES) throw new Error('壁纸文件超过 20 MiB 限制。')
        await handle.write(buffer)
      }
      await handle.close()
      handle = null
      if (bytes < 1) throw new Error('壁纸文件为空。')
      const result = await this.import(stagedName)
      return { ...result, originalName: safeName }
    } finally {
      if (handle) await handle.close().catch(() => {})
      await fs.unlink(stagedPath).catch(() => {})
    }
  }

  async currentPath(poster = false) {
    const config = this.configStore.get()
    const name = poster ? config.wallpaperPoster : config.wallpaperAsset
    if (!name) return null
    const candidate = path.join(this.assetsRoot, name)
    const resolved = path.resolve(candidate)
    if (path.dirname(resolved) !== path.resolve(this.assetsRoot)) return null
    try {
      const stats = await fs.lstat(resolved)
      if (!stats.isFile() || stats.isSymbolicLink()) return null
      return resolved
    } catch {
      return null
    }
  }
}

export const WALLPAPER_LIMITS = Object.freeze({
  inputMiB: 20,
  outputMiB: 30,
  maxSide: MAX_SIDE,
  maxFrames: MAX_FRAMES,
  maxDurationSeconds: MAX_DURATION_MS / 1000,
})
