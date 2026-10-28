import { DeleteDialog } from '../components/DeleteDialog'
import { useAuth } from '../hooks/useAuth'
import { TrashIcon } from '../components/TrashIcon'
import { SectionHeader } from '../components/SectionHeader'
import { useLocation } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState, type ReactNode, type SetStateAction } from 'react'
import { useJobs } from '../hooks/useJobs'
import { useSavedSearches } from '../hooks/useSavedSearches'
import { templateReferences } from '../lib/cvLibrary'
import { performCvEditorSave } from '../lib/cvEditorSave'
import { moveCvItem } from '../lib/cvItemOrder'
import { cvItemRevisionMatches, cvItemSignature, cvItems, isUntouchedEmptyCvItem, removeCvItemById, type CvItem, type CvItemKind, type CvItemProvenance, type CvItemRemoval } from '../lib/cvItemDeletion'
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
  formatCvDate,
  formatEducationDisplayDates,
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

function cvItemRemovalCopy(kind: CvItemKind, item: CvItem) {
  switch (kind) {
    case 'skillGroup': {
      const entry = item as CvSkillGroup
      const label = entry.group.trim() && entry.group.trim() !== 'Group' ? entry.group.trim() : 'Untitled skill group'
      return { type: 'skill group', label, hasChildren: entry.items.some((skill) => skill.trim()) }
    }
    case 'experience': {
      const entry = item as CvExperience
      const label = [entry.title.trim(), entry.company.trim() ? `at ${entry.company.trim()}` : ''].filter(Boolean).join(' ') || 'Untitled experience role'
      return { type: 'experience role', label, hasChildren: entry.bullets.some((bullet) => bullet.text.trim() || bullet.tags.some((tag) => tag.trim())) }
    }
    case 'project': {
      const entry = item as CvProject
      return { type: 'project', label: entry.name.trim() || 'Untitled project', hasChildren: entry.bullets.some((bullet) => bullet.text.trim() || bullet.tags.some((tag) => tag.trim())) }
    }
    case 'education': {
      const entry = item as CvEducation
      const label = [entry.degree.trim(), entry.school.trim() ? `at ${entry.school.trim()}` : ''].filter(Boolean).join(' ') || 'Untitled education entry'
      return { type: 'education entry', label, hasChildren: false }
    }
    case 'certification': {
      const entry = item as CvCertification
      const label = [entry.name.trim(), entry.issuer.trim() ? `(${entry.issuer.trim()})` : ''].filter(Boolean).join(' ') || 'Untitled certification'
      return { type: 'certification', label, hasChildren: false }
    }
  }
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
  const location = useLocation()
  const {
    library,
    activeTrack,
    loading,
    setDefaultTrack,
    getCv,
    saveTemplate, getLabel, addTemplate, renameTemplate, deleteTemplate, loadError, reload,
  } = useMasterCv()
  const [editingTrack, setEditingTrack] = useState<CvTrack>(activeTrack)
  const [draft, setDraftState] = useState<MasterCv | null>(null)
  const draftRef = useRef<MasterCv | null>(null)
  const setDraft = (value: SetStateAction<MasterCv | null>) => {
    const next = typeof value === 'function' ? value(draftRef.current) : value
    draftRef.current = next
    setDraftState(() => next)
  }
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const sectionSnapshot = useRef<MasterCv | null>(null)
  const editorForm = useRef<HTMLFormElement>(null)
  const resumeFileInput = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const importGeneration = useRef(0)
  const [importError, setImportError] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)
  const [reviewingImport, setReviewingImport] = useState(false)
  const draftOwner = useRef<{ account: string; revision: string } | null>(null)
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
  const preserveEditingTrackOnDefaultChange = useRef(false)
  const itemProvenance = useRef(new Map<string, CvItemProvenance>())
  const itemRevisions = useRef(new Map<string, number>())
  const itemSession = useRef(0)
  const [itemRemoval, setItemRemoval] = useState<CvItemRemoval | null>(null)
  const [itemDeleteNotice, setItemDeleteNotice] = useState<string | null>(null)
  const itemDeleteBusy = useRef(false)
  const processedItemRemoval = useRef<CvItemRemoval | null>(null)
  const resetItemEditorSession = useCallback(() => {
    itemSession.current++
    itemProvenance.current.clear()
    itemRevisions.current.clear()
    itemDeleteBusy.current = false
    processedItemRemoval.current = null
    setItemRemoval(null)
    setItemDeleteNotice(null)
  }, [])
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
    const deletedTrack = deleting
    const nextEditingTrack = deletedTrack === activeTrack
      ? Object.keys(library.cvs).filter((id) => id !== deletedTrack).sort()[0] ?? activeTrack
      : activeTrack
    const version=++deleteVersion.current
    const sameOwner=()=>liveDelete.current.account===captured.account && deleteVersion.current===version
    deleteBusy.current=true; setDeletePending(true); setDeleteError(null)
    try {
      await deleteTemplate(deletedTrack,()=>sameOwner() && liveDelete.current.revision===captured.revision)
      if (!sameOwner()) return
      setEditingTrack(nextEditingTrack)
      setDeleting(null); setDraft(null); setPendingAttachment(undefined)
      setEditingSection(null); sectionSnapshot.current = null
      requestAnimationFrame(()=>document.querySelector<HTMLSelectElement>('[aria-label="Selected CV"]')?.focus())
    } catch { if(sameOwner())setDeleteError('Could not delete this CV template. Your draft is preserved. Please try again.') }
    finally {if(sameOwner()){deleteBusy.current=false;setDeletePending(false)}}
  }
  const [pendingAttachment, setPendingAttachment] = useState<ResumeAttachment | undefined>()

  useEffect(() => {
    if (preserveEditingTrackOnDefaultChange.current) {
      preserveEditingTrackOnDefaultChange.current = false
      return
    }
    setEditingTrack(activeTrack)
    setDraft(null)
    resetItemEditorSession()
    setEditingSection(null)
    sectionSnapshot.current = null
    setPendingAttachment(undefined)
    setRename(null)
    setImportNote(null)
  }, [activeTrack, resetItemEditorSession])

  useEffect(() => {
    resetItemEditorSession()
    importGeneration.current++
    setImporting(false)
    draftOwner.current = null
    draftRef.current = null
    setDraftState(null)
    setPendingAttachment(undefined)
    setReviewingImport(false)
    setEditingSection(null)
    setImportNote(null)
  }, [account, resetItemEditorSession])

  useEffect(() => {
    resetItemEditorSession()
  }, [location.pathname, library.updatedAt, resetItemEditorSession])

  const cv = draft ?? getCv(editingTrack)
  const attachment = library.attachments[editingTrack]
  const setCv = (next: MasterCv) => setDraft(next)

  const itemKey = (kind: CvItemKind, id: string) => `${kind}:${id}`
  const registerNewItem = (kind: CvItemKind, item: CvItem) => {
    const key = itemKey(kind, item.id)
    itemProvenance.current.set(key, {
      account, track: editingTrack, session: itemSession.current,
      initial: cvItemSignature(item), touched: false, revision: 0,
    })
    itemRevisions.current.set(key, 0)
  }
  const updateItems = <T extends CvItem>(kind: CvItemKind, nextItems: T[]) => {
    const current = draftRef.current ?? getCv(editingTrack)!
    const previousItems = cvItems(current, kind)
    for (const previous of previousItems) {
      const key = itemKey(kind, previous.id)
      const next = nextItems.find((item) => item.id === previous.id)
      if (next && cvItemSignature(previous) !== cvItemSignature(next)) {
        const revision = (itemRevisions.current.get(key) ?? 0) + 1
        itemRevisions.current.set(key, revision)
        const provenance = itemProvenance.current.get(key)
        if (provenance) { provenance.touched = true; provenance.revision = revision }
      }
    }
    setDraft({ ...current, [kind === 'skillGroup' ? 'skills' : kind === 'experience' ? 'experience' : kind === 'project' ? 'projects' : kind === 'education' ? 'education' : 'certifications']: nextItems } as MasterCv)
  }
  const requestItemRemoval = (kind: CvItemKind, type: string, item: CvItem, label: string, hasChildren: boolean, trigger: HTMLElement | null) => {
    if (locked || deleting) return
    const current = draftRef.current ?? cv!
    const key = itemKey(kind, item.id)
    const provenance = itemProvenance.current.get(key)
    const scope = { account, track: editingTrack, session: itemSession.current }
    if (isUntouchedEmptyCvItem(item, provenance, scope)) {
      const order = cvItems(current, kind).map((entry) => entry.id)
      setDraft(removeCvItemById(current, kind, item.id))
      itemProvenance.current.delete(key)
      itemRevisions.current.delete(key)
      setItemDeleteNotice(null)
      focusAfterItemRemoval(kind, item.id, order)
      return
    }
    setItemDeleteNotice(null)
    processedItemRemoval.current = null
    setItemRemoval({
      account, track: editingTrack, libraryRevision: library.updatedAt, routePath: location.pathname,
      section: editingSection ?? '', session: itemSession.current,
      kind, type, id: item.id, revision: itemRevisions.current.get(key) ?? 0,
      orderSignature: cvItems(current, kind).map((entry) => entry.id).join('\u0000'),
      label, hasChildren, trigger,
    })
  }
  const focusAfterItemRemoval = (kind: CvItemKind, removedId: string, oldOrder: string[]) => {
    const oldIndex = oldOrder.indexOf(removedId)
    const targetId = oldOrder[oldIndex + 1] ?? oldOrder[oldIndex - 1]
    requestAnimationFrame(() => {
      if (targetId) document.querySelector<HTMLElement>(`[data-cv-item-remove="${kind}:${CSS.escape(targetId)}"]`)?.focus()
      else document.querySelector<HTMLElement>(`[data-cv-section-add="${kind}"]`)?.focus()
    })
  }
  const closeItemRemoval = () => {
    if (itemDeleteBusy.current) return
    const trigger = itemRemoval?.trigger
    setItemRemoval(null)
    setItemDeleteNotice(null)
    requestAnimationFrame(() => trigger?.isConnected && trigger.focus())
  }
  const confirmItemRemoval = () => {
    const captured = itemRemoval
    if (!captured || locked || itemDeleteBusy.current || processedItemRemoval.current === captured) return
    const scopeMatches = captured.account === account && captured.track === editingTrack
      && captured.section === editingSection && captured.session === itemSession.current
      && captured.libraryRevision === library.updatedAt && captured.routePath === location.pathname
    const current = draftRef.current ?? getCv(captured.track)!
    const key = itemKey(captured.kind, captured.id)
    if (!scopeMatches || !cvItemRevisionMatches(current, captured, itemRevisions.current.get(key) ?? 0)) {
      setItemRemoval(null)
      setItemDeleteNotice('This entry changed while confirmation was open. Reopen Remove to confirm its current contents.')
      requestAnimationFrame(() => captured.trigger?.isConnected && captured.trigger.focus())
      return
    }
    processedItemRemoval.current = captured
    itemDeleteBusy.current = true
    const order = cvItems(current, captured.kind).map((entry) => entry.id)
    // Apply against the latest section draft inside the state update; this removes only
    // the captured stable ID and keeps unrelated edits made since the modal opened.
    const removeFromLatest = (latest: MasterCv | null) => removeCvItemById(latest ?? current, captured.kind, captured.id)
    draftRef.current = removeFromLatest(draftRef.current)
    setDraftState((latest) => removeFromLatest(latest))
    itemProvenance.current.delete(key)
    itemRevisions.current.delete(key)
    itemDeleteBusy.current = false
    setItemRemoval(null)
    setItemDeleteNotice(null)
    focusAfterItemRemoval(captured.kind, captured.id, order)
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setImportError(null)
    try { await action() }
    catch (error) { setImportError(getErrorMessage(error, 'Could not save. Your draft is still here.')) }
    finally { setBusy(false) }
  }
  const assertDraftCurrent = () => {
    if (draftOwner.current && (draftOwner.current.account !== account || draftOwner.current.revision !== library.updatedAt))
      throw new Error('The CV library or account changed while editing. Your draft is preserved; reload before saving.')
  }
  const saveDraft = async () => { if (draft) { assertDraftCurrent(); await saveTemplate(editingTrack, cleanMasterCvEntries(draft), pendingAttachment, draftOwner.current?.revision); draftOwner.current = null } }
  const switchTrack = (track: CvTrack) => run(async () => {
    await saveDraft()
    setEditingTrack(track)
    setDraft(null)
    setPendingAttachment(undefined)
    setEditingSection(null)
    sectionSnapshot.current = null
    setRename(null)
    resetItemEditorSession()
  })
  const makeDefault = () => run(async () => {
    preserveEditingTrackOnDefaultChange.current = true
    try {
      await saveDraft()
      await setDefaultTrack(editingTrack)
    } catch (error) {
      preserveEditingTrackOnDefaultChange.current = false
      throw error
    }
    setDraft(null)
    setPendingAttachment(undefined)
    setEditingSection(null)
    sectionSnapshot.current = null
    resetItemEditorSession()
  })

  const persistEditor = async () => {
    if (!cv) return
    await run(async () => {
      assertDraftCurrent()
      await saveTemplate(editingTrack, cleanMasterCvEntries(cv), pendingAttachment, draftOwner.current?.revision)
      setDraft(null)
      setPendingAttachment(undefined)
      setEditingSection(null)
      sectionSnapshot.current = null
      resetItemEditorSession()
      setReviewingImport(false)
      draftOwner.current = null
    })
  }
  const keepSection = () => {
    setEditingSection(null)
    sectionSnapshot.current = null
    resetItemEditorSession()
  }
  const saveEditorAction = (action: 'section' | 'form' | 'import') =>
    performCvEditorSave(action, reviewingImport, { keepSection, persist: persistEditor })
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    void saveEditorAction('form')
  }

  const handleUpload = async (file: File | null) => {
    if (!file || !cv || busy || importing) return
    resetItemEditorSession()
    const target = editingTrack
    const base = cv
    const owner = { account, revision: library.updatedAt }
    const importVersion = ++importGeneration.current
    const isCurrent = () => importGeneration.current === importVersion && liveDelete.current.account === owner.account && liveDelete.current.revision === owner.revision
    setShowAdd(false)
    setRename(null)
    setImporting(true)
    setImportError(null)
    setImportNote(null)
    try {
      const text = await extractTextFromResumeFile(file)
      if (!isCurrent()) throw new Error('The account or library changed during import. Import again after reloading.')
      if (!text.trim()) throw new Error('No text could be extracted from that file.')

      const importedAttachment = {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
        extractedText: text,
      }
      let next = sparseCvFromText(text, base)
      try {
        const parsed = await parseResumeText(text, target, getLabel(target))
        if (!isCurrent()) return
        next = mergeParsedCv(base, parsed)
        setImportNote('Resume imported into the form. Review fields and save when ready.')
      } catch {
        if (!isCurrent()) return
        setImportNote(
          'Text extracted into Summary. AI structuring failed — review the form before saving.'
        )
      }

      if (!isCurrent()) throw new Error('The account or library changed during import. Import again after reloading.')
      draftOwner.current = owner
      setDraft(next)
      setPendingAttachment(importedAttachment)
      setReviewingImport(true)
      resetItemEditorSession()
    } catch (err) {
      if (isCurrent()) setImportError(getErrorMessage(err, 'Import failed. Your draft is still here.'))
    } finally {
      if (importGeneration.current === importVersion) setImporting(false)
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
    resetItemEditorSession()
    sectionSnapshot.current = structuredClone(cv)
    if (!draftOwner.current) draftOwner.current = { account, revision: library.updatedAt }
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
    resetItemEditorSession()
  }
  const sectionActions = (section: string) => editingSection === section
    ? <><button type="button" className={button} onClick={() => cancelSectionEdit(section)}>Cancel</button><button type="button" className="ui-button ui-primary" onClick={() => { if (reviewingImport) void saveEditorAction('section'); else editorForm.current?.requestSubmit() }}>{reviewingImport ? 'Keep section changes' : 'Save section'}</button></>
    : <button type="button" className={button} disabled={Boolean(editingSection)} onClick={() => beginSectionEdit(section)}>Edit</button>

  return (
    <div className="ui-page ui-cv-page mx-auto min-w-0 w-full" aria-busy={locked}>
      <SectionHeader title="CV library" description="Create and manage master CVs for the roles you apply to." actions={<button type="button" className="ui-button ui-primary" disabled={locked || reviewingImport} onClick={() => setShowAdd(!showAdd)}>+ New CV</button>} />
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
          <select aria-label="Selected CV" disabled={locked || reviewingImport} className={`${field} mt-1 form-select`} value={editingTrack} onChange={(e) => void switchTrack(e.target.value)}>{Object.keys(library.cvs).map((id) => <option key={id} value={id}>{getLabel(id)}</option>)}</select>
        </label>
        <div className="cv-template-meta">
          {editingTrack === activeTrack && <><span className="cv-default-mark" aria-hidden="true">✓</span><span>Default for new jobs and searches</span></>}
        </div>
        <div className="cv-template-actions">
          {editingTrack !== activeTrack && <button type="button" className={button} disabled={locked || reviewingImport} onClick={() => void makeDefault()}>Make default</button>}
          <button type="button" className={button} disabled={locked || reviewingImport} onClick={() => setRename(getLabel(editingTrack))}>Rename</button>
          <CvDeleteButton label={`Delete ${getLabel(editingTrack)} template`} disabled={locked || reviewingImport || Object.keys(library.cvs).length <= 1} onClick={() => { deleteCapture.current={account, revision:library.updatedAt, name:getLabel(editingTrack), trigger:document.activeElement as HTMLElement}; setDeleteError(null); setDeleting(editingTrack) }} />
        </div>
        {rename !== null && <form className="cv-rename-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await renameTemplate(editingTrack, rename); setRename(null) }) }}><label className="ui-label block legacy-size-text_sm">Template name<input className={`${field} mt-1`} required disabled={locked} value={rename} onChange={(e) => setRename(e.target.value)} /></label><div className="flex min-w-0 gap-2"><button className="ui-button ui-primary" disabled={locked || !rename.trim()}>Save name</button><button type="button" className={button} disabled={locked} onClick={() => setRename(null)}>Cancel</button></div></form>}
      </section>
      <DeleteDialog open={Boolean(deleting)} title={`Delete ${deleteCapture.current?.name ?? ''}?`} pending={deletePending} error={deleteError} confirmLabel="Delete template" pendingLabel="Deleting…" onCancel={closeDeletion} onConfirm={() => void confirmDeletion()}>
        <p>This deletes the master CV and its attached source resume. Generated resumes, cover letters and submitted application documents stay saved. Linked Saved jobs will need a CV selection before generating again; linked searches will be paused.</p>
        <p className="mt-3">{refs.jobs.length} linked Saved jobs; {refs.searches.length} linked searches.</p>
        {deleting === library.activeTrack && <p className="mt-3">Default for future new items: {getLabel(Object.keys(library.cvs).filter(id=>id!==deleting).sort()[0])}. Existing linked jobs and searches will not be reassigned.</p>}
      </DeleteDialog>
      <DeleteDialog
        open={Boolean(itemRemoval)}
        title={`Remove ${itemRemoval?.type ?? 'entry'}?`}
        pending={false}
        confirmLabel="Remove"
        pendingLabel="Remove"
        onCancel={closeItemRemoval}
        onConfirm={confirmItemRemoval}
      >
        {itemRemoval && <p>Remove ‘{itemRemoval.label}’ from this CV draft?{itemRemoval.hasChildren && <> This also removes its {itemRemoval.kind === 'skillGroup' ? 'skills' : 'highlights'}.</>} {['education', 'project', 'certification'].includes(itemRemoval.kind) ? 'Saving this removal updates every profile.' : itemRemoval.kind === 'experience' ? 'Other profiles keep this role.' : ''} Save CV to keep this change.</p>}
      </DeleteDialog>
      {itemDeleteNotice && <p role="status" className="ui-helper legacy-size-text_sm">{itemDeleteNotice}</p>}
      {library.sharedDetails && <details className="ui-panel"><summary>Recover details from before sharing</summary><p className="ui-helper">The original library includes each profile’s previous contact, education, projects, certifications, and roles. Download it to compare or copy details into your current profiles.</p><button type="button" className={button} onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(library.sharedDetails!.original, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'applytrack-cv-library-before-sharing.json'; link.click(); URL.revokeObjectURL(url) }}>Download original library</button></details>}
      <fieldset disabled={locked} className="cv-editor-form min-w-0">
      <section className="cv-import-panel">
        <div className="cv-import-copy"><button type="button" className="cv-import-icon" aria-label="Choose a resume file" disabled={locked || reviewingImport || Boolean(editingSection)} onClick={() => resumeFileInput.current?.click()}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button><div><h2 className="ui-section-title">Start with your resume</h2><p className="ui-body text-brand-muted">Import a DOCX or text file to prefill this CV.</p></div></div>
        <input
          ref={resumeFileInput}
          type="file"
          accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={locked || reviewingImport || Boolean(editingSection)}
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
        {reviewingImport && <div className="space-y-2"><p className="ui-helper">Review the imported fields below. Section changes stay in the draft until you save the imported CV. Saving updates contact, education, projects and certifications in every profile, adds new roles to every profile, and updates shared role details.</p><button type="button" className="ui-button ui-primary" onClick={() => void saveEditorAction('import')}>Save imported CV</button> <button type="button" className={button} onClick={() => { setDraft(null); setPendingAttachment(undefined); setReviewingImport(false); setImportNote(null); setEditingSection(null); draftOwner.current = null }}>Discard import</button></div>}
      </section>

      <form ref={editorForm} onSubmit={handleSave} className="cv-editor-sections">
        <section className="ui-panel cv-editor-section cv-profile-section min-w-0">
          <CvSectionHeading step="01" title="Profile" description="Contact details are shared across all profiles. Headline and summary belong to this profile." action={sectionActions('profile')} />
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
          onChange={(experience) => updateItems('experience', experience)}
          onAdd={(item) => registerNewItem('experience', item)}
          onRemove={(item, trigger) => { const copy = cvItemRemovalCopy('experience', item); requestItemRemoval('experience', copy.type, item, copy.label, copy.hasChildren, trigger) }}
          editing={editingSection === 'experience'} action={sectionActions('experience')}
        />
        <SkillGroupsEditor skills={cv.skills} onChange={(skills) => updateItems('skillGroup', skills)} onAdd={(item) => registerNewItem('skillGroup', item)} onRemove={(item, trigger) => { const copy = cvItemRemovalCopy('skillGroup', item); requestItemRemoval('skillGroup', copy.type, item, copy.label, copy.hasChildren, trigger) }} editing={editingSection === 'skills'} action={sectionActions('skills')} />
        <EducationEditor
          education={cv.education}
          certifications={cv.certifications ?? []}
          editing={editingSection === 'education'} action={sectionActions('education')}
          onChange={(education) => updateItems('education', education)}
          onAdd={(item) => registerNewItem('education', item)}
          onRemove={(item, trigger) => { const copy = cvItemRemovalCopy('education', item); requestItemRemoval('education', copy.type, item, copy.label, copy.hasChildren, trigger) }}
          onSplitCerts={() => {
            const split = splitEducationAndCerts(cv.education, cv.certifications ?? [])
            updateItems('education', split.education)
            updateItems('certification', split.certifications)
          }}
        />
        <ProjectsEditor projects={cv.projects} onChange={(projects) => updateItems('project', projects)} onAdd={(item) => registerNewItem('project', item)} onRemove={(item, trigger) => { const copy = cvItemRemovalCopy('project', item); requestItemRemoval('project', copy.type, item, copy.label, copy.hasChildren, trigger) }} editing={editingSection === 'projects'} action={sectionActions('projects')} />
        <CertificationsEditor
          certifications={cv.certifications ?? []}
          editing={editingSection === 'certifications'} action={sectionActions('certifications')}
          onChange={(certifications) => updateItems('certification', certifications)}
          onAdd={(item) => registerNewItem('certification', item)}
          onRemove={(item, trigger) => { const copy = cvItemRemovalCopy('certification', item); requestItemRemoval('certification', copy.type, item, copy.label, copy.hasChildren, trigger) }}
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
  onAdd,
  onRemove,
  editing,
  action,
}: {
  skills: CvSkillGroup[]
  onChange: (skills: CvSkillGroup[]) => void
  onAdd: (item: CvSkillGroup) => void
  onRemove: (item: CvSkillGroup, trigger: HTMLElement | null) => void
  editing: boolean
  action: ReactNode
}) {
  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="03" title="Skills" description="Organize the skills you want to highlight." action={<>{editing && <button
          type="button"
          className="ui-button ui-secondary cv-add-button"
          data-cv-section-add="skillGroup"
          onClick={() =>
            { const item = { id: crypto.randomUUID(), group: 'Group', items: [] }; onAdd(item); onChange([...skills, item]) }
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
            <div className="cv-entry-actions"><CvOrderButtons label={`skill group ${group.group || index + 1}`} index={index} count={skills.length} onMove={direction => onChange(moveCvItem(skills, group.id, direction))} /><CvDeleteButton
              label={`Remove ${group.group || 'skill'} group`}
              itemKey={`skillGroup:${group.id}`}
              onClick={(trigger) => onRemove(group, trigger)}
            /></div>
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

function CvDeleteButton({ onClick, label, disabled, confirm = false, itemKey }: { onClick: (trigger: HTMLButtonElement) => void; label: string; disabled?: boolean; confirm?: boolean; itemKey?: string }) {
  return (
    <button
      type="button"
      onClick={(event) => onClick(event.currentTarget)}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-cv-item-remove={itemKey}
      className={confirm ? "ui-button ui-danger" : "ui-button ui-danger-quiet ui-icon-button ui-compact"}
    >
      <TrashIcon />{confirm && <span>{label}</span>}
    </button>
  )
}

function CvOrderButtons({ label, index, count, onMove }: { label: string; index: number; count: number; onMove: (direction: -1 | 1) => void }) {
  const up = useRef<HTMLButtonElement>(null)
  const down = useRef<HTMLButtonElement>(null)
  const move = (direction: -1 | 1) => {
    onMove(direction)
    if ((direction === -1 && index === 1) || (direction === 1 && index === count - 2))
      requestAnimationFrame(() => (direction === -1 ? down : up).current?.focus())
  }
  return <div className="cv-order-buttons" aria-label={`Reorder ${label}`}>
    <button ref={up} type="button" className="ui-button ui-secondary ui-icon-button ui-compact" aria-label={`Move ${label} up`} title={`Move ${label} up`} disabled={index === 0} onClick={() => move(-1)}>↑</button>
    <button ref={down} type="button" className="ui-button ui-secondary ui-icon-button ui-compact" aria-label={`Move ${label} down`} title={`Move ${label} down`} disabled={index === count - 1} onClick={() => move(1)}>↓</button>
  </div>
}

function ExperienceEditor({
  experience,
  onChange,
  onAdd,
  onRemove,
  editing,
  action,
}: {
  experience: CvExperience[]
  onChange: (experience: CvExperience[]) => void
  onAdd: (item: CvExperience) => void
  onRemove: (item: CvExperience, trigger: HTMLElement | null) => void
  editing: boolean
  action: ReactNode
}) {
  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="02" title="Experience" description="New roles are added to every profile. Role details are shared; highlights and removal belong to this profile." action={<>{editing && <button
          type="button"
          className="ui-button ui-secondary cv-add-button"
          data-cv-section-add="experience"
          onClick={() => {
            const item: CvExperience = {
                id: crypto.randomUUID(),
                company: '',
                title: '',
                location: '',
                start: '',
                end: '',
                current: false,
                bullets: [{ id: crypto.randomUUID(), text: '', tags: [] }],
              }
            onAdd(item)
            onChange([...experience, item])
          }}
        >
          + Add role
        </button>}{action}</>} />
      {!editing && <CvReadItems empty="No experience added yet." items={experience.map((exp) => ({ title: [exp.title, exp.company].filter(Boolean).join(' · '), detail: [[exp.location, [formatCvDate(exp.start), formatCvDate(exp.current ? 'Present' : exp.end)].filter(Boolean).join(' – ')].filter(Boolean).join(' · '), exp.current ? 'Current role' : ''].filter(Boolean).join(' · '), bullets: exp.bullets.map((bullet) => bullet.text).filter((text) => text.trim()) }))} />}
      {editing && <>
      {experience.length === 0 && <p className="cv-empty-state">Your experience will appear here. Add your most relevant role first.</p>}
      {experience.map((exp, index) => (
        <div key={exp.id} className="cv-entry cv-experience-entry cv-entry-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="cv-entry-label">
              Role {String(index + 1).padStart(2, '0')}
            </p>
            <div className="cv-entry-actions"><CvOrderButtons label={`role ${[exp.title, exp.company].filter(Boolean).join(' at ') || index + 1}`} index={index} count={experience.length} onMove={direction => onChange(moveCvItem(experience, exp.id, direction))} /><CvDeleteButton
              label="Remove role"
              itemKey={`experience:${exp.id}`}
              onClick={(trigger) => onRemove(exp, trigger)}
            /></div>
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
  onAdd,
  onRemove,
  editing,
  action,
}: {
  projects: CvProject[]
  onChange: (projects: CvProject[]) => void
  onAdd: (item: CvProject) => void
  onRemove: (item: CvProject, trigger: HTMLElement | null) => void
  editing: boolean
  action: ReactNode
}) {
  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="05" title="Projects" description="Shared across all profiles; saving changes updates each profile." action={<>{editing && <button
          type="button"
          className="ui-button ui-secondary cv-add-button"
          data-cv-section-add="project"
          onClick={() => {
            const item: CvProject = {
                id: crypto.randomUUID(),
                name: '',
                url: '',
                bullets: [{ id: crypto.randomUUID(), text: '', tags: [] }],
              }
            onAdd(item)
            onChange([...projects, item])
          }}
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
            <div className="cv-entry-actions"><CvOrderButtons label={`project ${project.name || index + 1}`} index={index} count={projects.length} onMove={direction => onChange(moveCvItem(projects, project.id, direction))} /><CvDeleteButton
              label="Remove project"
              itemKey={`project:${project.id}`}
              onClick={(trigger) => onRemove(project, trigger)}
            /></div>
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
  onAdd,
  onRemove,
  onSplitCerts,
  editing,
  action,
}: {
  education: CvEducation[]
  certifications: CvCertification[]
  onChange: (education: CvEducation[]) => void
  onAdd: (item: CvEducation) => void
  onRemove: (item: CvEducation, trigger: HTMLElement | null) => void
  onSplitCerts: () => void
  editing: boolean
  action: ReactNode
}) {
  const preview = splitEducationAndCerts(education, certifications)
  const movable = education.length - preview.education.length

  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="04" title="Education" description="Shared across all profiles; saving changes updates each profile." action={<>{editing && <div className="flex flex-wrap items-center gap-2">
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
            data-cv-section-add="education"
            onClick={() => { const item: CvEducation = { id: crypto.randomUUID(), school: '', degree: '', start: '', end: '' }; onAdd(item); onChange([...education, item]) }}
          >
            + Add education
          </button>
        </div>}{action}</>} />
      {!editing && <CvReadItems empty="No education added yet." items={education.map((edu) => ({ title: [edu.degree, edu.school].filter(Boolean).join(' · '), detail: formatEducationDisplayDates(edu, ' – ') }))} />}
      {editing && <>
      {education.length === 0 && <p className="cv-empty-state">No education added yet. Include the most relevant qualification first.</p>}
      {education.map((edu, index) => (
        <div key={edu.id} className="cv-entry cv-education-entry cv-entry-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="cv-entry-label">
              Education {String(index + 1).padStart(2, '0')}
            </p>
            <div className="cv-entry-actions"><CvOrderButtons label={`education ${edu.degree || edu.school || index + 1}`} index={index} count={education.length} onMove={direction => onChange(moveCvItem(education, edu.id, direction))} /><CvDeleteButton
              label="Remove education"
              itemKey={`education:${edu.id}`}
              onClick={(trigger) => onRemove(edu, trigger)}
            /></div>
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
  onAdd,
  onRemove,
  editing,
  action,
}: {
  certifications: CvCertification[]
  onChange: (certifications: CvCertification[]) => void
  onAdd: (item: CvCertification) => void
  onRemove: (item: CvCertification, trigger: HTMLElement | null) => void
  editing: boolean
  action: ReactNode
}) {
  return (
    <section className="ui-panel cv-editor-section min-w-0">
      <CvSectionHeading step="06" title="Certifications" description="Shared across all profiles; saving changes updates each profile." action={<>{editing && <button
          type="button"
          className="ui-button ui-secondary cv-add-button"
          data-cv-section-add="certification"
          onClick={() => { const item: CvCertification = { id: crypto.randomUUID(), name: '', issuer: '', year: '' }; onAdd(item); onChange([...certifications, item]) }}
        >
          + Add certification
        </button>}{action}</>} />
      {!editing && <CvReadItems empty="No certifications added yet." items={certifications.map((cert) => ({ title: cert.name, detail: [cert.issuer, formatCvDate(cert.year)].filter(Boolean).join(' · ') }))} />}
      {editing && <>
      {certifications.length === 0 && <p className="cv-empty-state">No certifications yet. Add credentials that are relevant to your applications.</p>}
      {certifications.map((cert, index) => (
        <div key={cert.id} className="cv-entry cv-certification-entry cv-entry-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="cv-entry-label">
              Certification {String(index + 1).padStart(2, '0')}
            </p>
            <div className="cv-entry-actions"><CvOrderButtons label={`certification ${cert.name || index + 1}`} index={index} count={certifications.length} onMove={direction => onChange(moveCvItem(certifications, cert.id, direction))} /><CvDeleteButton
              label="Remove certification"
              itemKey={`certification:${cert.id}`}
              onClick={(trigger) => onRemove(cert, trigger)}
            /></div>
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
