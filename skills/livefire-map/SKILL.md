---
name: livefire-map
description: Read-only map of an app's authorization surface — dump the live authz model (SECURITY DEFINER grants, RLS USING/WITH CHECK, route→guard map, secret/PII columns) as a report, WITHOUT running the full verification. Fast and cheap; use to understand the attack surface before an audit, or on its own. Part of the livefire plugin; shares its engine + presets.
---

# livefire-map

Dumps the live **authorization surface** of an app and reports it — the inventory stage of
livefire, on its own. **Read-only**: it enumerates the authz model, it does NOT plant rows, run
exploits, or judge findings. Use it to see the attack surface fast (cheap) before deciding to run
a full `/livefire` audit, or as a standalone "what can each actor reach?" map.

This is NOT a security verdict — enumeration alone can't tell a real hole from a guarded one
(that's what the full `/livefire` cross-modal run is for). It surfaces *what to look at*.

The engine lives in the sibling skill directory `../livefire/` (same plugin). Steps:

1. **Locate the engine** — the shared scripts are in `../livefire/` relative to this skill
   (`../livefire/src/detect.js`, `../livefire/src/safety.js`). Call `SKILL_DIR` that path.
2. **Bring up the local stack** in the target repo if needed (Supabase: `npx supabase status` →
   `npx supabase start`). Local/disposable only.
3. **Safety (read-only)** — `assertLocalDbTarget(dbTarget, { expectMutations: false })` from
   `<SKILL_DIR>/src/safety.js` (no mutation opt-in needed — this is a read). Refuse a non-local host.
4. **Resolve the adapter** — `resolveLaunchConfig(repoRoot)` from `<SKILL_DIR>/src/detect.js`;
   announce `adapter (source)`. If `needsInterview`, ask the 5 questions or point the user at
   `/livefire-config`.
5. **Dump the inventory** — run the adapter's `inventorySql` (read-only) against the local DB:
   for Postgres/RLS → `pg_proc` EXECUTE grants (flag anon/authenticated on `secdef` funcs) +
   `pg_policies` USING/WITH CHECK (flag USING-only UPDATEs, WITH CHECK weaker than USING) +
   RLS-on-zero-policy tables + secret/PII columns vs SELECT breadth; for authz-in-code stacks →
   the route→guard map + queries missing a tenant filter (say the DB-grant dump is n/a).
6. **Report**, grouped, most-alarming first: privileged units reachable by a wrong actor · write
   paths that guard the read but not the write · secret/PII readable beyond owner · zero-policy
   tables. End with: "this is a surface map, not a verdict — run `/livefire` to confirm which are
   real." No RED-first tests here (nothing was proven).
