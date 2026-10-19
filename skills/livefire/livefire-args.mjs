#!/usr/bin/env node
// livefire launch-args — print the EXACT Workflow `args` for a repo, so the controller never
// hand-assembles them. Resolves config-file → auto-detect → generic, layers the project's
// livefire.config overrides, and pins repoRoot (absolute) for every agent.
//
// Usage: node livefire-args.mjs <repoRoot> [--whole|--feature] [--preset <id>] [--range <a...b>]
//                               [--set <field>=<text>]...   (project override, e.g. --set db='stack already up on :15410')
// Prints: {"cfg":{...}} on stdout; the resolution source on stderr.

import { resolve } from 'node:path'
import { resolveLaunchConfig, buildWorkflowArgs } from './src/detect.js'

const argv = process.argv.slice(2)
const val = (f) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : undefined }
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--preset', '--range', '--set'].includes(argv[i - 1]))
const repoRoot = resolve(positional[0] || process.cwd())
const overrides = {}
if (val('--preset')) overrides.preset = val('--preset')
argv.forEach((a, i) => {
  if (a !== '--set') return
  const kv = argv[i + 1] || ''
  const eq = kv.indexOf('=')
  if (eq > 0) overrides[kv.slice(0, eq)] = kv.slice(eq + 1)
})
const securityPass = argv.includes('--whole') ? true : argv.includes('--feature') ? false : undefined

const r = await resolveLaunchConfig(repoRoot, undefined, overrides)
const out = buildWorkflowArgs(r, { repoRoot, securityPass, range: val('--range') })
process.stderr.write(`livefire: adapter "${r.adapter.id}" (${r.source})${r.needsInterview ? ' — NEEDS INTERVIEW' : ''} · overrides: ${(r.adapter.overridden || []).join(', ') || 'none'}\n`)
process.stdout.write(JSON.stringify(out) + '\n')
