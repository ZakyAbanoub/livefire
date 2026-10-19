// livefire preset — Strapi (headless CMS, Node/TypeScript).
//
// Family C (CMS permission model): access control is the Users-&-Permissions plugin (per-role
// route permissions in the DB) + per-route `config.policies` + controller-level ownership
// checks. Ground truth is read via a direct DB query bypassing Strapi's entity service.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const strapiAdapter = {
  id: 'strapi',

  detect(repo) {
    const deps = (repo && repo.deps) || {}
    return !!(deps['@strapi/strapi'] || deps.strapi)
  },

  repoContext: 'A Strapi (headless CMS) app. Authorization lives in the Users-&-Permissions plugin: per-role route permissions stored in the DB, plus each route\'s `config.policies`/middlewares and ownership checks in controllers. Wrong actors: the PUBLIC role (unauthenticated), an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong role.',

  db: 'Reach the LOCAL dev DB from `config/database` / `.env` (Postgres/MySQL/sqlite) — disposable only. Use a direct DB client (raw SQL) to plant fixtures and run the confirming read, BYPASSING the Strapi entity service / lifecycle hooks — that raw read is the ground truth.',

  actors: 'Build three actor clients: (1) PUBLIC — no token (the Public role); (2) OUTSIDER — a valid JWT for a user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a valid JWT with the wrong role. Drive via HTTP against `/api/*`. Plus a direct DB client for planting + confirming.',

  inventorySql: 'Enumerate the Strapi authz model: (a) the Users-&-Permissions role→permission rows (which content-type routes each role, incl. PUBLIC and AUTHENTICATED, may find/findOne/create/update/delete) — FLAG a content type exposing find/update to PUBLIC or AUTHENTICATED that holds tenant/private data; (b) each custom route\'s `config.policies`/middlewares — FLAG routes with `auth: false` or no policy that touch private data; (c) controllers that trust `ctx.params.id` without an ownership/tenant check (default core controllers return ANY row of the type). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'npm test',

  emitTestHint: 'Write a test hitting `/api/<type>/:id` as each wrong actor and asserting 403/empty, PAIRED with a direct DB read confirming the row is unchanged — bypassing the entity service so the read is ground truth. RED-first.',
}
