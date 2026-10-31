import { usePermanentDelete } from '../hooks/usePermanentDelete'
import { jobHasLiveSource } from '../lib/cvSources'
import { sameTrashTimestamp } from '../lib/trashTimestamp'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { parseJobPosting } from '../api/gemini'
import { InterviewList } from '../components/InterviewList'
import { InterviewPrepPanel } from '../components/InterviewPrepPanel'
import { TailorPanel } from '../components/TailorPanel'
import { useAuth } from '../hooks/useAuth'
import { useJobs } from '../hooks/useJobs'
import { useMasterCv } from '../hooks/useMasterCv'
import { useTailoredDocs } from '../hooks/useTailoredDocs'
import { BOARD_TONE } from '../lib/boardTone'
import { scoreMasterCvAgainstJob } from '../lib/matchScore'
import { filterPostingSkillLabels } from '../../shared/postingSkills'
import { incompleteJobRequirementAnalysis, validJobRequirementAnalysis } from '../../shared/jobRequirements'
import { jobSourceLabel, latestInterviewFollowUp, personalNotesText, STATUS_CONFIG } from '../types/job'

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const openPurge = usePermanentDelete()
  const { getJob, deleteJob, restoreJob, updateJob, moveJob } = useJobs()
  const { getCv, activeTrack, library, getLabel } = useMasterCv()
  const { getForJob } = useTailoredDocs()
  const { user, isCloudEnabled } = useAuth()
  const account = isCloudEnabled ? user?.id ?? 'signed-out' : 'local'
  const accountRef = useRef(account)
  accountRef.current = account
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

  const [trashTarget, setTrashTarget] = useState<{ id: string; account: string; role: string; company: string } | null>(null)
  const [sendingTrash, setSendingTrash] = useState(false)
  const [trashError, setTrashError] = useState(false)
  const trashDialog = useRef<HTMLDialogElement>(null)
  const trashCancel = useRef<HTMLButtonElement>(null)
  const trashConfirm = useRef<HTMLButtonElement>(null)
  const trashTrigger = useRef<HTMLButtonElement | null>(null)
  const trashAttempt = useRef(0)
  const trashPending = useRef(false)
  const trashSuccess = useRef<string | null>(null)
  const trashExpected = useRef<string | null>(null)
  const latestTrashContext = useRef({ id, account, job })
  latestTrashContext.current = { id, account, job }

  const closeTrash = () => {
    if (trashPending.current) return
    trashAttempt.current += 1
    trashDialog.current?.close()
    setTrashTarget(null)
    setTrashError(false)
    if (trashTrigger.current?.isConnected) trashTrigger.current.focus()
  }

  useEffect(() => {
    if (!trashTarget) return
    if (id !== trashTarget.id || account !== trashTarget.account || !job || (job.deletedAt && !sameTrashTimestamp(job.deletedAt, trashExpected.current))) {
      trashAttempt.current += 1
      trashPending.current = false
      trashSuccess.current = null
      trashDialog.current?.close()
      setTrashTarget(null)
      setSendingTrash(false)
      setTrashError(false)
      return
    }
    if (trashSuccess.current && sameTrashTimestamp(job.deletedAt, trashSuccess.current)) {
      trashAttempt.current += 1
      trashPending.current = false
      trashDialog.current?.close()
      setTrashTarget(null)
      setSendingTrash(false)
      navigate('/')
    }
  }, [id, account, job, trashTarget, sendingTrash, navigate])

  useEffect(() => {
    if (trashTarget) {
      trashDialog.current?.showModal()
      trashCancel.current?.focus()
    }
  }, [trashTarget])

  useEffect(() => () => { trashAttempt.current += 1; trashPending.current = false }, [])

  const confirmTrash = async () => {
    if (!trashTarget || trashPending.current) return
    const target = trashTarget
    const valid = () => {
      const current = latestTrashContext.current
      return current.id === target.id && current.account === target.account && current.job?.id === target.id && !current.job.deletedAt
    }
    if (!valid()) { closeTrash(); return }
    const attempt = ++trashAttempt.current
    trashPending.current = true
    trashSuccess.current = null
    trashExpected.current = null
    setSendingTrash(true)
    setTrashError(false)
    try {
      const deletedAt = await deleteJob(target.id, deletedAt => {
        trashExpected.current = deletedAt
        return attempt === trashAttempt.current && valid()
      })
      if (attempt !== trashAttempt.current) return
      const current = latestTrashContext.current
      if (current.id !== target.id || current.account !== target.account || !current.job) return
      trashSuccess.current = deletedAt
      // Keep pending until the committed job reaches this render. Its timestamp
      // distinguishes this operation from an unrelated Trash update.
      if (current.job.deletedAt && !sameTrashTimestamp(current.job.deletedAt, deletedAt)) {
        trashPending.current = false
      }
      setSendingTrash(false)
    } catch {
      if (attempt !== trashAttempt.current) return
      trashPending.current = false
      setSendingTrash(false)
      if (valid()) setTrashError(true)
    }
  }

  const matchPercent = useMemo(() => {
    if (!job) return null
    const analysis = job.requirementAnalysis
    if (!analysis || analysis.status !== 'complete' || !validJobRequirementAnalysis(analysis, job.jobDescription)) return null
    const savedDoc = getForJob(job.id)
    if (job.status !== 'saved' && savedDoc?.gapReport?.sourceHash === analysis.sourceHash && savedDoc.matchScore != null) return savedDoc.matchScore
    if (job.status !== 'saved' || !jobHasLiveSource(library, job)) return getForJob(job.id)?.matchScore ?? job.matchScore
    const selectedCv = getCv(job.cvTrack ?? activeTrack)
    if (!selectedCv) return null
    return scoreMasterCvAgainstJob(job.jobDescription, selectedCv, job.extractedSkills, analysis, job.role).score
  }, [job, getCv, activeTrack, getForJob, library])

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

  const handleDelete = (event: React.MouseEvent<HTMLButtonElement>) => {
    trashExpected.current = null
    trashTrigger.current = event.currentTarget
    trashSuccess.current = null
    setTrashError(false)
    setTrashTarget({ id: job.id, account, role: job.role || 'Untitled role', company: job.company || 'Unknown company' })
  }

  const handleRestore = async () => {
    await restoreJob(job.id)
  }

  const handlePurge = (event: React.MouseEvent<HTMLButtonElement>) => openPurge([job], false, event.currentTarget, true)

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
  const requirementAnalysisCurrent = Boolean(job.requirementAnalysis && validJobRequirementAnalysis(job.requirementAnalysis, job.jobDescription))
  const languageTerms = requirementAnalysisCurrent && job.requirementAnalysis
    ? job.requirementAnalysis.requirements
      .filter((requirement) => requirement.category === 'language')
      .flatMap((requirement) => requirement.components)
    : []
  const postingSkills = filterPostingSkillLabels(job.extractedSkills, job.role, languageTerms)

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

  const saveJd = async (fullJdRaw: string, forceReanalysis = false) => {
    if (job.status !== 'saved' || job.deletedAt || !jobHasLiveSource(library, job)) return
    const fullJd = fullJdRaw.trim()
    if (!fullJd) {
      setJdError('Paste the full job description before saving.')
      return
    }

    const sameDescription = fullJd === job.jobDescription
    const reanalyze = !sameDescription || forceReanalysis
    const keepStoredSkills = sameDescription && !forceReanalysis
    setSavingJd(true)
    setJdError(null)
    setParsingJd(reanalyze)
    const sourceDescriptionAtStart = job.jobDescription
    const accountAtStart = accountRef.current
    try {
      let jdSummary = job.jdSummary
      let extractedSkills = job.extractedSkills
      let extractedRequirements = job.extractedRequirements
      let requirementAnalysis = job.requirementAnalysis
      let company = job.company
      let role = job.role
      let location = job.location
      let salary = job.salary

      if (reanalyze) {
        try {
          const parsed = await parseJobPosting(fullJd, { force: forceReanalysis })
          jdSummary = parsed.summary || jdSummary
          if (!keepStoredSkills) {
            if (parsed.skills?.length) extractedSkills = parsed.skills
            else extractedSkills = []
          }
          if (parsed.requirements?.length) extractedRequirements = parsed.requirements
          requirementAnalysis = parsed.requirementAnalysis
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
          extractedRequirements = []
          jdSummary = ''
          requirementAnalysis = incompleteJobRequirementAnalysis(fullJd, 'Extraction failed. Retry analysis before viewing a match score or tailoring this job.')
        } finally {
          setParsingJd(false)
        }
      }

      const track = job.cvTrack ?? activeTrack
      // A same-description rescore must preserve the accepted extraction verbatim.
      // Role and spoken-language signals still contribute to scoring separately.
      const selectedCv = getCv(track)
      if (!selectedCv) throw new Error('Choose an existing CV template for this job.')
      const match = requirementAnalysis?.status === 'complete'
        ? scoreMasterCvAgainstJob(fullJd, selectedCv, extractedSkills, requirementAnalysis, role)
        : null

      const valid = () => {
        const current = getJob(job.id)
        const storedSkillsUnchanged = Boolean(current && current.extractedSkills.length === job.extractedSkills.length &&
          current.extractedSkills.every((skill, index) => skill === job.extractedSkills[index]))
        return accountRef.current === accountAtStart && current?.jobDescription === sourceDescriptionAtStart && current.status === 'saved' && !current.deletedAt &&
          (!keepStoredSkills || storedSkillsUnchanged)
      }
      await updateJob(job.id, {
        jobDescription: fullJd,
        jdSummary,
        extractedSkills: keepStoredSkills ? job.extractedSkills : extractedSkills.length ? extractedSkills : match?.targets ?? [],
        extractedRequirements,
        requirementAnalysis,
        company,
        role,
        location,
        salary,
        matchScore: match?.score ?? null,
        jdComplete: true,
        needsRescore: false,
      }, valid)
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
                  onClick={() => void saveJd(jdDraft, true)}
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
          {job.jobDescription && (
            <div className="rounded-xl border border-brand-line bg-[#f8fbfa] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="ui-helper text-brand-ink legacy-size-text_sm">
                  {requirementAnalysisCurrent && job.requirementAnalysis?.status === 'complete'
                    ? `Requirement analysis complete · ${job.requirementAnalysis.requirements.length} source-backed requirements`
                    : job.requirementAnalysis?.status === 'incomplete'
                      ? `Analysis incomplete: ${job.requirementAnalysis.statusReason ?? 'coverage and tailoring are unavailable.'}`
                      : 'Legacy analysis: reanalyze this job description to enable requirement matching.'}
                </p>
                {(job.requirementAnalysis?.status !== 'complete' || !requirementAnalysisCurrent) && job.status === 'saved' && !job.deletedAt && (
                  <button type="button" className={quietBtn} onClick={openJdEditor}>Reanalyze job description</button>
                )}
              </div>
            </div>
          )}
          {postingSkills.length > 0 && (
            <div>
              <h3 className="mb-2 ui-label legacy-size-text_sm">Skills from the posting</h3>
              <div className="flex flex-wrap gap-2">
                {postingSkills.map((skill) => (
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
      {job.status === 'saved' && !job.deletedAt && <label className="ui-label block legacy-size-text_sm">CV template<select aria-label="CV template" className="mt-2 w-full ui-field form-select" value={job.needsCvSelection ? "" : job.cvTrack ?? activeTrack} onChange={(e) => { void updateJob(job.id, { cvTrack: e.target.value, needsCvSelection: false, needsRescore: true }).catch((error) => setJdError(error instanceof Error ? error.message : 'Could not change CV template.')) }}>{!library.cvs[job.cvTrack ?? activeTrack] && <option value={job.needsCvSelection ? "" : job.cvTrack ?? activeTrack}>Choose a CV</option>}{Object.keys(library.cvs).map((id) => <option key={id} value={id}>{getLabel(id)}</option>)}</select></label>}
      {job.jdComplete && <TailorPanel key={`${account}:${job.id}`} job={job} />}
      <dialog ref={trashDialog} aria-labelledby="trash-job-title" aria-describedby="trash-job-description" aria-busy={sendingTrash || trashPending.current}
        onKeyDown={event => {
          if (event.key !== 'Tab') return
          if (trashPending.current) { event.preventDefault(); return }
          if (event.shiftKey && document.activeElement === trashCancel.current) { event.preventDefault(); trashConfirm.current?.focus() }
          else if (!event.shiftKey && document.activeElement === trashConfirm.current) { event.preventDefault(); trashCancel.current?.focus() }
        }}
        onCancel={event => { event.preventDefault(); closeTrash() }}
        className="ui-panel ui-dialog w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto backdrop:bg-brand-ink/30">
        <h2 id="trash-job-title" className="ui-dialog-title legacy-size-text_lg">Send to trash?</h2>
        <p id="trash-job-description" className="mt-3 ui-helper legacy-size-text_sm [overflow-wrap:anywhere]">Send ‘{trashTarget?.role}’ at ‘{trashTarget?.company}’ to Trash? You can restore this application from Trash.</p>
        {trashError && <p role="alert" className="mt-3 ui-helper legacy-size-text_sm !text-red-700">Could not send this application to Trash. Please try again.</p>}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button ref={trashCancel} type="button" disabled={trashPending.current} onClick={closeTrash} className="ui-button ui-secondary">Cancel</button>
          <button ref={trashConfirm} type="button" disabled={trashPending.current} onClick={() => void confirmTrash()} className="ui-button ui-danger-quiet">{trashPending.current ? 'Sending…' : 'Send to trash'}</button>
        </div>
      </dialog>
    </div>
  )
}
