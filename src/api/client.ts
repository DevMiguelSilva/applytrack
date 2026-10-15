import { AdzunaError, adzunaMessages, retryAfterSeconds } from '../../shared/adzunaErrors'

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`
    )
  }
  return data as T
}

export interface AdzunaClientJob {
  externalId: string
  company: string
  role: string
  location: string
  jobUrl: string
  salary: string
  description: string
  created: string
}

export interface AdzunaFilters {
  query: string
  location?: string
  country?: string
  maxDaysOld?: number
  excludeTerms?: string
  requireRemote?: boolean
}
export interface AdzunaSearchResponse { results: AdzunaClientJob[]; requestId: string }

/** Deliberately separate from Gemini: long-running tailoring keeps its existing policy. */
export async function fetchAdzunaSearch(params: AdzunaFilters, request: typeof fetch = fetch, timeoutMs = 25000): Promise<AdzunaSearchResponse> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const work = async () => {
      const response = await request('/api/adzuna/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(params), signal: controller.signal })
      let data: unknown
      const jsonResponse = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      if (jsonResponse) {
        try { data = await response.json() } catch { /* Never display proxy/provider text. */ }
      }
      const value = data as { results?: unknown; requestId?: unknown; error?: { code?: string; requestId?: unknown; retryAfterSeconds?: unknown } } | undefined
      const reference = (id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9_:.-]{1,100}$/.test(id) ? id : ''
      if (!jsonResponse) void response.body?.cancel().catch(() => {})
      if (!response.ok) {
        const error = value?.error
        const code = error && Object.prototype.hasOwnProperty.call(adzunaMessages, error.code ?? '') ? error.code as keyof typeof adzunaMessages : response.status === 429 ? 'rate_limit' : response.status === 504 ? 'timeout' : response.status === 400 ? 'invalid_filters' : 'upstream'
        const delay = typeof error?.retryAfterSeconds === 'number' && Number.isSafeInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 0 ? error.retryAfterSeconds : retryAfterSeconds(response.headers.get('retry-after'))
        throw new AdzunaError(code, response.status, reference(error?.requestId) || reference(response.headers.get('x-vercel-id')), delay)
      }
      if (!Array.isArray(value?.results) || value.results.some(job => !job || ['externalId','company','role','location','jobUrl','salary','description','created'].some(key => typeof job[key] !== 'string'))) {
        throw new AdzunaError('malformed_response', 502, reference(value?.requestId))
      }
      return { results: value.results as AdzunaClientJob[], requestId: reference(value.requestId) }
    }
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new AdzunaError('timeout', 504)) }, timeoutMs)
    })])
  } catch (error) {
    if (error instanceof AdzunaError) throw error
    throw new AdzunaError(controller.signal.aborted ? 'timeout' : 'network', controller.signal.aborted ? 504 : 503)
  } finally { if (timer) clearTimeout(timer) }
}
export async function fetchAdzunaJobs(params: AdzunaFilters): Promise<AdzunaClientJob[]> {
  return (await fetchAdzunaSearch(params)).results
}

export async function callGemini<T>(body: Record<string, unknown>): Promise<T> {
  const data = await apiPost<{ result: T }>('/api/gemini', body)
  return data.result
}
