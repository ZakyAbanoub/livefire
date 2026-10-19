# express sample — livefire answer key

A small multi-tenant notes API (Express 5 + Prisma 6 + Postgres 16, JWT bearer auth) built to
the domain in [`../SPEC.md`](../SPEC.md). `vulnerable/` carries the five seeded holes; `clean/`
is the same app with only those five spots fixed (`diff -ru vulnerable clean` shows nothing else).

This file and `ANSWERS.json` are the ONLY places the holes are named — never copy them into an
app root.

## Ports and seed

| service  | host port | notes |
|----------|-----------|-------|
| app      | 18010     | `GET /health` |
| Postgres | 15410     | db `notes`, user `notes` / `notes` |

Seed (re-applied on every app start by `prisma/seed.js`, which truncates and re-inserts):
alice@acme.test (owner, Acme = org 1), bob@acme.test (member, Acme), carol@globex.test
(owner, Globex = org 2), all with password `password1`; notes 1–2 in Acme by alice, note 3 in
Globex by carol; each user has a random `api_token`.

## Run

```sh
cd vulnerable            # or clean — never both at once (same ports, same compose project name)
docker compose up -d --build --wait
./selftest.sh            # vulnerable: H1..H5 LANDED + HAPPY OK;  clean: H1..H5 REFUSED + HAPPY OK
docker compose down -v
```

`selftest.sh` re-seeds before and after, drives every case over HTTP as the named actor and
confirms it with a direct `psql` read (`docker compose exec -T db psql …`), not the status code.
It picks the expected outcome from the directory name and exits 0 only on a full match.

## Hole → location → fix

Line numbers are in `vulnerable/`.

| id | family | location | the bug | wrong actor | fix in `clean/` |
|----|--------|----------|---------|-------------|-----------------|
| H1 | anon-privileged-op | `src/routes/admin.js:25` (`purgeOrgNotes`, `POST /admin/orgs/:orgId/purge`) | route registered **before** `router.use(requireAuth)`, so it runs with no auth and no role check | anon | registered after `router.use(requireAuth)` with `requireOrgRole('owner')` |
| H2 | write-guard-gap | `src/routes/notes.js:55` (`updateNote`, `PATCH /notes/:id`) | membership is checked on the row it reads, then `data: req.body` lets the caller set `orgId` (mass-assignment) and move the note to another tenant | bob (member) → note 2 `org_id` 1→2 | field allowlist: `data: { title, body }` |
| H3 | missing-guard | `src/routes/orgs.js:30` (`listMembers`, `GET /orgs/:orgId/members`) | no middleware at all — returns member ids, emails and roles to anyone | anon (also carol) | `requireAuth, requireMembership` |
| H4 | idor-unscoped-query | `src/routes/notes.js:37` (`getNote`, `GET /notes/:id`) | `requireAuth` only, then `findUnique({ where: { id } })` with no tenant filter | carol (outsider) reads note 1 | `findFirst({ where: { id, org: { memberships: { some: { userId } } } } })` → 404 |
| H5 | secret-over-share | `src/routes/users.js:13` (`listTeammates`, `GET /users`) | `findMany` with `include` returns full user rows (`apiToken`, and also `passwordHash`) of every org-mate | bob reads alice's `api_token` | explicit `select: { id, email, memberships }` |

Correctly guarded routes that must NOT be reported on either twin: `POST /auth/login`, `GET /me`,
`POST /me/api-token`, `GET /orgs`, `GET|POST /orgs/:orgId/notes` (`requireAuth` +
`requireMembership`), `DELETE /notes/:id` (membership + author-or-owner),
`GET /admin/orgs/:orgId/stats` (`requireOrgRole('owner')`).

H5's root cause also over-shares `passwordHash` (bcrypt); it is the same bug and the same fix, so
it counts as H5, not as an extra finding. `.env` (`JWT_SECRET=dev-jwt-secret-change-me`) is a
local-dev value shipped identically in both twins.

## Score a livefire run

```sh
node samples/score.mjs <result.json> samples/express/ANSWERS.json          # vulnerable
node samples/score.mjs <result.json> samples/express/ANSWERS.json --clean  # clean
```
