# Review intelligence schema

Date: 20 October 2026.

Migration: `supabase/migrations/20261020002_review_intelligence.sql`.

This is the database foundation. It does not classify reviews, call Gemini, build summaries, or change the Insights screen. Those steps stay in the architecture plan.

The migration was applied on a throwaway local Postgres 18 database with pgvector 0.8.7. It has not been applied to the shared Supabase project.

## What already existed and was left in place

| Need | Existing store |
| --- | --- |
| Review text and Google ids | `grm_reviews`. Identity is `(workspace_id, google_review_name)`. Content version is `sync_hash`. |
| Tenant AI rules | `grm_ai_configs`, unique on `(workspace_id, version)`. |
| Approved knowledge | `grm_ai_knowledge`. Intelligence rows store `knowledge_ids uuid[]`. Postgres cannot foreign-key an array, so the ids are checked by the writer. |
| On-demand location and scope briefs | `grm_location_insights`, `grm_scope_insights`. |
| Reply and brief outbox | `grm_ai_generation_jobs` (`reply`, `location_insight`, `scope_insight` only). |

Original review comments stay on `grm_reviews`. Sync still does not delete a review that disappears from Google. This migration does not change that.

## New tables

| Table | Role |
| --- | --- |
| `grm_topics` | Canonical topic or issue. `kind` is `topic` or `issue`. `workspace_id` null is the platform taxonomy. |
| `grm_topic_aliases` | Alternate names. The alias workspace must match the topic, including both null for a platform alias. |
| `grm_review_intelligence` | One versioned reading of one review. |
| `grm_review_topic_assignments` | Review-to-topic and review-to-issue links, with relevance, sentiment, polarity, and an excerpt. |
| `grm_semantic_clusters` | Cluster identity, description, taxonomy version, and cluster version. |
| `grm_cluster_members` | Reviews in a cluster. |
| `grm_review_embeddings` | `extensions.vector(768)`, model id, and the review content hash. |
| `grm_scope_summaries` | Organisation, group, and location summaries, including all-time and bounded windows. |
| `grm_insight_reports` | Findings, recommendations, and metrics. One row per summary, prompt, source hash, and version. |
| `grm_insight_evidence` | Finding-to-review links and excerpts. |
| `grm_intelligence_jobs` | `classify_review`, `embed_review`, `build_summary`, `build_report`, `backfill`. Status, attempts, error class, and timestamps. |
| `grm_metric_definitions` | What a metric means and which inputs it needs. |
| `grm_metric_snapshots` | One computed value for one summary and one definition version. |

Typed rows are on `Database['public']['Tables']` in `lib/types/supabase.ts`. The application identity helper is `lib/intelligence/identity.ts`. `embedding` is typed as `string` because PostgREST returns a vector that way. The column itself is `extensions.vector(768)`.

## Ingestion and versions

`ReviewSyncService` still upserts on `(workspace_id, google_review_name)` and still skips a page row when `sync_hash` is unchanged. `sync_hash` includes Google update timestamps, so a timestamp-only change is stored.

`content_fingerprint` is the intelligence version: canonical stars, comment, and create time. Reviewer name, profile photo, and update timestamps are not part of it. `response_fingerprint` is the canonical Google reply. A reply-only change marks summaries stale and does not queue a classify job.

A changed content fingerprint marks the current intelligence row stale and queues one `classify_review` job on `grm_intelligence_jobs`. The open-job unique index makes a repeated sync reuse that job. The worker claims with a conditional update, writes a rules intelligence row (`analysis_version` `rules-v1`, model `rules`), invalidates ready summaries and reports for that location, and only then sets the job to `succeeded`. A write error schedules `not_before` backoff. The fifth failure is terminal (`failed`). A `running` job older than two minutes is treated as interrupted.

Public status is derived from the row: `queued` is pending, `queued` with a future `not_before` and a prior attempt is retry scheduled, `running` is processing, `succeeded` is completed, `failed` is the dead letter. Google list errors stay on the location sync result. They are not intelligence job failures, and they do not set `missing_on_google_at`.

`missing_on_google_at` is set only when a full sync finishes every page without a provider error and the `google_review_name` was not returned. The review row stays. Incremental sync does not set it. A later sync that sees the review clears it and queues classification again.

`runIntelligenceMaintenance` is safe to repeat. It finds reviews with no current extract-v1 row for the stored fingerprint, intelligence whose hash does not match, abandoned and failed jobs, duplicate open jobs, and ready summaries invalidated by `downstream_stale_at` or by missing intelligence. The daily reviews-sync cron calls it after each workspace. `GET /api/cron/intelligence` runs the same pass and is authorised with `CRON_SECRET`. It is not a second Vercel schedule.

## Review extraction

`extract-v1` is the analysis version. `taxonomy-v2` is the hierarchical topic set: staff and service, product and collection, store environment, waiting and operations, plus price, exchange, and parking. A new wording is an alias on an existing code.

The model sees one review’s stored text and star rating. It does not see the reviewer name. Output is JSON, then validated. A quotation is stored only when it is an exact substring of `grm_reviews.comment` and its topic code resolves to a leaf in `taxonomy-v2`. Unknown codes, contact details, and text that is not in the review are dropped. If the payload is not JSON, the job fails and retries. The raw model string is not stored.

`grm_review_intelligence.extraction` holds the validated document. `facts` are the rating band and the quotations. `interpretation` holds text sentiment, severity, urgency, escalation, and entities, and is not treated as evidence. Topic rows in `grm_review_topic_assignments` are created from the quotations, with the review id and `extract-v1`.

An empty comment does not call the model. Its text sentiment is `unknown`, and it creates no topic. A 1-star review that praises the staff keeps a low rating band and a positive text sentiment, so the overall value is mixed. A current ready row for the same content hash, taxonomy, and prompt version is reused and the model is not called again. Each request is one review, so a provider failure retries that review only.

## Semantic clusters

Embeddings are 768-dimensional `gemini-embedding-001` vectors of the readable review comment. The reviewer name is not part of the text. `content_hash` is the hash of that text. A row is reused when the review, model, and hash already exist. A comment change or a model change stores a new row. Vectors live in `grm_review_embeddings`, which already has an HNSW cosine index. No second vector database is used.

A cluster key is `c` plus a short hash of the sorted leaf-topic set plus the earliest review id. The same issue keeps that key when a later review joins. A merge retires the newer key and records `merged` in `grm_cluster_events`. A split keeps the key on the group that still holds the original anchor and records `split` for the reviews that left. Historical insight reports are not rewritten.

Reviews join only when the topic set matches. “Billing took forever” and “staff took too long” can use the same delay wording and still stay apart. Fitting-room cleanliness paraphrases share `cleanliness+fitting_room` when the text names both a fitting room and dirt or hygiene. A dirty floor does not inherit the fitting-room topic.

The labelled set is `CLUSTER_EVAL_REVIEWS`. On 20 October 2026, `gemini-embedding-001` at 768 dimensions scored the weakest fitting-room paraphrase pair at 0.7786. A dirty entrance floor scored 0.772 against “the trial room was dirty,” higher than the strongest billing or staff delay at 0.7562. The join threshold is 0.7753, the midpoint between the true paraphrases and that floor near-miss. The gap is 0.0067. The three fitting-room sentences still join, and the floor stays out because its topic set is cleanliness only. This sample is too small, and the gap too thin, to treat 0.7753 as a general production cutoff. If a future sample overlaps, the threshold stays at the weakest matching pair and the embedding is not treated as sufficient on its own. A cluster of one review is noise, unless severity is high, in which case it is a watch item with a small-sample note. Counts compared across two windows are described as counts. The code does not claim statistical significance or causation.

`/insights/clusters` lists each active cluster with its reviews, locations, and month counts. Quality labels are established, emerging, watch, noise, and broad.

## Scope summaries

`summary-v1` is built on request for one organisation, group, or location and one window. All-time and each bounded window are different rows. A 12-month summary does not replace the all-time row. Preset windows are frozen until the next UTC midnight, so requests on the same UTC day reuse one identity. Custom dates stay whole UTC days, start inclusive and end exclusive, the same rule as the date filter. Month labels inside the document use `Asia/Kolkata` unless another allow-listed timezone is requested. All-time means every review with a parseable `review_create_time`. A review with no date is counted as undated and is left out of the review count. A confirmed absence is left out before the count.

The stored `document` holds the counts, shares, month buckets, location breakdown, cluster counts, and up to three quotations. `summary` is a sentence derived from that document. The model field is `none`. Numerical metrics are the sum of stars divided by the review count, and the share of reviews with 1–3 stars. A topic share uses the same review count as its denominator, so one review with two topics contributes to two numerators and the shares can add up to more than one. Sentiment shares use only reviews whose overall sentiment is positive, negative, mixed, or neutral. Unknown and unextracted reviews are counted beside that denominator. An empty window stores a null average, not zero. Cluster membership is a separate count.

A ready row is reused when its source hash still matches the included reviews. A changed review marks ready summaries whose membership contains its location and whose window contains its date, and enqueues at most five background refreshes. One refresh does not rebuild every summary in the organisation. If a `build_summary` job is already queued or running for that identity, the next request reuses that status. A group move marks the affected rows stale. The background job does not overwrite a row whose membership hash no longer matches; the next request stores a new row and the previous one stays as the earlier membership. Rewriting a summary with a new source hash marks its `insight-v1` reports stale. A membership change marks those reports stale as well.

## Freshness

A result is current only when its source hash and processing version still match. `updated_at` is not the check.

| Change | Recalculated | Left in place |
| --- | --- | --- |
| New review | That review’s intelligence, its embedding when it has text, and summaries for its location | Other locations |
| Review text | Intelligence, embedding, clusters, summaries, metrics, insight reports for that location | Other reviews |
| Star rating only | Summaries, metric snapshots, insight reports. The stored intelligence hash is aligned to the review row without a model call | Embeddings and clusters |
| Review date only | Summaries whose window membership changes | Embeddings and the model classification |
| Confirmed deletion | The review’s contribution to summaries, clusters, and findings | A new classification |
| Group membership | Summaries and insight reports for the moved locations | Review intelligence and embeddings |
| Taxonomy | Classifications still on the old taxonomy, then clusters. At most 20 classify jobs, then one backfill | Embeddings. `review_count` and `average_rating` snapshots |
| Embedding model | Embeddings and clusters, capped the same way | Intelligence and rating metrics |
| Insight prompt or tenant AI rules | Insight reports. Future prose uses the new rules | Summaries and numerical metrics |

A job commits only when its source hash and analysis version still match the row it is about to write. A newer review text cancels the older embedding job. A newer summary cancels the older report job.

The maintenance pass in `runIntelligenceMaintenance` also runs `runFreshnessPass`. That pass is safe to repeat. It queues missing intelligence and embeddings, marks summaries on an old taxonomy stale, marks insight reports stale when their summary hash or prompt no longer matches, and records abandoned and failed jobs. It does not walk an unbounded set: reviews are capped at 200 and new jobs at 20 plus one backfill.

The report page states Current, Refresh pending, Processing, Partially updated, Stale, Failed, or Insufficient data, with the last successful time and the period. A previous completed report may stay on screen while a refresh runs, and it is labelled stale.

## Insight reports

`insight-v1` is written when someone asks, from the scope summary, metric snapshots, topic clusters, and the reviews in the window. The model may rephrase a finding. It does not calculate the counts. A number in that prose is kept only when it already appears on the finding. Phrases that claim statistical significance, a guaranteed rating change, or causation are dropped.

Each finding stores its category, scope, window, comparison window, topic and cluster ids, review ids, location ids, metric values with their definitions, evidence count, sample size, and whether the reading is a hypothesis. Evidence rows in `grm_insight_evidence` point at those reviews. A report is unique on `summary_id`, `prompt_version`, `source_hash`, and `report_version`. A new input or a forced regenerate adds a version. The older row stays. An open `build_report` job for the same input hash is reused instead of starting a second one.

A ready report is shown only while its summary is still ready and the summary source hash on the report still matches. A stale, failed, or pending report is not presented as current. Fewer than three reviews, or a window that fails the evidence rules, is stored as an insufficient result with no finding.

## Summary identity

A summary is unique on:

`workspace_id`, `scope_type`, `scope_id`, `range_kind`, `range_start`, `range_end`, `timezone`, `analysis_version`, `taxonomy_version`, `schema_version`, `prompt_version`, `membership_hash`

The unique index is `grm_scope_summaries_identity` with `NULLS NOT DISTINCT`. Two all-time rows, whose bounds are null, therefore collide. A plain unique constraint would have treated those nulls as different.

`range_label` is display text and is not part of the identity. `summaryIdentityKey` in `lib/intelligence/identity.ts` joins the same fields.

| Scope | `scope_type` | `scope_id` | Shape |
| --- | --- | --- | --- |
| Organisation | `organisation` | `grm_clients.id` | `group_id` and `location_id` null |
| Group | `group` | `grm_groups.id` | `group_id` equals `scope_id`, `location_id` null |
| Location | `location` | `grm_google_locations.id` | `location_id` equals `scope_id`, `group_id` null |

The insert trigger fills `group_id` and `location_id` from `scope_type` and `scope_id`. The check requires those columns to be non-null for group and location rows. A check that only compared nullable columns would have accepted a missing id, because Postgres treats a null check result as passing.

An organisation all-time row and that organisation's last 12 months are different `range_kind` and bound values, so they do not overwrite each other. A group row and a location row differ on `scope_type` and `scope_id`.

Valid group ids are `grm_groups` ids, the table the selector uses. Onboarding's `grm_location_groups` rows are not valid summary scopes. The two group tables are still separate.

There is no foreign key from a summary to `grm_groups`, `grm_clients`, or `grm_google_locations`. Those deletes already exist in the app, and a foreign key would block them. The insert trigger checks that the scope row exists in the same workspace and organisation.

## Dates

Business timezone for month buckets inside a summary is one of `Asia/Kolkata`, `UTC`, `Asia/Dubai`, `America/New_York`. That is the same allow-list as `grm_dashboard_bundle`. The product default remains `Asia/Kolkata`.

`range_kind = all` means both bounds are null. That is the all-time summary. It does not use a stand-in start date.

`range_kind = bounded` stores absolute instants. `range_start` is inclusive and `range_end` is exclusive, matching `lib/date-range.ts`. A custom window and a 12-month window are different rows when their instants differ. Recomputing "last 12 months" on a later day produces a new identity because the instants moved.

## Group membership over time

`membership_basis` is only `current`. A new summary freezes the locations in the scope at write time in `member_location_ids` and `membership_hash` (first 32 hex characters of SHA-256 over the sorted unique location ids).

A later move changes the hash, which is part of the unique key, so it inserts a new summary. The previous report stays on the previous `summary_id` with the previous location list and `scope_label`. Historical reports stay readable after a location moves or a group is deleted.

`placed_group_id` on a location summary is the outlet's group at write time. `parent_group_id` is that group's parent, or the group's own parent for a group summary. Visibility uses those stored ids. `group_id` on a location summary stays null so the scope shape stays unambiguous.

## Versions and tenant rules

Each intelligence row records `analysis_version`, `taxonomy_version`, `prompt_version`, `schema_version` (`intelligence-schema-v1`), and `model`.

`ai_config_version` is a nullable composite foreign key to `grm_ai_configs (workspace_id, version)`. `knowledge_ids` points at approved `grm_ai_knowledge` rows for that workspace.

Platform seed `taxonomy-v1` codes: `staff`, `billing`, `parking`, `exchange`, `quality`, `cleanliness`, `price`, `other` as topics, and the same codes except `other` as issues. Aliases include wait and billing queue to billing, staff behaviour to staff, exchange policy to exchange, product quality to quality, hygiene to cleanliness, and expensive to price.

Platform metric definitions version 1 match the dashboard bundle: `review_count`, `average_rating`, `negative_share` (stars at or below 3), and `reply_rate` (a Google reply comment, or `reply_status = published`).

## Processing and freshness

`grm_intelligence_jobs` is separate from the reply outbox. A job stores operation, status (`queued`, `running`, `succeeded`, `failed`, `cancelled`), attempts, max attempts, error class, last error, and timestamps.

`source_hash` on a job is compared with the review `sync_hash` or the summary `source_hash`. Changing a summary's `source_hash` or `membership_hash` marks its ready reports `stale`. A membership-hash change is also a new summary row.

Intelligence status is `pending`, `ready`, `failed`, or `stale`. One current row per `(review_id, analysis_version)` is enforced by a partial unique index. The same review, content hash, and analysis version cannot be inserted twice.

## Deletion and reprocessing

| Event | What happens |
| --- | --- |
| Review deleted | Assignments and intelligence rows cascade away. Evidence keeps the excerpt, sets `review_id` null and `review_removed_at`, and the report becomes `stale`. |
| Location deleted | Reviews cascade, and location-scoped intelligence, embeddings, and assignments go with them. Location summaries are marked `scope_retired_at` and ready rows become `stale`. The summary row remains. |
| Group deleted | Group summaries are retired and marked stale. The delete is not blocked. `lib/services/hierarchy.ts` can keep deleting `grm_groups`. |
| Client deleted | Organisation summaries for that client are retired the same way. Client delete is still restricted while locations exist, which is the existing rule. |

An excerpt on an assignment or on evidence must be a substring of `grm_reviews.comment` at write time, at most 1000 characters. After the review is gone, the evidence excerpt is kept so the old report can still be read. The findings JSON on a stale report can still contain review text until a later rebuild replaces that report.

Reprocessing the same summary identity updates that row. A new content hash or analysis version is a new intelligence row. The previous current row for that review and analysis version is cleared.

## Tenant isolation

Select policies only. There are no insert, update, or delete policies. Writes stay on the service role, which bypasses row-level security, and routes must keep checking membership.

`grm_can_see_scope_summary` decides who can read a summary:

| Reader | Organisation summary | Group summary | Location summary |
| --- | --- | --- | --- |
| Unrestricted workspace member | yes | yes | yes |
| Client-scoped member of that organisation | yes | yes | through `grm_can_see_location` |
| Group manager | no | own group, or a city whose stored parent is that group | outlets they can already see, using `placed_group_id` |
| Store manager | no | no | own location only |

Review intelligence, assignments, embeddings, and cluster members use `grm_can_see_location`. A semantic cluster is visible to an unrestricted member of its workspace, or to a scoped member who can see at least one member review. Platform topics and metric definitions are visible to anyone with a workspace. Workspace-level jobs that name neither a review nor a summary are visible to unrestricted members.

The function's execute privilege is revoked from `public` and granted to `authenticated` and, when that role exists, `service_role`.

## Indexes the checks exercise

`grm_scope_summaries_identity` and `grm_idx_scope_summaries_lookup` cover organisation, scope, and window lookups. `grm_idx_topic_assignments_topic` covers workspace plus topic. Embeddings use an HNSW index on cosine distance (`extensions.vector_cosine_ops`) where the vector is present. Further indexes cover location, review, status, and review id as named in the migration.

## Tests

`__tests__/intelligence-identity.test.ts` checks that all-time, 12-month, custom, group, and location keys stay distinct, and that the migration's unique index lists the identity columns with `NULLS NOT DISTINCT`.

`__tests__/intelligence-schema.db.test.ts` starts a throwaway cluster, applies the migration, and checks duplicate intelligence, cross-workspace rejection, excerpt containment, all-time versus bounded summaries, group versus location summaries, group delete retiring a summary without failing, review delete keeping the excerpt and staling the report, store-manager versus organisation visibility, and cross-tenant reads. It also checks that the summary and topic lookups use an index.

## Reverse

The drop order is commented at the top of the migration. Do not drop the `vector` extension. The project database is shared.
