This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## AI provider configuration

Use Node.js 22 or newer (required by AI SDK 7).

All generation uses the AI SDK with direct provider connections. Copy the settings in
[`config/ai.env.example`](config/ai.env.example) into your ignored `.env.local`:

```dotenv
AI_PROVIDER="openai"
AI_MODEL="gpt-6-luna"
OPENAI_API_KEY="your-key"
```

`AI_PROVIDER` is `openai` or `google`. Google routes require
`GOOGLE_GENERATIVE_AI_API_KEY`. There are no implicit Gemini defaults and the old
`GEMINI_API_KEY` setting is no longer read. Optional paired `AI_EXTRACT_*`,
`AI_REPLY_*`, `AI_REPLY_FAST_*` and `AI_INSIGHT_*` settings override the default.
Set both provider and model for an override. Restart the server after env changes.

Fallback is disabled unless both `AI_FALLBACK_PROVIDER` and `AI_FALLBACK_MODEL` are
set. Models without a built-in estimate require `AI_PRICES_JSON`, keyed by
`provider:model`, with `input` and `output` USD per million tokens. All keys stay
server-side. The SDK connects directly; no Vercel account or AI Gateway is needed.

Apply `supabase/migrations/20261027001_ai_provider_usage.sql` to an existing database
before enabling AI. It adds attempt history and atomic usage increments, including
previews and insight synthesis. This branch retains the current database/auth;
the Postgres/NextAuth replacement is described in `docs/DATABASE_ARCHITECTURE_V2.md`.
Budget checks use recorded estimates and remain best effort; they do not reserve
budget atomically for concurrent calls. Provider usage with an unknown outcome is
recorded as unknown, not confirmed free usage.

Run `npm test`, `npx next typegen && npx tsc --noEmit`, and `npm run build` to verify
changes without calling a paid AI API. See `docs/AI_PROVIDER_ARCHITECTURE.md` for the
routing contract and the larger worker/budget design.
