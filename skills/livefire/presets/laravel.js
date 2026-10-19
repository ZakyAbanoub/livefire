// livefire preset — Laravel (PHP).
//
// PHP's most-used framework. Authz lives in CODE: Gates + Policy classes (Gate::authorize,
// $this->authorize, @can), route middleware, and Eloquent scoping. No DB policy catalog. So
// `inventorySql` is a route→guard map + unscoped-Eloquent-query hunt; the DB-grant dump is n/a.
// Ground truth is read via a direct DB query, bypassing Eloquent global scopes.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const laravelAdapter = {
  id: 'laravel',

  detect(repo) {
    const files = (repo && repo.files) || []
    // Every Laravel app has an `artisan` entrypoint at the root; a composer.json corroborates.
    const hasArtisan = files.includes('artisan')
    const hasComposer = files.includes('composer.json') || (repo && repo.manifests && repo.manifests['composer.json'])
    return hasArtisan || (hasComposer && files.includes('app/'))
  },

  repoContext: 'A Laravel (PHP) app. Authorization lives in CODE: Gates and Policy classes (`Gate::authorize`, `$this->authorize`, `@can`), route middleware (`auth`, custom middleware), and Eloquent scoping (`$user->posts()->find($id)` vs `Post::find($id)`). Wrong actors: a guest (no auth), an authenticated user with zero membership in the target tenant, and an authenticated user with the wrong role.',

  db: 'Reach the LOCAL database from the `.env` DB_* vars (MySQL/Postgres) — disposable only. Use a direct DB connection (`DB::connection()->select(...)` raw, or an admin client) to plant fixtures and run the confirming SELECT, BYPASSING Eloquent global scopes and model events — that raw read is the ground truth.',

  actors: 'Build three actor sessions: (1) GUEST — no authenticated user; (2) OUTSIDER — `actingAs($user)` for a user with zero membership in the target tenant (or a real Sanctum/session token); (3) INSIDER-WRONG-ROLE — an authenticated plain member / non-owner. Drive via HTTP feature tests or real requests with the token. Plus a direct DB connection for planting + confirming.',

  inventorySql: 'Authorization is in code, so the "inventory" is a MAP, not a SQL dump (DB-grant enumeration is n/a for Laravel — say so). Enumerate: (a) every route in routes/*.php → its middleware + the controller\'s Gate/Policy check (`authorize`, `@can`, `can:` middleware) — flag routes touching tenant data with NO policy check; (b) every Eloquent query that loads by a request-supplied id WITHOUT a tenant/owner scope (`Model::find($request->id)` instead of `$user->models()->find`); (c) `$fillable`/mass-assignment that permits ownership/tenant columns, and `$request->all()` fed to `create`/`update`. Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'php artisan test',

  emitTestHint: 'Write a Feature test hitting the route as each wrong actor (`actingAs`/guest) and asserting refused, PAIRED with a direct `DB::select(...)` read confirming the row is unchanged — bypassing Eloquent scopes so the read is ground truth. RED-first.',
}
