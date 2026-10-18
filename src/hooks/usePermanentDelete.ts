import { createContext, useContext } from 'react'
import type { JobApplication } from '../types/job'
export type OpenPermanentDelete = (jobs: JobApplication[], bulk: boolean, trigger: HTMLButtonElement, detail?: boolean) => void
export const PermanentDeleteContext=createContext<OpenPermanentDelete|null>(null)
export function usePermanentDelete() {
  const open=useContext(PermanentDeleteContext)
  if(!open)throw new Error('Permanent deletion requires its provider')
  return open
}
