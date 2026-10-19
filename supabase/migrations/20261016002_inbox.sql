-- Inbox assignment, detected language and complaint theme, reopen marker, and notes.
-- Additive. Reply status values stay the existing enum.

alter table public.grm_reviews
  add column if not exists review_language text,
  add column if not exists complaint_theme text,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists reopened_at timestamptz;

comment on column public.grm_reviews.review_language is
  'Script-based language of the review text. none means there is no text. Not a Google language code.';

comment on column public.grm_reviews.complaint_theme is
  'Keyword theme for a 1–3 star review. Null on 4–5 star reviews.';

comment on column public.grm_reviews.reopened_at is
  'Set when Google changes the text or stars after a reply was published.';

create index if not exists grm_idx_reviews_language
  on public.grm_reviews (workspace_id, review_language);

create index if not exists grm_idx_reviews_theme
  on public.grm_reviews (workspace_id, complaint_theme);

create index if not exists grm_idx_reviews_assignee
  on public.grm_reviews (workspace_id, assigned_to);

create table if not exists public.grm_review_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  review_id uuid not null references public.grm_reviews(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table public.grm_review_notes is
  'Internal notes on a review. They are not published to Google.';

create index if not exists grm_idx_review_notes_review
  on public.grm_review_notes (review_id, created_at desc);

alter table public.grm_review_notes enable row level security;

drop policy if exists grm_review_notes_select on public.grm_review_notes;
create policy grm_review_notes_select
  on public.grm_review_notes for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
