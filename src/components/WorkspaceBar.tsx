import { Link, useLocation } from 'react-router-dom'
import { NavigationIcon } from './NavigationIcon'

const sections: Record<string, string> = { '/': 'Board', '/portals': 'Portals', '/inbox': 'Inbox', '/add': 'Add application', '/cv': 'CV library' }

export function WorkspaceBar() {
  const { pathname } = useLocation()
  const section = sections[pathname] ?? (pathname.startsWith('/job/') ? 'Application' : 'Workspace')
  return <div className="desktop-workspace-bar hidden lg:block">
    <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6">
      <p className="workspace-breadcrumb"><Link to="/" className="workspace-home-link ui-focus">Workspace</Link><span aria-hidden="true">/</span><span className="workspace-current">{section}</span></p>
      <Link to="/add" className="ui-button ui-primary"><NavigationIcon name="Add" /><span>Add application</span></Link>
    </div>
  </div>
}
