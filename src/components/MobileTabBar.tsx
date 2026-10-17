import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useJobs } from '../hooks/useJobs'
import { useInbox } from '../hooks/useInbox'
import { NavigationIcon } from './NavigationIcon'
const tabClass = (active: boolean) => `nav-focus mobile-tab ${active ? 'mobile-tab-active' : ''}`
export function MobileTabBar() {
  const { newCount } = useInbox()
  const { user, isCloudEnabled, signOut } = useAuth()
  const { isCloudSync } = useJobs()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  useEffect(() => { setOpen(false); setError(false) }, [pathname, user?.id, isCloudEnabled])
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const resize = () => { if (media.matches) setOpen(false) }
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])
  useEffect(() => {
    if (!open || !dialog.current) return
    const modal = dialog.current
    const trigger = more.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    modal.showModal()
    return () => {
      modal.close()
      document.body.style.overflow = overflow
      if (!window.matchMedia('(min-width: 1024px)').matches) trigger?.focus()
    }
  }, [open])

  return <>
    <nav aria-label="Primary" className="mobile-navigation fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 lg:hidden">
      <div className="mobile-navigation-surface">
        {([{ text: 'Board', to: '/' }, { text: 'Portals', to: '/portals' }, { text: 'Inbox', to: '/inbox' }] as const).map(({ text, to }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => tabClass(isActive)}>
          <span className="mobile-tab-icon"><NavigationIcon name={text} />{text === 'Inbox' && newCount > 0 && <span className="mobile-inbox-badge">{newCount > 99 ? '99+' : newCount}</span>}</span><span>{text}</span>
        </NavLink>)}
        <button ref={more} type="button" className={tabClass(open || pathname === '/add' || pathname === '/cv')} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-controls="more-navigation"><span className="mobile-tab-icon"><NavigationIcon name="More" /></span><span>More</span></button>
      </div>
    </nav>
    {createPortal(<dialog ref={dialog} id="more-navigation" aria-labelledby="more-title" className="navigation-sheet" onCancel={() => setOpen(false)} onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }} onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false)
    }}>
      <div className="mobile-workspace">
        <div className="mobile-sheet-handle" aria-hidden="true" />
        <div className="mobile-sheet-heading"><div><p className="mobile-sheet-eyebrow">YOUR WORKSPACE</p><h2 className="ui-dialog-title" id="more-title">More</h2></div><button autoFocus type="button" aria-label="Close More" className="ui-button ui-secondary ui-icon-button" onClick={() => setOpen(false)}><NavigationIcon name="close" /></button></div>
        <nav aria-label="More destinations" className="mobile-destination-grid">
          <NavLink to="/add" aria-label="Add" className="nav-focus mobile-destination mobile-destination-primary"><span className="mobile-destination-icon"><NavigationIcon name="Add" /></span><span className="mobile-destination-title">Add application</span><span className="mobile-destination-caption">Track a new opportunity</span></NavLink>
          <NavLink to="/cv" aria-label="CVs" className="nav-focus mobile-destination"><span className="mobile-destination-icon"><NavigationIcon name="CVs" /></span><span className="mobile-destination-title">CV library</span><span className="mobile-destination-caption">Manage your master CVs</span></NavLink>
        </nav>
        {(isCloudSync || isCloudEnabled) && <div className="mobile-account-panel">
          {isCloudSync && <p className="flex items-center gap-3 px-4 py-3 text-sm text-emerald-700"><NavigationIcon name="Synced" /><span>Synced to cloud</span><span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" /></p>}
          {isCloudEnabled && (user ? <button type="button" className="ui-button ui-danger" onClick={() => { setError(false); void signOut().catch(() => setError(true)) }}><NavigationIcon name="Sign out" />Sign out</button> : <NavLink to="/login" className="ui-button ui-primary w-full"><NavigationIcon name="Sign in" />Sign in</NavLink>)}
          {error && <p role="alert" className="px-4 text-sm text-red-700">Sign out failed. Please retry.</p>}
        </div>}
      </div>
    </dialog>, document.body)}
  </>
}
