# Deployment (self-hosted, Docker)

Runs on any Linux VPS with Docker (tested design: Hetzner + Coolify or plain compose).

1. `cp config/production.env.example .env` and fill every value. Do not set `AUTH_DEV_*`.
   Passwords in `DATABASE_URL` / `DATABASE_MIGRATION_URL` must match `GRM_APP_PASSWORD` / `POSTGRES_OWNER_PASSWORD`.
2. `docker compose up -d db`
3. `docker compose --profile tools run --rm migrate` (re-run after every release that adds a migration)
4. `docker compose up -d --build app cron`
5. Put a TLS reverse proxy (Caddy, nginx, or Coolify) in front of `127.0.0.1:3000`.
6. Add `https://your-domain.com/api/auth/callback/google` and `/api/google/callback` to the Google OAuth client.

The `cron` service replaces `vercel.json`: schedules live in `deploy/crontab` (UTC) and call
`/api/cron/*` with `CRON_SECRET`. Check them with `docker compose logs cron`.
Health: `GET /api/health` (also the container healthcheck).

Backups (not automated here): nightly
`docker compose exec -T db pg_dump -U grm_owner grm | gzip > grm-$(date +%F).sql.gz`, copied off the box.

## Railway

Project `grm-reviews` (production): services `app` (root `Dockerfile`), `cron`
(`RAILWAY_DOCKERFILE_PATH=deploy/Dockerfile.cron`, `APP_URL=http://app.railway.internal:3000`) and `Postgres` (18).
- Deploy: pushing to the `Launch` branch deploys `app`. `cron` also follows `Launch`, but only redeploys when `deploy/` changes.
  `railway up --service app --ci` still works for a manual deploy.
- Migrations run automatically before each `app` deploy: the pre-deploy command is `node scripts/db-migrate.mjs`, using `DATABASE_MIGRATION_URL`
  (a reference to `${{Postgres.DATABASE_URL}}`). If a migration fails, the new version does not go live and the old one keeps running.
  A release must keep working with the previous code's schema during the switch, so never drop a column in the same release that stops using it.
- To run migrations by hand: `railway connect Postgres --tunnel-only -P 55433`, then
  `DATABASE_MIGRATION_URL=postgresql://postgres:<PGPASSWORD>@127.0.0.1:55433/railway DATABASE_URL=<app role url> node scripts/db-migrate.mjs`.
- The runtime role is `grm_app`; `DATABASE_URL` on `app` uses the private host `postgres.railway.internal`.
