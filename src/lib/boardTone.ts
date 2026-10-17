import type { JobStatus } from '../types/job'

export type BoardSlot = JobStatus | 'trash'

/** One hue per status. Counts use `figure`. Cards use `edge`. Move buttons stay white and take `action` on hover. */
const whiteAction = 'border border-[#dce8e4] bg-white text-brand-ink'

export const BOARD_TONE: Record<BoardSlot, { figure: string; edge: string; action: string }> = {
  saved: {
    figure: 'text-yellow-700',
    edge: 'border-l-[3px] border-l-yellow-500',
    action: `${whiteAction} hover:border-yellow-300 hover:bg-yellow-50 hover:text-yellow-800`,
  },
  applied: {
    figure: 'text-sky-700',
    edge: 'border-l-[3px] border-l-sky-600',
    action: `${whiteAction} hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700`,
  },
  interview: {
    figure: 'text-emerald-700',
    edge: 'border-l-[3px] border-l-emerald-600',
    action: `${whiteAction} hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700`,
  },
  offer: {
    figure: 'text-violet-600',
    edge: 'border-l-[3px] border-l-violet-600',
    action: `${whiteAction} hover:border-violet-200 hover:bg-violet-50 hover:text-violet-600`,
  },
  rejected: {
    figure: 'text-red-600',
    edge: 'border-l-[3px] border-l-red-600',
    action: `${whiteAction} hover:border-red-200 hover:bg-red-50 hover:text-red-700`,
  },
  trash: {
    figure: 'text-brand-ink',
    edge: 'border-l-[3px] border-l-brand-ink',
    action: `${whiteAction} hover:border-brand-ink hover:bg-[#f4f6f5] hover:text-brand-ink`,
  },
}
