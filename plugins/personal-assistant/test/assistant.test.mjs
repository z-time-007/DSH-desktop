import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, open, readFile, symlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { createAssistantCore } from '../src/core.js'
import { apply, FILE_STEWARD_WRITE_TOOLS } from '../src/dsh-plugin.js'
import { inspectZipBuffer, validateOfficeFile } from '../src/office-validator.js'
import { PolicyError, resolveInside } from '../src/security.js'

async function temporaryWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'dsh-assistant-test-'))
}

test('path policy rejects escape, absolute paths, and reserved segments', () => {
  const root = path.resolve('D:/path/to/deepseek-harness/workspace')
  assert.equal(resolveInside(root, 'notes/item.md').relative, path.join('notes', 'item.md'))
  assert.throws(() => resolveInside(root, '../outside.txt'), PolicyError)
  assert.throws(() => resolveInside(root, 'C:\\Windows\\win.ini'), PolicyError)
  assert.throws(() => resolveInside(root, '\\\\server\\share'), PolicyError)
  assert.throws(() => resolveInside(root, 'notes/secret:stream'), PolicyError)
  assert.throws(() => resolveInside(root, 'CON.txt'), PolicyError)
})

test('file steward stays in workspace, denies overwrite, and recycles instead of deleting', async () => {
  const root = await temporaryWorkspace()
  const core = await createAssistantCore({ workspaceRoot: root })
  await mkdir(path.join(root, 'source'))
  await writeFile(path.join(root, 'source', 'note.md'), 'alpha needle omega', 'utf8')

  const listing = await core.workspaceList({ relativePath: 'source' })
  assert.deepEqual(listing.items.map((item) => item.name), ['note.md'])
  const search = await core.workspaceSearch({ query: 'needle' })
  assert.equal(search.results[0].path, 'source/note.md')

  await core.workspaceCopy({ source: 'source/note.md', destination: 'copies/note.md' })
  await assert.rejects(core.workspaceCopy({ source: 'source/note.md', destination: 'copies/note.md' }), /overwrite is disabled/i)
  await core.workspaceMove({ source: 'copies/note.md', destination: 'moved/note.md' })
  await assert.rejects(core.workspaceRecycle({ relativePath: 'moved/note.md', confirm: false }), /confirm=true/i)
  const recycled = await core.workspaceRecycle({ relativePath: 'moved/note.md', confirm: true })
  assert.equal(recycled.recoverable, true)
  assert.match(recycled.recycledAs, /^\.assistant\/recycle-bin\//)

  try {
    await symlink(path.join(root, 'source'), path.join(root, 'linked'), 'junction')
    await assert.rejects(core.workspaceList({ relativePath: 'linked' }), /Symbolic links are not allowed/i)
  } catch (error) {
    if (error?.code !== 'EPERM') throw error
  }
})

test('secretary stores local drafts and audit omits document bodies', async () => {
  const root = await temporaryWorkspace()
  const core = await createAssistantCore({ workspaceRoot: root })
  const secret = 'PRIVATE_BODY_SHOULD_NOT_ENTER_AUDIT'
  const task = await core.secretaryTaskAdd({ title: 'Prepare brief', notes: secret, due: '2026-08-20' })
  assert.equal((await core.secretaryTaskList({ status: 'pending' })).total, 1)
  await core.secretaryTaskSetStatus({ id: task.id, status: 'completed' })
  assert.equal((await core.secretaryTaskList({ status: 'completed' })).total, 1)
  assert.match((await core.secretaryMemoCreate({ title: 'Memo', content: secret })).path, /memos\/.*\.md$/)
  await core.secretaryDailySummaryCreate({ date: '2026-08-14', content: secret })
  await core.secretaryMeetingDraftCreate({ title: 'Weekly sync', date: '2026-08-14', attendees: ['A'], agenda: ['Review'], notes: secret })
  const audit = await readFile(path.join(root, '.assistant', 'audit', 'events.jsonl'), 'utf8')
  assert.equal(audit.includes(secret), false)
})

test('computer status returns a bounded read-only summary', async () => {
  const root = await temporaryWorkspace()
  const core = await createAssistantCore({ workspaceRoot: root })
  const status = await core.computerStatus()
  assert.ok(status.cpu.logicalCores >= 1)
  assert.ok(status.memory.totalGiB > 0)
  assert.ok(Array.isArray(status.network.activeInterfaces))
  assert.equal(typeof status.security.available, 'boolean')
})

test('document writer creates valid macro-free, link-free, formula-free OOXML and refuses overwrite', async () => {
  const root = await temporaryWorkspace()
  const core = await createAssistantCore({ workspaceRoot: root })
  const inbox = path.join(root, 'assets', 'inbox')
  await mkdir(inbox, { recursive: true })
  await sharp({ create: { width: 640, height: 360, channels: 3, background: '#336699' } }).png().toFile(path.join(inbox, 'safe.png'))
  await sharp({ create: { width: 400, height: 600, channels: 3, background: '#996633' } })
    .jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toFile(path.join(inbox, 'photo.jpg'))
  await core.documentCreateText({ filename: 'notes.md', format: 'md', content: '# Hello' })
  await assert.rejects(core.documentCreateText({ filename: 'notes.md', format: 'md', content: 'again' }), /EEXIST|exist/i)

  const docx = await core.documentCreateDocx({
    filename: 'report.docx', title: 'Report', paragraphs: ['Paragraph one'], table: [['A', 'B'], ['1', '2']],
  })
  const pptx = await core.documentCreatePptx({
    filename: 'brief.pptx', title: 'Brief', slides: [{
      title: 'Slide 1', bullets: ['One', 'Two'], images: [
        { path: 'safe.png', fit: 'contain', x: 7.2, y: 1.3, w: 5.5, h: 2.6 },
        { path: 'photo.jpg', fit: 'cover', x: 7.2, y: 4.1, w: 2.5, h: 2.5 },
      ],
    }],
  })
  const xlsx = await core.documentCreateXlsx({
    filename: 'table.xlsx', sheetName: 'Data', columns: ['Name', 'Value'], rows: [['Safe', '=2+2'], ['Count', 2]],
  })
  for (const item of [docx, pptx, xlsx]) {
    const validated = await validateOfficeFile(path.join(root, item.path))
    assert.equal(validated.valid, true)
  }

  const presentationEntries = inspectZipBuffer(await readFile(path.join(root, pptx.path)))
  const media = [...presentationEntries].filter(([name]) => /^ppt\/media\/image\d+\.(?:png|jpeg)$/.test(name))
  assert.equal(media.length, 2)
  for (const [name, content] of presentationEntries) {
    assert.doesNotMatch(name, /externalLinks|vbaProject|embeddings|oleObject/i)
    if (name.endsWith('.rels')) assert.doesNotMatch(content.toString('utf8'), /TargetMode\s*=\s*["']External/i)
  }
  assert.match(presentationEntries.get('ppt/slides/_rels/slide1.xml.rels').toString('utf8'), /Target="\.\.\/media\/image1\.png"/)
  const sanitizedJpeg = await sharp(media.find(([name]) => name.endsWith('.jpeg'))[1]).metadata()
  assert.equal(sanitizedJpeg.exif, undefined)
  assert.equal(sanitizedJpeg.orientation, undefined)

  const spreadsheetEntries = inspectZipBuffer(await readFile(path.join(root, xlsx.path)))
  const sheetXml = spreadsheetEntries.get('xl/worksheets/sheet1.xml').toString('utf8')
  assert.doesNotMatch(sheetXml, /<f(?:\s|>)/i)
  assert.match(sheetXml, /&apos;=2\+2/)

  await assert.rejects(core.documentCreatePptx({ filename: 'brief.pptx', slides: [{ title: 'Duplicate' }] }), /EEXIST|exist/i)

  const jpegBytes = await readFile(path.join(inbox, 'photo.jpg'))
  await writeFile(path.join(inbox, 'fake.png'), jpegBytes)
  await writeFile(path.join(inbox, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8')
  await assert.rejects(core.documentCreatePptx({ filename: 'fake.pptx', slides: [{ title: 'Fake', images: [{ path: 'fake.png', x: 0, y: 0, w: 1, h: 1 }] }] }), /signature|match/i)
  await assert.rejects(core.documentCreatePptx({ filename: 'svg.pptx', slides: [{ title: 'SVG', images: [{ path: 'vector.svg', x: 0, y: 0, w: 1, h: 1 }] }] }), /PNG|JPEG/i)
  await assert.rejects(core.documentCreatePptx({ filename: 'escape.pptx', slides: [{ title: 'Escape', images: [{ path: '../safe.png', x: 0, y: 0, w: 1, h: 1 }] }] }), /escape/i)

  const oversized = await open(path.join(inbox, 'oversized.png'), 'w')
  await oversized.truncate(10 * 1024 * 1024 + 1)
  await oversized.close()
  await assert.rejects(core.documentCreatePptx({ filename: 'oversized.pptx', slides: [{ title: 'Large', images: [{ path: 'oversized.png', x: 0, y: 0, w: 1, h: 1 }] }] }), /10 MiB/i)
  await sharp({ create: { width: 8001, height: 1, channels: 3, background: '#000000' } }).png().toFile(path.join(inbox, 'wide.png'))
  await assert.rejects(core.documentCreatePptx({ filename: 'wide.pptx', slides: [{ title: 'Wide', images: [{ path: 'wide.png', x: 0, y: 0, w: 1, h: 1 }] }] }), /8000|megapixels/i)

  try {
    await symlink(inbox, path.join(inbox, 'linked'), 'junction')
    await assert.rejects(core.documentCreatePptx({ filename: 'linked.pptx', slides: [{ title: 'Linked', images: [{ path: 'linked/safe.png', x: 0, y: 0, w: 1, h: 1 }] }] }), /Symbolic links are not allowed/i)
  } catch (error) {
    if (error?.code !== 'EPERM') throw error
  }
})

test('DSH adapter registers the intended tools and asks for file-steward write approval', async () => {
  const root = await temporaryWorkspace()
  const definitions = []
  const listeners = new Map()
  const ctx = {
    tools: { register(definition) { definitions.push(definition); return () => {} } },
    on(name, listener) { listeners.set(name, listener); return () => {} },
  }
  await apply(ctx, { workspaceRoot: root })
  const names = new Set(definitions.map((definition) => definition.name))
  for (const required of ['computer_status', 'workspace_list', 'workspace_recycle', 'secretary_task_add', 'assistant_document_create_docx', 'assistant_document_create_pptx', 'assistant_document_create_xlsx']) {
    assert.equal(names.has(required), true, `${required} was not registered`)
  }
  const requireFromDsh = createRequire(realpathSync(path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json')))
  const toolsEntry = requireFromDsh.resolve('@deepseek-ai/dsh-tools')
  const { assertSupportedJsonSchema } = await import(pathToFileURL(toolsEntry).href)
  for (const definition of definitions) {
    assert.doesNotThrow(() => assertSupportedJsonSchema(definition.parameters))
    assert.doesNotThrow(() => assertSupportedJsonSchema(definition.output.schema))
  }
  const gate = listeners.get('tools/pre-execute')
  assert.ok(gate)
  for (const name of FILE_STEWARD_WRITE_TOOLS) {
    assert.equal((await gate({ name }, async () => ({ kind: 'allow' }))).kind, 'ask')
  }
  assert.equal((await gate({ name: 'workspace_list' }, async () => ({ kind: 'allow' }))).kind, 'allow')

  const createText = definitions.find((definition) => definition.name === 'assistant_document_create_text')
  const result = await createText.execute({ filename: 'adapter.txt', format: 'txt', content: 'adapter' }, { signal: new AbortController().signal })
  assert.equal(result.path, 'outputs/adapter.txt')

  const disabledDefinitions = []
  await apply({ tools: { register(definition) { disabledDefinitions.push(definition) } }, on() {} }, { enabled: false })
  assert.equal(disabledDefinitions.length, 0)
})
