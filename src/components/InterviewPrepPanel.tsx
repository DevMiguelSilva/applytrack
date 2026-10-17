import { downloadCvDocx, tailoredDocFilename } from '../lib/docxExport'
import type { JobApplication } from '../types/job'
import { useTailoredDocs } from '../hooks/useTailoredDocs'

interface InterviewPrepPanelProps {
  job: JobApplication
}

/** Shown only when status is Interview — tailored resume, not a second overview. */
export function InterviewPrepPanel({ job }: InterviewPrepPanelProps) {
  const { getForJob } = useTailoredDocs()
  const tailored = getForJob(job.id)

  const quietBtn =
    "ui-button ui-secondary"

  return (
    <section className="ui-panel  space-y-4">
      <div>
        <h2 className=" ui-section-title">Interview prep</h2>
        <p className="mt-1 ui-helper text-brand-muted">
          Tailored resume for this call. Interview dates and your comments stay in the sections above.
        </p>
      </div>

      {tailored ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className=" ui-label">Tailored resume</h3>
            <button
              type="button"
              className={quietBtn}
              onClick={() =>
                downloadCvDocx(
                  tailored.tailoredCv,
                  tailoredDocFilename(tailored.tailoredCv.contact.name)
                )
              }
            >
              Download DOCX
            </button>
          </div>
          <p className="ui-body font-medium text-brand-ink">{tailored.tailoredCv.headline}</p>
          <p className="ui-body leading-relaxed text-brand-ink">{tailored.tailoredCv.summary}</p>
          {tailored.gapReport && (
            <p className="ui-helper text-brand-muted">
              Coverage: {tailored.gapReport.coveragePercent}% · matched{' '}
              {tailored.gapReport.matchedKeywords.slice(0, 6).join(', ')}
            </p>
          )}
        </div>
      ) : (
        <p className="ui-helper text-brand-muted">
          No tailored CV yet — use Tailor below before the interview if you need one.
        </p>
      )}
    </section>
  )
}
