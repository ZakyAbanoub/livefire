// livefire — single-agent (degraded) mode.
//
// The default pipeline runs as a Workflow that fans out to many subagents (parallel, blind to
// each other). Some harnesses have no Workflow tool — a plain Claude-via-API loop, Cursor,
// Cline, Codex, a custom agent. For those, `buildSingleAgentPrompt(adapter, opts)` emits ONE
// self-contained prompt that a single capable agent (with shell + DB access) follows top to
// bottom, running the same 6-rule method sequentially instead of in parallel.
//
// HONEST TRADE-OFF vs the Workflow mode:
//   • no parallelism → slower wall-clock;
//   • the lenses/verifiers are not independent blind agents — one agent sees its own earlier
//     work, so cross-lens independence is weaker (mitigated by an explicit instruction to treat
//     each lens/verify as a fresh, skeptical reviewer);
//   • everything else — read+run+walk, 3-actor matrix, direct-read evidence, cross-modal
//     confirmation, family sweep — is identical.
// Use Workflow mode when available; use this when it isn't.

import { proverRules } from './prover-rules.js'
import { DEFAULT_INVENTORY_EXECUTION, DEFAULT_GUARD_EXAMPLES, DEFAULT_CREDENTIALS_HINT } from './adapter.js'

// Build the single-agent prompt from a RESOLVED adapter (from src/detect.js) + scope.
// opts: { securityPass?: boolean (default true), range?: string, repoRoot?: string }
export function buildSingleAgentPrompt(adapter, opts = {}) {
  const A = adapter || {}
  const securityPass = opts.securityPass !== false
  const range = opts.range || 'main...HEAD'
  const scope = securityPass
    ? `WHOLE-SURFACE — every privileged unit, every access policy, every route, OLD migrations included. The diff ${range} only prioritizes; it is NOT a boundary.`
    : `FEATURE/DIFF — focus on ${range} and the code it touches (+ reachable callees).`
  const target = opts.repoRoot ? `Repo under audit: ${opts.repoRoot} — run every file read, git and test command from there.` : 'Repo under audit: the current working directory.'
  const rules = proverRules({ credentialsHint: A.credentialsHint || DEFAULT_CREDENTIALS_HINT })
  const lenses = (A.lenses || []).map((l, i) => `   ${i + 1}. [${l.key}] ${l.prompt}`).join('\n')

  return `# livefire — single-agent run (${A.id || 'custom'} · ${securityPass ? 'whole-surface' : 'feature/diff'})

You are ONE agent running the full livefire verification of our own product before merge. You
have shell + DB access. Work top to bottom; do not skip a stage. Where the Workflow mode would
spawn independent reviewers, YOU play each role in turn — and you MUST treat each lens and each
verification as a FRESH, skeptical reviewer who does not trust the earlier passes.

## Target
${A.repoContext || 'Adapt to this app, its tenancy/ownership model, and who the wrong actors are.'}
${target}
Scope: ${scope}

## The six rules (do not weaken any of them)
1. Whole reachable surface, not the diff. 2. Run the exploit, don't just read it — confirm every
write with a direct ground-truth read. 3. Three-actor matrix: anon / authenticated outsider /
wrong-role insider — the test is "is the WRONG actor refused". 4. Enumerate the live authz model
mechanically (a default grant is invisible in source). 5. Recently-hardened code is a PRIORITY
re-audit target, never a skip. 6. Sweep by root-cause family.
A finding is CONFIRMED-strong only when ≥2 modalities agree (a static read flagged it AND the
live run reproduced it); one modality = CONFIRMED-weak; a modality that refutes it = DISMISSED
with the blocking check cited.

## Stage 0 — SAFETY (do this first, fail-closed)
The next stages PLANT rows and RUN exploits. Confirm the DB target resolves to a LOCAL/disposable
host (loopback / localhost / *.local|.internal|.test / docker / an allow-listed host). If it
looks managed/production (a public domain, a cloud-DB host, contains "prod"), STOP — do not
mutate anything; report "refused: non-local DB target". (Reference guard: src/safety.js
assertLocalDbTarget.) A mutating run needs explicit opt-in.

## Stage 1 — Inventory (mechanical)
${A.db || 'Reach the live local DB + an admin client.'}
Dump the live authz model as data: ${A.inventorySql || 'enumerate the authz model.'}
${A.inventoryFlagHint || 'Flag every unit reachable by a wrong actor without an internal guard, every write path that guards its read but not its write, and every secret/PII field readable beyond its owner.'}
Execution (read-only, complete, robust):
${A.inventoryExecution || DEFAULT_INVENTORY_EXECUTION}
Record the mechanically-counted totals as catalog_counts. If your enumerated lists are shorter
than those counts, the dump was truncated — re-run the dump step by step before moving on, and
if it stays short say so in the coverage note (never proceed as if it were complete).

## Stage 2 — Static review (play each lens as a separate reviewer)
For EACH lens below, review the whole surface with the inventory in hand and list candidate
findings (location, the guard you looked for, why it does not block, a wrong-actor scenario):
${lenses || '   (use the default lenses)'}
Give the app tier (routes, server actions, services, crons) the same attention as the database
catalog: a large inventory pulls a reviewer toward the data tier, and in practice the app-tier
holes are the ones that get missed.

## Stage 3 — Empirical prover (three-actor matrix)
${A.actors || 'Construct the three attacker clients + an admin client.'}
For every privileged unit / write path / scheduled job in the inventory AND for each Stage-2
candidate: (a) guard_holds — perform the forbidden action as EACH wrong actor → assert refused
AND the store row unchanged; (b) gap_real — perform each candidate's action for real → does it
wrongly land?; (c) happy_path — as the legitimate actor, walk the user story → each step works +
landed. Plant fixtures with the admin client, run, and confirm EVERY write with a direct
ground-truth read (that read is the evidence), then clean up. If no live stack, run the real
integration/E2E paths, mark the result degraded, and say what you could not execute.

${rules}

## Stage 4 — Adversarial verify + cross-modal
For each candidate, try HARD to REFUTE it: re-read the cited location, search for any existing
check (${A.guardExamples || DEFAULT_GUARD_EXAMPLES}) that blocks it, and weigh the
live result. Keep it only if genuinely unguarded; record which modalities agreed. Default to
refuted when uncertain. Fold in any live gap the static pass missed (empirical-only findings).

## Stage 5 — Root-cause family sweep
For each CONFIRMED finding, name its family pattern and sweep EVERY unit/table/policy in the
inventory for the same shape. New siblings re-enter Stage 4 (verify each), but a sibling's own
family is NOT swept again — sweep only the families of first-pass findings, one sweep per root
cause (ignore wording differences like a parenthetical note), or the sweep never ends.

## Stage 6 — Completeness critic
What did you NOT cover — a unit not probed from all 3 actors, a table not attacked as each wrong
actor, a happy-path branch not walked, a family not fully swept? If anything material remains,
do another pass over Stages 2–5 on the gap.

## Stage 7 — Report + RED-first tests
Emit ONE report: a severity table; each finding with location, the wrong-actor scenario, the
direct-read evidence, the fix, and the family; a VERIFIED-CORRECT section (high-risk areas
checked and found guarded); and a coverage note (what ran, what degraded, what remains).
For each CONFIRMED finding, emit a RED-first regression test (fails without the fix, passes with
it) paired with a direct ground-truth read. ${A.emitTestHint || 'Write it in the project test framework and pair the assertion with a direct store read bypassing the app authz.'}
Test command: ${A.testCmd || 'the project test runner'}.
`
}
