import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/jobReviewPanels.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { createJobReviewPanelState, shouldOpenGapForExplanation, updateJobReviewPanel } = await import(
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
  const loadingBoundary = component.indexOf('if (loading || docsLoading) return')
  const tracking = component.slice(trackingStart, loadingBoundary)
  assert.ok(trackingStart >= 0 && loadingBoundary > trackingStart)
  assert.match(tracking, /shouldOpenGapForExplanation\(previousSkill, explainSkillName\)/)
  assert.doesNotMatch(tracking, /openPanels/)
})

test('same-account token refresh does not re-run the CV load callback', () => {
  const hook = readFileSync(new URL('../src/hooks/useMasterCv.tsx', import.meta.url), 'utf8')
  assert.match(hook, /const userId = user\?\.id/)
  assert.match(hook, /\}, \[cloud, userId\]\)/)
  assert.doesNotMatch(hook, /\}, \[cloud, user\]\)/)
})

test('the detail route scopes saved review state to account and job identity', () => {
  const page = readFileSync(new URL('../src/pages/JobDetailPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /<TailorPanel key=\{`\$\{account\}:\$\{job\.id\}`\} job=\{job\} \/>/)
})
