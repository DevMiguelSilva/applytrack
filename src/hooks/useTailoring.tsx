import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { tailorMasterCv } from '../api/gemini'
import { captureTailoringInput } from '../lib/tailoringInputs'
import { BackgroundTasks } from '../lib/backgroundTasks'
import { masterCvToProfile } from '../lib/cvProfile'
import { buildGapReport } from '../lib/matchScore'
import { lockSkillGroupsToMaster, masterCvSearchText, mergeClaimedSkillsIntoGroups, type TailoredDocument } from '../types/cv'
import { useAuth } from './useAuth'
import { useJobs } from './useJobs'
import { useMasterCv } from './useMasterCv'
import { useTailoredDocs } from './useTailoredDocs'

function useTailoringState() {
  const auth = useAuth()
  const jobs = useJobs()
  const cvs = useMasterCv()
  const docs = useTailoredDocs()
  const account = auth.isCloudEnabled ? auth.user?.id ?? 'signed-out' : 'local'
  const current = useRef({ jobs, cvs, docs, account })
  current.current = { jobs, cvs, docs, account }
  const [, refresh] = useState(0)
  // Recreate on account change so an old account can never expose in-memory output.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const manager = useMemo(() => new BackgroundTasks<TailoredDocument>(() => refresh(value => value + 1)), [account])
  useEffect(() => () => manager.reset(), [manager])
  // Old asynchronous runs cannot publish into the new account's manager.
  const snapshot = (id: string) => {
    const state = current.current
    if (state.account === 'signed-out' || state.cvs.loadError) return null
    return captureTailoringInput(state.jobs.getJob(id), state.cvs.library)
  }
  const validate = (id: string, fingerprint: string) => current.current.account === account && snapshot(id)?.fingerprint === fingerprint
  useEffect(() => {
    for (const task of Object.values(manager.tasks)) {
      if (!validate(task.jobId, task.fingerprint)) manager.invalidate(task.jobId)
    }
  })
  const save = async (doc: TailoredDocument, fingerprint: string, stillCurrent: () => boolean) => {
    const valid = () => stillCurrent() && validate(doc.jobApplicationId, fingerprint)
    if (!valid()) throw new Error('This job or its CV changed. Restart tailoring.')
    await current.current.jobs.updateJob(doc.jobApplicationId, { matchScore: doc.matchScore }, valid)
    if (!valid()) throw new Error('This job or its CV changed. Restart tailoring.')
    await current.current.jobs.withJobLock(doc.jobApplicationId, valid, () => current.current.docs.saveDoc(doc, valid))
  }
  const start = async (id: string) => {
    if (current.current.jobs.loading || current.current.cvs.loading || current.current.docs.loading) return
    const input = snapshot(id)
    if (!input) return
    const { job, cv, fingerprint } = input
    const previous = docs.getForJob(id)
    await manager.start(id, `${job.company} · ${job.role}`, fingerprint, async () => {
      if (!cv.contact.name.trim() && !cv.summary.trim()) throw new Error('Fill in your Master CV first')
      const result = await tailorMasterCv(job, cv, masterCvToProfile(cv))
      const coverLetter = (result.coverLetter || '').trim()
      if (!coverLetter) throw new Error('Tailor did not return a cover letter. Please retry.')
      const tailoredCv = {
        ...cv,
        headline: result.headline || cv.headline,
        summary: result.summary || cv.summary,
        skills: mergeClaimedSkillsIntoGroups(lockSkillGroupsToMaster(cv.skills, result.skills), job.claimedSkills ?? []),
        experience: result.experience?.length ? result.experience : cv.experience,
        projects: result.projects?.length ? result.projects : cv.projects,
        updatedAt: new Date().toISOString(),
      }
      const gapReport = buildGapReport(`${job.role}\n${job.jobDescription}`, job.extractedSkills, masterCvSearchText(cv), job.claimedSkills ?? [])
      const now = new Date().toISOString()
      return { id: previous?.id ?? crypto.randomUUID(), jobApplicationId: id, masterCvSnapshot: cv, tailoredCv, coverLetter, gapReport, matchScore: gapReport.coveragePercent, createdAt: previous?.createdAt ?? now, updatedAt: now }
    }, () => validate(id, fingerprint), (doc, valid) => save(doc, fingerprint, valid))
  }
  const retrySave = async (id: string) => {
    const task = manager.tasks[id]
    if (!task) return
    await manager.retry(id, () => validate(id, task.fingerprint), (doc, valid) => save(doc, task.fingerprint, valid))
  }
  return { tasks: account === 'signed-out' ? {} : manager.tasks, start, retrySave, canStart: (id: string) => Boolean(snapshot(id)), dismiss: (id: string) => manager.dismiss(id) }
}

const Context = createContext<ReturnType<typeof useTailoringState> | null>(null)
export function TailoringProvider({ children }: { children: ReactNode }) {
  const value = useTailoringState()
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useTailoring() {
  const context = useContext(Context)
  if (!context) throw new Error('useTailoring requires TailoringProvider')
  return context
}
