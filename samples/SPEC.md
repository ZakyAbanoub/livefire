# livefire sample apps — seeded holes with known answers

Each preset is **proven** only when livefire, run against a small app on that stack, reports
**every seeded hole as CONFIRMED-strong** and reports **zero false positives** on a clean twin
with the same holes fixed (the CONTRIBUTING.md bar). This directory holds those apps.

```
samples/<preset>/
  vulnerable/          the app with the five seeded holes
  clean/               the same app, every hole fixed (the diff to vulnerable/ is ONLY the fixes)
  ANSWERS.json         the answer key (see below) — never shown to livefire
  README.md            how to bring it up, the ports, the seeded users, the hole → fix table
```

`vulnerable/` and `clean/` are each a self-contained repo root (livefire is pointed at one of
them). Each has `docker-compose.yml`, the app source, a seed, and `selftest.sh`.

## The domain (identical on every stack, so results compare across stacks)

A tiny multi-tenant notes app.

- `orgs(id, name)` — the tenant.
- `users(id, email, password_hash, api_token)` — `api_token` is a SECRET (only its owner may read it).
- `memberships(user_id, org_id, role)` — role ∈ `owner | member`.
- `notes(id, org_id, author_id, title, body)` — tenant data.

Seed (same ids everywhere):

| user  | email          | password   | membership        |
|-------|----------------|------------|-------------------|
| alice | alice@acme.test | `password1` | owner of org 1 (Acme) |
| bob   | bob@acme.test   | `password1` | member of org 1 (Acme) |
| carol | carol@globex.test | `password1` | owner of org 2 (Globex) |

Notes: two in org 1 (by alice), one in org 2 (by carol). Every user has a non-empty `api_token`.

Actors in livefire terms: **anon** = no credentials; **outsider** = carol acting on Acme;
**insider-wrong-role** = bob (member) doing an owner-only action in Acme.

## The five seeded holes (the vulnerable app has exactly these; the clean app has none)

| id | class (family) | the hole | wrong actor that exploits it | proof (ground truth, direct DB read) |
|----|---|---|---|---|
| H1 | `anon-privileged-op` | a privileged operation — "purge an org's notes" — callable with NO authentication (Postgres: a SECURITY DEFINER function with the default PUBLIC EXECUTE and no auth check; app-tier: an admin route with no auth middleware) | anon | notes of org 1 are gone |
| H2 | `write-guard-gap` | updating a note checks the caller may edit the row it READS but lets the body set `org_id` (Postgres: an UPDATE policy with USING but no WITH CHECK; app-tier: mass-assignment of `org_id`) → a member moves a note into another tenant | insider-wrong-role (bob) | the note's `org_id` changed to 2 |
| H3 | `missing-guard` | listing an org's members (with emails) has NO auth at all | anon | (read) response lists Acme members' emails |
| H4 | `idor-unscoped-query` | reading a note by id is authenticated but not tenant-scoped (`WHERE id = $1` only) | outsider (carol) | (read) carol receives an Acme note body |
| H5 | `secret-over-share` | the org member listing returns every member's `api_token` to any member (Postgres: a SELECT policy on users that lets org-mates read all columns) | insider-wrong-role (bob) | (read) bob receives alice's `api_token` |

The clean twin fixes each at its root: H1 requires an owner (and on Postgres REVOKEs EXECUTE from
PUBLIC/anon), H2 re-checks tenancy on write (WITH CHECK / field allowlist), H3 requires membership,
H4 scopes by the caller's orgs, H5 never returns `api_token` except to its owner.

## Blindness rules (otherwise the test measures nothing)

- **No hint in the code.** No comment, name, commit message or file in `vulnerable/` or `clean/`
  may label a hole ("vulnerable", "TODO fix", "hole", "H1", "insecure", "intentionally"…). The
  code must read like an ordinary app that happens to have these bugs. The hole → location map
  lives ONLY in `ANSWERS.json` and `samples/<preset>/README.md`, outside both app roots.
- **livefire never sees the sample tree.** `samples/run-sample.sh` copies one app root to an
  isolated directory (`$TMPDIR/livefire-samples/<preset>-<variant>`), `git init`s it with one
  commit on `main`, and points livefire's `repoRoot` there — so no agent can `ls ..` into the
  answer key or diff against the clean twin.
- `selftest.sh` and `README.md` inside an app root describe the app and its seeded users only.
  `selftest.sh` is removed from the isolated copy before the run (it names the exploits).

## `selftest.sh` — ground truth independent of livefire

Each app ships a script that, against the running stack, exploits every hole as the named wrong
actor and confirms it with a direct DB read (not the HTTP status). It prints one line per hole:
`H1 LANDED` / `H1 REFUSED`, and exits 0 only when the result matches the directory:
every hole `LANDED` in `vulnerable/`, every hole `REFUSED` in `clean/`. It also checks the
happy path (alice can create, read and update a note in Acme) in both. A sample is not done until
`selftest.sh` passes in both directories — that is what makes the answer key trustworthy.

## `ANSWERS.json`

```json
{
  "preset": "express",
  "holes": [
    { "id": "H1", "family": "anon-privileged-op", "file": "src/routes/admin.js", "symbols": ["purge", "/admin/orgs/:id/purge"] }
  ]
}
```

A livefire finding matches a hole when its `file` ends with the hole's `file` (path-normalised)
OR its title/description/reason mentions one of the hole's `symbols` (case-insensitive) — and it
is **CONFIRMED-strong** (≥2 modalities). Scoring: `node samples/score.mjs <result.json> <ANSWERS.json> [--clean]`.

## Ports (so stacks never collide; only one stack runs at a time on the 8 GB docker VM)

| preset | app | db |
|---|---|---|
| express | 18010 | 15410 |
| nestjs | 18011 | 15411 |
| django | 18012 | 15412 |
| fastapi | 18013 | 15413 |
| flask | 18014 | 15414 |
| rails | 18015 | 15415 |
| laravel | 18016 | 15416 |
| symfony | 18017 | 15417 |
| spring | 18018 | 15418 |
| aspnet | 18019 | 15419 |
| go | 18020 | 15420 |
| strapi | 18021 | 15421 |
| hasura | 18022 | 15422 |
| firebase | 18023 (emulator UI off; firestore 18123, auth 18223) | — |
| nextjs | 18024 | 15424 |
| supabase | Supabase CLI stack with ports 55421–55429 | 55422 |

`clean/` uses the same ports (never run both at once).
