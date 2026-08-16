/**
 * @local/dsh-token-pet — token usage & balance data source for the DSH
 * desktop pet (and any dashboard).
 *
 * Host-side Cordis plugin exposing one JSON endpoint:
 *
 *   GET /dsh-token-pet/data.json
 *   {
 *     "fetchedAt": "...",
 *     "balance": { "ok": true, "error": null,
 *                  "data": { "available": true, "infos": [{ "currency": "CNY",
 *                             "total": 110, "granted": 10, "toppedUp": 100 }] } },
 *     "session": { "sessionId": "...", "usage": { "uncachedInputTokens": ...,
 *                   "outputTokens": ..., "cacheReadTokens": ..., "cacheWriteTokens": ... },
 *                   "context": { "pressureTokens": ..., "projectedTokens": ..., "contextWindow": ... },
 *                   "stats": { "steps": ..., "turns": ... } }
 *   }
 *
 * Official plugin contract: exports `name`, `inject`, and `apply(ctx, config)`.
 */

import { createBalanceProvider } from './balance.js'
import { resolveCurrentSession, collectUsage, summarizeUsage } from './usage.js'

export const name = 'token-pet'
export const inject = ['webServer', 'sessions', 'sessionProjections']

const DEFAULTS = {
  enabled: true,
  balance: true,
  usage: true,
  balanceUrl: 'https://api.deepseek.com/user/balance',
  balanceCacheMs: 60000,
  apiKey: undefined,
}

function booleanOrDefault(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

export function apply(ctx, rawConfig = {}) {
  const config = {
    ...DEFAULTS,
    ...rawConfig,
    enabled: booleanOrDefault(rawConfig.enabled, DEFAULTS.enabled),
    balance: booleanOrDefault(rawConfig.balance, DEFAULTS.balance),
    usage: booleanOrDefault(rawConfig.usage, DEFAULTS.usage),
  }
  if (!config.enabled) return

  const dshHome = process.env.DSH_HOME
  const balance = config.balance
    ? createBalanceProvider({
        apiKey: config.apiKey,
        dshHome,
        balanceUrl: config.balanceUrl,
        cacheMs: config.balanceCacheMs,
      })
    : null

  const handler = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const session = config.usage ? resolveCurrentSession(ctx.sessions) : null
    const usage = config.usage ? collectUsage(ctx.sessionProjections, session) : null
    const payload = {
      fetchedAt: new Date().toISOString(),
      balance: balance ? await balance.get() : null,
      session: usage,
      summary: usage ? summarizeUsage(usage.usage) : null,
    }
    const body = Buffer.from(JSON.stringify(payload, null, 2))
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/dsh-token-pet/data.json', handler }),
    'token-pet: data route',
  )
}
