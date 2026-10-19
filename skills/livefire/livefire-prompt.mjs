#!/usr/bin/env node
// livefire single-agent prompt generator — for harnesses without the Workflow tool.
//
// Resolves the adapter for a repo (config-file → auto-detect → generic) and prints ONE
// self-contained prompt you paste into any capable agent (Claude via API, Cursor, Cline, Codex,
// a custom loop) that has shell + DB access. Same 6-rule method, run sequentially by one agent.
//
// Usage:
//   node livefire-prompt.mjs [repoRoot] [--whole|--feature] [--preset <id>]
// Examples:
//   node livefire-prompt.mjs .                 # feature scope, auto-detect, current repo
//   node livefire-prompt.mjs ../app --whole    # whole-surface
//   node livefire-prompt.mjs . --preset laravel

import { resolveLaunchConfig } from './src/detect.js'
import { buildSingleAgentPrompt } from './src/single-agent.js'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))
const repoRoot = positional[0] || process.cwd()
const presetIdx = args.indexOf('--preset')
const preset = presetIdx !== -1 ? args[presetIdx + 1] : undefined
const securityPass = flags.has('--whole') ? true : flags.has('--feature') ? false : true

const overrides = {}
if (preset) overrides.preset = preset

const { adapter, source, needsInterview } = await resolveLaunchConfig(repoRoot, undefined, overrides)

if (needsInterview) {
  process.stderr.write(
    `livefire: no preset matched ${repoRoot} (source: ${source}).\n` +
    `The generic adapter is used — the printed prompt has placeholder instructions for the two\n` +
    `stack-specific points (authz inventory + three actors). Fill them in, or add a preset.\n\n`
  )
}
process.stderr.write(`livefire: adapter "${adapter.id}" (${source}) · scope ${securityPass ? 'whole-surface' : 'feature/diff'}\n\n`)
process.stdout.write(buildSingleAgentPrompt(adapter, { securityPass, repoRoot: (await import('node:path')).resolve(repoRoot) }))
