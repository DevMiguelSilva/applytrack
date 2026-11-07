import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/MasterCvPage.tsx', import.meta.url), 'utf8')

test('experience date fields stay stacked until a wide card can fit native month controls', () => {
  const split = css.indexOf('@container cv-entry (min-width: 520px)')
  assert.notEqual(split, -1)
  const threeColumns = css.indexOf('.cv-experience-dates { grid-template-columns: repeat(3, minmax(0, 1fr));', split)
  assert.notEqual(threeColumns, -1)
  assert.equal(css.slice(0, split).includes('.cv-experience-dates { grid-template-columns: repeat(3, minmax(0, 1fr));'), false)
  assert.match(css, /\.cv-experience-fields, \.cv-project-fields, \.cv-education-fields \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/)
})

test('date fields retain native month inputs, accessible labels, and current-role disabling', () => {
  assert.match(page, /type="month"[\s\S]{0,100}aria-label=\{label\}/)
  assert.match(page, /<MonthField label="Start month"[^>]*className="cv-experience-date-input"/)
  assert.match(page, /<MonthField label="End month" value=\{exp\.end\} disabled=\{exp\.current\} className="cv-experience-date-input"/)
  assert.match(css, /\.cv-experience-date-input \{ box-sizing: border-box; display: block; width: 100%; min-width: 0; max-width: 100%; height: 44px; \}/)
  assert.match(css, /@supports \(-webkit-touch-callout: none\) \{\s+\.cv-experience-date-input \{ -webkit-appearance: none; appearance: none; \}/)
})
