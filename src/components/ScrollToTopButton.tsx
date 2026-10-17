import { useEffect, useState } from 'react'

const SHOW_AFTER_PX = 280

function pageIsScrolled(): boolean {
  if (window.scrollY > SHOW_AFTER_PX) return true
  return [...document.querySelectorAll<HTMLElement>('.app-scroll')].some(
    (el) => el.scrollTop > SHOW_AFTER_PX
  )
}

function scrollPageToTop() {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
  window.scrollTo({ top: 0, behavior })
  document.querySelectorAll<HTMLElement>('.app-scroll').forEach((el) => {
    if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior })
  })
}

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(pageIsScrolled())
    onScroll()
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      onClick={scrollPageToTop}
      className="ui-button ui-secondary ui-icon-button fixed bottom-[calc(7rem+env(safe-area-inset-bottom))] left-4 z-40 lg:bottom-8 lg:left-[calc(var(--sidebar-width)+1rem)]"
      aria-label="Back to top"
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    </button>
  )
}
