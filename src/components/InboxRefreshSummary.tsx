import type { RefreshReport } from '../lib/inboxRefresh'

export function InboxRefreshSummary({ report, busy, retryFailed, retrySave }: { report: RefreshReport; busy: boolean; retryFailed: () => Promise<void>; retrySave: () => Promise<void> }) {
  const successful = report.outcomes.filter(outcome => outcome.state === 'success')
  const failed = report.outcomes.filter(outcome => outcome.state !== 'success')
  const returned = new Set(successful.flatMap(outcome => outcome.response?.results.map(job => job.externalId) ?? [])).size
  const title = report.persistence === 'failed' ? 'Results fetched, but not saved' : !failed.length ? returned ? 'Search refresh complete' : 'No matches this time' : successful.length ? 'Some searches completed' : 'Search refresh could not complete'
  return <section className="ui-panel space-y-4 legacy-size-text_sm" aria-label="Search refresh summary">
    <div role="status" aria-live="polite">
      <h2 className="ui-card-title">{title}</h2>
      <p className="mt-1 ui-helper text-brand-muted">{successful.length} of {report.outcomes.length} search locations completed · {returned} listing{returned === 1 ? '' : 's'} returned.</p>
      <p className="mt-1 ui-helper text-brand-muted">{report.persistence === 'failed' ? 'Fetched results are held in this session. Retry saving without making another provider request.' : failed.length ? successful.length ? 'Successful results were kept. Existing review jobs and your approval/dismissal history are preserved.' : 'No new results were saved. Your existing review jobs and approval/dismissal history are unchanged.' : returned ? 'Previously approved or dismissed listings stay out of the review list.' : 'Your existing jobs are unchanged. Try widening the phrase or location.'}</p>
      {report.persistence === 'failed' && report.saveError && <p className="mt-2 ui-helper text-brand-muted">{report.saveError}</p>}
    </div>
    {failed.length > 0 && <ul className="max-h-60 space-y-2 overflow-y-auto">
      {failed.map(outcome => <li key={outcome.id} className="rounded-lg bg-brand-mist p-3">
        <p className="break-words font-medium">{outcome.search.label || outcome.search.query} · {outcome.location}</p>
        <p className="mt-1 ui-helper text-brand-muted">{outcome.state === 'not_run' ? 'Not run: requests stopped to avoid further provider failures. ' : ''}{outcome.error?.message}</p>
        {outcome.error?.retryAfterSeconds !== undefined && <p className="mt-1 ui-meta text-brand-muted legacy-size-text_xs">Provider requested a wait of {outcome.error.retryAfterSeconds} seconds when this response was received.</p>}
        {outcome.error?.requestId && <p className="mt-1 break-all ui-meta text-brand-muted legacy-size-text_xs">Reference: {outcome.error.requestId.slice(0, 12)}</p>}
      </li>)}
    </ul>}
    <div className="flex flex-wrap gap-2">
      {report.persistence === 'failed' && <button type="button" disabled={busy} aria-busy={busy} onClick={() => void retrySave()} className="ui-button ui-primary">Retry saving results</button>}
      {failed.length > 0 && report.persistence !== 'failed' && <button type="button" disabled={busy} onClick={() => void retryFailed()} className="ui-button ui-primary">Retry failed searches</button>}
    </div>
  </section>
}
