# Job review Trash confirmation

Implemented in isolated C:\Dev\Projects\applytrack-trash-dialog, branch codex/job-trash-confirmation, base73dc020. Only Job Detail's recoverable Trash entry replaces its browser confirm. Board-card/Empty trash/permanent purge prompts and stored data formats remain.

## Behavior

The native HTML dialog uses ui-panel/ui-dialog, an18px historical-context title,14px body, white/red-outline confirmation and neutral Cancel. Names are plain JSX text with fallbacks and anywhere wrapping. Mobile equal action columns become right-aligned desktop actions. Height is viewport-bounded and scrollable for long names. showModal supplies background inertness; explicit Tab/Shift+Tab wrapping keeps action focus contained. Cancel initially focused; Cancel/Escape before submission return focus to trigger. No backdrop handler, so backdrop does not dismiss or submit.

Target ID/account are captured on open. Hooks/effects live before missing-job return. A synchronous ref blocks duplicate dispatch and dismissal, disables both actions and exposes Sending…/aria-busy. Failed persistence keeps the review/dialog, fixed retryable alert and reenables actions; reopening/retry clears errors. Route/account/missing/unrelated-trashed updates invalidate attempts, hide the dialog and prevent stale error/navigation. Unmount invalidates completion.

Existing deleteJob still calls the serialized/account-guarded updateJob soft-delete path. Its optional validator now receives the operation's deletedAt stamp and is run by updateJob immediately before persistence; deleteJob returns that stamp after success. The page remembers the expected stamp to distinguish its own committed Trash update from an unrelated update. Navigation to Board occurs only when that matching committed job is rendered and route/account/attempt still belong to the target. Existing callers ignore the new return value and require no changes. No changes to purge/restore persistence, documents, snapshots or provider/schema behavior. Already dispatched database writes cannot be recalled.

## Verification (2026-10-17)

Disposable origin5300 imports actual app/components, blank Supabase environment, workspace-only synthetic seed and mock delay/failure gateway. Fixture transforms only add delay/failure before the real hook and controlled account/route/missing/trashed buttons; source contains no test controls. User preview5188 and other owned checkouts were not changed.

- Opening exposes labeled/described dialog, Cancel focus and no gateway call. Names containing angle brackets/ampersands render as text. Cancel/Escape restore Move to trash focus and keep review. Tab/reverse Tab explicitly wrap after an initial check exposed a native boundary issue that was repaired.
- Pending Cancel/confirm disabled; Escape and Enter do not dismiss or dispatch duplicates. A deliberate failure displays fixed alert, leaves review and reenables actions. Cancel after failure works; separate same-dialog retry succeeds after mock failure removed.
- Success navigates to Board only after persistence; correct job appears in recoverable Trash and Restore works. Fixture comparison confirmed status/notes/interviews/description unchanged on delete and restore. Submitted snapshots/tailored docs are source-preserved (neither store is touched); their full lifecycle was not newly exercised in this flow.
- Controlled account change, client-side route change, missing target and externally trashed target during pending invalidate without stale navigation/error. Missing/trashed dialogs close immediately; queued validation stops stale writes. Account mock changes the page hook only; provider's real owner guards remain source-reviewed and not live-cloud tested. Ten gateway invocations represent deliberate independent slow/failure/success/stale scenarios; extra pending Enter did not add one.
- Desktop1280, mobile390/360 and360x320 short viewport inspected. Long unbroken role/company strings wrap without horizontal overflow; long dialog height288 fits320 and scrolls internally. Title18px, body14px, standard buttons retain44px. Backdrop behavior source-reviewed (no handler); native inert accessibility tree verified.
- Existing Node suite36 pass. Build passes with existing chunk warning; lint retains five existing errors/twelve warnings. Whitespace passes. No new provider/database calls, migrations, push/PR/release.

Screenshots ui-job-trash-confirmation.png and ui-trash-dialog-failure.png and fixture files remain in chat workspace. Real Safari, assistive technology and live cloud/account-switch behavior remain unverified.

## Independent Release review (2026-10-17)

Release inspected both source diffs against the approved scope and the serialized updateJob path. The optional validation executes inside the existing queue before persistence; account ownership is rechecked after cloud completion. No purge, restore, document-store, schema or provider logic changes. Main remains73dc020 at review.

Independent36 Node tests/build/whitespace pass. Build retains its large-chunk warning; full lint retains the recorded five errors/twelve warnings (useJobs _interviewStage, applyStreak/huntStreak prefer-const, docxExport no-control-regex, matchScore _roleHint). No new lint finding.

Separate disposable5302 fixture independently verified initial Cancel focus, forward/reverse Tab wrap, Escape/trigger restoration, disabled pending actions/Escape/extra Enter producing one gateway invocation, fixed failure/reopened-error clearing, successful soft-delete/navigation and Restore. Normalized status/notes/interviews/description were preserved (fixture comparison canonicalized object keys, because existing interview normalization changes key order). At390px action widths equal and title/body18px/14px; at360x320 extreme names the dialog is288px tall with internal vertical scroll and no internal horizontal overflow. The underlying pre-existing Job Detail heading can overflow for these extreme unbroken names; this patch confines the dialog itself. Release source-reviewed stale attempt/account/route guards; Build's controlled stale-context cases were not independently rerun. Submitted/tailored stores remain source-reviewed, not newly lifecycle-tested. No live cloud/auth/Safari/assistive technology verification. No real database/provider calls.

Review-only5302 stopped; existing user5301/5188 servers/storage retained. Workspace screenshot release-trash-review.png and fixture files are excluded from Git. Rollback is a normal PR revert; no migration/data rollback required.