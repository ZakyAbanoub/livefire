// livefire preset — FastAPI (Python).
//
// Fastest-growing Python web framework. Authz: dependency injection (`Depends(get_current_user)`
// / `Depends(require_role)`), plus ownership checks in the path operation, usually with
// SQLAlchemy. Family B (authz in code); ground truth via a direct DB read bypassing the ORM.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const fastapiAdapter = {
  id: 'fastapi',

  detect(repo) {
    const txt = ((repo && repo.manifestText) || {})
    return /fastapi/i.test(txt['requirements.txt'] || '') || /fastapi/i.test(txt['pyproject.toml'] || '')
  },

  repoContext: 'A FastAPI (Python) app. Authorization lives in CODE: dependency injection (`Depends(get_current_user)`, `Depends(require_role)`), OAuth2/JWT bearer schemes, and ownership checks inside the path operation (usually SQLAlchemy). Wrong actors: an unauthenticated request (no/invalid bearer), an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong scope/role.',

  db: 'Reach the LOCAL dev DB from config/`.env` (Postgres/MySQL via SQLAlchemy) — disposable only. Use a direct engine/connection (raw SQL) to plant fixtures and run the confirming read, BYPASSING session scoping — that raw read is the ground truth.',

  actors: 'Build three actor clients: (1) UNAUTH — no Authorization bearer; (2) OUTSIDER — a valid token for a user with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a valid token whose scopes/role lack the permission. Drive via TestClient/httpx. Plus a direct DB connection for planting + confirming.',

  inventorySql: 'Authorization is in code (DB-grant enumeration is n/a — say so). Enumerate: (a) every path operation → its `Depends(...)` auth dependency + any role/scope check AND any router-level dependency — FLAG operations touching tenant data with NO auth dependency; (b) every query loading by a request-supplied id WITHOUT a tenant/owner filter (`db.get(Model, id)` / `select(Model).where(Model.id==id)` with no owner clause); (c) Pydantic models used for create/update that accept ownership/tenant fields (mass-assignment). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'pytest',

  emitTestHint: 'Write a pytest using TestClient hitting the operation as each wrong actor and asserting refused, PAIRED with a direct DB read (raw SQL via the engine) confirming the row is unchanged — bypassing the session so the read is ground truth. RED-first.',
}
