// DS-2 data sources: POST /studio/resolve, GET/PATCH /studio/docs/:id/inputs,
// GET /studio/inputs/prefill, GET /studio/data, GET/PUT /studio/materiality.
//
//   - switch off (DS_STUDIO_OFF), Users (DS_ROLE), kind off (DS_KIND_OFF);
//   - tenant isolation: another company's sites and docs answer 404, as does a site
//     the caller can't read; 'all' needs every site (DS_SITES_SCOPE);
//   - parity: Scope 1, 2, 3 and total equal POST /user/ghg/tables for CY and FY, and
//     the site, month, quarter, scope and source-category splits add back to them;
//   - scope2_market → unavailable NOT_RECORDED; a bad breakdown → DS_BINDING_INVALID;
//   - report inputs: prefill, PATCH per-key validation, rev conflict, an input
//     binding, "Excluded: <reason>", intensity per revenue from an input;
//   - KPI bindings: approved values only, a headline sum, not-selected → DS_BINDING_INVALID;
//   - the resolve cache sees a new approval at once;
//   - migrate:ds-2-materiality-scores twice, and the scores round trip.
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2 on both sites, admin 3, multi user 7),
// company 2 (site 3; other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript } = require("./ds-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const ghg = (metric, extra = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra });
const body = (bindings, extra = {}) => ({ kind: "ghg", year: 2025, yearType: "CY", sites: "all", bindings, tokens: [], ...extra });
const resolve = (who, b) => call("POST", "/studio/resolve", who, b);
const ok = async (who, b) => {
  const r = await resolve(who, b);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const sum = (pts) => pts.reduce((a, p) => a + (p.value ?? 0), 0);

// report_doc ships with DS-5; until then the test makes the table the 01-contracts §3 way.
const ensureDocTable = () =>
  q(`CREATE TABLE IF NOT EXISTS report_doc (
       id serial PRIMARY KEY, company_id integer NOT NULL, year integer, year_type varchar(2), title text, status varchar(20) NOT NULL DEFAULT 'draft',
       draft jsonb, rev integer NOT NULL DEFAULT 1, kind varchar(20), purpose varchar(20), format varchar(20), inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
       source_doc_id integer, created_by integer, updated_by integer, deleted_at timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`);
const newDoc = async (companyId, kind = "ghg", year = 2025, yearType = "CY", sites = "all") =>
  (
    await q(
      `INSERT INTO report_doc (company_id, year, year_type, title, draft, rev, kind, purpose, format, inputs, created_by)
       VALUES ($1, $2, $3, 'DS-2 test', $4, 1, $5, 'report', 'a4', '{}'::jsonb, 2) RETURNING id`,
      [companyId, year, yearType, JSON.stringify({ schemaVersion: 2, kind, meta: { year, yearType, sites } }), kind],
    )
  )[0].id;

const EXTRA = [9821, 9822];
const reset = async () => {
  for (const id of [1, 2]) {
    await setStudio(id, false);
    await setKpi(id, false);
  }
  await q(`DELETE FROM emission WHERE pk_id = ANY($1::bigint[])`, [EXTRA]);
  await q(`DELETE FROM report_doc WHERE title = 'DS-2 test'`).catch(() => {});
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`).catch(() => {});
  for (const t of ["company_kpi", "company_material_topic", "company_framework", "company_kpi_settings"]) await q(`DELETE FROM ${t} WHERE company_id IN (1, 2)`).catch(() => {});
};

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTargets"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await ensureDocTable();
  await reset();
});
test.after(reset);

test("switch off: every DS-2 route answers DS_STUDIO_OFF; Users get DS_ROLE once it's on", async () => {
  const doc = await newDoc(1);
  const routes = [
    ["POST", "/studio/resolve", body([ghg("total")])],
    ["GET", `/studio/docs/${doc}/inputs`],
    ["PATCH", `/studio/docs/${doc}/inputs`, { rev: 1, inputs: {} }],
    ["GET", "/studio/inputs/prefill?kind=ghg&year=2025"],
    ["GET", "/studio/data?kind=ghg&year=2025"],
    ["GET", "/studio/materiality"],
    ["PUT", "/studio/materiality", { scores: [] }],
  ];
  for (const [m, p, b] of routes) {
    const r = await call(m, p, "manager", b);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.code, "DS_STUDIO_OFF", `${m} ${p}`);
  }
  await setStudio(1, true);
  for (const [m, p, b] of routes) {
    const r = await call(m, p, "user", b);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.code, "DS_ROLE", `${m} ${p}`);
  }
  assert.equal((await call("POST", "/studio/resolve", undefined, body([]))).status, 401);
});

test("tenant isolation: another company's sites and docs are not found; 'all' needs every site", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const doc = await newDoc(1);
  for (const [who, sites] of [["manager", [3]], ["admin", [1, 3]], ["otherManager", [1]]]) {
    const r = await resolve(who, body([ghg("total")], { sites }));
    assert.equal(r.status, 404, `${who} ${sites}`);
    assert.equal(r.json.code, "DS_DOC_NOT_FOUND");
  }
  // A binding's own sites are checked too.
  const viaBinding = await resolve("manager", body([ghg("total", { sites: [3] })]));
  assert.equal(viaBinding.status, 404);
  for (const [m, p, b] of [["GET", `/studio/docs/${doc}/inputs`], ["PATCH", `/studio/docs/${doc}/inputs`, { rev: 1, inputs: {} }], ["GET", "/studio/docs/abc/inputs"]]) {
    const r = await call(m, p, "otherManager", b);
    assert.equal(r.status, 404, `${m} ${p}`);
    assert.equal(r.json.code, "DS_DOC_NOT_FOUND");
  }
  // A Superadmin names the company; another company's site is still not found.
  assert.equal((await resolve("superadmin", body([ghg("total")], { company_id: 1 }))).status, 200);
  assert.equal((await resolve("superadmin", body([ghg("total")], { company_id: 1, sites: [3] }))).status, 404);
  assert.equal((await call("GET", `/studio/docs/${doc}/inputs?company_id=2`, "superadmin")).status, 404);
  // Company 2's own data stays its own: 999 t on site 3 never shows for company 1.
  const own = await ok("otherManager", body([ghg("scope1")]));
  close(own.values[0].value, 999, "company 2 Scope 1 (site 3)");
  const one = await ok("manager", body([ghg("scope1")]));
  assert.ok(one.values[0].value < 999);
  // A User of company 1 with sites 1 and 2 is still a User.
  assert.equal((await resolve("multiSiteUser", body([ghg("total")]))).json.code, "DS_ROLE");
});

test("parity: Scope 1, 2, 3 and total equal POST /user/ghg/tables for CY and FY, and every split adds back", async () => {
  await setStudio(1, true);
  for (const [yearType, year] of [["CY", 2025], ["CY", 2024], ["FY", 2026], ["FY", 2025]]) {
    const tables = await call("POST", "/user/ghg/tables", "manager", { siteIds: [1, 2], yearType, year });
    assert.equal(tables.status, 200);
    const t = tables.json.totals[String(year)];
    const metrics = ["total", "scope1", "scope2_location", "scope3"];
    const splits = ["site", "month", "quarter", "source_category"];
    const bindings = [
      ...metrics.map((m) => ghg(m)),
      ghg("total", { breakdown: "scope" }),
      ...metrics.flatMap((m) => splits.map((s) => ghg(m, { breakdown: s }))),
    ];
    const r = await ok("manager", body(bindings, { year, yearType, sites: [1, 2] }));
    const [total, s1, s2, s3, byScope] = r.values;
    close(total.value, t.total, `${yearType} ${year} total`);
    close(s1.value, t.scope1, `${yearType} ${year} scope1`);
    close(s2.value, t.scope2, `${yearType} ${year} scope2`);
    close(s3.value, t.scope3, `${yearType} ${year} scope3`);
    for (const v of [total, s1, s2, s3]) {
      assert.equal(v.unit, "tCO₂e");
      assert.equal(v.source, "ghg");
    }
    assert.deepEqual(byScope.series[0].values.map((p) => p.key), ["Scope 1", "Scope 2", "Scope 3"]);
    close(sum(byScope.series[0].values), t.total, "scope split");
    let i = 5;
    for (const m of metrics) {
      const want = { total: t.total, scope1: t.scope1, scope2_location: t.scope2, scope3: t.scope3 }[m];
      for (const s of splits) {
        const v = r.values[i++];
        assert.equal(v.series.length, 1, `${m} by ${s}`);
        close(sum(v.series[0].values), want, `${yearType} ${year} ${m} by ${s}`);
        if (s === "month") assert.equal(v.series[0].values.length, 12);
        if (s === "quarter") assert.deepEqual(v.series[0].values.map((p) => p.key), ["Q1", "Q2", "Q3", "Q4"]);
      }
    }
    // A data mark's date: the newest approval behind the figures.
    if (t.total > 0) assert.match(total.approvedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  }
  // Months in reporting order (FY: April first) and in the right calendar year.
  const fy = await ok("manager", body([ghg("total", { breakdown: "month" })], { year: 2026, yearType: "FY", sites: [1, 2] }));
  assert.equal(fy.values[0].series[0].values[0].key, "2025-04");
  assert.equal(fy.values[0].series[0].values[11].key, "2026-03");
  close(fy.values[0].series[0].values[11].value, 120, "the FY row dated 2026-03-31");
});

test("years, compare and top: a series per year, change vs prior, the rest folded into Other", async () => {
  await setStudio(1, true);
  const tables24 = (await call("POST", "/user/ghg/tables", "manager", { siteIds: [1, 2], yearType: "CY", year: 2025 })).json.totals;
  const r = await ok(
    "manager",
    body([ghg("total", { years: { last: 2 }, compare: "prior" }), ghg("total", { years: [2024, 2025], breakdown: "source_category", top: 1 })], { sites: [1, 2] }),
  );
  const [trend, top] = r.values;
  assert.deepEqual(trend.series[0].values.map((p) => p.key), ["2024", "2025"]);
  close(trend.series[0].values[0].value, tables24["2024"].total, "2024 in the series");
  assert.equal(trend.compare.against, "prior");
  assert.equal(trend.compare.year, 2024);
  close(trend.compare.change_abs, tables24["2025"].total - tables24["2024"].total, "change_abs");
  assert.deepEqual(top.series.map((s) => s.label), ["2024", "2025"]);
  assert.equal(top.series[1].values.length, 2);
  assert.equal(top.series[1].values[1].key, "Other");
  close(sum(top.series[1].values), tables24["2025"].total, "top + Other = total");
  // A token measures the same binding.
  const tok = await ok("manager", { ...body([], { sites: [1, 2] }), tokens: [{ type: "data", attrs: { binding: ghg("total"), measure: "change_pct", format: "pct1" } }] });
  assert.equal(tok.tokens.length, 1);
  assert.match(tok.tokens[0].display, /^[+−]?\d+(\.\d)?%$|^—$/);
});

test("scope2_market resolves unavailable (D7); gases not tracked; a bad breakdown is DS_BINDING_INVALID", async () => {
  await setStudio(1, true);
  const r = await ok("manager", body([ghg("scope2_market"), ghg("gas_ch4"), ghg("gas_other"), ghg("biogenic_co2"), ghg("total")]));
  assert.deepEqual(r.values[0].unavailable, { reason: "NOT_RECORDED", detail: "Market-based Scope 2 isn't recorded (D7)." });
  assert.equal(r.values[0].display, "Not reported");
  assert.equal(r.values[0].value, null);
  assert.equal(r.values[1].unavailable.reason, "NOT_TRACKED", "fixture rows carry no gas_kg");
  assert.equal(r.values[2].unavailable.reason, "NOT_RECORDED");
  assert.equal(r.values[3].unavailable.reason, "NOT_TRACKED");
  assert.equal(r.values[4].unavailable, undefined);
  assert.deepEqual(r.unavailable.map((u) => [u.bindingIdx, u.reason]), [[0, "NOT_RECORDED"], [1, "NOT_TRACKED"], [2, "NOT_RECORDED"], [3, "NOT_TRACKED"]]);
  assert.match(r.dataHash, /^sha256:[0-9a-f]{64}$/);
  const bad = await resolve("manager", body([ghg("total"), ghg("scope2_market", { breakdown: "site" })]));
  assert.equal(bad.status, 422);
  assert.equal(bad.json.code, "DS_BINDING_INVALID");
  assert.equal(bad.json.details.bindingIdx, 1);
  assert.equal(bad.json.details.reason, "BREAKDOWN_UNSUPPORTED");
  const invalid = await resolve("manager", body([{ source: "ghg", metric: "nonsense", years: { last: 1 }, sites: "all" }]));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.code, "DS_VALIDATION");
  // Coverage figures read like the page shows them.
  const cov = await ok("manager", body([ghg("sites_covered"), ghg("months_covered")], { sites: [1, 2] }));
  assert.match(cov.values[0].display, /^\d of 2$/);
  assert.match(cov.values[1].display, /^\d+ of 12$/);
});

test("the sustainability kind needs KPI tracking (DS_KIND_OFF); KPI bindings read approved values only", async () => {
  await setStudio(1, true);
  const kb = (kpis, extra = {}) => ({ source: "kpi", kpis, years: { last: 2 }, sites: "all", ...extra });
  const off = await resolve("manager", { ...body([kb(["WATER_WITHDRAWAL"])]), kind: "sustainability" });
  assert.equal(off.status, 403);
  assert.equal(off.json.code, "DS_KIND_OFF");
  // A KPI binding on a GHG doc while KPI tracking is off: unavailable, not an error.
  const offGhg = await ok("manager", body([kb(["WATER_WITHDRAWAL"])]));
  assert.equal(offGhg.values[0].unavailable.reason, "KPI_TRACKING_OFF");

  await setKpi(1, true);
  await q(`INSERT INTO company_kpi_settings (company_id, year_type, first_year, due_day, setup_completed_at) VALUES (1, 'CY', 2024, 15, now()) ON CONFLICT (company_id) DO NOTHING`);
  await q(
    `INSERT INTO company_kpi (company_id, kpi_definition_id, selected) SELECT 1, id, true FROM kpi_definition WHERE company_id IS NULL AND code = ANY($1::text[])
     ON CONFLICT (company_id, kpi_definition_id) DO UPDATE SET selected = true`,
    [["WATER_WITHDRAWAL", "GHG_SCOPE1", "GHG_SCOPE2_LB", "REVENUE"]],
  );
  await q(`UPDATE company_kpi SET frequency = 'annual' WHERE company_id = 1`);
  const id = async (code) => (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;
  const add = async (code, site, year, v, status = "approved") =>
    q(
      `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status, reviewed_at)
       VALUES (1, $1, $2, $3, $4, 'annual', 'CY', $5, NULL, $5, 'manual', $6::text, CASE WHEN $6::text = 'approved' THEN '2026-04-12'::timestamp END)`,
      [site, await id(code), `${year}-01-01`, `${year}-12-31`, v, status],
    );
  await add("WATER_WITHDRAWAL", 1, 2025, 1000);
  await add("WATER_WITHDRAWAL", 2, 2025, 500);
  await add("WATER_WITHDRAWAL", 1, 2024, 1200);
  await add("WATER_WITHDRAWAL", 2, 2024, 300, "pending");
  await add("GHG_SCOPE1", 1, 2025, 10);
  await add("GHG_SCOPE2_LB", 1, 2025, 5);
  await add("REVENUE", null, 2025, 250);

  const r = await ok("manager", { ...body([kb(["WATER_WITHDRAWAL"], { compare: "prior" }), kb(["GHG_SCOPE1_2"]), kb(["WATER_WITHDRAWAL"], { breakdown: "site", years: { last: 1 } })]), kind: "sustainability" });
  const [water, headline, bySite] = r.values;
  assert.equal(water.source, "kpi");
  assert.equal(water.value, 1500, "both sites, approved");
  assert.equal(water.complete, true);
  assert.equal(water.approvedAt, "2026-04-12T00:00:00.000Z");
  assert.deepEqual(water.series[0].values, [{ key: "2024", value: 1200 }, { key: "2025", value: 1500 }], "the pending 2024 value is left out");
  assert.equal(water.compare.change_abs, 300);
  assert.equal(water.compare.change_pct, 25);
  assert.equal(headline.value, 15, "Scope 1 + Scope 2 (location-based)");
  assert.deepEqual(bySite.series[0].values, [{ key: "1", value: 1000 }, { key: "2", value: 500 }]);

  const notSelected = await resolve("manager", { ...body([kb(["WATER_WITHDRAWAL"]), kb(["AIR_NOX"])]), kind: "sustainability" });
  assert.equal(notSelected.status, 422);
  assert.equal(notSelected.json.code, "DS_BINDING_INVALID");
  assert.deepEqual(notSelected.json.details, { bindingIdx: 1, reason: "KPI_NOT_SELECTED", kpi: "AIR_NOX" });
  const badUnit = await resolve("manager", { ...body([kb(["WATER_WITHDRAWAL"], { unit: "kWh" })]), kind: "sustainability" });
  assert.equal(badUnit.status, 422);
  assert.equal(badUnit.json.details.reason, "UNIT_INVALID");

  // REVENUE prefills the GHG inputs (source kpi), so intensity per revenue resolves.
  const pre = await call("GET", "/studio/inputs/prefill?kind=ghg&year=2025&yearType=CY&sites=1,2", "manager");
  assert.equal(pre.status, 200);
  assert.deepEqual(pre.json.prefill.revenue, { value: 250, source: "kpi", note: "INR crore" });
  const tables = (await call("POST", "/user/ghg/tables", "manager", { siteIds: [1, 2], yearType: "CY", year: 2025 })).json.totals["2025"];
  const inten = await ok("manager", body([ghg("intensity_revenue")], { sites: [1, 2] }));
  close(inten.values[0].value, tables.total / 250, "total / revenue");

  // The Data drawer lists the company's selected KPIs with values.
  const data = await call("GET", "/studio/data?kind=sustainability&year=2025&q=water", "manager");
  assert.equal(data.status, 200, JSON.stringify(data.json));
  const items = data.json.groups.flatMap((g) => g.items);
  assert.deepEqual(items.map((i) => i.id), ["WATER_WITHDRAWAL"]);
  assert.equal(items[0].resolved.value, 1500);
  assert.equal(items[0].resolved.approvedAt, "2026-04-12T00:00:00.000Z");
  await setKpi(1, false);
});

test("report inputs: prefill, per-key validation, rev conflict, input bindings and exclusions", async () => {
  await setStudio(1, true);
  await setKpi(1, false);
  await q(`UPDATE company SET consolidation_approach = 'financial_control' WHERE company_id = 1`);
  const doc = await newDoc(1);
  const get = await call("GET", `/studio/docs/${doc}/inputs`, "admin");
  assert.equal(get.status, 200, JSON.stringify(get.json));
  assert.equal(get.json.rev, 1);
  assert.deepEqual(get.json.inputs, {});
  assert.deepEqual(get.json.prefill.consolidation_approach, { value: "Financial control", source: "company" });
  assert.deepEqual(get.json.prefill.reporting_period, { value: "Calendar year 2025 (1 January 2025 – 31 December 2025)", source: "company" });
  assert.deepEqual(get.json.prefill.conformance, { value: ["GHGP"], source: "company" });
  assert.equal(get.json.prefill.revenue, undefined, "KPI tracking is off");

  const invalid = await call("PATCH", `/studio/docs/${doc}/inputs`, "manager", { rev: 1, inputs: { revenue: { value: -5 }, leadership_message: { value: "x" } } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.code, "DS_VALIDATION");
  assert.deepEqual(invalid.json.details.issues.map((i) => i.path).sort(), ["inputs.leadership_message", "inputs.revenue"]);
  const stale = await call("PATCH", `/studio/docs/${doc}/inputs`, "manager", { rev: 7, inputs: {} });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "DS_VERSION_CONFLICT");
  assert.equal(stale.json.details.rev, 1);

  const patched = await call("PATCH", `/studio/docs/${doc}/inputs`, "admin", {
    rev: 1,
    inputs: {
      responsible_person: { value: "A. Shah, Head of Sustainability" },
      revenue: { value: 400 },
      exclusions: { value: [{ what: "Category 8 · Upstream leased assets", reason: "The company leases no assets." }] },
      verification: { value: { status: "limited", provider: "CI Assurance" } },
    },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.rev, 2);
  assert.equal(patched.json.inputs.responsible_person.source, "typed");
  assert.equal(patched.json.inputs.responsible_person.updatedBy, 3);
  const stored = (await q(`SELECT rev, inputs FROM report_doc WHERE id = $1`, [doc]))[0];
  assert.equal(stored.rev, 2);
  assert.equal(stored.inputs.revenue.value, 400);

  const r = await ok("manager", body(
    [
      { source: "input", key: "responsible_person" },
      { source: "input", key: "verification" },
      { source: "input", key: "consolidation_approach" },
      { source: "input", key: "uncertainty_statement" },
      ghg("scope3_category", { scope3Category: 8 }),
      ghg("intensity_revenue"),
      { source: "custom", columns: ["A"], rows: [["x"]] },
    ],
    { docId: doc, sites: [1, 2] },
  ));
  assert.equal(r.values[0].display, "A. Shah, Head of Sustainability");
  assert.equal(r.values[1].display, "Limited assurance by CI Assurance");
  assert.equal(r.values[2].display, "Financial control", "prefill when nothing is stored");
  assert.deepEqual(r.values[3].unavailable, { reason: "NO_INPUT" });
  assert.equal(r.values[4].display, "Excluded: The company leases no assets.");
  assert.equal(r.values[4].unavailable.reason, "EXCLUDED");
  const t = (await call("POST", "/user/ghg/tables", "manager", { siteIds: [1, 2], yearType: "CY", year: 2025 })).json.totals["2025"];
  close(r.values[5].value, t.total / 400, "intensity uses the stored revenue");
  assert.equal(r.values[6].display, "Unlinked data");
  // Unsaved inputs (the new-design flow) win over stored ones.
  const unsaved = await ok("manager", body([{ source: "input", key: "responsible_person" }], { docId: doc, inputs: { responsible_person: { value: "B. Rao", source: "typed", updatedBy: 2, updatedAt: "now" } } }));
  assert.equal(unsaved.values[0].display, "B. Rao");

  // Removing a key with null; another company's doc id stays hidden from resolve too.
  const cleared = await call("PATCH", `/studio/docs/${doc}/inputs`, "manager", { rev: 2, inputs: { revenue: null } });
  assert.equal(cleared.json.rev, 3);
  assert.equal(cleared.json.inputs.revenue, undefined);
  await setStudio(2, true);
  const foreign = await resolve("otherManager", body([], { docId: doc }));
  assert.equal(foreign.status, 404);

  // A sustainability doc while KPI tracking is off: DS_KIND_OFF even by id.
  const sdoc = await newDoc(1, "sustainability");
  const kindOff = await call("GET", `/studio/docs/${sdoc}/inputs`, "manager");
  assert.equal(kindOff.status, 403);
  assert.equal(kindOff.json.code, "DS_KIND_OFF");
});

test("the resolve cache shows a new approval at once and a changed hash", async () => {
  await setStudio(1, true);
  const b = body([ghg("scope1")], { sites: [1, 2] });
  const before = await ok("manager", b);
  const again = await ok("manager", b);
  assert.deepEqual(again, before, "same data, same answer");
  await q(
    `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, reviewed_at)
     VALUES ($1, '{"activity_value": 1}', 7.5, 'tCO2e', '2025-06-30', 'approved', 1, 1, 1, 'monthly', now())`,
    [EXTRA[0]],
  );
  const after = await ok("manager", b);
  close(after.values[0].value, before.values[0].value + 7.5, "the new approved row");
  assert.notEqual(after.dataHash, before.dataHash);
  // A pending row changes nothing.
  await q(
    `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
     VALUES ($1, '{"activity_value": 1}', 100, 'tCO2e', '2025-06-30', 'pending', 1, 1, 1, 'monthly')`,
    [EXTRA[1]],
  );
  const pending = await ok("manager", b);
  close(pending.values[0].value, after.values[0].value, "pending excluded");
  assert.equal(pending.dataHash, after.dataHash);
});

test("the Data drawer lists GHG items with values and the binding to insert", async () => {
  await setStudio(1, true);
  const r = await call("GET", "/studio/data?kind=ghg&year=2025&yearType=CY&sites=1,2", "manager");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.groups.map((g) => g.id), ["scopes", "scope3_categories", "breakdowns", "gases", "intensity", "base_year"]);
  const scopes = r.json.groups[0].items;
  assert.deepEqual(scopes.map((i) => i.id), ["total", "scope1", "scope2_location", "scope2_market", "scope3"]);
  assert.equal(scopes[3].resolved.unavailable.reason, "NOT_RECORDED");
  assert.deepEqual(scopes[1].binding, { source: "ghg", metric: "scope1", years: { last: 1 }, sites: "all" });
  assert.equal(r.json.groups[1].items.length, 15);
  const bad = await call("GET", "/studio/data?kind=ghg&year=20", "manager");
  assert.equal(bad.status, 400);
  const foreign = await call("GET", "/studio/data?kind=ghg&year=2025&sites=3", "manager");
  assert.equal(foreign.status, 404);
});

test("materiality scores: migrate twice, round trip, points only when every material topic is scored", async () => {
  for (let i = 0; i < 2; i++) {
    const m = runScript("migrateDs2MaterialityScores");
    assert.equal(m.status, 0, m.stderr + m.stdout);
  }
  const cols = await q(`SELECT column_name, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'company_material_topic' AND column_name IN ('impact_score', 'financial_score') ORDER BY column_name`);
  assert.deepEqual(cols.map((c) => [c.column_name, c.numeric_precision, c.numeric_scale]), [["financial_score", 3, 1], ["impact_score", 3, 1]]);
  await setStudio(1, true);
  await setKpi(1, false);
  const off = await call("GET", "/studio/materiality", "manager");
  assert.equal(off.json.code, "DS_KIND_OFF");
  await setKpi(1, true);
  await q(`INSERT INTO company_material_topic (company_id, esrs_topic, material, reason) VALUES (1, 'E1', true, NULL), (1, 'S1', true, NULL), (1, 'E3', false, 'No water stress') ON CONFLICT DO NOTHING`);
  const first = await call("GET", "/studio/materiality", "admin");
  assert.equal(first.status, 200);
  assert.equal(first.json.points, null);
  const half = await call("PUT", "/studio/materiality", "manager", { scores: [{ esrs_topic: "E1", impact_score: 8.5, financial_score: 7 }] });
  assert.equal(half.json.points, null, "S1 is material and unscored");
  const full = await call("PUT", "/studio/materiality", "manager", { scores: [{ esrs_topic: "S1", impact_score: 6, financial_score: 4.5 }] });
  assert.deepEqual(full.json.points, [
    { topic: "E1", label: "Climate change", impact: 8.5, financial: 7 },
    { topic: "S1", label: "Own workforce", impact: 6, financial: 4.5 },
  ]);
  const bad = await call("PUT", "/studio/materiality", "manager", { scores: [{ esrs_topic: "E1", impact_score: 11, financial_score: 1 }] });
  assert.equal(bad.status, 400);
  const missing = await call("PUT", "/studio/materiality", "manager", { scores: [{ esrs_topic: "G1", impact_score: 1, financial_score: 1 }] });
  assert.equal(missing.status, 404);
  await setStudio(2, true);
  await setKpi(2, true);
  const other = await call("GET", "/studio/materiality", "otherManager");
  assert.deepEqual(other.json.topics, [], "company 2 sees none of company 1's topics");
  await setKpi(2, false);
  await setKpi(1, false);
});

test("[DS review] report inputs follow the design's sites and freeze with a final", async () => {
  await setStudio(1, true);
  const wide = await newDoc(1);
  const own = await newDoc(1, "ghg", 2025, "CY", [1]);
  await q(`INSERT INTO user_sites (user_id, site_id) SELECT 2, s FROM unnest(ARRAY[1, 2]) s WHERE NOT EXISTS (SELECT 1 FROM user_sites WHERE user_id = 2 AND site_id = s)`);
  await q(`DELETE FROM user_sites WHERE user_id = 2 AND site_id = 2`);
  try {
    // A Manager on site 1 only: the company-wide design is not found (read, write, or as a resolve docId).
    for (const [m, p, b] of [["GET", `/studio/docs/${wide}/inputs`], ["PATCH", `/studio/docs/${wide}/inputs`, { rev: 1, inputs: {} }]]) {
      const r = await call(m, p, "manager", b);
      assert.equal(r.status, 404, `${m} ${p}`);
      assert.equal(r.json.code, "DS_DOC_NOT_FOUND");
    }
    const viaResolve = await resolve("manager", body([ghg("total")], { sites: [1], docId: wide }));
    assert.equal(viaResolve.status, 404);
    assert.equal((await call("GET", `/studio/docs/${own}/inputs`, "manager")).status, 200);
  } finally {
    await q(`INSERT INTO user_sites (user_id, site_id) SELECT 2, 2 WHERE NOT EXISTS (SELECT 1 FROM user_sites WHERE user_id = 2 AND site_id = 2)`);
  }
  // A final design's inputs can't change.
  await q(`UPDATE report_doc SET status = 'final' WHERE id = $1`, [own]);
  const frozen = await call("PATCH", `/studio/docs/${own}/inputs`, "manager", { rev: 1, inputs: {} });
  assert.equal(frozen.status, 409);
  assert.equal(frozen.json.code, "DS_FINAL_IMMUTABLE");
});
