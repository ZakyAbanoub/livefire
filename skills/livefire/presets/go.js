// livefire preset — Go web APIs (Gin / Echo / Fiber / chi).
//
// Common for microservices/APIs, and fairly low-level: authz is middleware + hand-written
// ownership checks, usually with sqlc/GORM/pgx. No single convention. Family B (authz in code);
// ground truth via a direct DB read bypassing the query layer.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const goAdapter = {
  id: 'go',

  detect(repo) {
    const gomod = ((repo && repo.manifestText) || {})['go.mod'] || ''
    return /gin-gonic\/gin|labstack\/echo|gofiber\/fiber|go-chi\/chi/.test(gomod)
  },

  repoContext: 'A Go web API (Gin/Echo/Fiber/chi). Authorization lives in CODE and is low-level: middleware (auth, RequireRole) and hand-written ownership checks in handlers, usually with sqlc/GORM/pgx. There may be NO consistent convention. Wrong actors: an unauthenticated request, an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong role.',

  db: 'Reach the LOCAL dev DB from config/env (Postgres/MySQL via sqlc/GORM/pgx) — disposable only. Use a direct `database/sql`/pgx connection (raw SQL) to plant fixtures and run the confirming read, BYPASSING any query-layer scoping — that raw read is the ground truth.',

  actors: 'Build three actor clients: (1) UNAUTH — no Authorization header; (2) OUTSIDER — a valid token for a user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a valid token whose role lacks the permission. Drive via httptest / real HTTP. Plus a direct DB connection for planting + confirming.',

  inventorySql: 'Authorization is in code (DB-grant enumeration is n/a — say so). Enumerate: (a) every route registration → the middleware chain guarding it + any in-handler auth/ownership check — FLAG routes touching tenant data with no auth middleware and no ownership check; (b) every query loading by a request-supplied id WITHOUT a tenant/owner filter (`db.Query("... WHERE id=$1", id)` with no owner clause, `GORM First(&x, id)`); (c) request structs bound from the body that include ownership/tenant fields (mass-assignment). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'go test ./...',

  emitTestHint: 'Write a table-driven httptest hitting the route as each wrong actor and asserting refused, PAIRED with a direct `database/sql` SELECT confirming the row is unchanged — bypassing the query layer so the read is ground truth. RED-first.',
}
