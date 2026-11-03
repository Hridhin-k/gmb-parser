# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined at build time.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1
# Route modules read DATABASE_URL at import time; the build never connects.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build

# One-shot migration runner: `docker compose run --rm migrate`
FROM node:22-alpine AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY scripts ./scripts
COPY db ./db
CMD ["node", "scripts/db-migrate.mjs"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Railway's pre-deploy step runs migrations from this image. pg and @next/env
# are already in the standalone node_modules.
COPY --from=build --chown=app:app /app/scripts/db-migrate.mjs ./scripts/db-migrate.mjs
COPY --from=build --chown=app:app /app/db ./db
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
