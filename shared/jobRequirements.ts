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
  if (!value || typeof value !== 'object') return false
  const a = value as Partial<JobRequirementAnalysis>
  if (a.schemaVersion !== 1 || typeof a.sourceHash !== 'string' || typeof a.sourceLength !== 'number' ||
      (a.status !== 'complete' && a.status !== 'incomplete') || typeof a.modelId !== 'string' ||
      typeof a.analyzedAt !== 'string' || !Array.isArray(a.sections) || a.sections.length > MAX_SECTIONS ||
      !Array.isArray(a.requirements) || a.requirements.length > MAX_REQUIREMENTS) return false
  if (sourceText !== undefined && (a.sourceHash !== jobDescriptionHash(sourceText) || a.sourceLength !== sourceText.length)) return false
  const sectionIds = new Set<string>()
  const sourceSections = sourceText === undefined ? null : new Map(splitJobDescription(sourceText).map(({ id, text }) => [id, text]))
  for (const section of a.sections) {
    if (!section || typeof section.id !== 'string' || sectionIds.has(section.id) || !['requirements', 'context', 'uncertain'].includes(section.disposition)) return false
    sectionIds.add(section.id)
  }
  const ids = new Set<string>()
  for (const item of a.requirements) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim() ||
        !Array.isArray(item.components) || !item.components.length || item.components.length > 12 || item.components.some((x) => typeof x !== 'string' || !x.trim() || x.length > 160) ||
        (item.logic !== 'all' && item.logic !== 'any') || typeof item.sourceSectionId !== 'string' || !sectionIds.has(item.sourceSectionId) ||
        typeof item.sourceQuote !== 'string' || !item.sourceQuote.trim() || item.sourceQuote.length > 1200 || !categories.has(item.category!) ||
        !['required', 'preferred', 'unclear'].includes(item.importance!) || !Array.isArray(item.constraints) || item.constraints.length > 12 ||
        item.constraints.some((x) => typeof x !== 'string' || x.length > 160)) return false
    if (sourceText !== undefined && (!sourceText.includes(item.sourceQuote) || !sourceSections?.get(item.sourceSectionId)?.includes(item.sourceQuote))) return false
    ids.add(item.id)
  }
  if (a.status === 'complete' && (a.sections.length === 0 || a.sections.some((s) => s.disposition === 'uncertain'))) return false
  return true
}
