# RevuPilot — Feature Matrix (Interaction Wiring)

Date: 28 October 2026  
Companion to: `docs/audits/REVUPILOT_INTERACTION_AUDIT.md`  
Product/behavior baseline: `docs/REVUPILOT_IMPLEMENTATION_AUDIT.md`  
Code was not modified in this pass.

## Status keys

| Column | Values |
|---|---|
| Product status | PASS / PARTIAL / FAIL / BLOCKED (from implementation audit + current code spot-check) |
| Interaction | FULLY_WIRED / PARTIALLY_WIRED / INCORRECTLY_WIRED / DECORATIVE / INTENTIONALLY_DISABLED / MISSING / N/A |
| Finding | Interaction audit ID when applicable |

---

## Work surfaces

| Feature | Route / UI | Product | Interaction | Finding |
|---|---|---|---|---|
| Scope (org / group / outlet) + Go | `GlobalFilters`, `ScopeSelector` | PASS | FULLY_WIRED | |
| Date range filter | `DateRangeFilter` | PASS | FULLY_WIRED | |
| Header search → inbox | `ShellHeader` | PASS | INTENTIONAL | INT-SHELL-002 |
| Alerts bell | `ShellHeader` | PARTIAL | FULLY_WIRED | |
| Workspace switcher | `AppShell` select | PASS | FULLY_WIRED | INT-SHELL-003 FIXED |
| Brand row chevron | `AppShell` | — | DECORATIVE | INT-SHELL-001 |
| Jump to client (AI-only roles) | `AppShell` | PASS | FULLY_WIRED | INT-SHELL-004 FIXED |
| Support view mutate CTAs | dashboard layout + guard + proxy | PASS | FULLY_WIRED | INT-SHELL-005 FIXED |
| Sidebar nav (role-filtered) | `AppShell` / `visibleNav` | PASS | FULLY_WIRED | |
| Overview scorecard KPIs | `client-overview` | PASS | FULLY_WIRED | |
| Open reports (was Send digest) | Overview header | PASS | FULLY_WIRED | INT-OV-001 FIXED |
| Month / star charts drill | Overview / Analytics | PARTIAL | FULLY_WIRED | |
| AI insight panel | Overview | PARTIAL | FULLY_WIRED themes; glance cards still static | INT-OV-003 FIXED, INT-OV-004 |
| Open unanswered (was Assign follow-up) | Worst-store CTA | PASS | FULLY_WIRED | INT-OV-002 FIXED |
| Ask a question about numbers | Overview | FAIL | MISSING | |
| Inbox list + detail | `/reviews` | PASS | FULLY_WIRED | |
| Inbox filters (status, stars, language, theme, assignee, text, sort) | `ReviewFilters` | PASS | FULLY_WIRED | |
| Saved views | Inbox | FAIL | MISSING | |
| Bulk generate / approve / publish / discard / assign | `ReviewList` | PARTIAL | FULLY_WIRED | |
| AI draft / adjust / template | `ReviewDetailPanel` | PARTIAL | FULLY_WIRED | |
| Approve + publish | reply APIs | PARTIAL | FULLY_WIRED | |
| Schedule reply | Inbox | FAIL | MISSING | |
| Report review to Google | Inbox | FAIL | MISSING | |
| Internal note | workflow API | PASS | FULLY_WIRED | |
| Escalation queues | `EscalationBoard` | PASS | FULLY_WIRED | |
| Escalation policy / pause | board forms | PASS | FULLY_WIRED | |
| Escalation ticket actions | `EscalationTicket` | PASS | FULLY_WIRED | |
| SLA WhatsApp reminders | cron + delivery | BLOCKED | INTENTIONALLY_DISABLED | |
| Attach file on escalation | Escalations | FAIL | MISSING | |
| Analytics tabs | `/analytics` | PARTIAL | FULLY_WIRED | |
| Analytics export CSV | header link | PASS | FULLY_WIRED | INT-AN-001 FIXED |
| Theme chart → inbox drill | Analytics Themes | PASS | FULLY_WIRED | INT-AN-002 FIXED |
| Automation health copy | Analytics | PASS | FULLY_WIRED | INT-AN-003 FIXED |
| Competitor ratings | Analytics | FAIL | MISSING | |
| Insights analyse | `InsightAnalyzer` | PARTIAL | FULLY_WIRED | |
| Insights report | `InsightReportPanel` | PARTIAL | FULLY_WIRED | |
| Source-review links | Insights cards | PARTIAL | FULLY_WIRED | |
| Scheduled reports CRUD | `ReportsBoard` | PASS | FULLY_WIRED | |
| Report PDF / CSV / preview | reports | PARTIAL | FULLY_WIRED | |
| Report / alert external delivery | Brevo / Slack / WhatsApp | PASS email when Brevo set | FULLY_WIRED email · Slack optional · WhatsApp off | INT-REP-001 FIXED |
| Alert rules + Check now | Reports | PARTIAL | FULLY_WIRED | |
| Review request policy / campaigns / QR | `RequestBoard` | PARTIAL | FULLY_WIRED / INTENTIONALLY_DISABLED | INT-REQ-001 |
| Billing system connect | Requests | FAIL | DECORATIVE | INT-REQ-002 |
| Public request page | `/r/[token]` | PASS | FULLY_WIRED | |
| Hierarchy create / move / managers | `HierarchyBoard` | PARTIAL | FULLY_WIRED | |
| Drag-and-drop locations | Locations | N/A | INTENTIONAL (form move) | INT-HIER-001 |
| CSV import on locations page | Locations | PASS | FULLY_WIRED | INT-HIER-001 FIXED |
| Team invite / roles / remove | `WorkspaceMembersCard` | PASS | FULLY_WIRED (Brevo email when configured) | INT-TEAM-001 FIXED |
| Audit log | `/audit` | PASS | FULLY_WIRED | |
| Settings tone / automation / templates / AI | `/settings` | PARTIAL | FULLY_WIRED | |
| Settings Pause / Resume | Settings tone | PASS | FULLY_WIRED | INT-SET-001 FIXED |
| Settings notifications / security / plan | Settings tabs | PASS | INTENTIONAL | INT-SET-002 |
| Settings SLA tab | Settings | PARTIAL | PARTIALLY_WIRED | INT-SET-003 |
| Google integrations card | Settings | PASS | FULLY_WIRED | |
| Branding | Settings | PARTIAL | FULLY_WIRED | |
| Agency portfolio | `/dashboard` | PASS | FULLY_WIRED | |
| Agency usage export | dashboard | PASS | FULLY_WIRED | |
| Onboarding wizard | `/onboarding` | PASS | FULLY_WIRED | |
| Login Google | `/login` | PARTIAL | FULLY_WIRED | |
| Login Microsoft / email / SSO / phone | `/login` | BLOCKED | INTENTIONALLY_DISABLED | INT-AUTH-001 |
| Mobile overview / approve / complaint | `/m*` | PARTIAL | FULLY_WIRED (nav role-filtered) | INT-MOB-002 FIXED |
| Mobile photo attach | `/m/escalations` | FAIL | MISSING | INT-MOB-001 |
| Platform admin tenants / users / ops | `/admin*` | PASS | FULLY_WIRED | |
| Tenant feature flags requests/reports | admin tenant detail | PASS | FULLY_WIRED | INT-ADMIN-001 FIXED |
| Public request feedback errors | `/r/[token]` | PASS | FULLY_WIRED | INT-PUBLIC-001 FIXED |
| Landing CTAs | `/` | PASS | FULLY_WIRED | |
| Consent | `/consent` | PASS | FULLY_WIRED | |
| Legal | `/privacy`, `/terms` | PASS | FULLY_WIRED | |

---

## Interaction defect summary

| Severity | Count | IDs |
|---|---|---|
| P1 | 1 open | INT-REQ-001 (WhatsApp/SMS; email uses Brevo when set) |
| P2 | 0 open | — |
| P3 | 7 | INT-OV-004, INT-SHELL-001, INT-SET-003, INT-REQ-002, INT-ESC-001, INT-MOB-001, INT-AUTH-001 |

INT-ESC-001 and INT-AUTH-001 are intentional limits with honest UI; listed for coverage, not as open wiring bugs.

---

## Notes for remediation phases

- Phase A (security): no P0 interaction-auth bypass; support mutations already 403 — fix UI (INT-SHELL-005). Keep API authorization checks when changing handlers.
- Phase B (workflows): INT-OV-001, INT-OV-002, INT-SHELL-003, INT-MOB-002, INT-SHELL-004, INT-SET-001, INT-PUBLIC-001.
- Phase C (analytics): INT-AN-001–003, theme drills INT-OV-003 / INT-AN-002.
- Phase E (reports/requests): INT-REP-001, INT-REQ-001–002, INT-ADMIN-001 — do not claim delivery or flag enforcement without real gates.
- Phase G (UX): INT-SHELL-001, INT-OV-004, informational Settings tabs INT-SET-002.

Update this matrix when a finding is fixed: set Interaction to FULLY_WIRED and point evidence at the verifying test or commit.
