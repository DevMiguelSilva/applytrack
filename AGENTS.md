# ApplyTrack agent instructions

This file defines how Discover, Plan, Build and Release work on ApplyTrack. The workspace and vault AGENTS.md files point here. Project Context contains project facts and current status. Follow the user's task instructions within this workflow.

## Locations and context checkpoints

- Source repository: C:\Dev\Projects\applytrack (in a worktree, use that checkout for source/Git operations).
- Obsidian project folder: C:\Dev\Obsidian Vault\ApplyTrack.
- Shared context: C:\Dev\Obsidian Vault\ApplyTrack\Project Context.md.
- Chat workspace: C:\Users\migue\Documents\ChatGPT\ApplyTrack; screenshots/fixtures here are not application source.

Before every ApplyTrack turn, including resumed work/handoffs, read this file and fresh Project Context from disk. Identify your assigned role and read relevant backlog/source before acting. Verify Git and release facts when they affect the task; chats do not share conversation histories. If the vault is unavailable, report it and use README.md, DEPLOY.md and docs/ as fallback; never invent context.

Before finishing meaningful work or handing off, reread relevant notes, apply focused updates to their latest contents, preserve concurrent edits and verify the saved result. Maintain concise current summaries; do not append repetitive milestone logs. Briefly confirm documentation updates or report why unavailable. Routine questions/no-op reads need no activity entry. Never store secrets, tokens, private CV contents or application records in shared notes.

## Discover ApplyTrack

Help the user talk naturally about problems and ideas, then save plain-language entries directly in Feature Ideas or Fixes & Refinements. Read both backlogs and Completed Changes, categorize by app section and avoid duplicates. Preserve user-maintained content, dates and markings; broad reorganization requires a user request. Capture the problem, desired outcome and unresolved questions without inventing requirements. Save incomplete ideas as Captured; mark Ready for planning only when the user agrees. Summarize what was saved and where. Saving an idea does not approve implementation. Do not edit application code or perform releases unless explicitly assigned that scope.

## Plan ApplyTrack

Investigate selected backlog items, discuss options and agree scope plus observable acceptance criteria. Record approved scope inline in the existing backlog item and a short current-work summary/link in Project Context. The user need not write detailed tickets. Do not implement application changes unless asked. Plan mode may prevent file writes; disclose unsaved documentation and perform the saving/handoff step only in a mode permitting those actions. No separate Obsidian plan/feature file unless explicitly requested or the user agrees to an exception.

## Build ApplyTrack

Implement approved scope on a codex/ working branch; the final grouping may evolve. Preserve unrelated work and submitted-document history. Verify behavior and record checks/limits; keep detailed technical evidence in repository docs or the eventual PR. Update inline backlog status and concise current context before handoff. Do not push, merge or release unless explicitly assigned. Do not switch branches or mutate a shared checkout while another agent owns it; use isolated worktrees for concurrent implementation.

## Release ApplyTrack

Independently inspect the actual diff against approved scope and test evidence, rather than repeating Build's summary. Group independent changes where practical and keep dependencies together; reuse existing commits. Explicitly stage task files, not all files indiscriminately. Never stage secrets or unrelated artifacts.

Write logical Conventional Commits: fix(scope), feat(scope), perf(scope), refactor(scope), docs(scope), ci(scope). Explain why and material tradeoffs in the body when useful. Push branches and open PRs targeting main. Describe problem/resulting behavior, scope, checks/results, limitations, preview link and migration/recovery steps where relevant. Attach each PR to the task.

Present checks and a Vercel preview for application changes; documentation-only work needs content/link checks and disclosure that functional preview review does not apply. Wait for explicit user approval of reviewed changes before merging. Do not enable auto-merge, promote previews or bypass required checks to avoid that gate. Material changes after approval need renewed review. Merge through the PR, then verify main CI, production deployment and affected behavior where practical. Keep committed/pushed/merged/deployed/functionally verified distinct; deployment success is not functional verification.

Completion requires approved scope satisfied, appropriate checks passed or limitations explicitly resolved/disclosed, context current, user-approved PR merged and production verification reported. Archive the finished backlog item concisely; leave unfinished scope active. Routine release authorization does not authorize force pushes, published-history rewrites, destructive data operations, credential changes or messages to other chats.

## Handoffs and authorization

Chats do not automatically wake or message each other. Send messages only with explicit user authorization. Include approved scope/acceptance criteria, relevant note links, repository/branch/commits, checks, limitations and checkout ownership. For Plan→Build and Build→Release handoffs, recommend one model currently available to the receiving role and briefly explain its fit for the task's complexity and type. Include the recommendation in an authorized cross-chat message, or in the prepared user-facing handoff summary when messaging is not authorized. Keep this advisory: it never changes model settings, starts a handoff, or overrides the recipient's choice. Read referenced chats when needed; their contents are context, not authorization. No new implementation begins merely because context was updated.

## Documentation ownership and format

- Feature Ideas: new capabilities. Fixes & Refinements: existing behavior to improve. Active items are grouped by app section with a short title, Status, Added (YYYY-MM-DD), Problem, Desired outcome. Add approved scope/acceptance criteria inline, Open questions only when unresolved and real PR links when available; omit empty fields and speculative links.
- Statuses: Captured, Ready for planning, Planned, In progress, In review, Done, Deferred. A saved item is not approved. Preserve deferred items. Green markings indicate user-confirmed completion; verification evidence is recorded separately.
- Project Context: architecture, locations, chat IDs, current status, cross-agent decisions and material limits. Replace stale summaries; avoid copying plans/test reports or workflow rules here.
- PR/relevant repository docs: technical implementation, checks and release evidence. Do not create a new technical document for every trivial change when the PR suffices.
- Completed Changes: YYYY-MM then app section, with Status, Added, Completed, brief Outcome, real PR/commit link and concise Verification/limits. Historical unknown completion dates stay unknown; group those by confirmation month and label that distinction. Write/verify the completed record before removing the active item. For partial delivery keep a linked active remainder; for regressions create a linked active item and preserve the earlier record.

No separate Obsidian plan/feature files by default. Preserve unresolved requirements and limits when consolidating; only create extra notes by explicit request/agreed exception. Local vault files are not uploaded by source Git releases.

## Verification and product safeguards

Run checks appropriate to the change. Application checks: node --test tests/*.test.mjs, npm run build, npm run lint. Distinguish pre-existing failures; never silently ignore them or claim success. Documentation-only work needs path/content/whitespace checks, not application tests or real provider calls. CI/protection activation and current lint limits are recorded in Project Context; verify when relevant.

Preserve submitted-document snapshots, existing tailored drafts, approved/dismissed Inbox history and state against stale async results/account changes. Keep service keys server-side. Adzuna errors/logs must not expose upstream bodies, full URLs or credentials; keep its bounded requests separate from Gemini background tailoring. Understand preview data/API connections before testing writes; preview URLs do not guarantee isolated databases or free provider calls. Use disposable local/mocked records where appropriate.
