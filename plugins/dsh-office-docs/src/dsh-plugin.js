/**
 * @local/dsh-office-docs — document processing plugin for DeepSeek Harness.
 *
 * Host-side Cordis plugin exposing:
 *   - Tools (ctx.tools.register): office_read (docx/pptx/xlsx/txt/md/csv) and
 *     document_create_text / document_create_docx / document_create_pptx /
 *     document_create_xlsx, all confined to the fixed workspace root.
 *   - POST /dsh-office-docs/upload: loopback-only binary sink that stores an
 *     uploaded office file under <workspace>/uploads for the chat-composer
 *     upload button (lib/client.js).
 *
 * Official plugin contract: exports `name`, `inject`, `apply(ctx, config)`.
 */

import path from 'node:path'
import { createOfficeCore } from './core.js'

export const name = 'office-docs'
export const inject = ['tools', 'webServer']

const jsonOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function compileValue(spec) {
  if (spec.oneOf) return { oneOf: spec.oneOf.map(compileValue) }
  const output = { type: spec.type }
  if (spec.description) output.description = spec.description
  if (spec.enum) output.enum = [...spec.enum]
  if (spec.type === 'array' && spec.items) output.items = compileValue(spec.items)
  if (spec.type === 'object') {
    output.additionalProperties = spec.additionalProperties ?? false
    output.properties = {}
    const required = []
    for (const [key, child] of Object.entries(spec.properties ?? {})) {
      output.properties[key] = compileValue(child)
      if (child.required) required.push(key)
    }
    if (required.length > 0) output.required = required
  }
  return output
}

function compileParameters(parameters) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(parameters)) {
    properties[key] = compileValue(spec)
    if (spec.required) required.push(key)
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

function booleanOrDefault(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function resolveHarnessRoot() {
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME, '..', '..')
  return process.cwd()
}

function resolveWorkspaceRoot(rawConfig) {
  if (typeof rawConfig.workspaceRoot === 'string' && path.isAbsolute(rawConfig.workspaceRoot)) {
    return path.resolve(rawConfig.workspaceRoot)
  }
  if (typeof process.env.DSH_OFFICE_WORKSPACE === 'string' && process.env.DSH_OFFICE_WORKSPACE.trim() !== '') {
    return path.resolve(process.env.DSH_OFFICE_WORKSPACE)
  }
  return path.join(resolveHarnessRoot(), 'workspace')
}

function isLoopbackHost(host = '') {
  const normalized = host.toLowerCase().split(':')[0].replace(/^\[|\]$/gu, '')
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

function sendJson(req, res, status, value) {
  const body = Buffer.from(JSON.stringify(value, null, 2))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true
  res.writeHead(405, { allow: methods.join(', ') })
  res.end()
  return false
}

function requireLocalMutation(req, res) {
  if (!isLoopbackHost(req.headers.host || '')) {
    sendJson(req, res, 403, { ok: false, error: '只允许本机访问。' })
    return false
  }
  const origin = req.headers.origin
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof origin !== 'string' || !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/iu.test(origin)) {
    sendJson(req, res, 403, { ok: false, error: '来源校验失败。' })
    return false
  }
  if (fetchSite && fetchSite !== 'same-origin') {
    sendJson(req, res, 403, { ok: false, error: '跨站请求已拒绝。' })
    return false
  }
  return true
}

async function readBody(req, maxBytes) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new Error('请求体超过大小限制。')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function register(ctx, core, definition, method) {
  ctx.tools.register({
    ...definition,
    parameters: compileParameters(definition.parameters),
    output: jsonOutput,
    async execute(args, exec) {
      return core[method]({ ...args, signal: exec.signal })
    },
  })
}

export async function apply(ctx, rawConfig = {}) {
  const config = {
    enabled: booleanOrDefault(rawConfig.enabled, true),
    read: booleanOrDefault(rawConfig.read, true),
    write: booleanOrDefault(rawConfig.write, true),
    uploads: booleanOrDefault(rawConfig.uploads, true),
    workspaceRoot: resolveWorkspaceRoot(rawConfig),
    uploadsDir: rawConfig.uploadsDir ?? 'uploads',
    outputsDir: rawConfig.outputsDir ?? 'outputs',
    maxUploadBytes: Number.isFinite(Number(rawConfig.maxUploadBytes)) ? Number(rawConfig.maxUploadBytes) : 25 * 1024 * 1024,
  }
  if (!config.enabled) return

  const core = await createOfficeCore(config)

  if (config.read) {
    register(ctx, core, {
      name: 'office_read',
      description: 'Read a Word (docx), PowerPoint (pptx), Excel (xlsx), or plain-text (txt/md/csv) file inside the fixed workspace and return its text content. Path is workspace-relative (e.g. "uploads/report.docx").',
      parameters: {
        path: { type: 'string', required: true, description: 'Workspace-relative path of the file to read.' },
        maxChars: { type: 'integer', required: false, description: 'Optional cap on plain-text characters returned (default 200000).' },
      },
    }, 'readOffice')
  }

  if (config.write) {
    register(ctx, core, {
      name: 'document_create_text',
      description: 'Create a new UTF-8 TXT or Markdown file under workspace/outputs. Overwrite is disabled.',
      parameters: {
        filename: { type: 'string', required: true, description: 'Basename ending in .txt or .md; no directory.' },
        format: { type: 'string', required: true, enum: ['txt', 'md'] },
        content: { type: 'string', required: true },
      },
    }, 'createTextDocument')
    register(ctx, core, {
      name: 'document_create_docx',
      description: 'Create a new macro-free Word DOCX under workspace/outputs from a title, paragraphs, and an optional table.',
      parameters: {
        filename: { type: 'string', required: true, description: 'Basename ending in .docx; no directory.' },
        title: { type: 'string', required: false },
        paragraphs: { type: 'array', required: false, items: { type: 'string' } },
        table: { type: 'array', required: false, items: { type: 'array', items: { type: 'string' } } },
      },
    }, 'createDocxDocument')
    register(ctx, core, {
      name: 'document_create_pptx',
      description: 'Create a new PowerPoint PPTX (text-only 16:9 slides) under workspace/outputs.',
      parameters: {
        filename: { type: 'string', required: true, description: 'Basename ending in .pptx; no directory.' },
        title: { type: 'string', required: false },
        slides: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              title: { type: 'string', required: true },
              bullets: { type: 'array', required: false, items: { type: 'string' } },
            },
          },
        },
      },
    }, 'createPptxDocument')
    register(ctx, core, {
      name: 'document_create_xlsx',
      description: 'Create a new formula-free Excel XLSX under workspace/outputs from a header row and scalar cells.',
      parameters: {
        filename: { type: 'string', required: true, description: 'Basename ending in .xlsx; no directory.' },
        sheetName: { type: 'string', required: false },
        columns: { type: 'array', required: true, items: { type: 'string' } },
        rows: {
          type: 'array', required: true,
          items: {
            type: 'array',
            items: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] },
          },
        },
      },
    }, 'createXlsxDocument')
  }

  if (config.uploads) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-office-docs/upload',
      handler: async (req, res) => {
        if (!methodAllowed(req, res, ['POST']) || !requireLocalMutation(req, res)) return
        try {
          const rawName = req.headers['x-file-name']
          const fileName = typeof rawName === 'string' && rawName.trim() !== '' ? decodeURIComponent(rawName) : 'upload'
          const buffer = await readBody(req, config.maxUploadBytes + 1024)
          const file = await core.saveUpload(buffer, fileName)
          sendJson(req, res, 200, { ok: true, file, uploadsDir: config.uploadsDir })
        } catch (error) {
          sendJson(req, res, 400, { ok: false, error: String(error?.message || error), code: error?.code })
        }
      },
    }), 'office-docs: upload route')
  }
}
