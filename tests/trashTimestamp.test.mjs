import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/trashTimestamp.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { sameTrashTimestamp } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

test('cloud timestamp formatting still identifies the committed soft-delete', () => {
  assert.equal(sameTrashTimestamp('2026-10-19T12:00:00.123Z', '2026-10-19T12:00:00.123000+00:00'), true)
  assert.equal(sameTrashTimestamp('2026-10-19T12:00:00Z', '2026-10-19T08:00:00.000-04:00'), true)
})

test('another deletion, including sub-millisecond differences, cannot identify this attempt', () => {
  assert.equal(sameTrashTimestamp('2026-10-19T12:00:00.123Z', '2026-10-19T12:00:00.123001+00:00'), false)
  assert.equal(sameTrashTimestamp('2026-10-19T12:00:00.123Z', '2026-10-19T12:00:00.124Z'), false)
  assert.equal(sameTrashTimestamp(null, '2026-10-19T12:00:00Z'), false)
  assert.equal(sameTrashTimestamp('invalid', 'also invalid'), false)
})
