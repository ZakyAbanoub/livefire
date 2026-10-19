---
name: livefire
description: Use after finishing a feature or branch, before merge — to rigorously verify it, and as a standalone security audit. At launch it ASKS the scope — (A) FEATURE pass, focused on this branch's new code (branch diff vs main + uncommitted/untracked working tree), or (B) WHOLE-SURFACE pass, the entire reachable app regardless of the diff. Its core is empirical: it RUNS the code against a live DB from three actor positions (anon / authenticated outsider / wrong-role insider), planting rows and confirming every write with a direct service-role SELECT — because reading code alone misses most real access-control holes. It first dumps the live privilege + policy catalog (SECURITY DEFINER grants, RLS USING vs WITH CHECK, secret columns), fans out static reviewers per lens, sweeps each confirmed finding's root-cause family across every table/function, refutes adversarially, keeps only ≥2-modality-confirmed findings, loops a completeness critic until dry, and emits RED-first regression tests. Multi-agent; runs as a Workflow.
---

# livefire

A verification and security-audit harness — **stack-agnostic via presets** (Supabase/Postgres
shipped; any DB/framework via an adapter). Launch it when a feature or branch is code-complete
and you want confidence — before merge — that it is **correct**, **secure**, and **actually
works for the user**. Its method is the one that works: **read the code, run the code, walk the
user story** — and trust only what more than one modality confirms.

> **livefire exists because a code-read-only fan-out missed 11 of 13 real holes** on a real
> branch, including 3 Criticals live on prod, that a live-DB run found in minutes. Same model —
> the gap was method. The six rules below are the fix; do not weaken them for a security pass.

> ## ⚠️ Token cost — read before a whole-surface run
> livefire fans out to many subagents that each read real source and — in the prover — run
> against the live stack. **There is no fixed token number: the cost scales with the codebase.**
> The more code it must read and exploit, and the more findings surface (each confirmed finding
> spawns its own verifier + family sweep), the more tokens it uses. A **whole-surface** pass on
> a large, mature codebase can be **expensive**; a **feature/diff** pass is far cheaper because
> it concentrates on the changed code. Point it at a lot of code and it will use a lot of tokens
> — inherent, not a bug. Prefer feature scope for routine pre-merge checks; reserve whole-surface
> for auth/RLS/billing/tenant changes and periodic full audits.

## Invocation — one command, the controller does everything

When the user runs **`/livefire`** (optionally `/livefire feature` or `/livefire whole`, or with
a target repo path), do the whole flow end-to-end — the user should NOT run the pipeline steps by
hand:

1. **Locate assets.** This skill is self-contained: its scripts live in this skill's own
   directory, right next to this SKILL.md (`./src/`, `./dist/`, `./presets/`,
   `./livefire-prompt.mjs`). Let `SKILL_DIR` be that directory (you know its absolute path from
   how this skill was loaded) and run every `node …` below against it.
2. **Bring up the local stack** in the target repo if needed (for Supabase:
   `npx supabase status` → if down, `npx supabase start`). Never a remote/prod DB.
3. **Build if stale** — if `<SKILL_DIR>/dist/livefire.workflow.js` is missing, `node <SKILL_DIR>/build.mjs`.
4. **Safety gate (Stage 0b)** — `assertLocalDbTarget(dbTarget, { allowMutations: true })` from
   `<SKILL_DIR>/src/safety.js`. If it throws, STOP and show the message.
5. **Resolve the adapter (Stage 0)** — `resolveLaunchConfig(repoRoot)` from
   `<SKILL_DIR>/src/detect.js`. Announce `adapter (source)`. If `needsInterview`, run the interview
   and offer to save `livefire.config.mjs`.
5b. **Project context (the lever a preset cannot supply).** A preset knows the STACK; it does not
   know THIS app. Unless the repo's `livefire.config.mjs` already carries them, author — from the
   repo's CLAUDE.md/README, its migrations and its test setup — and write into the config:
   `repoContext` (the tenancy/ownership model, the privileged layers — money, OAuth, billing,
   cron — and the change under review as a rule-5 priority target), `db` (the exact local
   connection + where the local admin key lives), `actors` (how to mint the outsider / wrong-role
   insider on this app), `testCmd`, and `extraLenses` for any surface the default six miss.
   These are APPENDED to the preset text (preset safety guidance stays). This is exactly what
   the original in-house harness always passed at launch; without it the agents audit a generic app.
6. **Pick scope (Stage 0a)** — from the `/livefire` arg (`feature`/`whole`), else ask.
7. **Launch** — build the args mechanically, never by hand:
   `node <SKILL_DIR>/livefire-args.mjs <absolute repoRoot> --whole|--feature` prints
   `{"cfg":{...}}` — the preset id STRING, the project overrides from `livefire.config.mjs`, the
   scope, and `repoRoot` (agents run in the SESSION's cwd, which need not be the audited repo —
   every agent is told to `cd` there). Launch Workflow with
   `scriptPath: <SKILL_DIR>/dist/livefire.workflow.js` and exactly that object as `args`. **The
   preset travels as a small STRING, never the whole adapter object** — the full REGISTRY is
   inlined in the workflow; a large nested adapter gets DROPPED in Workflow-args transit. The
   workflow parses cfg defensively (object OR stringified JSON) and **self-heals** — if the preset
   didn't arrive it re-detects the stack at runtime and, failing that, a generic run still probes
   for Postgres and dumps the full catalog (never blind). Only a genuine custom/interview adapter
   is passed as `cfg.adapter`, kept minimal.
   The first log line must name the preset AND list the project overrides you expect
   (`project overrides: repoContext, db, …`) — if the overrides are missing, they were dropped.
   **ENFORCED GATE — do NOT let a blind generic run burn tokens:** after launch, read the first log
   line. If it says `adapter: generic` AND the repo probe matched a known DB stack (e.g. Supabase),
   ABORT the run immediately and tell the user: "preset did not propagate and self-heal failed —
   pin it with a `livefire.config.mjs` (`export default { preset: 'supabase' }`) in the repo root,
   then re-run." A whole-surface pass costs millions of tokens; a blind generic run must fail fast,
   not proceed. Expect the inventory to report `policies > 0` on a mature DB — `policies: 0` on a
   138-migration Supabase app means the dump was blind or truncated; STOP.
   **Resuming after a session restart:** a run the harness reports as `stopped` may still be
   alive. On 2026-09-24 a resume started a second pipeline next to the first one: double cost,
   and two provers on one DB. Before `resumeFromRunId`, confirm the old run is dead: stop it
   (TaskStop), or check that `journal.jsonl` in its transcript dir has not grown for several minutes.
   If the host has **no Workflow tool**, fall back to single-agent mode:
   `node <SKILL_DIR>/livefire-prompt.mjs <repo> --feature|--whole`.
8. **Report (Stage 7)** — the findings table + coverage note, and emit the RED-first tests.

> **Turnkey / arg-drop-proof:** the highest-precedence, transit-immune way to pin the stack is a
> `livefire.config.mjs` at the target repo root: `export default { preset: 'supabase' }` (see
> `livefire.config.example.mjs`). With it, resolution never depends on how `cfg` is passed.

Everything below is the detailed method the stages above execute.

## The six load-bearing rules (do not skip for a security pass)

1. **Whole reachable surface, not the diff.** Audit every privileged function (SECURITY
   DEFINER / owner / service-role), every RLS policy, every route — *old* migrations included.
   Latent holes live in code the current change never touched. The diff is a focus hint, not a
   boundary.
2. **Run the exploit, don't just read it.** Execute each candidate against a live local DB and
   confirm every write with a direct service-role/admin SELECT. Escalation chains (a permissive
   INSERT policy + a downstream trigger) look harmless line-by-line and reveal themselves only
   when executed. A green code-read is not evidence.
3. **Three-actor matrix.** Attack every surface as **anon** (no JWT, the shipped public/anon
   key), **authenticated outsider** (zero membership), **authenticated insider with the wrong
   role** (plain member / non-owner admin). The test is "is the WRONG actor refused", never
   "can the right actor do X".
4. **Enumerate live grants + policies mechanically.** Dump the catalog before reviewing — a
   default grant (Postgres `PUBLIC` EXECUTE) is the *absence* of a REVOKE and is invisible in
   the function source. Read the live state, not the migration text.
5. **Recently-hardened code is a PRIORITY re-audit target, never a skip.** "Already fixed,
   don't re-flag" is a self-inflicted blind spot — the fix itself is often incomplete.
6. **Sweep by root-cause family.** When one finding is confirmed, name its pattern and sweep
   EVERY function/table for the same shape — find all siblings, not just the first.

## Cross-modal confirmation

A single modality lies. A code reader infers a missing guard that a live policy actually
blocks (false positive); a green test proves *something* returned success, not that the right
row changed (false negative). So a finding is `CONFIRMED-strong` only when ≥2 modalities agree
(a reader flagged it AND the prover reproduced it live). One-modality items are
`CONFIRMED-weak`. Items a modality actively refuted are `DISMISSED` with the blocking
`file:line` (or the blocking policy/grant) cited. The empirical modality (rule 2) is the tie-
breaker and the strongest evidence class.

## When to use

- After a feature / branch is code-complete, before merge or deploy.
- As a standalone security audit of a running app.
- After any change touching auth, RLS, billing, or a multi-tenant boundary.

**Not** for: a trivial one-file change (run its test); a pure-docs change; brainstorming a
not-yet-built feature.

## Preconditions

- A git repo with a comparison base (usually `main`).
- A way to bring up the real stack locally (Supabase `supabase start` + a test DB, docker-
  compose, or the app's integration harness) AND to connect three clients: an **admin /
  service-role** client (for planting + the confirming SELECT), a **user-scoped** client (anon
  key + `signInWithPassword`, for the insider/outsider actors), and an **anon** client (the
  bare public key, no session).
- If the project has no live DB, the empirical modality degrades to running the real
  integration/E2E paths — never delete it, downgrade it, and say so in the report.

## Portability — any stack, not just Next.js/Supabase

The **method is stack-agnostic**: read the code · run the exploit · walk the user story ·
three-actor matrix · cross-modal confirm · root-cause family sweep. That never changes. What is
stack-specific is **two adapter points**, both isolated in a **preset** (`presets/<stack>.js`,
implementing the `VerifyAdapter` contract in `src/adapter.js`) — the pipeline in
`src/harness-core.js` never names Postgres or any stack. The prose in this skill uses the
Supabase/Postgres preset as its worked example.

To run on a different stack, at Stage 0b **re-map the two adapters** (and say in the report
which mechanism you enumerated):

1. **The authz inventory (`CFG.inventorySql` / rule 4).** "Dump the live permission model" is
   universal; *where* the model lives is not:
   - **Postgres + RLS** (Supabase, raw Postgres): `pg_proc` EXECUTE grants + `pg_policies`
     USING/WITH-CHECK — the shipped default.
   - **Strapi**: the enforcement is Strapi's own layer, not Postgres RLS. Enumerate the
     `up_permissions_*` / role–permission tables + each content-type's route `config.policies`
     and controller `find/findOne` scoping — that is the real access-control surface.
   - **Spring / Java, Rails, Django, Laravel, Express, etc.**: authz lives in code (method
     security `@PreAuthorize`, policy objects, `before_action`, DRF permission classes,
     middleware guards). "Inventory" = enumerate every route → its guard, and every ORM query
     that omits a tenant/owner filter. The DB grant dump degrades to "n/a (authz is in the app
     tier)" — log that, don't skip the stage.
   - **Any DB without row-level policies** (MySQL, Mongo): there is no policy catalog to dump;
     the whole authz burden is in the app tier → inventory the route→guard map as above.
2. **The three actors (`CFG.actors` / `CFG.db`).** Always the same three positions — **anon** /
   **authenticated outsider** / **wrong-role insider** — constructed the stack's way: a Supabase
   anon key + `signInWithPassword`; a Strapi JWT from `/api/auth/local`; a Spring session/JWT; a
   Rails cookie. The "confirming SELECT" is whatever reads ground truth directly, bypassing the
   app's own authz — a service-role client, a direct `psql`/DB connection, or an admin API.

Rule of thumb: if the stack has **a) HTTP/RPC endpoints with an authz layer** and **b) a store
you can read directly to confirm writes**, the full harness applies. The more the stack pushes
authz out of the DB and into code (Java/Spring is the extreme), the more Stage 3's evidence
comes from hitting endpoints as the three actors and confirming via a direct DB/admin read —
the RLS-catalog dump shrinks, the three-actor HTTP matrix does all the load-bearing work. The
skill does **not** silently assume Postgres; it assumes *some* enumerable authz model + *some*
ground-truth read, and you name both at launch.

## The pipeline

Runs as a Workflow. The launchable script is the UNIVERSAL `dist/livefire.workflow.js`, assembled
by `node build.mjs` from `src/adapter.js` + `presets/*` + `src/harness-core.js` (the full preset
REGISTRY is inlined). The controller resolves the adapter (Stage 0) and passes only the small
`cfg.preset` STRING to the workflow (never the whole adapter object — large args are dropped in
transit). The controller does stages 0–1 inline, then launches the workflow for stages 2–7.

### Stage 0 — Resolve the adapter (controller, inline)
Before scope, decide which `VerifyAdapter` runs. Call `resolveLaunchConfig(repoRoot)` from
`src/detect.js` (it defaults to the `presets/index.js` REGISTRY); it applies this precedence and
returns `{ adapter, source, cfg, needsInterview }`:

1. **`livefire.config.{mjs,js,json}`** in the repo root — a project that pins its own setup
   (preset or inline adapter, `db`, `testCmd`, `allowHosts`, default scope). Highest precedence
   after explicit CLI/skill args. See `livefire.config.example.mjs`.
2. **Auto-detect** — `buildRepoProbe(repoRoot)` reads `package.json` deps + Python/PHP/Go/Ruby
   manifest text + shallow file list; the first preset whose `detect()` matches wins. 16 shipped
   presets: **supabase, hasura, firebase** (declarative in-DB); **nextjs, express, nestjs, django,
   fastapi, flask, rails, laravel, symfony, spring, aspnet, go** (authz in code); **strapi** (CMS).
3. **Generic + interview** — no preset fits → `needsInterview` is true. Ask the five
   `INTERVIEW_QUESTIONS` (repoContext · db · actors · inventorySql · testCmd), build the adapter
   with `buildAdapterFromInterview(answers)`, run the pass, and **offer to save it** with
   `saveLivefireConfig(repoRoot, cfg)` so the next run is turnkey.

Announce the chosen adapter + source (e.g. "adapter: supabase (auto-detect)"). Then **launch the
workflow with `cfg.preset` = the resolved `adapter.id` STRING** (the REGISTRY is inlined in the
workflow, so a small string is all it needs) plus `cfg.securityPass` / `cfg.range` for scope.
Only a genuine custom/interview adapter (id not in the REGISTRY) is passed as `cfg.adapter`, kept
minimal. Build the universal workflow first if stale: `node build.mjs`. **Confirm the first
workflow log line names the expected preset, not `generic`.**

### Stage 0a — Choose scope (controller)
**Launch-arg shortcut — skip the prompt when the scope is already named.** Parse the skill's
invocation args (case-insensitive, first match wins):
- `whole` / `surface` / `security` / `all` / `full` → **(B) WHOLE-SURFACE**, no prompt.
- `feature` / `diff` / `branch` / `new` → **(A) FEATURE**, no prompt.
- anything else, or no arg → fall through to the question below.

Otherwise ask which pass to run (use the AskUserQuestion tool; skip only if the user already
named the scope in their launch request):

- **(A) FEATURE pass** — focus on this branch's new code. The "feature" = everything on the
  current branch not yet in `main`, plus the uncommitted/untracked working tree:
  - committed-on-branch: `git diff main...HEAD` (three-dot = vs the merge-base, so unaffected
    by `main` moving ahead);
  - not-yet-committed: `git status --porcelain` + `git diff HEAD` + untracked files.
  Deep fan-out and the prover concentrate on the functions/tables/routes this diff touches
  **and their reachable callees**. → launch with `cfg.securityPass = false`, `cfg.range =
  'main...HEAD'`.
- **(B) WHOLE-SURFACE pass** — the entire reachable app; the diff is ignored as a boundary
  (rule 1). Every SECURITY DEFINER function, every RLS policy, every route, old migrations
  included. → launch with `cfg.securityPass = true`.

**Recommend (B) when the change touches auth, RLS, billing, or a tenant boundary** — there the
focused pass can miss a latent sibling hole in untouched code.
(A) is the faster focus when the branch is self-contained and low-risk. Either way Stage 0b
still dumps the **whole** live catalog (it is cheap and rule 4 is non-negotiable); scope only
governs how wide the deep prover + fan-out reach, never whether the inventory is complete. If
the user is unsure, default to (B) — quality over speed.

### Stage 0b — Orient + inventory (controller, inline)
- Bring up the live stack **locally / disposably** — never a managed or production DB.
- **Safety gate (fail-closed, do this BEFORE any prover work):** call
  `assertLocalDbTarget(dbTarget, { allowMutations: true, allowHosts })` from `src/safety.js` on the
  exact DB connection you are about to hand the prover. It refuses managed/production hosts
  (supabase.co, rds.amazonaws.com, neon.tech, public domains/IPs, hosts containing "prod") and
  requires an explicit mutation opt-in. If you are running against an **allow-listed non-local host**
  (e.g. a staging project), ALSO call `assertKeyMatchesHost(serviceKey, dbTarget, { allowHosts })` —
  it binds the credential to the environment (for Supabase, the key's project `ref` must equal the
  host's; other stacks add a binder, or fall back to the allow-list + the prover's read-only env
  canary). If either throws, STOP and surface the message — do not launch. These are the primary
  guards; the prover carries second SAFETY / ENVIRONMENT-IDENTITY / SEED-LEDGER checks as
  defense-in-depth.
- **Mechanical inventory (rule 4):** dump the live catalog and hand it to every reviewer —
  - every SECURITY DEFINER / service-role function and **which roles hold EXECUTE**
    (`pg_proc` + `has_function_privilege('anon'|'authenticated', …, 'EXECUTE')`) → flag every
    `secdef` function reachable by anon/authenticated;
  - every RLS policy's `USING` and `WITH CHECK` per table (`pg_policies`) → flag USING-only
    UPDATEs and WITH-CHECK weaker than USING;
  - RLS-enabled tables with **zero** policies (deny-all — confirm intended);
  - columns holding secrets/PII (tokens, `raw` payloads, refresh tokens, unsubscribe tokens)
    vs the breadth of that table's SELECT policy.
- Derive the changed surface (`git diff main...HEAD` + working tree, per Stage 0a) regardless
  of scope — in a **feature** pass it bounds the deep fan-out; in a **whole-surface** pass it
  only prioritizes (rule 1: the diff is never the boundary).
- Choose the lenses (drop N/A, add project-specific): **authz / access-policy**, **input
  validation** (mass-assignment, injection), **cross-object / tenant-scoping**,
  **billing / entitlement**, **secrets / cron / external (SSRF)**, **functional happy-path**.

### Stage 1 — Fast pre-gate (controller, inline)
- Typecheck, lint, build, unit suite. Fail fast if red. Report what ran.

### Stage 2 — Static fan-out (workflow)
- `cfg.inventoryMode`: **`both` (default)** runs every lens twice, once with the full inventory and
  once with the compact one (every item on one line, text past 160 chars truncated). The candidates
  are merged on file:line + family key, and prover and sweep get the full view. Why: on a production
  multi-tenant Next.js + Supabase app (2026-09-26/27) the full view found 14 highs but 1 app-tier hole, the compact view 9 highs but
  10 app-tier holes; the full dump pulls reviewers toward the data tier. Costs one more static
  stage (≈+20%). `full` or `compact` select a single view; the result records `inventory_summary.mode`.
- One reviewer per lens, in parallel, each handed the **inventory** + the whole-surface
  instruction. Reviewers are not told each other's findings, and **not** told which code was
  "already hardened" (rule 5) — recently-touched security code is called out as a priority
  target, not a skip. Each candidate cites the guard it looked for and why it does not block.

### Stage 3 — Empirical prover, three-actor matrix (workflow)
- Bring up the stack; connect the anon, outsider, and wrong-role-insider clients. For every
  privileged function, every table INSERT/UPDATE/SELECT, and every cron in the inventory:
  - **guard-holds** — perform the forbidden action as each wrong actor → assert refused AND the
    store row is unchanged (service-role SELECT).
  - **gap-real** — perform each static candidate's action → observe whether it wrongly lands.
  - **happy-path** — walk the user story as the legitimate actor; assert each step works + landed.
- Plant the fixtures, run, confirm with a **direct service-role SELECT** (the evidence), clean
  up. Run prover work serially against a shared DB.

### Stage 4 — Adversarial verify + cross-modal (workflow)
- Each candidate gets an independent refuter (default refuted). It re-reads the cited location,
  searches for any existing check (policy, grant, trigger, membership check) that blocks it,
  and weighs the prover's live result. Output: confirmed?, confidence, corrected severity, the
  blocking check if dismissed, and which modalities agreed.
- Prover results nobody flagged are folded in, not dropped: a failing `gap_real`/`guard_holds`
  probe becomes an `empirical-only` finding, and a failing `happy_path_step` becomes a
  `functional-only` finding (a broken user flow must reach the report). Neither family is swept.

### Stage 5 — Root-cause family sweep (workflow) — the rule-6 stage
- For each CONFIRMED finding, extract its family pattern (missing REVOKE · WITH-CHECK tenancy
  gap · USING-only UPDATE · secret-column over-share · unvalidated privileged-function arg) and
  dispatch a sweep agent that checks EVERY function/table in the inventory for the same shape.
  New siblings re-enter Stage 4. This is how one flagged instance becomes the complete list.
- **Sweep once per root cause, first-pass families only.** A family is free text written by each
  verifier, so it is keyed by `canonFamily` (lowercase, parentheticals dropped, first `A / B`
  segment, slugged). Only first-pass verdicts (static lenses, critic gap rounds) seed a sweep; a
  sibling is verified and reported, but the family it names is never swept again (listed in
  `result.modalities.families_from_siblings_not_swept`). Duplicate siblings are verified once,
  most severe first, in batches: one agent verifies up to `cfg.siblingBatchSize` siblings of one
  family (default 8), each with its own evidence; a sibling left without a verdict is listed in
  `result.budget.unverified_siblings`. Why: re-sweeping sibling-coined families never converges — run
  `wf_7418b0da` (2026-09-23) coined 304 "families" and hit the runtime's 1000-agent cap (90.5M tokens).
- **Agent budget.** Every agent runs under `cfg.maxAgents` per stage (default 120) and
  `cfg.maxAgentsTotal` for the run (default 400, clamped to 900 < the runtime's 1000). Past the cap
  work is DROPPED, never silently: each drop is logged, and `result.budget` carries `per_stage`,
  `dropped`, `dropped_agents` and `unverified_siblings` (titles + location, for a follow-up run).
  A result with `budget.dropped > 0` has partial coverage — say so in the report.

### Stage 6 — Completeness critic (workflow, loop-until-dry)
- "What did we NOT cover — a function whose grants weren't dumped, a table not probed from all
  three actors, a happy-path branch not walked, a family not fully swept?" Its output is the
  next round's work list. Implemented in the workflow: each non-dry round runs a GAP-CLOSING agent
  (code-read + live 3-actor probe of every uncovered surface), verifies its new findings, sweeps their
  (first-pass) families, then asks the critic again — until dry or `cfg.maxCriticRounds` (default 3, max 4).
  Never silently cap — a non-dry final round is logged and returned in `result.critic.uncovered`.
- The inventory is also completeness-checked: it reports mechanically-counted `catalog_counts`;
  a dump shorter than its own count is re-run once, and if still short the result carries
  `inventory_summary.truncated = true` (never silently accepted).

### Stage 7 — Synthesize + emit tests (controller + workflow)
- Consolidate, dedup by family, classify (`CONFIRMED-strong` ≥2 modalities · `CONFIRMED-weak`
  one modality · `DISMISSED` with the blocking check). Write ONE report with a severity table,
  each finding (location, wrong-actor scenario, the direct-SELECT evidence, the fix, the
  family), a **VERIFIED-CORRECT** section (auditable negative space), and a coverage note
  (what ran, what degraded, what remains). For each CONFIRMED finding emit a **RED-first**
  regression test (fails without the fix, passes with it) paired with a direct store SELECT,
  plus a **sentinel** where the family allows one (e.g. asserting anon/authenticated lack
  EXECUTE on a function; asserting every cron route imports the constant-time secret check).

## Report format

```
# livefire — <branch/target> — <date>
Modalities: static(N lenses) · empirical(live-DB, 3-actor) · functional(happy-path)
Scope: <whole-surface | diff+catalog> · Rounds: <k> (critic dry at <k>)

## Findings   | # | sev | conf | modalities | family | location | one-line |
CONFIRMED-strong / CONFIRMED-weak / DISMISSED(check cited) sections.

## Verified correct    <high-risk areas checked and found guarded — auditable>
## Coverage note       <what ran, what degraded, what remains unprobed>
## Emitted tests       <RED-first test + sentinel per confirmed finding>
## Seeded data         <rows the prover planted (table + key + marker) · cleaned up? · any residue left, with how to remove it · external side-effects fired on a non-local host>
```

**After the report — seed cleanup:** the prover cleans up its seed by default (delete only its
ledgered rows, by primary key, never a broad DELETE). If any residue remains, list it. Then ask
the user whether to **keep** the seed data (opt-out) — only skip cleanup if they say so; otherwise
the default is remove. On a non-local (allow-listed) host, remind them cleanup does not undo
external side-effects (emails, webhooks, billing) the mutations may have triggered.

## Red flags — do not

- **Trust one modality.** A code-read "gap" with no live reproduction is `CONFIRMED-weak` at
  best; a green run with no code-read is not coverage.
- **Assert on a derived signal.** Pair every write with a direct store SELECT. HTTP 200 / a
  toast / a returned object proves nothing about the row.
- **Skip the wrong-actor probe.** "The right user can do X" is not the test.
- **Scope a security pass to the diff.** Old migrations are in scope.
- **Infer grants from source.** A default PUBLIC grant is invisible there — dump the catalog.
- **Skip "already hardened" code.** It is a priority re-audit target.
- **Stop at the first sibling.** Sweep the family.
- **Silently cap coverage.** Log what you did not reach.

## Notes

- **Stack setup lives in a preset, not in the pipeline.** To run on a new stack, add
  `presets/<stack>.js` (copy `presets/TEMPLATE.js`, implement the `VerifyAdapter` contract from
  `src/adapter.js`) and register it in `presets/index.js`, then **rebuild** (`node build.mjs`) so
  the new preset is inlined into the universal workflow. The controller then selects it by passing
  `cfg.preset: "<id>"`. 16 shipped presets across three authz families (in-DB:
  supabase/hasura/firebase · in-code: nextjs/express/nestjs/django/fastapi/flask/rails/laravel/symfony/
  spring/aspnet/go · CMS: strapi).
  If no preset matches, livefire falls back to the generic adapter and interviews you for the
  two adapter points, offering to save the answers as a `livefire.config.mjs`.
- **Safety guard (required for any live-DB run):** the prover plants rows and runs exploits —
  it MUST target a local/disposable DB. Enforced by `src/safety.js` `assertLocalDbTarget()`
  (Stage 0b) + the prover's own SAFETY check: managed/production hosts are refused fail-closed,
  and a mutating run needs explicit opt-in. Tested in `src/safety.test.mjs`.
- Plain JavaScript; runs under the Workflow tool. Omit `model` on subagents so the host's
  default subagent model applies, unless the user asks otherwise.
- **No Workflow tool?** Use single-agent mode: `node livefire-prompt.mjs <repo> [--whole|--feature]`
  (`src/single-agent.js`) prints one self-contained prompt a single agent follows sequentially —
  same 6-rule method, no fan-out (slower, weaker cross-lens independence). For Cursor/Cline/Codex/
  API loops.
- This skill discovers, it does not fix. The emitted tests are the RED starting point for the fix.
