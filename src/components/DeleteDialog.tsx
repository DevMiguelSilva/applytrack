import { useEffect, useId, useRef, type ReactNode } from 'react'
export function DeleteDialog({ open, title, children, pending, error, result, confirmLabel, pendingLabel, onCancel, onConfirm }: {
  open: boolean; title: string; children: ReactNode; pending: boolean; error?: string | null; result?: string | null;
  confirmLabel: string; pendingLabel: string; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (open && !dialog.current?.open) { dialog.current?.showModal(); cancel.current?.focus() }
    if (!open) dialog.current?.close()
  }, [open])
  useEffect(() => { if (open && result) cancel.current?.focus() }, [open, result])
  return <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={pending}
    onCancel={event => { event.preventDefault(); if (!pending) onCancel() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      if (pending || result) { event.preventDefault(); cancel.current?.focus(); return }
      if (event.shiftKey && document.activeElement === cancel.current) { event.preventDefault(); confirm.current?.focus() }
      else if (!event.shiftKey && document.activeElement === confirm.current) { event.preventDefault(); cancel.current?.focus() }
    }}
    className="ui-panel ui-dialog w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto backdrop:bg-brand-ink/30">
    <h2 id={`${id}-title`} className="ui-dialog-title legacy-size-text_lg [overflow-wrap:anywhere]">{title}</h2>
    <div id={`${id}-description`} className="mt-3 ui-helper legacy-size-text_sm [overflow-wrap:anywhere]">{children}</div>
    {error && <p role="alert" className="mt-3 ui-helper legacy-size-text_sm !text-red-700">{error}</p>}
    {result && <p role="status" className="mt-3 ui-helper legacy-size-text_sm">{result}</p>}
    <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:justify-end">
      <button ref={cancel} type="button" disabled={pending} className="ui-button ui-secondary" onClick={onCancel}>{result ? 'Close' : 'Cancel'}</button>
      {!result && <button ref={confirm} type="button" disabled={pending} className="ui-button ui-danger-quiet" onClick={onConfirm}>{pending ? pendingLabel : confirmLabel}</button>}
    </div>
  </dialog>
}
