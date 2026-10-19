-- Onboarding progress, location groups, verification holds, and invite expiry.
-- Additive only. Existing client assignments and Google connections stay in place.

create table if not exists public.grm_onboarding (
  workspace_id uuid primary key references public.grm_workspaces(id) on delete cascade,
  step text not null default 'connect'
    check (step in ('connect', 'import', 'groups', 'tone', 'invite', 'done')),
  grouping text
    check (grouping is null or grouping in ('state_city', 'city', 'account', 'none', 'csv')),
  tone_voice text
    check (tone_voice is null or tone_voice in ('warm', 'professional', 'brief')),
  tone_note text
    check (tone_note is null or char_length(tone_note) <= 500),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.grm_onboarding is
  'Saved setup progress so a workspace can leave and resume the wizard.';

create table if not exists public.grm_location_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grm_workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  source text not null check (source in ('state_city', 'city', 'account', 'manual', 'csv')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

comment on table public.grm_location_groups is
  'Named groups of Google locations inside a workspace. Clients stay the parent record.';

create index if not exists grm_idx_location_groups_workspace
  on public.grm_location_groups (workspace_id);

alter table public.grm_google_locations
  add column if not exists group_id uuid references public.grm_location_groups(id) on delete set null,
  add column if not exists voice_of_merchant boolean,
  add column if not exists google_duplicate_of text,
  add column if not exists hold_reason text
    check (hold_reason is null or hold_reason in ('duplicate', 'unverified'));

comment on column public.grm_google_locations.voice_of_merchant is
  'Google hasVoiceOfMerchant. Null means Google has not returned it yet.';

comment on column public.grm_google_locations.hold_reason is
  'Blocks automatic grouping and AI drafts. Manual replies stay available.';

create index if not exists grm_idx_google_locations_group
  on public.grm_google_locations (group_id);

alter table public.grm_workspace_invites
  add column if not exists expires_at timestamptz not null default (now() + interval '14 days');

comment on column public.grm_workspace_invites.expires_at is
  'Pending invites stop being accepted after this time. No email is sent.';

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_grm_onboarding_updated_at'
  ) then
    create trigger trg_grm_onboarding_updated_at
      before update on public.grm_onboarding
      for each row execute function public.grm_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_grm_location_groups_updated_at'
  ) then
    create trigger trg_grm_location_groups_updated_at
      before update on public.grm_location_groups
      for each row execute function public.grm_set_updated_at();
  end if;
end $$;

alter table public.grm_onboarding enable row level security;
alter table public.grm_location_groups enable row level security;

drop policy if exists grm_onboarding_select on public.grm_onboarding;
create policy grm_onboarding_select
  on public.grm_onboarding for select
  using (workspace_id in (select public.grm_my_workspace_ids()));

drop policy if exists grm_location_groups_select on public.grm_location_groups;
create policy grm_location_groups_select
  on public.grm_location_groups for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
