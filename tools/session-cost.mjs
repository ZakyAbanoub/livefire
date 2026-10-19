#!/usr/bin/env node
// What did a Claude Code session cost? Sums the per-message `usage` of the main transcript, every
// background subagent and every Workflow agent of one session (W4.5).
//
//   node tools/session-cost.mjs <sessionId> [--project-dir <dir>] [--prices <json>] [--json]
//
// --prices takes $ per MILLION tokens: '{"input":…,"cacheWrite":…,"cacheRead":…,"output":…}'.
// Token classes are reported separately because they are priced very differently: a cache READ
// costs a small fraction of a fresh input token, and long agent loops are dominated by reads.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const empty = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, messages: 0, models: {} })

// Streaming writes the same assistant message (same id) several times — count each id once,
// keeping the largest usage seen. NOTE: transcripts record usage as of message START, so
// output_tokens is a LOWER BOUND (the final output count is not persisted); input / cache
// write / cache read are exact.
export function usageOfTranscript(text) {
  const byId = new Map()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch (_) { continue }
    const m = o && o.message
    if (!m || typeof m !== 'object' || !m.usage) continue
    const id = m.id || JSON.stringify(m.usage) + (o.timestamp || '')
    const cur = { input: m.usage.input_tokens || 0, cacheWrite: m.usage.cache_creation_input_tokens || 0, cacheRead: m.usage.cache_read_input_tokens || 0, output: m.usage.output_tokens || 0, model: m.model }
    const prev = byId.get(id)
    if (!prev) { byId.set(id, cur); continue }
    for (const k of ['input', 'cacheWrite', 'cacheRead', 'output']) prev[k] = Math.max(prev[k], cur[k])
  }
  const u = empty()
  for (const v of byId.values()) {
    u.input += v.input; u.cacheWrite += v.cacheWrite; u.cacheRead += v.cacheRead; u.output += v.output; u.messages += 1
    if (v.model) u.models[v.model] = (u.models[v.model] || 0) + 1
  }
  return u
}

function add(a, b) {
  const r = { ...a, models: { ...a.models } }
  for (const k of ['input', 'cacheWrite', 'cacheRead', 'output', 'messages']) r[k] += b[k]
  for (const [k, v] of Object.entries(b.models)) r.models[k] = (r.models[k] || 0) + v
  return r
}
export const tokensOf = (u) => u.input + u.cacheWrite + u.cacheRead + u.output
export function priceOf(u, p) {
  return +((u.input * p.input + u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6).toFixed(2)
}

async function readText(p) { try { return await readFile(p, 'utf8') } catch (_) { return '' } }
async function list(p) { try { return await readdir(p, { withFileTypes: true }) } catch (_) { return [] } }

export async function sessionCost(projectDir, sessionId) {
  const main = usageOfTranscript(await readText(join(projectDir, `${sessionId}.jsonl`)))
  const subDir = join(projectDir, sessionId, 'subagents')
  const subagents = []
  for (const e of await list(subDir)) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
    const id = e.name.replace(/\.jsonl$/, '')
    let label = id
    try { label = JSON.parse(await readText(join(subDir, `${id}.meta.json`))).description || id } catch (_) { /* keep id */ }
    subagents.push({ id, label, usage: usageOfTranscript(await readText(join(subDir, e.name))) })
  }
  const workflows = []
  for (const w of await list(join(subDir, 'workflows'))) {
    if (!w.isDirectory()) continue
    let usage = empty(), agents = 0
    for (const f of await list(join(subDir, 'workflows', w.name))) {
      if (!f.isFile() || !/^agent-.*\.jsonl$/.test(f.name)) continue
      agents++
      usage = add(usage, usageOfTranscript(await readText(join(subDir, 'workflows', w.name, f.name))))
    }
    workflows.push({ runId: w.name, agents, usage })
  }
  let total = main
  for (const s of subagents) total = add(total, s.usage)
  for (const w of workflows) total = add(total, w.usage)
  return { sessionId, main, subagents, workflows, total }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const sid = argv.find((a) => !a.startsWith('--') && !['--project-dir', '--prices'].includes(argv[argv.indexOf(a) - 1]))
  const v = (f) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : undefined }
  const projectDir = v('--project-dir') || join(homedir(), '.claude', 'projects', process.cwd().replace(/[\/.]/g, '-'))
  const prices = v('--prices') ? JSON.parse(v('--prices')) : null
  if (!sid) { console.error('usage: node tools/session-cost.mjs <sessionId> [--project-dir d] [--prices json] [--json]'); process.exit(2) }
  const r = await sessionCost(projectDir, sid)
  if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0) }
  const k = (n) => (n / 1000).toFixed(0).padStart(7) + 'k'
  const row = (name, u) => console.log(`${name.slice(0, 44).padEnd(44)} ${k(u.input)} ${k(u.cacheWrite)} ${k(u.cacheRead)} ${k(u.output)} ${k(tokensOf(u))}${prices ? '  $' + priceOf(u, prices).toFixed(2).padStart(8) : ''}`)
  console.log(`${'part'.padEnd(44)} ${'input'.padStart(8)} ${'cacheW'.padStart(8)} ${'cacheR'.padStart(8)} ${'output'.padStart(8)} ${'total'.padStart(8)}${prices ? '       $' : ''}`)
  row('main session', r.main)
  for (const s of r.subagents) row('agent: ' + s.label, s.usage)
  for (const w of r.workflows) row(`workflow ${w.runId} (${w.agents} agents)`, w.usage)
  row('TOTAL', r.total)
  console.log('models:', JSON.stringify(r.total.models))
  console.log('note: output is a LOWER BOUND (transcripts persist usage at message start); input/cache figures are exact.')
}
