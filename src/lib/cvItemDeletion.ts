import type { CvCertification, CvEducation, CvExperience, CvProject, CvSkillGroup, MasterCv } from '../types/cv'

export type CvItemKind = 'skillGroup' | 'experience' | 'project' | 'education' | 'certification'

export type CvItem = CvSkillGroup | CvExperience | CvProject | CvEducation | CvCertification

export type CvItemProvenance = {
  account: string
  track: string
  session: number
  initial: string
  touched: boolean
  revision: number
}

export type CvItemRemoval = {
  account: string
  track: string
  libraryRevision: string
  routePath: string
  section: string
  session: number
  kind: CvItemKind
  type: string
  id: string
  revision: number
  orderSignature: string
  label: string
  hasChildren: boolean
  trigger: HTMLElement | null
}

export function cvItemSignature(item: CvItem): string {
  return JSON.stringify(item)
}

/** A blank bypass is safe only for the exact initializer registered by this editor session. */
export function isUntouchedEmptyCvItem(
  item: CvItem,
  provenance: CvItemProvenance | undefined,
  scope: { account: string; track: string; session: number },
): boolean {
  return Boolean(provenance
    && provenance.account === scope.account
    && provenance.track === scope.track
    && provenance.session === scope.session
    && !provenance.touched
    && provenance.initial === cvItemSignature(item))
}

export function cvItems(cv: MasterCv, kind: CvItemKind): CvItem[] {
  switch (kind) {
    case 'skillGroup': return cv.skills
    case 'experience': return cv.experience
    case 'project': return cv.projects
    case 'education': return cv.education
    case 'certification': return cv.certifications ?? []
  }
}

export function removeCvItemById(cv: MasterCv, kind: CvItemKind, targetId: string): MasterCv {
  switch (kind) {
    case 'skillGroup': return { ...cv, skills: cv.skills.filter((item) => item.id !== targetId) }
    case 'experience': return { ...cv, experience: cv.experience.filter((item) => item.id !== targetId) }
    case 'project': return { ...cv, projects: cv.projects.filter((item) => item.id !== targetId) }
    case 'education': return { ...cv, education: cv.education.filter((item) => item.id !== targetId) }
    case 'certification': return { ...cv, certifications: (cv.certifications ?? []).filter((item) => item.id !== targetId) }
  }
}

export function cvItemRevisionMatches(
  cv: MasterCv,
  removal: Pick<CvItemRemoval, 'kind' | 'id' | 'revision' | 'orderSignature'>,
  currentRevision: number,
): boolean {
  const items = cvItems(cv, removal.kind)
  return items.some((item) => item.id === removal.id)
    && items.map((item) => item.id).join('\u0000') === removal.orderSignature
    && currentRevision === removal.revision
}
