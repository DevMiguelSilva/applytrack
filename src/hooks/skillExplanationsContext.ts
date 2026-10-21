import { createContext, useContext } from 'react'
import { SkillExplanationSession } from '../lib/skillExplanationSession'

export const SkillExplanationsContext = createContext<{ session: SkillExplanationSession; revision: number } | null>(null)

export function useSkillExplanations() {
  const value = useContext(SkillExplanationsContext)
  if (!value) throw new Error('useSkillExplanations requires SkillExplanationsProvider')
  return value.session
}
