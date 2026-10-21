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
const typesUrl = moduleUrl('../src/types/cv.ts')
const mutationUrl = moduleUrl('../src/lib/localMutation.ts')
const { createDefaultLibrary, createEmptyMasterCv, normalizeLibrary, cleanMasterCvEntries } = await import(typesUrl)
const { addCvTemplate, removeCvTemplate, deleteLocalCv, resolveJobCv, recoverCvTransaction } = await import(moduleUrl('../src/lib/cvLibrary.ts', { '../types/cv': typesUrl, './localMutation': mutationUrl }))
const { scoreDualTracks, createCvMatcher, textHasSkill } = await import(moduleUrl('../src/lib/matchScore.ts', { '../types/cv': typesUrl, './localMutation': mutationUrl }))

test('legacy and dynamic libraries retain CV content, IDs, names and attachments', () => {
  const legacy = createDefaultLibrary()
  delete legacy.version
  delete legacy.names
  legacy.activeTrack = 'frontend'
  legacy.attachments.frontend = { fileName: 'old.docx', extractedText: 'original' }
  const migrated = normalizeLibrary(legacy)
  assert.equal(migrated.activeTrack, 'frontend')
  assert.equal(migrated.names.frontend, 'React')
  assert.equal(migrated.attachments.frontend.extractedText, 'original')
  const copied = addCvTemplate(migrated, 'Data analyst', 'frontend')
  copied.cvs[copied.activeTrack].contact.name = 'Different'
  assert.notEqual(copied.cvs.frontend.contact.name, 'Different')
  assert.deepEqual(normalizeLibrary(copied), copied)
  assert.equal(normalizeLibrary(migrated.cvs.frontend).cvs.frontend.contact.name, migrated.cvs.frontend.contact.name)
})

test('removing a non-default CV preserves the default; removing the default picks a valid fallback', () => {
  const library = createDefaultLibrary()
  library.activeTrack = 'frontend'

  const nonDefaultRemoved = removeCvTemplate(library, 'powerPlatform', [], [], [])
  assert.equal(nonDefaultRemoved.library.activeTrack, 'frontend')
  assert.ok(nonDefaultRemoved.library.cvs[nonDefaultRemoved.library.activeTrack])

  const defaultRemoved = removeCvTemplate(library, 'frontend', [], [], [])
  assert.equal(defaultRemoved.library.activeTrack, 'powerPlatform')
  assert.ok(defaultRemoved.library.cvs[defaultRemoved.library.activeTrack])
})

test('CV save cleanup drops untouched rows and blank bullets while retaining partial entries and IDs', () => {
  const cv = createEmptyMasterCv({
    skills: [{ id: 'empty-skill', group: 'Group', items: [] }, { id: 'skill', group: 'Tools', items: [' Excel '] }],
    experience: [
      { id: 'empty-exp', company: '', title: '', location: '', start: '', end: '', current: false, bullets: [{ id: 'blank-bullet', text: '', tags: [] }] },
      { id: 'partial-exp', company: ' Acme ', title: '', location: '', start: '', end: '', current: false, bullets: [{ id: 'blank-2', text: '  ', tags: [] }, { id: 'bullet', text: 'Built a tool\nImproved workflow', tags: [] }] },
    ],
    projects: [{ id: 'empty-project', name: '', url: '', bullets: [] }, { id: 'partial-project', name: 'Portfolio', url: '', bullets: [] }],
    education: [{ id: 'empty-education', school: '', degree: '', start: '', end: '' }, { id: 'partial-education', school: 'College', degree: '', start: '', end: '' }],
    certifications: [{ id: 'empty-cert', name: '', issuer: '', year: '' }, { id: 'partial-cert', name: 'PL-900', issuer: '', year: '' }],
  })
  const saved = cleanMasterCvEntries(cv)
  assert.deepEqual(saved.skills.map((entry) => entry.id), ['skill'])
  assert.deepEqual(saved.experience.map((entry) => entry.id), ['partial-exp'])
  assert.equal(saved.experience[0].bullets[0].id, 'bullet')
  assert.deepEqual(saved.experience[0].bullets.map((bullet) => bullet.text), ['Built a tool', 'Improved workflow'])
  assert.equal(saved.experience[0].bullets[1].id.length > 0, true)
  assert.deepEqual(saved.projects.map((entry) => entry.id), ['partial-project'])
  assert.deepEqual(saved.education.map((entry) => entry.id), ['partial-education'])
  assert.deepEqual(saved.certifications.map((entry) => entry.id), ['partial-cert'])
  assert.equal(saved.experience[0].company, ' Acme ')
})

test('deletion archives Saved references, pauses explicit searches and preserves history', () => {
  const library = createDefaultLibrary()
  const jobs = [{ id:'saved', status:'saved', cvTrack:null, matchScore:86 },{id:'submitted',status:'applied',cvTrack:'powerPlatform'}]
  const searches=[{id:'search',track:'powerPlatform',active:true},{id:'auto',track:'auto',active:true}]
  const inbox=[{id:'new',status:'new',savedSearchId:'search',matchedTrack:'powerPlatform',matchScore:90},{id:'history',status:'approved',matchedTrack:'powerPlatform',matchScore:90}]
  const next=removeCvTemplate(library,'powerPlatform',jobs,searches,inbox)
  assert.equal(next.jobs[0].cvTrack,'powerPlatform');assert.equal(next.jobs[0].needsCvSelection,true);assert.equal(next.jobs[0].matchScore,86)
  assert.deepEqual(next.jobs[1],jobs[1])
  assert.equal(next.searches[0].track,'powerPlatform');assert.equal(next.searches[0].active,false);assert.equal(next.searches[0].needsCvSelection,true)
  assert.deepEqual(next.searches[1],searches[1]);assert.equal(next.inbox[0].matchedTrack,null);assert.equal(next.inbox[0].needsCvSelection,true);assert.deepEqual(next.inbox[1],inbox[1])
  assert.throws(()=>removeCvTemplate(next.library,'frontend',[],[],[]),/at least one/)
  const snapshot=createEmptyMasterCv({summary:'Submitted original'})
  assert.equal(resolveJobCv(next.library,jobs[1],{masterCvSnapshot:snapshot}),snapshot)
  assert.equal(resolveJobCv(next.library,jobs[1]),null);assert.equal(resolveJobCv(next.library,next.jobs[0]),null)
})
test('Auto scores every current template and keeps legacy tie preference', () => {
  const blank = createEmptyMasterCv()
  assert.equal(scoreDualTracks('', { frontend: blank, powerPlatform: blank, custom: blank }).bestTrack, 'powerPlatform')
  const custom = createEmptyMasterCv({ skills: [{ id: 'skills', group: 'Data', items: ['Python', 'SQL'] }] })
  const match = scoreDualTracks('Python SQL developer', { frontend: blank, custom })
  assert.equal(match.bestTrack, 'custom')
  assert.deepEqual(Object.keys(match.scores), ['frontend', 'custom'])
})

test('prepared batch matching preserves aliases, boundaries, requirements and live CV changes', () => {
  const library = createDefaultLibrary()
  const score = createCvMatcher(library.cvs)
  const job = 'Developer\nReact.js, TS, RESTful APIs, French and bilingual communication.'
  assert.deepEqual(score(job), scoreDualTracks(job, library.cvs))
  assert.ok(score(job).scores.frontend.targets.includes('French'))
  assert.ok(score(job).scores.frontend.missing.includes('French'))
  assert.equal(textHasSkill('React.js and TS with RESTful APIs', 'React'), true)
  assert.equal(textHasSkill('React.js and TS with RESTful APIs', 'TypeScript'), true)
  assert.equal(textHasSkill('classical typography', 'CSS'), false)
  const changed = {...library.cvs, frontend:{...library.cvs.frontend, summary:'French bilingual communicator'}}
  assert.ok(createCvMatcher(changed)(job).scores.frontend.matched.includes('French'))
  assert.ok(score(job).scores.frontend.missing.includes('French'))
})

test('local deletion rolls back every record after a write failure and recovers interrupted writes', () => {
  const library = createDefaultLibrary()
  const values = new Map([['applytrack-master-cv', JSON.stringify(library)], ['job-tracker-applications', JSON.stringify([{ id: 'saved', status: 'saved', cvTrack: 'powerPlatform' }])], ['applytrack-saved-searches', '[]'], ['applytrack-inbox', '[]']])
  const before = new Map(values)
  let fail = true
  const storage = { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key), setItem: (key, value) => {
    if (key === 'applytrack-saved-searches' && fail) { fail = false; throw new Error('Disk full') }
    values.set(key, value)
  } }
  assert.throws(() => deleteLocalCv(storage, library, 'powerPlatform'), /Disk full/)
  assert.deepEqual(values, before)
  storage.setItem('applytrack-cv-library-transaction', JSON.stringify([...before.values()]))
  storage.setItem('applytrack-master-cv', '{}')
  recoverCvTransaction(storage)
  assert.deepEqual(values, before)
  assert.equal(deleteLocalCv(storage, library, 'powerPlatform').activeTrack, 'frontend')
})
