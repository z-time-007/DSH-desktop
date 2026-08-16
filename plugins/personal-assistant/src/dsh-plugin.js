import { createAssistantCore } from './core.js'

export const name = 'local-personal-assistant'
export const inject = ['tools']

export const FILE_STEWARD_WRITE_TOOLS = new Set([
  'workspace_make_directory',
  'workspace_copy',
  'workspace_move',
  'workspace_recycle',
])

const jsonOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function register(ctx, core, definition, method) {
  ctx.tools.register({
    ...definition,
    parameters: compileParameters(definition.parameters),
    output: jsonOutput,
    async execute(args, exec) {
      return core[method]({ ...args, signal: exec.signal })
    },
  })
}

function compileValue(spec) {
  if (spec.oneOf) return { oneOf: spec.oneOf.map(compileValue) }
  const output = { type: spec.type }
  if (spec.description) output.description = spec.description
  if (spec.enum) output.enum = [...spec.enum]
  if (spec.type === 'array' && spec.items) output.items = compileValue(spec.items)
  if (spec.type === 'object') {
    output.additionalProperties = spec.additionalProperties ?? false
    output.properties = {}
    const required = []
    for (const [name, child] of Object.entries(spec.properties ?? {})) {
      output.properties[name] = compileValue(child)
      if (child.required) required.push(name)
    }
    if (required.length > 0) output.required = required
  }
  return output
}

function compileParameters(parameters) {
  const properties = {}
  const required = []
  for (const [name, spec] of Object.entries(parameters)) {
    properties[name] = compileValue(spec)
    if (spec.required) required.push(name)
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

function booleanOrDefault(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

export async function apply(ctx, rawConfig = {}) {
  const config = {
    enabled: booleanOrDefault(rawConfig.enabled, true),
    workspaceRoot: rawConfig.workspaceRoot,
    auditPath: rawConfig.auditPath ?? '.assistant/audit/events.jsonl',
    computerStatus: booleanOrDefault(rawConfig.computerStatus, true),
    fileSteward: booleanOrDefault(rawConfig.fileSteward, true),
    secretary: booleanOrDefault(rawConfig.secretary, true),
    documentWriter: booleanOrDefault(rawConfig.documentWriter, true),
    fileStewardWriteApproval: booleanOrDefault(rawConfig.fileStewardWriteApproval, true),
  }
  if (!config.enabled) return
  const core = await createAssistantCore(config)

  if (config.fileSteward && config.fileStewardWriteApproval) {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const downstream = await next()
      if (downstream.kind !== 'allow' || !FILE_STEWARD_WRITE_TOOLS.has(exec.name)) return downstream
      return {
        kind: 'ask',
        reason: 'File Steward write operation inside the fixed project workspace. Confirm this one operation.',
      }
    })
  }

  if (config.computerStatus) {
    register(ctx, core, {
      name: 'computer_status',
      description: 'Return a read-only local CPU, memory, workspace-disk, network-interface, Defender, and firewall summary. It does not change system settings.',
      parameters: {},
    }, 'computerStatus')
  }

  if (config.fileSteward) {
    register(ctx, core, {
      name: 'workspace_list',
      description: 'List one directory inside the fixed project workspace without following symbolic links.',
      parameters: { relativePath: { type: 'string', description: 'Workspace-relative directory. Defaults to .', required: false } },
    }, 'workspaceList')
    register(ctx, core, {
      name: 'workspace_search',
      description: 'Search filenames and bounded UTF-8 text content inside the fixed project workspace. Search is literal, local-only, and does not follow links.',
      parameters: {
        query: { type: 'string', required: true, description: 'Literal text to search for.' },
        maxResults: { type: 'integer', required: false, description: 'Maximum results, capped at 200.' },
      },
    }, 'workspaceSearch')
    register(ctx, core, {
      name: 'workspace_make_directory',
      description: 'Create a new directory inside the fixed project workspace. Existing destinations are never overwritten. Requires one-time human approval.',
      parameters: { relativePath: { type: 'string', required: true, description: 'New workspace-relative directory.' } },
    }, 'workspaceMakeDirectory')
    register(ctx, core, {
      name: 'workspace_copy',
      description: 'Copy a file or directory within the fixed project workspace. Links and overwrite are denied. Requires one-time human approval.',
      parameters: {
        source: { type: 'string', required: true, description: 'Existing workspace-relative source.' },
        destination: { type: 'string', required: true, description: 'New workspace-relative destination.' },
      },
    }, 'workspaceCopy')
    register(ctx, core, {
      name: 'workspace_move',
      description: 'Move a file or directory within the fixed project workspace. Links and overwrite are denied. Requires one-time human approval.',
      parameters: {
        source: { type: 'string', required: true, description: 'Existing workspace-relative source.' },
        destination: { type: 'string', required: true, description: 'New workspace-relative destination.' },
      },
    }, 'workspaceMove')
    register(ctx, core, {
      name: 'workspace_recycle',
      description: 'Move a workspace item into the project quarantine recycle bin. It never permanently deletes. Requires confirm=true plus one-time human approval.',
      parameters: {
        relativePath: { type: 'string', required: true, description: 'Existing workspace-relative item.' },
        confirm: { type: 'boolean', required: true, description: 'Must be true after the user explicitly asks to recycle this item.' },
      },
    }, 'workspaceRecycle')
  }

  if (config.secretary) {
    register(ctx, core, {
      name: 'secretary_task_add',
      description: 'Add a task to the local workspace task store. No email, calendar, account, or network integration.',
      parameters: {
        title: { type: 'string', required: true },
        notes: { type: 'string', required: false },
        due: { type: 'string', required: false, description: 'Optional YYYY-MM-DD date.' },
      },
    }, 'secretaryTaskAdd')
    register(ctx, core, {
      name: 'secretary_task_list',
      description: 'List local workspace tasks, optionally filtered by status.',
      parameters: { status: { type: 'string', required: false, enum: ['pending', 'in_progress', 'completed', 'cancelled'] } },
    }, 'secretaryTaskList')
    register(ctx, core, {
      name: 'secretary_task_set_status',
      description: 'Set the status of one local workspace task without deleting it.',
      parameters: {
        id: { type: 'string', required: true },
        status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
      },
    }, 'secretaryTaskSetStatus')
    register(ctx, core, {
      name: 'secretary_memo_create',
      description: 'Create a new Markdown memo in the local workspace secretary store. Existing files are not overwritten.',
      parameters: { title: { type: 'string', required: true }, content: { type: 'string', required: true } },
    }, 'secretaryMemoCreate')
    register(ctx, core, {
      name: 'secretary_daily_summary_create',
      description: 'Create one new Markdown daily summary draft for a YYYY-MM-DD date. Existing files are not overwritten.',
      parameters: { date: { type: 'string', required: true }, content: { type: 'string', required: true } },
    }, 'secretaryDailySummaryCreate')
    register(ctx, core, {
      name: 'secretary_meeting_draft_create',
      description: 'Create a local Markdown meeting-record draft. It does not contact attendees or external accounts.',
      parameters: {
        title: { type: 'string', required: true },
        date: { type: 'string', required: true },
        attendees: { type: 'array', required: false, items: { type: 'string' } },
        agenda: { type: 'array', required: false, items: { type: 'string' } },
        notes: { type: 'string', required: false },
      },
    }, 'secretaryMeetingDraftCreate')
  }

  if (config.documentWriter) {
    register(ctx, core, {
      name: 'assistant_document_create_text',
      description: 'Create a new UTF-8 TXT or Markdown file under workspace/outputs. Overwrite is disabled.',
      parameters: {
        filename: { type: 'string', required: true, description: 'Basename ending in .txt or .md; no directory.' },
        format: { type: 'string', required: true, enum: ['txt', 'md'] },
        content: { type: 'string', required: true },
      },
    }, 'documentCreateText')
    register(ctx, core, {
      name: 'assistant_document_create_docx',
      description: 'Create a new macro-free DOCX under workspace/outputs from plain text and an optional table. No external links or remote media.',
      parameters: {
        filename: { type: 'string', required: true, description: 'Basename ending in .docx; no directory.' },
        title: { type: 'string', required: false },
        paragraphs: { type: 'array', required: false, items: { type: 'string' } },
        table: { type: 'array', required: false, items: { type: 'array', items: { type: 'string' } } },
      },
    }, 'documentCreateDocx')
    register(ctx, core, {
      name: 'assistant_document_create_pptx',
      description: 'Create a new PPTX under workspace/outputs. Optional images must be local PNG/JPEG files under workspace/assets/inbox and are re-encoded before embedding.',
      parameters: {
        filename: { type: 'string', required: true, description: 'Basename ending in .pptx; no directory.' },
        title: { type: 'string', required: false },
        slides: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              title: { type: 'string', required: true },
              bullets: { type: 'array', required: false, items: { type: 'string' } },
              images: {
                type: 'array', required: false,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    path: { type: 'string', required: true, description: 'Relative path under workspace/assets/inbox; PNG/JPEG only.' },
                    fit: { type: 'string', required: false, enum: ['contain', 'cover'] },
                    x: { type: 'number', required: true, minimum: 0 },
                    y: { type: 'number', required: true, minimum: 0 },
                    w: { type: 'number', required: true, exclusiveMinimum: 0 },
                    h: { type: 'number', required: true, exclusiveMinimum: 0 },
                  },
                },
              },
            },
          },
        },
      },
    }, 'documentCreatePptx')
    register(ctx, core, {
      name: 'assistant_document_create_xlsx',
      description: 'Create a new formula-free XLSX under workspace/outputs from scalar cells. Formula-like text is neutralized and overwrite is disabled.',
      parameters: {
        filename: { type: 'string', required: true, description: 'Basename ending in .xlsx; no directory.' },
        sheetName: { type: 'string', required: false },
        columns: { type: 'array', required: true, items: { type: 'string' } },
        rows: {
          type: 'array', required: true,
          items: {
            type: 'array',
            items: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] },
          },
        },
      },
    }, 'documentCreateXlsx')
  }

}
