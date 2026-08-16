import { access, cp, lstat, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  PolicyError,
  assertNoSymlinkSegments,
  assertTreeHasNoSymlinks,
  resolveInside,
  throwIfAborted,
} from './security.js'

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.csv', '.tsv', '.yml', '.yaml', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.html', '.css', '.xml',
])
const MAX_SEARCH_FILE_BYTES = 1024 * 1024
const MAX_SEARCH_RESULTS = 200

function display(relative) {
  return relative === '.' ? '.' : relative.split(path.sep).join('/')
}

function assertPublicPath(relative) {
  const first = relative.split(path.sep)[0]
  if (first === '.assistant') {
    throw new PolicyError('INTERNAL_PATH_DENIED', 'The internal .assistant directory is managed by the plugin.')
  }
}

async function exists(target) {
  try {
    await access(target)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function preparePublicPath(workspaceRoot, requested, options = {}) {
  const resolved = resolveInside(workspaceRoot, requested, options)
  assertPublicPath(resolved.relative)
  await assertNoSymlinkSegments(resolved.root, resolved.target, { allowMissing: options.allowMissing ?? true })
  return resolved
}

export async function listWorkspace({ workspaceRoot, relativePath = '.', signal }) {
  return preparePublicPath(workspaceRoot, relativePath, { allowRoot: true, allowMissing: false }).then(async (resolved) => {
    throwIfAborted(signal)
    const targetStats = await stat(resolved.target)
    if (!targetStats.isDirectory()) throw new PolicyError('NOT_DIRECTORY', 'The requested path is not a directory.')
    const entries = await readdir(resolved.target, { withFileTypes: true })
    const items = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      throwIfAborted(signal)
      if (resolved.relative === '.' && entry.name === '.assistant') continue
      const child = path.join(resolved.target, entry.name)
      if (entry.isSymbolicLink()) {
        items.push({ name: entry.name, kind: 'blocked_symlink' })
        continue
      }
      const childStats = await stat(child)
      items.push({
        name: entry.name,
        kind: childStats.isDirectory() ? 'directory' : childStats.isFile() ? 'file' : 'other',
        size: childStats.isFile() ? childStats.size : null,
        modifiedAt: childStats.mtime.toISOString(),
      })
    }
    return { path: display(resolved.relative), items }
  })
}

export async function searchWorkspace({ workspaceRoot, query, signal, maxResults = 50 }) {
  if (typeof query !== 'string' || query.trim() === '') {
    throw new PolicyError('INVALID_QUERY', 'query must be a non-empty literal string.')
  }
  const limit = Math.max(1, Math.min(Number(maxResults) || 50, MAX_SEARCH_RESULTS))
  const root = resolveInside(workspaceRoot, '.').root
  await assertNoSymlinkSegments(root, root, { allowMissing: false })
  const needle = query.toLocaleLowerCase()
  const pending = [root]
  const results = []
  let skippedLargeFiles = 0
  let skippedSymlinks = 0

  while (pending.length > 0 && results.length < limit) {
    throwIfAborted(signal)
    const current = pending.pop()
    for (const entry of await readdir(current, { withFileTypes: true })) {
      throwIfAborted(signal)
      if (current === root && entry.name === '.assistant') continue
      const absolute = path.join(current, entry.name)
      const relative = path.relative(root, absolute)
      if (entry.isSymbolicLink()) {
        skippedSymlinks += 1
        continue
      }
      if (entry.isDirectory()) {
        pending.push(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const filenameMatch = entry.name.toLocaleLowerCase().includes(needle)
      const fileStats = await stat(absolute)
      if (fileStats.size > MAX_SEARCH_FILE_BYTES) {
        skippedLargeFiles += 1
        if (filenameMatch) results.push({ path: display(relative), match: 'filename' })
        continue
      }
      if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (filenameMatch) results.push({ path: display(relative), match: 'filename' })
        continue
      }
      const content = await readFile(absolute, 'utf8')
      const index = content.toLocaleLowerCase().indexOf(needle)
      if (index >= 0 || filenameMatch) {
        const line = index < 0 ? null : content.slice(0, index).split(/\r?\n/).length
        results.push({ path: display(relative), match: index >= 0 ? 'content' : 'filename', line })
      }
      if (results.length >= limit) break
    }
  }
  return { queryMatched: results.length, results, truncated: results.length >= limit, skippedLargeFiles, skippedSymlinks }
}

export async function makeWorkspaceDirectory({ workspaceRoot, relativePath, signal }) {
  const resolved = await preparePublicPath(workspaceRoot, relativePath, { allowRoot: false, allowMissing: true })
  throwIfAborted(signal)
  if (await exists(resolved.target)) throw new PolicyError('ALREADY_EXISTS', 'Destination already exists; overwrite is disabled.')
  await assertNoSymlinkSegments(resolved.root, path.dirname(resolved.target), { allowMissing: true })
  await mkdir(resolved.target, { recursive: true })
  await assertNoSymlinkSegments(resolved.root, resolved.target, { allowMissing: false })
  return { path: display(resolved.relative), operation: 'created_directory' }
}

export async function copyInsideWorkspace({ workspaceRoot, source, destination, signal }) {
  const from = await preparePublicPath(workspaceRoot, source, { allowRoot: false, allowMissing: false })
  const to = await preparePublicPath(workspaceRoot, destination, { allowRoot: false, allowMissing: true })
  throwIfAborted(signal)
  if (await exists(to.target)) throw new PolicyError('ALREADY_EXISTS', 'Destination already exists; overwrite is disabled.')
  await assertTreeHasNoSymlinks(from.root, from.target)
  await assertNoSymlinkSegments(to.root, path.dirname(to.target), { allowMissing: true })
  await mkdir(path.dirname(to.target), { recursive: true })
  await cp(from.target, to.target, { recursive: true, force: false, errorOnExist: true, dereference: false })
  return { source: display(from.relative), destination: display(to.relative), operation: 'copied' }
}

export async function moveInsideWorkspace({ workspaceRoot, source, destination, signal }) {
  const from = await preparePublicPath(workspaceRoot, source, { allowRoot: false, allowMissing: false })
  const to = await preparePublicPath(workspaceRoot, destination, { allowRoot: false, allowMissing: true })
  throwIfAborted(signal)
  if (await exists(to.target)) throw new PolicyError('ALREADY_EXISTS', 'Destination already exists; overwrite is disabled.')
  await assertTreeHasNoSymlinks(from.root, from.target)
  await assertNoSymlinkSegments(to.root, path.dirname(to.target), { allowMissing: true })
  await mkdir(path.dirname(to.target), { recursive: true })
  await rename(from.target, to.target)
  return { source: display(from.relative), destination: display(to.relative), operation: 'moved' }
}

export async function recycleInsideWorkspace({ workspaceRoot, relativePath, confirm, signal }) {
  if (confirm !== true) {
    throw new PolicyError('CONFIRMATION_REQUIRED', 'Recycling requires confirm=true and a separate DSH approval.')
  }
  const source = await preparePublicPath(workspaceRoot, relativePath, { allowRoot: false, allowMissing: false })
  throwIfAborted(signal)
  await assertTreeHasNoSymlinks(source.root, source.target)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const recycleRelative = path.join('.assistant', 'recycle-bin', `${stamp}-${randomUUID()}-${path.basename(source.target)}`)
  const recycle = resolveInside(workspaceRoot, recycleRelative, { allowRoot: false })
  await assertNoSymlinkSegments(recycle.root, path.dirname(recycle.target), { allowMissing: true })
  await mkdir(path.dirname(recycle.target), { recursive: true })
  await rename(source.target, recycle.target)
  return {
    source: display(source.relative),
    recycledAs: display(path.relative(recycle.root, recycle.target)),
    operation: 'moved_to_quarantine_recycle_bin',
    recoverable: true,
  }
}

export async function pathKind(workspaceRoot, relativePath) {
  const resolved = await preparePublicPath(workspaceRoot, relativePath, { allowRoot: false, allowMissing: false })
  const stats = await lstat(resolved.target)
  return stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other'
}
