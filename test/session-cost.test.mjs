// Session-cost tests (W4.5). `node test/session-cost.test.mjs`
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { usageOfTranscript, sessionCost } from '../tools/session-cost.mjs'

let pass = 0, fail = 0
async function t(name, fn) { try { await fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) } }

const msg = (id, u, model = 'claude-opus-5-5') => JSON.stringify({ type: 'assistant', message: { id, model, usage: u } })
const U = (i, cw, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: o })

await t('sums usage and counts a streamed message id once', () => {
  const lines = [msg('a', U(1, 10, 100, 5)), msg('a', U(1, 10, 100, 5)), msg('b', U(2, 0, 200, 7)), '{"type":"user"}', 'not json']
  const u = usageOfTranscript(lines.join('\n'))
  assert.deepEqual({ input: u.input, cacheWrite: u.cacheWrite, cacheRead: u.cacheRead, output: u.output, messages: u.messages }, { input: 3, cacheWrite: 10, cacheRead: 300, output: 12, messages: 2 })
  assert.deepEqual(u.models, { 'claude-opus-5-5': 2 })
})
await t('a streamed message keeps its FINAL usage (partial records come first)', () => {
  const lines = [msg('a', U(1, 10, 100, 1)), msg('a', U(1, 10, 100, 250))]
  assert.equal(usageOfTranscript(lines.join('\n')).output, 250)
})
await t('groups a session: main, each subagent (by description), each workflow', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lf-cost-'))
  const sid = 'sess'
  await writeFile(join(d, `${sid}.jsonl`), [msg('m1', U(1, 1000, 0, 50))].join('\n'))
  await mkdir(join(d, sid, 'subagents', 'workflows', 'wf_1'), { recursive: true })
  await writeFile(join(d, sid, 'subagents', 'agent-x.jsonl'), msg('s1', U(1, 0, 500, 20)))
  await writeFile(join(d, sid, 'subagents', 'agent-x.meta.json'), JSON.stringify({ description: 'Build express sample' }))
  await writeFile(join(d, sid, 'subagents', 'workflows', 'wf_1', 'agent-y.jsonl'), msg('w1', U(0, 0, 900, 30)))
  await writeFile(join(d, sid, 'subagents', 'workflows', 'wf_1', 'agent-z.jsonl'), msg('w2', U(0, 0, 100, 10)))
  const r = await sessionCost(d, sid)
  assert.equal(r.main.cacheWrite, 1000)
  assert.equal(r.subagents[0].label, 'Build express sample')
  assert.equal(r.workflows[0].runId, 'wf_1'); assert.equal(r.workflows[0].agents, 2); assert.equal(r.workflows[0].usage.cacheRead, 1000)
  assert.equal(r.total.output, 50 + 20 + 40)
  await rm(d, { recursive: true, force: true })
})
await t('prices a usage record when a price table is given ($ per million tokens)', async () => {
  const { priceOf } = await import('../tools/session-cost.mjs')
  const cost = priceOf({ input: 1e6, cacheWrite: 1e6, cacheRead: 1e6, output: 1e6 }, { input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 })
  assert.equal(cost, 73.5)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
