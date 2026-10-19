// livefire — the VerifyAdapter contract.
//
// livefire's method is stack-agnostic: read the code · run the exploit · walk the user story ·
// three-actor matrix · cross-modal confirm · root-cause family sweep. Only TWO things are
// stack-specific — how you enumerate the app's authz model, and how you build the three
// attacker clients + read ground truth. Both live behind this one interface. A preset is just
// an object implementing it. Nothing in the pipeline (src/harness-core.js) references Postgres,
// Supabase, or any stack directly — it only reads the fields below.
//
// IMPORTANT: in the Workflow model the pipeline does NOT execute SQL or open DB clients itself
// — its subagents do. So an adapter's fields are mostly INSTRUCTIONS (prompt fragments) + SQL
// text + a JSON schema for the structured dump. The adapter DESCRIBES; the agent DOES. That is
// why `db` / `actors` / `inventorySql` are strings: they are handed to an agent that has shell
// + DB access. Fields may also be a function `(repo) => string` for dynamic presets.
//
// ── The contract ──────────────────────────────────────────────────────────────────
// id            string    unique preset id, e.g. 'supabase', 'rails-pg', 'spring'.
// detect        (repo) => boolean   OPTIONAL. Given a light repo probe (see RepoProbe),
//                         return true if this preset fits. Used by auto-detect. First match
//                         wins; order presets most-specific first in the registry.
// repoContext   string    one paragraph: the app, its tenancy/ownership model, what "wrong
//                         actor" means here. Prepended to every agent's context.
// db            string    how an agent reaches the live LOCAL/disposable DB + the admin /
//                         service-role client used to PLANT fixtures and run the confirming
//                         SELECT (the evidence). MUST point at a throwaway DB — see the
//                         livefire safety guard; never a managed/prod host.
// actors        string    how to construct the three attacker clients — (1) ANON (no session),
//                         (2) OUTSIDER (authenticated, zero membership), (3) INSIDER-WRONG-ROLE
//                         (authenticated, wrong role in the target tenant) — plus the admin
//                         client. For stacks where authz is in code (Spring/Rails), this is
//                         "mint a JWT/session for each" rather than DB keys.
// inventorySql  string    what to dump so the authz model becomes DATA. For Postgres/RLS this
//                         is pg_proc EXECUTE grants + pg_policies. For app-tier-authz stacks it
//                         is "enumerate every route -> its guard; every ORM query missing a
//                         tenant filter" and the DB-grant part degrades to n/a (say so).
// inventorySchema object   JSON Schema for the structured inventory dump. Stack-specific shape.
//                         The pipeline treats it opaquely — it only forwards the dumped JSON.
// testCmd       string    the project's test runner, e.g. 'npm test', 'pytest', 'bundle exec rspec'.
// lenses        [{key,prompt}]  the static-review lenses. Sensible universal defaults live in
//                         DEFAULT_LENSES below; a preset overrides only what its stack changes.
// emitTestHint  string    OPTIONAL. how a RED-first regression test is written for this stack
//                         (framework + how to pair the assertion with a direct ground-truth
//                         read). Defaults to a generic description if omitted.
// inventoryExecution string OPTIONAL. how to RUN the dump robustly (e.g. one psql per query in
//                         autocommit). The pipeline itself never names a tool.
// guardExamples string    OPTIONAL. the kinds of existing checks a verifier must look for before
//                         confirming a candidate (RLS/REVOKE/trigger for Postgres; middleware /
//                         policy / query scope for app-tier stacks).
// credentialsHint string  OPTIONAL. where the LOCAL stack's credentials come from.
// proverTargets string    OPTIONAL. what the prover must attack from all three actors.
// scopeUnits    string    OPTIONAL. how a whole-surface pass names "everything" on this stack.
//
// Per-repo OVERRIDES (cfg / livefire.config.mjs, on top of a preset — this is how a project adds
// what the preset can't know: its tenancy model, its exact local keys, its test runner):
//   repoContext / db / actors  → APPENDED after the preset text (preset safety guidance is kept)
//   inventorySql / inventoryFlagHint / testCmd / emitTestHint → REPLACE the preset field
//   lenses → replace the lens set · extraLenses → appended to it
//
// A RepoProbe passed to detect() is a plain object the controller fills in Stage 0:
//   { deps: {...package.json deps}, files: [relative paths present], manifests: {...} }
// ────────────────────────────────────────────────────────────────────────────────────

import { POSTGRES_INVENTORY_SQL, POSTGRES_INVENTORY_FLAG_HINT, POSTGRES_INVENTORY_EXECUTION, GENERIC_INVENTORY_SCHEMA } from './inventory.js'

// Parse the Workflow `args` / `cfg` defensively. The Workflow tool sometimes delivers a nested
// object as a STRINGIFIED JSON (a documented quirk), so `args.cfg` can arrive as a string —
// which silently made `const CFG = args?.cfg || {}` see `{}` and drop cfg.preset, falling back
// to the blind generic adapter. This accepts cfg whether it's an object or a JSON string, and
// also unwraps a top-level stringified `args`. Returns a plain cfg object (never throws).
export function parseWorkflowCfg(args) {
  let a = args
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch (_) { a = {} } }
  let cfg = a && a.cfg
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch (_) { cfg = {} } }
  return cfg && typeof cfg === 'object' ? cfg : {}
}

export const DEFAULT_LENSES = [
  { key: 'authz', prompt: 'AUTHZ / access-policy lens. Using the inventory: any privileged operation (an admin-only handler, an elevated-privilege function, a job trigger) reachable by an unauthenticated or non-member caller with caller-controlled ids and no internal membership/role check (an access rule that defaults to open — no explicit deny — IS open); any UPDATE path that guards the row it reads but not the row it writes (destructive columns unguarded); ownership/tenancy/entitlement fields a permitted user can change. Cite the missing check.' },
  { key: 'input', prompt: 'INPUT-VALIDATION lens. Every action/route/webhook input validated? Mass-assignment (spreading raw user input into an update/insert without a column allowlist), queries built from raw user input (injection). Cite it.' },
  { key: 'tenant-scope', prompt: 'CROSS-OBJECT / TENANT-SCOPING lens. Every user-supplied id acted on without a membership/ownership check reached BEFORE the write; a write path that validates only user_id/created_by and omits the tenancy re-check its sibling paths carry.' },
  { key: 'billing', prompt: 'BILLING / ENTITLEMENT lens (skip if N/A). Paid features reachable by a non-payer or gated tenant; a gate on only some write paths; destructive lifecycle jobs that over-select or skip a blocker re-check; billing/PII fields readable by non-admins.' },
  { key: 'secrets-cron', prompt: 'SECRETS / CRON / EXTERNAL lens. Shared-secret checks constant-time + fail-closed + no user input; webhook signatures verified; no secret in the client bundle; server-side fetch of a user-supplied URL restricted to an allowlist (SSRF); privileged maintenance jobs callable by the wrong actor.' },
  { key: 'happy-path', prompt: 'FUNCTIONAL HAPPY-PATH lens. Enumerate every step of the user story (each CTA/route/state); flag any step whose wiring is missing or dead.' },
]

// The generic fallback — used when no preset matches and the user has not supplied one.
// Every field is an INSTRUCTION to the running agent to adapt to whatever stack is present.
// livefire degrades to this rather than failing; it also drives the interview that offers to
// save a livefire.config.js. It is deliberately stack-neutral (no Postgres assumptions).
export const GENERIC_ADAPTER = {
  id: 'generic',
  repoContext: 'Adapt: describe the app, its multi-tenant/ownership model, and what a "wrong actor" is here.',
  db: 'Adapt: how to reach the live LOCAL / disposable store and an admin/superuser client for planting fixtures + the confirming ground-truth read. If there is no DB, name the durable store you can read directly to confirm a write landed.',
  actors: 'Adapt: how to construct the three attacker positions — (1) ANON: no session; (2) OUTSIDER: authenticated with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE: authenticated plain member / non-owner. Plus the admin client for planting + the confirming read.',
  // NEVER blind on a Postgres target: probe first, and if it's Postgres, dump the full catalog
  // with the SAME SQL the supabase preset uses (that's what keeps a fallen-back generic run
  // equivalent to the supabase-native harness — the divergence was generic returning policies:0).
  inventorySql: 'Enumerate the app\'s authorization model as data. FIRST probe the DB: run `SELECT 1 FROM pg_catalog.pg_proc LIMIT 1`. IF it succeeds (a Postgres target), dump the FULL Postgres catalog:\n' + POSTGRES_INVENTORY_SQL + '\nOTHERWISE (no Postgres / authz in code): enumerate every route -> its guard and every data query missing a tenant/owner filter, and say the DB-grant dump is n/a for this stack.',
  inventorySchema: GENERIC_INVENTORY_SCHEMA,
  inventoryFlagHint: POSTGRES_INVENTORY_FLAG_HINT + ' (for a non-Postgres target, instead flag every route/unit a wrong actor reaches with no guard.)',
  inventoryExecution: 'If the target is Postgres: ' + POSTGRES_INVENTORY_EXECUTION + '\nOtherwise: ' + '• Run each enumeration step independently so one expected error never truncates the rest; retry a failed step standalone.',
  testCmd: 'Adapt: the project test runner.',
  lenses: DEFAULT_LENSES,
  emitTestHint: 'Adapt: write the regression test in the project\'s framework and PAIR the assertion with a direct ground-truth read (bypassing the app\'s own authz) so the test proves the row changed, not that a 200 returned.',
}

// Stack-neutral defaults for the optional instruction fields (used by every preset that does not
// override them). The pipeline reads these instead of naming any stack's tooling itself.
export const DEFAULT_INVENTORY_EXECUTION =
  '• Run each enumeration step INDEPENDENTLY (one command / query / file scan at a time) so an expected error in one step never truncates the rest; retry a failed step standalone rather than dropping it.\n' +
  '• Count mechanically before you enumerate (e.g. the number of route registrations, rule blocks, permission rows) and report it in catalog_counts — your lists must match that count.'
export const DEFAULT_GUARD_EXAMPLES =
  'a route middleware / auth guard, a policy or permission check (decorator, policy object, permission class), an ownership / tenant filter in the query itself, a DB-level row policy or grant, a trigger or constraint, a preceding role check, a webhook signature, a constant-time secret compare, a field allowlist'
export const DEFAULT_CREDENTIALS_HINT =
  'take them from the local environment only (the local stack\'s own config / a .env or test env that points at the validated local host)'
export const DEFAULT_SCOPE_UNITS = 'every privileged function, every access policy, every route'
export const DEFAULT_PROVER_TARGETS =
  'every privileged unit, every write/read path, and every scheduled job in the inventory'

const OVERRIDE_APPEND = ['repoContext', 'db', 'actors']
const OVERRIDE_REPLACE = ['inventorySql', 'inventoryFlagHint', 'testCmd', 'emitTestHint', 'inventoryExecution', 'guardExamples', 'credentialsHint', 'proverTargets', 'scopeUnits']

// Resolve which adapter to use, in priority order:
//   1. cfg.adapter    — an explicit adapter object (highest precedence)
//   2. cfg.preset     — a preset id looked up in `registry`
//   3. auto-detect    — first registry preset whose detect(repoProbe) returns true
//   4. GENERIC_ADAPTER — the adapt-in-place fallback (drives the interview)
// Returns { adapter, source } so the controller can report how it was chosen and, when the
// source is 'generic', offer to save a livefire.config.js after the run.
export function resolveAdapter(cfg = {}, registry = {}, repoProbe = null) {
  const pick = () => {
    // An inline adapter whose id names a shipped preset means "that preset + these tweaks".
    if (cfg.adapter && typeof cfg.adapter === 'object') {
      const base = cfg.adapter.id && registry[cfg.adapter.id]
      return { adapter: mergeDefaults(base ? { ...base, ...cfg.adapter } : cfg.adapter), source: 'explicit' }
    }
    if (cfg.preset && registry[cfg.preset]) return { adapter: mergeDefaults(registry[cfg.preset]), source: 'preset:' + cfg.preset }
    if (repoProbe) {
      for (const id of Object.keys(registry)) {
        const a = registry[id]
        try { if (typeof a.detect === 'function' && a.detect(repoProbe)) return { adapter: mergeDefaults(a), source: 'auto-detect:' + id } } catch (_) { /* a broken detect never blocks resolution */ }
      }
    }
    return { adapter: mergeDefaults(GENERIC_ADAPTER), source: 'generic' }
  }
  const r = pick()
  return { adapter: applyOverrides(r.adapter, cfg), source: r.source }
}

// Layer a project's own knowledge (cfg / livefire.config.mjs) over the resolved adapter. This is
// what verify-feature's controller always did at launch (the app's tenancy model, its local
// keys, `npx vitest run`) and what a preset alone cannot know.
export function applyOverrides(adapter, cfg = {}) {
  const out = { ...adapter }
  const applied = []
  for (const k of OVERRIDE_APPEND) {
    if (typeof cfg[k] === 'string' && cfg[k].trim()) {
      // Project text is appended; for the fields that touch the store, the local-only rule is
      // restated AFTER it so a project note can never have the last word on credentials/targets.
      const reminder = k === 'repoContext' ? '' : '\n(Whatever the project text says: local/disposable targets and local credentials only — see the safety rules.)'
      out[k] = `${adapter[k]}\nPROJECT-SPECIFIC (${k}): ${cfg[k]}${reminder}`
      applied.push(k)
    }
  }
  for (const k of OVERRIDE_REPLACE) {
    if (typeof cfg[k] === 'string' && cfg[k].trim()) { out[k] = cfg[k]; applied.push(k) }
  }
  const validLens = (l) => l && typeof l === 'object' && typeof l.key === 'string' && l.key && typeof l.prompt === 'string' && l.prompt
  if (Array.isArray(cfg.lenses) && cfg.lenses.some(validLens)) { out.lenses = cfg.lenses.filter(validLens); applied.push('lenses') }
  if (Array.isArray(cfg.extraLenses) && cfg.extraLenses.length) {
    const keys = new Set(out.lenses.map((l) => l.key))
    out.lenses = out.lenses.concat(cfg.extraLenses.filter((l) => validLens(l) && !keys.has(l.key)))
    applied.push('extraLenses')
  }
  out.overridden = applied
  return out
}

// Fill any field a preset omitted from the generic defaults, so the pipeline can read every
// field unconditionally. lenses default to DEFAULT_LENSES; the rest to the generic instruction.
function mergeDefaults(a) {
  return {
    id: a.id || 'custom',
    detect: a.detect,
    repoContext: a.repoContext || GENERIC_ADAPTER.repoContext,
    db: a.db || GENERIC_ADAPTER.db,
    actors: a.actors || GENERIC_ADAPTER.actors,
    inventorySql: a.inventorySql || GENERIC_ADAPTER.inventorySql,
    inventorySchema: a.inventorySchema || GENERIC_ADAPTER.inventorySchema,
    testCmd: a.testCmd || GENERIC_ADAPTER.testCmd,
    lenses: a.lenses || DEFAULT_LENSES,
    emitTestHint: a.emitTestHint || GENERIC_ADAPTER.emitTestHint,
    inventoryFlagHint: a.inventoryFlagHint || 'Flag every unit reachable by a wrong actor without a guard, every write path that guards its read but not its write, and every secret/PII field readable beyond its owner.',
    inventoryExecution: a.inventoryExecution || DEFAULT_INVENTORY_EXECUTION,
    guardExamples: a.guardExamples || DEFAULT_GUARD_EXAMPLES,
    credentialsHint: a.credentialsHint || DEFAULT_CREDENTIALS_HINT,
    proverTargets: a.proverTargets || DEFAULT_PROVER_TARGETS,
    scopeUnits: a.scopeUnits || DEFAULT_SCOPE_UNITS,
  }
}
