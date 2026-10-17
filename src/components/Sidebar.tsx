import { Fragment, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink } from 'react-router-dom'
import { Brand } from './Header'
import { NavigationIcon } from './NavigationIcon'
import { useAuth } from '../hooks/useAuth'
import { useJobs } from '../hooks/useJobs'
import { useInbox } from '../hooks/useInbox'
const destinations = [{ label: 'Board', to: '/' }, { label: 'Portals', to: '/portals' }, { label: 'Inbox', to: '/inbox' }, { label: 'Add', to: '/add' }, { label: 'CVs', to: '/cv' }] as const
function Hint({ label, compact, children }: { label: string; compact: boolean; children: ReactNode }) {
  const [top, setTop] = useState<number | null>(null)
  return <div onMouseEnter={event => setTop(event.currentTarget.getBoundingClientRect().top)} onMouseLeave={() => setTop(null)} onFocus={event => setTop(event.currentTarget.getBoundingClientRect().top)} onBlur={() => setTop(null)} onKeyDown={event => { if (event.key === 'Escape') setTop(null) }}>
    {children}
    {compact && top !== null && createPortal(<span role="tooltip" className="pointer-events-none fixed left-[80px] z-[70] hidden rounded-lg bg-brand-ink px-3 py-2 text-sm text-white shadow-lg lg:block" style={{ top: Math.max(8, Math.min(top, window.innerHeight - 44)) }}>{label}</span>, document.body)}
  </div>
}
export function Sidebar({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) {
  const { user, isCloudEnabled, signOut } = useAuth()
  const { isCloudSync } = useJobs()
  const { newCount } = useInbox()
  const [error, setError] = useState(false)
  const control = 'nav-focus sidebar-control flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold'
  const label = (text: string) => <span className={collapsed ? 'sr-only' : ''}>{text}</span>
  const accountLabel = user ? 'Sign out' : 'Sign in'
  return <aside aria-label="Application sidebar" data-collapsed={collapsed} className="desktop-sidebar fixed inset-y-0 left-0 z-50 hidden w-[var(--sidebar-width)] flex-col overflow-y-auto px-3 py-4 lg:flex">
    <div className="sidebar-brand"><Hint label="ApplyTrack" compact={collapsed}><Brand compact={collapsed} /></Hint></div>
    {!collapsed && <p className="sidebar-group-label">WORKSPACE</p>}
    <nav id="desktop-destinations" aria-label="Primary" className="space-y-1.5">
      {destinations.map(({ label: text, to }) => <Fragment key={to}>
        {text === 'Add' && <div className="sidebar-divider">{!collapsed && <span className="sidebar-group-label">TOOLS</span>}</div>}
        <Hint label={text} compact={collapsed}>
        <NavLink to={to} end={to === '/'} aria-label={text} className={({ isActive }) => `nav-focus sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}>
          <span className="sidebar-link-icon"><NavigationIcon name={text} /></span>{label(text)}
          {text === 'Inbox' && newCount > 0 && <span aria-label={`${newCount} ready to review`} className={`sidebar-inbox-badge ${collapsed ? 'sidebar-inbox-badge-compact' : ''}`}>{newCount > 99 ? '99+' : newCount}</span>}
        </NavLink>
      </Hint></Fragment>)}
    </nav>
    <div className="sidebar-footer mt-auto space-y-2 pt-6">
      <Hint label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} compact={collapsed}>
        <button type="button" className={control} onClick={toggle} aria-expanded={!collapsed} aria-controls="desktop-destinations"><NavigationIcon name={collapsed ? 'expand' : 'collapse'} />{label(collapsed ? 'Expand sidebar' : 'Collapse sidebar')}</button>
      </Hint>
      {isCloudSync && <Hint label="Synced to cloud" compact={collapsed}><div className={`${control} text-emerald-700`} tabIndex={collapsed ? 0 : undefined}><NavigationIcon name="Synced" />{label('Synced to cloud')}</div></Hint>}
      {isCloudEnabled && <Hint label={accountLabel} compact={collapsed}>
        {user ? <button type="button" className={`ui-button ui-danger w-full ${collapsed ? 'ui-icon-button' : ''}`} onClick={() => { setError(false); void signOut().catch(() => setError(true)) }}><NavigationIcon name="Sign out" />{label(accountLabel)}</button> : <NavLink to="/login" className={`ui-button ui-primary w-full ${collapsed ? 'ui-icon-button' : ''}`}><NavigationIcon name="Sign in" />{label('Sign in')}</NavLink>}
      </Hint>}
      {error && <p role="alert" className="break-words text-xs text-red-700">Sign out failed. Retry.</p>}
    </div>
  </aside>
}
