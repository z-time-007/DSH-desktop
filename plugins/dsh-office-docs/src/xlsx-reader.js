/**
 * XLSX reader for @local/dsh-office-docs: extracts every sheet's cell values
 * (shared strings, inline strings, numbers, booleans; date-formatted numbers
 * rendered as dates). Formulas are rejected upstream by the validator, so
 * cells carry only computed/plain values. Read-only.
 */

import { validateOfficeBuffer } from './office-validator.js'
import { parseXml } from './xml.js'
import { PolicyError } from './security.js'

const DEFAULT_MAX_CHARS = 200000
const MAX_ROWS = 20000
const MAX_CELLS = 400000

const DATE_NUMFMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

function sharedStrings(xml) {
  const root = parseXml(xml)
  return root.childrenBy('si').map((si) => si.descendants('t').map((element) => element.textContent()).join(''))
}

function parseStyles(xml) {
  const root = parseXml(xml)
  const customDateFormats = new Set()
  const numFmts = root.childrenBy('numFmts')[0]
  if (numFmts) {
    for (const numFmt of numFmts.childrenBy('numFmt')) {
      const code = numFmt.attrs.get('formatCode') ?? ''
      if (/[ymdhis]/i.test(code) && !/[b#]/.test(code) && !/^\[h+\]/i.test(code)) {
        customDateFormats.add(numFmt.attrs.get('numFmtId'))
      }
    }
  }
  const cellXfs = root.childrenBy('cellXfs')[0]
  const xfs = cellXfs ? cellXfs.childrenBy('xf') : []
  return xfs.map((xf) => {
    const numFmtId = xf.attrs.get('numFmtId') ?? '0'
    return DATE_NUMFMT_IDS.has(Number(numFmtId)) || customDateFormats.has(numFmtId)
  })
}

function excelSerialToDate(serial) {
  const millisecondsPerDay = 86400000
  const epoch = Date.UTC(1899, 11, 30)
  const date = new Date(epoch + serial * millisecondsPerDay)
  if (Number.isNaN(date.getTime())) return null
  const hasTime = Math.abs(serial % 1) > 1e-9
  const iso = date.toISOString()
  return hasTime ? iso.replace('T', ' ').slice(0, 19) : iso.slice(0, 10)
}

function cellValue(cellElement, strings, isDate) {
  const type = cellElement.attrs.get('t')
  if (type === 'inlineStr') {
    const is = cellElement.childrenBy('is')[0]
    return is ? is.descendants('t').map((element) => element.textContent()).join('') : ''
  }
  const v = cellElement.childrenBy('v')[0]
  if (!v) return null
  const raw = v.textContent().trim()
  if (type === 's') {
    const index = Number.parseInt(raw, 10)
    return strings[index] ?? null
  }
  if (type === 'b') return raw === '1'
  if (type === 'str') return raw
  if (type === 'e') return raw // error literal, passive
  // numeric (t === 'n' or absent)
  const number = Number(raw)
  if (!Number.isFinite(number)) return raw
  return isDate ? excelSerialToDate(number) ?? number : number
}

function readWorksheet(xml, strings, isDateByXf) {
  const root = parseXml(xml)
  const sheetData = root.childrenBy('sheetData')[0]
  if (!sheetData) return []
  const rows = []
  let cells = 0
  for (const row of sheetData.childrenBy('row')) {
    if (rows.length >= MAX_ROWS) break
    const values = []
    for (const c of row.childrenBy('c')) {
      if (++cells > MAX_CELLS) throw new PolicyError('SHEET_TOO_LARGE', 'Worksheet exceeds the cell limit.')
      const styleIndex = c.attrs.get('s')
      const isDate = styleIndex != null ? Boolean(isDateByXf[Number(styleIndex)]) : false
      values.push(cellValue(c, strings, isDate))
    }
    rows.push(values)
  }
  return rows
}

export function readXlsx(buffer, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const { entries } = validateOfficeBuffer(buffer, '.xlsx')

  const workbook = parseXml(entries.get('xl/workbook.xml').toString('utf8'))
  const sheetDefs = workbook.childrenBy('sheets')[0]?.childrenBy('sheet') ?? []
  const relsRoot = parseXml(entries.get('xl/_rels/workbook.xml.rels').toString('utf8'))
  const targetById = new Map()
  for (const rel of relsRoot.childrenBy('Relationship')) {
    const id = rel.attrs.get('Id')
    const target = rel.attrs.get('Target')
    if (id && target) targetById.set(id, target)
  }

  const strings = entries.has('xl/sharedStrings.xml')
    ? sharedStrings(entries.get('xl/sharedStrings.xml').toString('utf8'))
    : []
  const isDateByXf = entries.has('xl/styles.xml')
    ? parseStyles(entries.get('xl/styles.xml').toString('utf8'))
    : []

  const sheets = []
  let characters = 0
  let plainText = ''
  let truncated = false
  const writer = (chunk) => {
    if (truncated) return
    if (plainText.length + chunk.length > maxChars) {
      plainText += chunk.slice(0, Math.max(0, maxChars - plainText.length))
      truncated = true
      return
    }
    plainText += chunk
  }

  for (const sheet of sheetDefs) {
    const name = sheet.attrs.get('name') ?? `Sheet${sheets.length + 1}`
    const rid = sheet.attrs.get('id')
    const target = targetById.get(rid)
    const partPath = target && target.startsWith('/') ? target.slice(1) : `xl/${target ?? 'worksheets/sheet1.xml'}`
    const xml = entries.get(partPath) ?? entries.get(`xl/${target}`)
    if (!xml) continue
    const rows = readWorksheet(xml.toString('utf8'), strings, isDateByXf)
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
    for (const row of rows) characters += row.map((cell) => String(cell ?? '')).join(' ').length
    sheets.push({ name, rows, columns: columnCount, rowCount: rows.length })
    writer(`--- 工作表: ${name} ---\n`)
    for (const row of rows) writer(row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))).join('\t') + '\n')
  }

  if (sheets.length === 0) {
    throw new PolicyError('OFFICE_STRUCTURE_MISSING', 'XLSX contains no readable worksheets.')
  }

  return {
    format: 'xlsx',
    sheets,
    plainText,
    truncated,
    stats: { sheets: sheets.length, characters },
  }
}
