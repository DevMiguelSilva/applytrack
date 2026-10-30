import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function source(path, replacements = {}) {
  let text = readFileSync(new URL(path, import.meta.url), 'utf8')
  for (const [from, to] of Object.entries(replacements)) text = text.replaceAll(from, to)
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const requirementUrl = source('../shared/jobRequirements.ts')
const requirementPromptUrl = source('../shared/jobRequirementPrompt.ts')
const { jobRequirementEvaluation } = await import(new URL('../evaluation/job-requirements-synthetic.mjs', import.meta.url))
const { scoreRequirementExtraction } = await import('../scripts/requirementBenchmarkMetrics.mjs')
const cvUrl = source('../src/types/cv.ts')
const matchUrl = source('../src/lib/matchScore.ts', {
  "'../types/cv'": `'${cvUrl}'`,
  "'../../shared/jobRequirements'": `'${requirementUrl}'`,
})
const { jobDescriptionHash, splitJobDescription, validJobRequirementAnalysis } = await import(requirementUrl)
const { buildRequirementGapReport } = await import(matchUrl)

test('synthetic extraction evaluation has a held-out split and exact source evidence', () => {
  assert.equal(jobRequirementEvaluation.length, 30)
  assert.equal(jobRequirementEvaluation.filter(row => row.split === 'held-out').length, 6)
  assert.ok(jobRequirementEvaluation.every(row => row.annotationStatus === 'needs-human-review' && row.reviewedBy === null))
  assert.ok(jobRequirementEvaluation.every(row => row.requirements.length > 0 && row.requirements.every(item => row.description.includes(item.sourceQuote))))
  assert.ok(jobRequirementEvaluation.some(row => row.description.length > 3500))
  assert.ok(new Set(jobRequirementEvaluation.flatMap(row => row.requirements.map(item => item.category))).size >= 6)
})

test('live benchmark refuses unreviewed labels before checking credentials or making requests', () => {
  const result = spawnSync(process.execPath, ['scripts/benchmarkJobRequirementAnalysis.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, GEMINI_API_KEY: '' },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /30 annotation records still need a human reviewer/)
  assert.doesNotMatch(result.stderr, /GEMINI_API_KEY/)
})

test('benchmark recall and critical misses require every AND component', () => {
  const expected = [{ label: 'React and TypeScript', components: ['React', 'TypeScript'], logic: 'all', critical: true }]
  const partial = scoreRequirementExtraction(expected, [{ label: 'React', components: ['React'], logic: 'all' }])
  assert.equal(partial.found, 0)
  assert.equal(partial.recall, 0)
  assert.deepEqual(partial.criticalMisses, ['React and TypeScript'])

  const complete = scoreRequirementExtraction(expected, [{ label: 'React and TypeScript', components: ['React', 'TypeScript'], logic: 'all' }])
  assert.equal(complete.found, 1)
  assert.equal(complete.recall, 1)
  assert.deepEqual(complete.criticalMisses, [])
})

test('benchmark group matching preserves ANY versus ALL semantics', () => {
  const expected = [{ label: 'React or Angular', components: ['React', 'Angular'], logic: 'any', critical: true }]
  const sameComponentsWrongLogic = scoreRequirementExtraction(expected, [{ label: 'React and Angular', components: ['React', 'Angular'], logic: 'all' }])
  assert.equal(sameComponentsWrongLogic.found, 0)
  assert.deepEqual(sameComponentsWrongLogic.criticalMisses, ['React or Angular'])
  const any = scoreRequirementExtraction(expected, [{ label: 'React or Angular', components: ['React', 'Angular'], logic: 'any' }])
  assert.equal(any.recall, 1)
})

function analysis(text, requirements) {
  const sections = splitJobDescription(text)
  return {
    schemaVersion: 1,
    sourceHash: jobDescriptionHash(text),
    sourceLength: text.length,
    status: 'complete',
    modelId: 'mock-flash',
    analyzedAt: '2026-10-30T00:00:00.000Z',
    sections: sections.map(({ id }) => ({ id, disposition: 'requirements' })),
    requirements: requirements.map((item, index) => ({
      id: `r${index + 1}`, category: 'technical', importance: 'required', constraints: [],
      components: [item.label], logic: 'all', sourceSectionId: sections.find(({ text: section }) => section.includes(item.quote)).id,
      label: item.label, sourceQuote: item.quote, ...item,
    })),
  }
}

test('source-backed analysis validation rejects stale descriptions and fabricated evidence', () => {
  const text = 'Required: React experience.'
  const valid = analysis(text, [{ label: 'React', quote: 'React experience' }])
  assert.equal(validJobRequirementAnalysis(valid, text), true)
  assert.equal(validJobRequirementAnalysis(valid, `${text} TypeScript.`), false)
  assert.equal(validJobRequirementAnalysis({ ...valid, requirements: [{ ...valid.requirements[0], sourceQuote: 'Python certification' }] }, text), false)
  assert.equal(validJobRequirementAnalysis({ ...valid, requirements: [{ ...valid.requirements[0], sourceSectionId: 'missing' }] }, text), false)
})

test('requirement scoring handles count, ALL, ANY, qualifiers and confirmed skills conservatively', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ label: `Tool${i + 1}`, quote: `Tool${i + 1}` }))
  const tenText = ten.map(({ quote }) => quote).join('\n\n')
  const tenAnalysis = analysis(tenText, ten)
  const seven = buildRequirementGapReport(tenText, tenAnalysis, 'Tool1 Tool2 Tool3 Tool4 Tool5 Tool6 Tool7')
  assert.equal(seven.coveragePercent, 70)
  assert.equal(seven.requiredCovered, 7)
  assert.equal(seven.requiredTotal, 10)

  const andText = 'Required: React and TypeScript.'
  const andAnalysis = analysis(andText, [{ label: 'React and TypeScript', quote: andText.slice('Required: '.length), components: ['React', 'TypeScript'], logic: 'all' }])
  assert.equal(buildRequirementGapReport(andText, andAnalysis, 'React').coveragePercent, 0)

  const orText = 'React or Angular is required.'
  const orAnalysis = analysis(orText, [{ label: 'React or Angular', quote: orText, components: ['React', 'Angular'], logic: 'any' }])
  assert.equal(buildRequirementGapReport(orText, orAnalysis, 'React').coveragePercent, 100)

  const yearsText = 'Requires 5 years of React experience.'
  const yearsAnalysis = analysis(yearsText, [{ label: 'React', quote: yearsText, constraints: ['5 years'] }])
  const absentDuration = buildRequirementGapReport(yearsText, yearsAnalysis, 'React', ['React'])
  assert.equal(absentDuration.coveragePercent, 0)
  assert.equal(absentDuration.skills[0].state, 'uncertain')

  const stale = buildRequirementGapReport(`${yearsText} Updated.`, yearsAnalysis, 'React 8 years')
  assert.equal(stale.analysisStatus, 'incomplete')
  assert.match(stale.statusMessage, /out of date/)
})

test('job parse endpoint validates a mocked complete extraction and fails visibly on bad source evidence', async () => {
  const apiError = source('../shared/adzunaErrors.ts')
  const skillContext = source('../shared/skillContext.ts')
  const adzuna = `data:text/javascript;base64,${Buffer.from('export const searchAdzuna = async () => []').toString('base64')}`
  const gemini = `data:text/javascript;base64,${Buffer.from('export const extractJsonArray = () => []; export const extractJsonObject = text => JSON.parse(text); export const generateGeminiExplainText = async () => ""; export const generateGeminiLiteText = async () => ""; export const generateGeminiTailorText = async () => ({ text: "", model: "mock" })').toString('base64')}`
  const handlersUrl = source('../api/_lib/handlers.ts', {
    "'../../shared/adzunaErrors.js'": `'${apiError}'`,
    "'../../shared/skillContext.js'": `'${skillContext}'`,
    "'../../shared/jobRequirements.js'": `'${requirementUrl}'`,
    "'../../shared/jobRequirementPrompt.js'": `'${requirementPromptUrl}'`,
    "'./adzuna.js'": `'${adzuna}'`,
    "'./gemini.js'": `'${gemini}'`,
  })
  const { handleGemini } = await import(handlersUrl)
  const description = 'Required: React and TypeScript.\n\nPreferred: Azure.'
  const sections = splitJobDescription(description)
  const output = {
    company: 'Example', role: 'Engineer', location: '', salary: '', summary: 'Build software.',
    sections: sections.map(({ id }) => ({ id, disposition: 'requirements' })),
    requirements: [
      { id: 'r1', label: 'React and TypeScript', components: ['React', 'TypeScript'], logic: 'all', sourceSectionId: 's1', sourceQuote: 'Required: React and TypeScript.', category: 'technical', importance: 'required', constraints: [] },
      { id: 'r2', label: 'Azure', components: ['Azure'], logic: 'all', sourceSectionId: 's2', sourceQuote: 'Preferred: Azure.', category: 'technical', importance: 'preferred', constraints: [] },
    ],
  }
  let capturedPrompt = ''
  let capturedOptions
  const parse = async (prompt, _env, options) => { capturedPrompt = prompt; capturedOptions = options; return JSON.stringify(output) }
  const result = await handleGemini({ action: 'parse', description }, { GEMINI_MODEL_LITE: 'configured-lite' }, undefined, parse)
  assert.equal(result.status, 200)
  assert.equal(result.body.result.requirementAnalysis.status, 'complete')
  assert.equal(result.body.result.requirementAnalysis.modelId, 'configured-lite')
  assert.equal(capturedOptions.jsonMode, true)
  assert.match(capturedPrompt, /\[s1\] Required: React and TypeScript\./)
  assert.match(capturedPrompt, /Every input section ID must appear exactly once/)
  assert.deepEqual(result.body.result.skills, ['React and TypeScript', 'Azure'])

  const invalid = await handleGemini({ action: 'parse', description }, {}, undefined, async () => JSON.stringify({ ...output, requirements: [{ ...output.requirements[0], sourceQuote: 'Fabricated requirement' }] }))
  assert.equal(invalid.status, 502)
  assert.match(invalid.body.error, /source evidence/)

  const badJson = await handleGemini({ action: 'parse', description }, {}, undefined, async () => '{not json')
  assert.equal(badJson.status, 502)
  const providerFailure = await handleGemini({ action: 'parse', description }, {}, undefined, async () => { throw new Error('provider detail should stay hidden') })
  assert.equal(providerFailure.status, 503)
  assert.doesNotMatch(providerFailure.body.error, /provider detail/)

  let called = false
  const oversized = await handleGemini({ action: 'parse', description: 'x'.repeat(60001) }, {}, undefined, async () => { called = true; return '{}' })
  assert.equal(oversized.status, 413)
  assert.equal(called, false)
  const tooManySections = await handleGemini({ action: 'parse', description: Array.from({ length: 240 }, (_, i) => `section ${i}`).join('\n\n') }, {}, undefined, async () => { called = true; return '{}' })
  assert.equal(tooManySections.status, 413)
  assert.equal(called, false)
})
