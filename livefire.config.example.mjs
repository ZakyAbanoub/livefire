// livefire.config.example.mjs — copy to your repo root as `livefire.config.mjs` to pin
// livefire's setup so it runs turnkey (no auto-detect guessing, no interview). Optional:
// without it, livefire auto-detects a preset from your repo, and falls back to an interview.
//
// Precedence at launch: this file → auto-detect → interview. CLI/skill args (scope, preset)
// override this file.

export default {
  // ── Option A: just name a shipped preset ──
  preset: 'supabase',

  // ── Option B: bring your own adapter inline (overrides `preset`) ──
  // See src/adapter.js for the full VerifyAdapter contract. Only db/actors/inventorySql are
  // truly stack-specific; omit `lenses` to inherit the universal defaults.
  // adapter: {
  //   id: 'my-stack',
  //   repoContext: 'A multi-tenant … app. Wrong actors are …',
  //   db: 'Reach the LOCAL disposable DB at … + an admin client for planting + confirming reads.',
  //   actors: 'anon = … ; outsider = … ; wrong-role insider = … ; admin = …',
  //   inventorySql: 'enumerate the authz model: …',
  //   testCmd: 'npm test',
  // },

  // ── Project context (APPENDED to the preset text — the preset's safety guidance stays) ──
  // What a preset cannot know about THIS app. The original in-house harness always passed these;
  // they are the biggest single quality lever. Keep secrets out: name WHERE the local key lives.
  // repoContext: 'Multi-tenant app: orgs + memberships(role owner|admin|member); invoices and
  //   payments are the money layer; OAuth refresh tokens are secrets; cron routes need a shared secret.',
  // db: 'Local Supabase on 127.0.0.1:54322; psql via `docker exec supabase_db_<id> psql -U postgres`.',
  // actors: 'Create outsider + plain-member users with the admin API, then signInWithPassword.',
  // testCmd: 'npx vitest run',
  // extraLenses: [{ key: 'money', prompt: 'MONEY lens: every write to a money table re-checks …' }],
  // maxCriticRounds: 3,          // completeness-critic loop bound (1–4)
  // maxAgents: 120,              // agent budget PER STAGE; past it, work is dropped + reported in result.budget
  // maxAgentsTotal: 400,         // agent budget for the whole run (clamped to 900, below the runtime cap of 1000)
  // siblingBatchSize: 8,         // sweep siblings of one family verified per agent (1–20)
  // inventoryMode: "both",       // static lenses in both views (full + compact); "full" / "compact" = one view, ~20% cheaper

  // ── Defaults for this project ──
  securityPass: false, // false = feature/diff scope · true = whole-surface
  range: 'main...HEAD',

  // ── Safety allowlist (optional) ── extra hosts to treat as local/disposable, on top of
  // loopback / localhost / *.local|.internal|.test / host.docker.internal.
  // allowHosts: ['my-test-box'],
}
