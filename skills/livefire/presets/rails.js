// livefire preset — Ruby on Rails + Postgres ("rails-pg").
//
// Proves the interface works when authz lives in CODE, not the DB. Rails enforces access with
// Pundit/CanCanCan policies, `before_action` filters, and current-user scoping in controllers —
// there is no row-level policy catalog to dump. So `inventorySql` becomes a route→guard map +
// unscoped-query hunt, and the DB-grant part is explicitly n/a. Ground truth is still read
// directly from Postgres (bypassing ActiveRecord default scopes).

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const railsAdapter = {
  id: 'rails',

  detect(repo) {
    const files = (repo && repo.files) || []
    const deps = (repo && repo.deps) || {}
    const hasGemfile = files.includes('Gemfile') || (repo && repo.manifests && repo.manifests['Gemfile'])
    const looksRails = files.includes('config/database.yml') || files.includes('bin/rails') || files.includes('app/') || !!deps.rails
    return !!hasGemfile && !!looksRails
  },

  repoContext: 'A Ruby on Rails app. Authorization lives in CODE: Pundit/CanCanCan policies, `before_action :authenticate_user!` / `:authorize_*` filters, and current-user scoping (`current_user.posts.find` vs `Post.find`). Wrong actors: an unauthenticated visitor, a signed-in user with zero membership in the target tenant, and a signed-in member with the wrong role.',

  db: 'Reach the LOCAL development DB (Postgres/MySQL/sqlite) from config/database.yml (development env) — a disposable DB only. Use a superuser/admin connection (or `ActiveRecord::Base.connection` in a console) to plant fixtures and run the confirming SELECT directly, BYPASSING model default scopes — that raw read is the ground truth.',

  actors: 'Build three actor sessions: (1) GUEST — no session cookie / no signed-in user; (2) OUTSIDER — a signed-in user (factory + `sign_in`) with zero membership in the target tenant; (3) INSIDER-WRONG-ROLE — a signed-in plain member / non-owner. Drive them via request specs or real HTTP with the session cookie. Plus a direct DB connection for planting + confirming.',

  inventorySql: 'Authorization is in code, so the "inventory" is a MAP, not a SQL dump (DB-grant enumeration is n/a for Rails — say so). Enumerate: (a) every controller action → its `before_action`/authenticated + its Pundit/CanCanCan `authorize`/policy check (flag actions with NO authorize call); (b) every ActiveRecord query that loads by a user-supplied id WITHOUT a tenant/owner scope (`Model.find(params[:id])` instead of `current_user.models.find`); (c) strong-parameters allowlists that permit ownership/tenant columns (mass-assignment). Return each as a unit with its guard + whether a wrong actor reaches it.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  testCmd: 'bundle exec rspec',

  emitTestHint: 'Write a request spec that hits the action as each wrong actor and asserts refused, PAIRED with a direct DB read (`ActiveRecord::Base.connection.exec_query` or a raw SELECT) confirming the row did not change — bypassing model scopes so the read is ground truth. RED-first.',
}
