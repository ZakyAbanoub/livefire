// livefire — the stack-agnostic pipeline. Reads ONLY the resolved VerifyAdapter (src/adapter.js)
// — no Postgres/Supabase/stack name appears below. Presets supply the two stack-specific pieces
// (authz inventory + three-actor recipe); this file is the method.
//
// Pipeline: mechanical inventory (dump the live authz model) → static fan-out over the WHOLE
// surface → empirical prover (3-actor matrix, direct ground-truth read) → adversarial +
// cross-modal → root-cause family sweep → completeness critic. RED-first tests are emitted by
// the controller after reading this workflow's result.
//
// The six load-bearing rules (see SKILL.md): whole-surface not diff · run it not read it ·
// 3-actor matrix · enumerate live grants+policies · recently-hardened = priority re-audit ·
// sweep by root-cause family.
//
// ⚠️  COST: fans out to many subagents that each read real source (+ the prover runs live).
//     No fixed number — cost scales with the codebase. Whole-surface on a large repo is
//     expensive; feature/diff is far cheaper. See README "Token cost".

import { resolveAdapter, parseWorkflowCfg } from './adapter.js'
import { proverRules } from './prover-rules.js'
import { canonFamily, makeAgentBudget, parseAgentCaps } from './budget.js'
import { renderInventory, parseInventoryMode } from './inventory-view.js'
import { REGISTRY } from '../presets/index.js'

//#META-START (build.mjs keeps this block's `export` and hoists it to the top of the assembled file)
export const meta = {
  name: 'livefire',
  description: 'Security/feature verification: live authz-model inventory → static lenses → 3-actor live-DB prover → adversarial cross-modal → root-cause family sweep. Stack-agnostic via presets.',
  phases: [
    { title: 'Inventory', detail: 'dump the live authz model (grants/policies or route->guard map) + secret surfaces' },
    { title: 'Static', detail: 'one reviewer per lens over the whole reachable surface' },
    { title: 'Prove', detail: 'live 3-actor matrix (anon/outsider/wrong-role), direct ground-truth read' },
    { title: 'Verify', detail: 'refute each candidate + cross-modal confirm' },
    { title: 'Sweep', detail: 'root-cause family sweep across every unit' },
    { title: 'Critic', detail: 'what was not covered' },
  ],
}
//#META-END

//#BODY-START (everything below is emitted after the inlined adapter in the build)
// ─────────────────────────── CONFIG (from Workflow `args.cfg`) ───────────────────────────
// Parse defensively: the Workflow tool can deliver args/cfg as a STRINGIFIED JSON, which used
// to make `args.cfg` a string → CFG={} → cfg.preset dropped → blind generic run. (root-cause A)
const CFG = parseWorkflowCfg(args)
const RANGE = CFG.range || 'main...HEAD'
const SECURITY_PASS = CFG.securityPass !== false // true → whole surface; false → diff-focused feature pass
// Agents run in the SESSION's working directory, which is not necessarily the repo under audit
// (e.g. livefire launched from another checkout). The controller passes the absolute target root.
const REPO_ROOT = typeof CFG.repoRoot === 'string' && CFG.repoRoot.trim() ? CFG.repoRoot.trim() : null
// 1..4 critic rounds; 0 (or 1) = critic once, no gap round. Absent/invalid → 3.
const MAX_CRITIC_ROUNDS = Number.isFinite(Number(CFG.maxCriticRounds)) && CFG.maxCriticRounds !== null && CFG.maxCriticRounds !== '' ? Math.max(1, Math.min(4, Math.floor(Number(CFG.maxCriticRounds)))) : 3
// Sweep siblings of one family are verified together, this many per agent (1..20). Absent/invalid → 8.
const SIBLING_BATCH = typeof CFG.siblingBatchSize !== 'boolean' && Number.isFinite(Number(CFG.siblingBatchSize)) && CFG.siblingBatchSize !== null && CFG.siblingBatchSize !== '' && Number(CFG.siblingBatchSize) >= 1 ? Math.min(20, Math.floor(Number(CFG.siblingBatchSize))) : 8

// Every agent goes through a per-stage + total budget (incident wf_7418b0da: 1000 agents / 90.5M
// tokens). A call past the cap returns null and is logged + reported in result.budget.
const AGENT_BUDGET = makeAgentBudget(agent, parseAgentCaps(CFG), log)
const runAgent = AGENT_BUDGET.agent

// The full preset REGISTRY is inlined into this assembled workflow (build.mjs), so the controller
// passes a SMALL `cfg.preset` string (e.g. "supabase"), NOT the whole adapter object (large nested
// args get dropped in transit). Resolution order: cfg.adapter (only a genuine custom/interview
// adapter, kept small) → cfg.preset via REGISTRY → cfg.repoProbe auto-detect → generic. Per-repo
// overrides in cfg (repoContext/db/actors/testCmd/lenses/extraLenses) are layered on top.
let { adapter: A, source: ADAPTER_SOURCE } = resolveAdapter(CFG, REGISTRY, CFG.repoProbe)

// SELF-HEAL (root-cause A/B): if the preset never arrived and we fell back to generic, re-detect
// the stack from the repo AT RUNTIME via an agent (the workflow scope has no fs), so livefire
// recovers to the right preset instead of running blind. Skipped if the user genuinely wants a
// custom adapter (cfg.adapter present) or has no registry match on purpose.
if (A.id === 'generic' && !CFG.adapter) {
  const probe = await runAgent(
    `Detect the stack of the repo at ${REPO_ROOT || 'the current working directory'} for livefire. Read package.json (dependencies+devDependencies) and list root files + any of: requirements.txt, pyproject.toml, composer.json, go.mod, Gemfile, manage.py, artisan, firebase.json, firestore.rules, supabase/. Return the single best-matching preset id from this exact set, or "generic" if none fits: ${Object.keys(REGISTRY).join(', ')}. Rules of thumb: Next + @supabase/ssr → supabase; Next without supabase/firebase/hasura → nextjs; @nestjs/core → nestjs; bare express → express; django/manage.py → django; fastapi/flask in requirements → fastapi/flask; Gemfile+rails → rails; artisan → laravel; symfony/framework-bundle → symfony; pom.xml/build.gradle → spring; .csproj → aspnet; go.mod+web-framework → go; @strapi/strapi → strapi; firebase deps/files → firebase; hasura metadata → hasura.`,
    { label: 'runtime-detect', phase: 'Inventory', schema: { type: 'object', additionalProperties: false, properties: { preset: { type: 'string' }, why: { type: 'string' } }, required: ['preset', 'why'] } }
  )
  if (probe && probe.preset && REGISTRY[probe.preset]) {
    A = resolveAdapter({ ...CFG, adapter: undefined, preset: probe.preset }, REGISTRY).adapter
    ADAPTER_SOURCE = 'runtime-auto-detect:' + probe.preset
    log(`self-healed: cfg.preset was absent/dropped → runtime-detected "${probe.preset}" (${probe.why})`)
  }
}

log(`adapter: ${A.id} (${ADAPTER_SOURCE === 'explicit' ? (CFG.adapterSource || 'controller-resolved') : ADAPTER_SOURCE}) · scope: ${SECURITY_PASS ? 'whole-surface' : 'feature/diff'}${(A.overridden || []).length ? ' · project overrides: ' + A.overridden.join(', ') : ''}${REPO_ROOT ? ' · repo: ' + REPO_ROOT : ''}`)
if (A.id === 'generic') log('⚠️ adapter is GENERIC — the inventory will probe the store and dump its full authz model, but pin a preset via cfg.preset or livefire.config.mjs for a first-class run.')

const SCOPE = SECURITY_PASS
  ? 'SECURITY PASS — scope is the WHOLE reachable surface (' + A.scopeUnits + '), OLD migrations included. The diff ' + RANGE + ' only prioritizes; it is not a boundary.'
  : 'FEATURE PASS — focus on the diff ' + RANGE + ' and the code it touches.'

const TARGET = REPO_ROOT
  ? `TARGET REPO: ${REPO_ROOT} — every file path is relative to it and every shell / git / test command runs from it (\`cd ${REPO_ROOT}\` first). Your own working directory may be a different checkout; ignore it.`
  : 'TARGET REPO: the current working directory.'

const CTX = `
You are verifying our own product before merge. ${A.repoContext}
${TARGET}
${SCOPE}
Read the REAL files + the live catalog. Precision over volume — a rule already enforced by an existing check is NOT a finding; name the check and why it does not block. Report file:line (and the policy/grant). NOTE: recently-hardened code (a recent security migration) is a PRIORITY re-audit target — the fix is often incomplete — never treat any code as "already fixed, skip".
`

// Stack-agnostic finding / probe / verdict schemas (unchanged across stacks).
const FINDING_ITEM = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    family: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' },
    description: { type: 'string' }, wrong_actor_scenario: { type: 'string' },
    guard_checked: { type: 'string' }, probe_hint: { type: 'string' },
  },
  required: ['title', 'severity', 'family', 'file', 'line', 'description', 'wrong_actor_scenario', 'guard_checked', 'probe_hint'],
}
const CANDIDATES_SCHEMA = { type: 'object', additionalProperties: false, properties: { lens: { type: 'string' }, findings: { type: 'array', items: FINDING_ITEM } }, required: ['lens', 'findings'] }

const PROBE_ITEM = { type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string' }, kind: { type: 'string', enum: ['guard_holds', 'gap_real', 'happy_path_step'] },
    actor: { type: 'string', enum: ['anon', 'outsider', 'insider_wrong_role', 'legitimate'] },
    action: { type: 'string' }, expected: { type: 'string' }, observed: { type: 'string' },
    direct_select_evidence: { type: 'string' }, passed: { type: 'boolean' }, relates_to: { type: 'string' },
  },
  required: ['name', 'kind', 'actor', 'action', 'expected', 'observed', 'direct_select_evidence', 'passed', 'relates_to'] }
const PROBE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { stack_status: { type: 'string' }, degraded: { type: 'boolean' }, probes: { type: 'array', items: PROBE_ITEM } },
  required: ['stack_status', 'degraded', 'probes'],
}
// A gap-closing round (critic loop) both probes live AND reads code, so it returns both.
const GAP_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { stack_status: { type: 'string' }, degraded: { type: 'boolean' }, probes: { type: 'array', items: PROBE_ITEM }, findings: { type: 'array', items: FINDING_ITEM } },
  required: ['stack_status', 'degraded', 'probes', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, confirmed: { type: 'boolean' }, confidence: { type: 'number' },
    corrected_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    family: { type: 'string' }, modalities: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, fix: { type: 'string' },
  },
  required: ['title', 'confirmed', 'confidence', 'corrected_severity', 'family', 'modalities', 'reason', 'file', 'line', 'fix'],
}

const BATCH_VERDICT_SCHEMA = { type: 'object', additionalProperties: false, properties: { verdicts: { type: 'array', items: VERDICT_SCHEMA } }, required: ['verdicts'] }
const SWEEP_SCHEMA = { type: 'object', additionalProperties: false, properties: { family: { type: 'string' }, siblings: { type: 'array', items: FINDING_ITEM } }, required: ['family', 'siblings'] }
const CRITIC_SCHEMA = { type: 'object', additionalProperties: false, properties: { dry: { type: 'boolean' }, uncovered: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { surface: { type: 'string' }, why: { type: 'string' }, suggested_probe: { type: 'string' } }, required: ['surface', 'why', 'suggested_probe'] } } }, required: ['dry', 'uncovered'] }

// ── Stage 0.5: mechanical inventory (barrier — reviewers + prover need it) ──
phase('Inventory')
const INVENTORY_PROMPT = CTX + `\n\nMECHANICAL INVENTORY. ${A.db}\n\nDump the live authz model: ${A.inventorySql}\n\n${A.inventoryFlagHint}\n\n` +
  `⚠️ EXECUTION — this is a READ-ONLY dump; make it COMPLETE and ROBUST:\n` +
  `${A.inventoryExecution}\n` +
  `• Do NOT interleave the inventory dump with access probes/exploits (those belong to the prover stage and generate expected errors). Dump first, cleanly.\n` +
  `• Report the FULL model, and in catalog_counts the mechanically-counted TOTALS your lists must match. If a step errors, retry it standalone rather than dropping it. Only set degraded=true if you genuinely cannot reach the store — a partial list from an aborted step is a BUG, not "degraded".`

// Enumerated vs counted: a truncated dump looks exactly like a small app unless we compare.
// Privileged units = DB functions (Postgres) AND app-tier units — an empty secdef_funcs[] on a
// non-Postgres target must never hide the units[] map.
const unitsOf = (inv) => ((inv && inv.secdef_funcs) || []).concat((inv && inv.units) || [])
const enumerated = (inv) => ({ privileged_units: unitsOf(inv).length, policies: ((inv && inv.policies) || []).length })
function shortfall(inv) {
  const cc = inv && inv.catalog_counts
  if (!cc) return null
  const e = enumerated(inv)
  const gaps = ['privileged_units', 'policies'].filter((k) => typeof cc[k] === 'number' && e[k] < cc[k])
  return gaps.length ? gaps.map((k) => `${e[k]} of ${cc[k]} ${k.replace('_', ' ')}`).join(' and ') : null
}
let inventory = (await runAgent(INVENTORY_PROMPT, { label: 'inventory', phase: 'Inventory', schema: A.inventorySchema })) || {}
let short = shortfall(inventory)
if (short) {
  log(`inventory short (${short}) — re-running the dump once`)
  let retry = null
  try {
    retry = await runAgent(INVENTORY_PROMPT + `\n\n⚠️ RETRY: a previous dump enumerated only ${short} — it was TRUNCATED. Re-run every enumeration step standalone and return the COMPLETE lists (they must match catalog_counts).`, { label: 'inventory:retry', phase: 'Inventory', schema: A.inventorySchema })
  } catch (e) { log(`inventory retry failed (${e && e.message}) — keeping the first dump`) }
  const sum = (inv) => { const e = enumerated(inv); return e.privileged_units + e.policies }
  if (retry && sum(retry) >= sum(inventory)) inventory = retry
  short = shortfall(inventory)
}
const TRUNCATED = !!short
if (TRUNCATED) log(`⚠️ inventory TRUNCATED after retry (${short}) — every downstream stage sees a partial authz model; treat coverage as incomplete.`)
// full (default) or compact (cfg.inventoryMode, an experiment: see src/inventory-view.js)
const INVENTORY_MODE = parseInventoryMode(CFG)
const invFull = renderInventory(inventory, 'full')
const invCompact = renderInventory(inventory, 'compact')
// prover + sweep: one view (full unless the run is compact-only)
const invBlob = INVENTORY_MODE === 'compact' ? invCompact : invFull
// static: both views by default — each view surfaces holes the other misses (see inventory-view.js)
const STATIC_VIEWS = INVENTORY_MODE === 'both' ? [{ blob: invFull, sfx: '' }, { blob: invCompact, sfx: ':compact' }] : [{ blob: invBlob, sfx: '' }]
const secdef = unitsOf(inventory)
const pols = inventory.policies || []
log(`inventory: ${secdef.length} privileged units, ${pols.length} policies, ${(inventory.secret_columns || []).length} secret surfaces`)
const TRUNC_NOTE = TRUNCATED ? `\n⚠️ INVENTORY TRUNCATED (${short}): the dump below is PARTIAL — enumerate what is missing yourself before concluding anything is absent.\n` : ''

// ── Stage 2: static fan-out over the whole surface (barrier) ──
phase('Static')
const reviews = (await parallel(
  STATIC_VIEWS.flatMap((v) => A.lenses.map((l) => () => runAgent(CTX + TRUNC_NOTE + `\n\nLIVE INVENTORY:\n${v.blob}\n\n${l.prompt}`, { label: `static:${l.key}${v.sfx}`, phase: 'Static', schema: CANDIDATES_SCHEMA })))
)).filter(Boolean)
let candidates = reviews.flatMap((r) => (r.findings || []).map((f) => ({ ...f, lens: r.lens })))
// Two views (and several lenses) report the same hole: merge on the same location + family key,
// keeping the most severe wording, so one hole is verified once.
{
  const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  const seenLoc = new Set()
  const before = candidates.length
  candidates = candidates
    .slice()
    .sort((a, b) => (rank[a.severity] ?? 5) - (rank[b.severity] ?? 5))
    .filter((c) => {
      const k = `${c.file}|${c.line}|${canonFamily(c.family)}`
      if (seenLoc.has(k)) return false
      seenLoc.add(k)
      return true
    })
  if (before !== candidates.length) log(`static candidates: merged ${before - candidates.length} duplicates (same file:line + family key)`)
}
log(`static candidates: ${candidates.length}`)

// ── Stage 3: empirical prover, 3-actor matrix (serial — shared DB) ──
phase('Prove')
const PROVER_RULES = proverRules(A)
const probeResult = await runAgent(
  CTX +
    `\n\nEMPIRICAL PROVER — three-actor matrix. ${A.db}\n${A.actors}\n\n` + PROVER_RULES + `\n\n` +
    TRUNC_NOTE + `LIVE INVENTORY:\n${invBlob}\n\n` +
    `For ${A.proverTargets}, and for each static candidate below, run:\n` +
    `1. guard_holds — perform the forbidden action as EACH wrong actor (anon, outsider, insider_wrong_role) → assert refused AND the store row unchanged.\n` +
    `2. gap_real — perform each candidate's action for real → does it wrongly land?\n` +
    `3. happy_path_step — as the legitimate actor, walk the user story; assert each step works + landed.\n` +
    `Plant fixtures with the admin client, run, confirm EVERY write with a direct ground-truth read that bypasses the app's authz (the evidence text), then clean up. If no live stack, run the real integration/E2E paths, set degraded=true, and say what you could not execute.\n\n` +
    `CANDIDATES:\n${JSON.stringify(candidates.map((c) => ({ title: c.title, file: c.file, line: c.line, probe_hint: c.probe_hint })), null, 2)}`,
  { label: 'prover-3actor', phase: 'Prove', schema: PROBE_SCHEMA }
)
const probes = ((probeResult && probeResult.probes) || []).slice()
let degraded = !!(probeResult && probeResult.degraded)
log(`probes: ${probes.length} · degraded: ${degraded}`)

// ── Stage 4: adversarial verify + cross-modal ──
phase('Verify')
// Under the agent budget the tail of a burst is dropped, so the most severe work goes first.
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const bySeverity = (a, b) => (SEV_RANK[a.severity] ?? 5) - (SEV_RANK[b.severity] ?? 5)
candidates.sort(bySeverity)
// Verifiers name the family in free text; showing them the keys already in use keeps variants
// down. Hygiene only — canonFamily + first-pass-only sweeping are what bound the fan-out.
function familyHint() {
  const keys = Array.from(new Set(candidates.concat(verdicts || []).map((x) => canonFamily(x.family)).filter((k) => k && k !== 'empirical-only' && k !== 'functional-only')))
  return keys.length ? `ROOT-CAUSE FAMILIES ALREADY IN USE: ${JSON.stringify(keys)} — if this candidate shares one of these root causes, name that family verbatim; coin a new family only if none fits.\n\n` : ''
}
let verdicts = null
const VERIFY_RULES = `\n\nADVERSARIAL VERIFY — try HARD to REFUTE this candidate. Re-read the cited location, search for ANY existing check (${A.guardExamples}) that blocks it, and weigh the prover's live results. confirmed=false (cite the blocking check) if blocked. confirmed=true only if genuinely unguarded: confidence 1-10, correct the severity, name the family, propose the fix, and list modalities that agreed — "static", "empirical" (a gap_real probe reproduced it), "functional" (a happy_path_step failed). Default to confirmed=false when uncertain.\n\n`
const relatedProbes = (c) => probes.filter((p) => (p.relates_to || '').toLowerCase().includes((c.title || '').slice(0, 20).toLowerCase()))
async function verifyOne(c, phaseName) {
  const related = relatedProbes(c)
  return runAgent(
    CTX +
      VERIFY_RULES +
      familyHint() +
      `CANDIDATE:\n${JSON.stringify(c, null, 2)}\n\nRELATED PROVER PROBES:\n${JSON.stringify(related, null, 2)}`,
    { label: `verify:${(c.title || '').slice(0, 26)}`, phase: phaseName || 'Verify', schema: VERDICT_SCHEMA }
  )
}
verdicts = (await parallel(candidates.map((c) => () => verifyOne(c)))).filter(Boolean)

// Sweep siblings share one root cause, so one agent verifies a whole batch of them (W4.3(b):
// one agent per sibling was the largest Sweep cost). Each candidate still needs its own evidence.
// Returns only verdicts that match a candidate of THIS batch; the rest is reported unverified.
async function verifyBatch(fam, batch, phaseName) {
  const related = Array.from(new Set(batch.flatMap(relatedProbes)))
  const out = await runAgent(
    CTX +
      VERIFY_RULES +
      `BATCH: the ${batch.length} candidates below are siblings of root-cause family "${fam}". Verify EACH candidate independently: re-read ITS cited location, search for ITS blocking check, weigh ITS probes — never carry one candidate's verdict over to another. Return exactly one verdict per candidate, its title copied verbatim.\n\n` +
      familyHint() +
      `CANDIDATES:\n${JSON.stringify(batch, null, 2)}\n\nRELATED PROVER PROBES:\n${JSON.stringify(related, null, 2)}`,
    { label: `verify-batch:${fam}`.slice(0, 40), phase: phaseName, schema: BATCH_VERDICT_SCHEMA }
  )
  const byTitle = new Map(batch.map((c) => [titleKey(c.title), c]))
  const got = []
  for (const v of (out && out.verdicts) || []) {
    const k = titleKey(v.title)
    if (byTitle.has(k)) { got.push(v); byTitle.delete(k) }
  }
  return { verdicts: got, missing: Array.from(byTitle.values()) }
}

// Fold in prover-only findings (empirical modality caught what no reviewer flagged).
function foldProverOnly(ps) {
  const known = new Set(verdicts.map((v) => (v.title || '').toLowerCase()))
  const extra = ps
    .filter((p) => (p.kind === 'gap_real' || p.kind === 'guard_holds') && p.passed === false && !known.has((p.name || '').toLowerCase()))
    .map((p) => ({ title: p.name, confirmed: true, confidence: 8, corrected_severity: 'high', family: 'empirical-only', modalities: ['empirical'], reason: `Prover (${p.actor}) reproduced: ${p.observed}. Evidence: ${p.direct_select_evidence}`, file: '(empirical)', line: 0, fix: 'See prover observation.' }))
  // A failing happy-path step is the functional modality. With no candidate to attach it to it
  // used to stay in result.probes only, so a broken user flow never reached the report.
  const functional = ps
    .filter((p) => p.kind === 'happy_path_step' && p.passed === false && !known.has((p.name || '').toLowerCase()))
    .map((p) => ({ title: p.name, confirmed: true, confidence: 7, corrected_severity: 'medium', family: 'functional-only', modalities: ['functional'], reason: `Happy-path step failed (${p.actor}): expected ${p.expected}; observed ${p.observed}. Evidence: ${p.direct_select_evidence}`, file: '(functional)', line: 0, fix: 'See prover observation.' }))
  verdicts = verdicts.concat(extra, functional)
}
foldProverOnly(probes)

// ── Stage 5: root-cause family sweep (rule 6) ──
// Only FIRST-PASS verdicts (static lenses, critic gap rounds) seed a sweep, keyed by canonFamily.
// A sweep sibling's verdict is verified and reported, but its family is never swept again:
// verifiers coin a fresh free-text variant each time, so "sweep until no new family" never
// converges (incident wf_7418b0da: 304 "families", 1000 agents, 90.5M tokens).
phase('Sweep')
const sweptFamilies = new Set()
const siblingVerdicts = new WeakSet()
const unverifiedSiblings = []
const titleKey = (t) => (typeof t === 'string' ? t.toLowerCase().replace(/\s+/g, ' ').trim() : '')
async function sweepFirstPassFamilies(phaseName) {
  const fams = Array.from(new Set(verdicts
    .filter((v) => v.confirmed && !siblingVerdicts.has(v))
    .map((v) => canonFamily(v.family))
    .filter((k) => k && k !== 'empirical-only' && k !== 'functional-only' && !sweptFamilies.has(k))))
  fams.forEach((k) => sweptFamilies.add(k))
  const sweeps = await parallel(
    fams.map((fam) => () => runAgent(
      CTX + `\n\nLIVE INVENTORY:\n${invBlob}\n\nROOT-CAUSE FAMILY SWEEP. A finding of family "${fam}" was confirmed. Sweep EVERY unit/table/policy in the inventory for the SAME shape and return every OTHER instance not already in this list of known titles: ${JSON.stringify(verdicts.map((v) => v.title))}. Only genuine new instances — cite each one's location + why it matches the family.`,
      { label: `sweep:${fam}`.slice(0, 30), phase: phaseName, schema: SWEEP_SCHEMA }
    ))
  )
  // DISTINCT new siblings only (two sweeps often return the same one), most severe first.
  const seen = new Set(verdicts.map((v) => titleKey(v.title)))
  const swept = []
  sweeps.forEach((s, i) => {
    for (const f of (s && s.siblings) || []) {
      const k = titleKey(f.title)
      if (!k || seen.has(k)) continue
      seen.add(k)
      swept.push({ ...f, family: fams[i], lens: 'sweep:' + fams[i] })
    }
  })
  swept.sort(bySeverity)
  // Batches per family, most severe batch first, so the agent budget drops the least severe work.
  const batches = []
  for (const fam of fams) {
    const mine = swept.filter((f) => f.family === fam)
    for (let i = 0; i < mine.length; i += SIBLING_BATCH) batches.push({ fam, items: mine.slice(i, i + SIBLING_BATCH) })
  }
  // mixed batches (high…low) sort after the all-high ones, so the budget never spends on a low first
  batches.sort((x, y) => bySeverity(x.items[0], y.items[0]) || bySeverity(x.items[x.items.length - 1], y.items[y.items.length - 1]))
  const unverified = (fs) => unverifiedSiblings.push(...fs.map((f) => ({ title: f.title, severity: f.severity, family: f.family, file: f.file, line: f.line })))
  const room = AGENT_BUDGET.remaining(phaseName)
  if (batches.length > room) {
    const over = batches.slice(room).flatMap((b) => b.items)
    unverified(over)
    log(`⚠️ agent budget: dropped ${over.length} of ${swept.length} swept siblings before verification (stage ${phaseName}) — listed in result.budget.unverified_siblings`)
  }
  const results = (await parallel(batches.slice(0, room).map((b) => () => verifyBatch(b.fam, b.items, phaseName)))).map((r, i) => r || { verdicts: [], missing: batches[i].items })
  const missing = results.flatMap((r) => r.missing)
  if (missing.length) {
    unverified(missing)
    log(`⚠️ ${missing.length} swept siblings came back without a verdict (stage ${phaseName}): ${missing.map((f) => f.title).slice(0, 5).join('; ')}${missing.length > 5 ? ' …' : ''} — listed in result.budget.unverified_siblings`)
  }
  const sweptVerdicts = results.flatMap((r) => r.verdicts)
  sweptVerdicts.forEach((v) => siblingVerdicts.add(v))
  verdicts = verdicts.concat(sweptVerdicts)
  return sweptVerdicts.filter((v) => v.confirmed).length
}
const firstSweep = await sweepFirstPassFamilies('Sweep')
log(`family sweep added ${firstSweep} confirmed siblings (${sweptFamilies.size} families)`)

// ── Stage 6: completeness critic — loop until dry (bounded; never a silent cap) ──
phase('Critic')
let critic = null
let criticRounds = 0
while (criticRounds < MAX_CRITIC_ROUNDS) {
  criticRounds++
  // Every agent() here is a direct await: a budget ceiling or terminal error THROWS. Catch it and
  // return what was verified so far — a late failure must never discard the whole run.
  try {
    const next = await runAgent(
      CTX + `\n\nCOMPLETENESS CRITIC (round ${criticRounds}). Given the inventory (${secdef.length} privileged units, ${pols.length} policies${TRUNCATED ? ', TRUNCATED: ' + short : ''}), the ${probes.length} probes (degraded=${degraded}), the lenses (${A.lenses.map((l) => l.key).join(', ')}), and the families swept (${Array.from(sweptFamilies).join(', ') || 'none'}), list what was NOT covered — a unit whose access wasn't probed from all 3 actors, a table not attacked as anon/outsider/insider, a happy-path branch not walked, a family not fully swept. dry=true only if nothing meaningful remains.`,
      { label: `critic:r${criticRounds}`, phase: 'Critic', schema: CRITIC_SCHEMA }
    )
    // A null answer (failed, or dropped by the agent budget) must not erase the previous round's
    // uncovered list — that list is exactly what the report owes the user.
    if (!next) { log(`critic round ${criticRounds}: no answer (failed or dropped by the agent budget) — keeping round ${criticRounds - 1}'s uncovered list; coverage beyond this point is unassessed`); criticRounds--; break }
    critic = next
    const gaps = critic.uncovered || []
    if (critic.dry || !gaps.length) break
    if (criticRounds >= MAX_CRITIC_ROUNDS) { log(`⚠️ critic not dry after ${criticRounds} rounds — ${gaps.length} surfaces remain unprobed (listed in result.critic.uncovered)`); break }
    log(`critic round ${criticRounds}: ${gaps.length} uncovered surfaces → gap-closing round`)
    const gap = await runAgent(
      CTX + TRUNC_NOTE + `\n\nGAP-CLOSING ROUND ${criticRounds} — the completeness critic found surfaces nobody covered. For EACH one below: read the code AND run the suggested probe live from all three wrong actors (anon, outsider, insider_wrong_role). ${A.db}\n${A.actors}\n\n` + PROVER_RULES + `\n\n` +
        `Return every probe you ran (confirm every write with a direct ground-truth read that bypasses the app's authz) and every NEW finding (a genuinely unguarded path — cite file:line and the missing check).\n\nUNCOVERED:\n${JSON.stringify(gaps, null, 2)}`,
      { label: `gap:r${criticRounds}`, phase: 'Critic', schema: GAP_SCHEMA }
    )
    if (!gap) { log(`gap round ${criticRounds}: no answer (skipped or failed) — asking the critic again`); continue }
    if (gap.degraded) degraded = true
    probes.push(...(gap.probes || []))
    const fresh = (gap.findings || []).filter((f) => !verdicts.some((v) => (v.title || '').toLowerCase() === (f.title || '').toLowerCase()))
    verdicts = verdicts.concat((await parallel(fresh.map((c) => () => verifyOne({ ...c, lens: 'critic-gap' }, 'Critic')))).filter(Boolean))
    foldProverOnly(gap.probes || [])
    await sweepFirstPassFamilies('Critic')
  } catch (e) {
    log(`critic round ${criticRounds} failed (${e && e.message}) — returning everything verified so far`)
    break
  }
}

const budgetReport = AGENT_BUDGET.report()
const familiesNotSwept = Array.from(new Set(verdicts.filter((v) => v.confirmed && siblingVerdicts.has(v)).map((v) => canonFamily(v.family)).filter((k) => k && !sweptFamilies.has(k))))
if (budgetReport.dropped.length || unverifiedSiblings.length) log(`⚠️ agent budget: ${budgetReport.dropped.length} agents dropped + ${unverifiedSiblings.length} siblings left unverified — coverage is partial (result.budget)`)
const confirmedStrong = verdicts.filter((v) => v.confirmed && (v.modalities || []).length >= 2)
const confirmedWeak = verdicts.filter((v) => v.confirmed && (v.modalities || []).length < 2)
const dismissed = verdicts.filter((v) => !v.confirmed)

return {
  adapter: A.id,
  adapter_source: ADAPTER_SOURCE,
  project_overrides: A.overridden || [],
  repo_root: REPO_ROOT,
  scope: SECURITY_PASS ? 'whole-surface' : 'diff+catalog',
  inventory_summary: { mode: INVENTORY_MODE, privileged_units: secdef.length, wrong_actor_reachable: secdef.filter((f) => f.anon_exec || f.authed_exec || f.reachable_by_wrong_actor).length, policies: pols.length, using_only_updates: pols.filter((p) => p.cmd === 'UPDATE' && !p.with_check).length, secret_surfaces: (inventory.secret_columns || []).length, catalog_counts: inventory.catalog_counts || null, truncated: TRUNCATED },
  modalities: { static_lenses: A.lenses.length, probes: probes.length, degraded, families_swept: Array.from(sweptFamilies), families_from_siblings_not_swept: familiesNotSwept },
  budget: { caps: budgetReport.caps, per_stage: budgetReport.per_stage, total: budgetReport.total, dropped: budgetReport.dropped.length + unverifiedSiblings.length, dropped_agents: budgetReport.dropped, unverified_siblings: unverifiedSiblings },
  critic_rounds: criticRounds,
  confirmed_strong: confirmedStrong,
  confirmed_weak: confirmedWeak,
  dismissed: dismissed.map((v) => ({ title: v.title, reason: v.reason, file: v.file, line: v.line })),
  probes,
  critic,
}
