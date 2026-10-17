export function LoadingSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col items-center justify-center gap-3 py-12">
      <div aria-hidden="true" className="h-10 w-10 animate-spin rounded-full border-4 border-brand-primary/30 border-t-brand-primary" />
      <p className="ui-helper text-brand-muted legacy-size-text_sm">{label}</p>
    </div>
  )
}
