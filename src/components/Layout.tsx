import { Outlet, useLocation } from 'react-router-dom'
import { TailoringProgress } from './TailoringProgress'
import { Header } from './Header'
import { MobileTabBar } from './MobileTabBar'
import { ScrollToTopButton } from './ScrollToTopButton'
import { useState, type CSSProperties } from 'react'
import { Sidebar } from './Sidebar'
import { readSidebarPreference, saveSidebarPreference } from '../lib/navigation'
import { WorkspaceBar } from './WorkspaceBar'
import { PermanentDeleteProvider } from './PermanentDeleteProvider'

export function Layout() {
  const { pathname } = useLocation()
  const showTabs = pathname !== '/login'
  const [collapsed, setCollapsed] = useState(() => {
    try { return readSidebarPreference(window.localStorage) } catch { return false }
  })
  const toggle = () => {
    setCollapsed(!collapsed)
    try { saveSidebarPreference(window.localStorage, !collapsed) } catch { /* Keep in-memory preference. */ }
  }

  return (
    <PermanentDeleteProvider><div
      style={{ '--sidebar-width': showTabs ? collapsed ? '72px' : '240px' : '0px' } as CSSProperties}
      className={`ui-app min-h-screen ${showTabs ? 'mobile-app-shell pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[var(--sidebar-width)]' : ''}`}
    >
      <Header login={!showTabs} />
      {showTabs && <Sidebar collapsed={collapsed} toggle={toggle} />}
      {showTabs && <WorkspaceBar />}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="border-t border-[#dce8e4] py-6 text-center ui-meta text-[#4d635c] legacy-size-text_xs">
        ApplyTrack · Built by Miguel Silva
      </footer>
      {showTabs && <MobileTabBar />}
      <ScrollToTopButton />
      {showTabs && <TailoringProgress />}
    </div></PermanentDeleteProvider>
  )
}
