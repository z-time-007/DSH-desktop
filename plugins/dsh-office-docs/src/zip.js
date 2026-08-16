/**
 * Minimal ZIP container support for @local/dsh-office-docs.
 *
 * Reading: strict central-directory walk with path-safety checks, deflate
 * (method 8) and store (method 0) only, entry-size verification.
 * Writing: one-pass deflate writer (method 8) with CRC-32 from node:zlib.
 *
 * Zero runtime dependencies — node:zlib only.
 */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'
import { PolicyError } from './security.js'

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50

function findEocd(buffer) {
  const lowerBound = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new PolicyError('INVALID_ZIP', 'ZIP end-of-central-directory record was not found.')
}

function assertSafeZipName(name) {
  if (name.length === 0) throw new PolicyError('INVALID_ZIP_PATH', 'Empty ZIP entry name.')
  if (name.includes('..') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\')) {
    throw new PolicyError('INVALID_ZIP_PATH', `Unsafe ZIP entry: ${name}`)
  }
}

/** Strictly parse a ZIP buffer into a name → Buffer map (no symlinks, no zip bombs). */
export function readZip(buffer, { maxEntries = 512, maxEntryBytes = 64 * 1024 * 1024 } = {}) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new PolicyError('INVALID_ZIP', 'Not a ZIP archive (missing local file header).')
  }
  const eocd = findEocd(buffer)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount > maxEntries) throw new PolicyError('ZIP_TOO_MANY_ENTRIES', `ZIP has more than ${maxEntries} entries.`)
  const entries = new Map()
  let cursor = centralOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new PolicyError('INVALID_ZIP', 'Invalid central directory entry.')
    }
    const compression = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    assertSafeZipName(name)
    if (name.endsWith('/')) {
      cursor += 46 + nameLength + extraLength + commentLength
      continue
    }
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new PolicyError('INVALID_ZIP', `Invalid local header for ${name}.`)
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize)
    let content
    if (compression === 0) content = Buffer.from(compressed)
    else if (compression === 8) content = inflateRawSync(compressed)
    else throw new PolicyError('UNSUPPORTED_ZIP_COMPRESSION', `Unsupported ZIP method ${compression} for ${name}.`)
    if (content.length !== uncompressedSize) {
      throw new PolicyError('INVALID_ZIP', `Uncompressed size mismatch for ${name}.`)
    }
    if (content.length > maxEntryBytes) {
      throw new PolicyError('ZIP_ENTRY_TOO_LARGE', `ZIP entry exceeds size limit: ${name}`)
    }
    entries.set(name, content)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const DOS_EPOCH = Date.UTC(1980, 0, 1)

function dosDateTime(date = new Date()) {
  const time = Math.floor((date.getTime() - DOS_EPOCH) / 1000)
  const clamped = Math.max(0, Math.min(0xffffffff, time))
  return clamped
}

function localHeader(name, data, compressed, crc) {
  const nameBuffer = Buffer.from(name, 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(LOCAL_SIGNATURE, 0)
  header.writeUInt16LE(20, 4) // version needed
  header.writeUInt16LE(0x0800, 6) // flags: UTF-8 names
  header.writeUInt16LE(8, 8) // method: deflate
  header.writeUInt32LE(dosDateTime(), 10)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(compressed.length, 18)
  header.writeUInt32LE(data.length, 22)
  header.writeUInt16LE(nameBuffer.length, 26)
  header.writeUInt16LE(0, 28) // extra length
  return Buffer.concat([header, nameBuffer, compressed])
}

function centralEntry(name, data, compressed, crc, localOffset) {
  const nameBuffer = Buffer.from(name, 'utf8')
  const entry = Buffer.alloc(46)
  entry.writeUInt32LE(CENTRAL_SIGNATURE, 0)
  entry.writeUInt16LE(20, 4) // version made by
  entry.writeUInt16LE(20, 6) // version needed
  entry.writeUInt16LE(0x0800, 8) // UTF-8 names
  entry.writeUInt16LE(8, 10) // method
  entry.writeUInt32LE(dosDateTime(), 12)
  entry.writeUInt32LE(crc, 16)
  entry.writeUInt32LE(compressed.length, 20)
  entry.writeUInt32LE(data.length, 24)
  entry.writeUInt16LE(nameBuffer.length, 28)
  entry.writeUInt16LE(0, 30) // extra
  entry.writeUInt16LE(0, 32) // comment
  entry.writeUInt16LE(0, 34) // disk number
  entry.writeUInt16LE(0, 36) // internal attrs
  entry.writeUInt32LE(0, 38) // external attrs
  entry.writeUInt32LE(localOffset, 42)
  return Buffer.concat([entry, nameBuffer])
}

/** Build a ZIP archive (deflate, UTF-8 names) from a { name: Buffer | string } map. */
export function writeZip(files, { level = 6 } = {}) {
  const names = Object.keys(files).sort()
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const name of names) {
    const data = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(String(files[name]), 'utf8')
    const compressed = deflateRawSync(data, { level })
    const crc = crc32(data)
    const local = localHeader(name, data, compressed, crc)
    localParts.push(local)
    centralParts.push(centralEntry(name, data, compressed, crc, offset))
    offset += local.length
  }
  const central = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(names.length, 8)
  eocd.writeUInt16LE(names.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, central, eocd])
}
