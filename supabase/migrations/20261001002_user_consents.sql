-- One-time acceptance of the Terms and the AI disclosure, per login.

create table if not exists public.grm_user_consents (
  user_id            uuid        primary key references auth.users(id) on delete cascade,
  terms_accepted_at  timestamptz not null,
  ai_accepted_at     timestamptz not null,
  created_at         timestamptz not null default now()
);

comment on table public.grm_user_consents is
  'Recorded the first time a person accepts the Terms and the AI disclosure. Later sign-ins skip that step.';

alter table public.grm_user_consents enable row level security;

drop policy if exists "grm: users can read their own consent" on public.grm_user_consents;
create policy "grm: users can read their own consent"
  on public.grm_user_consents
  for select
  using (user_id = auth.uid());
