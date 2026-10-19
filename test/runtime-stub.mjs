// A stub of the Workflow runtime, for tests. Executes an assembled workflow script (e.g.
// dist/livefire.workflow.js) the way the Workflow tool does — body inside an async scope with
// agent()/parallel()/pipeline()/phase()/log()/args/budget injected — but agent() returns canned
// answers and RECORDS every prompt. That makes the pipeline's real prompts and control flow
// unit-testable without spending a token.

export async function runWorkflow(scriptSrc, { args, respond }) {
  const body = scriptSrc.replace(/^export\s+const\s+meta\s*=/m, 'const meta =')
  const calls = []
  const logs = []
  let currentPhase = null
  // Like the real runtime: a schema-bound agent must return an object carrying every required
  // key (the real StructuredOutput tool refuses anything else), so a canned answer the real
  // runtime could never produce fails loudly instead of exercising an impossible path.
  const agent = async (prompt, opts = {}) => {
    const call = { prompt, label: opts.label || '', phase: opts.phase || currentPhase, schema: opts.schema, opts }
    calls.push(call)
    const out = await respond(call, calls)
    if (out && opts.schema && Array.isArray(opts.schema.required)) {
      const missing = opts.schema.required.filter((k) => !(k in out))
      if (missing.length) throw new Error(`stub: canned answer for "${call.label}" lacks required ${JSON.stringify(missing)}`)
    }
    return out
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const pipeline = async (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let r = item
    for (const s of stages) { try { r = await s(r, item, i) } catch (_) { return null } }
    return r
  }))
  const phase = (t) => { currentPhase = t }
  const log = (m) => logs.push(m)
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  // eslint-disable-next-line no-new-func
  const fn = new Function('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', `return (async () => {\n${body}\n})()`)
  const result = await fn(args, agent, parallel, pipeline, phase, log, budget, null)
  return { result, calls, logs }
}

// Sensible canned answers keyed on the agent label. Override per test via `overrides[labelPrefix]`
// (a value, or a function (call, calls) => value).
export function cannedResponder(overrides = {}) {
  return (call, calls) => {
    for (const [prefix, v] of Object.entries(overrides)) {
      if (call.label.startsWith(prefix)) return typeof v === 'function' ? v(call, calls) : v
    }
    const l = call.label
    if (l.startsWith('runtime-detect')) return { preset: 'generic', why: 'stub' }
    if (l.startsWith('inventory')) return {
      secdef_funcs: [{ name: 'f', args: '', anon_exec: true, authed_exec: true, note: '' }],
      policies: [{ table: 't', cmd: 'UPDATE', using: 'true', with_check: '', flag: 'USING-only' }],
      zero_policy_tables: [], secret_columns: [], units: [],
      catalog_counts: { privileged_units: 1, policies: 1 },
    }
    if (l.startsWith('static:')) return { lens: l.slice(7), findings: [{ title: `finding from ${l}`, severity: 'high', family: 'fam-' + l.slice(7), file: 'a.ts', line: 1, description: 'd', wrong_actor_scenario: 'w', guard_checked: 'g', probe_hint: 'p' }] }
    if (l.startsWith('prover') || l.startsWith('gap')) return { stack_status: 'up', degraded: false, probes: [], findings: [] }
    if (l.startsWith('critic')) return { dry: true, uncovered: [] }
    // echo the candidate back (title/family/file), like a real verifier that confirms it
    if (l.startsWith('verify:')) {
      const m = call.prompt.match(/CANDIDATE:\n([\s\S]*?)\n\nRELATED PROVER PROBES/)
      let c = {}
      try { c = m ? JSON.parse(m[1]) : {} } catch (_) { c = {} }
      return { title: c.title || 'v', confirmed: true, confidence: 8, corrected_severity: 'high', family: c.family || 'fam', modalities: ['static', 'empirical'], reason: 'r', file: c.file || 'a.ts', line: c.line || 1, fix: 'f' }
    }
    // echo every candidate of a batch back, confirmed (like verify:)
    if (l.startsWith('verify-batch:')) {
      const m = call.prompt.match(/CANDIDATES:\n([\s\S]*?)\n\nRELATED PROVER PROBES/)
      let cs = []
      try { cs = m ? JSON.parse(m[1]) : [] } catch (_) { cs = [] }
      return { verdicts: cs.map((c) => ({ title: c.title, confirmed: true, confidence: 8, corrected_severity: 'high', family: c.family || 'fam', modalities: ['static', 'empirical'], reason: 'r', file: c.file || 'a.ts', line: c.line || 1, fix: 'f' })) }
    }
    if (l.startsWith('sweep:')) return { family: 'fam', siblings: [] }
    if (l.startsWith('critic')) return { dry: true, uncovered: [] }
    if (l.startsWith('dedupe')) return null
    return null
  }
}
