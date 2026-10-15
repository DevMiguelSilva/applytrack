import { randomUUID } from 'node:crypto'
import { AdzunaError, retryAfterSeconds } from '../../shared/adzunaErrors.js'
import { getAdzunaCredentials, type ServerEnv } from './env.js'

export interface AdzunaSearchParams {
  /** Exact phrase for Adzuna `what_phrase` (one term / title per saved search). */
  query: string
  location?: string
  country?: string
  maxDaysOld?: number
  excludeTerms?: string
  /** When true, also require the keyword "remote" without folding it into the phrase. */
  requireRemote?: boolean
  page?: number
  resultsPerPage?: number
}

export interface AdzunaJobResult {
  externalId: string
  company: string
  role: string
  location: string
  jobUrl: string
  salary: string
  description: string
  created: string
}

interface AdzunaApiJob {
  id: string | number
  title?: string
  description?: string
  created?: string
  redirect_url?: string
  salary_min?: number
  salary_max?: number
  company?: { display_name?: string }
  location?: { display_name?: string }
}

function formatSalary(min?: number, max?: number): string {
  if (!min && !max) return ''
  if (min && max) return `$${Math.round(min).toLocaleString()} – $${Math.round(max).toLocaleString()}`
  if (min) return `From $${Math.round(min).toLocaleString()}`
  return `Up to $${Math.round(max!).toLocaleString()}`
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

interface AdzunaRuntime {
  fetch: typeof fetch
  now: () => number
  sleep: (ms: number) => Promise<void>
  random: () => number
  attemptMs: number
  budgetMs: number
  log: (record: Record<string, unknown>) => void
}
const runtime: AdzunaRuntime = { fetch: (...args) => fetch(...args), now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), random: Math.random, attemptMs: 8000, budgetMs: 20000, log: record => console.info(JSON.stringify(record)) }

export async function searchAdzuna(params: AdzunaSearchParams, env: ServerEnv, requestId = randomUUID(), overrides: Partial<AdzunaRuntime> = {}): Promise<AdzunaJobResult[]> {
  const deps = { ...runtime, ...overrides }
  const started = deps.now()
  let attempts = 0, upstreamStatus: number | null = null, contentType = 'unknown', category = 'success'
  try {
    const validText = (value: unknown, max: number) => value === undefined || (typeof value === 'string' && value.length <= max)
    const positiveInt = (value: unknown, max: number) => value === undefined || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= max)
    if (!params || typeof params.query !== 'string' || !params.query.trim() || !validText(params.query, 200) || !validText(params.location, 200) || !validText(params.excludeTerms, 500) || !validText(params.country, 2) || (params.country !== undefined && !/^[a-z]{2}$/i.test(params.country)) || !positiveInt(params.maxDaysOld, 365) || !positiveInt(params.page, 1000) || !positiveInt(params.resultsPerPage, 50) || (params.requireRemote !== undefined && typeof params.requireRemote !== 'boolean')) {
      throw new AdzunaError('invalid_filters', 400, requestId)
    }
    let credentials: ReturnType<typeof getAdzunaCredentials>
    try { credentials = getAdzunaCredentials(env) } catch { throw new AdzunaError('configuration', 503, requestId) }
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/${(params.country || 'ca').toLowerCase()}/search/${params.page ?? 1}`)
    url.searchParams.set('app_id', credentials.appId)
    url.searchParams.set('app_key', credentials.appKey)
    url.searchParams.set('results_per_page', String(params.resultsPerPage ?? 25))
    url.searchParams.set('what_phrase', params.query.trim())
    if (params.requireRemote) url.searchParams.set('what_and', 'remote')
    if (params.location?.trim()) url.searchParams.set('where', params.location.trim())
    if (params.maxDaysOld) url.searchParams.set('max_days_old', String(params.maxDaysOld))
    if (params.excludeTerms?.trim()) url.searchParams.set('what_exclude', params.excludeTerms.trim())
    url.searchParams.set('sort_by', 'date')
    url.searchParams.set('content-type', 'application/json')

    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deps.budgetMs - (deps.now() - started)
      if (remaining <= 0) throw new AdzunaError('timeout', 504, requestId)
      attempts++
      upstreamStatus = null; contentType = 'unknown'
      const attemptStarted = deps.now()
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const work = async () => {
          const response = await deps.fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
          upstreamStatus = response.status
          const rawType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
          contentType = /^application\/(?:[\w.+-]+\+)?json$/.test(rawType) ? 'application/json' : rawType === 'text/html' ? 'text/html' : 'other'
          const delay = retryAfterSeconds(response.headers.get('retry-after'), deps.now())
          if (!response.ok) {
            void response.body?.cancel().catch(() => {})
            const code = response.status === 429 ? 'rate_limit' : [401,403].includes(response.status) ? 'provider_auth' : [400,404,422].includes(response.status) ? 'invalid_filters' : 'upstream'
            throw new AdzunaError(code, code === 'rate_limit' ? 429 : code === 'invalid_filters' ? 400 : 502, requestId, delay)
          }
          if (contentType !== 'application/json') { void response.body?.cancel().catch(() => {}); throw new AdzunaError('malformed_response', 502, requestId) }
          let data: unknown
          try { data = await response.json() } catch { throw new AdzunaError('malformed_response', 502, requestId) }
          const results = (data as { results?: unknown })?.results
          if (!Array.isArray(results) || results.some(job => !job || !['string','number'].includes(typeof job.id) || String(job.id).trim() === '' || ['title','description','created','redirect_url'].some(key => job[key] != null && typeof job[key] !== 'string') || ['salary_min','salary_max'].some(key => job[key] != null && (typeof job[key] !== 'number' || !Number.isFinite(job[key]))) || ['company','location'].some(key => job[key] != null && (typeof job[key] !== 'object' || (job[key].display_name != null && typeof job[key].display_name !== 'string'))))) {
            throw new AdzunaError('malformed_response', 502, requestId)
          }
          return (results as AdzunaApiJob[]).map(job => ({ externalId: String(job.id), company: job.company?.display_name?.trim() || 'Unknown company', role: job.title?.trim() || 'Untitled role', location: job.location?.display_name?.trim() || '', jobUrl: job.redirect_url || '', salary: formatSalary(job.salary_min, job.salary_max), description: stripHtml(job.description || ''), created: job.created || '' }))
        }
        return await Promise.race([work(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new AdzunaError('timeout', 504, requestId)) }, Math.min(deps.attemptMs, remaining))
        })])
      } catch (error) {
        const failure = error instanceof AdzunaError ? error : new AdzunaError(controller.signal.aborted ? 'timeout' : 'network', controller.signal.aborted ? 504 : 503, requestId)
        deps.log({ event: 'adzuna_attempt', requestId, durationMs: deps.now() - attemptStarted, attempt: attempts, upstreamStatus, contentType, category: failure.code })
        const canRetry = ['network','timeout'].includes(failure.code) || (failure.code === 'upstream' && [502,503,504].includes(upstreamStatus ?? 0))
        const delayMs = failure.retryAfterSeconds !== undefined ? failure.retryAfterSeconds * 1000 : 200 + Math.floor(deps.random() * 300)
        if (attempt > 0 || !canRetry || delayMs + deps.attemptMs > deps.budgetMs - (deps.now() - started)) throw failure
        if (timer) clearTimeout(timer)
        await deps.sleep(delayMs)
      } finally { if (timer) clearTimeout(timer) }
    }
    throw new AdzunaError('upstream', 502, requestId)
  } catch (error) {
    const failure = error instanceof AdzunaError ? error : new AdzunaError('upstream', 502, requestId)
    category = failure.code
    throw failure
  } finally {
    deps.log({ event: 'adzuna_search', requestId, durationMs: deps.now() - started, attempts, upstreamStatus, contentType, category })
  }
}
