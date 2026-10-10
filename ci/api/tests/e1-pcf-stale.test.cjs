// E1 part 5: footprints go stale when the approved plant data behind them changes.
// Site 2 in 2022, cleaned up afterwards so other tests' months stay untouched.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const ids = { products: [], emissions: [], production: [] };
let rod, alu, used, laterSite2, site1, partialFy, otherProduction;

const staleOf = async (id) => (await call("GET", `/pcf/studies/${id}`, "manager")).json.stale;
const staleNotes = () =>
  withDb(async (db) => (await db.query("SELECT message FROM notification WHERE user_id = 2 AND type = 'pcf_stale' ORDER BY id")).rows.map((r) => r.message));

async function approvedStudy(body) {
  const id = (await call("POST", "/pcf/studies", "manager", body)).json.pcf_study_id;
  if (!body.copy_from_id) {
    await call("PUT", `/pcf/studies/${id}/inputs`, "manager", {
      inputs: [{ stage: "A1", name: "Aluminium", unit: "kg", quantity: 1, material_factor_id: alu }],
    });
  }
  assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${id}/submit`, "manager")).status, 200);
  return id;
}

test.before(async () => {
  await withDb(async (db) => {
    const p = await db.query(
      `INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg) VALUES
         ('Stale rod', 't', 2, 'kg', 1, 1), ('Stale other', 't', 2, NULL, NULL, NULL) RETURNING product_id`,
    );
    ids.products = p.rows.map((r) => r.product_id);
    rod = ids.products[0];
    const pr = await db.query(
      `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES
         ($1, 2, 100, 't', '2022-01-01', '2022-12-31', 'approved', 7),
         ($2, 2, 300, 't', '2022-01-01', '2022-12-31', 'pending', 7)
       RETURNING production_id`,
      ids.products,
    );
    ids.production = pr.rows.map((r) => r.production_id);
    otherProduction = ids.production[1];
    const em = await db.query(
      `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, upload_batch_id) VALUES
         ('{}', 1000, 'tCO2e', '2022-06-30', 'approved', 7, 1, 2, 'monthly', 'pcf-stale-batch'),
         ('{}', 500,  'tCO2e', '2022-07-31', 'pending',  7, 1, 2, 'monthly', NULL),
         ('{}', 40,   'tCO2e', '2022-07-31', 'pending',  1, 1, 1, 'monthly', NULL),
         ('{}', 900,  'tCO2e', '2022-03-31', 'pending',  7, 2, 2, 'yearly',  NULL)
       RETURNING pk_id`,
    );
    ids.emissions = em.rows.map((r) => r.pk_id);
    [used, laterSite2, site1, partialFy] = ids.emissions;
  });
  alu = (await call("POST", "/pcf/material-factors", "manager", { name: "Stale alu", material_group: "aluminium", unit: "kg", value_kgco2e: 8.6 })).json.material_factor_id;
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query("DELETE FROM pcf_study WHERE product_id = ANY($1)", [ids.products]);
    await db.query("DELETE FROM emission WHERE pk_id = ANY($1)", [ids.emissions]);
    await db.query("DELETE FROM production_data WHERE production_id = ANY($1)", [ids.production]);
    await db.query("DELETE FROM product WHERE product_id = ANY($1)", [ids.products]);
    await db.query("DELETE FROM material_factor WHERE material_factor_id = $1", [alu]);
    await db.query("DELETE FROM notification WHERE type = 'pcf_stale'");
  });
});

test("approving new plant data at the site in the period makes an approved footprint stale", async () => {
  const v1 = await approvedStudy({ product_id: rod, reference_start: "2022-01-01", reference_end: "2022-12-31" });
  assert.equal((await call("POST", `/pcf/studies/${v1}/approve`, "superadmin")).status, 200);
  assert.equal(await staleOf(v1), false);

  // Another site's data changes nothing.
  assert.equal((await call("PUT", `/user/emissions/${site1}/approve`, "manager", {})).status, 200);
  assert.equal(await staleOf(v1), false);
  // Nor does a yearly batch only partly inside the period (the calculation never uses it).
  assert.equal((await call("PUT", `/user/emissions/${partialFy}/approve`, "manager", {})).status, 200);
  assert.equal(await staleOf(v1), false);
  // It would block recalculating a CY 2022 version, so take it out again.
  await withDb((db) => db.query("DELETE FROM emission WHERE pk_id = $1", [partialFy]));

  assert.equal((await call("PUT", `/user/emissions/${laterSite2}/approve`, "manager", {})).status, 200);
  assert.equal(await staleOf(v1), true);
  const notes = await staleNotes();
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Stale rod \(version 1\)/);

  // A stale footprint can't be published; its stored figures are untouched.
  assert.equal((await call("POST", `/pcf/studies/${v1}/publish`, "manager")).status, 409);
  const before = (await call("GET", `/pcf/studies/${v1}`, "manager")).json.result.total_kg_per_unit;

  // Version 2 reads today's data and starts fresh.
  const v2 = await approvedStudy({ copy_from_id: v1 });
  assert.equal((await call("POST", `/pcf/studies/${v2}/approve`, "superadmin")).status, 200);
  assert.equal(await staleOf(v2), false);
  assert.ok((await call("GET", `/pcf/studies/${v2}`, "manager")).json.result.total_kg_per_unit > before);

  // Rejecting a row the result used (batch reject reaches approved rows) makes v2 stale too.
  assert.equal((await call("PUT", "/user/emissions/batch/pcf-stale-batch/reject", "manager", { comment: "Wrong meter" })).status, 200);
  assert.equal(await staleOf(v2), true);
  assert.equal((await staleNotes()).length, 2);
});

test("data approved during review blocks approval until the draft is recalculated", async () => {
  const v3 = await approvedStudy({ product_id: rod, reference_start: "2022-01-01", reference_end: "2022-12-31" });
  // Approving the other product's production changes the mass key's site total.
  assert.equal((await call("PUT", `/user/production-data/${otherProduction}/approve`, "manager", {})).status, 200);
  assert.equal(await staleOf(v3), true);
  assert.equal((await call("POST", `/pcf/studies/${v3}/approve`, "superadmin")).status, 409);

  assert.equal((await call("POST", `/pcf/studies/${v3}/reject`, "superadmin", { comment: "Plant data changed" })).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${v3}/submit`, "manager")).status, 409); // result is out of date
  assert.equal((await call("POST", `/pcf/studies/${v3}/calculate`, "manager", {})).status, 200);
  assert.equal(await staleOf(v3), false);
  assert.equal((await call("POST", `/pcf/studies/${v3}/submit`, "manager")).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${v3}/approve`, "superadmin")).status, 200);
});

// Site 2 in 2017: non-mass keys, category scope changes and product deletes.
test("only the product's own production counts under a non-mass key; scope changes and deletes count too", async () => {
  const made = { products: [], production: [], emissions: [], category: null };
  try {
    await withDb(async (db) => {
      made.category = (await db.query(`INSERT INTO category (category_name, scope) VALUES ('Stale 2017 fuel', 'Scope 3') RETURNING category_id`)).rows[0].category_id;
      made.products = (await db.query(
        `INSERT INTO product (name, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg) VALUES
           ('Stale17 rod', 't', 2, 'kg', 1, 1), ('Stale17 other', 't', 2, NULL, NULL, NULL), ('Stale17 gone', 't', 2, NULL, NULL, NULL)
         RETURNING product_id`,
      )).rows.map((r) => r.product_id);
      made.production = (await db.query(
        `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES
           ($1, 2, 100, 't', '2017-01-01', '2017-12-31', 'approved', 7),
           ($2, 2, 300, 't', '2017-01-01', '2017-12-31', 'pending', 7),
           ($3, 2, 100, 't', '2017-01-01', '2017-12-31', 'approved', 7)
         RETURNING production_id`, made.products,
      )).rows.map((r) => r.production_id);
      made.emissions = (await db.query(
        `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period) VALUES
           ('{}', 1000, 'tCO2e', '2017-06-30', 'approved', 7, 1, 2, 'monthly'),
           ('{}', 300,  'tCO2e', '2017-06-30', 'approved', 7, $1, 2, 'monthly')
         RETURNING pk_id`, [made.category],
      )).rows.map((r) => r.pk_id);
    });
    const [rod17, , gone] = made.products;
    const period = { product_id: rod17, reference_start: "2017-01-01", reference_end: "2017-12-31" };

    // Manual key: another product's production approval leaves it alone; a change to its own counts.
    const manual = (await call("POST", "/pcf/studies", "manager", { ...period, allocation_key: "manual" })).json.pcf_study_id;
    await call("PUT", `/pcf/studies/${manual}/inputs`, "manager", { inputs: [{ stage: "A1", name: "Aluminium", unit: "kg", quantity: 1, material_factor_id: alu }] });
    assert.equal((await call("POST", `/pcf/studies/${manual}/calculate`, "manager", { key_value_product: 1, key_value_site_total: 4 })).status, 200);
    assert.equal((await call("POST", `/pcf/studies/${manual}/submit`, "manager")).status, 200);
    assert.equal((await call("PUT", `/user/production-data/${made.production[1]}/approve`, "manager", {})).status, 200);
    assert.equal(await staleOf(manual), false);
    // Back to pending so the mass studies below see the same site total as before.
    await withDb((db) => db.query("UPDATE production_data SET status = 'pending' WHERE production_id = $1", [made.production[1]]));

    // Mass key: a category moving into Scope 1 adds to A3 energy.
    const byScope = await approvedStudy(period);
    assert.equal((await call("PUT", `/admin/categories/${made.category}`, "superadmin", { scope: "Scope 1" })).status, 200);
    assert.equal(await staleOf(byScope), true);

    // Mass key: deleting another product takes its production out of the site total.
    const byDelete = await approvedStudy(period);
    assert.equal(await staleOf(byDelete), false);
    assert.equal((await call("DELETE", `/admin/products/${gone}`, "superadmin")).status, 200);
    assert.equal(await staleOf(byDelete), true);
    // (Category delete isn't exercised here: the CI fixture's invoice table has no
    // emission_id column, so DELETE /admin/categories fails in this environment.)
  } finally {
    await withDb(async (db) => {
      await db.query("DELETE FROM pcf_study WHERE product_id = ANY($1)", [made.products]);
      await db.query("DELETE FROM emission WHERE pk_id = ANY($1)", [made.emissions]);
      await db.query("DELETE FROM production_data WHERE production_id = ANY($1)", [made.production]);
      await db.query("DELETE FROM product WHERE product_id = ANY($1)", [made.products]);
      if (made.category) await db.query("DELETE FROM category WHERE category_id = $1", [made.category]);
    });
  }
});
