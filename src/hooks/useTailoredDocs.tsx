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
import { rowToTailoredDocument, tailoredDocumentToRow } from '../lib/database'
import { supabase } from '../lib/supabase'
import type { TailoredDocument } from '../types/cv'
import { useAuth } from './useAuth'

const LOCAL_KEY = 'applytrack-tailored-docs'

interface TailoredDocsContextValue {
  docs: TailoredDocument[]
  loading: boolean
  getForJob: (jobId: string) => TailoredDocument | undefined
  saveDoc: (doc: TailoredDocument, validate?: () => boolean) => Promise<void>
}

const TailoredDocsContext = createContext<TailoredDocsContextValue | null>(null)

function readLocal(): TailoredDocument[] {
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
  const isCloudSync = isCloudEnabled && Boolean(userId)

  const load = useCallback(async () => {
    const account = owner
    loadedOwner.current = account
    setLoading(true)
    setDocs([])
    docsRef.current = []
    try {
      if (!isCloudSync || !supabase || !userId) {
        setDocs(readLocal())
        return
      }
      const { data, error } = await supabase
        .from('tailored_documents')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
      if (error) throw error
      if (ownerRef.current === account) { docsRef.current = (data ?? []).map(rowToTailoredDocument); setDocs(docsRef.current) }
    } catch (err) {
      console.error('Failed to load tailored docs:', err)
      if (ownerRef.current === account) setDocs(isCloudSync ? [] : readLocal())
    } finally {
      if (ownerRef.current === account) setLoading(false)
    }
  }, [isCloudSync, userId, owner])

  useEffect(() => {
    load()
  }, [load])

  const saveDoc = useCallback(
    (doc: TailoredDocument, validate: () => boolean = () => true) => {
      const account = owner
      const operation = saves.current.catch(() => {}).then(async () => {
        const check = () => {
          if (ownerRef.current !== account || account === 'signed-out') throw new Error('Account changed')
          if (!validate()) throw new Error('This job or its CV changed. Restart tailoring.')
        }
        check()
        const nextDoc = { ...doc, updatedAt: new Date().toISOString() }
        if (isCloudSync && supabase && userId) {
          const { error } = await supabase.from('tailored_documents').upsert(tailoredDocumentToRow(nextDoc, userId), { onConflict: 'user_id,job_application_id' })
          if (error) throw error
        }
        check()
        const next = mergeTailoredDocument(docsRef.current, nextDoc)
        if (!isCloudSync) writeLocal(next)
        docsRef.current = next
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
