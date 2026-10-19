// livefire ⟷ verify-feature PROMPT PARITY (W1, deterministic half). `node test/parity.test.mjs`
//
// Runs verify-feature's own harness (vendored at test/fixtures/, byte-for-byte from
// ~/.claude/skills/verify-feature/assets/harness.workflow.js) and livefire's assembled workflow
// under the SAME stub runtime, the SAME canned agent answers and the SAME project context
// (the shape of verify-feature's real launches: repoContext + db + actors + testCmd).
// Then, stage by stage, every instruction sentence verify-feature sends must also be sent by
// livefire. A sentence livefire drops is a parity bug unless it is listed in INTENTIONAL with the
// reason and the livefire sentence that replaces it. Livefire may ADD instructions (safety,
// execution robustness, critic loop); it may not silently LOSE one.
//
// `--diff` prints every missing sentence instead of asserting.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorkflow, cannedResponder } from './runtime-stub.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
execFileSync('node', [join(ROOT, 'skills/livefire/build.mjs')], { stdio: 'ignore' })
const LF = await readFile(join(ROOT, 'skills/livefire/dist/livefire.workflow.js'), 'utf8')
const VF = await readFile(join(ROOT, 'test/fixtures/verify-feature.harness.workflow.js'), 'utf8')

// Project context in the shape verify-feature's controller passes on a real app.
const PROJECT = {
  repoContext: 'Example — multi-tenant B2B app. TENANCY: orgs + memberships(role owner|admin|member).',
  db: 'Live local Supabase is UP. Ground truth: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "<SQL>".',
  actors: 'ANON: apikey=ANON_KEY no session. OUTSIDER + INSIDER: create users via the admin API, signInWithPassword.',
  testCmd: 'npx vitest run',
  securityPass: true,
  range: 'main...HEAD',
  // verify-feature has one inventory view; compare livefire in the same single view. The default
  // (both views) only ADDS a compact static pass and its candidates: covered in pipeline.test.mjs.
  inventoryMode: 'full',
}

// Canned answers shared by both runs: one static finding per lens, a failing probe, a confirmed
// verdict (→ one family to sweep), a dry critic.
const respond = () => cannedResponder({
  prover: { stack_status: 'up', degraded: false, probes: [{ name: 'anon can call f', kind: 'gap_real', actor: 'anon', action: 'rpc f', expected: 'refused', observed: 'landed', direct_select_evidence: 'row present', passed: false, relates_to: 'finding from static:authz' }] },
})

const vf = await runWorkflow(VF, { args: { cfg: PROJECT }, respond: respond() })
const lf = await runWorkflow(LF, { args: { cfg: { preset: 'supabase', ...PROJECT } }, respond: respond() })

// Whitespace-normalised only. Both runs get the SAME canned answers, so every run-specific count
// is identical in both prompts and compares verbatim (no digit masking: "all 3 actors" must stay 3).
const norm = (s) => s.replace(/\s+/g, ' ').trim()
const sentences = (p) => norm(p).split(/(?<=[.;!?])\s+(?=[A-Z0-9(⚠•"'`\-])|\s(?=\d\.\s)|\s(?=\([a-e]\)\s)/).map((x) => x.trim()).filter((x) => x.length >= 6)
// Stage key: the label with lf's round suffix / retry suffix removed.
const stageKey = (label) => label.replace(/^critic:r\d+$/, 'critic').replace(/^inventory:retry$/, 'inventory')

// Deliberate rewordings: exact substring substitutions applied to a verify-feature sentence
// before it is looked up VERBATIM in livefire's prompt. Stricter than an allowlist of whole
// sentences: everything outside the substituted fragment must still match word for word.
const INTENTIONAL = [
  { from: 'Dump the live catalog:', to: 'Dump the live authz model:', why: 'stack-neutral header; the Postgres SQL that follows is identical' },
  { from: 'return structured results:', to: 'return structured results (run each query STANDALONE / autocommit', why: 'autocommit execution note (bfc3bf1: a shared transaction truncated the dump)' },
  { from: 'Plant fixtures with the service-role client, run, confirm EVERY write with a direct service-role SELECT (the evidence text)', to: 'Plant fixtures with the admin client, run, confirm EVERY write with a direct ground-truth read that bypasses the app\'s authz (the evidence text)', why: 'neutral core wording; the supabase preset db/actors text binds admin = service-role' },
  { from: 'Sweep EVERY function/table/policy', to: 'Sweep EVERY unit/table/policy', why: 'unit = function for Postgres, route/handler for app-tier stacks' },
  { from: '(tokens, raw payloads, refresh tokens)', to: '(tokens, raw payloads, refresh tokens, oauth secrets, private free-text fields)', why: 'superset of secret-column examples (5e36c3c equivalence fix)' },
  { from: "and that table's SELECT policy breadth.", to: "and that table's SELECT policy breadth;", why: 'list continues with (e) catalog_counts' },
  { from: 'COMPLETENESS CRITIC.', to: 'COMPLETENESS CRITIC (round 1).', why: 'critic loop round number' },
  { from: 'secdef funcs, ', to: 'privileged units, ', why: 'unit = function for Postgres' },
  { from: "a function whose grants weren't probed", to: "a unit whose access wasn't probed", why: 'unit = function for Postgres' },
]
const rewrite = (s) => INTENTIONAL.reduce((acc, r) => acc.split(r.from).join(r.to), s)

function missingFor(stage, vfPrompt, lfPrompt) {
  const lfN = norm(lfPrompt)
  return sentences(vfPrompt).filter((s) => !lfN.includes(s) && !lfN.includes(norm(rewrite(s))))
}

const byStage = (calls) => {
  const m = new Map()
  for (const c of calls) {
    const k = stageKey(c.label)
    if (!m.has(k)) m.set(k, c.prompt) // first call per stage (retries/rounds compared separately)
  }
  return m
}
const V = byStage(vf.calls)
const L = byStage(lf.calls)

let pass = 0, fail = 0
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`) }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) }
}

const DIFF = process.argv.includes('--diff')
console.log('verify-feature ⟷ livefire, stage by stage:')
for (const [stage, vfPrompt] of V) {
  await t(`${stage}: livefire sends every verify-feature instruction`, () => {
    assert.ok(L.has(stage), `livefire never runs stage "${stage}"`)
    const missing = missingFor(stage, vfPrompt, L.get(stage))
    if (DIFF && missing.length) console.log(`\n--- ${stage} — ${missing.length} missing:\n` + missing.map((s) => '  · ' + s).join('\n'))
    assert.deepEqual(missing, [], `${missing.length} verify-feature sentence(s) missing from livefire's ${stage} prompt:\n        ${missing.slice(0, 5).join('\n        ')}`)
  })
}
await t('both harnesses run the same stages', () => {
  const vfStages = [...V.keys()].sort()
  const lfStages = [...L.keys()].filter((k) => !/^gap/.test(k)).sort()
  assert.deepEqual(lfStages, vfStages)
})
await t('schemas are identical for the shared stages (livefire may add fields, never drop required ones)', () => {
  const first = (calls, k) => calls.find((c) => stageKey(c.label) === k)
  for (const k of V.keys()) {
    const vs = first(vf.calls, k).schema, ls = first(lf.calls, k).schema
    for (const r of (vs.required || [])) assert.ok((ls.required || []).includes(r), `${k}: livefire schema dropped required "${r}"`)
    for (const p of Object.keys(vs.properties || {})) assert.ok(ls.properties && ls.properties[p], `${k}: livefire schema dropped property "${p}"`)
  }
})
await t('every INTENTIONAL rewording is still in use (no stale entries)', () => {
  const allVf = [...V.values()].join(' ')
  for (const r of INTENTIONAL) assert.ok(norm(allVf).includes(r.from), `INTENTIONAL entry no longer matches verify-feature: "${r.from}"`)
})
await t('summary counters: livefire reports every verify-feature inventory_summary field (renamed where stack-neutral)', () => {
  const RENAMED = { secdef_funcs: 'privileged_units', anon_reachable_secdef: 'wrong_actor_reachable', secret_columns: 'secret_surfaces' }
  for (const k of Object.keys(vf.result.inventory_summary)) {
    const lk = RENAMED[k] || k
    assert.ok(lk in lf.result.inventory_summary, `livefire result lacks ${lk} (verify-feature ${k})`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
