# ApplyTrack agent instructions

## Shared context

Before project work, read the canonical Obsidian note:

`C:\Users\migue\Documents\ChatGPT\ApplyTrack\ApplyTrack Agents.md`

It contains the project overview, agent roles, working agreements, release status and known limitations. Verify Git and relevant source files before relying on recorded status. If the vault is unavailable on another machine, use `README.md`, `DEPLOY.md` and `docs/` as fallback context and report that the shared note could not be refreshed; do not invent its contents.

After material decisions, implementation, verification or deployment, reread the note and update the relevant sections with observed facts and remaining issues. Preserve concurrent edits. Never put credentials, tokens, private CV contents or application records into shared context. Keep routine/no-op activity out of the note.

## Work and releases

- Preserve unrelated work. Use `codex/` branches and explicitly stage task files.
- Group related changes together. Keep dependent changes in one branch or clearly described stacked branches; reuse existing commits.
- Run checks appropriate to the change. Application checks: `node --test tests/*.test.mjs`, `npm run build`, `npm run lint`. Distinguish pre-existing lint failures. Documentation-only changes need content/link checks, not app tests or real API calls.
- Standing user workflow: commit, push relevant branches, merge into `origin/main`, and verify automatic Vercel production deployment without routine reconfirmation. Explicit task-specific prepare-only/no-push/no-merge/no-deploy instructions override this standing workflow.
- Keep committed, pushed, merged, deployed and functionally verified status distinct. A push alone does not establish production deployment. Local testing is the normal workflow; previews are optional unless the task requires them.
- Do not infer authorization for force pushes, history rewrites, destructive data operations, credential changes or messages to other chats from routine release authorization.

## Product safeguards

- Preserve submitted-document snapshots and existing tailored drafts.
- Keep API keys server-side. Adzuna errors/logs must not expose upstream bodies, full URLs or credentials.
- Keep Adzuna's bounded-request policy separate from Gemini background tailoring.
- Preserve approved/dismissed Inbox history during refresh; protect current state against stale asynchronous results and account changes.

Read the shared note and feature documents for current details instead of assuming every chat has the same conversation history.
