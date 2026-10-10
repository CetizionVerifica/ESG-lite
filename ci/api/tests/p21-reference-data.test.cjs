// P21 Reference data (Superadmin: countries, categories, units): usage counts
// on the lists, replacing a category's sites, and delete guards that refuse
// to remove reference data that is still in use.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const WHO = "superadmin";

// Rows owned by this file (ids 900+), removed again in test.after so later
// test files see the plain fixture.
//   countries 900 (used by sites 900 + 901) and 901 (unused)
//   category 900: on site 900, 1 factor, 1 column config, 2 units, 3 entries
//   category 901: unused
//   category 902: only a client category mapping; 903: only an invoice
//   users 900 (site 900) and 901 (site 901) have a non-empty category grant
test.before(async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO country (country_id, name, code) VALUES
      (900, 'CI Used Land', 'XU'), (901, 'CI Unused Land', 'XN')`);
    await db.query(`INSERT INTO site (site_id, name, address, contact_person, company_id, country_id) VALUES
      (900, 'CI P21 Plant', 'Plot 900', 'CI', 2, 900),
      (901, 'CI P21 Plant Two', 'Plot 901', 'CI', 2, 900)`);
    await db.query(`INSERT INTO category (category_id, category_name, scope) VALUES
      (900, 'CI P21 Fuel', 'Scope 1'), (901, 'CI P21 Unused', NULL),
      (902, 'CI P21 Mapped', 'Scope 3'), (903, 'CI P21 Invoiced', 'Scope 2')`);
    await db.query(`INSERT INTO emission_category_mapping (company_id, company_name, category_id, company_category_name, global_category_name)
      VALUES (2, 'CI client', 902, 'CI local name', 'CI P21 Mapped')`);
    await db.query(`INSERT INTO invoice (invoice_id, file_name, cloudinary_url, cloudinary_public_id, category_id)
      VALUES (900, 'ci-p21.pdf', 'https://res.cloudinary.example.invalid/raw/upload/ci-p21.pdf', 'ci-p21', 903)`);
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (900, 900), (900, 1), (901, 1)`);
    await db.query(`INSERT INTO "user" (user_id, name, email, password, role, site_id) VALUES
      (900, 'CI P21 User', 'ci-p21-a@example.invalid', 'x', 'User', 900),
      (901, 'CI P21 User Two', 'ci-p21-b@example.invalid', 'x', 'User', 901)`);
    await db.query(`INSERT INTO user_categories (user_id, category_id) VALUES (900, 1), (900, 900), (901, 1)`);
    await db.query(`INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name)
      VALUES (900, 900, 2025, 2.5, 'kWh', 'CI', 'CI Fuel')`);
    await db.query(`INSERT INTO column_config (config_name, site_id, category_id) VALUES ('CI P21 config', 900, 900)`);
    await db.query(`INSERT INTO unit (unit_id, unit_name, description, site_id, category_id) VALUES
      (900, 'kWh', NULL, 900, 900), (901, 'litre', NULL, 900, 900)`);
    await db.query(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, activity_data_unit, date_of_reporting, status, created_by, category_id, site_id) VALUES
      (900, '{"activity_value": 1}', 1.0, 'tCO2e', 'kWh',   '2025-09-30', 'approved', 4, 900, 900),
      (901, '{"activity_value": 2}', 2.0, 'tCO2e', 'kWh',   '2025-08-31', 'pending',  4, 900, 900),
      (902, '{"activity_value": 3}', 3.0, 'tCO2e', 'litre', '2025-08-31', 'pending',  4, 900, 900),
      (903, '{"activity_value": 4}', 4.0, 'tCO2e', 'kWh',   '2025-08-31', 'pending',  4, 900, 901)`);
  });
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query(`DELETE FROM invoice WHERE invoice_id = 900`);
    await db.query(`DELETE FROM emission_category_mapping WHERE category_id IN (900, 901, 902, 903)`);
    await db.query(`DELETE FROM emission WHERE site_id IN (900, 901) OR category_id IN (900, 901)`);
    await db.query(`DELETE FROM unit WHERE site_id IN (900, 901) OR category_id IN (900, 901)`);
    await db.query(`DELETE FROM column_config WHERE site_id IN (900, 901) OR category_id IN (900, 901)`);
    await db.query(`DELETE FROM emission_factors WHERE site_id IN (900, 901) OR category_id IN (900, 901)`);
    await db.query(`DELETE FROM user_categories WHERE user_id IN (900, 901) OR category_id IN (900, 901)`);
    await db.query(`DELETE FROM "user" WHERE user_id IN (900, 901)`);
    await db.query(`DELETE FROM site_categories WHERE site_id IN (900, 901) OR category_id IN (900, 901)`);
    await db.query(`DELETE FROM site WHERE site_id IN (900, 901)`);
    await db.query(`DELETE FROM category WHERE category_id IN (900, 901, 902, 903)`);
    await db.query(`DELETE FROM country WHERE country_id IN (900, 901)`);
  });
});

const byId = (rows, key, id) => rows.find((r) => r[key] === id);

test("GET /admin/categories carries sites and usage counts", async () => {
  const res = await call("GET", "/admin/categories", WHO);
  assert.equal(res.status, 200);
  const fuel = byId(res.json, "category_id", 900);
  assert.deepEqual(fuel.sites.map((s) => s.site_id), [900]);
  assert.equal(fuel.factor_count, 1);
  assert.equal(fuel.config_count, 1);
  assert.equal(fuel.unit_count, 2);
  assert.equal(fuel.entry_count, 4);
  const unused = byId(res.json, "category_id", 901);
  assert.deepEqual(
    [unused.factor_count, unused.config_count, unused.unit_count, unused.entry_count, unused.sites.length],
    [0, 0, 0, 0, 0]
  );
  // Fixture category 1 (Stationary Combustion) has 5 emissions.
  assert.equal(byId(res.json, "category_id", 1).entry_count, 5);
});

test("GET /admin/countries carries site_count", async () => {
  const res = await call("GET", "/admin/countries", WHO);
  assert.equal(res.status, 200);
  assert.equal(byId(res.json, "country_id", 900).site_count, 2);
  assert.equal(byId(res.json, "country_id", 901).site_count, 0);
});

test("GET /admin/units carries entry_count per site, category and activity unit", async () => {
  const res = await call("GET", "/admin/units", WHO);
  assert.equal(res.status, 200);
  // Emission 903 uses kWh on site 901, so it does not count for unit 900 (site 900).
  assert.equal(byId(res.json, "unit_id", 900).entry_count, 2);
  assert.equal(byId(res.json, "unit_id", 901).entry_count, 1);
  assert.equal(byId(res.json, "unit_id", 900).site.site_id, 900);
});

test("PUT /admin/units/:id runs the duplicate check against the target site and category", async () => {
  const created = await call("POST", "/admin/units", WHO, { unit_name: "kWh", site_id: 901, category_id: 900 });
  assert.equal(created.status, 201);
  const id = created.json.unit.unit_id;
  const moved = await call("PUT", `/admin/units/${id}`, WHO, { site_id: 900 });
  assert.equal(moved.status, 400);
  assert.match(moved.json.message, /already exists/);
  const renamed = await call("PUT", `/admin/units/${id}`, WHO, { unit_name: "litre", site_id: 900 });
  assert.equal(renamed.status, 400);
  const ok = await call("PUT", `/admin/units/${id}`, WHO, { unit_name: "MWh", site_id: 900 });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.unit.unit_name, "MWh");
  assert.equal(ok.json.unit.site.site_id, 900);
  assert.equal((await call("DELETE", `/admin/units/${id}`, WHO)).status, 200);
});

test("PUT /admin/categories/:id site_ids replaces the sites, keeps data and grants new site users", async () => {
  const missing = await call("PUT", "/admin/categories/900", WHO, { site_ids: [901, 999999] });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.message, "One or more sites not found");
  assert.equal((await call("PUT", "/admin/categories/900", WHO, { site_ids: "901" })).status, 400);

  // site_ids alone is a valid update: add 901, remove 900.
  const res = await call("PUT", "/admin/categories/900", WHO, { site_ids: [901] });
  assert.equal(res.status, 200);
  assert.equal(res.json.message, "Category updated successfully");
  assert.equal(res.json.category.category_id, 900);
  assert.equal(res.json.category.category_name, "CI P21 Fuel");
  assert.deepEqual(res.json.category.sites.map((s) => s.site_id), [901]);

  await withDb(async (db) => {
    const links = await db.query(`SELECT site_id FROM site_categories WHERE category_id = 900 ORDER BY site_id`);
    assert.deepEqual(links.rows.map((r) => r.site_id), [901]);
    // Entries, factors, configs, units and grants on the unlinked site are kept.
    const kept = await db.query(`SELECT
      (SELECT COUNT(*) FROM emission WHERE category_id = 900)::int AS entries,
      (SELECT COUNT(*) FROM emission_factors WHERE category_id = 900)::int AS factors,
      (SELECT COUNT(*) FROM column_config WHERE category_id = 900)::int AS configs,
      (SELECT COUNT(*) FROM unit WHERE category_id = 900)::int AS units`);
    assert.deepEqual(kept.rows[0], { entries: 4, factors: 1, configs: 1, units: 2 });
    const grants = await db.query(
      `SELECT user_id, category_id FROM user_categories WHERE user_id IN (900, 901) ORDER BY user_id, category_id`
    );
    assert.deepEqual(
      grants.rows.map((r) => `${r.user_id}:${r.category_id}`),
      ["900:1", "900:900", "901:1", "901:900"]
    );
    // Other categories on the sites are untouched.
    const others = await db.query(`SELECT COUNT(*)::int AS n FROM site_categories WHERE category_id = 1 AND site_id IN (900, 901)`);
    assert.equal(others.rows[0].n, 2);
  });

  // Name and sites together; an empty list unlinks every site.
  const both = await call("PUT", "/admin/categories/900", WHO, { category_name: "CI P21 Fuel ", site_ids: [900, 901] });
  assert.equal(both.status, 200);
  assert.deepEqual(both.json.category.sites.map((s) => s.site_id).sort(), [900, 901]);
  const none = await call("PUT", "/admin/categories/901", WHO, { site_ids: [] });
  assert.equal(none.status, 200);
  assert.deepEqual(none.json.category.sites, []);

  // Nothing to update is still rejected.
  assert.equal((await call("PUT", "/admin/categories/900", WHO, {})).status, 400);
});

test("DELETE /admin/countries/:id refuses a country sites use", async () => {
  const used = await call("DELETE", "/admin/countries/900", WHO);
  assert.equal(used.status, 409);
  assert.equal(used.json.message, "2 site(s) use this country. Move them to another country first.");
  const unused = await call("DELETE", "/admin/countries/901", WHO);
  assert.equal(unused.status, 200);
  await withDb(async (db) => {
    const left = await db.query(`SELECT country_id FROM country WHERE country_id IN (900, 901)`);
    assert.deepEqual(left.rows.map((r) => r.country_id), [900]);
  });
});

test("DELETE /admin/categories/:id deletes only a category nothing uses", async () => {
  const used = await call("DELETE", "/admin/categories/900", WHO);
  assert.equal(used.status, 409);
  assert.deepEqual(used.json.in_use, { sites: 2, entries: 4, factors: 1, configs: 1, units: 2, mappings: 0, invoices: 0 });
  assert.match(used.json.message, /^This category is still in use: /);

  // force=true no longer bypasses the check.
  assert.equal((await call("DELETE", "/admin/categories/900?force=true", WHO)).status, 409);
  assert.equal((await call("DELETE", "/admin/categories/900", WHO, { force: true })).status, 409);

  // Mappings and invoices have no cascading FK, so they count as use too.
  const mapped = await call("DELETE", "/admin/categories/902", WHO);
  assert.equal(mapped.status, 409);
  assert.equal(mapped.json.in_use.mappings, 1);
  assert.match(mapped.json.message, /1 client category mappings/);
  const invoiced = await call("DELETE", "/admin/categories/903", WHO);
  assert.equal(invoiced.status, 409);
  assert.equal(invoiced.json.in_use.invoices, 1);

  // Fixture category 1 is used by fixture data and stays.
  assert.equal((await call("DELETE", "/admin/categories/1", WHO)).status, 409);

  const unused = await call("DELETE", "/admin/categories/901", WHO);
  assert.equal(unused.status, 200);
  await withDb(async (db) => {
    const left = await db.query(`SELECT category_id FROM category WHERE category_id IN (900, 901, 902, 903) ORDER BY 1`);
    assert.deepEqual(left.rows.map((r) => r.category_id), [900, 902, 903]);
    const n = await db.query(`SELECT COUNT(*)::int AS n FROM emission WHERE category_id = 900`);
    assert.equal(n.rows[0].n, 4);
  });
});

test("only the Superadmin reaches the reference data endpoints", async () => {
  for (const who of ["admin", "manager", "user"]) {
    assert.equal((await call("GET", "/admin/categories", who)).status, 403);
    assert.equal((await call("GET", "/admin/countries", who)).status, 403);
    assert.equal((await call("GET", "/admin/units", who)).status, 403);
    assert.equal((await call("PUT", "/admin/categories/1", who, { site_ids: [1] })).status, 403);
    assert.equal((await call("DELETE", "/admin/countries/1", who)).status, 403);
    assert.equal((await call("DELETE", "/admin/categories/1", who)).status, 403);
  }
  assert.equal((await call("GET", "/admin/categories", null)).status, 401);
});
