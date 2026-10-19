# livefire

**Verify by exploiting, not by reading.**

livefire is a pre-merge verification and security-audit skill for Claude Code. It does not stop
at reading your code and guessing where the holes are. It brings the app's permission model up
as data, attacks every surface **for real against your local database** from three attacker
positions, and keeps only the findings that two independent methods agree on. Every confirmed
finding comes with a regression test that fails until the hole is fixed.

```
anon (no login)           ──┐
outsider (other tenant)   ──┼──►  your app + local DB  ──►  direct SQL read: did the write land?
insider with wrong role   ──┘
```

## Why it exists

On a real branch of a production multi-tenant app, three code-reading reviews by the same model
found 2 issues. One live-database run found **13**, 3 of them Critical and already in production:
anonymous users could hard-delete every tenant's trash, read the cron secret and wipe the audit
log; a teammate could read another user's plaintext OAuth refresh token. The model was the same.
The difference was the **method**, and livefire encodes that method.

## What a finding looks like

A real finding from a run on the Next.js sample app in this repo (`samples/nextjs`), shortened:

```
CRITICAL · CONFIRMED-strong (static + empirical) · family: missing-authz-guard
POST /api/admin/orgs/[orgId]/purge (app/api/admin/orgs/[orgId]/purge/route.ts:9)
No session, membership or owner check before prisma.note.deleteMany({ where: { orgId } }).
The middleware is no guard: its matcher excludes /api, and it only checks that a cookie exists.
The sibling route .../stats does check session → membership → owner; purge has none of it.
Evidence: planted org 4 with 2 notes; POST with NO cookie → 200 {"deleted":2};
          SELECT count(*) FROM notes WHERE org_id = 4  →  0.  Real tenants untouched.
Fix: the same session → membership → role chain as stats, in one shared helper.
RED test: no cookie → 401, outsider → 404, member → 403; the count must stay 2 after each.
```

In the same run the prover also called a Server Action over HTTP as a plain member (it read the
action id from the public JS chunk) and showed that one `prisma.note.update({ data: input })`
lets that member move a note to another tenant, overwrite the author's API token through a nested
`author.update`, and promote themself to owner through a nested `org.update.memberships`.

## Status — what is proven and what is not

Be precise about this before you rely on it. "Proven" means livefire was run end to end on a
real app of that stack and its findings were checked against ground truth.

| stack / mode | status | evidence |
|---|---|---|
| **Next.js + Supabase** (`supabase` preset) | ✅ proven | Whole-surface runs on a production app (~210 migrations, 100 privileged functions, 135 policies). Compared on the same commit and database with the in-house harness it replaces: same instructions (enforced by `test/parity.test.mjs`), full inventory (100/100, 135/135 vs 20/100, 12/135), more confirmed findings (66 vs 54; 14 high vs 5). |
| **Next.js + Prisma + Postgres, own auth** (`nextjs` preset) | 🟡 smoke-tested | One capped run on `samples/nextjs` (4 agents, 1 per stage, 3.6M real tokens): auto-detected; mapped all 16 entry points (route handlers, Server Actions with their public action ids, middleware matcher, pages); the prover reproduced **all 5 seeded holes live**. Only 1 got its verifier under the cap, so 1 is `CONFIRMED-strong` and 4 are `CONFIRMED-weak`. An uncapped run + the clean twin: pending. |
| `express`, `hasura`, `django` | 🟡 sample apps ready | Seeded-hole apps with clean twins exist and their self-tests pass; livefire has not been scored on them yet. |
| the other 12 presets | ⚪ experimental | Detection and prompt construction are unit-tested; never run end to end. Expect to tune them. |
| single-agent mode (Cursor, Codex, Cline, API loops) | ⚪ experimental | The prompt is generated and unit-tested; not yet run inside another tool. |

A single run is never complete: on the same app, each whole-surface run also found holes the
others missed. For a release audit, run more than once or combine scopes.

## Requirements

- **Claude Code** with the **Workflow** tool (multi-agent orchestration). Without it, use
  single-agent mode (below).
- **Node 20+** and **git**. livefire has zero runtime dependencies.
- **A local, disposable copy of your stack, running**: the app and its database. livefire plants
  rows and runs real exploits; it refuses managed and production hosts (see Safety).

## Install

As a Claude Code plugin:

```
/plugin marketplace add ZakyAbanoub/livefire
/plugin install livefire@livefire
```

Or from a clone:

```bash
git clone https://github.com/ZakyAbanoub/livefire
cd livefire
node install-skill.mjs      # copies the five skills into ~/.claude/skills/
```

Reload Claude Code. You get five commands:

| command | what it does |
|---|---|
| `/livefire [feature\|whole]` | the full verification / audit |
| `/livefire-map` | read-only map of the authorization surface: cheap, not a verdict |
| `/livefire-config` | interview → save `livefire.config.mjs`, so later runs need no questions |
| `/livefire-prompt` | print the single-agent prompt for tools without a Workflow tool |
| `/livefire-add-preset` | scaffold a preset for a stack that is not covered yet |

## Quickstart

1. **Start your stack locally** (app + database), e.g. `docker compose up -d` and `npm run dev`.
2. **Tell livefire what a preset cannot know** — put a `livefire.config.mjs` in your repo root.
   This is the biggest quality lever. Example for Next.js + Prisma with your own auth:

   ```js
   export default {
     repoContext: 'Multi-tenant app: orgs + memberships(role owner|member). Sessions are a sessions table + an httpOnly cookie (lib/auth.ts). Money lives in invoices/payments.',
     db: 'App on http://127.0.0.1:3000, Postgres on 127.0.0.1:5432 (DATABASE_URL in .env). Ground truth: `docker compose exec -T db psql -U app -d app -c "<SQL>"`.',
     actors: 'Create users with prisma/seed or POST /api/auth/register, log in with POST /api/auth/login and reuse the session cookie.',
     testCmd: 'npm test',
   }
   ```
   (`livefire.config.example.mjs` lists every option. `/livefire-config` writes this file for you.)
3. **Run it** in Claude Code:
   - `/livefire feature` — this branch's changes (diff vs `main` + uncommitted work). Use it before every merge.
   - `/livefire whole` — the whole reachable surface. Use it for auth / tenancy / billing changes and periodic audits.
4. **Read the report**: findings by severity (`CONFIRMED-strong` · `CONFIRMED-weak` · `DISMISSED`
   with the check that blocks it), what was verified correct, what was not covered, and one
   RED-first regression test per confirmed finding. livefire discovers; it does not fix.

## Cost

livefire is thorough, and thoroughness costs tokens. There is no fixed number; cost grows with
the surface it must read and attack, and with how many findings it confirms.

| run | real tokens (measured) |
|---|---|
| whole-surface, production Next.js + Supabase app (~210 migrations) | ~100–170M |
| capped smoke run on the small Next.js sample (4 agents, 1 per stage) | 3.6M |

About 95% of that is cache reads: every agent re-reads its context on every turn. The Workflow
runtime's own `tokens` counter leaves cache reads out; measure real usage with
`node tools/tokens.mjs --transcripts <workflow dir>`.

Controls, all in `livefire.config.mjs`:

- **Scope.** `feature` is far cheaper than `whole`; use whole-surface on purpose.
- **Agent budget.** `maxAgents` per stage (default 120) and `maxAgentsTotal` per run (default 400,
  never above 900). Past the budget work is dropped, never silently: every drop is logged and
  listed in `result.budget`. `budget.dropped > 0` means coverage is partial.
- `siblingBatchSize` (default 8): sweep siblings verified per agent.
- `inventoryMode`: `both` (default) runs the static lenses on the full and on a compact inventory,
  because each view finds holes the other misses; `full` or `compact` run one view, ~20% cheaper.
- `maxCriticRounds` (1–4, default 3): completeness-critic rounds.

## How it works

```
Stage 0   resolve      config file → auto-detect the preset → or interview you
Stage 0b  inventory    dump the live authz model as data (grants + policies, or route → guard map)
Stage 1   pre-gate     typecheck / lint / build / unit tests — fail fast
Stage 2   static       one independent reviewer per lens (authz, input, tenant scope, billing,
                       secrets/cron/external, happy path)
Stage 3   prover       three-actor matrix against the live DB; a direct ground-truth read is the evidence
Stage 4   verify       an adversarial verifier tries to refute each candidate
Stage 5   sweep        one confirmed finding → search every unit for the same root cause
Stage 6   critic       "what did we not cover?" → gap-closing rounds until dry or the round limit
Stage 7   report       findings + coverage note + RED-first tests
```

The six rules it never weakens on a security pass:

1. **The whole reachable surface, not the diff.** Latent holes live in code the change never touched.
2. **Run the exploit, don't just read it.** Every write is confirmed by a direct read that bypasses the app.
3. **Three actors.** anon · authenticated outsider · insider with the wrong role. The question is
   always "is the wrong actor refused?", never "can the right one do X?".
4. **Enumerate the live permission model mechanically.** A default grant (e.g. Postgres `PUBLIC`
   EXECUTE) is invisible in source code; read the live state.
5. **Recently hardened code is a priority target, never a skip.** The fix is often incomplete.
6. **Sweep by root cause.** One confirmed finding means: find all its siblings.

**Cross-modal confirmation.** A finding is `CONFIRMED-strong` only when at least two methods agree
(a reviewer flagged it and the prover reproduced it live). One method alone gives
`CONFIRMED-weak`. A method that actively refutes it gives `DISMISSED`, with the blocking check cited.

## Presets

Stacks fall into three families by **where authorization lives**, which is why a few presets
cover a lot:

| family | where authz lives | presets |
|---|---|---|
| A — in the datastore | row policies / rules the store enforces | `supabase`, `hasura`, `firebase` |
| B — in application code | route guards, policies, middleware | `nextjs`, `express`, `nestjs`, `django`, `fastapi`, `flask`, `rails`, `laravel`, `symfony`, `spring`, `aspnet`, `go` |
| C — a CMS permission model | the CMS's roles and permissions | `strapi` |

livefire picks the preset in this order: a `livefire.config.{mjs,js,json}` in the repo root →
auto-detection from `package.json` and marker files (monorepo subfolders included) → an interview
(five questions) whose answers it offers to save as `livefire.config.mjs`.

**Another stack?** The pipeline (`skills/livefire/src/harness-core.js`) never names a database.
Only two things are stack-specific, and both live in a preset (`skills/livefire/presets/<stack>.js`):
how to enumerate the permission model, and how to build the three actors plus a ground-truth read.
Run `/livefire-add-preset`, or see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`PRESET-ROADMAP.md`](./PRESET-ROADMAP.md).

## Without the Workflow tool (single-agent mode)

For Cursor, Cline, Codex or a plain API loop: one self-contained prompt that one agent follows top
to bottom. Same method, sequential instead of parallel.

```bash
node skills/livefire/livefire-prompt.mjs /path/to/app --feature     # or --whole
node skills/livefire/livefire-prompt.mjs . --preset laravel
```

The trade-off: slower, and the lenses are not independent agents (one agent sees its own earlier
work), so cross-checking is weaker. Prefer the Workflow mode when you have it.

## Safety

The prover plants rows and runs real exploits, so it must target a **local, disposable** database.
`skills/livefire/src/safety.js` is a fail-closed gate the controller calls before launch:

- it **refuses** managed and production hosts (`supabase.co`, `rds.amazonaws.com`, `neon.tech`,
  any public domain or IP, any host containing `prod`) and anything it cannot confirm is local;
- it **allows** loopback, `localhost`, `*.local` / `.internal` / `.test`, `host.docker.internal`,
  or hosts you list in `allowHosts`;
- it **requires an explicit opt-in to mutate** (`allowMutations` or `LIVEFIRE_ALLOW_MUTATIONS=1`).

The prover repeats the check, records every row it plants and deletes only those rows at the end.
Never point livefire at production.

## Development

```bash
npm test          # the whole suite (stub runtime: no tokens spent)
npm run check     # build dist/livefire.workflow.js and syntax-check it
node install-skill.mjs   # after editing sources, reinstall into ~/.claude/skills
```

Proving a preset uses the sample apps in `samples/` (see [`samples/SPEC.md`](./samples/SPEC.md)):
the same tiny multi-tenant notes app on each stack, with five seeded holes, a clean twin, a
self-test that exploits every hole and confirms it in the DB, and an answer key livefire never
sees. A preset is proven when a blind run reports every seeded hole as `CONFIRMED-strong` and
reports nothing on the clean twin:

```bash
samples/prepare-run.sh nextjs vulnerable          # isolated blind copy + the Workflow args
node samples/score.mjs <result.json> samples/nextjs/ANSWERS.json
```

## Layout

```
.claude-plugin/          plugin + marketplace manifests
skills/livefire/         the core skill
  SKILL.md               how the controller drives the pipeline
  src/harness-core.js    the stack-agnostic pipeline
  src/adapter.js         the preset contract + generic fallback
  src/detect.js          config file → auto-detect → interview
  src/safety.js          the local-only database gate
  src/budget.js          agent budget + root-cause family keys
  src/single-agent.js    the single-agent prompt
  presets/               16 presets + TEMPLATE.js
  dist/                  the assembled workflow (generated: run npm run check)
skills/livefire-*/       map, config, prompt, add-preset
samples/                 seeded-hole apps used to prove presets
test/                    the test suite (stub Workflow runtime)
tools/                   token measurement from run records and transcripts
```

## License

MIT — see [`LICENSE`](./LICENSE).
