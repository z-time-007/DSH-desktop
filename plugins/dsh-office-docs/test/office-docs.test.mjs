import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeZip, readZip } from '../src/zip.js'
import { parseXml, xmlEscape } from '../src/xml.js'
import { validateOfficeBuffer } from '../src/office-validator.js'
import { createDocx } from '../src/docx-ooxml.js'
import { createPptx } from '../src/pptx-ooxml.js'
import { createXlsx } from '../src/xlsx-ooxml.js'
import { readDocx } from '../src/docx-reader.js'
import { readPptx } from '../src/pptx-reader.js'
import { readXlsx } from '../src/xlsx-reader.js'
import { createOfficeCore } from '../src/core.js'
import { PolicyError, resolveInside } from '../src/security.js'

async function temporaryWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'dsh-office-test-'))
}

test('zip writer round-trips through the reader', () => {
  const buffer = writeZip({
    'word/document.xml': '<w:document><w:t>你好，世界</w:t></w:document>',
    'empty.txt': '',
  })
  const entries = readZip(buffer)
  assert.equal(entries.get('word/document.xml').toString('utf8'), '<w:document><w:t>你好，世界</w:t></w:document>')
  assert.equal(entries.get('empty.txt').length, 0)
})

test('zip reader rejects unsafe entry names', () => {
  const files = { '../escape.txt': 'bad' }
  assert.throws(() => readZip(writeZip(files)), PolicyError)
})

test('xml parser handles entities, CDATA, attributes, and namespaces', () => {
  const source = '<?xml version="1.0"?><w:root a:attr="&quot;quoted&quot;"><w:item>A &amp; B</w:item><w:cd><![CDATA[raw <tag> text]]></w:cd><!-- ignored --></w:root>'
  const root = parseXml(source)
  assert.equal(root.tag, 'root')
  assert.equal(root.attrs.get('attr'), '"quoted"')
  assert.equal(root.childrenBy('item')[0].textContent(), 'A & B')
  assert.equal(root.childrenBy('cd')[0].textContent(), 'raw <tag> text')
})

test('xml escape neutralizes special characters', () => {
  assert.equal(xmlEscape('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;')
})

test('path policy rejects escape, absolute paths, and reserved segments', () => {
  const root = 'D:/workspace'
  assert.equal(resolveInside(root, 'uploads/item.docx').relative, path.join('uploads', 'item.docx'))
  assert.throws(() => resolveInside(root, '../outside.docx'), PolicyError)
  assert.throws(() => resolveInside(root, 'C:\\Windows\\win.ini'), PolicyError)
  assert.throws(() => resolveInside(root, 'uploads/secret:stream'), PolicyError)
  assert.throws(() => resolveInside(root, 'CON.txt'), PolicyError)
})

test('docx create → validate → read round-trip', () => {
  const buffer = createDocx({
    title: '测试报告',
    paragraphs: ['第一段。', '第二段。'],
    table: [['姓名', '数量'], ['张三', '3']],
  })
  assert.deepEqual(validateOfficeBuffer(buffer, '.docx').format, 'docx')
  const result = readDocx(buffer)
  assert.equal(result.title, '测试报告')
  assert.equal(result.paragraphs.length, 2)
  assert.equal(result.tables.length, 1)
  assert.match(result.plainText, /第一段/)
  assert.match(result.plainText, /张三\t3/)
})

test('pptx create → validate → read round-trip', () => {
  const buffer = createPptx({
    title: '演示',
    slides: [{ title: '首页', bullets: ['要点一', '要点二'] }, { title: '第二页', bullets: [] }],
  })
  assert.deepEqual(validateOfficeBuffer(buffer, '.pptx').format, 'pptx')
  const result = readPptx(buffer)
  assert.equal(result.slides.length, 2)
  assert.match(result.slides[0].text, /首页/)
  assert.match(result.slides[0].text, /要点一/)
  assert.match(result.slides[1].text, /第二页/)
})

test('xlsx create → validate → read round-trip, formulas neutralized', () => {
  const buffer = createXlsx({
    sheetName: '数据',
    columns: ['名称', '数量'],
    rows: [['苹果', 3], ['合计', true]],
  })
  assert.deepEqual(validateOfficeBuffer(buffer, '.xlsx').format, 'xlsx')
  const result = readXlsx(buffer)
  assert.equal(result.sheets[0].name, '数据')
  assert.equal(result.sheets[0].rows[1][0], '苹果')
  assert.equal(result.sheets[0].rows[1][1], 3)
  assert.equal(result.sheets[0].rows[2][1], true)
})

test('xlsx validator rejects embedded formulas', () => {
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    'xl/workbook.xml': '<workbook/>',
    'xl/_rels/workbook.xml.rels': '<Relationships/>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
  }
  assert.throws(() => validateOfficeBuffer(writeZip(files), '.xlsx'), /formula found/i)
})

test('core reads text files and creates documents inside the workspace', async () => {
  const root = await temporaryWorkspace()
  try {
    const core = await createOfficeCore({ workspaceRoot: root })
    await writeFile(path.join(root, 'note.md'), 'hello office', 'utf8')
    const read = await core.readOffice({ path: 'note.md' })
    assert.equal(read.format, 'md')
    assert.match(read.plainText, /hello office/)

    const docx = await core.createDocxDocument({ filename: 'out.docx', title: '标题', paragraphs: ['正文'] })
    assert.equal(docx.path, 'outputs/out.docx')
    const roundTrip = await core.readOffice({ path: 'outputs/out.docx' })
    assert.equal(roundTrip.title, '标题')

    await assert.rejects(core.createDocxDocument({ filename: 'out.docx', paragraphs: ['覆盖'] }), /EEXIST|already exists|overwrite/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('upload sink sanitizes names, uniquifies collisions, and enforces limits', async () => {
  const root = await temporaryWorkspace()
  try {
    const core = await createOfficeCore({ workspaceRoot: root, maxUploadBytes: 1024 })
    const first = await core.saveUpload(Buffer.from('PK\u0003\u0004fake'), '报告: v1.docx')
    assert.equal(first.name, '报告_ v1.docx')
    assert.match(first.relativePath, /^uploads\//)
    const second = await core.saveUpload(Buffer.from('PK\u0003\u0004fake'), '报告: v1.docx')
    assert.equal(second.name, '报告_ v1-1.docx')

    await assert.rejects(core.saveUpload(Buffer.from('x'), 'evil.exe'), PolicyError)
    await assert.rejects(core.saveUpload(Buffer.alloc(2048, 1), 'big.docx'), PolicyError)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
