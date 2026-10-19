#!/usr/bin/env node
// livefire — install as a user-global Claude Code skill (alternative to the /plugin marketplace).
//
// Copies the self-contained skill (skills/livefire/: SKILL.md + src + presets + dist + prompt CLI)
// into ~/.claude/skills/livefire/. Re-run after editing sources (it rebuilds the workflow first).
// Idempotent. Prefer `/plugin marketplace add ZakyAbanoub/livefire` + `/plugin install livefire` when
// distributing via GitHub; this script is for a local, no-marketplace install.
//
// Usage: node install-skill.mjs
// After it runs, reload Claude Code and use:  /livefire feature   |   /livefire whole

import { cp, mkdir, rm, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const ROOT = dirname(fileURLToPath(import.meta.url))
const SKILLS = join(ROOT, 'skills')
const DESTROOT = join(homedir(), '.claude', 'skills')

// 1. Rebuild the universal workflow so the engine's dist/ is current.
execFileSync('node', [join(SKILLS, 'livefire', 'build.mjs')], { stdio: 'inherit' })

// 2. Install every skill in the plugin (the core `livefire` carries the engine; the sibling
//    command-skills reference it via ../livefire, valid both in the plugin and here as siblings).
const filter = (src) => !src.endsWith('.test.mjs')
const names = (await readdir(SKILLS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
for (const name of names) {
  const dest = join(DESTROOT, name)
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  await cp(join(SKILLS, name), dest, { recursive: true, filter })
}

console.log(`\ninstalled ${names.length} skills → ${DESTROOT}/{${names.join(', ')}}`)
console.log('reload Claude Code, then use:  /livefire  ·  /livefire-map  ·  /livefire-config  ·  /livefire-prompt  ·  /livefire-add-preset')
