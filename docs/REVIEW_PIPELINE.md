# Location review pipeline

Sync captures explicit location IDs after workspace and member-access checks.
The server resolves each connection through its location's Google account.
`POST /api/reviews/sync` persists jobs and responds with `202` and job IDs.
An empty selection never expands to the workspace. An explicit organisation
"Sync all" resolves to the caller's accessible locations.

## Execution and recovery

`grm_location_pipeline_jobs` holds one active job per workspace/location.
Phases are fetching, analysing, summarising, and done. Session advisory locks
prevent overlapping workers even if a slow worker's lease appears expired.
Leases heartbeat while provider requests run. No transaction is held open
during provider calls.

Fetch slices save the next Google page token, counts, and full-crawl seen names.
A crash before a checkpoint can re-fetch committed pages safely. Full-crawl
absence detection runs only after every page succeeds; an interrupted crawl
cannot mark unseen reviews as deleted. Scheduled sync reconciles in full on
Sundays and incrementally on other days.

Analysis reuses ready results for the current content fingerprint and analysis
version. Written reviews are batched up to 25 reviews and an estimated token
limit. Rating-only reviews need no model call. Observation replacement checks
the live review and commits all derived observations and the ready status in
one transaction. Edited reviews cannot publish an analysis of their old text.
Per-location analysis locks are shared by manual runs, reports, and sync jobs.

Transient failures retry with backoff, with five attempts before a terminal
failure/partial result. Successful reviews survive retries. Missing AI
configuration leaves reviews saved and explicitly marks the job partial.

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

Run `npm run db:migrate` to apply migrations 0009 and 0010. Metadata is checked
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
