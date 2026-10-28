export type JobReviewPanelId = 'gap' | 'tailor' | 'cover'

export interface JobReviewPanelState {
  scope: string
  open: ReadonlySet<JobReviewPanelId>
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
