/**
 * DeepSeek account balance provider for @local/dsh-token-pet.
 *
 * Reads the API key from the DSH home credentials file (DEEPSEEK_API_KEY,
 * resolved through `process.env.DSH_HOME`) or from explicit plugin config,
 * then queries the official read-only balance endpoint. Results are cached
 * in memory; the key itself never leaves this process and is never echoed
 * in any response.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DEFAULT_BALANCE_URL = 'https://api.deepseek.com/user/balance'
export const DEFAULT_CACHE_MS = 60000
export const BALANCE_TIMEOUT_MS = 10000

/** Extract the DEEPSEEK_API_KEY value from credentials file text. Never logs it. */
export function extractApiKey(credentialsText) {
  const match = /^DEEPSEEK_API_KEY:\s*["']?([^"'\r\n]+)/m.exec(credentialsText)
  return match ? match[1].trim() : null
}

/** Read the credentials file under a DSH home directory. */
export async function readApiKeyFromHome(dshHome) {
  try {
    const text = await readFile(join(dshHome, '.credentials.yaml'), 'utf8')
    return extractApiKey(text)
  } catch {
    return null
  }
}

/** Normalize the DeepSeek /user/balance payload into plain numbers. */
export function normalizeBalance(json) {
  return {
    available: json?.is_available === true,
    infos: Array.isArray(json?.balance_infos)
      ? json.balance_infos.map((info) => ({
          currency: String(info.currency ?? ''),
          total: Number(info.total_balance),
          granted: Number(info.granted_balance),
          toppedUp: Number(info.topped_up_balance),
        }))
      : [],
  }
}

/**
 * Create a cached balance provider. `get()` always resolves to
 * `{ ok, error, data }` and never throws.
 */
export function createBalanceProvider({
  apiKey,
  dshHome,
  balanceUrl = DEFAULT_BALANCE_URL,
  cacheMs = DEFAULT_CACHE_MS,
  timeoutMs = BALANCE_TIMEOUT_MS,
  fetcher = fetch,
}) {
  let cached = null
  let cachedAt = 0
  let inflight = null

  async function query(key) {
    const response = await fetcher(balanceUrl, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`balance endpoint returned HTTP ${response.status}`)
    return normalizeBalance(await response.json())
  }

  return {
    async get() {
      const now = Date.now()
      if (cached !== null && now - cachedAt < cacheMs) return cached
      if (inflight !== null) return inflight
      inflight = (async () => {
        try {
          const key = apiKey ?? (dshHome ? await readApiKeyFromHome(dshHome) : null)
          if (!key) return { ok: false, error: 'missing_api_key', data: null }
          const data = await query(key)
          cached = { ok: true, error: null, data }
          cachedAt = Date.now()
          return cached
        } catch (error) {
          return { ok: false, error: String(error instanceof Error ? error.message : error), data: null }
        } finally {
          inflight = null
        }
      })()
      return inflight
    },
  }
}
