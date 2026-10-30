import { buildGapReport } from './matchScore'
import type { MasterCvLibrary, TailoredDocument } from '../types/cv'
import { masterCvSearchText } from '../types/cv'
import type { JobApplication } from '../types/job'

export interface SavedJobIndicators {
  resumeReady: boolean
  matchPercent: number | null
}

/** Derive compact Saved-card signals from the current job, CV and saved document. */
export function getSavedJobIndicators(
  job: JobApplication,
  library: MasterCvLibrary,
  doc?: TailoredDocument,
  docsReady = true,
  libraryReady = true
): SavedJobIndicators | null {
  if (job.status !== 'saved') return null

  const resumeReady = Boolean(
    docsReady &&
      doc?.jobApplicationId === job.id &&
      doc.tailoredCv &&
      typeof doc.tailoredCv === 'object'
  )
  if (!libraryReady || !job.jdComplete || !job.jobDescription.trim() || job.needsCvSelection) {
    return { resumeReady, matchPercent: null }
  }

  const cvTrack = job.cvTrack ?? library.activeTrack
  const cv = library.cvs[cvTrack]
  if (!cv) return { resumeReady, matchPercent: null }

  if (!job.requirementAnalysis || job.requirementAnalysis.status !== 'complete') return { resumeReady, matchPercent: null }
  const gap = buildGapReport(
    job.jobDescription,
    job.extractedSkills,
    masterCvSearchText(cv),
    job.claimedSkills,
    job.requirementAnalysis
  )

  return {
    resumeReady,
    matchPercent: gap.skills.length > 0 ? gap.coveragePercent : null,
  }
}
