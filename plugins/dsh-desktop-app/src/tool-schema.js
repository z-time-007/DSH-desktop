/**
 * Shared tool-schema helpers for @local/dsh-desktop-app.
 *
 * Mirrors the adapter used by @local/dsh-personal-assistant: turns the
 * compact declarative parameter spec used by `ctx.tools.register()` into a
 * standard JSON Schema without depending on pnpm hoisting DSH internals.
 */

export const jsonOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

export function compileValue(spec) {
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

export function compileParameters(parameters) {
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
