// livefire — Stage 0 launch resolution: config file → auto-detect → interview.
//
// Controller-side (plain Node: fs + dynamic import). NOT part of the assembled Workflow script.
// Decides which VerifyAdapter to run before launching, in this precedence:
//   1. livefire.config.{mjs,js,json} in the repo root  (a project pins its own setup once)
//   2. auto-detect                                      (probe the repo, match a preset)
//   3. generic + interview                              (no preset fits → ask, offer to save)

import { readFile, readdir, access } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveAdapter, GENERIC_ADAPTER } from './adapter.js'
import { REGISTRY as DEFAULT_REGISTRY } from '../presets/index.js'

const exists = (p) => access(p).then(() => true, () => false)

// Manifests that identify a stack even when there is no package.json (Java, Ruby, Python, Go…).
const MANIFEST_FILES = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json', 'manage.py', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'mix.exs']
// Manifests whose TEXT a detect() may grep for a framework name (no package.json equivalent).
const MANIFEST_TEXT_FILES = ['requirements.txt', 'pyproject.toml', 'composer.json', 'go.mod', 'Gemfile', 'build.gradle', 'build.gradle.kts', 'pom.xml']
// Nested paths worth surfacing to a preset's detect() (kept shallow + cheap).
const NESTED_HINTS = ['supabase/config.toml', 'supabase/migrations', 'prisma/schema.prisma', 'config/database.yml', 'db/schema.rb', 'drizzle.config.ts', 'app/api', 'src/app', 'bin/console', 'firestore.rules', 'firebase.json', 'metadata/databases']

// Probe ONE directory: its package.json deps, shallow file list, manifests and manifest text.
async function scanDir(dir) {
  const deps = {}
  const manifests = {}
  const files = []
  let pkg = null
  const pkgPath = join(dir, 'package.json')
  if (await exists(pkgPath)) {
    try {
      pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      Object.assign(deps, pkg.dependencies || {}, pkg.devDependencies || {})
      manifests['package.json'] = true
    } catch (_) { /* malformed package.json → treated as absent */ }
  }
  // Shallow listing (dirs get a trailing slash so `startsWith('supabase/')` matches).
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) files.push(e.isDirectory() ? e.name + '/' : e.name)
  } catch (_) { /* unreadable → empty file list */ }
  for (const m of MANIFEST_FILES) if (files.includes(m)) manifests[m] = true
  for (const h of NESTED_HINTS) if (await exists(join(dir, h))) files.push(h)
  // Manifest TEXT so a detect() can grep for a framework name (Python/PHP/Go/Ruby have no
  // package.json to read deps from). Truncated + failure-tolerant.
  const manifestText = {}
  for (const m of MANIFEST_TEXT_FILES) {
    if (!files.includes(m)) continue
    try { manifestText[m] = (await readFile(join(dir, m), 'utf8')).slice(0, 20000) } catch (_) { /* skip */ }
  }
  return { deps, files, manifests, manifestText, pkg }
}

// Where an app hides in a monorepo: the root's npm/yarn/pnpm `workspaces` globs, plus the
// conventional containers. One level of `<container>/*` only — cheap, and never node_modules.
const CONTAINER_DIRS = ['apps', 'packages', 'services']
const SINGLE_APP_DIRS = ['backend', 'server', 'api', 'web', 'app']
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.next'])
async function workspaceDirs(repoRoot, rootPkg) {
  const out = new Set()
  const globs = []
  const ws = rootPkg && rootPkg.workspaces
  if (Array.isArray(ws)) globs.push(...ws)
  else if (ws && Array.isArray(ws.packages)) globs.push(...ws.packages)
  for (const c of CONTAINER_DIRS) globs.push(c + '/*')
  for (const d of SINGLE_APP_DIRS) globs.push(d)
  for (const g of globs) {
    const clean = String(g).replace(/\/\*\*$/, '/*').replace(/\/$/, '')
    if (clean.startsWith('.') || clean.includes('..')) continue
    if (clean.endsWith('/*')) {
      const base = clean.slice(0, -2)
      if (base.includes('*') || SKIP_DIRS.has(base)) continue
      try {
        for (const e of await readdir(join(repoRoot, base), { withFileTypes: true })) {
          if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) out.add(base + '/' + e.name)
        }
      } catch (_) { /* container absent */ }
    } else if (!clean.includes('*') && !SKIP_DIRS.has(clean)) {
      try { if ((await readdir(join(repoRoot, clean))).length) out.add(clean) } catch (_) { /* absent */ }
    }
  }
  return Array.from(out).sort().slice(0, 40)
}

// Probe the repo into the shape a preset's detect(repo) expects: { deps, files, manifests,
// manifestText, packages }. The root is scanned, then every workspace/app package (monorepos):
// their deps/manifests are MERGED in and their files are surfaced both as `<pkg>/<file>` and as
// bare names, so a preset's detect() fires whether the app sits at the root or in apps/api.
// `packages` lists the sub-packages that contributed anything (the report can name the app dir).
export async function buildRepoProbe(repoRoot) {
  const root = await scanDir(repoRoot)
  const probe = { deps: { ...root.deps }, files: root.files.slice(), manifests: { ...root.manifests }, manifestText: { ...root.manifestText }, packages: [] }
  for (const rel of await workspaceDirs(repoRoot, root.pkg)) {
    const sub = await scanDir(join(repoRoot, rel))
    const contributes = Object.keys(sub.deps).length || Object.keys(sub.manifests).length || sub.files.some((f) => NESTED_HINTS.includes(f))
    if (!contributes) continue
    probe.packages.push(rel)
    Object.assign(probe.deps, sub.deps)
    for (const [k, v] of Object.entries(sub.manifests)) probe.manifests[k] = v
    for (const [k, v] of Object.entries(sub.manifestText)) probe.manifestText[k] = ((probe.manifestText[k] || '') + '\n' + v).slice(0, 40000)
    for (const f of sub.files) {
      probe.files.push(rel + '/' + f)
      if (!probe.files.includes(f)) probe.files.push(f)
    }
  }
  return probe
}

// Load a livefire.config.{mjs,js,json} from the repo root, if present. Returns its config object
// (default export for JS, parsed object for JSON) or null.
export async function loadLivefireConfig(repoRoot) {
  for (const name of ['livefire.config.mjs', 'livefire.config.js', 'livefire.config.json']) {
    const p = join(repoRoot, name)
    if (!(await exists(p))) continue
    if (name.endsWith('.json')) {
      try { return { ...JSON.parse(await readFile(p, 'utf8')), __source: name } } catch (_) { return null }
    }
    try {
      const mod = await import(pathToFileURL(p).href)
      const cfg = mod.default || mod.config || mod
      return { ...cfg, __source: name }
    } catch (_) { return null }
  }
  return null
}

// The Stage-0 orchestrator. overrides (CLI/skill args like { preset, scope, securityPass })
// win over the config file. Returns everything the controller needs to launch or to interview.
export async function resolveLaunchConfig(repoRoot, registry = DEFAULT_REGISTRY, overrides = {}) {
  const fileCfg = (await loadLivefireConfig(repoRoot)) || {}
  const cfg = { ...fileCfg, ...overrides }
  // An explicit CLI/skill preset beats an adapter pinned in the file (overrides win over the file).
  if (overrides.preset && !overrides.adapter) delete cfg.adapter
  const probe = await buildRepoProbe(repoRoot)
  const { adapter, source } = resolveAdapter(cfg, registry, probe)
  const configFileSource = fileCfg.__source ? `config-file:${fileCfg.__source}` : null
  return {
    adapter,
    // Prefer reporting the config file as the source when it actually chose the adapter.
    source: (configFileSource && (cfg.adapter || (cfg.preset && registry[cfg.preset]))) ? configFileSource : source,
    cfg,
    probe,
    needsInterview: source === 'generic',
  }
}

// Build the EXACT Workflow `args` the controller launches with. A registry preset travels as its
// small id STRING (the REGISTRY is inlined in the workflow — a large adapter object gets dropped in
// Workflow-args transit); only a genuine custom/interview adapter travels as cfg.adapter. Project
// overrides from livefire.config (repoContext/db/actors/testCmd/lenses/extraLenses…) ride along
// as plain strings/arrays, and repoRoot tells every agent which checkout to work in (agents run in
// the session's cwd, which need not be the audited repo).
const OVERRIDE_KEYS = ['repoContext', 'db', 'actors', 'inventorySql', 'inventoryFlagHint', 'testCmd', 'emitTestHint', 'lenses', 'extraLenses', 'maxCriticRounds', 'maxAgents', 'maxAgentsTotal', 'siblingBatchSize', 'inventoryMode']
export function buildWorkflowArgs(resolved, { repoRoot, securityPass, range } = {}) {
  if (!repoRoot || !isAbsolute(repoRoot)) throw new Error(`livefire: repoRoot must be an absolute path (got ${JSON.stringify(repoRoot)})`)
  const src = resolved.cfg || {}
  const cfg = {}
  const id = resolved.adapter && resolved.adapter.id
  const plain = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'function' || k === 'overridden' ? undefined : v)))
  if (src.adapter && typeof src.adapter === 'object') {
    // An inline adapter from livefire.config: ship it RAW — overrides ride separately and are
    // layered once, in the workflow (shipping the merged adapter would apply them twice).
    cfg.adapter = plain(src.adapter)
  } else if (id && DEFAULT_REGISTRY[id]) {
    cfg.preset = id
  } else if (id && id !== 'generic') {
    // An interview adapter built by the controller (not in cfg): it already IS the whole story.
    cfg.adapter = plain(resolved.adapter)
  }
  // generic → ship neither: the workflow resolves generic itself and self-heals by runtime detect.
  for (const k of OVERRIDE_KEYS) if (src[k] !== undefined) cfg[k] = src[k]
  cfg.repoRoot = repoRoot
  cfg.securityPass = securityPass !== undefined ? !!securityPass : src.securityPass !== false
  cfg.range = range || src.range || 'main...HEAD'
  return { cfg }
}

// The five things the interview must establish when no preset fits. The controller asks these,
// then calls buildAdapterFromInterview + (optionally) saveLivefireConfig.
export const INTERVIEW_QUESTIONS = [
  { key: 'repoContext', q: 'One paragraph: the app, its tenancy/ownership model, and who the "wrong actors" are.' },
  { key: 'db', q: 'How does an agent reach a LOCAL/disposable DB + an admin client for planting fixtures and the confirming ground-truth read? (must be a throwaway target)' },
  { key: 'actors', q: 'How to build the three attacker positions the stack\'s way — anon / authenticated outsider / wrong-role insider — plus the admin client.' },
  { key: 'inventorySql', q: 'How to enumerate the authz model as data — DB policies/grants if DB-native, else the route→guard map + queries missing a tenant filter.' },
  { key: 'testCmd', q: 'The project test runner (e.g. pytest, bundle exec rspec, ./gradlew test).' },
]

// Assemble a VerifyAdapter from interview answers (string fields; inherits generic schema/lenses).
export function buildAdapterFromInterview(answers = {}) {
  return {
    id: answers.id || 'custom',
    repoContext: answers.repoContext || GENERIC_ADAPTER.repoContext,
    db: answers.db || GENERIC_ADAPTER.db,
    actors: answers.actors || GENERIC_ADAPTER.actors,
    inventorySql: answers.inventorySql || GENERIC_ADAPTER.inventorySql,
    inventorySchema: GENERIC_ADAPTER.inventorySchema,
    testCmd: answers.testCmd || GENERIC_ADAPTER.testCmd,
    lenses: GENERIC_ADAPTER.lenses,
    emitTestHint: answers.emitTestHint || GENERIC_ADAPTER.emitTestHint,
  }
}

// Persist an interview result (or any cfg of string fields) as livefire.config.mjs so the next
// run is turnkey. Only string-serializable fields survive (functions like detect() are dropped).
export async function saveLivefireConfig(repoRoot, cfg) {
  const clean = JSON.parse(JSON.stringify(cfg, (k, v) => (k === '__source' || typeof v === 'function' ? undefined : v)))
  const body = `// livefire.config.mjs — generated. Pins this project's verify setup so livefire runs turnkey.
// Edit freely. See src/adapter.js for the VerifyAdapter contract.
export default ${JSON.stringify(clean, null, 2)}
`
  const p = join(repoRoot, 'livefire.config.mjs')
  await writeFile(p, body, 'utf8')
  return p
}
