// P25: the Superadmin Products list with client, production record count and
// latest period, the drawer's recent production, required-site validation,
// and moving a product's production records with it when its site changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

let product;
let other;

test.before(async () => {
  await withDb(async (db) => {
    const p = await db.query(
      `INSERT INTO product (name, unit, site_id) VALUES ('P25 billet', 'tonnes', 1), ('P25 empty', 'units', 2) RETURNING product_id`,
    );
    [product, other] = p.rows.map((r) => r.product_id);
    await db.query(
      `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES
         ($1, 1, 100, 'tonnes', '2026-01-01', '2026-01-31', 'approved', 1),
         ($1, 1, 120, 'tonnes', '2026-02-01', '2026-02-28', 'pending', 1),
         ($1, 1, 90, 'tonnes', '2025-12-01', '2025-12-31', 'rejected', 1)`,
      [product],
    );
  });
});

test.after(() =>
  withDb(async (db) => {
    await db.query(
      `DELETE FROM audit_log WHERE action = 'product_site_move' AND entity_id IN (SELECT production_id FROM production_data WHERE product_id = $1)`,
      [product],
    );
    await db.query(`DELETE FROM product WHERE product_id = ANY($1)`, [[product, other]]);
  }),
);

test("GET /admin/products carries client, record count and latest period", async () => {
  const res = await call("GET", "/admin/products", "superadmin");
  assert.equal(res.status, 200);
  const p = res.json.find((x) => x.product_id === product);
  assert.equal(p.production_count, 3);
  assert.equal(p.last_period_end, "2026-02-28");
  assert.deepEqual(p.site.company, { company_id: 1, name: "CI Steel Co" });
  const e = res.json.find((x) => x.product_id === other);
  assert.equal(e.production_count, 0);
  assert.equal(e.last_period_end, null);

  assert.equal((await call("GET", "/admin/products", "admin")).status, 403);
});

test("GET /admin/products/:id/production lists the newest records first", async () => {
  const res = await call("GET", `/admin/products/${product}/production?limit=2`, "superadmin");
  assert.equal(res.status, 200);
  assert.equal(res.json.total, 3);
  assert.deepEqual(
    res.json.records.map((r) => [String(r.end_date).slice(0, 10), r.status]),
    [
      ["2026-02-28", "pending"],
      ["2026-01-31", "approved"],
    ],
  );
  assert.equal(res.json.records[0].site.name, "CI Plant A");
  assert.equal((await call("GET", "/admin/products/999999/production", "superadmin")).status, 404);
});

test("create and update need a name, a unit and a real site", async () => {
  assert.equal((await call("POST", "/admin/products", "superadmin", { name: "  ", unit: "t", site_id: 1 })).status, 400);
  assert.equal((await call("POST", "/admin/products", "superadmin", { name: "X", unit: "t" })).status, 400);
  assert.equal((await call("POST", "/admin/products", "superadmin", { name: "X", unit: "t", site_id: 999999 })).status, 400);
  assert.equal((await call("PUT", `/admin/products/${other}`, "superadmin", { name: " " })).status, 400);
  assert.equal((await call("PUT", `/admin/products/${other}`, "superadmin", { site_id: 999999 })).status, 400);
  assert.equal((await call("POST", "/admin/products", "superadmin", { name: "X", unit: "t", site_id: "abc" })).status, 400);
  assert.equal((await call("PUT", `/admin/products/${other}`, "superadmin", { site_id: "1.5" })).status, 400);
  assert.equal((await call("PUT", "/admin/products/abc", "superadmin", { name: "X" })).status, 400);
});

test("a product can't move to another client's site, and nothing moves", async () => {
  const res = await call("PUT", `/admin/products/${product}`, "superadmin", { site_id: 3, name: "Renamed" });
  assert.equal(res.status, 400);
  const row = await withDb((db) => db.query(`SELECT name, site_id FROM product WHERE product_id = $1`, [product]));
  assert.deepEqual(row.rows[0], { name: "P25 billet", site_id: 1 });
  const sites = await withDb((db) => db.query(`SELECT DISTINCT site_id FROM production_data WHERE product_id = $1`, [product]));
  assert.deepEqual(sites.rows.map((r) => r.site_id), [1]);
});

test("moving a product to another site moves its production records", async () => {
  const res = await call("PUT", `/admin/products/${product}`, "superadmin", { site_id: 2, unit: " t " });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.moved_production_count, 3);
  assert.equal(res.json.product.site.site_id, 2);
  assert.equal(res.json.product.unit, "t");
  const sites = await withDb((db) => db.query(`SELECT DISTINCT site_id FROM production_data WHERE product_id = $1`, [product]));
  assert.deepEqual(sites.rows.map((r) => r.site_id), [2]);
  const audit = await withDb((db) =>
    db.query(
      `SELECT a.changed_fields, a.changed_by FROM audit_log a JOIN production_data p ON p.production_id = a.entity_id
        WHERE a.entity_type = 'production_data' AND a.action = 'product_site_move' AND p.product_id = $1`,
      [product],
    ),
  );
  assert.equal(audit.rows.length, 3);
  assert.deepEqual(audit.rows[0].changed_fields, { site_id: { old: 1, new: 2 } });
  assert.equal(audit.rows[0].changed_by, 5);

  // Saving without a site change moves nothing.
  const again = await call("PUT", `/admin/products/${product}`, "superadmin", { site_id: 2, description: "Billets" });
  assert.equal(again.json.moved_production_count, 0);
});

test("declared unit, quantity and mass per unit are saved, validated and cleared", async () => {
  const made = await call("POST", "/admin/products", "superadmin", {
    name: "P25 rod", unit: "t", site_id: 1, declared_unit: " t ", declared_unit_qty: "1", mass_per_unit_kg: 1000,
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.product.product_id;
  try {
    assert.equal(made.json.product.declared_unit, "t");
    assert.equal(Number(made.json.product.declared_unit_qty), 1);
    assert.equal(Number(made.json.product.mass_per_unit_kg), 1000);

    for (const bad of [{ declared_unit_qty: 0 }, { declared_unit_qty: "abc" }, { mass_per_unit_kg: -5 }, { declared_unit: "x".repeat(21) }]) {
      assert.equal((await call("PUT", `/admin/products/${id}`, "superadmin", bad)).status, 400, JSON.stringify(bad));
      assert.equal((await call("POST", "/admin/products", "superadmin", { name: "X", unit: "t", site_id: 1, ...bad })).status, 400);
    }

    const upd = await call("PUT", `/admin/products/${id}`, "superadmin", { mass_per_unit_kg: "998.5" });
    assert.equal(upd.status, 200);
    assert.equal(Number(upd.json.product.mass_per_unit_kg), 998.5);
    assert.equal(upd.json.product.declared_unit, "t", "fields left out of the body stay as they were");

    const cleared = await call("PUT", `/admin/products/${id}`, "superadmin", { declared_unit: "", declared_unit_qty: null, mass_per_unit_kg: "" });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.product.declared_unit, null);
    assert.equal(cleared.json.product.declared_unit_qty, null);
    assert.equal(cleared.json.product.mass_per_unit_kg, null);
  } finally {
    await withDb((db) => db.query(`DELETE FROM product WHERE product_id = $1`, [id]));
  }
});

test("changing the declared unit or mass marks the product's approved footprints stale", async () => {
  const id = (await call("POST", "/admin/products", "superadmin", { name: "P25 stale rod", unit: "t", site_id: 1, declared_unit: "t", mass_per_unit_kg: 1000 }))
    .json.product.product_id;
  try {
    const study = await withDb((db) =>
      db.query(
        `INSERT INTO pcf_study (reference_start, reference_end, company_id, product_id, site_id, status, created_by)
         VALUES ('2025-01-01', '2025-12-31', 1, $1, 1, 'approved', 2) RETURNING pcf_study_id`,
        [id],
      ),
    );
    const sid = study.rows[0].pcf_study_id;
    const staleOf = async () => (await withDb((db) => db.query(`SELECT stale FROM pcf_study WHERE pcf_study_id = $1`, [sid]))).rows[0].stale;

    // The same values again change nothing.
    await call("PUT", `/admin/products/${id}`, "superadmin", { declared_unit: "t", mass_per_unit_kg: "1000", description: "Rod" });
    assert.equal(await staleOf(), false);

    await call("PUT", `/admin/products/${id}`, "superadmin", { mass_per_unit_kg: 990 });
    assert.equal(await staleOf(), true);
    const note = await withDb((db) =>
      db.query(`SELECT message FROM notification WHERE user_id = 2 AND type = 'pcf_stale' AND link LIKE $1 ORDER BY id DESC LIMIT 1`, [`%/footprints/${sid}`]),
    );
    assert.match(note.rows[0].message, /declared unit or mass per unit/);
  } finally {
    await withDb(async (db) => {
      await db.query(`DELETE FROM notification WHERE type = 'pcf_stale' AND link LIKE $1`, [`/products/${id}/%`]);
      await db.query(`DELETE FROM pcf_study WHERE product_id = $1`, [id]);
      await db.query(`DELETE FROM product WHERE product_id = $1`, [id]);
    });
  }
});
