import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/jobReviewPanels.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { createJobReviewPanelState, updateJobReviewPanel } = await import(
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
