interface IconActionProps {
  label: string
  pressed?: boolean
  danger?: boolean
  primary?: boolean
  successToggle?: boolean
  busy?: boolean
  disabled?: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}

/** Compact icon action used by editable list rows. */
export function IconAction({ label, pressed, danger, primary, successToggle, busy, disabled, onClick, children }: IconActionProps) {
  return (
    <button
      type="button"
      aria-busy={busy}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`ui-icon-action ${danger ? 'ui-icon-action-danger' : primary ? 'ui-icon-action-primary' : ''} ${successToggle ? 'ui-icon-action-success-toggle' : ''}`}
    >
      <span className="ui-icon-action-box">
        {children}
      </span>
      {label}
    </button>
  )
}
