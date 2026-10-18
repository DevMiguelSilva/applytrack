import { normalizeMasterCv, type MasterCv } from '../types/cv'
/** Empty display defaults contain no invented personal, location or career facts. Never persisted. */
export const emptyStoredCv: MasterCv = { contact: {name:'',email:'',phone:'',location:'',links:[]}, headline:'',summary:'',skills:[],experience:[],projects:[],education:[],certifications:[],updatedAt:'' }
export function storedCvContent(raw: unknown, snapshot?: unknown): MasterCv | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const base = snapshot && typeof snapshot === 'object' ? normalizeMasterCv(snapshot as Partial<MasterCv>, emptyStoredCv) : emptyStoredCv
  return normalizeMasterCv(raw as Partial<MasterCv>, base)
}
