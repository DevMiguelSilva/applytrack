import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/cvItemOrder.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { moveCvItem } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('moves persisted and new entries without changing their contents or original order', () => {
  const entries = [{ id: 'existing', text: 'first' }, { id: 'new', text: 'draft' }, { id: 'last', text: 'last' }]
  const moved = moveCvItem(entries, 'new', -1)
  assert.deepEqual(moved.map(item => item.id), ['new', 'existing', 'last'])
  assert.deepEqual(entries.map(item => item.id), ['existing', 'new', 'last'])
  assert.equal(moved[0].text, 'draft')
  assert.deepEqual(moveCvItem(moved, 'new', 1).map(item => item.id), ['existing', 'new', 'last'])
  assert.equal(moveCvItem(entries, 'missing', 1), entries)
  assert.equal(moveCvItem(entries, 'existing', -1), entries)
  assert.equal(moveCvItem(entries, 'last', 1), entries)
})
