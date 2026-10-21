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

const cvUrl = moduleUrl('../src/types/cv.ts')
const jobUrl = moduleUrl('../src/types/job.ts')
const matchUrl = moduleUrl('../src/lib/matchScore.ts', { "'../types/cv'": `'${cvUrl}'` })
const { createDefaultLibrary, createEmptyMasterCv } = await import(cvUrl)
const { createEmptyJob } = await import(jobUrl)
const { getSavedJobIndicators } = await import(moduleUrl('../src/lib/savedJobIndicators.ts', {
  "'./matchScore'": `'${matchUrl}'`,
  "'../types/cv'": `'${cvUrl}'`,
}))

function fixture() {
  const library = createDefaultLibrary()
  library.activeTrack = 'frontend'
  library.cvs.frontend = createEmptyMasterCv({
    skills: [{ id: 'skills', group: 'Languages', items: ['React'] }],
  })
  library.cvs.powerPlatform = createEmptyMasterCv()
  const job = createEmptyJob({
    id: 'job-1',
    role: 'Frontend developer',
    jobDescription: 'React and Python experience required.',
    extractedSkills: ['React', 'Python'],
    jdComplete: true,
    cvTrack: 'frontend',
  })
  return { library, job }
}

function tailoredDoc(jobApplicationId, tailoredCv = createEmptyMasterCv()) {
  return { jobApplicationId, tailoredCv, coverLetter: '' }
}

test('shows readiness only for a saved tailored CV and never trusts stored scores', () => {
  const { library, job } = fixture()
  job.matchScore = 99
  assert.deepEqual(getSavedJobIndicators(job, library), { resumeReady: false, matchPercent: 50 })
  assert.deepEqual(getSavedJobIndicators(job, library, tailoredDoc('another-job')), { resumeReady: false, matchPercent: 50 })

  const doc = tailoredDoc(job.id)
  doc.matchScore = 100
  const saved = getSavedJobIndicators(job, library, doc)
  assert.deepEqual(saved, { resumeReady: true, matchPercent: 50 })

  job.status = 'applied'
  assert.equal(getSavedJobIndicators(job, library, tailoredDoc(job.id)), null)
})

test('pending or cover-letter-only data does not qualify as resume ready', () => {
  const { library, job } = fixture()
  const letterOnly = { jobApplicationId: job.id, coverLetter: 'Draft only', matchScore: 100 }
  assert.deepEqual(getSavedJobIndicators(job, library, letterOnly), { resumeReady: false, matchPercent: 50 })
  assert.equal(getSavedJobIndicators(job, library, undefined, false).resumeReady, false)
})

test('includes confirmed claims and recalculates when claims change', () => {
  const { library, job } = fixture()
  assert.equal(getSavedJobIndicators(job, library).matchPercent, 50)
  job.claimedSkills = ['Python']
  assert.equal(getSavedJobIndicators(job, library).matchPercent, 100)
  job.claimedSkills = []
  assert.equal(getSavedJobIndicators(job, library).matchPercent, 50)
})

test('recomputes from the current description and selected live CV', () => {
  const { library, job } = fixture()
  job.jobDescription = 'React experience is preferred.'
  job.extractedSkills = ['React']
  job.needsRescore = true
  assert.equal(getSavedJobIndicators(job, library).matchPercent, 100)

  job.jobDescription = 'Python experience is preferred.'
  job.extractedSkills = ['Python']
  job.needsRescore = false
  assert.equal(getSavedJobIndicators(job, library).matchPercent, 0)

  library.cvs.powerPlatform = createEmptyMasterCv({
    skills: [{ id: 'skills', group: 'Languages', items: ['Python'] }],
  })
  job.needsRescore = true
  job.cvTrack = 'powerPlatform'
  assert.equal(getSavedJobIndicators(job, library).matchPercent, 100)
})

test('hides only the percentage when the description or live source is unavailable', () => {
  const { library, job } = fixture()
  const saved = tailoredDoc(job.id)
  job.jdComplete = false
  assert.deepEqual(getSavedJobIndicators(job, library, saved), { resumeReady: true, matchPercent: null })

  job.jdComplete = true
  job.jobDescription = ''
  assert.deepEqual(getSavedJobIndicators(job, library, saved), { resumeReady: true, matchPercent: null })

  job.jobDescription = 'React and Python experience required.'
  job.needsCvSelection = true
  assert.deepEqual(getSavedJobIndicators(job, library, saved), { resumeReady: true, matchPercent: null })

  job.needsCvSelection = false
  job.cvTrack = 'deleted-template'
  assert.deepEqual(getSavedJobIndicators(job, library, saved), { resumeReady: true, matchPercent: null })

  job.cvTrack = 'frontend'
  assert.deepEqual(getSavedJobIndicators(job, library, saved, true, false), { resumeReady: true, matchPercent: null })
})

test('hides the percentage when no current posting requirements can be scored', () => {
  const { library, job } = fixture()
  job.jobDescription = 'We are looking for a kind and curious person to join our friendly team.'
  job.extractedSkills = []
  assert.deepEqual(getSavedJobIndicators(job, library), { resumeReady: false, matchPercent: null })
})
