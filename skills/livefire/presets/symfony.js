// livefire preset — Symfony (PHP).
//
// PHP's enterprise framework, next to Laravel. Authz: security.yaml access_control, Voters
// (`#[IsGranted]` / `denyAccessUnlessGranted`), and ownership checks with Doctrine. Family B
// (authz in code); ground truth via a direct DB read bypassing Doctrine.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const symfonyAdapter = {
  id: 'symfony',

  detect(repo) {
    const files = (repo && repo.files) || []
    const composer = ((repo && repo.manifestText) || {})['composer.json'] || ''
    return /symfony\/framework-bundle/.test(composer) || (files.includes('bin/console') && files.includes('composer.json'))
  },

  repoContext: 'A Symfony (PHP) app. Authorization lives in CODE: `security.yaml` access_control + firewalls, Voters (`#[IsGranted]`, `denyAccessUnlessGranted`), and ownership checks with Doctrine. Wrong actors: an anonymous request, an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong role.',

  db: 'Reach the LOCAL dev DB from `.env`/`.env.local` (DATABASE_URL — Postgres/MySQL via Doctrine) — disposable only. Use a direct DBAL connection or raw SQL to plant fixtures and run the confirming read, BYPASSING Doctrine filters/scoping — that raw read is the ground truth.',

  actors: 'Build three actor sessions: (1) ANONYMOUS — no session/token; (2) OUTSIDER — an authenticated user (loginUser) with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — an authenticated user with the wrong role. Drive via the WebTestCase client or real HTTP. Plus a direct DB connection for planting + confirming.',

  inventorySql: 'Authorization is in code (DB-grant enumeration is n/a — say so). Enumerate: (a) every controller action/route → its `#[IsGranted]`/Voter + the matching security.yaml access_control rule — FLAG routes touching tenant data with no access rule and no Voter; (b) every Doctrine query loading by a request-supplied id WITHOUT a tenant/owner criterion (`$repo->find($id)` instead of a scoped query); (c) Forms/DTOs that map ownership/tenant fields (mass-assignment). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'php bin/phpunit',

  emitTestHint: 'Write a WebTestCase hitting the route as each wrong actor and asserting refused, PAIRED with a direct DBAL/raw SQL read confirming the row is unchanged — bypassing Doctrine so the read is ground truth. RED-first.',
}
