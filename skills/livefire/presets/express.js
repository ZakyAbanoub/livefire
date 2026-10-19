// livefire preset — Express / Node.js (+ Prisma/Knex/Sequelize).
//
// The most-used Node backend, and UNOPINIONATED: there is no single authz convention. Access
// control is whatever middleware + ownership checks the app happens to use (Passport, custom
// `requireAuth`, `req.user.id === resource.ownerId`, etc.). So the preset can't point at "the"
// guard — it instructs the reviewer to enumerate whatever middleware/ownership checks exist and
// flag routes with none. Family B (authz in code); ground truth via a direct DB read.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const expressAdapter = {
  id: 'express',

  detect(repo) {
    const deps = (repo && repo.deps) || {}
    return !!deps.express && !deps['@nestjs/core'] // NestJS uses Express under the hood — let it win
  },

  repoContext: 'An Express/Node.js app. Authorization lives in CODE and is UNOPINIONATED: route middleware (auth guards, `requireRole`), and per-handler ownership checks (`req.user.id === row.owner_id`, `where: { userId: req.user.id }`). There may be NO consistent convention. Wrong actors: an unauthenticated request (no/invalid token or session), an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong role.',

  db: 'Reach the LOCAL dev DB from the app config/`.env` (Postgres/MySQL/Mongo, often via Prisma/Knex/Sequelize/Mongoose) — disposable only. Use a direct DB client (raw SQL, or Prisma with no where-scope) to plant fixtures and run the confirming read, BYPASSING any ORM-level scoping — that raw read is the ground truth.',

  actors: 'Build three actor clients: (1) UNAUTH — no Authorization header / no session cookie; (2) OUTSIDER — a valid token/session for a user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a valid token whose role lacks the permission. Drive via supertest or real HTTP. Plus a direct DB client for planting + confirming.',

  inventorySql: 'Authorization is in code (DB-grant enumeration is n/a — say so). Enumerate: (a) every route (app/router `.get/.post/...`) → the middleware chain guarding it + any in-handler auth/ownership check — FLAG routes that touch tenant data with NO auth middleware and NO ownership check; (b) every DB query that loads by a request-supplied id WITHOUT a tenant/owner filter (`prisma.x.findUnique({where:{id}})` instead of `{where:{id, userId}}`, raw `WHERE id=$1` with no tenant clause); (c) request bodies spread into create/update without a field allowlist (mass-assignment). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'npm test',

  emitTestHint: 'Write a supertest integration test hitting the route as each wrong actor and asserting refused, PAIRED with a direct DB read (raw SQL / unscoped ORM) confirming the row is unchanged — bypassing app scoping so the read is ground truth. RED-first.',
}
