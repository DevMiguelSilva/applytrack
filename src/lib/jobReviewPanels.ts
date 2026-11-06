export type JobReviewPanelId = 'gap' | 'tailor' | 'cover'

export interface JobReviewPanelState {
  scope: string
  open: ReadonlySet<JobReviewPanelId>
}

export interface ScopedJobReviewSnapshot<T> {
  scope: string
  data: T
}

export function createJobReviewPanelState(scope: string): JobReviewPanelState {
  return { scope, open: new Set() }
}

export function updateJobReviewPanel(
  current: JobReviewPanelState,
  scope: string,
  panel: JobReviewPanelId,
  isOpen: boolean,
): JobReviewPanelState {
  const open = current.scope === scope ? new Set(current.open) : new Set<JobReviewPanelId>()
  if (isOpen) open.add(panel)
  else open.delete(panel)
  return { scope, open }
}

export function shouldOpenGapForExplanation(previousSkill: string | null, nextSkill: string | null): boolean {
  return Boolean(nextSkill && nextSkill !== previousSkill)
}

export function retainJobReviewSnapshot<T>(
  scope: string,
  loading: boolean,
  current: T | null,
  previous: ScopedJobReviewSnapshot<T> | null,
): ScopedJobReviewSnapshot<T> | null {
  if (loading) return previous?.scope === scope ? previous : null
  return current === null ? null : { scope, data: current }
}
