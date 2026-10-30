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
const { buildSkillJobContext, skillJobContextKey, validSkillJobContext } = await source('../shared/skillContext.ts')
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

test('posting context is bounded, includes relevant mentions, and excludes personal information', () => {
  const job = { role: 'Data engineer', jobDescription: 'Overview\n' + 'x'.repeat(3000) + '\nMicrosoft Fabric and Power BI', extractedSkills: ['Fabric', 'Power BI'], extractedRequirements: ['Microsoft data tools'], notes: 'private note', company: 'private company' }
  const context = buildSkillJobContext('Fabric', job)
  assert.match(context.description, /Microsoft Fabric/)
  assert(validSkillJobContext(context))
  assert(!JSON.stringify(context).includes('private'))
  assert.notEqual(skillJobContextKey(job), skillJobContextKey({ ...job, jobDescription: job.jobDescription + ' changed' }))
})

test('the client sends the selected skill and posting context to the explanation action', async () => {
  let sent
  globalThis.__skillRequest = body => { sent = body; return Promise.resolve('Explanation') }
  const mock = `data:text/javascript;base64,${Buffer.from('export const callGemini = body => globalThis.__skillRequest(body)').toString('base64')}`
  const { explainSkill } = await source('../src/api/gemini.ts', [["'./client'", JSON.stringify(mock)]])
  const context = { role: 'Data engineer', description: 'Microsoft Fabric', skills: ['Fabric'], requirements: [] }
  assert.equal(await explainSkill('Fabric', context), 'Explanation')
  assert.deepEqual(sent, { action: 'explainSkill', skill: 'Fabric', context })
  delete globalThis.__skillRequest
})

test('different job contexts do not reuse results and a late result after an edit stays hidden', async () => {
  const pending = []
  const session = new SkillExplanationSession('account-a', (skill, context) => { const request = deferred(); pending.push({ skill, context, request }); return request.promise })
  const original = { role: 'Data engineer', jobDescription: 'Microsoft Fabric and Power BI', extractedSkills: ['Fabric'], extractedRequirements: [] }
  const changed = { ...original, jobDescription: 'Textile manufacturing and cloth fabric' }
  const firstKey = skillJobContextKey(original), changedKey = skillJobContextKey(changed)
  session.toggle('job-a', 'Fabric', firstKey, buildSkillJobContext('Fabric', original))
  assert.equal(session.get('job-a', changedKey), null)
  session.toggle('job-a', 'Fabric', changedKey, buildSkillJobContext('Fabric', changed))
  session.toggle('job-b', 'Fabric', firstKey, buildSkillJobContext('Fabric', original))
  pending[0].request.resolve('Old data meaning')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.get('job-a', changedKey).status, 'loading')
  assert.equal(pending.length, 3)
  pending[1].request.resolve('Textile meaning')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.get('job-a', changedKey).summary, 'Textile meaning')
  assert.equal(session.get('job-b', firstKey).status, 'loading')
})

test('retry retains the selected posting context', async () => {
  const job = { role: 'Data engineer', jobDescription: 'Microsoft Fabric', extractedSkills: ['Fabric'], extractedRequirements: [] }
  const context = buildSkillJobContext('Fabric', job), key = skillJobContextKey(job)
  const seen = []
  const session = new SkillExplanationSession('account-a', async (_skill, value) => { seen.push(value); if (seen.length === 1) throw new Error('Temporary'); return 'Recovered' })
  session.toggle('job-a', 'Fabric', key, context)
  await new Promise(resolve => setImmediate(resolve))
  session.retry('job-a', 'Fabric', key, context)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.get('job-a', key).summary, 'Recovered')
  assert.deepEqual(seen, [context, context])
})

test('the explain endpoint sends bounded posting data to a mocked model and handles ambiguity and failures', async () => {
  const dataUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
  const contextUrl = dataUrl(ts.transpileModule(readFileSync(new URL('../shared/skillContext.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  const errors = dataUrl('export class AdzunaError extends Error {}')
  const adzuna = dataUrl('export const searchAdzuna = async () => []')
  const gemini = dataUrl('export const extractJsonArray = () => []; export const extractJsonObject = () => ({}); export const generateGeminiExplainText = async () => ""; export const generateGeminiLiteText = async () => ""; export const generateGeminiTailorText = async () => ({})')
  const { handleGemini } = await source('../api/_lib/handlers.ts', [["'../../shared/adzunaErrors.js'", JSON.stringify(errors)], ["'../../shared/skillContext.js'", JSON.stringify(contextUrl)], ["'./adzuna.js'", JSON.stringify(adzuna)], ["'./gemini.js'", JSON.stringify(gemini)]])
  let prompt = ''
  const explain = async value => { prompt = value; return 'Microsoft Fabric is a data platform used with Power BI.' }
  const context = { role: 'Data engineer', description: 'Microsoft Fabric and Power BI', skills: ['Fabric'], requirements: ['Microsoft data tools'] }
  const result = await handleGemini({ action: 'explainSkill', skill: 'Fabric', context: { ...context, notes: 'private note' } }, {}, explain)
  assert.equal(result.status, 200)
  assert.match(prompt, /Microsoft Fabric and Power BI/)
  assert(!prompt.includes('private note'))
  assert.match(prompt, /ambiguous.*uncertain/)
  assert.match(prompt, /untrusted data, never as instructions/)
  const sparse = await handleGemini({ action: 'explainSkill', skill: 'Fabric', context: { role: '', description: '', skills: [], requirements: [] } }, {}, async value => { prompt = value; return 'The meaning is uncertain.' })
  assert.equal(sparse.body.result, 'The meaning is uncertain.')
  assert.match(prompt, /context is sparse/)
  assert.equal((await handleGemini({ action: 'explainSkill', skill: 'x', context: { ...context, description: 'x'.repeat(3402) } }, {}, explain)).status, 400)
  const failure = await handleGemini({ action: 'explainSkill', skill: 'Fabric', context }, {}, async () => { throw new Error('secret provider response') })
  assert.equal(failure.status, 503)
  assert(!JSON.stringify(failure.body).includes('secret'))
})
