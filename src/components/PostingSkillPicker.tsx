import { useEffect, useMemo, useState } from 'react'
import type { CvTrack } from '../types/cv'
import { useMasterCv } from '../hooks/useMasterCv'
import { addPostingSkillsToCv } from '../lib/addPostingSkills'

interface PostingSkillPickerProps {
  skills: string[]
  track: CvTrack
  heading?: string
  disabled?: boolean
}

const keyOf = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export function PostingSkillPicker({ skills, track, heading = 'Skills from the posting', disabled = false }: PostingSkillPickerProps) {
  const { getCv, getLabel, saveTrackCv, loading: cvLoading, loadError } = useMasterCv()
  const cv = getCv(track)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keys = useMemo(() => skills.map(keyOf).join('|'), [skills])
  useEffect(() => { setSelected([]) }, [track, keys])

  const cvSkills = useMemo(() => new Set(cv?.skills.flatMap((group) => group.items.map(keyOf)) ?? []), [cv])
  const toggle = (skill: string) => {
    const key = keyOf(skill)
    setSelected((current) => current.some((item) => keyOf(item) === key)
      ? current.filter((item) => keyOf(item) !== key)
      : [...current, skill])
  }
  const addSelected = async () => {
    if (!cv || !selected.length || disabled || saving) return
    setSaving(true)
    setError(null)
    try {
      const next = addPostingSkillsToCv(cv, selected)
      await saveTrackCv(track, next)
      setSelected([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this CV.')
    } finally {
      setSaving(false)
    }
  }

  if (!skills.length) return null
  const locked = disabled || cvLoading || Boolean(loadError) || !cv
  return (
    <fieldset className="mt-2 min-w-0" disabled={locked || saving}>
      <legend className="ui-label legacy-size-text_sm">{heading}</legend>
      <p className="mt-1 ui-helper text-brand-muted legacy-size-text_xs">Select skills you can accurately include, then add them to {getLabel(track)}.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {skills.map((skill) => {
          const alreadyOnCv = cvSkills.has(keyOf(skill))
          const picked = selected.some((item) => keyOf(item) === keyOf(skill))
          return (
            <button
              key={skill}
              type="button"
              aria-pressed={alreadyOnCv || picked}
              disabled={alreadyOnCv}
              onClick={() => toggle(skill)}
              title={alreadyOnCv ? 'Already on this CV' : picked ? 'Selected to add' : `Select ${skill} to add to this CV`}
              className={`rounded-lg border px-2.5 py-1 ui-body legacy-size-text_sm ${alreadyOnCv ? 'border-brand-line bg-[#f4faf8] text-brand-muted' : picked ? 'border-brand-primary bg-brand-mist text-brand-ink' : 'border-brand-line bg-white text-brand-ink hover:border-brand-primary'}`}
            >
              {skill}{alreadyOnCv ? ' · On CV' : ''}
            </button>
          )
        })}
      </div>
      {(selected.length > 0 || error) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="ui-button ui-secondary legacy-size-text_sm" onClick={() => void addSelected()} disabled={!selected.length || saving || locked}>
            {saving ? 'Adding…' : `Add ${selected.length || ''} selected to ${getLabel(track)}`}
          </button>
          {error && <p className="ui-helper !text-red-700 legacy-size-text_sm" role="alert">{error}</p>}
        </div>
      )}
      {loadError && <p className="mt-2 ui-helper !text-red-700 legacy-size-text_sm" role="alert">{loadError}</p>}
    </fieldset>
  )
}
