import type { TailoredDocument } from '../types/cv'

export function mergeTailoredDocument(current: TailoredDocument[], next: TailoredDocument) {
  return [next, ...current.filter(doc => doc.jobApplicationId !== next.jobApplicationId)]
}

export function changedJobColumns<T extends object>(before: T, after: T) {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) =>
    key !== 'id' && key !== 'user_id' && JSON.stringify(value) !== JSON.stringify(before[key as keyof T])))
}
