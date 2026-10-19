-- Encrypted Google tokens must not be readable or writable through PostgREST.
-- A table-level SELECT grant covers every column, so a column revoke does not
-- remove it. The server reads and writes this table with the service role.

revoke all on table public.grm_google_connections from anon, authenticated;
