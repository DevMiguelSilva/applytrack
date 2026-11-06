import type { CvExperience } from '../types/cv'

export function prependCvExperience(experience: CvExperience[], item: CvExperience): CvExperience[] {
  return [item, ...experience]
}

export function updateCvExperienceById(
  experience: CvExperience[],
  id: string,
  update: (item: CvExperience) => CvExperience,
): CvExperience[] {
  return experience.map((item) => item.id === id ? update(item) : item)
}
