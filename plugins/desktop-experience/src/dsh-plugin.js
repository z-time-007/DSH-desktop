import path from 'node:path'
import { createRequire } from 'node:module'
import { ConfigStore } from './config.js'
import { WallpaperManager, WALLPAPER_LIMITS } from './wallpaper.js'
import { methodAllowed, readJson, requireLocalMutation, sendFile, sendJson } from './http.js'

export const name = 'desktop-experience'
export const inject = ['webServer']

function resolveHarnessRoot(rawConfig) {
  if (typeof rawConfig.harnessRoot === 'string' && path.isAbsolute(rawConfig.harnessRoot)) {
    return path.resolve(rawConfig.harnessRoot)
  }
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME, '..', '..')
  return process.cwd()
}

function exact(ctx, routePath, handler, label) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: routePath, handler }), label)
}

export async function apply(ctx, rawConfig = {}) {
  if (rawConfig.enabled === false) return
  const harnessRoot = resolveHarnessRoot(rawConfig)
  const imageProcessor = typeof rawConfig.imageProcessor === 'function'
    ? rawConfig.imageProcessor
    : createRequire(path.join(harnessRoot, 'package.json'))('sharp')
  const stateRoot = path.join(harnessRoot, 'workspace', '.assistant', 'desktop-experience')
  const inboxRoot = path.join(harnessRoot, 'workspace', 'assets', 'wallpapers', 'inbox')
  const assetsRoot = path.join(stateRoot, 'assets')
  const store = new ConfigStore(path.join(stateRoot, 'config.json'))
  await store.load()
  const wallpapers = new WallpaperManager({ inboxRoot, assetsRoot, configStore: store, imageProcessor })
  await wallpapers.initialize()

  exact(ctx, '/local-desktop-experience/config.json', async (req, res) => {
    if (!methodAllowed(req, res, ['GET', 'HEAD'])) return
    sendJson(req, res, 200, { ok: true, config: store.get(), limits: WALLPAPER_LIMITS })
  }, 'desktop-experience: config read')

  exact(ctx, '/local-desktop-experience/config', async (req, res) => {
    if (!methodAllowed(req, res, ['POST']) || !requireLocalMutation(req, res)) return
    try {
      const config = await store.update(await readJson(req))
      sendJson(req, res, 200, { ok: true, config })
    } catch (error) {
      sendJson(req, res, 400, { ok: false, error: String(error?.message || error) })
    }
  }, 'desktop-experience: config write')

  exact(ctx, '/local-desktop-experience/wallpapers.json', async (req, res) => {
    if (!methodAllowed(req, res, ['GET', 'HEAD'])) return
    sendJson(req, res, 200, { ok: true, ...(await wallpapers.list()), inboxRoot, limits: WALLPAPER_LIMITS })
  }, 'desktop-experience: wallpaper list')

  exact(ctx, '/local-desktop-experience/wallpaper/import', async (req, res) => {
    if (!methodAllowed(req, res, ['POST']) || !requireLocalMutation(req, res)) return
    try {
      const body = await readJson(req)
      const result = await wallpapers.import(body.fileName)
      sendJson(req, res, 200, { ok: true, result, config: store.get() })
    } catch (error) {
      sendJson(req, res, 400, { ok: false, error: String(error?.message || error) })
    }
  }, 'desktop-experience: wallpaper import')

  exact(ctx, '/local-desktop-experience/wallpaper/upload', async (req, res) => {
    if (!methodAllowed(req, res, ['POST']) || !requireLocalMutation(req, res, ['application/octet-stream'])) return
    try {
      const encodedName = req.headers['x-dsh-file-name']
      if (typeof encodedName !== 'string' || encodedName.length > 720) throw new Error('缺少有效的本地文件名。')
      const contentLength = Number(req.headers['content-length'] || 0)
      if (Number.isFinite(contentLength) && contentLength > WALLPAPER_LIMITS.inputMiB * 1024 * 1024) {
        throw new Error('壁纸文件超过 20 MiB 限制。')
      }
      const result = await wallpapers.upload(decodeURIComponent(encodedName), req)
      sendJson(req, res, 200, { ok: true, result, config: store.get() })
    } catch (error) {
      sendJson(req, res, 400, { ok: false, error: String(error?.message || error) })
    }
  }, 'desktop-experience: local wallpaper upload')

  exact(ctx, '/local-desktop-experience/wallpaper/clear', async (req, res) => {
    if (!methodAllowed(req, res, ['POST']) || !requireLocalMutation(req, res)) return
    sendJson(req, res, 200, { ok: true, config: await store.clearWallpaper() })
  }, 'desktop-experience: wallpaper clear')

  exact(ctx, '/local-desktop-experience/wallpaper/current.webp', async (req, res) => {
    if (!methodAllowed(req, res, ['GET', 'HEAD'])) return
    const current = await wallpapers.currentPath(false)
    if (!current) return sendJson(req, res, 404, { ok: false, error: '未选择壁纸。' })
    sendFile(req, res, current, 'image/webp')
  }, 'desktop-experience: wallpaper asset')

  exact(ctx, '/local-desktop-experience/wallpaper/poster.png', async (req, res) => {
    if (!methodAllowed(req, res, ['GET', 'HEAD'])) return
    const current = await wallpapers.currentPath(true)
    if (!current) return sendJson(req, res, 404, { ok: false, error: '未选择壁纸。' })
    sendFile(req, res, current, 'image/png')
  }, 'desktop-experience: wallpaper poster')
}
