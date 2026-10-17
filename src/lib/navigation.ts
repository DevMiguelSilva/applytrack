export const SIDEBAR_KEY = 'applytrack-sidebar-collapsed'
export function readSidebarPreference(storage: Pick<Storage, 'getItem'>): boolean {
  try { return storage.getItem(SIDEBAR_KEY) === 'true' } catch { return false }
}
export function saveSidebarPreference(storage: Pick<Storage, 'setItem'>, collapsed: boolean) {
  try { storage.setItem(SIDEBAR_KEY, String(collapsed)) } catch { /* State remains usable without storage. */ }
}
