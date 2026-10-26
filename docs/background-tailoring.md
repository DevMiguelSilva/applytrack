# Background tailoring

Tailoring is owned by a provider above the routes. Each job captures its job-posting inputs, selected CV and claimed skills before requesting AI output. Requests continue while navigating within the mounted app. Reloading or closing the app ends in-memory work; successfully saved documents remain available.

The task runner exposes running, saving, completed and failed states. Duplicate starts are ignored for a busy job. Other jobs can generate independently. A failed save retains generated files for a save-only retry. Previous saved files remain available during a re-run. Success is announced only after document persistence finishes. Dismissing a running or saving task hides its panel without stopping generation or persistence; it stays hidden on success and reappears with the existing retry controls on failure. “View application” keeps its existing hide behavior.

Input changes, deletion and leaving Saved invalidate work. Account changes replace the runner and hide previous-account job/document state immediately. Retry saving validates the captured inputs again. Job updates patch changed database columns rather than upserting full captured rows; document saves merge with current document state. Job edits are ordered behind a dispatched document save so submitting cannot race that save. These are client-session safeguards; another browser/device is not coordinated, and an already-dispatched database request cannot be recalled after an account change. No database migration or persistent server task queue was added.

Cover-letter copying awaits the clipboard promise before announcing success. The existing Copy button remains unchanged. A two-second bottom notification restarts on another successful copy, sits above mobile navigation and disables its fade for reduced-motion preferences. Clipboard errors use the existing error feedback.

## Verification

- Background-task tests cover task lifecycle, simultaneous jobs, duplicate start/retry prevention, AI/save failures, save-only retry, stale input/account guards, immutable snapshots, current-state document merging, changed-column job patches, clipboard timing/errors/disposal, and early dismissal through success or failure.
- Production build passed; the existing bundle-size advisory remains.
- Full lint reports zero errors and warnings after PR #29; the production build retains the existing large-bundle advisory.
- Isolated browser preview used synthetic local jobs and mocked AI, with no production writes or real AI requests. Checked navigation to CVs/Board, simultaneous jobs, retained old files during re-run, notes edited during generation, selected-CV invalidation, submission during generation preserving stored application files, saved files after reload, actual clipboard success, mobile notification position/no overflow, and application ZIP containing both DOCX files.
- Real Supabase failure/retry, real account switching and actual browser-tab switching remain unverified end to end. Corresponding lifecycle/failure logic was tested with controlled mocks. Export content quality with real AI remains unverified.

The tailoring-dismiss change is validated in the current Build worktree; release status is tracked in the ApplyTrack project notes and its PR when opened.
