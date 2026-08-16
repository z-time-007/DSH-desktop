# dsh-desktop — DeepSeek Harness 原生桌面应用

把 DSH 从「浏览器套壳」（Edge/Chrome `--app=` 窗口）升级为真正的 Electron 桌面应用。

## 功能

- **原生窗口**：无边框现代风（`titleBarOverlay` 提供系统原生最小化/最大化/关闭按钮）。
- **标题栏预留布局**：页面顶部预留 36px 标题栏带（注入的拖拽条，含 "DeepSeek Harness" 标题），
  页面内容整体下移——原生窗口按钮不会再遮挡 DSH 界面右上角的操作（如下载 session 按钮）；
  高度链由注入 CSS 强制建立（`html/body/#root` 100% + `body padding-top`），无溢出、无滚动条。
- **后端自举**：启动时健康检查 `http://127.0.0.1:3080`；未启动则拉起
  `Start-DeepSeek-HarnessBackground.ps1` 并轮询就绪；端口被未经验证的程序占用时拒绝启动并提示。
- **启动页**：服务启动期间显示品牌加载页，失败可一键重试。
- **托盘**：显示/隐藏、开机自启开关、重新加载、退出；关闭窗口即最小化到托盘。
- **单实例**：重复启动会聚焦已有窗口。
- **窗口状态持久化**：记住窗口位置/大小/最大化状态（`userData\window-state.json`）。
- **`window.dshDesktop` 桥接**（见 `preload.js`）：窗口控制、后端状态、自启、外链，
  以及 JSON 设置存储（`userData\settings.json`）——桌面侧持久化底座，供背景更换等美化插件使用。

## 目录

| 路径 | 内容 |
|---|---|
| `main.js` | Electron 主进程（窗口/托盘/后端自举/IPC） |
| `preload.js` | contextBridge API + 标题栏带注入（预留 36px，避让原生窗口按钮） |
| `renderer/` | 启动/离线加载页 |
| `assets/` | 应用图标（窗口、托盘、快捷方式） |
| `build/Build-DshDesktopApp.ps1` | 打包为独立 `DeepSeekHarness.exe` 并替换桌面快捷方式 |

## 使用

```powershell
# 开发运行（需 node_modules）
pnpm install
pnpm start

# 打包独立 exe（复制 Electron 运行时 + 生成 DeepSeekHarness.exe + 桌面快捷方式）
pnpm build
# 或
powershell -NoProfile -ExecutionPolicy Bypass -File build/Build-DshDesktopApp.ps1
```

打包产物：`dist\DeepSeekHarness\DeepSeekHarness.exe`（portable，免安装）。
桌面快捷方式「DeepSeek Harness」指向该 exe，替换原浏览器套壳入口。

## 桥接 API（页面内可用）

```js
window.dshDesktop.app.info()                     // { name, version, backendUrl, packaged, ... }
window.dshDesktop.backend.status()               // { status, message, url }
window.dshDesktop.backend.retry()
window.dshDesktop.backend.onStatus((s) => {})
window.dshDesktop.window.minimize() / toggleMaximize() / close() / isMaximized()
window.dshDesktop.window.onMaximizedChange((max) => {})
window.dshDesktop.settings.get(key) / set(key, value) / onChanged(({key, value}) => {})
window.dshDesktop.autostart.get() / set(true)
window.dshDesktop.shell.openExternal(url)
```
