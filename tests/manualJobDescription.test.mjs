import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function moduleUrl(path) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const { jobDescriptionDraftForEditor } = await import(moduleUrl('../src/lib/jobDescriptionDraft.ts'))

test('manual completion opens empty on every open while complete-job updates retain their text', () => {
  const snippet = 'Short listing snippet from the inbox.'
  assert.equal(jobDescriptionDraftForEditor(snippet, false), '')
  // A new open derives its value from the saved job, not the prior local draft.
  assert.equal(jobDescriptionDraftForEditor(snippet, false), '')
  assert.equal(jobDescriptionDraftForEditor('Existing complete job description.', true), 'Existing complete job description.')

  const page = readFileSync(new URL('../src/pages/JobDetailPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /const openJdEditor = \(\) => \{\s*setJdDraft\(jobDescriptionDraftForEditor\(job\.jobDescription, job\.jdComplete\)\)/)
  assert.equal((page.match(/onClick=\{openJdEditor\}/g) ?? []).length, 2)
})

test('canceling the manual editor does not save, and empty submissions stop before parsing', () => {
  const page = readFileSync(new URL('../src/pages/JobDetailPage.tsx', import.meta.url), 'utf8')
  const cancel = page.match(/onClick=\{\(\) => \{\s*setEditingJd\(false\)\s*setJdError\(null\)\s*}}/)
  assert.ok(cancel)
  assert.doesNotMatch(cancel[0], /updateJob\(|saveJd\(/)

  const saveStart = page.indexOf('const saveJd = async (fullJdRaw: string) => {')
  const parseStart = page.indexOf('const parsed = await parseJobPosting(fullJd)', saveStart)
  const emptyGuard = page.indexOf('if (!fullJd) {', saveStart)
  assert.ok(saveStart >= 0 && emptyGuard > saveStart && parseStart > emptyGuard)
  assert.match(page.slice(emptyGuard, parseStart), /setJdError\('Paste the full job description before saving\.'\)[\s\S]*?return/)
  assert.match(page, /onClick=\{\(\) => void saveJd\(jdDraft\)\}/)
})

test('Inbox-approved snippets remain stored as incomplete until manual save', () => {
  const inbox = readFileSync(new URL('../src/hooks/useInbox.tsx', import.meta.url), 'utf8')
  assert.match(inbox, /jobDescription: item\.description,[\s\S]*?jdComplete: false/)
})
