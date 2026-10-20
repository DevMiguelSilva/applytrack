import { DeleteDialog } from '../components/DeleteDialog'
import { useAuth } from '../hooks/useAuth'
import { TrashIcon } from '../components/TrashIcon'
import { SectionHeader } from '../components/SectionHeader'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
  cleanMasterCvEntries,
} from '../types/cv'

const card = "ui-panel min-w-0 space-y-4"
const button = "ui-button ui-secondary legacy-size-text_sm"
const field = "ui-field legacy-size-text_sm"

function splitContactLinks(links: string[]) {
  const linkedin = links.find((link) => /linkedin\.com/i.test(link)) ?? ''
  const remaining = links.filter((link) => link !== linkedin)
  const portfolio = remaining[0] ?? ''
  return { linkedin, portfolio, other: remaining.slice(1) }
}

function joinContactLinks(links: ReturnType<typeof splitContactLinks>) {
  return [links.linkedin, links.portfolio, ...links.other].map((link) => link.trim()).filter(Boolean)
}

function MonthField({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const monthValue = /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : ''
  return <label className="cv-entry-field"><span>{label}</span><input
    type="month"
    value={monthValue}
    aria-label={label}
    disabled={disabled}
    onChange={(event) => onChange(event.target.value)}
    className="min-w-0 w-full ui-field"
  />{value && !monthValue && <small className="cv-legacy-date">Saved value: {value}. Choose a month to replace it.</small>}</label>
}

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
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const sectionSnapshot = useRef<MasterCv | null>(null)
  const editorForm = useRef<HTMLFormElement>(null)
  const resumeFileInput = useRef<HTMLInputElement>(null)
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
  const auth = useAuth()
  const account = auth.isCloudEnabled ? auth.user?.id ?? 'signed-out' : 'local'
  const liveDelete = useRef({account, revision:library.updatedAt})
  liveDelete.current = {account, revision:library.updatedAt}
  const deleteCapture = useRef<{account:string; revision:string; name:string; trigger:HTMLElement|null} | null>(null)
  const deleteBusy = useRef(false)
  const deleteVersion = useRef(0)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string|null>(null)
  const invalidateDeletion=useCallback(()=>{deleteVersion.current++},[])
  useEffect(() => { deleteVersion.current++; deleteBusy.current=false; setDeleting(null); setDeletePending(false); return invalidateDeletion }, [account,invalidateDeletion])
  const closeDeletion = () => {
    if (deleteBusy.current) return
    setDeleting(null); setDeleteError(null)
    requestAnimationFrame(() => deleteCapture.current?.trigger?.isConnected && deleteCapture.current.trigger.focus())
  }
  const confirmDeletion = async () => {
    const captured = deleteCapture.current
    if (!deleting || !captured || deleteBusy.current) return
    const version=++deleteVersion.current
    const sameOwner=()=>liveDelete.current.account===captured.account && deleteVersion.current===version
    deleteBusy.current=true; setDeletePending(true); setDeleteError(null)
    try {
      await deleteTemplate(deleting,()=>sameOwner() && liveDelete.current.revision===captured.revision)
      if (!sameOwner()) return
      setDeleting(null); setDraft(null); setPendingAttachment(undefined)
      requestAnimationFrame(()=>document.querySelector<HTMLSelectElement>('[aria-label="Selected CV"]')?.focus())
    } catch { if(sameOwner())setDeleteError('Could not delete this CV template. Your draft is preserved. Please try again.') }
    finally {if(sameOwner()){deleteBusy.current=false;setDeletePending(false)}}
  }
  const [pendingAttachment, setPendingAttachment] = useState<ResumeAttachment | undefined>()

  useEffect(() => {
    setEditingTrack(activeTrack)
    setDraft(null)
    setEditingSection(null)
    sectionSnapshot.current = null
    setPendingAttachment(undefined)
    setRename(null)
    setImportNote(null)
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
  const saveDraft = async () => { if (draft) await saveTemplate(editingTrack, cleanMasterCvEntries(draft), pendingAttachment) }
  const switchTrack = (track: CvTrack) => run(async () => {
    await setActiveTrack(track, draft ? {track:editingTrack, cv:cleanMasterCvEntries(draft), attachment:pendingAttachment} : undefined)
    setDraft(null)
    setPendingAttachment(undefined)
  })

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cv) return
    await run(async () => {
      await saveTemplate(editingTrack, cleanMasterCvEntries(cv), pendingAttachment)
      setDraft(null)
      setPendingAttachment(undefined)
      setEditingSection(null)
      sectionSnapshot.current = null
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
      await saveTemplate(target, cleanMasterCvEntries(next), importedAttachment)
      setDraft(null)
      setPendingAttachment(undefined)
    } catch (err) {
      setImportError(getErrorMessage(err, 'Import failed. Your draft is still here.'))
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return <p className="ui-helper text-brand-muted legacy-size-text_sm">Loading master CV…</p>
  }

  if (loadError || !cv) return <div className={card}><p role="alert" className="ui-helper">{loadError ?? 'CV template unavailable.'}</p><button className="ui-button ui-primary" onClick={() => void reload()}>Retry loading CVs</button></div>
  const locked = busy || importing || deletePending
  const refs = deleting ? templateReferences(library, deleting, jobs, searches) : { jobs: [], searches: [] }
  const contactLinks = splitContactLinks(cv.contact.links)
  const updateContactLinks = (patch: Partial<ReturnType<typeof splitContactLinks>>) => setCv({
    ...cv,
    contact: { ...cv.contact, links: joinContactLinks({ ...splitContactLinks(cv.contact.links), ...patch }) },
  })
  const beginSectionEdit = (section: string) => {
    sectionSnapshot.current = structuredClone(cv)
    setDraft(structuredClone(cv))
    setEditingSection(section)
  }
  const cancelSectionEdit = (section: string) => {
    const before = sectionSnapshot.current
    if (before) {
      const current = draft ?? cv
      const restored = { ...current }
      if (section === 'profile') Object.assign(restored, { contact: before.contact, headline: before.headline, summary: before.summary })
      if (section === 'experience') restored.experience = before.experience
      if (section === 'skills') restored.skills = before.skills
      if (section === 'education') { restored.education = before.education; restored.certifications = before.certifications }
      if (section === 'projects') restored.projects = before.projects
      if (section === 'certifications') restored.certifications = before.certifications
      setDraft(restored)
    }
    sectionSnapshot.current = null
    setEditingSection(null)
  }
  const sectionActions = (section: string) => editingSection === section
    ? <><button type="button" className={button} onClick={() => cancelSectionEdit(section)}>Cancel</button><button type="button" className="ui-button ui-primary" onClick={() => editorForm.current?.requestSubmit()}>Save section</button></>
    : <button type="button" className={button} disabled={Boolean(editingSection)} onClick={() => beginSectionEdit(section)}>Edit</button>

  return (
    <div className="ui-page ui-cv-page mx-auto min-w-0 w-full" aria-busy={locked}>
      <SectionHeader title="CV library" description="Create and manage master CVs for the roles you apply to." actions={<button type="button" className="ui-button ui-primary" disabled={locked} onClick={() => setShowAdd(!showAdd)}>+ New CV</button>} />
      {importError && <div className="space-y-2 rounded-lg bg-red-50 p-3 legacy-size-text_sm"><p role="alert" className="ui-helper !text-red-700 legacy-size-text_sm">{importError}</p><button type="button" disabled={locked} className={button} onClick={() => void run(reload)}>Reload library</button></div>}
      {showAdd && <form className={card} onSubmit={(e) => { e.preventDefault(); void run(async () => { await saveDraft(); await addTemplate(newName, copyFrom || undefined); setNewName(''); setShowAdd(false) }) }}>
        <h2 className="break-words ui-section-title legacy-size-text_lg">New CV template</h2>
        <label className="ui-label block legacy-size-text_sm">Template name<input required disabled={locked} className={`${field} mt-1`} value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
        <label className="ui-label block legacy-size-text_sm">Start from<select className={`${field} mt-1 form-select`} disabled={locked} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}><option value="">Blank CV</option>{Object.keys(library.cvs).map((id) => <option key={id} value={id}>{getLabel(id)}</option>)}</select></label>
        <div className="flex min-w-0 gap-2"><button className="ui-button ui-primary" disabled={locked || !newName.trim()}>Create CV</button><button type="button" className={button} disabled={locked} onClick={() => setShowAdd(false)}>Cancel</button></div>
      </form>}
      <section className="cv-template-toolbar">
        <label className="ui-label block legacy-size-text_sm cv-template-select">
          <span>Editing CV</span>
          <select aria-label="Selected CV" disabled={locked} className={`${field} mt-1 form-select`} value={editingTrack} onChange={(e) => void switchTrack(e.target.value)}>{Object.keys(library.cvs).map((id) => <option key={id} value={id}>{getLabel(id)}</option>)}</select>
        </label>
        <div className="cv-template-meta"><span className="cv-default-mark" aria-hidden="true">✓</span><span>Default for new applications</span></div>
        <div className="cv-template-actions">
          <button type="button" className={button} disabled={locked} onClick={() => setRename(getLabel(editingTrack))}>Rename</button>
          <CvDeleteButton label={`Delete ${getLabel(editingTrack)} template`} disabled={locked || Object.keys(library.cvs).length <= 1} onClick={() => { deleteCapture.current={account, revision:library.updatedAt, name:getLabel(editingTrack), trigger:document.activeElement as HTMLElement}; setDeleteError(null); setDeleting(editingTrack) }} />
        </div>
        {rename !== null && <form className="cv-rename-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await renameTemplate(editingTrack, rename); setRename(null) }) }}><label className="ui-label block legacy-size-text_sm">Template name<input className={`${field} mt-1`} required disabled={locked} value={rename} onChange={(e) => setRename(e.target.value)} /></label><div className="flex min-w-0 gap-2"><button className="ui-button ui-primary" disabled={locked || !rename.trim()}>Save name</button><button type="button" className={button} disabled={locked} onClick={() => setRename(null)}>Cancel</button></div></form>}
      </section>
      <DeleteDialog open={Boolean(deleting)} title={`Delete ${deleteCapture.current?.name ?? ''}?`} pending={deletePending} error={deleteError} confirmLabel="Delete template" pendingLabel="Deleting…" onCancel={closeDeletion} onConfirm={() => void confirmDeletion()}>
        <p>This deletes the master CV and its attached source resume. Generated resumes, cover letters and submitted application documents stay saved. Linked Saved jobs will need a CV selection before generating again; linked searches will be paused.</p>
        <p className="mt-3">{refs.jobs.length} linked Saved jobs; {refs.searches.length} linked searches.</p>
        {deleting === library.activeTrack && <p className="mt-3">Default for future new items: {getLabel(Object.keys(library.cvs).filter(id=>id!==deleting).sort()[0])}. Existing linked jobs and searches will not be reassigned.</p>}
      </DeleteDialog>
      <fieldset disabled={locked} className="cv-editor-form min-w-0">
      <section className="cv-import-panel">
        <div className="cv-import-copy"><button type="button" className="cv-import-icon" aria-label="Choose a resume file" disabled={locked} onClick={() => resumeFileInput.current?.click()}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button><div><h2 className="ui-section-title">Start with your resume</h2><p className="ui-body text-brand-muted">Import a DOCX or text file to prefill this CV.</p></div></div>
        <input
          ref={resumeFileInput}
          type="file"
          accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={locked}
          onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
          className="cv-file-input-hidden"
          tabIndex={-1}
          aria-hidden="true"
        />
        {attachment && (
          <p className="break-words ui-meta text-brand-muted legacy-size-text_xs">
            Stored: <span className="font-medium">{attachment.fileName}</span> ·{' '}
            {new Date(attachment.uploadedAt).toLocaleString()} ·{' '}
            {attachment.extractedText.length.toLocaleString()} chars extracted
          </p>
        )}
        {importing && <p className="ui-helper !text-[#23745e] legacy-size-text_sm">Importing…</p>}
        {importError && (
          <p className="rounded-lg bg-red-50 p-3 ui-helper !text-red-700 legacy-size-text_sm">
            {importError}
          </p>
        )}
        {importNote && (
          <p className="rounded-lg bg-emerald-50 p-3 ui-helper !text-emerald-800 legacy-size-text_sm">
            {importNote}
          </p>
        )}
      </section>

      <form ref={editorForm} onSubmit={handleSave} className="cv-editor-sections">
        <section className="ui-panel cv-editor-section cv-profile-section min-w-0">
          <CvSectionHeading step="01" title="Profile" description="Your contact information and professional introduction." action={sectionActions('profile')} />
          <div className="cv-profile-grid">
            <div className="cv-profile-group cv-contact">
              <h3 className="cv-subsection-title">Contact details</h3>
              {editingSection !== 'profile' && <dl className="cv-read-grid">{([['Full name',cv.contact.name],['Email',cv.contact.email],['Phone',cv.contact.phone],['Location',cv.contact.location],['LinkedIn',contactLinks.linkedin],['Portfolio',contactLinks.portfolio]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>}
              {editingSection === 'profile' && <>
              <div className="cv-contact-pairs">
              {(
                [
                  ['name', 'Full name'],
                  ['email', 'Email'],
                  ['phone', 'Phone'],
                  ['location', 'Location'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="ui-label block legacy-size-text_sm">
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
              <label className="ui-label block legacy-size-text_sm"><span className="font-medium">LinkedIn</span><input type="text" inputMode="url" value={contactLinks.linkedin} onChange={(e) => updateContactLinks({ linkedin: e.target.value })} placeholder="https://linkedin.com/in/your-name" className="mt-1 min-w-0 w-full ui-field" /></label>
              <label className="ui-label block legacy-size-text_sm"><span className="font-medium">Portfolio</span><input type="text" inputMode="url" value={contactLinks.portfolio} onChange={(e) => updateContactLinks({ portfolio: e.target.value })} placeholder="https://yourportfolio.com" className="mt-1 min-w-0 w-full ui-field" /></label>
              </div>
              </>}
            </div>

            <div className="cv-profile-group cv-profile-summary">
              <h3 className="cv-subsection-title">Professional profile</h3>
              {editingSection !== 'profile' && <div className="cv-read-profile"><p><span>Headline</span>{cv.headline || '—'}</p><p><span>Summary</span>{cv.summary || '—'}</p></div>}
              {editingSection === 'profile' && <>
              <label className="ui-label block legacy-size-text_sm">
              <span className="font-medium">Headline</span>
              <input
                value={cv.headline}
                onChange={(e) => setCv({ ...cv, headline: e.target.value })}
                className="mt-1 min-w-0 w-full ui-field"
              />
              </label>
              <label className="ui-label block legacy-size-text_sm">
              <span className="font-medium">Summary</span>
              <textarea
                value={cv.summary}
                onChange={(e) => setCv({ ...cv, summary: e.target.value })}
                rows={5}
                className="mt-1 min-w-0 w-full ui-field"
              />
              </label>
              </>}
            </div>
          </div>
        </section>

        <ExperienceEditor
          experience={cv.experience}
          onChange={(experience) => setCv({ ...cv, experience })}
          editing={editingSection === 'experience'} action={sectionActions('experience')}
        />
        <SkillGroupsEditor skills={cv.skills} onChange={(skills) => setCv({ ...cv, skills })} editing={editingSection === 'skills'} action={sectionActions('skills')} />
        <EducationEditor
          education={cv.education}
          certifications={cv.certifications ?? []}
          editing={editingSection === 'education'} action={sectionActions('education')}
          onChange={(education) => setCv({ ...cv, education })}
          onSplitCerts={() => {
            const split = splitEducationAndCerts(cv.education, cv.certifications ?? [])
            setCv({ ...cv, education: split.education, certifications: split.certifications })
          }}
        />
        <ProjectsEditor projects={cv.projects} onChange={(projects) => setCv({ ...cv, projects })} editing={editingSection === 'projects'} action={sectionActions('projects')} />
        <CertificationsEditor
          certifications={cv.certifications ?? []}
          editing={editingSection === 'certifications'} action={sectionActions('certifications')}
          onChange={(certifications) => setCv({ ...cv, certifications })}
        />

      </form>
      </fieldset>
    </div>
  )
}

function CvSectionHeading({
  step,
  title,
  description,
  action,
}: {
  step: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="cv-section-heading">
      <div className="cv-section-heading-copy">
        <span className="cv-section-step" aria-hidden="true">{step}</span>
        <div className="min-w-0">
          <h2 className="break-words ui-section-title cv-section-title">{title}</h2>
          <p className="ui-body text-brand-muted cv-section-description">{description}</p>
        </div>
      </div>
      {action && <div className="cv-section-action">{action}</div>}
    </div>
  )
}

function SkillGroupsEditor({
  skills,
  onChange,
  editing,
  action,
}: {
  skills: CvSkillGroup[]
  onChange: (skills: CvSkillGroup[]) => void
  editing: boolean
  action: ReactNode
}) {
  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="03" title="Skills" description="Organize the skills you want to highlight." action={<>{editing && <button
          type="button"
          className="ui-button ui-secondary cv-add-button"
          onClick={() =>
            onChange([...skills, { id: crypto.randomUUID(), group: 'Group', items: [] }])
          }
        >
          + Add group
        </button>}{action}</>} />
      {!editing && <CvReadItems empty="No skill groups added yet." items={skills.map((group) => ({ title: group.group, detail: group.items.join(' · ') }))} />}
      {editing && <>
      {skills.length === 0 && <p className="cv-empty-state">Add skill groups such as Technical skills, Tools, or Languages.</p>}
      {skills.map((group, index) => (
        <div key={group.id} className="cv-entry cv-skill-entry cv-entry-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="cv-entry-label">
              Group {String(index + 1).padStart(2, '0')}
            </p>
            <CvDeleteButton
              label={`Remove ${group.group || 'skill'} group`}
              onClick={() => onChange(skills.filter((g) => g.id !== group.id))}
            />
          </div>
          <div className="cv-skill-fields">
            <label className="cv-entry-field"><span>Category</span><input
              value={group.group}
              aria-label={`Skill group ${index + 1} name`}
              placeholder="Skill category"
              onChange={(e) => {
                const next = [...skills]
                next[index] = { ...group, group: e.target.value }
                onChange(next)
              }}
              className="min-w-0 w-full ui-field"
            /></label>
            <label className="cv-entry-field"><span>Skills</span><input
              value={group.items.join(', ')}
              aria-label={`Skills for group ${index + 1}`}
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
            /></label>
          </div>
        </div>
      ))}
      </>}
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
  editing,
  action,
}: {
  experience: CvExperience[]
  onChange: (experience: CvExperience[]) => void
  editing: boolean
  action: ReactNode
}) {
  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="02" title="Experience" description="Add roles and the results you delivered." action={<>{editing && <button
          type="button"
          className="ui-button ui-secondary cv-add-button"
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
          + Add role
        </button>}{action}</>} />
      {!editing && <CvReadItems empty="No experience added yet." items={experience.map((exp) => ({ title: [exp.title, exp.company].filter(Boolean).join(' · '), detail: [[exp.location, [exp.start, exp.current ? 'Present' : exp.end].filter(Boolean).join(' – ')].filter(Boolean).join(' · '), exp.current ? 'Current role' : ''].filter(Boolean).join(' · '), bullets: exp.bullets.map((bullet) => bullet.text).filter((text) => text.trim()) }))} />}
      {editing && <>
      {experience.length === 0 && <p className="cv-empty-state">Your experience will appear here. Add your most relevant role first.</p>}
      {experience.map((exp, index) => (
        <div key={exp.id} className="cv-entry cv-experience-entry cv-entry-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="cv-entry-label">
              Role {String(index + 1).padStart(2, '0')}
            </p>
            <CvDeleteButton
              label="Remove role"
              onClick={() => onChange(experience.filter((e) => e.id !== exp.id))}
            />
          </div>
          <div className="cv-experience-fields">
            <label className="cv-entry-field"><span>Job title</span><input
              value={exp.title}
              placeholder="Title"
              onChange={(e) => {
                const next = [...experience]
                next[index] = { ...exp, title: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            /></label>
            <label className="cv-entry-field"><span>Company</span><input
              value={exp.company}
              placeholder="Company"
              onChange={(e) => {
                const next = [...experience]
                next[index] = { ...exp, company: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            /></label>
            <label className="cv-entry-field cv-experience-location"><span>Location</span><input
              value={exp.location}
              placeholder="Location"
              onChange={(e) => {
                const next = [...experience]
                next[index] = { ...exp, location: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            /></label>
            <div className="cv-experience-dates cv-full-row">
              <MonthField label="Start month" value={exp.start} onChange={(value) => {
                  const next = [...experience]
                  next[index] = { ...exp, start: value }
                  onChange(next)
                }} />
              <MonthField label="End month" value={exp.end} disabled={exp.current} onChange={(value) => {
                  const next = [...experience]
                  next[index] = { ...exp, end: value }
                  onChange(next)
                }} />
              <label className="ui-label ui-check-label legacy-size-text_sm">
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
            </div>
          </div>
          <label className="cv-entry-field cv-full-row"><span>Highlights <em>(one per line)</em></span><textarea
            value={exp.bullets.map((b) => b.text).join('\n')}
            onChange={(e) => {
              const next = [...experience]
              next[index] = {
                ...exp,
                bullets: e.target.value
                  .split('\n')
                  .map((text, bulletIndex) => ({
                    id: exp.bullets[bulletIndex]?.id ?? crypto.randomUUID(),
                    text,
                    tags: exp.bullets[bulletIndex]?.tags ?? [],
                  })),
              }
              onChange(next)
            }}
            rows={4}
            placeholder="One bullet per line"
            className="min-w-0 w-full ui-field"
          /></label>
        </div>
      ))}
      </>}
    </section>
  )
}

function ProjectsEditor({
  projects,
  onChange,
  editing,
  action,
}: {
  projects: CvProject[]
  onChange: (projects: CvProject[]) => void
  editing: boolean
  action: ReactNode
}) {
  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="05" title="Projects" description="Showcase selected work, links, and outcomes." action={<>{editing && <button
          type="button"
          className="ui-button ui-secondary cv-add-button"
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
          + Add project
        </button>}{action}</>} />
      {!editing && <CvReadItems empty="No projects added yet." items={projects.map((project) => ({ title: project.name, detail: project.url, bullets: project.bullets.map((bullet) => bullet.text).filter((text) => text.trim()) }))} />}
      {editing && <>
      {projects.length === 0 && <p className="cv-empty-state">No projects yet. Add one when it helps demonstrate your work.</p>}
      {projects.map((project, index) => (
        <div key={project.id} className="cv-entry cv-project-entry cv-entry-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="cv-entry-label">
              Project {String(index + 1).padStart(2, '0')}
            </p>
            <CvDeleteButton
              label="Remove project"
              onClick={() => onChange(projects.filter((p) => p.id !== project.id))}
            />
          </div>
          <div className="cv-project-fields">
            <label className="cv-entry-field"><span>Project name</span><input
              value={project.name}
              placeholder="Project name"
              onChange={(e) => {
                const next = [...projects]
                next[index] = { ...project, name: e.target.value }
                onChange(next)
              }}
              className="min-w-0 w-full ui-field"
            /></label>
            <label className="cv-entry-field"><span>Project link</span><input
              value={project.url}
              placeholder="URL"
              onChange={(e) => {
                const next = [...projects]
                next[index] = { ...project, url: e.target.value }
                onChange(next)
              }}
              className="min-w-0 w-full ui-field"
            /></label>
          </div>
          <label className="cv-entry-field cv-full-row"><span>Highlights <em>(one per line)</em></span><textarea
            value={project.bullets.map((b) => b.text).join('\n')}
            onChange={(e) => {
              const next = [...projects]
              next[index] = {
                ...project,
                bullets: e.target.value
                  .split('\n')
                  .map((text, bulletIndex) => ({
                    id: project.bullets[bulletIndex]?.id ?? crypto.randomUUID(),
                    text,
                    tags: project.bullets[bulletIndex]?.tags ?? [],
                  })),
              }
              onChange(next)
            }}
            rows={3}
            className="min-w-0 w-full ui-field"
          /></label>
        </div>
      ))}
      </>}
    </section>
  )
}

function EducationEditor({
  education,
  certifications,
  onChange,
  onSplitCerts,
  editing,
  action,
}: {
  education: CvEducation[]
  certifications: CvCertification[]
  onChange: (education: CvEducation[]) => void
  onSplitCerts: () => void
  editing: boolean
  action: ReactNode
}) {
  const preview = splitEducationAndCerts(education, certifications)
  const movable = education.length - preview.education.length

  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="04" title="Education" description="Include degrees and other formal study." action={<>{editing && <div className="flex flex-wrap items-center gap-2">
          {movable > 0 && (
            <button
              type="button"
              className="ui-button ui-secondary legacy-size-text_sm"
              onClick={onSplitCerts}
            >
              Move {movable} cert{movable === 1 ? '' : 's'} → Certifications
            </button>
          )}
          <button
            type="button"
            className="ui-button ui-secondary cv-add-button"
            onClick={() =>
              onChange([
                ...education,
                { id: crypto.randomUUID(), school: '', degree: '', start: '', end: '' },
              ])
            }
          >
            + Add education
          </button>
        </div>}{action}</>} />
      {!editing && <CvReadItems empty="No education added yet." items={education.map((edu) => ({ title: [edu.degree, edu.school].filter(Boolean).join(' · '), detail: [edu.start, edu.end].filter(Boolean).join(' – ') }))} />}
      {editing && <>
      {education.length === 0 && <p className="cv-empty-state">No education added yet. Include the most relevant qualification first.</p>}
      {education.map((edu, index) => (
        <div key={edu.id} className="cv-entry cv-education-entry cv-entry-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="cv-entry-label">
              Education {String(index + 1).padStart(2, '0')}
            </p>
            <CvDeleteButton
              label="Remove education"
              onClick={() => onChange(education.filter((e) => e.id !== edu.id))}
            />
          </div>
          <div className="cv-education-fields">
            <label className="cv-entry-field"><span>Degree or diploma</span><input
              value={edu.degree}
              placeholder="Degree / Diploma"
              onChange={(e) => {
                const next = [...education]
                next[index] = { ...edu, degree: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            /></label>
            <label className="cv-entry-field"><span>School</span><input
              value={edu.school}
              placeholder="School"
              onChange={(e) => {
                const next = [...education]
                next[index] = { ...edu, school: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            /></label>
            <MonthField label="Start month" value={edu.start ?? ''} onChange={(value) => {
                const next = [...education]
                next[index] = { ...edu, start: value }
                onChange(next)
              }} />
            <MonthField label="End month" value={edu.end ?? ''} onChange={(value) => {
                const next = [...education]
                next[index] = { ...edu, end: value }
                onChange(next)
              }} />
          </div>
        </div>
      ))}
      </>}
    </section>
  )
}

function CertificationsEditor({
  certifications,
  onChange,
  editing,
  action,
}: {
  certifications: CvCertification[]
  onChange: (certifications: CvCertification[]) => void
  editing: boolean
  action: ReactNode
}) {
  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="06" title="Certifications" description="Track licenses and professional credentials." action={<>{editing && <button
          type="button"
          className="ui-button ui-secondary cv-add-button"
          onClick={() =>
            onChange([
              ...certifications,
              { id: crypto.randomUUID(), name: '', issuer: '', year: '' },
            ])
          }
        >
          + Add certification
        </button>}{action}</>} />
      {!editing && <CvReadItems empty="No certifications added yet." items={certifications.map((cert) => ({ title: cert.name, detail: [cert.issuer, cert.year].filter(Boolean).join(' · ') }))} />}
      {editing && <>
      {certifications.length === 0 && <p className="cv-empty-state">No certifications yet. Add credentials that are relevant to your applications.</p>}
      {certifications.map((cert, index) => (
        <div key={cert.id} className="cv-entry cv-certification-entry cv-entry-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="cv-entry-label">
              Certification {String(index + 1).padStart(2, '0')}
            </p>
            <CvDeleteButton
              label="Remove certification"
              onClick={() => onChange(certifications.filter((c) => c.id !== cert.id))}
            />
          </div>
          <div className="cv-certification-fields">
            <label className="cv-entry-field"><span>Name</span><input
              value={cert.name}
              placeholder="Name (e.g. Power Platform Fundamentals)"
              onChange={(e) => {
                const next = [...certifications]
                next[index] = { ...cert, name: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            /></label>
            <label className="cv-entry-field"><span>Issuer or code</span><input
              value={cert.issuer}
              placeholder="Issuer / code (e.g. Microsoft · PL-900)"
              onChange={(e) => {
                const next = [...certifications]
                next[index] = { ...cert, issuer: e.target.value }
                onChange(next)
              }}
              className="min-w-0 ui-field"
            /></label>
            <MonthField label="Month earned" value={cert.year} onChange={(value) => {
                const next = [...certifications]
                next[index] = { ...cert, year: value }
                onChange(next)
              }} />
          </div>
        </div>
      ))}
      </>}
    </section>
  )
}

function CvReadItems({ items, empty }: { items: { title: string; detail: string; bullets?: string[] }[]; empty: string }) {
  if (!items.length) return <p className="cv-empty-state">{empty}</p>
  return <div className="cv-read-items">{items.map((item, index) => <article className="cv-read-item" key={`${item.title}-${index}`}>
    <h3>{item.title || 'Untitled entry'}</h3>{item.detail && <p>{item.detail}</p>}{item.bullets && item.bullets.length > 0 && <ul className="cv-read-bullets">{item.bullets.map((bullet, bulletIndex) => <li key={`${bulletIndex}-${bullet}`}>{bullet}</li>)}</ul>}
  </article>)}</div>
}
