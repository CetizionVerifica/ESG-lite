// S3-4 engine integrity (docs/scope3/modules/S3-4-engine-integrity): the
// UNIT_REQUIRED row error, an entry without a unit in a single-unit form,
// the fallback-year and missing-FERA warnings on typed entries, edits through
// the engine (kgCO₂e total, warnings, FERA twin), category scope validation,
// the two migrations run twice, and a historical row giving the same total
// as a typed one.
//
// Runs on company 2 / site 3 (the fixture's isolated client) and removes
// everything it created, so the counts other tests rely on do not move.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const XLSX = require("xlsx");
const { call, withDb } = require("../helpers.cjs");

const SITE = 3; // company 2, category 1 (Stationary Combustion)
const FERA = 5;
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const entry = (over = {}) => ({
  site_id: SITE,
  category_id: 1,
  date_of_reporting: "2025-01-15",
  activity_data_unit: "litre",
  activity_data: { emission_category: "Diesel", activity_value: "1000" },
  ...over,
});
const created = [];
const createEntry = async (over) => {
  const r = await call("POST", "/user/emissions", "otherUser", entry(over));
  if (r.status === 201) created.push(r.json.emission.pk_id, ...(r.json.fera_emission ? [r.json.fera_emission.pk_id] : []));
  return r;
};

test.before(async () => {
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, ${FERA})`);
  await q(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
    (9941, ${SITE}, 1, 2024, 2.68, 'litre', 'CI', 'Diesel', 'Diesel'),
    (9942, ${SITE}, 1, 2024, 1000, '', 'CI', 'Mystery fuel', 'Mystery fuel'),
    (9943, ${SITE}, ${FERA}, 2024, 0.61, 'litre', 'CI', 'Diesel', 'Diesel')`);
});

test.after(async () => {
  if (created.length) {
    await q(`UPDATE emission SET fera_linked_id = NULL WHERE pk_id = ANY($1::int[])`, [created]);
    await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::int[])`, [created]);
    await q(`DELETE FROM emission WHERE pk_id = ANY($1::int[])`, [created]);
  }
  const hist = (await q(`SELECT pk_id, fera_linked_id FROM emission WHERE site_id = ${SITE} AND extra_data->'import'->>'channel' = 'historical'`)).flatMap((r) => [r.pk_id, r.fera_linked_id].filter(Boolean));
  if (hist.length) {
    await q(`UPDATE emission SET fera_linked_id = NULL WHERE pk_id = ANY($1::int[])`, [hist]);
    await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::int[])`, [hist]);
    await q(`DELETE FROM emission WHERE pk_id = ANY($1::int[])`, [hist]);
  }
  await q(`DELETE FROM unit WHERE site_id = ${SITE} AND category_id = 1`);
  await q(`DELETE FROM emission_factors WHERE emission_factor_id IN (9941, 9942, 9943)`);
  await q(`DELETE FROM site_categories WHERE site_id = ${SITE} AND category_id = ${FERA}`);
});

test("a factor with no unit is UNIT_REQUIRED on a typed entry and an edit, never applied unchecked", async () => {
  const r = await createEntry({ activity_data: { emission_category: "Mystery fuel", activity_value: "10" } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "UNIT_REQUIRED");
  assert.match(r.json.message, /"Mystery fuel" has no unit/);

  const ok = await createEntry({ date_of_reporting: "2025-02-15" });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const edit = await call("PUT", `/user/emissions/${ok.json.emission.pk_id}`, "otherUser", { activity_data: { emission_category: "Mystery fuel", activity_value: "5" } });
  assert.equal(edit.status, 400);
  assert.equal(edit.json.code, "UNIT_REQUIRED");
});

test("totals carry total_kgco2e at 4 dp beside the 2 dp tCO2e; the FERA twin too", async () => {
  // 1 litre x 2.68 kg = 0.00268 t: rounds to 0.00 t, kept as 2.6800 kg.
  const r = await createEntry({ date_of_reporting: "2025-03-15", activity_data: { emission_category: "Diesel", activity_value: "1" } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const [row] = await q(`SELECT total_emission, total_kgco2e FROM emission WHERE pk_id = $1`, [r.json.emission.pk_id]);
  assert.deepEqual([Number(row.total_emission), row.total_kgco2e], [0, "2.6800"]);
  assert.ok(r.json.fera_emission, "the site's FERA category gives a twin");
  const [twin] = await q(`SELECT total_emission, total_kgco2e FROM emission WHERE pk_id = $1`, [r.json.fera_emission.pk_id]);
  assert.deepEqual([Number(twin.total_emission), twin.total_kgco2e], [0, "0.6100"]);
  assert.deepEqual(r.json.warnings, []);
});

test("an entry without a unit is in the form's unit only when the form has a single one", async () => {
  const noUnit = { date_of_reporting: "2025-04-15", activity_data_unit: undefined, activity_data: { emission_category: "Diesel", activity_value: "100" } };
  const before = await createEntry(noUnit);
  assert.equal(before.status, 201);
  assert.equal(Number(before.json.emission.total_emission), 0, "no unit and no single form unit: nothing to calculate, as before");
  await q(`INSERT INTO unit (unit_name, site_id, category_id) VALUES ('litre', ${SITE}, 1)`);
  const single = await createEntry({ ...noUnit, date_of_reporting: "2025-05-15" });
  assert.equal(single.status, 201, JSON.stringify(single.json));
  assert.equal(single.json.emission.activity_data_unit, "litre");
  assert.equal(Number(single.json.emission.total_emission), 0.27); // 100 x 2.68 kg
});

test("typed entries say when an older factor year was used and when no FERA factor exists for the year", async () => {
  // A 2023 entry looks for 2022 factors: Diesel falls back to 2024, and FERA has only 2024.
  const r = await createEntry({ date_of_reporting: "2023-06-15" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(r.json.warnings.map((w) => w.code), ["FACTOR_FALLBACK_YEAR", "FERA_FACTOR_MISSING"]);
  assert.match(r.json.warnings[0].message, /No 2022 factor for "Diesel"; the 2024 factor was used/);
  assert.match(r.json.warnings[1].message, /No 2022 FERA factor for "Diesel"/);
  assert.equal(r.json.fera_emission, null);
});

test("edits go through the engine: kgCO2e, warnings and the FERA twin follow the new data", async () => {
  const r = await createEntry({ date_of_reporting: "2025-06-15" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.emission.pk_id;
  const twinId = r.json.fera_emission.pk_id;

  const user = await call("PUT", `/user/emissions/${id}`, "otherUser", { activity_data: { emission_category: "Diesel", activity_value: "500" } });
  assert.equal(user.status, 200, JSON.stringify(user.json));
  assert.deepEqual(user.json.warnings, []);
  let [row] = await q(`SELECT total_emission, total_kgco2e, emission_factor_snapshot->>'emission_factor_id' AS f FROM emission WHERE pk_id = $1`, [id]);
  assert.deepEqual([Number(row.total_emission), row.total_kgco2e, row.f], [1.34, "1340.0000", "9941"]);
  let [twin] = await q(`SELECT total_emission, total_kgco2e FROM emission WHERE pk_id = $1`, [twinId]);
  assert.deepEqual([Number(twin.total_emission), twin.total_kgco2e], [0.31, "305.0000"]);

  // A manager moves it to 2023: the factor year follows the date; no 2022 FERA factor,
  // so the twin keeps its numbers and goes back to review with the reason.
  const manager = await call("PUT", `/user/emissions/manager-edit/${id}`, "otherManager", { date_of_reporting: "2023-07-15" });
  assert.equal(manager.status, 200, JSON.stringify(manager.json));
  assert.deepEqual(manager.json.warnings.map((w) => w.code), ["FACTOR_FALLBACK_YEAR", "FERA_FACTOR_MISSING"]);
  [twin] = await q(`SELECT total_emission, status, review_comment FROM emission WHERE pk_id = $1`, [twinId]);
  assert.equal(Number(twin.total_emission), 0.31);
  assert.equal(twin.status, "pending");
  assert.match(twin.review_comment, /Not recalculated: there is no 2022 FERA factor for "Diesel"/);
  [row] = await q(`SELECT total_emission, total_kgco2e FROM emission WHERE pk_id = $1`, [id]);
  assert.deepEqual([Number(row.total_emission), row.total_kgco2e], [1.34, "1340.0000"]); // the 2024 factor again, by fallback
});

test("category scope is only Scope 1, 2, 3 or empty; spellings are normalised on save", async () => {
  const bad = await call("POST", "/admin/categories", "superadmin", { category_name: "CI S3-4 scope", scope: "Scope 9" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "SCOPE_INVALID");
  const made = await call("POST", "/admin/categories", "superadmin", { category_name: "CI S3-4 scope", scope: "scope3" });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.category?.category_id ?? made.json.category_id ?? (await q(`SELECT category_id FROM category WHERE category_name = 'CI S3-4 scope'`))[0].category_id;
  try {
    assert.equal((await q(`SELECT scope FROM category WHERE category_id = $1`, [id]))[0].scope, "Scope 3");
    const upd = await call("PUT", `/admin/categories/${id}`, "superadmin", { scope: "S-2" });
    assert.equal(upd.status, 200, JSON.stringify(upd.json));
    assert.equal((await q(`SELECT scope FROM category WHERE category_id = $1`, [id]))[0].scope, "Scope 2");
    const updBad = await call("PUT", `/admin/categories/${id}`, "superadmin", { scope: "Scope 1 and 2" });
    assert.equal(updBad.status, 400);
    assert.equal(updBad.json.code, "SCOPE_INVALID");
    assert.equal((await q(`SELECT scope FROM category WHERE category_id = $1`, [id]))[0].scope, "Scope 2", "nothing changed");
  } finally {
    await q(`DELETE FROM category WHERE category_id = $1`, [id]);
  }
});

const runScript = (name) => {
  const r = spawnSync(process.execPath, [path.resolve(`dist/scripts/${name}.js`)], { env: process.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout + r.stderr;
};

test("the scope normalisation and kgCO2e backfill migrations run twice; the second changes nothing", async () => {
  await q(`INSERT INTO category (category_id, category_name, scope) VALUES (9944, 'CI S3-4 legacy', 'scope-1'), (9945, 'CI S3-4 odd', 'Scope 1 and 2')`);
  const [old] = await q(
    `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, site_id, category_id, reporting_period)
     VALUES ('{"activity_value": "1"}', 12.34, 'tCO2e', '2024-01-15', 'pending', ${SITE}, 1, 'monthly') RETURNING pk_id`,
  );
  created.push(old.pk_id);
  try {
    assert.match(runScript("normaliseCategoryScopes"), /1 normalised[\s\S]*9945 "CI S3-4 odd": "Scope 1 and 2"/);
    assert.match(runScript("normaliseCategoryScopes"), /0 normalised/);
    assert.equal((await q(`SELECT scope FROM category WHERE category_id = 9944`))[0].scope, "Scope 1");
    assert.equal((await q(`SELECT scope FROM category WHERE category_id = 9945`))[0].scope, "Scope 1 and 2", "listed, not guessed");

    assert.match(runScript("addScope3TotalKgco2e"), /[1-9]\d* rows backfilled/);
    assert.equal((await q(`SELECT total_kgco2e FROM emission WHERE pk_id = $1`, [old.pk_id]))[0].total_kgco2e, "12340.0000");
    assert.match(runScript("addScope3TotalKgco2e"), /0 rows backfilled/);
  } finally {
    await q(`DELETE FROM category WHERE category_id IN (9944, 9945)`);
  }
});

test("a historical row gives the same total as the same row typed", async () => {
  const typed = await createEntry({ date_of_reporting: "2025-08-15", activity_data: { emission_category: "Diesel", activity_value: "1234" } });
  assert.equal(typed.status, 201, JSON.stringify(typed.json));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ year: 2025, month: "October", fuelType: "Diesel", unit: "litre", activity: 1234, calculatedEmission: 999 }]), "Sheet1");
  const form = new FormData();
  form.append("file", new Blob([XLSX.write(book, { type: "buffer", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "history.xlsx");
  for (const [k, v] of Object.entries({ companyId: 2, siteId: SITE, categoryId: 1, commit: true })) form.append(k, String(v));
  const r = await call("POST", "/admin/upload/emissions", "superadmin", form);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.summary.emissionsCreated, 1, JSON.stringify(r.json.skippedRows));
  const [hist] = await q(`SELECT total_emission, total_kgco2e FROM emission WHERE site_id = ${SITE} AND category_id = 1 AND extra_data->'import'->>'channel' = 'historical'`);
  const [mine] = await q(`SELECT total_emission, total_kgco2e FROM emission WHERE pk_id = $1`, [typed.json.emission.pk_id]);
  assert.deepEqual([Number(hist.total_emission), hist.total_kgco2e], [Number(mine.total_emission), mine.total_kgco2e]);
  assert.equal(Number(hist.total_emission), 3.31); // 1234 x 2.68 kg, not the sheet's 999
});
