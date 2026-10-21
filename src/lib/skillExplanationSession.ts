import { getErrorMessage } from './errorMessage'

export type SkillExplanationState = {
  skill: string
  status: 'loading' | 'complete' | 'error'
  summary: string | null
  error: string | null
}

type SkillExplanationLookup = (skill: string) => Promise<string>

function skillKey(skill: string): string {
  return skill.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Account-scoped, in-memory explanation state that outlives individual routes. */
export class SkillExplanationSession {
  private readonly entries = new Map<string, SkillExplanationState>()
  private readonly selected = new Map<string, string>()
  private readonly requests = new Map<string, number>()
  private epoch = 0
  private disposed = false

  constructor(
    private readonly account: string,
    private readonly lookup: SkillExplanationLookup,
    private readonly onChange: () => void = () => {},
  ) {}

  get(jobId: string): SkillExplanationState | null {
    const selected = this.selected.get(this.jobKey(jobId))
    return selected ? this.entries.get(this.explanationKey(jobId, selected)) ?? null : null
  }

  toggle(jobId: string, skill: string): void {
    const normalized = skillKey(skill)
    const jobKey = this.jobKey(jobId)
    if (this.selected.get(jobKey) === normalized) {
      this.close(jobId)
      return
    }

    this.selected.set(jobKey, normalized)
    this.onChange()
    const state = this.entries.get(this.explanationKey(jobId, normalized))
    if (state?.status === 'loading' || state?.status === 'complete') return
    void this.load(jobId, skill.trim())
  }

  close(jobId: string): void {
    if (this.selected.delete(this.jobKey(jobId))) this.onChange()
  }

  retry(jobId: string, skill: string): void {
    const normalized = skillKey(skill)
    if (this.selected.get(this.jobKey(jobId)) !== normalized) return
    if (this.entries.get(this.explanationKey(jobId, normalized))?.status !== 'error') return
    void this.load(jobId, skill.trim())
  }

  dispose(): void {
    this.disposed = true
    this.epoch += 1
    this.entries.clear()
    this.selected.clear()
    this.requests.clear()
  }

  private jobKey(jobId: string): string {
    return JSON.stringify([this.account, jobId])
  }

  private explanationKey(jobId: string, skill: string): string {
    return JSON.stringify([this.account, jobId, skillKey(skill)])
  }

  private async load(jobId: string, skill: string): Promise<void> {
    if (this.disposed) return
    const key = this.explanationKey(jobId, skill)
    const version = (this.requests.get(key) ?? 0) + 1
    const epoch = this.epoch
    this.requests.set(key, version)
    this.entries.set(key, { skill, status: 'loading', summary: null, error: null })
    this.onChange()

    const current = () => !this.disposed && this.epoch === epoch && this.requests.get(key) === version
    try {
      const summary = (await this.lookup(skill)).trim()
      if (!current()) return
      if (!summary) throw new Error('No explanation came back')
      this.entries.set(key, { skill, status: 'complete', summary, error: null })
      this.onChange()
    } catch (error) {
      if (!current()) return
      this.entries.set(key, {
        skill,
        status: 'error',
        summary: null,
        error: getErrorMessage(error, 'Could not look that up'),
      })
      this.onChange()
    }
  }
}
