---
name: livefire-prompt
description: Print livefire's single-agent prompt for a repo — one self-contained prompt (auto-detects the preset) that a single agent follows top to bottom, for harnesses without a Workflow tool (Cursor, Cline, Codex, an API loop). Same 6-rule method, sequential. Part of the livefire plugin; shares its engine.
---

# livefire-prompt

Prints livefire's **single-agent prompt** for a target repo — the whole 6-rule method as one
self-contained prompt a single agent can follow top to bottom, for harnesses that have no
Workflow tool. Same method as `/livefire`, run sequentially instead of fanned out in parallel.

The engine lives in the sibling skill directory `../livefire/` (same plugin). Steps:

1. **Locate the engine** — the CLI is `../livefire/livefire-prompt.mjs`. Call `SKILL_DIR` = `../livefire`.
2. **Pick scope** — from the command arg (`feature`/`whole`); else ask.
3. **Generate** — run:
   `node <SKILL_DIR>/livefire-prompt.mjs <repoRoot> --feature` (or `--whole`, or `--preset <id>`).
   It resolves the adapter (config-file → auto-detect → generic/interview) and prints the prompt
   to stdout; adapter/source go to stderr.
4. **Deliver** — show the user the printed prompt so they can paste it into their agent, OR, if
   asked, follow it yourself here step by step (still honor the safety gate: local/disposable DB
   only, mutation opt-in).

Reminder of the trade-off vs the full Workflow `/livefire`: no parallelism (slower), and the
lenses/verifiers aren't independent blind agents (one agent sees its own earlier work) — the
prompt tells the agent to treat each pass as a fresh skeptic. Everything else is identical.
