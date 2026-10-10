# P16 backend · GET /admin/console (claim)

The Console page (P16, ESG-lite_FE #101) shows "Entries this month: Not available yet"
and has no bulk-upload or onboarding activity, because no endpoint counts across
clients. Plan:

1. ESG-lite: `GET /admin/console` (Superadmin): totals (clients, active clients,
   sites, users, emission factors, entries entered this month, pending entries),
   per-client entries this month and pending, and recent activity (bulk uploads,
   factor uploads, onboarding). Onboarding needs `company.created_at`
   (additive `migrate:company-created-at`; existing clients have no date).
2. ESG-lite_FE: Console reads it for the KPI, the per-client "This month" column
   and the activity list.
