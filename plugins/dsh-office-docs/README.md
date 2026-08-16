# DSH 文档处理插件（dsh-office-docs）

面向 DeepSeek Harness `0.1.0-rc.6` 的本地 Cordis 插件：可直接处理 Word（.docx）、PowerPoint（.pptx）、Excel（.xlsx）以及纯文本（.txt/.md/.csv）文件，并在聊天输入框（对话框）里提供一个“上传文件”按键。

## 能力

| 能力 | 说明 | 边界 |
|---|---|---|
| `office_read` | 读取工作区内一个 docx/pptx/xlsx/txt/md/csv 文件，返回结构化内容与纯文本 | 只读；拒绝宏、外部关系、嵌入对象；xlsx 拒绝公式 |
| `document_create_text` | 新建 TXT/MD | 只写 `workspace/outputs`；禁止覆盖 |
| `document_create_docx` | 新建 Word（标题 + 段落 + 可选表格） | 只写 `workspace/outputs`；无宏、无外部链接 |
| `document_create_pptx` | 新建 PPT（纯文本 16:9 幻灯片） | 只写 `workspace/outputs` |
| `document_create_xlsx` | 新建 Excel（表头 + 标量单元格） | 只写 `workspace/outputs`；公式一律中和 |
| 上传按键 + `POST /dsh-office-docs/upload` | 对话框内上传办公文件到 `workspace/uploads` | 仅本机；类型/大小受限；重名自动 `-1` 后缀 |

总开关 `enabled`（默认开启）；读写可分别用 `read` / `write` 关闭；`uploads` 关闭上传端点和按键。

## 工作区（固定根目录）

- 配置 `workspaceRoot`（绝对路径）优先；否则读环境变量 `DSH_OFFICE_WORKSPACE`；再否则用 `DSH_HOME` 上两级下的 `workspace` 目录。
- 所有路径必须落在该根目录内，且不跟随符号链接。上传落 `uploads/`，生成落 `outputs/`，审计日志落 `.assistant/office-docs/audit/events.jsonl`。

## 官方兼容接口

`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，插入 `@local/dsh-office-docs` Cordis 行；入口导出 `name` / `inject = ['tools', 'webServer']` / `apply(ctx, config)`。工具通过 `ctx.tools.register()` 原生注册；上传端点通过 `ctx.webServer.register()` 注册，仅接受本机回环来源。客户端补丁通过 `dsh.client` 声明，注入 `conversation.input.left` 插槽（对话框工具行左侧）。

## 零运行时依赖

ZIP 读写（`node:zlib` 的 deflate/inflate + CRC32）、XML 解析、DOCX/PPTX/XLSX 生成全部自研，不依赖 docx / pptxgenjs / exceljs 等第三方包，便于安全扫描与离线打包。

## 开发验证

```powershell
node D:\path\to\dsh-plugins\dsh-office-docs\test\office-docs.test.mjs
```

测试使用临时目录，不访问用户私人目录，也不启动 DSH Web 服务。

## 打包与安装

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\path\to\dsh-plugins\dsh-office-docs\build\Build-DshOfficeDocsPlugin.ps1
# 输出 tgz 到 D:\path\to\deepseek-harness\plugins\dist，并自动运行安全扫描
```

复核不可变扫描报告后，再对同一 tgz 显式批准安装（禁止手工改 Web profile）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\path\to\deepseek-harness\scripts\Invoke-DshSafely.ps1 plugin add <tgz> -ApprovedReport <报告> -Approve
```
