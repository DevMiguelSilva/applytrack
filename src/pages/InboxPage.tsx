import { SectionHeader } from '../components/SectionHeader'
import { InboxRefreshSummary } from '../components/InboxRefreshSummary'
import { TrashIcon } from '../components/TrashIcon'
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { boardLook } from '../components/BoardLook'
import { attachCardDragGhost } from '../components/JobCard'
import { IconAction } from '../components/IconAction'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useInbox } from '../hooks/useInbox'
import { useAuth } from '../hooks/useAuth'
import { useSavedSearches } from '../hooks/useSavedSearches'
import { useMasterCv } from '../hooks/useMasterCv'
import { expandSearchLocations } from '../lib/searchLocations'
import { type CvTrack } from '../types/cv'
import { createEmptySavedSearch, type SavedSearch } from '../types/job'



const rowBtn =
  "ui-button ui-secondary ui-compact"
const rowRun =
  "ui-button ui-primary ui-compact"
const rowDanger =
  "ui-button ui-danger-quiet ui-compact ui-mobile-delete"
const fieldLabel = "ui-label"
const fieldControl =
  "ui-field mt-1"

const emptyDraft = {
  label: '',
  query: '',
  location: '',
  maxDaysOld: 7,
  excludeTerms: '',
  track: 'auto' as CvTrack,
}

try {
  sessionStorage.removeItem('inbox-search-look')
} catch {
  /* ignore */
}

export function InboxPage() {
  const { user, isCloudEnabled } = useAuth()
  const account = isCloudEnabled ? user?.id ?? 'signed-out' : 'local'
  const {
    inbox,
    loading,
    refreshing,
    refreshError,
    refreshReport,
    retryFailedSearches,
    retryInboxSave,
    newCount,
    refreshInbox,
    clearReviewList,
    approveJob,
    dismissJob,
  } = useInbox()
  const {
    searches,
    addSearch,
    updateSearch,
    deleteSearch,
    activateOnly,
    activateAll,
    reorderSearches,
  } = useSavedSearches()
  const [showSearches, setShowSearches] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [runningAloneId, setRunningAloneId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [showAddSearch, setShowAddSearch] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState(emptyDraft)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [deletingSearch, setDeletingSearch] = useState<SavedSearch | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  const searchToggle = useRef<HTMLButtonElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const deletePending = useRef(false)
  const deleteAttempt = useRef(0)

  // A confirmation belongs to the current account/page, including delayed results.
  useEffect(() => {
    setDeletingSearch(null)
    setDeleting(false)
    setDeleteError(null)
    return () => {
      deleteAttempt.current += 1
      deletePending.current = false
    }
  }, [account])

  useEffect(() => {
    if (deletingSearch) {
      deleteDialog.current?.showModal()
      cancelDeleteButton.current?.focus()
    } else {
      deleteDialog.current?.close()
    }
  }, [deletingSearch])

  const requestDeleteSearch = (search: SavedSearch, trigger: HTMLButtonElement) => {
    deleteTrigger.current = trigger
    setDeleteError(null)
    setDeletingSearch(search)
  }

  const cancelDeleteSearch = () => {
    if (deletePending.current) return
    deleteDialog.current?.close()
    setDeletingSearch(null)
    setDeleteError(null)
    if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus()
    else searchToggle.current?.focus()
  }

  const confirmDeleteSearch = async () => {
    if (!deletingSearch || deletePending.current) return
    const searchId = deletingSearch.id
    const attempt = ++deleteAttempt.current
    deletePending.current = true
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteSearch(searchId)
      if (attempt !== deleteAttempt.current) return
      setEditingId(current => current === searchId ? null : current)
      deleteDialog.current?.close()
      setDeletingSearch(null)
      searchToggle.current?.focus()
    } catch (err) {
      if (attempt === deleteAttempt.current) {
        setDeleteError(err instanceof Error ? err.message : 'Failed to delete saved search')
      }
    } finally {
      if (attempt === deleteAttempt.current) {
        deletePending.current = false
        setDeleting(false)
      }
    }
  }

  const newJobs = useMemo(
    () => inbox.filter((j) => j.status === 'new').sort((a, b) => b.matchScore - a.matchScore),
    [inbox]
  )

  const searchLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of searches) {
      map.set(s.id, s.label.trim() || s.query.trim() || 'Saved search')
    }
    return map
  }, [searches])

  const firstSeenCount = useMemo(
    () => newJobs.filter((j) => (j.seenCount ?? 1) <= 1).length,
    [newJobs]
  )
  const seenBeforeCount = useMemo(
    () => newJobs.filter((j) => (j.seenCount ?? 1) > 1).length,
    [newJobs]
  )

  const activeSearches = useMemo(() => searches.filter((s) => s.active), [searches])

  const handleRefresh = async () => {
    setError(null)
    try {
      let list = searches
      // Only auto-activate everything when every search is paused.
      if (list.length > 0 && !list.some((s) => s.active)) {
        list = await activateAll()
      }
      await refreshInbox({ searchesOverride: list })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    }
  }

  const handleSearchDragStart = (index: number, event: DragEvent<HTMLElement>) => {
    setDragIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    const card = event.currentTarget.closest('li')
    if (card instanceof HTMLElement) attachCardDragGhost(event, card)
  }

  const handleSearchDragOver = (index: number, event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropIndex !== index) setDropIndex(index)
  }

  const handleSearchDrop = async (index: number) => {
    if (dragIndex == null || dragIndex === index) {
      setDragIndex(null)
      setDropIndex(null)
      return
    }
    try {
      await reorderSearches(dragIndex, index)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder searches')
    } finally {
      setDragIndex(null)
      setDropIndex(null)
    }
  }

  const handleSearchDragEnd = () => {
    setDragIndex(null)
    setDropIndex(null)
  }

  const handleClearReview = async () => {
    setError(null)
    try {
      await clearReviewList()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear review list')
    }
  }

  /** Pause other searches; replace review rows only after this query succeeds. */
  const handleRunAlone = async (searchId: string) => {
    setError(null)
    setRunningAloneId(searchId)
    try {
      await activateOnly(searchId)
      await refreshInbox({ onlySearchId: searchId, clearReviewFirst: true })
      setShowSearches(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run search')
    } finally {
      setRunningAloneId(null)
    }
  }

  const handleApprove = async (id: string) => {
    setActionId(id)
    setError(null)
    try {
      await approveJob(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setActionId(null)
    }
  }

  const handleDismiss = async (id: string) => {
    setActionId(id)
    try {
      await dismissJob(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dismiss failed')
    } finally {
      setActionId(null)
    }
  }

  const handleAddSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.query.trim()) return
    const search = createEmptySavedSearch({
      label: draft.label.trim() || draft.query.trim(),
      query: draft.query.trim(),
      location: draft.location.trim(),
      maxDaysOld: draft.maxDaysOld,
      excludeTerms: draft.excludeTerms.trim(),
      track: draft.track,
      active: true,
    })
    await addSearch(search)
    setDraft(emptyDraft)
    setShowAddSearch(false)
  }

  const startEdit = (search: SavedSearch) => {
    setEditingId(search.id)
    setEditDraft({
      label: search.label,
      query: search.query,
      location: search.location,
      maxDaysOld: search.maxDaysOld,
      excludeTerms: search.excludeTerms ?? '',
      track: search.track,
    })
  }

  const saveEdit = async (id: string) => {
    if (!editDraft.query.trim()) return
    await updateSearch(id, {
      label: editDraft.label.trim() || editDraft.query.trim(),
      query: editDraft.query.trim(),
      location: editDraft.location.trim(),
      maxDaysOld: editDraft.maxDaysOld,
      excludeTerms: editDraft.excludeTerms.trim(),
      track: editDraft.track,
    })
    setEditingId(null)
  }




  return (
    <div className="ui-page">
      <SectionHeader title="Inbox" description="Review job matches from your saved searches, then approve or dismiss them." actions={<div className="m-actions flex flex-wrap gap-2">
          <button ref={searchToggle} type="button" onClick={() => setShowSearches((v) => !v)} className="ui-button ui-secondary">
            {showSearches ? 'Hide searches' : `Saved searches (${searches.length})`}
          </button>
          <button
            type="button"
            onClick={handleClearReview}
            disabled={refreshing || newCount === 0}
            className="ui-button ui-secondary"
          >
            Clear review list
          </button>
          <button
            type="button"
            data-role="primary"
            onClick={handleRefresh}
            disabled={refreshing || Boolean(runningAloneId)}
            aria-busy={refreshing}
            className="ui-button ui-primary ui-mobile-full-row"
          >
            {refreshing && !runningAloneId ? 'Refreshing…' : 'Refresh active'}
          </button>
        </div>} />

      <div className={`${boardLook.card} px-5 py-4`}>
        <p className="ui-body text-brand-ink">
          <span className="font-semibold tabular-nums">{newCount}</span>
          <span className="text-brand-muted"> ready to review</span>
          {newCount > 0 && (
            <span className="text-brand-muted">
              {' '}
              · {firstSeenCount} new
              {seenBeforeCount > 0 && <> · {seenBeforeCount} seen before</>}
            </span>
          )}
        </p>
        <p className="mt-1 ui-meta text-brand-muted">
          {activeSearches.length === 0
            ? searches.length === 0
              ? 'No saved searches yet.'
              : 'All searches paused.'
            : activeSearches.length === 1
              ? `Active search: ${activeSearches[0].label.trim() || activeSearches[0].query}`
              : `${activeSearches.length} searches active.`}
        </p>
      </div>

      {(error || refreshError) && (
        <p className="ui-body text-red-700" role="alert">
          {error || refreshError}
        </p>
      )}

      {refreshReport && <InboxRefreshSummary report={refreshReport} busy={refreshing} retryFailed={retryFailedSearches} retrySave={retryInboxSave} />}

      {showSearches && (
        <section className={`ui-panel space-y-4`}>
          <h2 className=" ui-section-title">Saved searches</h2>
          <ul className="space-y-3">
            {searches.map((search, index) => (
              <li
                key={search.id}
                onDragOver={(e) => handleSearchDragOver(index, e)}
                onDrop={() => handleSearchDrop(index)}
                className={`rounded-[1.25rem] border border-[#e6eeeb] bg-white p-4 text-sm ${
                  dragIndex === index ? 'opacity-40' : ''
                } ${
                  dropIndex === index && dragIndex != null && dragIndex !== index
                    ? 'ring-2 ring-brand-primary/40'
                    : ''
                }`}
              >
                <SavedSearchBody
                  search={search}
                  index={index}
                  editing={editingId === search.id}
                  running={runningAloneId === search.id}
                  busy={refreshing || Boolean(runningAloneId)}
                  editDraft={editDraft}
                  setEditDraft={setEditDraft}
                  onDragStart={handleSearchDragStart}
                  onDragEnd={handleSearchDragEnd}
                  onRun={() => void handleRunAlone(search.id)}
                  onEdit={() => startEdit(search)}
                  onToggleActive={() => void updateSearch(search.id, { active: !search.active })}
                  onDelete={event => requestDeleteSearch(search, event.currentTarget)}
                  onSave={() => void saveEdit(search.id)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ))}
          </ul>

          <div className="border-t border-[#e6eeeb] pt-4">
            {!showAddSearch ? (
              <button type="button" onClick={() => setShowAddSearch(true)} className="ui-button ui-primary">
                Add search
              </button>
            ) : (
              <form onSubmit={handleAddSearch} className="space-y-3">
                <p className="ui-section-title">New saved search</p>
                <SearchFields draft={draft} setDraft={setDraft} />
                <div className="m-actions flex flex-wrap gap-2">
                  <button type="submit" data-role="primary" className="ui-button ui-primary">
                    Save search
                  </button>
                  <button
                    type="button"
                    data-role="quiet"
                    onClick={() => {
                      setShowAddSearch(false)
                      setDraft(emptyDraft)
                    }}
                    className="ui-button ui-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      )}

      {loading ? (
        <LoadingSpinner label="Loading inbox…" />
      ) : newJobs.length === 0 ? (
        <div className={boardLook.empty}>
          <h3 className={boardLook.emptyTitle}>Inbox is empty</h3>
          <p className={`mt-2 ${boardLook.body}`}>Refresh a saved search to review new roles.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {newJobs.map((job) => {
            const skills = job.matchReasons
              .filter((reason) => reason.startsWith('CV covers '))
              .map((reason) => reason.slice('CV covers '.length).trim())
              .filter(Boolean)
            const searchName = job.savedSearchId ? searchLabelById.get(job.savedSearchId) : undefined
            const seenBefore = (job.seenCount ?? 1) > 1
            return (
              <li key={job.id} className={`ui-panel inbox-job`}>
                <div className="inbox-job-facts min-w-0">
                  <p className={`ui-helper ${seenBefore ? 'text-[#8a6230]' : 'text-brand-muted'}`}>
                    {seenBefore ? 'Seen before' : 'New'}
                  </p>
                  <h3 className="mt-2 ui-card-title">
                    {job.role || 'Untitled role'}
                  </h3>
                  <p className="mt-1 truncate ui-helper text-brand-muted">{job.company || 'Unknown company'}</p>
                  {job.location.trim() && (
                    <p className="truncate ui-helper text-brand-muted">{job.location}</p>
                  )}
                  {job.salary.trim() && <p className="mt-2 ui-body text-brand-ink">{job.salary}</p>}
                  {searchName && (
                    <p className="mt-2 ui-helper text-brand-muted">Found by {searchName}</p>
                  )}
                  {job.jobUrl && (
                    <a
                      href={job.jobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ui-inline mt-2"
                    >
                      Open original posting
                    </a>
                  )}
                </div>
                {skills.length > 0 && (
                  <div className="inbox-job-skills flex flex-wrap gap-2">
                    {skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-lg bg-[#f4faf8] px-2.5 py-1 ui-body text-brand-ink"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
                <div aria-busy={actionId === job.id} className="inbox-job-actions m-actions flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-role="quiet"
                    disabled={actionId === job.id}
                    onClick={() => handleDismiss(job.id)}
                    className="ui-button ui-secondary"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    data-role="primary"
                    disabled={actionId === job.id}
                    onClick={() => handleApprove(job.id)}
                    className="ui-button ui-primary"
                  >
                    Approve
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <dialog
        ref={deleteDialog}
        aria-labelledby="delete-search-title"
        aria-describedby="delete-search-description"
        aria-busy={deleting}
        onCancel={event => { event.preventDefault(); cancelDeleteSearch() }}
        className="ui-panel ui-dialog w-[calc(100%-2rem)] max-w-lg backdrop:bg-brand-ink/30"
      >
        <h2 id="delete-search-title" className="ui-dialog-title">Delete saved search?</h2>
        <p id="delete-search-description" className="mt-3 ui-helper [overflow-wrap:anywhere]">
          Delete “{deletingSearch?.label.trim() || deletingSearch?.query.trim() || 'Untitled search'}” from your saved searches? This cannot be undone.
        </p>
        {deleteError && <p role="alert" className="mt-3 ui-body text-red-700 [overflow-wrap:anywhere]">{deleteError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button ref={cancelDeleteButton} type="button" disabled={deleting} onClick={cancelDeleteSearch} className="ui-button ui-secondary">Cancel</button>
          <button type="button" disabled={deleting} onClick={() => void confirmDeleteSearch()} className="ui-button ui-danger-quiet">
            {deleting ? 'Deleting…' : 'Delete search'}
          </button>
        </div>
      </dialog>
    </div>
  )
}

function SavedSearchBody({
  search,
  index,
  editing,
  running,
  busy,
  editDraft,
  setEditDraft,
  onDragStart,
  onDragEnd,
  onRun,
  onEdit,
  onToggleActive,
  onDelete,
  onSave,
  onCancel,
}: {
  search: SavedSearch
  index: number
  editing: boolean
  running: boolean
  busy: boolean
  editDraft: typeof emptyDraft
  setEditDraft: React.Dispatch<React.SetStateAction<typeof emptyDraft>>
  onDragStart: (index: number, event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onRun: () => void
  onEdit: () => void
  onToggleActive: () => void
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { getLabel } = useMasterCv()
  const name = search.label.trim() || search.query
  const meta = searchMeta(search, getLabel)

  if (editing) {
    return (
      <div className="space-y-2.5">
        <SearchFields draft={editDraft} setDraft={setEditDraft} />
        <div className="m-actions flex flex-wrap gap-2">
          <button type="button" data-role="primary" onClick={onSave} className="ui-button ui-primary">
            Save changes
          </button>
          <button type="button" data-role="quiet" onClick={onCancel} className="ui-button ui-secondary">
            Cancel
          </button>
        </div>
        <div className="search-mobile-only border-t border-[#e6eeeb] pt-3">
          <button type="button" onClick={onToggleActive} className={rowBtn}>
            {search.active ? 'Pause' : 'Activate'}
          </button>
          <button type="button" onClick={onDelete} className={rowDanger}>
            Delete
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="search-row">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          draggable
          onDragStart={(event) => onDragStart(index, event)}
          onDragEnd={onDragEnd}
          className="search-drag h-8 w-6 shrink-0 cursor-grab select-none items-center justify-center leading-none text-brand-muted active:cursor-grabbing ui-drag-control"
          title="Drag to reorder"
          aria-label={`Reorder ${name}`}
        >
          ⋮⋮
        </button>
        <div className="min-w-0 text-left">
          <p className="font-medium text-brand-ink">
            {name}
            {search.active ? (
              <span className="ml-2 ui-meta font-medium text-[#23745e]">active</span>
            ) : (
              <span className="ml-2 ui-meta text-brand-muted">paused</span>
            )}
          </p>
          <p className="mt-1 ui-meta leading-relaxed text-brand-muted">{meta}</p>
        </div>
      </div>
      <div className="search-icons">
        <IconAction label={running ? 'Running' : 'Run'} primary busy={running} disabled={busy} onClick={onRun}>
          <PlayIcon />
        </IconAction>
        <IconAction label="Edit" onClick={onEdit}>
          <PencilIcon />
        </IconAction>
        <IconAction label={search.active ? 'Pause' : 'Activate'} onClick={onToggleActive}>
          {search.active ? <PauseIcon /> : <PlayIcon />}
        </IconAction>
        <IconAction label="Delete" danger onClick={onDelete}>
          <TrashIcon />
        </IconAction>
      </div>
      <div className="search-pair">
        <button type="button" disabled={busy} onClick={onRun} className={rowRun}>
          {running ? 'Running…' : 'Run alone'}
        </button>
        <button type="button" onClick={onEdit} className={rowBtn}>
          Edit
        </button>
      </div>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 3.5v9l8-4.5-8-4.5Z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 3h2.2v10H4.5V3Zm4.8 0h2.2v10H9.3V3Z" fill="currentColor" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.2 3.3 12.7 6.8 5.5 14H2v-3.5l7.2-7.2Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}


function searchMeta(search: SavedSearch, getLabel: (id: string) => string) {
  return [
    search.label.trim() && search.label.trim() !== search.query ? search.query : '',
    expandSearchLocations(search.location)
      .map((leg) => leg.label)
      .join(' · '),
    `last ${search.maxDaysOld}d`,
    search.country.toUpperCase(),
    `CV: ${search.track === 'auto' ? 'Auto (best match)' : getLabel(search.track)}`,
    search.excludeTerms?.trim() ? `exclude: ${search.excludeTerms.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function SearchFields({
  draft,
  setDraft,
}: {
  draft: typeof emptyDraft
  setDraft: React.Dispatch<React.SetStateAction<typeof emptyDraft>>
}) {
  const { library, getLabel } = useMasterCv()
  return (
    <div className="search-fields">
      <label className="ui-label block">
        <span className={fieldLabel}>Label</span>
        <input
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          className={fieldControl}
        />
      </label>
      <label className="ui-label block">
        <span className={fieldLabel}>Locations</span>
        <input
          value={draft.location}
          onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
          className={fieldControl}
        />
      </label>
      <label className="ui-label block">
        <span className={fieldLabel}>
          Phrase <span className="text-red-700">*</span>
        </span>
        <input
          value={draft.query}
          onChange={(e) => setDraft((d) => ({ ...d, query: e.target.value }))}
          required
          className={fieldControl}
        />
      </label>
      <label className="ui-label block">
        <span className={fieldLabel}>Exclude</span>
        <input
          value={draft.excludeTerms}
          onChange={(e) => setDraft((d) => ({ ...d, excludeTerms: e.target.value }))}
          className={fieldControl}
        />
      </label>
      <label className="ui-label block">
        <span className={fieldLabel}>Max days old</span>
        <input
          type="number"
          min={1}
          max={30}
          value={draft.maxDaysOld}
          onChange={(e) => setDraft((d) => ({ ...d, maxDaysOld: Number(e.target.value) || 7 }))}
          className={fieldControl}
        />
      </label>
      <label className="ui-label block">
        <span className={fieldLabel}>CV track</span>
        <select
          value={draft.track}
          onChange={(e) => setDraft((d) => ({ ...d, track: e.target.value as CvTrack }))}
          className={`${fieldControl} form-select`}
        >
          <option value="auto">Auto (best match)</option>
          {Object.keys(library.cvs).map((track) => (
            <option key={track} value={track}>
              {getLabel(track)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
