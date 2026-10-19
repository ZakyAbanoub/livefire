// Scorer tests (W3). `node test/score.test.mjs`
import assert from 'node:assert/strict'
import { scoreRun } from '../samples/score.mjs'

let pass = 0, fail = 0
function t(name, fn) { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.error(`FAIL  ${name}\n      ${e.message}`) } }

const ANSWERS = { preset: 'express', holes: [
  { id: 'H1', family: 'anon-privileged-op', file: 'src/routes/admin.js', symbols: ['/admin/orgs/:id/purge', 'purgeOrg'] },
  { id: 'H4', family: 'idor-unscoped-query', file: 'src/routes/notes.js', symbols: ['GET /notes/:id'] },
] }
const v = (o) => ({ title: 't', confirmed: true, confidence: 8, corrected_severity: 'high', family: 'f', modalities: ['static', 'empirical'], reason: 'r', file: 'x', line: 1, fix: 'f', ...o })

t('every hole confirmed-strong → pass', () => {
  const r = scoreRun({ confirmed_strong: [v({ file: './src/routes/admin.js' }), v({ file: 'other.js', title: 'IDOR on GET /notes/:id' })], confirmed_weak: [], dismissed: [] }, ANSWERS)
  assert.equal(r.pass, true); assert.deepEqual(r.missed, [])
})
t('a hole found only as confirmed-weak does NOT count', () => {
  const r = scoreRun({ confirmed_strong: [v({ file: 'src/routes/admin.js' })], confirmed_weak: [v({ file: 'src/routes/notes.js', modalities: ['static'] })], dismissed: [] }, ANSWERS)
  assert.equal(r.pass, false); assert.deepEqual(r.missed, ['H4']); assert.deepEqual(r.weakOnly, ['H4'])
})
t('a hole the run dismissed is reported as dismissed', () => {
  const r = scoreRun({ confirmed_strong: [v({ file: 'src/routes/admin.js' })], confirmed_weak: [], dismissed: [{ title: 'x', reason: 'guarded', file: 'src/routes/notes.js', line: 3 }] }, ANSWERS)
  assert.deepEqual(r.dismissedHoles, ['H4'])
})
t('path match is suffix-based and ignores :line and leading ./', () => {
  const r = scoreRun({ confirmed_strong: [v({ file: 'src/routes/admin.js:12' }), v({ file: '/abs/app/src/routes/notes.js' })], confirmed_weak: [], dismissed: [] }, ANSWERS)
  assert.equal(r.pass, true)
})
t('a different file with a similar name does not match', () => {
  const r = scoreRun({ confirmed_strong: [v({ file: 'src/routes/xadmin.js' }), v({ file: 'src/routes/notes.js' })], confirmed_weak: [], dismissed: [] }, ANSWERS)
  assert.deepEqual(r.missed, ['H1'])
})
t('symbol match is case-insensitive over title/description/reason', () => {
  const r = scoreRun({ confirmed_strong: [v({ reason: 'anon calls PURGEORG' }), v({ file: 'src/routes/notes.js' })], confirmed_weak: [], dismissed: [] }, ANSWERS)
  assert.equal(r.pass, true)
})
t('extra confirmed-strong findings on the vulnerable app are listed as unmatched, not failures', () => {
  const r = scoreRun({ confirmed_strong: [v({ file: 'src/routes/admin.js' }), v({ file: 'src/routes/notes.js' }), v({ file: 'src/db.js', title: 'rate limit' })], confirmed_weak: [], dismissed: [] }, ANSWERS)
  assert.equal(r.pass, true); assert.equal(r.unmatched.length, 1)
})
t('clean twin: any confirmed-strong finding is a false positive → fail', () => {
  const r = scoreRun({ confirmed_strong: [v({ file: 'src/routes/notes.js' })], confirmed_weak: [], dismissed: [] }, ANSWERS, { clean: true })
  assert.equal(r.pass, false); assert.equal(r.falsePositives.length, 1)
})
t('clean twin: confirmed-weak findings are surfaced for adjudication but do not fail', () => {
  const r = scoreRun({ confirmed_strong: [], confirmed_weak: [v({ modalities: ['static'] })], dismissed: [] }, ANSWERS, { clean: true })
  assert.equal(r.pass, true); assert.equal(r.toAdjudicate.length, 1)
})
t('a run with a truncated inventory or degraded prover never passes', () => {
  const ok = { confirmed_strong: [v({ file: 'src/routes/admin.js' }), v({ file: 'src/routes/notes.js' })], confirmed_weak: [], dismissed: [] }
  assert.equal(scoreRun({ ...ok, inventory_summary: { truncated: true } }, ANSWERS).pass, false)
  assert.equal(scoreRun({ ...ok, modalities: { degraded: true } }, ANSWERS).pass, false)
  assert.equal(scoreRun({ ...ok, modalities: { degraded: true } }, ANSWERS, { clean: true }).pass, false)
})
t('wrong preset resolved → fail with a reason', () => {
  const r = scoreRun({ adapter: 'generic', confirmed_strong: [], confirmed_weak: [], dismissed: [] }, ANSWERS, { clean: true })
  assert.equal(r.pass, false); assert.ok(r.reasons.some((x) => /preset/.test(x)))
})

t('two holes in one file: a single finding matching only the file cannot satisfy both', () => {
  const A2 = { preset: 'express', holes: [
    { id: 'H2', family: 'write-guard-gap', file: 'src/routes/notes.js', symbols: ['PATCH /notes/:id', 'org_id'] },
    { id: 'H4', family: 'idor-unscoped-query', file: 'src/routes/notes.js', symbols: ['GET /notes/:id'] },
  ] }
  const r = scoreRun({ confirmed_strong: [v({ file: 'src/routes/notes.js', title: 'GET /notes/:id returns any tenant\'s note' })], confirmed_weak: [], dismissed: [] }, A2)
  assert.deepEqual(r.found, ['H4']); assert.deepEqual(r.missed, ['H2'])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
