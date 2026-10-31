import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseJobPosting } from '../api/gemini'
import { SectionHeader } from '../components/SectionHeader'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useJobs } from '../hooks/useJobs'
import { useMasterCv } from '../hooks/useMasterCv'
import { scoreMasterCvAgainstJob, withRequirementSignals } from '../lib/matchScore'
import { incompleteJobRequirementAnalysis } from '../../shared/jobRequirements'
import { type CvTrack } from '../types/cv'
import { PostingSkillPicker } from '../components/PostingSkillPicker'
import { postingSkillNames } from '../lib/jobSkills'
import {
  createEmptyJob,
  guessJobSourceFromUrl,
  JOB_SOURCE_LABELS,
  PORTAL_JOB_SOURCE_OPTIONS,
  type PortalJobSource,
} from '../types/job'


const fieldLabel = "ui-label legacy-size-text_sm"
const fieldControl =
  "ui-field mt-1 legacy-size-text_sm"

export function AddJobPage() {
  const navigate = useNavigate()
  const { addJob } = useJobs()
  const { getCv, activeTrack, library, getLabel } = useMasterCv()
  const [form, setForm] = useState(() =>
    createEmptyJob({ cvTrack: null, source: 'indeed', status: 'saved' })
  )
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Once the user picks Source manually, stop overwriting from URL. */
  const [sourceLocked, setSourceLocked] = useState(false)

  const update = (field: keyof typeof form, value: string | CvTrack | null) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const setJobUrl = (url: string) => {
    setForm((prev) => ({
      ...prev,
      jobUrl: url,
      source: sourceLocked ? prev.source : guessJobSourceFromUrl(url),
    }))
  }

  const handleParseAndFill = async () => {
    if (!pasteText.trim()) return
    setParsing(true)
    setError(null)
    try {
      const parsed = await parseJobPosting(pasteText.trim())
      setForm((prev) => ({
        ...prev,
        company: parsed.company || prev.company,
        role: parsed.role || prev.role,
        location: parsed.location || prev.location,
        salary: parsed.salary || prev.salary,
        // Keep the original pasted posting verbatim — never replace with summary
        jobDescription: pasteText.trim(),
        jdSummary: parsed.summary || prev.jdSummary,
        extractedSkills: withRequirementSignals(
          `${parsed.role || prev.role}\n${pasteText}`,
          parsed.skills ?? []
        ),
        extractedRequirements: parsed.requirements ?? [],
        requirementAnalysis: parsed.requirementAnalysis,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse posting')
    } finally {
      setParsing(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.company.trim() || !form.role.trim()) {
      setError('Company and role are required')
      return
    }
    try {
      const fullJd = form.jobDescription.trim() || pasteText.trim()
      const requirementAnalysis = form.requirementAnalysis ?? (fullJd ? incompleteJobRequirementAnalysis(fullJd, 'This job description has not been analyzed yet.') : null)
      const track = form.cvTrack ?? activeTrack
      const selectedCv = getCv(track)
      if (!selectedCv) throw new Error('Choose an existing CV template before saving.')
      const described = `${form.role}\n${fullJd}`
      const extractedSkills = withRequirementSignals(described, form.extractedSkills)
      const analysis = requirementAnalysis
      const match = analysis?.status === 'complete'
        ? scoreMasterCvAgainstJob(fullJd, selectedCv, extractedSkills, analysis)
        : null
      await addJob({
        ...form,
        status: 'saved',
        jobDescription: fullJd,
        extractedSkills,
        requirementAnalysis,
        cvTrack: track,
        matchScore: match?.score ?? null,
        jdComplete: Boolean(fullJd),
      })
      navigate(`/job/${form.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save job')
    }
  }

  const sourceValue: PortalJobSource = PORTAL_JOB_SOURCE_OPTIONS.includes(
    form.source as PortalJobSource
  )
    ? (form.source as PortalJobSource)
    : 'indeed'
  const displayedSkills = form.requirementAnalysis?.status === 'complete'
    ? postingSkillNames(form.requirementAnalysis, form.extractedSkills)
    : []

  return (
    <div className="ui-page add-job-page mx-auto min-w-0 w-full">
      <SectionHeader title="Add application" description="Paste a job posting or enter its details to add it to your board." />

      <div className="add-job-layout">
        <section className="ui-panel add-job-posting">
          <h2 className="ui-section-title legacy-size-text_base">Quick add with AI</h2>
          <textarea
            value={pasteText}
            onChange={(e) => {
              const value = e.target.value
              setPasteText(value)
              setForm((prev) => ({ ...prev, jobDescription: value, extractedSkills: [], extractedRequirements: [], requirementAnalysis: value.trim() ? incompleteJobRequirementAnalysis(value.trim(), 'This edited job description has not been analyzed yet.') : null, matchScore: null }))
            }}
            disabled={parsing}
            rows={8}
            placeholder="Paste the complete job posting here…"
            className={fieldControl}
          />
          <div className="add-job-posting-actions">
            <div className="m-actions">
              <button
                type="button"
                data-role="primary"
                onClick={handleParseAndFill}
                disabled={parsing || !pasteText.trim()}
                aria-busy={parsing}
                className="ui-button ui-primary"
              >
                {parsing ? 'Parsing…' : 'Parse with AI'}
              </button>
            </div>
            {parsing && <LoadingSpinner label="Extracting job details…" />}
          </div>
        </section>

        <form onSubmit={handleSubmit} className="ui-panel add-job-details space-y-4">
          {error && (
            <p className="ui-helper !text-red-700 legacy-size-text_sm" role="alert">
              {error}
            </p>
          )}

          <div className="add-job-details-fields">
            <label className="ui-label block">
              <span className={fieldLabel}>
                Company <span className="text-red-700">*</span>
              </span>
              <input
                value={form.company}
                onChange={(e) => update('company', e.target.value)}
                className={fieldControl}
                required
              />
            </label>
            <label className="ui-label block">
              <span className={fieldLabel}>
                Role <span className="text-red-700">*</span>
              </span>
              <input
                value={form.role}
                onChange={(e) => update('role', e.target.value)}
                className={fieldControl}
                required
              />
            </label>
            <label className="ui-label block">
              <span className={fieldLabel}>Location</span>
              <input
                value={form.location}
                onChange={(e) => update('location', e.target.value)}
                className={fieldControl}
              />
            </label>
            <label className="ui-label block">
              <span className={fieldLabel}>Salary</span>
              <input
                value={form.salary}
                onChange={(e) => update('salary', e.target.value)}
                className={fieldControl}
              />
            </label>
            <label className="add-job-full-row ui-label block">
              <span className={fieldLabel}>Job URL</span>
              <input
                type="url"
                value={form.jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                className={fieldControl}
              />
            </label>
            <label className="ui-label block">
              <span className={fieldLabel}>Portal</span>
              <select
                value={sourceValue}
                onChange={(e) => {
                  setSourceLocked(true)
                  update('source', e.target.value)
                }}
                className={`${fieldControl} form-select`}
              >
                {PORTAL_JOB_SOURCE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {JOB_SOURCE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-label block">
              <span className={fieldLabel}>
                Master CV <span className="text-red-700">*</span>
              </span>
              <select
                value={form.cvTrack ?? activeTrack}
                onChange={(e) => update('cvTrack', e.target.value as CvTrack)}
                className={`${fieldControl} form-select`}
              >
                {Object.keys(library.cvs).map((track) => (
                  <option key={track} value={track}>
                    {getLabel(track)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {form.jdSummary && (
            <div className="rounded-lg border border-[#e6eeeb] bg-[#f7fbf9] p-3">
              <span className={fieldLabel}>AI summary</span>
              <p className="mt-1 ui-body leading-relaxed text-brand-ink legacy-size-text_sm">{form.jdSummary}</p>
            </div>
          )}

          <label className="ui-label block">
            <span className={fieldLabel}>Full job description</span>
            <textarea
              value={form.jobDescription}
              onChange={(e) => {
                update('jobDescription', e.target.value)
                setPasteText(e.target.value)
              }}
              rows={8}
              className={fieldControl}
            />
          </label>

          <label className="ui-label block">
            <span className={fieldLabel}>Personal notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={2}
              className={fieldControl}
            />
          </label>

          {displayedSkills.length > 0 && (
            <PostingSkillPicker skills={displayedSkills} track={form.cvTrack ?? activeTrack} heading="Extracted skills" />
          )}

          <div className="ui-form-actions">
            <button type="submit" data-role="primary" className="ui-button ui-primary">
              Save application
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
