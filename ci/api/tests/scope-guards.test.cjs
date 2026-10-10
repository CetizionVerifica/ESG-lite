// Client isolation on /user/* and /reports/* (audit findings F-01, F-02):
// only Managers and Superadmins review, nobody reviews their own entries, and
// nobody reads or changes another company's sites. Company 1 = sites 1 + 2,
// company 2 = site 3 (ci/api/fixture.sql). Each test restores what it changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const statusOf = (id) => withDb(async (db) => (await db.query("SELECT status FROM emission WHERE pk_id=$1", [id])).rows[0]?.status);
const resetEmission = (id, status) =>
  withDb((db) => db.query("UPDATE emission SET status=$2, reviewed_by=NULL, reviewed_at=NULL, review_comment=NULL WHERE pk_id=$1", [id, status]));
const denied = (s) => [403, 404].includes(s);

test("only reviewers approve or reject, and only on their own sites", async () => {
  for (const who of ["user", "otherUser", "admin", "multiSiteUser"]) {
    assert.equal((await call("PUT", "/user/emissions/2/approve", who, {})).status, 403, who);
    assert.equal((await call("PUT", "/user/emissions/2/reject", who, { comment: "x" })).status, 403, who);
  }
  assert.ok(denied((await call("PUT", "/user/emissions/2/approve", "otherManager", {})).status));
  assert.equal((await call("PUT", "/user/emissions/bulk-reject", "otherManager", { ids: [1, 2], comment: "x" })).status, 403);
  assert.equal((await call("PUT", "/user/emissions/bulk-approve", "otherManager", { ids: [2] })).status, 403);
  assert.equal(await statusOf(1), "approved");
  assert.equal(await statusOf(2), "pending");

  const own = await call("PUT", "/user/emissions/2/approve", "manager", {});
  assert.equal(own.status, 200);
  await resetEmission(2, "pending");
});

test("a manager can't review an entry they created", async () => {
  await withDb((db) => db.query("UPDATE emission SET created_by=2 WHERE pk_id=11"));
  try {
    const r = await call("PUT", "/user/emissions/11/approve", "manager", {});
    assert.equal(r.status, 403);
    assert.equal(await statusOf(11), "pending");
  } finally {
    await withDb((db) => db.query("UPDATE emission SET created_by=7 WHERE pk_id=11"));
  }
});

test("batch review and delete stay on the caller's sites", async () => {
  await withDb((db) => db.query("UPDATE emission SET upload_batch_id='ci-scope-batch' WHERE pk_id IN (2, 11)"));
  try {
    assert.ok(denied((await call("PUT", "/user/emissions/batch/ci-scope-batch/approve", "otherManager", {})).status));
    assert.equal((await call("PUT", "/user/emissions/batch/ci-scope-batch/reject", "user", { comment: "x" })).status, 403);
    assert.ok(denied((await call("DELETE", "/user/emissions/batch/ci-scope-batch", "otherUser")).status));
    const listed = await call("GET", "/user/emissions/batches", "otherUser");
    assert.equal(listed.status, 200);
    assert.ok(!JSON.stringify(listed.json).includes("ci-scope-batch"));
    assert.ok(JSON.stringify((await call("GET", "/user/emissions/batches", "manager")).json).includes("ci-scope-batch"));
  } finally {
    await withDb((db) => db.query("UPDATE emission SET upload_batch_id=NULL WHERE upload_batch_id='ci-scope-batch'"));
  }
});

test("another company's entries can't be created, edited, deleted or read", async () => {
  const created = await call("POST", "/user/emissions", "otherUser", {
    site_id: 1, category_id: 3, activity_data: { note: "x" }, total_emission: 1, unit: "tCO2e", date_of_reporting: "2025-07-31", reporting_period: "monthly",
  });
  assert.equal(created.status, 403);
  assert.ok(denied((await call("PUT", "/user/emissions/2", "otherUser", { activity_data: { activity_value: 1 } })).status));
  assert.ok(denied((await call("DELETE", "/user/emissions/1", "otherUser")).status));
  assert.ok(denied((await call("DELETE", "/user/emissions/bulk-delete", "otherManager", { ids: [1] })).status));
  assert.ok(denied((await call("PUT", "/user/emissions/manager-edit/1", "otherManager", { activity_data: {}, reason: "x" })).status));
  assert.ok(denied((await call("GET", "/user/emissions/1/factor", "otherUser")).status));
  assert.equal(await statusOf(1), "approved");
});

test("production data is scoped and reviewed like emissions", async () => {
  await withDb((db) =>
    db.query(`INSERT INTO product (product_id, name, unit, site_id) VALUES (901, 'CI Rod', 't', 1) ON CONFLICT DO NOTHING;
              INSERT INTO production_data (production_id, product_id, site_id, quantity, unit, start_date, end_date, status, created_by)
              VALUES (901, 901, 1, 100, 't', '2025-09-01', '2025-09-30', 'pending', 1) ON CONFLICT DO NOTHING`)
  );
  try {
    assert.ok(denied((await call("PUT", "/user/production-data/901/approve", "otherUser", {})).status));
    assert.equal((await call("PUT", "/user/production-data/901/approve", "user", {})).status, 403);
    assert.equal((await call("GET", "/user/production-data/site/1", "otherUser")).status, 403);
    const list = await call("GET", "/user/production-data/manager", "otherManager");
    assert.equal(list.status, 200);
    assert.ok(list.json.every((r) => r.site.site_id === 3));
    assert.ok((await call("GET", "/user/production-data/manager", "manager")).json.some((r) => r.production_id === 901));
    assert.equal((await call("PUT", "/user/production-data/901/approve", "manager", {})).status, 200);
  } finally {
    await withDb((db) => db.query("DELETE FROM production_data WHERE production_id=901; DELETE FROM product WHERE product_id=901"));
  }
});

test("reports and targets refuse another company's sites", async () => {
  const body = { siteIds: [1, 2], yearType: "CY", year: 2025, compareYear: 2024, frequency: "yearly" };
  assert.equal((await call("POST", "/user/ghg/tables", "otherManager", body)).status, 403);
  assert.equal((await call("POST", "/user/ghg/details", "otherManager", body)).status, 403);
  assert.equal((await call("POST", "/user/reports/ede", "otherManager", { siteIds: [1], frequency: "yearly", year: 2025 })).status, 403);
  assert.equal((await call("POST", "/user/targets/tables", "otherManager", { siteIds: [1], baseYear: 2024, targetYear: 2030, annualRate: 0.042 })).status, 403);
  assert.equal((await call("POST", "/user/targets/long-term-chart", "otherManager", { siteIds: [1], baseYear: 2024 })).status, 403);
  assert.equal((await call("POST", "/user/emissions/approved", "otherManager", { siteIds: [1], frequency: "yearly", year: 2025 })).status, 403);
  assert.equal((await call("GET", "/user/emission-intensity/site/1", "otherUser")).status, 403);
  assert.equal((await call("GET", "/user/emission-intensity/comparison?siteIds=1,3", "otherManager")).status, 403);
  assert.equal((await call("GET", "/reports/ghg?siteIds=1&year=2025", "otherManager")).status, 403);
  assert.equal((await call("GET", "/reports/ghg/1?siteIds=3&year=2025", "otherManager")).status, 403);

  const own = await call("POST", "/user/ghg/tables", "manager", body);
  assert.equal(own.status, 200);
  const filled = await call("POST", "/user/ghg/tables", "otherManager", { ...body, siteIds: undefined });
  assert.ok(!JSON.stringify(filled.json ?? "").includes("CI Plant A"));
});

test("reference reads, companies and audit logs stay inside the company", async () => {
  const companies = await call("GET", "/user/companies", "otherUser");
  assert.equal(companies.status, 200);
  assert.deepEqual(companies.json.map((c) => c.company_id), [2]);
  assert.equal((await call("GET", "/user/companies", "superadmin")).json.length >= 2, true);
  assert.equal((await call("GET", "/user/sites/1", "otherUser")).status, 403);
  assert.equal((await call("GET", "/user/units/site/1/category/1", "otherUser")).status, 403);
  assert.equal((await call("GET", "/user/column-configs/site/1/category/1", "otherUser")).status, 403);
  assert.equal((await call("GET", "/user/emission-factors/site/1/category/1", "otherUser")).status, 403);
  assert.equal((await call("GET", "/user/products/site/1", "otherUser")).status, 403);
  assert.equal((await call("GET", "/user/thresholds/company/1", "otherUser")).status, 403);
  assert.equal((await call("GET", "/user/category-mappings/company/1", "otherUser")).status, 403);
  assert.equal((await call("GET", "/user/thresholds/company/1", "user")).status !== 403, true);

  await withDb((db) => db.query("INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, changed_by) VALUES ('emission', 1, 'user_edit', '{}', 1)"));
  try {
    assert.equal((await call("GET", "/user/audit-logs?entity_type=emission&entity_id=1", "otherUser")).status, 404);
    assert.equal((await call("GET", "/user/audit-logs?entity_type=emission&entity_id=1", "user")).status, 200);
  } finally {
    await withDb((db) => db.query("DELETE FROM audit_log WHERE entity_type='emission' AND entity_id=1 AND action='user_edit'"));
  }
});
