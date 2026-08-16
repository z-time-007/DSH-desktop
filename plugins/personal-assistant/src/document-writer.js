import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { PolicyError, assertNoSymlinkSegments, resolveInside, safeOutputName, throwIfAborted } from './security.js'
import { validateOfficeBuffer } from './office-validator.js'
import { createTextOnlyPptx } from './pptx-ooxml.js'
import { createFormulaFreeXlsx } from './xlsx-ooxml.js'
import { prepareSlideImages } from './image-inbox.js'

const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_PARAGRAPHS = 500
const MAX_TABLE_CELLS = 10000
const MAX_SLIDES = 100
const MAX_SHEET_ROWS = 10000
const MAX_SHEET_CELLS = 100000

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

async function outputTarget(workspaceRoot, filename, extension) {
  const safeName = safeOutputName(filename, extension)
  const outputDirectory = resolveInside(workspaceRoot, 'outputs', { allowRoot: false })
  await assertNoSymlinkSegments(outputDirectory.root, outputDirectory.target, { allowMissing: true })
  await mkdir(outputDirectory.target, { recursive: true })
  await assertNoSymlinkSegments(outputDirectory.root, outputDirectory.target, { allowMissing: false })
  return {
    target: path.join(outputDirectory.target, safeName),
    relative: `outputs/${safeName}`,
  }
}

async function writeNewFile(target, data, signal) {
  throwIfAborted(signal)
  await writeFile(target, data, { flag: 'wx' })
  const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data), 'utf8')
  return bytes
}

export async function createTextDocument({ workspaceRoot, filename, content, format, signal }) {
  if (!['txt', 'md'].includes(format)) throw new PolicyError('INVALID_FORMAT', 'format must be txt or md.')
  const safeContent = requireText(content, 'content')
  const output = await outputTarget(workspaceRoot, filename, `.${format}`)
  const bytes = await writeNewFile(output.target, safeContent, signal)
  return { path: output.relative, format, bytes }
}

export async function createDocxDocument({ workspaceRoot, filename, title, paragraphs = [], table = [], signal }) {
  const safeTitle = optionalText(title, 'title', 8192)
  const safeParagraphs = requireStringArray(paragraphs, 'paragraphs', MAX_PARAGRAPHS)
  if (!Array.isArray(table)) throw new PolicyError('INVALID_TABLE', 'table must be an array of rows.')
  let tableCells = 0
  const safeTable = table.map((row, rowIndex) => {
    if (!Array.isArray(row)) throw new PolicyError('INVALID_TABLE', `table[${rowIndex}] must be an array.`)
    tableCells += row.length
    if (tableCells > MAX_TABLE_CELLS) throw new PolicyError('TABLE_TOO_LARGE', 'table exceeds the cell limit.')
    return row.map((cell, cellIndex) => optionalText(String(cell ?? ''), `table[${rowIndex}][${cellIndex}]`, 65535))
  })
  if (!safeTitle && safeParagraphs.length === 0 && safeTable.length === 0) {
    throw new PolicyError('EMPTY_DOCUMENT', 'DOCX requires a title, paragraph, or table.')
  }
  const children = []
  if (safeTitle) children.push(new Paragraph({ text: safeTitle, heading: HeadingLevel.TITLE }))
  for (const paragraph of safeParagraphs) {
    children.push(new Paragraph({ children: [new TextRun({ text: paragraph })] }))
  }
  if (safeTable.length > 0) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: safeTable.map((row) => new TableRow({
        children: row.map((cell) => new TableCell({ children: [new Paragraph(cell)] })),
      })),
    }))
  }
  const document = new Document({ sections: [{ properties: {}, children }] })
  throwIfAborted(signal)
  const buffer = await Packer.toBuffer(document)
  validateOfficeBuffer(buffer, '.docx')
  const output = await outputTarget(workspaceRoot, filename, '.docx')
  const bytes = await writeNewFile(output.target, buffer, signal)
  return { path: output.relative, format: 'docx', bytes, paragraphs: safeParagraphs.length, tableCells }
}

export async function createPptxDocument({ workspaceRoot, filename, title, slides, signal }) {
  const safeTitle = optionalText(title, 'title', 8192)
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new PolicyError('INVALID_SLIDES', 'slides must be a non-empty array.')
  }
  if (slides.length > MAX_SLIDES) throw new PolicyError('TOO_MANY_SLIDES', `slides exceeds the ${MAX_SLIDES}-slide limit.`)
  const safeSlides = slides.map((slide, index) => {
    if (!slide || typeof slide !== 'object' || Array.isArray(slide)) {
      throw new PolicyError('INVALID_SLIDE', `slides[${index}] must be an object.`)
    }
    return {
      title: requireText(slide.title, `slides[${index}].title`, 8192),
      bullets: requireStringArray(slide.bullets ?? [], `slides[${index}].bullets`, 50),
      images: slide.images ?? [],
    }
  })
  throwIfAborted(signal)
  const imageCount = await prepareSlideImages({ workspaceRoot, slides: safeSlides, signal })
  const buffer = createTextOnlyPptx({ title: safeTitle, slides: safeSlides })
  validateOfficeBuffer(buffer, '.pptx')
  const output = await outputTarget(workspaceRoot, filename, '.pptx')
  const bytes = await writeNewFile(output.target, buffer, signal)
  return { path: output.relative, format: 'pptx', bytes, slides: safeSlides.length, images: imageCount }
}

function safeSheetName(value) {
  const name = optionalText(value, 'sheetName', 256) || 'Sheet1'
  if (name.length > 31 || /[\\/?*\[\]:]/.test(name)) {
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

export async function createXlsxDocument({ workspaceRoot, filename, sheetName, columns, rows, signal }) {
  const safeColumns = requireStringArray(columns, 'columns', 1000)
  if (safeColumns.length === 0) throw new PolicyError('INVALID_COLUMNS', 'columns must not be empty.')
  if (!Array.isArray(rows)) throw new PolicyError('INVALID_ROWS', 'rows must be an array.')
  if (rows.length > MAX_SHEET_ROWS) throw new PolicyError('TOO_MANY_ROWS', `rows exceeds the ${MAX_SHEET_ROWS}-row limit.`)
  if (rows.length * safeColumns.length > MAX_SHEET_CELLS) {
    throw new PolicyError('SHEET_TOO_LARGE', `sheet exceeds the ${MAX_SHEET_CELLS}-cell limit.`)
  }
  const safeRows = rows.map((row, rowIndex) => {
    if (!Array.isArray(row)) throw new PolicyError('INVALID_ROW', `rows[${rowIndex}] must be an array.`)
    if (row.length > safeColumns.length) throw new PolicyError('ROW_TOO_WIDE', `rows[${rowIndex}] has more cells than columns.`)
    return row.map(safeCellValue)
  })
  throwIfAborted(signal)
  const buffer = createFormulaFreeXlsx({ sheetName: safeSheetName(sheetName), columns: safeColumns, rows: safeRows })
  validateOfficeBuffer(buffer, '.xlsx')
  const output = await outputTarget(workspaceRoot, filename, '.xlsx')
  const bytes = await writeNewFile(output.target, buffer, signal)
  return { path: output.relative, format: 'xlsx', bytes, rows: safeRows.length, columns: safeColumns.length }
}
