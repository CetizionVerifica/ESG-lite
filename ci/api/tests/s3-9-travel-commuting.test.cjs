// S3-9 business travel and employee commuting: the commuting survey endpoint
// (roles, tenant isolation, limits, plan → commit with extra_data.survey),
// migrate:scope3-travel run twice (customised forms left alone), `divide` by 0
// on a Category 6 plan row, and legacy Category 6 rows keeping their product.
//
// Fixture: company 1 (sites 1, 2), company 2 (site 3). This file adds
// category 931 "CI Commuting" (Scope 3, Category 7) on sites 1 and 3 and
// 932 "CI Business travel" (Category 6) on site 1, with rail and car factors
// (0.1 and 0.2 kgCO₂e per km, guidance Example 7.1), and removes all of it afterwards.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const CAT7 = 931;
const CAT6 = 932;
const RAIL = "Rail - National rail [passenger.km]";
const CAR = "Car - Average car - Unknown fuel [vehicle.km]";
const NAME_REF = "Priya Raman (priya.raman@example.invalid)";

const reset = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM emission WHERE category_id IN (${CAT7}, ${CAT6})`);
    await db.query(`DELETE FROM import_plan WHERE source_name LIKE 'Commuting survey%' OR source_name = 'CI S3-9 travel'`);
    await db.query(`DELETE FROM site_categories WHERE category_id IN (${CAT7}, ${CAT6})`);
    await db.query(`DELETE FROM emission_factors WHERE category_id IN (${CAT7}, ${CAT6})`);
    await db.query(`DELETE FROM unit WHERE category_id IN (${CAT7}, ${CAT6})`);
    await db.query(`DELETE FROM column_config WHERE category_id IN (${CAT7}, ${CAT6})`);
    await db.query(`DELETE FROM category WHERE category_id IN (${CAT7}, ${CAT6})`);
  });

test.before(async () => {
  await reset();
  await withDb(async (db) => {
    await db.query(`INSERT INTO category (category_id, category_name, scope, ghg_category) VALUES ($1, 'CI Commuting', 'Scope 3', 7), ($2, 'CI Business travel', 'Scope 3', 6)`, [CAT7, CAT6]);
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (1, $1), (3, $1), (1, $2)`, [CAT7, CAT6]);
    for (const cat of [CAT7, CAT6]) {
      await db.query(
        `INSERT INTO emission_factors (site_id, category_id, emission_category_name, global_category_name, factor_value, denominator_unit, year, source, factor_type)
         VALUES (1, $1, $2, $2, 0.1, 'passenger.km', 2024, 'CI', 'life_cycle'), (1, $1, $3, $3, 0.2, 'vehicle.km', 2024, 'CI', 'life_cycle')`,
        [cat, RAIL, CAR],
      );
    }
  });
});
test.after(reset);

const EX_71 = [
  { ref: "A", mode: "Rail", one_way_km: 10, days_per_week: 5, weeks_per_year: 48 },
  { ref: "B", mode: "Rail", one_way_km: 10, days_per_week: 4, weeks_per_year: 48 },
  { ref: "B", mode: "Car", one_way_km: 15, days_per_week: 1, weeks_per_year: 48 },
  { ref: NAME_REF, mode: "Car", one_way_km: 20, days_per_week: 5, weeks_per_year: 48 },
];
const survey = (extra = {}) => ({ site_id: 1, year: 2025, year_type: "CY", total_employees: 3, responses: EX_71, ...extra });

test("survey 7.1 as a Manager: one plan, a row per mode, the engine gives 3,072 kg (2 dp t)", async () => {
  const r = await call("POST", "/scope3/commuting/surveys", "manager", survey());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.plan.channel, "bulk_upload");
  assert.equal(r.json.plan.status, "draft");
  assert.equal(r.json.plan.source_name, "Commuting survey CY 2025");
  assert.deepEqual(
    r.json.summary.modes.map((m) => [m.mode, m.respondents, m.total_km]),
    [
      ["Rail [passenger.km]", 2, 8640],
      ["Car, unknown fuel [vehicle.km]", 2, 11040],
    ],
  );
  const rows = r.json.plan.rows;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.state, "ready", JSON.stringify(row.issues));
    assert.equal(row.input.period.kind, "yearly");
    assert.equal(row.input.fields["@method"], "distance_based");
    assert.deepEqual(row.input.survey, { basis: "sample", respondents: 3, total_employees: 3, coverage_pct: 100 });
    for (const k of ["total", "total_emission", "total_tco2e"]) assert.equal(k in row.input, false);
  }
  const t = Object.fromEntries(rows.map((x) => [x.input.activity_name, x.result.total_tco2e]));
  assert.deepEqual(t, { "Rail [passenger.km]": 0.86, "Car, unknown fuel [vehicle.km]": 2.21 });
  // Nothing is saved until the plan is committed.
  const before = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM emission WHERE category_id = $1`, [CAT7]));
  assert.equal(before.rows[0].n, 0);
  // The plan seeded the standard commuting form.
  const cfg = await withDb((db) => db.query(`SELECT config_name, calculation FROM column_config WHERE site_id = 1 AND category_id = $1`, [CAT7]));
  assert.equal(cfg.rows.length, 1);
  assert.equal(cfg.rows[0].calculation.method_column, "@method");

  // Commit: the rows keep the survey scaling in extra_data.survey.
  const commit = await call("POST", `/imports/plans/${r.json.plan.plan_id}/commit`, "manager", {
    version: r.json.plan.version,
    skip_rows_with_issues: false,
    idempotency_key: `s3-9-${r.json.plan.plan_id}`,
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  const saved = await withDb((db) => db.query(`SELECT total_emission, extra_data, activity_data FROM emission WHERE category_id = $1 ORDER BY total_emission`, [CAT7]));
  assert.deepEqual(saved.rows.map((x) => Number(x.total_emission)), [0.86, 2.21]);
  for (const x of saved.rows) {
    assert.deepEqual(x.extra_data.survey, { basis: "sample", respondents: 3, total_employees: 3, coverage_pct: 100 });
    assert.equal(x.activity_data["@method"], "distance_based");
  }
});

test("survey scaling: 3 of 300 employees → each mode × 100", async () => {
  const r = await call("POST", "/scope3/commuting/surveys", "admin", survey({ total_employees: 300 }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.summary.scale, 100);
  assert.equal(r.json.summary.coverage_pct, 1);
  const t = Object.fromEntries(r.json.plan.rows.map((x) => [x.input.activity_name, x.result.total_tco2e]));
  assert.deepEqual(t, { "Rail [passenger.km]": 86.4, "Car, unknown fuel [vehicle.km]": 220.8 });
});

test("survey: a name-like ref never leaves the request (plan rows, response, stored input)", async () => {
  const r = await call("POST", "/scope3/commuting/surveys", "manager", survey());
  assert.equal(r.status, 201);
  assert.ok(!JSON.stringify(r.json).includes("Priya"));
  const stored = await withDb((db) => db.query(`SELECT input::text AS t FROM import_plan_row WHERE plan_id = $1`, [r.json.plan.plan_id]));
  for (const row of stored.rows) assert.ok(!row.t.includes("Priya") && !row.t.includes("example.invalid"));
  // The module logs nothing but the error name.
  for (const file of ["survey.js", "controller.js", "router.js"]) {
    const src = fs.readFileSync(path.join(ROOT, "dist/scope3/commuting", file), "utf8");
    for (const line of src.split("\n").filter((l) => /console\./.test(l))) assert.match(line, /\.name\)/, `${file}: ${line.trim()}`);
  }
});

test("survey roles and tenant isolation", async () => {
  const user = await call("POST", "/scope3/commuting/surveys", "user", survey());
  assert.equal(user.status, 403);
  assert.equal(user.json.code, "SCOPE3_FORBIDDEN");
  // Company 2 tokens on company 1's site, and company 1 on company 2's.
  assert.equal((await call("POST", "/scope3/commuting/surveys", "otherManager", survey())).status, 404);
  assert.equal((await call("POST", "/scope3/commuting/surveys", "otherManager", survey({ company_id: 1 }))).status, 404);
  assert.equal((await call("POST", "/scope3/commuting/surveys", "admin", survey({ site_id: 3 }))).status, 404);
  assert.equal((await call("POST", "/scope3/commuting/surveys", "manager", survey({ site_id: 3 }))).status, 404);
  const sa = await call("POST", "/scope3/commuting/surveys", "superadmin", survey());
  assert.equal(sa.status, 400);
  assert.equal(sa.json.code, "SCOPE3_COMPANY_REQUIRED");
  assert.equal((await call("POST", "/scope3/commuting/surveys", "superadmin", survey({ company_id: 1 }))).status, 201);
  assert.equal((await call("POST", "/scope3/commuting/surveys")).status, 401);
  // Company 2's site 3 got no form from any of these calls.
  const cfg = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM column_config WHERE site_id = 3 AND category_id = $1`, [CAT7]));
  assert.equal(cfg.rows[0].n, 0);
});

test("survey validation: > 20,000 responses, bad numbers, more respondents than staff, no Category 7", async () => {
  const many = Array.from({ length: 20001 }, (_, i) => ({ ref: `r${i}`, mode: "Rail", one_way_km: 1, days_per_week: 5, weeks_per_year: 46 }));
  const big = await call("POST", "/scope3/commuting/surveys", "manager", survey({ responses: many, total_employees: 30000 }));
  assert.equal(big.status, 400);
  assert.equal(big.json.code, "SCOPE3_VALIDATION");
  assert.ok(!JSON.stringify(big.json).includes("r19999"));
  for (const bad of [{ year_type: "Q1" }, { total_employees: 0 }, { responses: [] }, { responses: [{ ...EX_71[0], days_per_week: 9 }] }]) {
    const out = await call("POST", "/scope3/commuting/surveys", "manager", survey(bad));
    assert.equal(out.status, 400, JSON.stringify(bad));
  }
  const fewer = await call("POST", "/scope3/commuting/surveys", "manager", survey({ total_employees: 2 }));
  assert.equal(fewer.status, 400);
  assert.equal(fewer.json.details.reason, "FEWER_EMPLOYEES_THAN_RESPONDENTS");
  const noCat = await call("POST", "/scope3/commuting/surveys", "manager", survey({ site_id: 2 }));
  assert.equal(noCat.status, 400);
  assert.equal(noCat.json.details.reason, "CATEGORY_7_NOT_ASSIGNED");
});

const runScript = (name, args = []) =>
  spawnSync(process.execPath, [path.join(ROOT, `dist/scripts/${name}.js`), ...args], {
    cwd: ROOT,
    env: { ...process.env, TYPEORM_SYNC: "false" },
    encoding: "utf8",
  });

test("migrate:scope3-travel runs twice: one form per site × category, its units; a customised form is left alone", async () => {
  // A client's own Category 7 form on site 3 (company 2).
  await withDb((db) => db.query(`INSERT INTO column_config (config_name, site_id, category_id) VALUES ('Client commuting form', 3, $1)`, [CAT7]));
  const counts = () =>
    withDb(async (db) => {
      const q = (sql) => db.query(sql, [CAT7, CAT6]).then((r) => r.rows[0].n);
      return {
        configs: await q(`SELECT COUNT(*)::int AS n FROM column_config WHERE category_id IN ($1, $2)`),
        units: await q(`SELECT COUNT(*)::int AS n FROM unit WHERE category_id IN ($1, $2)`),
        columns: await q(`SELECT COUNT(*)::int AS n FROM column_config_columns cc JOIN column_config c ON c.pk_id = cc."columnConfigPkId" WHERE c.category_id IN ($1, $2)`).catch(() => null),
      };
    });
  const first = runScript("migrateScope3Travel");
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.match(first.stdout, /customised forms left as they are \(site\/category\): 3\/931/);
  const after1 = await counts();
  const second = runScript("migrateScope3Travel");
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.match(second.stdout, /configs created: 0 · updated: 0/);
  assert.deepEqual(await counts(), after1);
  const forms = await withDb((db) => db.query(`SELECT site_id, category_id, config_name, calculation FROM column_config WHERE category_id IN ($1, $2) ORDER BY site_id, category_id`, [CAT7, CAT6]));
  assert.deepEqual(forms.rows.map((r) => [r.site_id, r.category_id, r.config_name]), [
    [1, CAT7, "Scope 3 travel - Standard - Employee commuting"],
    [1, CAT6, "Scope 3 travel - Standard - Business travel"],
    [3, CAT7, "Client commuting form"],
  ]);
  assert.equal(forms.rows[2].calculation, null);
  const units = await withDb((db) => db.query(`SELECT unit_name FROM unit WHERE site_id = 1 AND category_id = $1 ORDER BY unit_name`, [CAT6]));
  assert.deepEqual(units.rows.map((r) => r.unit_name), ["litre", "night", "passenger.km", "vehicle.km"]);
  // The commuting survey refuses a site whose form a client customised.
  const r = await call("POST", "/scope3/commuting/surveys", "otherManager", survey({ site_id: 3 }));
  assert.equal(r.status, 400);
  assert.equal(r.json.details.reason, "COMMUTING_FORM_CUSTOMISED");
});

test("Category 6 rows: vehicle.km by occupancy, divide by 0 → FIELD_REQUIRED, legacy rows keep their product", async () => {
  const run = runScript("migrateScope3Travel", ["1"]);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const base = { site_id: 1, category_id: CAT6, period: { kind: "monthly", date: "2025-06-15" } };
  const rows = [
    // 6.1 road: 10 travellers, 2 per car, 50 km × 0.2 → 250 vehicle.km → 0.05 t
    { ...base, row_ref: "car", activity_name: CAR, activity_unit: "vehicle.km", fields: { Travellers: 10, "Travellers per vehicle": 2, "Distance (km)": 50, "Trip ref": "T1" } },
    { ...base, row_ref: "zero", activity_name: CAR, activity_unit: "vehicle.km", fields: { Travellers: 10, "Travellers per vehicle": 0, "Distance (km)": 50, "Trip ref": "T2" } },
    // Legacy shape: the product in the distance column, no travellers field.
    { ...base, row_ref: "legacy", activity_name: RAIL, activity_unit: "passenger.km", fields: { "Distance (km)": 12345, "Trip ref": "T3" } },
  ];
  const r = await call("POST", "/imports/plans", "manager", { source_name: "CI S3-9 travel", channel: "api", rows });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const by = Object.fromEntries(r.json.rows.map((x) => [x.row_ref, x]));
  assert.equal(by.car.state, "ready", JSON.stringify(by.car.issues));
  assert.equal(by.car.result.total_tco2e, 0.05);
  assert.equal(by.zero.state, "issue");
  assert.equal(by.zero.issues[0].code, "FIELD_REQUIRED");
  assert.match(by.zero.issues[0].message, /Travellers per vehicle/);
  assert.equal(by.legacy.state, "ready", JSON.stringify(by.legacy.issues));
  assert.equal(by.legacy.result.total_tco2e, 1.23); // 12,345 × 0.1 kg
});
