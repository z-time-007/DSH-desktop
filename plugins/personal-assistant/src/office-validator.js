import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { PolicyError } from './security.js'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

function findEocd(buffer) {
  const lowerBound = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new PolicyError('INVALID_ZIP', 'ZIP end-of-central-directory record was not found.')
}

export function inspectZipBuffer(buffer) {
  const eocd = findEocd(buffer)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
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
    if (name.includes('..') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
      throw new PolicyError('INVALID_ZIP_PATH', `Unsafe ZIP entry: ${name}`)
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
    entries.set(name, content)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function requireEntries(entries, names) {
  for (const name of names) {
    if (!entries.has(name)) throw new PolicyError('OFFICE_STRUCTURE_MISSING', `Required Office entry is missing: ${name}`)
  }
}

function assertNoUnsafeOfficeParts(entries, { rejectFormulas = false } = {}) {
  for (const [name, content] of entries) {
    const lower = name.toLowerCase()
    const isDirectoryEntry = name.endsWith('/')
    if (lower.includes('vbaproject.bin') || (!isDirectoryEntry && (lower.includes('/externallinks/') || lower.includes('/embeddings/')))) {
      throw new PolicyError('UNSAFE_OFFICE_PART', `Unsafe Office part: ${name}`)
    }
    if (/\.rels$/i.test(name)) {
      const xml = content.toString('utf8')
      if (/TargetMode\s*=\s*["']External["']/i.test(xml)) {
        throw new PolicyError('EXTERNAL_RELATIONSHIP', `External Office relationship: ${name}`)
      }
    }
    if (rejectFormulas && /^xl\/worksheets\/.*\.xml$/i.test(name) && /<f(?:\s|>)/i.test(content.toString('utf8'))) {
      throw new PolicyError('FORMULA_DENIED', `Spreadsheet formula found in ${name}.`)
    }
  }
}

export function validateOfficeBuffer(buffer, extension) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new PolicyError('INVALID_OFFICE_FILE', 'Office file is not an OOXML ZIP package.')
  }
  const entries = inspectZipBuffer(buffer)
  const normalizedExtension = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  requireEntries(entries, ['[Content_Types].xml', '_rels/.rels'])
  if (normalizedExtension === '.docx') requireEntries(entries, ['word/document.xml'])
  else if (normalizedExtension === '.pptx') requireEntries(entries, ['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'])
  else if (normalizedExtension === '.xlsx') requireEntries(entries, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'])
  else throw new PolicyError('INVALID_EXTENSION', 'Validator accepts DOCX, PPTX, or XLSX only.')
  assertNoUnsafeOfficeParts(entries, { rejectFormulas: normalizedExtension === '.xlsx' })
  return { format: normalizedExtension.slice(1), entryCount: entries.size, valid: true }
}

export async function validateOfficeFile(filePath) {
  const buffer = await readFile(filePath)
  return { path: filePath, ...validateOfficeBuffer(buffer, path.extname(filePath)) }
}
