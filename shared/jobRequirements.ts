export type RequirementImportance = 'required' | 'preferred' | 'unclear'
export type RequirementCategory = 'technical' | 'experience' | 'education' | 'certification' | 'language' | 'responsibility' | 'eligibility' | 'other'
export type RequirementAnalysisStatus = 'complete' | 'incomplete'

export interface JobRequirement {
  id: string
  label: string
  components: string[]
  logic: 'all' | 'any'
  sourceSectionId: string
  sourceQuote: string
  category: RequirementCategory
  importance: RequirementImportance
  constraints: string[]
}

export interface JobRequirementSection {
  id: string
  disposition: 'requirements' | 'context' | 'uncertain'
}

export interface JobRequirementAnalysis {
  schemaVersion: 1
  sourceHash: string
  sourceLength: number
  status: RequirementAnalysisStatus
  statusReason?: string
  modelId: string
  analyzedAt: string
  sections: JobRequirementSection[]
  requirements: JobRequirement[]
}

export const MAX_ANALYZED_JOB_DESCRIPTION = 60000
export const MAX_REQUIREMENTS = 240
export const MAX_SECTIONS = 240

export function incompleteJobRequirementAnalysis(text: string, reason: string): JobRequirementAnalysis {
  return {
    schemaVersion: 1,
    sourceHash: jobDescriptionHash(text),
    sourceLength: text.length,
    status: 'incomplete',
    statusReason: reason,
    modelId: 'unavailable',
    analyzedAt: new Date().toISOString(),
    sections: [],
    requirements: [],
  }
}

/** Stable content key used to reject analyses after even a small posting edit. */
export function jobDescriptionHash(text: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ (c + i), 0x85ebca6b)
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

export function splitJobDescription(text: string): { id: string; text: string }[] {
  const parts = text.split(/\r?\n\s*\r?\n|\r?\n(?=\s*(?:[-*•]|\d+[.)]|#{1,6}\s))/g)
    .map((part) => part.trim()).filter(Boolean)
  return parts.slice(0, MAX_SECTIONS).map((part, index) => ({ id: `s${index + 1}`, text: part }))
}

const categories = new Set<RequirementCategory>(['technical', 'experience', 'education', 'certification', 'language', 'responsibility', 'eligibility', 'other'])

export function validJobRequirementAnalysis(value: unknown, sourceText?: string): value is JobRequirementAnalysis {
  return jobRequirementAnalysisValidationIssues(value, sourceText).length === 0
}

/** Return stable, value-free paths for repair prompts and diagnostics. */
export function jobRequirementAnalysisValidationIssues(value: unknown, sourceText?: string): string[] {
  if (!value || typeof value !== 'object') return ['analysis.not_object']
  const a = value as Partial<JobRequirementAnalysis>
  const issues: string[] = []
  const add = (code: string) => issues.push(code)
  if (a.schemaVersion !== 1) add('analysis.schema_version.invalid')
  if (typeof a.sourceHash !== 'string') add('analysis.source_hash.invalid')
  if (typeof a.sourceLength !== 'number') add('analysis.source_length.invalid')
  if (a.status !== 'complete' && a.status !== 'incomplete') add('analysis.status.invalid')
  if (typeof a.modelId !== 'string') add('analysis.model_id.invalid')
  if (typeof a.analyzedAt !== 'string') add('analysis.analyzed_at.invalid')
  if (!Array.isArray(a.sections)) add('sections.not_array')
  else if (a.sections.length > MAX_SECTIONS) add('sections.too_many')
  if (!Array.isArray(a.requirements)) add('requirements.not_array')
  else if (a.requirements.length > MAX_REQUIREMENTS) add('requirements.too_many')
  if (!Array.isArray(a.sections) || !Array.isArray(a.requirements) || a.sections.length > MAX_SECTIONS || a.requirements.length > MAX_REQUIREMENTS) return issues
  if (sourceText !== undefined && a.sourceHash !== jobDescriptionHash(sourceText)) add('analysis.source_hash.mismatch')
  if (sourceText !== undefined && a.sourceLength !== sourceText.length) add('analysis.source_length.mismatch')
  const sectionIds = new Set<string>()
  const sourceSections = sourceText === undefined ? null : new Map(splitJobDescription(sourceText).map(({ id, text }) => [id, text]))
  for (const [index, section] of a.sections.entries()) {
    if (!section || typeof section !== 'object') {
      add(`sections[${index}].invalid`)
      continue
    }
    if (typeof section.id !== 'string') add(`sections[${index}].id.invalid`)
    else if (sectionIds.has(section.id)) add(`sections[${index}].id.duplicate`)
    if (!['requirements', 'context', 'uncertain'].includes(section.disposition)) add(`sections[${index}].disposition.invalid`)
    if (typeof section.id !== 'string' || sectionIds.has(section.id) || !['requirements', 'context', 'uncertain'].includes(section.disposition)) continue
    sectionIds.add(section.id)
  }
  const ids = new Set<string>()
  for (const [index, item] of a.requirements.entries()) {
    if (!item || typeof item !== 'object') {
      add(`requirements[${index}].invalid`)
      continue
    }
    if (typeof item.id !== 'string') add(`requirements[${index}].id.invalid`)
    else if (ids.has(item.id)) add(`requirements[${index}].id.duplicate`)
    if (typeof item.label !== 'string' || !item.label.trim()) add(`requirements[${index}].label.invalid`)
    if (!Array.isArray(item.components)) add(`requirements[${index}].components.not_array`)
    else {
      if (!item.components.length) add(`requirements[${index}].components.empty`)
      if (item.components.length > 12) add(`requirements[${index}].components.too_many`)
      if (item.components.some((x) => typeof x !== 'string' || !x.trim() || x.length > 160)) add(`requirements[${index}].components.item_invalid`)
    }
    if (item.logic !== 'all' && item.logic !== 'any') add(`requirements[${index}].logic.invalid`)
    if (typeof item.sourceSectionId !== 'string') add(`requirements[${index}].source_section_id.invalid`)
    else if (!sectionIds.has(item.sourceSectionId)) add(`requirements[${index}].source_section_id.unknown`)
    if (typeof item.sourceQuote !== 'string' || !item.sourceQuote.trim()) add(`requirements[${index}].source_quote.invalid`)
    else if (item.sourceQuote.length > 1200) add(`requirements[${index}].source_quote.too_long`)
    if (!categories.has(item.category!)) add(`requirements[${index}].category.invalid`)
    if (!['required', 'preferred', 'unclear'].includes(item.importance!)) add(`requirements[${index}].importance.invalid`)
    if (!Array.isArray(item.constraints)) add(`requirements[${index}].constraints.not_array`)
    else {
      if (item.constraints.length > 12) add(`requirements[${index}].constraints.too_many`)
      if (item.constraints.some((x) => typeof x !== 'string' || x.length > 160)) add(`requirements[${index}].constraints.item_invalid`)
    }
    if (sourceText !== undefined && typeof item.sourceQuote === 'string' && item.sourceQuote.trim()) {
      if (!sourceText.includes(item.sourceQuote)) add(`requirements[${index}].source_quote.not_in_source`)
      if (typeof item.sourceSectionId === 'string' && !sourceSections?.get(item.sourceSectionId)?.includes(item.sourceQuote)) add(`requirements[${index}].source_quote.not_in_section`)
    }
    if (typeof item.id === 'string' && !ids.has(item.id)) ids.add(item.id)
  }
  if (a.status === 'complete' && a.sections.length === 0) add('analysis.complete_without_sections')
  if (a.status === 'complete' && a.sections.some((s) => s?.disposition === 'uncertain')) add('analysis.complete_with_uncertain_section')
  return issues
}

/** Reuse a stored complete analysis only when its exact source text is unchanged. */
export function reusableJobRequirementAnalysis(
  description: string,
  existingDescription: string,
  analysis: unknown
): analysis is JobRequirementAnalysis {
  return description === existingDescription &&
    validJobRequirementAnalysis(analysis, description) &&
    analysis.status === 'complete'
}
