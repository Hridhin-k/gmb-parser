# RevuPilot implementation audit

Date: 19 October 2026.

Source of truth for screens: `docs/RevuPilot Wireframes (1).pdf` (15 pages). The older `docs/GRM-UI-UX-DESIGN-BRIEF.txt` (25 September 2026) describes a smaller agency inbox (Dashboard, Clients, Reviews, Audit, Settings, Google sign-in only). Where the brief and the PDF disagree, this audit follows the PDF.

This pass read the PDF, the App Router, services, migrations, and environment variable names. It did not publish a reply, start OAuth, send email, SMS, WhatsApp, or Slack, run cron, or change production data. A screen that renders is not marked PASS. PASS means the stored behaviour matches the wireframe requirement. Live provider calls are not marked PASS unless this pass executed them.

Status key:

| Status | Meaning |
|---|---|
| PASS | The behaviour is implemented against stored data and matches the requirement. |
| PARTIAL | A real path exists, and a named part of the requirement does not. |
| FAIL | The requirement is absent, or the product does the opposite. |
| BLOCKED | The code refuses to finish until a named external dependency exists. |

## Verdict

Keep the current Next.js, Supabase, and service-role architecture. Do not rebuild the inbox, reply publish path, or role matrix.

The shared organisation, group, and outlet filter is in the header. Overview, Reviews, Escalations, Analytics, Insights, Reports, and Review requests read that scope on the server. Overview follows the PDF’s scorecard, insight cards, monthly trend, attention list, lowest outlets, and complaint themes, using stored reviews. Escalation rules, assignment, and one-step SLA movement are implemented and covered by unit tests. The live database this workspace points at does not yet have the assignment columns in `supabase/migrations/20261019003_escalation_assignment.sql`, so those owners are not stored until that migration is applied. The queue still loads.

This is not production-ready. `CRON_SECRET` is unset, so scheduled jobs return 401. Email, Slack, WhatsApp, and SMS are unset. The saved model insight is not limited to the selected date range. Competitor ratings, praise themes, a question box, weekly charts, drag-and-drop, file attachments, and a billing connector are not implemented. Do not fill those with sample numbers.

## Phase 8 verification — 19 October 2026

Commands run in this workspace:

| Command | Result |
|---|---|
| `npx vitest run` | 34 files, 356 tests, passed |
| `npx eslint .` | 0 errors, 5 warnings (`<img>`, `window.location.assign`) |
| `npx tsc --noEmit` and `npx next build` | Passed. One warning: Cal Sans has no fallback font metrics. |
| Live schema probe (service role, column names only) | `grm_groups`, `grm_brands`, `grm_scope_insights` exist. `grm_escalations.assignment_decided_at` does not. |
| Browser | `/login` rendered while signed out. Authenticated Overview, Reviews, Escalations, Analytics, and Insights were not clicked through. |
| End-to-end runner | None is configured in `package.json`. |
| Google, Gemini, cron, email | Not called. Credentials for Google and Gemini are set. Cron and delivery secrets are not. |

No ACME or Fazyo records were written to the database. Those names appear only in tests and in the PDF.

## Architecture to preserve

| Layer | What the repo uses |
|---|---|
| Framework | Next.js 16.3.1 App Router, React 19, Tailwind 4 |
| Data | Supabase Postgres. Tables are prefixed `grm_` because the project is shared. |
| Auth | Supabase Auth. Google sign-in is implemented. Session gate is `proxy.ts`. |
| Server data | Server Components call `lib/services`. Mutations go through `app/api`. |
| Database access | Service role in server code. RLS exists, but the service role bypasses it. Each route must check membership and scope. |
| AI | Gemini (`gemini-3.8-flash`) for reply drafts and scope insights. `GEMINI_API_KEY` is set. This pass did not call it. |
| Google | Business Profile OAuth plus the My Business v4 reviews API (list, reply, delete). `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are set. This pass did not call Google. |
| Deploy | `vercel.json` cron. App URL in this workspace is `http://localhost:3000`. |
| Tests | Vitest under `__tests__`. Not re-run in this pass. |

`docs/GRM-UI-UX-DESIGN-BRIEF.txt` is not the target information architecture. The shell already follows the PDF nav: Overview, Inbox, Escalations, Analytics, Reports and alerts, Review requests, then a Manage group (Locations and groups, Team and roles, Settings) and an Agency group (All clients, Usage).

## PDF page-to-screen mapping

| PDF | Wireframe | Route | Main UI | Status |
|---|---|---|---|---|
| 1 | Overview | `/overview` | `components/client-overview.tsx` | PARTIAL |
| 2 | Inbox | `/reviews` | `components/review-list.tsx`, `components/review-detail-panel.tsx`, `components/review-filters.tsx` | PARTIAL |
| 3 | Escalations | `/escalations` | `components/escalation-board.tsx` | PARTIAL |
| 4 | Analytics | `/analytics` | `components/analytics-board.tsx` | PARTIAL |
| — | Insights | `/insights` | `components/insights-board.tsx` | PARTIAL |
| 5 | Reports and alerts | `/reports`, `/reports/[reportId]` | `components/reports-board.tsx` | PARTIAL |
| 6 | Review requests | `/requests`, public `/r/[token]` | `components/request-board.tsx` | PARTIAL |
| 7 | Locations and groups | `/clients`, `/clients/[clientId]` | `components/hierarchy-board.tsx` | PARTIAL |
| 8 | Team and roles | `/team`, `/audit` | `components/workspace-members-card.tsx` | PARTIAL |
| 9 | Settings | `/settings` | `components/settings-board.tsx` | PARTIAL |
| 10 | Agency / all clients | `/dashboard` | `components/agency-home.tsx` | PARTIAL |
| 11 | Onboarding, confirm groups | `/onboarding` | `components/onboarding-wizard.tsx` | PARTIAL |
| 12 | Sign in | `/login` | `components/login-form.tsx` | PARTIAL |
| 13 | Phone overview | `/m` | `components/mobile-overview.tsx` | PARTIAL |
| 14 | Phone approve | `/m/approve` | `components/mobile-approval.tsx` | PARTIAL |
| 15 | Phone complaint | `/m/escalations` | `components/mobile-complaint.tsx` | PARTIAL |

The sidebar and sign-in title say RevuPilot unless the agency hides the product name, in which case the workspace name is shown. Compared on `/login` on 19 October 2026: one Google button, navy on a light card. Microsoft, email, SSO, and mobile code stay hidden because those providers are unset.

### Page 1 — Overview

| Requirement | Status | Evidence |
|---|---|---|
| Organisation, brand, and group in one header control | PASS | `components/scope-selector.tsx` is the only organisation, group, and outlet control. Organisation is the client. A group includes its child city. Verified by `__tests__/scope.test.ts` and `__tests__/consistency.test.ts`. |
| Date range, default last 12 months | PASS | `defaultRangeForPath("/overview")` returns `12m`. Metrics use that window. |
| Header search | PARTIAL | Search from Overview navigates to `/reviews`. It does not search inside Overview. |
| Alerts | PARTIAL | The bell lists unreplied reviews, open escalations, drafts, and expired connections from `getShellSummary`. Counts ignore the date range. They are not the wireframe’s “5 negative reviews in 48 hours” items. |
| Rating, volume, 1–3 star share, reply rate, previous window | PASS | `grm_dashboard_bundle` plus `reviewWindow` in `lib/metrics.ts`. Negative share is 1–3 stars. Reply rate counts a Google reply. |
| Open escalations and past SLA | PASS | `open_escalations` and `overdue_escalations` in the same bundle. |
| Set targets | PARTIAL | One reply-rate target (`reply_rate_target` on the escalation policy, `components/reply-target-form.tsx`). Not a general target editor. |
| Send digest from Overview | PARTIAL | The button opens Reports with the same scope. It does not send a message. |
| AI insight feed: getting worse, new problem, improving, worth copying | PARTIAL | `buildOverviewBoard` writes those cards from review counts: five reviews in both windows and a rating move of at least 0.15, or a new keyword theme. There is no separate “worth copying” praise card. |
| Ask a question about the numbers | FAIL | No question box. Generating a model summary is a button on Insights. |
| Worst store: trend, brand average, themes, assign follow-up | PARTIAL | Lowest locations are the five lowest averages in the selected window. No 3-month delta, sparkline, brand-average line, or assign action on that card. |
| Reviews by month, weekly toggle, compare stores | PARTIAL | Monthly bars exist and link into the inbox. Weekly and compare-stores do not. |
| Needs attention | PARTIAL | Drafts, unreplied reviews, past-SLA escalations, expired connections, and paused locations. Not a per-store “5 negatives in 48 hours” row. |
| Lowest 5 stores with 3-month change and main complaint | PARTIAL | Five lowest by average in the window. No change column and no complaint column. |
| What customers are saying, including praise and rising or falling | PARTIAL | 1–3 star keyword themes only. No praise bars and no rising or falling marker. |

### Page 2 — Inbox

| Requirement | Status | Evidence |
|---|---|---|
| Review list and detail from stored Google reviews | PASS | `/reviews` loads `grm_reviews`. Detail edits the stored reply. Sync upserts on `(workspace_id, google_review_name)`. |
| Rating, status, text, client, location, date, search | PASS | URL filters in `components/review-filters.tsx` and `lib/services/dashboard.ts`. |
| Language, theme, and assignee filters | PASS | `review_language`, `complaint_theme`, and `assigned_to` are stored and queried. Language is script detection, not a Google language code. Theme is a keyword match on 1–3 star text. |
| Named saved views | FAIL | Filters live in the URL. There is no saved-view table. |
| Bulk select, approve, and publish | PARTIAL | `POST /api/reviews/bulk` approves and calls the Google publish service. This pass did not post a reply, so the live grant is unconfirmed. |
| Bulk assign | PASS | Bulk assign writes `assigned_to`. |
| Original text and English translation | PARTIAL | Shown when Google already stored a translation (`lib/review-text.ts`). GRM does not translate. |
| Draft, unreplied, published, failed, reopened | PASS | `workflowState` in `lib/review-inbox.ts`. |
| Auto-replied as its own state | FAIL | Automation can publish, but the inbox does not label a reply as auto-replied. |
| Regenerate, shorter, warmer, language, template | PARTIAL | Routes exist (`/api/reviews/[reviewId]/generate`, template route). `GEMINI_API_KEY` is set. This pass did not call Gemini. |
| Approve and publish an eligible reply | PARTIAL | `ReplyPublishingService` posts to Google My Business v4. Not executed in this pass. |
| Schedule a reply | FAIL | `workflowState` documents that scheduled publishing is not a state. |
| Report a review to Google | FAIL | The reviews client lists, replies, and deletes. It does not call a report endpoint. |
| Internal note, not public | PASS | `grm_review_notes`. |
| Per-review activity timeline | PARTIAL | Workspace audit exists at `/audit`. The inbox detail does not show the wireframe’s minute-by-minute activity list. |

### Page 3 — Escalations

| Requirement | Status | Evidence |
|---|---|---|
| Queues: needs human, in progress, past SLA, resolved | PASS | `components/escalation-board.tsx`. A published public reply does not close the row. |
| Location, theme, assignee, SLA, review, internal note | PASS | Stored on `grm_escalations` and events. |
| Rules: stars, profanity, legal wording, keywords, due hours, timezone | PASS | `grm_escalation_policies`. Defaults are 3 stars, reminders at 2 and 6 hours, due in 24 hours, `Asia/Kolkata`. |
| Assign a manager and record a resolution code | PASS | Codes include apology and callback, replacement, and store visit. The UI says the code does not prove the call or visit happened. |
| SLA reminder by WhatsApp, then escalate one level | PARTIAL | Reminders are rows in `grm_escalation_reminders` with channel `in_app`. No WhatsApp is sent. Level can move store → regional → leadership. |
| Reminders at 2 hours and 6 hours | BLOCKED | `vercel.json` schedules `/api/cron/escalations` hourly. `CRON_SECRET` is unset, so the route returns 401. A Hobby plan may also reject an hourly cron. This pass did not run the job. |
| Pause automatic replies for the current scope | PARTIAL | Pause is workspace, client, or location (`grm_autoreply_pauses`). Not a group. The escalation screen says there is no automatic sender. `runAutomation` can still publish when rules allow it. |
| Attach a file | FAIL | The board does not offer an upload. No evidence bucket. |
| Ask the customer to update the review | FAIL | No such action. |
| Quick actions that perform the callback or replacement | FAIL | They store a resolution code only. |

### Page 4 — Analytics

| Requirement | Status | Evidence |
|---|---|---|
| Previous-period comparison | PASS | `previousDateRange` and a second `grm_dashboard_bundle` call. All-time has no previous window. |
| Export CSV | PARTIAL | `/analytics` links to `/api/reviews/export` with client, group, location, and dates. The file is the review export, not the leaderboard. |
| Reply-time buckets | PASS | `lib/analytics-metrics.ts` uses under 1 hour, 1–6 hours, 6–24 hours, and over 24 hours, plus a median. Missing reply timestamps are excluded. Covered by `__tests__/analytics-metrics.test.ts`. |
| Rating mix and language mix | PASS | Star shares and `review_language`, with missing language labeled “Not set”. |
| Since-onboarding baseline | PARTIAL | When `grm_onboarding.completed_at` is set, Analytics compares reviews before that time with reviews after it, in the same scope. The PDF’s sample percentages are not stored. |
| Location leaderboard | PARTIAL | Rank, group, rating, reviews, reply rate, and reply time come from the bundle. |
| Versus competitor | FAIL | `Competitors` renders: “Competitor ratings are not connected.” It does not estimate them. |
| Complaints by theme and group | PARTIAL | Heat map uses `complaint_theme` (wait, staff, price, cleanliness, quality, unspecified). Not the PDF’s billing queue, parking, or exchange policy. |
| Google profile tab | PARTIAL | Verification (`voice_of_merchant`), hold reason, and last sync. Not a profile-completeness score. |
| Automation health | PARTIAL | Drafts, failed publishes, and unconfirmed publishes. Copy says no automatic sender, which disagrees with `runAutomation`. |
| Team tab | PARTIAL | Assignments and escalation resolutions in the window. Not a broader productivity report. |

### Page 5 — Reports and alerts

| Requirement | Status | Evidence |
|---|---|---|
| Build a scheduled report: name, scope, sections, frequency, recipients | PASS | `grm_report_schedules`. Sections include scorecard, trends, leaderboard, themes, and competitors. |
| One report per group, or per location | PARTIAL | Scope is a client, group, or location id, not “one schedule that fans out to every group”. |
| Email delivery | BLOCKED | `deliverMessage` calls Resend when `RESEND_API_KEY` and `REPORT_FROM_EMAIL` are set. Neither is set in this workspace. |
| Slack delivery | BLOCKED | Needs `SLACK_WEBHOOK_URL`. Unset. |
| WhatsApp delivery | FAIL | `channelOptions` forces WhatsApp `available: false`. `deliverMessage` does not send WhatsApp even if a token exists. |
| In-app report record | PASS | Channel `in_app` stores the run and does not claim an outside send. |
| PDF download | PARTIAL | `renderTextPdf` is a text dump, not the wireframe preview (logo, scorecards, trend chart). |
| Alert rules matching the PDF | PARTIAL | Kinds are several negatives, rating drop, legal keywords, connection expiry, and review burst (`lib/reporting.ts`). Thresholds are configurable. Delivery outside the app uses the same blocked channels. |
| Duplicate alert suppression | PASS | A repeated check does not insert the same open alert again. Covered by report tests; not fired live in this pass. |

### Page 6 — Review requests

| Requirement | Status | Evidence |
|---|---|---|
| Funnel: sent, opened, clicked, private feedback, opt-out | PARTIAL | Counts come from `grm_request_events` and feedback rows. Opened and delivered stay empty until a receipt webhook is configured. |
| New Google reviews attributed to a request | FAIL | The board states Google does not attribute a review to a request. The PDF shows “19 per 100 sent”. Do not invent that rate. |
| Send WhatsApp, SMS, or email | BLOCKED | Needs `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`, Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`), and `RESEND_API_KEY` plus `REQUEST_FROM_EMAIL`. All unset. |
| Customer page: Google review and private note | PASS | `/r/[token]` offers both. Private feedback is stored in `grm_request_feedback`. |
| In-store QR and scan count | PARTIAL | `grm_request_qr` and `/api/requests/qr/[locationId]`. Counter-card PDF for all locations was not found as a separate generator. |
| 90-day contact limit and opt-out | PASS | Policy window on `grm_request_policies`. Opt-out is `/r/[token]/opt-out`. |
| CSV of customers | PARTIAL | Upload is parsed server-side and capped. This pass did not upload a file. |
| Connect a billing system | FAIL | No billing connector. The PDF’s “Or connect your billing system” is absent. |
| Recent sends with source and new reviews | PARTIAL | Campaign rows exist. “New reviews” cannot be attributed, so that column cannot be the PDF’s number. |

### Page 7 — Locations and groups

| Requirement | Status | Evidence |
|---|---|---|
| Tree: organisation, brand, region, city, location | PARTIAL | `components/hierarchy-board.tsx` writes `grm_brands` and `grm_groups`. Both tables exist on the connected database. `supabase/migrations/20261019002_grm_groups.sql` creates them for a fresh install. Drag-and-drop and Upload CSV are not on the page. |
| Move a location without losing reviews | PASS | Location id stays on `grm_google_locations`. Reviews reference `location_id`. |
| Inherit tone, SLA, and automation, with an override | PARTIAL | `grm_scope_settings` and `lib/services/reply-settings.ts` resolve workspace → brand → group → location. Group resolution depends on `grm_groups`. |
| Store code, tags, rating, connection, store manager | PARTIAL | Columns and `grm_location_tags`, `grm_location_tag_links`, `grm_location_managers` exist. Sub-group is a text field, not the city node. |
| Drag to move | FAIL | Moves use a form. No drag handle. |
| Several Google accounts | PASS | Unique key is `(workspace_id, google_email)`, so more than one email can be stored. |
| Expired access and duplicate warning | PARTIAL | Connection status, `hold_reason` (`duplicate` or `unverified`), and a manual duplicate mark. Not an automatic duplicate detector beyond Google’s `google_duplicate_of` when present. |
| CSV import of groups | PARTIAL | Onboarding accepts a location-to-group CSV. The locations page is not the same importer. |
| Group-level pause shown on the row | PARTIAL | A location can be inactive. Autoreply pause is not stored per group. |

### Page 8 — Team and roles

| Requirement | Status | Evidence |
|---|---|---|
| Roster: person, role, scope, last active | PARTIAL | Role and scope are stored on `grm_workspace_members`. Last active is the membership timestamp available to the roster, not a full session history. |
| Permission matrix | PASS | `lib/access.ts` matches the PDF: org admin, brand manager, group manager, store manager, agent, auditor. 4–5 star publish is separate from 1–3 star approval. Store managers and agents cannot approve negatives. |
| Invite by email with a role and a scope | PARTIAL | `grm_workspace_invites` stores role and one scope (client, group, or location). Email is not sent until a mail provider exists. A copyable link is the working path. |
| Invite by mobile number | BLOCKED | Needs Twilio Verify (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`). |
| Two-step sign-in | BLOCKED | The roster shows two-step as unavailable. Same Twilio Verify dependency. |
| Alerts by email or WhatsApp per person | PARTIAL | `alert_email` and `alert_in_app` flags exist. WhatsApp per person does not. Email alerts use the blocked report channel. |
| Audit log | PASS | `/audit` reads `grm_audit_logs` for the active workspace. |

### Page 9 — Settings

| Requirement | Status | Evidence |
|---|---|---|
| Tone: greeting, sign-off, warmth, length, languages, never-say, spelling | PASS | `grm_reply_settings`, inherited unless a lower scope overrides. |
| Try a sample reply | PARTIAL | Preview uses the saved tone. A live Gemini sample is a separate generate call and was not run. |
| Guardrails | PASS | `lib/reply-guardrails.ts` blocks promises, compensation, medical or legal claims, personal data, and internal contacts. Negatives still need a person. |
| Templates | PASS | `grm_reply_templates`. |
| Autoreply for 4–5 stars, daily cap, delay, posting window, shadow mode | PARTIAL | Settings and `automationVerdict` implement those rules, including “no question or complaint”. The escalation screen says no automatic sender exists. Cron cannot run without `CRON_SECRET`, and it runs once a day, so a 09:00–21:00 window is not enforced in time. |
| Brand manager must approve 1–3 star replies | PASS | `approve_negative` is denied for store manager, agent, and member. |
| Vary wording across stores | PARTIAL | Setting is stored. This pass did not prove the generator changes nearby drafts. |
| Pause automation for the brand | PARTIAL | Pause is workspace, client, or location. A brand pause works only when the brand is the client record. |
| Tabs: SLAs and routing, notifications, integrations, plan and billing, security | FAIL | Settings sections are tone and templates. SLA lives on escalations. Integrations are the Google card. Plan, billing, and security tabs are not on this page. |

### Page 10 — Agency

| Requirement | Status | Evidence |
|---|---|---|
| Portfolio counts and client table from stored clients | PASS | `lib/services/agency-home.ts`. Unreplied, escalations, and connection problems are counts, not sample figures. |
| Add a client and an account manager | PASS | `components/agency-client-form.tsx` writes a client. |
| Send a Google connection link | PASS | `/c/[token]` and `grm_client_onboarding`. The client connects their own Business Profile. |
| Copy tone from another client | FAIL | The PDF’s “Start from: copy tone and rules” is not on the form. |
| Switch into a client without mixing tenants | PARTIAL | Client pages are scoped by workspace id and client id. There is one active workspace, not a second tenant switcher. |
| White label: logo, hide product name, custom domain, sender | PARTIAL | `grm_agency_branding` stores logo, `hide_product_name`, `custom_domain`, and `sender_email`. `domain_verified_at` is not set by a DNS check in this repo. |
| Usage without prices | PASS | `grm_usage_events`. Export says no price is calculated. |
| Client approval queue | PARTIAL | Replies can wait for a role that has `approve_negative`. There is no separate client-login approval product. |
| Agency nav: client reports, agency staff, jump to client | FAIL | The shell has All clients and Usage only. |

### Page 11 — Onboarding

| Requirement | Status | Evidence |
|---|---|---|
| Five steps: connect, import, groups, tone, invite | PASS | `grm_onboarding.step` allows those values. `/onboarding` resumes them. |
| Group by state and city, city, Google account, none, or CSV | PASS | `grouping` check constraint matches those modes. |
| Unverified and duplicate profiles imported but paused | PASS | `hold_reason` blocks automatic grouping and AI drafts. Manual replies stay available. |
| Tokens stay on the server | PASS | `access_token_enc` and `refresh_token_enc` are AES-256-GCM. Pages do not select them. |

### Page 12 — Sign in

| Requirement | Status | Evidence |
|---|---|---|
| Continue with Google | PARTIAL | Login offers Google when the Google client id is set. It is set. This pass did not start a new OAuth dance. |
| Continue with Microsoft | BLOCKED | Needs `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`. |
| Email and password | BLOCKED | Hidden unless `AUTH_EMAIL_ENABLED=true`. |
| Company SSO | BLOCKED | Needs `AUTH_SSO_DOMAIN`. |
| Store-manager one-time code by SMS or WhatsApp | BLOCKED | Needs Twilio Verify. WhatsApp OTP is not implemented. |
| Privacy and terms | PASS | `/privacy` and `/terms`. |
| Keep me signed in | FAIL | No persistent “keep me signed in” control beyond the Supabase session cookie. |

### Pages 13–15 — Phone

| Requirement | Status | Evidence |
|---|---|---|
| Phone overview: rating, reply rate, new reviews, escalations, attention | PARTIAL | `/m` uses the last 7 days, not the PDF’s 30-day control, and a short heuristic summary. Numbers come from the same metrics helpers. |
| One-card approval, try again, shorter, warmer, language | PARTIAL | Controls call the generate route. Gemini was not called in this pass. |
| Approve all positive drafts | PARTIAL | Bulk confirm posts through the same publish service. Not executed here. |
| Speak or type | PARTIAL | `components/mobile-speech.tsx` uses the browser Speech API when present. Typing always works. |
| Skip without changing the draft | PASS | Skip advances the card id in the URL. |
| Needs a manager | PASS | Opens an escalation and does not post to Google. |
| Complaint note, quick actions, public reply, pass to regional, send for approval | PARTIAL | Note, resolution code, level change, and draft save use the escalation and reply routes. Quick actions do not place a call or book a visit. |
| Add a photo of a bill | FAIL | Copy says photos are not stored. No evidence bucket. |

## Existing routes and components

Authenticated shell: `app/(dashboard)/layout.tsx` → `components/app-shell.tsx`.

| Route | Role |
|---|---|
| `/` | Marketing landing, not the PDF shell |
| `/login`, `/consent`, `/privacy`, `/terms` | Sign-in and legal |
| `/overview` | Page 1 |
| `/reviews` | Page 2 |
| `/escalations` | Page 3 |
| `/analytics` | Page 4 |
| `/insights` | Counted insight cards for the header scope and date range. The saved model text is labeled as not that date range. |
| `/reports`, `/reports/[reportId]` | Page 5 |
| `/requests` | Page 6 |
| `/clients`, `/clients/[clientId]` | Page 7 |
| `/team` | Page 8 |
| `/settings` | Page 9 |
| `/dashboard` | Page 10 |
| `/audit` | Audit log linked from Team |
| `/onboarding` | Page 11 |
| `/m`, `/m/approve`, `/m/escalations` | Pages 13–15 |
| `/c/[token]`, `/c/done` | Client Google connection |
| `/r/[token]` | Customer review-request page |

API routes that matter: `app/api/reviews/**`, `app/api/escalations/**`, `app/api/reports/**`, `app/api/requests/**`, `app/api/google/**`, `app/api/insights/generate`, `app/api/workspace/**`, `app/api/clients/**`, `app/api/locations/hierarchy`, `app/api/cron/**`.

Cron in `vercel.json`, each requiring `Authorization: Bearer $CRON_SECRET`:

| Path | Schedule |
|---|---|
| `/api/cron/reviews-sync` | 04:00 UTC daily |
| `/api/cron/escalations` | Hourly (`0 * * * *`) |
| `/api/cron/reports` | 05:15 UTC daily |
| `/api/cron/requests` | 05:30 UTC daily |
| `/api/cron/automation` | 05:45 UTC daily |

The reviews-sync route comments that Vercel Hobby allows one run per day.

## Database entities and relationships

Tenant root is `grm_workspaces`. A member is `grm_workspace_members` (`user_id`, role, `access_enabled`, one of `scope_client_id`, `scope_group_id`, `scope_location_id`).

Intended hierarchy:

```
workspace
  client (brand in the UI)
    group (region) 
      group (city, parent_id set)
        google location
          reviews
            ai drafts, replies, notes, escalations
```

Tables created by migrations:

| Table | Relationship |
|---|---|
| `grm_workspaces` | Tenant |
| `grm_workspace_members` | User in a workspace |
| `grm_workspace_invites` | Pending invite, role, one scope |
| `grm_clients` | Brand / client under a workspace |
| `grm_google_connections` | OAuth grant, encrypted tokens, unique per workspace email |
| `grm_google_accounts` | Business Profile account under a connection |
| `grm_google_locations` | Place under an account. Optional `client_id` and `group_id` |
| `grm_location_groups` | Group under a workspace, optional client and parent. Kind `region` or `city` |
| `grm_reviews` | Review under a location. Unique `(workspace_id, google_review_name)` |
| `grm_review_ai_drafts`, `grm_review_replies`, `grm_review_notes` | Reply workflow |
| `grm_escalations`, `grm_escalation_events`, `grm_escalation_policies`, `grm_escalation_reminders`, `grm_autoreply_pauses` | Complaints |
| `grm_reply_settings`, `grm_reply_templates`, `grm_scope_settings` | Tone and automation |
| `grm_location_tags`, `grm_location_tag_links`, `grm_location_managers` | Tags and store manager |
| `grm_report_schedules`, `grm_report_runs`, `grm_report_deliveries`, alert tables | Reports |
| `grm_request_*` | Campaigns, recipients, QR, feedback |
| `grm_location_insights`, `grm_scope_insights` | Cached AI text |
| `grm_onboarding` | Wizard progress |
| `grm_agency_branding`, `grm_client_onboarding`, `grm_usage_events` | Agency |
| `grm_audit_logs` | Append-only audit |
| `grm_user_consents` | Consent |

`grm_groups` and `grm_brands` exist on the connected database. `supabase/migrations/20261019002_grm_groups.sql` creates them for a fresh install. Older migrations also created `grm_location_groups`. Services and `grm_dashboard_bundle` use `grm_groups`. Do not add a third group table.

`supabase/migrations/20261019003_escalation_assignment.sql` adds `responsible_user_id`, `ownership`, `assignment_reason`, `assignment_decided_at`, and `sla_advanced_at`. That file is not applied on the connected database. The escalation page detects the missing column, still shows the queue, and says assignment is not stored yet.

## Global-filter behaviour

`scopeMode` in `lib/shell.ts`:

| Mode | Routes | Header controls |
|---|---|---|
| `client-range` | `/overview`, `/reviews`, `/escalations`, `/analytics`, `/insights`, `/reports`, `/dashboard` | Organisation, group, outlet, and date range |
| `client` | `/requests` | Client select only |
| `none` | `/clients`, `/team`, `/settings`, `/audit`, `/onboarding`, `/m` | Neither |

Defaults: Overview 12 months, Analytics 6 months, Dashboard and Reports 1 month, Inbox and Escalations all time. `scopedHref` copies the current client and the expanded range onto the next scoped route so leaving Overview does not silently switch to all time.

`components/analytics-filters.tsx` is not mounted. The header selector writes `client`, `group`, and `location`. Unknown ids are dropped. A saved place that no longer exists uses `UNAVAILABLE_SCOPE_ID` and an empty location list, so the query does not become “everything”. Changing scope hides the previous page’s numbers until the server render matches (`FreshMetrics`).

Search in the header writes `q` on Inbox and Escalations. On other pages it sends the query to `/reviews`.

Sidebar badges from `getShellSummary` are workspace counts (or limited to the member’s clients). They do not follow the date range or the group.

Locations, Team, and Settings ignore the header scope. The PDF shows the same organisation / brand / group control on those pages.

## Organisation, group, and location hierarchy

Naming in the product:

| PDF word | Stored as |
|---|---|
| Organisation | `grm_workspaces` |
| Brand | `grm_clients`, with a `grm_brands` row created when a group is saved |
| Region | Group with `kind = region` and `parent_id` null |
| City | Group with `kind = city` and a region parent |
| Store / location | `grm_google_locations` |

Rules in the location-group trigger: a group cannot be its own parent, a city cannot contain a group, only a city sits under a region, and a city must share the brand of its region. The assignment trigger rejects a group from another workspace or another brand.

A location keeps its id when it moves, so reviews stay attached. Settings resolve from workspace down to location. A pause does not follow a group.

Tags are workspace-scoped names linked to locations. Store manager is `grm_location_managers`. Duplicate and unverified locations can be held.

The locations UI can still call `grm_brands` before insert and fail with “That brand is not ready for groups yet” when the brand row is missing.

## Escalation and assignment behaviour

A review is assigned with `grm_reviews.assigned_to`. Bulk assign and the detail panel both write that column. Assignment does not by itself open an escalation.

An escalation opens when the policy matches (stars at or below the threshold, profanity, legal or safety wording, or extra keywords), when someone chooses “needs a manager”, or when the escalation cron scans new reviews. Trigger key is unique per review so the same review is not opened twice. Reopening happens when Google changes the stars or the text after a reply.

Levels are `store`, `regional`, and `leadership`. Due time is `opened_at` plus `due_hours`. Reminder rows are created for each `reminder_hours` value. `EscalationService.runScheduled` marks a due reminder `sent_at` and writes an in-app event. It does not message the assignee.

Resolution stores `resolution_code` and a note. The public reply is a normal reply and still needs `approve_negative` before publish. Resolving does not post to Google. Publishing does not resolve the escalation.

Autoreply pause stops `runAutomation` from drafting for that workspace, client, or location. People can still draft and publish by hand.

## Analytics calculations and data sources

`getDashboardContext` calls `grm_dashboard_bundle(workspace, client, group, location, start, end, timezone)` and the same function for the previous window.

Inside the bundle, for reviews in the window and scope:

| Measure | Rule |
|---|---|
| Reviews | Count of rows |
| Average rating | `rating_sum / reviews` |
| Negative share | Reviews with 1–3 stars / reviews. 1–2 stars are also counted separately as `negative`. |
| Reply rate | Reviews that have a Google reply / reviews |
| Reply time | Hours between review create time and `google_reply_update_time`, averaged over replied reviews |
| Reply-time buckets | under 1h, under 24h, under 3d, later |
| Star mix | Counts for 1 through 5 |
| Months | Truncated in the policy timezone, limited to Asia/Kolkata, UTC, Asia/Dubai, and America/New_York. Anything else falls back to UTC. |
| Location and group rows | Same sums grouped by `location_id` or `group_id` |
| Themes | `complaint_theme` on 1–3 star reviews, else `unspecified` |
| Team | Assigned reviews, open escalations, resolved escalations in the window |
| Open and overdue escalations | Escalation rows in scope, not filtered the same way as review create time for the overdue clock |

`complaint_theme` is written at sync time by `detectComplaintTheme`: only 1–3 star reviews, first keyword hit among wait, staff, price, cleanliness, quality. It is not an AI theme and it does not track praise or “rising”.

`lib/services/analytics.ts` (`grm_review_trends`) is an older monthly series. The analytics page uses the dashboard bundle, not that series, for the board.

Competitor values are not calculated. Reports that include the competitors section say ratings are not connected.

CSV export is the review export route. It is not a second metrics engine.

## AI insights implementation

Two cached products, both Gemini, both with a heuristic when the model is skipped or the payload is thin:

| Product | Table | When |
|---|---|---|
| Location insight | `grm_location_insights` | One location. Summary, sentiment, themes, highlights, risks, structured analysis. |
| Scope insight | `grm_scope_insights` | A client or a group, not a single location. Overview shows it only when a client or group is selected and no location is selected. |

`POST /api/insights/generate` accepts either `locationId` or `scopeKind` + `scopeId`. It checks the member’s scope, rate-limits in memory, hashes the source reviews, and skips a new call when the hash matches. The prompt forbids invented staff names, policies, and placeholders.

There is no free-form “why did Kochi stores drop” endpoint. `buildInsights` in `lib/metrics.ts` only formats counts already on the page (volume, rating delta, reply rate versus target, lowest location). It does not label a streak, a new problem, or a practice worth copying.

Reply drafts are a third Gemini call (`lib/services/ai-review.ts`) with tone, language, shorter, and warmer adjustments, then guardrails. Automation may call the same generator. Drafts are labeled as generated. Shadow mode stores a draft and does not post.

## Security and tenant isolation

| Control | Behaviour |
|---|---|
| Session gate | `proxy.ts` sends unknown users to login, except login, legal, consent, Google callback, client connect, cron, review-request pages, and provider webhooks. |
| Cron | 401 unless `Authorization` matches `CRON_SECRET`. Unset secret fails closed. |
| Webhooks | Resend and Twilio receipt routes reject unsigned or unconfigured calls. They do not mark a message delivered. |
| RLS | Enabled on GRM tables. Select policies use `grm_my_workspace_ids()` (membership and `access_enabled`). `grm_can_see_location` limits location and review selects to the member’s client, group (including a child city), or location. |
| Service role | Server routes use the admin client, which bypasses RLS. Isolation then depends on `getActiveWorkspace`, `assertPermission`, and `assertScoped`. A new query that forgets `workspace_id` crosses tenants. |
| Role changes | Only assignable roles. The owner row cannot be changed. Org admins manage other members. A legacy admin manages members only. |
| Reply permission | 4–5 stars require `publish_positive`. 1–3 stars require `approve_negative`. Scope is checked against the location’s client and group. |
| Tokens | Encrypted at rest. `20261016012_token_columns.sql` revokes `anon` and `authenticated` privileges on `grm_google_connections`. Pages do not select token columns. |
| Publish races | A reply moves to `pending_publish` before the Google call. A body that does not match what Google returns stays pending and is audited. |
| Duplicate reviews | Upsert on `(workspace_id, google_review_name)`. |
| Duplicate usage | Upsert ignores an existing `(workspace_id, kind, source_id)`. |
| Rate limits | `lib/rate-limit.ts` is in-memory. A second instance or a cold start resets them. |
| CSV uploads | Text, length-capped. No image upload path. |

## Missing features, defects, and risks

Missing, in PDF order:

- Insight feed (getting worse, new, improving, worth copying) and the question box.
- Send digest on Overview.
- Named inbox views, scheduled replies, report-to-Google.
- Escalation file attachments, customer “update your review”, and real WhatsApp reminders.
- Competitor ratings and a since-onboarding baseline.
- Review-request attribution to new Google reviews, billing-system import, counter-card PDF.
- Drag-and-drop moves, group pause, copy-tone-from-client.
- Settings tabs for SLA, notifications, integrations, plan, and security.
- Agency staff, client reports, and jump-to-client as their own nav.
- Microsoft, email, SSO, and SMS sign-in.
- Complaint photos.
- Weekly chart, compare stores, and the PDF reply-time buckets.

Defects:

1. `grm_groups` and `grm_brands` are required by services and by `grm_dashboard_bundle`, and they are absent from migrations. `grm_location_groups` is the migrated table. Fresh migrate and the running app can disagree.
2. Escalation UI says automatic sending does not exist. `runAutomation` publishes when the verdict allows it and shadow mode is off.
3. Header client changes leave `group` in the query string.
4. Analytics CSV export drops the group id.
5. WhatsApp report delivery is hard-disabled even if a token is added later.
6. Theme keywords do not match the complaint language in the PDF, and they never score praise or direction.
7. Sidebar counts ignore the global date range.
8. Phone overview is fixed at 7 days while the PDF shows a 30-day control.

Risks:

- Service-role queries are the real tenant boundary. RLS does not protect them.
- In-memory rate limits do not span instances.
- Daily cron cannot implement hourly SLA reminders or a daytime posting window.
- Custom domains are stored, not verified.
- `gemini-3.8-flash` is called by name. This pass did not confirm the model id against a live generate call.
- The September design brief will send future work back toward the old five-screen app if it is treated as the spec.

No fabricated dashboard series were found in the overview, analytics, or agency services. Tests use ACME names as fixtures only.

## Environment

Set in this workspace: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`, `GEMINI_API_KEY`.

Unset:

| Variable | Blocks |
|---|---|
| `CRON_SECRET` | Sync, escalation scan, reports, request jobs, automation |
| `RESEND_API_KEY`, `REPORT_FROM_EMAIL` | Report and alert email |
| `REQUEST_FROM_EMAIL` | Review-request email |
| `RESEND_WEBHOOK_SECRET` | Email receipts |
| `SLACK_WEBHOOK_URL` | Slack |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | SMS requests |
| `TWILIO_VERIFY_SERVICE_SID` | SMS sign-in |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp requests. Report WhatsApp is still disabled in code. |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Microsoft sign-in |
| `AUTH_EMAIL_ENABLED` | Email and password |
| `AUTH_SSO_DOMAIN` | SSO |

## Implementation plan

Do these in order. Do not start a later phase by inventing data the earlier phase should store.

### Phase 1 — Make the hierarchy migratable

Dependency: none. Blocks group filters, inherited settings, and any dashboard SQL that joins groups.

Work: one group model. If production already has `grm_groups` and `grm_brands`, add the missing migration so a new database matches it, and map or retire `grm_location_groups` without deleting locations or reviews. If production only has `grm_location_groups`, point `hierarchy.ts`, access checks, and `grm_dashboard_bundle` at that table and extend it with the brand link the service needs.

Acceptance:

- A new database from `supabase/migrations` can create a region, a city under it, and move a location.
- The location’s reviews stay on the same location id.
- A group from another workspace or another brand is rejected.
- `npm test` covers the shape rules that already live in `lib/hierarchy.ts`.

### Phase 2 — One global scope

Dependency: phase 1, so group ids are real.

Work: one organisation / brand / group control, carried across Overview, Inbox, Escalations, Analytics, Reports, Requests, and Locations. Changing brand clears group and location. Date range defaults stay as they are. Sidebar counts for the open scope use the same window as the page. Export includes the group id.

Acceptance:

- `/overview?client=&group=` still shows that group after a refresh and after opening Inbox.
- A store manager never sees another location’s reviews, in the page or in the CSV.
- Locations and groups respect the same client and group.

### Phase 3 — Escalations that match the clock

Dependency: phase 2 for scope. External WhatsApp stays blocked until tokens exist; do not fake a sent message.

Work: keep in-app reminders honest. Either schedule the job often enough for the 2-hour and 6-hour rows, or change the product rule to match a daily job. Fix the pause copy so it matches `runAutomation`: a pause stops background draft and publish; it does not claim that no sender exists.

Acceptance:

- A due reminder is recorded once.
- An overdue row appears in Past SLA.
- Publishing the public reply leaves the escalation open until a resolution is saved.
- A paused location gets no automated draft on the next automation run.
- With `CRON_SECRET` unset, the cron route still returns 401.

### Phase 4 — Overview and analytics from stored reviews

Dependency: phases 1–2 so location and group averages are trustworthy.

Work: lowest stores, attention, and theme charts keep using `grm_dashboard_bundle`. Add 3-month change only as a comparison of two stored windows. Add a main-complaint column from `complaint_theme`, or replace the keyword list with a documented theme set. Do not add competitor numbers. Do not add a question box until it can answer from stored reviews and refuse when it cannot. Align reply-time buckets with the PDF or record a deliberate change. “Since onboarding” is a comparison against the onboarding timestamp, not a copy of the previous window.

Acceptance:

- A location with no reviews shows an em dash, not zero percent.
- Theme counts equal the 1–3 star rows in that scope and window.
- The competitors section still says ratings are not connected.
- Changing the date range changes the lowest-store list.

### Phase 5 — Inbox workflow gaps that do not need a new provider

Dependency: phase 2.

Work: keep generate, approve, and publish. Add named saved views only if they are stored filters, not a second inbox. Leave “schedule reply” and “report to Google” unimplemented until a real scheduler or a documented Google API exists. Show translation only when Google stored one.

Acceptance:

- Bulk assign changes `assigned_to` and is audited.
- A failed publish stays failed and can be approved again by someone with the same permission.
- Internal notes never appear in the Google reply body.

### Phase 6 — Reports, requests, and sign-in providers

Dependency: provider accounts. No code change should pretend a send happened.

Work: set `CRON_SECRET` in the host. Configure Resend, Slack, Twilio, or WhatsApp only for channels whose code actually sends. Remove the hard `available: false` on report WhatsApp only when a phone recipient exists. Leave Microsoft, email, SSO, and SMS sign-in hidden until their env flags are set.

Acceptance:

- An unconfigured channel is stored as unavailable, not sent.
- A configured email test records a provider acceptance or a provider error.
- A review request is not sent twice inside the saved contact window.
- Opt-out stops further sends to that contact.

### Phase 7 — Phone, files, and white label

Dependency: phases 3 and 5 for approval and escalation. File storage is a new bucket and should be private per workspace.

Work: phone date range uses the same control as the desktop scope. Photo upload waits for a private bucket and a size limit. Custom domain stays unverified until a DNS check writes `domain_verified_at`.

Acceptance:

- Skip does not change the draft.
- Approve and post uses the same permission and publish service as the inbox.
- A complaint photo cannot be read from another workspace.
- The product name stays the workspace name until a logo and title are saved.

## Remaining defects after this pass

| Item | Status | Why it remains |
|---|---|---|
| Apply `20261019003_escalation_assignment.sql` on the connected database | BLOCKED | No database URL in this workspace. The service role cannot run DDL. Until it is applied, manager assignment and the one-step SLA move are not stored. |
| Set `CRON_SECRET` and confirm the hourly escalation cron is accepted by the host | BLOCKED | Unset. Jobs 401. |
| Email, Slack, WhatsApp, SMS | BLOCKED | Provider secrets are unset. WhatsApp sending stays disabled in code. |
| Competitor column, praise themes, question box, weekly chart, drag-and-drop, attachments, billing connector | FAIL | Not implemented. The competitor column is an em dash. Themes are the keyword list, not the PDF’s billing, parking, or exchange labels. |
| Saved model insight matches the selected dates | PARTIAL | One cached row per organisation or group. The Insights page says that text is not the date range. Counted cards are. |
| Signed-in visual comparison of Overview, Inbox, Escalations, Analytics, Insights | BLOCKED | The tool browser is signed out. `/login` was compared. |
| Cal Sans fallback | PARTIAL | Production build warns that the font has no override metrics. |

Do not mark the product production-ready until the assignment migration is applied, cron can run without an open browser, and a signed-in pass confirms the main screens.

## Recommended phase order

1. Hierarchy schema, before any other feature work.
2. Global scope, so later numbers are filtered the same way.
3. Escalation clock and automation copy.
4. Overview and analytics calculations.
5. Inbox gaps that use the current Google and Gemini clients.
6. Provider delivery and extra sign-in methods.
7. Phone parity, evidence files, and domain verification.

Do not start phases 4–7 by seeding demo clients, demo reviews, or demo ratings.
