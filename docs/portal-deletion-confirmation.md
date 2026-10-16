# Saved portal deletion confirmation

Both the desktop Delete action and mobile edit-form Delete action open a styled
native modal dialog before calling the existing `deleteFeed`. The dialog identifies
the saved portal (using Untitled feed for a blank name), initially focuses Cancel,
and supports Escape cancellation. Backdrop clicks leave it open. Cancellation
preserves drafts and returns focus to the initiating button.

Confirmation deletes only the selected ID. A synchronous guard prevents duplicate
requests while pending; both buttons and Escape dismissal are blocked until the
request settles. Errors appear inside the dialog as an alert, allowing retry or
cancel. Success closes the dialog, clears editing only for that portal and focuses
Add portal feed. An open Add form is collapsed on success without clearing its draft.
No persistence, API, schema or dependency changes are included.

## Local verification — 2026-10-16

- Existing Node suite: 27/27 passed.
- Production build passed with the existing large-chunk warning.
- Full lint: the recorded five existing errors and twelve warnings remain;
  targeted lint of PortalsPage and IconAction passed.
- Headless Edge/Playwright with a mocked `usePortalFeeds` verified desktop and
  390px mobile entry points, active/paused feeds, blank and long saved names,
  initial/cancellation/success focus, backdrop behavior, no deletion calls on
  open/Cancel/Escape, preservation of unsaved edits, selected-ID deletion,
  pending duplicate/dismissal prevention, error alert and successful retry.
- A long unbroken name wrapped within the 390px dialog without horizontal dialog
  overflow; the screenshot was visually inspected.
- Browser harness and screenshot are local chat-workspace artifacts, outside the
  repository: `portal-delete-check.cjs` and `portal-delete-mobile.png`.

These checks used mocked persistence and disposable names only. They do not verify
real Supabase deletion, Safari/iPhone behavior, a hosted preview or production.
Existing persistence semantics, including optimistic local state changes on a
local-storage write failure, are unchanged. Release review and deployment remain
pending.

User-requested layout refinement: modal margins override parent spacing to center the dialog. Mobile buttons share an equal-width row with minimum 44px targets; desktop buttons align right. Mocked browser checks also assert desktop/mobile centering and mobile button geometry (2026-10-16).
