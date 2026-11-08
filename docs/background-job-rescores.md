# Background job rescores

Job rescores run from `JobRescoreProvider`, which stays mounted above the route pages. It uses the shared `BackgroundTasks` lifecycle for in-memory progress, same-job deduplication, account epochs, stale-run invalidation, and retrying a failed save without repeating parsing. `JobRescoreProgress` keeps progress and retry available while the user visits another route.

Each run captures the saved job's description, parse fallback fields, account, job revision, selected CV track, and selected CV content. The generated score is written only while those inputs still match. `JobsProvider.updateJob` invokes its optional validator with the latest queued job record before applying a patch, so a queued edit or deletion can stop a stale rescore from being saved. The rescore provider also checks the current CV snapshot before saving. A parse failure offers a full retry; a persistence failure retains the calculated score for a save-only retry.

Tasks exist only in memory while the app is mounted. They do not survive reload, browser closure, or device or operating-system suspension. Browsers may pause background work while a tab is inactive; when execution resumes, the task continues or reports a retryable error.
