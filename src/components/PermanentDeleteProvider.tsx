import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useJobs } from '../hooks/useJobs'
import { capturePurgeTargets, type PurgeTarget } from '../lib/purgeJobs'
import { DeleteDialog } from './DeleteDialog'
import { PermanentDeleteContext, type OpenPermanentDelete } from '../hooks/usePermanentDelete'
interface Target { account: string; route: string; tuples: PurgeTarget[]; role: string; company: string; bulk: boolean; detail: boolean }
export function PermanentDeleteProvider({ children }: { children: ReactNode }) {
  const { user, isCloudEnabled } = useAuth()
  const account = isCloudEnabled ? user?.id ?? 'signed-out' : 'local'
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { emptyTrash } = useJobs()
  const current = useRef({ account, pathname })
  current.current = { account, pathname }
  const [target, setTarget] = useState<Target | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const attempt = useRef(0)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const focus = () => {
    const element = trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLElement>('[data-trash-focus], main h1')
    if (element) { if (element.tagName !== 'BUTTON') element.tabIndex = -1; element.focus() }
  }
  const invalidate=useCallback(()=>{attempt.current++;busy.current=false},[])
  useEffect(() => {
    attempt.current++; busy.current = false; setPending(false); setTarget(null); setError(null); setResult(null)
    return invalidate
  }, [account, pathname, invalidate])
  const open: OpenPermanentDelete = (jobs, bulk, button, detail = false) => {
    const tuples = capturePurgeTargets(jobs)
    if (!tuples.length || busy.current) return
    trigger.current = button; setError(null); setResult(null)
    setTarget({ account, route: pathname, tuples, role: jobs[0]?.role || 'Untitled role', company: jobs[0]?.company || 'Unknown company', bulk, detail })
  }
  const close = () => { if (busy.current) return; setTarget(null); setError(null); setResult(null); requestAnimationFrame(focus) }
  const confirm = async () => {
    if (!target || busy.current) return
    const selected = target, version = ++attempt.current
    const valid = () => current.current.account === selected.account && current.current.pathname === selected.route && version === attempt.current
    busy.current = true; setPending(true); setError(null)
    try {
      const deleted = await emptyTrash(selected.tuples, valid)
      if (!valid()) return
      const skipped = selected.tuples.length - deleted.length
      if (skipped) setResult(`${deleted.length} deleted; ${skipped} changed or restored and were not deleted. Close and reopen for a fresh confirmation.`)
      else {
        setTarget(null)
        if (selected.detail) navigate('/')
        requestAnimationFrame(focus)
      }
    } catch {
      if (valid()) setError(selected.bulk ? 'Could not empty Trash. Please try again.' : 'Could not permanently delete this application. Please try again.')
    } finally { if (version === attempt.current) { busy.current = false; setPending(false) } }
  }
  return <PermanentDeleteContext.Provider value={open}>{children}<DeleteDialog open={Boolean(target)} title={target?.bulk ? 'Empty trash?' : 'Permanently delete application?'} pending={pending} error={error} result={result}
    confirmLabel={target?.bulk ? 'Empty trash' : 'Delete permanently'} pendingLabel={target?.bulk ? 'Emptying…' : 'Deleting…'} onCancel={close} onConfirm={() => void confirm()}>
    {target?.bulk ? `Permanently delete all ${target.tuples.length} ${target.tuples.length === 1 ? 'application' : 'applications'} in Trash and ${target.tuples.length === 1 ? 'its' : 'their'} saved application documents, including applications hidden by your current search? This cannot be undone.`
      : `Permanently delete ‘${target?.role}’ at ‘${target?.company}’ and its saved application documents? This cannot be undone.`}
  </DeleteDialog></PermanentDeleteContext.Provider>
}

