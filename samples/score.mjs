#!/usr/bin/env node
// livefire sample scorer — compares a livefire run result against a sample app's answer key.
//
//   node samples/score.mjs <result.json> <ANSWERS.json> [--clean]
//
// Vulnerable app: PASS iff every seeded hole is matched by a CONFIRMED-strong finding, the run
// resolved the sample's preset, the prover was not degraded and the inventory was not truncated.
// Clean twin: PASS iff there is no CONFIRMED-strong finding at all (each one is a false positive)
// under the same run-health conditions; CONFIRMED-weak findings are listed for adjudication.
// See samples/SPEC.md.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const normPath = (p) => String(p || '').trim().replace(/:\d+(:\d+)?$/, '').replace(/\\/g, '/').replace(/^\.\//, '')
function fileMatches(findingFile, holeFile) {
  const f = normPath(findingFile), h = normPath(holeFile)
  if (!f || !h) return false
  return f === h || f.endsWith('/' + h)
}
function textOf(f) { return [f.title, f.description, f.reason, f.fix].filter(Boolean).join(' ').toLowerCase() }
// A finding matches a hole by a symbol it names, or by file — but a file shared by several holes
// only identifies a hole together with one of that hole's symbols (else one finding would
// "find" every hole in the file).
export function matchesHole(finding, hole, holes = [hole]) {
  const txt = textOf(finding)
  const symbolHit = (hole.symbols || []).some((s) => s && txt.includes(String(s).toLowerCase()))
  if (symbolHit) return true
  if (!fileMatches(finding.file, hole.file)) return false
  const sharing = holes.filter((h) => normPath(h.file) === normPath(hole.file))
  return sharing.length <= 1
}

export function scoreRun(result, answers, { clean = false } = {}) {
  const strong = result.confirmed_strong || []
  const weak = result.confirmed_weak || []
  const dismissed = result.dismissed || []
  const holes = answers.holes || []
  const reasons = []

  if (result.adapter && answers.preset && result.adapter !== answers.preset) reasons.push(`resolved preset "${result.adapter}", expected "${answers.preset}"`)
  if (result.modalities && result.modalities.degraded) reasons.push('prover degraded (empirical modality did not run live)')
  if (result.inventory_summary && result.inventory_summary.truncated) reasons.push('inventory truncated')

  if (clean) {
    const falsePositives = strong.map((f) => ({ title: f.title, file: f.file, hole: (holes.find((h) => matchesHole(f, h, holes)) || {}).id || null }))
    if (falsePositives.length) reasons.push(`${falsePositives.length} confirmed-strong finding(s) on the clean twin`)
    return { pass: reasons.length === 0, reasons, falsePositives, toAdjudicate: weak.map((f) => ({ title: f.title, file: f.file })) }
  }

  const found = [], missed = [], weakOnly = [], dismissedHoles = []
  for (const h of holes) {
    if (strong.some((f) => matchesHole(f, h, holes))) { found.push(h.id); continue }
    missed.push(h.id)
    if (weak.some((f) => matchesHole(f, h, holes))) weakOnly.push(h.id)
    if (dismissed.some((f) => matchesHole(f, h, holes))) dismissedHoles.push(h.id)
  }
  if (missed.length) reasons.push(`missed ${missed.join(', ')}`)
  const unmatched = strong.filter((f) => !holes.some((h) => matchesHole(f, h, holes))).map((f) => ({ title: f.title, file: f.file }))
  return { pass: reasons.length === 0, reasons, found, missed, weakOnly, dismissedHoles, unmatched }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [resultPath, answersPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (!resultPath || !answersPath) { console.error('usage: node samples/score.mjs <result.json> <ANSWERS.json> [--clean]'); process.exit(2) }
  const raw = JSON.parse(await readFile(resultPath, 'utf8'))
  const result = raw.result || raw // accept a whole workflow run record or just its result
  const answers = JSON.parse(await readFile(answersPath, 'utf8'))
  const r = scoreRun(result, answers, { clean: process.argv.includes('--clean') })
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.pass ? 0 : 1)
}
