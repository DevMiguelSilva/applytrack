import { SectionHeader } from '../components/SectionHeader'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { IconAction } from '../components/IconAction'
import { attachCardDragGhost } from '../components/JobCard'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { usePortalFeeds } from '../hooks/usePortalFeeds'
import {
  PORTAL_SOURCE_LABELS,
  PORTAL_SOURCE_OPTIONS,
  type PortalFeed,
  type PortalSource,
} from '../types/portal'



const rowBtn =
  "ui-button ui-secondary ui-compact"
const rowRun =
  "ui-button ui-secondary ui-compact"
const rowDanger =
  "ui-button ui-danger-quiet ui-compact ui-mobile-delete"
const fieldLabel = "ui-label"
const fieldControl =
  "ui-field mt-1"

type FeedDraft = { name: string; url: string; source: PortalSource }

const emptyDraft: FeedDraft = { name: '', url: '', source: 'indeed' }

export function PortalsPage() {
  const {
    feeds,
    loading,
    activeFeeds,
    todayCheckedIds,
    addFeed,
    updateFeed,
    deleteFeed,
    reorderFeeds,
    toggleCheckedToday,
    openFeed,
    openAllActive,
  } = usePortalFeeds()

  const [draft, setDraft] = useState<FeedDraft>(emptyDraft)
  const [showAddFeed, setShowAddFeed] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<FeedDraft>(emptyDraft)
  const [busyFeedId, setBusyFeedId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [deletingFeed, setDeletingFeed] = useState<PortalFeed | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  const addFeedButton = useRef<HTMLButtonElement>(null)
  const deleteTrigger = useRef<HTMLElement | null>(null)
  const deletePending = useRef(false)

  useEffect(() => {
    if (deletingFeed) {
      deleteDialog.current?.showModal()
      cancelDeleteButton.current?.focus()
    } else {
      deleteDialog.current?.close()
    }
  }, [deletingFeed])

  const cancelDelete = () => {
    if (deletePending.current) return
    deleteDialog.current?.close()
    setDeletingFeed(null)
    setDeleteError(null)
    deleteTrigger.current?.focus()
  }

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (!draft.url.trim()) {
      setError('URL is required')
      return
    }
    try {
      await addFeed({ ...draft, name: draft.name.trim(), url: draft.url.trim() })
      setDraft(emptyDraft)
      setShowAddFeed(false)
      setMessage('Feed saved')
      window.setTimeout(() => setMessage(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add feed')
    }
  }

  const startEdit = (feed: PortalFeed) => {
    setEditingId(feed.id)
    setEditDraft({
      name: feed.name,
      url: feed.url,
      source: feed.source === 'other' ? 'indeed' : feed.source,
    })
    setError(null)
  }

  const saveEdit = async (event: React.FormEvent, id: string) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setBusyFeedId(id)
    try {
      await updateFeed(id, {
        name: editDraft.name.trim() || 'Untitled feed',
        url: editDraft.url.trim(),
        source: editDraft.source,
      })
      setEditingId(null)
      setMessage('Feed updated')
      window.setTimeout(() => setMessage(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update feed')
    } finally {
      setBusyFeedId(null)
    }
  }

  const handleOpenAll = async () => {
    setError(null)
    setMessage(null)
    try {
      const { opened, blockedHint, remaining } = await openAllActive()
      if (opened === 0) {
        setMessage('Browser blocked the tabs. Allow pop-ups for this site, then try again.')
        return
      }
      if (blockedHint || remaining > 0) {
        setMessage(
          `Opened ${opened} and marked those checked.${
            remaining > 0
              ? ` ${remaining} still unchecked — click Open all again (or allow pop-ups to open more at once).`
              : ' Allow pop-ups if you want every tab in one click.'
          }`
        )
        return
      }
      setMessage(`Opened ${opened} portal(s) and marked them checked for today.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open active feeds')
    }
  }

  const handleOpenFeed = async (feed: PortalFeed) => {
    setError(null)
    setMessage(null)
    try {
      await openFeed(feed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open feed')
    }
  }

  const handleToggleActive = async (feed: PortalFeed) => {
    setError(null)
    setMessage(null)
    setBusyFeedId(feed.id)
    try {
      await updateFeed(feed.id, { active: !feed.active })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update feed')
    } finally {
      setBusyFeedId(null)
    }
  }

  const handleDelete = (feed: PortalFeed, trigger: HTMLButtonElement) => {
    deleteTrigger.current = trigger
    setDeleteError(null)
    setDeletingFeed(feed)
  }

  const confirmDelete = async () => {
    if (!deletingFeed || deletePending.current) return
    deletePending.current = true
    setDeleting(true)
    setDeleteError(null)
    setError(null)
    setMessage(null)
    try {
      await deleteFeed(deletingFeed.id)
      setEditingId((current) => current === deletingFeed.id ? null : current)
      deleteDialog.current?.close()
      setDeletingFeed(null)
      setShowAddFeed(false)
      window.requestAnimationFrame(() => addFeedButton.current?.focus())
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete feed')
    } finally {
      deletePending.current = false
      setDeleting(false)
    }
  }

  const handleToggleChecked = async (feed: PortalFeed) => {
    setError(null)
    setMessage(null)
    try {
      await toggleCheckedToday(feed.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update today’s checklist')
    }
  }

  const handleFeedDragStart = (index: number, event: DragEvent<HTMLElement>) => {
    setDragIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    const card = event.currentTarget.closest('li')
    if (card instanceof HTMLElement) attachCardDragGhost(event, card)
  }

  const handleFeedDragOver = (index: number, event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropIndex !== index) setDropIndex(index)
  }

  const handleFeedDrop = async (index: number) => {
    if (dragIndex == null || dragIndex === index) {
      setDragIndex(null)
      setDropIndex(null)
      return
    }
    try {
      await reorderFeeds(dragIndex, index)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder feeds')
    } finally {
      setDragIndex(null)
      setDropIndex(null)
    }
  }

  const handleFeedDragEnd = () => {
    setDragIndex(null)
    setDropIndex(null)
  }

  if (loading) return <LoadingSpinner label="Loading portals…" />

  const checkedActiveCount = activeFeeds.filter((feed) => todayCheckedIds.has(feed.id)).length

  return (
    <div className="ui-page">
      <SectionHeader title="Portals" description="Keep your job-search links together and track the portals you check." actions={<div className="m-actions flex flex-wrap gap-2">
          <button
            type="button"
            data-role="primary"
            onClick={() => void handleOpenAll()}
            disabled={activeFeeds.length === 0 || Boolean(busyFeedId)}
            className="ui-button ui-secondary"
          >
            Open all active ({activeFeeds.length})
          </button>
        </div>} />

      {(message || error) && (
        <p
          className={`text-sm ${error ? 'text-red-700' : 'text-[#23745e]'}`}
          role={error ? 'alert' : 'status'}
        >
          {error || message}
        </p>
      )}

      <section className={`ui-panel space-y-4`}>
        <div className="space-y-1">
          <h2 className=" ui-section-title">Your feeds</h2>
          <p className="ui-meta text-brand-muted">
            {checkedActiveCount} of {activeFeeds.length} active feeds checked today.
          </p>
        </div>

        {feeds.length === 0 ? (
          <div className="rounded-[1.25rem] border border-dashed border-[#e6eeeb] bg-white p-8 text-center">
            <h3 className=" ui-section-title">No portal feeds yet</h3>
            <p className="mt-2 ui-helper text-brand-muted">Add a job-search URL to keep it ready for your next search session.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {feeds.map((feed, index) => {
              const checked = todayCheckedIds.has(feed.id)
              const busy = busyFeedId === feed.id

              return (
                <li
                  key={feed.id}
                  onDragOver={(event) => handleFeedDragOver(index, event)}
                  onDrop={() => void handleFeedDrop(index)}
                  className={`rounded-[1.25rem] border border-[#e6eeeb] bg-white p-4 text-sm ${
                    dragIndex === index ? 'opacity-40' : ''
                  } ${
                    dropIndex === index && dragIndex != null && dragIndex !== index
                      ? 'ring-2 ring-brand-primary/40'
                      : ''
                  }`}
                >
                  {editingId === feed.id ? (
                    <form onSubmit={(event) => void saveEdit(event, feed.id)} className="space-y-2.5">
                      <FeedFields draft={editDraft} setDraft={setEditDraft} />
                      <div className="m-actions flex flex-wrap gap-2">
                        <button
                          type="submit"
                          data-role="primary"
                          disabled={busy}
                          className="ui-button ui-primary"
                        >
                          {busy ? 'Saving…' : 'Save changes'}
                        </button>
                        <button
                          type="button"
                          data-role="quiet"
                          onClick={() => {
                            setEditingId(null)
                            setError(null)
                          }}
                          className="ui-button ui-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="search-mobile-only border-t border-[#e6eeeb] pt-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleToggleActive(feed)}
                          className={rowBtn}
                        >
                          {feed.active ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(event) => handleDelete(feed, event.currentTarget)}
                          className={rowDanger}
                        >
                          Delete
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="search-row">
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          draggable
                          onDragStart={(event) => handleFeedDragStart(index, event)}
                          onDragEnd={handleFeedDragEnd}
                          className="search-drag h-8 w-6 shrink-0 cursor-grab select-none items-center justify-center leading-none text-brand-muted active:cursor-grabbing ui-drag-control"
                          title="Drag to reorder"
                          aria-label={`Reorder ${feed.name || 'portal feed'}`}
                        >
                          ⋮⋮
                        </button>
                        <label className="ui-check-target"><input
                          type="checkbox"
                          checked={checked}
                          disabled={!feed.active || busy}
                          onChange={() => void handleToggleChecked(feed)}
                          className="ui-checkbox"
                          title="Checked today"
                          aria-label={`Mark ${feed.name || 'portal feed'} checked today`}
                        /></label>
                        <div className="min-w-0 text-left">
                          <p className="font-medium text-brand-ink">
                            {feed.name || 'Untitled feed'}
                            {feed.active ? (
                              <span className="ml-2 ui-meta font-medium text-[#23745e]">active</span>
                            ) : (
                              <span className="ml-2 ui-meta text-brand-muted">paused</span>
                            )}
                            {checked && (
                              <span className="ml-2 ui-meta text-[#23745e]">checked today ✓</span>
                            )}
                          </p>
                          <p className="mt-1 truncate ui-meta leading-relaxed text-brand-muted">
                            {PORTAL_SOURCE_LABELS[feed.source]} · {feed.url}
                          </p>
                        </div>
                      </div>

                      <div className="search-icons">
                        <IconAction label="Open" disabled={busy} onClick={() => void handleOpenFeed(feed)}>
                          <ExternalLinkIcon />
                        </IconAction>
                        <IconAction label="Edit" onClick={() => startEdit(feed)}>
                          <PencilIcon />
                        </IconAction>
                        <IconAction
                          label={feed.active ? 'Pause' : 'Activate'}
                          disabled={busy}
                          onClick={() => void handleToggleActive(feed)}
                        >
                          {feed.active ? <PauseIcon /> : <PlayIcon />}
                        </IconAction>
                        <IconAction label="Delete" danger disabled={busy} onClick={(event) => handleDelete(feed, event.currentTarget)}>
                          <TrashIcon />
                        </IconAction>
                      </div>

                      <div className="search-pair">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleOpenFeed(feed)}
                          className={rowRun}
                        >
                          Open
                        </button>
                        <button type="button" onClick={() => startEdit(feed)} className={rowBtn}>
                          Edit
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="border-t border-[#e6eeeb] pt-4">
          {!showAddFeed ? (
            <button ref={addFeedButton} type="button" onClick={() => setShowAddFeed(true)} className="ui-button ui-primary">
              Add portal feed
            </button>
          ) : (
            <form onSubmit={handleAdd} className="space-y-3">
              <p className="ui-section-title">New portal feed</p>
              <FeedFields draft={draft} setDraft={setDraft} />
              <div className="m-actions flex flex-wrap gap-2">
                <button type="submit" data-role="primary" className="ui-button ui-primary">
                  Save feed
                </button>
                <button
                  type="button"
                  data-role="quiet"
                  onClick={() => {
                    setShowAddFeed(false)
                    setDraft(emptyDraft)
                    setError(null)
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
      <dialog
        ref={deleteDialog}
        aria-labelledby="delete-portal-title"
        aria-describedby="delete-portal-description"
        aria-busy={deleting}
        onCancel={(event) => {
          event.preventDefault()
          cancelDelete()
        }}
        className="ui-panel ui-dialog w-[calc(100%-2rem)] max-w-lg backdrop:bg-brand-ink/30"
      >
        <h2 id="delete-portal-title" className=" ui-dialog-title">Delete saved portal?</h2>
        <p id="delete-portal-description" className="mt-3 ui-helper text-brand-muted [overflow-wrap:anywhere]">
          Delete “{deletingFeed?.name.trim() || 'Untitled feed'}” from your saved portals? This cannot be undone.
        </p>
        {deleteError && <p role="alert" className="mt-3 ui-body text-red-700 [overflow-wrap:anywhere]">{deleteError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button ref={cancelDeleteButton} type="button" disabled={deleting} onClick={cancelDelete} className="ui-button ui-secondary">Cancel</button>
          <button type="button" disabled={deleting} onClick={() => void confirmDelete()} className="ui-button ui-danger-quiet">
            {deleting ? 'Deleting…' : 'Delete portal'}
          </button>
        </div>
      </dialog>
    </div>
  )
}

function FeedFields({
  draft,
  setDraft,
}: {
  draft: FeedDraft
  setDraft: React.Dispatch<React.SetStateAction<FeedDraft>>
}) {
  return (
    <div className="search-fields">
      <label className="ui-label block">
        <span className={fieldLabel}>Name</span>
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          className={fieldControl}
        />
      </label>
      <label className="ui-label block">
        <span className={fieldLabel}>Source</span>
        <select
          value={PORTAL_SOURCE_OPTIONS.includes(draft.source as (typeof PORTAL_SOURCE_OPTIONS)[number])
            ? draft.source
            : 'indeed'}
          onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value as PortalSource }))}
          className={`${fieldControl} form-select`}
        >
          {PORTAL_SOURCE_OPTIONS.map((source) => (
            <option key={source} value={source}>
              {PORTAL_SOURCE_LABELS[source]}
            </option>
          ))}
        </select>
      </label>
      <label className="ui-label block">
        <span className={fieldLabel}>
          URL <span className="text-red-700">*</span>
        </span>
        <input
          type="url"
          value={draft.url}
          onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
          required
          className={fieldControl}
        />
      </label>
    </div>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9 3h4v4M13 3 7.5 8.5M11 8.5v4h-8v-8h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 4.5h9M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
