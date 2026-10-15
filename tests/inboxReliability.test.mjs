import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function moduleUrl(path, replacements = {}) {
  let source = readFileSync(new URL(path, import.meta.url), 'utf8')
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to)
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const errorsUrl = moduleUrl('../shared/adzunaErrors.ts')
const { AdzunaError, retryAfterSeconds } = await import(errorsUrl)
const envUrl = moduleUrl('../api/_lib/env.ts')
const { searchAdzuna } = await import(moduleUrl('../api/_lib/adzuna.ts', { '../../shared/adzunaErrors.js': errorsUrl, './env.js': envUrl }))
const clientUrl = moduleUrl('../src/api/client.ts', { '../../shared/adzunaErrors': errorsUrl })
const { fetchAdzunaSearch } = await import(clientUrl)
const locationsUrl = moduleUrl('../src/lib/searchLocations.ts')
const { InboxRefresh, searchRequests, mergeInboxResults, searchFingerprint } = await import(moduleUrl('../src/lib/inboxRefresh.ts', { '../../shared/adzunaErrors': errorsUrl, './searchLocations': locationsUrl }))
const env = { ADZUNA_APP_ID: 'fixture-id', ADZUNA_APP_KEY: 'fixture-key' }
const filters = { query: 'Power Apps', country: 'ca' }
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const search = (id, location = 'Toronto / Remote') => ({ id, query: 'Power Apps', location, country: 'ca', maxDaysOld: 7, excludeTerms: '', track: 'auto', label: id, active: true })
const apiJob = { externalId: 'new', company: 'Fixture', role: 'Developer', location: 'Toronto', jobUrl: '', salary: '', description: 'Power Apps', created: '' }
const item = (externalId, status = 'new', extra = {}) => ({ ...apiJob, externalId, id: externalId, status, matchScore: 70, seenCount: 1, fetchedAt: '2020-01-01', createdAt: '2020-01-01', updatedAt: '2020-01-01', ...extra })

test('server never forwards HTML, credential errors or malformed responses; empty JSON is success', async () => {
  const logs = []; let calls = 0
  const deps = { fetch: async () => { calls++; return new Response('<html>fixture-key provider stack</html>', { status: 500, headers: { 'content-type': 'text/html' } }) }, log: record => logs.push(record) }
  await assert.rejects(searchAdzuna(filters, env, 'reference', deps), error => error.code === 'upstream' && !error.message.includes('fixture-key'))
  assert.equal(calls, 1); assert.equal(logs[0].contentType, 'text/html'); assert.equal(logs.at(-1).attempts, 1)
  assert(!JSON.stringify(logs).includes('fixture-key')); assert(!JSON.stringify(logs).includes('http'))
  for (const response of [new Response('<html>bad</html>', { headers: { 'content-type': 'text/html' } }), json({}), json({ results: [{}] }), new Response('invalid', { headers: { 'content-type': 'application/json' } }), json(null)]) {
    await assert.rejects(searchAdzuna(filters, env, 'r', { fetch: async () => response, log: () => {} }), error => error.code === 'malformed_response')
  }
  assert.deepEqual(await searchAdzuna(filters, env, 'r', { fetch: async (_url, options) => { assert.equal(options.headers.Accept, 'application/json'); return json({ results: [] }) }, log: () => {} }), [])
  await assert.rejects(searchAdzuna(filters, {}, 'r', { log: () => {} }), error => error.code === 'configuration' && !error.message.includes('ADZUNA_APP'))
  await assert.rejects(searchAdzuna({ query: 42 }, env, 'r', { log: () => {} }), error => error.code === 'invalid_filters' && error.status === 400)
})

test('server retries only transient failures once, respects Retry-After and the total budget', async () => {
  let calls = 0, sleeps = []
  const deps = { fetch: async () => { calls++; return calls === 1 ? json({}, 503, { 'Retry-After': '1' }) : json({ results: [] }) }, sleep: async ms => sleeps.push(ms), log: () => {} }
  await searchAdzuna(filters, env, 'r', deps); assert.equal(calls, 2); assert.deepEqual(sleeps, [1000])
  for (const status of [400,401,403,429,500]) {
    calls = 0
    await assert.rejects(searchAdzuna(filters, env, 'r', { ...deps, fetch: async () => { calls++; return json({}, status) } }))
    assert.equal(calls, 1)
  }
  calls = 0
  await assert.rejects(searchAdzuna(filters, env, 'r', { ...deps, fetch: async () => { calls++; return json({}, 503, { 'Retry-After': '30' }) } }))
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(searchAdzuna(filters, env, 'r', { ...deps, fetch: async () => { calls++; throw new Error('fixture network') } }))
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(searchAdzuna(filters, env, 'r', { ...deps, attemptMs: 5, budgetMs: 1000, fetch: async () => { calls++; return new Promise(() => {}) } }), error => error.code === 'timeout')
  assert.equal(calls, 2)
  assert.equal(retryAfterSeconds('nonsense'), undefined)
  assert.equal(retryAfterSeconds('120'), 120)
  assert.equal(retryAfterSeconds('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60)
})

test('browser safely classifies intermediary HTML, malformed success, offline and bounded timeouts', async () => {
  for (const response of [new Response('<html>stack secret</html>', { status: 502 }), new Response('bad', { headers: { 'content-type': 'application/json' } }), json({})]) {
    await assert.rejects(fetchAdzunaSearch(filters, async () => response), error => !error.message.includes('stack') && ['upstream','malformed_response'].includes(error.code))
  }
  assert.deepEqual((await fetchAdzunaSearch(filters, async () => json({ results: [], requestId: 'safe-reference' }))).results, [])
  await assert.rejects(fetchAdzunaSearch(filters, async () => { throw new Error('offline') }), error => error.code === 'network')
  await assert.rejects(fetchAdzunaSearch(filters, async () => new Promise(() => {}), 5), error => error.code === 'timeout')
  await assert.rejects(fetchAdzunaSearch(filters, async () => json({ error: { code: 'rate_limit', message: '<script>bad</script>', requestId: 'reference', retryAfterSeconds: 3600 } }, 429)), error => error.code === 'rate_limit' && error.requestId === 'reference' && !error.message.includes('<script>'))
})

test('refresh preserves partial locations, deduplicates filters, guards overlap and retries failures only', async () => {
  const manager = new InboxRefresh(); const requests = searchRequests([search('a'), search('b')]); let calls = []
  const fetch = async params => { calls.push(params); if (params.requireRemote) throw new AdzunaError('upstream',502,'r'); return { results: [apiJob], requestId: 'ok' } }
  const first = await manager.run(requests, fetch, () => true)
  assert.equal(calls.length, 2); assert.equal(first.filter(outcome => outcome.state === 'success').length, 2)
  calls = []
  await manager.run(requests, async params => { calls.push(params); return { results: [], requestId: 'retry' } }, () => true, true)
  assert.equal(calls.length, 1); assert.equal(calls[0].requireRemote, true)
  let resolve; const waiting = manager.run(requests, () => new Promise(r => { resolve = r }), () => true)
  assert.equal(await manager.run(requests, fetch, () => true), undefined)
  manager.invalidate(); resolve({ results: [], requestId: '' }); await assert.rejects(waiting)
})

test('quota/auth stops remaining requests; valid cooldown prevents calls until elapsed', async () => {
  let now = 0; const manager = new InboxRefresh(() => now); let calls = 0
  const requests = searchRequests([search('a')])
  const fetch = async () => { calls++; throw new AdzunaError('rate_limit',429,'quota',60) }
  const outcomes = await manager.run(requests, fetch, () => true)
  assert.deepEqual(outcomes.map(outcome => outcome.state), ['failed','not_run']); assert.equal(calls, 1)
  await manager.run(requests, fetch, () => true, true); assert.equal(calls, 1)
  now = 61000; await manager.run(requests, fetch, () => true, true); assert.equal(calls, 2)
  const auth = new InboxRefresh(); calls = 0
  await auth.run(requests, async () => { calls++; throw new AdzunaError('provider_auth',502) }, () => true)
  assert.equal(calls, 1)
})

test('current-state merge preserves actions/history, partial and empty results; Run alone prunes only on full success', () => {
  const current = [item('old'), item('dismissed','dismissed'), item('approved','approved')]
  const fetched = [item('new'), item('dismissed'), item('approved'), item('board')]
  const partial = mergeInboxResults(current, fetched, new Set(['board']), false, true, Date.now())
  assert(partial.some(job => job.externalId === 'old')); assert.equal(partial.find(job => job.externalId === 'dismissed').status, 'dismissed'); assert.equal(partial.find(job => job.externalId === 'approved').status, 'approved'); assert(!partial.some(job => job.externalId === 'board'))
  assert.deepEqual(mergeInboxResults(current, [], new Set(), true, true, Date.now()), current)
  assert(!mergeInboxResults(current, fetched, new Set(), true, true, Date.now()).some(job => job.externalId === 'old'))
  assert.notEqual(searchFingerprint(search('a')), searchFingerprint({ ...search('a'), query: 'New filters' }))
})

test('browser proxy quota headers are honored without exposing raw error text', async () => {
  await assert.rejects(fetchAdzunaSearch(filters, async () => new Response('<html>unsafe</html>', { status: 429, headers: { 'Retry-After': '90', 'x-vercel-id': 'iad1::safe-reference' } })), error => error.code === 'rate_limit' && error.retryAfterSeconds === 90 && error.requestId === 'iad1::safe-reference' && !error.message.includes('unsafe'))
})

test('missing or null optional provider fields remain valid listings', async () => {
  const results = await searchAdzuna(filters, env, 'r', { fetch: async () => json({ results: [{ id: 1, salary_min: null, salary_max: null, description: null, title: null, company: { display_name: null }, location: null }] }), log: () => {} })
  assert.equal(results[0].externalId, '1'); assert.equal(results[0].salary, ''); assert.equal(results[0].company, 'Unknown company')
})
