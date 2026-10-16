import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const cache = new Map()
function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href)
  let code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  code = code.replace(/from ['"](\.[^'"]+)['"]/g, (_match, path) => `from '${moduleUrl(new URL(`${path}.ts`, url))}'`)
  const result = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  cache.set(url.href, result)
  return result
}
const { inboxSaveStep, safeInboxSaveError, saveCloudInboxResults } = await import(moduleUrl(new URL('../src/lib/inboxPersistence.ts', import.meta.url)))
const { mergeInboxResults, RefreshInvalidated } = await import(moduleUrl(new URL('../src/lib/inboxRefresh.ts', import.meta.url)))
const { inboxJobToRow } = await import(moduleUrl(new URL('../src/lib/database.ts', import.meta.url)))

test('save diagnostics distinguish stages and safely classify known database failures', async () => {
  for (const [code, category] of [['23505', 'conflict'], ['42501', 'access'], ['PGRST301', 'access'], ['23503', 'reference'], ['42703', 'schema'], ['PGRST204', 'schema'], ['arbitrary private code', 'unavailable']]) {
    await assert.rejects(inboxSaveStep('upsert', () => { throw { code, message: 'secret job contents', details: 'credential', hint: 'private' } }), error => {
      assert.equal(error.category, category)
      assert.equal(error.operation, 'upsert')
      assert(!JSON.stringify(error).includes('secret'))
      assert(!error.message.includes('credential'))
      assert(!error.message.includes('private'))
      assert(error.message.includes(`upsert/${category}`))
      return true
    })
  }
  assert(safeInboxSaveError('prune', { code: '42501' }).message.includes('may already be stored'))
  assert.equal(safeInboxSaveError('upsert', { status: 401 }).category, 'access')
  assert.equal(safeInboxSaveError('local', { name: 'QuotaExceededError' }).category, 'storage_full')
  assert.equal(safeInboxSaveError('local', new Error('private')).category, 'storage_unavailable')
})

test('failed storage operation can be repeated with the retained payload after recovery', async () => {
  const storage = new Map()
  const retained = JSON.stringify([{ id: 'fixture', status: 'new' }])
  let unavailable = true
  const save = () => inboxSaveStep('local', () => {
    if (unavailable) throw { name: 'QuotaExceededError' }
    storage.set('inbox', retained)
  })
  await assert.rejects(save())
  assert.equal(storage.size, 0)
  unavailable = false
  await save()
  await save()
  assert.deepEqual(JSON.parse(storage.get('inbox')), [{ id: 'fixture', status: 'new' }])
})

const fixture = (externalId, status = 'new', id = externalId) => ({ id, externalId, source: 'adzuna', company: 'Fixture', role: 'Developer', location: '', jobUrl: '', salary: '', description: '', matchScore: 70, matchReasons: [], matchedTrack: null, status, savedSearchId: null, seenCount: 1, fetchedAt: '2026-10-16T12:00:00Z', createdAt: '2026-10-16T12:00:00Z', updatedAt: '2026-10-16T12:00:00Z' })
function cloud(items = []) {
  const state = { rows: items.map(item => inboxJobToRow(item, 'owner')), fail: null, race: null, beforeUpdate: null, calls: [] }
  const client = { from(table) {
    assert.equal(table, 'job_inbox')
    let operation, payload, options, range, filters = []
    const query = {
      select() { operation = 'read'; return this },
      upsert(value, opts) { operation = 'insert'; payload = value; options = opts; return this },
      update(value) { operation = 'update'; payload = value; return this },
      delete() { operation = 'delete'; return this },
      eq(key, value) { filters.push(row => row[key] === value); return this },
      in(key, values) { filters.push(row => values.includes(row[key])); return this },
      order() { return this },
      range(start, end) { range = [start, end]; return this },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          state.calls.push(operation)
          if (state.fail === operation) return { error: { code: '42501', message: 'private' } }
          if (operation === 'insert') {
            if (state.race) { const run = state.race; state.race = null; run(state) }
            for (const row of payload) {
              const existing = state.rows.find(old => old.user_id === row.user_id && old.external_id === row.external_id)
              if (existing) {
                if (options?.onConflict !== 'user_id,external_id' || !options.ignoreDuplicates) return { error: { code: '23505' } }
              } else state.rows.push({ ...row })
            }
          }
          const matches = row => filters.every(filter => filter(row))
          if (operation === 'update') {
            if (state.beforeUpdate) { const run = state.beforeUpdate; state.beforeUpdate = null; run(state) }
            state.rows = state.rows.map(row => matches(row) ? { ...row, ...payload } : row)
          }
          if (operation === 'delete') state.rows = state.rows.filter(row => !matches(row))
          const data = state.rows.filter(matches).sort((a, b) => a.id.localeCompare(b.id))
          return { data: range ? data.slice(range[0], range[1] + 1) : data, error: null }
        }).then(resolve, reject)
      },
    }
    return query
  } }
  return { state, client }
}

test('cloud reconciliation reuses persisted identities and preserves hidden reviewed history on repeated saves', async () => {
  const { client, state } = cloud([fixture('dismissed', 'dismissed'), fixture('approved', 'approved'), fixture('same', 'new', 'persisted-id')])
  const fetched = [fixture('same', 'new', 'different-id'), fixture('dismissed'), fixture('approved'), fixture('fresh')]
  const merge = items => mergeInboxResults(items, fetched, new Set(), true, false, 0)
  // Reproduce the prior default-ID upsert against the actual listing uniqueness rule.
  const failed = await client.from('job_inbox').upsert([inboxJobToRow(fixture('same', 'new', 'different-id'), 'owner')])
  assert.equal(failed.error.code, '23505')
  const save = () => saveCloudInboxResults(client, 'owner', merge, () => {})
  const first = await save()
  const second = await save()
  assert.equal(first.find(row => row.externalId === 'same').id, 'persisted-id')
  assert.equal(second.find(row => row.externalId === 'dismissed').status, 'dismissed')
  assert.equal(second.find(row => row.externalId === 'approved').status, 'approved')
  assert.equal(state.rows.length, 4)
})

test('insert racing with a reviewed listing cannot revive it', async () => {
  const { client, state } = cloud()
  state.race = state => state.rows.push(inboxJobToRow(fixture('race', 'dismissed', 'other-id'), 'owner'))
  const result = await saveCloudInboxResults(client, 'owner', items => mergeInboxResults(items, [fixture('race')], new Set(), true, false, 0), () => {})
  assert.equal(result.length, 1)
  assert.equal(result[0].status, 'dismissed')
  assert.equal(result[0].id, 'other-id')
})

test('review action between cloud read and update is preserved by the conditional write', async () => {
  const { client, state } = cloud([fixture('review')])
  state.beforeUpdate = state => { state.rows[0].status = 'approved' }
  const fetched = { ...fixture('review'), matchScore: 90 }
  const result = await saveCloudInboxResults(client, 'owner', items => mergeInboxResults(items, [fetched], new Set(), true, false, 0), () => {})
  assert.equal(result[0].status, 'approved')
  assert.equal(result[0].matchScore, 70)
})

test('partial cloud commit retries retain history, deduplicate and recover pruning without provider calls', async () => {
  const { client, state } = cloud([fixture('old'), fixture('history', 'approved')])
  const retained = [fixture('fresh')]
  const merge = items => mergeInboxResults(items, retained, new Set(), true, false, Date.now())
  state.fail = 'delete'
  await assert.rejects(saveCloudInboxResults(client, 'owner', merge, () => {}), error => error.operation === 'prune')
  assert.equal(state.rows.length, 3)
  state.fail = null
  const result = await saveCloudInboxResults(client, 'owner', merge, () => {})
  assert.deepEqual(result.map(row => row.externalId).sort(), ['fresh', 'history'])
  assert.equal(result.find(row => row.externalId === 'history').status, 'approved')
})

test('cloud failures before writing and invalidation during reads leave storage unchanged', async () => {
  const { client, state } = cloud([fixture('history', 'dismissed')])
  const merge = items => mergeInboxResults(items, [fixture('fresh')], new Set(), true, false, 0)
  state.fail = 'read'
  await assert.rejects(saveCloudInboxResults(client, 'owner', merge, () => {}), error => error.category === 'access')
  state.fail = null
  let checks = 0
  await assert.rejects(saveCloudInboxResults(client, 'owner', merge, () => { if (++checks > 1) throw new RefreshInvalidated() }), RefreshInvalidated)
  assert.equal(state.rows.length, 1)
  assert(!state.calls.includes('insert'))
  await saveCloudInboxResults(client, 'owner', merge, () => {})
  assert.equal(state.rows.length, 2)
})

test('cloud read includes history beyond the first server page', async () => {
  const records = Array.from({ length: 501 }, (_, i) => fixture(`listing-${String(i).padStart(4, '0')}`, 'dismissed'))
  const { client, state } = cloud(records)
  const result = await saveCloudInboxResults(client, 'owner', items => mergeInboxResults(items, [fixture('listing-0500')], new Set(), true, false, 0), () => {})
  assert.equal(result.length, 501)
  assert.equal(result.find(row => row.externalId === 'listing-0500').status, 'dismissed')
  assert(!state.calls.includes('insert'))
})
