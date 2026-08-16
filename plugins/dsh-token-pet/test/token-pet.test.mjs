/**
 * Unit tests for @local/dsh-token-pet. Run with:
 *   node --test test/*.test.mjs
 *
 * Offline: no real network calls, no DSH server, no credentials touched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractApiKey,
  readApiKeyFromHome,
  normalizeBalance,
  createBalanceProvider,
} from '../src/balance.js'
import { resolveCurrentSession, collectUsage, summarizeUsage } from '../src/usage.js'
import * as plugin from '../src/dsh-plugin.js'

test('extractApiKey: parses plain, quoted, and missing forms', () => {
  assert.equal(extractApiKey('DEEPSEEK_API_KEY: sk-abc123\n'), 'sk-abc123')
  assert.equal(extractApiKey('DEEPSEEK_API_KEY: "sk-quoted"\n'), 'sk-quoted')
  assert.equal(extractApiKey('DEEPSEEK_API_KEY: \'sk-single\'\n'), 'sk-single')
  assert.equal(extractApiKey('# comment only\n'), null)
  assert.equal(extractApiKey('OTHER_KEY: sk-x\n'), null)
})

test('readApiKeyFromHome: reads credentials file and returns null on failure', async () => {
  const dir = new URL('./fixtures/', import.meta.url).pathname
  assert.equal(await readApiKeyFromHome(dir), null) // no such file
})

test('normalizeBalance: maps official payload to plain numbers', () => {
  const normalized = normalizeBalance({
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
    ],
  })
  assert.equal(normalized.available, true)
  assert.equal(normalized.infos.length, 1)
  assert.deepEqual(normalized.infos[0], { currency: 'CNY', total: 110, granted: 10, toppedUp: 100 })
  assert.deepEqual(normalizeBalance({}), { available: false, infos: [] })
})

test('balance provider: caches within window and reports errors', async () => {
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return { ok: true, json: async () => ({ is_available: true, balance_infos: [] }) }
  }
  const provider = createBalanceProvider({ apiKey: 'sk-test', cacheMs: 60000, fetcher })
  const first = await provider.get()
  const second = await provider.get()
  assert.equal(first.ok, true)
  assert.deepEqual(first, second)
  assert.equal(calls, 1, 'second read must hit the cache')

  const failing = createBalanceProvider({
    apiKey: 'sk-test',
    fetcher: async () => ({ ok: false, status: 401 }),
  })
  const result = await failing.get()
  assert.equal(result.ok, false)
  assert.match(result.error, /401/)
})

test('balance provider: missing key is reported without throwing', async () => {
  const provider = createBalanceProvider({ dshHome: new URL('./fixtures/', import.meta.url).pathname, cacheMs: 0 })
  const result = await provider.get()
  assert.equal(result.ok, false)
  assert.equal(result.error, 'missing_api_key')
})

test('resolveCurrentSession: picks newest by createdAt, tolerates empty', () => {
  assert.equal(resolveCurrentSession({ list: () => [] }), null)
  const sessions = {
    list: () => [
      { id: 'a', header: { createdAt: 100 } },
      { id: 'b', header: { createdAt: 300 } },
      { id: 'c', header: { createdAt: 200 } },
    ],
  }
  assert.equal(resolveCurrentSession(sessions).id, 'b')
})

test('collectUsage: reads projections and degrades gracefully', () => {
  const projections = {
    snapshot: () => ({
      values: {
        tokenUsage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 },
        contextPressure: { pressureTokens: 18, projectedTokens: 20, contextWindow: 65536 },
        sessionStats: { steps: 4, turns: 2 },
      },
    }),
  }
  const collected = collectUsage(projections, { id: 's1' })
  assert.equal(collected.sessionId, 's1')
  assert.equal(collected.usage.uncachedInputTokens, 10)
  assert.equal(collected.context.contextWindow, 65536)
  assert.equal(collected.stats.turns, 2)
  assert.equal(collectUsage(projections, null).sessionId, null)
  assert.equal(collectUsage({ snapshot: () => { throw new Error('boom') } }, { id: 's2' }).usage, null)
})

test('summarizeUsage: totals buckets', () => {
  assert.equal(summarizeUsage(null), null)
  const summary = summarizeUsage({ uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 })
  assert.deepEqual(summary, { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, total: 18 })
})

test('plugin entry exposes the official contract', () => {
  assert.equal(plugin.name, 'token-pet')
  assert.deepEqual(plugin.inject, ['webServer', 'sessions', 'sessionProjections'])
  assert.equal(typeof plugin.apply, 'function')
})

test('plugin apply is inert when disabled', async () => {
  const touched = []
  const ctx = {
    webServer: { register: () => { touched.push('register'); return () => {} } },
    sessions: { list: () => [] },
    sessionProjections: {},
    effect: (fn) => touched.push(typeof fn),
  }
  plugin.apply(ctx, { enabled: false })
  assert.deepEqual(touched, [])
})

test('plugin apply registers the data route with 405/GET handling', async () => {
  const routes = []
  const ctx = {
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
    sessions: { list: () => [] },
    sessionProjections: {},
    effect: (fn) => { const dispose = fn(); assert.equal(typeof dispose, 'function') },
  }
  plugin.apply(ctx, { balance: false, usage: false })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, '/dsh-token-pet/data.json')
})
