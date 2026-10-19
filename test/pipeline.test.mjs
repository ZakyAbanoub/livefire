// livefire pipeline tests — run the ASSEMBLED workflow under a stub runtime and assert on the
// prompts it actually sends + its control flow. `node test/pipeline.test.mjs`.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorkflow, cannedResponder } from './runtime-stub.mjs'
import { resolveAdapter } from '../skills/livefire/src/adapter.js'
import { REGISTRY } from '../skills/livefire/presets/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE = join(ROOT, 'skills/livefire')
execFileSync('node', [join(ENGINE, 'build.mjs')], { stdio: 'ignore' })
const DIST = await readFile(join(ENGINE, 'dist/livefire.workflow.js'), 'utf8')

let pass = 0, fail = 0
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`) }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) }
}
const run = (cfg, overrides) => runWorkflow(DIST, { args: { cfg }, respond: cannedResponder(overrides) })

console.log('per-repo overrides survive preset resolution (1.A):')
await t('resolveAdapter keeps repoContext/db/actors/testCmd overrides on top of a preset', () => {
  const { adapter } = resolveAdapter({ preset: 'supabase', repoContext: 'PROJECT-TENANCY', db: 'DB-RECIPE', actors: 'ACTOR-RECIPE', testCmd: 'npx vitest run' }, REGISTRY)
  assert.equal(adapter.id, 'supabase')
  assert.ok(adapter.repoContext.includes('PROJECT-TENANCY'), 'repoContext override dropped')
  assert.ok(adapter.db.includes('DB-RECIPE'), 'db override dropped')
  assert.ok(adapter.actors.includes('ACTOR-RECIPE'), 'actors override dropped')
  assert.equal(adapter.testCmd, 'npx vitest run')
})
await t('preset safety guidance is kept when db is overridden (append, not replace)', () => {
  const { adapter } = resolveAdapter({ preset: 'supabase', db: 'DB-RECIPE' }, REGISTRY)
  assert.ok(/NEVER a service_role key/.test(adapter.db), 'preset db safety text lost')
})
await t('extraLenses are appended to the preset lenses', () => {
  const { adapter } = resolveAdapter({ preset: 'supabase', extraLenses: [{ key: 'money', prompt: 'MONEY lens' }] }, REGISTRY)
  assert.ok(adapter.lenses.some((l) => l.key === 'money'))
  assert.ok(adapter.lenses.some((l) => l.key === 'authz'))
})
await t('every agent prompt carries the project repoContext override', async () => {
  const { calls } = await run({ preset: 'supabase', repoContext: 'PROJECT-TENANCY' })
  assert.ok(calls.length > 5)
  for (const c of calls) assert.ok(c.prompt.includes('PROJECT-TENANCY'), `${c.label} lacks the repoContext override`)
})
await t('stringified cfg with overrides still reaches the prompts', async () => {
  const { calls } = await runWorkflow(DIST, { args: { cfg: JSON.stringify({ preset: 'supabase', repoContext: 'PROJECT-TENANCY' }) }, respond: cannedResponder() })
  assert.ok(calls.find((c) => c.label === 'inventory').prompt.includes('PROJECT-TENANCY'))
})

console.log('target repo path (1.B):')
await t('every agent is told the target repo root', async () => {
  const { calls } = await run({ preset: 'supabase', repoRoot: '/abs/target-app' })
  for (const c of calls) assert.ok(c.prompt.includes('/abs/target-app'), `${c.label} not told the repo root`)
})

console.log('completeness critic loops until dry (1.C):')
await t('a non-dry critic triggers a gap round and a second critic', async () => {
  let n = 0
  const { calls, result } = await run({ preset: 'supabase' }, {
    critic: () => (++n === 1 ? { dry: false, uncovered: [{ surface: 'table invoices as outsider', why: 'not probed', suggested_probe: 'SELECT as outsider' }] } : { dry: true, uncovered: [] }),
  })
  assert.ok(calls.some((c) => c.label.startsWith('gap')), 'no gap-closing agent ran')
  assert.equal(calls.filter((c) => c.label.startsWith('critic')).length, 2)
  assert.ok(calls.find((c) => c.label.startsWith('gap')).prompt.includes('table invoices as outsider'))
  assert.equal(result.critic_rounds, 2)
})
await t('the loop is bounded and logs what remains', async () => {
  let n = 0
  const { calls, result, logs } = await run({ preset: 'supabase' }, {
    critic: () => { if (++n > 8) throw new Error('critic loop unbounded'); return { dry: false, uncovered: [{ surface: 'forever', why: 'x', suggested_probe: 'y' }] } },
  })
  assert.equal(result.critic_rounds, 3)
  const rounds = calls.filter((c) => c.label.startsWith('critic')).length
  assert.ok(rounds >= 2 && rounds <= 4, `critic ran ${rounds} times`)
  assert.ok(result.critic && result.critic.dry === false)
  assert.ok(logs.some((l) => /not dry|remain/i.test(l)), 'no log about remaining gaps')
})
await t('findings from a gap round are verified and reported', async () => {
  let n = 0
  const { calls } = await run({ preset: 'supabase' }, {
    critic: () => (++n === 1 ? { dry: false, uncovered: [{ surface: 's', why: 'w', suggested_probe: 'p' }] } : { dry: true, uncovered: [] }),
    gap: { stack_status: 'up', degraded: false, probes: [], findings: [{ title: 'GAP-FINDING', severity: 'high', family: 'gapfam', file: 'g.ts', line: 2, description: 'd', wrong_actor_scenario: 'w', guard_checked: 'g', probe_hint: 'p' }] },
  })
  assert.ok(calls.some((c) => c.label.startsWith('verify:') && c.prompt.includes('GAP-FINDING')), 'gap finding not verified')
})

await t('gap-round results land in the result: finding, probes, and its family gets swept', async () => {
  let n = 0
  const gapProbe = { name: 'outsider reads invoices', kind: 'gap_real', actor: 'outsider', action: 'a', expected: 'refused', observed: 'landed', direct_select_evidence: 'e', passed: false, relates_to: 'GAP-FINDING' }
  const { result, calls } = await run({ preset: 'supabase' }, {
    critic: () => (++n === 1 ? { dry: false, uncovered: [{ surface: 's', why: 'w', suggested_probe: 'p' }] } : { dry: true, uncovered: [] }),
    gap: { stack_status: 'up', degraded: false, probes: [gapProbe], findings: [{ title: 'GAP-FINDING', severity: 'high', family: 'gapfam', file: 'g.ts', line: 2, description: 'd', wrong_actor_scenario: 'w', guard_checked: 'g', probe_hint: 'p' }] },
  })
  assert.ok(result.confirmed_strong.some((v) => v.title === 'GAP-FINDING'), 'gap finding not in the result')
  assert.ok(result.probes.some((p) => p.name === 'outsider reads invoices'), 'gap probe not in result.probes')
  assert.ok(result.modalities.families_swept.includes('gapfam'), 'gap family never swept')
  assert.ok(calls.some((c) => c.label.startsWith('sweep:gapfam')))
})
await t('a prover-only failing probe becomes an empirical-only finding', async () => {
  const { result } = await run({ preset: 'supabase' }, {
    prover: { stack_status: 'up', degraded: false, probes: [{ name: 'anon deletes notes', kind: 'gap_real', actor: 'anon', action: 'a', expected: 'refused', observed: 'landed', direct_select_evidence: 'e', passed: false, relates_to: 'nothing' }] },
  })
  assert.ok(result.confirmed_weak.some((v) => v.title === 'anon deletes notes' && v.family === 'empirical-only'))
})
// Incident wf_7418b0da: re-sweeping families that sweep SIBLINGS coin never converges — every
// verifier writes a new free-text variant. Only first-pass verdicts (static lenses, prover,
// critic gap rounds) seed a sweep; a sibling's family is reported, never swept.
// 1.G2 (2026-09-24): a failing happy_path_step with no matching candidate was kept only in
// result.probes and never reached a finding list, so a broken user flow could go unreported.
await t('a prover-only failing happy-path step becomes a functional-only finding (never swept)', async () => {
  const { result, calls } = await run({ preset: 'supabase' }, {
    prover: { stack_status: 'up', degraded: false, probes: [{ name: 'HP3 admin invites a member', kind: 'happy_path_step', actor: 'legitimate', action: 'a', expected: 'allowed', observed: 'refused', direct_select_evidence: 'count=0', passed: false, relates_to: 'nothing' }] },
  })
  const f = result.confirmed_weak.find((v) => v.title === 'HP3 admin invites a member')
  assert.ok(f, 'failing happy-path step is missing from the findings')
  assert.deepEqual(f.modalities, ['functional'])
  assert.equal(f.family, 'functional-only')
  assert.ok(!calls.some((c) => c.label.startsWith('sweep:functional')), 'a functional-only finding was swept')
})
await t('a passing happy-path step is not a finding', async () => {
  const { result } = await run({ preset: 'supabase' }, {
    prover: { stack_status: 'up', degraded: false, probes: [{ name: 'HP1 ok', kind: 'happy_path_step', actor: 'legitimate', action: 'a', expected: 'e', observed: 'o', direct_select_evidence: 'd', passed: true, relates_to: 'x' }] },
  })
  assert.ok(![...result.confirmed_strong, ...result.confirmed_weak].some((v) => v.title === 'HP1 ok'))
})
await t('a family first named by a sweep sibling is NOT swept again (incident wf_7418b0da)', async () => {
  const { result, calls } = await run({ preset: 'supabase' }, {
    'sweep:fam-authz': { family: 'fam-authz', siblings: [{ title: 'SIB', severity: 'high', family: 'NEWFAM', file: 's.ts', line: 1, description: 'd', wrong_actor_scenario: 'w', guard_checked: 'g', probe_hint: 'p' }] },
  })
  assert.ok(result.confirmed_strong.some((v) => v.title === 'SIB'), 'the sibling itself must still be verified + reported')
  assert.ok(!result.modalities.families_swept.includes('newfam'), 'a sibling-invented family was swept')
  assert.ok(!calls.some((c) => /^sweep:newfam/i.test(c.label)), 'a sibling-invented family was swept')
  assert.equal(calls.filter((c) => c.label === 'sweep:fam-authz').length, 1, 'a family was swept twice')
})
await t('families that differ only by a parenthetical are swept once', async () => {
  const { result, calls } = await run({ preset: 'supabase' }, {
    'static:': (call) => ({ lens: call.label.slice(7), findings: [{ title: `F ${call.label}`, severity: 'high', family: `stale-ownership (${call.label} arm)`, file: 'a.ts', line: 1, description: 'd', wrong_actor_scenario: 'w', guard_checked: 'g', probe_hint: 'p' }] }),
  })
  assert.equal(calls.filter((c) => c.label.startsWith('sweep:')).length, 1, 'parenthetical variants were swept separately')
  assert.deepEqual(result.modalities.families_swept, ['stale-ownership'])
})
// The RED test for the incident: every verifier coins a NEW family, every sweep returns 400
// siblings (enough to fill the budget even with batched sibling verification), the critic is never dry and each gap round brings new findings. Before the fix this
// fans out without bound (the throw guard stands in for the runtime's 1000 cap).
function runaway(cfg) {
  const guard = (calls) => { if (calls.length > 3000) throw new Error('UNBOUNDED fan-out: >3000 agents') }
  const finding = (title, family, severity = 'high') => ({ title, severity, family, file: `${title}.ts`, line: 1, description: 'd', wrong_actor_scenario: 'w', guard_checked: 'g', probe_hint: 'p' })
  return run({ preset: 'supabase', ...cfg }, {
    'verify:': (call, calls) => {
      guard(calls)
      const m = call.prompt.match(/CANDIDATE:\n([\s\S]*?)\n\nRELATED PROVER PROBES/)
      const c = JSON.parse(m[1])
      return { title: c.title, confirmed: true, confidence: 8, corrected_severity: c.severity || 'high', family: `invented-${calls.length}`, modalities: ['static', 'empirical'], reason: 'r', file: c.file, line: 1, fix: 'f' }
    },
    'verify-batch:': (call, calls) => {
      guard(calls)
      const cs = JSON.parse(call.prompt.match(/CANDIDATES:\n([\s\S]*?)\n\nRELATED PROVER PROBES/)[1])
      return { verdicts: cs.map((c, i) => ({ title: c.title, confirmed: true, confidence: 8, corrected_severity: c.severity || 'high', family: `invented-${calls.length}-${i}`, modalities: ['static', 'empirical'], reason: 'r', file: c.file, line: 1, fix: 'f' })) }
    },
    'sweep:': (call, calls) => { guard(calls); return { family: 'x', siblings: Array.from({ length: 400 }, (_, i) => finding(`sib-${calls.length}-${i}`, `sibfam-${calls.length}-${i}`, i % 2 ? 'low' : 'high')) } },
    critic: (call, calls) => { guard(calls); return { dry: false, uncovered: [{ surface: `s${calls.length}`, why: 'w', suggested_probe: 'p' }] } },
    gap: (call, calls) => { guard(calls); return { stack_status: 'up', degraded: false, probes: [], findings: Array.from({ length: 5 }, (_, i) => finding(`gap-${calls.length}-${i}`, `gapfam-${calls.length}-${i}`)) } },
  })
}
await t('runaway families stay under the default agent budget, and the drops are reported', async () => {
  const { calls, result, logs } = await runaway({})
  assert.ok(calls.length <= 400, `${calls.length} agents — over the default total budget of 400`)
  const byPhase = {}
  for (const c of calls) byPhase[c.phase] = (byPhase[c.phase] || 0) + 1
  for (const [p, n] of Object.entries(byPhase)) assert.ok(n <= 120, `stage ${p} ran ${n} agents (cap 120)`)
  assert.ok(result.budget && result.budget.dropped > 0, 'result does not report dropped agents')
  assert.deepEqual(result.budget.per_stage, byPhase, 'result.budget.per_stage disagrees with the agents actually run')
  assert.ok(logs.some((l) => /budget/i.test(l) && /drop/i.test(l)), 'drops were not logged')
})
await t('cfg.maxAgents / maxAgentsTotal tighten the budget', async () => {
  const { calls, result } = await runaway({ maxAgents: 15, maxAgentsTotal: 50 })
  assert.ok(calls.length <= 50, `${calls.length} agents with maxAgentsTotal 50`)
  const sweepStage = calls.filter((c) => c.phase === 'Sweep').length
  assert.ok(sweepStage <= 15, `Sweep stage ran ${sweepStage} (cap 15)`)
  assert.equal(result.budget.caps.per_stage, 15)
})
await t('under the cap, higher-severity siblings are verified before lower ones', async () => {
  const { calls } = await runaway({ maxAgents: 15 })
  const batches = calls.filter((c) => c.phase === 'Sweep' && c.label.startsWith('verify-batch:'))
  assert.ok(batches.length > 0)
  for (const c of batches) assert.ok(!/"severity": "low"/.test(c.prompt), `a low sibling was verified while highs were dropped: ${c.label}`)
})
await t('a critic round dropped by the budget keeps the last uncovered list (never overwritten by null)', async () => {
  // Critic stage cap 2: critic r1 + gap r1 fill it, so critic r2 is dropped by the budget.
  const { result, logs } = await run({ preset: 'supabase', maxAgents: 2 }, {
    critic: { dry: false, uncovered: [{ surface: 'invoices as outsider', why: 'w', suggested_probe: 'p' }] },
  })
  assert.ok(result.critic && result.critic.uncovered.some((u) => u.surface === 'invoices as outsider'), 'last uncovered list lost when the next critic was dropped')
  assert.equal(result.critic_rounds, 1, 'a dropped critic round was counted as run')
  assert.ok(logs.some((l) => /critic round 2/.test(l) && /budget|no answer/i.test(l)), 'the dropped round was not logged')
})
await t('the same sibling returned by two sweeps is verified once', async () => {
  const dup = { title: 'DUP', severity: 'high', family: 'z', file: 'd.ts', line: 3, description: 'd', wrong_actor_scenario: 'w', guard_checked: 'g', probe_hint: 'p' }
  const { calls } = await run({ preset: 'supabase' }, { 'sweep:': { family: 'x', siblings: [dup, { ...dup, title: 'dup ' }] } })
  const withDup = calls.filter((c) => c.label.startsWith('verify-batch:') && c.prompt.includes('"d.ts"'))
  assert.equal(withDup.length, 1, 'duplicate sibling verified in two batches')
  assert.equal((withDup[0].prompt.match(/"d\.ts"/g) || []).length, 1, 'duplicate sibling listed twice in one batch')
})
// W4.3(b), 2026-09-26: one verifier per sibling was the biggest Sweep cost (1.G2: 89 agents).
// Siblings of one family are now verified together, in batches of cfg.siblingBatchSize (default 8).
const sib = (title, severity = 'high', file = `${title}.ts`) => ({ title, severity, family: 'z', file, line: 1, description: 'd', wrong_actor_scenario: 'w', guard_checked: 'g', probe_hint: 'p' })
await t('the siblings of one family are verified by ONE batch agent, each gets its own verdict', async () => {
  const { calls, result } = await run({ preset: 'supabase' }, { 'sweep:fam-authz': { family: 'fam-authz', siblings: ['S1', 'S2', 'S3', 'S4', 'S5'].map((t) => sib(t)) } })
  const batches = calls.filter((c) => c.label.startsWith('verify-batch:fam-authz'))
  assert.equal(batches.length, 1, `${batches.length} batch agents for 5 siblings`)
  assert.equal(calls.filter((c) => c.phase === 'Sweep' && c.label.startsWith('verify:')).length, 0, 'a sibling still got its own verifier')
  for (const t of ['S1', 'S2', 'S3', 'S4', 'S5']) assert.ok(result.confirmed_strong.some((v) => v.title === t), `${t} missing from the result`)
  assert.ok(/ADVERSARIAL VERIFY/.test(batches[0].prompt) && /EACH candidate/.test(batches[0].prompt), 'batch prompt lost the adversarial per-candidate instruction')
})
await t('a family with more siblings than siblingBatchSize is split into several batches', async () => {
  const { calls } = await run({ preset: 'supabase', siblingBatchSize: 4 }, { 'sweep:fam-authz': { family: 'fam-authz', siblings: Array.from({ length: 10 }, (_, i) => sib(`S${i}`)) } })
  assert.equal(calls.filter((c) => c.label.startsWith('verify-batch:fam-authz')).length, 3)
})
await t('an invalid siblingBatchSize falls back to 8, never to one agent per sibling or to no batching', async () => {
  for (const bad of [0, -1, 'x', null, '', true]) {
    const { calls } = await run({ preset: 'supabase', siblingBatchSize: bad }, { 'sweep:fam-authz': { family: 'fam-authz', siblings: Array.from({ length: 9 }, (_, i) => sib(`S${i}`)) } })
    assert.equal(calls.filter((c) => c.label.startsWith('verify-batch:fam-authz')).length, 2, `siblingBatchSize ${JSON.stringify(bad)}`)
  }
})
await t('a sibling the batch verifier leaves out is reported unverified, never silently lost', async () => {
  const { result, logs } = await run({ preset: 'supabase' }, {
    'sweep:fam-authz': { family: 'fam-authz', siblings: [sib('KEEP'), sib('LOST')] },
    'verify-batch:': { verdicts: [{ title: 'KEEP', confirmed: true, confidence: 8, corrected_severity: 'high', family: 'z', modalities: ['static', 'empirical'], reason: 'r', file: 'KEEP.ts', line: 1, fix: 'f' }] },
  })
  assert.ok(result.budget.unverified_siblings.some((u) => u.title === 'LOST'), 'omitted sibling not reported')
  assert.ok(logs.some((l) => /LOST|without a verdict/.test(l)), 'omission not logged')
})
await t('a verdict whose title matches no candidate in the batch is ignored', async () => {
  const { result } = await run({ preset: 'supabase' }, {
    'sweep:fam-authz': { family: 'fam-authz', siblings: [sib('REAL')] },
    'verify-batch:': { verdicts: [{ title: 'INVENTED', confirmed: true, confidence: 9, corrected_severity: 'critical', family: 'z', modalities: ['static', 'empirical'], reason: 'r', file: 'x', line: 1, fix: 'f' }] },
  })
  assert.ok(![...result.confirmed_strong, ...result.confirmed_weak].some((v) => v.title === 'INVENTED'), 'an invented verdict reached the result')
  assert.ok(result.budget.unverified_siblings.some((u) => u.title === 'REAL'))
})
// 2026-09-27: each view finds holes the other misses (runs wf_8dc0eb72 full vs wf_f837c270
// compact: app-tier strong findings 1 vs 10, highs 14 vs 9). Default = both views at the static stage.
const LONGP = 'y'.repeat(400)
const INV2 = { secdef_funcs: [{ name: 'fn_x', args: '', anon_exec: true, authed_exec: true, note: '' }], policies: [{ table: 'tbl_x', cmd: 'UPDATE', using: LONGP, with_check: '', flag: 'USING-only' }], zero_policy_tables: [], secret_columns: [], units: [], catalog_counts: { privileged_units: 1, policies: 1 } }
await t('default: every static lens runs twice, once per inventory view', async () => {
  const { calls, result } = await run({ preset: 'supabase' }, { inventory: INV2 })
  const st = calls.filter((c) => c.phase === 'Static')
  const lenses = REGISTRY.supabase.lenses.length
  assert.equal(st.length, 2 * lenses, `${st.length} static agents for ${lenses} lenses`)
  assert.equal(st.filter((c) => c.prompt.includes(LONGP)).length, lenses, 'full-view pass missing')
  assert.equal(st.filter((c) => c.label.endsWith(':compact') && !c.prompt.includes(LONGP) && c.prompt.includes('tbl_x')).length, lenses, 'compact-view pass missing')
  assert.equal(result.inventory_summary.mode, 'both')
})
await t('default: prover and sweep get the full view', async () => {
  const { calls } = await run({ preset: 'supabase' }, { inventory: INV2 })
  for (const c of calls.filter((c) => /^(prover|sweep:)/.test(c.label))) assert.ok(c.prompt.includes(LONGP), `${c.label} lacks the full view`)
})
await t('inventoryMode full / compact run a single static pass in that view', async () => {
  const lenses = REGISTRY.supabase.lenses.length
  const f = await run({ preset: 'supabase', inventoryMode: 'full' }, { inventory: INV2 })
  assert.equal(f.calls.filter((c) => c.phase === 'Static').length, lenses)
  assert.ok(f.calls.find((c) => c.label.startsWith('static:')).prompt.includes(LONGP))
  const c = await run({ preset: 'supabase', inventoryMode: 'compact' }, { inventory: INV2 })
  const st = c.calls.filter((x) => x.phase === 'Static')
  assert.equal(st.length, lenses)
  for (const x of c.calls.filter((x) => /^(static:|prover|sweep:)/.test(x.label))) {
    assert.ok(x.prompt.includes('fn_x') && x.prompt.includes('tbl_x'), `${x.label} lost an inventory item`)
    assert.ok(!x.prompt.includes(LONGP), `${x.label} still carries the full text`)
  }
  assert.equal(c.result.inventory_summary.mode, 'compact')
})
await t('the same candidate from both passes is verified once; distinct ones are kept', async () => {
  const same = { title: 'Dup hole', severity: 'high', family: 'using-only-update (arm a)', file: 'm.sql', line: 7, description: 'd', wrong_actor_scenario: 'w', guard_checked: 'g', probe_hint: 'p' }
  const { calls } = await run({ preset: 'supabase' }, {
    'static:': (call) => ({ lens: call.label.slice(7), findings: call.label === 'static:authz' ? [same] : call.label === 'static:authz:compact' ? [{ ...same, title: 'Same hole, other words', family: 'USING-only-UPDATE (arm b)' }, { ...same, title: 'Other hole', line: 99 }] : [] }),
  })
  const v = calls.filter((c) => c.phase === 'Verify' && c.label.startsWith('verify:'))
  assert.equal(v.filter((c) => c.prompt.includes('"line": 7')).length, 1, 'duplicate candidate (same file, line, family key) verified twice')
  assert.equal(v.filter((c) => c.prompt.includes('"line": 99')).length, 1, 'a distinct candidate was merged away')
})
await t('a budget/agent throw inside the critic loop still returns everything verified so far', async () => {
  let n = 0
  const { result, logs } = await run({ preset: 'supabase' }, {
    critic: () => { if (++n === 1) return { dry: false, uncovered: [{ surface: 's', why: 'w', suggested_probe: 'p' }] }; throw new Error('budget exhausted') },
  })
  assert.ok(result && result.confirmed_strong.length >= 1, 'verdicts lost on a late throw')
  assert.ok(logs.some((l) => /budget exhausted/i.test(l)), 'the failure was not logged')
})
await t('a throw in the inventory retry keeps the first dump and flags it truncated', async () => {
  let n = 0
  const short = { secdef_funcs: [], policies: [], zero_policy_tables: [], secret_columns: [], catalog_counts: { privileged_units: 5, policies: 3 } }
  const { result } = await run({ preset: 'supabase' }, { inventory: () => { if (++n === 2) throw new Error('budget exhausted'); return short } })
  assert.equal(result.inventory_summary.truncated, true)
})
await t('a null critic / null gap round is logged, never silent', async () => {
  let n = 0
  const r1 = await run({ preset: 'supabase' }, { critic: null })
  assert.ok(r1.logs.some((l) => /critic.*no answer/i.test(l)))
  const r2 = await run({ preset: 'supabase' }, {
    critic: () => (++n === 1 ? { dry: false, uncovered: [{ surface: 's', why: 'w', suggested_probe: 'p' }] } : { dry: true, uncovered: [] }),
    gap: null,
  })
  assert.ok(r2.logs.some((l) => /gap.*no answer/i.test(l)))
})
await t('maxCriticRounds: 0 is honoured as "critic once, no gap round" (not silently 3)', async () => {
  const { result, calls } = await run({ preset: 'supabase', maxCriticRounds: 0 }, { critic: { dry: false, uncovered: [{ surface: 's', why: 'w', suggested_probe: 'p' }] } })
  assert.equal(result.critic_rounds, 1)
  assert.ok(!calls.some((c) => c.label.startsWith('gap')))
})
await t('an invalid cfg.lenses entry is dropped, never sent as "undefined"', async () => {
  const { calls } = await run({ preset: 'supabase', lenses: ['authz', { key: 'ok', prompt: 'OK lens' }] })
  assert.ok(!calls.some((c) => c.label === 'static:undefined'))
  assert.ok(calls.some((c) => c.label === 'static:ok'))
})
await t('a truncated inventory is announced to the static reviewers and the prover too', async () => {
  const short = { secdef_funcs: [], policies: [], zero_policy_tables: [], secret_columns: [], catalog_counts: { privileged_units: 5, policies: 3 } }
  const { calls } = await run({ preset: 'supabase' }, { inventory: short })
  for (const c of calls.filter((c) => c.label.startsWith('static:') || c.label === 'prover-3actor')) assert.ok(/TRUNCATED/.test(c.prompt), `${c.label} not told the inventory is truncated`)
})
await t('an app-tier inventory with an empty secdef_funcs[] still counts its units', async () => {
  const inv = { secdef_funcs: [], units: [{ name: 'a', guard: 'none', reachable_by_wrong_actor: true }, { name: 'b', guard: 'auth', reachable_by_wrong_actor: false }], catalog_counts: { privileged_units: 2, policies: 0 } }
  const { result } = await runWorkflow(DIST, { args: { cfg: {} }, respond: cannedResponder({ 'runtime-detect': { preset: 'generic', why: 'x' }, inventory: inv }) })
  assert.equal(result.inventory_summary.privileged_units, 2)
  assert.equal(result.inventory_summary.truncated, false)
  assert.equal(result.inventory_summary.wrong_actor_reachable, 1)
})
await t('an inline config adapter with a registry id means "preset + tweaks"', () => {
  const { adapter } = resolveAdapter({ adapter: { id: 'supabase', db: 'MY-CUSTOM-DB' } }, REGISTRY)
  assert.equal(adapter.db, 'MY-CUSTOM-DB')
  assert.equal(adapter.scopeUnits, REGISTRY.supabase.scopeUnits, 'did not inherit the supabase preset')
  assert.equal(adapter.guardExamples, REGISTRY.supabase.guardExamples)
})
await t('stack instruction fields can be overridden from config (credentialsHint, guardExamples, …)', () => {
  const { adapter } = resolveAdapter({ preset: 'express', credentialsHint: 'CREDS', guardExamples: 'GUARDS', inventoryExecution: 'EXEC', proverTargets: 'TARGETS', scopeUnits: 'UNITS' }, REGISTRY)
  for (const [k, v] of Object.entries({ credentialsHint: 'CREDS', guardExamples: 'GUARDS', inventoryExecution: 'EXEC', proverTargets: 'TARGETS', scopeUnits: 'UNITS' })) assert.equal(adapter[k], v, k)
})
await t('an appended project db note is followed by the local-only reminder (project text cannot have the last word)', () => {
  const { adapter } = resolveAdapter({ preset: 'supabase', db: 'use the key in .env' }, REGISTRY)
  const tail = adapter.db.slice(adapter.db.indexOf('use the key in .env'))
  assert.ok(/local\/disposable/i.test(tail), 'no safety reminder after the project db text')
})

console.log('inventory completeness against the live catalog count (1.D):')
await t('a short dump is retried once', async () => {
  let n = 0
  const short = { secdef_funcs: [], policies: [{ table: 't', cmd: 'SELECT', using: 'true', with_check: '', flag: '' }], zero_policy_tables: [], secret_columns: [], catalog_counts: { privileged_units: 0, policies: 3 } }
  const full = { ...short, policies: [1, 2, 3].map((i) => ({ table: 't' + i, cmd: 'SELECT', using: 'true', with_check: '', flag: '' })) }
  const { calls, result } = await run({ preset: 'supabase' }, { inventory: () => (++n === 1 ? short : full) })
  assert.equal(calls.filter((c) => c.label.startsWith('inventory')).length, 2)
  assert.ok(calls.filter((c) => c.label.startsWith('inventory'))[1].prompt.includes('1 of 3'), 'retry prompt does not state the shortfall')
  assert.equal(result.inventory_summary.policies, 3)
  assert.equal(result.inventory_summary.truncated, false)
})
await t('a dump that stays short is flagged truncated, not silently accepted', async () => {
  const short = { secdef_funcs: [], policies: [], zero_policy_tables: [], secret_columns: [], catalog_counts: { privileged_units: 5, policies: 3 } }
  const { result, logs } = await run({ preset: 'supabase' }, { inventory: short })
  assert.equal(result.inventory_summary.truncated, true)
  assert.ok(logs.some((l) => /truncat/i.test(l)))
})
await t('the Postgres inventory schema requires catalog_counts', () => {
  const { adapter } = resolveAdapter({ preset: 'supabase' }, REGISTRY)
  assert.ok(adapter.inventorySchema.required.includes('catalog_counts'))
})

console.log('supabase recipe does not assume a host psql (1.E):')
await t('db recipe names a psql fallback when psql is not installed', () => {
  assert.ok(/docker exec/.test(REGISTRY.supabase.db), 'no docker-exec fallback')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
