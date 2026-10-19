// Fan-out guards for the pipeline — born from incident wf_7418b0da (2026-09-23): the sweep loop
// re-swept every "new" family, but a family is FREE TEXT written by each verifier, so every
// sibling invented a variant ("… (org-keyed arm)", "… (helper-predicate arm)") and the
// run spent 1000 agents / 90.5M tokens before the runtime's hard cap stopped it.
//
// Two guards live here, both pure (no runtime globals) so they are unit-testable and inlined by
// build.mjs ahead of the pipeline body:
//   canonFamily      — one key per root-cause family, whatever the verifier's wording
//   makeAgentBudget  — a per-stage + total agent budget that DROPS (and logs) past the cap,
//                      so no stage can reach the runtime's 1000-agent ceiling

// Lowercase, drop every parenthetical note, keep the first "A / B" segment, slug the rest.
export function canonFamily(family) {
  if (typeof family !== 'string') return ''
  let s = family.toLowerCase()
  // strip innermost parentheticals repeatedly (handles nesting), then any unbalanced tail
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(/\([^()]*\)/g, ' ') }
  s = s.replace(/\(.*$/, ' ')
  s = s.split(/\s\/\s|;/)[0]
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

const DEFAULT_PER_STAGE = 120
const DEFAULT_TOTAL = 400
// Stay well below the Workflow runtime's hard cap of 1000 agent() calls.
const MAX_TOTAL = 900

function positiveInt(v) {
  if (v === null || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

// cfg.maxAgents = per-stage cap, cfg.maxAgentsTotal = whole-run cap. Invalid → default, never "no cap".
export function parseAgentCaps(cfg) {
  const c = cfg || {}
  return {
    perStage: positiveInt(c.maxAgents) ?? DEFAULT_PER_STAGE,
    total: Math.min(MAX_TOTAL, positiveInt(c.maxAgentsTotal) ?? DEFAULT_TOTAL),
  }
}

// Wraps the runtime's agent(). The counter moves at CALL time (synchronously), so a parallel()
// burst is capped exactly. A dropped call returns null — every call site already treats null as
// "no answer" (parallel results are filtered with Boolean; direct awaits check !x).
export function makeAgentBudget(agentFn, caps, logFn) {
  const perStage = {}
  const dropped = []
  let total = 0
  const stageOf = (opts) => (opts && opts.phase) || 'Setup'
  const remaining = (stage) => Math.max(0, Math.min(caps.perStage - (perStage[stage] || 0), caps.total - total))
  async function agent(prompt, opts) {
    const stage = stageOf(opts)
    if (remaining(stage) <= 0) {
      const label = (opts && opts.label) || '?'
      dropped.push({ stage, label })
      logFn(`⚠️ agent budget: dropped ${label} (stage ${stage} ${perStage[stage] || 0}/${caps.perStage}, total ${total}/${caps.total})`)
      return null
    }
    perStage[stage] = (perStage[stage] || 0) + 1
    total++
    return agentFn(prompt, opts)
  }
  return {
    agent,
    remaining,
    report: () => ({ caps: { per_stage: caps.perStage, total: caps.total }, per_stage: { ...perStage }, total, dropped: dropped.slice() }),
  }
}
