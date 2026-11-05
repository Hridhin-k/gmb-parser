-- Public reply contacts are maintained separately from Google's synced phone.
ALTER TABLE public.grm_google_locations
  ADD COLUMN IF NOT EXISTS resolution_phone text,
  ADD COLUMN IF NOT EXISTS resolution_email text;
