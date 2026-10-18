import type { JobApplication } from '../types/job'
import type { TailoredDocument } from '../types/cv'
import { commitLocalMutation, recoverLocalMutation } from './localMutation'
export interface PurgeTarget { id: string; deletedAt: string }
export const JOBS_CHANGED = 'applytrack-jobs-and-documents-changed'
export function capturePurgeTargets(jobs: JobApplication[]): PurgeTarget[] {
  return jobs.filter(job => Boolean(job.deletedAt)).map(job => ({ id: job.id, deletedAt: job.deletedAt! }))
}
export function purgeSnapshot(jobs: JobApplication[], docs: TailoredDocument[], targets: PurgeTarget[]) {
  if (targets.some(target => !target.id || !target.deletedAt || !Number.isFinite(Date.parse(target.deletedAt)))) throw new Error('Invalid confirmed Trash targets')
  if (new Set(targets.map(target=>target.id)).size !== targets.length) throw new Error('Duplicate confirmed targets')
  const confirmed = new Map(targets.map(target => [target.id, target.deletedAt]))
  const deleted = jobs.filter(job => job.deletedAt && confirmed.get(job.id) === job.deletedAt).map(job => job.id)
  const ids = new Set(deleted)
  return { deleted, jobs: jobs.filter(job => !ids.has(job.id)), docs: docs.filter(doc => !ids.has(doc.jobApplicationId)) }
}
export function purgeLocalJobs(storage: Storage, targets: PurgeTarget[], owner = 'local') {
  recoverLocalMutation(storage, owner)
  const result = purgeSnapshot(JSON.parse(storage.getItem('job-tracker-applications') ?? '[]'), JSON.parse(storage.getItem('applytrack-tailored-docs') ?? '[]'), targets)
  commitLocalMutation(storage, { 'job-tracker-applications': JSON.stringify(result.jobs), 'applytrack-tailored-docs': JSON.stringify(result.docs) }, owner)
  return result
}
