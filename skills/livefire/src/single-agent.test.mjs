// livefire single-agent prompt tests. `node src/single-agent.test.mjs`.
import assert from 'node:assert/strict'
import { buildSingleAgentPrompt } from './single-agent.js'
import { supabaseAdapter } from '../presets/supabase.js'
import { laravelAdapter } from '../presets/laravel.js'
import { GENERIC_ADAPTER } from './adapter.js'

let pass = 0, fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) }
}

console.log('buildSingleAgentPrompt — structure:')
t('includes all seven stages + safety', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, { securityPass: true })
  for (const s of ['Stage 0 — SAFETY', 'Stage 1 — Inventory', 'Stage 2 — Static', 'Stage 3 — Empirical', 'Stage 4 — Adversarial', 'Stage 5 — Root-cause', 'Stage 6 — Completeness', 'Stage 7 — Report']) {
    assert.ok(p.includes(s), `missing ${s}`)
  }
})
t('states the six rules + cross-modal', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, {})
  assert.ok(p.includes('six rules'))
  assert.ok(/CONFIRMED-strong/.test(p) && /≥2 modalities/.test(p))
})
t('carries the three-actor matrix', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, {})
  assert.ok(/anon/.test(p) && /outsider/.test(p) && /wrong-role/.test(p))
})

console.log('buildSingleAgentPrompt — adapter-specific content:')
t('supabase: inventory SQL is inlined', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, {})
  assert.ok(p.includes('pg_policies'), 'supabase inventory SQL missing')
  assert.ok(p.includes('supabase'), 'adapter id missing')
})
t('laravel: route→Gate/Policy inventory + php test cmd', () => {
  const p = buildSingleAgentPrompt(laravelAdapter, {})
  assert.ok(/Gate|Policy/.test(p), 'laravel authz map missing')
  assert.ok(p.includes('php artisan test'), 'laravel test cmd missing')
  assert.ok(!p.includes('pg_policies'), 'must NOT carry Postgres inventory for laravel')
})
t('each preset carries its lenses', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, {})
  for (const l of supabaseAdapter.lenses) assert.ok(p.includes(`[${l.key}]`), `lens ${l.key} missing`)
})

console.log('buildSingleAgentPrompt — scope + degraded honesty:')
t('whole vs feature scope wording differs', () => {
  const whole = buildSingleAgentPrompt(supabaseAdapter, { securityPass: true })
  const feat = buildSingleAgentPrompt(supabaseAdapter, { securityPass: false })
  assert.ok(whole.includes('WHOLE-SURFACE'))
  assert.ok(feat.includes('FEATURE/DIFF'))
})
t('names the safety fail-closed rule', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, {})
  assert.ok(/fail-closed/.test(p) && /non-local DB target/.test(p))
})
t('generic adapter still produces a usable prompt', () => {
  const p = buildSingleAgentPrompt(GENERIC_ADAPTER, {})
  assert.ok(p.includes('Stage 7 — Report'))
  assert.ok(p.length > 1500)
})

console.log('buildSingleAgentPrompt — parity with the Workflow prover (W1/W2):')
import { resolveAdapter } from './adapter.js'
import { REGISTRY } from '../presets/index.js'
t('carries the seed-ledger + by-PK cleanup rule', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, {})
  assert.ok(/SEED LEDGER/.test(p) && /primary key/.test(p) && /NEVER a broad DELETE/.test(p))
})
t('carries the environment-identity rule (prove it is a test env before the first write)', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, {})
  assert.ok(/ENVIRONMENT IDENTITY/.test(p) && /canary/.test(p))
})
t('names the target repo root when given', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, { repoRoot: '/abs/app' })
  assert.ok(p.includes('/abs/app'))
})
t('uses the adapter execution / credentials / guard fields (supabase keeps its Postgres specifics)', () => {
  const { adapter } = resolveAdapter({ preset: 'supabase' }, REGISTRY)
  const p = buildSingleAgentPrompt(adapter, {})
  assert.ok(p.includes(adapter.inventoryExecution.slice(0, 60)), 'inventoryExecution missing')
  assert.ok(p.includes(adapter.credentialsHint.slice(0, 40)), 'credentialsHint missing')
  assert.ok(p.includes(adapter.guardExamples.slice(0, 40)), 'guardExamples missing')
})
t('asks for mechanically-counted totals and a re-dump when short', () => {
  const p = buildSingleAgentPrompt(supabaseAdapter, {})
  assert.ok(/catalog_counts/.test(p) && /re-run the dump/i.test(p))
})
t('an express prompt carries no Postgres vocabulary', () => {
  const { adapter } = resolveAdapter({ preset: 'express' }, REGISTRY)
  const p = buildSingleAgentPrompt(adapter, {})
  const m = p.match(/\bpsql\b|pg_policies|pg_proc|SECURITY DEFINER|\bRLS\b|service[-_ ]role|supabase(?!\.co)/i)
  assert.equal(m, null, `express single-agent prompt contains "${m && m[0]}"`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
