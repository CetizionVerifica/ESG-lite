// F-21: a pending count that matches the approvals list. A pending FERA twin
// folds into its partner only while the partner is pending too; a pending twin
// of an approved entry needs its own review and counts on its own.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql) => (await withDb((db) => db.query(sql))).rows;

test("pending_review_count folds twins of pending entries only", async () => {
  // Fixture: site 1 has entry 2 (pending) and twin 5 (pending, partner 1 approved).
  const base = await call("GET", "/user/emissions?siteId=1&page=1&limit=1", "manager");
  assert.equal(base.status, 200);
  assert.equal(base.json.summary.pending_count, 2);
  assert.equal(base.json.summary.pending_review_count, 2);

  // A pending entry with a pending twin (category 5 is FERA) is one row to review.
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, fera_linked_id)
           VALUES (961, '{"activity_value": 1}', 1, 'tCO2e', '2025-09-30', 'pending', 1, 1, 1, 'monthly', NULL),
                  (962, '{"activity_value": 1}', 0.2, 'tCO2e', '2025-09-30', 'pending', 1, 5, 1, 'monthly', 961)`);
  await q("UPDATE emission SET fera_linked_id = 962 WHERE pk_id = 961");
  try {
    const list = await call("GET", "/user/emissions?siteId=1&page=1&limit=1", "manager");
    assert.equal(list.json.summary.pending_count, 4);
    assert.equal(list.json.summary.pending_review_count, 3);

    // The list tells each FERA twin whether its partner entry is pending.
    const rows = await call("GET", "/user/emissions?siteId=1&page=1&limit=50", "manager");
    const partner = Object.fromEntries(rows.json.data.filter((r) => r.pk_id === 5 || r.pk_id === 962).map((r) => [r.pk_id, r.fera_partner_status]));
    assert.deepEqual(partner, { 5: "approved", 962: "pending" });
    const plain = await call("GET", "/user/emissions?siteId=1", "manager");
    assert.equal(plain.json.find((r) => r.pk_id === 962).fera_partner_status, "pending");

    const overview = await call("GET", "/manager/overview?period=2025-09&siteId=1", "manager");
    assert.equal(overview.status, 200);
    assert.equal(overview.json.kpis.pending_count, 4);
    assert.equal(overview.json.kpis.pending_review_count, 3);
  } finally {
    await q("DELETE FROM emission WHERE pk_id IN (961, 962)");
  }
});
