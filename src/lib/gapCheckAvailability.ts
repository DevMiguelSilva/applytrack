import type { GapReport } from '../types/cv'
import type { JobStatus } from '../types/job'

export type GapCheckMode = 'run' | 'view' | 'disabled' | 'hidden'

export function hasGapContent(gap: GapReport | null | undefined): boolean {
  return Boolean(
    gap && (
      gap.matchedKeywords.length > 0 ||
      (gap.claimedKeywords?.length ?? 0) > 0 ||
      gap.missingKeywords.length > 0
    )
  )
}

export function getGapCheckMode(
  status: JobStatus,
  canGenerate: boolean,
  deleted: boolean,
  savedReport: GapReport | null | undefined,
): GapCheckMode {
  if (status === 'saved') return canGenerate && !deleted ? 'run' : 'disabled'
  if (deleted || !hasGapContent(savedReport)) return 'hidden'
  return 'view'
}
