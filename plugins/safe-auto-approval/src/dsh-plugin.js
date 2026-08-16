import { AutoApprovalAudit, resolveHarnessRoot } from './audit.js'
import { classifyAutoApproval, NEVER_AUTO_APPROVE, SAFE_LOCAL_WRITE_TOOLS, SAFE_READ_TOOLS } from './policy.js'

export const name = 'safe-auto-approval'
export const inject = ['tools', 'webServer']

function sendStatus(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  const body = Buffer.from(JSON.stringify({
    ok: true,
    enabled: true,
    mode: 'allowlist-only',
    safeReads: [...SAFE_READ_TOOLS].sort(),
    safeLocalWrites: [...SAFE_LOCAL_WRITE_TOOLS].sort(),
    neverAutoApprove: [...NEVER_AUTO_APPROVE].sort(),
    unknownTools: 'ask-or-deny',
    audit: '.assistant/audit/auto-approvals.jsonl',
  }, null, 2))
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

export function apply(ctx, rawConfig = {}) {
  if (rawConfig.enabled === false) return
  const audit = new AutoApprovalAudit(resolveHarnessRoot(rawConfig), rawConfig.auditPath)

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/local-safe-auto-approval/status.json', handler: sendStatus }),
    'safe-auto-approval: read-only status route',
  )

  ctx.on('tools/pre-execute', async (exec, next) => {
    const downstream = await next()
    if (!downstream || downstream.kind !== 'ask') return downstream
    const classification = classifyAutoApproval(exec)
    if (!classification.allow) return downstream
    try {
      await audit.append(exec, classification.category)
    } catch {
      return {
        kind: 'deny',
        reason: 'Safe auto-approval audit could not be written; the operation was blocked closed.',
      }
    }
    return { kind: 'allow' }
  }, { prepend: true })
}

export { classifyAutoApproval } from './policy.js'
