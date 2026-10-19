// Token-report tests (W4). `node test/tokens.test.mjs`
import assert from 'node:assert/strict'
import { tokenReport, transcriptReport } from '../tools/tokens.mjs'

let pass = 0, fail = 0
function t(name, fn) { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) } }

const RUN = {
  runId: 'wf_x', workflowName: 'livefire', totalTokens: 1000, agentCount: 4,
  workflowProgress: [
    { type: 'workflow_phase', title: 'Inventory' },
    { type: 'workflow_agent', label: 'inventory', phaseTitle: 'Inventory', tokens: 100, toolCalls: 5 },
    { type: 'workflow_agent', label: 'verify:a', phaseTitle: 'Verify', tokens: 300, toolCalls: 3 },
    { type: 'workflow_agent', label: 'verify:b', phaseTitle: 'Verify', tokens: 500, toolCalls: 7 },
    { type: 'workflow_agent', label: 'critic', phaseTitle: 'Critic', tokens: 100, toolCalls: 1, cached: true },
  ],
}
t('sums tokens per phase with agent count and share', () => {
  const r = tokenReport(RUN)
  const v = r.phases.find((p) => p.phase === 'Verify')
  assert.equal(v.tokens, 800); assert.equal(v.agents, 2); assert.equal(v.share, 0.8)
  assert.equal(r.total, 1000)
})
t('phases are ordered by first appearance, and the sum equals totalTokens', () => {
  const r = tokenReport(RUN)
  assert.deepEqual(r.phases.map((p) => p.phase), ['Inventory', 'Verify', 'Critic'])
  assert.equal(r.phases.reduce((a, p) => a + p.tokens, 0), RUN.totalTokens)
  assert.equal(r.consistent, true)
})
t('reports mean tokens per agent and the most expensive agents', () => {
  const r = tokenReport(RUN)
  assert.equal(r.phases.find((p) => p.phase === 'Verify').meanPerAgent, 400)
  assert.equal(r.top[0].label, 'verify:b')
})
t('cached (resumed) agents are counted separately', () => {
  const r = tokenReport(RUN)
  assert.equal(r.cachedAgents, 1)
})
t('flags a record whose per-agent sum disagrees with totalTokens', () => {
  const r = tokenReport({ ...RUN, totalTokens: 5000 })
  assert.equal(r.consistent, false)
})

// The runtime's `tokens` counter leaves out cache reads, which are ~97% of a run's real usage
// (1.G2, 2026-09-26). The transcripts carry the full usage per message.
const msg = (id, u) => JSON.stringify({ message: { id, usage: u } })
const AGENTS = [
  { meta: { workflowPhase: 'Static' }, lines: [JSON.stringify({ message: { content: 'x LIVE INVENTORY: y' } }), msg('m1', { cache_read_input_tokens: 100, cache_creation_input_tokens: 10, input_tokens: 1, output_tokens: 5 }), msg('m1', { cache_read_input_tokens: 100, cache_creation_input_tokens: 10, input_tokens: 1, output_tokens: 5 }), msg('m2', { cache_read_input_tokens: 200, output_tokens: 7 })] },
  { meta: { workflowPhase: 'Sweep' }, lines: [JSON.stringify({ message: { content: 'no inventory' } }), msg('s1', { cache_read_input_tokens: 50, cache_creation_input_tokens: 20 }), 'not json'] },
]
t('transcripts: every usage field counted, a repeated message id once, grouped by phase', () => {
  const r = transcriptReport(AGENTS)
  const st = r.phases.find((p) => p.phase === 'Static')
  assert.deepEqual([st.agents, st.turns, st.cacheRead, st.cacheWrite, st.input, st.output], [1, 2, 300, 10, 1, 12])
  assert.equal(r.total, 300 + 10 + 1 + 12 + 50 + 20)
  assert.equal(r.cacheReadShare, +((350 / r.total).toFixed(4)))
})
t('transcripts: agents that received the inventory are counted', () => {
  const r = transcriptReport(AGENTS)
  assert.equal(r.phases.find((p) => p.phase === 'Static').withInventory, 1)
  assert.equal(r.phases.find((p) => p.phase === 'Sweep').withInventory, 0)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
