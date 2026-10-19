#!/usr/bin/env node
// livefire syntax check — validates the assembled workflow the way the Workflow runtime runs it:
// the body executes inside an async scope with agent()/parallel()/phase()/log()/args injected,
// so top-level `await` and `return` are LEGAL (a plain `node --check` wrongly rejects them).
// We keep `export const meta` parseable and wrap the rest in an async function to check syntax.
//
// Usage: node check.mjs

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const rel = 'dist/livefire.workflow.js'
const src = await readFile(join(ROOT, rel), 'utf8')

// `export const meta` → `const meta` so it lives inside the wrapper; the runtime extracts meta
// separately, but for a syntax check treating it as a plain declaration is faithful enough.
const body = src.replace(/^export\s+const\s+meta\s*=/m, 'const meta =')

try {
  // The Workflow runtime injects these globals and runs the body in an async scope.
  // eslint-disable-next-line no-new-func
  new Function(
    'args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow',
    `return (async () => {\n${body}\n})`
  )
  console.log(`syntax OK (Workflow-async scope): ${rel}`)
} catch (e) {
  console.error(`SYNTAX ERROR in ${rel}:\n  ${e.message}`)
  process.exit(1)
}

// Sentinel: the FULL preset REGISTRY must be inlined, so the controller can pass a small
// cfg.preset string. If a refactor empties the registry (as one did — degrading the first real
// run to `generic`), the workflow can only resolve an adapter from a large cfg.adapter object,
// which gets dropped in Workflow args transit. This assertion catches that regression at build.
const mustContain = ['const REGISTRY', 'supabaseAdapter', 'resolveAdapter(CFG, REGISTRY']
const missing = mustContain.filter((s) => !src.includes(s))
if (missing.length) {
  console.error(`REGISTRY-INLINE CHECK FAILED in ${rel}: missing ${JSON.stringify(missing)}.\n  The preset registry must be inlined and the workflow must resolve via cfg.preset, not a large cfg.adapter (dropped in transit).`)
  process.exit(1)
}
console.log('registry-inline OK: workflow resolves presets by id (cfg.preset)')
