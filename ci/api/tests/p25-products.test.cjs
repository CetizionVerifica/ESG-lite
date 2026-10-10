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

test.after(() => withDb((db) => db.query(`DELETE FROM product WHERE product_id = ANY($1)`, [[product, other]])));

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
});

test("moving a product to another site moves its production records", async () => {
  const res = await call("PUT", `/admin/products/${product}`, "superadmin", { site_id: 2, unit: " t " });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.moved_production_count, 3);
  assert.equal(res.json.product.site.site_id, 2);
  assert.equal(res.json.product.unit, "t");
  const sites = await withDb((db) => db.query(`SELECT DISTINCT site_id FROM production_data WHERE product_id = $1`, [product]));
  assert.deepEqual(sites.rows.map((r) => r.site_id), [2]);

  // Saving without a site change moves nothing.
  const again = await call("PUT", `/admin/products/${product}`, "superadmin", { site_id: 2, description: "Billets" });
  assert.equal(again.json.moved_production_count, 0);
});
