import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Brand } from './Header'
import { NavigationIcon } from './NavigationIcon'
import { useAuth } from '../hooks/useAuth'
import { useJobs } from '../hooks/useJobs'
import { useInbox } from '../hooks/useInbox'
const destinations = [{ label: 'Board', to: '/' }, { label: 'Portals', to: '/portals' }, { label: 'Inbox', to: '/inbox' }, { label: 'Add', to: '/add' }, { label: 'CVs', to: '/cv' }] as const
export function Sidebar() {
  const { user, isCloudEnabled, signOut } = useAuth()
  const { isCloudSync } = useJobs()
  const { newCount } = useInbox()
  const [error, setError] = useState(false)
  const accountLabel = user ? 'Sign out' : 'Sign in'
  const control = 'nav-focus sidebar-control flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold'
  return <aside aria-label="Application sidebar" className="desktop-sidebar fixed inset-y-0 left-0 z-50 hidden w-[240px] flex-col overflow-y-auto px-3 py-4 lg:flex">
    <div className="sidebar-brand"><Brand appearance="navigation" /></div>
    <p className="sidebar-group-label">WORKSPACE</p>
    <nav aria-label="Primary" className="space-y-1.5">
      {destinations.map(({ label: text, to }) => <div key={to}>
        {text === 'Add' && <div className="sidebar-divider"><span className="sidebar-group-label">TOOLS</span></div>}
        <NavLink to={to} end={to === '/'} aria-label={text} className={({ isActive }) => `nav-focus sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}>
          <span className="sidebar-link-icon"><NavigationIcon name={text} /></span>{text}
          {text === 'Inbox' && newCount > 0 && <span aria-label={`${newCount} ready to review`} className="sidebar-inbox-badge">{newCount > 99 ? '99+' : newCount}</span>}
        </NavLink>
      </div>)}
    </nav>
    <div className="sidebar-footer mt-auto space-y-2 pt-6">
      {isCloudSync && <div className={`${control} text-emerald-700`}><NavigationIcon name="Synced" />Synced to cloud</div>}
      {isCloudEnabled && (user ? <button type="button" className="ui-button ui-danger-quiet w-full" onClick={() => { setError(false); void signOut().catch(() => setError(true)) }}><NavigationIcon name="Sign out" />{accountLabel}</button> : <NavLink to="/login" className="ui-button ui-primary w-full"><NavigationIcon name="Sign in" />Sign in</NavLink>)}
      {error && <p role="alert" className="break-words text-xs text-red-700">Sign out failed. Retry.</p>}
    </div>
  </aside>
}
