import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

async function source(path, replacements = []) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [from, to] of replacements) code = code.replaceAll(from, to)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const errorMessage = ts.transpileModule(readFileSync(new URL('../src/lib/errorMessage.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const errorMessageUrl = `data:text/javascript;base64,${Buffer.from(errorMessage).toString('base64')}`
const { SkillExplanationSession } = await source('../src/lib/skillExplanationSession.ts', [["'./errorMessage'", JSON.stringify(errorMessageUrl)]])
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('selected explanation remains loading and completes while its route is unmounted', async () => {
  const lookup = deferred()
  const session = new SkillExplanationSession('account-a', () => lookup.promise)
  session.toggle('job-a', 'React')
  assert.equal(session.get('job-a').status, 'loading')

  // The route component can unmount while the app-level session remains alive.
  await Promise.resolve()
  assert.equal(session.get('job-a').status, 'loading')
  lookup.resolve('A useful explanation')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(session.get('job-a'), { skill: 'React', status: 'complete', summary: 'A useful explanation', error: null })
})

test('explanations are isolated by account, job and skill', async () => {
  const pending = []
  const makeSession = account => new SkillExplanationSession(account, skill => {
    const request = deferred()
    pending.push({ account, skill, request })
    return request.promise
  })
  const first = makeSession('account-a')
  const second = makeSession('account-b')
  first.toggle('job-a', 'React')
  first.toggle('job-b', 'React')
  second.toggle('job-a', 'React')
  first.toggle('job-a', 'TypeScript')

  assert.equal(first.get('job-a').skill, 'TypeScript')
  assert.equal(first.get('job-b').skill, 'React')
  assert.equal(second.get('job-a').skill, 'React')
  assert.equal(pending.length, 4)

  pending[0].request.resolve('First account result')
  await new Promise(resolve => setImmediate(resolve))
  first.toggle('job-a', 'React')
  assert.equal(first.get('job-a').summary, 'First account result')
  assert.equal(second.get('job-a').status, 'loading')
})

test('explicit close hides the explanation but reopening resumes the same lookup', async () => {
  const lookup = deferred()
  let requests = 0
  const session = new SkillExplanationSession('account-a', () => { requests++; return lookup.promise })
  session.toggle('job-a', 'React')
  session.close('job-a')
  assert.equal(session.get('job-a'), null)

  session.toggle('job-a', 'React')
  assert.equal(session.get('job-a').status, 'loading')
  assert.equal(requests, 1)
  lookup.resolve('Cached after close')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.get('job-a').summary, 'Cached after close')
  session.toggle('job-a', 'React')
  assert.equal(session.get('job-a'), null)
  session.toggle('job-a', 'React')
  assert.equal(session.get('job-a').summary, 'Cached after close')
  assert.equal(requests, 1)
})

test('failed explanations expose an error and can be retried', async () => {
  let requests = 0
  const session = new SkillExplanationSession('account-a', async () => {
    requests++
    if (requests === 1) throw new Error('Temporary failure')
    return 'Recovered explanation'
  })
  session.toggle('job-a', 'React')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.get('job-a').status, 'error')
  assert.equal(session.get('job-a').error, 'Temporary failure')
  session.retry('job-a', 'React')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.get('job-a').status, 'complete')
  assert.equal(session.get('job-a').summary, 'Recovered explanation')
  assert.equal(requests, 2)
})

test('disposed session results are discarded and a new session starts empty', async () => {
  const lookup = deferred()
  const oldSession = new SkillExplanationSession('account-a', () => lookup.promise)
  oldSession.toggle('job-a', 'React')
  oldSession.dispose()
  const newSession = new SkillExplanationSession('account-a', async () => 'Fresh session')
  assert.equal(newSession.get('job-a'), null)

  lookup.resolve('Stale result')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(oldSession.get('job-a'), null)
  assert.equal(newSession.get('job-a'), null)
})
