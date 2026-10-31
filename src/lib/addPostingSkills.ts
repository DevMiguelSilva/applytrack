import type { MasterCv, CvSkillGroup } from '../types/cv'

const keyOf = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

/** Add only the names the user selected, preserving every current group and item. */
export function addPostingSkillsToCv(cv: MasterCv, selected: string[]): MasterCv {
  const existing = new Set(cv.skills.flatMap((group) => group.items.map(keyOf)))
  const additions = selected.map((skill) => skill.trim().replace(/\s+/g, ' '))
    .filter((skill, index, all) => skill && !existing.has(keyOf(skill)) && all.findIndex((item) => keyOf(item) === keyOf(skill)) === index)
  if (!additions.length) return cv

  if (!cv.skills.length) {
    const group: CvSkillGroup = { id: crypto.randomUUID(), group: 'Skills', items: additions }
    return { ...cv, skills: [group] }
  }
  const index = cv.skills.findIndex((group) => /^(additional|other|skills)$/i.test(group.group.trim()))
  if (index < 0) {
    return { ...cv, skills: [...cv.skills, { id: crypto.randomUUID(), group: 'Additional', items: additions }] }
  }
  return {
    ...cv,
    skills: cv.skills.map((group, groupIndex) => groupIndex === index
      ? { ...group, items: [...group.items, ...additions] }
      : group),
  }
}
