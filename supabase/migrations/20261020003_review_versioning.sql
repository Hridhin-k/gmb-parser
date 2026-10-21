-- Review version fingerprints and open-job uniqueness.
-- Additive. Does not change sync_hash and does not delete reviews.
--
-- Reverse:
--   drop index if exists public.grm_idx_intelligence_jobs_due;
--   drop index if exists public.grm_intelligence_jobs_open_review;
--   drop index if exists public.grm_idx_reviews_missing_on_google;
--   drop index if exists public.grm_idx_reviews_content_fingerprint;
--   alter table public.grm_reviews drop column if exists downstream_stale_at;
--   alter table public.grm_reviews drop column if exists missing_on_google_at;
--   alter table public.grm_reviews drop column if exists response_fingerprint;
--   alter table public.grm_reviews drop column if exists content_fingerprint;

alter table public.grm_reviews
  add column if not exists content_fingerprint text,
  add column if not exists response_fingerprint text,
  add column if not exists missing_on_google_at timestamptz,
  add column if not exists downstream_stale_at timestamptz;

comment on column public.grm_reviews.content_fingerprint is
  'SHA-256 of canonical star rating, comment, and create time. grm_review_intelligence.content_hash stores this value. sync_hash still includes Google update times so a timestamp-only change is stored without reprocessing.';

comment on column public.grm_reviews.response_fingerprint is
  'SHA-256 of the canonical Google reply comment. An empty reply has a stable hash. A reply-only change invalidates summaries and does not reclassify the review text.';

comment on column public.grm_reviews.missing_on_google_at is
  'Set only after a full location sync that finished every page without a provider error and did not see this google_review_name. Incremental sync and any failed or truncated sync must leave it null. The review row is kept.';

comment on column public.grm_reviews.downstream_stale_at is
  'When the content or Google reply fingerprint last changed. A ready summary generated before this instant is stale.';

create index if not exists grm_idx_reviews_content_fingerprint
  on public.grm_reviews (workspace_id, location_id, content_fingerprint);

create index if not exists grm_idx_reviews_missing_on_google
  on public.grm_reviews (workspace_id, location_id)
  where missing_on_google_at is not null;

-- One open classify/embed/summary job per review version. A repeated sync does not queue a second row.
create unique index if not exists grm_intelligence_jobs_open_review
  on public.grm_intelligence_jobs (workspace_id, operation, review_id, source_hash)
  where status in ('queued', 'running')
    and review_id is not null;

create index if not exists grm_idx_intelligence_jobs_due
  on public.grm_intelligence_jobs (workspace_id, status, not_before);
