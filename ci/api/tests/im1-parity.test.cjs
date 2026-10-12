// IM1 parity: a row gives the same total whether it is typed (POST
// /user/emissions) or planned and inserted through the emission write
// service (planRows / insertRows): single value, converted unit, fallback
// year, yearly CY and FY, per_method and per_unit calc specs, and the FERA
// twin. Also: scope, duplicates against typed rows, the pending rows + audit
// text an import writes, and the checks insertRows repeats inside its
// transaction.
//
// Runs on company 2 / site 3 (the fixture's isolated client) and removes
// everything it created, so the counts other tests rely on do not move.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");

const { AppDataSource } = require(path.resolve("dist/config/data-source.js"));
const { planRows, insertRows } = require(path.resolve("dist/services/emissionWrite/index.js"));

const SITE = 3; // company 2; category 1 in the fixture, 3 (per_method) and 4 (per_unit) added below
const SOLD = { "Calculation Method": "Direct energy", "Units Sold": "100", "Energy per use": "0.5", "Lifetime uses": "200" }; // 10,000 kWh
const HAUL = { Weight: "12", "Distance travelled": "350" }; // 4,200 tonne.km
const CTX = { user_id: 4, role: "User", company_id: 2, allowed_site_ids: [SITE], allowed_category_ids_by_site: {} };
const OTHER_COMPANY_CTX = { user_id: 1, role: "User", company_id: 1, allowed_site_ids: [1, SITE], allowed_category_ids_by_site: {} };

const TYPED = [
  { name: "diesel litres", body: { site_id: SITE, category_id: 1, date_of_reporting: "2025-01-15", activity_data_unit: "litre", activity_data: { emission_category: "Diesel", activity_value: "1000" } } },
  { name: "diesel gallons → litres", body: { site_id: SITE, category_id: 1, date_of_reporting: "2025-02-15", activity_data_unit: "gallon", activity_data: { emission_category: "Diesel", quantity: "500" } } },
  { name: "gas MWh → kWh", body: { site_id: SITE, category_id: 1, date_of_reporting: "2025-03-15", activity_data_unit: "mwh", activity_data: { emission_category: "Natural Gas", consumption: "12.5" } } },
  { name: "2026 falls back to the newest factor", body: { site_id: SITE, category_id: 1, date_of_reporting: "2026-01-31", activity_data_unit: "litre", activity_data: { emission_category: "diesel ", activity_value: "1.25" } } },
  { name: "yearly CY", body: { site_id: SITE, category_id: 1, date_of_reporting: "2023-12-31", reporting_period: "yearly", year_type: "CY", activity_data_unit: "kwh", activity_data: { emission_category: "Natural Gas", activity_value: "37.4" } } },
  { name: "yearly FY", body: { site_id: SITE, category_id: 1, date_of_reporting: "2021-03-31", reporting_period: "yearly", year_type: "FY", activity_data_unit: "litre", activity_data: { emission_category: "Diesel", activity_value: "820" } } },
  { name: "per_method spec", body: { site_id: SITE, category_id: 3, date_of_reporting: "2025-01-15", activity_data_unit: "kwh", activity_data: { emission_category: "India Grid", ...SOLD } } },
  { name: "per_unit spec", body: { site_id: SITE, category_id: 4, date_of_reporting: "2025-01-15", activity_data_unit: "Tonne KM", activity_data: { emission_category: "HGV Diesel [tonne.km]", ...HAUL } } },
];
const ROWS = [
  { row_ref: "Fuel!B2", site_id: SITE, category_id: 1, period: { kind: "monthly", date: "2025-01-15" }, activity_name: "Diesel", activity_value: 1000, activity_unit: "litre" },
  { row_ref: "Fuel!B3", site_id: SITE, category_id: 1, period: { kind: "monthly", date: "2025-02-15" }, activity_name: "Diesel", activity_value: 500, activity_unit: "gallon" },
  { row_ref: "Fuel!B4", site_id: SITE, category_id: 1, period: { kind: "monthly", date: "2025-03-15" }, activity_name: "Natural Gas", activity_value: 12.5, activity_unit: "mwh" },
  { row_ref: "Fuel!B5", site_id: SITE, category_id: 1, period: { kind: "monthly", date: "2026-01-31" }, activity_name: "diesel ", activity_value: 1.25, activity_unit: "litre" },
  { row_ref: "Fuel!B6", site_id: SITE, category_id: 1, period: { kind: "yearly", year_type: "CY", year: 2023 }, activity_name: "Natural Gas", activity_value: 37.4, activity_unit: "kwh" },
  { row_ref: "Fuel!B7", site_id: SITE, category_id: 1, period: { kind: "yearly", year_type: "FY", year: 2021 }, activity_name: "Diesel", activity_value: 820, activity_unit: "litre" },
  { row_ref: "Sold!B2", site_id: SITE, category_id: 3, period: { kind: "monthly", date: "2025-01-15" }, activity_name: "India Grid", activity_unit: "kwh", fields: SOLD },
  { row_ref: "Haul!B2", site_id: SITE, category_id: 4, period: { kind: "monthly", date: "2025-01-15" }, activity_name: "HGV Diesel [tonne.km]", activity_unit: "Tonne KM", fields: HAUL },
];

const created = [];

test.before(async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, 3), (${SITE}, 4)`);
    await db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
      (901, ${SITE}, 1, 2024, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel'),
      (902, ${SITE}, 1, 2023, 2650.0000, 'litre', 'CI', 'Diesel', 'Diesel'),
      (903, ${SITE}, 1, 2024, 183.0000, 'kwh', 'CI', 'Natural Gas', 'Natural Gas'),
      (905, ${SITE}, 3, 2024, 0.2330, 'kwh', 'CI', 'India Grid', 'India Grid'),
      (906, ${SITE}, 4, 2024, 105.4000, 'tonne.km', 'CI', 'HGV Diesel [tonne.km]', 'HGV Diesel [tonne.km]')`);
    // The golden fixture's two calc specs, on this client's site.
    await db.query(`INSERT INTO column_config (pk_id, config_name, site_id, category_id, calculation) VALUES
      (9910, 'IM1 sold products', ${SITE}, 3, '{"mode": "per_method", "method_column": "Calculation Method", "identity_columns": ["Product Name"],
        "methods": {"Direct energy": {"multiply": ["Units Sold", "Energy per use", "Lifetime uses"], "activity_unit": "kwh"}}}'::jsonb),
      (9911, 'IM1 transport', ${SITE}, 4, '{"mode": "per_unit", "identity_columns": ["Shipment Ref"], "legacy_field": "Distance travelled",
        "methods": {"tonne.km": {"multiply": ["Weight", "Distance travelled"]}, "km": {"multiply": ["Distance travelled"]}}}'::jsonb)`);
  });
  await AppDataSource.initialize();
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id IN (SELECT pk_id FROM emission WHERE site_id = ${SITE} AND pk_id <> 8)`);
    await db.query(`DELETE FROM emission WHERE site_id = ${SITE} AND pk_id <> 8`);
    await db.query(`DELETE FROM column_config WHERE pk_id IN (9910, 9911)`);
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id IN (901, 902, 903, 904, 905, 906)`);
    await db.query(`DELETE FROM site_categories WHERE site_id = ${SITE} AND category_id IN (3, 4, 5)`);
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
  assert.deepEqual([planned[5].result.reporting_period, planned[5].result.year_type, planned[5].result.reporting_date], ["yearly", "FY", "2021-03-31"]);
  // The specs multiply their fields: 100 × 0.5 × 200 kWh × 0.233 g → 2.33 t; 12 t × 350 km × 105.4 kg → 442.68 t.
  assert.deepEqual([planned[6].result.activity_value, planned[6].result.total_tco2e], [10000, 2.33]);
  assert.deepEqual([planned[7].result.activity_value, planned[7].result.activity_unit, planned[7].result.total_tco2e], [4200, "tonne.km", 442.68]);
  assert.equal(typed[7].activity_data_unit, "tonne.km");
});

test("the FERA twin is computed and written alike for typed entries and imports", async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, 5)`);
    await db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name)
      VALUES (904, ${SITE}, 5, 2024, 610.0000, 'litre', 'CI', 'Diesel', 'Diesel')`);
  });
  try {
    const typed = await call("POST", "/user/emissions", "otherUser", { site_id: SITE, category_id: 1, date_of_reporting: "2025-04-15", activity_data_unit: "gallon", activity_data: { emission_category: "Diesel", activity_value: "100" } });
    assert.equal(typed.status, 201, JSON.stringify(typed.json));
    created.push(typed.json.emission.pk_id, typed.json.fera_emission.pk_id);
    assert.equal(Number(typed.json.emission.total_emission), 1014.49); // 100 gallon → 378.541 litre × 2680 kg
    assert.equal(Number(typed.json.fera_emission.total_emission), 230.91); // × 610 kg
    assert.equal(typed.json.fera_emission.fera_linked_id, typed.json.emission.pk_id);
    assert.equal(typed.json.emission.fera_linked_id, typed.json.fera_emission.pk_id);

    const row = { ...ROWS[0], row_ref: "Fera!B2", period: { kind: "monthly", date: "2025-05-15" }, activity_value: 100, activity_unit: "gallon" };
    const planned = await planRows(CTX, [row], { planMatches: [] });
    assert.equal(planned[0].state, "ready", JSON.stringify(planned[0].issues));
    assert.deepEqual([planned[0].result.total_tco2e, planned[0].result.fera], [1014.49, { category_id: 5, total_tco2e: 230.91 }]);

    const batch = { upload_batch_id: "im1-parity-fera", channel: "bulk_upload", source_name: "May.xlsx" };
    const result = await AppDataSource.transaction((tx) => insertRows(tx, CTX, planned, batch));
    assert.deepEqual({ inserted: result.inserted, fera_inserted: result.fera_inserted, ids: result.ids.length }, { inserted: 1, fera_inserted: 1, ids: 2 });
    created.push(...result.ids);
    const stored = await withDb((db) => db.query(`SELECT pk_id, category_id, total_emission::text AS total, fera_linked_id, status::text AS status FROM emission WHERE upload_batch_id = 'im1-parity-fera' ORDER BY pk_id`));
    assert.deepEqual(stored.rows.map((r) => [r.category_id, r.total, r.status]), [[1, "1014.49", "pending"], [5, "230.91", "pending"]]);
    assert.equal(stored.rows[0].fera_linked_id, stored.rows[1].pk_id);
    assert.equal(stored.rows[1].fera_linked_id, stored.rows[0].pk_id);
    const audit = await withDb((db) => db.query(`SELECT reason FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1)`, [stored.rows.map((r) => r.pk_id)]));
    assert.equal(audit.rowCount, 2);
    assert.match(audit.rows[0].reason, /^Imported via Bulk upload by CI Other User/);
  } finally {
    await withDb(async (db) => {
      await db.query(`DELETE FROM emission_factors WHERE emission_factor_id = 904`);
      await db.query(`DELETE FROM site_categories WHERE site_id = ${SITE} AND category_id = 5`);
    });
  }
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

test("insertRows re-checks scope, duplicates and mode lock inside its transaction", async () => {
  const rows = [{ ...ROWS[0], row_ref: "Late!B2", period: { kind: "monthly", date: "2025-12-15" } }];
  const planned = await planRows(CTX, rows, { planMatches: [] });
  assert.equal(planned[0].state, "ready");
  const batch = { upload_batch_id: "im1-parity-late", channel: "mcp", source_name: "Late.xlsx" };

  // A ready plan handed to another company's context is refused, whatever its allowed sites say.
  await assert.rejects(
    AppDataSource.transaction((tx) => insertRows(tx, OTHER_COMPANY_CTX, planned, batch)),
    (err) => err.code === "IMPORT_FORBIDDEN" && err.details.row_refs[0] === "Late!B2",
  );
  // A User whose categories exclude the row's category is refused too.
  await assert.rejects(
    AppDataSource.transaction((tx) => insertRows(tx, { ...CTX, allowed_category_ids_by_site: { [SITE]: [2] } }, planned, batch)),
    (err) => err.code === "IMPORT_FORBIDDEN",
  );

  // The same entry typed between plan and commit makes the plan's row a duplicate at commit time.
  const typed = await call("POST", "/user/emissions", "otherUser", { site_id: SITE, category_id: 1, date_of_reporting: "2025-12-10", activity_data_unit: "litre", activity_data: { emission_category: "Diesel", activity_value: "5" } });
  assert.equal(typed.status, 201);
  created.push(typed.json.emission.pk_id);
  await assert.rejects(
    AppDataSource.transaction((tx) => insertRows(tx, CTX, planned, batch)),
    (err) => err.code === "IMPORT_PLAN_HAS_ISSUES" && err.details.row_refs[0] === "Late!B2",
  );
  // A yearly batch filed meanwhile locks the mode.
  const yearly = [{ ...ROWS[0], row_ref: "Late!B3", period: { kind: "monthly", date: "2024-06-15" } }];
  const plannedYear = await planRows(CTX, yearly, { planMatches: [] });
  assert.equal(plannedYear[0].state, "ready");
  const cy = await call("POST", "/user/emissions", "otherUser", { site_id: SITE, category_id: 1, date_of_reporting: "2024-12-31", reporting_period: "yearly", year_type: "CY", activity_data_unit: "kwh", activity_data: { emission_category: "Natural Gas", activity_value: "5" } });
  assert.equal(cy.status, 201, JSON.stringify(cy.json));
  created.push(cy.json.emission.pk_id);
  await assert.rejects(
    AppDataSource.transaction((tx) => insertRows(tx, CTX, plannedYear, batch)),
    (err) => err.code === "IMPORT_PLAN_HAS_ISSUES" && err.details.row_refs[0] === "Late!B3",
  );
  const none = await withDb((db) => db.query(`SELECT count(*)::int AS n FROM emission WHERE upload_batch_id = 'im1-parity-late'`));
  assert.equal(none.rows[0].n, 0);
});
