# DSH Safe Auto Approval

为 DSH 提供“低风险工作自动审批”，但不关闭沙箱、不切换 Full Access，也不把 `approval.policy` 改成 `never`（官方的 `never` 表示自动拒绝，不是自动允许）。

策略作为最外层 `tools/pre-execute` 监听器运行：先让所有既有策略检查完整调用；只有下游结论为 `ask`、工具名进入硬编码白名单、参数通过二次边界检查时，才改为 `allow`。任何 `deny`、未知工具或参数异常都不会被覆盖。

## 自动放行

- 只读：电脑状态、工作区列表/搜索、任务列表、桌面应用检测。
- 受控工作区：创建目录、复制、移动；仍由 Personal Assistant 拒绝越界、符号链接和覆盖。
- 本地秘书：新增/更新任务、备忘录、日报和会议草稿。
- 文档：只在 `workspace/outputs` 新建 TXT/Markdown、DOCX、PPTX、XLSX；文件名和扩展名再次校验。
- 桌面应用：打开现有应用窗口。

## 永不自动放行

- 回收/删除/覆盖；
- 安装或停用桌面集成、插件安装/更新/移除；
- PowerShell、Bash、任意代码执行；
- DSH/Cordis 动态插件定义和运行；
- 系统设置、管理员权限、计划任务、注册表；
- 凭据、账号、外发消息、支付、远程网络操作；
- 任何未列入白名单的未来工具。

每次自动批准写入 `workspace/.assistant/audit/auto-approvals.jsonl`，仅包含时间、工具名、类别和可选调用 ID，不记录参数或文档正文。审计写入失败时本次操作自动阻断。
