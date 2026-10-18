const JOURNAL = 'applytrack-local-mutation-v1'
let queue: Promise<unknown> = Promise.resolve()
type LocalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** All local multi-store writes share one origin lock; a journal is never replayed for another owner. */
export function withLocalMutation<T>(operation: () => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => typeof navigator !== 'undefined' && navigator.locks
    ? await navigator.locks.request('applytrack-local-mutation', async () => await operation()) : await operation()
  const pending = queue.catch(() => {}).then(run)
  queue = pending.catch(() => {})
  return pending
}
export function recoverLocalMutation(storage: LocalStorage, owner = 'local') {
  const raw = storage.getItem(JOURNAL)
  if (!raw) return
  const journal = JSON.parse(raw) as { owner: string; before: Record<string, string | null> }
  if (journal.owner !== owner || !journal.before || typeof journal.before !== 'object') throw new Error('A different account has an unfinished local transaction. Do not overwrite its data.')
  for (const [key, value] of Object.entries(journal.before)) {
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, value)
  }
  storage.removeItem(JOURNAL)
}
export function commitLocalMutation(storage: LocalStorage, changes: Record<string, string>, owner = 'local') {
  recoverLocalMutation(storage, owner)
  const before = Object.fromEntries(Object.keys(changes).map(key => [key, storage.getItem(key)]))
  storage.setItem(JOURNAL, JSON.stringify({ owner, before }))
  try {
    for (const [key, value] of Object.entries(changes)) storage.setItem(key, value)
    storage.removeItem(JOURNAL)
  } catch (error) {
    // If recovery also fails, retain the journal for the next read/reload.
    try { recoverLocalMutation(storage, owner) } catch { /* Preserve recovery journal. */ }
    throw error
  }
}
