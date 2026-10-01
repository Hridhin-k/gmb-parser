-- Allow discovered Google locations to exist before they are mapped to a client.
-- The app treats client_id = null as "unlinked" and shows them in the assign panel.
alter table public.grm_google_locations
  alter column client_id drop not null;

comment on column public.grm_google_locations.client_id is
  'Nullable: null means discovered from Google but not yet assigned to a client.';
