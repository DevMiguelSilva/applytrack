# Inbox search reliability

## Focus and authentication refresh

An authentication event can replace the user object while keeping the same account ID. Previously that restarted the saved-search provider, cleared its search list and caused an in-flight Inbox refresh to invalidate its results. Saved-search loading now depends on the account ID and keeps each owner's searches isolated. Inbox refresh completion also uses a generation guard so an older request cannot clear a newer refresh after an account switch. The job-review focus change already stabilized CV loading on same-account auth updates; it did not stabilize the separate saved-search provider. This is a reproduced code path, not confirmation that it caused the reported browser incident.

The app cannot run JavaScript while its page is suspended by the browser or operating system. The existing Adzuna timeout and partial-result/save-only retry behavior apply when execution resumes. If an Inbox save has not settled when its 20-second timer fires, the fetched batch remains in memory; the timer can be delayed while the page is suspended. A stalled cloud read can be revoked and retried without a new provider request. Its late response is checked before any further writes, and cannot affect the newer attempt. If a write is outstanding, the summary reports that its outcome is unknown. The original operation is observed until it settles; additional Inbox refreshes and writes are blocked in the meantime, including after account changes, so an already dispatched database write cannot overlap a retry. A late success updates the summary; a late failure makes save-only retry available. Changing the account or search invalidates the old batch and prevents late results from being displayed for the new context.

An already dispatched write can still commit even if the app loses its response. If that operation never settles, the app cannot know it is safe to retry in this session, so it continues to show the unknown status and holds the write barrier. Reloading closes the session and loses the in-memory batch; it cannot recall the remote write. This is not a cross-device lock. Automated tests use delayed mocked requests, not a suspended browser or live services.

## Save conflict correction (October 16, 2026; local implementation)

The user reports Supabase error `23505`, establishing a unique constraint violation. The exact deployed constraint/request was not inspected. A controlled database mock reproduces `23505` when the old default-ID upsert sends a different row ID for an existing `(user_id, external_id)` listing, matching the repository schema. Missing/limited loaded history and partially committed attempts can expose that mismatch; which triggered the live incident remains unverified.

On `codex/inbox-save-diagnostics`, fetched cloud batches reconcile against paginated persisted state rather than assuming the loaded UI list is complete. Inserts use `user_id,external_id` with conflicts ignored, preserving a concurrent insert's identity and reviewed status. Existing review rows update by persisted ID with `status=new` guards; approved/dismissed rows are never refreshed. Pruning follows successful writes and still filters `status=new`. A final read returns canonical identities and current history. Retry repeats reconciliation, so a partially committed save cannot generate duplicate listings. This adds cloud reads and conditional per-row updates; no provider calls or migration are added.

Persistence boundaries distinguish upsert, pruning and browser storage failures. Fixed actionable messages include a stage/category reference; raw database responses, error messages and job contents are not copied into the report. Pruning failures disclose that rows may already have saved. Retained batches, save-only retry and account/search guards remain in place. Invalidation exceptions pass through diagnostics unchanged. Already-dispatched writes cannot be recalled, and cloud operations remain nontransactional.

35 Node tests pass. New persistence tests reproduce the old uniqueness conflict, verify canonical IDs/repeated saves, hidden reviewed history, concurrent insertion and approval, partial commit/pruning recovery, read failure and stale-request invalidation, pagination, safe diagnostics and local-storage boundary recovery. The mocked cloud store survives rereads; retry uses only retained rows and persistence operations. These tests do not establish browser/hook end-to-end recovery, real PostgREST/RLS behavior or live cloud success. Build passes with the existing chunk warning. Full lint reports the recorded five existing errors and twelve warnings, with no new findings. No real provider/database calls, migration, push, PR or release were performed. Live authenticated and browser acceptance verification remain disclosed limits for Release review.

## Findings (October 15, 2026)

Confirmed in the previous implementation: Adzuna error bodies were interpolated into user-visible errors; requests were unbounded; all upstream errors became HTTP 500; a single failed location discarded prior successes; pruning and persistence used refresh-start Inbox arrays.

The iPhone-specific cause is unproven. The authenticated Vercel dashboard showed no runtime entries in the available last-hour window. Longer windows require an upgrade. Adzuna's usage dashboard was signed out. No evidence established a particular provider status, exhausted quota window, or Wi-Fi/cellular issue. No real Adzuna refreshes were made during this verification.

Adzuna's [published default limits](https://developer.adzuna.com/docs/terms_of_service) currently include 25 hits/minute, 250/day, 1,000/week and 2,500/month. Actual account limits and usage were not inspected. The app must not promise a one-minute reset.

## Request behavior

- Errors use fixed safe messages and codes, request IDs, retryability and an optional provider retry delay. Validation, configuration/auth, quota, network, upstream, timeout and malformed responses are distinct. Raw provider messages, HTML, stack traces and credential setup instructions are never returned by the Adzuna handler.
- Requests explicitly accept JSON and validate response structure. Missing optional listing values remain valid; an empty results array means no matches.
- Each upstream attempt is bounded at eight seconds including response reading. There is at most one retry for network/timeout/502/503/504, with short jitter or valid Retry-After and a twenty-second total server budget. Quota/auth/validation/malformed responses have no automatic retry. Long Retry-After delays are returned instead of waiting beyond the budget.
- Only the Adzuna function receives a thirty-second Vercel max duration. Its browser path has a twenty-five-second timeout and safely handles intermediary non-JSON failures and unexpected success formats. Gemini's existing request policy remains unchanged.
- Structured server logs record request ID, attempt count, duration, upstream status, normalized content type and failure category. Failed attempts and the final outcome are logged, without raw URLs, credentials, search filters or response bodies.

## Refresh and persistence

Requests run sequentially, with identical filters deduplicated within a refresh and overlapping starts blocked. Outcomes are tracked by saved search and location. Successful partial results merge without pruning prior review jobs or touching approval/dismissal history. A complete nonempty refresh may remove absent review jobs; Run alone only replaces the prior review set after full success. Empty or all-failed refreshes preserve the Inbox.

Failed-only retry retains prior successful outcomes and requests only failed/not-run combinations with unchanged filters and selected tracks. Quota/auth/configuration failure stops remaining requests, explaining which locations were not run. A valid quota retry delay also blocks further calls during that in-session cooldown; no unknown reset time is invented.

Inbox writes are serialized and merged against current state, preserving approvals/dismissals made during requests. Cloud writes upsert changed rows before pruning and only delete review rows. A persistence failure retains fetched rows for save-only retry in memory; leaving the mounted app or refreshing the browser loses unsaved batches. Account changes and edited/deleted search filters invalidate work and retries. These safeguards coordinate this app session, not other devices, and cannot recall an already-dispatched database request.

## Verification

- All 27 Node tests passed, including eight new request/refresh tests for HTML/malformed JSON/empty data, optional null values, retry bounds, timeouts, safe logs, quota cooldowns, proxy headers, partial locations, deduplication, overlapping starts, invalidation and current-state merging.
- Production build passed. Full lint retains the same five existing errors and twelve existing warnings; no new lint findings in this change.
- Isolated local browser checks used synthetic records and mocked API responses: duplicate filters, partial results, failed-only retry, simulated storage failure and save-only retry, empty responses, intermediary HTML errors, slow refresh, concurrent dismissal and approval, and a 390px mobile layout without horizontal overflow. The fixture server was separate from existing app origins and no production records were changed.
- Real iPhone Safari, work Wi-Fi versus cellular, actual offline mode, historical provider failures, real quota/auth failures and cloud persistence failure recovery remain unverified end to end. Network/timeout/provider failure behavior was covered with controlled mocks. Supabase persistence ordering was inspected, with local storage failure exercised in the browser.

No database migration, worker or new server endpoint was added. Not pushed, merged or deployed as part of this task.
