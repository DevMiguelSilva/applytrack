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
const requirementsUrl = moduleUrl('../shared/jobRequirements.ts')
const skillLabelUrl = `data:text/javascript;base64,${Buffer.from('export const requirementSkillLabel = requirement => requirement.label').toString('base64')}`
const mutationUrl = moduleUrl('../src/lib/localMutation.ts')
const sharedUrl = moduleUrl('../src/lib/sharedCv.ts', { '../types/cv': typesUrl })
const importUrl = moduleUrl('../src/lib/resumeImport.ts', { '../types/cv': typesUrl })
const { createDefaultLibrary, createEmptyMasterCv, normalizeLibrary, cleanMasterCvEntries } = await import(typesUrl)
const { addCvTemplate, removeCvTemplate, deleteLocalCv, resolveJobCv, recoverCvTransaction } = await import(moduleUrl('../src/lib/cvLibrary.ts', { '../types/cv': typesUrl, './localMutation': mutationUrl, './sharedCv': sharedUrl }))
const { migrateCloudSharedCv, migrateLocalSharedCv, migrateSharedCv, saveSharedCv } = await import(sharedUrl)
const { mergeParsedCv } = await import(importUrl)
const { scoreDualTracks, createCvMatcher, textHasSkill } = await import(moduleUrl('../src/lib/matchScore.ts', { '../types/cv': typesUrl, './localMutation': mutationUrl, '../../shared/jobRequirements': requirementsUrl, './jobSkills': skillLabelUrl }))

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

test('migration retains the original and keeps ambiguous roles and highlights separate', () => {
  const original = createDefaultLibrary()
  original.cvs.powerPlatform.contact.name = 'Shared name'
  original.cvs.frontend.contact.name = 'Former name'
  const role = { id: 'same-id', company: 'Example', title: 'Developer', location: 'Remote', start: '2020', end: '', current: true, bullets: [{ id: 'bullet', text: 'First', tags: [] }] }
  original.cvs.powerPlatform.experience = [role]
  original.cvs.frontend.experience = [{ ...role, bullets: [{ id: 'other', text: 'Second', tags: [] }] }]
  const migrated = migrateSharedCv(original)
  assert.deepEqual(migrated.sharedDetails.original, original)
  assert.equal(migrated.cvs.frontend.contact.name, 'Shared name')
  assert.notEqual(migrated.cvs.frontend.experience[0].id, migrated.cvs.powerPlatform.experience[0].id)
  assert.equal(migrated.cvs.frontend.experience[0].bullets[0].text, 'Second')
  assert.deepEqual(normalizeLibrary(migrated), migrated)
  const missing = structuredClone(original); delete missing.cvs.powerPlatform; delete missing.names.powerPlatform
  assert.throws(() => migrateSharedCv(missing), /Power Platform/)
})

test('shared saves propagate facts and role deletion without changing other highlights', () => {
  const source = createDefaultLibrary()
  source.cvs.powerPlatform.experience = [{ id:'r', company:'Before', title:'Engineer', location:'', start:'2020', end:'', current:true, bullets:[{id:'a',text:'Original',tags:[]}] }]
  const migrated = migrateSharedCv(source)
  const role = migrated.cvs.powerPlatform.experience[0]
  migrated.cvs.frontend.experience = [{...role, bullets:[{id:'b',text:'Different',tags:[]}]}]
  const edit = structuredClone(migrated.cvs.powerPlatform)
  edit.experience[0].company = 'After'
  edit.contact.email = 'shared@example.test'
  edit.education = []
  const saved = saveSharedCv(migrated, 'powerPlatform', edit)
  assert.equal(saved.cvs.frontend.experience[0].company, 'After')
  assert.equal(saved.cvs.frontend.experience[0].bullets[0].text, 'Different')
  assert.equal(saved.cvs.frontend.contact.email, 'shared@example.test')
  const removed = saveSharedCv(saved, 'powerPlatform', {...saved.cvs.powerPlatform, experience: []})
  assert.equal(removed.cvs.frontend.experience.length, 0)
  assert.equal(removed.sharedDetails.roles.some(entry => entry.id === role.id), false)
  const blank = addCvTemplate(removed, 'Blank')
  assert.equal(blank.cvs[blank.activeTrack].contact.email, 'shared@example.test')
  assert.deepEqual(blank.cvs[blank.activeTrack].experience, [])
  const copy = addCvTemplate(saved, 'Copy', 'frontend')
  assert.equal(copy.cvs[copy.activeTrack].experience[0].id, role.id)
})

test('new roles appear in existing profiles with independent highlights, and subsequent edits share their facts', () => {
  const library = migrateSharedCv(createDefaultLibrary())
  const initial = structuredClone(library.cvs.powerPlatform)
  initial.experience.push({ id:'new-role', company:'Example', title:'Engineer', location:'Remote', start:'2022', end:'', current:true,
    bullets:[{id:'first-highlight', text:'Platform work', tags:[]}] })
  const saved = saveSharedCv(library, 'powerPlatform', initial)
  assert.equal(saved.cvs.frontend.experience[0].id, 'new-role')
  assert.deepEqual(saved.cvs.frontend.experience[0].bullets, [])
  const frontend = structuredClone(saved.cvs.frontend)
  frontend.experience[0].title = 'Senior Engineer'
  frontend.experience[0].bullets = [{id:'second-highlight', text:'React work', tags:[]}]
  const edited = saveSharedCv(saved, 'frontend', frontend)
  const submittedSnapshot = structuredClone(edited.cvs.powerPlatform)
  assert.equal(edited.cvs.powerPlatform.experience[0].title, 'Senior Engineer')
  assert.equal(edited.cvs.powerPlatform.experience[0].bullets[0].text, 'Platform work')
  assert.equal(edited.cvs.frontend.experience[0].bullets[0].text, 'React work')
  const removed = saveSharedCv(edited, 'frontend', {...edited.cvs.frontend, experience:[]})
  assert.equal(edited.cvs.powerPlatform.experience.length, 1)
  assert.equal(submittedSnapshot.experience[0].bullets[0].text, 'Platform work')
  assert.equal(resolveJobCv(removed, {status:'applied'}, {masterCvSnapshot:submittedSnapshot}), submittedSnapshot)
  const later = saveSharedCv(removed, 'powerPlatform', removed.cvs.powerPlatform)
  assert.equal(later.cvs.frontend.experience.length, 0)
  assert.equal(later.cvs.powerPlatform.experience.length, 0)
  assert.equal(later.sharedDetails.roles.some(entry => entry.id === 'new-role'), false)
})

test('local migration secures the original before writing and can retry a failed migration', () => {
  const original = JSON.stringify(createDefaultLibrary())
  const values = new Map([['applytrack-master-cv', original]])
  let failBackup = true, failMigration = false
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => {
    if (key.endsWith('before-shared-v1') && failBackup) throw new Error('Backup failed')
    if (key === 'applytrack-master-cv' && failMigration) throw new Error('Write failed')
    values.set(key, value)
  } }
  assert.throws(() => migrateLocalSharedCv(storage), /Backup failed/)
  assert.equal(values.get('applytrack-master-cv'), original)
  failBackup = false; failMigration = true
  assert.throws(() => migrateLocalSharedCv(storage), /Write failed/)
  assert.equal(values.get('applytrack-master-cv'), original)
  assert.equal(values.get('applytrack-master-cv-before-shared-v1'), original)
  failMigration = false
  const migrated = migrateLocalSharedCv(storage)
  assert.deepEqual(migrated.sharedDetails.original, JSON.parse(original))
  assert.deepEqual(migrateLocalSharedCv(storage), migrated)
})

test('cloud migration requires a verified backup and rejects conflicts or account changes', async () => {
  const original = createDefaultLibrary()
  let stored = structuredClone(original), revision = '1', writes = 0, active = true
  const write = async (document, expected) => {
    writes++
    if (expected !== revision) return null
    stored = structuredClone(document); revision = '2'
    return {document: stored, revision}
  }
  await assert.rejects(migrateCloudSharedCv(original, 'stale', write, () => active), /backup/)
  assert.deepEqual(stored, original)
  const prepared = await migrateCloudSharedCv(original, '1', write, () => active)
  assert.deepEqual(stored.sharedMigrationBackup, original)
  assert.deepEqual(prepared.library.sharedDetails.original, original)
  assert.equal(prepared.revision, '2')
  const retried = await migrateCloudSharedCv(stored, '2', write, () => active)
  assert.deepEqual(retried.library.sharedDetails.original, original)
  assert.equal(writes, 2)
  active = false
  await assert.rejects(migrateCloudSharedCv(stored, '2', write, () => active), /account changed/)
  assert.equal(writes, 2)
})

test('import review stays in memory until saved and snapshots remain unchanged after shared edits', () => {
  const library = migrateSharedCv(createDefaultLibrary())
  const snapshot = structuredClone(library.cvs.powerPlatform)
  const draft = mergeParsedCv(library.cvs.powerPlatform, {contact: {...snapshot.contact, email:'import@example.test'}})
  assert.notEqual(library.cvs.frontend.contact.email, draft.contact.email)
  const saved = saveSharedCv(library, 'powerPlatform', draft)
  assert.equal(saved.cvs.frontend.contact.email, 'import@example.test')
  assert.equal(resolveJobCv(saved, {status:'applied'}, {masterCvSnapshot:snapshot}), snapshot)
  assert.notEqual(snapshot.contact.email, saved.cvs.frontend.contact.email)
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
  for (const status of ['applied', 'interview', 'offer', 'rejected']) {
    assert.equal(resolveJobCv(next.library,{...jobs[1],status},{masterCvSnapshot:snapshot}),snapshot)
  }
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
