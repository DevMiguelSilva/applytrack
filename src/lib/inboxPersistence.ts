import { RefreshInvalidated } from './inboxRefresh'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { InboxJob } from '../types/job'
import { inboxJobToRow, rowToInboxJob } from './database'

export type InboxSaveOperation = 'upsert' | 'prune' | 'local'

/** Fixed categories only: never retain a database response or job contents. */
export class InboxSaveError extends Error {
  constructor(public operation: InboxSaveOperation, public category: string, message: string) {
    super(message)
  }
}

export function safeInboxSaveError(operation: InboxSaveOperation, error: unknown): InboxSaveError {
  const value = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown; name?: unknown } : {}
  let category = 'unavailable'
  let action = 'Check your connection and retry saving. If this continues, contact support.'
  if (operation === 'local') {
    category = value.name === 'QuotaExceededError' ? 'storage_full' : 'storage_unavailable'
    action = category === 'storage_full' ? 'Browser storage is full. Free storage for other sites, then retry saving here.' : 'Allow browser storage for this site, then retry saving.'
  } else if (value.code === '23505') {
    category = 'conflict'
    action = 'A saved listing conflicts with this batch. Contact support before refreshing so these session results are retained.'
  } else if (value.code === '42501' || value.code === 'PGRST301' || value.status === 401 || value.status === 403) {
    category = 'access'
    action = 'Cloud access was denied. Check your sign-in and contact support if access cannot be restored. Signing out discards these session results.'
  } else if (value.code === '23503') {
    category = 'reference'
    action = 'A referenced saved search or CV is unavailable. Contact support before refreshing so these session results are retained.'
  } else if (value.code === '42703' || value.code === 'PGRST204') {
    category = 'schema'
    action = 'Cloud storage needs an application update. Contact support, then retry saving once it is resolved.'
  }
  const stage = operation === 'prune' ? 'Results may already be stored, but old review cards could not be cleaned up.' : 'Results could not be saved.'
  return new InboxSaveError(operation, category, `${stage} ${action} Save reference: ${operation}/${category}.`)
}

export async function inboxSaveStep(operation: InboxSaveOperation, run: () => unknown | Promise<unknown>) {
  try { await run() }
  catch (error) {
    if (error instanceof InboxSaveError || error instanceof RefreshInvalidated) throw error
    throw safeInboxSaveError(operation, error)
  }
}
/** Reconcile with persisted identities, never upsert a fetched 'new' status over history. */
export async function saveCloudInboxResults(client: SupabaseClient, userId: string, transform: (items: InboxJob[]) => InboxJob[], check: () => void, phase: (value: 'read' | 'write') => void = () => {}): Promise<InboxJob[]> {
  const read = async () => {
    const rows: InboxJob[] = []
    // Supabase caps select responses. Read every page so hidden history is included.
    for (let offset = 0; ; offset += 500) {
      check()
      phase('read')
      const { data, error } = await client.from('job_inbox').select('*').eq('user_id', userId).order('id').range(offset, offset + 499)
      if (error) throw error
      check()
      rows.push(...(data ?? []).map(rowToInboxJob))
      if (!data || data.length < 500) return rows
    }
  }
  let result: InboxJob[] = []
  await inboxSaveStep('upsert', async () => {
    const before = await read()
    const next = transform(before)
    const existing = new Map(before.map(item => [item.externalId, item]))
    const fresh = next.filter(item => !existing.has(item.externalId))
    check()
    if (fresh.length) {
      // Another session may insert between read and write. DO NOTHING preserves its history.
      phase('write')
      const { error } = await client.from('job_inbox').upsert(fresh.map(item => inboxJobToRow(item, userId)), { onConflict: 'user_id,external_id', ignoreDuplicates: true })
      if (error) throw error
    }
    for (const item of next) {
      const old = existing.get(item.externalId)
      if (!old || old.status !== 'new' || JSON.stringify(old) === JSON.stringify(item)) continue
      check()
      const { id: _id, user_id: _owner, ...patch } = inboxJobToRow({ ...item, id: old.id }, userId)
      void _id; void _owner
      phase('write')
      const { error } = await client.from('job_inbox').update(patch).eq('user_id', userId).eq('id', old.id).eq('status', 'new')
      if (error) throw error
    }
    const kept = new Set(next.map(item => item.externalId))
    const removed = before.filter(item => item.status === 'new' && !kept.has(item.externalId)).map(item => item.id)
    await inboxSaveStep('prune', async () => {
      check()
      if (removed.length) {
        phase('write')
        const { error } = await client.from('job_inbox').delete().eq('user_id', userId).eq('status', 'new').in('id', removed)
        if (error) throw error
      }
    })
    result = await read()
  })
  check()
  return result
}
