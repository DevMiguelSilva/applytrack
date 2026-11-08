import { jobHasLiveSource } from './cvSources'
import type { MasterCv, MasterCvLibrary } from '../types/cv'
import type { JobApplication } from '../types/job'

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export interface JobRescoreInput {
  job: JobApplication
  cv: MasterCv
  track: string
  fingerprint: string
}

/** Capture only the inputs and fallback fields that a rescore reads or replaces. */
export function captureJobRescoreInput(
  job: JobApplication | undefined,
  library: MasterCvLibrary,
  account: string
): JobRescoreInput | null {
  if (!job || account === 'signed-out' || job.status !== 'saved' || job.deletedAt || !job.jobDescription.trim()) return null
  if (!jobHasLiveSource(library, job)) return null

  const track = job.cvTrack ?? library.activeTrack
  const cv = library.cvs[track]
  if (!cv) return null

  const jobSnapshot = copy(job)
  const cvSnapshot = copy(cv)
  const fingerprint = stableJson({
    account,
    job: {
      id: job.id,
      updatedAt: job.updatedAt,
      status: job.status,
      deletedAt: job.deletedAt,
      source: job.source,
      cvTrack: job.cvTrack,
      needsCvSelection: job.needsCvSelection,
      jobDescription: job.jobDescription,
      company: job.company,
      role: job.role,
      location: job.location,
      salary: job.salary,
      jdSummary: job.jdSummary,
      extractedSkills: job.extractedSkills,
      extractedRequirements: job.extractedRequirements,
    },
    track,
    cv: cvSnapshot,
  })

  return { job: jobSnapshot, cv: cvSnapshot, track, fingerprint }
}
