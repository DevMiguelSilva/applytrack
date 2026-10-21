import type { GapReport } from '../types/cv'

export function gapCvSelectionKey(track: string | null | undefined, cvText: string): string {
  return `${track ?? '__active__'}\u0000${cvText}`
}

/** Tracks CV selection changes and invalidates stale refresh errors on close/lock. */
export class GapCvRefreshTracker {
  private selectionKey: string
  private active: boolean
  private version = 0

  constructor(selectionKey: string, active = false) {
    this.selectionKey = selectionKey
    this.active = active
  }

  observe(selectionKey: string, active: boolean): number | null {
    const changed = this.selectionKey !== selectionKey
    if (!changed && this.active === active) return null

    this.selectionKey = selectionKey
    this.active = active
    this.version += 1
    return changed && active ? this.version : null
  }

  isLatest(version: number): boolean {
    return this.version === version
  }
}

export function refreshGapReportForCvChange(
  tracker: GapCvRefreshTracker,
  selectionKey: string,
  active: boolean,
  claimedSkills: string[],
  compute: (claimed: string[]) => GapReport,
): { version: number; report: GapReport } | null {
  const version = tracker.observe(selectionKey, active)
  if (version === null) return null
  return { version, report: compute(claimedSkills) }
}
