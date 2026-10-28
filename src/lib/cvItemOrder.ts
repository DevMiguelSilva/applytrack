/** Move one existing entry without mutating the original list. */
export function moveCvItem<T extends { id: string }>(items: T[], id: string, direction: -1 | 1): T[] {
  const from = items.findIndex(item => item.id === id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= items.length) return items
  const next = [...items]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}
