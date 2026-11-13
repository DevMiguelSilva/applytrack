import { Outlet, useLocation } from 'react-router-dom'
import { TailoringProgress } from './TailoringProgress'
import { Header } from './Header'
import { MobileTabBar } from './MobileTabBar'
import { ScrollToTopButton } from './ScrollToTopButton'
import { Sidebar } from './Sidebar'
import { WorkspaceBar } from './WorkspaceBar'
import { PermanentDeleteProvider } from './PermanentDeleteProvider'

export function Layout() {
  const { pathname } = useLocation()
  const showTabs = pathname !== '/login'
  const login = !showTabs
  return (
    <PermanentDeleteProvider><div
      className={`ui-app min-h-screen ${login ? 'flex flex-col' : 'mobile-app-shell pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[240px]'}`}
    >
      <Header login={login} />
      {showTabs && <Sidebar />}
      {showTabs && <WorkspaceBar />}
      <main className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${login ? 'flex flex-1 items-center py-3 sm:py-4' : 'py-6 sm:py-8'}`}>
        <Outlet />
      </main>
      <footer className={`border-t border-[#dce8e4] text-center ui-meta text-[#4d635c] legacy-size-text_xs ${login ? 'py-2' : 'py-6'}`}>
        ApplyTrack · Built by Miguel Silva
      </footer>
      {showTabs && <MobileTabBar />}
      <ScrollToTopButton />
      {showTabs && <TailoringProgress />}
    </div></PermanentDeleteProvider>
  )
}
