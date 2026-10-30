export interface SkillJobContext {
  role: string
  description: string
  skills: string[]
  requirements: string[]
}

/** Only posting data is sent; personal notes, CVs and application metadata are excluded. */
export function buildSkillJobContext(skill: string, job: { role: string; jobDescription: string; extractedSkills: string[]; extractedRequirements: string[] }): SkillJobContext {
  const description = job.jobDescription || ''
  const needle = skill.trim().toLowerCase()
  const relevant = needle ? description.split(/\n+/).filter(line => line.toLowerCase().includes(needle)).map(line => {
    const start = Math.max(0, line.toLowerCase().indexOf(needle) - 200)
    return line.slice(start, start + 500)
  }).join('\n').slice(0, 1800) : ''
  const relevantFirst = (items: string[]) => [...items.filter(value => needle && value.toLowerCase().includes(needle)), ...items.filter(value => !needle || !value.toLowerCase().includes(needle))].slice(0, 12).map(value => value.slice(0, 160))
  return {
    role: (job.role || '').slice(0, 160),
    description: [description.slice(0, 1600), relevant].filter(Boolean).join('\n').slice(0, 3401),
    skills: relevantFirst(job.extractedSkills || []),
    requirements: relevantFirst(job.extractedRequirements || []),
  }
}

export function skillJobContextKey(job: { role: string; jobDescription: string; extractedSkills: string[]; extractedRequirements: string[] }): string {
  return JSON.stringify([job.role, job.jobDescription, job.extractedSkills, job.extractedRequirements])
}

export function validSkillJobContext(value: unknown): value is SkillJobContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const context = value as Record<string, unknown>
  const list = (items: unknown) => Array.isArray(items) && items.length <= 12 && items.every(item => typeof item === 'string' && item.length <= 160)
  return typeof context.role === 'string' && context.role.length <= 160 && typeof context.description === 'string' && context.description.length <= 3401 && list(context.skills) && list(context.requirements)
}
