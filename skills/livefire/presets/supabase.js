// livefire preset — Supabase / Postgres + Next.js.
//
// This is the CANONICAL source of the Supabase adapter. Its inventory SQL, actor recipe, lens
// set and inventory schema are lifted VERBATIM from the original verify-feature harness, so a
// livefire run on a Supabase+Next repo produces the SAME inventory and the
// SAME findings as before. That equivalence is the acceptance gate before this replaces the
// old skill — see README "Equivalence gate".
//
// authz here lives in the DB: Postgres RLS policies + SECURITY DEFINER function grants. The
// three actors are Supabase clients: anon key (no session), and two `signInWithPassword`
// sessions (outsider / wrong-role insider). Ground truth is read with the service-role client,
// which bypasses RLS — that direct SELECT is the evidence.

import { POSTGRES_INVENTORY_SQL, POSTGRES_INVENTORY_SCHEMA, POSTGRES_INVENTORY_FLAG_HINT, POSTGRES_INVENTORY_EXECUTION } from '../src/inventory.js'

export const supabaseAdapter = {
  id: 'supabase',

  // Auto-detect: a Next.js + Supabase repo.
  detect(repo) {
    const deps = (repo && repo.deps) || {}
    const hasSupabase = !!(deps['@supabase/ssr'] || deps['@supabase/supabase-js'])
    const hasNext = !!deps['next']
    const hasSupabaseDir = !!(repo && (repo.files || []).some((f) => f.startsWith('supabase/')))
    return hasSupabase && (hasNext || hasSupabaseDir)
  },

  repoContext: 'A multi-tenant app on Supabase (Postgres + RLS + Auth). Tenancy is enforced by row-level security policies and SECURITY DEFINER helper functions; the "wrong actor" is anon (the shipped public/anon key), an authenticated user with zero membership in the target tenant, or a plain member / non-owner admin acting outside their role.',

  db: 'Reach the live LOCAL DB e.g. psql postgresql://postgres:postgres@127.0.0.1:54322/postgres (run `supabase start` first; if `psql` is not installed on the host, use `docker exec supabase_db_<project_id> psql -U postgres -c "..."` — the container name is in `docker ps`). Get the local keys from `npx supabase status` (it prints the anon + service_role keys and the API URL http://127.0.0.1:54321) or a `.env.local` that points at 127.0.0.1 — NEVER a service_role key from a `.env` that targets *.supabase.co (that is prod). Use the LOCAL SERVICE-ROLE key to build an admin Supabase client for planting fixtures and the confirming SELECT (service-role bypasses RLS — that read is the ground truth).',

  actors:
    'Construct the three attacker clients — (1) ANON: createClient with the bare NEXT_PUBLIC_SUPABASE_ANON_KEY, no session; (2) OUTSIDER: a real authenticated user (signInWithPassword) with ZERO membership in the target tenant; (3) INSIDER-WRONG-ROLE: a real authenticated plain member / non-owner admin of the target tenant. Plus the SERVICE-ROLE/admin client for planting fixtures and the confirming SELECT.',

  // Shared Postgres catalog dump (also used by the generic adapter's fallback — see
  // src/inventory.js) so supabase and a bare-Postgres generic run stay equivalent.
  inventorySql: POSTGRES_INVENTORY_SQL,
  inventorySchema: POSTGRES_INVENTORY_SCHEMA,
  inventoryFlagHint: POSTGRES_INVENTORY_FLAG_HINT,
  inventoryExecution: POSTGRES_INVENTORY_EXECUTION,

  // Verbatim from verify-feature's prover + verifier prompts (parity).
  scopeUnits: 'every SECURITY DEFINER function, every RLS policy, every route',
  proverTargets: 'every privileged function, every table INSERT/UPDATE/SELECT, and every cron in the inventory',
  guardExamples: 'RLS USING/WITH CHECK, a REVOKE, a protect_* trigger, an in-function auth.uid()/membership guard, a preceding role check, a webhook signature, a constant-time secret compare, a column allowlist',
  credentialsHint: '`npx supabase status` (prints the local anon + service_role keys and API URL), or a `.env.local` / test env that points at 127.0.0.1. For an allow-listed hosted project, the key\'s JWT `ref` claim must equal the project ref in the host (`<ref>.supabase.co`); the local demo keys carry no ref',

  testCmd: 'npm test',

  lenses: [
    { key: 'authz', prompt: 'AUTHZ / access-policy lens. Using the inventory: any SECURITY DEFINER / service-role function reachable by anon/authenticated with caller-controlled ids and no internal membership/role check (a PUBLIC-default grant = no REVOKE); any UPDATE policy that is USING-only (destructive columns unguarded); ownership/tenancy/entitlement columns a permitted user can change. Cite the missing check.' },
    { key: 'input', prompt: 'INPUT-VALIDATION lens. Every action/route/webhook input validated? Mass-assignment (rest-spread into update/insert without a column allowlist), queries from raw user input. Cite it.' },
    { key: 'tenant-scope', prompt: 'CROSS-OBJECT / TENANT-SCOPING lens. Every user-supplied id acted on without a membership/ownership check reached before the write; INSERT/UPDATE WITH CHECK that validates only user_id/created_by and omits the tenancy re-check its sibling UPDATE carries.' },
    { key: 'billing', prompt: 'BILLING / ENTITLEMENT lens (skip if N/A). Paid features reachable by a non-payer or gated tenant; a gate on only some write paths; destructive lifecycle jobs that over-select or skip a blocker re-check; billing/PII columns readable by non-admins.' },
    { key: 'secrets-cron', prompt: 'SECRETS / CRON / EXTERNAL lens. Shared-secret checks constant-time + fail-closed + no user input; webhook signatures; no secret in the client bundle; server-side fetch of a user URL restricted to an allowlist (SSRF); privileged maintenance functions callable by anon.' },
    { key: 'happy-path', prompt: 'FUNCTIONAL HAPPY-PATH lens. Enumerate every step of the user story (each CTA/route/state); flag any step whose wiring is missing or dead.' },
  ],

  emitTestHint:
    'Write the regression test in the repo\'s own integration-test setup (find it: the vitest/jest config and the tests/ or __tests__ folder; if there is none, say so and propose one), against the real local Supabase. PAIR every mutation assertion with a direct service-role SELECT (RLS-bypassing) confirming the row did/did not change. RED-first: it must fail without the fix. Add a sentinel where the family allows (e.g. assert anon/authenticated lack EXECUTE on a function; assert every cron route imports the constant-time secret check).',
}
