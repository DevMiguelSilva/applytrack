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
const postingSkillsUrl = source('../shared/postingSkills.ts')
const { postingSkillsFromRequirements } = await import(postingSkillsUrl)
const { filterPostingSkillLabels } = await import(postingSkillsUrl)
const { jobRequirementEvaluation } = await import(new URL('../evaluation/job-requirements-synthetic.mjs', import.meta.url))
const { scoreRequirementExtraction } = await import('../scripts/requirementBenchmarkMetrics.mjs')
const clientStubUrl = `data:text/javascript;base64,${Buffer.from('export let callCount = 0; let reply; export function setReply(value) { reply = value }; export async function callGemini() { callCount++; return structuredClone(reply) }').toString('base64')}`
const parseClientUrl = source('../src/api/gemini.ts', {
  "'./client'": `'${clientStubUrl}'`,
  "'../../shared/jobRequirements'": `'${requirementUrl}'`,
})
const clientStub = await import(clientStubUrl)
const { parseJobPosting } = await import(parseClientUrl)
const cvUrl = source('../src/types/cv.ts')
const matchUrl = source('../src/lib/matchScore.ts', {
  "'../types/cv'": `'${cvUrl}'`,
  "'../../shared/jobRequirements'": `'${requirementUrl}'`,
  "'../../shared/postingSkills'": `'${postingSkillsUrl}'`,
})
const { jobDescriptionHash, splitJobDescription, validJobRequirementAnalysis, jobRequirementAnalysisValidationIssues, reusableJobRequirementAnalysis } = await import(requirementUrl)
const { buildGapReport, buildRequirementGapReport } = await import(matchUrl)

test('synthetic extraction evaluation has a held-out split and exact source evidence', () => {
  assert.equal(jobRequirementEvaluation.length, 30)
  assert.equal(jobRequirementEvaluation.filter(row => row.split === 'held-out').length, 6)
  assert.ok(jobRequirementEvaluation.every(row => row.annotationStatus === 'needs-human-review' && row.reviewedBy === null))
  assert.ok(jobRequirementEvaluation.every(row => row.requirements.length > 0 && row.requirements.every(item => row.description.includes(item.sourceQuote))))
  assert.ok(jobRequirementEvaluation.some(row => row.description.length > 3500))
  assert.ok(new Set(jobRequirementEvaluation.flatMap(row => row.requirements.map(item => item.category))).size >= 6)
})

test('Gap Check keeps compact skill chips and places source details in tooltips', () => {
  const sourceText = readFileSync(new URL('../src/components/TailorPanel.tsx', import.meta.url), 'utf8')
  assert.match(sourceText, /className="flex flex-wrap gap-2">\s*\{displaySkills\.map/)
  assert.match(sourceText, /title=\{title\}/)
  assert.match(sourceText, /item\.sourceQuote \? `Source:/)
  assert.match(sourceText, /onClick=\{\(\) => void toggleClaimedSkill\(item\.skill\)\}/)
  assert.doesNotMatch(sourceText, /<li key=\{item\.skill\} className="rounded-lg border border-brand-line p-3">/)
})

test('unchanged complete saved analysis can be reused while changed, stale and incomplete analysis cannot', () => {
  const text = 'Required: React.'
  const complete = analysis(text, [{ label: 'React', quote: 'Required: React.' }])
  assert.equal(reusableJobRequirementAnalysis(text, text, complete), true)
  assert.equal(reusableJobRequirementAnalysis(`${text} TypeScript.`, text, complete), false)
  assert.equal(reusableJobRequirementAnalysis(text, `${text} TypeScript.`, complete), false)
  assert.equal(reusableJobRequirementAnalysis(text, text, { ...complete, status: 'incomplete' }), false)
})

test('rescore keeps the saved extracted skill array unchanged for the same description', () => {
  const jobDetail = readFileSync(new URL('../src/pages/JobDetailPage.tsx', import.meta.url), 'utf8')
  assert.match(jobDetail, /const sameDescription = fullJd === job\.jobDescription/)
  assert.match(jobDetail, /const reanalyze = !sameDescription \|\| forceReanalysis/)
  assert.match(jobDetail, /const keepStoredSkills = sameDescription && !forceReanalysis/)
  assert.match(jobDetail, /extractedSkills: keepStoredSkills \? job\.extractedSkills/)
  assert.match(jobDetail, /onClick=\{\(\) => void saveJd\(job\.jobDescription\)\}/)
  assert.match(jobDetail, /onClick=\{\(\) => void saveJd\(jdDraft, true\)\}/)
  assert.match(jobDetail, /parseJobPosting\(fullJd, \{ force: forceReanalysis \}\)/)
})

test('failed forced reanalysis of an unchanged description preserves the last good extraction', () => {
  const jobDetail = readFileSync(new URL('../src/pages/JobDetailPage.tsx', import.meta.url), 'utf8')
  const parseCall = jobDetail.indexOf('const parsed = await parseJobPosting')
  const catchStart = jobDetail.indexOf('} catch (err) {', parseCall)
  const finallyStart = jobDetail.indexOf('} finally {', catchStart)
  assert.ok(parseCall >= 0 && catchStart > parseCall && finallyStart > catchStart, 'the parse failure path remains explicit')
  const failurePath = jobDetail.slice(catchStart, finallyStart)
  assert.match(failurePath, /if \(sameDescription\) \{[\s\S]*?setJdError\([\s\S]*?return\s*}/)
  assert.ok(failurePath.indexOf('return') < failurePath.indexOf('extractedSkills = []'))
  assert.match(failurePath, /The saved skills and analysis were kept/)
  assert.match(failurePath, /description was saved with analysis marked incomplete/)
  assert.match(jobDetail, /if \(!parseFailed\) \{\s*setEditingJd\(false\)/)
})

test('same complete posting reuses one validated parse result during the app session', async () => {
  const text = 'Required: React and TypeScript.'
  const result = {
    company: '', role: 'Engineer', location: '', salary: '', summary: '',
    skills: ['React', 'TypeScript'], requirements: ['React and TypeScript'],
    requirementAnalysis: analysis(text, [{ label: 'React and TypeScript', quote: text, components: ['React', 'TypeScript'], logic: 'all' }]),
  }
  clientStub.setReply(result)
  const [first, second] = await Promise.all([parseJobPosting(text), parseJobPosting(text)])
  assert.equal(clientStub.callCount, 1)
  assert.deepEqual(first, second)
  first.requirementAnalysis.requirements[0].label = 'mutated caller copy'
  assert.equal((await parseJobPosting(text)).requirementAnalysis.requirements[0].label, 'React and TypeScript')
  assert.equal(clientStub.callCount, 1)

  const changed = `${text}\n\nPreferred: Azure.`
  clientStub.setReply({ ...result, requirementAnalysis: analysis(changed, [{ label: 'Azure', quote: 'Preferred: Azure.' }]) })
  await parseJobPosting(changed)
  assert.equal(clientStub.callCount, 2)

  clientStub.setReply(result)
  await parseJobPosting(text, { force: true })
  assert.equal(clientStub.callCount, 3)
})

test('incomplete analysis is not cached so the user can retry extraction', async () => {
  const text = 'Possibly relevant: React.'
  const incomplete = analysis(text, [{ label: 'React', quote: text }])
  incomplete.status = 'incomplete'
  incomplete.sections[0].disposition = 'uncertain'
  clientStub.setReply({ company: '', role: 'Engineer', location: '', salary: '', summary: '', skills: ['React'], requirements: ['React'], requirementAnalysis: incomplete })
  await parseJobPosting(text)
  await parseJobPosting(text)
  assert.equal(clientStub.callCount, 5)
})

test('Gemini parse request uses fixed system instructions and does not rely on sampling controls', async () => {
  const envStub = `data:text/javascript;base64,${Buffer.from('export const getGeminiApiKey = env => env.GEMINI_API_KEY; export const getGeminiLiteModel = env => env.GEMINI_MODEL_LITE || "mock-model"; export const getGeminiExplainModels = () => []; export const getGeminiTailorModels = () => []').toString('base64')}`
  const geminiUrl = source('../api/_lib/gemini.ts', { "'./env.js'": `'${envStub}'` })
  const { generateGeminiLiteText } = await import(geminiUrl)
  const originalFetch = globalThis.fetch
  let requestBody
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body)
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 })
  }
  try {
    await generateGeminiLiteText('Sections: [s1] Required: React.', { GEMINI_API_KEY: 'test-key', GEMINI_MODEL_LITE: 'mock-model' }, {
      jsonMode: true, retries: 0, systemInstruction: 'Fixed extraction policy.',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual(requestBody.systemInstruction, { parts: [{ text: 'Fixed extraction policy.' }] })
  assert.match(requestBody.contents[0].parts[0].text, /Sections: \[s1\]/)
  assert.equal(requestBody.generationConfig.responseMimeType, 'application/json')
  assert.equal('temperature' in requestBody.generationConfig, false)
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

test('analysis validation diagnostics identify structural paths without returning values', () => {
  const text = 'Required: React experience.'
  const valid = analysis(text, [{ label: 'React', quote: 'React experience' }])
  const invalid = { ...valid, requirements: [{ ...valid.requirements[0], category: 'private-model-category' }] }
  const issueCodes = jobRequirementAnalysisValidationIssues(invalid)
  assert.ok(issueCodes.includes('requirements[0].category.invalid'))
  assert.doesNotMatch(issueCodes.join(' '), /private-model-category|React experience/)
})

test('posting skill chips keep specific technical skills and omit broad labels and language requirements', () => {
  const requirements = [
    { category: 'technical', components: ['Copilot Studio', 'Custom actions and tools', 'channels', 'Language', 'Azure AI Language', 'TypeScript'] },
    { category: 'language', components: ['English'] },
    { category: 'experience', components: ['Architect'] },
  ]
  assert.deepEqual(postingSkillsFromRequirements(requirements, 'Workplace and Power Platform Architect'), [
    'Copilot Studio', 'Azure AI Language', 'TypeScript',
  ])
  assert.deepEqual(filterPostingSkillLabels([
    'Copilot Studio', 'Custom actions and tools', 'channels', 'Language', 'English', 'Architect', 'TypeScript', 'Software Engineer',
  ], 'Software Engineer', ['English']), ['Copilot Studio', 'TypeScript'])
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

test('Gap Check displays and counts only filtered technical posting skills', () => {
  const jobDetail = readFileSync(new URL('../src/pages/JobDetailPage.tsx', import.meta.url), 'utf8')
  const tailorPanel = readFileSync(new URL('../src/components/TailorPanel.tsx', import.meta.url), 'utf8')
  assert.match(jobDetail, /filterPostingSkillLabels\(job\.extractedSkills, job\.role, languageTerms\)/)
  assert.match(tailorPanel, /job\.requirementAnalysis,\s*job\.role/)
  const text = 'Required: React.\n\nBachelor degree required.\n\nFluent English required.'
  const posting = analysis(text, [
    { label: 'React', quote: 'Required: React.', components: ['React'], category: 'technical' },
    { label: 'Bachelor degree', quote: 'Bachelor degree required.', components: ['Bachelor degree'], category: 'education' },
    { label: 'English', quote: 'Fluent English required.', components: ['English'], category: 'language' },
  ])
  const report = buildGapReport(text, ['React', 'Channels', 'English', 'Software Engineer'], 'React', [], posting, 'Software Engineer')
  assert.deepEqual(report.skills.map(({ skill }) => skill), ['React'])
  assert.equal(report.requiredTotal, 3)
  assert.equal(report.requiredCovered, 1)
  assert.equal(report.coveragePercent, 33)
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
    "'../../shared/postingSkills.js'": `'${postingSkillsUrl}'`,
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
  assert.match(capturedOptions.systemInstruction, /Process sections and qualifications in their source order/)
  assert.match(capturedOptions.systemInstruction, /"requirements":\[/)
  assert.match(capturedPrompt, /\[s1\] Required: React and TypeScript\./)
  assert.match(capturedOptions.systemInstruction, /Mark every supplied section exactly once/)
  assert.match(capturedOptions.systemInstruction, /standalone terms such as “channels”, “language”, “architect”/)
  assert.deepEqual(result.body.result.skills, ['React', 'TypeScript', 'Azure'])

  let repairAttempts = 0
  let repairPrompt = ''
  const repaired = await handleGemini({ action: 'parse', description }, {}, undefined, async (prompt) => {
    repairAttempts++
    if (repairAttempts === 1) return JSON.stringify({ ...output, requirements: [{ ...output.requirements[0], sourceQuote: 'Fabricated requirement' }] })
    repairPrompt = prompt
    return JSON.stringify(output)
  })
  assert.equal(repaired.status, 200)
  assert.equal(repairAttempts, 2)
  assert.match(repairPrompt, /failed source validation/)
  assert.match(repairPrompt, /short, exact, contiguous sourceQuote copied verbatim/)
  assert.deepEqual(repaired.body.result.requirementAnalysis.requirements, output.requirements)

  let structureRepairAttempts = 0
  let structureRepairPrompt = ''
  const structureRepaired = await handleGemini({ action: 'parse', description }, {}, undefined, async (prompt) => {
    structureRepairAttempts++
    if (structureRepairAttempts === 1) return JSON.stringify({ ...output, requirements: [{ ...output.requirements[0], category: 'private-model-category' }] })
    structureRepairPrompt = prompt
    assert.match(prompt, /requirements\[0\]\.category\.invalid/)
    assert.doesNotMatch(prompt, /private-model-category/)
    return JSON.stringify(output)
  })
  assert.equal(structureRepaired.status, 200)
  assert.equal(structureRepairAttempts, 2)
  assert.match(structureRepairPrompt, /failed structure validation/)

  let persistentStructureAttempts = 0
  const persistentStructureError = await handleGemini({ action: 'parse', description }, {}, undefined, async () => {
    persistentStructureAttempts++
    return JSON.stringify({ ...output, requirements: [{ ...output.requirements[0], category: 'private-model-category' }] })
  })
  assert.equal(persistentStructureError.status, 502)
  assert.equal(persistentStructureAttempts, 2)
  assert.match(persistentStructureError.body.error, /invalid requirement structure/)
  assert.doesNotMatch(persistentStructureError.body.error, /private-model-category|Required: React/)

  const invalid = await handleGemini({ action: 'parse', description }, {}, undefined, async () => JSON.stringify({ ...output, requirements: [{ ...output.requirements[0], sourceQuote: 'Fabricated requirement' }] }))
  assert.equal(invalid.status, 502)
  assert.match(invalid.body.error, /after one repair attempt/)
  assert.doesNotMatch(invalid.body.error, /Fabricated requirement|Required: React/)

  let interruptedRepairCalls = 0
  const interruptedRepair = await handleGemini({ action: 'parse', description }, {}, undefined, async () => {
    interruptedRepairCalls++
    if (interruptedRepairCalls === 1) return JSON.stringify({ ...output, requirements: [{ ...output.requirements[0], sourceQuote: 'Fabricated requirement' }] })
    throw new Error('provider detail should stay hidden')
  })
  assert.equal(interruptedRepair.status, 503)
  assert.match(interruptedRepair.body.error, /verification retry could not finish/)
  assert.doesNotMatch(interruptedRepair.body.error, /provider detail|Fabricated requirement/)

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
