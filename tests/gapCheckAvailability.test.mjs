import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function moduleUrl(path, replacements = {}) {
  let source = readFileSync(new URL(path, import.meta.url), 'utf8')
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to)
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const { getGapCheckMode, hasGapContent } = await import(moduleUrl('../src/lib/gapCheckAvailability.ts'))
const report = {
  coveragePercent: 50,
  matchedKeywords: ['React'],
  claimedKeywords: ['Python'],
  missingKeywords: ['SQL'],
  skills: [],
  suggestions: ['Review SQL requirements'],
}

test('keeps fresh checks available only for eligible Saved jobs', () => {
  assert.equal(getGapCheckMode('saved', true, false, report), 'run')
  assert.equal(getGapCheckMode('saved', false, false, report), 'disabled')
  assert.equal(getGapCheckMode('saved', true, true, report), 'disabled')
})

test('offers read-only viewing of a saved report in every later application stage', () => {
  for (const status of ['applied', 'interview', 'offer', 'rejected']) {
    assert.equal(getGapCheckMode(status, false, false, report), 'view')
  }
})

test('hides Gap Check after saving when no report content exists or job is deleted', () => {
  const empty = { coveragePercent: 0, matchedKeywords: [], claimedKeywords: [], missingKeywords: [], skills: [], suggestions: [] }
  assert.equal(hasGapContent(null), false)
  assert.equal(hasGapContent(empty), false)
  assert.equal(getGapCheckMode('applied', false, false, null), 'hidden')
  assert.equal(getGapCheckMode('interview', false, false, empty), 'hidden')
  assert.equal(getGapCheckMode('offer', false, true, report), 'hidden')
})
