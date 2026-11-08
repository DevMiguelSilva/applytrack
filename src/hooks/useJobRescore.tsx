import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { parseJobPosting } from '../api/gemini'
import { BackgroundTasks, type BackgroundTask } from '../lib/backgroundTasks'
import { captureJobRescoreInput } from '../lib/jobRescore'
import { scoreMasterCvAgainstJob, withRequirementSignals } from '../lib/matchScore'
import { normalizeLibrary } from '../types/cv'
import type { JobApplication } from '../types/job'
import { useAuth } from './useAuth'
import { useJobs } from './useJobs'
import { useMasterCv } from './useMasterCv'

export interface JobRescoreOutput {
  updates: Partial<JobApplication>
  score: number
}

function useJobRescoreState() {
  const auth = useAuth()
  const jobs = useJobs()
  const cvs = useMasterCv()
  const account = auth.isCloudEnabled ? auth.user?.id ?? 'signed-out' : 'local'
  const current = useRef({ jobs, cvs, account })
  current.current = { jobs, cvs, account }
  const committed = useRef(new Set<string>())
  const [, refresh] = useState(0)
  // A new account gets a separate in-memory task manager.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const manager = useMemo(() => new BackgroundTasks<JobRescoreOutput>(() => refresh(value => value + 1)), [account])
  useEffect(() => () => manager.reset(), [manager])

  const librarySnapshot = () => {
    const state = current.current
    if (state.account === 'local') {
      try {
        const raw = localStorage.getItem('applytrack-master-cv')
        if (raw) return normalizeLibrary(JSON.parse(raw))
      } catch {
        return state.cvs.library
      }
    }
    return state.cvs.library
  }
  const capture = (id: string, latestJob?: JobApplication) => {
    const state = current.current
    return captureJobRescoreInput(latestJob ?? state.jobs.getJob(id), librarySnapshot(), state.account)
  }
  const isCurrent = (id: string, fingerprint: string, latestJob?: JobApplication) => {
    if (current.current.account !== account) return false
    if (latestJob && latestJob.id !== id) return false
    return capture(id, latestJob)?.fingerprint === fingerprint
  }

  useEffect(() => {
    for (const task of Object.values(manager.tasks)) {
      if (task.phase === 'completed' || (task.phase === 'saving' && committed.current.has(task.jobId))) continue
      if (task.phase === 'failed' && !task.output && task.error?.startsWith('The job or its CV changed')) continue
      if ((task.phase === 'running' || task.phase === 'saving' || task.output) && !isCurrent(task.jobId, task.fingerprint)) {
        manager.invalidate(task.jobId, 'The job or its CV changed. Start a new rescore to use the latest information.')
      } else if (task.phase === 'failed' && !isCurrent(task.jobId, task.fingerprint)) {
        manager.dismiss(task.jobId)
      }
    }
  })

  const save = async (id: string, task: BackgroundTask<JobRescoreOutput>, output: JobRescoreOutput, stillCurrent: () => boolean) => {
    const valid = (latestJob?: JobApplication) => committed.current.has(id) || (stillCurrent() && isCurrent(id, task.fingerprint, latestJob))
    await current.current.jobs.updateJob(id, output.updates, valid)
    committed.current.add(id)
  }

  const start = async (id: string) => {
    const state = current.current
    const job = state.jobs.getJob(id)
    if (state.account === 'signed-out' || state.jobs.loading || state.cvs.loading || state.cvs.loadError || !job?.needsRescore) return
    const input = capture(id)
    if (!input) return
    committed.current.delete(id)
    const { job: snapshot, cv, fingerprint } = input
    const task: BackgroundTask<JobRescoreOutput> = {
      jobId: id,
      label: `${snapshot.company} · ${snapshot.role}`,
      phase: 'running',
      fingerprint,
    }
    await manager.start(id, task.label, fingerprint, async () => {
      const parsed = await parseJobPosting(snapshot.jobDescription)
      const jdSummary = parsed.summary || snapshot.jdSummary
      let extractedSkills = parsed.skills?.length ? parsed.skills : []
      const extractedRequirements = parsed.requirements?.length ? parsed.requirements : snapshot.extractedRequirements
      const company = parsed.company || snapshot.company
      const role = parsed.role || snapshot.role
      const location = parsed.location || snapshot.location
      const salary = parsed.salary || snapshot.salary
      const described = `${role}\n${snapshot.jobDescription}`
      extractedSkills = withRequirementSignals(described, extractedSkills)
      const match = scoreMasterCvAgainstJob(described, cv, extractedSkills)
      return {
        score: match.score,
        updates: {
          jobDescription: snapshot.jobDescription,
          jdSummary,
          extractedSkills: extractedSkills.length ? extractedSkills : match.targets,
          extractedRequirements,
          company,
          role,
          location,
          salary,
          matchScore: match.score,
          jdComplete: true,
          needsRescore: false,
        },
      }
    }, () => committed.current.has(id) || isCurrent(id, fingerprint), (output, stillCurrent) => save(id, task, output, stillCurrent))
  }

  const retrySave = async (id: string) => {
    const task = manager.tasks[id]
    if (task?.phase !== 'failed' || !task.output) return
    committed.current.delete(id)
    await manager.retry(id, () => committed.current.has(id) || isCurrent(id, task.fingerprint), (output, stillCurrent) => save(id, task, output, stillCurrent))
  }

  return {
    tasks: account === 'signed-out' ? {} : manager.tasks,
    start,
    retrySave,
    canStart: (id: string) => Boolean(current.current.jobs.getJob(id)?.needsRescore && capture(id)),
    dismiss: (id: string) => manager.dismiss(id),
  }
}

const Context = createContext<ReturnType<typeof useJobRescoreState> | null>(null)

export function JobRescoreProvider({ children }: { children: ReactNode }) {
  const value = useJobRescoreState()
  return <Context.Provider value={value}>{children}</Context.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useJobRescore() {
  const context = useContext(Context)
  if (!context) throw new Error('useJobRescore requires JobRescoreProvider')
  return context
}
