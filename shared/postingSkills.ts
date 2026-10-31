import type { JobRequirement } from './jobRequirements'

// These are useful source-backed requirements in context, but are too broad to
// present as standalone skills in Posting overview or Gap Check.
const genericSkillLabels = new Set([
  'architect',
  'channel',
  'channels',
  'custom action and tool',
  'custom actions and tools',
  'language',
  'languages',
  'tool',
  'tools',
])

function skillKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()
}

/**
 * Project concise, specific technical skills from the full qualification analysis.
 * Spoken-language requirements and broad posting terms remain in the source-backed
 * requirements; they are not useful as standalone skill chips.
 */
export function postingSkillsFromRequirements(requirements: JobRequirement[], role = ''): string[] {
  const languageTerms = requirements
    .filter((requirement) => requirement.category === 'language')
    .flatMap((requirement) => requirement.components)
  return filterPostingSkillLabels(
    requirements.filter((requirement) => requirement.category === 'technical').flatMap((requirement) => requirement.components),
    role,
    languageTerms
  )
}

export function filterPostingSkillLabels(labels: string[], role = '', languageTerms: string[] = []): string[] {
  const roleKey = skillKey(role)
  const languageKeys = new Set(languageTerms.map(skillKey))
  const seen = new Set<string>()
  const skills: string[] = []
  for (const raw of labels) {
    const label = raw.trim()
    const key = skillKey(label)
    if (!key || genericSkillLabels.has(key) || key === roleKey || languageKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    skills.push(label)
  }
  return skills
}
