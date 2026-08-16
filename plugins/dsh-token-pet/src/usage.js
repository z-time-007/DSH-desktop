/**
 * Session token-usage collection for @local/dsh-token-pet.
 *
 * Reads the live session projections provided by the DSH composition
 * (dsh-token-meter registers `tokenUsage`, `contextPressure`, and
 * `contextBreakdown`; dsh-session-stats registers `sessionStats`) for the
 * most recently created session, which is what a desktop pet means by
 * "current session".
 */

/** Most recent activity time for a session: its newest event time, else createdAt. */
function lastActivityTime(session) {
  try {
    const events = session?.events
    const last = Array.isArray(events) && events.length > 0 ? events[events.length - 1] : null
    const at = Number(last?.time)
    if (Number.isFinite(at)) return at
  } catch { /* fall through to createdAt */ }
  return Number(session?.header?.createdAt ?? 0)
}

/** Pick the most recently active session (by newest event, else creation time).
 * A bare restart can mint an empty session whose `createdAt` is newer than the
 * conversation the user is actually in, so creation time alone mis-selects. */
export function resolveCurrentSession(sessions) {
  const all = sessions.list()
  if (all.length === 0) return null
  return all.reduce((latest, session) => {
    return lastActivityTime(session) > lastActivityTime(latest) ? session : latest
  })
}

/** Collect usage/context/stats projections for one session. Exported for tests. */
export function collectUsage(sessionProjections, session) {
  if (!session) return { sessionId: null, usage: null, context: null, stats: null }
  let values = {}
  try {
    values = sessionProjections.snapshot(session)?.values ?? {}
  } catch {
    values = {}
  }
  return {
    sessionId: session.id,
    usage: values.tokenUsage ?? null,
    context: values.contextPressure ?? null,
    stats: values.sessionStats ?? null,
  }
}

/** Build a compact, pet-friendly usage summary. Exported for tests. */
export function summarizeUsage(usage) {
  if (!usage) return null
  const input = Number(usage.uncachedInputTokens ?? 0)
  const output = Number(usage.outputTokens ?? 0)
  const cacheRead = Number(usage.cacheReadTokens ?? 0)
  const cacheWrite = Number(usage.cacheWriteTokens ?? 0)
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  }
}
