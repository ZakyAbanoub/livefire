#!/usr/bin/env node
// Per-stage token report for a Workflow run (W4 — measure before optimising).
//
//   node tools/tokens.mjs <run-record.json | wf_runId> [--project-dir <~/.claude/projects/...>] [--json]
//   node tools/tokens.mjs --transcripts <…/subagents/workflows/<runId> dir> [--json]   (real usage, cache reads included)
//
// A Workflow run record (…/<session>/workflows/<runId>.json) carries every agent's `tokens` and
// `toolCalls` under workflowProgress. This groups them by phase so cost can be attributed to a
// pipeline stage (Inventory / Static / Prove / Verify / Sweep / Critic).

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

// The runtime's per-agent `tokens` leave out cache READS, which are most of a run's real usage
// (every agent re-reads its whole context on every turn: 1.G2 ≈ 290M, ~97% cache reads). The agent
// transcripts carry the full usage per message; this sums it per phase. Input: one entry per agent,
// { meta: <agent-*.meta.json>, lines: <agent-*.jsonl lines> }. A message id is counted once.
export function transcriptReport(agents) {
  const by = new Map()
  let total = 0, reads = 0
  for (const { meta, lines } of agents) {
    const ph = (meta && meta.workflowPhase) || '(none)'
    if (!by.has(ph)) by.set(ph, { phase: ph, agents: 0, withInventory: 0, turns: 0, cacheRead: 0, cacheWrite: 0, input: 0, output: 0 })
    const g = by.get(ph)
    g.agents++
    if (lines.slice(0, 3).some((l) => l.includes('LIVE INVENTORY'))) g.withInventory++
    const seen = new Set()
    for (const l of lines) {
      let e
      try { e = JSON.parse(l) } catch (_) { continue }
      const m = e && e.message
      if (!m || !m.usage || seen.has(m.id)) continue
      seen.add(m.id)
      const u = m.usage
      g.turns++
      g.cacheRead += u.cache_read_input_tokens || 0
      g.cacheWrite += u.cache_creation_input_tokens || 0
      g.input += u.input_tokens || 0
      g.output += u.output_tokens || 0
    }
  }
  const phases = Array.from(by.values()).map((g) => ({ ...g, total: g.cacheRead + g.cacheWrite + g.input + g.output }))
  for (const g of phases) { total += g.total; reads += g.cacheRead }
  return { total, cacheReadShare: total ? +(reads / total).toFixed(4) : 0, phases: phases.map((g) => ({ ...g, share: total ? +(g.total / total).toFixed(4) : 0 })) }
}

export function tokenReport(run) {
  const agents = (run.workflowProgress || []).filter((p) => p.type === 'workflow_agent')
  const order = []
  const by = new Map()
  for (const a of agents) {
    const ph = a.phaseTitle || '(none)'
    if (!by.has(ph)) { by.set(ph, { phase: ph, tokens: 0, agents: 0, toolCalls: 0 }); order.push(ph) }
    const g = by.get(ph)
    g.tokens += a.tokens || 0; g.agents += 1; g.toolCalls += a.toolCalls || 0
  }
  const sum = agents.reduce((s, a) => s + (a.tokens || 0), 0)
  const total = run.totalTokens || sum
  const phases = order.map((ph) => { const g = by.get(ph); return { ...g, share: total ? +(g.tokens / total).toFixed(4) : 0, meanPerAgent: g.agents ? Math.round(g.tokens / g.agents) : 0 } })
  const top = agents.slice().sort((a, b) => (b.tokens || 0) - (a.tokens || 0)).slice(0, 10).map((a) => ({ label: a.label, phase: a.phaseTitle, tokens: a.tokens || 0, toolCalls: a.toolCalls || 0 }))
  return { runId: run.runId, workflow: run.workflowName, status: run.status, total, agentCount: agents.length, consistent: sum === total, cachedAgents: agents.filter((a) => a.cached).length, phases, top }
}

async function findRecord(id, projectsDir) {
  for (const proj of await readdir(projectsDir, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue
    let sessions = []
    try { sessions = await readdir(join(projectsDir, proj.name), { withFileTypes: true }) } catch (_) { continue }
    for (const s of sessions) {
      if (!s.isDirectory()) continue
      const p = join(projectsDir, proj.name, s.name, 'workflows', `${id}.json`)
      try { return JSON.parse(await readFile(p, 'utf8')) } catch (_) { /* keep looking */ }
    }
  }
  throw new Error(`run record ${id} not found under ${projectsDir}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const target = argv.find((a) => !a.startsWith('--'))
  const pdIdx = argv.indexOf('--project-dir')
  const projectsDir = pdIdx !== -1 ? argv[pdIdx + 1] : join(homedir(), '.claude', 'projects')
  if (!target) { console.error('usage: node tools/tokens.mjs <run-record.json | wf_runId> [--json]\n       node tools/tokens.mjs --transcripts <…/subagents/workflows/<runId> dir> [--json]'); process.exit(2) }
  if (argv.includes('--transcripts')) {
    const files = (await readdir(target)).filter((f) => f.startsWith('agent-') && f.endsWith('.meta.json'))
    const agents = []
    for (const f of files) {
      const meta = JSON.parse(await readFile(join(target, f), 'utf8'))
      const body = await readFile(join(target, f.replace('.meta.json', '.jsonl')), 'utf8').catch(() => '')
      agents.push({ meta, lines: body.split('\n').filter(Boolean) })
    }
    const r = transcriptReport(agents)
    if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0) }
    const M = (n) => (n / 1e6).toFixed(1) + 'M'
    console.log(`transcripts: ${agents.length} agents — ${M(r.total)} tokens, ${(r.cacheReadShare * 100).toFixed(1)}% cache reads`)
    console.log('phase        total   share  agents  +inv  turns  cacheRead  cacheWrite  output')
    for (const p of r.phases) console.log(`${p.phase.padEnd(12)} ${M(p.total).padStart(6)}  ${(p.share * 100).toFixed(1).padStart(5)}%  ${String(p.agents).padStart(6)}  ${String(p.withInventory).padStart(4)}  ${String(p.turns).padStart(5)}  ${M(p.cacheRead).padStart(9)}  ${M(p.cacheWrite).padStart(10)}  ${M(p.output).padStart(6)}`)
    process.exit(0)
  }
  const run = target.endsWith('.json') ? JSON.parse(await readFile(target, 'utf8')) : await findRecord(target, projectsDir)
  const r = tokenReport(run)
  if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0) }
  const k = (n) => (n / 1000).toFixed(0) + 'k'
  console.log(`${r.workflow} ${r.runId} (${r.status}) — ${k(r.total)} tokens, ${r.agentCount} agents${r.consistent ? '' : '  ⚠️ per-agent sum ≠ totalTokens'}${r.cachedAgents ? `, ${r.cachedAgents} cached` : ''}`)
  console.log('phase        tokens   share  agents  mean/agent  toolCalls')
  for (const p of r.phases) console.log(`${p.phase.padEnd(12)} ${k(p.tokens).padStart(6)}  ${(p.share * 100).toFixed(1).padStart(5)}%  ${String(p.agents).padStart(6)}  ${k(p.meanPerAgent).padStart(10)}  ${String(p.toolCalls).padStart(9)}`)
  console.log('\ntop agents:'); for (const a of r.top) console.log(`  ${k(a.tokens).padStart(6)}  ${a.phase.padEnd(10)} ${a.label}`)
}
