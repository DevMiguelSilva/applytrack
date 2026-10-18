import type { MasterCvLibrary } from '../types/cv'
import type { JobApplication } from '../types/job'

export function captureTailoringInput(job: JobApplication | undefined, library: MasterCvLibrary) {
  if (!job || job.status !== 'saved' || job.deletedAt || job.needsCvSelection) return null
  const track = job.cvTrack ?? library.activeTrack
  const cv = library.cvs[track]
  if (!cv) return null
  // Exclude notes, interviews and match scores: they are not tailoring inputs.
  const inputs = { company: job.company, role: job.role, location: job.location, salary: job.salary, jobUrl: job.jobUrl, jobDescription: job.jobDescription, jdSummary: job.jdSummary, extractedSkills: job.extractedSkills, extractedRequirements: job.extractedRequirements, claimedSkills: job.claimedSkills, track, cv }
  return { job: structuredClone(job), cv: structuredClone(cv), fingerprint: JSON.stringify(inputs) }
}
