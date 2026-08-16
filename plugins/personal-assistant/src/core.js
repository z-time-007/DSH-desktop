import path from 'node:path'
import { AuditLog } from './audit.js'
import { getComputerStatus } from './computer-status.js'
import {
  copyInsideWorkspace,
  listWorkspace,
  makeWorkspaceDirectory,
  moveInsideWorkspace,
  recycleInsideWorkspace,
  searchWorkspace,
} from './file-steward.js'
import { addTask, createDailySummary, createMeetingDraft, createMemo, listTasks, setTaskStatus } from './secretary.js'
import { createDocxDocument, createPptxDocument, createTextDocument, createXlsxDocument } from './document-writer.js'
import { assertRootIdentity } from './security.js'

function targetList(...values) {
  return values.filter(Boolean).map((value) => String(value).split(path.sep).join('/'))
}

export async function createAssistantCore({ workspaceRoot, auditPath = '.assistant/audit/events.jsonl' }) {
  const root = await assertRootIdentity(workspaceRoot)
  const audit = new AuditLog(root, auditPath)

  return {
    workspaceRoot: root,
    audit,

    computerStatus(args = {}) {
      return audit.run({
        capability: 'computer-status', action: 'summary', targets: ['local-system'],
        successDetails: () => ({ mode: 'read-only' }),
      }, () => getComputerStatus({ workspaceRoot: root, signal: args.signal }))
    },

    workspaceList(args = {}) {
      return audit.run({
        capability: 'file-steward', action: 'list', targets: targetList(args.relativePath ?? '.'),
        successDetails: (result) => ({ resultCount: result.items.length }),
      }, () => listWorkspace({ workspaceRoot: root, ...args }))
    },

    workspaceSearch(args = {}) {
      return audit.run({
        capability: 'file-steward', action: 'search', targets: ['workspace'],
        successDetails: (result) => ({ resultCount: result.results.length, truncated: result.truncated }),
      }, () => searchWorkspace({ workspaceRoot: root, ...args }))
    },

    workspaceMakeDirectory(args = {}) {
      return audit.run({
        capability: 'file-steward', action: 'create-directory', targets: targetList(args.relativePath),
      }, () => makeWorkspaceDirectory({ workspaceRoot: root, ...args }))
    },

    workspaceCopy(args = {}) {
      return audit.run({
        capability: 'file-steward', action: 'copy', targets: targetList(args.source, args.destination),
      }, () => copyInsideWorkspace({ workspaceRoot: root, ...args }))
    },

    workspaceMove(args = {}) {
      return audit.run({
        capability: 'file-steward', action: 'move', targets: targetList(args.source, args.destination),
      }, () => moveInsideWorkspace({ workspaceRoot: root, ...args }))
    },

    workspaceRecycle(args = {}) {
      return audit.run({
        capability: 'file-steward', action: 'recycle', targets: targetList(args.relativePath),
        successDetails: (result) => ({ recoverable: result.recoverable, recycledAs: result.recycledAs }),
      }, () => recycleInsideWorkspace({ workspaceRoot: root, ...args }))
    },

    secretaryTaskAdd(args = {}) {
      return audit.run({
        capability: 'secretary', action: 'task-add', targets: ['.assistant/secretary/tasks.json'],
        successDetails: (result) => ({ id: result.id, status: result.status }),
      }, () => addTask({ workspaceRoot: root, ...args }))
    },

    secretaryTaskList(args = {}) {
      return audit.run({
        capability: 'secretary', action: 'task-list', targets: ['.assistant/secretary/tasks.json'],
        successDetails: (result) => ({ resultCount: result.total }),
      }, () => listTasks({ workspaceRoot: root, ...args }))
    },

    secretaryTaskSetStatus(args = {}) {
      return audit.run({
        capability: 'secretary', action: 'task-status', targets: ['.assistant/secretary/tasks.json'],
        successDetails: (result) => ({ id: result.id, status: result.status }),
      }, () => setTaskStatus({ workspaceRoot: root, ...args }))
    },

    secretaryMemoCreate(args = {}) {
      return audit.run({
        capability: 'secretary', action: 'memo-create', targets: ['.assistant/secretary/memos'],
        successDetails: (result) => ({ id: result.id, path: result.path }),
      }, () => createMemo({ workspaceRoot: root, ...args }))
    },

    secretaryDailySummaryCreate(args = {}) {
      return audit.run({
        capability: 'secretary', action: 'daily-summary-create', targets: ['.assistant/secretary/daily'],
        successDetails: (result) => ({ date: result.date, path: result.path }),
      }, () => createDailySummary({ workspaceRoot: root, ...args }))
    },

    secretaryMeetingDraftCreate(args = {}) {
      return audit.run({
        capability: 'secretary', action: 'meeting-draft-create', targets: ['.assistant/secretary/meetings'],
        successDetails: (result) => ({ id: result.id, path: result.path }),
      }, () => createMeetingDraft({ workspaceRoot: root, ...args }))
    },

    documentCreateText(args = {}) {
      return audit.run({
        capability: 'document-writer', action: 'create-text', targets: targetList(`outputs/${args.filename ?? ''}`),
        successDetails: (result) => ({ format: result.format, bytes: result.bytes }),
      }, () => createTextDocument({ workspaceRoot: root, ...args }))
    },

    documentCreateDocx(args = {}) {
      return audit.run({
        capability: 'document-writer', action: 'create-docx', targets: targetList(`outputs/${args.filename ?? ''}`),
        successDetails: (result) => ({ format: result.format, bytes: result.bytes, paragraphs: result.paragraphs, tableCells: result.tableCells }),
      }, () => createDocxDocument({ workspaceRoot: root, ...args }))
    },

    documentCreatePptx(args = {}) {
      return audit.run({
        capability: 'document-writer', action: 'create-pptx', targets: targetList(`outputs/${args.filename ?? ''}`),
        successDetails: (result) => ({ format: result.format, bytes: result.bytes, slides: result.slides, images: result.images }),
      }, () => createPptxDocument({ workspaceRoot: root, ...args }))
    },

    documentCreateXlsx(args = {}) {
      return audit.run({
        capability: 'document-writer', action: 'create-xlsx', targets: targetList(`outputs/${args.filename ?? ''}`),
        successDetails: (result) => ({ format: result.format, bytes: result.bytes, rows: result.rows, columns: result.columns }),
      }, () => createXlsxDocument({ workspaceRoot: root, ...args }))
    },

  }
}
