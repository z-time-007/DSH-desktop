/**
 * Path policy for @local/dsh-office-docs: every file the plugin touches must
 * live inside the fixed workspace root, and no symbolic link may be crossed.
 * Adapted from the local personal-assistant policy with the same invariants.
 */

import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export class PolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PolicyError'
    this.code = code
  }
}

function assertSafeSegments(value) {
  if (value.includes('\0')) {
    throw new PolicyError('INVALID_PATH', 'Path contains a null byte.')
  }
  const segments = value.split(/[\\/]+/).filter(Boolean)
  for (const segment of segments) {
    if (segment === '.' || segment === '..') continue
    if (segment.includes(':')) {
      throw new PolicyError('INVALID_PATH', 'NTFS alternate streams and drive-qualified segments are not allowed.')
    }
    if (segment.endsWith('.') || segment.endsWith(' ') || WINDOWS_DEVICE.test(segment)) {
      throw new PolicyError('INVALID_PATH', `Unsafe Windows path segment: ${segment}`)
    }
  }
}

export function normalizeAllowedRoot(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new PolicyError('ROOT_REQUIRED', 'A fixed workspace root is required.')
  }
  return path.resolve(root)
}

export function resolveInside(root, requested = '.', { allowRoot = true } = {}) {
  const allowedRoot = normalizeAllowedRoot(root)
  if (typeof requested !== 'string' || requested.trim() === '') {
    throw new PolicyError('INVALID_PATH', 'Path must be a non-empty relative string.')
  }
  assertSafeSegments(requested)
  if (path.isAbsolute(requested) || /^[A-Za-z]:/.test(requested) || requested.startsWith('\\\\')) {
    throw new PolicyError('PATH_ESCAPE', 'Absolute and UNC paths are not allowed.')
  }
  const target = path.resolve(allowedRoot, requested)
  const relative = path.relative(allowedRoot, target)
  if (relative === '' && !allowRoot) {
    throw new PolicyError('ROOT_MUTATION_DENIED', 'The workspace root itself cannot be mutated.')
  }
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new PolicyError('PATH_ESCAPE', 'Path escapes the allowed workspace root.')
  }
  return { root: allowedRoot, target, relative: relative || '.' }
}

export async function assertNoSymlinkSegments(root, target, { allowMissing = true } = {}) {
  const allowedRoot = normalizeAllowedRoot(root)
  const relative = path.relative(allowedRoot, path.resolve(target))
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new PolicyError('PATH_ESCAPE', 'Path escapes the allowed workspace root.')
  }

  const segments = relative === '' ? [] : relative.split(path.sep)
  let cursor = allowedRoot
  for (const segment of segments) {
    cursor = path.join(cursor, segment)
    let stats
    try {
      stats = await lstat(cursor)
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return
      throw error
    }
    if (stats.isSymbolicLink()) {
      throw new PolicyError('SYMLINK_DENIED', `Symbolic links are not allowed: ${path.relative(allowedRoot, cursor)}`)
    }
  }
}

export async function ensureSafeDirectory(root, relative) {
  const resolved = resolveInside(root, relative)
  await assertNoSymlinkSegments(resolved.root, path.dirname(resolved.target), { allowMissing: true })
  await mkdir(resolved.target, { recursive: true })
  await assertNoSymlinkSegments(resolved.root, resolved.target, { allowMissing: false })
  return resolved
}

export async function assertRootIdentity(root) {
  const normalized = normalizeAllowedRoot(root)
  await mkdir(normalized, { recursive: true })
  const stats = await lstat(normalized)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new PolicyError('UNSAFE_ROOT', 'The configured workspace root must be a real directory, not a link.')
  }
  const canonical = await realpath(normalized)
  const comparable = (value) => path.resolve(value.replace(/^\\\\\?\\/, '')).toLocaleLowerCase()
  if (comparable(canonical) !== comparable(normalized)) {
    throw new PolicyError('UNSAFE_ROOT', 'The configured workspace root resolves to a different location.')
  }
  return normalized
}

export function safeStoredName(filename) {
  if (typeof filename !== 'string' || filename.trim() === '') {
    throw new PolicyError('INVALID_FILENAME', 'filename must be a non-empty string.')
  }
  assertSafeSegments(filename)
  if (path.basename(filename) !== filename || path.isAbsolute(filename)) {
    throw new PolicyError('INVALID_FILENAME', 'filename must not contain directories.')
  }
  return filename
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Operation aborted.')
    error.name = 'AbortError'
    throw error
  }
}
