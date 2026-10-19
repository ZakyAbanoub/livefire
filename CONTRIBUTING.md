# Contributing to livefire

The unit of contribution is a **preset**: an adapter that teaches livefire how one stack
expresses its authorization model and its three attacker positions. The pipeline
(`skills/livefire/src/harness-core.js`) is already stack-agnostic — you never touch it. All engine
files live under `skills/livefire/` (the self-contained skill); paths below are relative to it.

## Add a preset

1. **Copy the template.** `cp skills/livefire/presets/TEMPLATE.js skills/livefire/presets/<your-stack>.js`
   and implement the `VerifyAdapter` contract documented in `src/adapter.js`. The two fields that
   matter most:
   - `inventorySql` — how to enumerate the authz model as data. DB-native (row policies, function
     grants) → dump them. App-tier (route guards, policy objects, middleware) → enumerate every
     route → its guard + every data query missing a tenant/owner filter, and state that the
     DB-grant dump is n/a for this stack.
   - `actors` — how to construct anon / outsider / wrong-role-insider the stack's way, plus the
     admin path that reads ground truth **bypassing the app's own authz**.
   Omit `lenses` to inherit the universal `DEFAULT_LENSES`; override only what your stack changes.

2. **Register it.** Add it to the `REGISTRY` in `presets/index.js`, most-specific presets first
   (auto-detect returns the first `detect()` match). **No rebuild per preset** — livefire ships
   one universal `dist/livefire.workflow.js`; the controller resolves your preset and passes it
   in as `cfg.adapter`.

3. **Give it a `detect(repo)`** so auto-detect can pick it. `repo` is a light probe:
   `{ deps, files, manifests }`. Return true only when you're confident.

4. **Check.** `npm test` (runs the detect suite — add a case asserting your `detect()` matches a
   synthetic probe and stays generic-free for unrelated repos). `npm run check` still validates
   the universal workflow builds.

## Prove the preset (required)

A preset is not done until it *finds a known hole*. Stand up a minimal sample app on your stack
with **one deliberate access-control bug** (e.g. an update path that checks ownership on read
but not on write). Run livefire against it and confirm:

- the inventory dump enumerates the guard that's missing;
- the prover reproduces the exploit from the wrong actor and confirms it with a direct
  ground-truth read;
- the finding comes out `CONFIRMED-strong` (static + empirical agree);
- a clean version of the same app yields **no** false positive on that surface.

Include the sample app (or a pointer to it) and the run's report in your PR.

## Principles

- **Don't duplicate pipeline logic in a preset.** A preset is data + instructions, not method.
- **Never assume Postgres.** The more a stack pushes authz into code, the more the inventory is
  a route→guard map and the DB dump degrades — that's expected; say so, don't skip the stage.
- **Ground-truth read is non-negotiable.** Every write assertion pairs with a direct read that
  bypasses the app's authz. A 200/OK is not evidence.
- **Safety first.** Presets must target local/disposable stores. Never a managed/prod host.
