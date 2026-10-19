// How the live inventory is shown to the agents (W4.3 a, 2026-09-26). Pure, stack-agnostic, and
// inlined by build.mjs ahead of the pipeline body.
//
//   both    — DEFAULT (2026-09-27): every static lens runs once per view and the candidates are
//             merged; prover and sweep get the full view. Measured on a production Next.js + Supabase app: the full view
//             found 14 highs but 1 app-tier hole, the compact view 9 highs but 10 app-tier holes.
//   full    — the pretty JSON, exactly as before
//   compact — every item still listed, one line each, long strings truncated (57.6k → 39.5k
//             chars on that app). The full dump pulls reviewer attention to the data tier;
//             the compact one leaves room for the app tier. Not a cost saving (~4%).

const MAX_FIELD = 160

// both (default since 2026-09-27) = the static lenses run once per view; full / compact = one view.
export function parseInventoryMode(cfg) {
  const m = cfg && typeof cfg.inventoryMode === 'string' ? cfg.inventoryMode.trim().toLowerCase() : ''
  return m === 'full' || m === 'compact' ? m : 'both'
}

function cut(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) + '…' : s
}

function line(item) {
  if (!item || typeof item !== 'object') return '- ' + cut(item)
  const parts = Object.entries(item).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => `${k}=${cut(v)}`)
  return '- ' + parts.join(' · ')
}

export function renderInventory(inv, mode) {
  if (mode !== 'compact') return JSON.stringify(inv, null, 2)
  const out = [`(compact view: every item is listed, but text longer than ${MAX_FIELD} chars is truncated with "…". When a truncated line matters to your judgement, read its full definition from the live store or the source before concluding.)`]
  for (const [k, v] of Object.entries(inv || {})) {
    if (Array.isArray(v)) {
      out.push(`${k} (${v.length}):`)
      for (const it of v) out.push(line(it))
    } else {
      out.push(`${k}: ${JSON.stringify(v)}`)
    }
  }
  return out.join('\n')
}
