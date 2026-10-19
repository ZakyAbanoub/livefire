// livefire preset — Flask (Python).
//
// Still widely used, more manual than Django. Authz: decorators (@login_required, custom
// @require_role), Flask-Login/Flask-Security, and hand-written ownership checks, usually with
// SQLAlchemy. Family B (authz in code); ground truth via a direct DB read.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const flaskAdapter = {
  id: 'flask',

  detect(repo) {
    const txt = ((repo && repo.manifestText) || {})
    return /(^|\n)\s*flask\b/i.test(txt['requirements.txt'] || '') || /\bflask\b/i.test(txt['pyproject.toml'] || '')
  },

  repoContext: 'A Flask (Python) app. Authorization lives in CODE and is fairly MANUAL: route decorators (@login_required, custom @require_role), Flask-Login/Flask-Security, and hand-written ownership checks (usually SQLAlchemy). Wrong actors: an unauthenticated request, an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong role.',

  db: 'Reach the LOCAL dev DB from config/`.env` (Postgres/MySQL/sqlite via SQLAlchemy) — disposable only. Use a direct connection (raw SQL) to plant fixtures and run the confirming read, BYPASSING session scoping — that raw read is the ground truth.',

  actors: 'Build three actor sessions: (1) ANONYMOUS — no session; (2) OUTSIDER — a logged-in user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a logged-in user with the wrong role. Drive via the Flask test client or real HTTP. Plus a direct DB connection for planting + confirming.',

  inventorySql: 'Authorization is in code (DB-grant enumeration is n/a — say so). Enumerate: (a) every route (@app.route/blueprint) → its auth decorator + any in-view ownership check — FLAG routes touching tenant data with NO @login_required and no ownership check; (b) every query loading by a request-supplied id WITHOUT a tenant/owner filter (`Model.query.get(id)` instead of a user-scoped query); (c) `request.form`/`request.json` fed to model constructors/updates without a field allowlist (mass-assignment). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'pytest',

  emitTestHint: 'Write a pytest using the Flask test client hitting the route as each wrong actor and asserting refused, PAIRED with a direct DB read (raw SQL) confirming the row is unchanged — bypassing the ORM session so the read is ground truth. RED-first.',
}
