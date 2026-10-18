import { AdzunaError, type AdzunaFailure } from '../../shared/adzunaErrors'
import type { AdzunaFilters, AdzunaSearchResponse } from '../api/client'
import type { InboxJob, SavedSearch } from '../types/job'
import { expandSearchLocations } from './searchLocations'

export interface SearchOutcome {
  id: string
  search: SavedSearch
  location: string
  filters: AdzunaFilters
  state: 'success' | 'failed' | 'not_run'
  response?: AdzunaSearchResponse
  error?: AdzunaFailure
}
export interface RefreshReport {
  outcomes: SearchOutcome[]
  persistence: 'saved' | 'failed' | 'unchanged'
  saveError?: string
  invalidated?: boolean
}
export function searchFingerprint(search: SavedSearch) {
  return JSON.stringify([search.query, search.location, search.country, search.maxDaysOld, search.excludeTerms, search.track, Boolean(search.needsCvSelection)])
}
export function searchRequests(searches: SavedSearch[]): SearchOutcome[] {
  return searches.filter(search => !search.needsCvSelection).flatMap(search => expandSearchLocations(search.location).map(leg => ({
    id: `${search.id}:${JSON.stringify([leg.location, leg.isRemote])}`,
    search: structuredClone(search), location: leg.label,
    filters: { query: search.query, location: leg.location || undefined, country: search.country, maxDaysOld: search.maxDaysOld, excludeTerms: search.excludeTerms, requireRemote: leg.isRemote && !/\bremote\b/i.test(search.query) },
    state: 'not_run' as const,
  })))
}
export class RefreshInvalidated extends Error {}

/** Sequential request collection, deduplication and failed-only retry; no UI/storage closures. */
export class InboxRefresh {
  busy = false
  outcomes: SearchOutcome[] = []
  private version = 0
  private cooldownUntil = 0
  private cooldownError?: AdzunaError
  constructor(private now = Date.now) {}
  invalidate() { this.version++; this.busy = false; this.outcomes = [] }
  async run(requests: SearchOutcome[], fetch: (filters: AdzunaFilters) => Promise<AdzunaSearchResponse>, valid: () => boolean, retry = false): Promise<SearchOutcome[] | undefined> {
    if (this.busy) return undefined
    this.busy = true
    const version = ++this.version
    const check = () => { if (this.version !== version || !valid()) throw new RefreshInvalidated('Searches changed. Run a fresh search to use the latest filters.') }
    const cache = new Map<string, AdzunaSearchResponse | AdzunaError>()
    const previous = new Map(this.outcomes.map(outcome => [outcome.id, outcome]))
    const next: SearchOutcome[] = []
    let stopped = this.now() < this.cooldownUntil ? this.cooldownError : undefined
    try {
      for (const request of requests) {
        check()
        const old = previous.get(request.id)
        if (retry && old?.state === 'success') { next.push(old); continue }
        const key = JSON.stringify(request.filters)
        let result = cache.get(key)
        if (!result && !stopped) {
          try { result = await fetch(request.filters) }
          catch (error) { result = error instanceof AdzunaError ? error : new AdzunaError('upstream', 502) }
          check()
          cache.set(key, result)
        }
        if (!result && stopped) {
          next.push({ ...request, state: 'not_run', error: stopped.envelope().error }); continue
        }
        if (result instanceof AdzunaError) {
          next.push({ ...request, state: 'failed', error: result.envelope().error })
          if (result.stopsRefresh) stopped = result
          if (result.code === 'rate_limit' && result.retryAfterSeconds !== undefined) {
            this.cooldownUntil = this.now() + result.retryAfterSeconds * 1000
            this.cooldownError = result
          }
        } else next.push({ ...request, state: 'success', response: result })
      }
      check()
      this.outcomes = next
      return next
    } finally { if (this.version === version) this.busy = false }
  }
}

/** Merge at commit time. Partial/empty refreshes cannot prune review cards or revive history. */
export function mergeInboxResults(current: InboxJob[], fetched: InboxJob[], approvedExternal: Set<string>, complete: boolean, runAlone: boolean, runStarted: number): InboxJob[] {
  const returned = new Set(fetched.map(item => item.externalId))
  const history = new Map(current.map(item => [item.externalId, item]))
  const merged = new Map(current.map(item => [item.externalId, item]))
  const best = new Map<string, InboxJob>()
  for (const item of fetched) {
    const previous = best.get(item.externalId)
    if (!previous || item.matchScore > previous.matchScore) best.set(item.externalId, item)
  }
  if (complete && returned.size > 0) {
    for (const item of current) {
      if (item.status === 'new' && new Date(item.fetchedAt).getTime() < runStarted && (runAlone || !returned.has(item.externalId))) merged.delete(item.externalId)
    }
  }
  for (const item of best.values()) {
    const old = history.get(item.externalId)
    if (old?.status === 'dismissed' || old?.status === 'approved') continue
    if (approvedExternal.has(item.externalId)) continue
    merged.set(item.externalId, { ...item, id: old?.id ?? item.id, createdAt: old?.createdAt ?? item.createdAt, seenCount: old ? Math.max(old.seenCount || 1, item.seenCount) : item.seenCount })
  }
  return [...merged.values()].sort((a,b) => b.matchScore - a.matchScore)
}
