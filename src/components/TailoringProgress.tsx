import { Link } from 'react-router-dom'
import { useTailoring } from '../hooks/useTailoring'

export function TailoringProgress() {
  const { tasks, dismiss, retrySave, start, canStart, hideNotification } = useTailoring()
  return <aside aria-label="Document generation" className="fixed bottom-[calc(6.25rem+env(safe-area-inset-bottom))] right-4 z-40 max-h-[40vh] w-[calc(100%-2rem)] max-w-sm space-y-2 overflow-y-auto sm:bottom-4">
    {Object.values(tasks).filter(task => !task.notificationHidden).map(task => <div key={task.jobId} className="rounded-xl border border-brand-line bg-white p-4 text-sm text-brand-ink shadow-sm">
      <p className="break-words font-semibold">{task.label}</p>
      <p role="status" className="mt-1 text-brand-muted">{task.phase === 'running' ? 'Tailoring resume and cover letter…' : task.phase === 'saving' ? 'Saving application files…' : task.phase === 'completed' ? 'Resume and cover letter saved' : task.error}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link className="underline focus-visible:outline-brand-primary" to={`/job/${task.jobId}`} onClick={() => hideNotification(task.jobId)}>View application</Link>
        {task.phase === 'failed' && canStart(task.jobId) && <button className="font-semibold underline" onClick={() => void (task.output ? retrySave(task.jobId) : start(task.jobId))}>{task.output ? 'Retry save' : 'Restart tailoring'}</button>}
        {(task.phase === 'failed' || task.phase === 'completed') && <button className="text-brand-muted underline" onClick={() => dismiss(task.jobId)}>Dismiss</button>}
      </div>
    </div>)}
  </aside>
}
