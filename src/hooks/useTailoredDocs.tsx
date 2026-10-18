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
import { mergeTailoredDocument } from '../lib/documentPersistence'
import { jobToRow, rowToTailoredDocument, tailoredDocumentToRow } from '../lib/database'
import { supabase } from '../lib/supabase'
import type { TailoredDocument } from '../types/cv'
import { useAuth } from './useAuth'
import { JOBS_CHANGED } from '../lib/purgeJobs'
import { recoverCvTransaction } from '../lib/cvLibrary'
import { withLocalMutation } from '../lib/localMutation'
import { useJobs } from './useJobs'
import { useMasterCv } from './useMasterCv'

const LOCAL_KEY = 'applytrack-tailored-docs'

interface TailoredDocsContextValue {
  docs: TailoredDocument[]
  loading: boolean
  getForJob: (jobId: string) => TailoredDocument | undefined
  saveDoc: (doc: TailoredDocument, validate?: () => boolean) => Promise<void>
}

const TailoredDocsContext = createContext<TailoredDocsContextValue | null>(null)

function readLocal(): TailoredDocument[] {
  recoverCvTransaction(localStorage)
  try {
    const stored = localStorage.getItem(LOCAL_KEY)
    return stored ? (JSON.parse(stored) as TailoredDocument[]) : []
  } catch {
    return []
  }
}

function writeLocal(docs: TailoredDocument[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(docs))
}

export function TailoredDocsProvider({ children }: { children: ReactNode }) {
  const { getJob } = useJobs()
  const { library } = useMasterCv()
  const liveSource = useRef({getJob,library})
  liveSource.current={getJob,library}
  const { user, isCloudEnabled } = useAuth()
  const userId = user?.id
  const [docs, setDocs] = useState<TailoredDocument[]>([])
  const [loading, setLoading] = useState(true)
  const docsRef = useRef(docs)
  docsRef.current = docs
  const owner = isCloudEnabled ? userId ?? 'signed-out' : 'local'
  const loadedOwner = useRef(owner)
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const saves = useRef<Promise<unknown>>(Promise.resolve())
  const revision = useRef(0)
  const isCloudSync = isCloudEnabled && Boolean(userId)

  const load = useCallback(async () => {
    const version = ++revision.current
    const account = owner
    loadedOwner.current = account
    setLoading(true)
    setDocs([])
    docsRef.current = []
    try {
      if (!isCloudSync || !supabase || !userId) {
        const next=await withLocalMutation(readLocal)
        if(ownerRef.current===account && version===revision.current){docsRef.current=next;setDocs(next)}
        return
      }
      const { data, error } = await supabase
        .from('tailored_documents')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
      if (error) throw error
      if (ownerRef.current === account && version === revision.current) { docsRef.current = (data ?? []).map(rowToTailoredDocument); setDocs(docsRef.current) }
    } catch (err) {
      console.error('Failed to load tailored docs:', err)
    } finally {
      if (ownerRef.current === account && version === revision.current) setLoading(false)
    }
  }, [isCloudSync, userId, owner])

  useEffect(() => {
    void load()
    const refresh = () => { void load() }
    window.addEventListener(JOBS_CHANGED, refresh)
    const storage=(event:StorageEvent)=>{if(!isCloudSync && event.key==='applytrack-tailored-docs')refresh()}
    window.addEventListener('storage',storage)
    return () => { window.removeEventListener(JOBS_CHANGED, refresh); window.removeEventListener('storage',storage) }
  }, [load, isCloudSync])

  const saveDoc = useCallback(
    (doc: TailoredDocument, validate: () => boolean = () => true) => {
      const account = owner
      const operation = saves.current.catch(() => {}).then(async () => {
        revision.current++;setLoading(false)
        const check = () => {
          if (ownerRef.current !== account || account === 'signed-out') throw new Error('Account changed')
          if (!validate()) throw new Error('This job or its CV changed. Restart tailoring.')
        }
        check()
        const nextDoc = { ...doc, updatedAt: new Date().toISOString() }
        if (isCloudSync && supabase && userId) {
          const job=liveSource.current.getJob(doc.jobApplicationId)
          if(!job)throw new Error('Application no longer exists')
          const { error } = await supabase.rpc('save_tailored_document_v2',{p_document:tailoredDocumentToRow(nextDoc,userId),p_expected_job:jobToRow(job,userId),p_expected_library:liveSource.current.library,p_owner_id:userId})
          if (error) throw error
        }
        check()
        const next = isCloudSync ? mergeTailoredDocument(docsRef.current, nextDoc) : await withLocalMutation(() => {
          check()
          const jobs = JSON.parse(localStorage.getItem('job-tracker-applications') ?? '[]') as { id: string; status: string; deletedAt?: string | null; needsCvSelection?: boolean }[]
          if (!jobs.some(job => job.id === doc.jobApplicationId && job.status === 'saved' && !job.deletedAt && !job.needsCvSelection)) throw new Error('Application or source no longer available.')
          const updated = mergeTailoredDocument(readLocal(), nextDoc)
          writeLocal(updated)
          return updated
        })
        docsRef.current = next
        revision.current++;setLoading(false)
        setDocs(next)
      })
      saves.current = operation
      return operation
    },
    [isCloudSync, userId, owner]
  )

  const accountDocs = useMemo(() => loadedOwner.current === owner ? docs : [], [docs, owner])
  const getForJob = useCallback(
    (jobId: string) => accountDocs.find((d) => d.jobApplicationId === jobId),
    [accountDocs]
  )

  const value = useMemo(
    () => ({ docs: accountDocs, loading, getForJob, saveDoc }),
    [accountDocs, loading, getForJob, saveDoc]
  )

  return <TailoredDocsContext.Provider value={value}>{children}</TailoredDocsContext.Provider>
}

export function useTailoredDocs() {
  const context = useContext(TailoredDocsContext)
  if (!context) throw new Error('useTailoredDocs must be used within TailoredDocsProvider')
  return context
}
