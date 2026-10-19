// livefire detect/launch-resolution tests. `node src/detect.test.mjs`.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRepoProbe, loadLivefireConfig, resolveLaunchConfig, buildAdapterFromInterview, saveLivefireConfig, INTERVIEW_QUESTIONS, buildWorkflowArgs } from './detect.js'
import { supabaseAdapter } from '../presets/supabase.js'
import { REGISTRY as DEFAULT_REGISTRY } from '../presets/index.js'
import { resolveAdapter, parseWorkflowCfg, GENERIC_ADAPTER } from './adapter.js'
import { supabaseAdapter as _supa } from '../presets/supabase.js'
import { POSTGRES_INVENTORY_SQL } from './inventory.js'

const REGISTRY = { supabase: supabaseAdapter }
// Minimal stand-in repos (package.json + the marker paths detect looks for), so the suite runs anywhere.
const FIXTURES = new URL('../../../test/fixtures/repos/', import.meta.url).pathname
const NEXT_SUPABASE = FIXTURES + 'next-supabase'
const NEXT_PRISMA = FIXTURES + 'next-prisma'

let pass = 0, fail = 0
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`) }
  catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) }
}

console.log('buildRepoProbe (Next + Supabase fixture repo):')
await t('finds next + supabase deps', async () => {
  const probe = await buildRepoProbe(NEXT_SUPABASE)
  assert.ok(probe.deps.next, 'next dep missing')
  assert.ok(probe.deps['@supabase/ssr'], '@supabase/ssr missing')
})
await t('surfaces supabase/ path', async () => {
  const probe = await buildRepoProbe(NEXT_SUPABASE)
  assert.ok(probe.files.some((f) => f.startsWith('supabase/')), 'no supabase/ path')
})

console.log('resolveLaunchConfig (Next + Supabase fixture, no config file):')
await t('auto-detects supabase', async () => {
  const r = await resolveLaunchConfig(NEXT_SUPABASE, REGISTRY, {})
  assert.equal(r.adapter.id, 'supabase')
  assert.equal(r.source, 'auto-detect:supabase')
  assert.equal(r.needsInterview, false)
})
await t('explicit preset override wins', async () => {
  const r = await resolveLaunchConfig(NEXT_SUPABASE, REGISTRY, { preset: 'supabase' })
  assert.equal(r.source, 'preset:supabase')
})

await t('Next + Prisma with hand-rolled auth (no Supabase) resolves to the nextjs preset', async () => {
  const r = await resolveLaunchConfig(NEXT_PRISMA, DEFAULT_REGISTRY, {})
  assert.equal(r.adapter.id, 'nextjs')
  assert.equal(r.source, 'auto-detect:nextjs')
  assert.equal(r.needsInterview, false)
})
await t('the same fixture with the full registry still picks supabase for Next + Supabase', async () => {
  const r = await resolveLaunchConfig(NEXT_SUPABASE, DEFAULT_REGISTRY, {})
  assert.equal(r.adapter.id, 'supabase')
})

console.log('default REGISTRY covers the shipped presets:')
await t('has all 16 shipped presets', () => {
  for (const id of ['supabase', 'nextjs', 'rails', 'spring', 'laravel', 'express', 'nestjs', 'django', 'fastapi', 'flask', 'aspnet', 'symfony', 'go', 'strapi', 'firebase', 'hasura']) {
    assert.ok(DEFAULT_REGISTRY[id], `missing preset ${id}`)
  }
})

console.log('auto-detect + collision ordering (synthetic probes):')
function detectFrom(probe) {
  return resolveAdapter({}, DEFAULT_REGISTRY, { deps: {}, files: [], manifests: {}, manifestText: {}, ...probe })
}
await t('rails: Gemfile + config/database.yml', () => assert.equal(detectFrom({ files: ['Gemfile', 'config/database.yml', 'app/'], manifests: { Gemfile: true } }).adapter.id, 'rails'))
await t('spring: pom.xml', () => assert.equal(detectFrom({ files: ['pom.xml', 'src/'] }).adapter.id, 'spring'))
await t('laravel: artisan (wins over symfony)', () => assert.equal(detectFrom({ files: ['artisan', 'composer.json', 'app/'] }).adapter.id, 'laravel'))
await t('symfony: composer symfony/framework-bundle', () => assert.equal(detectFrom({ files: ['composer.json', 'bin/console'], manifestText: { 'composer.json': '{"require":{"symfony/framework-bundle":"^7"}}' } }).adapter.id, 'symfony'))
await t('supabase wins for Next+supabase', () => assert.equal(detectFrom({ deps: { next: '16', '@supabase/ssr': '1' }, files: ['supabase/config.toml'] }).adapter.id, 'supabase'))
await t('nestjs wins over express (Nest runs on Express)', () => assert.equal(detectFrom({ deps: { '@nestjs/core': '10', express: '4' } }).adapter.id, 'nestjs'))
await t('express: bare express only', () => assert.equal(detectFrom({ deps: { express: '4' } }).adapter.id, 'express'))
await t('nextjs: Next without Supabase (e.g. Next + Prisma) → nextjs, not generic', () => assert.equal(detectFrom({ deps: { next: '15', '@prisma/client': '6', 'next-auth': '5' } }).adapter.id, 'nextjs'))
await t('nextjs wins over express for a Next custom server', () => assert.equal(detectFrom({ deps: { next: '15', express: '4' } }).adapter.id, 'nextjs'))
await t('supabase still wins over nextjs for Next + supabase', () => assert.equal(detectFrom({ deps: { next: '15', '@supabase/supabase-js': '2' } }).adapter.id, 'supabase'))
await t('firebase wins over nextjs for Next + firebase', () => assert.equal(detectFrom({ deps: { next: '15', firebase: '10' } }).adapter.id, 'firebase'))
await t('hasura wins over nextjs when hasura metadata is present', () => assert.equal(detectFrom({ deps: { next: '15' }, files: ['hasura/', 'metadata/databases'] }).adapter.id, 'hasura'))
await t('django: manage.py', () => assert.equal(detectFrom({ files: ['manage.py'] }).adapter.id, 'django'))
await t('fastapi: requirements.txt', () => assert.equal(detectFrom({ files: ['requirements.txt'], manifestText: { 'requirements.txt': 'fastapi==0.110\nuvicorn\n' } }).adapter.id, 'fastapi'))
await t('flask: requirements.txt', () => assert.equal(detectFrom({ files: ['requirements.txt'], manifestText: { 'requirements.txt': 'Flask==3.0\n' } }).adapter.id, 'flask'))
await t('aspnet: .csproj', () => assert.equal(detectFrom({ files: ['Api.csproj', 'Program.cs'] }).adapter.id, 'aspnet'))
await t('go: go.mod with gin', () => assert.equal(detectFrom({ files: ['go.mod'], manifestText: { 'go.mod': 'require github.com/gin-gonic/gin v1.9.1' } }).adapter.id, 'go'))
await t('strapi: @strapi/strapi dep', () => assert.equal(detectFrom({ deps: { '@strapi/strapi': '5' } }).adapter.id, 'strapi'))
await t('firebase: firestore.rules', () => assert.equal(detectFrom({ files: ['firebase.json', 'firestore.rules'] }).adapter.id, 'firebase'))
await t('hasura: metadata/databases', () => assert.equal(detectFrom({ files: ['config.yaml', 'metadata/databases'] }).adapter.id, 'hasura'))
await t('go CLI (no web fw) → generic, not go', () => assert.equal(detectFrom({ files: ['go.mod'], manifestText: { 'go.mod': 'module foo\ngo 1.22\n' } }).adapter.id, 'generic'))
await t('unknown stack → generic', () => assert.equal(detectFrom({ files: ['README.md'] }).adapter.id, 'generic'))

console.log('workflow launch path — resolve by cfg.preset (small string), NOT a big cfg.adapter:')
// This is EXACTLY what the assembled workflow runs: resolveAdapter(CFG, REGISTRY, CFG.repoProbe).
// Regression guard for the bug where the whole adapter was passed via args, got dropped in
// transit, and the run silently degraded to `generic` (0 policies on a 138-migration Supabase app).
await t('cfg.preset="supabase" → supabase (not generic)', () => {
  const r = resolveAdapter({ preset: 'supabase' }, DEFAULT_REGISTRY, null)
  assert.equal(r.adapter.id, 'supabase')
  assert.equal(r.source, 'preset:supabase')
})
await t('every shipped preset id resolves via cfg.preset', () => {
  for (const id of Object.keys(DEFAULT_REGISTRY)) {
    const r = resolveAdapter({ preset: id }, DEFAULT_REGISTRY, null)
    assert.equal(r.adapter.id, id, `preset ${id} did not resolve`)
  }
})
await t('no preset + no probe → generic (loud, not a silent supabase)', () => {
  const r = resolveAdapter({}, DEFAULT_REGISTRY, null)
  assert.equal(r.adapter.id, 'generic')
})
await t('preset id keeps the real inventory (not generic placeholder)', () => {
  const r = resolveAdapter({ preset: 'supabase' }, DEFAULT_REGISTRY, null)
  assert.ok(r.adapter.inventorySql.includes('pg_policies'), 'supabase must carry the pg_policies dump')
})

console.log('EQUIVALENCE guards (livefire ⟷ verify-feature divergence fixes):')
// Fix 2 — robust cfg parsing: cfg survives as object OR stringified JSON OR stringified args.
await t('parseWorkflowCfg: object cfg', () => assert.equal(parseWorkflowCfg({ cfg: { preset: 'supabase' } }).preset, 'supabase'))
await t('parseWorkflowCfg: stringified cfg (the bug)', () => assert.equal(parseWorkflowCfg({ cfg: JSON.stringify({ preset: 'supabase', securityPass: false }) }).preset, 'supabase'))
await t('parseWorkflowCfg: stringified top-level args', () => assert.equal(parseWorkflowCfg(JSON.stringify({ cfg: { preset: 'supabase' } })).preset, 'supabase'))
await t('parseWorkflowCfg: empty / garbage → {}', () => { assert.deepEqual(parseWorkflowCfg(undefined), {}); assert.deepEqual(parseWorkflowCfg('not json'), {}) })
// cfg.preset (string) resolves the real preset — never generic when it's present.
await t('cfg.preset string → supabase, not generic', () => assert.equal(resolveAdapter(parseWorkflowCfg({ cfg: JSON.stringify({ preset: 'supabase' }) }), DEFAULT_REGISTRY, null).adapter.id, 'supabase'))
// Fix 3 — generic is NEVER blind on Postgres: its inventory probes pg_catalog and dumps the
// SAME catalog SQL the supabase preset uses. This is what makes a fallen-back run equivalent.
await t('GENERIC adapter probes Postgres + dumps the full catalog (not blind)', () => {
  assert.ok(GENERIC_ADAPTER.inventorySql.includes('pg_catalog.pg_proc'), 'generic must probe for Postgres')
  assert.ok(GENERIC_ADAPTER.inventorySql.includes('pg_policies'), 'generic must dump policies when Postgres')
})
await t('supabase + generic share the SAME Postgres catalog SQL (no drift)', () => {
  assert.ok(_supa.inventorySql === POSTGRES_INVENTORY_SQL, 'supabase must use the shared catalog SQL')
  assert.ok(GENERIC_ADAPTER.inventorySql.includes(POSTGRES_INVENTORY_SQL), 'generic must embed the shared catalog SQL')
})
await t('generic inventorySchema accepts policies[] + secret_columns[] (Postgres shape)', () => {
  const p = GENERIC_ADAPTER.inventorySchema.properties
  assert.ok(p.policies && p.secret_columns && p.secdef_funcs, 'generic schema must allow the Postgres catalog shape')
})

console.log('config-file discovery + generic/interview (tmp dirs):')
let dir
await t('livefire.config.json is loaded + selects preset', async () => {
  dir = await mkdtemp(join(tmpdir(), 'lf-'))
  await writeFile(join(dir, 'livefire.config.json'), JSON.stringify({ preset: 'supabase', securityPass: false }), 'utf8')
  const cfg = await loadLivefireConfig(dir)
  assert.equal(cfg.preset, 'supabase')
  assert.equal(cfg.__source, 'livefire.config.json')
  const r = await resolveLaunchConfig(dir, REGISTRY, {})
  assert.equal(r.adapter.id, 'supabase')
  assert.equal(r.source, 'config-file:livefire.config.json')
})
await t('empty repo → generic + needsInterview', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'lf-empty-'))
  const r = await resolveLaunchConfig(empty, REGISTRY, {})
  assert.equal(r.adapter.id, 'generic')
  assert.equal(r.source, 'generic')
  assert.equal(r.needsInterview, true)
  await rm(empty, { recursive: true, force: true })
})

console.log('interview → build adapter → save → reload roundtrip:')
await t('buildAdapterFromInterview fills fields', () => {
  const a = buildAdapterFromInterview({ id: 'strapi', repoContext: 'a strapi app', db: 'local pg', actors: 'strapi jwts', inventorySql: 'route->guard map', testCmd: 'npm test' })
  assert.equal(a.id, 'strapi')
  assert.equal(a.actors, 'strapi jwts')
  assert.ok(a.lenses.length >= 1, 'inherited lenses missing')
})
await t('saveLivefireConfig writes reloadable mjs', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lf-save-'))
  const cfg = { adapter: buildAdapterFromInterview({ id: 'strapi', db: 'local', actors: 'jwt', inventorySql: 'routes', testCmd: 'npm test' }), securityPass: false }
  const p = await saveLivefireConfig(d, cfg)
  assert.ok(p.endsWith('livefire.config.mjs'))
  const reloaded = await loadLivefireConfig(d)
  assert.equal(reloaded.adapter.id, 'strapi')
  assert.equal(reloaded.adapter.actors, 'jwt')
  await rm(d, { recursive: true, force: true })
})
await t('INTERVIEW_QUESTIONS covers the 5 adapter points', () => {
  const keys = INTERVIEW_QUESTIONS.map((q) => q.key)
  for (const k of ['repoContext', 'db', 'actors', 'inventorySql', 'testCmd']) assert.ok(keys.includes(k), `missing ${k}`)
})

console.log('monorepos — the app lives in a workspace package, not the root (W2.3):')
async function mkrepo(files) {
  const d = await mkdtemp(join(tmpdir(), 'lf-mono-'))
  const { mkdir } = await import('node:fs/promises')
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(d, rel, '..'), { recursive: true })
    await writeFile(join(d, rel), typeof body === 'string' ? body : JSON.stringify(body))
  }
  return d
}
await t('npm workspaces: apps/api express → express (root has no deps)', async () => {
  const d = await mkrepo({ 'package.json': { name: 'mono', private: true, workspaces: ['apps/*', 'packages/*'] }, 'apps/api/package.json': { dependencies: { express: '^4' } }, 'apps/web/package.json': { dependencies: { react: '^18' } } })
  const r = await resolveLaunchConfig(d, DEFAULT_REGISTRY, {})
  assert.equal(r.adapter.id, 'express')
  await rm(d, { recursive: true, force: true })
})
await t('conventional apps/* without a workspaces field: apps/web next + supabase/ → supabase', async () => {
  const d = await mkrepo({ 'package.json': { name: 'mono' }, 'apps/web/package.json': { dependencies: { next: '15', '@supabase/ssr': '1' } }, 'apps/web/supabase/config.toml': '' })
  const r = await resolveLaunchConfig(d, DEFAULT_REGISTRY, {})
  assert.equal(r.adapter.id, 'supabase')
  await rm(d, { recursive: true, force: true })
})
await t('python service in a subdir: services/api/manage.py → django', async () => {
  const d = await mkrepo({ 'README.md': 'x', 'services/api/manage.py': '', 'services/api/requirements.txt': 'Django==5.0\n' })
  const r = await resolveLaunchConfig(d, DEFAULT_REGISTRY, {})
  assert.equal(r.adapter.id, 'django')
  await rm(d, { recursive: true, force: true })
})
await t('probe records which package matched (so the report can name the app dir)', async () => {
  const d = await mkrepo({ 'package.json': { workspaces: ['apps/*'] }, 'apps/api/package.json': { dependencies: { express: '^4' } } })
  const probe = await buildRepoProbe(d)
  assert.ok((probe.packages || []).includes('apps/api'), 'packages[] does not list apps/api')
  await rm(d, { recursive: true, force: true })
})
await t('node_modules is never scanned as a workspace package', async () => {
  const d = await mkrepo({ 'package.json': { name: 'x' }, 'node_modules/express/package.json': { dependencies: { express: '^4' } } })
  const r = await resolveLaunchConfig(d, DEFAULT_REGISTRY, {})
  assert.equal(r.adapter.id, 'generic')
  await rm(d, { recursive: true, force: true })
})

await t('a CLI --preset beats an adapter pinned in livefire.config (overrides win over the file)', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lf-cli-'))
  await writeFile(join(d, 'livefire.config.json'), JSON.stringify({ adapter: { id: 'supabase', db: 'X' } }))
  const r = await resolveLaunchConfig(d, DEFAULT_REGISTRY, { preset: 'express' })
  assert.equal(r.adapter.id, 'express')
  assert.equal(buildWorkflowArgs(r, { repoRoot: d }).cfg.preset, 'express')
  await rm(d, { recursive: true, force: true })
})

console.log('buildWorkflowArgs — the exact cfg the controller hands the Workflow:')
await t('carries preset + scope + repoRoot + project overrides from livefire.config', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lf-args-'))
  await writeFile(join(d, 'livefire.config.json'), JSON.stringify({ preset: 'supabase', repoContext: 'TENANCY-MODEL', testCmd: 'npx vitest run', extraLenses: [{ key: 'money', prompt: 'MONEY lens' }] }))
  const r = await resolveLaunchConfig(d, DEFAULT_REGISTRY, {})
  const a = buildWorkflowArgs(r, { repoRoot: d, securityPass: true })
  assert.equal(a.cfg.preset, 'supabase')
  assert.equal(a.cfg.repoRoot, d)
  assert.equal(a.cfg.securityPass, true)
  assert.equal(a.cfg.repoContext, 'TENANCY-MODEL')
  assert.equal(a.cfg.testCmd, 'npx vitest run')
  assert.equal(a.cfg.extraLenses[0].key, 'money')
  assert.equal(a.cfg.adapter, undefined, 'a registry preset must travel as a string, never the adapter object')
  assert.ok(JSON.stringify(a).length < 20000, 'args too large for Workflow transit')
  await rm(d, { recursive: true, force: true })
})
await t('agent-budget caps from livefire.config reach the workflow cfg', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lf-cap-'))
  await writeFile(join(d, 'livefire.config.json'), JSON.stringify({ preset: 'supabase', maxAgents: 40, maxAgentsTotal: 150, siblingBatchSize: 5, inventoryMode: 'compact' }))
  const r = await resolveLaunchConfig(d, DEFAULT_REGISTRY, {})
  const a = buildWorkflowArgs(r, { repoRoot: d })
  assert.equal(a.cfg.maxAgents, 40, 'maxAgents dropped in transit')
  assert.equal(a.cfg.maxAgentsTotal, 150, 'maxAgentsTotal dropped in transit')
  assert.equal(a.cfg.siblingBatchSize, 5, 'siblingBatchSize dropped in transit')
  assert.equal(a.cfg.inventoryMode, 'compact', 'inventoryMode dropped in transit')
  await rm(d, { recursive: true, force: true })
})
await t('relative repoRoot is refused (agents need an absolute path)', async () => {
  const r = await resolveLaunchConfig(NEXT_SUPABASE, REGISTRY, {})
  assert.throws(() => buildWorkflowArgs(r, { repoRoot: 'rel/path' }))
})
await t('generic resolution ships NO adapter object (the workflow resolves generic + self-heals itself)', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lf-gen-'))
  const r = await resolveLaunchConfig(d, DEFAULT_REGISTRY, { db: 'stack up on 15410' })
  const a = buildWorkflowArgs(r, { repoRoot: d })
  assert.equal(a.cfg.adapter, undefined)
  assert.equal(a.cfg.preset, undefined)
  assert.equal(a.cfg.db, 'stack up on 15410')
  await rm(d, { recursive: true, force: true })
})
await t('overrides are applied exactly once end-to-end (controller args → workflow resolution)', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lf-once-'))
  await writeFile(join(d, 'livefire.config.json'), JSON.stringify({ adapter: { id: 'mystack', db: 'BASE-DB' }, db: 'EXTRA' }))
  const r = await resolveLaunchConfig(d, DEFAULT_REGISTRY, {})
  const a = buildWorkflowArgs(r, { repoRoot: d })
  const again = resolveAdapter(a.cfg, DEFAULT_REGISTRY).adapter
  assert.equal(again.db.split('EXTRA').length - 1, 1, 'db override appended more than once: ' + again.db)
  assert.ok(again.db.startsWith('BASE-DB'))
  await rm(d, { recursive: true, force: true })
})
await t('a custom interview adapter travels as cfg.adapter (no preset id)', () => {
  const r = { adapter: buildAdapterFromInterview({ id: 'custom', db: 'x' }), source: 'explicit', cfg: {} }
  const a = buildWorkflowArgs(r, { repoRoot: '/abs' })
  assert.equal(a.cfg.preset, undefined)
  assert.equal(a.cfg.adapter.db, 'x')
  assert.equal(a.cfg.adapter.detect, undefined)
})

if (dir) await rm(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
