// livefire preset TEMPLATE — copy to presets/<your-stack>.js and fill in.
//
// A preset teaches livefire how YOUR stack expresses two things: its authorization model, and
// its three attacker positions + ground-truth read. Everything else (the 6-rule pipeline) is
// already stack-agnostic. See src/adapter.js for the full contract and DEFAULT_LENSES.
//
// Rule of thumb: the more your stack pushes authz OUT of the DB and INTO code (Spring/Rails are
// the extreme), the more `inventorySql` becomes "enumerate every route -> its guard" and the
// DB-grant dump degrades to n/a — say so, don't skip it. livefire assumes SOME enumerable authz
// model + SOME ground-truth read, not Postgres.

import { APP_TIER_INVENTORY_SCHEMA, APP_TIER_UNITS_INSTRUCTION } from '../src/inventory.js'

export const myStackAdapter = {
  id: 'my-stack', // unique id; becomes the `preset:` source label

  // OPTIONAL auto-detect. Return true if this preset fits the probed repo.
  // repo = { deps: {...package/manifest deps}, files: [relative paths], manifests: {...} }
  detect(repo) {
    // e.g. return !!(repo.deps && repo.deps['strapi'])
    //      return (repo.files || []).some((f) => f === 'pom.xml' || f === 'build.gradle')
    return false
  },

  // One paragraph: the app, its tenancy/ownership model, what "wrong actor" means here.
  repoContext: 'TODO: describe the app + its tenant/ownership model + who the wrong actors are.',

  // How an agent reaches a LOCAL / disposable store + an admin client for planting fixtures and
  // the confirming ground-truth read. MUST be a throwaway target (livefire refuses prod hosts).
  db: 'TODO: local DB connection + admin/superuser client for planting + confirming reads.',

  // How to build the three attacker positions the stack's way (DB keys, JWTs, sessions...).
  actors: 'TODO: (1) ANON no session; (2) OUTSIDER authed, zero membership; (3) INSIDER-WRONG-ROLE authed, wrong role. Plus the admin client.',

  // What to dump so the authz model becomes DATA. DB-native policies, OR the route->guard map.
  // Append APP_TIER_UNITS_INSTRUCTION so every unit carries `reachable_by_wrong_actor` and the
  // dump reports mechanically-counted totals in catalog_counts (the pipeline re-runs a short dump).
  inventorySql: 'TODO: enumerate the authz model. Dump policies/grants if DB-native; else map every route -> its guard + every query missing a tenant/owner filter.' + ' ' + APP_TIER_UNITS_INSTRUCTION,

  // JSON Schema for the structured inventory dump. App-tier stacks use the shared shape as-is.
  inventorySchema: APP_TIER_INVENTORY_SCHEMA,

  // OPTIONAL stack-specific instruction fields (defaults are stack-neutral — see src/adapter.js):
  // inventoryExecution: how to run the dump robustly (e.g. one query per command, autocommit).
  // guardExamples: the existing checks a verifier must rule out before confirming a finding.
  // credentialsHint: where the LOCAL stack's credentials come from.
  // proverTargets / scopeUnits: what "every unit" means on this stack.

  testCmd: 'TODO: your test runner, e.g. pytest / bundle exec rspec / ./gradlew test',

  // OPTIONAL. Omit to inherit DEFAULT_LENSES from src/adapter.js; override only what differs.
  // lenses: [{ key: 'authz', prompt: '...' }, ...],

  emitTestHint: 'TODO: how a RED-first regression test is written in your framework, paired with a direct ground-truth read.',
}

// To register: add it to the REGISTRY in presets/index.js, most-specific presets first so
// auto-detect resolves correctly. No rebuild needed (one universal workflow; the controller
// passes your adapter in as cfg.adapter). Then prove it against a small sample app with a KNOWN
// hole (see CONTRIBUTING.md).
