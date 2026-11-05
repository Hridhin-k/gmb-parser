# Location review pipeline

Sync captures explicit location IDs after workspace and member-access checks.
The server resolves each connection through its location's Google account.
`POST /api/reviews/sync` persists jobs and responds with `202` and job IDs.
An empty selection never expands to the workspace. An explicit organisation
"Sync all" resolves to the caller's accessible locations.

## Period selection

The Sync button opens a period picker, defaulting to the page period or Last
30 days when no period is selected. All time requires explicitly choosing it.
Each job freezes its period and exact start/end instants. Fetching, analysis
and summary rebuilds all use those bounds. A different period cannot silently
reuse or widen an active job. Existing older reviews remain stored.

Google's reviews.list API has no date filter or creation-time sort. It orders
by updateTime descending. We page until updates are older than the requested
start, filtering creation times against both period bounds before saving.
An old review edited recently cannot prematurely end pagination. Period-bound
fetches never mark unseen older reviews missing or claim a full-history crawl.
Scheduled Google sync and insights catch-up use Last 30 days; historical AI
backfill is explicit opt-in. Deploying 0012 pauses legacy unbounded jobs.

## Execution and recovery

`grm_location_pipeline_jobs` holds one active job per workspace/location.
Phases are fetching, analysing, summarising, and done. Session advisory locks
prevent overlapping workers even if a slow worker's lease appears expired.
Leases heartbeat while provider requests run. No transaction is held open
during provider calls.

Every committed Google page checkpoints its next token and counts; the final
page is marked complete. A crash before that checkpoint can safely replay the
page, while a crash after the final checkpoint skips Google entirely. Expired
Google page tokens restart only that period's fetch; upserts remain idempotent.
Full-history absence detection is unavailable to period-bound jobs.

Analysis reuses ready results for the current content fingerprint and analysis
version. Written reviews are batched up to 25 reviews and an estimated token
limit. Rating-only reviews need no model call. Observation replacement checks
the live review and commits all derived observations and the ready status in
one transaction. Edited reviews cannot publish an analysis of their old text.
Per-location analysis locks are shared by manual runs, reports, and sync jobs.

Transient failures retry with backoff, with five attempts before pausing for
manual attention. AI credit exhaustion, workspace budgets and configuration
failures pause immediately and persist a workspace AI block. Already-started
batches are allowed to commit; no following batch group is started. Later jobs
can fetch reviews, but cannot make further AI calls while that block exists.
Unknown provider outcomes and timeouts pause the job rather than automatically
repeating a potentially billed request. Missing configuration also pauses.

POST /api/reviews/sync/resume rechecks workspace permissions and location
access, clears an acknowledged funding/configuration block, and resumes the
same job/phase/checkpoint/frozen period. It never re-fetches if analysis was the
unfinished phase. Successful per-review analyses are reused unchanged. Summary
recovery repeats only dirty day rebuilds. Browser bookmarks restore progress
after a reload; the database is authoritative if local storage is unavailable.

Recovery is from the last committed checkpoint, not an exactly-once guarantee
for external AI calls: a provider may finish a request whose response is lost.
In that case, check the provider before explicitly resuming; a missing result
may require another paid call. Completed persisted results are never repeated.

## Reply publishing and missing reviews

A 404 from Google's reply endpoint does not establish that a review was deleted.
Publishing checks the review with `reviews.get`. A readable review gets one
additional write attempt, or is reconciled if Google already stores the approved
reply. A second write-time 404 reports a publishing problem and keeps the review.
Network or server failures on a write retain the uncertain-outcome state.

When `reviews.get` also returns 404, the same account must successfully list
reviews for the same parent location, without returning the supposedly missing
review. Only then is `missing_on_google_at` set. This targeted check does not
require fetching unrelated review history or running AI analysis. Missing
reviews leave the active queues; their rows and reply history remain stored.
Later syncs clear the marker if Google returns the review again. Failed or
inconclusive access checks never hide a review.

## Daily summaries and reports

Review and analysis triggers advance revisions in `grm_insight_days`. Both old
and new days are dirtied if a review's date changes. Reply-only edits leave
review insight analysis reusable. Missing/deleted reviews are excluded.

`grm_daily_insights` stores structured coverage, rating totals, topic and
sentiment counts, relationships, severe incidents, and representative evidence
references. These summaries need no additional AI call. Denominators include
successfully analysed written reviews with zero observations. Singleton topic
pairs remain in daily records so recurring pairs across days can be counted.

Days follow `review_timezone` on a location, falling back to the workspace's
escalation-policy timezone and then Asia/Kolkata, matching the existing product
default. Timezone changes rebuild the applicable partitions. Calendar-day
bounds handle DST. Custom/rolling ranges read only boundary-day fragments from
observations; complete intervening days reuse summaries. Fragment fingerprints
describe actual source reviews, so a clock shift without changed source data
does not force a new AI report.

Reports merge daily counts for any requested period, including all time, and
use AI only to explain the resulting evidence. Current and comparison period
versions both participate in report reuse. Saved insights retain excerpts and
review references. Changes mark dependent reports stale, including new data in
a previously empty comparison interval. The previous report remains readable;
the customer can refresh its narrative on demand. Sync updates the daily data
without automatically paying for every possible report narrative.

## Deployment

Run `npm run db:migrate` to apply all checked-in migrations, including 0012. Metadata is checked
in with the source. Deploy the web app and the updated cron image: the
`review-pipeline` endpoint is called every minute by `deploy/crontab` and the
Vercel schedule. It resumes queued/interrupted jobs without an open browser.
The POST and status routes can also kick off bounded slices for responsiveness.
`CRON_SECRET` protects scheduler endpoints. The worker needs the existing Google
and AI configuration; monthly AI budgets remain enforced by `generateAi`.

## Verification

`npm test`, `npm run lint`, and `npm run build` cover the normal checkout.
For the dedicated loopback Postgres sandbox, run:

```sh
RUN_DATABASE_TESTS=1 npx vitest run __tests__/location-pipeline.integration.test.ts __tests__/postgres.integration.test.ts
```

The pipeline integration suite mocks Google and AI, and exercises real leases,
locks, triggers, daily boundaries, changed/deleted reviews, report reuse,
location isolation, and grouped notifications. It makes no paid calls.
