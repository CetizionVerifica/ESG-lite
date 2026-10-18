# KPI wave D: topic-wise assignment, Superadmin parity, fixes, remaining modules

Written 2026-10-18 after Shyam tested waves A–C locally. This is binding for wave D and overrides any earlier spec text it contradicts. Add D17 and D18 below to `docs/kpi/04-decisions.md`, and the new endpoints to `01-contracts.md` §3 (KPI-0 follow-up).

## D17 · Contributors are assigned KPIs by topic (fixed by Shyam, 2026-10-18)
> "user or data contributor is assigned a topicwise KPIs"

**Model**
- Per company, each **site** (and the **company level**, `site_id` null) maps each KPI topic (`KPI_TOPICS`: climate, energy, water, waste, pollution, biodiversity, materials, workforce, health_safety, diversity, training, human_rights, community, customers, governance, ethics) to one **owner**. The reviewer is optional, and null means the site's Managers.
- New table `kpi_topic_assignment(id, company_id, site_id null, topic, owner_user_id, reviewer_user_id null, created_at, updated_at, updated_by)`, unique on (company_id, COALESCE(site_id,0), topic). It is added by an additive, idempotent migration; mirror the expression index in `ci/api/fixture.sql`.
- Owner rules:
  - The owner of a site topic must be a User or Manager of that site.
  - The owner of a company-level topic must be a user of the company (Admin, Manager or User).
  - A reviewer must be a Manager of the site.
  - These use the same `KPI_VALUE_INVALID` rules as `kpi_assignment`.

**Who owns a KPI × site** (one resolver, `resolveOwner`, used everywhere):
1. an explicit `kpi_assignment` row for that KPI × site (a per-KPI override);
2. otherwise the `kpi_topic_assignment` for (site, the KPI's topic);
3. otherwise nobody (unassigned).

Every place that uses the owner or reviewer goes through the resolver:
- `/kpi/my`;
- the write permission on `PUT /kpi/values`;
- submit, which sends `kpi_submitted` to reviewers;
- reminders (`kpi_due`), invite (`kpi_assigned`) and dashboard remind;
- dashboard gaps (owner) and the lock "left" list;
- the expected-site rule.

A KPI selected later inherits the topic's owner with no extra step.

**Write permission for a User:** only KPI × site pairs they own, through either path. The wave B rule "Users may write unassigned pairs within their topic grants" is removed. Managers, Admins and Superadmins keep their current rights.

**`kpi_topic_grant`:** stop reading it. The topic list is now derived from topic assignments. Keep the table (no destructive change). The migration converts any existing grants into topic assignments for that user's sites, but only where the slot is empty. There is no production data yet, so this is just for safety.

**API**
- `GET /kpi/setup` adds:
  - `topic_assignments: [{id, site_id, topic, owner_user_id, reviewer_user_id}]`;
  - `suggested_topic_assignments`, the same shape;
  - `topics_in_use: [{topic, kpi_count}]`, the topics of the selected KPIs, in KPI_TOPICS order.
  - Default suggestion: for each site and each topic in use, the site's first User. For the company level, the first Admin.
- `PUT /kpi/setup` accepts `topic_assignments`, which replaces the whole set. `owner_user_id: null` removes a row. `assignments` stays as the per-KPI override list.
- `PUT /kpi/people/:user_id/topics {company_id?, topics: KpiTopic[], site_ids?: number[]}` is for the Users drawer. It is open to Admin and Superadmin, and a Manager may use it for their own sites.
  - It makes the person the owner of those topics on those sites. `site_ids` defaults to all of the person's sites.
  - It removes them as owner of any other topic on those sites.
  - It answers `{topics, site_ids, moved:[{site_id, site_name, topic, from_user_id, from_name}]}` so the UI can say "Water at Noida moved from Ravi to Priya".
  - It is audited.
- `GET /kpi/people/:user_id/topics` answers `{topics, by_site:[{site_id, site_name, topics}]}`.
- The wave B `PATCH /company-admin/users/:id {kpi_topics}` becomes a thin alias of the PUT above, so nothing breaks.
- `/kpi/my` items add `topic` and `topic_label`, and are sorted by topic order.

**UI (05-ux.md S2 step 4 changes)**
- **"Who enters what"** opens on **By topic**:
  - The grid is topics (rows) × sites (columns), plus a Company column for company-level KPIs.
  - Each cell is a person combobox showing the number of KPIs, e.g. "Water · 6 KPIs".
  - "Same person for every site" fills a row.
- **"Exceptions"** is a secondary tab holding the per-KPI override list. Overrides show a small "Different from topic owner" marker.
- **Company users drawer** gets a **"KPI topics"** field: multi-select chips with an optional site restriction. It is visible only while the switch is on. Saving shows any "moved from" notes as a toast.
- **My KPIs** groups rows under topic headings ("Water", "Waste", …), each with a count and progress. The topic chip filter is in the URL.

## D18 · Superadmin can do everything an Admin can for KPIs (fixed by Shyam, 2026-10-18)
> "All the controls which admin have related to KPIs should also be available with superadmin."

Everything an Admin can do for KPIs, a Superadmin can do for the client selected in the client context, passing `company_id`. This applies to both the backend and the frontend, with no Admin-only gaps.

**Backend:** audit every `/kpi/*` route and every KPI field on non-KPI routes, including the company-users topic field. For each one, the role matrix must give Superadmin the Admin's rights:
- setup (all steps, complete, custom KPIs, invite);
- topic assignments and people topics;
- targets (write);
- period lock and unlock, at both company and site level;
- dashboard and remind;
- reports;
- auto refresh;
- values (write anything).

The Superadmin also keeps the review rights it already has (approve and reject, with no self-review restriction). Add an API test that walks the route table: for every route an Admin passes, a Superadmin with `company_id` must pass too, and without `company_id` must get `KPI_COMPANY_REQUIRED`.

**Frontend:** every KPI page and control an Admin sees is also shown to a Superadmin. This covers:
- `/kpi/setup` (wizard and tabs), `/kpi/targets` (set, edit, delete) and `/kpi/dashboard` (remind, refresh);
- `/reports/kpi/*`;
- the Approvals → KPIs tab, including close and reopen period (fixes the gap where Approvals was Manager-only for the KPI tab);
- the company users "KPI topics" field;
- the custom-KPI drawer and invite.

When no client is selected, these pages show "Choose a client to see its KPIs" with the client picker. They never show a broken or empty page.

Add a Playwright spec that, as Superadmin with a client chosen, walks setup, topic assignment, target, review, close, dashboard remind and a report download.

## Fixes from the wave C report
1. The Superadmin can reach the KPI review tab (D18).
2. Targets gets a nav link, under KPIs next to Dashboard, for Manager, Admin and Superadmin. Command-palette entries are added for KPI dashboard, Targets, Framework reports and KPI setup, following switch and role.
3. **KPI-10 Overview tiles:** "KPI readiness" (coverage per enabled framework) and "KPIs due this month" (due, sent back) on the Overview page. Shown only while the switch is on; they link to the dashboard and My KPIs. The backend adds `GET /kpi/overview` → `{readiness:[{framework, version, percent}], due:{due, sent_back, done}, period}` for the caller's scope.
4. **Fuel densities in `data/kpi/ncv.json`:** check them against the current UK Government GHG conversion factors (DESNZ/DEFRA 2025, "Fuel properties"). Cite the table and set `verified: true` per fuel that matches. Keep any that can't be confirmed as `verified: false` with a note. If a value changes, update the KPI-5 golden by hand.

## Remaining modules
- **KPI-7 part 3:** the table view (a keyboard grid of due items × periods, Tab/Enter, with the same validation, whose row drawer opens `KpiQuestionCard`), and `GET /kpi/my/template?period=&site=` (XLSX) and `POST /kpi/my/template` (plan, then commit as drafts, reusing the bulk-upload drop-and-review UI). Template rows are only what the caller owns, per D17.
- **KPI-12 AI assist:** per `modules/KPI-12-ai-assist/CLAUDE.md` and `layers/python_AI_service-kpi/CLAUDE.md`. Suggest only.
- **KPI-13 verification:** per `modules/KPI-13-verification/CLAUDE.md`. Golden cases, workflow steps K1–K8 (now including D17 topic assignment and D18 Superadmin parity), and `audit/harness/kpi-probes.cjs` with zero findings. Show the emissions golden is byte-identical with KPI tracking on and off.
