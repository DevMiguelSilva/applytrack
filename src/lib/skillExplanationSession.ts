import { getErrorMessage } from './errorMessage'
import type { SkillJobContext } from '../../shared/skillContext'

export type SkillExplanationState = {
  skill: string
  status: 'loading' | 'complete' | 'error'
  summary: string | null
  error: string | null
}

type SkillExplanationLookup = (skill: string, context: SkillJobContext) => Promise<string>
const emptyContext: SkillJobContext = { role: '', description: '', skills: [], requirements: [] }

function skillKey(skill: string): string {
  return skill.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Account-scoped, in-memory explanation state that outlives individual routes. */
export class SkillExplanationSession {
  private readonly entries = new Map<string, SkillExplanationState>()
  private readonly selected = new Map<string, { skill: string; contextKey: string }>()
  private readonly requests = new Map<string, number>()
  private epoch = 0
  private disposed = false

  constructor(
    private readonly account: string,
    private readonly lookup: SkillExplanationLookup,
    private readonly onChange: () => void = () => {},
  ) {}

  get(jobId: string, contextKey = ''): SkillExplanationState | null {
    const selected = this.selected.get(this.jobKey(jobId))
    return selected && selected.contextKey === contextKey ? this.entries.get(this.explanationKey(jobId, selected.skill, contextKey)) ?? null : null
  }

  toggle(jobId: string, skill: string, contextKey = '', context: SkillJobContext = emptyContext): void {
    const normalized = skillKey(skill)
    const jobKey = this.jobKey(jobId)
    const selected = this.selected.get(jobKey)
    if (selected?.skill === normalized && selected.contextKey === contextKey) {
      this.close(jobId)
      return
    }

    this.selected.set(jobKey, { skill: normalized, contextKey })
    this.onChange()
    const state = this.entries.get(this.explanationKey(jobId, normalized, contextKey))
    if (state?.status === 'loading' || state?.status === 'complete') return
    void this.load(jobId, skill.trim(), contextKey, context)
  }

  close(jobId: string): void {
    if (this.selected.delete(this.jobKey(jobId))) this.onChange()
  }

  retry(jobId: string, skill: string, contextKey = '', context: SkillJobContext = emptyContext): void {
    const normalized = skillKey(skill)
    const selected = this.selected.get(this.jobKey(jobId))
    if (selected?.skill !== normalized || selected.contextKey !== contextKey) return
    if (this.entries.get(this.explanationKey(jobId, normalized, contextKey))?.status !== 'error') return
    void this.load(jobId, skill.trim(), contextKey, context)
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

  private explanationKey(jobId: string, skill: string, contextKey: string): string {
    return JSON.stringify([this.account, jobId, skillKey(skill), contextKey])
  }

  private async load(jobId: string, skill: string, contextKey: string, context: SkillJobContext): Promise<void> {
    if (this.disposed) return
    const key = this.explanationKey(jobId, skill, contextKey)
    const version = (this.requests.get(key) ?? 0) + 1
    const epoch = this.epoch
    this.requests.set(key, version)
    this.entries.set(key, { skill, status: 'loading', summary: null, error: null })
    this.onChange()

    const current = () => !this.disposed && this.epoch === epoch && this.requests.get(key) === version
    try {
      const summary = (await this.lookup(skill, context)).trim()
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
