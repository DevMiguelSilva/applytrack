import { CV_LIBRARY_EVENT, recoverCvTransaction } from '../lib/cvLibrary'
import { searchHasLiveSource } from '../lib/cvSources'
import { withLocalMutation } from '../lib/localMutation'
import { normalizeLibrary } from '../types/cv'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { InboxRefresh, RefreshInvalidated, searchFingerprint, searchRequests, mergeInboxResults, type RefreshReport, type SearchOutcome } from '../lib/inboxRefresh'
import { fetchAdzunaSearch } from '../api/client'
import { parseJobPosting } from '../api/gemini'
import { inboxJobToRow, rowToInboxJob } from '../lib/database'
import { InboxSaveError, inboxSaveStep, safeInboxSaveError, saveCloudInboxResults } from '../lib/inboxPersistence'
import { observeInboxSave } from '../lib/inboxSaveWait'
import {
  dualTrackReasonLine,
  createCvMatcher,
  scoreDualTracks,
  scoreMasterCvAgainstJob,
  withRequirementSignals,
  type MatchResult,
  type DualTrackMatch,
} from '../lib/matchScore'
import { supabase } from '../lib/supabase'
import { type CvTrack, type MasterCv } from '../types/cv'
import type { InboxJob, SavedSearch, SearchTrack } from '../types/job'
import { createEmptyJob } from '../types/job'
import { useAuth } from './useAuth'
import { useJobs } from './useJobs'
import { useMasterCv } from './useMasterCv'
import { useSavedSearches } from './useSavedSearches'

const LOCAL_KEY = 'applytrack-inbox'

export interface RefreshInboxOptions {
  /** Run only this saved search (ignores other active flags for this refresh). */
  onlySearchId?: string
  /** Replace old review rows only after this search completes successfully with matches. */
  clearReviewFirst?: boolean
  /**
   * Use this list instead of context searches (avoids stale state right after
   * activateAll / reorder before React re-renders).
   */
  searchesOverride?: SavedSearch[]
}

interface InboxContextValue {
  inbox: InboxJob[]
  loading: boolean
  refreshing: boolean
  refreshError: string | null
  refreshReport: RefreshReport | null
  retryFailedSearches: () => Promise<void>
  retryInboxSave: () => Promise<void>
  newCount: number
  refreshInbox: (options?: RefreshInboxOptions) => Promise<void>
  /** Remove current review cards so the next refresh can show them as new again. */
  clearReviewList: () => Promise<void>
  approveJob: (id: string) => Promise<string>
  dismissJob: (id: string) => Promise<void>
}

const InboxContext = createContext<InboxContextValue | null>(null)

function readLocal(): InboxJob[] {
  recoverCvTransaction(localStorage)
  try {
    const stored = localStorage.getItem(LOCAL_KEY)
    const items = stored ? (JSON.parse(stored) as InboxJob[]) : []
    return items.map((item) => ({
      ...item,
      matchedTrack: item.matchedTrack ?? null,
      matchReasons: item.matchReasons ?? [],
      seenCount: item.seenCount && item.seenCount > 0 ? item.seenCount : 1,
    }))
  } catch {
    return []
  }
}

function writeLocal(items: InboxJob[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(items))
}

function pickMatch(
  jobText: string,
  searchTrack: SearchTrack,
  cvs: Record<CvTrack, MasterCv>,
  names: Record<string, string>,
  score: (text: string) => DualTrackMatch = (text) => scoreDualTracks(text, cvs)
): MatchResult & { track: CvTrack } {
  const dual = score(jobText)
  const track = searchTrack === 'auto' ? dual.bestTrack : searchTrack
  const match = dual.scores[track]
  if (!match) throw new Error('The selected CV is unavailable. Choose another CV for this search.')
  return {
    ...match,
    track,
    reasons: [
      dualTrackReasonLine(dual, names),
      `Best for apply: ${names[dual.bestTrack]} (${dual.bestScore}%)`,
      ...match.reasons,
    ],
  }
}

export function InboxProvider({ children }: { children: ReactNode }) {
  const { user, isCloudEnabled } = useAuth()
  const userId = user?.id
  const account = isCloudEnabled ? userId ?? 'signed-out' : 'local'
  const { searches } = useSavedSearches()
  const { library } = useMasterCv()
  const live = useRef({ library, searches })
  live.current = { library, searches }
  const { addJob, jobs } = useJobs()
  const [inbox, setInbox] = useState<InboxJob[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const isCloudSync = isCloudEnabled && Boolean(userId)
  const inboxRef = useRef(inbox)
  inboxRef.current = inbox
  const current = useRef({ account, searches, jobs })
  current.current = { account, searches, jobs }
  const mutations = useRef<Promise<unknown>>(Promise.resolve())
  const revision = useRef(0)
  const sourcesNow = useCallback(() => isCloudSync ? live.current : {
    library: normalizeLibrary(JSON.parse(localStorage.getItem('applytrack-master-cv') ?? 'null')),
    searches: JSON.parse(localStorage.getItem('applytrack-saved-searches') ?? '[]') as SavedSearch[],
  }, [isCloudSync])
  const loadedOwner = useRef(account)
  const manager = useMemo(() => { void account; return new InboxRefresh() }, [account])
  const [refreshReport, setRefreshReport] = useState<RefreshReport | null>(null)
  type PendingRefresh = { account: string; outcomes: SearchOutcome[]; rows: InboxJob[]; started: number; runAlone: boolean; valid: () => boolean }
  const pending = useRef<PendingRefresh | null>(null)
  const inFlightSave = useRef<PendingRefresh | null>(null)
  const session = useRef<{ account: string; requests: SearchOutcome[]; started: number; runAlone: boolean; baseline: Map<string, InboxJob> } | null>(null)
  const refreshBusy = useRef(false)
  const refreshGeneration = useRef(0)
  const validRequests = useCallback((requests: SearchOutcome[], owner: string) => current.current.account === owner && requests.every(request => {
    const source = sourcesNow()
    const search = source.searches.find(entry => entry.id === request.search.id)
    return search && searchHasLiveSource(source.library, search) && searchFingerprint(search) === searchFingerprint(request.search)
  }), [sourcesNow])
  useEffect(() => {
    const generation = refreshGeneration
    manager.invalidate()
    generation.current++
    pending.current = null; session.current = null; refreshBusy.current = false
    setRefreshing(false); setRefreshReport(null); setRefreshError(null)
    return () => { generation.current++; manager.invalidate() }
  }, [manager])
  useEffect(() => {
    if (session.current && !validRequests(session.current.requests, session.current.account)) {
      manager.invalidate(); pending.current = null; session.current = null
      setRefreshReport(null)
      setRefreshError('A saved search changed or was deleted. Refresh again to use the latest filters.')
    }
  }, [searches, account, manager, validRequests])

  const cvsByTrack = library.cvs
  const matchJob = useMemo(() => {
    const score = createCvMatcher(cvsByTrack)
    const cache = new Map<string, DualTrackMatch>()
    return (text: string) => {
      const existing = cache.get(text)
      if (existing) return existing
      const match = score(text)
      if (cache.size >= 500) cache.delete(cache.keys().next().value!)
      cache.set(text, match)
      return match
    }
  }, [cvsByTrack])

  const load = useCallback(async () => {
    const version = ++revision.current
    const owner = account
    loadedOwner.current = account
    setLoading(true)
    setInbox([]); inboxRef.current = []
    try {
      if (!isCloudSync || !supabase || !userId) {
        const next = await withLocalMutation(readLocal)
        if (current.current.account === owner && version === revision.current) { inboxRef.current = next; setInbox(next) }
        return
      }
      const { data, error } = await supabase
        .from('job_inbox')
        .select('*')
        .eq('user_id', userId)
        .order('match_score', { ascending: false })
      if (error) throw error
      if (current.current.account === owner && version === revision.current) { inboxRef.current = (data ?? []).map(rowToInboxJob); setInbox(inboxRef.current) }
    } catch (err) {
      console.error('Failed to load inbox:', err)
    } finally {
      if (current.current.account === owner && version === revision.current) setLoading(false)
    }
  }, [isCloudSync, userId, account])

  useEffect(() => {
    void load()
    const refresh = () => { void load() }
    window.addEventListener(CV_LIBRARY_EVENT, refresh)
    const storage = (event: StorageEvent) => { if (!isCloudSync && ['applytrack-inbox', 'applytrack-master-cv'].includes(event.key ?? '')) refresh() }
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener(CV_LIBRARY_EVENT, refresh); window.removeEventListener('storage', storage) }
  }, [load, isCloudSync])

  const persistAll = useCallback((transform: (items: InboxJob[]) => InboxJob[], valid: () => boolean = () => true, fetched = false) => {
    if (inFlightSave.current) return Promise.reject(new Error('A previous Inbox save is still awaiting a response. Try again after it finishes.'))
    const owner = account
    const operation = mutations.current.catch(() => {}).then(async () => {
      const check = () => { if (current.current.account !== owner || owner === 'signed-out' || !valid()) throw new RefreshInvalidated('Searches or account changed. Refresh again.') }
      check()
      revision.current++; setLoading(false)
      const before = inboxRef.current
      let next = transform(before)
      if (fetched && isCloudSync && supabase && userId) {
        next = await saveCloudInboxResults(supabase, userId, transform, check)
      } else if (isCloudSync && supabase && userId) {
        const oldById = new Map(before.map(item => [item.id, item]))
        const changed = next.filter(item => JSON.stringify(item) !== JSON.stringify(oldById.get(item.id)))
        // Save new results before pruning. A failed upsert must not erase review jobs.
        if (changed.length) {
          await inboxSaveStep('upsert', async () => {
            const { error } = await supabase!.from('job_inbox').upsert(changed.map(item => inboxJobToRow(item, userId)))
            if (error) throw error
          })
        }
        check()
        const nextIds = new Set(next.map(item => item.id))
        const removed = before.filter(item => item.status === 'new' && !nextIds.has(item.id)).map(item => item.id)
        if (removed.length) {
          await inboxSaveStep('prune', async () => {
            const { error } = await supabase!.from('job_inbox').delete().eq('user_id', userId).eq('status', 'new').in('id', removed)
            if (error) throw error
          })
        }
      } else next = await withLocalMutation(async () => {
        check()
        const updated = transform(readLocal())
        await inboxSaveStep('local', () => writeLocal(updated))
        return updated
      })
      check()
      revision.current++;setLoading(false);inboxRef.current = next; setInbox(next)
    })
    mutations.current = operation
    return operation
  }, [isCloudSync, userId, account])

  const clearReviewList = useCallback(async () => {
    await persistAll(items => items.filter(item => item.status !== 'new'))
  }, [persistAll])

  const saveFetched = async (batch: PendingRefresh) => {
    if (!batch.valid()) throw new RefreshInvalidated('Searches changed. Refresh again.')
    const complete = batch.outcomes.every(outcome => outcome.state === 'success')
    if (!batch.rows.length) {
      pending.current = null
      setRefreshReport({ outcomes: batch.outcomes, persistence: 'unchanged' })
      return
    }
    const operation = persistAll(items => mergeInboxResults(items, batch.rows, new Set(current.current.jobs.filter(job => job.externalId && !job.deletedAt).map(job => job.externalId)), complete, batch.runAlone, batch.started), batch.valid, true)
    inFlightSave.current = batch
    const observed = observeInboxSave(operation)
    const finish = (result: Awaited<typeof observed.result>) => {
      if (inFlightSave.current !== batch) return
      inFlightSave.current = null
      if (!batch.valid()) return
      setRefreshError(null)
      if (result.status === 'fulfilled') {
        pending.current = null
        setRefreshReport({ outcomes: batch.outcomes, persistence: 'saved' })
      } else if (result.error instanceof RefreshInvalidated) {
        pending.current = null
        setRefreshError('Searches or account changed. Refresh again to use the latest filters.')
      } else {
        pending.current = batch
        setRefreshReport({ outcomes: batch.outcomes, persistence: 'failed', saveError: (result.error instanceof InboxSaveError ? result.error : safeInboxSaveError(isCloudSync ? 'upsert' : 'local', result.error)).message })
      }
    }
    const initial = await observed.initial
    if (initial.status === 'pending') {
      void observed.result.then(finish)
      if (!batch.valid()) return
      pending.current = batch
      setRefreshReport({ outcomes: batch.outcomes, persistence: 'pending' })
    } else finish(initial)
  }

  const collect = async (retry: boolean, options?: RefreshInboxOptions) => {
    if (inFlightSave.current) { setRefreshError('A previous Inbox save is still awaiting a response. Try again after it finishes.'); return }
    if (refreshBusy.current || loading || account === 'signed-out') return
    refreshBusy.current = true
    const generation = ++refreshGeneration.current
    setRefreshing(true); setRefreshError(null); setRefreshReport(null)
    const owner = account
    try {
      if (!retry) {
          const source = sourcesNow()
          const list = (options?.searchesOverride ?? source.searches).filter(search => {
            const actual = source.searches.find(entry=>entry.id===search.id)
            return actual && searchHasLiveSource(source.library,actual) && searchHasLiveSource(source.library,search)
        })
        const selected = options?.onlySearchId ? list.filter(search => search.id === options.onlySearchId && search.query.trim()) : list.filter(search => search.active && search.query.trim())
        if (!selected.length) { setRefreshError('Add an active saved search with a search phrase before refreshing.'); return }
        session.current = { account: owner, requests: searchRequests(selected), started: Date.now(), runAlone: Boolean(options?.clearReviewFirst), baseline: new Map(inboxRef.current.map(item => [item.externalId, item])) }
        pending.current = null
      }
      const run = session.current
      if (!run || run.account !== owner || (retry && !validRequests(run.requests, owner))) throw new RefreshInvalidated()
      const valid = () => session.current === run && validRequests(run.requests, owner)
      const outcomes = await manager.run(run.requests, fetchAdzunaSearch, valid, retry)
      if (!outcomes || !valid()) throw new RefreshInvalidated()
      const rows: InboxJob[] = []
      const latest = live.current
      const batchScore = createCvMatcher(latest.library.cvs)
      for (const outcome of outcomes) {
        if (outcome.state !== 'success') continue
        for (const result of outcome.response!.results) {
          const now = new Date().toISOString()
          const old = run.baseline.get(result.externalId)
          const match = pickMatch(`${result.role}\n${result.description}`, outcome.search.track ?? 'auto', latest.library.cvs, latest.library.names, batchScore)
          rows.push({ id: old?.id ?? crypto.randomUUID(), externalId: result.externalId, source: 'adzuna', company: result.company, role: result.role, location: result.location, jobUrl: result.jobUrl, salary: result.salary, description: result.description, matchScore: match.score, matchReasons: match.reasons, matchedTrack: match.track, status: 'new', savedSearchId: outcome.search.id, seenCount: old ? (old.seenCount || 1) + 1 : 1, fetchedAt: now, createdAt: old?.createdAt ?? now, updatedAt: now })
        }
      }
      await saveFetched({ account: owner, outcomes, rows, started: run.started, runAlone: run.runAlone, valid })
    } catch (error) {
      if (current.current.account === owner && refreshGeneration.current === generation) setRefreshError(error instanceof RefreshInvalidated ? 'Searches or account changed. Refresh again to use the latest filters.' : 'Could not prepare the fetched jobs. Check the selected CVs and refresh again. Your existing jobs are safe.')
    } finally {
      if (current.current.account === owner && refreshGeneration.current === generation) { refreshBusy.current = false; setRefreshing(false) }
    }
  }
  const refreshInbox = (options?: RefreshInboxOptions) => collect(false, options)
  const retryFailedSearches = () => collect(true)
  const retryInboxSave = async () => {
    if (inFlightSave.current) { setRefreshError('A previous Inbox save is still awaiting a response. Try again after it finishes.'); return }
    if (refreshBusy.current || !pending.current) return
    refreshBusy.current = true; setRefreshing(true); setRefreshError(null)
    const generation = ++refreshGeneration.current
    const batch = pending.current
    try { await saveFetched(batch) }
    catch { if (current.current.account === batch.account && refreshGeneration.current === generation) setRefreshError('Searches changed. Refresh again to use the latest filters.') }
    finally { if (current.current.account === batch.account && refreshGeneration.current === generation) { refreshBusy.current = false; setRefreshing(false) } }
  }

  const updateInboxItem = useCallback(async (id: string, updates: Partial<InboxJob>) => {
    await persistAll(items => items.map(item => item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item))
  }, [persistAll])

  const approveJob = useCallback(
    async (id: string) => {
      if (inFlightSave.current) throw new Error('A previous Inbox save is still awaiting a response. Try again after it finishes.')
      const owner = account
      const item = (isCloudSync ? inboxRef.current : await withLocalMutation(readLocal)).find((i) => i.id === id)
      if (!item) throw new Error('Inbox item not found')
      if (item.needsCvSelection && !live.current.searches.some(search=>search.id===item.savedSearchId && searchHasLiveSource(live.current.library,search))) throw new Error('Choose a source CV in the saved search before approving this job.')

      // Same job shape as manual add: keep full description text; AI fills summary/skills when possible.
      let jdSummary = ''
      let extractedSkills: string[] = []
      let extractedRequirements: string[] = []
      let salary = item.salary
      let location = item.location
      let company = item.company
      let role = item.role

      if (item.description.trim()) {
        try {
          const parsed = await parseJobPosting(item.description)
          jdSummary = parsed.summary || ''
          if (parsed.skills?.length) extractedSkills = parsed.skills
          if (parsed.requirements?.length) extractedRequirements = parsed.requirements
          if (parsed.salary) salary = parsed.salary
          if (parsed.location) location = parsed.location
          if (parsed.company) company = parsed.company
          if (parsed.role) role = parsed.role
        } catch {
          // Adzuna approve still works offline / without Gemini
        }
      }

      if (current.current.account !== owner || inboxRef.current.find(entry => entry.id === id)?.status !== 'new') throw new Error('This inbox item changed. Please review it again.')
      const jobText = `${role}\n${item.description}`
      // Parsing can finish after a template was deleted or a search reassigned.
      const latest = sourcesNow()
      const search = latest.searches.find((entry) => entry.id === item.savedSearchId)
      if (search && !searchHasLiveSource(latest.library,search)) throw new Error('Choose a CV in this saved search before approving its jobs.')
      if (!search && item.matchedTrack && !latest.library.cvs[item.matchedTrack]) throw new Error('The source CV was deleted. Choose a CV before approving this job.')
      const currentMatch = pickMatch(jobText, search?.track ?? (item.matchedTrack && latest.library.cvs[item.matchedTrack] ? item.matchedTrack : 'auto'), latest.library.cvs, latest.library.names)
      const track = currentMatch.track
      extractedSkills = withRequirementSignals(jobText, extractedSkills)
      const coverage = scoreMasterCvAgainstJob(jobText, latest.library.cvs[track], extractedSkills)

      const job = createEmptyJob({
        company,
        role,
        location,
        jobUrl: item.jobUrl,
        salary,
        status: 'saved',
        jobDescription: item.description,
        jdSummary,
        extractedSkills: extractedSkills.length ? extractedSkills : coverage.targets,
        extractedRequirements,
        notes: `Approved from inbox (${item.source}). Match ${coverage.score}% · ${latest.library.names[track]}.`,
        source: item.source,
        externalId: item.externalId,
        savedSearchId: item.savedSearchId,
        matchScore: coverage.score,
        cvTrack: track,
        // API listings are usually snippets — paste full JD on Job Detail to complete.
        jdComplete: false,
      })

      if (inFlightSave.current) throw new Error('A previous Inbox save is still awaiting a response. Try again after it finishes.')
      await addJob(job)
      await updateInboxItem(id, { status: 'approved' })
      return job.id
    },
    [account, addJob, updateInboxItem, isCloudSync, sourcesNow]
  )

  const dismissJob = useCallback(
    async (id: string) => {
      await updateInboxItem(id, { status: 'dismissed' })
    },
    [updateInboxItem]
  )

  const newCount = useMemo(() => inbox.filter((i) => i.status === 'new').length, [inbox])

  const scoredInbox = useMemo(() => inbox.map((item) => {
    if (item.status !== 'new') return item
    const search = searches.find((entry) => entry.id === item.savedSearchId)
    if (item.needsCvSelection && !search) return {...item,matchedTrack:null,matchScore:0,matchReasons:['Source CV deleted. Choose a source before approving this job.']}
    if (search && !searchHasLiveSource(library,search)) return {...item,matchedTrack:null,matchScore:0,matchReasons:['Choose a CV in the saved search before approving this job.']}
    try {
      const match = pickMatch(`${item.role}\n${item.description}`, search?.track ?? (item.matchedTrack && cvsByTrack[item.matchedTrack] ? item.matchedTrack : 'auto'), cvsByTrack, library.names, matchJob)
      return { ...item, needsCvSelection:false, matchedTrack: match.track, matchScore: match.score, matchReasons: match.reasons }
    } catch { return { ...item, matchScore: 0, matchReasons: ['Selected CV unavailable. Update the saved search before approval.'] } }
  }).sort((a, b) => b.matchScore - a.matchScore), [inbox, searches, cvsByTrack, library, matchJob])

  const value = { inbox: loadedOwner.current === account ? scoredInbox : [], loading, refreshing, refreshError, refreshReport, newCount, refreshInbox, retryFailedSearches, retryInboxSave, clearReviewList, approveJob, dismissJob }

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}

export function useInbox() {
  const context = useContext(InboxContext)
  if (!context) throw new Error('useInbox must be used within InboxProvider')
  return context
}
