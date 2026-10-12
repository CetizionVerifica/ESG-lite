// IM3: GET /imports/context, /imports/context/activities and /imports/readiness
// tell an import client (Claude via MCP, or the Bulk upload page) which sites and
// categories a caller may import into, what each form needs, which activity
// names exist and what is missing. Scoped exactly like the app; a company 2
// token never sees company 1 data (audit MCP-07, MCP-08, MCP-20).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
// Responses must match the IM0 contracts (built to dist/ by ci/api/run.cjs).
const { ImportContextSchema, ActivityOptionSchema, ReadinessCellSchema } = require(path.resolve(__dirname, "../../../dist/imports/contracts.js"));
const { z } = require("zod");
const conforms = (schema, value) => {
  const r = schema.safeParse(value);
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues));
};

const CFG = [9301, 9302, 9303, 9304];
const COL = [9301, 9302];
const FACTOR_BATCH = "ci-im3-factors";
const MAP_PREFIX = "CI IM3";

async function seed() {
  await withDb(async (db) => {
    await cleanup(db);
    // Forms: site 1 × Stationary Combustion (a Fuel dropdown + quantity), site 1 ×
    // Purchased Electricity, site 2 × Stationary Combustion, site 3 (company 2) ×
    // Stationary Combustion. Site 1 × Business Travel has no form and no factor.
    await db.query(`INSERT INTO column_entity (pk_id, column_name, column_type) VALUES ($1, 'Fuel', 'select'), ($2, 'Quantity', 'number')`, COL);
    await db.query(
      `INSERT INTO column_config (pk_id, config_name, site_id, category_id, column_options, extra_fields) VALUES
         ($1, 'CI IM3 fuel', 1, 1, $5::jsonb, '[{"key":"invoice_no","label":"Invoice no.","type":"text","required":false}]'::jsonb),
         ($2, 'CI IM3 grid', 1, 2, '{}'::jsonb, '[]'::jsonb),
         ($3, 'CI IM3 fuel B', 2, 1, '{}'::jsonb, '[]'::jsonb),
         ($4, 'CI IM3 other', 3, 1, '{}'::jsonb, '[]'::jsonb)`,
      [...CFG, JSON.stringify({ [String(COL[0])]: [{ id: "diesel", label: "Diesel" }, { id: "petrol", label: "Petrol" }] })],
    );
    await db.query(`INSERT INTO column_config_columns (column_config_id, column_id) VALUES ($1, $2), ($1, $3)`, [CFG[0], COL[0], COL[1]]);
    await db.query(
      `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, upload_batch_id) VALUES
         (1, 1, 2024, 2.68, 'L', 'CI', 'Diesel', 'Diesel (stationary)', $1),
         (1, 1, 2023, 2.60, 'litre', 'CI', 'Diesel', NULL, $1),
         (1, 1, 2024, 2.31, 'L', 'CI', 'Petrol', NULL, $1),
         (1, 2, 2024, 0.71, 'kWh', 'CI', 'Grid electricity', NULL, $1),
         (2, 1, 2024, 2.68, 'L', 'CI', 'Diesel', NULL, $1),
         (3, 1, 2024, 2.68, 'L', 'CI', 'Other Diesel', NULL, $1)`,
      [FACTOR_BATCH],
    );
    await db.query(
      `INSERT INTO emission_category_mapping (company_id, company_name, site_id, category_id, company_category_name, global_category_name) VALUES
         (1, 'CI Steel Co', NULL, 1, $1 || ' HSD', 'Diesel'),
         (2, 'CI Other Co', NULL, 1, $1 || ' C2 Fuel', 'Other Diesel')`,
      [MAP_PREFIX],
    );
    await db.query(`INSERT INTO unit (unit_name, description, site_id, category_id) VALUES ('kg', 'CI IM3', 1, 1)`);
  });
}

async function cleanup(db) {
  await db.query(`DELETE FROM column_config WHERE pk_id = ANY($1::int[])`, [CFG]);
  await db.query(`DELETE FROM column_entity WHERE pk_id = ANY($1::int[])`, [COL]);
  await db.query(`DELETE FROM emission_factors WHERE upload_batch_id = $1`, [FACTOR_BATCH]);
  await db.query(`DELETE FROM emission_category_mapping WHERE company_category_name LIKE $1`, [`${MAP_PREFIX}%`]);
  await db.query(`DELETE FROM unit WHERE description = 'CI IM3'`);
}

test.before(seed);
test.after(() => withDb(cleanup));

const context = (who, q = "") => call("GET", `/imports/context${q}`, who);
const activities = (who, q) => call("GET", `/imports/context/activities?${q}`, who);
const readiness = (who, q = "") => call("GET", `/imports/readiness${q}`, who);
const siteIds = (res) => res.json.sites.map((s) => s.site_id).sort((a, b) => a - b);
const categoryIds = (res, site_id) => res.json.sites.find((s) => s.site_id === site_id).categories.map((c) => c.category_id).sort((a, b) => a - b);
const category = (res, site_id, category_id) => res.json.sites.find((s) => s.site_id === site_id).categories.find((c) => c.category_id === category_id);

test("needs a token", async () => {
  assert.equal((await context()).status, 401);
  assert.equal((await activities(null, "site_id=1&category_id=1")).status, 401);
  assert.equal((await readiness()).status, 401);
});

test("Superadmin must name the client", async () => {
  const res = await context("superadmin");
  assert.equal(res.status, 400);
  assert.equal(res.json.code, "IMPORT_COMPANY_REQUIRED");
  assert.equal((await readiness("superadmin", "?year=2025")).json.code, "IMPORT_COMPANY_REQUIRED");
  const bad = await context("superadmin", "?company_id=abc");
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "IMPORT_VALIDATION");
  assert.equal((await readiness("superadmin", "?company_id=1")).json.code, "IMPORT_VALIDATION"); // year is required
});

test("Superadmin sees every site and category of the named client", async () => {
  const res = await context("superadmin", "?company_id=1");
  assert.equal(res.status, 200, JSON.stringify(res.json));
  conforms(ImportContextSchema, res.json);
  assert.equal(res.json.company.company_id, 1);
  assert.equal(res.json.company.name, "CI Steel Co");
  assert.equal(res.json.company.mcp_enabled, false);
  assert.equal(res.json.role, "Superadmin");
  assert.equal(res.json.fy_start_month, 4);
  assert.deepEqual(siteIds(res), [1, 2]);
  assert.deepEqual(categoryIds(res, 1), [1, 2, 3, 4, 5]);
  assert.deepEqual(categoryIds(res, 2), [1, 2]);

  const fuel = category(res, 1, 1);
  assert.equal(fuel.name, "Stationary Combustion");
  assert.equal(fuel.scope, "Scope 1");
  assert.deepEqual(fuel.period_modes, ["monthly", "yearly"]);
  assert.equal(fuel.form.calc_mode, "single");
  const fuelField = fuel.form.fields.find((f) => f.key === "Fuel");
  assert.deepEqual(fuelField.options, ["Diesel", "Petrol"]);
  assert.equal(fuelField.type, "select");
  assert.ok(fuel.form.fields.some((f) => f.key === "Quantity" && f.type === "number"));
  const extra = fuel.form.fields.find((f) => f.key === "invoice_no");
  assert.equal(extra.required, false);
  assert.deepEqual(fuel.units, ["kg", "L", "litre"]);
  assert.equal(fuel.activity_count, 4); // Diesel, Diesel (stationary), Petrol + the HSD mapping
  assert.deepEqual(fuel.readiness, { form: true, factor_years: [2023, 2024] });

  const travel = category(res, 1, 3);
  assert.equal(travel.form, null);
  assert.deepEqual(travel.readiness, { form: false, factor_years: [] });
  assert.equal(travel.activity_count, 0);
  assert.equal(category(res, 1, 4).scope, null);
});

test("each role sees exactly its sites and categories", async () => {
  const user = await context("user");
  assert.equal(user.status, 200);
  assert.equal(user.json.company.company_id, 1);
  assert.deepEqual(siteIds(user), [1]);
  assert.deepEqual(categoryIds(user, 1), [1, 2, 3, 4, 5]);

  const granted = await context("multiSiteUser");
  assert.deepEqual(siteIds(granted), [1, 2]);
  assert.deepEqual(categoryIds(granted, 1), [1, 2]); // only the granted categories
  assert.deepEqual(categoryIds(granted, 2), [1, 2]);

  assert.deepEqual(siteIds(await context("manager")), [1, 2]);
  assert.deepEqual(siteIds(await context("admin")), [1, 2]);
  assert.equal((await context("admin")).json.role, "Admin");

  const other = await context("otherUser");
  assert.equal(other.json.company.company_id, 2);
  assert.deepEqual(siteIds(other), [3]);
  assert.deepEqual(siteIds(await context("otherManager")), [3]);
});

test("a company 2 token gets nothing of company 1", async () => {
  for (const who of ["otherUser", "otherManager"]) {
    const res = await context(who, "?company_id=1");
    assert.equal(res.status, 403, who);
    assert.equal(res.json.code, "IMPORT_FORBIDDEN");
    const search = await activities(who, "site_id=1&category_id=1");
    assert.equal(search.status, 403, who);
    assert.equal(search.json.code, "IMPORT_FORBIDDEN");
    assert.equal((await readiness(who, "?company_id=1&year=2025")).status, 403);
  }
  assert.equal((await context("admin", "?company_id=2")).status, 403);
  // Mappings stay with their client (rule F-08).
  const ours = await activities("superadmin", "site_id=1&category_id=1&company_id=1");
  assert.ok(!ours.json.some((a) => a.name.includes("C2 Fuel")));
  const theirs = await activities("otherManager", "site_id=3&category_id=1");
  assert.equal(theirs.status, 200);
  assert.deepEqual(theirs.json.map((a) => a.name), [`${MAP_PREFIX} C2 Fuel`, "Other Diesel"]);
  assert.ok(!theirs.json.some((a) => a.name.includes("HSD")));
});

test("activities search ranks exact, prefix, contains and limits", async () => {
  const all = await activities("manager", "site_id=1&category_id=1");
  assert.equal(all.status, 200, JSON.stringify(all.json));
  conforms(z.array(ActivityOptionSchema), all.json);
  assert.deepEqual(all.json.map((a) => a.name), [`${MAP_PREFIX} HSD`, "Diesel", "Diesel (stationary)", "Petrol"]);
  const hsd = all.json[0];
  assert.equal(hsd.kind, "mapping");
  assert.equal(hsd.maps_to, "Diesel");
  assert.deepEqual(hsd.units, ["L", "litre"]);
  assert.equal(hsd.latest_year, 2024);
  const diesel = all.json[1];
  assert.equal(diesel.kind, "factor");
  assert.deepEqual(diesel.units, ["L", "litre"]);
  assert.equal(diesel.latest_year, 2024);

  const q = await activities("manager", "site_id=1&category_id=1&q=DIESEL");
  assert.deepEqual(q.json.map((a) => a.name), ["Diesel", "Diesel (stationary)"]);
  const contains = await activities("manager", "site_id=1&category_id=1&q=sel");
  assert.deepEqual(contains.json.map((a) => a.name), ["Diesel", "Diesel (stationary)"]);
  assert.deepEqual((await activities("manager", "site_id=1&category_id=1&q=hsd")).json.map((a) => a.name), [`${MAP_PREFIX} HSD`]);
  assert.deepEqual((await activities("manager", "site_id=1&category_id=1&q=zzz")).json, []);
  assert.equal((await activities("manager", "site_id=1&category_id=1&limit=2")).json.length, 2);
  const zero = await activities("manager", "site_id=1&category_id=1&limit=0");
  assert.equal(zero.status, 400);
  assert.equal(zero.json.code, "IMPORT_VALIDATION");
  assert.equal((await activities("manager", "site_id=1")).status, 400);
  assert.equal((await activities("manager", "site_id=1&category_id=1&limit=200")).status, 200); // capped at 50, not refused
  // Superadmin may leave company_id out: the site names the client.
  const sa = await activities("superadmin", "site_id=2&category_id=1");
  assert.equal(sa.status, 200);
  assert.deepEqual(sa.json.map((a) => a.name), [`${MAP_PREFIX} HSD`, "Diesel"]);
  // A category the site is not assigned, or a User's ungranted category, is refused.
  assert.equal((await activities("superadmin", "site_id=2&category_id=3")).status, 403);
  assert.equal((await activities("multiSiteUser", "site_id=1&category_id=3")).status, 403);
});

test("readiness flags a missing form or factor with the page that fixes it", async () => {
  const res = await readiness("superadmin", "?company_id=1&year=2025");
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.company_id, 1);
  assert.equal(res.json.year, 2025);
  conforms(z.array(ReadinessCellSchema), res.json.cells);
  const cell = (s, c) => res.json.cells.find((x) => x.site_id === s && x.category_id === c);
  assert.equal(res.json.cells.length, 7);

  const fuel = cell(1, 1);
  assert.equal(fuel.ready, true);
  assert.equal(fuel.lookup_year, 2024);
  assert.equal(fuel.factor_for_year, true);
  assert.deepEqual(fuel.missing, []);

  const travel = cell(1, 3);
  assert.equal(travel.ready, false);
  assert.deepEqual(travel.missing.map((m) => m.what), ["form", "factor"]);
  assert.match(travel.missing[0].fix_page, /\/capture\/forms\?site=1&category=3$/);
  assert.match(travel.missing[1].fix_page, /\/factors\?client=1&site=1&category=3$/);

  const gridB = cell(2, 2); // site 2 × Purchased Electricity: neither form nor factor
  assert.equal(gridB.ready, false);
  assert.equal(res.json.gaps, res.json.cells.filter((c) => !c.ready).length);
  assert.ok(res.json.gaps >= 4);

  // A year with no factor of its own is still importable (the newest factor is used), but says so.
  const later = await readiness("superadmin", "?company_id=1&year=2027");
  const fuelLater = later.json.cells.find((x) => x.site_id === 1 && x.category_id === 1);
  assert.equal(fuelLater.ready, true);
  assert.equal(fuelLater.factor_for_year, false);
  assert.deepEqual(fuelLater.missing.map((m) => m.what), ["factor_for_year"]);
  assert.match(fuelLater.missing[0].fix_page, /\/factors\?client=1&site=1&category=1$/);

  assert.equal((await readiness("superadmin", "?company_id=1&year=99")).status, 400);
  // A User's readiness covers only their sites and granted categories.
  const mine = await readiness("multiSiteUser", "?year=2025");
  assert.equal(mine.status, 200);
  assert.deepEqual([...new Set(mine.json.cells.map((c) => c.category_id))].sort(), [1, 2]);
});
