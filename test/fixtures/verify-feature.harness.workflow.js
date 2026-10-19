// verify-feature harness v2 — Workflow template. ADAPT the CONFIG block at launch
// (DB connection, actor-setup recipe, inventory SQL, lenses, test command, whole-surface flag),
// then run via the Workflow tool. Plain JavaScript (no TypeScript syntax).
//
// Pipeline: mechanical inventory (dump live grants+policies) → static fan-out over the WHOLE
// surface → empirical prover (3-actor matrix, direct-SELECT) → adversarial + cross-modal →
// root-cause family sweep → completeness critic. Emitting RED-first tests is a follow-on the
// controller runs after reading this workflow's result.
//
// The six load-bearing rules (see SKILL.md): whole-surface not diff · run it not read it ·
// 3-actor matrix · enumerate live grants+policies · recently-hardened = priority re-audit ·
// sweep by root-cause family.

export const meta = {
  name: 'verify-feature',
  description: 'Security/feature verification: live grant+policy inventory → static lenses → 3-actor live-DB prover → adversarial cross-modal → root-cause family sweep',
  phases: [
    { title: 'Inventory', detail: 'dump SECURITY DEFINER grants + RLS USING/WITH-CHECK + secret columns' },
    { title: 'Static', detail: 'one reviewer per lens over the whole reachable surface' },
    { title: 'Prove', detail: 'live-DB 3-actor matrix (anon/outsider/wrong-role), direct-SELECT' },
    { title: 'Verify', detail: 'refute each candidate + cross-modal confirm' },
    { title: 'Sweep', detail: 'root-cause family sweep across every function/table' },
    { title: 'Critic', detail: 'what was not covered' },
  ],
}

// ─────────────────────────── CONFIG — adapt per launch ───────────────────────────
const CFG = (args && args.cfg) || {}
const RANGE = CFG.range || 'main...HEAD'
const SECURITY_PASS = CFG.securityPass !== false // true → whole surface; false → diff-focused feature pass
const REPO_CTX = CFG.repoContext || 'Adapt: the app, its multi-tenant/ownership model, the feature under review.'
const DB = CFG.db || 'Adapt: how to reach the live local DB (e.g. psql postgresql://postgres:postgres@127.0.0.1:54322/postgres) and the service-role/admin client for planting + confirming SELECTs.'
const ACTORS = CFG.actors ||
  'Adapt: how to construct the three attacker clients — (1) ANON: the bare public/anon key, no session; (2) OUTSIDER: a real authenticated user with ZERO membership in the target tenant; (3) INSIDER-WRONG-ROLE: a real authenticated plain member / non-owner admin of the target tenant. Plus the SERVICE-ROLE/admin client for planting fixtures and the confirming SELECT.'
const INVENTORY_SQL = CFG.inventorySql ||
  `Run against the live DB and return structured results:
   (a) every SECURITY DEFINER function + which roles hold EXECUTE — e.g.
       SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef;
   (b) every RLS policy USING + WITH CHECK — SELECT schemaname,tablename,policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname='public';
   (c) RLS-enabled tables with zero policies;
   (d) columns holding secrets/PII (tokens, raw payloads, refresh tokens) and that table's SELECT policy breadth.`
const TEST_CMD = CFG.testCmd || 'npm test'
const LENSES = CFG.lenses || [
  { key: 'authz', prompt: 'AUTHZ / access-policy lens. Using the inventory: any SECURITY DEFINER / service-role function reachable by anon/authenticated with caller-controlled ids and no internal membership/role check (a PUBLIC-default grant = no REVOKE); any UPDATE policy that is USING-only (destructive columns unguarded); ownership/tenancy/entitlement columns a permitted user can change. Cite the missing check.' },
  { key: 'input', prompt: 'INPUT-VALIDATION lens. Every action/route/webhook input validated? Mass-assignment (rest-spread into update/insert without a column allowlist), queries from raw user input. Cite it.' },
  { key: 'tenant-scope', prompt: 'CROSS-OBJECT / TENANT-SCOPING lens. Every user-supplied id acted on without a membership/ownership check reached before the write; INSERT/UPDATE WITH CHECK that validates only user_id/created_by and omits the tenancy re-check its sibling UPDATE carries.' },
  { key: 'billing', prompt: 'BILLING / ENTITLEMENT lens (skip if N/A). Paid features reachable by a non-payer or gated tenant; a gate on only some write paths; destructive lifecycle jobs that over-select or skip a blocker re-check; billing/PII columns readable by non-admins.' },
  { key: 'secrets-cron', prompt: 'SECRETS / CRON / EXTERNAL lens. Shared-secret checks constant-time + fail-closed + no user input; webhook signatures; no secret in the client bundle; server-side fetch of a user URL restricted to an allowlist (SSRF); privileged maintenance functions callable by anon.' },
  { key: 'happy-path', prompt: 'FUNCTIONAL HAPPY-PATH lens. Enumerate every step of the user story (each CTA/route/state); flag any step whose wiring is missing or dead.' },
]
// ──────────────────────────────────────────────────────────────────────────────────

const SCOPE = SECURITY_PASS
  ? 'SECURITY PASS — scope is the WHOLE reachable surface (every SECURITY DEFINER function, every RLS policy, every route), OLD migrations included. The diff ' + RANGE + ' only prioritizes; it is not a boundary.'
  : 'FEATURE PASS — focus on the diff ' + RANGE + ' and the code it touches.'

const CTX = `
You are verifying our own product before merge. ${REPO_CTX}
${SCOPE}
Read the REAL files + the live catalog. Precision over volume — a rule already enforced by an existing check is NOT a finding; name the check and why it does not block. Report file:line (and the policy/grant). NOTE: recently-hardened code (a recent security migration) is a PRIORITY re-audit target — the fix is often incomplete — never treat any code as "already fixed, skip".
`

const INVENTORY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    secdef_funcs: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, args: { type: 'string' }, anon_exec: { type: 'boolean' }, authed_exec: { type: 'boolean' }, note: { type: 'string' } },
      required: ['name', 'args', 'anon_exec', 'authed_exec', 'note'] } },
    policies: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { table: { type: 'string' }, cmd: { type: 'string' }, using: { type: 'string' }, with_check: { type: 'string' }, flag: { type: 'string' } },
      required: ['table', 'cmd', 'using', 'with_check', 'flag'] } },
    zero_policy_tables: { type: 'array', items: { type: 'string' } },
    secret_columns: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { table: { type: 'string' }, column: { type: 'string' }, select_breadth: { type: 'string' } },
      required: ['table', 'column', 'select_breadth'] } },
  },
  required: ['secdef_funcs', 'policies', 'zero_policy_tables', 'secret_columns'],
}

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

const PROBE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    stack_status: { type: 'string' }, degraded: { type: 'boolean' },
    probes: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        name: { type: 'string' }, kind: { type: 'string', enum: ['guard_holds', 'gap_real', 'happy_path_step'] },
        actor: { type: 'string', enum: ['anon', 'outsider', 'insider_wrong_role', 'legitimate'] },
        action: { type: 'string' }, expected: { type: 'string' }, observed: { type: 'string' },
        direct_select_evidence: { type: 'string' }, passed: { type: 'boolean' }, relates_to: { type: 'string' },
      },
      required: ['name', 'kind', 'actor', 'action', 'expected', 'observed', 'direct_select_evidence', 'passed', 'relates_to'] } },
  },
  required: ['stack_status', 'degraded', 'probes'],
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

const SWEEP_SCHEMA = { type: 'object', additionalProperties: false, properties: { family: { type: 'string' }, siblings: { type: 'array', items: FINDING_ITEM } }, required: ['family', 'siblings'] }
const CRITIC_SCHEMA = { type: 'object', additionalProperties: false, properties: { dry: { type: 'boolean' }, uncovered: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { surface: { type: 'string' }, why: { type: 'string' }, suggested_probe: { type: 'string' } }, required: ['surface', 'why', 'suggested_probe'] } } }, required: ['dry', 'uncovered'] }

// ── Stage 0.5: mechanical inventory (barrier — reviewers + prover need it) ──
phase('Inventory')
const inventory = await agent(
  CTX + `\n\nMECHANICAL INVENTORY. ${DB}\n\nDump the live catalog: ${INVENTORY_SQL}\n\nFlag: every secdef function with anon_exec or authed_exec true; every USING-only UPDATE policy (with_check empty) and every WITH CHECK weaker than its USING; RLS-enabled zero-policy tables; secret/PII columns whose SELECT policy is broader than the owner.`,
  { label: 'inventory', phase: 'Inventory', schema: INVENTORY_SCHEMA }
)
const invBlob = JSON.stringify(inventory, null, 2)
log(`inventory: ${(inventory.secdef_funcs || []).length} secdef funcs, ${(inventory.policies || []).length} policies, ${(inventory.secret_columns || []).length} secret cols`)

// ── Stage 2: static fan-out over the whole surface (barrier) ──
phase('Static')
const reviews = (await parallel(
  LENSES.map((l) => () => agent(CTX + `\n\nLIVE INVENTORY:\n${invBlob}\n\n${l.prompt}`, { label: `static:${l.key}`, phase: 'Static', schema: CANDIDATES_SCHEMA }))
)).filter(Boolean)
let candidates = reviews.flatMap((r) => (r.findings || []).map((f) => ({ ...f, lens: r.lens })))
log(`static candidates: ${candidates.length}`)

// ── Stage 3: empirical prover, 3-actor matrix (serial — shared DB) ──
phase('Prove')
const probeResult = await agent(
  CTX +
    `\n\nEMPIRICAL PROVER — three-actor matrix. ${DB}\n${ACTORS}\n\nLIVE INVENTORY:\n${invBlob}\n\n` +
    `For every privileged function, every table INSERT/UPDATE/SELECT, and every cron in the inventory, and for each static candidate below, run:\n` +
    `1. guard_holds — perform the forbidden action as EACH wrong actor (anon, outsider, insider_wrong_role) → assert refused AND the store row unchanged.\n` +
    `2. gap_real — perform each candidate's action for real → does it wrongly land?\n` +
    `3. happy_path_step — as the legitimate actor, walk the user story; assert each step works + landed.\n` +
    `Plant fixtures with the service-role client, run, confirm EVERY write with a direct service-role SELECT (the evidence text), then clean up. If no live stack, run the real integration/E2E paths, set degraded=true, and say what you could not execute.\n\n` +
    `CANDIDATES:\n${JSON.stringify(candidates.map((c) => ({ title: c.title, file: c.file, line: c.line, probe_hint: c.probe_hint })), null, 2)}`,
  { label: 'prover-3actor', phase: 'Prove', schema: PROBE_SCHEMA }
)
const probes = (probeResult && probeResult.probes) || []
log(`probes: ${probes.length} · degraded: ${probeResult && probeResult.degraded}`)

// ── Stage 4: adversarial verify + cross-modal ──
phase('Verify')
async function verifyOne(c) {
  const related = probes.filter((p) => (p.relates_to || '').toLowerCase().includes((c.title || '').slice(0, 20).toLowerCase()))
  return agent(
    CTX +
      `\n\nADVERSARIAL VERIFY — try HARD to REFUTE this candidate. Re-read the cited location, search for ANY existing check (RLS USING/WITH CHECK, a REVOKE, a protect_* trigger, an in-function auth.uid()/membership guard, a preceding role check, a webhook signature, a constant-time secret compare, a column allowlist) that blocks it, and weigh the prover's live results. confirmed=false (cite the blocking check) if blocked. confirmed=true only if genuinely unguarded: confidence 1-10, correct the severity, name the family, propose the fix, and list modalities that agreed — "static", "empirical" (a gap_real probe reproduced it), "functional" (a happy_path_step failed). Default to confirmed=false when uncertain.\n\n` +
      `CANDIDATE:\n${JSON.stringify(c, null, 2)}\n\nRELATED PROVER PROBES:\n${JSON.stringify(related, null, 2)}`,
    { label: `verify:${(c.title || '').slice(0, 26)}`, phase: 'Verify', schema: VERDICT_SCHEMA }
  )
}
let verdicts = (await parallel(candidates.map((c) => () => verifyOne(c)))).filter(Boolean)

// Fold in prover-only findings (empirical modality caught what no reviewer flagged).
const known = new Set(verdicts.map((v) => (v.title || '').toLowerCase()))
const proverOnly = probes
  .filter((p) => (p.kind === 'gap_real' || p.kind === 'guard_holds') && p.passed === false && !known.has((p.name || '').toLowerCase()))
  .map((p) => ({ title: p.name, confirmed: true, confidence: 8, corrected_severity: 'high', family: 'empirical-only', modalities: ['empirical'], reason: `Prover (${p.actor}) reproduced: ${p.observed}. Evidence: ${p.direct_select_evidence}`, file: '(empirical)', line: 0, fix: 'See prover observation.' }))
verdicts = verdicts.concat(proverOnly)

// ── Stage 5: root-cause family sweep (rule 6) ──
phase('Sweep')
const families = Array.from(new Set(verdicts.filter((v) => v.confirmed && v.family && v.family !== 'empirical-only').map((v) => v.family)))
const sweeps = (await parallel(
  families.map((fam) => () => agent(
    CTX + `\n\nLIVE INVENTORY:\n${invBlob}\n\nROOT-CAUSE FAMILY SWEEP. A finding of family "${fam}" was confirmed. Sweep EVERY function/table/policy in the inventory for the SAME shape and return every OTHER instance not already in this list of known titles: ${JSON.stringify(verdicts.map((v) => v.title))}. Only genuine new instances — cite each one's location + why it matches the family.`,
    { label: `sweep:${fam}`.slice(0, 30), phase: 'Sweep', schema: SWEEP_SCHEMA }
  ))
)).filter(Boolean)
const swept = sweeps.flatMap((s) => (s.siblings || []).map((f) => ({ ...f, lens: 'sweep:' + s.family })))
const sweptVerdicts = (await parallel(swept.map((c) => () => verifyOne(c)))).filter(Boolean)
verdicts = verdicts.concat(sweptVerdicts)
log(`family sweep added ${sweptVerdicts.filter((v) => v.confirmed).length} confirmed siblings`)

const confirmedStrong = verdicts.filter((v) => v.confirmed && (v.modalities || []).length >= 2)
const confirmedWeak = verdicts.filter((v) => v.confirmed && (v.modalities || []).length < 2)
const dismissed = verdicts.filter((v) => !v.confirmed)

// ── Stage 6: completeness critic ──
phase('Critic')
const critic = await agent(
  CTX + `\n\nCOMPLETENESS CRITIC. Given the inventory (${(inventory.secdef_funcs || []).length} secdef funcs, ${(inventory.policies || []).length} policies), the ${probes.length} probes (degraded=${probeResult && probeResult.degraded}), the lenses (${LENSES.map((l) => l.key).join(', ')}), and the families swept (${families.join(', ') || 'none'}), list what was NOT covered — a function whose grants weren't probed from all 3 actors, a table not attacked as anon/outsider/insider, a happy-path branch not walked, a family not fully swept. dry=true only if nothing meaningful remains.`,
  { label: 'critic', phase: 'Critic', schema: CRITIC_SCHEMA }
)

return {
  scope: SECURITY_PASS ? 'whole-surface' : 'diff+catalog',
  inventory_summary: { secdef_funcs: (inventory.secdef_funcs || []).length, anon_reachable_secdef: (inventory.secdef_funcs || []).filter((f) => f.anon_exec).length, policies: (inventory.policies || []).length, using_only_updates: (inventory.policies || []).filter((p) => p.cmd === 'UPDATE' && !p.with_check).length, secret_columns: (inventory.secret_columns || []).length },
  modalities: { static_lenses: LENSES.length, probes: probes.length, degraded: probeResult && probeResult.degraded, families_swept: families },
  confirmed_strong: confirmedStrong,
  confirmed_weak: confirmedWeak,
  dismissed: dismissed.map((v) => ({ title: v.title, reason: v.reason, file: v.file, line: v.line })),
  probes,
  critic,
}
