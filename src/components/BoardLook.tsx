/** Locked board styles. The compare switch and the previous look are gone. */
try {
  sessionStorage.removeItem('board-look')
} catch {
  // Private mode can block storage. Nothing else reads this key.
}

export const boardLook = {
  page: "ui-page",
  card: "ui-surface",
  cardHover: "transition hover:border-[#23745e] motion-reduce:transition-none",
  button:
    "ui-button ui-primary legacy-size-15",
  headline: "ui-title",
  sectionTitle: "ui-section-title legacy-size-text__1_75rem_",
  body: "ui-description",
  label: "ui-label legacy-size-text_xs",
  caption: "ui-meta text-[#4d635c]",
  figure: 'font-sans text-lg font-semibold leading-none',
  figureQuiet: 'font-display text-[1.75rem] font-semibold leading-none text-brand-ink',
  streakTitle: "ui-section-title legacy-size-text_lg",
  streakValue: 'font-sans text-sm font-semibold leading-none text-[#23745e]',
  streakQuiet: 'font-sans text-sm font-semibold leading-none text-brand-ink',
  hero: "ui-panel",
  cardPad: "ui-panel",
  search:
    "ui-field ui-search legacy-size-15",
  jobCard:
    'rounded-[1.25rem] border border-[#e6eeeb] bg-white p-4 transition hover:bg-[#f7fbf9]',
  jobTitle: "ui-card-title",
  jobMeta: "ui-meta text-[#4d635c]",
  empty: "ui-panel ui-empty text-center",
  emptyTitle: "ui-section-title mt-3 legacy-size-text__1_75rem_",
  kanban:
    "app-scroll max-h-[40rem] overflow-x-hidden overflow-y-auto rounded-[20px] border border-[#dce8e4] bg-[#f7fbf9] px-3 pb-3",
} as const

export type BoardLook = typeof boardLook
