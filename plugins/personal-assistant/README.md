# DSH 本地个人助手开发包

这是面向 DeepSeek Harness `0.1.0-rc.6` 的 Cordis 插件源码与组合包，不是 Codex 插件。

## 当前状态

- 核心模块、DSH `ctx.tools.register(...)` 原生 JSON Schema 适配层、`dsh.bundle.patch` 和自动测试已经提供。
- 文档生成依赖已在项目根目录按精确版本安装，供开发和测试使用。
- **本包尚未安装到 `data/dsh-home/profiles/web`，因此当前 Web UI 中不会出现这些工具。**
- 统一门禁现已支持 `plugins/dist` 中的本地 tgz，但扫描不等于安装。本轮没有提供 `-Approve`，因此仍只交付可测试、可打包、可迁移的源码。

受支持的后续流程是运行 `scripts/Build-PersonalAssistantPlugin.ps1` 完成打包和自动扫描，人工复核不可变报告后，再通过 `scripts/Invoke-DshSafely.ps1` 对同一 tgz 显式批准。禁止手工修改 Web profile 或绕过门禁。

## 官方兼容接口

`package.json` 通过 `dsh.bundle.patch` 指向 `cordis.patch.yml`。组合包插入 `@local/dsh-personal-assistant` Cordis 行，入口导出：

- `name`
- `inject = ['tools']`
- `apply(ctx, config)`

工具通过官方 `ctx.tools.register()` 原生定义注册，参数使用适配层生成的标准 JSON Schema，避免依赖 pnpm 是否把 DSH 内部工具包提升到根目录。文件管家写工具通过 `tools/pre-execute` 返回 `ask`，由 DSH 的用户批准服务决定是否单次放行。

## 默认能力

| 能力 | 默认 | 写入边界 |
|---|---:|---|
| computer-status | 开启 | 无写入；只执行固定的 Windows 安全状态查询，不接受命令参数 |
| file-steward | 开启 | 只限固定项目 `workspace`；所有写工具要求 DSH 单次人工批准 |
| secretary | 开启 | 只写 `workspace/.assistant/secretary` |
| document-writer | 开启 | 只新建 `workspace/outputs` 下的 TXT/MD/DOCX/PPTX/XLSX |

PPTX 图片只接受 `workspace/assets/inbox` 下相对路径指向的 PNG/JPEG。原图不修改；嵌入副本会自动旋转、限制尺寸、重新编码并剥离 EXIF/GPS 等元数据。禁止 URL、data URI、base64、SVG 及其他格式。

总开关为 `DSH_ASSISTANT_ENABLED`：值为 `0` 时组合包不注册任何工具。固定工作区由启动器设置的 `DSH_ASSISTANT_WORKSPACE` 提供；缺失时插件拒绝启动。

## 开发验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\path\to\deepseek-harness\scripts\Test-PersonalAssistant.ps1
```

测试使用临时目录，不访问用户私人目录，也不启动 DSH Web 服务。

统一权限与威胁模型见 [个人助手使用与安全说明](../../docs/PERSONAL_ASSISTANT.md)。
