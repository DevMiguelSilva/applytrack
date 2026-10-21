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

const cvTypesUrl = moduleUrl('../src/types/cv.ts')
const { formatCvDate, formatEducationDisplayDates } = await import(cvTypesUrl)

test('formats valid month dates and recognized ranges while retaining legacy text', () => {
  assert.equal(formatCvDate('2026-05'), 'May 2026')
  assert.equal(formatCvDate('2026-5'), 'May 2026')
  assert.equal(formatCvDate('2026-5 – 2026-11'), 'May 2026 – November 2026')
  assert.equal(formatCvDate('2026-5 - 2026-11'), 'May 2026 - November 2026')
  assert.equal(formatCvDate('2026-5 - Present'), 'May 2026 - Present')
  assert.equal(formatCvDate('2020 - 2022'), '2020 - 2022')
  assert.equal(formatCvDate('2026'), '2026')
  assert.equal(formatCvDate(''), '')
  for (const value of ['2026-0', '2026-13', '20x6-5', 'Spring 2026-5', '2026-13 - 2027-5']) {
    assert.equal(formatCvDate(value), value)
  }
})

test('formats education dates without mutating stored/native-input values', () => {
  const education = { id: 'degree', school: 'Example', degree: 'BA', start: '2020-9', end: '2024-6' }
  const before = JSON.stringify(education)
  assert.equal(formatEducationDisplayDates(education), 'September 2020 - June 2024')
  assert.equal(formatEducationDisplayDates(education, ' – '), 'September 2020 – June 2024')
  assert.equal(JSON.stringify(education), before)
  assert.equal(formatEducationDisplayDates({ ...education, start: '', end: '', year: '2026-5 – 2027-6' }), 'May 2026 – June 2027')
  assert.equal(formatEducationDisplayDates({ ...education, start: '', end: '', year: '2020 - 2022' }), '2020 - 2022')
  assert.equal(formatEducationDisplayDates({ ...education, start: '2026-5', end: 'legacy text' }), 'May 2026 - legacy text')
  assert.equal(formatEducationDisplayDates({ ...education, start: '', end: '', year: '2020' }), '2020')
  assert.equal(formatEducationDisplayDates({ ...education, start: '', end: '', year: '' }), '')
})

test('DOCX and print outputs format dates across experience, education, and certifications', async () => {
  const exporter = await import(moduleUrl('../src/lib/docxExport.ts', {
    "'docx'": JSON.stringify(import.meta.resolve('docx')),
    "'jszip'": JSON.stringify(import.meta.resolve('jszip')),
    '../types/cv': cvTypesUrl,
  }))
  const JSZip = (await import('jszip')).default
  const cv = {
    contact: { name: 'Synthetic Candidate', email: '', phone: '', location: '', links: [] },
    headline: '', summary: '', skills: [], projects: [], updatedAt: '',
    experience: [
      { id: 'role', company: 'Example Co', title: 'Engineer', location: '', start: '2026-5', end: '2026-6', current: false, bullets: [] },
      { id: 'current-role', company: 'Current Co', title: 'Developer', location: '', start: '2025-1', end: 'legacy ignored', current: true, bullets: [] },
      { id: 'legacy-role', company: 'Legacy Co', title: 'Analyst', location: '', start: '2020', end: '2022', current: false, bullets: [] },
    ],
    education: [
      { id: 'degree', school: 'Example University', degree: 'BA', start: '2020-9', end: '2024-6' },
      { id: 'legacy-degree', school: 'Old College', degree: 'Certificate', start: '', end: '', year: '2018' },
    ],
    certifications: [
      { id: 'cert', name: 'Credential', issuer: 'Issuer', year: '2026-8' },
      { id: 'legacy-cert-range', name: 'Earlier credential', issuer: '', year: '2020 - 2022' },
      { id: 'legacy-cert', name: 'Legacy credential', issuer: '', year: 'in progress' },
    ],
  }
  const before = JSON.stringify(cv)
  const zip = await JSZip.loadAsync(await (await exporter.buildCvDocxBlob(cv)).arrayBuffer())
  const xml = await zip.file('word/document.xml').async('string')
  for (const text of ['May 2026', 'May 2026 - June 2026', 'Present', 'September 2020', 'June 2024', 'August 2026', '2018', '2020 - 2022', 'in progress']) {
    assert.ok(xml.includes(text), `DOCX should contain ${text}`)
  }
  for (const text of ['2026-5', '2026-6', '2020-9', '2024-6', '2026-8']) assert.ok(!xml.includes(text), `DOCX should not contain raw ${text}`)

  const oldWindow = globalThis.window
  let html = ''
  globalThis.window = { open: () => ({ document: { open() {}, write(value) { html = value }, close() {} }, focus() {}, print() {} }) }
  try {
    exporter.openCvPrintWindow(cv, 'Synthetic CV')
  } finally {
    globalThis.window = oldWindow
  }
  for (const text of ['May 2026 - June 2026', 'January 2025 - Present', '2020 - 2022', 'September 2020 - June 2024', 'August 2026', '2018', 'in progress']) {
    assert.ok(html.includes(text), `Print view should contain ${text}`)
  }
  for (const text of ['2026-5', '2026-6', '2020-9', '2024-6', '2026-8']) assert.ok(!html.includes(text), `Print view should not contain raw ${text}`)
  assert.equal(JSON.stringify(cv), before)
})
