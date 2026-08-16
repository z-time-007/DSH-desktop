/**
 * Append-only JSONL audit trail for @local/dsh-office-docs. Every tool run
 * and every upload writes one event line under
 * `<workspace>/.assistant/office-docs/audit/events.jsonl`.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { ensureSafeDirectory } from './security.js'

export class AuditLog {
  constructor(root, relativePath = '.assistant/office-docs/audit/events.jsonl') {
    this.root = root
    this.relativePath = relativePath
    this.dir = null
  }

  async init() {
    this.dir = await ensureSafeDirectory(this.root, path.posix.dirname(this.relativePath))
    this.filePath = path.join(this.root, this.relativePath.split('/').join(path.sep))
    return this
  }

  async write(entry) {
    if (!this.filePath) await this.init()
    const record = { at: new Date().toISOString(), ...entry }
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, { flag: 'a' })
  }
}

export async function runAudited(audit, meta, fn) {
  const startedAt = Date.now()
  try {
    const result = await fn()
    await audit.write({ ok: true, durationMs: Date.now() - startedAt, ...meta })
    return result
  } catch (error) {
    await audit.write({
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error?.code ?? error?.name ?? 'ERROR',
      message: String(error?.message ?? error).slice(0, 500),
      ...meta,
    })
    throw error
  }
}
