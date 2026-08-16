/**
 * dsh-desktop — native desktop application shell for DeepSeek Harness.
 *
 * Replaces the old "browser shell" flow (Edge/Chrome `--app=` window): this is
 * a real Electron application with its own process, window, tray and icons.
 *
 * Responsibilities
 * ----------------
 * - Frameless modern window (titleBarOverlay gives native min/max/close).
 * - Bootstrap the loopback backend when it is down (health check, verified
 *   listener detection, Start-DeepSeek-HarnessBackground.ps1, poll until ready).
 * - Loading/offline screen while the backend starts; then load the DSH web UI.
 * - Single-instance lock, window-state persistence, close-to-tray, tray menu
 *   with autostart toggle, reload and quit.
 * - `window.dshDesktop` bridge (see preload.js): window controls, backend
 *   status, autostart, external links, and a generic JSON settings store —
 *   the persistence foundation for desktop beautification plugins.
 */

'use strict'

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { spawn } = require('node:child_process')

const PORT = Number(process.env.DSH_DESKTOP_PORT || 3080)
const BACKEND_URL = `http://127.0.0.1:${PORT}`
const APP_NAME = 'DeepSeek Harness'
const APP_USER_MODEL_ID = 'com.deepseek.harness.desktop'
const MAX_WAIT_MS = 90_000
const HEALTH_POLL_MS = 800

// Fallback candidates for locating the harness installation. DSH_HOME
// (when set) takes precedence; see resolveHarnessRoot().
const HARNESS_CANDIDATES = ['D:\\path\\to\\deepseek-harness']

let win = null
let tray = null
let isQuitting = false
let backendStatus = 'starting' // 'starting' | 'ready' | 'error' | 'blocked'
let statusMessage = '正在初始化…'
let startTimer = null
let mainAppLoaded = false

// Standalone desktop pet window (loads the DSH web UI in native-pet mode).
let petWindow = null
let petDragState = null
const PET_WINDOW = { width: 600, height: 800 }
const PET_URL = `${BACKEND_URL}/?dshNativePet=1`

// Main-window edge auto-hide (dock to the right screen edge, reveal on touch).
let autoHideWindow = true
let windowSlidOut = false
let windowOriginalBounds = null
let edgePollTimer = null
let slideTimer = null
const EDGE_SLIVER = 6

// ---------------------------------------------------------------------------
// Harness root
// ---------------------------------------------------------------------------

function resolveHarnessRoot() {
  const home = process.env.DSH_HOME
  if (home) {
    const root = path.dirname(path.dirname(home))
    if (fs.existsSync(path.join(root, 'scripts', 'Start-DeepSeek-HarnessBackground.ps1'))) return root
  }
  for (const candidate of HARNESS_CANDIDATES) {
    if (fs.existsSync(path.join(candidate, 'scripts', 'Start-DeepSeek-HarnessBackground.ps1'))) return candidate
  }
  return null
}

// ---------------------------------------------------------------------------
// Backend bootstrap
// ---------------------------------------------------------------------------

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(BACKEND_URL, { timeout: 2500 }, (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

/** Mirrors the verification rule of the harness desktop scripts: the listener
 * must belong to the harness install or to a `bin.js --host 127.0.0.1` process. */
function isVerifiedListener(commandLine) {
  if (!commandLine) return false
  const root = resolveHarnessRoot()
  return Boolean(
    (root && commandLine.includes(root)) ||
    (commandLine.includes('bin.js') && commandLine.includes('--host 127.0.0.1')),
  )
}

function inspectListener() {
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$c = Get-NetTCPConnection -State Listen -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `if ($null -eq $c) { 'none' } else { $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($c.OwningProcess)"; $p.CommandLine }`,
    ], { windowsHide: true })
    let out = ''
    ps.stdout.on('data', (d) => { out += d })
    ps.stderr.on('data', () => {})
    ps.on('error', () => resolve({ occupied: false, verified: false }))
    ps.on('close', () => {
      const line = out.trim()
      if (!line || line === 'none') return resolve({ occupied: false, verified: false })
      resolve({ occupied: true, verified: isVerifiedListener(line) })
    })
  })
}

function setStatus(state, message) {
  backendStatus = state
  statusMessage = message
  if (win && !win.isDestroyed()) win.webContents.send('dsh:backend-status', currentStatus())
}

function currentStatus() {
  return { status: backendStatus, message: statusMessage, url: BACKEND_URL }
}

async function ensureBackend() {
  const harnessRoot = resolveHarnessRoot()
  if (!harnessRoot) {
    setStatus('error', '未找到 DeepSeek Harness 安装目录（缺少 scripts\\Start-DeepSeek-HarnessBackground.ps1）')
    return
  }

  setStatus('starting', '正在检查本地服务…')
  if (await checkHealth()) {
    setStatus('ready', '服务已就绪')
    loadMainApp()
    return
  }

  const listener = await inspectListener()
  if (listener.occupied && !listener.verified) {
    setStatus('blocked', `端口 ${PORT} 被未经验证的程序占用，拒绝启动服务`)
    return
  }

  setStatus('starting', '正在启动本地服务…')
  const script = path.join(harnessRoot, 'scripts', 'Start-DeepSeek-HarnessBackground.ps1')
  const child = spawn('powershell.exe', [
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Port', String(PORT),
  ], { windowsHide: true })
  child.on('error', (err) => {
    if (backendStatus === 'starting') setStatus('error', `无法启动本地服务：${err.message}`)
  })

  const deadline = Date.now() + MAX_WAIT_MS
  const poll = async () => {
    if (await checkHealth()) {
      setStatus('ready', '服务已就绪')
      loadMainApp()
      return
    }
    if (Date.now() > deadline) {
      setStatus('error', '本地服务启动超时，请检查 DSH 日志')
      return
    }
    startTimer = setTimeout(poll, HEALTH_POLL_MS)
  }
  poll()
}

function loadMainApp() {
  if (!win || win.isDestroyed()) return
  if (mainAppLoaded) return
  const current = win.webContents.getURL()
  if (current.startsWith(BACKEND_URL)) {
    mainAppLoaded = true
    return
  }
  // loadURL replaces the in-flight loading.html navigation if it is still
  // starting (the backend can be healthy before the local page finishes).
  win.loadURL(BACKEND_URL)
    .then(() => { mainAppLoaded = true })
    .catch((error) => {
      // -3 / ERR_ABORTED: the previous navigation was replaced — not a failure.
      if (error?.errno === -3 || error?.code === 'ERR_ABORTED') return
      console.error('[dsh-desktop] loadURL failed:', error)
      setStatus('error', '加载界面失败，请点击重试')
    })
}

// ---------------------------------------------------------------------------
// Window state persistence
// ---------------------------------------------------------------------------

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function isBoundsOnScreen(bounds) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return (
      bounds.x < a.x + a.width &&
      bounds.x + bounds.width > a.x &&
      bounds.y < a.y + a.height &&
      bounds.y + bounds.height > a.y
    )
  })
}

function saveWindowState() {
  if (!win || win.isDestroyed() || win.isMinimized()) return
  try {
    const state = { bounds: win.getBounds(), maximized: win.isMaximized() }
    fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true })
    fs.writeFileSync(windowStateFile(), JSON.stringify(state))
  } catch {
    // window-state persistence is best-effort
  }
}

function restoreWindowState() {
  if (!win) return
  try {
    const state = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'))
    if (state.bounds && isBoundsOnScreen(state.bounds)) win.setBounds(state.bounds)
    if (state.maximized) win.maximize()
  } catch {
    // first run or corrupt state: keep defaults
  }
}

// ---------------------------------------------------------------------------
// Settings store (JSON in userData) — desktop-side persistence for plugins
// ---------------------------------------------------------------------------

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
}

let settingsCache = null

function readSettings() {
  if (settingsCache !== null) return settingsCache
  try {
    settingsCache = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    settingsCache = {}
  }
  if (typeof settingsCache !== 'object' || settingsCache === null || Array.isArray(settingsCache)) {
    settingsCache = {}
  }
  return settingsCache
}

function writeSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(settingsCache, null, 2))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'dsh-black-whale.ico')

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f1115', symbolColor: '#e8e8e8', height: 36 },
    backgroundColor: '#0f1115',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  restoreWindowState()
  win.loadFile(path.join(__dirname, 'renderer', 'loading.html'))

  win.once('ready-to-show', () => win.show())

  // External links go to the default browser; the app itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(BACKEND_URL)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL().startsWith(BACKEND_URL)) mainAppLoaded = true
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return // -3 = ERR_ABORTED (navigation replaced)
    if (validatedURL.startsWith(BACKEND_URL) && backendStatus === 'ready') {
      setStatus('error', `加载界面失败 (${errorCode} ${errorDescription})，请点击重试`)
    }
  })

  win.on('maximize', () => { saveWindowState(); broadcastMaximized() })
  win.on('unmaximize', () => { saveWindowState(); broadcastMaximized() })
  win.on('resize', () => saveWindowState())
  win.on('move', () => saveWindowState())

  win.on('close', (event) => {
    if (!isQuitting) {
      // Close-to-tray: the app keeps running in the background.
      event.preventDefault()
      win.hide()
      notifyHiddenToTray()
    } else {
      saveWindowState()
    }
  })
  win.on('closed', () => { win = null })

  // Edge auto-hide: tuck the window away shortly after it loses focus.
  win.on('blur', scheduleAutoHide)
  win.on('focus', () => { clearTimeout(slideTimer) })

  // Keyboard: F5 / Ctrl+R reload, F11 fullscreen, Ctrl+Shift+I devtools.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    const key = String(input.key || '').toLowerCase()
    if (input.key === 'F5' || (mod && key === 'r')) {
      event.preventDefault()
      win.webContents.reload()
    } else if (input.key === 'F11') {
      event.preventDefault()
      win.setFullScreen(!win.isFullScreen())
    } else if (mod && input.shift && key === 'i') {
      event.preventDefault()
      win.webContents.toggleDevTools()
    }
  })
}

function broadcastMaximized() {
  if (win && !win.isDestroyed()) win.webContents.send('dsh:window-maximized', win.isMaximized())
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return
  if (windowSlidOut) { slideWindowIn(); return }
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

// ---------------------------------------------------------------------------
// Main-window edge auto-hide
// ---------------------------------------------------------------------------

function slideWindowOut() {
  if (!win || win.isDestroyed() || windowSlidOut || !autoHideWindow) return
  if (win.isMaximized() || win.isFullScreen()) return
  const wa = screen.getPrimaryDisplay().workArea
  windowOriginalBounds = win.getBounds()
  windowSlidOut = true
  win.setPosition(wa.x + wa.width - EDGE_SLIVER, windowOriginalBounds.y)
}

function slideWindowIn() {
  if (!win || win.isDestroyed() || !windowSlidOut) return
  windowSlidOut = false
  if (windowOriginalBounds) {
    win.setBounds(windowOriginalBounds)
    windowOriginalBounds = null
  }
  win.show()
  win.focus()
}

function scheduleAutoHide() {
  if (!autoHideWindow) return
  clearTimeout(slideTimer)
  slideTimer = setTimeout(() => {
    // Only tuck away when neither the main window nor the pet is focused
    // (i.e. the user really switched to an unrelated application).
    const petFocused = petWindow && !petWindow.isDestroyed() && petWindow.isFocused()
    if (win && !win.isDestroyed() && !win.isFocused() && !petFocused && !win.isMinimized()) slideWindowOut()
  }, 1500)
}

function startEdgePoll() {
  if (edgePollTimer) return
  edgePollTimer = setInterval(() => {
    if (!windowSlidOut || !win || win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const wa = screen.getPrimaryDisplay().workArea
    if (cursor.x >= wa.x + wa.width - EDGE_SLIVER - 2) slideWindowIn()
  }, 150)
}

let trayHintShown = false

/** One-time balloon so the user knows the app is still running in the tray. */
function notifyHiddenToTray() {
  if (trayHintShown || !tray) return
  trayHintShown = true
  try {
    tray.displayBalloon({
      iconType: 'info',
      title: APP_NAME,
      content: '已最小化到托盘，双击托盘图标可重新打开。',
    })
  } catch {
    // balloon is best-effort
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'dsh-black-whale.ico')
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'dsh-app-icon-192.png'))
  }
  tray = new Tray(icon)
  tray.setToolTip(APP_NAME)
  rebuildTrayMenu()
  tray.on('double-click', toggleWindow)
}

function rebuildTrayMenu() {
  if (!tray) return
  const autostart = app.getLoginItemSettings().openAtLogin
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏主窗口', click: toggleWindow },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: autostart,
      click: (item) => { setAutostart(item.checked) },
    },
    {
      label: '自动隐藏窗口',
      type: 'checkbox',
      checked: autoHideWindow,
      click: (item) => {
        autoHideWindow = item.checked
        if (!autoHideWindow) slideWindowIn()
      },
    },
    {
      label: '重新加载',
      click: () => { if (win && !win.isDestroyed()) win.webContents.reload() },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => { isQuitting = true; app.quit() },
    },
  ])
  tray.setContextMenu(menu)
}

function setAutostart(enabled) {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath })
  rebuildTrayMenu()
}

// ---------------------------------------------------------------------------
// Standalone desktop pet
// ---------------------------------------------------------------------------

function petStateFile() {
  return path.join(app.getPath('userData'), 'pet-window-state.json')
}

function defaultPetPosition() {
  const wa = screen.getPrimaryDisplay().workArea
  const s = 100
  // Place the whale at the bottom-right corner of the work area.
  const whaleCenterX = wa.x + wa.width - s / 2 - 24
  const whaleCenterY = wa.y + wa.height - s / 2 - 24
  return {
    x: Math.round(whaleCenterX - PET_WINDOW.width / 2),
    y: Math.round(whaleCenterY - PET_WINDOW.height / 2),
  }
}

/** Clamp the pet window so the WHALE (not the transparent window) stays on the
 * work area of the nearest display. The window is transparent and click-through,
 * so it may extend off-screen while the whale roams almost the whole screen. */
function clampPetPosition(x, y, size = 100) {
  const w = petWindow && !petWindow.isDestroyed() ? petWindow.getSize()[0] : PET_WINDOW.width
  const h = petWindow && !petWindow.isDestroyed() ? petWindow.getSize()[1] : PET_WINDOW.height
  const s = Number.isFinite(Number(size)) ? Number(size) : 100
  const display = screen.getDisplayNearestPoint({ x: x + Math.round(w / 2), y: y + Math.round(h / 2) })
  const wa = display.workArea
  const margin = 8
  // The whale is centered in the window (CSS transform -50%,-50%).
  const whaleCenterX = x + w / 2
  const whaleCenterY = y + h / 2
  const minX = wa.x + s / 2 + margin
  const maxX = wa.x + wa.width - s / 2 - margin
  const minY = wa.y + s / 2 + margin
  const maxY = wa.y + wa.height - s / 2 - margin
  const cx = Math.min(maxX, Math.max(minX, whaleCenterX))
  const cy = Math.min(maxY, Math.max(minY, whaleCenterY))
  return {
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
  }
}

function readPetState() {
  try {
    const state = JSON.parse(fs.readFileSync(petStateFile(), 'utf8'))
    if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
      return clampPetPosition(state.x, state.y)
    }
  } catch {
    // first run: use the default dock
  }
  return defaultPetPosition()
}

function savePetState() {
  if (!petWindow || petWindow.isDestroyed()) return
  try {
    const [x, y] = petWindow.getPosition()
    fs.mkdirSync(path.dirname(petStateFile()), { recursive: true })
    fs.writeFileSync(petStateFile(), JSON.stringify({ x, y }))
  } catch {
    // best-effort persistence
  }
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show()
    petWindow.focus()
    return petWindow
  }
  const pos = readPetState()
  petWindow = new BrowserWindow({
    width: PET_WINDOW.width,
    height: PET_WINDOW.height,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  petWindow.setAlwaysOnTop(true, 'screen-saver')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  petWindow.loadURL(PET_URL)
  petWindow.on('focus', () => {
    // Interacting with the pet is part of using DSH: cancel any pending
    // main-window auto-hide so the main window stays put.
    clearTimeout(slideTimer)
  })
  petWindow.on('closed', () => { petWindow = null })
  return petWindow
}

function closePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy()
    petWindow = null
  }
}

function registerPetIpc() {
  ipcMain.handle('dsh:pet-open', () => {
    createPetWindow()
    return { ok: true }
  })
  ipcMain.handle('dsh:pet-close', () => {
    closePetWindow()
    return { ok: true }
  })
  ipcMain.handle('dsh:pet-toggle', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      closePetWindow()
      return { ok: true, open: false }
    }
    createPetWindow()
    return { ok: true, open: true }
  })
  ipcMain.handle('dsh:pet-reset', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      const pos = defaultPetPosition()
      petWindow.setPosition(pos.x, pos.y)
      savePetState()
    }
    return { ok: true }
  })
  ipcMain.on('dsh:pet-pointer-interactive', (_event, enabled) => {
    // When the pointer is not over the whale/bubble, let clicks pass through to
    // whatever is behind the transparent pet window; forward:true keeps mouse
    // move events flowing so the renderer can re-enable interaction on hover.
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(!Boolean(enabled), { forward: true })
    }
  })
  ipcMain.on('dsh:pet-drag-start', (_event, size) => {
    if (!petWindow || petWindow.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    petDragState = {
      lastX: cursor.x,
      lastY: cursor.y,
      size: Number.isFinite(Number(size)) ? Number(size) : 100,
    }
  })
  ipcMain.on('dsh:pet-drag-move', () => {
    if (!petWindow || petWindow.isDestroyed() || !petDragState) return
    const cursor = screen.getCursorScreenPoint()
    const [wx, wy] = petWindow.getPosition()
    const pos = clampPetPosition(
      wx + (cursor.x - petDragState.lastX),
      wy + (cursor.y - petDragState.lastY),
      petDragState.size,
    )
    petWindow.setPosition(pos.x, pos.y)
    petDragState.lastX = cursor.x
    petDragState.lastY = cursor.y
  })
  ipcMain.on('dsh:pet-drag-end', () => {
    petDragState = null
    savePetState()
  })
  ipcMain.on('dsh:pet-show-menu', (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) return
    Menu.buildFromTemplate([
      {
        label: '刷新数据',
        click: () => { if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.reload() },
      },
      {
        label: '回到默认位置',
        click: () => {
          if (petWindow && !petWindow.isDestroyed()) {
            const pos = defaultPetPosition()
            petWindow.setPosition(pos.x, pos.y)
            savePetState()
          }
        },
      },
      { type: 'separator' },
      { label: '关闭桌宠', click: closePetWindow },
    ]).popup({ window: owner })
  })
  ipcMain.handle('dsh:pet-refresh', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.reload()
    return { ok: true }
  })
}

// ---------------------------------------------------------------------------
// IPC bridge
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('dsh:app-info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    backendUrl: BACKEND_URL,
    platform: process.platform,
    packaged: app.isPackaged,
    harnessRoot: resolveHarnessRoot(),
  }))

  ipcMain.handle('dsh:backend-status', () => currentStatus())
  ipcMain.handle('dsh:backend-retry', () => ensureBackend())

  ipcMain.handle('dsh:window-minimize', () => { win?.minimize() })
  ipcMain.handle('dsh:window-toggle-maximize', () => {
    if (win) {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    }
  })
  ipcMain.handle('dsh:window-close', () => { win?.close() })
  ipcMain.handle('dsh:window-is-maximized', () => (win ? win.isMaximized() : false))

  ipcMain.handle('dsh:settings-get', (_event, key) => readSettings()[key])
  ipcMain.handle('dsh:settings-set', (_event, key, value) => {
    if (typeof key !== 'string' || key.length === 0) return false
    const store = readSettings()
    store[key] = value
    settingsCache = store
    const ok = writeSettings()
    if (ok && win && !win.isDestroyed()) win.webContents.send('dsh:settings-changed', { key, value })
    return ok
  })

  ipcMain.handle('dsh:autostart-get', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('dsh:autostart-set', (_event, enabled) => {
    setAutostart(Boolean(enabled))
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('dsh:shell-open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:/i.test(url)) shell.openExternal(url)
  })

  registerPetIpc()
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  app.setName(APP_NAME)

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    registerIpc()
    createWindow()
    createTray()
    ensureBackend()
    startEdgePoll()
    app.on('activate', () => {
      if (win) {
        win.show()
        win.focus()
      }
    })
  })

  // The app lives in the tray; closing the window hides it instead of quitting.
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    if (startTimer) clearTimeout(startTimer)
    if (slideTimer) clearTimeout(slideTimer)
    if (edgePollTimer) clearInterval(edgePollTimer)
    if (petWindow && !petWindow.isDestroyed()) petWindow.destroy()
  })
}

module.exports = { BACKEND_URL, PORT }
