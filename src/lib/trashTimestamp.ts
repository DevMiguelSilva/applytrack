/** Compare ISO timestamps without losing PostgreSQL's sub-millisecond precision. */
export function sameTrashTimestamp(left: string | null, right: string | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const time = Date.parse(left)
  if (!Number.isFinite(time) || time !== Date.parse(right)) return false
  const fraction = (value: string) =>
    (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1] ?? '').replace(/0+$/, '')
  return fraction(left) === fraction(right)
}
