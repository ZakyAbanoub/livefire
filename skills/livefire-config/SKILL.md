---
name: livefire-config
description: Interview the user to pin a repo's livefire setup and save it as livefire.config.mjs, so future /livefire runs are turnkey (no auto-detect guessing, no re-interview). Use when a repo has no matching preset, or to lock in the preset / local DB target / test command / safety allowHosts. Part of the livefire plugin; shares its engine.
---

# livefire-config

Creates a `livefire.config.mjs` in the target repo so `/livefire` (and the other commands) run
turnkey — no auto-detect guessing, no interview each time. Use it when no preset matches the
stack, or to explicitly pin the preset, the local DB target, the test command, and safety
`allowHosts`.

The engine lives in the sibling skill directory `../livefire/` (same plugin). Steps:

1. **Locate the engine** — shared scripts at `../livefire/src/detect.js`. Call `SKILL_DIR` that path.
2. **Probe first** — `resolveLaunchConfig(repoRoot)` from `<SKILL_DIR>/src/detect.js`. If a preset
   already auto-detects cleanly, tell the user and confirm they still want a pinned config.
3. **Interview** — ask the five `INTERVIEW_QUESTIONS` (exported from `<SKILL_DIR>/src/detect.js`):
   repo context · local DB + admin client · the three actors · authz inventory · test command.
   You MAY propose answers by reading the repo (deps, DB config, how roles/guards are defined) and
   just ask the user to confirm — don't force them to type everything.
4. **Build + save** — `buildAdapterFromInterview(answers)` then
   `saveLivefireConfig(repoRoot, { adapter, securityPass: false })` (both from
   `<SKILL_DIR>/src/detect.js`). This writes `livefire.config.mjs` at the repo root.
5. **Confirm** — reload it with `loadLivefireConfig(repoRoot)` and show the saved config. Tell the
   user `/livefire` will now use it. If it's a stack worth sharing, point them at
   `/livefire-add-preset` to promote the config into a first-class preset.

Note: if the stack IS a known one, prefer a `preset: '<id>'` config over a full inline adapter —
shorter and it inherits preset updates.
