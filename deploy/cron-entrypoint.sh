#!/bin/sh
set -e
[ -n "$CRON_SECRET" ] || { echo "CRON_SECRET is required" >&2; exit 1; }
# busybox crond does not pass the environment to jobs; persist what run-cron needs.
printf 'CRON_SECRET=%s\nAPP_URL=%s\n' "$CRON_SECRET" "${APP_URL:-http://app:3000}" > /etc/cron.env
chmod 600 /etc/cron.env
cp /deploy/crontab /etc/crontabs/root
exec crond -f -l 8
