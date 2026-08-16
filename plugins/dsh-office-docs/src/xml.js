/**
 * Minimal XML utilities for @local/dsh-office-docs: attribute-safe escaping
 * for the writers and a small, strict-enough element-tree parser for the
 * readers. Namespace prefixes are normalized away (tag/attribute local names
 * only). Zero runtime dependencies.
 */

/** Escape text for XML element/attribute content. */
export function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function decodeEntities(text) {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body === 'amp') return '&'
    if (body === 'lt') return '<'
    if (body === 'gt') return '>'
    if (body === 'quot') return '"'
    if (body === 'apos') return "'"
    if (body.startsWith('#x')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return match
  })
}

const NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/

function localName(name) {
  const index = name.indexOf(':')
  return index === -1 ? name : name.slice(index + 1)
}

/** One parsed element. `attrs` is a Map of local attribute name → decoded value. */
export class XmlElement {
  constructor(tag, attrs = new Map(), children = [], text = '') {
    this.tag = tag
    this.attrs = attrs
    this.children = children
    this.text = text
  }

  /** Child elements with the given local tag name. */
  childrenBy(tag) {
    return this.children.filter((child) => child.tag === tag)
  }

  /** All descendant elements with the given local tag name, depth-first. */
  descendants(tag) {
    const result = []
    const visit = (element) => {
      for (const child of element.children) {
        if (child.tag === tag) result.push(child)
        visit(child)
      }
    }
    visit(this)
    return result
  }

  /** Recursive text content of this element (all descendant text concatenated). */
  textContent() {
    const parts = []
    const visit = (element) => {
      if (element.text) parts.push(element.text)
      for (const child of element.children) visit(child)
    }
    visit(this)
    return parts.join('')
  }
}

class Parser {
  constructor(source, { maxNodes = 200000 } = {}) {
    this.source = source
    this.index = 0
    this.length = source.length
    this.nodes = 0
    this.maxNodes = maxNodes
  }

  error(message) {
    const error = new Error(`XML parse error at ${this.index}: ${message}`)
    error.name = 'XmlParseError'
    throw error
  }

  skipMisc() {
    for (;;) {
      while (this.index < this.length && /\s/.test(this.source[this.index])) this.index += 1
      if (this.source.startsWith('<!--', this.index)) {
        const end = this.source.indexOf('-->', this.index + 4)
        if (end === -1) this.error('unterminated comment')
        this.index = end + 3
        continue
      }
      if (this.source.startsWith('<?', this.index)) {
        const end = this.source.indexOf('?>', this.index + 2)
        if (end === -1) this.error('unterminated processing instruction')
        this.index = end + 2
        continue
      }
      if (this.source.startsWith('<!DOCTYPE', this.index)) {
        const end = this.source.indexOf('>', this.index + 9)
        if (end === -1) this.error('unterminated DOCTYPE')
        this.index = end + 1
        continue
      }
      return
    }
  }

  parseDocument() {
    this.skipMisc()
    const root = this.parseElement()
    this.skipMisc()
    return root
  }

  parseElement() {
    if (this.nodes++ > this.maxNodes) this.error('node limit exceeded')
    if (this.source[this.index] !== '<') this.error('expected element')
    this.index += 1

    const nameMatch = NAME.exec(this.source.slice(this.index))
    if (!nameMatch) this.error('invalid tag name')
    const tag = localName(nameMatch[0])
    this.index += nameMatch[0].length

    const attrs = new Map()
    for (;;) {
      this.skipWhitespace()
      if (this.source[this.index] === '>' || this.source[this.index] === '/') break
      const attrMatch = NAME.exec(this.source.slice(this.index))
      if (!attrMatch) this.error('invalid attribute')
      const attrName = localName(attrMatch[0])
      this.index += attrMatch[0].length
      this.skipWhitespace()
      if (this.source[this.index] !== '=') this.error(`attribute ${attrName} missing '='`)
      this.index += 1
      this.skipWhitespace()
      const quote = this.source[this.index]
      if (quote !== '"' && quote !== "'") this.error('attribute value must be quoted')
      const end = this.source.indexOf(quote, this.index + 1)
      if (end === -1) this.error('unterminated attribute value')
      attrs.set(attrName, decodeEntities(this.source.slice(this.index + 1, end)))
      this.index = end + 1
    }

    if (this.source[this.index] === '/') {
      this.index += 1
      if (this.source[this.index] !== '>') this.error('expected > after /')
      this.index += 1
      return new XmlElement(tag, attrs)
    }
    if (this.source[this.index] === '>') {
      this.index += 1
    } else {
      this.error('expected >')
    }

    const children = []
    let text = ''
    for (;;) {
      const next = this.source.indexOf('<', this.index)
      if (next === -1) this.error('unclosed element')
      if (next > this.index) {
        const chunk = this.source.slice(this.index, next)
        if (chunk) text += chunk
        this.index = next
      }
      if (this.source.startsWith('</', this.index)) {
        const closeMatch = /^<\/\s*([A-Za-z_][A-Za-z0-9_.:-]*)\s*>/.exec(this.source.slice(this.index))
        if (!closeMatch) this.error('invalid close tag')
        if (localName(closeMatch[1]) !== tag) this.error(`mismatched close tag </${closeMatch[1]}> for <${tag}>`)
        this.index += closeMatch[0].length
        return new XmlElement(tag, attrs, children, decodeEntities(text))
      }
      if (this.source.startsWith('<!--', this.index)) {
        const commentEnd = this.source.indexOf('-->', this.index + 4)
        if (commentEnd === -1) this.error('unterminated comment')
        this.index = commentEnd + 3
        continue
      }
      if (this.source.startsWith('<![CDATA[', this.index)) {
        const cdataEnd = this.source.indexOf(']]>', this.index + 9)
        if (cdataEnd === -1) this.error('unterminated CDATA')
        text += this.source.slice(this.index + 9, cdataEnd)
        this.index = cdataEnd + 3
        continue
      }
      if (this.source.startsWith('<?', this.index)) {
        const piEnd = this.source.indexOf('?>', this.index + 2)
        if (piEnd === -1) this.error('unterminated processing instruction')
        this.index = piEnd + 2
        continue
      }
      const child = this.parseElement()
      if (child) children.push(child)
    }
  }

  skipWhitespace() {
    while (this.index < this.length && /\s/.test(this.source[this.index])) this.index += 1
  }
}

/** Parse an XML string into a root {@link XmlElement}. */
export function parseXml(source, options) {
  if (typeof source !== 'string') throw new Error('parseXml expects a string.')
  return new Parser(source, options).parseDocument()
}

/** Pretty-print a parsed element tree (diagnostics only). */
export function debugXml(element, depth = 0) {
  const pad = '  '.repeat(depth)
  const attrs = [...element.attrs.entries()].map(([key, value]) => ` ${key}="${value}"`).join('')
  const lines = [`${pad}<${element.tag}${attrs}>`]
  if (element.text) lines.push(`${pad}  text: ${JSON.stringify(element.text.slice(0, 80))}`)
  for (const child of element.children) lines.push(debugXml(child, depth + 1))
  lines.push(`${pad}</${element.tag}>`)
  return lines.join('\n')
}
