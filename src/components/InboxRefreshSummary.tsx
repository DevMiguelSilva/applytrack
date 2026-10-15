import type { RefreshReport } from '../lib/inboxRefresh'

export function InboxRefreshSummary({ report, busy, retryFailed, retrySave }: { report: RefreshReport; busy: boolean; retryFailed: () => Promise<void>; retrySave: () => Promise<void> }) {
  const successful = report.outcomes.filter(outcome => outcome.state === 'success')
  const failed = report.outcomes.filter(outcome => outcome.state !== 'success')
  const returned = new Set(successful.flatMap(outcome => outcome.response?.results.map(job => job.externalId) ?? [])).size
  const title = report.persistence === 'failed' ? 'Results fetched, but not saved' : !failed.length ? returned ? 'Search refresh complete' : 'No matches this time' : successful.length ? 'Some searches completed' : 'Search refresh could not complete'
  return <section className="space-y-3 rounded-[1.25rem] border border-brand-line bg-white p-4 text-sm text-brand-ink sm:p-5" aria-label="Search refresh summary">
    <div role="status" aria-live="polite">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-brand-muted">{successful.length} of {report.outcomes.length} search locations completed · {returned} listing{returned === 1 ? '' : 's'} returned.</p>
      <p className="mt-1 text-brand-muted">{report.persistence === 'failed' ? 'Fetched results are held in this session. Retry saving without making another provider request.' : failed.length ? successful.length ? 'Successful results were kept. Existing review jobs and your approval/dismissal history are preserved.' : 'No new results were saved. Your existing review jobs and approval/dismissal history are unchanged.' : returned ? 'Previously approved or dismissed listings stay out of the review list.' : 'Your existing jobs are unchanged. Try widening the phrase or location.'}</p>
    </div>
    {failed.length > 0 && <ul className="max-h-60 space-y-2 overflow-y-auto">
      {failed.map(outcome => <li key={outcome.id} className="rounded-lg bg-brand-mist p-3">
        <p className="break-words font-medium">{outcome.search.label || outcome.search.query} · {outcome.location}</p>
        <p className="mt-1 text-brand-muted">{outcome.state === 'not_run' ? 'Not run: requests stopped to avoid further provider failures. ' : ''}{outcome.error?.message}</p>
        {outcome.error?.retryAfterSeconds !== undefined && <p className="mt-1 text-xs text-brand-muted">Provider requested a wait of {outcome.error.retryAfterSeconds} seconds when this response was received.</p>}
        {outcome.error?.requestId && <p className="mt-1 break-all text-xs text-brand-muted">Reference: {outcome.error.requestId.slice(0, 12)}</p>}
      </li>)}
    </ul>}
    <div className="flex flex-wrap gap-2">
      {report.persistence === 'failed' && <button type="button" disabled={busy} onClick={() => void retrySave()} className="rounded-lg bg-brand-primary px-4 py-2 font-semibold disabled:opacity-60">Retry saving results</button>}
      {failed.length > 0 && report.persistence !== 'failed' && <button type="button" disabled={busy} onClick={() => void retryFailed()} className="rounded-lg border border-brand-line px-4 py-2 font-semibold hover:bg-brand-mist disabled:opacity-60">Retry failed searches</button>}
    </div>
  </section>
}
