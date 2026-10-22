// #183 U1-BE: GET /user/units/site/:siteId/category/:categoryId/by-activity
// (and the Superadmin twin under /admin) lists, per emission category, the
// units a row may use. Site scope, tenant isolation and the category
// assignment are checked like the other unit and import-context reads.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const CFG = 18301;
const FACTOR_BATCH = "ci-u183-factors";
const TAG = "CI U183";

async function cleanup(db) {
  await db.query(`DELETE FROM column_config WHERE pk_id = $1`, [CFG]);
  await db.query(`DELETE FROM emission_factors WHERE upload_batch_id = $1`, [FACTOR_BATCH]);
  await db.query(`DELETE FROM emission_category_mapping WHERE company_category_name LIKE $1`, [`${TAG}%`]);
  await db.query(`DELETE FROM unit WHERE description = $1`, [TAG]);
}

test.before(() =>
  withDb(async (db) => {
    await cleanup(db);
    await db.query(
      `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, upload_batch_id) VALUES
         (1, 1, 2024, 2.68, 'litre', 'CI', 'Diesel', 'Diesel (avg biofuel blend)', $1),
         (1, 1, 2024, 2.02, 'cubic meter', 'CI', 'Natural gas', NULL, $1),
         (1, 2, 2024, 0.71, 'kWh', 'CI', 'Grid electricity', NULL, $1),
         (3, 1, 2024, 2.68, 'litre', 'CI', 'Other Diesel', NULL, $1)`,
      [FACTOR_BATCH],
    );
    await db.query(
      `INSERT INTO unit (unit_name, description, site_id, category_id) VALUES
         ('litre', $1, 1, 1), ('kWh', $1, 1, 1), ('SCM', $1, 1, 1), ('kg', $1, 1, 1),
         ('kWh', $1, 1, 2), ('MWh', $1, 1, 2), ('litre', $1, 1, 2)`,
      [TAG],
    );
    await db.query(
      `INSERT INTO emission_category_mapping (company_id, company_name, site_id, category_id, company_category_name, global_category_name)
         VALUES (1, 'CI Steel Co', NULL, 1, $1 || ' HSD', 'Diesel')`,
      [TAG],
    );
    // Site 1 × Purchased Electricity fixes the unit (SE-2 form.units.fixed).
    await db.query(
      // A mapped form whose choice maps to the factor's own name, as the auto-generated forms do.
      `INSERT INTO column_config (pk_id, config_name, site_id, category_id, column_options, column_dependencies, dependent_options, extra_fields, units, emission_category_mapping)
         VALUES ($1, 'CI U183 grid', 1, 2, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '{"fixed": "MWh"}'::jsonb, '{"Grid electricity": "Grid electricity"}'::jsonb)`,
      [CFG],
    );
  }),
);
test.after(() => withDb(cleanup));

const options = (who, site, category, prefix = "/user") => call("GET", `${prefix}/units/site/${site}/category/${category}/by-activity`, who);
const sameUnits = (actual, expected) => assert.deepEqual([actual[0], ...actual.slice(1).sort()], [expected[0], ...expected.slice(1).sort()]);

test("a User gets each emission category's units, the factor unit first", async () => {
  const res = await options("user", 1, 1);
  assert.equal(res.status, 200);
  const byName = Object.fromEntries(res.json.activities.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName).sort(), ["CI U183 HSD", "Diesel", "Diesel (avg biofuel blend)", "Natural gas"]);

  assert.equal(byName.Diesel.factor_unit, "litre");
  // SCM is a cubic metre, which converts to litres; kWh and kg don't. kl, gallon and ml come from the
  // engine's conversion table though no admin unit row names them (#183 follow-up).
  sameUnits(byName.Diesel.units, ["litre", "SCM", "kl", "gallon", "ml"]);
  assert.deepEqual(byName["Diesel (avg biofuel blend)"].units, byName.Diesel.units);
  // Natural gas is per cubic metre: the admin's "SCM" is that unit, so it comes first.
  assert.equal(byName["Natural gas"].factor_unit, "cubic meter");
  sameUnits(byName["Natural gas"].units, ["SCM", "litre", "kl", "gallon", "ml"]);
  // The alias resolves to its factor, as the engine does on save.
  assert.equal(byName["CI U183 HSD"].maps_to, "Diesel");
  assert.deepEqual(byName["CI U183 HSD"].units, byName.Diesel.units);

  assert.equal(res.json.fixed_unit, null);
  assert.deepEqual([...res.json.all_units].sort(), ["SCM", "kWh", "kg", "litre"]);
});

test("a form with a fixed unit offers only that unit", async () => {
  const res = await options("manager", 1, 2);
  assert.equal(res.status, 200);
  assert.equal(res.json.fixed_unit, "MWh");
  assert.deepEqual(res.json.activities.map((a) => [a.name, a.factor_unit, a.units]), [["Grid electricity", "kWh", ["MWh"]]]);
});

test("site scope: another site of the same company is refused to a User without it", async () => {
  assert.equal((await options("user", 2, 1)).status, 403);
  assert.equal((await options("multiSiteUser", 2, 1)).status, 200);
});

test("tenant isolation: a company 2 token can't read company 1's lists, nor company 1 company 2's", async () => {
  assert.equal((await options("otherUser", 1, 1)).status, 403);
  assert.equal((await options("otherManager", 1, 1)).status, 403);
  assert.equal((await options("user", 3, 1)).status, 403);
  const own = await options("otherUser", 3, 1);
  assert.equal(own.status, 200);
  assert.deepEqual(own.json.activities.map((a) => a.name), ["Other Diesel"]);
});

test("a category the site doesn't report is refused; an unknown site is not found", async () => {
  assert.equal((await options("multiSiteUser", 2, 3)).status, 403);
  assert.equal((await options("superadmin", 2, 3, "/admin")).status, 403);
  assert.equal((await options("superadmin", 99999, 1, "/admin")).status, 404);
});

test("the Superadmin twin under /admin returns the same lists; other roles can't use it", async () => {
  const user = await options("user", 1, 1);
  const admin = await options("superadmin", 1, 1, "/admin");
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.json, user.json);
  assert.equal((await options("manager", 1, 1, "/admin")).status, 403);
  assert.equal((await call("GET", "/user/units/site/1/category/1/by-activity")).status, 401);
});

test("U3-FE: GET /admin/units/fits names what each unit fits; a unit fitting nothing has an empty list; Superadmin only", async () => {
  const res = await call("GET", "/admin/units/fits", "superadmin");
  assert.equal(res.status, 200);
  const units = await withDb((db) => db.query(`SELECT unit_id, unit_name, category_id FROM unit WHERE description = $1 AND site_id = 1`, [TAG]));
  const fitsOf = (name, category) => res.json.fits.find((f) => f.unit_id === units.rows.find((u) => u.unit_name === name && u.category_id === category).unit_id).activities.sort();
  // The alias "CI U183 HSD" resolves to Diesel and isn't listed a second time.
  assert.deepEqual(fitsOf("litre", 1), ["Diesel", "Diesel (avg biofuel blend)", "Natural gas"]);
  assert.deepEqual(fitsOf("SCM", 1), ["Diesel", "Diesel (avg biofuel blend)", "Natural gas"]);
  assert.deepEqual(fitsOf("kg", 1), []);
  assert.deepEqual(fitsOf("kWh", 1), []);
  // Site 1 × Purchased Electricity fixes MWh: only MWh fits its activity.
  assert.deepEqual(fitsOf("MWh", 2), ["Grid electricity"]);
  assert.deepEqual(fitsOf("kWh", 2), []);
  assert.equal((await call("GET", "/admin/units/fits", "manager")).status, 403);
});
