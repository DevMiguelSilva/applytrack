import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

async function source(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { BackgroundTasks } = await source('../src/lib/backgroundTasks.ts')
const { CopyFeedback } = await source('../src/lib/copyFeedback.ts')
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j }); return { promise, resolve, reject } }

test('different jobs run independently, duplicate starts do not generate, completion waits for persistence', async () => {
  const manager = new BackgroundTasks(() => {})
  const ai = deferred(), disk = deferred()
  let requests = 0
  const first = manager.start('a', 'A', 'inputs', () => { requests++; return ai.promise }, () => true, () => disk.promise)
  await manager.start('a', 'A', 'inputs', async () => { requests++; }, () => true, async () => {})
  await manager.start('b', 'B', 'inputs', async () => 'B files', () => true, async () => {})
  assert.equal(requests, 1); assert.equal(manager.tasks.b.phase, 'completed')
  ai.resolve('A files'); await Promise.resolve(); assert.equal(manager.tasks.a.phase, 'saving')
  disk.resolve(); await first; assert.equal(manager.tasks.a.phase, 'completed')
})

test('save failure retains generated files; duplicate save retries and reruns are guarded', async () => {
  const manager = new BackgroundTasks(() => {})
  let requests = 0, persisted
  await manager.start('a', 'A', 'v1', async () => { requests++; return 'files' }, () => true, async () => { throw new Error('Offline') })
  assert.equal(manager.tasks.a.output, 'files'); assert.equal(manager.tasks.a.error, 'Offline')
  const disk = deferred()
  const retry = manager.retry('a', () => true, async output => { persisted = output; await disk.promise })
  await manager.retry('a', () => true, async () => { throw new Error('Duplicate retry') })
  disk.resolve(); await retry
  assert.equal(requests, 1); assert.equal(persisted, 'files'); assert.equal(manager.tasks.a.phase, 'completed')
  await manager.start('a', 'A', 'v1', async () => 'new files', () => true, async () => {})
  assert.equal(manager.tasks.a.phase, 'completed')
})

test('edited, deleted, submitted, or switched-account jobs discard delayed generation', async () => {
  for (const reason of ['edited', 'deleted', 'submitted', 'signout']) {
    const manager = new BackgroundTasks(() => {})
    const ai = deferred(); let saves = 0
    const work = manager.start('a', reason, 'v1', () => ai.promise, () => true, async () => { saves++ })
    if (reason === 'signout') manager.reset(); else manager.invalidate('a')
    ai.resolve('obsolete'); await work; assert.equal(saves, 0)
    assert.equal(manager.tasks.a?.output, undefined)
  }
})

test('retry validates inputs again; invalidated old run cannot overwrite a newer same-job run', async () => {
  const manager = new BackgroundTasks(() => {})
  await manager.start('a', 'A', 'v1', async () => 'files', () => true, async () => { throw new Error('Offline') })
  let saves = 0
  await manager.retry('a', () => false, async () => { saves++ })
  assert.equal(saves, 0); assert.equal(manager.tasks.a.output, undefined)
  const old = deferred()
  const run = manager.start('a', 'A', 'v1', () => old.promise, () => true, async () => { saves++ })
  manager.invalidate('a')
  await manager.start('a', 'A', 'v2', async () => 'new', () => true, async () => { saves++ })
  old.resolve('old'); await run; assert.equal(saves, 1); assert.equal(manager.tasks.a.fingerprint, 'v2')
})

test('in-flight persistence receives a revocable guard and never announces stale success', async () => {
  const manager = new BackgroundTasks(() => {})
  const disk = deferred(); let guard
  const work = manager.start('a', 'A', 'v1', async () => 'files', () => true, async (_, valid) => { guard = valid; await disk.promise })
  await Promise.resolve(); assert.equal(guard(), true)
  manager.invalidate('a'); assert.equal(guard(), false)
  disk.resolve(); await work; assert.equal(manager.tasks.a.phase, 'failed')
})

test('AI errors stay retryable without replacing saved documents', async () => {
  const manager = new BackgroundTasks(() => {}); let saved = 'previous'
  await manager.start('a', 'A', 'v1', async () => { throw new Error('AI unavailable') }, () => true, async output => { saved = output })
  assert.equal(saved, 'previous'); assert.equal(manager.tasks.a.phase, 'failed'); assert.equal(manager.tasks.a.output, undefined)
})

test('clipboard awaits success, repeats reset the two-second timer, failure never announces success', async () => {
  let next = 0; const timers = new Map(), notices = [], errors = []
  const feedback = new CopyFeedback(id => notices.push(id), error => errors.push(error), (fn, ms) => { assert.equal(ms, 2000); timers.set(++next, fn); return next }, id => timers.delete(id))
  const clipboard = deferred(); const copy = feedback.copy('letter', () => clipboard.promise)
  assert.deepEqual(notices, [0]); clipboard.resolve(); await copy; assert(notices.at(-1) > 0)
  await feedback.copy('letter', async () => {}); assert.equal(timers.size, 1)
  timers.values().next().value(); assert.equal(notices.at(-1), 0)
  await feedback.copy('letter', async () => { throw new Error('Permission denied') })
  assert.equal(notices.at(-1), 0); assert.equal(errors.length, 1)
  const late = deferred(); const pending = feedback.copy('letter', () => late.promise)
  feedback.dispose(); late.resolve(); await pending; assert.equal(notices.at(-1), 0)
})

const { mergeTailoredDocument, changedJobColumns } = await source('../src/lib/documentPersistence.ts')
test('overlapping document saves merge into current state and persist both jobs without altering history', () => {
  const historical = { jobApplicationId: 'submitted', coverLetter: 'Historical', masterCvSnapshot: { summary: 'Original' } }
  const a = { jobApplicationId: 'a', coverLetter: 'A' }, b = { jobApplicationId: 'b', coverLetter: 'B' }
  let documents = [historical]
  documents = mergeTailoredDocument(documents, a)
  documents = mergeTailoredDocument(documents, b)
  const reloaded = JSON.parse(JSON.stringify(documents))
  assert.equal(reloaded.length, 3); assert.equal(reloaded.find(doc => doc.jobApplicationId === 'a').coverLetter, 'A')
  assert.deepEqual(reloaded.find(doc => doc.jobApplicationId === 'submitted'), historical)
  assert.equal(mergeTailoredDocument(documents, { ...a, coverLetter: 'Re-run A' }).length, 3)
})
test('score patch cannot overwrite notes, interviews, description, status, identity, or another job', () => {
  const row = { id: 'a', user_id: 'owner', notes: 'Latest edit', interviews: ['New interview'], job_description: 'Latest JD', status: 'saved', match_score: 20 }
  assert.deepEqual(changedJobColumns(row, { ...row, match_score: 90 }), { match_score: 90 })
})

const { captureTailoringInput } = await source('../src/lib/tailoringInputs.ts')
test('captured inputs are immutable, allow unrelated edits, and reject deleted/submitted/missing CV jobs', () => {
  const job = { id: 'a', status: 'saved', cvTrack: null, company: 'A', role: 'Developer', jobDescription: 'SQL', claimedSkills: ['SQL'], notes: 'Before' }
  const library = { activeTrack: 'cv', cvs: { cv: { summary: 'Original' }, other: { summary: 'Other' } } }
  const captured = captureTailoringInput(job, library)
  assert.equal(captured.fingerprint, captureTailoringInput({ ...job, notes: 'After', matchScore: 90, interviews: ['New'] }, library).fingerprint)
  for (const edit of [{ jobDescription: 'New JD' }, { claimedSkills: [] }, { cvTrack: 'other' }]) {
    assert.notEqual(captured.fingerprint, captureTailoringInput({ ...job, ...edit }, library).fingerprint)
  }
  assert.equal(captureTailoringInput({ ...job, status: 'applied' }, library), null)
  assert.equal(captureTailoringInput({ ...job, deletedAt: 'today' }, library), null)
  assert.equal(captureTailoringInput({ ...job, cvTrack: 'deleted' }, library), null)
  job.claimedSkills.push('New'); library.cvs.cv.summary = 'Edited'
  assert.deepEqual(captured.job.claimedSkills, ['SQL']); assert.equal(captured.cv.summary, 'Original')
})

test('viewing an application hides its notification without losing work or save retry', async () => {
  const manager = new BackgroundTasks(() => {})
  const ai = deferred()
  const work = manager.start('a', 'A', 'v1', () => ai.promise, () => true, async () => { throw new Error('Offline') })
  manager.hideNotification('a')
  assert.equal(manager.tasks.a.notificationHidden, true)
  assert.equal(manager.tasks.a.phase, 'running')
  ai.resolve('generated files'); await work
  assert.equal(manager.tasks.a.notificationHidden, true)
  assert.equal(manager.tasks.a.output, 'generated files')
  await manager.retry('a', () => true, async () => {})
  assert.equal(manager.tasks.a.phase, 'completed')
  assert.equal(manager.tasks.a.notificationHidden, true)
  const next = deferred()
  const rerun = manager.start('a', 'A', 'v1', () => next.promise, () => true, async () => {})
  assert.equal(manager.tasks.a.notificationHidden, false)
  next.resolve('new files'); await rerun
})

test('dismissing while tailoring runs hides progress, continues saving, and stays hidden after success', async () => {
  const manager = new BackgroundTasks(() => {})
  const ai = deferred(), disk = deferred()
  let requests = 0, saves = 0
  const work = manager.start('a', 'A', 'v1', () => { requests++; return ai.promise }, () => true, async () => { saves++; await disk.promise })

  manager.dismiss('a')
  assert.equal(manager.tasks.a.phase, 'running')
  assert.equal(manager.tasks.a.notificationHidden, true)
  ai.resolve('generated files')
  await Promise.resolve()
  assert.equal(manager.tasks.a.phase, 'saving')
  assert.equal(manager.tasks.a.notificationHidden, true)
  disk.resolve()
  await work

  assert.equal(manager.tasks.a.phase, 'completed')
  assert.equal(manager.tasks.a.notificationHidden, true)
  assert.equal(requests, 1)
  assert.equal(saves, 1)
})

test('dismissing while saving re-shows save failures and allows save-only retry', async () => {
  const manager = new BackgroundTasks(() => {})
  const disk = deferred()
  let requests = 0, saves = 0, persisted
  const work = manager.start('a', 'A', 'v1', async () => { requests++; return 'generated files' }, () => true, async output => {
    saves++
    if (saves === 1) { await disk.promise; return }
    persisted = output
  })
  await Promise.resolve()
  assert.equal(manager.tasks.a.phase, 'saving')
  manager.dismiss('a')
  assert.equal(manager.tasks.a.phase, 'saving')
  assert.equal(manager.tasks.a.notificationHidden, true)

  disk.reject(new Error('Offline'))
  await work
  assert.equal(manager.tasks.a.phase, 'failed')
  assert.equal(manager.tasks.a.error, 'Offline')
  assert.equal(manager.tasks.a.output, 'generated files')
  assert.equal(manager.tasks.a.notificationHidden, false)

  await manager.retry('a', () => true, async output => { saves++; persisted = output })
  assert.equal(manager.tasks.a.phase, 'completed')
  assert.equal(persisted, 'generated files')
  assert.equal(requests, 1)
  assert.equal(saves, 2)
})

test('generation failure after early dismissal reappears with retry while View application stays hidden', async () => {
  const manager = new BackgroundTasks(() => {})
  const ai = deferred()
  const work = manager.start('a', 'A', 'v1', () => ai.promise, () => true, async () => {})
  manager.dismiss('a')
  ai.reject(new Error('AI unavailable'))
  await work
  assert.equal(manager.tasks.a.phase, 'failed')
  assert.equal(manager.tasks.a.error, 'AI unavailable')
  assert.equal(manager.tasks.a.notificationHidden, false)

  const retry = deferred()
  const rerun = manager.start('a', 'A', 'v1', () => retry.promise, () => true, async () => {})
  manager.hideNotification('a')
  retry.reject(new Error('AI still unavailable'))
  await rerun
  assert.equal(manager.tasks.a.phase, 'failed')
  assert.equal(manager.tasks.a.notificationHidden, true)
})
