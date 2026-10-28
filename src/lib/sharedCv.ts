import { createDefaultLibrary, createEmptyMasterCv, normalizeLibrary, type CvExperience, type MasterCv, type MasterCvLibrary } from '../types/cv'

type Role = Omit<CvExperience, 'bullets'>
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const facts = ({ id, company, title, location, start, end, current }: CvExperience): Role =>
  ({ id, company, title, location, start, end, current })

/** Never infer a source from the current default or an unrelated profile. */
export function sharedSourceId(library: MasterCvLibrary): string {
  if (library.cvs.powerPlatform) return 'powerPlatform'
  const candidates = Object.keys(library.cvs).filter(id => library.names[id]?.trim().toLowerCase() === 'power platform')
  if (candidates.length !== 1) throw new Error('The Power Platform CV could not be uniquely identified. Restore or rename that profile before migrating.')
  return candidates[0]
}

/** Make a new library without modifying the input; do not deduplicate uncertain roles. */
export function migrateSharedCv(raw: unknown): MasterCvLibrary {
  if (!raw || typeof raw !== 'object' || !('cvs' in raw)) throw new Error('The Power Platform CV could not be identified in the original library. Restore it before migrating.')
  const library = normalizeLibrary(raw)
  if (library.sharedDetails) return library
  const rawCvs = (raw as { cvs: Record<string, unknown> }).cvs
  const sourceId = sharedSourceId(library)
  if (!rawCvs || !Object.prototype.hasOwnProperty.call(rawCvs, sourceId)) throw new Error('The Power Platform CV could not be identified in the original library. Restore it before migrating.')
  const source = library.cvs[sourceId]
  const roles: Role[] = []
  const cvs = Object.fromEntries(Object.entries(library.cvs).map(([id, cv]) => {
    const experience = cv.experience.map(entry => {
      // IDs were previously only meaningful within a CV; assign distinct identities.
      const role = { ...entry, id: crypto.randomUUID() }
      roles.push(facts(role))
      return role
    })
    return [id, { ...cv, contact: structuredClone(source.contact), education: structuredClone(source.education),
      projects: structuredClone(source.projects), certifications: structuredClone(source.certifications), experience }]
  }))
  return { ...library, cvs, sharedDetails: { version: 1, original: structuredClone(raw), roles } }
}

/** Propagate shared fields and role facts, while preserving other profiles' highlights. */
export function saveSharedCv(library: MasterCvLibrary, id: string, cv: MasterCv): MasterCvLibrary {
  if (!library.cvs[id] || !library.sharedDetails) throw new Error('The shared CV library is unavailable. Reload before saving.')
  const roles = [...library.sharedDetails.roles]
  for (const entry of cv.experience) {
    const index = roles.findIndex(role => role.id === entry.id)
    if (index < 0) roles.push(facts(entry))
    else roles[index] = facts(entry)
  }
  const byId = new Map(roles.map(role => [role.id, role]))
  const cvs = Object.fromEntries(Object.entries(library.cvs).map(([key, existing]) => {
    const profile = key === id ? cv : existing
    return [key, { ...profile, contact: structuredClone(cv.contact), education: structuredClone(cv.education),
      projects: structuredClone(cv.projects), certifications: structuredClone(cv.certifications),
      experience: profile.experience.map(entry => ({ ...entry, ...byId.get(entry.id), bullets: entry.bullets })) }]
  }))
  return { ...library, cvs, sharedDetails: { ...library.sharedDetails, roles } }
}

export function blankSharedCv(library: MasterCvLibrary): MasterCv {
  const source = library.cvs[library.activeTrack]
  return createEmptyMasterCv({ contact: structuredClone(source.contact), education: structuredClone(source.education),
    projects: structuredClone(source.projects), certifications: structuredClone(source.certifications) })
}

export function migrateLocalSharedCv(storage: Pick<Storage, 'getItem' | 'setItem'>): MasterCvLibrary {
  const key = 'applytrack-master-cv'
  const backupKey = 'applytrack-master-cv-before-shared-v1'
  const stored = storage.getItem(key)
  const raw: unknown = stored ? JSON.parse(stored) : createDefaultLibrary()
  const normalized = normalizeLibrary(raw)
  if (normalized.sharedDetails) return normalized
  const migrated = migrateSharedCv(raw)
  if (stored) {
    const previous = storage.getItem(backupKey)
    if (previous !== null && previous !== stored) throw new Error('A different CV migration backup already exists. Recover or remove it before retrying.')
    if (previous === null) storage.setItem(backupKey, stored)
    if (storage.getItem(backupKey) !== stored) throw new Error('Could not secure the CV library backup. No migration was performed.')
  }
  storage.setItem(key, JSON.stringify(migrated))
  return migrated
}

/** Secure and verify the old document in a separate conditional write before migration. */
export async function migrateCloudSharedCv(document: unknown, revision: string,
  write: (document: unknown, expected: string) => Promise<{ document: unknown; revision: string } | null>,
  current: () => boolean): Promise<{ library: MasterCvLibrary; revision: string; document: unknown }> {
  const candidate = document as Record<string, unknown>
  const original = candidate?.sharedMigrationBackup ?? document
  const library = migrateSharedCv(original)
  if (!candidate?.sharedMigrationBackup) {
    if (!current()) throw new Error('The account changed during migration. Reload before retrying.')
    const result = await write({ ...candidate, sharedMigrationBackup: structuredClone(original) }, revision)
    if (!result || canonical((result.document as Record<string, unknown>)?.sharedMigrationBackup) !== canonical(original))
      throw new Error('Could not secure the CV library backup. Reload before retrying.')
    document = result.document
    revision = result.revision
  }
  if (!current()) throw new Error('The account changed during migration. Reload before retrying.')
  return { library, revision, document }
}
