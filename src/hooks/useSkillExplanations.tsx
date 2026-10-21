import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { explainSkill } from '../api/gemini'
import { SkillExplanationSession } from '../lib/skillExplanationSession'
import { useAuth } from './useAuth'
import { SkillExplanationsContext } from './skillExplanationsContext'

export function SkillExplanationsProvider({ children }: { children: ReactNode }) {
  const { isCloudEnabled, user } = useAuth()
  const account = isCloudEnabled ? user?.id ?? 'signed-out' : 'local'
  const [revision, refresh] = useState(0)
  const session = useMemo(
    () => new SkillExplanationSession(account, explainSkill, () => refresh(value => value + 1)),
    [account],
  )
  const currentSession = useRef(session)
  currentSession.current = session
  const value = useMemo(() => ({ session, revision }), [session, revision])

  useEffect(() => () => {
    if (currentSession.current !== session) session.dispose()
  }, [session])

  return <SkillExplanationsContext.Provider value={value}>{children}</SkillExplanationsContext.Provider>
}
