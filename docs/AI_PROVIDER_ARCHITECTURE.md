# AI provider architecture

Implemented on Launch · 27 October 2026

## Framework and scope

All five generation paths use AI SDK Core and its direct OpenAI/Google provider registry. No Vercel hosting, gateway account or proxy service is required. The application service owns routing, credential/price validation, budget prechecks, error handling and usage recording. Provider SDKs handle API protocols and structured generation.

Migrated callers: reply drafts, settings previews, single-review extraction, batched review extraction and report synthesis. The old Gemini HTTP helper, implicit model defaults, key setting and automatic model escalation have been removed. Provider-specific options stay inside the registry; business services use task names and schemas.

Postgres and NextAuth now replace Supabase. Server services connect directly through `pg`, and the fresh baseline lives in `db/migrations`. The persistent worker, time-based rollups, Redis, and budget-reservation design remain proposed in [DATABASE_ARCHITECTURE_V2.md](DATABASE_ARCHITECTURE_V2.md). Background execution otherwise keeps the current application paths.

## Configuration

Copy [config/ai.env.example](../config/ai.env.example) into the ignored `.env.local`, then fill the selected provider's key:

```dotenv
AI_PROVIDER="openai"
AI_MODEL="gpt-6-luna"
OPENAI_API_KEY=""
```

GPT-6 Luna is an OpenAI model, not a separate provider. Native model IDs are passed unchanged. Supported provider IDs are `openai` and `google`; Google uses `GOOGLE_GENERATIVE_AI_API_KEY`. There is no implicit default route or compatibility alias for `GEMINI_API_KEY`.

Optional override pairs:

| Settings | Purpose |
| --- | --- |
| `AI_EXTRACT_PROVIDER`, `AI_EXTRACT_MODEL` | Single and batched review extraction |
| `AI_REPLY_PROVIDER`, `AI_REPLY_MODEL` | Reply generation and settings previews |
| `AI_REPLY_FAST_PROVIDER`, `AI_REPLY_FAST_MODEL` | Short positive reviews when the existing deterministic router selects fast |
| `AI_INSIGHT_PROVIDER`, `AI_INSIGHT_MODEL` | Report narrative synthesis |
| `AI_FALLBACK_PROVIDER`, `AI_FALLBACK_MODEL` | Explicit fallback; disabled if both are blank |

Both settings in an override must be present, or both blank. Blank overrides inherit the default. Without a fast override, fast replies use the normal configured reply model. Changing a provider cannot accidentally inherit a model ID from another provider. Only selected providers and configured fallback need credentials.

Configuration is read at call time. Restart the server after editing `.env.local`. Existing saved analyses retain their original provenance and are reused under the same semantic analysis version; switching providers alone does not pay to re-extract all history. Report cache identities include primary and fallback provider/model configuration so a newly selected route does not reuse an artifact under the old identity.

## Generation contract

```text
Review/report service
        ↓
AI application service: route, price, budget, accounting, validation
        ↓
AI SDK registry: explicit direct providers
        ↓
OpenAI Responses API | Google Generative AI API
```

The shared service accepts task, operation, tenant, prompt, output budget, deadline and optional Zod schema. It returns text/structured JSON, `provider:model` provenance, normalized usage and the actual generation parameters. No credentials are returned or persisted.

Extraction and synthesis use schema-constrained output and application validation. Existing source-quote, review-ID, severity and reply guardrails remain in the business layer. Refusals, empty answers, truncation and incomplete finish states cannot be saved as complete generated results. OpenAI uses Responses with `store: false`. The known Luna profile uses low reasoning effort; Google thinking settings are mapped only for known model families. Unknown models retain native defaults and need an explicit compatibility/quality check before rollout.

## Failures and fallback

SDK automatic retries are disabled. Existing bounded application retries honor the shared error's retryable flag. Explicit fallback is allowed for classified transient API errors, with a fresh budget check and a separate attempt record. It is not used for invalid credentials/models, schema failures, safety blocks, empty/incomplete output or unknown network outcomes.

A timeout/connection loss can mean the provider accepted and charged a request. Unknown outcomes are recorded as unknown usage; they do not trigger automatic cross-provider fallback. The caller may explicitly retry later, which can incur another charge. There is no exactly-once billing guarantee.

Errors returned to callers and logs use safe messages/codes rather than raw provider bodies, request prompts or secret-bearing SDK exceptions.

## Usage, prices and database migration

Run `npm run db:migrate` before enabling AI on a fresh database. The native Postgres baseline includes per-attempt history and an atomic function that inserts each event once and increments monthly totals without lost updates. It accounts for previews and report synthesis too. Public function execution is revoked; only the private server runtime role is granted access.

Every generated attempt records its operation, provider-qualified model, input/output counts, outcome, usage-known flag and estimated charge. Usage is recorded before downstream validation/persistence, including valid provider responses that later fail a schema or guardrail. Reasoning tokens are already included in SDK output totals and are not added twice.

Built-in standard estimates cover OpenAI Luna and the two previously used Google model IDs. Other models require explicit rates:

```dotenv
AI_PRICES_JSON='{"openai:your-model":{"input":0.20,"output":1.00}}'
```

Rates are USD per million tokens and must be finite and non-negative. Unknown prices fail before provider invocation rather than silently counting as free. Cached input uses a conservative uncached estimate; cache writes include an allowance, and the known Luna long-context premium is applied. These estimates are not provider invoices. Grouping reviews in a synchronous prompt does not receive a native provider Batch API discount.

The existing workspace monthly budget is checked before each primary/fallback attempt. This is an estimated-spend precheck, not a transactional reservation: concurrent calls can overshoot the cap, unavailable budget tracking currently passes open, and usage recording remains best effort. Unknown usage is explicitly flagged but cannot be accurately priced from missing token counts.

## Code map

| File | Responsibility |
| --- | --- |
| `lib/ai/config.ts` | Env pairs, task routing, credentials and cache identity |
| `lib/ai/registry.ts` | Direct provider instances and provider-specific options |
| `lib/ai/schemas.ts` | Zod extraction and synthesis contracts |
| `lib/ai/service.ts` | Generation, budget precheck, accounting and safe failures |
| `lib/ai-usage.ts` | Model estimates and custom rates |
| `lib/services/ai-usage-ledger.ts` | Atomic RPC call and workspace spend lookup |

## Verification and next phase

Tests exercise actual AI SDK generation with mocked providers, direct OpenAI Responses request formatting, Google request formatting, routing, structured output, error/fallback behavior, token normalization and existing business guardrails. An isolated local Postgres check validates the new migration, concurrent increments, duplicate-event idempotency and anonymous access denial. No paid provider calls are needed for these checks; live account availability and multilingual quality still need rollout smoke tests.

The next database/worker phase adds transactional budget reservations, durable route-version pinning, shared provider rate limits, native asynchronous batch lifecycle and richer call provenance/reconciliation. Those are not implied by the SDK integration.

## Primary references

- [AI SDK provider registry](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- [AI SDK Apache-2.0 license](https://github.com/vercel/ai/blob/main/LICENSE)
- [AI SDK direct Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google)
- [OpenAI GPT-6 Luna capabilities](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
