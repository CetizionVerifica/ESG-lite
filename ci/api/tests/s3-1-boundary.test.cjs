// S3-1 category taxonomy and Scope 3 boundary: the four endpoints (tenant
// isolation, the D12 role matrix), every new error code, ghg_category on
// category create/update, and the migration/backfill run twice.
//
// Fixture: company 1 has Scope 3 categories 3 "Business Travel" (an exact GHG
// name) and 5 "FERA" (a keyword match) on site 1; company 2 has none.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");

const reset = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM company_scope3_category WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM category_ghg_map_proposal WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM category WHERE category_id >= 910 AND category_id < 920`);
    await db.query(`UPDATE category SET ghg_category = NULL WHERE category_id IN (3, 5)`);
    await db.query(`UPDATE company SET consolidation_approach = 'operational_control' WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM audit_log WHERE entity_type LIKE 'scope3_%'`);
  });

test.before(reset);
test.after(reset);

test("GET /scope3/categories: 15 rows for the caller's company, seeded once", async () => {
  const r = await call("GET", "/scope3/categories", "user");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.company_id, 1);
  assert.equal(r.json.categories.length, 15);
  assert.equal(r.json.consolidation_approach, "operational_control");
  assert.equal(r.json.can_edit, false);
  const s = r.json.summary;
  assert.equal(s.included + s.excluded + s.not_relevant + s.screening, 15);
  // D10: 13–15 start as Not relevant with the reason to confirm.
  for (const n of [13, 14, 15]) {
    const row = r.json.categories.find((c) => c.n === n);
    assert.equal(row.status, "not_relevant");
    assert.match(row.reason, /No leased-out assets/);
  }
  assert.equal(r.json.categories[0].name, "Purchased goods and services");

  const again = await call("GET", "/scope3/categories", "manager");
  assert.equal(again.status, 200);
  const count = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM company_scope3_category WHERE company_id = 1`));
  assert.equal(count.rows[0].n, 15);
});

test("tenant isolation: another company's id gives 404 on every endpoint", async () => {
  assert.equal((await call("GET", "/scope3/categories?company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/scope3/category-map?company_id=1", "otherUser")).status, 404);
  assert.equal((await call("PUT", "/scope3/categories/14", "admin", { company_id: 2, status: "included" })).status, 404);
  assert.equal((await call("PUT", "/company/2/consolidation-approach", "admin", { consolidation_approach: "equity_share" })).status, 404);
  // A category company 2 doesn't use can't be confirmed for company 2.
  const r = await call("POST", "/scope3/category-map", "superadmin", { company_id: 2, confirm: [{ category_id: 5, ghg_category: 3 }] });
  assert.equal(r.status, 404);
  const other = await withDb((db) => db.query(`SELECT consolidation_approach FROM company WHERE company_id = 2`));
  assert.equal(other.rows[0].consolidation_approach, "operational_control");
  // Unauthenticated
  assert.equal((await call("GET", "/scope3/categories")).status, 401);
});

test("role matrix (D12): Admin and Superadmin change the boundary, others read", async () => {
  const body = { status: "excluded", reason: "No franchises" };
  assert.equal((await call("PUT", "/scope3/categories/14", "user", body)).status, 403);
  assert.equal((await call("PUT", "/scope3/categories/14", "manager", body)).status, 403);
  assert.equal((await call("PUT", "/company/1/consolidation-approach", "manager", { consolidation_approach: "equity_share" })).status, 403);

  const sa = await call("PUT", "/scope3/categories/14", "superadmin", body);
  assert.equal(sa.status, 400);
  assert.equal(sa.json.code, "SCOPE3_COMPANY_REQUIRED");

  const admin = await call("PUT", "/scope3/categories/14", "admin", { ...body, method_note: "Checked 2026" });
  assert.equal(admin.status, 200, JSON.stringify(admin.json));
  assert.equal(admin.json.status, "excluded");

  const read = await call("GET", "/scope3/categories?company_id=1", "superadmin");
  const row = read.json.categories.find((c) => c.n === 14);
  assert.equal(row.status, "excluded");
  assert.equal(row.reason, "No franchises");
  assert.equal(row.method_note, "Checked 2026");
  assert.equal(row.updated_by.user_id, 3);
  assert.equal(read.json.can_edit, true);
  assert.equal(read.json.can_confirm_map, true);

  const log = await withDb((db) => db.query(`SELECT changed_fields, reason FROM audit_log WHERE entity_type = 'scope3_boundary'`));
  assert.equal(log.rows.length, 1);
  assert.deepEqual(log.rows[0].changed_fields.status, { old: "not_relevant", new: "excluded" });
  assert.equal(log.rows[0].reason, "No franchises");

  const ca = await call("PUT", "/company/1/consolidation-approach", "admin", { consolidation_approach: "financial_control" });
  assert.equal(ca.status, 200);
  assert.equal((await call("GET", "/scope3/categories", "user")).json.consolidation_approach, "financial_control");
  const bad = await call("PUT", "/company/1/consolidation-approach", "superadmin", { consolidation_approach: "whatever" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "SCOPE3_VALIDATION");
});

test("EXCLUSION_REASON_REQUIRED and GHG_CATEGORY_INVALID on the boundary", async () => {
  for (const status of ["excluded", "not_relevant"]) {
    const r = await call("PUT", "/scope3/categories/8", "admin", { status, reason: "  " });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "EXCLUSION_REASON_REQUIRED");
  }
  // Clearing the reason of an excluded row is refused too.
  const clear = await call("PUT", "/scope3/categories/14", "admin", { reason: null });
  assert.equal(clear.json.code, "EXCLUSION_REASON_REQUIRED");
  const bad = await call("PUT", "/scope3/categories/16", "admin", { status: "included" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "GHG_CATEGORY_INVALID");
  const badStatus = await call("PUT", "/scope3/categories/8", "admin", { status: "maybe" });
  assert.equal(badStatus.json.code, "SCOPE3_VALIDATION");
});

test("category map: proposals, Superadmin confirm, and the categories' numbers", async () => {
  const r = await call("GET", "/scope3/category-map", "admin");
  assert.equal(r.status, 200);
  // "Business Travel" is an exact GHG name: numbered by the backfill, no confirm needed.
  assert.deepEqual(r.json.mapped.map((p) => [p.category_id, p.ghg_category, p.basis]), [[3, 6, "exact"]]);
  assert.equal(r.json.unmapped.length, 1);
  assert.equal(r.json.unmapped[0].category_id, 5);
  assert.equal(r.json.unmapped[0].proposed, 3);
  assert.ok(r.json.unmapped[0].confidence < 100);
  const cat5 = await withDb((db) => db.query(`SELECT ghg_category FROM category WHERE category_id = 5`));
  assert.equal(cat5.rows[0].ghg_category, null, "a keyword proposal never writes the category");

  assert.equal((await call("POST", "/scope3/category-map", "admin", { confirm: [{ category_id: 5, ghg_category: 3 }] })).status, 403);
  const invalid = await call("POST", "/scope3/category-map", "superadmin", { company_id: 1, confirm: [{ category_id: 5, ghg_category: 0 }] });
  assert.equal(invalid.json.code, "GHG_CATEGORY_INVALID");

  const ok = await call("POST", "/scope3/category-map", "superadmin", { company_id: 1, confirm: [{ category_id: 5, ghg_category: 3 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const boundary = await call("GET", "/scope3/categories", "admin");
  const cat3 = boundary.json.categories.find((c) => c.n === 3);
  assert.equal(cat3.status, "included");
  assert.deepEqual(cat3.mapped_categories, [{ category_id: 5, category_name: "FERA" }]);
  assert.equal(boundary.json.unmapped_count, 0);
});

test("category create/update: ghg_category only on Scope 3, required once the map is confirmed", async () => {
  // The previous test confirmed every open proposal, so the map is confirmed.
  const wrongScope = await call("POST", "/admin/categories", "superadmin", { category_name: "CI S3-1 Fuel", scope: "Scope 1", ghg_category: 4 });
  assert.equal(wrongScope.status, 400);
  assert.equal(wrongScope.json.code, "GHG_CATEGORY_INVALID");

  const missing = await call("POST", "/admin/categories", "superadmin", { category_name: "CI S3-1 Freight", scope: "Scope 3" });
  assert.equal(missing.status, 422);
  assert.equal(missing.json.code, "GHG_CATEGORY_REQUIRED");

  const created = await call("POST", "/admin/categories", "superadmin", { category_name: "CI S3-1 Freight", scope: "Scope 3", ghg_category: 4 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.category.ghg_category, 4);
  const id = created.json.category.category_id;

  const outOfRange = await call("PUT", `/admin/categories/${id}`, "superadmin", { ghg_category: 99 });
  assert.equal(outOfRange.json.code, "GHG_CATEGORY_INVALID");
  const changed = await call("PUT", `/admin/categories/${id}`, "superadmin", { ghg_category: 9 });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  // Moving it out of Scope 3 clears the number.
  const moved = await call("PUT", `/admin/categories/${id}`, "superadmin", { scope: "Scope 1" });
  assert.equal(moved.status, 200);
  const row = await withDb((db) => db.query(`SELECT ghg_category FROM category WHERE category_id = $1`, [id]));
  assert.equal(row.rows[0].ghg_category, null);
  await withDb((db) => db.query(`DELETE FROM category WHERE category_id = $1`, [id]));
});

test("migrate:scope3-taxonomy runs twice without duplicates or overwrites", () => {
  const run = () =>
    spawnSync(process.execPath, [path.join(ROOT, "dist/scripts/migrateScope3Taxonomy.js")], {
      cwd: ROOT,
      env: { ...process.env, TYPEORM_SYNC: "false" },
      encoding: "utf8",
    });
  const counts = () =>
    withDb(async (db) => {
      const b = await db.query(`SELECT COUNT(*)::int AS n FROM company_scope3_category`);
      const p = await db.query(`SELECT COUNT(*)::int AS n FROM category_ghg_map_proposal`);
      const dup = await db.query(
        `SELECT COUNT(*)::int AS n FROM (SELECT company_id, ghg_category FROM company_scope3_category GROUP BY 1, 2 HAVING COUNT(*) > 1) d`,
      );
      return { boundary: b.rows[0].n, proposals: p.rows[0].n, dup: dup.rows[0].n };
    });
  return (async () => {
    const first = run();
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const after1 = await counts();
    const second = run();
    assert.equal(second.status, 0, second.stderr + second.stdout);
    const after2 = await counts();
    assert.deepEqual(after2, after1);
    assert.equal(after2.dup, 0);
    // The Admin's exclusion of Cat 14 survived both runs.
    const row = await withDb((db) => db.query(`SELECT status FROM company_scope3_category WHERE company_id = 1 AND ghg_category = 14`));
    assert.equal(row.rows[0].status, "excluded");
  })();
});
