# RevuPilot — Interaction Audit

Date: 28 October 2026  
Scope: every user-facing button, link, menu item, filter, tab, form submission, and chart interaction found in the App Router UI.  
Method: static tracing of UI → handler → API/service → persistence → auth → final UI state. No application code was modified. Live Google, Gemini, email, Slack, WhatsApp, SMS, and cron were not invoked.

Related artifacts:
- Existing product/behavior audit: `docs/REVUPILOT_IMPLEMENTATION_AUDIT.md`
- Feature matrix (interaction wiring column): `docs/audits/REVUPILOT_FEATURE_MATRIX.md`

This document is the interaction backlog. It does not claim end-to-end live provider verification.

---

## Classification

| Class | Meaning |
|---|---|
| FULLY_WIRED | Control has a real handler, reaches an authorized service/API, persists or navigates as labeled, and updates UI honestly. |
| PARTIALLY_WIRED | Handler exists, but the labeled outcome is incomplete (navigates instead of acting, delivery blocked, filter drop, missing refresh, etc.). |
| INCORRECTLY_WIRED | Handler points at the wrong destination, wrong permission gate, or contradicts product copy. |
| NO_OP | Handler empty, `preventDefault` only, or never reaches side effects. |
| DECORATIVE | Looks interactive (button/link/chevron/card chrome) but has no handler, or affordance implies a control that does not exist. |
| INTENTIONALLY_DISABLED | Disabled/hidden with an honest product or env reason (missing credential, role, empty selection, channel unavailable). |
| INERT | Clickable-looking control that is dead without an intentional disabled state. |

Severity: P0 security/data integrity · P1 broken core workflow · P2 misleading or incomplete interaction · P3 polish / secondary.

---

## Verdict

Most primary workflows are **FULLY_WIRED** on the desktop shell: scope Go, inbox filters, review draft/approve/publish/bulk, escalation ticket transitions, hierarchy form moves, team invites (link path), reports CRUD (in-app), insights analyze/report jobs, Google connect/disconnect, and mobile approve/escalate paths (for roles that can open them).

The main interaction defects are **label/destination mismatches**, **role-gated nav that still shows blocked links**, **failed mutations that look successful**, and **blocked external delivery**:

1. Controls that looked like they perform an action but only navigate (Assign follow-up → Open unanswered; Send digest → Open reports).
2. Chart/theme clicks that open Insights without the theme filter the mark implies.
3. Workspace switch refreshes even when `POST /api/workspace/active` fails.
4. Support view leaves mutate buttons enabled until the proxy returns 403.
5. AI-only members see mobile Overview/Approve (and Jump-to-client) links that layout redirects away from.
6. Delivery/channel controls stay disabled or limited until env secrets exist (mostly honest).
7. Brand chevron on the home link looks like a workspace menu.
8. Settings notifications / security / plan tabs are informational only.

No P0 authorization bypass was found in the traced UI handlers. Support mutations are blocked server-side; the defect is UX. Tenant/role gates live in API routes and server pages; this pass did not re-prove every API authorization path.

Parallel read-only passes that contributed evidence: [Audit shell/admin/auth UX](3eb2002b-97b2-459b-8c1a-6168b49229eb), [Audit dashboard interactions](9630ab64-1424-473b-b8bf-ea9709ce19e1).

---

## Finding index (defects and notable partials)

| ID | Severity | Class | Area | Summary |
|---|---|---|---|---|
| INT-OV-001 | P1 | FIXED | Overview | CTA renamed **Open reports** (was “Send digest”); still navigates to `/reports` with scope. Verified 28 Oct 2026. Real email send deferred to Brevo (INT-REP-001). |
| INT-OV-002 | P2 | FIXED | Overview | CTA renamed **Open unanswered**; href is unanswered inbox for the outlet (`unansweredHref`). Verified 28 Oct 2026. |
| INT-OV-003 | P2 | FIXED | Overview | Theme bars use `insightTopicInboxExtra` → inbox (`theme`+`stars=low` or `q`+`stars=positive`). Verified 28 Oct 2026. |
| INT-OV-004 | P3 | DECORATIVE | Overview | AI insight glance cards show supporting-review counts but are not clickable to source reviews (Insights page cards are). |
| INT-SHELL-001 | P3 | DECORATIVE | Shell | Brand row shows `ChevronsUpDown` when multiple workspaces exist, but the control is a home `Link`; real switcher is the select below. |
| INT-SHELL-002 | P3 | INTENTIONAL | Shell | Header search outside Inbox/Escalations jumps to `/reviews?q=…` by design (global review search, not page-local). |
| INT-SHELL-003 | P2 | FIXED | Shell | Workspace switcher checks `response.ok` / network errors, toasts failure, refreshes only on success. Verified 28 Oct 2026. |
| INT-SHELL-004 | P2 | FIXED | Shell | Jump-to-client section hidden unless `canOpenPath("/clients", role)`. Verified 28 Oct 2026. |
| INT-SHELL-005 | P2 | FIXED | Support | `SupportViewGuard` blocks mutating `/api` fetches client-side (toast + 403 JSON); proxy still enforces. Exit impersonate allowed. Verified 28 Oct 2026. |
| INT-MOB-002 | P2 | FIXED | Mobile | `visibleMobileNav(role)` filters bottom tabs with `canOpenPath`; AI-only members see Escalations only. Verified 28 Oct 2026. |
| INT-AN-001 | P2 | FIXED | Analytics | Export CSV hits `/api/analytics/export` (leaderboard table for current rank/show/scope). Verified 28 Oct 2026. |
| INT-AN-002 | P2 | FIXED | Analytics | Complaint theme bars drill via `insightTopicInboxExtra` into the inbox. Verified 28 Oct 2026. |
| INT-AN-003 | P2 | FIXED | Analytics | Automation health copy matches `runAutomation` (draft/publish for eligible 4–5★; pause/shadow). Escalations pause blurb aligned. Verified 28 Oct 2026. |
| INT-SET-001 | P2 | FIXED | Settings | Pause/Resume toggles for the current scope and calls `router.refresh()`. Verified 28 Oct 2026. |
| INT-SET-002 | P2 | INTENTIONAL | Settings | Notifications / Security / Plan are informational (+ deep links). Prefs edit on Team; plan on Usage; auth via env. Copy clarifies. Verified 28 Oct 2026. |
| INT-SET-003 | P3 | PARTIALLY_WIRED | Settings | SLA tab summarizes policy and edits resolution contact only; complaint rules are edited on Escalations. |
| INT-REP-001 | P1 | FIXED | Reports | Email uses Brevo (`BREVO_API_KEY` + `REPORT_FROM_EMAIL`). Slack/WhatsApp unchanged. Unavailable until configured. Verified 28 Oct 2026. |
| INT-REQ-001 | P1 | INTENTIONALLY_DISABLED | Requests | WhatsApp/SMS/email channel radios disabled until providers exist; QR remains available. |
| INT-REQ-002 | P3 | DECORATIVE | Requests | “No billing system is connected” is static copy with no Connect control. |
| INT-TEAM-001 | P2 | FIXED | Team | Invites email via Brevo when configured; copy-link remains. UI reflects `emailed`. Verified 28 Oct 2026. |
| INT-HIER-001 | P2 | FIXED | Locations | **Import CSV** on Structure board (`import-csv`); moves stay form-based (DnD intentional). Verified 28 Oct 2026. |
| INT-ESC-001 | P3 | INTENTIONAL | Escalations | Resolve codes / Add phone|email insert text only; they do not place calls or send mail (copy discloses). |
| INT-MOB-001 | P3 | Missing control | Mobile | No photo/bill attachment control; speech uses browser API when present. |
| INT-AUTH-001 | P3 | INTENTIONALLY_DISABLED | Login | Microsoft / email / SSO / phone methods hidden unless env flags/secrets exist. |
| INT-PUBLIC-001 | P2 | FIXED | Public `/r` | `sent=0` shows localized `feedbackFailed` alert; `sent=1` still shows thanks. Verified 28 Oct 2026. |
| INT-ADMIN-001 | P2 | FIXED | Admin | `requests` / `reports` flags hide nav, block pages via layout, and gate save/send/cron like `automation`. Verified 28 Oct 2026. |

---

## Shell, navigation, scope, alerts

### Sidebar and mobile shell

| Control | UI | Handler | API / persistence | Auth | Final UI | Class |
|---|---|---|---|---|---|---|
| Work nav items | `AppShell` / `SidebarNav` · Overview…Requests | `Link` → `scopedHref` | None (navigation) | `visibleNav(role)` | Route change, scope query preserved | FULLY_WIRED |
| Manage / Agency nav | same | `Link` | None | role filter | Route change | FULLY_WIRED |
| Jump to client | `AppShell` client list | `Link` → `/clients/[id]` when `canOpenPath("/clients")` | None | layout `canOpenPath` | Hidden for AI-only members | FULLY_WIRED · INT-SHELL-004 FIXED |
| Workspace select | `SelectField` `#workspace-switcher` | `onValueChange` → `POST /api/workspace/active`; refresh only if ok | active workspace | membership in service | Toast on failure; refresh on success | FULLY_WIRED · INT-SHELL-003 FIXED |
| Brand / product title | `Link` to home | `scopedHref(homePath)` | None | session | Home route | FULLY_WIRED |
| Brand chevron | `ChevronsUpDown` inside home `Link` | none separate | — | — | Looks like a switcher; navigates home | DECORATIVE · INT-SHELL-001 |
| Privacy / Terms footer | `<a href>` | navigation | None | public | Legal pages | FULLY_WIRED |
| Mobile bottom nav | `MobileNav` | `visibleMobileNav(role)` links | None | `canOpenPath` | Only allowed tabs rendered | FULLY_WIRED · INT-MOB-002 FIXED |
| Support banner | layout + `SupportViewGuard` + `ExitSupportButton` | Guard intercepts mutate fetch; Exit DELETE impersonate | Client guard + proxy 403 | support cookie | Immediate toast; no network mutate | FULLY_WIRED · INT-SHELL-005 FIXED |
| Open / close sidebar | Menu / X buttons | local state | None | — | Drawer open/close | FULLY_WIRED |

### Header: scope, date, search, account, alerts

| Control | UI | Handler | API / persistence | Auth | Final UI | Class |
|---|---|---|---|---|---|---|
| Organisation / group / outlet | `ScopeSelector` via `GlobalFilters` | draft → **Go** writes URL | Server re-render via URL | scope catalog | Filtered page | FULLY_WIRED |
| Date range | `DateRangeFilter` | draft → **Go** | URL params | path allow-list in `lib/shell` | Filtered page | FULLY_WIRED |
| Go | `GlobalFilters.applyFilters` | `router.push` + filter frame | None | — | Pending region then new HTML | FULLY_WIRED |
| Search | `ShellHeader.submitSearch` | On `/reviews` or `/escalations`: URL `q`. Else navigate to `/reviews?q=…` | Server filter | — | Inbox results | INTENTIONAL · INT-SHELL-002 |
| Debounced search | `useEffect` on Inbox/Escalations | `router.push` after 320ms | URL | — | Live filter | FULLY_WIRED |
| Alerts bell | `DropdownMenu` | click → optional `POST /api/notifications/:id/read` then `router.push(href)` | notice read | role-filtered `shellAlerts` | Destination page | FULLY_WIRED |
| Sign out | Account menu | `supabase.auth.signOut` → `/login` | session cleared | — | Login | FULLY_WIRED |

---

## Overview (`/overview`)

| Control | Handler chain | Class | Notes |
|---|---|---|---|
| **Open reports** | `Link` → `links.reports` (`/reports?scope…`) | FULLY_WIRED · INT-OV-001 FIXED | Label matches navigation. Digest email send is a separate Reports/Brevo path. |
| Continue setup | `Link` → `/onboarding` | FULLY_WIRED | Managers when gate incomplete. |
| KPI tiles | `Link` → reviews / negative / unanswered / escalations | FULLY_WIRED | `OverviewMetricsPanel` / `Kpi`. |
| Month bars | `MonthVolumeChart` → month `href` inbox drill | FULLY_WIRED | When `href` set by board. |
| Star mix bars | `HBarChart` → rating filter href | FULLY_WIRED | |
| Open insights | `Link` → `board.insightsHref` | FULLY_WIRED | |
| Theme labels | `Link` → `theme.href` = Insights URL | PARTIALLY_WIRED · INT-OV-003 | `themeBars(..., insightsHref)` in `lib/overview-board.ts`. |
| All complaint themes | `Link` → Analytics `section=themes` | FULLY_WIRED | |
| Lowest outlets / outlet name | `Link` → outlet overview or reviews | FULLY_WIRED | |
| Needs attention rows | `Link` → `item.href` | FULLY_WIRED | |
| Open outlet | `Link` → outlet overview | FULLY_WIRED | |
| **Open unanswered** | `Link` → `store.unansweredHref` | FULLY_WIRED · INT-OV-002 FIXED | Label matches unanswered inbox drill. |
| Insight glance cards | static `<li>` | DECORATIVE · INT-OV-004 | No click; Insights page has source-review links. |

Charts without `href` still show hover tips only (`ChartTip` is `pointer-events-none`) — intentional, not inert buttons.

---

## Inbox (`/reviews`)

| Control | Handler chain | Auth | Class |
|---|---|---|---|
| Status / rating / language / theme / assignee / text / sort filters | `ReviewFilters` draft → Apply → URL → server query | membership + scope | FULLY_WIRED |
| Clear filters | `ClearFiltersButton` | — | FULLY_WIRED |
| Pagination | `PaginationBar` URL | — | FULLY_WIRED |
| Export CSV | `<a href=/api/reviews/export?…>` | export route auth | FULLY_WIRED |
| Sync all | `SyncButton` → `POST /api/reviews/sync` | `canSyncWorkspace` | FULLY_WIRED |
| Row open | local state → `ReviewDetailPanel` | — | FULLY_WIRED |
| Bulk generate / approve / publish / discard / assign | `runBulk` → `POST /api/reviews/bulk` (+ job poll) | approve/publish gates | FULLY_WIRED |
| Bulk assign without selection / assignee | `disabled` | — | INTENTIONALLY_DISABLED |
| Detail: Generate AI | `POST /api/reviews/:id/generate` | role / ai-only | FULLY_WIRED (Gemini env required at runtime) |
| Detail: Save / edit / delete draft | reply POST/PUT/DELETE | role | FULLY_WIRED |
| Detail: Approve / Publish / Approve+Publish / Submit | approve + publish routes | `canApprove` / aiOnly | FULLY_WIRED |
| Shorter / warmer / regenerate / language / template | generate / template routes | — | FULLY_WIRED |
| Assign person | `POST …/workflow` | — | FULLY_WIRED |
| Internal note | `POST …/workflow` notes | — | FULLY_WIRED |
| Add phone / email / both | inserts resolution contact sentence into draft | disabled if contact unset | INTENTIONALLY_DISABLED when empty · else FULLY_WIRED |
| Schedule reply | **absent** | — | Missing control (not an inert button) |
| Report to Google | **absent** | — | Missing control |
| Saved views | **absent** | — | Missing control |

---

## Escalations

| Control | Handler chain | Class |
|---|---|---|
| Queue tabs / sort / pagination | URL `queue` / `sort` / `page` | FULLY_WIRED |
| Ticket key / case links | `/escalations/[id]` | FULLY_WIRED |
| Complaint rules form | `POST /api/escalations/policy` | FULLY_WIRED (managers) |
| Pause automation form | `POST /api/escalations/pause` | FULLY_WIRED |
| Ticket: start / reassign / resolve / comment / level | `POST /api/escalations/:id` | FULLY_WIRED |
| Public reply generate / save | reply + generate APIs | FULLY_WIRED |
| Add phone / email / both | text insert only | INTENTIONAL · INT-ESC-001 |
| Attach file / ask customer to update | **absent** | Missing controls |

---

## Analytics (`/analytics`)

| Control | Handler chain | Class |
|---|---|---|
| Section tabs | URL `section` | FULLY_WIRED |
| Rank by / show / compare | URL params into board | FULLY_WIRED |
| KPI tiles with href | inbox / escalations drills | FULLY_WIRED |
| Month / HBar / VBar with href | review drills | FULLY_WIRED |
| Leaderboard location links | inbox drill | FULLY_WIRED |
| Theme bars | inbox drill via `insightTopicInboxExtra` | FULLY_WIRED · INT-AN-002 FIXED |
| Team member bars | assignee filter drill | FULLY_WIRED |
| Export CSV | `/api/analytics/export` leaderboard | FULLY_WIRED · INT-AN-001 FIXED |
| Automation health prose | matches Settings / cron automation | FULLY_WIRED · INT-AN-003 FIXED |
| Competitor ratings control | **absent** (older audit; current Themes tab has no Competitors UI) | Missing / removed surface |

Profile verification tiles without `href` are display-only — intentional.

---

## Insights (`/insights`)

| Control | Handler chain | Class |
|---|---|---|
| Analyse reviews | `InsightAnalyzer.start` → `POST /api/insights/analyze` + status poll | FULLY_WIRED · disabled when nothing pending |
| Write / refresh report | `InsightReportPanel` → `/api/insights/report` + status | FULLY_WIRED |
| View source reviews | `Link` to inbox with evidence query | FULLY_WIRED |
| In-page section anchors | `#…` links | FULLY_WIRED |
| Sentiment / theme charts | display (+ metrics strip); no fake click targets | FULLY_WIRED display |

---

## Reports and alerts (`/reports`)

| Control | Handler chain | Class |
|---|---|---|
| Channel availability list | read-only from `channelOptions` | FULLY_WIRED display |
| Create / edit / delete report | POST/PATCH/DELETE `/api/reports` | FULLY_WIRED (canManage) |
| Preview | `/reports/[id]` | FULLY_WIRED |
| PDF / CSV | `/api/reports/:id/pdf|csv` | FULLY_WIRED (text PDF quality is a product gap, not inert) |
| Send test | `POST /api/reports/:id/test` | FULLY_WIRED when Brevo/Slack configured · INT-REP-001 FIXED |
| Alert create / edit / delete / Check now | `/api/alerts` (+ run) | FULLY_WIRED for persistence; delivery same channel limits |
| WhatsApp channel | always `available: false` in `channelOptions` | INTENTIONALLY_DISABLED |
| Review / usage export links on page | export APIs | FULLY_WIRED |

---

## Review requests (`/requests`, public `/r/[token]`)

| Control | Handler chain | Class |
|---|---|---|
| Save limit | `POST /api/requests/policy` | FULLY_WIRED |
| Channel radios | disabled when `!option.available` | INTENTIONALLY_DISABLED · INT-REQ-001 |
| New request form | `POST /api/requests` | FULLY_WIRED for QR/CSV drafts |
| Send / test / delete campaign | send/test/DELETE APIs | PARTIAL when delivery env missing (API returns honest error) |
| QR SVG / PDF links | `/api/requests/qr…` | FULLY_WIRED |
| Billing connect | static sentence only | DECORATIVE · INT-REQ-002 |
| Public Google CTA | `/r/:token/google` | FULLY_WIRED when URL present |
| Public private feedback | `POST /r/:token/feedback` → `?sent=1` or `?sent=0` | FULLY_WIRED · INT-PUBLIC-001 FIXED |
| Opt out | `POST /r/:token/opt-out` | FULLY_WIRED |

---

## Locations and groups (`/clients`)

| Control | Handler chain | Class |
|---|---|---|
| Sync profiles / Connect Google | `SyncLocationsButton` / Settings link | FULLY_WIRED |
| Attention stats | link when count > 0 | FULLY_WIRED |
| Organisation cards | `/clients/[id]` | FULLY_WIRED |
| Hierarchy: New group, move, managers, tags, overrides, remove | `POST /api/locations/hierarchy` | FULLY_WIRED |
| Move via form / Import CSV | hierarchy move + `import-csv` | FULLY_WIRED · INT-HIER-001 FIXED (DnD intentional absence) |
| Unassigned assign / reset | location APIs | FULLY_WIRED |
| Client detail: disconnect location, sync, queue decide | location + client APIs | FULLY_WIRED |

---

## Team, audit, settings

| Control | Handler chain | Class |
|---|---|---|
| Invite / revoke / resend / copy link | `/api/workspace/invites` | PARTIALLY_WIRED email · INT-TEAM-001 |
| Change role / scope / remove / leave | `/api/workspace/members` | FULLY_WIRED |
| Alert email / in-app toggles | member PATCH | FULLY_WIRED flags; delivery env separate |
| Audit filters / pagination | URL → server log query | FULLY_WIRED |
| Settings section tabs | URL `section` | FULLY_WIRED navigation |
| Scope chips | URL `scope` | FULLY_WIRED |
| AI config panel | `/api/settings/ai` | FULLY_WIRED |
| Tone / automation save / clear / templates | `/api/settings/reply` | FULLY_WIRED |
| Pause / Resume now | `/api/escalations/pause` + `router.refresh()` | FULLY_WIRED · INT-SET-001 FIXED |
| Local preview / Try another | preview action | FULLY_WIRED |
| Branding form | `/api/settings/branding` | FULLY_WIRED |
| Google connect / disconnect | OAuth + disconnect API | FULLY_WIRED |
| Notifications / Security / Plan bodies | informational + deep links | INTENTIONAL · INT-SET-002 |
| SLA body | summary + `ResolutionContactForm` | PARTIALLY_WIRED · INT-SET-003 |

---

## Agency (`/dashboard`), onboarding, auth, landing

| Control | Handler chain | Class |
|---|---|---|
| Search clients | GET form `/dashboard` | FULLY_WIRED |
| KPI cards | display only | Display (not defects) |
| Open client | `/clients/[id]` | FULLY_WIRED |
| Export usage | `ExportUsageButton` → usage export | FULLY_WIRED |
| Approval queue link | clients / client page | FULLY_WIRED |
| Onboarding wizard steps | `/api/onboarding`, Google connect, invites | FULLY_WIRED |
| Login Google | Supabase OAuth | FULLY_WIRED when configured |
| Login other methods | rendered only if `authMethodsFromEnv` available | INTENTIONALLY_DISABLED · INT-AUTH-001 |
| Landing CTAs | `/login` or `/overview`, `#` anchors, signout | FULLY_WIRED |
| Consent form | `/api/account/consent` | FULLY_WIRED |
| Create tenant | `/api/platform/tenant` | FULLY_WIRED |
| Request access | `/api/platform/access-requests` | FULLY_WIRED |
| Client connect `/c/[token]` | Google connect flow | FULLY_WIRED |

---

## Mobile (`/m`, `/m/approve`, `/m/escalations`)

| Control | Handler chain | Class |
|---|---|---|
| Overview metric links | scoped mobile hrefs | FULLY_WIRED |
| Approve: generate / shorter / warmer / speak | generate + Speech API | FULLY_WIRED / speech capability-gated |
| Approve and post / send for approval | approve+publish / submit | FULLY_WIRED |
| Needs a manager | `POST /api/escalations/open` | FULLY_WIRED |
| Post all ready | bulk publish | FULLY_WIRED |
| Skip | URL advance | FULLY_WIRED |
| Complaint: note, resolve, level, draft, submit | escalation + reply APIs | FULLY_WIRED |
| Add photo | **absent** | Missing · INT-MOB-001 |

---

## Platform admin (`/admin/**`)

| Control | Handler chain | Class |
|---|---|---|
| Admin nav | Links to tenants/health/users/ops | FULLY_WIRED |
| Invite / resend / revoke tenants | `/api/platform/invites*` | FULLY_WIRED (email optional) |
| Suspend / delete / reactivate / restore | `/api/platform/tenants*` | FULLY_WIRED + confirm dialog |
| Impersonate / exit support | impersonate POST/DELETE | FULLY_WIRED |
| Tenant feature flags (automation / requests / reports) | PATCH tenant settings | FULLY_WIRED · INT-ADMIN-001 FIXED |
| Users search / block | URL + `/api/platform/users` | FULLY_WIRED |
| Ops: bulk invite, access approve/deny, announcements, maintenance | platform APIs | FULLY_WIRED (announcement Hide/Show errors may fail without toast) |

---

## Chart interaction rules (cross-cutting)

1. Marks with `href` navigate; marks without `href` are hover-only (`ChartTip`).
2. No chart invents metrics on click.
3. Defect pattern: several theme marks use Insights URL instead of theme-filtered inbox (INT-OV-003, INT-AN-002).

---

## Intentional disabled vs defects

| Pattern | Classification |
|---|---|
| Bulk / publish buttons disabled with empty selection or in-flight load | INTENTIONALLY_DISABLED |
| Channel radios / WhatsApp report channel unavailable with reason text | INTENTIONALLY_DISABLED / blocked env |
| Auth methods not rendered when secrets unset | INTENTIONALLY_DISABLED (hidden) |
| Add phone/email disabled until Settings contact saved | INTENTIONALLY_DISABLED |
| Analyse disabled when `pendingCount === 0` | INTENTIONALLY_DISABLED |
| Resolve/quick actions that only store codes, with UI copy saying so | INTENTIONAL product limit, not inert |
| Support mutate APIs | FIXED · INT-SHELL-005 (client guard + proxy) |
| **Assign follow-up** → **Open unanswered** | FIXED · INT-OV-002 |
| **Send digest** → **Open reports** | FIXED · INT-OV-001 |
| Brand chevron implying workspace menu | DEFECT (DECORATIVE affordance) |
| Workspace switch without `response.ok` | FIXED · INT-SHELL-003 |
| AI-only mobile Overview/Approve + Jump-to-client links | FIXED · INT-MOB-002, INT-SHELL-004 |
| Pause now without refresh | DEFECT (PARTIALLY_WIRED) |
| Public feedback `sent=0` silent | FIXED · INT-PUBLIC-001 |
| Admin requests/reports flags unenforced | DEFECT (PARTIALLY_WIRED) |
| Automation health denying automatic sender | DEFECT (INCORRECTLY_WIRED copy) |
| Static “billing system” sentence with no control | DEFECT (DECORATIVE / missing) |

---

## Coverage notes

- Traced: dashboard routes under `app/(dashboard)`, shell, landing, login, consent, create-tenant, admin boards, public `/r` and `/c`, legal links, and the interactive components those pages mount.
- Cross-checked against parallel shell/admin/auth and dashboard interaction passes (linked above).
- Not claimed: live click-through with production credentials; every API authorization unit proof; cron firing; actual Resend/Slack/Twilio/WhatsApp delivery.
- Wireframe features with **no control present** (schedule reply, report to Google, drag-and-drop hierarchy, billing connector, ask-a-question box, competitor tab, attach photo) are listed as missing controls rather than inert buttons.

---

## Recommended remediation order (interaction-only)

1. P1: Rename or rewire **Send digest** (INT-OV-001); clarify report delivery failures (INT-REP-001); keep request channel disables honest (INT-REQ-001).
2. P2: Theme drills / analytics export & copy (INT-OV-003, INT-AN-001–003); Pause now refresh (INT-SET-001); enforce or remove unused tenant flags (INT-ADMIN-001). INT-OV-002, INT-SHELL-003/004/005, INT-MOB-002, INT-PUBLIC-001 FIXED.
3. P3: Brand chevron (INT-SHELL-001); insight card links on Overview (INT-OV-004); billing copy (INT-REQ-002).

Stop. No application code was changed in this pass.
