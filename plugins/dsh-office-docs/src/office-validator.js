/**
 * OOXML package validation for @local/dsh-office-docs. Rejects anything that
 * is not a valid Office Open XML ZIP, and refuses macros, external
 * relationships, embeddings, and (for spreadsheets) formulas, so the reader
 * only ever sees passive document content.
 */

import { readZip } from './zip.js'
import { PolicyError } from './security.js'

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
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    throw new PolicyError('INVALID_OFFICE_FILE', 'Office file is empty or invalid.')
  }
  const entries = readZip(buffer)
  const normalizedExtension = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  requireEntries(entries, ['[Content_Types].xml', '_rels/.rels'])
  if (normalizedExtension === '.docx') requireEntries(entries, ['word/document.xml'])
  else if (normalizedExtension === '.pptx') requireEntries(entries, ['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'])
  else if (normalizedExtension === '.xlsx') requireEntries(entries, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'])
  else throw new PolicyError('INVALID_EXTENSION', 'Validator accepts DOCX, PPTX, or XLSX only.')
  assertNoUnsafeOfficeParts(entries, { rejectFormulas: normalizedExtension === '.xlsx' })
  return { format: normalizedExtension.slice(1), entryCount: entries.size, entries, valid: true }
}
