import type { ReactNode } from 'react'
export type NavigationIconName = 'Board' | 'Portals' | 'Inbox' | 'Add' | 'CVs' | 'More' | 'collapse' | 'expand' | 'close' | 'Synced' | 'Sign in' | 'Sign out'
export function NavigationIcon({ name }: { name: NavigationIconName }) {
  const paths: Record<NavigationIconName, ReactNode> = {
    Board: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    Portals: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c4.4 4.8 4.4 11.2 0 16-4.4-4.8-4.4-11.2 0-16Z" /></>,
    Inbox: <><path d="m3 13 2.2-6.2a2 2 0 0 1 1.9-1.3h9.8a2 2 0 0 1 1.9 1.3L21 13v4.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 13h5l1.5 2h5L16 13h5" /></>,
    Add: <path d="M12 5v14M5 12h14" />,
    CVs: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
    More: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    collapse: <><path d="M14 7 9 12l5 5" /><path d="M4 4v16" /></>,
    expand: <><path d="m10 7 5 5-5 5" /><path d="M4 4v16" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    Synced: <><path d="M7 18H6a4 4 0 0 1-1-7.9A7 7 0 0 1 18 8a5 5 0 0 1 0 10h-1" /><path d="m9 17 2 2 4-5" /></>,
    'Sign in': <><path d="M14 4h5v16h-5M3 12h12m-4-4 4 4-4 4" /></>,
    'Sign out': <><path d="M10 4H5v16h5M11 12h10m-4-4 4 4-4 4" /></>,
  }
  return <svg className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
