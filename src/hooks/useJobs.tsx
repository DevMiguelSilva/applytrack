import { changedJobColumns } from '../lib/documentPersistence'
import { CV_LIBRARY_EVENT, recoverCvTransaction } from '../lib/cvLibrary'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react'
import { resolveAppliedDate } from '../lib/appliedDate'
import { jobToRow, rowToJob } from '../lib/database'
import { supabase } from '../lib/supabase'
import type { JobApplication, JobStatus } from '../types/job'
import { createEmptyJob, resolveInterviews, resolveJdComplete } from '../types/job'
import { localDateKey } from '../types/portal'
import { useAuth } from './useAuth'

const LOCAL_STORAGE_KEY = 'job-tracker-applications'
const MIGRATED_KEY = 'job-tracker-migrated'

interface JobsContextValue {
  /** All jobs including trash (for streaks / inbox external-id blocking). */
  jobs: JobApplication[]
  /** Active board jobs (not in trash). */
  activeJobs: JobApplication[]
  /** Soft-deleted jobs. */
  trashedJobs: JobApplication[]
  loading: boolean
  addJob: (job: JobApplication) => Promise<void>
  updateJob: (id: string, updates: Partial<JobApplication>, validate?: () => boolean) => Promise<void>
  /** Soft-delete → Trash (recoverable). */
  deleteJob: (id: string) => Promise<void>
  restoreJob: (id: string) => Promise<void>
  /** Permanently remove from trash. */
  purgeJob: (id: string) => Promise<void>
  /** Permanently remove every job in trash. */
  emptyTrash: () => Promise<void>
  moveJob: (id: string, status: JobStatus) => Promise<void>
  getJob: (id: string) => JobApplication | undefined
  isCloudSync: boolean
  withJobLock: (id: string, validate: () => boolean, operation: () => Promise<void>) => Promise<void>
}

const JobsContext = createContext<JobsContextValue | null>(null)

function normalizeJob(
  job: JobApplication & { interviewDate?: string; interviewStage?: string | null }
): JobApplication {
  const status = job.status ?? 'saved'
  const updatedAt = job.updatedAt ?? createEmptyJob().updatedAt
  const { interviewDate, interviewStage: _interviewStage, ...rest } = job
  return {
    ...createEmptyJob(),
    ...rest,
    status,
    // Saved jobs are not applications — drop stale applied dates from undo moves
    appliedDate: resolveAppliedDate(status, job.appliedDate, updatedAt),
    source: job.source ?? 'manual',
    externalId: job.externalId ?? '',
    savedSearchId: job.savedSearchId ?? null,
    matchScore: job.matchScore ?? null,
    cvTrack: job.cvTrack ?? null,
    jdSummary: job.jdSummary ?? '',
    extractedSkills: job.extractedSkills ?? [],
    extractedRequirements: job.extractedRequirements ?? [],
    claimedSkills: job.claimedSkills ?? [],
    interviews: resolveInterviews({
      interviews: rest.interviews,
      interviewDate,
    }),
    jdComplete: resolveJdComplete({
      jdComplete: job.jdComplete,
      source: job.source ?? 'manual',
    }),
    needsRescore: job.needsRescore === true,
    deletedAt: job.deletedAt ?? null,
    notSelected: job.notSelected === true,
  }
}

function readLocalJobs(): JobApplication[] {
  recoverCvTransaction(localStorage)
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!stored) return []
    const raw = JSON.parse(stored) as JobApplication[]
    const normalized = raw.map(normalizeJob)
    if (normalized.some((job, i) => job.appliedDate !== (raw[i]?.appliedDate ?? ''))) {
      writeLocalJobs(normalized)
    }
    return normalized
  } catch {
    return []
  }
}

function writeLocalJobs(jobs: JobApplication[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(jobs))
}

export function JobsProvider({ children }: { children: ReactNode }) {
  const { user, isCloudEnabled } = useAuth()
  const userId = user?.id
  const [jobs, setJobs] = useState<JobApplication[]>([])
  const [loading, setLoading] = useState(true)
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const owner = isCloudEnabled ? userId ?? 'signed-out' : 'local'
  const loadedOwner = useRef(owner)
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const updatesQueue = useRef<Promise<unknown>>(Promise.resolve())
  const isCloudSync = isCloudEnabled && Boolean(userId)

  const loadJobs = useCallback(async () => {
    const account = owner
    if (loadedOwner.current !== account) { jobsRef.current = []; setJobs([]); loadedOwner.current = account }
    setLoading(true)
    try {
      if (!isCloudSync || !supabase || !userId) {
        setJobs(readLocalJobs())
        return
      }

      const { data, error } = await supabase
        .from('job_applications')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })

      if (error) throw error

      if (ownerRef.current !== account) return
      let cloudJobs = (data ?? []).map(rowToJob)

      const localJobs = readLocalJobs()
      const alreadyMigrated = localStorage.getItem(MIGRATED_KEY) === userId

      if (!alreadyMigrated && localJobs.length > 0) {
        const rows = localJobs.map((job) => jobToRow(job, userId))
        const { error: insertError } = await supabase.from('job_applications').upsert(rows)
        if (!insertError) {
          localStorage.setItem(MIGRATED_KEY, userId)
          cloudJobs = [...localJobs, ...cloudJobs.filter((j) => !localJobs.some((l) => l.id === j.id))]
        }
      }

      const normalized = cloudJobs.map(normalizeJob)
      // Persist applied-date repairs (UTC evening skew → wrong calendar day)
      if (supabase && userId) {
        const repairs = normalized.filter((job, i) => {
          const raw = cloudJobs[i]
          return raw && job.appliedDate !== (raw.appliedDate ?? '')
        })
        if (repairs.length > 0) {
          const rows = repairs.map((job) => ({
            ...jobToRow(job, userId),
            updated_at: new Date().toISOString(),
          }))
          void supabase.from('job_applications').upsert(rows)
        }
      }
      if (ownerRef.current === account) { jobsRef.current = normalized; setJobs(normalized) }
    } catch (err) {
      console.error('Failed to load jobs:', err)
      if (ownerRef.current === account) setJobs(isCloudSync ? [] : readLocalJobs())
    } finally {
      if (ownerRef.current === account) setLoading(false)
    }
  }, [isCloudSync, userId, owner])

  useEffect(() => {
    void loadJobs()
    const refresh = () => { void loadJobs() }
    window.addEventListener(CV_LIBRARY_EVENT, refresh)
    return () => window.removeEventListener(CV_LIBRARY_EVENT, refresh)
  }, [loadJobs])

  const persistLocal = useCallback((next: JobApplication[]) => {
    setJobs(next)
    writeLocalJobs(next)
  }, [])

  const addJob = useCallback(
    async (job: JobApplication) => {
      const normalized = normalizeJob({ ...job, deletedAt: null })
      if (isCloudSync && supabase && userId) {
        const row = { ...jobToRow(normalized, userId), updated_at: new Date().toISOString() }
        const { error } = await supabase.from('job_applications').insert(row)
        if (error) throw error
        setJobs((prev) => [normalized, ...prev])
      } else {
        persistLocal([normalized, ...jobs])
      }
    },
    [isCloudSync, userId, jobs, persistLocal]
  )

  const updateJob = useCallback(
    (id: string, updates: Partial<JobApplication>, validate: () => boolean = () => true) => {
      const account = owner
      const operation = updatesQueue.current.catch(() => {}).then(async () => {
        if (ownerRef.current !== account) throw new Error('Account changed')
        if (!validate()) throw new Error('This job or its CV changed. Restart tailoring.')
        const current = jobsRef.current.find((job) => job.id === id)
        if (!current) throw new Error('Application no longer exists')
        const updatedAt = new Date().toISOString()
        const updated = normalizeJob({ ...current, ...updates, updatedAt })
        if (isCloudSync && supabase && userId) {
          // Patch changed columns only: a score update must never upsert an old full job.
          const before = jobToRow(current, userId)
          const after = jobToRow(updated, userId)
          const patch = changedJobColumns(before, after)
          const { error } = await supabase.from('job_applications').update({ ...patch, updated_at: updatedAt }).eq('id', id).eq('user_id', userId)
          if (error) throw error
        }
        if (ownerRef.current !== account) throw new Error('Account changed')
        const next = jobsRef.current.map((job) => job.id === id ? normalizeJob({ ...job, ...updates, updatedAt }) : job)
        if (!isCloudSync) writeLocalJobs(next)
        jobsRef.current = next
        setJobs(next)
      })
      updatesQueue.current = operation
      return operation
    },
    [isCloudSync, userId, owner]
  )

  // Keep a dispatched document save ordered before a subsequent status/input edit.
  const withJobLock = useCallback((id: string, validate: () => boolean, operation: () => Promise<void>) => {
    const account = owner
    const pending = updatesQueue.current.catch(() => {}).then(async () => {
      if (ownerRef.current !== account || !jobsRef.current.some(job => job.id === id) || !validate()) {
        throw new Error('This job or its CV changed. Restart tailoring.')
      }
      await operation()
    })
    updatesQueue.current = pending
    return pending
  }, [owner])

  const deleteJob = useCallback(
    async (id: string) => {
      await updateJob(id, { deletedAt: new Date().toISOString() })
    },
    [updateJob]
  )

  const restoreJob = useCallback(
    async (id: string) => {
      await updateJob(id, { deletedAt: null })
    },
    [updateJob]
  )

  const purgeJob = useCallback(
    async (id: string) => {
      if (isCloudSync && supabase) {
        const { error } = await supabase.from('job_applications').delete().eq('id', id)
        if (error) throw error
      } else {
        persistLocal(jobs.filter((job) => job.id !== id))
        return
      }
      setJobs((prev) => prev.filter((job) => job.id !== id))
    },
    [isCloudSync, jobs, persistLocal]
  )

  const emptyTrash = useCallback(async () => {
    const remaining = jobs.filter((job) => !job.deletedAt)
    const ids = jobs.filter((job) => job.deletedAt).map((job) => job.id)
    if (ids.length === 0) return
    if (isCloudSync && supabase) {
      const { error } = await supabase.from('job_applications').delete().in('id', ids)
      if (error) throw error
      setJobs(remaining)
      return
    }
    persistLocal(remaining)
  }, [isCloudSync, jobs, persistLocal])

  const moveJob = useCallback(
    async (id: string, status: JobStatus) => {
      const job = jobs.find((j) => j.id === id)
      if (!job || job.deletedAt) return
      let appliedDate = ''
      if (status !== 'saved') {
        const existing = job.appliedDate?.trim().slice(0, 10)
        if (existing && /^\d{4}-\d{2}-\d{2}$/.test(existing)) {
          appliedDate = resolveAppliedDate(status, existing, job.updatedAt)
        } else {
          appliedDate = localDateKey()
        }
      }
      await updateJob(id, {
        status,
        appliedDate,
        ...(status !== 'interview' ? { notSelected: false } : {}),
      })
    },
    [jobs, updateJob]
  )

  const accountJobs = useMemo(() => loadedOwner.current === owner ? jobs : [], [jobs, owner])
  const getJob = useCallback((id: string) => accountJobs.find((job) => job.id === id), [accountJobs])

  const activeJobs = useMemo(() => accountJobs.filter((j) => !j.deletedAt), [accountJobs])
  const trashedJobs = useMemo(() => accountJobs.filter((j) => Boolean(j.deletedAt)), [accountJobs])

  const value = useMemo(
    () => ({
      jobs: accountJobs,
      activeJobs,
      trashedJobs,
      loading,
      addJob,
      updateJob,
      withJobLock,
      deleteJob,
      restoreJob,
      purgeJob,
      emptyTrash,
      moveJob,
      getJob,
      isCloudSync,
    }),
    [
      accountJobs,
      activeJobs,
      trashedJobs,
      loading,
      addJob,
      updateJob,
      withJobLock,
      deleteJob,
      restoreJob,
      purgeJob,
      emptyTrash,
      moveJob,
      getJob,
      isCloudSync,
    ]
  )

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}

export function useJobs() {
  const context = useContext(JobsContext)
  if (!context) throw new Error('useJobs must be used within JobsProvider')
  return context
}

export { createEmptyJob }
