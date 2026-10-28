import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/cvEditorSave.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { performCvEditorSave } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('section edits and implicit form submission cannot persist a staged import', async () => {
  let kept = 0, saves = 0
  const library = { contact: 'original', attachment: 'original file' }
  const draft = { contact: 'imported', attachment: 'imported file' }
  const callbacks = { keepSection: () => { kept++ }, persist: async () => { saves++; Object.assign(library, draft) } }
  await performCvEditorSave('section', true, callbacks)
  await performCvEditorSave('form', true, callbacks)
  assert.equal(kept, 1)
  assert.equal(saves, 0)
  assert.deepEqual(library, { contact: 'original', attachment: 'original file' })
  await performCvEditorSave('import', true, callbacks)
  assert.equal(saves, 1)
  assert.deepEqual(library, draft)
})

test('ordinary form saves still persist and the import action cannot save outside review', async () => {
  let saves = 0
  const callbacks = { keepSection: () => assert.fail('unexpected draft-only action'), persist: async () => { saves++ } }
  await performCvEditorSave('form', false, callbacks)
  await performCvEditorSave('import', false, callbacks)
  assert.equal(saves, 1)
})
