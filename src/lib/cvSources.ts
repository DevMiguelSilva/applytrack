import type { MasterCvLibrary } from '../types/cv'
import type { JobApplication, SavedSearch } from '../types/job'
export function jobHasLiveSource(library: MasterCvLibrary, job: JobApplication) {
  return !job.needsCvSelection && Boolean(library.cvs[job.cvTrack ?? library.activeTrack])
}
export function searchHasLiveSource(library: MasterCvLibrary, search: SavedSearch) {
  return !search.needsCvSelection && (search.track === 'auto' || Boolean(library.cvs[search.track]))
}
export function validateJobSource(library: MasterCvLibrary, job: JobApplication) {
  if (job.status !== 'saved') return
  const exists = Boolean(library.cvs[job.cvTrack ?? library.activeTrack])
  if ((!exists && !job.needsCvSelection) || (exists && job.needsCvSelection)) throw new Error('Choose an existing CV template before continuing.')
}
export function validateSearchSource(library: MasterCvLibrary, search: SavedSearch) {
  const exists = search.track === 'auto' || Boolean(library.cvs[search.track])
  if ((!exists && !search.needsCvSelection) || (search.needsCvSelection && (search.active || exists))) throw new Error('Choose a CV for this paused search before activating it.')
}
