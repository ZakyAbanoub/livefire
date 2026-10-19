# livefire sample — hasura

Hasura GraphQL Engine v2.48 (`cli-migrations-v3` image, metadata + migrations applied on boot)
over Postgres 16, JWT auth (HS256) with `anonymous` as the unauthorized role. Login is a Hasura
Action (`login`) served by a dependency-free Node handler in `actions/`, which also serves the
`purgeOrgNotes` Action. See `../SPEC.md` for the shared domain, seed and scoring rules.

| | |
|---|---|
| GraphQL | `http://localhost:18022/v1/graphql` (admin secret `notesadminsecret`) |
| Postgres | `postgres://notes:notes@localhost:15422/notes` |
| users | alice@acme.test (owner Acme), bob@acme.test (member Acme), carol@globex.test (owner Globex) — password `password1` |

## Run (one stack at a time — both variants use the same ports)

```sh
cd samples/hasura/vulnerable            # or clean
docker compose -p lf-hasura-vulnerable up -d --build   # lf-hasura-clean for clean/
./selftest.sh                           # vulnerable: H1..H5 LANDED; clean: all REFUSED; HAPPY OK both
docker compose -p lf-hasura-vulnerable down -v
```

`selftest.sh` derives the compose project from the directory name (`lf-hasura-<variant>`,
override with `COMPOSE_PROJECT_NAME`), resets the seed before each case, and confirms every case
with a direct `psql` read inside the postgres container. Requires `curl` and `jq`.

## Hole → file → fix

Paths are relative to the app root. `diff -ru vulnerable clean` shows only these changes.

| id | family | file | the hole (vulnerable/) | fix (clean/) |
|---|---|---|---|---|
| H1 | anon-privileged-op | `metadata/actions.yaml` (+ `actions/server.js`) | Action `purgeOrgNotes` is permitted to `anonymous`, and its handler deletes the org's notes via the admin secret without looking at `session_variables` | `anonymous` removed from the Action's permissions; handler requires `x-hasura-user-id` to be an `owner` membership of `orgId` |
| H2 | write-guard-gap | `metadata/databases/default/tables/public_notes.yaml` | `user` update permission has a membership `filter` but no `check`, and allows `org_id` → bob sets note 1's `org_id` to 2 | `check` = same membership predicate (post-update row must still be in one of the caller's orgs) |
| H3 | missing-guard | `metadata/databases/default/tables/public_memberships.yaml` (+ `public_users.yaml`) | `anonymous` select on `memberships` (filter `{}`) and on `users` (`id`, `email`, filter `{}`) → anon lists Acme members with emails | both `anonymous` select permissions removed |
| H4 | idor-unscoped-query | `metadata/databases/default/tables/public_notes.yaml` | `user` select on `notes` has `filter: {}` → carol reads Acme's note via `notes_by_pk(id: 2)` | filter = `{org: {memberships: {user_id: {_eq: X-Hasura-User-Id}}}}` |
| H5 | secret-over-share | `metadata/databases/default/tables/public_users.yaml` | `user` select on `users` (self or org-mates) includes the `api_token` column → bob reads alice's token | `api_token` removed from the `user` role's columns |

The owner's own `api_token` stays reachable in both variants through the `login` Action's
`apiToken` field (Hasura column permissions cannot be row-conditional, so the `users` select is
not the owner's read path).

Scoring notes (artefacts of Hasura's one-metadata-file-per-table layout, see `matchesHole` in
`../score.mjs`):
- H2 and H4 share `public_notes.yaml`, so a finding on that file credits one of them only through
  a symbol; H4 rides mostly on `notes_by_pk`, H2 on `update_notes` / `update_permissions`.
- H1's fix spans `metadata/actions.yaml` and `actions/server.js`; the key points at the yaml
  (`purgeOrgNotes` matches either way).
- H3 spans two files. A finding that only cites the `anonymous` select in `public_users.yaml`
  (emails) file-matches H5's unshared file and is credited to H5, not H3.
