// S3-8 transport and distribution (docs/scope3/modules/S3-8-transport):
// migrate:scope3-transport applied twice (the second run writes nothing), a
// client's own form left alone, each new unit key computed by the engine on a
// typed entry, a share over 100 % refused, a pre-S3-8 tonne.km row (legacy
// field only) still computed, and company 2 unable to read company 1's form.
//
// Adds the transport categories 13 and 18 (the fixture has none) on company 1's
// sites and removes everything it created, so other tests' counts don't move.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const UP = 13;
const DOWN = 18;
const SITE = 1; // company 1, the `user` fixture's site
const CUSTOM_SITE = 2; // company 1, carries a client's own transport form
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const created = [];
let columnsBefore = [];

const seed = () => {
  const r = spawnSync(process.execPath, [path.resolve("dist/scripts/seedScope3Transport.js")], { env: process.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
};
const state = async () => ({
  configs: await q(`SELECT pk_id, site_id, category_id, config_name, calculation FROM column_config WHERE category_id IN (${UP}, ${DOWN}) ORDER BY pk_id`),
  units: (await q(`SELECT count(*)::int AS n FROM unit WHERE category_id IN (${UP}, ${DOWN})`))[0].n,
  factors: (await q(`SELECT count(*)::int AS n FROM emission_factors WHERE category_id IN (${UP}, ${DOWN})`))[0].n,
});
const entry = (activity_data, unit, over = {}) => ({
  site_id: SITE,
  category_id: UP,
  date_of_reporting: "2026-03-31",
  reporting_period: "monthly",
  activity_data_unit: unit,
  activity_data,
  extra_data: {},
  ...over,
});
const createEntry = async (activity_data, unit, over) => {
  const r = await call("POST", "/user/emissions", "user", entry(activity_data, unit, over));
  if (r.status === 201) created.push(r.json.emission.pk_id);
  return r;
};

test.before(async () => {
  columnsBefore = (await q(`SELECT pk_id FROM column_entity`)).map((r) => r.pk_id);
  await q(`INSERT INTO category (category_id, category_name, scope) VALUES (${UP}, 'Upstream transportation and distribution', 'Scope 3'), (${DOWN}, 'Downstream transportation and distribution', 'Scope 3')`);
  // Once S3-1 adds category.ghg_category, the seed finds them by number.
  const hasGhg = await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'category' AND column_name = 'ghg_category'`);
  if (hasGhg.length) await q(`UPDATE category SET ghg_category = CASE category_id WHEN ${UP} THEN 4 ELSE 9 END WHERE category_id IN (${UP}, ${DOWN})`);
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, ${UP}), (${SITE}, ${DOWN}), (${CUSTOM_SITE}, ${UP})`);
  await q(`INSERT INTO column_config (config_name, site_id, category_id, calculation, extra_fields) VALUES ('Client freight form', ${CUSTOM_SITE}, ${UP}, '{"mode":"per_unit","methods":{"km":{"multiply":["Km"]}}}', '[]')`);
});

test.after(async () => {
  if (created.length) {
    await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::bigint[])`, [created]);
    await q(`DELETE FROM emission WHERE pk_id = ANY($1::bigint[])`, [created]);
  }
  const configs = (await q(`SELECT pk_id FROM column_config WHERE category_id IN (${UP}, ${DOWN})`)).map((r) => r.pk_id);
  if (configs.length) {
    await q(`DELETE FROM column_config_columns WHERE column_config_id = ANY($1::int[])`, [configs]);
    await q(`DELETE FROM column_config WHERE pk_id = ANY($1::int[])`, [configs]);
  }
  await q(`DELETE FROM unit WHERE category_id IN (${UP}, ${DOWN})`);
  await q(`DELETE FROM emission_factors WHERE category_id IN (${UP}, ${DOWN})`);
  await q(`DELETE FROM site_categories WHERE category_id IN (${UP}, ${DOWN})`);
  await q(`DELETE FROM category WHERE category_id IN (${UP}, ${DOWN})`);
  await q(`DELETE FROM column_entity WHERE NOT (pk_id = ANY($1::int[]))`, [columnsBefore]);
});

test("migrate:scope3-transport sets up the standard form once; the second run writes nothing; a client's form is left alone", async () => {
  const first = seed();
  assert.match(first, /configs written: 2 · units added: 16 · factors added: 24/);
  assert.match(first, /customised configs left as they are: \d+/);
  const after1 = await state();
  const standard = after1.configs.filter((c) => c.site_id === SITE);
  assert.deepEqual(standard.map((c) => c.config_name).sort(), ["Transport - Standard - Downstream", "Transport - Standard - Upstream"]);
  for (const c of standard) {
    assert.equal(c.calculation.standard, "scope3-transport@1");
    assert.match(c.calculation.standard_hash, /^[0-9a-f]{32}$/);
  }
  // S3-3 method_options: Cat 4 fuel first, Cat 9 distance first, each with its units.
  const methods = await q(`SELECT category_id, method_options FROM column_config WHERE site_id = ${SITE} ORDER BY category_id`);
  const byCat = Object.fromEntries(methods.filter((m) => [UP, DOWN].includes(m.category_id)).map((m) => [m.category_id, m.method_options]));
  assert.deepEqual(byCat[UP].map((o) => o.method), ["fuel_based", "distance_based", "site_specific", "average_data", "spend_based"]);
  assert.deepEqual(byCat[DOWN].map((o) => o.method), ["distance_based", "fuel_based", "average_data", "site_specific", "spend_based"]);
  assert.deepEqual(byCat[UP].find((o) => o.method === "distance_based").units, ["tonne.km", "km"]);
  const custom = after1.configs.find((c) => c.site_id === CUSTOM_SITE);
  assert.deepEqual(custom.calculation, { mode: "per_unit", methods: { km: { multiply: ["Km"] } } }, "the client's form is untouched");
  assert.equal((await q(`SELECT count(*)::int AS n FROM unit WHERE site_id = ${CUSTOM_SITE} AND category_id = ${UP}`))[0].n, 0, "no units added to a client's form");

  // Seeded factors carry S3-2's metadata.
  const meta = await q(`SELECT emission_category_name AS n, factor_type, gwp_set, geography, dataset, dataset_version FROM emission_factors WHERE site_id = ${SITE} AND category_id = ${UP} AND year = 2025 AND emission_category_name IN ('Fuel - Diesel (average biofuel blend) [litre]', 'Refrigerant - R410A [kg]') ORDER BY 1`);
  assert.deepEqual(meta, [
    { n: "Fuel - Diesel (average biofuel blend) [litre]", factor_type: "life_cycle", gwp_set: "AR5", geography: "GB", dataset: "DEFRA", dataset_version: "2025" },
    { n: "Refrigerant - R410A [kg]", factor_type: "other", gwp_set: "AR6", geography: "GLO", dataset: "IPCC AR6", dataset_version: "AR6 WG1 Table 7.SM.7" },
  ]);

  const second = seed();
  assert.match(second, /configs written: 0 · units added: 0 · factors added: 0/);
  assert.deepEqual(await state(), after1);
});

test("the seeded form serves its units and Who paid?, and company 2 can't read it", async () => {
  const mine = await call("GET", `/user/column-configs/site/${SITE}/category/${UP}`, "user");
  assert.equal(mine.status, 200);
  const form = mine.json[0];
  assert.deepEqual(Object.keys(form.calculation.methods).sort(), ["kg", "km", "kwh", "litre", "m3.day", "pallet.day", "teu.day", "tonne.km"]);
  assert.deepEqual(form.extra_fields.map((f) => f.key), ["paid_by"]);
  const other = await call("GET", `/user/column-configs/site/${SITE}/category/${UP}`, "otherUser");
  assert.ok([403, 404].includes(other.status), `company 2 got ${other.status}`);
});

test("each new unit key computes through the engine on a typed entry", async () => {
  // Client factors the seed leaves to the client: grid, storage and one freight factor.
  await q(`INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
    (${SITE}, ${UP}, 2025, 0.71, 'kWh', 'CI', 'Electricity - Grid [kWh]', 'Electricity - Grid [kWh]'),
    (${SITE}, ${UP}, 2025, 0.01, 'm3.day', 'CI', 'Warehouse - Ambient storage [m3.day]', 'Warehouse - Ambient storage [m3.day]'),
    (${SITE}, ${UP}, 2025, 0.02, 'pallet.day', 'CI', 'Warehouse - Ambient storage [pallet.day]', 'Warehouse - Ambient storage [pallet.day]'),
    (${SITE}, ${UP}, 2025, 0.5, 'teu.day', 'CI', 'Warehouse - Container storage [teu.day]', 'Warehouse - Container storage [teu.day]'),
    (${SITE}, ${UP}, 2025, 0.2408, 'tonne.km', 'CI', 'Road - HGV (all diesel) - All rigids [tonne.km]', 'Road - HGV (all diesel) - All rigids [tonne.km]')`);
  const cases = [
    // [activity_data, unit, expected tCO2e (2 dp)]
    [{ "Fuel used (litres)": "1000", "Your share of the load (%)": "100", emission_category: "Fuel - Diesel (average biofuel blend) [litre]", "Shipment Ref": "A" }, "litre", 3.18], // seeded DEFRA 2025 life cycle 3.1818
    [{ "Energy used (kWh)": "10000", "Your share (%)": "25", emission_category: "Electricity - Grid [kWh]", "Shipment Ref": "B" }, "kWh", 1.78],
    [{ "Refrigerant leaked (kg)": "2", "Your share (%)": "50", emission_category: "Refrigerant - R410A [kg]", "Shipment Ref": "C" }, "kg", 2.26], // AR6 2256
    [{ "Volume stored": "4000", "Days stored": "2", emission_category: "Warehouse - Ambient storage [m3.day]", "Shipment Ref": "D" }, "m³.day", 0.08],
    [{ "Volume stored": "1000", "Days stored": "30", emission_category: "Warehouse - Ambient storage [pallet.day]", "Shipment Ref": "E" }, "pallet day", 0.6],
    [{ "Volume stored": "2", "Days stored": "10", emission_category: "Warehouse - Container storage [teu.day]", "Shipment Ref": "F" }, "teu.day", 0.01],
    [{ "Weight (tonne)": "10", "Distance travelled": "500", emission_category: "Road - HGV (all diesel) - All rigids [tonne.km]", "Shipment Ref": "G" }, "tonne.km", 1.2],
  ];
  for (const [data, unit, expected] of cases) {
    const r = await createEntry(data, unit);
    assert.equal(r.status, 201, `${unit}: ${JSON.stringify(r.json)}`);
    const [row] = await q(`SELECT total_emission FROM emission WHERE pk_id = $1`, [r.json.emission.pk_id]);
    assert.equal(Number(row.total_emission), expected, unit);
  }
});

test("a share over 100 % is refused; a pre-S3-8 tonne.km row holding only the distance still computes", async () => {
  const over = await createEntry({ "Energy used (kWh)": "100", "Your share (%)": "150", emission_category: "Electricity - Grid [kWh]", "Shipment Ref": "H" }, "kWh");
  assert.equal(over.status, 400);
  assert.match(over.json.message, /"Your share \(%\)" is a percentage — it cannot be more than 100/);
  // Saved before the spec: only the multiplied value under the legacy field, no Weight key at all.
  const legacy = await createEntry({ "Distance travelled": "5000", emission_category: "Road - HGV (all diesel) - All rigids [tonne.km]", "Shipment Ref": "I" }, "tonne.km");
  assert.equal(legacy.status, 201, JSON.stringify(legacy.json));
  const [row] = await q(`SELECT total_emission FROM emission WHERE pk_id = $1`, [legacy.json.emission.pk_id]);
  assert.equal(Number(row.total_emission), 1.2);
});

test("a standard form a Superadmin edited is left alone on the next start; their methods stay", async () => {
  const [cfg] = await q(`SELECT pk_id, emission_category_mapping, method_options FROM column_config WHERE site_id = ${SITE} AND category_id = ${DOWN}`);
  const mapping = { ...cfg.emission_category_mapping, "Road|Van|Diesel [km]": "Client van factor" };
  const methods = [{ method: "distance_based", units: ["tonne.km", "km"] }];
  await q(`UPDATE column_config SET emission_category_mapping = $1, method_options = $2 WHERE pk_id = $3`, [JSON.stringify(mapping), JSON.stringify(methods), cfg.pk_id]);
  const out = seed();
  assert.match(out, /configs written: 0/);
  assert.match(out, new RegExp(`customised configs left as they are: .*\\b${cfg.pk_id}\\b`));
  const [after] = await q(`SELECT emission_category_mapping, method_options FROM column_config WHERE pk_id = $1`, [cfg.pk_id]);
  assert.equal(after.emission_category_mapping["Road|Van|Diesel [km]"], "Client van factor");
  assert.deepEqual(after.method_options, methods);
});

test("an estimated distance is saved as is_estimate and warns ESTIMATED_DISTANCE; a measured one doesn't", async () => {
  const data = (ref) => ({ "Weight (tonne)": "10", "Distance travelled": "500", emission_category: "Road - HGV (all diesel) - All rigids [tonne.km]", "Shipment Ref": ref });
  const est = await createEntry(data("EST-1"), "tonne.km", { is_estimate: true });
  assert.equal(est.status, 201, JSON.stringify(est.json));
  assert.deepEqual(est.json.warnings.map((w) => w.code), ["ESTIMATED_DISTANCE"]);
  const [row] = await q(`SELECT is_estimate, total_emission FROM emission WHERE pk_id = $1`, [est.json.emission.pk_id]);
  assert.equal(row.is_estimate, true);
  assert.equal(Number(row.total_emission), 1.2, "the warning never changes the total");
  const measured = await createEntry(data("EST-2"), "tonne.km");
  assert.equal(measured.status, 201);
  assert.deepEqual(measured.json.warnings ?? [], []);
});

test("a Category 9 row the company says it paid for warns TRANSPORT_PAID_BY_MISMATCH and is still saved", async () => {
  await q(`INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
    (${SITE}, ${DOWN}, 2025, 0.2, 'tonne.km', 'CI', 'Road - HGV (all diesel) - All rigids [tonne.km]', 'Road - HGV (all diesel) - All rigids [tonne.km]')`);
  const data = (ref) => ({ "Weight (tonne)": "4", "Distance travelled": "2000", emission_category: "Road - HGV (all diesel) - All rigids [tonne.km]", "Shipment Ref": ref });
  const ours = await createEntry(data("DN-1"), "tonne.km", { category_id: DOWN, extra_data: { paid_by: "We paid" } });
  assert.equal(ours.status, 201, JSON.stringify(ours.json));
  assert.deepEqual(ours.json.warnings.map((w) => w.code), ["TRANSPORT_PAID_BY_MISMATCH"]);
  assert.equal(Number((await q(`SELECT total_emission FROM emission WHERE pk_id = $1`, [ours.json.emission.pk_id]))[0].total_emission), 1.6, "ex-9.1: 4 t × 2,000 km × 0.2 = 1,600 kg");
  const theirs = await createEntry(data("DN-2"), "tonne.km", { category_id: DOWN, extra_data: { paid_by: "Customer or other" } });
  assert.equal(theirs.status, 201);
  assert.deepEqual(theirs.json.warnings ?? [], []);
  // Category 4 is never flagged: inbound freight is Category 4 whoever paid.
  const up = await createEntry(data("UP-1"), "tonne.km", { extra_data: { paid_by: "Customer or other" } });
  assert.equal(up.status, 201);
  assert.deepEqual(up.json.warnings ?? [], []);
});

test("a row that names no method records the one its unit belongs to; totals are the same (S3-8 default by unit)", async () => {
  // Rows saved above on the Category 4 form (fuel_based first): each unit's own method.
  const byRef = Object.fromEntries(
    (await q(`SELECT activity_data->>'Shipment Ref' AS ref, method FROM emission WHERE pk_id = ANY($1::bigint[]) AND category_id = ${UP}`, [created])).map((r) => [r.ref, r.method]),
  );
  assert.equal(byRef.A, "fuel_based", "litre");
  assert.equal(byRef.B, "fuel_based", "kWh: fuel_based and site_specific both list it; the form's order decides");
  assert.equal(byRef.C, "fuel_based", "kg: likewise");
  assert.equal(byRef.D, "average_data", "m³.day");
  assert.equal(byRef.E, "average_data", "pallet day");
  assert.equal(byRef.F, "average_data", "teu.day");
  assert.equal(byRef.G, "distance_based", "tonne.km");
  assert.equal(byRef.I, "distance_based", "a legacy tonne.km row");

  // Category 9 (distance_based first): litres record fuel_based, not the form's first method.
  const [down] = await q(`SELECT pk_id FROM column_config WHERE site_id = ${SITE} AND category_id = ${DOWN}`);
  await q(`UPDATE column_config SET method_options = $1 WHERE pk_id = $2`, [
    JSON.stringify([
      { method: "distance_based", units: ["tonne.km", "km"] },
      { method: "fuel_based", units: ["litre", "kWh", "kg"] },
      { method: "average_data", units: ["m3.day", "pallet.day", "teu.day"] },
    ]),
    down.pk_id,
  ]);
  const fuel = { "Fuel used (litres)": "500", "Your share of the load (%)": "50", emission_category: "Fuel - Diesel (average biofuel blend) [litre]", "Shipment Ref": "DN-FUEL" };
  const r = await createEntry(fuel, "litre", { category_id: DOWN });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const [row] = await q(`SELECT method, total_emission FROM emission WHERE pk_id = $1`, [r.json.emission.pk_id]);
  assert.equal(row.method, "fuel_based");
  assert.equal(Number(row.total_emission), 0.8, "500 L × 50 % × 3.18183 kg/L = 795 kg");
  const named = await createEntry({ ...fuel, "Shipment Ref": "DN-FUEL-2" }, "litre", { category_id: DOWN, method: "fuel_based" });
  assert.equal(named.status, 201);
  assert.equal((await q(`SELECT method FROM emission WHERE pk_id = $1`, [named.json.emission.pk_id]))[0].method, "fuel_based", "a method the row names wins");
});

test("D6: the seeded DEFRA fuel factors are flagged as including WTT; fuel rows warn WTT_ALREADY_IN_FACTOR and keep their total", async () => {
  const flags = await q(`SELECT DISTINCT emission_category_name AS n, factor_type, includes_wtt FROM emission_factors WHERE site_id = ${SITE} AND category_id = ${UP} AND source LIKE '% (S3-8)' ORDER BY 1`);
  for (const f of flags) assert.equal(f.includes_wtt, f.n.startsWith("Fuel - "), f.n);
  for (const f of flags) assert.equal(f.factor_type, f.n.startsWith("Fuel - ") ? "life_cycle" : "other", f.n);

  // Rows seeded before the flag existed are flagged on the next run; nothing else changes.
  await q(`UPDATE emission_factors SET includes_wtt = false WHERE site_id = ${SITE} AND category_id = ${UP} AND emission_category_name = 'Fuel - Diesel (average biofuel blend) [litre]'`);
  const before = await q(`SELECT emission_factor_id, factor_value FROM emission_factors WHERE category_id IN (${UP}, ${DOWN}) ORDER BY 1`);
  assert.match(seed(), /WTT flagged: 2\b/);
  assert.deepEqual(await q(`SELECT emission_factor_id, factor_value FROM emission_factors WHERE category_id IN (${UP}, ${DOWN}) ORDER BY 1`), before);
  assert.match(seed(), /WTT flagged: 0\b/);

  const r = await createEntry({ "Fuel used (litres)": "1000", "Your share of the load (%)": "100", emission_category: "Fuel - Diesel (average biofuel blend) [litre]", "Shipment Ref": "WTT-1" }, "litre");
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(r.json.warnings.map((w) => w.code), ["WTT_ALREADY_IN_FACTOR"]);
  assert.equal(Number((await q(`SELECT total_emission FROM emission WHERE pk_id = $1`, [r.json.emission.pk_id]))[0].total_emission), 3.18, "the total is kept");
});

