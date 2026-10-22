-- Review sync recovery: per-location sync state and full-crawl marker.
--
-- Why:
--   * `grm_google_locations.sync_status` (and friends) are written by
--     ReviewSyncService and declared in the generated types, but no migration
--     ever created them, so location sync-state updates failed silently.
--   * Review sync used `last_synced_at` to decide "first sync = full crawl",
--     but location discovery stamps `last_synced_at` before any review is
--     fetched. `reviews_full_synced_at` is set only after a full crawl
--     finishes every page without failing, and is the marker sync now uses.
--
-- Reverse:
--   alter table public.grm_google_locations
--     drop column if exists reviews_full_synced_at,
--     drop column if exists sync_error,
--     drop column if exists sync_completed_at,
--     drop column if exists sync_started_at,
--     drop column if exists sync_status;
--   drop type if exists public.grm_sync_status;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'grm_sync_status') then
    create type public.grm_sync_status as enum ('idle', 'syncing', 'success', 'partial', 'failed');
  end if;
end $$;

alter table public.grm_google_locations
  add column if not exists sync_status public.grm_sync_status not null default 'idle',
  add column if not exists sync_started_at timestamptz,
  add column if not exists sync_completed_at timestamptz,
  add column if not exists sync_error text,
  add column if not exists reviews_full_synced_at timestamptz;

comment on column public.grm_google_locations.sync_status is
  'Outcome of the last review sync for this location. A sync that stopped before reading every page (incremental cap, page failure) is partial, never success.';
comment on column public.grm_google_locations.reviews_full_synced_at is
  'When a full review crawl last finished every page without a provider or storage failure. Null means the location has never been fully crawled and the next sync must run in full mode.';
comment on column public.grm_google_locations.total_review_count is
  'Review total reported by Google (listReviews totalReviewCount) at the last sync. Compare with the local grm_reviews count to detect sync gaps.';
