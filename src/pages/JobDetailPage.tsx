import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { parseJobPosting } from '../api/gemini'
import { InterviewList } from '../components/InterviewList'
import { InterviewPrepPanel } from '../components/InterviewPrepPanel'
import { TailorPanel } from '../components/TailorPanel'
import { useJobs } from '../hooks/useJobs'
import { useMasterCv } from '../hooks/useMasterCv'
import { useTailoredDocs } from '../hooks/useTailoredDocs'
import { BOARD_TONE } from '../lib/boardTone'
import { scoreMasterCvAgainstJob, withRequirementSignals } from '../lib/matchScore'
import { jobSourceLabel, latestInterviewFollowUp, personalNotesText, STATUS_CONFIG } from '../types/job'

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getJob, deleteJob, restoreJob, purgeJob, updateJob, moveJob } = useJobs()
  const { getCv, activeTrack, library, getLabel } = useMasterCv()
  const { getForJob } = useTailoredDocs()
  const job = id ? getJob(id) : undefined
  const hasResume = Boolean(id && getForJob(id)?.tailoredCv)
  const [showFullJd, setShowFullJd] = useState(false)
  const [editingJd, setEditingJd] = useState(false)
  const [jdDraft, setJdDraft] = useState('')
  const [savingJd, setSavingJd] = useState(false)
  const [parsingJd, setParsingJd] = useState(false)
  const [jdError, setJdError] = useState<string | null>(null)
  const [jdCopied, setJdCopied] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesError, setNotesError] = useState<string | null>(null)

  const matchPercent = useMemo(() => {
    if (!job) return null
    if (job.status !== 'saved') return getForJob(job.id)?.matchScore ?? job.matchScore
    const selectedCv = getCv(job.cvTrack ?? activeTrack)
    if (!selectedCv) return null
    return scoreMasterCvAgainstJob(
      `${job.role}\n${job.jobDescription}`,
      selectedCv,
      job.extractedSkills
    ).score
  }, [job, getCv, activeTrack, getForJob])

  useEffect(() => {
    if (!job || job.status !== 'saved' || job.deletedAt) setEditingJd(false)
  }, [job])

  if (!job) {
    return (
      <div className="text-center">
        <h1 className="ui-dialog-title legacy-size-text_base">Job not found.</h1>
      </div>
    )
  }

  const handleDelete = async () => {
    if (confirm(`Move ${job.role} at ${job.company} to Trash?`)) {
      await deleteJob(job.id)
      navigate('/')
    }
  }

  const handleRestore = async () => {
    await restoreJob(job.id)
  }

  const handlePurge = async () => {
    if (confirm(`Permanently delete ${job.role} at ${job.company}? This cannot be undone.`)) {
      await purgeJob(job.id)
      navigate('/')
    }
  }

  const showInterviewPrep = job.status === 'interview'
  const notesText = personalNotesText(job.notes)
  const followUp = job.status === 'interview' ? latestInterviewFollowUp(job.interviews) : null
  const tone = BOARD_TONE[job.deletedAt ? 'trash' : job.status]
  const statusLabel = job.deletedAt ? 'Trash' : STATUS_CONFIG[job.status].label
  const statusBtn = (slot: 'saved' | 'applied' | 'interview' | 'offer' | 'rejected' | 'trash') =>
    `m-action rounded-lg px-4 py-2 text-sm font-semibold transition ${BOARD_TONE[slot].action}`
  const quietBtn =
    "ui-button ui-secondary legacy-size-text_sm"

  const panel = "ui-panel"
  const field =
    "ui-field mt-2 legacy-size-text_sm"

  const saveNotes = async () => {
    setSavingNotes(true)
    setNotesError(null)
    try {
      await updateJob(job.id, { notes: notesDraft })
      setEditingNotes(false)
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : 'Could not save notes')
    } finally {
      setSavingNotes(false)
    }
  }

  const hasUrl = Boolean(job.jobUrl.trim())
  const jdIncomplete = !job.jdComplete

  const copyFullJd = async () => {
    const text = job.jobDescription.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setJdCopied(true)
      window.setTimeout(() => setJdCopied(false), 2000)
    } catch {
      setJdCopied(false)
    }
  }

  const openJdEditor = () => {
    setJdDraft(job.jobDescription)
    setJdError(null)
    setEditingJd(true)
    setShowFullJd(true)
  }

  const saveJd = async (fullJdRaw: string) => {
    if (job.status !== 'saved' || job.deletedAt) return
    const fullJd = fullJdRaw.trim()
    if (!fullJd) {
      setJdError('Paste the full job description before saving.')
      return
    }

    setSavingJd(true)
    setJdError(null)
    setParsingJd(true)
    try {
      let jdSummary = job.jdSummary
      let extractedSkills = job.extractedSkills
      let extractedRequirements = job.extractedRequirements
      let company = job.company
      let role = job.role
      let location = job.location
      let salary = job.salary

      try {
        const parsed = await parseJobPosting(fullJd)
        jdSummary = parsed.summary || jdSummary
        if (parsed.skills?.length) extractedSkills = parsed.skills
        else extractedSkills = []
        if (parsed.requirements?.length) extractedRequirements = parsed.requirements
        if (parsed.company) company = parsed.company
        if (parsed.role) role = parsed.role
        if (parsed.location) location = parsed.location
        if (parsed.salary) salary = parsed.salary
      } catch (err) {
        setJdError(
          err instanceof Error
            ? `${err.message} — saved description and rescored without AI parse.`
            : 'AI parse failed — saved description and rescored without AI parse.'
        )
        extractedSkills = []
      } finally {
        setParsingJd(false)
      }

      const track = job.cvTrack ?? activeTrack
      const described = `${role}\n${fullJd}`
      extractedSkills = withRequirementSignals(described, extractedSkills)
      const selectedCv = getCv(track)
      if (!selectedCv) throw new Error('Choose an existing CV template for this job.')
      const match = scoreMasterCvAgainstJob(described, selectedCv, extractedSkills)

      await updateJob(job.id, {
        jobDescription: fullJd,
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
      })
      setEditingJd(false)
      setShowFullJd(false)
    } catch (err) {
      setJdError(err instanceof Error ? err.message : 'Failed to update job description')
    } finally {
      setSavingJd(false)
      setParsingJd(false)
    }
  }

  return (
    <div className="ui-page">
      <section className="ui-panel  ">
        <div className="m-action-row flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="flex items-baseline gap-2">
              <span className={`text-sm font-medium ${tone.figure}`}>{statusLabel}</span>
              <span className="ui-meta text-brand-muted legacy-size-text__11px_">{jobSourceLabel(job.source)}</span>
            </p>
            <h1 className="mt-2 ui-title legacy-size-text__1_75rem_">
              {job.role || 'Untitled role'}
            </h1>
            <p className="mt-1 truncate ui-helper text-brand-muted legacy-size-text_sm">{job.company || 'Unknown company'}</p>
            <p className="truncate ui-helper text-brand-muted legacy-size-text_sm">
              {job.location.trim() || 'No location'}
            </p>
            <p className="ui-description mt-2">Manage this application, prepare documents and track your progress.</p>
            <p className={`mt-2 ui-helper ${job.salary.trim() ? 'text-brand-ink' : 'text-brand-muted'}`}>
              {job.salary.trim() || 'No salary yet'}
            </p>
            {job.status !== 'saved' && (job.appliedDate || matchPercent != null) && (
              <p className="mt-2 ui-helper text-brand-muted legacy-size-text_sm">
                {[
                  job.appliedDate ? `Applied ${job.appliedDate}` : null,
                  matchPercent != null ? `${matchPercent}% match` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {job.deletedAt && (
              <p className="mt-1 ui-meta text-brand-muted legacy-size-text_xs">Was {STATUS_CONFIG[job.status].label}</p>
            )}
            {job.status === 'interview' && job.notSelected && (
              <p className="pt-2 ui-helper text-brand-muted legacy-size-text_sm">Not selected</p>
            )}
            {job.status === 'interview' && !job.notSelected && followUp === 'pending' && (
              <p className="pt-2 ui-helper !text-emerald-700 legacy-size-text_sm">Interview booked</p>
            )}
            {job.status === 'interview' && !job.notSelected && followUp === 'waiting' && (
              <p className="pt-2 ui-helper !text-emerald-700 legacy-size-text_sm">Waiting for an answer</p>
            )}
            {jdIncomplete && !job.needsRescore && (
              <p className="pt-2 ui-helper !text-[#8a6230] legacy-size-text_sm">Description incomplete</p>
            )}
          </div>

          <div className="m-actions flex flex-wrap gap-2">
            {job.deletedAt ? (
              <>
                <button type="button" data-slot="saved" data-role="primary" onClick={handleRestore} className={`${statusBtn('saved')} ui-status-button`}>
                  Restore
                </button>
                <button type="button" data-slot="rejected" onClick={handlePurge} className={`${statusBtn('rejected')} ui-status-button`}>
                  Delete
                </button>
              </>
            ) : (
              <>
                {job.status === 'saved' && job.jdComplete && hasResume && (
                  <button
                    type="button"
                    data-slot="applied"
                    data-role="primary"
                    onClick={() => moveJob(job.id, 'applied')}
                    className={`${statusBtn('applied')} ui-status-button`}
                  >
                    Mark as applied
                  </button>
                )}
                {job.status === 'applied' && (
                  <>
                    <button
                      type="button"
                      data-slot="interview"
                      data-role="primary"
                      onClick={() => moveJob(job.id, 'interview')}
                      className={`${statusBtn('interview')} ui-status-button`}
                    >
                      Interview
                    </button>
                    <button type="button" data-slot="rejected" onClick={() => moveJob(job.id, 'rejected')} className={`${statusBtn('rejected')} ui-status-button`}>
                      Rejected
                    </button>
                  </>
                )}
                {job.status === 'interview' &&
                  !job.notSelected &&
                  job.interviews.length > 0 &&
                  job.interviews.every((round) => round.done) && (
                  <>
                    <button
                      type="button"
                      data-slot="offer"
                      data-role="primary"
                      onClick={() => moveJob(job.id, 'offer')}
                      className={`${statusBtn('offer')} ui-status-button`}
                    >
                      Offer
                    </button>
                    {!job.notSelected && (
                      <button
                        type="button"
                        data-role="quiet"
                        onClick={() => updateJob(job.id, { notSelected: true })}
                        className="ui-button ui-neutral m-action"
                      >
                        Not selected
                      </button>
                    )}
                  </>
                )}
                {job.status === 'saved' && (
                  <button type="button" data-slot="trash" onClick={handleDelete} className="ui-button ui-danger-quiet m-action">
                    Move to trash
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {job.status === 'interview' && (!job.deletedAt || job.interviews.length > 0) && (
          <div className="mt-6">
            <InterviewList
              interviews={job.interviews}
              readOnly={Boolean(job.deletedAt) || job.notSelected}
              embedded
              onSave={(interviews) =>
                updateJob(job.id, {
                  interviews,
                  ...(interviews.some((round) => !round.done) ? { notSelected: false } : {}),
                })
              }
            />
          </div>
        )}
      </section>

      <section className={panel}>
        <span className="block ui-helper text-brand-muted legacy-size-text_sm">Posting URL</span>
        {hasUrl ? (
          <a
            href={job.jobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-inline ui-posting-link mt-1 max-w-full break-words legacy-size-text_sm"
          >
            Open original posting
          </a>
        ) : (
          <p className="mt-1 ui-helper text-brand-muted legacy-size-text_sm">No URL on this job</p>
        )}
      </section>

      {job.status === 'saved' && !job.deletedAt && (jdIncomplete || editingJd) && (
        <section className={`${panel} space-y-4`}>
          <h2 className=" ui-section-title legacy-size-text_base">Job description</h2>

          {!editingJd ? (
            job.needsRescore ? (
              <div className="space-y-3">
                <button
                  type="button"
                  data-role="primary"
                  disabled={savingJd || parsingJd} aria-busy={savingJd || parsingJd}
                  onClick={() => void saveJd(job.jobDescription)}
                  className="ui-button ui-primary m-action"
                >
                  {parsingJd || savingJd ? 'Rescoring…' : 'Rescore'}
                </button>
                {jdError && (
                  <p className="ui-helper !text-[#8a6230] legacy-size-text_sm" role="alert">
                    {jdError}
                  </p>
                )}
              </div>
            ) : (
              <button type="button" data-role="primary" onClick={openJdEditor} className="ui-button ui-secondary m-action">
                Paste full job description
              </button>
            )
          ) : (
            <div className="space-y-3">
              <label className="ui-label block">
                <span className="ui-label text-brand-muted legacy-size-text_sm">Full job description</span>
                <textarea
                  value={jdDraft}
                  onChange={(e) => setJdDraft(e.target.value)}
                  rows={12}
                  placeholder="Paste the complete job posting here…"
                  className={field}
                />
              </label>
              {jdError && (
                <p className="ui-helper !text-[#8a6230] legacy-size-text_sm" role="alert">
                  {jdError}
                </p>
              )}
              <div className="m-actions flex flex-wrap gap-2">
                <button
                  type="button"
                  data-role="primary"
                  disabled={savingJd || parsingJd}
                  onClick={() => void saveJd(jdDraft)}
                  className="ui-button ui-primary m-action"
                >
                  {parsingJd ? 'Parsing…' : savingJd ? 'Saving…' : 'Parse, save & rescore'}
                </button>
                <button
                  type="button"
                  data-role="quiet"
                  disabled={savingJd || parsingJd}
                  onClick={() => {
                    setEditingJd(false)
                    setJdError(null)
                  }}
                  className="ui-button ui-secondary m-action"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {(job.jdSummary ||
        job.extractedSkills.length > 0 ||
        job.extractedRequirements.length > 0 ||
        job.jobDescription) && (
        <section className={`${panel} space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className=" ui-section-title legacy-size-text_base">Posting overview</h2>
            {job.status === 'saved' && !job.deletedAt && job.jdComplete && !editingJd && (
              <button type="button" onClick={openJdEditor} className={quietBtn}>
                Update
              </button>
            )}
          </div>
          {job.jdSummary && (
            <div>
              <h3 className="mb-1 ui-label legacy-size-text_sm">Summary</h3>
              <p className="ui-helper !text-brand-ink legacy-size-text_sm">{job.jdSummary}</p>
            </div>
          )}
          {job.extractedSkills.length > 0 && (
            <div>
              <h3 className="mb-2 ui-label legacy-size-text_sm">Skills from the posting</h3>
              <div className="flex flex-wrap gap-2">
                {job.extractedSkills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-lg bg-[#f4faf8] px-2.5 py-1 ui-meta text-brand-ink legacy-size-text_sm"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
          {job.extractedRequirements.length > 0 && (
            <div>
              <h3 className="mb-2 ui-label legacy-size-text_sm">Requirements</h3>
              <ul className="space-y-1 ui-helper !text-brand-ink legacy-size-text_sm">
                {job.extractedRequirements.map((req) => (
                  <li key={req} className="flex gap-2">
                    <span className="text-brand-muted">•</span>
                    {req}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {job.jobDescription ? (
            <div className="border-t border-[#e6eeeb] pt-4">
              {showFullJd ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className=" ui-label legacy-size-text_sm">Full text</h3>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => void copyFullJd()} className={quietBtn}>
                        {jdCopied ? 'Copied' : 'Copy'}
                      </button>
                      <button type="button" onClick={() => setShowFullJd(false)} className={quietBtn}>
                        Close
                      </button>
                    </div>
                  </div>
                  <div
                    className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap ui-helper !text-brand-ink legacy-size-text_sm"
                    role="region"
                    aria-label="Job description"
                  >
                    {job.jobDescription}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  data-role="quiet"
                  onClick={() => setShowFullJd(true)}
                  className="ui-button ui-secondary m-action"
                  aria-expanded={false}
                >
                  {jdIncomplete ? 'Show listing preview' : 'Show full job description'}
                </button>
              )}
            </div>
          ) : (
            <p className="ui-helper text-brand-muted legacy-size-text_sm">No description saved yet.</p>
          )}
        </section>
      )}

      <section className={`${panel} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className=" ui-section-title legacy-size-text_base">Personal notes</h2>
          {!editingNotes && (
            <button
              type="button"
              onClick={() => {
                setNotesDraft(notesText)
                setNotesError(null)
                setEditingNotes(true)
              }}
              className={quietBtn}
            >
              Edit
            </button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-3">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={4}
              placeholder="Recruiter name, follow-ups, anything you want to remember…"
              className={field}
            />
            {notesError && (
              <p className="ui-helper !text-[#8a6230] legacy-size-text_sm" role="alert">
                {notesError}
              </p>
            )}
            <div className="m-actions flex flex-wrap gap-2">
              <button
                type="button"
                data-role="primary"
                disabled={savingNotes} aria-busy={savingNotes}
                onClick={() => void saveNotes()}
                className="ui-button ui-primary m-action"
              >
                {savingNotes ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                data-role="quiet"
                disabled={savingNotes}
                onClick={() => {
                  setEditingNotes(false)
                  setNotesError(null)
                }}
                className="ui-button ui-secondary m-action"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : notesText.trim() ? (
          <p className="whitespace-pre-wrap ui-helper !text-brand-ink legacy-size-text_sm">{notesText}</p>
        ) : (
          <p className="ui-helper text-brand-muted legacy-size-text_sm">No notes yet.</p>
        )}
      </section>

      {showInterviewPrep && <InterviewPrepPanel job={job} />}
      {job.status === 'saved' && !job.deletedAt && <label className="ui-label block legacy-size-text_sm">CV template<select aria-label="CV template" className="mt-2 w-full ui-field form-select" value={job.cvTrack ?? activeTrack} onChange={(e) => { void updateJob(job.id, { cvTrack: e.target.value, matchScore: null, needsRescore: true }).catch((error) => setJdError(error instanceof Error ? error.message : 'Could not change CV template.')) }}>{!library.cvs[job.cvTrack ?? activeTrack] && <option value={job.cvTrack ?? activeTrack}>Unavailable template — choose a CV</option>}{Object.keys(library.cvs).map((id) => <option key={id} value={id}>{getLabel(id)}</option>)}</select></label>}
      {job.jdComplete && <TailorPanel job={job} />}
    </div>
  )
}
