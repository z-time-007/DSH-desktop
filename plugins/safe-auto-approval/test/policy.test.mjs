import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../src/dsh-plugin.js'
import { classifyAutoApproval, isSafeRelativePath } from '../src/policy.js'

test('path policy accepts bounded workspace paths and rejects escapes or protected roots', () => {
  assert.equal(isSafeRelativePath('outputs/report.docx'), true)
  assert.equal(isSafeRelativePath('../outside'), false)
  assert.equal(isSafeRelativePath('D:\\outside'), false)
  assert.equal(isSafeRelativePath('.assistant/audit'), false)
  assert.equal(isSafeRelativePath('security/report'), false)
  assert.equal(isSafeRelativePath('a//b'), false)
})

test('classification is an exact allowlist with argument checks', () => {
  assert.equal(classifyAutoApproval({ name: 'computer_status' }).allow, true)
  assert.equal(classifyAutoApproval({ name: 'workspace_move', args: { source: 'draft/a.md', destination: 'done/a.md' } }).allow, true)
  assert.equal(classifyAutoApproval({ name: 'workspace_move', args: { source: '../a', destination: 'done/a' } }).allow, false)
  assert.equal(classifyAutoApproval({ name: 'document_create_docx', args: { filename: 'report.docx' } }).allow, true)
  assert.equal(classifyAutoApproval({ name: 'document_create_docx', args: { filename: '../report.docx' } }).allow, false)
  for (const name of ['workspace_recycle', 'desktop_app_install', 'desktop_app_disable', 'bash', 'pwsh', 'run_code', 'cordis_define', 'unknown_future_tool']) {
    assert.equal(classifyAutoApproval({ name, args: {} }).allow, false, name)
  }
})

test('plugin only converts downstream ask for safe calls and records metadata-only audit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-auto-approval-'))
  let listener
  let listenerOptions
  let statusHandler
  const ctx = {
    effect(register) { return register() },
    webServer: {
      register(definition) {
        assert.equal(definition.path, '/local-safe-auto-approval/status.json')
        statusHandler = definition.handler
        return () => {}
      },
    },
    on(name, callback, options) {
      assert.equal(name, 'tools/pre-execute')
      listener = callback
      listenerOptions = options
      return () => {}
    },
  }
  try {
    apply(ctx, { harnessRoot: root })
    assert.equal(listenerOptions.prepend, true)
    const secret = 'DO_NOT_PERSIST_THIS_DOCUMENT_BODY'
    const allowed = await listener(
      { name: 'document_create_docx', callId: 'call-1', args: { filename: 'report.docx', paragraphs: [secret] } },
      async () => ({ kind: 'ask', reason: 'generic write approval' }),
    )
    assert.deepEqual(allowed, { kind: 'allow' })
    assert.equal((await listener({ name: 'workspace_recycle', args: { relativePath: 'old.txt', confirm: true } }, async () => ({ kind: 'ask' }))).kind, 'ask')
    assert.equal((await listener({ name: 'document_create_docx', args: { filename: 'report.docx' } }, async () => ({ kind: 'deny', reason: 'policy deny' }))).kind, 'deny')
    assert.equal((await listener({ name: 'document_create_docx', args: { filename: 'report.docx' } }, async () => ({ kind: 'allow' }))).kind, 'allow')
    const audit = await fs.readFile(path.join(root, 'workspace', '.assistant', 'audit', 'auto-approvals.jsonl'), 'utf8')
    assert.match(audit, /document_create_docx/u)
    assert.doesNotMatch(audit, new RegExp(secret, 'u'))
    assert.doesNotMatch(audit, /report\.docx/u)

    const response = {
      status: 0, body: Buffer.alloc(0),
      writeHead(status) { this.status = status },
      end(body) { this.body = body ? Buffer.from(body) : Buffer.alloc(0) },
    }
    statusHandler({ method: 'GET' }, response)
    assert.equal(response.status, 200)
    const status = JSON.parse(response.body)
    assert.equal(status.enabled, true)
    assert.equal(status.safeLocalWrites.includes('document_create_docx'), true)
    assert.equal(status.neverAutoApprove.includes('bash'), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
})
