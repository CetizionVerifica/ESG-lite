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
