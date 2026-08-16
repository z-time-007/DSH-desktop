/**
 * PPTX reader for @local/dsh-office-docs: walks the presentation's slide list
 * (in presentation order) and extracts per-shape text (titles, body, tables).
 * Read-only; only the main slide parts are touched.
 */

import { validateOfficeBuffer } from './office-validator.js'
import { parseXml } from './xml.js'
import { PolicyError } from './security.js'

const DEFAULT_MAX_CHARS = 200000

function relationshipTargets(relsXml) {
  const root = parseXml(relsXml)
  const targets = new Map()
  for (const rel of root.childrenBy('Relationship')) {
    const id = rel.attrs.get('Id')
    const target = rel.attrs.get('Target')
    if (id && target) targets.set(id, target)
  }
  return targets
}

function slideOrder(presentationXml, rels) {
  const root = parseXml(presentationXml)
  const order = []
  const sldIdLst = root.childrenBy('sldIdLst')[0]
  if (sldIdLst) {
    for (const sldId of sldIdLst.childrenBy('sldId')) {
      const rid = sldId.attrs.get('id')
      if (rid && rels.has(rid)) order.push(rels.get(rid))
    }
  }
  // Fallback: enumerate slideN.xml numerically.
  if (order.length === 0) {
    const entries = [...rels.values()].filter((target) => /^slides\/slide\d+\.xml$/i.test(target))
    entries.sort((a, b) => Number.parseInt(a.match(/\d+/)[0], 10) - Number.parseInt(b.match(/\d+/)[0], 10))
    order.push(...entries)
  }
  return order
}

function shapeText(spTree) {
  const blocks = []
  for (const shape of spTree.children) {
    if (shape.tag !== 'sp' && shape.tag !== 'graphicFrame' && shape.tag !== 'grpSp') continue
    const texts = shape.descendants('t').map((element) => element.textContent()).filter((value) => value.trim() !== '')
    if (texts.length > 0) blocks.push(texts.join('\n'))
  }
  return blocks
}

export function readPptx(buffer, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const { entries } = validateOfficeBuffer(buffer, '.pptx')
  const rels = relationshipTargets(entries.get('ppt/_rels/presentation.xml.rels').toString('utf8'))
  const order = slideOrder(entries.get('ppt/presentation.xml').toString('utf8'), rels)

  const slides = []
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

  for (const slideTarget of order) {
    const slideXml = entries.get(`ppt/${slideTarget}`)
    if (!slideXml) continue
    const root = parseXml(slideXml.toString('utf8'))
    const spTree = root.descendants('spTree')[0]
    const blocks = spTree ? shapeText(spTree) : []
    const text = blocks.join('\n')
    characters += text.length
    slides.push({ index: slides.length, blocks, text })
    writer(`--- 幻灯片 ${slides.length} ---\n${text ? text + '\n' : ''}`)
  }

  if (slides.length === 0) {
    throw new PolicyError('OFFICE_STRUCTURE_MISSING', 'PPTX contains no readable slides.')
  }

  return {
    format: 'pptx',
    slides,
    plainText,
    truncated,
    stats: { slides: slides.length, characters },
  }
}
