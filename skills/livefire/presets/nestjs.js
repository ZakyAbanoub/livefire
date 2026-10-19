// livefire preset — NestJS (Node/TypeScript).
//
// Opinionated Node: authz is Guards (@UseGuards, CanActivate), often role/permission decorators
// (@Roles) + ownership checks in services, with TypeORM/Prisma. Maps almost 1:1 to Spring's
// method security. Family B (authz in code); ground truth via a direct DB read.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const nestjsAdapter = {
  id: 'nestjs',

  detect(repo) {
    const deps = (repo && repo.deps) || {}
    return !!(deps['@nestjs/core'] || deps['@nestjs/common'])
  },

  repoContext: 'A NestJS (Node/TypeScript) app. Authorization lives in CODE: Guards (`@UseGuards(AuthGuard, RolesGuard)`, `CanActivate`), role/permission decorators (`@Roles`), and ownership checks in providers/services. Wrong actors: unauthenticated (no/invalid JWT), an authenticated user with zero membership in the target tenant, and an authenticated user whose roles lack the permission.',

  db: 'Reach the LOCAL dev DB from config/`.env` (Postgres/MySQL via TypeORM/Prisma) — disposable only. Use a direct DB client (raw query or repository with no scope) to plant fixtures and run the confirming read, BYPASSING entity-level scoping — that raw read is the ground truth.',

  actors: 'Build three actor principals: (1) ANONYMOUS — no Authorization header; (2) OUTSIDER — a valid JWT for a user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a valid JWT whose roles lack the permission. Drive via supertest against the Nest app; for tests, override guards or mint real tokens. Plus a direct DB client for planting + confirming.',

  inventorySql: 'Authorization is in code (DB-grant enumeration is n/a — say so). Enumerate: (a) every controller route → its @UseGuards + @Roles/@Permissions AND any global guard (APP_GUARD) — FLAG routes with @Public or no guard that touch tenant data; (b) every repository/QueryBuilder query loading by a caller-supplied id WITHOUT a tenant/owner predicate; (c) DTOs/pipes that allow ownership/tenant fields (mass-assignment; missing whitelist:true on ValidationPipe). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'npm test',

  emitTestHint: 'Write a supertest e2e test hitting the route as each wrong actor and asserting refused, PAIRED with a direct DB read confirming the row is unchanged — bypassing the service/entity layer so the read is ground truth. RED-first.',
}
