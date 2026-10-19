# RevuPilot implementation audit

Checked on 17 October 2026 against `docs/RevuPilot Wireframes (1).pdf` (15 pages) and the application in this workspace. Git history was not used.

Each requirement is one of:

- **Implemented and verified** — the current screen, stored result, or denial was checked in this pass.
- **Partially implemented** — the code path exists, and a screen or unit test covers part of it. A live mutation, provider delivery, or first-run completion was not repeated in this pass.
- **Not applicable** — the requirement does not apply, with the reason.
- **Blocked** — the product cannot finish the requirement until the named external dependency exists.

This pass did not publish a reply to Google, complete a new Google OAuth grant, send email, SMS, WhatsApp, or Slack, or leave new test rows.

## Verdict

The application is not production-ready. Signed-in screens render this workspace’s stored reviews, clients, settings, and audit history. Scheduled jobs cannot run because `CRON_SECRET` is unset, and they fail closed with 401. Email, Slack, WhatsApp, and SMS are not configured, and the screens say so. `npm run build` completes. That does not make the unset providers or the missing cron secret operational.

## What this pass checked

Signed in as the workspace owner, in the browser:

| Viewport | Routes | Result |
|---|---|---|
| 1280 | `/overview`, `/reviews`, `/escalations`, `/analytics`, `/reports`, `/requests`, `/clients`, `/team`, `/settings` | Pages render stored data. No horizontal overflow on overview. Alerts menu opens and lists two real items. |
| 768 | `/overview`, `/dashboard` | No horizontal overflow. Header includes Open navigation. |
| 390 | `/overview`, `/reviews`, `/onboarding`, `/m`, `/m/approve`, `/m/escalations` | No horizontal overflow. Mobile bottom nav sits at the bottom of the viewport. |

Also checked: `/reviews?filter=draft` narrows 15 reviews to 4 drafts. `/onboarding` shows the Google account already connected. `/audit` lists prior actions for this workspace. `/dashboard` shows 4 clients, 2 locations, 10 unreplied reviews, 0 open escalations, and usage counts with no prices. The agency nav item is labeled Usage.

Unauthenticated HTTP, without a session cookie:

| Request | Result |
|---|---|
| `POST /api/reviews` | 307 to login |
| `POST /api/escalations/open` | 307 to login |
| `POST /api/google/connect` | 307 to login |
| `GET /overview` | 307 to login |
| `GET /api/cron/automation` | 401 |
| `POST /api/requests/hooks/resend` | 503, no email receipt configured |
| `POST /api/requests/hooks/twilio` | 503, no SMS receipt configured |

## Current architecture

Next.js 16 App Router, React 19, Tailwind 4, Supabase Postgres, Vitest. Server components call helpers in `lib/services`. Mutations go through `app/api`. The service role bypasses row-level security, so each route checks membership itself.

Tenancy is a workspace. Roles are `owner`, `admin`, `member`, `org_admin`, `brand_manager`, `group_manager`, `store_manager`, `agent`, and `auditor`. Reply permission depends on the role and the star rating: 4–5 stars use `publish_positive`; 1–3 stars use `approve_negative`.

```
Browser
  → proxy.ts (session gate)
  → app/(dashboard) server pages
  → lib/services
  → Supabase (service role), Google, Gemini
```

## Route inventory

| Route | What it renders |
|---|---|
| `/`, `/login`, `/consent`, `/privacy`, `/terms` | Marketing, sign-in, consent, legal |
| `/overview` | Ratings, volume, reply rate, escalations, chart, attention |
| `/reviews` | Inbox, filters, assignment, drafts |
| `/escalations` | Queue, rules, pause |
| `/analytics` | Performance, themes, profile, automation, team |
| `/reports`, `/reports/[reportId]` | Schedules, alert rules, exports |
| `/requests` | Campaigns, QR, private-feedback funnel |
| `/clients`, `/clients/[clientId]` | Brands, groups, locations |
| `/team` | Roster, invites, scopes |
| `/settings` | Tone, automation, templates, integrations |
| `/dashboard` | All clients, usage, approval queue |
| `/audit` | Workspace audit log |
| `/onboarding` | Five-step setup |
| `/m`, `/m/approve`, `/m/escalations` | Phone overview, approval, complaints |
| `/c/[token]`, `/c/done` | Client connection link |
| `/r/[token]` | Customer review-request page |

Cron routes in `vercel.json`: review sync at 04:00 UTC, escalations hourly, reports at :15, requests at :45, automation at :30. Each requires `Authorization: Bearer` matching `CRON_SECRET`.

## Page-by-page requirements

### Page 1 — Overview

| Requirement | State | Evidence |
|---|---|---|
| Client, brand, and group scope | Implemented and verified | Header filters on `/overview`. Last 12 months, all brands: 5 reviews, average 5.00. |
| Date range, default 12 months | Implemented and verified | Overview copy says “Last 12 months”. |
| Header search, alerts, account menu | Implemented and verified | Search box is present. Alerts opened and showed “10 reviews have no reply” and “4 drafts are ready to approve”. |
| Rating, volume, 1–3 star share, reply rate, previous period | Implemented and verified | Tiles: 5.00, 5 reviews, 0% negative, 20% reply rate. Previous period: 3 reviews, average 5.00. |
| Open escalations and past SLA | Implemented and verified | Both tiles are 0, matching an empty escalation queue. |
| Reply-rate target | Partially implemented | The field is on the page. This workspace has no saved target, and this pass did not save one. |
| Send digest | Blocked | Needs `RESEND_API_KEY` and `REPORT_FROM_EMAIL`. The product does not claim a digest was sent. |
| AI insights with a question box | Partially implemented | “What customers are saying” renders. This workspace has no generated strengths or problems. A free-form question API is not a separate product. |
| Lowest-rated location | Implemented and verified | The Better Agency, East Fort, Thrissur, 5.00 from 5 reviews in the period. |
| Reviews-by-month chart | Implemented and verified | The chart region renders and month links point at the inbox. |
| Needs attention | Implemented and verified | 3 drafts awaiting approval and 1 review with no reply, for this period. |
| Complaint themes | Implemented and verified | Empty state: no 1–3 star reviews in this period. |

### Page 2 — Inbox

| Requirement | State | Evidence |
|---|---|---|
| Review list and detail | Partially implemented | `/reviews` lists 15 stored reviews. Opening one review and editing a reply was not repeated in this pass. |
| Filters for rating, status, text, client, location, date, search | Implemented and verified | `?filter=draft` returns 4 of the 15 reviews. |
| Language, theme, and assignee filters | Partially implemented | Assignment is stored (audit: “review: assigned”). Language and theme filters are not a separate saved view. |
| Saved views | Partially implemented | Filters live in the URL. A named saved-view table is not a separate feature. |
| Bulk select, approve, publish | Partially implemented | The controls render. This pass did not publish to Google. |
| Bulk assign | Partially implemented | The assign control is in the inbox. A prior assignment is in the audit log. This pass did not assign a review. |
| Original text and English translation | Partially implemented | Translation is shown when Google stored one. These visible reviews are already in English or rating-only. |
| Draft, unreplied, published, failed, escalated | Partially implemented | Draft filter works. Failed and uncertain publish outcomes are covered by unit tests, not by a live Google failure in this pass. |
| Generate, shorter, warmer, language, template | Partially implemented | Mobile approval shows Try again, Shorter, Warmer, and a language select on a stored draft. This pass did not call Gemini. |
| Approve and publish an eligible reply | Partially implemented | One historical publish is in the audit log (24 Sep 2026). This pass did not publish. |
| Schedule a reply | Not applicable | Replies post when a person approves, or when automation is allowed. There is no separate future-dated reply clock beyond the automation window. |
| Report a review to Google | Blocked | The Google reviews client used here lists, replies, and deletes. It does not call a report endpoint. |
| Internal note | Partially implemented | The note field exists. A prior “review: note added” is in the audit log. This pass did not add a note. |

### Page 3 — Escalations

| Requirement | State | Evidence |
|---|---|---|
| Queue with location, assignee, SLA, review, internal note | Implemented and verified | `/escalations` renders an empty queue and says a published reply does not close it. `/m/escalations` says no open escalations. |
| Rules for stars, profanity, legal wording, keywords, due hours, timezone | Implemented and verified | The rules form is on the page. A prior policy update is in the audit log. This pass did not save a new policy. |
| Assign to a manager and record a resolution | Partially implemented | Assignee and resolution controls render when a row exists. This workspace has no open escalation, so this pass did not resolve one. |
| SLA reminder and management escalation | Partially implemented | Reminder hours are on the form. The copy says reminders are stored in GRM and no email is sent. The cron route returns 401 while `CRON_SECRET` is unset. |
| Pause automatic replies for a scope | Partially implemented | Workspace, client, and location pause controls render. The audit log has a pause and a later resume. This pass did not pause the live workspace. |
| File attachment on an escalation | Not applicable | The board says file attachments are not available. No evidence file is stored. |

### Page 4 — Analytics

| Requirement | State | Evidence |
|---|---|---|
| Previous-period comparison and CSV export | Partially implemented | Analytics shows 1 review, average 5.00, previous period 4 reviews. The export route exists. This pass did not download the CSV. |
| Themes, profile, automation, and team sections | Partially implemented | The page describes those sections. The visible portion shows rating mix and reply-time buckets, all empty except one 5-star review. |
| Competitor comparison | Partially implemented | Reports can include a competitor section that says ratings are not connected. It does not invent ratings. |
| Reply-time buckets and rating mix | Implemented and verified | 1-star through 5-star counts and the four reply-time buckets render. One review has no confirmed Google reply time. |
| Since-onboarding baseline | Partially implemented | Comparison is the previous window of the same length, not a fixed onboarding baseline. |
| Location leaderboard | Partially implemented | The leaderboard heading is on the page. This scope has one location with reviews. |

### Page 5 — Reports and alerts

| Requirement | State | Evidence |
|---|---|---|
| Build a scheduled report | Partially implemented | The form offers name, scope, sections, frequency, timezone, recipients, and an on/off switch. No report is saved in this workspace now. A prior save, test, and delete are in the audit log. |
| Deliver a report by email, Slack, or WhatsApp | Blocked | The page states no email provider, no Slack webhook, and no WhatsApp provider. Needs `RESEND_API_KEY`, `REPORT_FROM_EMAIL`, `SLACK_WEBHOOK_URL`, and the WhatsApp token and phone id. |
| In-app report record | Partially implemented | “In GRM” is a delivery choice. Recent runs are empty because no report is saved. |
| Alert rules | Partially implemented | One rule is on: “Google connection expires”. Alert history is empty. This pass did not create a qualifying event. |
| Alert delivery outside GRM | Blocked | Same missing providers as report delivery. The in-app alerts bell does work. |
| Duplicate alert suppression | Partially implemented | The page says a repeated check does not record the same event twice. No live duplicate was fired in this pass. |

### Page 6 — Review requests

| Requirement | State | Evidence |
|---|---|---|
| Funnel counts | Implemented and verified | Sent 0, clicked 0, private feedback 0, opted out 0. Delivered and opened say the receipt is not connected. New Google reviews say Google does not attribute a review to a request. |
| Send WhatsApp, SMS, or email | Blocked | Each channel says the provider is not configured. Needs `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID`, Twilio account, token, and from-number, and `RESEND_API_KEY` plus `REQUEST_FROM_EMAIL`. |
| In-store QR | Partially implemented | gympod and The Better Agency each show 0 scans. This pass did not open a QR page. |
| Customer page with Google review and private note | Partially implemented | The preview shows both choices. The public route is `/r/[token]`. This pass did not submit feedback. |
| 90-day contact limit and opt-out | Partially implemented | The limit form is on the page. This pass did not change the saved window. |
| Customer CSV | Partially implemented | Upload is offered. The server schema rejects a CSV over 500,000 characters. This pass did not upload a file. |

### Page 7 — Locations and groups

| Requirement | State | Evidence |
|---|---|---|
| Clients, groups, and locations | Implemented and verified | Four clients. gympod and The Better Agency have one location each. kalyan and test client have none. |
| Create a region or city group | Partially implemented | The new-group form is on `/clients`. This pass did not create a group. |
| Move a location and inherit settings | Partially implemented | The audit log records location moves and scope-setting updates. This pass did not move a location. The restored groups were left in place. |
| Store code, manager, connection | Partially implemented | Locations are listed with counts. Account manager is on the add-client form. This pass did not change a manager. |
| Several Google accounts | Partially implemented | Connections are stored per Google email. This workspace shows one connected account. |
| CSV import of groups | Partially implemented | Onboarding accepts a `location,group` CSV up to 200,000 characters. This pass did not upload one. |
| Drag and drop | Not applicable | Moving a location uses the group form. A drag handle is not required for the stored move. |

### Page 8 — Team and roles

| Requirement | State | Evidence |
|---|---|---|
| Roster with role, scope, last active | Implemented and verified | Owner: whole organization, last active 8 Oct. Member: whole organization, last active 5 Oct. |
| Two-step sign-in | Blocked | The roster says “Two-step Not available”. Needs Twilio Verify (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`). |
| Invite by email | Partially implemented | The invite form says email is not sent until a mail provider is configured, and offers a copyable invite. A prior invite to hari@explaineddigital.com was accepted on 5 Oct. This pass did not create an invite. |
| Role and scope restrictions | Partially implemented | The member row has a role control. Server updates go through the members route and an assignable-role schema. This pass did not change a role. |
| Invite by mobile | Blocked | Needs the same Twilio Verify configuration. |
| Audit log | Implemented and verified | `/audit` lists this workspace’s events, including the actor email. |

### Page 9 — Settings, tone, and automation

| Requirement | State | Evidence |
|---|---|---|
| Tone: warmth, length, languages, never-say, spelling | Implemented and verified | The settings page shows those fields and says they inherit from the workspace unless a brand, group, or location overrides them. |
| Autoreply for 4–5 stars, cap, delay, posting window, shadow mode | Implemented and verified | The automation section renders those controls and says negative reviews always need a person. |
| Guardrails | Partially implemented | The page states the guardrails. A prior “reply: guardrail blocked” is in the audit log. This pass did not submit a blocked reply. |
| Templates | Partially implemented | Template name and body fields exist on the settings board. This pass did not save a template. |
| Pause stops queued automation | Partially implemented | Pause controls say a pause includes work already waiting on the scheduler. `runAutomation` holds paused and shadow work in code and tests. The live cron cannot run while `CRON_SECRET` is unset, so a queued job was not observed hitting a paused workspace. |
| Try a sample reply | Partially implemented | The “Try it” heading is on the page. This pass did not generate a sample. |

### Page 10 — Agency

| Requirement | State | Evidence |
|---|---|---|
| Portfolio counts and client table | Implemented and verified | 4 clients, 2 locations, 10 unreplied, 0 awaiting client approval, 0 open escalations, 0 connection problems. |
| Add a client and an account manager | Partially implemented | The form is on `/dashboard`. This pass did not create a client. |
| Client Google connection link | Partially implemented | `/c/[token]` exists. A prior “client: onboarding issued” is in the audit log. This pass did not issue a link. |
| Switch client and keep tenants apart | Partially implemented | Client links in the sidebar go to that client’s page. An unknown client id is rejected by the mobile overview. A second workspace was not switched in this pass. |
| White label logo, name, and domain | Partially implemented | Branding can be saved. The audit log has “branding: updated”. A custom domain is not verified, and the product name stays GRM until a logo and title are saved. |
| Usage without prices | Implemented and verified | Last month: gympod 1 location, 0 reviews, 0 published. The Better Agency 1 location, 0 reviews, 1 published. The copy says no price is calculated. |
| Client approval queue | Implemented and verified | Empty state: no replies are waiting for the client. |

### Page 11 — Onboarding

| Requirement | State | Evidence |
|---|---|---|
| Connect, import, confirm groups, tone, invite | Implemented and verified | `/onboarding` shows the five steps. The Google account hridhin@explaineddigital.com is connected since 23 Sep 2026. The copy says tokens stay on the server. |
| Complete a first-run wizard | Partially implemented | This workspace is already configured. This pass did not disconnect Google or repeat the wizard. |
| Hold unverified or duplicate locations | Partially implemented | Grouping can hold rows that do not match. This pass did not import a new location. |

### Page 12 — Sign in

| Requirement | State | Evidence |
|---|---|---|
| Continue with Google | Implemented and verified | The login page offers Google when the Google client id is set. This pass used the existing session and did not start a new OAuth dance. |
| Terms and privacy | Implemented and verified | Footer links to `/privacy` and `/terms` are on the signed-in shell. |
| Microsoft | Blocked | Needs `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`. The login page shows the reason instead of a working button. |
| Email and password | Blocked | Needs `AUTH_EMAIL_ENABLED=true` and a Supabase password provider. The form is hidden until that flag is set. |
| Single sign-on | Blocked | Needs `AUTH_SSO_DOMAIN`. |
| Store-manager SMS code | Blocked | Needs Twilio Verify. |

### Pages 13–15 — Phone

| Requirement | State | Evidence |
|---|---|---|
| Phone overview | Implemented and verified | `/m` shows the last 7 days with no reviews, 0 escalations, and 4 drafts of 4–5 stars waiting. No sidebar. |
| One-card approval | Implemented and verified | `/m/approve` shows card 1 of 4: 5 stars, Anjali Yadav, 27 Jul 2026, no written comment, suggested reply, checks passed. |
| Try again, shorter, warmer, language | Implemented and verified | Those controls render on the card. This pass did not regenerate the draft. |
| Skip without changing the draft | Partially implemented | Skip advances the card in the URL and leaves the stored draft. This pass did not skip. |
| Approve and post | Partially implemented | The button is present, including a bulk confirm for 4 of the 4–5 star drafts. This pass did not post. |
| Speak or type | Partially implemented | The card says Speak appears when the browser can capture speech, and typing always works. This browser session did not expose a Speak button. |
| Complaint handling | Implemented and verified | `/m/escalations` shows an empty state. The complaint actions exist for an open row. This workspace has no open row. |
| Photo of a bill | Not applicable | Reviews do not store an evidence photo, and there is no evidence bucket. The screen does not offer a fake upload. |
| Pass to regional and send for approval | Partially implemented | Those actions use the existing escalation routes and do not post to Google. They were not clicked in this pass because the queue is empty. |

## Workflows asked for in this pass

| Workflow | Result |
|---|---|
| Sign in and finish onboarding | Session already signed in. Wizard shows Google connected. First-run completion was not repeated. |
| Connect Google and import locations | Stored connection and 2 locations are on screen. A new OAuth grant was not started. |
| Sync reviews without duplicates | Inbox has 15 reviews. The 24 Sep sync audit says 15 new, then a later update of those 15. This pass did not run another sync. |
| Filter and assign | Draft filter verified. Assignment was not repeated. |
| Generate, edit, approve, publish | Drafts exist. Generate and publish were not repeated. |
| Failed and uncertain Google publish | Unit tests cover the pending-publish lock and the mismatch path. No live Google failure was created. |
| Escalate a negative review | Queue is empty. No new escalation was opened. |
| SLA reminders and management escalation | Rules render. Cron returns 401 without `CRON_SECRET`. |
| Resolve a complaint | No open complaint to resolve. |
| Dashboard numbers after a change | Current numbers match the empty escalation queue and the stored review counts. No new change was written. |
| Scheduled report delivery | Builder renders. Delivery is blocked on the mail, Slack, and WhatsApp providers. |
| Alert from a qualifying event | One connection-expiry rule is on. History is empty. No event was forced. |
| Review request send | Funnel is zero. Send is blocked on the channel providers. |
| Move a location and inherit settings | Prior moves are in the audit log. No location was moved. |
| Invite and role scope | Roster and invite form render. No invite was created and no role was changed. |
| Pause automation | Controls render and prior pause/resume is audited. Live cron cannot run. |
| Switch agency client | Client pages and the unknown-client rejection exist. A second workspace switch was not performed. |
| Mobile approval and complaints | Both phone screens render. Approve and post was not clicked. |

## Security

| Check | Result |
|---|---|
| Unauthenticated API and pages | Redirect to login, or 401 on cron. |
| Webhooks without a receipt secret | 503. They do not accept an unsigned body as delivered. |
| Encrypted Google tokens | `anon` and `authenticated` previously had table privileges on `grm_google_connections`, which exposed `access_token_enc` and `refresh_token_enc`. A column revoke does not remove a table grant. `20261016012_token_columns.sql` revokes all privileges on that table from `anon` and `authenticated`. After it was applied, only `postgres` and `service_role` still have select, insert, update, and references on the token columns. The app reads connections with the service role and does not select the token columns for pages. |
| Role change | The members route accepts only assignable roles. This pass did not attempt to promote the member account. |
| Cross-tenant client id | The mobile overview rejects a client id that is not in the workspace. |
| Row-level security | Service-role queries bypass it. Routes check the signed-in membership. A new query that forgets the workspace id would still cross tenants. |
| Approval and publish races | A reply moves to `pending_publish` before the Google call. A mismatched published body stays pending and is audited as uncertain. Covered by unit tests, not by a live double post. |
| Duplicate review rows | Upsert uses the unique `(workspace_id, google_review_name)` key. The inbox count is 15. |
| Duplicate usage events | Usage upsert ignores an existing `(workspace_id, kind, source_id)`. |
| Attachments | Escalation files are unavailable. Grouping and request CSVs are text, capped at 200,000 and 500,000 characters. Nothing stores an uploaded image. |
| Failed-reply re-approval | Bulk publish of a failed reply now requires the same approve permission as a draft. |
| OAuth tokens in the browser | The onboarding copy and the connection queries keep tokens on the server. This pass did not print token values. |
| Rate limits | Counters in `lib/rate-limit.ts` are in memory. Another instance, or a cold start, resets them. |

## Regression

| Check | Result |
|---|---|
| Formatter | No formatter and no format script are configured. |
| `npm run lint` | Exit 0. Five warnings remain: an agency logo `img`, a QR `img`, and three `window.location.assign` calls used for OAuth and full-page navigation. The repo script does not use `--max-warnings 0`. |
| `npx tsc --noEmit` | Passes after `npm run build` regenerates `.next/types`. Before that build, it failed only in the stale generated validator, which still imported routes that are not in the source tree. |
| Unit tests | `npm test` after the production build: 28 files, 298 tests, passed in 9.65s. There is no separate integration or end-to-end suite. |
| Production build | `npm run build` succeeded on Next.js 16.3.1. TypeScript finished inside the build. One warning: no fallback metrics for the Cal Sans font. |

Lint fixes included in this pass: mobile approval and complaint views remount when the card changes instead of setting state in an effect; speech support is read with `useSyncExternalStore`; the escalation SLA clock is computed outside render; the onboarding page no longer places JSX inside `try/catch`.

## Environment

Set in this workspace: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`, `GEMINI_API_KEY`.

Unset, and required before the matching feature can run:

| Variable | Feature |
|---|---|
| `CRON_SECRET` | Review sync, escalation reminders, report schedules, request sending, automation |
| `RESEND_API_KEY`, `REPORT_FROM_EMAIL` | Report and alert email |
| `REQUEST_FROM_EMAIL` | Review-request email |
| `RESEND_WEBHOOK_SECRET` | Email delivery receipts |
| `SLACK_WEBHOOK_URL` | Slack delivery |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | SMS requests |
| `TWILIO_VERIFY_SERVICE_SID` | SMS sign-in codes |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | WhatsApp |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Microsoft sign-in |
| `AUTH_EMAIL_ENABLED` | Email and password sign-in |
| `AUTH_SSO_DOMAIN` | Single sign-on |

## Known limits

- Speech input appears only when the browser exposes the Speech API.
- Complaint photos are not stored.
- Competitor ratings are not estimated.
- A custom domain stays unverified until DNS is connected.
- The in-memory rate limit does not span instances.
- Service-role access still depends on every query including the workspace id.
- `npx tsc --noEmit` passes after the production build regenerates `.next/types`.
