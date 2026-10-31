import type { JobRequirementAnalysis, JobRequirement } from '../../shared/jobRequirements'

function normalizeSkillName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
    .replace(/^(?:experience\s+(?:with|in)|knowledge\s+of|familiarity\s+with|familiar\s+with|proficiency\s+in|proficient\s+in|skills?\s+in|ability\s+to\s+use|using)\s+/i, '')
    .replace(/^[,;:\s]+|[.;,\s]+$/g, '')
}

/** Render skill components as short names while source evidence stays in the detail tooltip. */
export function requirementSkillLabel(requirement: JobRequirement): string {
  if (requirement.category !== 'technical' && requirement.category !== 'language') return requirement.label
  const components = requirement.components.map(normalizeSkillName).filter(Boolean)
  if (!components.length) return requirement.label
  return components.join(requirement.logic === 'any' ? ' / ' : ' + ')
}

/** The skills a user may add to a CV; never turn a responsibility or credential into a skill. */
export function postingSkillNames(analysis: JobRequirementAnalysis | null | undefined, fallback: string[] = []): string[] {
  const values = analysis
    ? analysis.schemaVersion === 2 && analysis.status === 'complete'
      ? analysis.requirements
      .filter((item) => item.category === 'technical' || item.category === 'language')
      .flatMap((item) => item.components)
      : []
    : fallback
  const seen = new Set<string>()
  return values.flatMap((raw) => {
    const value = normalizeSkillName(raw)
    const key = value.toLowerCase()
    if (!value || seen.has(key)) return []
    seen.add(key)
    return [value]
  })
}
