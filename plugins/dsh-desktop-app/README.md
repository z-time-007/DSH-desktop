# DSH 桌面应用化插件（@local/dsh-desktop-app）

面向 DeepSeek Harness `0.1.0-rc.6` 的宿主侧 Cordis 插件，把 DSH 从"每次开网页"变成真正的桌面应用体验。本包是 Cordis 插件源码与组合包，不是独立脚本集。

## 当前状态

- 两个模块已完成：**PWA 安装化**（manifest / Service Worker / 官方黑鲸鱼图标）与**桌面集成工具**（登录自启任务、桌面快捷方式、无地址栏应用窗口）。
- 插件无任何运行时依赖（零 dependencies、零生命周期脚本），PNG 图标在构建期生成后随包分发。
- **本包尚未安装到 `data/dsh-home/profiles/web`**，因此当前 Web UI 中不会出现 PWA 路由和工具。安装后需重启 DSH 服务生效。

## 官方兼容接口

`package.json` 通过 `dsh.bundle.patch` 指向 `cordis.patch.yml`，安装后自动成为 profile 的 bundle 层。入口导出：

- `name` = `local-desktop-app`
- `inject` = `['webServer', 'tools']`（web profile 内置服务，已在组合配置树中确认存在）
- `apply(ctx, config)`

### 模块一：PWA 安装化（`src/pwa.js`）

通过 `webServer` 服务注册精确路由（优先于 SPA fallback）并对每个 index.html 响应做注入（`tapIndex`，官方 boot-manifest 同款机制）：

| 路由 | 内容 |
|---|---|
| `/dsh-app.webmanifest` | 安装清单：standalone 显示模式、主题色、三个 PNG 图标 |
| `/dsh-app-sw.js` | 极简 Service Worker（透传不缓存，满足 Chromium 安装条件） |
| `/dsh-app-bootstrap.js` | 页面加载后注册 Service Worker |
| `/dsh-app-icon-192.png` / `-512.png` | 官方黑鲸鱼图标（透明） |
| `/dsh-app-icon-maskable-512.png` | maskable 图标（深色底、安全区内构图） |

注入内容：`<link rel="manifest" href="/dsh-app.webmanifest">`（位于官方 dist 自带 manifest 链接之前，按文档序第一个生效）+ `theme-color` meta + bootstrap 脚本。幂等：已注入的页面不会重复注入。

安装后：Edge/Chrome 地址栏出现"安装应用"→ 从开始菜单/任务栏以独立窗口打开（无地址栏、黑鲸鱼图标）。官方 dist 自带的 manifest 只有 SVG 图标、无 SW，因此此前无法安装——本插件补齐了这两个缺口。

### 模块二：桌面集成工具（`src/desktop.js`）

通过 `ctx.tools.register` 注册 4 个 agent 工具，复用 DSH 安装目录下**已有的安全评审过的桌面脚本**（不打包副本，永远驱动安装自带的版本），并在原生桌面应用（`dsh-desktop`）已构建时优先使用它：

| 工具 | 作用 | 写入 |
|---|---|---|
| `desktop_app_install` | 安装登录自启计划任务 + 桌面快捷方式（可重复运行修复）；原生应用存在时把快捷方式指向 `DeepSeekHarness.exe` | 系统级，需人工批准 |
| `desktop_app_open` | **优先启动原生桌面应用**（`DeepSeekHarness.exe`，自带后端自举与原生窗口）；未构建时回退到 Edge/Chrome 应用窗口 | 无 |
| `desktop_app_test` | 检查任务/快捷方式/图标/后端健康 + 原生应用是否存在 | 只读 |
| `desktop_app_disable` | 移除计划任务 + 快捷方式（可选 `stopNow` 停止后端） | 系统级，需人工批准 |

- 原生应用定位：`config.nativeAppPath` 显式指定，否则探测默认构建位置 `D:\path\to\dsh-plugins\dsh-desktop\dist\DeepSeekHarness\DeepSeekHarness.exe`。
- 安装目录定位：优先 `config.harnessRoot`，否则由 `DSH_HOME`（`<root>/data/dsh-home`）推导 `<root>`。
- `desktop_app_install` / `desktop_app_disable` 通过 `tools/pre-execute` 钩子返回 `ask`，由 DSH 用户批准服务单次放行（与 personal-assistant 文件管家同款门禁）。
- 脚本超时默认 180s，可用 `scriptTimeoutMs` 调整。

## 配置项（cordis.patch.yml / 插件配置）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `pwa` | `true` | PWA 模块开关 |
| `desktopTools` | `true` | 桌面工具开关 |
| `desktopToolsWriteApproval` | `true` | 写操作人工批准门 |
| `appName` / `shortName` | `DeepSeek Harness` / `DSH` | 安装清单名称 |
| `themeColor` / `backgroundColor` | `#0f1115` | 主题色（匹配 DSH 深色 UI） |
| `port` | `3080` | 工具默认回环端口 |
| `harnessRoot` | 自动探测 | 显式指定 DSH 安装根目录 |
| `nativeAppPath` | 自动探测 | 显式指定原生桌面应用 exe 路径 |

## 开发验证

```powershell
node --test D:\path\to\dsh-plugins\dsh-desktop-app\test\desktop-app.test.mjs
```

测试离线运行，不启动 DSH 服务、不调用桌面脚本、不触碰 Windows 系统状态；PWA 冒烟测试在 assets 未生成时自动跳过。

## 构建与安装

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\path\to\dsh-plugins\dsh-desktop-app\build\Build-DshDesktopAppPlugin.ps1
```

流程：生成 PNG 图标 → 校验无生命周期脚本 → `pnpm pack` → tgz 落到 `D:\path\to\deepseek-harness\plugins\dist\` → 运行安全扫描器（Defender 扫描 + 静态模式分析 + 依赖审计），产出不可变报告到 `security\reports\`。

> 注意：扫描报告会标记 `manual_review_required` 并列出 `childProcess` / `shellExecution` / `environmentAccess` 静态发现——这是本插件的设计行为（合法地调用 `powershell.exe` 驱动安装自带的桌面脚本、读取 `process.env.DSH_HOME`），复核时逐条确认即可，不是恶意代码。

人工复核报告后，对同一 tgz 显式批准安装（禁止手工修改 Web profile 或绕过门禁）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\path\to\deepseek-harness\scripts\Invoke-DshSafely.ps1 `
  plugin add <plugins\dist\local-dsh-desktop-app-0.1.0-*.tgz> `
  -ApprovedReport <security\reports\plugin-review-*.json> -Approve
```

安装后重启 DSH（`dsh web`），然后：

1. 浏览器打开 `http://127.0.0.1:3080` → 地址栏"安装应用"；
2. 或让 agent 调用 `desktop_app_install` 安装开机自启 + 桌面快捷方式。

## 安全说明

- PWA 路由只挂在本机回环服务上；Service Worker 纯透传、不缓存任何内容。
- 工具只驱动安装自带的、已验证的桌面脚本，且只处理计划任务与快捷方式；写操作均需人工批准。
- 插件不监听外网端口、不收集遥测、无任何网络依赖。
