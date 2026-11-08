import { Link } from 'react-router-dom'
import { useJobRescore } from '../hooks/useJobRescore'

export function JobRescoreProgress() {
  const { tasks, dismiss, retrySave, start, canStart } = useJobRescore()
  return <>
    {Object.values(tasks).filter(task => !task.notificationHidden).map(task => <div key={task.jobId} className="rounded-xl border border-brand-line bg-white p-4 ui-body text-brand-ink shadow-sm">
      <p className="break-words font-semibold">{task.label}</p>
      <p role="status" className="mt-1 ui-helper text-brand-muted">
        {task.phase === 'running' ? 'Rescoring job description…' : task.phase === 'saving' ? 'Saving the updated match…' : task.phase === 'completed' ? 'Rescore complete. The updated match is on this application.' : task.output ? `Match calculated (${task.output.score}%), but the save failed: ${task.error}` : task.error}
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link className="ui-inline" to={`/job/${task.jobId}`}>View application</Link>
        {task.phase === 'failed' && canStart(task.jobId) && <button className="ui-button ui-primary" onClick={() => void (task.output ? retrySave(task.jobId) : start(task.jobId))}>{task.output ? 'Retry save' : 'Retry rescore'}</button>}
        <button className="ui-button ui-secondary" onClick={() => dismiss(task.jobId)}>Dismiss</button>
      </div>
    </div>)}
  </>
}
