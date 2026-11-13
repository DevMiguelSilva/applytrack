import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseConfigured } from '../lib/supabase'
import { boardLook } from '../components/BoardLook'

const focusClass = "ui-focus"
const inputClass = "ui-field mt-1.5 legacy-size-text_sm"

export function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
        setMessage('Account created! Check your email to confirm, then sign in.')
        setMode('signin')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
        <section className="auth-welcome-panel flex flex-col justify-between gap-6 rounded-3xl border border-brand-line bg-brand-mist p-6 sm:p-9 lg:gap-5 lg:p-8">
          <div>
            <p className="ui-label font-semibold uppercase tracking-[0.12em]">Your job search, organized</p>
            <h1 className="mt-4 font-display text-3xl font-bold leading-tight text-brand-ink sm:text-4xl">Make every next step easier.</h1>
            <p className="mt-4 max-w-lg ui-description">Keep applications, interviews, and the CVs you share together in one clear workspace.</p>
          </div>
          <ul className="grid gap-3 text-sm font-medium text-brand-ink sm:grid-cols-3 lg:grid-cols-1">
            <li className="rounded-2xl border border-white/80 bg-white/75 p-4">See every opportunity and its next step.</li>
            <li className="rounded-2xl border border-white/80 bg-white/75 p-4">Keep tailored documents with each application.</li>
            <li className="rounded-2xl border border-white/80 bg-white/75 p-4">Pick up your search when you are ready.</li>
          </ul>
        </section>
        <section className="ui-panel flex flex-col justify-center p-6 sm:p-9 lg:p-8" aria-labelledby="local-workspace-title">
          <p className="ui-label font-semibold uppercase tracking-[0.12em]">Local workspace</p>
          <h2 id="local-workspace-title" className="mt-3 ui-title legacy-size-text__1_75rem_">Your workspace is ready</h2>
          <p className="mt-3 ui-description">Track your applications on this device. Your changes are saved locally.</p>
          <a href="/" className={`mt-7 w-full sm:w-auto ${boardLook.button} ${focusClass}`}>Continue to Board</a>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl min-w-0 grid-cols-1 gap-5 font-sans text-brand-ink sm:gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
      <section className="auth-welcome-panel flex flex-col justify-between gap-6 rounded-3xl border border-brand-line bg-brand-mist p-6 sm:p-9 lg:gap-5 lg:p-8">
        <div>
          <p className="ui-label font-semibold uppercase tracking-[0.12em]">Your job search, organized</p>
          <h1 className="mt-4 font-display text-3xl font-bold leading-tight text-brand-ink sm:text-4xl">Make every next step easier.</h1>
          <p className="mt-4 max-w-lg ui-description">Keep applications, interviews, and the CVs you share together in one clear workspace.</p>
        </div>
        <ul className="grid gap-3 text-sm font-medium text-brand-ink sm:grid-cols-3 lg:grid-cols-1">
          <li className="rounded-2xl border border-white/80 bg-white/75 p-4">See every opportunity and its next step.</li>
          <li className="rounded-2xl border border-white/80 bg-white/75 p-4">Keep tailored documents with each application.</li>
          <li className="rounded-2xl border border-white/80 bg-white/75 p-4">Pick up your search when you are ready.</li>
        </ul>
      </section>
      <section className="ui-panel flex flex-col justify-center p-6 sm:p-9 lg:p-8" aria-labelledby="auth-form-title">
          <div className="mb-6">
            <p className="ui-label font-semibold uppercase tracking-[0.12em]">ApplyTrack account</p>
            <h2 id="auth-form-title" className={`mt-3 ${boardLook.headline}`}>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
            <p className="mt-2 ui-description legacy-size-text_sm">{mode === 'signin' ? 'Sign in to sync across devices' : 'Keep your job search in sync across devices'}</p>
          </div>
          <div className="flex gap-1 rounded-xl bg-brand-mist p-1" role="group" aria-label="Account access">
            <button
              type="button"
              disabled={loading}
              aria-pressed={mode === 'signin'}
              onClick={() => { setMode('signin'); setError(null); setMessage(null) }}
              className={`${`flex-1 rounded-lg py-2 text-sm font-semibold transition disabled:opacity-60 ${focusClass} ${
                mode === 'signin' ? 'bg-white text-brand-ink shadow-sm' : 'text-brand-muted hover:text-brand-ink'
              }`} ui-filter`}
            >
              Sign in
            </button>
            <button
              type="button"
              disabled={loading}
              aria-pressed={mode === 'signup'}
              onClick={() => { setMode('signup'); setError(null); setMessage(null) }}
              className={`${`flex-1 rounded-lg py-2 text-sm font-semibold transition disabled:opacity-60 ${focusClass} ${
                mode === 'signup' ? 'bg-white text-brand-ink shadow-sm' : 'text-brand-muted hover:text-brand-ink'
              }`} ui-filter`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" aria-busy={loading}>
            {error && (
              <p role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 ui-helper !text-red-700 legacy-size-text_sm">{error}</p>
            )}
            {message && (
              <p role="status" className="rounded-lg border border-brand-primary/25 bg-brand-mist p-3 ui-helper !text-brand-ink legacy-size-text_sm">{message}</p>
            )}

            <label className="ui-label block">
              <span className="ui-label font-medium text-brand-muted legacy-size-text_sm">Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
              />
            </label>

            <label className="ui-label block">
              <span className="ui-label font-medium text-brand-muted legacy-size-text_sm">Password</span>
              <input
                type="password"
                name="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className={inputClass}
              />
            </label>

            <button type="submit" disabled={loading} className="ui-button ui-primary">
              {loading ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>
      </section>
    </div>
  )
}
