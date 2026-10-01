-- Pending workspace invites, accepted when that email signs in.
-- `active` marks which workspace the app opens when a person belongs to more than one.

alter table public.grm_workspace_members
  add column if not exists active boolean not null default false;

create unique index if not exists grm_workspace_members_one_active
  on public.grm_workspace_members (user_id)
  where active;

create table if not exists public.grm_workspace_invites (
  id           uuid              primary key default gen_random_uuid(),
  workspace_id uuid              not null references public.grm_workspaces(id) on delete cascade,
  email        text              not null check (
                                 email = lower(email)
                                 and char_length(email) >= 3
                                 and char_length(email) <= 320
                               ),
  role         grm_member_role   not null default 'member' check (role in ('admin', 'member')),
  invited_by   uuid              not null references auth.users(id) on delete cascade,
  status       text              not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at   timestamptz       not null default now(),
  accepted_at  timestamptz,
  unique (workspace_id, email)
);

create index if not exists grm_workspace_invites_pending_email
  on public.grm_workspace_invites (email)
  where status = 'pending';

comment on table public.grm_workspace_invites is
  'Email invite into a workspace. Accepted on the invitee''s next sign-in. No email is sent.';

alter table public.grm_workspace_invites enable row level security;

drop policy if exists "grm: workspace members can view invites" on public.grm_workspace_invites;
create policy "grm: workspace members can view invites"
  on public.grm_workspace_invites
  for select
  using (workspace_id in (select public.grm_my_workspace_ids()));
