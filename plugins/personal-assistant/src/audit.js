import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { assertNoSymlinkSegments, resolveInside } from './security.js'

export class AuditLog {
  constructor(workspaceRoot, relativePath = '.assistant/audit/events.jsonl') {
    const resolved = resolveInside(workspaceRoot, relativePath, { allowRoot: false })
    this.workspaceRoot = resolved.root
    this.path = resolved.target
  }

  async record({ capability, action, outcome, targets = [], details = {} }) {
    await assertNoSymlinkSegments(this.workspaceRoot, path.dirname(this.path), { allowMissing: true })
    await mkdir(path.dirname(this.path), { recursive: true })
    await assertNoSymlinkSegments(this.workspaceRoot, path.dirname(this.path), { allowMissing: false })
    await assertNoSymlinkSegments(this.workspaceRoot, this.path, { allowMissing: true })
    const entry = {
      timestamp: new Date().toISOString(),
      capability,
      action,
      outcome,
      targets: targets.map((target) => String(target)),
      details,
    }
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' })
  }

  async run(metadata, operation) {
    try {
      const result = await operation()
      await this.record({ ...metadata, outcome: 'success', details: metadata.successDetails?.(result) ?? {} })
      return result
    } catch (error) {
      await this.record({
        ...metadata,
        outcome: 'error',
        details: { code: error?.code ?? error?.name ?? 'ERROR' },
      }).catch(() => {})
      throw error
    }
  }
}
