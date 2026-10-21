import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/gapCheckRefresh.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { gapCvSelectionKey, GapCvRefreshTracker, refreshGapReportForCvChange } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
)

test('CV identity changes when either the selected template or its matchable content changes', () => {
  const original = gapCvSelectionKey('frontend', 'React and TypeScript')
  assert.equal(gapCvSelectionKey('frontend', 'React and TypeScript'), original)
  assert.notEqual(gapCvSelectionKey('powerPlatform', 'React and TypeScript'), original)
  assert.notEqual(gapCvSelectionKey('frontend', 'React and Python'), original)
})

test('refreshes on a CV change only while the editable Gap Check is open', () => {
  const first = gapCvSelectionKey('frontend', 'React')
  const second = gapCvSelectionKey('powerPlatform', 'Power Automate')
  const tracker = new GapCvRefreshTracker(first)
  let computeCalls = 0
  const compute = claimed => {
    computeCalls++
    return { claimed, coveragePercent: 75 }
  }

  assert.equal(refreshGapReportForCvChange(tracker, first, true, ['React'], compute), null)
  assert.equal(refreshGapReportForCvChange(tracker, second, false, ['React'], compute), null)
  assert.equal(refreshGapReportForCvChange(tracker, second, true, ['React'], compute), null)
  assert.equal(computeCalls, 0)

  const third = gapCvSelectionKey('frontend', 'TypeScript')
  const refresh = refreshGapReportForCvChange(tracker, third, true, ['TypeScript'], compute)
  assert.deepEqual(refresh?.report, { claimed: ['TypeScript'], coveragePercent: 75 })
  assert.equal(computeCalls, 1)
})

test('rapid CV changes and closing the panel invalidate stale refresh results', () => {
  const tracker = new GapCvRefreshTracker('cv-a', true)
  const first = tracker.observe('cv-b', true)
  const second = tracker.observe('cv-c', true)

  assert.ok(first)
  assert.ok(second)
  assert.equal(tracker.isLatest(first), false)
  assert.equal(tracker.isLatest(second), true)

  tracker.observe('cv-c', false)
  assert.equal(tracker.isLatest(second), false)
})
