// livefire preset — Hasura (GraphQL on Postgres).
//
// Family A (authz declarative): access control is Hasura PERMISSIONS (per-role, per-table
// select/insert/update/delete rules with row filters + column sets), often over Postgres RLS.
// Ground truth is read via a direct Postgres connection (or admin-secret), bypassing role
// permissions — that read is the evidence. Reuses most of the Supabase preset's shape.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const hasuraAdapter = {
  id: 'hasura',

  detect(repo) {
    const files = (repo && repo.files) || []
    return files.includes('metadata/databases') || (files.includes('config.yaml') && files.some((f) => f.startsWith('metadata'))) || files.some((f) => f.startsWith('hasura'))
  },

  repoContext: 'A Hasura GraphQL app on Postgres. Authorization is DECLARATIVE: Hasura permissions per role/table (select/insert/update/delete with a row `filter`, a `check`, and an allowed column set), frequently combined with Postgres RLS. Wrong actors: an unauthenticated request (public/anonymous role), an authenticated user in the wrong tenant, and an authenticated user with the wrong role header.',

  db: 'Reach the LOCAL Postgres behind Hasura (docker-compose dev) — disposable only. Use a direct Postgres connection (superuser) or the admin secret to plant fixtures and run the confirming SELECT, BYPASSING role permissions/RLS — that read is the ground truth. GraphQL requests carry `X-Hasura-Role` + `X-Hasura-User-Id`.',

  actors: 'Build three request contexts: (1) ANON — the public/anonymous role, no auth; (2) OUTSIDER — a valid JWT/role for a user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a valid session with the wrong `X-Hasura-Role`. Plus a direct Postgres admin connection for planting + the confirming read.',

  inventorySql: 'Enumerate the Hasura authz model from metadata + Postgres: (a) every table\'s per-role permissions (select/insert/update/delete) — the row `filter`/`check` and allowed columns — FLAG a permission whose filter omits the tenant predicate, an UPDATE whose `check` is weaker than its `filter`, or a role that can SELECT secret/PII columns; (b) any table exposed with a permissive or missing filter to the anonymous role; (c) Actions/Remote schemas whose permissions bypass the row filter. Also dump the underlying Postgres RLS (pg_policies) if present, since Hasura may layer on top. Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'npm test',

  emitTestHint: 'Write a test issuing the GraphQL op as each wrong actor/role and asserting refused/empty, PAIRED with a direct Postgres SELECT (admin) confirming the row is unchanged — bypassing permissions so the read is ground truth. RED-first.',
}
