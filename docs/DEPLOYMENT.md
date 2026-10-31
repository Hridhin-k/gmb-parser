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
