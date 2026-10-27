-- Inbox exact totals filter `missing_on_google_at IS NULL` and currently use a
-- Bitmap Heap Scan on grm_idx_reviews_workspace (~12 ms / 40k visible reviews
-- on the local bench), visiting ~1558 heap blocks to recheck the filter.
--
-- A partial index matching that predicate lets Postgres Index Only Scan the
-- count. On the largest local tenant: ~12 ms → ~5 ms, index size ~712 kB
-- (similar to grm_idx_reviews_workspace). The page query already uses
-- grm_idx_reviews_create_time (~0.03 ms) and is left alone.
--
-- Exact count semantics are unchanged — the Reviews UI shows
-- "{n} matching" and ceil(total / pageSize). This index does not approximate.
--
-- Write trade-off: every insert/update that changes visibility maintains the
-- partial index. Soft-deletes (setting missing_on_google_at) move rows out of
-- the index, which is the intended path.
-- Do not apply this to production until it has been reviewed.

create index if not exists grm_idx_reviews_visible_workspace
  on public.grm_reviews (workspace_id)
  where missing_on_google_at is null;
