# RevuPilot review intelligence — architecture audit and implementation plan

Date: 20 October 2026.

Status: architecture audit (20 October 2026), the Phase 1 schema, Phase 2 ingestion, Phase 3 per-review extraction (`extract-v1`, `taxonomy-v2`), Phase 4 topic clustering, Phase 5 on-demand scope summaries (`summary-v1`), Phase 6 evidence-backed insight reports (`insight-v1`), Phase 7 freshness, Phase 8 Insights (the header scope drives the counted charts, saved report, and evidence), Phase 9 tenant rules, and a Phase 10 readiness assessment. Canonical topics and counts stay shared. Each organisation's labels, knowledge, and configuration version apply only to its own replies and future reports. A result is current only while its source hash and processing version match. The engine is not production-ready. Migrations `20261020002` through `20261020007` are files only on the shared database, clustering thresholds are too thin to treat as a general cutoff, and live extraction, embedding, and backfill were not run. The verdict, rollback, backfill plan, and test record are in `docs/REVUPILOT_REVIEW_INTELLIGENCE_OPERATIONS.md`. See also `docs/REVUPILOT_REVIEW_INTELLIGENCE_SCHEMA.md`.

The stack description below is the audit as of that date. One later change: the Phase 1 migration enables `vector` in the `extensions` schema and stores 768-dimension review embeddings on `grm_review_embeddings`. There is still no embeddings client in `lib/gemini.ts`.

Sources read for this pass: `supabase/migrations`, `lib/services`, the App Router pages for Overview, Analytics, Reviews, Escalations, and Insights, `docs/RevuPilot Wireframes (1).pdf` (15 pages, text extracted), `docs/GLOBAL_SCOPE.md`, `docs/REVUPILOT_IMPLEMENTATION_AUDIT.md` (19 October 2026), `docs/GRM-UI-UX-DESIGN-BRIEF.txt`, `lib/gemini.ts`, `vercel.json`, and `lib/env.ts`. The September design brief describes an older five-screen inbox. Where it disagrees with the PDF, this plan follows the PDF and the code that already implements the PDF shell.

This pass did not apply migrations, call Google, call Gemini, publish a reply, or write application rows. `npx vitest run` on 20 October 2026: 37 files, 380 tests, passed.

The workspace Supabase host is `yzagcxdzlsjpowokqewm.supabase.co`. The authenticated Supabase tools in this session point at other projects, so live column drift was not re-checked today. The 19 October audit reported that `grm_groups`, `grm_brands`, and `grm_scope_insights` existed on that host and that `grm_escalations.assignment_decided_at` did not. Treat that probe as historical until someone re-reads the live catalog.

---

## 1. Existing architecture and technology stack

| Layer | What the repository uses |
| --- | --- |
| App | Next.js 16.3.1 App Router, React 19.2.8, Tailwind CSS 4 |
| Language | TypeScript. Tests are Vitest 4. |
| Data | Supabase Postgres. Application tables are prefixed `grm_` because the project is shared with another schema. |
| Auth | Supabase Auth. The session gate is `proxy.ts`. Google sign-in is implemented. |
| Server data | Server Components call `lib/services`. Mutations go through `app/api`. |
| Database access | The service-role client in `lib/supabase/admin.ts`. Row-level security is enabled, and the service role bypasses it. Each route checks membership and scope in application code. |
| AI | Google Gemini `generateContent` for replies, insights, and extraction (`gemini-3.8-flash`, `gemini-3.5-flash-lite`). Embeddings use `embedContent` on `gemini-embedding-001` (768 dimensions, one review per call) and are stored in Postgres with pgvector. |
| Reviews provider | Google Business Profile. Locations come from the Business Information API. Reviews are listed, read, replied to, and have their reply deleted through My Business API v4 (`https://mybusiness.googleapis.com/v4`). |
| Jobs | Vercel Cron hitting `app/api/cron/*`, plus an AI generation outbox table. There is no Redis, SQS, or other queue. |
| Cache | Insight rows cached by a source hash. Dashboard numbers are computed on each request. Rate limits are an in-process `Map` in `lib/rate-limit.ts`. |
| Deploy | `vercel.json` cron. `NEXT_PUBLIC_APP_URL` is a required env var; this workspace’s local file does not print a public production URL here. |

Pages that own review intelligence today:

| Screen | Route | Server entry |
| --- | --- | --- |
| Overview | `/overview` | `getDashboardContext`, `loadOverviewSignals`, optional `ScopeInsightService.getView` |
| Reviews (Inbox) | `/reviews` | `lib/services/dashboard.ts` |
| Escalations | `/escalations` | `lib/services/escalations.ts` |
| Analytics | `/analytics` | `getDashboardContext` and `loadAnalyticsSlice` |
| Insights | `/insights` | `getDashboardContext`, saved location or scope insight, `loadComplaintSamples` |

The header scope contract is `docs/GLOBAL_SCOPE.md`. Review screens read `client`, `group`, and `location` from the URL through `readPageScope`.

---

## 2. What is implemented, partial, missing, or blocked

Status words match the 19 October audit: PASS means the stored behaviour exists, PARTIAL means a real path exists and a named part does not, FAIL means it is absent, BLOCKED means an external dependency or an unresolved schema split stops the work.

### Already implemented

- Tenant is `grm_workspaces`. Organisations in the selector are `grm_clients`. Reviews live on `grm_reviews.location_id`.
- Google review sync upserts on `(workspace_id, google_review_name)`.
- Counted Overview cards for “Getting worse”, “New complaint theme”, “Improving”, and “Highest rated”, from two date windows. Thresholds are 5 reviews in each window and a rating move of at least 0.15 (`lib/overview-board.ts`).
- Date-window metrics in `grm_dashboard_bundle`: rating, volume, 1–3 star share, reply rate, monthly series, location rows, group rows, and keyword `complaint_theme` counts.
- Gemini reply drafts (`lib/services/ai-review.ts`, prompt version `v3.1`) with tone, knowledge, templates, shorter/warmer adjustments, and guardrails.
- One cached location brief (`grm_location_insights`, prompt `insight-v3.0`) and one cached organisation or group brief (`grm_scope_insights`, prompt `scope-insight-v2.0`).
- Evidence review ids parsed from the model and dropped unless they appear in the sample. If the model returns none, the code keeps the first five sample ids.
- An outbox, `grm_ai_generation_jobs`, so generated text is stored before the reply or insight row is written. A reconciler route exists at `/api/cron/ai-generations`.
- Role matrix in `lib/access.ts`. Location visibility function `grm_can_see_location`.

### Partially implemented

- Insights page mixes a date-window scorecard (`getDashboardContext`) with a model brief that is the newest 50 or 60 reviews and is stored once per location or once per organisation/group. The page label shows the selected range. The brief’s own caption says it matches the reviews and lens used when it was saved.
- Overview “Highest rated” is the top store at or above the scope average. The PDF’s “worth copying” card is a named praise pattern (staff praised by name, trial-room help). The code does not extract praise themes.
- Complaint themes are the first English keyword hit among wait, staff, price, cleanliness, quality, or unspecified. The PDF uses billing queue, staff behaviour, parking, exchange policy, and product quality, including praise and rising or falling.
- Group hierarchy is implemented in services against `grm_groups` and `grm_brands`. Onboarding still writes `grm_location_groups`. See section 3.
- Evidence links on Insights open the inbox with `review={id}`. They are labels “Evidence 1”, not a quoted sentence tied to a span in the review.
- `grm_ai_generation_jobs` has a select policy. The cron that resumes stuck jobs is not listed in `vercel.json`.

### Missing

- A persistent per-review classification that can be summed for any scope and any date range.
- Embeddings, clustering, and a vector index.
- A question box (“Ask”) that answers from stored reviews.
- Streak language (“3 months in a row”), weekend-evening splits, and praise-theme bars grounded in stored classifications.
- Detection that a review disappeared from Google.
- `review_url` and `sync_cursor` are columns. Current sync does not write them.
- A second review provider. Every review row is a Google Business Profile review.

### Blocked

- Scheduled sync, escalation reminders, reports, request jobs, and automation return 401 while `CRON_SECRET` is unset. It is unset in `.env.local` (nine keys are present; cron and delivery secrets are not).
- The AI job reconciler cannot run on the Vercel schedule until it is added to `vercel.json` and `CRON_SECRET` is set. The route itself is implemented.
- Group assignment on a database built only from these migrations is inconsistent. See section 3. Intelligence work that groups locations must wait until one group table is authoritative.
- Gemini model availability was not confirmed with a live `generateContent` call in this pass. The ids are published on the Gemini pricing page as of this audit (`gemini-3.8-flash`, `gemini-3.5-flash-lite`). That is not the same as a successful call with this workspace’s key.
- Which Gemini billing tier the key uses is unknown. Free-tier embeddings and several free-tier generation paths are marked “used to improve our products” on Google’s pricing page. The paid standard tier for `gemini-3.8-flash` is marked as not used to improve Google’s products. Confirm the tier before any new pipeline sends review text.

---

## 3. Authoritative relationships

The selector names and the stored names differ. Keep the URL params `client`, `group`, and `location`.

```
grm_workspaces                         tenant
  └── grm_clients                      organisation (selector label)
        └── grm_brands                 one brand row per client, created when a group is created
              └── grm_groups           region, or a city whose parent_id is that region
                    └── grm_google_locations.group_id    one location, one group, nullable
                          └── grm_reviews.location_id    reviews never move to a group row
```

### Membership semantics (inspected, not assumed)

A group is a stored node, not a saved filter and not a live query over city names.

- `grm_groups.kind` is `region` or `city`.
- A city requires `parent_id`. That parent must be a region in the same workspace and the same client. A city cannot contain another group. `lib/hierarchy.ts` `groupShapeError` and the SQL guard on `grm_location_groups` encode the same two-level rule. The assignment trigger `grm_guard_location_assignment` looks up `grm_groups`, not `grm_location_groups`.
- A location has one `group_id`. Assigning locations writes that column (`lib/services/hierarchy.ts`). It does not insert a membership join table. Tags (`grm_location_tags`, `grm_location_tag_links`) are separate labels.
- Selecting a region includes locations whose `group_id` is that region and locations whose `group_id` is a city with `parent_id` equal to that region (`locationInGroup` in `lib/hierarchy.ts`, `grm_location_in_group` in SQL). Selecting a city includes only locations with that city id. A location with `group_id` null is outside every group.
- Selecting an organisation includes every location with that `client_id`, including ungrouped ones.
- Moving a location changes `group_id`. `grm_reviews.location_id` stays. Reviews are not copied onto the group.
- A member’s lock is at most one of `scope_client_id`, `scope_group_id`, or `scope_location_id` (`grm_members_one_scope`). A group manager’s lock includes child cities (`grm_can_see_location`).
- The workspace is the tenant. “All organisations” is `clientId` null inside that workspace. It is not a cross-tenant view.

`grm_brands` is one row per client (`unique (workspace_id, client_id)`). The selector does not have a separate brand level. Settings and the PDF talk about a brand because the client is the brand the workspace manages. Tone inheritance in `lib/services/reply-settings.ts` walks workspace, then client, then group (and parent region), then location.

### Two group tables

Both exist in migrations:

| Table | Who writes it | Shape |
| --- | --- | --- |
| `grm_groups` | `lib/services/hierarchy.ts`, scope catalog, dashboard, access, insights, reporting | `client_id`, `brand_id`, `parent_id`, `kind` |
| `grm_location_groups` | `lib/services/onboarding.ts` | Originally a flat name. `20261016008_hierarchy.sql` adds `client_id`, `parent_id`, and `kind` |

`grm_google_locations.group_id` is still declared, in `20261016001_onboarding.sql`, as a foreign key to `grm_location_groups`. No later migration drops that foreign key or points it at `grm_groups`. `grm_scope_settings.group_id` and reply templates were repointed at `grm_groups` in `20261016010_settings.sql`. Report schedule `group_id` columns in `20261016006_reports.sql` still reference `grm_location_groups`.

`20261019002_grm_groups.sql` creates `grm_groups` and `grm_brands` with `create table if not exists`. It enables row-level security and does not add a select policy. It does not copy rows from `grm_location_groups`.

Consequence for a database created only from these files: a location update that sets `group_id` to a new `grm_groups` id fails the foreign key to `grm_location_groups`. A location update that sets `group_id` to a `grm_location_groups` id can pass that foreign key and then fail `grm_guard_location_assignment`, which selects `grm_groups`. The running app’s hierarchy service only inserts `grm_groups`. Onboarding only inserts `grm_location_groups`.

This is the schema decision that blocks intelligence. Do not add a third grouping table. Do not delete locations or reviews to “clean up” groups.

`grm_groups` and `grm_brands` also have row-level security and no select policy in the migrations. The app still reads them because it uses the service role. A future browser query with the anon key would see zero rows.

---

## 4. How review data enters and changes

There is one review store: `grm_reviews`.

### Identity

| Field | Role |
| --- | --- |
| `id` | Internal uuid. Insight evidence and inbox links use this. |
| `google_review_name` | Google resource `accounts/{a}/locations/{l}/reviews/{reviewId}`. Unique with `workspace_id`. |
| `google_review_id` | The review id segment returned by Google. |
| `location_id` | Owning Google location. Cascade-deletes the review if the location row is deleted. |
| `workspace_id` | Tenant. Required on the unique key so two workspaces cannot share a row. |

### Fields copied from Google My Business v4

The client types in `lib/types/google.ts` and the list call in `lib/services/google-reviews.ts` use:

- `name`, `reviewId`
- `reviewer.displayName`, `reviewer.profilePhotoUrl`, `reviewer.isAnonymous`
- `starRating` (`ONE` … `FIVE`)
- `comment` (absent when the review is rating-only)
- `createTime`, `updateTime`
- `reviewReply.comment`, `reviewReply.updateTime`

The list request is `pageSize=50` and `orderBy=updateTime desc`. The code comments in `review-sync.ts` say “newest-first”. The API order is update time, not create time.

Stored alongside that copy:

- `review_language`: script detection in `detectReviewLanguage` (English letters, Malayalam, Hindi, Tamil, Arabic, other, or `none`). This is not a Google language code.
- `complaint_theme`: `detectComplaintTheme`, only when stars are 1–3.
- `reply_status`: application workflow (`none`, `draft`, `approved`, `pending_publish`, `published`, `failed`).
- `assigned_to`, `reopened_at`
- `sync_hash`: SHA-256 of star rating, comment, update time, reply comment, and reply update time.
- `first_synced_at`, `last_synced_at`

`review_url` exists and is not set by sync. Google’s location metadata can include `newReviewUri` for the location, which is a different field and is not copied onto the review.

Google sometimes embeds a translation inside `comment` as “(Translated by Google)” plus “(Original)”. `lib/review-text.ts` splits that. The app does not call a translation API. Insights and theme detection prefer the translation when it differs from the original (`readableReviewText`).

### Sync

`ReviewSyncService.syncLocation`:

1. Marks the location `syncing`.
2. Loads an access token for the location’s Google connection.
3. Pages `listReviews` until `nextPageToken` is empty, or, in incremental mode, until two consecutive pages contain no hash changes or 40 pages are reached.
4. Upserts changed reviews. An unchanged hash is skipped and `last_synced_at` is not touched.
5. If Google already has a reply and the local status is `none`, sets `reply_status` to `published`. It does not overwrite a local draft or an in-flight publish.
6. If a published review’s comment or stars change, sets `reopened_at`.

Mode is `full` when the location has never synced or the caller asks for full. Otherwise it is `incremental`.

`syncAllWorkspaceLocations` skips inactive locations and the synthetic unassigned client (`notes = 'grm:system:unassigned'`). Locations run with concurrency 3. Transient Google errors retry twice with a 1.5s backoff. Authentication, authorization, not found, and invalid request are not retried.

Manual sync: `app/api/reviews/sync/route.ts`, rate-limited in memory. Scheduled sync: `GET /api/cron/reviews-sync` daily at 04:00 UTC (`vercel.json`), incremental, then `EscalationService.runScheduled` for that workspace. The cron returns 401 unless `Authorization: Bearer` matches `CRON_SECRET`.

### Updates

A later sync updates the same row when the hash changes: stars, comment, times, Google reply, language, and theme. Workflow fields that are omitted from the upsert payload stay as they were, except `reply_status` and `reopened_at` when the rules above fire.

Replies published by the app go through `ReplyPublishingService` (`PUT .../reviews/{id}/reply`). Deleting a reply is `DELETE` on that reply resource. The reviews client does not call a “report this review” method. The PDF’s “Report to Google” has no client method in this repository.

### Deletion

Nothing in sync deletes a `grm_reviews` row when Google stops returning it. Incremental sync stops after unchanged pages, so it does not even see the full remote set. A removed Google review remains locally and still counts in metrics and can still be cited as evidence.

Rows disappear when the parent is deleted: location delete cascades to reviews; review delete cascades to AI drafts, replies, notes, and AI generation jobs. Client delete is `ON DELETE RESTRICT` from locations, so a client with locations cannot be removed until those locations are handled.

There is no review-level tombstone, no `removed_from_google_at`, and no webhook from Google for review deletion.

### Provider limits that intelligence must respect

This repository integrates one review provider. The v4 review resource used here does not return a theme, a sentiment, a language code, or a stable public URL on the review object this client parses. It does not filter by date. Page size is 50. Ordering by `updateTime desc` means an old review that is edited jumps to the front, and an untouched old review stays deep in the list. A second provider, if one is added later, needs its own external id column. Do not assume it will have `google_review_name`, a reply `PUT`, or the same timestamps.

---

## 5. How AI replies, insights, and analytics are generated today

### Replies

`AIReviewService` builds a prompt from the review text, stars, reviewer display name (unless anonymous), business name, location name, resolved tone, organisation context, knowledge rows, templates, and an optional reply playbook taken from the location insight’s `analysis.replyPlaybook`.

The call is `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with the API key in the query string. Simple drafts use `gemini-3.5-flash-lite` and `thinkingLevel: minimal`. Other drafts use `gemini-3.8-flash` and `thinkingLevel: low`. The model id is recorded on `grm_review_ai_drafts` with a prompt hash and prompt version `v3.1`.

Generation writes `grm_ai_generation_jobs` first (`kind = reply`). `persistAiGenerationJob` expands that into `grm_review_ai_drafts` and the reply row. If the jobs table insert fails, the service falls back to a synchronous save. A newer reply job for the same review marks older `generated` jobs `superseded`.

Rate limit: 5 generations per user per minute, in memory (`AI_GENERATE_LIMIT`).

### Location and scope briefs

Both are on-demand. Privacy copy says GRM does not run AI across every profile in the background. The code matches that: nothing in cron calls Gemini.

Location brief (`LocationInsightService.generateForLocation`):

- Loads up to 50 newest reviews for that location (`review_create_time` descending). The query is not limited by the page’s date range.
- Average rating in the brief is the average of that sample, not of the selected window, and not `grm_google_locations.average_rating`.
- Fingerprint is location id, sample length, sample average, insight-lens fingerprint, and for each sample review the create time, stars, and first 80 characters of the comment.
- Cache row is unique on `(workspace_id, location_id)`. A matching hash, prompt version `insight-v3.0`, and a “rich” analysis returns the row. `force` bypasses the cache. `preview` uses the fast model, 16 reviews, and does not save.
- The prompt asks for JSON: summary, sentiment, themes, highlights, risks, branding, staff, customer feedback, operations, suggested features, reply playbook, and up to 8 `evidenceReviewIds` copied from the sample.
- On model failure (except preview and truncation), a heuristic count sentence is stored. The Insights page hides those counted sentences and asks for another generate (`isCountedSummary`).

Scope brief (`ScopeInsightService`) is the same shape for `scope_kind` `client` or `group`. It resolves locations with the group rule in section 3, then takes the newest 60 reviews across those locations (preview: 20). Unique key is `(workspace_id, scope_kind, scope_id)`. There is no date column. Overview loads this brief when a group or organisation is selected and no single location is selected.

Insight generation rate limit is 8 per user per minute. The lens (`grm_ai_configs.snapshot.insights`, or a client-scoped `grm_ai_knowledge` row of kind `insight_lens`) is instructions in the prompt. `grm_insight_feedback` stores useful / not useful and does not change the prompt.

If the model omits evidence ids, the server fills the first five sample ids. Those five are in the sample, so they are real reviews, but they were not chosen as the grounds for a particular sentence.

### Analytics and Overview counts

`getDashboardContext` calls `grm_dashboard_bundle(workspace, client, group, location, start, end, timezone)` and the same function for the previous window of equal length. All-time has no previous window.

Inside the bundle, a review counts when:

- `workspace_id` matches,
- the location has a client,
- the client notes are not `grm:system:unassigned`,
- client, group (`grm_location_in_group`), and location filters match,
- `review_create_time` is in `[start, end)`.

Measures:

| Measure | Rule |
| --- | --- |
| Reviews | Row count |
| Average rating | `rating_sum / reviews` across reviews, never the average of location averages |
| Negative share on Overview | 1–3 stars / reviews. The bundle also counts 1–2 stars separately as `negative`. |
| Reply rate | A Google reply comment is present, or `reply_status = published` |
| Reply time | Hours from `review_create_time` to `google_reply_update_time` when the reply time is at least the create time. Missing reply timestamps are excluded. |
| Months | Truncated in `Asia/Kolkata`, `UTC`, `Asia/Dubai`, or `America/New_York`. Any other timezone falls back to UTC. |
| Themes | `complaint_theme` on 1–3 star reviews, else `unspecified` |

`loadAnalyticsSlice` re-reads review rows for reply-time buckets (under 1 hour, 1–6 hours, 6–24 hours, over 24 hours), language mix, and an onboarding before/after split. It caps the window at 8,000 rows and the onboarding comparison at 3,000, and sets `truncated` when it hits the cap. The dashboard bundle itself is SQL and is not capped the same way.

Overview cards (`buildOverviewBoard`) use those counts. They do not call Gemini. “New complaint theme” means a non-unspecified keyword theme with at least 3 reviews in this window and zero in the previous window. Theme bars can be marked rising, falling, steady, or new by comparing keyword counts. `loadOverviewSignals` also loads per-location themes; if a page returns 1,000 rows the theme list is marked truncated and Overview must not present it as complete.

Competitor ratings are not connected. The analytics board says so. Do not estimate them.

---

## 6. Proposed persistent intelligence data model

These names do not exist. They are the proposed extension of `grm_reviews`. Do not create a second review table. Do not copy review text into a parallel store except for a short quote that is a substring of the stored comment and is checked on write.

The unit of persistence is one classification per review per classifier version. Scope screens aggregate those rows. Narrative briefs become a cache of an aggregate, keyed by scope and date window, and every claim points at review ids that fall inside that window.

### Proposed `grm_review_signals`

One current row per review per classifier version.

| Column | Purpose |
| --- | --- |
| `id` | uuid |
| `workspace_id` | tenant, copied from the review and checked equal on write |
| `review_id` | `references grm_reviews(id) on delete cascade` |
| `location_id` | copied from the review so scope queries do not join only to re-check access |
| `classifier_version` | text, for example a future `signal-v1` |
| `source_hash` | hash of the comment, stars, and `review_update_time` used as input |
| `sentiment` | `positive`, `mixed`, `negative`, `neutral`, or `unknown` |
| `themes` | jsonb array of `{ code, label, polarity }` where polarity is `praise` or `complaint` |
| `evidence` | jsonb array of `{ theme, quote }` where `quote` must be a substring of `readableReviewText(comment)` or be rejected |
| `model` | the model id, or `rules` when the row came from `detectComplaintTheme` only |
| `created_at` | timestamptz |

Unique `(review_id, classifier_version)`. Index `(workspace_id, location_id, classifier_version)`.

The existing `complaint_theme` column stays. It remains the keyword tag written at sync. `grm_review_signals` is the later, versioned reading. Metrics that must stay stable keep using `complaint_theme` until a migration of the dashboard bundle is explicitly approved. New praise and rising-theme views read `grm_review_signals`.

Backfill rule: a review with no text gets a row with empty themes and sentiment taken from stars (4–5 positive, 3 mixed, 1–2 negative) and `model = rules`, so rating metrics never depend on the LLM.

### Proposed `grm_insight_windows`

A saved narrative for one scope and one concrete window. This does not replace `grm_location_insights` or `grm_scope_insights` in the first implementation step. Those tables keep serving the current brief. The new table is what Overview and Insights read once it is populated. Retiring the old unique keys is a later, separate migration.

| Column | Purpose |
| --- | --- |
| `workspace_id` | tenant |
| `scope_level` | `organisation`, `group`, or `location` (same words as `ResolvedScope.level`) |
| `client_id`, `group_id`, `location_id` | the selected node; the other two null |
| `range_start`, `range_end` | inclusive start, exclusive end, matching `lib/date-range.ts` |
| `summary` | text |
| `cards` | jsonb: the four card kinds the PDF asks for, each with counts, review ids, and location ids |
| `evidence_review_ids` | uuid array, every id must belong to `workspace_id` and to a location inside the resolved scope, and its `review_create_time` must fall in the window |
| `source_hash` | hash of the signal rows and the bundle totals used |
| `classifier_version`, `prompt_version`, `model` | so a prompt change marks the window stale |
| `generated_at` | timestamptz |

Unique on workspace, scope node, range start, range end, and classifier version. Delete cascades from the workspace. A review delete does not delete the window; the next read treats a window as stale when any cited review id is gone or the source hash differs.

### What stays where it is

- `grm_reviews` remains the only review body.
- `grm_location_insights.analysis.replyPlaybook` can keep feeding reply drafts until windows carry a playbook. Do not block replies on the new pipeline.
- `grm_insight_feedback` can later point at a window id. Until then it keeps pointing at a location or scope id.
- Embeddings are not a table in the first migrations. Section 9 says when a column would be added, and that it would be a column on `grm_review_signals` in this same database.

---

## 7. Proposed processing pipeline

```
Google listReviews
  → upsert grm_reviews (existing)
  → enqueue a signal job for rows whose source hash changed
  → write grm_review_signals (rules, then model only when the text hash is new)
  → on read of Overview / Insights:
        resolve scope to location ids
        aggregate signals whose reviews fall in the date window
        reuse grm_insight_windows when the hash matches
        otherwise build cards from the aggregates
        call Gemini only to phrase cards that already have counts and review ids
```

Rules:

1. The model never supplies a number that is displayed as a metric. Counts, averages, shares, and reply rates stay on `grm_dashboard_bundle` or on a SQL aggregate over `grm_review_signals`.
2. A card is emitted only when its counts meet the existing thresholds, extended as follows and documented in the UI: a streak needs the same theme code in three consecutive months inside the window; a “new problem” needs zero in the previous window and at least 3 in this window; “worth copying” needs a praise theme with a minimum review count (proposed: 5 reviews at one location, same floor as `TREND_MIN_REVIEWS`). If the floor is not met, the card is omitted.
3. The phrase step receives the counts and the allowed review ids. `parseEvidenceIds` already drops unknown ids. The window writer must also drop ids outside the date window and outside `scope.locationIds`.
4. If Gemini fails, show the counted card with no model sentence. Do not store a sentence that pretends the model wrote it. The current heuristic path that writes “AI unavailable” into the insight summary should not be copied into `grm_insight_windows`.
5. Signal jobs reuse `grm_ai_generation_jobs` only if a new `kind` is added by migration. Until that check constraint is altered, signal work should be a separate small table or a synchronous write inside the existing sync transaction’s follow-up. Do not overload `kind in ('reply', 'location_insight', 'scope_insight')` without a migration. Prefer a new job kind over a new queue product.
6. Do not classify on every page view. Classify when `sync_hash` changes, and when a backfill job walks reviews that have no signal row for the current classifier version.
7. Rating-only reviews skip the model.

The existing reply pipeline stays on the generate button and on automation. It is not part of this ingestion pipeline.

---

## 8. Scope, date range, cache, and freshness

### Scope

Every intelligence read starts with `readPageScope`. The query filter is `workspace_id` plus `location_id = any(scope.locationIds)`. An empty `locationIds` returns no rows. A blocked permission uses `UNAVAILABLE_SCOPE_ID` and must stay empty. Do not turn a blocked scope into null. Null means the whole workspace in `grm_dashboard_bundle`.

Group membership at read time uses the location’s current `group_id` and the current parent city/region. Historical “this review was in Kerala Central in July” is not stored. If a location moves, old reviews appear under the new group. That matches how reviews are attached today. Document it in the UI caption. Do not snapshot group membership per review unless a later product decision asks for it.

### Date range

Use `parseDateRange`. Overview and Insights default to `12m`. Analytics stays on its own default (`6m`) until someone asks to unify it. The window passed to SQL is `[range.start, range.end)` on `review_create_time`, which is what the bundle already uses.

Previous-period comparison uses the existing previous window of the same length. “3 months in a row” uses the monthly buckets already produced for the selected window, not a second hidden clock.

The model brief’s sample average must not be shown next to the window average. After `grm_insight_windows` exists, the brief caption states the same `range.label` as the scorecard.

### Cache and freshness

| Data | Freshness |
| --- | --- |
| Review body | Updated when sync sees a new hash. Incremental sync can lag by up to a day while cron is daily, and it can miss edits that sit behind two unchanged pages. A manual sync remains the way to catch up. |
| Keyword `complaint_theme` | Rewritten in the same upsert as the body. |
| Proposed signals | Invalid when `source_hash` differs from the review. The old signal row is replaced for that classifier version. |
| Proposed windows | Invalid when the signal hash or the bundle totals hash differs, or when a cited review id no longer exists. |
| Existing location and scope insights | One row per target. Stale when the newest-sample fingerprint or the lens fingerprint changes. They ignore the date control. Leave them in place until windows are the source the page reads. |
| Rate limits | Per Node process. A second instance resets them. |
| Dashboard SQL | Computed per request. No application cache. |

`vercel.json` schedules are once a day. That cannot implement a “5 negative reviews in 48 hours” alert by itself if the reviews have not been synced. The attention row can still be computed from reviews already stored. Say “in the last 48 hours of synced reviews” until sync is more frequent. Raising cron frequency is a hosting decision (the 19 October audit noted Hobby may reject a dense schedule). Do not add a queue to poll Google faster than the host allows.

The AI reconciler route is absent from `vercel.json`. Stuck reply and insight jobs wait for the next request that calls `persistAiGenerationJob`, or for a manual hit on `/api/cron/ai-generations`. Add that path to the cron file when `CRON_SECRET` is set. That is operational, and it is independent of the new signal tables.

---

## 9. Embeddings and LLM-assisted clustering

### What the provider can do (checked 20 October 2026)

Sources: [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings) and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). This pass did not call either endpoint.

Generation, already integrated:

| Model id in this repo | Published standard paid price, per 1M tokens | Notes |
| --- | --- | --- |
| `gemini-3.8-flash` | Input $0.75 through 31 December 2026, then $1.50. Output, including thinking tokens, $3.75 through 31 December 2026, then $7.50. | Paid tier is not used to improve Google’s products. Free tier is. |
| `gemini-3.5-flash-lite` | Input $0.30. Output, including thinking tokens, $2.50. | Batch tier on the same page is half of that ($0.15 / $1.25). |

Embeddings, not integrated:

| Model | Input | Price, standard paid, per 1M tokens | Batch |
| --- | --- | --- | --- |
| `gemini-embedding-001` | Text, 2,048 token limit. Output dimensions 128–3072; 768, 1536, and 3072 are the documented recommendations. | $0.15 | $0.075 |
| `gemini-embedding-2` | Text, image, video, audio, PDF. 8,192 token limit. Same dimension choices. | Text $0.20. Images, audio, and video are priced separately and are irrelevant while reviews are text. | Text $0.10 |

`embedContent` is a different method from `generateContent`. `gemini-embedding-2` aggregates multiple inputs into one embedding. Per-review vectors should use one content per call, or the batch API, so reviews do not collapse into a single vector. The batch API is documented at half the standard embedding price when latency is acceptable.

Order-of-magnitude cost, not a quote, assuming paid standard prices through December 2026 and roughly 200 input tokens of review text:

| Work | 10,000 reviews | 100,000 reviews |
| --- | --- | --- |
| One `gemini-embedding-001` pass | about $0.30 | about $3 |
| One short `gemini-3.5-flash-lite` classification (about 200 in and 80 out) | about $2.60 | about $26 |
| One `gemini-3.8-flash` location brief (about 4,000 in and 2,000 out, thinking included in output) | about $0.01 per brief | scales with briefs, not with reviews |

A brief that sends 50 full reviews costs more than one classification of one review, and it cannot be reaggregated when the user changes the date range. Classifying once per changed review is the cheaper way to support every window.

Free tier: Google’s pricing page says free-tier embedding and free-tier Flash usage may be used to improve Google’s products. The workspace key’s tier was not inspected. Do not start a backfill on the free tier.

### Clustering strategy

Do not add a vector database. Postgres in this project has no `vector` extension enabled. Supabase can enable `vector` in the same database; that is still a migration and needs approval. It is not a reason to run a second store.

Order of work:

1. Aggregate keyword themes and star windows. This already answers part of the Overview feed and needs no model.
2. Add `grm_review_signals` with a rules row for every review and a model JSON classification only when the review has text and the hash is new. The model returns a small closed set plus an `other` label, not an open essay. Allowed praise and complaint codes start from the PDF set (staff, billing or wait, parking, exchange, product or quality, cleanliness, price) and keep `other`. Malayalam, Manglish, and Hinglish are in the wireframes. The classifier prompt must accept them. `readableReviewText` is the input when Google stored a translation; otherwise the original comment is the input. Do not invent a translation.
3. Cluster by those codes. “Billing queue is rising” is a count of `complaint` + `billing` in this window versus the previous window. That is the wireframe, and it is auditable.
4. Call the larger model only to write the card sentence from the counts and the allowed ids.
5. Add embeddings only if step 2 leaves a large `other` bucket or fails a labelled sample of Malayalam and Manglish reviews. The column would be `embedding vector(768)` on `grm_review_signals`, model `gemini-embedding-001`, filled by the batch API. Nearest-neighbour grouping stays in SQL. Do not send reviewer names to the embedding endpoint. Embed the readable comment only.

LLM-assisted clustering that asks the model to invent cluster names from raw reviews, without stored ids, is how the current brief works. It does not survive a date-range change and it cannot prove a streak. Do not make that the persistent design.

---

## 10. Tenant isolation, privacy, deletion, and permissions

### Isolation

The service role is the real write path. Row-level security does not apply to it. Every new query must include `workspace_id` from `getActiveWorkspace()` and location ids from `readPageScope`. A missing `.eq("workspace_id", workspaceId)` crosses tenants. `__tests__/tenant-api-isolation.test.ts` is the pattern to extend.

`grm_can_see_location` already limits select policies on `grm_google_locations`, `grm_reviews`, and `grm_escalations`. These tables are workspace-wide for any member of the workspace, and do not call `grm_can_see_location`:

- `grm_location_insights`
- `grm_scope_insights`
- `grm_ai_knowledge`
- `grm_ai_configs`
- `grm_insight_feedback`
- `grm_ai_generation_jobs`

The UI uses the service role and then checks scope in the route, so a store manager using the app is filtered. A direct PostgREST query with the signed-in user can read another location’s insight inside the same workspace. New signal and window tables must use `grm_can_see_location` (via the location id) in their select policies, and the service-role queries must still filter. Fixing the existing insight policies is in the implementation plan because those rows already contain review-derived text.

`grm_groups` and `grm_brands` have row-level security and no select policy. That hides them from the anon key. It does not hide them from the service role.

Google connection tokens are encrypted, and `20261016012_token_columns.sql` revokes anon and authenticated privileges on `grm_google_connections`. Intelligence jobs must not log review text or tokens. `logGeminiFailure` already slices response bodies to 300 characters. Keep review bodies out of that log.

### Privacy

The privacy page (updated 1 October 2026) says Gemini runs when someone asks, sends the review text, stars, and business or location name for a draft, and sends review material for one profile for an insight. It says reviewer names and comments come from Google, and that GRM does not train its own model.

A backfill that classifies every review changes that story: processing would no longer be only “when someone asks”. Update the privacy page in the same change that turns on backfill. Reply prompts already include `reviewer_display_name`. Classification and embedding prompts must not. The location and scope insight prompts today send the comment and the internal review id, not the reviewer name. Keep that.

Staff names that appear inside a review can still be in the comment. The current prompt says not to invent names and to repeat a name only if a review contains it. The card layer should quote the review rather than promote a name into a headline unless the quote is attached.

### Deletion

| Event | Required behaviour |
| --- | --- |
| Review row deleted | Cascade signal rows. Mark windows that cite the id stale on next read. |
| Location deleted | Existing cascade deletes reviews, which deletes signals. |
| Workspace deleted | Cascade signals and windows. |
| Google drops a review and the local row remains | Today the row still counts. Do not auto-delete. A later full sync can set a proposed `missing_on_google_at` only after a full page walk that did not see the `google_review_name`. Incremental sync must not set that flag. This column is a decision, not part of the first migration. |
| Member removed | Signals stay. They are workspace data. Feedback rows already cascade on user delete. |
| Insight feedback and drafts | Already cascade with the review or the user as each foreign key says. |

### Permissions

Reading insights uses `view`. Generating a brief is a mutation and should require `draft` (auditors can view and cannot draft). Store managers and agents can view their scope and must not see other locations in the evidence list. Approving a reply is unchanged: 4–5 stars need `publish_positive`, 1–3 stars need `approve_negative`. Intelligence must not publish.

Group managers edit rules for their own group only. They do not get a new permission to reclassify another group’s reviews.

---

## 11. What has to change

No file in this list was modified for the feature. This is the map for later work.

### Migrations (new, after approval)

1. One migration that makes a single group parent for `grm_google_locations.group_id`, report `group_id`, and onboarding inserts. Data copy from `grm_location_groups` to `grm_groups` where ids differ. Do not drop locations or reviews. Add select policies on `grm_groups` and `grm_brands` using `grm_my_workspace_ids()`, still narrowed by `grm_can_see_location` where a location is involved.
2. `grm_review_signals` as in section 6, with select policy through the review’s location.
3. `grm_insight_windows` as in section 6, with the same location check for `scope_level = location`, and a group/client check consistent with `grm_can_see_location`.
4. Optional later: `alter table grm_review_signals add column embedding vector(768)` only after the `vector` extension is enabled and step 2 of section 9 has failed its acceptance sample.
5. Tighten select policies on `grm_location_insights` and `grm_scope_insights` to the same location rule. This is a behaviour change for any direct API client. The app’s service-role reads keep working.

Do not edit old migration files that have already been applied on the shared project. Add a new file.

### Services

| File | Change |
| --- | --- |
| `lib/services/onboarding.ts` | Write groups to the same table hierarchy uses. |
| `lib/services/review-sync.ts` | After a changed hash, record that the review needs a signal refresh. Do not call Gemini inside the Google page loop. |
| New signal service beside `lib/services/location-insights.ts` | Rules backfill and model classification. |
| `lib/services/location-insights.ts`, `lib/services/scope-insights.ts` | Keep for the current brief and for reply playbooks. Stop treating them as the date-range insight once windows exist. |
| `lib/overview-board.ts` | Read praise and complaint cards from aggregates. Keep the 5-review and 0.15 thresholds for rating movement. |
| `lib/services/insight-evidence.ts` | Resolve evidence quotes from `grm_review_signals` inside the window, not only the latest five 1–3 star samples. |
| `lib/gemini.ts` | Add `embedContent` only in the embedding step. Do not send the API key to the browser. The key is already server-only. |

### Jobs

- Extend the AI job kind check only if signal generation uses that table.
- Add `/api/cron/ai-generations` to `vercel.json` when `CRON_SECRET` is configured.
- A daily backfill bounded by a row limit, after sync, is enough. It must be idempotent on `(review_id, classifier_version, source_hash)`.

### UI

| Component | Change |
| --- | --- |
| `components/insights-board.tsx` | Show the window label on the brief. List evidence quotes that deep-link to the review. |
| `components/client-overview.tsx` / `lib/overview-board.ts` | Card kinds align with counted streaks and praise. Omit a card when the floor is not met. |
| `components/analytics-board.tsx` | Theme heat map can switch to signal codes after they exist. Until then it keeps `complaint_theme`. |
| `app/privacy/page.tsx` | Describe backfill before the backfill flag is turned on. |
| Reviews, escalations | No new data source. Links from cards land in the existing inbox filters. |

There is no question box until a query path can refuse when the answer is not in the stored aggregates. That is out of the first implementation steps.

### Tests

Extend, do not replace:

- `__tests__/hierarchy.test.ts`, `__tests__/scope.test.ts` for one group parent.
- `__tests__/overview-board.test.ts` for streak and praise floors.
- `__tests__/scope-insights.test.ts`, `__tests__/location-insights.test.ts` so a date window cannot be satisfied by a review outside it.
- `__tests__/tenant-api-isolation.test.ts` for signal reads.
- A new test that a quote that is not a substring of the review is rejected.
- `__tests__/review-sync.test.ts` so a disappeared remote review is not deleted.

---

## 12. Implementation plan

Each step depends on the one before it. Do not start a later step by inventing rows the earlier step should have stored. Do not seed demo clients or demo ratings.

### Step 0 — This audit

Done when this file exists and no feature migration has been applied. Acceptance: this document, and `npx vitest run` still passes (it did: 380 tests).

### Step 1 — One group model

Depends on nothing else. Blocks every grouped insight.

Work: a forward migration that makes `grm_google_locations.group_id` and onboarding use `grm_groups`, after copying any `grm_location_groups` rows that are still referenced. Keep both tables until a read-only check shows no location points at `grm_location_groups`. Add the missing select policies. Do not delete reviews.

Acceptance:

- A region and a city under it can be created on a database migrated from `supabase/migrations`.
- A location moved to that city keeps the same `id`, and its reviews keep the same `location_id`.
- A group id from another workspace or another client is rejected.
- `readPageScope` for the region returns the city’s locations.
- `npm test` covers the shape rules already in `lib/hierarchy.ts`.

Approval needed: whether production already has both tables populated with different ids. This pass could not read that catalog.

### Step 2 — Signal rows from rules, then from the model

Depends on step 1 so a group aggregate is meaningful.

Work: add `grm_review_signals`. Write a rules row for every review during sync and in a bounded backfill. Then, for reviews with text and a new hash, call `gemini-3.5-flash-lite` for the closed theme set. Store quotes only when they are substrings. Do not send reviewer names.

Acceptance:

- Re-running the backfill does not duplicate rows and does not call the model when the hash matches.
- A 5-star review can receive a praise theme. A 1–3 star review can still keep `complaint_theme` as it is today.
- A quote that does not occur in the comment is not stored.
- A store manager’s scope returns no signal for a location outside that scope.
- Ten hand-checked reviews (include one Malayalam or Manglish comment if the workspace has one) have theme codes a reviewer agrees with. If more than 3 of 10 fall through to `other` for reasons other than genuinely unclear text, stop and do step 5’s embedding decision. Do not silently widen the prompt.

Approval needed: Gemini billing tier, and permission to process the existing review corpus rather than only on-demand briefs. Privacy page text goes out in the same release.

### Step 3 — Window cache and evidence-backed cards

Depends on step 2.

Work: add `grm_insight_windows`. Overview and Insights read aggregates for `scope.locationIds` and the selected range. Gemini `gemini-3.8-flash` writes the sentence only from those aggregates. Cards that fail the numeric floor are omitted. Existing `grm_location_insights` still feed reply playbooks.

Acceptance:

- Changing `range` changes which reviews are counted, and a review outside the range is absent from `evidence_review_ids`.
- The average shown beside the brief equals `rating_sum / reviews` from the bundle for that same scope and range.
- “Getting worse” still requires 5 reviews in each window and a drop of at least 0.15.
- A three-month streak is three monthly buckets with the same theme code and a non-zero count. If the window is shorter than three months, the streak card is omitted.
- With the model forced to fail in a test, the counted card still renders and no “AI unavailable” sentence is stored in `grm_insight_windows`.
- Evidence links open `/reviews` for that review id inside the same scope.

### Step 4 — Freshness and operations

Depends on steps 2 and 3.

Work: signal refresh when sync changes a hash. Put `/api/cron/ai-generations` on the cron schedule. Keep the daily Google sync. Document the 48-hour attention row as synced data.

Acceptance:

- An edited review gets a new signal row for the new hash and the window hash changes.
- A review that is absent from an incremental page is still in `grm_reviews`.
- With `CRON_SECRET` unset, every cron route still returns 401.
- A stuck `generated` AI job is persisted by the reconciler without a second model call (this is current behaviour; the test should keep it).

Approval needed: the host plan, if anyone wants sync more often than daily.

### Step 5 — Embeddings, only if step 2’s sample fails

Depends on step 2’s acceptance sample failing for multilingual or `other` volume.

Work: enable `vector` in this Postgres, add a 768-dimension column, backfill with `gemini-embedding-001` batch, cluster nearest neighbours into the same theme codes. Do not add another database.

Acceptance:

- The same 10-review sample improves on the failure that justified this step, and a review from another workspace is never a neighbour (the query filters `workspace_id` before distance).
- Embedding text is the readable comment. Reviewer display names are absent from the embed request.
- Cost for the backfill is estimated from token counts before the job starts, using the prices in section 9, and the job stops at a configured review cap.

If step 2’s sample passes, step 5 is not scheduled.

### Explicitly later

These stay out of this plan until their own provider or product decision exists: a question box, competitor ratings, weekly charts, review-request attribution, WhatsApp delivery, and reporting a review to Google. The PDF shows them. The code does not. Intelligence work must not invent those numbers.

---

## Decisions that need approval

1. Group-table merge (step 1), including a live read of which ids `grm_google_locations.group_id` points at on `yzagcxdzlsjpowokqewm`.
2. Whether automatic classification of reviews already in the database is allowed, and that the Gemini key is on a paid tier that is not used to improve Google’s products.
3. The praise-theme floor of 5 reviews, matching `TREND_MIN_REVIEWS`, and the closed theme code list in section 9.
4. Leaving disappeared Google reviews in `grm_reviews` until a full sync can mark them, rather than deleting them.
5. Enabling the `vector` extension at all. Default is no, unless step 2 fails its sample.
6. Setting `CRON_SECRET` and adding the AI reconciler to `vercel.json`.

## Unknowns

- Live foreign keys and whether `20261019003_escalation_assignment.sql` has been applied. Not re-queried on 20 October 2026.
- Whether `gemini-3.8-flash` succeeds with this key. The id is on the public pricing page. This pass did not generate content.
- Actual thinking-token usage, so brief costs in section 9 are estimates from assumed token counts.
- Whether Vercel is Hobby or Pro, which caps how often sync can run.
- How many reviews, locations, and workspaces are in the database. Cost scales with that count. It was not counted in this pass.
