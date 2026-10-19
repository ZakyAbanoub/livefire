// livefire stack-agnosticism sentinels (W2). `node test/agnostic.test.mjs`.
//
// The pipeline (src/harness-core.js) must not assume Postgres/Supabase/Next: every stack-specific
// instruction lives in a preset. These tests (a) scan the core for stack tooling names and
// (b) run the assembled workflow for EVERY non-Postgres preset under the stub runtime and assert
// no Postgres instruction leaks into any prompt it sends.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorkflow, cannedResponder } from './runtime-stub.mjs'
import { REGISTRY } from '../skills/livefire/presets/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE = join(ROOT, 'skills/livefire')
execFileSync('node', [join(ENGINE, 'build.mjs')], { stdio: 'ignore' })
const DIST = await readFile(join(ENGINE, 'dist/livefire.workflow.js'), 'utf8')
const CORE = await readFile(join(ENGINE, 'src/harness-core.js'), 'utf8')
const RULES = await readFile(join(ENGINE, 'src/prover-rules.js'), 'utf8')

let pass = 0, fail = 0
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`) }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) }
}

// Stack tooling / catalog vocabulary that must never appear in the core pipeline or in a
// non-Postgres preset's prompts. (The runtime-detect hint list of preset ids is exempt: it names
// stacks on purpose, to choose between them.)
// `supabase` is allowed only as the managed-host example `*.supabase.co` in the safety blocklist.
const PG_VOCAB = /\bpsql\b|pg_policies|pg_proc|pg_catalog|pg_namespace|has_function_privilege|supabase(?!\.co)|protect_\*|SECURITY DEFINER|\bRLS\b|service[-_ ]role|project ref|auth\.uid/i
const POSTGRES_PRESETS = new Set(['supabase', 'hasura']) // hasura legitimately layers on Postgres RLS

console.log('core pipeline source:')
await t('harness-core.js body names no Postgres/Supabase tooling', () => {
  const body = CORE.split('//#BODY-START')[1]
  // drop the runtime-detect prompt line (it lists stacks by design)
  const scanned = body.split('\n').filter((l) => !l.trim().startsWith('//') && !l.includes('runtime-detect') && !l.includes('Rules of thumb')).join('\n')
  const m = scanned.match(PG_VOCAB)
  assert.equal(m, null, `core mentions "${m && m[0]}"`)
})

await t('prover-rules.js (shared by prover, gap-closer, single-agent) names no stack tooling', () => {
  const m = RULES.match(PG_VOCAB)
  assert.equal(m, null, `prover rules mention "${m && m[0]}"`)
})

console.log('non-Postgres presets send no Postgres instructions:')
for (const id of Object.keys(REGISTRY).filter((k) => !POSTGRES_PRESETS.has(k))) {
  await t(`${id}: no prompt contains Postgres/Supabase vocabulary`, async () => {
    // A short first dump (→ inventory:retry prompt) and a non-dry first critic (→ gap-round
    // prompt), so EVERY prompt the pipeline can send for this preset is scanned.
    let inv = 0, crit = 0
    const { calls } = await runWorkflow(DIST, { args: { cfg: { preset: id } }, respond: cannedResponder({
      inventory: () => ({ units: [], secret_columns: [], notes: [], catalog_counts: { privileged_units: ++inv === 1 ? 1 : 0, policies: 0 } }),
      critic: () => (++crit === 1 ? { dry: false, uncovered: [{ surface: 's', why: 'w', suggested_probe: 'p' }] } : { dry: true, uncovered: [] }),
    }) })
    assert.ok(calls.some((c) => c.label === 'inventory:retry'), 'retry prompt not exercised')
    assert.ok(calls.some((c) => c.label.startsWith('gap:')), 'gap prompt not exercised')
    for (const c of calls) {
      if (c.label === 'runtime-detect') continue
      const m = c.prompt.match(PG_VOCAB)
      assert.equal(m, null, `${c.label} prompt contains "${m && m[0]}"`)
    }
  })
}

console.log('app-tier inventory shape (wrong_actor_reachable must be computable):')
for (const [id, a] of Object.entries(REGISTRY).filter(([k]) => k !== 'supabase')) {
  await t(`${id}: inventory schema requires units[].reachable_by_wrong_actor and the prompt asks for it`, () => {
    const units = a.inventorySchema && a.inventorySchema.properties && a.inventorySchema.properties.units
    assert.ok(units, 'no units[] in schema')
    assert.ok((units.items.required || []).includes('reachable_by_wrong_actor'), 'units[] does not require reachable_by_wrong_actor')
    assert.ok((a.inventorySchema.required || []).includes('units'), 'units not required at root')
    assert.ok(/reachable_by_wrong_actor/.test(a.inventorySql), 'inventorySql never names reachable_by_wrong_actor')
  })
}
await t('express run: wrong_actor_reachable counts reachable units', async () => {
  const inv = { units: [
    { name: 'GET /a', kind: 'route', location: 'a.js:1', guard: 'none', reachable_by_wrong_actor: true, note: '' },
    { name: 'GET /b', kind: 'route', location: 'b.js:1', guard: 'requireAuth', reachable_by_wrong_actor: false, note: '' },
  ], secret_columns: [], notes: [], catalog_counts: { privileged_units: 2, policies: 0 } }
  const { result } = await runWorkflow(DIST, { args: { cfg: { preset: 'express' } }, respond: cannedResponder({ inventory: inv }) })
  assert.equal(result.inventory_summary.privileged_units, 2)
  assert.equal(result.inventory_summary.wrong_actor_reachable, 1)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
