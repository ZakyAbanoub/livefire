// livefire — shared inventory shapes: the Postgres catalog dump + the app-tier units map.
//
// The rule-4 authz-model dump for ANY Postgres target: SECURITY DEFINER EXECUTE grants +
// RLS policies + zero-policy tables + secret/PII columns. Used verbatim by the `supabase`
// preset AND by the GENERIC adapter's fallback — so a generic run against a Postgres DB is
// NEVER blind on the catalog (that blindness was the livefire⟷verify-feature divergence:
// generic returned policies:0 while the supabase-native harness dumped the full catalog).
// Non-Postgres stacks don't use this; their preset supplies its own inventory.

export const POSTGRES_INVENTORY_SQL =
  `Run against the live DB and return structured results (run each query STANDALONE / autocommit — never in one shared transaction, since an expected "permission denied" aborts the tx and truncates the dump):
   (a) every SECURITY DEFINER function + which roles hold EXECUTE — e.g.
       SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef;
   (b) every RLS policy USING + WITH CHECK — SELECT schemaname,tablename,policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname='public';
   (c) RLS-enabled tables with zero policies;
   (d) columns holding secrets/PII (tokens, raw payloads, refresh tokens, oauth secrets, private free-text fields) and that table's SELECT policy breadth;
   (e) catalog_counts — the ground-truth totals your lists must match:
       SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef;   -- → privileged_units
       SELECT count(*) FROM pg_policies WHERE schemaname='public';                                                          -- → policies`

// The ground-truth totals an inventory must match. The pipeline compares the enumerated lists
// against these and re-runs a short dump once (a truncated dump — e.g. an aborted transaction —
// looks exactly like a small app otherwise). Shared by every inventory shape.
export const CATALOG_COUNTS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { privileged_units: { type: 'number' }, policies: { type: 'number' } },
  required: ['privileged_units', 'policies'],
}

export const POSTGRES_INVENTORY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    secdef_funcs: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, args: { type: 'string' }, anon_exec: { type: 'boolean' }, authed_exec: { type: 'boolean' }, note: { type: 'string' } },
      required: ['name', 'args', 'anon_exec', 'authed_exec', 'note'] } },
    policies: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { table: { type: 'string' }, cmd: { type: 'string' }, using: { type: 'string' }, with_check: { type: 'string' }, flag: { type: 'string' } },
      required: ['table', 'cmd', 'using', 'with_check', 'flag'] } },
    zero_policy_tables: { type: 'array', items: { type: 'string' } },
    secret_columns: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { table: { type: 'string' }, column: { type: 'string' }, select_breadth: { type: 'string' } },
      required: ['table', 'column', 'select_breadth'] } },
    catalog_counts: CATALOG_COUNTS_SCHEMA,
  },
  required: ['secdef_funcs', 'policies', 'zero_policy_tables', 'secret_columns', 'catalog_counts'],
}

export const POSTGRES_INVENTORY_FLAG_HINT =
  'Flag: every secdef function with anon_exec or authed_exec true; every USING-only UPDATE policy (with_check empty) and every WITH CHECK weaker than its USING; RLS-enabled zero-policy tables; secret/PII columns whose SELECT policy is broader than the owner.'

// How to RUN a Postgres catalog dump robustly (the psql-specific half of the inventory stage).
// Lives here, not in the pipeline, so the core stays stack-agnostic.
export const POSTGRES_INVENTORY_EXECUTION =
  `• Run each catalog query INDEPENDENTLY in AUTOCOMMIT (a separate \`psql -c "..."\` invocation per query — if \`psql\` is not installed on the host, run it inside the DB container, e.g. \`docker exec <db-container> psql -U postgres -c "..."\`), never inside one BEGIN/transaction and never as a multi-statement batch — an expected error (e.g. "permission denied" on a locked table, or one bad row) ABORTS a transaction and makes every later query "ignored until end of transaction", silently truncating the dump.\n` +
  `• Expect a mature app to have dozens of privileged functions and dozens–hundreds of policies. Sanity-check: SELECT count(*) FROM pg_policies WHERE schemaname='public' must equal the number of policy rows you enumerated (report it in catalog_counts).`

// The app-tier inventory (authz in code / in a rules DSL / in a CMS permission table): every
// route/handler/rule/permission is a UNIT with its guard and whether a wrong actor reaches it.
// `reachable_by_wrong_actor` is what the pipeline's wrong_actor_reachable summary counts.
export const APP_TIER_UNITS_INSTRUCTION =
  'Return EVERY unit (route / handler / resolver / rule / permission row / scheduled job) in units[] with: name, kind, location (file:line or table/row), guard (the exact check protecting it, or "none"), reachable_by_wrong_actor (true if anon, an outsider or a wrong-role insider can reach the protected action/data given that guard), note. Put secret/PII fields and who can read them in secret_columns[]. In catalog_counts, report the TOTAL number of units you found by a mechanical count (e.g. the number of route registrations / rule blocks / permission rows) as privileged_units, and policies = 0 unless the stack also has DB row policies.'

export const APP_TIER_INVENTORY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    units: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, kind: { type: 'string' }, location: { type: 'string' }, guard: { type: 'string' }, reachable_by_wrong_actor: { type: 'boolean' }, note: { type: 'string' } },
      required: ['name', 'kind', 'location', 'guard', 'reachable_by_wrong_actor', 'note'] } },
    policies: { type: 'array', items: { type: 'object', additionalProperties: true } },
    secret_columns: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { table: { type: 'string' }, column: { type: 'string' }, select_breadth: { type: 'string' } },
      required: ['table', 'column', 'select_breadth'] } },
    notes: { type: 'array', items: { type: 'string' } },
    catalog_counts: CATALOG_COUNTS_SCHEMA,
  },
  required: ['units', 'secret_columns', 'notes', 'catalog_counts'],
}

// Permissive schema for the GENERIC adapter's fallback: accepts the Postgres catalog shape
// (secdef_funcs/policies/…) when the target is Postgres, OR a units[] map for any other stack.
// additionalProperties:true + no required so the agent fills whatever the target actually has.
export const GENERIC_INVENTORY_SCHEMA = {
  type: 'object', additionalProperties: true,
  properties: {
    secdef_funcs: { type: 'array', items: { type: 'object', additionalProperties: true } },
    policies: { type: 'array', items: { type: 'object', additionalProperties: true } },
    zero_policy_tables: { type: 'array', items: { type: 'string' } },
    secret_columns: { type: 'array', items: { type: 'object', additionalProperties: true } },
    units: { type: 'array', items: { type: 'object', additionalProperties: true,
      properties: { name: { type: 'string' }, guard: { type: 'string' }, reachable_by_wrong_actor: { type: 'boolean' } },
      required: ['name', 'guard', 'reachable_by_wrong_actor'] } },
    notes: { type: 'array', items: { type: 'string' } },
    catalog_counts: CATALOG_COUNTS_SCHEMA,
  },
  required: ['catalog_counts'],
}
