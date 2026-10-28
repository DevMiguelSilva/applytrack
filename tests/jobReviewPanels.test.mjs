import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/jobReviewPanels.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { createJobReviewPanelState, retainJobReviewSnapshot, shouldOpenGapForExplanation, updateJobReviewPanel } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
)

test('job review open and closed sections remain distinct in their scope', () => {
  let state = createJobReviewPanelState('account-a:job-1')
  state = updateJobReviewPanel(state, 'account-a:job-1', 'gap', true)
  state = updateJobReviewPanel(state, 'account-a:job-1', 'tailor', true)
  state = updateJobReviewPanel(state, 'account-a:job-1', 'cover', false)

  assert.deepEqual([...state.open].sort(), ['gap', 'tailor'])
  // A temporary loading render doesn't mutate the wrapper-owned panel state.
  assert.deepEqual([...state.open].sort(), ['gap', 'tailor'])
})

test('switching accounts or jobs never carries open review sections into the new scope', () => {
  let state = createJobReviewPanelState('account-a:job-1')
  state = updateJobReviewPanel(state, 'account-a:job-1', 'gap', true)

  state = updateJobReviewPanel(state, 'account-b:job-1', 'tailor', true)
  assert.deepEqual([...state.open], ['tailor'])

  state = updateJobReviewPanel(state, 'account-b:job-2', 'cover', true)
  assert.deepEqual([...state.open], ['cover'])
})

test('a same-scope load retains review data, while account/job changes clear the snapshot', () => {
  const initial = { report: 'gap report', action: 'packing' }
  const ready = retainJobReviewSnapshot('account-a:job-1', false, initial, null)
  const loading = retainJobReviewSnapshot('account-a:job-1', true, null, ready)
  assert.equal(loading, ready)
  assert.deepEqual(loading?.data, initial)

  const refreshed = retainJobReviewSnapshot('account-a:job-1', false, { report: 'updated report', action: null }, loading)
  assert.deepEqual(refreshed?.data, { report: 'updated report', action: null })
  assert.equal(retainJobReviewSnapshot('account-b:job-1', true, null, refreshed), null)
  assert.equal(retainJobReviewSnapshot('account-a:job-2', true, null, refreshed), null)
  assert.equal(retainJobReviewSnapshot('account-a:job-1', false, null, refreshed), null)
})

test('an explanation opens Gap Check only when a different explanation becomes active', () => {
  const scope = 'account-a:job-1'
  let state = createJobReviewPanelState(scope)
  let previousSkill = null
  const activate = skill => {
    const shouldOpen = shouldOpenGapForExplanation(previousSkill, skill)
    previousSkill = skill
    if (shouldOpen) state = updateJobReviewPanel(state, scope, 'gap', true)
  }

  activate('React')
  assert.deepEqual([...state.open], ['gap'])
  state = updateJobReviewPanel(state, scope, 'gap', false)
  activate('React')
  assert.deepEqual([...state.open], [])

  assert.equal(shouldOpenGapForExplanation('React', 'React'), false)
  assert.equal(shouldOpenGapForExplanation('React', null), false)
  assert.equal(shouldOpenGapForExplanation(null, 'React'), true)
  assert.equal(shouldOpenGapForExplanation('React', 'TypeScript'), true)
})

test('explanation auto-open tracking remains above the loading boundary and ignores panel toggles', () => {
  const component = readFileSync(new URL('../src/components/TailorPanel.tsx', import.meta.url), 'utf8')
  const trackingStart = component.indexOf('const previousExplanation = useRef')
  const loadingBoundary = component.indexOf('if (!snapshot) {')
  const tracking = component.slice(trackingStart, loadingBoundary)
  assert.ok(trackingStart >= 0 && loadingBoundary > trackingStart)
  assert.match(tracking, /shouldOpenGapForExplanation\(previousSkill, explainSkillName\)/)
  assert.doesNotMatch(tracking, /openPanels/)
})

test('same-scope loading keeps TailorPanelContent mounted behind an inert, non-layout overlay', () => {
  const component = readFileSync(new URL('../src/components/TailorPanel.tsx', import.meta.url), 'utf8')
  assert.match(component, /retainJobReviewSnapshot\(panelScope, dataLoading, currentSnapshot, lastReady\.current\)/)
  assert.match(component, /<TailorPanelContent key=\{`\$\{panelScope\}:\$\{job\.id\}`\}/)
  assert.match(component, /className="absolute inset-0 z-20[^"]*"/)
  assert.match(component, /element\.setAttribute\('inert', ''\)/)
  assert.match(component, /if \(!snapshot\) \{\s*if \(dataLoading\) return/)
})

test('same-account token refresh does not re-run the CV load callback', () => {
  const hook = readFileSync(new URL('../src/hooks/useMasterCv.tsx', import.meta.url), 'utf8')
  assert.match(hook, /const userId = user\?\.id/)
  assert.match(hook, /const owner = cloud && userId \? `cloud:\$\{userId\}` : 'local'/)
  assert.match(hook, /loadedOwner\.current === owner/)
  assert.match(hook, /visibleLibrary = ownerReady \? library : emptyLibrary/)
  assert.match(hook, /\}, \[cloud, owner, userId\]\)/)
  assert.doesNotMatch(hook, /\}, \[cloud, user\]\)/)
})

test('the detail route scopes saved review state to account and job identity', () => {
  const page = readFileSync(new URL('../src/pages/JobDetailPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /<TailorPanel key=\{`\$\{account\}:\$\{job\.id\}`\} job=\{job\} \/>/)
})
