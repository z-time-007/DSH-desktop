/**
 * DOCX reader for @local/dsh-office-docs: extracts paragraphs (with their
 * heading/title style), tables, and a bounded plain-text projection from
 * word/document.xml. Read-only; no external relationships are followed.
 */

import { validateOfficeBuffer } from './office-validator.js'
import { parseXml } from './xml.js'
import { PolicyError } from './security.js'

const DEFAULT_MAX_CHARS = 200000

function isHeadingStyle(style) {
  if (!style) return false
  const value = style.toLowerCase()
  return value === 'title' || value.startsWith('heading')
}

function paragraphText(paragraphElement) {
  let text = ''
  const append = (element) => {
    if (element.tag === 't') {
      text += element.textContent()
      return
    }
    if (element.tag === 'tab') {
      text += '\t'
      return
    }
    if (element.tag === 'br' || element.tag === 'cr') {
      text += '\n'
      return
    }
    for (const child of element.children) append(child)
  }
  for (const child of paragraphElement.children) append(child)
  return text
}

function paragraphStyle(paragraphElement) {
  const pPr = paragraphElement.childrenBy('pPr')[0]
  if (!pPr) return null
  const pStyle = pPr.childrenBy('pStyle')[0]
  return pStyle ? pStyle.attrs.get('val') ?? null : null
}

function tableRows(tableElement) {
  const rows = []
  for (const tr of tableElement.childrenBy('tr')) {
    const row = []
    for (const tc of tr.childrenBy('tc')) {
      const cellParagraphs = tc.childrenBy('p').map(paragraphText).filter((value) => value.trim() !== '')
      row.push(cellParagraphs.join('\n').trim())
    }
    rows.push(row)
  }
  return rows
}

export function readDocx(buffer, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const { entries } = validateOfficeBuffer(buffer, '.docx')
  const documentXml = entries.get('word/document.xml').toString('utf8')
  const root = parseXml(documentXml)
  const body = root.childrenBy('body')[0]
  if (!body) throw new PolicyError('OFFICE_STRUCTURE_MISSING', 'word/document.xml has no body.')

  const paragraphs = []
  const tables = []
  let title = null
  let characters = 0

  for (const child of body.children) {
    if (child.tag === 'p') {
      const text = paragraphText(child).trim()
      if (!text) continue
      const style = paragraphStyle(child)
      characters += text.length
      if (title === null && isHeadingStyle(style)) {
        title = text
        continue // the title is reported separately, not re-listed as a paragraph
      }
      paragraphs.push({ index: paragraphs.length, style, text })
    } else if (child.tag === 'tbl') {
      const rows = tableRows(child)
      if (rows.length === 0) continue
      for (const row of rows) characters += row.join(' ').length
      tables.push(rows)
    }
  }

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
  for (const paragraph of paragraphs) writer(paragraph.text + '\n')
  for (const rows of tables) {
    for (const row of rows) writer(row.join('\t') + '\n')
  }

  return {
    format: 'docx',
    title,
    paragraphs,
    tables,
    plainText,
    truncated,
    stats: { paragraphs: paragraphs.length, tables: tables.length, characters },
  }
}
