import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { jobRequirementEvaluation } from '../evaluation/job-requirements-synthetic.mjs'

const primaryModel = process.env.JOB_REQUIREMENT_BASELINE_MODEL || 'gemini-3.5-flash-lite'
const flashCandidate = process.env.JOB_REQUIREMENT_FLASH_CANDIDATE || 'gemini-3.8-flash'
const outputPath = resolve(process.argv[2] || 'evaluation/results/job-requirements-latest.json')
if (jobRequirementEvaluation.length < 30 || jobRequirementEvaluation.filter(row => row.split === 'held-out').length < 5) throw new Error('The evaluation needs at least 30 descriptions and five held-out cases.')
const pending = jobRequirementEvaluation.filter(row => row.annotationStatus !== 'reviewed' || !row.reviewedBy)
if (pending.length) throw new Error(`${pending.length} annotation records still need a human reviewer. No model requests were sent.`)
const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) throw new Error('Set GEMINI_API_KEY before running the live synthetic benchmark.')

const transpile = async (file) => {
  const source = await readFile(new URL(file, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { buildJobRequirementPrompt } = await transpile('../shared/jobRequirementPrompt.ts')
const { splitJobDescription } = await transpile('../shared/jobRequirements.ts')

const prices = {
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
}
const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()
const sameSet = (a, b) => JSON.stringify([...a].map(norm).sort()) === JSON.stringify([...b].map(norm).sort())

async function request(model, description) {
  const started = performance.now()
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildJobRequirementPrompt(splitJobDescription(description)) }] }],
        generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json' },
      }),
    })
    const elapsedMs = Math.round(performance.now() - started)
    if (!response.ok) return { error: `HTTP ${response.status}`, elapsedMs }
    const body = await response.json()
    const text = body.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('').trim() ?? ''
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '')
    let result
    try { result = JSON.parse(cleaned) } catch { return { error: 'invalid_json', elapsedMs, usage: body.usageMetadata } }
    return { result, elapsedMs, usage: body.usageMetadata }
  } catch (error) {
    return { error: error instanceof Error ? error.name : 'request_error', elapsedMs: Math.round(performance.now() - started) }
  }
}

function compare(expected, predicted) {
  const used = new Set()
  const links = new Map()
  for (const [index, want] of expected.entries()) {
    const wantParts = want.components ?? [want.label]
    let best = -1
    let bestExact = false
    for (const [candidateIndex, got] of predicted.entries()) {
      if (used.has(candidateIndex)) continue
      const parts = Array.isArray(got.components) && got.components.length ? got.components : [got.label]
      const exact = sameSet(wantParts, parts) || norm(want.label) === norm(got.label)
      const overlap = wantParts.filter(part => parts.some(other => norm(part) === norm(other))).length
      if (exact || overlap > best) { best = candidateIndex; bestExact = exact; if (exact) break }
    }
    if (best >= 0 && (bestExact || wantParts.some(part => (predicted[best]?.components ?? []).some(other => norm(part) === norm(other))))) {
      used.add(best); links.set(index, { predictedIndex: best, exact: bestExact })
    }
  }
  return links
}

function rate(model, row, sample) {
  const expected = row.requirements
  const result = sample.result
  const predicted = Array.isArray(result?.requirements) ? result.requirements : []
  const links = compare(expected, predicted)
  const extracted = predicted.length
  const parsedSections = Array.isArray(result?.sections) ? result.sections : []
  const predictedSectionIds = new Set(parsedSections.map(section => section?.id))
  const sections = splitJobDescription(row.description)
  const accountedSections = sections.filter(section => predictedSectionIds.has(section.id)).length
  const evidence = predicted.filter(item => {
    const source = sections.find(section => section.id === item.sourceSectionId)
    return typeof item.sourceQuote === 'string' && Boolean(source?.text.includes(item.sourceQuote))
  }).length
  const category = {}
  let groupCorrect = 0, qualifierCorrect = 0, linked = 0
  for (const [index, requirement] of expected.entries()) {
    const name = requirement.category
    category[name] ??= { expected: 0, found: 0 }
    category[name].expected++
    const match = links.get(index)
    if (match) {
      linked++
      const candidate = predicted[match.predictedIndex]
      if (candidate.category === name) category[name].found++
      if (requirement.logic === candidate.logic && sameSet(requirement.components, candidate.components ?? [])) groupCorrect++
      if (sameSet(requirement.constraints, candidate.constraints ?? [])) qualifierCorrect++
    }
  }
  for (const item of predicted) {
    const name = item.category
    category[name] ??= { expected: 0, predicted: 0, found: 0 }
    category[name].predicted++
  }
  const expectedCritical = expected.filter(item => item.critical)
  const criticalMisses = expectedCritical.filter(item => !expected.some((other, i) => other === item && links.has(i))).map(item => item.label)
  const usage = sample.usage ?? {}
  const price = prices[model]
  const inputTokens = usage.promptTokenCount ?? null
  const outputTokens = usage.candidatesTokenCount ?? null
  return {
    model, postingId: row.id, split: row.split, run: sample.run, error: sample.error ?? null,
    status: result?.sections?.every(section => ['requirements', 'context', 'uncertain'].includes(section.disposition)) &&
      predictedSectionIds.size === sections.length && accountedSections === sections.length &&
      sections.every(section => predictedSectionIds.has(section.id)) && parsedSections.every(section => section.disposition !== 'uncertain') &&
      predicted.length > 0 && evidence === predicted.length ? 'complete' : 'incomplete',
    expected: expected.length, predicted: extracted, found: links.size,
    precision: extracted ? links.size / extracted : 0, recall: expected.length ? links.size / expected.length : 0,
    category, groupAccuracy: linked ? groupCorrect / linked : 0, qualifierAccuracy: linked ? qualifierCorrect / linked : 0,
    validSourceEvidence: predicted ? evidence / Math.max(predicted.length, 1) : 0,
    sectionsAccounted: accountedSections / Math.max(sections.length, 1), criticalMisses,
    latencyMs: sample.elapsedMs, inputTokens, outputTokens,
    estimatedListCostUSD: price && inputTokens != null && outputTokens != null ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null,
  }
}

const rows = []
for (const row of jobRequirementEvaluation) {
  const repeats = row.split === 'held-out' ? 5 : 1
  for (const model of [primaryModel, flashCandidate]) {
    for (let run = 1; run <= repeats; run++) {
      const sample = await request(model, row.description)
      rows.push(rate(model, { ...row }, { ...sample, run }))
    }
  }
}

const byModel = Object.fromEntries([primaryModel, flashCandidate].map(model => {
  const selected = rows.filter(row => row.model === model)
  const average = key => selected.length ? selected.reduce((sum, item) => sum + Number(item[key] ?? 0), 0) / selected.length : 0
  const matched = selected.reduce((sum, item) => sum + item.found, 0)
  const expected = selected.reduce((sum, item) => sum + item.expected, 0)
  const predicted = selected.reduce((sum, item) => sum + item.predicted, 0)
  return [model, {
    attempts: selected.length,
    aggregatePrecision: predicted ? matched / predicted : 0,
    aggregateRecall: expected ? matched / expected : 0,
    meanGroupAccuracy: average('groupAccuracy'), meanQualifierAccuracy: average('qualifierAccuracy'),
    meanLatencyMs: average('latencyMs'), totalInputTokens: selected.reduce((n, item) => n + (item.inputTokens ?? 0), 0),
    totalOutputTokens: selected.reduce((n, item) => n + (item.outputTokens ?? 0), 0),
    estimatedListCostUSD: selected.reduce((n, item) => n + (item.estimatedListCostUSD ?? 0), 0),
    criticalMisses: selected.reduce((n, item) => n + item.criticalMisses.length, 0),
    byCategory: Object.fromEntries([...new Set(selected.flatMap(item => Object.keys(item.category)))].map(category => {
      const expectedCount = selected.reduce((n, item) => n + (item.category[category]?.expected ?? 0), 0)
      const foundCount = selected.reduce((n, item) => n + (item.category[category]?.found ?? 0), 0)
      const predictedCount = selected.reduce((n, item) => n + (item.category[category]?.predicted ?? 0), 0)
      return [category, {
        expected: expectedCount, predicted: predictedCount, found: foundCount,
        precision: predictedCount ? foundCount / predictedCount : 0,
        recall: expectedCount ? foundCount / expectedCount : 0,
      }]
    })),
  }]
}))
const report = {
  generatedAt: new Date().toISOString(),
  annotationSource: 'Human-reviewed public or synthetic descriptions only',
  promptComparison: 'Same source-backed prompt; current configured parsing model versus Flash candidate.',
  primaryModel, flashCandidate,
  pricingBasisUSDPerMillionTokens: { [primaryModel]: prices[primaryModel] ?? null, [flashCandidate]: prices[flashCandidate] ?? null },
  pricingNote: 'Estimated at published standard list prices; actual charges depend on account tier, rate plan and date.',
  summary: byModel,
  perPostingAndRun: rows,
}
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath, summary: byModel }, null, 2))
