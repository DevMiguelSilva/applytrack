import { useState } from 'react'
import { AppLogo } from '../components/AppLogo'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseConfigured } from '../lib/supabase'
import { boardLook } from '../components/BoardLook'

const focusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2'
const inputClass = 'mt-1.5 w-full rounded-lg border border-brand-line bg-white px-3 py-2.5 text-sm text-brand-ink outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25 disabled:bg-brand-mist disabled:text-brand-muted'

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
      <div className="mx-auto max-w-md py-6 sm:py-10">
        <div className={`${boardLook.card} p-6 text-center sm:p-8`}>
          <div className="mb-4 flex justify-center"><AppLogo tone="brand" /></div>
          <p className={`mb-2 ${boardLook.label}`}>ApplyTrack</p>
          <h1 className={boardLook.headline}>Your workspace is ready</h1>
          <p className={`mt-3 ${boardLook.body}`}>Track your applications on this device. Your changes are saved locally.</p>
          <a href="/" className={`mt-6 ${boardLook.button} ${focusClass}`}>Continue to Board</a>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md py-6 font-sans text-brand-ink sm:py-10">
      <div className={`${boardLook.card} p-6 sm:p-8`}>
        <div>
          <div className="mb-6 flex items-center gap-3">
            <AppLogo tone="brand" />
            <div>
              <p className={`mb-1 ${boardLook.label}`}>ApplyTrack</p>
              <h1 className={boardLook.headline}>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
              <p className="mt-2 text-sm text-brand-muted">{mode === 'signin' ? 'Sign in to sync across devices' : 'Keep your job search in sync across devices'}</p>
            </div>
          </div>

          <div className="flex gap-1 rounded-xl bg-brand-mist p-1" role="group" aria-label="Account access">
            <button
              type="button"
              disabled={loading}
              aria-pressed={mode === 'signin'}
              onClick={() => { setMode('signin'); setError(null); setMessage(null) }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition disabled:opacity-60 ${focusClass} ${
                mode === 'signin' ? 'bg-white text-brand-ink shadow-sm' : 'text-brand-muted hover:text-brand-ink'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              disabled={loading}
              aria-pressed={mode === 'signup'}
              onClick={() => { setMode('signup'); setError(null); setMessage(null) }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition disabled:opacity-60 ${focusClass} ${
                mode === 'signup' ? 'bg-white text-brand-ink shadow-sm' : 'text-brand-muted hover:text-brand-ink'
              }`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" aria-busy={loading}>
            {error && (
              <p role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>
            )}
            {message && (
              <p role="status" className="rounded-lg border border-brand-primary/25 bg-brand-mist p-3 text-sm text-brand-ink">{message}</p>
            )}

            <label className="block">
              <span className="text-sm font-medium text-brand-muted">Email</span>
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

            <label className="block">
              <span className="text-sm font-medium text-brand-muted">Password</span>
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

            <button type="submit" disabled={loading} className={`w-full ${boardLook.button} ${focusClass} disabled:cursor-wait disabled:opacity-60`}>
              {loading ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
