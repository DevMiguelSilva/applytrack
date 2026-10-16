# ApplyTrack agent instructions

## Shared context

Before project work, read the canonical Obsidian note:

`C:\Dev\Obsidian Vault\ApplyTrack\ApplyTrack Agents.md`

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

## Required context workflow for every ApplyTrack task

At the start of every project-related turn, including resumed work after a handoff or compaction:
1. Read the canonical note from disk, even if an earlier turn already read it: `C:\Dev\Obsidian Vault\ApplyTrack\ApplyTrack Agents.md`.
2. Identify your chat's role from its Agent roles section. Follow current user instructions and approved scope; do not treat another chat's history as your own.
3. Before code or Git actions, read `C:\Dev\Projects\applytrack\AGENTS.md` and inspect current repository state. Verify any recorded facts that affect the task.

Before the final response or a handoff, and at each completed material milestone:
1. Reread the canonical note immediately before editing it. Apply focused edits to the latest contents; do not overwrite it from an earlier snapshot. If concurrent edits are detected, reread and reconcile them.
2. Update relevant decisions, current work, checks, unresolved issues and release evidence. Distinguish planned, implemented, committed, pushed, merged, deployed and verified. Include branch/commit references when available.
3. Record a concise dated activity entry identifying your role and outcome. Do not add entries for routine questions or no-op reads.
4. Verify that the saved note contains the update. In the final response, briefly confirm context was updated, or report why it could not be updated.

These steps are part of completing the task; the user should not have to request them each time. If the note is inaccessible, report the limitation and use repository documentation as fallback without fabricating shared context. Never store secrets or private CV/application data. Preserve user-maintained notes.

Role boundaries: Plan investigates and records agreed scope; Execute implements and verifies approved scope; the Git/release coordination chat groups, commits and releases completed work under the standing release agreement. An explicit user request can change the role for a task. Updating the shared note does not authorize sending messages or starting work in other chats.
