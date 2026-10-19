---
name: livefire-add-preset
description: Scaffold a new livefire preset for a stack that isn't covered yet — copy the template, fill the two stack-specific adapter points (authz inventory + three actors), register it, add a detect test, and run the suite. Use when auto-detect falls back to generic and you want a first-class preset (needs the livefire repo checked out, not just the installed plugin). Shares the livefire engine.
---

# livefire-add-preset

Scaffolds a new **preset** so livefire covers a stack it doesn't yet. A preset teaches livefire
two things: how that stack enumerates its authz model, and how to build the three attacker actors
+ the ground-truth read. Everything else (the pipeline) is already stack-agnostic.

Requires the **livefire repo checked out** (you're editing `skills/livefire/presets/`), not just
the installed plugin. If the user only has the plugin installed, tell them to
`git clone ZakyAbanoub/livefire` first, or use `/livefire-config` to pin an inline adapter for their
repo instead.

Steps (all paths under the repo's `skills/livefire/`):

1. **Identify the stack + its authz family** — A (declarative in-DB: policies/rules), B (in-code:
   route→guard), or C (CMS permission model). Read the target app to learn where authz actually
   lives and how the DB/store is reached locally.
2. **Copy the template** — `cp presets/TEMPLATE.js presets/<stack>.js`. Fill the contract from
   `src/adapter.js`. The load-bearing fields:
   - `inventorySql` — how to enumerate the authz model as data (DB-native dump, or the route→guard
     map + unscoped-query hunt, saying the DB-grant dump is n/a);
   - `actors` + `db` — how to build anon / outsider / wrong-role-insider the stack's way, and the
     admin path that reads ground truth bypassing the app's authz;
   - `detect(repo)` — match on `repo.deps` / `repo.files` / `repo.manifestText` (for Python/PHP/
     Go/Ruby, grep the manifest text). Return true only when confident.
   Omit `lenses` to inherit `DEFAULT_LENSES`.
3. **Register** — add the import + entry to `presets/index.js`, most-specific first (mind
   collisions, e.g. a Node framework that also pulls Express).
4. **Add a detect test** — in `src/detect.test.mjs`, assert your `detect()` matches a synthetic
   probe AND that an unrelated probe still resolves elsewhere/generic.
5. **Verify** — `npm test` (from repo root) and `npm run check`. Then confirm the resolved adapter
   is JSON-serializable (its `detect()` is dropped in transit — that's expected).
6. **Prove it (required for a PR)** — per CONTRIBUTING.md, run livefire against a minimal sample
   app with ONE known hole and confirm it comes out `CONFIRMED-strong`, and that a clean version
   yields no false positive. Include the sample + report in the PR.
