/**
 * dsh-desktop — preload bridge.
 *
 * Exposes `window.dshDesktop` to every page loaded in the app window:
 *
 *   app.info()                          -> { name, version, backendUrl, ... }
 *   backend.status() / retry() / onStatus(cb)
 *   window.minimize() / toggleMaximize() / close() / isMaximized() / onMaximizedChange(cb)
 *   settings.get(key) / set(key, value) / onChanged(cb)   <- JSON store in userData
 *   autostart.get() / set(on)
 *   shell.openExternal(url)
 *   pet.open() / close() / dragStart(sx,sy) / dragMove(mx,my) / dragEnd()
 *       / showMenu() / refresh() / onRefresh(cb)           <- standalone pet window
 *
 * Also injects the frameless-window drag strip (a thin -webkit-app-region:drag
 * bar along the top edge, leaving room for the native window-control overlay on
 * the right). The strip is kept small so it never blocks the DSH UI's own
 * top-row buttons (e.g. the sidebar "新建会话" button).
 */

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  app: {
    info: () => ipcRenderer.invoke('dsh:app-info'),
  },
  backend: {
    status: () => ipcRenderer.invoke('dsh:backend-status'),
    retry: () => ipcRenderer.invoke('dsh:backend-retry'),
    onStatus: (callback) => subscribe('dsh:backend-status', callback),
  },
  window: {
    minimize: () => ipcRenderer.invoke('dsh:window-minimize'),
    toggleMaximize: () => ipcRenderer.invoke('dsh:window-toggle-maximize'),
    close: () => ipcRenderer.invoke('dsh:window-close'),
    isMaximized: () => ipcRenderer.invoke('dsh:window-is-maximized'),
    onMaximizedChange: (callback) => subscribe('dsh:window-maximized', callback),
  },
  settings: {
    get: (key) => ipcRenderer.invoke('dsh:settings-get', key),
    set: (key, value) => ipcRenderer.invoke('dsh:settings-set', key, value),
    onChanged: (callback) => subscribe('dsh:settings-changed', callback),
  },
  autostart: {
    get: () => ipcRenderer.invoke('dsh:autostart-get'),
    set: (enabled) => ipcRenderer.invoke('dsh:autostart-set', enabled),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('dsh:shell-open-external', url),
  },
  pet: {
    open: () => ipcRenderer.invoke('dsh:pet-open'),
    close: () => ipcRenderer.invoke('dsh:pet-close'),
    toggle: () => ipcRenderer.invoke('dsh:pet-toggle'),
    reset: () => ipcRenderer.invoke('dsh:pet-reset'),
    dragStart: (size) => ipcRenderer.send('dsh:pet-drag-start', size),
    dragMove: () => ipcRenderer.send('dsh:pet-drag-move'),
    dragEnd: () => ipcRenderer.send('dsh:pet-drag-end'),
    showMenu: () => ipcRenderer.send('dsh:pet-show-menu'),
    pointerInteractive: (enabled) => ipcRenderer.send('dsh:pet-pointer-interactive', enabled),
    refresh: () => ipcRenderer.invoke('dsh:pet-refresh'),
    onRefresh: (callback) => subscribe('dsh:pet-refresh-event', callback),
  },
}

contextBridge.exposeInMainWorld('dshDesktop', api)

// ---------------------------------------------------------------------------
// Frameless window chrome (applies to the loading page and the DSH page)
//
// The native window-control overlay (min/max/close) floats on the top-right of
// the frameless window. To keep it from covering the DSH UI (e.g. the
// conversation header's download button), we reserve a 36px titlebar strip at
// the top: the page content is pushed down by that height, and the strip —
// matching the window chrome (#0f1115) — is the drag region.
// ---------------------------------------------------------------------------

const TITLEBAR_HEIGHT = 36

function injectDesktopChrome() {
  const style = document.createElement('style')
  style.id = 'dsh-desktop-chrome'
  style.textContent = `
    html.dsh-desktop-reserved,
    html.dsh-desktop-reserved body { height: 100% !important; }
    html.dsh-desktop-reserved body {
      box-sizing: border-box !important;
      margin: 0 !important;
      padding-top: ${TITLEBAR_HEIGHT}px !important;
    }
    html.dsh-desktop-reserved #root { height: 100% !important; }
    #dsh-desktop-titlebar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: ${TITLEBAR_HEIGHT}px;
      box-sizing: border-box;
      -webkit-app-region: drag;
      z-index: 2147483647;
      background: #0f1115;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      display: flex;
      align-items: center;
      padding: 0 12px;
    }
    #dsh-desktop-titlebar .dsh-desktop-title {
      font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      font-size: 12px;
      line-height: ${TITLEBAR_HEIGHT}px;
      font-weight: 500;
      letter-spacing: 0.2px;
      color: rgba(255, 255, 255, 0.5);
      white-space: nowrap;
      overflow: hidden;
      pointer-events: none;
      user-select: none;
    }
  `

  const mount = () => {
    if (document.getElementById('dsh-desktop-titlebar')) return
    const title = document.createElement('span')
    title.className = 'dsh-desktop-title'
    title.textContent = 'DeepSeek Harness'
    const strip = document.createElement('div')
    strip.id = 'dsh-desktop-titlebar'
    strip.appendChild(title)
    ;(document.head || document.documentElement).appendChild(style)
    document.documentElement.classList.add('dsh-desktop-reserved')
    ;(document.body || document.documentElement).appendChild(strip)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
}

try {
  const { protocol, hostname } = window.location
  const isDshPage = protocol === 'http:' && hostname === '127.0.0.1'
  const isLocalPage = protocol === 'file:'
  const isPetWindow = new URLSearchParams(window.location.search || '').get('dshNativePet') === '1'
  // The standalone pet window loads the same origin but must stay chrome-free
  // (no 36px titlebar reservation, no drag strip).
  if (!isPetWindow && (isDshPage || isLocalPage)) injectDesktopChrome()
} catch {
  // preload injection must never break the page
}
