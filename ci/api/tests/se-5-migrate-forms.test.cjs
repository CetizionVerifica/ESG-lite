// SE-5 · migrate:entry-forms-data on a real database: an "@method" commuting form with saved rows
// moves to a question; its rows calculate the same and are never written; a second run and a dry
// run change nothing; a form whose rows would calculate differently is rolled back with a warning
// and the script still exits 0. After the move a User answers the question, and a row saved before
// it still recalculates from its "@method".
//
// Adds one Scope 3 category on company 1's site 1 and removes everything it created.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const SITE = 1;
const CAT = 175; // employee commuting (GHG Category 7)
const COLS = { mode: 9981, distance: 9982, fuel: 9983 };
const FACTORS = [9980, 9985];
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const ROOT = path.resolve(__dirname, "../../..");
const created = [];
let formId;

/** The script as migrate-all runs it (built), against this test's database. */
const runScript = (...args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "dist/scripts/migrateEntryFormsData.js"), ...args], { cwd: ROOT, env: { ...process.env, TZ: "UTC" }, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const form = async () => (await q(`SELECT calculation, method_options, method_by_choice, column_options, field_settings FROM column_config WHERE pk_id = $1`, [formId]))[0];
const rows = () => q(`SELECT pk_id, total_kgco2e::text AS kg, activity_data, method FROM emission WHERE category_id = $1 ORDER BY pk_id`, [CAT]);
const typed = (activity_data, unit, date = "2026-08-31") =>
  call("POST", "/user/emissions", "user", { site_id: SITE, category_id: CAT, date_of_reporting: date, reporting_period: "monthly", activity_data_unit: unit, activity_data, extra_data: {} });

test.before(async () => {
  await q(`INSERT INTO category (category_id, category_name, scope) VALUES (${CAT}, 'SE-5 commuting', 'Scope 3')`);
  const hasGhg = await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'category' AND column_name = 'ghg_category'`);
  if (hasGhg.length) await q(`UPDATE category SET ghg_category = 7 WHERE category_id = ${CAT}`);
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, ${CAT})`);
  await q(
    `INSERT INTO column_entity (pk_id, column_name, column_type) VALUES (${COLS.mode}, 'Commuting mode', 'select'), (${COLS.distance}, 'Total distance (km)', 'number'), (${COLS.fuel}, 'Fuel used (litres)', 'number')`,
  );
  await q(
    `INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type) VALUES
       (9980, ${SITE}, ${CAT}, 2025, 0.17, 'vehicle.km', 'CI', 'SE-5 Car, diesel', 'SE-5 Car, diesel', 'life_cycle'),
       (9985, ${SITE}, ${CAT}, 2025, 2.5, 'litre', 'CI', 'SE-5 Diesel used', 'SE-5 Diesel used', 'life_cycle')`,
  );
  // The form as S3-9 writes it: "@method" picks the formula, no method_options yet.
  const r = await call("POST", "/admin/column-configs", "superadmin", {
    config_name: "SE-5 commuting",
    site_id: SITE,
    category_id: CAT,
    column_ids: Object.values(COLS),
    column_options: { [COLS.mode]: [{ id: "car", label: "Car, diesel" }, { id: "diesel", label: "Diesel used" }] },
    emission_category_mapping: { car: "SE-5 Car, diesel", diesel: "SE-5 Diesel used" },
    calculation: {
      mode: "per_method",
      method_column: "@method",
      methods: { distance_based: { multiply: ["Total distance (km)"], activity_unit: "vehicle.km" }, fuel_based: { multiply: ["Fuel used (litres)"], activity_unit: "litre" } },
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  formId = r.json.columnConfig.pk_id;
});

test.after(async () => {
  await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::int[])`, [created]);
  await q(`DELETE FROM emission WHERE category_id = ${CAT} OR fera_linked_id = ANY($1::int[])`, [created]);
  const configs = (await q(`SELECT pk_id FROM column_config WHERE category_id = ${CAT}`)).map((r) => r.pk_id);
  if (configs.length) {
    await q(`DELETE FROM column_config_columns WHERE column_config_id = ANY($1::int[])`, [configs]);
    await q(`DELETE FROM column_config WHERE pk_id = ANY($1::int[])`, [configs]);
  }
  await q(`DELETE FROM column_entity WHERE pk_id = ANY($1::int[]) OR column_name = 'Record type'`, [Object.values(COLS)]);
  await q(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1::int[])`, [FACTORS]);
  await q(`DELETE FROM site_categories WHERE category_id = ${CAT}`);
  await q(`DELETE FROM category WHERE category_id = ${CAT}`);
});

test("rows saved today with @method: 1,000 km × 0.17 and 200 L × 2.5", async () => {
  for (const [data, unit, kg] of [
    [{ "@method": "distance_based", "Commuting mode": "car", "Total distance (km)": "1000", emission_category: "SE-5 Car, diesel" }, "vehicle.km", "170.0000"],
    [{ "@method": "fuel_based", "Commuting mode": "diesel", "Fuel used (litres)": "200", emission_category: "SE-5 Diesel used" }, "litre", "500.0000"],
  ]) {
    const r = await typed(data, unit);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    created.push(r.json.emission.pk_id);
    assert.equal((await q(`SELECT total_kgco2e::text AS kg FROM emission WHERE pk_id = $1`, [r.json.emission.pk_id]))[0].kg, kg);
  }
});

test("a dry run lists the form and changes nothing", async () => {
  const before = await form();
  const r = runScript("--dry-run");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, new RegExp(`dry run: would change \\d+ form\\(s\\):.*${formId} \\(question\\)`));
  assert.deepEqual(await form(), before);
  assert.deepEqual(await q(`SELECT pk_id FROM column_entity WHERE column_name = 'Record type'`), [], "the question column isn't kept either");
});

test("the run moves the form to a question; rows calculate the same and aren't written; a second run changes nothing", async () => {
  const rowsBefore = await rows();
  const r = runScript();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, new RegExp(`${formId} \\(question\\)`));
  assert.match(r.out, /saved row\(s\) calculate the same/);
  const f = await form();
  const [question] = await q(`SELECT pk_id FROM column_entity WHERE column_name = 'Record type'`);
  assert.equal(f.calculation.method_column, "Record type");
  assert.deepEqual(f.method_by_choice, { column: "Record type", map: { distance_based: "distance_based", fuel_based: "fuel_based" } });
  assert.deepEqual(f.column_options[String(question.pk_id)], [
    { id: "distance_based", label: "Trip distance" },
    { id: "fuel_based", label: "Fuel used" },
  ]);
  assert.deepEqual(f.method_options, [
    { method: "distance_based", units: ["passenger.km", "vehicle.km"] },
    { method: "fuel_based", units: ["litre"] },
  ]);
  assert.deepEqual(f.field_settings["Record type"], { label: "What does your record show?" });
  assert.equal((await q(`SELECT count(*)::int AS n FROM column_config_columns WHERE column_config_id = $1 AND column_id = $2`, [formId, question.pk_id]))[0].n, 1);
  assert.deepEqual(await rows(), rowsBefore, "no row is written");

  const again = runScript();
  assert.equal(again.status, 0, again.out);
  assert.doesNotMatch(again.out, new RegExp(`${formId} \\(`), "nothing left to move");
  assert.deepEqual(await form(), f);
});

test("after the move: a User answers the question; a row saved before recalculates from its @method", async () => {
  const r = await typed({ "Record type": "fuel_based", "Commuting mode": "diesel", "Fuel used (litres)": "40", emission_category: "SE-5 Diesel used" }, "litre", "2026-09-30");
  assert.equal(r.status, 201, JSON.stringify(r.json));
  created.push(r.json.emission.pk_id);
  const [row] = await q(`SELECT total_kgco2e::text AS kg, method FROM emission WHERE pk_id = $1`, [r.json.emission.pk_id]);
  assert.deepEqual(row, { kg: "100.0000", method: "fuel_based" });

  // The first row (distance_based, saved with @method only) edited by its User: 1,200 km now.
  const old = created[0];
  const edit = await call("PUT", `/user/emissions/${old}`, "user", { activity_data: { "@method": "distance_based", "Commuting mode": "car", "Total distance (km)": "1200", emission_category: "SE-5 Car, diesel" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal((await q(`SELECT total_kgco2e::text AS kg FROM emission WHERE pk_id = $1`, [old]))[0].kg, "204.0000");
});

test("a form whose rows would calculate differently is rolled back, logged by id, and the script exits 0", async () => {
  // A second "@method" form on another site whose saved row already holds a "Record type" value
  // naming the other formula: after the move it would calculate 30 L instead of 12 km.
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (2, ${CAT}) ON CONFLICT DO NOTHING`);
  await q(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type) VALUES
             (9986, 2, ${CAT}, 2025, 0.17, 'vehicle.km', 'CI', 'SE-5 Car, diesel', 'SE-5 Car, diesel', 'life_cycle')`);
  FACTORS.push(9986);
  const made = await call("POST", "/admin/column-configs", "superadmin", {
    config_name: "SE-5 commuting B",
    site_id: 2,
    category_id: CAT,
    column_ids: Object.values(COLS),
    calculation: {
      mode: "per_method",
      method_column: "@method",
      methods: { distance_based: { multiply: ["Total distance (km)"], activity_unit: "vehicle.km" }, fuel_based: { multiply: ["Fuel used (litres)"], activity_unit: "litre" } },
    },
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const formB = made.json.columnConfig.pk_id;
  const saved = await call("POST", "/user/emissions", "manager", {
    site_id: 2,
    category_id: CAT,
    date_of_reporting: "2026-08-31",
    reporting_period: "monthly",
    activity_data_unit: "vehicle.km",
    activity_data: { "@method": "distance_based", "Record type": "fuel_based", "Total distance (km)": "12", "Fuel used (litres)": "30", emission_category: "SE-5 Car, diesel" },
    extra_data: {},
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  created.push(saved.json.emission.pk_id);
  const before = (await q(`SELECT calculation, method_options FROM column_config WHERE pk_id = $1`, [formB]))[0];

  const r = runScript();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, new RegExp(`WARNING: form\\(s\\) [\\d, ]*${formB}[\\d, ]* would calculate saved rows differently; nothing was changed`));
  assert.deepEqual((await q(`SELECT calculation, method_options FROM column_config WHERE pk_id = $1`, [formB]))[0], before, "rolled back");
});
