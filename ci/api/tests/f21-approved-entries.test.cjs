// ESG-lite #194: Overview's "N approved entries" counts what people filed. An
// automatic FERA twin (a FERA row linked to its entry) is part of that entry;
// a FERA entry filed on its own still counts. approved_count keeps every row.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql) => (await withDb((db) => db.query(sql))).rows;
const kpis = async () => (await call("GET", "/manager/overview?period=2025-08&siteId=1", "manager")).json.kpis;

test("approved_entry_count leaves out automatic FERA twins", async () => {
  const before = await kpis();
  assert.equal(typeof before.approved_entry_count, "number");

  // An approved entry with its approved twin (category 5 is FERA): two rows, one entry.
  await q(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, fera_linked_id)
           VALUES (971, '{"activity_value": 1}', 1, 'tCO2e', '2025-08-31', 'approved', 1, 1, 1, 'monthly', 972),
                  (972, '{"activity_value": 1}', 0.2, 'tCO2e', '2025-08-31', 'approved', 1, 5, 1, 'monthly', 971),
                  (973, '{"activity_value": 1}', 0.3, 'tCO2e', '2025-08-31', 'approved', 1, 5, 1, 'monthly', NULL)`);
  try {
    const after = await kpis();
    assert.equal(after.approved_count, before.approved_count + 3, "approved_count still counts every row");
    // The entry and the FERA entry filed on its own; the twin folds into its entry.
    assert.equal(after.approved_entry_count, before.approved_entry_count + 2);
  } finally {
    await q("DELETE FROM emission WHERE pk_id IN (971, 972, 973)");
  }
});
