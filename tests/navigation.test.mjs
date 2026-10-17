import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
const code = ts.transpileModule(readFileSync(new URL('../src/lib/navigation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { readSidebarPreference, saveSidebarPreference, SIDEBAR_KEY } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('sidebar defaults expanded, persists collapse/expand, and tolerates blocked preference storage', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  assert.equal(readSidebarPreference(storage), false)
  saveSidebarPreference(storage, true)
  assert.equal(readSidebarPreference(storage), true)
  saveSidebarPreference(storage, false)
  assert.equal(readSidebarPreference(storage), false)
  values.set(SIDEBAR_KEY, 'corrupt')
  assert.equal(readSidebarPreference(storage), false)
  const blocked = { getItem() { throw Error('blocked') }, setItem() { throw Error('full') } }
  assert.equal(readSidebarPreference(blocked), false)
  assert.doesNotThrow(() => saveSidebarPreference(blocked, true))
})
