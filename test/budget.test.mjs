// Unit tests for the fan-out guards (src/budget.js): canonical family keys + the per-stage /
// total agent budget. Born from incident wf_7418b0da (2026-09-23): free-text families never
// converged and 1000 agents / 90.5M tokens were spent. `node test/budget.test.mjs`.
import assert from 'node:assert/strict'
import { canonFamily, makeAgentBudget, parseAgentCaps } from '../skills/livefire/src/budget.js'
import { renderInventory, parseInventoryMode } from '../skills/livefire/src/inventory-view.js'

let pass = 0, fail = 0
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`) }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) }
}

console.log('canonical family key:')
await t('variants that differ only by a parenthetical collapse to one key', () => {
  const k = canonFamily('stale-creator-ownership-after-removal')
  assert.equal(canonFamily('stale-creator-ownership-after-removal (org-keyed arm; the earlier fix closed only the project-keyed arm)'), k)
  assert.equal(canonFamily('stale-creator-ownership-after-removal (RLS helper-predicate arm)'), k)
  assert.equal(k, 'stale-creator-ownership-after-removal')
})
await t('"A / B (…)" keys on its first segment', () => {
  assert.equal(canonFamily('USING-only-UPDATE / unlocked-columns (identity-column rewrite bypasses INSERT-side invariants)'), 'using-only-update')
  assert.equal(canonFamily('USING-only-UPDATE / unlocked-columns'), 'using-only-update')
})
await t('case, spacing and punctuation are normalised', () => {
  assert.equal(canonFamily('Cross-object anchor mismatch'), canonFamily('cross object  anchor_mismatch'))
})
await t('an unbalanced or nested parenthetical is still stripped', () => {
  assert.equal(canonFamily('hard-delete (a (nested) note'), 'hard-delete')
  assert.equal(canonFamily('hard-delete (a (nested) note)'), 'hard-delete')
})
await t('empty / non-string input gives an empty key', () => {
  assert.equal(canonFamily(''), '')
  assert.equal(canonFamily(undefined), '')
  assert.equal(canonFamily('(only a note)'), '')
})

console.log('agent caps:')
await t('defaults: 120 per stage, 400 total', () => {
  assert.deepEqual(parseAgentCaps({}), { perStage: 120, total: 400 })
})
await t('valid overrides are honoured; the total never reaches the runtime cap of 1000', () => {
  assert.deepEqual(parseAgentCaps({ maxAgents: 20, maxAgentsTotal: 60 }), { perStage: 20, total: 60 })
  assert.equal(parseAgentCaps({ maxAgentsTotal: 5000 }).total, 900)
  assert.equal(parseAgentCaps({ maxAgents: '30' }).perStage, 30)
})
await t('invalid values fall back to the defaults, never to "no cap"', () => {
  for (const bad of [0, -3, 'x', null, '', NaN, Infinity]) {
    assert.deepEqual(parseAgentCaps({ maxAgents: bad, maxAgentsTotal: bad }), { perStage: 120, total: 400 }, `accepted ${bad}`)
  }
})

console.log('agent budget:')
await t('calls past the stage cap return null, are counted and logged', async () => {
  const logs = []
  let ran = 0
  const b = makeAgentBudget(async () => { ran++; return { ok: true } }, { perStage: 2, total: 10 }, (m) => logs.push(m))
  const out = await Promise.all([1, 2, 3].map((i) => b.agent('p', { label: `verify:${i}`, phase: 'Verify' })))
  assert.equal(ran, 2)
  assert.equal(out.filter(Boolean).length, 2)
  assert.deepEqual(b.report().per_stage, { Verify: 2 })
  assert.equal(b.report().dropped.length, 1)
  assert.equal(b.report().dropped[0].label, 'verify:3')
  assert.ok(logs.some((l) => /dropped.*verify:3/.test(l)), 'drop not logged')
})
await t('the total cap applies across stages', async () => {
  const b = makeAgentBudget(async () => ({}), { perStage: 10, total: 3 }, () => {})
  for (const phase of ['A', 'B', 'C', 'D']) await b.agent('p', { label: phase, phase })
  assert.equal(b.report().total, 3)
  assert.equal(b.report().dropped.length, 1)
})
await t('remaining(stage) reflects both caps', async () => {
  const b = makeAgentBudget(async () => ({}), { perStage: 5, total: 7 }, () => {})
  await b.agent('p', { label: 'x', phase: 'Sweep' })
  assert.equal(b.remaining('Sweep'), 4)
  for (let i = 0; i < 5; i++) await b.agent('p', { label: 'y', phase: 'Verify' })
  assert.equal(b.remaining('Sweep'), 1)
})

console.log('inventory view (W4.3 a):')
const LONG = 'x'.repeat(500)
const INV = { secdef_funcs: [{ name: 'f_one', args: 'a uuid', anon_exec: true, authed_exec: false, note: LONG }], policies: [{ table: 'tasks', cmd: 'UPDATE', using: LONG, with_check: '', flag: 'p1' }], zero_policy_tables: ['t0'], catalog_counts: { privileged_units: 1, policies: 1 } }
await t('full mode is the pretty JSON, unchanged', () => {
  assert.equal(renderInventory(INV, 'full'), JSON.stringify(INV, null, 2))
})
await t('compact mode lists every item, one line each, with long strings truncated', () => {
  const out = renderInventory(INV, 'compact')
  assert.ok(out.includes('f_one') && out.includes('tasks') && out.includes('UPDATE') && out.includes('t0'), 'an item is missing')
  assert.ok(!out.includes('x'.repeat(200)), 'a long string was not truncated')
  assert.ok(/secdef_funcs \(1\)/.test(out) && /policies \(1\)/.test(out), 'per-list counts missing')
  assert.ok(/catalog_counts/.test(out), 'scalar fields dropped')
  assert.ok(/truncated/i.test(out), 'no note telling the agent the text is truncated')
  const big = { policies: Array.from({ length: 50 }, (_, i) => ({ table: `t${i}`, cmd: 'UPDATE', using: LONG, with_check: LONG, flag: `p${i}` })) }
  assert.ok(renderInventory(big, 'compact').length < JSON.stringify(big, null, 2).length / 2, 'compact is not much smaller on a realistic inventory')
})
await t('compact mode keeps empty-string fields out and booleans in', () => {
  const out = renderInventory(INV, 'compact')
  assert.ok(/anon_exec=true/.test(out) && /authed_exec=false/.test(out))
  assert.ok(!/with_check=(\s|·|$)/.test(out), 'an empty field was printed')
})
await t('inventoryMode: "both" is the default (2026-09-27); "full" and "compact" select one view; invalid → both', () => {
  assert.equal(parseInventoryMode({ inventoryMode: 'compact' }), 'compact')
  assert.equal(parseInventoryMode({ inventoryMode: 'COMPACT' }), 'compact')
  assert.equal(parseInventoryMode({ inventoryMode: 'full' }), 'full')
  for (const v of [undefined, 'both', 'x', null, 1, '']) assert.equal(parseInventoryMode({ inventoryMode: v }), 'both', String(v))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
