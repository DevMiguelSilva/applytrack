# Job requirement analysis

## Stored data and compatibility

`job_applications.requirement_analysis` stores a versioned, source-backed extraction. `NULL` intentionally marks older jobs as legacy. A new analysis is accepted only when its schema is valid, its source hash and length match the current description, all requirement quotes occur in their referenced sections, and all sections are accounted for. Incomplete and legacy analyses do not produce a match percentage or permit tailoring until the user reanalyzes the posting. Submitted document snapshots are not rewritten.

The additive migration `supabase/migrations/202610300001_job_requirement_analysis.sql` adds a nullable JSONB column and updates `save_tailored_document_v2` so the database compares the exact analysis with the input captured before tailoring. Apply the migration before deploying a client that writes analyses. Existing rows remain `NULL`; no backfill or destructive change is required. The matching column and RPC definition are also in `supabase/schema.sql` for a fresh schema setup.

Rollback should use the previous application version while retaining the nullable column and submitted snapshots. The column is safe to leave in place and should not be dropped as a routine rollback, since jobs may have acquired saved analyses. If the RPC must be reverted, restore its prior definition from the schema/migration that was active before this migration; keep the column until a separately reviewed data-retention decision exists.

## Extraction limits and failures

The parser accepts at most 60,000 characters and 239 numbered sections. It sends the complete accepted description as numbered sections, requests JSON output, permits one provider retry for transient failures, and applies a 30-second timeout per attempt. Invalid JSON and invalid source evidence are surfaced as errors rather than automatically repaired. A section-level uncertainty or missed section produces an incomplete analysis. Do not convert a failure to an empty-but-complete requirement list.

Tailoring receives job basics plus the validated, complete analysis. It no longer slices the description at 3,500 characters or sends arbitrary posting text directly as model instructions. The Gemini API key stays server-side.

Inbox source previews have only preliminary keyword ranking. A preview is marked incomplete and receives no requirement-coverage percentage until the user supplies a complete posting and the analysis succeeds.

## Repeatability

Extraction policy is passed as a fixed Gemini system instruction, separate from the untrusted posting. The UI keeps a bounded in-memory cache of complete results keyed by exact posting text and coalesces simultaneous parses; a saved job also reuses its current validated analysis when its description has not changed. Ordinary rescore of an identical saved description does not invoke the parser and retains the stored extracted skill array verbatim. The existing Parse, save & rescore action in the editor can still request fresh analysis. The cache is session-local and does not span tabs or fresh sessions. A changed posting invokes a new parse. Exact model output is not guaranteed to repeat across fresh calls, model updates, or provider execution. We do not set `temperature`: Google recommends defaults for Gemini 3.x and newer models ignore or deprecate sampling overrides. The fixed instructions reduce ambiguity but do not establish extraction accuracy.

## Evaluation

`evaluation/job-requirements-synthetic.mjs` contains 30 synthetic examples, with six held out. Their labels and quotes are draft annotations, explicitly marked `needs-human-review`; they are not evidence of model accuracy. Have a reviewer verify every expected group, category, qualifier and exact source quote before changing the review metadata. The live runner refuses to make provider requests while any annotation is pending:

```powershell
$env:GEMINI_API_KEY = '...'
node scripts/benchmarkJobRequirementAnalysis.mjs
```

The runner compares the same extraction prompt on the configured baseline model (`gemini-3.5-flash-lite` by default) and a Flash candidate (`gemini-3.8-flash` by default). It runs once on development rows and five times per held-out row, recording per-posting and per-category precision/recall, ALL/ANY group and qualifier accuracy, completeness, critical misses, latency, token counts and estimated list-price cost. Results are written under `evaluation/results/`, which is ignored by Git. Override either model with `JOB_REQUIREMENT_BASELINE_MODEL` or `JOB_REQUIREMENT_FLASH_CANDIDATE`. Model selection and operational cost limits remain open until human-verified measurements exist.

Requirement recall and critical-miss matching require an exact normalized component set and the same ALL/ANY operator. Partial component overlap is a miss; group and qualifier accuracy are reported separately for fully matched groups.

The current draft labels are not human-reviewed, the live comparison has not been run, and no historical user records were reviewed. The prior research only established synthetic score failures and code-path risks; it does not establish how often omissions occurred or their effect on applications.

Model repeatability guidance: [Gemini 3.5 update](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5) and [GenerateContent API reference](https://ai.google.dev/api/generate-content).
