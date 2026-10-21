# RevuPilot review intelligence — operations and readiness

Date: 20 October 2026.

## Verdict

The intelligence engine is **not production-ready**.

The application can store review-level intelligence, scope summaries, clusters, and insight reports when those tables exist. On the shared project (`yzagcxdzlsjpowokqewm.supabase.co`) migrations `20261020002` through `20261020007` have not been applied. Insights and topic clusters therefore report that those features are not available in the workspace. No production-wide backfill was started.

A passing UI or one successful model call is not acceptance. Acceptance still requires the tables on the workspace database, a counted backlog with an approved cost, and a live pass for extraction quality, embedding retrieval, and tenant isolation against that database.

## What this pass measured

| Check | Result |
| --- | --- |
| `npx vitest run` | 47 files passed, 1 skipped. 456 tests passed, 1 skipped. The skipped file is `__tests__/intelligence-cluster-live.test.ts`, which runs only when `LIVE_EMBED=1`. It was not run. It would call Gemini. |
| Throwaway schema | `__tests__/intelligence-schema.db.test.ts` applied the preamble, `20261020002`, the Phase 1 SQL checks, then `20261020003` through `20261020007`, then `__tests__/sql/intelligence_rollforward.sql`, on a local Postgres 18 cluster with pgvector. The test passed. That cluster is created and destroyed by the test. It is not the shared database. |
| Local summary build | One run of `buildSummaryDocument` on 1,000 synthetic reviews finished in 60.5 ms on this machine (`readiness.summary_1000_ms` from `__tests__/intelligence-readiness.test.ts`). This is an in-memory count, not a database query and not a service-level target. |
| `npx tsc --noEmit` | Passed after the identity fixture stopped passing `rangeLabel`, which is not a `SummaryIdentity` field. |
| `npm run lint` | Failed: 18 errors and 5 warnings. All of them are in dashboard components (`react-hooks/set-state-in-effect`, `react-hooks/refs`, `no-img-element`, and `window.location.assign`). Intelligence files touched in this pass are clean. |
| `npm run build` | Passed. Next.js compiled, type-checked, and generated 72 pages. One warning: no fallback metrics for the Cal Sans font. |
| Gemini | Not called. |
| Shared database writes | None. |
| Eligible historical review count | Not counted. Do not treat an empty Supabase tool result as a count. The tool session in this work pointed at other projects. |

## Configuration

Required server environment, from `lib/env.ts`:

| Variable | Role |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server writes. Bypasses row-level security. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Business Profile connection |
| `GEMINI_API_KEY` | Extraction, embeddings, insight prose, and reply drafts |
| `NEXT_PUBLIC_APP_URL` | Public app origin |
| `TOKEN_ENCRYPTION_KEY` | 64 hex characters. Encrypts Google tokens. |
| `CRON_SECRET` | Optional in the schema. Cron routes reject the request when it is unset. |

`vercel.json` schedules reviews sync, escalations, reports, requests, and automation. It does not schedule `/api/cron/intelligence` or `/api/cron/ai-generations`. The daily reviews sync calls intelligence maintenance for the workspaces it already walks. That path still needs the tables and `CRON_SECRET`.

Published prices used by the planner are the standard paid rates recorded in the architecture doc on 20 October 2026: `gemini-embedding-001` at $0.15 per 1M input tokens, and `gemini-3.5-flash-lite` at $0.30 input and $2.50 output per 1M tokens. `planBackfill` assumes 200 embedding input tokens, 200 extraction input tokens, and 80 extraction output tokens per text review. Those assumptions are not a live quote and are not a count of this workspace's reviews. Batch prices on the provider page are half of those figures. Free-tier usage may be used to improve Google's products. Do not backfill on the free tier. This workspace key's tier was not inspected.

## Migrations and rollback

Apply in filename order. Reverse in the opposite order, and only when nothing is reading the objects. Each file's header is the source of the reverse steps.

| File | Adds | Reverse, from the file header |
| --- | --- | --- |
| `20261020001_ai_generation_jobs.sql` | `grm_ai_generation_jobs` | Drop the policy, trigger, and table when reply and insight jobs no longer write it. |
| `20261020002_review_intelligence.sql` | Topics, intelligence, assignments, embeddings, clusters, summaries, reports, evidence, jobs, metric snapshots | Drop triggers, then tables, then guard functions, in the order printed at the top of the file. Do not drop `extensions.vector`. |
| `20261020003_review_versioning.sql` | Review fingerprints, `missing_on_google_at`, `downstream_stale_at`, open-job uniqueness | Drop the indexes and those four columns. |
| `20261020004_review_extraction.sql` | `extraction`, assignment rank and confidence, `taxonomy-v2` rows | Drop the new indexes and columns, and delete `taxonomy-v2` topic and alias rows. Leave `taxonomy-v1`. |
| `20261020005_review_clusters.sql` | Cluster quality columns and `grm_cluster_events` | Drop `grm_cluster_events` and the added cluster columns. Do not drop `extensions.vector`. |
| `20261020006_scope_summaries.sql` | `document`, `last_error`, open summary-job index | Drop the index and those columns. |
| `20261020007_insight_reports.sql` | `source_hash`, `report_version`, `input_key` | Drop the version and open-report indexes, then those columns. This file drops unique `(summary_id, prompt_version)`. Restoring that unique constraint collapses report history. Do that only if a single report per summary and prompt is acceptable. |

The throwaway test proved that `003`–`007` apply after `002` and that two report versions of the same summary and prompt can coexist, while a repeated version is rejected. It did not prove a restore of the old unique constraint.

## Backfill and recovery

`planBackfill` in `lib/intelligence/backfill-plan.ts` does not read the database and does not call a provider. `start` is always `false`.

Rules in the planner:

- One row per review id. A repeated id is ignored.
- A review is skipped when its current intelligence matches `workspace|id|contentHash` and, if it has text, its embedding matches the same key.
- Rating-only reviews are counted and do not add an embedding or extraction call.
- Batches never mix workspaces. The default batch size is 50. The checkpoint is the last review id in the batch.
- A restart that passes the stored intelligence and embedding hashes skips work that already matches.

Do not run a production backfill until someone counts eligible reviews on the shared database, multiplies that count by the prices above, and approves the estimate. Roll out one workspace after the tables exist, check that its evidence stays inside its locations, and only then consider another workspace.

Recovery for a single job is already in the job machine: a failed provider attempt stays queued with backoff (30 seconds, doubling, capped at 6 hours, 5 attempts). An abandoned running job is retried after the 2 minute lease. A commit is allowed only when the job's source hash and analysis version still match the review. A newer source hash cancels the older job. Success is recorded after the intelligence row is stored.

If a backfill process stops, resume from the last checkpoint with the same hash lists. Do not enqueue a second open job for a review version that already has one. Normal review sync should keep using its own path. The planner does not insert into that path.

## Correctness covered by tests

These are deterministic tests. They do not call Gemini.

- A repeated review id counts once. Topic share uses distinct in-window reviews as the denominator. One 5-star review and one hundred 2-star reviews average `205/101`, which is not the mean of the two outlet averages.
- A review outside the custom window is excluded. All-time and bounded summary identities differ (`__tests__/intelligence-identity.test.ts` and the SQL checks).
- A duplicate sync with the same comment, stars, and time does not mark the content changed.
- Deleting a review plans a summary rebuild and marks the summary stale. Embeddings are left in place. The aggregate itself drops the review when the caller omits it.
- Two insight report versions for one summary and prompt are stored. A third insert of the same version is rejected.
- Different topic sets are not clustered together even when the vectors match.
- Fewer than three reviews produce no finding. A high-severity single review is `watch`, not a supported trend.
- Model prose that invents a number is discarded and the deterministic sentence is kept.
- An open classify job is reused. A second claim returns nothing. A provider failure requeues. An older source hash cannot commit over a newer one. An open insight job stays `processing` instead of writing another version.
- A configuration change lists historical reports as stale and does not rewrite their review counts.

## Tenant isolation covered by tests

- Knowledge retrieval drops another workspace's instructions before scope matching.
- A finding that cites a location outside the selected set is dropped.
- Classify jobs for the same review id in two workspaces are different jobs.
- The in-process rate limit for one workspace does not consume the other workspace's budget.
- `authorizeSummaryScope` refuses a foreign client and a location outside a store manager's lock (`__tests__/intelligence-summary.test.ts`).
- The SQL checks reject a cross-tenant intelligence row on the throwaway database.

The service role bypasses row-level security. Isolation in the running app is the `workspace_id` filter and the scope check in server code. Hiding a row in the browser is not the boundary. These tests do not open a second signed-in session against the shared project.

The client freshness key (`overviewQueryKey`) is `client|group|location|range|from|to`. It does not include the workspace id. Server queries still filter `workspace_id`. Two workspaces with the same query string share a display key. That can make the "updating" indicator compare the wrong paint. It is not a data cache.

Rate limits live in a process-local `Map`. Two Vercel instances do not share a counter.

## Quality that was not re-measured

Representative rules exist for multiple topics in one review, a rating that disagrees with the text (the summary still uses the stars), a rare high-severity review, a sample under three, and an invented model number. They check the deterministic layer.

They do not re-score Gemini on paraphrased complaints, tenant-specific wording, or missing quotations. The earlier live embedding check of 40 stored reviews produced single-review noise clusters. The cosine gap between a fitting-room paraphrase and a near miss is 0.0067 (`lib/intelligence/cluster.ts`). That gap is too thin to use as a general production cutoff. Cluster titles come from the taxonomy, not from the model.

## Performance that was not measured

No number in this document is a production improvement.

Not measured against Gemini or the shared database:

- Review ingestion throughput
- Extraction latency
- Embedding spend
- Clustering runtime on stored vectors
- Summary retrieval latency
- Insight generation latency
- Query time and storage growth
- AI usage per tenant

The 60.5 ms figure only says that counting 1,000 reviews in memory is cheap on this machine. Database aggregation, model calls, and embedding writes remain the expensive steps. Batching, the saved summary hash, and background jobs are already in the design because a model call per page view would repeat that cost. This pass did not time those paths.

## Unresolved blockers

1. Migrations `20261020002` through `20261020007` are not on the shared database.
2. No eligible-review count and no approved dollar estimate exist for this workspace. Backfill stays off.
3. Clustering join threshold is not a reliable production cutoff.
4. Onboarding writes `grm_location_groups`. Scope and summaries use `grm_groups`. Membership can disagree until those tables are reconciled.
5. `CRON_SECRET` is optional and was not confirmed set. `/api/cron/intelligence` is not in `vercel.json`.
6. Rate limits do not coordinate across instances.
7. The client freshness key omits the workspace id.
8. Service-role queries are the security boundary. Live cross-tenant access was not attempted.
9. `GEMINI_API_KEY` is required before extraction, embeddings, insight prose, or replies can run. This pass did not call it.
10. `npm run lint` fails with 18 errors and 5 warnings in dashboard components (`react-hooks/set-state-in-effect`, `react-hooks/refs`, images, and `window.location.assign`). The production build type check passed.

## Fazyo backfill run (20 October 2026, partial)

Approved for one client (Fazyo, 10 outlets, 12,007 reviews, 4,994 with text) after the estimate in `planBackfill` (about $1.30 classification plus $0.15 embeddings at the assumed token counts; the extraction prompt carries the taxonomy, so the real input token count per call is higher).

Fixes made before and during the run:

- `loadSummaryReviews` paginates reviews with `range()` ordered by id, and loads cluster members in chunks. PostgREST was capping the old single request at 1,000 rows, so Fazyo's summary counted 1,000 reviews instead of 12,007.
- `runIntelligenceMaintenance` pages through every review in the workspace and loads intelligence in chunks of 200. The old scan stopped after 1,000 reviews.
- `validateModelExtraction` treats null model fields as absent. Gemini emits `"note": null`, and the old schema rejected the whole payload, so every text extraction failed with "model output was not an object". A regression test covers null fields.
- The runner retries each review up to three times and stops the whole run on a quota error instead of failing every remaining review.

Run state when it stopped:

| Measure | Value |
| --- | ---: |
| Ready `extract-v1` intelligence rows | 2,446 of 12,007 reviews |
| Topic assignments stored | 960 |
| Embeddings stored | 25 (smoke batch) |
| Stop reason | Gemini `429 RESOURCE_EXHAUSTED`: the Google project's monthly spending cap is reached |

The provider cap is an account action, not a code change: raise or reset the monthly spend cap in Google AI Studio (`ai.studio/spend`) for the project behind `GEMINI_API_KEY`, then resume with:

```bash
BACKFILL_CLIENT_ID=ae9c94a3-3a80-43b1-9c44-c4a1e7826b4d BACKFILL_CONCURRENCY=6 \
  npx vitest run __tests__/intelligence-backfill-live.test.ts
```

The runner is skipped unless `BACKFILL_CLIENT_ID` is set. It skips reviews whose stored intelligence and embedding hashes already match, so a restart continues from database state. It invalidates the client's summaries when it finishes; regenerating a report before that also works.

Interim verification with partial extraction: Fazyo's all-time summary regenerated at a count of **12,007 reviews, average 4.716** (dashboard: 12,007 at 4.72), with 2,446 extracted and 9,561 still unextracted. Report version 4 is no longer insufficient. It carries 12 findings, all `positive_driver` (Staff politeness 300 cited reviews, Product variety 202, Price 65, and similar), because all-time has no comparison window and complaint topics are still sparse in the extracted subset (Product quality complaints: 7 reviews). Complaint, trend, and cluster findings need the remaining text reviews extracted and embedded. Treat the current findings as praise-side only.

## Cost architecture (implemented 20 October 2026)

Review intelligence is designed so Gemini spend stays near a $6 monthly
budget per workspace:

1. **Rules extraction first** (`lib/intelligence/rules-extraction.ts`):
   deterministic phrase matching over the taxonomy with clause-level
   polarity and negation handling. Short reviews without a topic signal
   are covered by rating alone. Every rules extraction costs $0 and is
   stored as model `rules`.
2. **Batched residue job** (`lib/services/intelligence-batch.ts`):
   reviews the rules cannot cover are sent 25 per Gemini call
   (`gemini-3.5-flash-lite`), with the taxonomy stated once. Results are
   mapped back by explicit index; entries without an index are dropped,
   never guessed. The live backfill runner runs rules first, then
   batches the residue, and only runs embeddings when extraction is
   complete.
3. **Single-call prose** (`lib/services/insight-report.ts`): report
   generation makes at most one Gemini call for all findings combined,
   with per-finding allowed numbers; deterministic prose is used when
   the budget is exhausted or the call fails.
4. **Budget ledger** (`grm_ai_usage_monthly`, migration
   `20261020011_ai_usage.sql`): every Gemini operation (extract, batch,
   embed, insight prose, reply draft) records token counts and an
   estimated USD cost. When monthly spend reaches
   `AI_MONTHLY_BUDGET_USD` (default 6), the insight prose step is
   skipped, batched extraction refuses to call, and reply drafts fall
   back from the full model to flash-lite. Ledger writes are
   best-effort and never block generation.

Prices used for estimates (published standard rates, 20 October 2026):
flash-lite $0.30 input / $2.50 output per 1M tokens, embedding $0.15 per
1M. Fazyo is expected to cost well under $1 to finish and a few cents
per month to maintain.

Migration `20261020011_ai_usage.sql` is additive. Reverse: drop policy
`grm_ai_usage_monthly_select` and table `grm_ai_usage_monthly`.

## Deep pattern findings (21 October 2026)

Frequency findings ("what is mentioned most") duplicate analytics, so
`discoverFindings` also emits a **Deep patterns** group, computed
deterministically from the reviews already loaded for the report — no
extra model calls:

- `rating_drag`: topics whose mentioning reviews average at least 0.35
  stars below the scope average (≥5 mentions, ≥2 complaints). On Fazyo
  this surfaces product availability (16 mentions, 3.69★ vs 4.72★),
  which volume ranking buries.
- `location_drag`: a topic at least 0.5 stars below baseline at one
  outlet (≥30 outlet reviews, ≥4 mentions) and below its own
  cross-outlet average.
- `fan_friction`: complaints inside 4–5★ reviews (≥3) — requests and
  wishes from satisfied customers that low-star reports miss.
- `rare_severe`: 2–7 mentions averaging ≤3.8 stars with at least one
  1–2★ or severe review; forced to hypothesis/low confidence.
- `micro_topic`: repeated 2–3 word phrases mined from stored
  quotations (≥3 reviews, sub-phrase deduplicated), labelled with the
  customers' own wording and mapped to their majority taxonomy topic.

All five keep the same evidence rules: cited review ids in scope,
counts validated by `claimsMatch`, numbers restricted for model prose.
They render first in the report under "Deep patterns".

## Extraction v2 — rich facts, staff, requests, synthesis (21 October 2026)

Extraction was bumped to `extract-v2` (`EXTRACT_ANALYSIS_VERSION` /
`EXTRACT_PROMPT_VERSION`; taxonomy unchanged). The version bump makes
every stored extract-v1 row non-current, so the next **Update summary**
re-reads all reviews — rules still cover the trivial majority free.

What each review now stores, beyond topic/polarity/excerpt:

- **Aspect phrases** — the aspect in the customer's own wording
  ("kidswear selection limited"), validated as model-provided text on a
  quotation the review actually supports.
- **Staff mentions** — people named in the review, kept only when the
  exact name appears in the comment (case-insensitive substring check in
  `validateModelExtraction`), so the model cannot invent staff.
- **Requests** — customer wishes/asks copied verbatim; paraphrases that
  are not substrings of the comment are dropped.

Routing: `requiresAiReview` sends a rules-covered review to the model
anyway when it is **negative** — 1–3 stars, or text the rules read as
negative at any star rating — so what went wrong, who was named, and
how severe it is never comes from keyword counting alone. Also routed:
a named person, a long review (>160 chars), mixed praise and
complaint, or a request in longer text. Short clear positive reviews
stay free. Rating-only reviews (no text) stay free at any rating —
there is nothing for the model to read. The rules extractor also fills phrases, staff names
(honorific/role patterns), and requests (wish/hope/need patterns) for
the reviews it keeps.

Aggregation (`discoverFindings`, still deterministic, no model): new
**Deep patterns** members `staff_mention` (≥3 reviews naming the same
person, praise/complaint split by stars) and `customer_request` (≥2
reviews with the same normalised request), and `micro_topic` now
prefers extraction aspect phrases over mined n-grams (n-grams remain
the fallback for pre-v2 quotations).

Synthesis: the one prose call at report regeneration also returns up to
5 executive conclusions (`metrics.synthesis`). `validateSynthesis`
keeps an item only when every cited finding key exists and every number
in its text already appears on a cited finding or in the brief facts;
banned-claim wording is rejected. Valid items render as **What this
means** above Deep patterns, each linked to its findings. The prose
call is capped at the 16 highest-priority findings (deep categories
first), so prompt cost stays bounded. When the model is unavailable or
over budget, there is simply no synthesis section — findings and the
deterministic brief are unaffected.

Per-finding deep dive (21 October 2026): opening a finding offers
"Deep dive: read the cited reviews". One `insight_deep_dive` model
call reads only that finding's cited reviews (≤25, ≤500 chars each)
and writes a summary, up to 4 observations, and one next step.
`validateDeepDive` keeps it only when every number comes from the
finding's metrics or counts within the cited set, with no banned
claims; one retry, then nothing is stored. Results persist on the
report (`metrics.deepDives`) so reopening is free. Migration
`20261020014_ai_usage_deep_dive.sql` adds the operation to the usage
ledger check; until it is applied the ledger skips recording these
calls (it fails open) while dives themselves work.

Section fixes (21 October 2026): windows without a natural previous
window (all time, some custom ranges) now split at the middle review
date and run trend/emerging/recurring checks across their own halves
("appeared only in the recent half of this window"), replacing the
dead comparison-gated checks; `recurring_issue` also has a
volume-ranked fallback there. Location comparison gained a
rate-based test (one outlet's complaint rate ≥3× the scope rate, ≥30
outlet reviews, ≥4 mentions, ≥2%) beside the share test that healthy
chains never reach.

Finding-quality fixes (21 October 2026, after the first live v2
report): micro-topics exclude phrases built only from filler praise
words ("good service", "customer service") and rank by complaint
count before reach, with near-duplicate phrases (≥70% shared reviews)
collapsed — raw-count ranking had buried every specific phrase under
generic praise. Customer requests group by a normalised 3-word core
(singularised, stopwords dropped), so "need more collection" and
"need more collections for kids" count as one ask. Brief validation
counts outlets as outlets with reviews in the window
(`document.locations.length`), not the scope's outlet count, after a
live brief said "across 10 outlets" when 9 had reviews.

Run guard (21 October 2026): `tryStartBackfill` lets only one Update
summary run own a workspace at a time — a second tab or click gets an
"already running" response and watches the active run's progress
instead of starting a competing one (an active run with no progress
for 20 minutes is treated as abandoned and may be taken over). This
was added after two overlapping runs (two browser tabs) shared one
progress display and produced confusing per-tab numbers; the writes
themselves were always idempotent, so no data was harmed. The client
also recovers from a dropped connection ("Failed to fetch") by
re-checking the status endpoint and resuming progress display while
the server-side run continues.

## Unified brief (20 October 2026)

"Prepare analysis" and "Generate AI brief" are one flow. The single
prose call in `generateInsightReport` also returns a leadership brief
(summary, highlights, risks) written from the summary document's brief
facts; brief numbers are validated against the summary's allowed number
set, and a deterministic brief (`lib/intelligence/brief.ts`) is stored
when the model brief is unavailable, over budget, or invents a number.
The brief is stored in the report's `metrics.brief` and rendered inside
the insight report on the Insights page; the separate legacy brief
section no longer appears there.

## Organisation summary (21 October 2026)

The source of truth for insight counts is one summary per organisation,
stored in `grm_org_summaries` (migration `20261020013_org_summaries.sql`,
additive; reverse: drop the policy and the table). Its state holds
per-location, per-UTC-day counters (review count, rating sum, sentiment,
topic/issue/praise counts) plus each review's contribution and content
fingerprint. `mergeOrgSummary` maintains it incrementally: a review
whose fingerprint already matches is skipped, a changed review has its
old contribution subtracted before the new one is added, and a removed
review is subtracted. It is never recounted wholesale.

`saveScopedSummary` slices this store for the requested scope + window
(`projectOrgSummary`) and uses the slice for every counted field of the
saved summary document when the store has data for the scope; evidence
and cluster fields still come from the review-level build, and any store
failure falls back to that build. The **Update summary** button first
extracts any unmerged reviews across the whole organisation, then merges
the delta with `updateOrgSummary`, then regenerates the current view's
report from the fresh slice. Until migration `20261020011` is applied,
the merge reports itself unavailable in the click notice and insights
continue on the per-scope build.

## In-app backfill button (21 October 2026)

The Insights header carries **Update summary** beside Regenerate. It
posts to `/api/insights/backfill`, which authorises the current scope
and runs `runScopeBackfill` (`lib/services/intelligence-backfill.ts`) in
bounded passes (newest reviews first, at most 2,000 per pass, up to 10
passes per click): topics are extracted for any reviews not yet in the
summary — rules first, batched model calls for residue, no embeddings —
then the report regeneration recounts and saves the summary document,
the source of truth, including the new reviews' topics. The redirect
notice reports how many reviews were processed by rules vs AI batch and
how many remain pending. This is the supported way to bring newly
synced reviews (for example 100 new reviews over five days) into the
summary without waiting for the operator script. The terminal runner
remains available for full historical backfills.

The legacy brief services (`LocationInsightService`,
`ScopeInsightService`, used by profile/scope panels) now build their
prompt from the stored all-time summary (`lib/services/summary-brief.ts`)
— counted topics, outlet breakdown, and up to 12 stored evidence quotes —
instead of sending up to 60 raw reviews. They fall back to the old
sample prompt only when no summary exists yet, run on flash-lite,
record `insight_brief` usage, and return the counted heuristic when the
monthly budget is exceeded. Stored `reviewCount` is now the full counted
review count, not the sample size.

## Enabling a tenant later

1. Apply `20261020001` through `20261020007` on a database you intend to keep.
2. Confirm the throwaway checks still match that database's constraints.
3. Count text reviews and rating-only reviews for one workspace.
4. Write the cost from `planBackfill` and get approval.
5. Process that workspace in batches of 50, recording the checkpoint review id.
6. Compare a summary's review count and average with the dashboard bundle for the same locations and window before generating insight prose.
7. Leave other workspaces out until that comparison holds.
