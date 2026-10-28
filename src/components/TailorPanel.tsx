import { CopyFeedback } from '../lib/copyFeedback'
import { resolveJobCv } from '../lib/cvLibrary'
import { jobHasLiveSource } from '../lib/cvSources'
import { emptyStoredCv, storedCvContent } from '../lib/storedCv'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadApplicationPack, openCvPrintWindow } from '../lib/docxExport'
import { buildGapReport } from '../lib/matchScore'
import { gapCvSelectionKey, GapCvRefreshTracker, refreshGapReportForCvChange } from '../lib/gapCheckRefresh'
import { getGapCheckMode, hasGapContent } from '../lib/gapCheckAvailability'
import { getErrorMessage } from '../lib/errorMessage'
import { suggestTransferableSkills, transferCheck, transferDifficultyClass, transferDifficultyLabel } from '../lib/skillTransfer'
import type { GapReport, GapSkill, MasterCv } from '../types/cv'
import {
  EMPTY_GAP_REPORT,
  masterCvSearchText,
  masterCvSkillList,
} from '../types/cv'
import type { JobApplication } from '../types/job'
import { useJobs } from '../hooks/useJobs'
import { useMasterCv } from '../hooks/useMasterCv'
import { useTailoring } from '../hooks/useTailoring'
import { useSkillExplanations } from '../hooks/skillExplanationsContext'
import { useTailoredDocs } from '../hooks/useTailoredDocs'
import { useAuth } from '../hooks/useAuth'
import { createJobReviewPanelState, updateJobReviewPanel, type JobReviewPanelId } from '../lib/jobReviewPanels'
import { LoadingSpinner } from './LoadingSpinner'

interface TailorPanelProps {
  job: JobApplication
}

const quietBtn =
  "ui-button ui-secondary legacy-size-text_sm"
const pasteBtn =
  "ui-button ui-primary legacy-size-text_sm"
const nested = "ui-panel"


function skillKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

const skillLink =
  "ui-inline ui-skill-control text-left"

const chipHave = 'rounded-lg bg-[#f4faf8] px-2.5 py-1 text-sm text-brand-ink'
const chipAdded = 'rounded-lg border border-brand-primary bg-brand-mist px-2.5 py-1 text-sm text-brand-ink'
const chipMissing = 'rounded-lg bg-[#faf6ef] px-2.5 py-1 text-sm text-[#8a6230]'

function chipClass(state: GapSkill['state']): string {
  if (state === 'have') return chipHave
  if (state === 'added') return chipAdded
  return chipMissing
}

function SkillName({
  skill,
  active,
  added,
  onClick,
}: {
  skill: string
  active: boolean
  added?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={onClick}
      className={`${`${skillLink} text-brand-ink hover:text-[#23745e] ${active || added ? 'underline' : ''}`} ui-skill-control`}
    >
      {skill}
    </button>
  )
}

function SkillAnswer({
  loading,
  error,
  summary,
  onRetry,
}: {
  loading: boolean
  error: string | null
  summary: string | null
  onRetry: () => void
}) {
  return (
    <div className="mt-2 ui-body text-brand-ink">
      {loading && <p className="text-brand-muted">Looking it up…</p>}
      {error && (
        <div>
          <p className="ui-helper !text-red-700" role="alert">{error}</p>
          <button type="button" className="ui-button ui-secondary mt-2 legacy-size-text_sm" onClick={onRetry}>Try again</button>
        </div>
      )}
      {summary && !loading && <p>{summary}</p>}
    </div>
  )
}

export function TailorPanel({ job }: TailorPanelProps) {
  const { user, isCloudEnabled } = useAuth()
  const panelScope = `${isCloudEnabled ? user?.id ?? 'signed-out' : 'local'}:${job.id}`
  const [panelState, setPanelState] = useState(() => createJobReviewPanelState(panelScope))
  const openPanels = panelState.scope === panelScope ? panelState.open : new Set<JobReviewPanelId>()
  const setPanelOpen = useCallback((id: JobReviewPanelId, open: boolean) => {
    setPanelState(current => updateJobReviewPanel(current, panelScope, id, open))
  }, [panelScope])
  const { library, loading, loadError, getLabel } = useMasterCv()
  const { getForJob, loading: docsLoading } = useTailoredDocs()
  const doc = getForJob(job.id)
  const liveCv = resolveJobCv(library, job, doc)
  const canGenerate = !loading && !loadError && job.status === 'saved' && !job.deletedAt && jobHasLiveSource(library, job)
  const masterCv = liveCv ?? storedCvContent(doc?.masterCvSnapshot) ?? storedCvContent(doc?.tailoredCv) ?? (doc?.coverLetter ? emptyStoredCv : null)
  if (loading || docsLoading) return <p className="ui-helper text-brand-muted legacy-size-text_sm">Loading application documents…</p>
  if (!masterCv) return <section className="ui-panel  "><h2 className=" ui-section-title">Application document unavailable</h2><p className="mt-2 ui-helper text-brand-muted legacy-size-text_sm">{job.status === 'saved' ? 'Choose an existing CV template for this saved job.' : 'This older application has no stored CV snapshot. Its original template cannot be substituted with a current CV.'}</p></section>
  return <TailorPanelContent key={`${panelScope}:${job.id}`} job={job} masterCv={masterCv} canGenerate={canGenerate} templateLabel={canGenerate ? getLabel(job.cvTrack ?? library.activeTrack) : 'Stored application'} openPanels={openPanels} setPanelOpen={setPanelOpen} />
}

function TailorPanelContent({ job, masterCv, templateLabel, canGenerate, openPanels, setPanelOpen }: TailorPanelProps & {
  masterCv: MasterCv
  templateLabel: string
  canGenerate: boolean
  openPanels: ReadonlySet<JobReviewPanelId>
  setPanelOpen: (id: JobReviewPanelId, open: boolean) => void
}) {
  const { updateJob } = useJobs()
  const { getForJob } = useTailoredDocs()
  const { tasks, start, retrySave } = useTailoring()
  const skillExplanations = useSkillExplanations()
  const task = tasks[job.id]
  const generating = task?.phase === 'running' || task?.phase === 'saving'
  const existing = getForJob(job.id)

  const [actionLoading, setLoading] = useState<string | null>(null)
  const loading = generating ? 'tailor' : actionLoading
  const [error, setError] = useState<string | null>(null)
  const tailoredCv = storedCvContent(existing?.tailoredCv, existing?.masterCvSnapshot)
  const coverLetter = existing?.coverLetter ?? ''
  const hasSavedFiles = Boolean(tailoredCv || coverLetter)
  const [gapReport, setGapReport] = useState<GapReport>(() => ({
    ...EMPTY_GAP_REPORT,
    ...(existing?.gapReport ?? {}),
    claimedKeywords: existing?.gapReport?.claimedKeywords ?? [],
  }))
  useEffect(() => {
    if (existing?.gapReport) setGapReport(existing.gapReport)
  }, [existing])
  const [copied, setCopied] = useState(0)
  const feedback = useMemo(() => new CopyFeedback(
    id => { setCopied(id); if (id) setError(null) },
    err => setError(getErrorMessage(err, 'Could not copy the cover letter'))
  ), [])
  useEffect(() => () => feedback.dispose(), [feedback])
  const copyLetter = () => feedback.copy(coverLetter, text => navigator.clipboard.writeText(text))

  const claimedSkills = useMemo(() => job.claimedSkills ?? [], [job.claimedSkills])
  const skillsLocked = !canGenerate || job.status !== 'saved' || Boolean(job.deletedAt)
  const gapCheckMode = getGapCheckMode(job.status, canGenerate, Boolean(job.deletedAt), existing?.gapReport)
  const showGap = openPanels.has('gap')
  const showTailor = openPanels.has('tailor')
  const cvSelectionKey = gapCvSelectionKey(job.cvTrack, masterCvSearchText(masterCv))
  const gapRefreshTracker = useRef<GapCvRefreshTracker | null>(null)
  if (!gapRefreshTracker.current) gapRefreshTracker.current = new GapCvRefreshTracker(cvSelectionKey)

  const computeGap = useCallback((claimed: string[]) =>
    buildGapReport(
      `${job.role}\n${job.jobDescription}`,
      job.extractedSkills,
      masterCvSearchText(masterCv),
      claimed
    ), [job.role, job.jobDescription, job.extractedSkills, masterCv])

  useEffect(() => {
    const refresh = refreshGapReportForCvChange(
      gapRefreshTracker.current!,
      cvSelectionKey,
      showGap && !skillsLocked,
      claimedSkills,
      computeGap,
    )
    if (!refresh) return

    const { version, report: gap } = refresh
    setGapReport(gap)
    setError(null)
    void updateJob(job.id, { matchScore: gap.coveragePercent }).catch((err) => {
      if (gapRefreshTracker.current?.isLatest(version)) {
        setError(getErrorMessage(err, 'Could not update the CV match score'))
      }
    })
  }, [cvSelectionKey, showGap, skillsLocked, job.id, claimedSkills, computeGap, updateJob])

  const run = async (action: string, fn: () => Promise<void>) => {
    setLoading(action)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(getErrorMessage(err, 'Request failed'))
    } finally {
      setLoading(null)
    }
  }

  const runGap = () =>
    run('gap', async () => {
      if (skillsLocked) throw new Error('Choose a CV before checking this job.')
      const gap = computeGap(claimedSkills)
      await updateJob(job.id, { matchScore: gap.coveragePercent })
      setGapReport(gap)
      setPanelOpen('gap', true)
    })

  const toggleClaimedSkill = async (skill: string) => {
    if (skillsLocked) return
    const key = skillKey(skill)
    const nextClaimed = claimedSkills.some((s) => skillKey(s) === key)
      ? claimedSkills.filter((s) => skillKey(s) !== key)
      : [...claimedSkills, skill]
    const gap = computeGap(nextClaimed)
    setGapReport(gap)
    setPanelOpen('gap', true)
    try {
      await updateJob(job.id, {
        claimedSkills: nextClaimed,
        matchScore: gap.coveragePercent,
      })
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save claimed skill'))
    }
  }

  const runTailor = () => {
    if (skillsLocked) return
    setError(null)
    setPanelOpen('tailor', true)
    setPanelOpen('cover', true)
    return start(job.id)
  }

  /** Fresh check on open, so an older saved report cannot hide languages or role requirements. */
  const onGapClick = () => {
    if (loading) return
    if (showGap) {
      setPanelOpen('gap', false)
      return
    }
    if (gapCheckMode === 'view') {
      setPanelOpen('gap', true)
      return
    }
    if (gapCheckMode === 'run') void runGap()
  }

  const skillExplanation = skillExplanations.get(job.id)
  const explainSkillName = skillExplanation?.skill ?? null
  useEffect(() => {
    if (!explainSkillName) return
    if (!openPanels.has('gap')) setPanelOpen('gap', true)
  }, [explainSkillName, openPanels, setPanelOpen])
  const lookupSkill = (skill: string) => skillExplanations.toggle(job.id, skill)

  const onTailorClick = () => {
    if (loading) return
    if (!hasSavedFiles) {
      void runTailor()
      return
    }
    const open = !showTailor
    setPanelOpen('tailor', open)
    setPanelOpen('cover', open)
  }

  const hidePack = () => {
    setPanelOpen('tailor', false)
    setPanelOpen('cover', false)
  }

  const handlePrint = () =>
    run('print', async () => {
      if (!tailoredCv) throw new Error('Tailor the resume first before printing')
      openCvPrintWindow(tailoredCv, `${job.company} — ${job.role}`)
    })

  const handleApplicationPack = () =>
    run('pack', async () => {
      if (!tailoredCv) throw new Error('Tailor the resume first')
      await downloadApplicationPack({
        company: job.company,
        role: job.role,
        tailoredCv,
        coverLetter,
      })
    })

  const claimedKeywords = useMemo(() => gapReport.claimedKeywords ?? [], [gapReport.claimedKeywords])
  const gapSkills = useMemo<GapSkill[]>(() => {
    if (gapReport.skills?.length) return gapReport.skills
    return [
      ...gapReport.matchedKeywords.map((skill) => ({ skill, state: 'have' as const })),
      ...claimedKeywords.map((skill) => ({ skill, state: 'added' as const })),
      ...gapReport.missingKeywords.map((skill) => ({ skill, state: 'missing' as const })),
    ]
  }, [gapReport, claimedKeywords])
  const displaySkills = useMemo(
    () => [
      ...gapSkills.filter((item) => item.state === 'have'),
      ...gapSkills.filter((item) => item.state !== 'have'),
    ],
    [gapSkills]
  )
  const addedKeys = useMemo(
    () => new Set(gapSkills.filter((item) => item.state === 'added').map((item) => skillKey(item.skill))),
    [gapSkills]
  )
  const transferSuggestions = useMemo(
    () =>
      suggestTransferableSkills(
        gapSkills.filter((item) => item.state !== 'have').map((item) => item.skill),
        [...masterCvSkillList(masterCv), ...gapReport.matchedKeywords]
      ),
    [gapSkills, gapReport.matchedKeywords, masterCv]
  )

  const baseFor = (row: (typeof transferSuggestions)[number]) => {
    if (row.relatedOwned.length === 0) return row.baseLabel ?? 'Nothing close on your CV.'
    const names = row.relatedOwned.slice(0, 3)
    const listed =
      names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names[0]}, ${names[1]}, and ${names[2]}`
    return `You already use ${listed}.`
  }

  const claimFor = (row: (typeof transferSuggestions)[number]) => {
    if (addedKeys.has(skillKey(row.skill))) {
      return skillsLocked ? (
        <span className="ui-body font-medium text-brand-ink legacy-size-text_sm">Added</span>
      ) : (
        <button
          type="button"
          disabled={!!loading} aria-busy={!!loading}
          onClick={() => void toggleClaimedSkill(row.skill)}
          title="Click to remove it from this resume"
          className="text-sm font-medium text-brand-ink underline-offset-4 transition hover:text-[#23745e] hover:underline disabled:opacity-60 ui-skill-control legacy-size-text_sm"
        >
          Added
        </button>
      )
    }
    return row.checkIt ? (
      skillsLocked ? (
        <span className="ui-body font-medium text-brand-ink legacy-size-text_sm">
          {transferCheck(row.difficulty) === 'yes' ? 'Yes' : 'Probably'}
        </span>
      ) : (
        <button
          type="button"
          disabled={!!loading}
          onClick={() => void toggleClaimedSkill(row.skill)}
          className="text-sm font-medium text-brand-ink underline-offset-4 transition hover:text-[#23745e] hover:underline disabled:opacity-60 ui-skill-control legacy-size-text_sm"
        >
          {transferCheck(row.difficulty) === 'yes' ? 'Yes' : 'Probably'}
        </button>
      )
    ) : (
      <span
        className={
          row.difficulty === 'hard'
            ? 'text-sm font-medium text-orange-700'
            : 'text-sm font-medium text-red-700'
        }
      >
        {transferCheck(row.difficulty) === 'unlikely' ? 'Unlikely' : 'No'}
      </span>
    )
  }

  return (
    <div className="ui-panel space-y-4">
      <div>
        <h2 className=" ui-section-title legacy-size-text_base">ATS tailor & export</h2>
        {job.status === 'saved' && !canGenerate && <p className="mt-2 ui-helper legacy-size-text_sm">{job.deletedAt ? 'Restore this application before generating again. Saved files remain available.' : hasSavedFiles ? 'Source CV deleted. Your saved files are available; choose a CV to generate again.' : 'Choose a CV before generating application files.'}</p>}
        {(canGenerate || job.status !== 'saved') && <p className="mt-1 ui-helper text-brand-muted legacy-size-text_sm">
          Using <span className="text-brand-ink">{templateLabel}</span> master CV. One
          button writes the resume and the cover letter. Click it again to show or hide both.
          {skillsLocked
            ? ' Skill claims stay as they were when you applied.'
            : ' Re-run updates both.'}
        </p>}
      </div>

      <div className="m-actions flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {gapCheckMode !== 'hidden' && (
          <button
            type="button"
            data-role="quiet"
            disabled={!!loading || gapCheckMode === 'disabled'}
            onClick={onGapClick}
            className="ui-button ui-primary m-action"
          >
            {loading === 'gap' ? 'Checking…' : gapCheckMode === 'view' ? (showGap ? 'Hide gap check' : 'View gap check') : 'Gap check'}
          </button>
        )}
        <button
          type="button"
          data-role="primary"
          disabled={!!loading || (!hasSavedFiles && skillsLocked)}
          onClick={onTailorClick}
          className={`${hasSavedFiles ? quietBtn : pasteBtn} m-action w-full sm:w-auto`}
        >
          {loading === 'tailor' ? 'Tailoring…' : hasSavedFiles ? (showTailor ? 'Hide files' : 'See files') : 'Tailor'}
        </button>
      </div>

      {loading && <LoadingSpinner label="Working…" />}
      {error && (
        <p className="ui-helper !text-red-700 legacy-size-text_sm" role="alert">
          {error}
        </p>
      )}
      {task?.phase === 'failed' && <div role="alert" className="space-y-2">
        <p className="ui-helper !text-red-700">{task.error}</p>
        {!skillsLocked && <button type="button" className="ui-button ui-primary" onClick={() => void (task.output ? retrySave(job.id) : runTailor())}>{task.output ? 'Retry save' : 'Retry tailoring'}</button>}
      </div>}
      {copied > 0 && <div key={copied} role="status" aria-live="polite" className="copy-confirmation fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 max-w-[calc(100%-2rem)] text-center rounded-lg border border-brand-line bg-white px-4 py-3 ui-helper font-medium !text-brand-ink shadow-sm lg:bottom-6 legacy-size-text_sm">Cover letter copied</div>}

      {showGap && hasGapContent(gapReport) && gapCheckMode !== 'hidden' && gapCheckMode !== 'disabled' && (
        <div className={nested}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className=" ui-label legacy-size-text_sm">
              Keyword coverage: {gapReport.coveragePercent}%
            </h3>
            <button type="button" className={quietBtn} onClick={() => setPanelOpen('gap', false)}>
              Close
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 ui-meta text-brand-muted legacy-size-text_xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#f4faf8] ring-1 ring-[#dce8e4]" />
              On your CV
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-brand-primary bg-brand-mist" />
              Added
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#faf6ef] ring-1 ring-[#e6d3b8]" />
              Not on this CV
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {displaySkills.map((item) => {
              const className = `${chipClass(item.state)} disabled:opacity-60`
              if (item.state === 'have' || skillsLocked) {
                return (
                  <span key={item.skill} className={className}>
                    {item.skill}
                  </span>
                )
              }
              return (
                <button
                  key={item.skill}
                  type="button"
                  disabled={!!loading}
                  onClick={() => void toggleClaimedSkill(item.skill)}
                  title={item.state === 'added' ? 'Click to remove it from this resume' : 'Click if you know this skill'}
                  className={`${className} ui-skill-control`}
                >
                  {item.skill}
                </button>
              )
            })}
          </div>
          <ul className="mt-3 space-y-1 ui-body text-brand-ink legacy-size-text_sm">
            {gapReport.suggestions
              .filter((s) => !(skillsLocked && s.startsWith('Warm chips')))
              .map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-brand-muted">•</span>
                {s}
              </li>
            ))}
          </ul>
          {transferSuggestions.length > 0 && (
            <div className="mt-4 border-t border-[#e6eeeb] pt-4">
              <h4 className="text-sm font-medium text-brand-ink">Compared with your CV</h4>
              <p className="mt-1 hidden ui-helper text-brand-muted sm:block legacy-size-text_sm">
                How hard it is to become proficient, based on what is already on your CV. A check
                stays in this list.
              </p>
              <ul className="mt-2 divide-y divide-[#e6eeeb] sm:hidden">
                {transferSuggestions.map((row) => (
                  <li key={row.skill} className="py-3">
                    <SkillName
                      skill={row.skill}
                      added={addedKeys.has(skillKey(row.skill))}
                      active={explainSkillName === row.skill}
                      onClick={() => void lookupSkill(row.skill)}
                    />
                    <p className="mt-1 ui-body legacy-size-text_sm">
                      <span className={transferDifficultyClass(row.difficulty)}>
                        {transferDifficultyLabel(row.difficulty)}
                      </span>
                      <span className="text-brand-muted"> · </span>
                      {claimFor(row)}
                    </p>
                    <p className="mt-0.5 ui-helper text-brand-muted legacy-size-text_sm">{baseFor(row)}</p>
                    {explainSkillName === row.skill && (
                      <SkillAnswer
                        loading={skillExplanation?.status === 'loading'}
                        error={skillExplanation?.error ?? null}
                        summary={skillExplanation?.summary ?? null}
                        onRetry={() => skillExplanations.retry(job.id, row.skill)}
                      />
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-3 hidden sm:block">
                <table className="w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[24%]" />
                    <col className="w-[42%]" />
                    <col className="w-[16%]" />
                    <col className="w-[18%]" />
                  </colgroup>
                  <thead className="text-xs text-brand-muted">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Skill</th>
                      <th className="pb-2 pr-3 font-medium">Your base</th>
                      <th className="pb-2 pr-3 font-medium">From zero</th>
                      <th className="w-[7.5rem] pb-2 font-medium">Claim?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e6eeeb]">
                    {transferSuggestions.map((row) => (
                      <Fragment key={row.skill}>
                        <tr>
                          <td className="py-2 pr-3 font-medium text-brand-ink">
                            <SkillName
                              skill={row.skill}
                              added={addedKeys.has(skillKey(row.skill))}
                              active={explainSkillName === row.skill}
                              onClick={() => void lookupSkill(row.skill)}
                            />
                          </td>
                          <td className="py-2 pr-3 text-brand-muted">{baseFor(row)}</td>
                          <td className="py-2 pr-3">
                            <span className={transferDifficultyClass(row.difficulty)}>
                              {transferDifficultyLabel(row.difficulty)}
                            </span>
                          </td>
                          <td className="w-[7.5rem] whitespace-nowrap py-2">{claimFor(row)}</td>
                        </tr>
                        {explainSkillName === row.skill && (
                          <tr>
                            <td colSpan={4} className="pb-3">
                              <SkillAnswer
                                loading={skillExplanation?.status === 'loading'}
                                error={skillExplanation?.error ?? null}
                                summary={skillExplanation?.summary ?? null}
                                onRetry={() => skillExplanations.retry(job.id, row.skill)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {showTailor && tailoredCv && (
        <div className={nested}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className=" ui-label legacy-size-text_sm">Tailored preview</h3>
            <div className="flex items-center gap-2">
              {!skillsLocked && (
                <button
                  type="button"
                  disabled={!!loading}
                  className={quietBtn}
                  onClick={() => void runTailor()}
                >
                  Re-run
                </button>
              )}
              <button
                type="button"
                className={quietBtn}
                onClick={hidePack}
              >
                Close
              </button>
            </div>
          </div>
          <p className="ui-body font-medium text-brand-ink legacy-size-text_sm">{tailoredCv.headline}</p>
          <p className="mt-2 whitespace-pre-wrap ui-body text-brand-ink legacy-size-text_sm">
            {tailoredCv.summary}
          </p>
          {tailoredCv.experience[0]?.bullets?.length ? (
            <ul className="mt-3 space-y-1 ui-body text-brand-ink legacy-size-text_sm">
              {tailoredCv.experience[0].bullets.slice(0, 4).map((b) => (
                <li key={b.id} className="flex gap-2">
                  <span className="text-brand-muted">•</span>
                  {b.text}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="m-actions mt-4 flex flex-wrap gap-2 border-t border-[#e6eeeb] pt-4">
            <button
              type="button"
              data-role="primary"
              disabled={!!loading}
              onClick={handleApplicationPack}
              className="ui-button ui-secondary m-action"
              title="ZIP folder with resume and cover letter"
            >
              {loading === 'pack' ? 'Packing…' : 'Download application folder'}
            </button>
            <button
              type="button"
              data-role="quiet"
              disabled={!!loading}
              onClick={handlePrint}
              className="ui-button ui-secondary m-action"
            >
              {loading === 'print' ? 'Opening…' : 'Print / PDF'}
            </button>
          </div>
        </div>
      )}

      {showTailor && (
        <div className={nested}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className=" ui-label legacy-size-text_sm">Cover letter</h3>
            {coverLetter.trim() && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={quietBtn}
                  onClick={() => void copyLetter()}
                >
                  Copy
                </button>
                <button type="button" className={quietBtn} onClick={hidePack}>
                  Close
                </button>
              </div>
            )}
          </div>
          {coverLetter.trim() ? (
            <p className="whitespace-pre-wrap ui-body text-brand-ink legacy-size-text_sm">{coverLetter}</p>
          ) : (
            <p className="ui-helper text-brand-muted legacy-size-text_sm">
              No cover letter saved with this resume. Re-run creates the resume and the letter together.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
