import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PolicyError, assertNoSymlinkSegments, resolveInside, throwIfAborted } from './security.js'

const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled'])
const MAX_TEXT_BYTES = 1024 * 1024

function requireText(value, field, maxBytes = MAX_TEXT_BYTES) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PolicyError('INVALID_TEXT', `${field} must be a non-empty string.`)
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new PolicyError('TEXT_TOO_LARGE', `${field} exceeds the ${maxBytes}-byte limit.`)
  }
  return value
}

function optionalText(value, field, maxBytes = MAX_TEXT_BYTES) {
  if (value === undefined || value === null || value === '') return ''
  return requireText(value, field, maxBytes)
}

function requireDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PolicyError('INVALID_DATE', 'date must use YYYY-MM-DD.')
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new PolicyError('INVALID_DATE', 'date is not a valid calendar date.')
  }
  return value
}

function slug(value) {
  return value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[. -]+$/g, '')
    .slice(0, 60) || 'note'
}

function markdownList(values) {
  if (!Array.isArray(values) || values.length === 0) return '- （待补充）'
  return values.map((item) => `- ${String(item).replace(/\r?\n/g, ' ')}`).join('\n')
}

async function ensureSecretaryDirectory(workspaceRoot, relative) {
  const resolved = resolveInside(workspaceRoot, path.join('.assistant', 'secretary', relative))
  await assertNoSymlinkSegments(resolved.root, path.dirname(resolved.target), { allowMissing: true })
  await mkdir(resolved.target, { recursive: true })
  await assertNoSymlinkSegments(resolved.root, resolved.target, { allowMissing: false })
  return resolved
}

async function tasksPath(workspaceRoot) {
  const directory = await ensureSecretaryDirectory(workspaceRoot, '')
  return path.join(directory.target, 'tasks.json')
}

async function readTasks(workspaceRoot) {
  const target = await tasksPath(workspaceRoot)
  await assertNoSymlinkSegments(workspaceRoot, target, { allowMissing: true })
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('tasks.json root is not an array')
    return { target, tasks: parsed }
  } catch (error) {
    if (error?.code === 'ENOENT') return { target, tasks: [] }
    throw new PolicyError('TASK_STORE_INVALID', `Cannot read task store: ${error.message}`)
  }
}

async function writeTasks(workspaceRoot, target, tasks) {
  const resolved = resolveInside(workspaceRoot, path.relative(workspaceRoot, target), { allowRoot: false })
  await assertNoSymlinkSegments(resolved.root, resolved.target, { allowMissing: true })
  await writeFile(resolved.target, `${JSON.stringify(tasks, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
}

export async function addTask({ workspaceRoot, title, notes, due, signal }) {
  throwIfAborted(signal)
  const safeTitle = requireText(title, 'title', 4096)
  const safeNotes = optionalText(notes, 'notes')
  if (due !== undefined && due !== null && due !== '') requireDate(due)
  const { target, tasks } = await readTasks(workspaceRoot)
  const now = new Date().toISOString()
  const task = {
    id: randomUUID(),
    title: safeTitle,
    notes: safeNotes,
    due: due || null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }
  tasks.push(task)
  throwIfAborted(signal)
  await writeTasks(workspaceRoot, target, tasks)
  return { id: task.id, status: task.status, due: task.due, taskCount: tasks.length }
}

export async function listTasks({ workspaceRoot, status, signal }) {
  throwIfAborted(signal)
  if (status !== undefined && !TASK_STATUSES.has(status)) {
    throw new PolicyError('INVALID_STATUS', `status must be one of: ${[...TASK_STATUSES].join(', ')}.`)
  }
  const { tasks } = await readTasks(workspaceRoot)
  const filtered = status ? tasks.filter((task) => task.status === status) : tasks
  return { tasks: filtered, total: filtered.length }
}

export async function setTaskStatus({ workspaceRoot, id, status, signal }) {
  throwIfAborted(signal)
  requireText(id, 'id', 128)
  if (!TASK_STATUSES.has(status)) {
    throw new PolicyError('INVALID_STATUS', `status must be one of: ${[...TASK_STATUSES].join(', ')}.`)
  }
  const { target, tasks } = await readTasks(workspaceRoot)
  const task = tasks.find((entry) => entry.id === id)
  if (!task) throw new PolicyError('TASK_NOT_FOUND', 'Task id was not found.')
  task.status = status
  task.updatedAt = new Date().toISOString()
  throwIfAborted(signal)
  await writeTasks(workspaceRoot, target, tasks)
  return { id: task.id, status: task.status }
}

async function writeMarkdownDraft({ workspaceRoot, directory, filename, content, signal }) {
  const folder = await ensureSecretaryDirectory(workspaceRoot, directory)
  const target = resolveInside(folder.root, path.relative(folder.root, path.join(folder.target, filename)), { allowRoot: false })
  await assertNoSymlinkSegments(target.root, path.dirname(target.target), { allowMissing: false })
  throwIfAborted(signal)
  await writeFile(target.target, content, { encoding: 'utf8', flag: 'wx' })
  return path.relative(workspaceRoot, target.target).split(path.sep).join('/')
}

export async function createMemo({ workspaceRoot, title, content, signal }) {
  const safeTitle = requireText(title, 'title', 4096)
  const safeContent = requireText(content, 'content')
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const filename = `${createdAt.slice(0, 10)}-${slug(safeTitle)}-${id.slice(0, 8)}.md`
  const body = `---\nid: ${id}\ntype: memo\ncreated_at: ${createdAt}\n---\n\n# ${safeTitle}\n\n${safeContent}\n`
  const relativePath = await writeMarkdownDraft({ workspaceRoot, directory: 'memos', filename, content: body, signal })
  return { id, path: relativePath, type: 'memo' }
}

export async function createDailySummary({ workspaceRoot, date, content, signal }) {
  const safeDate = requireDate(date)
  const safeContent = requireText(content, 'content')
  const body = `---\ntype: daily-summary\ndate: ${safeDate}\n---\n\n# ${safeDate} 每日摘要\n\n${safeContent}\n`
  const relativePath = await writeMarkdownDraft({ workspaceRoot, directory: 'daily', filename: `${safeDate}.md`, content: body, signal })
  return { date: safeDate, path: relativePath, type: 'daily-summary' }
}

export async function createMeetingDraft({ workspaceRoot, title, date, attendees = [], agenda = [], notes = '', signal }) {
  const safeTitle = requireText(title, 'title', 4096)
  const safeDate = requireDate(date)
  const safeNotes = optionalText(notes, 'notes')
  const id = randomUUID()
  const filename = `${safeDate}-${slug(safeTitle)}-${id.slice(0, 8)}.md`
  const body = [
    '---',
    `id: ${id}`,
    'type: meeting-draft',
    `date: ${safeDate}`,
    '---',
    '',
    `# ${safeTitle}`,
    '',
    '## 参会人',
    '',
    markdownList(attendees),
    '',
    '## 议程',
    '',
    markdownList(agenda),
    '',
    '## 会议记录草稿',
    '',
    safeNotes || '（待补充）',
    '',
    '## 决策与行动项',
    '',
    '- （待补充）',
    '',
  ].join('\n')
  const relativePath = await writeMarkdownDraft({ workspaceRoot, directory: 'meetings', filename, content: body, signal })
  return { id, path: relativePath, type: 'meeting-draft' }
}
