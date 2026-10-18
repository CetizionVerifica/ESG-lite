# KPI-13 · Golden cases, workflow test and probes

> Module spec. Lane L5. Copy to `ESG-lite/ci/golden/kpi/CLAUDE.md`. PR titles `[KPI-13 draft k/m]` (wave 1) and `[KPI-13 k/m]` (wave 4).
> Depends on: KPI-0 (draft), all modules (final) · Owns: `ci/golden/kpi/*`, `ci/workflow` KPI steps, `audit/harness/kpi-probes.cjs` · Touches: `ci/workflow/scenario.cjs` (a `KPI` block), `ci/workflow/README.md`

## Job to be done
Prove, continuously, that:
- the switch hides everything when off;
- KPI numbers are right (auto values match the GHG report; formulas and unit conversions are worked out by hand);
- framework exports contain exactly the approved values;
- nothing KPI moves an existing emission total.

## Build
### Draft (wave 1)
1. **`ci/golden/kpi/`:** fixture year data, with expected values worked by hand in `cases.json` (auto, formulas, units, aggregation, reports). Each case starts as `skip: "waits on KPI-n"`, and the module that builds it switches it to `run`.
2. **`ci/workflow` steps, skipped until their module lands:**
   - **K1** Superadmin switches a client on, while another client stays off and sees nothing;
   - **K2** Admin setup (GRI + BRSR + ESRS, E3 not material with a reason);
   - **K3** a contributor enters water and waste, attaches evidence and submits;
   - **K4** auto Scope 1/2 equal the workflow's GHG figures;
   - **K5** the Manager approves all ready, rejects one and closes the period;
   - **K6** the dashboard shows the expected coverage;
   - **K7** the exports carry the expected values;
   - **K8** switching off hides it and keeps the data.
3. **`kpi-probes.cjs`:**
   - a route table checking switch-off, tenant isolation and the role matrix for every `/kpi` endpoint;
   - it runs in a scratch database like the S3-16 probes.

### Final (wave 4)
1. Every case and step runs; the probes report zero findings.
2. The emissions golden snapshot is byte-identical with KPI tracking on and off for the fixture client.

## Tests
This module is the tests.

## Done when
CI fails if any KPI number, export, gate or role breaks, or if KPI work moves an emission total.

## As built (KPI-13 final, wave D, 2026-10-18)
- `ci/golden/kpi/cases.json`: the index of every KPI golden suite (owner, file, runner, `status: run`): auto (KPI-5, `auto.json`, `ci/api/tests/kpi-5-auto.test.cjs`), formulas (KPI-6, `formulas.json`, `ci/unit/kpi-formulas.test.cjs`), reports (KPI-11, `reports/`, `ci/unit/kpi-reports.test.cjs`), and inline units and aggregation cases (KPI-4). `ci/unit/kpi-golden.test.cjs` fails when a suite is still `skip`, a file or runner is missing, or a units / aggregation case differs from its hand figure.
- Workflow (`ci/workflow/workflow.test.cjs`, figures in `scenario.cjs` `KPI`): K0 (emission reports before), K1–K8 as the spec, plus D17 (topic owners, the "moved" note, My KPIs and the write rule) and D18 (the Superadmin's KPI work with `company_id`), K9 (the probes, zero findings) and K10 (the emissions golden with KPI tracking on). K4 and K8 compare the emission reports and every emission row's stored total byte for byte with K0.
- `audit/harness/kpi-probes.cjs` (in this repo; run by K9 in `<DB_NAME>_kpiprobes`): KPI-P01 switch off, P02 tenant isolation (every gated route with company 2's people naming company 1, and company 1's ids), P03 role matrix (a table of every route's roles; P07 fails when a route has no row), P04 Superadmin parity, P05 library Superadmin only, P06 every `migrate:kpi-*` twice with the same row counts. 141 pass / 0 fail on wave D. The probes found that period lock/unlock and dashboard remind validated the body before the role (a User got 400, not 403): fixed, the role is checked first.
- `ci/golden/run.cjs` `GOLDEN_KPI_TRACKING=1`: the KPI tables migrated and seeded, every fixture client switched on and set up with every library KPI, auto refresh 100 ms after each approval; the run fails unless auto KPI values were written, and must match `snapshot.json` byte for byte (it does: 23 entries, 4 reports, 23 auto values).
