import { TrashIcon } from '../components/TrashIcon'
import { SectionHeader } from '../components/SectionHeader'
import { useEffect, useRef, useState } from 'react'
import { useJobs } from '../hooks/useJobs'
import { useSavedSearches } from '../hooks/useSavedSearches'
import { templateReferences } from '../lib/cvLibrary'
import { getErrorMessage } from '../lib/errorMessage'
import { parseResumeText } from '../api/gemini'
import { useMasterCv } from '../hooks/useMasterCv'
import {
  extractTextFromResumeFile,
  mergeParsedCv,
  sparseCvFromText,
  splitEducationAndCerts,
} from '../lib/resumeImport'
import {
  type ResumeAttachment,
  type CvCertification,
  type CvEducation,
  type CvExperience,
  type CvProject,
  type CvSkillGroup,
  type CvTrack,
  type MasterCv,
} from '../types/cv'

const card = "ui-panel min-w-0 space-y-4"
const button = "ui-button ui-secondary"
const field = "ui-field"

export function MasterCvPage() {
  const {
    library,
    activeTrack,
    loading,
    setActiveTrack,
    getCv,
    saveTemplate, getLabel, addTemplate, renameTemplate, deleteTemplate, loadError, reload,
  } = useMasterCv()
  const [editingTrack, setEditingTrack] = useState<CvTrack>(activeTrack)
  const [draft, setDraft] = useState<MasterCv | null>(null)
  const [saved, setSaved] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)
  const { jobs } = useJobs()
  const { searches } = useSavedSearches()
  const [busy, setBusy] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [rename, setRename] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [replacement, setReplacement] = useState('')
  const [pendingAttachment, setPendingAttachment] = useState<ResumeAttachment | undefined>()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (deleting) dialog.current?.showModal(); else dialog.current?.close() }, [deleting])

  useEffect(() => {
    setEditingTrack(activeTrack)
    setDraft(null)
    setPendingAttachment(undefined)
    setRename(null)
    setImportNote(null)
    setSaved(false)
  }, [activeTrack])

  const cv = draft ?? getCv(editingTrack)
  const attachment = library.attachments[editingTrack]
  const setCv = (next: MasterCv) => setDraft(next)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setImportError(null)
    try { await action() }
    catch (error) { setImportError(getErrorMessage(error, 'Could not save. Your draft is still here.')) }
    finally { setBusy(false) }
  }
  const saveDraft = async () => { if (draft) await saveTemplate(editingTrack, draft, pendingAttachment) }
  const switchTrack = (track: CvTrack) => run(async () => {
    await setActiveTrack(track, draft ? {track:editingTrack, cv:draft, attachment:pendingAttachment} : undefined)
    setDraft(null)
    setPendingAttachment(undefined)
  })

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cv) return
    await run(async () => {
      await saveTemplate(editingTrack, cv, pendingAttachment)
      setDraft(null)
      setPendingAttachment(undefined)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const handleUpload = async (file: File | null) => {
    if (!file || !cv || busy || importing) return
    const target = editingTrack
    const base = cv
    setImporting(true)
    setImportError(null)
    setImportNote(null)
    try {
      const text = await extractTextFromResumeFile(file)
      if (!text.trim()) throw new Error('No text could be extracted from that file.')

      const importedAttachment = {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
        extractedText: text,
      }
      setPendingAttachment(importedAttachment)

      let next = sparseCvFromText(text, base)
      try {
        const parsed = await parseResumeText(text, target, getLabel(target))
        next = mergeParsedCv(base, parsed)
        setImportNote('Resume imported into the form. Review fields and save when ready.')
      } catch {
        setImportNote(
          'Text extracted and saved in Summary. AI structuring failed — edit the form manually or try again later.'
        )
      }

      setDraft(next)
      await saveTemplate(target, next, importedAttachment)
      setDraft(null)
      setPendingAttachment(undefined)
    } catch (err) {
      setImportError(getErrorMessage(err, 'Import failed. Your draft is still here.'))
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return <p className="ui-helper text-brand-muted">Loading master CV…</p>
  }

  if (loadError || !cv) return <div className={card}><p role="alert" className="ui-helper">{loadError ?? 'CV template unavailable.'}</p><button className="ui-button ui-primary" onClick={() => void reload()}>Retry loading CVs</button></div>
  const locked = busy || importing
  const refs = deleting ? templateReferences(library, deleting, jobs, searches) : { jobs: [], searches: [] }
  const needsReplacement = refs.jobs.length + refs.searches.length > 0

  return (
    <div className="ui-page mx-auto min-w-0 max-w-3xl" aria-busy={locked}>
      <SectionHeader title="CV library" description="Create and manage master CVs for the roles you apply to." actions={<button type="button" className="ui-button ui-primary" disabled={locked} onClick={() => setShowAdd(!showAdd)}>+ New CV</button>} />
      {importError && <div className="space-y-2 rounded-lg bg-red-50 p-3"><p role="alert" className="ui-helper !text-red-700">{importError}</p><button type="button" disabled={locked} className={button} onClick={() => void run(reload)}>Reload library</button></div>}
      {showAdd && <form className={card} onSubmit={(e) => { e.preventDefault(); void run(async () => { await saveDraft(); await addTemplate(newName, copyFrom || undefined); setNewName(''); setShowAdd(false) }) }}>
        <h2 className="break-words ui-section-title">New CV template</h2>
        <label className="ui-label block">Template name<input required disabled={locked} className={`${field} mt-1`} value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
        <label className="ui-label block">Start from<select className={`${field} mt-1 form-select`} disabled={locked} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}><option value="">Blank CV</option>{Object.keys(library.cvs).map((id) => <option key={id} value={id}>{getLabel(id)}</option>)}</select></label>
        <div className="flex min-w-0 gap-2"><button className="ui-button ui-primary" disabled={locked || !newName.trim()}>Create CV</button><button type="button" className={button} disabled={locked} onClick={() => setShowAdd(false)}>Cancel</button></div>
      </form>}
      <section className={card}>
        <label className="ui-label block">Selected CV<select aria-label="Selected CV" disabled={locked} className={`${field} mt-2 form-select`} value={editingTrack} onChange={(e) => void switchTrack(e.target.value)}>{Object.keys(library.cvs).map((id) => <option key={id} value={id}>{getLabel(id)}</option>)}</select></label>
        <div className="flex flex-wrap items-center gap-2"><span className="mr-auto ui-meta text-brand-muted">Used by default for new applications</span><button type="button" className={button} disabled={locked} onClick={() => setRename(getLabel(editingTrack))}>Rename</button><CvDeleteButton label={`Delete ${getLabel(editingTrack)} template`} disabled={locked || Object.keys(library.cvs).length <= 1} onClick={() => { setReplacement(''); setDeleting(editingTrack) }} /></div>
        {rename !== null && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { await renameTemplate(editingTrack, rename); setRename(null) }) }}><label className="ui-label block">Template name<input className={`${field} mt-1`} required disabled={locked} value={rename} onChange={(e) => setRename(e.target.value)} /></label><div className="flex min-w-0 gap-2"><button className="ui-button ui-primary" disabled={locked || !rename.trim()}>Save name</button><button type="button" className={button} disabled={locked} onClick={() => setRename(null)}>Cancel</button></div></form>}
      </section>
      <dialog ref={dialog} aria-labelledby="delete-cv-title" aria-describedby="delete-cv-description" aria-busy={locked} onCancel={(e) => { if (locked) e.preventDefault(); else setDeleting(null) }} className="ui-panel ui-dialog w-[calc(100%-2rem)] max-w-lg backdrop:bg-brand-ink/30">
        {deleting && <div className="min-w-0 space-y-4"><h2 id="delete-cv-title" className="break-words ui-dialog-title">Delete {getLabel(deleting)}?</h2><p id="delete-cv-description" className="ui-helper text-brand-muted">This removes the template and its attached resume. Submitted application documents stay saved.</p>
          {needsReplacement && <><p className="ui-body">Choose a replacement for these saved references:</p><ul className="max-h-40 space-y-1 overflow-auto ui-body">{refs.jobs.map((job) => <li key={job.id} className="break-words">Job: {job.role} at {job.company}</li>)}{refs.searches.map((search) => <li key={search.id} className="break-words">Search: {search.label || search.query}</li>)}</ul></>}
          <label className="ui-label block">Replacement CV{!needsReplacement && ' (optional)'}<select aria-label="Replacement CV" className={`${field} mt-1 form-select`} disabled={locked} value={replacement} onChange={(e) => setReplacement(e.target.value)}><option value="">{needsReplacement ? 'Choose a CV' : 'Use another remaining CV'}</option>{Object.keys(library.cvs).filter((id) => id !== deleting).map((id) => <option key={id} value={id}>{getLabel(id)}</option>)}</select></label>
          {importError && <p role="alert" className="ui-helper !text-red-700">{importError}</p>}
          <div className="flex flex-wrap gap-2"><CvDeleteButton confirm label="Delete template" disabled={locked || (needsReplacement && !replacement)} onClick={() => void run(async () => { await deleteTemplate(deleting, replacement || undefined); setDeleting(null); setDraft(null); setPendingAttachment(undefined) })} />{busy && <span role="status" className="self-center ui-helper text-brand-muted">Deleting…</span>}<button className={button} disabled={locked} onClick={() => setDeleting(null)}>Cancel</button></div>
        </div>}
      </dialog>
      <fieldset disabled={locked} className="min-w-0 space-y-6">
      <section className="ui-panel min-w-0 space-y-4">
        <h2 className="break-words ui-section-title">Attach resume → fill form</h2>
        <input
          type="file"
          accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={locked}
          onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
          className="ui-file w-full"
        />
        {attachment && (
          <p className="break-words ui-meta text-brand-muted">
            Stored: <span className="font-medium">{attachment.fileName}</span> ·{' '}
            {new Date(attachment.uploadedAt).toLocaleString()} ·{' '}
            {attachment.extractedText.length.toLocaleString()} chars extracted
          </p>
        )}
        {importing && <p className="ui-helper !text-[#23745e]">Importing…</p>}
        {importError && (
          <p className="rounded-lg bg-red-50 p-3 ui-helper !text-red-700">
            {importError}
          </p>
        )}
        {importNote && (
          <p className="rounded-lg bg-emerald-50 p-3 ui-helper !text-emerald-800">
            {importNote}
          </p>
        )}
      </section>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="ui-panel min-w-0 space-y-4">
          <h2 className="break-words ui-section-title">Contact · {getLabel(editingTrack)}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['name', 'Full name'],
                ['email', 'Email'],
                ['phone', 'Phone'],
                ['location', 'Location'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="ui-label block">
                <span className="font-medium">{label}</span>
                <input
                  value={cv.contact[key]}
                  onChange={(e) =>
                    setCv({ ...cv, contact: { ...cv.contact, [key]: e.target.value } })
                  }
                  className="mt-1 min-w-0 w-full ui-field"
                />
              </label>
            ))}
          </div>
          <label className="ui-label block">
            <span className="font-medium">Links (comma-separated)</span>
            <input
              value={cv.contact.links.join(', ')}
              onChange={(e) =>
                setCv({
                  ...cv,
                  contact: {
                    ...cv.contact,
                    links: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              className="mt-1 min-w-0 w-full ui-field"
            />
          </label>
          <label className="ui-label block">
            <span className="font-medium">Headline</span>
            <input
              value={cv.headline}
              onChange={(e) => setCv({ ...cv, headline: e.target.value })}
              className="mt-1 min-w-0 w-full ui-field"
            />
          </label>
          <label className="ui-label block">
            <span className="font-medium">Summary</span>
            <textarea
              value={cv.summary}
              onChange={(e) => setCv({ ...cv, summary: e.target.value })}
              rows={5}
              className="mt-1 min-w-0 w-full ui-field"
            />
          </label>
        </section>

        <SkillGroupsEditor skills={cv.skills} onChange={(skills) => setCv({ ...cv, skills })} />
        <ExperienceEditor
          experience={cv.experience}
          onChange={(experience) => setCv({ ...cv, experience })}
        />
        <ProjectsEditor projects={cv.projects} onChange={(projects) => setCv({ ...cv, projects })} />
        <EducationEditor
          education={cv.education}
          certifications={cv.certifications ?? []}
          onChange={(education) => setCv({ ...cv, education })}
          onSplitCerts={() => {
            const split = splitEducationAndCerts(cv.education, cv.certifications ?? [])
            setCv({ ...cv, education: split.education, certifications: split.certifications })
          }}
        />
        <CertificationsEditor
          certifications={cv.certifications ?? []}
          onChange={(certifications) => setCv({ ...cv, certifications })}
        />

        <div className="ui-form-actions">
        <button
          type="submit"
          disabled={locked} className="ui-button ui-primary break-words"
        >
          {saved ? '✓ Saved' : 'Save CV'}
        </button>
        </div>
      </form>
      </fieldset>
    </div>
  )
}

function SkillGroupsEditor({
  skills,
  onChange,
}: {
  skills: CvSkillGroup[]
  onChange: (skills: CvSkillGroup[]) => void
}) {
  return (
    <section className="ui-panel min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="break-words ui-section-title">Skills</h2>
        <button
          type="button"
          className="ui-button ui-primary"
          onClick={() =>
            onChange([...skills, { id: crypto.randomUUID(), group: 'Group', items: [] }])
          }
        >
          + Group
        </button>
      </div>
      {skills.map((group, index) => (
        <div key={group.id} className="space-y-2 rounded-lg border border-[#e6eeeb] p-3">
          <div className="flex min-w-0 gap-2">
            <input
              value={group.group}
              onChange={(e) => {
                const next = [...skills]
                next[index] = { ...group, group: e.target.value }
                onChange(next)
              }}
              className="min-w-0 w-full ui-field"
            />
            <CvDeleteButton
              label={`Remove ${group.group || 'skill'} group`}
              onClick={() => onChange(skills.filter((g) => g.id !== group.id))}
            />
          </div>
          <input
            value={group.items.join(', ')}
            onChange={(e) => {
              const next = [...skills]
              next[index] = {
                ...group,
                items: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
              onChange(next)
            }}
            placeholder="React, TypeScript, …"
            className="min-w-0 w-full ui-field"
          />
        </div>
      ))}
    </section>
  )
}

function CvDeleteButton({ onClick, label, disabled, confirm = false }: { onClick: () => void; label: string; disabled?: boolean; confirm?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={confirm ? "ui-button ui-danger" : "ui-button ui-danger-quiet ui-icon-button ui-compact"}
    >
      <TrashIcon />{confirm && <span>{label}</span>}
    </button>
  )
}

function ExperienceEditor({
  experience,
  onChange,
}: {
  experience: CvExperience[]
  onChange: (experience: CvExperience[]) => void
}) {
  return (
    <section className="ui-panel min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="break-words ui-section-title">Experience</h2>
        <button
          type="button"
          className="ui-button ui-primary"
          onClick={() =>
            onChange([
              ...experience,
              {
                id: crypto.randomUUID(),
                company: '',
                title: '',
                location: '',
                start: '',
                end: '',
                current: false,
                bullets: [{ id: crypto.randomUUID(), text: '', tags: [] }],
              },
            ])
          }
        >
          + Role
        </button>
      </div>
      {experience.map((exp, index) => (
        <div key={exp.id} className="space-y-2 rounded-lg border border-[#e6eeeb] p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="pt-1.5 ui-meta font-medium uppercase tracking-wide text-brand-muted">
              Role {index + 1}
            </p>
            <CvDeleteButton
              label="Remove role"
              onClick={() => onChange(experience.filter((e) => e.id !== exp.id))}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={exp.title}
              placeholder="Title"
              onChange={(e) => {
                const next = [...experience]
                next[index] = { ...exp, title: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            />
            <input
              value={exp.company}
              placeholder="Company"
              onChange={(e) => {
                const next = [...experience]
                next[index] = { ...exp, company: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            />
            <input
              value={exp.location}
              placeholder="Location"
              onChange={(e) => {
                const next = [...experience]
                next[index] = { ...exp, location: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            />
            <div className="flex min-w-0 gap-2">
              <input
                value={exp.start}
                placeholder="Start"
                onChange={(e) => {
                  const next = [...experience]
                  next[index] = { ...exp, start: e.target.value }
                  onChange(next)
                }}
                className="min-w-0 w-full ui-field"
              />
              <input
                value={exp.end}
                placeholder="End"
                disabled={exp.current}
                onChange={(e) => {
                  const next = [...experience]
                  next[index] = { ...exp, end: e.target.value }
                  onChange(next)
                }}
                className="min-w-0 w-full ui-field"
              />
            </div>
          </div>
          <label className="ui-label ui-check-label">
            <input
              type="checkbox" className="ui-checkbox"
              checked={exp.current}
              onChange={(e) => {
                const next = [...experience]
                next[index] = { ...exp, current: e.target.checked }
                onChange(next)
              }}
            />
            Current role
          </label>
          <textarea
            value={exp.bullets.map((b) => b.text).join('\n')}
            onChange={(e) => {
              const next = [...experience]
              next[index] = {
                ...exp,
                bullets: e.target.value
                  .split('\n')
                  .filter(Boolean)
                  .map((text) => ({
                    id: crypto.randomUUID(),
                    text,
                    tags: [],
                  })),
              }
              onChange(next)
            }}
            rows={4}
            placeholder="One bullet per line"
            className="min-w-0 w-full ui-field"
          />
        </div>
      ))}
    </section>
  )
}

function ProjectsEditor({
  projects,
  onChange,
}: {
  projects: CvProject[]
  onChange: (projects: CvProject[]) => void
}) {
  return (
    <section className="ui-panel min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="break-words ui-section-title">Projects</h2>
        <button
          type="button"
          className="ui-button ui-primary"
          onClick={() =>
            onChange([
              ...projects,
              {
                id: crypto.randomUUID(),
                name: '',
                url: '',
                bullets: [{ id: crypto.randomUUID(), text: '', tags: [] }],
              },
            ])
          }
        >
          + Project
        </button>
      </div>
      {projects.map((project, index) => (
        <div key={project.id} className="space-y-2 rounded-lg border border-[#e6eeeb] p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="pt-1.5 ui-meta font-medium uppercase tracking-wide text-brand-muted">
              Project {index + 1}
            </p>
            <CvDeleteButton
              label="Remove project"
              onClick={() => onChange(projects.filter((p) => p.id !== project.id))}
            />
          </div>
          <input
            value={project.name}
            placeholder="Project name"
            onChange={(e) => {
              const next = [...projects]
              next[index] = { ...project, name: e.target.value }
              onChange(next)
            }}
            className="min-w-0 w-full ui-field"
          />
          <input
            value={project.url}
            placeholder="URL"
            onChange={(e) => {
              const next = [...projects]
              next[index] = { ...project, url: e.target.value }
              onChange(next)
            }}
            className="min-w-0 w-full ui-field"
          />
          <textarea
            value={project.bullets.map((b) => b.text).join('\n')}
            onChange={(e) => {
              const next = [...projects]
              next[index] = {
                ...project,
                bullets: e.target.value
                  .split('\n')
                  .filter(Boolean)
                  .map((text) => ({
                    id: crypto.randomUUID(),
                    text,
                    tags: [],
                  })),
              }
              onChange(next)
            }}
            rows={3}
            className="min-w-0 w-full ui-field"
          />
        </div>
      ))}
    </section>
  )
}

function EducationEditor({
  education,
  certifications,
  onChange,
  onSplitCerts,
}: {
  education: CvEducation[]
  certifications: CvCertification[]
  onChange: (education: CvEducation[]) => void
  onSplitCerts: () => void
}) {
  const preview = splitEducationAndCerts(education, certifications)
  const movable = education.length - preview.education.length

  return (
    <section className="ui-panel min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="break-words ui-section-title">Education</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {movable > 0 && (
            <button
              type="button"
              className="ui-button ui-secondary"
              onClick={onSplitCerts}
            >
              Move {movable} cert{movable === 1 ? '' : 's'} → Certifications
            </button>
          )}
          <button
            type="button"
            className="ui-button ui-primary"
            onClick={() =>
              onChange([
                ...education,
                { id: crypto.randomUUID(), school: '', degree: '', start: '', end: '' },
              ])
            }
          >
            + Education
          </button>
        </div>
      </div>
      {education.map((edu, index) => (
        <div key={edu.id} className="space-y-2 rounded-lg border border-[#e6eeeb] p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="pt-1.5 ui-meta font-medium uppercase tracking-wide text-brand-muted">
              Education {index + 1}
            </p>
            <CvDeleteButton
              label="Remove education"
              onClick={() => onChange(education.filter((e) => e.id !== edu.id))}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={edu.degree}
              placeholder="Degree / Diploma"
              onChange={(e) => {
                const next = [...education]
                next[index] = { ...edu, degree: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            />
            <input
              value={edu.school}
              placeholder="School"
              onChange={(e) => {
                const next = [...education]
                next[index] = { ...edu, school: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            />
            <input
              value={edu.start ?? ''}
              placeholder="Start (e.g. September 2022)"
              onChange={(e) => {
                const next = [...education]
                next[index] = { ...edu, start: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            />
            <input
              value={edu.end ?? ''}
              placeholder="End (e.g. July 2024)"
              onChange={(e) => {
                const next = [...education]
                next[index] = { ...edu, end: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            />
          </div>
        </div>
      ))}
    </section>
  )
}

function CertificationsEditor({
  certifications,
  onChange,
}: {
  certifications: CvCertification[]
  onChange: (certifications: CvCertification[]) => void
}) {
  return (
    <section className="ui-panel min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="break-words ui-section-title">Certifications</h2>
        </div>
        <button
          type="button"
          className="ui-button ui-primary"
          onClick={() =>
            onChange([
              ...certifications,
              { id: crypto.randomUUID(), name: '', issuer: '', year: '' },
            ])
          }
        >
          + Certification
        </button>
      </div>
      {certifications.map((cert, index) => (
        <div key={cert.id} className="space-y-2 rounded-lg border border-[#e6eeeb] p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="pt-1.5 ui-meta font-medium uppercase tracking-wide text-brand-muted">
              Certification {index + 1}
            </p>
            <CvDeleteButton
              label="Remove certification"
              onClick={() => onChange(certifications.filter((c) => c.id !== cert.id))}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={cert.name}
              placeholder="Name (e.g. Power Platform Fundamentals)"
              onChange={(e) => {
                const next = [...certifications]
                next[index] = { ...cert, name: e.target.value }
                onChange(next)
              }}
              className="min-w-0 sm:col-span-1 ui-field"
            />
            <input
              value={cert.issuer}
              placeholder="Issuer / code (e.g. Microsoft · PL-900)"
              onChange={(e) => {
                const next = [...certifications]
                next[index] = { ...cert, issuer: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            />
            <input
              value={cert.year}
              placeholder="Year / date"
              onChange={(e) => {
                const next = [...certifications]
                next[index] = { ...cert, year: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            />
          </div>
        </div>
      ))}
    </section>
  )
}
