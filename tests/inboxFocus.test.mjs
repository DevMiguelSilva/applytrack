import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const mocks = {
  './useAuth': 'export const useAuth = () => globalThis.__inboxFocus.auth',
  './useMasterCv': 'export const useMasterCv = () => ({ library: {} })',
  '../lib/localMutation': 'export const withLocalMutation = fn => Promise.resolve().then(fn)',
  '../lib/cvSources': 'export const searchHasLiveSource = () => true; export const validateSearchSource = () => {}',
  '../types/cv': 'export const normalizeLibrary = () => ({})',
  '../lib/cvLibrary': "export const CV_LIBRARY_EVENT = 'cv-library'; export const recoverCvTransaction = () => {}",
  '../lib/database': 'export const rowToSavedSearch = x => x; export const savedSearchToRow = x => x',
  '../lib/supabase': 'export const supabase = globalThis.__inboxFocus.supabase',
  '../lib/adzunaQuery': 'export const coalesceSearchQuery = x => x.query',
  '../types/job': 'export const DEFAULT_SAVED_SEARCHES = []; export const createEmptySavedSearch = x => x',
}
function transpile(path, replacements) {
  let source = readFileSync(new URL(path, import.meta.url), 'utf8')
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(`'${from}'`, `'${to}'`)
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  return moduleUrl(code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)))
}
const errorUrl = transpile('../shared/adzunaErrors.ts', {})
const locationUrl = transpile('../src/lib/searchLocations.ts', {})
const { InboxRefresh, searchRequests } = await import(transpile('../src/lib/inboxRefresh.ts', {
  '../../shared/adzunaErrors': errorUrl, './searchLocations': locationUrl,
}))

test('the summary explains an unknown save and offers retry after a known failure', async () => {
  const { InboxRefreshSummary } = await import(transpile('../src/components/InboxRefreshSummary.tsx', {}))
  const report = { outcomes: [], persistence: 'pending' }
  const props = { report, busy: false, retryFailed: async () => {}, retrySave: async () => {} }
  const view = TestRenderer.create(React.createElement(InboxRefreshSummary, props))
  assert.match(JSON.stringify(view.toJSON()), /Save status unknown/)
  assert.match(JSON.stringify(view.toJSON()), /may still finish/)
  assert.equal(view.root.findAllByType('button').length, 0)
  view.update(React.createElement(InboxRefreshSummary, { ...props, report: { ...report, persistence: 'failed' } }))
  assert.equal(view.root.findAllByType('button')[0].children.join(''), 'Retry saving results')
  view.unmount()
})

test('a delayed refresh survives a same-account auth update and rejects changed account or searches', async () => {
  const search = { id: 'one', query: 'developer', location: 'Toronto', country: 'ca', maxDaysOld: 7, excludeTerms: '', track: 'auto', label: 'Fixture', active: true, sortOrder: 0, createdAt: '2020-01-01', updatedAt: '2020-01-01' }
  const stored = new Map([['applytrack-searches-seeded-v2:account-a', '1'], ['applytrack-searches-seeded-v2:account-b', '1']])
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
  globalThis.window = new EventTarget()
  let reads = 0
  let rows = [search]
  const fixture = globalThis.__inboxFocus = {
    auth: { user: { id: 'account-a', token: 'old' }, isCloudEnabled: true },
    supabase: { from: () => ({ select: () => ({ eq: (_key, owner) => ({ order: async () => { reads++; return { data: owner === 'account-a' ? rows : [], error: null } } }) }) }) },
  }
  const imports = Object.fromEntries(Object.entries(mocks).map(([key, value]) => [key, moduleUrl(value)]))
  imports.react = pathToFileURL(require.resolve('react')).href
  const { SavedSearchesProvider, useSavedSearches } = await import(transpile('../src/hooks/useSavedSearches.tsx', imports))
  let visible
  function Consumer() { visible = useSavedSearches(); return null }
  let tree
  await act(async () => { tree = TestRenderer.create(React.createElement(SavedSearchesProvider, null, React.createElement(Consumer))) })
  assert.equal(visible.searches.length, 1)
  assert.equal(reads, 1)

  const manager = new InboxRefresh()
  let complete
  let calls = 0
  const requests = searchRequests(visible.searches)
  const valid = () => fixture.auth.user.id === 'account-a' && visible.searches.some(item => item.id === 'one' && item.query === 'developer')
  const running = manager.run(requests, () => { calls++; return new Promise(resolve => { complete = resolve }) }, valid)
  await act(async () => {
    fixture.auth = { ...fixture.auth, user: { id: 'account-a', token: 'new' } }
    window.dispatchEvent(new Event('focus'))
    tree.update(React.createElement(SavedSearchesProvider, null, React.createElement(Consumer)))
  })
  assert.equal(reads, 1)
  assert.equal(visible.searches.length, 1)
  complete({ results: [], requestId: 'fixture' })
  assert.equal((await running)[0].state, 'success')
  assert.equal(calls, 1)

  let finishEdited
  const edited = manager.run(requests, () => new Promise(resolve => { finishEdited = resolve }), valid)
  await act(async () => {
    rows = [{ ...search, query: 'different' }]
    window.dispatchEvent(new Event('cv-library'))
  })
  assert.equal(visible.searches[0].query, 'different')
  finishEdited({ results: [], requestId: 'fixture' })
  await assert.rejects(edited, /Searches changed/)

  rows = [search]
  await act(async () => { window.dispatchEvent(new Event('cv-library')) })
  let finishChanged
  const changed = manager.run(requests, () => new Promise(resolve => { finishChanged = resolve }), valid)
  await act(async () => {
    fixture.auth = { ...fixture.auth, user: { id: 'account-b' } }
    tree.update(React.createElement(SavedSearchesProvider, null, React.createElement(Consumer)))
  })
  assert.deepEqual(visible.searches, [])
  finishChanged({ results: [], requestId: 'fixture' })
  await assert.rejects(changed, /Searches changed/)
  await act(async () => tree.unmount())
  delete globalThis.__inboxFocus
})

test('local searches remain available during a delayed request and deletion invalidates it', async () => {
  const search = { id: 'local-one', query: 'developer', location: 'Toronto', country: 'ca', maxDaysOld: 7, excludeTerms: '', track: 'auto', active: true, sortOrder: 0, createdAt: '2020-01-01', updatedAt: '2020-01-01' }
  const stored = new Map([['applytrack-searches-seeded-v2', '1'], ['applytrack-saved-searches', JSON.stringify([search])]])
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
  globalThis.window = new EventTarget()
  globalThis.__inboxFocus = { auth: { user: null, isCloudEnabled: false }, supabase: null }
  const imports = Object.fromEntries(Object.entries(mocks).map(([key, value]) => [key, moduleUrl(value)]))
  imports.react = pathToFileURL(require.resolve('react')).href
  const { SavedSearchesProvider, useSavedSearches } = await import(transpile('../src/hooks/useSavedSearches.tsx', imports))
  let visible
  function Consumer() { visible = useSavedSearches(); return null }
  let tree
  await act(async () => { tree = TestRenderer.create(React.createElement(SavedSearchesProvider, null, React.createElement(Consumer))) })
  const manager = new InboxRefresh()
  const requests = searchRequests(visible.searches)
  let finish
  const running = manager.run(requests, () => new Promise(resolve => { finish = resolve }), () => visible.searches.some(item => item.id === search.id))
  window.dispatchEvent(new Event('focus'))
  assert.equal(visible.searches.length, 1)
  stored.set('applytrack-saved-searches', '[]')
  const storageEvent = new Event('storage')
  Object.defineProperty(storageEvent, 'key', { value: 'applytrack-saved-searches' })
  await act(async () => { window.dispatchEvent(storageEvent) })
  assert.equal(visible.searches.length, 0)
  finish({ results: [], requestId: 'fixture' })
  await assert.rejects(running, /Searches changed/)
  await act(async () => tree.unmount())
  delete globalThis.__inboxFocus
})

test('an old account request cannot end a newer refresh after switching away and back', async () => {
  const search = { id: 'one', query: 'developer', location: 'Toronto', country: 'ca', maxDaysOld: 7, excludeTerms: '', track: 'auto', active: true }
  const deferred = []
  const saves = []
  globalThis.window = new EventTarget()
  globalThis.__inboxFocus = {
    auth: { user: { id: 'account-a' }, isCloudEnabled: true }, searches: [search],
    fetch: () => new Promise(resolve => deferred.push(resolve)),
    savePhase: 'write',
    save: (_client, _user, _transform, check, phase) => {
      phase(globalThis.__inboxFocus.savePhase)
      return new Promise((resolve, reject) => saves.push({ resolve, reject })).then(result => { check(); return result })
    },
    supabase: { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }) },
  }
  const inboxMocks = {
    ...mocks,
    './useSavedSearches': 'export const useSavedSearches = () => ({ searches: globalThis.__inboxFocus.searches })',
    './useMasterCv': 'export const useMasterCv = () => ({ library: { cvs: { frontend: {} }, names: { frontend: "Frontend" } } })',
    './useJobs': 'export const useJobs = () => ({ jobs: [], addJob: async () => {} })',
    '../lib/supabase': 'export const supabase = globalThis.__inboxFocus.supabase; // inbox fixture',
    '../api/client': 'export const fetchAdzunaSearch = (...args) => globalThis.__inboxFocus.fetch(...args)',
    '../api/gemini': 'export const parseJobPosting = async () => ({})',
    '../lib/inboxRefresh': `export { InboxRefresh, RefreshInvalidated, searchFingerprint, searchRequests, mergeInboxResults } from '${transpile('../src/lib/inboxRefresh.ts', { '../../shared/adzunaErrors': errorUrl, './searchLocations': locationUrl })}'`,
    '../lib/inboxPersistence': 'export class InboxSaveError extends Error {}; export const inboxSaveStep = async (_stage, fn) => fn(); export const safeInboxSaveError = () => new InboxSaveError("Save failed"); export const saveCloudInboxResults = (...args) => globalThis.__inboxFocus.save(...args)',
    '../lib/inboxSaveWait': `import { observeInboxSave as observe } from '${transpile('../src/lib/inboxSaveWait.ts', {})}'; export const observeInboxSave = operation => observe(operation, 10)`,
    '../lib/database': 'export const inboxJobToRow = x => x; export const rowToInboxJob = x => x',
    '../lib/matchScore': 'export const createCvMatcher = () => () => ({ bestTrack: "frontend", bestScore: 80, scores: { frontend: { score: 80, reasons: [] } } }); export const dualTrackReasonLine = () => ""; export const scoreDualTracks = () => ({}); export const scoreMasterCvAgainstJob = () => ({}); export const withRequirementSignals = () => []',
    '../types/job': 'export const createEmptyJob = x => x',
  }
  const imports = Object.fromEntries(Object.entries(inboxMocks).map(([key, value]) => [key, moduleUrl(value)]))
  imports.react = pathToFileURL(require.resolve('react')).href
  const { InboxProvider, useInbox } = await import(transpile('../src/hooks/useInbox.tsx', imports))
  let inbox
  function Consumer() { inbox = useInbox(); return null }
  let tree
  const view = () => React.createElement(InboxProvider, null, React.createElement(Consumer))
  await act(async () => { tree = TestRenderer.create(view()) })
  let old
  await act(async () => { old = inbox.refreshInbox() })
  assert.equal(inbox.refreshing, true)
  await act(async () => { globalThis.__inboxFocus.auth = { user: { id: 'account-b' }, isCloudEnabled: true }; tree.update(view()) })
  await act(async () => { globalThis.__inboxFocus.auth = { user: { id: 'account-a' }, isCloudEnabled: true }; tree.update(view()) })
  let current
  await act(async () => { current = inbox.refreshInbox() })
  assert.equal(deferred.length, 2)
  await act(async () => { deferred[0]({ results: [], requestId: 'old' }); await old })
  assert.equal(inbox.refreshing, true)
  assert.equal(inbox.refreshError, null)
  await act(async () => { deferred[1]({ results: [], requestId: 'current' }); await current })
  assert.equal(inbox.refreshing, false)
  assert.equal(inbox.refreshReport.persistence, 'unchanged')

  let saving
  await act(async () => { saving = inbox.refreshInbox({ onlySearchId: 'one', clearReviewFirst: true }) })
  const job = { externalId: 'fixture', company: 'Fixture', role: 'Developer', location: 'Toronto', jobUrl: '', salary: '', description: 'Developer', created: '' }
  await act(async () => { deferred[2]({ results: [job], requestId: 'fixture' }) })
  assert.equal(inbox.refreshing, true)
  assert.equal(saves.length, 1)
  await act(async () => { saves[0].reject(new Error('offline')); await saving })
  assert.equal(inbox.refreshReport.persistence, 'failed')
  let retry
  await act(async () => { retry = inbox.retryInboxSave() })
  assert.equal(saves.length, 2)
  assert.equal(deferred.length, 3)
  await act(async () => { saves[1].resolve([]); await retry })
  assert.equal(inbox.refreshReport.persistence, 'saved')
  assert.equal(inbox.refreshing, false)

  let stalled
  await act(async () => { stalled = inbox.refreshInbox() })
  await act(async () => { deferred[3]({ results: [job], requestId: 'fixture' }) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); await stalled })
  assert.equal(inbox.refreshing, false)
  assert.equal(inbox.refreshReport.persistence, 'pending')
  await act(async () => { await inbox.retryInboxSave(); await inbox.refreshInbox() })
  assert.equal(saves.length, 3)
  assert.equal(deferred.length, 4)
  await assert.rejects(inbox.clearReviewList(), /still awaiting a response/)
  await act(async () => { saves[2].resolve([]); await Promise.resolve() })
  assert.equal(inbox.refreshReport.persistence, 'saved')

  let stalledFailure
  await act(async () => { stalledFailure = inbox.refreshInbox() })
  await act(async () => { deferred[4]({ results: [job], requestId: 'fixture' }) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); await stalledFailure })
  assert.equal(inbox.refreshReport.persistence, 'pending')
  await act(async () => { saves[3].reject(new Error('late failure')); await Promise.resolve() })
  assert.equal(inbox.refreshReport.persistence, 'failed')
  let lateRetry
  await act(async () => { lateRetry = inbox.retryInboxSave() })
  assert.equal(deferred.length, 5)
  await act(async () => { saves[4].resolve([]); await lateRetry })
  assert.equal(inbox.refreshReport.persistence, 'saved')

  let beforeSwitch
  await act(async () => { beforeSwitch = inbox.refreshInbox() })
  await act(async () => { deferred[5]({ results: [job], requestId: 'fixture' }) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); await beforeSwitch })
  await act(async () => { globalThis.__inboxFocus.auth = { user: { id: 'account-b' }, isCloudEnabled: true }; tree.update(view()) })
  assert.equal(inbox.refreshReport, null)
  await act(async () => { await inbox.refreshInbox() })
  assert.equal(deferred.length, 6)
  await act(async () => { saves[5].resolve([]); await Promise.resolve() })
  assert.equal(inbox.refreshReport, null)
  let afterSwitch
  await act(async () => { afterSwitch = inbox.refreshInbox() })
  assert.equal(deferred.length, 7)
  await act(async () => { deferred[6]({ results: [], requestId: 'account-b' }); await afterSwitch })
  assert.equal(inbox.refreshReport.persistence, 'unchanged')

  globalThis.__inboxFocus.savePhase = 'read'
  let stalledRead
  await act(async () => { stalledRead = inbox.refreshInbox() })
  await act(async () => { deferred[7]({ results: [job], requestId: 'fixture' }) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); await stalledRead })
  assert.equal(inbox.refreshReport.persistence, 'failed')
  assert.match(inbox.refreshReport.saveError, /Reading saved Inbox results timed out/)
  globalThis.__inboxFocus.savePhase = 'write'
  let readRetry
  await act(async () => { readRetry = inbox.retryInboxSave() })
  assert.equal(saves.length, 8)
  assert.equal(deferred.length, 8)
  await act(async () => { saves[6].resolve([]); await Promise.resolve() })
  assert.equal(inbox.refreshing, true)
  await assert.rejects(inbox.clearReviewList(), /still awaiting a response/)
  await act(async () => { saves[7].resolve([]); await readRetry })
  assert.equal(inbox.refreshReport.persistence, 'saved')
  await act(async () => tree.unmount())
  delete globalThis.__inboxFocus
})
