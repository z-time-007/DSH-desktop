import path from 'node:path'

export const SAFE_READ_TOOLS = new Set([
  'computer_status',
  'workspace_list',
  'workspace_search',
  'secretary_task_list',
  'desktop_app_test',
])

export const SAFE_LOCAL_WRITE_TOOLS = new Set([
  'workspace_make_directory',
  'workspace_copy',
  'workspace_move',
  'secretary_task_add',
  'secretary_task_set_status',
  'secretary_memo_create',
  'secretary_daily_summary_create',
  'secretary_meeting_draft_create',
  'document_create_text',
  'document_create_docx',
  'document_create_pptx',
  'document_create_xlsx',
  'desktop_app_open',
])

export const NEVER_AUTO_APPROVE = new Set([
  'workspace_recycle',
  'desktop_app_install',
  'desktop_app_disable',
  'bash',
  'pwsh',
  'run_code',
  'cordis_define',
  'cordis_run',
])

const DOCUMENT_EXTENSIONS = Object.freeze({
  document_create_text: new Set(['.txt', '.md']),
  document_create_docx: new Set(['.docx']),
  document_create_pptx: new Set(['.pptx']),
  document_create_xlsx: new Set(['.xlsx']),
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isSafeRelativePath(value, { allowDot = false } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500 || value.includes('\0')) return false
  const normalized = value.replaceAll('\\', '/')
  if (normalized === '.') return allowDot
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) return false
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false
  const first = segments[0].toLowerCase()
  if (first === '.assistant' || first === 'security' || first === 'data' || first === 'runtime' || first === 'node_modules') return false
  return true
}

function safeBasename(value, extensions) {
  return typeof value === 'string'
    && value.length >= 3
    && value.length <= 180
    && path.basename(value) === value
    && extensions.has(path.extname(value).toLowerCase())
}

function validateWorkspaceTool(name, args) {
  if (!isPlainObject(args)) return false
  if (name === 'workspace_make_directory') return isSafeRelativePath(args.relativePath)
  if (name === 'workspace_copy' || name === 'workspace_move') {
    return isSafeRelativePath(args.source) && isSafeRelativePath(args.destination) && args.source !== args.destination
  }
  return true
}

function validateDocumentTool(name, args) {
  if (!isPlainObject(args)) return false
  const extensions = DOCUMENT_EXTENSIONS[name]
  return extensions ? safeBasename(args.filename, extensions) : true
}

export function classifyAutoApproval(exec) {
  if (!exec || typeof exec.name !== 'string' || NEVER_AUTO_APPROVE.has(exec.name)) {
    return { allow: false, reason: 'explicitly_excluded_or_invalid' }
  }
  if (SAFE_READ_TOOLS.has(exec.name)) return { allow: true, category: 'bounded_read' }
  if (!SAFE_LOCAL_WRITE_TOOLS.has(exec.name)) return { allow: false, reason: 'not_allowlisted' }
  const args = exec.args ?? exec.arguments ?? {}
  if (exec.name.startsWith('workspace_') && !validateWorkspaceTool(exec.name, args)) {
    return { allow: false, reason: 'unsafe_workspace_arguments' }
  }
  if (exec.name.startsWith('document_') && !validateDocumentTool(exec.name, args)) {
    return { allow: false, reason: 'unsafe_document_arguments' }
  }
  return { allow: true, category: 'bounded_local_write' }
}

