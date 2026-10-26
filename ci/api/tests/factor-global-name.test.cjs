// A factor's global name can be set on create and edit (it could only come
// from a bulk upload, always equal to the name). A T&D-loss factor pairs with
// the Scope 2 activity through it (S3-7: "a td_loss factor of the site's FERA
// category whose name or global name is the activity's"); its own name can't
// be the activity's, because the upstream (WTT) factor of the same year holds
// that name. So without this no site could get a 3c T&D-loss twin by hand.
//
// Runs on company 2 / site 3 and removes everything it created.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const SITE = 3;
const ELEC = 2; // Purchased Electricity (Scope 2)
const FERA = 5;
const FACTORS = [951, 952, 953];
const madeIds = [];
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const factor = async (id) => (await q(`SELECT emission_category_name AS name, global_category_name AS global FROM emission_factors WHERE emission_factor_id = $1`, [id]))[0];
const put = (id, body) => call("PUT", `/admin/emission-factors/${id}`, "superadmin", body);

test.before(async () => {
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, ${ELEC}), (${SITE}, ${FERA}) ON CONFLICT DO NOTHING`);
  await q(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type) VALUES
    (951, ${SITE}, ${ELEC}, 2024, 0.9, 'kwh', 'CI', 'Grid ZA', 'Grid ZA', 'combustion'),
    (952, ${SITE}, ${FERA}, 2024, 0.1, 'kwh', 'CI', 'Grid ZA', 'Grid ZA', 'wtt'),
    (953, ${SITE}, ${FERA}, 2024, 0.06, 'kwh', 'CI', 'Grid ZA T&D losses', 'Grid ZA T&D losses', 'td_loss')`);
});

test.after(async () => {
  await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id IN (SELECT pk_id FROM emission WHERE site_id = ${SITE} AND date_of_reporting = '2025-02-28')`);
  await q(`DELETE FROM emission WHERE site_id = ${SITE} AND date_of_reporting = '2025-02-28'`);
  await q(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1) OR emission_factor_id = ANY($2)`, [FACTORS, madeIds]);
  await q(`DELETE FROM site_categories WHERE site_id = ${SITE} AND category_id IN (${ELEC}, ${FERA})`);
});

const entry = () =>
  call("POST", "/user/emissions", "otherUser", {
    site_id: SITE,
    category_id: ELEC,
    date_of_reporting: "2025-02-28",
    activity_data_unit: "kwh",
    activity_data: { emission_category: "Grid ZA", activity_value: "100000" },
  });

test("a T&D-loss factor named apart from the activity gives no 3c twin", async () => {
  const res = await entry();
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(Number(res.json.fera_emission.total_emission), 10); // 100,000 kWh × 0.1 kg (3b)
  assert.equal(res.json.td_loss_emission, undefined);
  await q(`DELETE FROM emission WHERE site_id = ${SITE} AND date_of_reporting = '2025-02-28'`);
});

test("an edit sets the global name, and the next entry gets its T&D-loss twin", async () => {
  const r = await put(953, { global_category_name: "  Grid ZA " });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(await factor(953), { name: "Grid ZA T&D losses", global: "Grid ZA" });
  const res = await entry();
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.td_loss_emission.scope3_sub, "3c_td_losses");
  assert.equal(Number(res.json.td_loss_emission.total_emission), 6); // × 0.06 kg
  assert.equal(Number(res.json.fera_emission.total_emission), 10, "the upstream twin still uses the wtt factor");
});

test("a rename carries a global name that was the factor's own; a global name set apart stays", async () => {
  let r = await put(952, { emission_category_name: "Grid ZA upstream" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(await factor(952), { name: "Grid ZA upstream", global: "Grid ZA upstream" });
  r = await put(953, { emission_category_name: "Grid ZA losses" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(await factor(953), { name: "Grid ZA losses", global: "Grid ZA" });
  // An empty global name clears it.
  r = await put(953, { global_category_name: "" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(await factor(953), { name: "Grid ZA losses", global: null });
});

test("create takes a global name; only a Superadmin sets it", async () => {
  const r = await call("POST", "/admin/emission-factors", "superadmin", {
    site_id: SITE,
    category_id: FERA,
    year: 2023,
    factor_value: 0.05,
    denominator_unit: "kwh",
    source: "CI",
    emission_category_name: "Grid ZA T&D losses",
    global_category_name: "Grid ZA",
    factor_type: "td_loss",
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.emissionFactor.emission_factor_id;
  madeIds.push(id);
  assert.deepEqual(await factor(id), { name: "Grid ZA T&D losses", global: "Grid ZA" });
  const denied = await call("PUT", `/admin/emission-factors/${id}`, "otherUser", { global_category_name: "Grid XX" });
  assert.ok(denied.status === 401 || denied.status === 403, String(denied.status));
  assert.deepEqual(await factor(id), { name: "Grid ZA T&D losses", global: "Grid ZA" });
});
