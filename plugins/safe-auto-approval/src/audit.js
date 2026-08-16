import fs from 'node:fs/promises'
import path from 'node:path'

export function resolveHarnessRoot(config = {}) {
  if (typeof config.harnessRoot === 'string' && path.isAbsolute(config.harnessRoot)) return path.resolve(config.harnessRoot)
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME, '..', '..')
  return process.cwd()
}

function resolveAuditPath(root, relativePath) {
  const safe = typeof relativePath === 'string' && relativePath.length > 0
    ? relativePath.replaceAll('\\', '/')
    : '.assistant/audit/auto-approvals.jsonl'
  if (safe.startsWith('/') || /^[A-Za-z]:/u.test(safe) || safe.split('/').includes('..')) {
    throw new Error('auto-approval auditPath must be workspace-relative')
  }
  const workspaceRoot = path.join(root, 'workspace')
  const target = path.resolve(workspaceRoot, safe)
  if (!target.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`)) throw new Error('auto-approval auditPath escapes workspace')
  return target
}

export class AutoApprovalAudit {
  constructor(root, relativePath) {
    this.filePath = resolveAuditPath(root, relativePath)
    this.chain = Promise.resolve()
  }

  async append(exec, category) {
    const event = {
      at: new Date().toISOString(),
      event: 'safe_tool_auto_approved',
      toolName: exec.name,
      category,
      callId: typeof exec.callId === 'string' ? exec.callId : undefined,
    }
    this.chain = this.chain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
    })
    await this.chain
  }
}

