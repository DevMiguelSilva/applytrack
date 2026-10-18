import { Link } from 'react-router-dom'
import { AppLogo } from './AppLogo'
export function Brand({ compact = false, appearance = 'standard' }: { compact?: boolean; appearance?: 'standard' | 'navigation' | 'header' }) {
  return <Link to="/" aria-label="ApplyTrack" className={`nav-focus flex min-h-11 shrink-0 items-center justify-center gap-2.5 rounded-lg ${appearance === 'standard' ? '' : 'brand-on-dark'} ${appearance === 'header' ? 'brand-header' : ''}`}>
    <AppLogo tone="brand" className="brand-mark" />
    {!compact && <span className="brand-wordmark font-display text-lg font-bold tracking-tight"><span className="brand-apply text-brand-ink">Apply</span><span className="brand-track text-brand-primary">Track</span></span>}
  </Link>
}
export function Header({ login = false }: { login?: boolean }) {
  return <header className={`mobile-brand-header sticky top-0 z-30 border-b border-brand-line bg-white/95 backdrop-blur-md ${login ? '' : 'lg:hidden'}`}>
    <div className="mx-auto flex max-w-6xl items-center px-5 py-2.5 sm:px-6"><Brand appearance="header" /></div>
  </header>
}
