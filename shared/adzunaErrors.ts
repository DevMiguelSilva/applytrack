export const adzunaMessages = {
  invalid_filters: 'Check the search phrase, location, country and date filters.',
  configuration: 'Job search is temporarily unavailable. Please try again later.',
  provider_auth: 'The job provider could not authorize this search. Please try again later.',
  rate_limit: 'The job provider’s usage limit has been reached. Try again later; the reset time is not available unless shown below.',
  upstream: 'The job provider is temporarily unavailable. Your existing jobs are safe.',
  timeout: 'The job search took too long. Check your connection and try the failed searches again.',
  network: 'Could not connect to job search. Check your connection and try again.',
  malformed_response: 'Job search returned an unexpected response. Your existing jobs are safe.',
} as const
export type AdzunaErrorCode = keyof typeof adzunaMessages
export interface AdzunaFailure {
  code: AdzunaErrorCode
  message: string
  requestId: string
  retryable: boolean
  retryAfterSeconds?: number
}
export class AdzunaError extends Error {
  constructor(public code: AdzunaErrorCode, public status: number, public requestId = '', public retryAfterSeconds?: number) {
    super(adzunaMessages[code])
    this.name = 'AdzunaError'
  }
  get retryable() { return ['network', 'timeout', 'upstream', 'rate_limit'].includes(this.code) }
  get stopsRefresh() { return ['rate_limit', 'provider_auth', 'configuration'].includes(this.code) }
  envelope(): { error: AdzunaFailure } {
    return { error: { code: this.code, message: this.message, requestId: this.requestId, retryable: this.retryable, ...(this.retryAfterSeconds !== undefined ? { retryAfterSeconds: this.retryAfterSeconds } : {}) } }
  }
}
export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value.trim())) {
    const seconds = Number(value)
    return Number.isSafeInteger(seconds) ? seconds : undefined
  }
  const date = Date.parse(value)
  return Number.isFinite(date) && date >= now ? Math.ceil((date - now) / 1000) : undefined
}
