# DSH Token Pet 数据插件（@local/dsh-token-pet）

面向 DeepSeek Harness `0.1.0-rc.6` 的宿主侧 Cordis 插件，为桌面宠物的 token 面板提供数据源：**DeepSeek 账户余额**（官方只读接口）与**当前会话 token 用量**（`ctx.tokenMeter` 实时投影）。

## 当前状态

- 数据 API 已完成：`GET /dsh-token-pet/data.json`
- 无运行时依赖（零 dependencies、零生命周期脚本），网络调用只用 Node 内置 `fetch`
- **本包尚未安装到 `data/dsh-home/profiles/web`**，安装后需重启 DSH 服务生效

## 官方兼容接口

`package.json` 通过 `dsh.bundle.patch` 指向 `cordis.patch.yml`。入口导出：

- `name` = `token-pet`
- `inject` = `['webServer', 'sessions', 'sessionProjections']`（web profile 内置服务）
- `apply(ctx, config)`

## 数据接口

### `GET /dsh-token-pet/data.json`

```json
{
  "fetchedAt": "2026-08-15T10:00:00.000Z",
  "balance": {
    "ok": true,
    "error": null,
    "data": {
      "available": true,
      "infos": [{ "currency": "CNY", "total": 110, "granted": 10, "toppedUp": 100 }]
    }
  },
  "session": {
    "sessionId": "...",
    "usage": { "uncachedInputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0 },
    "context": { "pressureTokens": 0, "projectedTokens": 0, "contextWindow": 0 },
    "stats": { "steps": 0, "turns": 0 }
  },
  "summary": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 }
}
```

- `balance`：DeepSeek 官方 [`/user/balance`](https://api-docs.deepseek.com/api/get-user-balance/) 结果（缓存默认 60s）。API key 从 `$DSH_HOME/.credentials.yaml` 的 `DEEPSEEK_API_KEY` 读取，**只读余额，key 绝不外泄、不出现在响应中**。无 key 或网络失败时 `ok=false` + `error`，不抛错。
- `session`：当前会话（按创建时间最新）的 token 投影：`usage`（输入/输出/缓存读/缓存写 token）、`context`（上下文占用）、`stats`（步数/轮数）。
- `summary`：用量合计，桌宠气泡直接可用。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `balance` | `true` | 余额模块开关 |
| `usage` | `true` | 用量模块开关 |
| `balanceUrl` | `https://api.deepseek.com/user/balance` | 余额接口地址 |
| `balanceCacheMs` | `60000` | 余额缓存毫秒数 |
| `apiKey` | 未设置（读凭据文件） | 显式指定 API key（覆盖凭据文件） |

## 开发验证

```powershell
node --test D:\path\to\dsh-plugins\dsh-token-pet\test\token-pet.test.mjs
```

测试离线运行，不发真实网络请求、不读真实凭据、不启动 DSH 服务。

## 构建与安装

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\path\to\dsh-plugins\dsh-token-pet\build\Build-DshTokenPetPlugin.ps1
```

流程：校验无生命周期脚本 → `pnpm pack` → tgz 落 `plugins\dist\`（harness 安装目录）→ 安全扫描（Defender + 静态分析 + 依赖审计）→ 不可变报告到 `security\reports\`。

人工复核报告后，对同一 tgz 显式批准安装（禁止手工修改 Web profile 或绕过门禁）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\path\to\deepseek-harness\scripts\Invoke-DshSafely.ps1 `
  plugin add <plugins\dist\local-dsh-token-pet-0.1.0-*.tgz> `
  -ApprovedReport <security\reports\plugin-review-*.json> -Approve
```

安装后重启 DSH（`dsh web`），然后验证：

```powershell
Invoke-RestMethod http://127.0.0.1:3080/dsh-token-pet/data.json
```

## 桌面宠物（配套应用）

桌宠前端是独立 Electron 应用（`D:\path\to\dsh-plugins\dsh-token-pet-app\`），透明置顶窗口显示黑鲸鱼 + 余额/用量气泡，定时轮询本接口。见桌宠应用 README。

## 安全说明

- 余额接口只调用 DeepSeek 官方地址（可配置），凭据只在本进程内存使用，绝不写入日志或响应。
- 插件不监听外网端口、不收集遥测。
- 静态扫描会报告 `childProcess`/`externalNetwork` 类发现时需人工复核；本插件不 spawn 子进程，仅有出网 fetch 调用余额接口（预期行为）。
