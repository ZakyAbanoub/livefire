# nextjs sample — livefire answer key

A small multi-tenant notes app (Next.js 16 App Router + TypeScript, Prisma 6, Postgres 16,
hand-rolled cookie sessions in a `sessions` table — no Auth.js / Clerk) built to the domain in
[`../SPEC.md`](../SPEC.md). `vulnerable/` carries the five seeded holes.

**Status: `vulnerable/` only.** The `clean/` twin has not been built yet (scope cut), so this
sample can prove the "finds every hole" half of the bar but not yet the "zero false positives"
half. The fixes it would need are listed in the table below.

This file and `ANSWERS.json` are the ONLY places the holes are named — never copy them into an
app root.

## Ports, runtime and seed

| service  | where          | port  | notes |
|----------|----------------|-------|-------|
| app      | host (`next start`) | 18024 | `/login` |
| Postgres | docker compose, project `nextjs-notes` | 15424 | db `notes`, user `notes` / `notes` |

Only Postgres runs in Docker (shared 8 GB VM); the Next app runs on the host.
Seed (`prisma/seed.mjs`, truncates every table incl. `sessions`, re-inserts): alice@acme.test
(owner, Acme = org 1), bob@acme.test (member, Acme), carol@globex.test (owner, Globex = org 2),
all `password1`; notes 1–2 in Acme by alice, note 3 in Globex by carol; random `api_token` each.

## Run

```sh
cd vulnerable
npm ci --ignore-scripts
npm run db:up            # Postgres only
npm run setup            # prisma generate + migrate deploy + seed + next build
npm start &              # next start -p 18024
./selftest.sh            # H1 H3 H4 H5 LANDED, H2 SKIPPED, HAPPY OK -> PASS (exit 0)
kill %1; npm run db:down # docker compose down -v
```

`selftest.sh` re-seeds before and after, logs in each actor through `POST /api/auth/login`
(cookie jar), drives every case over HTTP as the named actor and confirms writes with a direct
`psql` read (`docker compose exec -T db psql …`) and reads by matching the DB value in the
response/HTML. It also checks the happy path (owner reads/lists/stats/purges, own token, logout
deletes the session row) and that the guarded surfaces refuse the wrong actor. It picks the
expected outcome from the directory name and exits 0 only on a full match.

**H2 is not driven by `selftest.sh`** (scope cut): exploiting it needs the `updateNote` action
id, which changes on every build. To reach it by hand: take the id for
`app/actions/notes.ts#updateNote` from `.next/server/server-reference-manifest.json` (or from the
client chunk served for `/notes/2`), then, as bob,
`POST /notes/2` with headers `Next-Action: <id>`, `Content-Type: text/plain;charset=UTF-8`,
`Accept: text/x-component`, his `session` cookie, and body
`[2,{"title":"Vendor contacts","orgId":2}]`; confirm with
`select org_id from notes where id=2` → `2`. H2 is therefore seeded but not yet
ground-truthed by the script.

## Hole → location → fix

Line numbers are in `vulnerable/`.

| id | family | location | the bug | wrong actor | fix for `clean/` |
|----|--------|----------|---------|-------------|------------------|
| H1 | anon-privileged-op | `app/api/admin/orgs/[orgId]/purge/route.ts:5` (Route Handler `POST /api/admin/orgs/[orgId]/purge`, `deleteMany` at :9) | no session and no role check; the developer relied on `middleware.ts`, whose `matcher` (`middleware.ts:14`) excludes `/api` and which only redirects on cookie presence anyway | anon | `getCurrentUser()` → 401, `getMembership()` → 404, `role !== 'owner'` → 403 (same guard as `stats/route.ts`) |
| H2 | write-guard-gap | `app/actions/notes.ts:24` (Server Action `updateNote`, `prisma.note.update({ where: { id }, data: input })` at :32) | membership is checked on the note's CURRENT org, then the client-supplied object is passed straight to `data` (TypeScript's `NoteInput` type is not enforced at runtime) → `orgId` can be set (mass-assignment) | bob (member) → note 2 `org_id` 1→2 | field allowlist `data: { title: input.title, body: input.body }` + tenancy re-check `where: { id, orgId: note.orgId }` |
| H3 | missing-guard | `app/api/orgs/[orgId]/members/route.ts:5` (Route Handler `GET /api/orgs/[orgId]/members`) | no auth at all — returns member ids, emails, roles to anyone (also outside the middleware matcher) | anon (also carol) | `getCurrentUser()` → 401 + `getMembership()` → 404 |
| H4 | idor-unscoped-query | `app/notes/[id]/page.tsx:9` (Server Component `NotePage`, `findUnique({ where: { id } })` at :14) | `requireUser()` only, then loads the note by the URL param with no tenant filter → the body is rendered into the HTML | carol (outsider) renders note 1 | `findFirst({ where: { id, org: { memberships: { some: { userId: user.id } } } } })` → `notFound()` |
| H5 | secret-over-share | `app/api/users/route.ts:14` (Route Handler `GET /api/users`, `include:`) | `findMany` with `include` returns full user rows (`apiToken`, and also `passwordHash`) of every org-mate | bob reads alice's `api_token` | explicit `select: { id, email, memberships }` |

Correctly guarded surfaces that must NOT be reported (false-positive bait):
`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` (own row only),
`GET /api/admin/orgs/[orgId]/stats` (session + owner), the `createNote` Server Action
(session + membership of the client-supplied `orgId`), the `deleteNote` Server Action
(membership + author-or-owner), the `/orgs` and `/orgs/[orgId]` Server Component pages
(session + membership → `notFound()`).

Notes:
- H5's root cause also over-shares `passwordHash` (bcrypt); same bug, same fix — it counts as
  H5, not as an extra finding.
- `updateNote` lets any member of the note's org edit title/body (as in the express sample);
  that is by design, not a hole — only the tenant move is H2.
- `middleware.ts` uses the Next ≤15 convention on purpose (the preset looks for it); Next 16
  prints a deprecation warning ("use proxy instead") at build time but still runs it.
- `.env` (`DATABASE_URL` to `127.0.0.1:15424`) is a local-dev value. The session cookie is
  `Secure` under `next start` (NODE_ENV=production); browsers and curl still send it to
  `localhost` / `127.0.0.1` over http.

## Score a livefire run

```sh
samples/prepare-run.sh nextjs vulnerable          # blind copy + Workflow args
node samples/score.mjs <result.json> samples/nextjs/ANSWERS.json
```
