# RevuPilot

Google review management with Next.js 16, self-hosted PostgreSQL 18, NextAuth v5,
and the AI SDK. Node.js 22 or newer is required.

## Local setup

Install dependencies with `npm ci`. Keep secrets in the ignored `.env.local`;
[`config/local.env.example`](config/local.env.example) and
[`config/ai.env.example`](config/ai.env.example) list the settings.

With Homebrew PostgreSQL 18 installed:

```sh
npm run db:local
npm run db:migrate
npm run db:seed:local
npm run dev -- --port 3001 --hostname localhost
```

Open [localhost:3000/login](http://localhost:3000/login) and select **Open local test
workspace**. The seed creates an empty workspace and a local tester, without
inventing reviews or importing production data. Accept the consent screen to
continue. Google Business Profile can be connected through Settings.

`db:local` creates a dedicated cluster under ignored `.local/postgres`, listens
only on `127.0.0.1:55432`, and writes generated credentials and an auth secret to
`.env.local` with mode 600. It never manages another project's database or the
Homebrew service. Override `POSTGRES_BIN` and `LOCAL_POSTGRES_PORT` if needed.
Stop this cluster with `npm run db:local -- stop`. Run the same start command to
reuse it. Keep `.local` to preserve your local data.

For an existing PostgreSQL server, set `DATABASE_URL` to the application role and
`DATABASE_MIGRATION_URL` to its schema owner, then run `npm run db:migrate`.
Use a **new, dedicated database**: the baseline replaces the old Supabase history;
it does not import an existing Supabase database. Migrations are transactional,
checksum-checked, and serialized with an advisory lock. The runner grants data
access to the runtime role; it must already exist and must not be a superuser.
The runtime does not need the owner's credentials. PostgreSQL 18 is the tested
version.

## Authentication

Google login uses NextAuth's `/api/auth/callback/google`. Register
`http://localhost:3000/api/auth/callback/google` as an authorized redirect URI in
the Google OAuth client. Business Profile authorization is a separate flow and
still needs `http://localhost:3000/api/google/callback`, matching
`GOOGLE_REDIRECT_URI`. Set `AUTH_URL` and `NEXT_PUBLIC_APP_URL` to the app's origin.

With `AUTH_DEV_OPEN_SIGNUP=true`, signed-in users on a loopback development
server can create their own organization without an invite. This is disabled
in production. Blocked accounts, suspended/deleted workspaces, and expired plans
remain restricted.

Production uses opaque, revocable database sessions and Google OAuth. Login
requires verified Google email; workspace membership, invites, consent,
suspension, and scoped permissions remain enforced by the application. Set
`SUPER_ADMIN_EMAILS` for the platform administrators who issue new tenant invites.

The local helper requires development mode, `AUTH_DEV_LOGIN=true`, a loopback
`AUTH_URL`, and a generated `AUTH_DEV_LOGIN_TOKEN`. Its secret stays server-side.
It uses a seeded tester and JWT sessions only during this explicit local mode.
It is disabled in production even if the flags are copied. Password recovery,
SMS OTP, enterprise SSO, and evidence storage are not configured; their former
Supabase methods are no longer advertised by the login UI.

## Database access

Server services use a parameterized SQL query layer over a bounded `pg` pool.
Embedded relations compile to SQL JSON projections; analytics call PostgreSQL
functions directly. There is no Supabase service, PostgREST server, HTTP database
gateway, browser database client, or service-role key.

`@supabase/postgrest-js` is a **development-only type dependency** for the existing
service layer's selection inference. It is imported with `import type` and is
never instantiated or included in runtime database access. Schema types live in
`lib/types/database-schema.ts`; regenerate the checked SQL metadata after schema
changes with `npm run db:metadata`.

Tenant authorization lives in the server services. Composite tenant foreign keys
also reject cross-workspace child relationships in PostgreSQL. The database is
private to the server; it is not a browser-accessible API. The application role
can access domain and auth data, while schema migrations use the owner role.

The migration retains the product's current domain tables and analytics.
Onboarding import buckets have their own location FK, separate from the editable
region/city hierarchy. Daily/weekly insight rollups, a persistent worker, shared
Redis rate limits/caches, separate auth runtime credentials, and transactional AI
budget reservations remain the next architecture phase described in
[`docs/DATABASE_ARCHITECTURE_V2.md`](docs/DATABASE_ARCHITECTURE_V2.md).

## AI provider configuration

All generation uses direct AI SDK provider connections. For Gemini:

```dotenv
AI_PROVIDER="google"
AI_MODEL="gemini-3.8-flash"
GOOGLE_GENERATIVE_AI_API_KEY="your-key"
```

To switch, set `AI_PROVIDER="openai"`, `AI_MODEL="gpt-6-luna"`, and
`OPENAI_API_KEY`. Optional paired `AI_EXTRACT_*`, `AI_REPLY_*`, `AI_REPLY_FAST_*`,
and `AI_INSIGHT_*` settings override the default. Restart after env changes.
No Vercel account or AI Gateway is needed. `GEMINI_API_KEY` is no longer read.

Fallback is disabled unless both `AI_FALLBACK_PROVIDER` and `AI_FALLBACK_MODEL`
are set. Unknown model prices require `AI_PRICES_JSON` with input/output USD per
million tokens. The Postgres baseline includes per-attempt history and atomic,
idempotent monthly usage increments. Budget checks remain best effort and do not
reserve spend atomically. Unknown provider outcomes are recorded as unknown.
See [`docs/AI_PROVIDER_ARCHITECTURE.md`](docs/AI_PROVIDER_ARCHITECTURE.md).

## Verification

```sh
npm test
npx next typegen && npx tsc --noEmit
npm run build
RUN_DATABASE_TESTS=1 npm test -- --run __tests__/postgres.integration.test.ts
```

The integration suite requires the dedicated loopback database on port 55432,
creates isolated fixtures, and removes them afterward. Ordinary tests make no
paid AI calls. Add `RUN_AI_SMOKE=1` to the integration command only to make one
small real generation and verify its usage record.
