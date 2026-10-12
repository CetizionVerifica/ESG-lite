// IM1 parity: a row gives the same total whether it is typed (POST
// /user/emissions) or planned and inserted through the emission write
// service (planRows / insertRows), for single-value, converted-unit and
// fallback-year factors. Also: scope, duplicates against typed rows, and the
// pending rows + audit text an import writes.
//
// Runs on company 2 / site 3 (the fixture's isolated client) and removes
// everything it created, so the counts other tests rely on do not move.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");

const { AppDataSource } = require(path.resolve("dist/config/data-source.js"));
const { planRows, insertRows } = require(path.resolve("dist/services/emissionWrite/index.js"));

const SITE = 3; // company 2, category 1 only
const CTX = { user_id: 4, role: "User", company_id: 2, allowed_site_ids: [SITE], allowed_category_ids_by_site: {} };
const OTHER_COMPANY_CTX = { user_id: 1, role: "User", company_id: 1, allowed_site_ids: [1, SITE], allowed_category_ids_by_site: {} };

const TYPED = [
  { name: "diesel litres", body: { site_id: SITE, category_id: 1, date_of_reporting: "2025-01-15", activity_data_unit: "litre", activity_data: { emission_category: "Diesel", activity_value: "1000" } } },
  { name: "diesel gallons → litres", body: { site_id: SITE, category_id: 1, date_of_reporting: "2025-02-15", activity_data_unit: "gallon", activity_data: { emission_category: "Diesel", quantity: "500" } } },
  { name: "gas MWh → kWh", body: { site_id: SITE, category_id: 1, date_of_reporting: "2025-03-15", activity_data_unit: "mwh", activity_data: { emission_category: "Natural Gas", consumption: "12.5" } } },
  { name: "2026 falls back to the newest factor", body: { site_id: SITE, category_id: 1, date_of_reporting: "2026-01-31", activity_data_unit: "litre", activity_data: { emission_category: "diesel ", activity_value: "1.25" } } },
  { name: "yearly CY", body: { site_id: SITE, category_id: 1, date_of_reporting: "2023-12-31", reporting_period: "yearly", year_type: "CY", activity_data_unit: "kwh", activity_data: { emission_category: "Natural Gas", activity_value: "37.4" } } },
];
const ROWS = [
  { row_ref: "Fuel!B2", site_id: SITE, category_id: 1, period: { kind: "monthly", date: "2025-01-15" }, activity_name: "Diesel", activity_value: 1000, activity_unit: "litre" },
  { row_ref: "Fuel!B3", site_id: SITE, category_id: 1, period: { kind: "monthly", date: "2025-02-15" }, activity_name: "Diesel", activity_value: 500, activity_unit: "gallon" },
  { row_ref: "Fuel!B4", site_id: SITE, category_id: 1, period: { kind: "monthly", date: "2025-03-15" }, activity_name: "Natural Gas", activity_value: 12.5, activity_unit: "mwh" },
  { row_ref: "Fuel!B5", site_id: SITE, category_id: 1, period: { kind: "monthly", date: "2026-01-31" }, activity_name: "diesel ", activity_value: 1.25, activity_unit: "litre" },
  { row_ref: "Fuel!B6", site_id: SITE, category_id: 1, period: { kind: "yearly", year_type: "CY", year: 2023 }, activity_name: "Natural Gas", activity_value: 37.4, activity_unit: "kwh" },
];

const created = [];

test.before(async () => {
  await withDb((db) =>
    db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
      (901, ${SITE}, 1, 2024, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel'),
      (902, ${SITE}, 1, 2023, 2650.0000, 'litre', 'CI', 'Diesel', 'Diesel'),
      (903, ${SITE}, 1, 2024, 183.0000, 'kwh', 'CI', 'Natural Gas', 'Natural Gas')`),
  );
  await AppDataSource.initialize();
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id IN (SELECT pk_id FROM emission WHERE site_id = ${SITE} AND pk_id <> 8)`);
    await db.query(`DELETE FROM emission WHERE site_id = ${SITE} AND pk_id <> 8`);
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id IN (901, 902, 903)`);
  });
  await AppDataSource.destroy();
});

test("typed entries and planned rows give the same totals and factors", async () => {
  const typed = [];
  for (const entry of TYPED) {
    const res = await call("POST", "/user/emissions", "otherUser", entry.body);
    assert.equal(res.status, 201, `${entry.name}: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.fera_emission, null);
    typed.push(res.json.emission);
    created.push(res.json.emission.pk_id);
  }
  // Plan the same rows against a different month so the typed rows don't read as duplicates.
  const shifted = ROWS.map((r) => (r.period.kind === "monthly" ? { ...r, period: { kind: "monthly", date: r.period.date.replace(/-(\d\d)-/, (m, mm) => `-${String(Number(mm) + 6).padStart(2, "0")}-`) } } : r));
  const planned = await planRows(CTX, shifted, { planMatches: [] });
  planned.forEach((p, i) => {
    assert.equal(p.state, "ready", `${p.row_ref}: ${JSON.stringify(p.issues)}`);
    assert.equal(p.result.total_tco2e, Number(typed[i].total_emission), `${TYPED[i].name}: total`);
    assert.equal(p.result.factor.emission_factor_id, typed[i].emission_factor_snapshot.emission_factor_id, `${TYPED[i].name}: factor`);
    assert.equal(p.result.activity_value, Number(typed[i].activity_data.activity_value ?? typed[i].activity_data.quantity ?? typed[i].activity_data.consumption));
  });
  assert.equal(planned[0].result.conversion, undefined);
  assert.equal(planned[1].result.conversion, 3.78541);
  assert.deepEqual(planned[3].issues.map((i) => i.code), ["FACTOR_FALLBACK_YEAR"]);
  assert.equal(planned[3].result.factor.fallback_year, true);
  assert.deepEqual([planned[4].result.reporting_period, planned[4].result.year_type, planned[4].result.reporting_date], ["yearly", "CY", "2023-12-31"]);
});

test("rows that duplicate typed entries, unknown activities, bad units and other clients' sites are issues", async () => {
  const planned = await planRows(
    CTX,
    [
      ROWS[0],
      { ...ROWS[0], row_ref: "Fuel!B9", activity_name: "Petrol", period: { kind: "monthly", date: "2025-09-15" } },
      { ...ROWS[0], row_ref: "Fuel!B10", activity_unit: "kg", period: { kind: "monthly", date: "2025-08-15" } },
      { ...ROWS[0], row_ref: "Fuel!B11", category_id: 2 },
      { ...ROWS[0], row_ref: "Fuel!B12", site_id: 1 },
      { ...ROWS[0], row_ref: "Fuel!B13", period: { kind: "monthly", date: "2025-09-15" }, total_emission: 5 },
      { ...ROWS[0], row_ref: "Fuel!B14", period: { kind: "monthly", date: "2025-09-15" } },
    ],
    { planMatches: [], stripped: [{ row_ref: "Fuel!B13", keys: ["total_emission"] }] },
  );
  const codes = Object.fromEntries(planned.map((p) => [p.row_ref, p.issues.map((i) => i.code)]));
  assert.deepEqual(codes["Fuel!B2"], ["DUPLICATE_EXISTING"]);
  assert.deepEqual(codes["Fuel!B9"], ["UNKNOWN_ACTIVITY"]);
  assert.match(planned[1].issues[0].message, /Did you mean: Diesel; Natural Gas/);
  assert.deepEqual(codes["Fuel!B10"], ["UNIT_NOT_CONVERTIBLE"]);
  assert.deepEqual(codes["Fuel!B11"], ["CATEGORY_NOT_ASSIGNED"]);
  assert.deepEqual(codes["Fuel!B12"], ["SITE_NOT_ALLOWED"]);
  assert.deepEqual(codes["Fuel!B13"], ["CLIENT_TOTAL_IGNORED"]);
  assert.equal(planned[5].state, "ready");
  assert.deepEqual(codes["Fuel!B14"], ["DUPLICATE_IN_PLAN"]);
  assert.equal(planned[6].state, "ready");

  // Company 1's context may not plan on company 2's site, whatever its allowed list says.
  const other = await planRows(OTHER_COMPANY_CTX, [ROWS[0]], { planMatches: [] });
  assert.deepEqual(other[0].issues.map((i) => i.code), ["SITE_NOT_ALLOWED"]);
});

test("insertRows writes pending rows under the batch, with the import audit text, in one transaction", async () => {
  const rows = [
    { ...ROWS[0], row_ref: "Imp!B2", period: { kind: "monthly", date: "2025-10-15" }, notes: "October delivery" },
    { ...ROWS[2], row_ref: "Imp!B3", period: { kind: "monthly", date: "2025-10-15" } },
  ];
  const planned = await planRows(CTX, rows, { planMatches: [] });
  assert.deepEqual(planned.map((p) => p.state), ["ready", "ready"]);
  const batch = { upload_batch_id: "im1-parity-batch", channel: "mcp", source_name: "October.xlsx" };
  const result = await AppDataSource.transaction((tx) => insertRows(tx, CTX, planned, batch));
  assert.deepEqual({ inserted: result.inserted, fera_inserted: result.fera_inserted, ids: result.ids.length }, { inserted: 2, fera_inserted: 0, ids: 2 });
  created.push(...result.ids);

  const stored = await withDb((db) => db.query(`SELECT pk_id, status::text AS status, total_emission::text AS total, upload_batch_id, created_by, extra_data, activity_data_unit FROM emission WHERE upload_batch_id = 'im1-parity-batch' ORDER BY pk_id`));
  assert.equal(stored.rowCount, 2);
  assert.deepEqual(stored.rows.map((r) => [r.status, r.total, r.created_by]), [["pending", planned[0].result.total_tco2e.toString(), 4], ["pending", planned[1].result.total_tco2e.toString(), 4]]);
  assert.deepEqual(stored.rows[0].extra_data, { notes: "October delivery", import: { channel: "mcp", row_ref: "Imp!B2" } });
  const audit = await withDb((db) => db.query(`SELECT reason, changed_by, changed_fields FROM audit_log WHERE entity_id = $1 AND entity_type = 'emission'`, [stored.rows[0].pk_id]));
  assert.equal(audit.rowCount, 1);
  assert.match(audit.rows[0].reason, /^Imported via Claude by CI Other User \(batch im1-parity-batch, October.xlsx\)$/);
  assert.equal(audit.rows[0].changed_by, 4);
  assert.equal(audit.rows[0].changed_fields.upload_batch_id.new, "im1-parity-batch");

  // The same rows again now duplicate what was just imported.
  const again = await planRows(CTX, rows, { planMatches: [] });
  assert.deepEqual(again.map((p) => p.issues.map((i) => i.code)), [["DUPLICATE_EXISTING"], ["DUPLICATE_EXISTING"]]);

  // A failure mid-batch leaves nothing behind.
  const broken = [planned[0], { ...planned[1], input: { ...planned[1].input, row_ref: "Imp!B4", activity_unit: "kg" }, result: planned[1].result }];
  await assert.rejects(
    AppDataSource.transaction((tx) => insertRows(tx, CTX, broken.map((p) => ({ ...p, input: { ...p.input, period: { kind: "monthly", date: "2025-11-15" } } })), { ...batch, upload_batch_id: "im1-parity-broken" })),
    (err) => err.code === "IMPORT_PLAN_HAS_ISSUES" && err.details.row_refs[0] === "Imp!B4",
  );
  const none = await withDb((db) => db.query(`SELECT count(*)::int AS n FROM emission WHERE upload_batch_id = 'im1-parity-broken'`));
  assert.equal(none.rows[0].n, 0);
});
