import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function moduleUrl(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const { createEmptyMasterCv } = await import(moduleUrl('../src/types/cv.ts'))
const { cvItemSignature, cvItemRevisionMatches, isUntouchedEmptyCvItem, removeCvItemById } = await import(moduleUrl('../src/lib/cvItemDeletion.ts'))
const scope = { account: 'account-a', track: 'cv-a', session: 3 }
const emptyRows = {
  skillGroup: { id: 'group', group: 'Group', items: [] },
  experience: { id: 'role', company: '', title: '', location: '', start: '', end: '', current: false, bullets: [{ id: 'bullet', text: '', tags: [] }] },
  project: { id: 'project', name: '', url: '', bullets: [{ id: 'project-bullet', text: '', tags: [] }] },
  education: { id: 'education', school: '', degree: '', start: '', end: '' },
  certification: { id: 'certification', name: '', issuer: '', year: '' },
}

test('only exact, untouched Add initializers from this account, CV and editor session bypass confirmation', () => {
  for (const item of Object.values(emptyRows)) {
    const provenance = { ...scope, initial: cvItemSignature(item), touched: false, revision: 0 }
    assert.equal(isUntouchedEmptyCvItem(item, provenance, scope), true)
    assert.equal(isUntouchedEmptyCvItem(item, { ...provenance, account: 'other-account' }, scope), false)
    assert.equal(isUntouchedEmptyCvItem(item, { ...provenance, track: 'other-cv' }, scope), false)
    assert.equal(isUntouchedEmptyCvItem(item, { ...provenance, session: 2 }, scope), false)
    assert.equal(isUntouchedEmptyCvItem(item, { ...provenance, touched: true }, scope), false)
    assert.equal(isUntouchedEmptyCvItem({ ...item, id: `${item.id}-imported` }, undefined, scope), false)
  }
})

test('revisions and row ordering invalidate a stale confirmation', () => {
  const cv = createEmptyMasterCv({
    skills: [{ ...emptyRows.skillGroup }, { id: 'other', group: 'Tools', items: ['Git'] }],
  })
  const captured = { kind: 'skillGroup', id: 'group', revision: 2, orderSignature: 'group\u0000other' }
  assert.equal(cvItemRevisionMatches(cv, captured, 2), true)
  assert.equal(cvItemRevisionMatches(cv, captured, 3), false)
  assert.equal(cvItemRevisionMatches(cv, { ...captured, orderSignature: 'other\u0000group' }, 2), false)
  assert.equal(cvItemRevisionMatches(cv, { ...captured, id: 'missing' }, 2), false)
})

test('removal filters one stable ID and retains every unrelated section and entry', () => {
  const cv = createEmptyMasterCv({
    skills: [{ ...emptyRows.skillGroup }, { id: 'keep-group', group: 'Tools', items: ['Git'] }],
    experience: [{ ...emptyRows.experience }, { id: 'keep-role', company: 'Acme', title: 'Engineer', location: '', start: '', end: '', current: false, bullets: [] }],
    projects: [{ ...emptyRows.project }, { id: 'keep-project', name: 'Portfolio', url: '', bullets: [] }],
    education: [{ ...emptyRows.education }, { id: 'keep-education', school: 'College', degree: 'BA', start: '', end: '' }],
    certifications: [{ ...emptyRows.certification }, { id: 'keep-certification', name: 'PL-900', issuer: 'Microsoft', year: '' }],
  })
  for (const [kind, key, id] of [
    ['skillGroup', 'skills', 'group'], ['experience', 'experience', 'role'], ['project', 'projects', 'project'],
    ['education', 'education', 'education'], ['certification', 'certifications', 'certification'],
  ]) {
    const next = removeCvItemById(cv, kind, id)
    assert.deepEqual(next[key].map((item) => item.id), [`keep-${kind === 'skillGroup' ? 'group' : kind === 'experience' ? 'role' : kind}`])
    for (const otherKey of ['skills', 'experience', 'projects', 'education', 'certifications']) {
      if (otherKey !== key) assert.equal(next[otherKey], cv[otherKey])
    }
  }
})
