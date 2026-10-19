// livefire preset — Next.js without Supabase (App/Pages Router + Prisma/Drizzle/any ORM).
//
// Family B (authz in code). A Next app that does NOT delegate authz to the DB (no Supabase RLS)
// enforces it in four places, all in code: Route Handlers (`app/**/route.ts`, `pages/api/**`),
// Server Actions (`'use server'` functions — every one is a public POST endpoint, reachable by
// anyone who has its action id, whatever page renders it), `middleware.ts` (often only a
// redirect, and its `matcher` decides what it even sees), and Server Components that load data
// by a URL param. Ground truth via a direct DB read, bypassing the ORM's scoping.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const nextjsAdapter = {
  id: 'nextjs',

  detect(repo) {
    const deps = (repo && repo.deps) || {}
    return !!deps.next
  },

  repoContext: 'A Next.js app whose authorization lives in CODE: Route Handlers (app/**/route.ts, pages/api/**), Server Actions (\'use server\' functions — each is a publicly callable POST endpoint regardless of which page renders it), middleware.ts (whose `matcher` may not cover every route, and which often only redirects the page while the underlying action/handler stays callable), and Server Components/loaders that read by a URL param. Session via next-auth/Auth.js, Clerk, Lucia, iron-session or a custom cookie. Wrong actors: an unauthenticated request, an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong role.',

  db: 'Reach the LOCAL dev DB from `.env.local` / the ORM config (DATABASE_URL — Postgres/MySQL/sqlite via Prisma/Drizzle/Kysely) — disposable only. Use a direct DB client (raw SQL, or the ORM with no tenant scoping) to plant fixtures and run the confirming read, BYPASSING the app\'s own scoping — that raw read is the ground truth. Start the app with `npm run dev` (or the project\'s script) on a free port if it is not running.',

  actors: 'Build three actor clients against the running app: (1) UNAUTH — no session cookie / no Authorization header; (2) OUTSIDER — a real session (log in through the app\'s auth flow, or mint the session/JWT with the app\'s own local secret) for a user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a session for a plain member where the action needs owner/admin. Call Route Handlers directly over HTTP; call Server Actions directly too (POST to the page with the `Next-Action` header set to the action id found in the client bundle / build manifest, and the serialized args) — never assume a page-level guard protects the action. Plus a direct DB client for planting + confirming.',

  inventorySql: 'Authorization is in code (DB-grant enumeration is n/a — say so). Enumerate: (a) every Route Handler (app/**/route.{ts,js} per exported method, pages/api/**) → its session check + ownership/tenant check; (b) every Server Action (\'use server\' files and inline actions) → the session + membership/role check INSIDE the action (a check only in the page or layout that renders it does NOT protect it); (c) middleware.ts → its `matcher` and what it enforces (redirect vs refuse) — FLAG routes/actions outside the matcher that rely on it; (d) every data read/write keyed by a request- or param-supplied id WITHOUT a tenant/owner filter (`prisma.x.findUnique({ where: { id } })`, `db.select().from(x).where(eq(x.id, id))`); (e) request bodies / FormData spread into create/update without a field allowlist (mass-assignment of ownership/tenant columns); (f) objects returned to the client (actions, handlers, props passed to Client Components) that include secret/PII fields. Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'npm test',

  guardExamples: 'a session check inside the Route Handler / Server Action itself (auth(), getServerSession, currentUser), a membership/role check before the write, a tenant filter in the ORM query, a middleware matcher that REFUSES (not just redirects) the request, a zod/field allowlist on the input, a DB constraint',

  emitTestHint: 'Write an integration test that calls the Route Handler over HTTP / invokes the Server Action function directly as each wrong actor (mocked or real session) and asserts refused, PAIRED with a direct DB read (raw SQL / unscoped ORM) confirming the row is unchanged. RED-first.',
}
