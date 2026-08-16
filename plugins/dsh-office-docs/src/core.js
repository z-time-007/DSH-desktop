/**
 * Core orchestration for @local/dsh-office-docs: path-policy enforcement,
 * audit, document reading (docx/pptx/xlsx + plain text) and creation
 * (txt/md/docx/pptx/xlsx), plus the upload sink. Every filesystem touch is
 * confined to the fixed workspace root and refuses to follow symlinks.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AuditLog, runAudited } from './audit.js'
import {
  assertNoSymlinkSegments,
  assertRootIdentity,
  ensureSafeDirectory,
  PolicyError,
  resolveInside,
  safeStoredName,
  throwIfAborted,
} from './security.js'
import { readDocx } from './docx-reader.js'
import { readPptx } from './pptx-reader.js'
import { readXlsx } from './xlsx-reader.js'
import { validateOfficeBuffer } from './office-validator.js'
import { createDocx } from './docx-ooxml.js'
import { createPptx } from './pptx-ooxml.js'
import { createXlsx } from './xlsx-ooxml.js'

const DEFAULT_MAX_CHARS = 200000
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_PARAGRAPHS = 500
const MAX_TABLE_CELLS = 10000
const MAX_SLIDES = 100
const MAX_SHEET_ROWS = 10000
const MAX_SHEET_CELLS = 100000

const READABLE_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv'])
const UPLOAD_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx', '.doc', '.ppt', '.xls', '.txt', '.md', '.csv', '.pdf'])

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

function requireStringArray(value, field, maxItems) {
  if (!Array.isArray(value)) throw new PolicyError('INVALID_ARRAY', `${field} must be an array.`)
  if (value.length > maxItems) throw new PolicyError('TOO_MANY_ITEMS', `${field} exceeds the ${maxItems}-item limit.`)
  return value.map((item, index) => requireText(item, `${field}[${index}]`, 65535))
}

function safeSheetName(value) {
  const name = optionalText(value, 'sheetName', 256) || 'Sheet1'
  if (name.length > 31 || /[\\/?*[\]:]/.test(name)) {
    throw new PolicyError('INVALID_SHEET_NAME', 'sheetName must be at most 31 characters and contain no \\ / ? * [ ] :.')
  }
  return name
}

function safeCellValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PolicyError('INVALID_CELL', 'Spreadsheet numbers must be finite.')
    return value
  }
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') throw new PolicyError('INVALID_CELL', 'Spreadsheet cells accept only string, number, boolean, or null.')
  if (value.length > 32767) throw new PolicyError('CELL_TOO_LARGE', 'Spreadsheet text exceeds the Excel cell limit.')
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

export async function createOfficeCore(config) {
  const {
    workspaceRoot,
    uploadsDir = 'uploads',
    outputsDir = 'outputs',
    maxUploadBytes = 25 * 1024 * 1024,
    auditPath = '.assistant/office-docs/audit/events.jsonl',
  } = config

  const root = await assertRootIdentity(workspaceRoot)
  const audit = await new AuditLog(root, auditPath).init()

  async function readInside(relativePath, { allowRoot = false } = {}) {
    const resolved = resolveInside(root, relativePath, { allowRoot })
    await assertNoSymlinkSegments(resolved.root, path.dirname(resolved.target), { allowMissing: false })
    const buffer = await readFile(resolved.target)
    return { resolved, buffer }
  }

  async function outputTarget(filename, extension) {
    const safeName = safeStoredName(filename, extension)
    const outputDirectory = await ensureSafeDirectory(root, outputsDir)
    return {
      target: path.join(outputDirectory.target, safeName),
      relative: `${outputsDir}/${safeName}`,
    }
  }

  async function writeNewFile(target, data, signal) {
    throwIfAborted(signal)
    await writeFile(target, data, { flag: 'wx' })
    return Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data), 'utf8')
  }

  return {
    root,
    uploadsDir,
    outputsDir,

    async readOffice(args = {}) {
      const relativePath = requireText(args.path, 'path', 4096)
      const maxChars = Number.isFinite(Number(args.maxChars)) ? Math.max(1, Math.min(1000000, Number(args.maxChars))) : DEFAULT_MAX_CHARS
      return runAudited(audit, { capability: 'office-docs', action: 'read', targets: [relativePath] }, async () => {
        const { resolved, buffer } = await readInside(relativePath)
        const extension = path.extname(resolved.target).toLowerCase()
        if (!READABLE_EXTENSIONS.has(extension)) {
          throw new PolicyError('UNSUPPORTED_FORMAT', `Cannot read ${extension || '(no extension)'}; supported: docx, pptx, xlsx, txt, md, csv.`)
        }
        let result
        if (extension === '.docx') result = readDocx(buffer, { maxChars })
        else if (extension === '.pptx') result = readPptx(buffer, { maxChars })
        else if (extension === '.xlsx') result = readXlsx(buffer, { maxChars })
        else {
          const text = buffer.toString('utf8')
          result = { format: extension.slice(1), text, plainText: text.slice(0, maxChars), truncated: text.length > maxChars }
        }
        return { path: relativePath, ...result }
      })
    },

    async createTextDocument(args = {}) {
      const format = args.format
      if (!['txt', 'md'].includes(format)) throw new PolicyError('INVALID_FORMAT', 'format must be txt or md.')
      const safeContent = requireText(args.content, 'content')
      return runAudited(audit, { capability: 'office-docs', action: 'create', targets: [`${outputsDir}/${args.filename ?? ''}`] }, async () => {
        const output = await outputTarget(args.filename, `.${format}`)
        const bytes = await writeNewFile(output.target, safeContent, args.signal)
        return { path: output.relative, format, bytes }
      })
    },

    async createDocxDocument(args = {}) {
      const title = optionalText(args.title, 'title', 8192)
      const paragraphs = requireStringArray(args.paragraphs ?? [], 'paragraphs', MAX_PARAGRAPHS)
      let tableCells = 0
      const table = Array.isArray(args.table) ? args.table.map((row, rowIndex) => {
        if (!Array.isArray(row)) throw new PolicyError('INVALID_TABLE', `table[${rowIndex}] must be an array.`)
        tableCells += row.length
        if (tableCells > MAX_TABLE_CELLS) throw new PolicyError('TABLE_TOO_LARGE', 'table exceeds the cell limit.')
        return row.map((cell, cellIndex) => optionalText(String(cell ?? ''), `table[${rowIndex}][${cellIndex}]`, 65535))
      }) : []
      if (!title && paragraphs.length === 0 && table.length === 0) {
        throw new PolicyError('EMPTY_DOCUMENT', 'DOCX requires a title, paragraph, or table.')
      }
      return runAudited(audit, { capability: 'office-docs', action: 'create', targets: [`${outputsDir}/${args.filename ?? ''}`] }, async () => {
        const buffer = createDocx({ title, paragraphs, table })
        validateOfficeBuffer(buffer, '.docx')
        const output = await outputTarget(args.filename, '.docx')
        const bytes = await writeNewFile(output.target, buffer, args.signal)
        return { path: output.relative, format: 'docx', bytes, paragraphs: paragraphs.length, tableCells }
      })
    },

    async createPptxDocument(args = {}) {
      const title = optionalText(args.title, 'title', 8192)
      if (!Array.isArray(args.slides) || args.slides.length === 0) {
        throw new PolicyError('INVALID_SLIDES', 'slides must be a non-empty array.')
      }
      if (args.slides.length > MAX_SLIDES) throw new PolicyError('TOO_MANY_SLIDES', `slides exceeds the ${MAX_SLIDES}-slide limit.`)
      const slides = args.slides.map((slide, index) => {
        if (!slide || typeof slide !== 'object' || Array.isArray(slide)) {
          throw new PolicyError('INVALID_SLIDE', `slides[${index}] must be an object.`)
        }
        return {
          title: requireText(slide.title, `slides[${index}].title`, 8192),
          bullets: requireStringArray(slide.bullets ?? [], `slides[${index}].bullets`, 50),
        }
      })
      return runAudited(audit, { capability: 'office-docs', action: 'create', targets: [`${outputsDir}/${args.filename ?? ''}`] }, async () => {
        const buffer = createPptx({ title, slides })
        validateOfficeBuffer(buffer, '.pptx')
        const output = await outputTarget(args.filename, '.pptx')
        const bytes = await writeNewFile(output.target, buffer, args.signal)
        return { path: output.relative, format: 'pptx', bytes, slides: slides.length }
      })
    },

    async createXlsxDocument(args = {}) {
      const columns = requireStringArray(args.columns, 'columns', 1000)
      if (columns.length === 0) throw new PolicyError('INVALID_COLUMNS', 'columns must not be empty.')
      if (!Array.isArray(args.rows)) throw new PolicyError('INVALID_ROWS', 'rows must be an array.')
      if (args.rows.length > MAX_SHEET_ROWS) throw new PolicyError('TOO_MANY_ROWS', `rows exceeds the ${MAX_SHEET_ROWS}-row limit.`)
      if (args.rows.length * columns.length > MAX_SHEET_CELLS) {
        throw new PolicyError('SHEET_TOO_LARGE', `sheet exceeds the ${MAX_SHEET_CELLS}-cell limit.`)
      }
      const rows = args.rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) throw new PolicyError('INVALID_ROW', `rows[${rowIndex}] must be an array.`)
        if (row.length > columns.length) throw new PolicyError('ROW_TOO_WIDE', `rows[${rowIndex}] has more cells than columns.`)
        return row.map(safeCellValue)
      })
      return runAudited(audit, { capability: 'office-docs', action: 'create', targets: [`${outputsDir}/${args.filename ?? ''}`] }, async () => {
        const buffer = createXlsx({ sheetName: safeSheetName(args.sheetName), columns, rows })
        validateOfficeBuffer(buffer, '.xlsx')
        const output = await outputTarget(args.filename, '.xlsx')
        const bytes = await writeNewFile(output.target, buffer, args.signal)
        return { path: output.relative, format: 'xlsx', bytes, rows: rows.length, columns: columns.length }
      })
    },

    async saveUpload(buffer, originalName, signal) {
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new PolicyError('EMPTY_UPLOAD', 'Uploaded file is empty.')
      }
      if (buffer.length > maxUploadBytes) {
        throw new PolicyError('UPLOAD_TOO_LARGE', `Upload exceeds the ${maxUploadBytes}-byte limit.`)
      }
      const baseName = path.basename(String(originalName || 'upload').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'upload')
      const safeName = safeStoredName(baseName)
      const extension = path.extname(safeName).toLowerCase()
      if (!UPLOAD_EXTENSIONS.has(extension)) {
        throw new PolicyError('UNSUPPORTED_UPLOAD', `Uploaded type ${extension || '(none)'} is not allowed; supported: ${[...UPLOAD_EXTENSIONS].join(', ')}.`)
      }
      return runAudited(audit, { capability: 'office-docs', action: 'upload', targets: [`${uploadsDir}/${safeName}`] }, async () => {
        const uploadDirectory = await ensureSafeDirectory(root, uploadsDir)
        let target = path.join(uploadDirectory.target, safeName)
        let finalName = safeName
        let counter = 1
        while (true) {
          throwIfAborted(signal)
          try {
            await writeFile(target, buffer, { flag: 'wx' })
            break
          } catch (error) {
            if (error?.code !== 'EEXIST') throw error
            const stem = safeName.slice(0, safeName.length - extension.length)
            finalName = `${stem}-${counter}${extension}`
            target = path.join(uploadDirectory.target, finalName)
            counter += 1
          }
        }
        return { name: finalName, relativePath: `${uploadsDir}/${finalName}`, bytes: buffer.length, extension }
      })
    },
  }
}
