import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function moduleUrl(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const { prependCvExperience, updateCvExperienceById } = await import(moduleUrl('../src/lib/cvExperience.ts'))

const role = (id, title = id) => ({
  id, title, company: '', location: '', start: '', end: '', current: false,
  bullets: [{ id: `bullet-${id}`, text: '', tags: [] }],
})

test('new experience is first, including when it is the first role', () => {
  const first = role('first')
  assert.deepEqual(prependCvExperience([], first).map((entry) => entry.id), ['first'])

  const existing = [role('older-a'), role('older-b')]
  const next = prependCvExperience(existing, role('new'))
  assert.deepEqual(next.map((entry) => entry.id), ['new', 'older-a', 'older-b'])
  assert.deepEqual(existing.map((entry) => entry.id), ['older-a', 'older-b'])
  assert.deepEqual(next.map((entry, index) => `Role ${String(index + 1).padStart(2, '0')}: ${entry.id}`), [
    'Role 01: new', 'Role 02: older-a', 'Role 03: older-b',
  ])
})

test('editing after prepending targets the stable role ID and leaves other roles intact', () => {
  const initial = [role('older-a', 'Engineer'), role('older-b', 'Designer')]
  const next = prependCvExperience(initial, role('new', 'New role'))
  const edited = updateCvExperienceById(next, 'older-a', (item) => ({ ...item, title: 'Senior Engineer' }))

  assert.deepEqual(edited.map((entry) => [entry.id, entry.title]), [
    ['new', 'New role'], ['older-a', 'Senior Engineer'], ['older-b', 'Designer'],
  ])
  assert.deepEqual(initial.map((entry) => [entry.id, entry.title]), [
    ['older-a', 'Engineer'], ['older-b', 'Designer'],
  ])
})
