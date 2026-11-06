/** Stop showing active progress after the deadline without abandoning the underlying write. */
export function observeInboxSave<T>(operation: Promise<T>, timeoutMs = 20000) {
  const result = operation.then(
    value => ({ status: 'fulfilled' as const, value }),
    error => ({ status: 'rejected' as const, error }),
  )
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<{ status: 'pending' }>(resolve => {
    timer = setTimeout(() => resolve({ status: 'pending' }), timeoutMs)
  })
  const initial = Promise.race([result, timeout]).finally(() => clearTimeout(timer))
  return { initial, result }
}
